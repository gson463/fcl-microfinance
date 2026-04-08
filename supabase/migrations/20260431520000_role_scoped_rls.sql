-- Role-scoped RLS: admin = full access; manager = same branch only; officer = own rows (officer / loan officer) + own user profile.
-- Helpers use SECURITY DEFINER so policies can read public.users without RLS recursion.

CREATE OR REPLACE FUNCTION public.auth_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.role FROM public.users u WHERE u.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.auth_app_branch_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT u.branch_id FROM public.users u WHERE u.id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION public.auth_is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.users u
    WHERE u.id = auth.uid() AND u.role = 'admin'
  );
$$;

GRANT EXECUTE ON FUNCTION public.auth_app_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_app_branch_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.auth_is_admin() TO authenticated;

COMMENT ON FUNCTION public.auth_app_role() IS 'RLS helper: role from public.users for auth.uid(); bypasses RLS.';
COMMENT ON FUNCTION public.auth_app_branch_id() IS 'RLS helper: branch_id from public.users for auth.uid(); bypasses RLS.';
COMMENT ON FUNCTION public.auth_is_admin() IS 'RLS helper: true if current user is admin in public.users.';

-- ---------------------------------------------------------------------------
-- Drop permissive policies (replace with scoped policies)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
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
  DROP POLICY IF EXISTS "authenticated_all_system_config" ON public.system_config;
  DROP POLICY IF EXISTS "authenticated_all" ON public.deleted_loan_records;
  DROP POLICY IF EXISTS "authenticated_all" ON public.repayment_delete_requests;
  DROP POLICY IF EXISTS "authenticated_all" ON public.deleted_repayment_records;
  DROP POLICY IF EXISTS "authenticated_all_officer_wallet_balances" ON public.officer_wallet_balances;
  DROP POLICY IF EXISTS "authenticated_all_loan_increase_exception_requests" ON public.loan_increase_exception_requests;
  DROP POLICY IF EXISTS "authenticated_all_officer_field_taken" ON public.officer_field_taken;
  DROP POLICY IF EXISTS "authenticated_all_expense_defaults" ON public.expense_defaults;
  DROP POLICY IF EXISTS "authenticated_all_centre_meetings" ON public.centre_meetings;
  DROP POLICY IF EXISTS "authenticated_all_attendance_records" ON public.attendance_records;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- branches
-- ---------------------------------------------------------------------------
CREATE POLICY "branches_admin_all" ON public.branches
  FOR ALL TO authenticated
  USING (public.auth_is_admin())
  WITH CHECK (public.auth_is_admin());

CREATE POLICY "branches_select_own_branch" ON public.branches
  FOR SELECT TO authenticated
  USING (
    public.auth_app_role() IN ('manager', 'officer')
    AND id = public.auth_app_branch_id()
  );

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
CREATE POLICY "users_admin_all" ON public.users
  FOR ALL TO authenticated
  USING (public.auth_is_admin())
  WITH CHECK (public.auth_is_admin());

CREATE POLICY "users_select_manager_branch" ON public.users
  FOR SELECT TO authenticated
  USING (
    public.auth_app_role() = 'manager'
    AND public.auth_app_branch_id() IS NOT NULL
    AND branch_id = public.auth_app_branch_id()
  );

CREATE POLICY "users_select_self" ON public.users
  FOR SELECT TO authenticated
  USING (public.auth_app_role() = 'officer' AND id = auth.uid());

CREATE POLICY "users_update_manager_branch" ON public.users
  FOR UPDATE TO authenticated
  USING (
    public.auth_app_role() = 'manager'
    AND public.auth_app_branch_id() IS NOT NULL
    AND branch_id = public.auth_app_branch_id()
  )
  WITH CHECK (
    public.auth_app_role() = 'manager'
    AND public.auth_app_branch_id() IS NOT NULL
    AND branch_id = public.auth_app_branch_id()
  );

CREATE POLICY "users_update_self" ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- ---------------------------------------------------------------------------
-- centers
-- ---------------------------------------------------------------------------
CREATE POLICY "centers_scope" ON public.centers
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND public.auth_app_branch_id() IS NOT NULL
      AND branch_id = public.auth_app_branch_id()
    )
    OR (
      public.auth_app_role() = 'officer'
      AND loan_officer_id = auth.uid()
    )
  )
  WITH CHECK (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND public.auth_app_branch_id() IS NOT NULL
      AND branch_id = public.auth_app_branch_id()
    )
    OR (
      public.auth_app_role() = 'officer'
      AND loan_officer_id = auth.uid()
      AND branch_id = public.auth_app_branch_id()
    )
  );

-- ---------------------------------------------------------------------------
-- groups
-- ---------------------------------------------------------------------------
CREATE POLICY "groups_scope" ON public.groups
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = groups.center_id
          AND c.branch_id = public.auth_app_branch_id()
      )
    )
    OR (
      public.auth_app_role() = 'officer'
      AND loan_officer_id = auth.uid()
    )
  )
  WITH CHECK (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = groups.center_id
          AND c.branch_id = public.auth_app_branch_id()
      )
    )
    OR (
      public.auth_app_role() = 'officer'
      AND loan_officer_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = groups.center_id
          AND c.loan_officer_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- loan_products & holidays: read for all authenticated; write admin only
-- ---------------------------------------------------------------------------
CREATE POLICY "loan_products_select_auth" ON public.loan_products
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "loan_products_write_admin" ON public.loan_products
  FOR INSERT TO authenticated WITH CHECK (public.auth_is_admin());

CREATE POLICY "loan_products_update_admin" ON public.loan_products
  FOR UPDATE TO authenticated
  USING (public.auth_is_admin()) WITH CHECK (public.auth_is_admin());

CREATE POLICY "loan_products_delete_admin" ON public.loan_products
  FOR DELETE TO authenticated USING (public.auth_is_admin());

CREATE POLICY "holidays_select_auth" ON public.holidays
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "holidays_write_admin" ON public.holidays
  FOR INSERT TO authenticated WITH CHECK (public.auth_is_admin());

CREATE POLICY "holidays_update_admin" ON public.holidays
  FOR UPDATE TO authenticated
  USING (public.auth_is_admin()) WITH CHECK (public.auth_is_admin());

CREATE POLICY "holidays_delete_admin" ON public.holidays
  FOR DELETE TO authenticated USING (public.auth_is_admin());

-- ---------------------------------------------------------------------------
-- system_config: keep anon read (login); authenticated read; write admin only
-- ---------------------------------------------------------------------------
CREATE POLICY "system_config_select_auth" ON public.system_config
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "system_config_write_admin" ON public.system_config
  FOR INSERT TO authenticated WITH CHECK (public.auth_is_admin());

CREATE POLICY "system_config_update_admin" ON public.system_config
  FOR UPDATE TO authenticated
  USING (public.auth_is_admin()) WITH CHECK (public.auth_is_admin());

CREATE POLICY "system_config_delete_admin" ON public.system_config
  FOR DELETE TO authenticated USING (public.auth_is_admin());

-- ---------------------------------------------------------------------------
-- borrowers
-- ---------------------------------------------------------------------------
CREATE POLICY "borrowers_scope" ON public.borrowers
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND public.auth_app_branch_id() IS NOT NULL
      AND branch_id = public.auth_app_branch_id()
    )
    OR (
      public.auth_app_role() = 'officer'
      AND loan_officer_id = auth.uid()
    )
  )
  WITH CHECK (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND public.auth_app_branch_id() IS NOT NULL
      AND branch_id = public.auth_app_branch_id()
    )
    OR (
      public.auth_app_role() = 'officer'
      AND loan_officer_id = auth.uid()
      AND branch_id = public.auth_app_branch_id()
    )
  );

-- ---------------------------------------------------------------------------
-- loans
-- ---------------------------------------------------------------------------
CREATE POLICY "loans_scope" ON public.loans
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.borrowers b
        WHERE b.id = loans.borrower_id
          AND b.branch_id = public.auth_app_branch_id()
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
      AND EXISTS (
        SELECT 1 FROM public.borrowers b
        WHERE b.id = loans.borrower_id
          AND b.branch_id = public.auth_app_branch_id()
      )
    )
    OR (
      public.auth_app_role() = 'officer'
      AND officer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- repayments
-- ---------------------------------------------------------------------------
CREATE POLICY "repayments_scope" ON public.repayments
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.borrowers b
        WHERE b.id = repayments.borrower_id
          AND b.branch_id = public.auth_app_branch_id()
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
      AND EXISTS (
        SELECT 1 FROM public.borrowers b
        WHERE b.id = repayments.borrower_id
          AND b.branch_id = public.auth_app_branch_id()
      )
    )
    OR (
      public.auth_app_role() = 'officer'
      AND officer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------
CREATE POLICY "expenses_scope" ON public.expenses
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = expenses.officer_id
          AND u.branch_id = public.auth_app_branch_id()
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
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = expenses.officer_id
          AND u.branch_id = public.auth_app_branch_id()
      )
    )
    OR (
      public.auth_app_role() = 'officer'
      AND officer_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- deletion workflow tables
-- ---------------------------------------------------------------------------
CREATE POLICY "deleted_loan_records_scope" ON public.deleted_loan_records
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND branch_id = public.auth_app_branch_id()
    )
    OR (
      public.auth_app_role() = 'officer'
      AND (officer_id = auth.uid() OR requested_by_officer_id = auth.uid())
    )
  )
  WITH CHECK (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND branch_id = public.auth_app_branch_id()
    )
    OR (
      public.auth_app_role() = 'officer'
      AND (officer_id = auth.uid() OR requested_by_officer_id = auth.uid())
    )
  );

CREATE POLICY "repayment_delete_requests_scope" ON public.repayment_delete_requests
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = repayment_delete_requests.officer_id
          AND u.branch_id = public.auth_app_branch_id()
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
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = repayment_delete_requests.officer_id
          AND u.branch_id = public.auth_app_branch_id()
      )
    )
    OR (
      public.auth_app_role() = 'officer'
      AND officer_id = auth.uid()
    )
  );

CREATE POLICY "deleted_repayment_records_scope" ON public.deleted_repayment_records
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND branch_id = public.auth_app_branch_id()
    )
    OR (
      public.auth_app_role() = 'officer'
      AND (officer_id = auth.uid() OR requested_by_officer_id = auth.uid())
    )
  )
  WITH CHECK (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND branch_id = public.auth_app_branch_id()
    )
    OR (
      public.auth_app_role() = 'officer'
      AND (officer_id = auth.uid() OR requested_by_officer_id = auth.uid())
    )
  );

-- ---------------------------------------------------------------------------
-- officer_wallet_balances
-- ---------------------------------------------------------------------------
CREATE POLICY "officer_wallet_balances_scope" ON public.officer_wallet_balances
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR officer_id = auth.uid()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = officer_wallet_balances.officer_id
          AND u.branch_id = public.auth_app_branch_id()
      )
    )
  )
  WITH CHECK (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = officer_wallet_balances.officer_id
          AND u.branch_id = public.auth_app_branch_id()
      )
    )
    OR officer_id = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- officer_field_taken
-- ---------------------------------------------------------------------------
CREATE POLICY "officer_field_taken_scope" ON public.officer_field_taken
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR officer_id = auth.uid()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = officer_field_taken.officer_id
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
        WHERE u.id = officer_field_taken.officer_id
          AND u.branch_id = public.auth_app_branch_id()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- expense_defaults
-- ---------------------------------------------------------------------------
CREATE POLICY "expense_defaults_scope" ON public.expense_defaults
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR officer_id = auth.uid()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = expense_defaults.officer_id
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
        WHERE u.id = expense_defaults.officer_id
          AND u.branch_id = public.auth_app_branch_id()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- loan_increase_exception_requests
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- centre_meetings
-- ---------------------------------------------------------------------------
CREATE POLICY "centre_meetings_scope" ON public.centre_meetings
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = centre_meetings.centre_id
          AND c.branch_id = public.auth_app_branch_id()
      )
    )
    OR (
      public.auth_app_role() = 'officer'
      AND loan_officer_id = auth.uid()
    )
  )
  WITH CHECK (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = centre_meetings.centre_id
          AND c.branch_id = public.auth_app_branch_id()
      )
    )
    OR (
      public.auth_app_role() = 'officer'
      AND loan_officer_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.centers c
        WHERE c.id = centre_meetings.centre_id
          AND c.loan_officer_id = auth.uid()
      )
    )
  );

-- ---------------------------------------------------------------------------
-- attendance_records
-- ---------------------------------------------------------------------------
CREATE POLICY "attendance_records_scope" ON public.attendance_records
  FOR ALL TO authenticated
  USING (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.centre_meetings cm
        JOIN public.centers c ON c.id = cm.centre_id
        WHERE cm.id = attendance_records.centre_meeting_id
          AND c.branch_id = public.auth_app_branch_id()
      )
    )
    OR (
      public.auth_app_role() = 'officer'
      AND (
        EXISTS (
          SELECT 1 FROM public.centre_meetings cm
          WHERE cm.id = attendance_records.centre_meeting_id
            AND cm.loan_officer_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM public.borrowers b
          WHERE b.id = attendance_records.borrower_id
            AND b.loan_officer_id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (
    public.auth_is_admin()
    OR (
      public.auth_app_role() = 'manager'
      AND EXISTS (
        SELECT 1 FROM public.centre_meetings cm
        JOIN public.centers c ON c.id = cm.centre_id
        WHERE cm.id = attendance_records.centre_meeting_id
          AND c.branch_id = public.auth_app_branch_id()
      )
    )
    OR (
      public.auth_app_role() = 'officer'
      AND EXISTS (
        SELECT 1 FROM public.centre_meetings cm
        WHERE cm.id = attendance_records.centre_meeting_id
          AND cm.loan_officer_id = auth.uid()
      )
      AND EXISTS (
        SELECT 1 FROM public.borrowers b
        WHERE b.id = attendance_records.borrower_id
          AND b.loan_officer_id = auth.uid()
      )
    )
  );
