-- Loan increase approval is required only when the new principal exceeds the last loan's disburse (principal).
-- Attendance (meetings) must NOT block may_disburse_new_loan; still returned for display.
-- First-time borrowers (no completed prior loan) are unchanged.

DROP FUNCTION IF EXISTS public.borrower_loan_increase_eligibility(uuid);

CREATE OR REPLACE FUNCTION public.borrower_loan_increase_eligibility(
  p_borrower_id uuid,
  p_proposed_principal numeric DEFAULT NULL
)
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
  last_principal numeric := NULL;
  amount_increased boolean := false;
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

  SELECT l.principal INTO last_principal
  FROM public.loans l
  WHERE l.borrower_id = p_borrower_id
  ORDER BY l.disbursement_date DESC NULLS LAST, l.created_at DESC
  LIMIT 1;

  IF completed_prior
    AND p_proposed_principal IS NOT NULL
    AND last_principal IS NOT NULL
    AND p_proposed_principal > COALESCE(last_principal, 0) + 0.0000001
  THEN
    amount_increased := true;
  ELSE
    amount_increased := false;
  END IF;

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

  attendance_below_minimum :=
    completed_prior
    AND NOT has_default
    AND attended < min_meetings;

  eligible_auto :=
    (CASE WHEN require_no_default THEN NOT has_default ELSE true END)
    AND completed_prior
    AND (attended >= min_meetings);

  -- Submit manager request: increase over last principal, or missing approval when that applies.
  can_submit_approval :=
    completed_prior
    AND NOT has_default
    AND pending_exception_id IS NULL
    AND NOT valid_unconsumed_approval
    AND amount_increased;

  manager_required :=
    has_default
    OR (completed_prior AND amount_increased AND NOT valid_unconsumed_approval)
    OR (completed_prior AND p_proposed_principal IS NULL AND NOT valid_unconsumed_approval);

  -- Core disburse gate (attendance must not block).
  IF has_default THEN
    may_disburse_new_loan := false;
  ELSIF NOT completed_prior THEN
    may_disburse_new_loan := true;
  ELSIF p_proposed_principal IS NULL THEN
    may_disburse_new_loan := false;
  ELSIF amount_increased THEN
    may_disburse_new_loan := valid_unconsumed_approval;
  ELSE
    may_disburse_new_loan := true;
  END IF;

  RETURN jsonb_build_object(
    'borrower_id', p_borrower_id,
    'meetings_attended', attended,
    'meetings_required', min_meetings,
    'has_default_loan_history', has_default,
    'has_completed_prior_loan', completed_prior,
    'last_disburse_principal', last_principal,
    'proposed_principal', p_proposed_principal,
    'amount_increased_vs_last_disburse', amount_increased,
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
        WHEN p_proposed_principal IS NULL THEN 'Enter the loan principal to check whether this disburse is higher than the last loan (increase requires manager approval).'
        WHEN valid_unconsumed_approval THEN
          'Branch manager approved a loan increase — you may disburse (approval is used on first disburse; valid 90 days from approval).'
        WHEN pending_exception_id IS NOT NULL THEN
          'Loan increase approval request is pending branch manager review.'
        WHEN amount_increased AND NOT valid_unconsumed_approval THEN
          format(
            'New principal (%s) is higher than last disburse (%s). Submit branch manager approval before disburse.',
            trim(to_char(p_proposed_principal, 'FM999999990.009')),
            trim(to_char(COALESCE(last_principal, 0), 'FM999999990.009'))
          )
        WHEN NOT amount_increased THEN
          format(
            'Principal is not higher than last disburse (%s). You may disburse without a new increase approval (attendance is informational only).',
            trim(to_char(COALESCE(last_principal, 0), 'FM999999990.009'))
          )
        WHEN attendance_below_minimum THEN
          format(
            'Attendance is %s / %s meetings (informational — does not block disburse for non-increase).',
            attended,
            min_meetings
          )
        WHEN eligible_auto THEN
          format(
            'Meets attendance checks (%s / %s). For a higher principal than last disburse, manager approval is still required.',
            attended,
            min_meetings
          )
        ELSE
          format(
            'Attendance %s / %s (informational). Increase over last disburse still requires manager approval when applicable.',
            attended,
            min_meetings
          )
      END
  );
END;
$$;

COMMENT ON FUNCTION public.borrower_loan_increase_eligibility(uuid, numeric) IS
  'Loan increase (manager) gate only when proposed principal > last loan principal; attendance does not block may_disburse.';

GRANT EXECUTE ON FUNCTION public.borrower_loan_increase_eligibility(uuid, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.borrower_loan_increase_eligibility(uuid, numeric) FROM PUBLIC;
