-- Admin dashboard v2 metrics + drilldown (paginated JSON)
-- Interest "from disbursed loans" = total_payable - principal at origination (per loan product terms)

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_metrics(
  p_start_date date,
  p_end_date date
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
    (SELECT COALESCE(SUM(l.balance), 0) FROM public.loans l WHERE l.status = 'active'),
    (SELECT COALESCE(SUM(l.balance), 0) FROM public.loans l WHERE l.status = 'defaulted'),
    (SELECT COALESCE(SUM(l.balance), 0) FROM public.loans l WHERE l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp)),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l
      WHERE EXTRACT(YEAR FROM l.disbursement_date) = EXTRACT(YEAR FROM p_end_date)),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l),
    (SELECT COALESCE(SUM(GREATEST(0, l.total_payable - l.principal)), 0) FROM public.loans l
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp)),
    (SELECT COALESCE(SUM(GREATEST(0, l.total_payable - l.principal)), 0) FROM public.loans l
      WHERE l.disbursement_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = date_trunc('month', p_end_date::timestamp)),
    (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = date_trunc('month', p_end_date::timestamp)),
    (SELECT COALESCE(SUM(r.amount), 0) FROM public.repayments r
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = date_trunc('month', p_end_date::timestamp)),
    (SELECT COALESCE(SUM(GREATEST(0, l.principal - COALESCE((
          SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id
        ), 0))), 0)
      FROM public.loans l WHERE l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.outstanding_interest), 0) FROM public.loans l WHERE l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(
          GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0))
          + COALESCE(l.outstanding_interest, 0)
        ), 0)
      FROM public.loans l WHERE l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.status = 'defaulted'),
    (SELECT COALESCE(SUM(l.outstanding_interest), 0) FROM public.loans l WHERE l.status = 'defaulted'),
    (SELECT COALESCE(SUM(l.principal + l.outstanding_interest), 0) FROM public.loans l WHERE l.status = 'defaulted'),
    (SELECT COUNT(*)::bigint FROM public.branches),
    (SELECT COUNT(*)::bigint FROM public.users),
    (SELECT COUNT(*)::bigint FROM public.borrowers),
    (SELECT COUNT(*)::bigint FROM public.loans WHERE status = 'active');
$$;

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_drilldown(
  p_metric text,
  p_start_date date,
  p_end_date date,
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0
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
BEGIN
  IF p_metric = 'portfolio_active' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l WHERE l.status = 'active';
    SELECT COALESCE((
      SELECT jsonb_agg(to_jsonb(t))
      FROM (
        SELECT l.id, l.loan_id, l.principal, l.total_payable, l.balance, l.outstanding_interest, l.status::text AS status, l.disbursement_date,
          b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
        FROM public.loans l
        JOIN public.borrowers b ON b.id = l.borrower_id
        LEFT JOIN public.branches br ON br.id = b.branch_id
        WHERE l.status = 'active'
        ORDER BY l.disbursement_date DESC NULLS LAST
        LIMIT v_lim OFFSET v_off
      ) t
    ), '[]'::jsonb) INTO v_rows;

  ELSIF p_metric = 'portfolio_defaulted' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l WHERE l.status = 'defaulted';
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id, l.principal, l.total_payable, l.balance, l.outstanding_interest, l.status::text AS status, l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status = 'defaulted'
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'portfolio_general' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l WHERE l.status NOT IN ('paid', 'written_off');
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id, l.principal, l.total_payable, l.balance, l.outstanding_interest, l.status::text AS status, l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status NOT IN ('paid', 'written_off')
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'disbursed_monthly' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id, l.principal, l.total_payable, (l.total_payable - l.principal) AS embedded_interest,
        l.disbursement_date, l.status::text AS status,
        b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'disbursed_yearly' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      WHERE EXTRACT(YEAR FROM l.disbursement_date) = EXTRACT(YEAR FROM p_end_date);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id, l.principal, l.total_payable, (l.total_payable - l.principal) AS embedded_interest,
        l.disbursement_date, l.status::text AS status,
        b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE EXTRACT(YEAR FROM l.disbursement_date) = EXTRACT(YEAR FROM p_end_date)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'disbursed_overall' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l;
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id, l.principal, l.total_payable, (l.total_payable - l.principal) AS embedded_interest,
        l.disbursement_date, l.status::text AS status,
        b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'interest_disbursed_month' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id, l.principal, l.total_payable, (l.total_payable - l.principal) AS interest_amount,
        l.disbursement_date, lp.interest_rate AS product_interest_rate,
        b.first_name || ' ' || b.surname AS borrower_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.loan_products lp ON lp.id = l.product_id
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'interest_disbursed_range' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      WHERE l.disbursement_date::date BETWEEN p_start_date AND p_end_date;
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id, l.principal, l.total_payable, (l.total_payable - l.principal) AS interest_amount,
        l.disbursement_date, lp.interest_rate AS product_interest_rate,
        b.first_name || ' ' || b.surname AS borrower_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.loan_products lp ON lp.id = l.product_id
      WHERE l.disbursement_date::date BETWEEN p_start_date AND p_end_date
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric IN ('collected_month_principal', 'collected_month_interest', 'collected_month_total') THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.repayments r
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = date_trunc('month', p_end_date::timestamp);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT r.id, r.amount, r.principal_paid, r.interest_paid, r.actual_payment_date,
        l.loan_id, b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
      FROM public.repayments r
      JOIN public.loans l ON l.id = r.loan_id
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = date_trunc('month', p_end_date::timestamp)
      ORDER BY r.actual_payment_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'outstanding_principal' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l WHERE l.status NOT IN ('paid', 'written_off');
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id,
        GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0)) AS outstanding_principal,
        l.balance, l.outstanding_interest, l.status::text AS status,
        b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status NOT IN ('paid', 'written_off')
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'outstanding_interest' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l WHERE l.status NOT IN ('paid', 'written_off') AND l.outstanding_interest > 0;
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id, l.outstanding_interest, l.balance, l.status::text AS status, l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status NOT IN ('paid', 'written_off') AND l.outstanding_interest > 0
      ORDER BY l.outstanding_interest DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'outstanding_total' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l WHERE l.status NOT IN ('paid', 'written_off');
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id, l.balance AS outstanding_total, l.outstanding_interest,
        GREATEST(0, l.principal - COALESCE((SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id), 0)) AS outstanding_principal,
        l.status::text AS status,
        b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status NOT IN ('paid', 'written_off')
      ORDER BY l.balance DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'default_disbursed' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l WHERE l.status = 'defaulted';
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id, l.principal AS disbursed_principal, l.balance, l.outstanding_interest, l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status = 'defaulted'
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'default_interest' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l WHERE l.status = 'defaulted';
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id, l.outstanding_interest, l.principal, l.balance, l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status = 'defaulted'
      ORDER BY l.outstanding_interest DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'default_total' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l WHERE l.status = 'defaulted';
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT l.id, l.loan_id, (l.principal + l.outstanding_interest) AS default_total_amount, l.principal, l.outstanding_interest, l.balance,
        l.disbursement_date, b.first_name || ' ' || b.surname AS borrower_name, br.name AS branch_name
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.status = 'defaulted'
      ORDER BY (l.principal + l.outstanding_interest) DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSE
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb, 'error', 'unknown_metric');
  END IF;

  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_metrics(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_drilldown(text, date, date, int, int) TO authenticated;
