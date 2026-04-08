-- Optional wallet split: "arrears_only" counts only unpaid installments with dueDate STRICTLY BEFORE
-- payment date as "scheduled"; installments due ON payment date count as prepayment in wallet/reports.

INSERT INTO public.system_config (key, value)
VALUES ('walletPrepaymentSplitMode', 'standard')
ON CONFLICT (key) DO NOTHING;

-- Same as scheduled_due_for_payment_date but excludes installments due ON p_payment_date (only dueDate < p_payment_date).
CREATE OR REPLACE FUNCTION public.scheduled_due_strictly_before_payment_date(
  p_schedule jsonb,
  p_payment_date date
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'array' THEN 0::numeric
    ELSE COALESCE(
      (
        SELECT SUM(
          CASE
            WHEN COALESCE(elem->>'status', '') = 'paid' THEN 0::numeric
            WHEN (COALESCE((elem->>'amount')::numeric, 0) - COALESCE((elem->>'paidAmount')::numeric, 0)) <= 0.01 THEN 0::numeric
            WHEN (elem->>'dueDate')::date >= p_payment_date THEN 0::numeric
            ELSE COALESCE((elem->>'amount')::numeric, 0) - COALESCE((elem->>'paidAmount')::numeric, 0)
          END
        )
        FROM jsonb_array_elements(p_schedule) AS t(elem)
      ),
      0
    )
  END;
$$;

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

GRANT EXECUTE ON FUNCTION public.scheduled_due_strictly_before_payment_date(jsonb, date) TO authenticated;
