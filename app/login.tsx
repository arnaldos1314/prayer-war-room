import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { supabase } from '../lib/supabase';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

type AuthTab = 'login' | 'register';

export default function LoginScreen() {
  const [authTab,         setAuthTab]         = useState<AuthTab>('login');
  const [email,           setEmail]           = useState('');
  const [password,        setPassword]        = useState('');
  const [nombre,          setNombre]          = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading,         setLoading]         = useState(false);
  const [cachedName,      setCachedName]      = useState<string | null>(null);

  const [emailErr,   setEmailErr]   = useState('');
  const [passErr,    setPassErr]    = useState('');
  const [nombreErr,  setNombreErr]  = useState('');
  const [confirmErr, setConfirmErr] = useState('');
  const [msg,        setMsg]        = useState('');
  const [msgOk,      setMsgOk]      = useState(false);

  useEffect(() => {
    AsyncStorage.getItem('@war_room_cached_name').then(n => { if (n) setCachedName(n); });
  }, []);

  const clearErrors = () => {
    setEmailErr(''); setPassErr(''); setNombreErr(''); setConfirmErr('');
    setMsg(''); setMsgOk(false);
  };

  const switchTab = (tab: AuthTab) => { clearErrors(); setAuthTab(tab); };

  // ── Validation ──
  const validateLogin = () => {
    clearErrors();
    let ok = true;
    if (!email.trim()) { setEmailErr('Ingresa tu email.'); ok = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setEmailErr('Email no válido.'); ok = false; }
    if (!password) { setPassErr('Ingresa tu contraseña.'); ok = false; }
    else if (password.length < 6) { setPassErr('Mínimo 6 caracteres.'); ok = false; }
    return ok;
  };

  const validateRegister = () => {
    clearErrors();
    let ok = true;
    if (!nombre.trim()) { setNombreErr('Ingresa tu nombre completo.'); ok = false; }
    if (!email.trim()) { setEmailErr('Ingresa tu email.'); ok = false; }
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setEmailErr('Email no válido.'); ok = false; }
    if (!password) { setPassErr('Crea una contraseña.'); ok = false; }
    else if (password.length < 8) { setPassErr('Mínimo 8 caracteres.'); ok = false; }
    if (!confirmPassword) { setConfirmErr('Confirma tu contraseña.'); ok = false; }
    else if (password !== confirmPassword) { setConfirmErr('Las contraseñas no coinciden.'); ok = false; }
    return ok;
  };

  // ── Handlers ──
  const handleLogin = async () => {
    if (!validateLogin()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      const name = data.user?.user_metadata?.full_name ?? data.user?.email?.split('@')[0] ?? '';
      if (name) await AsyncStorage.setItem('@war_room_cached_name', name);
      const pending = await AsyncStorage.getItem('@pending_invitation');
      if (pending) {
        router.replace(`/join/${pending}` as any);
      } else {
        router.replace('/(tabs)');
      }
    } catch (err: any) {
      setMsg(err?.message ?? 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!validateRegister()) return;
    setLoading(true);
    try {
      // All users register as 'user'. Role is assigned by pastor from CRM.
      const { error, data } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: nombre.trim(), role: 'user' } },
      });
      if (error) throw error;
      if (data.user) {
        // Upsert profile so full_name is immediately available in the profiles table
        await supabase.from('profiles').upsert({
          id: data.user.id,
          full_name: nombre.trim(),
          role: 'user',
        });
        await AsyncStorage.setItem('@war_room_cached_name', nombre.trim());
        await AsyncStorage.setItem('@war_room_profile_complete', 'true');
        const pending = await AsyncStorage.getItem('@pending_invitation');
        if (pending) {
          router.replace(`/join/${pending}` as any);
        } else {
          router.replace('/(tabs)');
        }
      } else {
        setMsgOk(true);
        setMsg('¡Cuenta creada! Revisa tu email para confirmarla.');
      }
    } catch (err: any) {
      setMsg(err?.message ?? 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) { setEmailErr('Ingresa tu email primero.'); return; }
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (error) throw error;
      setMsgOk(true);
      setMsg(`Te enviamos un link a ${email.trim()}`);
    } catch (err: any) {
      setMsg(err?.message ?? 'Error desconocido');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={s.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >

          {/* ══════════════════════════
              HERO  (always visible)
          ══════════════════════════ */}
          <View style={s.heroWrap}>
            {/* Subtle radial glow behind the shield */}
            <View style={s.glow} />
            <Ionicons name="shield" size={48} color="#7c3aed" />
            <Text style={s.heroTitle}>War Room</Text>
            <Text style={s.heroTagline}>
              El ministerio de oración de tu iglesia,{'\n'}ordenado y en un solo lugar.
            </Text>
          </View>

          {/* ── Thin divider ── */}
          <View style={s.heroDivider} />

          {/* ══════════════════════════
              TAB SWITCHER
          ══════════════════════════ */}
          <View style={s.tabRow}>
            <Pressable
              style={[s.tabPill, authTab === 'login' && s.tabPillActive]}
              onPress={() => switchTab('login')}
            >
              <Text style={[s.tabPillTxt, authTab === 'login' && s.tabPillTxtActive]}>Entrar</Text>
            </Pressable>
            <Pressable
              style={[s.tabPill, authTab === 'register' && s.tabPillActive]}
              onPress={() => switchTab('register')}
            >
              <Text style={[s.tabPillTxt, authTab === 'register' && s.tabPillTxtActive]}>Crear cuenta</Text>
            </Pressable>
          </View>

          {/* ══════════════════════════
              ENTRAR TAB
          ══════════════════════════ */}
          {authTab === 'login' && (
            <>
              {cachedName ? (
                <Text style={s.welcome}>Bienvenido de nuevo, {cachedName} 🙏</Text>
              ) : null}

              <TextInput
                style={[s.input, emailErr ? s.inputErr : null]}
                placeholder="Email"
                placeholderTextColor="#475569"
                value={email}
                onChangeText={t => { setEmail(t); if (emailErr) setEmailErr(''); }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              {emailErr ? <Text style={s.fieldErr}>{emailErr}</Text> : null}

              <TextInput
                style={[s.input, passErr ? s.inputErr : null]}
                placeholder="Contraseña"
                placeholderTextColor="#475569"
                value={password}
                onChangeText={t => { setPassword(t); if (passErr) setPassErr(''); }}
                secureTextEntry
              />
              {passErr ? <Text style={s.fieldErr}>{passErr}</Text> : null}

              {msg ? <Text style={[s.msg, msgOk && s.msgOk]}>{msg}</Text> : null}

              <Pressable
                style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.88 }]}
                onPress={handleLogin}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.primaryBtnTxt}>Entrar a mi War Room</Text>}
              </Pressable>

              {/* Divider */}
              <View style={s.divider}>
                <View style={s.divLine} />
                <Text style={s.divTxt}>o continúa con</Text>
                <View style={s.divLine} />
              </View>

              {/* Apple — iOS only */}
              {Platform.OS === 'ios' && (
                <Pressable style={s.socialBtn} disabled>
                  <Text style={s.appleLogo}></Text>
                  <Text style={s.socialBtnTxt}>Continuar con Apple</Text>
                </Pressable>
              )}

              {/* Google */}
              <Pressable style={s.socialBtn} disabled>
                <Ionicons name="logo-google" size={17} color="#94a3b8" />
                <Text style={s.socialBtnTxt}>Continuar con Google</Text>
              </Pressable>

              <Pressable onPress={handleForgotPassword} style={s.linkRow}>
                <Text style={s.forgotTxt}>¿Olvidaste tu contraseña?</Text>
              </Pressable>

              <Pressable onPress={() => switchTab('register')} style={s.linkRow}>
                <Text style={s.switchTxt}>¿Primera vez? Crear cuenta →</Text>
              </Pressable>
            </>
          )}

          {/* ══════════════════════════
              CREAR CUENTA TAB
          ══════════════════════════ */}
          {authTab === 'register' && (
            <>
              <TextInput
                style={[s.input, nombreErr ? s.inputErr : null]}
                placeholder="Nombre completo"
                placeholderTextColor="#475569"
                value={nombre}
                onChangeText={t => { setNombre(t); if (nombreErr) setNombreErr(''); }}
                autoCapitalize="words"
                autoComplete="name"
              />
              {nombreErr ? <Text style={s.fieldErr}>{nombreErr}</Text> : null}

              <TextInput
                style={[s.input, emailErr ? s.inputErr : null]}
                placeholder="Email"
                placeholderTextColor="#475569"
                value={email}
                onChangeText={t => { setEmail(t); if (emailErr) setEmailErr(''); }}
                autoCapitalize="none"
                keyboardType="email-address"
                autoComplete="email"
              />
              {emailErr ? <Text style={s.fieldErr}>{emailErr}</Text> : null}

              <TextInput
                style={[s.input, passErr ? s.inputErr : null]}
                placeholder="Contraseña (mínimo 8 caracteres)"
                placeholderTextColor="#475569"
                value={password}
                onChangeText={t => { setPassword(t); if (passErr) setPassErr(''); }}
                secureTextEntry
              />
              {passErr ? <Text style={s.fieldErr}>{passErr}</Text> : null}

              <TextInput
                style={[s.input, confirmErr ? s.inputErr : null]}
                placeholder="Confirmar contraseña"
                placeholderTextColor="#475569"
                value={confirmPassword}
                onChangeText={t => { setConfirmPassword(t); if (confirmErr) setConfirmErr(''); }}
                secureTextEntry
              />
              {confirmErr ? <Text style={s.fieldErr}>{confirmErr}</Text> : null}

              {msg ? <Text style={[s.msg, msgOk && s.msgOk]}>{msg}</Text> : null}

              <Pressable
                style={({ pressed }) => [s.primaryBtn, pressed && { opacity: 0.88 }, msgOk && { backgroundColor: '#334155' }]}
                onPress={handleRegister}
                disabled={loading || msgOk}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.primaryBtnTxt}>{msgOk ? '¡Cuenta creada! ✓' : 'Crear mi cuenta'}</Text>}
              </Pressable>

              <Pressable onPress={() => switchTab('login')} style={s.linkRow}>
                <Text style={s.switchTxt}>¿Ya tienes cuenta? Iniciar sesión</Text>
              </Pressable>
            </>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe:   { flex: 1, backgroundColor: '#020617' },
  scroll: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 24, paddingBottom: 48 },

  // ── Hero ──
  heroWrap: {
    alignItems: 'center',
    paddingTop: 20,
    paddingBottom: 8,
  },
  glow: {
    position: 'absolute',
    width: 200,
    height: 200,
    borderRadius: 100,
    backgroundColor: 'rgba(124,58,237,0.08)',
    top: 0,
    alignSelf: 'center',
  },
  heroTitle: {
    fontSize: 32,
    fontFamily: 'serif',
    fontWeight: '700',
    color: '#f8fafc',
    marginTop: 16,
    letterSpacing: -0.5,
  },
  heroTagline: {
    fontSize: 14,
    color: '#475569',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
    paddingHorizontal: 20,
  },
  heroDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.06)',
    marginVertical: 24,
  },

  // ── Tab switcher ──
  tabRow: {
    flexDirection: 'row',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 12,
    padding: 4,
    marginBottom: 24,
  },
  tabPill:          { flex: 1, paddingVertical: 10, paddingHorizontal: 20, borderRadius: 10, alignItems: 'center' },
  tabPillActive:    { backgroundColor: '#7c3aed' },
  tabPillTxt:       { fontSize: 15, color: '#64748b' },
  tabPillTxtActive: { color: '#fff', fontWeight: '600', fontSize: 15 },

  // Welcome back
  welcome: { fontSize: 14, color: '#a78bfa', textAlign: 'center', fontStyle: 'italic', marginBottom: 16 },

  // Inputs
  input: {
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
    color: '#f1f5f9',
    fontSize: 16,
    marginBottom: 4,
  },
  inputErr: { borderColor: '#f87171' },
  fieldErr: { color: '#f87171', fontSize: 12, marginBottom: 10, marginLeft: 2 },

  // Message
  msg:   { fontSize: 13, color: '#f87171', textAlign: 'center', marginVertical: 8 },
  msgOk: { color: '#34d399' },

  // Primary button
  primaryBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 16,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  primaryBtnTxt: { color: '#fff', fontWeight: '600', fontSize: 18 },

  // Divider
  divider: { flexDirection: 'row', alignItems: 'center', marginVertical: 20, gap: 10 },
  divLine: { flex: 1, height: 1, backgroundColor: '#334155' },
  divTxt:  { color: '#334155', fontSize: 12 },

  // Social buttons
  socialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    borderRadius: 14,
    height: 48,
    marginBottom: 10,
    gap: 10,
  },
  socialBtnTxt: { color: '#94a3b8', fontSize: 15, fontWeight: '500' },
  appleLogo:    { fontSize: 17, color: '#94a3b8' },

  // Links
  linkRow:   { alignItems: 'center', paddingVertical: 10 },
  forgotTxt: { color: '#6d28d9', fontSize: 13 },
  switchTxt: { color: '#475569', fontSize: 13 },
});
