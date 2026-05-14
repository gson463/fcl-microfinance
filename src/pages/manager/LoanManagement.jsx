import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkDataTableToolbar } from '@/components/ui/bulk-data-table-toolbar';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { RepaymentScheduleGrid } from '@/components/loans/RepaymentScheduleGrid';
import { scheduleExportMetaFromLoan } from '@/lib/scheduleExport';
import { SCHEDULE_DIALOG_CONTENT, SCHEDULE_DIALOG_SCROLL } from '@/lib/dialogLayout';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useToast } from '@/components/ui/use-toast';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Eye, Briefcase, DollarSign, AlertTriangle, Calendar as CalendarIconLucide, Loader2, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import { borrowerMatchesCenter, borrowerMatchesGroup } from '@/lib/loanBorrowerLocationFilter';
import { LOAN_STATUS_FILTER_OPTIONS, loanStatusLabel, loanStatusBadgeVariant } from '@/lib/domainStatuses';
import { useUserProfileScope } from '@/hooks/useUserProfileScope';

const EAT_TIMEZONE = 'Africa/Nairobi';
const LOAN_BORROWER_SELECT = `*, borrowers(*, groups(id, name, center_id), branches(name)), loan_products(name)`;
const PAGE_SIZE = 25;

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

const ManagerLoanManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const { loading: profileLoading, branchId: profileBranchId } = useUserProfileScope(user?.id);
    const managerBranchId = profileBranchId ?? user?.user_metadata?.branch_id;
    const [loans, setLoans] = useState([]);
    const [officers, setOfficers] = useState([]);
    const [loanProducts, setLoanProducts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState(null);
    const [isRefreshingSchedule, setIsRefreshingSchedule] = useState(false);
    const [currency, setCurrency] = useState('TZS');
    
    const [searchQuery, setSearchQuery] = useState('');
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
        if (!user || profileLoading) return;
        if (!managerBranchId) {
            setLoans([]);
            setOfficers([]);
            setLoading(false);
            return;
        }
        setLoading(true);

        const { data: cfgRows } = await supabase.from('system_config').select('key, value').in('key', ['currency', 'systemName']);
        const cfg = Object.fromEntries((cfgRows || []).map((r) => [r.key, r.value]));
        if (cfg.currency) setCurrency(cfg.currency);

        // Fetch Officers in Branch
        const { data: officersData, error: officersError } = await supabase
            .from('users')
            .select('id, full_name')
            .eq('branch_id', managerBranchId)
            .eq('role', 'officer');
            
        if (officersError) {
             toast({ title: 'Error fetching officers', description: officersError.message, variant: 'destructive' });
             setLoading(false);
             return;
        }
        setOfficers(officersData || []);
        
        const officerIds = officersData.map(o => o.id);

        if (officerIds.length === 0) {
            setLoans([]);
            setLoading(false);
            return;
        }

        // Fetch Loans for Branch Officers
        const { data: loansData, error: loansError } = await supabase
            .from('loans')
            .select(
                `${LOAN_BORROWER_SELECT}, officer:users!officer_id ( full_name )`
            )
            .in('officer_id', officerIds);

        // Fetch Products
        const { data: productsData, error: productsError } = await supabase.from('loan_products').select('*');
        
        if (loansError || productsError) {
            toast({ title: 'Error fetching data', description: loansError?.message || productsError?.message, variant: 'destructive' });
        } else {
            setLoans(loansData || []);
            setLoanProducts(productsData || []);
        }
        setLoading(false);
    }, [user, toast, profileLoading, managerBranchId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (officerFilter === 'all') {
            setCenterFilter('all');
            setGroupFilter('all');
        }
    }, [officerFilter]);

    useEffect(() => {
        let cancelled = false;
        if (officerFilter === 'all' || !managerBranchId) {
            setCenters([]);
            return;
        }
        (async () => {
            const { data } = await supabase
                .from('centers')
                .select('id, name')
                .eq('loan_officer_id', officerFilter)
                .eq('branch_id', managerBranchId)
                .order('name');
            if (!cancelled) setCenters(data || []);
        })();
        return () => {
            cancelled = true;
        };
    }, [officerFilter, managerBranchId]);

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

    const mgrLoanOfficerOpts = useMemo(() => officers.map((o) => ({ value: o.id, label: o.full_name })), [officers]);
    const mgrLoanCenterOpts = useMemo(() => centers.map((c) => ({ value: c.id, label: c.name })), [centers]);
    const mgrLoanGroupOpts = useMemo(() => groups.map((g) => ({ value: g.id, label: g.name })), [groups]);
    const mgrLoanProductOpts = useMemo(() => loanProducts.map((p) => ({ value: p.id, label: p.name })), [loanProducts]);

    const filteredLoans = useMemo(() => {
        return loans.filter(loan => {
            const borrowerName = `${loan.borrowers?.first_name || ''} ${loan.borrowers?.surname || ''}`.toLowerCase();
            const query = searchQuery.toLowerCase();
            const matchesSearch = loan.loan_id.toLowerCase().includes(query) || borrowerName.includes(query) || loan.principal.toString().includes(query);
            const matchesStatus = statusFilter === 'all' || loan.status === statusFilter;
            const matchesProduct = productFilter === 'all' || loan.product_id === productFilter;
            const matchesOfficer = officerFilter === 'all' || loan.officer_id === officerFilter;
            const matchesCenter = borrowerMatchesCenter(loan.borrowers, centerFilter);
            const matchesGroup = borrowerMatchesGroup(loan.borrowers, groupFilter);
            
            let matchesDate = true;
            if (dateRange.from && dateRange.to) {
                const loanDate = toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE);
                matchesDate = loanDate >= toZonedTime(dateRange.from, EAT_TIMEZONE) && loanDate <= toZonedTime(dateRange.to, EAT_TIMEZONE);
            } else if (dateRange.from) {
                matchesDate = toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE) >= toZonedTime(dateRange.from, EAT_TIMEZONE);
            }

            return matchesSearch && matchesStatus && matchesProduct && matchesOfficer && matchesCenter && matchesGroup && matchesDate;
        });
    }, [loans, searchQuery, statusFilter, productFilter, officerFilter, centerFilter, groupFilter, dateRange]);

    useEffect(() => {
        setPage(1);
    }, [searchQuery, statusFilter, productFilter, officerFilter, centerFilter, groupFilter, dateRange]);

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
                .select(LOAN_BORROWER_SELECT)
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
                        <div className="flex flex-col gap-4">
                            <CardTitle>Loans List</CardTitle>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-4">
                                <Input placeholder="Search..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                                <SearchableSelect
                                    value={officerFilter}
                                    onValueChange={(v) => {
                                        setOfficerFilter(v);
                                        setCenterFilter('all');
                                        setGroupFilter('all');
                                    }}
                                    options={mgrLoanOfficerOpts}
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
                                    options={mgrLoanCenterOpts}
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
                                    options={mgrLoanGroupOpts}
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
                                    options={mgrLoanProductOpts}
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
                                        <TableCell><Badge variant={loanStatusBadgeVariant(l.status)}>{loanStatusLabel(l.status)}</Badge></TableCell>
                                        <TableCell>
                                            <Button variant="outline" size="sm" onClick={() => viewSchedule(l)} className="flex items-center gap-2">
                                                {isRefreshingSchedule && selectedLoan?.id === l.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Eye className="h-4 w-4"/>}
                                                Schedule
                                            </Button>
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
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
};

export default ManagerLoanManagement;