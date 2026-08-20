-- Centre Attendance demo data (run in Supabase Dashboard → SQL Editor).
-- Optional: set v_officer_email to your officer’s public.users email; if left as
-- REPLACE_WITH_OFFICER_EMAIL, the script uses the first officer (by email).
-- Safe to re-run: removes prior demo rows for that officer first.

DO $$
DECLARE
  v_officer_email text := 'sflaws.g@gmail.com';
  v_officer uuid;
  v_branch uuid;
  v_center uuid;
  v_ga uuid;
  v_gb uuid;
  v_pid uuid;
  v_ir numeric;
  v_period int;
  v_punit text;
  v_rep text;
  b001 uuid;
  b002 uuid;
BEGIN
  IF v_officer_email IS NULL OR trim(v_officer_email) = '' OR v_officer_email = 'REPLACE_WITH_OFFICER_EMAIL' THEN
    SELECT u.id, u.branch_id, u.email INTO v_officer, v_branch, v_officer_email
    FROM public.users u
    WHERE u.role = 'officer'
    ORDER BY u.email
    LIMIT 1;
  ELSE
    SELECT u.id, u.branch_id INTO v_officer, v_branch
    FROM public.users u
    WHERE lower(trim(u.email)) = lower(trim(v_officer_email)) AND u.role = 'officer'
    LIMIT 1;
  END IF;

  IF v_officer IS NULL THEN
    RAISE EXCEPTION 'No officer found. Create a loan officer user or set v_officer_email in this script.';
  END IF;

  SELECT lp.id, lp.interest_rate, lp.loan_period, lp.loan_period_unit, lp.repayment_frequency
  INTO v_pid, v_ir, v_period, v_punit, v_rep
  FROM public.loan_products lp
  WHERE lp.status = 'active'
  ORDER BY lp.created_at
  LIMIT 1;

  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'No active loan_products row — add one in Admin first.';
  END IF;

  -- Cleanup previous demo
  DELETE FROM public.loans WHERE loan_id IN ('DEMO-ATT-LN-PAID', 'DEMO-ATT-LN-DEF');

  DELETE FROM public.attendance_records ar
  USING public.centre_meetings cm
  WHERE ar.centre_meeting_id = cm.id
    AND cm.centre_id IN (
      SELECT c.id FROM public.centers c
      WHERE c.loan_officer_id = v_officer AND c.name = 'Demo Centre — Attendance'
    );

  DELETE FROM public.centre_meetings
  WHERE centre_id IN (
    SELECT c.id FROM public.centers c
    WHERE c.loan_officer_id = v_officer AND c.name = 'Demo Centre — Attendance'
  );

  DELETE FROM public.borrowers
  WHERE loan_officer_id = v_officer AND borrower_id LIKE 'DEMO-ATT-%';

  DELETE FROM public.groups
  WHERE center_id IN (
    SELECT c.id FROM public.centers c
    WHERE c.loan_officer_id = v_officer AND c.name = 'Demo Centre — Attendance'
  );

  DELETE FROM public.centers
  WHERE loan_officer_id = v_officer AND name = 'Demo Centre — Attendance';

  INSERT INTO public.centers (name, location, loan_officer_id, branch_id)
  VALUES ('Demo Centre — Attendance', 'Demo (seed)', v_officer, v_branch)
  RETURNING id INTO v_center;

  INSERT INTO public.groups (name, center_id, loan_officer_id)
  VALUES ('Demo Group Alpha', v_center, v_officer)
  RETURNING id INTO v_ga;

  INSERT INTO public.groups (name, center_id, loan_officer_id)
  VALUES ('Demo Group Beta', v_center, v_officer)
  RETURNING id INTO v_gb;

  INSERT INTO public.borrowers (borrower_id, first_name, surname, gender, phone_number, loan_officer_id, branch_id, group_id, status)
  VALUES
    ('DEMO-ATT-001', 'Asha', 'Eligible', 'female', '+255700000001', v_officer, v_branch, v_ga, 'eligible'),
    ('DEMO-ATT-002', 'Baraka', 'Defaulted', 'female', '+255700000002', v_officer, v_branch, v_ga, 'eligible'),
    ('DEMO-ATT-003', 'Chausiku', 'NoPriorLoan', 'female', '+255700000003', v_officer, v_branch, v_ga, 'eligible'),
    ('DEMO-ATT-004', 'David', 'LowAttendance', 'female', '+255700000004', v_officer, v_branch, v_gb, 'eligible'),
    ('DEMO-ATT-005', 'Ester', 'GroupBeta', 'female', '+255700000005', v_officer, v_branch, v_gb, 'eligible'),
    ('DEMO-ATT-006', 'Fatma', 'AbsentTwice', 'female', '+255700000006', v_officer, v_branch, v_gb, 'eligible');

  SELECT id INTO b001 FROM public.borrowers WHERE borrower_id = 'DEMO-ATT-001' AND loan_officer_id = v_officer;
  SELECT id INTO b002 FROM public.borrowers WHERE borrower_id = 'DEMO-ATT-002' AND loan_officer_id = v_officer;

  INSERT INTO public.centre_meetings (centre_id, meeting_date, loan_officer_id, notes)
  VALUES
    (v_center, (current_date - 42)::date, v_officer, 'demo_seed'),
    (v_center, (current_date - 35)::date, v_officer, 'demo_seed'),
    (v_center, (current_date - 28)::date, v_officer, 'demo_seed'),
    (v_center, (current_date - 21)::date, v_officer, 'demo_seed'),
    (v_center, (current_date - 14)::date, v_officer, 'demo_seed'),
    (v_center, (current_date - 7)::date, v_officer, 'demo_seed');

  INSERT INTO public.attendance_records (centre_meeting_id, borrower_id, group_id, attendance_status)
  SELECT
    m.id,
    b.id,
    b.group_id,
    CASE
      WHEN b.borrower_id = 'DEMO-ATT-006' AND m.rn <= 2 THEN 'absent'
      WHEN b.borrower_id = 'DEMO-ATT-004' AND m.rn <= 5 THEN 'absent'
      ELSE 'present'
    END
  FROM public.borrowers b
  CROSS JOIN (
    SELECT cm.id, row_number() OVER (ORDER BY cm.meeting_date) AS rn
    FROM public.centre_meetings cm
    WHERE cm.centre_id = v_center AND cm.notes = 'demo_seed'
  ) m
  WHERE b.loan_officer_id = v_officer AND b.borrower_id LIKE 'DEMO-ATT-%';

  INSERT INTO public.loans (
    loan_id, borrower_id, product_id, officer_id, principal, interest_rate, total_payable,
    balance, outstanding_interest, repayment_frequency, period, period_unit,
    disbursement_date, repayment_start_date, status
  )
  VALUES
    (
      'DEMO-ATT-LN-PAID',
      b001,
      v_pid,
      v_officer,
      500000,
      v_ir,
      500000 * (1 + v_ir / 100),
      0,
      0,
      v_rep,
      v_period,
      v_punit,
      (current_date - 400)::date,
      (current_date - 390)::date,
      'paid'
    ),
    (
      'DEMO-ATT-LN-DEF',
      b002,
      v_pid,
      v_officer,
      300000,
      v_ir,
      300000 * (1 + v_ir / 100),
      150000,
      0,
      v_rep,
      v_period,
      v_punit,
      (current_date - 200)::date,
      (current_date - 190)::date,
      'defaulted'
    );

  RAISE NOTICE 'Demo attendance seed OK for officer %. Centre % — 6 meetings, 6 borrowers, 2 sample loans.', v_officer_email, v_center;
END $$;
