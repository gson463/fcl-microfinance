-- Populate repayments.principal_paid / interest_paid when NULL (wallet insert path omits them).
-- Uses loan-level ratio: each installment from generateSchedule has the same P/(P+I) share as principal/total_payable.

CREATE OR REPLACE FUNCTION public.recalculate_loan_schedule(p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  loan_row public.loans%ROWTYPE;
  total_repaid numeric;
  sched_cash numeric;
  prep_cash numeric;
  new_sched jsonb := '[]'::jsonb;
  len int;
  i int;
  elem jsonb;
  rem numeric;
  inst_amt numeric;
  alloc numeric;
  need numeric;
  add_amt numeric;
  paid_to_inst numeric;
  st text;
  due date;
  paid_amts numeric[];
  tp numeric;
BEGIN
  SELECT * INTO loan_row FROM public.loans WHERE id = p_loan_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF loan_row.schedule IS NULL OR jsonb_typeof(loan_row.schedule) <> 'array' THEN
    RETURN;
  END IF;

  len := jsonb_array_length(loan_row.schedule);
  IF len IS NULL OR len = 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO total_repaid FROM public.repayments WHERE loan_id = p_loan_id;

  SELECT
    COALESCE(SUM(GREATEST(0, amount - COALESCE(prepayment_amount, 0))), 0),
    COALESCE(SUM(GREATEST(0, COALESCE(prepayment_amount, 0))), 0)
  INTO sched_cash, prep_cash
  FROM public.repayments
  WHERE loan_id = p_loan_id;

  IF sched_cash + prep_cash > total_repaid + 0.02 THEN
    sched_cash := total_repaid - prep_cash;
  ELSIF sched_cash + prep_cash < total_repaid - 0.02 THEN
    sched_cash := sched_cash + (total_repaid - sched_cash - prep_cash);
  END IF;

  paid_amts := array_fill(0::numeric, ARRAY[len]);

  rem := sched_cash;
  FOR i IN 0 .. (len - 1) LOOP
    elem := loan_row.schedule->i;
    inst_amt := COALESCE((elem->>'amount')::numeric, 0);
    IF inst_amt <= 0.01 THEN
      CONTINUE;
    END IF;
    alloc := LEAST(rem, inst_amt);
    paid_amts[i + 1] := alloc;
    rem := rem - alloc;
    IF rem <= 0.01 THEN
      EXIT;
    END IF;
  END LOOP;

  rem := prep_cash;
  FOR i IN REVERSE (len - 1)..0 LOOP
    elem := loan_row.schedule->i;
    inst_amt := COALESCE((elem->>'amount')::numeric, 0);
    IF inst_amt <= 0.01 THEN
      CONTINUE;
    END IF;
    need := inst_amt - COALESCE(paid_amts[i + 1], 0);
    IF need <= 0.01 THEN
      CONTINUE;
    END IF;
    add_amt := LEAST(rem, need);
    paid_amts[i + 1] := COALESCE(paid_amts[i + 1], 0) + add_amt;
    rem := rem - add_amt;
  END LOOP;

  FOR i IN 0 .. (len - 1) LOOP
    elem := loan_row.schedule->i;
    inst_amt := COALESCE((elem->>'amount')::numeric, 0);
    paid_to_inst := COALESCE(paid_amts[i + 1], 0);
    due := (elem->>'dueDate')::date;
    IF inst_amt <= 0 THEN
      st := 'pending';
    ELSIF paid_to_inst >= inst_amt - 0.01 THEN
      st := 'paid';
    ELSIF due < CURRENT_DATE AND paid_to_inst < inst_amt - 0.01 THEN
      st := 'arrears';
    ELSE
      st := 'pending';
    END IF;
    elem := elem || jsonb_build_object('paidAmount', paid_to_inst, 'status', st);
    new_sched := new_sched || jsonb_build_array(elem);
  END LOOP;

  UPDATE public.loans
  SET
    schedule = new_sched,
    balance = GREATEST(0, loan_row.total_payable - total_repaid),
    outstanding_interest = GREATEST(
      0,
      CASE
        WHEN loan_row.total_payable <= 0 THEN 0
        ELSE (loan_row.total_payable - loan_row.principal)
          * (GREATEST(0, loan_row.total_payable - total_repaid) / NULLIF(loan_row.total_payable, 0))
      END
    )
  WHERE id = p_loan_id;

  tp := NULLIF(loan_row.total_payable, 0);
  IF tp IS NOT NULL AND tp > 0 THEN
    UPDATE public.repayments r
    SET
      principal_paid = ROUND((r.amount * loan_row.principal / tp)::numeric, 2),
      interest_paid = r.amount - ROUND((r.amount * loan_row.principal / tp)::numeric, 2)
    WHERE r.loan_id = p_loan_id
      AND r.amount IS NOT NULL
      AND r.amount > 0
      AND r.principal_paid IS NULL
      AND r.interest_paid IS NULL;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.recalculate_loan_schedule(uuid) IS
  'Allocates repayments to schedule (FIFO + prepayment backward). Fills principal_paid/interest_paid on repayments when both NULL using principal/total_payable ratio.';

-- Backfill existing rows (same rule).
UPDATE public.repayments r
SET
  principal_paid = ROUND((r.amount * l.principal / NULLIF(l.total_payable, 0))::numeric, 2),
  interest_paid = r.amount - ROUND((r.amount * l.principal / NULLIF(l.total_payable, 0))::numeric, 2)
FROM public.loans l
WHERE r.loan_id = l.id
  AND l.total_payable IS NOT NULL
  AND l.total_payable > 0
  AND r.amount IS NOT NULL
  AND r.amount > 0
  AND r.principal_paid IS NULL
  AND r.interest_paid IS NULL;
