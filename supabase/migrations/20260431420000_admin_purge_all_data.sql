-- Destructive reset: admin-only RPC. Truncates all application tables; optionally removes non-admin users from public + auth.

CREATE OR REPLACE FUNCTION public.admin_purge_all_data(p_mode text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_ids uuid[];
  v_n int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.users u WHERE u.id = auth.uid() AND u.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Only admins can purge data';
  END IF;

  IF p_mode IS NULL OR p_mode NOT IN ('keep_all_users', 'keep_admins_only') THEN
    RAISE EXCEPTION 'Invalid mode (use keep_all_users or keep_admins_only)';
  END IF;

  -- Allow truncating branches while keeping user rows
  UPDATE public.users SET branch_id = NULL;

  TRUNCATE TABLE
    public.repayment_delete_requests,
    public.repayments,
    public.deleted_repayment_records,
    public.loans,
    public.deleted_loan_records,
    public.loan_increase_exception_requests,
    public.attendance_records,
    public.centre_meetings,
    public.expense_defaults,
    public.expenses,
    public.officer_field_taken,
    public.officer_wallet_balances,
    public.borrowers,
    public.groups,
    public.centers,
    public.loan_products,
    public.holidays,
    public.system_config,
    public.audit_logs,
    public.branches
  RESTART IDENTITY CASCADE;

  -- Minimal config so the app can load after purge
  INSERT INTO public.system_config (key, value) VALUES
    ('currency', 'TZS'),
    ('systemName', 'Microfinance'),
    ('applicationFeePerDisbursement', '0'),
    ('attendanceMinMeetingsForIncreaseEligibility', '6'),
    ('attendanceRequireNoDefaultForAutoIncrease', 'true')
  ON CONFLICT (key) DO NOTHING;

  IF p_mode = 'keep_all_users' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'mode', p_mode,
      'users', 'all_public_users_kept'
    );
  END IF;

  -- keep_admins_only: remove managers and officers from public.users and auth.users
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[]) INTO v_ids
  FROM public.users
  WHERE role IS DISTINCT FROM 'admin';

  IF cardinality(v_ids) = 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'mode', p_mode,
      'removed_auth_users', 0
    );
  END IF;

  DELETE FROM public.users WHERE id = ANY (v_ids);
  GET DIAGNOSTICS v_n = ROW_COUNT;

  DELETE FROM auth.users WHERE id = ANY (v_ids);

  RETURN jsonb_build_object(
    'ok', true,
    'mode', p_mode,
    'removed_auth_users', cardinality(v_ids),
    'removed_public_users', v_n
  );
END;
$$;

COMMENT ON FUNCTION public.admin_purge_all_data(text) IS
  'Admin only. Truncates all business tables and re-seeds minimal system_config. keep_all_users: keeps all public/auth users. keep_admins_only: deletes non-admin users from public.users and auth.users.';

GRANT EXECUTE ON FUNCTION public.admin_purge_all_data(text) TO authenticated;
