-- After all open loans are settled, borrower returns to `eligible` (ready for next cycle), not `paid_up`.
-- Loan row already becomes `paid` via update_all_loan_statuses (repayments vs total_payable).

CREATE OR REPLACE FUNCTION public.sync_borrower_paid_up_for(p_borrower_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_borrower_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.borrowers b
  SET status = 'eligible'
  WHERE b.id = p_borrower_id
    AND b.status = 'active_loan'
    AND EXISTS (
      SELECT 1 FROM public.loans l
      WHERE l.borrower_id = b.id AND l.status = 'paid'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.loans l
      WHERE l.borrower_id = b.id
        AND l.status IN ('active', 'delinquent', 'defaulted')
    );
END;
$$;

COMMENT ON FUNCTION public.sync_borrower_paid_up_for(uuid) IS
  'Sets borrower.status to eligible when active_loan, at least one paid loan, and no active/delinquent/defaulted loans (loan cleared — same idea as prior paid_up auto-promotion).';

CREATE OR REPLACE FUNCTION public.update_all_loan_statuses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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
  WHERE l.status IN ('active', 'delinquent', 'defaulted', 'paid')
    AND l.schedule IS NOT NULL
    AND jsonb_typeof(l.schedule) = 'array';

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
    );
END;
$$;

UPDATE public.borrowers SET status = 'eligible' WHERE status = 'paid_up';
