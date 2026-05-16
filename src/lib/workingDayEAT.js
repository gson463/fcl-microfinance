import { subDays } from 'date-fns';
import { format as formatTZ, toZonedTime, formatInTimeZone } from 'date-fns-tz';

const EAT = 'Africa/Nairobi';

/** ISO weekday in Africa/Nairobi: 1 = Monday … 7 = Sunday (align with loanUtils.getNextWorkingDay / DB EXTRACT(DOW)). */
function isoWeekdayEATFromString(ymd) {
  return formatInTimeZone(new Date(`${ymd}T12:00:00.000Z`), EAT, 'i');
}

/** True if `dateStr` (yyyy-MM-dd) is a Monday–Saturday in Nairobi and not in `holidays`. */
export function isWorkingDayEAT(dateStr, holidays = []) {
  if (!dateStr) return false;
  const ymd = String(dateStr).slice(0, 10);
  if (isoWeekdayEATFromString(ymd) === '7') return false;
  const isHoliday = holidays.some((h) => {
    const raw = h?.date;
    if (raw == null) return false;
    const hYmd =
      typeof raw === 'string' ? raw.slice(0, 10) : formatTZ(toZonedTime(new Date(raw), EAT), 'yyyy-MM-dd');
    return hYmd === ymd;
  });
  return !isHoliday;
}

/** Today’s calendar date in Africa/Nairobi as yyyy-MM-dd. */
export function todayYyyyMmDdEAT() {
  return formatTZ(new Date(), 'yyyy-MM-dd', { timeZone: EAT });
}

/**
 * Walk backward (inclusive) to the latest calendar day in Nairobi that is not Sunday and not in `holidays`.
 */
export function latestWorkingDayOnOrBeforeEAT(dateInput, holidays = [], maxSteps = 400) {
  let cur = dateInput instanceof Date ? dateInput : new Date(dateInput);
  for (let i = 0; i < maxSteps; i++) {
    const ymd = formatInTimeZone(cur, EAT, 'yyyy-MM-dd');
    if (isWorkingDayEAT(ymd, holidays)) return cur;
    cur = subDays(cur, 1);
  }
  return dateInput instanceof Date ? dateInput : new Date(dateInput);
}
