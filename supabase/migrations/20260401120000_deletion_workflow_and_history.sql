-- Loan/repayment deletion workflow: manager final approver; archive tables for admin history.
-- Reset legacy queue: loans waiting for admin final delete go back to manager as delete_requested.

UPDATE public.loans
SET status = 'delete_requested'
WHERE status = 'delete_approved_manager';

-- ---------------------------------------------------------------------------
-- Archived deleted loans (after manager approves permanent delete)
-- ---------------------------------------------------------------------------
CREATE TABLE public.deleted_loan_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_loan_id uuid NOT NULL,
  loan_public_id text NOT NULL,
  borrower_id uuid,
  borrower_name text,
  principal numeric,
  officer_id uuid,
  officer_name text,
  branch_id uuid,
  requested_by_officer_id uuid,
  approved_by_manager_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_deleted_loan_records_deleted_at ON public.deleted_loan_records (deleted_at DESC);
CREATE INDEX idx_deleted_loan_records_branch_id ON public.deleted_loan_records (branch_id);

COMMENT ON TABLE public.deleted_loan_records IS 'Snapshot of loans removed after manager-approved deletion; admin reads for history.';

-- ---------------------------------------------------------------------------
-- Repayment delete requests (officer requests, manager approves/rejects)
-- ---------------------------------------------------------------------------
CREATE TABLE public.repayment_delete_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  repayment_id uuid NOT NULL REFERENCES public.repayments (id) ON DELETE CASCADE,
  loan_id uuid NOT NULL REFERENCES public.loans (id) ON DELETE CASCADE,
  officer_id uuid NOT NULL REFERENCES public.users (id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'rejected')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  rejected_at timestamptz,
  rejected_by_manager_id uuid REFERENCES public.users (id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX uniq_repayment_delete_one_pending
  ON public.repayment_delete_requests (repayment_id)
  WHERE status = 'pending';

CREATE INDEX idx_repayment_delete_requests_status ON public.repayment_delete_requests (status);

COMMENT ON TABLE public.repayment_delete_requests IS 'Officer requests deletion; manager approves (actual delete) or rejects.';

-- ---------------------------------------------------------------------------
-- Archived deleted repayments (after manager approves)
-- ---------------------------------------------------------------------------
CREATE TABLE public.deleted_repayment_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_repayment_id uuid NOT NULL,
  loan_id uuid,
  loan_public_id text,
  borrower_name text,
  amount numeric,
  principal_paid numeric,
  interest_paid numeric,
  payment_date date,
  actual_payment_date date,
  officer_id uuid,
  officer_name text,
  branch_id uuid,
  requested_by_officer_id uuid,
  approved_by_manager_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX idx_deleted_repayment_records_deleted_at ON public.deleted_repayment_records (deleted_at DESC);
CREATE INDEX idx_deleted_repayment_records_branch_id ON public.deleted_repayment_records (branch_id);

COMMENT ON TABLE public.deleted_repayment_records IS 'Snapshot of repayments removed after manager-approved deletion.';

-- ---------------------------------------------------------------------------
-- RLS (match existing app pattern: authenticated full access)
-- ---------------------------------------------------------------------------
ALTER TABLE public.deleted_loan_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.repayment_delete_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deleted_repayment_records ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  DROP POLICY IF EXISTS "authenticated_all" ON public.deleted_loan_records;
  DROP POLICY IF EXISTS "authenticated_all" ON public.repayment_delete_requests;
  DROP POLICY IF EXISTS "authenticated_all" ON public.deleted_repayment_records;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "authenticated_all" ON public.deleted_loan_records FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.repayment_delete_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_all" ON public.deleted_repayment_records FOR ALL TO authenticated USING (true) WITH CHECK (true);

GRANT ALL ON public.deleted_loan_records TO authenticated;
GRANT ALL ON public.repayment_delete_requests TO authenticated;
GRANT ALL ON public.deleted_repayment_records TO authenticated;
