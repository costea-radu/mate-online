-- =====================================================================
-- Corectează warning-urile din Supabase → Advisors → Security Lints
-- (raportul CSV din 7 august 2026: 4 warning-uri)
-- Rulează în Supabase → SQL Editor → New Query, secțiune cu secțiune.
-- =====================================================================

-- ── 1. „Function Search Path Mutable" — public.med_profile_touch ─────────────
-- Trigger-ul care setează updated_at pe ai_meditatii_profile nu avea
-- search_path fixat. Îl fixăm ca la toate celelalte funcții ale proiectului.
ALTER FUNCTION public.med_profile_touch() SET search_path = public;

-- ── 2. „Signed-In Users Can Execute SECURITY DEFINER Function" ───────────────
--      public.delete_user_account()
-- Ștergerea contului NU mai trece prin acest RPC: din decembrie merge prin
-- /api/ai-account (aiClient.accountDelete → supa.auth.admin.deleteUser, cu
-- service_role). Funcția nu mai e apelată nicăieri în src/ sau api/ — deci
-- retragem dreptul de execuție de la clienți; rămâne doar pentru service_role.
REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_user_account() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_user_account() TO service_role;

-- ── 3. „Extension in Public" — extensia vector (pgvector) ────────────────────
-- Recomandarea Supabase: extensiile stau în schema `extensions`, nu în `public`.
-- ATENȚIE: match_ai_knowledge (căutarea semantică RAG) are search_path fixat
-- pe `public` și folosește operatorul <=> al extensiei — după mutare trebuie
-- să vadă și schema `extensions`, altfel Prof. Virtual rămâne fără RAG.
-- De aceea totul se face într-o SINGURĂ tranzacție:
BEGIN;
  CREATE SCHEMA IF NOT EXISTS extensions;
  ALTER EXTENSION vector SET SCHEMA extensions;
  ALTER FUNCTION public.match_ai_knowledge(extensions.vector, int, text, boolean)
    SET search_path = public, extensions;
COMMIT;
-- Dacă ALTER EXTENSION dă eroarea „extension does not support SET SCHEMA":
-- rulează ROLLBACK; și lasă extensia în public — warning-ul e doar de igienă,
-- nu o vulnerabilitate. NU forța mutarea altfel.
-- După rulare, verifică pe site: Prof. Virtual răspunde cu materiale din
-- platformă (RAG funcționează) — vezi și verificarea de mai jos.

-- ── 4. „Leaked Password Protection Disabled" — NU se rezolvă din SQL ─────────
-- Din Dashboard: Supabase → Authentication → Sign In / Providers →
-- secțiunea Passwords → activează „Prevent use of leaked passwords"
-- (verificare HaveIBeenPwned). Nu afectează conturile existente — doar
-- respinge parole compromise la înregistrare/schimbare.

-- ── Verificare finală ────────────────────────────────────────────────────────
-- a) search_path fixat pe ambele funcții (trebuie să apară „search_path=..."):
SELECT proname, proconfig
FROM pg_proc
WHERE proname IN ('med_profile_touch', 'match_ai_knowledge');

-- b) extensia vector e în schema extensions:
SELECT e.extname, n.nspname AS schema
FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
WHERE e.extname = 'vector';

-- c) delete_user_account nu mai e executabilă de anon/authenticated
--    (nu trebuie să apară niciun rând cu anon sau authenticated):
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'delete_user_account';

-- d) test rapid RAG (după mutarea extensiei) — trebuie să meargă fără eroare:
-- SELECT * FROM public.match_ai_knowledge((SELECT embedding FROM public.ai_knowledge WHERE embedding IS NOT NULL LIMIT 1), 1, NULL, true);
