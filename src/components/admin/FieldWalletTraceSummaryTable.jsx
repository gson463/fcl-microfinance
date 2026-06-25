import React, { useMemo } from 'react';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { computeFieldWalletSummaryTotals, officerExpensesTotal } from '@/lib/fieldWalletTraceTotals';
import { cn } from '@/lib/utils';

export function FieldWalletTraceSummaryTable({ blocks, withdrawByOfficer, repaymentTotalsByOfficer, formatMoney }) {
	const totals = useMemo(
		() => computeFieldWalletSummaryTotals(blocks, withdrawByOfficer, repaymentTotalsByOfficer),
		[blocks, withdrawByOfficer, repaymentTotalsByOfficer]
	);

	if (!blocks?.length) {
		return <p className="text-sm text-muted-foreground">No officers in scope.</p>;
	}

	return (
		<Table variant="default" className="table-fixed w-full">
			<TableHeader>
				<TableRow>
					<TableHead>Officer</TableHead>
					<TableHead className="text-right">Taken</TableHead>
					<TableHead className="text-right">Collections</TableHead>
					<TableHead className="text-right">App fees</TableHead>
					<TableHead className="text-right">Disbursed</TableHead>
					<TableHead className="text-right">Expenses</TableHead>
					<TableHead className="text-right font-semibold">Deposit</TableHead>
					<TableHead className="text-right">Carry forward</TableHead>
					<TableHead className="text-right">Office Topup</TableHead>
					<TableHead className="text-right">Next day taken</TableHead>
					<TableHead>Bank withdraw</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{blocks.map((block) => {
					const t = block.totals || {};
					const oid = block.officer?.id;
					const totalRep = repaymentTotalsByOfficer?.get?.(oid) ?? 0;
					const wRow = withdrawByOfficer?.get?.(oid);
					const rawDep = Number(t.rawDeposit ?? t.deposit) || 0;
					const banked = wRow
						? wRow.amount_deposited != null
							? Number(wRow.amount_deposited)
							: rawDep
						: null;
					const carried = wRow ? Number(wRow.carried_to_next_day) || 0 : 0;
					const planned =
						wRow && Number(wRow.planned_next_day_taken) > 0
							? Number(wRow.planned_next_day_taken)
							: carried;
					const topUp = wRow ? Number(wRow.top_up_from_office) || 0 : 0;

					return (
						<TableRow
							key={oid ?? block.officer?.full_name}
							className={cn(
								!wRow &&
									'!bg-amber-50/95 hover:!bg-amber-100/90 border-l-4 border-l-amber-400 dark:!bg-amber-950/40 dark:hover:!bg-amber-950/55 dark:border-l-amber-500'
							)}
						>
							<TableCell className="font-medium break-words">{block.officer?.full_name || '—'}</TableCell>
							<TableCell className="text-right tabular-nums">{formatMoney(t.amountTaken)}</TableCell>
							<TableCell className="text-right tabular-nums">{formatMoney(totalRep)}</TableCell>
							<TableCell className="text-right tabular-nums">{formatMoney(t.applicationFee)}</TableCell>
							<TableCell className="text-right tabular-nums">{formatMoney(t.disbursement)}</TableCell>
							<TableCell className="text-right tabular-nums">{formatMoney(officerExpensesTotal(t))}</TableCell>
							<TableCell className="text-right align-top tabular-nums">
								<div className="inline-block text-right">
									<span className="font-semibold block">{formatMoney(t.deposit)}</span>
									{wRow ? (
										<span className="block text-xs font-normal text-muted-foreground mt-0.5 max-w-[13rem] ml-auto leading-snug">
											Same day: {formatMoney(rawDep)}
										</span>
									) : null}
								</div>
							</TableCell>
							<TableCell className="text-right align-top tabular-nums">
								{carried > 0 ? (
									<div className="inline-block text-right">
										<span className="font-medium block">{formatMoney(carried)}</span>
										{wRow?.next_business_date ? (
											<span className="block text-xs font-normal text-muted-foreground mt-0.5">Overnight</span>
										) : null}
									</div>
								) : (
									<span className="text-muted-foreground">—</span>
								)}
							</TableCell>
							<TableCell className="text-right tabular-nums">
								{topUp > 0 ? formatMoney(topUp) : <span className="text-muted-foreground">—</span>}
							</TableCell>
							<TableCell className="text-right align-top tabular-nums">
								{planned > 0 ? (
									<div className="inline-block text-right">
										<span className="font-medium block">{formatMoney(planned)}</span>
										{wRow?.next_business_date ? (
											<span className="block text-xs font-normal text-muted-foreground mt-0.5">
												For {wRow.next_business_date}
											</span>
										) : null}
									</div>
								) : (
									<span className="text-muted-foreground">—</span>
								)}
							</TableCell>
							<TableCell>
								{wRow ? (
									<div className="space-y-1">
										<span className="inline-flex flex-wrap items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
											<CheckCircle2 className="h-4 w-4 shrink-0" />
											Withdrawn
											<span className="text-xs text-muted-foreground">
												({new Date(wRow.created_at).toLocaleString()})
											</span>
										</span>
										<p className="text-xs tabular-nums text-muted-foreground">
											To bank: <span className="font-medium text-foreground">{formatMoney(banked)}</span>
										</p>
									</div>
								) : (
									<div className="text-sm text-muted-foreground">
										<span className="inline-flex items-center gap-1.5">
											<CircleDashed className="h-4 w-4 shrink-0" />
											Not recorded
										</span>
										{rawDep <= 0 && (
											<p className="mt-1 max-w-[14rem] text-xs text-amber-900/80 dark:text-amber-200/90">
												Officer must open Field wallet (same day) and tap &quot;Withdraw to bank&quot; — including when
												deposit is 0.
											</p>
										)}
									</div>
								)}
							</TableCell>
						</TableRow>
					);
				})}
			</TableBody>
			<TableFooter>
				<TableRow className="border-t-2 bg-muted/30 font-semibold hover:bg-muted/30">
					<TableCell className="font-semibold">Totals</TableCell>
					<TableCell className="text-right tabular-nums">{formatMoney(totals.totalTaken)}</TableCell>
					<TableCell className="text-right tabular-nums">{formatMoney(totals.totalCollections)}</TableCell>
					<TableCell className="text-right tabular-nums">{formatMoney(totals.totalAppFees)}</TableCell>
					<TableCell className="text-right tabular-nums">{formatMoney(totals.totalDisbursed)}</TableCell>
					<TableCell className="text-right tabular-nums">{formatMoney(totals.totalExpenses)}</TableCell>
					<TableCell className="text-right align-top tabular-nums">
						<div className="inline-block text-right">
							<span className="block">{formatMoney(totals.totalNet)}</span>
							{totals.hasWithdrawn ? (
								<span className="block text-xs font-normal text-muted-foreground mt-0.5">
									Same day: {formatMoney(totals.totalSameDay)}
								</span>
							) : null}
						</div>
					</TableCell>
					<TableCell className="text-right tabular-nums">{formatMoney(totals.totalCarry)}</TableCell>
					<TableCell className="text-right tabular-nums">{formatMoney(totals.totalTopUp)}</TableCell>
					<TableCell className="text-right tabular-nums">{formatMoney(totals.totalNext)}</TableCell>
					<TableCell />
				</TableRow>
			</TableFooter>
		</Table>
	);
}
