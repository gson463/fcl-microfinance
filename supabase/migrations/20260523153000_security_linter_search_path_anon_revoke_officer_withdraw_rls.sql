-- Addresses Supabase security advisor (partial):
-- - 0011 function_search_path_mutable: normalize_borrower_phone / normalize_borrower_id_number
-- - 0024 permissive RLS: officer_withdraw_to_bank (+ stale loan_increase_exception_requests if still present)
-- - 0028 anon SECURITY DEFINER: REVOKE EXECUTE … FROM anon (and PUBLIC) on public RPCs/logic functions
--
-- Does NOT automatically fix: storage bucket logos listing (0025 — needs product choice: signed URLs vs public list),
-- auth leaked-password protection (toggle in Supabase Auth dashboard),
-- 0029 "authenticated may call SECURITY DEFINER" warnings (those RPCs intentionally run as definer; many already check auth.role / auth.uid).


-- -----------------------------------------------------------------------------
-- Mutable search_path: borrower normalizers (immutable SQL helpers + index predicates)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.normalize_borrower_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT nullif(
    regexp_replace(lower(trim(coalesce(p, ''))), '\s', '', 'g'),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.normalize_borrower_id_number(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT nullif(lower(trim(coalesce(p, ''))), '');
$$;


-- -----------------------------------------------------------------------------
-- RLS: officer_withdraw_to_bank (same shape as officer_field_taken)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_all_officer_withdraw_to_bank" ON public.officer_withdraw_to_bank;

DROP POLICY IF EXISTS "officer_withdraw_to_bank_scope" ON public.officer_withdraw_to_bank;

CREATE POLICY "officer_withdraw_to_bank_scope" ON public.officer_withdraw_to_bank
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR officer_id = auth.uid()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = officer_withdraw_to_bank.officer_id
          AND u.branch_id = public.auth_app_branch_id()
      )
    )
  )
  WITH CHECK (
    public.auth_is_admin()
    OR officer_id = auth.uid()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = officer_withdraw_to_bank.officer_id
          AND u.branch_id = public.auth_app_branch_id()
      )
    )
  );


-- -----------------------------------------------------------------------------
-- RLS: remove permissive leftover on loan increase requests (safe if migration 20260431520000 already applied)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "authenticated_all_loan_increase_exception_requests" ON public.loan_increase_exception_requests;

DROP POLICY IF EXISTS "loan_increase_exception_scope" ON public.loan_increase_exception_requests;

CREATE POLICY "loan_increase_exception_scope" ON public.loan_increase_exception_requests
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'officer'
      AND officer_id = auth.uid()
    )
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.borrowers b
        WHERE b.id = loan_increase_exception_requests.borrower_id
          AND b.branch_id = public.auth_app_branch_id()
      )
    )
  )
  WITH CHECK (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'officer'
      AND officer_id = auth.uid()
    )
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.borrowers b
        WHERE b.id = loan_increase_exception_requests.borrower_id
          AND b.branch_id = public.auth_app_branch_id()
      )
    )
  );


-- -----------------------------------------------------------------------------
-- Revoke anon execute on all public-schema routines (0028). Explicit GRANTS to authenticated stay in place.
-- We do not REVOKE FROM PUBLIC here — that could remove implied execute on helpers that omit a GRANT.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  sig text;
BEGIN
  FOR sig IN
    SELECT p.oid::regprocedure::text
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind IN ('f', 'p')
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', sig);
    EXCEPTION
      WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END;
$$;
