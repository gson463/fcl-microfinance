import React, { useState, useEffect, useCallback, useMemo } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { BulkDataTableToolbar } from '@/components/ui/bulk-data-table-toolbar';
import { useBulkSelection } from '@/hooks/useBulkSelection';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { supabase } from '@/lib/customSupabaseClient';
import { useToast } from '@/components/ui/use-toast';
import { RotateCw, Receipt, AlertTriangle } from 'lucide-react';
import { format as formatDate } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from '@/components/ui/alert-dialog';

const AdminExpenseTransfer = () => {
	const { toast } = useToast();
	const [officers, setOfficers] = useState([]);
	const [branches, setBranches] = useState([]);
	const [loading, setLoading] = useState(true);
	const [loadingExpenses, setLoadingExpenses] = useState(false);
	const [processing, setProcessing] = useState(false);
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [checkingImpact, setCheckingImpact] = useState(false);
	const [fromOfficerId, setFromOfficerId] = useState('');
	const [toOfficerId, setToOfficerId] = useState('');
	const [expenses, setExpenses] = useState([]);
	const [transferMode, setTransferMode] = useState('all'); // all | single | selected
	const [singleExpenseId, setSingleExpenseId] = useState('');
	const [currency, setCurrency] = useState('TZS');
	const [impactRows, setImpactRows] = useState([]);

	const fetchOfficers = useCallback(async () => {
		setLoading(true);
		try {
			const [{ data: usersData, error: usersError }, { data: brData, error: brErr }, { data: cfg }] = await Promise.all([
				supabase.from('users').select('id, full_name, branch_id, email').eq('role', 'officer').order('full_name'),
				supabase.from('branches').select('id, name'),
				supabase.from('system_config').select('value').eq('key', 'currency').maybeSingle(),
			]);
			if (usersError) throw usersError;
			if (brErr) throw brErr;
			if (cfg?.value) setCurrency(cfg.value);
			setOfficers(usersData || []);
			setBranches(brData || []);
		} catch (e) {
			toast({ title: 'Could not load officers', description: e.message, variant: 'destructive' });
		} finally {
			setLoading(false);
		}
	}, [toast]);

	useEffect(() => {
		fetchOfficers();
	}, [fetchOfficers]);

	const branchName = useCallback(
		(bid) => {
			if (!bid) return '—';
			return branches.find((b) => b.id === bid)?.name ?? '—';
		},
		[branches],
	);

	const officerOptions = useMemo(
		() =>
			officers.map((o) => ({
				value: o.id,
				label: `${o.full_name} · ${branchName(o.branch_id)}`,
			})),
		[officers, branchName],
	);

	const fetchExpensesForSource = useCallback(async () => {
		if (!fromOfficerId) {
			setExpenses([]);
			return;
		}
		setLoadingExpenses(true);
		try {
			const { data, error } = await supabase
				.from('expenses')
				.select('id, expense_date, amount, expense_type, description, created_at')
				.eq('officer_id', fromOfficerId)
				.order('expense_date', { ascending: false });
			if (error) throw error;
			setExpenses(data || []);
		} catch (e) {
			toast({ title: 'Could not load expenses', description: e.message, variant: 'destructive' });
			setExpenses([]);
		} finally {
			setLoadingExpenses(false);
		}
	}, [fromOfficerId, toast]);

	useEffect(() => {
		fetchExpensesForSource();
		setTransferMode('all');
		setSingleExpenseId('');
		setImpactRows([]);
	}, [fetchExpensesForSource]);

	useEffect(() => {
		if (!singleExpenseId) return;
		if (!expenses.some((e) => e.id === singleExpenseId)) {
			setSingleExpenseId('');
		}
	}, [expenses, singleExpenseId]);

	const expenseIds = useMemo(() => expenses.map((e) => e.id), [expenses]);
	const bulk = useBulkSelection(expenseIds);
	const selectedTotal = useMemo(
		() => expenses.reduce((s, e) => s + (bulk.isSelected(e.id) ? Number(e.amount || 0) : 0), 0),
		[expenses, bulk]
	);
	const singleRow = useMemo(() => expenses.find((e) => e.id === singleExpenseId) || null, [expenses, singleExpenseId]);

	const canTransfer =
		fromOfficerId &&
		toOfficerId &&
		fromOfficerId !== toOfficerId &&
		expenses.length > 0 &&
		((transferMode === 'all' && expenses.length > 0) ||
			(transferMode === 'selected' && bulk.selectedIds.length > 0) ||
			(transferMode === 'single' && Boolean(singleExpenseId)));

	const selectedRows = useMemo(() => {
		if (transferMode === 'all') return expenses;
		if (transferMode === 'single') return expenses.filter((e) => e.id === singleExpenseId);
		return expenses.filter((e) => bulk.isSelected(e.id));
	}, [transferMode, expenses, singleExpenseId, bulk]);

	const runTransfer = async () => {
		if (!canTransfer) return;
		setProcessing(true);
		let ok = false;
		try {
			const ids =
				transferMode === 'all'
					? null
					: transferMode === 'single'
						? singleExpenseId
							? [singleExpenseId]
							: null
						: bulk.selectedIds.length
							? [...bulk.selectedIds]
							: null;
			const payload = {
				p_from_officer_id: fromOfficerId,
				p_to_officer_id: toOfficerId,
				p_expense_ids: ids,
			};
			const { data: count, error } = await supabase.rpc('admin_transfer_officer_expenses', payload);
			if (error) throw error;
			const n = Number(count) || 0;
			toast({
				title: 'Expenses transferred',
				description:
					n === 0 ? 'No rows were updated (check selection).' : `Updated ${n} expense row(s). Destination field wallet rules were respected.`,
			});
			await fetchExpensesForSource();
			bulk.clear();
			ok = true;
		} catch (e) {
			const msg = e.message || String(e);
			toast({
				title: 'Transfer failed',
				description: /negative|field wallet/i.test(msg)
					? `${msg} Try moving fewer rows or adjust field wallet activity for the destination officer on that date.`
					: msg,
				variant: 'destructive',
			});
		} finally {
			setProcessing(false);
		}
		if (ok) setConfirmOpen(false);
	};

	const analyzeImpactByDate = async () => {
		if (!toOfficerId || selectedRows.length === 0) {
			setImpactRows([]);
			return;
		}
		setCheckingImpact(true);
		try {
			const amountByDate = new Map();
			for (const row of selectedRows) {
				const d = row.expense_date;
				const prev = amountByDate.get(d) || 0;
				amountByDate.set(d, prev + (Number(row.amount) || 0));
			}
			const dates = Array.from(amountByDate.keys()).sort();
			const rows = [];
			for (const d of dates) {
				const transferAmount = Number(amountByDate.get(d) || 0);
				const { data, error } = await supabase.rpc('officer_wallet_balance_for_period', {
					p_officer_id: toOfficerId,
					p_from: d,
					p_to: d,
				});
				if (error) throw error;
				const balanceBefore = Number(data) || 0;
				const projectedAfter = Number((balanceBefore - transferAmount).toFixed(2));
				rows.push({
					date: d,
					transferAmount,
					balanceBefore,
					projectedAfter,
					ok: projectedAfter >= 0,
				});
			}
			setImpactRows(rows);
		} catch (e) {
			setImpactRows([]);
			toast({
				title: 'Could not analyze date impact',
				description: e.message || String(e),
				variant: 'destructive',
			});
		} finally {
			setCheckingImpact(false);
		}
	};

	useEffect(() => {
		if (!fromOfficerId || !toOfficerId || fromOfficerId === toOfficerId) {
			setImpactRows([]);
			return;
		}
		if (selectedRows.length === 0) {
			setImpactRows([]);
			return;
		}
		const t = setTimeout(() => {
			analyzeImpactByDate();
		}, 250);
		return () => clearTimeout(t);
	}, [fromOfficerId, toOfficerId, transferMode, singleExpenseId, bulk.selectedIds, expenses]);

	const fmtMoney = (n) =>
		`${currency} ${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

	if (loading) {
		return (
			<DashboardLayout title="Transfer expenses">
				<div className="flex items-center justify-center gap-2 py-20 text-muted-foreground">
					<RotateCw className="h-5 w-5 animate-spin" />
					Loading…
				</div>
			</DashboardLayout>
		);
	}

	return (
		<DashboardLayout
			title="Transfer expenses"
			description="Reassign posted expenses from one loan officer to another. Field wallet checks apply to the receiving officer by expense date."
		>
			<div className="space-y-6">
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<Receipt className="h-5 w-5" />
							Officers
						</CardTitle>
						<CardDescription>
							Choose who currently owns the expense rows and who should own them after the transfer. This does not move borrowers, loans, or expense defaults—only
							records in <span className="font-medium">expenses</span>.
						</CardDescription>
					</CardHeader>
					<CardContent className="grid gap-6 sm:grid-cols-2">
						<div className="space-y-2">
							<Label>From officer</Label>
							<SearchableSelect
								value={fromOfficerId || undefined}
								onValueChange={(v) => setFromOfficerId(v || '')}
								options={officerOptions}
								placeholder="Select source officer"
								searchPlaceholder="Search officer…"
								emptyText="No officer found."
								triggerClassName="w-full"
							/>
						</div>
						<div className="space-y-2">
							<Label>To officer</Label>
							<SearchableSelect
								value={toOfficerId || undefined}
								onValueChange={(v) => setToOfficerId(v || '')}
								options={officerOptions.filter((o) => o.value !== fromOfficerId)}
								placeholder="Select destination officer"
								searchPlaceholder="Search officer…"
								emptyText="No officer found."
								triggerClassName="w-full"
							/>
						</div>
					</CardContent>
				</Card>

				{fromOfficerId ? (
					<Card>
						<CardHeader>
							<CardTitle>Expense rows ({expenses.length})</CardTitle>
							<CardDescription>
								{loadingExpenses ? 'Loading…' : 'Transfer every row for this officer, or select specific rows below.'}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4">
							<div className="flex flex-wrap items-center gap-4 rounded-lg border bg-muted/30 p-4">
								<div className="flex flex-wrap items-center gap-2">
									<Button type="button" size="sm" variant={transferMode === 'all' ? 'default' : 'outline'} onClick={() => setTransferMode('all')}>
										Transfer all
									</Button>
									<Button
										type="button"
										size="sm"
										variant={transferMode === 'single' ? 'default' : 'outline'}
										onClick={() => setTransferMode('single')}
									>
										Choose one-by-one
									</Button>
									<Button
										type="button"
										size="sm"
										variant={transferMode === 'selected' ? 'default' : 'outline'}
										onClick={() => setTransferMode('selected')}
									>
										Choose multiple
									</Button>
								</div>
								{transferMode === 'all' ? <span className="text-sm text-muted-foreground">Will move all {expenses.length} expense rows.</span> : null}
								{transferMode === 'selected' ? (
									<span className="text-sm text-muted-foreground">
										{bulk.count} selected · total {fmtMoney(selectedTotal)}
									</span>
								) : null}
								{transferMode === 'single' ? (
									<span className="text-sm text-muted-foreground">
										{singleRow ? `1 selected · ${fmtMoney(singleRow.amount)}` : 'Select one row below.'}
									</span>
								) : null}
							</div>

							{transferMode === 'selected' && (
								<BulkDataTableToolbar selectedCount={bulk.count} onClear={bulk.clear} onExportCsv={null} disabled={processing}>
									<span className="text-xs text-muted-foreground">Select rows to transfer only those.</span>
								</BulkDataTableToolbar>
							)}

							<div className="rounded-md border">
								<Table>
									<TableHeader>
										<TableRow>
											{transferMode === 'selected' ? (
												<TableHead className="w-10">
													<Checkbox
														checked={bulk.allSelected ? true : bulk.count > 0 ? 'indeterminate' : false}
														onCheckedChange={() => bulk.toggleAll()}
														aria-label="Select all"
													/>
												</TableHead>
											) : null}
											{transferMode === 'single' ? <TableHead className="w-24">Pick</TableHead> : null}
											<TableHead>Date</TableHead>
											<TableHead>Type</TableHead>
											<TableHead className="text-right">Amount</TableHead>
											<TableHead>Notes</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{expenses.length === 0 ? (
											<TableRow>
												<TableCell colSpan={transferMode === 'all' ? 4 : 5} className="text-center text-muted-foreground">
													No expenses for this officer.
												</TableCell>
											</TableRow>
										) : (
											expenses.map((row) => (
												<TableRow key={row.id}>
													{transferMode === 'selected' ? (
														<TableCell>
															<Checkbox
																checked={bulk.isSelected(row.id)}
																onCheckedChange={() => bulk.toggle(row.id)}
																aria-label={`Select expense ${row.id}`}
															/>
														</TableCell>
													) : null}
													{transferMode === 'single' ? (
														<TableCell>
															<Button
																type="button"
																size="sm"
																variant={singleExpenseId === row.id ? 'default' : 'outline'}
																onClick={() => setSingleExpenseId(row.id)}
															>
																{singleExpenseId === row.id ? 'Picked' : 'Pick'}
															</Button>
														</TableCell>
													) : null}
													<TableCell className="whitespace-nowrap">{formatDate(new Date(row.expense_date), 'yyyy-MM-dd')}</TableCell>
													<TableCell>
														<Badge variant="secondary" className="capitalize">
															{row.expense_type}
														</Badge>
													</TableCell>
													<TableCell className="text-right font-medium">{fmtMoney(row.amount)}</TableCell>
													<TableCell className="max-w-[240px] truncate text-muted-foreground">{row.description || '—'}</TableCell>
												</TableRow>
											))
										)}
									</TableBody>
								</Table>
							</div>

							<div className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100">
								<AlertTriangle className="h-5 w-5 shrink-0" />
								<p>
									Each row is checked against the <strong>destination</strong> officer&apos;s field wallet on that expense date. If the transfer would make a day
									negative, the whole operation is rolled back.
								</p>
							</div>

							<div className="flex flex-wrap items-center gap-2">
								{checkingImpact ? (
									<span className="inline-flex items-center text-xs text-muted-foreground">
										<RotateCw className="mr-2 h-3.5 w-3.5 animate-spin" />
										Analyzing date impact…
									</span>
								) : null}
								<Button type="button" disabled={!canTransfer || processing} onClick={() => setConfirmOpen(true)}>
								Transfer expenses
								</Button>
							</div>

							{impactRows.length > 0 ? (
								<div className="rounded-md border">
									<Table>
										<TableHeader>
											<TableRow>
												<TableHead>Date</TableHead>
												<TableHead className="text-right">Transfer amount</TableHead>
												<TableHead className="text-right">Destination before</TableHead>
												<TableHead className="text-right">Projected after</TableHead>
												<TableHead>Status</TableHead>
											</TableRow>
										</TableHeader>
										<TableBody>
											{impactRows.map((r) => (
												<TableRow key={r.date}>
													<TableCell className="whitespace-nowrap">{r.date}</TableCell>
													<TableCell className="text-right">{fmtMoney(r.transferAmount)}</TableCell>
													<TableCell className="text-right">{fmtMoney(r.balanceBefore)}</TableCell>
													<TableCell className="text-right">{fmtMoney(r.projectedAfter)}</TableCell>
													<TableCell>
														<Badge variant={r.ok ? 'success' : 'destructive'}>{r.ok ? 'OK' : 'Will fail'}</Badge>
													</TableCell>
												</TableRow>
											))}
										</TableBody>
									</Table>
								</div>
							) : null}
							<AlertDialog open={confirmOpen} onOpenChange={(o) => !processing && setConfirmOpen(o)}>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Confirm expense transfer</AlertDialogTitle>
										<AlertDialogDescription asChild>
											<div className="space-y-2 text-sm text-muted-foreground">
												<p>
													This will reassign{' '}
													<span className="font-medium text-foreground">
														{transferMode === 'all' ? `all ${expenses.length}` : transferMode === 'single' ? '1' : `${bulk.selectedIds.length}`} expense row(s)
													</span>{' '}
													from the source officer to the destination officer.
												</p>
												<p>This action is recorded in the activity log.</p>
											</div>
										</AlertDialogDescription>
									</AlertDialogHeader>
									<AlertDialogFooter className="gap-2 sm:gap-0">
										<AlertDialogCancel disabled={processing}>Cancel</AlertDialogCancel>
										<Button type="button" disabled={processing} onClick={() => runTransfer()}>
											{processing ? <RotateCw className="mr-2 h-4 w-4 animate-spin" /> : null}
											Confirm transfer
										</Button>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</CardContent>
					</Card>
				) : null}
			</div>
		</DashboardLayout>
	);
};

export default AdminExpenseTransfer;
