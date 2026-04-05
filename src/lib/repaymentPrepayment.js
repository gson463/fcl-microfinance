/** Scheduled (arrears + due) portion vs prepayment for wallet / cash flow. */

/**
 * Stored prepayment on the row, or derived from scheduled_due_snapshot when the column was 0
 * (older rows before backfill / edge function always wrote both).
 */
export function prepaymentAmount(repayment) {
  const stored = Math.max(0, Number(repayment?.prepayment_amount ?? 0));
  if (stored > 0) return stored;
  const snap = repayment?.scheduled_due_snapshot;
  if (snap != null && snap !== '' && Number.isFinite(Number(snap))) {
    const amt = Number(repayment?.amount ?? 0);
    const due = Number(snap);
    return Math.max(0, amt - due);
  }
  return 0;
}

export function scheduledCollectionAmount(repayment) {
  const amt = Number(repayment?.amount ?? 0);
  return Math.max(0, amt - prepaymentAmount(repayment));
}
