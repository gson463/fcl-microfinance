-- Prevent the same person registering twice (different officers) by enforcing uniqueness
-- on normalized phone and national ID / identification number (when present).

CREATE OR REPLACE FUNCTION public.normalize_borrower_phone(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT nullif(
    regexp_replace(lower(trim(coalesce(p, ''))), '\s', '', 'g'),
    ''
  );
$$;

CREATE OR REPLACE FUNCTION public.normalize_borrower_id_number(p text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT nullif(lower(trim(coalesce(p, ''))), '');
$$;

-- One borrower per identification number (NIDA, etc.) across the whole system
CREATE UNIQUE INDEX IF NOT EXISTS idx_borrowers_ident_norm_unique
  ON public.borrowers (public.normalize_borrower_id_number(identification_number))
  WHERE identification_number IS NOT NULL
    AND trim(identification_number) <> '';

-- One borrower per phone number (normalized) across officers/branches
CREATE UNIQUE INDEX IF NOT EXISTS idx_borrowers_phone_norm_unique
  ON public.borrowers (public.normalize_borrower_phone(phone_number))
  WHERE phone_number IS NOT NULL
    AND trim(phone_number) <> '';

COMMENT ON FUNCTION public.normalize_borrower_phone IS 'Whitespace-insensitive phone key for duplicate checks.';
COMMENT ON FUNCTION public.normalize_borrower_id_number IS 'Lowercase trimmed ID key for duplicate checks.';

-- Lookup for UI before insert (exclude current row on edit)
CREATE OR REPLACE FUNCTION public.find_duplicate_borrower(
  p_phone text,
  p_identification_number text,
  p_exclude_borrower_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  borrower_id text,
  first_name text,
  surname text,
  loan_officer_id uuid,
  branch_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.borrower_id, b.first_name, b.surname, b.loan_officer_id, b.branch_id
  FROM public.borrowers b
  WHERE (p_exclude_borrower_id IS NULL OR b.id <> p_exclude_borrower_id)
    AND (
      (public.normalize_borrower_phone(p_phone) IS NOT NULL
        AND public.normalize_borrower_phone(p_phone) = public.normalize_borrower_phone(b.phone_number))
      OR
      (public.normalize_borrower_id_number(p_identification_number) IS NOT NULL
        AND public.normalize_borrower_id_number(p_identification_number) = public.normalize_borrower_id_number(b.identification_number))
    )
  LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.normalize_borrower_phone(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.normalize_borrower_id_number(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_duplicate_borrower(text, text, uuid) TO authenticated;

COMMENT ON FUNCTION public.find_duplicate_borrower IS 'Returns an existing borrower if phone or ID matches another record (any officer).';
