import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Card, CardContent, CardTitle, CardDescription } from '@/components/ui/card';
import {
	FileQuestion,
	Loader2,
	Banknote,
	AlertTriangle,
	TrendingUp,
	UserPlus,
	Briefcase,
	User,
	PiggyBank,
	Landmark,
	CalendarClock,
	CalendarDays,
	Target,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { DRILLDOWN_METRICS } from '@/lib/dashboardMetrics';
import { SearchableSelect } from '@/components/ui/searchable-select';
import {
	defaultDashboardRange,
	quickActionCardClass,
	quickActionIconWrapClass,
} from '@/components/dashboard/DashboardMetricShell';
import { AdminExpandableMetricCard } from '@/components/dashboard/AdminExpandableMetricCard';

const MANAGER_CARD_SHELLS = [
	'bg-gradient-to-br from-pink-500 via-rose-600 to-red-900 shadow-pink-900/30',
	'bg-gradient-to-br from-violet-600 via-purple-700 to-indigo-950 shadow-violet-900/30',
	'bg-gradient-to-br from-sky-500 via-blue-600 to-indigo-950 shadow-blue-900/30',
	'bg-gradient-to-br from-emerald-500 via-green-600 to-teal-900 shadow-emerald-900/30',
	'bg-gradient-to-br from-teal-500 via-cyan-600 to-sky-900 shadow-teal-900/30',
	'bg-gradient-to-br from-blue-500 via-indigo-600 to-violet-950 shadow-blue-900/30',
	'bg-gradient-to-br from-indigo-600 via-blue-800 to-slate-950 shadow-indigo-900/30',
	'bg-gradient-to-br from-violet-400 via-fuchsia-600 to-purple-900 shadow-purple-900/30',
	'bg-gradient-to-br from-red-500 via-rose-700 to-red-950 shadow-red-900/30',
	'bg-gradient-to-br from-rose-600 via-pink-700 to-rose-950 shadow-rose-900/30',
	'bg-gradient-to-br from-orange-500 via-amber-600 to-orange-900 shadow-orange-900/30',
	'bg-gradient-to-br from-cyan-400 via-sky-500 to-blue-900 shadow-sky-900/30',
	'bg-gradient-to-br from-fuchsia-600 via-pink-700 to-purple-950 shadow-fuchsia-900/30',
	'bg-gradient-to-br from-lime-500 via-emerald-600 to-green-950 shadow-emerald-900/25',
];

const BranchManagerDashboard = () => {
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const { user } = useAuth();
	const { toast } = useToast();
	const [loading, setLoading] = useState(true);
	const [profileLoading, setProfileLoading] = useState(true);
	const [currency, setCurrency] = useState('TZS');
	const [dateRange, setDateRange] = useState(defaultDashboardRange);
	const [stats, setStats] = useState(null);
	const [managerBranchId, setManagerBranchId] = useState(null);
	const [branchName, setBranchName] = useState('');
	const [officers, setOfficers] = useState([]);
	const [officerId, setOfficerId] = useState('');
	const [expandedCardId, setExpandedCardId] = useState(null);

	useEffect(() => {
		let cancelled = false;
		(async () => {
			setProfileLoading(true);
			if (!user?.id) {
				setManagerBranchId(null);
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
			if (error || !row || row.role !== 'manager' || !row.branch_id) {
				setManagerBranchId(null);
				setBranchName('');
				setProfileLoading(false);
				return;
			}
			setManagerBranchId(row.branch_id);
			const { data: br } = await supabase.from('branches').select('name').eq('id', row.branch_id).maybeSingle();
			if (!cancelled) setBranchName(br?.name || 'Your branch');
			const { data: of } = await supabase
				.from('users')
				.select('id, full_name, branch_id')
				.eq('role', 'officer')
				.eq('branch_id', row.branch_id)
				.order('full_name');
			if (!cancelled) setOfficers(of || []);
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
		setOfficerId(searchParams.get('officer') || '');
	}, [searchParams]);

	const persistQuery = useCallback(
		(updates) => {
			const next = new URLSearchParams(searchParams);
			if (updates.range?.from && updates.range?.to) {
				next.set('start', format(updates.range.from, 'yyyy-MM-dd'));
				next.set('end', format(updates.range.to, 'yyyy-MM-dd'));
			}
			if ('officerId' in updates) {
				if (updates.officerId) next.set('officer', updates.officerId);
				else next.delete('officer');
			}
			setSearchParams(next, { replace: true });
		},
		[searchParams, setSearchParams]
	);

	const managerOfficerOptions = useMemo(
		() => officers.map((o) => ({ value: o.id, label: o.full_name })),
		[officers]
	);

	const fetchDashboardData = useCallback(async () => {
		if (!dateRange?.from || !dateRange?.to || !managerBranchId || profileLoading) return;
		setLoading(true);
		try {
			const { data: configData } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
			if (configData?.value) setCurrency(configData.value);

			const { data, error } = await supabase.rpc('get_admin_dashboard_metrics', {
				p_start_date: format(dateRange.from, 'yyyy-MM-dd'),
				p_end_date: format(dateRange.to, 'yyyy-MM-dd'),
				p_branch_id: managerBranchId,
				p_officer_id: officerId || null,
				p_nearing_days: 14,
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
						: 'Could not load dashboard metrics for your branch.',
				variant: 'destructive',
			});
			setStats(null);
		} finally {
			setLoading(false);
		}
	}, [dateRange, managerBranchId, officerId, profileLoading, toast]);

	useEffect(() => {
		fetchDashboardData();
	}, [fetchDashboardData]);

	const formatCurrency = (value) => {
		const number = Number(value || 0);
		return `${currency} ${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	};

	const openMetric = (metricKey, drillParams = {}) => {
		const start = format(dateRange.from, 'yyyy-MM-dd');
		const end = format(dateRange.to, 'yyyy-MM-dd');
		const q = new URLSearchParams({ start, end });
		if (officerId) q.set('officer', officerId);
		if (drillParams.days != null) q.set('days', String(drillParams.days));
		navigate(`/manager/dashboard/metrics/${metricKey}?${q.toString()}`);
	};

	const withFilterQuery = useCallback(
		(path) => {
			const q = new URLSearchParams();
			if (officerId) q.set('officer', officerId);
			const qs = q.toString();
			return qs ? `${path}?${qs}` : path;
		},
		[officerId]
	);

	const navigatePath = useCallback(
		(path) => {
			navigate(withFilterQuery(path));
		},
		[navigate, withFilterQuery]
	);

	const toggleCard = (id) => {
		setExpandedCardId((prev) => (prev === id ? null : id));
	};

	const quickActions = useMemo(
		() => [
			{
				title: 'Loan officers',
				icon: UserPlus,
				description: 'Register and manage officers in your branch',
				path: '/manager/loan-officers',
			},
			{
				title: 'Branch loans',
				icon: Briefcase,
				description: 'View loans for your branch',
				path: '/manager/loans',
			},
			{
				title: 'Loan requests',
				icon: FileQuestion,
				description: 'Review loan edit/delete requests',
				path: '/manager/loan-requests',
			},
			{
				title: 'Repayments',
				icon: Banknote,
				description: 'Repayment management for your branch',
				path: '/manager/repayment-management',
			},
		],
		[]
	);

	const s = stats || {};

	const pct = (part, total) => {
		const p = Number(part) || 0;
		const t = Number(total) || 0;
		if (t <= 0) return 0;
		return Math.min(100, Math.round((p / t) * 100));
	};

	const portfolioTotal = Number(s.portfolio_general) || 0;

	const metricCards = [
		{
			id: 'borrowers',
			title: 'Branch Borrowers',
			value: String(s.total_borrowers ?? 0),
			icon: User,
			shell: MANAGER_CARD_SHELLS[0],
			progressPct: pct(s.total_borrowers, 5000),
			subItems: [
				{ label: 'Branch loans', path: '/manager/loans', key: 'b-lo' },
				{ label: 'Loan requests', path: '/manager/loan-requests', key: 'b-lr' },
			],
		},
		{
			id: 'active_loans',
			title: 'Branch Active Loans',
			value: String(s.active_loans_count ?? 0),
			icon: Briefcase,
			shell: MANAGER_CARD_SHELLS[1],
			progressPct: pct(s.active_loans_count, portfolioTotal > 0 ? 500 : 100),
			subItems: [
				{
					label: 'Active loans (list)',
					value: formatCurrency(s.portfolio_active),
					metricKey: DRILLDOWN_METRICS.portfolio_active,
					key: 'al-active',
				},
				{
					label: 'Defaulted portfolio',
					value: formatCurrency(s.portfolio_defaulted),
					metricKey: DRILLDOWN_METRICS.portfolio_defaulted,
					key: 'al-def',
				},
			],
		},
		{
			id: 'total_portfolio',
			title: 'Branch Portfolio',
			value: formatCurrency(s.portfolio_general),
			icon: PiggyBank,
			shell: MANAGER_CARD_SHELLS[2],
			progressPct: portfolioTotal > 0 ? pct(s.portfolio_active, portfolioTotal) : 0,
			subItems: [
				{
					label: 'Active',
					value: formatCurrency(s.portfolio_active),
					metricKey: DRILLDOWN_METRICS.portfolio_active,
					key: 'tp-act',
				},
				{
					label: 'Defaulted',
					value: formatCurrency(s.portfolio_defaulted),
					metricKey: DRILLDOWN_METRICS.portfolio_defaulted,
					key: 'tp-def',
				},
				{
					label: 'General',
					value: formatCurrency(s.portfolio_general),
					metricKey: DRILLDOWN_METRICS.portfolio_general,
					key: 'tp-gen',
				},
			],
		},
		{
			id: 'principal_disbursed',
			title: 'Principal Disbursed',
			value: formatCurrency(s.disbursed_overall),
			icon: TrendingUp,
			shell: MANAGER_CARD_SHELLS[3],
			progressPct: pct(s.disbursed_monthly, s.disbursed_overall),
			subItems: [
				{
					label: 'Monthly',
					value: formatCurrency(s.disbursed_monthly),
					metricKey: DRILLDOWN_METRICS.disbursed_monthly,
					key: 'pd-m',
				},
				{
					label: 'Yearly',
					value: formatCurrency(s.disbursed_yearly),
					metricKey: DRILLDOWN_METRICS.disbursed_yearly,
					key: 'pd-y',
				},
				{
					label: 'Overall',
					value: formatCurrency(s.disbursed_overall),
					metricKey: DRILLDOWN_METRICS.disbursed_overall,
					key: 'pd-o',
				},
			],
		},
		{
			id: 'principal_collected',
			title: 'Principal Collected',
			value: formatCurrency(s.collected_month_principal),
			icon: Banknote,
			shell: MANAGER_CARD_SHELLS[4],
			progressPct: pct(s.collected_month_principal, s.collected_month_total),
			subItems: [
				{
					label: 'Principal',
					value: formatCurrency(s.collected_month_principal),
					metricKey: DRILLDOWN_METRICS.collected_month_principal,
					key: 'pc-p',
				},
			],
		},
		{
			id: 'outstanding_principal',
			title: 'Outstanding Principal',
			value: formatCurrency(s.outstanding_principal),
			icon: Landmark,
			shell: MANAGER_CARD_SHELLS[6],
			progressPct: pct(s.outstanding_principal, s.outstanding_total),
			subItems: [
				{
					label: 'Principal',
					value: formatCurrency(s.outstanding_principal),
					metricKey: DRILLDOWN_METRICS.outstanding_principal,
					key: 'op-p',
				},
			],
		},
		{
			id: 'defaulted_principal',
			title: 'Defaulted Principal',
			value: formatCurrency(s.default_disbursed_principal),
			icon: AlertTriangle,
			shell: MANAGER_CARD_SHELLS[8],
			progressPct: pct(s.default_disbursed_principal, s.default_total_amount),
			subItems: [
				{
					label: 'Disbursed principal',
					value: formatCurrency(s.default_disbursed_principal),
					metricKey: DRILLDOWN_METRICS.default_disbursed,
					key: 'df-p',
				},
				{
					label: 'Interest amount',
					value: formatCurrency(s.default_interest_amount),
					metricKey: DRILLDOWN_METRICS.default_interest,
					key: 'df-i',
				},
				{
					label: 'Total amount',
					value: formatCurrency(s.default_total_amount),
					metricKey: DRILLDOWN_METRICS.default_total,
					key: 'df-t',
				},
			],
		},
		{
			id: 'defaulted_interest',
			title: 'Defaulted Interest',
			value: formatCurrency(s.default_interest_amount),
			icon: AlertTriangle,
			shell: MANAGER_CARD_SHELLS[9],
			progressPct: pct(s.default_interest_amount, s.default_total_amount),
			subItems: [
				{
					label: 'Disbursed principal',
					value: formatCurrency(s.default_disbursed_principal),
					metricKey: DRILLDOWN_METRICS.default_disbursed,
					key: 'di-p',
				},
				{
					label: 'Interest amount',
					value: formatCurrency(s.default_interest_amount),
					metricKey: DRILLDOWN_METRICS.default_interest,
					key: 'di-i',
				},
				{
					label: 'Total amount',
					value: formatCurrency(s.default_total_amount),
					metricKey: DRILLDOWN_METRICS.default_total,
					key: 'di-t',
				},
			],
		},
		{
			id: 'expected_today',
			title: 'Expected Today',
			value: formatCurrency(s.expected_today ?? 0),
			icon: CalendarClock,
			shell: MANAGER_CARD_SHELLS[10],
			progressPct: pct(s.expected_today, s.collected_month_total),
			subItems: [
				{
					label: 'Due today (installments)',
					value: formatCurrency(s.expected_today ?? 0),
					metricKey: DRILLDOWN_METRICS.expected_today,
					key: 'ex-t',
				},
				{
					label: 'Principal collected this month',
					value: formatCurrency(s.collected_month_principal),
					metricKey: DRILLDOWN_METRICS.collected_month_principal,
					key: 'ex-r',
				},
			],
		},
		{
			id: 'nearing_completion',
			title: 'Nearing loan completion',
			value: String(s.nearing_completion ?? 0),
			icon: Target,
			shell: MANAGER_CARD_SHELLS[11],
			progressPct: pct(s.nearing_completion, s.active_loans_count),
			subItems: [
				{
					label: 'Loans (final payment within 14 days)',
					value: String(s.nearing_completion ?? 0),
					metricKey: DRILLDOWN_METRICS.nearing_completion,
					drillParams: { days: 14 },
					key: 'near-14',
				},
				{
					label: 'Loans (final payment within 7 days)',
					value: '—',
					metricKey: DRILLDOWN_METRICS.nearing_completion,
					drillParams: { days: 7 },
					key: 'near-7',
				},
				{
					label: 'Loans (final payment within 30 days)',
					value: '—',
					metricKey: DRILLDOWN_METRICS.nearing_completion,
					drillParams: { days: 30 },
					key: 'near-30',
				},
			],
		},
		{
			id: 'disbursed_month',
			title: 'Disbursed This Month',
			value: formatCurrency(s.disbursed_monthly),
			icon: CalendarDays,
			shell: MANAGER_CARD_SHELLS[12],
			progressPct: pct(s.disbursed_monthly, s.disbursed_overall),
			subItems: [
				{
					label: 'Monthly',
					value: formatCurrency(s.disbursed_monthly),
					metricKey: DRILLDOWN_METRICS.disbursed_monthly,
					key: 'dm-m',
				},
				{
					label: 'Yearly',
					value: formatCurrency(s.disbursed_yearly),
					metricKey: DRILLDOWN_METRICS.disbursed_yearly,
					key: 'dm-y',
				},
				{
					label: 'Overall',
					value: formatCurrency(s.disbursed_overall),
					metricKey: DRILLDOWN_METRICS.disbursed_overall,
					key: 'dm-o',
				},
			],
		},
		{
			id: 'loan_officers',
			title: 'Loan Officers',
			value: String(officers.length),
			icon: UserPlus,
			shell: MANAGER_CARD_SHELLS[13],
			progressPct: pct(officers.length, 20),
			subItems: [
				{ label: 'Manage loan officers', path: '/manager/loan-officers', key: 'lo-m' },
				{ label: 'Branch loans', path: '/manager/loans', key: 'lo-l' },
			],
		},
	];

	if (!profileLoading && !managerBranchId) {
		return (
			<DashboardLayout title="Branch dashboard">
				<div className="rounded-xl border border-amber-500/40 bg-amber-50 px-4 py-6 text-sm text-amber-950">
					Your manager account has no branch assigned. Ask an admin to assign a branch in User Management, then sign out and sign in again.
				</div>
			</DashboardLayout>
		);
	}

	return (
		<DashboardLayout title="Branch dashboard">
			<div className="space-y-8">
				<div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm lg:flex-row lg:flex-wrap lg:items-end lg:justify-between dark:bg-card">
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
							<p className="text-sm font-semibold text-neutral-900">{branchName || '—'}</p>
						</div>

						<div className="w-full min-w-[200px] sm:w-[220px]">
							<p className="mb-1.5 text-xs font-medium text-neutral-500">Loan officer</p>
							<SearchableSelect
								value={officerId || 'all'}
								onValueChange={(v) => {
									const next = v === 'all' ? '' : v;
									setOfficerId(next);
									persistQuery({ officerId: next });
								}}
								options={managerOfficerOptions}
								allLabel="All officers in branch"
								allValue="all"
								placeholder="All officers in branch"
								searchPlaceholder="Search officers…"
								emptyText="No officer found."
								triggerClassName="w-full"
							/>
						</div>

						{officerId && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="text-neutral-600"
								onClick={() => {
									setOfficerId('');
									persistQuery({ officerId: '' });
								}}
							>
								Clear officer filter
							</Button>
						)}
					</div>
				</div>

				{loading || profileLoading ? (
					<div className="flex h-64 items-center justify-center">
						<Loader2 className="h-8 w-8 animate-spin text-brand-gold" />
					</div>
				) : (
					<>
						<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
							{metricCards.map((c) => (
								<AdminExpandableMetricCard
									key={c.id}
									cardId={c.id}
									expandedId={expandedCardId}
									onToggle={toggleCard}
									title={c.title}
									value={c.value}
									icon={c.icon}
									shellClass={c.shell}
									progressPct={c.progressPct}
									subItems={c.subItems}
									onDrillMetric={openMetric}
									onNavigatePath={navigatePath}
								/>
							))}
						</div>

						<div>
							<h3 className="mb-4 font-display text-lg font-bold text-neutral-900 dark:text-neutral-100">Quick actions</h3>
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

export default BranchManagerDashboard;
