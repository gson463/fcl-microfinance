-- Ensure Dar es Salaam branch exists and assign all officers, all admins, and the named manager.
-- Also align borrowers.branch_id and centers.branch_id for those loan officers.
--
-- Branch match: case-insensitive name "Dar es Salaam". Creates if missing.
-- Users updated: role IN ('officer','admin') OR (manager AND email shadaichime3@gmail.com).
-- If the manager row does not exist in public.users yet, create the user first, then re-run or UPDATE manually.

DO $$
DECLARE
  v_branch_id uuid;
BEGIN
  SELECT id INTO v_branch_id
  FROM public.branches
  WHERE lower(trim(name)) = lower(trim('Dar es Salaam'))
  LIMIT 1;

  IF v_branch_id IS NULL THEN
    INSERT INTO public.branches (name, location)
    VALUES ('Dar es Salaam', 'Dar es Salaam, Tanzania')
    RETURNING id INTO v_branch_id;
  END IF;

  UPDATE public.users
  SET branch_id = v_branch_id
  WHERE role = 'officer'
     OR role = 'admin'
     OR (role = 'manager' AND lower(trim(email)) = lower(trim('shadaichime3@gmail.com')));

  UPDATE public.borrowers b
  SET branch_id = v_branch_id
  WHERE b.loan_officer_id IN (
    SELECT id FROM public.users WHERE role = 'officer'
  );

  UPDATE public.centers c
  SET branch_id = v_branch_id
  WHERE c.loan_officer_id IN (
    SELECT id FROM public.users WHERE role = 'officer'
  );
END $$;
