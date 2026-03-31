import { addDays, addWeeks, addMonths } from 'date-fns';

export const FREQUENCY_OPTIONS = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Every 2 weeks' },
  { value: 'monthly', label: 'Monthly' },
];

/** Next eligible posting time after last_applied_at (rolling schedule). */
export function nextDueDate(lastAppliedAt, frequency) {
  if (!lastAppliedAt) return null;
  const base = new Date(lastAppliedAt);
  switch (frequency) {
    case 'daily':
      return addDays(base, 1);
    case 'weekly':
      return addWeeks(base, 1);
    case 'biweekly':
      return addWeeks(base, 2);
    case 'monthly':
      return addMonths(base, 1);
    default:
      return addMonths(base, 1);
  }
}

/** Whether a new expense row may be posted for this default (active + interval elapsed). */
export function isDueNow(lastAppliedAt, frequency) {
  if (!lastAppliedAt) return true;
  const next = nextDueDate(lastAppliedAt, frequency);
  if (!next) return true;
  return Date.now() >= next.getTime();
}

export function frequencyLabel(frequency) {
  return FREQUENCY_OPTIONS.find((f) => f.value === frequency)?.label || frequency;
}

/** Short label for UI: when the next expense can be posted. */
export function nextDueLabel(lastAppliedAt, frequency) {
  if (!lastAppliedAt) return 'After you post once';
  const next = nextDueDate(lastAppliedAt, frequency);
  if (!next) return '—';
  return next.toLocaleDateString(undefined, { dateStyle: 'medium' });
}
