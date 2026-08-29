-- =====================================================================
-- ExamenMate · GAMIFICARE v5 — HARTA CAPITOLELOR (pasul 5)
-- Rulează DUPĂ gamificare_v2.sql. Idempotent.
--
-- Harta = capitolele programei, în ordine, cu deblocare pe bază de
-- STĂPÂNIRE (nu de număr de exerciții rezolvate). Stăpânirea se calculează
-- din `progress`, deci nu dublăm datele; aici ținem doar STAREA care nu se
-- poate deduce: capitolele sărite manual și premiile deja acordate.
-- =====================================================================

-- Capitolul unui material (id din CURRICULUM: 'c7-ecuatii' etc.).
-- Se completează automat, prin clasificare (api/_lib/taxonomy.js), la prima
-- deschidere a hărții; administratorul îl poate corecta manual oricând.
alter table public.content add column if not exists chapter_id text;
create index if not exists idx_content_chapter on public.content(chapter_id);
comment on column public.content.chapter_id is
  'Capitolul din programă (CURRICULUM). Completat automat de /api/harta; poate fi corectat manual.';

create table if not exists public.chapter_state (
  user_id     uuid not null references auth.users(id) on delete cascade,
  chapter_id  text not null,
  unlocked    boolean not null default false,   -- „știu deja, sar peste"
  mastered_at timestamptz,                      -- când a fost stăpânit
  awarded     boolean not null default false,   -- bonusul de stăpânire a fost dat
  updated_at  timestamptz not null default now(),
  primary key (user_id, chapter_id)
);
create index if not exists idx_chapter_state_user on public.chapter_state(user_id);

alter table public.chapter_state enable row level security;
drop policy if exists "harta: select own" on public.chapter_state;
create policy "harta: select own" on public.chapter_state for select using (auth.uid() = user_id);
-- scrierea doar prin /api/harta (service_role)

-- Verificare rapidă:
-- select chapter_id, count(*) from public.content where chapter_id is not null group by 1 order by 2 desc;
