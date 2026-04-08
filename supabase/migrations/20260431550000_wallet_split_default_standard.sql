-- Default split is "standard": e.g. 4000 due today + pay 8000 → 4000 scheduled, 4000 prepayment.
-- Reverts deployments that applied an earlier 20260431540000 variant that set arrears_only.

UPDATE public.system_config
SET value = 'standard'
WHERE key = 'walletPrepaymentSplitMode'
  AND value = 'arrears_only';

CREATE OR REPLACE FUNCTION public.repayment_recompute_prepayment(p_repayment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r public.repayments%ROWTYPE;
  orig_amt numeric;
  due numeric;
  mode text;
BEGIN
  SELECT * INTO r FROM public.repayments WHERE id = p_repayment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'repayment not found';
  END IF;

  orig_amt := r.amount;

  SELECT COALESCE(
    (SELECT value FROM public.system_config WHERE key = 'walletPrepaymentSplitMode' LIMIT 1),
    'standard'
  ) INTO mode;

  UPDATE public.repayments SET amount = 0 WHERE id = p_repayment_id;
  PERFORM public.recalculate_loan_schedule(r.loan_id);

  IF mode = 'arrears_only' THEN
    SELECT COALESCE(
      public.scheduled_due_strictly_before_payment_date(l.schedule, r.actual_payment_date::date),
      0
    ) INTO due
    FROM public.loans l
    WHERE l.id = r.loan_id;
  ELSE
    SELECT COALESCE(
      public.scheduled_due_for_payment_date(l.schedule, r.actual_payment_date::date),
      0
    ) INTO due
    FROM public.loans l
    WHERE l.id = r.loan_id;
  END IF;

  UPDATE public.repayments
  SET
    amount = orig_amt,
    prepayment_amount = GREATEST(0, orig_amt - due),
    scheduled_due_snapshot = due
  WHERE id = p_repayment_id;

  PERFORM public.recalculate_loan_schedule(r.loan_id);
END;
$$;
