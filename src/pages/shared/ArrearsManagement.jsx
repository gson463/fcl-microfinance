import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, invokeEdgeFunction } from '@/lib/customSupabaseClient';
import { requireSessionLocationForRequest, SessionLocationRequiredError } from '@/lib/auditLog';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useHierarchyFilters } from '@/hooks/useHierarchyFilters';
import { filterLoanByHierarchy } from '@/lib/hierarchyFilterUtils';
import { HierarchyFilterBar } from '@/components/filters/HierarchyFilterBar';
import { useToast } from '@/components/ui/use-toast';
import { format as formatTZ, toZonedTime } from 'date-fns-tz';
import { differenceInDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Coins, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { exportObjectsToCsv } from '@/lib/tableExport';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useDate } from '@/contexts/DateContext';
import {
  getInstallmentUnitFromSchedule,
  roundToValidRepaymentAmount,
} from '@/lib/repaymentInstallmentUnit.js';
import { useUserProfileScope } from '@/hooks/useUserProfileScope';
import { scheduledDueRpcName, normalizeWalletPrepaymentSplitMode, WALLET_PREPAYMENT_ARREARS_ONLY } from '@/lib/walletPrepaymentSplitMode';
import { isWorkingDayEAT } from '@/lib/workingDayEAT';

const EAT_TIMEZONE = 'Africa/Nairobi';
const PAGE_SIZE = 25;

const ArrearsManagement = () => {
    const { user, session } = useAuth();
    const { toast } = useToast();
    const { branchId: profileBranchId, role: profileRole } = useUserProfileScope(user?.id);
    const role = profileRole ?? user?.user_metadata?.role;
    const hf = useHierarchyFilters(user);
    const [loans, setLoans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [clearingLoanId, setClearingLoanId] = useState(null);
    const [selectedLoans, setSelectedLoans] = useState([]);
    const [currency, setCurrency] = useState('TZS');
    const { currentDate } = useDate();
    const [page, setPage] = useState(1);
    const [walletPrepaymentSplitMode, setWalletPrepaymentSplitMode] = useState(WALLET_PREPAYMENT_ARREARS_ONLY);
    const [holidays, setHolidays] = useState([]);

    const fetchArrearsLoans = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setSelectedLoans([]);

        const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
        if (config) {
            setCurrency(config.value);
        }
        const { data: splitRow } = await supabase
            .from('system_config')
            .select('value')
            .eq('key', 'walletPrepaymentSplitMode')
            .maybeSingle();
        setWalletPrepaymentSplitMode(normalizeWalletPrepaymentSplitMode(splitRow?.value));

        const { data: holidaysData, error: holidaysError } = await supabase.from('holidays').select('date');
        if (!holidaysError) {
            setHolidays(holidaysData || []);
        }

        // Step 1: Force backend to update statuses based on Today's date
        // This ensures the DB status column is as fresh as possible
        await supabase.rpc('update_all_loan_statuses');

        let query = supabase.from('loans').select(
            `*, borrowers(id, first_name, surname, branch_id, center_id, group_id),
             officer:users!officer_id(id, full_name, branch_id)`
        );

        // Role-Based Filtering
        if (role === 'officer') {
            query = query.eq('officer_id', user.id);
        } else if (role === 'manager') {
            const branchScope = profileBranchId ?? user?.user_metadata?.branch_id;
            if (!branchScope) {
                toast({
                    title: 'Branch not assigned',
                    description: 'Your profile has no branch. Contact an administrator.',
                    variant: 'destructive',
                });
                setLoading(false);
                return;
            }
            const { data: officers, error: officersError } = await supabase
                .from('users')
                .select('id')
                .eq('branch_id', branchScope)
                .eq('role', 'officer');

            if (officersError) {
                toast({ title: 'Error fetching loan officers', description: officersError.message, variant: 'destructive' });
                setLoading(false);
                return;
            }
            const officerIds = officers.map(o => o.id);
            query = query.in('officer_id', officerIds);
        }
        
        // Step 2: Fetch Active, Delinquent, and Defaulted loans.
        // We include 'active' to catch loans that became arrears TODAY but might not have been caught by the status update yet (redundancy),
        // or simply to ensure the frontend calculator is the ultimate source of truth for display.
        query = query.in('status', ['active', 'delinquent', 'defaulted']);

        const { data, error } = await query;

        if (error) {
            toast({ title: 'Error fetching loans', description: error.message, variant: 'destructive' });
        } else {
            // Step 3: Frontend Calculation - The Source of Truth for "Current Arrears"
            const loansWithArrears = data.map(loan => {
                let arrearsAmount = 0;
                let daysInArrears = 0;
                let firstArrearsDate = null;

                if (loan.schedule) {
                    const today = toZonedTime(currentDate, EAT_TIMEZONE);
                    today.setHours(0, 0, 0, 0); // Normalize comparison date to midnight

                    loan.schedule.forEach(inst => {
                        const dueDate = toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE);
                        dueDate.setHours(0, 0, 0, 0);
                        
                        // Condition 1: Due Date is strictly in the past (< today)
                        const isPastDue = dueDate < today;
                        const outstanding = (inst.amount || 0) - (inst.paidAmount || 0);

                        // Condition 2: Balance remains (> 0.01 tolerance)
                        if (isPastDue && outstanding > 0.01) {
                            arrearsAmount += outstanding;
                            
                            // Track the oldest due date for "Days in Arrears" calculation
                            if (!firstArrearsDate || dueDate < firstArrearsDate) {
                                firstArrearsDate = dueDate;
                            }
                        }
                    });

                    if (firstArrearsDate) {
                        daysInArrears = differenceInDays(today, firstArrearsDate);
                    }
                }
                return { ...loan, arrearsAmount, daysInArrears };
            })
            // Step 4: Final Filter - Only show loans that mathematically have arrears > 0
            .filter(loan => loan.arrearsAmount > 0.01); 

            setLoans(loansWithArrears);
        }
        setLoading(false);
    }, [user, toast, currentDate, role, profileBranchId]);

    useEffect(() => {
        fetchArrearsLoans();

        // Real-time subscription to catch updates from other users/tabs
        const channel = supabase
            .channel('arrears-updates')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'loans' }, () => {
                fetchArrearsLoans();
            })
            .subscribe();

        return () => {
            supabase.removeChannel(channel);
        };
    }, [fetchArrearsLoans]);

    const filteredLoans = useMemo(
        () => loans.filter((loan) => filterLoanByHierarchy(loan, hf.filterParams)),
        [loans, hf.filterParams]
    );

    useEffect(() => {
        setSelectedLoans([]);
    }, [hf.branchId, hf.centerId, hf.groupId, hf.officerId, hf.dateFrom, hf.dateTo]);

    useEffect(() => {
        setPage(1);
    }, [filteredLoans.length, hf.branchId, hf.centerId, hf.groupId, hf.officerId, hf.dateFrom, hf.dateTo]);

    const pagedLoans = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return filteredLoans.slice(start, start + PAGE_SIZE);
    }, [filteredLoans, page]);

    const totalPages = Math.max(1, Math.ceil(filteredLoans.length / PAGE_SIZE));

    const handleClearArrears = async (loan) => {
        const payStr = formatTZ(currentDate, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });
        if (!isWorkingDayEAT(payStr, holidays)) {
            toast({
                title: 'Non-working day',
                description:
                    'Clearing arrears uses the portfolio date as the payment date. Select a working day (Monday–Saturday, not a public holiday) in the date control, or wait until the next working day.',
                variant: 'destructive',
            });
            return false;
        }
        const dueRpc = scheduledDueRpcName(walletPrepaymentSplitMode);
        const { data: dueRaw, error: dueErr } = await supabase.rpc(dueRpc, {
            p_schedule: loan.schedule ?? null,
            p_payment_date: payStr,
        });
        if (dueErr) {
            toast({ title: 'Error', description: dueErr.message, variant: 'destructive' });
            return false;
        }
        const due = Number(dueRaw ?? 0);
        const unit = getInstallmentUnitFromSchedule(loan.schedule);
        let payAmount = loan.arrearsAmount;
        if (unit != null) {
            payAmount = roundToValidRepaymentAmount(Math.max(loan.arrearsAmount, due), due, unit);
        }

        setClearingLoanId(loan.id);
        try {
            const gps = requireSessionLocationForRequest();
            const { error } = await invokeEdgeFunction(
                'record-repayment',
                {
                    body: {
                        loan_id: loan.id,
                        amount: payAmount,
                        officer_id: user.id,
                        actual_payment_date: payStr,
                        ...gps,
                    },
                },
                session?.access_token,
            );

            if (error) throw error;
            toast({ title: 'Success', description: `Arrears for loan ${loan.loan_id} cleared.` });
            return true;
        } catch (error) {
            if (error instanceof SessionLocationRequiredError) {
                toast({ title: 'Huwezi kuendelea', description: error.message, variant: 'destructive' });
                return false;
            }
            toast({ title: `Failed to clear arrears for ${loan.loan_id}`, description: error.message, variant: 'destructive' });
            return false;
        } finally {
            setClearingLoanId(null);
        }
    };
    
    const handleBulkClearArrears = async () => {
        setClearingLoanId('bulk');
        let successCount = 0;
        const loansToClear = filteredLoans.filter(l => selectedLoans.includes(l.id));

        for (const loan of loansToClear) {
            const success = await handleClearArrears(loan);
            if (success) {
                successCount++;
            }
        }
        
        toast({ title: 'Bulk Operation Complete', description: `${successCount} of ${selectedLoans.length} loans' arrears cleared.` });
        fetchArrearsLoans();
    };

    const handleSelectLoan = (loanId) => {
        setSelectedLoans(prev => prev.includes(loanId) ? prev.filter(id => id !== loanId) : [...prev, loanId]);
    };

    const handleSelectAll = (checked) => {
        const pageIds = pagedLoans.map((l) => l.id);
        if (checked) {
            setSelectedLoans((prev) => [...new Set([...prev, ...pageIds])]);
        } else {
            setSelectedLoans((prev) => prev.filter((id) => !pageIds.includes(id)));
        }
    };

    const exportSelectedArrearsCsv = () => {
        const rows = filteredLoans.filter((l) => selectedLoans.includes(l.id));
        if (rows.length === 0) {
            toast({ title: 'Nothing selected', description: 'Select one or more loans first.', variant: 'destructive' });
            return;
        }
        exportObjectsToCsv(`arrears_${Date.now()}.csv`, [
            { header: 'Loan ID', accessor: 'loan_id' },
            { header: 'Borrower', accessor: (r) => `${r.borrowers?.first_name || ''} ${r.borrowers?.surname || ''}`.trim() },
            { header: 'Principal', accessor: (r) => String(r.principal ?? '') },
            { header: 'Arrears amount', accessor: (r) => String(r.arrearsAmount ?? '') },
            { header: 'Days in arrears', accessor: (r) => String(r.daysInArrears ?? '') },
            { header: 'Status', accessor: 'status' },
        ], rows);
        toast({ title: 'Exported', description: `${rows.length} loan(s) to CSV.` });
    };

    const totalArrears = useMemo(() => filteredLoans.reduce((sum, loan) => sum + loan.arrearsAmount, 0), [filteredLoans]);
    const selectedArrearsTotal = useMemo(
        () => filteredLoans.filter(l => selectedLoans.includes(l.id)).reduce((sum, l) => sum + l.arrearsAmount, 0),
        [filteredLoans, selectedLoans]
    );

    if (loading) {
        return <DashboardLayout title="Arrears Management"><div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div></DashboardLayout>;
    }

    return (
        <DashboardLayout title="Arrears Management">
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Filters</CardTitle>
                        <p className="text-sm text-muted-foreground">
                            Narrow by branch, center, group, officer, and disbursement date. Totals and the table reflect the current filters.
                        </p>
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

                <Card>
                    <CardHeader>
                        <CardTitle>Total Portfolio in Arrears (filtered)</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <p className="text-3xl font-bold">{currency} {totalArrears.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle>Loans in Arrears</CardTitle>
                    </CardHeader>
                    <CardContent>
                        {selectedLoans.length > 0 && (
                            <div className="mb-4 p-4 bg-secondary rounded-lg flex justify-between items-center">
                                <div>
                                    <p className="font-bold">{selectedLoans.length} loan(s) selected</p>
                                    <p className="text-sm">Total selected arrears: {currency} {selectedArrearsTotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                                </div>
                                <div className="flex flex-wrap items-center gap-2">
                                <Button type="button" variant="outline" onClick={exportSelectedArrearsCsv}>
                                    <Download className="mr-2 h-4 w-4" />
                                    Export CSV
                                </Button>
                                <AlertDialog>
                                    <AlertDialogTrigger asChild>
                                        <Button disabled={clearingLoanId === 'bulk'}>
                                            {clearingLoanId === 'bulk' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Coins className="mr-2 h-4 w-4" />}
                                            Clear Selected Arrears
                                        </Button>
                                    </AlertDialogTrigger>
                                    <AlertDialogContent>
                                        <AlertDialogHeader>
                                            <AlertDialogTitle>Confirm Bulk Arrears Clearance</AlertDialogTitle>
                                            <AlertDialogDescription>
                                                This will clear arrears for {selectedLoans.length} selected loans, totaling {currency} {selectedArrearsTotal.toLocaleString()}. Are you sure?
                                            </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                                            <AlertDialogAction onClick={handleBulkClearArrears}>Yes, Clear Arrears</AlertDialogAction>
                                        </AlertDialogFooter>
                                    </AlertDialogContent>
                                </AlertDialog>
                                </div>
                            </div>
                        )}
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead className="w-[50px]">
                                        <Checkbox checked={pagedLoans.length > 0 && pagedLoans.every((l) => selectedLoans.includes(l.id))} onCheckedChange={handleSelectAll} aria-label="Select all on this page" />
                                    </TableHead>
                                    <TableHead>Loan ID</TableHead>
                                    <TableHead>Borrower</TableHead>
                                    <TableHead>Principal</TableHead>
                                    <TableHead>Amount in Arrears</TableHead>
                                    <TableHead>Days in Arrears</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {filteredLoans.length > 0 ? pagedLoans.map(loan => (
                                    <TableRow key={loan.id} data-state={selectedLoans.includes(loan.id) && "selected"}>
                                        <TableCell>
                                            <Checkbox checked={selectedLoans.includes(loan.id)} onCheckedChange={() => handleSelectLoan(loan.id)} aria-label={`Select loan ${loan.loan_id}`} />
                                        </TableCell>
                                        <TableCell>{loan.loan_id}</TableCell>
                                        <TableCell>
                                            {loan.borrowers ? `${loan.borrowers.first_name} ${loan.borrowers.surname}` : '—'}
                                        </TableCell>
                                        <TableCell>{currency} {loan.principal.toLocaleString()}</TableCell>
                                        <TableCell className="font-semibold text-red-600">{currency} {loan.arrearsAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                        <TableCell>{loan.daysInArrears}</TableCell>
                                        <TableCell>
                                            <Badge variant={loan.status === 'delinquent' ? 'warning' : loan.status === 'defaulted' ? 'destructive' : 'secondary'}>
                                                {loan.status}
                                            </Badge>
                                        </TableCell>
                                        <TableCell>
                                            <AlertDialog>
                                                <AlertDialogTrigger asChild>
                                                    <Button variant="outline" size="sm" disabled={clearingLoanId === loan.id || selectedLoans.length > 0}>
                                                        {clearingLoanId === loan.id ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Coins className="mr-2 h-4 w-4" />}
                                                        Clear Arrears
                                                    </Button>
                                                </AlertDialogTrigger>
                                                <AlertDialogContent>
                                                    <AlertDialogHeader>
                                                        <AlertDialogTitle>Confirm Arrears Clearance</AlertDialogTitle>
                                                        <AlertDialogDescription>
                                                            This will record a repayment covering arrears for loan {loan.loan_id}. The amount may be rounded up to the next
                                                            valid multiple of the installment size. Are you sure?
                                                        </AlertDialogDescription>
                                                    </AlertDialogHeader>
                                                    <AlertDialogFooter>
                                                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                                                        <AlertDialogAction onClick={() => handleClearArrears(loan).then(fetchArrearsLoans)}>
                                                            Yes, Clear Arrears
                                                        </AlertDialogAction>
                                                    </AlertDialogFooter>
                                                </AlertDialogContent>
                                            </AlertDialog>
                                        </TableCell>
                                    </TableRow>
                                )) : (
                                    <TableRow>
                                        <TableCell colSpan="8" className="text-center">No loans in arrears.</TableCell>
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

export default ArrearsManagement;