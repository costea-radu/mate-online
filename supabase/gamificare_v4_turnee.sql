-- =====================================================================
-- ExamenMate · GAMIFICARE v4 — TURNEE DE GRUPĂ (pasul 4)
-- Rulează DUPĂ gamificare_v2.sql. Idempotent.
--
-- Un turneu = o grupă + un set de exerciții + o fereastră de timp.
-- Elevul NU se înscrie: dacă e în grupă și rezolvă un exercițiu din set în
-- perioada turneului, punctajul intră automat. Prima rezolvare contează
-- (altfel s-ar putea reface același exercițiu la nesfârșit).
--
-- „Provocarea profesorului" e același lucru cu un singur exercițiu în set.
-- =====================================================================

create table if not exists public.tournaments (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,   -- profesorul
  owner_name  text,
  group_id    uuid references public.mentor_groups(id) on delete set null,
  group_name  text,                                   -- snapshot
  title       text not null default 'Turneu',
  message     text,                                   -- „Cine ia primul 10/10?"
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz not null,
  status      text not null default 'activ' check (status in ('activ', 'incheiat')),
  awarded     boolean not null default false,         -- premiile de la final au fost date
  created_at  timestamptz not null default now()
);
create index if not exists idx_tournaments_group on public.tournaments(group_id, status);
create index if not exists idx_tournaments_open  on public.tournaments(status, ends_at);

-- Setul de exerciții (deocamdată doar materiale din site)
create table if not exists public.tournament_items (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  content_id    uuid not null references public.content(id) on delete cascade,
  title         text,
  position      int not null default 0,
  unique (tournament_id, content_id)
);
create index if not exists idx_titems_t on public.tournament_items(tournament_id, position);
-- căutarea „ce turnee conțin materialul X" (se face la fiecare scor salvat)
create index if not exists idx_titems_content on public.tournament_items(content_id);

-- Punctajele: un rând per elev per exercițiu, PRIMA rezolvare
create table if not exists public.tournament_scores (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  content_id    uuid not null references public.content(id) on delete cascade,
  points        int not null default 0,
  pct           int not null default 0,
  created_at    timestamptz not null default now(),
  unique (tournament_id, user_id, content_id)
);
create index if not exists idx_tscores_board on public.tournament_scores(tournament_id, user_id);

-- Clasamentul final (completat de cron la închidere)
create table if not exists public.tournament_places (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  place         int not null,
  points        int not null default 0,
  primary key (tournament_id, user_id)
);

-- (vezi supabase/gamificare_lints.sql pentru politicile explicite service_role,
--  care închid avertismentele INFO ale linterului Supabase)
alter table public.tournaments       enable row level security;
alter table public.tournament_items  enable row level security;
alter table public.tournament_scores enable row level security;
alter table public.tournament_places enable row level security;
-- Fără politici: totul trece prin /api/turneu (service_role), care verifică
-- apartenența la grupă. La fel ca `group_assignments` din teme_grupa.sql.

-- Verificare rapidă:
-- select t.title, count(s.*) from tournaments t
--   left join tournament_scores s on s.tournament_id = t.id group by t.title;
