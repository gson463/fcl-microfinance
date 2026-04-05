import { scheduledCollectionAmount, prepaymentAmount } from '@/lib/repaymentPrepayment';

/**
 * @param {object} params
 * @param {Array<{id: string, full_name: string}>} params.officers
 * @param {Array<{id: string, name: string, loan_officer_id: string}>} params.centers
 * @param {Array} params.repayments - with loans.borrowers.groups.centers
 * @param {Array} params.loans - disbursed in range, with borrowers.groups
 * @param {number} params.applicationFeePerDisbursement
 * @param {Array<{ officer_id: string, amount_taken?: number }>} [params.fieldTakenRows] — sums per officer over the report period
 */
export function buildOfficerCenterBlocks({
  officers,
  centers,
  repayments,
  loans,
  expenses,
  applicationFeePerDisbursement,
  fieldTakenRows,
}) {
  const fee = Number(applicationFeePerDisbursement) || 0;
  const centerById = Object.fromEntries((centers || []).map((c) => [c.id, c]));

  const blocks = (officers || []).map((officer) => {
    const officerCenters = (centers || []).filter((c) => c.loan_officer_id === officer.id);
    const centerIds = new Set(officerCenters.map((c) => c.id));

    const rows = officerCenters.map((center) => {
      const cid = center.id;

      const loansHere = (loans || []).filter(
        (L) =>
          L.officer_id === officer.id &&
          L.borrowers?.groups?.center_id === cid
      );

      const disbursedPrincipal = loansHere.reduce((s, L) => s + (Number(L.principal) || 0), 0);
      const disbursedClients = new Set(loansHere.map((L) => L.borrower_id).filter(Boolean)).size;
      const loanIdsHere = new Set(loansHere.map((L) => L.id));
      const disbursementCount = loansHere.length;

      const repsHere = (repayments || []).filter((r) => {
        const lid = r.loan_id;
        if (!lid || !loanIdsHere.has(lid)) return false;
        if (r.officer_id !== officer.id) return false;
        return true;
      });

      let scheduled = 0;
      let prepayment = 0;
      const prepaidBorrowers = new Set();
      for (const r of repsHere) {
        scheduled += scheduledCollectionAmount(r);
        const p = prepaymentAmount(r);
        prepayment += p;
        const bid = r.loans?.borrower_id ?? r.loans?.borrowers?.id ?? null;
        if (p > 0.01 && bid) prepaidBorrowers.add(bid);
      }

      const appFee = disbursementCount * fee;

      return {
        centerId: cid,
        centerName: center.name || '—',
        disbursement: disbursedPrincipal,
        disbursedClients,
        collectionWithoutPrepayment: scheduled,
        applicationFee: appFee,
        prepayment,
        prepaidClients: prepaidBorrowers.size,
        penalty: 0,
      };
    });

    const officerExpenses = (expenses || []).filter((e) => e.officer_id === officer.id);
    const transport = officerExpenses
      .filter((e) => String(e.expense_type || '').toLowerCase() === 'transport')
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const otherExpenses = officerExpenses
      .filter((e) => String(e.expense_type || '').toLowerCase() !== 'transport')
      .reduce((s, e) => s + (Number(e.amount) || 0), 0);

    const sumRow = rows.reduce(
      (acc, r) => ({
        disbursement: acc.disbursement + r.disbursement,
        disbursedClients: acc.disbursedClients + r.disbursedClients,
        collectionWithoutPrepayment: acc.collectionWithoutPrepayment + r.collectionWithoutPrepayment,
        applicationFee: acc.applicationFee + r.applicationFee,
        prepayment: acc.prepayment + r.prepayment,
        prepaidClients: acc.prepaidClients + r.prepaidClients,
        penalty: acc.penalty + r.penalty,
      }),
      {
        disbursement: 0,
        disbursedClients: 0,
        collectionWithoutPrepayment: 0,
        applicationFee: 0,
        prepayment: 0,
        prepaidClients: 0,
        penalty: 0,
      }
    );

    const totalRepIn = (repayments || []).filter((r) => r.officer_id === officer.id).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const totalDisb = (loans || []).filter((L) => L.officer_id === officer.id).reduce((s, L) => s + (Number(L.principal) || 0), 0);
    const totalExp = officerExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const takenSum = (fieldTakenRows || [])
      .filter((t) => t.officer_id === officer.id)
      .reduce((s, t) => s + (Number(t.amount_taken) || 0), 0);
    const deposit = takenSum + totalRepIn + sumRow.applicationFee - totalDisb - totalExp;

    return {
      officer,
      centerRows: rows,
      totals: {
        ...sumRow,
        transport,
        otherExpenses,
        expense1: otherExpenses,
        expense2: 0,
        deposit,
        amountTaken: takenSum,
      },
    };
  });

  return { blocks };
}
