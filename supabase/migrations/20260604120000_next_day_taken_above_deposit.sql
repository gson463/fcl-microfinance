-- Allow next-day taken > closing deposit at withdraw carry.
-- Records: amount_deposited, carried_to_next_day (physical), top_up_from_office, planned_next_day_taken.

ALTER TABLE public.officer_withdraw_to_bank
  ADD COLUMN IF NOT EXISTS planned_next_day_taken numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS top_up_from_office numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.officer_withdraw_to_bank.planned_next_day_taken IS
  'Total float officer planned for next working day (may exceed closing_deposit).';
COMMENT ON COLUMN public.officer_withdraw_to_bank.top_up_from_office IS
  'Portion of planned_next_day_taken to come from office next morning: GREATEST(0, planned − closing).';
COMMENT ON COLUMN public.officer_withdraw_to_bank.carried_to_next_day IS
  'Physical cash kept overnight: LEAST(planned_next_day_taken, closing_deposit).';

-- Legacy carry rows: planned = carried, no office top-up.
UPDATE public.officer_withdraw_to_bank
SET
  planned_next_day_taken = carried_to_next_day,
  top_up_from_office = 0
WHERE planned_next_day_taken = 0
  AND carried_to_next_day > 0;

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
  v_carry numeric;
  v_topup numeric;
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

    v_carry := LEAST(v_t, v_d);
    v_topup := GREATEST(0, v_t - v_d);
    v_next := public.next_working_day_after_exclusive(p_business_date);
    v_bank := GREATEST(0, v_d - v_t);

    INSERT INTO public.officer_withdraw_to_bank (
      officer_id,
      business_date,
      amount_deposited,
      closing_deposit,
      carried_to_next_day,
      planned_next_day_taken,
      top_up_from_office,
      next_business_date
    ) VALUES (
      v_officer_id,
      p_business_date,
      v_bank,
      v_d,
      v_carry,
      v_t,
      v_topup,
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
      planned_next_day_taken,
      top_up_from_office,
      next_business_date
    ) VALUES (
      v_officer_id,
      p_business_date,
      v_d,
      v_d,
      0,
      0,
      0,
      NULL
    );
    v_t := 0;
    v_carry := 0;
    v_topup := 0;
    v_bank := v_d;
    v_next := NULL;
  END IF;

  RETURN jsonb_build_object(
    'closing_deposit', v_d,
    'amount_deposited', v_bank,
    'carried_to_next_day', COALESCE(v_carry, 0),
    'planned_next_day_taken', COALESCE(v_t, 0),
    'top_up_from_office', COALESCE(v_topup, 0),
    'next_business_date', v_next
  );
END;
$$;

COMMENT ON FUNCTION public.officer_confirm_withdraw_with_carry(date, boolean, numeric) IS
  'Records withdraw-to-bank; optionally pre-fills officer_field_taken for next working day. Planned taken may exceed closing deposit; physical carry = LEAST(planned, closing), top_up = remainder from office.';

GRANT EXECUTE ON FUNCTION public.officer_confirm_withdraw_with_carry(date, boolean, numeric) TO authenticated;
