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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Calendar as CalendarIcon, Loader2, FileDown, Eye, ArrowRightLeft, TrendingUp, TrendingDown, Scale, ChevronLeft, ChevronRight } from 'lucide-react';
import * as XLSX from 'xlsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';

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

const ManagerRepaymentManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const [repayments, setRepayments] = useState([]);
    const [branchOfficers, setBranchOfficers] = useState([]);
    const [groups, setGroups] = useState([]);
    const [loading, setLoading] = useState(true);
    const [currency, setCurrency] = useState('TZS');

    // Filters
    const [officerFilter, setOfficerFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [dateRangeFilter, setDateRangeFilter] = useState(null);
    const [page, setPage] = useState(1);

    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [selectedLoanForSchedule, setSelectedLoanForSchedule] = useState(null);

    const resetFilters = () => {
        setOfficerFilter('all');
        setGroupFilter('all');
        setDateRangeFilter(null);
        setPage(1);
    };

    const fetchData = useCallback(async () => {
        if (!user || !user.user_metadata.branch_id) return;
        setLoading(true);
        try {
            const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
            if (config) setCurrency(config.value);

            const { data: officersData, error: officersError } = await supabase
                .from('users')
                .select('id, full_name')
                .eq('branch_id', user.user_metadata.branch_id)
                .eq('role', 'officer');
            if (officersError) throw officersError;
            setBranchOfficers(officersData || []);

            const officerIds = officersData.map(o => o.id);

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
            const officerMatch = officerFilter === 'all' || r.officer_id === officerFilter;
            const groupMatch = groupFilter === 'all' || r.loans?.borrowers?.group_id === groupFilter;
            const dateMatch = !dateRangeFilter?.from || (
                new Date(r.actual_payment_date) >= startOfDay(dateRangeFilter.from) &&
                new Date(r.actual_payment_date) <= endOfDay(dateRangeFilter.to || dateRangeFilter.from)
            );
            return officerMatch && groupMatch && dateMatch;
        });
    }, [repayments, officerFilter, groupFilter, dateRangeFilter]);

    useEffect(() => {
        setPage(1);
    }, [officerFilter, groupFilter, dateRangeFilter]);

    const pagedRepayments = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredRepayments.slice(start, start + PAGE_SIZE);
    }, [filteredRepayments, page]);

    const totalPages = Math.max(1, Math.ceil(filteredRepayments.length / PAGE_SIZE));

    const stats = useMemo(() => {
        const totalPaid = filteredRepayments.reduce((sum, r) => sum + r.amount, 0);
        const totalInterest = filteredRepayments.reduce((sum, r) => sum + (r.interest_paid || 0), 0);
        const totalPrincipalPaid = filteredRepayments.reduce((sum, r) => sum + (r.principal_paid || 0), 0);
        return { totalPaid, totalInterest, totalPrincipalPaid };
    }, [filteredRepayments]);

    const handleViewSchedule = async (loan) => {
        const { data: latestLoanData, error } = await supabase.from('loans').select(`*, borrowers (id, first_name, surname)`).eq('id', loan.id).single();
        if (error) {
             toast({ title: 'Error', description: 'Could not fetch latest schedule.', variant: 'destructive' });
             return;
        }
        setSelectedLoanForSchedule(latestLoanData);
        setScheduleDialogOpen(true);
    };

    const handleExport = () => {
        const dataToExport = filteredRepayments.map(r => ({
            'Payment Date': formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'yyyy-MM-dd'),
            'Borrower': `${r.loans?.borrowers?.first_name} ${r.loans?.borrowers?.surname}`,
            'Loan ID': r.loans?.loan_id,
            'Group': r.loans?.borrowers?.groups?.name || 'N/A',
            'Loan Officer': branchOfficers.find(o => o.id === r.officer_id)?.full_name || 'N/A',
            'Principal Paid': r.principal_paid || 0,
            'Interest Paid': r.interest_paid || 0,
            'Total Paid': r.amount,
        }));
        const ws = XLSX.utils.json_to_sheet(dataToExport);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Repayments');
        XLSX.writeFile(wb, 'repayment_history.xlsx');
    };

    if (loading) return <DashboardLayout><Loader2 className="h-8 w-8 animate-spin mx-auto mt-8" /></DashboardLayout>;

    return (
        <DashboardLayout title="Repayment Management">
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Repayment Overview</CardTitle>
                        <CardDescription>Summary of repayments for your branch based on selected filters.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                            <StatCard title="Total Repayments (Filtered)" value={`${currency} ${stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={ArrowRightLeft} color="text-blue-500" />
                            <StatCard title="Interest Collected" value={`${currency} ${stats.totalInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={TrendingUp} color="text-green-500" />
                            <StatCard title="Principal Repaid" value={`${currency} ${stats.totalPrincipalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={TrendingDown} color="text-orange-500" />
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Filters</CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-wrap items-center gap-4">
                        <Select value={officerFilter} onValueChange={setOfficerFilter}>
                            <SelectTrigger className="w-[240px]">
                                <SelectValue placeholder="Filter by Loan Officer..." />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Loan Officers</SelectItem>
                                {branchOfficers.map(o => <SelectItem key={o.id} value={o.id}>{o.full_name}</SelectItem>)}
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
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Payment Date</TableHead>
                                    <TableHead>Borrower</TableHead>
                                    <TableHead>Group</TableHead>
                                    <TableHead>Loan Officer</TableHead>
                                    <TableHead>Principal Paid</TableHead>
                                    <TableHead>Interest Paid</TableHead>
                                    <TableHead>Total Paid</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pagedRepayments.map(r => (
                                    <TableRow key={r.id}>
                                        <TableCell>{formatTZ(toZonedTime(new Date(r.actual_payment_date), EAT_TIMEZONE), 'MMM dd, yyyy')}</TableCell>
                                        <TableCell>{r.loans?.borrowers?.first_name} {r.loans?.borrowers?.surname}</TableCell>
                                        <TableCell>{r.loans?.borrowers?.groups?.name || 'N/A'}</TableCell>
                                        <TableCell>{branchOfficers.find(o => o.id === r.officer_id)?.full_name || 'N/A'}</TableCell>
                                        <TableCell>{currency} {(r.principal_paid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell>{currency} {(r.interest_paid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell className="font-semibold">{currency} {r.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell>
                                            <Button variant="ghost" size="icon" onClick={() => handleViewSchedule(r.loans)}><Eye className="h-4 w-4" /></Button>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {filteredRepayments.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No repayments match the current filters.</TableCell>
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
            
            <Dialog open={scheduleDialogOpen} onOpenChange={setScheduleDialogOpen}>
              <DialogContent className="max-w-4xl">
                <DialogHeader>
                    <DialogTitle>Repayment Schedule for {selectedLoanForSchedule?.loan_id}</DialogTitle>
                    <DialogDescription>
                        Borrower: {selectedLoanForSchedule?.borrowers?.first_name} {selectedLoanForSchedule?.borrowers?.surname} <br/>
                        Total Payable: {currency} {(selectedLoanForSchedule?.total_payable || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </DialogDescription>
                </DialogHeader>
                {selectedLoanForSchedule && (
                    <div className="max-h-[60vh] overflow-y-auto">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>#</TableHead>
                                    <TableHead>Due Date</TableHead>
                                    <TableHead>Amount Due</TableHead>
                                    <TableHead>Principal Paid</TableHead>
                                    <TableHead>Interest Paid</TableHead>
                                    <TableHead>Total Paid</TableHead>
                                    <TableHead>Status</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {selectedLoanForSchedule.schedule.map(inst => (
                                    <TableRow key={inst.installmentNumber}>
                                        <TableCell>{inst.installmentNumber}</TableCell>
                                        <TableCell>{formatTZ(toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE), 'MMM dd, yyyy')}</TableCell>
                                        <TableCell>{currency} {inst.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell>{currency} {(inst.principalPaid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell>{currency} {(inst.interestPaid || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell>{currency} {(inst.paidAmount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell><Badge variant={inst.status === 'paid' ? 'success' : inst.status === 'arrears' ? 'warning' : 'secondary'}>{inst.status}</Badge></TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
              </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
};

export default ManagerRepaymentManagement;