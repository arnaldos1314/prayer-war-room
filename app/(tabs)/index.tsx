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
  { icon: 'mail-outline',          label: 'Bandeja',          key: 'incoming'     },
  { icon: 'shield-outline',        label: 'En Batalla',       key: 'in_battle'    },
  { icon: 'trophy-outline',        label: 'Victorias',        key: 'victory'      },
  { icon: 'people-circle-outline', label: 'Pared de Oración', key: 'wall'         },
  { icon: 'people-outline',        label: 'Intercesores',     key: 'intercesores' },
  { icon: 'settings-outline',      label: 'Ajustes',          key: 'ajustes'      },
  { icon: 'bar-chart-outline',     label: 'Estadísticas',     key: 'stats'        },
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
//  AI SUGGESTION  (Anthropic Claude Haiku)
// ─────────────────────────────────────────────────────────────
type AISuggestion = { verse: string; verseRef: string; prayer: string; encouragement: string };

async function getAISuggestion(
  content: string,
  category: string,
  context: 'member' | 'pastor' = 'member'
): Promise<AISuggestion> {
  const systemPrompt = context === 'member'
    ? `Eres un pastor espiritual compasivo. Cuando alguien comparte una petición de oración, respondes con: un versículo bíblico relevante, una oración corta guiada (2-3 oraciones), y una palabra de aliento breve. Responde SOLO en JSON válido, sin markdown.`
    : `Eres un asistente pastoral. Sugiere un versículo bíblico y una nota pastoral breve para que el pastor ore por esta petición. Responde SOLO en JSON válido, sin markdown.`;

  const userPrompt = `Petición de oración - Categoría: ${category}\nContenido: "${content}"\n\nResponde en este formato JSON exacto:\n{\n  "verse": "texto del versículo aquí",\n  "verseRef": "Libro capítulo:versículo",\n  "prayer": "oración guiada aquí",\n  "encouragement": "palabra de aliento breve aquí"\n}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.EXPO_PUBLIC_ANTHROPIC_KEY!,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 500,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
      }),
    });
    const data = await response.json();
    const text = data.content[0].text;
    console.log('Raw AI response:', text);
    return JSON.parse(text);
  } catch (e) {
    console.error('AI suggestion failed:', e);
    return {
      verse: 'No os ha sobrevenido ninguna tentación que no sea humana; pero fiel es Dios.',
      verseRef: '1 Corintios 10:13',
      prayer: 'Señor, te traemos esta situación y confiamos en Tu fidelidad. Guía, sana y fortalece a quien te busca en este momento.',
      encouragement: 'Dios es fiel y está contigo en este momento. Él tiene el control.',
    };
  }
}

// ─────────────────────────────────────────────────────────────
//  TWO-STEP AI FLOW: verse options → guided prayer
// ─────────────────────────────────────────────────────────────
type VerseOption = { verse: string; verseRef: string; angle: string };
type GuidedPrayer = { prayer: string; encouragement: string };

async function callAnthropic(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.EXPO_PUBLIC_ANTHROPIC_KEY!,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5',
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    }),
  });
  const data = await response.json();
  const text = data.content[0].text;
  console.log('Raw AI response:', text);
  return text;
}

async function getVerseOptions(content: string, category: string): Promise<VerseOption[]> {
  const systemPrompt = `Eres un consejero pastoral. Dada una petición de oración, sugiere 3 versículos bíblicos DIFERENTES y específicamente relevantes al contenido — cada uno desde un ángulo distinto (promesa, consuelo, guía práctica). Responde SOLO JSON.`;
  const userPrompt = `Petición (${category}): "${content}"\nResponde en este JSON exacto:\n{"options": [\n  {"verse": "...", "verseRef": "...", "angle": "Promesa"},\n  {"verse": "...", "verseRef": "...", "angle": "Consuelo"},\n  {"verse": "...", "verseRef": "...", "angle": "Guía"}\n]}`;
  try {
    const text = await callAnthropic(systemPrompt, userPrompt, 700);
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed.options) && parsed.options.length > 0) return parsed.options;
    throw new Error('Invalid options shape');
  } catch (e) {
    console.error('Verse options failed:', e);
    return [
      { verse: 'Mi Dios, pues, suplirá todo lo que os falta conforme a sus riquezas en gloria en Cristo Jesús.', verseRef: 'Filipenses 4:19', angle: 'Promesa' },
      { verse: 'Venid a mí todos los que estáis trabajados y cargados, y yo os haré descansar.', verseRef: 'Mateo 11:28', angle: 'Consuelo' },
      { verse: 'Fíate de Jehová de todo tu corazón, y no te apoyes en tu propia prudencia.', verseRef: 'Proverbios 3:5', angle: 'Guía' },
    ];
  }
}

async function getGuidedPrayer(
  content: string, category: string, chosenVerse: string, chosenVerseRef: string
): Promise<GuidedPrayer> {
  const systemPrompt = `Eres un mentor de oración. Tu trabajo NO es parafrasear un versículo — es ENSEÑAR a la persona cómo orar sobre SU situación específica, usando el versículo como fundamento de fe, no como contenido principal.

La oración debe:
1. Nombrar específicamente los elementos de la situación que la persona mencionó (ej: si menciona deudas, ansiedad, préstamos — nombrarlos directamente, no genéricamente)
2. Presentar esos elementos concretos ante Dios
3. Pedir algo específico y accionable (sabiduría para finanzas, paz en medio de la incertidumbre, provisión concreta)
4. Conectar brevemente con la promesa del versículo elegido AL FINAL, como ancla de fe — no como apertura

Formato: 4-5 oraciones cortas, en primera persona plural ('Señor, te traemos...'), lenguaje cálido pero específico, NUNCA genérico. Evita frases tipo 'en este momento', 'confiamos en tu fidelidad' como apertura — empieza nombrando la situación real.

Responde SOLO JSON válido.`;
  const userPrompt = `Situación completa de la persona: "${content}"
Categoría: ${category}
Versículo elegido como ancla: "${chosenVerse}" (${chosenVerseRef})

Identifica 2-3 elementos CONCRETOS de la situación (cosas específicas que la persona mencionó: deudas, préstamos, ansiedad, decisiones pendientes, etc.) y constrúyelos en la oración.

Responde:
{"prayer": "oración de 4-5 oraciones que nombra elementos concretos y termina conectando con el versículo", "encouragement": "una frase breve y práctica — no genérica — sobre qué hacer hoy con esta oración"}`;
  try {
    const text = await callAnthropic(systemPrompt, userPrompt, 600);
    return JSON.parse(text);
  } catch (e) {
    console.error('Guided prayer failed:', e);
    return {
      prayer: `Señor, traemos ante ti la situación de ${category} que estamos viviendo — las cargas, las dudas, lo que nos quita la paz. Te pedimos sabiduría para los próximos pasos y te entregamos lo que no podemos controlar. Confiamos en tu promesa: "${chosenVerse}" (${chosenVerseRef}).`,
      encouragement: 'Vuelve a esta oración hoy antes de tomar cualquier decisión sobre esta situación.',
    };
  }
}

// ─────────────────────────────────────────────────────────────
//  SERMON SUGGESTION  (Anthropic Claude Haiku)
// ─────────────────────────────────────────────────────────────
type SermonSuggestion = { title: string; verse: string; verseRef: string; outline: string[]; encouragement: string };

async function getSermonSuggestion(context: string): Promise<SermonSuggestion> {
  const systemPrompt = `Eres un asistente homilético pastoral. Basándote en el estado actual de las peticiones de oración del ministerio, sugiere un sermón relevante. Responde SOLO en JSON válido, sin markdown ni texto adicional.`;
  const userPrompt = `Estado del ministerio:\n${context}\n\nSugiere un sermón en este formato JSON exacto:\n{\n  "title": "Título del sermón",\n  "verse": "Texto del versículo principal",\n  "verseRef": "Libro capítulo:versículo",\n  "outline": ["Punto 1", "Punto 2", "Punto 3"],\n  "encouragement": "Palabra de aliento para el pastor"\n}`;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.EXPO_PUBLIC_ANTHROPIC_KEY!,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5', max_tokens: 600,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
      }),
    });
    const data = await response.json();
    return JSON.parse(data.content[0].text);
  } catch {
    return {
      title: 'La fidelidad de Dios en tiempos de prueba',
      verse: 'El que comenzó en vosotros la buena obra, la perfeccionará hasta el día de Jesucristo.',
      verseRef: 'Filipenses 1:6',
      outline: ['La promesa de Dios en la adversidad', 'El poder de la oración comunitaria', 'Victorias que glorifican a Dios'],
      encouragement: 'Tu ministerio de oración está transformando vidas. Sigue adelante con fe.',
    };
  }
}

// ─────────────────────────────────────────────────────────────
//  FLOCK INSIGHT  (Anthropic Claude Haiku)
// ─────────────────────────────────────────────────────────────
type FlockInsight = { insight: string; verse: string; verseRef: string };

async function getFlockInsight(context: string): Promise<FlockInsight> {
  const systemPrompt = `Eres un consejero pastoral con sabiduría bíblica. Analiza el estado espiritual del rebaño basándote en las peticiones de oración y ofrece una perspectiva pastoral profunda. Responde SOLO en JSON válido, sin markdown.`;
  const userPrompt = `Datos del rebaño:\n${context}\n\nResponde en este formato JSON exacto:\n{\n  "insight": "Perspectiva pastoral sobre el estado espiritual del rebaño (2-3 oraciones)",\n  "verse": "Versículo bíblico de aliento y guía",\n  "verseRef": "Libro capítulo:versículo"\n}`;
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.EXPO_PUBLIC_ANTHROPIC_KEY!,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5', max_tokens: 400,
        messages: [{ role: 'user', content: userPrompt }],
        system: systemPrompt,
      }),
    });
    const data = await response.json();
    return JSON.parse(data.content[0].text);
  } catch {
    return {
      insight: 'El rebaño está buscando a Dios con fervor. Las peticiones reflejan un pueblo que confía en la soberanía divina. Continúa guiándoles con oración y la Palabra.',
      verse: 'Cuidad de vosotros mismos, y de todo el rebaño en que el Espíritu Santo os ha puesto por obispos.',
      verseRef: 'Hechos 20:28',
    };
  }
}

// ─────────────────────────────────────────────────────────────
//  COUNTRY LIST
// ─────────────────────────────────────────────────────────────
const COUNTRIES = [
  { code: 'US', name: 'Estados Unidos' }, { code: 'MX', name: 'México' },
  { code: 'CO', name: 'Colombia' },       { code: 'AR', name: 'Argentina' },
  { code: 'PE', name: 'Perú' },           { code: 'CL', name: 'Chile' },
  { code: 'VE', name: 'Venezuela' },      { code: 'EC', name: 'Ecuador' },
  { code: 'GT', name: 'Guatemala' },      { code: 'CU', name: 'Cuba' },
  { code: 'DO', name: 'República Dominicana' }, { code: 'HN', name: 'Honduras' },
  { code: 'SV', name: 'El Salvador' },    { code: 'NI', name: 'Nicaragua' },
  { code: 'CR', name: 'Costa Rica' },     { code: 'PA', name: 'Panamá' },
  { code: 'BO', name: 'Bolivia' },        { code: 'PY', name: 'Paraguay' },
  { code: 'UY', name: 'Uruguay' },        { code: 'PR', name: 'Puerto Rico' },
  { code: 'ES', name: 'España' },         { code: 'BR', name: 'Brasil' },
  { code: 'OTHER', name: 'Otro' },
] as const;

// Web-only HTML select for country — falls back to TextInput on native
const CountrySelect = ({ value, onChange }: { value: string; onChange: (v: string) => void }) => {
  if (Platform.OS === 'web') {
    return (
      <select
        value={value}
        onChange={(e: any) => onChange(e.target.value)}
        style={{
          width: '100%', padding: '12px 14px', borderRadius: 12,
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)',
          color: '#e2e8f0', fontSize: 14, marginBottom: 12,
          appearance: 'none', WebkitAppearance: 'none',
          cursor: 'pointer',
        } as any}
      >
        <option value="" style={{ background: '#0f0f1a' }}>Selecciona tu país</option>
        {COUNTRIES.map(c => (
          <option key={c.code} value={c.code} style={{ background: '#0f0f1a' }}>{c.name}</option>
        ))}
      </select>
    );
  }
  return (
    <TextInput
      style={{ backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.10)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: '#e2e8f0', fontSize: 14, marginBottom: 12 }}
      placeholder="Código de país (CO, MX…)"
      placeholderTextColor="#475569"
      value={value}
      onChangeText={v => onChange(v.toUpperCase().slice(0, 2))}
      maxLength={2}
      autoCapitalize="characters"
    />
  );
};

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
  const [profile,         setProfile]         = useState<{ id?: string; full_name?: string | null; role?: string; church?: string | null; country?: string | null } | null>(null);
  const [profileLoading,  setProfileLoading]  = useState(true);

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

  // Profile completion (PART 2)
  const [profileNombre,    setProfileNombre]    = useState('');
  const [profileIglesia,   setProfileIglesia]   = useState('');
  const [profilePaisSetup, setProfilePaisSetup] = useState('');
  const [profileSaving,    setProfileSaving]    = useState(false);
  const [profileErr,       setProfileErr]       = useState('');
  const [currentUserId,    setCurrentUserId]    = useState<string | null>(null);

  // Prayer Wall (PART 3)
  const [wallRequests,     setWallRequests]     = useState<any[]>([]);
  const [wallLoading,      setWallLoading]      = useState(false);
  const [wallTab,          setWallTab]          = useState<'approved' | 'pending'>('approved');
  const [wallPendingCount, setWallPendingCount] = useState(0);

  // Visibility selector in new form (PART 4)
  const [newVisibility,    setNewVisibility]    = useState<'private' | 'circle' | 'congregation'>('congregation');
  const [newAnonymous,     setNewAnonymous]     = useState(false);

  // Member personal view (PART 5)
  const [memberCircle,     setMemberCircle]     = useState<'personal' | 'family' | 'friends' | 'ministry'>('personal');
  const [memberPrayers,    setMemberPrayers]    = useState<any[]>([]);
  const [memberLoading,    setMemberLoading]    = useState(false);
  const [memberTotalCount, setMemberTotalCount] = useState<number | null>(null);
  const [memberShowForm,   setMemberShowForm]   = useState(false);
  const [memberContent,    setMemberContent]    = useState('');
  const [memberCat,        setMemberCat]        = useState('salud');
  const [memberVisibility, setMemberVisibility] = useState<'private' | 'circle' | 'congregation'>('private');
  const [memberAnonymous,  setMemberAnonymous]  = useState(false);
  const [memberUrgent,     setMemberUrgent]     = useState(false);
  const [memberSubmitting, setMemberSubmitting] = useState(false);
  const [memberErr,        setMemberErr]        = useState('');

  // AI Suggestion — Member (Feature 1A)
  const [memberAiVisible,    setMemberAiVisible]    = useState(false);
  const [memberAiLoading,    setMemberAiLoading]    = useState(false);
  const [memberAiSuggestion, setMemberAiSuggestion] = useState<AISuggestion | null>(null);
  const [memberAiRequestId,  setMemberAiRequestId]  = useState<string | null>(null);
  const [memberAiSaving,     setMemberAiSaving]     = useState(false);
  const [lastInsertedId,     setLastInsertedId]     = useState<string | null>(null);

  // AI Suggestion — Pastor (Feature 1B)
  const [aiSuggestion, setAiSuggestion] = useState<AISuggestion | null>(null);
  const [aiLoading,    setAiLoading]    = useState(false);

  // Two-step AI flow — Member (verse options → guided prayer)
  const [verseOptions,  setVerseOptions]  = useState<VerseOption[] | null>(null);
  const [selectedVerse, setSelectedVerse] = useState<VerseOption | null>(null);
  const [guidedPrayer,  setGuidedPrayer]  = useState<GuidedPrayer | null>(null);
  const [guidedLoading, setGuidedLoading] = useState(false);
  const [memberAiContent, setMemberAiContent] = useState('');
  const [memberAiCat,     setMemberAiCat]     = useState('otro');

  // Analytics (Feature 2)
  const [analyticsData,     setAnalyticsData]     = useState<any[]>([]);
  const [analyticsProfiles, setAnalyticsProfiles] = useState<any[]>([]);
  const [analyticsLoading,  setAnalyticsLoading]  = useState(false);

  // Sermon AI suggestion
  const [sermonSuggestion, setSermonSuggestion] = useState<SermonSuggestion | null>(null);
  const [sermonLoading,    setSermonLoading]    = useState(false);

  // Flock insight (auto-runs with analytics)
  const [flockInsight,        setFlockInsight]        = useState<FlockInsight | null>(null);
  const [flockInsightLoading, setFlockInsightLoading] = useState(false);

  // Member Circles
  const [circles,              setCircles]              = useState<any[]>([]);
  const [circleSearch,         setCircleSearch]         = useState('');
  const [searchResults,        setSearchResults]        = useState<any[]>([]);
  const [circleTab,            setCircleTab]            = useState<'members' | 'add'>('members');
  const [circleInviting,       setCircleInviting]       = useState<string | null>(null);
  const [pendingInvitations,   setPendingInvitations]   = useState<any[]>([]);
  const [pendingInviteCount,   setPendingInviteCount]   = useState(0);
  const [selectedCircleType,   setSelectedCircleType]   = useState<'family' | 'friends' | 'ministry'>('friends');
  const searchDebounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch current user's profile — single source of truth
  // Auto-creates a profile from email if none exists so the gate never shows on login
  useEffect(() => {
    const loadProfile = async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        setCurrentUserId(user.id);
        const { data } = await supabase
          .from('profiles')
          .select('id, full_name, role, church, country')
          .eq('id', user.id)
          .single();
        if (!data || !data.full_name) {
          const emailName = user.email?.split('@')[0] || 'Usuario';
          await supabase.from('profiles').upsert(
            { id: user.id, full_name: emailName, role: 'user' },
            { onConflict: 'id' }
          );
          const syntheticProfile = { id: user.id, full_name: emailName, role: 'user', church: null, country: null };
          setProfile(syntheticProfile);
          setCurrentUserRole('user');
          setCurrentUserName(emailName);
        } else {
          setProfile(data);
          setCurrentUserRole(data.role ?? 'user');
          setCurrentUserName(data.full_name ?? '');
        }
      } finally {
        setProfileLoading(false);
      }
    };
    loadProfile();
  }, []);

  // Initial wall pending count (for sidebar badge)
  useEffect(() => {
    supabase
      .from('prayer_requests')
      .select('id')
      .eq('wall_pending', true)
      .eq('wall_approved', false)
      .then(({ data }) => setWallPendingCount((data ?? []).length));
  }, []);

  // Fetch all profiles for Ajustes panel
  useEffect(() => {
    if (activeNav === 'ajustes') {
      setProfilesLoading(true);
      supabase
        .from('profiles')
        .select('id, full_name, role, church, country')
        .order('created_at', { ascending: true })
        .limit(500)
        .then(({ data, error }) => {
          if (!error) setAllProfiles(data ?? []);
          setProfilesLoading(false);
        });
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

  // Fetch wall requests when panel becomes active
  useEffect(() => {
    if (activeNav === 'wall') {
      setWallLoading(true);
      supabase
        .from('prayer_requests')
        .select('*')
        .or('wall_approved.eq.true,wall_pending.eq.true')
        .order('created_at', { ascending: false })
        .then(({ data }) => {
          const all = (data ?? []) as any[];
          setWallRequests(all);
          setWallPendingCount(all.filter((r: any) => r.wall_pending && !r.wall_approved).length);
          setWallLoading(false);
        });
    }
  }, [activeNav]);

  // Fetch analytics data when stats panel becomes active
  useEffect(() => {
    if (activeNav === 'stats') {
      setAnalyticsLoading(true);
      setFlockInsight(null);
      setSermonSuggestion(null);
      Promise.all([
        supabase
          .from('prayer_requests')
          .select('category, status, country_code, created_at, victory_date, assigned_to, urgent')
          .eq('space_type', 'ministry'),
        supabase
          .from('profiles')
          .select('id, full_name')
          .in('role', ['pastor', 'intercessor']),
      ]).then(([{ data: reqs }, { data: profs }]) => {
        const loadedReqs = reqs ?? [];
        setAnalyticsData(loadedReqs);
        setAnalyticsProfiles(profs ?? []);
        setAnalyticsLoading(false);
        // Auto-run flock insight
        if (loadedReqs.length > 0) {
          const totalReqs = loadedReqs.length;
          const victoryReqs = loadedReqs.filter((r: any) => r.status === 'victory').length;
          const urgentReqs = loadedReqs.filter((r: any) => r.urgent).length;
          const topCat = Object.entries(
            loadedReqs.reduce((acc: any, r: any) => { if (r.category) acc[r.category] = (acc[r.category] ?? 0) + 1; return acc; }, {})
          ).sort((a: any, b: any) => b[1] - a[1])[0]?.[0] ?? 'otro';
          const ctx = `Ministerio con ${totalReqs} peticiones totales. Victorias: ${victoryReqs} (${Math.round((victoryReqs/totalReqs)*100)}%). Peticiones urgentes activas: ${urgentReqs}. Categoría principal: ${topCat}. Intercesores activos: ${(profs ?? []).length}.`;
          setFlockInsightLoading(true);
          getFlockInsight(ctx).then(insight => {
            setFlockInsight(insight);
            setFlockInsightLoading(false);
          });
        }
      });
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

  // ── Profile completion handler (PART 2) ──
  const handleProfileSave = async () => {
    if (!profileNombre.trim()) { setProfileErr('Ingresa tu nombre.'); return; }
    setProfileSaving(true); setProfileErr('');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No autenticado');
      await supabase.from('profiles').upsert({
        id: user.id,
        full_name: profileNombre.trim(),
        church: profileIglesia.trim() || null,
        country: profilePaisSetup.trim() || null,
      });
    } catch (err: any) {
      setProfileErr(err.message ?? 'Error al guardar');
    } finally {
      // Always update profile state — gate resolves automatically when full_name is set
      const name = profileNombre.trim();
      setCurrentUserName(name);
      setProfile(prev => ({ ...prev, full_name: name }));
      setProfileSaving(false);
    }
  };

  // ── Wall handlers (PART 3) ──
  const handleWallApprove = async (id: string) => {
    await supabase.from('prayer_requests').update({ wall_approved: true, wall_pending: false }).eq('id', id);
    setWallRequests(prev => prev.map((r: any) => r.id === id ? { ...r, wall_approved: true, wall_pending: false } : r));
    setWallPendingCount(prev => Math.max(0, prev - 1));
  };

  const handleWallReject = async (id: string) => {
    await supabase.from('prayer_requests').update({ wall_approved: false, wall_pending: false }).eq('id', id);
    setWallRequests(prev => prev.filter((r: any) => r.id !== id));
    setWallPendingCount(prev => Math.max(0, prev - 1));
  };

  const handleWallPray = async (id: string) => {
    const req = wallRequests.find((r: any) => r.id === id);
    if (!req) return;
    const newCount = (req.pray_count ?? 0) + 1;
    setWallRequests(prev => prev.map((r: any) => r.id === id ? { ...r, pray_count: newCount } : r));
    await supabase.from('prayer_requests').update({ pray_count: newCount }).eq('id', id);
  };

  // ── Member personal space handlers (PART 5) ──
  const fetchMemberPrayers = useCallback(async () => {
    if (!currentUserId) return;
    setMemberLoading(true);
    const spaceMap: Record<string, string> = { personal: 'personal', family: 'family', friends: 'family', ministry: 'ministry' };
    const { data } = await supabase
      .from('prayer_requests')
      .select('*')
      .eq('user_id', currentUserId)
      .eq('space_type', spaceMap[memberCircle] ?? 'personal')
      .order('created_at', { ascending: false });
    setMemberPrayers(data ?? []);
    setMemberLoading(false);
  }, [currentUserId, memberCircle]);

  // Total request count across ALL circles — drives the welcome empty state
  const fetchMemberTotalCount = useCallback(async () => {
    if (!currentUserId) return;
    const { count } = await supabase
      .from('prayer_requests')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', currentUserId);
    setMemberTotalCount(count ?? 0);
  }, [currentUserId]);

  useEffect(() => {
    if (currentUserRole && currentUserRole !== 'pastor' && currentUserId) {
      fetchMemberPrayers();
      fetchMemberTotalCount();
    }
  }, [memberCircle, currentUserRole, currentUserId, fetchMemberPrayers, fetchMemberTotalCount]);

  const handleMemberSubmit = async () => {
    if (!memberContent.trim()) { setMemberErr('Escribe tu petición.'); return; }
    if (!currentUserId) return;
    setMemberSubmitting(true); setMemberErr('');
    const savedContent = memberContent.trim();
    const savedCat = memberCat;
    try {
      const spaceMap: Record<string, string> = { personal: 'personal', family: 'family', friends: 'family', ministry: 'ministry' };
      const { data: inserted } = await supabase.from('prayer_requests').insert({
        user_id:      currentUserId,
        space_type:   spaceMap[memberCircle] ?? 'personal',
        category:     memberCat,
        title:        memberAnonymous ? null : (currentUserName.trim() || null),
        content:      memberContent.trim(),
        urgent:       memberUrgent,
        status:       'incoming',
        visibility:   memberVisibility,
        anonymous:    memberAnonymous,
        wall_pending: memberVisibility === 'congregation',
        wall_approved: false,
        pray_count:   0,
      }).select('id').single();

      setMemberContent(''); setMemberUrgent(false); setMemberCat('salud');
      setMemberVisibility('private'); setMemberAnonymous(false);
      setMemberShowForm(false);
      fetchMemberPrayers();
      setMemberTotalCount(prev => (prev ?? 0) + 1);
      if (memberVisibility === 'congregation') setWallPendingCount(prev => prev + 1);

      // Trigger AI two-step flow: stage 1 — verse options
      const insertedId = (inserted as any)?.id ?? null;
      setMemberAiRequestId(insertedId);
      setLastInsertedId(insertedId);
      setMemberAiContent(savedContent);
      setMemberAiCat(savedCat);
      setVerseOptions(null);
      setSelectedVerse(null);
      setGuidedPrayer(null);
      setMemberAiVisible(true);
      setMemberAiLoading(true);
      getVerseOptions(savedContent, savedCat).then(opts => {
        setVerseOptions(opts);
        setMemberAiLoading(false);
      });
    } catch (err: any) {
      setMemberErr(err.message ?? 'Error al guardar');
    } finally {
      setMemberSubmitting(false);
    }
  };

  // Stage 1 → Stage 2: user picked a verse, generate the contextual prayer
  const handleSelectVerse = (option: VerseOption) => {
    setSelectedVerse(option);
    setGuidedPrayer(null);
    setGuidedLoading(true);
    getGuidedPrayer(memberAiContent, memberAiCat, option.verse, option.verseRef).then(gp => {
      setGuidedPrayer(gp);
      setGuidedLoading(false);
    });
  };

  const handleSaveAiToRequest = async () => {
    const targetId = lastInsertedId ?? memberAiRequestId;
    setMemberAiSaving(true);
    if (targetId && selectedVerse && guidedPrayer) {
      await supabase.from('prayer_requests').update({
        ai_verse:  `${selectedVerse.verse} — ${selectedVerse.verseRef} (${selectedVerse.angle})`,
        ai_prayer: guidedPrayer.prayer,
      }).eq('id', targetId);
      fetchMemberPrayers();
    }
    setMemberAiSaving(false);
    setMemberAiVisible(false);
    setVerseOptions(null);
    setSelectedVerse(null);
    setGuidedPrayer(null);
    setMemberAiRequestId(null);
    setLastInsertedId(null);
  };

  // ── Circles (Member) ──
  const fetchCircles = useCallback(async () => {
    if (!currentUserId) return;
    const { data } = await supabase
      .from('circles')
      .select('*')
      .or(`owner_id.eq.${currentUserId},member_id.eq.${currentUserId}`)
      .eq('status', 'accepted');
    setCircles(data ?? []);
  }, [currentUserId]);

  const fetchPendingInvitations = useCallback(async () => {
    if (!currentUserId) return;
    const { data } = await supabase
      .from('circles')
      .select('*')
      .eq('member_id', currentUserId)
      .eq('status', 'pending');
    const inv = data ?? [];
    setPendingInvitations(inv);
    setPendingInviteCount(inv.length);
  }, [currentUserId]);

  useEffect(() => {
    if (currentUserId && currentUserRole && currentUserRole !== 'pastor') {
      fetchCircles();
      fetchPendingInvitations();
    }
  }, [currentUserId, currentUserRole, fetchCircles, fetchPendingInvitations]);

  const searchMembers = useCallback((query: string) => {
    setCircleSearch(query);
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!query.trim()) { setSearchResults([]); return; }
    searchDebounceRef.current = setTimeout(async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name')
        .ilike('full_name', `%${query.trim()}%`)
        .neq('id', currentUserId ?? '')
        .limit(10);
      setSearchResults(data ?? []);
    }, 400);
  }, [currentUserId]);

  const inviteToCircle = async (memberId: string) => {
    if (!currentUserId) return;
    setCircleInviting(memberId);
    await supabase.from('circles').insert({
      owner_id:    currentUserId,
      member_id:   memberId,
      circle_type: selectedCircleType,
      status:      'pending',
    });
    setCircleInviting(null);
    setCircleSearch('');
    setSearchResults([]);
  };

  const acceptCircle = async (circleId: string) => {
    await supabase.from('circles').update({ status: 'accepted' }).eq('id', circleId);
    await fetchPendingInvitations();
    await fetchCircles();
  };

  const declineCircle = async (circleId: string) => {
    await supabase.from('circles').update({ status: 'declined' }).eq('id', circleId);
    await fetchPendingInvitations();
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
    setAiSuggestion(null);
    setAiLoading(false);
  };

  // Stats computed from all requests regardless of modoHoy filter
  const allReqs = requests;
  const stats = {
    active:       allReqs.filter(r => r.status !== 'victory').length,
    unassigned:   allReqs.filter(r => !r.assigned_to && r.status === 'incoming').length,
    battle:       allReqs.filter(r => r.status === 'in_battle').length,
    victoriasHoy: allReqs.filter(r => r.status === 'victory').length,
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
        user_id:      user.id,
        space_type:   'ministry',
        category:     newCat,
        title:        newName.trim() || null,
        content:      newContent.trim(),
        country_code: newCountry.toUpperCase().trim() || null,
        urgent:       newUrgent,
        status:       'incoming',
        visibility:   newVisibility,
        anonymous:    newAnonymous,
        wall_pending: newVisibility === 'congregation',
        wall_approved: false,
        pray_count:   0,
      });
      if (error) throw error;
      setNewName(''); setNewCountry(''); setNewCat('salud');
      setNewContent(''); setNewUrgent(false);
      setNewVisibility('congregation'); setNewAnonymous(false);
      setShowNewForm(false);
      if (newVisibility === 'congregation') setWallPendingCount(prev => prev + 1);
    } catch (err: any) {
      setSubmitErr(err.message ?? 'Error al guardar');
    } finally {
      setSubmitting(false);
    }
  };

  const selectedCatColor = selected ? (CAT_COLORS[selected.category ?? ''] ?? '#7c3aed') : '#7c3aed';
  const statusStep = selected ? getStatusStep(selected) : 0;

  // ── Loading gate — wait for profile fetch before rendering anything ──
  if (profileLoading) {
    return (
      <View style={[w.root, { justifyContent: 'center', alignItems: 'center' }]}>
        <ActivityIndicator color="#7c3aed" size="large" />
      </View>
    );
  }

  // PART 2 — Profile completion screen (shown when full_name is missing)
  if (!profile?.full_name || profile.full_name.trim().length === 0) {
    return (
      <View style={[w.root, { flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }]}>
        <ScrollView contentContainerStyle={{ paddingHorizontal: 32, paddingVertical: 40, alignItems: 'center', maxWidth: 400, width: '100%', alignSelf: 'center' as any }}>
          <Ionicons name="person-circle-outline" size={56} color="#7c3aed" />
          <Text style={{ color: '#f8fafc', fontSize: 22, fontWeight: '700', marginTop: 16, marginBottom: 6 }}>Completa tu perfil</Text>
          <Text style={{ color: '#475569', fontSize: 14, textAlign: 'center', marginBottom: 28 }}>
            Antes de continuar, dinos cómo llamarte.
          </Text>

          <Text style={[w.sectionLbl, { alignSelf: 'flex-start' as any }]}>NOMBRE COMPLETO *</Text>
          <TextInput
            style={[w.formInput as any, { marginBottom: 16, width: '100%' as any }]}
            placeholder="Tu nombre completo"
            placeholderTextColor="#475569"
            value={profileNombre}
            onChangeText={setProfileNombre}
            autoCapitalize="words"
          />

          <Text style={[w.sectionLbl, { alignSelf: 'flex-start' as any }]}>IGLESIA (opcional)</Text>
          <TextInput
            style={[w.formInput as any, { marginBottom: 16, width: '100%' as any }]}
            placeholder="Nombre de tu iglesia"
            placeholderTextColor="#475569"
            value={profileIglesia}
            onChangeText={setProfileIglesia}
          />

          <Text style={[w.sectionLbl, { alignSelf: 'flex-start' as any }]}>PAÍS (opcional)</Text>
          <CountrySelect value={profilePaisSetup} onChange={setProfilePaisSetup} />

          {profileErr ? <Text style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>{profileErr}</Text> : null}

          <Pressable
            style={[w.victoriaBtn, { backgroundColor: '#7c3aed', width: '100%' as any }]}
            onPress={handleProfileSave}
            disabled={profileSaving}
          >
            {profileSaving
              ? <ActivityIndicator color="#fff" />
              : <Text style={[w.victoriaTxt, { color: '#fff' }]}>Continuar →</Text>}
          </Pressable>

          <Pressable onPress={() => supabase.auth.signOut()} style={{ marginTop: 20 }}>
            <Text style={{ color: '#334155', fontSize: 13 }}>Cerrar sesión</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }

  // PART 5 — Members see their personal prayer space
  if (currentUserRole !== 'pastor') {
    const MEMBER_CIRCLES = [
      { key: 'personal',  label: 'Personal',   icon: 'person-outline',  color: '#7c3aed' },
      { key: 'family',    label: 'Familia',     icon: 'home-outline',    color: '#2563eb' },
      { key: 'friends',   label: 'Amigos',      icon: 'people-outline',  color: '#059669' },
      { key: 'ministry',  label: 'Ministerio',  icon: 'shield-outline',  color: '#d97706' },
    ] as const;
    const VIS_OPTIONS = [
      { key: 'private',      label: 'Privada',      desc: 'Solo yo',           icon: 'lock-closed-outline' },
      { key: 'circle',       label: 'Mi círculo',   desc: 'Familia y amigos',  icon: 'people-outline' },
      { key: 'congregation', label: 'Congregación', desc: 'Pared de oración',  icon: 'earth-outline' },
    ] as const;

    return (
      <View style={w.root}>
        {/* Sidebar */}
        <View style={w.sidebar}>
          <View style={w.sidebarBrand}>
            <Ionicons name="shield" size={22} color="#7c3aed" />
            <Text style={w.sidebarBrandTxt}>War Room</Text>
          </View>
          <View style={w.pastorRow}>
            <View style={w.pastorAvatar}>
              <Text style={w.pastorAvatarTxt}>{getInitials(currentUserName || 'ME')}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={w.pastorName}>{currentUserName || 'Hermano/a'}</Text>
              <Text style={w.pastorSub}>Miembro</Text>
            </View>
          </View>
          <View style={w.sidebarDivider} />
          {MEMBER_CIRCLES.map(c => (
            <Pressable
              key={c.key}
              style={[w.navItem, memberCircle === c.key && w.navItemActive]}
              onPress={() => { setMemberCircle(c.key as any); setMemberShowForm(false); setCircleTab('members'); }}
            >
              <Ionicons name={c.icon as any} size={18} color={memberCircle === c.key ? '#a78bfa' : '#475569'} />
              <Text style={[w.navLabel, memberCircle === c.key && w.navLabelActive]}>{c.label}</Text>
            </Pressable>
          ))}

          {/* Mi equipo section */}
          <View style={w.sidebarDivider} />
          <Text style={[w.sectionLbl, { marginBottom: 8, marginLeft: 4 }]}>MI EQUIPO</Text>

          {pendingInviteCount > 0 && (
            <View style={{ backgroundColor: '#7c3aed22', borderRadius: 10, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: '#7c3aed44' }}>
              <Text style={{ color: '#a78bfa', fontSize: 12, fontWeight: '600' }}>
                🔔 {pendingInviteCount} invitación{pendingInviteCount > 1 ? 'es' : ''} pendiente{pendingInviteCount > 1 ? 's' : ''}
              </Text>
              {pendingInvitations.slice(0, 3).map((inv: any) => (
                <View key={inv.id} style={{ marginTop: 8 }}>
                  <Text style={{ color: '#cbd5e1', fontSize: 11, marginBottom: 4 }}>
                    Alguien te invitó a su círculo
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    <Pressable
                      style={{ backgroundColor: '#7c3aed', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}
                      onPress={() => acceptCircle(inv.id)}
                    >
                      <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>Aceptar</Text>
                    </Pressable>
                    <Pressable
                      style={{ backgroundColor: '#1e293b', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 }}
                      onPress={() => declineCircle(inv.id)}
                    >
                      <Text style={{ color: '#475569', fontSize: 11 }}>Rechazar</Text>
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
          )}

          {circles.length === 0 ? (
            <Text style={{ color: '#1e293b', fontSize: 12, marginBottom: 8, marginLeft: 4 }}>Sin conexiones aún</Text>
          ) : (
            circles.slice(0, 4).map((c: any) => {
              const otherId = c.owner_id === currentUserId ? c.member_id : c.owner_id;
              const shortId = (otherId ?? '??').slice(0, 2).toUpperCase();
              return (
                <View key={c.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <View style={[w.assignedAvatarBig, { width: 28, height: 28, borderRadius: 14 }]}>
                    <Text style={[w.assignedAvatarTxt, { fontSize: 10 }]}>{shortId}</Text>
                  </View>
                  <Text style={{ color: '#64748b', fontSize: 12, flex: 1 }} numberOfLines={1}>Miembro del círculo</Text>
                </View>
              );
            })
          )}

          <Pressable
            style={[w.navItem, { borderStyle: 'dashed', borderWidth: 1, borderColor: '#334155', borderRadius: 8 }]}
            onPress={() => { setCircleTab('add'); setMemberShowForm(false); }}
          >
            <Ionicons name="person-add-outline" size={16} color="#475569" />
            <Text style={[w.navLabel, { fontSize: 12 }]}>+ Agregar miembro</Text>
          </Pressable>

          <View style={{ flex: 1 }} />
          <Pressable style={w.signOutBtn} onPress={() => supabase.auth.signOut()}>
            <Ionicons name="log-out-outline" size={15} color="#475569" />
            <Text style={w.signOutTxt}>Salir</Text>
          </Pressable>
        </View>

        {/* Main area */}
        <View style={{ flex: 1 }}>
          <View style={[w.statsBar, { alignItems: 'center' }]}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600', flex: 1 }}>
              {MEMBER_CIRCLES.find(c => c.key === memberCircle)?.label ?? 'Personal'}
            </Text>
            <Pressable style={w.newBtn} onPress={() => setMemberShowForm(v => !v)}>
              <Ionicons name={memberShowForm ? 'close' : 'add'} size={16} color="#fff" />
              <Text style={w.newBtnTxt}>{memberShowForm ? 'Cancelar' : 'Nueva Petición'}</Text>
            </Pressable>
          </View>

          <View style={w.columns}>
            {/* Prayer list */}
            <View style={w.feed}>
              {memberLoading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator color="#7c3aed" />
                </View>
              ) : memberTotalCount === 0 ? (
                /* Welcome empty state — user has 0 requests across ALL circles */
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 0 }}>
                  <Ionicons name="heart-outline" size={64} color="#475569" />
                  <Text style={{ color: '#fff', fontFamily: 'serif', fontSize: 22, fontWeight: '700', marginTop: 20, textAlign: 'center' }}>
                    Bienvenido a tu War Room
                  </Text>
                  <Text style={{ color: '#475569', fontSize: 14, textAlign: 'center', maxWidth: 320, marginTop: 10, lineHeight: 21 }}>
                    Este es tu espacio personal de oración. Empieza agregando tu primera petición.
                  </Text>
                  <Pressable
                    style={[w.newBtn, { marginTop: 24, paddingHorizontal: 24, paddingVertical: 12 }]}
                    onPress={() => { setMemberShowForm(true); setCircleTab('members'); }}
                  >
                    <Ionicons name="add" size={18} color="#fff" />
                    <Text style={[w.newBtnTxt, { fontSize: 15 }]}>Nueva Petición</Text>
                  </Pressable>

                  {/* Secondary: join a ministry */}
                  <View style={[w.card, { marginTop: 40, padding: 20, maxWidth: 360, width: '100%' as any, alignItems: 'center' }]}>
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '500', marginBottom: 6, textAlign: 'center' }}>
                      ¿Tu iglesia usa War Room?
                    </Text>
                    <Text style={{ color: '#475569', fontSize: 13, textAlign: 'center', marginBottom: 16, lineHeight: 19 }}>
                      Conéctate con tu ministerio para sumar fuerzas en oración.
                    </Text>
                    <Pressable
                      style={{ borderWidth: 1, borderColor: '#334155', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 10 }}
                      onPress={() => { setCircleTab('add'); setSelectedCircleType('ministry'); setMemberShowForm(false); }}
                    >
                      <Text style={{ color: '#94a3b8', fontSize: 13, fontWeight: '600' }}>Unirme a un ministerio</Text>
                    </Pressable>
                  </View>
                </ScrollView>
              ) : (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 8 }}>
                  {memberPrayers.length === 0 && (
                    <View style={{ paddingTop: 48, alignItems: 'center', gap: 10 }}>
                      <Ionicons name="heart-outline" size={44} color="#1e293b" />
                      <Text style={{ color: '#334155', fontSize: 14 }}>No hay peticiones en este espacio</Text>
                      <Text style={{ color: '#1e293b', fontSize: 12 }}>Toca "Nueva Petición" para agregar una</Text>
                    </View>
                  )}
                  {memberPrayers.map((item: any) => (
                    <View key={item.id} style={w.card}>
                      <View style={[w.cardRow, { marginBottom: 8 }]}>
                        <View style={[w.badge, { backgroundColor: (CAT_COLORS[item.category] ?? '#7c3aed') + '22', borderColor: (CAT_COLORS[item.category] ?? '#7c3aed') + '55' }]}>
                          <Text style={[w.badgeTxt, { color: CAT_COLORS[item.category] ?? '#7c3aed' }]}>
                            {item.category ? item.category.charAt(0).toUpperCase() + item.category.slice(1) : 'Otro'}
                          </Text>
                        </View>
                        {item.urgent && <View style={w.urgentBadge}><Text style={w.urgentTxt}>⚡ URGENTE</Text></View>}
                        <Text style={w.cardTime}>{timeAgo(item.created_at)}</Text>
                      </View>
                      <Text style={[w.cardExcerpt, { marginBottom: 8 }]}>{item.content}</Text>
                      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' as any }}>
                        {item.visibility === 'congregation' && (
                          <View style={[w.badge, { backgroundColor: '#0c4a6e22', borderColor: '#0284c755' }]}>
                            <Text style={[w.badgeTxt, { color: '#38bdf8' }]}>
                              {item.wall_approved ? '🌍 En pared' : item.wall_pending ? '⏳ Pendiente' : '🌍 Congregación'}
                            </Text>
                          </View>
                        )}
                        {item.status === 'victory' && (
                          <View style={[w.badge, { backgroundColor: '#78350f22', borderColor: '#fbbf2455' }]}>
                            <Text style={[w.badgeTxt, { color: '#fbbf24' }]}>🏆 Victoria</Text>
                          </View>
                        )}
                        {(item.pray_count ?? 0) > 0 && (
                          <View style={[w.badge, { backgroundColor: '#1e1b4b', borderColor: '#7c3aed44' }]}>
                            <Text style={[w.badgeTxt, { color: '#a78bfa' }]}>🙏 {item.pray_count}</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  ))}
                </ScrollView>
              )}
            </View>

            {/* Form panel + AI overlay */}
            <View style={w.detail}>
              {circleTab === 'add' ? (
                <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 20 }}>
                    <Text style={w.detailName}>Agregar a mi equipo</Text>
                    <Pressable style={{ marginLeft: 'auto' as any }} onPress={() => setCircleTab('members')}>
                      <Ionicons name="close" size={20} color="#475569" />
                    </Pressable>
                  </View>

                  <Text style={w.sectionLbl}>TIPO DE CÍRCULO</Text>
                  <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
                    {(['family', 'friends', 'ministry'] as const).map(t => (
                      <Pressable
                        key={t}
                        style={[w.catPill, selectedCircleType === t && w.catPillActive]}
                        onPress={() => setSelectedCircleType(t)}
                      >
                        <Text style={[w.catPillTxt, selectedCircleType === t && { color: '#fff' }]}>
                          {t === 'family' ? 'Familia' : t === 'friends' ? 'Amigos' : 'Ministerio'}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={w.sectionLbl}>BUSCAR MIEMBRO</Text>
                  <View style={[w.searchBar, { marginBottom: 12 }]}>
                    <Ionicons name="search-outline" size={16} color="#475569" />
                    <TextInput
                      style={w.searchInput as any}
                      placeholder="Nombre del miembro…"
                      placeholderTextColor="#475569"
                      value={circleSearch}
                      onChangeText={searchMembers}
                    />
                  </View>

                  {searchResults.length === 0 && circleSearch.trim().length > 0 && (
                    <Text style={{ color: '#334155', fontSize: 13 }}>Sin resultados para "{circleSearch}"</Text>
                  )}
                  {searchResults.map((member: any) => (
                    <View key={member.id} style={[w.card, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8 }]}>
                      <View style={[w.assignedAvatarBig, { width: 36, height: 36, borderRadius: 18 }]}>
                        <Text style={[w.assignedAvatarTxt, { fontSize: 12 }]}>{getInitials(member.full_name ?? '?')}</Text>
                      </View>
                      <Text style={{ color: '#e2e8f0', fontSize: 14, flex: 1 }}>{member.full_name}</Text>
                      <Pressable
                        style={[w.victoriaBtn, { paddingHorizontal: 16, paddingVertical: 8, marginBottom: 0, opacity: circleInviting === member.id ? 0.6 : 1 }]}
                        disabled={circleInviting === member.id}
                        onPress={() => inviteToCircle(member.id)}
                      >
                        {circleInviting === member.id
                          ? <ActivityIndicator size="small" color="#fff" />
                          : <Text style={[w.victoriaTxt, { color: '#fff', fontSize: 12 }]}>Invitar</Text>}
                      </Pressable>
                    </View>
                  ))}

                  {circles.length > 0 && (
                    <>
                      <Text style={[w.sectionLbl, { marginTop: 20 }]}>EQUIPO ACTUAL</Text>
                      {circles.map((c: any) => {
                        const otherId = c.owner_id === currentUserId ? c.member_id : c.owner_id;
                        const shortId = (otherId ?? '??').slice(0, 2).toUpperCase();
                        return (
                          <View key={c.id} style={[w.card, { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, marginBottom: 8 }]}>
                            <View style={[w.assignedAvatarBig, { width: 36, height: 36, borderRadius: 18 }]}>
                              <Text style={[w.assignedAvatarTxt, { fontSize: 12 }]}>{shortId}</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ color: '#e2e8f0', fontSize: 13, fontWeight: '600' }}>Miembro del círculo</Text>
                              <Text style={{ color: '#475569', fontSize: 11 }}>
                                {c.circle_type === 'family' ? 'Familia' : c.circle_type === 'friends' ? 'Amigos' : 'Ministerio'}
                              </Text>
                            </View>
                            <View style={[w.badge, { backgroundColor: '#14532d22', borderColor: '#4ade8044' }]}>
                              <Text style={[w.badgeTxt, { color: '#4ade80' }]}>Activo</Text>
                            </View>
                          </View>
                        );
                      })}
                    </>
                  )}
                </ScrollView>
              ) : memberAiVisible ? (
                <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                    <Text style={{ fontSize: 20 }}>✨</Text>
                    <Text style={{ color: '#a78bfa', fontSize: 16, fontWeight: '600', flex: 1 }}>Palabra para ti</Text>
                    <Pressable onPress={() => { setMemberAiVisible(false); setVerseOptions(null); setSelectedVerse(null); setGuidedPrayer(null); }}>
                      <Ionicons name="close" size={20} color="#475569" />
                    </Pressable>
                  </View>

                  {memberAiLoading ? (
                    /* Loading stage 1 */
                    <View style={[w.aiCard, { flexDirection: 'row', alignItems: 'center', gap: 12 }]}>
                      <ActivityIndicator color="#a78bfa" />
                      <Text style={{ color: '#64748b', fontSize: 13 }}>Buscando versículos para tu situación…</Text>
                    </View>
                  ) : selectedVerse ? (
                    /* ── STAGE 2 — selected verse + guided prayer ── */
                    <>
                      <View style={[w.aiCard, { marginBottom: 12, borderColor: '#7c3aed', borderWidth: 1 }]}>
                        <Text style={{ color: '#a78bfa', fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' as any, marginBottom: 8 }}>
                          {selectedVerse.angle}
                        </Text>
                        <Text style={{ color: '#c4b5fd', fontSize: 14, fontStyle: 'italic', lineHeight: 22 }}>
                          {selectedVerse.verse}
                        </Text>
                        <Text style={{ color: '#7c3aed', fontSize: 12, textAlign: 'right', marginTop: 6 }}>
                          {selectedVerse.verseRef}
                        </Text>
                      </View>

                      {guidedLoading ? (
                        <View style={[w.aiCard, { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 12 }]}>
                          <ActivityIndicator color="#a78bfa" />
                          <Text style={{ color: '#64748b', fontSize: 13 }}>Escribiendo tu oración guiada…</Text>
                        </View>
                      ) : guidedPrayer ? (
                        <>
                          <View style={[w.aiCard, { marginBottom: 12 }]}>
                            <Text style={[w.sectionLbl, { marginBottom: 6 }]}>🙏 ORACIÓN GUIADA</Text>
                            <Text style={{ color: '#94a3b8', fontSize: 13, lineHeight: 20 }}>
                              {guidedPrayer.prayer}
                            </Text>
                          </View>

                          <View style={[w.aiCard, { marginBottom: 20 }]}>
                            <Text style={{ color: '#e2e8f0', fontSize: 14, fontStyle: 'italic', lineHeight: 22 }}>
                              💡 {guidedPrayer.encouragement}
                            </Text>
                          </View>

                          <Pressable
                            style={[w.victoriaBtn, { backgroundColor: '#7c3aed', marginBottom: 10 }]}
                            onPress={handleSaveAiToRequest}
                            disabled={memberAiSaving}
                          >
                            {memberAiSaving
                              ? <ActivityIndicator color="#fff" />
                              : <Text style={[w.victoriaTxt, { color: '#fff' }]}>Guardar con mi petición</Text>}
                          </Pressable>
                        </>
                      ) : null}

                      <Pressable
                        style={{ alignItems: 'center', paddingVertical: 10 }}
                        onPress={() => { setSelectedVerse(null); setGuidedPrayer(null); }}
                      >
                        <Text style={{ color: '#a78bfa', fontSize: 13 }}>← Elegir otro versículo</Text>
                      </Pressable>
                    </>
                  ) : verseOptions ? (
                    /* ── STAGE 1 — pick one of 3 verses ── */
                    <>
                      <Text style={{ color: '#94a3b8', fontSize: 13, marginBottom: 14 }}>
                        Elige el versículo que más resuene contigo:
                      </Text>
                      {verseOptions.map((opt, i) => (
                        <Pressable
                          key={i}
                          style={({ pressed }) => [w.aiCard, { marginBottom: 10 }, pressed && { borderColor: '#7c3aed', opacity: 0.9 }]}
                          onPress={() => handleSelectVerse(opt)}
                        >
                          <Text style={{ color: '#a78bfa', fontSize: 10, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' as any, marginBottom: 8 }}>
                            {opt.angle}
                          </Text>
                          <Text style={{ color: '#c4b5fd', fontSize: 14, fontStyle: 'italic', lineHeight: 22 }}>
                            {opt.verse}
                          </Text>
                          <Text style={{ color: '#7c3aed', fontSize: 12, textAlign: 'right', marginTop: 6 }}>
                            {opt.verseRef}
                          </Text>
                        </Pressable>
                      ))}
                      <Pressable
                        style={{ alignItems: 'center', paddingVertical: 10 }}
                        onPress={() => { setMemberAiVisible(false); setVerseOptions(null); }}
                      >
                        <Text style={{ color: '#475569', fontSize: 13 }}>Cerrar</Text>
                      </Pressable>
                    </>
                  ) : null}
                </ScrollView>
              ) : memberShowForm ? (
                <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
                  <Text style={w.detailName}>Nueva Petición</Text>
                  <Text style={{ color: '#475569', fontSize: 12, marginBottom: 20, marginTop: 4 }}>
                    {MEMBER_CIRCLES.find(c => c.key === memberCircle)?.label}
                  </Text>

                  <Text style={w.sectionLbl}>CATEGORÍA</Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap' as any, gap: 8, marginBottom: 16 }}>
                    {NEW_CATS.map(cat => (
                      <Pressable key={cat} style={[w.catPill, memberCat === cat && w.catPillActive]} onPress={() => setMemberCat(cat)}>
                        <Text style={[w.catPillTxt, memberCat === cat && { color: '#fff' }]}>
                          {cat.charAt(0).toUpperCase() + cat.slice(1)}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <Text style={w.sectionLbl}>PETICIÓN</Text>
                  <TextInput
                    style={[w.noteInput as any, { minHeight: 100, marginBottom: 16 }]}
                    placeholder="Escribe tu petición…"
                    placeholderTextColor="#475569"
                    value={memberContent}
                    onChangeText={setMemberContent}
                    multiline
                    textAlignVertical="top"
                  />

                  <Text style={w.sectionLbl}>VISIBILIDAD</Text>
                  {VIS_OPTIONS.map(v => (
                    <Pressable
                      key={v.key}
                      style={[w.card, { marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }, memberVisibility === v.key && { borderColor: '#7c3aed', borderWidth: 2 }]}
                      onPress={() => setMemberVisibility(v.key as any)}
                    >
                      <Ionicons name={v.icon as any} size={18} color={memberVisibility === v.key ? '#a78bfa' : '#475569'} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: memberVisibility === v.key ? '#e2e8f0' : '#64748b', fontWeight: '600', fontSize: 13 }}>{v.label}</Text>
                        <Text style={{ color: '#334155', fontSize: 11 }}>{v.desc}</Text>
                      </View>
                      {memberVisibility === v.key && <Ionicons name="checkmark-circle" size={18} color="#7c3aed" />}
                    </Pressable>
                  ))}

                  {memberVisibility === 'congregation' && (
                    <Pressable
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 }}
                      onPress={() => setMemberAnonymous(v => !v)}
                    >
                      <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: memberAnonymous ? '#7c3aed' : '#334155', backgroundColor: memberAnonymous ? '#7c3aed' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                        {memberAnonymous && <Ionicons name="checkmark" size={12} color="#fff" />}
                      </View>
                      <Text style={{ color: '#64748b', fontSize: 13 }}>Publicar como anónimo</Text>
                    </Pressable>
                  )}

                  <View style={[w.cardRow, { marginBottom: 16, marginTop: 8 }]}>
                    <Text style={[w.sectionLbl, { marginBottom: 0 }]}>¿URGENTE?</Text>
                    <Switch
                      value={memberUrgent}
                      onValueChange={setMemberUrgent}
                      trackColor={{ false: '#1e293b', true: '#7c3aed' }}
                      thumbColor={memberUrgent ? '#a78bfa' : '#475569'}
                    />
                  </View>

                  {memberErr ? <Text style={{ color: '#f87171', fontSize: 12, marginBottom: 12 }}>{memberErr}</Text> : null}

                  <Pressable
                    style={[w.victoriaBtn, { backgroundColor: '#7c3aed' }]}
                    onPress={handleMemberSubmit}
                    disabled={memberSubmitting}
                  >
                    {memberSubmitting
                      ? <ActivityIndicator color="#fff" />
                      : <Text style={[w.victoriaTxt, { color: '#fff' }]}>Guardar Petición</Text>}
                  </Pressable>
                </ScrollView>
              ) : (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <Ionicons name="heart-outline" size={40} color="#334155" />
                  <Text style={w.detailEmpty}>Agrega una nueva petición</Text>
                </View>
              )}
            </View>
          </View>
        </View>
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
            <Text style={w.pastorSub}>
              {currentUserRole === 'pastor' ? 'Pastor' : currentUserRole === 'intercessor' ? 'Intercesor' : 'Miembro'}
            </Text>
          </View>
        </View>

        <View style={w.sidebarDivider} />

        {WEB_NAV.map(item => {
          const count =
            item.key === 'incoming'  ? stats.active       :
            item.key === 'in_battle' ? stats.battle       :
            item.key === 'victory'   ? stats.victoriasHoy :
            item.key === 'wall'      ? wallPendingCount   : undefined;
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

        {/* ══ PARED DE ORACIÓN PANEL ══ */}
        {activeNav === 'wall' ? (
          <View style={{ flex: 1, flexDirection: 'row' }}>
            {/* Wall list */}
            <View style={[w.feed, { borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,0.06)' }]}>
              {/* Tabs: Aprobadas / Pendientes */}
              <View style={{ flexDirection: 'row', margin: 16, backgroundColor: 'rgba(255,255,255,0.06)', borderRadius: 12, padding: 4 }}>
                <Pressable
                  style={[{ flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10 }, wallTab === 'approved' && { backgroundColor: '#7c3aed' }]}
                  onPress={() => setWallTab('approved')}
                >
                  <Text style={{ color: wallTab === 'approved' ? '#fff' : '#64748b', fontWeight: '600', fontSize: 14 }}>Aprobadas</Text>
                </Pressable>
                <Pressable
                  style={[{ flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 10, flexDirection: 'row', justifyContent: 'center', gap: 6 }, wallTab === 'pending' && { backgroundColor: '#7c3aed' }]}
                  onPress={() => setWallTab('pending')}
                >
                  <Text style={{ color: wallTab === 'pending' ? '#fff' : '#64748b', fontWeight: '600', fontSize: 14 }}>Pendientes</Text>
                  {wallPendingCount > 0 && (
                    <View style={w.navBadge}>
                      <Text style={w.navBadgeTxt}>{wallPendingCount}</Text>
                    </View>
                  )}
                </Pressable>
              </View>

              {wallLoading ? (
                <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                  <ActivityIndicator color="#7c3aed" />
                </View>
              ) : (
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 10 }}>
                  {wallTab === 'approved' ? (
                    wallRequests.filter((r: any) => r.wall_approved).length === 0 ? (
                      <View style={{ paddingTop: 48, alignItems: 'center', gap: 10 }}>
                        <Ionicons name="earth-outline" size={44} color="#1e293b" />
                        <Text style={{ color: '#334155', fontSize: 14 }}>No hay peticiones aprobadas en la pared</Text>
                      </View>
                    ) : wallRequests.filter((r: any) => r.wall_approved).map((r: any) => (
                      <View key={r.id} style={w.card}>
                        <View style={w.cardRow}>
                          <View style={[w.badge, { backgroundColor: (CAT_COLORS[r.category] ?? '#7c3aed') + '22', borderColor: (CAT_COLORS[r.category] ?? '#7c3aed') + '55' }]}>
                            <Text style={[w.badgeTxt, { color: CAT_COLORS[r.category] ?? '#7c3aed' }]}>
                              {r.category ? r.category.charAt(0).toUpperCase() + r.category.slice(1) : 'Otro'}
                            </Text>
                          </View>
                          <Text style={w.cardTime}>{timeAgo(r.created_at)}</Text>
                        </View>
                        {!r.anonymous && r.title && (
                          <Text style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>{r.title} {toFlag(r.country_code)}</Text>
                        )}
                        <Text style={w.cardExcerpt}>{r.content}</Text>
                        <Pressable
                          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12, alignSelf: 'flex-start' as any, backgroundColor: '#1e1b4b', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}
                          onPress={() => handleWallPray(r.id)}
                        >
                          <Text style={{ fontSize: 14 }}>🙏</Text>
                          <Text style={{ color: '#a78bfa', fontWeight: '600', fontSize: 13 }}>
                            Orar{(r.pray_count ?? 0) > 0 ? ` (${r.pray_count})` : ''}
                          </Text>
                        </Pressable>
                      </View>
                    ))
                  ) : (
                    wallRequests.filter((r: any) => r.wall_pending && !r.wall_approved).length === 0 ? (
                      <View style={{ paddingTop: 48, alignItems: 'center', gap: 10 }}>
                        <Ionicons name="checkmark-circle-outline" size={44} color="#1e293b" />
                        <Text style={{ color: '#334155', fontSize: 14 }}>No hay peticiones pendientes</Text>
                      </View>
                    ) : wallRequests.filter((r: any) => r.wall_pending && !r.wall_approved).map((r: any) => (
                      <View key={r.id} style={w.card}>
                        <View style={w.cardRow}>
                          <View style={[w.badge, { backgroundColor: (CAT_COLORS[r.category] ?? '#7c3aed') + '22', borderColor: (CAT_COLORS[r.category] ?? '#7c3aed') + '55' }]}>
                            <Text style={[w.badgeTxt, { color: CAT_COLORS[r.category] ?? '#7c3aed' }]}>
                              {r.category ? r.category.charAt(0).toUpperCase() + r.category.slice(1) : 'Otro'}
                            </Text>
                          </View>
                          {r.anonymous && (
                            <View style={[w.badge, { backgroundColor: '#33415522', borderColor: '#47556955' }]}>
                              <Text style={[w.badgeTxt, { color: '#64748b' }]}>Anónimo</Text>
                            </View>
                          )}
                          <Text style={w.cardTime}>{timeAgo(r.created_at)}</Text>
                        </View>
                        {!r.anonymous && r.title && (
                          <Text style={{ color: '#64748b', fontSize: 12, marginBottom: 6 }}>{r.title} {toFlag(r.country_code)}</Text>
                        )}
                        <Text style={w.cardExcerpt}>{r.content}</Text>
                        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
                          <Pressable
                            style={{ flex: 1, backgroundColor: '#14532d22', borderWidth: 1, borderColor: '#4ade8044', borderRadius: 8, height: 36, alignItems: 'center', justifyContent: 'center' }}
                            onPress={() => handleWallApprove(r.id)}
                          >
                            <Text style={{ color: '#4ade80', fontWeight: '600', fontSize: 13 }}>✓ Aprobar</Text>
                          </Pressable>
                          <Pressable
                            style={{ flex: 1, backgroundColor: '#7f1d1d22', borderWidth: 1, borderColor: '#f8717144', borderRadius: 8, height: 36, alignItems: 'center', justifyContent: 'center' }}
                            onPress={() => handleWallReject(r.id)}
                          >
                            <Text style={{ color: '#f87171', fontWeight: '600', fontSize: 13 }}>✕ Rechazar</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))
                  )}
                </ScrollView>
              )}
            </View>

            {/* Wall stats */}
            <View style={w.detail}>
              <View style={{ padding: 24 }}>
                <Text style={w.detailName}>Pared de Oración</Text>
                <Text style={{ color: '#475569', fontSize: 13, marginTop: 4, marginBottom: 24 }}>
                  Peticiones públicas de la congregación
                </Text>
                {[
                  { label: 'Aprobadas',     val: wallRequests.filter((r: any) => r.wall_approved).length,                     color: '#4ade80' },
                  { label: 'Pendientes',    val: wallRequests.filter((r: any) => r.wall_pending && !r.wall_approved).length,   color: '#fbbf24' },
                  { label: 'Total oraciones', val: wallRequests.reduce((s: number, r: any) => s + (r.pray_count ?? 0), 0), color: '#a78bfa' },
                ].map(stat => (
                  <View key={stat.label} style={[w.statCard, { marginBottom: 10 }]}>
                    <Text style={[w.statNum, { color: stat.color }]}>{stat.val}</Text>
                    <Text style={w.statLbl}>{stat.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>

        ) : activeNav === 'intercesores' ? (
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
          /* ══ AJUSTES — GESTIÓN DE USUARIOS ══ */
          <View style={{ flex: 1, flexDirection: 'row' }}>
            <View style={[w.feed, { borderRightWidth: 0 }]}>
              <View style={w.feedTopBar}>
                <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Text style={{ color: '#fff', fontSize: 18, fontWeight: '600' }}>Gestión de usuarios</Text>
                  {allProfiles.length > 0 && (
                    <View style={[w.badge, { backgroundColor: 'rgba(124,58,237,0.2)', borderColor: 'rgba(124,58,237,0.4)' }]}>
                      <Text style={[w.badgeTxt, { color: '#a78bfa' }]}>{allProfiles.length}</Text>
                    </View>
                  )}
                </View>
                <Pressable
                  style={{ padding: 8 }}
                  onPress={() => {
                    setProfilesLoading(true);
                    supabase.from('profiles')
                      .select('id, full_name, role, church, country')
                      .order('created_at', { ascending: true })
                      .limit(500)
                      .then(({ data, error }) => {
                        if (!error) setAllProfiles(data ?? []);
                        setProfilesLoading(false);
                      });
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
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, gap: 6 }}>
                  {allProfiles.length === 0 && (
                    <View style={{ paddingTop: 48, alignItems: 'center', gap: 10 }}>
                      <Ionicons name="people-outline" size={44} color="#1e293b" />
                      <Text style={{ color: '#334155', fontSize: 14 }}>Sin perfiles registrados</Text>
                    </View>
                  )}
                  {allProfiles.map((p: any) => {
                    const ROLE_OPTIONS = ['user', 'intercessor', 'pastor'] as const;
                    type RoleKey = typeof ROLE_OPTIONS[number];
                    const roleMeta: Record<RoleKey, { label: string; color: string; bg: string }> = {
                      pastor:      { label: 'Pastor',    color: '#a78bfa', bg: 'rgba(124,58,237,0.2)'  },
                      intercessor: { label: 'Intercesor',color: '#2dd4bf', bg: 'rgba(20,184,166,0.2)'  },
                      user:        { label: 'Miembro',   color: '#94a3b8', bg: 'rgba(100,116,139,0.2)' },
                    };
                    const meta = roleMeta[(p.role as RoleKey) ?? 'user'] ?? roleMeta.user;
                    const isUpdating = roleUpdating === p.id;
                    return (
                      <View
                        key={p.id}
                        style={{ backgroundColor: '#0f0f1a', borderRadius: 8, padding: 12, marginBottom: 6, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                      >
                        {/* Avatar */}
                        <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#1e1b4b', alignItems: 'center', justifyContent: 'center' }}>
                          <Text style={{ color: '#a78bfa', fontWeight: '700', fontSize: 13 }}>
                            {getInitials(p.full_name ?? '?')}
                          </Text>
                        </View>

                        {/* Name + church */}
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#fff', fontWeight: '500', fontSize: 14 }}>
                            {p.full_name ?? 'Sin nombre'}
                          </Text>
                          {p.church ? (
                            <Text style={{ color: '#64748b', fontSize: 12, marginTop: 1 }}>{p.church}</Text>
                          ) : null}
                        </View>

                        {/* Current role badge */}
                        <View style={[w.badge, { backgroundColor: meta.bg, borderColor: meta.color + '55' }]}>
                          <Text style={[w.badgeTxt, { color: meta.color }]}>{meta.label}</Text>
                        </View>

                        {/* Role change buttons — only show OTHER roles */}
                        {isUpdating ? (
                          <ActivityIndicator color="#7c3aed" size="small" />
                        ) : (
                          <View style={{ flexDirection: 'row', gap: 4 }}>
                            {ROLE_OPTIONS.filter(r => r !== p.role).map(r => (
                              <Pressable
                                key={r}
                                style={[w.catPill, { paddingHorizontal: 8, paddingVertical: 4 }]}
                                onPress={() => handleRoleChange(p.id, r)}
                              >
                                <Text style={[w.catPillTxt, { fontSize: 11 }]}>
                                  {roleMeta[r].label}
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

        ) : activeNav === 'stats' ? (
          /* ══ ANALYTICS PANEL ══ */
          analyticsLoading ? (
            <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
              <ActivityIndicator color="#7c3aed" size="large" />
              <Text style={{ color: '#475569', marginTop: 12 }}>Calculando estadísticas…</Text>
            </View>
          ) : (() => {
            // ── Compute analytics client-side ──
            const total = analyticsData.length;
            const victories = analyticsData.filter(r => r.status === 'victory').length;
            const victoryRate = total > 0 ? Math.round((victories / total) * 100) : 0;

            const battleItems = analyticsData.filter(r => r.status === 'victory' && r.victory_date && r.created_at);
            const avgDays = battleItems.length > 0
              ? (battleItems.reduce((sum, r) => sum + (new Date(r.victory_date).getTime() - new Date(r.created_at).getTime()) / 86400000, 0) / battleItems.length).toFixed(1)
              : '—';

            const countriesSet = new Set(analyticsData.map(r => r.country_code).filter(Boolean));

            const groupBy = (arr: any[], key: string): Record<string, number> =>
              arr.reduce((acc, item) => { const k = item[key] ?? 'otro'; acc[k] = (acc[k] ?? 0) + 1; return acc; }, {});

            const byCategory = groupBy(analyticsData, 'category');
            const byCountry  = groupBy(analyticsData, 'country_code');
            const byAssigned = groupBy(analyticsData.filter(r => r.assigned_to), 'assigned_to');

            const maxCat = Math.max(1, ...Object.values(byCategory) as number[]);

            const sortedCountries = Object.entries(byCountry)
              .filter(([k]) => k && k !== 'null')
              .sort((a, b) => (b[1] as number) - (a[1] as number))
              .slice(0, 10);
            const maxCountry = Math.max(1, ...(sortedCountries.map(([, v]) => v) as number[]));

            const profileMap: Record<string, string> = {};
            analyticsProfiles.forEach((p: any) => { profileMap[p.id] = p.full_name ?? p.id.slice(0, 8); });

            const topIntercessors = Object.entries(byAssigned)
              .sort((a, b) => (b[1] as number) - (a[1] as number))
              .slice(0, 5)
              .map(([id, cnt]) => ({ name: profileMap[id] ?? id.slice(0, 8), count: cnt as number }));

            const recentVictories = analyticsData
              .filter(r => r.status === 'victory' && r.victory_date)
              .sort((a, b) => new Date(b.victory_date).getTime() - new Date(a.victory_date).getTime())
              .slice(0, 5);

            // 8-week timeline
            const now = new Date();
            const weeks = Array.from({ length: 8 }, (_, i) => {
              const d = new Date(now);
              d.setDate(d.getDate() - 7 * (7 - i));
              d.setHours(0, 0, 0, 0);
              d.setDate(d.getDate() - d.getDay());
              return d;
            });
            const weekBuckets = weeks.map(wStart => {
              const wEnd = new Date(wStart); wEnd.setDate(wStart.getDate() + 7);
              const rows = analyticsData.filter(r => { const t = new Date(r.created_at).getTime(); return t >= wStart.getTime() && t < wEnd.getTime(); });
              return {
                label: `${wStart.getDate()}/${wStart.getMonth() + 1}`,
                total: rows.length,
                victory: rows.filter(r => r.status === 'victory').length,
              };
            });
            const maxWeek = Math.max(1, ...weekBuckets.map(w => w.total));

            return (
              <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, gap: 16 }}>
                <Text style={{ color: '#fff', fontSize: 20, fontWeight: '700', marginBottom: 4 }}>Estadísticas del Ministerio</Text>

                {/* ROW 1 — Metric cards */}
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  {[
                    { label: 'Total peticiones',    val: String(total),         color: '#a78bfa' },
                    { label: 'Tasa de victoria',    val: `${victoryRate}%`,     color: '#4ade80' },
                    { label: 'Promedio en batalla', val: `${avgDays}d`,         color: '#60a5fa' },
                    { label: 'Países alcanzados',   val: String(countriesSet.size), color: '#fbbf24' },
                  ].map(m => (
                    <View key={m.label} style={[w.statCard, { flex: 1 }]}>
                      <Text style={[w.statNum, { color: m.color, fontSize: 32 }]}>{m.val}</Text>
                      <Text style={w.statLbl}>{m.label}</Text>
                    </View>
                  ))}
                </View>

                {/* ROW 2 — Category bars + Country list */}
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  {/* Category bar chart */}
                  <View style={[w.card, { flex: 1, padding: 20 }]}>
                    <Text style={{ color: '#e2e8f0', fontWeight: '700', fontSize: 15, marginBottom: 16 }}>Por categoría</Text>
                    {NEW_CATS.map(cat => {
                      const cnt = byCategory[cat] ?? 0;
                      const pct = cnt / maxCat;
                      return (
                        <View key={cat} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                          <Text style={{ color: '#64748b', fontSize: 12, width: 72 }}>
                            {cat.charAt(0).toUpperCase() + cat.slice(1)}
                          </Text>
                          <View style={{ flex: 1, backgroundColor: '#1e1b4b', borderRadius: 4, height: 28, overflow: 'hidden' }}>
                            <View style={{ width: `${Math.max(pct * 100, cnt > 0 ? 4 : 0)}%` as any, backgroundColor: CAT_COLORS[cat] ?? '#7c3aed', height: 28, borderRadius: 4 }} />
                          </View>
                          <Text style={{ color: '#64748b', fontSize: 13, width: 28, textAlign: 'right' }}>{cnt}</Text>
                        </View>
                      );
                    })}
                  </View>

                  {/* Country list */}
                  <View style={[w.card, { flex: 1, padding: 20 }]}>
                    <Text style={{ color: '#e2e8f0', fontWeight: '700', fontSize: 15, marginBottom: 16 }}>Países alcanzados</Text>
                    {sortedCountries.length === 0 && (
                      <Text style={{ color: '#334155', fontSize: 13 }}>Sin datos de país</Text>
                    )}
                    {sortedCountries.map(([code, cnt]) => (
                      <View key={code} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <Text style={{ fontSize: 18, width: 28 }}>{toFlag(code)}</Text>
                        <Text style={{ color: '#64748b', fontSize: 12, width: 30 }}>{code}</Text>
                        <View style={{ flex: 1, backgroundColor: '#1e1b4b', borderRadius: 4, height: 20, overflow: 'hidden' }}>
                          <View style={{ width: `${((cnt as number) / maxCountry) * 100}%` as any, backgroundColor: '#3b82f6', height: 20, borderRadius: 4 }} />
                        </View>
                        <Text style={{ color: '#64748b', fontSize: 12, width: 24, textAlign: 'right' }}>{cnt as number}</Text>
                      </View>
                    ))}
                  </View>
                </View>

                {/* ROW 3 — 8-week timeline */}
                <View style={[w.card, { padding: 20 }]}>
                  <Text style={{ color: '#e2e8f0', fontWeight: '700', fontSize: 15, marginBottom: 20 }}>Últimas 8 semanas</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, height: 100 }}>
                    {weekBuckets.map((wk, i) => {
                      const barH = Math.max(4, (wk.total / maxWeek) * 80);
                      const vicH = wk.total > 0 ? (wk.victory / wk.total) * barH : 0;
                      return (
                        <View key={i} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
                          {wk.total > 0 && (
                            <Text style={{ color: '#475569', fontSize: 10 }}>{wk.total}</Text>
                          )}
                          <View style={{ width: '100%', height: barH, borderRadius: 4, overflow: 'hidden', backgroundColor: '#1e1b4b' }}>
                            <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: vicH, backgroundColor: '#f59e0b', borderRadius: 4 }} />
                            <View style={{ position: 'absolute', bottom: vicH, left: 0, right: 0, height: barH - vicH, backgroundColor: '#7c3aed', borderTopLeftRadius: 4, borderTopRightRadius: 4 }} />
                          </View>
                          <Text style={{ color: '#334155', fontSize: 9 }}>{wk.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 16, marginTop: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#7c3aed' }} />
                      <Text style={{ color: '#475569', fontSize: 11 }}>Peticiones</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#f59e0b' }} />
                      <Text style={{ color: '#475569', fontSize: 11 }}>Victorias</Text>
                    </View>
                  </View>
                </View>

                {/* ROW 4 — Intercessors + Recent victories */}
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  {/* Top intercessors */}
                  <View style={[w.card, { flex: 1, padding: 20 }]}>
                    <Text style={{ color: '#e2e8f0', fontWeight: '700', fontSize: 15, marginBottom: 16 }}>Intercesores activos</Text>
                    {topIntercessors.length === 0 && (
                      <Text style={{ color: '#334155', fontSize: 13 }}>Sin asignaciones aún</Text>
                    )}
                    {topIntercessors.map((inter, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                        <View style={[w.assignedAvatarBig, { width: 36, height: 36, borderRadius: 18 }]}>
                          <Text style={[w.assignedAvatarTxt, { fontSize: 12 }]}>{getInitials(inter.name)}</Text>
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: '#e2e8f0', fontWeight: '600', fontSize: 13 }}>{inter.name}</Text>
                          <Text style={{ color: '#475569', fontSize: 11, marginTop: 1 }}>{inter.count} peticiones asignadas</Text>
                        </View>
                        <View style={[w.badge, { backgroundColor: '#14532d22', borderColor: '#4ade8044' }]}>
                          <Text style={[w.badgeTxt, { color: '#4ade80' }]}>activo</Text>
                        </View>
                      </View>
                    ))}
                  </View>

                  {/* Recent victories */}
                  <View style={[w.card, { flex: 1, padding: 20 }]}>
                    <Text style={{ color: '#e2e8f0', fontWeight: '700', fontSize: 15, marginBottom: 16 }}>🏆 Victorias recientes</Text>
                    {recentVictories.length === 0 && (
                      <Text style={{ color: '#334155', fontSize: 13 }}>Sin victorias registradas aún</Text>
                    )}
                    {recentVictories.map((r, i) => {
                      const days = r.created_at
                        ? Math.round((new Date(r.victory_date).getTime() - new Date(r.created_at).getTime()) / 86400000)
                        : null;
                      return (
                        <View key={i} style={{ borderWidth: 1, borderColor: '#fbbf2444', borderRadius: 10, padding: 10, marginBottom: 8 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <Text style={{ fontSize: 14 }}>🏆</Text>
                            <View style={[w.badge, { backgroundColor: (CAT_COLORS[r.category] ?? '#7c3aed') + '22', borderColor: (CAT_COLORS[r.category] ?? '#7c3aed') + '55' }]}>
                              <Text style={[w.badgeTxt, { color: CAT_COLORS[r.category] ?? '#7c3aed' }]}>
                                {r.category ? r.category.charAt(0).toUpperCase() + r.category.slice(1) : 'Otro'}
                              </Text>
                            </View>
                            {days !== null && (
                              <Text style={{ color: '#fbbf24', fontSize: 11, marginLeft: 'auto' as any }}>{days}d en batalla</Text>
                            )}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </View>

                {/* ROW 5 — Sermon AI suggestion */}
                <View style={[w.card, { padding: 20 }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <Text style={{ color: '#e2e8f0', fontWeight: '700', fontSize: 15 }}>✨ Sugerencia de Sermón IA</Text>
                    <Pressable
                      style={({ pressed }) => [w.aiBtn, pressed && { opacity: 0.8 }, sermonLoading && { opacity: 0.6 }]}
                      disabled={sermonLoading || analyticsLoading}
                      onPress={() => {
                        const totalReqs = analyticsData.length;
                        const victoryReqs = analyticsData.filter((r: any) => r.status === 'victory').length;
                        const urgentReqs = analyticsData.filter((r: any) => r.urgent).length;
                        const topCat = Object.entries(
                          analyticsData.reduce((acc: any, r: any) => { if (r.category) acc[r.category] = (acc[r.category] ?? 0) + 1; return acc; }, {})
                        ).sort((a: any, b: any) => (b[1] as number) - (a[1] as number))[0]?.[0] ?? 'otro';
                        const ctx = `Congregación con ${totalReqs} peticiones. Victorias: ${victoryReqs}. Peticiones urgentes: ${urgentReqs}. Necesidad predominante: ${topCat}.`;
                        setSermonLoading(true);
                        setSermonSuggestion(null);
                        getSermonSuggestion(ctx).then(s => { setSermonSuggestion(s); setSermonLoading(false); });
                      }}
                    >
                      {sermonLoading
                        ? <ActivityIndicator size="small" color="#a78bfa" />
                        : <Text style={w.aiBtnTxt}>Generar</Text>}
                    </Pressable>
                  </View>
                  {!sermonSuggestion && !sermonLoading && (
                    <Text style={{ color: '#334155', fontSize: 13 }}>Presiona "Generar" para obtener una sugerencia de sermón basada en las necesidades actuales del rebaño.</Text>
                  )}
                  {sermonLoading && (
                    <View style={{ alignItems: 'center', paddingVertical: 20 }}>
                      <ActivityIndicator color="#7c3aed" />
                      <Text style={{ color: '#475569', fontSize: 13, marginTop: 8 }}>Preparando sugerencia pastoral…</Text>
                    </View>
                  )}
                  {sermonSuggestion && !sermonLoading && (
                    <View style={w.aiCard}>
                      <Text style={{ color: '#a78bfa', fontWeight: '700', fontSize: 16, marginBottom: 6 }}>{sermonSuggestion.title}</Text>
                      <Text style={{ color: '#7c3aed', fontSize: 12, fontStyle: 'italic', marginBottom: 10 }}>{sermonSuggestion.verseRef}</Text>
                      <Text style={{ color: '#cbd5e1', fontSize: 13, marginBottom: 14, lineHeight: 20 }}>"{sermonSuggestion.verse}"</Text>
                      <Text style={{ color: '#64748b', fontWeight: '600', fontSize: 12, marginBottom: 8 }}>BOSQUEJO</Text>
                      {sermonSuggestion.outline.map((point, i) => (
                        <View key={i} style={{ flexDirection: 'row', gap: 8, marginBottom: 6 }}>
                          <Text style={{ color: '#7c3aed', fontWeight: '700', fontSize: 13 }}>{i + 1}.</Text>
                          <Text style={{ color: '#cbd5e1', fontSize: 13, flex: 1 }}>{point}</Text>
                        </View>
                      ))}
                      <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(124,58,237,0.2)', marginTop: 10, paddingTop: 10 }}>
                        <Text style={{ color: '#a78bfa', fontSize: 12, fontStyle: 'italic' }}>{sermonSuggestion.encouragement}</Text>
                      </View>
                    </View>
                  )}
                </View>

                {/* ROW 6 — Flock insight (auto-generated) */}
                <View style={[w.card, { padding: 20 }]}>
                  <Text style={{ color: '#e2e8f0', fontWeight: '700', fontSize: 15, marginBottom: 12 }}>🕊️ Perspectiva Pastoral del Rebaño</Text>
                  {flockInsightLoading && (
                    <View style={{ alignItems: 'center', paddingVertical: 16 }}>
                      <ActivityIndicator color="#7c3aed" />
                      <Text style={{ color: '#475569', fontSize: 13, marginTop: 8 }}>Analizando el estado espiritual…</Text>
                    </View>
                  )}
                  {!flockInsight && !flockInsightLoading && analyticsData.length === 0 && (
                    <Text style={{ color: '#334155', fontSize: 13 }}>Sin datos suficientes para generar una perspectiva.</Text>
                  )}
                  {flockInsight && !flockInsightLoading && (
                    <View style={w.aiCard}>
                      <Text style={{ color: '#e2e8f0', fontSize: 14, lineHeight: 22, marginBottom: 14 }}>{flockInsight.insight}</Text>
                      <View style={{ borderLeftWidth: 3, borderLeftColor: '#7c3aed', paddingLeft: 12 }}>
                        <Text style={{ color: '#a78bfa', fontSize: 13, fontStyle: 'italic', lineHeight: 20 }}>"{flockInsight.verse}"</Text>
                        <Text style={{ color: '#7c3aed', fontSize: 12, marginTop: 4 }}>— {flockInsight.verseRef}</Text>
                      </View>
                    </View>
                  )}
                </View>

              </ScrollView>
            );
          })()

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
                  const assignName = localAssign[item.id] ?? item.assigned_to ?? null;
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

                <Text style={w.sectionLbl}>PAÍS</Text>
                <CountrySelect value={newCountry} onChange={setNewCountry} />

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

                <Text style={w.sectionLbl}>VISIBILIDAD</Text>
                {([
                  { key: 'private',      label: '🔒 Privada',      desc: 'Solo pastores/intercesores' },
                  { key: 'circle',       label: '👥 Mi círculo',   desc: 'Visible al equipo asignado' },
                  { key: 'congregation', label: '🌍 Congregación', desc: 'Enviar a la Pared de Oración' },
                ] as const).map(vis => (
                  <Pressable
                    key={vis.key}
                    style={[w.card, { marginBottom: 8, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }, newVisibility === vis.key && { borderColor: '#7c3aed', borderWidth: 2 }]}
                    onPress={() => setNewVisibility(vis.key)}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: newVisibility === vis.key ? '#e2e8f0' : '#64748b', fontWeight: '600', fontSize: 13 }}>{vis.label}</Text>
                      <Text style={{ color: '#334155', fontSize: 11 }}>{vis.desc}</Text>
                    </View>
                    {newVisibility === vis.key && <Ionicons name="checkmark-circle" size={18} color="#7c3aed" />}
                  </Pressable>
                ))}

                {newVisibility === 'congregation' && (
                  <Pressable
                    style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 }}
                    onPress={() => setNewAnonymous(v => !v)}
                  >
                    <View style={{ width: 20, height: 20, borderRadius: 4, borderWidth: 1, borderColor: newAnonymous ? '#7c3aed' : '#334155', backgroundColor: newAnonymous ? '#7c3aed' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
                      {newAnonymous && <Ionicons name="checkmark" size={12} color="#fff" />}
                    </View>
                    <Text style={{ color: '#64748b', fontSize: 13 }}>Publicar como anónimo</Text>
                  </Pressable>
                )}

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
                {(localAssign[selected.id] ?? selected.assigned_to) ? (
                  <View style={w.assignedBig}>
                    <View style={w.assignedAvatarBig}>
                      <Text style={w.assignedAvatarTxt}>
                        {getInitials(localAssign[selected.id] ?? selected.assigned_to ?? '')}
                      </Text>
                    </View>
                    <Text style={{ color: '#e2e8f0', fontSize: 15, flex: 1 }}>
                      {localAssign[selected.id] ?? selected.assigned_to ?? 'Sin asignar'}
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

                {/* ✨ AI Suggestion button */}
                <Pressable
                  style={{ backgroundColor: 'rgba(124,58,237,0.08)', borderWidth: 1, borderColor: 'rgba(124,58,237,0.2)', borderRadius: 12, height: 40, alignItems: 'center', justifyContent: 'center', marginBottom: 12, flexDirection: 'row', gap: 6 }}
                  onPress={async () => {
                    setAiLoading(true);
                    setAiSuggestion(null);
                    const result = await getAISuggestion(selected.content, selected.category ?? 'otro', 'pastor');
                    setAiSuggestion(result);
                    setAiLoading(false);
                  }}
                  disabled={aiLoading}
                >
                  {aiLoading && <ActivityIndicator color="#a78bfa" size="small" />}
                  <Text style={{ color: '#a78bfa', fontSize: 13, fontWeight: '500' }}>
                    {aiLoading ? 'Consultando IA…' : '✨ Sugerencia IA'}
                  </Text>
                </Pressable>

                {/* AI result card */}
                {aiSuggestion && (
                  <View style={[w.aiCard, { marginBottom: 12 }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                      <Text style={{ fontSize: 14 }}>✨</Text>
                      <Text style={{ color: '#a78bfa', fontSize: 14, fontWeight: '600' }}>Sugerencia pastoral</Text>
                    </View>
                    <View style={{ backgroundColor: 'rgba(124,58,237,0.08)', borderRadius: 12, padding: 14, marginBottom: 10 }}>
                      <Text style={{ color: '#c4b5fd', fontSize: 14, fontStyle: 'italic', lineHeight: 22 }}>
                        {aiSuggestion.verse}
                      </Text>
                      <Text style={{ color: '#7c3aed', fontSize: 12, textAlign: 'right', marginTop: 6 }}>
                        {aiSuggestion.verseRef}
                      </Text>
                    </View>
                    <Text style={[w.sectionLbl, { marginBottom: 4 }]}>ORACIÓN SUGERIDA</Text>
                    <Text style={{ color: '#94a3b8', fontSize: 13, lineHeight: 20, marginBottom: 12 }}>
                      {aiSuggestion.prayer}
                    </Text>
                    <Pressable
                      style={{ backgroundColor: '#1e1b4b', borderRadius: 8, height: 36, alignItems: 'center', justifyContent: 'center' }}
                      onPress={() => setNote(prev =>
                        prev
                          ? `${prev}\n\n${aiSuggestion.verseRef}: ${aiSuggestion.verse}\n\n${aiSuggestion.prayer}`
                          : `${aiSuggestion.verseRef}: ${aiSuggestion.verse}\n\n${aiSuggestion.prayer}`
                      )}
                    >
                      <Text style={{ color: '#a78bfa', fontSize: 13, fontWeight: '600' }}>Copiar como nota pastoral</Text>
                    </Pressable>
                  </View>
                )}

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

  // AI card
  aiCard:       { backgroundColor: '#0f0f1a', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(124,58,237,0.3)' },
  aiBtn:        { backgroundColor: 'rgba(124,58,237,0.15)', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, borderWidth: 1, borderColor: 'rgba(124,58,237,0.4)', alignItems: 'center', justifyContent: 'center' },
  aiBtnTxt:     { color: '#a78bfa', fontSize: 13, fontWeight: '600' },
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
