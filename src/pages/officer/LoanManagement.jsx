
import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase, invokeEdgeFunction } from '@/lib/customSupabaseClient';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
import { PlusCircle, Eye, Trash2, Download, Upload, Briefcase, DollarSign, AlertTriangle, Edit, Loader2, Calendar as CalendarIcon, Coins as HandCoins, CheckCircle2, User, CreditCard, CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { generateSchedule, getNextWorkingDay } from '@/utils/loanUtils';
import * as XLSX from 'xlsx';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';
import { format as formatDate, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '@/lib/utils';

const EAT_TIMEZONE = 'Africa/Nairobi';
const PAGE_SIZE = 25;

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
    const { user, session } = useAuth();
    const { toast } = useToast();
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
    const [repaymentDialogOpen, setRepaymentDialogOpen] = useState(false);
    const [selectedLoan, setSelectedLoan] = useState(null);
    const [isRefreshingSchedule, setIsRefreshingSchedule] = useState(false);
    const [editingLoan, setEditingLoan] = useState(null);
    const [repaymentLoan, setRepaymentLoan] = useState(null);
    const [currency, setCurrency] = useState('TZS');
    const [isSubmittingRepayment, setIsSubmittingRepayment] = useState(false);
    
    const [searchQuery, setSearchQuery] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [productFilter, setProductFilter] = useState('all');
    const [dateRange, setDateRange] = useState({ from: undefined, to: undefined });
    const [page, setPage] = useState(1);

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
    
    const [repaymentFormData, setRepaymentFormData] = useState({ amount: '', payment_date: new Date() });
    const importFileRef = useRef(null);
    const [increaseEligibility, setIncreaseEligibility] = useState(null);
    const [increaseEligibilityLoading, setIncreaseEligibilityLoading] = useState(false);
    
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
            .select(`*, borrowers(*, groups(name), branches(name)), loan_products(name)`)
            .eq('officer_id', user.id);
        const { data: borrowersData, error: borrowersError } = await supabase.from('borrowers').select('*').eq('loan_officer_id', user.id);
        const { data: productsData, error: productsError } = await supabase.from('loan_products').select('*').eq('status', 'active');
        const { data: holidaysData, error: holidaysError } = await supabase.from('holidays').select('*');
        
        if (loansError || borrowersError || productsError || holidaysError) {
            toast({ title: 'Error fetching data', description: loansError?.message || borrowersError?.message || productsError?.message || holidaysError?.message, variant: 'destructive' });
        } else {
            setLoans(loansData || []);
            setBorrowers(borrowersData || []);
            setLoanProducts(productsData || []);
            setHolidays(holidaysData || []);
        }
        setLoading(false);
    }, [user, toast]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);
    
    useEffect(() => {
       resetFormData();
    }, [resetFormData]);

    useEffect(() => {
        if (!formData.borrowerId) {
            setIncreaseEligibility(null);
            setIncreaseEligibilityLoading(false);
            return;
        }
        let cancelled = false;
        setIncreaseEligibilityLoading(true);
        supabase
            .rpc('borrower_loan_increase_eligibility', { p_borrower_id: formData.borrowerId })
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
    }, [formData.borrowerId]);


    const filteredLoans = useMemo(() => {
        return loans.filter(loan => {
            const borrowerName = `${loan.borrowers?.first_name || ''} ${loan.borrowers?.surname || ''}`.toLowerCase();
            const query = searchQuery.toLowerCase();
            const matchesSearch = loan.loan_id.toLowerCase().includes(query) || borrowerName.includes(query) || loan.principal.toString().includes(query);
            const matchesStatus = statusFilter === 'all' || loan.status === statusFilter;
            const matchesProduct = productFilter === 'all' || loan.product_id === productFilter;
            
            let matchesDate = true;
            if (dateRange.from && dateRange.to) {
                const loanDate = toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE);
                matchesDate = loanDate >= toZonedTime(dateRange.from, EAT_TIMEZONE) && loanDate <= toZonedTime(dateRange.to, EAT_TIMEZONE);
            } else if (dateRange.from) {
                matchesDate = toZonedTime(new Date(loan.disbursement_date), EAT_TIMEZONE) >= toZonedTime(dateRange.from, EAT_TIMEZONE);
            }

            return matchesSearch && matchesStatus && matchesProduct && matchesDate;
        });
    }, [loans, searchQuery, statusFilter, productFilter, dateRange]);

    useEffect(() => {
        setPage(1);
    }, [searchQuery, statusFilter, productFilter, dateRange]);

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
            const { data: borrower, error: borrowerError } = await supabase.from('borrowers').select('status').eq('id', borrowerId).single();
            if (borrowerError || !borrower) {
                throw new Error('Borrower not found');
            }

            if (borrower.status === 'active_loan' || borrower.status === 'defaulted') {
                toast({ title: 'Cannot Disburse Loan', description: `Borrower has an ${borrower.status.toLowerCase().replace('_', ' ')} loan and cannot receive a new one.`, variant: 'destructive' });
                setIsDisbursingLoan(false);
                return;
            }

            const product = loanProducts.find(p => p.id === productId);
            if (!product) {
                throw new Error('Loan product not found');
            }

            const principalAmount = parseFloat(principal);

            if (principalAmount < product.min_amount || principalAmount > product.max_amount) {
                toast({ title: 'Validation Error', description: `Principal amount must be between ${currency} ${product.min_amount.toLocaleString()} and ${currency} ${product.max_amount.toLocaleString()}.`, variant: 'destructive' });
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

            const { error: loanInsertError } = await supabase.from('loans').insert(newLoan);

            if (loanInsertError) {
                throw loanInsertError;
            }

            await supabase.from('borrowers').update({ status: 'active_loan' }).eq('id', borrowerId);
            
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
    
    const handleDownloadTemplate = () => {
        const templateData = [{ borrower_id: '', loan_product_name: '', principal: '', disbursement_date: '', repayment_start_date: '' }];
        const loansSheet = XLSX.utils.json_to_sheet(templateData);
        const instructions = [
            ['Column Name', 'Description', 'Example'],
            ['borrower_id', 'The unique ID of the borrower. Must exist in the system.', 'B-123456'],
            ['loan_product_name', 'The exact name of an active loan product.', 'Personal Loan'],
            ['principal', 'The loan amount without currency symbols.', '500000'],
            ['disbursement_date', 'Date the loan is given. Format: YYYY-MM-DD. Must be a working day.', '2025-11-10'],
            ['repayment_start_date', 'Date repayments begin. Format: YYYY-MM-DD. Must be a working day.', '2025-12-10']
        ];
        const instructionsSheet = XLSX.utils.aoa_to_sheet(instructions);
        const validBorrowers = borrowers.filter(b => b.status === 'eligible' || b.status === 'paid_up').map(b => ({ 'Borrower ID': b.borrower_id, 'Name': `${b.first_name} ${b.surname}` }));
        const borrowersSheet = XLSX.utils.json_to_sheet(validBorrowers);
        const validProducts = loanProducts.map(p => ({ 'Product Name': p.name }));
        const productsSheet = XLSX.utils.json_to_sheet(validProducts);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, loansSheet, 'Loans Import');
        XLSX.utils.book_append_sheet(workbook, instructionsSheet, 'Instructions');
        XLSX.utils.book_append_sheet(workbook, borrowersSheet, 'Valid Borrowers');
        XLSX.utils.book_append_sheet(workbook, productsSheet, 'Valid Loan Products');
        XLSX.writeFile(workbook, 'Loans_Import_Template.xlsx');
    };
    
    const isWorkingDay = (dateStr) => {
        const date = toZonedTime(new Date(dateStr), EAT_TIMEZONE);
        if (date.getDay() === 0) return false;
        const isHoliday = holidays.some(h => formatTZ(toZonedTime(new Date(h.date), EAT_TIMEZONE), 'yyyy-MM-dd') === dateStr);
        if (isHoliday) return false;
        return true;
    };
    
    const handleImport = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        setIsImporting(true);
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const data = new Uint8Array(e.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const importedLoans = XLSX.utils.sheet_to_json(worksheet, { raw: true });
                const borrowersMap = new Map(borrowers.map(b => [b.borrower_id, b]));
                const productsMap = new Map(loanProducts.map(p => [p.name.toLowerCase(), p]));
                const newLoans = [];
                const skippedLoans = [];
                for (const row of importedLoans) {
                    const borrower = borrowersMap.get(row.borrower_id);
                    const product = productsMap.get(row.loan_product_name?.toLowerCase());
                    const disbursementDate = excelSerialDateToYYYYMMDD(row.disbursement_date);
                    const repaymentStartDate = excelSerialDateToYYYYMMDD(row.repayment_start_date);

                    if (!borrower || !product || !row.principal || !disbursementDate || !repaymentStartDate) {
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
                    const principalAmount = parseFloat(row.principal);
                    const interest = principalAmount * (parseFloat(product.interest_rate) / 100);
                    const totalPayable = principalAmount + interest;
                    const schedule = generateSchedule(principalAmount, product.interest_rate, totalPayable, product.loan_period, product.loan_period_unit, product.repayment_frequency, repaymentStartDate, holidays);
                    newLoans.push({
                        loan_id: `LN-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`, borrower_id: borrower.id, product_id: product.id, officer_id: user.id, principal: principalAmount, interest_rate: product.interest_rate, total_payable: totalPayable, balance: totalPayable, outstanding_interest: interest, repayment_frequency: product.repayment_frequency, period: product.loan_period, period_unit: product.loan_period_unit, disbursement_date: disbursementDate, repayment_start_date: repaymentStartDate, status: 'active', schedule: schedule,
                    });
                }
                if (newLoans.length > 0) {
                    const { error } = await supabase.from('loans').insert(newLoans);
                    if (error) throw error;
                    const borrowerIdsToUpdate = newLoans.map(l => l.borrower_id);
                    await supabase.from('borrowers').update({ status: 'active_loan' }).in('id', borrowerIdsToUpdate);
                }
                toast({ title: 'Import Complete', description: `${newLoans.length} loans imported successfully. ${skippedLoans.length} loans skipped.` });
                if (skippedLoans.length > 0) {
                     console.log("Skipped loans:", skippedLoans);
                     toast({ title: 'Some loans were skipped', description: 'Check console for details on skipped loans.', variant: 'default'});
                }
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
                .select(`*, borrowers(*, groups(name), branches(name)), loan_products(name)`)
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

    const handleOpenRepaymentDialog = (loan) => {
        setRepaymentLoan(loan);
        setRepaymentFormData({ amount: '', payment_date: new Date() });
        setRepaymentDialogOpen(true);
    };

    const handleRecordRepayment = async () => {
        const { amount, payment_date } = repaymentFormData;
        if (!amount || !payment_date || !repaymentLoan) {
            toast({ title: 'Error', description: 'Please fill all fields.', variant: 'destructive' });
            return;
        }
        setIsSubmittingRepayment(true);

        const { data, error } = await invokeEdgeFunction(
            'record-repayment',
            {
                body: {
                    loan_id: repaymentLoan.id,
                    amount: parseFloat(amount),
                    officer_id: user.id,
                    actual_payment_date: formatTZ(payment_date, 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE }),
                },
            },
            session?.access_token,
        );

        if (error) {
            toast({ title: 'Repayment Failed', description: error.message, variant: 'destructive' });
        } else {
            toast({ title: 'Success', description: data.message || 'Repayment recorded successfully!' });
            fetchData();
            setRepaymentDialogOpen(false);
        }
        setIsSubmittingRepayment(false);
    };

    const getStatusBadge = (status) => ({ active: 'success', paid: 'default', delinquent: 'warning', defaulted: 'destructive', delete_requested: 'secondary', edit_requested: 'secondary' }[status] || 'secondary');
    
    // Filter borrowers for selection (only eligible ones)
    const eligibleBorrowers = useMemo(() => 
        borrowers.filter(b => b.status === 'eligible' || b.status === 'paid_up'),
        [borrowers]
    );

    const selectedProduct = useMemo(() => {
        return loanProducts.find(p => p.id === formData.productId);
    }, [formData.productId, loanProducts]);

    if (loading) return <DashboardLayout title="Loan Management"><div className="flex items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin" /></div></DashboardLayout>;

    return (
        <DashboardLayout title="Loan Management">
            <div className="space-y-8">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <p className="text-sm text-neutral-500">Manage, disburse, and track all loan activities.</p>
                    </div>
                    <div className="flex flex-wrap gap-3">
                        <Button variant="outline" onClick={handleDownloadTemplate} className="border-brand-gold/35 bg-white/80 hover:bg-brand-gold/10 dark:border-brand-gold/25 dark:bg-neutral-900/50 dark:hover:bg-brand-gold/10">
                             <Download className="mr-2 h-4 w-4 text-brand-gold-deep" /> Template
                        </Button>
                        <Button variant="outline" onClick={() => importFileRef.current.click()} disabled={isImporting} className="border-brand-gold/35 bg-white/80 hover:bg-brand-gold/10 dark:border-brand-gold/25 dark:bg-neutral-900/50 dark:hover:bg-brand-gold/10">
                            {isImporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4 text-brand-gold-deep" />} Import
                        </Button>
                        <input type="file" ref={importFileRef} className="hidden" accept=".csv, .xlsx" onChange={handleImport} />
                        
                        <Dialog open={dialogOpen} onOpenChange={(open) => {
                            setDialogOpen(open);
                            if (open) resetFormData();
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
                                            Follow the steps to disburse a loan to a qualified borrower.
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
                                            <div className="space-y-2">
                                                <Label className="flex items-center gap-2 text-sm font-semibold text-neutral-800 dark:text-neutral-200">
                                                    <User className="h-4 w-4 shrink-0 text-brand-gold-deep" />
                                                    Select Borrower *
                                                </Label>
                                                <div className="rounded-xl border border-neutral-200/80 bg-white shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
                                                    <Select 
                                                        value={formData.borrowerId} 
                                                        onValueChange={e => setFormData({ ...formData, borrowerId: e })}
                                                    >
                                                        <SelectTrigger className="h-11 w-full min-w-0 border-0 bg-transparent focus:ring-2 focus:ring-brand-gold/35 focus:ring-offset-0 dark:focus:ring-brand-gold/40">
                                                            <SelectValue placeholder="Select Borrower..." />
                                                        </SelectTrigger>
                                                        <SelectContent className="max-h-[300px]">
                                                            {eligibleBorrowers.length > 0 ? (
                                                                eligibleBorrowers.map(b => (
                                                                    <SelectItem key={b.id} value={b.id} className="py-3 cursor-pointer">
                                                                        <div className="flex flex-col">
                                                                            <span className="font-semibold">{b.first_name} {b.surname}</span>
                                                                            <span className="text-xs text-gray-500">ID: {b.borrower_id}</span>
                                                                        </div>
                                                                    </SelectItem>
                                                                ))
                                                            ) : (
                                                                <div className="p-4 text-center text-gray-500 text-sm">No eligible borrowers found.</div>
                                                            )}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                            </div>

                                            {(increaseEligibilityLoading || increaseEligibility) && (
                                                <div
                                                    className={cn(
                                                        'rounded-lg border p-3 text-sm',
                                                        increaseEligibilityLoading && 'border-neutral-200 bg-neutral-50 text-neutral-700',
                                                        !increaseEligibilityLoading &&
                                                            increaseEligibility?.requires_manager_loan_approval &&
                                                            'border-amber-200 bg-amber-50 text-amber-950',
                                                        !increaseEligibilityLoading &&
                                                            !increaseEligibility?.requires_manager_loan_approval &&
                                                            increaseEligibility?.eligible_for_auto_loan_increase &&
                                                            'border-emerald-200 bg-emerald-50 text-emerald-950',
                                                        !increaseEligibilityLoading &&
                                                            !increaseEligibility?.requires_manager_loan_approval &&
                                                            !increaseEligibility?.eligible_for_auto_loan_increase &&
                                                            'border-neutral-200 bg-neutral-50 text-neutral-800'
                                                    )}
                                                >
                                                    {increaseEligibilityLoading ? (
                                                        <div className="flex items-center gap-2 text-neutral-600">
                                                            <Loader2 className="h-4 w-4 animate-spin" />
                                                            <span>Checking attendance &amp; loan history…</span>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <p className="font-semibold text-[0.8125rem]">Loan increase eligibility</p>
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
                                                                        Manager approval required
                                                                    </Badge>
                                                                ) : null}
                                                                {increaseEligibility?.eligible_for_auto_loan_increase ? (
                                                                    <Badge variant="outline" className="border-emerald-300 bg-white/80 text-emerald-900 text-[0.6875rem]">
                                                                        Eligible for auto increase (rules)
                                                                    </Badge>
                                                                ) : null}
                                                            </div>
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
                                            disabled={isDisbursingLoan}
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
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                                <Input 
                                    placeholder="Search by ID, name..." 
                                    value={searchQuery} 
                                    onChange={(e) => setSearchQuery(e.target.value)} 
                                    className="bg-white border-gray-200 focus:ring-blue-100 focus:border-blue-400"
                                />
                                <Select value={statusFilter} onValueChange={setStatusFilter}>
                                    <SelectTrigger className="bg-white border-gray-200"><SelectValue placeholder="Filter by Status" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Statuses</SelectItem>
                                        <SelectItem value="active">Active</SelectItem>
                                        <SelectItem value="paid">Paid</SelectItem>
                                        <SelectItem value="delinquent">Delinquent</SelectItem>
                                        <SelectItem value="defaulted">Defaulted</SelectItem>
                                        <SelectItem value="edit_requested">Edit Requested</SelectItem>
                                        <SelectItem value="delete_requested">Delete Requested</SelectItem>
                                    </SelectContent>
                                </Select>
                                <Select value={productFilter} onValueChange={setProductFilter}>
                                    <SelectTrigger className="bg-white border-gray-200"><SelectValue placeholder="Filter by Product" /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="all">All Products</SelectItem>
                                        {loanProducts.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                                    </SelectContent>
                                </Select>
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
                                        <TableCell><Badge variant={getStatusBadge(l.status)} className="capitalize shadow-sm">{l.status.replace(/_/g, ' ')}</Badge></TableCell>
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
                                                <Button variant="default" size="icon" onClick={() => handleOpenRepaymentDialog(l)} className="bg-green-600 hover:bg-green-700 shadow-sm" disabled={l.status === 'paid'}>
                                                    <HandCoins className="h-4 w-4" />
                                                </Button>
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
            
            {/* OTHER DIALOGS (Schedule, Edit, Repayment) - kept minimal for brevity, focusing on Disbursement redesign */}
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
            <Dialog open={repaymentDialogOpen} onOpenChange={setRepaymentDialogOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Record Repayment for {repaymentLoan?.loan_id}</DialogTitle>
                        <DialogDescription>
                            Borrower: {repaymentLoan?.borrowers?.first_name} {repaymentLoan?.borrowers?.surname}
                        </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                        <div>
                            <Label>Repayment Amount ({currency})</Label>
                            <Input
                                type="number"
                                value={repaymentFormData.amount}
                                onChange={(e) => setRepaymentFormData({ ...repaymentFormData, amount: e.target.value })}
                                placeholder="Enter amount"
                            />
                        </div>
                        <div>
                            <Label>Actual Payment Date</Label>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant={"outline"} className="w-full justify-start text-left font-normal">
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {repaymentFormData.payment_date ? formatDate(repaymentFormData.payment_date, "PPP") : <span>Pick a date</span>}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0">
                                    <Calendar
                                        mode="single"
                                        selected={repaymentFormData.payment_date}
                                        onSelect={(date) => setRepaymentFormData({ ...repaymentFormData, payment_date: date })}
                                        disabled={{ after: new Date() }}
                                        initialFocus
                                    />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <Button onClick={handleRecordRepayment} className="w-full" disabled={isSubmittingRepayment}>
                           {isSubmittingRepayment ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <HandCoins className="mr-2 h-4 w-4" />}
                           Record Payment
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </DashboardLayout>
    );
};

export default LoanManagement;
