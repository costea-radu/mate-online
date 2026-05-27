-- ============================================================
-- Policy: adminul poate șterge orice comentariu/răspuns
-- Rulează în: Supabase → SQL Editor → New Query
-- Condiție: profilul are is_admin = true în tabela profiles
-- ============================================================


-- ── discussions ────────────────────────────────────────────
DROP POLICY IF EXISTS "discussions_delete_own" ON public.discussions;

CREATE POLICY "discussions_delete_own_or_admin"
  ON public.discussions FOR DELETE
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM public.profiles
      WHERE id = auth.uid() AND is_admin = true
    )
  );


-- ── discussion_replies (dacă există tabela) ────────────────
-- Decomentează dacă ai tabela discussion_replies:

-- DROP POLICY IF EXISTS "replies_delete_own" ON public.discussion_replies;

-- CREATE POLICY "replies_delete_own_or_admin"
--   ON public.discussion_replies FOR DELETE
--   TO authenticated
--   USING (
--     auth.uid() = user_id
--     OR EXISTS (
--       SELECT 1 FROM public.profiles
--       WHERE id = auth.uid() AND is_admin = true
--     )
--   );


-- ── Verificare: adminul tău are is_admin = true? ───────────
-- Rulează asta să verifici:
-- SELECT id, email, is_admin FROM public.profiles WHERE is_admin = true;
--
-- Dacă nu are, setează manual:
-- UPDATE public.profiles SET is_admin = true WHERE id = 'UUID_AL_TAU_AICI';
