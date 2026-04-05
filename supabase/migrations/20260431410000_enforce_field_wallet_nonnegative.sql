-- Block any loan disbursement or expense that would make the officer field wallet negative
-- for that calendar day (same formula as officer_wallet_balance_for_period).

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
    -- UPDATE: same officer + same day — balance includes this row’s (+fee − old principal); adjust.
    IF OLD.officer_id IS NOT DISTINCT FROM NEW.officer_id
       AND OLD.disbursement_date IS NOT DISTINCT FROM NEW.disbursement_date THEN
      SELECT public.officer_wallet_balance_for_period(NEW.officer_id, NEW.disbursement_date, NEW.disbursement_date)
      INTO v_balance;
      v_projected := COALESCE(v_balance, 0) + COALESCE(OLD.principal, 0) - COALESCE(NEW.principal, 0);
    ELSE
      -- New officer and/or day: current row is not in RPC for the target day as the old row.
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

CREATE OR REPLACE FUNCTION public.enforce_expense_field_wallet_nonnegative()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance numeric;
  v_projected numeric;
BEGIN
  IF NEW.officer_id IS NULL OR NEW.expense_date IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(
    hashtext('field_wallet_day:' || NEW.officer_id::text || ':' || NEW.expense_date::text)
  );

  IF TG_OP = 'INSERT' THEN
    SELECT public.officer_wallet_balance_for_period(NEW.officer_id, NEW.expense_date, NEW.expense_date)
    INTO v_balance;
    v_projected := COALESCE(v_balance, 0) - COALESCE(NEW.amount, 0);
  ELSE
    IF OLD.officer_id IS NOT DISTINCT FROM NEW.officer_id
       AND OLD.expense_date IS NOT DISTINCT FROM NEW.expense_date THEN
      SELECT public.officer_wallet_balance_for_period(NEW.officer_id, NEW.expense_date, NEW.expense_date)
      INTO v_balance;
      v_projected := COALESCE(v_balance, 0) + COALESCE(OLD.amount, 0) - COALESCE(NEW.amount, 0);
    ELSE
      SELECT public.officer_wallet_balance_for_period(NEW.officer_id, NEW.expense_date, NEW.expense_date)
      INTO v_balance;
      v_projected := COALESCE(v_balance, 0) - COALESCE(NEW.amount, 0);
    END IF;
  END IF;

  IF v_projected < 0 THEN
    RAISE EXCEPTION
      'Field wallet for this officer on % would be negative after this expense (projected %).',
      NEW.expense_date,
      round(v_projected, 2)
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_loans_enforce_field_wallet_nonnegative ON public.loans;
CREATE TRIGGER trg_loans_enforce_field_wallet_nonnegative
  BEFORE INSERT OR UPDATE OF officer_id, principal, disbursement_date
  ON public.loans
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_loan_field_wallet_nonnegative();

DROP TRIGGER IF EXISTS trg_expenses_enforce_field_wallet_nonnegative ON public.expenses;
CREATE TRIGGER trg_expenses_enforce_field_wallet_nonnegative
  BEFORE INSERT OR UPDATE OF officer_id, amount, expense_date
  ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_expense_field_wallet_nonnegative();

COMMENT ON FUNCTION public.enforce_loan_field_wallet_nonnegative() IS
  'Rejects loan rows that would make officer_wallet_balance_for_period for that disbursement day negative.';
COMMENT ON FUNCTION public.enforce_expense_field_wallet_nonnegative() IS
  'Rejects expense rows that would make officer_wallet_balance_for_period for that expense day negative.';
