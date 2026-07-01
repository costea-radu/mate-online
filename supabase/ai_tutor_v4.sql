-- =====================================================================
-- ExamenMate · Profesor Virtual — completare v4
-- Biblioteca personală: exercițiile/testele generate cu AI de un abonat,
-- salvate DOAR pentru el (nu public). Include punctajul.
-- Rulează DUPĂ ai_tutor_schema.sql, v2 și v3. Idempotent.
-- =====================================================================

create table if not exists public.ai_personal_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  kind         text not null check (kind in ('interactive', 'exam', 'practice')),
  title        text,
  category     text,
  topic        text,
  payload      jsonb not null default '{}'::jsonb,   -- {html} | {exam} | {statement, solution, ...}
  score        int,
  max_score    int,
  completed_at timestamptz,
  created_at   timestamptz default now()
);
create index if not exists idx_aipers_user on public.ai_personal_items(user_id, created_at desc);
create index if not exists idx_aipers_kind on public.ai_personal_items(user_id, kind);

alter table public.ai_personal_items enable row level security;

-- Fiecare utilizator vede/creează/modifică/șterge DOAR propriile elemente.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_personal_items' and policyname='pers_own_all') then
    create policy "pers_own_all" on public.ai_personal_items for all
      using (auth.uid() = user_id or auth.role() = 'service_role')
      with check (auth.uid() = user_id or auth.role() = 'service_role');
  end if;
end $$;
