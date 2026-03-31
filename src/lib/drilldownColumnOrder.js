/**
 * Column order: loan id → disbursement date → borrower → branch → amounts → status.
 * Keys not in the list sort alphabetically after known keys.
 */
export const DRILLDOWN_COLUMN_PRIORITY = [
	'loan_id',
	'disbursement_date',
	'actual_payment_date',
	'borrower_name',
	'branch_name',
	'principal_disbursed',
	'disbursed_principal',
	'principal',
	'expected_interest',
	'embedded_interest',
	'interest_amount',
	'principal_collected',
	'interest_collected',
	'total_payable',
	'balance',
	'outstanding_principal',
	'outstanding_interest',
	'status',
	'principal_paid',
	'interest_paid',
	'amount',
	'outstanding_total',
	'default_total_amount',
	'due_today_amount',
	'last_installment_due',
	'days_to_final_due',
	'remaining_installments',
	'product_interest_rate',
];

/** Portfolio drilldowns share one logical table (after migration + enrichment). */
export const PORTFOLIO_METRIC_KEYS = new Set(['portfolio_active', 'portfolio_defaulted', 'portfolio_general']);

export const PORTFOLIO_DRILLDOWN_COLUMNS = [
	'loan_id',
	'disbursement_date',
	'borrower_name',
	'branch_name',
	'principal_disbursed',
	'expected_interest',
	'principal_collected',
	'interest_collected',
	'total_payable',
	'balance',
	'outstanding_principal',
	'outstanding_interest',
	'status',
];

/**
 * Map legacy RPC rows (principal only) to enriched field names where possible.
 * Outstanding principal = principal disbursed minus principal repaid (same logic as DB).
 */
export function enrichPortfolioDrilldownRow(row) {
	if (!row || typeof row !== 'object') return row;
	const principalDisbursed = row.principal_disbursed ?? row.principal;
	const tp = row.total_payable;
	let expected = row.expected_interest;
	if (expected == null && tp != null && principalDisbursed != null) {
		expected = Math.max(0, Number(tp) - Number(principalDisbursed));
	}

	let outstandingPrincipal = row.outstanding_principal;
	if (outstandingPrincipal == null && principalDisbursed != null) {
		const principalPaid = row.principal_collected != null ? Number(row.principal_collected) : 0;
		outstandingPrincipal = Math.max(0, Number(principalDisbursed) - principalPaid);
	}

	return {
		...row,
		principal_disbursed: principalDisbursed,
		expected_interest: expected,
		outstanding_principal: outstandingPrincipal,
	};
}

export function orderDrilldownKeys(keys) {
	const filtered = keys.filter((k) => k !== 'id');
	return [...filtered].sort((a, b) => {
		const ia = DRILLDOWN_COLUMN_PRIORITY.indexOf(a);
		const ib = DRILLDOWN_COLUMN_PRIORITY.indexOf(b);
		if (ia !== -1 && ib !== -1) return ia - ib;
		if (ia !== -1 && ib === -1) return -1;
		if (ia === -1 && ib !== -1) return 1;
		return a.localeCompare(b);
	});
}
