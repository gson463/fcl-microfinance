-- RPC functions required by the FCL frontend (SECURITY DEFINER bypasses RLS when invoked)

CREATE OR REPLACE FUNCTION public.recalculate_loan_schedule(p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  loan_row public.loans%ROWTYPE;
  total_repaid numeric;
  new_sched jsonb := '[]'::jsonb;
  i int;
  elem jsonb;
  rem numeric;
  inst_amt numeric;
  paid_to_inst numeric;
  st text;
  due date;
BEGIN
  SELECT * INTO loan_row FROM public.loans WHERE id = p_loan_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF loan_row.schedule IS NULL OR jsonb_typeof(loan_row.schedule) <> 'array' THEN
    RETURN;
  END IF;

  IF jsonb_array_length(loan_row.schedule) IS NULL OR jsonb_array_length(loan_row.schedule) = 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO total_repaid FROM public.repayments WHERE loan_id = p_loan_id;
  rem := total_repaid;

  FOR i IN 0 .. (jsonb_array_length(loan_row.schedule) - 1) LOOP
    elem := loan_row.schedule->i;
    inst_amt := COALESCE((elem->>'amount')::numeric, 0);
    paid_to_inst := LEAST(rem, inst_amt);
    rem := rem - paid_to_inst;
    due := (elem->>'dueDate')::date;
    IF inst_amt <= 0 THEN
      st := 'pending';
    ELSIF paid_to_inst >= inst_amt - 0.01 THEN
      st := 'paid';
    ELSIF due < CURRENT_DATE AND paid_to_inst < inst_amt - 0.01 THEN
      st := 'arrears';
    ELSE
      st := 'pending';
    END IF;
    elem := elem || jsonb_build_object('paidAmount', paid_to_inst, 'status', st);
    new_sched := new_sched || jsonb_build_array(elem);
  END LOOP;

  UPDATE public.loans
  SET
    schedule = new_sched,
    balance = GREATEST(0, loan_row.total_payable - total_repaid),
    outstanding_interest = GREATEST(
      0,
      CASE
        WHEN loan_row.total_payable <= 0 THEN 0
        ELSE (loan_row.total_payable - loan_row.principal)
          * (GREATEST(0, loan_row.total_payable - total_repaid) / NULLIF(loan_row.total_payable, 0))
      END
    )
  WHERE id = p_loan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_all_loan_statuses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.loans l
  SET status = CASE
    WHEN GREATEST(0, l.total_payable - COALESCE((SELECT SUM(r.amount) FROM public.repayments r WHERE r.loan_id = l.id), 0)) <= 0.01 THEN 'paid'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(l.schedule) elem
      WHERE (elem->>'dueDate')::date < CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    ) THEN 'delinquent'
    ELSE 'active'
  END
  WHERE l.status IN ('active', 'delinquent', 'defaulted', 'paid')
    AND l.schedule IS NOT NULL
    AND jsonb_typeof(l.schedule) = 'array';
END;
$$;

CREATE OR REPLACE FUNCTION public.update_loan_status(p_loan_id uuid, p_new_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.loans SET status = p_new_status WHERE id = p_loan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_partial_officer_data(
  p_old_officer_id uuid,
  p_new_officer_id uuid,
  p_center_ids uuid[],
  p_group_ids uuid[],
  p_reassign_all boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_reassign_all THEN
    UPDATE public.centers SET loan_officer_id = p_new_officer_id WHERE loan_officer_id = p_old_officer_id;
    UPDATE public.groups SET loan_officer_id = p_new_officer_id WHERE loan_officer_id = p_old_officer_id;
    UPDATE public.borrowers SET loan_officer_id = p_new_officer_id WHERE loan_officer_id = p_old_officer_id;
    UPDATE public.loans SET officer_id = p_new_officer_id WHERE officer_id = p_old_officer_id;
  ELSE
    IF p_center_ids IS NOT NULL AND array_length(p_center_ids, 1) IS NOT NULL THEN
      UPDATE public.centers SET loan_officer_id = p_new_officer_id WHERE id = ANY (p_center_ids);
      UPDATE public.borrowers SET loan_officer_id = p_new_officer_id
        WHERE group_id IN (SELECT g.id FROM public.groups g WHERE g.center_id = ANY (p_center_ids));
      UPDATE public.loans SET officer_id = p_new_officer_id
        WHERE borrower_id IN (
          SELECT b.id FROM public.borrowers b
          WHERE b.group_id IN (SELECT g.id FROM public.groups g WHERE g.center_id = ANY (p_center_ids))
        );
    END IF;
    IF p_group_ids IS NOT NULL AND array_length(p_group_ids, 1) IS NOT NULL THEN
      UPDATE public.groups SET loan_officer_id = p_new_officer_id WHERE id = ANY (p_group_ids);
      UPDATE public.borrowers SET loan_officer_id = p_new_officer_id WHERE group_id = ANY (p_group_ids);
      UPDATE public.loans SET officer_id = p_new_officer_id
        WHERE borrower_id IN (SELECT id FROM public.borrowers WHERE group_id = ANY (p_group_ids));
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_officer_stats(
  p_officer_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  total_borrowers bigint,
  active_loans bigint,
  total_portfolio numeric,
  total_principal_disbursed numeric,
  total_repayments_collected numeric,
  principal_repayments_collected numeric,
  total_interest_collected numeric,
  outstanding_principal numeric,
  outstanding_interest numeric,
  defaulted_principal numeric,
  defaulted_interest numeric,
  total_expected_today numeric,
  total_disbursed_this_month numeric,
  past_unpaid_repayments numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::bigint FROM public.borrowers b WHERE b.loan_officer_id = p_officer_id),
    (SELECT COUNT(*)::bigint FROM public.loans l WHERE l.officer_id = p_officer_id AND l.status = 'active'),
    (SELECT COALESCE(SUM(l.balance), 0) FROM public.loans l WHERE l.officer_id = p_officer_id AND l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.officer_id = p_officer_id AND l.disbursement_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(r.amount), 0) FROM public.repayments r WHERE r.officer_id = p_officer_id AND r.actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.officer_id = p_officer_id AND r.actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.officer_id = p_officer_id AND r.actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(GREATEST(0, l.principal - COALESCE((
          SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id
        ), 0))), 0)
      FROM public.loans l WHERE l.officer_id = p_officer_id AND l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.outstanding_interest), 0) FROM public.loans l WHERE l.officer_id = p_officer_id AND l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.officer_id = p_officer_id AND l.status = 'defaulted'),
    (SELECT COALESCE(SUM(l.outstanding_interest), 0) FROM public.loans l WHERE l.officer_id = p_officer_id AND l.status = 'defaulted'),
    (SELECT COALESCE(SUM((elem->>'amount')::numeric), 0)
      FROM public.loans l, jsonb_array_elements(l.schedule) elem
      WHERE l.officer_id = p_officer_id
        AND (elem->>'dueDate')::date = CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    ),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.officer_id = p_officer_id AND l.disbursement_date::date >= date_trunc('month', CURRENT_DATE)::date),
    (SELECT COUNT(*)::bigint FROM public.loans l, jsonb_array_elements(l.schedule) elem
      WHERE l.officer_id = p_officer_id
        AND (elem->>'dueDate')::date < CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    )::numeric;
$$;

CREATE OR REPLACE FUNCTION public.get_branch_stats(
  p_branch_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  total_loan_officers bigint,
  total_borrowers bigint,
  active_loans bigint,
  total_portfolio numeric,
  total_principal_disbursed numeric,
  total_repayments_collected numeric,
  principal_repayments_collected numeric,
  total_interest_collected numeric,
  outstanding_principal numeric,
  outstanding_interest numeric,
  defaulted_principal numeric,
  defaulted_interest numeric,
  total_expected_today numeric,
  total_disbursed_this_month numeric,
  past_unpaid_repayments numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::bigint FROM public.users u WHERE u.branch_id = p_branch_id AND u.role = 'officer'),
    (SELECT COUNT(*)::bigint FROM public.borrowers b WHERE b.branch_id = p_branch_id),
    (SELECT COUNT(*)::bigint FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.status = 'active'),
    (SELECT COALESCE(SUM(l.balance), 0) FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.disbursement_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(r.amount), 0) FROM public.repayments r WHERE r.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND r.actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND r.actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND r.actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(GREATEST(0, l.principal - COALESCE((
          SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id
        ), 0))), 0)
      FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.outstanding_interest), 0) FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.status = 'defaulted'),
    (SELECT COALESCE(SUM(l.outstanding_interest), 0) FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.status = 'defaulted'),
    (SELECT COALESCE(SUM((elem->>'amount')::numeric), 0)
      FROM public.loans l, jsonb_array_elements(l.schedule) elem
      WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer')
        AND (elem->>'dueDate')::date = CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    ),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.disbursement_date::date >= date_trunc('month', CURRENT_DATE)::date),
    (SELECT COUNT(*)::bigint FROM public.loans l, jsonb_array_elements(l.schedule) elem
      WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer')
        AND (elem->>'dueDate')::date < CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    )::numeric;
$$;

CREATE OR REPLACE FUNCTION public.get_system_wide_stats(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  total_branches bigint,
  total_users bigint,
  total_borrowers bigint,
  active_loans bigint,
  total_portfolio numeric,
  total_principal_disbursed numeric,
  total_repayments_collected numeric,
  principal_repayments_collected numeric,
  total_interest_collected numeric,
  outstanding_principal numeric,
  outstanding_interest numeric,
  defaulted_principal numeric,
  defaulted_interest numeric,
  total_expected_today numeric,
  total_disbursed_this_month numeric,
  past_unpaid_repayments numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::bigint FROM public.branches),
    (SELECT COUNT(*)::bigint FROM public.users),
    (SELECT COUNT(*)::bigint FROM public.borrowers),
    (SELECT COUNT(*)::bigint FROM public.loans WHERE status = 'active'),
    (SELECT COALESCE(SUM(balance), 0) FROM public.loans WHERE status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(principal), 0) FROM public.loans WHERE disbursement_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(amount), 0) FROM public.repayments WHERE actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(principal_paid, 0)), 0) FROM public.repayments WHERE actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(interest_paid, 0)), 0) FROM public.repayments WHERE actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(GREATEST(0, l.principal - COALESCE((
          SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id
        ), 0))), 0)
      FROM public.loans l WHERE l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(outstanding_interest), 0) FROM public.loans WHERE status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(principal), 0) FROM public.loans WHERE status = 'defaulted'),
    (SELECT COALESCE(SUM(outstanding_interest), 0) FROM public.loans WHERE status = 'defaulted'),
    (SELECT COALESCE(SUM((elem->>'amount')::numeric), 0)
      FROM public.loans l, jsonb_array_elements(l.schedule) elem
      WHERE (elem->>'dueDate')::date = CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    ),
    (SELECT COALESCE(SUM(principal), 0) FROM public.loans WHERE disbursement_date::date >= date_trunc('month', CURRENT_DATE)::date),
    (SELECT COUNT(*)::bigint FROM public.loans l, jsonb_array_elements(l.schedule) elem
      WHERE (elem->>'dueDate')::date < CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    )::numeric;
$$;

GRANT EXECUTE ON FUNCTION public.recalculate_loan_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_all_loan_statuses() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_loan_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_partial_officer_data(uuid, uuid, uuid[], uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_officer_stats(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_branch_stats(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_wide_stats(date, date) TO authenticated;
