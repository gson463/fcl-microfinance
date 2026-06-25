/** Expenses total for trace summary (transport + non-transport buckets). */
export function officerExpensesTotal(t) {
	return (
		Number(t?.transport || 0) +
		Number(t?.otherExpenses ?? t?.expense1 ?? 0) +
		Number(t?.expense2 || 0)
	);
}

/** Summary row totals for the by-officer table footer. */
export function computeFieldWalletSummaryTotals(blocks, withdrawByOfficer, repaymentTotalsByOfficer) {
	let totalNet = 0;
	let totalSameDay = 0;
	let totalTaken = 0;
	let totalCollections = 0;
	let totalAppFees = 0;
	let totalDisbursed = 0;
	let totalExpenses = 0;
	let totalCarry = 0;
	let totalTopUp = 0;
	let totalNext = 0;
	let hasWithdrawn = false;

	for (const block of blocks) {
		const t = block.totals || {};
		const oid = block.officer?.id;
		totalNet += Number(t.deposit) || 0;
		totalSameDay += Number(t.rawDeposit ?? t.deposit) || 0;
		totalTaken += Number(t.amountTaken) || 0;
		totalCollections += repaymentTotalsByOfficer?.get?.(oid) ?? 0;
		totalAppFees += Number(t.applicationFee) || 0;
		totalDisbursed += Number(t.disbursement) || 0;
		totalExpenses += officerExpensesTotal(t);

		const w = withdrawByOfficer?.get?.(oid);
		if (w) {
			hasWithdrawn = true;
			totalCarry += Number(w.carried_to_next_day) || 0;
			totalTopUp += Number(w.top_up_from_office) || 0;
			const planned = Number(w.planned_next_day_taken);
			totalNext += planned > 0 ? planned : Number(w.carried_to_next_day) || 0;
		}
	}

	return {
		totalNet,
		totalSameDay,
		totalTaken,
		totalCollections,
		totalAppFees,
		totalDisbursed,
		totalExpenses,
		totalCarry,
		totalTopUp,
		totalNext,
		hasWithdrawn,
	};
}
