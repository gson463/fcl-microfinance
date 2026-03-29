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
