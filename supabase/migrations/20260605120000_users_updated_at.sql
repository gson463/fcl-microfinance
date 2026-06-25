-- update-user Edge Function and admin_swap_officer_territories both set users.updated_at.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public.users
SET updated_at = COALESCE(created_at, now())
WHERE updated_at IS NULL;

COMMENT ON COLUMN public.users.updated_at IS 'Last profile update (name, email, branch swap, etc.).';
