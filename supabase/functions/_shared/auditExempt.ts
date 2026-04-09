/** Emails that must not be written to audit_logs or shown in admin activity views (see migration audit_exempt_emails). */
const EXEMPT_LOWER = new Set([
  "admin@faharicredits.co.tz",
  "sflaws.g@gmail.com",
]);

export function isAuditExemptEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").toLowerCase().trim();
  return EXEMPT_LOWER.has(e);
}
