import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useHierarchyFilters } from '@/hooks/useHierarchyFilters';
import { filterLoanByHierarchy } from '@/lib/hierarchyFilterUtils';
import { HierarchyFilterBar } from '@/components/filters/HierarchyFilterBar';
import { useToast } from '@/components/ui/use-toast';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Loader2, TrendingDown, Scale, Trash2, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { format, differenceInDays } from 'date-fns';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useDate } from '@/contexts/DateContext';
import { useUserProfileScope } from '@/hooks/useUserProfileScope';

const EAT_TIMEZONE = 'Africa/Nairobi';
const PAGE_SIZE = 25;

const StatCard = ({ title, value, icon: Icon }) => (
    <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{title}</CardTitle>
            <Icon className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
            <div className="text-2xl font-bold">{value}</div>
        </CardContent>
    </Card>
);

const DefaultersManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const { branchId: profileBranchId, role: profileRole } = useUserProfileScope(user?.id);
    const role = profileRole ?? user?.user_metadata?.role;
    const hf = useHierarchyFilters(user);
    const [defaultedLoans, setDefaultedLoans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedLoans, setSelectedLoans] = useState([]);
    const [currency, setCurrency] = useState('TZS');
    const { currentDate } = useDate();
    const [holidays, setHolidays] = useState([]);
    const [page, setPage] = useState(1);

    useEffect(() => {
        const fetchHolidays = async () => {
            const { data } = await supabase.from('holidays').select('date');
            if (data) {
                setHolidays(data.map(h => h.date));
            }
        };
        fetchHolidays();
    }, []);

    const isHoliday = (dateObj) => {
        const dateStr = formatTZ(toZonedTime(dateObj, EAT_TIMEZONE), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });
        return holidays.includes(dateStr);
    };

    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setSelectedLoans([]);
        try {
            await supabase.rpc('update_all_loan_statuses');

            const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
            if (config) setCurrency(config.value);

            let query = supabase.from('loans').select(`
                id, loan_id, principal, balance, schedule, disbursement_date,
                borrowers!inner(id, first_name, surname, borrower_id, branch_id, center_id, group_id),
                officer:users!officer_id(id, full_name, branch_id)
            `).eq('status', 'defaulted');

            if (role === 'officer') {
                query = query.eq('officer_id', user.id);
            } else if (role === 'manager') {
                const branchScope = profileBranchId ?? user?.user_metadata?.branch_id;
                if (!branchScope) throw new Error('Branch not assigned to your profile.');
                const { data: officers, error: officersError } = await supabase
                    .from('users')
                    .select('id')
                    .eq('branch_id', branchScope)
                    .eq('role', 'officer');
                if (officersError) throw officersError;
                query = query.in('officer_id', officers.map((o) => o.id));
            }
            
            const { data: loansData, error } = await query;
            if (error) throw error;
            
            const today = toZonedTime(new Date(), EAT_TIMEZONE);
            const loansWithDetails = loansData.map(loan => {
                const lastDueDate = loan.schedule ? toZonedTime(new Date(loan.schedule[loan.schedule.length - 1].dueDate), EAT_TIMEZONE) : null;
                const daysOverdue = lastDueDate ? differenceInDays(today, lastDueDate) : 0;
                return { ...loan, daysOverdue: Math.max(0, daysOverdue) };
            });

            setDefaultedLoans(loansWithDetails);
        } catch (error) {
            toast({ title: 'Error fetching defaulters', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user, toast, role, profileBranchId]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleWriteOff = async (loanIds) => {
        if (isHoliday(currentDate)) {
            toast({ title: 'Action Restricted', description: 'Cannot write off loans on a public holiday.', variant: 'destructive' });
            return;
        }

        setProcessing(true);
        try {
            const updates = loanIds.map(id => supabase.rpc('update_loan_status', { p_loan_id: id, p_new_status: 'written_off' }));
            const results = await Promise.all(updates);

            results.forEach((result, index) => {
                if (result.error) {
                    throw new Error(`Failed to write off loan ${loanIds[index]}: ${result.error.message}`);
                }
            });

            toast({ title: 'Success', description: `${loanIds.length} loan(s) have been written off.` });
            fetchData();
        } catch (error) {
            toast({ title: 'Write-off Failed', description: error.message, variant: 'destructive' });
        } finally {
            setProcessing(false);
        }
    };
    
    const handleSelectLoan = (loanId) => {
        setSelectedLoans(prev => prev.includes(loanId) ? prev.filter(id => id !== loanId) : [...prev, loanId]);
    };

    const hierarchyFiltered = useMemo(
        () => defaultedLoans.filter((loan) => filterLoanByHierarchy(loan, hf.filterParams)),
        [defaultedLoans, hf.filterParams]
    );

    const filteredLoans = useMemo(() => {
        return hierarchyFiltered
            .filter(
                (loan) =>
                    loan.borrowers?.first_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    loan.borrowers?.surname?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    loan.loan_id.toLowerCase().includes(searchTerm.toLowerCase())
            )
            .sort((a, b) => b.daysOverdue - a.daysOverdue);
    }, [hierarchyFiltered, searchTerm]);

    useEffect(() => {
        setSelectedLoans([]);
    }, [hf.branchId, hf.centerId, hf.groupId, hf.officerId, hf.dateFrom, hf.dateTo]);

    useEffect(() => {
        setPage(1);
    }, [searchTerm, filteredLoans.length, hf.branchId, hf.centerId, hf.groupId, hf.officerId, hf.dateFrom, hf.dateTo]);

    const pagedLoans = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredLoans.slice(start, start + PAGE_SIZE);
    }, [filteredLoans, page]);

    const totalPages = Math.max(1, Math.ceil(filteredLoans.length / PAGE_SIZE));

    const handleSelectAll = (checked) => {
        const pageIds = pagedLoans.map((l) => l.id);
        if (checked) {
            setSelectedLoans((prev) => [...new Set([...prev, ...pageIds])]);
        } else {
            setSelectedLoans((prev) => prev.filter((id) => !pageIds.includes(id)));
        }
    };

    const exportSelectedDefaultedCsv = () => {
        const rows = filteredLoans.filter((l) => selectedLoans.includes(l.id));
        if (rows.length === 0) {
            toast({ title: 'Nothing selected', description: 'Select one or more loans first.', variant: 'destructive' });
            return;
        }
        exportObjectsToCsv(`defaulted_loans_${Date.now()}.csv`, [
            { header: 'Loan ID', accessor: 'loan_id' },
            { header: 'Borrower', accessor: (r) => `${r.borrowers?.first_name || ''} ${r.borrowers?.surname || ''}`.trim() },
            { header: 'Balance', accessor: (r) => String(r.balance ?? '') },
            { header: 'Days overdue', accessor: (r) => String(r.daysOverdue ?? '') },
        ], rows);
        toast({ title: 'Exported', description: `${rows.length} loan(s) to CSV.` });
    };

    const stats = useMemo(() => {
        const totalDefaultedAmount = filteredLoans.reduce((sum, loan) => sum + loan.balance, 0);
        return {
            count: filteredLoans.length,
            totalDefaultedAmount,
        };
    }, [filteredLoans]);

    if (loading) return <DashboardLayout><div className="flex justify-center items-center h-64"><Loader2 className="h-8 w-8 animate-spin" /></div></DashboardLayout>;

    return (
        <DashboardLayout title="Defaulted Loans Management">
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Filters</CardTitle>
                        <CardDescription>Branch through group, officer, and disbursement date. Stats and the table match the filters and search.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <HierarchyFilterBar
                            branches={hf.branches}
                            centersForBranch={hf.centersForBranch}
                            groupsForCenter={hf.groupsForCenter}
                            officersForBranch={hf.officersForBranch}
                            branchId={hf.branchId}
                            setBranchId={hf.setBranchId}
                            centerId={hf.centerId}
                            setCenterId={hf.setCenterId}
                            groupId={hf.groupId}
                            setGroupId={hf.setGroupId}
                            officerId={hf.officerId}
                            setOfficerId={hf.setOfficerId}
                            dateFrom={hf.dateFrom}
                            setDateFrom={hf.setDateFrom}
                            dateTo={hf.dateTo}
                            setDateTo={hf.setDateTo}
                            onReset={hf.resetFilters}
                            disableBranch={role === 'manager' || role === 'officer'}
                            disableOfficer={role === 'officer'}
                        />
                    </CardContent>
                </Card>

                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-2">
                    <StatCard title="Total Defaulted Loans (filtered)" value={stats.count} icon={TrendingDown} />
                    <StatCard title="Total Outstanding Balance (filtered)" value={`${currency} ${stats.totalDefaultedAmount.toLocaleString()}`} icon={Scale} />
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Defaulted Loans</CardTitle>
                        <CardDescription>List of loans with status defaulted, after hierarchy filters.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="flex items-center gap-4 mb-4">
                            <Input
                                placeholder="Search by name or loan ID..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="max-w-sm"
                            />
                            {selectedLoans.length > 0 && (
                                <div className="flex flex-wrap items-center gap-2">
                                <Button type="button" variant="outline" onClick={exportSelectedDefaultedCsv}>
                                    <Download className="mr-2 h-4 w-4" />
                                    Export CSV
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button variant="destructive" disabled={processing}>
                                            {processing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                                            Write Off Selected ({selectedLoans.length})
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Confirm Bulk Write-Off</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will permanently write off {selectedLoans.length} selected loans. This action cannot be undone. Are you sure?
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => handleWriteOff(selectedLoans)}>Yes, Write Off</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                                </div>
                            )}
                        </div>
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[50px]"><Checkbox checked={pagedLoans.length > 0 && pagedLoans.every((l) => selectedLoans.includes(l.id))} onCheckedChange={handleSelectAll} /></TableHead>
                                    <TableHead>Borrower</TableHead>
                                    <TableHead>Loan ID</TableHead>
                                    <TableHead>Outstanding Balance</TableHead>
                                    <TableHead>Days Since Last Due Date</TableHead>
                                    <TableHead>Action</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pagedLoans.map((loan) => (
                                    <TableRow key={loan.id} data-state={selectedLoans.includes(loan.id) && "selected"}>
                                        <TableCell><Checkbox checked={selectedLoans.includes(loan.id)} onCheckedChange={() => handleSelectLoan(loan.id)} /></TableCell>
                                        <TableCell>
                                            {loan.borrowers ? `${loan.borrowers.first_name} ${loan.borrowers.surname}` : '—'}
                                        </TableCell>
                                        <TableCell className="font-medium">{loan.loan_id}</TableCell>
                                        <TableCell className="text-red-600 font-semibold">{currency} {loan.balance.toLocaleString()}</TableCell>
                                        <TableCell><Badge variant="destructive">{loan.daysOverdue} days</Badge></TableCell>
                                        <TableCell>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="outline" size="sm" disabled={processing || selectedLoans.length > 0}>
                                                        <Trash2 className="mr-2 h-4 w-4" />Write Off
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Confirm Write-Off</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            Are you sure you want to write off loan {loan.loan_id}? This cannot be undone.
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction className="bg-destructive hover:bg-destructive/90" onClick={() => handleWriteOff([loan.id])}>Yes, Write Off</AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {filteredLoans.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={6} className="text-center">No defaulted loans found.</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        {filteredLoans.length > 0 && (
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                                <p className="text-sm text-muted-foreground">
                                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredLoans.length)} of {filteredLoans.length}
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
        </DashboardLayout>
    );
};

export default DefaultersManagement;