-- Run the WHOLE file from top to bottom in the SQL editor (do not run from "created_at" only).

CREATE TABLE public.expense_defaults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  officer_id uuid NOT NULL REFERENCES public.users (id) ON DELETE CASCADE,
  expense_type text NOT NULL,
  amount numeric NOT NULL CHECK (amount >= 0),
  description text,
  frequency text NOT NULL CHECK (frequency IN ('daily', 'weekly', 'biweekly', 'monthly')),
  is_active boolean NOT NULL DEFAULT true,
  last_applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_expense_defaults_officer ON public.expense_defaults (officer_id);

ALTER TABLE public.expense_defaults ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated_all_expense_defaults" ON public.expense_defaults;
CREATE POLICY "authenticated_all_expense_defaults" ON public.expense_defaults
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

GRANT ALL ON public.expense_defaults TO authenticated;

COMMENT ON TABLE public.expense_defaults IS 'Templates for recurring expenses; last_applied_at drives when the next row may be posted to expenses.';
