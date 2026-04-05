/** Client-side filters for loans/reports by org hierarchy + optional disbursement date range. */

export const ALL = 'all';

/**
 * @param {object} loan - loan row with borrowers { branch_id?, center_id?, group_id? } and officer_id, disbursement_date, optional officer { branch_id }
 * @param {object} filters - { branchId, centerId, groupId, officerId, dateFrom, dateTo } use '' or ALL for unset
 */
export function filterLoanByHierarchy(loan, filters) {
  const branchId = filters.branchId;
  const centerId = filters.centerId;
  const groupId = filters.groupId;
  const officerId = filters.officerId;
  const dateFrom = filters.dateFrom;
  const dateTo = filters.dateTo;

  if (officerId && officerId !== ALL && loan.officer_id !== officerId) return false;

  if (branchId && branchId !== ALL) {
    const br = loan.borrowers?.branch_id ?? loan.officer?.branch_id;
    if (br !== branchId) return false;
  }

  if (centerId && centerId !== ALL) {
    if (loan.borrowers?.center_id !== centerId) return false;
  }

  if (groupId && groupId !== ALL) {
    if (loan.borrowers?.group_id !== groupId) return false;
  }

  const dd = loan.disbursement_date;
  if (dateFrom && dd) {
    const d = String(dd).slice(0, 10);
    if (d < String(dateFrom).slice(0, 10)) return false;
  }
  if (dateTo && dd) {
    const d = String(dd).slice(0, 10);
    if (d > String(dateTo).slice(0, 10)) return false;
  }

  return true;
}
