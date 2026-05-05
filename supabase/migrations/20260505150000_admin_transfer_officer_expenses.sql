-- Admin-only: reassign posted expenses from one loan officer to another (atomic UPDATE).
-- Field wallet triggers still apply per row; transfer may fail if the destination officer’s wallet would go negative on any affected expense date.

CREATE OR REPLACE FUNCTION public.admin_transfer_officer_expenses(
  p_from_officer_id uuid,
  p_to_officer_id uuid,
  p_expense_ids uuid[] DEFAULT NULL
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n bigint := 0;
  v_partial boolean;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;

  IF p_from_officer_id IS NULL OR p_to_officer_id IS NULL THEN
    RAISE EXCEPTION 'Source and destination officer are required' USING ERRCODE = '22023';
  END IF;

  IF p_from_officer_id = p_to_officer_id THEN
    RAISE EXCEPTION 'Source and destination officers must be different' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = p_from_officer_id AND u.role = 'officer'
  ) THEN
    RAISE EXCEPTION 'Source user is not an officer' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = p_to_officer_id AND u.role = 'officer'
  ) THEN
    RAISE EXCEPTION 'Destination user is not an officer' USING ERRCODE = '22023';
  END IF;

  v_partial := p_expense_ids IS NOT NULL AND cardinality(p_expense_ids) > 0;

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
    'admin.expenses.transfer',
    'officer',
    p_from_officer_id::text,
    jsonb_build_object(
      'to_officer_id', p_to_officer_id,
      'updated_count', n,
      'selected_ids_only', v_partial
    )
  );

  RETURN n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_transfer_officer_expenses(uuid, uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.admin_transfer_officer_expenses(uuid, uuid, uuid[]) IS
  'Admin only: set expenses.officer_id from source officer to destination. If p_expense_ids is null or empty, moves all expenses for the source officer. Respects field wallet non-negative trigger on the destination.';
