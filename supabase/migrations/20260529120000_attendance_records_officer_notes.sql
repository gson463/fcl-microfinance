-- Optional per-borrower notes on centre meeting attendance (officer UI).

ALTER TABLE public.attendance_records
  ADD COLUMN IF NOT EXISTS officer_notes text;

ALTER TABLE public.attendance_records
  DROP CONSTRAINT IF EXISTS attendance_records_officer_notes_len_chk;

ALTER TABLE public.attendance_records
  ADD CONSTRAINT attendance_records_officer_notes_len_chk
  CHECK (officer_notes IS NULL OR length(officer_notes) <= 2000);

COMMENT ON COLUMN public.attendance_records.officer_notes IS
  'Optional notes from the loan officer for this borrower at this centre meeting.';
