-- One-time recovery: if public.users was emptied by an old admin_purge (TRUNCATE branches CASCADE),
-- but auth.users still has accounts, run this in Supabase SQL Editor to recreate public.users rows.
-- Review results before committing in production; adjust role/branch from auth metadata if needed.

INSERT INTO public.users (id, full_name, email, role, branch_id, phone_number, is_active, created_at)
SELECT
  au.id,
  COALESCE(
    NULLIF(trim(au.raw_user_meta_data->>'full_name'), ''),
    split_part(au.email, '@', 1)
  ) AS full_name,
  au.email,
  CASE
    WHEN lower(COALESCE(au.raw_user_meta_data->>'role', '')) IN ('admin', 'manager', 'officer')
      THEN lower(au.raw_user_meta_data->>'role')
    ELSE 'officer'
  END AS role,
  -- Only set branch_id if that branch still exists (after purge, branches table is often empty)
  CASE
    WHEN (au.raw_user_meta_data->>'branch_id') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         AND EXISTS (
           SELECT 1 FROM public.branches b
           WHERE b.id = (au.raw_user_meta_data->>'branch_id')::uuid
         )
      THEN (au.raw_user_meta_data->>'branch_id')::uuid
    ELSE NULL
  END AS branch_id,
  NULL::text AS phone_number,
  true AS is_active,
  COALESCE(au.created_at::timestamptz, now()) AS created_at
FROM auth.users au
WHERE NOT EXISTS (SELECT 1 FROM public.users u WHERE u.id = au.id)
ON CONFLICT (id) DO NOTHING;
