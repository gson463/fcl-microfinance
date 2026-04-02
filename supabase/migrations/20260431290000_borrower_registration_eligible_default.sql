-- New borrower registrations default to eligible (no manager approval on registration).
-- Pending is reserved for re-loan approval after default (officer requests → manager approves).
ALTER TABLE public.borrowers ALTER COLUMN status SET DEFAULT 'eligible';

COMMENT ON COLUMN public.borrowers.status IS
  'eligible = can register; active_loan = has loan; paid_up = paid; defaulted = default history; pending = awaiting manager approval for re-loan after default only';
