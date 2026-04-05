-- Immutable history: rows in loan_increase_exception_requests are never deleted for normal flows.
-- Audit log entries for officer submissions, manager decisions, and consumption on disburse.

CREATE INDEX IF NOT EXISTS idx_loan_increase_exception_requests_created_at
  ON public.loan_increase_exception_requests (created_at DESC);

COMMENT ON TABLE public.loan_increase_exception_requests IS
  'Full history of loan increase approval requests: officer submission, manager approve/reject, optional consumption when a loan is disbursed. Append-only (no deletes in app flows).';

-- ---------------------------------------------------------------------------
-- Consume: log when approval is used at disburse
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_loan_increase_approval_for_borrower(p_borrower_id uuid, p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req_id uuid;
BEGIN
  IF p_borrower_id IS NULL THEN
    RETURN;
  END IF;

  SELECT r2.id
  INTO v_req_id
  FROM public.loan_increase_exception_requests r2
  WHERE r2.borrower_id = p_borrower_id
    AND r2.status = 'approved'
    AND r2.consumed_at IS NULL
    AND r2.approved_at IS NOT NULL
    AND r2.approved_at > now() - interval '90 days'
  ORDER BY r2.approved_at DESC
  LIMIT 1;

  IF v_req_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.loan_increase_exception_requests r
  SET
    consumed_at = now(),
    consumed_at_loan_id = p_loan_id
  WHERE r.id = v_req_id;

  PERFORM public.log_audit_event(
    'loan_increase_approval.consumed',
    'loan_increase_exception_request',
    v_req_id::text,
    jsonb_build_object(
      'borrower_id', p_borrower_id,
      'consumed_loan_id', p_loan_id
    )
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Officer submits request
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- Manager approves or rejects
-- ---------------------------------------------------------------------------
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
  v_borrower uuid;
BEGIN
  IF v_mgr IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('error', 'request_id required');
  END IF;

  SELECT r.borrower_id
  INTO v_borrower
  FROM public.loan_increase_exception_requests r
  WHERE r.id = p_request_id AND r.status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Request not found or already resolved.');
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

  PERFORM public.log_audit_event(
    CASE WHEN p_approve THEN 'loan_increase_approval.approved' ELSE 'loan_increase_approval.rejected' END,
    'loan_increase_exception_request',
    p_request_id::text,
    jsonb_build_object(
      'borrower_id', v_borrower,
      'approved', p_approve,
      'manager_notes_present', length(trim(COALESCE(p_manager_notes, ''))) > 0
    )
  );

  RETURN jsonb_build_object('success', true, 'approved', p_approve);
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_loan_increase_approval_for_borrower(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_loan_increase_exception_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_loan_increase_exception_request(uuid, boolean, text) TO authenticated;
