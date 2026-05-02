import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { User } from '@supabase/supabase-js';
import * as Speech from 'expo-speech';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  Share,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import PrayerForm from '../../components/PrayerForm';
import { usePrayerRequests, PrayerRequest } from '../../hooks/usePrayerRequests';
import { CATEGORIES, SPECIAL_MODES, TEXTS } from '../../constants/prayer';
import { supabase } from '../../lib/supabase';
import {
  deletePrayer,
  fetchAllPrayersForPastor,
  fetchPrayers,
  updatePrayerStatus,
} from '../../services/prayerService';
import { TrendInsight, analyzeTrends } from '../../services/victoriaService';
import { Prayer } from '../../types/prayer';

// ─────────────────────────────────────────────────────────────
//  WEB HELPERS + CONSTANTS
// ─────────────────────────────────────────────────────────────
const toFlag = (code: string | null): string => {
  if (!code || code.length < 2) return '';
  try {
    return String.fromCodePoint(
      ...code.toUpperCase().slice(0, 2).split('').map(c => 0x1F1E6 + c.charCodeAt(0) - 65)
    );
  } catch { return ''; }
};

const timeAgo = (d: string): string => {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'ahora';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
};

const getInitials = (name: string) =>
  name.trim().split(/\s+/).map(n => n[0] ?? '').join('').slice(0, 2).toUpperCase();

const getStatusStep = (r: PrayerRequest): number => {
  if (r.status === 'victory')   return 2;
  if (r.status === 'in_battle') return 1;
  return 0;
};

const WEB_NAV = [
  { icon: 'mail-outline',     label: 'Bandeja',      key: 'incoming'     },
  { icon: 'shield-outline',   label: 'En Batalla',   key: 'in_battle'    },
  { icon: 'trophy-outline',   label: 'Victorias',    key: 'victory'      },
  { icon: 'people-outline',   label: 'Intercesores', key: 'intercesores' },
  { icon: 'settings-outline', label: 'Ajustes',      key: 'ajustes'      },
] as const;
type NavKey = typeof WEB_NAV[number]['key'];

const CHIPS = ['Urgente', 'Salud', 'Familia', 'Finanzas', 'Trabajo'];

const CAT_COLORS: Record<string, string> = {
  salud:    '#dc2626',
  familia:  '#db2777',
  finanzas: '#2563eb',
  trabajo:  '#d97706',
  otro:     '#7c3aed',
};

const NEW_CATS = ['salud', 'familia', 'finanzas', 'trabajo', 'otro'] as const;

// ─────────────────────────────────────────────────────────────
//  WEB CRM LAYOUT  (real Supabase data)
// ─────────────────────────────────────────────────────────────
function WebCRM() {
  const [modoHoy,     setModoHoy]     = useState(false);
  const [activeNav,   setActiveNav]   = useState<NavKey>('incoming');

  const STATUS_KEYS: readonly NavKey[] = ['incoming', 'in_battle', 'victory'];
  const statusFilter = STATUS_KEYS.includes(activeNav) ? activeNav : undefined;

  const {
    requests, loading, updateStatus, savePastorNote, insertRequest,
  } = usePrayerRequests(statusFilter, modoHoy);
  const [activeChip,  setActiveChip]  = useState<string | null>(null);
  const [search,      setSearch]      = useState('');
  const [selected,    setSelected]    = useState<PrayerRequest | null>(null);
  const [hoveredId,   setHoveredId]   = useState<string | null>(null);
  const [note,        setNote]        = useState('');
  const [interSearch, setInterSearch] = useState('');
  const [localAssign, setLocalAssign] = useState<Record<string, string>>({});

  // New prayer form state
  const [showNewForm,  setShowNewForm]  = useState(false);
  const [newName,      setNewName]      = useState('');
  const [newCountry,   setNewCountry]   = useState('');
  const [newCat,       setNewCat]       = useState<string>('salud');
  const [newContent,   setNewContent]   = useState('');
  const [newUrgent,    setNewUrgent]    = useState(false);
  const [submitting,   setSubmitting]   = useState(false);
  const [submitErr,    setSubmitErr]    = useState('');
  const [noteSaving,   setNoteSaving]   = useState(false);

  // Current user identity
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [currentUserName, setCurrentUserName] = useState('');
  const [roleLoading,     setRoleLoading]     = useState(true);

  // Ajustes — role management
  const [allProfiles,     setAllProfiles]     = useState<any[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [roleUpdating,    setRoleUpdating]    = useState<string | null>(null);

  // Intercesores panel
  const [intercessors,    setIntercessors]    = useState<any[]>([]);
  const [interLoading,    setInterLoading]    = useState(false);
  const [showInterForm,   setShowInterForm]   = useState(false);
  const [interName,       setInterName]       = useState('');
  const [interEmail,      setInterEmail]      = useState('');
  const [interPhone,      setInterPhone]      = useState('');
  const [interCountry,    setInterCountry]    = useState('');
  const [interNota,       setInterNota]       = useState('');
  const [interSubmitting, setInterSubmitting] = useState(false);
  const [interErr,        setInterErr]        = useState('');

  // Fetch current user's profile role on mount
  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user) { setRoleLoading(false); return; }
      const { data } = await supabase
        .from('profiles')
        .select('full_name, role')
        .eq('id', user.id)
        .single();
      setCurrentUserRole(data?.role ?? 'member');
      setCurrentUserName(data?.full_name ?? user.email?.split('@')[0] ?? '');
      setRoleLoading(false);
    });
  }, []);

  // Fetch all profiles for Ajustes panel
  useEffect(() => {
    if (activeNav === 'ajustes') {
      setProfilesLoading(true);
      supabase
        .from('profiles')
        .select('id, full_name, role, email')
        .order('full_name')
        .then(({ data }) => { setAllProfiles(data ?? []); setProfilesLoading(false); });
    }
  }, [activeNav]);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setRoleUpdating(userId);
    await supabase.from('profiles').update({ role: newRole }).eq('id', userId);
    setAllProfiles(prev => prev.map(p => p.id === userId ? { ...p, role: newRole } : p));
    setRoleUpdating(null);
  };

  // Fetch intercessors when panel becomes active
  useEffect(() => {
    if (activeNav === 'intercesores') {
      setInterLoading(true);
      supabase
        .from('profiles')
        .select('*')
        .in('role', ['pastor', 'intercessor'])
        .then(({ data }) => { setIntercessors(data ?? []); setInterLoading(false); });
    }
  }, [activeNav]);

  const handleAddIntercessor = async () => {
    if (!interName.trim() || !interEmail.trim()) { setInterErr('Nombre y email son requeridos.'); return; }
    setInterSubmitting(true); setInterErr('');
    try {
      const tempPassword = Math.random().toString(36).slice(-10);
      const { error } = await supabase.auth.signUp({
        email: interEmail.trim(),
        password: tempPassword,
        options: { data: { full_name: interName.trim(), role: 'intercessor' } },
      });
      if (error) throw error;
      setInterName(''); setInterEmail(''); setInterPhone(''); setInterCountry(''); setInterNota('');
      setShowInterForm(false);
      const { data } = await supabase.from('profiles').select('*').in('role', ['pastor', 'intercessor']);
      setIntercessors(data ?? []);
    } catch (err: any) {
      setInterErr(err.message ?? 'Error al agregar');
    } finally {
      setInterSubmitting(false);
    }
  };

  // Keep selected fresh when realtime updates arrive
  useEffect(() => {
    if (selected) {
      const fresh = requests.find(r => r.id === selected.id);
      if (fresh) setSelected(fresh);
    }
  }, [requests]);

  // Pre-fill note when switching selected request
  const selectRequest = (r: PrayerRequest) => {
    setSelected(r);
    setNote(r.pastor_note ?? '');
    setInterSearch('');
    setShowNewForm(false);
  };

  // Stats computed from live data
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const stats = {
    active:       requests.filter(r => r.status !== 'victory').length,
    unassigned:   requests.filter(r => r.status !== 'victory' && !r.assigned_to && !localAssign[r.id]).length,
    battle:       requests.filter(r => r.status === 'in_battle').length,
    victoriasHoy: requests.filter(r => r.status === 'victory' && new Date(r.created_at) >= todayStart).length,
  };

  // Filtered feed — status already filtered by hook, apply chip + search here
  const filtered = requests.filter(r => {
    if (activeChip === 'Urgente' && !r.urgent) return false;
    if (activeChip && activeChip !== 'Urgente' && r.category !== activeChip.toLowerCase()) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!r.title?.toLowerCase().includes(q) && !r.content.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Save note to DB
  const handleSaveNote = async () => {
    if (!selected) return;
    setNoteSaving(true);
    await savePastorNote(selected.id, note);
    setNoteSaving(false);
  };

  // Submit new prayer request
  const handleSubmitNew = async () => {
    if (!newContent.trim()) { setSubmitErr('La petición no puede estar vacía.'); return; }
    setSubmitting(true); setSubmitErr('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');
      const { error } = await insertRequest({
        user_id: user.id,
        space_type: 'ministry',
        category: newCat,
        title:    newName.trim() || null,
        content:  newContent.trim(),
        country_code: newCountry.toUpperCase().trim() || null,
        urgent:   newUrgent,
        status:   'incoming',
      });
      if (error) throw error;
      setNewName(''); setNewCountry(''); setNewCat('salud');
      setNewContent(''); setNewUrgent(false);
      setShowNewForm(false);
    } catch (err: any) {
      setSubmitErr(err.message ?? 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCatColor = selected ? (CAT_COLORS[selected.category ?? ''] ?? '#7c3aed') : '#7c3aed';
  const statusStep = selected ? getStatusStep(selected) : 0;

  // ── Role gate ──
  if (roleLoading) {
    return (
      <View style={[w.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color="#7c3aed" size="large" />
      </View>
    );
  }

  // Members see a personal prayer placeholder (pastor assigns CRM access)
  if (currentUserRole !== 'pastor') {
    return (
      <View style={[w.root, { flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: 16 }]}>
        <Ionicons name="shield" size={52} color="#7c3aed" />
        <Text style={{ color: '#e2e8f0', fontSize: 20, fontWeight: '700' }}>Bienvenido, {currentUserName}</Text>
        <Text style={{ color: '#475569', fontSize: 14, textAlign: 'center', maxWidth: 320 }}>
          Tu cuenta está activa. El pastor de tu ministerio te asignará acceso al War Room.
        </Text>
        <Pressable
          style={{ marginTop: 16, backgroundColor: '#1e1b4b', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 }}
          onPress={() => supabase.auth.signOut()}
        >
          <Text style={{ color: '#a78bfa', fontWeight: '600' }}>Cerrar sesión</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={w.root}>

      {/* ══════════════════ SIDEBAR ══════════════════ */}
      <View style={w.sidebar}>
        <View style={w.sidebarBrand}>
          <Ionicons name="shield" size={22} color="#7c3aed" />
          <Text style={w.sidebarBrandTxt}>War Room</Text>
        </View>

        <View style={w.pastorRow}>
          <View style={w.pastorAvatar}>
            <Text style={w.pastorAvatarTxt}>{getInitials(currentUserName || 'PR')}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={w.pastorName}>{currentUserName || 'Pastor'}</Text>
            <Text style={w.pastorSub}>{currentUserRole ?? 'pastor'}</Text>
          </View>
        </View>

        <View style={w.sidebarDivider} />

        {WEB_NAV.map(item => {
          const count =
            item.key === 'incoming'  ? stats.active       :
            item.key === 'in_battle' ? stats.battle       :
            item.key === 'victory'   ? stats.victoriasHoy : undefined;
          const isActive = activeNav === item.key;
          return (
            <Pressable
              key={item.key}
              style={[w.navItem, isActive && w.navItemActive]}
              onPress={() => {
                setActiveNav(item.key);
                setSelected(null);
                setShowNewForm(false);
                setShowInterForm(false);
              }}
            >
              <Ionicons name={item.icon as any} size={18} color={isActive ? '#a78bfa' : '#475569'} />
              <Text style={[w.navLabel, isActive && w.navLabelActive]}>{item.label}</Text>
              {count !== undefined && count > 0 && (
                <View style={w.navBadge}><Text style={w.navBadgeTxt}>{count}</Text></View>
              )}
            </Pressable>
          );
        })}

        <View style={{ flex: 1 }} />

        <Pressable style={w.modoHoyRow} onPress={() => setModoHoy(v => !v)}>
          <Ionicons name="today-outline" size={16} color={modoHoy ? '#7c3aed' : '#475569'} />
          <Text style={[w.modoHoyTxt, modoHoy && { color: '#7c3aed' }]}>Modo Hoy</Text>
          <View style={[w.toggle, modoHoy && w.toggleOn]}>
            <View style={[w.toggleThumb, modoHoy && w.toggleThumbOn]} />
          </View>
        </Pressable>

        <Pressable style={w.signOutBtn} onPress={() => supabase.auth.signOut()}>
          <Ionicons name="log-out-outline" size={15} color="#475569" />
          <Text style={w.signOutTxt}>Salir</Text>
        </Pressable>
      </View>

      {/* ══════════════════ RIGHT AREA ══════════════════ */}
      <View style={{ flex: 1 }}>

        {/* Stats bar */}
        <View style={w.statsBar}>
          {([
            { label: 'Activas',       val: stats.active,       color: '#a78bfa' },
            { label: 'Sin Asignar',   val: stats.unassigned,   color: '#94a3b8' },
            { label: 'En Batalla',    val: stats.battle,       color: '#60a5fa' },
            { label: 'Victorias hoy', val: stats.victoriasHoy, color: '#fbbf24' },
          ] as const).map(card => (
            <View key={card.label} style={w.statCard}>
              <Text style={[w.statNum, { color: card.color }]}>{card.val}</Text>
              <Text style={w.statLbl}>{card.label}</Text>
            </View>
          ))}
        </View>

        {/* ══ INTERCESORES PANEL ══ */}
        {activeNav === 'intercesores' ? (
          <View style={{ flex: 1, flexDirection: 'row' }}>
            {/* Intercessors list */}
            <View style={[w.feed, { borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.06)' }]}>
              <View style={w.feedTopBar}>
                <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 }}>Intercesores del Ministerio</Text>
                <Pressable style={w.newBtn} onPress={() => setShowInterForm(true)}>
                  <Ionicons name="add" size={16} color="#fff" />
                  <Text style={w.newBtnTxt}>Agregar Intercesor</Text>
                </Pressable>
              </View>
              {interLoading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator color="#7c3aed" />
                </View>
              ) : (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 10 }}>
                  {intercessors.length === 0 && (
                    <View style={{ paddingTop: 48, alignItems: 'center', gap: 10 }}>
                      <Ionicons name="people-outline" size={44} color="#1e293b" />
                      <Text style={{ color: '#334155', fontSize: 14 }}>No hay intercesores registrados</Text>
                    </View>
                  )}
                  {intercessors.map((p: any) => (
                    <View key={p.id} style={[w.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
                      <View style={[w.assignedAvatarBig, { width: 40, height: 40, borderRadius: 20 }]}>
                        <Text style={[w.assignedAvatarTxt, { fontSize: 14 }]}>{getInitials(p.full_name ?? '?')}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: '#e2e8f0', fontWeight: '600', fontSize: 14 }}>{p.full_name ?? 'Sin nombre'}</Text>
                        <Text style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>{p.email ?? ''}</Text>
                      </View>
                      <View style={[w.badge, { backgroundColor: '#1e1b4b', borderColor: '#7c3aed55' }]}>
                        <Text style={[w.badgeTxt, { color: '#a78bfa' }]}>{p.role ?? 'intercesor'}</Text>
                      </View>
                      <View style={[w.badge, { backgroundColor: '#14532d22', borderColor: '#4ade8044' }]}>
                        <Text style={[w.badgeTxt, { color: '#4ade80' }]}>activo</Text>
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>

            {/* Add intercessor form */}
            <View style={w.detail}>
              {showInterForm ? (
                <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
                  <View style={[w.cardRow, { marginBottom: 20 }]}>
                    <Text style={w.detailName}>Nuevo Intercesor</Text>
                    <Pressable onPress={() => setShowInterForm(false)}>
                      <Ionicons name="close" size={20} color="#475569" />
                    </Pressable>
                  </View>

                  <Text style={w.sectionLbl}>NOMBRE COMPLETO</Text>
                  <TextInput
                    style={[w.formInput as any, { marginBottom: 16 }]}
                    placeholder="Ej. Carlos Pérez"
                    placeholderTextColor="#475569"
                    value={interName}
                    onChangeText={setInterName}
                  />

                  <Text style={w.sectionLbl}>EMAIL</Text>
                  <TextInput
                    style={[w.formInput as any, { marginBottom: 16 }]}
                    placeholder="correo@ejemplo.com"
                    placeholderTextColor="#475569"
                    value={interEmail}
                    onChangeText={setInterEmail}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />

                  <Text style={w.sectionLbl}>TELÉFONO WHATSAPP</Text>
                  <TextInput
                    style={[w.formInput as any, { marginBottom: 16 }]}
                    placeholder="+1 786…"
                    placeholderTextColor="#475569"
                    value={interPhone}
                    onChangeText={setInterPhone}
                    keyboardType="phone-pad"
                  />

                  <Text style={w.sectionLbl}>PAÍS</Text>
                  <TextInput
                    style={[w.formInput as any, { marginBottom: 16 }]}
                    placeholder="CO, MX, PE…"
                    placeholderTextColor="#475569"
                    value={interCountry}
                    onChangeText={t => setInterCountry(t.toUpperCase().slice(0, 2))}
                    maxLength={2}
                    autoCapitalize="characters"
                  />

                  <Text style={w.sectionLbl}>NOTA</Text>
                  <TextInput
                    style={[w.noteInput as any, { marginBottom: 16 }]}
                    placeholder="Especialidad o disponibilidad…"
                    placeholderTextColor="#475569"
                    value={interNota}
                    onChangeText={setInterNota}
                    multiline
                    textAlignVertical="top"
                  />

                  {interErr ? <Text style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>{interErr}</Text> : null}

                  <Pressable
                    style={[w.victoriaBtn, { backgroundColor: '#7c3aed' }]}
                    onPress={handleAddIntercessor}
                    disabled={interSubmitting}
                  >
                    {interSubmitting
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={[w.victoriaTxt, { color: '#fff' }]}>Agregar al equipo</Text>}
                  </Pressable>
                </ScrollView>
              ) : (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="people-outline" size={40} color="#334155" />
                  <Text style={w.detailEmpty}>Agrega un intercesor</Text>
                </View>
              )}
            </View>
          </View>

        ) : activeNav === 'ajustes' ? (
          /* ══ AJUSTES — GESTIÓN DE ROLES ══ */
          <View style={{ flex: 1, flexDirection: 'row' }}>
            {/* Profile list */}
            <View style={[w.feed, { borderRightWidth: 0 }]}>
              <View style={w.feedTopBar}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600' }}>Gestión de Roles</Text>
                  <Text style={{ color: '#475569', fontSize: 12, marginTop: 2 }}>
                    Solo pastores pueden cambiar roles
                  </Text>
                </View>
                <Pressable
                  style={{ padding: 8 }}
                  onPress={() => {
                    setProfilesLoading(true);
                    supabase.from('profiles').select('id, full_name, role, email').order('full_name')
                      .then(({ data }) => { setAllProfiles(data ?? []); setProfilesLoading(false); });
                  }}
                >
                  <Ionicons name="refresh-outline" size={18} color="#475569" />
                </Pressable>
              </View>

              {profilesLoading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator color="#7c3aed" />
                </View>
              ) : (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
                  {allProfiles.length === 0 && (
                    <View style={{ paddingTop: 48, alignItems: 'center', gap: 10 }}>
                      <Ionicons name="people-outline" size={44} color="#1e293b" />
                      <Text style={{ color: '#334155', fontSize: 14 }}>Sin perfiles registrados</Text>
                    </View>
                  )}
                  {allProfiles.map((p: any) => {
                    const ROLES = ['member', 'intercessor', 'pastor'] as const;
                    const roleBadgeColors: Record<string, string> = {
                      pastor:      '#7c3aed',
                      intercessor: '#2563eb',
                      member:      '#475569',
                    };
                    const badgeColor = roleBadgeColors[p.role] ?? '#475569';
                    const isUpdating = roleUpdating === p.id;
                    return (
                      <View
                        key={p.id}
                        style={[w.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}
                      >
                        {/* Avatar */}
                        <View style={[w.assignedAvatarBig, { width: 40, height: 40, borderRadius: 20 }]}>
                          <Text style={[w.assignedAvatarTxt, { fontSize: 14 }]}>
                            {getInitials(p.full_name ?? '?')}
                          </Text>
                        </View>

                        {/* Name + email */}
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#e2e8f0', fontWeight: '600', fontSize: 14 }}>
                            {p.full_name ?? 'Sin nombre'}
                          </Text>
                          <Text style={{ color: '#475569', fontSize: 11, marginTop: 1 }}>
                            {p.email ?? ''}
                          </Text>
                        </View>

                        {/* Current role badge */}
                        <View style={[w.badge, { backgroundColor: badgeColor + '22', borderColor: badgeColor + '55' }]}>
                          <Text style={[w.badgeTxt, { color: badgeColor }]}>{p.role ?? 'member'}</Text>
                        </View>

                        {/* Role selector pills */}
                        {isUpdating ? (
                          <ActivityIndicator color="#7c3aed" size="small" />
                        ) : (
                          <View style={{ flexDirection: 'row', gap: 4 }}>
                            {ROLES.map(r => (
                              <Pressable
                                key={r}
                                style={[
                                  w.catPill,
                                  p.role === r && w.catPillActive,
                                  { paddingHorizontal: 8, paddingVertical: 4 },
                                ]}
                                onPress={() => p.role !== r && handleRoleChange(p.id, r)}
                              >
                                <Text style={[
                                  w.catPillTxt,
                                  p.role === r && { color: '#fff' },
                                  { fontSize: 11 },
                                ]}>
                                  {r === 'member' ? 'Miembro' : r === 'intercessor' ? 'Intercesor' : 'Pastor'}
                                </Text>
                              </Pressable>
                            ))}
                          </View>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
              )}
            </View>
          </View>

        ) : (
        /* ══ NORMAL COLUMNS ══ */
        <View style={w.columns}>

          {/* ── Main feed ── */}
          <View style={w.feed}>
            {/* Search + new button */}
            <View style={w.feedTopBar}>
              <View style={[w.searchBar, { flex: 1 }]}>
                <Ionicons name="search-outline" size={16} color="#475569" />
                <TextInput
                  style={w.searchInput as any}
                  placeholder="Buscar peticiones..."
                  placeholderTextColor="#475569"
                  value={search}
                  onChangeText={setSearch}
                />
              </View>
              <Pressable
                style={w.newBtn}
                onPress={() => { setShowNewForm(true); setSelected(null); }}
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={w.newBtnTxt}>Nueva Petición</Text>
              </Pressable>
            </View>

            {/* Filter chips */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={w.chipsRow}>
              {CHIPS.map(chip => (
                <Pressable
                  key={chip}
                  style={[w.chip, activeChip === chip && w.chipActive]}
                  onPress={() => setActiveChip(prev => prev === chip ? null : chip)}
                >
                  <Text style={[w.chipTxt, activeChip === chip && w.chipTxtActive]}>{chip}</Text>
                </Pressable>
              ))}
            </ScrollView>

            {/* Cards */}
            {loading ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 }}>
                <ActivityIndicator color="#7c3aed" size="large" />
                <Text style={{ color: '#475569', fontSize: 13 }}>Cargando peticiones…</Text>
              </View>
            ) : (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
                {filtered.length === 0 && (
                  <View style={{ paddingTop: 48, alignItems: 'center', gap: 10 }}>
                    <Ionicons name="checkmark-circle-outline" size={44} color="#1e293b" />
                    <Text style={{ color: '#334155', fontSize: 14 }}>Sin peticiones en esta vista</Text>
                  </View>
                )}
                {filtered.map(item => {
                  const isHov = hoveredId === item.id;
                  const isSel = selected?.id === item.id;
                  const catColor = CAT_COLORS[item.category ?? ''] ?? '#7c3aed';
                  const assignName = item.assigned_profile?.full_name ?? localAssign[item.id] ?? null;
                  return (
                    <Pressable
                      key={item.id}
                      style={[w.card, item.urgent && w.cardUrgent, isSel && w.cardSelected, isHov && !isSel && w.cardHover]}
                      onPress={() => selectRequest(item)}
                      onHoverIn={() => setHoveredId(item.id)}
                      onHoverOut={() => setHoveredId(null)}
                    >
                      <View style={w.cardRow}>
                        <Text style={w.cardName}>
                          {item.title ?? 'Anónimo'} {toFlag(item.country_code)}
                        </Text>
                        <Text style={w.cardTime}>{timeAgo(item.created_at)}</Text>
                      </View>
                      <View style={[w.cardRow, { marginBottom: 8 }]}>
                        <View style={[w.badge, { backgroundColor: catColor + '22', borderColor: catColor + '55' }]}>
                          <Text style={[w.badgeTxt, { color: catColor }]}>
                            {item.category ? item.category.charAt(0).toUpperCase() + item.category.slice(1) : 'Otro'}
                          </Text>
                        </View>
                        {item.urgent && (
                          <View style={w.urgentBadge}><Text style={w.urgentTxt}>⚡ URGENTE</Text></View>
                        )}
                      </View>
                      <Text style={w.cardExcerpt}>{item.content}</Text>
                      <View style={[w.cardRow, { marginTop: 10 }]}>
                        {assignName ? (
                          <View style={w.assignedRow}>
                            <View style={w.assignedAvatar}>
                              <Text style={w.assignedAvatarTxt}>{getInitials(assignName)}</Text>
                            </View>
                            <Text style={w.assignedName}>{assignName}</Text>
                          </View>
                        ) : (
                          <Text style={w.unassigned}>Sin asignar</Text>
                        )}
                        {isHov && (
                          <View style={w.hoverActions}>
                            <Pressable style={[w.hoverBtn, { backgroundColor: '#7c3aed' }]}
                              onPress={() => selectRequest(item)}>
                              <Text style={w.hoverBtnTxt}>Asignar</Text>
                            </Pressable>
                            <Pressable style={[w.hoverBtn, { backgroundColor: '#1e3a5f' }]}
                              onPress={() => updateStatus(item.id, 'in_battle')}>
                              <Text style={w.hoverBtnTxt}>En Batalla</Text>
                            </Pressable>
                            <Pressable style={[w.hoverBtn, { backgroundColor: '#78350f' }]}
                              onPress={() => updateStatus(item.id, 'victory')}>
                              <Text style={w.hoverBtnTxt}>Victoria</Text>
                            </Pressable>
                            {item.content.includes('wa.me') && (
                              <Pressable style={[w.hoverBtn, { backgroundColor: '#14532d' }]}
                                onPress={() => Linking.openURL('https://wa.me/')}>
                                <Text style={w.hoverBtnTxt}>WhatsApp</Text>
                              </Pressable>
                            )}
                          </View>
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </ScrollView>
            )}
          </View>

          {/* ── Detail / New Form panel ── */}
          <View style={w.detail}>
            {/* NEW PRAYER FORM */}
            {showNewForm ? (
              <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
                <View style={[w.cardRow, { marginBottom: 20 }]}>
                  <Text style={w.detailName}>Nueva Petición</Text>
                  <Pressable onPress={() => setShowNewForm(false)}>
                    <Ionicons name="close" size={20} color="#475569" />
                  </Pressable>
                </View>

                <Text style={w.sectionLbl}>NOMBRE DEL SOLICITANTE</Text>
                <TextInput
                  style={[w.formInput as any, { marginBottom: 16 }]}
                  placeholder="Ej. María González"
                  placeholderTextColor="#475569"
                  value={newName}
                  onChangeText={setNewName}
                />

                <Text style={w.sectionLbl}>PAÍS (código ISO)</Text>
                <TextInput
                  style={[w.formInput as any, { marginBottom: 16 }]}
                  placeholder="CO, MX, PE…"
                  placeholderTextColor="#475569"
                  value={newCountry}
                  onChangeText={t => setNewCountry(t.toUpperCase().slice(0, 2))}
                  maxLength={2}
                  autoCapitalize="characters"
                />

                <Text style={w.sectionLbl}>CATEGORÍA</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                  {NEW_CATS.map(cat => (
                    <Pressable
                      key={cat}
                      style={[w.catPill, newCat === cat && w.catPillActive]}
                      onPress={() => setNewCat(cat)}
                    >
                      <Text style={[w.catPillTxt, newCat === cat && { color: '#fff' }]}>
                        {cat.charAt(0).toUpperCase() + cat.slice(1)}
                      </Text>
                    </Pressable>
                  ))}
                </View>

                <View style={[w.cardRow, { marginBottom: 16 }]}>
                  <Text style={[w.sectionLbl, { marginBottom: 0 }]}>¿URGENTE?</Text>
                  <Switch
                    value={newUrgent}
                    onValueChange={setNewUrgent}
                    trackColor={{ false: '#1e293b', true: '#7c3aed' }}
                    thumbColor={newUrgent ? '#a78bfa' : '#475569'}
                  />
                </View>

                <Text style={w.sectionLbl}>PETICIÓN</Text>
                <TextInput
                  style={[w.noteInput as any, { minHeight: 120, marginBottom: 16 }]}
                  placeholder="Describe la situación…"
                  placeholderTextColor="#475569"
                  value={newContent}
                  onChangeText={setNewContent}
                  multiline
                  textAlignVertical="top"
                />

                {submitErr ? <Text style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>{submitErr}</Text> : null}

                <Pressable style={[w.victoriaBtn, { backgroundColor: '#7c3aed' }]} onPress={handleSubmitNew} disabled={submitting}>
                  {submitting
                    ? <ActivityIndicator color="#fff" />
                    : <Text style={[w.victoriaTxt, { color: '#fff' }]}>Agregar al War Room</Text>}
                </Pressable>
              </ScrollView>

            ) : !selected ? (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                <Ionicons name="hand-left-outline" size={40} color="#334155" />
                <Text style={w.detailEmpty}>Selecciona una petición</Text>
              </View>

            ) : (
              /* DETAIL VIEW */
              <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
                <View style={[w.cardRow, { marginBottom: 4 }]}>
                  <Text style={w.detailName}>{selected.title ?? 'Anónimo'} {toFlag(selected.country_code)}</Text>
                  <Pressable onPress={() => setSelected(null)}>
                    <Ionicons name="close" size={20} color="#475569" />
                  </Pressable>
                </View>

                <View style={[w.cardRow, { marginBottom: 16 }]}>
                  <View style={[w.badge, { backgroundColor: selectedCatColor + '22' }]}>
                    <Text style={[w.badgeTxt, { color: selectedCatColor }]}>
                      {selected.category ? selected.category.charAt(0).toUpperCase() + selected.category.slice(1) : 'Otro'}
                    </Text>
                  </View>
                  {selected.urgent && <View style={w.urgentBadge}><Text style={w.urgentTxt}>⚡ URGENTE</Text></View>}
                </View>

                <View style={w.prayerBox}>
                  <Text style={w.prayerTxt}>{selected.content}</Text>
                </View>

                <Text style={w.sectionLbl}>ESTADO</Text>
                <View style={w.stepper}>
                  {(['Entrante', 'En Batalla', 'Victoria'] as const).map((step, idx) => (
                    <React.Fragment key={step}>
                      <View style={{ alignItems: 'center', gap: 4 }}>
                        <View style={[w.stepDot, statusStep >= idx && w.stepDotActive]}>
                          {statusStep >= idx && <Ionicons name="checkmark" size={10} color="#fff" />}
                        </View>
                        <Text style={[w.stepLbl, statusStep >= idx && w.stepLblActive]}>{step}</Text>
                      </View>
                      {idx < 2 && <View style={[w.stepLine, statusStep > idx && { backgroundColor: '#7c3aed' }]} />}
                    </React.Fragment>
                  ))}
                </View>

                <Text style={w.sectionLbl}>INTERCESOR ASIGNADO</Text>
                {(selected.assigned_profile?.full_name ?? localAssign[selected.id]) ? (
                  <View style={w.assignedBig}>
                    <View style={w.assignedAvatarBig}>
                      <Text style={w.assignedAvatarTxt}>
                        {getInitials(selected.assigned_profile?.full_name ?? localAssign[selected.id]!)}
                      </Text>
                    </View>
                    <Text style={{ color: '#e2e8f0', fontSize: 15, flex: 1 }}>
                      {selected.assigned_profile?.full_name ?? localAssign[selected.id]}
                    </Text>
                    <Pressable style={w.contactBtn} onPress={() => Linking.openURL('https://wa.me/')}>
                      <Text style={{ color: '#a78bfa', fontSize: 13, fontWeight: '600' }}>Contactar</Text>
                    </Pressable>
                  </View>
                ) : (
                  <TextInput
                    style={w.interInput as any}
                    placeholder="Nombre del intercesor…"
                    placeholderTextColor="#475569"
                    value={interSearch}
                    onChangeText={setInterSearch}
                    onSubmitEditing={() => {
                      if (interSearch.trim()) {
                        setLocalAssign(prev => ({ ...prev, [selected.id]: interSearch.trim() }));
                        setInterSearch('');
                      }
                    }}
                  />
                )}

                <Text style={[w.sectionLbl, { marginTop: 20 }]}>NOTA PASTORAL</Text>
                <TextInput
                  style={w.noteInput as any}
                  placeholder="Añade una nota privada…"
                  placeholderTextColor="#475569"
                  value={note}
                  onChangeText={setNote}
                  multiline
                  textAlignVertical="top"
                />
                <Pressable
                  style={[w.saveNoteBtn, noteSaving && { opacity: 0.6 }]}
                  onPress={handleSaveNote}
                  disabled={noteSaving}
                >
                  <Text style={w.saveNoteTxt}>{noteSaving ? 'Guardando…' : 'Guardar nota'}</Text>
                </Pressable>

                {/* WhatsApp — first action */}
                <Pressable style={w.whatsappBtn} onPress={() => Linking.openURL('https://wa.me/')}>
                  <Text style={w.whatsappTxt}>📲 Contactar por WhatsApp</Text>
                </Pressable>

                {/* Marcar Victoria */}
                <Pressable
                  style={[w.victoriaBtn, selected.status === 'victory' && { backgroundColor: '#334155' }]}
                  onPress={() => updateStatus(selected.id, selected.status === 'victory' ? 'incoming' : 'victory')}
                >
                  <Text style={w.victoriaTxt}>
                    {selected.status === 'victory' ? 'Regresar a Bandeja' : 'Marcar Victoria 🏆'}
                  </Text>
                </Pressable>
              </ScrollView>
            )}
          </View>

        </View>
        )}
      </View>
    </View>
  );
}

// ─────────────────────────────────────────────────────────────
//  MOBILE TYPES + CONSTANTS  (unchanged)
// ─────────────────────────────────────────────────────────────
type ViewMode    = 'personal' | 'family' | 'dashboard';
type CrisisFilter = 'all' | 'Salud' | 'Finanzas' | 'urgent';

const CRISIS_FILTERS: { id: CrisisFilter; label: string; icon: string; color: string }[] = [
  { id: 'all',      label: 'Todos',    icon: 'view-grid',      color: '#475569' },
  { id: 'Salud',    label: 'Salud',    icon: 'heart-pulse',    color: '#DC2626' },
  { id: 'Finanzas', label: 'Finanzas', icon: 'briefcase',      color: '#2563EB' },
  { id: 'urgent',   label: 'Crisis',   icon: 'alarm-light',    color: '#EF4444' },
];

// ─────────────────────────────────────────────────────────────
//  HOME SCREEN  (mobile layout — unchanged)
// ─────────────────────────────────────────────────────────────
export default function HomeScreen() {
  // Web branch — renders full CRM, skips all mobile code
  if (Platform.OS === 'web') return <WebCRM />;

  const [user, setUser] = useState<User | null>(null);
  const [prayers, setPrayers] = useState<Prayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<'active' | 'answered'>('active');
  const [viewMode, setViewMode] = useState<ViewMode>('personal');
  const [selectedPrayer, setSelectedPrayer] = useState<Prayer | null>(null);
  const [isFormVisible, setFormVisible] = useState(false);
  const [appLang, setAppLang] = useState<'es' | 'en'>('es');
  const [isSpeaking, setIsSpeaking] = useState(false);

  // Dashboard pastoral
  const [crisisFilter, setCrisisFilter] = useState<CrisisFilter>('all');
  const [trendInsight, setTrendInsight] = useState<TrendInsight | null>(null);
  const [trendLoading, setTrendLoading] = useState(false);
  const [isTrendModalVisible, setTrendModalVisible] = useState(false);

  const t = TEXTS[appLang];
  const authorName = user?.email?.split('@')[0] ?? 'Pastor';
  const familyId = (user?.user_metadata?.family_id as string) ?? 'familia_martinez';
  const isPastor = viewMode === 'dashboard';

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setUser(user));
  }, []);

  const loadPrayers = async () => {
    setLoading(true);
    try {
      const data = viewMode === 'dashboard'
        ? await fetchAllPrayersForPastor()
        : await fetchPrayers(viewMode, familyId);
      setPrayers(data);
    } catch (error) {
      console.error('Error cargando peticiones:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (user) loadPrayers();
  }, [viewMode, user]);

  const applycrisisFilter = (p: Prayer): boolean => {
    if (crisisFilter === 'all') return true;
    if (crisisFilter === 'Salud') return p.category === 'Salud';
    if (crisisFilter === 'Finanzas') return p.category === 'Negocios';
    if (crisisFilter === 'urgent') return p.special_mode === 'urgent';
    return true;
  };

  const stats = {
    total: prayers.length,
    crisis: prayers.filter(p => p.special_mode === 'urgent' || p.category === 'Salud').length,
    newThisWeek: prayers.filter(p => {
      const days = (Date.now() - new Date(p.created_at).getTime()) / 86400000;
      return days <= 7;
    }).length,
    byCategory: Object.keys(CATEGORIES).map(cat => ({
      cat,
      count: prayers.filter(p => p.category === cat).length,
    })).sort((a, b) => b.count - a.count),
  };

  const handleAnalyzeTrends = async () => {
    if (prayers.length === 0) {
      Alert.alert('Sin datos', 'No hay peticiones activas para analizar.');
      return;
    }
    setTrendLoading(true);
    setTrendModalVisible(true);
    try {
      const insight = await analyzeTrends(prayers, appLang);
      setTrendInsight(insight);
    } catch (error) {
      console.error('[Victoria Pastoral]', error);
      Alert.alert('Error', 'Victoria no pudo generar el análisis. Verifica la conexión.');
      setTrendModalVisible(false);
    } finally {
      setTrendLoading(false);
    }
  };

  const handleToggleStatus = async (id: number) => {
    const prayer = prayers.find(p => p.id === id);
    if (!prayer) return;
    const newStatus = prayer.status === 'active' ? 'answered' : 'active';
    setPrayers(current => current.map(p => p.id === id ? { ...p, status: newStatus } : p));
    if (newStatus === 'answered' && selectedPrayer?.id === id) setSelectedPrayer(null);
    try {
      await updatePrayerStatus(id, newStatus);
    } catch {
      loadPrayers();
    }
  };

  const handleDeletePrayer = (id: number) => {
    Alert.alert(
      'Eliminar Petición',
      '¿Estás seguro? Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setPrayers(current => current.filter(p => p.id !== id));
            setSelectedPrayer(null);
            try {
              await deletePrayer(id);
            } catch {
              Alert.alert('Error', 'No se pudo eliminar la petición.');
              loadPrayers();
            }
          },
        },
      ]
    );
  };

  const speakPrayer = (prayer: Prayer) => {
    if (isSpeaking) { Speech.stop(); setIsSpeaking(false); return; }
    if (!prayer.long_prayer && !prayer.verse_text) {
      Alert.alert('Error de Audio', 'No hay texto para leer.');
      return;
    }
    setIsSpeaking(true);
    Speech.speak(`Situación: ${prayer.title}. La palabra dice: ${prayer.verse_text}. Oración: ${prayer.long_prayer}`, {
      language: prayer.lang === 'en' ? 'en-US' : 'es-ES',
      rate: 0.9,
      onDone: () => setIsSpeaking(false),
      onStopped: () => setIsSpeaking(false),
      onError: () => setIsSpeaking(false),
    });
  };

  useEffect(() => {
    if (!selectedPrayer) { Speech.stop(); setIsSpeaking(false); }
  }, [selectedPrayer]);

  const PrayerCard = ({ item }: { item: Prayer }) => {
    const theme = CATEGORIES[item.category] || CATEGORIES['Negocios'];
    const mode = SPECIAL_MODES.find(m => m.id === item.special_mode) || SPECIAL_MODES[0];
    const itemLang = TEXTS[item.lang || 'es'];
    return (
      <TouchableOpacity style={styles.card} activeOpacity={0.9} onPress={() => setSelectedPrayer(item)}>
        <View style={styles.cardHeader}>
          <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
            <View style={[styles.categoryBadge, { backgroundColor: theme.bg }]}>
              <MaterialCommunityIcons name={theme.icon as any} size={14} color={theme.color} />
              <Text style={[styles.categoryText, { color: theme.color }]}>{itemLang.cats[item.category]}</Text>
            </View>
            {item.author_name && (
              <View style={styles.sharedBadge}>
                <Ionicons name="person" size={12} color="#64748B" />
                <Text style={styles.sharedText}>{item.author_name}</Text>
              </View>
            )}
          </View>
          {mode.id !== 'none' && (
            <View style={[styles.modeBadge, { backgroundColor: mode.color + '20' }]}>
              <MaterialCommunityIcons name={mode.icon as any} size={16} color={mode.color} />
            </View>
          )}
        </View>
        <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.versePreview} numberOfLines={1}>
          <Text style={{ fontWeight: '700' }}>{item.verse}</Text>
          <Text style={{ fontSize: 10, color: '#94A3B8' }}> ({item.bible_version})</Text>
        </Text>
        {item.status === 'active' && !isPastor && (
          <TouchableOpacity style={styles.quickWinBtn} onPress={() => handleToggleStatus(item.id)}>
            <MaterialCommunityIcons name="checkbox-blank-circle-outline" size={20} color="#CBD5E1" />
            <Text style={styles.quickWinText}>{itemLang.detail.btnVictory}</Text>
          </TouchableOpacity>
        )}
      </TouchableOpacity>
    );
  };

  const currentTheme = selectedPrayer ? CATEGORIES[selectedPrayer.category] : CATEGORIES['Negocios'];
  const filteredPrayers = isPastor
    ? prayers.filter(applycrisisFilter)
    : prayers.filter(p => p.status === activeTab);

  const DashboardHeader = () => (
    <View style={styles.dashboardContainer}>
      <View style={styles.statsRow}>
        <View style={[styles.statCard, { borderLeftColor: '#2563EB' }]}>
          <Text style={styles.statNumber}>{stats.total}</Text>
          <Text style={styles.statLabel}>Activas</Text>
        </View>
        <View style={[styles.statCard, { borderLeftColor: '#EF4444' }]}>
          <Text style={[styles.statNumber, { color: '#EF4444' }]}>{stats.crisis}</Text>
          <Text style={styles.statLabel}>Crisis</Text>
        </View>
        <View style={[styles.statCard, { borderLeftColor: '#10B981' }]}>
          <Text style={[styles.statNumber, { color: '#10B981' }]}>{stats.newThisWeek}</Text>
          <Text style={styles.statLabel}>Esta semana</Text>
        </View>
      </View>

      <View style={styles.categoryBar}>
        {stats.byCategory.filter(c => c.count > 0).map(({ cat, count }) => {
          const theme = CATEGORIES[cat];
          const pct = stats.total > 0 ? (count / stats.total) * 100 : 0;
          return (
            <View key={cat} style={[styles.categoryBarSegment, { flex: count, backgroundColor: theme.color }]}>
              {pct >= 15 && <Text style={styles.categoryBarLabel}>{count}</Text>}
            </View>
          );
        })}
      </View>
      <View style={styles.categoryLegend}>
        {stats.byCategory.filter(c => c.count > 0).map(({ cat }) => (
          <View key={cat} style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: CATEGORIES[cat].color }]} />
            <Text style={styles.legendText}>{cat}</Text>
          </View>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.crisisFilters}>
        {CRISIS_FILTERS.map(f => (
          <TouchableOpacity
            key={f.id}
            style={[styles.crisisChip, crisisFilter === f.id && { backgroundColor: f.color, borderColor: f.color }]}
            onPress={() => setCrisisFilter(f.id)}
          >
            <MaterialCommunityIcons name={f.icon as any} size={14} color={crisisFilter === f.id ? '#fff' : f.color} />
            <Text style={[styles.crisisChipText, crisisFilter === f.id && { color: '#fff' }]}>{f.label}</Text>
            {f.id !== 'all' && (
              <Text style={[styles.crisisChipCount, crisisFilter === f.id && { color: '#fff' }]}>
                {f.id === 'Salud' ? prayers.filter(p => p.category === 'Salud').length
                  : f.id === 'Finanzas' ? prayers.filter(p => p.category === 'Negocios').length
                  : prayers.filter(p => p.special_mode === 'urgent').length}
              </Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>

      <TouchableOpacity style={styles.victoriaButton} onPress={handleAnalyzeTrends} disabled={trendLoading}>
        <MaterialCommunityIcons name="chart-timeline-variant" size={20} color="#fff" />
        <Text style={styles.victoriaButtonText}>Victoria: Analizar Tendencias</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>
            {isPastor ? 'Pastor Edition' : 'My War Room'}
          </Text>
          <Text style={styles.headerUser}>{user?.email ?? ''}</Text>
          <View style={styles.spaceSelector}>
            <TouchableOpacity
              onPress={() => setViewMode('personal')}
              style={[styles.spaceBtn, viewMode === 'personal' && styles.spaceBtnActive]}
            >
              <Text style={[styles.spaceText, viewMode === 'personal' && { color: '#fff' }]}>🔒 Personal</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode('family')}
              style={[styles.spaceBtn, viewMode === 'family' && styles.spaceBtnActive]}
            >
              <Text style={[styles.spaceText, viewMode === 'family' && { color: '#fff' }]}>👨‍👩‍👧‍👦 Familia</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => setViewMode('dashboard')}
              style={[styles.spaceBtn, styles.spaceBtnPastor, viewMode === 'dashboard' && styles.spaceBtnPastorActive]}
            >
              <Text style={[styles.spaceText, viewMode === 'dashboard' && { color: '#fff' }]}>⛪ Pastor</Text>
            </TouchableOpacity>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {!isPastor && (
            <TouchableOpacity style={styles.addButton} onPress={() => setFormVisible(true)}>
              <Ionicons name="add" size={28} color="#fff" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.logoutButton} onPress={() => supabase.auth.signOut()}>
            <Ionicons name="log-out-outline" size={22} color="#64748B" />
          </TouchableOpacity>
        </View>
      </View>

      {!isPastor && (
        <View style={styles.tabsContainer}>
          <TouchableOpacity style={[styles.tab, activeTab === 'active' && styles.activeTab]} onPress={() => setActiveTab('active')}>
            <Text style={[styles.tabText, activeTab === 'active' && styles.activeTabText]}>
              {t.tabs.battle} ({prayers.filter(p => p.status === 'active').length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.tab, activeTab === 'answered' && styles.activeTab]} onPress={() => setActiveTab('answered')}>
            <Text style={[styles.tabText, activeTab === 'answered' && styles.activeTabText]}>
              {t.tabs.victory} ({prayers.filter(p => p.status === 'answered').length})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {loading
        ? <ActivityIndicator style={{ marginTop: 50 }} size="large" color="#2563EB" />
        : (
          <FlatList
            data={filteredPrayers}
            keyExtractor={item => item.id.toString()}
            renderItem={({ item }) => <PrayerCard item={item} />}
            contentContainerStyle={styles.listContent}
            ListHeaderComponent={isPastor ? <DashboardHeader /> : null}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadPrayers(); }} />}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                {isPastor ? 'No hay peticiones activas en la congregación.' : 'No hay peticiones en este espacio.'}
              </Text>
            }
          />
        )
      }

      {!isPastor && (
        <PrayerForm
          visible={isFormVisible}
          onClose={() => setFormVisible(false)}
          onSaved={() => { setFormVisible(false); loadPrayers(); }}
          familyId={familyId}
          authorName={authorName}
          appLang={appLang}
        />
      )}

      <Modal visible={isTrendModalVisible} animationType="slide" presentationStyle="pageSheet">
        <SafeAreaView style={styles.trendModal}>
          <View style={styles.trendModalHeader}>
            <View>
              <Text style={styles.trendModalTitle}>Informe Pastoral</Text>
              <Text style={styles.trendModalSubtitle}>Análisis de Victoria</Text>
            </View>
            <TouchableOpacity onPress={() => { setTrendModalVisible(false); setTrendInsight(null); }}>
              <Ionicons name="close" size={28} color="#1E293B" />
            </TouchableOpacity>
          </View>

          {trendLoading && (
            <View style={styles.trendLoadingBox}>
              <ActivityIndicator size="large" color="#7C3AED" />
              <Text style={styles.trendLoadingText}>Victoria está analizando la congregación...</Text>
            </View>
          )}

          {trendInsight && !trendLoading && (
            <ScrollView contentContainerStyle={styles.trendContent}>
              <View style={styles.trendStatsRow}>
                <View style={[styles.trendStat, { borderColor: '#2563EB' }]}>
                  <Text style={[styles.trendStatNum, { color: '#2563EB' }]}>{trendInsight.topAreaCount}</Text>
                  <Text style={styles.trendStatLabel}>{trendInsight.topArea}</Text>
                </View>
                <View style={[styles.trendStat, { borderColor: '#EF4444' }]}>
                  <Text style={[styles.trendStatNum, { color: '#EF4444' }]}>{trendInsight.crisisCount}</Text>
                  <Text style={styles.trendStatLabel}>En crisis</Text>
                </View>
                <View style={[styles.trendStat, { borderColor: '#10B981' }]}>
                  <Text style={[styles.trendStatNum, { color: '#10B981' }]}>{trendInsight.newThisWeek}</Text>
                  <Text style={styles.trendStatLabel}>Esta semana</Text>
                </View>
              </View>
              <View style={styles.trendSection}>
                <Text style={styles.trendSectionTitle}>TENDENCIA SEMANAL</Text>
                <Text style={styles.trendBody}>{trendInsight.weeklyTrend}</Text>
              </View>
              <View style={styles.trendSection}>
                <Text style={styles.trendSectionTitle}>RECOMENDACIONES PASTORALES</Text>
                {trendInsight.recommendations.map((rec, i) => (
                  <View key={i} style={styles.recommendationRow}>
                    <View style={styles.recommendationBullet}>
                      <Text style={styles.recommendationBulletText}>{i + 1}</Text>
                    </View>
                    <Text style={styles.recommendationText}>{rec}</Text>
                  </View>
                ))}
              </View>
              <View style={styles.pastoralVerse}>
                <MaterialCommunityIcons name="star-four-points" size={16} color="#7C3AED" />
                <Text style={styles.pastoralVerseRef}> {trendInsight.pastoralVerse}</Text>
                <Text style={styles.pastoralVerseText}>"{trendInsight.pastoralVerseText}"</Text>
              </View>
            </ScrollView>
          )}
        </SafeAreaView>
      </Modal>

      <Modal visible={selectedPrayer !== null} animationType="slide" onRequestClose={() => setSelectedPrayer(null)}>
        {selectedPrayer && (
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setSelectedPrayer(null)}>
                <Ionicons name="close" size={28} color="#333" />
              </TouchableOpacity>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity onPress={() => speakPrayer(selectedPrayer)} style={styles.iconBtn}>
                  <Ionicons name={isSpeaking ? 'stop-circle' : 'volume-high'} size={26} color="#2563EB" />
                </TouchableOpacity>
                <TouchableOpacity onPress={() => Share.share({ message: `🔥 ${selectedPrayer.title}\n📖 ${selectedPrayer.verse_text}\n🙏 ${selectedPrayer.long_prayer}` })} style={styles.iconBtn}>
                  <Ionicons name="share-outline" size={26} color="#2563EB" />
                </TouchableOpacity>
                {!isPastor && (
                  <TouchableOpacity onPress={() => handleDeletePrayer(selectedPrayer.id)} style={styles.iconBtn}>
                    <Ionicons name="trash-outline" size={26} color="#EF4444" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
            <ScrollView contentContainerStyle={styles.modalScroll}>
              <Text style={styles.modalTitle}>{selectedPrayer.title}</Text>
              <View style={[styles.scriptureBox, { borderLeftColor: currentTheme.color }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 10 }}>
                  <Text style={[styles.scriptureRef, { color: currentTheme.color }]}>{selectedPrayer.verse}</Text>
                  <Text style={{ fontSize: 12, color: '#94A3B8', fontWeight: '600' }}>{selectedPrayer.bible_version}</Text>
                </View>
                <Text style={styles.scriptureText}>"{selectedPrayer.verse_text}"</Text>
              </View>
              <Text style={styles.meditationLabel}>{TEXTS[selectedPrayer.lang || 'es'].detail.meditationLabel}</Text>
              <Text style={styles.meditationText}>{selectedPrayer.long_prayer}</Text>
            </ScrollView>
            {!isPastor && (
              <View style={styles.modalFooter}>
                <TouchableOpacity
                  style={[styles.bigSuccessButton, selectedPrayer.status === 'answered' && { backgroundColor: '#64748B' }]}
                  onPress={() => handleToggleStatus(selectedPrayer.id)}
                >
                  <Text style={styles.bigButtonText}>
                    {selectedPrayer.status === 'active'
                      ? TEXTS[selectedPrayer.lang || 'es'].detail.btnVictory
                      : TEXTS[selectedPrayer.lang || 'es'].detail.btnReturn}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}
      </Modal>
    </SafeAreaView>
  );
}

// ─────────────────────────────────────────────────────────────
//  WEB STYLES
// ─────────────────────────────────────────────────────────────
const w = StyleSheet.create({
  root:    { flex: 1, flexDirection: 'row', backgroundColor: '#020617', height: '100vh' as any },

  // Sidebar
  sidebar:         { width: 240, backgroundColor: '#0f0f1a', borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.06)', padding: 20, paddingTop: 24 },
  sidebarBrand:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 24 },
  sidebarBrandTxt: { fontSize: 18, fontFamily: 'serif', fontWeight: '700', color: '#fff' },
  pastorRow:       { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 },
  pastorAvatar:    { width: 36, height: 36, borderRadius: 18, backgroundColor: '#1e1b4b', alignItems: 'center', justifyContent: 'center' },
  pastorAvatarTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  pastorName:      { color: '#e2e8f0', fontSize: 13, fontWeight: '600' },
  pastorSub:       { color: '#475569', fontSize: 11, marginTop: 2 },
  sidebarDivider:  { height: 1, backgroundColor: 'rgba(255,255,255,0.06)', marginBottom: 8 },

  navItem:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, marginBottom: 2 },
  navItemActive: { backgroundColor: '#1e1b4b' },
  navLabel:      { flex: 1, fontSize: 14, color: '#475569', fontWeight: '500' },
  navLabelActive:{ color: '#e2e8f0', fontWeight: '600' },
  navBadge:      { backgroundColor: '#1e1b4b', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2 },
  navBadgeTxt:   { color: '#a78bfa', fontSize: 11, fontWeight: '700' },

  modoHoyRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12 },
  modoHoyTxt:    { flex: 1, fontSize: 13, color: '#475569' },
  toggle:        { width: 36, height: 20, borderRadius: 10, backgroundColor: '#1e293b', justifyContent: 'center', paddingHorizontal: 3 },
  toggleOn:      { backgroundColor: '#7c3aed' },
  toggleThumb:   { width: 14, height: 14, borderRadius: 7, backgroundColor: '#475569' },
  toggleThumbOn: { backgroundColor: '#fff', alignSelf: 'flex-end' },
  signOutBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10 },
  signOutTxt:    { fontSize: 13, color: '#475569' },

  // Stats bar
  statsBar:  { flexDirection: 'row', gap: 8, padding: 16, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  statCard:  { flex: 1, backgroundColor: '#0f0f1a', borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 16 },
  statNum:   { fontSize: 28, fontWeight: '600' },
  statLbl:   { fontSize: 11, color: '#475569', marginTop: 4 },

  // Columns
  columns:   { flex: 1, flexDirection: 'row' },

  // Feed
  feed:      { flex: 1, borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.06)' },
  feedTopBar:{ flexDirection: 'row', alignItems: 'center', gap: 10, margin: 16 },
  newBtn:    { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#7c3aed', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  newBtnTxt: { color: '#fff', fontSize: 13, fontWeight: '600' },
  searchBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#0f0f1a', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 12, paddingHorizontal: 12, height: 40 },
  searchInput:{ flex: 1, color: '#e2e8f0', fontSize: 14 },
  chipsRow:  { paddingHorizontal: 16, marginBottom: 4 },
  chip:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 99, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', backgroundColor: '#0f0f1a', marginRight: 8 },
  chipActive:{ backgroundColor: '#1e1b4b', borderColor: '#7c3aed' },
  chipTxt:   { fontSize: 12, color: '#475569' },
  chipTxtActive: { color: '#a78bfa' },

  // Cards
  card:        { backgroundColor: '#0f0f1a', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)' },
  cardUrgent:  { borderColor: 'rgba(251,146,60,0.3)' },
  cardHover:   { borderColor: 'rgba(255,255,255,0.12)', backgroundColor: '#111827' },
  cardSelected:{ borderColor: '#7c3aed', borderWidth: 2 },
  cardRow:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  cardName:    { color: '#fff', fontSize: 15, fontWeight: '500' },
  cardTime:    { color: '#475569', fontSize: 12 },
  badge:       { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  badgeTxt:    { fontSize: 11, fontWeight: '600' },
  urgentBadge: { backgroundColor: 'rgba(251,146,60,0.15)', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  urgentTxt:   { color: '#fb923c', fontSize: 11, fontWeight: '700' },
  cardExcerpt: { color: '#94a3b8', fontSize: 13, lineHeight: 20 },
  assignedRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  assignedAvatar:    { width: 22, height: 22, borderRadius: 11, backgroundColor: '#1e1b4b', alignItems: 'center', justifyContent: 'center' },
  assignedAvatarTxt: { color: '#a78bfa', fontSize: 9, fontWeight: '700' },
  assignedName:      { color: '#64748b', fontSize: 12 },
  unassigned:        { color: '#334155', fontSize: 12 },
  hoverActions:  { flexDirection: 'row', gap: 6, marginLeft: 'auto' as any },
  hoverBtn:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  hoverBtnTxt:   { color: '#fff', fontSize: 12, fontWeight: '500' },

  // Detail panel
  detail:      { width: 320, backgroundColor: '#0f0f1a', borderLeftWidth: 1, borderLeftColor: 'rgba(255,255,255,0.06)' },
  detailEmpty: { color: '#334155', fontSize: 15, marginTop: 12 },
  detailName:  { color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 },
  prayerBox:   { backgroundColor: '#020617', borderRadius: 12, padding: 16, marginBottom: 20 },
  prayerTxt:   { color: '#94a3b8', fontSize: 14, lineHeight: 22 },
  sectionLbl:  { fontSize: 10, fontWeight: '700', color: '#334155', letterSpacing: 1, marginBottom: 10 },

  stepper:     { flexDirection: 'row', alignItems: 'center', marginBottom: 24 },
  stepDot:     { width: 24, height: 24, borderRadius: 12, backgroundColor: '#1e1b4b', alignItems: 'center', justifyContent: 'center' },
  stepDotActive: { backgroundColor: '#7c3aed' },
  stepLbl:     { fontSize: 10, color: '#334155', textAlign: 'center', marginTop: 4, maxWidth: 56 },
  stepLblActive: { color: '#a78bfa' },
  stepLine:    { flex: 1, height: 2, backgroundColor: '#1e1b4b', marginBottom: 14 },

  assignedBig:    { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#020617', borderRadius: 10, padding: 10, marginBottom: 16 },
  assignedAvatarBig: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#1e1b4b', alignItems: 'center', justifyContent: 'center' },
  contactBtn:     { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: '#1e1b4b' },
  formInput:      { backgroundColor: '#020617', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, color: '#e2e8f0', fontSize: 14 },
  interInput:     { backgroundColor: '#020617', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: '#e2e8f0', fontSize: 14, marginBottom: 16 },
  noteInput:      { backgroundColor: '#020617', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: 12, color: '#e2e8f0', fontSize: 14, minHeight: 80, marginBottom: 20 },

  catPill:      { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', backgroundColor: '#0f0f1a' },
  catPillActive:{ backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  catPillTxt:   { fontSize: 13, color: '#64748b', fontWeight: '500' },
  saveNoteBtn:  { backgroundColor: '#1e1b4b', borderRadius: 10, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  saveNoteTxt:  { color: '#a78bfa', fontSize: 14, fontWeight: '600' },
  whatsappBtn:  { backgroundColor: 'rgba(37,211,102,0.1)', borderWidth: 1, borderColor: 'rgba(37,211,102,0.3)', borderRadius: 12, height: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  whatsappTxt:  { color: '#4ade80', fontSize: 15, fontWeight: '600' },
  victoriaBtn:  { backgroundColor: '#92400e', borderRadius: 12, height: 52, alignItems: 'center', justifyContent: 'center' },
  victoriaTxt:  { color: '#fbbf24', fontSize: 16, fontWeight: '600' },
});

// ─────────────────────────────────────────────────────────────
//  MOBILE STYLES  (unchanged from original)
// ─────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:          { flex: 1, backgroundColor: '#F8FAFC' },
  header:             { paddingHorizontal: 20, paddingVertical: 15, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', marginTop: 30 },
  headerTitle:        { fontSize: 20, fontWeight: '800', color: '#1E293B' },
  headerUser:         { fontSize: 11, color: '#94A3B8', marginTop: 1 },
  spaceSelector:      { flexDirection: 'row', marginTop: 5, backgroundColor: '#F1F5F9', borderRadius: 8, padding: 2 },
  spaceBtn:           { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  spaceBtnActive:     { backgroundColor: '#1E293B' },
  spaceBtnPastor:     { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  spaceBtnPastorActive: { backgroundColor: '#7C3AED' },
  spaceText:          { fontSize: 12, fontWeight: '600', color: '#64748B' },
  addButton:          { backgroundColor: '#1E293B', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  logoutButton:       { backgroundColor: '#F1F5F9', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  tabsContainer:      { flexDirection: 'row', margin: 20, backgroundColor: '#E2E8F0', borderRadius: 12, padding: 4 },
  tab:                { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 10 },
  activeTab:          { backgroundColor: '#fff' },
  tabText:            { fontWeight: '600', color: '#64748B' },
  activeTabText:      { color: '#1E293B' },
  listContent:        { paddingHorizontal: 20, paddingBottom: 40 },
  emptyText:          { textAlign: 'center', marginTop: 50, color: '#94A3B8' },
  card:               { backgroundColor: '#fff', borderRadius: 16, padding: 20, marginBottom: 16, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.05, shadowRadius: 8 },
  cardHeader:         { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  categoryBadge:      { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  categoryText:       { fontSize: 10, fontWeight: '700', marginLeft: 4, textTransform: 'uppercase' },
  sharedBadge:        { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F1F5F9', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  sharedText:         { fontSize: 10, fontWeight: '600', color: '#475569', marginLeft: 4 },
  modeBadge:          { padding: 6, borderRadius: 20 },
  cardTitle:          { fontSize: 18, fontWeight: '700', color: '#1E293B', marginBottom: 6 },
  versePreview:       { fontSize: 13, color: '#64748B', marginBottom: 15 },
  quickWinBtn:        { flexDirection: 'row', alignItems: 'center', paddingTop: 10, borderTopWidth: 1, borderTopColor: '#F1F5F9' },
  quickWinText:       { color: '#64748B', fontSize: 12, marginLeft: 6, fontWeight: '600' },
  dashboardContainer: { marginBottom: 8 },
  statsRow:           { flexDirection: 'row', gap: 10, marginBottom: 16 },
  statCard:           { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderLeftWidth: 3, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6 },
  statNumber:         { fontSize: 28, fontWeight: '800', color: '#1E293B' },
  statLabel:          { fontSize: 11, color: '#94A3B8', fontWeight: '600', marginTop: 2 },
  categoryBar:        { flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden', marginBottom: 8 },
  categoryBarSegment: { justifyContent: 'center', alignItems: 'center' },
  categoryBarLabel:   { fontSize: 8, color: '#fff', fontWeight: '700' },
  categoryLegend:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  legendItem:         { flexDirection: 'row', alignItems: 'center', gap: 4 },
  legendDot:          { width: 8, height: 8, borderRadius: 4 },
  legendText:         { fontSize: 11, color: '#64748B' },
  crisisFilters:      { marginBottom: 16 },
  crisisChip:         { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#fff', marginRight: 8 },
  crisisChipText:     { fontSize: 13, fontWeight: '600', color: '#475569' },
  crisisChipCount:    { fontSize: 12, fontWeight: '700', color: '#94A3B8' },
  victoriaButton:     { backgroundColor: '#7C3AED', padding: 16, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 10, marginBottom: 4 },
  victoriaButtonText: { color: '#fff', fontWeight: '700', fontSize: 15 },
  trendModal:         { flex: 1, backgroundColor: '#F8FAFC' },
  trendModalHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 24, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#E2E8F0' },
  trendModalTitle:    { fontSize: 20, fontWeight: '800', color: '#1E293B' },
  trendModalSubtitle: { fontSize: 12, color: '#7C3AED', fontWeight: '600', marginTop: 2 },
  trendLoadingBox:    { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 16 },
  trendLoadingText:   { color: '#7C3AED', fontWeight: '600' },
  trendContent:       { padding: 24 },
  trendStatsRow:      { flexDirection: 'row', gap: 10, marginBottom: 24 },
  trendStat:          { flex: 1, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 2, alignItems: 'center' },
  trendStatNum:       { fontSize: 26, fontWeight: '800' },
  trendStatLabel:     { fontSize: 11, color: '#94A3B8', fontWeight: '600', marginTop: 2, textAlign: 'center' },
  trendSection:       { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 16 },
  trendSectionTitle:  { fontSize: 11, fontWeight: '700', color: '#94A3B8', letterSpacing: 1, marginBottom: 10 },
  trendBody:          { fontSize: 15, color: '#334155', lineHeight: 22 },
  recommendationRow:  { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
  recommendationBullet: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#7C3AED', justifyContent: 'center', alignItems: 'center' },
  recommendationBulletText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  recommendationText: { flex: 1, fontSize: 14, color: '#334155', lineHeight: 20 },
  pastoralVerse:      { backgroundColor: '#F5F3FF', borderRadius: 12, padding: 20, borderLeftWidth: 3, borderLeftColor: '#7C3AED' },
  pastoralVerseRef:   { fontSize: 14, fontWeight: '800', color: '#7C3AED' },
  pastoralVerseText:  { fontSize: 16, color: '#3B0764', fontStyle: 'italic', lineHeight: 24, marginTop: 8 },
  modalContainer:     { flex: 1, backgroundColor: '#F8FAFC' },
  modalHeader:        { padding: 20, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#fff', paddingTop: 50 },
  iconBtn:            { backgroundColor: '#EFF6FF', padding: 8, borderRadius: 20 },
  modalScroll:        { padding: 24 },
  modalTitle:         { fontSize: 24, fontWeight: '800', color: '#1E293B', textAlign: 'center', marginBottom: 20 },
  scriptureBox:       { backgroundColor: '#fff', padding: 24, borderRadius: 16, borderLeftWidth: 4, marginBottom: 24, shadowColor: '#000', shadowOpacity: 0.05, shadowRadius: 10 },
  scriptureRef:       { fontWeight: '700', fontSize: 14 },
  scriptureText:      { fontSize: 18, color: '#334155', fontStyle: 'italic', lineHeight: 28, marginTop: 5 },
  meditationLabel:    { fontSize: 12, fontWeight: '700', color: '#94A3B8', marginBottom: 8, letterSpacing: 1 },
  meditationText:     { fontSize: 18, color: '#334155', lineHeight: 30 },
  modalFooter:        { padding: 20, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#E2E8F0' },
  bigSuccessButton:   { backgroundColor: '#10B981', justifyContent: 'center', alignItems: 'center', padding: 18, borderRadius: 16 },
  bigButtonText:      { color: '#fff', fontSize: 18, fontWeight: '700' },
});
