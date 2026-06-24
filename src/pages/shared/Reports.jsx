import React, { useState, useEffect, useMemo, useCallback } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useUserProfileScope, fetchOfficerIdsForBranch } from '@/hooks/useUserProfileScope';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { Calendar as CalendarIcon, Printer, Users, Briefcase, DollarSign, TrendingUp, AlertTriangle, PiggyBank } from 'lucide-react';
import { format as formatDate, startOfMonth, endOfMonth, startOfDay, endOfDay, startOfWeek, endOfWeek, startOfYear, endOfYear, differenceInDays } from 'date-fns';
import * as XLSX from 'xlsx';
import { BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LOAN_STATUS_FILTER_OPTIONS } from '@/lib/domainStatuses';
import { fetchReportsMetrics } from '@/lib/reportsMetricsRpc';

const StatCard = ({ title, value, subtitle, icon: Icon, color }) => (
  <Card>
    <CardHeader className="flex flex-row items-center justify-between pb-2">
      <CardTitle className="text-sm font-medium text-gray-600">{title}</CardTitle>
      <Icon className={`h-5 w-5 ${color}`} />
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      {subtitle ? <p className="text-xs text-muted-foreground mt-1 leading-snug">{subtitle}</p> : null}
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

    const [filterMeta, setFilterMeta] = useState({ users: [], branches: [], centers: [], groups: [], loanProducts: [] });
    const [metrics, setMetrics] = useState(null);
    const [metricsLoading, setMetricsLoading] = useState(false);

    const [dateRange, setDateRange] = useState({ from: startOfMonth(new Date()), to: endOfMonth(new Date()) });
    const [activeDateFilter, setActiveDateFilter] = useState('monthly');

    const [selectedBranch, setSelectedBranch] = useState('all');
    const [selectedOfficer, setSelectedOfficer] = useState('all');
    const [selectedProduct, setSelectedProduct] = useState('all');
    const [selectedCenter, setSelectedCenter] = useState('all');
    const [selectedGroup, setSelectedGroup] = useState('all');
    const [selectedStatus, setSelectedStatus] = useState('all');

    const fetchFilterMeta = useCallback(async () => {
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
                const [configRes, usersRes, branchesRes, productsRes, centersRes, groupsRes] = await Promise.all([
                    cfgP,
                    supabase.from('users').select('*'),
                    supabase.from('branches').select('*'),
                    prodP,
                    supabase.from('centers').select('*'),
                    supabase.from('groups').select('*'),
                ]);
                setCurrency(checkError(configRes, 'config')?.value || 'TZS');
                setFilterMeta({
                    users: checkError(usersRes, 'users') || [],
                    branches: checkError(branchesRes, 'branches') || [],
                    loanProducts: checkError(productsRes, 'products') || [],
                    centers: checkError(centersRes, 'centers') || [],
                    groups: checkError(groupsRes, 'groups') || [],
                });
            } else if (role === 'manager') {
                const branchId = managerBranchScope;
                if (!branchId) {
                    throw new Error('Branch not assigned to your profile.');
                }
                const officerIds = await fetchOfficerIdsForBranch(branchId);
                const [configRes, usersRes, branchesRes, productsRes, centersRes] = await Promise.all([
                    cfgP,
                    supabase.from('users').select('*').eq('branch_id', branchId),
                    supabase.from('branches').select('*').eq('id', branchId),
                    prodP,
                    supabase.from('centers').select('*').eq('branch_id', branchId),
                ]);
                const centerRows = checkError(centersRes, 'centers') || [];
                const centerIds = centerRows.map((c) => c.id);
                let groups = [];
                if (centerIds.length > 0) {
                    const groupsRes = await supabase.from('groups').select('*').in('center_id', centerIds);
                    groups = checkError(groupsRes, 'groups') || [];
                }
                setCurrency(checkError(configRes, 'config')?.value || 'TZS');
                setFilterMeta({
                    users: checkError(usersRes, 'users') || [],
                    branches: checkError(branchesRes, 'branches') || [],
                    loanProducts: checkError(productsRes, 'products') || [],
                    centers: centerRows,
                    groups,
                });
                setSelectedBranch(branchId);
                if (officerIds.length === 0) {
                    setSelectedOfficer('all');
                }
            } else if (role === 'officer') {
                const branchId = managerBranchScope;
                const [configRes, usersRes, branchesRes, productsRes, centersRes, groupsRes] = await Promise.all([
                    cfgP,
                    supabase.from('users').select('*').eq('id', user.id),
                    branchId
                        ? supabase.from('branches').select('*').eq('id', branchId)
                        : Promise.resolve({ data: [], error: null }),
                    prodP,
                    supabase.from('centers').select('*').eq('loan_officer_id', user.id),
                    supabase.from('groups').select('*').eq('loan_officer_id', user.id),
                ]);
                setCurrency(checkError(configRes, 'config')?.value || 'TZS');
                setFilterMeta({
                    users: checkError(usersRes, 'users') || [],
                    branches: checkError(branchesRes, 'branches') || [],
                    loanProducts: checkError(productsRes, 'products') || [],
                    centers: checkError(centersRes, 'centers') || [],
                    groups: checkError(groupsRes, 'groups') || [],
                });
            } else {
                setFilterMeta({ users: [], branches: [], centers: [], groups: [], loanProducts: [] });
            }
        } catch (error) {
            toast({ title: 'Error loading filters', description: error.message, variant: 'destructive' });
        } finally {
            setLoading(false);
        }
    }, [user, toast, profileLoading, effectiveRole, managerBranchScope]);

    const metricsParams = useMemo(() => {
        if (!dateRange?.from) return null;
        const to = dateRange.to || dateRange.from;
        const daysDiff = differenceInDays(to, dateRange.from);
        return {
            startDate: formatDate(dateRange.from, 'yyyy-MM-dd'),
            endDate: formatDate(to, 'yyyy-MM-dd'),
            branchId: selectedBranch,
            officerId: selectedOfficer,
            productId: selectedProduct,
            centerId: selectedCenter,
            groupId: selectedGroup,
            status: selectedStatus,
            granularity: daysDiff <= 60 ? 'day' : 'month',
        };
    }, [dateRange, selectedBranch, selectedOfficer, selectedProduct, selectedCenter, selectedGroup, selectedStatus]);

    const fetchMetrics = useCallback(async () => {
        if (!user || profileLoading || !metricsParams) return;
        setMetricsLoading(true);
        try {
            const data = await fetchReportsMetrics(supabase, metricsParams);
            setMetrics(data);
        } catch (error) {
            toast({ title: 'Error loading report metrics', description: error.message, variant: 'destructive' });
            setMetrics(null);
        } finally {
            setMetricsLoading(false);
        }
    }, [user, profileLoading, metricsParams, toast]);

    useEffect(() => {
        fetchFilterMeta();
    }, [fetchFilterMeta]);

    useEffect(() => {
        if (!loading) {
            fetchMetrics();
        }
    }, [fetchMetrics, loading]);

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
        let officers = filterMeta.users.filter(u => u.role === 'officer');
        let centers = filterMeta.centers;
        let groups = filterMeta.groups;

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
        groups = filterMeta.groups.filter(g => centerIdsInScope.includes(g.center_id));
        
        if (selectedOfficer !== 'all') {
            centers = centers.filter(c => c.loan_officer_id === selectedOfficer);
            groups = filterMeta.groups.filter(g => {
                const center = filterMeta.centers.find(c => c.id === g.center_id);
                return center && center.loan_officer_id === selectedOfficer;
            });
        }
        if (selectedCenter !== 'all') {
            groups = groups.filter(g => g.center_id === selectedCenter);
        }

        return { officers, centers, groups };
    }, [filterMeta, user, selectedBranch, selectedOfficer, selectedCenter, effectiveRole, managerBranchScope]);

    const reportBranchOptions = useMemo(
        () => filterMeta.branches.map((b) => ({ value: b.id, label: b.name })),
        [filterMeta.branches]
    );
    const reportOfficerOptions = useMemo(
        () => availableFilters.officers.map((o) => ({ value: o.id, label: o.full_name })),
        [availableFilters.officers]
    );
    const reportProductOptions = useMemo(
        () => filterMeta.loanProducts.map((p) => ({ value: p.id, label: p.name })),
        [filterMeta.loanProducts]
    );
    const reportCenterOptions = useMemo(
        () => availableFilters.centers.map((c) => ({ value: c.id, label: c.name })),
        [availableFilters.centers]
    );
    const reportGroupOptions = useMemo(
        () => availableFilters.groups.map((g) => ({ value: g.id, label: g.name })),
        [availableFilters.groups]
    );

    const reportStats = metrics?.summary ?? {
        totalPortfolio: 0,
        principalDisbursed: 0,
        repaymentsCollected: 0,
        prepaymentsCollected: 0,
        activeLoans: 0,
        totalBorrowers: 0,
        par: 0,
    };

    const chartData = {
        barChartData: metrics?.barChartData ?? [],
        statusDistribution: metrics?.statusDistribution ?? [],
        productPortfolio: metrics?.productPortfolio ?? [],
    };

    const branchPerformanceData = metrics?.branchPerformanceData ?? [];
    const officerPerformanceData = metrics?.officerPerformanceData ?? [];

    const handleExport = (data, fileName) => {
        const worksheet = XLSX.utils.json_to_sheet(data);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Report');
        XLSX.writeFile(workbook, `${fileName}.xlsx`);
    };

    const statsCardsData = [
        {
            title: 'Total Portfolio',
            value: `${currency} ${reportStats.totalPortfolio.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            subtitle: 'Current snapshot (filters apply; not limited by date range)',
            icon: Briefcase,
            color: 'text-blue-600',
        },
        {
            title: 'Principal Disbursed',
            value: `${currency} ${reportStats.principalDisbursed.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            subtitle: 'In selected date range (disbursement date)',
            icon: TrendingUp,
            color: 'text-green-600',
        },
        {
            title: 'Repayments Collected',
            value: `${currency} ${reportStats.repaymentsCollected.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            subtitle: 'In selected date range (actual payment date)',
            icon: DollarSign,
            color: 'text-yellow-600',
        },
        {
            title: 'Prepayment (in range)',
            value: `${currency} ${reportStats.prepaymentsCollected.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
            subtitle: 'In selected date range (actual payment date)',
            icon: PiggyBank,
            color: 'text-emerald-600',
        },
        {
            title: 'Active Loans',
            value: reportStats.activeLoans,
            subtitle: 'Active, delinquent, or defaulted (current snapshot)',
            icon: Briefcase,
            color: 'text-indigo-600',
        },
        {
            title: 'Borrowers',
            value: reportStats.totalBorrowers,
            subtitle: 'With loans in current filter scope',
            icon: Users,
            color: 'text-pink-600',
        },
        {
            title: 'Portfolio at Risk (PAR)',
            value: `${reportStats.par.toFixed(2)}%`,
            subtitle: 'Current snapshot (delinquent + defaulted balance)',
            icon: AlertTriangle,
            color: 'text-red-600',
        },
    ];

    const PIE_COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#AF19FF', '#8884d8'];

    return (
        <DashboardLayout title="Reports">
            <div className="space-y-8">
                <p className="text-sm text-neutral-500">
                    In-depth analysis of your operations. Metrics are computed on the server (same date rules as the dashboard).
                    Collections use <strong>actual payment date</strong> (when cash was collected), not installment due dates.
                    Portfolio, PAR, active loans, and status charts reflect the <strong>current loan book</strong> after filters;
                    disbursements and collections use the <strong>selected date range</strong> above.
                </p>

                {loading ? <div className="text-center py-10">Loading report filters…</div> :
                <>
                    {metricsLoading && (
                        <p className="text-sm text-muted-foreground text-center">Updating metrics…</p>
                    )}
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
                                options={LOAN_STATUS_FILTER_OPTIONS}
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
                                <p className="text-xs text-muted-foreground mb-3">Current snapshot after filters (not limited by date range).</p>
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
                            <p className="text-xs text-muted-foreground mb-3">Current portfolio balance by product (filters apply; not limited by date range).</p>
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
                            <CardHeader className="flex flex-row justify-between items-center">
                                <div>
                                    <CardTitle>Branch Performance</CardTitle>
                                    <p className="text-xs text-muted-foreground mt-1">Portfolio and PAR use filtered loan book (current snapshot).</p>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => handleExport(branchPerformanceData, 'Branch_Performance')}><Printer className="mr-2 h-4 w-4" /> Export</Button>
                            </CardHeader>
                            <CardContent>
                                <Table><TableHeader><TableRow><TableHead>Branch</TableHead><TableHead>Portfolio</TableHead><TableHead>PAR</TableHead><TableHead>Officers</TableHead></TableRow></TableHeader><TableBody>{branchPerformanceData.map(b => (<TableRow key={b.branch}><TableCell>{b.branch}</TableCell><TableCell>{currency} {b.portfolio.toLocaleString()}</TableCell><TableCell>{b.par.toFixed(2)}%</TableCell><TableCell>{b.officers}</TableCell></TableRow>))}</TableBody></Table>
                            </CardContent>
                        </Card>
                    )}

                    {(effectiveRole === 'admin' || effectiveRole === 'manager') && (
                        <Card>
                            <CardHeader className="flex flex-row justify-between items-center">
                                <div>
                                    <CardTitle>Loan Officer Performance</CardTitle>
                                    <p className="text-xs text-muted-foreground mt-1">Portfolio and PAR use filtered loan book (current snapshot).</p>
                                </div>
                                <Button variant="outline" size="sm" onClick={() => handleExport(officerPerformanceData, 'Officer_Performance')}><Printer className="mr-2 h-4 w-4" /> Export</Button>
                            </CardHeader>
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