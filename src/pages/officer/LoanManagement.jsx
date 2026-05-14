
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkDataTableToolbar } from '@/components/ui/bulk-data-table-toolbar';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { exportObjectsToCsv } from '@/lib/tableExport';
import { RepaymentScheduleGrid } from '@/components/loans/RepaymentScheduleGrid';
import { scheduleExportMetaFromLoan } from '@/lib/scheduleExport';
import { SCHEDULE_DIALOG_CONTENT, SCHEDULE_DIALOG_SCROLL, LOAN_EDIT_WIDE_CONTENT } from '@/lib/dialogLayout';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { useToast } from '@/components/ui/use-toast';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Combobox } from '@/components/ui/combobox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { PlusCircle, Eye, Trash2, Download, Upload, Briefcase, DollarSign, AlertTriangle, Edit, Loader2, Calendar as CalendarIcon, CheckCircle2, User, CreditCard, CalendarDays, ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { generateSchedule, getNextWorkingDay } from '@/utils/loanUtils';
import * as XLSX from 'xlsx';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import { format as formatDate, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';
import { borrowerMatchesCenter, borrowerMatchesGroup } from '@/lib/loanBorrowerLocationFilter';
import { LOAN_STATUS_FILTER_OPTIONS, loanStatusLabel, loanStatusBadgeVariant } from '@/lib/domainStatuses';
import { checkDisbursementAgainstFieldWallet } from '@/lib/officerFieldWalletDisburse';
import { isWorkingDayEAT, todayYyyyMmDdEAT } from '@/lib/workingDayEAT';
import { getImportDataSheet, formatImportReportSummary } from '@/lib/bulkImportExcel';
import { downloadLoansImportTemplate } from '@/lib/excelImportTemplateDownloads';
import { useUserProfileScope } from '@/hooks/useUserProfileScope';
import { ImportResultDialog } from '@/components/import/ImportResultDialog';
import { borrowerPublicId } from '@/lib/borrowerPublicId';
import { logAudit } from '@/lib/auditLog';

const EAT_TIMEZONE = 'Africa/Nairobi';
const LOAN_BORROWER_SELECT = `*, borrowers(*, groups(id, name, center_id), branches(name)), loan_products(name)`;
const PAGE_SIZE = 25;

function parseProposedPrincipal(raw) {
	const s = String(raw ?? '')
		.trim()
		.replace(/,/g, '');
	if (!s) return null;
	const p = parseFloat(s);
	return Number.isFinite(p) && p > 0 ? p : null;
}

/** Native <select> avoids Popover+Dialog focus/pointer issues (same as Admin → Add User → Assign Branch). */
const NATIVE_SELECT_DIALOG =
  'flex h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-background';
const NATIVE_SELECT_FILTER =
  'flex h-10 w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-background';

/** Settled / closed loans that do not block choosing this borrower for a new disbursement. */
function loanDoesNotBlockNewDisburse(l) {
	if (!l) return true;
	const st = l.status;
	if (st === 'written_off') return true;
	if (st === 'paid' && Number(l.balance) <= 0.01) return true;
	return false;
}

/** True if borrower still has any loan that blocks a new disbursement (active debt or open workflow). */
function borrowerHasOutstandingLoan(loans, borrowerId) {
	if (!borrowerId || !Array.isArray(loans)) return false;
	return loans.some((l) => l.borrower_id === borrowerId && !loanDoesNotBlockNewDisburse(l));
}

const StatCard = ({ title, value, icon: Icon, color }) => (
    <Card className="overflow-hidden border-none shadow-md hover:shadow-lg transition-all duration-300">
      <CardHeader className="flex flex-row items-center justify-between pb-2 bg-gradient-to-r from-gray-50 to-white">
        <CardTitle className="text-sm font-semibold text-gray-600 uppercase tracking-wider">{title}</CardTitle>
        <div className={`p-2 rounded-full ${color.replace('text-', 'bg-').replace('600', '100')}`}>
            <Icon className={`h-5 w-5 ${color}`} />
        </div>
      </CardHeader>
      <CardContent className="pt-4 bg-white">
        <div className="text-2xl font-extrabold text-gray-800">{value}</div>
      </CardContent>
    </Card>
);

function excelSerialDateToYYYYMMDD(serial) {
    if (typeof serial !== 'number') {
        if (typeof serial === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(serial)) {
            return serial;
        }
        return null; 
    }
    const utc_days = Math.floor(serial - 25569);
    const date = new Date((utc_days - (25567 + 2)) * 86400 * 1000);
    return formatTZ(date, 'yyyy-MM-dd', { timeZone: 'UTC' });
}

const LoanManagement = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const { branchId: officerProfileBranchId } = useUserProfileScope(user?.id);
    const [loans, setLoans] = useState([]);
    const [borrowers, setBorrowers] = useState([]);
    const [loanProducts, setLoanProducts] = useState([]);
    const [holidays, setHolidays] = useState([]);
    const [loading, setLoading] = useState(true);
    const [isImporting, setIsImporting] = useState(false);
    const [isDisbursingLoan, setIsDisbursingLoan] = useState(false);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editDialogOpen, setEditDialogOpen] = useState(false);
    const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState(null);
    const [isRefreshingSchedule, setIsRefreshingSchedule] = useState(false);
    const [editingLoan, setEditingLoan] = useState(null);
    const [currency, setCurrency] = useState('TZS');
    
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [productFilter, setProductFilter] = useState('all');
    const [centerFilter, setCenterFilter] = useState('all');
    const [groupFilter, setGroupFilter] = useState('all');
    const [centers, setCenters] = useState([]);
    const [groups, setGroups] = useState([]);
    /** All groups for this officer — used by disburse dialog center → group filters */
    const [disbursementGroups, setDisbursementGroups] = useState([]);
    const [disbursePickerCenterFilter, setDisbursePickerCenterFilter] = useState('all');
    const [disbursePickerGroupFilter, setDisbursePickerGroupFilter] = useState('all');
    const [disburseBorrowerSearch, setDisburseBorrowerSearch] = useState('');
    const [dateRange, setDateRange] = useState({ from: undefined, to: undefined });
    const [page, setPage] = useState(1);
    const [importReportOpen, setImportReportOpen] = useState(false);
    const [importReportSummary, setImportReportSummary] = useState('');
    const [importReportDetails, setImportReportDetails] = useState('');

    // Initial form state now uses strings for date inputs (YYYY-MM-DD)
    const [formData, setFormData] = useState({ 
        borrowerId: '', 
        productId: '', 
        principal: '', 
        disbursementDate: '', 
        repaymentStartDate: '' 
    });
    const [editFormData, setEditFormData] = useState({ principal: '', productId: '', disbursementDate: null, repaymentStartDate: null });
    const [newSchedulePreview, setNewSchedulePreview] = useState([]);
    
    const importFileRef = useRef(null);
    const [increaseEligibility, setIncreaseEligibility] = useState(null);
    const [increaseEligibilityLoading, setIncreaseEligibilityLoading] = useState(false);
    const [attendanceExceptionNotes, setAttendanceExceptionNotes] = useState('');
    const [submittingAttendanceException, setSubmittingAttendanceException] = useState(false);
    
    // Updated disabledDays to block past dates while allowing today
    const disabledDays = useMemo(() => {
        const holidayDates = holidays.map(h => {
            const date = new Date(h.date);
            return new Date(date.getFullYear(), date.getMonth(), date.getDate());
        });
        
        return [
            { dayOfWeek: [0] }, // Disable Sundays
            (date) => date < new Date(new Date().toDateString()), // Disable past dates (strictly before today)
            ...holidayDates
        ];
    }, [holidays]);

    const resetFormData = useCallback(() => {
        const today = new Date();
        const nextWorkingDay = getNextWorkingDay(today, holidays);
        const nextWorkingDayStr = formatTZ(nextWorkingDay, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });

        setFormData({ 
            borrowerId: '', 
            productId: '', 
            principal: '', 
            disbursementDate: nextWorkingDayStr,
            repaymentStartDate: nextWorkingDayStr 
        });
        setAttendanceExceptionNotes('');
        setDisbursePickerCenterFilter('all');
        setDisbursePickerGroupFilter('all');
        setDisburseBorrowerSearch('');
    }, [holidays]);
    
    const fetchData = useCallback(async () => {
        if (!user) return;
        setLoading(true);

        await supabase.rpc('update_all_loan_statuses');

        const { data: cfgRows } = await supabase.from('system_config').select('key, value').in('key', ['currency', 'systemName']);
        const cfg = Object.fromEntries((cfgRows || []).map((r) => [r.key, r.value]));
        if (cfg.currency) setCurrency(cfg.currency);

        const { data: loansData, error: loansError } = await supabase
            .from('loans')
            .select(LOAN_BORROWER_SELECT)
            .eq('officer_id', user.id);
        const { data: borrowersData, error: borrowersError } = await supabase
            .from('borrowers')
            .select('*, groups(id, name, center_id)')
            .eq('loan_officer_id', user.id);
        const { data: allGroupsData, error: allGroupsError } = await supabase
            .from('groups')
            .select('id, name, center_id')
            .eq('loan_officer_id', user.id)
            .order('name');
        const { data: productsData, error: productsError } = await supabase.from('loan_products').select('*').eq('status', 'active');
        const { data: holidaysData, error: holidaysError } = await supabase.from('holidays').select('*');
        
        if (loansError || borrowersError || allGroupsError || productsError || holidaysError) {
            toast({
                title: 'Error fetching data',
                description:
                    loansError?.message ||
                    borrowersError?.message ||
                    allGroupsError?.message ||
                    productsError?.message ||
                    holidaysError?.message,
                variant: 'destructive',
            });
            setDisbursementGroups([]);
        } else {
            setLoans(loansData || []);
            setBorrowers(borrowersData || []);
            setDisbursementGroups(allGroupsData || []);
            setLoanProducts(productsData || []);
            setHolidays(holidaysData || []);
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    useEffect(() => {
        let cancelled = false;
        if (!user?.id) {
            setCenters([]);
            return;
        }
        (async () => {
            let q = supabase.from('centers').select('id, name').eq('loan_officer_id', user.id).order('name');
            const bid = officerProfileBranchId ?? user.user_metadata?.branch_id;
            if (bid) q = q.eq('branch_id', bid);
            const { data } = await q;
            if (!cancelled) setCenters(data || []);
        })();
        return () => {
            cancelled = true;
        };
    }, [user?.id, user?.user_metadata?.branch_id, officerProfileBranchId]);

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

    /** When centre filter is "all", list all groups (same idea as disburse picker). */
    const portfolioGroupRows = useMemo(() => {
        return centerFilter === 'all' ? disbursementGroups : groups;
    }, [centerFilter, groups, disbursementGroups]);

    const eligibleBorrowersForLoanTemplate = useMemo(
        () =>
            borrowers.filter(
                (b) =>
                    (b.status === 'eligible' || b.status === 'paid_up') &&
                    !borrowerHasOutstandingLoan(loans, b.id),
            ),
        [borrowers, loans],
    );
    const loansImportTemplateBlocked = !loanProducts.length || eligibleBorrowersForLoanTemplate.length === 0;
    const loansImportTemplateTitle = !loanProducts.length
        ? 'Add at least one active loan product first.'
        : eligibleBorrowersForLoanTemplate.length === 0
          ? 'Need at least one eligible or paid-up borrower with no outstanding loan.'
          : undefined;

    useEffect(() => {
       resetFormData();
    }, [resetFormData]);

    /** Keep group selection valid when centre changes (e.g. group only exists under another centre). */
    useEffect(() => {
        if (disbursePickerGroupFilter === 'all') return;
        const g = disbursementGroups.find((x) => x.id === disbursePickerGroupFilter);
        if (!g) {
            setDisbursePickerGroupFilter('all');
            return;
        }
        if (disbursePickerCenterFilter !== 'all' && g.center_id !== disbursePickerCenterFilter) {
            setDisbursePickerGroupFilter('all');
        }
    }, [disbursePickerCenterFilter, disbursePickerGroupFilter, disbursementGroups]);

    useEffect(() => {
        if (!formData.borrowerId) {
            setIncreaseEligibility(null);
            setIncreaseEligibilityLoading(false);
            return;
        }
        let cancelled = false;
        setIncreaseEligibilityLoading(true);
        const proposed = parseProposedPrincipal(formData.principal);
        supabase
            .rpc('borrower_loan_increase_eligibility', {
                p_borrower_id: formData.borrowerId,
                p_proposed_principal: proposed,
            })
            .then(({ data, error }) => {
                if (cancelled) return;
                setIncreaseEligibilityLoading(false);
                if (error) {
                    setIncreaseEligibility(null);
                    return;
                }
                setIncreaseEligibility(data);
            });
        return () => {
            cancelled = true;
        };
    }, [formData.borrowerId, formData.principal]);


    const filteredLoans = useMemo(() => {
        return loans.filter(loan => {
            const borrowerName = `${loan.borrowers?.first_name || ''} ${loan.borrowers?.surname || ''}`.toLowerCase();
            const query = searchQuery.toLowerCase();
            const matchesSearch = loan.loan_id.toLowerCase().includes(query) || borrowerName.includes(query) || loan.principal.toString().includes(query);
            const matchesStatus = statusFilter === 'all' || loan.status === statusFilter;
            const matchesProduct = productFilter === 'all' || loan.product_id === productFilter;
            const matchesCenter = borrowerMatchesCenter(loan.borrowers, centerFilter);
            const matchesGroup = borrowerMatchesGroup(loan.borrowers, groupFilter);
            
            let matchesDate = true;
            if (dateRange.from && dateRange.to) {
                const loanDate = toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE);
                matchesDate = loanDate >= toZonedTime(dateRange.from, EAT_TIMEZONE) && loanDate <= toZonedTime(dateRange.to, EAT_TIMEZONE);
            } else if (dateRange.from) {
                matchesDate = toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE) >= toZonedTime(dateRange.from, EAT_TIMEZONE);
            }

            return matchesSearch && matchesStatus && matchesProduct && matchesCenter && matchesGroup && matchesDate;
        });
    }, [loans, searchQuery, statusFilter, productFilter, centerFilter, groupFilter, dateRange]);

    useEffect(() => {
        setPage(1);
    }, [searchQuery, statusFilter, productFilter, centerFilter, groupFilter, dateRange]);

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
            { header: 'Principal', accessor: (r) => String(r.principal ?? '') },
            { header: 'Balance', accessor: (r) => String(r.balance ?? '') },
            { header: 'Disbursement', accessor: (r) => (r.disbursement_date ? formatTZ(toZonedTime(new Date(r.disbursement_date), EAT_TIMEZONE), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }) : '') },
            { header: 'Status', accessor: 'status' },
        ], rows);
        toast({ title: 'Exported', description: `${rows.length} loan(s) to CSV.` });
    };

    const handleDisburse = async () => {
        const { borrowerId, productId, principal, disbursementDate, repaymentStartDate } = formData;
        
        // Basic validation
        if (!borrowerId || !productId || !principal || !repaymentStartDate || !disbursementDate) {
            toast({ title: 'Validation Error', description: 'Please fill all required fields.', variant: 'destructive' });
            return;
        }

        if (parseFloat(principal) <= 0) {
            toast({ title: 'Validation Error', description: 'Principal amount must be greater than zero.', variant: 'destructive' });
            return;
        }

        const principalAmount = parseFloat(principal);

        // Date logic validation
        const dDate = parseISO(disbursementDate);
        const rDate = parseISO(repaymentStartDate);
        
        if (rDate <= dDate) {
             toast({ 
                 title: 'Invalid Dates', 
                 description: 'Repayment start date must be AFTER the disbursement date.', 
                 variant: 'destructive' 
             });
             return;
        }
        
        setIsDisbursingLoan(true);

        try {
            const { data: borrower, error: borrowerError } = await supabase
                .from('borrowers')
                .select('status, borrower_id')
                .eq('id', borrowerId)
                .single();
            if (borrowerError || !borrower) {
                throw new Error('Borrower not found');
            }

            if (borrower.status === 'pending') {
                toast({
                    title: 'Cannot disburse yet',
                    description: 'This borrower is waiting for branch manager approval for a new loan after default. Disburse after they are marked eligible.',
                    variant: 'destructive',
                });
                setIsDisbursingLoan(false);
                return;
            }

            if (borrower.status === 'active_loan' || borrower.status === 'defaulted') {
                toast({ title: 'Cannot Disburse Loan', description: `Borrower has an ${borrower.status.toLowerCase().replace('_', ' ')} loan and cannot receive a new one.`, variant: 'destructive' });
                setIsDisbursingLoan(false);
                return;
            }

            const { data: elCheck, error: elErr } = await supabase.rpc('borrower_loan_increase_eligibility', {
                p_borrower_id: borrowerId,
                p_proposed_principal: principalAmount,
            });
            if (elErr) {
                toast({
                    title: 'Eligibility check failed',
                    description: elErr.message,
                    variant: 'destructive',
                });
                setIsDisbursingLoan(false);
                return;
            }
            if (elCheck && elCheck.may_disburse_new_loan === false) {
                toast({
                    title: 'Cannot disburse yet',
                    description:
                        elCheck.summary ||
                        'Loan increase rules are not met. Submit an attendance exception for manager approval if applicable.',
                    variant: 'destructive',
                });
                setIsDisbursingLoan(false);
                return;
            }

            const product = loanProducts.find(p => p.id === productId);
            if (!product) {
                throw new Error('Loan product not found');
            }

            if (principalAmount < product.min_amount || principalAmount > product.max_amount) {
                toast({ title: 'Validation Error', description: `Principal amount must be between ${currency} ${product.min_amount.toLocaleString()} and ${currency} ${product.max_amount.toLocaleString()}.`, variant: 'destructive' });
                setIsDisbursingLoan(false);
                return;
            }

            const { data: feeRow } = await supabase
                .from('system_config')
                .select('value')
                .eq('key', 'applicationFeePerDisbursement')
                .maybeSingle();
            const feePer = parseFloat(feeRow?.value) || 0;
            const walletCheck = await checkDisbursementAgainstFieldWallet({
                officerId: user.id,
                disbursementDateYyyyMmDd: disbursementDate,
                principalAmount,
                applicationFeePerDisbursement: feePer,
            });
            if (walletCheck.error) {
                toast({
                    title: 'Wallet check failed',
                    description: walletCheck.error.message,
                    variant: 'destructive',
                });
                setIsDisbursingLoan(false);
                return;
            }
            if (!walletCheck.ok) {
                toast({
                    title: 'Insufficient field wallet',
                    description: `For ${disbursementDate}, field wallet after this disbursement would be ${walletCheck.projectedAfter.toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                    })} (need ≥ 0). Add taken or collect repayments before disbursing this principal.`,
                    variant: 'destructive',
                });
                setIsDisbursingLoan(false);
                return;
            }

            const interest = principalAmount * (parseFloat(product.interest_rate) / 100);
            const totalPayable = principalAmount + interest;
            // Dates are already YYYY-MM-DD from the input[type=date]
            
            const schedule = generateSchedule(principalAmount, product.interest_rate, totalPayable, product.loan_period, product.loan_period_unit, product.repayment_frequency, repaymentStartDate, holidays);
            
            const newLoan = {
                loan_id: `LN-${Date.now()}`, 
                borrower_id: borrowerId, 
                product_id: productId, 
                officer_id: user.id, 
                principal: principalAmount, 
                interest_rate: product.interest_rate, 
                total_payable: totalPayable, 
                balance: totalPayable, 
                outstanding_interest: interest, 
                repayment_frequency: product.repayment_frequency, 
                period: product.loan_period, 
                period_unit: product.loan_period_unit, 
                disbursement_date: disbursementDate, 
                repayment_start_date: repaymentStartDate, 
                status: 'active', 
                schedule: schedule,
            };

            const { data: insertedLoan, error: loanInsertError } = await supabase.from('loans').insert(newLoan).select('id').single();

            if (loanInsertError) {
                throw loanInsertError;
            }

            if (insertedLoan?.id) {
                await supabase.rpc('consume_loan_increase_approval_for_borrower', {
                    p_borrower_id: borrowerId,
                    p_loan_id: insertedLoan.id,
                });
            }

            await supabase.from('borrowers').update({ status: 'active_loan' }).eq('id', borrowerId);

            if (insertedLoan?.id) {
                void logAudit({
                    action: 'loan.disburse',
                    entityType: 'loan',
                    entityId: insertedLoan.id,
                    metadata: {
                        loan_public_id: newLoan.loan_id,
                        borrower_public_id: borrower.borrower_id ?? '',
                        principal: principalAmount,
                        disbursement_date: disbursementDate,
                    },
                });
            }

            toast({ title: 'Success!', description: 'Loan disbursed successfully!', variant: 'default' });
            setDialogOpen(false);
            resetFormData();
            fetchData();
        } catch (error) {
            console.error('Disbursement error:', error);
            toast({ title: 'Disbursement Failed', description: error.message || 'An error occurred while disbursing the loan.', variant: 'destructive' });
        } finally {
            setIsDisbursingLoan(false);
        }
    };

    const handleOpenEditDialog = (loan) => {
        setEditingLoan(loan);
        setEditFormData({
            principal: loan.principal,
            productId: loan.product_id,
            disbursementDate: toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE),
            repaymentStartDate: toZonedTime(new Date(loan.repayment_start_date), EAT_TIMEZONE),
        });
        setNewSchedulePreview([]);
        setEditDialogOpen(true);
    };
    
    useEffect(() => {
        if (!editDialogOpen || !editingLoan || !editFormData.productId) {
            setNewSchedulePreview([]);
            return;
        }

        const product = loanProducts.find(p => p.id === editFormData.productId);
        if (!product || !editFormData.principal || !editFormData.repaymentStartDate) {
            setNewSchedulePreview([]);
            return;
        }

        const principalAmount = parseFloat(editFormData.principal);
        const interest = principalAmount * (parseFloat(product.interest_rate) / 100);
        const totalPayable = principalAmount + interest;
        const formattedRepaymentStartDate = formatTZ(editFormData.repaymentStartDate, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });

        const schedule = generateSchedule(principalAmount, product.interest_rate, totalPayable, product.loan_period, product.loan_period_unit, product.repayment_frequency, formattedRepaymentStartDate, holidays);
        setNewSchedulePreview(schedule);

    }, [editFormData, editingLoan, loanProducts, holidays, editDialogOpen]);

    const handleRequestEdit = async () => {
        if (!editingLoan) return;

        const { error } = await supabase.from('loans').update({
            status: 'edit_requested',
            edit_request: { 
                principal: parseFloat(editFormData.principal),
                productId: editFormData.productId,
                disbursementDate: formatTZ(editFormData.disbursementDate, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
                repaymentStartDate: formatTZ(editFormData.repaymentStartDate, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
                newSchedule: newSchedulePreview
             }
        }).eq('id', editingLoan.id);

        if (error) {
            toast({ title: 'Failed', description: error.message, variant: 'destructive' });
        } else {
            fetchData();
            setEditDialogOpen(false);
            setEditingLoan(null);
            toast({ title: 'Success', description: 'Loan edit request sent to Branch Manager for approval.' });
        }
    };

    const handleRequestDeletion = async (loanId) => {
        const { data: row, error: fetchErr } = await supabase.from('loans').select('loan_id').eq('id', loanId).single();
        if (fetchErr) {
            toast({ title: 'Failed', description: fetchErr.message, variant: 'destructive' });
            return;
        }
        const { error } = await supabase.from('loans').update({ status: 'delete_requested' }).eq('id', loanId);
        if (error) {
            toast({ title: 'Failed', description: error.message, variant: 'destructive' });
        } else {
            await supabase.rpc('log_audit_event', {
                p_action: 'loan.delete.requested',
                p_entity_type: 'loan',
                p_entity_id: String(row.loan_id),
                p_metadata: { loan_uuid: loanId },
            });
            fetchData();
            toast({ title: 'Success', description: 'Deletion request sent to your branch manager for approval.' });
        }
    };
    
    const handleDownloadTemplate = async () => {
        if (!loanProducts.length) {
            toast({
                title: 'No loan products',
                description: 'Configure at least one loan product before downloading the loans import template.',
                variant: 'destructive',
            });
            return;
        }
        if (eligibleBorrowersForLoanTemplate.length === 0) {
            toast({
                title: 'No eligible borrowers',
                description:
                    'You need at least one borrower with status Eligible or Paid and no outstanding loan before downloading this template.',
                variant: 'destructive',
            });
            return;
        }
        const validBorrowers = eligibleBorrowersForLoanTemplate.map((b) => ({
            borrower_id: b.borrower_id,
            name: `${b.first_name} ${b.surname}`,
        }));
        try {
            await downloadLoansImportTemplate({
                validBorrowers,
                loanProducts,
                exampleProductName: loanProducts[0]?.name ?? 'Your Product Name',
            });
        } catch (err) {
            console.error(err);
            toast({
                title: 'Template error',
                description: err?.message ?? 'Could not build template.',
                variant: 'destructive',
            });
        }
    };
    
    const isWorkingDay = (dateStr) => isWorkingDayEAT(dateStr, holidays);
    
    const handleImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        setIsImporting(true);
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                if (!isWorkingDayEAT(todayYyyyMmDdEAT(), holidays)) {
                    toast({
                        title: 'Non-working day',
                        description: 'Loan import is not available on Sundays or public holidays.',
                        variant: 'destructive',
                    });
                    return;
                }
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = getImportDataSheet(workbook, ['Loans Import', 'loans import', 'Loans']);
                const worksheet = workbook.Sheets[sheetName];
                const importedLoans = XLSX.utils.sheet_to_json(worksheet, { raw: true });
                const borrowersMap = new Map(borrowers.map(b => [b.borrower_id, b]));
                const productsMap = new Map(loanProducts.map(p => [p.name.toLowerCase(), p]));
                const processedBorrowerIds = new Set();
                const { data: importFeeRow } = await supabase
                    .from('system_config')
                    .select('value')
                    .eq('key', 'applicationFeePerDisbursement')
                    .maybeSingle();
                const importFeePer = parseFloat(importFeeRow?.value) || 0;
                /** Per disbursement date: running balance after each planned row (same-day batch order). */
                const importRunningBalanceByDate = new Map();
                const newLoans = [];
                const skippedLoans = [];
                for (const row of importedLoans) {
                    if (!row.borrower_id && !row.loan_product_name && !row.principal) continue;
                    if (row.borrower_id) {
                        const bid = String(row.borrower_id).trim();
                        if (processedBorrowerIds.has(bid)) {
                            skippedLoans.push({
                                ...row,
                                reason: 'Duplicate borrower_id in file (only one loan per borrower per import)',
                            });
                            continue;
                        }
                        processedBorrowerIds.add(bid);
                    }
                    const borrower = borrowersMap.get(row.borrower_id);
                    const product = productsMap.get(row.loan_product_name?.toLowerCase());
                    const disbursementDate = excelSerialDateToYYYYMMDD(row.disbursement_date);
                    const repaymentStartDate = excelSerialDateToYYYYMMDD(row.repayment_start_date);

                    if (!borrower || !product || !row.principal || !disbursementDate || !repaymentStartDate) {
                        skippedLoans.push({ ...row, reason: 'Missing or invalid data' });
                        continue;
                    }
                    const principalAmount = parseFloat(row.principal);
                    if (!Number.isFinite(principalAmount) || principalAmount <= 0) {
                        skippedLoans.push({ ...row, reason: 'Missing or invalid data' });
                        continue;
                    }
                    if (!isWorkingDay(disbursementDate) || !isWorkingDay(repaymentStartDate)) {
                        skippedLoans.push({ ...row, reason: 'Disbursement or Repayment Start Date is not a working day' });
                        continue;
                    }
                     if (borrower.status === 'active_loan' || borrower.status === 'defaulted') {
                        skippedLoans.push({ ...row, reason: `Borrower has an ${borrower.status.replace('_',' ')} loan` });
                        continue;
                    }
                    const { data: importEligibility, error: importElErr } = await supabase.rpc('borrower_loan_increase_eligibility', {
                        p_borrower_id: borrower.id,
                        p_proposed_principal: principalAmount,
                    });
                    if (importElErr || (importEligibility && importEligibility.may_disburse_new_loan === false)) {
                        skippedLoans.push({
                            ...row,
                            reason: importEligibility?.summary || importElErr?.message || 'Loan increase not approved by manager',
                        });
                        continue;
                    }
                    let balanceBeforeImport;
                    if (importRunningBalanceByDate.has(disbursementDate)) {
                        balanceBeforeImport = importRunningBalanceByDate.get(disbursementDate);
                    } else {
                        const { data: wbData, error: wbErr } = await supabase.rpc('officer_wallet_balance_for_period', {
                            p_officer_id: user.id,
                            p_from: disbursementDate,
                            p_to: disbursementDate,
                        });
                        if (wbErr) {
                            skippedLoans.push({ ...row, reason: `Wallet check: ${wbErr.message}` });
                            continue;
                        }
                        balanceBeforeImport = Number(wbData) || 0;
                    }
                    const projectedAfterImport = Number(
                        (balanceBeforeImport + importFeePer - principalAmount).toFixed(2),
                    );
                    if (projectedAfterImport < 0) {
                        skippedLoans.push({
                            ...row,
                            reason: `Insufficient field wallet for ${disbursementDate} (after this principal would be ${projectedAfterImport.toFixed(2)})`,
                        });
                        continue;
                    }
                    importRunningBalanceByDate.set(disbursementDate, projectedAfterImport);
                    const interest = principalAmount * (parseFloat(product.interest_rate) / 100);
                    const totalPayable = principalAmount + interest;
                    const schedule = generateSchedule(principalAmount, product.interest_rate, totalPayable, product.loan_period, product.loan_period_unit, product.repayment_frequency, repaymentStartDate, holidays);
                    newLoans.push({
                        loan_id: `LN-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`, borrower_id: borrower.id, product_id: product.id, officer_id: user.id, principal: principalAmount, interest_rate: product.interest_rate, total_payable: totalPayable, balance: totalPayable, outstanding_interest: interest, repayment_frequency: product.repayment_frequency, period: product.loan_period, period_unit: product.loan_period_unit, disbursement_date: disbursementDate, repayment_start_date: repaymentStartDate, status: 'active', schedule: schedule,
                    });
                }
                if (newLoans.length > 0) {
                    const { data: insertedRows, error } = await supabase.from('loans').insert(newLoans).select('id, borrower_id');
                    if (error) throw error;
                    for (const row of insertedRows || []) {
                        await supabase.rpc('consume_loan_increase_approval_for_borrower', {
                            p_borrower_id: row.borrower_id,
                            p_loan_id: row.id,
                        });
                    }
                    const borrowerIdsToUpdate = newLoans.map(l => l.borrower_id);
                    await supabase.from('borrowers').update({ status: 'active_loan' }).in('id', borrowerIdsToUpdate);
                    if (insertedRows?.length) {
                        void logAudit({
                            action: 'loan.disburse_bulk',
                            entityType: 'batch',
                            entityId: insertedRows[0].id,
                            metadata: {
                                count: insertedRows.length,
                                disbursement_date: newLoans[0]?.disbursement_date ?? null,
                            },
                        });
                    }
                }
                const skipLines = skippedLoans.map(
                    (s) => `${s.borrower_id ?? '?'}: ${s.reason}`,
                );
                const { line } = formatImportReportSummary({
                    imported: newLoans.length,
                    skippedDuplicate: 0,
                    skippedInvalid: skippedLoans.length,
                    failed: 0,
                });
                setImportReportSummary(
                    `${line} (Imported loans: ${newLoans.length}. Skipped rows: ${skippedLoans.length}.)`,
                );
                setImportReportDetails(
                    skipLines.length
                        ? skipLines.slice(0, 150).join('\n') + (skipLines.length > 150 ? '\n…' : '')
                        : '',
                );
                setImportReportOpen(true);
                toast({
                    title: 'Import complete',
                    description: `${newLoans.length} loan(s) imported. ${skippedLoans.length} row(s) skipped.`,
                });
                fetchData();
            } catch (error) {
                toast({ title: 'Import Failed', description: error.message, variant: 'destructive' });
            } finally {
                setIsImporting(false);
                event.target.value = null;
            }
        };
        reader.readAsArrayBuffer(file);
    };

    const viewSchedule = async (loan) => {
        setIsRefreshingSchedule(true);
        try {
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
             toast({ title: 'Error', description: 'Could not refresh schedule data. Please try again.', variant: 'destructive' });
        } finally {
            setIsRefreshingSchedule(false);
        }
    };

    // Disbursement: only borrowers marked eligible/paid_up and with no unsettled loan (active/delinquent/etc.)
    const eligibleBorrowers = useMemo(
        () =>
            borrowers.filter(
                (b) =>
                    (b.status === 'eligible' || b.status === 'paid_up') &&
                    !borrowerHasOutstandingLoan(loans, b.id),
            ),
        [borrowers, loans],
    );

    /** When centre is "all", list every group so officers can narrow by group without picking a centre first. */
    const groupsForDisbursePicker = useMemo(() => {
        if (disbursePickerCenterFilter === 'all') return disbursementGroups;
        return disbursementGroups.filter((g) => g.center_id === disbursePickerCenterFilter);
    }, [disbursementGroups, disbursePickerCenterFilter]);

    const eligibleBorrowersForDisburse = useMemo(() => {
        return eligibleBorrowers.filter((b) => {
            if (!borrowerMatchesCenter(b, disbursePickerCenterFilter)) return false;
            if (!borrowerMatchesGroup(b, disbursePickerGroupFilter)) return false;
            return true;
        });
    }, [eligibleBorrowers, disbursePickerCenterFilter, disbursePickerGroupFilter]);

    const filteredBorrowersForDisburse = useMemo(() => {
        const q = disburseBorrowerSearch.trim().toLowerCase();
        if (!q) return eligibleBorrowersForDisburse;
        return eligibleBorrowersForDisburse.filter((b) => {
            const name = `${b.first_name || ''} ${b.surname || ''}`.toLowerCase();
            const id = String(b.borrower_id || '').toLowerCase();
            return name.includes(q) || id.includes(q);
        });
    }, [eligibleBorrowersForDisburse, disburseBorrowerSearch]);

    const selectedProduct = useMemo(() => {
        return loanProducts.find(p => p.id === formData.productId);
    }, [formData.productId, loanProducts]);

    useEffect(() => {
        setAttendanceExceptionNotes('');
    }, [formData.borrowerId]);

    const canConfirmDisburse = useMemo(() => {
        if (increaseEligibilityLoading) return false;
        if (!increaseEligibility) return false;
        return increaseEligibility.may_disburse_new_loan !== false;
    }, [increaseEligibilityLoading, increaseEligibility]);

    const handleSubmitAttendanceException = useCallback(async () => {
        if (!formData.borrowerId) return;
        if (attendanceExceptionNotes.trim().length < 10) {
            toast({
                title: 'Notes required',
                description:
                    'Add at least 10 characters explaining why this borrower should receive a loan despite low attendance.',
                variant: 'destructive',
            });
            return;
        }
        setSubmittingAttendanceException(true);
        try {
            const { data, error } = await supabase.rpc('submit_loan_increase_exception_request', {
                p_borrower_id: formData.borrowerId,
                p_officer_notes: attendanceExceptionNotes.trim(),
            });
            if (error) {
                toast({ title: 'Request failed', description: error.message, variant: 'destructive' });
                return;
            }
            if (data && data.error) {
                toast({ title: 'Request failed', description: String(data.error), variant: 'destructive' });
                return;
            }
            toast({
                title: 'Request submitted',
                description: 'Your branch manager will review the loan increase approval.',
            });
            setAttendanceExceptionNotes('');
            setIncreaseEligibilityLoading(true);
            const proposed = parseProposedPrincipal(formData.principal);
            const { data: fresh } = await supabase.rpc('borrower_loan_increase_eligibility', {
                p_borrower_id: formData.borrowerId,
                p_proposed_principal: proposed,
            });
            setIncreaseEligibility(fresh);
        } finally {
            setIncreaseEligibilityLoading(false);
            setSubmittingAttendanceException(false);
        }
    }, [formData.borrowerId, attendanceExceptionNotes, toast]);

    const disburseEligibilityCardClass = useMemo(() => {
        if (increaseEligibilityLoading) return 'border-neutral-200 bg-neutral-50 text-neutral-700';
        const e = increaseEligibility;
        if (!e) return 'border-neutral-200 bg-neutral-50 text-neutral-800';
        if (e.pending_attendance_exception_request_id) return 'border-blue-200 bg-blue-50 text-blue-950';
        if (e.attendance_exception_approved) return 'border-emerald-200 bg-emerald-50 text-emerald-950';
        if (e.attendance_below_minimum) return 'border-orange-200 bg-orange-50 text-orange-950';
        // Informational: attendance/history rules met for increase (manager approval still required to disburse).
        if (e.eligible_for_auto_loan_increase) return 'border-emerald-200 bg-emerald-50 text-emerald-950';
        if (e.requires_manager_loan_approval) return 'border-amber-200 bg-amber-50 text-amber-950';
        return 'border-neutral-200 bg-neutral-50 text-neutral-800';
    }, [increaseEligibilityLoading, increaseEligibility]);

    if (loading) return <DashboardLayout title="Loans & Disbursements"><div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div></DashboardLayout>;

    return (
        <DashboardLayout title="Loans & Disbursements">
            <div className="space-y-8">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <p className="text-sm text-neutral-500">Manage, disburse, and track all loan activities.</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <Button
                            variant="outline"
                            onClick={handleDownloadTemplate}
                            disabled={loansImportTemplateBlocked}
                            title={loansImportTemplateTitle}
                            className="border-brand-gold/35 bg-white/80 hover:bg-brand-gold/10 dark:border-brand-gold/25 dark:bg-neutral-900/50 dark:hover:bg-brand-gold/10"
                        >
                             <Download className="mr-2 h-4 w-4 text-brand-gold-deep" /> Template
                        </Button>
                        <Button variant="outline" onClick={() => importFileRef.current.click()} disabled={isImporting} className="border-brand-gold/35 bg-white/80 hover:bg-brand-gold/10 dark:border-brand-gold/25 dark:bg-neutral-900/50 dark:hover:bg-brand-gold/10">
                            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4 text-brand-gold-deep" />} Import
                        </Button>
                        <input type="file" ref={importFileRef} className="hidden" accept=".csv, .xlsx" onChange={handleImport} />
                        
                        <Dialog open={dialogOpen} onOpenChange={(open) => {
                            if (open) {
                                if (!isWorkingDayEAT(todayYyyyMmDdEAT(), holidays)) {
                                    toast({
                                        title: 'Non-working day',
                                        description:
                                            'Disbursement is not available on Sundays or public holidays. Open this on a working day.',
                                        variant: 'destructive',
                                    });
                                    return;
                                }
                                resetFormData();
                            }
                            setDialogOpen(open);
                        }}>
                            <DialogTrigger asChild>
                                <Button className="bg-gradient-to-r from-brand-gold via-[#c9a227] to-brand-gold-deep text-neutral-950 font-semibold shadow-gold-glow-sm hover:brightness-105 hover:shadow-md transition-all duration-200 dark:from-brand-gold dark:to-brand-gold-deep">
                                    <PlusCircle className="mr-2 h-4 w-4 shrink-0" /> Disburse Loan
                                </Button>
                            </DialogTrigger>
                            <DialogContent className="flex max-h-[min(92dvh,920px)] w-[calc(100vw-1rem)] max-w-[min(100vw-1rem,56rem)] flex-col gap-0 overflow-hidden rounded-2xl border border-neutral-200/90 p-0 shadow-2xl dark:border-neutral-800 sm:w-full sm:max-w-4xl">
                                <div className="relative shrink-0 bg-gradient-to-br from-neutral-950 via-[#121a24] to-brand-gold-deep/90 px-4 py-6 text-white sm:px-8 sm:py-8">
                                     <div className="pointer-events-none absolute -right-20 -top-20 h-56 w-56 rounded-full bg-brand-gold/20 blur-3xl" />
                                     <div className="pointer-events-none absolute bottom-0 left-1/4 h-32 w-64 rounded-full bg-brand-gold/10 blur-2xl" />
                                     <div className="relative z-10">
                                        <DialogTitle className="font-display text-2xl font-bold tracking-tight text-white sm:text-3xl">Disburse New Loan</DialogTitle>
                                        <DialogDescription className="mt-2 text-sm text-white/85 sm:text-base">
                                            Filter by centre and/or group (both optional), then choose a qualified borrower.
                                        </DialogDescription>
                                     </div>
                                </div>

                                <motion.div 
                                    className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain bg-[#f4f2ed] px-4 py-6 dark:bg-neutral-950 sm:px-6 sm:py-8 md:space-y-8"
                                    initial={{ opacity: 0, y: 12 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.35 }}
                                >
                                    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:gap-8">
                                        {/* Left Column: Borrower & Product */}
                                        <motion.div className="space-y-5 sm:space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.05 }}>
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                <div className="space-y-2">
                                                    <Label htmlFor="disburse-center">Centre</Label>
                                                    <select
                                                        id="disburse-center"
                                                        className={NATIVE_SELECT_DIALOG}
                                                        value={disbursePickerCenterFilter}
                                                        onChange={(e) => {
                                                            const v = e.target.value;
                                                            setDisbursePickerCenterFilter(v);
                                                            setDisburseBorrowerSearch('');
                                                            setFormData((prev) => ({ ...prev, borrowerId: '' }));
                                                        }}
                                                    >
                                                        <option value="all">All centres</option>
                                                        {centers.map((c) => (
                                                            <option key={c.id} value={c.id}>
                                                                {c.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="disburse-group">Group</Label>
                                                    <select
                                                        id="disburse-group"
                                                        className={NATIVE_SELECT_DIALOG}
                                                        value={disbursePickerGroupFilter}
                                                        disabled={disbursementGroups.length === 0}
                                                        onChange={(e) => {
                                                            const v = e.target.value;
                                                            setDisbursePickerGroupFilter(v);
                                                            setDisburseBorrowerSearch('');
                                                            setFormData((prev) => ({ ...prev, borrowerId: '' }));
                                                        }}
                                                    >
                                                        <option value="all">
                                                            {disbursementGroups.length === 0 ? 'No groups yet' : 'All groups'}
                                                        </option>
                                                        {groupsForDisbursePicker.map((g) => (
                                                            <option key={g.id} value={g.id}>
                                                                {g.name}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <Label
                                                    htmlFor="disburse-borrower-search"
                                                    className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200"
                                                >
                                                    <User className="h-4 w-4 shrink-0 text-brand-gold-deep" />
                                                    Borrower *
                                                </Label>
                                                <div className="relative">
                                                    <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                                                    <Input
                                                        id="disburse-borrower-search"
                                                        placeholder="Search by name or borrower ID…"
                                                        value={disburseBorrowerSearch}
                                                        onChange={(e) => setDisburseBorrowerSearch(e.target.value)}
                                                        className="h-11 pl-9"
                                                        autoComplete="off"
                                                    />
                                                </div>
                                                <div
                                                    className="max-h-[220px] overflow-y-auto rounded-xl border border-neutral-200/80 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
                                                    role="listbox"
                                                    aria-label="Eligible borrowers"
                                                >
                                                    {filteredBorrowersForDisburse.length === 0 ? (
                                                        <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                                                            {eligibleBorrowers.length === 0
                                                                ? 'No borrower eligible for disbursement.'
                                                                : eligibleBorrowersForDisburse.length === 0
                                                                  ? 'No eligible borrowers in this centre/group. Adjust filters.'
                                                                  : 'No borrowers match your search.'}
                                                        </p>
                                                    ) : (
                                                        filteredBorrowersForDisburse.map((b) => (
                                                            <button
                                                                key={b.id}
                                                                type="button"
                                                                role="option"
                                                                aria-selected={formData.borrowerId === b.id}
                                                                onClick={() =>
                                                                    setFormData((prev) => ({ ...prev, borrowerId: b.id }))
                                                                }
                                                                className={cn(
                                                                    'flex w-full flex-col items-start gap-0.5 border-b border-border/60 px-3 py-2.5 text-left text-sm transition-colors last:border-0 hover:bg-accent',
                                                                    formData.borrowerId === b.id && 'bg-accent font-medium',
                                                                )}
                                                            >
                                                                <span className="font-semibold text-neutral-900 dark:text-neutral-100">
                                                                    {b.first_name} {b.surname}
                                                                </span>
                                                                {borrowerPublicId(b) ? (
                                                                    <span className="text-xs text-muted-foreground">
                                                                        ID: {borrowerPublicId(b)}
                                                                    </span>
                                                                ) : null}
                                                            </button>
                                                        ))
                                                    )}
                                                </div>
                                                {formData.borrowerId ? (
                                                    <p className="text-xs text-muted-foreground">
                                                        <span className="font-medium text-foreground">Selected:</span>{' '}
                                                        {(() => {
                                                            const sel = eligibleBorrowers.find(
                                                                (x) => x.id === formData.borrowerId,
                                                            );
                                                            if (!sel) return '—';
                                                            const pub = borrowerPublicId(sel);
                                                            return `${sel.first_name} ${sel.surname}${pub ? ` — ${pub}` : ''}`;
                                                        })()}
                                                    </p>
                                                ) : null}
                                            </div>

                                            {(increaseEligibilityLoading || increaseEligibility) && (
                                                <div className={cn('rounded-lg border p-3 text-sm', disburseEligibilityCardClass)}>
                                                    {increaseEligibilityLoading ? (
                                                        <div className="flex items-center gap-2 text-neutral-600">
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                            <span>Checking attendance &amp; loan history…</span>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <p className="font-semibold text-[0.8125rem]">Loan increase eligibility &amp; branch manager approval</p>
                                                            <p className="mt-1 text-xs leading-relaxed opacity-90">
                                                                {increaseEligibility?.summary}
                                                            </p>
                                                            <div className="mt-2 flex flex-wrap gap-2">
                                                                <Badge variant="outline" className="text-[0.6875rem] font-normal">
                                                                    Meetings {String(increaseEligibility?.meetings_attended ?? '—')} /{' '}
                                                                    {String(increaseEligibility?.meetings_required ?? '—')}
                                                                </Badge>
                                                                {increaseEligibility?.requires_manager_loan_approval ? (
                                                                    <Badge variant="outline" className="border-amber-300 bg-white/80 text-amber-900 text-[0.6875rem]">
                                                                        Manager approval required before disburse
                                                                    </Badge>
                                                                ) : null}
                                                                {increaseEligibility?.pending_attendance_exception_request_id ? (
                                                                    <Badge variant="outline" className="border-blue-300 bg-white/80 text-blue-900 text-[0.6875rem]">
                                                                        Loan increase approval pending
                                                                    </Badge>
                                                                ) : null}
                                                                {increaseEligibility?.attendance_exception_approved ? (
                                                                    <Badge variant="outline" className="border-emerald-300 bg-white/80 text-emerald-900 text-[0.6875rem]">
                                                                        Manager approved — you may disburse
                                                                    </Badge>
                                                                ) : null}
                                                                {increaseEligibility?.eligible_for_auto_loan_increase ? (
                                                                    <Badge variant="outline" className="border-emerald-300 bg-white/80 text-emerald-900 text-[0.6875rem]">
                                                                        Meets attendance &amp; history rules (increase)
                                                                    </Badge>
                                                                ) : null}
                                                                {increaseEligibility?.may_disburse_new_loan === false ? (
                                                                    <Badge variant="outline" className="border-red-300 bg-white/80 text-red-900 text-[0.6875rem]">
                                                                        {increaseEligibility?.has_completed_prior_loan
                                                                            ? 'Disburse blocked until branch manager approves'
                                                                            : 'Disburse blocked until rules met'}
                                                                    </Badge>
                                                                ) : null}
                                                            </div>
                                                            {(increaseEligibility?.can_submit_loan_increase_approval_request ??
                                                                increaseEligibility?.can_submit_attendance_exception_request) ? (
                                                                <div className="mt-3 space-y-2 border-t border-orange-200/80 pt-3 dark:border-orange-900/40">
                                                                    <Label htmlFor="attendance-exception-notes" className="text-xs font-medium">
                                                                        Request branch manager approval (required for every loan increase)
                                                                    </Label>
                                                                    <Textarea
                                                                        id="attendance-exception-notes"
                                                                        placeholder="Explain why this borrower should receive a new loan after completing the previous one (repayment behaviour, attendance, business case, etc.)."
                                                                        value={attendanceExceptionNotes}
                                                                        onChange={(e) => setAttendanceExceptionNotes(e.target.value)}
                                                                        rows={4}
                                                                        className="resize-y text-sm"
                                                                    />
                                                                    <Button
                                                                        type="button"
                                                                        variant="secondary"
                                                                        size="sm"
                                                                        disabled={submittingAttendanceException}
                                                                        onClick={handleSubmitAttendanceException}
                                                                    >
                                                                        {submittingAttendanceException ? (
                                                                            <>
                                                                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                                                Submitting…
                                                                            </>
                                                                        ) : (
                                                                            'Submit approval request'
                                                                        )}
                                                                    </Button>
                                                                </div>
                                                            ) : null}
                                                        </>
                                                    )}
                                                </div>
                                            )}
                                            
                                            <div className="space-y-2">
                                                <Label htmlFor="product" className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                                                    <CreditCard className="h-4 w-4 shrink-0 text-brand-gold-deep" />
                                                    Loan Product *
                                                </Label>
                                                <Select value={formData.productId} onValueChange={e => setFormData({ ...formData, productId: e })}>
                                                    <SelectTrigger id="product" className="h-11 w-full min-w-0 border-neutral-200 bg-white focus:ring-2 focus:ring-brand-gold/35 focus:border-brand-gold-deep dark:border-neutral-700 dark:bg-neutral-900">
                                                        <SelectValue placeholder="Select Loan Product" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        {loanProducts.map(p => (
                                                            <SelectItem key={p.id} value={p.id} className="cursor-pointer">
                                                                <div className="flex flex-col py-1">
                                                                    <span className="font-medium">{p.name}</span>
                                                                    <span className="text-xs text-gray-500">{p.interest_rate}% Interest • {p.loan_period} {p.loan_period_unit}</span>
                                                                </div>
                                                            </SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>

                                             <AnimatePresence>
                                                {selectedProduct && (
                                                    <motion.div 
                                                        initial={{ opacity: 0, height: 0 }} 
                                                        animate={{ opacity: 1, height: 'auto' }}
                                                        exit={{ opacity: 0, height: 0 }}
                                                        className="rounded-xl border border-brand-gold/25 bg-brand-gold/5 p-4 text-sm text-neutral-800 dark:border-brand-gold/30 dark:bg-brand-gold/10 dark:text-neutral-100"
                                                    >
                                                        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                                                            <span className="font-semibold">Product Terms</span>
                                                            <Badge variant="outline" className="border-brand-gold/40 bg-white/90 text-brand-gold-deep dark:bg-neutral-900/80 dark:text-brand-gold">{selectedProduct.name}</Badge>
                                                        </div>
                                                        <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 sm:gap-x-4 sm:gap-y-2">
                                                            <div>Min Amount: <span className="font-medium">{currency} {selectedProduct.min_amount.toLocaleString()}</span></div>
                                                            <div>Max Amount: <span className="font-medium">{currency} {selectedProduct.max_amount.toLocaleString()}</span></div>
                                                            <div>Rate: <span className="font-medium">{selectedProduct.interest_rate}%</span></div>
                                                            <div>Period: <span className="font-medium">{selectedProduct.loan_period} {selectedProduct.loan_period_unit}</span></div>
                                                        </div>
                                                    </motion.div>
                                                )}
                                            </AnimatePresence>
                                        </motion.div>
                                        
                                        {/* Right Column: Amount & Dates */}
                                        <motion.div className="space-y-5 sm:space-y-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
                                            <div className="space-y-2">
                                                <Label htmlFor="principal" className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                                                    <DollarSign className="h-4 w-4 shrink-0 text-brand-gold-deep" />
                                                    Principal Amount ({currency}) *
                                                </Label>
                                                <div className="relative">
                                                    <Input 
                                                        id="principal"
                                                        type="number" 
                                                        value={formData.principal} 
                                                        onChange={e => setFormData({ ...formData, principal: e.target.value })}
                                                        placeholder="0.00"
                                                        min="0"
                                                        step="0.01"
                                                        className="h-11 min-h-[2.75rem] w-full min-w-0 pl-14 text-base font-medium tabular-nums bg-white border-neutral-200 focus-visible:ring-2 focus-visible:ring-brand-gold/35 focus-visible:border-brand-gold-deep dark:border-neutral-700 dark:bg-neutral-900 sm:text-lg"
                                                    />
                                                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold uppercase tracking-wide text-neutral-500">{currency}</span>
                                                </div>
                                                {selectedProduct && (formData.principal < selectedProduct.min_amount || formData.principal > selectedProduct.max_amount) && formData.principal !== '' && (
                                                    <p className="text-xs text-red-500 font-medium mt-1 animate-pulse">Amount must be between {selectedProduct.min_amount.toLocaleString()} and {selectedProduct.max_amount.toLocaleString()}</p>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-4">
                                                <div className="space-y-2 min-w-0">
                                                    <Label className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                                                        <CalendarDays className="h-4 w-4 shrink-0 text-brand-gold-deep" />
                                                        Disbursement *
                                                    </Label>
                                                    <Input
                                                        type="date"
                                                        value={formData.disbursementDate}
                                                        onChange={(e) => setFormData(prev => ({ ...prev, disbursementDate: e.target.value }))}
                                                        className="h-11 w-full min-w-0 cursor-pointer border-neutral-200 bg-white focus-visible:ring-2 focus-visible:ring-brand-gold/35 focus-visible:border-brand-gold-deep dark:border-neutral-700 dark:bg-neutral-900"
                                                    />
                                                </div>
                                                
                                                <div className="space-y-2 min-w-0">
                                                    <Label className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                                                        <CalendarDays className="h-4 w-4 shrink-0 text-brand-gold-deep" />
                                                        Repayment Start *
                                                    </Label>
                                                    <Input
                                                        type="date"
                                                        value={formData.repaymentStartDate}
                                                        onChange={(e) => setFormData(prev => ({ ...prev, repaymentStartDate: e.target.value }))}
                                                        min={formData.disbursementDate}
                                                        className="h-11 w-full min-w-0 cursor-pointer border-neutral-200 bg-white focus-visible:ring-2 focus-visible:ring-brand-gold/35 focus-visible:border-brand-gold-deep dark:border-neutral-700 dark:bg-neutral-900"
                                                    />
                                                </div>
                                            </div>
                                        </motion.div>
                                    </div>

                                    <motion.div className="flex flex-col-reverse gap-3 border-t border-neutral-200/90 pt-4 dark:border-neutral-800 sm:flex-row sm:justify-end sm:gap-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
                                        <Button variant="outline" onClick={() => setDialogOpen(false)} className="h-11 w-full border-neutral-300 px-6 sm:w-auto dark:border-neutral-600 dark:hover:bg-neutral-800">
                                            Cancel
                                        </Button>
                                        <Button 
                                            onClick={handleDisburse} 
                                            className="h-11 w-full bg-gradient-to-r from-brand-gold via-[#c9a227] to-brand-gold-deep px-6 font-semibold text-neutral-950 shadow-md transition-all hover:brightness-105 disabled:opacity-60 sm:w-auto sm:min-w-[200px] dark:from-brand-gold dark:to-brand-gold-deep"
                                            disabled={isDisbursingLoan || !canConfirmDisburse}
                                        >
                                            {isDisbursingLoan ? (
                                                <>
                                                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                                                    Processing...
                                                </>
                                            ) : (
                                                <>
                                                    <CheckCircle2 className="mr-2 h-5 w-5" />
                                                    Confirm Disbursement
                                                </>
                                            )}
                                        </Button>
                                    </motion.div>
                                </motion.div>
                            </DialogContent>
                        </Dialog>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    <StatCard title="Total Loans" value={stats.totalLoans} icon={Briefcase} color="text-blue-600" />
                    <StatCard title="Total Principal" value={`${currency} ${stats.totalPrincipal.toLocaleString()}`} icon={DollarSign} color="text-green-600" />
                    <StatCard title="Total Outstanding" value={`${currency} ${stats.totalBalance.toLocaleString()}`} icon={DollarSign} color="text-yellow-600" />
                    <StatCard title="Loans at Risk" value={stats.atRiskLoans} icon={AlertTriangle} color="text-red-600" />
                </div>

                <Card className="border-none shadow-md overflow-hidden">
                    <CardHeader className="bg-gray-50 border-b border-gray-100 pb-4">
                        <div className="flex flex-col gap-4">
                            <CardTitle className="text-xl font-bold text-gray-800">My Loan Portfolio</CardTitle>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                                <Input 
                                    placeholder="Search by ID, name..." 
                                    value={searchQuery} 
                                    onChange={(e) => setSearchQuery(e.target.value)} 
                                    className="bg-white border-gray-200 focus:ring-blue-100 focus:border-blue-400"
                                />
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
                                    disabled={portfolioGroupRows.length === 0}
                                    aria-label="Filter by group"
                                >
                                    <option value="all">
                                        {portfolioGroupRows.length === 0 ? 'No groups' : 'All groups'}
                                    </option>
                                    {portfolioGroupRows.map((g) => (
                                        <option key={g.id} value={g.id}>
                                            {g.name}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    className={NATIVE_SELECT_FILTER}
                                    value={statusFilter}
                                    onChange={(e) => setStatusFilter(e.target.value)}
                                    aria-label="Filter by status"
                                >
                                    <option value="all">All statuses</option>
                                    {LOAN_STATUS_FILTER_OPTIONS.map((o) => (
                                        <option key={o.value} value={o.value}>
                                            {o.label}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    className={NATIVE_SELECT_FILTER}
                                    value={productFilter}
                                    onChange={(e) => setProductFilter(e.target.value)}
                                    aria-label="Filter by product"
                                >
                                    <option value="all">All products</option>
                                    {loanProducts.map((p) => (
                                        <option key={p.id} value={p.id}>
                                            {p.name}
                                        </option>
                                    ))}
                                </select>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant={"outline"} className="justify-start text-left font-normal bg-white border-gray-200">
                                            <CalendarIcon className="mr-2 h-4 w-4 text-gray-500" />
                                            {dateRange?.from ? (
                                                dateRange.to ? (
                                                    <>{formatTZ(dateRange.from, "LLL dd, y", { timeZone: EAT_TIMEZONE })} - {formatTZ(dateRange.to, "LLL dd, y", { timeZone: EAT_TIMEZONE })}</>
                                                ) : (
                                                    formatTZ(dateRange.from, "LLL dd, y", { timeZone: EAT_TIMEZONE })
                                                )
                                            ) : (
                                                <span className="text-gray-500">Pick a date range</span>
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
                    <CardContent className="p-0">
                        <div className="px-4 pt-4">
                            <BulkDataTableToolbar selectedCount={bulk.count} onClear={bulk.clear} onExportCsv={exportLoansCsv} />
                        </div>
                        <Table>
                            <TableHeader className="bg-gray-50">
                                <TableRow>
                                    <TableHead className="w-10 align-middle">
                                        <Checkbox checked={bulk.allSelected ? true : bulk.count > 0 ? 'indeterminate' : false} onCheckedChange={() => bulk.toggleAll()} aria-label="Select page" />
                                    </TableHead>
                                    <TableHead className="font-semibold text-gray-600">Loan ID</TableHead>
                                    <TableHead className="font-semibold text-gray-600">Borrower</TableHead>
                                    <TableHead className="font-semibold text-gray-600">Principal</TableHead>
                                    <TableHead className="font-semibold text-gray-600">Balance</TableHead>
                                    <TableHead className="font-semibold text-gray-600">Disbursement</TableHead>
                                    <TableHead className="font-semibold text-gray-600">Status</TableHead>
                                    <TableHead className="font-semibold text-gray-600 text-right">Actions</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {pagedLoans.map(l => (
                                    <TableRow key={l.id} className="hover:bg-gray-50/50 transition-colors">
                                        <TableCell className="align-middle">
                                            <Checkbox checked={bulk.isSelected(l.id)} onCheckedChange={() => bulk.toggle(l.id)} aria-label={`Select ${l.loan_id}`} />
                                        </TableCell>
                                        <TableCell className="font-medium text-gray-900">{l.loan_id}</TableCell>
                                        <TableCell>{l.borrowers?.first_name} {l.borrowers?.surname}</TableCell>
                                        <TableCell className="text-gray-700 font-medium">{currency} {Number(l.principal).toLocaleString()}</TableCell>
                                        <TableCell className="text-gray-700 font-medium">{currency} {Number(l.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                        <TableCell>{formatTZ(toZonedTime(new Date(l.disbursement_date), EAT_TIMEZONE), 'MMM dd, yyyy', { timeZone: EAT_TIMEZONE })}</TableCell>
                                        <TableCell><Badge variant={loanStatusBadgeVariant(l.status)} className="shadow-sm">{loanStatusLabel(l.status)}</Badge></TableCell>
                                        <TableCell className="text-right">
                                            <div className="flex justify-end gap-2">
                                                <Button variant="ghost" size="icon" onClick={() => viewSchedule(l)} title="View Schedule" className="hover:bg-blue-50 hover:text-blue-600">
                                                    {isRefreshingSchedule && selectedLoan?.id === l.id ? <Loader2 className="h-4 w-4 animate-spin"/> : <Eye className="h-4 w-4"/>}
                                                </Button>
                                                <Button variant="ghost" size="icon" onClick={() => handleOpenEditDialog(l)} disabled={l.status?.includes('_requested')} className="hover:bg-purple-50 hover:text-purple-600">
                                                    <Edit className="h-4 w-4" />
                                                </Button>
                                                <AlertDialog>
                                                    <AlertDialogTrigger asChild>
                                                        <Button variant="ghost" size="icon" disabled={l.status?.includes('_requested')} className="hover:bg-red-50 hover:text-red-600">
                                                            <Trash2 className="h-4 w-4" />
                                                        </Button>
                                                    </AlertDialogTrigger>
                                                    <AlertDialogContent>
                                                        <AlertDialogHeader><AlertDialogTitle>Request Loan Deletion?</AlertDialogTitle><AlertDialogDescription>This sends a deletion request. You cannot undo this.</AlertDialogDescription></AlertDialogHeader>
                                                        <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => handleRequestDeletion(l.id)}>Yes, Request</AlertDialogAction></AlertDialogFooter>
                                                    </AlertDialogContent>
                                                </AlertDialog>
                                            </div>
                                        </TableCell>
                                    </TableRow>
                                ))}
                                {filteredLoans.length === 0 && (
                                    <TableRow>
                                        <TableCell colSpan={8} className="text-center py-8 text-muted-foreground">No loans match the current filters.</TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                        {filteredLoans.length > 0 && (
                            <div className="flex flex-wrap items-center justify-between gap-4 border-t px-6 py-4">
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
            
            {/* OTHER DIALOGS (Schedule, Edit) */}
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
            <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
                <DialogContent className={LOAN_EDIT_WIDE_CONTENT}>
                    <DialogHeader className="shrink-0"><DialogTitle>Request Edit for Loan {editingLoan?.loan_id}</DialogTitle></DialogHeader>
                    <div className={SCHEDULE_DIALOG_SCROLL}>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 py-4">
                        <div className="space-y-4">
                            <Select value={editFormData.productId} onValueChange={e => setEditFormData({ ...editFormData, productId: e })}>
                                <SelectTrigger className="w-full"><SelectValue placeholder="Select Loan Product" /></SelectTrigger>
                                <SelectContent>
                                    {loanProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                </SelectContent>
                            </Select>
                            <div><Label>Principal Amount ({currency})</Label><Input type="number" value={editFormData.principal} onChange={e => setEditFormData({ ...editFormData, principal: e.target.value })} /></div>
                             <div>
                                <Label>Disbursement Date</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant={"outline"} className="w-full justify-start text-left font-normal">
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {editFormData.disbursementDate ? formatTZ(editFormData.disbursementDate, "PPP", { timeZone: EAT_TIMEZONE }) : <span>Pick a date</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar mode="single" selected={editFormData.disbursementDate} onSelect={(date) => setEditFormData({...editFormData, disbursementDate: date})} disabled={disabledDays} initialFocus/>
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <div>
                                <Label>Repayment Start Date</Label>
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button variant={"outline"} className="w-full justify-start text-left font-normal">
                                            <CalendarIcon className="mr-2 h-4 w-4" />
                                            {editFormData.repaymentStartDate ? formatTZ(editFormData.repaymentStartDate, "PPP", { timeZone: EAT_TIMEZONE }) : <span>Pick a date</span>}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-auto p-0">
                                        <Calendar mode="single" selected={editFormData.repaymentStartDate} onSelect={(date) => setEditFormData({...editFormData, repaymentStartDate: date})} disabled={disabledDays} initialFocus/>
                                    </PopoverContent>
                                </Popover>
                            </div>
                            <Button onClick={handleRequestEdit} className="w-full">Send Edit Request</Button>
                        </div>
                        <div className="space-y-2">
                             <h4 className="font-semibold text-lg">New Schedule Preview</h4>
                             <div className="border rounded-md max-h-80 overflow-y-auto">
                                <Table>
                                    <TableHeader><TableRow><TableHead>#</TableHead><TableHead>Due Date</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader>
                                    <TableBody>
                                        {newSchedulePreview.length > 0 ? newSchedulePreview.map(inst => (
                                            <TableRow key={inst.installmentNumber}>
                                                <TableCell>{inst.installmentNumber}</TableCell>
                                                <TableCell>{formatDate(new Date(inst.dueDate), 'MMM dd, yyyy')}</TableCell>
                                                <TableCell>{currency} {inst.amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}</TableCell>
                                            </TableRow>
                                        )) : (
                                            <TableRow><TableCell colSpan={3} className="text-center">Enter valid details to generate preview.</TableCell></TableRow>
                                        )}
                                    </TableBody>
                                </Table>
                             </div>
                        </div>
                    </div>
                    </div>
                </DialogContent>
            </Dialog>
            <ImportResultDialog
                open={importReportOpen}
                onOpenChange={setImportReportOpen}
                summary={importReportSummary}
                details={importReportDetails}
            />
        </DashboardLayout>
    );
};

export default LoanManagement;
