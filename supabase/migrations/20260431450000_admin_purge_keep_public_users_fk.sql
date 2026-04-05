-- Fix: TRUNCATE ... branches CASCADE also truncated public.users (FK users.branch_id -> branches).
-- Drop that FK before truncate, then re-add after branches is empty.

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

  ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_branch_id_fkey;
  UPDATE public.users SET branch_id = NULL WHERE branch_id IS NOT NULL;

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

  ALTER TABLE public.users
    ADD CONSTRAINT users_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches (id);

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
  'Admin only. Truncates business tables; preserves public.users during branch truncate by dropping FK first.';

GRANT EXECUTE ON FUNCTION public.admin_purge_all_data(text) TO authenticated;
