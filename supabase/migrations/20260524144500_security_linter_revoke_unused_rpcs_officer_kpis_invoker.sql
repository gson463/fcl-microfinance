-- Lint 0029 follow-up:
--
-- 1. user_associated_data_summary(uuid) — Edge/delete-user helpers use service_role only; original intent was
--    not SPA-callable (see 20260430140000). Bulk GRANT EXECUTE … TO authenticated re-exposed it; revoke.
--
-- 2. get_officer_stats / get_branch_stats / get_system_wide_stats — not referenced app or downstream RPCs;
--    revoke direct PostgREST access (service_role still has EXECUTE from routine grants).

REVOKE EXECUTE ON FUNCTION public.user_associated_data_summary(uuid) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_officer_stats(uuid, date, date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_branch_stats(uuid, date, date) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.get_system_wide_stats(date, date) FROM authenticated;


-- Officer range KPI aggregate: SECURITY INVOKER so loans_scope / repayments_scope RLS applies.
-- Eliminates SECURITY DEFINER cross-officer aggregation if a JWT passed another officer UUID.

CREATE OR REPLACE FUNCTION public.officer_dashboard_range_kpis(p_officer_id uuid, p_start date, p_end date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'principal_disbursed', COALESCE(
      (SELECT SUM(l.principal) FROM public.loans l
       WHERE l.officer_id = p_officer_id
         AND l.disbursement_date::date BETWEEN p_start AND p_end),
      0
    ),
    'amount_collected', COALESCE(
      (SELECT SUM(r.amount) FROM public.repayments r
       WHERE r.officer_id = p_officer_id
         AND r.actual_payment_date::date BETWEEN p_start AND p_end),
      0
    )
  );
$$;

COMMENT ON FUNCTION public.officer_dashboard_range_kpis(uuid, date, date) IS
  'Loan officer: principal disbursed and cash collected in [p_start, p_end]; SECURITY INVOKER (RLS scoped).';
