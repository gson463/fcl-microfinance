/**
 * Tanzanian public holidays for a given Gregorian year.
 * Fixed + Easter-based dates are deterministic. Islamic dates use ~11-day shift
 * per year from 2025 anchors (approximate — confirm with official gazette).
 */

function pad2(n) {
  return n < 10 ? `0${n}` : `${n}`;
}

/** @param {Date} d */
export function toYmd(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Western (Gregorian) Easter Sunday — Anonymous Gregorian algorithm */
export function easterSundayWestern(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

/**
 * Approximate Islamic holiday in Gregorian `targetYear` by shifting ~11 days/year
 * from 2025 anchors (same approach as prior hardcoded 2025 list).
 * @param {number} baseMonth 1-12
 * @param {number} baseDay 1-31
 */
function islamicApproxFrom2025Anchor(targetYear, baseMonth, baseDay) {
  const baseYear = 2025;
  let d = new Date(baseYear, baseMonth - 1, baseDay);
  if (targetYear > baseYear) {
    for (let y = baseYear; y < targetYear; y++) {
      d.setFullYear(d.getFullYear() + 1);
      d.setDate(d.getDate() - 11);
    }
  } else if (targetYear < baseYear) {
    for (let y = baseYear; y > targetYear; y--) {
      d.setFullYear(d.getFullYear() - 1);
      d.setDate(d.getDate() + 11);
    }
  }
  return d;
}

/**
 * @param {number} year Gregorian year
 * @returns {{ name: string, date: string }[]}
 */
export function getTanzanianHolidaysForYear(year) {
  const y = Number(year);
  if (!Number.isFinite(y) || y < 1900 || y > 2200) {
    return [];
  }

  const easter = easterSundayWestern(y);
  const goodFriday = new Date(easter);
  goodFriday.setDate(goodFriday.getDate() - 2);
  const easterMonday = new Date(easter);
  easterMonday.setDate(easterMonday.getDate() + 1);

  const eidFitr = islamicApproxFrom2025Anchor(y, 3, 31);
  const eidAdha = islamicApproxFrom2025Anchor(y, 6, 7);
  const mawlid = islamicApproxFrom2025Anchor(y, 9, 5);

  const fixed = (m, d, name) => ({ name, date: toYmd(new Date(y, m - 1, d)) });

  const list = [
    fixed(1, 1, "New Year's Day"),
    fixed(1, 12, 'Zanzibar Revolution Day'),
    { name: 'Eid al-Fitr (approximate)', date: toYmd(eidFitr) },
    { name: 'Good Friday', date: toYmd(goodFriday) },
    { name: 'Easter Monday', date: toYmd(easterMonday) },
    fixed(4, 26, 'Union Day'),
    fixed(5, 1, 'Labour Day'),
    { name: 'Eid al-Adha (approximate)', date: toYmd(eidAdha) },
    fixed(7, 7, 'Saba Saba Day'),
    fixed(8, 8, 'Nane Nane Day'),
    { name: "The Prophet's Birthday — Mawlid (approximate)", date: toYmd(mawlid) },
    fixed(10, 14, 'Nyerere Day'),
    fixed(12, 9, 'Independence Day'),
    fixed(12, 25, 'Christmas Day'),
    fixed(12, 26, 'Boxing Day'),
  ];

  // Stable order: by date string
  list.sort((a, b) => a.date.localeCompare(b.date));
  return list;
}

/** Years from minYear to maxYear inclusive (for selects). */
export function yearRangeInclusive(minYear, maxYear) {
  const out = [];
  for (let y = minYear; y <= maxYear; y++) out.push(y);
  return out;
}
