-- Wallet balance as of a calendar date (inclusive): cumulative taken + repayments + fees − principal − expenses
-- through that date. Used by Field wallet "Wallet Balance" card (typically p_as_of = today in Africa/Nairobi).

CREATE OR REPLACE FUNCTION public.officer_wallet_balance_as_of(p_officer_id uuid, p_as_of date)
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
  IF p_officer_id IS NULL OR p_as_of IS NULL THEN
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
      (SELECT SUM(amount_taken) FROM public.officer_field_taken WHERE officer_id = p_officer_id AND business_date <= p_as_of),
      0
    )
    + COALESCE(
      (SELECT SUM(amount) FROM public.repayments WHERE officer_id = p_officer_id AND actual_payment_date <= p_as_of),
      0
    )
    + COALESCE(
      (SELECT COUNT(*)::numeric * v_fee FROM public.loans WHERE officer_id = p_officer_id AND disbursement_date <= p_as_of),
      0
    )
    - COALESCE(
      (SELECT SUM(principal) FROM public.loans WHERE officer_id = p_officer_id AND disbursement_date <= p_as_of),
      0
    )
    - COALESCE(
      (SELECT SUM(amount) FROM public.expenses WHERE officer_id = p_officer_id AND expense_date <= p_as_of),
      0
    )
  INTO v_balance;

  RETURN COALESCE(v_balance, 0);
END;
$$;

COMMENT ON FUNCTION public.officer_wallet_balance_as_of(uuid, date) IS
  'Cumulative field wallet through p_as_of (inclusive): taken + repayments + (loan count × fee) − principal − expenses.';

GRANT EXECUTE ON FUNCTION public.officer_wallet_balance_as_of(uuid, date) TO authenticated;
