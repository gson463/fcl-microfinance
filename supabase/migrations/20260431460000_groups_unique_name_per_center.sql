-- One normalized name per center: merge existing duplicates, then unique index.
-- Keeps the oldest row per (center_id, lower(btrim(name))) by created_at then id; repoints FKs then deletes dupes.

WITH grp AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY center_id, lower(btrim(name))
      ORDER BY created_at NULLS LAST, id
    ) AS keeper_id
  FROM public.groups
  WHERE center_id IS NOT NULL
),
to_merge AS (
  SELECT id AS dup_id, keeper_id FROM grp WHERE id <> keeper_id
)
UPDATE public.borrowers b
SET group_id = m.keeper_id
FROM to_merge m
WHERE b.group_id = m.dup_id;

WITH grp AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY center_id, lower(btrim(name))
      ORDER BY created_at NULLS LAST, id
    ) AS keeper_id
  FROM public.groups
  WHERE center_id IS NOT NULL
),
to_merge AS (
  SELECT id AS dup_id, keeper_id FROM grp WHERE id <> keeper_id
)
UPDATE public.attendance_records ar
SET group_id = m.keeper_id
FROM to_merge m
WHERE ar.group_id = m.dup_id;

WITH grp AS (
  SELECT
    id,
    FIRST_VALUE(id) OVER (
      PARTITION BY center_id, lower(btrim(name))
      ORDER BY created_at NULLS LAST, id
    ) AS keeper_id
  FROM public.groups
  WHERE center_id IS NOT NULL
),
to_merge AS (
  SELECT id AS dup_id, keeper_id FROM grp WHERE id <> keeper_id
)
DELETE FROM public.groups g
USING to_merge m
WHERE g.id = m.dup_id;

CREATE UNIQUE INDEX IF NOT EXISTS groups_unique_name_per_center
ON public.groups (center_id, lower(btrim(name)))
WHERE center_id IS NOT NULL;

COMMENT ON INDEX public.groups_unique_name_per_center IS
  'Prevents two groups with the same name (ignoring case and leading/trailing spaces) in the same center.';
