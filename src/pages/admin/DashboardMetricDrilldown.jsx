import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams, useLocation } from 'react-router-dom';
import { format, parseISO } from 'date-fns';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { supabase } from '@/lib/customSupabaseClient';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useToast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from '@/components/ui/table';
import { Loader2, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { METRIC_TITLES } from '@/lib/dashboardMetrics';

const PAGE_SIZE = 25;

const DashboardMetricDrilldown = () => {
	const { metricKey } = useParams();
	const [searchParams] = useSearchParams();
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

	const isManagerRoute = location.pathname.startsWith('/manager');
	const isOfficerRoute = location.pathname.startsWith('/officer');

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

	const startStr = searchParams.get('start') || format(new Date(new Date().getFullYear(), new Date().getMonth(), 1), 'yyyy-MM-dd');
	const endStr = searchParams.get('end') || format(new Date(), 'yyyy-MM-dd');
	const branchFromUrl = searchParams.get('branch') || '';
	const officerFromUrl = searchParams.get('officer') || '';

	/** Manager: branch from profile; admin: branch from URL; officer: branch from profile (never trust URL for scope). */
	const branchId = isOfficerRoute
		? officerBranchId
		: isManagerRoute && managerBranchId
			? managerBranchId
			: branchFromUrl;
	/** Officer drilldown is always scoped to the signed-in user (ignore query tampering). */
	const officerId = isOfficerRoute ? user?.id || '' : officerFromUrl;

	const title = METRIC_TITLES[metricKey] || 'Dashboard details';

	const fetchRows = useCallback(async () => {
		if (!metricKey) return;
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
			const { data, error } = await supabase.rpc('get_admin_dashboard_drilldown', {
				p_metric: metricKey,
				p_start_date: startStr,
				p_end_date: endStr,
				p_limit: PAGE_SIZE,
				p_offset: offset,
				p_branch_id: branchId || null,
				p_officer_id: officerId || null,
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
	}, [metricKey, startStr, endStr, branchId, officerId, page, toast, isManagerRoute, managerBranchId, isOfficerRoute, user?.id]);

	useEffect(() => {
		setPage(1);
	}, [metricKey, startStr, endStr, branchId, officerId, isManagerRoute, managerBranchId, isOfficerRoute, user?.id]);

	useEffect(() => {
		fetchRows();
	}, [fetchRows]);

	const formatMoney = (v) => {
		const n = Number(v || 0);
		return `${currency} ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
	};

	const formatCell = (key, val) => {
		if (val === null || val === undefined) return '—';
		if (typeof val === 'number' && (key.includes('principal') || key.includes('amount') || key.includes('interest') || key.includes('balance') || key.includes('payable') || key.includes('total'))) {
			return formatMoney(val);
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

	const keys = rows.length > 0 ? Object.keys(rows[0]) : [];
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
							if (!isManagerRoute && !isOfficerRoute && branchFromUrl) q.set('branch', branchFromUrl);
							if (!isOfficerRoute && officerFromUrl) q.set('officer', officerFromUrl);
							if (isOfficerRoute) navigate(`/officer/dashboard?${q.toString()}`);
							else if (isManagerRoute) navigate(`/manager/dashboard?${q.toString()}`);
							else navigate(`/admin/dashboard?${q.toString()}`);
						}}
					>
						{isOfficerRoute ? 'My dashboard' : isManagerRoute ? 'Branch dashboard' : 'Admin dashboard'}
					</Button>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="text-lg">{title}</CardTitle>
						<CardDescription>
							{startStr} → {endStr}
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
							<div className="overflow-x-auto rounded-md border">
								<Table>
									<TableHeader>
										<TableRow>
											{keys.map((k) => (
												<TableHead key={k} className="whitespace-nowrap capitalize">
													{k.replace(/_/g, ' ')}
												</TableHead>
											))}
										</TableRow>
									</TableHeader>
									<TableBody>
										{rows.map((row, i) => (
											<TableRow key={row.id || i}>
												{keys.map((k) => (
													<TableCell key={k} className="whitespace-nowrap max-w-[220px] truncate" title={String(row[k])}>
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
