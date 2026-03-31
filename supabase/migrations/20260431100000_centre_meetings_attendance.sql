-- Centre meetings (one date per centre — all groups at that centre meet the same day)
-- Attendance per borrower per meeting; eligibility RPC for loan-increase rules

CREATE TABLE public.centre_meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_id uuid NOT NULL REFERENCES public.centers (id) ON DELETE CASCADE,
  meeting_date date NOT NULL,
  loan_officer_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT centre_meetings_centre_date_uniq UNIQUE (centre_id, meeting_date)
);

CREATE INDEX idx_centre_meetings_centre_id ON public.centre_meetings (centre_id);
CREATE INDEX idx_centre_meetings_meeting_date ON public.centre_meetings (meeting_date DESC);
CREATE INDEX idx_centre_meetings_officer ON public.centre_meetings (loan_officer_id);

CREATE TABLE public.attendance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  centre_meeting_id uuid NOT NULL REFERENCES public.centre_meetings (id) ON DELETE CASCADE,
  borrower_id uuid NOT NULL REFERENCES public.borrowers (id) ON DELETE CASCADE,
  group_id uuid NOT NULL REFERENCES public.groups (id) ON DELETE RESTRICT,
  present boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT attendance_meeting_borrower_uniq UNIQUE (centre_meeting_id, borrower_id)
);

CREATE INDEX idx_attendance_borrower ON public.attendance_records (borrower_id);
CREATE INDEX idx_attendance_meeting ON public.attendance_records (centre_meeting_id);

ALTER TABLE public.centre_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_centre_meetings" ON public.centre_meetings FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all_attendance_records" ON public.attendance_records FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.centre_meetings TO authenticated;
GRANT ALL ON public.attendance_records TO authenticated;

INSERT INTO public.system_config (key, value)
SELECT 'attendanceMinMeetingsForIncreaseEligibility', '6'
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'attendanceMinMeetingsForIncreaseEligibility');

INSERT INTO public.system_config (key, value)
SELECT 'attendanceRequireNoDefaultForAutoIncrease', 'true'
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'attendanceRequireNoDefaultForAutoIncrease');

COMMENT ON TABLE public.centre_meetings IS 'One row per centre per meeting date; all groups under the centre share this session.';
COMMENT ON TABLE public.attendance_records IS 'Borrower attendance for a centre meeting (present/absent).';

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
  WHERE ar.borrower_id = p_borrower_id AND ar.present = true;

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

REVOKE ALL ON FUNCTION public.borrower_loan_increase_eligibility(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.borrower_loan_increase_eligibility(uuid) TO authenticated;
