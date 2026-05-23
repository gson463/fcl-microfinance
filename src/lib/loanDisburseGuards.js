/**
 * Rules aligned with disbursement eligibility in Loan Management:
 * unsettled/open loans include active, edit/delete workflow, arrears — anything that is not
 * written off and not fully paid per balance.
 */

export function loanDoesNotBlockNewDisburse(l) {
    if (!l) return true;
    const st = l.status;
    if (st === 'written_off') return true;
    if (st === 'paid' && Number(l.balance) <= 0.01) return true;
    return false;
}

/** True when the borrower already has any loan that must be closed before another disbursement. */
export function borrowerHasOutstandingLoan(loans, borrowerId) {
    if (!borrowerId || !Array.isArray(loans)) return false;
    return loans.some((l) => l.borrower_id === borrowerId && !loanDoesNotBlockNewDisburse(l));
}

/** When `loans` is already scoped to one borrower (e.g. `.eq('borrower_id', id)`), any blocking row blocks disburse. */
export function loansListHasAnyBlocking(loans) {
    if (!Array.isArray(loans)) return false;
    return loans.some((l) => !loanDoesNotBlockNewDisburse(l));
}
