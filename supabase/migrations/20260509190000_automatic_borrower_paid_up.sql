-- When every loan for a borrower is settled (no active/delinquent/defaulted) and at least one loan is paid,
-- promote borrower from active_loan → paid_up automatically.

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
  SET status = 'paid_up'
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
  'Sets borrower.status to paid_up when active_loan, at least one paid loan, and no active/delinquent/defaulted loans.';

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
  SET status = 'paid_up'
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

CREATE OR REPLACE FUNCTION public.trigger_sync_borrower_paid_up()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.borrower_id IS NOT NULL THEN
    PERFORM public.sync_borrower_paid_up_for(NEW.borrower_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loans_sync_borrower_paid_up ON public.loans;
CREATE TRIGGER trg_loans_sync_borrower_paid_up
AFTER UPDATE OF status ON public.loans
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'paid')
EXECUTE FUNCTION public.trigger_sync_borrower_paid_up();

GRANT EXECUTE ON FUNCTION public.sync_borrower_paid_up_for(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_borrower_paid_up_for(uuid) TO service_role;

-- Backfill: borrowers who already qualify but were never promoted.
UPDATE public.borrowers b
SET status = 'paid_up'
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
