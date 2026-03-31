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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, ChevronLeft, ChevronRight, Archive, ScrollText, Filter, RotateCcw, ExternalLink } from 'lucide-react';

const PAGE_SIZE = 25;
const AUDIT_PAGE_SIZE = 40;

const EMPTY_AUDIT = {
  from: '',
  to: '',
  action: '',
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
    p_user_id: null,
    p_branch_id: null,
    p_user_role: null,
    p_action: o(applied.action),
    p_entity_type: null,
    p_entity_id: null,
    p_ip: null,
    p_location: null,
    p_device: null,
    p_metadata: null,
  };
}

const AdminDataHistory = () => {
  const [currency, setCurrency] = useState('TZS');
  const [branches, setBranches] = useState([]);

  const [deletedLoans, setDeletedLoans] = useState([]);
  const [deletedRepayments, setDeletedRepayments] = useState([]);
  const [loadingLoans, setLoadingLoans] = useState(true);
  const [loadingRepay, setLoadingRepay] = useState(true);

  const [loanBranch, setLoanBranch] = useState('all');
  const [loanSearch, setLoanSearch] = useState('');
  const [repayBranch, setRepayBranch] = useState('all');
  const [repaySearch, setRepaySearch] = useState('');

  const [auditRows, setAuditRows] = useState([]);
  const [auditTotal, setAuditTotal] = useState(0);
  const [auditUserMap, setAuditUserMap] = useState({});
  const [auditLoading, setAuditLoading] = useState(true);
  const [auditPage, setAuditPage] = useState(1);
  const [auditDraft, setAuditDraft] = useState(EMPTY_AUDIT);
  const [auditApplied, setAuditApplied] = useState(EMPTY_AUDIT);
  const [auditError, setAuditError] = useState(null);

  useEffect(() => {
    (async () => {
      const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
      if (config?.value) setCurrency(config.value);
      const { data: b } = await supabase.from('branches').select('id, name').order('name');
      setBranches(b || []);
    })();
  }, []);

  const fetchDeletedLoans = useCallback(async () => {
    setLoadingLoans(true);
    const { data, error } = await supabase
      .from('deleted_loan_records')
      .select('*')
      .order('deleted_at', { ascending: false });
    if (error) {
      console.error(error);
      setDeletedLoans([]);
    } else {
      setDeletedLoans(data || []);
    }
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
  }, [fetchDeletedLoans, fetchDeletedRepayments]);

  const filteredLoans = useMemo(() => {
    const q = loanSearch.trim().toLowerCase();
    return deletedLoans.filter((row) => {
      if (loanBranch !== 'all' && row.branch_id !== loanBranch) return false;
      if (!q) return true;
      const hay = `${row.loan_public_id || ''} ${row.borrower_name || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [deletedLoans, loanBranch, loanSearch]);

  const filteredRepay = useMemo(() => {
    const q = repaySearch.trim().toLowerCase();
    return deletedRepayments.filter((row) => {
      if (repayBranch !== 'all' && row.branch_id !== repayBranch) return false;
      if (!q) return true;
      const hay = `${row.loan_public_id || ''} ${row.borrower_name || ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [deletedRepayments, repayBranch, repaySearch]);

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

  const fmtMeta = (m) => {
    if (m == null) return '—';
    if (typeof m !== 'object') return '—';
    try {
      return JSON.stringify(m);
    } catch {
      return '—';
    }
  };

  return (
    <DashboardLayout title="Data history & activity">
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <Archive className="h-8 w-8 shrink-0 text-brand-blue" aria-hidden />
          <div>
            <p className="text-sm text-neutral-600 max-w-3xl">
              View archived deleted loans and repayments (after manager approval), and browse the activity log to see what
              happened—requests, approvals, deletions, and other recorded actions. Use filters on each tab.
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
            <TabsTrigger value="activity">Activity log</TabsTrigger>
          </TabsList>

          <TabsContent value="loans">
            <Card>
              <CardHeader>
                <CardTitle>Deleted loans (archive)</CardTitle>
                <CardDescription>Loans removed after the loan officer requested deletion and the branch manager approved.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-4">
                  <div className="space-y-2">
                    <Label>Branch</Label>
                    <Select value={loanBranch} onValueChange={setLoanBranch}>
                      <SelectTrigger className="w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All branches</SelectItem>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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
                <div className="flex flex-wrap gap-4">
                  <div className="space-y-2">
                    <Label>Branch</Label>
                    <Select value={repayBranch} onValueChange={setRepayBranch}>
                      <SelectTrigger className="w-[220px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All branches</SelectItem>
                        {branches.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {b.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
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

          <TabsContent value="activity">
            <Card>
              <CardHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <ScrollText className="h-5 w-5 text-muted-foreground" aria-hidden />
                  <CardTitle className="text-base">Activity log (preview)</CardTitle>
                </div>
                <CardDescription>
                  Each row shows when something happened, who did it, and the <strong>action</strong> (what was done). Use Apply, then change page.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {auditError && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                    {auditError}
                  </div>
                )}
                <div className="flex flex-wrap items-end gap-4">
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
                            <TableHead>Action (what happened)</TableHead>
                            <TableHead>Entity</TableHead>
                            <TableHead className="min-w-[180px]">Details</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {auditRows.length === 0 ? (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
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
                                <TableCell className="font-medium text-sm">{r.action || '—'}</TableCell>
                                <TableCell className="text-xs">
                                  {[r.entity_type, r.entity_id].filter(Boolean).join(' / ') || '—'}
                                </TableCell>
                                <TableCell className="text-xs font-mono max-w-[280px] truncate" title={fmtMeta(r.metadata)}>
                                  {fmtMeta(r.metadata)}
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
