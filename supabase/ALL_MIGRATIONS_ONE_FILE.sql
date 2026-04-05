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

-- 20260431340000_loan_increase_requires_manager_approval.sql
-- Every loan increase (borrower with a completed prior loan) requires branch manager approval.
-- Approval is consumed on first disburse so each new increase needs a new request.

ALTER TABLE public.loan_increase_exception_requests
  ADD COLUMN IF NOT EXISTS consumed_at timestamptz,
  ADD COLUMN IF NOT EXISTS consumed_at_loan_id uuid REFERENCES public.loans(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.loan_increase_exception_requests.consumed_at IS
  'Set when officer disburses using this approval; next loan increase needs a new manager approval.';
COMMENT ON TABLE public.loan_increase_exception_requests IS
  'Officer requests branch manager approval before a new loan after a completed prior loan; also used when attendance is below minimum.';

CREATE OR REPLACE FUNCTION public.consume_loan_increase_approval_for_borrower(p_borrower_id uuid, p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_borrower_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.loan_increase_exception_requests r
  SET
    consumed_at = now(),
    consumed_at_loan_id = p_loan_id
  WHERE r.id = (
    SELECT r2.id
    FROM public.loan_increase_exception_requests r2
    WHERE r2.borrower_id = p_borrower_id
      AND r2.status = 'approved'
      AND r2.consumed_at IS NULL
      AND r2.approved_at IS NOT NULL
      AND r2.approved_at > now() - interval '90 days'
    ORDER BY r2.approved_at DESC
    LIMIT 1
  );
END;
$$;

COMMENT ON FUNCTION public.consume_loan_increase_approval_for_borrower(uuid, uuid) IS
  'Marks the latest unconsumed approved loan-increase request as used after disburse.';

GRANT EXECUTE ON FUNCTION public.consume_loan_increase_approval_for_borrower(uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.consume_loan_increase_approval_for_borrower(uuid, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.borrower_loan_increase_eligibility(p_borrower_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  min_meetings int := 6;
  require_no_default boolean := true;
  has_default boolean := false;
  completed_prior boolean := false;
  attended int := 0;
  eligible_auto boolean := false;
  manager_required boolean := false;
  pending_exception_id uuid := NULL;
  valid_unconsumed_approval boolean := false;
  attendance_below_minimum boolean := false;
  can_submit_approval boolean := false;
  may_disburse_new_loan boolean := false;
BEGIN
  IF p_borrower_id IS NULL THEN
    RETURN jsonb_build_object('error', 'borrower_id required');
  END IF;

  SELECT COALESCE(
    (SELECT NULLIF(trim(value), '')::int FROM public.system_config WHERE key = 'attendanceMinMeetingsForIncreaseEligibility' LIMIT 1),
    6
  ) INTO min_meetings;

  IF min_meetings IS NULL OR min_meetings < 0 THEN
    min_meetings := 6;
  END IF;

  SELECT COALESCE(
    (SELECT lower(trim(value)) = 'true' FROM public.system_config WHERE key = 'attendanceRequireNoDefaultForAutoIncrease' LIMIT 1),
    true
  ) INTO require_no_default;

  SELECT EXISTS (
    SELECT 1 FROM public.loans l
    WHERE l.borrower_id = p_borrower_id AND l.status = 'defaulted'
  ) INTO has_default;

  SELECT EXISTS (
    SELECT 1 FROM public.loans l
    WHERE l.borrower_id = p_borrower_id AND l.status IN ('paid', 'written_off')
  ) INTO completed_prior;

  SELECT COUNT(*)::int
  INTO attended
  FROM public.attendance_records ar
  WHERE ar.borrower_id = p_borrower_id AND ar.attendance_status = 'present';

  SELECT r.id
  INTO pending_exception_id
  FROM public.loan_increase_exception_requests r
  WHERE r.borrower_id = p_borrower_id AND r.status = 'pending'
  ORDER BY r.created_at DESC
  LIMIT 1;

  SELECT EXISTS (
    SELECT 1
    FROM public.loan_increase_exception_requests r
    WHERE r.borrower_id = p_borrower_id
      AND r.status = 'approved'
      AND r.consumed_at IS NULL
      AND r.approved_at IS NOT NULL
      AND r.approved_at > now() - interval '90 days'
  ) INTO valid_unconsumed_approval;

  manager_required := has_default OR (completed_prior AND NOT valid_unconsumed_approval);

  attendance_below_minimum :=
    completed_prior
    AND NOT has_default
    AND attended < min_meetings;

  -- Informational: attendance/history rules (meetings, no default). Disburse still requires manager approval for every increase.
  eligible_auto :=
    (CASE WHEN require_no_default THEN NOT has_default ELSE true END)
    AND completed_prior
    AND (attended >= min_meetings);

  can_submit_approval :=
    completed_prior
    AND NOT has_default
    AND pending_exception_id IS NULL
    AND NOT valid_unconsumed_approval;

  may_disburse_new_loan :=
    CASE
      WHEN has_default THEN false
      WHEN NOT completed_prior THEN true
      WHEN valid_unconsumed_approval THEN true
      ELSE false
    END;

  RETURN jsonb_build_object(
    'borrower_id', p_borrower_id,
    'meetings_attended', attended,
    'meetings_required', min_meetings,
    'has_default_loan_history', has_default,
    'has_completed_prior_loan', completed_prior,
    'eligible_for_auto_loan_increase', eligible_auto,
    'requires_manager_loan_approval', manager_required,
    'attendance_below_minimum', attendance_below_minimum,
    'pending_attendance_exception_request_id', pending_exception_id,
    'attendance_exception_approved', valid_unconsumed_approval,
    'can_submit_attendance_exception_request', can_submit_approval,
    'can_submit_loan_increase_approval_request', can_submit_approval,
    'may_disburse_new_loan', may_disburse_new_loan,
    'summary',
      CASE
        WHEN has_default THEN 'Borrower has a defaulted loan on record — only a manager can approve a new loan.'
        WHEN NOT completed_prior THEN 'No completed prior loan (paid or written off) on file — branch manager loan increase approval is not required for this disbursement.'
        WHEN valid_unconsumed_approval THEN
          'Branch manager approved a loan increase — you may disburse (approval is used on first disburse; valid 90 days from approval).'
        WHEN pending_exception_id IS NOT NULL THEN
          'Loan increase approval request is pending branch manager review.'
        WHEN attendance_below_minimum THEN
          format(
            'Attendance is below minimum (%s / %s). Submit a loan increase approval request for your manager (required for every increase).',
            attended,
            min_meetings
          )
        WHEN eligible_auto THEN
          format(
            'Meets attendance and history checks for increase eligibility (%s / %s meetings). Branch manager approval is still required before disburse.',
            attended,
            min_meetings
          )
        ELSE
          format(
            'Loan increase: submit a loan increase approval request for your branch manager (required for every new loan after a completed one). Attendance %s / %s.',
            attended,
            min_meetings
          )
      END
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_loan_increase_exception_request(p_borrower_id uuid, p_officer_notes text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer uuid := auth.uid();
  has_default boolean := false;
  completed_prior boolean := false;
  new_id uuid;
  has_unconsumed_approval boolean := false;
BEGIN
  IF v_officer IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;
  IF p_borrower_id IS NULL THEN
    RETURN jsonb_build_object('error', 'borrower_id required');
  END IF;
  IF p_officer_notes IS NULL OR length(trim(p_officer_notes)) < 10 THEN
    RETURN jsonb_build_object('error', 'Please enter notes (at least 10 characters) explaining why this borrower should receive a new loan.');
  END IF;
  IF length(p_officer_notes) > 8000 THEN
    RETURN jsonb_build_object('error', 'Notes are too long.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.borrowers b
    WHERE b.id = p_borrower_id AND b.loan_officer_id = v_officer
  ) THEN
    RETURN jsonb_build_object('error', 'This borrower is not assigned to you.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.loan_increase_exception_requests r
    WHERE r.borrower_id = p_borrower_id AND r.status = 'pending'
  ) THEN
    RETURN jsonb_build_object('error', 'A pending loan increase approval request already exists for this borrower.');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.loan_increase_exception_requests r
    WHERE r.borrower_id = p_borrower_id
      AND r.status = 'approved'
      AND r.consumed_at IS NULL
      AND r.approved_at IS NOT NULL
      AND r.approved_at > now() - interval '90 days'
  ) INTO has_unconsumed_approval;

  IF has_unconsumed_approval THEN
    RETURN jsonb_build_object('error', 'An approved loan increase is already active — disburse the loan, or wait until it expires (90 days) before requesting again.');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.loans l
    WHERE l.borrower_id = p_borrower_id AND l.status = 'defaulted'
  ) INTO has_default;

  SELECT EXISTS (
    SELECT 1 FROM public.loans l
    WHERE l.borrower_id = p_borrower_id AND l.status IN ('paid', 'written_off')
  ) INTO completed_prior;

  IF has_default THEN
    RETURN jsonb_build_object('error', 'Borrower has a defaulted loan — use the default / manager approval workflow, not this request.');
  END IF;
  IF NOT completed_prior THEN
    RETURN jsonb_build_object('error', 'Loan increase approval applies only after the borrower has completed a prior loan (paid or written off).');
  END IF;

  INSERT INTO public.loan_increase_exception_requests (borrower_id, officer_id, officer_notes, status)
  VALUES (p_borrower_id, v_officer, trim(p_officer_notes), 'pending')
  RETURNING id INTO new_id;

  RETURN jsonb_build_object('success', true, 'id', new_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.borrower_loan_increase_eligibility(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_loan_increase_exception_request(uuid, text) TO authenticated;

-- 20260431350000_loan_increase_history_audit.sql
-- Immutable history + audit log for loan increase approvals (see migration file for full body).

CREATE INDEX IF NOT EXISTS idx_loan_increase_exception_requests_created_at
  ON public.loan_increase_exception_requests (created_at DESC);

COMMENT ON TABLE public.loan_increase_exception_requests IS
  'Full history of loan increase approval requests: officer submission, manager approve/reject, optional consumption when a loan is disbursed. Append-only (no deletes in app flows).';

CREATE OR REPLACE FUNCTION public.consume_loan_increase_approval_for_borrower(p_borrower_id uuid, p_loan_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_req_id uuid;
BEGIN
  IF p_borrower_id IS NULL THEN
    RETURN;
  END IF;

  SELECT r2.id
  INTO v_req_id
  FROM public.loan_increase_exception_requests r2
  WHERE r2.borrower_id = p_borrower_id
    AND r2.status = 'approved'
    AND r2.consumed_at IS NULL
    AND r2.approved_at IS NOT NULL
    AND r2.approved_at > now() - interval '90 days'
  ORDER BY r2.approved_at DESC
  LIMIT 1;

  IF v_req_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.loan_increase_exception_requests r
  SET
    consumed_at = now(),
    consumed_at_loan_id = p_loan_id
  WHERE r.id = v_req_id;

  PERFORM public.log_audit_event(
    'loan_increase_approval.consumed',
    'loan_increase_exception_request',
    v_req_id::text,
    jsonb_build_object(
      'borrower_id', p_borrower_id,
      'consumed_loan_id', p_loan_id
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_loan_increase_exception_request(p_borrower_id uuid, p_officer_notes text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_officer uuid := auth.uid();
  has_default boolean := false;
  completed_prior boolean := false;
  new_id uuid;
  has_unconsumed_approval boolean := false;
BEGIN
  IF v_officer IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;
  IF p_borrower_id IS NULL THEN
    RETURN jsonb_build_object('error', 'borrower_id required');
  END IF;
  IF p_officer_notes IS NULL OR length(trim(p_officer_notes)) < 10 THEN
    RETURN jsonb_build_object('error', 'Please enter notes (at least 10 characters) explaining why this borrower should receive a new loan.');
  END IF;
  IF length(p_officer_notes) > 8000 THEN
    RETURN jsonb_build_object('error', 'Notes are too long.');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.borrowers b
    WHERE b.id = p_borrower_id AND b.loan_officer_id = v_officer
  ) THEN
    RETURN jsonb_build_object('error', 'This borrower is not assigned to you.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.loan_increase_exception_requests r
    WHERE r.borrower_id = p_borrower_id AND r.status = 'pending'
  ) THEN
    RETURN jsonb_build_object('error', 'A pending loan increase approval request already exists for this borrower.');
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.loan_increase_exception_requests r
    WHERE r.borrower_id = p_borrower_id
      AND r.status = 'approved'
      AND r.consumed_at IS NULL
      AND r.approved_at IS NOT NULL
      AND r.approved_at > now() - interval '90 days'
  ) INTO has_unconsumed_approval;

  IF has_unconsumed_approval THEN
    RETURN jsonb_build_object('error', 'An approved loan increase is already active — disburse the loan, or wait until it expires (90 days) before requesting again.');
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.loans l
    WHERE l.borrower_id = p_borrower_id AND l.status = 'defaulted'
  ) INTO has_default;

  SELECT EXISTS (
    SELECT 1 FROM public.loans l
    WHERE l.borrower_id = p_borrower_id AND l.status IN ('paid', 'written_off')
  ) INTO completed_prior;

  IF has_default THEN
    RETURN jsonb_build_object('error', 'Borrower has a defaulted loan — use the default / manager approval workflow, not this request.');
  END IF;
  IF NOT completed_prior THEN
    RETURN jsonb_build_object('error', 'Loan increase approval applies only after the borrower has completed a prior loan (paid or written off).');
  END IF;

  INSERT INTO public.loan_increase_exception_requests (borrower_id, officer_id, officer_notes, status)
  VALUES (p_borrower_id, v_officer, trim(p_officer_notes), 'pending')
  RETURNING id INTO new_id;

  PERFORM public.log_audit_event(
    'loan_increase_approval.submitted',
    'loan_increase_exception_request',
    new_id::text,
    jsonb_build_object(
      'borrower_id', p_borrower_id,
      'officer_notes_length', length(trim(p_officer_notes))
    )
  );

  RETURN jsonb_build_object('success', true, 'id', new_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.resolve_loan_increase_exception_request(
  p_request_id uuid,
  p_approve boolean,
  p_manager_notes text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_mgr uuid := auth.uid();
  n int := 0;
  v_borrower uuid;
BEGIN
  IF v_mgr IS NULL THEN
    RETURN jsonb_build_object('error', 'Not authenticated');
  END IF;
  IF p_request_id IS NULL THEN
    RETURN jsonb_build_object('error', 'request_id required');
  END IF;

  SELECT r.borrower_id
  INTO v_borrower
  FROM public.loan_increase_exception_requests r
  WHERE r.id = p_request_id AND r.status = 'pending';

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Request not found or already resolved.');
  END IF;

  UPDATE public.loan_increase_exception_requests r
  SET
    status = CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
    manager_id = v_mgr,
    manager_notes = NULLIF(trim(COALESCE(p_manager_notes, '')), ''),
    resolved_at = now(),
    approved_at = CASE WHEN p_approve THEN now() ELSE NULL END
  WHERE r.id = p_request_id AND r.status = 'pending';

  GET DIAGNOSTICS n = ROW_COUNT;
  IF n = 0 THEN
    RETURN jsonb_build_object('error', 'Request not found or already resolved.');
  END IF;

  PERFORM public.log_audit_event(
    CASE WHEN p_approve THEN 'loan_increase_approval.approved' ELSE 'loan_increase_approval.rejected' END,
    'loan_increase_exception_request',
    p_request_id::text,
    jsonb_build_object(
      'borrower_id', v_borrower,
      'approved', p_approve,
      'manager_notes_present', length(trim(COALESCE(p_manager_notes, ''))) > 0
    )
  );

  RETURN jsonb_build_object('success', true, 'approved', p_approve);
END;
$$;

GRANT EXECUTE ON FUNCTION public.consume_loan_increase_approval_for_borrower(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_loan_increase_exception_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_loan_increase_exception_request(uuid, boolean, text) TO authenticated;

-- 20260431360000_audit_logs_center_group_filters.sql
-- Extend get_audit_logs_admin with optional center / group scoping (actor linked to center or group via officers).

DROP FUNCTION IF EXISTS public.get_audit_logs_admin(
  int,
  int,
  timestamptz,
  timestamptz,
  uuid,
  uuid,
  text,
  text,
  text,
  text,
  text,
  text,
  text,
  text
);

CREATE OR REPLACE FUNCTION public.get_audit_logs_admin(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_user_role text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_device text DEFAULT NULL,
  p_metadata text DEFAULT NULL,
  p_center_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  WITH filtered AS (
    SELECT a.*
    FROM public.audit_logs a
    WHERE (p_from IS NULL OR a.created_at >= p_from)
      AND (p_to IS NULL OR a.created_at <= p_to)
      AND (p_user_id IS NULL OR a.user_id = p_user_id)
      AND (
        p_branch_id IS NULL
        OR a.user_id IS NULL
        OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.user_id AND u.branch_id = p_branch_id)
      )
      AND (
        p_user_role IS NULL OR trim(p_user_role) = ''
        OR a.user_id IS NULL
        OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.user_id AND u.role = p_user_role)
      )
      AND (p_action IS NULL OR trim(p_action) = '' OR a.action ILIKE '%' || trim(p_action) || '%')
      AND (p_entity_type IS NULL OR trim(p_entity_type) = '' OR COALESCE(a.entity_type, '') ILIKE '%' || trim(p_entity_type) || '%')
      AND (p_entity_id IS NULL OR trim(p_entity_id) = '' OR COALESCE(a.entity_id, '') ILIKE '%' || trim(p_entity_id) || '%')
      AND (p_ip IS NULL OR trim(p_ip) = '' OR COALESCE(a.ip_address, '') ILIKE '%' || trim(p_ip) || '%')
      AND (p_location IS NULL OR trim(p_location) = '' OR COALESCE(a.location_label, '') ILIKE '%' || trim(p_location) || '%')
      AND (
        p_device IS NULL OR trim(p_device) = ''
        OR COALESCE(a.device_summary, '') ILIKE '%' || trim(p_device) || '%'
        OR COALESCE(a.user_agent, '') ILIKE '%' || trim(p_device) || '%'
      )
      AND (p_metadata IS NULL OR trim(p_metadata) = '' OR a.metadata::text ILIKE '%' || trim(p_metadata) || '%')
      AND (
        p_center_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.centers c
          WHERE c.id = p_center_id
            AND (
              c.loan_officer_id = a.user_id
              OR EXISTS (
                SELECT 1 FROM public.borrowers b
                WHERE b.center_id = p_center_id AND b.loan_officer_id = a.user_id
              )
            )
        )
      )
      AND (
        p_group_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.groups g
          WHERE g.id = p_group_id
            AND (
              g.loan_officer_id = a.user_id
              OR EXISTS (
                SELECT 1 FROM public.borrowers b
                WHERE b.group_id = p_group_id AND b.loan_officer_id = a.user_id
              )
            )
        )
      )
  ),
  counted AS (SELECT COUNT(*)::bigint AS c FROM filtered),
  paged AS (
    SELECT * FROM filtered
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    (SELECT c FROM counted),
    COALESCE(
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC) FROM paged p),
      '[]'::jsonb
    )
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_audit_logs_admin(
  int, int, timestamptz, timestamptz, uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid
) TO authenticated;

COMMENT ON FUNCTION public.get_audit_logs_admin IS 'Paginated audit_logs for admins only; optional filters including center and group (via officer linkage).';
