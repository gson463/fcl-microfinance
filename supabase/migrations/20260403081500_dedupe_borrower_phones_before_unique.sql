-- Resolve duplicate normalized phone numbers before idx_borrowers_phone_norm_unique (20260403120000).
-- Keeps one borrower per normalized phone (earliest created_at, then smallest id); reassigns loans/repayments; removes duplicates.

WITH grouped AS (
  SELECT
    id,
    NULLIF(
      regexp_replace(lower(trim(coalesce(phone_number, ''))), '\s', '', 'g'),
      ''
    ) AS phone_norm,
    ROW_NUMBER() OVER (
      PARTITION BY NULLIF(
        regexp_replace(lower(trim(coalesce(phone_number, ''))), '\s', '', 'g'),
        ''
      )
      ORDER BY created_at NULLS LAST, id
    ) AS rn
  FROM public.borrowers
  WHERE phone_number IS NOT NULL
    AND trim(phone_number) <> ''
    AND NULLIF(
      regexp_replace(lower(trim(coalesce(phone_number, ''))), '\s', '', 'g'),
      ''
    ) IS NOT NULL
),
keeper AS (
  SELECT phone_norm, id AS keeper_id
  FROM grouped
  WHERE rn = 1
)
UPDATE public.loans l
SET borrower_id = k.keeper_id
FROM grouped g
JOIN keeper k ON k.phone_norm = g.phone_norm
WHERE l.borrower_id = g.id
  AND g.rn > 1;

WITH grouped AS (
  SELECT
    id,
    NULLIF(
      regexp_replace(lower(trim(coalesce(phone_number, ''))), '\s', '', 'g'),
      ''
    ) AS phone_norm,
    ROW_NUMBER() OVER (
      PARTITION BY NULLIF(
        regexp_replace(lower(trim(coalesce(phone_number, ''))), '\s', '', 'g'),
        ''
      )
      ORDER BY created_at NULLS LAST, id
    ) AS rn
  FROM public.borrowers
  WHERE phone_number IS NOT NULL
    AND trim(phone_number) <> ''
    AND NULLIF(
      regexp_replace(lower(trim(coalesce(phone_number, ''))), '\s', '', 'g'),
      ''
    ) IS NOT NULL
),
keeper AS (
  SELECT phone_norm, id AS keeper_id
  FROM grouped
  WHERE rn = 1
)
UPDATE public.repayments r
SET borrower_id = k.keeper_id
FROM grouped g
JOIN keeper k ON k.phone_norm = g.phone_norm
WHERE r.borrower_id = g.id
  AND g.rn > 1;

WITH grouped AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY NULLIF(
        regexp_replace(lower(trim(coalesce(phone_number, ''))), '\s', '', 'g'),
        ''
      )
      ORDER BY created_at NULLS LAST, id
    ) AS rn
  FROM public.borrowers
  WHERE phone_number IS NOT NULL
    AND trim(phone_number) <> ''
    AND NULLIF(
      regexp_replace(lower(trim(coalesce(phone_number, ''))), '\s', '', 'g'),
      ''
    ) IS NOT NULL
)
DELETE FROM public.borrowers b
WHERE b.id IN (
  SELECT g.id
  FROM grouped g
  WHERE g.rn > 1
);
