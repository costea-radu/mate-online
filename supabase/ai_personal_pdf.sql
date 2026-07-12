-- Permite salvarea subiectelor PDF combinate în „Testele și exercițiile mele”.
-- Rulează o singură dată în Supabase → SQL Editor.
ALTER TABLE public.ai_personal_items DROP CONSTRAINT IF EXISTS ai_personal_items_kind_check;
ALTER TABLE public.ai_personal_items
  ADD CONSTRAINT ai_personal_items_kind_check
  CHECK (kind IN ('interactive', 'exam', 'practice', 'pdf'));
