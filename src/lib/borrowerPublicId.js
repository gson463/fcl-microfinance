/**
 * Human-readable borrower reference (`borrowers.borrower_id` — e.g. B-123456).
 * Do not render `borrowers.id` (internal UUID) in the UI.
 */

export function borrowerPublicId(borrowerLike) {
  if (!borrowerLike) return '';
  const bid = borrowerLike.borrower_id;
  if (bid != null && String(bid).trim() !== '') return String(bid).trim();
  return '';
}

/** For table cells / subtitles when a public ID may be missing. */
export function borrowerPublicIdOrDash(borrowerLike) {
  const s = borrowerPublicId(borrowerLike);
  return s || '—';
}
