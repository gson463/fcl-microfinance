-- Loan increase when centre attendance is below minimum: officer submits exception; manager approves.

CREATE TABLE IF NOT EXISTS public.loan_increase_exception_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  borrower_id uuid NOT NULL REFERENCES public.borrowers(id) ON DELETE CASCADE,
  officer_id uuid NOT NULL REFERENCES public.users(id),
  officer_notes text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  manager_id uuid REFERENCES public.users(id),
  manager_notes text,
  resolved_at timestamptz,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT loan_increase_exception_requests_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS loan_increase_exception_one_pending_per_borrower
  ON public.loan_increase_exception_requests (borrower_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS loan_increase_exception_borrower_status
  ON public.loan_increase_exception_requests (borrower_id, status, created_at DESC);

COMMENT ON TABLE public.loan_increase_exception_requests IS
  'Officer request to allow a new loan / increase when attendance is below minimum; manager approves or rejects.';

ALTER TABLE public.loan_increase_exception_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_loan_increase_exception_requests"
  ON public.loan_increase_exception_requests
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.loan_increase_exception_requests TO authenticated;

-- ---------------------------------------------------------------------------
-- Extended eligibility: attendance shortfall does not block if manager approved exception (within 90 days).
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
  valid_exception_approved boolean := false;
  attendance_below_minimum boolean := false;
  can_submit_exception boolean := false;
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
      AND r.approved_at IS NOT NULL
      AND r.approved_at > now() - interval '90 days'
  ) INTO valid_exception_approved;

  manager_required := has_default;

  attendance_below_minimum :=
    completed_prior
    AND NOT has_default
    AND attended < min_meetings;

  eligible_auto :=
    (CASE WHEN require_no_default THEN NOT has_default ELSE true END)
    AND completed_prior
    AND (attended >= min_meetings);

  can_submit_exception :=
    attendance_below_minimum
    AND pending_exception_id IS NULL
    AND NOT valid_exception_approved;

  may_disburse_new_loan :=
    CASE
      WHEN has_default THEN false
      WHEN NOT completed_prior THEN true
      WHEN attended >= min_meetings THEN true
      WHEN valid_exception_approved THEN true
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
    'attendance_exception_approved', valid_exception_approved,
    'can_submit_attendance_exception_request', can_submit_exception,
    'may_disburse_new_loan', may_disburse_new_loan,
    'summary',
      CASE
        WHEN has_default THEN 'Borrower has a defaulted loan on record — only a manager can approve a new loan.'
        WHEN NOT completed_prior THEN 'No completed prior loan yet (paid or written off).'
        WHEN valid_exception_approved THEN
          'Manager approved an attendance exception — you may disburse a new loan (valid 90 days from approval).'
        WHEN pending_exception_id IS NOT NULL THEN
          'Attendance exception request is pending branch manager approval.'
        WHEN attendance_below_minimum THEN
          format(
            'Attendance is below minimum (%s / %s meetings). Submit an exception request for manager approval, or wait until attendance meets the requirement.',
            attended,
            min_meetings
          )
        ELSE 'Meets attendance and history checks for automatic increase eligibility (subject to product limits).'
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
  min_meetings int := 6;
  attended int := 0;
  has_default boolean := false;
  completed_prior boolean := false;
  new_id uuid;
BEGIN
  IF v_officer IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;
  IF p_borrower_id IS NULL THEN
    RETURN jsonb_build_object('error', 'borrower_id required');
  END IF;
  IF p_officer_notes IS NULL OR length(trim(p_officer_notes)) < 10 THEN
    RETURN jsonb_build_object('error', 'Please enter notes (at least 10 characters) explaining why this borrower should be considered despite low attendance.');
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
    RETURN jsonb_build_object('error', 'A pending attendance exception request already exists for this borrower.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.loan_increase_exception_requests r
    WHERE r.borrower_id = p_borrower_id
      AND r.status = 'approved'
      AND r.approved_at IS NOT NULL
      AND r.approved_at > now() - interval '90 days'
  ) THEN
    RETURN jsonb_build_object('error', 'An approved attendance exception is already active for this borrower.');
  END IF;

  SELECT COALESCE(
    (SELECT NULLIF(trim(value), '')::int FROM public.system_config WHERE key = 'attendanceMinMeetingsForIncreaseEligibility' LIMIT 1),
    6
  ) INTO min_meetings;
  IF min_meetings IS NULL OR min_meetings < 0 THEN
    min_meetings := 6;
  END IF;

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

  IF has_default THEN
    RETURN jsonb_build_object('error', 'Borrower has a defaulted loan — use the default / manager approval workflow, not this request.');
  END IF;
  IF NOT completed_prior THEN
    RETURN jsonb_build_object('error', 'Attendance exception applies only after a completed prior loan.');
  END IF;
  IF attended >= min_meetings THEN
    RETURN jsonb_build_object('error', 'Attendance already meets the minimum; no exception request is needed.');
  END IF;

  INSERT INTO public.loan_increase_exception_requests (borrower_id, officer_id, officer_notes, status)
  VALUES (p_borrower_id, v_officer, trim(p_officer_notes), 'pending')
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('success', true, 'id', new_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_loan_increase_exception_request(
  p_request_id uuid,
  p_approve boolean,
  p_manager_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mgr uuid := auth.uid();
  n int := 0;
BEGIN
  IF v_mgr IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('error', 'request_id required');
  END IF;

  UPDATE public.loan_increase_exception_requests r
  SET
    status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    manager_id = v_mgr,
    manager_notes = NULLIF(trim(COALESCE(p_manager_notes, '')), ''),
    resolved_at = now(),
    approved_at = CASE WHEN p_approve THEN now() ELSE NULL END
  WHERE r.id = p_request_id AND r.status = 'pending';

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN jsonb_build_object('error', 'Request not found or already resolved.');
  END IF;

  RETURN jsonb_build_object('success', true, 'approved', p_approve);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_loan_increase_exception_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_loan_increase_exception_request(uuid, boolean, text) TO authenticated;

REVOKE ALL ON FUNCTION public.submit_loan_increase_exception_request(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_loan_increase_exception_request(uuid, boolean, text) FROM PUBLIC;
