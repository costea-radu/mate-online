-- =====================================================================
-- fix_lints_6sep2026.sql — raportul Advisors din 6 septembrie 2026
--                          (3 warninguri; 2 se repară din SQL, 1 nu)
--
--   0028 anon_security_definer_function_executable          → public.ai_correct_forms_invalidate()
--   0029 authenticated_security_definer_function_executable → aceeași funcție
--   auth_leaked_password_protection                         → doar pe planul Pro (vezi jos)
--
-- Rulează în Supabase → SQL Editor → New Query. Sigur de rulat repetat.
--
-- TESTAT pe PostgreSQL 16.13 (aceeași versiune majoră ca Supabase), pe o bază
-- în care am reprodus întâi warningul (rolurile anon/authenticated/service_role
-- + privilegiile implicite Supabase + funcția și triggerul din
-- ai_correct_forms.sql). Rezultate:
--   • înainte: anon = true, authenticated = true  → exact ce a raportat Advisors;
--   • după:    anon = false, authenticated = false, drepturi rămase
--     `{postgres=X/postgres, service_role=X/postgres}`;
--   • TRIGGERUL MERGE MAI DEPARTE: update pe `content.file_url` făcut ca
--     `service_role` șterge în continuare rândul din `ai_correct_forms` — chiar
--     și după ce am scos EXECUTE inclusiv pentru `service_role` (PostgreSQL
--     verifică dreptul la CREATE TRIGGER, nu la fiecare declanșare);
--   • `anon` primește `permission denied` dacă încearcă funcția prin RPC;
--   • `reviews_can_rate` rămâne executabilă de `authenticated` (politica RLS
--     de la recenzii nu se strică);
--   • rulat de trei ori la rând: exit 0, fără erori.
--
-- CE NU REZOLVĂ PASUL 3 (verificat, ca să nu te bazezi pe ce nu e): o funcție
-- adăugată de o migrare VIITOARE tot va primi EXECUTE prin PUBLIC — implicitul
-- din PostgreSQL însuși, care nu poate fi scos cu ALTER DEFAULT PRIVILEGES.
-- Diferența e că nu mai primește și granturile DIRECTE pe anon/authenticated:
--   înainte: {=X/postgres, postgres=X/postgres, anon=X/postgres, authenticated=X/postgres, ...}
--   după:    {=X/postgres, postgres=X/postgres, service_role=X/postgres}
-- Deci regula pentru viitor: după orice migrare care adaugă funcții, ori pui în
-- ea `revoke all on function ... from public`, ori rulezi din nou fișierul ăsta
-- (pasul 2 le mătură pe toate) și te uiți la raportul de la final.
-- =====================================================================

-- ── 1. Funcția de trigger scoasă din API (linturile 0028 + 0029) ────────────
-- `public.ai_correct_forms_invalidate()` (din supabase/ai_correct_forms.sql)
-- e o funcție de TRIGGER: șterge formularul de corectare al unui material când
-- i se schimbă fișierul (`content.file_url`). Nu e o funcție de API și nu are
-- ce căuta în /rest/v1/rpc — dar PostgreSQL dă implicit EXECUTE lui PUBLIC pe
-- orice funcție nouă, iar Supabase îl dă în plus, DIRECT, rolurilor `anon` și
-- `authenticated` (capcana explicată pe larg în supabase/fix_grants_v3.sql).
--
-- De ce a reapărut: `ai_correct_forms.sql` are deja linia de revoke la final,
-- dar funcția a ajuns în bază înainte ca ea să existe acolo (sau fișierul a
-- fost rulat doar parțial). Pasul 2 de mai jos închide problema pentru TOATE
-- funcțiile, nu doar pentru asta, ca să nu mai depindem de ordinea rulărilor.
--
-- Triggerul NU se strică: PostgreSQL verifică EXECUTE pe funcția de trigger la
-- CREATE TRIGGER, nu la fiecare declanșare. Iar `api/content-admin.js`, care
-- schimbă fișierele, lucrează cu cheia de serviciu (`service_role`), care
-- păstrează dreptul mai jos.
REVOKE ALL ON FUNCTION public.ai_correct_forms_invalidate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_correct_forms_invalidate() TO service_role;

-- ── 2. Aceeași măsură pentru orice altă funcție SECURITY DEFINER ────────────
-- Repetă măturarea din supabase/fix_grants_v3.sql: ia din catalog toate
-- funcțiile SECURITY DEFINER din schema `public` și le lasă doar pentru server.
-- Așa, o funcție adăugată de o migrare viitoare nu mai apare în următorul
-- raport Advisors. În tot `src/` nu există niciun apel `.rpc(...)` — toate
-- funcțiile sunt chemate din `api/`, cu cheia de serviciu.
do $$
declare
  f record;
  n int := 0;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    where ns.nspname = 'public'
      and p.prosecdef                       -- doar SECURITY DEFINER
      and not exists (                      -- sărim funcțiile venite cu o extensie
        select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'
      )
    order by 1
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
    n := n + 1;
  end loop;
  raise notice 'Funcții SECURITY DEFINER închise pentru browser: %', n;
end $$;

-- EXCEPȚIE: `public.reviews_can_rate(text, uuid)` TREBUIE să rămână executabilă
-- de `authenticated` — e chemată din politica RLS de INSERT pe `reviews`, iar o
-- politică rulează cu drepturile utilizatorului care scrie. Nu supără linterul:
-- din 21 august e SECURITY INVOKER (fix_lints_21aug2026.sql), iar bucla de mai
-- sus atinge doar funcțiile DEFINER. Dreptul se pune la loc, ca măturarea să
-- nu-l ia din greșeală dacă cineva o readuce vreodată la DEFINER.
do $$ begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reviews_can_rate'
  ) then
    execute 'grant execute on function public.reviews_can_rate(text, uuid) to authenticated, service_role';
  end if;
end $$;

-- ── 3. Privilegiile IMPLICITE, ca funcțiile viitoare să nu repete greșeala ──
-- Scoate grantul direct pe anon/authenticated pus de Supabase la fiecare
-- funcție nouă. (Implicitul PostgreSQL pentru PUBLIC nu poate fi scos așa —
-- explicat în fix_grants_v3.sql — dar după pasul ăsta un simplu
-- `revoke ... from public` e de ajuns, ca într-un PostgreSQL normal.)
-- Dacă nu ești membru al rolului, pasul se sare cu un mesaj — nu e o problemă.
do $$
declare
  r text;
begin
  foreach r in array array['postgres', 'supabase_admin'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      begin
        execute format(
          'alter default privileges for role %I in schema public revoke execute on functions from anon, authenticated', r);
        raise notice 'Privilegii implicite ajustate pentru rolul %', r;
      exception when insufficient_privilege or undefined_object then
        raise notice 'Nu am putut ajusta privilegiile implicite pentru % — nu e o problemă, pașii 1 și 2 rămân valabili', r;
      end;
    end if;
  end loop;
end $$;

-- ── 4. „Leaked Password Protection Disabled" — NU se poate repara acum ──────
-- Verificarea parolelor compromise (HaveIBeenPwned) e disponibilă DOAR pe
-- planul Pro sau mai sus. Pe Free comutatorul nu poate fi activat, deci
-- warningul rămâne afișat orice am face — nu e o scăpare din cod și nu ține de
-- SQL. La trecerea pe Pro: Authentication → Sign In / Up → Password Protection
-- → „Prevent use of leaked passwords" (un click).
-- Până atunci, parolele sunt apărate de ce ține de noi: minimul de lungime din
-- Auth și autentificarea prin Google/Discord, care ocolește parola cu totul.

-- ── Verificare ──────────────────────────────────────────────────────────────
-- a) Funcția din raport — ideal: anon = false, autentificat = false, server = true
SELECT p.oid::regprocedure                                      AS functie,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS autentificat,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS server
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname = 'ai_correct_forms_invalidate';

-- b) Ce a mai rămas expus din toate funcțiile SECURITY DEFINER — ideal: „0 rows".
--    Dacă apare ceva, e o funcție pe care o poate chema oricine are cheia anon.
SELECT p.oid::regprocedure                                      AS functie_inca_expusa,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS autentificat
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'))
ORDER BY 1;

-- c) Test funcțional (triggerul trebuie să meargă mai departe):
--    Admin → Conținut → înlocuiește fișierul unui material PDF care are deja
--    formular de corectare. Update-ul trebuie să treacă fără eroare, iar rândul
--    din `ai_correct_forms` pentru acel material să dispară:
--      select count(*) from public.ai_correct_forms where content_id = '<id-ul materialului>';
--
-- Apoi: Supabase → Advisors → „Rerun linter" — rămâne doar warningul de la
-- punctul 4 (parolele compromise), care ține de planul Pro.
