-- =====================================================================
-- ExamenMate · MEDITAȚII LIVE — notificarea „lecția e gata" și botul care
-- verifică lecțiile (26 octombrie 2026)
--
--   push_subscriptions — abonările Web Push ale elevilor (un rând = un browser /
--                        un telefon / aplicația ExamenMate): notificarea „✅ Prof.
--                        Tudor e gata — intră" ajunge și cu pagina închisă
--   live_participants  — + notify_at (elevul a apăsat „🔔 Anunță-mă când e gata")
--                        și notified_at (a primit notificarea — o singură dată)
--   live_lesson_qa     — raportul botului de verificare pentru fiecare lecție:
--                        sunetul (vocea fiecărei fraze, fișierele din Storage),
--                        întrebările la exerciții, itemii (Admin → 🎥 Meditații live
--                        → „🤖 Botul de verificare"). Separat de live_lessons, ca o
--                        verificare să nu schimbe updated_at-ul lecției.
--
-- Cheile VAPID ale notificărilor: VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY în Vercel
-- (opțional) — fără ele, serverul le generează o singură dată și le păstrează în
-- app_settings ('web_push_vapid'; tabela din setari_ordine_gratuite.sql, citită
-- doar de server).
--
-- Toate citirile și scrierile trec prin server (api/live.js, service role).
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- =====================================================================

-- ─── 1. Abonările Web Push ───────────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  endpoint    text primary key,                 -- adresa serviciului de push al browserului
  user_id     uuid not null references auth.users(id) on delete cascade,
  p256dh      text not null,                    -- cheia publică a browserului
  auth        text not null,                    -- secretul de autentificare
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,                      -- ultima notificare trimisă cu succes
  fails       int not null default 0            -- eșecuri la rând (după 8, abonarea se șterge)
);
alter table public.push_subscriptions enable row level security;

grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;

create index if not exists idx_push_subscriptions_user on public.push_subscriptions(user_id, created_at desc);

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_service') then
    create policy push_subscriptions_service on public.push_subscriptions for all to service_role
      using (true) with check (true);
  end if;
  -- elevul își vede / își șterge doar abonările lui (site-ul oricum trece prin server)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_own') then
    create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;

-- ─── 2. Cererea de notificare, pe ședință ────────────────────────────────────
alter table public.live_participants add column if not exists notify_at   timestamptz;
alter table public.live_participants add column if not exists notified_at timestamptz;

-- ─── 3. Rapoartele botului de verificare ─────────────────────────────────────
create table if not exists public.live_lesson_qa (
  lesson_id   uuid primary key references public.live_lessons(id) on delete cascade,
  report      jsonb not null default '{}'::jsonb,   -- problemele, sunetul, întrebările, itemii
  stamp       text,                                  -- „amprenta" lecției verificate
  ok          boolean,
  score       int,
  checked_at  timestamptz not null default now()
);
alter table public.live_lesson_qa enable row level security;

grant select, insert, update, delete on public.live_lesson_qa to authenticated;
grant select, insert, update, delete on public.live_lesson_qa to service_role;

create index if not exists idx_live_lesson_qa_ok on public.live_lesson_qa(ok, checked_at desc);

do $$
begin
  -- doar serverul (Admin trece prin api/live.js); elevii nu văd rapoartele
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'live_lesson_qa' and policyname = 'live_lesson_qa_service') then
    create policy live_lesson_qa_service on public.live_lesson_qa for all to service_role
      using (true) with check (true);
  end if;
end $$;
