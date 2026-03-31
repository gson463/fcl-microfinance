import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format, parseISO, startOfDay, endOfDay, isAfter, isBefore, isSunday } from 'date-fns';
import { format as formatTZ, toZonedTime } from 'date-fns-tz';
import { supabase, invokeEdgeFunction } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { cn } from '@/lib/utils';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription as AlertDialogDesc, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger as AlertDialogTriggerComponent } from '@/components/ui/alert-dialog';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { RepaymentScheduleGrid } from '@/components/loans/RepaymentScheduleGrid';
import { scheduleExportMetaFromLoan } from '@/lib/scheduleExport';
import { Checkbox } from '@/components/ui/checkbox';
import { Edit, Trash2, Calendar as CalendarIcon, FileDown, Download, Eye, Loader2, ArrowRightLeft, TrendingUp, TrendingDown, Scale, PlusCircle, Coins as HandCoins, Search, ChevronLeft, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import { exportObjectsToCsv } from '@/lib/tableExport';

const EAT_TIMEZONE = 'Africa/Nairobi';
const PAGE_SIZE = 25;

const StatCard = ({ title, value, icon: Icon, color }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Icon className={`h-4 w-4 text-muted-foreground ${color}`} />
        </CardHeader>
        <CardContent>
            <div className="text-2xl font-bold">{value}</div>
        </CardContent>
    </Card>
);

const RepaymentManagement = () => {
    const { user, session } = useAuth();
    const { toast } = useToast();
    const [repayments, setRepayments] = useState([]);
    const [loans, setLoans] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [currency, setCurrency] = useState('TZS');
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [repaymentDialogOpen, setRepaymentDialogOpen] = useState(false);
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [selectedLoanForSchedule, setSelectedLoanForSchedule] = useState(null);
    const [isRefreshingSchedule, setIsRefreshingSchedule] = useState(false);
    const [currentRepayment, setCurrentRepayment] = useState(null);
    const [editForm, setEditForm] = useState({ amount: '', payment_date: '' });
    const [repaymentFormData, setRepaymentFormData] = useState({ loanId: '', amount: '', payment_date: new Date() });
    const [loanPickerSearch, setLoanPickerSearch] = useState('');
    const [selectedRepayments, setSelectedRepayments] = useState([]);
    const [pendingDeleteRepaymentIds, setPendingDeleteRepaymentIds] = useState(() => new Set());

    // Filters
    const [borrowerFilter, setBorrowerFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [dateRangeFilter, setDateRangeFilter] = useState(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);

    const resetFilters = () => {
        setBorrowerFilter('all');
        setGroupFilter('all');
        setDateRangeFilter(null);
        setSearchTerm('');
        setSelectedRepayments([]);
        setPage(1);
    };
    
    const resetRepaymentForm = () => {
        setRepaymentFormData({ loanId: '', amount: '', payment_date: new Date() });
        setLoanPickerSearch('');
    };

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        try {
            await supabase.rpc('update_all_loan_statuses');
            const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
            if (config) setCurrency(config.value);

            let { data: loansData, error: loansError } = await supabase
                .from('loans')
                .select('*, borrowers(*, groups(*))')
                .eq('officer_id', user.id);
            if (loansError) throw loansError;
            setLoans(loansData || []);

            let { data: repaymentsData, error: repaymentsError } = await supabase
                .from('repayments')
                .select('*, loans(id, borrower_id, schedule, loan_id, borrowers(*, groups(*)))')
                .eq('officer_id', user.id)
                .order('actual_payment_date', { ascending: false });
            if (repaymentsError) throw repaymentsError;

            setRepayments(repaymentsData || []);

            const { data: pendingDeletes } = await supabase
                .from('repayment_delete_requests')
                .select('repayment_id')
                .eq('officer_id', user.id)
                .eq('status', 'pending');
            setPendingDeleteRepaymentIds(new Set((pendingDeletes || []).map((p) => p.repayment_id)));

            const { data: groupsData, error: groupsError } = await supabase.from('groups').select('*').eq('loan_officer_id', user.id);
            if (groupsError) throw groupsError;
            setGroups(groupsData || []);

        } catch (error) {
            toast({ title: 'Error fetching data', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const filteredRepayments = useMemo(() => {
        return repayments.filter(r => {
            const borrowerMatch = borrowerFilter === 'all' || r.borrower_id === borrowerFilter;
            const groupMatch = groupFilter === 'all' || r.loans?.borrowers?.group_id === groupFilter;
            const dateMatch = !dateRangeFilter?.from || (
                new Date(r.actual_payment_date) >= startOfDay(dateRangeFilter.from) &&
                new Date(r.actual_payment_date) <= endOfDay(dateRangeFilter.to || dateRangeFilter.from)
            );

            const searchLower = searchTerm.toLowerCase();
            const loanId = r.loans?.loan_id?.toLowerCase() || '';
            const fName = r.loans?.borrowers?.first_name?.toLowerCase() || '';
            const sName = r.loans?.borrowers?.surname?.toLowerCase() || '';
            const borrowerName = `${fName} ${sName}`;
            const borrowerId = r.loans?.borrowers?.borrower_id?.toLowerCase() || '';

            const searchMatch = !searchTerm || 
                loanId.includes(searchLower) ||
                borrowerName.includes(searchLower) ||
                borrowerId.includes(searchLower);

            return borrowerMatch && groupMatch && dateMatch && searchMatch;
        });
    }, [repayments, borrowerFilter, groupFilter, dateRangeFilter, searchTerm]);

    useEffect(() => {
        setPage(1);
    }, [borrowerFilter, groupFilter, dateRangeFilter, searchTerm]);

    const pagedRepayments = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredRepayments.slice(start, start + PAGE_SIZE);
    }, [filteredRepayments, page]);

    const totalPages = Math.max(1, Math.ceil(filteredRepayments.length / PAGE_SIZE));
    
    const stats = useMemo(() => {
        const totalPaid = filteredRepayments.reduce((sum, r) => sum + r.amount, 0);
        const totalInterest = filteredRepayments.reduce((sum, r) => sum + (r.interest_paid || 0), 0);
        const totalPrincipalPaid = filteredRepayments.reduce((sum, r) => sum + (r.principal_paid || 0), 0);
        
        // Stats calculation needs to be aware of the search scope to be meaningful, but currently calculates
        // outstanding principal based on *loans* associated with the filtered repayments, or all loans if filtering logic is tricky.
        // Simplified approach: Calculate outstanding principal for all loans that match the current filters
        
        const relevantLoans = loans.filter(l => {
            const borrowerMatch = borrowerFilter === 'all' || l.borrower_id === borrowerFilter;
            const groupMatch = groupFilter === 'all' || l.borrowers?.group_id === groupFilter;
            
            const searchLower = searchTerm.toLowerCase();
            const loanId = l.loan_id?.toLowerCase() || '';
            const fName = l.borrowers?.first_name?.toLowerCase() || '';
            const sName = l.borrowers?.surname?.toLowerCase() || '';
            const borrowerName = `${fName} ${sName}`;
            const borrowerId = l.borrowers?.borrower_id?.toLowerCase() || '';

            const searchMatch = !searchTerm || 
                loanId.includes(searchLower) ||
                borrowerName.includes(searchLower) ||
                borrowerId.includes(searchLower);

            return borrowerMatch && groupMatch && searchMatch; // Date range applies to repayments, not loans generally, so we exclude it here for portfolio health context
        });
        
        let totalOutstandingPrincipal = relevantLoans.reduce((sum, loan) => {
             if (loan.status === 'paid' || loan.status === 'written_off') return sum;
             const principalPaid = loan.schedule?.reduce((s, i) => s + (i.principalPaid || 0), 0) || 0;
             return sum + (loan.principal - principalPaid);
        }, 0);

        return { totalPaid, totalInterest, totalPrincipalPaid, totalOutstandingPrincipal };
    }, [filteredRepayments, loans, borrowerFilter, groupFilter, searchTerm]);

    const handleEdit = (repayment) => {
        setCurrentRepayment(repayment);
        setEditForm({
            amount: repayment.amount,
            payment_date: format(parseISO(repayment.actual_payment_date), 'yyyy-MM-dd')
        });
        setEditDialogOpen(true);
    };

    const handleUpdateRepayment = async (e) => {
        e.preventDefault();
        setIsSubmitting(true);
        try {
            if (!currentRepayment) throw new Error("No repayment selected for update.");

            const { error: updateError } = await supabase
                .from('repayments')
                .update({ amount: editForm.amount, actual_payment_date: editForm.payment_date, payment_date: editForm.payment_date })
                .eq('id', currentRepayment.id);
            if (updateError) throw updateError;
            
            await supabase.rpc('recalculate_loan_schedule', { p_loan_id: currentRepayment.loan_id });
            await supabase.rpc('update_all_loan_statuses');

            toast({ title: 'Success', description: 'Repayment updated successfully.' });
            setEditDialogOpen(false);
            fetchData();
        } catch (error) {
            toast({ title: 'Error updating repayment', description: error.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleViewSchedule = async (loan) => {
        setIsRefreshingSchedule(true);
        try {
            // Force recalculation to ensure any pending edits/payments are processed
            await supabase.rpc('recalculate_loan_schedule', { p_loan_id: loan.id });
            await supabase.rpc('update_all_loan_statuses');
            
            // Fetch fresh data explicitly for the dialog
            const { data: latestLoanData, error } = await supabase
                .from('loans')
                .select(`*, loan_products(name), borrowers(*, groups(name), branches(name))`)
                .eq('id', loan.id)
                .single();
                
            if (error) throw error;

            setSelectedLoanForSchedule(latestLoanData);
            setScheduleDialogOpen(true);
        } catch (error) {
            console.error(error);
            toast({ title: 'Error', description: 'Could not refresh schedule data.', variant: 'destructive' });
        } finally {
            setIsRefreshingSchedule(false);
        }
    };
    
    const handleRecordRepayment = async () => {
        const { loanId, amount, payment_date } = repaymentFormData;
        if (!loanId) {
            toast({ title: 'Error', description: 'Please select a loan.', variant: 'destructive' });
            return;
        }
        const raw = String(amount ?? '').trim();
        const amt = parseFloat(raw.replace(/,/g, ''));
        if (!Number.isFinite(amt) || amt <= 0) {
            toast({ title: 'Error', description: 'Enter a repayment amount greater than zero.', variant: 'destructive' });
            return;
        }
        if (!payment_date) {
            toast({ title: 'Error', description: 'Please select the payment date.', variant: 'destructive' });
            return;
        }
        if (!user?.id) {
            toast({ title: 'Error', description: 'You must be signed in to record a repayment.', variant: 'destructive' });
            return;
        }
        const payDay = startOfDay(payment_date);
        const today = startOfDay(new Date());
        if (isBefore(payDay, today)) {
            toast({ title: 'Invalid date', description: 'Payment date cannot be in the past.', variant: 'destructive' });
            return;
        }
        if (isAfter(payDay, today)) {
            toast({ title: 'Invalid date', description: 'Payment date cannot be in the future.', variant: 'destructive' });
            return;
        }
        if (isSunday(payment_date)) {
            toast({ title: 'Invalid date', description: 'Repayments are not recorded on Sundays.', variant: 'destructive' });
            return;
        }

        setIsSubmitting(true);
        try {
            const { data, error } = await invokeEdgeFunction(
                'record-repayment',
                {
                    body: {
                        loan_id: loanId,
                        amount: amt,
                        officer_id: user.id,
                        actual_payment_date: formatTZ(payment_date, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
                    },
                },
                session?.access_token,
            );

            const bodyError =
                data && typeof data === 'object' && data !== null && 'error' in data && data.error != null
                    ? String(data.error)
                    : null;

            if (error || bodyError) {
                const description =
                    bodyError ||
                    (error?.context && typeof error.context === 'object' && error.context.body
                        ? (() => {
                              try {
                                  const j = JSON.parse(String(error.context.body));
                                  return j?.error ? String(j.error) : null;
                              } catch {
                                  return null;
                              }
                          })()
                        : null) ||
                    error?.message ||
                    'Could not record repayment.';
                toast({ title: 'Repayment failed', description, variant: 'destructive' });
                return;
            }

            toast({ title: 'Success', description: 'Repayment recorded successfully!' });
            setRepaymentDialogOpen(false);
            resetRepaymentForm();
            await fetchData();
        } catch (e) {
            toast({
                title: 'Repayment failed',
                description: e?.message || 'Unexpected error. Check your connection and try again.',
                variant: 'destructive',
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRequestDelete = async (repaymentId) => {
        try {
            const repayment = repayments.find((r) => r.id === repaymentId);
            if (!repayment) throw new Error('Repayment not found');
            if (pendingDeleteRepaymentIds.has(repaymentId)) {
                toast({
                    title: 'Already pending',
                    description: 'A deletion request is already waiting for branch manager approval.',
                });
                return;
            }

            const { error } = await supabase.from('repayment_delete_requests').insert({
                repayment_id: repaymentId,
                loan_id: repayment.loan_id,
                officer_id: user.id,
                status: 'pending',
                snapshot: { ...repayment },
            });
            if (error) throw error;

            await supabase.rpc('log_audit_event', {
                p_action: 'repayment.delete.requested',
                p_entity_type: 'repayment',
                p_entity_id: String(repaymentId),
                p_metadata: { loan_public_id: repayment.loans?.loan_id },
            });

            toast({
                title: 'Requested',
                description: 'Deletion request sent to your branch manager for approval.',
            });
            fetchData();
        } catch (error) {
            toast({ title: 'Request failed', description: error.message, variant: 'destructive' });
        }
    };

    const handleBulkRequestDelete = async () => {
        setIsSubmitting(true);
        try {
            const toRequest = repayments.filter(
                (r) => selectedRepayments.includes(r.id) && !pendingDeleteRepaymentIds.has(r.id)
            );
            if (toRequest.length === 0) {
                toast({
                    title: 'Nothing to request',
                    description: 'Selected repayments already have a pending deletion request.',
                });
                return;
            }

            let ok = 0;
            for (const repayment of toRequest) {
                const { error } = await supabase.from('repayment_delete_requests').insert({
                    repayment_id: repayment.id,
                    loan_id: repayment.loan_id,
                    officer_id: user.id,
                    status: 'pending',
                    snapshot: { ...repayment },
                });
                if (error) {
                    if (error.code !== '23505') throw error;
                    continue;
                }
                await supabase.rpc('log_audit_event', {
                    p_action: 'repayment.delete.requested',
                    p_entity_type: 'repayment',
                    p_entity_id: String(repayment.id),
                    p_metadata: { loan_public_id: repayment.loans?.loan_id },
                });
                ok += 1;
            }

            toast({
                title: 'Success',
                description: `Deletion requested for ${ok} repayment(s). Manager approval is required before removal.`,
            });
            setSelectedRepayments([]);
            fetchData();
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleExportSelectedRepaymentsCsv = () => {
        const rows = filteredRepayments.filter((r) => selectedRepayments.includes(r.id));
        if (rows.length === 0) {
            toast({ title: 'Nothing selected', description: 'Select one or more repayments first.', variant: 'destructive' });
            return;
        }
        exportObjectsToCsv(`repayments_selected_${Date.now()}.csv`, [
            {
                header: 'Payment Date',
                accessor: (r) =>
                    formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'yyyy-MM-dd'),
            },
            {
                header: 'Borrower',
                accessor: (r) =>
                    `${r.loans?.borrowers?.first_name || ''} ${r.loans?.borrowers?.surname || ''}`.trim(),
            },
            { header: 'Loan ID', accessor: (r) => r.loans?.loan_id || '' },
            { header: 'Principal Paid', accessor: (r) => String(r.principal_paid ?? '') },
            { header: 'Interest Paid', accessor: (r) => String(r.interest_paid ?? '') },
            { header: 'Total Paid', accessor: (r) => String(r.amount ?? '') },
        ], rows);
        toast({ title: 'Exported', description: `${rows.length} repayment(s) to CSV.` });
    };

    const handleExport = (loan) => {
        if (!loan || !loan.borrowers) {
            toast({ title: 'Error', description: 'Cannot export, loan data is incomplete.', variant: 'destructive' });
            return;
        }

        const borrower = loan.borrowers;
        const group = borrower.groups;

        const summaryData = [
            { 'Field': 'Borrower Name', 'Value': `${borrower.first_name} ${borrower.surname}` },
            { 'Field': 'Borrower ID', 'Value': borrower.borrower_id },
            { 'Field': 'Phone Number', 'Value': borrower.phone_number },
            { 'Field': 'Group', 'Value': group ? group.name : 'N/A' },
            { 'Field': 'Loan ID', 'Value': loan.loan_id },
            { 'Field': 'Principal Amount', 'Value': loan.principal, 'Format': 'currency' },
            { 'Field': 'Total Payable', 'Value': loan.total_payable, 'Format': 'currency' },
            { 'Field': 'Outstanding Balance', 'Value': loan.balance, 'Format': 'currency' },
            { 'Field': 'Loan Status', 'Value': loan.status },
        ];

        const scheduleData = loan.schedule.map(inst => ({
            'Installment No.': inst.installmentNumber,
            'Due Date': formatTZ(toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE), 'yyyy-MM-dd'),
            'Amount Due': inst.amount,
            'Principal Component': inst.principalComponent,
            'Interest Component': inst.interestComponent,
            'Amount Paid': inst.paidAmount || 0,
            'Principal Paid': inst.principalPaid || 0,
            'Interest Paid': inst.interestPaid || 0,
            'Balance': inst.amount - (inst.paidAmount || 0),
            'Status': inst.status,
        }));

        const repaymentsForLoan = repayments.filter(r => r.loan_id === loan.id).map(r => ({
            'Payment Date': formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'yyyy-MM-dd'),
            'Principal Paid': r.principal_paid,
            'Interest Paid': r.interest_paid,
            'Total Amount': r.amount,
        }));
        
        const wb = XLSX.utils.book_new();

        const wsSummary = XLSX.utils.json_to_sheet(summaryData, { skipHeader: true });
        XLSX.utils.book_append_sheet(wb, wsSummary, 'Summary');

        const wsSchedule = XLSX.utils.json_to_sheet(scheduleData);
        XLSX.utils.book_append_sheet(wb, wsSchedule, 'Repayment Schedule');

        const wsRepayments = XLSX.utils.json_to_sheet(repaymentsForLoan);
        XLSX.utils.book_append_sheet(wb, wsRepayments, 'Payments Made');
        
        const fileName = `statement_${borrower.first_name}_${borrower.surname}_${loan.loan_id}.xlsx`;
        XLSX.writeFile(wb, fileName);
    };

    const borrowerOptions = useMemo(() => (
        [...new Map(loans.map(l => [l.borrower_id, l.borrowers])).values()]
        .filter(b => b)
        .map(b => ({
            value: b.id,
            label: `${b.first_name} ${b.surname} (${b.borrower_id})`
        }))
    ), [loans]);
    
    const loanOptionsForCombobox = useMemo(
      () =>
        loans
          .filter((l) => l.borrowers && (l.status === 'active' || l.status === 'delinquent'))
          .map((l) => ({
            value: l.id,
            label: `${l.borrowers.first_name} ${l.borrowers.surname} — ${l.loan_id}`,
          })),
      [loans]
    );

    const filteredLoanPickerOptions = useMemo(() => {
      const q = loanPickerSearch.trim().toLowerCase();
      if (!q) return loanOptionsForCombobox;
      return loanOptionsForCombobox.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          String(o.value).toLowerCase().includes(q)
      );
    }, [loanOptionsForCombobox, loanPickerSearch]);

    const handleSelectAll = (checked) => {
        const pageIds = pagedRepayments.map(r => r.id);
        if (checked) {
            setSelectedRepayments((prev) => [...new Set([...prev, ...pageIds])]);
        } else {
            setSelectedRepayments((prev) => prev.filter((id) => !pageIds.includes(id)));
        }
    };

    const handleSelectOne = (repaymentId, checked) => {
        if (checked) {
            setSelectedRepayments(prev => [...prev, repaymentId]);
        } else {
            setSelectedRepayments(prev => prev.filter(id => id !== repaymentId));
        }
    };

    if (loading) return <DashboardLayout><Loader2 className="h-8 w-8 animate-spin mx-auto mt-8" /></DashboardLayout>;

    return (
        <DashboardLayout title="Repayment Management">
            <div className="space-y-6">
                 <div className="flex justify-end">
                    <Dialog open={repaymentDialogOpen} onOpenChange={setRepaymentDialogOpen}>
                        <DialogTrigger asChild>
                            <Button onClick={resetRepaymentForm}>
                                <PlusCircle className="mr-2 h-4 w-4" /> Record Repayment
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                            <DialogHeader>
                                <DialogTitle>Record New Repayment</DialogTitle>
                                <DialogDescription>
                                    Search and tap a loan, enter amount, then choose the payment date.
                                </DialogDescription>
                            </DialogHeader>
                            <div className="space-y-4 py-2">
                                <div className="space-y-2">
                                    <Label htmlFor="loan-search">Loan</Label>
                                    <div className="relative">
                                        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                                        <Input
                                            id="loan-search"
                                            placeholder="Search by borrower name or loan ID…"
                                            value={loanPickerSearch}
                                            onChange={(e) => setLoanPickerSearch(e.target.value)}
                                            className="pl-9"
                                            autoComplete="off"
                                        />
                                    </div>
                                    <div
                                        className="max-h-[200px] overflow-y-auto rounded-md border border-input bg-muted/30"
                                        role="listbox"
                                        aria-label="Matching loans"
                                    >
                                        {filteredLoanPickerOptions.length === 0 ? (
                                            <p className="py-6 text-center text-sm text-muted-foreground">
                                                {loanOptionsForCombobox.length === 0
                                                    ? 'No active or delinquent loans.'
                                                    : 'No loans match your search.'}
                                            </p>
                                        ) : (
                                            filteredLoanPickerOptions.map((opt) => (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    role="option"
                                                    aria-selected={repaymentFormData.loanId === opt.value}
                                                    onClick={() =>
                                                        setRepaymentFormData((prev) => ({ ...prev, loanId: opt.value }))
                                                    }
                                                    className={cn(
                                                        'flex w-full items-start gap-2 border-b border-border/60 px-3 py-2.5 text-left text-sm last:border-0 transition-colors hover:bg-accent',
                                                        repaymentFormData.loanId === opt.value && 'bg-accent font-medium'
                                                    )}
                                                >
                                                    <span className="min-w-0 flex-1 leading-snug">{opt.label}</span>
                                                </button>
                                            ))
                                        )}
                                    </div>
                                    {repaymentFormData.loanId && (
                                        <p className="text-xs text-muted-foreground">
                                            <span className="font-medium text-foreground">Selected:</span>{' '}
                                            {loanOptionsForCombobox.find((o) => o.value === repaymentFormData.loanId)?.label ??
                                                repaymentFormData.loanId}
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <Label htmlFor="repayment-amount">Repayment amount ({currency})</Label>
                                    <Input
                                        id="repayment-amount"
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        value={repaymentFormData.amount}
                                        onChange={(e) =>
                                            setRepaymentFormData({ ...repaymentFormData, amount: e.target.value })
                                        }
                                        placeholder="Enter amount"
                                    />
                                </div>
                                <div>
                                    <Label htmlFor="payment-date">Actual payment date</Label>
                                    <Input
                                        id="payment-date"
                                        type="date"
                                        className="font-mono"
                                        min={format(new Date(), 'yyyy-MM-dd')}
                                        max={format(new Date(), 'yyyy-MM-dd')}
                                        value={
                                            repaymentFormData.payment_date
                                                ? format(repaymentFormData.payment_date, 'yyyy-MM-dd')
                                                : ''
                                        }
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (!v) return;
                                            const [y, m, d] = v.split('-').map(Number);
                                            if (!y || !m || !d) return;
                                            const picked = new Date(y, m - 1, d);
                                            const todayOnly = startOfDay(new Date());
                                            const pickedDay = startOfDay(picked);
                                            if (isBefore(pickedDay, todayOnly) || isAfter(pickedDay, todayOnly)) {
                                                return;
                                            }
                                            setRepaymentFormData((prev) => ({
                                                ...prev,
                                                payment_date: picked,
                                            }));
                                        }}
                                    />
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Use today only — past and future dates are blocked. Sundays cannot be saved.
                                    </p>
                                </div>
                                <Button type="button" onClick={handleRecordRepayment} className="w-full" disabled={isSubmitting}>
                                    {isSubmitting ? (
                                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                    ) : (
                                        <HandCoins className="mr-2 h-4 w-4" />
                                    )}
                                    Record payment
                                </Button>
                            </div>
                        </DialogContent>
                    </Dialog>
                </div>
                <Card>
                    <CardHeader>
                        <CardTitle>Repayment Overview</CardTitle>
                        <CardDescription>Summary of repayments based on selected filters.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                            <StatCard title="Total Repayments (Filtered)" value={`${currency} ${stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={ArrowRightLeft} color="text-blue-500" />
                            <StatCard title="Interest Collected" value={`${currency} ${stats.totalInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={TrendingUp} color="text-green-500" />
                            <StatCard title="Principal Repayments" value={`${currency} ${stats.totalPrincipalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={TrendingDown} color="text-orange-500" />
                            <StatCard title="Outstanding Principal" value={`${currency} ${stats.totalOutstandingPrincipal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={Scale} color="text-red-500" />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Filters</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-center gap-4">
                        <div className="relative">
                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                            <Input 
                                placeholder="Search Loan ID, Name, Borrower ID..." 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-8 w-[280px]"
                            />
                        </div>
                        <Select value={borrowerFilter} onValueChange={setBorrowerFilter}>
                            <SelectTrigger className="w-[240px]">
                                <SelectValue placeholder="Filter by Borrower..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Borrowers</SelectItem>
                                {borrowerOptions.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Select value={groupFilter} onValueChange={setGroupFilter}>
                            <SelectTrigger className="w-[240px]">
                                <SelectValue placeholder="Filter by Group..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Groups</SelectItem>
                                {groups.map(g => <SelectItem key={g.id} value={g.id}>{g.name}</SelectItem>)}
                            </SelectContent>
                        </Select>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="w-[280px] justify-start text-left font-normal">
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {dateRangeFilter?.from ? (dateRangeFilter.to ? `${formatTZ(dateRangeFilter.from, "LLL dd, y")} - ${formatTZ(dateRangeFilter.to, "LLL dd, y")}` : formatTZ(dateRangeFilter.from, "LLL dd, y")) : <span>Pick a date range</span>}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar mode="range" selected={dateRangeFilter} onSelect={setDateRangeFilter} numberOfMonths={2} />
                            </PopoverContent>
                        </Popover>
                        <Button onClick={resetFilters} variant="ghost">Reset</Button>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                        <CardTitle>Repayment History</CardTitle>
                        <div className="flex flex-wrap items-center gap-2">
                        {selectedRepayments.length > 0 && (
                            <Button type="button" variant="outline" size="sm" onClick={handleExportSelectedRepaymentsCsv}>
                                <Download className="mr-2 h-4 w-4" />
                                Export selected (CSV)
                            </Button>
                        )}
                        {selectedRepayments.length > 0 && (
                             <AlertDialog>
                                <AlertDialogTriggerComponent asChild>
                                    <Button variant="destructive" disabled={isSubmitting}>
                                        {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                        Request deletion ({selectedRepayments.length})
                                    </Button>
                                </AlertDialogTriggerComponent>
                                <AlertDialogContent>
                                    <AlertDialogHeader><AlertDialogTitle>Request deletion?</AlertDialogTitle><AlertDialogDesc>This will send {selectedRepayments.length} repayment(s) to your branch manager for approval. Nothing is deleted until the manager approves.</AlertDialogDesc></AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                        <AlertDialogAction onClick={handleBulkRequestDelete}>Send requests</AlertDialogAction>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        )}
                        </div>
                    </CardHeader>
                    <CardContent>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[50px]">
                                        <Checkbox
                                            checked={pagedRepayments.length > 0 && pagedRepayments.every((r) => selectedRepayments.includes(r.id))}
                                            onCheckedChange={handleSelectAll}
                                        />
                                    </TableHead>
                                    <TableHead>Payment Date</TableHead>
                                    <TableHead>Borrower</TableHead>
                                    <TableHead>Group</TableHead>
                                    <TableHead>Principal Paid</TableHead>
                                    <TableHead>Interest Paid</TableHead>
                                    <TableHead>Total Paid</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pagedRepayments.map(r => (
                                    <TableRow key={r.id} data-state={selectedRepayments.includes(r.id) && "selected"}>
                                        <TableCell>
                                            <Checkbox
                                                checked={selectedRepayments.includes(r.id)}
                                                onCheckedChange={(checked) => handleSelectOne(r.id, checked)}
                                            />
                                        </TableCell>
                                        <TableCell>{formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'MMM dd, yyyy')}</TableCell>
                                        <TableCell>{r.loans?.borrowers?.first_name} {r.loans?.borrowers?.surname} <span className="text-xs text-muted-foreground block">{r.loans?.loan_id}</span></TableCell>
                                        <TableCell>{r.loans?.borrowers?.groups?.name || 'N/A'}</TableCell>
                                        <TableCell>{currency} {(r.principal_paid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell>{currency} {(r.interest_paid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell className="font-semibold">
                                            <div className="flex flex-col gap-1">
                                                <span>{currency} {r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                                {pendingDeleteRepaymentIds.has(r.id) && (
                                                    <Badge variant="secondary" className="w-fit text-xs">Deletion pending approval</Badge>
                                                )}
                                            </div>
                                        </TableCell>
                                        <TableCell className="flex gap-1">
                                            <Button variant="ghost" size="icon" onClick={() => handleEdit(r)}><Edit className="h-4 w-4" /></Button>
                                            <AlertDialog>
                                                <AlertDialogTriggerComponent asChild><Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" disabled={pendingDeleteRepaymentIds.has(r.id)}><Trash2 className="h-4 w-4" /></Button></AlertDialogTriggerComponent>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader><AlertDialogTitle>Request repayment deletion?</AlertDialogTitle><AlertDialogDesc>Your branch manager must approve before this repayment is removed and the loan balance recalculated.</AlertDialogDesc></AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleRequestDelete(r.id)}>Send request</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                            <Button variant="ghost" size="icon" onClick={() => handleViewSchedule(r.loans)}><Eye className="h-4 w-4" /></Button>
                                            <Button variant="ghost" size="icon" onClick={() => handleExport(r.loans)}><FileDown className="h-4 w-4" /></Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {filteredRepayments.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">No repayments match the current filters.</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                            <TableFooter>
                                <TableRow>
                                    <TableCell colSpan={4} className="font-bold text-right">Totals</TableCell>
                                    <TableCell className="font-bold">{currency} {stats.totalPrincipalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell className="font-bold">{currency} {stats.totalInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell className="font-bold">{currency} {stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell></TableCell>
                                </TableRow>
                            </TableFooter>
                        </Table>
                        {filteredRepayments.length > 0 && (
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                                <p className="text-sm text-muted-foreground">
                                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredRepayments.length)} of {filteredRepayments.length}
                                </p>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <span className="text-sm text-muted-foreground">Page {page} / {totalPages}</span>
                                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
            
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
              <DialogContent>
                <DialogHeader><DialogTitle>Edit Repayment</DialogTitle></DialogHeader>
                {currentRepayment && (
                    <form onSubmit={handleUpdateRepayment} className="space-y-4">
                        <div>
                            <Label htmlFor="amount">Amount</Label>
                            <Input id="amount" type="number" value={editForm.amount} onChange={e => setEditForm({...editForm, amount: e.target.value})} required />
                        </div>
                        <div>
                            <Label htmlFor="payment_date">Payment Date</Label>
                            <Input id="payment_date" type="date" value={editForm.payment_date} onChange={e => setEditForm({...editForm, payment_date: e.target.value})} required />
                        </div>
                        <Button type="submit" disabled={isSubmitting}>
                            {isSubmitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...</> : 'Update Repayment'}
                        </Button>
                    </form>
                )}
              </DialogContent>
            </Dialog>

            <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
              <DialogContent className="max-w-5xl">
                <DialogHeader>
                    <DialogTitle>Repayment Schedule for {selectedLoanForSchedule?.loan_id}</DialogTitle>
                    <DialogDescription>
                        Borrower: {selectedLoanForSchedule?.borrowers?.first_name} {selectedLoanForSchedule?.borrowers?.surname} <br/>
                        Total Payable: {currency} {(selectedLoanForSchedule?.total_payable || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </DialogDescription>
                </DialogHeader>
                {selectedLoanForSchedule && (
                    <RepaymentScheduleGrid
                      schedule={selectedLoanForSchedule.schedule}
                      currency={currency}
                      variant="full"
                      exportMeta={scheduleExportMetaFromLoan(
                        selectedLoanForSchedule,
                        currency,
                        'full'
                      )}
                    />
                )}
              </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
};

export default RepaymentManagement;