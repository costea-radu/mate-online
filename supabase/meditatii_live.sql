-- =====================================================================
-- ExamenMate · MEDITAȚII LIVE (sala de tip Zoom cu profesorii virtuali)
--
-- Ședințe zilnice de grup, la ore fixe (15–17, 17–19, 19–21), la care intră
-- oricâți elevi, plus ședințe 1-la-1 pornite oricând (60 de minute).
-- Profesorul explică DOAR subiecte de EN/BAC care au barem asociat.
--
--   live_sessions      — ședințele: de grup (zi + interval + profesor) sau 1-la-1
--   live_lessons       — lecția pregătită pe barem (scenele + vocea), refolosită
--                        la toate ședințele cu același subiect și profesor
--   live_participants  — cine a intrat (prezența) și pe ce drept (abonament / bilet)
--   live_messages      — chatul ședinței (elevi + răspunsurile profesorului)
--   live_poll_answers  — răspunsurile la întrebările puse de profesor
--   live_tickets       — biletele plătite: 10 lei (grup) / 20 lei (1-la-1)
--
-- Toate scrierile trec prin server (api/live.js, service role). Browserul
-- primește datele doar prin API, după verificarea dreptului de acces.
--
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- =====================================================================

-- ─── 1. Ședințele ────────────────────────────────────────────────────────────
create table if not exists public.live_sessions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null default 'grup' check (kind in ('grup', 'privat')),
  day         date,                 -- grup: ziua (ora României)
  slot        text,                 -- grup: '15' | '17' | '19'
  teacher     text not null,        -- id-ul profesorului virtual (ex. 'radu')
  exam        text,                 -- 'en' | 'bac'
  profile     text,                 -- profilul de BAC ('mate-info', 'stiinte-naturii', ...) sau null
  subject_id  uuid references public.content(id) on delete set null,  -- subiectul (PDF cu barem)
  lesson_id   uuid,                 -- live_lessons.id
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  owner_id    uuid references auth.users(id) on delete cascade,        -- 1-la-1: elevul
  access      text,                 -- 1-la-1: 'inclus' (din abonament) | 'bilet' | 'admin'
  status      text not null default 'programata'
                check (status in ('programata', 'activa', 'incheiata', 'anulata')),
  state       jsonb not null default '{}'::jsonb,   -- 1-la-1: unde a rămas lecția
  admin_note  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- o singură ședință de grup per zi + interval + profesor (la 1-la-1 day/slot
  -- sunt NULL, iar NULL-urile nu se ciocnesc într-o constrângere unique)
  constraint live_sessions_slot_uq unique (day, slot, teacher)
);
create index if not exists idx_live_sessions_starts on public.live_sessions(starts_at);
create index if not exists idx_live_sessions_owner  on public.live_sessions(owner_id, created_at desc);
create index if not exists idx_live_sessions_lesson on public.live_sessions(lesson_id);

-- ─── 2. Lecțiile pregătite (scenariul + vocea) ───────────────────────────────
create table if not exists public.live_lessons (
  id           uuid primary key default gen_random_uuid(),
  subject_id   uuid not null references public.content(id) on delete cascade,
  teacher      text not null,
  version      int  not null default 1,
  status       text not null default 'nou'
                 check (status in ('nou', 'script', 'audio', 'gata', 'eroare')),
  title        text,
  exam         text,
  profile      text,
  script       jsonb,               -- itemii explicați (fără audio)
  timeline     jsonb,               -- scenele cu durate, vocea și sincronizarea gurii
  duration_sec int,
  error        text,
  progress     jsonb not null default '{}'::jsonb,
  locked_until timestamptz,         -- lacăt de generare (două cereri nu generează de două ori)
  cost_micro   bigint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint live_lessons_uq unique (subject_id, teacher, version)
);
create index if not exists idx_live_lessons_status on public.live_lessons(status, updated_at desc);

-- ─── 3. Participanții (prezența) ─────────────────────────────────────────────
create table if not exists public.live_participants (
  session_id   uuid not null references public.live_sessions(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  display_name text,
  access       text,                -- 'abonament' | 'bilet' | 'admin' | 'proprietar'
  joined_at    timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  seconds      int not null default 0,  -- timp petrecut în sală (aprox.)
  primary key (session_id, user_id)
);
create index if not exists idx_live_participants_user on public.live_participants(user_id, joined_at desc);

-- ─── 4. Chatul ședinței ──────────────────────────────────────────────────────
create table if not exists public.live_messages (
  id          bigserial primary key,
  session_id  uuid not null references public.live_sessions(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete set null,  -- null = profesorul virtual
  author      text,
  role        text not null default 'elev' check (role in ('elev', 'profesor', 'sistem')),
  to_teacher  boolean not null default false,   -- întrebare privată către profesor
  text        text not null,
  reply_to    bigint,
  audio_url   text,                 -- răspunsul rostit de profesor
  audio_dur   real,
  lip         text,                 -- mișcarea gurii (25 cadre/s)
  hidden      boolean not null default false,  -- ascuns de moderare
  created_at  timestamptz not null default now()
);
create index if not exists idx_live_messages_session on public.live_messages(session_id, id);

-- ─── 5. Răspunsurile la întrebările profesorului ─────────────────────────────
create table if not exists public.live_poll_answers (
  session_id  uuid not null references public.live_sessions(id) on delete cascade,
  poll_id     text not null,
  user_id     uuid not null references auth.users(id) on delete cascade,
  answer      text not null,
  correct     boolean,
  created_at  timestamptz not null default now(),
  primary key (session_id, poll_id, user_id)
);

-- ─── 6. Biletele plătite ─────────────────────────────────────────────────────
create table if not exists public.live_tickets (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users(id) on delete cascade,
  kind              text not null check (kind in ('grup', 'privat')),
  session_id        uuid references public.live_sessions(id) on delete set null,  -- grup: ședința cumpărată; 1-la-1: unde s-a folosit
  price_bani        int,
  stripe_session_id text unique,
  status            text not null default 'platit' check (status in ('platit', 'folosit', 'rambursat')),
  created_at        timestamptz not null default now(),
  used_at           timestamptz
);
create index if not exists idx_live_tickets_user on public.live_tickets(user_id, status);

-- ─── 7. updated_at automat ───────────────────────────────────────────────────
create or replace function public.live_touch() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end$$ language plpgsql set search_path = public;

drop trigger if exists trg_live_sessions_touch on public.live_sessions;
create trigger trg_live_sessions_touch before update on public.live_sessions
  for each row execute function public.live_touch();
drop trigger if exists trg_live_lessons_touch on public.live_lessons;
create trigger trg_live_lessons_touch before update on public.live_lessons
  for each row execute function public.live_touch();

-- ─── 8. ROW LEVEL SECURITY — doar serverul citește și scrie ──────────────────
alter table public.live_sessions     enable row level security;
alter table public.live_lessons      enable row level security;
alter table public.live_participants enable row level security;
alter table public.live_messages     enable row level security;
alter table public.live_poll_answers enable row level security;
alter table public.live_tickets      enable row level security;

do $$
declare t text;
begin
  foreach t in array array['live_sessions','live_lessons','live_participants','live_messages','live_poll_answers','live_tickets'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_service') then
      execute format('create policy %I on public.%I for all using (auth.role() = ''service_role'') with check (auth.role() = ''service_role'')', t || '_service', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on sequence public.live_messages_id_seq from anon, authenticated;

-- ─── 9. Stocarea vocii (bucket public; căile conțin id-uri greu de ghicit) ───
insert into storage.buckets (id, name, public)
values ('live-media', 'live-media', true)
on conflict (id) do update set public = true;

-- ─── 10. Canalele în timp real „live:<id>" (Supabase Realtime, canale PRIVATE)
-- Cine e în sală (prezența: nume, mână ridicată, reacții) se vede în timp real.
-- Mesajele din chat și vocea profesorului le trimite DOAR serverul; un elev
-- nu poate „vorbi în numele profesorului". Doar participanții înregistrați
-- (cei care au intrat prin api/live.js) au acces la canalul ședinței.
--
-- Verificarea trece printr-o funcție SECURITY DEFINER: tabela live_participants
-- e închisă pentru browser (vezi pasul 8), deci politica nu o poate citi direct.
-- Funcția spune doar „utilizatorul curent e în această ședință?" — nimic altceva.
create or replace function public.live_can_access(topic text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.live_participants p
    where p.user_id = auth.uid()
      and 'live:' || p.session_id::text = topic
  );
$$;
revoke all on function public.live_can_access(text) from public, anon;
grant execute on function public.live_can_access(text) to authenticated;

do $$ begin
  if exists (select 1 from information_schema.tables where table_schema = 'realtime' and table_name = 'messages') then
    if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'live_participants_read') then
      create policy "live_participants_read" on realtime.messages for select to authenticated
        using (realtime.topic() like 'live:%' and public.live_can_access(realtime.topic()));
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'live_participants_presence') then
      create policy "live_participants_presence" on realtime.messages for insert to authenticated
        with check (
          realtime.messages.extension = 'presence'
          and realtime.topic() like 'live:%'
          and public.live_can_access(realtime.topic())
        );
    end if;
  end if;
end $$;

-- =====================================================================
-- GATA. Pașii următori (variabile de mediu, cron, cum schimbi programul):
-- vezi GHID_MEDITATII_LIVE.md.
-- =====================================================================
