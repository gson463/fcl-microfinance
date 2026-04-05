-- Aggregates for officer dashboard KPI strip (selected date range; avoids client row limits).

CREATE OR REPLACE FUNCTION public.officer_dashboard_range_kpis(p_officer_id uuid, p_start date, p_end date)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
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
  'Loan officer: total principal disbursed and total cash collected in [p_start, p_end] (actual payment dates).';

GRANT EXECUTE ON FUNCTION public.officer_dashboard_range_kpis(uuid, date, date) TO authenticated;
