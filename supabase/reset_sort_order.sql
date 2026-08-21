-- NOTĂ (21 aug 2026): nu mai e nevoie de acest script — aceeași operație se face
-- din Admin → 📋 Tot Conținutul → ↕ Ordinea de afișare → „Sortare automată".
-- Setează sort_order automat pentru toate fișierele
-- grupat pe categorie, sortat după data adăugării (cel mai vechi = primul)
-- Rulează în Supabase → SQL Editor

WITH numbered AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY category
      ORDER BY created_at ASC
    ) AS rn
  FROM content
)
UPDATE content
SET sort_order = numbered.rn
FROM numbered
WHERE content.id = numbered.id;
