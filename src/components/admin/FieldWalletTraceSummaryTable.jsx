import React, { useMemo } from 'react';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { TraceMoney } from '@/components/admin/TraceMoney';
import { computeFieldWalletSummaryTotals, officerExpensesTotal, officerCollectionsTotal } from '@/lib/fieldWalletTraceTotals';
import { cn } from '@/lib/utils';

const thClass =
	'border border-border bg-muted/80 px-1 py-1.5 text-left text-[0.6rem] sm:text-[0.65rem] font-semibold uppercase leading-tight whitespace-normal text-muted-foreground';
const tdClass = 'border border-border px-1 py-1.5 align-top text-xs';
const tdNumClass = cn(tdClass, 'text-right align-middle');

function SubLine({ children }) {
	return <span className="mt-0.5 block text-[0.62rem] sm:text-[0.68rem] leading-snug text-muted-foreground">{children}</span>;
}

/** Summary table — bordered, column-aligned, responsive horizontal scroll on small screens. */
export function FieldWalletTraceSummaryTable({ blocks, withdrawByOfficer, formatMoney }) {
	const totals = useMemo(
		() => computeFieldWalletSummaryTotals(blocks, withdrawByOfficer),
		[blocks, withdrawByOfficer]
	);

	if (!blocks?.length) {
		return <p className="text-sm text-muted-foreground">No officers in scope.</p>;
	}

	return (
		<div className="-mx-1 w-full overflow-x-auto sm:mx-0">
			<table className="w-full min-w-[920px] table-fixed border-collapse">
				<colgroup>
					<col className="w-[11%]" />
					<col className="w-[8%]" />
					<col className="w-[9%]" />
					<col className="w-[7%]" />
					<col className="w-[8%]" />
					<col className="w-[7%]" />
					<col className="w-[9%]" />
					<col className="w-[8%]" />
					<col className="w-[8%]" />
					<col className="w-[8%]" />
					<col className="w-[17%]" />
				</colgroup>
				<thead>
					<tr>
						<th className={thClass}>Officer</th>
						<th className={cn(thClass, 'text-right')}>Taken</th>
						<th className={cn(thClass, 'text-right')}>Collections</th>
						<th className={cn(thClass, 'text-right')}>App fees</th>
						<th className={cn(thClass, 'text-right')}>Disbursed</th>
						<th className={cn(thClass, 'text-right')}>Expenses</th>
						<th className={cn(thClass, 'text-right')}>Deposit</th>
						<th className={cn(thClass, 'text-right')}>Carry forward</th>
						<th className={cn(thClass, 'text-right')}>Office Topup</th>
						<th className={cn(thClass, 'text-right')}>Next day taken</th>
						<th className={thClass}>Bank withdraw</th>
					</tr>
				</thead>
				<tbody>
					{blocks.map((block) => {
						const t = block.totals || {};
						const oid = block.officer?.id;
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
							<tr
								key={oid ?? block.officer?.full_name}
								className={cn(
									!wRow &&
										'bg-amber-50/95 dark:bg-amber-950/40 [&>td:first-child]:border-l-4 [&>td:first-child]:border-l-amber-400 dark:[&>td:first-child]:border-l-amber-500'
								)}
							>
								<td className={cn(tdClass, 'break-words font-semibold leading-snug')}>
									{block.officer?.full_name || '—'}
								</td>
								<td className={tdNumClass}>
									<TraceMoney value={t.amountTaken} formatMoney={formatMoney} />
								</td>
								<td className={tdNumClass}>
									<TraceMoney value={officerCollectionsTotal(block)} formatMoney={formatMoney} />
								</td>
								<td className={tdNumClass}>
									<TraceMoney value={t.applicationFee} formatMoney={formatMoney} />
								</td>
								<td className={tdNumClass}>
									<TraceMoney value={t.disbursement} formatMoney={formatMoney} />
								</td>
								<td className={tdNumClass}>
									<TraceMoney value={officerExpensesTotal(t)} formatMoney={formatMoney} />
								</td>
								<td className={tdNumClass}>
									<TraceMoney value={t.deposit} formatMoney={formatMoney} bold />
									{wRow ? (
										<SubLine>
											Same day: <TraceMoney value={rawDep} formatMoney={formatMoney} className="inline-flex !w-auto" />
										</SubLine>
									) : null}
								</td>
								<td className={tdNumClass}>
									{carried > 0 ? (
										<>
											<TraceMoney value={carried} formatMoney={formatMoney} />
											{wRow?.next_business_date ? <SubLine>Overnight</SubLine> : null}
										</>
									) : (
										<span className="text-muted-foreground">—</span>
									)}
								</td>
								<td className={tdNumClass}>
									{topUp > 0 ? (
										<TraceMoney value={topUp} formatMoney={formatMoney} />
									) : (
										<span className="text-muted-foreground">—</span>
									)}
								</td>
								<td className={tdNumClass}>
									{planned > 0 ? (
										<>
											<TraceMoney value={planned} formatMoney={formatMoney} />
											{wRow?.next_business_date ? <SubLine>For {wRow.next_business_date}</SubLine> : null}
										</>
									) : (
										<span className="text-muted-foreground">—</span>
									)}
								</td>
								<td className={tdClass}>
									{wRow ? (
										<>
											<span className="inline-flex flex-wrap items-center gap-1 text-emerald-700 dark:text-emerald-400">
												<CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
												Withdrawn
											</span>
											<SubLine>{new Date(wRow.created_at).toLocaleString()}</SubLine>
											<SubLine>
												To bank:{' '}
												<TraceMoney value={banked} formatMoney={formatMoney} className="inline-flex !w-auto !items-end" />
											</SubLine>
										</>
									) : (
										<>
											<span className="inline-flex items-center gap-1 text-muted-foreground">
												<CircleDashed className="h-3.5 w-3.5 shrink-0" />
												Not recorded
											</span>
											{rawDep <= 0 ? (
												<SubLine>
													Officer must open Field wallet (same day) and tap &quot;Withdraw to bank&quot; — including when
													deposit is 0.
												</SubLine>
											) : null}
										</>
									)}
								</td>
							</tr>
						);
					})}
				</tbody>
				<tfoot>
					<tr className="border-t-2 border-border bg-muted/40 font-semibold">
						<td className={cn(tdClass, 'font-semibold')}>Totals</td>
						<td className={tdNumClass}>
							<TraceMoney value={totals.totalTaken} formatMoney={formatMoney} bold />
						</td>
						<td className={tdNumClass}>
							<TraceMoney value={totals.totalCollections} formatMoney={formatMoney} bold />
						</td>
						<td className={tdNumClass}>
							<TraceMoney value={totals.totalAppFees} formatMoney={formatMoney} bold />
						</td>
						<td className={tdNumClass}>
							<TraceMoney value={totals.totalDisbursed} formatMoney={formatMoney} bold />
						</td>
						<td className={tdNumClass}>
							<TraceMoney value={totals.totalExpenses} formatMoney={formatMoney} bold />
						</td>
						<td className={tdNumClass}>
							<TraceMoney value={totals.totalNet} formatMoney={formatMoney} bold />
							{totals.hasWithdrawn ? (
								<SubLine>
									Same day:{' '}
									<TraceMoney value={totals.totalSameDay} formatMoney={formatMoney} className="inline-flex !w-auto" bold />
								</SubLine>
							) : null}
						</td>
						<td className={tdNumClass}>
							<TraceMoney value={totals.totalCarry} formatMoney={formatMoney} bold />
						</td>
						<td className={tdNumClass}>
							<TraceMoney value={totals.totalTopUp} formatMoney={formatMoney} bold />
						</td>
						<td className={tdNumClass}>
							<TraceMoney value={totals.totalNext} formatMoney={formatMoney} bold />
						</td>
						<td className={tdClass} />
					</tr>
				</tfoot>
			</table>
		</div>
	);
}
