/** Scheduled (arrears + due) portion vs prepayment for wallet / cash flow. */

export function scheduledCollectionAmount(repayment) {
  const amt = Number(repayment?.amount ?? 0);
  const prep = Number(repayment?.prepayment_amount ?? 0);
  return Math.max(0, amt - prep);
}

export function prepaymentAmount(repayment) {
  return Math.max(0, Number(repayment?.prepayment_amount ?? 0));
}
