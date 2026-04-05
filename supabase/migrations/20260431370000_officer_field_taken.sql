-- Daily "taken" (float from office) per loan officer — required for field wallet cash flow + login gate.

CREATE TABLE public.officer_field_taken (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  officer_id uuid NOT NULL,
  business_date date NOT NULL,
  amount_taken numeric NOT NULL DEFAULT 0 CHECK (amount_taken >= 0),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT officer_field_taken_pkey PRIMARY KEY (id),
  CONSTRAINT officer_field_taken_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.users (id) ON DELETE CASCADE,
  CONSTRAINT officer_field_taken_officer_date_unique UNIQUE (officer_id, business_date)
);

CREATE INDEX idx_officer_field_taken_officer_date ON public.officer_field_taken (officer_id, business_date);

ALTER TABLE public.officer_field_taken ENABLE ROW LEVEL SECURITY;

CREATE POLICY "authenticated_all_officer_field_taken" ON public.officer_field_taken
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
