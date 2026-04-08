-- Single transaction: persist wallet columns on repayments, then allocate cash on the loan schedule.
-- Guarantees prepayment_amount / scheduled_due_snapshot / wallet_split_source are committed together
-- with recalculate_loan_schedule (no orphaned schedule update without a row, and no row without schedule refresh).

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
    p_scheduled_due_snapshot,
    NULLIF(trim(COALESCE(p_wallet_split_source, '')), '')
  )
  RETURNING id INTO v_id;

  PERFORM public.recalculate_loan_schedule(p_loan_id);

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.record_repayment_wallet_then_recalculate(
  uuid, uuid, numeric, uuid, date, numeric, numeric, text
) IS
  'Inserts repayment with wallet/report columns, then recalculates schedule in the same transaction.';

GRANT EXECUTE ON FUNCTION public.record_repayment_wallet_then_recalculate(
  uuid, uuid, numeric, uuid, date, numeric, numeric, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_repayment_wallet_then_recalculate(
  uuid, uuid, numeric, uuid, date, numeric, numeric, text
) TO service_role;
