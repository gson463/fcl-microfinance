import { format, startOfDay } from 'date-fns';

/**
 * Calendar date (yyyy-MM-dd) for reporting: when cash was collected.
 * Uses actual_payment_date; falls back to payment_date only for legacy rows where actual was not stored.
 */
export function repaymentReportDateYyyyMmDd(repayment) {
  const raw = repayment?.actual_payment_date ?? repayment?.payment_date;
  if (raw == null || raw === '') return null;
  return String(raw).slice(0, 10);
}

/**
 * Inclusive date-range filter for Reports (matches prior logic: single-day when `to` is absent).
 * Compares yyyy-MM-dd strings so date-only values from Postgres are not shifted by UTC.
 */
export function isRepaymentInReportsRange(repayment, dateRange) {
  const d = repaymentReportDateYyyyMmDd(repayment);
  if (!d) return false;
  const from = dateRange?.from ? format(startOfDay(dateRange.from), 'yyyy-MM-dd') : null;
  const to = dateRange?.to
    ? format(dateRange.to, 'yyyy-MM-dd')
    : dateRange?.from
      ? format(dateRange.from, 'yyyy-MM-dd')
      : null;
  return (!from || d >= from) && (!to || d <= to);
}
