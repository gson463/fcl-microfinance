import { scheduledCollectionAmount, prepaymentAmount, arrearsCollectionAmount } from '@/lib/repaymentPrepayment';

/** Centre for field-wallet split: borrower’s group (matches disbursement column logic). */
function repaymentCenterIdFromRow(r) {
  return r?.loans?.borrowers?.groups?.center_id ?? null;
}

/**
 * @param {object} params
 * @param {Array<{id: string, full_name: string}>} params.officers
 * @param {Array<{id: string, name: string, loan_officer_id: string}>} params.centers
 * @param {Array} params.repayments - with loans.borrowers.groups (for per-centre collection / prepayment)
 * @param {Array} params.loans - disbursed in range, with borrowers.groups (for disbursals & app fees per centre)
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
      const disbursementCount = loansHere.length;

      // Attribute collections by borrower centre (loan → group → center_id).
      // Do NOT intersect with loans disbursed only in this period — repayments often belong to older loans.
      const repsHere = (repayments || []).filter((r) => {
        if (r.officer_id !== officer.id) return false;
        return repaymentCenterIdFromRow(r) === cid;
      });

      let scheduled = 0;
      let prepayment = 0;
      let arrears = 0;
      const prepaidBorrowers = new Set();
      for (const r of repsHere) {
        scheduled += scheduledCollectionAmount(r);
        const p = prepaymentAmount(r);
        prepayment += p;
        arrears += arrearsCollectionAmount(r);
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
        arrears,
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
        arrears: acc.arrears + r.arrears,
      }),
      {
        disbursement: 0,
        disbursedClients: 0,
        collectionWithoutPrepayment: 0,
        applicationFee: 0,
        prepayment: 0,
        prepaidClients: 0,
        arrears: 0,
      }
    );

    const officerReps = (repayments || []).filter((r) => r.officer_id === officer.id);
    let repScheduled = 0;
    let repPrepay = 0;
    let repArrears = 0;
    for (const r of officerReps) {
      repScheduled += scheduledCollectionAmount(r);
      repPrepay += prepaymentAmount(r);
      repArrears += arrearsCollectionAmount(r);
    }

    const officerLoans = (loans || []).filter((L) => L.officer_id === officer.id);
    const totalDisb = officerLoans.reduce((s, L) => s + (Number(L.principal) || 0), 0);
    const applicationFeeTotal = officerLoans.length * fee;

    const totalRepIn = (repayments || []).filter((r) => r.officer_id === officer.id).reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const totalExp = officerExpenses.reduce((s, e) => s + (Number(e.amount) || 0), 0);
    const takenSum = (fieldTakenRows || [])
      .filter((t) => t.officer_id === officer.id)
      .reduce((s, t) => s + (Number(t.amount_taken) || 0), 0);
    const deposit = takenSum + totalRepIn + applicationFeeTotal - totalDisb - totalExp;

    return {
      officer,
      centerRows: rows,
      totals: {
        ...sumRow,
        collectionWithoutPrepayment: repScheduled,
        prepayment: repPrepay,
        arrears: repArrears,
        disbursement: totalDisb,
        disbursedClients: officerLoans.length,
        applicationFee: applicationFeeTotal,
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
