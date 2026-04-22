-- Setează sort_order: cel mai recent adăugat = primul afișat
-- Rulează în Supabase → SQL Editor

WITH numbered AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY category
      ORDER BY created_at DESC
    ) AS rn
  FROM content
)
UPDATE content
SET sort_order = numbered.rn
FROM numbered
WHERE content.id = numbered.id;
