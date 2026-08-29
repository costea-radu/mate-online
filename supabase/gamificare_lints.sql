-- =====================================================================
-- ExamenMate · GAMIFICARE — închiderea avertismentelor „RLS Enabled No Policy"
-- (Supabase Database Linter, 0008 · nivel INFO)
--
-- Tabelele de mai jos sunt intenționat „doar prin API": se citesc și se scriu
-- exclusiv din funcțiile serverless cu rolul de serviciu, care ocolesc RLS.
-- RLS pornit FĂRĂ nicio politică le închide corect pentru anon și authenticated,
-- dar linterul semnalează situația fiindcă nu poate ști dacă e intenționată.
--
-- Adăugăm politica explicită `for all using (auth.role() = 'service_role')` —
-- exact tiparul deja folosit în supabase/mesagerie.sql pentru chat_threads &co.
-- COMPORTAMENTUL NU SE SCHIMBĂ: service_role oricum ocolea RLS, iar elevul tot
-- nu poate citi nimic direct din browser. Se schimbă doar raportul linterului.
--
-- Rulează în Supabase → SQL Editor → New Query. Idempotent.
-- =====================================================================
do $$
declare
  t text;
  tabele text[] := array[
    'duels',                -- gamificare_v3_dueluri.sql
    'league_seasons',       -- gamificare_v2.sql
    'league_standings',
    'tournaments',          -- gamificare_v4_turnee.sql
    'tournament_items',
    'tournament_scores',
    'tournament_places'
  ];
begin
  foreach t in array tabele loop
    if to_regclass('public.' || t) is null then
      raise notice 'Tabela public.% nu există încă — sari peste (rulează întâi migrarea ei).', t;
      continue;
    end if;
    execute format('alter table public.%I enable row level security', t);
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_service'
    ) then
      execute format(
        'create policy %I on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')',
        t || '_service', t
      );
      raise notice 'Politica %_service creată.', t;
    end if;
  end loop;
end $$;

-- Verificare: fiecare tabelă trebuie să aibă exact o politică, „<tabela>_service".
-- select tablename, policyname from pg_policies
--  where schemaname = 'public'
--    and tablename in ('duels','league_seasons','league_standings','tournaments',
--                      'tournament_items','tournament_scores','tournament_places')
--  order by tablename;
