-- After each repayment, the record-repayment edge function used to call update_all_loan_statuses(),
-- which rescans every loan in the portfolio. That full-table update + per-loan subqueries often hits
-- PostgreSQL statement_timeout ("canceling statement due to statement timeout") as data grows.
--
-- This RPC applies the same status rules as update_all_loan_statuses for a single loan, then the
-- edge function calls sync_borrower_paid_up_for(borrower_id) for the affected borrower only.

CREATE OR REPLACE FUNCTION public.refresh_loan_status_for_id(p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_loan_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.loans l
  SET status = CASE
    WHEN GREATEST(0, l.total_payable - COALESCE((SELECT SUM(r.amount) FROM public.repayments r WHERE r.loan_id = l.id), 0)) <= 0.01 THEN 'paid'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(l.schedule) elem
      WHERE (elem->>'dueDate')::date < CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    ) THEN 'delinquent'
    ELSE 'active'
  END
  WHERE l.id = p_loan_id
    AND l.status IN ('active', 'delinquent', 'defaulted', 'paid')
    AND l.schedule IS NOT NULL
    AND jsonb_typeof(l.schedule) = 'array';
END;
$$;

COMMENT ON FUNCTION public.refresh_loan_status_for_id(uuid) IS
  'Recomputes loans.status for one loan from repayments + schedule (same CASE as update_all_loan_statuses).';

GRANT EXECUTE ON FUNCTION public.refresh_loan_status_for_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_loan_status_for_id(uuid) TO service_role;

CREATE INDEX IF NOT EXISTS idx_repayments_loan_id ON public.repayments (loan_id);
