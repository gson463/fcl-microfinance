import { useState, useEffect } from 'react';
import { supabase } from '@/lib/customSupabaseClient';

/**
 * Canonical `branch_id` and `role` from `public.users` (source of truth).
 * JWT `user_metadata.branch_id` is often missing or stale after recovery — prefer these values
 * for manager branch scoping and officer branch fallbacks.
 *
 * @param {string | undefined} userId - auth user id
 * @returns {{ loading: boolean, branchId: string | null, role: string | null }}
 */
export function useUserProfileScope(userId) {
  const [state, setState] = useState({ loading: true, branchId: null, role: null });

  useEffect(() => {
    let cancelled = false;
    if (!userId) {
      setState({ loading: false, branchId: null, role: null });
      return;
    }
    (async () => {
      setState((s) => ({ ...s, loading: true }));
      const { data, error } = await supabase
        .from('users')
        .select('branch_id, role')
        .eq('id', userId)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        setState({ loading: false, branchId: null, role: null });
        return;
      }
      setState({
        loading: false,
        branchId: data.branch_id ?? null,
        role: data.role ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return state;
}

/**
 * Loan officer UUIDs in a branch (role = officer). Used for manager-scoped `.in('officer_id', ids)`.
 */
export async function fetchOfficerIdsForBranch(branchId) {
  if (!branchId) return [];
  const { data, error } = await supabase
    .from('users')
    .select('id')
    .eq('branch_id', branchId)
    .eq('role', 'officer');
  if (error) throw error;
  return (data || []).map((r) => r.id);
}
