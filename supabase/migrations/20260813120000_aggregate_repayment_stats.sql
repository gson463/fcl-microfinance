-- Repayment Management: SQL aggregation + batch scheduled-due lookup (reduces REST row volume).

CREATE OR REPLACE FUNCTION public.aggregate_repayment_stats(
  p_officer_id uuid DEFAULT NULL,
  p_officer_ids uuid[] DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_loan_ids uuid[] DEFAULT NULL,
  p_exclude_closed boolean DEFAULT false
)
RETURNS TABLE (
  total_paid numeric,
  total_prepayment numeric,
  total_scheduled numeric,
  total_interest numeric,
  total_principal numeric,
  row_count bigint
)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH filtered AS (
    SELECT
      r.amount,
      r.interest_paid,
      r.principal_paid,
      public.reports_prepayment_amount(
        r.amount,
        r.prepayment_amount,
        r.scheduled_due_snapshot,
        r.wallet_split_source
      ) AS prepay
    FROM public.repayments r
    INNER JOIN public.loans l ON l.id = r.loan_id
    WHERE
      (p_officer_id IS NULL OR r.officer_id = p_officer_id)
      AND (p_officer_ids IS NULL OR r.officer_id = ANY(p_officer_ids))
      AND (p_date_from IS NULL OR r.actual_payment_date >= p_date_from)
      AND (p_date_to IS NULL OR r.actual_payment_date <= p_date_to)
      AND (p_loan_ids IS NULL OR r.loan_id = ANY(p_loan_ids))
      AND (NOT p_exclude_closed OR l.status NOT IN ('paid', 'written_off'))
  )
  SELECT
    COALESCE(SUM(f.amount), 0),
    COALESCE(SUM(f.prepay), 0),
    COALESCE(SUM(GREATEST(0, f.amount - f.prepay)), 0),
    COALESCE(SUM(COALESCE(f.interest_paid, 0)), 0),
    COALESCE(SUM(COALESCE(f.principal_paid, 0)), 0),
    COUNT(*)::bigint
  FROM filtered f;
$$;

COMMENT ON FUNCTION public.aggregate_repayment_stats(uuid, uuid[], date, date, uuid[], boolean) IS
  'Single-row SUM stats for Repayment Management filters (replaces client-side fetchAllSupabaseRows).';

GRANT EXECUTE ON FUNCTION public.aggregate_repayment_stats(uuid, uuid[], date, date, uuid[], boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.scheduled_due_for_loan_ids(
  p_loan_ids uuid[],
  p_payment_date date,
  p_mode text DEFAULT 'scheduled_due_for_payment_date'
)
RETURNS TABLE (loan_id uuid, scheduled_due numeric)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT
    l.id,
    CASE
      WHEN p_mode = 'scheduled_due_strictly_before_payment_date' THEN
        public.scheduled_due_strictly_before_payment_date(l.schedule, p_payment_date)
      ELSE
        public.scheduled_due_for_payment_date(l.schedule, p_payment_date)
    END
  FROM public.loans l
  WHERE p_loan_ids IS NOT NULL AND l.id = ANY(p_loan_ids);
$$;

COMMENT ON FUNCTION public.scheduled_due_for_loan_ids(uuid[], date, text) IS
  'Batch scheduled-due lookup for Group Repayment (replaces N per-loan RPC calls).';

GRANT EXECUTE ON FUNCTION public.scheduled_due_for_loan_ids(uuid[], date, text) TO authenticated;

CREATE INDEX IF NOT EXISTS idx_loans_officer_status_open
  ON public.loans (officer_id, status)
  WHERE status NOT IN ('paid', 'written_off');
