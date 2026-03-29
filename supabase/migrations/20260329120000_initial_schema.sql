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
