/**
 * PastorDashboardWeb
 * Full-viewport 3-column CRM layout for web (Platform.OS === 'web').
 * Mobile layout stays in app/(tabs)/index.tsx unchanged.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { User } from '@supabase/supabase-js';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { CATEGORIES } from '../constants/prayer';
import { supabase } from '../lib/supabase';
import {
  fetchAllPrayersForPastor,
  updatePrayerStatus,
} from '../services/prayerService';
import { Prayer } from '../types/prayer';

// ─────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────
type NavSection  = 'bandeja' | 'batalla' | 'victorias' | 'intercesores' | 'ajustes';
type StatFilter  = 'all' | 'unassigned' | 'battle' | 'victories';

// ─────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────
const isToday = (d: string) => {
  const date = new Date(d);
  const now  = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth()    === now.getMonth() &&
    date.getDate()     === now.getDate()
  );
};

const timeAgo = (d: string): string => {
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'ahora';
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  return `hace ${Math.floor(h / 24)}d`;
};

const getStatusStep = (p: Prayer): number => {
  if (p.status === 'answered')     return 2;
  if (p.special_mode === 'urgent') return 1;
  return 0;
};

const initials = (name: string) =>
  name.trim().split(/\s+/).map(n => n[0] ?? '').join('').slice(0, 2).toUpperCase();

// ─────────────────────────────────────────────
//  Mock intercessors (until real table exists)
// ─────────────────────────────────────────────
const INTERCESSORS = [
  { id: '1', name: 'Ana García',       init: 'AG', color: '#7c3aed' },
  { id: '2', name: 'Carlos López',     init: 'CL', color: '#2563eb' },
  { id: '3', name: 'María Rodríguez',  init: 'MR', color: '#db2777' },
  { id: '4', name: 'Pedro Martínez',   init: 'PM', color: '#059669' },
  { id: '5', name: 'Laura Sánchez',    init: 'LS', color: '#d97706' },
];

// ─────────────────────────────────────────────
//  Design tokens
// ─────────────────────────────────────────────
const C = {
  sidebar:       '#0f172a',
  sidebarBorder: '#1e293b',
  main:          '#f8fafc',
  accent:        '#7c3aed',
  accentMuted:   '#a78bfa',
  accentLight:   '#ede9fe',
  border:        '#e2e8f0',
  text:          '#1e293b',
  muted:         '#64748b',
  subtle:        '#94a3b8',
  card:          '#ffffff',
  cardHover:     '#f1f5f9',
  danger:        '#ef4444',
  success:       '#10b981',
  amber:         '#f59e0b',
  whatsapp:      '#25D366',
};

const NAV_ITEMS: { id: NavSection; label: string; icon: string }[] = [
  { id: 'bandeja',      label: 'Bandeja',      icon: 'mail-outline'     },
  { id: 'batalla',      label: 'En Batalla',   icon: 'shield'           },
  { id: 'victorias',    label: 'Victorias',    icon: 'trophy-outline'   },
  { id: 'intercesores', label: 'Intercesores', icon: 'people-outline'   },
  { id: 'ajustes',      label: 'Ajustes',      icon: 'settings-outline' },
];

// ─────────────────────────────────────────────
//  Main component
// ─────────────────────────────────────────────
interface Props { user: User | null }

export default function PastorDashboardWeb({ user }: Props) {
  const [prayers,        setPrayers]        = useState<Prayer[]>([]);
  const [loading,        setLoading]        = useState(true);
  const [activeNav,      setActiveNav]      = useState<NavSection>('bandeja');
  const [statFilter,     setStatFilter]     = useState<StatFilter>('all');
  const [selectedPrayer, setSelectedPrayer] = useState<Prayer | null>(null);
  const [searchQuery,    setSearchQuery]    = useState('');
  const [modoHoy,        setModoHoy]        = useState(false);
  const [hoveredId,      setHoveredId]      = useState<number | null>(null);
  const [notes,          setNotes]          = useState('');
  const [interSearch,    setInterSearch]    = useState('');
  const [assignments,    setAssignments]    = useState<Record<number, string>>({});
  const [pastorName,     setPastorName]     = useState('');

  useEffect(() => {
    loadPrayers();
    AsyncStorage.getItem('@war_room_cached_name').then(n => { if (n) setPastorName(n); });
  }, []);

  const loadPrayers = async () => {
    setLoading(true);
    try {
      setPrayers(await fetchAllPrayersForPastor());
    } catch (e) {
      console.error('[WebDashboard]', e);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (id: number) => {
    const p = prayers.find(x => x.id === id);
    if (!p) return;
    const next = p.status === 'active' ? 'answered' : 'active';
    setPrayers(curr => curr.map(x => x.id === id ? { ...x, status: next } : x));
    setSelectedPrayer(prev => prev?.id === id ? { ...prev, status: next } : prev);
    try { await updatePrayerStatus(id, next); } catch { loadPrayers(); }
  };

  const handleMarkBattle = (id: number) => {
    setPrayers(curr => curr.map(x => x.id === id ? { ...x, special_mode: 'urgent' } : x));
    setSelectedPrayer(prev => prev?.id === id ? { ...prev, special_mode: 'urgent' } : prev);
  };

  // ── Stats ──
  const stats = useMemo(() => ({
    active:       prayers.filter(p => p.status === 'active').length,
    unassigned:   prayers.filter(p => p.status === 'active' && !assignments[p.id]).length,
    battle:       prayers.filter(p => p.status === 'active' && p.special_mode === 'urgent').length,
    victoriasHoy: prayers.filter(p => p.status === 'answered' && isToday(p.created_at)).length,
  }), [prayers, assignments]);

  // ── Filtered feed ──
  const filteredPrayers = useMemo(() => {
    let r = [...prayers];

    // Stat-card filter takes priority
    if (statFilter === 'unassigned') {
      r = r.filter(p => p.status === 'active' && !assignments[p.id]);
    } else if (statFilter === 'battle') {
      r = r.filter(p => p.status === 'active' && p.special_mode === 'urgent');
    } else if (statFilter === 'victories') {
      r = r.filter(p => p.status === 'answered' && isToday(p.created_at));
    } else {
      // Nav filter
      if (activeNav === 'bandeja')   r = r.filter(p => p.status === 'active');
      if (activeNav === 'batalla')   r = r.filter(p => p.status === 'active' && p.special_mode === 'urgent');
      if (activeNav === 'victorias') r = r.filter(p => p.status === 'answered');
    }

    if (modoHoy) r = r.filter(p => isToday(p.created_at));

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      r = r.filter(p =>
        p.title.toLowerCase().includes(q) ||
        (p.author_name ?? '').toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      );
    }
    return r;
  }, [prayers, activeNav, statFilter, modoHoy, searchQuery, assignments]);

  const displayName   = pastorName || user?.email?.split('@')[0] || 'Pastor';
  const pastorInit    = initials(displayName);
  const assigned      = selectedPrayer ? INTERCESSORS.find(i => i.id === assignments[selectedPrayer.id]) : null;
  const filteredInter = INTERCESSORS.filter(i => i.name.toLowerCase().includes(interSearch.toLowerCase()));

  const showFeed = activeNav !== 'intercesores' && activeNav !== 'ajustes';

  // ─────────────────────────────────────────────
  //  Render
  // ─────────────────────────────────────────────
  return (
    <View style={w.root}>

      {/* ═══════════════════════════════
          SIDEBAR  (240 px)
      ═══════════════════════════════ */}
      <View style={w.sidebar}>

        {/* Brand */}
        <View style={w.sidebarBrand}>
          <Ionicons name="shield" size={22} color={C.accentMuted} />
          <Text style={w.brandTxt}>
            My <Text style={{ color: C.accentMuted }}>War</Text> Room
          </Text>
        </View>

        {/* Pastor info */}
        <View style={w.pastorRow}>
          <View style={[w.avatar, { backgroundColor: C.accent }]}>
            <Text style={w.avatarTxt}>{pastorInit}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={w.pastorName} numberOfLines={1}>{displayName}</Text>
            <Text style={w.pastorRole}>Pastor · Líder</Text>
          </View>
        </View>

        <View style={w.sidebarDivider} />

        {/* Nav items */}
        {NAV_ITEMS.map(item => {
          const count =
            item.id === 'bandeja'   ? stats.active :
            item.id === 'batalla'   ? stats.battle  : undefined;
          const active = activeNav === item.id;
          return (
            <Pressable
              key={item.id}
              style={[w.navItem, active && w.navItemActive]}
              onPress={() => {
                setActiveNav(item.id);
                setStatFilter('all');
                setSelectedPrayer(null);
              }}
            >
              <Ionicons
                name={item.icon as any}
                size={18}
                color={active ? C.accentMuted : C.muted}
              />
              <Text style={[w.navLabel, active && w.navLabelActive]}>
                {item.label}
              </Text>
              {count !== undefined && count > 0 && (
                <View style={w.navBadge}>
                  <Text style={w.navBadgeTxt}>{count}</Text>
                </View>
              )}
            </Pressable>
          );
        })}

        <View style={{ flex: 1 }} />

        {/* Modo Hoy toggle */}
        <Pressable
          style={w.modoHoyRow}
          onPress={() => setModoHoy(v => !v)}
        >
          <Ionicons
            name="today-outline"
            size={16}
            color={modoHoy ? C.accentMuted : C.muted}
          />
          <Text style={[w.modoHoyLbl, modoHoy && { color: C.accentMuted }]}>
            Modo Hoy
          </Text>
          <View style={[w.toggle, modoHoy && w.toggleOn]}>
            <View style={[w.toggleThumb, modoHoy && w.toggleThumbOn]} />
          </View>
        </Pressable>

        {/* Sign out */}
        <Pressable style={w.signOutBtn} onPress={() => supabase.auth.signOut()}>
          <Ionicons name="log-out-outline" size={15} color={C.muted} />
          <Text style={w.signOutTxt}>Salir</Text>
        </Pressable>

      </View>{/* end sidebar */}

      {/* ═══════════════════════════════
          RIGHT AREA (flex-1)
      ═══════════════════════════════ */}
      <View style={w.rightArea}>

        {/* ── Stats bar ── */}
        <View style={w.statsBar}>
          {([
            { label: 'Activas',       val: stats.active,       color: '#2563eb', key: 'all'        },
            { label: 'Sin Asignar',   val: stats.unassigned,   color: C.amber,   key: 'unassigned' },
            { label: 'En Batalla',    val: stats.battle,       color: C.danger,  key: 'battle'     },
            { label: 'Victorias hoy', val: stats.victoriasHoy, color: C.success, key: 'victories'  },
          ] as { label: string; val: number; color: string; key: StatFilter }[]).map(card => (
            <Pressable
              key={card.key}
              style={[
                w.statCard,
                statFilter === card.key && { borderColor: card.color, borderWidth: 2 },
              ]}
              onPress={() => setStatFilter(prev => prev === card.key ? 'all' : card.key)}
            >
              <Text style={[w.statNum, { color: card.color }]}>{card.val}</Text>
              <Text style={w.statLbl}>{card.label}</Text>
            </Pressable>
          ))}
        </View>

        {/* ── Columns row ── */}
        <View style={w.columnsRow}>

          {/* ── Main feed ── */}
          <View style={w.mainFeed}>

            {/* Search + filter chips */}
            {showFeed && (
              <View style={w.feedHeader}>
                <View style={w.searchBox}>
                  <Ionicons name="search-outline" size={15} color={C.subtle} />
                  <TextInput
                    style={w.searchInput}
                    placeholder="Buscar peticiones, personas, categorías…"
                    placeholderTextColor={C.subtle}
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                  />
                  {searchQuery.length > 0 && (
                    <Pressable onPress={() => setSearchQuery('')}>
                      <Ionicons name="close-circle" size={15} color={C.subtle} />
                    </Pressable>
                  )}
                </View>
                <View style={w.chipRow}>
                  {(['Urgente', 'Salud', 'Familia', 'Finanzas'] as const).map(chip => (
                    <Pressable
                      key={chip}
                      style={w.chip}
                      onPress={() => setSearchQuery(chip === 'Urgente' ? '' : chip)}
                    >
                      <Text style={w.chipTxt}>{chip}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )}

            {/* Content area */}
            {loading ? (
              <View style={w.centered}>
                <ActivityIndicator color={C.accent} size="large" />
                <Text style={w.loadingTxt}>Cargando peticiones…</Text>
              </View>
            ) : activeNav === 'intercesores' ? (
              <IntercessoresView />
            ) : activeNav === 'ajustes' ? (
              <AjustesView user={user} displayName={displayName} onSignOut={() => supabase.auth.signOut()} />
            ) : (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={w.feedList}>
                {filteredPrayers.length === 0 ? (
                  <View style={w.emptyState}>
                    <Ionicons name="checkmark-circle-outline" size={52} color="#cbd5e1" />
                    <Text style={w.emptyTxt}>Sin peticiones en esta vista</Text>
                  </View>
                ) : (
                  filteredPrayers.map(item => (
                    <FeedCard
                      key={item.id}
                      item={item}
                      isSelected={selectedPrayer?.id === item.id}
                      isHovered={hoveredId === item.id}
                      assignedInter={INTERCESSORS.find(i => i.id === assignments[item.id])}
                      onPress={() => { setSelectedPrayer(item); setNotes(''); setInterSearch(''); }}
                      onHoverIn={() => setHoveredId(item.id)}
                      onHoverOut={() => setHoveredId(null)}
                      onBattle={() => handleMarkBattle(item.id)}
                      onVictory={() => handleToggleStatus(item.id)}
                      onWhatsApp={() => {
                        if (item.phone_contact)
                          Linking.openURL(`https://wa.me/${item.phone_contact.replace(/\D/g, '')}`);
                      }}
                      onAssign={() => { setSelectedPrayer(item); setNotes(''); setInterSearch(''); }}
                    />
                  ))
                )}
              </ScrollView>
            )}
          </View>{/* end main feed */}

          {/* ── Detail panel (320 px) — shown when card selected ── */}
          {selectedPrayer && showFeed && (
            <View style={w.detailPanel}>
              <ScrollView contentContainerStyle={w.detailScroll}>

                {/* Close */}
                <Pressable style={w.detailClose} onPress={() => setSelectedPrayer(null)}>
                  <Ionicons name="close" size={18} color={C.muted} />
                </Pressable>

                {/* Header */}
                <Text style={w.detailTitle}>{selectedPrayer.title}</Text>
                <Text style={w.detailAuthor}>{selectedPrayer.author_name || 'Anónimo'}</Text>

                {/* Full prayer */}
                <Section label="PETICIÓN">
                  <Text style={w.detailBody}>{selectedPrayer.long_prayer}</Text>
                </Section>

                {/* Verse */}
                <View style={[w.verseBox, { borderLeftColor: CATEGORIES[selectedPrayer.category]?.color ?? C.accent }]}>
                  <Text style={w.verseRef}>{selectedPrayer.verse}</Text>
                  <Text style={w.verseTxt}>"{selectedPrayer.verse_text}"</Text>
                </View>

                {/* Status timeline */}
                <Section label="ESTADO">
                  <View style={w.timeline}>
                    {[
                      { label: 'Entrante',   step: 0, color: '#2563eb' },
                      { label: 'En Batalla', step: 1, color: C.danger  },
                      { label: 'Victoria',   step: 2, color: C.success  },
                    ].map((s, idx) => {
                      const cur  = getStatusStep(selectedPrayer);
                      const done = cur >= s.step;
                      return (
                        <React.Fragment key={s.label}>
                          <View style={w.tlItem}>
                            <View style={[w.tlDot, done && { backgroundColor: s.color, borderColor: s.color }]}>
                              {done && <Ionicons name="checkmark" size={9} color="#fff" />}
                            </View>
                            <Text style={[w.tlLabel, done && { color: s.color, fontWeight: '700' }]}>
                              {s.label}
                            </Text>
                          </View>
                          {idx < 2 && (
                            <View style={[w.tlLine, cur > s.step && { backgroundColor: '#94a3b8' }]} />
                          )}
                        </React.Fragment>
                      );
                    })}
                  </View>
                </Section>

                {/* Intercessor assignment */}
                <Section label="INTERCESOR ASIGNADO">
                  {assigned ? (
                    <View style={w.assignedRow}>
                      <View style={[w.avatarMd, { backgroundColor: assigned.color }]}>
                        <Text style={w.avatarMdTxt}>{assigned.init}</Text>
                      </View>
                      <Text style={w.assignedName}>{assigned.name}</Text>
                      <Pressable
                        onPress={() =>
                          setAssignments(prev => {
                            const n = { ...prev };
                            delete n[selectedPrayer.id];
                            return n;
                          })
                        }
                      >
                        <Ionicons name="close-circle" size={18} color={C.subtle} />
                      </Pressable>
                    </View>
                  ) : (
                    <>
                      <TextInput
                        style={w.interInput}
                        placeholder="Buscar intercesor…"
                        placeholderTextColor={C.subtle}
                        value={interSearch}
                        onChangeText={setInterSearch}
                      />
                      {interSearch.length > 0 && (
                        <View style={w.dropdown}>
                          {filteredInter.map(ic => (
                            <Pressable
                              key={ic.id}
                              style={w.dropdownItem}
                              onPress={() => {
                                setAssignments(prev => ({ ...prev, [selectedPrayer.id]: ic.id }));
                                setInterSearch('');
                              }}
                            >
                              <View style={[w.avatarSm, { backgroundColor: ic.color }]}>
                                <Text style={w.avatarSmTxt}>{ic.init}</Text>
                              </View>
                              <Text style={w.dropdownName}>{ic.name}</Text>
                            </Pressable>
                          ))}
                        </View>
                      )}
                    </>
                  )}
                </Section>

                {/* Notes */}
                <Section label="NOTAS PRIVADAS">
                  <TextInput
                    style={w.notesInput}
                    placeholder="Solo visible para ti…"
                    placeholderTextColor={C.subtle}
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    numberOfLines={4}
                    textAlignVertical="top"
                  />
                </Section>

                {/* WhatsApp — first action, prominent */}
                {selectedPrayer.phone_contact ? (
                  <Pressable
                    style={w.whatsappBtn}
                    onPress={() =>
                      Linking.openURL(
                        `https://wa.me/${selectedPrayer.phone_contact!.replace(/\D/g, '')}`
                      )
                    }
                  >
                    <Ionicons name="logo-whatsapp" size={18} color="#fff" />
                    <Text style={w.whatsappTxt}>Contactar por WhatsApp</Text>
                  </Pressable>
                ) : null}

                {/* Marcar Victoria — full width, amber */}
                <Pressable
                  style={[
                    w.victoriaBtn,
                    selectedPrayer.status === 'answered' && { backgroundColor: C.muted },
                  ]}
                  onPress={() => handleToggleStatus(selectedPrayer.id)}
                >
                  <Ionicons
                    name={selectedPrayer.status === 'answered' ? 'refresh' : 'trophy'}
                    size={18}
                    color="#fff"
                  />
                  <Text style={w.victoriaTxt}>
                    {selectedPrayer.status === 'answered' ? 'Regresar a Batalla' : 'Marcar Victoria'}
                  </Text>
                </Pressable>

              </ScrollView>
            </View>
          )}

        </View>{/* end columns row */}
      </View>{/* end right area */}
    </View>// end root
  );
}

// ─────────────────────────────────────────────
//  FeedCard sub-component
// ─────────────────────────────────────────────
interface FeedCardProps {
  item: Prayer;
  isSelected: boolean;
  isHovered: boolean;
  assignedInter?: { id: string; name: string; init: string; color: string };
  onPress: () => void;
  onHoverIn: () => void;
  onHoverOut: () => void;
  onBattle: () => void;
  onVictory: () => void;
  onWhatsApp: () => void;
  onAssign: () => void;
}

function FeedCard({
  item, isSelected, isHovered, assignedInter,
  onPress, onHoverIn, onHoverOut,
  onBattle, onVictory, onWhatsApp, onAssign,
}: FeedCardProps) {
  const theme = CATEGORIES[item.category] ?? CATEGORIES['Negocios'];
  return (
    <Pressable
      style={[
        w.card,
        isSelected && w.cardSelected,
        isHovered && !isSelected && w.cardHover,
      ]}
      onPress={onPress}
      onHoverIn={onHoverIn}
      onHoverOut={onHoverOut}
    >
      {/* Top row */}
      <View style={w.cardTopRow}>
        <View style={[w.catPill, { backgroundColor: theme.bg }]}>
          <Text style={[w.catPillTxt, { color: theme.color }]}>{item.category}</Text>
        </View>
        {item.special_mode === 'urgent' && (
          <View style={w.urgentBadge}>
            <Text style={w.urgentTxt}>URGENTE</Text>
          </View>
        )}
        <Text style={w.cardTime}>{timeAgo(item.created_at)}</Text>
      </View>

      {/* Title */}
      <Text style={w.cardTitle}>{item.title}</Text>

      {/* Author */}
      <Text style={w.cardAuthor}>{item.author_name || 'Anónimo'}</Text>

      {/* Full excerpt — no truncation on web */}
      <Text style={w.cardExcerpt} numberOfLines={4}>{item.long_prayer}</Text>

      {/* Footer */}
      <View style={w.cardFooter}>
        {assignedInter ? (
          <View style={[w.interBubble, { backgroundColor: assignedInter.color }]}>
            <Text style={w.interBubbleTxt}>{assignedInter.init}</Text>
          </View>
        ) : (
          <View style={[w.interBubble, { backgroundColor: '#e2e8f0' }]}>
            <Ionicons name="person-outline" size={11} color={C.subtle} />
          </View>
        )}

        {/* Inline quick-actions on hover */}
        {isHovered && (
          <View style={w.hoverActions}>
            <HoverBtn label="Asignar"    onPress={onAssign}  />
            <HoverBtn label="En Batalla" onPress={onBattle}  color={C.danger}    />
            <HoverBtn label="Victoria"   onPress={onVictory} color={C.success}   />
            {item.phone_contact && (
              <HoverBtn label="WhatsApp" onPress={onWhatsApp} color={C.whatsapp} fill />
            )}
          </View>
        )}
      </View>
    </Pressable>
  );
}

// ─────────────────────────────────────────────
//  HoverBtn micro-component
// ─────────────────────────────────────────────
function HoverBtn({
  label, onPress,
  color = C.muted,
  fill = false,
}: {
  label: string;
  onPress: () => void;
  color?: string;
  fill?: boolean;
}) {
  return (
    <Pressable
      style={[
        w.hoverBtn,
        { borderColor: color },
        fill && { backgroundColor: color },
      ]}
      onPress={e => { e.stopPropagation?.(); onPress(); }}
    >
      <Text style={[w.hoverBtnTxt, { color: fill ? '#fff' : color }]}>{label}</Text>
    </Pressable>
  );
}

// ─────────────────────────────────────────────
//  Section wrapper for detail panel
// ─────────────────────────────────────────────
function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={w.detailSection}>
      <Text style={w.detailSectionLbl}>{label}</Text>
      {children}
    </View>
  );
}

// ─────────────────────────────────────────────
//  Intercesores nav view
// ─────────────────────────────────────────────
function IntercessoresView() {
  return (
    <ScrollView contentContainerStyle={[w.feedList, { paddingTop: 24 }]}>
      <Text style={[w.detailSectionLbl, { marginBottom: 16 }]}>INTERCESORES DISPONIBLES</Text>
      {INTERCESSORS.map(ic => (
        <View key={ic.id} style={[w.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
          <View style={[w.avatarMd, { backgroundColor: ic.color }]}>
            <Text style={w.avatarMdTxt}>{ic.init}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={w.cardTitle}>{ic.name}</Text>
            <Text style={w.cardAuthor}>Intercesor activo</Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Ionicons name="shield" size={14} color={C.accent} />
            <Text style={{ color: C.accent, fontSize: 13, fontWeight: '600' }}>
              {Math.floor(Math.random() * 8) + 1} asignadas
            </Text>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────
//  Ajustes nav view
// ─────────────────────────────────────────────
function AjustesView({
  user, displayName, onSignOut,
}: {
  user: User | null;
  displayName: string;
  onSignOut: () => void;
}) {
  return (
    <ScrollView contentContainerStyle={[w.feedList, { paddingTop: 24 }]}>
      <View style={w.card}>
        <Text style={[w.detailSectionLbl, { marginBottom: 16 }]}>MI CUENTA</Text>
        <Text style={w.cardTitle}>{displayName}</Text>
        <Text style={w.cardAuthor}>{user?.email}</Text>
      </View>
      <Pressable
        style={[w.card, { flexDirection: 'row', alignItems: 'center', gap: 12, borderColor: C.danger, borderWidth: 1 }]}
        onPress={onSignOut}
      >
        <Ionicons name="log-out-outline" size={20} color={C.danger} />
        <Text style={{ color: C.danger, fontWeight: '600', fontSize: 15 }}>Cerrar sesión</Text>
      </Pressable>
    </ScrollView>
  );
}

// ─────────────────────────────────────────────
//  Styles
// ─────────────────────────────────────────────
const w = StyleSheet.create({
  // Root layout
  root:      { flex: 1, flexDirection: 'row', backgroundColor: C.main },

  // ── Sidebar ──
  sidebar:       { width: 240, backgroundColor: C.sidebar, paddingTop: 20, paddingBottom: 16 },
  sidebarBrand:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 20, marginBottom: 20 },
  brandTxt:      { fontSize: 16, fontWeight: '700', color: '#f1f5f9', fontFamily: 'serif' },
  pastorRow:     { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, marginBottom: 16 },
  avatar:        { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarTxt:     { color: '#fff', fontSize: 13, fontWeight: '700' },
  pastorName:    { color: '#f1f5f9', fontSize: 13, fontWeight: '600' },
  pastorRole:    { color: '#64748b', fontSize: 11, marginTop: 1 },
  sidebarDivider:{ height: 1, backgroundColor: C.sidebarBorder, marginVertical: 8 },
  navItem:       { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingVertical: 10, marginHorizontal: 8, borderRadius: 10 },
  navItemActive: { backgroundColor: '#1e293b' },
  navLabel:      { flex: 1, fontSize: 14, color: '#64748b', fontWeight: '500' },
  navLabelActive:{ color: '#e2e8f0', fontWeight: '600' },
  navBadge:      { backgroundColor: C.accent, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, minWidth: 20, alignItems: 'center' },
  navBadgeTxt:   { color: '#fff', fontSize: 11, fontWeight: '700' },
  modoHoyRow:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12 },
  modoHoyLbl:    { flex: 1, fontSize: 13, color: '#64748b', fontWeight: '500' },
  toggle:        { width: 36, height: 20, borderRadius: 10, backgroundColor: '#334155', justifyContent: 'center', paddingHorizontal: 3 },
  toggleOn:      { backgroundColor: C.accent },
  toggleThumb:   { width: 14, height: 14, borderRadius: 7, backgroundColor: '#94a3b8' },
  toggleThumbOn: { backgroundColor: '#fff', marginLeft: 16 },
  signOutBtn:    { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, marginTop: 4 },
  signOutTxt:    { fontSize: 13, color: '#64748b' },

  // ── Right area ──
  rightArea:  { flex: 1, flexDirection: 'column' },

  // ── Stats bar ──
  statsBar:   { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 14, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: C.border },
  statCard:   { flex: 1, backgroundColor: C.main, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.border },
  statNum:    { fontSize: 26, fontWeight: '800', color: C.text },
  statLbl:    { fontSize: 11, color: C.subtle, fontWeight: '600', marginTop: 2 },

  // ── Columns row ──
  columnsRow: { flex: 1, flexDirection: 'row' },

  // ── Main feed ──
  mainFeed:   { flex: 1, borderRightWidth: 1, borderRightColor: C.border },
  feedHeader: { padding: 16, gap: 10, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: '#fff' },
  searchBox:  { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.main, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, borderWidth: 1, borderColor: C.border },
  searchInput:{ flex: 1, fontSize: 14, color: C.text, outlineStyle: 'none' } as any,
  chipRow:    { flexDirection: 'row', gap: 8 },
  chip:       { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, backgroundColor: C.main, borderWidth: 1, borderColor: C.border },
  chipTxt:    { fontSize: 12, color: C.muted, fontWeight: '600' },
  feedList:   { padding: 16, gap: 12 },

  centered:   { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 12 },
  loadingTxt: { color: C.subtle, fontSize: 14 },
  emptyState: { paddingTop: 60, alignItems: 'center', gap: 12 },
  emptyTxt:   { color: C.subtle, fontSize: 15 },

  // ── Feed cards ──
  card:        { backgroundColor: C.card, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.border, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4 },
  cardHover:   { backgroundColor: C.cardHover, borderColor: '#cbd5e1' },
  cardSelected:{ borderColor: C.accent, borderWidth: 2 },
  cardTopRow:  { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  catPill:     { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  catPillTxt:  { fontSize: 10, fontWeight: '700', textTransform: 'uppercase' },
  urgentBadge: { backgroundColor: '#fef2f2', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  urgentTxt:   { fontSize: 10, fontWeight: '700', color: C.danger },
  cardTime:    { marginLeft: 'auto' as any, fontSize: 11, color: C.subtle },
  cardTitle:   { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 3 },
  cardAuthor:  { fontSize: 12, color: C.muted, marginBottom: 8 },
  cardExcerpt: { fontSize: 13, color: '#334155', lineHeight: 19, marginBottom: 12 },
  cardFooter:  { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  interBubble: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  interBubbleTxt: { color: '#fff', fontSize: 10, fontWeight: '700' },

  hoverActions:{ flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 4, flexWrap: 'wrap' },
  hoverBtn:    { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, borderWidth: 1, borderColor: C.muted },
  hoverBtnTxt: { fontSize: 12, fontWeight: '600', color: C.muted },

  // ── Detail panel ──
  detailPanel: { width: 320, backgroundColor: '#fff', borderLeftWidth: 1, borderLeftColor: C.border },
  detailScroll:{ padding: 20, gap: 4, paddingBottom: 40 },
  detailClose: { alignSelf: 'flex-end', padding: 4, marginBottom: 8 },
  detailTitle: { fontSize: 18, fontWeight: '800', color: C.text, marginBottom: 4, lineHeight: 24 },
  detailAuthor:{ fontSize: 13, color: C.muted, marginBottom: 16 },
  detailSection:{ marginTop: 20 },
  detailSectionLbl: { fontSize: 10, fontWeight: '700', color: C.subtle, letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' as any },
  detailBody:  { fontSize: 14, color: '#334155', lineHeight: 21 },

  verseBox:    { backgroundColor: '#f8fafc', borderRadius: 10, padding: 14, borderLeftWidth: 3, marginTop: 16 },
  verseRef:    { fontSize: 12, fontWeight: '700', color: C.accent, marginBottom: 4 },
  verseTxt:    { fontSize: 13, color: '#334155', fontStyle: 'italic', lineHeight: 19 },

  // Timeline
  timeline:    { flexDirection: 'row', alignItems: 'center', gap: 0 },
  tlItem:      { alignItems: 'center', gap: 4 },
  tlDot:       { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: C.border, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  tlLabel:     { fontSize: 10, color: C.subtle, textAlign: 'center', maxWidth: 60 },
  tlLine:      { flex: 1, height: 2, backgroundColor: C.border, marginBottom: 14 },

  // Intercessor assignment
  assignedRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: C.main, borderRadius: 10, padding: 10 },
  assignedName:{ flex: 1, fontSize: 14, color: C.text, fontWeight: '600' },
  avatarMd:    { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  avatarMdTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  avatarSm:    { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  avatarSmTxt: { color: '#fff', fontSize: 10, fontWeight: '700' },

  interInput:  { backgroundColor: C.main, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14, color: C.text },
  dropdown:    { marginTop: 4, backgroundColor: '#fff', borderRadius: 10, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
  dropdownItem:{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.border },
  dropdownName:{ fontSize: 14, color: C.text },

  notesInput:  { backgroundColor: C.main, borderWidth: 1, borderColor: C.border, borderRadius: 10, padding: 12, fontSize: 14, color: C.text, minHeight: 90, lineHeight: 20 },

  whatsappBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#25D366', borderRadius: 12, padding: 13, marginTop: 20 },
  whatsappTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },

  victoriaBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.amber, borderRadius: 12, padding: 15, marginTop: 12 },
  victoriaTxt: { color: '#fff', fontWeight: '700', fontSize: 15 },
});
