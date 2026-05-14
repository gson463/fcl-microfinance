import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { format } from 'date-fns';
import { format as formatTZ, toZonedTime } from 'date-fns-tz';
import { startOfDay, endOfDay } from 'date-fns';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
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
import { Calendar as CalendarIcon, Loader2, FileDown, Eye, ArrowRightLeft, TrendingDown, Scale, ChevronLeft, ChevronRight, CheckCircle, XCircle, Search } from 'lucide-react';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { RepaymentScheduleGrid } from '@/components/loans/RepaymentScheduleGrid';
import { scheduleExportMetaFromLoan } from '@/lib/scheduleExport';
import { SCHEDULE_DIALOG_CONTENT, SCHEDULE_DIALOG_SCROLL } from '@/lib/dialogLayout';
import { borrowerMatchesCenter, borrowerMatchesGroup } from '@/lib/loanBorrowerLocationFilter';
import { borrowerStatusLabel, borrowerStatusBadgeVariant } from '@/lib/borrowerStatusDisplay';
import { useUserProfileScope } from '@/hooks/useUserProfileScope';

const EAT_TIMEZONE = 'Africa/Nairobi';
const PAGE_SIZE = 25;

const BORROWER_STATUS_FILTER_OPTIONS = [
	{ value: 'eligible', label: 'Eligible' },
	{ value: 'pending', label: 'Pending re-loan (manager)' },
	{ value: 'active_loan', label: 'Active loan' },
	{ value: 'defaulted', label: 'Defaulted' },
	{ value: 'paid_up', label: 'Paid' },
];

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

const ManagerRepaymentManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const { loading: profileLoading, branchId: profileBranchId } = useUserProfileScope(user?.id);
    const managerBranchId = profileBranchId ?? user?.user_metadata?.branch_id;
    const [repayments, setRepayments] = useState([]);
    const [branchOfficers, setBranchOfficers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [centers, setCenters] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currency, setCurrency] = useState('TZS');

    // Filters
    const [officerFilter, setOfficerFilter] = useState('all');
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [borrowerStatusFilter, setBorrowerStatusFilter] = useState('all');
    const [searchTerm, setSearchTerm] = useState('');
    const [dateRangeFilter, setDateRangeFilter] = useState(null);
    const [page, setPage] = useState(1);

    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [selectedLoanForSchedule, setSelectedLoanForSchedule] = useState(null);
    const [pendingRepaymentDeletes, setPendingRepaymentDeletes] = useState([]);

    const resetFilters = () => {
        setOfficerFilter('all');
        setCenterFilter('all');
        setGroupFilter('all');
        setBorrowerStatusFilter('all');
        setSearchTerm('');
        setDateRangeFilter(null);
        setPage(1);
    };

    const fetchData = useCallback(async () => {
        if (!user || profileLoading) return;
        if (!managerBranchId) {
            setRepayments([]);
            setBranchOfficers([]);
            setCenters([]);
            setGroups([]);
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const { data: cfgRows } = await supabase.from('system_config').select('key, value').in('key', ['currency', 'systemName']);
            const cfg = Object.fromEntries((cfgRows || []).map((r) => [r.key, r.value]));
            if (cfg.currency) setCurrency(cfg.currency);

            const { data: officersData, error: officersError } = await supabase
                .from('users')
                .select('id, full_name')
                .eq('branch_id', managerBranchId)
                .eq('role', 'officer');
            if (officersError) throw officersError;
            setBranchOfficers(officersData || []);

            const officerIds = officersData.map(o => o.id);

            const { data: pendingReqRows } = await supabase
                .from('repayment_delete_requests')
                .select('id, repayment_id, loan_id, officer_id, requested_at, snapshot')
                .eq('status', 'pending');

            const repIds = (pendingReqRows || []).map((x) => x.repayment_id);
            let mergedPending = [];
            if (repIds.length > 0) {
                const { data: repRows } = await supabase
                    .from('repayments')
                    .select('*, loans(loan_id, borrowers(first_name, surname))')
                    .in('id', repIds);
                mergedPending = (pendingReqRows || [])
                    .map((req) => ({
                        ...req,
                        repayment: (repRows || []).find((r) => r.id === req.repayment_id),
                    }))
                    .filter((x) => x.repayment && officerIds.includes(x.repayment.officer_id));
            }
            setPendingRepaymentDeletes(mergedPending);

            let { data: repaymentsData, error: repaymentsError } = await supabase
                .from('repayments')
                .select('*, loans(id, borrower_id, schedule, loan_id, borrowers(*, groups(*)))')
                .in('officer_id', officerIds)
                .order('actual_payment_date', { ascending: false });
            if (repaymentsError) throw repaymentsError;
            setRepayments(repaymentsData || []);

            const { data: groupsData, error: groupsError } = await supabase.from('groups').select('*').in('loan_officer_id', officerIds);
            if (groupsError) throw groupsError;
            setGroups(groupsData || []);

            const { data: centersData, error: centersError } = await supabase
                .from('centers')
                .select('id, name')
                .eq('branch_id', managerBranchId)
                .order('name');
            if (centersError) throw centersError;
            setCenters(centersData || []);

        } catch (error) {
            toast({ title: 'Error fetching data', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user, toast, profileLoading, managerBranchId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        if (centerFilter === 'all') {
            setGroupFilter('all');
        }
    }, [centerFilter]);

    const groupsForFilter = useMemo(() => {
        if (centerFilter === 'all') return [];
        return groups.filter((g) => g.center_id === centerFilter);
    }, [groups, centerFilter]);

    const mgrRepOfficerOpts = useMemo(() => branchOfficers.map((o) => ({ value: o.id, label: o.full_name })), [branchOfficers]);
    const mgrRepCenterOpts = useMemo(() => centers.map((c) => ({ value: c.id, label: c.name })), [centers]);
    const mgrRepGroupOpts = useMemo(() => groupsForFilter.map((g) => ({ value: g.id, label: g.name })), [groupsForFilter]);

    const filteredRepayments = useMemo(() => {
        return repayments.filter(r => {
            const borrowerRow = r.loans?.borrowers;
            const officerMatch = officerFilter === 'all' || r.officer_id === officerFilter;
            const centerMatch = borrowerMatchesCenter(borrowerRow, centerFilter);
            const groupMatch = borrowerMatchesGroup(borrowerRow, groupFilter);
            const statusMatch =
                borrowerStatusFilter === 'all' || borrowerRow?.status === borrowerStatusFilter;
            const dateMatch = !dateRangeFilter?.from || (
                new Date(r.actual_payment_date) >= startOfDay(dateRangeFilter.from) &&
                new Date(r.actual_payment_date) <= endOfDay(dateRangeFilter.to || dateRangeFilter.from)
            );

            const searchLower = searchTerm.toLowerCase();
            const loanId = r.loans?.loan_id?.toLowerCase() || '';
            const fName = borrowerRow?.first_name?.toLowerCase() || '';
            const sName = borrowerRow?.surname?.toLowerCase() || '';
            const borrowerName = `${fName} ${sName}`;
            const borrowerId = borrowerRow?.borrower_id?.toLowerCase() || '';
            const searchMatch =
                !searchTerm ||
                loanId.includes(searchLower) ||
                borrowerName.includes(searchLower) ||
                borrowerId.includes(searchLower);

            return officerMatch && centerMatch && groupMatch && statusMatch && dateMatch && searchMatch;
        });
    }, [repayments, officerFilter, centerFilter, groupFilter, borrowerStatusFilter, dateRangeFilter, searchTerm]);

    useEffect(() => {
        setPage(1);
    }, [officerFilter, centerFilter, groupFilter, borrowerStatusFilter, dateRangeFilter, searchTerm]);

    const pagedRepayments = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredRepayments.slice(start, start + PAGE_SIZE);
    }, [filteredRepayments, page]);

    const totalPages = Math.max(1, Math.ceil(filteredRepayments.length / PAGE_SIZE));

    const filteredRepaymentIds = useMemo(() => filteredRepayments.map((r) => r.id), [filteredRepayments]);
    const bulk = useBulkSelection(filteredRepaymentIds);

    const exportSelectedRepaymentsCsv = () => {
        const rows = filteredRepayments.filter((r) => bulk.isSelected(r.id));
        if (rows.length === 0) {
            toast({
                title: 'Nothing selected',
                description: 'Select one or more repayments first.',
                variant: 'destructive',
            });
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
            { header: 'Group', accessor: (r) => r.loans?.borrowers?.groups?.name || 'N/A' },
            {
                header: 'Loan Officer',
                accessor: (r) => branchOfficers.find((o) => o.id === r.officer_id)?.full_name || '',
            },
            { header: 'Principal Paid', accessor: (r) => String(r.principal_paid ?? '') },
            { header: 'Total Paid', accessor: (r) => String(r.amount ?? '') },
        ], rows);
        toast({ title: 'Exported', description: `${rows.length} repayment(s) to CSV.` });
    };

    const stats = useMemo(() => {
        const totalPaid = filteredRepayments.reduce((sum, r) => sum + r.amount, 0);
        const totalPrincipalPaid = filteredRepayments.reduce((sum, r) => sum + (r.principal_paid || 0), 0);
        return { totalPaid, totalPrincipalPaid };
    }, [filteredRepayments]);

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

    const handleApproveRepaymentDelete = async (req) => {
        const r = req.repayment;
        if (!r) {
            toast({ title: 'Error', description: 'Repayment data missing.', variant: 'destructive' });
            return;
        }
        const loanPublicId = r.loans?.loan_id;
        const borrowerName =
            r.loans?.borrowers?.first_name != null || r.loans?.borrowers?.surname != null
                ? `${r.loans.borrowers.first_name || ''} ${r.loans.borrowers.surname || ''}`.trim()
                : '';
        const officerName = branchOfficers.find((o) => o.id === r.officer_id)?.full_name || null;
        try {
            const { error: insErr } = await supabase.from('deleted_repayment_records').insert({
                original_repayment_id: r.id,
                loan_id: r.loan_id,
                loan_public_id: loanPublicId,
                borrower_name: borrowerName || null,
                amount: r.amount,
                principal_paid: r.principal_paid,
                interest_paid: r.interest_paid,
                payment_date: r.payment_date,
                actual_payment_date: r.actual_payment_date,
                officer_id: r.officer_id,
                officer_name: officerName,
                branch_id: managerBranchId,
                requested_by_officer_id: req.officer_id,
                approved_by_manager_id: user.id,
                snapshot: { ...r, loan: r.loans },
            });
            if (insErr) throw insErr;

            await supabase.rpc('log_audit_event', {
                p_action: 'repayment.delete.finalized',
                p_entity_type: 'repayment',
                p_entity_id: String(r.id),
                p_metadata: { loan_public_id: loanPublicId, borrower_name: borrowerName },
            });

            const { error: delErr } = await supabase.from('repayments').delete().eq('id', r.id);
            if (delErr) throw delErr;

            await supabase.rpc('recalculate_loan_schedule', { p_loan_id: r.loan_id });
            await supabase.rpc('update_all_loan_statuses');

            toast({ title: 'Deleted', description: 'Repayment removed and loan schedule updated.' });
            fetchData();
        } catch (e) {
            toast({ title: 'Error', description: e?.message || 'Could not approve deletion.', variant: 'destructive' });
        }
    };

    const handleRejectRepaymentDelete = async (req) => {
        try {
            const { error } = await supabase
                .from('repayment_delete_requests')
                .update({
                    status: 'rejected',
                    rejected_at: new Date().toISOString(),
                    rejected_by_manager_id: user.id,
                })
                .eq('id', req.id);
            if (error) throw error;

            await supabase.rpc('log_audit_event', {
                p_action: 'repayment.delete.rejected',
                p_entity_type: 'repayment_delete_request',
                p_entity_id: String(req.id),
                p_metadata: { repayment_id: req.repayment_id },
            });

            toast({ title: 'Rejected', description: 'The officer can keep or adjust the repayment.' });
            fetchData();
        } catch (e) {
            toast({ title: 'Error', description: e?.message || 'Could not reject.', variant: 'destructive' });
        }
    };

    const handleExport = () => {
        const dataToExport = filteredRepayments.map(r => ({
            'Payment Date': formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'yyyy-MM-dd'),
            'Borrower': `${r.loans?.borrowers?.first_name} ${r.loans?.borrowers?.surname}`,
            'Loan ID': r.loans?.loan_id,
            'Group': r.loans?.borrowers?.groups?.name || 'N/A',
            'Loan Officer': branchOfficers.find(o => o.id === r.officer_id)?.full_name || 'N/A',
            'Principal Paid': r.principal_paid || 0,
            'Total Paid': r.amount,
        }));
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Repayments');
        XLSX.writeFile(wb, 'repayment_history.xlsx');
    };

    if (loading) return <DashboardLayout title="Collections"><Loader2 className="h-8 w-8 animate-spin mx-auto mt-8" /></DashboardLayout>;

    return (
        <DashboardLayout title="Collections">
            <div className="space-y-6">
                {pendingRepaymentDeletes.length > 0 && (
                    <Card>
                        <CardHeader>
                            <CardTitle>Repayment deletion requests</CardTitle>
                            <CardDescription>
                                Loan officers asked to remove these repayments. Approve to delete and recalculate the loan, or reject to keep the repayment.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Requested</TableHead>
                                        <TableHead>Loan</TableHead>
                                        <TableHead>Borrower</TableHead>
                                        <TableHead>Amount</TableHead>
                                        <TableHead>Officer</TableHead>
                                        <TableHead>Actions</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {pendingRepaymentDeletes.map((req) => {
                                        const r = req.repayment;
                                        if (!r) return null;
                                        return (
                                            <TableRow key={req.id}>
                                                <TableCell className="whitespace-nowrap text-sm">
                                                    {format(req.requested_at ? new Date(req.requested_at) : new Date(), 'MMM dd, yyyy HH:mm')}
                                                </TableCell>
                                                <TableCell>{r.loans?.loan_id}</TableCell>
                                                <TableCell>
                                                    {r.loans?.borrowers?.first_name} {r.loans?.borrowers?.surname}
                                                </TableCell>
                                                <TableCell>
                                                    {currency}{' '}
                                                    {r.amount.toLocaleString(undefined, {
                                                        minimumFractionDigits: 2,
                                                        maximumFractionDigits: 2,
                                                    })}
                                                </TableCell>
                                                <TableCell>
                                                    {branchOfficers.find((o) => o.id === r.officer_id)?.full_name || '—'}
                                                </TableCell>
                                                <TableCell className="space-x-2">
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button size="sm" variant="outline">
                                                                <CheckCircle className="mr-2 h-4 w-4" />
                                                                Approve
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Delete this repayment?</AlertDialogTitle>
                                                                <AlertDialogDescription>
                                                                    This is final approval: the repayment will be removed and the loan schedule recalculated.
                                                                </AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleApproveRepaymentDelete(req)}>
                                                                    Yes, delete repayment
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                    <AlertDialog>
                                                        <AlertDialogTrigger asChild>
                                                            <Button size="sm" variant="destructive">
                                                                <XCircle className="mr-2 h-4 w-4" />
                                                                Reject
                                                            </Button>
                                                        </AlertDialogTrigger>
                                                        <AlertDialogContent>
                                                            <AlertDialogHeader>
                                                                <AlertDialogTitle>Reject deletion request?</AlertDialogTitle>
                                                                <AlertDialogDescription>The repayment stays on the loan.</AlertDialogDescription>
                                                            </AlertDialogHeader>
                                                            <AlertDialogFooter>
                                                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                                <AlertDialogAction onClick={() => handleRejectRepaymentDelete(req)}>
                                                                    Reject request
                                                                </AlertDialogAction>
                                                            </AlertDialogFooter>
                                                        </AlertDialogContent>
                                                    </AlertDialog>
                                                </TableCell>
                                            </TableRow>
                                        );
                                    })}
                                </TableBody>
                            </Table>
                        </CardContent>
                    </Card>
                )}

                <Card>
                    <CardHeader>
                        <CardTitle>Repayment Overview</CardTitle>
                        <CardDescription>Summary of repayments for your branch based on selected filters.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-4 md:grid-cols-2">
                            <StatCard title="Total Repayments (Filtered)" value={`${currency} ${stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={ArrowRightLeft} color="text-blue-500" />
                            <StatCard title="Principal Repaid" value={`${currency} ${stats.totalPrincipalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={TrendingDown} color="text-orange-500" />
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
                            value={officerFilter}
                            onValueChange={setOfficerFilter}
                            options={mgrRepOfficerOpts}
                            allLabel="All Loan Officers"
                            allValue="all"
                            placeholder="Filter by Loan Officer..."
                            searchPlaceholder="Search officers…"
                            emptyText="No officer found."
                            triggerClassName="w-[240px]"
                        />
                        <SearchableSelect
                            value={centerFilter}
                            onValueChange={(v) => {
                                setCenterFilter(v);
                                setGroupFilter('all');
                            }}
                            options={mgrRepCenterOpts}
                            allLabel="All centers"
                            allValue="all"
                            placeholder="Center"
                            searchPlaceholder="Search centers…"
                            emptyText="No center found."
                            triggerClassName="w-[220px]"
                        />
                        <SearchableSelect
                            value={groupFilter}
                            onValueChange={setGroupFilter}
                            disabled={centerFilter === 'all'}
                            options={mgrRepGroupOpts}
                            allLabel="All groups"
                            allValue="all"
                            placeholder={centerFilter === 'all' ? 'Pick center first' : 'Group'}
                            searchPlaceholder="Search groups…"
                            emptyText="No group found."
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
                                    {dateRangeFilter?.from ? (dateRangeFilter.to ? `${format(dateRangeFilter.from, "LLL dd, y")} - ${format(dateRangeFilter.to, "LLL dd, y")}` : format(dateRangeFilter.from, "LLL dd, y")) : <span>Pick a date range</span>}
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
                    <CardHeader className="flex flex-row items-center justify-between">
                        <CardTitle>Repayment History</CardTitle>
                        <Button onClick={handleExport}><FileDown className="mr-2 h-4 w-4" /> Export</Button>
                    </CardHeader>
                    <CardContent>
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
                                    <TableHead>Group</TableHead>
                                    <TableHead>Loan Officer</TableHead>
                                    <TableHead>Principal Paid</TableHead>
                                    <TableHead>Total Paid</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pagedRepayments.map(r => (
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
                                        <TableCell>{r.loans?.borrowers?.groups?.name || 'N/A'}</TableCell>
                                        <TableCell>{branchOfficers.find(o => o.id === r.officer_id)?.full_name || 'N/A'}</TableCell>
                                        <TableCell>{currency} {(r.principal_paid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell className="font-semibold">{currency} {r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="icon" onClick={() => handleViewSchedule(r.loans)}><Eye className="h-4 w-4" /></Button>
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
                                    <TableCell colSpan={6} className="font-bold text-right">Totals</TableCell>
                                    <TableCell className="font-bold">{currency} {stats.totalPrincipalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell className="font-bold">{currency} {stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell />
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

export default ManagerRepaymentManagement;