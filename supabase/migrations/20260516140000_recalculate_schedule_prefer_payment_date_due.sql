-- Allocate each repayment's scheduled portion first to the installment whose dueDate equals
-- actual_payment_date (field collection date), then FIFO on the remainder for that repayment.
-- Prepayment bucket behavior unchanged (backward). Wallet / actual_payment_date unchanged.

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
  rep_row record;
  r_rem numeric;
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

  -- Phase 1 (scheduled cash): per repayment row — same due date as payment date, then FIFO remainder.
  FOR rep_row IN
    SELECT
      amount,
      COALESCE(prepayment_amount, 0) AS prep,
      actual_payment_date AS payd
    FROM public.repayments
    WHERE loan_id = p_loan_id
    ORDER BY actual_payment_date ASC NULLS LAST, created_at ASC, id ASC
  LOOP
    r_rem := GREATEST(0, COALESCE(rep_row.amount, 0) - COALESCE(rep_row.prep, 0));
    IF r_rem <= 0.01 THEN
      CONTINUE;
    END IF;

    IF rep_row.payd IS NOT NULL THEN
      FOR i IN 0 .. (len - 1) LOOP
        IF r_rem <= 0.01 THEN
          EXIT;
        END IF;
        elem := loan_row.schedule->i;
        inst_amt := COALESCE((elem->>'amount')::numeric, 0);
        IF inst_amt <= 0.01 THEN
          CONTINUE;
        END IF;
        IF (elem->>'dueDate')::date IS DISTINCT FROM rep_row.payd THEN
          CONTINUE;
        END IF;
        need := inst_amt - COALESCE(paid_amts[i + 1], 0);
        IF need <= 0.01 THEN
          CONTINUE;
        END IF;
        alloc := LEAST(r_rem, need);
        paid_amts[i + 1] := COALESCE(paid_amts[i + 1], 0) + alloc;
        r_rem := r_rem - alloc;
        EXIT;
      END LOOP;
    END IF;

    FOR i IN 0 .. (len - 1) LOOP
      IF r_rem <= 0.01 THEN
        EXIT;
      END IF;
      elem := loan_row.schedule->i;
      inst_amt := COALESCE((elem->>'amount')::numeric, 0);
      IF inst_amt <= 0.01 THEN
        CONTINUE;
      END IF;
      need := inst_amt - COALESCE(paid_amts[i + 1], 0);
      IF need <= 0.01 THEN
        CONTINUE;
      END IF;
      alloc := LEAST(r_rem, need);
      paid_amts[i + 1] := COALESCE(paid_amts[i + 1], 0) + alloc;
      r_rem := r_rem - alloc;
    END LOOP;
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
  'Scheduled cash: per repayment (chronological), allocate to installment with dueDate = actual_payment_date first, then FIFO remainder. Prepayment bucket fills backward on remaining need. Fills principal_paid/interest_paid when both NULL.';
