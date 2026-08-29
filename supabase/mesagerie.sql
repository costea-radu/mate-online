-- =====================================================================
-- ExamenMate · MESAGERIE + COLEGI
--
-- Două lucruri DIFERITE, care folosesc aceleași mesaje:
--
-- 1. CANALUL GRUPEI — o singură conversație pentru toată grupa: profesorul
--    care a făcut grupa, elevii ei și părinții acelor elevi. Lângă fiecare
--    nume apare rolul în paranteză: (profesor) / (elev) / (părinte).
--    NU există discuții 1-la-1 pe baza grupei.
--
-- 2. COLEGII (pe tot site-ul) — ca la Facebook: oricine poate căuta pe
--    ORICINE, pe categorii (profesor → colegi/elevi/părinți; elev →
--    colegi/profesori/părinți; părinte → alți părinți/profesori/elevi),
--    trimite cerere, iar după ACCEPTARE cei doi pot discuta 1-la-1 oricând,
--    indiferent de grupă.
--
-- 3. În timpul unui TEST PE GRUPĂ, mesageria elevului se oprește automat
--    (coloana `active_until` de mai jos).
--
-- Apartenența la grupă NU se dublează nicăieri: se calculează la fiecare
-- cerere din mentor_groups + mentor_students (api/messages.js, service role).
--
-- Rulează în Supabase → SQL Editor → New Query. Idempotent.
-- =====================================================================

-- ─── 1. Conversațiile ────────────────────────────────────────────────────────
create table if not exists public.chat_threads (
  id              uuid primary key default gen_random_uuid(),
  kind            text not null default 'group' check (kind in ('group', 'direct')),
  group_id        uuid references public.mentor_groups(id) on delete cascade,
  teacher_id      uuid references auth.users(id) on delete cascade,  -- profesorul grupei
  member_a        uuid references auth.users(id) on delete cascade,  -- doar 'direct' (colegi)
  member_b        uuid references auth.users(id) on delete cascade,  -- doar 'direct' (colegi)
  title           text,
  last_message_at timestamptz,
  created_at      timestamptz default now()
);

-- un singur canal per grupă
create unique index if not exists uq_chat_thread_group
  on public.chat_threads(group_id) where kind = 'group';

-- o singură conversație privată per pereche de colegi (indiferent de ordine)
create unique index if not exists uq_chat_thread_direct
  on public.chat_threads(least(member_a, member_b), greatest(member_a, member_b))
  where kind = 'direct';

create index if not exists idx_chat_threads_teacher on public.chat_threads(teacher_id, last_message_at desc);
create index if not exists idx_chat_threads_a       on public.chat_threads(member_a);
create index if not exists idx_chat_threads_b       on public.chat_threads(member_b);

-- ─── 2. Mesajele ─────────────────────────────────────────────────────────────
create table if not exists public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  thread_id   uuid references public.chat_threads(id) on delete cascade not null,
  sender_id   uuid references auth.users(id) on delete cascade not null,
  sender_name text,                                  -- snapshot (rămâne lizibil după ștergerea contului)
  sender_role text,                                  -- 'profesor' | 'elev' | 'parinte'
  body        text,
  -- link atașat: { type:'tema'|'test', url:'/tema-elev?id=…', title:'…' }
  attachment  jsonb,
  created_at  timestamptz default now()
);
create index if not exists idx_chat_messages_thread on public.chat_messages(thread_id, created_at desc);

-- ─── 3. Ce a citit fiecare (pentru bulina de necitite) ───────────────────────
create table if not exists public.chat_reads (
  thread_id    uuid references public.chat_threads(id) on delete cascade not null,
  user_id      uuid references auth.users(id) on delete cascade not null,
  last_read_at timestamptz default now(),
  primary key (thread_id, user_id)
);

-- ─── 4. COLEGI (ca la Facebook: cerere → acceptare) ──────────────────────────
-- Între ORICE roluri: elev–profesor, elev–părinte, profesor–părinte, elev–elev…
-- `role` de mai jos = rolul CELUI CARE A TRIMIS cererea (rolul celuilalt se
-- citește din profilul lui, fiindcă acum pot fi diferite).
create table if not exists public.buddies (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid references auth.users(id) on delete cascade not null,
  addressee_id uuid references auth.users(id) on delete cascade not null,
  role         text not null check (role in ('elev', 'profesor', 'parinte')),
  status       text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at   timestamptz default now(),
  responded_at timestamptz,
  check (requester_id <> addressee_id)
);
-- o singură legătură per pereche, indiferent cine a cerut
create unique index if not exists uq_buddies_pair
  on public.buddies(least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index if not exists idx_buddies_req on public.buddies(requester_id, status);
create index if not exists idx_buddies_add on public.buddies(addressee_id, status);

-- Cine poate fi GĂSIT în căutarea de colegi. Se poate opri din „Colegii mei".
alter table public.profiles add column if not exists colegi_discoverable boolean not null default true;

-- ─── 5. Blocarea mesageriei în timpul unui TEST PE GRUPĂ ─────────────────────
-- Elevul apasă „Începe testul" → `active_until` = acum + 3 ore. Se șterge când
-- trimite rezultatul (sau când apasă „Am terminat testul"); expiră singură,
-- ca un test abandonat să nu blocheze mesageria la nesfârșit.
do $$ begin
  if to_regclass('public.group_assignment_picks') is not null then
    alter table public.group_assignment_picks add column if not exists active_until timestamptz;
    create index if not exists idx_gpicks_active
      on public.group_assignment_picks(student_id, active_until)
      where active_until is not null;
  end if;
end $$;

-- ─── 6. RLS ──────────────────────────────────────────────────────────────────
-- Totul trece prin /api/messages și /api/colegi (service_role, care ocolesc
-- RLS) — acolo se verifică apartenența la grupă și legătura de colegi.
-- Fără politici permisive = închis pentru anon.
alter table public.chat_threads  enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads    enable row level security;
alter table public.buddies       enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='chat_threads' and policyname='chat_threads_service') then
    create policy "chat_threads_service" on public.chat_threads for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='chat_messages' and policyname='chat_messages_service') then
    create policy "chat_messages_service" on public.chat_messages for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='chat_reads' and policyname='chat_reads_service') then
    create policy "chat_reads_service" on public.chat_reads for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='buddies' and policyname='buddies_read') then
    create policy "buddies_read" on public.buddies for select
      using (auth.uid() = requester_id or auth.uid() = addressee_id or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='buddies' and policyname='buddies_service') then
    create policy "buddies_service" on public.buddies for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- ── Verificare (opțional) ────────────────────────────────────────────────────
-- select * from public.chat_threads order by last_message_at desc nulls last;
-- select * from public.buddies where status = 'pending';
