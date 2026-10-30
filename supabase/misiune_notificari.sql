-- =====================================================================
-- ExamenMate · NOTIFICAREA MISIUNII ZILNICE (Arena matematică, 30 oct. 2026)
--
-- Elevul pornește din cardul „🎯 Misiunea zilnică" „🔔 Amintește-mi" și își
-- alege ora (8:00–21:00, implicit 17:00). Cronul de la fiecare oră
-- (/api/gamificare?action=cron-misiune) îi trimite amintirea DOAR în zilele în
-- care misiunea nu e încă îndeplinită — Web Push (și cu site-ul închis) sau, fără
-- notificări în browser, în clopoțelul din site. Seara (20:00) cine are o serie
-- de cel puțin 2 zile primește „🔥 Seria ta se pierde la noapte".
--
--   user_stats.mission_notify              — true = pornită, false = oprită,
--                                            NULL = elevul n-a ales încă
--   user_stats.mission_notify_hour         — ora aleasă (ora României)
--   user_stats.mission_notified_on         — ziua ultimei amintiri (o dată pe zi)
--   user_stats.mission_streak_notified_on  — ziua ultimei alerte de serie
--   push_subscriptions                     — abonările Web Push (aceeași tabelă ca
--                                            la „lecția e gata" din meditațiile live;
--                                            dacă ai rulat notificari_lectii.sql,
--                                            blocul de mai jos nu schimbă nimic)
--
-- Scrie doar serverul (api/gamificare.js, rolul de serviciu); elevul își citește
-- rândul din user_stats (politica existentă „stats: select own").
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- =====================================================================

-- ─── 1. Preferințele amintirii, în user_stats ────────────────────────────────
alter table public.user_stats add column if not exists mission_notify boolean;
alter table public.user_stats add column if not exists mission_notify_hour smallint not null default 17;
alter table public.user_stats add column if not exists mission_notified_on date;
alter table public.user_stats add column if not exists mission_streak_notified_on date;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'user_stats_mission_notify_hour_chk') then
    alter table public.user_stats add constraint user_stats_mission_notify_hour_chk
      check (mission_notify_hour between 0 and 23);
  end if;
end $$;

comment on column public.user_stats.mission_notify is
  'Amintirea zilnică a misiunii: true = pornită, false = oprită, NULL = încă nealeasă.';
comment on column public.user_stats.mission_notify_hour is
  'Ora amintirii misiunii zilnice (ora României, 8–21).';

-- cronul de la fiecare oră citește doar elevii cu amintirea pornită
create index if not exists idx_user_stats_mission_notify
  on public.user_stats(mission_notify_hour) where mission_notify is true;

-- ─── 2. Abonările Web Push (identic cu supabase/notificari_lectii.sql) ───────
create table if not exists public.push_subscriptions (
  endpoint    text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fails       int not null default 0
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
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'push_subscriptions' and policyname = 'push_subscriptions_own') then
    create policy push_subscriptions_own on public.push_subscriptions for all to authenticated
      using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
  end if;
end $$;

-- Verificare rapidă:
-- select user_id, mission_category, mission_notify, mission_notify_hour, mission_notified_on
--   from public.user_stats where mission_notify is true order by mission_notify_hour;
