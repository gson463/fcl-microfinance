-- Lint 0029: switch read-only schedule / holiday helpers from SECURITY DEFINER to SECURITY INVOKER.
-- Bodies unchanged; they never needed definer (no RLS bypass required):
--   • scheduled_due_* operate only on JSONB arguments.
--   • is_working_day_eat / next_working_day_after_exclusive read public.holidays;
--     holidays_select_auth grants SELECT to authenticated (and service_role bypasses RLS when used from Edge).
--
-- Nested calls: when a SECURITY DEFINER RPC calls these, INVOKER still evaluates with the session role
-- (authenticated / service_role), which is sufficient here.

CREATE OR REPLACE FUNCTION public.scheduled_due_for_payment_date(
  p_schedule jsonb,
  p_payment_date date
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
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
            WHEN (elem->>'dueDate')::date > p_payment_date THEN 0::numeric
            ELSE COALESCE((elem->>'amount')::numeric, 0) - COALESCE((elem->>'paidAmount')::numeric, 0)
          END
        )
        FROM jsonb_array_elements(p_schedule) AS t(elem)
      ),
      0
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.scheduled_due_on_date_only(
  p_schedule jsonb,
  p_payment_date date
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
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

CREATE OR REPLACE FUNCTION public.scheduled_due_strictly_before_payment_date(
  p_schedule jsonb,
  p_payment_date date
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY INVOKER
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
            WHEN (elem->>'dueDate')::date >= p_payment_date THEN 0::numeric
            ELSE COALESCE((elem->>'amount')::numeric, 0) - COALESCE((elem->>'paidAmount')::numeric, 0)
          END
        )
        FROM jsonb_array_elements(p_schedule) AS t(elem)
      ),
      0
    )
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_working_day_eat(p_date date)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT p_date IS NOT NULL
     AND EXTRACT(DOW FROM p_date) <> 0::numeric
     AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.date = p_date);
$$;

CREATE OR REPLACE FUNCTION public.next_working_day_after_exclusive(p_ref date DEFAULT CURRENT_DATE)
RETURNS date
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $body$
DECLARE
  d date := p_ref + 1;
  i int := 0;
BEGIN
  LOOP
    IF i > 800 THEN
      RAISE EXCEPTION 'next_working_day_after_exclusive: iteration guard exceeded';
    END IF;
    i := i + 1;
    IF EXTRACT(DOW FROM d) <> 0::numeric
       AND NOT EXISTS (SELECT 1 FROM public.holidays h WHERE h.date = d) THEN
      RETURN d;
    END IF;
    d := d + 1;
  END LOOP;
END;
$body$;

COMMENT ON FUNCTION public.scheduled_due_for_payment_date(jsonb, date) IS
  'Unpaid principal+interest for installments due on or before payment date (JSON schedule only). SECURITY INVOKER.';
COMMENT ON FUNCTION public.scheduled_due_on_date_only(jsonb, date) IS
  'Unpaid amount for installments due exactly on payment date. SECURITY INVOKER.';
COMMENT ON FUNCTION public.scheduled_due_strictly_before_payment_date(jsonb, date) IS
  'Unpaid amount for installments strictly before payment date (wallet arrears_only split). SECURITY INVOKER.';
COMMENT ON FUNCTION public.is_working_day_eat(date) IS
  'Working day Mon–Sat excluding public.holidays (EAT calendar). SECURITY INVOKER.';
COMMENT ON FUNCTION public.next_working_day_after_exclusive(date) IS
  'First date strictly after p_ref not Sunday and not in holidays. SECURITY INVOKER.';
