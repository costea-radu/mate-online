-- =====================================================================
-- ExamenMate · Profesor Virtual — completare v2
-- (feedback pe mesaje, pentru îmbunătățire continuă)
-- Rulează DUPĂ ai_tutor_schema.sql. Idempotent.
-- =====================================================================

create table if not exists public.ai_feedback (
  id          uuid primary key default gen_random_uuid(),
  message_id  uuid references public.ai_messages(id) on delete cascade not null,
  user_id     uuid references auth.users(id) on delete cascade not null,
  value       int  not null check (value in (-1, 1)),   -- 👎 / 👍
  note        text,
  created_at  timestamptz default now(),
  unique (message_id, user_id)
);
create index if not exists idx_aifb_message on public.ai_feedback(message_id);
create index if not exists idx_aifb_value   on public.ai_feedback(value);

alter table public.ai_feedback enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_feedback' and policyname='fb_own') then
    create policy "fb_own" on public.ai_feedback for all
      using (auth.uid() = user_id or auth.role() = 'service_role')
      with check (auth.uid() = user_id or auth.role() = 'service_role');
  end if;
end $$;
