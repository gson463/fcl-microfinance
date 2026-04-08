-- Allow admins to list users by role for Branch Management when direct PostgREST/RLS blocks reads.
CREATE OR REPLACE FUNCTION public.list_users_by_role(p_role text)
RETURNS TABLE (id uuid, full_name text, branch_id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.users WHERE public.users.id = auth.uid() AND public.users.role = 'admin') THEN
    RAISE EXCEPTION 'not authorized' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT u.id, u.full_name, u.branch_id
  FROM public.users u
  WHERE u.role = p_role;
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_users_by_role(text) TO authenticated;

COMMENT ON FUNCTION public.list_users_by_role(text) IS
  'Admin only: returns users with the given role (e.g. manager) for branch assignment UI.';
