-- Withdraw-to-bank: optional carry of float to next working day + prefill officer_field_taken.

ALTER TABLE public.officer_withdraw_to_bank
  ADD COLUMN IF NOT EXISTS amount_deposited numeric,
  ADD COLUMN IF NOT EXISTS closing_deposit numeric,
  ADD COLUMN IF NOT EXISTS carried_to_next_day numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS next_business_date date;

ALTER TABLE public.officer_field_taken
  ADD COLUMN IF NOT EXISTS prefilled_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS confirmed_at timestamp with time zone;

COMMENT ON COLUMN public.officer_withdraw_to_bank.amount_deposited IS
  'Cash deposited to bank on business_date (closing_deposit minus carried_to_next_day when carry).';
COMMENT ON COLUMN public.officer_withdraw_to_bank.carried_to_next_day IS
  'Float retained for next_business_date when officer chose carry at withdraw.';
COMMENT ON COLUMN public.officer_field_taken.prefilled_at IS
  'Set when taken was pre-declared at end-of-day withdraw for a future business_date.';
COMMENT ON COLUMN public.officer_field_taken.confirmed_at IS
  'Set when officer confirms prefilled taken on first login that business_date.';

-- Raw single-day field wallet (ignores withdraw row — used before recording withdraw).
CREATE OR REPLACE FUNCTION public.officer_wallet_deposit_for_day(p_officer_id uuid, p_day date)
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
  IF p_officer_id IS NULL OR p_day IS NULL THEN
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
      (SELECT SUM(amount_taken) FROM public.officer_field_taken WHERE officer_id = p_officer_id AND business_date = p_day),
      0
    )
    + COALESCE(
      (SELECT SUM(amount) FROM public.repayments WHERE officer_id = p_officer_id AND actual_payment_date = p_day),
      0
    )
    + COALESCE(
      (SELECT COUNT(*)::numeric * v_fee FROM public.loans WHERE officer_id = p_officer_id AND disbursement_date = p_day),
      0
    )
    - COALESCE(
      (SELECT SUM(principal) FROM public.loans WHERE officer_id = p_officer_id AND disbursement_date = p_day),
      0
    )
    - COALESCE(
      (SELECT SUM(amount) FROM public.expenses WHERE officer_id = p_officer_id AND expense_date = p_day),
      0
    )
  INTO v_balance;

  RETURN COALESCE(v_balance, 0);
END;
$$;

COMMENT ON FUNCTION public.officer_wallet_deposit_for_day(uuid, date) IS
  'Same-day field wallet deposit formula without withdraw-to-bank short-circuit.';

GRANT EXECUTE ON FUNCTION public.officer_wallet_deposit_for_day(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.officer_confirm_withdraw_with_carry(
  p_business_date date,
  p_carry boolean,
  p_next_day_taken numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer_id uuid := auth.uid();
  v_d numeric;
  v_t numeric;
  v_next date;
  v_bank numeric;
BEGIN
  IF v_officer_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  IF p_business_date IS NULL THEN
    RAISE EXCEPTION 'business_date is required' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.officer_withdraw_to_bank w
    WHERE w.officer_id = v_officer_id AND w.business_date = p_business_date
  ) THEN
    RAISE EXCEPTION 'Withdraw already recorded for this day' USING ERRCODE = '23505';
  END IF;

  v_d := public.officer_wallet_deposit_for_day(v_officer_id, p_business_date);

  IF v_d < 0 THEN
    RAISE EXCEPTION 'Wallet is negative for this day (%.2f). Reconcile before withdraw.', round(v_d, 2)
      USING ERRCODE = '23514';
  END IF;

  IF COALESCE(p_carry, false) THEN
    v_t := COALESCE(p_next_day_taken, 0);
    IF v_t < 0 THEN
      RAISE EXCEPTION 'Next-day taken cannot be negative' USING ERRCODE = '22023';
    END IF;
    IF v_t > v_d + 0.01 THEN
      RAISE EXCEPTION 'Next-day taken (%.2f) cannot exceed closing deposit (%.2f)', round(v_t, 2), round(v_d, 2)
        USING ERRCODE = '22023';
    END IF;

    v_next := public.next_working_day_after_exclusive(p_business_date);
    v_bank := GREATEST(0, v_d - v_t);

    INSERT INTO public.officer_withdraw_to_bank (
      officer_id,
      business_date,
      amount_deposited,
      closing_deposit,
      carried_to_next_day,
      next_business_date
    ) VALUES (
      v_officer_id,
      p_business_date,
      v_bank,
      v_d,
      v_t,
      v_next
    );

    IF v_t > 0 THEN
      INSERT INTO public.officer_field_taken (
        officer_id,
        business_date,
        amount_taken,
        prefilled_at,
        confirmed_at,
        updated_at
      ) VALUES (
        v_officer_id,
        v_next,
        v_t,
        now(),
        NULL,
        now()
      )
      ON CONFLICT (officer_id, business_date) DO UPDATE
      SET
        amount_taken = EXCLUDED.amount_taken,
        prefilled_at = COALESCE(public.officer_field_taken.prefilled_at, EXCLUDED.prefilled_at),
        confirmed_at = NULL,
        updated_at = now();
    END IF;
  ELSE
    INSERT INTO public.officer_withdraw_to_bank (
      officer_id,
      business_date,
      amount_deposited,
      closing_deposit,
      carried_to_next_day,
      next_business_date
    ) VALUES (
      v_officer_id,
      p_business_date,
      v_d,
      v_d,
      0,
      NULL
    );
    v_t := 0;
    v_bank := v_d;
    v_next := NULL;
  END IF;

  RETURN jsonb_build_object(
    'closing_deposit', v_d,
    'amount_deposited', v_bank,
    'carried_to_next_day', COALESCE(v_t, 0),
    'next_business_date', v_next
  );
END;
$$;

COMMENT ON FUNCTION public.officer_confirm_withdraw_with_carry(date, boolean, numeric) IS
  'Records withdraw-to-bank; optionally pre-fills officer_field_taken for next working day after p_business_date.';

GRANT EXECUTE ON FUNCTION public.officer_confirm_withdraw_with_carry(date, boolean, numeric) TO authenticated;

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
  v_carried numeric;
BEGIN
  IF p_officer_id IS NULL OR p_from IS NULL OR p_to IS NULL OR p_from > p_to THEN
    RETURN 0;
  END IF;

  IF p_from = p_to THEN
    SELECT w.carried_to_next_day INTO v_carried
    FROM public.officer_withdraw_to_bank w
    WHERE w.officer_id = p_officer_id AND w.business_date = p_from
    LIMIT 1;

    IF FOUND THEN
      RETURN GREATEST(0, COALESCE(v_carried, 0));
    END IF;
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
  'Field wallet net for [p_from, p_inclusive]. Single day with withdraw: returns carried_to_next_day (0 if full bank).';
