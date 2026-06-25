import React, { useMemo } from 'react';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { computeFieldWalletSummaryTotals, officerExpensesTotal, officerCollectionsTotal } from '@/lib/fieldWalletTraceTotals';
import { cn } from '@/lib/utils';

const thClass =
	'border border-border bg-muted/80 px-1.5 py-2 text-left text-[0.62rem] sm:text-[0.68rem] font-semibold uppercase leading-tight break-words whitespace-normal text-muted-foreground';
const tdClass = 'border border-border px-1.5 py-2 align-top text-[0.72rem] sm:text-xs tabular-nums break-words';
const tdNumClass = cn(tdClass, 'text-right');

function SubLine({ children }) {
	return <span className="mt-0.5 block text-[0.68rem] leading-snug text-muted-foreground">{children}</span>;
}

/** Summary table — matches agreed standalone sample (fixed width, bordered, full footer totals). */
export function FieldWalletTraceSummaryTable({ blocks, withdrawByOfficer, formatMoney }) {
	const totals = useMemo(
		() => computeFieldWalletSummaryTotals(blocks, withdrawByOfficer),
		[blocks, withdrawByOfficer]
	);

	if (!blocks?.length) {
		return <p className="text-sm text-muted-foreground">No officers in scope.</p>;
	}

	return (
		<div className="w-full">
			<table className="w-full table-fixed border-collapse text-[0.72rem] sm:text-sm">
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
						const totalRep = officerCollectionsTotal(block);
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
								<td className={cn(tdClass, 'font-semibold')}>{block.officer?.full_name || '—'}</td>
								<td className={tdNumClass}>{formatMoney(t.amountTaken)}</td>
								<td className={tdNumClass}>{formatMoney(totalRep)}</td>
								<td className={tdNumClass}>{formatMoney(t.applicationFee)}</td>
								<td className={tdNumClass}>{formatMoney(t.disbursement)}</td>
								<td className={tdNumClass}>{formatMoney(officerExpensesTotal(t))}</td>
								<td className={tdNumClass}>
									<span className="block font-semibold">{formatMoney(t.deposit)}</span>
									{wRow ? <SubLine>Same day: {formatMoney(rawDep)}</SubLine> : null}
								</td>
								<td className={tdNumClass}>
									{carried > 0 ? (
										<>
											<span className="block font-medium">{formatMoney(carried)}</span>
											{wRow?.next_business_date ? <SubLine>Overnight</SubLine> : null}
										</>
									) : (
										<span className="text-muted-foreground">—</span>
									)}
								</td>
								<td className={tdNumClass}>
									{topUp > 0 ? formatMoney(topUp) : <span className="text-muted-foreground">—</span>}
								</td>
								<td className={tdNumClass}>
									{planned > 0 ? (
										<>
											<span className="block font-medium">{formatMoney(planned)}</span>
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
												To bank: <span className="font-medium text-foreground">{formatMoney(banked)}</span>
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
						<td className={tdNumClass}>{formatMoney(totals.totalTaken)}</td>
						<td className={tdNumClass}>{formatMoney(totals.totalCollections)}</td>
						<td className={tdNumClass}>{formatMoney(totals.totalAppFees)}</td>
						<td className={tdNumClass}>{formatMoney(totals.totalDisbursed)}</td>
						<td className={tdNumClass}>{formatMoney(totals.totalExpenses)}</td>
						<td className={tdNumClass}>
							<span className="block">{formatMoney(totals.totalNet)}</span>
							{totals.hasWithdrawn ? <SubLine>Same day: {formatMoney(totals.totalSameDay)}</SubLine> : null}
						</td>
						<td className={tdNumClass}>{formatMoney(totals.totalCarry)}</td>
						<td className={tdNumClass}>{formatMoney(totals.totalTopUp)}</td>
						<td className={tdNumClass}>{formatMoney(totals.totalNext)}</td>
						<td className={tdClass} />
					</tr>
				</tfoot>
			</table>
		</div>
	);
}
