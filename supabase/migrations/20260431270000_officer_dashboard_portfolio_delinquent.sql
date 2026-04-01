-- Delinquent portfolio balance (SUM(balance) for status = delinquent) for officer dashboard amounts.

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
  loans_book_count bigint,
  portfolio_delinquent numeric
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
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.disbursement_date::date = CURRENT_DATE
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(r.amount), 0) FROM public.repayments r
      JOIN public.loans l ON l.id = r.loan_id
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE r.actual_payment_date::date = CURRENT_DATE
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM((elem->>'amount')::numeric), 0)
      FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS elem
      WHERE (elem->>'dueDate')::date = CURRENT_DATE + 1
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COUNT(DISTINCT l.borrower_id)::bigint FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.disbursement_date::date = CURRENT_DATE
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COUNT(*)::bigint FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'delinquent'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COUNT(*)::bigint FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'defaulted'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COUNT(*)::bigint FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status IN ('active', 'delinquent', 'defaulted')
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id)),
    (SELECT COALESCE(SUM(l.balance), 0) FROM public.loans l
      JOIN public.borrowers b ON b.id = l.borrower_id
      WHERE l.status = 'delinquent'
        AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
        AND (p_officer_id IS NULL OR l.officer_id = p_officer_id));
$$;

GRANT EXECUTE ON FUNCTION public.get_admin_dashboard_metrics(date, date, uuid, uuid, int) TO authenticated;
