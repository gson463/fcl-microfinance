import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Card, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import {
	Users,
	Loader2,
	PieChart,
	Banknote,
	Percent,
	Wallet,
	AlertTriangle,
	TrendingUp,
	Briefcase,
	Building2,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { DRILLDOWN_METRICS } from '@/lib/dashboardMetrics';
import {
	ClickMetricCard,
	DashboardStatCard,
	MetricSection,
	defaultDashboardRange,
	quickActionCardClass,
	quickActionIconWrapClass,
} from '@/components/dashboard/DashboardMetricShell';

const LoanOfficerDashboard = () => {
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const { user } = useAuth();
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [profileLoading, setProfileLoading] = useState(true);
	const [currency, setCurrency] = useState('TZS');
	const [dateRange, setDateRange] = useState(defaultDashboardRange);
	const [stats, setStats] = useState(null);
	const [officerBranchId, setOfficerBranchId] = useState(null);
	const [branchName, setBranchName] = useState('');

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setProfileLoading(true);
			if (!user?.id) {
				setOfficerBranchId(null);
				setBranchName('');
				setProfileLoading(false);
				return;
			}
			const { data: row, error } = await supabase
				.from('users')
				.select('branch_id, role')
				.eq('id', user.id)
				.maybeSingle();
			if (cancelled) return;
			if (error || !row || row.role !== 'officer') {
				setOfficerBranchId(null);
				setBranchName('');
				setProfileLoading(false);
				return;
			}
			setOfficerBranchId(row.branch_id ?? null);
			if (row.branch_id) {
				const { data: br } = await supabase.from('branches').select('name').eq('id', row.branch_id).maybeSingle();
				if (!cancelled) setBranchName(br?.name || 'Your branch');
			} else {
				setBranchName('');
			}
			setProfileLoading(false);
		})();
		return () => {
			cancelled = true;
		};
	}, [user?.id]);

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
	}, [searchParams]);

	const persistQuery = useCallback(
		(updates) => {
			const next = new URLSearchParams(searchParams);
			if (updates.range?.from && updates.range?.to) {
				next.set('start', format(updates.range.from, 'yyyy-MM-dd'));
				next.set('end', format(updates.range.to, 'yyyy-MM-dd'));
			}
			setSearchParams(next, { replace: true });
		},
		[searchParams, setSearchParams]
	);

	const fetchDashboardData = useCallback(async () => {
		if (!dateRange?.from || !dateRange?.to || !user?.id || profileLoading) return;
		setLoading(true);
		try {
			const { data: configData } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
			if (configData?.value) setCurrency(configData.value);

			const { data, error } = await supabase.rpc('get_admin_dashboard_metrics', {
				p_start_date: format(dateRange.from, 'yyyy-MM-dd'),
				p_end_date: format(dateRange.to, 'yyyy-MM-dd'),
				p_branch_id: officerBranchId || null,
				p_officer_id: user.id,
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
						: 'Could not load your dashboard metrics.',
				variant: 'destructive',
			});
			setStats(null);
		} finally {
			setLoading(false);
		}
	}, [dateRange, officerBranchId, user?.id, profileLoading, toast]);

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
		navigate(`/officer/dashboard/metrics/${metricKey}?${q.toString()}`);
	};

	const quickActions = useMemo(
		() => [
			{
				title: 'Borrowers',
				icon: Users,
				description: 'Register and manage your borrowers',
				path: '/officer/borrowers',
			},
			{
				title: 'Loans',
				icon: Briefcase,
				description: 'Create and manage your loans',
				path: '/officer/loans',
			},
			{
				title: 'Repayments',
				icon: Banknote,
				description: 'Record repayments',
				path: '/officer/repayment-management',
			},
			{
				title: 'Centers & groups',
				icon: Building2,
				description: 'Manage centers and groups',
				path: '/officer/centers-groups',
			},
		],
		[]
	);

	const s = stats || {};

	return (
		<DashboardLayout title="My dashboard">
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

						<div className="w-full min-w-[200px] sm:w-[240px] rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
							<p className="text-xs font-medium text-neutral-500">Branch</p>
							<p className="text-sm font-semibold text-neutral-900">{branchName || (officerBranchId ? '—' : 'Not assigned')}</p>
						</div>

						<div className="w-full min-w-[220px] rounded-lg border border-brand-gold/25 bg-brand-gold/5 px-3 py-2">
							<p className="text-xs font-medium text-neutral-600">Scope</p>
							<p className="text-sm font-semibold text-neutral-900">Your loans & borrowers only</p>
						</div>
					</div>
				</div>

				{loading || profileLoading ? (
					<div className="flex h-64 items-center justify-center">
						<Loader2 className="h-8 w-8 animate-spin text-brand-gold" />
					</div>
				) : (
					<>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							<DashboardStatCard title="Your branch" index={0}>
								{s.total_branches ?? 0}
							</DashboardStatCard>
							<DashboardStatCard title="My profile" index={1}>
								{s.total_users ?? 0}
							</DashboardStatCard>
							<DashboardStatCard title="My borrowers" index={2}>
								{s.total_borrowers ?? 0}
							</DashboardStatCard>
							<DashboardStatCard title="Active loans" index={3}>
								{s.active_loans_count ?? 0}
							</DashboardStatCard>
						</div>

						<MetricSection icon={PieChart} title="Portfolio (balance)" subtitle="Your portfolio only">
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

export default LoanOfficerDashboard;
