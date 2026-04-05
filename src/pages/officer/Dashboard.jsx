import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
	Users,
	Loader2,
	Banknote,
	TrendingUp,
	Briefcase,
	Building2,
	CalendarClock,
	Sunrise,
	AlertTriangle,
	ShieldAlert,
	Target,
	Activity,
	Flag,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { DRILLDOWN_METRICS } from '@/lib/dashboardMetrics';
import { defaultDashboardRange, quickActionCardClass } from '@/components/dashboard/DashboardMetricShell';
import { AdminExpandableMetricCard } from '@/components/dashboard/AdminExpandableMetricCard';

const OFFICER_CARD_SHELLS = [
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
];

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
	const [expandedCardId, setExpandedCardId] = useState(null);
	/** Period sums for selected date range (RPC officer_dashboard_range_kpis). */
	const [rangeKpi, setRangeKpi] = useState(null);

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
				p_nearing_days: 14,
			});

			if (error) throw error;
			if (data?.length) setStats(data[0]);
			else setStats(null);

			try {
				const { data: rk, error: rkErr } = await supabase.rpc('officer_dashboard_range_kpis', {
					p_officer_id: user.id,
					p_start: format(dateRange.from, 'yyyy-MM-dd'),
					p_end: format(dateRange.to, 'yyyy-MM-dd'),
				});
				if (rkErr) {
					console.warn('officer_dashboard_range_kpis', rkErr);
					setRangeKpi(null);
				} else {
					setRangeKpi(rk && typeof rk === 'object' ? rk : null);
				}
			} catch (e) {
				console.warn(e);
				setRangeKpi(null);
			}
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
			setRangeKpi(null);
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

	const officerKpis = useMemo(() => {
		const z = stats || {};
		const rk = rangeKpi || {};
		const principalDisbursed = Number(rk.principal_disbursed) || 0;
		const amountCollected = Number(rk.amount_collected) || 0;
		const book = Number(z.loans_book_count) || 0;
		const del = Number(z.loans_delinquent_count) || 0;
		const healthyPct = book > 0 ? Math.round(((book - del) / book) * 100) : 100;
		const expToday = Number(z.expected_today) || 0;
		const collToday = Number(z.collected_today) || 0;
		let todayCollectionPct = 0;
		if (expToday > 0) todayCollectionPct = Math.min(100, Math.round((collToday / expToday) * 100));
		else if (collToday > 0) todayCollectionPct = 100;
		let periodRecoveryPct = 0;
		if (principalDisbursed > 0) periodRecoveryPct = Math.min(100, Math.round((amountCollected / principalDisbursed) * 100));
		else if (amountCollected > 0) periodRecoveryPct = 100;
		return {
			principalDisbursed,
			amountCollected,
			healthyPct,
			todayCollectionPct,
			periodRecoveryPct,
			expToday,
			collToday,
			nearing: Number(z.nearing_completion) || 0,
		};
	}, [stats, rangeKpi]);

	const dailyFocusCards = useMemo(() => {
		const z = stats || {};
		const expToday = Number(z.expected_today) || 0;
		const collToday = Number(z.collected_today) || 0;
		const todayBarPct =
			expToday > 0 ? Math.min(100, Math.round((collToday / expToday) * 100)) : collToday > 0 ? 100 : 0;
		const fc = (v) =>
			`${currency} ${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
		return [
			{
				id: 'df_disb',
				title: 'Today disbursements',
				value: fc(z.disbursed_today ?? 0),
				icon: TrendingUp,
				shell: OFFICER_CARD_SHELLS[3],
				progressPct: 0,
				subItems: [
					{
						label: 'Drilldown — disbursements today',
						metricKey: DRILLDOWN_METRICS.disbursed_today,
						key: 'df-disb-drill',
					},
				],
			},
			{
				id: 'df_clients_today',
				title: 'Clients disbursed today',
				value: String(z.borrowers_disbursed_today ?? 0),
				icon: Users,
				shell: OFFICER_CARD_SHELLS[2],
				progressPct: 0,
				subItems: [{ label: 'Borrowers list', path: '/officer/borrowers', key: 'df-cli-bor' }],
			},
			{
				id: 'df_coll',
				title: 'Today collection',
				value: fc(z.collected_today ?? 0),
				icon: Banknote,
				shell: OFFICER_CARD_SHELLS[4],
				progressPct: todayBarPct,
				subItems: [
					{
						label: 'Drilldown — collected today',
						metricKey: DRILLDOWN_METRICS.collected_today,
						key: 'df-coll-drill',
					},
				],
			},
			{
				id: 'df_exp',
				title: 'Expected today',
				value: fc(z.expected_today ?? 0),
				icon: CalendarClock,
				shell: OFFICER_CARD_SHELLS[10],
				progressPct: 0,
				subItems: [
					{
						label: 'Drilldown — expected today',
						metricKey: DRILLDOWN_METRICS.expected_today,
						key: 'df-exp-drill',
					},
				],
			},
			{
				id: 'df_proj',
				title: 'Projected tomorrow',
				value: fc(z.expected_tomorrow ?? 0),
				icon: Sunrise,
				shell: OFFICER_CARD_SHELLS[11],
				progressPct: 0,
				subItems: [
					{
						label: 'Drilldown — projected tomorrow',
						metricKey: DRILLDOWN_METRICS.expected_tomorrow,
						key: 'df-proj-drill',
					},
				],
			},
			{
				id: 'df_bor',
				title: 'Total borrowers',
				value: String(z.total_borrowers ?? 0),
				icon: Users,
				shell: OFFICER_CARD_SHELLS[0],
				progressPct: 0,
				subItems: [
					{
						label: 'Drilldown — your borrowers',
						metricKey: DRILLDOWN_METRICS.my_borrowers,
						key: 'df-bor-drill',
					},
				],
			},
		];
	}, [stats, currency]);

	const KpiBar = ({ pct, className }) => (
		<div className={cn('h-2 w-full overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700', className)}>
			<div
				className="h-full rounded-full bg-gradient-to-r from-brand-gold to-brand-gold-deep transition-[width] duration-500"
				style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
			/>
		</div>
	);

	const riskCards = useMemo(() => {
		const z = stats || {};
		const book = Number(z.loans_book_count) || 0;
		const rate = (part, total) => {
			const p = Number(part) || 0;
			const t = Number(total) || 0;
			if (t <= 0) return 0;
			return Math.min(100, Math.round((p / t) * 100));
		};
		const ar = rate(z.loans_delinquent_count, book);
		const dfp = rate(z.loans_defaulted_count, book);
		const fc = (v) =>
			`${currency} ${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
		const delN = Number(z.loans_delinquent_count) || 0;
		const defN = Number(z.loans_defaulted_count) || 0;
		return [
			{
				id: 'risk_arrears',
				title: 'Arrears (delinquent)',
				value: fc(z.portfolio_delinquent ?? 0),
				icon: AlertTriangle,
				shell: OFFICER_CARD_SHELLS[6],
				progressPct: ar,
				subItems: [
					{
						label: 'Open Arrears page',
						path: '/arrears',
						value: `${ar}% · ${delN} loan${delN === 1 ? '' : 's'} · book ${book}`,
						key: 'risk-ar',
					},
				],
			},
			{
				id: 'risk_default',
				title: 'Defaulters',
				value: fc(z.portfolio_defaulted ?? 0),
				icon: ShieldAlert,
				shell: OFFICER_CARD_SHELLS[8],
				progressPct: dfp,
				subItems: [
					{
						label: 'Open Defaulters page',
						path: '/defaulters',
						value: `${dfp}% · ${defN} loan${defN === 1 ? '' : 's'} · book ${book}`,
						key: 'risk-def',
					},
					{
						label: 'Drilldown — defaulted portfolio',
						metricKey: DRILLDOWN_METRICS.portfolio_defaulted,
						key: 'risk-def-drill',
					},
				],
			},
		];
	}, [stats, currency]);

	const openMetric = (metricKey, drillParams = {}) => {
		const start = format(dateRange.from, 'yyyy-MM-dd');
		const end = format(dateRange.to, 'yyyy-MM-dd');
		const q = new URLSearchParams({ start, end });
		if (drillParams.days != null) q.set('days', String(drillParams.days));
		navigate(`/officer/dashboard/metrics/${metricKey}?${q.toString()}`);
	};

	const navigatePath = useCallback(
		(path) => {
			navigate(path);
		},
		[navigate]
	);

	const toggleCard = (id) => {
		setExpandedCardId((prev) => (prev === id ? null : id));
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

	const pct = (part, total) => {
		const p = Number(part) || 0;
		const t = Number(total) || 0;
		if (t <= 0) return 0;
		return Math.min(100, Math.round((p / t) * 100));
	};

	const portfolioTotal = Number(s.portfolio_general) || 0;

	/** Expandable portfolio cards — officer only keeps Active Loans. */
	const metricCards = [
		{
			id: 'active_loans',
			title: 'Active Loans',
			value: String(s.active_loans_count ?? 0),
			icon: Briefcase,
			shell: OFFICER_CARD_SHELLS[1],
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
	];

	return (
		<DashboardLayout title="My dashboard">
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
						<div className="space-y-3 rounded-xl border border-brand-gold/30 bg-gradient-to-br from-amber-50/90 via-white to-white p-4 shadow-sm dark:from-brand-gold/15 dark:via-card dark:to-card dark:border-brand-gold/25">
							<div>
								<h2 className="font-display text-sm font-semibold uppercase tracking-wide text-neutral-700 dark:text-neutral-200">
									Your progress
								</h2>
							</div>
							<div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
								<Card className="border-neutral-200/80 bg-white/90 dark:bg-card dark:border-neutral-700">
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">Today: collection vs due</CardTitle>
										<Banknote className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<p className="text-xs text-muted-foreground">Collected / due today</p>
										<p className="text-lg font-bold tabular-nums">
											{formatCurrency(officerKpis.collToday)} / {formatCurrency(officerKpis.expToday)}
										</p>
										<KpiBar pct={officerKpis.todayCollectionPct} className="mt-3" />
										<p className="mt-1.5 text-xs text-muted-foreground">
											{officerKpis.todayCollectionPct}% of today&apos;s scheduled due collected
										</p>
									</CardContent>
								</Card>
								<Card className="border-neutral-200/80 bg-white/90 dark:bg-card dark:border-neutral-700">
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">Healthy book</CardTitle>
										<Activity className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<p className="text-xs text-muted-foreground">Healthy book share</p>
										<p className="text-3xl font-bold tabular-nums">{officerKpis.healthyPct}%</p>
										<KpiBar pct={officerKpis.healthyPct} className="mt-3" />
										<p className="mt-1.5 text-xs text-muted-foreground">
											Share of your live loans that are not delinquent
										</p>
									</CardContent>
								</Card>
								<Card className="border-neutral-200/80 bg-white/90 dark:bg-card dark:border-neutral-700">
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">Selected period</CardTitle>
										<Target className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<p className="text-xs text-muted-foreground">Collected vs principal disbursed</p>
										<p className="text-sm font-semibold tabular-nums">
											{formatCurrency(officerKpis.amountCollected)} / {formatCurrency(officerKpis.principalDisbursed)}
										</p>
										<KpiBar pct={officerKpis.periodRecoveryPct} className="mt-3" />
										<p className="mt-1.5 text-xs text-muted-foreground">
											{officerKpis.principalDisbursed > 0
												? `Collections as % of principal disbursed in range (${officerKpis.periodRecoveryPct}%)`
												: 'No disbursements in this range — collections still reflect your activity'}
										</p>
									</CardContent>
								</Card>
								<Card className="border-neutral-200/80 bg-white/90 dark:bg-card dark:border-neutral-700">
									<CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
										<CardTitle className="text-sm font-medium">Nearing completion</CardTitle>
										<Flag className="h-4 w-4 text-muted-foreground" />
									</CardHeader>
									<CardContent>
										<p className="text-xs text-muted-foreground">Loans nearing final payment</p>
										<p className="text-3xl font-bold tabular-nums">{officerKpis.nearing}</p>
										<Button
											type="button"
											variant="outline"
											size="sm"
											className="mt-3 w-full"
											onClick={() => openMetric(DRILLDOWN_METRICS.nearing_completion, { days: 14 })}
										>
											View list
										</Button>
									</CardContent>
								</Card>
							</div>
						</div>

						<div className="space-y-2">
							<h3 className="font-display text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
								Today&apos;s focus
							</h3>
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
								{dailyFocusCards.map((c) => {
									const Icon = c.icon;
									return (
										<AdminExpandableMetricCard
											key={c.id}
											cardId={c.id}
											expandedId={expandedCardId}
											onToggle={toggleCard}
											title={c.title}
											value={c.value}
											icon={Icon}
											shellClass={c.shell}
											progressPct={c.progressPct}
											subItems={c.subItems}
											onDrillMetric={openMetric}
											onNavigatePath={navigatePath}
										/>
									);
								})}
							</div>
						</div>

						<div className="space-y-2">
							<h3 className="font-display text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
								Arrears &amp; defaulters
							</h3>
							<p className="text-xs text-neutral-500 dark:text-neutral-400">
								Portfolio balance (delinquent / defaulted). KPI % is share of your live loan book. Expand for deep links.
							</p>
							<div className="grid gap-3 sm:grid-cols-2">
								{riskCards.map((c) => {
									const Icon = c.icon;
									return (
										<AdminExpandableMetricCard
											key={c.id}
											cardId={c.id}
											expandedId={expandedCardId}
											onToggle={toggleCard}
											title={c.title}
											value={c.value}
											icon={Icon}
											shellClass={c.shell}
											progressPct={c.progressPct}
											subItems={c.subItems}
											onDrillMetric={openMetric}
											onNavigatePath={navigatePath}
										/>
									);
								})}
							</div>
						</div>

						<div className="grid max-w-md grid-cols-1 gap-3">
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
							<h3 className="mb-2 font-display text-base font-bold text-neutral-900 dark:text-neutral-100">Quick actions</h3>
							<div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
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
												<CardContent className="flex flex-col items-center px-3 py-3 text-center sm:px-4 sm:py-3.5">
													<div className="mb-2 rounded-lg bg-white/20 p-2 text-white shadow-inner ring-1 ring-white/25 backdrop-blur-sm">
														<Icon className="h-5 w-5" />
													</div>
													<CardTitle className="text-sm font-semibold leading-tight">{action.title}</CardTitle>
													<CardDescription className="mt-0.5 line-clamp-2 text-center text-xs text-white/85">
														{action.description}
													</CardDescription>
													<Button variant="outline" size="sm" className="mt-2 h-8 px-3 text-xs">
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
