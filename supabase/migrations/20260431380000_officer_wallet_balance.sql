-- Persistent officer field wallet balance (lifetime): same formula as Field wallet UI.
-- Recalculated on changes to taken, repayments, loans (disburse + fee), expenses, and application fee config.

CREATE TABLE public.officer_wallet_balances (
  officer_id uuid NOT NULL,
  balance numeric NOT NULL DEFAULT 0,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT officer_wallet_balances_pkey PRIMARY KEY (officer_id),
  CONSTRAINT officer_wallet_balances_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.users (id) ON DELETE CASCADE
);

CREATE INDEX idx_officer_wallet_balances_updated ON public.officer_wallet_balances (updated_at);

ALTER TABLE public.officer_wallet_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_officer_wallet_balances" ON public.officer_wallet_balances
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Lifetime balance: sum(taken) + sum(repayments) + count(loans)*fee - sum(principal) - sum(expenses)
CREATE OR REPLACE FUNCTION public.recalculate_officer_wallet_balance(p_officer_id uuid)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fee numeric;
  v_balance numeric;
BEGIN
  IF p_officer_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(NULLIF(trim(value), '')::numeric, 0) INTO v_fee
  FROM public.system_config
  WHERE key = 'applicationFeePerDisbursement'
  LIMIT 1;

  IF v_fee IS NULL THEN
    v_fee := 0;
  END IF;

  SELECT
    COALESCE((SELECT SUM(amount_taken) FROM public.officer_field_taken WHERE officer_id = p_officer_id), 0)
    + COALESCE((SELECT SUM(amount) FROM public.repayments WHERE officer_id = p_officer_id), 0)
    + COALESCE((SELECT COUNT(*)::numeric * v_fee FROM public.loans WHERE officer_id = p_officer_id), 0)
    - COALESCE((SELECT SUM(principal) FROM public.loans WHERE officer_id = p_officer_id), 0)
    - COALESCE((SELECT SUM(amount) FROM public.expenses WHERE officer_id = p_officer_id), 0)
  INTO v_balance;

  INSERT INTO public.officer_wallet_balances (officer_id, balance, updated_at)
  VALUES (p_officer_id, v_balance, now())
  ON CONFLICT (officer_id) DO UPDATE
  SET balance = EXCLUDED.balance, updated_at = EXCLUDED.updated_at;

  RETURN v_balance;
END;
$$;

COMMENT ON FUNCTION public.recalculate_officer_wallet_balance(uuid) IS
  'Recomputes lifetime field wallet: taken + repayments + (loan count * application fee) - disbursed principal - expenses.';

GRANT EXECUTE ON FUNCTION public.recalculate_officer_wallet_balance(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.trigger_officer_wallet_balance_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.officer_id IS NOT NULL THEN
      PERFORM public.recalculate_officer_wallet_balance(OLD.officer_id);
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.officer_id IS NOT NULL AND OLD.officer_id IS DISTINCT FROM NEW.officer_id THEN
      PERFORM public.recalculate_officer_wallet_balance(OLD.officer_id);
    END IF;
    IF NEW.officer_id IS NOT NULL THEN
      PERFORM public.recalculate_officer_wallet_balance(NEW.officer_id);
    END IF;
    RETURN NEW;
  ELSE
    IF NEW.officer_id IS NOT NULL THEN
      PERFORM public.recalculate_officer_wallet_balance(NEW.officer_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

CREATE TRIGGER trg_repayments_officer_wallet
  AFTER INSERT OR UPDATE OR DELETE ON public.repayments
  FOR EACH ROW EXECUTE FUNCTION public.trigger_officer_wallet_balance_recalc();

CREATE TRIGGER trg_loans_officer_wallet
  AFTER INSERT OR UPDATE OR DELETE ON public.loans
  FOR EACH ROW EXECUTE FUNCTION public.trigger_officer_wallet_balance_recalc();

CREATE TRIGGER trg_expenses_officer_wallet
  AFTER INSERT OR UPDATE OR DELETE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.trigger_officer_wallet_balance_recalc();

CREATE TRIGGER trg_officer_field_taken_wallet
  AFTER INSERT OR UPDATE OR DELETE ON public.officer_field_taken
  FOR EACH ROW EXECUTE FUNCTION public.trigger_officer_wallet_balance_recalc();

CREATE OR REPLACE FUNCTION public.trigger_system_config_application_fee_wallet()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  u RECORD;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.key = 'applicationFeePerDisbursement' THEN
      FOR u IN SELECT id FROM public.users WHERE role = 'officer'
      LOOP
        PERFORM public.recalculate_officer_wallet_balance(u.id);
      END LOOP;
    END IF;
    RETURN OLD;
  END IF;

  IF NEW.key = 'applicationFeePerDisbursement' THEN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.value IS DISTINCT FROM NEW.value) THEN
      FOR u IN SELECT id FROM public.users WHERE role = 'officer'
      LOOP
        PERFORM public.recalculate_officer_wallet_balance(u.id);
      END LOOP;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_system_config_fee_officer_wallet
  AFTER INSERT OR UPDATE OR DELETE ON public.system_config
  FOR EACH ROW EXECUTE FUNCTION public.trigger_system_config_application_fee_wallet();

-- Initial rows for all loan officers
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM public.users WHERE role = 'officer'
  LOOP
    PERFORM public.recalculate_officer_wallet_balance(r.id);
  END LOOP;
END $$;
