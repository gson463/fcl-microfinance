-- Allow every authenticated user to read their own public.users row.
-- Previously users_select_self applied only to officers; managers without branch_id
-- could not load profile after impersonation or sign-in.

DROP POLICY IF EXISTS "users_select_self" ON public.users;

CREATE POLICY "users_select_self" ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());
