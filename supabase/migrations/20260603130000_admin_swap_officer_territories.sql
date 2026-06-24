-- Admin: swap two loan officers' branches and full portfolios (atomic).

CREATE OR REPLACE FUNCTION public.admin_swap_officer_territories(
  p_officer_a uuid,
  p_officer_b uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_a record;
  v_b record;
  v_branch_a uuid;
  v_branch_b uuid;
  n_centers int := 0;
  n_groups int := 0;
  n_borrowers int := 0;
  n_loans int := 0;
  n_repayments int := 0;
  n_expenses int := 0;
  n_meetings int := 0;
BEGIN
  IF NOT public.auth_is_admin() THEN
    RAISE EXCEPTION 'Admin only' USING ERRCODE = '42501';
  END IF;

  IF p_officer_a IS NULL OR p_officer_b IS NULL OR p_officer_a = p_officer_b THEN
    RAISE EXCEPTION 'Two distinct officers are required' USING ERRCODE = '22023';
  END IF;

  SELECT id, role, branch_id, full_name INTO v_a FROM public.users WHERE id = p_officer_a;
  SELECT id, role, branch_id, full_name INTO v_b FROM public.users WHERE id = p_officer_b;

  IF v_a.id IS NULL OR v_b.id IS NULL THEN
    RAISE EXCEPTION 'One or both officers not found' USING ERRCODE = '22023';
  END IF;

  IF v_a.role <> 'officer' OR v_b.role <> 'officer' THEN
    RAISE EXCEPTION 'Both users must be loan officers' USING ERRCODE = '22023';
  END IF;

  v_branch_a := v_a.branch_id;
  v_branch_b := v_b.branch_id;

  UPDATE public.users
  SET branch_id = CASE
    WHEN id = p_officer_a THEN v_branch_b
    WHEN id = p_officer_b THEN v_branch_a
  END,
  updated_at = now()
  WHERE id IN (p_officer_a, p_officer_b);

  UPDATE public.centers
  SET loan_officer_id = CASE
    WHEN loan_officer_id = p_officer_a THEN p_officer_b
    WHEN loan_officer_id = p_officer_b THEN p_officer_a
  END
  WHERE loan_officer_id IN (p_officer_a, p_officer_b);
  GET DIAGNOSTICS n_centers = ROW_COUNT;

  UPDATE public.groups
  SET loan_officer_id = CASE
    WHEN loan_officer_id = p_officer_a THEN p_officer_b
    WHEN loan_officer_id = p_officer_b THEN p_officer_a
  END
  WHERE loan_officer_id IN (p_officer_a, p_officer_b);
  GET DIAGNOSTICS n_groups = ROW_COUNT;

  UPDATE public.borrowers
  SET loan_officer_id = CASE
    WHEN loan_officer_id = p_officer_a THEN p_officer_b
    WHEN loan_officer_id = p_officer_b THEN p_officer_a
  END
  WHERE loan_officer_id IN (p_officer_a, p_officer_b);
  GET DIAGNOSTICS n_borrowers = ROW_COUNT;

  UPDATE public.loans
  SET officer_id = CASE
    WHEN officer_id = p_officer_a THEN p_officer_b
    WHEN officer_id = p_officer_b THEN p_officer_a
  END
  WHERE officer_id IN (p_officer_a, p_officer_b);
  GET DIAGNOSTICS n_loans = ROW_COUNT;

  UPDATE public.repayments
  SET officer_id = CASE
    WHEN officer_id = p_officer_a THEN p_officer_b
    WHEN officer_id = p_officer_b THEN p_officer_a
  END
  WHERE officer_id IN (p_officer_a, p_officer_b);
  GET DIAGNOSTICS n_repayments = ROW_COUNT;

  UPDATE public.expenses
  SET officer_id = CASE
    WHEN officer_id = p_officer_a THEN p_officer_b
    WHEN officer_id = p_officer_b THEN p_officer_a
  END
  WHERE officer_id IN (p_officer_a, p_officer_b);
  GET DIAGNOSTICS n_expenses = ROW_COUNT;

  UPDATE public.centre_meetings
  SET loan_officer_id = CASE
    WHEN loan_officer_id = p_officer_a THEN p_officer_b
    WHEN loan_officer_id = p_officer_b THEN p_officer_a
  END
  WHERE loan_officer_id IN (p_officer_a, p_officer_b);
  GET DIAGNOSTICS n_meetings = ROW_COUNT;

  INSERT INTO public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  VALUES (
    auth.uid(),
    'admin.officer_territory.swap',
    'officer',
    p_officer_a::text,
    jsonb_build_object(
      'officer_a', jsonb_build_object('id', p_officer_a, 'name', v_a.full_name, 'branch_id', v_branch_a),
      'officer_b', jsonb_build_object('id', p_officer_b, 'name', v_b.full_name, 'branch_id', v_branch_b),
      'counts', jsonb_build_object(
        'centers', n_centers,
        'groups', n_groups,
        'borrowers', n_borrowers,
        'loans', n_loans,
        'repayments', n_repayments,
        'expenses', n_expenses,
        'centre_meetings', n_meetings
      ),
      'note', 'Field wallet taken/withdraw history stays with each officer UUID.'
    )
  );

  RETURN jsonb_build_object(
    'officer_a', p_officer_a,
    'officer_b', p_officer_b,
    'branch_swapped', true,
    'counts', jsonb_build_object(
      'centers', n_centers,
      'groups', n_groups,
      'borrowers', n_borrowers,
      'loans', n_loans,
      'repayments', n_repayments,
      'expenses', n_expenses,
      'centre_meetings', n_meetings
    )
  );
END;
$$;

COMMENT ON FUNCTION public.admin_swap_officer_territories(uuid, uuid) IS
  'Admin: swap branch_id and portfolio (centers, groups, borrowers, loans, repayments, expenses, meetings) between two officers. Field wallet history stays on each UUID.';

GRANT EXECUTE ON FUNCTION public.admin_swap_officer_territories(uuid, uuid) TO authenticated;
