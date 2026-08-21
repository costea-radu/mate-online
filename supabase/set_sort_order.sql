-- NOTĂ (21 aug 2026): nu mai e nevoie de acest script — aceeași operație se face
-- din Admin → 📋 Tot Conținutul → ↕ Ordinea de afișare → „Sortare automată".
-- =====================================================
-- Setează ordinea de afișare a fișierelor
-- Rulează în Supabase → SQL Editor → New Query
-- =====================================================

-- Cum funcționează:
-- sort_order mai mic = apare primul (0, 1, 2, 3...)
-- sort_order NULL sau egal = se sortează după data adăugării

-- EXEMPLU: setează ordinea pentru câteva fișiere după titlu
-- (înlocuiește titlurile cu ale tale exacte)

UPDATE content SET sort_order = 1 WHERE title = 'Titlul fișierului 1';
UPDATE content SET sort_order = 2 WHERE title = 'Titlul fișierului 2';
UPDATE content SET sort_order = 3 WHERE title = 'Titlul fișierului 3';

-- SAU poți face mai eficient cu un singur query pentru o categorie întreagă.
-- Exemplu: ordonează toate fișierele din clasa-5 după titlu alfabetic:
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY title ASC) AS rn
  FROM content
  WHERE category = 'clasa-5'
)
UPDATE content SET sort_order = ordered.rn
FROM ordered WHERE content.id = ordered.id;

-- Alte categorii disponibile:
-- 'clasa-5' .. 'clasa-12'
-- 'evaluare-nationala'
-- 'bacalaureat'
-- 'manuale'

-- Poți vedea toate fișierele cu ordinea lor curentă:
-- SELECT id, title, category, sort_order, created_at
-- FROM content
-- ORDER BY category, sort_order NULLS LAST, created_at DESC;
