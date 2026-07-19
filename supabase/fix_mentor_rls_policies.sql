-- =====================================================
-- ExamenMate – Politici RLS explicite pentru mentor_groups / mentor_students
-- Rezolvă advisory-ul INFO "RLS Enabled No Policy" din Supabase linter.
-- Comportament NESCHIMBAT: tabelele rămân accesibile doar prin funcțiile
-- serverless cu service_role (care ocolește RLS). Politicile de mai jos
-- blochează explicit anon/authenticated, în loc de implicit.
-- Rulează în Supabase → SQL Editor → New Query (idempotent).
-- =====================================================

DROP POLICY IF EXISTS "Deny all (service role only)" ON public.mentor_groups;
CREATE POLICY "Deny all (service role only)"
  ON public.mentor_groups
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "Deny all (service role only)" ON public.mentor_students;
CREATE POLICY "Deny all (service role only)"
  ON public.mentor_students
  FOR ALL TO anon, authenticated
  USING (false)
  WITH CHECK (false);
