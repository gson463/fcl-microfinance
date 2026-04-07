import { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { ALL } from '@/lib/hierarchyFilterUtils';
import { useUserProfileScope } from '@/hooks/useUserProfileScope';

/**
 * Shared branch → center → group → officer + disbursement date range state for reporting pages.
 * Managers default to their branch; officers default to themselves as officer filter.
 * Branch/role come from `public.users` when available (JWT metadata can be stale).
 */
export function useHierarchyFilters(user) {
  const { loading: profileLoading, branchId: profileBranchId, role: profileRole } = useUserProfileScope(user?.id);
  const role = profileRole ?? user?.user_metadata?.role;
  const userBranchId = profileBranchId ?? user?.user_metadata?.branch_id ?? null;

  const [branches, setBranches] = useState([]);
  const [centers, setCenters] = useState([]);
  const [groups, setGroups] = useState([]);
  const [officers, setOfficers] = useState([]);

  const [branchId, setBranchId] = useState(ALL);
  const [centerId, setCenterId] = useState(ALL);
  const [groupId, setGroupId] = useState(ALL);
  const [officerId, setOfficerId] = useState(ALL);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [br, cen, grp, off] = await Promise.all([
        supabase.from('branches').select('id, name').order('name'),
        supabase.from('centers').select('id, name, branch_id').order('name'),
        supabase.from('groups').select('id, name, center_id, loan_officer_id').order('name'),
        supabase.from('users').select('id, full_name, branch_id, role').eq('role', 'officer').order('full_name'),
      ]);
      if (cancelled) return;
      setBranches(br.data || []);
      setCenters(cen.data || []);
      setGroups(grp.data || []);
      setOfficers(off.data || []);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (profileLoading) return;
    if (role === 'manager' && userBranchId) {
      setBranchId(userBranchId);
    }
    if (role === 'officer' && userBranchId) {
      setBranchId(userBranchId);
    }
    if (role === 'officer' && user?.id) {
      setOfficerId(user.id);
    }
  }, [profileLoading, role, userBranchId, user?.id]);

  useEffect(() => {
    setCenterId(ALL);
    setGroupId(ALL);
  }, [branchId]);

  useEffect(() => {
    setGroupId(ALL);
  }, [centerId]);

  const centersForBranch = useMemo(() => {
    if (branchId === ALL) return centers;
    return centers.filter((c) => c.branch_id === branchId);
  }, [centers, branchId]);

  const groupsForCenter = useMemo(() => {
    if (centerId === ALL) return [];
    return groups.filter((g) => g.center_id === centerId);
  }, [groups, centerId]);

  const officersForBranch = useMemo(() => {
    const list = officers.filter((o) => o.role === 'officer');
    if (branchId === ALL) return list;
    return list.filter((o) => o.branch_id === branchId);
  }, [officers, branchId]);

  const resetFilters = useCallback(() => {
    setCenterId(ALL);
    setGroupId(ALL);
    setDateFrom('');
    setDateTo('');
    if (role === 'officer' && user?.id) {
      setOfficerId(user.id);
    } else {
      setOfficerId(ALL);
    }
    if (role === 'manager' && userBranchId) {
      setBranchId(userBranchId);
    } else if (role === 'officer' && userBranchId) {
      setBranchId(userBranchId);
    } else if (role === 'admin') {
      setBranchId(ALL);
    }
  }, [role, userBranchId, user?.id]);

  const filterParams = useMemo(
    () => ({
      branchId,
      centerId,
      groupId,
      officerId,
      dateFrom,
      dateTo,
    }),
    [branchId, centerId, groupId, officerId, dateFrom, dateTo]
  );

  return {
    ALL,
    branches,
    centers,
    groups,
    officers,
    centersForBranch,
    groupsForCenter,
    officersForBranch,
    branchId,
    setBranchId,
    centerId,
    setCenterId,
    groupId,
    setGroupId,
    officerId,
    setOfficerId,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    resetFilters,
    filterParams,
    role,
    userBranchId,
  };
}
