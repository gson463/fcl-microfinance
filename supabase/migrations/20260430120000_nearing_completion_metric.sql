-- KPI: active loans whose final schedule installment due date falls within the next N days (default 14).
-- Adds p_nearing_days to get_admin_dashboard_metrics and get_admin_dashboard_drilldown.

DROP FUNCTION IF EXISTS public.get_admin_dashboard_metrics(date, date, uuid, uuid);
DROP FUNCTION IF EXISTS public.get_admin_dashboard_drilldown(text, date, date, int, int, uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_metrics(
  p_start_date date,
  p_end_date date,
  p_branch_id uuid DEFAULT NULL,
  p_officer_id uuid DEFAULT NULL,
  p_nearing_days int DEFAULT 14
)
RETURNS TABLE (
  portfolio_active numeric,
  portfolio_defaulted numeric,
  portfolio_general numeric,
  disbursed_monthly numeric,
  disbursed_yearly numeric,
  disbursed_overall numeric,
  interest_from_disbursed_month numeric,
  interest_from_disbursed_range numeric,
  collected_month_principal numeric,
  collected_month_interest numeric,
  collected_month_total numeric,
  outstanding_principal numeric,
  outstanding_interest numeric,
  outstanding_total numeric,
  default_disbursed_principal numeric,
  default_interest_amount numeric,
  default_total_amount numeric,
  expected_today numeric,
  nearing_completion bigint,
  total_branches bigint,
  total_users bigint,
  total_borrowers bigint,
  active_loans_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COALESCE(SUM(l.balance), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'active'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(l.balance), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(l.balance), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE EXTRACT(YEAR FROM l.disbursement_date) = EXTRACT(YEAR FROM p_end_date)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(GREATEST(0, l.total_payable - l.principal)), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(GREATEST(0, l.total_payable - l.principal)), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.disbursement_date::date BETWEEN p_start_date AND p_end_date
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r
      JOIN public.loans l ON l.id = r.loan_id
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r
      JOIN public.loans l ON l.id = r.loan_id
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(r.amount), 0) FROM public.repayments r
      JOIN public.loans l ON l.id = r.loan_id
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(GREATEST(0, l.principal - COALESCE((
          SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id
        ), 0))), 0)
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(l.outstanding_interest), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(
          GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0))
          + COALESCE(l.outstanding_interest, 0)
        ), 0)
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(l.outstanding_interest), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(l.principal + l.outstanding_interest), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM((elem->>'amount')::numeric), 0)
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS elem
      WHERE (elem->>'dueDate')::date = CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COUNT(*)::bigint
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'active'
        AND jsonb_array_length(COALESCE(l.schedule, '[]'::jsonb)) > 0
        AND (
          SELECT MAX((elem->>'dueDate')::date)
          FROM jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS elem
        ) IS NOT NULL
        AND (
          SELECT MAX((elem->>'dueDate')::date)
          FROM jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS elem
        ) BETWEEN CURRENT_DATE AND (CURRENT_DATE + GREATEST(1, LEAST(COALESCE(p_nearing_days, 14), 365)))
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    CASE WHEN p_branch_id IS NULL THEN (SELECT COUNT(*)::bigint FROM public.branches) ELSE 1::bigint END,
    (SELECT COUNT(*)::bigint FROM public.users u
      WHERE (p_branch_id IS NULL OR u.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR u.id = p_officer_id)),
    (SELECT COUNT(*)::bigint FROM public.borrowers b
      WHERE (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR b.loan_officer_id = p_officer_id)),
    (SELECT COUNT(*)::bigint FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'active'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id));
$$;

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_drilldown(
  p_metric text,
  p_start_date date,
  p_end_date date,
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0,
  p_branch_id uuid DEFAULT NULL,
  p_officer_id uuid DEFAULT NULL,
  p_nearing_days int DEFAULT 14
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_rows jsonb;
  v_lim int := GREATEST(1, LEAST(COALESCE(p_limit, 25), 200));
  v_off int := GREATEST(0, COALESCE(p_offset, 0));
  v_horizon int := GREATEST(1, LEAST(COALESCE(p_nearing_days, 14), 365));
BEGIN
  IF p_metric = 'portfolio_active' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'active'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE((
      SELECT jsonb_agg(to_jsonb(t))
      FROM (
        SELECT
          l.loan_id,
          l.disbursement_date,
          b.first_name || ' ' || b.surname AS borrower_name,
          br.name AS branch_name,
          l.principal AS principal_disbursed,
          GREATEST(0, COALESCE(l.total_payable, 0) - COALESCE(l.principal, 0)) AS expected_interest,
          (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS principal_collected,
          (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS interest_collected,
          l.total_payable,
          l.balance,
          GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0)) AS outstanding_principal,
          l.outstanding_interest,
          l.status::text AS status
        FROM public.loans l
        JOIN public.borrowers b ON b.id = l.borrower_id
        LEFT JOIN public.branches br ON br.id = b.branch_id
        WHERE l.status = 'active'
          AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
          AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        ORDER BY l.disbursement_date DESC NULLS LAST
        LIMIT v_lim OFFSET v_off
      ) t
    ), '[]'::jsonb) INTO v_rows;

  ELSIF p_metric = 'portfolio_defaulted' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        l.principal AS principal_disbursed,
        GREATEST(0, COALESCE(l.total_payable, 0) - COALESCE(l.principal, 0)) AS expected_interest,
        (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS principal_collected,
        (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS interest_collected,
        l.total_payable,
        l.balance,
        GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0)) AS outstanding_principal,
        l.outstanding_interest,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'portfolio_general' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        l.principal AS principal_disbursed,
        GREATEST(0, COALESCE(l.total_payable, 0) - COALESCE(l.principal, 0)) AS expected_interest,
        (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS principal_collected,
        (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS interest_collected,
        l.total_payable,
        l.balance,
        GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0)) AS outstanding_principal,
        l.outstanding_interest,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'disbursed_monthly' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        l.principal AS principal_disbursed,
        GREATEST(0, COALESCE(l.total_payable, 0) - COALESCE(l.principal, 0)) AS expected_interest,
        (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS principal_collected,
        (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS interest_collected,
        l.total_payable,
        l.balance,
        GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0)) AS outstanding_principal,
        l.outstanding_interest,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'disbursed_yearly' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE EXTRACT(YEAR FROM l.disbursement_date) = EXTRACT(YEAR FROM p_end_date)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        l.principal AS principal_disbursed,
        GREATEST(0, COALESCE(l.total_payable, 0) - COALESCE(l.principal, 0)) AS expected_interest,
        (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS principal_collected,
        (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS interest_collected,
        l.total_payable,
        l.balance,
        GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0)) AS outstanding_principal,
        l.outstanding_interest,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE EXTRACT(YEAR FROM l.disbursement_date) = EXTRACT(YEAR FROM p_end_date)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'disbursed_overall' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        l.principal AS principal_disbursed,
        GREATEST(0, COALESCE(l.total_payable, 0) - COALESCE(l.principal, 0)) AS expected_interest,
        (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS principal_collected,
        (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS interest_collected,
        l.total_payable,
        l.balance,
        GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0)) AS outstanding_principal,
        l.outstanding_interest,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'interest_disbursed_month' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        l.principal AS principal_disbursed,
        GREATEST(0, COALESCE(l.total_payable, 0) - COALESCE(l.principal, 0)) AS expected_interest,
        (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS principal_collected,
        (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS interest_collected,
        l.total_payable,
        l.balance,
        GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0)) AS outstanding_principal,
        l.outstanding_interest,
        lp.interest_rate AS product_interest_rate,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.loan_products lp ON lp.id = l.product_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'interest_disbursed_range' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.disbursement_date::date BETWEEN p_start_date AND p_end_date
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        l.principal AS principal_disbursed,
        GREATEST(0, COALESCE(l.total_payable, 0) - COALESCE(l.principal, 0)) AS expected_interest,
        (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS principal_collected,
        (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS interest_collected,
        l.total_payable,
        l.balance,
        GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0)) AS outstanding_principal,
        l.outstanding_interest,
        lp.interest_rate AS product_interest_rate,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.loan_products lp ON lp.id = l.product_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.disbursement_date::date BETWEEN p_start_date AND p_end_date
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric IN ('collected_month_principal', 'collected_month_interest', 'collected_month_total') THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.repayments r
      JOIN public.loans l ON l.id = r.loan_id
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        r.actual_payment_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        r.principal_paid,
        r.interest_paid,
        r.amount
      FROM public.repayments r
      JOIN public.loans l ON l.id = r.loan_id
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY r.actual_payment_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'outstanding_principal' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0)) AS outstanding_principal,
        l.balance,
        l.outstanding_interest,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'outstanding_interest' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status NOT IN ('paid', 'written_off') AND l.outstanding_interest > 0
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        l.outstanding_interest,
        l.balance,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status NOT IN ('paid', 'written_off') AND l.outstanding_interest > 0
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY l.outstanding_interest DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'outstanding_total' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0)) AS outstanding_principal,
        l.outstanding_interest,
        l.balance AS outstanding_total,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY l.balance DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'default_disbursed' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        l.principal AS disbursed_principal,
        GREATEST(0, COALESCE(l.total_payable, 0) - COALESCE(l.principal, 0)) AS expected_interest,
        (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS principal_collected,
        (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.loan_id = l.id) AS interest_collected,
        l.total_payable,
        l.balance,
        l.outstanding_interest,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'default_interest' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        l.principal AS disbursed_principal,
        l.outstanding_interest,
        l.balance,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY l.outstanding_interest DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'default_total' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        l.principal,
        l.outstanding_interest,
        (l.principal + l.outstanding_interest) AS default_total_amount,
        l.balance,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY (l.principal + l.outstanding_interest) DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'expected_today' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM (
      SELECT l.id
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS elem
      WHERE (elem->>'dueDate')::date = CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      GROUP BY l.id
    ) sub;
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        SUM((elem->>'amount')::numeric) AS due_today_amount,
        l.principal,
        l.balance,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS elem
      WHERE (elem->>'dueDate')::date = CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      GROUP BY l.id
      ORDER BY due_today_amount DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'nearing_completion' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'active'
        AND jsonb_array_length(COALESCE(l.schedule, '[]'::jsonb)) > 0
        AND (
          SELECT MAX((elem->>'dueDate')::date)
          FROM jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS elem
        ) IS NOT NULL
        AND (
          SELECT MAX((elem->>'dueDate')::date)
          FROM jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS elem
        ) BETWEEN CURRENT_DATE AND (CURRENT_DATE + v_horizon)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        (SELECT MAX((e2->>'dueDate')::date) FROM jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS e2) AS last_installment_due,
        (
          (SELECT MAX((e3->>'dueDate')::date) FROM jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS e3)
          - CURRENT_DATE
        )::int AS days_to_final_due,
        (
          SELECT COUNT(*)::int FROM jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS e4
          WHERE COALESCE((e4->>'paidAmount')::numeric, 0) < COALESCE((e4->>'amount')::numeric, 0) - 0.01
        ) AS remaining_installments,
        l.balance,
        l.total_payable,
        l.principal,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status = 'active'
        AND jsonb_array_length(COALESCE(l.schedule, '[]'::jsonb)) > 0
        AND (
          SELECT MAX((e1->>'dueDate')::date)
          FROM jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS e1
        ) BETWEEN CURRENT_DATE AND (CURRENT_DATE + v_horizon)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
      ORDER BY last_installment_due ASC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSE
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb, 'error', 'unknown_metric');
  END IF;

  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_metrics(date, date, uuid, uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_drilldown(text, date, date, int, int, uuid, uuid, int) TO authenticated;
