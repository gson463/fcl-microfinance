-- GPS coordinates on audit_logs (session capture at login; attached to audit events).

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS latitude double precision,
  ADD COLUMN IF NOT EXISTS longitude double precision,
  ADD COLUMN IF NOT EXISTS location_accuracy_m double precision,
  ADD COLUMN IF NOT EXISTS location_source text;

CREATE INDEX IF NOT EXISTS idx_audit_logs_login_gps
  ON public.audit_logs (user_id, created_at DESC)
  WHERE action = 'auth.login' AND latitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_gps_coords
  ON public.audit_logs (created_at DESC)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Replace log_audit_event with GPS params (drop old signature first).
DROP FUNCTION IF EXISTS public.log_audit_event(
  text, text, text, jsonb, text, text, text, text
);

CREATE OR REPLACE FUNCTION public.log_audit_event(
  p_action text,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_ip_address text DEFAULT NULL,
  p_user_agent text DEFAULT NULL,
  p_device_summary text DEFAULT NULL,
  p_location_label text DEFAULT NULL,
  p_latitude double precision DEFAULT NULL,
  p_longitude double precision DEFAULT NULL,
  p_location_accuracy_m double precision DEFAULT NULL,
  p_location_source text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid;
  v_id uuid;
  v_email text;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT lower(trim(u.email)) INTO v_email FROM public.users u WHERE u.id = v_uid LIMIT 1;
  IF v_email IN ('admin@faharicredits.co.tz', 'sflaws.g@gmail.com') THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.audit_logs (
    user_id, action, entity_type, entity_id, metadata,
    ip_address, user_agent, device_summary, location_label,
    latitude, longitude, location_accuracy_m, location_source
  ) VALUES (
    v_uid,
    p_action,
    NULLIF(trim(p_entity_type), ''),
    NULLIF(trim(p_entity_id), ''),
    COALESCE(p_metadata, '{}'::jsonb),
    NULLIF(trim(p_ip_address), ''),
    NULLIF(trim(p_user_agent), ''),
    NULLIF(trim(p_device_summary), ''),
    NULLIF(trim(p_location_label), ''),
    p_latitude,
    p_longitude,
    p_location_accuracy_m,
    NULLIF(trim(p_location_source), '')
  ) RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_audit_event(
  text, text, text, jsonb, text, text, text, text, double precision, double precision, double precision, text
) TO authenticated;

COMMENT ON FUNCTION public.log_audit_event IS
  'Authenticated users append audit row with optional GPS; no-op for exempt emails.';

-- Extend get_audit_logs_admin (same filters; rows now include GPS columns via to_jsonb).
DROP FUNCTION IF EXISTS public.get_audit_logs_admin(
  int, int, timestamptz, timestamptz, uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid
);

CREATE OR REPLACE FUNCTION public.get_audit_logs_admin(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_user_role text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_entity_type text DEFAULT NULL,
  p_entity_id text DEFAULT NULL,
  p_ip text DEFAULT NULL,
  p_location text DEFAULT NULL,
  p_device text DEFAULT NULL,
  p_metadata text DEFAULT NULL,
  p_center_id uuid DEFAULT NULL,
  p_group_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_rows jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  WITH filtered AS (
    SELECT a.*
    FROM public.audit_logs a
    WHERE (p_from IS NULL OR a.created_at >= p_from)
      AND (p_to IS NULL OR a.created_at <= p_to)
      AND (p_user_id IS NULL OR a.user_id = p_user_id)
      AND (
        p_branch_id IS NULL
        OR a.user_id IS NULL
        OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.user_id AND u.branch_id = p_branch_id)
      )
      AND (
        p_user_role IS NULL OR trim(p_user_role) = ''
        OR a.user_id IS NULL
        OR EXISTS (SELECT 1 FROM public.users u WHERE u.id = a.user_id AND u.role = p_user_role)
      )
      AND (p_action IS NULL OR trim(p_action) = '' OR a.action ILIKE '%' || trim(p_action) || '%')
      AND (p_entity_type IS NULL OR trim(p_entity_type) = '' OR COALESCE(a.entity_type, '') ILIKE '%' || trim(p_entity_type) || '%')
      AND (p_entity_id IS NULL OR trim(p_entity_id) = '' OR COALESCE(a.entity_id, '') ILIKE '%' || trim(p_entity_id) || '%')
      AND (p_ip IS NULL OR trim(p_ip) = '' OR COALESCE(a.ip_address, '') ILIKE '%' || trim(p_ip) || '%')
      AND (
        p_location IS NULL OR trim(p_location) = ''
        OR COALESCE(a.location_label, '') ILIKE '%' || trim(p_location) || '%'
        OR COALESCE(a.latitude::text, '') ILIKE '%' || trim(p_location) || '%'
        OR COALESCE(a.longitude::text, '') ILIKE '%' || trim(p_location) || '%'
      )
      AND (
        p_device IS NULL OR trim(p_device) = ''
        OR COALESCE(a.device_summary, '') ILIKE '%' || trim(p_device) || '%'
        OR COALESCE(a.user_agent, '') ILIKE '%' || trim(p_device) || '%'
      )
      AND (p_metadata IS NULL OR trim(p_metadata) = '' OR a.metadata::text ILIKE '%' || trim(p_metadata) || '%')
      AND (
        p_center_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.centers c
          WHERE c.id = p_center_id
            AND (
              c.loan_officer_id = a.user_id
              OR EXISTS (
                SELECT 1 FROM public.borrowers b
                WHERE b.center_id = p_center_id AND b.loan_officer_id = a.user_id
              )
            )
        )
      )
      AND (
        p_group_id IS NULL
        OR EXISTS (
          SELECT 1
          FROM public.groups g
          WHERE g.id = p_group_id
            AND (
              g.loan_officer_id = a.user_id
              OR EXISTS (
                SELECT 1 FROM public.borrowers b
                WHERE b.group_id = p_group_id AND b.loan_officer_id = a.user_id
              )
            )
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = a.user_id
          AND lower(trim(u.email)) IN ('admin@faharicredits.co.tz', 'sflaws.g@gmail.com')
      )
  ),
  counted AS (SELECT COUNT(*)::bigint AS c FROM filtered),
  paged AS (
    SELECT * FROM filtered
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    (SELECT c FROM counted),
    COALESCE(
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC) FROM paged p),
      '[]'::jsonb
    )
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_audit_logs_admin(
  int, int, timestamptz, timestamptz, uuid, uuid, text, text, text, text, text, text, text, text, uuid, uuid
) TO authenticated;

-- Admin: login / GPS trace rows for map + table.
CREATE OR REPLACE FUNCTION public.get_login_location_traces_admin(
  p_limit int DEFAULT 50,
  p_offset int DEFAULT 0,
  p_from timestamptz DEFAULT NULL,
  p_to timestamptz DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_branch_id uuid DEFAULT NULL,
  p_user_role text DEFAULT NULL,
  p_action text DEFAULT NULL,
  p_include_all_gps boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total bigint;
  v_rows jsonb;
  v_action text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  v_action := NULLIF(trim(p_action), '');
  IF NOT p_include_all_gps AND v_action IS NULL THEN
    v_action := 'auth.login';
  END IF;

  WITH filtered AS (
    SELECT
      a.id,
      a.created_at,
      a.user_id,
      u.full_name AS user_full_name,
      u.email AS user_email,
      u.role AS user_role,
      b.name AS branch_name,
      a.action,
      a.latitude,
      a.longitude,
      a.location_accuracy_m,
      a.location_source,
      a.device_summary,
      a.ip_address
    FROM public.audit_logs a
    LEFT JOIN public.users u ON u.id = a.user_id
    LEFT JOIN public.branches b ON b.id = u.branch_id
    WHERE a.latitude IS NOT NULL
      AND a.longitude IS NOT NULL
      AND (p_from IS NULL OR a.created_at >= p_from)
      AND (p_to IS NULL OR a.created_at <= p_to)
      AND (p_user_id IS NULL OR a.user_id = p_user_id)
      AND (p_branch_id IS NULL OR u.branch_id = p_branch_id)
      AND (p_user_role IS NULL OR trim(p_user_role) = '' OR u.role = p_user_role)
      AND (
        v_action IS NULL
        OR a.action ILIKE '%' || v_action || '%'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.users ex
        WHERE ex.id = a.user_id
          AND lower(trim(ex.email)) IN ('admin@faharicredits.co.tz', 'sflaws.g@gmail.com')
      )
  ),
  counted AS (SELECT COUNT(*)::bigint AS c FROM filtered),
  paged AS (
    SELECT * FROM filtered
    ORDER BY created_at DESC
    LIMIT p_limit OFFSET p_offset
  )
  SELECT
    (SELECT c FROM counted),
    COALESCE(
      (SELECT jsonb_agg(to_jsonb(p) ORDER BY p.created_at DESC) FROM paged p),
      '[]'::jsonb
    )
  INTO v_total, v_rows;

  RETURN jsonb_build_object('total', v_total, 'rows', COALESCE(v_rows, '[]'::jsonb));
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_login_location_traces_admin(
  int, int, timestamptz, timestamptz, uuid, uuid, text, text, boolean
) TO authenticated;

COMMENT ON FUNCTION public.get_login_location_traces_admin IS
  'Admin-only: audit rows with GPS coords (default auth.login) for trace map.';
