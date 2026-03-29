-- =============================================================================
-- FCL: DATABASE YOTE (schema + RLS + RPC) — bandika SQL Editor → Run mara moja
-- Kumbuka: ikiwa jedwali tayari zipo, faili hii itaanguka — tumia migrations tofauti au DB tupu
-- =============================================================================

-- FCL microfinance schema (ordered for FK dependencies)
-- Run in Supabase SQL Editor or: supabase db push / supabase migration up

-- Extensions (Supabase usually has these; safe IF NOT EXISTS)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. No dependencies on other public tables
CREATE TABLE public.branches (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT branches_pkey PRIMARY KEY (id)
);

-- 2. Links to auth.users and branches
CREATE TABLE public.users (
  id uuid NOT NULL,
  full_name text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role = ANY (ARRAY['admin'::text, 'manager'::text, 'officer'::text])),
  branch_id uuid,
  phone_number text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id),
  CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id),
  CONSTRAINT users_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id)
);

-- 3. Centers depend on branches + users
CREATE TABLE public.centers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  location text,
  loan_officer_id uuid,
  branch_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT centers_pkey PRIMARY KEY (id),
  CONSTRAINT centers_loan_officer_id_fkey FOREIGN KEY (loan_officer_id) REFERENCES public.users(id),
  CONSTRAINT centers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id)
);

-- 4. Groups depend on centers + users
CREATE TABLE public.groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  center_id uuid,
  loan_officer_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT groups_pkey PRIMARY KEY (id),
  CONSTRAINT groups_center_id_fkey FOREIGN KEY (center_id) REFERENCES public.centers(id),
  CONSTRAINT groups_loan_officer_id_fkey FOREIGN KEY (loan_officer_id) REFERENCES public.users(id)
);

-- 5. Loan products (standalone)
CREATE TABLE public.loan_products (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  min_amount numeric NOT NULL,
  max_amount numeric NOT NULL,
  interest_rate numeric NOT NULL,
  loan_period integer NOT NULL,
  loan_period_unit text NOT NULL,
  repayment_frequency text NOT NULL,
  status text DEFAULT 'active'::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT loan_products_pkey PRIMARY KEY (id)
);

-- 6. Borrowers depend on users, branches, groups
CREATE TABLE public.borrowers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  borrower_id text NOT NULL UNIQUE,
  first_name text NOT NULL,
  surname text NOT NULL,
  gender text,
  dob date,
  address text,
  phone_number text,
  identification_type text,
  identification_number text,
  business_name text,
  business_location text,
  loan_officer_id uuid,
  branch_id uuid,
  group_id uuid,
  status text DEFAULT 'eligible'::text,
  created_at timestamp with time zone DEFAULT now(),
  borrower_type text NOT NULL DEFAULT 'individual'::text,
  CONSTRAINT borrowers_pkey PRIMARY KEY (id),
  CONSTRAINT borrowers_loan_officer_id_fkey FOREIGN KEY (loan_officer_id) REFERENCES public.users(id),
  CONSTRAINT borrowers_branch_id_fkey FOREIGN KEY (branch_id) REFERENCES public.branches(id),
  CONSTRAINT borrowers_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.groups(id)
);

-- 7. Loans depend on borrowers, loan_products, users
CREATE TABLE public.loans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  loan_id text NOT NULL UNIQUE,
  borrower_id uuid,
  product_id uuid,
  officer_id uuid,
  principal numeric NOT NULL,
  interest_rate numeric NOT NULL,
  total_payable numeric NOT NULL,
  balance numeric NOT NULL,
  outstanding_interest numeric NOT NULL,
  repayment_frequency text NOT NULL,
  period integer NOT NULL,
  period_unit text NOT NULL,
  disbursement_date date NOT NULL,
  repayment_start_date date NOT NULL,
  status text NOT NULL,
  schedule jsonb,
  edit_request jsonb,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT loans_pkey PRIMARY KEY (id),
  CONSTRAINT loans_borrower_id_fkey FOREIGN KEY (borrower_id) REFERENCES public.borrowers(id),
  CONSTRAINT loans_product_id_fkey FOREIGN KEY (product_id) REFERENCES public.loan_products(id),
  CONSTRAINT loans_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.users(id)
);

-- 8. Repayments depend on loans, borrowers, users
CREATE TABLE public.repayments (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  loan_id uuid,
  borrower_id uuid,
  amount numeric NOT NULL,
  payment_date date NOT NULL,
  officer_id uuid,
  created_at timestamp with time zone DEFAULT now(),
  principal_paid numeric,
  interest_paid numeric,
  actual_payment_date date,
  CONSTRAINT repayments_pkey PRIMARY KEY (id),
  CONSTRAINT repayments_loan_id_fkey FOREIGN KEY (loan_id) REFERENCES public.loans(id),
  CONSTRAINT repayments_borrower_id_fkey FOREIGN KEY (borrower_id) REFERENCES public.borrowers(id),
  CONSTRAINT repayments_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.users(id)
);

-- 9. No FKs to other app tables
CREATE TABLE public.holidays (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  date date NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT holidays_pkey PRIMARY KEY (id)
);

CREATE TABLE public.expenses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  officer_id uuid,
  expense_type text NOT NULL,
  amount numeric NOT NULL,
  description text,
  expense_date date NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT expenses_pkey PRIMARY KEY (id),
  CONSTRAINT expenses_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.users(id)
);

CREATE TABLE public.system_config (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT system_config_pkey PRIMARY KEY (id)
);

-- --- sehemu 2: RLS, storage, seed ---

-- RLS policies, storage bucket, seed config (run after initial_schema)
-- Safe to re-run only if policies don't exist — use fresh DB or drop policies manually if needed

-- ---------------------------------------------------------------------------
-- Storage: logos bucket (public read for URLs)
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('logos', 'logos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Authenticated users can upload; public can read (bucket is public)
DO $$ BEGIN
  DROP POLICY IF EXISTS "logos_public_read" ON storage.objects;
  DROP POLICY IF EXISTS "logos_authenticated_insert" ON storage.objects;
  DROP POLICY IF EXISTS "logos_authenticated_update" ON storage.objects;
  DROP POLICY IF EXISTS "logos_authenticated_delete" ON storage.objects;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "logos_public_read" ON storage.objects FOR SELECT TO public USING (bucket_id = 'logos');
CREATE POLICY "logos_authenticated_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'logos');
CREATE POLICY "logos_authenticated_update" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'logos');
CREATE POLICY "logos_authenticated_delete" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'logos');

-- ---------------------------------------------------------------------------
-- Row Level Security — allow authenticated full CRUD; anon read system_config (login screen)
-- ---------------------------------------------------------------------------
ALTER TABLE public.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.centers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loan_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.borrowers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repayments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

-- Drop if re-running (idempotent-ish)
DO $$ BEGIN
  DROP POLICY IF EXISTS "authenticated_all" ON public.branches;
  DROP POLICY IF EXISTS "authenticated_all" ON public.users;
  DROP POLICY IF EXISTS "authenticated_all" ON public.centers;
  DROP POLICY IF EXISTS "authenticated_all" ON public.groups;
  DROP POLICY IF EXISTS "authenticated_all" ON public.loan_products;
  DROP POLICY IF EXISTS "authenticated_all" ON public.borrowers;
  DROP POLICY IF EXISTS "authenticated_all" ON public.loans;
  DROP POLICY IF EXISTS "authenticated_all" ON public.repayments;
  DROP POLICY IF EXISTS "authenticated_all" ON public.holidays;
  DROP POLICY IF EXISTS "authenticated_all" ON public.expenses;
  DROP POLICY IF EXISTS "anon_read_system_config" ON public.system_config;
  DROP POLICY IF EXISTS "authenticated_all_system_config" ON public.system_config;
END $$;

CREATE POLICY "authenticated_all" ON public.branches FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.users FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.centers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.groups FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.loan_products FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.borrowers FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.loans FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.repayments FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.holidays FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.expenses FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "anon_read_system_config" ON public.system_config FOR SELECT TO anon USING (true);
CREATE POLICY "authenticated_all_system_config" ON public.system_config FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ---------------------------------------------------------------------------
-- Seed system_config (upsert by key)
-- ---------------------------------------------------------------------------
INSERT INTO public.system_config (key, value)
SELECT 'currency', 'TZS'
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'currency');
INSERT INTO public.system_config (key, value)
SELECT 'systemName', 'FAHARI CREDIT LIMITED'
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'systemName');
INSERT INTO public.system_config (key, value)
SELECT 'logoUrl', ''
WHERE NOT EXISTS (SELECT 1 FROM public.system_config WHERE key = 'logoUrl');

-- --- sehemu 3: RPC ---

-- RPC functions required by the FCL frontend (SECURITY DEFINER bypasses RLS when invoked)

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
  i int;
  elem jsonb;
  rem numeric;
  inst_amt numeric;
  paid_to_inst numeric;
  st text;
  due date;
BEGIN
  SELECT * INTO loan_row FROM public.loans WHERE id = p_loan_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF loan_row.schedule IS NULL OR jsonb_typeof(loan_row.schedule) <> 'array' THEN
    RETURN;
  END IF;

  IF jsonb_array_length(loan_row.schedule) IS NULL OR jsonb_array_length(loan_row.schedule) = 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO total_repaid FROM public.repayments WHERE loan_id = p_loan_id;
  rem := total_repaid;

  FOR i IN 0 .. (jsonb_array_length(loan_row.schedule) - 1) LOOP
    elem := loan_row.schedule->i;
    inst_amt := COALESCE((elem->>'amount')::numeric, 0);
    paid_to_inst := LEAST(rem, inst_amt);
    rem := rem - paid_to_inst;
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

CREATE OR REPLACE FUNCTION public.update_all_loan_statuses()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.loans l
  SET status = CASE
    WHEN GREATEST(0, l.total_payable - COALESCE((SELECT SUM(r.amount) FROM public.repayments r WHERE r.loan_id = l.id), 0)) <= 0.01 THEN 'paid'
    WHEN EXISTS (
      SELECT 1 FROM jsonb_array_elements(l.schedule) elem
      WHERE (elem->>'dueDate')::date < CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    ) THEN 'delinquent'
    ELSE 'active'
  END
  WHERE l.status IN ('active', 'delinquent', 'defaulted', 'paid')
    AND l.schedule IS NOT NULL
    AND jsonb_typeof(l.schedule) = 'array';
END;
$$;

CREATE OR REPLACE FUNCTION public.update_loan_status(p_loan_id uuid, p_new_status text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.loans SET status = p_new_status WHERE id = p_loan_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reassign_partial_officer_data(
  p_old_officer_id uuid,
  p_new_officer_id uuid,
  p_center_ids uuid[],
  p_group_ids uuid[],
  p_reassign_all boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_reassign_all THEN
    UPDATE public.centers SET loan_officer_id = p_new_officer_id WHERE loan_officer_id = p_old_officer_id;
    UPDATE public.groups SET loan_officer_id = p_new_officer_id WHERE loan_officer_id = p_old_officer_id;
    UPDATE public.borrowers SET loan_officer_id = p_new_officer_id WHERE loan_officer_id = p_old_officer_id;
    UPDATE public.loans SET officer_id = p_new_officer_id WHERE officer_id = p_old_officer_id;
  ELSE
    IF p_center_ids IS NOT NULL AND array_length(p_center_ids, 1) IS NOT NULL THEN
      UPDATE public.centers SET loan_officer_id = p_new_officer_id WHERE id = ANY (p_center_ids);
      UPDATE public.borrowers SET loan_officer_id = p_new_officer_id
        WHERE group_id IN (SELECT g.id FROM public.groups g WHERE g.center_id = ANY (p_center_ids));
      UPDATE public.loans SET officer_id = p_new_officer_id
        WHERE borrower_id IN (
          SELECT b.id FROM public.borrowers b
          WHERE b.group_id IN (SELECT g.id FROM public.groups g WHERE g.center_id = ANY (p_center_ids))
        );
    END IF;
    IF p_group_ids IS NOT NULL AND array_length(p_group_ids, 1) IS NOT NULL THEN
      UPDATE public.groups SET loan_officer_id = p_new_officer_id WHERE id = ANY (p_group_ids);
      UPDATE public.borrowers SET loan_officer_id = p_new_officer_id WHERE group_id = ANY (p_group_ids);
      UPDATE public.loans SET officer_id = p_new_officer_id
        WHERE borrower_id IN (SELECT id FROM public.borrowers WHERE group_id = ANY (p_group_ids));
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_officer_stats(
  p_officer_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  total_borrowers bigint,
  active_loans bigint,
  total_portfolio numeric,
  total_principal_disbursed numeric,
  total_repayments_collected numeric,
  principal_repayments_collected numeric,
  total_interest_collected numeric,
  outstanding_principal numeric,
  outstanding_interest numeric,
  defaulted_principal numeric,
  defaulted_interest numeric,
  total_expected_today numeric,
  total_disbursed_this_month numeric,
  past_unpaid_repayments numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::bigint FROM public.borrowers b WHERE b.loan_officer_id = p_officer_id),
    (SELECT COUNT(*)::bigint FROM public.loans l WHERE l.officer_id = p_officer_id AND l.status = 'active'),
    (SELECT COALESCE(SUM(l.balance), 0) FROM public.loans l WHERE l.officer_id = p_officer_id AND l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.officer_id = p_officer_id AND l.disbursement_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(r.amount), 0) FROM public.repayments r WHERE r.officer_id = p_officer_id AND r.actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.officer_id = p_officer_id AND r.actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.officer_id = p_officer_id AND r.actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(GREATEST(0, l.principal - COALESCE((
          SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id
        ), 0))), 0)
      FROM public.loans l WHERE l.officer_id = p_officer_id AND l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.outstanding_interest), 0) FROM public.loans l WHERE l.officer_id = p_officer_id AND l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.officer_id = p_officer_id AND l.status = 'defaulted'),
    (SELECT COALESCE(SUM(l.outstanding_interest), 0) FROM public.loans l WHERE l.officer_id = p_officer_id AND l.status = 'defaulted'),
    (SELECT COALESCE(SUM((elem->>'amount')::numeric), 0)
      FROM public.loans l, jsonb_array_elements(l.schedule) elem
      WHERE l.officer_id = p_officer_id
        AND (elem->>'dueDate')::date = CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    ),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.officer_id = p_officer_id AND l.disbursement_date::date >= date_trunc('month', CURRENT_DATE)::date),
    (SELECT COUNT(*)::bigint FROM public.loans l, jsonb_array_elements(l.schedule) elem
      WHERE l.officer_id = p_officer_id
        AND (elem->>'dueDate')::date < CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    )::numeric;
$$;

CREATE OR REPLACE FUNCTION public.get_branch_stats(
  p_branch_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  total_loan_officers bigint,
  total_borrowers bigint,
  active_loans bigint,
  total_portfolio numeric,
  total_principal_disbursed numeric,
  total_repayments_collected numeric,
  principal_repayments_collected numeric,
  total_interest_collected numeric,
  outstanding_principal numeric,
  outstanding_interest numeric,
  defaulted_principal numeric,
  defaulted_interest numeric,
  total_expected_today numeric,
  total_disbursed_this_month numeric,
  past_unpaid_repayments numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::bigint FROM public.users u WHERE u.branch_id = p_branch_id AND u.role = 'officer'),
    (SELECT COUNT(*)::bigint FROM public.borrowers b WHERE b.branch_id = p_branch_id),
    (SELECT COUNT(*)::bigint FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.status = 'active'),
    (SELECT COALESCE(SUM(l.balance), 0) FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.disbursement_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(r.amount), 0) FROM public.repayments r WHERE r.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND r.actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(r.principal_paid, 0)), 0) FROM public.repayments r WHERE r.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND r.actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(r.interest_paid, 0)), 0) FROM public.repayments r WHERE r.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND r.actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(GREATEST(0, l.principal - COALESCE((
          SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id
        ), 0))), 0)
      FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.outstanding_interest), 0) FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.status = 'defaulted'),
    (SELECT COALESCE(SUM(l.outstanding_interest), 0) FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.status = 'defaulted'),
    (SELECT COALESCE(SUM((elem->>'amount')::numeric), 0)
      FROM public.loans l, jsonb_array_elements(l.schedule) elem
      WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer')
        AND (elem->>'dueDate')::date = CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    ),
    (SELECT COALESCE(SUM(l.principal), 0) FROM public.loans l WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer') AND l.disbursement_date::date >= date_trunc('month', CURRENT_DATE)::date),
    (SELECT COUNT(*)::bigint FROM public.loans l, jsonb_array_elements(l.schedule) elem
      WHERE l.officer_id IN (SELECT id FROM public.users WHERE branch_id = p_branch_id AND role = 'officer')
        AND (elem->>'dueDate')::date < CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    )::numeric;
$$;

CREATE OR REPLACE FUNCTION public.get_system_wide_stats(
  p_start_date date,
  p_end_date date
)
RETURNS TABLE (
  total_branches bigint,
  total_users bigint,
  total_borrowers bigint,
  active_loans bigint,
  total_portfolio numeric,
  total_principal_disbursed numeric,
  total_repayments_collected numeric,
  principal_repayments_collected numeric,
  total_interest_collected numeric,
  outstanding_principal numeric,
  outstanding_interest numeric,
  defaulted_principal numeric,
  defaulted_interest numeric,
  total_expected_today numeric,
  total_disbursed_this_month numeric,
  past_unpaid_repayments numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    (SELECT COUNT(*)::bigint FROM public.branches),
    (SELECT COUNT(*)::bigint FROM public.users),
    (SELECT COUNT(*)::bigint FROM public.borrowers),
    (SELECT COUNT(*)::bigint FROM public.loans WHERE status = 'active'),
    (SELECT COALESCE(SUM(balance), 0) FROM public.loans WHERE status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(principal), 0) FROM public.loans WHERE disbursement_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(amount), 0) FROM public.repayments WHERE actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(principal_paid, 0)), 0) FROM public.repayments WHERE actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(COALESCE(interest_paid, 0)), 0) FROM public.repayments WHERE actual_payment_date::date BETWEEN p_start_date AND p_end_date),
    (SELECT COALESCE(SUM(GREATEST(0, l.principal - COALESCE((
          SELECT SUM(COALESCE(r2.principal_paid, 0)) FROM public.repayments r2 WHERE r2.loan_id = l.id
        ), 0))), 0)
      FROM public.loans l WHERE l.status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(outstanding_interest), 0) FROM public.loans WHERE status NOT IN ('paid', 'written_off')),
    (SELECT COALESCE(SUM(principal), 0) FROM public.loans WHERE status = 'defaulted'),
    (SELECT COALESCE(SUM(outstanding_interest), 0) FROM public.loans WHERE status = 'defaulted'),
    (SELECT COALESCE(SUM((elem->>'amount')::numeric), 0)
      FROM public.loans l, jsonb_array_elements(l.schedule) elem
      WHERE (elem->>'dueDate')::date = CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    ),
    (SELECT COALESCE(SUM(principal), 0) FROM public.loans WHERE disbursement_date::date >= date_trunc('month', CURRENT_DATE)::date),
    (SELECT COUNT(*)::bigint FROM public.loans l, jsonb_array_elements(l.schedule) elem
      WHERE (elem->>'dueDate')::date < CURRENT_DATE
        AND COALESCE((elem->>'paidAmount')::numeric, 0) < COALESCE((elem->>'amount')::numeric, 0) - 0.01
    )::numeric;
$$;

GRANT EXECUTE ON FUNCTION public.recalculate_loan_schedule(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_all_loan_statuses() TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_loan_status(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reassign_partial_officer_data(uuid, uuid, uuid[], uuid[], boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_officer_stats(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_branch_stats(uuid, date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_system_wide_stats(date, date) TO authenticated;
