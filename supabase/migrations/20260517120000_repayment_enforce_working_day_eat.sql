-- Repayment collection dates must match working-day rules used for schedules and KPIs:
-- Monday–Saturday (Postgres DOW: Sun=0) and not listed in public.holidays.

CREATE OR REPLACE FUNCTION public.is_working_day_eat(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_date IS NOT NULL
     AND EXTRACT(DOW FROM p_date) <> 0::numeric
     AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.date = p_date);
$$;

COMMENT ON FUNCTION public.is_working_day_eat(date) IS
  'True if p_date is not Sunday and not in public.holidays (same rule as next_working_day_after_exclusive / schedule getNextWorkingDay).';

GRANT EXECUTE ON FUNCTION public.is_working_day_eat(date) TO authenticated;

-- Server-side enforcement for the standard repayment path
CREATE OR REPLACE FUNCTION public.record_repayment_wallet_then_recalculate(
  p_loan_id uuid,
  p_borrower_id uuid,
  p_amount numeric,
  p_officer_id uuid,
  p_actual_payment_date date,
  p_prepayment_amount numeric,
  p_scheduled_due_snapshot numeric,
  p_wallet_split_source text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_loan_id IS NULL OR p_borrower_id IS NULL OR p_officer_id IS NULL OR p_actual_payment_date IS NULL THEN
    RAISE EXCEPTION 'loan_id, borrower_id, officer_id, actual_payment_date required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  IF NOT public.is_working_day_eat(p_actual_payment_date) THEN
    RAISE EXCEPTION
      'actual_payment_date must be a working day (not Sunday, not in public holidays): %',
      p_actual_payment_date
      USING ERRCODE = '23514';
  END IF;

  INSERT INTO public.repayments (
    loan_id,
    borrower_id,
    amount,
    officer_id,
    payment_date,
    actual_payment_date,
    prepayment_amount,
    scheduled_due_snapshot,
    wallet_split_source
  )
  VALUES (
    p_loan_id,
    p_borrower_id,
    p_amount,
    p_officer_id,
    p_actual_payment_date,
    p_actual_payment_date,
    COALESCE(p_prepayment_amount, 0),
    COALESCE(p_scheduled_due_snapshot, 0),
    NULLIF(trim(COALESCE(p_wallet_split_source, '')), '')
  )
  RETURNING id INTO v_id;

  PERFORM public.recalculate_loan_schedule(p_loan_id);
  PERFORM public.refresh_loan_status_for_id(p_loan_id);
  PERFORM public.sync_borrower_paid_up_for(p_borrower_id);

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_repayment_wallet_then_recalculate(
  uuid, uuid, numeric, uuid, date, numeric, numeric, text
) IS
  'Inserts repayment (working-day date only: not Sunday, not public.holidays), recalculates schedule, refreshes loan status and borrower eligibility.';

-- Catch direct PostgREST inserts/updates (admin tooling) after normalize trigger fills actual_payment_date.
CREATE OR REPLACE FUNCTION public.repayments_enforce_working_payment_date()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.actual_payment_date IS NOT NULL
     AND NOT public.is_working_day_eat(NEW.actual_payment_date) THEN
    RAISE EXCEPTION
      'Repayment actual_payment_date must be a working day (not Sunday, not in public holidays): %',
      NEW.actual_payment_date
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

-- Name sorts after trg_repayments_field_wallet_normalize so normalization runs first on INSERT.
DROP TRIGGER IF EXISTS trg_repayments_working_day_enforce ON public.repayments;
CREATE TRIGGER trg_repayments_working_day_enforce
  BEFORE INSERT OR UPDATE OF payment_date, actual_payment_date
  ON public.repayments
  FOR EACH ROW
  EXECUTE FUNCTION public.repayments_enforce_working_payment_date();
