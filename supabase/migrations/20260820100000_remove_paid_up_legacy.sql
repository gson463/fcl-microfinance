-- Remove legacy borrower status paid_up (replaced by eligible since 20260512233000).

UPDATE public.borrowers SET status = 'eligible' WHERE status = 'paid_up';

COMMENT ON COLUMN public.borrowers.status IS
  'eligible = ready for new loan; active_loan = has open loan; defaulted; pending = re-loan approval after default';
