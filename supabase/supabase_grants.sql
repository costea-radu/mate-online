-- ============================================================
-- MATE-ONLINE — Script GRANT-uri Supabase
-- Tabele: content, discussions, profiles, progress, rezolvari
-- Rulează în: Supabase → SQL Editor → New Query
-- ============================================================


-- ============================================================
-- 1. content
-- ============================================================
GRANT SELECT
  ON public.content TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.content TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.content TO service_role;

ALTER TABLE public.content ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "content_select_public" ON public.content;
CREATE POLICY "content_select_public"
  ON public.content FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "content_modify_service" ON public.content;
CREATE POLICY "content_modify_service"
  ON public.content FOR ALL
  USING (auth.role() = 'service_role');


-- ============================================================
-- 2. discussions
-- ============================================================
GRANT SELECT
  ON public.discussions TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.discussions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.discussions TO service_role;

ALTER TABLE public.discussions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "discussions_select_public" ON public.discussions;
CREATE POLICY "discussions_select_public"
  ON public.discussions FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "discussions_insert_auth" ON public.discussions;
CREATE POLICY "discussions_insert_auth"
  ON public.discussions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "discussions_delete_own" ON public.discussions;
CREATE POLICY "discussions_delete_own"
  ON public.discussions FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "discussions_service_role" ON public.discussions;
CREATE POLICY "discussions_service_role"
  ON public.discussions FOR ALL
  USING (auth.role() = 'service_role');


-- ============================================================
-- 3. profiles
-- ============================================================
GRANT SELECT
  ON public.profiles TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.profiles TO service_role;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_select_all" ON public.profiles;
CREATE POLICY "profiles_select_all"
  ON public.profiles FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
  ON public.profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
CREATE POLICY "profiles_insert_own"
  ON public.profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "profiles_service_role" ON public.profiles;
CREATE POLICY "profiles_service_role"
  ON public.profiles FOR ALL
  USING (auth.role() = 'service_role');


-- ============================================================
-- 4. progress
-- ============================================================
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.progress TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.progress TO service_role;

ALTER TABLE public.progress ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "progress_select_own" ON public.progress;
CREATE POLICY "progress_select_own"
  ON public.progress FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "progress_insert_own" ON public.progress;
CREATE POLICY "progress_insert_own"
  ON public.progress FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "progress_update_own" ON public.progress;
CREATE POLICY "progress_update_own"
  ON public.progress FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "progress_service_role" ON public.progress;
CREATE POLICY "progress_service_role"
  ON public.progress FOR ALL
  USING (auth.role() = 'service_role');


-- ============================================================
-- 5. rezolvari
-- ============================================================
GRANT SELECT
  ON public.rezolvari TO anon;
GRANT SELECT
  ON public.rezolvari TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.rezolvari TO service_role;

ALTER TABLE public.rezolvari ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "rezolvari_select_public" ON public.rezolvari;
CREATE POLICY "rezolvari_select_public"
  ON public.rezolvari FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "rezolvari_modify_service" ON public.rezolvari;
CREATE POLICY "rezolvari_modify_service"
  ON public.rezolvari FOR ALL
  USING (auth.role() = 'service_role');


-- ============================================================
-- VERIFICARE
-- SELECT tablename, rowsecurity
-- FROM pg_tables
-- WHERE schemaname = 'public'
-- ORDER BY tablename;
-- Toate 5 trebuie sa aiba rowsecurity = true
-- ============================================================
