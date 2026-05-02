import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';

// ── Type ──────────────────────────────────────────────────────
export type PrayerRequest = {
  id: string;
  user_id: string;
  space_type: 'personal' | 'family' | 'ministry';
  category: 'salud' | 'familia' | 'finanzas' | 'trabajo' | 'otro' | null;
  /** Requester's display name — stored in title column */
  title: string | null;
  content: string;
  country_code: string | null;
  status: 'incoming' | 'in_battle' | 'victory';
  urgent: boolean;
  assigned_to: string | null;
  pastor_note: string | null;
  victory_date: string | null;
  created_at: string;
  updated_at: string;
  /** Joined from public.profiles via assigned_to FK */
  assigned_profile?: { full_name: string; avatar_url: string | null } | null;
  // Prayer Wall fields
  visibility: 'private' | 'circle' | 'congregation' | null;
  anonymous: boolean;
  wall_pending: boolean;
  wall_approved: boolean;
  pray_count: number;
};

export type InsertPayload = {
  user_id: string;
  space_type: string;
  category: string;
  title?: string | null;
  content: string;
  country_code?: string | null;
  urgent: boolean;
  status: string;
  visibility?: string;
  anonymous?: boolean;
  wall_pending?: boolean;
  wall_approved?: boolean;
  pray_count?: number;
};

// ── Hook ─────────────────────────────────────────────────────
export function usePrayerRequests(statusFilter?: string, todayOnly = false) {
  const [requests, setRequests]   = useState<PrayerRequest[]>([]);
  const [loading,  setLoading]    = useState(true);
  const [error,    setError]      = useState<string | null>(null);

  const fetchRequests = useCallback(async () => {
    setLoading(true);
    let query = supabase
      .from('prayer_requests')
      .select('*, assigned_profile:assigned_to(full_name, avatar_url)')
      .eq('space_type', 'ministry')
      .order('urgent',     { ascending: false })
      .order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    if (todayOnly) {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      query = query.gte('created_at', start.toISOString());
    }

    const { data, error: fetchErr } = await query;
    if (fetchErr) {
      setError(fetchErr.message);
    } else {
      setRequests((data as PrayerRequest[]) ?? []);
      setError(null);
    }
    setLoading(false);
  }, [statusFilter, todayOnly]);

  // Initial fetch + realtime subscription
  useEffect(() => {
    fetchRequests();

    const channel = supabase
      .channel('prayer_requests_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'prayer_requests' },
        () => fetchRequests()
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [fetchRequests]);

  // ── Mutations ──────────────────────────────────────────────

  async function updateStatus(id: string, status: string) {
    const { error } = await supabase
      .from('prayer_requests')
      .update({
        status,
        updated_at: new Date().toISOString(),
        ...(status === 'victory' ? { victory_date: new Date().toISOString() } : {}),
      })
      .eq('id', id);
    if (!error) fetchRequests();
    return { error };
  }

  async function assignIntercessor(requestId: string, intercessorProfileId: string) {
    const { error } = await supabase
      .from('prayer_requests')
      .update({ assigned_to: intercessorProfileId, updated_at: new Date().toISOString() })
      .eq('id', requestId);
    if (!error) fetchRequests();
    return { error };
  }

  async function savePastorNote(requestId: string, note: string) {
    const { error } = await supabase
      .from('prayer_requests')
      .update({ pastor_note: note, updated_at: new Date().toISOString() })
      .eq('id', requestId);
    return { error };
  }

  async function insertRequest(payload: InsertPayload) {
    const { error } = await supabase.from('prayer_requests').insert(payload);
    if (!error) fetchRequests();
    return { error };
  }

  return {
    requests,
    loading,
    error,
    updateStatus,
    assignIntercessor,
    savePastorNote,
    insertRequest,
    refetch: fetchRequests,
  };
}
