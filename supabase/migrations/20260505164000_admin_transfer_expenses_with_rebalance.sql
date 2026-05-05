-- Admin-only helper: auto-fix destination daily wallet negatives caused by expense transfer
-- by topping up officer_field_taken for affected dates, then transfer expenses.
-- Returns JSON summary for UI reporting.

CREATE OR REPLACE FUNCTION public.admin_transfer_officer_expenses_with_rebalance(
  p_from_officer_id uuid,
  p_to_officer_id uuid,
  p_expense_ids uuid[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partial boolean;
  n bigint := 0;
  v_topup_total numeric := 0;
  v_topup_dates int := 0;
  r record;
  v_balance numeric;
  v_needed numeric;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_from_officer_id IS NULL OR p_to_officer_id IS NULL THEN
    RAISE EXCEPTION 'Source and destination officers are required' USING ERRCODE = '22023';
  END IF;
  IF p_from_officer_id = p_to_officer_id THEN
    RAISE EXCEPTION 'Source and destination officers must be different' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_from_officer_id AND u.role = 'officer') THEN
    RAISE EXCEPTION 'Source user is not an officer' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = p_to_officer_id AND u.role = 'officer') THEN
    RAISE EXCEPTION 'Destination user is not an officer' USING ERRCODE = '22023';
  END IF;

  v_partial := p_expense_ids IS NOT NULL AND cardinality(p_expense_ids) > 0;

  -- Guardrail: if destination day was explicitly banked, daily balance function returns 0 by design.
  -- Auto-topup cannot fix that state reliably.
  IF EXISTS (
    SELECT 1
    FROM public.expenses e
    JOIN public.officer_withdraw_to_bank w
      ON w.officer_id = p_to_officer_id
     AND w.business_date = e.expense_date
    WHERE e.officer_id = p_from_officer_id
      AND (NOT v_partial OR e.id = ANY (p_expense_ids))
  ) THEN
    RAISE EXCEPTION
      'Destination has "withdraw to bank" for at least one affected date; clear that marker first for rebalance transfer.'
      USING ERRCODE = '23514';
  END IF;

  FOR r IN
    SELECT e.expense_date::date AS d, SUM(COALESCE(e.amount, 0))::numeric AS transfer_amount
    FROM public.expenses e
    WHERE e.officer_id = p_from_officer_id
      AND (NOT v_partial OR e.id = ANY (p_expense_ids))
    GROUP BY e.expense_date
  LOOP
    SELECT public.officer_wallet_balance_for_period(p_to_officer_id, r.d, r.d) INTO v_balance;
    v_needed := GREATEST(0, COALESCE(r.transfer_amount, 0) - COALESCE(v_balance, 0));

    IF v_needed > 0 THEN
      INSERT INTO public.officer_field_taken (officer_id, business_date, amount_taken)
      VALUES (p_to_officer_id, r.d, v_needed)
      ON CONFLICT (officer_id, business_date)
      DO UPDATE SET amount_taken = public.officer_field_taken.amount_taken + EXCLUDED.amount_taken;

      v_topup_total := v_topup_total + v_needed;
      v_topup_dates := v_topup_dates + 1;
    END IF;
  END LOOP;

  IF v_partial THEN
    UPDATE public.expenses e
    SET officer_id = p_to_officer_id
    WHERE e.officer_id = p_from_officer_id
      AND e.id = ANY (p_expense_ids);
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSE
    UPDATE public.expenses e
    SET officer_id = p_to_officer_id
    WHERE e.officer_id = p_from_officer_id;
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    'admin.expenses.transfer_rebalance',
    'officer',
    p_from_officer_id::text,
    jsonb_build_object(
      'to_officer_id', p_to_officer_id,
      'updated_count', n,
      'selected_ids_only', v_partial,
      'topup_total', v_topup_total,
      'topup_dates', v_topup_dates
    )
  );

  RETURN jsonb_build_object(
    'updated_count', n,
    'topup_total', v_topup_total,
    'topup_dates', v_topup_dates,
    'selected_ids_only', v_partial
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_transfer_officer_expenses_with_rebalance(uuid, uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.admin_transfer_officer_expenses_with_rebalance(uuid, uuid, uuid[]) IS
  'Admin only: reassign expenses from source to destination and auto-topup destination officer_field_taken per affected date so transfer does not fail on daily non-negative wallet checks.';
