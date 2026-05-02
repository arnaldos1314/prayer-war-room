export const TEXTS = {
  es: {
    tabs: { battle: 'En Batalla', victory: 'Victorias' },
    viewMode: { personal: 'Mi Espacio', family: 'Familia' },
    create: {
      title: 'Nueva Estrategia',
      situationLabel: '1. Situación (Título corto)',
      categoryLabel: '2. Categoría',
      isPublicLabel: '¿Compartir con Familia?',
      btnGenerate: 'Consultar Sabiduría',
      saveBtn: 'Confirmar y Guardar',
    },
    detail: {
      btnVictory: '¡Declarar Victoria!',
      btnReturn: 'Regresar a Batalla',
      meditationLabel: 'MEDITACIÓN & ESTRATEGIA',
    },
    cats: { Negocios: 'Negocios', Familia: 'Familia', Salud: 'Salud', Espiritual: 'Espiritual', Amigos: 'Amigos' } as Record<string, string>,
    modes: { none: 'Normal', fasting: 'Ayuno', urgent: 'Urgente', gratitude: 'Gratitud', night: 'Vigilia' } as Record<string, string>,
  },
  en: {
    tabs: { battle: 'In Battle', victory: 'Victories' },
    viewMode: { personal: 'My Space', family: 'Family' },
    create: {
      title: 'New Strategy',
      situationLabel: '1. Situation (Short Title)',
      categoryLabel: '2. Category',
      isPublicLabel: 'Share with Family?',
      btnGenerate: 'Consult Wisdom',
      saveBtn: 'Confirm & Save',
    },
    detail: {
      btnVictory: 'Declare Victory!',
      btnReturn: 'Return to Battle',
      meditationLabel: 'MEDITATION & STRATEGY',
    },
    cats: { Negocios: 'Business', Familia: 'Family', Salud: 'Health', Espiritual: 'Spiritual', Amigos: 'Friends' } as Record<string, string>,
    modes: { none: 'Normal', fasting: 'Fasting', urgent: 'Urgent', gratitude: 'Gratitude', night: 'Vigil' } as Record<string, string>,
  },
};

export const CATEGORIES: Record<string, { icon: string; color: string; bg: string }> = {
  Negocios:  { icon: 'briefcase-outline',  color: '#2563EB', bg: '#EFF6FF' },
  Familia:   { icon: 'home-heart',         color: '#DB2777', bg: '#FDF2F8' },
  Salud:     { icon: 'heart-pulse',        color: '#DC2626', bg: '#FEF2F2' },
  Espiritual:{ icon: 'book-cross',         color: '#7C3AED', bg: '#F5F3FF' },
  Amigos:    { icon: 'account-group',      color: '#F59E0B', bg: '#FFFBEB' },
};

export const SPECIAL_MODES = [
  { id: 'none',      icon: null,                   color: '#333' },
  { id: 'fasting',   icon: 'flame',                color: '#FF4500' },
  { id: 'urgent',    icon: 'alarm-light',          color: '#EF4444' },
  { id: 'gratitude', icon: 'hand-clap',            color: '#10B981' },
  { id: 'night',     icon: 'moon-waning-crescent', color: '#6366F1' },
];
