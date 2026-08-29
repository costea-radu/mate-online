-- =====================================================================
-- ExamenMate · GAMIFICARE v2 — XP, streak, misiunea zilei, LIGA săptămânală
-- (Arena matematică, pașii 1-2 din planul de gamificare)
--
-- Rulează în Supabase → SQL Editor → New Query. Idempotent: se poate rula
-- de mai multe ori fără efecte secundare.
--
-- Principii:
--  · TOATE scrierile se fac de pe server (api/_lib/xp.js) cu rolul de
--    serviciu — la fel ca `progress` după supabase/progress_server_only.sql.
--    Elevul NU poate să-și scrie singur XP-ul din browser.
--  · Elevul CITEȘTE doar propriile rânduri (user_stats, xp_events,
--    daily_missions). Clasamentul ligii se servește prin /api/gamificare,
--    ca să nu expunem numele complete ale celorlalți elevi.
-- =====================================================================

-- ─── 0. Dificultatea materialului (opțional, dar folosită de formulă) ────────
-- Dacă lipsește, formula deduce dificultatea din categorie (vezi api/_lib/xp.js).
alter table public.content add column if not exists difficulty smallint;
comment on column public.content.difficulty is
  'Dificultate 1-5 pentru formula de XP (gamificare). NULL → se deduce din categorie.';

-- ─── 1. Statistici cumulate per elev ────────────────────────────────────────
create table if not exists public.user_stats (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  total_xp       integer     not null default 0,
  coins          integer     not null default 0,   -- „monede matematice" (magazinul vine la pasul 5)
  streak_current integer     not null default 0,
  streak_best    integer     not null default 0,
  streak_day     date,                              -- ultima zi care a CONTAT pentru serie
  freezes        smallint    not null default 0,    -- „scuturi" de streak (max 2)
  league_tier    smallint    not null default 1,    -- 1 Bronz … 5 Maestru
  updated_at     timestamptz not null default now()
);

alter table public.user_stats enable row level security;
drop policy if exists "stats: select own" on public.user_stats;
create policy "stats: select own" on public.user_stats for select using (auth.uid() = user_id);
-- fără politici de INSERT/UPDATE: scrie doar rolul de serviciu (API-ul)

-- ─── 2. Registrul de XP (sursa de adevăr, permite recalcularea) ──────────────
create table if not exists public.xp_events (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,                       -- ziua calendaristică (Europa/București)
  source     text not null,                       -- 'interactive' | 'misiune' | 'streak' | 'duel' | 'bonus'
  ref_id     uuid,                                -- ex. content_id
  xp         integer not null default 0,          -- XP-ul acordat (intră în total_xp)
  league_pts integer not null default 0,          -- cât a intrat în ligă (după plafonul zilnic)
  meta       jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_xp_events_user_day on public.xp_events(user_id, day);
create index if not exists idx_xp_events_user_time on public.xp_events(user_id, created_at desc);

alter table public.xp_events enable row level security;
drop policy if exists "xp: select own" on public.xp_events;
create policy "xp: select own" on public.xp_events for select using (auth.uid() = user_id);

-- ─── 3. Misiunea zilei ──────────────────────────────────────────────────────
create table if not exists public.daily_missions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  day        date not null,
  kind       text not null,                       -- 'corecte' | 'xp' | 'precizie'
  label      text not null,                       -- textul arătat elevului
  target     integer not null,
  progress   integer not null default 0,
  done       boolean not null default false,
  reward_xp  integer not null default 50,
  reward_coins integer not null default 10,
  created_at timestamptz not null default now(),
  done_at    timestamptz,
  unique(user_id, day)
);

create index if not exists idx_missions_user_day on public.daily_missions(user_id, day);

alter table public.daily_missions enable row level security;
drop policy if exists "missions: select own" on public.daily_missions;
create policy "missions: select own" on public.daily_missions for select using (auth.uid() = user_id);

-- ─── 4. Liga: sezoane săptămânale ───────────────────────────────────────────
create table if not exists public.league_seasons (
  id         uuid primary key default gen_random_uuid(),
  week_start date not null unique,                -- lunea săptămânii (Europa/București)
  closed_at  timestamptz,
  created_at timestamptz not null default now()
);

-- Clasamentul: un rând per elev per sezon. Cohorta = grup de max 30 de elevi
-- din aceeași divizie; așa clasamentul rămâne „la scara clasei", nu a site-ului.
create table if not exists public.league_standings (
  id         uuid primary key default gen_random_uuid(),
  season_id  uuid not null references public.league_seasons(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  tier       smallint not null default 1,
  cohort     integer  not null default 1,
  points     integer  not null default 0,
  place      integer,                             -- completat la închiderea sezonului
  outcome    text,                                -- 'promovat' | 'retrogradat' | 'ramas'
  updated_at timestamptz not null default now(),
  unique(season_id, user_id)
);

create index if not exists idx_standings_cohort on public.league_standings(season_id, tier, cohort, points desc);
create index if not exists idx_standings_user on public.league_standings(user_id);

alter table public.league_seasons   enable row level security;
alter table public.league_standings enable row level security;
-- Linterul Supabase semnalează „RLS enabled, no policy" (INFO) pentru tabelele
-- fără politici. Rulează și supabase/gamificare_lints.sql: adaugă politica
-- explicită doar-pentru-service_role, fără să schimbe comportamentul.
-- fără politici: liga se citește DOAR prin /api/gamificare (rolul de serviciu),
-- ca să putem afișa nume prescurtate („Ana M.") în loc de numele complete.

-- ─── 5. Înscrierea în ligă, atomică (evită două cohorte create simultan) ─────
create or replace function public.league_join(p_user uuid, p_week date, p_tier smallint, p_size integer default 30)
returns public.league_standings
language plpgsql
security definer
set search_path = public
as $$
declare
  v_season public.league_seasons;
  v_row    public.league_standings;
  v_cohort integer;
begin
  -- sezonul săptămânii (creat la prima înscriere). `do update` în loc de
  -- `do nothing`: cu `do nothing`, un rând inserat de o tranzacție concurentă
  -- încă necomisă nu s-ar vedea la select → v_season NULL → insert eșuat.
  insert into public.league_seasons (week_start) values (p_week)
    on conflict (week_start) do update set week_start = excluded.week_start
    returning * into v_season;

  select * into v_row from public.league_standings
    where season_id = v_season.id and user_id = p_user;
  if found then
    -- Cazul „am deschis Arena luni la 00:30, înainte ca cronul de la 03:00 să
    -- fi făcut promovările": rândul s-a creat cu divizia veche. Cât timp n-are
    -- niciun punct, îl mutăm în divizia corectă (altfel elevul ar juca toată
    -- săptămâna în liga din care tocmai a promovat).
    if not (v_row.points = 0 and v_row.tier <> p_tier) then
      return v_row;
    end if;
    delete from public.league_standings where id = v_row.id;
  end if;

  -- prima cohortă neplină din divizie; dacă toate sunt pline → una nouă
  select s.cohort into v_cohort
    from public.league_standings s
    where s.season_id = v_season.id and s.tier = p_tier
    group by s.cohort
    having count(*) < p_size
    order by s.cohort
    limit 1;
  if v_cohort is null then
    select coalesce(max(s.cohort), 0) + 1 into v_cohort
      from public.league_standings s
      where s.season_id = v_season.id and s.tier = p_tier;
  end if;

  insert into public.league_standings (season_id, user_id, tier, cohort)
    values (v_season.id, p_user, p_tier, v_cohort)
    on conflict (season_id, user_id) do nothing;

  select * into v_row from public.league_standings
    where season_id = v_season.id and user_id = p_user;
  return v_row;
end;
$$;

-- o apelează DOAR rolul de serviciu (API-ul), ca funcțiile RAG din ai_rag_v2.sql
revoke all on function public.league_join(uuid, date, smallint, integer) from public, anon, authenticated;
grant execute on function public.league_join(uuid, date, smallint, integer) to service_role;

-- ─── 6. Incrementări ATOMICE (două exerciții trimise în același timp nu
--        trebuie să piardă XP printr-un citește-modifică-scrie) ─────────────
create or replace function public.xp_bump(p_user uuid, p_xp integer, p_coins integer default 0)
returns public.user_stats
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.user_stats;
begin
  insert into public.user_stats (user_id, total_xp, coins)
    values (p_user, greatest(0, p_xp), greatest(0, p_coins))
    on conflict (user_id) do update
      set total_xp = public.user_stats.total_xp + greatest(0, p_xp),
          coins    = public.user_stats.coins    + greatest(0, p_coins),
          updated_at = now()
    returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.league_add(p_standing uuid, p_points integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_pts integer;
begin
  update public.league_standings
     set points = points + greatest(0, p_points), updated_at = now()
   where id = p_standing
   returning points into v_pts;
  return coalesce(v_pts, 0);
end;
$$;

revoke all on function public.xp_bump(uuid, integer, integer) from public, anon, authenticated;
revoke all on function public.league_add(uuid, integer) from public, anon, authenticated;
grant execute on function public.xp_bump(uuid, integer, integer) to service_role;
grant execute on function public.league_add(uuid, integer) to service_role;

-- ─── 7. Verificare rapidă ───────────────────────────────────────────────────
-- select * from public.user_stats where user_id = auth.uid();
-- select * from public.league_standings order by points desc limit 20;
