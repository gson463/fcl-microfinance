-- Prevent two concurrent or duplicate "blocking" loans for the same borrower.
-- Matches disbursement UX in LoanManagement.jsx (loanDoesNotBlockNewDisburse):
-- a row is NON-blocking only when written off, or marked paid with negligible balance.

CREATE UNIQUE INDEX IF NOT EXISTS uniq_loans_one_blocking_per_borrower
ON public.loans (borrower_id)
WHERE borrower_id IS NOT NULL
  AND NOT (
    status = 'written_off'
    OR (status = 'paid' AND COALESCE(balance, 0) <= 0.01)
  );

COMMENT ON INDEX public.uniq_loans_one_blocking_per_borrower IS
  'At most one unsettled/active loan workflow per borrower; allows multiple settled (paid/zero balance) historical rows per borrower id.';
