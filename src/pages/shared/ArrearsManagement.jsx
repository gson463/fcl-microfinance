import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase, invokeEdgeFunction } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
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

const EAT_TIMEZONE = 'Africa/Nairobi';
const PAGE_SIZE = 25;

const ArrearsManagement = () => {
    const { user, session } = useAuth();
    const { toast } = useToast();
    const [loans, setLoans] = useState([]);
    const [loading, setLoading] = useState(true);
    const [clearingLoanId, setClearingLoanId] = useState(null);
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

    const fetchArrearsLoans = useCallback(async () => {
        if (!user) return;
        setLoading(true);
        setSelectedLoans([]);

        const { data: config } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
        if (config) {
            setCurrency(config.value);
        }
        
        // Step 1: Force backend to update statuses based on Today's date
        // This ensures the DB status column is as fresh as possible
        await supabase.rpc('update_all_loan_statuses');

        let query = supabase.from('loans').select('*, borrowers(id, first_name, surname)');

        // Role-Based Filtering
        if (user.user_metadata.role === 'officer') {
            query = query.eq('officer_id', user.id);
        } else if (user.user_metadata.role === 'manager') {
            const { data: officers, error: officersError } = await supabase
                .from('users')
                .select('id')
                .eq('branch_id', user.user_metadata.branch_id);

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
    }, [user, toast, currentDate]);

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

    useEffect(() => {
        setPage(1);
    }, [loans.length]);

    const pagedLoans = useMemo(() => {
        const start = (page - 1) * PAGE_SIZE;
        return loans.slice(start, start + PAGE_SIZE);
    }, [loans, page]);

    const totalPages = Math.max(1, Math.ceil(loans.length / PAGE_SIZE));

    const handleClearArrears = async (loan) => {
        if (isHoliday(currentDate)) {
            toast({ title: 'Action Restricted', description: 'Cannot clear arrears on a public holiday.', variant: 'destructive' });
            return false;
        }

        setClearingLoanId(loan.id);
        try {
            const { error } = await invokeEdgeFunction(
                'record-repayment',
                {
                    body: {
                        loan_id: loan.id,
                        amount: loan.arrearsAmount,
                        officer_id: user.id,
                        actual_payment_date: formatTZ(currentDate, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
                    },
                },
                session?.access_token,
            );

            if (error) throw error;
            toast({ title: 'Success', description: `Arrears for loan ${loan.loan_id} cleared.` });
            return true;
        } catch (error) {
            toast({ title: `Failed to clear arrears for ${loan.loan_id}`, description: error.message, variant: 'destructive' });
            return false;
        } finally {
            setClearingLoanId(null);
        }
    };
    
    const handleBulkClearArrears = async () => {
        if (isHoliday(currentDate)) {
            toast({ title: 'Action Restricted', description: 'Cannot clear arrears on a public holiday.', variant: 'destructive' });
            return;
        }

        setClearingLoanId('bulk');
        let successCount = 0;
        const loansToClear = loans.filter(l => selectedLoans.includes(l.id));

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
        const rows = loans.filter((l) => selectedLoans.includes(l.id));
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

    const totalArrears = useMemo(() => loans.reduce((sum, loan) => sum + loan.arrearsAmount, 0), [loans]);
    const selectedArrearsTotal = useMemo(() => loans.filter(l => selectedLoans.includes(l.id)).reduce((sum, l) => sum + l.arrearsAmount, 0), [loans, selectedLoans]);

    if (loading) {
        return <DashboardLayout title="Arrears Management"><div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div></DashboardLayout>;
    }

    return (
        <DashboardLayout title="Arrears Management">
            <div className="space-y-6">
                <Card>
                    <CardHeader>
                        <CardTitle>Total Portfolio in Arrears</CardTitle>
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
                                {loans.length > 0 ? pagedLoans.map(loan => (
                                    <TableRow key={loan.id} data-state={selectedLoans.includes(loan.id) && "selected"}>
                                        <TableCell>
                                            <Checkbox checked={selectedLoans.includes(loan.id)} onCheckedChange={() => handleSelectLoan(loan.id)} aria-label={`Select loan ${loan.loan_id}`} />
                                        </TableCell>
                                        <TableCell>{loan.loan_id}</TableCell>
                                        <TableCell>{loan.borrowers.first_name} {loan.borrowers.surname}</TableCell>
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
                                                            This will record a payment of {currency} {loan.arrearsAmount.toLocaleString()} for loan {loan.loan_id}. Are you sure?
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
                        {loans.length > 0 && (
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                                <p className="text-sm text-muted-foreground">
                                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, loans.length)} of {loans.length}
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