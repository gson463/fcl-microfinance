-- KPI "expected_tomorrow" (metrics, drilldown, officer-by-centre): due date = first calendar day
-- strictly after CURRENT_DATE that is not Sunday and not in public.holidays — aligned with client loan
-- schedule getNextWorkingDay (Monday–Saturday; Sunday and public holidays excluded).
-- Re-deploys get_admin_dashboard_metrics, get_admin_dashboard_drilldown, officer_projected_tomorrow_by_center.

CREATE OR REPLACE FUNCTION public.next_working_day_after_exclusive(p_ref date DEFAULT CURRENT_DATE)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  d date := p_ref + 1;
  i int := 0;
BEGIN
  LOOP
    IF i > 800 THEN
      RAISE EXCEPTION 'next_working_day_after_exclusive: iteration guard exceeded';
    END IF;
    i := i + 1;
    IF EXTRACT(DOW FROM d) <> 0::numeric
       AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.date = d) THEN
      RETURN d;
    END IF;
    d := d + 1;
  END LOOP;
END;
$body$;

COMMENT ON FUNCTION public.next_working_day_after_exclusive(date) IS
  'First date strictly after p_ref that is not Sunday (DOW 0) and not in public.holidays. Matches client schedule working-day skipping.';

GRANT EXECUTE ON FUNCTION public.next_working_day_after_exclusive(date) TO authenticated;

DROP FUNCTION IF EXISTS public.get_admin_dashboard_metrics(date, date, uuid, uuid, integer);

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
  active_loans_count bigint,
  disbursed_today numeric,
  collected_today numeric,
  expected_tomorrow numeric,
  borrowers_disbursed_today bigint,
  loans_delinquent_count bigint,
  loans_defaulted_count bigint,
  loans_book_count bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
WITH bounds AS (
  SELECT
    date_trunc('month', p_end_date::timestamp) AS month_start,
    date_trunc('year', p_end_date::timestamp) AS year_start,
    GREATEST(1, LEAST(COALESCE(p_nearing_days, 14), 365))::int AS nearing_days
),
loans_f AS (
  SELECT
    l.id,
    l.borrower_id,
    l.officer_id,
    l.status,
    l.balance,
    l.principal,
    l.total_payable,
    l.outstanding_interest,
    l.disbursement_date,
    l.schedule,
    b.branch_id
  FROM public.loans l
  JOIN public.borrowers b ON b.id = l.borrower_id
  WHERE (p_branch_id IS NULL OR b.branch_id = p_branch_id)
    AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
),
repayments_f AS (
  SELECT
    r.loan_id,
    r.amount,
    r.principal_paid,
    r.interest_paid,
    r.actual_payment_date
  FROM public.repayments r
  JOIN loans_f lf ON lf.id = r.loan_id
),
principal_paid_by_loan AS (
  SELECT
    r.loan_id,
    COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) AS principal_paid
  FROM repayments_f r
  GROUP BY r.loan_id
),
schedule_items AS (
  SELECT
    lf.id AS loan_id,
    NULLIF(elem->>'dueDate', '')::date AS due_date,
    COALESCE(NULLIF(elem->>'amount', '')::numeric, 0) AS amount,
    COALESCE(NULLIF(elem->>'paidAmount', '')::numeric, 0) AS paid_amount
  FROM loans_f lf
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(lf.schedule, '[]'::jsonb)) AS elem
  WHERE NULLIF(elem->>'dueDate', '') IS NOT NULL
),
loan_max_due AS (
  SELECT
    loan_id,
    MAX(due_date) AS max_due
  FROM schedule_items
  GROUP BY loan_id
),
loan_agg AS (
  SELECT
    COALESCE(SUM(lf.balance) FILTER (WHERE lf.status = 'active'), 0) AS portfolio_active,
    COALESCE(SUM(lf.balance) FILTER (WHERE lf.status = 'defaulted'), 0) AS portfolio_defaulted,
    COALESCE(SUM(lf.balance) FILTER (WHERE lf.status NOT IN ('paid', 'written_off')), 0) AS portfolio_general,
    COALESCE(SUM(lf.principal) FILTER (
      WHERE lf.disbursement_date >= (SELECT month_start::date FROM bounds)
        AND lf.disbursement_date < ((SELECT month_start FROM bounds) + interval '1 month')::date
    ), 0) AS disbursed_monthly,
    COALESCE(SUM(lf.principal) FILTER (
      WHERE lf.disbursement_date >= (SELECT year_start::date FROM bounds)
        AND lf.disbursement_date < ((SELECT year_start FROM bounds) + interval '1 year')::date
    ), 0) AS disbursed_yearly,
    COALESCE(SUM(lf.principal), 0) AS disbursed_overall,
    COALESCE(SUM(GREATEST(0, lf.total_payable - lf.principal)) FILTER (
      WHERE lf.disbursement_date >= (SELECT month_start::date FROM bounds)
        AND lf.disbursement_date < ((SELECT month_start FROM bounds) + interval '1 month')::date
    ), 0) AS interest_from_disbursed_month,
    COALESCE(SUM(GREATEST(0, lf.total_payable - lf.principal)) FILTER (
      WHERE lf.disbursement_date BETWEEN p_start_date AND p_end_date
    ), 0) AS interest_from_disbursed_range,
    COALESCE(SUM(GREATEST(0, lf.principal - COALESCE(pp.principal_paid, 0))) FILTER (
      WHERE lf.status NOT IN ('paid', 'written_off')
    ), 0) AS outstanding_principal,
    COALESCE(SUM(COALESCE(lf.outstanding_interest, 0)) FILTER (
      WHERE lf.status NOT IN ('paid', 'written_off')
    ), 0) AS outstanding_interest,
    COALESCE(SUM(
      GREATEST(0, lf.principal - COALESCE(pp.principal_paid, 0)) + COALESCE(lf.outstanding_interest, 0)
    ) FILTER (WHERE lf.status NOT IN ('paid', 'written_off')), 0) AS outstanding_total,
    COALESCE(SUM(lf.principal) FILTER (WHERE lf.status = 'defaulted'), 0) AS default_disbursed_principal,
    COALESCE(SUM(COALESCE(lf.outstanding_interest, 0)) FILTER (WHERE lf.status = 'defaulted'), 0) AS default_interest_amount,
    COALESCE(SUM(lf.principal + COALESCE(lf.outstanding_interest, 0)) FILTER (WHERE lf.status = 'defaulted'), 0) AS default_total_amount,
    COUNT(*) FILTER (WHERE lf.status = 'active')::bigint AS active_loans_count,
    COALESCE(SUM(lf.principal) FILTER (WHERE lf.disbursement_date = CURRENT_DATE), 0) AS disbursed_today,
    COUNT(DISTINCT lf.borrower_id) FILTER (WHERE lf.disbursement_date = CURRENT_DATE)::bigint AS borrowers_disbursed_today,
    COUNT(*) FILTER (WHERE lf.status = 'delinquent')::bigint AS loans_delinquent_count,
    COUNT(*) FILTER (WHERE lf.status = 'defaulted')::bigint AS loans_defaulted_count,
    COUNT(*) FILTER (WHERE lf.status IN ('active', 'delinquent', 'defaulted'))::bigint AS loans_book_count
  FROM loans_f lf
  LEFT JOIN principal_paid_by_loan pp ON pp.loan_id = lf.id
),
repayment_agg AS (
  SELECT
    COALESCE(SUM(
      CASE
        WHEN r.principal_paid IS NOT NULL THEN r.principal_paid
        WHEN r.interest_paid IS NOT NULL THEN GREATEST(0::numeric, COALESCE(r.amount, 0) - COALESCE(r.interest_paid, 0))
        ELSE COALESCE(r.amount, 0)
      END
    ) FILTER (
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = (SELECT month_start FROM bounds)
    ), 0) AS collected_month_principal,
    COALESCE(SUM(
      CASE
        WHEN r.interest_paid IS NOT NULL THEN r.interest_paid
        WHEN r.principal_paid IS NOT NULL THEN GREATEST(0::numeric, COALESCE(r.amount, 0) - COALESCE(r.principal_paid, 0))
        ELSE 0::numeric
      END
    ) FILTER (
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = (SELECT month_start FROM bounds)
    ), 0) AS collected_month_interest,
    COALESCE(SUM(r.amount) FILTER (
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = (SELECT month_start FROM bounds)
    ), 0) AS collected_month_total,
    COALESCE(SUM(r.amount) FILTER (WHERE r.actual_payment_date = CURRENT_DATE), 0) AS collected_today
  FROM repayments_f r
),
kpi_projection_due AS (
  SELECT public.next_working_day_after_exclusive(CURRENT_DATE) AS d
),
schedule_agg AS (
  SELECT
    COALESCE(SUM(si.amount) FILTER (
      WHERE si.due_date = CURRENT_DATE
        AND si.paid_amount < si.amount - 0.01
    ), 0) AS expected_today,
    COALESCE(SUM(si.amount) FILTER (
      WHERE si.due_date = (SELECT kpd.d FROM kpi_projection_due kpd)
        AND si.paid_amount < si.amount - 0.01
    ), 0) AS expected_tomorrow
  FROM schedule_items si
),
nearing_agg AS (
  SELECT
    COUNT(*)::bigint AS nearing_completion
  FROM loans_f lf
  JOIN loan_max_due md ON md.loan_id = lf.id
  WHERE lf.status = 'active'
    AND md.max_due BETWEEN CURRENT_DATE AND (CURRENT_DATE + (SELECT nearing_days FROM bounds))
),
counts_agg AS (
  SELECT
    CASE WHEN p_branch_id IS NULL THEN (SELECT COUNT(*)::bigint FROM public.branches) ELSE 1::bigint END AS total_branches,
    (SELECT COUNT(*)::bigint
     FROM public.users u
     WHERE (p_branch_id IS NULL OR u.branch_id = p_branch_id)
       AND (p_officer_id IS NULL OR u.id = p_officer_id)) AS total_users,
    (SELECT COUNT(*)::bigint
     FROM public.borrowers b
     WHERE (p_branch_id IS NULL OR b.branch_id = p_branch_id)
       AND (p_officer_id IS NULL OR b.loan_officer_id = p_officer_id)) AS total_borrowers
)
SELECT
  la.portfolio_active,
  la.portfolio_defaulted,
  la.portfolio_general,
  la.disbursed_monthly,
  la.disbursed_yearly,
  la.disbursed_overall,
  la.interest_from_disbursed_month,
  la.interest_from_disbursed_range,
  ra.collected_month_principal,
  ra.collected_month_interest,
  ra.collected_month_total,
  la.outstanding_principal,
  la.outstanding_interest,
  la.outstanding_total,
  la.default_disbursed_principal,
  la.default_interest_amount,
  la.default_total_amount,
  sa.expected_today,
  na.nearing_completion,
  ca.total_branches,
  ca.total_users,
  ca.total_borrowers,
  la.active_loans_count,
  la.disbursed_today,
  ra.collected_today,
  sa.expected_tomorrow,
  la.borrowers_disbursed_today,
  la.loans_delinquent_count,
  la.loans_defaulted_count,
  la.loans_book_count
FROM loan_agg la
CROSS JOIN repayment_agg ra
CROSS JOIN schedule_agg sa
CROSS JOIN nearing_agg na
CROSS JOIN counts_agg ca;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_metrics(date, date, uuid, uuid, int) TO authenticated;

-- Optional center/group filters on dashboard drilldown (p_center_id, p_group_id on borrowers).

DROP FUNCTION IF EXISTS public.get_admin_dashboard_drilldown(text, date, date, int, int, uuid, uuid, int);
DROP FUNCTION IF EXISTS public.get_admin_dashboard_drilldown(text, date, date, int, int, uuid, uuid);

CREATE OR REPLACE FUNCTION public.get_admin_dashboard_drilldown(
  p_metric text,
  p_start_date date,
  p_end_date date,
  p_limit int DEFAULT 25,
  p_offset int DEFAULT 0,
  p_branch_id uuid DEFAULT NULL,
  p_officer_id uuid DEFAULT NULL,
  p_nearing_days int DEFAULT 14,
  p_center_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
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
  v_projection_due date;
BEGIN
  v_projection_due := public.next_working_day_after_exclusive(CURRENT_DATE);
  IF p_metric = 'portfolio_active' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'active'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
        ORDER BY l.disbursement_date DESC NULLS LAST
        LIMIT v_lim OFFSET v_off
      ) t
    ), '[]'::jsonb) INTO v_rows;

  ELSIF p_metric = 'portfolio_defaulted' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'portfolio_general' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'disbursed_monthly' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'disbursed_yearly' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE EXTRACT(YEAR FROM l.disbursement_date) = EXTRACT(YEAR FROM p_end_date)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'disbursed_overall' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'interest_disbursed_month' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE date_trunc('month', l.disbursement_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'interest_disbursed_range' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.disbursement_date::date BETWEEN p_start_date AND p_end_date
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric IN ('collected_month_principal', 'collected_month_interest', 'collected_month_total') THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.repayments r
      JOIN public.loans l ON l.id = r.loan_id
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE date_trunc('month', r.actual_payment_date::timestamp) = date_trunc('month', p_end_date::timestamp)
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY r.actual_payment_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'outstanding_principal' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'outstanding_interest' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status NOT IN ('paid', 'written_off') AND l.outstanding_interest > 0
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.outstanding_interest DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'outstanding_total' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status NOT IN ('paid', 'written_off')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.balance DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'default_disbursed' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'default_interest' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.outstanding_interest DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'default_total' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      GROUP BY l.id, b.id, br.id
      ORDER BY due_today_amount DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'disbursed_today' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.disbursement_date::date = CURRENT_DATE
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        l.principal AS principal_disbursed,
        l.total_payable,
        l.balance,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE l.disbursement_date::date = CURRENT_DATE
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY l.disbursement_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'collected_today' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.repayments r
      JOIN public.loans l ON l.id = r.loan_id
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE r.actual_payment_date::date = CURRENT_DATE
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
      WHERE r.actual_payment_date::date = CURRENT_DATE
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY r.actual_payment_date DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'expected_tomorrow' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM (
      SELECT l.id
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS elem
      WHERE (elem->>'dueDate')::date = v_projection_due
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      GROUP BY l.id
    ) sub;
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        l.loan_id,
        l.disbursement_date,
        b.first_name || ' ' || b.surname AS borrower_name,
        br.name AS branch_name,
        SUM((elem->>'amount')::numeric) AS due_tomorrow_amount,
        l.principal,
        l.balance,
        l.status::text AS status
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      LEFT JOIN public.branches br ON br.id = b.branch_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS elem
      WHERE (elem->>'dueDate')::date = v_projection_due
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      GROUP BY l.id, b.id, br.id
      ORDER BY due_tomorrow_amount DESC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSIF p_metric = 'my_borrowers' THEN
    SELECT COUNT(*)::bigint INTO v_total FROM public.borrowers b
      WHERE (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR b.loan_officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
    SELECT COALESCE(jsonb_agg(row_to_json(x)::jsonb), '[]'::jsonb) INTO v_rows FROM (
      SELECT
        b.id AS borrower_uuid,
        b.borrower_id,
        b.first_name || ' ' || b.surname AS borrower_name,
        b.phone_number,
        br.name AS branch_name,
        b.status::text AS status,
        b.created_at
      FROM public.borrowers b
      LEFT JOIN public.branches br ON br.id = b.branch_id
      WHERE (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR b.loan_officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY b.created_at DESC NULLS LAST
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
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id);
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
        AND (p_center_id IS NULL OR b.center_id = p_center_id OR EXISTS (SELECT 1 FROM public.groups g WHERE g.id = b.group_id AND g.center_id = p_center_id))
        AND (p_group_id IS NULL OR b.group_id = p_group_id)
      ORDER BY last_installment_due ASC NULLS LAST
      LIMIT v_lim OFFSET v_off
    ) x;

  ELSE
    RETURN jsonb_build_object('total', 0, 'rows', '[]'::jsonb, 'error', 'unknown_metric');
  END IF;

  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_drilldown(text, date, date, int, int, uuid, uuid, int, uuid, uuid) TO authenticated;

-- Breakdown by centre: same calendar-tomorrow due date as dashboard (p_period_end ignored, kept for signature compatibility).

DROP FUNCTION IF EXISTS public.officer_projected_tomorrow_by_center(uuid, uuid);

CREATE OR REPLACE FUNCTION public.officer_projected_tomorrow_by_center(
  p_officer_id uuid,
  p_branch_id uuid DEFAULT NULL,
  p_period_end date DEFAULT NULL
)
RETURNS TABLE (
  center_id uuid,
  center_name text,
  projected_tomorrow numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_due date;
BEGIN
  IF p_officer_id IS NULL OR NOT (
    p_officer_id = auth.uid() OR public.auth_is_admin()
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  v_due := public.next_working_day_after_exclusive(CURRENT_DATE);

  RETURN QUERY
  WITH installments AS (
    SELECT
      COALESCE(g.center_id, b.center_id) AS cid,
      (elem ->> 'amount')::numeric AS inst_amt
    FROM public.loans l
    JOIN public.borrowers b ON b.id = l.borrower_id
    LEFT JOIN public.groups g ON g.id = b.group_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS elem
    WHERE l.officer_id = p_officer_id
      AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
      AND NULLIF(trim(elem ->> 'dueDate'), '') IS NOT NULL
      AND (elem ->> 'dueDate')::date = v_due
      AND COALESCE((elem ->> 'paidAmount')::numeric, 0) < COALESCE((elem ->> 'amount')::numeric, 0) - 0.01
  )
  SELECT
    i.cid,
    COALESCE(
      c.name,
      CASE WHEN i.cid IS NULL THEN 'Unassigned centre' ELSE 'Centre' END
    )::text,
    COALESCE(SUM(i.inst_amt), 0)::numeric
  FROM installments i
  LEFT JOIN public.centers c ON c.id = i.cid
  GROUP BY i.cid, c.name
  ORDER BY 3 DESC NULLS LAST,
    COALESCE(c.name, CASE WHEN i.cid IS NULL THEN 'Unassigned centre' ELSE '' END);
END;
$$;

COMMENT ON FUNCTION public.officer_projected_tomorrow_by_center(uuid, uuid, date) IS
  'Loan officer: unpaid installment amounts by borrower centre, due on next_working_day_after_exclusive(CURRENT_DATE) (not Sun / not public.holidays). Optional p_period_end is ignored.';

GRANT EXECUTE ON FUNCTION public.officer_projected_tomorrow_by_center(uuid, uuid, date) TO authenticated;

COMMENT ON FUNCTION public.get_admin_dashboard_metrics(date, date, uuid, uuid, int) IS
  'Scoped dashboard KPIs. expected_tomorrow sums unpaid schedule installments due on next_working_day_after_exclusive(CURRENT_DATE) (excludes Sundays and rows in public.holidays), matching schedule working-day rules.';

COMMENT ON FUNCTION public.get_admin_dashboard_drilldown(text, date, date, int, int, uuid, uuid, int, uuid, uuid) IS
  'Paged drilldown per metric key. expected_tomorrow uses the same next_working_day_after_exclusive(CURRENT_DATE) due date as get_admin_dashboard_metrics.';
