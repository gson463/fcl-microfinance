-- Period field wallet (inclusive dates): same formula as Field wallet / Excel DEPOSIT row.
-- Used to suggest today's "taken" from yesterday's closing deposit (yesterday-only period).

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
  'Field wallet net for [p_from, p_inclusive]: taken + repayments + (loan count × fee) − principal − expenses.';

GRANT EXECUTE ON FUNCTION public.officer_wallet_balance_for_period(uuid, date, date) TO authenticated;
