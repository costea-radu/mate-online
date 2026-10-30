-- =====================================================================
-- ExamenMate · GAMIFICARE v8 — MISIUNEA ZILNICĂ (Arena matematică, 30 oct. 2026)
--
-- Ca la Duolingo: UN exercițiu pe zi. Elevul își alege clasa (a V-a … a XII-a),
-- iar în fiecare zi primește următorul exercițiu INTERACTIV din site al clasei
-- (în ordinea din site — „drumul clasei"). Misiunea e îndeplinită când îl
-- rezolvă (scorul salvat și verificat de api/ai-score.js, minimum 50%); poate
-- reîncerca de câte ori vrea în aceeași zi. Progresul: zilele la rând cu
-- misiunea îndeplinită, săptămâna, totalul și cât a parcurs din drumul clasei.
--
--   daily_exercises          — un rând pe elev pe zi: clasa, exercițiul zilei,
--                              încercările, cel mai bun procent, recompensa
--   user_stats.mission_category — clasa aleasă (clasa-5 … clasa-12)
--
-- Toate citirile și scrierile trec prin server (api/gamificare.js,
-- api/ai-score.js — rolul de serviciu); elevul își poate citi doar rândurile lui.
-- Rulează DUPĂ gamificare_v2.sql, în Supabase → SQL Editor → New Query → Run.
-- Idempotent: se poate rula de mai multe ori.
-- =====================================================================

-- ─── 1. Misiunea fiecărei zile ───────────────────────────────────────────────
create table if not exists public.daily_exercises (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  day           date not null,                          -- ziua (Europa/București)
  category      text not null,                          -- clasa-5 … clasa-12 (sau EN / BAC, ca rezervă)
  content_id    uuid references public.content(id) on delete set null,
  content_title text,                                   -- titlul, păstrat și dacă exercițiul se șterge
  status        text not null default 'deschis'
                check (status in ('deschis', 'indeplinit')),
  attempts      integer not null default 0,             -- încercări trimise azi la exercițiul zilei
  best_pct      integer,                                -- cel mai bun procent de azi
  xp            integer not null default 0,             -- recompensa misiunii (XP)
  created_at    timestamptz not null default now(),
  done_at       timestamptz,
  unique (user_id, day)
);
alter table public.daily_exercises enable row level security;

grant select, insert, update, delete on public.daily_exercises to authenticated;
grant select, insert, update, delete on public.daily_exercises to service_role;

create index if not exists idx_daily_exercises_user_day on public.daily_exercises(user_id, day desc);

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'daily_exercises' and policyname = 'daily_exercises_service') then
    create policy daily_exercises_service on public.daily_exercises for all to service_role
      using (true) with check (true);
  end if;
  -- elevul își vede doar misiunile lui; scrie DOAR serverul (fără insert/update de pe client)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'daily_exercises' and policyname = 'daily_exercises_own_select') then
    create policy daily_exercises_own_select on public.daily_exercises for select to authenticated
      using (user_id = (select auth.uid()));
  end if;
end $$;

-- ─── 2. Clasa aleasă pentru misiune ──────────────────────────────────────────
alter table public.user_stats add column if not exists mission_category text;
comment on column public.user_stats.mission_category is
  'Clasa aleasă în Arena pentru misiunea zilnică (clasa-5 … clasa-12). NULL = încă nealeasă.';

-- Verificare rapidă:
-- select day, category, content_title, status, attempts, best_pct, xp
--   from public.daily_exercises order by day desc limit 20;
