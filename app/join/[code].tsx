import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { supabase } from '../../lib/supabase';

const RELATIONS = ['Esposo/a', 'Hijo/a', 'Madre', 'Padre', 'Hermano/a', 'Abuelo/a', 'Otro'] as const;

const getReciprocalRelation = (relation: string): string => {
  const map: Record<string, string> = {
    'Esposo/a':   'Esposo/a',
    'Hijo/a':     'Padre/Madre',
    'Madre':      'Hijo/a',
    'Padre':      'Hijo/a',
    'Hermano/a':  'Hermano/a',
    'Abuelo/a':   'Nieto/a',
    'Otro':       'Otro',
  };
  return map[relation] ?? 'Otro';
};

export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();

  const [loading,          setLoading]          = useState(true);
  const [invite,           setInvite]           = useState<any | null>(null);
  const [inviterName,      setInviterName]      = useState('');
  const [inviterChurch,    setInviterChurch]    = useState('');
  const [currentUserId,    setCurrentUserId]    = useState<string | null>(null);
  const [invalid,          setInvalid]          = useState(false);
  const [joining,          setJoining]          = useState(false);
  const [selectedRelation, setSelectedRelation] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      if (!code) { setInvalid(true); setLoading(false); return; }

      // 1. Auth check — if not logged in, stash the code and go to login
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) {
        await AsyncStorage.setItem('@pending_invitation', String(code));
        router.replace('/login');
        return;
      }
      setCurrentUserId(session.user.id);

      // 2. Fetch invitation (no FK joins — RLS-safe)
      const { data: inv } = await supabase
        .from('invitations')
        .select('*')
        .eq('code', String(code))
        .single();

      if (!inv) { setInvalid(true); setLoading(false); return; }

      // 3. Validity: not expired, uses not exhausted
      const expired = inv.expires_at && new Date(inv.expires_at) < new Date();
      const exhausted = inv.max_uses != null && (inv.uses_count ?? 0) >= inv.max_uses;
      if (expired || exhausted) { setInvalid(true); setLoading(false); return; }

      setInvite(inv);

      // 4. Inviter profile (separate fetch)
      const { data: prof } = await supabase
        .from('profiles')
        .select('full_name, church')
        .eq('id', inv.inviter_id)
        .single();
      setInviterName(prof?.full_name ?? 'Alguien');
      setInviterChurch(prof?.church ?? '');
      setLoading(false);
    };
    load();
  }, [code]);

  const finishJoin = async () => {
    await supabase.from('invitations')
      .update({ uses_count: (invite.uses_count ?? 0) + 1 })
      .eq('id', invite.id);
    await AsyncStorage.removeItem('@pending_invitation');
    router.replace('/(tabs)');
  };

  const handleJoinMinistry = async () => {
    if (!currentUserId || !invite) return;
    setJoining(true);
    await supabase.from('circles').insert({
      owner_id:    invite.inviter_id,
      member_id:   currentUserId,
      circle_type: 'ministry',
      status:      'accepted',
    });
    await finishJoin();
  };

  const handleJoinFamily = async () => {
    if (!currentUserId || !invite || !selectedRelation) return;
    setJoining(true);
    await supabase.from('circles').insert({
      owner_id:        invite.inviter_id,
      member_id:       currentUserId,
      circle_type:     'family',
      family_relation: selectedRelation,
      status:          'accepted',
    });
    // Reciprocal connection so both see each other
    await supabase.from('circles').insert({
      owner_id:        currentUserId,
      member_id:       invite.inviter_id,
      circle_type:     'family',
      family_relation: getReciprocalRelation(selectedRelation),
      status:          'accepted',
    });
    await finishJoin();
  };

  const handleJoinFriends = async () => {
    if (!currentUserId || !invite) return;
    setJoining(true);
    await supabase.from('circles').insert({
      owner_id:    invite.inviter_id,
      member_id:   currentUserId,
      circle_type: 'friends',
      status:      'accepted',
    });
    await supabase.from('circles').insert({
      owner_id:    currentUserId,
      member_id:   invite.inviter_id,
      circle_type: 'friends',
      status:      'accepted',
    });
    await finishJoin();
  };

  if (loading) {
    return (
      <View style={s.root}>
        <ActivityIndicator color="#7c3aed" size="large" />
      </View>
    );
  }

  if (invalid || !invite) {
    return (
      <View style={s.root}>
        <View style={s.card}>
          <Ionicons name="link-outline" size={44} color="#475569" style={{ alignSelf: 'center', marginBottom: 12 }} />
          <Text style={s.title}>Este enlace ya no es válido</Text>
          <Text style={s.subtitle}>Pide a quien te invitó que genere un nuevo enlace.</Text>
          <Pressable style={s.primaryBtn} onPress={() => router.replace('/(tabs)')}>
            <Text style={s.primaryBtnTxt}>Ir a mi War Room</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1, backgroundColor: '#020617' }} contentContainerStyle={s.scrollContent}>
      <View style={s.card}>
        {invite.circle_type === 'ministry' ? (
          <>
            <Text style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>✝️</Text>
            <Text style={s.title}>
              {inviterName} te invita a unirte al ministerio de oración{inviterChurch ? ` de ${inviterChurch}` : ''}
            </Text>
            <Text style={s.subtitle}>
              Al unirte, podrás compartir peticiones con tu congregación y recibir oración de tu pastor y equipo de intercesores.
            </Text>
            <Pressable style={s.primaryBtn} onPress={handleJoinMinistry} disabled={joining}>
              {joining
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.primaryBtnTxt}>Unirme al ministerio</Text>}
            </Pressable>
          </>
        ) : invite.circle_type === 'family' ? (
          <>
            <Text style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>👨‍👩‍👧‍👦</Text>
            <Text style={s.title}>{inviterName} te invita a su círculo de Familia</Text>
            <Text style={s.subtitle}>¿Cuál es tu relación con {inviterName}?</Text>
            <View style={s.relationGrid}>
              {RELATIONS.map(r => (
                <Pressable
                  key={r}
                  style={[s.relationPill, selectedRelation === r && s.relationPillActive]}
                  onPress={() => setSelectedRelation(r)}
                >
                  <Text style={[s.relationTxt, selectedRelation === r && { color: '#fff' }]}>{r}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={[s.primaryBtn, !selectedRelation && { opacity: 0.4 }]}
              onPress={handleJoinFamily}
              disabled={joining || !selectedRelation}
            >
              {joining
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.primaryBtnTxt}>Confirmar y unirme</Text>}
            </Pressable>
          </>
        ) : (
          <>
            <Text style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>🤝</Text>
            <Text style={s.title}>{inviterName} te invita a su círculo de Amigos</Text>
            <Text style={s.subtitle}>Podrán orar el uno por el otro y compartir peticiones.</Text>
            <Pressable style={s.primaryBtn} onPress={handleJoinFriends} disabled={joining}>
              {joining
                ? <ActivityIndicator color="#fff" />
                : <Text style={s.primaryBtnTxt}>Aceptar invitación</Text>}
            </Pressable>
          </>
        )}

        <Pressable style={{ alignItems: 'center', paddingVertical: 12 }} onPress={() => router.replace('/(tabs)')}>
          <Text style={{ color: '#475569', fontSize: 13 }}>Ahora no</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#020617', justifyContent: 'center', alignItems: 'center', padding: 24 },
  scrollContent: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24 },
  card: {
    backgroundColor: '#0f0f1a',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 440,
    borderWidth: 1,
    borderColor: 'rgba(124,58,237,0.25)',
  },
  title:    { color: '#f8fafc', fontSize: 20, fontWeight: '700', textAlign: 'center', marginBottom: 10, lineHeight: 28 },
  subtitle: { color: '#64748b', fontSize: 14, textAlign: 'center', marginBottom: 24, lineHeight: 21 },
  primaryBtn: {
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 8,
  },
  primaryBtnTxt: { color: '#fff', fontWeight: '600', fontSize: 16 },
  relationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 24, justifyContent: 'center' },
  relationPill: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
    minWidth: '45%',
    alignItems: 'center',
  },
  relationPillActive: { backgroundColor: '#7c3aed', borderColor: '#7c3aed' },
  relationTxt: { color: '#94a3b8', fontSize: 14 },
});
