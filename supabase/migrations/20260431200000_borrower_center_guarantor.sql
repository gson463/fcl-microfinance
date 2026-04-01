-- Centre link + guarantor (mdhamini) on borrowers for registration and reporting
ALTER TABLE public.borrowers
  ADD COLUMN IF NOT EXISTS center_id uuid REFERENCES public.centers (id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS guarantor_name text,
  ADD COLUMN IF NOT EXISTS guarantor_phone text;

CREATE INDEX IF NOT EXISTS idx_borrowers_center_id ON public.borrowers (center_id) WHERE center_id IS NOT NULL;
