-- Expense reassignment updates expenses.officer_id only; this is an ownership move,
-- not a new cash expense on the receiving officer's historical expense_date.
-- Align with loan reassignment behavior (skip daily non-negative enforcement for officer-only move).

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

  -- Administrative reassignment only: keep amount/date unchanged, move ownership.
  -- Do NOT treat this as a fresh expense on destination day.
  IF TG_OP = 'UPDATE'
     AND OLD.officer_id IS DISTINCT FROM NEW.officer_id
     AND OLD.amount IS NOT DISTINCT FROM NEW.amount
     AND OLD.expense_date IS NOT DISTINCT FROM NEW.expense_date THEN
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

COMMENT ON FUNCTION public.enforce_expense_field_wallet_nonnegative() IS
  'Rejects expenses that make day wallet negative; skips check when only officer_id changes (same amount/date), i.e. administrative reassignment.';
