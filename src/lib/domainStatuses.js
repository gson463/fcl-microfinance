/**
 * Canonical borrower + loan status values used in public.borrowers.status / public.loans.status.
 * PostgreSQL does not enforce CHECK constraints on these columns; the application and SQL
 * functions (e.g. update_all_loan_statuses, disbursement flows) define the live set.
 *
 * Borrowers: eligible | pending | active_loan | defaulted | paid_up
 * Loans: active | paid | delinquent | defaulted | written_off | edit_requested | delete_requested
 *
 * Single source for filters and labels across pages.
 */

/** @typedef {{ value: string, label: string }} StatusOption */

/** @type {StatusOption[]} */
export const BORROWER_STATUS_FILTER_OPTIONS = [
	{ value: 'eligible', label: 'Eligible' },
	{ value: 'pending', label: 'Pending — re-loan approval' },
	{ value: 'active_loan', label: 'Active loan' },
	{ value: 'defaulted', label: 'Defaulted' },
	{ value: 'paid_up', label: 'Paid' },
];

/** @type {StatusOption[]} */
export const LOAN_STATUS_FILTER_OPTIONS = [
	{ value: 'active', label: 'Active' },
	{ value: 'paid', label: 'Paid' },
	{ value: 'delinquent', label: 'Delinquent' },
	{ value: 'defaulted', label: 'Defaulted' },
	{ value: 'written_off', label: 'Written off' },
	{ value: 'edit_requested', label: 'Edit requested' },
	{ value: 'delete_requested', label: 'Delete requested' },
];

export function borrowerStatusLabel(status) {
	if (status == null || status === '') return '—';
	const o = BORROWER_STATUS_FILTER_OPTIONS.find((x) => x.value === status);
	if (o) return o.label;
	return String(status).replace(/_/g, ' ');
}

export function loanStatusLabel(status) {
	if (status == null || status === '') return '—';
	const o = LOAN_STATUS_FILTER_OPTIONS.find((x) => x.value === status);
	if (o) return o.label;
	return String(status).replace(/_/g, ' ');
}

/** Badge variant for borrower status (UI). */
export function borrowerStatusBadgeVariant(status) {
	const map = {
		eligible: 'success',
		pending: 'secondary',
		active_loan: 'warning',
		defaulted: 'destructive',
		paid_up: 'default',
		active: 'outline',
	};
	return map[status] || 'secondary';
}

/** Badge variant for loan status (UI). */
export function loanStatusBadgeVariant(status) {
	const map = {
		active: 'success',
		paid: 'default',
		delinquent: 'warning',
		defaulted: 'destructive',
		written_off: 'secondary',
		delete_requested: 'secondary',
		edit_requested: 'secondary',
	};
	return map[status] || 'secondary';
}
