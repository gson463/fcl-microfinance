-- Transfer specific borrowers (and their loans) to another officer without moving whole centre/group.
-- Also fixes centre transfer to update groups.loan_officer_id for groups under those centres.

CREATE OR REPLACE FUNCTION public.reassign_borrowers_by_ids(
  p_old_officer_id uuid,
  p_new_officer_id uuid,
  p_borrower_ids uuid[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_borrower_ids IS NULL OR array_length(p_borrower_ids, 1) IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.borrowers
  SET loan_officer_id = p_new_officer_id
  WHERE id = ANY (p_borrower_ids)
    AND loan_officer_id = p_old_officer_id;

  UPDATE public.loans
  SET officer_id = p_new_officer_id
  WHERE borrower_id = ANY (p_borrower_ids)
    AND officer_id = p_old_officer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reassign_borrowers_by_ids(uuid, uuid, uuid[]) TO authenticated;

COMMENT ON FUNCTION public.reassign_borrowers_by_ids IS 'Moves only listed borrowers and their loans to a new officer; use after or without reassign_partial_officer_data.';

-- Ensure groups under transferred centres get the new officer on the group row
CREATE OR REPLACE FUNCTION public.reassign_partial_officer_data(
  p_old_officer_id uuid,
  p_new_officer_id uuid,
  p_center_ids uuid[],
  p_group_ids uuid[],
  p_reassign_all boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_reassign_all THEN
    UPDATE public.centers SET loan_officer_id = p_new_officer_id WHERE loan_officer_id = p_old_officer_id;
    UPDATE public.groups SET loan_officer_id = p_new_officer_id WHERE loan_officer_id = p_old_officer_id;
    UPDATE public.borrowers SET loan_officer_id = p_new_officer_id WHERE loan_officer_id = p_old_officer_id;
    UPDATE public.loans SET officer_id = p_new_officer_id WHERE officer_id = p_old_officer_id;
  ELSE
    IF p_center_ids IS NOT NULL AND array_length(p_center_ids, 1) IS NOT NULL THEN
      UPDATE public.centers SET loan_officer_id = p_new_officer_id WHERE id = ANY (p_center_ids);
      UPDATE public.groups SET loan_officer_id = p_new_officer_id
        WHERE center_id = ANY (p_center_ids) AND loan_officer_id = p_old_officer_id;
      UPDATE public.borrowers SET loan_officer_id = p_new_officer_id
        WHERE group_id IN (SELECT g.id FROM public.groups g WHERE g.center_id = ANY (p_center_ids));
      UPDATE public.loans SET officer_id = p_new_officer_id
        WHERE borrower_id IN (
          SELECT b.id FROM public.borrowers b
          WHERE b.group_id IN (SELECT g.id FROM public.groups g WHERE g.center_id = ANY (p_center_ids))
        );
    END IF;
    IF p_group_ids IS NOT NULL AND array_length(p_group_ids, 1) IS NOT NULL THEN
      UPDATE public.groups SET loan_officer_id = p_new_officer_id WHERE id = ANY (p_group_ids);
      UPDATE public.borrowers SET loan_officer_id = p_new_officer_id WHERE group_id = ANY (p_group_ids);
      UPDATE public.loans SET officer_id = p_new_officer_id
        WHERE borrower_id IN (SELECT id FROM public.borrowers WHERE group_id = ANY (p_group_ids));
    END IF;
  END IF;
END;
$$;
