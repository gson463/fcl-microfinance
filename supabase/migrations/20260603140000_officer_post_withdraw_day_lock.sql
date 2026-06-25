-- Block loan officer writes after withdraw-to-bank until the next working day (EAT).

INSERT INTO public.system_config (key, value)
VALUES ('officerLockAfterWithdraw', 'true')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.current_business_date_eat()
RETURNS date
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT (timezone('Africa/Nairobi', now()))::date;
$$;

COMMENT ON FUNCTION public.current_business_date_eat() IS
  'Calendar date in Africa/Nairobi for officer day-lock and taken gate alignment.';

GRANT EXECUTE ON FUNCTION public.current_business_date_eat() TO authenticated;

CREATE OR REPLACE FUNCTION public.officer_lock_after_withdraw_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT lower(trim(value)) IN ('true', '1', 'yes', 'on')
      FROM public.system_config
      WHERE key = 'officerLockAfterWithdraw'
      LIMIT 1
    ),
    true
  );
$$;

COMMENT ON FUNCTION public.officer_lock_after_withdraw_enabled() IS
  'When true (default), officers are locked from writes after withdraw until next working day.';

GRANT EXECUTE ON FUNCTION public.officer_lock_after_withdraw_enabled() TO authenticated;

CREATE OR REPLACE FUNCTION public.officer_is_in_post_withdraw_lock(
  p_officer_id uuid,
  p_as_of date DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of date := COALESCE(p_as_of, public.current_business_date_eat());
  v_found boolean := false;
BEGIN
  IF p_officer_id IS NULL OR v_as_of IS NULL THEN
    RETURN false;
  END IF;

  IF NOT public.officer_lock_after_withdraw_enabled() THEN
    RETURN false;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.officer_withdraw_to_bank w
    WHERE w.officer_id = p_officer_id
      AND v_as_of >= w.business_date
      AND v_as_of < public.next_working_day_after_exclusive(w.business_date)
  ) INTO v_found;

  RETURN COALESCE(v_found, false);
END;
$$;

COMMENT ON FUNCTION public.officer_is_in_post_withdraw_lock(uuid, date) IS
  'True when officer recorded withdraw and p_as_of is still before the next working day after that withdraw date.';

GRANT EXECUTE ON FUNCTION public.officer_is_in_post_withdraw_lock(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.officer_is_day_closed_after_withdraw(
  p_business_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer_id uuid := auth.uid();
  v_as_of date := COALESCE(p_business_date, public.current_business_date_eat());
  v_withdraw_date date;
  v_next_working date;
  v_locked boolean := false;
  v_enabled boolean;
BEGIN
  IF v_officer_id IS NULL THEN
    RETURN jsonb_build_object(
      'locked', false,
      'lock_enabled', public.officer_lock_after_withdraw_enabled(),
      'message', 'Not authenticated'
    );
  END IF;

  v_enabled := public.officer_lock_after_withdraw_enabled();

  IF NOT v_enabled THEN
    RETURN jsonb_build_object(
      'locked', false,
      'lock_enabled', false,
      'business_date', v_as_of,
      'message', 'Post-withdraw day lock is disabled.'
    );
  END IF;

  SELECT w.business_date,
         public.next_working_day_after_exclusive(w.business_date)
  INTO v_withdraw_date, v_next_working
  FROM public.officer_withdraw_to_bank w
  WHERE w.officer_id = v_officer_id
    AND v_as_of >= w.business_date
    AND v_as_of < public.next_working_day_after_exclusive(w.business_date)
  ORDER BY w.business_date DESC
  LIMIT 1;

  v_locked := v_withdraw_date IS NOT NULL;

  RETURN jsonb_build_object(
    'locked', v_locked,
    'lock_enabled', true,
    'business_date', v_as_of,
    'withdraw_date', v_withdraw_date,
    'next_working_date', v_next_working,
    'message',
      CASE
        WHEN v_locked THEN
          format(
            'Day closed after withdraw to bank. You can view dashboard and field wallet until the next working day (%s).',
            COALESCE(v_next_working::text, '')
          )
        ELSE NULL
      END
  );
END;
$$;

COMMENT ON FUNCTION public.officer_is_day_closed_after_withdraw(date) IS
  'Officer UI: whether the caller is in post-withdraw lock for p_business_date (default today EAT).';

GRANT EXECUTE ON FUNCTION public.officer_is_day_closed_after_withdraw(date) TO authenticated;

CREATE OR REPLACE FUNCTION public.assert_officer_not_day_closed(
  p_officer_id uuid,
  p_as_of date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of date := COALESCE(p_as_of, public.current_business_date_eat());
  v_next date;
BEGIN
  IF p_officer_id IS NULL THEN
    RETURN;
  END IF;

  -- Admins and managers acting on behalf of others (JWT user is not the officer).
  IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_officer_id THEN
    RETURN;
  END IF;

  IF public.auth_is_admin() THEN
    RETURN;
  END IF;

  IF NOT public.officer_is_in_post_withdraw_lock(p_officer_id, v_as_of) THEN
    RETURN;
  END IF;

  SELECT public.next_working_day_after_exclusive(w.business_date)
  INTO v_next
  FROM public.officer_withdraw_to_bank w
  WHERE w.officer_id = p_officer_id
    AND v_as_of >= w.business_date
    AND v_as_of < public.next_working_day_after_exclusive(w.business_date)
  ORDER BY w.business_date DESC
  LIMIT 1;

  RAISE EXCEPTION
    'Day closed after withdraw to bank until next working day (%). No further officer activity until then.',
    COALESCE(v_next::text, 'next working day')
    USING ERRCODE = '23514';
END;
$$;

COMMENT ON FUNCTION public.assert_officer_not_day_closed(uuid, date) IS
  'Raises when authenticated officer is in post-withdraw lock on p_as_of (default today EAT).';

GRANT EXECUTE ON FUNCTION public.assert_officer_not_day_closed(uuid, date) TO authenticated;

-- Generic trigger for officer-owned rows with officer_id + business date columns.
CREATE OR REPLACE FUNCTION public.enforce_officer_post_withdraw_lock_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer_id uuid;
  v_action_date date;
BEGIN
  IF TG_TABLE_NAME = 'repayments' THEN
    v_officer_id := NEW.officer_id;
    v_action_date := COALESCE(NEW.actual_payment_date, NEW.payment_date, public.current_business_date_eat());
  ELSIF TG_TABLE_NAME = 'loans' THEN
    v_officer_id := NEW.officer_id;
    v_action_date := COALESCE(NEW.disbursement_date, public.current_business_date_eat());
  ELSIF TG_TABLE_NAME = 'expenses' THEN
    v_officer_id := NEW.officer_id;
    v_action_date := COALESCE(NEW.expense_date, public.current_business_date_eat());
  ELSIF TG_TABLE_NAME = 'centre_meetings' THEN
    v_officer_id := NEW.loan_officer_id;
    v_action_date := COALESCE(NEW.meeting_date, public.current_business_date_eat());
  ELSIF TG_TABLE_NAME = 'borrowers' THEN
    v_officer_id := NEW.loan_officer_id;
    v_action_date := public.current_business_date_eat();
  ELSIF TG_TABLE_NAME = 'loan_increase_exception_requests' THEN
    v_officer_id := NEW.officer_id;
    v_action_date := public.current_business_date_eat();
  ELSIF TG_TABLE_NAME = 'officer_field_taken' THEN
    v_officer_id := NEW.officer_id;
    v_action_date := COALESCE(NEW.business_date, public.current_business_date_eat());
  ELSIF TG_TABLE_NAME = 'attendance_records' THEN
    SELECT cm.loan_officer_id, cm.meeting_date
    INTO v_officer_id, v_action_date
    FROM public.centre_meetings cm
    WHERE cm.id = NEW.centre_meeting_id;
  ELSIF TG_TABLE_NAME = 'centers' THEN
    v_officer_id := NEW.loan_officer_id;
    v_action_date := public.current_business_date_eat();
  ELSIF TG_TABLE_NAME = 'groups' THEN
    v_officer_id := NEW.loan_officer_id;
    v_action_date := public.current_business_date_eat();
  ELSE
    RETURN NEW;
  END IF;

  PERFORM public.assert_officer_not_day_closed(v_officer_id, v_action_date);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_repayments_post_withdraw_lock ON public.repayments;
CREATE TRIGGER trg_repayments_post_withdraw_lock
  BEFORE INSERT OR UPDATE OF officer_id, actual_payment_date, payment_date, amount
  ON public.repayments
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_officer_post_withdraw_lock_row();

DROP TRIGGER IF EXISTS trg_loans_post_withdraw_lock ON public.loans;
CREATE TRIGGER trg_loans_post_withdraw_lock
  BEFORE INSERT OR UPDATE OF officer_id, principal, disbursement_date, status
  ON public.loans
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_officer_post_withdraw_lock_row();

DROP TRIGGER IF EXISTS trg_expenses_post_withdraw_lock ON public.expenses;
CREATE TRIGGER trg_expenses_post_withdraw_lock
  BEFORE INSERT OR UPDATE OF officer_id, amount, expense_date
  ON public.expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_officer_post_withdraw_lock_row();

DROP TRIGGER IF EXISTS trg_centre_meetings_post_withdraw_lock ON public.centre_meetings;
CREATE TRIGGER trg_centre_meetings_post_withdraw_lock
  BEFORE INSERT OR UPDATE OF loan_officer_id, meeting_date, centre_id
  ON public.centre_meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_officer_post_withdraw_lock_row();

DROP TRIGGER IF EXISTS trg_borrowers_post_withdraw_lock ON public.borrowers;
CREATE TRIGGER trg_borrowers_post_withdraw_lock
  BEFORE INSERT OR UPDATE OF loan_officer_id, first_name, surname, group_id, branch_id
  ON public.borrowers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_officer_post_withdraw_lock_row();

DROP TRIGGER IF EXISTS trg_loan_increase_requests_post_withdraw_lock ON public.loan_increase_exception_requests;
CREATE TRIGGER trg_loan_increase_requests_post_withdraw_lock
  BEFORE INSERT OR UPDATE OF officer_id, borrower_id, officer_notes, status
  ON public.loan_increase_exception_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_officer_post_withdraw_lock_row();

DROP TRIGGER IF EXISTS trg_officer_field_taken_post_withdraw_lock ON public.officer_field_taken;
CREATE TRIGGER trg_officer_field_taken_post_withdraw_lock
  BEFORE INSERT OR UPDATE OF officer_id, business_date, amount_taken
  ON public.officer_field_taken
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_officer_post_withdraw_lock_row();

DROP TRIGGER IF EXISTS trg_attendance_records_post_withdraw_lock ON public.attendance_records;
CREATE TRIGGER trg_attendance_records_post_withdraw_lock
  BEFORE INSERT OR UPDATE OF centre_meeting_id, borrower_id, attendance_status, officer_notes
  ON public.attendance_records
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_officer_post_withdraw_lock_row();

DROP TRIGGER IF EXISTS trg_centers_post_withdraw_lock ON public.centers;
CREATE TRIGGER trg_centers_post_withdraw_lock
  BEFORE INSERT OR UPDATE OF loan_officer_id, name, branch_id
  ON public.centers
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_officer_post_withdraw_lock_row();

DROP TRIGGER IF EXISTS trg_groups_post_withdraw_lock ON public.groups;
CREATE TRIGGER trg_groups_post_withdraw_lock
  BEFORE INSERT OR UPDATE OF loan_officer_id, name, center_id
  ON public.groups
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_officer_post_withdraw_lock_row();

-- Standard repayment RPC path
CREATE OR REPLACE FUNCTION public.record_repayment_wallet_then_recalculate(
  p_loan_id uuid,
  p_borrower_id uuid,
  p_amount numeric,
  p_officer_id uuid,
  p_actual_payment_date date,
  p_prepayment_amount numeric,
  p_scheduled_due_snapshot numeric,
  p_wallet_split_source text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_loan_id IS NULL OR p_borrower_id IS NULL OR p_officer_id IS NULL OR p_actual_payment_date IS NULL THEN
    RAISE EXCEPTION 'loan_id, borrower_id, officer_id, actual_payment_date required';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  IF NOT public.is_working_day_eat(p_actual_payment_date) THEN
    RAISE EXCEPTION
      'actual_payment_date must be a working day (not Sunday, not in public holidays): %',
      p_actual_payment_date
      USING ERRCODE = '23514';
  END IF;

  PERFORM public.assert_officer_not_day_closed(
    p_officer_id,
    COALESCE(p_actual_payment_date, public.current_business_date_eat())
  );

  INSERT INTO public.repayments (
    loan_id,
    borrower_id,
    amount,
    officer_id,
    payment_date,
    actual_payment_date,
    prepayment_amount,
    scheduled_due_snapshot,
    wallet_split_source
  )
  VALUES (
    p_loan_id,
    p_borrower_id,
    p_amount,
    p_officer_id,
    p_actual_payment_date,
    p_actual_payment_date,
    COALESCE(p_prepayment_amount, 0),
    COALESCE(p_scheduled_due_snapshot, 0),
    NULLIF(trim(COALESCE(p_wallet_split_source, '')), '')
  )
  RETURNING id INTO v_id;

  PERFORM public.recalculate_loan_schedule(p_loan_id);
  PERFORM public.refresh_loan_status_for_id(p_loan_id);
  PERFORM public.sync_borrower_paid_up_for(p_borrower_id);

  RETURN v_id;
END;
$$;

-- Officer loan increase request RPC
CREATE OR REPLACE FUNCTION public.submit_loan_increase_exception_request(
  p_borrower_id uuid,
  p_officer_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer uuid := auth.uid();
  has_default boolean := false;
  completed_prior boolean := false;
  new_id uuid;
  has_unconsumed_approval boolean := false;
BEGIN
  IF v_officer IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;

  PERFORM public.assert_officer_not_day_closed(v_officer, public.current_business_date_eat());

  IF p_borrower_id IS NULL THEN
    RETURN jsonb_build_object('error', 'borrower_id required');
  END IF;
  IF p_officer_notes IS NULL OR length(trim(p_officer_notes)) < 10 THEN
    RETURN jsonb_build_object('error', 'Please enter notes (at least 10 characters) explaining why this borrower should receive a new loan.');
  END IF;
  IF length(p_officer_notes) > 8000 THEN
    RETURN jsonb_build_object('error', 'Notes are too long.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.borrowers b
    WHERE b.id = p_borrower_id AND b.loan_officer_id = v_officer
  ) THEN
    RETURN jsonb_build_object('error', 'This borrower is not assigned to you.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.loan_increase_exception_requests r
    WHERE r.borrower_id = p_borrower_id AND r.status = 'pending'
  ) THEN
    RETURN jsonb_build_object('error', 'A pending loan increase approval request already exists for this borrower.');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.loan_increase_exception_requests r
    WHERE r.borrower_id = p_borrower_id
      AND r.status = 'approved'
      AND r.consumed_at IS NULL
      AND r.approved_at IS NOT NULL
      AND r.approved_at > now() - interval '90 days'
  ) INTO has_unconsumed_approval;

  IF has_unconsumed_approval THEN
    RETURN jsonb_build_object('error', 'An approved loan increase is already active — disburse the loan, or wait until it expires (90 days) before requesting again.');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.loans l
    WHERE l.borrower_id = p_borrower_id AND l.status = 'defaulted'
  ) INTO has_default;

  SELECT EXISTS (
    SELECT 1 FROM public.loans l
    WHERE l.borrower_id = p_borrower_id AND l.status IN ('paid', 'written_off')
  ) INTO completed_prior;

  IF has_default THEN
    RETURN jsonb_build_object('error', 'Borrower has a defaulted loan — use the default / manager approval workflow, not this request.');
  END IF;
  IF NOT completed_prior THEN
    RETURN jsonb_build_object('error', 'Loan increase approval applies only after the borrower has completed a prior loan (paid or written off).');
  END IF;

  INSERT INTO public.loan_increase_exception_requests (borrower_id, officer_id, officer_notes, status)
  VALUES (p_borrower_id, v_officer, trim(p_officer_notes), 'pending')
  RETURNING id INTO new_id;

  PERFORM public.log_audit_event(
    'loan_increase_approval.submitted',
    'loan_increase_exception_request',
    new_id::text,
    jsonb_build_object(
      'borrower_id', p_borrower_id,
      'officer_notes_length', length(trim(p_officer_notes))
    )
  );

  RETURN jsonb_build_object('success', true, 'id', new_id);
END;
$$;
