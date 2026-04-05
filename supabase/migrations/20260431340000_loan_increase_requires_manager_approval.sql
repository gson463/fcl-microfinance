-- Every loan increase (borrower with a completed prior loan) requires branch manager approval.
-- Approval is consumed on first disburse so each new increase needs a new request.

ALTER TABLE public.loan_increase_exception_requests
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS consumed_at_loan_id uuid REFERENCES public.loans(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.loan_increase_exception_requests.consumed_at IS
  'Set when officer disburses using this approval; next loan increase needs a new manager approval.';
COMMENT ON TABLE public.loan_increase_exception_requests IS
  'Officer requests branch manager approval before a new loan after a completed prior loan; also used when attendance is below minimum.';

CREATE OR REPLACE FUNCTION public.consume_loan_increase_approval_for_borrower(p_borrower_id uuid, p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_borrower_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.loan_increase_exception_requests r
  SET
    consumed_at = now(),
    consumed_at_loan_id = p_loan_id
  WHERE r.id = (
    SELECT r2.id
    FROM public.loan_increase_exception_requests r2
    WHERE r2.borrower_id = p_borrower_id
      AND r2.status = 'approved'
      AND r2.consumed_at IS NULL
      AND r2.approved_at IS NOT NULL
      AND r2.approved_at > now() - interval '90 days'
    ORDER BY r2.approved_at DESC
    LIMIT 1
  );
END;
$$;

COMMENT ON FUNCTION public.consume_loan_increase_approval_for_borrower(uuid, uuid) IS
  'Marks the latest unconsumed approved loan-increase request as used after disburse.';

GRANT EXECUTE ON FUNCTION public.consume_loan_increase_approval_for_borrower(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.consume_loan_increase_approval_for_borrower(uuid, uuid) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Eligibility: first loan (no completed prior) — officer may disburse without this approval.
-- Loan increase — may_disburse only with an unconsumed manager approval (within 90 days).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.borrower_loan_increase_eligibility(p_borrower_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  min_meetings int := 6;
  require_no_default boolean := true;
  has_default boolean := false;
  completed_prior boolean := false;
  attended int := 0;
  eligible_auto boolean := false;
  manager_required boolean := false;
  pending_exception_id uuid := NULL;
  valid_unconsumed_approval boolean := false;
  attendance_below_minimum boolean := false;
  can_submit_approval boolean := false;
  may_disburse_new_loan boolean := false;
BEGIN
  IF p_borrower_id IS NULL THEN
    RETURN jsonb_build_object('error', 'borrower_id required');
  END IF;

  SELECT COALESCE(
    (SELECT NULLIF(trim(value), '')::int FROM public.system_config WHERE key = 'attendanceMinMeetingsForIncreaseEligibility' LIMIT 1),
    6
  ) INTO min_meetings;

  IF min_meetings IS NULL OR min_meetings < 0 THEN
    min_meetings := 6;
  END IF;

  SELECT COALESCE(
    (SELECT lower(trim(value)) = 'true' FROM public.system_config WHERE key = 'attendanceRequireNoDefaultForAutoIncrease' LIMIT 1),
    true
  ) INTO require_no_default;

  SELECT EXISTS (
    SELECT 1 FROM public.loans l
    WHERE l.borrower_id = p_borrower_id AND l.status = 'defaulted'
  ) INTO has_default;

  SELECT EXISTS (
    SELECT 1 FROM public.loans l
    WHERE l.borrower_id = p_borrower_id AND l.status IN ('paid', 'written_off')
  ) INTO completed_prior;

  SELECT COUNT(*)::int
  INTO attended
  FROM public.attendance_records ar
  WHERE ar.borrower_id = p_borrower_id AND ar.attendance_status = 'present';

  SELECT r.id
  INTO pending_exception_id
  FROM public.loan_increase_exception_requests r
  WHERE r.borrower_id = p_borrower_id AND r.status = 'pending'
  ORDER BY r.created_at DESC
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM public.loan_increase_exception_requests r
    WHERE r.borrower_id = p_borrower_id
      AND r.status = 'approved'
      AND r.consumed_at IS NULL
      AND r.approved_at IS NOT NULL
      AND r.approved_at > now() - interval '90 days'
  ) INTO valid_unconsumed_approval;

  manager_required := has_default OR (completed_prior AND NOT valid_unconsumed_approval);

  attendance_below_minimum :=
    completed_prior
    AND NOT has_default
    AND attended < min_meetings;

  -- Informational: same attendance/history rules as before (meetings, no default). Disburse still requires manager approval for every increase.
  eligible_auto :=
    (CASE WHEN require_no_default THEN NOT has_default ELSE true END)
    AND completed_prior
    AND (attended >= min_meetings);

  can_submit_approval :=
    completed_prior
    AND NOT has_default
    AND pending_exception_id IS NULL
    AND NOT valid_unconsumed_approval;

  may_disburse_new_loan :=
    CASE
      WHEN has_default THEN false
      WHEN NOT completed_prior THEN true
      WHEN valid_unconsumed_approval THEN true
      ELSE false
    END;

  RETURN jsonb_build_object(
    'borrower_id', p_borrower_id,
    'meetings_attended', attended,
    'meetings_required', min_meetings,
    'has_default_loan_history', has_default,
    'has_completed_prior_loan', completed_prior,
    'eligible_for_auto_loan_increase', eligible_auto,
    'requires_manager_loan_approval', manager_required,
    'attendance_below_minimum', attendance_below_minimum,
    'pending_attendance_exception_request_id', pending_exception_id,
    'attendance_exception_approved', valid_unconsumed_approval,
    'can_submit_attendance_exception_request', can_submit_approval,
    'can_submit_loan_increase_approval_request', can_submit_approval,
    'may_disburse_new_loan', may_disburse_new_loan,
    'summary',
      CASE
        WHEN has_default THEN 'Borrower has a defaulted loan on record — only a manager can approve a new loan.'
        WHEN NOT completed_prior THEN 'No completed prior loan (paid or written off) on file — branch manager loan increase approval is not required for this disbursement.'
        WHEN valid_unconsumed_approval THEN
          'Branch manager approved a loan increase — you may disburse (approval is used on first disburse; valid 90 days from approval).'
        WHEN pending_exception_id IS NOT NULL THEN
          'Loan increase approval request is pending branch manager review.'
        WHEN attendance_below_minimum THEN
          format(
            'Attendance is below minimum (%s / %s). Submit a loan increase approval request for your manager (required for every increase).',
            attended,
            min_meetings
          )
        WHEN eligible_auto THEN
          format(
            'Meets attendance and history checks for increase eligibility (%s / %s meetings). Branch manager approval is still required before disburse.',
            attended,
            min_meetings
          )
        ELSE
          format(
            'Loan increase: submit a loan increase approval request for your branch manager (required for every new loan after a completed one). Attendance %s / %s.',
            attended,
            min_meetings
          )
      END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_loan_increase_exception_request(p_borrower_id uuid, p_officer_notes text)
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

  RETURN jsonb_build_object('success', true, 'id', new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.borrower_loan_increase_eligibility(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_loan_increase_exception_request(uuid, text) TO authenticated;
