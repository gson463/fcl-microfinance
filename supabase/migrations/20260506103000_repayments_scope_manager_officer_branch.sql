-- Field wallet / branch views: managers must see repayments recorded by loan officers in their branch,
-- not only rows where the borrower currently belongs to that branch (officer wallet uses officer_id).

DROP POLICY IF EXISTS "repayments_scope" ON public.repayments;

CREATE POLICY "repayments_scope" ON public.repayments
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND (
        EXISTS (
          SELECT 1 FROM public.borrowers b
          WHERE b.id = repayments.borrower_id
            AND b.branch_id = public.auth_app_branch_id()
        )
        OR EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = repayments.officer_id
            AND u.role = 'officer'
            AND u.branch_id = public.auth_app_branch_id()
        )
      )
    )
    OR (
      public.auth_app_role() = 'officer'
      AND officer_id = auth.uid()
    )
  )
  WITH CHECK (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND (
        EXISTS (
          SELECT 1 FROM public.borrowers b
          WHERE b.id = repayments.borrower_id
            AND b.branch_id = public.auth_app_branch_id()
        )
        OR EXISTS (
          SELECT 1 FROM public.users u
          WHERE u.id = repayments.officer_id
            AND u.role = 'officer'
            AND u.branch_id = public.auth_app_branch_id()
        )
      )
    )
    OR (
      public.auth_app_role() = 'officer'
      AND officer_id = auth.uid()
    )
  );
