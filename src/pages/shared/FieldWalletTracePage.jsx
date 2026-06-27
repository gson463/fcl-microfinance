import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { format, startOfDay } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { ArrowLeft, Loader2, Wallet, CalendarIcon, Download, RefreshCw, FlaskConical } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { FieldWalletTraceGrid } from '@/components/admin/FieldWalletTraceGrid';
import { FieldWalletTraceSummaryTable } from '@/components/admin/FieldWalletTraceSummaryTable';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { useAuth } from '@/contexts/SupabaseAuthContext';
import { useUserProfileScope } from '@/hooks/useUserProfileScope';
import { fetchAdminFieldWalletSnapshot } from '@/lib/adminFieldWalletSnapshot';
import { isFieldWalletTraceDummyMode, loadFieldWalletTraceSample } from '@/lib/loadFieldWalletTraceSample';
import { exportObjectsToCsv } from '@/lib/tableExport';

const EAT = 'Africa/Nairobi';

function todayYyyyMmDdEAT() {
	return formatInTimeZone(new Date(), EAT, 'yyyy-MM-dd');
}

/**
 * Field wallet trace — admin (all branches) or manager (fixed branch).
 * @param {{ scopeRole?: 'admin' | 'manager' }} props
 */
export function FieldWalletTracePage({ scopeRole = 'admin' }) {
	const isManager = scopeRole === 'manager';
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const { toast } = useToast();
	const { user } = useAuth();
	const { loading: profileLoading, branchId: managerBranchId, role: profileRole } = useUserProfileScope(user?.id);

	const [currency, setCurrency] = useState('TZS');
	const [applicationFee, setApplicationFee] = useState(0);
	const [branches, setBranches] = useState([]);
	const [officers, setOfficers] = useState([]);
	const [managerBranchName, setManagerBranchName] = useState('');
	const [metaLoading, setMetaLoading] = useState(true);
	const [loading, setLoading] = useState(true);

	const [walletDate, setWalletDate] = useState(() => {
		const d = searchParams.get('date');
		if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
		return todayYyyyMmDdEAT();
	});
	const [branchId, setBranchId] = useState(() => (isManager ? '' : searchParams.get('branch') || ''));
	const [officerId, setOfficerId] = useState(() => searchParams.get('officer') || '');

	const [blocks, setBlocks] = useState([]);
	const [withdrawByOfficer, setWithdrawByOfficer] = useState(() => new Map());
	const [repaymentTotalsByOfficer, setRepaymentTotalsByOfficer] = useState(() => new Map());

	const effectiveBranchId = isManager ? managerBranchId : branchId;

	useEffect(() => {
		const d = searchParams.get('date');
		if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setWalletDate(d);
		if (!isManager) setBranchId(searchParams.get('branch') || '');
		setOfficerId(searchParams.get('officer') || '');
	}, [searchParams, isManager]);

	useEffect(() => {
		if (isManager) return;
		let cancelled = false;
		(async () => {
			setMetaLoading(true);
			const [{ data: br }, { data: of }] = await Promise.all([
				supabase.from('branches').select('id, name').order('name'),
				supabase.from('users').select('id, full_name, branch_id').eq('role', 'officer').order('full_name'),
			]);
			if (!cancelled) {
				setBranches(br || []);
				setOfficers(of || []);
				setMetaLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [isManager]);

	useEffect(() => {
		if (!isManager) return;
		if (profileLoading) return;
		let cancelled = false;
		(async () => {
			setMetaLoading(true);
			if (!managerBranchId || profileRole !== 'manager') {
				if (!cancelled) {
					setBranches([]);
					setOfficers([]);
					setManagerBranchName('');
					setMetaLoading(false);
				}
				return;
			}
			const [{ data: br }, { data: of }] = await Promise.all([
				supabase.from('branches').select('id, name').eq('id', managerBranchId).maybeSingle(),
				supabase
					.from('users')
					.select('id, full_name, branch_id')
					.eq('role', 'officer')
					.eq('branch_id', managerBranchId)
					.order('full_name'),
			]);
			if (!cancelled) {
				setBranches(br ? [br] : []);
				setManagerBranchName(br?.name || 'Your branch');
				setOfficers(of || []);
				setMetaLoading(false);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [isManager, profileLoading, managerBranchId, profileRole]);

	const persistQuery = useCallback(
		(updates) => {
			const next = new URLSearchParams(searchParams);
			if (updates.date) next.set('date', updates.date);
			if (!isManager && 'branch' in updates) {
				if (updates.branch) next.set('branch', updates.branch);
				else next.delete('branch');
			}
			if ('officer' in updates) {
				if (updates.officer) next.set('officer', updates.officer);
				else next.delete('officer');
			}
			setSearchParams(next, { replace: true });
		},
		[searchParams, setSearchParams, isManager]
	);

	const officersInScope = useMemo(() => {
		if (officerId) return officers.filter((o) => o.id === officerId);
		if (effectiveBranchId) return officers.filter((o) => o.branch_id === effectiveBranchId);
		return officers;
	}, [officers, effectiveBranchId, officerId]);

	const officersForBranch = useMemo(() => {
		if (!effectiveBranchId) return officers;
		return officers.filter((o) => o.branch_id === effectiveBranchId);
	}, [officers, effectiveBranchId]);

	const useDummyData = !isManager && isFieldWalletTraceDummyMode(searchParams);

	const fetchData = useCallback(async () => {
		if (isManager && (profileLoading || !managerBranchId)) {
			setLoading(false);
			return;
		}
		setLoading(true);
		try {
			if (useDummyData) {
				const snap = loadFieldWalletTraceSample();
				setCurrency(snap.currency);
				setApplicationFee(snap.applicationFee);
				setBlocks(snap.blocks);
				setWithdrawByOfficer(snap.withdrawByOfficer);
				setRepaymentTotalsByOfficer(snap.repaymentTotalsByOfficer);
				return;
			}
			const snap = await fetchAdminFieldWalletSnapshot(supabase, walletDate, officersInScope);
			setCurrency(snap.currency);
			setApplicationFee(snap.applicationFee);
			setBlocks(snap.blocks);
			setWithdrawByOfficer(snap.withdrawByOfficer);
			setRepaymentTotalsByOfficer(snap.repaymentTotalsByOfficer);
		} catch (e) {
			console.error(e);
			if (isManager) {
				toast({
					title: 'Load failed',
					description: e.message || 'Could not load field wallet trace for your branch.',
					variant: 'destructive',
				});
				setBlocks([]);
				setWithdrawByOfficer(new Map());
				setRepaymentTotalsByOfficer(new Map());
			} else {
				const snap = loadFieldWalletTraceSample();
				setCurrency(snap.currency);
				setApplicationFee(snap.applicationFee);
				setBlocks(snap.blocks);
				setWithdrawByOfficer(snap.withdrawByOfficer);
				setRepaymentTotalsByOfficer(snap.repaymentTotalsByOfficer);
				toast({
					title: 'Using dummy data',
					description: 'Live load failed — showing sample layout (Juma / Asha).',
				});
			}
		} finally {
			setLoading(false);
		}
	}, [walletDate, officersInScope, toast, useDummyData, isManager, profileLoading, managerBranchId]);

	useEffect(() => {
		if (isManager && profileLoading) return;
		fetchData();
	}, [fetchData, isManager, profileLoading]);

	useEffect(() => {
		if (useDummyData) return undefined;
		const ch = supabase
			.channel(`field-wallet-withdraw-${scopeRole}-${walletDate}`)
			.on(
				'postgres_changes',
				{
					event: '*',
					schema: 'public',
					table: 'officer_withdraw_to_bank',
					filter: `business_date=eq.${walletDate}`,
				},
				() => {
					fetchData();
				}
			)
			.subscribe();
		return () => {
			supabase.removeChannel(ch);
		};
	}, [walletDate, fetchData, useDummyData, scopeRole]);

	useEffect(() => {
		const onFocus = () => fetchData();
		window.addEventListener('focus', onFocus);
		return () => window.removeEventListener('focus', onFocus);
	}, [fetchData]);

	const walletDateObj = useMemo(() => {
		const [y, m, d] = walletDate.split('-').map(Number);
		return new Date(y, m - 1, d);
	}, [walletDate]);

	const formatMoney = (n) =>
		`${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	const branchOpts = useMemo(() => branches.map((b) => ({ value: b.id, label: b.name })), [branches]);
	const officerOpts = useMemo(
		() => officersForBranch.map((o) => ({ value: o.id, label: o.full_name || 'Officer' })),
		[officersForBranch]
	);

	const withdrawnCount = useMemo(() => {
		let n = 0;
		for (const block of blocks) {
			if (withdrawByOfficer.has(block.officer.id)) n += 1;
		}
		return n;
	}, [blocks, withdrawByOfficer]);

	const totalWithdrawnAmount = useMemo(() => {
		let s = 0;
		for (const block of blocks) {
			const w = withdrawByOfficer.get(block.officer.id);
			if (!w) continue;
			const raw = Number(block.totals.rawDeposit ?? block.totals.deposit) || 0;
			const banked = w.amount_deposited != null ? Number(w.amount_deposited) : raw;
			s += Number.isNaN(banked) ? raw : banked;
		}
		return s;
	}, [blocks, withdrawByOfficer]);

	const totalNet = useMemo(() => blocks.reduce((s, b) => s + (Number(b.totals.deposit) || 0), 0), [blocks]);

	const branchNameById = useMemo(() => Object.fromEntries((branches || []).map((b) => [b.id, b.name || ''])), [branches]);

	const pendingWithdrawExportRows = useMemo(() => {
		return blocks
			.filter((block) => !withdrawByOfficer.has(block.officer.id))
			.map((block) => {
				const oid = block.officer.id;
				const u = officers.find((o) => o.id === oid);
				const branchName = u?.branch_id ? branchNameById[u.branch_id] || '' : '';
				return {
					officer_name: block.officer.full_name || '—',
					branch: branchName,
					net_deposit: Number(block.totals.rawDeposit ?? block.totals.deposit) || 0,
					business_date: walletDate,
				};
			});
	}, [blocks, withdrawByOfficer, officers, branchNameById, walletDate]);

	const exportReminderList = useCallback(() => {
		if (pendingWithdrawExportRows.length === 0) {
			toast({ title: 'Nothing to export', description: 'All officers in scope have recorded withdraw, or list is empty.', variant: 'destructive' });
			return;
		}
		const columns = [
			{ header: 'Officer name', accessor: 'officer_name' },
			...(isManager ? [] : [{ header: 'Branch', accessor: 'branch' }]),
			{ header: 'Business date', accessor: 'business_date' },
			{
				header: 'Net deposit (computed)',
				accessor: (r) => Number(r.net_deposit).toFixed(2),
			},
		];
		exportObjectsToCsv(`officers-pending-withdraw_${walletDate}.csv`, columns, pendingWithdrawExportRows);
		toast({
			title: 'Exported',
			description: `${pendingWithdrawExportRows.length} officer name(s) — use for reminders.`,
		});
	}, [pendingWithdrawExportRows, walletDate, toast, isManager]);

	const pageTitle = isManager
		? managerBranchName
			? `Field wallet trace — ${managerBranchName}`
			: 'Field wallet trace'
		: 'Field wallet trace';

	const dashboardPath = isManager ? '/manager/dashboard' : '/admin/dashboard';
	const dashboardLabel = isManager ? 'Manager dashboard' : 'Admin dashboard';

	if (isManager && !profileLoading && !managerBranchId) {
		return (
			<DashboardLayout title={pageTitle}>
				<Card>
					<CardHeader>
						<CardTitle>Branch not assigned</CardTitle>
						<CardDescription>
							Your manager account has no branch assigned. Ask an admin to set your branch in User Management, then sign out
							and sign in again.
						</CardDescription>
					</CardHeader>
					<CardContent>
						<Button type="button" variant="outline" onClick={() => navigate(dashboardPath)}>
							<ArrowLeft className="mr-2 h-4 w-4" />
							{dashboardLabel}
						</Button>
					</CardContent>
				</Card>
			</DashboardLayout>
		);
	}

	const showContent = !metaLoading && !(isManager && profileLoading);

	return (
		<DashboardLayout title={pageTitle}>
			<div className="space-y-6">
				<div className="flex flex-wrap items-center gap-3">
					<Button type="button" variant="outline" size="sm" onClick={() => navigate(dashboardPath)}>
						<ArrowLeft className="mr-2 h-4 w-4" />
						{dashboardLabel}
					</Button>
					{!isManager ? (
						<Button type="button" variant="secondary" size="sm" asChild>
							<Link to="/demo/field-wallet-trace">
								<FlaskConical className="mr-2 h-4 w-4" />
								View sample (dummy data)
							</Link>
						</Button>
					) : null}
					<Button type="button" variant="outline" size="sm" onClick={() => fetchData()} disabled={loading || !showContent}>
						{loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
						Refresh status
					</Button>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Wallet className="h-5 w-5 text-brand-gold" />
							Field wallet — full day flow
							{isManager && managerBranchName ? (
								<span className="text-sm font-normal text-muted-foreground">({managerBranchName})</span>
							) : null}
						</CardTitle>
						<CardDescription className="space-y-2 text-sm leading-relaxed">
							<p>
								<strong>What you&apos;re seeing.</strong> This page looks at{' '}
								<strong>one calendar day only</strong> — <strong>{format(walletDateObj, 'MMMM d, yyyy')}</strong>. Each row for
								an officer is <strong>only that day&apos;s activity</strong>. It does <strong>not</strong> include money
								carried forward from previous days or any running balance from before.
							</p>
							{isManager ? (
								<p className="text-muted-foreground">
									Showing loan officers in <strong className="text-foreground">{managerBranchName || 'your branch'}</strong>{' '}
									only.
								</p>
							) : null}
							<ul className="list-disc space-y-1 pl-4 text-muted-foreground">
								<li>
									<strong className="text-foreground">Collections</strong> — all repayments that were{' '}
									<strong>recorded for that officer on this same day</strong>. This should line up with the collections side of
									their daily field wallet (and the “deposit” style total they work with on that day).
								</li>
								<li>
									<strong className="text-foreground">Deposit (the big number)</strong> — in simple terms:{' '}
									<strong>what they took from the office</strong>, <strong>plus collections</strong>,{' '}
									<strong>plus application fees</strong> for loans disbursed that day, <strong>minus</strong> the{' '}
									<strong>loan amounts paid out that day</strong>, <strong>minus</strong> <strong>expenses</strong> (transport
									and other types added together).
								</li>
								<li>
									When it says <strong className="text-foreground">Withdrawn to bank</strong>, the main{' '}
									<strong>Deposit</strong> figure shows <strong>0</strong> because the system treats that day&apos;s cash as{' '}
									<strong>no longer in the officer&apos;s hands</strong> (it&apos;s at the bank). The smaller line underneath
									— <strong>Same day:</strong> — is still the <strong>day&apos;s cash picture before that step</strong>,
									so you can check it against <strong>their report, PDF, or Excel</strong> for the same date.
								</li>
							</ul>
						</CardDescription>
					</CardHeader>
					<CardContent className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
						<Popover>
							<PopoverTrigger asChild>
								<Button variant="outline" className="min-w-[200px] justify-start font-normal">
									<CalendarIcon className="mr-2 h-4 w-4" />
									{format(walletDateObj, 'LLL d, yyyy')}
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-auto p-0" align="start">
								<Calendar
									mode="single"
									selected={walletDateObj}
									onSelect={(d) => {
										if (!d) return;
										const s = format(startOfDay(d), 'yyyy-MM-dd');
										setWalletDate(s);
										persistQuery({ date: s });
									}}
									initialFocus
								/>
							</PopoverContent>
						</Popover>

						{!isManager ? (
							<div className="w-full min-w-[200px] sm:w-[220px]">
								<p className="mb-1.5 text-xs font-medium text-muted-foreground">Branch</p>
								<SearchableSelect
									value={branchId || 'all'}
									onValueChange={(v) => {
										const next = v === 'all' ? '' : v;
										setBranchId(next);
										setOfficerId('');
										persistQuery({ branch: next, officer: '' });
									}}
									options={branchOpts}
									allLabel="All branches"
									allValue="all"
									placeholder="All branches"
									searchPlaceholder="Search…"
									emptyText="No branch"
									triggerClassName="w-full"
								/>
							</div>
						) : null}

						<div className="w-full min-w-[200px] sm:w-[220px]">
							<p className="mb-1.5 text-xs font-medium text-muted-foreground">Loan officer</p>
							<SearchableSelect
								value={officerId || 'all'}
								onValueChange={(v) => {
									const next = v === 'all' ? '' : v;
									setOfficerId(next);
									persistQuery({ officer: next });
								}}
								options={officerOpts}
								allLabel="All officers"
								allValue="all"
								placeholder="All officers"
								searchPlaceholder="Search…"
								emptyText="No officer"
								triggerClassName="w-full"
							/>
						</div>
					</CardContent>
				</Card>

				<div className="grid gap-3 sm:grid-cols-3">
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">Sum — net deposit (computed)</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-2xl font-bold tabular-nums">{formatMoney(totalNet)}</p>
							<p className="text-xs text-muted-foreground mt-1">Across {blocks.length} officer(s) in scope</p>
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">Withdrawn to bank</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-2xl font-bold tabular-nums">
								{withdrawnCount} / {blocks.length}
							</p>
							<p className="text-xs text-muted-foreground mt-1">Officers who confirmed for this date</p>
							<p className="mt-3 border-t pt-3 text-lg font-semibold tabular-nums text-foreground">
								{formatMoney(totalWithdrawnAmount)}
							</p>
							<p className="text-xs text-muted-foreground mt-1">
								Total to bank (sum of amount deposited for officers who withdrew)
							</p>
						</CardContent>
					</Card>
					<Card>
						<CardHeader className="pb-2">
							<CardTitle className="text-sm font-medium text-muted-foreground">Application fee / disbursement</CardTitle>
						</CardHeader>
						<CardContent>
							<p className="text-sm">
								Fee per disbursement: {formatMoney(applicationFee)} · Day filter: {walletDate}
							</p>
						</CardContent>
					</Card>
				</div>

				{!showContent || loading ? (
					<div className="flex justify-center py-16">
						<Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
					</div>
				) : officersInScope.length === 0 ? (
					<p className="text-sm text-muted-foreground">No loan officers in the selected scope.</p>
				) : (
					<>
						<Card>
							<CardHeader>
								<CardTitle className="text-base">By officer — Excel grid</CardTitle>
								<CardDescription>
									Each officer has a centre breakdown (Excel-style). Amber ring = pending withdraw. Meta cards show{' '}
									<strong className="text-foreground">Office Topup</strong>, carry forward, next day taken, and to bank.
								</CardDescription>
							</CardHeader>
							<CardContent>
								<FieldWalletTraceGrid
									blocks={blocks}
									withdrawByOfficer={withdrawByOfficer}
									formatMoney={formatMoney}
								/>
							</CardContent>
						</Card>

						<Card>
							<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
								<div>
									<CardTitle className="text-base">By officer — summary</CardTitle>
									<CardDescription>
										Compact table — one row per officer.{' '}
										<span className="font-medium text-amber-800 dark:text-amber-200">
											Amber background means they have not confirmed &quot;withdraw to bank&quot; for that day yet
										</span>
										.{' '}
										<strong className="text-foreground">Next day taken</strong> — total float planned for the next working day.{' '}
										<strong className="text-foreground">Carry forward</strong> — cash kept overnight.{' '}
										<strong className="text-foreground">Office Topup</strong> — extra from office when taken exceeds closing deposit.
									</CardDescription>
								</div>
								<Button
									type="button"
									variant="outline"
									size="sm"
									className="shrink-0 border-amber-300/80 bg-amber-50/80 text-amber-950 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/70"
									onClick={exportReminderList}
									disabled={pendingWithdrawExportRows.length === 0 || loading}
								>
									<Download className="mr-2 h-4 w-4" />
									Export names (pending withdraw)
									{pendingWithdrawExportRows.length > 0 ? ` (${pendingWithdrawExportRows.length})` : ''}
								</Button>
							</CardHeader>
							<CardContent>
								<FieldWalletTraceSummaryTable
									blocks={blocks}
									withdrawByOfficer={withdrawByOfficer}
									formatMoney={formatMoney}
								/>
							</CardContent>
						</Card>
					</>
				)}
			</div>
		</DashboardLayout>
	);
}
