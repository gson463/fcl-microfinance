import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format, startOfDay, endOfDay } from 'date-fns';
import { format as formatTZ, toZonedTime, formatInTimeZone } from 'date-fns-tz';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import {
  Calendar as CalendarIcon,
  Download,
  Loader2,
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  FileDown,
  BadgePercent,
  Landmark,
} from 'lucide-react';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { scheduledCollectionAmount, prepaymentAmount } from '@/lib/repaymentPrepayment';
import { buildOfficerCenterBlocks } from '@/lib/fieldWalletAggregates';
import { downloadFieldWalletExcel, fetchLogoBufferFromUrl } from '@/lib/fieldWalletReportExcel';
import { downloadFieldWalletPdf } from '@/lib/fieldWalletReportPdf';
import { resolveLogoUrl, DEFAULT_SYSTEM_NAME, DEFAULT_TAGLINE } from '@/lib/brand';

const EAT_TIMEZONE = 'Africa/Nairobi';

/** Default filter: current calendar date in Africa/Nairobi (single day). */
function getDefaultWalletDateRange() {
  const s = formatInTimeZone(new Date(), EAT_TIMEZONE, 'yyyy-MM-dd');
  const [y, m, d] = s.split('-').map(Number);
  const day = new Date(y, m - 1, d);
  return { from: startOfDay(day), to: endOfDay(day) };
}

const LOAN_SELECT = `id, loan_id, principal, disbursement_date, officer_id, borrower_id,
  borrowers(
    id, first_name, surname,
    groups(id, name, center_id, centers(id, name))
  )`;

/** Include wallet_split_source so scheduled vs prepayment matches Repayment Management (explicit officer split). */
const REP_SELECT = `id, amount, prepayment_amount, scheduled_due_snapshot, wallet_split_source, actual_payment_date, officer_id, loan_id,
  loans(
    loan_id,
    borrower_id,
    borrowers(
      id, first_name, surname,
      groups(id, name, center_id, centers(id, name))
    )
  )`;

const FieldWalletCashFlow = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const role = user?.user_metadata?.role;

  const [currency, setCurrency] = useState('TZS');
  const [applicationFee, setApplicationFee] = useState(0);
  const [systemName, setSystemName] = useState(DEFAULT_SYSTEM_NAME);
  const [tagline, setTagline] = useState(DEFAULT_TAGLINE);
  const [logoUrlConfig, setLogoUrlConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [managerBranchId, setManagerBranchId] = useState(null);
  const [managerBranchName, setManagerBranchName] = useState('');
  const [repayments, setRepayments] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [disbursements, setDisbursements] = useState([]);
  const [fieldTakenRows, setFieldTakenRows] = useState([]);
  const [withdrawRows, setWithdrawRows] = useState([]);
  const [withdrawSaving, setWithdrawSaving] = useState(false);
  const [centers, setCenters] = useState([]);
  const [officerRows, setOfficerRows] = useState([]);
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [range, setRange] = useState(() => getDefaultWalletDateRange());
  const [expandedDates, setExpandedDates] = useState(() => new Set());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id || role !== 'manager') {
        setProfileLoading(false);
        return;
      }
      setProfileLoading(true);
      const { data: row, error } = await supabase.from('users').select('branch_id, role').eq('id', user.id).maybeSingle();
      if (cancelled) return;
      if (error || !row || row.role !== 'manager') {
        setManagerBranchId(null);
        setManagerBranchName('');
        setProfileLoading(false);
        return;
      }
      setManagerBranchId(row.branch_id ?? null);
      if (row.branch_id) {
        const { data: br } = await supabase.from('branches').select('name').eq('id', row.branch_id).maybeSingle();
        if (!cancelled) setManagerBranchName(br?.name || '');
      } else {
        setManagerBranchName('');
      }
      setProfileLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, role]);

  const fetchData = useCallback(async () => {
    if (!user?.id || !role) return;
    if (role === 'manager' && profileLoading) return;
    if (role === 'manager' && !managerBranchId) {
      setRepayments([]);
      setExpenses([]);
      setDisbursements([]);
      setFieldTakenRows([]);
      setWithdrawRows([]);
      setCenters([]);
      setOfficerRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const { data: cfg } = await supabase
        .from('system_config')
        .select('key, value')
        .in('key', ['currency', 'applicationFeePerDisbursement', 'systemName', 'logoUrl', 'tagline']);
      const map = Object.fromEntries((cfg || []).map((r) => [r.key, r.value]));
      if (map.currency) setCurrency(map.currency);
      setApplicationFee(parseFloat(map.applicationFeePerDisbursement) || 0);
      setSystemName(map.systemName || DEFAULT_SYSTEM_NAME);
      setTagline(map.tagline && String(map.tagline).trim() ? map.tagline : DEFAULT_TAGLINE);
      setLogoUrlConfig(map.logoUrl ?? null);

      const fromStr = format(range.from, 'yyyy-MM-dd');
      const toStr = format(range.to, 'yyyy-MM-dd');

      let officerIdsFilter = null;

      if (role === 'officer') {
        officerIdsFilter = [user.id];
      } else if (role === 'manager' && managerBranchId) {
        const { data: offs } = await supabase.from('users').select('id').eq('branch_id', managerBranchId).eq('role', 'officer');
        officerIdsFilter = (offs || []).map((o) => o.id);
        if (officerIdsFilter.length === 0) officerIdsFilter = ['00000000-0000-0000-0000-000000000000'];
      }

      const repQ = supabase
        .from('repayments')
        .select(REP_SELECT)
        .gte('actual_payment_date', fromStr)
        .lte('actual_payment_date', toStr);
      const loanQ = supabase
        .from('loans')
        .select(LOAN_SELECT)
        .gte('disbursement_date', fromStr)
        .lte('disbursement_date', toStr);
      const expQ = supabase
        .from('expenses')
        .select('id, amount, expense_type, description, expense_date, officer_id')
        .gte('expense_date', fromStr)
        .lte('expense_date', toStr);

      const takenQ = supabase
        .from('officer_field_taken')
        .select('id, officer_id, business_date, amount_taken')
        .gte('business_date', fromStr)
        .lte('business_date', toStr);

      const withdrawQ = supabase
        .from('officer_withdraw_to_bank')
        .select('id, officer_id, business_date')
        .gte('business_date', fromStr)
        .lte('business_date', toStr);

      if (officerIdsFilter) {
        repQ.in('officer_id', officerIdsFilter);
        loanQ.in('officer_id', officerIdsFilter);
        expQ.in('officer_id', officerIdsFilter);
        takenQ.in('officer_id', officerIdsFilter);
        withdrawQ.in('officer_id', officerIdsFilter);
      }

      const [repRes, loanRes, expRes, takenRes, withdrawRes] = await Promise.all([
        repQ.order('actual_payment_date', { ascending: false }),
        loanQ.order('disbursement_date', { ascending: false }),
        expQ.order('expense_date', { ascending: false }),
        takenQ.order('business_date', { ascending: false }),
        withdrawQ.order('business_date', { ascending: false }),
      ]);

      if (repRes.error) throw repRes.error;
      if (loanRes.error) throw loanRes.error;
      if (expRes.error) throw expRes.error;
      if (takenRes.error) throw takenRes.error;
      if (withdrawRes.error) throw withdrawRes.error;

      const reps = repRes.data || [];
      const loans = loanRes.data || [];
      const exps = expRes.data || [];
      const taken = takenRes.data || [];
      const withdraws = withdrawRes.data || [];

      setRepayments(reps);
      setExpenses(exps);
      setDisbursements(loans);
      setFieldTakenRows(taken);
      setWithdrawRows(withdraws);

      const oid = new Set();
      reps.forEach((r) => r.officer_id && oid.add(r.officer_id));
      loans.forEach((l) => l.officer_id && oid.add(l.officer_id));
      exps.forEach((e) => e.officer_id && oid.add(e.officer_id));

      const ids = [...oid];
      let officers = [];
      if (ids.length > 0) {
        const { data: ou } = await supabase.from('users').select('id, full_name').in('id', ids).order('full_name');
        officers = ou || [];
      }
      if (role === 'officer' && officers.length === 0) {
        officers = [{ id: user.id, full_name: user.user_metadata?.full_name || 'Officer' }];
      }

      setOfficerRows(officers);

      let centersData = [];
      const centerOfficerIds = officers.map((o) => o.id);
      if (centerOfficerIds.length > 0) {
        const { data: c } = await supabase.from('centers').select('id, name, loan_officer_id').in('loan_officer_id', centerOfficerIds).order('name');
        centersData = c || [];
      }
      setCenters(centersData);
    } catch (e) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  }, [user, role, range.from, range.to, profileLoading, managerBranchId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    const onTaken = () => {
      fetchData();
    };
    window.addEventListener('officer-field-taken-updated', onTaken);
    return () => window.removeEventListener('officer-field-taken-updated', onTaken);
  }, [fetchData]);

  const branchLabel = useMemo(() => {
    if (role === 'admin') return 'Scope: All branches';
    if (role === 'manager') return managerBranchName ? `Branch: ${managerBranchName}` : 'Branch: —';
    return 'My officer wallet';
  }, [role, managerBranchName]);

  const pageTitle = useMemo(() => {
    if (role === 'admin') return 'Field wallet (all branches)';
    if (role === 'manager') return 'Field wallet (branch)';
    return 'Field wallet & cash flow';
  }, [role]);

  const reportBlocks = useMemo(
    () =>
      buildOfficerCenterBlocks({
        officers: officerRows,
        centers,
        repayments,
        loans: disbursements,
        expenses,
        applicationFeePerDisbursement: applicationFee,
        fieldTakenRows,
      }).blocks,
    [officerRows, centers, repayments, disbursements, expenses, applicationFee, fieldTakenRows]
  );

  const byDateRepayments = useMemo(() => {
    const map = new Map();
    for (const r of repayments) {
      const d = formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'yyyy-MM-dd');
      if (!map.has(d)) map.set(d, []);
      map.get(d).push(r);
    }
    return map;
  }, [repayments]);

  const dailySummary = useMemo(() => {
    const dates = [...byDateRepayments.keys()].sort((a, b) => b.localeCompare(a));
    return dates.map((dateKey) => {
      const rows = byDateRepayments.get(dateKey) || [];
      let sched = 0;
      let prep = 0;
      let total = 0;
      for (const r of rows) {
        total += Number(r.amount) || 0;
        sched += scheduledCollectionAmount(r);
        prep += prepaymentAmount(r);
      }
      return { dateKey, rows, scheduled: sched, prepayment: prep, total };
    });
  }, [byDateRepayments]);

  const totals = useMemo(() => {
    const inScheduled = repayments.reduce((s, r) => s + scheduledCollectionAmount(r), 0);
    const inPrepay = repayments.reduce((s, r) => s + prepaymentAmount(r), 0);
    const inTotal = repayments.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const disbCount = disbursements.length;
    const feePer = Number(applicationFee) || 0;
    const applicationFeeIn = disbCount * feePer;
    const totalTaken = fieldTakenRows.reduce((s, t) => s + (Number(t.amount_taken) || 0), 0);
    const cashInTotal = totalTaken + inTotal + applicationFeeIn;
    const outExp = expenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const outDisb = disbursements.reduce((s, l) => s + (Number(l.principal) || 0), 0);
    const prepaymentLineCount = repayments.reduce((n, r) => n + (prepaymentAmount(r) > 0.01 ? 1 : 0), 0);
    return {
      inScheduled,
      inPrepay,
      inTotal,
      totalTaken,
      applicationFeeIn,
      disbCount,
      feePer,
      cashInTotal,
      prepaymentLineCount,
      outExp,
      outDisb,
      outTotal: outExp + outDisb,
      net: cashInTotal - outExp - outDisb,
    };
  }, [repayments, expenses, disbursements, applicationFee, fieldTakenRows]);

  const walletDateFromStr = useMemo(() => format(range.from, 'yyyy-MM-dd'), [range.from]);
  const walletDateToStr = useMemo(() => format(range.to, 'yyyy-MM-dd'), [range.to]);
  const isSingleWalletDay = walletDateFromStr === walletDateToStr;

  const officerWithdrawForDay = useMemo(() => {
    if (role !== 'officer' || !user?.id || !isSingleWalletDay) return false;
    return withdrawRows.some((w) => w.officer_id === user.id && w.business_date === walletDateFromStr);
  }, [role, user?.id, isSingleWalletDay, walletDateFromStr, withdrawRows]);

  /** After withdraw-to-bank, UI shows 0; Excel/PDF still use computed DEPOSIT. */
  const displayNet = useMemo(() => {
    if (role === 'officer' && officerWithdrawForDay) return 0;
    return totals.net;
  }, [role, officerWithdrawForDay, totals.net]);

  const handleWithdrawToBank = useCallback(async () => {
    if (role !== 'officer' || !user?.id || !isSingleWalletDay || officerWithdrawForDay) return;
    if (totals.net <= 0) {
      toast({
        title: 'Nothing to withdraw',
        description: 'Wallet balance is not positive.',
        variant: 'destructive',
      });
      return;
    }
    setWithdrawSaving(true);
    try {
      const { error } = await supabase.from('officer_withdraw_to_bank').insert({
        officer_id: user.id,
        business_date: walletDateFromStr,
      });
      if (error) throw error;
      toast({ title: 'Recorded', description: 'Marked as withdrawn to bank. Balance shows 0; Excel still shows DEPOSIT for today.' });
      await fetchData();
    } catch (e) {
      const msg = e?.message || String(e);
      toast({
        title: 'Save failed',
        description: msg.includes('duplicate') || msg.includes('unique') ? 'Withdraw was already recorded for this day.' : msg,
        variant: 'destructive',
      });
    } finally {
      setWithdrawSaving(false);
    }
  }, [role, user?.id, isSingleWalletDay, officerWithdrawForDay, totals.net, walletDateFromStr, toast, fetchData]);

  const toggleDate = (dateKey) => {
    setExpandedDates((prev) => {
      const next = new Set(prev);
      if (next.has(dateKey)) next.delete(dateKey);
      else next.add(dateKey);
      return next;
    });
  };

  const exportWalletCsv = () => {
    const rows = repayments.map((r) => ({
      date: formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'yyyy-MM-dd'),
      loan_id: r.loans?.loan_id ?? '',
      borrower: `${r.loans?.borrowers?.first_name ?? ''} ${r.loans?.borrowers?.surname ?? ''}`.trim(),
      scheduled: scheduledCollectionAmount(r),
      prepayment: prepaymentAmount(r),
      total: r.amount,
    }));
    exportObjectsToCsv(`wallet_repayments_${Date.now()}.csv`, [
      { header: 'Date', accessor: 'date' },
      { header: 'Loan ID', accessor: 'loan_id' },
      { header: 'Borrower', accessor: 'borrower' },
      { header: 'Scheduled collection', accessor: (x) => String(x.scheduled) },
      { header: 'Prepayment', accessor: (x) => String(x.prepayment) },
      { header: 'Total', accessor: (x) => String(x.total) },
    ], rows);
    toast({ title: 'Exported', description: `${rows.length} repayment line(s).` });
  };

  const handleExportExcel = async () => {
    setExportingExcel(true);
    try {
      const path = resolveLogoUrl(logoUrlConfig);
      const logoUrl =
        path.startsWith('http') ? path : `${window.location.origin}${path.startsWith('/') ? '' : '/'}${path}`;
      let logoBuffer = null;
      let logoExtension = 'png';
      const fetched = await fetchLogoBufferFromUrl(logoUrl);
      if (fetched) {
        logoBuffer = fetched.buffer;
        logoExtension = fetched.extension;
      }

      await downloadFieldWalletExcel({
        systemName,
        branchLabel,
        dateRangeLabel: `Period: ${format(range.from, 'PPP')} – ${format(range.to, 'PPP')}`,
        logoBuffer,
        logoExtension,
        currency,
        blocks: reportBlocks,
      });
      toast({ title: 'Exported', description: 'Excel report downloaded.' });
    } catch (e) {
      toast({ title: 'Export failed', description: e.message, variant: 'destructive' });
    } finally {
      setExportingExcel(false);
    }
  };

  const handleExportPdf = async () => {
    setExportingPdf(true);
    try {
      await downloadFieldWalletPdf({
        systemName,
        tagline,
        logoUrl: logoUrlConfig,
        branchLabel,
        dateRangeLabel: `Period: ${format(range.from, 'PPP')} – ${format(range.to, 'PPP')}`,
        currency,
        blocks: reportBlocks,
      });
      toast({ title: 'Exported', description: 'PDF report downloaded.' });
    } catch (e) {
      toast({ title: 'PDF export failed', description: e.message, variant: 'destructive' });
    } finally {
      setExportingPdf(false);
    }
  };

  if (role === 'manager' && !profileLoading && !managerBranchId) {
    return (
      <DashboardLayout title={pageTitle}>
        <p className="text-sm text-muted-foreground">
          Your manager account has no branch assigned. Ask an admin to set your branch, then sign out and sign in again.
        </p>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout title={pageTitle}>
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-xl space-y-1">
            <p className="text-sm font-medium text-foreground">{branchLabel}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="min-w-[260px] justify-start font-normal">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {range.from && range.to
                    ? `${format(range.from, 'LLL d, y')} – ${format(range.to, 'LLL d, y')}`
                    : 'Date range'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="range"
                  numberOfMonths={2}
                  selected={{ from: range.from, to: range.to }}
                  onSelect={(rng) => {
                    if (rng?.from) setRange({ from: startOfDay(rng.from), to: endOfDay(rng.to ?? rng.from) });
                  }}
                />
              </PopoverContent>
            </Popover>
            <Button type="button" variant="outline" onClick={exportWalletCsv} disabled={repayments.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              CSV (repayments)
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={handleExportExcel}
              disabled={exportingExcel || exportingPdf || reportBlocks.length === 0}
            >
              {exportingExcel ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileSpreadsheet className="mr-2 h-4 w-4" />}
              Excel (officer × centre)
            </Button>
            <Button
              type="button"
              variant="secondary"
              onClick={handleExportPdf}
              disabled={exportingExcel || exportingPdf || reportBlocks.length === 0}
            >
              {exportingPdf ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileDown className="mr-2 h-4 w-4" />}
              PDF
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {role === 'officer' && (
              <Card className="border-l-4 border-l-brand-gold bg-brand-gold/[0.04] dark:bg-brand-gold/[0.06]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Wallet balance</CardTitle>
                  <CardDescription className="text-xs">
                    {isSingleWalletDay
                      ? 'Single day view. After withdraw to bank, balance shows 0; Excel export still shows DEPOSIT for this day.'
                      : 'Select a single day to withdraw to bank.'}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-3xl font-bold tabular-nums tracking-tight">
                    {currency}{' '}
                    {displayNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  {officerWithdrawForDay && (
                    <p className="text-sm font-medium text-muted-foreground">Withdrawn to bank — cash no longer in hand.</p>
                  )}
                  {isSingleWalletDay && !officerWithdrawForDay && totals.net > 0 && (
                    <Button
                      type="button"
                      variant="default"
                      className="w-full sm:w-auto"
                      onClick={handleWithdrawToBank}
                      disabled={withdrawSaving}
                    >
                      {withdrawSaving ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Landmark className="mr-2 h-4 w-4" />
                      )}
                      {withdrawSaving ? 'Saving…' : 'Withdraw to bank'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}

            {role === 'manager' && reportBlocks.length > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Wallet balance</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Officer</TableHead>
                        <TableHead className="text-right">Balance</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reportBlocks.map((block) => {
                        const bal = Number(block.totals.deposit);
                        return (
                          <TableRow key={block.officer.id}>
                            <TableCell>{block.officer.full_name || '—'}</TableCell>
                            <TableCell className="text-right font-medium tabular-nums">
                              {currency}{' '}
                              {(Number.isNaN(bal) ? 0 : bal).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 2,
                              })}
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              <Card className="border-amber-200/80 dark:border-amber-900/50">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Taken (float)</CardTitle>
                  <Wallet className="h-4 w-4 text-amber-600" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-amber-900 dark:text-amber-200">
                    {currency} {totals.totalTaken.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">Sum of daily taken in this date range (from login gate + edits).</p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Cash in — scheduled</CardTitle>
                  <ArrowDownLeft className="h-4 w-4 text-cyan-600" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">
                    {currency} {totals.inScheduled.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </CardContent>
              </Card>
              <Card className="border-emerald-200/80 dark:border-emerald-900/50">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <div>
                    <CardTitle className="text-sm font-medium">Prepayment total</CardTitle>
                    <CardDescription className="text-xs font-normal text-muted-foreground">
                      Sum of prepayment in this period
                    </CardDescription>
                  </div>
                  <Wallet className="h-4 w-4 text-emerald-600" />
                </CardHeader>
                <CardContent>
                  <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800/90 dark:text-emerald-300/90">
                    Total
                  </p>
                  <p className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
                    {currency}{' '}
                    {totals.inPrepay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-2">
                    {totals.prepaymentLineCount} repayment line{totals.prepaymentLineCount === 1 ? '' : 's'} with prepayment {'>'} 0
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 border-t border-emerald-100 dark:border-emerald-900/40 pt-2">
                    Portion above scheduled due on each payment date (stored prepayment, or derived from due snapshot).
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Application fee (field)</CardTitle>
                  <BadgePercent className="h-4 w-4 text-violet-600" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold text-violet-700 dark:text-violet-400">
                    {currency}{' '}
                    {totals.applicationFeeIn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {totals.disbCount} disbursement{totals.disbCount === 1 ? '' : 's'} × {currency} {totals.feePer.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                    each
                  </p>
                </CardContent>
              </Card>
              <Card className="border-dashed">
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Total cash in</CardTitle>
                  <Wallet className="h-4 w-4 text-foreground/70" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">
                    {currency} {totals.cashInTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Taken {currency} {totals.totalTaken.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} + scheduled {currency}{' '}
                    {totals.inScheduled.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} + prepayment{' '}
                    {currency} {totals.inPrepay.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} = repayments{' '}
                    {currency} {totals.inTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}; + application fee{' '}
                    {currency} {totals.applicationFeeIn.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Cash out</CardTitle>
                  <ArrowUpRight className="h-4 w-4 text-orange-600" />
                </CardHeader>
                <CardContent>
                  <p className="text-2xl font-bold">
                    {currency} {totals.outTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Expenses {currency} {totals.outExp.toLocaleString()} · Disbursements {currency} {totals.outDisb.toLocaleString()}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="flex flex-row items-center justify-between pb-2">
                  <CardTitle className="text-sm font-medium">Net (cash in − out)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className={`text-2xl font-bold ${displayNet >= 0 ? '' : 'text-destructive'}`}>
                    {currency}{' '}
                    {displayNet.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  {role === 'officer' && officerWithdrawForDay && (
                    <p className="text-xs text-muted-foreground mt-1">Shown as 0 after withdraw; export uses full figures.</p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Wallet history — by day</CardTitle>
                <CardDescription>Tap a date to expand repayment lines (scheduled vs prepayment).</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10" />
                      <TableHead>Date</TableHead>
                      <TableHead>Lines</TableHead>
                      <TableHead>Scheduled</TableHead>
                      <TableHead>Prepayment</TableHead>
                      <TableHead>Total in</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dailySummary.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                          No repayments in this range.
                        </TableCell>
                      </TableRow>
                    ) : (
                      dailySummary.map(({ dateKey, rows, scheduled, prepayment, total }) => {
                        const open = expandedDates.has(dateKey);
                        return (
                          <React.Fragment key={dateKey}>
                            <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => toggleDate(dateKey)}>
                              <TableCell>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleDate(dateKey);
                                  }}
                                >
                                  {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                </Button>
                              </TableCell>
                              <TableCell className="font-medium">
                                {formatTZ(toZonedTime(new Date(`${dateKey}T12:00:00`), EAT_TIMEZONE), 'PPP')}
                              </TableCell>
                              <TableCell>{rows.length}</TableCell>
                              <TableCell>
                                {currency}{' '}
                                {scheduled.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="text-emerald-700 dark:text-emerald-400 font-medium">
                                {currency}{' '}
                                {prepayment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </TableCell>
                              <TableCell className="font-semibold">
                                {currency}{' '}
                                {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                              </TableCell>
                            </TableRow>
                            {open && (
                              <TableRow>
                                <TableCell colSpan={6} className="bg-muted/30 p-0">
                                  <div className="p-4 border-t">
                                    <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">Repayment detail</p>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead>Borrower</TableHead>
                                          <TableHead>Loan</TableHead>
                                          <TableHead>Scheduled</TableHead>
                                          <TableHead>Prepayment</TableHead>
                                          <TableHead>Total</TableHead>
                                          <TableHead className="text-right">Due snapshot</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {rows.map((r) => (
                                          <TableRow key={r.id}>
                                            <TableCell>
                                              {r.loans?.borrowers?.first_name} {r.loans?.borrowers?.surname}
                                            </TableCell>
                                            <TableCell className="font-mono text-sm">{r.loans?.loan_id}</TableCell>
                                            <TableCell>
                                              {currency}{' '}
                                              {scheduledCollectionAmount(r).toLocaleString(undefined, {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                              })}
                                            </TableCell>
                                            <TableCell className="font-medium text-emerald-700 dark:text-emerald-400">
                                              {currency}{' '}
                                              {prepaymentAmount(r).toLocaleString(undefined, {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                              })}
                                            </TableCell>
                                            <TableCell className="font-semibold">
                                              {currency}{' '}
                                              {Number(r.amount).toLocaleString(undefined, {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                              })}
                                            </TableCell>
                                            <TableCell className="text-right text-muted-foreground text-sm">
                                              {r.scheduled_due_snapshot != null
                                                ? `${currency} ${Number(r.scheduled_due_snapshot).toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                  })}`
                                                : '—'}
                                            </TableCell>
                                          </TableRow>
                                        ))}
                                      </TableBody>
                                    </Table>
                                  </div>
                                </TableCell>
                              </TableRow>
                            )}
                          </React.Fragment>
                        );
                      })
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cash out — expenses</CardTitle>
                  <CardDescription>Expenses in range (scoped).</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead className="text-right">Amount</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {expenses.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-muted-foreground text-center py-6">
                            No expenses in range.
                          </TableCell>
                        </TableRow>
                      ) : (
                        expenses.map((e) => (
                          <TableRow key={e.id}>
                            <TableCell>{e.expense_date}</TableCell>
                            <TableCell className="capitalize">{e.expense_type}</TableCell>
                            <TableCell className="text-right">
                              {currency}{' '}
                              {Number(e.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Cash out — disbursements</CardTitle>
                  <CardDescription>Principal disbursed in range (scoped).</CardDescription>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Date</TableHead>
                        <TableHead>Loan</TableHead>
                        <TableHead className="text-right">Principal</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {disbursements.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="text-muted-foreground text-center py-6">
                            No disbursements in range.
                          </TableCell>
                        </TableRow>
                      ) : (
                        disbursements.map((l) => (
                          <TableRow key={l.id}>
                            <TableCell>{l.disbursement_date}</TableCell>
                            <TableCell>
                              <span className="font-mono text-sm">{l.loan_id}</span>
                              <span className="text-muted-foreground text-xs block">
                                {l.borrowers?.first_name} {l.borrowers?.surname}
                              </span>
                            </TableCell>
                            <TableCell className="text-right font-medium">
                              {currency}{' '}
                              {Number(l.principal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </TableCell>
                          </TableRow>
                        ))
                      )}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </div>
          </>
        )}
      </div>
    </DashboardLayout>
  );
};

export default FieldWalletCashFlow;
