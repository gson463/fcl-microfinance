-- Optimize admin dashboard metrics to avoid statement timeout.
-- Previous version repeated many correlated subqueries and expanded schedule JSON multiple times.

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
schedule_agg AS (
  SELECT
    COALESCE(SUM(si.amount) FILTER (
      WHERE si.due_date = CURRENT_DATE
        AND si.paid_amount < si.amount - 0.01
    ), 0) AS expected_today,
    COALESCE(SUM(si.amount) FILTER (
      WHERE si.due_date = CURRENT_DATE + 1
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
