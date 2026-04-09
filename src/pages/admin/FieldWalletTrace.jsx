import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { format, startOfDay } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';
import { ArrowLeft, Loader2, Wallet, CalendarIcon, CheckCircle2, CircleDashed, Download } from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { fetchAdminFieldWalletSnapshot } from '@/lib/adminFieldWalletSnapshot';
import { cn } from '@/lib/utils';
import { exportObjectsToCsv } from '@/lib/tableExport';

const EAT = 'Africa/Nairobi';

function todayYyyyMmDdEAT() {
	return formatInTimeZone(new Date(), EAT, 'yyyy-MM-dd');
}

const FieldWalletTrace = () => {
	const navigate = useNavigate();
	const [searchParams, setSearchParams] = useSearchParams();
	const { toast } = useToast();

	const [currency, setCurrency] = useState('TZS');
	const [applicationFee, setApplicationFee] = useState(0);
	const [branches, setBranches] = useState([]);
	const [officers, setOfficers] = useState([]);
	const [loading, setLoading] = useState(true);

	const [walletDate, setWalletDate] = useState(() => {
		const d = searchParams.get('date');
		if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
		return todayYyyyMmDdEAT();
	});
	const [branchId, setBranchId] = useState(() => searchParams.get('branch') || '');
	const [officerId, setOfficerId] = useState(() => searchParams.get('officer') || '');

	const [blocks, setBlocks] = useState([]);
	const [withdrawByOfficer, setWithdrawByOfficer] = useState(() => new Map());
	const [repaymentTotalsByOfficer, setRepaymentTotalsByOfficer] = useState(() => new Map());

	useEffect(() => {
		const d = searchParams.get('date');
		if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) setWalletDate(d);
		setBranchId(searchParams.get('branch') || '');
		setOfficerId(searchParams.get('officer') || '');
	}, [searchParams]);

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

	const persistQuery = useCallback(
		(updates) => {
			const next = new URLSearchParams(searchParams);
			if (updates.date) next.set('date', updates.date);
			if ('branch' in updates) {
				if (updates.branch) next.set('branch', updates.branch);
				else next.delete('branch');
			}
			if ('officer' in updates) {
				if (updates.officer) next.set('officer', updates.officer);
				else next.delete('officer');
			}
			setSearchParams(next, { replace: true });
		},
		[searchParams, setSearchParams]
	);

	const officersInScope = useMemo(() => {
		if (officerId) return officers.filter((o) => o.id === officerId);
		if (branchId) return officers.filter((o) => o.branch_id === branchId);
		return officers;
	}, [officers, branchId, officerId]);

	const officersForBranch = useMemo(() => {
		if (!branchId) return officers;
		return officers.filter((o) => o.branch_id === branchId);
	}, [officers, branchId]);

	const fetchData = useCallback(async () => {
		setLoading(true);
		try {
			const snap = await fetchAdminFieldWalletSnapshot(supabase, walletDate, officersInScope);
			setCurrency(snap.currency);
			setApplicationFee(snap.applicationFee);
			setBlocks(snap.blocks);
			setWithdrawByOfficer(snap.withdrawByOfficer);
			setRepaymentTotalsByOfficer(snap.repaymentTotalsByOfficer);
		} catch (e) {
			console.error(e);
			toast({
				title: 'Could not load field wallet',
				description: e.message || 'Check migrations (officer_withdraw_to_bank) and try again.',
				variant: 'destructive',
			});
			setBlocks([]);
			setWithdrawByOfficer(new Map());
			setRepaymentTotalsByOfficer(new Map());
		} finally {
			setLoading(false);
		}
	}, [walletDate, officersInScope, toast]);

	useEffect(() => {
		fetchData();
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
					net_deposit: Number(block.totals.deposit) || 0,
					business_date: walletDate,
				};
			});
	}, [blocks, withdrawByOfficer, officers, branchNameById, walletDate]);

	const exportReminderList = useCallback(() => {
		if (pendingWithdrawExportRows.length === 0) {
			toast({ title: 'Nothing to export', description: 'All officers in scope have recorded withdraw, or list is empty.', variant: 'destructive' });
			return;
		}
		exportObjectsToCsv(`officers-pending-withdraw_${walletDate}.csv`, [
			{ header: 'Officer name', accessor: 'officer_name' },
			{ header: 'Branch', accessor: 'branch' },
			{ header: 'Business date', accessor: 'business_date' },
			{
				header: 'Net deposit (computed)',
				accessor: (r) => Number(r.net_deposit).toFixed(2),
			},
		], pendingWithdrawExportRows);
		toast({
			title: 'Exported',
			description: `${pendingWithdrawExportRows.length} officer name(s) — use for reminders.`,
		});
	}, [pendingWithdrawExportRows, walletDate, toast]);

	return (
		<DashboardLayout title="Field wallet trace">
			<div className="space-y-6">
				<div className="flex flex-wrap items-center gap-3">
					<Button type="button" variant="outline" size="sm" onClick={() => navigate('/admin/dashboard')}>
						<ArrowLeft className="mr-2 h-4 w-4" />
						Admin dashboard
					</Button>
				</div>

				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Wallet className="h-5 w-5 text-brand-gold" />
							Field wallet — full day flow
						</CardTitle>
						<CardDescription>
							Single calendar day (EAT). Formula per officer: taken + collections + application fees − disbursements −
							expenses = <strong>deposit</strong> (closing in hand). <strong>Withdrawn to bank</strong> is recorded when
							the officer confirms end-of-day banking; carry-forward becomes 0 for the next gate.
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

				{loading ? (
					<div className="flex justify-center py-16">
						<Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
					</div>
				) : officersInScope.length === 0 ? (
					<p className="text-sm text-muted-foreground">No loan officers in the selected scope.</p>
				) : (
					<Card>
						<CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:space-y-0">
							<div>
								<CardTitle className="text-base">By officer</CardTitle>
								<CardDescription>
									Each row is one officer’s field wallet for the selected day.{' '}
									<span className="font-medium text-amber-800 dark:text-amber-200">
										Yellow highlight = not yet withdrawn to bank
									</span>{' '}
									(reminder).
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
						<CardContent className="overflow-x-auto">
							<Table>
								<TableHeader>
									<TableRow>
										<TableHead>Officer</TableHead>
										<TableHead className="text-right">Taken</TableHead>
										<TableHead className="text-right">Collections</TableHead>
										<TableHead className="text-right">App fees</TableHead>
										<TableHead className="text-right">Disbursed</TableHead>
										<TableHead className="text-right">Expenses</TableHead>
										<TableHead className="text-right font-semibold">Deposit</TableHead>
										<TableHead>Bank withdraw</TableHead>
									</TableRow>
								</TableHeader>
								<TableBody>
									{blocks.map((block) => {
										const t = block.totals;
										const totalRep = repaymentTotalsByOfficer.get(block.officer.id) ?? 0;
										const wAt = withdrawByOfficer.get(block.officer.id);
										return (
											<TableRow
												key={block.officer.id}
												className={cn(
													!wAt &&
														'bg-amber-50/95 border-l-4 border-l-amber-400 dark:bg-amber-950/35 dark:border-l-amber-500'
												)}
											>
												<TableCell className="font-medium">{block.officer.full_name || '—'}</TableCell>
												<TableCell className="text-right tabular-nums">{formatMoney(t.amountTaken)}</TableCell>
												<TableCell className="text-right tabular-nums">{formatMoney(totalRep)}</TableCell>
												<TableCell className="text-right tabular-nums">{formatMoney(t.applicationFee)}</TableCell>
												<TableCell className="text-right tabular-nums">{formatMoney(t.disbursement)}</TableCell>
												<TableCell className="text-right tabular-nums">
													{formatMoney(Number(t.transport || 0) + Number(t.otherExpenses || 0))}
												</TableCell>
												<TableCell className="text-right font-semibold tabular-nums">{formatMoney(t.deposit)}</TableCell>
												<TableCell>
													{wAt ? (
														<span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
															<CheckCircle2 className="h-4 w-4 shrink-0" />
															Withdrawn
															<span className="text-xs text-muted-foreground">
																({new Date(wAt).toLocaleString()})
															</span>
														</span>
													) : (
														<span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
															<CircleDashed className="h-4 w-4 shrink-0" />
															Not recorded
														</span>
													)}
												</TableCell>
											</TableRow>
										);
									})}
								</TableBody>
							</Table>
						</CardContent>
					</Card>
				)}
			</div>
		</DashboardLayout>
	);
};

export default FieldWalletTrace;
