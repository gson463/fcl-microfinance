-- Attendance: present | absent | ruhusa (excused). Replaces boolean `present`.

ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS attendance_status text;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attendance_records' AND column_name = 'present'
  ) THEN
    UPDATE public.attendance_records
    SET attendance_status = CASE WHEN present THEN 'present' ELSE 'absent' END
    WHERE attendance_status IS NULL;
  END IF;
END $$;

UPDATE public.attendance_records SET attendance_status = 'present' WHERE attendance_status IS NULL;

ALTER TABLE public.attendance_records
  ALTER COLUMN attendance_status SET DEFAULT 'present';

ALTER TABLE public.attendance_records
  ALTER COLUMN attendance_status SET NOT NULL;

ALTER TABLE public.attendance_records DROP CONSTRAINT IF EXISTS attendance_records_status_chk;
ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_status_chk
  CHECK (attendance_status IN ('present', 'absent', 'ruhusa'));

ALTER TABLE public.attendance_records DROP COLUMN IF EXISTS present;

COMMENT ON COLUMN public.attendance_records.attendance_status IS 'present = attended; absent = did not attend; ruhusa = excused (does not count toward loan-increase meeting minimum).';

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

  manager_required := has_default;
  eligible_auto :=
    (CASE WHEN require_no_default THEN NOT has_default ELSE true END)
    AND completed_prior
    AND (attended >= min_meetings);

  RETURN jsonb_build_object(
    'borrower_id', p_borrower_id,
    'meetings_attended', attended,
    'meetings_required', min_meetings,
    'has_default_loan_history', has_default,
    'has_completed_prior_loan', completed_prior,
    'eligible_for_auto_loan_increase', eligible_auto,
    'requires_manager_loan_approval', manager_required,
    'summary',
      CASE
        WHEN has_default THEN 'Borrower has a defaulted loan on record — only a manager can approve a new loan.'
        WHEN NOT completed_prior THEN 'No completed prior loan yet (paid or written off).'
        WHEN attended < min_meetings THEN format('Attendance: %s / %s centre meetings required for auto increase.', attended, min_meetings)
        ELSE 'Meets attendance and history checks for automatic increase eligibility (subject to product limits).'
      END
  );
END;
$$;

COMMENT ON TABLE public.attendance_records IS 'Borrower attendance per centre meeting: present, absent, or ruhusa (excused).';
