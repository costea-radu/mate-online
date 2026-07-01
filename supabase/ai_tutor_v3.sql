-- =====================================================================
-- ExamenMate · Profesor Virtual — completare v3
-- Notificări (ex: alertă când un elev stagnează la un subiect)
-- Rulează DUPĂ ai_tutor_schema.sql și ai_tutor_v2.sql. Idempotent.
-- =====================================================================

create table if not exists public.ai_notifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid references auth.users(id) on delete cascade not null,
  type         text not null default 'info',     -- 'stagnation' | 'info' | ...
  title        text not null,
  body         text,
  data         jsonb not null default '{}'::jsonb, -- {studentId, topic, mastery, ...}
  dedupe_key   text,                                -- evită alerte repetate
  read         boolean not null default false,
  created_at   timestamptz default now()
);
create index if not exists idx_ainotif_recipient on public.ai_notifications(recipient_id, read, created_at desc);
create index if not exists idx_ainotif_dedupe    on public.ai_notifications(recipient_id, dedupe_key);

alter table public.ai_notifications enable row level security;

do $$ begin
  -- Destinatarul își vede și își marchează notificările; serverul are acces complet.
  if not exists (select 1 from pg_policies where tablename='ai_notifications' and policyname='notif_own_read') then
    create policy "notif_own_read" on public.ai_notifications for select
      using (auth.uid() = recipient_id or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_notifications' and policyname='notif_own_update') then
    create policy "notif_own_update" on public.ai_notifications for update
      using (auth.uid() = recipient_id or auth.role() = 'service_role')
      with check (auth.uid() = recipient_id or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_notifications' and policyname='notif_service_insert') then
    create policy "notif_service_insert" on public.ai_notifications for insert
      with check (auth.role() = 'service_role');
  end if;
end $$;
