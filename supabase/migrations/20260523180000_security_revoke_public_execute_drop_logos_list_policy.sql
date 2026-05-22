-- Supabase linter follow-up:
-- 0025_public_bucket_allows_listing — drop broad SELECT on storage.objects for `logos` (public URLs still work for public buckets).
-- 0028 anon SECURITY DEFINER — anon commonly inherits EXECUTE via GRANT … TO PUBLIC; revoke PUBLIC then re-grant authenticated/service_role.


-- -----------------------------------------------------------------------------
-- Storage: logos — remove policy that permits listing/querying rows (lint 0025).
-- Bucket stays public=TRUE; CDN-style GET /storage/v1/object/public/logos/... does not need this SELECT policy.
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "logos_public_read" ON storage.objects;


-- -----------------------------------------------------------------------------
-- Functions: revoke default PUBLIC EXECUTE so `anon` cannot call RPC/helpers (lint 0028).
-- Restore execute for logged-in JWT (authenticated) and service_role.
-- Note: anon may still indirectly see some behavior via PostgREST with other grants; SECURITY DEFINER bodies must enforce auth.uid() / roles.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON ALL ROUTINES IN SCHEMA public FROM PUBLIC;

GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO service_role;
