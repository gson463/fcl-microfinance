-- Officer reassignment updates loans.officer_id only; that must not be treated as a new
-- disbursement on the receiving officer's historical disbursement_date (would falsely fail
-- enforce_loan_field_wallet_nonnegative).

CREATE OR REPLACE FUNCTION public.enforce_loan_field_wallet_nonnegative()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee numeric;
  v_balance numeric;
  v_projected numeric;
BEGIN
  IF NEW.officer_id IS NULL OR NEW.disbursement_date IS NULL THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD.officer_id IS DISTINCT FROM NEW.officer_id
     AND OLD.principal IS NOT DISTINCT FROM NEW.principal
     AND OLD.disbursement_date IS NOT DISTINCT FROM NEW.disbursement_date THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('field_wallet_day:' || NEW.officer_id::text || ':' || NEW.disbursement_date::text)
  );

  SELECT COALESCE(NULLIF(trim(value), '')::numeric, 0) INTO v_fee
  FROM public.system_config
  WHERE key = 'applicationFeePerDisbursement'
  LIMIT 1;

  IF v_fee IS NULL THEN
    v_fee := 0;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT public.officer_wallet_balance_for_period(NEW.officer_id, NEW.disbursement_date, NEW.disbursement_date)
    INTO v_balance;
    v_projected := COALESCE(v_balance, 0) + v_fee - COALESCE(NEW.principal, 0);
  ELSE
    IF OLD.officer_id IS NOT DISTINCT FROM NEW.officer_id
       AND OLD.disbursement_date IS NOT DISTINCT FROM NEW.disbursement_date THEN
      SELECT public.officer_wallet_balance_for_period(NEW.officer_id, NEW.disbursement_date, NEW.disbursement_date)
      INTO v_balance;
      v_projected := COALESCE(v_balance, 0) + COALESCE(OLD.principal, 0) - COALESCE(NEW.principal, 0);
    ELSE
      SELECT public.officer_wallet_balance_for_period(NEW.officer_id, NEW.disbursement_date, NEW.disbursement_date)
      INTO v_balance;
      v_projected := COALESCE(v_balance, 0) + v_fee - COALESCE(NEW.principal, 0);
    END IF;
  END IF;

  IF v_projected < 0 THEN
    RAISE EXCEPTION
      'Field wallet for this officer on % would be negative after this disbursement (projected %).',
      NEW.disbursement_date,
      round(v_projected, 2)
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_loan_field_wallet_nonnegative() IS
  'Rejects loan rows that would make officer_wallet_balance_for_period for that disbursement day negative. Skips check when only officer_id changes (principal and disbursement_date unchanged): administrative reassignment, not a new cash disbursement.';
