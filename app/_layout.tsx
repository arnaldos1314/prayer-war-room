import { supabase } from '../lib/supabase';
import { Stack, router } from 'expo-router';
import { useEffect, useRef } from 'react';

export default function RootLayout() {
  // Track whether we've done the initial session check so the first
  // navigation fires from getSession (not delayed by the subscription).
  const initialised = useRef(false);

  useEffect(() => {
    // 1. Check session once on mount for cold-start routing.
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!initialised.current) {
        initialised.current = true;
        router.replace(session ? '/(tabs)' : '/login');
      }
    });

    // 2. React to explicit auth events going forward.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        initialised.current = true;
        router.replace('/(tabs)');
      } else if (event === 'SIGNED_OUT') {
        router.replace('/login');
      } else if (!initialised.current && session !== undefined) {
        // TOKEN_REFRESHED / INITIAL_SESSION fired before getSession resolved
        initialised.current = true;
        router.replace(session ? '/(tabs)' : '/login');
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="login" />
      <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
    </Stack>
  );
}
