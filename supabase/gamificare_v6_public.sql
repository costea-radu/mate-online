-- =====================================================================
-- ExamenMate · GAMIFICARE v6 — TURNEE PUBLICE + materiale PDF
-- Rulează DUPĂ gamificare_v4_turnee.sql. Idempotent.
--
-- Până acum un turneu era legat de o grupă, iar participarea era automată
-- (ești în grupă → punctajul intră). Turneul PUBLIC e deschis oricui de pe
-- site, dar cu ÎNSCRIERE explicită: altfel clasamentul ar fi plin de elevi
-- care n-au știut că participă.
-- =====================================================================

alter table public.tournaments add column if not exists scope text not null default 'grupa';
do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'tournaments_scope_check'
  ) then
    alter table public.tournaments add constraint tournaments_scope_check
      check (scope in ('grupa', 'public'));
  end if;
end $$;

-- turneele publice n-au grupă
alter table public.tournaments alter column group_id drop not null;
-- „Turneul săptămânii" e creat de cron, deci n-are un profesor-organizator
alter table public.tournaments alter column owner_id drop not null;
-- create de un cron („turneul săptămânii") sau de admin
alter table public.tournaments add column if not exists auto boolean not null default false;

create index if not exists idx_tournaments_public on public.tournaments(scope, status, ends_at desc);

-- Înscrierile la turneele publice
create table if not exists public.tournament_entries (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  joined_at     timestamptz not null default now(),
  primary key (tournament_id, user_id)
);
create index if not exists idx_tentries_user on public.tournament_entries(user_id);

alter table public.tournament_entries enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='tournament_entries' and policyname='tournament_entries_service') then
    create policy "tournament_entries_service" on public.tournament_entries for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- Verificare rapidă:
-- select scope, status, count(*) from public.tournaments group by 1, 2;
