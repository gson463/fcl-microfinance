-- Officer marked end-of-day cash as deposited to bank; carry-forward balance becomes 0 for that day.
-- Excel/PDF still use client-side DEPOSIT (formula); this flag only affects officer_wallet_balance_for_period for a single calendar day.

CREATE TABLE public.officer_withdraw_to_bank (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  officer_id uuid NOT NULL,
  business_date date NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT officer_withdraw_to_bank_pkey PRIMARY KEY (id),
  CONSTRAINT officer_withdraw_to_bank_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.users (id) ON DELETE CASCADE,
  CONSTRAINT officer_withdraw_to_bank_officer_date_unique UNIQUE (officer_id, business_date)
);

CREATE INDEX idx_officer_withdraw_to_bank_officer_date ON public.officer_withdraw_to_bank (officer_id, business_date);

ALTER TABLE public.officer_withdraw_to_bank ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_officer_withdraw_to_bank" ON public.officer_withdraw_to_bank
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.officer_wallet_balance_for_period(p_officer_id uuid, p_from date, p_to date)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee numeric;
  v_balance numeric;
BEGIN
  IF p_officer_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RETURN 0;
  END IF;

  -- Single-day only: cash was banked; nothing left in hand for carry-forward / enforcement.
  IF p_from = p_to AND EXISTS (
    SELECT 1 FROM public.officer_withdraw_to_bank w
    WHERE w.officer_id = p_officer_id AND w.business_date = p_from
  ) THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(NULLIF(trim(value), '')::numeric, 0) INTO v_fee
  FROM public.system_config
  WHERE key = 'applicationFeePerDisbursement'
  LIMIT 1;

  IF v_fee IS NULL THEN
    v_fee := 0;
  END IF;

  SELECT
    COALESCE(
      (SELECT SUM(amount_taken) FROM public.officer_field_taken WHERE officer_id = p_officer_id AND business_date >= p_from AND business_date <= p_to),
      0
    )
    + COALESCE(
      (SELECT SUM(amount) FROM public.repayments WHERE officer_id = p_officer_id AND actual_payment_date >= p_from AND actual_payment_date <= p_to),
      0
    )
    + COALESCE(
      (SELECT COUNT(*)::numeric * v_fee FROM public.loans WHERE officer_id = p_officer_id AND disbursement_date >= p_from AND disbursement_date <= p_to),
      0
    )
    - COALESCE(
      (SELECT SUM(principal) FROM public.loans WHERE officer_id = p_officer_id AND disbursement_date >= p_from AND disbursement_date <= p_to),
      0
    )
    - COALESCE(
      (SELECT SUM(amount) FROM public.expenses WHERE officer_id = p_officer_id AND expense_date >= p_from AND expense_date <= p_to),
      0
    )
  INTO v_balance;

  RETURN COALESCE(v_balance, 0);
END;
$$;

COMMENT ON FUNCTION public.officer_wallet_balance_for_period(uuid, date, date) IS
  'Field wallet net for [p_from, p_inclusive]: taken + repayments + (loan count × fee) − principal − expenses. For a single day, returns 0 if officer_withdraw_to_bank exists (cash banked).';

GRANT EXECUTE ON FUNCTION public.officer_wallet_balance_for_period(uuid, date, date) TO authenticated;
