import { supabase } from '../lib/supabase';
import { NewPrayerData, Prayer } from '../types/prayer';

export async function fetchPrayers(
  viewMode: 'personal' | 'family',
  familyId: string
): Promise<Prayer[]> {
  let query = supabase.from('prayers').select('*').order('created_at', { ascending: false });
  if (viewMode === 'family') {
    query = query.eq('family_id', familyId);
  } else {
    query = query.is('family_id', null);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function createPrayer(data: NewPrayerData): Promise<void> {
  const { error } = await supabase.from('prayers').insert([data]);
  if (error) throw error;
}

export async function updatePrayerStatus(id: number, newStatus: string): Promise<void> {
  const { error } = await supabase.from('prayers').update({ status: newStatus }).eq('id', id);
  if (error) throw error;
}

export async function deletePrayer(id: number): Promise<void> {
  const { error } = await supabase.from('prayers').delete().eq('id', id);
  if (error) throw error;
}

// Pastor Edition: carga TODAS las peticiones activas de la congregación
export async function fetchAllPrayersForPastor(): Promise<Prayer[]> {
  const { data, error } = await supabase
    .from('prayers')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}
