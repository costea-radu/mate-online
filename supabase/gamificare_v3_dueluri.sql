-- =====================================================================
-- ExamenMate · GAMIFICARE v3 — DUELURI 1-la-1 (pasul 3)
-- Rulează DUPĂ supabase/gamificare_v2.sql. Idempotent.
--
-- Duelul e ASINCRON: cei doi elevi primesc același test interactiv și au
-- 48 de ore să-l rezolve, fiecare când poate. Câștigă punctajul; la egalitate,
-- timpul. Un duel „live" ar cere ca amândoi să fie online simultan — ceea ce
-- se întâmplă rar și ar exclude jumătate din elevi.
--
-- Scrierile se fac DOAR de pe server (api/_lib/duel.js, rol de serviciu).
-- =====================================================================

-- Elevul poate opri provocările („nu accept dueluri acum")
alter table public.user_stats add column if not exists duels_open boolean not null default true;

create table if not exists public.duels (
  id             uuid primary key default gen_random_uuid(),
  challenger_id  uuid not null references auth.users(id) on delete cascade,
  opponent_id    uuid not null references auth.users(id) on delete cascade,
  content_id     uuid not null references public.content(id) on delete cascade,
  content_title  text,                       -- snapshot, rămâne lizibil dacă materialul dispare
  status         text not null default 'invitat'
                 check (status in ('invitat', 'activ', 'terminat', 'refuzat', 'expirat')),
  deadline       timestamptz,                -- 48h de la acceptare (sau de la invitație, cât e „invitat")
  -- rezultatele, scrise doar din api/ai-score.js (scor verificat pe server)
  -- `*_started_at` se pune la prima deschidere a exercițiului cu ?duel=… , iar
  -- `*_sec` se CALCULEAZĂ din el pe server: dacă am fi crezut durata trimisă de
  -- browser, orice elev ar fi câștigat egalitățile cu „am terminat în 1 secundă".
  challenger_score int, challenger_max int, challenger_sec int, challenger_at timestamptz, challenger_started_at timestamptz,
  opponent_score   int, opponent_max   int, opponent_sec   int, opponent_at   timestamptz, opponent_started_at   timestamptz,
  winner_id      uuid references auth.users(id) on delete set null,  -- null = egalitate sau neterminat
  result         text check (result in ('victorie', 'egalitate', 'neprezentare')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (challenger_id <> opponent_id)
);

create index if not exists idx_duels_challenger on public.duels(challenger_id, status);
create index if not exists idx_duels_opponent   on public.duels(opponent_id, status);
create index if not exists idx_duels_deadline   on public.duels(status, deadline);

-- O singură provocare NEÎNCHEIATĂ între aceiași doi elevi (în orice sens):
-- altfel se poate „bombarda" un coleg cu zeci de dueluri.
create unique index if not exists uq_duels_activ
  on public.duels(least(challenger_id, opponent_id), greatest(challenger_id, opponent_id))
  where status in ('invitat', 'activ');

-- pentru bazele create înainte de măsurarea timpului pe server
alter table public.duels add column if not exists challenger_started_at timestamptz;
alter table public.duels add column if not exists opponent_started_at   timestamptz;

alter table public.duels enable row level security;
-- (vezi supabase/gamificare_lints.sql pentru politica explicită service_role,
--  care închide avertismentul INFO al linterului Supabase)
-- Fără politici: totul trece prin /api/duel (service_role). Elevul nu trebuie
-- să vadă scorul adversarului înainte să-l trimită pe al lui — filtrarea aceea
-- se face în API, nu s-ar putea exprima printr-o politică RLS.

-- Verificare rapidă:
-- select status, count(*) from public.duels group by status;
