-- Loan officer dashboard: breakdown of "projected tomorrow" (scheduled unpaid installments due next calendar day)
-- by borrower centre — same officer + branch scope as dashboard metrics drilldown logic.

CREATE OR REPLACE FUNCTION public.officer_projected_tomorrow_by_center(
  p_officer_id uuid,
  p_branch_id uuid DEFAULT NULL
)
RETURNS TABLE (
  center_id uuid,
  center_name text,
  projected_tomorrow numeric
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_officer_id IS NULL OR NOT (
    p_officer_id = auth.uid() OR public.auth_is_admin()
  ) THEN
    RAISE EXCEPTION 'not allowed';
  END IF;

  RETURN QUERY
  WITH installments AS (
    SELECT
      COALESCE(g.center_id, b.center_id) AS cid,
      (elem ->> 'amount')::numeric AS inst_amt
    FROM public.loans l
    JOIN public.borrowers b ON b.id = l.borrower_id
    LEFT JOIN public.groups g ON g.id = b.group_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(l.schedule, '[]'::jsonb)) AS elem
    WHERE l.officer_id = p_officer_id
      AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
      AND NULLIF(trim(elem ->> 'dueDate'), '') IS NOT NULL
      AND (elem ->> 'dueDate')::date = CURRENT_DATE + 1
      AND COALESCE((elem ->> 'paidAmount')::numeric, 0) < COALESCE((elem ->> 'amount')::numeric, 0) - 0.01
  )
  SELECT
    i.cid,
    COALESCE(
      c.name,
      CASE WHEN i.cid IS NULL THEN 'Unassigned centre' ELSE 'Centre' END
    )::text,
    COALESCE(SUM(i.inst_amt), 0)::numeric
  FROM installments i
  LEFT JOIN public.centers c ON c.id = i.cid
  GROUP BY i.cid, c.name
  ORDER BY 3 DESC NULLS LAST,
    COALESCE(c.name, CASE WHEN i.cid IS NULL THEN 'Unassigned centre' ELSE '' END);
END;
$$;

COMMENT ON FUNCTION public.officer_projected_tomorrow_by_center(uuid, uuid) IS
  'Loan officer: sum of unpaid schedule installment amounts due on (CURRENT_DATE + 1), grouped by borrower centre (group centre, else borrower.center_id). Optional branch scope matches dashboard metrics.';

GRANT EXECUTE ON FUNCTION public.officer_projected_tomorrow_by_center(uuid, uuid) TO authenticated;
