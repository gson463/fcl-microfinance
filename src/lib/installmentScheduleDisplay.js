/**
 * Principal / interest paid shown on schedule grids and exports.
 * `recalculate_loan_schedule` only writes paidAmount + status; disburse-time rows include
 * principalComponent + interestComponent (see generateSchedule in loanUtils).
 */

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * @param {Record<string, unknown>} inst installment row from loan.schedule JSON
 * @param {{ principal?: unknown, total_payable?: unknown } | null | undefined} [loan] optional loan totals for ratio fallback when per-row components missing
 * @returns {{ principalPaid: number, interestPaid: number }}
 */
export function installmentPrincipalInterestPaidDisplay(inst, loan) {
  const paidRaw = num(inst?.paidAmount ?? inst?.paid_amount);
  const paid = Math.max(0, paidRaw);
  const amt = num(inst?.amount);
  const pc = num(inst?.principalComponent ?? inst?.principal_component);
  const ic = num(inst?.interestComponent ?? inst?.interest_component);

  const exPRaw = inst?.principalPaid ?? inst?.principal_paid;
  const exIRaw = inst?.interestPaid ?? inst?.interest_paid;
  const hasExplicitStored =
    exPRaw !== undefined &&
    exIRaw !== undefined &&
    (Math.abs(num(exPRaw)) > 1e-6 || Math.abs(num(exIRaw)) > 1e-6 || paid <= 1e-6);

  if (hasExplicitStored) {
    return { principalPaid: num(exPRaw), interestPaid: num(exIRaw) };
  }

  const compSum = pc + ic;
  if (amt > 1e-6 && compSum > 1e-6) {
    return {
      principalPaid: paid * (pc / amt),
      interestPaid: paid * (ic / amt),
    };
  }

  const tp = loan != null ? num(loan.total_payable) : 0;
  const lp = loan != null ? num(loan.principal) : 0;
  if (amt > 1e-6 && paid >= 0 && tp > 1e-6) {
    const sharePrincipal = lp / tp;
    return {
      principalPaid: paid * sharePrincipal,
      interestPaid: paid * (1 - sharePrincipal),
    };
  }

  return { principalPaid: 0, interestPaid: 0 };
}
