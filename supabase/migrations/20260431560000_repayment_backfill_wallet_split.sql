-- Recompute prepayment_amount + scheduled_due_snapshot for every repayment (wallet / Field Wallet).
-- Order: oldest first per loan so each call sees schedule state before that payment (matches record-time due).
-- Run after wallet split RPCs exist (20260431150000 + 20260431530000 / 20260431550000).
--
-- Note: can take a while on large datasets; run during low traffic if needed.

DO $$
DECLARE
  rec RECORD;
  n int := 0;
BEGIN
  FOR rec IN
    SELECT id
    FROM public.repayments
    ORDER BY loan_id, COALESCE(actual_payment_date::date, payment_date::date), id
  LOOP
    PERFORM public.repayment_recompute_prepayment(rec.id);
    n := n + 1;
  END LOOP;
  RAISE NOTICE 'repayment_recompute_prepayment: % rows', n;
END $$;
