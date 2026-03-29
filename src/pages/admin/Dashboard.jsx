import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import {
	Users,
	FileQuestion,
	Loader2,
	Building,
	PieChart,
	Banknote,
	Percent,
	Wallet,
	AlertTriangle,
	TrendingUp,
	ScrollText,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { DRILLDOWN_METRICS } from '@/lib/dashboardMetrics';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
	ClickMetricCard,
	DashboardStatCard,
	MetricSection,
	defaultDashboardRange,
	quickActionCardClass,
	quickActionIconWrapClass,
} from '@/components/dashboard/DashboardMetricShell';

const AdminDashboard = () => {
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [currency, setCurrency] = useState('TZS');
	const [dateRange, setDateRange] = useState(defaultDashboardRange);
	const [stats, setStats] = useState(null);
	const [branches, setBranches] = useState([]);
	const [officers, setOfficers] = useState([]);
	const [branchId, setBranchId] = useState('');
	const [officerId, setOfficerId] = useState('');

	useEffect(() => {
		let cancelled = false;
		(async () => {
			const [{ data: br }, { data: of }] = await Promise.all([
				supabase.from('branches').select('id, name').order('name'),
				supabase.from('users').select('id, full_name, branch_id').eq('role', 'officer').order('full_name'),
			]);
			if (!cancelled) {
				setBranches(br || []);
				setOfficers(of || []);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	// Sync URL: start, end, branch, officer
	useEffect(() => {
		const s = searchParams.get('start');
		const e = searchParams.get('end');
		if (s && e) {
			const from = new Date(s);
			const to = new Date(e);
			if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime())) {
				setDateRange({ from, to });
			}
		}
		setBranchId(searchParams.get('branch') || '');
		setOfficerId(searchParams.get('officer') || '');
	}, [searchParams]);

	const persistQuery = useCallback(
		(updates) => {
			const next = new URLSearchParams(searchParams);
			if (updates.range?.from && updates.range?.to) {
				next.set('start', format(updates.range.from, 'yyyy-MM-dd'));
				next.set('end', format(updates.range.to, 'yyyy-MM-dd'));
			}
			if ('branchId' in updates) {
				if (updates.branchId) next.set('branch', updates.branchId);
				else next.delete('branch');
			}
			if ('officerId' in updates) {
				if (updates.officerId) next.set('officer', updates.officerId);
				else next.delete('officer');
			}
			setSearchParams(next, { replace: true });
		},
		[searchParams, setSearchParams]
	);

	const officersForBranch = useMemo(() => {
		if (!branchId) return officers;
		return officers.filter((o) => o.branch_id === branchId);
	}, [officers, branchId]);

	useEffect(() => {
		if (!officerId || !branchId) return;
		const o = officers.find((x) => x.id === officerId);
		if (o && o.branch_id !== branchId) setOfficerId('');
	}, [branchId, officerId, officers]);

	const fetchDashboardData = useCallback(async () => {
		if (!dateRange?.from || !dateRange?.to) return;
		setLoading(true);
		try {
			const { data: configData } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
			if (configData?.value) setCurrency(configData.value);

			const { data, error } = await supabase.rpc('get_admin_dashboard_metrics', {
				p_start_date: format(dateRange.from, 'yyyy-MM-dd'),
				p_end_date: format(dateRange.to, 'yyyy-MM-dd'),
				p_branch_id: branchId || null,
				p_officer_id: officerId || null,
			});

			if (error) throw error;
			if (data?.length) setStats(data[0]);
			else setStats(null);
		} catch (err) {
			console.error(err);
			toast({
				title: 'Error',
				description:
					err.message?.includes('get_admin_dashboard_metrics') || err.code === '42883'
						? 'Run the latest database migration (get_admin_dashboard_metrics).'
						: 'Could not load dashboard metrics.',
				variant: 'destructive',
			});
			setStats(null);
		} finally {
			setLoading(false);
		}
	}, [dateRange, branchId, officerId, toast]);

	useEffect(() => {
		fetchDashboardData();
	}, [fetchDashboardData]);

	const formatCurrency = (value) => {
		const number = Number(value || 0);
		return `${currency} ${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	};

	const openMetric = (metricKey) => {
		const start = format(dateRange.from, 'yyyy-MM-dd');
		const end = format(dateRange.to, 'yyyy-MM-dd');
		const q = new URLSearchParams({ start, end });
		if (branchId) q.set('branch', branchId);
		if (officerId) q.set('officer', officerId);
		navigate(`/admin/dashboard/metrics/${metricKey}?${q.toString()}`);
	};

	const quickActions = [
		{ title: 'Manage Branches', icon: Building, description: 'Add or edit company branches', path: '/admin/branches' },
		{ title: 'Manage Users', icon: Users, description: 'Add or manage system users', path: '/admin/users' },
		{ title: 'View Loan Requests', icon: FileQuestion, description: 'Approve loan edit/delete requests', path: '/admin/loan-requests' },
		{ title: 'Activity log', icon: ScrollText, description: 'User actions, IP and device (admin only)', path: '/admin/audit-logs' },
	];

	const s = stats || {};

	return (
		<DashboardLayout title="Admin Dashboard">
			<div className="space-y-8">
				<div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm lg:flex-row lg:flex-wrap lg:items-end lg:justify-between">
					<div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
						<Popover>
							<PopoverTrigger asChild>
								<Button variant="outline" className={cn('w-full min-w-[240px] justify-start text-left font-normal sm:w-auto')}>
									<CalendarIcon className="mr-2 h-4 w-4 shrink-0" />
									{dateRange?.from && dateRange?.to ? (
										<>
											{format(dateRange.from, 'LLL dd, y')} – {format(dateRange.to, 'LLL dd, y')}
										</>
									) : (
										<span>Pick range</span>
									)}
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-auto p-0" align="start">
								<Calendar
									initialFocus
									mode="range"
									defaultMonth={dateRange?.from}
									selected={dateRange}
									onSelect={(r) => {
										setDateRange(r);
										if (r?.from && r?.to) persistQuery({ range: r });
									}}
									numberOfMonths={2}
								/>
							</PopoverContent>
						</Popover>

						<div className="w-full min-w-[200px] sm:w-[220px]">
							<p className="mb-1.5 text-xs font-medium text-neutral-500">Branch</p>
							<Select
								value={branchId || 'all'}
								onValueChange={(v) => {
									const next = v === 'all' ? '' : v;
									setBranchId(next);
									setOfficerId('');
									persistQuery({ branchId: next, officerId: '' });
								}}
							>
								<SelectTrigger>
									<SelectValue placeholder="All branches" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All branches</SelectItem>
									{branches.map((br) => (
										<SelectItem key={br.id} value={br.id}>
											{br.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="w-full min-w-[200px] sm:w-[220px]">
							<p className="mb-1.5 text-xs font-medium text-neutral-500">Loan officer</p>
							<Select
								value={officerId || 'all'}
								onValueChange={(v) => {
									const next = v === 'all' ? '' : v;
									setOfficerId(next);
									persistQuery({ officerId: next });
								}}
							>
								<SelectTrigger>
									<SelectValue placeholder="All officers" />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">All officers</SelectItem>
									{officersForBranch.map((o) => (
										<SelectItem key={o.id} value={o.id}>
											{o.full_name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						{(branchId || officerId) && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="text-neutral-600"
								onClick={() => {
									setBranchId('');
									setOfficerId('');
									persistQuery({ branchId: '', officerId: '' });
								}}
							>
								Clear filters
							</Button>
						)}
					</div>
				</div>

				{loading ? (
					<div className="flex h-64 items-center justify-center">
						<Loader2 className="h-8 w-8 animate-spin text-brand-gold" />
					</div>
				) : (
					<>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							<DashboardStatCard title="Branches" index={0}>
								{s.total_branches ?? 0}
							</DashboardStatCard>
							<DashboardStatCard title="Users" index={1}>
								{s.total_users ?? 0}
							</DashboardStatCard>
							<DashboardStatCard title="Borrowers" index={2}>
								{s.total_borrowers ?? 0}
							</DashboardStatCard>
							<DashboardStatCard title="Active loans (count)" index={3}>
								{s.active_loans_count ?? 0}
							</DashboardStatCard>
						</div>

						<MetricSection icon={PieChart} title="Portfolio (balance)">
							<ClickMetricCard
								title="Active"
								value={formatCurrency(s.portfolio_active)}
								metricKey={DRILLDOWN_METRICS.portfolio_active}
								onOpen={openMetric}
							/>
							<ClickMetricCard
								title="Defaulted"
								value={formatCurrency(s.portfolio_defaulted)}
								metricKey={DRILLDOWN_METRICS.portfolio_defaulted}
								onOpen={openMetric}
							/>
							<ClickMetricCard
								title="General"
								value={formatCurrency(s.portfolio_general)}
								metricKey={DRILLDOWN_METRICS.portfolio_general}
								onOpen={openMetric}
								accent
							/>
						</MetricSection>

						<MetricSection icon={Banknote} title="Disbursed loans (principal)">
							<ClickMetricCard
								title="Monthly"
								value={formatCurrency(s.disbursed_monthly)}
								metricKey={DRILLDOWN_METRICS.disbursed_monthly}
								onOpen={openMetric}
							/>
							<ClickMetricCard
								title="Yearly"
								value={formatCurrency(s.disbursed_yearly)}
								metricKey={DRILLDOWN_METRICS.disbursed_yearly}
								onOpen={openMetric}
							/>
							<ClickMetricCard
								title="Overall"
								value={formatCurrency(s.disbursed_overall)}
								metricKey={DRILLDOWN_METRICS.disbursed_overall}
								onOpen={openMetric}
								accent
							/>
						</MetricSection>

						<MetricSection icon={Percent} title="Interest (from loan terms)">
							<ClickMetricCard
								title="Monthly"
								value={formatCurrency(s.interest_from_disbursed_month)}
								metricKey={DRILLDOWN_METRICS.interest_disbursed_month}
								onOpen={openMetric}
							/>
							<ClickMetricCard
								title="Date range"
								value={formatCurrency(s.interest_from_disbursed_range)}
								metricKey={DRILLDOWN_METRICS.interest_disbursed_range}
								onOpen={openMetric}
								accent
							/>
						</MetricSection>

						<MetricSection icon={TrendingUp} title="Collected loans">
							<ClickMetricCard
								title="Principal"
								value={formatCurrency(s.collected_month_principal)}
								metricKey={DRILLDOWN_METRICS.collected_month_principal}
								onOpen={openMetric}
							/>
							<ClickMetricCard
								title="Interest"
								value={formatCurrency(s.collected_month_interest)}
								metricKey={DRILLDOWN_METRICS.collected_month_interest}
								onOpen={openMetric}
							/>
							<ClickMetricCard
								title="Total (P+I)"
								value={formatCurrency(s.collected_month_total)}
								metricKey={DRILLDOWN_METRICS.collected_month_total}
								onOpen={openMetric}
								accent
							/>
						</MetricSection>

						<MetricSection icon={Wallet} title="Outstanding loans">
							<ClickMetricCard
								title="Principal"
								value={formatCurrency(s.outstanding_principal)}
								metricKey={DRILLDOWN_METRICS.outstanding_principal}
								onOpen={openMetric}
							/>
							<ClickMetricCard
								title="Interest"
								value={formatCurrency(s.outstanding_interest)}
								metricKey={DRILLDOWN_METRICS.outstanding_interest}
								onOpen={openMetric}
							/>
							<ClickMetricCard
								title="Total (P+I)"
								value={formatCurrency(s.outstanding_total)}
								metricKey={DRILLDOWN_METRICS.outstanding_total}
								onOpen={openMetric}
								accent
							/>
						</MetricSection>

						<MetricSection icon={AlertTriangle} title="Default (from defaulted loans)">
							<ClickMetricCard
								title="Disbursed principal"
								value={formatCurrency(s.default_disbursed_principal)}
								metricKey={DRILLDOWN_METRICS.default_disbursed}
								onOpen={openMetric}
							/>
							<ClickMetricCard
								title="Interest amount"
								value={formatCurrency(s.default_interest_amount)}
								metricKey={DRILLDOWN_METRICS.default_interest}
								onOpen={openMetric}
							/>
							<ClickMetricCard
								title="Total amount"
								value={formatCurrency(s.default_total_amount)}
								metricKey={DRILLDOWN_METRICS.default_total}
								onOpen={openMetric}
								accent
							/>
						</MetricSection>

						<div>
							<h3 className="mb-4 font-display text-lg font-bold text-neutral-900">Quick actions</h3>
							<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
								{quickActions.map((action, index) => {
									const Icon = action.icon;
									return (
										<motion.div
											key={action.title}
											initial={{ opacity: 0, scale: 0.98 }}
											animate={{ opacity: 1, scale: 1 }}
											transition={{ delay: index * 0.05 }}
											onClick={() => navigate(action.path)}
											className="cursor-pointer"
										>
											<Card className={cn('h-full transition', quickActionCardClass(index))}>
												<CardContent className="flex flex-col items-center p-6 text-center">
													<div className={quickActionIconWrapClass}>
														<Icon className="h-7 w-7" />
													</div>
													<CardTitle className="text-base">{action.title}</CardTitle>
													<CardDescription className="mt-1">{action.description}</CardDescription>
													<Button variant="outline" size="sm" className="mt-4">
														Open
													</Button>
												</CardContent>
											</Card>
										</motion.div>
									);
								})}
							</div>
						</div>
					</>
				)}
			</div>
		</DashboardLayout>
	);
};

export default AdminDashboard;
