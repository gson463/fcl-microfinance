-- Public bucket for avatar URLs; only admin/manager may write to their own folder (auth.uid() prefix).

INSERT INTO storage.buckets (id, name, public)
VALUES ('profile-photos', 'profile-photos', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DO $$ BEGIN
  DROP POLICY IF EXISTS "profile_photos_insert" ON storage.objects;
  DROP POLICY IF EXISTS "profile_photos_update" ON storage.objects;
  DROP POLICY IF EXISTS "profile_photos_delete" ON storage.objects;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

CREATE POLICY "profile_photos_insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'profile-photos'
  AND split_part(name, '/', 1) = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND lower(trim(u.role)) IN ('admin', 'manager')
  )
);

CREATE POLICY "profile_photos_update" ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND split_part(name, '/', 1) = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND lower(trim(u.role)) IN ('admin', 'manager')
  )
)
WITH CHECK (
  bucket_id = 'profile-photos'
  AND split_part(name, '/', 1) = auth.uid()::text
);

CREATE POLICY "profile_photos_delete" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'profile-photos'
  AND split_part(name, '/', 1) = auth.uid()::text
  AND EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND lower(trim(u.role)) IN ('admin', 'manager')
  )
);
