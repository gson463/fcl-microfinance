-- Full-table update_all_loan_statuses() on every officer Repayment Management load (and after saves)
-- still hits statement_timeout for large portfolios. Officers only need rows where loans.officer_id = self.

CREATE OR REPLACE FUNCTION public.refresh_loan_statuses_for_officer(p_officer_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_officer_id IS NULL THEN
    RETURN;
  END IF;

  -- Client calls: must match JWT. Service role (auth.uid() NULL) may refresh any officer (internal use).
  IF auth.uid() IS NOT NULL AND p_officer_id <> auth.uid() THEN
    RAISE EXCEPTION 'not allowed';
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
  WHERE l.officer_id = p_officer_id
    AND l.status IN ('active', 'delinquent', 'defaulted', 'paid')
    AND l.schedule IS NOT NULL
    AND jsonb_typeof(l.schedule) = 'array';

  -- Same borrower promotion rules as update_all_loan_statuses, scoped to this officer's borrowers.
  UPDATE public.borrowers b
  SET status = 'eligible'
  WHERE b.status = 'active_loan'
    AND EXISTS (
      SELECT 1 FROM public.loans l
      WHERE l.borrower_id = b.id AND l.status = 'paid'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.loans l
      WHERE l.borrower_id = b.id
        AND l.status IN ('active', 'delinquent', 'defaulted')
    )
    AND EXISTS (
      SELECT 1 FROM public.loans l
      WHERE l.borrower_id = b.id AND l.officer_id = p_officer_id
    );
END;
$$;

COMMENT ON FUNCTION public.refresh_loan_statuses_for_officer(uuid) IS
  'Like update_all_loan_statuses but only loans (and related borrower eligibility) for one loan officer.';

GRANT EXECUTE ON FUNCTION public.refresh_loan_statuses_for_officer(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_loan_statuses_for_officer(uuid) TO service_role;

-- Give repayment recording more headroom on busy tenants (no effect if platform caps lower).
ALTER FUNCTION public.record_repayment_wallet_then_recalculate(
  uuid, uuid, numeric, uuid, date, numeric, numeric, text
) SET statement_timeout = '120s';

ALTER FUNCTION public.recalculate_loan_schedule(uuid) SET statement_timeout = '120s';
