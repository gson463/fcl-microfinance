/** Labels for user_associated_data_summary() keys (Postgres jsonb object). */
const COUNT_LABELS: Record<string, string> = {
  loans: "loan(s)",
  repayments: "repayment(s)",
  expenses: "expense(s)",
  borrowers: "borrower(s)",
  centers: "center(s)",
  groups: "group(s)",
  repayment_delete_requests: "pending repayment delete request(s)",
  audit_logs: "audit log entry(s)",
  deleted_loan_records: "archived deleted loan record(s)",
  deleted_repayment_records: "archived deleted repayment record(s)",
};

export function totalAndMessage(summary: Record<string, unknown>): {
  total: number;
  message: string;
} {
  let total = 0;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(summary)) {
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isFinite(n) || n <= 0) continue;
    total += n;
    parts.push(`${n} ${COUNT_LABELS[k] ?? k}`);
  }
  return {
    total,
    message:
      parts.length === 0
        ? ""
        : `Cannot delete this user while linked to system data: ${parts.join(", ")}. Reassign or remove that data first.`,
  };
}
