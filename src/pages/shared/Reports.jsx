import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Calendar as CalendarIcon, Printer, Users, Briefcase, DollarSign, TrendingUp, AlertTriangle, PiggyBank } from 'lucide-react';
import { format as formatDate, startOfMonth, endOfMonth, eachMonthOfInterval, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfYear, endOfYear, differenceInDays, eachDayOfInterval } from 'date-fns';
import * as XLSX from 'xlsx';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isRepaymentInReportsRange, repaymentReportDateYyyyMmDd } from '@/lib/repaymentReportDate';
import { useUserProfileScope, fetchOfficerIdsForBranch } from '@/hooks/useUserProfileScope';
import { prepaymentAmount, scheduledCollectionAmount } from '@/lib/repaymentPrepayment';

const REPAYMENT_REPORT_SELECT =
    '*, loans(id, borrower_id, loan_id, product_id, status, borrowers(*, groups(*)))';

const REPORT_STATUS_OPTIONS = [
    { value: 'pending', label: 'Pending' },
    { value: 'active', label: 'Active' },
    { value: 'paid', label: 'Paid' },
    { value: 'delinquent', label: 'Delinquent' },
    { value: 'defaulted', label: 'Defaulted' },
    { value: 'rejected', label: 'Rejected' },
];

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

const Reports = () => {
    const { user } = useAuth();
    const { toast } = useToast();
    const { loading: profileLoading, branchId: profileBranchId, role: profileRole } = useUserProfileScope(user?.id);
    const effectiveRole = profileRole ?? user?.user_metadata?.role;
    const managerBranchScope = profileBranchId ?? user?.user_metadata?.branch_id;
    const [loading, setLoading] = useState(true);
    const [currency, setCurrency] = useState('TZS');

    const [allData, setAllData] = useState({ loans: [], borrowers: [], repayments: [], users: [], branches: [], loanProducts: [], centers: [], groups: [] });

    const [dateRange, setDateRange] = useState({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) });
    const [activeDateFilter, setActiveDateFilter] = useState('monthly');

    const [selectedBranch, setSelectedBranch] = useState('all');
    const [selectedOfficer, setSelectedOfficer] = useState('all');
    const [selectedProduct, setSelectedProduct] = useState('all');
    const [selectedCenter, setSelectedCenter] = useState('all');
    const [selectedGroup, setSelectedGroup] = useState('all');
    const [selectedStatus, setSelectedStatus] = useState('all');

    const fetchData = useCallback(async () => {
        if (!user) return;
        if (profileLoading) {
            setLoading(true);
            return;
        }
        setLoading(true);

        const checkError = (res, name) => {
            if (res.error) throw new Error(`Failed to fetch ${name}: ${res.error.message}`);
            return res.data;
        };

        try {
            const role = effectiveRole;
            const cfgP = supabase.from('system_config').select('value').eq('key', 'currency').single();
            const prodP = supabase.from('loan_products').select('*');

            if (role === 'admin') {
                const [
                    configRes, loansRes, borrowersRes, repaymentsRes, usersRes,
                    branchesRes, productsRes, centersRes, groupsRes,
                ] = await Promise.all([
                    cfgP,
                    supabase.from('loans').select('*, borrowers!inner(*)'),
                    supabase.from('borrowers').select('*'),
                    supabase
                        .from('repayments')
                        .select(REPAYMENT_REPORT_SELECT)
                        .order('actual_payment_date', { ascending: false }),
                    supabase.from('users').select('*'),
                    supabase.from('branches').select('*'),
                    prodP,
                    supabase.from('centers').select('*'),
                    supabase.from('groups').select('*'),
                ]);

                setCurrency(checkError(configRes, 'config')?.value || 'TZS');
                setAllData({
                    loans: checkError(loansRes, 'loans'),
                    borrowers: checkError(borrowersRes, 'borrowers'),
                    repayments: checkError(repaymentsRes, 'repayments'),
                    users: checkError(usersRes, 'users'),
                    branches: checkError(branchesRes, 'branches'),
                    loanProducts: checkError(productsRes, 'products'),
                    centers: checkError(centersRes, 'centers'),
                    groups: checkError(groupsRes, 'groups'),
                });
            } else if (role === 'manager') {
                const branchId = managerBranchScope;
                if (!branchId) {
                    throw new Error('Branch not assigned to your profile.');
                }
                const officerIds = await fetchOfficerIdsForBranch(branchId);
                const [configRes, borrowersRes, branchesRes, usersRes, productsRes, centersRes] = await Promise.all([
                    cfgP,
                    supabase.from('borrowers').select('*').eq('branch_id', branchId),
                    supabase.from('branches').select('*').eq('id', branchId),
                    supabase.from('users').select('*').eq('branch_id', branchId),
                    prodP,
                    supabase.from('centers').select('*').eq('branch_id', branchId),
                ]);

                const centerRows = checkError(centersRes, 'centers');
                const centerIds = (centerRows || []).map((c) => c.id);

                let loansRes;
                let repaymentsRes;
                let groupsRes;
                if (officerIds.length === 0) {
                    loansRes = { data: [], error: null };
                    repaymentsRes = { data: [], error: null };
                    groupsRes = { data: [], error: null };
                } else {
                    [loansRes, repaymentsRes, groupsRes] = await Promise.all([
                        supabase.from('loans').select('*, borrowers!inner(*)').in('officer_id', officerIds),
                        supabase
                            .from('repayments')
                            .select(REPAYMENT_REPORT_SELECT)
                            .in('officer_id', officerIds)
                            .order('actual_payment_date', { ascending: false }),
                        centerIds.length > 0
                            ? supabase.from('groups').select('*').in('center_id', centerIds)
                            : Promise.resolve({ data: [], error: null }),
                    ]);
                }

                setCurrency(checkError(configRes, 'config')?.value || 'TZS');
                setAllData({
                    loans: checkError(loansRes, 'loans') || [],
                    borrowers: checkError(borrowersRes, 'borrowers') || [],
                    repayments: checkError(repaymentsRes, 'repayments') || [],
                    users: checkError(usersRes, 'users') || [],
                    branches: checkError(branchesRes, 'branches') || [],
                    loanProducts: checkError(productsRes, 'products') || [],
                    centers: centerRows || [],
                    groups: checkError(groupsRes, 'groups') || [],
                });
                setSelectedBranch(branchId);
            } else if (role === 'officer') {
                const branchId = managerBranchScope;
                const [configRes, loansRes, borrowersRes, repaymentsRes, usersRes, branchesRes, productsRes, centersRes, groupsRes] =
                    await Promise.all([
                        cfgP,
                        supabase.from('loans').select('*, borrowers!inner(*)').eq('officer_id', user.id),
                        supabase.from('borrowers').select('*').eq('loan_officer_id', user.id),
                        supabase
                            .from('repayments')
                            .select(REPAYMENT_REPORT_SELECT)
                            .eq('officer_id', user.id)
                            .order('actual_payment_date', { ascending: false }),
                        supabase.from('users').select('*').eq('id', user.id),
                        branchId
                            ? supabase.from('branches').select('*').eq('id', branchId)
                            : Promise.resolve({ data: [], error: null }),
                        prodP,
                        supabase.from('centers').select('*').eq('loan_officer_id', user.id),
                        supabase.from('groups').select('*').eq('loan_officer_id', user.id),
                    ]);

                setCurrency(checkError(configRes, 'config')?.value || 'TZS');
                setAllData({
                    loans: checkError(loansRes, 'loans'),
                    borrowers: checkError(borrowersRes, 'borrowers'),
                    repayments: checkError(repaymentsRes, 'repayments'),
                    users: checkError(usersRes, 'users'),
                    branches: checkError(branchesRes, 'branches'),
                    loanProducts: checkError(productsRes, 'products'),
                    centers: checkError(centersRes, 'centers'),
                    groups: checkError(groupsRes, 'groups'),
                });
            } else {
                setAllData({
                    loans: [],
                    borrowers: [],
                    repayments: [],
                    users: [],
                    branches: [],
                    loanProducts: [],
                    centers: [],
                    groups: [],
                });
            }
        } catch (error) {
            toast({ title: 'Error fetching report data', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user, toast, profileLoading, effectiveRole, managerBranchScope]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    const handleDateFilterChange = (value) => {
        setActiveDateFilter(value);
        const today = new Date();
        switch (value) {
            case 'daily': setDateRange({ from: startOfDay(today), to: endOfDay(today) }); break;
            case 'weekly': setDateRange({ from: startOfWeek(today), to: endOfWeek(today) }); break;
            case 'monthly': setDateRange({ from: startOfMonth(today), to: endOfMonth(today) }); break;
            case 'yearly': setDateRange({ from: startOfYear(today), to: endOfYear(today) }); break;
            default: setDateRange({ from: startOfMonth(today), to: endOfMonth(today) });
        }
    };

    const handleCustomDateChange = (range) => {
        setDateRange(range);
        setActiveDateFilter('custom');
    };

    const availableFilters = useMemo(() => {
        let officers = allData.users.filter(u => u.role === 'officer');
        let centers = allData.centers;
        let groups = allData.groups;

        const role = effectiveRole;

        if (role === 'manager') {
            officers = officers.filter((o) => o.branch_id === managerBranchScope);
            centers = centers.filter((c) => c.branch_id === managerBranchScope);
        } else if (role === 'officer') {
            officers = [];
            centers = centers.filter((c) => c.loan_officer_id === user.id);
        }

        if (selectedBranch !== 'all' && role === 'admin') {
            officers = officers.filter(o => o.branch_id === selectedBranch);
            centers = centers.filter(c => c.branch_id === selectedBranch);
        }
        
        const centerIdsInScope = centers.map(c => c.id);
        groups = allData.groups.filter(g => centerIdsInScope.includes(g.center_id));
        
        if (selectedOfficer !== 'all') {
            centers = centers.filter(c => c.loan_officer_id === selectedOfficer);
            groups = allData.groups.filter(g => {
                const center = allData.centers.find(c => c.id === g.center_id);
                return center && center.loan_officer_id === selectedOfficer;
            });
        }
        if (selectedCenter !== 'all') {
            groups = groups.filter(g => g.center_id === selectedCenter);
        }

        return { officers, centers, groups };
    }, [allData, user, selectedBranch, selectedOfficer, selectedCenter, effectiveRole, managerBranchScope]);

    const reportBranchOptions = useMemo(
        () => allData.branches.map((b) => ({ value: b.id, label: b.name })),
        [allData.branches]
    );
    const reportOfficerOptions = useMemo(
        () => availableFilters.officers.map((o) => ({ value: o.id, label: o.full_name })),
        [availableFilters.officers]
    );
    const reportProductOptions = useMemo(
        () => allData.loanProducts.map((p) => ({ value: p.id, label: p.name })),
        [allData.loanProducts]
    );
    const reportCenterOptions = useMemo(
        () => availableFilters.centers.map((c) => ({ value: c.id, label: c.name })),
        [availableFilters.centers]
    );
    const reportGroupOptions = useMemo(
        () => availableFilters.groups.map((g) => ({ value: g.id, label: g.name })),
        [availableFilters.groups]
    );

    const filteredData = useMemo(() => {
        const role = effectiveRole;

        // --- 1. FILTER LOANS (Portfolio / Stock Metrics) ---
        let loans = allData.loans;

        if (role === 'manager') {
            loans = loans.filter((l) => l.borrowers?.branch_id === managerBranchScope);
        } else if (role === 'officer') {
            loans = loans.filter((l) => l.officer_id === user.id);
        }

        if (selectedBranch !== 'all') loans = loans.filter(l => l.borrowers.branch_id === selectedBranch);
        if (selectedOfficer !== 'all') loans = loans.filter(l => l.officer_id === selectedOfficer);
        if (selectedGroup !== 'all') loans = loans.filter(l => l.borrowers.group_id === selectedGroup);
        else if (selectedCenter !== 'all') {
            const groupIdsInCenter = availableFilters.groups.filter(g => g.center_id === selectedCenter).map(g => g.id);
            loans = loans.filter(l => groupIdsInCenter.includes(l.borrowers.group_id));
        }

        if (selectedProduct !== 'all') loans = loans.filter(l => l.product_id === selectedProduct);
        if (selectedStatus !== 'all') loans = loans.filter(l => l.status === selectedStatus);

        // Date Filter for Disbursements
        const loansDisbursedInPeriod = loans.filter(l => {
            if (!l.disbursement_date) return false;
            const [y, m, d] = l.disbursement_date.split('-').map(Number);
            const disbursementDate = new Date(y, m - 1, d);
            const from = dateRange.from ? startOfDay(dateRange.from) : null;
            const to = dateRange.to ? endOfDay(dateRange.to) : (dateRange.from ? endOfDay(dateRange.from) : null);
            return (!from || disbursementDate >= from) && (!to || disbursementDate <= to);
        });
        
        // --- 2. FILTER REPAYMENTS (Cash Flow Metrics) ---
        // EXACT LOGIC FROM RepaymentManagement.jsx applied here
        
        // 2a. Initial Set based on Role (Mimics how Repayment pages fetch)
        let repayments = allData.repayments;

        if (role === 'officer') {
            repayments = repayments.filter(r => r.officer_id === user.id);
        } else if (role === 'manager') {
             repayments = repayments.filter((r) => {
                 const officer = allData.users.find((u) => u.id === r.officer_id);
                 return officer && officer.branch_id === managerBranchScope;
             });
        }
        // Admins see all by default (already loaded)

        // 2b. Apply UI Filters (Branch, Officer, Group/Center)
        // Note: Repayment Management filters by Branch/Officer directly. 
        // It often filters by Group via the Loan association.

        if (selectedBranch !== 'all') {
             repayments = repayments.filter(r => {
                 const officer = allData.users.find(u => u.id === r.officer_id);
                 return officer && officer.branch_id === selectedBranch;
             });
        }
        
        if (selectedOfficer !== 'all') {
            repayments = repayments.filter(r => r.officer_id === selectedOfficer);
        }

        // Apply Group/Center/Product filters via the associated loan
        const hasLoanScopeFilters = selectedProduct !== 'all' || selectedGroup !== 'all' || selectedCenter !== 'all' || selectedStatus !== 'all';
        
        if (hasLoanScopeFilters) {
             // We need to verify if the repayment's loan matches these criteria
             // We look up the loan in allData.loans (not the filtered `loans` variable above, to avoid circular logic or over-filtering)
             // However, for consistency, if a user filters by "Product A", they expect Repayments for "Product A".
             
             repayments = repayments.filter(r => {
                 // The repayment object from Supabase join includes `loans` which has `borrowers`
                 // But our allData.repayments join structure might be slightly different depending on the fetch.
                 // In fetchData: .select('*, loans(id, borrower_id, loan_id, product_id, status, borrowers(*, groups(*)))')
                 
                 // If the deep join data is missing, we fallback to finding it in allData.loans
                 let loan = r.loans;
                 if (!loan || !loan.borrowers) {
                     loan = allData.loans.find(l => l.id === r.loan_id);
                 }
                 
                 if (!loan) return false; // Should not happen if referential integrity holds

                 if (selectedProduct !== 'all' && loan.product_id !== selectedProduct) return false;
                 if (selectedStatus !== 'all' && loan.status !== selectedStatus) return false;
                 
                 const borrower = loan.borrowers;
                 if (selectedGroup !== 'all') {
                     if (borrower.group_id !== selectedGroup) return false;
                 } else if (selectedCenter !== 'all') {
                     // Check if group is in center
                     const group = allData.groups.find(g => g.id === borrower.group_id);
                     if (!group || group.center_id !== selectedCenter) return false;
                 }
                 
                 return true;
             });
        }

        // 2c. Date filter: actual collection date (actual_payment_date; legacy fallback payment_date).
        // String yyyy-MM-dd compare avoids UTC midnight shifting schedule-style date strings.
        const dateFilteredRepayments = repayments.filter((r) => isRepaymentInReportsRange(r, dateRange));

        return { loans, borrowers: allData.borrowers, repayments: dateFilteredRepayments, loansDisbursedInPeriod };
    }, [allData, user, dateRange, selectedBranch, selectedOfficer, selectedProduct, selectedCenter, selectedGroup, selectedStatus, availableFilters.groups, effectiveRole, managerBranchScope]);

    const reportStats = useMemo(() => {
        const { loans, repayments, loansDisbursedInPeriod } = filteredData;
        const totalPortfolio = loans.reduce((sum, l) => sum + (l.balance || 0), 0);
        const principalDisbursed = loansDisbursedInPeriod.reduce((sum, l) => sum + (l.principal || 0), 0);
        
        // Use EXACT same summation as Repayment Management page
        // const totalPaid = filteredRepayments.reduce((sum, r) => sum + r.amount, 0);
        const repaymentsCollected = repayments.reduce((sum, r) => sum + (r.amount || 0), 0);
        const prepaymentsCollected = repayments.reduce((sum, r) => sum + prepaymentAmount(r), 0);

        const interestCollected = repayments.reduce((sum, r) => sum + (r.interest_paid || 0), 0); 
        const activeLoans = loans.filter(l => ['active', 'delinquent'].includes(l.status)).length;
        const totalBorrowers = new Set(loans.map(l => l.borrower_id)).size;

        const portfolioAtRisk = loans.filter(l => ['delinquent', 'defaulted'].includes(l.status)).reduce((sum, l) => sum + (l.balance || 0), 0);
        const par = totalPortfolio > 0 ? (portfolioAtRisk / totalPortfolio) * 100 : 0;

        return {
            totalPortfolio,
            principalDisbursed,
            repaymentsCollected,
            prepaymentsCollected,
            interestCollected,
            activeLoans,
            totalBorrowers,
            par,
        };
    }, [filteredData]);

     const chartData = useMemo(() => {
        const { loans, loansDisbursedInPeriod, repayments } = filteredData;
        const from = dateRange.from || startOfMonth(new Date());
        const to = dateRange.to || (dateRange.from ? endOfDay(dateRange.from) : endOfMonth(new Date()));

        // Determine if we should show daily or monthly bars based on range duration
        const daysDiff = differenceInDays(to, from);
        const isDailyView = daysDiff <= 60; // Cutoff for switching to monthly view

        let barChartData = [];

        if (isDailyView) {
             barChartData = eachDayOfInterval({ start: from, end: to }).map(day => {
                const dayLabel = formatDate(day, 'MMM dd');
                const start = startOfDay(day);
                const end = endOfDay(day);

                 const disbursed = loansDisbursedInPeriod
                    .filter(l => {
                         if (!l.disbursement_date) return false;
                         const [dy, dm, dd] = l.disbursement_date.split('-').map(Number);
                         const disburseDate = new Date(dy, dm - 1, dd);
                         return disburseDate >= start && disburseDate <= end;
                    })
                    .reduce((sum, l) => sum + l.principal, 0);

                const dayRepayments = repayments.filter((r) => {
                    const d = repaymentReportDateYyyyMmDd(r);
                    if (!d) return false;
                    return d === formatDate(day, 'yyyy-MM-dd');
                });
                const scheduled = dayRepayments.reduce((sum, r) => sum + scheduledCollectionAmount(r), 0);
                const prepay = dayRepayments.reduce((sum, r) => sum + prepaymentAmount(r), 0);

                return { name: dayLabel, Disbursed: disbursed, Scheduled: scheduled, Prepayment: prepay };
            });
        } else {
            barChartData = eachMonthOfInterval({ start: from, end: to }).map(monthStart => {
                const monthEnd = endOfMonth(monthStart);
                const monthLabel = formatDate(monthStart, 'MMM yyyy');

                const disbursed = loansDisbursedInPeriod
                    .filter(l => {
                         if (!l.disbursement_date) return false;
                         const [dy, dm, dd] = l.disbursement_date.split('-').map(Number);
                         const disburseDate = new Date(dy, dm - 1, dd);
                         return disburseDate >= monthStart && disburseDate <= monthEnd;
                    })
                    .reduce((sum, l) => sum + l.principal, 0);

                const monthStartStr = formatDate(monthStart, 'yyyy-MM-dd');
                const monthEndStr = formatDate(monthEnd, 'yyyy-MM-dd');
                const monthRepayments = repayments.filter((r) => {
                    const d = repaymentReportDateYyyyMmDd(r);
                    if (!d) return false;
                    return d >= monthStartStr && d <= monthEndStr;
                });
                const scheduled = monthRepayments.reduce((sum, r) => sum + scheduledCollectionAmount(r), 0);
                const prepay = monthRepayments.reduce((sum, r) => sum + prepaymentAmount(r), 0);

                return { name: monthLabel, Disbursed: disbursed, Scheduled: scheduled, Prepayment: prepay };
            });
        }

        const statusCounts = loans.reduce((acc, loan) => {
            const status = loan.status || 'unknown';
            acc[status] = (acc[status] || 0) + 1;
            return acc;
        }, {});
        
        const statusDistribution = Object.keys(statusCounts).map(status => ({
            name: status.charAt(0).toUpperCase() + status.slice(1),
            value: statusCounts[status]
        }));

        const productPortfolio = allData.loanProducts.map(product => {
            const productLoans = loans.filter(l => l.product_id === product.id);
            const portfolio = productLoans.reduce((sum, l) => sum + (l.balance || 0), 0);
            return { name: product.name, Portfolio: portfolio };
        }).filter(p => p.Portfolio > 0);

        return { barChartData, statusDistribution, productPortfolio };
    }, [filteredData, dateRange, allData.loanProducts]);

    const handleExport = (data, fileName) => {
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
        XLSX.writeFile(workbook, `${fileName}.xlsx`);
    };

    const branchPerformanceData = useMemo(() => {
        if (effectiveRole !== 'admin') return [];
        return allData.branches.map(branch => {
            const branchLoans = allData.loans.filter(l => l.borrowers.branch_id === branch.id);
            const portfolio = branchLoans.reduce((sum, l) => sum + (l.balance || 0), 0);
            const parValue = branchLoans.filter(l => ['delinquent', 'defaulted'].includes(l.status)).reduce((sum, l) => sum + (l.balance || 0), 0);
            return {
                branch: branch.name,
                portfolio,
                par: portfolio > 0 ? (parValue / portfolio) * 100 : 0,
                officers: allData.users.filter(u => u.role === 'officer' && u.branch_id === branch.id).length
            };
        });
    }, [allData, effectiveRole]);

    const officerPerformanceData = useMemo(() => {
        const role = effectiveRole;
        if (role === 'officer') return [];
        let officers = allData.users.filter(u => u.role === 'officer');
        if (role === 'manager') {
            officers = officers.filter((o) => o.branch_id === managerBranchScope);
        }
        return officers.map(officer => {
            const officerLoans = allData.loans.filter(l => l.officer_id === officer.id);
            const portfolio = officerLoans.reduce((sum, l) => sum + (l.balance || 0), 0);
            const parValue = officerLoans.filter(l => ['delinquent', 'defaulted'].includes(l.status)).reduce((sum, l) => sum + (l.balance || 0), 0);
            return {
                officer: officer.full_name,
                portfolio,
                par: portfolio > 0 ? (parValue / portfolio) * 100 : 0,
                loans: officerLoans.length
            };
        });
    }, [allData, effectiveRole, managerBranchScope]);

    const statsCardsData = [
        { title: 'Total Portfolio', value: `${currency} ${reportStats.totalPortfolio.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: Briefcase, color: 'text-blue-600' },
        { title: 'Principal Disbursed', value: `${currency} ${reportStats.principalDisbursed.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: TrendingUp, color: 'text-green-600' },
        { title: 'Repayments Collected', value: `${currency} ${reportStats.repaymentsCollected.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, icon: DollarSign, color: 'text-yellow-600' },
        {
            title: 'Prepayment (in range)',
            value: `${currency} ${reportStats.prepaymentsCollected.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            icon: PiggyBank,
            color: 'text-emerald-600',
        },
        { title: 'Active Loans', value: reportStats.activeLoans, icon: Briefcase, color: 'text-indigo-600' },
        { title: 'Borrowers', value: reportStats.totalBorrowers, icon: Users, color: 'text-pink-600' },
        { title: 'Portfolio at Risk (PAR)', value: `${reportStats.par.toFixed(2)}%`, icon: AlertTriangle, color: 'text-red-600' },
    ];

    const PIE_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#8884d8'];

    return (
        <DashboardLayout title="Reports">
            <div className="space-y-8">
                <p className="text-sm text-neutral-500">
                    In-depth analysis of your operations. Collections and repayment charts use{' '}
                    <strong>actual payment date</strong> (when cash was collected), not installment due dates from the loan
                    schedule.
                </p>

                {loading ? <div className="text-center py-10">Loading report data...</div> :
                <>
                    <Card><CardContent className="p-4 space-y-4">
                        <div className="flex flex-wrap items-center gap-4">
                            <Tabs value={activeDateFilter} onValueChange={handleDateFilterChange} className="w-auto">
                                <TabsList>
                                    <TabsTrigger value="daily">Today</TabsTrigger>
                                    <TabsTrigger value="weekly">This Week</TabsTrigger>
                                    <TabsTrigger value="monthly">This Month</TabsTrigger>
                                    <TabsTrigger value="yearly">This Year</TabsTrigger>
                                </TabsList>
                            </Tabs>
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button variant="outline" className={`w-[280px] justify-start text-left font-normal ${activeDateFilter === 'custom' ? 'border-primary' : ''}`}>
                                        <CalendarIcon className="mr-2 h-4 w-4" />
                                        {dateRange?.from ? (dateRange.to ? `${formatDate(dateRange.from, 'LLL dd, y')} - ${formatDate(dateRange.to, 'LLL dd, y')}` : formatDate(dateRange.from, 'LLL dd, y')) : (<span>Pick a date range</span>)}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent className="w-auto p-0" align="start">
                                    <Calendar mode="range" selected={dateRange} onSelect={handleCustomDateChange} numberOfMonths={2} />
                                </PopoverContent>
                            </Popover>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
                            {effectiveRole === 'admin' && (
                                <SearchableSelect
                                    value={selectedBranch}
                                    onValueChange={setSelectedBranch}
                                    options={reportBranchOptions}
                                    allLabel="All branches"
                                    allValue="all"
                                    placeholder="Select branch"
                                    searchPlaceholder="Search branches…"
                                    emptyText="No branch found."
                                    triggerClassName="w-full"
                                />
                            )}
                            {(effectiveRole === 'admin' || effectiveRole === 'manager') && (
                                <SearchableSelect
                                    value={selectedOfficer}
                                    onValueChange={setSelectedOfficer}
                                    options={reportOfficerOptions}
                                    allLabel="All officers"
                                    allValue="all"
                                    placeholder="Select officer"
                                    searchPlaceholder="Search officers…"
                                    emptyText="No officer found."
                                    triggerClassName="w-full"
                                />
                            )}
                            <SearchableSelect
                                value={selectedProduct}
                                onValueChange={setSelectedProduct}
                                options={reportProductOptions}
                                allLabel="All products"
                                allValue="all"
                                placeholder="Select product"
                                searchPlaceholder="Search products…"
                                emptyText="No product found."
                                triggerClassName="w-full"
                            />
                            <SearchableSelect
                                value={selectedCenter}
                                onValueChange={setSelectedCenter}
                                options={reportCenterOptions}
                                allLabel="All centers"
                                allValue="all"
                                placeholder="Select center"
                                searchPlaceholder="Search centers…"
                                emptyText="No center found."
                                triggerClassName="w-full"
                            />
                            <SearchableSelect
                                value={selectedGroup}
                                onValueChange={setSelectedGroup}
                                options={reportGroupOptions}
                                allLabel="All groups"
                                allValue="all"
                                placeholder="Select group"
                                searchPlaceholder="Search groups…"
                                emptyText="No group found."
                                triggerClassName="w-full"
                            />
                            <SearchableSelect
                                value={selectedStatus}
                                onValueChange={setSelectedStatus}
                                options={REPORT_STATUS_OPTIONS}
                                allLabel="All statuses"
                                allValue="all"
                                placeholder="Loan status"
                                searchPlaceholder="Search status…"
                                emptyText="No status found."
                                triggerClassName="w-full"
                            />
                        </div>
                    </CardContent></Card>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-7 gap-6">
                        {statsCardsData.map(stat => <StatCard key={stat.title} {...stat} />)}
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <Card className="lg:col-span-2">
                            <CardHeader>
                                <CardTitle>Disbursed vs. scheduled collection vs. prepayment</CardTitle>
                                <p className="text-xs text-muted-foreground mt-1">
                                    Scheduled and prepayment split uses stored repayment rows (same as field wallet when
                                    prepayment columns are set).
                                </p>
                            </CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <BarChart data={chartData.barChartData}>
                                        <CartesianGrid strokeDasharray="3 3" />
                                        <XAxis dataKey="name" />
                                        <YAxis tickFormatter={(value) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(value)} />
                                        <Tooltip formatter={(value) => `${currency} ${value.toLocaleString()}`} />
                                        <Legend />
                                        <Bar dataKey="Disbursed" fill="#8884d8" />
                                        <Bar dataKey="Scheduled" fill="#82ca9d" />
                                        <Bar dataKey="Prepayment" fill="#34d399" />
                                    </BarChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                        <Card>
                            <CardHeader><CardTitle>Loan Status Distribution</CardTitle></CardHeader>
                            <CardContent>
                                <ResponsiveContainer width="100%" height={300}>
                                    <PieChart>
                                        <Pie data={chartData.statusDistribution} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label>
                                            {chartData.statusDistribution.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </CardContent>
                        </Card>
                    </div>

                    <Card>
                        <CardHeader><CardTitle>Portfolio by Product</CardTitle></CardHeader>
                        <CardContent>
                            <ResponsiveContainer width="100%" height={300}>
                                <BarChart data={chartData.productPortfolio} layout="vertical">
                                    <CartesianGrid strokeDasharray="3 3" />
                                    <XAxis type="number" tickFormatter={(value) => new Intl.NumberFormat('en-US', { notation: 'compact', compactDisplay: 'short' }).format(value)} />
                                    <YAxis type="category" dataKey="name" width={120} />
                                    <Tooltip formatter={(value) => `${currency} ${value.toLocaleString()}`} />
                                    <Legend />
                                    <Bar dataKey="Portfolio" fill="#22c55e" />
                                </BarChart>
                            </ResponsiveContainer>
                        </CardContent>
                    </Card>

                    {effectiveRole === 'admin' && (
                        <Card>
                            <CardHeader className="flex flex-row justify-between items-center"><CardTitle>Branch Performance</CardTitle><Button variant="outline" size="sm" onClick={() => handleExport(branchPerformanceData, 'Branch_Performance')}><Printer className="mr-2 h-4 w-4" /> Export</Button></CardHeader>
                            <CardContent>
                                <Table><TableHeader><TableRow><TableHead>Branch</TableHead><TableHead>Portfolio</TableHead><TableHead>PAR</TableHead><TableHead>Officers</TableHead></TableRow></TableHeader><TableBody>{branchPerformanceData.map(b => (<TableRow key={b.branch}><TableCell>{b.branch}</TableCell><TableCell>{currency} {b.portfolio.toLocaleString()}</TableCell><TableCell>{b.par.toFixed(2)}%</TableCell><TableCell>{b.officers}</TableCell></TableRow>))}</TableBody></Table>
                            </CardContent>
                        </Card>
                    )}

                    {(effectiveRole === 'admin' || effectiveRole === 'manager') && (
                        <Card>
                            <CardHeader className="flex flex-row justify-between items-center"><CardTitle>Loan Officer Performance</CardTitle><Button variant="outline" size="sm" onClick={() => handleExport(officerPerformanceData, 'Officer_Performance')}><Printer className="mr-2 h-4 w-4" /> Export</Button></CardHeader>
                            <CardContent>
                                <Table><TableHeader><TableRow><TableHead>Officer</TableHead><TableHead>Portfolio</TableHead><TableHead>PAR</TableHead><TableHead>Active Loans</TableHead></TableRow></TableHeader><TableBody>{officerPerformanceData.map(o => (<TableRow key={o.officer}><TableCell>{o.officer}</TableCell><TableCell>{currency} {o.portfolio.toLocaleString()}</TableCell><TableCell>{o.par.toFixed(2)}%</TableCell><TableCell>{o.loans}</TableCell></TableRow>))}</TableBody></Table>
                            </CardContent>
                        </Card>
                    )}
                </>
                }
            </div>
        </DashboardLayout>
    );
};

export default Reports;