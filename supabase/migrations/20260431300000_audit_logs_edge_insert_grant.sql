-- Edge Functions use JWT role service_role; table only had GRANT SELECT to authenticated.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT INSERT ON TABLE public.audit_logs TO service_role;
  END IF;
END $$;
