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
	ScrollText,
	User,
	Briefcase,
	PiggyBank,
	TrendingUp,
	Banknote,
	CircleDollarSign,
	Landmark,
	Wallet,
	AlertTriangle,
	CalendarClock,
	CalendarDays,
	Building2,
	Users2,
	Target,
	Sunrise,
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
import { fetchAdminFieldWalletSnapshot } from '@/lib/adminFieldWalletSnapshot';
import { useDashboardRealtimeRefresh } from '@/hooks/useDashboardRealtimeRefresh';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const normalizeUuidParam = (v) => (v && UUID_RE.test(String(v).trim()) ? String(v).trim() : '');

const CARD_SHELLS = [
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
	'bg-gradient-to-br from-amber-500 via-orange-600 to-amber-950 shadow-amber-900/30',
	'bg-gradient-to-br from-fuchsia-600 via-pink-700 to-purple-950 shadow-fuchsia-900/30',
	'bg-gradient-to-br from-lime-500 via-emerald-600 to-green-950 shadow-emerald-900/25',
];

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
	const [expandedCardId, setExpandedCardId] = useState(null);
	const [walletSnap, setWalletSnap] = useState(null);
	const [walletSnapLoading, setWalletSnapLoading] = useState(false);

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
		setBranchId(normalizeUuidParam(searchParams.get('branch')));
		setOfficerId(normalizeUuidParam(searchParams.get('officer')));
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

	const officersInScope = useMemo(() => {
		if (officerId) return officers.filter((o) => o.id === officerId);
		if (branchId) return officers.filter((o) => o.branch_id === branchId);
		return officers;
	}, [officers, branchId, officerId]);

	const walletFocusDate = useMemo(() => format(dateRange.to, 'yyyy-MM-dd'), [dateRange.to]);

	const adminDashBranchOptions = useMemo(
		() => branches.map((b) => ({ value: b.id, label: b.name })),
		[branches]
	);
	const adminDashOfficerOptions = useMemo(
		() => officersForBranch.map((o) => ({ value: o.id, label: o.full_name })),
		[officersForBranch]
	);

	useEffect(() => {
		if (!officerId || !branchId) return;
		const o = officers.find((x) => x.id === officerId);
		if (o && o.branch_id !== branchId) setOfficerId('');
	}, [branchId, officerId, officers]);

	const fetchDashboardData = useCallback(async (opts = {}) => {
		const silent = opts.silent === true;
		if (!dateRange?.from || !dateRange?.to) return;
		if (!silent) setLoading(true);
		try {
			const { data: configData } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
			if (configData?.value) setCurrency(configData.value);

			const safeBranchId = normalizeUuidParam(branchId);
			const safeOfficerId = normalizeUuidParam(officerId);

			const { data, error } = await supabase.rpc('get_admin_dashboard_metrics', {
				p_start_date: format(dateRange.from, 'yyyy-MM-dd'),
				p_end_date: format(dateRange.to, 'yyyy-MM-dd'),
				p_branch_id: safeBranchId || null,
				p_officer_id: safeOfficerId || null,
				p_nearing_days: 14,
			});

			if (error) throw error;
			if (data?.length) setStats(data[0]);
			else setStats(null);
		} catch (err) {
			console.error(err);
			if (!silent) {
				const rawMsg =
					err?.message || (typeof err === 'string' ? err : '') || 'Could not load dashboard metrics.';
				toast({
					title: 'Error',
					description:
						err.message?.includes('get_admin_dashboard_metrics') || err.code === '42883'
							? 'Run the latest database migration (get_admin_dashboard_metrics).'
							: `Could not load dashboard metrics. ${rawMsg}`,
					variant: 'destructive',
				});
			}
			setStats(null);
		} finally {
			if (!silent) setLoading(false);
		}
	}, [dateRange, branchId, officerId, toast]);

	const fetchWalletSnap = useCallback(
		async (opts = {}) => {
			const silent = opts.silent === true;
			if (!dateRange?.to || officers.length === 0) {
				setWalletSnap(null);
				return;
			}
			if (!silent) setWalletSnapLoading(true);
			try {
				const snap = await fetchAdminFieldWalletSnapshot(supabase, walletFocusDate, officersInScope);
				setWalletSnap(snap);
			} catch (e) {
				console.warn('fetchAdminFieldWalletSnapshot', e);
				if (!silent) {
					toast({
						title: 'Field wallet snapshot failed',
						description: e?.message || 'Could not load withdraw status. Check connection and migrations.',
						variant: 'destructive',
					});
				}
				setWalletSnap(null);
			} finally {
				if (!silent) setWalletSnapLoading(false);
			}
		},
		[walletFocusDate, officersInScope, officers.length, dateRange?.to, toast]
	);

	useEffect(() => {
		fetchDashboardData();
	}, [fetchDashboardData]);

	useEffect(() => {
		fetchWalletSnap();
	}, [fetchWalletSnap]);

	useDashboardRealtimeRefresh(
		useCallback(() => {
			fetchDashboardData({ silent: true });
			fetchWalletSnap({ silent: true });
		}, [fetchDashboardData, fetchWalletSnap]),
		{
			enabled: Boolean(dateRange?.from && dateRange?.to),
			officerIdEq: officerId || null,
		}
	);

	const formatCurrency = (value) => {
		const number = Number(value || 0);
		return `${currency} ${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	};

	const openMetric = (metricKey, drillParams = {}) => {
		const start = format(dateRange.from, 'yyyy-MM-dd');
		const end = format(dateRange.to, 'yyyy-MM-dd');
		const q = new URLSearchParams({ start, end });
		if (branchId) q.set('branch', branchId);
		if (officerId) q.set('officer', officerId);
		if (drillParams.days != null) q.set('days', String(drillParams.days));
		navigate(`/admin/dashboard/metrics/${metricKey}?${q.toString()}`);
	};

	const withFilterQuery = (path) => {
		const q = new URLSearchParams();
		if (branchId) q.set('branch', branchId);
		if (officerId) q.set('officer', officerId);
		const qs = q.toString();
		return qs ? `${path}?${qs}` : path;
	};

	const navigatePath = (path) => {
		if (path === '/admin/field-wallet-trace') {
			const q = new URLSearchParams({ date: walletFocusDate });
			if (branchId) q.set('branch', branchId);
			if (officerId) q.set('officer', officerId);
			navigate(`/admin/field-wallet-trace?${q.toString()}`);
			return;
		}
		navigate(withFilterQuery(path));
	};

	const toggleCard = (id) => {
		setExpandedCardId((prev) => (prev === id ? null : id));
	};

	const quickActions = [
		{ title: 'Manage Branches', icon: Building, description: 'Add or edit company branches', path: '/admin/branches' },
		{ title: 'Manage Users', icon: Users, description: 'Add or manage system users', path: '/admin/users' },
		{ title: 'Data history & audit', icon: FileQuestion, description: 'Deleted loans/repayments and activity log', path: '/admin/data-history' },
		{ title: 'Activity log', icon: ScrollText, description: 'User actions, IP and device (admin only)', path: '/admin/audit-logs' },
	];

	const s = stats || {};

	const pct = (part, total) => {
		const p = Number(part) || 0;
		const t = Number(total) || 0;
		if (t <= 0) return 0;
		return Math.min(100, Math.round((p / t) * 100));
	};

	const portfolioTotal = Number(s.portfolio_general) || 0;

	/** Same day-level KPIs as loan officer dashboard; totals follow branch / officer filters. */
	const dailyFocusCards = useMemo(() => {
		const z = stats || {};
		const fc = (v) =>
			`${currency} ${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
		return [
			{
				id: 'df_disb',
				title: 'Today disbursements',
				value: fc(z.disbursed_today ?? 0),
				icon: TrendingUp,
				shell: CARD_SHELLS[3],
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
				shell: CARD_SHELLS[2],
				progressPct: 0,
				subItems: [{ label: 'View borrowers', path: '/admin/borrowers', key: 'df-cli-bor' }],
			},
			{
				id: 'df_coll',
				title: 'Today collection',
				value: fc(z.collected_today ?? 0),
				icon: Banknote,
				shell: CARD_SHELLS[4],
				progressPct: 0,
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
				shell: CARD_SHELLS[10],
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
				shell: CARD_SHELLS[11],
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
				icon: User,
				shell: CARD_SHELLS[0],
				progressPct: 0,
				subItems: [
					{ label: 'View all borrowers', path: '/admin/borrowers', key: 'df-bor-path' },
					{
						label: 'Drilldown — borrowers in scope',
						metricKey: DRILLDOWN_METRICS.my_borrowers,
						key: 'df-bor-drill',
					},
				],
			},
		];
	}, [stats, currency]);

	/** End date of the dashboard range = single “trace day” for field wallet (same formula as officer Field wallet). */
	const fieldWalletCards = useMemo(() => {
		const net = walletSnap?.totalNetDeposit ?? 0;
		const wo = walletSnap?.withdrawnOfficerCount ?? 0;
		const oc = walletSnap?.officerCount ?? 0;
		const fc = (v) =>
			`${currency} ${Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
		return [
			{
				id: 'fw_net',
				title: 'Field wallet — net deposit',
				value: walletSnapLoading ? '…' : fc(net),
				icon: Wallet,
				shell: CARD_SHELLS[12],
				progressPct: 0,
				subItems: [
					{
						label: `Open trace (${walletFocusDate})`,
						path: '/admin/field-wallet-trace',
						key: 'fw-tr',
					},
				],
			},
			{
				id: 'fw_withdraw',
				title: 'Withdrawn to bank',
				value: walletSnapLoading ? '…' : oc === 0 ? '0 officers' : `${wo} / ${oc} officers`,
				icon: Landmark,
				shell: CARD_SHELLS[13],
				progressPct: oc > 0 ? Math.min(100, Math.round((wo / oc) * 100)) : 0,
				subItems: [
					{
						label: 'Open trace (who banked, timestamps)',
						path: '/admin/field-wallet-trace',
						key: 'fw-w',
					},
				],
			},
		];
	}, [walletSnap, walletSnapLoading, walletFocusDate, currency]);

	const metricCards = [
		{
			id: 'borrowers',
			title: 'Total Borrowers',
			value: String(s.total_borrowers ?? 0),
			icon: User,
			shell: CARD_SHELLS[0],
			progressPct: pct(s.total_borrowers, 5000),
			subItems: [
				{ label: 'View all borrowers', path: '/admin/borrowers', key: 'b-all' },
				{ label: 'History & audit', path: '/admin/data-history', key: 'b-lr' },
			],
		},
		{
			id: 'active_loans',
			title: 'Active Loans',
			value: String(s.active_loans_count ?? 0),
			icon: Briefcase,
			shell: CARD_SHELLS[1],
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
			title: 'Total Portfolio',
			value: formatCurrency(s.portfolio_general),
			icon: PiggyBank,
			shell: CARD_SHELLS[2],
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
			shell: CARD_SHELLS[3],
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
			shell: CARD_SHELLS[4],
			progressPct: pct(s.collected_month_principal, s.collected_month_total),
			subItems: [
				{
					label: 'Principal',
					value: formatCurrency(s.collected_month_principal),
					metricKey: DRILLDOWN_METRICS.collected_month_principal,
					key: 'pc-p',
				},
				{
					label: 'Interest',
					value: formatCurrency(s.collected_month_interest),
					metricKey: DRILLDOWN_METRICS.collected_month_interest,
					key: 'pc-i',
				},
				{
					label: 'Total (P+I)',
					value: formatCurrency(s.collected_month_total),
					metricKey: DRILLDOWN_METRICS.collected_month_total,
					key: 'pc-t',
				},
			],
		},
		{
			id: 'interest_collected',
			title: 'Interest Collected',
			value: formatCurrency(s.collected_month_interest),
			icon: CircleDollarSign,
			shell: CARD_SHELLS[5],
			progressPct: pct(s.collected_month_interest, s.collected_month_total),
			subItems: [
				{
					label: 'Principal',
					value: formatCurrency(s.collected_month_principal),
					metricKey: DRILLDOWN_METRICS.collected_month_principal,
					key: 'ic-p',
				},
				{
					label: 'Interest',
					value: formatCurrency(s.collected_month_interest),
					metricKey: DRILLDOWN_METRICS.collected_month_interest,
					key: 'ic-i',
				},
				{
					label: 'Total (P+I)',
					value: formatCurrency(s.collected_month_total),
					metricKey: DRILLDOWN_METRICS.collected_month_total,
					key: 'ic-t',
				},
			],
		},
		{
			id: 'outstanding_principal',
			title: 'Outstanding Principal',
			value: formatCurrency(s.outstanding_principal),
			icon: Landmark,
			shell: CARD_SHELLS[6],
			progressPct: pct(s.outstanding_principal, s.outstanding_total),
			subItems: [
				{
					label: 'Principal',
					value: formatCurrency(s.outstanding_principal),
					metricKey: DRILLDOWN_METRICS.outstanding_principal,
					key: 'op-p',
				},
				{
					label: 'Interest',
					value: formatCurrency(s.outstanding_interest),
					metricKey: DRILLDOWN_METRICS.outstanding_interest,
					key: 'op-i',
				},
				{
					label: 'Total (P+I)',
					value: formatCurrency(s.outstanding_total),
					metricKey: DRILLDOWN_METRICS.outstanding_total,
					key: 'op-t',
				},
			],
		},
		{
			id: 'outstanding_interest',
			title: 'Outstanding Interest',
			value: formatCurrency(s.outstanding_interest),
			icon: Wallet,
			shell: CARD_SHELLS[7],
			progressPct: pct(s.outstanding_interest, s.outstanding_total),
			subItems: [
				{
					label: 'Principal',
					value: formatCurrency(s.outstanding_principal),
					metricKey: DRILLDOWN_METRICS.outstanding_principal,
					key: 'oi-p',
				},
				{
					label: 'Interest',
					value: formatCurrency(s.outstanding_interest),
					metricKey: DRILLDOWN_METRICS.outstanding_interest,
					key: 'oi-i',
				},
				{
					label: 'Total (P+I)',
					value: formatCurrency(s.outstanding_total),
					metricKey: DRILLDOWN_METRICS.outstanding_total,
					key: 'oi-t',
				},
			],
		},
		{
			id: 'defaulted_principal',
			title: 'Defaulted Principal',
			value: formatCurrency(s.default_disbursed_principal),
			icon: AlertTriangle,
			shell: CARD_SHELLS[8],
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
			shell: CARD_SHELLS[9],
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
			shell: CARD_SHELLS[10],
			progressPct: pct(s.expected_today, s.collected_month_total),
			subItems: [
				{
					label: 'Due today (installments)',
					value: formatCurrency(s.expected_today ?? 0),
					metricKey: DRILLDOWN_METRICS.expected_today,
					key: 'ex-t',
				},
				{
					label: 'Repayments this month',
					value: formatCurrency(s.collected_month_total),
					metricKey: DRILLDOWN_METRICS.collected_month_total,
					key: 'ex-r',
				},
			],
		},
		{
			id: 'expected_tomorrow',
			title: 'Projected Tomorrow',
			value: formatCurrency(s.expected_tomorrow ?? 0),
			icon: Sunrise,
			shell: CARD_SHELLS[11],
			progressPct: pct(s.expected_tomorrow, s.expected_today),
			subItems: [
				{
					label: 'Due tomorrow (installments)',
					value: formatCurrency(s.expected_tomorrow ?? 0),
					metricKey: DRILLDOWN_METRICS.expected_tomorrow,
					key: 'ex-tm',
				},
				{
					label: 'Due today (compare)',
					value: formatCurrency(s.expected_today ?? 0),
					metricKey: DRILLDOWN_METRICS.expected_today,
					key: 'ex-tm-cmp',
				},
			],
		},
		{
			id: 'nearing_completion',
			title: 'Nearing loan completion',
			value: String(s.nearing_completion ?? 0),
			icon: Target,
			shell: CARD_SHELLS[11],
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
			shell: CARD_SHELLS[12],
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
			id: 'branches',
			title: 'Total Branches',
			value: String(s.total_branches ?? 0),
			icon: Building2,
			shell: CARD_SHELLS[13],
			progressPct: pct(s.total_branches, 20),
			subItems: [
				{ label: 'Branch management', path: '/admin/branches', key: 'br-m' },
				{ label: 'System settings', path: '/admin/settings', key: 'br-s' },
			],
		},
		{
			id: 'users',
			title: 'Total Users',
			value: String(s.total_users ?? 0),
			icon: Users2,
			shell: CARD_SHELLS[14],
			progressPct: pct(s.total_users, 100),
			subItems: [
				{ label: 'User management', path: '/admin/users', key: 'u-m' },
				{ label: 'Officer reassignment', path: '/admin/reassignment', key: 'u-r' },
			],
		},
	];

	return (
		<DashboardLayout title="Admin Dashboard">
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

						<div className="w-full min-w-[200px] sm:w-[220px]">
							<p className="mb-1.5 text-xs font-medium text-neutral-500">Branch</p>
							<SearchableSelect
								value={branchId || 'all'}
								onValueChange={(v) => {
									const next = v === 'all' ? '' : v;
									setBranchId(next);
									setOfficerId('');
									persistQuery({ branchId: next, officerId: '' });
								}}
								options={adminDashBranchOptions}
								allLabel="All branches"
								allValue="all"
								placeholder="All branches"
								searchPlaceholder="Search branches…"
								emptyText="No branch found."
								triggerClassName="w-full"
							/>
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
								options={adminDashOfficerOptions}
								allLabel="All officers"
								allValue="all"
								placeholder="All officers"
								searchPlaceholder="Search officers…"
								emptyText="No officer found."
								triggerClassName="w-full"
							/>
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
						<div className="space-y-2">
							<h3 className="font-display text-sm font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
								Today&apos;s portfolio focus
							</h3>
							<p className="text-xs text-neutral-500 dark:text-neutral-400">
								Day-level metrics (same as loan officer cards). Branch and officer filters above apply. Expand a card for
								the drilldown list.
							</p>
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
								Field wallet (officers)
							</h3>
							<p className="text-xs text-neutral-500 dark:text-neutral-400">
								Net deposit and “withdrawn to bank” for the calendar day matching the <strong>end</strong> of your date
								range ({walletFocusDate}), with branch and officer filters above.
							</p>
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-2 lg:max-w-3xl">
								{fieldWalletCards.map((c) => {
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

export default AdminDashboard;
