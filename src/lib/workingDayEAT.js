import { format as formatTZ, toZonedTime } from 'date-fns-tz';

const EAT = 'Africa/Nairobi';

/** True if `dateStr` (yyyy-MM-dd) is a Monday–Saturday in Nairobi and not in `holidays`. */
export function isWorkingDayEAT(dateStr, holidays = []) {
  if (!dateStr) return false;
  const date = toZonedTime(new Date(dateStr), EAT);
  if (date.getDay() === 0) return false;
  const isHoliday = holidays.some(
    (h) => formatTZ(toZonedTime(new Date(h.date), EAT), 'yyyy-MM-dd') === dateStr,
  );
  return !isHoliday;
}

/** Today’s calendar date in Africa/Nairobi as yyyy-MM-dd. */
export function todayYyyyMmDdEAT() {
  return formatTZ(new Date(), 'yyyy-MM-dd', { timeZone: EAT });
}
