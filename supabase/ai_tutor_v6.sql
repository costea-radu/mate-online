-- =====================================================================
-- ExamenMate · Profesor Virtual — completare v6
-- Teme trimise de profesor elevilor:
--   • ai_assignments        → exercițiul trimis (interactiv sau de antrenament)
--   • ai_assignment_results → rezultatul fiecărui elev la temă
-- Rulează DUPĂ v1–v5. Idempotent.
-- =====================================================================

create table if not exists public.ai_assignments (
  id           uuid primary key default gen_random_uuid(),
  created_by   uuid references auth.users(id) on delete cascade not null,
  creator_name text,
  kind         text not null check (kind in ('interactive', 'practice')),
  title        text,
  category     text,
  topic        text,
  payload      jsonb not null default '{}'::jsonb,  -- interactive: {html}; practice: {statement, options, answer, answer_type, solution, hints}
  created_at   timestamptz default now()
);
create index if not exists idx_aiassign_creator on public.ai_assignments(created_by, created_at desc);

create table if not exists public.ai_assignment_results (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.ai_assignments(id) on delete cascade not null,
  student_id    uuid references auth.users(id) on delete cascade not null,
  score         int,
  max_score     int,
  attempts      int default 1,
  completed_at  timestamptz default now(),
  created_at    timestamptz default now(),
  unique (assignment_id, student_id)
);
create index if not exists idx_aires_assignment on public.ai_assignment_results(assignment_id);
create index if not exists idx_aires_student on public.ai_assignment_results(student_id);

alter table public.ai_assignments enable row level security;
alter table public.ai_assignment_results enable row level security;

do $$ begin
  -- Profesorul-creator își vede temele; serviciul (endpoint) are acces complet.
  if not exists (select 1 from pg_policies where tablename='ai_assignments' and policyname='assign_creator_read') then
    create policy "assign_creator_read" on public.ai_assignments for select
      using (auth.uid() = created_by or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_assignments' and policyname='assign_service_write') then
    create policy "assign_service_write" on public.ai_assignments for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  -- Rezultatele: le vede creatorul temei sau elevul respectiv; scrise doar de serviciu.
  if not exists (select 1 from pg_policies where tablename='ai_assignment_results' and policyname='ires_read') then
    create policy "ires_read" on public.ai_assignment_results for select
      using (
        auth.uid() = student_id
        or auth.role() = 'service_role'
        or exists (select 1 from public.ai_assignments a where a.id = assignment_id and a.created_by = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_assignment_results' and policyname='ires_service_write') then
    create policy "ires_service_write" on public.ai_assignment_results for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;
