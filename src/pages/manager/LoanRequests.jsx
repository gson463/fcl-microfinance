import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkDataTableToolbar } from '@/components/ui/bulk-data-table-toolbar';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useToast } from '@/components/ui/use-toast';
import { CheckCircle, FileQuestion, XCircle, ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { generateSchedule } from '@/utils/loanUtils';
import { recalculateLoanScheduleWithRetry } from '@/lib/loanScheduleRegeneration';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import { parseISO } from 'date-fns';
import { useUserProfileScope, fetchOfficerIdsForBranch } from '@/hooks/useUserProfileScope';
import { borrowerPublicId, borrowerPublicIdOrDash } from '@/lib/borrowerPublicId';
import { cn } from '@/lib/utils';

const EAT_TIMEZONE = 'Africa/Nairobi';
const PAGE_SIZE = 25;
const HISTORY_PAGE_SIZE = 15;

/** Parse a calendar date from edit_request (YYYY-MM-DD or Date) into an EAT-local Date for pickers. */
function ymdToEATDate(ymd) {
  if (!ymd) return null;
  if (ymd instanceof Date) {
    return Number.isNaN(ymd.getTime()) ? null : toZonedTime(ymd, EAT_TIMEZONE);
  }
  const s = String(ymd).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return toZonedTime(parseISO(s), EAT_TIMEZONE);
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : toZonedTime(d, EAT_TIMEZONE);
}

function ManagerApproveLoanEditDialog({ loan, open, onOpenChange, holidays, onApprove }) {
  const [disbursementDate, setDisbursementDate] = useState(null);
  const [repaymentStartDate, setRepaymentStartDate] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !loan?.edit_request) return;
    const er = loan.edit_request;
    setDisbursementDate(ymdToEATDate(er.disbursementDate));
    setRepaymentStartDate(ymdToEATDate(er.repaymentStartDate));
  }, [open, loan?.id, loan?.edit_request]);

  const managerApproveDisabledDays = useMemo(() => {
    const holidayDates = (holidays || []).map((h) => {
      const date = new Date(h.date);
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    });
    return holidayDates;
  }, [holidays]);

  const handleConfirm = async () => {
    if (!disbursementDate || !repaymentStartDate) return;
    setSubmitting(true);
    try {
      const ok = await onApprove(loan, { disbursementDate, repaymentStartDate });
      if (ok) onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Approve loan edit</DialogTitle>
          <DialogDescription>
            Confirm principal and product from the officer request. You can set disbursement and repayment-start dates here
            (e.g. use today if the request waited and the officer&apos;s dates are no longer valid).
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <Label>Disbursement date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn('w-full justify-start text-left font-normal', !disbursementDate && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {disbursementDate
                    ? formatTZ(disbursementDate, 'PPP', { timeZone: EAT_TIMEZONE })
                    : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={disbursementDate}
                  onSelect={(d) => setDisbursementDate(d)}
                  disabled={managerApproveDisabledDays}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="space-y-2">
            <Label>Repayment start date</Label>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  className={cn('w-full justify-start text-left font-normal', !repaymentStartDate && 'text-muted-foreground')}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {repaymentStartDate
                    ? formatTZ(repaymentStartDate, 'PPP', { timeZone: EAT_TIMEZONE })
                    : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={repaymentStartDate}
                  onSelect={(d) => setRepaymentStartDate(d)}
                  disabled={managerApproveDisabledDays}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={submitting || !disbursementDate || !repaymentStartDate} onClick={handleConfirm}>
            {submitting ? 'Applying…' : 'Approve & apply'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const LoanRequests = () => {
  const { user } = useAuth();
  const { toast } = useToast();
  const { loading: profileLoading, branchId: managerBranchId } = useUserProfileScope(user?.id);
  const [requests, setRequests] = useState([]);
  const [loanProducts, setLoanProducts] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [currency, setCurrency] = useState('TZS');
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [attendanceExceptions, setAttendanceExceptions] = useState([]);
  const [loanIncreaseHistory, setLoanIncreaseHistory] = useState([]);
  const [historyPage, setHistoryPage] = useState(1);
  const [resolvingId, setResolvingId] = useState(null);
  const [editApproveLoan, setEditApproveLoan] = useState(null);

  const fetchData = useCallback(async () => {
    if (!user || profileLoading) return;
    setLoading(true);

    const branchScope = managerBranchId ?? user.user_metadata?.branch_id;
    let officerIds = null;
    if (branchScope) {
      try {
        officerIds = await fetchOfficerIdsForBranch(branchScope);
      } catch (e) {
        toast({ title: 'Error', description: e?.message ?? 'Could not load branch officers.', variant: 'destructive' });
        setLoading(false);
        return;
      }
    }

    const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
    if (config) setCurrency(config.value);

    const { data: productsData, error: productsError } = await supabase.from('loan_products').select('*');
    if (productsError) {
      toast({ title: "Error", description: productsError.message, variant: "destructive" });
    } else {
      setLoanProducts(productsData || []);
    }
    
    const { data: holidaysData, error: holidaysError } = await supabase.from('holidays').select('*');
    if (holidaysError) {
        toast({ title: 'Error fetching holidays', description: holidaysError.message, variant: 'destructive' });
    } else {
        setHolidays(holidaysData || []);
    }

    if (!branchScope || !officerIds || officerIds.length === 0) {
      setRequests([]);
      setAttendanceExceptions([]);
      setLoanIncreaseHistory([]);
      setLoading(false);
      return;
    }

    const { data: requestsData, error: requestsError } = await supabase
      .from('loans')
      .select(`*, borrowers(first_name, surname), officer:users!officer_id(full_name)`)
      .in('status', ['delete_requested', 'edit_requested'])
      .in('officer_id', officerIds);

    if (requestsError) {
      toast({ title: "Error", description: requestsError.message, variant: "destructive" });
    } else {
      setRequests(requestsData || []);
    }

    const { data: excData, error: excError } = await supabase
      .from('loan_increase_exception_requests')
      .select(
        `id, officer_notes, created_at, borrowers(first_name, surname, borrower_id), officer:users!officer_id(full_name)`
      )
      .eq('status', 'pending')
      .in('officer_id', officerIds)
      .order('created_at', { ascending: false });
    if (excError) {
      console.error(excError);
      setAttendanceExceptions([]);
    } else {
      setAttendanceExceptions(excData || []);
    }

    const { data: histData, error: histError } = await supabase
      .from('loan_increase_exception_requests')
      .select(
        `id, status, officer_notes, manager_notes, created_at, resolved_at, approved_at, consumed_at, consumed_at_loan_id,
         borrowers(first_name, surname, borrower_id),
         officer:users!officer_id(full_name),
         manager:users!manager_id(full_name)`
      )
      .in('officer_id', officerIds)
      .order('created_at', { ascending: false })
      .limit(200);
    if (histError) {
      console.error(histError);
      setLoanIncreaseHistory([]);
    } else {
      setLoanIncreaseHistory(histData || []);
    }

    setLoading(false);
  }, [user, toast, profileLoading, managerBranchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(1);
  }, [requests.length]);

  useEffect(() => {
    setHistoryPage(1);
  }, [loanIncreaseHistory.length]);

  const pagedHistory = useMemo(() => {
    const start = (historyPage - 1) * HISTORY_PAGE_SIZE;
    return loanIncreaseHistory.slice(start, start + HISTORY_PAGE_SIZE);
  }, [loanIncreaseHistory, historyPage]);

  const historyTotalPages = Math.max(1, Math.ceil(loanIncreaseHistory.length / HISTORY_PAGE_SIZE));

  const exportLoanIncreaseHistoryCsv = () => {
    if (loanIncreaseHistory.length === 0) {
      toast({ title: 'Nothing to export', description: 'No history rows loaded.', variant: 'destructive' });
      return;
    }
    exportObjectsToCsv(`loan_increase_approval_history_${Date.now()}.csv`, [
      { header: 'Status', accessor: 'status' },
      { header: 'Borrower', accessor: (r) => `${r.borrowers?.first_name || ''} ${r.borrowers?.surname || ''}`.trim() },
      { header: 'Borrower ID', accessor: (r) => r.borrowers?.borrower_id || '' },
      { header: 'Officer', accessor: (r) => r.officer?.full_name || '' },
      { header: 'Officer notes', accessor: (r) => String(r.officer_notes ?? '') },
      { header: 'Submitted', accessor: (r) => (r.created_at ? new Date(r.created_at).toISOString() : '') },
      { header: 'Manager', accessor: (r) => r.manager?.full_name || '' },
      { header: 'Manager notes', accessor: (r) => String(r.manager_notes ?? '') },
      { header: 'Resolved', accessor: (r) => (r.resolved_at ? new Date(r.resolved_at).toISOString() : '') },
      { header: 'Consumed at', accessor: (r) => (r.consumed_at ? new Date(r.consumed_at).toISOString() : '') },
      { header: 'Loan id (consumed)', accessor: (r) => String(r.consumed_at_loan_id ?? '') },
    ], loanIncreaseHistory);
    toast({ title: 'Exported', description: `${loanIncreaseHistory.length} row(s) to CSV.` });
  };

  const pagedRequests = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return requests.slice(start, start + PAGE_SIZE);
  }, [requests, page]);

  const totalPages = Math.max(1, Math.ceil(requests.length / PAGE_SIZE));

  const requestIds = useMemo(() => requests.map((l) => l.id), [requests]);
  const bulk = useBulkSelection(requestIds);

  const exportRequestsCsv = () => {
    const rows = requests.filter((l) => bulk.isSelected(l.id));
    if (rows.length === 0) {
      toast({ title: 'Nothing selected', description: 'Select one or more rows first.', variant: 'destructive' });
      return;
    }
    exportObjectsToCsv(`loan_requests_${Date.now()}.csv`, [
      { header: 'Loan ID', accessor: 'loan_id' },
      { header: 'Borrower', accessor: (r) => `${r.borrowers?.first_name || ''} ${r.borrowers?.surname || ''}`.trim() },
      { header: 'Officer', accessor: (r) => r.officer?.full_name || '' },
      { header: 'Request type', accessor: 'status' },
      { header: 'Principal', accessor: (r) => String(r.principal ?? '') },
    ], rows);
    toast({ title: 'Exported', description: `${rows.length} row(s) to CSV.` });
  };

  const handleApproveDeletion = async (loan) => {
    const loanId = loan.id;
    const borrowerName = loan.borrowers
      ? `${loan.borrowers.first_name} ${loan.borrowers.surname}`.trim()
      : '';
    const officerName = loan.officer?.full_name ?? null;
    const branchId = managerBranchId ?? user?.user_metadata?.branch_id ?? null;
    try {
      const snapshot = { ...loan };
      const { error: insErr } = await supabase.from('deleted_loan_records').insert({
        original_loan_id: loanId,
        loan_public_id: loan.loan_id,
        borrower_id: loan.borrower_id,
        borrower_name: borrowerName || null,
        principal: loan.principal,
        officer_id: loan.officer_id,
        officer_name: officerName,
        branch_id: branchId,
        requested_by_officer_id: loan.officer_id,
        approved_by_manager_id: user.id,
        snapshot,
      });
      if (insErr) throw insErr;

      await supabase.rpc('log_audit_event', {
        p_action: 'loan.delete.finalized',
        p_entity_type: 'loan',
        p_entity_id: String(loan.loan_id),
        p_metadata: {
          original_loan_id: loanId,
          borrower_name: borrowerName,
        },
      });

      const { error: delRepErr } = await supabase.from('repayments').delete().eq('loan_id', loanId);
      if (delRepErr) throw delRepErr;

      const { error: delErr } = await supabase.from('loans').delete().eq('id', loanId);
      if (delErr) throw delErr;

      toast({ title: 'Success', description: 'Loan deleted permanently (final approval).' });
      fetchData();
    } catch (e) {
      toast({
        title: 'Error',
        description: e?.message || 'Could not finalize loan deletion.',
        variant: 'destructive',
      });
    }
  };

  const handleApproveEdit = async (loan, dateOverrides) => {
    const { edit_request } = loan;
    const product = loanProducts.find(p => p.id === edit_request.productId);
    
    if (!product) {
        toast({ title: 'Error', description: 'Loan product for the edit not found.', variant: 'destructive' });
        return false;
    }

    const principal = parseFloat(edit_request.principal);
    const interest = principal * (parseFloat(product.interest_rate) / 100);
    const totalPayable = principal + interest;
    
    // Recalculate balance based on what was paid
    const paidAmount = loan.total_payable - loan.balance;
    const newBalance = Math.max(0, totalPayable - paidAmount);
    
    // Recalculate outstanding interest
    const originalInterest = loan.total_payable - loan.principal;
    const paidTowardsOriginalPrincipal = Math.max(0, paidAmount - originalInterest);
    const paidTowardsOriginalInterest = paidAmount - paidTowardsOriginalPrincipal;
    const newOutstandingInterest = Math.max(0, interest - paidTowardsOriginalInterest);

    const disbursementSource = dateOverrides?.disbursementDate ?? edit_request.disbursementDate;
    const repaymentSource = dateOverrides?.repaymentStartDate ?? edit_request.repaymentStartDate;

    const formattedRepaymentStartDate = formatTZ(toZonedTime(repaymentSource, EAT_TIMEZONE), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });

    const updatedLoan = {
      product_id: edit_request.productId,
      disbursement_date: formatTZ(toZonedTime(disbursementSource, EAT_TIMEZONE), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
      repayment_start_date: formattedRepaymentStartDate,
      principal: principal,
      interest_rate: product.interest_rate,
      repayment_frequency: product.repayment_frequency,
      period: product.loan_period,
      period_unit: product.loan_period_unit,
      total_payable: totalPayable,
      balance: newBalance,
      outstanding_interest: newOutstandingInterest,
      status: 'active',
      schedule: generateSchedule(
        principal,
        product.interest_rate,
        totalPayable,
        product.loan_period,
        product.loan_period_unit,
        product.repayment_frequency,
        formattedRepaymentStartDate,
        holidays
      ),
      edit_request: null,
    };

    if (!Array.isArray(updatedLoan.schedule) || updatedLoan.schedule.length === 0) {
      toast({
        title: 'Cannot approve edit',
        description: 'Generated repayment schedule is empty. Check loan period, frequency, and repayment start date.',
        variant: 'destructive',
      });
      return false;
    }

    const { error } = await supabase.from('loans').update(updatedLoan).eq('id', loan.id);
    if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return false;
    }

    const { error: recalcErr } = await recalculateLoanScheduleWithRetry(supabase, loan.id);
    if (recalcErr) {
      toast({
        title: 'Loan updated — allocation incomplete',
        description: `Repayment totals were not applied to installments (${recalcErr.message}). Open this loan in Loan Management and use Recalculate, or record a small repayment to refresh.`,
        variant: 'default',
      });
      fetchData();
      return true;
    }

    fetchData();
    toast({ title: 'Success', description: 'Loan edit approved and updated.' });
    return true;
  };

  const handleResolveAttendanceException = async (requestId, approve) => {
    setResolvingId(requestId);
    try {
      const { data, error } = await supabase.rpc('resolve_loan_increase_exception_request', {
        p_request_id: requestId,
        p_approve: approve,
        p_manager_notes: null,
      });
      if (error) {
        toast({ title: 'Error', description: error.message, variant: 'destructive' });
        return;
      }
      if (data && data.error) {
        toast({ title: 'Error', description: String(data.error), variant: 'destructive' });
        return;
      }
      toast({
        title: approve ? 'Approved' : 'Rejected',
        description: approve
          ? 'The officer may disburse a new loan for this borrower (approval valid 90 days until used on disburse).'
          : 'The loan increase approval request was rejected.',
      });
      fetchData();
    } finally {
      setResolvingId(null);
    }
  };

  const handleRejectRequest = async (loan) => {
    const loanId = loan.id;
    const { error } = await supabase.from('loans').update({ status: 'active', edit_request: null }).eq('id', loanId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      if (loan.status === 'delete_requested') {
        await supabase.rpc('log_audit_event', {
          p_action: 'loan.delete.rejected',
          p_entity_type: 'loan',
          p_entity_id: String(loan.loan_id),
          p_metadata: { original_loan_id: loanId },
        });
      }
      fetchData();
      toast({ title: 'Rejected', description: 'The request has been rejected.' });
    }
  };

  const renderRequestDetails = (loan) => {
    if (loan.status === 'edit_requested' && loan.edit_request) {
      const { edit_request } = loan;
      const newProduct = loanProducts.find(p => p.id === edit_request.productId);
      return (
        <div className="text-xs text-gray-500 space-y-1 mt-1">
          <p><strong>New Principal:</strong> {currency} {Number(edit_request.principal).toLocaleString()}</p>
          <p><strong>New Product:</strong> {newProduct?.name}</p>
          <p><strong>New Disbursement:</strong> {edit_request.disbursementDate}</p>
          <p><strong>New Repayment Start:</strong> {edit_request.repaymentStartDate}</p>
        </div>
      );
    }
    return null;
  };
  
  const pendingEditDelete = requests.length;
  const pendingIncreases = attendanceExceptions.length;
  const pendingTotal = pendingEditDelete + pendingIncreases;

  if (loading) return <DashboardLayout title="Requests"><div className="flex items-center justify-center h-full">Loading requests…</div></DashboardLayout>;

  return (
    <DashboardLayout title="Requests">
      <div className="space-y-6">
        <div className="flex items-start gap-4">
          <FileQuestion className="h-8 w-8 shrink-0 text-brand-blue" aria-hidden />
          <p className="text-sm text-neutral-500">
            One place for every officer request: loan edits, deletions, and loan increase approvals. Use <strong>Pending</strong>{' '}
            to act; <strong>History</strong> shows past loan increase decisions (export CSV from History).
          </p>
        </div>

        <Tabs defaultValue="pending" className="w-full">
          <TabsList className="flex w-full flex-wrap justify-start gap-1 sm:w-auto">
            <TabsTrigger value="pending">
              Pending
              {pendingTotal > 0 ? (
                <Badge variant="secondary" className="ml-2 tabular-nums">
                  {pendingTotal}
                </Badge>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="history">
              History
              {loanIncreaseHistory.length > 0 ? (
                <Badge variant="outline" className="ml-2 tabular-nums">
                  {loanIncreaseHistory.length}
                </Badge>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="space-y-6 mt-4">
            <div className="flex flex-wrap gap-3 text-sm text-neutral-600">
              <span>
                <strong className="text-foreground">{pendingEditDelete}</strong> loan edit / delete
              </span>
              <span className="text-neutral-400">·</span>
              <span>
                <strong className="text-foreground">{pendingIncreases}</strong> loan increase approval
              </span>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Loan edit &amp; deletion</CardTitle>
                <CardDescription>Loans your officers asked to modify or remove.</CardDescription>
              </CardHeader>
              <CardContent>
                <BulkDataTableToolbar selectedCount={bulk.count} onClear={bulk.clear} onExportCsv={exportRequestsCsv} />
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox
                          checked={bulk.allSelected ? true : bulk.count > 0 ? 'indeterminate' : false}
                          onCheckedChange={() => bulk.toggleAll()}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead>Loan ID</TableHead>
                      <TableHead>Borrower</TableHead>
                      <TableHead>Loan Officer</TableHead>
                      <TableHead>Request Type</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {requests.length > 0 ? pagedRequests.map(loan => (
                      <TableRow key={loan.id}>
                        <TableCell>
                          <Checkbox
                            checked={bulk.isSelected(loan.id)}
                            onCheckedChange={() => bulk.toggle(loan.id)}
                            aria-label="Select row"
                          />
                        </TableCell>
                        <TableCell>{loan.loan_id}</TableCell>
                        <TableCell>
                          {loan.borrowers
                            ? `${loan.borrowers.first_name ?? ''} ${loan.borrowers.surname ?? ''}`.trim() || '—'
                            : '—'}
                        </TableCell>
                        <TableCell>{loan.officer?.full_name ?? '—'}</TableCell>
                        <TableCell>
                          <Badge variant={loan.status === 'edit_requested' ? 'warning' : 'destructive'}>
                            {loan.status.replace(/_/g, ' ')}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <p>{currency} {Number(loan.principal).toLocaleString()}</p>
                          {renderRequestDetails(loan)}
                        </TableCell>
                        <TableCell className="space-x-2">
                          {loan.status === 'delete_requested' && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild><Button size="sm" variant="outline"><CheckCircle className="mr-2 h-4 w-4" /> Approve</Button></AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader><AlertDialogTitle>Approve Deletion Request?</AlertDialogTitle>                            <AlertDialogDescription>
                                  This permanently deletes the loan from the system. This is the final approval (no admin step).
                                </AlertDialogDescription></AlertDialogHeader>
                                <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleApproveDeletion(loan)}>Yes, delete permanently</AlertDialogAction></AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                           {loan.status === 'edit_requested' && (
                            <Button size="sm" variant="outline" onClick={() => setEditApproveLoan(loan)}>
                              <CheckCircle className="mr-2 h-4 w-4" /> Approve
                            </Button>
                          )}
                          <AlertDialog>
                            <AlertDialogTrigger asChild><Button size="sm" variant="destructive"><XCircle className="mr-2 h-4 w-4" /> Reject</Button></AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader><AlertDialogTitle>Reject Request?</AlertDialogTitle><AlertDialogDescription>This will reject the request and revert the loan status.</AlertDialogDescription></AlertDialogHeader>
                              <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleRejectRequest(loan)}>Yes, Reject</AlertDialogAction></AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </TableCell>
                      </TableRow>
                    )) : (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">No pending loan edit or deletion requests.</TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {requests.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-4 border-t px-6 py-4">
                    <p className="text-sm text-neutral-600">
                      Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, requests.length)} of {requests.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-neutral-600">Page {page} / {totalPages}</span>
                      <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Loan increase — branch manager approval</CardTitle>
                <CardDescription>
                  Officers must request approval before disbursing a new loan to anyone who has already completed a prior loan. Approve or reject each request here.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Borrower</TableHead>
                      <TableHead>Loan officer</TableHead>
                      <TableHead>Officer notes</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {attendanceExceptions.length > 0 ? (
                      attendanceExceptions.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell>
                            {row.borrowers
                              ? `${row.borrowers.first_name} ${row.borrowers.surname}`.trim()
                              : '—'}
                            {borrowerPublicId(row.borrowers) ? (
                              <span className="block text-xs text-muted-foreground">ID: {borrowerPublicId(row.borrowers)}</span>
                            ) : null}
                          </TableCell>
                          <TableCell>{row.officer?.full_name ?? '—'}</TableCell>
                          <TableCell className="max-w-md whitespace-pre-wrap text-sm text-neutral-700">
                            {row.officer_notes}
                          </TableCell>
                          <TableCell className="text-sm text-neutral-600">
                            {row.created_at
                              ? new Date(row.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                              : '—'}
                          </TableCell>
                          <TableCell className="space-x-2">
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={resolvingId === row.id}
                              onClick={() => handleResolveAttendanceException(row.id, true)}
                            >
                              {resolvingId === row.id ? '…' : 'Approve'}
                            </Button>
                            <Button
                              size="sm"
                              variant="destructive"
                              disabled={resolvingId === row.id}
                              onClick={() => handleResolveAttendanceException(row.id, false)}
                            >
                              Reject
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No pending loan increase approvals.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="history" className="space-y-4 mt-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle>Loan increase approval — full history</CardTitle>
                    <CardDescription>
                      All officer requests and manager decisions (up to 200 most recent). Admins see the full list (up to
                      500) on <strong>Admin → History &amp; audit → Loan increase approvals</strong>; audit log entries
                      are under Activity log.
                    </CardDescription>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={exportLoanIncreaseHistoryCsv} disabled={loanIncreaseHistory.length === 0}>
                    Export history CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Status</TableHead>
                      <TableHead>Borrower</TableHead>
                      <TableHead>Officer</TableHead>
                      <TableHead>Submitted</TableHead>
                      <TableHead>Manager</TableHead>
                      <TableHead>Resolved</TableHead>
                      <TableHead>Used at disburse</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pagedHistory.length > 0 ? (
                      pagedHistory.map((row) => (
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
                          <TableCell className="text-sm">{row.officer?.full_name ?? '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.created_at
                              ? new Date(row.created_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                              : '—'}
                          </TableCell>
                          <TableCell className="text-sm">{row.manager?.full_name ?? '—'}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.resolved_at
                              ? new Date(row.resolved_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                              : '—'}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {row.consumed_at
                              ? new Date(row.consumed_at).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
                              : '—'}
                          </TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground">
                          No loan increase approval history yet.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
                {loanIncreaseHistory.length > HISTORY_PAGE_SIZE && (
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t px-2 pt-4">
                    <p className="text-sm text-neutral-600">
                      Showing {(historyPage - 1) * HISTORY_PAGE_SIZE + 1}–
                      {Math.min(historyPage * HISTORY_PAGE_SIZE, loanIncreaseHistory.length)} of {loanIncreaseHistory.length}
                    </p>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" disabled={historyPage <= 1} onClick={() => setHistoryPage((p) => Math.max(1, p - 1))}>
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="text-sm text-neutral-600">
                        Page {historyPage} / {historyTotalPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={historyPage >= historyTotalPages}
                        onClick={() => setHistoryPage((p) => Math.min(historyTotalPages, p + 1))}
                      >
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )}
                <details className="mt-4 rounded-md border border-neutral-200 bg-neutral-50/80 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900/40">
                  <summary className="cursor-pointer font-medium text-neutral-800 dark:text-neutral-200">Officer &amp; manager notes (expand)</summary>
                  <div className="mt-3 space-y-3">
                    {pagedHistory.map((row) => (
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
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
      <ManagerApproveLoanEditDialog
        loan={editApproveLoan}
        open={Boolean(editApproveLoan)}
        onOpenChange={(o) => {
          if (!o) setEditApproveLoan(null);
        }}
        holidays={holidays}
        onApprove={handleApproveEdit}
      />
    </DashboardLayout>
  );
};

export default LoanRequests;