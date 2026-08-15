-- =====================================================================
-- FIX SECURITATE — funcții SECURITY DEFINER apelabile direct de orice client
-- Rulează în: Supabase → SQL Editor → New Query
-- =====================================================================
-- PROBLEMA: `bump_skill_mastery` și `enqueue_ingest` sunt `security definer`,
-- dar EXECUTE nu a fost retras de la PUBLIC (spre deosebire de delete_user_account
-- / handle_new_user, care au REVOKE explicit). PostgREST le expune la
--     /rest/v1/rpc/bump_skill_mastery  și  /rest/v1/rpc/enqueue_ingest
-- deci orice client (anon/authenticated) putea:
--   • apela bump_skill_mastery(p_user, ...) cu un p_user ARBITRAR și, rulând ca
--     definer, ocolea RLS ca să scrie „mastery" pentru orice utilizator;
--   • inunda coada de ingest prin enqueue_ingest.
--
-- SOLUȚIA: retragem EXECUTE de la PUBLIC/anon/authenticated și îl acordăm DOAR
-- lui service_role (serverul le apelă cu cheia service-role). Trigger-ele care
-- cheamă enqueue_ingest sunt ele însele SECURITY DEFINER deținute de owner-ul
-- migrării → execuția lor nu depinde de grant-ul PUBLIC, deci NU se rup.
-- =====================================================================

REVOKE EXECUTE ON FUNCTION public.bump_skill_mastery(uuid, text, text, boolean)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.bump_skill_mastery(uuid, text, text, boolean)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.enqueue_ingest(text, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.enqueue_ingest(text, uuid, text)
  TO service_role;

-- Verificare (opțional) — cine mai poate executa:
--   SELECT p.proname, r.rolname
--   FROM pg_proc p
--   CROSS JOIN LATERAL aclexplode(p.proacl) a
--   JOIN pg_roles r ON r.oid = a.grantee
--   WHERE p.proname IN ('bump_skill_mastery','enqueue_ingest');
