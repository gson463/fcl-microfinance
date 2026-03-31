-- Single-call summary for safe user deletion (Edge Functions use service_role only).

CREATE OR REPLACE FUNCTION public.user_associated_data_summary(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'loans', (SELECT COUNT(*)::bigint FROM public.loans WHERE officer_id = p_user_id),
    'repayments', (SELECT COUNT(*)::bigint FROM public.repayments WHERE officer_id = p_user_id),
    'expenses', (SELECT COUNT(*)::bigint FROM public.expenses WHERE officer_id = p_user_id),
    'borrowers', (SELECT COUNT(*)::bigint FROM public.borrowers WHERE loan_officer_id = p_user_id),
    'centers', (SELECT COUNT(*)::bigint FROM public.centers WHERE loan_officer_id = p_user_id),
    'groups', (SELECT COUNT(*)::bigint FROM public.groups WHERE loan_officer_id = p_user_id),
    'repayment_delete_requests', (SELECT COUNT(*)::bigint FROM public.repayment_delete_requests WHERE officer_id = p_user_id),
    'audit_logs', (SELECT COUNT(*)::bigint FROM public.audit_logs WHERE user_id = p_user_id),
    'deleted_loan_records', (
      SELECT COUNT(*)::bigint FROM public.deleted_loan_records
      WHERE officer_id = p_user_id OR requested_by_officer_id = p_user_id
    ),
    'deleted_repayment_records', (
      SELECT COUNT(*)::bigint FROM public.deleted_repayment_records
      WHERE officer_id = p_user_id OR requested_by_officer_id = p_user_id
    )
  );
$$;

COMMENT ON FUNCTION public.user_associated_data_summary(uuid) IS
  'Row counts referencing this user; used for safe-delete checks (Edge Functions).';

REVOKE ALL ON FUNCTION public.user_associated_data_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_associated_data_summary(uuid) TO service_role;
