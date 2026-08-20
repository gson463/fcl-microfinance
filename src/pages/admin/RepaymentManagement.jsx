import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { format as formatTZ, toZonedTime } from 'date-fns-tz';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, TableFooter } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkDataTableToolbar } from '@/components/ui/bulk-data-table-toolbar';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Input } from '@/components/ui/input';
import { Calendar as CalendarIcon, Loader2, FileDown, Eye, ArrowRightLeft, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { RepaymentScheduleGrid } from '@/components/loans/RepaymentScheduleGrid';
import { scheduleExportMetaFromLoan } from '@/lib/scheduleExport';
import { SCHEDULE_DIALOG_CONTENT, SCHEDULE_DIALOG_SCROLL } from '@/lib/dialogLayout';
import { borrowerStatusLabel, borrowerStatusBadgeVariant } from '@/lib/borrowerStatusDisplay';
import { BORROWER_STATUS_FILTER_OPTIONS } from '@/lib/domainStatuses';
import { cn } from '@/lib/utils';
import {
    REPAYMENT_PAGE_SIZE,
    defaultRepaymentDateRange,
    fetchRepaymentPage,
    fetchRepaymentStats,
    aggregateRepaymentStats,
    fetchAllFilteredRepayments,
    isTodayRepaymentDateRange,
} from '@/lib/repaymentManagementQuery';
import { KpiStatCard, KpiMoneyValue } from '@/components/ui/kpi-stat-card';

const EAT_TIMEZONE = 'Africa/Nairobi';
const PAGE_SIZE = REPAYMENT_PAGE_SIZE;

const AdminRepaymentManagement = () => {
    const { toast } = useToast();
    const [repayments, setRepayments] = useState([]);
    const [totalRepaymentCount, setTotalRepaymentCount] = useState(0);
    const [statsBase, setStatsBase] = useState(null);
    const [branches, setBranches] = useState([]);
    const [centers, setCenters] = useState([]);
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [listLoading, setListLoading] = useState(false);
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [currency, setCurrency] = useState('TZS');

    // Filters
    const [branchFilter, setBranchFilter] = useState('all');
    const [officerFilter, setOfficerFilter] = useState('all');
    const [centerFilter, setCenterFilter] = useState('all');
    const [borrowerStatusFilter, setBorrowerStatusFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [dateRangeFilter, setDateRangeFilter] = useState(() => defaultRepaymentDateRange());
    const [includeClosedLoans, setIncludeClosedLoans] = useState(false);
    const [page, setPage] = useState(1);

    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [selectedLoanForSchedule, setSelectedLoanForSchedule] = useState(null);

    const resetFilters = () => {
        setBranchFilter('all');
        setOfficerFilter('all');
        setCenterFilter('all');
        setBorrowerStatusFilter('all');
        setSearchTerm('');
        setDateRangeFilter(defaultRepaymentDateRange());
        setIncludeClosedLoans(false);
        setPage(1);
    };

    const scopedOfficerIds = useMemo(() => {
        if (officerFilter !== 'all') return undefined;
        if (branchFilter === 'all') return null;
        return users
            .filter((u) => u.role === 'officer' && u.branch_id === branchFilter)
            .map((u) => u.id);
    }, [users, branchFilter, officerFilter]);

    const listFilters = useMemo(
        () => ({
            officerFilter: officerFilter !== 'all' ? officerFilter : undefined,
            officerIds: scopedOfficerIds,
            dateRange: dateRangeFilter,
            centerFilter,
            borrowerStatusFilter,
            searchTerm: debouncedSearchTerm,
            activePortfolioOnly: !includeClosedLoans && !isTodayRepaymentDateRange(dateRangeFilter),
        }),
        [
            officerFilter,
            scopedOfficerIds,
            dateRangeFilter,
            centerFilter,
            borrowerStatusFilter,
            debouncedSearchTerm,
            includeClosedLoans,
        ],
    );

    const showActivePortfolioBanner =
        !includeClosedLoans && !isTodayRepaymentDateRange(dateRangeFilter);

    const fetchMetadata = useCallback(async () => {
        setLoading(true);
        try {
            const [cfgRes, branchesRes, usersRes, centersRes] = await Promise.all([
                supabase.from('system_config').select('key, value').in('key', ['currency', 'systemName']),
                supabase.from('branches').select('id, name'),
                supabase.from('users').select('id, full_name, branch_id, role'),
                supabase.from('centers').select('id, name, branch_id').order('name'),
            ]);
            if (cfgRes.error) throw cfgRes.error;
            if (branchesRes.error) throw branchesRes.error;
            if (usersRes.error) throw usersRes.error;
            if (centersRes.error) throw centersRes.error;

            const cfg = Object.fromEntries((cfgRes.data || []).map((r) => [r.key, r.value]));
            if (cfg.currency) setCurrency(cfg.currency);
            setBranches(branchesRes.data || []);
            setUsers(usersRes.data || []);
            setCenters(centersRes.data || []);
        } catch (error) {
            toast({ title: 'Error fetching data', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [toast]);

    const fetchRepaymentList = useCallback(async () => {
        setListLoading(true);
        try {
            const searchScope =
                officerFilter !== 'all'
                    ? { singleOfficerId: officerFilter }
                    : scopedOfficerIds?.length
                      ? { officerIds: scopedOfficerIds }
                      : {};
            const filtersWithScope = { ...listFilters, ...searchScope };
            const [pageResult, statsData] = await Promise.all([
                fetchRepaymentPage({ supabase, filters: filtersWithScope, page }),
                fetchRepaymentStats({ supabase, filters: filtersWithScope }),
            ]);
            setRepayments(pageResult.rows);
            setTotalRepaymentCount(pageResult.totalCount);
            setStatsBase(statsData);
        } catch (error) {
            toast({ title: 'Error fetching repayments', description: error.message, variant: 'destructive' });
        } finally {
            setListLoading(false);
        }
    }, [listFilters, page, officerFilter, scopedOfficerIds, toast]);

    useEffect(() => {
        fetchMetadata();
    }, [fetchMetadata]);

    useEffect(() => {
        if (loading) return;
        fetchRepaymentList();
    }, [fetchRepaymentList, loading]);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 350);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    useEffect(() => {
        setPage(1);
    }, [branchFilter, officerFilter, centerFilter, borrowerStatusFilter, dateRangeFilter, debouncedSearchTerm, includeClosedLoans]);

    const filteredOfficers = useMemo(() => {
        const officers = users.filter(u => u.role === 'officer');
        if (branchFilter === 'all') return officers;
        return officers.filter(u => u.branch_id === branchFilter);
    }, [users, branchFilter]);

    const centersForFilter = useMemo(() => {
        if (branchFilter === 'all') return centers;
        return centers.filter((c) => c.branch_id === branchFilter);
    }, [centers, branchFilter]);

    const repBranchOpts = useMemo(() => branches.map((b) => ({ value: b.id, label: b.name })), [branches]);
    const repOfficerOpts = useMemo(() => filteredOfficers.map((o) => ({ value: o.id, label: o.full_name })), [filteredOfficers]);
    const repCenterOpts = useMemo(
        () =>
            centersForFilter.map((c) => ({
                value: c.id,
                label:
                    branchFilter === 'all'
                        ? `${c.name} (${branches.find((b) => b.id === c.branch_id)?.name ?? '—'})`
                        : c.name,
            })),
        [centersForFilter, branchFilter, branches],
    );

    const pagedRepayments = repayments;
    const totalPages = Math.max(1, Math.ceil(totalRepaymentCount / PAGE_SIZE));

    const stats = useMemo(() => aggregateRepaymentStats(statsBase), [statsBase]);

    const pageRepaymentIds = useMemo(() => repayments.map((r) => r.id), [repayments]);
    const bulk = useBulkSelection(pageRepaymentIds);

    useEffect(() => {
        bulk.clear();
    }, [repayments]); // eslint-disable-line react-hooks/exhaustive-deps

    const exportSelectedRepaymentsCsv = () => {
        const rows = repayments.filter((r) => bulk.isSelected(r.id));
        if (rows.length === 0) {
            toast({ title: 'Nothing selected', description: 'Select one or more repayments first.', variant: 'destructive' });
            return;
        }
        exportObjectsToCsv(`repayments_${Date.now()}.csv`, [
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
            {
                header: 'Branch',
                accessor: (r) => {
                    const officer = users.find((u) => u.id === r.officer_id);
                    return branches.find((b) => b.id === officer?.branch_id)?.name || '';
                },
            },
            {
                header: 'Loan Officer',
                accessor: (r) => users.find((u) => u.id === r.officer_id)?.full_name || '',
            },
            { header: 'Principal Paid', accessor: (r) => String(r.principal_paid ?? '') },
            { header: 'Interest Paid', accessor: (r) => String(r.interest_paid ?? '') },
            { header: 'Total Paid', accessor: (r) => String(r.amount ?? '') },
        ], rows);
        toast({ title: 'Exported', description: `${rows.length} repayment(s) to CSV.` });
    };

    const handleViewSchedule = async (loan) => {
        const { data: latestLoanData, error } = await supabase
            .from('loans')
            .select(`*, loan_products(name), borrowers(*, groups(name), branches(name))`)
            .eq('id', loan.id)
            .single();
        if (error) {
             toast({ title: 'Error', description: 'Could not fetch latest schedule.', variant: 'destructive' });
             return;
        }
        setSelectedLoanForSchedule(latestLoanData);
        setScheduleDialogOpen(true);
    };

    const handleExport = async () => {
        try {
            const searchScope =
                officerFilter !== 'all'
                    ? { singleOfficerId: officerFilter }
                    : scopedOfficerIds?.length
                      ? { officerIds: scopedOfficerIds }
                      : {};
            const rows = await fetchAllFilteredRepayments({
                supabase,
                filters: { ...listFilters, ...searchScope },
            });
            const dataToExport = rows.map((r) => {
                const officer = users.find((u) => u.id === r.officer_id);
                const branch = branches.find((b) => b.id === officer?.branch_id);
                return {
                    'Payment Date': formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'yyyy-MM-dd'),
                    Borrower: `${r.loans?.borrowers?.first_name} ${r.loans?.borrowers?.surname}`,
                    'Loan ID': r.loans?.loan_id,
                    Branch: branch?.name || 'N/A',
                    'Loan Officer': officer?.full_name || 'N/A',
                    'Principal Paid': r.principal_paid || 0,
                    'Interest Paid': r.interest_paid || 0,
                    'Total Paid': r.amount,
                };
            });
            const ws = XLSX.utils.json_to_sheet(dataToExport);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Repayments');
            XLSX.writeFile(wb, 'repayment_history_full.xlsx');
        } catch (error) {
            toast({ title: 'Export failed', description: error.message, variant: 'destructive' });
        }
    };

    if (loading) return <DashboardLayout title="Collections"><Loader2 className="h-8 w-8 animate-spin mx-auto mt-8" /></DashboardLayout>;

    return (
        <DashboardLayout title="Collections">
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Repayment Overview</CardTitle>
                        <CardDescription>System-wide summary of repayments based on selected filters.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
                            <KpiStatCard title="Total Repayments (Filtered)" icon={ArrowRightLeft} iconClassName="text-blue-500">
                                <KpiMoneyValue currency={currency} amount={stats.totalPaid} />
                            </KpiStatCard>
                            <KpiStatCard title="Interest Collected" icon={TrendingUp} iconClassName="text-green-500">
                                <KpiMoneyValue currency={currency} amount={stats.totalInterest} />
                            </KpiStatCard>
                            <KpiStatCard title="Principal Repaid" icon={TrendingDown} iconClassName="text-orange-500">
                                <KpiMoneyValue currency={currency} amount={stats.totalPrincipalPaid} />
                            </KpiStatCard>
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
                                placeholder="Search loan ID, borrower name, borrower ID…"
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-8 w-[280px]"
                            />
                        </div>
                        <SearchableSelect
                            value={branchFilter}
                            onValueChange={(value) => {
                                setBranchFilter(value);
                                setOfficerFilter('all');
                                setCenterFilter('all');
                            }}
                            options={repBranchOpts}
                            allLabel="All Branches"
                            allValue="all"
                            placeholder="Filter by Branch..."
                            searchPlaceholder="Search branches…"
                            emptyText="No branch found."
                            triggerClassName="w-[240px]"
                        />
                        <SearchableSelect
                            value={officerFilter}
                            onValueChange={setOfficerFilter}
                            options={repOfficerOpts}
                            allLabel="All Users"
                            allValue="all"
                            placeholder="Filter by User..."
                            searchPlaceholder="Search officers…"
                            emptyText="No officer found."
                            triggerClassName="w-[240px]"
                        />
                        <SearchableSelect
                            value={centerFilter}
                            onValueChange={setCenterFilter}
                            options={repCenterOpts}
                            allLabel="All centers"
                            allValue="all"
                            placeholder="Center"
                            searchPlaceholder="Search centers…"
                            emptyText="No center found."
                            triggerClassName="w-[220px]"
                        />
                        <SearchableSelect
                            value={borrowerStatusFilter}
                            onValueChange={setBorrowerStatusFilter}
                            options={BORROWER_STATUS_FILTER_OPTIONS}
                            allLabel="All borrower statuses"
                            allValue="all"
                            placeholder="Borrower status"
                            searchPlaceholder="Search status…"
                            emptyText="No match."
                            triggerClassName="w-[240px]"
                        />
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="outline" className="w-[280px] justify-start text-left font-normal">
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {dateRangeFilter?.from
                                        ? dateRangeFilter.to &&
                                          format(dateRangeFilter.from, 'yyyy-MM-dd') !==
                                              format(dateRangeFilter.to, 'yyyy-MM-dd')
                                            ? `${format(dateRangeFilter.from, 'LLL dd, y')} - ${format(dateRangeFilter.to, 'LLL dd, y')}`
                                            : format(dateRangeFilter.from, 'LLL dd, y')
                                        : 'Pick a date range'}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    mode="range"
                                    selected={dateRangeFilter}
                                    onSelect={setDateRangeFilter}
                                    numberOfMonths={2}
                                />
                            </PopoverContent>
                        </Popover>
                        <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <Checkbox
                                checked={includeClosedLoans}
                                onCheckedChange={(v) => setIncludeClosedLoans(Boolean(v))}
                            />
                            Include closed loans
                        </label>
                        <Button onClick={resetFilters} variant="ghost">Reset</Button>
                    </CardContent>
                </Card>

                {showActivePortfolioBanner && (
                    <p className="text-sm text-muted-foreground rounded-md border border-dashed px-4 py-2">
                        Showing active portfolio only. Toggle &quot;Include closed loans&quot; to include fully paid loans.
                    </p>
                )}

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle>Repayment History</CardTitle>
                        <Button onClick={handleExport}><FileDown className="mr-2 h-4 w-4" /> Export</Button>
                    </CardHeader>
                    <CardContent className={cn(listLoading && 'opacity-60 pointer-events-none')}>
                        {listLoading && (
                            <div className="flex justify-center py-2">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        )}
                        <BulkDataTableToolbar
                            selectedCount={bulk.count}
                            onClear={bulk.clear}
                            onExportCsv={exportSelectedRepaymentsCsv}
                        />
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-10">
                                        <Checkbox
                                            checked={bulk.allSelected ? true : bulk.count > 0 ? 'indeterminate' : false}
                                            onCheckedChange={() => bulk.toggleAll()}
                                            aria-label="Select all filtered"
                                        />
                                    </TableHead>
                                    <TableHead>Payment Date</TableHead>
                                    <TableHead>Borrower</TableHead>
                                    <TableHead>Borrower status</TableHead>
                                    <TableHead>Branch</TableHead>
                                    <TableHead>Loan Officer</TableHead>
                                    <TableHead>Principal Paid</TableHead>
                                    <TableHead>Interest Paid</TableHead>
                                    <TableHead>Total Paid</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pagedRepayments.map(r => {
                                    const officer = users.find(u => u.id === r.officer_id);
                                    const branch = branches.find(b => b.id === officer?.branch_id);
                                    return (
                                    <TableRow key={r.id}>
                                        <TableCell>
                                            <Checkbox
                                                checked={bulk.isSelected(r.id)}
                                                onCheckedChange={() => bulk.toggle(r.id)}
                                                aria-label="Select row"
                                            />
                                        </TableCell>
                                        <TableCell>{formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'MMM dd, yyyy')}</TableCell>
                                        <TableCell>{r.loans?.borrowers?.first_name} {r.loans?.borrowers?.surname}</TableCell>
                                        <TableCell>
                                            {r.loans?.borrowers?.status ? (
                                                <Badge variant={borrowerStatusBadgeVariant(r.loans.borrowers.status)} className="font-normal">
                                                    {borrowerStatusLabel(r.loans.borrowers.status)}
                                                </Badge>
                                            ) : (
                                                '—'
                                            )}
                                        </TableCell>
                                        <TableCell>{branch?.name || 'N/A'}</TableCell>
                                        <TableCell>{officer?.full_name || 'N/A'}</TableCell>
                                        <TableCell>{currency} {(r.principal_paid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell>{currency} {(r.interest_paid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell className="font-semibold">{currency} {r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="icon" onClick={() => handleViewSchedule(r.loans)}><Eye className="h-4 w-4" /></Button>
                                        </TableCell>
                                    </TableRow>
                                )})}
                                {totalRepaymentCount === 0 && !listLoading && (
                                    <TableRow>
                                        <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">No repayments match the current filters.</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                            <TableFooter>
                                <TableRow>
                                    <TableCell colSpan={6} className="font-bold text-right">Totals</TableCell>
                                    <TableCell className="font-bold">{currency} {stats.totalPrincipalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell className="font-bold">{currency} {stats.totalInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell className="font-bold" colSpan={2}>{currency} {stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                </TableRow>
                            </TableFooter>
                        </Table>
                        {totalRepaymentCount > 0 && (
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                                <p className="text-sm text-muted-foreground">
                                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalRepaymentCount)} of {totalRepaymentCount}
                                    {isTodayRepaymentDateRange(dateRangeFilter) ? ' (today by default)' : ''}
                                </p>
                                <div className="flex items-center gap-2">
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={page <= 1}
                                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                                    >
                                        <ChevronLeft className="h-4 w-4" />
                                    </Button>
                                    <span className="text-sm text-muted-foreground">Page {page} / {totalPages}</span>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={page >= totalPages}
                                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                                    >
                                        <ChevronRight className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
            
            <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
              <DialogContent className={SCHEDULE_DIALOG_CONTENT}>
                <DialogHeader className="shrink-0">
                    <DialogTitle>Repayment Schedule for {selectedLoanForSchedule?.loan_id}</DialogTitle>
                    <DialogDescription>
                        Borrower: {selectedLoanForSchedule?.borrowers?.first_name} {selectedLoanForSchedule?.borrowers?.surname} <br/>
                        Total Payable: {currency} {(selectedLoanForSchedule?.total_payable || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </DialogDescription>
                </DialogHeader>
                {selectedLoanForSchedule && (
                    <div className={SCHEDULE_DIALOG_SCROLL}>
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
                    </div>
                )}
              </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
};

export default AdminRepaymentManagement;