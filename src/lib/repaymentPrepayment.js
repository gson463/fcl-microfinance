/** Scheduled (arrears + due) portion vs prepayment for wallet / cash flow. */

const EPS = 0.05;

/**
 * Prepayment portion for wallet UI.
 *
 * - If `wallet_split_source === 'explicit'`: trust `prepayment_amount` (Record Collection officer split).
 * - Else if `scheduled_due_snapshot` exists: derive `amount − snapshot`; if stored `prepayment_amount`
 *   matches within EPS, trust stored.
 * - If snapshot-derived prepayment and stored `prepayment_amount` disagree: when stored is higher,
 *   trust stored (snapshot often had full payment as "scheduled" while prepayment was correct in column).
 * - When stored is lower, prefer snapshot-derived (legacy under-reported prepayment_amount).
 */
export function prepaymentAmount(repayment) {
  if (!repayment) return 0;
  const amt = Number(repayment.amount ?? 0);
  const src = String(repayment.wallet_split_source ?? '').toLowerCase();
  if (src === 'explicit') {
    const pa = Number(repayment.prepayment_amount ?? 0);
    if (Number.isFinite(pa) && pa >= 0) return Math.min(Math.max(0, pa), amt);
  }
  const rawSnap = repayment.scheduled_due_snapshot;
  const snapNum =
    rawSnap != null && rawSnap !== '' && Number.isFinite(Number(rawSnap)) ? Number(rawSnap) : null;
  const pa = Number(repayment.prepayment_amount ?? 0);

  if (snapNum != null) {
    const fromSnap = Math.max(0, amt - snapNum);
    if (Number.isFinite(pa) && pa >= 0 && Math.abs(pa - fromSnap) < EPS) {
      return Math.min(Math.max(0, pa), amt);
    }
    if (Number.isFinite(pa) && pa >= 0 && pa > fromSnap + EPS) {
      return Math.min(pa, amt);
    }
    return fromSnap;
  }
  return Math.max(0, Math.min(Number.isFinite(pa) ? pa : 0, amt));
}

export function scheduledCollectionAmount(repayment) {
  const amt = Number(repayment?.amount ?? 0);
  return Math.max(0, amt - prepaymentAmount(repayment));
}

/** Cash applied toward overdue / scheduled bucket (replaces legacy “penalty” column in field wallet reports). */
export function arrearsCollectionAmount(repayment) {
  const sched = scheduledCollectionAmount(repayment);
  const snapRaw = repayment?.scheduled_due_snapshot;
  const snap =
    snapRaw != null && snapRaw !== '' && Number.isFinite(Number(snapRaw)) ? Number(snapRaw) : null;
  if (snap == null) return sched;
  return Math.min(sched, snap);
}
