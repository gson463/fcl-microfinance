import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO, isValid } from 'date-fns';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { supabase } from '@/lib/customSupabaseClient';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, ChevronLeft, ChevronRight, Archive, ScrollText, Filter, RotateCcw, ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { HierarchyFilterBar } from '@/components/filters/HierarchyFilterBar';
import { ALL } from '@/lib/hierarchyFilterUtils';
import { borrowerPublicId, borrowerPublicIdOrDash } from '@/lib/borrowerPublicId';
import { formatAuditEventSummary, auditMetadataJsonString } from '@/lib/auditEventDisplay';

const PAGE_SIZE = 25;
const AUDIT_PAGE_SIZE = 40;
const LOAN_INCREASE_PAGE_SIZE = 25;

const EMPTY_AUDIT = {
  from: '',
  to: '',
  action: '',
  branchId: '',
  userId: '',
  userRole: '',
  centerId: '',
  groupId: '',
};

function safeFormatDate(iso) {
  if (iso == null || iso === '') return '—';
  try {
    const d = typeof iso === 'string' ? parseISO(iso) : new Date(iso);
    if (!isValid(d)) return '—';
    return format(d, 'yyyy-MM-dd HH:mm:ss');
  } catch {
    return '—';
  }
}

function toIsoOrNull(localDatetime) {
  if (localDatetime == null || String(localDatetime).trim() === '') return null;
  const d = new Date(localDatetime);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function buildAuditRpcArgs(applied, page) {
  const o = (s) => (s != null && String(s).trim() !== '' ? String(s).trim() : null);
  return {
    p_limit: AUDIT_PAGE_SIZE,
    p_offset: (page - 1) * AUDIT_PAGE_SIZE,
    p_from: toIsoOrNull(applied.from),
    p_to: toIsoOrNull(applied.to),
    p_user_id: o(applied.userId),
    p_branch_id: o(applied.branchId),
    p_user_role: o(applied.userRole),
    p_action: o(applied.action),
    p_entity_type: null,
    p_entity_id: null,
    p_ip: null,
    p_location: null,
    p_device: null,
    p_metadata: null,
    p_center_id: o(applied.centerId),
    p_group_id: o(applied.groupId),
  };
}

const AdminDataHistory = () => {
  const [currency, setCurrency] = useState('TZS');
  const [branches, setBranches] = useState([]);
  const [centers, setCenters] = useState([]);
  const [groups, setGroups] = useState([]);
  const [officersList, setOfficersList] = useState([]);
  const [usersList, setUsersList] = useState([]);

  const [deletedLoans, setDeletedLoans] = useState([]);
  const [deletedRepayments, setDeletedRepayments] = useState([]);
  const [loadingLoans, setLoadingLoans] = useState(true);
  const [loadingRepay, setLoadingRepay] = useState(true);

  const [loanBranch, setLoanBranch] = useState(ALL);
  const [loanCenter, setLoanCenter] = useState(ALL);
  const [loanGroup, setLoanGroup] = useState(ALL);
  const [loanOfficer, setLoanOfficer] = useState(ALL);
  const [loanDateFrom, setLoanDateFrom] = useState('');
  const [loanDateTo, setLoanDateTo] = useState('');
  const [loanSearch, setLoanSearch] = useState('');
  const [repayBranch, setRepayBranch] = useState(ALL);
  const [repayCenter, setRepayCenter] = useState(ALL);
  const [repayGroup, setRepayGroup] = useState(ALL);
  const [repayOfficer, setRepayOfficer] = useState(ALL);
  const [repayDateFrom, setRepayDateFrom] = useState('');
  const [repayDateTo, setRepayDateTo] = useState('');
  const [repaySearch, setRepaySearch] = useState('');

  const [auditRows, setAuditRows] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditUserMap, setAuditUserMap] = useState({});
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditPage, setAuditPage] = useState(1);
  const [auditDraft, setAuditDraft] = useState(EMPTY_AUDIT);
  const [auditApplied, setAuditApplied] = useState(EMPTY_AUDIT);
  const [auditError, setAuditError] = useState(null);

  const [loanIncreaseRows, setLoanIncreaseRows] = useState([]);
  const [loadingLoanIncrease, setLoadingLoanIncrease] = useState(true);
  const [liPage, setLiPage] = useState(1);
  const [liBranch, setLiBranch] = useState(ALL);
  const [liCenter, setLiCenter] = useState(ALL);
  const [liGroup, setLiGroup] = useState(ALL);
  const [liOfficer, setLiOfficer] = useState(ALL);
  const [liDateFrom, setLiDateFrom] = useState('');
  const [liDateTo, setLiDateTo] = useState('');
  const [liSearch, setLiSearch] = useState('');

  const fetchLoanIncreaseHistory = useCallback(async () => {
    setLoadingLoanIncrease(true);
    const { data, error } = await supabase
      .from('loan_increase_exception_requests')
      .select(
        `id, officer_id, status, officer_notes, manager_notes, created_at, resolved_at, approved_at, consumed_at, consumed_at_loan_id,
         borrowers(first_name, surname, borrower_id, branch_id, center_id, group_id),
         officer:users!officer_id(full_name, branch_id),
         manager:users!manager_id(full_name)`
      )
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) {
      console.error(error);
      setLoanIncreaseRows([]);
    } else {
      setLoanIncreaseRows(data || []);
    }
    setLoadingLoanIncrease(false);
  }, []);

  useEffect(() => {
    (async () => {
      const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
      if (config?.value) setCurrency(config.value);
      const [brRes, cenRes, grpRes, offRes, usrRes] = await Promise.all([
        supabase.from('branches').select('id, name').order('name'),
        supabase.from('centers').select('id, name, branch_id').order('name'),
        supabase.from('groups').select('id, name, center_id, loan_officer_id').order('name'),
        supabase.from('users').select('id, full_name, branch_id, role').eq('role', 'officer').order('full_name'),
        supabase.from('users').select('id, full_name, email, role').order('full_name'),
      ]);
      setBranches(brRes.data || []);
      setCenters(cenRes.data || []);
      setGroups(grpRes.data || []);
      setOfficersList(offRes.data || []);
      setUsersList(usrRes.data || []);
    })();
  }, []);

  const centersForLoanBranch = useMemo(() => {
    if (loanBranch === ALL) return centers;
    return centers.filter((c) => c.branch_id === loanBranch);
  }, [centers, loanBranch]);

  const groupsForLoanCenter = useMemo(() => {
    if (loanCenter === ALL) return [];
    return groups.filter((g) => g.center_id === loanCenter);
  }, [groups, loanCenter]);

  const officersForLoanBranch = useMemo(() => {
    if (loanBranch === ALL) return officersList;
    return officersList.filter((o) => o.branch_id === loanBranch);
  }, [officersList, loanBranch]);

  const centersForRepayBranch = useMemo(() => {
    if (repayBranch === ALL) return centers;
    return centers.filter((c) => c.branch_id === repayBranch);
  }, [centers, repayBranch]);

  const groupsForRepayCenter = useMemo(() => {
    if (repayCenter === ALL) return [];
    return groups.filter((g) => g.center_id === repayCenter);
  }, [groups, repayCenter]);

  const officersForRepayBranch = useMemo(() => {
    if (repayBranch === ALL) return officersList;
    return officersList.filter((o) => o.branch_id === repayBranch);
  }, [officersList, repayBranch]);

  const centersForLiBranch = useMemo(() => {
    if (liBranch === ALL) return centers;
    return centers.filter((c) => c.branch_id === liBranch);
  }, [centers, liBranch]);

  const groupsForLiCenter = useMemo(() => {
    if (liCenter === ALL) return [];
    return groups.filter((g) => g.center_id === liCenter);
  }, [groups, liCenter]);

  const officersForLiBranch = useMemo(() => {
    if (liBranch === ALL) return officersList;
    return officersList.filter((o) => o.branch_id === liBranch);
  }, [officersList, liBranch]);

  const auditCentersForBranch = useMemo(() => {
    const b = auditDraft.branchId;
    if (!b || b === '') return centers;
    return centers.filter((c) => c.branch_id === b);
  }, [centers, auditDraft.branchId]);

  const auditGroupsForCenter = useMemo(() => {
    const c = auditDraft.centerId;
    if (!c || c === '') return [];
    return groups.filter((g) => g.center_id === c);
  }, [groups, auditDraft.centerId]);

  const auditBranchOptions = useMemo(() => branches.map((b) => ({ value: b.id, label: b.name })), [branches]);
  const auditCenterOptions = useMemo(
    () => auditCentersForBranch.map((c) => ({ value: c.id, label: c.name })),
    [auditCentersForBranch]
  );
  const auditGroupOptions = useMemo(
    () => auditGroupsForCenter.map((g) => ({ value: g.id, label: g.name })),
    [auditGroupsForCenter]
  );
  const auditUserOptions = useMemo(
    () => usersList.map((u) => ({ value: u.id, label: `${u.full_name} (${u.email})` })),
    [usersList]
  );
  const auditRoleOptions = useMemo(
    () => [
      { value: 'admin', label: 'admin' },
      { value: 'manager', label: 'manager' },
      { value: 'officer', label: 'officer' },
    ],
    []
  );

  useEffect(() => {
    setLoanCenter(ALL);
    setLoanGroup(ALL);
  }, [loanBranch]);

  useEffect(() => {
    setLoanGroup(ALL);
  }, [loanCenter]);

  useEffect(() => {
    setRepayCenter(ALL);
    setRepayGroup(ALL);
  }, [repayBranch]);

  useEffect(() => {
    setRepayGroup(ALL);
  }, [repayCenter]);

  useEffect(() => {
    setLiCenter(ALL);
    setLiGroup(ALL);
  }, [liBranch]);

  useEffect(() => {
    setLiGroup(ALL);
  }, [liCenter]);

  const fetchDeletedLoans = useCallback(async () => {
    setLoadingLoans(true);
    const { data, error } = await supabase
      .from('deleted_loan_records')
      .select('*')
      .order('deleted_at', { ascending: false });
    if (error) {
      console.error(error);
      setDeletedLoans([]);
      setLoadingLoans(false);
      return;
    }
    const rows = data || [];
    const ids = [...new Set(rows.map((r) => r.borrower_id).filter(Boolean))];
    let borrowerMap = {};
    if (ids.length > 0) {
      const { data: bRows } = await supabase.from('borrowers').select('id, center_id, group_id, branch_id').in('id', ids);
      (bRows || []).forEach((b) => {
        borrowerMap[b.id] = b;
      });
    }
    setDeletedLoans(
      rows.map((r) => ({
        ...r,
        borrowerMeta: r.borrower_id ? borrowerMap[r.borrower_id] : null,
      }))
    );
    setLoadingLoans(false);
  }, []);

  const fetchDeletedRepayments = useCallback(async () => {
    setLoadingRepay(true);
    const { data, error } = await supabase
      .from('deleted_repayment_records')
      .select('*')
      .order('deleted_at', { ascending: false });
    if (error) {
      console.error(error);
      setDeletedRepayments([]);
    } else {
      setDeletedRepayments(data || []);
    }
    setLoadingRepay(false);
  }, []);

  useEffect(() => {
    fetchDeletedLoans();
    fetchDeletedRepayments();
    fetchLoanIncreaseHistory();
  }, [fetchDeletedLoans, fetchDeletedRepayments, fetchLoanIncreaseHistory]);

  useEffect(() => {
    setLiPage(1);
  }, [loanIncreaseRows.length, liBranch, liCenter, liGroup, liOfficer, liDateFrom, liDateTo, liSearch]);

  const filteredLoanIncrease = useMemo(() => {
    const q = liSearch.trim().toLowerCase();
    return loanIncreaseRows.filter((row) => {
      if (liBranch !== ALL) {
        const ob = row.officer?.branch_id;
        const bb = row.borrowers?.branch_id;
        if (ob !== liBranch && bb !== liBranch) return false;
      }
      if (liOfficer !== ALL && row.officer_id !== liOfficer) return false;
      if (liCenter !== ALL && row.borrowers?.center_id !== liCenter) return false;
      if (liGroup !== ALL && row.borrowers?.group_id !== liGroup) return false;
      if (liDateFrom && row.created_at) {
        const d = new Date(row.created_at).toISOString().slice(0, 10);
        if (d < liDateFrom) return false;
      }
      if (liDateTo && row.created_at) {
        const d = new Date(row.created_at).toISOString().slice(0, 10);
        if (d > liDateTo) return false;
      }
      if (!q) return true;
      const name = `${row.borrowers?.first_name || ''} ${row.borrowers?.surname || ''}`.toLowerCase();
      const bid = String(row.borrowers?.borrower_id || '').toLowerCase();
      return name.includes(q) || bid.includes(q);
    });
  }, [loanIncreaseRows, liBranch, liCenter, liGroup, liOfficer, liDateFrom, liDateTo, liSearch]);

  const liTotalPages = Math.max(1, Math.ceil(filteredLoanIncrease.length / LOAN_INCREASE_PAGE_SIZE));

  const pagedLoanIncrease = useMemo(() => {
    const start = (liPage - 1) * LOAN_INCREASE_PAGE_SIZE;
    return filteredLoanIncrease.slice(start, start + LOAN_INCREASE_PAGE_SIZE);
  }, [filteredLoanIncrease, liPage]);

  useEffect(() => {
    if (liPage > liTotalPages) setLiPage(Math.max(1, liTotalPages));
  }, [liPage, liTotalPages]);

  const exportLoanIncreaseCsv = () => {
    if (filteredLoanIncrease.length === 0) {
      return;
    }
    exportObjectsToCsv(`loan_increase_approval_history_${Date.now()}.csv`, [
      { header: 'Status', accessor: 'status' },
      { header: 'Borrower', accessor: (r) => `${r.borrowers?.first_name || ''} ${r.borrowers?.surname || ''}`.trim() },
      { header: 'Borrower ID', accessor: (r) => r.borrowers?.borrower_id || '' },
      { header: 'Officer', accessor: (r) => r.officer?.full_name || '' },
      { header: 'Officer branch', accessor: (r) => branches.find((b) => b.id === r.officer?.branch_id)?.name || '' },
      { header: 'Officer notes', accessor: (r) => String(r.officer_notes ?? '') },
      { header: 'Submitted', accessor: (r) => (r.created_at ? new Date(r.created_at).toISOString() : '') },
      { header: 'Manager', accessor: (r) => r.manager?.full_name || '' },
      { header: 'Manager notes', accessor: (r) => String(r.manager_notes ?? '') },
      { header: 'Resolved', accessor: (r) => (r.resolved_at ? new Date(r.resolved_at).toISOString() : '') },
      { header: 'Consumed at', accessor: (r) => (r.consumed_at ? new Date(r.consumed_at).toISOString() : '') },
      { header: 'Loan UUID (consumed)', accessor: (r) => String(r.consumed_at_loan_id ?? '') },
    ], filteredLoanIncrease);
  };

  const filteredLoans = useMemo(() => {
    const q = loanSearch.trim().toLowerCase();
    return deletedLoans.filter((row) => {
      if (loanBranch !== ALL && row.branch_id !== loanBranch) return false;
      if (loanOfficer !== ALL && row.officer_id !== loanOfficer) return false;
      const bm = row.borrowerMeta;
      if (loanCenter !== ALL && bm?.center_id !== loanCenter) return false;
      if (loanGroup !== ALL && bm?.group_id !== loanGroup) return false;
      if (loanDateFrom && row.deleted_at) {
        const d = new Date(row.deleted_at).toISOString().slice(0, 10);
        if (d < loanDateFrom) return false;
      }
      if (loanDateTo && row.deleted_at) {
        const d = new Date(row.deleted_at).toISOString().slice(0, 10);
        if (d > loanDateTo) return false;
      }
      if (!q) return true;
      const hay = `${row.loan_public_id || ''} ${row.borrower_name || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [
    deletedLoans,
    loanBranch,
    loanCenter,
    loanGroup,
    loanOfficer,
    loanDateFrom,
    loanDateTo,
    loanSearch,
  ]);

  const filteredRepay = useMemo(() => {
    const q = repaySearch.trim().toLowerCase();
    return deletedRepayments.filter((row) => {
      if (repayBranch !== ALL && row.branch_id !== repayBranch) return false;
      if (repayOfficer !== ALL && row.officer_id !== repayOfficer) return false;
      const b = row.snapshot?.loan?.borrowers;
      if (repayCenter !== ALL && b?.center_id !== repayCenter) return false;
      if (repayGroup !== ALL && b?.group_id !== repayGroup) return false;
      if (repayDateFrom && row.deleted_at) {
        const d = new Date(row.deleted_at).toISOString().slice(0, 10);
        if (d < repayDateFrom) return false;
      }
      if (repayDateTo && row.deleted_at) {
        const d = new Date(row.deleted_at).toISOString().slice(0, 10);
        if (d > repayDateTo) return false;
      }
      if (!q) return true;
      const hay = `${row.loan_public_id || ''} ${row.borrower_name || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [
    deletedRepayments,
    repayBranch,
    repayCenter,
    repayGroup,
    repayOfficer,
    repayDateFrom,
    repayDateTo,
    repaySearch,
  ]);

  const fetchAudit = useCallback(async () => {
    setAuditLoading(true);
    setAuditError(null);
    const args = buildAuditRpcArgs(auditApplied, auditPage);
    const { data, error } = await supabase.rpc('get_audit_logs_admin', args);
    if (error) {
      setAuditRows([]);
      setAuditTotal(0);
      setAuditUserMap({});
      setAuditError(error.message || 'Could not load activity log.');
      setAuditLoading(false);
      return;
    }
    let payload = data;
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        payload = {};
      }
    }
    const list = Array.isArray(payload?.rows) ? payload.rows : [];
    const count = typeof payload?.total === 'number' ? payload.total : list.length;
    setAuditRows(list);
    setAuditTotal(count);

    const ids = [...new Set(list.map((r) => r.user_id).filter(Boolean))];
    if (ids.length === 0) {
      setAuditUserMap({});
      setAuditLoading(false);
      return;
    }
    const { data: usersData } = await supabase.from('users').select('id, full_name, email').in('id', ids);
    const map = {};
    (usersData || []).forEach((u) => {
      map[u.id] = u;
    });
    setAuditUserMap(map);
    setAuditLoading(false);
  }, [auditApplied, auditPage]);

  useEffect(() => {
    fetchAudit();
  }, [fetchAudit]);

  const auditTotalPages = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE));

  const rawMetaLine = (m) => {
    const s = auditMetadataJsonString(m);
    return s || '—';
  };

  return (
    <DashboardLayout title="Data history & activity">
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <Archive className="h-8 w-8 shrink-0 text-brand-blue" aria-hidden />
          <div>
            <p className="text-sm text-neutral-600 max-w-3xl">
              View archived deleted loans and repayments (after manager approval), the full history of loan increase
              approval requests (officer submissions and branch manager decisions), and browse the activity log to see what
              happened—requests, approvals, deletions, and other recorded actions. Each tab supports filters from branch
              through center, group, and loan officer, plus date ranges (deleted at, submitted at, or activity time).
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              For the full activity log with all filter fields, open{' '}
              <Link to="/admin/audit-logs" className="font-medium text-brand-blue underline inline-flex items-center gap-1">
                Activity log <ExternalLink className="h-3 w-3" />
              </Link>
              .
            </p>
          </div>
        </div>

        <Tabs defaultValue="loans" className="space-y-4">
          <TabsList className="flex flex-wrap h-auto gap-1">
            <TabsTrigger value="loans">Deleted loans</TabsTrigger>
            <TabsTrigger value="repayments">Deleted repayments</TabsTrigger>
            <TabsTrigger value="loan-increase">Loan increase approvals</TabsTrigger>
            <TabsTrigger value="activity">Activity log</TabsTrigger>
          </TabsList>

          <TabsContent value="loans">
            <Card>
              <CardHeader>
                <CardTitle>Deleted loans (archive)</CardTitle>
                <CardDescription>Loans removed after the loan officer requested deletion and the branch manager approved.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <HierarchyFilterBar
                  branches={branches}
                  centersForBranch={centersForLoanBranch}
                  groupsForCenter={groupsForLoanCenter}
                  officersForBranch={officersForLoanBranch}
                  branchId={loanBranch}
                  setBranchId={setLoanBranch}
                  centerId={loanCenter}
                  setCenterId={setLoanCenter}
                  groupId={loanGroup}
                  setGroupId={setLoanGroup}
                  officerId={loanOfficer}
                  setOfficerId={setLoanOfficer}
                  dateFrom={loanDateFrom}
                  setDateFrom={setLoanDateFrom}
                  dateTo={loanDateTo}
                  setDateTo={setLoanDateTo}
                  dateLabelFrom="Deleted from"
                  dateLabelTo="Deleted to"
                />
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="loan-search">Search</Label>
                    <Input
                      id="loan-search"
                      className="w-[280px]"
                      placeholder="Loan ID or borrower name"
                      value={loanSearch}
                      onChange={(e) => setLoanSearch(e.target.value)}
                    />
                  </div>
                  <Button type="button" variant="outline" className="self-end" onClick={() => fetchDeletedLoans()}>
                    Refresh
                  </Button>
                </div>
                {loadingLoans ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Deleted at</TableHead>
                          <TableHead>Loan ID</TableHead>
                          <TableHead>Borrower</TableHead>
                          <TableHead>Principal</TableHead>
                          <TableHead>Branch</TableHead>
                          <TableHead>Manager approval</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredLoans.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              No records match the filters.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredLoans.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="whitespace-nowrap">{safeFormatDate(row.deleted_at)}</TableCell>
                              <TableCell>{row.loan_public_id}</TableCell>
                              <TableCell>{row.borrower_name || '—'}</TableCell>
                              <TableCell>
                                {currency}{' '}
                                {row.principal != null
                                  ? Number(row.principal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                  : '—'}
                              </TableCell>
                              <TableCell>{branches.find((b) => b.id === row.branch_id)?.name || '—'}</TableCell>
                              <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate" title={row.approved_by_manager_id}>
                                {row.approved_by_manager_id ? String(row.approved_by_manager_id).slice(0, 8) + '…' : '—'}
                              </TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="repayments">
            <Card>
              <CardHeader>
                <CardTitle>Deleted repayments (archive)</CardTitle>
                <CardDescription>Repayments removed after the officer requested deletion and the manager approved.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <HierarchyFilterBar
                  branches={branches}
                  centersForBranch={centersForRepayBranch}
                  groupsForCenter={groupsForRepayCenter}
                  officersForBranch={officersForRepayBranch}
                  branchId={repayBranch}
                  setBranchId={setRepayBranch}
                  centerId={repayCenter}
                  setCenterId={setRepayCenter}
                  groupId={repayGroup}
                  setGroupId={setRepayGroup}
                  officerId={repayOfficer}
                  setOfficerId={setRepayOfficer}
                  dateFrom={repayDateFrom}
                  setDateFrom={setRepayDateFrom}
                  dateTo={repayDateTo}
                  setDateTo={setRepayDateTo}
                  dateLabelFrom="Deleted from"
                  dateLabelTo="Deleted to"
                />
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="repay-search">Search</Label>
                    <Input
                      id="repay-search"
                      className="w-[280px]"
                      placeholder="Loan ID or borrower name"
                      value={repaySearch}
                      onChange={(e) => setRepaySearch(e.target.value)}
                    />
                  </div>
                  <Button type="button" variant="outline" className="self-end" onClick={() => fetchDeletedRepayments()}>
                    Refresh
                  </Button>
                </div>
                {loadingRepay ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <div className="overflow-x-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Deleted at</TableHead>
                          <TableHead>Loan ID</TableHead>
                          <TableHead>Borrower</TableHead>
                          <TableHead>Amount</TableHead>
                          <TableHead>Payment date</TableHead>
                          <TableHead>Branch</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredRepay.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                              No records match the filters.
                            </TableCell>
                          </TableRow>
                        ) : (
                          filteredRepay.map((row) => (
                            <TableRow key={row.id}>
                              <TableCell className="whitespace-nowrap">{safeFormatDate(row.deleted_at)}</TableCell>
                              <TableCell>{row.loan_public_id || '—'}</TableCell>
                              <TableCell>{row.borrower_name || '—'}</TableCell>
                              <TableCell>
                                {currency}{' '}
                                {row.amount != null
                                  ? Number(row.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                                  : '—'}
                              </TableCell>
                              <TableCell>
                                {row.actual_payment_date ? String(row.actual_payment_date) : '—'}
                              </TableCell>
                              <TableCell>{branches.find((b) => b.id === row.branch_id)?.name || '—'}</TableCell>
                            </TableRow>
                          ))
                        )}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="loan-increase">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Loan increase approval history</CardTitle>
                    <CardDescription>
                      Every officer request and branch manager approval (or rejection) for new loans after a completed prior
                      loan. Includes when an approval was used at disburse. Up to 500 most recent rows loaded; filter by branch
                      or search by borrower.
                    </CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={exportLoanIncreaseCsv} disabled={filteredLoanIncrease.length === 0}>
                    Export CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <HierarchyFilterBar
                  branches={branches}
                  centersForBranch={centersForLiBranch}
                  groupsForCenter={groupsForLiCenter}
                  officersForBranch={officersForLiBranch}
                  branchId={liBranch}
                  setBranchId={setLiBranch}
                  centerId={liCenter}
                  setCenterId={setLiCenter}
                  groupId={liGroup}
                  setGroupId={setLiGroup}
                  officerId={liOfficer}
                  setOfficerId={setLiOfficer}
                  dateFrom={liDateFrom}
                  setDateFrom={setLiDateFrom}
                  dateTo={liDateTo}
                  setDateTo={setLiDateTo}
                  dateLabelFrom="Submitted from"
                  dateLabelTo="Submitted to"
                />
                <div className="flex flex-wrap items-end gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="li-search">Search borrower</Label>
                    <Input
                      id="li-search"
                      className="w-[280px]"
                      placeholder="Name or borrower ID"
                      value={liSearch}
                      onChange={(e) => setLiSearch(e.target.value)}
                    />
                  </div>
                  <Button type="button" variant="outline" className="self-end" onClick={() => fetchLoanIncreaseHistory()}>
                    Refresh
                  </Button>
                </div>
                {loadingLoanIncrease ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Status</TableHead>
                            <TableHead>Borrower</TableHead>
                            <TableHead>Branch</TableHead>
                            <TableHead>Officer</TableHead>
                            <TableHead>Submitted</TableHead>
                            <TableHead>Manager</TableHead>
                            <TableHead>Resolved</TableHead>
                            <TableHead>Used at disburse</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {pagedLoanIncrease.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                                No records match the filters.
                              </TableCell>
                            </TableRow>
                          ) : (
                            pagedLoanIncrease.map((row) => (
                              <TableRow key={row.id}>
                                <TableCell>
                                  <Badge
                                    variant={
                                      row.status === 'approved'
                                        ? 'default'
                                        : row.status === 'rejected'
                                          ? 'destructive'
                                          : 'secondary'
                                    }
                                  >
                                    {row.status}
                                  </Badge>
                                </TableCell>
                                <TableCell>
                                  {row.borrowers ? `${row.borrowers.first_name} ${row.borrowers.surname}`.trim() : '—'}
                                  {borrowerPublicId(row.borrowers) ? (
                                    <span className="block text-xs text-muted-foreground">ID: {borrowerPublicId(row.borrowers)}</span>
                                  ) : null}
                                </TableCell>
                                <TableCell className="text-sm">
                                  {branches.find((b) => b.id === row.officer?.branch_id || b.id === row.borrowers?.branch_id)?.name ||
                                    '—'}
                                </TableCell>
                                <TableCell className="text-sm">{row.officer?.full_name ?? '—'}</TableCell>
                                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                  {safeFormatDate(row.created_at)}
                                </TableCell>
                                <TableCell className="text-sm">{row.manager?.full_name ?? '—'}</TableCell>
                                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                  {safeFormatDate(row.resolved_at)}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                                  {safeFormatDate(row.consumed_at)}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    {filteredLoanIncrease.length > LOAN_INCREASE_PAGE_SIZE && (
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <p className="text-sm text-muted-foreground">
                          Showing {(liPage - 1) * LOAN_INCREASE_PAGE_SIZE + 1}–
                          {Math.min(liPage * LOAN_INCREASE_PAGE_SIZE, filteredLoanIncrease.length)} of {filteredLoanIncrease.length}{' '}
                          (loaded {loanIncreaseRows.length})
                        </p>
                        <div className="flex items-center gap-2">
                          <Button variant="outline" size="sm" disabled={liPage <= 1} onClick={() => setLiPage((p) => Math.max(1, p - 1))}>
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <span className="text-sm text-muted-foreground">
                            Page {liPage} / {liTotalPages}
                          </span>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={liPage >= liTotalPages}
                            onClick={() => setLiPage((p) => Math.min(liTotalPages, p + 1))}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                    <details className="rounded-md border border-neutral-200 bg-neutral-50/80 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/40">
                      <summary className="cursor-pointer font-medium text-neutral-800 dark:text-neutral-200">
                        Officer &amp; manager notes (current page)
                      </summary>
                      <div className="mt-3 space-y-3">
                        {pagedLoanIncrease.map((row) => (
                          <div key={`${row.id}-notes`} className="rounded border border-neutral-200/80 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-950/50">
                            <p className="text-xs font-semibold text-neutral-500">
                              {borrowerPublicIdOrDash(row.borrowers)} · {row.status}
                            </p>
                            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                              <span className="font-medium">Officer:</span> {row.officer_notes || '—'}
                            </p>
                            {row.manager_notes ? (
                              <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                                <span className="font-medium">Manager:</span> {row.manager_notes}
                              </p>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </details>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <ScrollText className="h-5 w-5 text-muted-foreground" aria-hidden />
                  <CardTitle className="text-base">Activity log (preview)</CardTitle>
                </div>
                <CardDescription>
                  Each row shows <strong>what happened</strong> in plain language (plus technical action code and IDs). Filters
                  match the actor&apos;s branch, center, group, user, and role. Use Apply, then change page.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {auditError && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {auditError}
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  <div className="space-y-2">
                    <Label htmlFor="ah-from">From</Label>
                    <Input
                      id="ah-from"
                      type="datetime-local"
                      value={auditDraft.from}
                      onChange={(e) => setAuditDraft((p) => ({ ...p, from: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ah-to">To</Label>
                    <Input
                      id="ah-to"
                      type="datetime-local"
                      value={auditDraft.to}
                      onChange={(e) => setAuditDraft((p) => ({ ...p, to: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="ah-action">Action (contains)</Label>
                    <Input
                      id="ah-action"
                      placeholder="e.g. delete, login"
                      value={auditDraft.action}
                      onChange={(e) => setAuditDraft((p) => ({ ...p, action: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Branch (actor)</Label>
                    <SearchableSelect
                      value={auditDraft.branchId}
                      onValueChange={(v) =>
                        setAuditDraft((p) => ({
                          ...p,
                          branchId: v,
                          centerId: '',
                          groupId: '',
                        }))
                      }
                      options={auditBranchOptions}
                      allLabel="Any branch"
                      allValue=""
                      placeholder="Any branch"
                      searchPlaceholder="Search branches…"
                      emptyText="No branch found."
                      triggerClassName="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Center (actor)</Label>
                    <SearchableSelect
                      value={auditDraft.centerId}
                      onValueChange={(v) =>
                        setAuditDraft((p) => ({
                          ...p,
                          centerId: v,
                          groupId: '',
                        }))
                      }
                      options={auditCenterOptions}
                      allLabel="Any center"
                      allValue=""
                      placeholder="Any center"
                      searchPlaceholder="Search centers…"
                      emptyText="No center found."
                      triggerClassName="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Group (actor)</Label>
                    <SearchableSelect
                      value={auditDraft.groupId}
                      onValueChange={(v) => setAuditDraft((p) => ({ ...p, groupId: v }))}
                      options={auditGroupOptions}
                      allLabel="Any group"
                      allValue=""
                      placeholder={auditDraft.centerId ? 'Any group' : 'Pick a center first'}
                      searchPlaceholder="Search groups…"
                      emptyText="No group found."
                      disabled={!auditDraft.centerId}
                      triggerClassName="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>User</Label>
                    <SearchableSelect
                      value={auditDraft.userId}
                      onValueChange={(v) => setAuditDraft((p) => ({ ...p, userId: v }))}
                      options={auditUserOptions}
                      allLabel="Any user"
                      allValue=""
                      placeholder="Any user"
                      searchPlaceholder="Search users…"
                      emptyText="No user found."
                      triggerClassName="w-full"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Role</Label>
                    <SearchableSelect
                      value={auditDraft.userRole}
                      onValueChange={(v) => setAuditDraft((p) => ({ ...p, userRole: v }))}
                      options={auditRoleOptions}
                      allLabel="Any role"
                      allValue=""
                      placeholder="Any role"
                      searchPlaceholder="Search roles…"
                      emptyText="No role found."
                      triggerClassName="w-full"
                    />
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 pt-2">
                  <Button
                    type="button"
                    onClick={() => {
                      setAuditApplied({ ...auditDraft });
                      setAuditPage(1);
                    }}
                  >
                    <Filter className="mr-2 h-4 w-4" />
                    Apply
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setAuditDraft(EMPTY_AUDIT);
                      setAuditApplied(EMPTY_AUDIT);
                      setAuditPage(1);
                    }}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Clear
                  </Button>
                </div>

                {auditLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <>
                    <div className="overflow-x-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="whitespace-nowrap">Time</TableHead>
                            <TableHead>User</TableHead>
                            <TableHead className="min-w-[220px] max-w-[min(420px,40vw)]">What happened</TableHead>
                            <TableHead>Action (code)</TableHead>
                            <TableHead>Entity</TableHead>
                            <TableHead className="min-w-[180px]">Raw metadata</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {auditRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                                No rows for this page / filters.
                              </TableCell>
                            </TableRow>
                          ) : (
                            auditRows.map((r) => (
                              <TableRow key={r.id}>
                                <TableCell className="whitespace-nowrap text-xs">{safeFormatDate(r.created_at)}</TableCell>
                                <TableCell className="text-sm">
                                  {r.user_id && auditUserMap[r.user_id]
                                    ? auditUserMap[r.user_id].full_name
                                    : r.user_id
                                      ? '—'
                                      : '—'}
                                </TableCell>
                                <TableCell className="text-sm text-neutral-800 dark:text-neutral-100">
                                  {formatAuditEventSummary(r)}
                                </TableCell>
                                <TableCell className="font-mono text-xs">{r.action || '—'}</TableCell>
                                <TableCell className="text-xs">
                                  {[r.entity_type, r.entity_id].filter(Boolean).join(' / ') || '—'}
                                </TableCell>
                                <TableCell
                                  className="text-xs font-mono max-w-[280px] truncate align-top"
                                  title={rawMetaLine(r.metadata)}
                                >
                                  {rawMetaLine(r.metadata)}
                                </TableCell>
                              </TableRow>
                            ))
                          )}
                        </TableBody>
                      </Table>
                    </div>
                    {auditTotal > 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-4">
                        <p className="text-sm text-muted-foreground">
                          Page {auditPage} / {auditTotalPages} — about {auditTotal} matching rows total
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={auditPage <= 1}
                            onClick={() => setAuditPage((p) => Math.max(1, p - 1))}
                          >
                            <ChevronLeft className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={auditPage >= auditTotalPages}
                            onClick={() => setAuditPage((p) => Math.min(auditTotalPages, p + 1))}
                          >
                            <ChevronRight className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
};

export default AdminDataHistory;
