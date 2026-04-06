/**
 * Helpers for Excel bulk import: sheet selection, report text, duplicate keys.
 */

/** Prefer a named data sheet; otherwise first sheet (skip common helper sheet names). */
const SKIP_SHEET_NAMES = new Set([
  'instructions',
  'reference',
  'reference_centers',
  'reference_groups',
  'reference groups',
  'valid borrowers',
  'valid loan products',
  'template',
]);

export function getImportDataSheet(workbook, preferredNames = []) {
  const names = workbook.SheetNames || [];
  for (const pref of preferredNames) {
    const found = names.find((n) => n.trim().toLowerCase() === pref.toLowerCase());
    if (found) return found;
  }
  const firstData = names.find((n) => !SKIP_SHEET_NAMES.has(n.trim().toLowerCase()));
  return firstData || names[0];
}

/**
 * Build a short summary for toast/dialog after bulk import.
 */
export function formatImportReportSummary({
  imported = 0,
  skippedDuplicate = 0,
  skippedInvalid = 0,
  failed = 0,
  sampleFailures = [],
  maxSamples = 5,
}) {
  const parts = [];
  parts.push(`Imported: ${imported}`);
  if (skippedDuplicate > 0) parts.push(`Skipped (duplicate / already exists): ${skippedDuplicate}`);
  if (skippedInvalid > 0) parts.push(`Skipped (validation / rules): ${skippedInvalid}`);
  if (failed > 0) parts.push(`Failed (errors): ${failed}`);
  let extra = '';
  if (sampleFailures.length > 0) {
    const slice = sampleFailures.slice(0, maxSamples);
    extra = ` Examples: ${slice.join(' · ')}`;
    if (sampleFailures.length > maxSamples) extra += ' …';
  }
  return { line: parts.join('. '), detail: extra };
}
