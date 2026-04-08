-- Wallet split: "arrears_only" — only unpaid installments with dueDate STRICTLY BEFORE payment date
-- count as "scheduled collection". Installments due ON payment date go to prepayment in wallet/reports.
-- Example: no past arrears, pay 8,000 on due day → 0 scheduled, 8,000 prepayment (not 8,000 + 0).
--
-- Trade-off vs "standard": same-day due is not in the "scheduled" bucket; use Admin → System Settings
-- to switch back to "standard" if you want due-on-or-before = scheduled.

UPDATE public.system_config
SET value = 'arrears_only'
WHERE key = 'walletPrepaymentSplitMode';

DO $$
DECLARE
  rec RECORD;
  n int := 0;
BEGIN
  FOR rec IN
    SELECT id
    FROM public.repayments
    ORDER BY loan_id, COALESCE(actual_payment_date::date, payment_date::date), id
  LOOP
    PERFORM public.repayment_recompute_prepayment(rec.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'repayment_recompute_prepayment (arrears_only backfill): % rows', n;
END $$;

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
    'arrears_only'
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
