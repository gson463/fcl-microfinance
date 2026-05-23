-- Officer «Prepayments» / Repayment Management: avoid statement timeouts on load.
-- 1) Index supports officer_id filter + ORDER BY actual_payment_date (common officer list pattern).
-- 2) Scoped status refresh touches many schedules; give Postgres more room on Supabase pooling.

CREATE INDEX IF NOT EXISTS idx_repayments_officer_actual_payment_desc
  ON public.repayments (officer_id, actual_payment_date DESC NULLS LAST);

ALTER FUNCTION public.refresh_loan_statuses_for_officer(uuid)
  SET statement_timeout = '180s';
