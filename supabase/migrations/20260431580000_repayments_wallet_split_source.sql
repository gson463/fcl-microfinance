-- Officer split from Record Collection: prepayment_amount is authoritative for wallet when source = explicit.
-- RPC-derived rows use wallet_split_source = rpc (default after recompute).

ALTER TABLE public.repayments
  ADD COLUMN IF NOT EXISTS wallet_split_source text;

COMMENT ON COLUMN public.repayments.wallet_split_source IS
  'rpc = derived from scheduled due RPC; explicit = Record Collection officer split (trust prepayment_amount).';

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
    scheduled_due_snapshot = due,
    wallet_split_source = 'rpc'
  WHERE id = p_repayment_id;

  PERFORM public.recalculate_loan_schedule(r.loan_id);
END;
$$;
