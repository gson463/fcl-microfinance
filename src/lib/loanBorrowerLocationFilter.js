/**
 * Client-side filters for loans list: match borrower.center_id or borrower's group.center_id.
 * Aligns with drilldown SQL (center via borrower or group).
 */

export function borrowerMatchesCenter(borrower, centerId) {
	if (!centerId || centerId === 'all') return true;
	if (!borrower) return false;
	if (borrower.center_id === centerId) return true;
	const g = borrower.groups;
	if (g && typeof g === 'object' && g.center_id === centerId) return true;
	return false;
}

export function borrowerMatchesGroup(borrower, groupId) {
	if (!groupId || groupId === 'all') return true;
	if (!borrower) return false;
	return borrower.group_id === groupId;
}
