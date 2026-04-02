/** Same rules as src/lib/repaymentInstallmentUnit.js (Option A: multiples of installment unit). */

export function installmentUnitFromSchedule(schedule: unknown): number | null {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  let min = Infinity;
  for (const inst of schedule) {
    const a = Number((inst as { amount?: unknown })?.amount);
    if (Number.isFinite(a) && a > 0.01) min = Math.min(min, a);
  }
  return min === Infinity ? null : min;
}

export function smallestMultipleOfUnitAtLeast(due: number, unit: number): number | null {
  if (!Number.isFinite(unit) || unit <= 0) return null;
  const d = Math.max(0, Number(due));
  const n = Math.ceil(d / unit - 1e-9);
  return Math.max(n, 1) * unit;
}

export function isValidRepaymentAmount(amount: number, _due: number, unit: number | null): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  if (unit == null || !Number.isFinite(unit) || unit <= 0) return false;
  if (amount + 1e-6 < unit) return false;
  const k = amount / unit;
  return Math.abs(k - Math.round(k)) < 1e-5;
}
