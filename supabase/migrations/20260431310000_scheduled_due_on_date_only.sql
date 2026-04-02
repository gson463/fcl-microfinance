-- Sum of unpaid installment amounts whose due date equals p_payment_date (not arrears from earlier dates).

CREATE OR REPLACE FUNCTION public.scheduled_due_on_date_only(
  p_schedule jsonb,
  p_payment_date date
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_schedule IS NULL OR jsonb_typeof(p_schedule) <> 'array' THEN 0::numeric
    ELSE COALESCE(
      (
        SELECT SUM(
          CASE
            WHEN COALESCE(elem->>'status', '') = 'paid' THEN 0::numeric
            WHEN (COALESCE((elem->>'amount')::numeric, 0) - COALESCE((elem->>'paidAmount')::numeric, 0)) <= 0.01 THEN 0::numeric
            WHEN (elem->>'dueDate')::date <> p_payment_date THEN 0::numeric
            ELSE COALESCE((elem->>'amount')::numeric, 0) - COALESCE((elem->>'paidAmount')::numeric, 0)
          END
        )
        FROM jsonb_array_elements(p_schedule) AS t(elem)
      ),
      0
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.scheduled_due_on_date_only(jsonb, date) TO authenticated;

COMMENT ON FUNCTION public.scheduled_due_on_date_only IS
  'Unpaid principal+interest for installments due exactly on p_payment_date (excludes earlier arrears).';
