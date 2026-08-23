-- =====================================================================
-- ExamenMate · REPARAȚIE DE SECURITATE — funcțiile SECURITY DEFINER nu mai
-- pot fi chemate din browser (linterul Supabase: 0028 + 0029)
--
-- PROBLEMA (introdusă de mine în ai_rag_v2.sql și meditatii_v3.sql, Etapa 3):
-- am scris doar `revoke all on function ... from public`. În Supabase NU e
-- de ajuns: proiectul are, din construcție,
--     alter default privileges in schema public grant all on functions
--       to anon, authenticated, service_role;
-- deci fiecare funcție nouă primește EXECUTE direct pe rolurile `anon` și
-- `authenticated` — iar `revoke ... from public` nu atinge acele granturi
-- directe. Rezultatul: oricine are cheia publică `anon` (e în JS-ul site-ului,
-- o vede oricine deschide DevTools) putea chema:
--
--   POST /rest/v1/rpc/match_ai_knowledge_hybrid
--   { "query_text": "derivate", "allow_premium": true, "match_count": 100 }
--
-- și primea conținutul PREMIUM. După Etapa 3 asta e grav: `ai_knowledge` nu
-- mai ține titluri, ci enunțurile reale, rezolvările și cheile de răspuns.
-- La fel, `merge_skill_topic(p_user, ...)` primește uuid-ul ORICĂRUI elev,
-- deci oricine putea rescrie progresul altcuiva.
--
-- Tiparul corect exista deja în proiect (ai_alerte.sql, ai_limite_cost.sql,
-- ai_pregen.sql): `revoke ... from public, anon, authenticated`. L-am ratat.
--
-- CE FACE ACEST FIȘIER
--   1. Ia din catalog TOATE funcțiile SECURITY DEFINER din schema `public`
--      (nu doar cele 5 raportate de linter) și le lasă doar pentru server.
--   2. Schimbă privilegiile IMPLICITE, ca funcțiile viitoare să nu mai
--      repete greșeala.
--   3. Afișează la final un raport: ce mai e expus (ideal: 0 rânduri).
--
-- DE CE E SIGUR: în tot `src/` nu există NICIUN apel `.rpc(...)` — toate
-- funcțiile sunt chemate din `api/`, cu cheia de serviciu. Verifică singur:
--     grep -rn "\.rpc(" src/     → zero rezultate
--
-- Triggerele NU se strică: PostgreSQL verifică EXECUTE pe funcția de trigger
-- la CREATE TRIGGER, nu la fiecare declanșare (testat pe Postgres 16).
--
-- Rulează o dată în Supabase → SQL Editor. Idempotent, se poate rula oricând
-- din nou (de exemplu după orice migrare viitoare care adaugă funcții).
-- =====================================================================

-- ─── 1. Funcțiile existente ─────────────────────────────────────────────────
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

-- ─── 2. Privilegiile IMPLICITE — dezamorsăm capcana ─────────────────────────
-- O funcție nouă primește EXECUTE din DOUĂ locuri:
--   (a) PUBLIC — implicitul din PostgreSQL însuși (deci și anon, și authenticated);
--   (b) anon/authenticated DIRECT — privilegiile implicite puse de Supabase.
-- (b) e capcana: din cauza lui, `revoke ... from public` pare că face treaba, dar
-- nu face. Pasul ăsta scoate (b).
--
-- ATENȚIE, ca să nu te bazezi pe ce nu e: (a) NU poate fi scos prin ALTER DEFAULT
-- PRIVILEGES — implicitul din PostgreSQL se adaugă mereu (verificat pe 16.13:
-- funcția nouă rămâne cu `=X/postgres` oricât ai revoca din privilegiile implicite).
-- Deci funcțiile viitoare tot vor fi chemabile până le revoci explicit — DAR, după
-- pasul ăsta, e de ajuns `revoke all on function ... from public`, cum scrie în
-- orice manual. Adică se comportă iar ca un PostgreSQL normal.
--
-- Regula de aur pentru viitor: după ORICE migrare care adaugă funcții,
-- rulează din nou fișierul ăsta și uită-te la raportul de la pasul 3.
--
-- Ca să anulezi:
--   alter default privileges in schema public grant execute on functions to anon, authenticated;
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
        raise notice 'Nu am putut ajusta privilegiile implicite pentru % (normal dacă nu ești membru al rolului) — nu e o problemă, pasul 1 rămâne valabil', r;
      end;
    end if;
  end loop;
end $$;

-- ─── 3. RAPORT — ce a mai rămas expus ───────────────────────────────────────
-- Ideal: „(0 rows)". Dacă apare ceva, e o funcție SECURITY DEFINER pe care o
-- poate chema oricine — spune-mi ce scrie aici.
select
  p.oid::regprocedure                                    as functie_inca_expusa,
  has_function_privilege('anon',          p.oid, 'EXECUTE') as anon,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as autentificat
from pg_proc p
join pg_namespace ns on ns.oid = p.pronamespace
where ns.nspname = 'public'
  and p.prosecdef
  and (has_function_privilege('anon',          p.oid, 'EXECUTE')
    or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
order by 1;
