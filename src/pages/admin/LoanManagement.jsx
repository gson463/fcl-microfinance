
import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkDataTableToolbar } from '@/components/ui/bulk-data-table-toolbar';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { RepaymentScheduleGrid } from '@/components/loans/RepaymentScheduleGrid';
import { scheduleExportMetaFromLoan } from '@/lib/scheduleExport';
import { SCHEDULE_DIALOG_CONTENT, SCHEDULE_DIALOG_SCROLL } from '@/lib/dialogLayout';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Eye, Briefcase, DollarSign, AlertTriangle, Calendar as CalendarIconLucide, Loader2, Edit, Save, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import { borrowerMatchesCenter, borrowerMatchesGroup } from '@/lib/loanBorrowerLocationFilter';
import {
  regenerateLoanScheduleFromCurrentHolidays,
  loanStatusAllowsScheduleRegeneration,
  regenerateSchedulesForBranchLoans,
  loansEligibleForBranchRegeneration,
} from '@/lib/loanScheduleRegeneration';

const EAT_TIMEZONE = 'Africa/Nairobi';
const LOAN_BORROWER_SELECT = `*, borrowers(*, groups(id, name, center_id), branches(name)), loan_products(name)`;
const PAGE_SIZE = 25;

const LOAN_STATUS_FILTER_OPTIONS = [
	{ value: 'active', label: 'Active' },
	{ value: 'paid', label: 'Paid' },
	{ value: 'delinquent', label: 'Delinquent' },
	{ value: 'defaulted', label: 'Defaulted' },
];

const StatCard = ({ title, value, icon: Icon, color }) => (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
        <Icon className={`h-5 w-5 ${color}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
);

const AdminLoanManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [loans, setLoans] = useState([]);
    const [branches, setBranches] = useState([]);
    const [officers, setOfficers] = useState([]);
    const [loanProducts, setLoanProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [statusEditDialogOpen, setStatusEditDialogOpen] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState(null);
    const [newStatus, setNewStatus] = useState('');
    const [isRefreshingSchedule, setIsRefreshingSchedule] = useState(false);
    const [isRegeneratingCalendar, setIsRegeneratingCalendar] = useState(false);
    const [regenConfirmOpen, setRegenConfirmOpen] = useState(false);
    const [bulkBranchId, setBulkBranchId] = useState('');
    const [bulkRegenRunning, setBulkRegenRunning] = useState(false);
    const [bulkRegenProgress, setBulkRegenProgress] = useState(null);
    const [bulkRegenDialogOpen, setBulkRegenDialogOpen] = useState(false);
    const [holidays, setHolidays] = useState([]);
    const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
    const [currency, setCurrency] = useState('TZS');
    
    const [searchQuery, setSearchQuery] = useState('');
    const [branchFilter, setBranchFilter] = useState('all');
    const [statusFilter, setStatusFilter] = useState('all');
    const [productFilter, setProductFilter] = useState('all');
    const [officerFilter, setOfficerFilter] = useState('all');
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [centers, setCenters] = useState([]);
    const [groups, setGroups] = useState([]);
    const [dateRange, setDateRange] = useState({ from: undefined, to: undefined });
    const [page, setPage] = useState(1);

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);

        const { data: cfgRows } = await supabase.from('system_config').select('key, value').in('key', ['currency', 'systemName']);
        const cfg = Object.fromEntries((cfgRows || []).map((r) => [r.key, r.value]));
        if (cfg.currency) setCurrency(cfg.currency);

        // Fetch Branches
        const { data: branchesData, error: branchesError } = await supabase.from('branches').select('*');
        if (branchesError) {
             toast({ title: 'Error fetching branches', description: branchesError.message, variant: 'destructive' });
        } else {
             setBranches(branchesData || []);
        }

        // Fetch Officers (All)
        const { data: officersData, error: officersError } = await supabase
            .from('users')
            .select('id, full_name, branch_id')
            .eq('role', 'officer');
            
        if (officersError) {
             toast({ title: 'Error fetching officers', description: officersError.message, variant: 'destructive' });
        } else {
             setOfficers(officersData || []);
        }

        // Fetch All Loans
        // Include officer branch_id for filtering
        const { data: loansData, error: loansError } = await supabase
            .from('loans')
            .select(
                `${LOAN_BORROWER_SELECT}, officer:users!officer_id ( id, full_name, branch_id )`
            );

        // Fetch Products
        const { data: productsData, error: productsError } = await supabase.from('loan_products').select('*');

        const { data: holidaysData, error: holidaysError } = await supabase.from('holidays').select('*');
        if (holidaysError) {
            console.error(holidaysError);
            setHolidays([]);
        } else {
            setHolidays(holidaysData || []);
        }

        if (loansError || productsError) {
            toast({ title: 'Error fetching data', description: loansError?.message || productsError?.message, variant: 'destructive' });
        } else {
            setLoans(loansData || []);
            setLoanProducts(productsData || []);
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const filteredOfficers = useMemo(() => {
        if (branchFilter === 'all') return officers;
        return officers.filter(o => o.branch_id === branchFilter);
    }, [officers, branchFilter]);

    const loanListBranchOpts = useMemo(() => branches.map((b) => ({ value: b.id, label: b.name })), [branches]);
    const loanListOfficerOpts = useMemo(() => filteredOfficers.map((o) => ({ value: o.id, label: o.full_name })), [filteredOfficers]);
    const loanListCenterOpts = useMemo(() => centers.map((c) => ({ value: c.id, label: c.name })), [centers]);
    const loanListGroupOpts = useMemo(() => groups.map((g) => ({ value: g.id, label: g.name })), [groups]);
    const loanListProductOpts = useMemo(() => loanProducts.map((p) => ({ value: p.id, label: p.name })), [loanProducts]);
    const bulkBranchSelectOpts = useMemo(() => branches.map((b) => ({ value: b.id, label: b.name })), [branches]);

    // Reset officer filter if it becomes invalid due to branch change
    useEffect(() => {
        if (branchFilter !== 'all' && officerFilter !== 'all') {
            const officer = officers.find(o => o.id === officerFilter);
            if (officer && officer.branch_id !== branchFilter) {
                setOfficerFilter('all');
            }
        }
    }, [branchFilter, officerFilter, officers]);

    useEffect(() => {
        if (officerFilter === 'all') {
            setCenterFilter('all');
            setGroupFilter('all');
        }
    }, [officerFilter]);

    useEffect(() => {
        let cancelled = false;
        if (officerFilter === 'all') {
            setCenters([]);
            return;
        }
        (async () => {
            let q = supabase.from('centers').select('id, name').eq('loan_officer_id', officerFilter).order('name');
            if (branchFilter !== 'all') q = q.eq('branch_id', branchFilter);
            const { data } = await q;
            if (!cancelled) setCenters(data || []);
        })();
        return () => {
            cancelled = true;
        };
    }, [officerFilter, branchFilter]);

    useEffect(() => {
        let cancelled = false;
        if (centerFilter === 'all') {
            setGroups([]);
            return;
        }
        (async () => {
            const { data } = await supabase.from('groups').select('id, name').eq('center_id', centerFilter).order('name');
            if (!cancelled) setGroups(data || []);
        })();
        return () => {
            cancelled = true;
        };
    }, [centerFilter]);

    const filteredLoans = useMemo(() => {
        return loans.filter(loan => {
            const borrowerName = `${loan.borrowers?.first_name || ''} ${loan.borrowers?.surname || ''}`.toLowerCase();
            const query = searchQuery.toLowerCase();
            const matchesSearch = loan.loan_id.toLowerCase().includes(query) || borrowerName.includes(query) || loan.principal.toString().includes(query);
            const matchesStatus = statusFilter === 'all' || loan.status === statusFilter;
            const matchesProduct = productFilter === 'all' || loan.product_id === productFilter;
            const matchesOfficer = officerFilter === 'all' || loan.officer_id === officerFilter;
            const matchesBranch = branchFilter === 'all' || loan.officer?.branch_id === branchFilter;
            const matchesCenter = borrowerMatchesCenter(loan.borrowers, centerFilter);
            const matchesGroup = borrowerMatchesGroup(loan.borrowers, groupFilter);
            
            let matchesDate = true;
            if (dateRange.from && dateRange.to) {
                const loanDate = toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE);
                matchesDate = loanDate >= toZonedTime(dateRange.from, EAT_TIMEZONE) && loanDate <= toZonedTime(dateRange.to, EAT_TIMEZONE);
            } else if (dateRange.from) {
                matchesDate = toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE) >= toZonedTime(dateRange.from, EAT_TIMEZONE);
            }

            return matchesSearch && matchesStatus && matchesProduct && matchesOfficer && matchesBranch && matchesCenter && matchesGroup && matchesDate;
        });
    }, [loans, searchQuery, statusFilter, productFilter, officerFilter, branchFilter, centerFilter, groupFilter, dateRange]);

    useEffect(() => {
        setPage(1);
    }, [searchQuery, statusFilter, productFilter, officerFilter, branchFilter, centerFilter, groupFilter, dateRange]);

    const pagedLoans = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredLoans.slice(start, start + PAGE_SIZE);
    }, [filteredLoans, page]);

    const loanListTotalPages = Math.max(1, Math.ceil(filteredLoans.length / PAGE_SIZE));
    
    const stats = useMemo(() => {
        const totalLoans = filteredLoans.length;
        const totalPrincipal = filteredLoans.reduce((sum, l) => sum + Number(l.principal), 0);
        const totalBalance = filteredLoans.reduce((sum, l) => sum + Number(l.balance), 0);
        const atRiskLoans = filteredLoans.filter(l => ['delinquent', 'defaulted'].includes(l.status)).length;
        return { totalLoans, totalPrincipal, totalBalance, atRiskLoans };
    }, [filteredLoans]);

    const pagedLoanIds = useMemo(() => pagedLoans.map((l) => l.id), [pagedLoans]);
    const bulk = useBulkSelection(pagedLoanIds);

    const exportLoansCsv = () => {
        const rows = pagedLoans.filter((l) => bulk.isSelected(l.id));
        if (rows.length === 0) return;
        exportObjectsToCsv(`loans_${Date.now()}.csv`, [
            { header: 'Loan ID', accessor: 'loan_id' },
            { header: 'Borrower', accessor: (r) => `${r.borrowers?.first_name || ''} ${r.borrowers?.surname || ''}`.trim() },
            { header: 'Officer', accessor: (r) => r.officer?.full_name || '' },
            { header: 'Principal', accessor: (r) => String(r.principal ?? '') },
            { header: 'Balance', accessor: (r) => String(r.balance ?? '') },
            { header: 'Disbursement', accessor: (r) => (r.disbursement_date ? formatTZ(toZonedTime(new Date(r.disbursement_date), EAT_TIMEZONE), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }) : '') },
            { header: 'Status', accessor: 'status' },
        ], rows);
        toast({ title: 'Exported', description: `${rows.length} loan(s) to CSV.` });
    };

    const viewSchedule = async (loan) => {
        setIsRefreshingSchedule(true);
        try {
            // Force recalculation
            await supabase.rpc('recalculate_loan_schedule', { p_loan_id: loan.id });
            await supabase.rpc('update_all_loan_statuses');
            
            const { data: latestLoanData, error } = await supabase
                .from('loans')
                .select(`${LOAN_BORROWER_SELECT}`)
                .eq('id', loan.id)
                .single();
                
            if (error) throw error;

            setSelectedLoan(latestLoanData);
            setScheduleDialogOpen(true);
        } catch (error) {
             console.error(error);
             toast({ title: 'Error', description: 'Could not refresh schedule data.', variant: 'destructive' });
        } finally {
            setIsRefreshingSchedule(false);
        }
    };

    const handleRegenerateScheduleFromHolidays = async () => {
        if (!selectedLoan?.id) return;
        if (!loanStatusAllowsScheduleRegeneration(selectedLoan.status)) {
            toast({
                title: 'Not available',
                description: 'Only active, delinquent, or defaulted loans can be recalendared.',
                variant: 'destructive',
            });
            return;
        }
        setIsRegeneratingCalendar(true);
        try {
            const { error } = await regenerateLoanScheduleFromCurrentHolidays(supabase, selectedLoan, holidays);
            if (error) {
                toast({
                    title: 'Regeneration failed',
                    description: error.message || String(error),
                    variant: 'destructive',
                });
                return;
            }
            await supabase.rpc('update_all_loan_statuses').catch(() => {});
            const { data: latestLoanData, error: fetchErr } = await supabase
                .from('loans')
                .select(`${LOAN_BORROWER_SELECT}`)
                .eq('id', selectedLoan.id)
                .single();
            if (fetchErr) throw fetchErr;
            setSelectedLoan(latestLoanData);
            setRegenConfirmOpen(false);
            toast({
                title: 'Schedule updated',
                description: 'Due dates use the current holiday list; recorded repayments were reapplied.',
            });
            fetchData();
        } catch (e) {
            console.error(e);
            toast({ title: 'Error', description: e?.message || 'Could not regenerate schedule.', variant: 'destructive' });
        } finally {
            setIsRegeneratingCalendar(false);
        }
    };

    const openStatusEdit = (loan) => {
        setSelectedLoan(loan);
        setNewStatus(loan.status);
        setStatusEditDialogOpen(true);
    };

    const handleUpdateStatus = async () => {
        if (!selectedLoan || !newStatus) return;
        setIsUpdatingStatus(true);
        try {
            const { error } = await supabase.rpc('update_loan_status', { 
                p_loan_id: selectedLoan.id, 
                p_new_status: newStatus 
            });

            if (error) throw error;

            toast({ title: 'Success', description: 'Loan status updated successfully.' });
            setStatusEditDialogOpen(false);
            fetchData();
        } catch (error) {
            console.error(error);
            toast({ title: 'Error', description: error.message || 'Failed to update status.', variant: 'destructive' });
        } finally {
            setIsUpdatingStatus(false);
        }
    };

    const getStatusBadge = (status) => ({ active: 'success', paid: 'default', delinquent: 'warning', defaulted: 'destructive', delete_requested: 'secondary', edit_requested: 'secondary' }[status] || 'secondary');

    const eligibleBulkLoans = useMemo(
        () => loansEligibleForBranchRegeneration(loans, bulkBranchId),
        [loans, bulkBranchId]
    );

    const handleBulkBranchRegenerate = async () => {
        if (!bulkBranchId || eligibleBulkLoans.length === 0) return;
        setBulkRegenRunning(true);
        setBulkRegenProgress({ current: 0, total: eligibleBulkLoans.length });
        try {
            const result = await regenerateSchedulesForBranchLoans(supabase, loans, bulkBranchId, holidays, {
                onProgress: ({ current, total }) => setBulkRegenProgress({ current, total }),
            });
            await supabase.rpc('update_all_loan_statuses').catch(() => {});
            setBulkRegenDialogOpen(false);
            const preview = result.failed
                .slice(0, 5)
                .map((f) => f.loan_id)
                .join(', ');
            const failSuffix =
                result.failed.length > 0
                    ? ` ${result.failed.length} failed${preview ? `: ${preview}${result.failed.length > 5 ? '…' : ''}` : ''}.`
                    : '';
            toast({
                title: 'Bulk regeneration finished',
                description: `Updated ${result.succeeded} of ${result.total} loan(s).${failSuffix}`,
            });
            if (result.failed.length) {
                console.error('Bulk schedule regeneration failures', result.failed);
            }
            fetchData();
        } catch (e) {
            console.error(e);
            toast({
                title: 'Bulk regeneration failed',
                description: e?.message || String(e),
                variant: 'destructive',
            });
        } finally {
            setBulkRegenRunning(false);
            setBulkRegenProgress(null);
        }
    };
    
    if (loading) return <DashboardLayout title="Loans & Disbursements"><div className="flex items-center justify-center h-full">Loading...</div></DashboardLayout>;

    return (
        <DashboardLayout title="Loans & Disbursements">
            <div className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <StatCard title="Total Loans" value={stats.totalLoans} icon={Briefcase} color="text-blue-600" />
                    <StatCard title="Total Principal" value={`${currency} ${stats.totalPrincipal.toLocaleString()}`} icon={DollarSign} color="text-green-600" />
                    <StatCard title="Total Outstanding" value={`${currency} ${stats.totalBalance.toLocaleString()}`} icon={DollarSign} color="text-yellow-600" />
                    <StatCard title="Loans at Risk" value={stats.atRiskLoans} icon={AlertTriangle} color="text-red-600" />
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Bulk: regenerate schedules (current holidays)</CardTitle>
                        <CardDescription>
                            Same logic as a single loan: rebuild due dates from each loan’s terms and repayment start date using the{' '}
                            <strong>current</strong> holiday list, then reapply repayments. Only <strong>active</strong>,{' '}
                            <strong>delinquent</strong>, and <strong>defaulted</strong> loans whose officer is in the selected branch are included.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                        <div className="min-w-0 max-w-md space-y-2">
                            <Label htmlFor="bulk-branch-regen">Branch</Label>
                            <SearchableSelect
                                id="bulk-branch-regen"
                                value={bulkBranchId}
                                onValueChange={setBulkBranchId}
                                options={bulkBranchSelectOpts}
                                placeholder="Select branch"
                                searchPlaceholder="Search branches…"
                                emptyText="No branch found."
                                triggerClassName="w-full sm:w-[280px]"
                            />
                            <p className="text-sm text-muted-foreground">
                                {bulkBranchId
                                    ? `${eligibleBulkLoans.length} eligible loan(s) in this branch.`
                                    : 'Select a branch to see how many loans will be processed.'}
                            </p>
                        </div>
                        <div className="flex flex-col items-stretch gap-2 sm:items-end">
                            {bulkRegenProgress && (
                                <p className="text-sm text-muted-foreground">
                                    Processing {bulkRegenProgress.current} / {bulkRegenProgress.total}…
                                </p>
                            )}
                            <AlertDialog open={bulkRegenDialogOpen} onOpenChange={(open) => !bulkRegenRunning && setBulkRegenDialogOpen(open)}>
                                <AlertDialogTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="secondary"
                                        className="sm:min-w-[200px]"
                                        disabled={!bulkBranchId || eligibleBulkLoans.length === 0 || bulkRegenRunning}
                                    >
                                        {bulkRegenRunning ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <RefreshCw className="mr-2 h-4 w-4" />
                                        )}
                                        Run for branch
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Regenerate all schedules in this branch?</AlertDialogTitle>
                                        <AlertDialogDescription className="space-y-2 text-left">
                                            <span>
                                                This will rebuild repayment due dates for <strong>{eligibleBulkLoans.length}</strong> loan(s) using
                                                the current holiday list, then reapply recorded repayments for each loan.
                                            </span>
                                            <span className="block text-amber-700 dark:text-amber-500">
                                                Run after holidays change. Large branches may take a few minutes.
                                            </span>
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel disabled={bulkRegenRunning}>Cancel</AlertDialogCancel>
                                        <Button type="button" disabled={bulkRegenRunning} onClick={handleBulkBranchRegenerate}>
                                            {bulkRegenRunning ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                            Start
                                        </Button>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <div className="flex flex-col gap-4">
                            <CardTitle>Loans List</CardTitle>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8 gap-4">
                                <Input placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                                
                                <SearchableSelect
                                    value={branchFilter}
                                    onValueChange={(v) => {
                                        setBranchFilter(v);
                                        setOfficerFilter('all');
                                        setCenterFilter('all');
                                        setGroupFilter('all');
                                    }}
                                    options={loanListBranchOpts}
                                    allLabel="All Branches"
                                    allValue="all"
                                    placeholder="Filter by Branch"
                                    searchPlaceholder="Search branches…"
                                    emptyText="No branch found."
                                />

                                <SearchableSelect
                                    value={officerFilter}
                                    onValueChange={(v) => {
                                        setOfficerFilter(v);
                                        setCenterFilter('all');
                                        setGroupFilter('all');
                                    }}
                                    options={loanListOfficerOpts}
                                    allLabel="All Officers"
                                    allValue="all"
                                    placeholder="Filter by Officer"
                                    searchPlaceholder="Search officers…"
                                    emptyText="No officer found."
                                />

                                <SearchableSelect
                                    value={centerFilter}
                                    onValueChange={(v) => {
                                        setCenterFilter(v);
                                        setGroupFilter('all');
                                    }}
                                    disabled={officerFilter === 'all'}
                                    options={loanListCenterOpts}
                                    allLabel="All centers"
                                    allValue="all"
                                    placeholder={officerFilter === 'all' ? 'Select officer first' : 'Center'}
                                    searchPlaceholder="Search centers…"
                                    emptyText="No center found."
                                />

                                <SearchableSelect
                                    value={groupFilter}
                                    onValueChange={setGroupFilter}
                                    disabled={centerFilter === 'all'}
                                    options={loanListGroupOpts}
                                    allLabel="All groups"
                                    allValue="all"
                                    placeholder={centerFilter === 'all' ? 'Pick center first' : 'Group'}
                                    searchPlaceholder="Search groups…"
                                    emptyText="No group found."
                                />

                                <SearchableSelect
                                    value={statusFilter}
                                    onValueChange={setStatusFilter}
                                    options={LOAN_STATUS_FILTER_OPTIONS}
                                    allLabel="All Statuses"
                                    allValue="all"
                                    placeholder="Filter by Status"
                                    searchPlaceholder="Search status…"
                                    emptyText="No match."
                                />

                                <SearchableSelect
                                    value={productFilter}
                                    onValueChange={setProductFilter}
                                    options={loanListProductOpts}
                                    allLabel="All Products"
                                    allValue="all"
                                    placeholder="Filter by Product"
                                    searchPlaceholder="Search products…"
                                    emptyText="No product found."
                                />
                                
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant={"outline"} className="justify-start text-left font-normal">
                                            <CalendarIconLucide className="mr-2 h-4 w-4" />
                                            {dateRange?.from ? (
                                                dateRange.to ? (
                                                    <>{formatTZ(dateRange.from, "LLL dd, y", { timeZone: EAT_TIMEZONE })} - {formatTZ(dateRange.to, "LLL dd, y", { timeZone: EAT_TIMEZONE })}</>
                                                ) : (
                                                    formatTZ(dateRange.from, "LLL dd, y", { timeZone: EAT_TIMEZONE })
                                                )
                                            ) : (
                                                <span>Pick a date range</span>
                                            )}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0" align="start">
                                        <Calendar mode="range" selected={dateRange} onSelect={setDateRange} numberOfMonths={2} />
                                    </PopoverContent>
                                </Popover>
                            </div>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <BulkDataTableToolbar selectedCount={bulk.count} onClear={bulk.clear} onExportCsv={exportLoansCsv} />
                        <Table>
                            <TableHeader><TableRow><TableHead className="w-10"><Checkbox checked={bulk.allSelected ? true : bulk.count > 0 ? 'indeterminate' : false} onCheckedChange={() => bulk.toggleAll()} aria-label="Select page" /></TableHead><TableHead>Loan ID</TableHead><TableHead>Borrower</TableHead><TableHead>Officer</TableHead><TableHead>Principal</TableHead><TableHead>Balance</TableHead><TableHead>Disbursement</TableHead><TableHead>Status</TableHead><TableHead>Actions</TableHead></TableRow></TableHeader>
                            <TableBody>
                                {pagedLoans.map(l => (
                                    <TableRow key={l.id}>
                                        <TableCell><Checkbox checked={bulk.isSelected(l.id)} onCheckedChange={() => bulk.toggle(l.id)} aria-label={`Select ${l.loan_id}`} /></TableCell>
                                        <TableCell>{l.loan_id}</TableCell>
                                        <TableCell>{l.borrowers?.first_name} {l.borrowers?.surname}</TableCell>
                                        <TableCell>{l.officer?.full_name}</TableCell>
                                        <TableCell>{currency} {Number(l.principal).toLocaleString()}</TableCell>
                                        <TableCell>{currency} {Number(l.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                        <TableCell>{formatTZ(toZonedTime(new Date(l.disbursement_date), EAT_TIMEZONE), 'MMM dd, yyyy', { timeZone: EAT_TIMEZONE })}</TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Badge variant={getStatusBadge(l.status)}>{l.status.replace(/_/g, ' ')}</Badge>
                                            </div>
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <Button variant="outline" size="sm" onClick={() => viewSchedule(l)} className="flex items-center gap-2">
                                                    {isRefreshingSchedule && selectedLoan?.id === l.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Eye className="h-4 w-4"/>}
                                                    <span className="sr-only sm:not-sr-only">Schedule</span>
                                                </Button>
                                                <Button variant="ghost" size="sm" onClick={() => openStatusEdit(l)}>
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {filteredLoans.length === 0 && <TableRow><TableCell colSpan={9} className="text-center py-4">No loans found matching filters.</TableCell></TableRow>}
                            </TableBody>
                        </Table>
                        {filteredLoans.length > 0 && (
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t px-6 pb-4 pt-4">
                                <p className="text-sm text-neutral-600">
                                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredLoans.length)} of {filteredLoans.length}
                                </p>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <span className="text-sm text-neutral-600">Page {page} / {loanListTotalPages}</span>
                                    <Button variant="outline" size="sm" disabled={page >= loanListTotalPages} onClick={() => setPage((p) => Math.min(loanListTotalPages, p + 1))}>
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Schedule Dialog */}
            <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
                <DialogContent className={SCHEDULE_DIALOG_CONTENT}>
                    <DialogHeader className="shrink-0">
                        <DialogTitle>Repayment Schedule for {selectedLoan?.loan_id}</DialogTitle>
                        <DialogDescription>
                            Borrower: {selectedLoan?.borrowers?.first_name} {selectedLoan?.borrowers?.surname} <br/>
                            Total Payable: {currency} {(selectedLoan?.total_payable || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </DialogDescription>
                    </DialogHeader>
                    <div className={SCHEDULE_DIALOG_SCROLL}>
                    <RepaymentScheduleGrid
                      schedule={selectedLoan?.schedule}
                      currency={currency}
                      variant="simple"
                      exportMeta={
                        selectedLoan
                          ? scheduleExportMetaFromLoan(selectedLoan, currency, 'simple')
                          : undefined
                      }
                    />
                    </div>
                    <DialogFooter className="shrink-0 flex-col items-stretch gap-3 border-t pt-4 sm:flex-row sm:justify-between">
                        <p className="text-left text-xs text-muted-foreground max-w-xl">
                            After changing public holidays, open this for each affected loan: rebuilds due dates from this loan’s terms and repayment start date, then reapplies recorded repayments.
                        </p>
                        {selectedLoan && loanStatusAllowsScheduleRegeneration(selectedLoan.status) ? (
                            <AlertDialog open={regenConfirmOpen} onOpenChange={setRegenConfirmOpen}>
                                <AlertDialogTrigger asChild>
                                    <Button type="button" variant="secondary" disabled={isRegeneratingCalendar} className="shrink-0">
                                        {isRegeneratingCalendar ? (
                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                        ) : (
                                            <RefreshCw className="mr-2 h-4 w-4" />
                                        )}
                                        Regenerate schedule (current holidays)
                                    </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                    <AlertDialogHeader>
                                        <AlertDialogTitle>Regenerate repayment schedule?</AlertDialogTitle>
                                        <AlertDialogDescription className="text-left space-y-2">
                                            <span>
                                                This replaces installment due dates using the <strong>current</strong> holiday list and this loan’s stored repayment start date and terms. All recorded repayments are reapplied to the new schedule.
                                            </span>
                                            <span className="block text-amber-700 dark:text-amber-500">
                                                Use when holidays were added or changed — run per loan as needed.
                                            </span>
                                        </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                        <AlertDialogCancel disabled={isRegeneratingCalendar}>Cancel</AlertDialogCancel>
                                        <Button
                                            type="button"
                                            disabled={isRegeneratingCalendar}
                                            onClick={handleRegenerateScheduleFromHolidays}
                                        >
                                            {isRegeneratingCalendar ? (
                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                            ) : null}
                                            Confirm regenerate
                                        </Button>
                                    </AlertDialogFooter>
                                </AlertDialogContent>
                            </AlertDialog>
                        ) : selectedLoan ? (
                            <p className="text-xs text-muted-foreground shrink-0">Recalendar is only for active, delinquent, or defaulted loans.</p>
                        ) : null}
                    </DialogFooter>
                </DialogContent>
            </Dialog>

             {/* Status Edit Dialog */}
             <Dialog open={statusEditDialogOpen} onOpenChange={setStatusEditDialogOpen}>
                <DialogContent className="sm:max-w-[425px]">
                    <DialogHeader>
                        <DialogTitle>Edit Loan Status</DialogTitle>
                        <DialogDescription>
                            Manually change the status for Loan ID: <span className="font-semibold">{selectedLoan?.loan_id}</span>
                        </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-4">
                        <div className="grid grid-cols-4 items-center gap-4">
                            <Label htmlFor="status" className="text-right">
                                Status
                            </Label>
                            <Select value={newStatus} onValueChange={setNewStatus}>
                                <SelectTrigger className="col-span-3">
                                    <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="active">Active</SelectItem>
                                    <SelectItem value="paid">Paid</SelectItem>
                                    <SelectItem value="delinquent">Delinquent</SelectItem>
                                    <SelectItem value="defaulted">Defaulted</SelectItem>
                                    <SelectItem value="written_off">Written Off</SelectItem>
                                    <SelectItem value="pending_approval">Pending Approval</SelectItem>
                                    <SelectItem value="rejected">Rejected</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <DialogFooter>
                        <Button type="submit" onClick={handleUpdateStatus} disabled={isUpdatingStatus}>
                            {isUpdatingStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                            Update Status
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
};

export default AdminLoanManagement;
