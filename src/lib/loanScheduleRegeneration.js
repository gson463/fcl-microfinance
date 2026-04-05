import { generateSchedule } from '@/utils/loanUtils';
import { toZonedTime, format as formatTZ } from 'date-fns-tz';

const EAT_TIMEZONE = 'Africa/Nairobi';

/** Normalize DB or Date to yyyy-MM-dd (EAT). */
export function repaymentStartDateString(loan) {
  if (!loan?.repayment_start_date) return null;
  const d = loan.repayment_start_date;
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  try {
    return formatTZ(toZonedTime(new Date(d), EAT_TIMEZONE), 'yyyy-MM-dd', { timeZone: EAT_TIMEZONE });
  } catch {
    return null;
  }
}

/**
 * Rebuild schedule JSON from the loan row + current holiday list (same rules as disburse / approve-edit).
 * Does not persist. Use for previews or before replaceScheduleAndRecalculate.
 */
export function buildScheduleFromLoan(loan, holidays = []) {
  if (!loan) return { schedule: null, error: 'No loan' };
  const startStr = repaymentStartDateString(loan);
  if (!startStr) return { schedule: null, error: 'Missing repayment_start_date' };

  const principal = Number(loan.principal);
  const interestRate = Number(loan.interest_rate);
  const totalPayable = Number(loan.total_payable);
  if (!Number.isFinite(principal) || !Number.isFinite(totalPayable)) {
    return { schedule: null, error: 'Invalid principal or total_payable' };
  }

  const schedule = generateSchedule(
    principal,
    interestRate,
    totalPayable,
    loan.period,
    loan.period_unit,
    loan.repayment_frequency,
    startStr,
    holidays
  );

  if (!Array.isArray(schedule) || schedule.length === 0) {
    return { schedule: null, error: 'Generated schedule is empty' };
  }
  return { schedule, error: null };
}

/** Persist schedule then allocate repayments (with one retry for transient failures). */
export async function replaceScheduleAndRecalculate(supabase, loanId, schedule) {
  const { error: uErr } = await supabase.from('loans').update({ schedule }).eq('id', loanId);
  if (uErr) return { error: uErr };

  return recalculateLoanScheduleWithRetry(supabase, loanId);
}

export async function recalculateLoanScheduleWithRetry(supabase, loanId) {
  let err = (await supabase.rpc('recalculate_loan_schedule', { p_loan_id: loanId })).error;
  if (err) {
    await new Promise((r) => setTimeout(r, 400));
    err = (await supabase.rpc('recalculate_loan_schedule', { p_loan_id: loanId })).error;
  }
  return { error: err };
}

/**
 * Full path: rebuild from loan terms + holidays, save, re-apply repayments.
 * Call after admin updates the holidays table and needs one loan aligned.
 */
export async function regenerateLoanScheduleFromCurrentHolidays(supabase, loan, holidays) {
  const { schedule, error: buildErr } = buildScheduleFromLoan(loan, holidays);
  if (buildErr) return { error: { message: buildErr } };
  return replaceScheduleAndRecalculate(supabase, loan.id, schedule);
}

/** Loans that are safe to recalendar without surprising “closed” books. */
export function loanStatusAllowsScheduleRegeneration(status) {
  return status === 'active' || status === 'delinquent' || status === 'defaulted';
}

/**
 * Eligible loans for an officer’s branch (branch is taken from nested officer on loan rows).
 */
export function loansEligibleForBranchRegeneration(loans, branchId) {
  if (!branchId || !Array.isArray(loans)) return [];
  return loans.filter(
    (l) => l.officer?.branch_id === branchId && loanStatusAllowsScheduleRegeneration(l.status)
  );
}

/**
 * Sequential bulk regenerate for a branch. Same per-loan logic as single regenerate.
 * @returns {{ total: number, succeeded: number, failed: Array<{ loanId: string, loan_id: string, message: string }> }}
 */
export async function regenerateSchedulesForBranchLoans(supabase, loans, branchId, holidays, options = {}) {
  const eligible = loansEligibleForBranchRegeneration(loans, branchId);
  const failed = [];

  for (let i = 0; i < eligible.length; i++) {
    const loan = eligible[i];
    const { error } = await regenerateLoanScheduleFromCurrentHolidays(supabase, loan, holidays);
    if (error) {
      failed.push({
        loanId: loan.id,
        loan_id: loan.loan_id,
        message: error.message || String(error),
      });
    }
    options.onProgress?.({ current: i + 1, total: eligible.length, loan_id: loan.loan_id });
  }

  return {
    total: eligible.length,
    succeeded: eligible.length - failed.length,
    failed,
  };
}
