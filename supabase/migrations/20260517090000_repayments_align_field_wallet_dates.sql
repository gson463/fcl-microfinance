-- Ensure every repayment row ties to Field wallet by calendar day:
-- officer_wallet_balance_*, fetchAdminFieldWalletSnapshot, and RPCs filter on
-- actual_payment_date + officer_id. NULL actual_payment_date excludes the row
-- from per-day totals while still counting in lifetime SUM(amount).

-- 1) Backfill legacy rows
UPDATE public.repayments r
SET actual_payment_date = r.payment_date
WHERE r.actual_payment_date IS NULL
  AND r.payment_date IS NOT NULL;

UPDATE public.repayments r
SET officer_id = l.officer_id
FROM public.loans l
WHERE r.loan_id = l.id
  AND r.officer_id IS NULL
  AND l.officer_id IS NOT NULL;

-- 2) Normalize on write (BEFORERow-level so NOT NULL and downstream triggers see final values)
CREATE OR REPLACE FUNCTION public.repayments_normalize_for_field_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer uuid;
BEGIN
  IF NEW.loan_id IS NOT NULL AND NEW.officer_id IS NULL THEN
    SELECT l.officer_id INTO v_officer FROM public.loans l WHERE l.id = NEW.loan_id;
    NEW.officer_id := v_officer;
  END IF;

  IF NEW.actual_payment_date IS NULL AND NEW.payment_date IS NOT NULL THEN
    NEW.actual_payment_date := NEW.payment_date;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.repayments_normalize_for_field_wallet() IS
  'Before insert/update: set officer_id from loan when missing; set actual_payment_date from payment_date when missing so Field wallet day views include the repayment.';

DROP TRIGGER IF EXISTS trg_repayments_field_wallet_normalize ON public.repayments;
CREATE TRIGGER trg_repayments_field_wallet_normalize
  BEFORE INSERT OR UPDATE OF loan_id, officer_id, payment_date, actual_payment_date
  ON public.repayments
  FOR EACH ROW
  EXECUTE FUNCTION public.repayments_normalize_for_field_wallet();

-- 3) Prevent new NULL actual_payment_date (BEFORE trigger fills from payment_date; payment_date is NOT NULL)
ALTER TABLE public.repayments
  ALTER COLUMN actual_payment_date SET NOT NULL;

COMMENT ON COLUMN public.repayments.actual_payment_date IS
  'Calendar day of collection; drives Field wallet per-day totals (with officer_id). Equal to payment_date when both refer to the same business day.';
