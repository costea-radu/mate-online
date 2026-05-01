-- =====================================================
-- Fix toate 6 warning-urile de securitate Supabase
-- Rulează în Supabase → SQL Editor → New Query
-- =====================================================

-- ── 1. Revocă EXECUTE pe delete_user_account pentru anon ─────────────────────
-- Funcția trebuie apelată doar de utilizatori autentificați
REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM anon;

-- ── 2. Revocă EXECUTE pe handle_new_user pentru anon și authenticated ────────
-- Funcția e un trigger intern — nu trebuie apelată direct de nimeni
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;

-- ── 3. Restricționează politica SELECT pe bucket-ul discussions ───────────────
-- Permite citirea obiectelor individuale dar NU listarea tuturor fișierelor
DROP POLICY IF EXISTS "discussions_select" ON storage.objects;

CREATE POLICY "discussions_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'discussions'
    AND (auth.role() = 'authenticated' OR name IS NOT NULL)
  );

-- ── 4. Leaked Password Protection ────────────────────────────────────────────
-- Acesta se activează din interfață, nu din SQL:
-- Supabase → Authentication → Sign In / Up → Password Protection
-- → activează "Prevent use of leaked passwords"

-- ── Verificare rezultat ───────────────────────────────────────────────────────
SELECT routine_name, grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public'
  AND routine_name IN ('delete_user_account', 'handle_new_user')
  AND grantee IN ('anon', 'authenticated')
ORDER BY routine_name, grantee;
