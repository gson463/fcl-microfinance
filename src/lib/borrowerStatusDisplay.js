/** Labels aligned with borrower registration policy (eligible on signup; pending = re-loan after default). */

export function borrowerStatusLabel(status) {
	const map = {
		eligible: 'Eligible',
		pending: 'Pending — re-loan approval',
		active_loan: 'Active loan',
		defaulted: 'Defaulted',
		paid_up: 'Paid',
	};
	return map[status] || status || '—';
}

export function borrowerStatusBadgeVariant(status) {
	const map = {
		eligible: 'success',
		pending: 'secondary',
		active_loan: 'warning',
		defaulted: 'destructive',
		paid_up: 'default',
	};
	return map[status] || 'default';
}
