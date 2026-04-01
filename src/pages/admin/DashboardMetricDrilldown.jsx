import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { Loader2, ArrowLeft, ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { DRILLDOWN_METRICS, METRIC_TITLES } from '@/lib/dashboardMetrics';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { defaultDashboardRange } from '@/components/dashboard/DashboardMetricShell';
import {
	orderDrilldownKeys,
	PORTFOLIO_METRIC_KEYS,
	PORTFOLIO_DRILLDOWN_COLUMNS,
	enrichPortfolioDrilldownRow,
} from '@/lib/drilldownColumnOrder';

const PAGE_SIZE = 25;

const DashboardMetricDrilldown = () => {
	const { metricKey } = useParams();
	const [searchParams, setSearchParams] = useSearchParams();
	const location = useLocation();
	const navigate = useNavigate();
	const { user } = useAuth();
	const { toast } = useToast();
	const [currency, setCurrency] = useState('TZS');
	const [loading, setLoading] = useState(true);
	const [page, setPage] = useState(1);
	const [total, setTotal] = useState(0);
	const [rows, setRows] = useState([]);
	const [managerBranchId, setManagerBranchId] = useState(null);
	const [officerBranchId, setOfficerBranchId] = useState(null);
	const [dateRange, setDateRange] = useState(defaultDashboardRange);
	const [filterBranchId, setFilterBranchId] = useState('');
	const [filterOfficerId, setFilterOfficerId] = useState('');
	const [filterCenterId, setFilterCenterId] = useState('');
	const [filterGroupId, setFilterGroupId] = useState('');
	const [centers, setCenters] = useState([]);
	const [groups, setGroups] = useState([]);
	const [branches, setBranches] = useState([]);
	const [officers, setOfficers] = useState([]);
	const [managerBranchName, setManagerBranchName] = useState('');
	const [nearingDays, setNearingDays] = useState(14);

	const isManagerRoute = location.pathname.startsWith('/manager');
	const isOfficerRoute = location.pathname.startsWith('/officer');
	const isAdminRoute = location.pathname.startsWith('/admin');

	useEffect(() => {
		let cancelled = false;
		if (!isManagerRoute || !user?.id) {
			setManagerBranchId(null);
			return;
		}
		(async () => {
			const { data } = await supabase.from('users').select('branch_id, role').eq('id', user.id).maybeSingle();
			if (cancelled) return;
			if (data?.role === 'manager' && data.branch_id) setManagerBranchId(data.branch_id);
			else setManagerBranchId(null);
		})();
		return () => {
			cancelled = true;
		};
	}, [isManagerRoute, user?.id]);

	useEffect(() => {
		let cancelled = false;
		if (!isOfficerRoute || !user?.id) {
			setOfficerBranchId(null);
			return;
		}
		(async () => {
			const { data } = await supabase.from('users').select('branch_id, role').eq('id', user.id).maybeSingle();
			if (cancelled) return;
			if (data?.role === 'officer') setOfficerBranchId(data.branch_id ?? null);
			else setOfficerBranchId(null);
		})();
		return () => {
			cancelled = true;
		};
	}, [isOfficerRoute, user?.id]);

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
		if (isAdminRoute) {
			setFilterBranchId(searchParams.get('branch') || '');
			setFilterOfficerId(searchParams.get('officer') || '');
		} else if (isManagerRoute) {
			setFilterOfficerId(searchParams.get('officer') || '');
		}
		setFilterCenterId(searchParams.get('center') || '');
		setFilterGroupId(searchParams.get('group') || '');
	}, [searchParams, isAdminRoute, isManagerRoute]);

	useEffect(() => {
		if (metricKey !== DRILLDOWN_METRICS.nearing_completion) return;
		const nd = parseInt(searchParams.get('days') || '14', 10);
		if (!Number.isNaN(nd) && nd >= 1 && nd <= 365) setNearingDays(nd);
	}, [searchParams, metricKey]);

	useEffect(() => {
		if (!isAdminRoute) return;
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
	}, [isAdminRoute]);

	useEffect(() => {
		if (!isManagerRoute || !managerBranchId) return;
		let cancelled = false;
		(async () => {
			const [{ data: br }, { data: of }] = await Promise.all([
				supabase.from('branches').select('name').eq('id', managerBranchId).maybeSingle(),
				supabase
					.from('users')
					.select('id, full_name, branch_id')
					.eq('role', 'officer')
					.eq('branch_id', managerBranchId)
					.order('full_name'),
			]);
			if (cancelled) return;
			setManagerBranchName(br?.name || '');
			setOfficers(of || []);
		})();
		return () => {
			cancelled = true;
		};
	}, [isManagerRoute, managerBranchId]);

	/** Centers for selected officer (admin/manager) or signed-in officer (officer route). */
	useEffect(() => {
		let cancelled = false;
		(async () => {
			if (isOfficerRoute && user?.id) {
				let q = supabase.from('centers').select('id, name').eq('loan_officer_id', user.id).order('name');
				if (officerBranchId) q = q.eq('branch_id', officerBranchId);
				const { data } = await q;
				if (!cancelled) setCenters(data || []);
				return;
			}
			if (!filterOfficerId || (!isAdminRoute && !isManagerRoute)) {
				if (!cancelled) setCenters([]);
				return;
			}
			let q = supabase.from('centers').select('id, name').eq('loan_officer_id', filterOfficerId).order('name');
			if (isAdminRoute && filterBranchId) q = q.eq('branch_id', filterBranchId);
			if (isManagerRoute && managerBranchId) q = q.eq('branch_id', managerBranchId);
			const { data } = await q;
			if (!cancelled) setCenters(data || []);
		})();
		return () => {
			cancelled = true;
		};
	}, [
		isOfficerRoute,
		user?.id,
		officerBranchId,
		filterOfficerId,
		isAdminRoute,
		isManagerRoute,
		filterBranchId,
		managerBranchId,
	]);

	/** Groups for selected center. */
	useEffect(() => {
		let cancelled = false;
		(async () => {
			if (!filterCenterId) {
				if (!cancelled) setGroups([]);
				return;
			}
			const { data } = await supabase.from('groups').select('id, name').eq('center_id', filterCenterId).order('name');
			if (!cancelled) setGroups(data || []);
		})();
		return () => {
			cancelled = true;
		};
	}, [filterCenterId]);

	const persistQuery = useCallback(
		(updates) => {
			const next = new URLSearchParams(searchParams);
			if (updates.range?.from && updates.range?.to) {
				next.set('start', format(updates.range.from, 'yyyy-MM-dd'));
				next.set('end', format(updates.range.to, 'yyyy-MM-dd'));
			}
			if (isAdminRoute) {
				if ('branchId' in updates) {
					if (updates.branchId) next.set('branch', updates.branchId);
					else next.delete('branch');
				}
				if ('officerId' in updates) {
					if (updates.officerId) next.set('officer', updates.officerId);
					else next.delete('officer');
				}
				if ('centerId' in updates) {
					if (updates.centerId) next.set('center', updates.centerId);
					else next.delete('center');
				}
				if ('groupId' in updates) {
					if (updates.groupId) next.set('group', updates.groupId);
					else next.delete('group');
				}
			}
			if (isManagerRoute) {
				if ('officerId' in updates) {
					if (updates.officerId) next.set('officer', updates.officerId);
					else next.delete('officer');
				}
				if ('centerId' in updates) {
					if (updates.centerId) next.set('center', updates.centerId);
					else next.delete('center');
				}
				if ('groupId' in updates) {
					if (updates.groupId) next.set('group', updates.groupId);
					else next.delete('group');
				}
			}
			if (isOfficerRoute) {
				if ('centerId' in updates) {
					if (updates.centerId) next.set('center', updates.centerId);
					else next.delete('center');
				}
				if ('groupId' in updates) {
					if (updates.groupId) next.set('group', updates.groupId);
					else next.delete('group');
				}
			}
			if ('days' in updates) {
				if (updates.days != null && updates.days !== '') next.set('days', String(updates.days));
				else next.delete('days');
			}
			setSearchParams(next, { replace: true });
		},
		[searchParams, setSearchParams, isAdminRoute, isManagerRoute, isOfficerRoute]
	);

	const officersForBranch = useMemo(() => {
		if (!filterBranchId) return officers;
		return officers.filter((o) => o.branch_id === filterBranchId);
	}, [officers, filterBranchId]);

	useEffect(() => {
		if (!isAdminRoute) return;
		if (!filterOfficerId || !filterBranchId) return;
		const o = officers.find((x) => x.id === filterOfficerId);
		if (o && o.branch_id !== filterBranchId) setFilterOfficerId('');
	}, [isAdminRoute, filterBranchId, filterOfficerId, officers]);

	/** Manager: branch from profile; admin: filter; officer: branch from profile (never trust URL for scope). */
	const branchIdForRpc = isOfficerRoute
		? officerBranchId
		: isManagerRoute && managerBranchId
			? managerBranchId
			: filterBranchId;
	/** Officer drilldown is always scoped to the signed-in user (ignore query tampering). */
	const officerIdForRpc = isOfficerRoute ? user?.id || '' : filterOfficerId;

	const startStr = dateRange?.from ? format(dateRange.from, 'yyyy-MM-dd') : format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd');
	const endStr = dateRange?.to ? format(dateRange.to, 'yyyy-MM-dd') : format(new Date(), 'yyyy-MM-dd');

	const title = METRIC_TITLES[metricKey] || 'Dashboard details';

	const fetchRows = useCallback(async () => {
		if (!metricKey) return;
		if (!dateRange?.from || !dateRange?.to) {
			setRows([]);
			setTotal(0);
			setLoading(false);
			return;
		}
		if (isManagerRoute && !managerBranchId) {
			setRows([]);
			setTotal(0);
			setLoading(false);
			return;
		}
		if (isOfficerRoute && !user?.id) {
			setRows([]);
			setTotal(0);
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			const { data: configData } = await supabase.from('system_config').select('value').eq('key', 'currency').single();
			if (configData?.value) setCurrency(configData.value);

			const offset = (page - 1) * PAGE_SIZE;
			const horizon =
				metricKey === DRILLDOWN_METRICS.nearing_completion
					? Math.min(365, Math.max(1, nearingDays))
					: 14;
			const { data, error } = await supabase.rpc('get_admin_dashboard_drilldown', {
				p_metric: metricKey,
				p_start_date: startStr,
				p_end_date: endStr,
				p_limit: PAGE_SIZE,
				p_offset: offset,
				p_branch_id: branchIdForRpc || null,
				p_officer_id: officerIdForRpc || null,
				p_nearing_days: horizon,
				p_center_id: filterCenterId || null,
				p_group_id: filterGroupId || null,
			});

			if (error) throw error;

			let payload = data;
			if (typeof data === 'string') {
				try {
					payload = JSON.parse(data);
				} catch {
					payload = {};
				}
			}
			if (payload?.error === 'unknown_metric') {
				toast({ title: 'Unknown metric', variant: 'destructive' });
				setRows([]);
				setTotal(0);
				return;
			}
			setTotal(Number(payload?.total || 0));
			const r = payload?.rows;
			setRows(Array.isArray(r) ? r : r ? [r] : []);
		} catch (e) {
			console.error(e);
			toast({
				title: 'Could not load details',
				description: e.message || 'Try again or run the latest database migration.',
				variant: 'destructive',
			});
			setRows([]);
			setTotal(0);
		} finally {
			setLoading(false);
		}
	}, [
		metricKey,
		startStr,
		endStr,
		branchIdForRpc,
		officerIdForRpc,
		page,
		toast,
		isManagerRoute,
		managerBranchId,
		isOfficerRoute,
		user?.id,
		dateRange?.from,
		dateRange?.to,
		nearingDays,
		filterCenterId,
		filterGroupId,
	]);

	useEffect(() => {
		setPage(1);
	}, [
		metricKey,
		startStr,
		endStr,
		branchIdForRpc,
		officerIdForRpc,
		isManagerRoute,
		managerBranchId,
		isOfficerRoute,
		user?.id,
		nearingDays,
		filterCenterId,
		filterGroupId,
	]);

	useEffect(() => {
		fetchRows();
	}, [fetchRows]);

	const formatMoney = (v) => {
		const n = Number(v || 0);
		return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	};

	const formatCell = (key, val) => {
		if (val === null || val === undefined) return '—';
		if (key === 'days_to_final_due' || key === 'remaining_installments') {
			return typeof val === 'number' ? String(val) : String(val ?? '—');
		}
		if (key === 'product_interest_rate' && typeof val === 'number') {
			return `${Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}%`;
		}
		if (typeof val === 'number') {
			const k = key.toLowerCase();
			const moneyLike =
				/(principal|amount|interest|balance|payable|total|collected|disbursed|due_today|embedded|expected|outstanding|default|_paid|paid)/.test(
					k
				) && !k.includes('interest_rate');
			if (moneyLike) return formatMoney(val);
			return String(val);
		}
		if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val)) {
			try {
				return format(parseISO(val), 'MMM d, yyyy');
			} catch {
				return val;
			}
		}
		return String(val);
	};

	const displayRows = useMemo(() => {
		if (!PORTFOLIO_METRIC_KEYS.has(metricKey)) return rows;
		return rows.map(enrichPortfolioDrilldownRow);
	}, [rows, metricKey]);

	const keys = useMemo(() => {
		if (rows.length === 0) return [];
		if (PORTFOLIO_METRIC_KEYS.has(metricKey)) return PORTFOLIO_DRILLDOWN_COLUMNS;
		return orderDrilldownKeys(Object.keys(rows[0]));
	}, [rows, metricKey]);

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

	return (
		<DashboardLayout title={title}>
			<div className="space-y-4">
				<div className="flex flex-wrap items-center gap-3">
					<Button variant="outline" size="sm" onClick={() => navigate(-1)} className="gap-2">
						<ArrowLeft className="h-4 w-4" />
						Back
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							const q = new URLSearchParams({ start: startStr, end: endStr });
							if (isAdminRoute) {
								if (filterBranchId) q.set('branch', filterBranchId);
								if (filterOfficerId) q.set('officer', filterOfficerId);
								if (filterCenterId) q.set('center', filterCenterId);
								if (filterGroupId) q.set('group', filterGroupId);
							}
							if (isManagerRoute) {
								if (filterOfficerId) q.set('officer', filterOfficerId);
								if (filterCenterId) q.set('center', filterCenterId);
								if (filterGroupId) q.set('group', filterGroupId);
							}
							if (isOfficerRoute) {
								if (filterCenterId) q.set('center', filterCenterId);
								if (filterGroupId) q.set('group', filterGroupId);
							}
							if (isOfficerRoute) navigate(`/officer/dashboard?${q.toString()}`);
							else if (isManagerRoute) navigate(`/manager/dashboard?${q.toString()}`);
							else navigate(`/admin/dashboard?${q.toString()}`);
						}}
					>
						{isOfficerRoute ? 'My dashboard' : isManagerRoute ? 'Branch dashboard' : 'Admin dashboard'}
					</Button>
				</div>

				<div className="flex flex-col gap-3 rounded-xl border bg-white p-4 shadow-sm lg:flex-row lg:flex-wrap lg:items-end dark:bg-card">
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

						{metricKey === DRILLDOWN_METRICS.nearing_completion && (
							<div className="w-full min-w-[200px] sm:w-[220px]">
								<p className="mb-1.5 text-xs font-medium text-neutral-500">Final payment within</p>
								<Select
									value={String(nearingDays)}
									onValueChange={(v) => {
										const n = Math.min(365, Math.max(1, parseInt(v, 10) || 14));
										setNearingDays(n);
										persistQuery({ days: n });
									}}
								>
									<SelectTrigger>
										<SelectValue placeholder="Days" />
									</SelectTrigger>
									<SelectContent>
										{[3, 7, 10, 14, 21, 30, 45, 60, 90].map((d) => (
											<SelectItem key={d} value={String(d)}>
												{d} days
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}

						{isAdminRoute && (
							<>
								<div className="w-full min-w-[200px] sm:w-[220px]">
									<p className="mb-1.5 text-xs font-medium text-neutral-500">Branch</p>
									<Select
										value={filterBranchId || 'all'}
										onValueChange={(v) => {
											const next = v === 'all' ? '' : v;
											setFilterBranchId(next);
											setFilterOfficerId('');
											setFilterCenterId('');
											setFilterGroupId('');
											persistQuery({ branchId: next, officerId: '', centerId: '', groupId: '' });
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
										value={filterOfficerId || 'all'}
										onValueChange={(v) => {
											const next = v === 'all' ? '' : v;
											setFilterOfficerId(next);
											setFilterCenterId('');
											setFilterGroupId('');
											persistQuery({ officerId: next, centerId: '', groupId: '' });
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
								{filterOfficerId && (
									<>
										<div className="w-full min-w-[200px] sm:w-[220px]">
											<p className="mb-1.5 text-xs font-medium text-neutral-500">Center</p>
											<Select
												value={filterCenterId || 'all'}
												onValueChange={(v) => {
													const next = v === 'all' ? '' : v;
													setFilterCenterId(next);
													setFilterGroupId('');
													persistQuery({ centerId: next, groupId: '' });
												}}
											>
												<SelectTrigger>
													<SelectValue placeholder="All centers" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="all">All centers</SelectItem>
													{centers.map((c) => (
														<SelectItem key={c.id} value={c.id}>
															{c.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										<div className="w-full min-w-[200px] sm:w-[220px]">
											<p className="mb-1.5 text-xs font-medium text-neutral-500">Group</p>
											<Select
												value={filterGroupId || 'all'}
												disabled={!filterCenterId}
												onValueChange={(v) => {
													const next = v === 'all' ? '' : v;
													setFilterGroupId(next);
													persistQuery({ groupId: next });
												}}
											>
												<SelectTrigger>
													<SelectValue placeholder={filterCenterId ? 'All groups' : 'Pick a center first'} />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="all">All groups</SelectItem>
													{groups.map((g) => (
														<SelectItem key={g.id} value={g.id}>
															{g.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</>
								)}
								{(filterBranchId || filterOfficerId || filterCenterId || filterGroupId) && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="text-neutral-600"
										onClick={() => {
											setFilterBranchId('');
											setFilterOfficerId('');
											setFilterCenterId('');
											setFilterGroupId('');
											persistQuery({ branchId: '', officerId: '', centerId: '', groupId: '' });
										}}
									>
										Clear filters
									</Button>
								)}
							</>
						)}

						{isManagerRoute && managerBranchId && (
							<>
								<div className="w-full min-w-[200px] sm:w-[220px]">
									<p className="mb-1.5 text-xs font-medium text-neutral-500">Branch</p>
									<p className="rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900/40 dark:text-neutral-100">
										{managerBranchName || 'Your branch'}
									</p>
								</div>
								<div className="w-full min-w-[200px] sm:w-[220px]">
									<p className="mb-1.5 text-xs font-medium text-neutral-500">Loan officer</p>
									<Select
										value={filterOfficerId || 'all'}
										onValueChange={(v) => {
											const next = v === 'all' ? '' : v;
											setFilterOfficerId(next);
											setFilterCenterId('');
											setFilterGroupId('');
											persistQuery({ officerId: next, centerId: '', groupId: '' });
										}}
									>
										<SelectTrigger>
											<SelectValue placeholder="All officers" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="all">All officers</SelectItem>
											{officers.map((o) => (
												<SelectItem key={o.id} value={o.id}>
													{o.full_name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								{filterOfficerId && (
									<>
										<div className="w-full min-w-[200px] sm:w-[220px]">
											<p className="mb-1.5 text-xs font-medium text-neutral-500">Center</p>
											<Select
												value={filterCenterId || 'all'}
												onValueChange={(v) => {
													const next = v === 'all' ? '' : v;
													setFilterCenterId(next);
													setFilterGroupId('');
													persistQuery({ centerId: next, groupId: '' });
												}}
											>
												<SelectTrigger>
													<SelectValue placeholder="All centers" />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="all">All centers</SelectItem>
													{centers.map((c) => (
														<SelectItem key={c.id} value={c.id}>
															{c.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
										<div className="w-full min-w-[200px] sm:w-[220px]">
											<p className="mb-1.5 text-xs font-medium text-neutral-500">Group</p>
											<Select
												value={filterGroupId || 'all'}
												disabled={!filterCenterId}
												onValueChange={(v) => {
													const next = v === 'all' ? '' : v;
													setFilterGroupId(next);
													persistQuery({ groupId: next });
												}}
											>
												<SelectTrigger>
													<SelectValue placeholder={filterCenterId ? 'All groups' : 'Pick a center first'} />
												</SelectTrigger>
												<SelectContent>
													<SelectItem value="all">All groups</SelectItem>
													{groups.map((g) => (
														<SelectItem key={g.id} value={g.id}>
															{g.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									</>
								)}
								{(filterOfficerId || filterCenterId || filterGroupId) && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="text-neutral-600"
										onClick={() => {
											setFilterOfficerId('');
											setFilterCenterId('');
											setFilterGroupId('');
											persistQuery({ officerId: '', centerId: '', groupId: '' });
										}}
									>
										Clear officer &amp; location
									</Button>
								)}
							</>
						)}

						{isOfficerRoute && (
							<>
								<div className="w-full min-w-[200px] sm:w-[220px]">
									<p className="mb-1.5 text-xs font-medium text-neutral-500">Center</p>
									<Select
										value={filterCenterId || 'all'}
										onValueChange={(v) => {
											const next = v === 'all' ? '' : v;
											setFilterCenterId(next);
											setFilterGroupId('');
											persistQuery({ centerId: next, groupId: '' });
										}}
									>
										<SelectTrigger>
											<SelectValue placeholder="All centers" />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="all">All centers</SelectItem>
											{centers.map((c) => (
												<SelectItem key={c.id} value={c.id}>
													{c.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								<div className="w-full min-w-[200px] sm:w-[220px]">
									<p className="mb-1.5 text-xs font-medium text-neutral-500">Group</p>
									<Select
										value={filterGroupId || 'all'}
										disabled={!filterCenterId}
										onValueChange={(v) => {
											const next = v === 'all' ? '' : v;
											setFilterGroupId(next);
											persistQuery({ groupId: next });
										}}
									>
										<SelectTrigger>
											<SelectValue placeholder={filterCenterId ? 'All groups' : 'Pick a center first'} />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="all">All groups</SelectItem>
											{groups.map((g) => (
												<SelectItem key={g.id} value={g.id}>
													{g.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>
								{(filterCenterId || filterGroupId) && (
									<Button
										type="button"
										variant="ghost"
										size="sm"
										className="text-neutral-600"
										onClick={() => {
											setFilterCenterId('');
											setFilterGroupId('');
											persistQuery({ centerId: '', groupId: '' });
										}}
									>
										Clear center / group
									</Button>
								)}
							</>
						)}
					</div>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="text-lg">{title}</CardTitle>
						<CardDescription>
							{startStr} → {endStr}
							{metricKey === DRILLDOWN_METRICS.nearing_completion && (
								<span className="mt-1 block text-neutral-600 dark:text-neutral-400">
									Active loans whose <strong>last scheduled installment</strong> is due between today and the next{' '}
									<strong>{nearingDays}</strong> days.
								</span>
							)}
							{isAdminRoute && (filterBranchId || filterOfficerId || filterCenterId || filterGroupId) && (
								<span className="block text-neutral-600 dark:text-neutral-400">
									{filterBranchId && (
										<>
											Branch: {branches.find((b) => b.id === filterBranchId)?.name || filterBranchId}
										</>
									)}
									{filterBranchId && filterOfficerId && ' · '}
									{filterOfficerId && (
										<>Officer: {officers.find((o) => o.id === filterOfficerId)?.full_name || filterOfficerId}</>
									)}
									{filterCenterId && (
										<>
											{' '}
											· Center: {centers.find((c) => c.id === filterCenterId)?.name || '—'}
										</>
									)}
									{filterGroupId && (
										<>
											{' '}
											· Group: {groups.find((g) => g.id === filterGroupId)?.name || '—'}
										</>
									)}
								</span>
							)}
							{isManagerRoute && (filterOfficerId || filterCenterId || filterGroupId) && (
								<span className="block text-neutral-600 dark:text-neutral-400">
									{filterOfficerId && (
										<>Officer: {officers.find((o) => o.id === filterOfficerId)?.full_name || filterOfficerId}</>
									)}
									{filterCenterId && (
										<>
											{filterOfficerId ? ' · ' : ''}Center: {centers.find((c) => c.id === filterCenterId)?.name || '—'}
										</>
									)}
									{filterGroupId && (
										<>
											{' · '}Group: {groups.find((g) => g.id === filterGroupId)?.name || '—'}
										</>
									)}
								</span>
							)}
							{isOfficerRoute && (filterCenterId || filterGroupId) && (
								<span className="block text-neutral-600 dark:text-neutral-400">
									{filterCenterId && <>Center: {centers.find((c) => c.id === filterCenterId)?.name || '—'}</>}
									{filterGroupId && (
										<>
											{filterCenterId ? ' · ' : ''}Group: {groups.find((g) => g.id === filterGroupId)?.name || '—'}
										</>
									)}
								</span>
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{loading ? (
							<div className="flex justify-center py-16">
								<Loader2 className="h-8 w-8 animate-spin text-brand-gold" />
							</div>
						) : rows.length === 0 ? (
							<p className="text-sm text-neutral-500 py-8 text-center">No rows for this metric.</p>
						) : (
							<div className="overflow-x-auto rounded-md border border-neutral-300 bg-white shadow-sm dark:border-neutral-600 dark:bg-card">
								<Table className="border-collapse text-sm [&_td]:align-middle [&_th]:align-middle">
									<TableHeader className="[&_tr]:border-0">
										<TableRow className="border-0 hover:bg-transparent">
											{keys.map((k) => (
												<TableHead
													key={k}
													className="whitespace-nowrap border border-neutral-300 bg-neutral-100 px-3 py-2 text-left text-xs font-semibold tracking-wide text-neutral-800 capitalize dark:border-neutral-600 dark:bg-neutral-800/70 dark:text-neutral-100"
												>
													{k.replace(/_/g, ' ')}
												</TableHead>
											))}
										</TableRow>
									</TableHeader>
									<TableBody className="[&_tr]:border-0">
										{displayRows.map((row, i) => (
											<TableRow
												key={row.id ?? row.loan_id ?? i}
												className="border-0 odd:bg-white even:bg-neutral-50/80 hover:bg-amber-50/50 dark:odd:bg-card dark:even:bg-neutral-900/40 dark:hover:bg-neutral-800/50"
											>
												{keys.map((k) => (
													<TableCell
														key={k}
														className="whitespace-nowrap border border-neutral-300 px-3 py-2 text-neutral-900 max-w-[220px] truncate dark:border-neutral-600 dark:text-neutral-100"
														title={row[k] != null ? String(row[k]) : ''}
													>
														{formatCell(k, row[k])}
													</TableCell>
												))}
											</TableRow>
										))}
									</TableBody>
								</Table>
							</div>
						)}

						{!loading && total > 0 && (
							<div className="mt-4 flex flex-wrap items-center justify-between gap-4 border-t pt-4">
								<p className="text-sm text-neutral-600">
									Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
								</p>
								<div className="flex items-center gap-2">
									<Button
										variant="outline"
										size="sm"
										disabled={page <= 1}
										onClick={() => setPage((p) => Math.max(1, p - 1))}
									>
										<ChevronLeft className="h-4 w-4" />
									</Button>
									<span className="text-sm text-neutral-600">
										Page {page} / {totalPages}
									</span>
									<Button
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
		</DashboardLayout>
	);
};

export default DashboardMetricDrilldown;
