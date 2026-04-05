-- Allocate total repaid: forward for arrears + due on/before today; remaining (prepayment) from last installment backward.

CREATE OR REPLACE FUNCTION public.recalculate_loan_schedule(p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  loan_row public.loans%ROWTYPE;
  total_repaid numeric;
  new_sched jsonb := '[]'::jsonb;
  len int;
  i int;
  elem jsonb;
  rem numeric;
  inst_amt numeric;
  paid_to_inst numeric;
  need numeric;
  add_amt numeric;
  st text;
  due date;
  paid_amts numeric[];
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
  rem := total_repaid;

  paid_amts := array_fill(0::numeric, ARRAY[len]);

  -- Phase 1 (forward): past due and due on/before today, in schedule order.
  FOR i IN 0 .. (len - 1) LOOP
    elem := loan_row.schedule->i;
    inst_amt := COALESCE((elem->>'amount')::numeric, 0);
    due := (elem->>'dueDate')::date;
    IF inst_amt <= 0 THEN
      CONTINUE;
    END IF;
    IF due > CURRENT_DATE THEN
      CONTINUE;
    END IF;
    paid_amts[i + 1] := LEAST(rem, inst_amt);
    rem := rem - paid_amts[i + 1];
  END LOOP;

  -- Phase 2 (backward): prepayment on future installments, last to first.
  FOR i IN REVERSE (len - 1)..0 LOOP
    elem := loan_row.schedule->i;
    inst_amt := COALESCE((elem->>'amount')::numeric, 0);
    due := (elem->>'dueDate')::date;
    IF inst_amt <= 0 THEN
      CONTINUE;
    END IF;
    IF due <= CURRENT_DATE THEN
      CONTINUE;
    END IF;
    need := inst_amt - paid_amts[i + 1];
    IF need <= 0.01 THEN
      CONTINUE;
    END IF;
    add_amt := LEAST(rem, need);
    paid_amts[i + 1] := paid_amts[i + 1] + add_amt;
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
END;
$$;

COMMENT ON FUNCTION public.recalculate_loan_schedule(uuid) IS
  'Allocates repayments: forward for due on/before CURRENT_DATE; remaining pool backward from last future installment.';
