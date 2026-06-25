import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { format, parseISO, subDays } from 'date-fns';
import { format as formatTZ, toZonedTime, formatInTimeZone } from 'date-fns-tz';
import { supabase, invokeEdgeFunction } from '@/lib/customSupabaseClient';
import { formatApiErrorValue } from '@/lib/formatApiError';
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
import { Badge } from '@/components/ui/badge';
import { RepaymentScheduleGrid } from '@/components/loans/RepaymentScheduleGrid';
import { scheduleExportMetaFromLoan } from '@/lib/scheduleExport';
import { Checkbox } from '@/components/ui/checkbox';
import { Edit, Trash2, Calendar as CalendarIcon, FileDown, Download, Eye, Loader2, ArrowRightLeft, TrendingUp, TrendingDown, Scale, PlusCircle, Coins as HandCoins, Search, ChevronLeft, ChevronRight, Layers, ArrowUpCircle } from 'lucide-react';
import * as XLSX from 'xlsx';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { SCHEDULE_DIALOG_CONTENT, SCHEDULE_DIALOG_SCROLL } from '@/lib/dialogLayout';
import { borrowerMatchesCenter, borrowerMatchesGroup } from '@/lib/loanBorrowerLocationFilter';
import { borrowerStatusLabel, borrowerStatusBadgeVariant } from '@/lib/borrowerStatusDisplay';
import {
    getInstallmentUnitFromSchedule,
    isValidRepaymentAmount,
    repaymentAmountValidationMessage,
    REPAYMENT_AMOUNT_INVALID_FALLBACK,
    roundToValidRepaymentAmount,
} from '@/lib/repaymentInstallmentUnit.js';
import { isWorkingDayEAT, todayYyyyMmDdEAT } from '@/lib/workingDayEAT';
import { useUserProfileScope } from '@/hooks/useUserProfileScope';
import { scheduledDueRpcName, normalizeWalletPrepaymentSplitMode, WALLET_PREPAYMENT_ARREARS_ONLY } from '@/lib/walletPrepaymentSplitMode';
import { scheduledCollectionAmount, prepaymentAmount } from '@/lib/repaymentPrepayment';
import { BORROWER_STATUS_FILTER_OPTIONS } from '@/lib/domainStatuses';
import {
    REPAYMENT_PAGE_SIZE,
    LOAN_PICKER_SELECT,
    defaultRepaymentDateRange,
    fetchRepaymentPage,
    fetchRepaymentStatsRows,
    aggregateRepaymentStats,
    fetchAllFilteredRepayments,
} from '@/lib/repaymentManagementQuery';
import { installmentPrincipalInterestPaidDisplay } from '@/lib/installmentScheduleDisplay';

const EAT_TIMEZONE = 'Africa/Nairobi';
const PAGE_SIZE = REPAYMENT_PAGE_SIZE;
/** Native <select> avoids Popover+Dialog focus issues (same as Admin → Add User → Assign Branch). */
const NATIVE_SELECT_DIALOG =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-background';
const NATIVE_SELECT_FILTER =
    'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-background min-w-[200px]';
/** How far back officers may set actual payment date (collections / prepayment). */
const PAYMENT_ACTUAL_DATE_LOOKBACK_DAYS = 90;

function getTodayEATDateForForm() {
    const s = formatInTimeZone(new Date(), EAT_TIMEZONE, 'yyyy-MM-dd');
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
}

/** Minimum allowed repayment: scheduled due for the date, or a token positive if nothing is due (prepayment-only). */
function minimumRepaymentForDue(scheduledDue) {
    const d = Number(scheduledDue);
    if (!Number.isFinite(d) || d < 0) return 0.01;
    return d > 0 ? d : 0.01;
}

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
    const { loading: profileLoading, branchId: officerProfileBranchId } = useUserProfileScope(user?.id);
    const [repayments, setRepayments] = useState([]);
    const [totalRepaymentCount, setTotalRepaymentCount] = useState(0);
    const [statsRows, setStatsRows] = useState([]);
    const [loans, setLoans] = useState([]);
    const [groups, setGroups] = useState([]);
    const [centers, setCenters] = useState([]);
    const [loading, setLoading] = useState(true);
    const [listLoading, setListLoading] = useState(false);
    const [loadAllHistory, setLoadAllHistory] = useState(false);
    const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [currency, setCurrency] = useState('TZS');
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [repaymentDialogOpen, setRepaymentDialogOpen] = useState(false);
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [selectedLoanForSchedule, setSelectedLoanForSchedule] = useState(null);
    const [isRefreshingSchedule, setIsRefreshingSchedule] = useState(false);
    const [currentRepayment, setCurrentRepayment] = useState(null);
    const [editForm, setEditForm] = useState({ amount: '', payment_date: '' });
    /** Wizard: scheduled first (clears arrears + due per schedule), then optional prepayment (backward from last installment). */
    const [recordCollectionStep, setRecordCollectionStep] = useState(() => 'scheduled');
    /** Amount saved in step 1 this session (for banner on step 2); null if user skipped step 1. */
    const [scheduledRecordedInSession, setScheduledRecordedInSession] = useState(null);
    const [repaymentFormData, setRepaymentFormData] = useState(() => ({
        loanId: '',
        /** Cash toward arrears + due on/before payment date (wallet “scheduled”). */
        scheduled_portion: '',
        /** Cash toward future installments from end of schedule (wallet prepayment). */
        prepayment_portion: '',
        payment_date: getTodayEATDateForForm(),
    }));
    const [pickerCenterFilter, setPickerCenterFilter] = useState('all');
    const [pickerGroupFilter, setPickerGroupFilter] = useState('all');
    const [loanPickerSearch, setLoanPickerSearch] = useState('');
    /** Unpaid amount for installments due exactly on the payment date (auto-fill). */
    const [pickerDueOnSelectedDate, setPickerDueOnSelectedDate] = useState(null);
    /** Full unpaid amount due on or before payment date (minimum payment / prepayment split in backend). */
    const [pickerTotalDueOnOrBefore, setPickerTotalDueOnOrBefore] = useState(null);
    const prevPickerDueKeyRef = useRef('');
    const [selectedRepayments, setSelectedRepayments] = useState([]);
    const [pendingDeleteRepaymentIds, setPendingDeleteRepaymentIds] = useState(() => new Set());
    const [holidays, setHolidays] = useState([]);
    /** Matches system_config walletPrepaymentSplitMode — must match record-repayment edge function. */
    const [walletPrepaymentSplitMode, setWalletPrepaymentSplitMode] = useState(WALLET_PREPAYMENT_ARREARS_ONLY);

    // Filters
    const [groupFilter, setGroupFilter] = useState('all');
    const [centerFilter, setCenterFilter] = useState('all');
    const [borrowerStatusFilter, setBorrowerStatusFilter] = useState('all');
    const [dateRangeFilter, setDateRangeFilter] = useState(() => defaultRepaymentDateRange());
    const [searchTerm, setSearchTerm] = useState('');
    const [page, setPage] = useState(1);

    const resetFilters = () => {
        setGroupFilter('all');
        setCenterFilter('all');
        setBorrowerStatusFilter('all');
        setDateRangeFilter(defaultRepaymentDateRange());
        setLoadAllHistory(false);
        setSearchTerm('');
        setSelectedRepayments([]);
        setPage(1);
    };
    
    const resetRepaymentForm = () => {
        setPickerCenterFilter('all');
        setPickerGroupFilter('all');
        setRecordCollectionStep('scheduled');
        setScheduledRecordedInSession(null);
        setRepaymentFormData({
            loanId: '',
            scheduled_portion: '',
            prepayment_portion: '',
            payment_date: getTodayEATDateForForm(),
        });
        setLoanPickerSearch('');
        setPickerDueOnSelectedDate(null);
        setPickerTotalDueOnOrBefore(null);
        prevPickerDueKeyRef.current = '';
    };

    const repaymentFetchFriendlyError = useCallback((error) => {
        const msg = String(error?.message ?? '');
        if (/statement timeout|canceling statement|cancelling statement|timeout expired|query canceled/i.test(msg)) {
            return 'Loading took longer than usual. Try again in a moment.';
        }
        return 'Could not load collections. Check your connection and try again.';
    }, []);

    /**
     * Recompute loan statuses after save/delete — not on every page load.
     */
    const refreshOfficerLoanStatusesInBackground = useCallback(async () => {
        if (!user?.id) return;
        try {
            const { error: scopeStatusErr } = await supabase.rpc('refresh_loan_statuses_for_officer', {
                p_officer_id: user.id,
            });
            if (scopeStatusErr) {
                const legacy =
                    /does not exist|42883|refresh_loan_statuses_for_officer/i.test(String(scopeStatusErr.message ?? '')) ||
                    String(scopeStatusErr.message ?? '').includes('refresh_loan_statuses_for_officer');
                if (legacy) {
                    try {
                        await supabase.rpc('update_all_loan_statuses');
                    } catch (e) {
                        console.warn('update_all_loan_statuses fallback', e);
                    }
                } else {
                    console.warn('refresh_loan_statuses_for_officer', scopeStatusErr);
                    return;
                }
            }
            const { data: freshLoans, error: lfErr } = await supabase
                .from('loans')
                .select(LOAN_PICKER_SELECT)
                .eq('officer_id', user.id);
            if (!lfErr && freshLoans) setLoans(freshLoans);
        } catch (e) {
            console.warn('loan status reconciliation after save', e);
        }
    }, [user?.id]);

    const listFilters = useMemo(
        () => ({
            singleOfficerId: user?.id,
            dateRange: dateRangeFilter,
            loadAllHistory,
            centerFilter,
            groupFilter,
            borrowerStatusFilter,
            searchTerm: debouncedSearchTerm,
        }),
        [
            user?.id,
            dateRangeFilter,
            loadAllHistory,
            centerFilter,
            groupFilter,
            borrowerStatusFilter,
            debouncedSearchTerm,
        ],
    );

    const fetchMetadata = useCallback(async () => {
        if (!user || profileLoading) return;
        setLoading(true);
        try {
            const bid = officerProfileBranchId ?? user.user_metadata?.branch_id;
            let centersQuery = supabase.from('centers').select('id, name').eq('loan_officer_id', user.id).order('name');
            if (bid) {
                centersQuery = centersQuery.eq('branch_id', bid);
            }

            const [configRes, loansRes, pendingRes, groupsRes, holidaysRes, splitRes, centersRes] =
                await Promise.all([
                    supabase.from('system_config').select('value').eq('key', 'currency').maybeSingle(),
                    supabase.from('loans').select(LOAN_PICKER_SELECT).eq('officer_id', user.id),
                    supabase
                        .from('repayment_delete_requests')
                        .select('repayment_id')
                        .eq('officer_id', user.id)
                        .eq('status', 'pending'),
                    supabase.from('groups').select('*').eq('loan_officer_id', user.id),
                    supabase.from('holidays').select('date'),
                    supabase.from('system_config').select('value').eq('key', 'walletPrepaymentSplitMode').maybeSingle(),
                    centersQuery,
                ]);

            if (configRes.error) throw configRes.error;
            if (loansRes.error) throw loansRes.error;
            if (groupsRes.error) throw groupsRes.error;
            if (centersRes.error) throw centersRes.error;

            if (configRes.data?.value) setCurrency(configRes.data.value);
            setLoans(loansRes.data || []);
            setPendingDeleteRepaymentIds(new Set((pendingRes.data || []).map((p) => p.repayment_id)));
            setGroups(groupsRes.data || []);
            setCenters(centersRes.data || []);
            setHolidays(holidaysRes.data || []);
            setWalletPrepaymentSplitMode(normalizeWalletPrepaymentSplitMode(splitRes.data?.value));
        } catch (error) {
            console.error(error);
            toast({
                title: 'Could not load prepayments',
                description: repaymentFetchFriendlyError(error),
                variant: 'destructive',
            });
        } finally {
            setLoading(false);
        }
    }, [user, profileLoading, officerProfileBranchId, toast, repaymentFetchFriendlyError]);

    const fetchRepaymentList = useCallback(async () => {
        if (!user?.id || profileLoading) return;
        setListLoading(true);
        try {
            const [pageResult, statsData] = await Promise.all([
                fetchRepaymentPage({ supabase, filters: listFilters, page }),
                fetchRepaymentStatsRows({ supabase, filters: listFilters }),
            ]);
            setRepayments(pageResult.rows);
            setTotalRepaymentCount(pageResult.totalCount);
            setStatsRows(statsData);
            setSelectedRepayments([]);
        } catch (error) {
            console.error(error);
            toast({
                title: 'Could not load collections',
                description: repaymentFetchFriendlyError(error),
                variant: 'destructive',
            });
        } finally {
            setListLoading(false);
        }
    }, [user?.id, profileLoading, listFilters, page, toast, repaymentFetchFriendlyError]);

    const refreshAfterMutation = useCallback(async () => {
        await fetchMetadata();
        await fetchRepaymentList();
        void refreshOfficerLoanStatusesInBackground();
    }, [fetchMetadata, fetchRepaymentList, refreshOfficerLoanStatusesInBackground]);

    useEffect(() => {
        fetchMetadata();
    }, [fetchMetadata]);

    useEffect(() => {
        fetchRepaymentList();
    }, [fetchRepaymentList]);

    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearchTerm(searchTerm), 350);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    useEffect(() => {
        setPage(1);
    }, [centerFilter, groupFilter, borrowerStatusFilter, dateRangeFilter, loadAllHistory, debouncedSearchTerm]);

    useEffect(() => {
        const id = repaymentFormData.loanId;
        if (!id) return;
        let cancelled = false;
        (async () => {
            const { data: row, error } = await supabase.from('loans').select('schedule').eq('id', id).maybeSingle();
            if (cancelled || error || !row?.schedule) return;
            setLoans((prev) => {
                const existing = prev.find((l) => l.id === id);
                if (existing?.schedule) return prev;
                return prev.map((l) => (l.id === id ? { ...l, schedule: row.schedule } : l));
            });
        })();
        return () => {
            cancelled = true;
        };
    }, [repaymentFormData.loanId]);

    /** Keep group filter valid when center changes (portfolio table). */
    useEffect(() => {
        if (groupFilter === 'all') return;
        const g = groups.find((x) => x.id === groupFilter);
        if (!g) {
            setGroupFilter('all');
            return;
        }
        if (centerFilter !== 'all' && g.center_id !== centerFilter) {
            setGroupFilter('all');
        }
    }, [centerFilter, groupFilter, groups]);

    /** Keep record-dialog group valid when center changes. */
    useEffect(() => {
        if (pickerGroupFilter === 'all') return;
        const g = groups.find((x) => x.id === pickerGroupFilter);
        if (!g) {
            setPickerGroupFilter('all');
            return;
        }
        if (pickerCenterFilter !== 'all' && g.center_id !== pickerCenterFilter) {
            setPickerGroupFilter('all');
        }
    }, [pickerCenterFilter, pickerGroupFilter, groups]);

    useEffect(() => {
        let cancelled = false;
        const id = repaymentFormData.loanId;
        const payDate = formatInTimeZone(repaymentFormData.payment_date, EAT_TIMEZONE, 'yyyy-MM-dd');
        const key = `${id}|${payDate}`;

        if (!id) {
            setPickerDueOnSelectedDate(null);
            setPickerTotalDueOnOrBefore(null);
            prevPickerDueKeyRef.current = '';
            return;
        }

        const loan = loans.find((l) => l.id === id);
        if (!loan) {
            setPickerDueOnSelectedDate(null);
            setPickerTotalDueOnOrBefore(null);
            return;
        }

        (async () => {
            const dueRpc = scheduledDueRpcName(walletPrepaymentSplitMode);
            const [onDateRes, totalRes] = await Promise.all([
                supabase.rpc('scheduled_due_on_date_only', {
                    p_schedule: loan.schedule ?? null,
                    p_payment_date: payDate,
                }),
                supabase.rpc(dueRpc, {
                    p_schedule: loan.schedule ?? null,
                    p_payment_date: payDate,
                }),
            ]);
            if (cancelled) return;
            if (onDateRes.error) {
                console.error(onDateRes.error);
                setPickerDueOnSelectedDate(null);
            } else {
                setPickerDueOnSelectedDate(Number(onDateRes.data ?? 0));
            }
            if (totalRes.error) {
                console.error(totalRes.error);
                setPickerTotalDueOnOrBefore(null);
            } else {
                setPickerTotalDueOnOrBefore(Number(totalRes.data ?? 0));
            }
            if (onDateRes.error && totalRes.error) {
                return;
            }

            const onDate = Number(onDateRes.data ?? 0);
            const totalDue = Number(totalRes.data ?? 0);
            const unit = getInstallmentUnitFromSchedule(loan.schedule);
            const shouldAutoFill = prevPickerDueKeyRef.current !== key;
            prevPickerDueKeyRef.current = key;
            if (shouldAutoFill) {
                if (unit == null) {
                    if (onDate > 0) {
                        setRepaymentFormData((prev) =>
                            prev.loanId === id
                                ? { ...prev, scheduled_portion: onDate.toFixed(2), prepayment_portion: '0' }
                                : prev
                        );
                    } else {
                        setRepaymentFormData((prev) =>
                            prev.loanId === id ? { ...prev, scheduled_portion: '', prepayment_portion: '' } : prev
                        );
                    }
                } else {
                    const dueForMin = Math.max(totalDue, onDate);
                    if (dueForMin <= 0) {
                        setRepaymentFormData((prev) =>
                            prev.loanId === id ? { ...prev, scheduled_portion: '', prepayment_portion: '' } : prev
                        );
                    } else {
                        const snapped = roundToValidRepaymentAmount(dueForMin, totalDue, unit);
                        setRepaymentFormData((prev) =>
                            prev.loanId === id
                                ? { ...prev, scheduled_portion: snapped.toFixed(2), prepayment_portion: '0' }
                                : prev
                        );
                    }
                }
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [repaymentFormData.loanId, repaymentFormData.payment_date, loans, walletPrepaymentSplitMode]);

    /** When center is "all", list all groups so filters work without picking a center first. */
    const groupsForFilter = useMemo(() => {
        if (centerFilter === 'all') return groups;
        return groups.filter((g) => g.center_id === centerFilter);
    }, [groups, centerFilter]);

    const pagedRepayments = repayments;
    const totalPages = Math.max(1, Math.ceil(totalRepaymentCount / PAGE_SIZE));

    const stats = useMemo(() => {
        const base = aggregateRepaymentStats(statsRows);
        const relevantLoans = loans.filter((l) => {
            const b = l.borrowers;
            const centerMatch = borrowerMatchesCenter(b, centerFilter);
            const groupMatch = borrowerMatchesGroup(b, groupFilter);
            const statusMatch =
                borrowerStatusFilter === 'all' || b?.status === borrowerStatusFilter;

            const searchLower = debouncedSearchTerm.toLowerCase();
            const loanId = l.loan_id?.toLowerCase() || '';
            const fName = l.borrowers?.first_name?.toLowerCase() || '';
            const sName = l.borrowers?.surname?.toLowerCase() || '';
            const borrowerName = `${fName} ${sName}`;
            const borrowerId = l.borrowers?.borrower_id?.toLowerCase() || '';

            const searchMatch =
                !debouncedSearchTerm ||
                loanId.includes(searchLower) ||
                borrowerName.includes(searchLower) ||
                borrowerId.includes(searchLower);

            return centerMatch && groupMatch && statusMatch && searchMatch;
        });

        const totalOutstandingPrincipal = relevantLoans.reduce((sum, loan) => {
            if (loan.status === 'paid' || loan.status === 'written_off') return sum;
            const bal = Number(loan.balance);
            if (Number.isFinite(bal)) return sum + Math.max(0, bal);
            return sum;
        }, 0);

        return { ...base, totalOutstandingPrincipal };
    }, [
        statsRows,
        loans,
        centerFilter,
        groupFilter,
        borrowerStatusFilter,
        debouncedSearchTerm,
    ]);

    const handleEdit = (repayment) => {
        if (!isWorkingDayEAT(todayYyyyMmDdEAT(), holidays)) {
            toast({
                title: 'Non-working day',
                description: 'Editing collections is not available on Sundays or public holidays.',
                variant: 'destructive',
            });
            return;
        }
        setCurrentRepayment(repayment);
        setEditForm({
            amount: repayment.amount,
            payment_date: format(parseISO(repayment.actual_payment_date), 'yyyy-MM-dd')
        });
        setEditDialogOpen(true);
    };

    const handleUpdateRepayment = async (e) => {
        e.preventDefault();
        if (!isWorkingDayEAT(String(editForm.payment_date || '').slice(0, 10), holidays)) {
            toast({
                title: 'Invalid date',
                description: 'Payment date must be a working day (Monday–Saturday, not a public holiday).',
                variant: 'destructive',
            });
            return;
        }
        setIsSubmitting(true);
        try {
            if (!currentRepayment) throw new Error("No repayment selected for update.");

            const { error: updateError } = await supabase
                .from('repayments')
                .update({ amount: editForm.amount, actual_payment_date: editForm.payment_date, payment_date: editForm.payment_date })
                .eq('id', currentRepayment.id);
            if (updateError) throw updateError;

            const { error: prepErr } = await supabase.rpc('repayment_recompute_prepayment', {
                p_repayment_id: currentRepayment.id,
            });
            if (prepErr) throw prepErr;

            const { error: stErr } = await supabase.rpc('refresh_loan_status_for_id', {
                p_loan_id: currentRepayment.loan_id,
            });
            if (stErr) throw stErr;
            const { error: syncErr } = await supabase.rpc('sync_borrower_paid_up_for', {
                p_borrower_id: currentRepayment.borrower_id,
            });
            if (syncErr) throw syncErr;

            toast({ title: 'Success', description: 'Repayment updated successfully.' });
            setEditDialogOpen(false);
            refreshAfterMutation();
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
            const { error: stErr } = await supabase.rpc('refresh_loan_status_for_id', { p_loan_id: loan.id });
            if (stErr) throw stErr;
            const { error: syncErr } = await supabase.rpc('sync_borrower_paid_up_for', {
                p_borrower_id: loan.borrower_id,
            });
            if (syncErr) throw syncErr;

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
    
    const parseRecordError = (data, error) => {
        const bodyError =
            data && typeof data === 'object' && data !== null && 'error' in data && data.error != null
                ? formatApiErrorValue(data.error)
                : null;
        return (
            bodyError ||
            (error?.context && typeof error.context === 'object' && error.context.body
                ? (() => {
                      try {
                          const j = JSON.parse(String(error.context.body));
                          return j?.error != null ? formatApiErrorValue(j.error) : null;
                      } catch {
                          return null;
                      }
                  })()
                : null) ||
            error?.message ||
            null
        );
    };

    /**
     * Shared edge invoke. Two-step flow: first record scheduled (forward), then optional prepayment (backward in schedule engine).
     */
    const submitRecordRepaymentPortions = async (schedNum, prepNum, { closeDialog = true, successDescription } = {}) => {
        const { loanId, payment_date } = repaymentFormData;
        if (!loanId) {
            toast({ title: 'Error', description: 'Please select a loan.', variant: 'destructive' });
            return false;
        }
        if (!payment_date) {
            toast({ title: 'Error', description: 'Please select the payment date.', variant: 'destructive' });
            return false;
        }
        if (!user?.id) {
            toast({ title: 'Error', description: 'You must be signed in to record a repayment.', variant: 'destructive' });
            return false;
        }
        const payStr = formatInTimeZone(payment_date, EAT_TIMEZONE, 'yyyy-MM-dd');
        const todayStr = formatInTimeZone(new Date(), EAT_TIMEZONE, 'yyyy-MM-dd');
        const todayEAT = getTodayEATDateForForm();
        const minStr = formatInTimeZone(subDays(todayEAT, PAYMENT_ACTUAL_DATE_LOOKBACK_DAYS), EAT_TIMEZONE, 'yyyy-MM-dd');
        if (payStr > todayStr) {
            toast({
                title: 'Invalid date',
                description: 'Actual payment date cannot be in the future.',
                variant: 'destructive',
            });
            return false;
        }
        if (payStr < minStr) {
            toast({
                title: 'Invalid date',
                description: `Actual payment date cannot be more than ${PAYMENT_ACTUAL_DATE_LOOKBACK_DAYS} days ago.`,
                variant: 'destructive',
            });
            return false;
        }
        if (!isWorkingDayEAT(payStr, holidays)) {
            toast({
                title: 'Invalid date',
                description: 'Actual payment date must be a working day (Monday–Saturday, not a public holiday).',
                variant: 'destructive',
            });
            return false;
        }

        if (!Number.isFinite(schedNum) || !Number.isFinite(prepNum) || schedNum < 0 || prepNum < 0) {
            toast({
                title: 'Error',
                description: 'Enter valid non-negative amounts.',
                variant: 'destructive',
            });
            return false;
        }
        const amt = schedNum + prepNum;
        if (!Number.isFinite(amt) || amt <= 0) {
            toast({ title: 'Error', description: 'Amount must be greater than zero.', variant: 'destructive' });
            return false;
        }

        const loan = loans.find((l) => l.id === loanId);
        if (!loan) {
            toast({ title: 'Error', description: 'Loan not found. Refresh and try again.', variant: 'destructive' });
            return false;
        }

        const unit = getInstallmentUnitFromSchedule(loan.schedule);
        const dueRpc = scheduledDueRpcName(walletPrepaymentSplitMode);
        const { data: dueRaw, error: dueErr } = await supabase.rpc(dueRpc, {
            p_schedule: loan.schedule ?? null,
            p_payment_date: payStr,
        });
        if (dueErr) {
            toast({
                title: 'Could not verify scheduled due',
                description: dueErr.message || 'Try again.',
                variant: 'destructive',
            });
            return false;
        }
        const due = Number(dueRaw ?? 0);
        if (!isValidRepaymentAmount(amt, due, unit)) {
            toast({
                title: 'Invalid amount',
                description:
                    repaymentAmountValidationMessage(amt, due, unit, currency) ||
                    REPAYMENT_AMOUNT_INVALID_FALLBACK,
                variant: 'destructive',
            });
            return false;
        }

        setIsSubmitting(true);
        try {
            const { data, error } = await invokeEdgeFunction(
                'record-repayment',
                {
                    body: {
                        loan_id: loanId,
                        amount: amt,
                        scheduled_portion: schedNum,
                        prepayment_portion: prepNum,
                        wallet_split_explicit: true,
                        officer_id: user.id,
                        actual_payment_date: formatTZ(payment_date, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
                    },
                },
                session?.access_token,
            );

            const description = parseRecordError(data, error);
            if (error || description) {
                toast({
                    title: 'Repayment failed',
                    description: description || 'Could not record repayment.',
                    variant: 'destructive',
                });
                return false;
            }

            toast({
                title: 'Success',
                description: successDescription ?? 'Collection recorded successfully!',
            });
            await refreshAfterMutation();
            if (closeDialog) {
                setRepaymentDialogOpen(false);
                resetRepaymentForm();
            }
            return true;
        } catch (e) {
            toast({
                title: 'Repayment failed',
                description: formatApiErrorValue(e) || 'Unexpected error. Check your connection and try again.',
                variant: 'destructive',
            });
            return false;
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleRecordScheduledContinue = async () => {
        const rawS = String(repaymentFormData.scheduled_portion ?? '').trim();
        const s = rawS === '' ? 0 : parseFloat(rawS.replace(/,/g, ''));
        if (!Number.isFinite(s) || s <= 0) {
            toast({
                title: 'Enter scheduled amount',
                description: 'Enter the scheduled collection amount (arrears + due today), or use “Prepayment only” below.',
                variant: 'destructive',
            });
            return;
        }
        const ok = await submitRecordRepaymentPortions(s, 0, {
            closeDialog: false,
            successDescription:
                'Scheduled collection saved. Next: enter prepayment (optional), or tap Done.',
        });
        if (ok) {
            setScheduledRecordedInSession(s);
            setRecordCollectionStep('prepayment');
            setRepaymentFormData((prev) => ({ ...prev, scheduled_portion: '', prepayment_portion: '' }));
        }
    };

    const handleSkipToPrepaymentOnly = () => {
        setScheduledRecordedInSession(null);
        setRecordCollectionStep('prepayment');
        setRepaymentFormData((prev) => ({ ...prev, scheduled_portion: '', prepayment_portion: '' }));
    };

    const handleBackToScheduledStep = () => {
        setRecordCollectionStep('scheduled');
    };

    const handleRecordPrepaymentFinish = async () => {
        const rawP = String(repaymentFormData.prepayment_portion ?? '').trim();
        const p = rawP === '' ? 0 : parseFloat(rawP.replace(/,/g, ''));
        if (!Number.isFinite(p) || p < 0) {
            toast({ title: 'Error', description: 'Enter a valid prepayment amount.', variant: 'destructive' });
            return;
        }
        if (p <= 0) {
            setRepaymentDialogOpen(false);
            resetRepaymentForm();
            return;
        }
        await submitRecordRepaymentPortions(0, p, {
            closeDialog: true,
            successDescription: 'Prepayment recorded.',
        });
    };

    const handleWizardDoneNoPrepayment = () => {
        setRepaymentDialogOpen(false);
        resetRepaymentForm();
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
            fetchRepaymentList();
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
            fetchRepaymentList();
        } catch (error) {
            toast({ title: 'Error', description: error.message, variant: 'destructive' });
        } finally {
            setIsSubmitting(false);
        }
    };
    
    const handleExportSelectedRepaymentsCsv = () => {
        const rows = repayments.filter((r) => selectedRepayments.includes(r.id));
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
            { header: 'Scheduled collection', accessor: (r) => String(scheduledCollectionAmount(r)) },
            { header: 'Prepayment', accessor: (r) => String(prepaymentAmount(r)) },
        ], rows);
        toast({ title: 'Exported', description: `${rows.length} repayment(s) to CSV.` });
    };

    const handleExport = async (loan) => {
        if (!loan || !loan.borrowers) {
            toast({ title: 'Error', description: 'Cannot export, loan data is incomplete.', variant: 'destructive' });
            return;
        }

        let exportLoan = loan;
        if (!exportLoan.schedule) {
            const { data: fullLoan, error } = await supabase
                .from('loans')
                .select(`${LOAN_PICKER_SELECT}, schedule`)
                .eq('id', loan.id)
                .single();
            if (error || !fullLoan?.schedule) {
                toast({ title: 'Error', description: 'Could not load loan schedule for export.', variant: 'destructive' });
                return;
            }
            exportLoan = fullLoan;
        }

        const borrower = exportLoan.borrowers;
        const group = borrower.groups;

        const summaryData = [
            { 'Field': 'Borrower Name', 'Value': `${borrower.first_name} ${borrower.surname}` },
            { 'Field': 'Borrower ID', 'Value': borrower.borrower_id },
            { 'Field': 'Phone Number', 'Value': borrower.phone_number },
            { 'Field': 'Group', 'Value': group ? group.name : 'N/A' },
            { 'Field': 'Loan ID', 'Value': exportLoan.loan_id },
            { 'Field': 'Principal Amount', 'Value': exportLoan.principal, 'Format': 'currency' },
            { 'Field': 'Total Payable', 'Value': exportLoan.total_payable, 'Format': 'currency' },
            { 'Field': 'Outstanding Balance', 'Value': exportLoan.balance, 'Format': 'currency' },
            { 'Field': 'Loan Status', 'Value': exportLoan.status },
        ];

        const scheduleData = exportLoan.schedule.map((inst) => {
            const pi = installmentPrincipalInterestPaidDisplay(inst, exportLoan);
            const paid = Number(inst.paidAmount ?? inst.paid_amount ?? 0) || 0;
            return {
            'Installment No.': inst.installmentNumber,
            'Due Date': formatTZ(toZonedTime(new Date(inst.dueDate), EAT_TIMEZONE), 'yyyy-MM-dd'),
            'Amount Due': inst.amount,
            'Principal Component': inst.principalComponent,
            'Interest Component': inst.interestComponent,
            'Amount Paid': paid,
            'Principal Paid': pi.principalPaid,
            'Interest Paid': pi.interestPaid,
            'Balance': inst.amount - paid,
            'Status': inst.status,
        };
        });

        const { data: loanRepaymentRows, error: repErr } = await supabase
            .from('repayments')
            .select('actual_payment_date, principal_paid, interest_paid, amount')
            .eq('loan_id', exportLoan.id)
            .order('actual_payment_date', { ascending: true });
        if (repErr) {
            toast({ title: 'Error', description: 'Could not load payments for export.', variant: 'destructive' });
            return;
        }

        const repaymentsForLoan = (loanRepaymentRows || []).map((r) => ({
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

    const groupsForRecordPicker = useMemo(() => {
        if (pickerCenterFilter === 'all') return groups;
        return groups.filter((g) => g.center_id === pickerCenterFilter);
    }, [groups, pickerCenterFilter]);

    const loansForRecordPicker = useMemo(() => {
        return loans.filter((l) => {
            if (!l.borrowers) return false;
            if (l.status !== 'active' && l.status !== 'delinquent') return false;
            if (!borrowerMatchesCenter(l.borrowers, pickerCenterFilter)) return false;
            if (!borrowerMatchesGroup(l.borrowers, pickerGroupFilter)) return false;
            return true;
        });
    }, [loans, pickerCenterFilter, pickerGroupFilter]);

    const loanOptionsForRecordPicker = useMemo(
        () =>
            loansForRecordPicker.map((l) => ({
                value: l.id,
                label: `${l.borrowers.first_name} ${l.borrowers.surname} — ${l.loan_id}`,
            })),
        [loansForRecordPicker]
    );

    const filteredLoanPickerOptions = useMemo(() => {
        const q = loanPickerSearch.trim().toLowerCase();
        if (!q) return loanOptionsForRecordPicker;
        return loanOptionsForRecordPicker.filter(
            (o) =>
                o.label.toLowerCase().includes(q) ||
                String(o.value).toLowerCase().includes(q)
        );
    }, [loanOptionsForRecordPicker, loanPickerSearch]);

    const todayStrEAT = formatInTimeZone(new Date(), EAT_TIMEZONE, 'yyyy-MM-dd');
    const minPaymentDateStrEAT = formatInTimeZone(
        subDays(getTodayEATDateForForm(), PAYMENT_ACTUAL_DATE_LOOKBACK_DAYS),
        EAT_TIMEZONE,
        'yyyy-MM-dd'
    );

    const pickerInstallmentUnit = useMemo(() => {
        const loan = loans.find((l) => l.id === repaymentFormData.loanId);
        return loan ? getInstallmentUnitFromSchedule(loan.schedule) : null;
    }, [repaymentFormData.loanId, loans]);

    /** Step 1: scheduled amount only — must be valid installment multiple when &gt; 0. */
    const scheduledStepError = useMemo(() => {
        if (recordCollectionStep !== 'scheduled') return '';
        if (!repaymentFormData.loanId) return '';
        const loan = loans.find((l) => l.id === repaymentFormData.loanId);
        if (!loan || pickerInstallmentUnit == null || pickerTotalDueOnOrBefore == null) return '';
        const rawS = String(repaymentFormData.scheduled_portion ?? '').trim();
        const s = rawS === '' ? 0 : parseFloat(rawS.replace(/,/g, ''));
        if (!Number.isFinite(s) || s < 0) return '';
        if (s <= 0) return '';
        const due = Number(pickerTotalDueOnOrBefore ?? 0);
        if (isValidRepaymentAmount(s, due, pickerInstallmentUnit)) return '';
        return (
            repaymentAmountValidationMessage(s, due, pickerInstallmentUnit, currency) ||
            REPAYMENT_AMOUNT_INVALID_FALLBACK
        );
    }, [
        recordCollectionStep,
        repaymentFormData.loanId,
        repaymentFormData.scheduled_portion,
        loans,
        pickerInstallmentUnit,
        pickerTotalDueOnOrBefore,
        currency,
    ]);

    /** Step 2: prepayment line only — valid multiple when &gt; 0. */
    const prepaymentStepError = useMemo(() => {
        if (recordCollectionStep !== 'prepayment') return '';
        if (!repaymentFormData.loanId) return '';
        const loan = loans.find((l) => l.id === repaymentFormData.loanId);
        if (!loan || pickerInstallmentUnit == null || pickerTotalDueOnOrBefore == null) return '';
        const rawP = String(repaymentFormData.prepayment_portion ?? '').trim();
        const p = rawP === '' ? 0 : parseFloat(rawP.replace(/,/g, ''));
        if (!Number.isFinite(p) || p < 0) return '';
        if (p <= 0) return '';
        const due = Number(pickerTotalDueOnOrBefore ?? 0);
        if (isValidRepaymentAmount(p, due, pickerInstallmentUnit)) return '';
        return (
            repaymentAmountValidationMessage(p, due, pickerInstallmentUnit, currency) ||
            REPAYMENT_AMOUNT_INVALID_FALLBACK
        );
    }, [
        recordCollectionStep,
        repaymentFormData.loanId,
        repaymentFormData.prepayment_portion,
        loans,
        pickerInstallmentUnit,
        pickerTotalDueOnOrBefore,
        currency,
    ]);

    const recordCollectionTotal = useMemo(() => {
        const rawS = String(repaymentFormData.scheduled_portion ?? '').trim();
        const rawP = String(repaymentFormData.prepayment_portion ?? '').trim();
        const s = rawS === '' ? 0 : parseFloat(rawS.replace(/,/g, ''));
        const p = rawP === '' ? 0 : parseFloat(rawP.replace(/,/g, ''));
        if (!Number.isFinite(s) || !Number.isFinite(p) || s < 0 || p < 0) return null;
        return recordCollectionStep === 'scheduled' ? s : p;
    }, [repaymentFormData.scheduled_portion, repaymentFormData.prepayment_portion, recordCollectionStep]);

    const snapScheduledField = useCallback(() => {
        setRepaymentFormData((prev) => {
            if (!prev.loanId || pickerInstallmentUnit == null) return prev;
            const s = parseFloat(String(prev.scheduled_portion ?? '').replace(/,/g, '')) || 0;
            if (s <= 0) return prev;
            const snapped = roundToValidRepaymentAmount(s, pickerTotalDueOnOrBefore ?? 0, pickerInstallmentUnit);
            return { ...prev, scheduled_portion: snapped.toFixed(2) };
        });
    }, [pickerInstallmentUnit, pickerTotalDueOnOrBefore]);

    const snapPrepaymentField = useCallback(() => {
        setRepaymentFormData((prev) => {
            if (!prev.loanId || pickerInstallmentUnit == null) return prev;
            const p = parseFloat(String(prev.prepayment_portion ?? '').replace(/,/g, '')) || 0;
            if (p <= 0) return prev;
            const snapped = roundToValidRepaymentAmount(p, pickerTotalDueOnOrBefore ?? 0, pickerInstallmentUnit);
            return { ...prev, prepayment_portion: snapped.toFixed(2) };
        });
    }, [pickerInstallmentUnit, pickerTotalDueOnOrBefore]);

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

    if (loading) return <DashboardLayout title="Collections"><Loader2 className="h-8 w-8 animate-spin mx-auto mt-8" /></DashboardLayout>;

    return (
        <DashboardLayout title="Collections">
            <div className="space-y-6">
                 <div className="flex justify-end">
                    <Dialog
                        open={repaymentDialogOpen}
                        onOpenChange={(open) => {
                            if (open) {
                                if (!isWorkingDayEAT(todayYyyyMmDdEAT(), holidays)) {
                                    toast({
                                        title: 'Non-working day',
                                        description:
                                            'Recording collections is not available on Sundays or public holidays.',
                                        variant: 'destructive',
                                    });
                                    return;
                                }
                                resetRepaymentForm();
                            }
                            setRepaymentDialogOpen(open);
                        }}
                    >
                        <DialogTrigger asChild>
                            <Button type="button">
                                <PlusCircle className="mr-2 h-4 w-4" /> Record Collection
                            </Button>
                        </DialogTrigger>
                        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
                            <DialogHeader>
                                <DialogTitle>Record New Collection</DialogTitle>
                                <DialogDescription>
                                    {recordCollectionStep === 'scheduled'
                                        ? 'Step 1: Record scheduled collection first — it clears arrears and installments due on or before the payment date (forward on the schedule).'
                                        : 'Step 2: Optionally record prepayment — the system applies it from the last installment backward (same rules as the loan schedule engine).'}
                                </DialogDescription>
                                <div className="flex items-center gap-2 pt-2 text-xs font-medium text-muted-foreground">
                                    <span className={recordCollectionStep === 'scheduled' ? 'text-foreground' : ''}>
                                        1 · Scheduled
                                    </span>
                                    <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                                    <span className={recordCollectionStep === 'prepayment' ? 'text-foreground' : ''}>
                                        2 · Prepayment
                                    </span>
                                </div>
                            </DialogHeader>
                            <div className="space-y-4 py-2">
                                <div className="grid gap-3 sm:grid-cols-2">
                                    <div className="space-y-2">
                                        <Label htmlFor="record-center">Center</Label>
                                        <select
                                            id="record-center"
                                            className={NATIVE_SELECT_DIALOG}
                                            disabled={recordCollectionStep === 'prepayment'}
                                            value={pickerCenterFilter}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                setPickerCenterFilter(v);
                                                setPickerGroupFilter('all');
                                                setRepaymentFormData((prev) => ({ ...prev, loanId: '' }));
                                            }}
                                        >
                                            <option value="all">All centers</option>
                                            {centers.map((c) => (
                                                <option key={c.id} value={c.id}>
                                                    {c.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div className="space-y-2">
                                        <Label htmlFor="record-group">Group</Label>
                                        <select
                                            id="record-group"
                                            className={NATIVE_SELECT_DIALOG}
                                            value={pickerGroupFilter}
                                            disabled={groups.length === 0 || recordCollectionStep === 'prepayment'}
                                            onChange={(e) => {
                                                const v = e.target.value;
                                                setPickerGroupFilter(v);
                                                setRepaymentFormData((prev) => ({ ...prev, loanId: '' }));
                                            }}
                                        >
                                            <option value="all">
                                                {groups.length === 0 ? 'No groups yet' : 'All groups'}
                                            </option>
                                            {groupsForRecordPicker.map((g) => (
                                                <option key={g.id} value={g.id}>
                                                    {g.name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
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
                                            disabled={recordCollectionStep === 'prepayment'}
                                        />
                                    </div>
                                    <div
                                        className="max-h-[200px] overflow-y-auto rounded-md border border-input bg-muted/30"
                                        role="listbox"
                                        aria-label="Matching loans"
                                    >
                                        {filteredLoanPickerOptions.length === 0 ? (
                                            <p className="py-6 text-center text-sm text-muted-foreground">
                                                {loanOptionsForRecordPicker.length === 0
                                                    ? 'No active or delinquent loans for this center/group. Adjust filters or disburse a loan first.'
                                                    : 'No loans match your search.'}
                                            </p>
                                        ) : (
                                            filteredLoanPickerOptions.map((opt) => (
                                                <button
                                                    key={opt.value}
                                                    type="button"
                                                    role="option"
                                                    disabled={recordCollectionStep === 'prepayment'}
                                                    aria-selected={repaymentFormData.loanId === opt.value}
                                                    onClick={() =>
                                                        setRepaymentFormData((prev) => ({ ...prev, loanId: opt.value }))
                                                    }
                                                    className={cn(
                                                        'flex w-full items-start gap-2 border-b border-border/60 px-3 py-2.5 text-left text-sm last:border-0 transition-colors hover:bg-accent disabled:pointer-events-none disabled:opacity-50',
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
                                            {loanOptionsForRecordPicker.find((o) => o.value === repaymentFormData.loanId)?.label ??
                                                repaymentFormData.loanId}
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <Label htmlFor="payment-date">Actual payment date</Label>
                                    <Input
                                        id="payment-date"
                                        type="date"
                                        className="font-mono"
                                        disabled={recordCollectionStep === 'prepayment'}
                                        min={minPaymentDateStrEAT}
                                        max={todayStrEAT}
                                        value={
                                            repaymentFormData.payment_date
                                                ? formatInTimeZone(
                                                      repaymentFormData.payment_date,
                                                      EAT_TIMEZONE,
                                                      'yyyy-MM-dd'
                                                  )
                                                : todayStrEAT
                                        }
                                        onChange={(e) => {
                                            const v = e.target.value;
                                            if (!v) return;
                                            const [y, m, d] = v.split('-').map(Number);
                                            if (!y || !m || !d) return;
                                            setRepaymentFormData((prev) => ({
                                                ...prev,
                                                payment_date: new Date(y, m - 1, d),
                                            }));
                                        }}
                                    />
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Drives which installments count as “due” for this visit. Locked after step 1. Last{' '}
                                        {PAYMENT_ACTUAL_DATE_LOOKBACK_DAYS} working days (Africa/Nairobi); Sundays and holidays
                                        blocked on submit.
                                    </p>
                                </div>
                                {recordCollectionStep === 'scheduled' ? (
                                    <div className="space-y-3">
                                        <div>
                                            <Label htmlFor="scheduled-portion">
                                                Scheduled collection ({currency}) — arrears + due on/before payment date
                                            </Label>
                                            <Input
                                                id="scheduled-portion"
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={repaymentFormData.scheduled_portion}
                                                aria-invalid={scheduledStepError ? true : undefined}
                                                className={cn(scheduledStepError && 'border-destructive')}
                                                onChange={(e) =>
                                                    setRepaymentFormData({
                                                        ...repaymentFormData,
                                                        scheduled_portion: e.target.value,
                                                    })
                                                }
                                                onBlur={snapScheduledField}
                                                placeholder="0"
                                            />
                                        </div>
                                        {recordCollectionTotal != null && recordCollectionTotal > 0 && (
                                            <p className="text-sm font-medium text-foreground">
                                                This step: {currency}{' '}
                                                {recordCollectionTotal.toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}{' '}
                                                <span className="text-xs font-normal text-muted-foreground">
                                                    (multiple of one installment)
                                                </span>
                                            </p>
                                        )}
                                        {scheduledStepError && (
                                            <p className="mt-1 text-sm text-destructive" role="alert">
                                                {scheduledStepError}
                                            </p>
                                        )}
                                        {repaymentFormData.loanId &&
                                            pickerDueOnSelectedDate != null &&
                                            pickerTotalDueOnOrBefore != null && (
                                                <div className="mt-1 space-y-1 text-xs text-muted-foreground">
                                                    {pickerTotalDueOnOrBefore <= 0 && pickerDueOnSelectedDate <= 0 ? (
                                                        <p>
                                                            No scheduled due for this date — use “Prepayment only” below, or enter
                                                            0 here and skip to step 2.
                                                        </p>
                                                    ) : (
                                                        <>
                                                            <p>
                                                                Due on this payment date (installments only):{' '}
                                                                <span className="font-medium text-foreground">
                                                                    {currency}{' '}
                                                                    {pickerDueOnSelectedDate.toLocaleString(undefined, {
                                                                        minimumFractionDigits: 2,
                                                                        maximumFractionDigits: 2,
                                                                    })}
                                                                </span>
                                                            </p>
                                                            {pickerTotalDueOnOrBefore > pickerDueOnSelectedDate + 1e-8 && (
                                                                <p>
                                                                    Total due on/before this date (incl. arrears):{' '}
                                                                    <span className="font-medium text-foreground">
                                                                        {currency}{' '}
                                                                        {pickerTotalDueOnOrBefore.toLocaleString(undefined, {
                                                                            minimumFractionDigits: 2,
                                                                            maximumFractionDigits: 2,
                                                                        })}
                                                                    </span>
                                                                </p>
                                                            )}
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                        <div className="flex flex-col gap-2 sm:flex-row">
                                            <Button
                                                type="button"
                                                className="flex-1"
                                                onClick={handleRecordScheduledContinue}
                                                disabled={
                                                    isSubmitting ||
                                                    !!scheduledStepError ||
                                                    recordCollectionTotal == null ||
                                                    recordCollectionTotal <= 0 ||
                                                    (!!repaymentFormData.loanId &&
                                                        (pickerTotalDueOnOrBefore == null || pickerInstallmentUnit == null))
                                                }
                                            >
                                                {isSubmitting ? (
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                    <HandCoins className="mr-2 h-4 w-4" />
                                                )}
                                                Record scheduled &amp; continue
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="destructive"
                                                className="flex-1"
                                                onClick={handleSkipToPrepaymentOnly}
                                                disabled={isSubmitting || !repaymentFormData.loanId}
                                            >
                                                Prepayment only
                                                <ChevronRight className="ml-2 h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {scheduledRecordedInSession != null && scheduledRecordedInSession > 0 && (
                                            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                                                <span className="font-medium text-foreground">Scheduled saved:</span>{' '}
                                                {currency}{' '}
                                                {scheduledRecordedInSession.toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}{' '}
                                                <span className="text-muted-foreground">
                                                    (loan schedule updated — arrears / due today covered first)
                                                </span>
                                            </div>
                                        )}
                                        {scheduledRecordedInSession == null && (
                                            <p className="text-sm text-muted-foreground">
                                                No scheduled line in this visit — enter prepayment only, or tap Back to step 1.
                                            </p>
                                        )}
                                        <div>
                                            <Label htmlFor="prepayment-portion">
                                                Prepayment ({currency}) — from last installment backward
                                            </Label>
                                            <Input
                                                id="prepayment-portion"
                                                type="number"
                                                step="0.01"
                                                min="0"
                                                value={repaymentFormData.prepayment_portion}
                                                aria-invalid={prepaymentStepError ? true : undefined}
                                                className={cn(prepaymentStepError && 'border-destructive')}
                                                onChange={(e) =>
                                                    setRepaymentFormData({
                                                        ...repaymentFormData,
                                                        prepayment_portion: e.target.value,
                                                    })
                                                }
                                                onBlur={snapPrepaymentField}
                                                placeholder="0"
                                            />
                                        </div>
                                        {recordCollectionTotal != null && recordCollectionTotal > 0 && (
                                            <p className="text-sm font-medium text-foreground">
                                                Prepayment line: {currency}{' '}
                                                {recordCollectionTotal.toLocaleString(undefined, {
                                                    minimumFractionDigits: 2,
                                                    maximumFractionDigits: 2,
                                                })}{' '}
                                                <span className="text-xs font-normal text-muted-foreground">
                                                    (multiple of one installment)
                                                </span>
                                            </p>
                                        )}
                                        {prepaymentStepError && (
                                            <p className="mt-1 text-sm text-destructive" role="alert">
                                                {prepaymentStepError}
                                            </p>
                                        )}
                                        <div className="flex flex-col gap-2 sm:flex-row">
                                            <Button
                                                type="button"
                                                className="flex-1"
                                                onClick={handleRecordPrepaymentFinish}
                                                disabled={
                                                    isSubmitting ||
                                                    !!prepaymentStepError ||
                                                    recordCollectionTotal == null ||
                                                    recordCollectionTotal <= 0 ||
                                                    (!!repaymentFormData.loanId &&
                                                        (pickerTotalDueOnOrBefore == null || pickerInstallmentUnit == null))
                                                }
                                            >
                                                {isSubmitting ? (
                                                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                ) : (
                                                    <HandCoins className="mr-2 h-4 w-4" />
                                                )}
                                                Record prepayment
                                            </Button>
                                            <Button
                                                type="button"
                                                variant="secondary"
                                                className="flex-1"
                                                onClick={handleWizardDoneNoPrepayment}
                                                disabled={isSubmitting}
                                            >
                                                Done (no prepayment)
                                            </Button>
                                            {scheduledRecordedInSession == null && (
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    className="flex-1"
                                                    onClick={handleBackToScheduledStep}
                                                    disabled={isSubmitting}
                                                >
                                                    <ChevronLeft className="mr-2 h-4 w-4" />
                                                    Back
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                )}
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
                        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                            <StatCard title="Total Repayments (Filtered)" value={`${currency} ${stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={ArrowRightLeft} color="text-blue-500" />
                            <StatCard title="Scheduled collection" value={`${currency} ${stats.totalScheduledCollection.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={Layers} color="text-cyan-600" />
                            <StatCard title="Prepayment" value={`${currency} ${stats.totalPrepayment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} icon={ArrowUpCircle} color="text-emerald-600" />
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
                                placeholder="Search loan ID, borrower name, or borrower ID…" 
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="pl-8 w-[280px]"
                            />
                        </div>
                        <select
                            className={NATIVE_SELECT_FILTER}
                            value={centerFilter}
                            onChange={(e) => {
                                setCenterFilter(e.target.value);
                                setGroupFilter('all');
                            }}
                            aria-label="Filter by center"
                        >
                            <option value="all">All centers</option>
                            {centers.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.name}
                                </option>
                            ))}
                        </select>
                        <select
                            className={NATIVE_SELECT_FILTER}
                            value={groupFilter}
                            onChange={(e) => setGroupFilter(e.target.value)}
                            disabled={groupsForFilter.length === 0}
                            aria-label="Filter by group"
                        >
                            <option value="all">
                                {groupsForFilter.length === 0 ? 'No groups' : 'All groups'}
                            </option>
                            {groupsForFilter.map((g) => (
                                <option key={g.id} value={g.id}>
                                    {g.name}
                                </option>
                            ))}
                        </select>
                        <select
                            className={`${NATIVE_SELECT_FILTER} min-w-[240px]`}
                            value={borrowerStatusFilter}
                            onChange={(e) => setBorrowerStatusFilter(e.target.value)}
                            aria-label="Filter by borrower status"
                        >
                            <option value="all">All borrower statuses</option>
                            {BORROWER_STATUS_FILTER_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                    {o.label}
                                </option>
                            ))}
                        </select>
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button
                                    variant="outline"
                                    className="w-[280px] justify-start text-left font-normal"
                                    disabled={loadAllHistory}
                                >
                                    <CalendarIcon className="mr-2 h-4 w-4" />
                                    {loadAllHistory
                                        ? 'All history'
                                        : dateRangeFilter?.from
                                          ? dateRangeFilter.to
                                              ? `${formatTZ(dateRangeFilter.from, 'LLL dd, y')} - ${formatTZ(dateRangeFilter.to, 'LLL dd, y')}`
                                              : formatTZ(dateRangeFilter.from, 'LLL dd, y')
                                          : 'Pick a date range'}
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0" align="start">
                                <Calendar
                                    mode="range"
                                    selected={dateRangeFilter}
                                    onSelect={(range) => {
                                        setLoadAllHistory(false);
                                        setDateRangeFilter(range);
                                    }}
                                    numberOfMonths={2}
                                />
                            </PopoverContent>
                        </Popover>
                        <Button
                            type="button"
                            variant={loadAllHistory ? 'secondary' : 'outline'}
                            onClick={() => {
                                setLoadAllHistory((v) => !v);
                                if (!loadAllHistory) {
                                    setDateRangeFilter(null);
                                } else {
                                    setDateRangeFilter(defaultRepaymentDateRange());
                                }
                            }}
                        >
                            {loadAllHistory ? 'Last 90 days' : 'Load all history'}
                        </Button>
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
                    <CardContent className={cn(listLoading && 'opacity-60 pointer-events-none')}>
                        {listLoading && (
                            <div className="flex justify-center py-2">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                            </div>
                        )}
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
                                    <TableHead>Borrower status</TableHead>
                                    <TableHead>Group</TableHead>
                                    <TableHead>Principal Paid</TableHead>
                                    <TableHead>Interest Paid</TableHead>
                                    <TableHead>Total Paid</TableHead>
                                    <TableHead>Scheduled</TableHead>
                                    <TableHead>Prepayment</TableHead>
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
                                        <TableCell className="text-muted-foreground">
                                            {currency}{' '}
                                            {scheduledCollectionAmount(r).toLocaleString(undefined, {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                            })}
                                        </TableCell>
                                        <TableCell className="font-medium text-emerald-700 dark:text-emerald-400">
                                            {currency}{' '}
                                            {prepaymentAmount(r).toLocaleString(undefined, {
                                                minimumFractionDigits: 2,
                                                maximumFractionDigits: 2,
                                            })}
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
                                {totalRepaymentCount === 0 && !listLoading && (
                                    <TableRow>
                                        <TableCell colSpan={12} className="text-center py-8 text-muted-foreground">No repayments match the current filters.</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                            <TableFooter>
                                <TableRow>
                                    <TableCell colSpan={5} className="font-bold text-right">Totals</TableCell>
                                    <TableCell className="font-bold">{currency} {stats.totalPrincipalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell className="font-bold">{currency} {stats.totalInterest.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell className="font-bold">{currency} {stats.totalPaid.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell className="font-bold">{currency} {stats.totalScheduledCollection.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell className="font-bold">{currency} {stats.totalPrepayment.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</TableCell>
                                    <TableCell></TableCell>
                                </TableRow>
                            </TableFooter>
                        </Table>
                        {totalRepaymentCount > 0 && (
                            <div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
                                <p className="text-sm text-muted-foreground">
                                    Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, totalRepaymentCount)} of {totalRepaymentCount}
                                    {!loadAllHistory && ' (last 90 days by default)'}
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

export default RepaymentManagement;