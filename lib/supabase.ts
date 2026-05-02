import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Debug: verifica que las variables de entorno lleguen correctamente
console.log('[Supabase] URL:', supabaseUrl ?? 'UNDEFINED ⚠️');
console.log('[Supabase] Key presente:', supabaseAnonKey ? 'SÍ ✓' : 'NO ⚠️');

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: {
    headers: { 'x-my-custom-header': 'prayer-war-room' },
  },
});
