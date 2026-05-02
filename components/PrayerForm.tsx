import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { CATEGORIES, TEXTS } from '../constants/prayer';
import { createPrayer } from '../services/prayerService';
import { AISuggestion, PrayerVisibility } from '../types/prayer';

// Mínimo de caracteres para activar el auto-suggest de Victoria
const MIN_CHARS_FOR_AUTOSUGGEST = 12;

type QuickVerse = { verse: string; bibleVersion: string; verseText: string };

type Props = {
  visible: boolean;
  onClose: () => void;
  onSaved: () => void;
  familyId: string;
  authorName: string;
  appLang: 'es' | 'en';
};

export default function PrayerForm({ visible, onClose, onSaved, familyId, authorName, appLang }: Props) {
  const t = TEXTS[appLang];
  const API_KEY = process.env.EXPO_PUBLIC_ANTHROPIC_KEY!;

  // Estado del formulario
  const [newTitle, setNewTitle] = useState('');
  const [newCategory, setNewCategory] = useState('Negocios');
  const [visibility, setVisibility] = useState<PrayerVisibility>('private');
  const [phoneContact, setPhoneContact] = useState('');
  const [email, setEmail] = useState('');

  // Estado de la IA principal (3 opciones)
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOptions, setAiOptions] = useState<AISuggestion[]>([]);
  const [selectedOption, setSelectedOption] = useState<AISuggestion | null>(null);
  const [finalVerse, setFinalVerse] = useState('');
  const [finalVerseText, setFinalVerseText] = useState('');
  const [finalPrayer, setFinalPrayer] = useState('');

  // Estado del auto-suggest (verse instantáneo)
  const [quickVerse, setQuickVerse] = useState<QuickVerse | null>(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ----------------------------------------------------------------
  // AUTO-SUGGEST: Victoria sugiere un versículo mientras el usuario escribe
  // ----------------------------------------------------------------
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (newTitle.trim().length < MIN_CHARS_FOR_AUTOSUGGEST) {
      setQuickVerse(null);
      setQuickLoading(false);
      return;
    }

    setQuickLoading(true);

    debounceRef.current = setTimeout(async () => {
      let cancelled = false;

      const langInstruction = appLang === 'es'
        ? 'Responde en ESPAÑOL. Usa versículo de la Biblia NTV.'
        : 'Respond in ENGLISH. Use a verse from the NLT Bible.';

      try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          body: JSON.stringify({
            model: 'claude-3-haiku-20240307',
            max_tokens: 400,
            messages: [{
              role: 'user',
              content: `Eres Victoria, estratega espiritual de guerra y oración. El guerrero enfrenta esta situación: "${newTitle.trim()}". ${langInstruction} Dame UN versículo bíblico poderoso y relevante. Responde ÚNICAMENTE con este JSON exacto, sin texto adicional: { "verse": "Referencia bíblica", "bibleVersion": "NTV", "verseText": "Texto completo del versículo" }`,
            }],
          }),
        });

        if (cancelled) return;

        const data = await response.json();
        if (data.error) {
          console.error('[Victoria auto-suggest] HTTP status:', response.status);
          console.error('[Victoria auto-suggest] error.type:', data.error.type);
          console.error('[Victoria auto-suggest] error.message:', data.error.message);
          throw new Error(data.error.message);
        }

        const rawText = data.content[0].text;
        const jsonString = rawText.substring(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1);
        const parsed: QuickVerse = JSON.parse(jsonString);

        if (!cancelled) setQuickVerse(parsed);
      } catch (err) {
        if (!cancelled) console.warn('[Victoria auto-suggest]', err);
      } finally {
        if (!cancelled) setQuickLoading(false);
      }

      return () => { cancelled = true; };
    }, 900);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [newTitle, appLang]);

  // ----------------------------------------------------------------
  // RESET
  // ----------------------------------------------------------------
  const resetForm = () => {
    setNewTitle('');
    setNewCategory('Negocios');
    setVisibility('private');
    setPhoneContact('');
    setEmail('');
    setAiOptions([]);
    setSelectedOption(null);
    setFinalVerse('');
    setFinalVerseText('');
    setFinalPrayer('');
    setQuickVerse(null);
    setQuickLoading(false);
    if (debounceRef.current) clearTimeout(debounceRef.current);
  };

  const handleClose = () => { resetForm(); onClose(); };

  // ----------------------------------------------------------------
  // APLICAR VERSÍCULO RÁPIDO DE VICTORIA
  // ----------------------------------------------------------------
  const applyQuickVerse = () => {
    if (!quickVerse) return;
    setFinalVerse(quickVerse.verse);
    setFinalVerseText(quickVerse.verseText);
    // Limpiamos las opciones para que el usuario vaya directo a editar
    setAiOptions([]);
    setSelectedOption({ type: 'Victoria', verse: quickVerse.verse, bibleVersion: quickVerse.bibleVersion, verseText: quickVerse.verseText, prayer: '' });
  };

  // ----------------------------------------------------------------
  // GENERAR 3 OPCIONES COMPLETAS (prompt mejorado — Victoria)
  // ----------------------------------------------------------------
  const generateOptions = async () => {
    if (!newTitle) { Alert.alert('Ups', 'Escribe la situación primero.'); return; }
    setAiLoading(true);
    setAiOptions([]);
    setSelectedOption(null);

    const langPrompt = appLang === 'es'
      ? 'Idioma de salida: ESPAÑOL. Usa versículos de la Biblia NTV.'
      : 'Output language: ENGLISH. Use verses from the NLT Bible.';

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 2500,
          messages: [{
            role: 'user',
            content: `Eres Victoria, estratega de guerra espiritual y oración intercesora. Tu misión es equipar al guerrero de oración con la Palabra de Dios y declaraciones de fe de alto impacto.

Situación de batalla: "${newTitle}"
Categoría espiritual: "${newCategory}"
${langPrompt}

Genera 3 estrategias de oración distintas con estos ángulos espirituales:
1. Fe Declarativa — Declara la promesa de Dios con autoridad
2. Intercesión Profunda — Guerra espiritual y cobertura
3. Gratitud Victoriosa — Agradece como si ya estuviera hecho

Para cada estrategia, elige el versículo más poderoso y pertinente, y escribe una oración de 4 a 6 oraciones contundentes que declare la victoria de Dios sobre esta situación. El tono debe ser solemne, empoderador y lleno de fe.

Responde ÚNICAMENTE con JSON válido, sin texto antes ni después, con esta estructura exacta:
{ "options": [{ "type": "...", "verse": "...", "bibleVersion": "...", "verseText": "...", "prayer": "..." }] }`,
          }],
        }),
      });

      const data = await response.json();
      if (data.error) {
        console.error('[Victoria generateOptions] HTTP status:', response.status);
        console.error('[Victoria generateOptions] error.type:', data.error.type);
        console.error('[Victoria generateOptions] error.message:', data.error.message);
        throw new Error(data.error.message);
      }
      const rawText = data.content[0].text;
      const jsonString = rawText.substring(rawText.indexOf('{'), rawText.lastIndexOf('}') + 1);
      setAiOptions(JSON.parse(jsonString).options);
    } catch (error) {
      console.error('[Victoria generateOptions]', error);
      Alert.alert('Error AI', 'Verifica tu conexión o cuota de Anthropic.');
    } finally {
      setAiLoading(false);
    }
  };

  const selectOption = (index: number) => {
    const opt = aiOptions[index];
    setSelectedOption(opt);
    setFinalVerse(opt.verse);
    setFinalVerseText(opt.verseText);
    setFinalPrayer(opt.prayer);
  };

  // ----------------------------------------------------------------
  // GUARDAR — incluye ai_suggestion serializado
  // ----------------------------------------------------------------
  const handleSave = async () => {
    if (!newTitle || !finalVerse) return;
    const version = selectedOption?.bibleVersion ?? 'NTV';
    const aiSuggestionJson = selectedOption
      ? JSON.stringify({ ...selectedOption, savedAt: new Date().toISOString() })
      : null;

    try {
      await createPrayer({
        title: newTitle,
        category: newCategory,
        verse: finalVerse,
        bible_version: version,
        verse_text: finalVerseText,
        long_prayer: finalPrayer,
        status: 'active',
        special_mode: 'none',
        lang: appLang,
        family_id: visibility === 'public' ? familyId : null,
        author_name: authorName,
        ai_suggestion: aiSuggestionJson,
        phone_contact: phoneContact.trim() || null,
        email: email.trim() || null,
        visibility,
      });
      resetForm();
      onSaved();
    } catch {
      Alert.alert('Error', 'No se pudo guardar la petición.');
    }
  };

  // ----------------------------------------------------------------
  // RENDER
  // ----------------------------------------------------------------
  const showOptions = aiOptions.length > 0 && selectedOption === null;
  const showEditor = selectedOption !== null;

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={styles.formContainer}>
          <View style={styles.headerRow}>
            <Text style={styles.formTitle}>{t.create.title}</Text>
            <TouchableOpacity onPress={handleClose}>
              <Text style={styles.cancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>

          <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">

            {/* Selector de Visibilidad */}
            <Text style={styles.label}>VISIBILIDAD</Text>
            <View style={styles.visibilityRow}>
              <TouchableOpacity
                style={[styles.visChip, visibility === 'private' && styles.visChipActive]}
                onPress={() => setVisibility('private')}
              >
                <MaterialCommunityIcons name="lock" size={14} color={visibility === 'private' ? '#fff' : '#64748B'} />
                <Text style={[styles.visChipText, visibility === 'private' && styles.visChipTextActive]}>Privada</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.visChip, visibility === 'public' && styles.visChipPublic]}
                onPress={() => setVisibility('public')}
              >
                <MaterialCommunityIcons name="account-group" size={14} color={visibility === 'public' ? '#fff' : '#64748B'} />
                <Text style={[styles.visChipText, visibility === 'public' && styles.visChipTextActive]}>Pública</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.visChip, visibility === 'pastoral' && styles.visChipPastoral]}
                onPress={() => setVisibility('pastoral')}
              >
                <MaterialCommunityIcons name="church" size={14} color={visibility === 'pastoral' ? '#fff' : '#64748B'} />
                <Text style={[styles.visChipText, visibility === 'pastoral' && styles.visChipTextActive]}>Pastoral</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.visibilityHint}>
              {visibility === 'private' && '• Solo visible para ti'}
              {visibility === 'public' && `• Visible para el grupo ${familyId}`}
              {visibility === 'pastoral' && '• Solicitud enviada al Pastor'}
            </Text>

            {/* Datos de contacto */}
            <Text style={styles.label}>TELÉFONO (opcional)</Text>
            <TextInput
              style={styles.input}
              value={phoneContact}
              onChangeText={setPhoneContact}
              placeholder="Ej. +1 555 000 0000"
              keyboardType="phone-pad"
              autoComplete="tel"
            />
            <Text style={styles.label}>CORREO ELECTRÓNICO (opcional)</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Ej. nombre@correo.com"
              keyboardType="email-address"
              autoCapitalize="none"
              autoComplete="email"
            />

            {/* Situación */}
            <Text style={styles.label}>{t.create.situationLabel}</Text>
            <TextInput
              style={styles.input}
              value={newTitle}
              onChangeText={setNewTitle}
              placeholder="Escribe aquí la situación..."
              multiline
            />

            {/* AUTO-SUGGEST DE VICTORIA */}
            {quickLoading && newTitle.trim().length >= MIN_CHARS_FOR_AUTOSUGGEST && (
              <View style={styles.quickCard}>
                <ActivityIndicator size="small" color="#7C3AED" />
                <Text style={styles.quickLoadingText}>Victoria está buscando la Palabra...</Text>
              </View>
            )}

            {!quickLoading && quickVerse && !showEditor && (
              <TouchableOpacity style={styles.quickCard} onPress={applyQuickVerse} activeOpacity={0.85}>
                <View style={styles.quickCardHeader}>
                  <MaterialCommunityIcons name="star-four-points" size={14} color="#7C3AED" />
                  <Text style={styles.quickCardLabel}>Victoria sugiere</Text>
                </View>
                <Text style={styles.quickVerse}>{quickVerse.verse}</Text>
                <Text style={styles.quickVerseText} numberOfLines={2}>"{quickVerse.verseText}"</Text>
                <Text style={styles.quickCardHint}>Toca para usar este versículo →</Text>
              </TouchableOpacity>
            )}

            {/* Categoría */}
            <Text style={styles.label}>{t.create.categoryLabel}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 10 }}>
              {Object.keys(CATEGORIES).map(cat => (
                <TouchableOpacity
                  key={cat}
                  style={[styles.catOption, newCategory === cat && { backgroundColor: CATEGORIES[cat].bg, borderColor: CATEGORIES[cat].color, borderWidth: 1 }]}
                  onPress={() => setNewCategory(cat)}
                >
                  <MaterialCommunityIcons name={CATEGORIES[cat].icon as any} size={20} color={newCategory === cat ? CATEGORIES[cat].color : '#94A3B8'} />
                  <Text style={{ marginLeft: 5, color: newCategory === cat ? CATEGORIES[cat].color : '#94A3B8' }}>
                    {t.cats[cat]}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* Botón — 3 estrategias completas */}
            {!showEditor && (
              <TouchableOpacity style={styles.aiButton} onPress={generateOptions} disabled={aiLoading}>
                {aiLoading
                  ? <ActivityIndicator color="#fff" />
                  : (
                    <>
                      <MaterialCommunityIcons name="sword-cross" size={22} color="#fff" />
                      <Text style={styles.aiButtonText}>{t.create.btnGenerate}</Text>
                    </>
                  )
                }
              </TouchableOpacity>
            )}

            {/* 3 Opciones generadas */}
            {showOptions && (
              <View style={styles.generatedContent}>
                {aiOptions.map((opt, index) => (
                  <TouchableOpacity key={index} style={styles.optionCard} onPress={() => selectOption(index)}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={styles.optionType}>{opt.type}</Text>
                      <MaterialCommunityIcons name="arrow-right-circle" size={24} color="#2563EB" />
                    </View>
                    <Text style={styles.optionVerse}>{opt.verse}</Text>
                    <Text style={styles.optionPreview} numberOfLines={2}>"{opt.verseText}"</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {/* Editor de la opción seleccionada */}
            {showEditor && (
              <View style={styles.generatedContent}>
                <Text style={styles.editorLabel}>VERSÍCULO</Text>
                <View style={styles.resultBox}>
                  <TextInput style={[styles.editInput, { fontWeight: 'bold', color: '#2563EB' }]} value={finalVerse} onChangeText={setFinalVerse} />
                  <TextInput style={[styles.editInput, { fontStyle: 'italic', height: 60 }]} value={finalVerseText} onChangeText={setFinalVerseText} multiline />
                </View>
                <Text style={styles.editorLabel}>ORACIÓN</Text>
                <View style={styles.resultBox}>
                  <TextInput style={[styles.editInput, { height: 140, lineHeight: 22 }]} value={finalPrayer} onChangeText={setFinalPrayer} multiline />
                </View>
                <TouchableOpacity style={styles.saveButton} onPress={handleSave}>
                  <Text style={styles.saveButtonText}>{t.create.saveBtn}</Text>
                </TouchableOpacity>
              </View>
            )}

            <View style={{ height: 60 }} />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  formContainer:    { flex: 1, backgroundColor: '#fff', padding: 20, paddingTop: 50 },
  headerRow:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  formTitle:        { fontSize: 22, fontWeight: 'bold' },
  cancelText:       { color: '#64748B', fontSize: 16 },
  visibilityRow:        { flexDirection: 'row', gap: 8, marginBottom: 6 },
  visChip:              { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1.5, borderColor: '#E2E8F0', backgroundColor: '#F8FAFC' },
  visChipActive:        { backgroundColor: '#1E293B', borderColor: '#1E293B' },
  visChipPublic:        { backgroundColor: '#DB2777', borderColor: '#DB2777' },
  visChipPastoral:      { backgroundColor: '#7C3AED', borderColor: '#7C3AED' },
  visChipText:          { fontSize: 13, fontWeight: '600', color: '#64748B' },
  visChipTextActive:    { color: '#fff' },
  visibilityHint:       { fontSize: 12, marginBottom: 15, fontWeight: '600', color: '#64748B' },
  label:            { fontSize: 14, fontWeight: '700', color: '#64748B', marginBottom: 8, marginTop: 15 },
  input:            { backgroundColor: '#F8FAFC', padding: 15, borderRadius: 12, fontSize: 16, borderWidth: 1, borderColor: '#E2E8F0' },
  // Auto-suggest card
  quickCard:        { flexDirection: 'column', backgroundColor: '#F5F3FF', borderRadius: 12, padding: 14, marginTop: 12, borderLeftWidth: 3, borderLeftColor: '#7C3AED' },
  quickCardHeader:  { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  quickCardLabel:   { fontSize: 11, fontWeight: '700', color: '#7C3AED', marginLeft: 5, textTransform: 'uppercase', letterSpacing: 0.5 },
  quickLoadingText: { fontSize: 13, color: '#7C3AED', marginLeft: 10 },
  quickVerse:       { fontSize: 14, fontWeight: '800', color: '#3B0764', marginBottom: 4 },
  quickVerseText:   { fontSize: 13, color: '#6B21A8', fontStyle: 'italic', lineHeight: 19 },
  quickCardHint:    { fontSize: 11, color: '#A78BFA', marginTop: 8, fontWeight: '600' },
  // Categorías
  catOption:        { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: '#F8FAFC', borderRadius: 10, marginRight: 8 },
  // Botón IA
  aiButton:         { backgroundColor: '#1E293B', padding: 16, borderRadius: 12, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 20 },
  aiButtonText:     { color: '#fff', fontWeight: 'bold', marginLeft: 10, fontSize: 16 },
  // Opciones generadas
  generatedContent: { marginTop: 12 },
  optionCard:       { backgroundColor: '#F0F9FF', padding: 15, borderRadius: 12, marginBottom: 10, borderLeftWidth: 4, borderLeftColor: '#2563EB' },
  optionType:       { fontSize: 12, fontWeight: '700', color: '#2563EB', textTransform: 'uppercase', marginBottom: 5 },
  optionVerse:      { fontSize: 14, fontWeight: 'bold', color: '#1E293B' },
  optionPreview:    { fontSize: 13, color: '#64748B', fontStyle: 'italic', marginTop: 4 },
  // Editor
  editorLabel:      { fontSize: 11, fontWeight: '700', color: '#94A3B8', letterSpacing: 1, marginBottom: 6, marginTop: 12 },
  resultBox:        { backgroundColor: '#F8FAFC', padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1, borderColor: '#E2E8F0' },
  editInput:        { fontSize: 16, color: '#334155', padding: 0 },
  saveButton:       { backgroundColor: '#10B981', padding: 18, borderRadius: 12, alignItems: 'center', marginTop: 16 },
  saveButtonText:   { color: '#fff', fontWeight: 'bold', fontSize: 18 },
});
