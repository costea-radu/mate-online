-- =====================================================================
-- ExamenMate · TEME PE GRUPĂ — un singur link, teste DIFERITE per elev
--
-- Profesorul trimite unei grupe un singur link (/tema-grupa?id=...).
-- Fiecare elev care îl deschide primește ALT test din „bazinul" temei:
--   • bazinul poate conține teste generate de profesor (ai_personal_items),
--     teste din Biblioteca utilizatorilor (ai_public_library) sau teste din
--     site (tabela content — „Examene" și „Clase");
--   • repartizarea e memorată, deci elevul primește mereu același test la
--     redeschiderea linkului;
--   • istoricul (group_test_history) face ca la temele URMĂTOARE din aceeași
--     grupă elevul să primească, pe cât posibil, un test pe care nu l-a mai
--     primit — până la epuizarea testelor, apoi se reia.
--
-- Rulează în Supabase → SQL Editor → New Query. Idempotent.
-- =====================================================================

-- ─── 1. Tema pe grupă (linkul) ───────────────────────────────────────────────
create table if not exists public.group_assignments (
  id             uuid primary key default gen_random_uuid(),
  created_by     uuid references auth.users(id) on delete cascade not null,
  creator_name   text,
  group_id       uuid references public.mentor_groups(id) on delete set null,
  group_name     text,                                   -- snapshot (rămâne lizibil după ștergerea grupei)
  title          text not null default 'Temă pe grupă',
  category       text,                                   -- clasa-5 … bacalaureat (null = mixt)
  format         text not null default 'interactive'
                 check (format in ('interactive', 'pdf')),
  pick_mode      text not null default 'auto'
                 check (pick_mode in ('auto', 'manual')), -- „mixt" = manual cu bifele pornite de la propunerea automată
  sources        text[] not null default array['site']::text[], -- 'personal' | 'public' | 'site'
  pool_size      int not null default 0,                 -- câte teste are bazinul
  premium_free   boolean not null default false,         -- DOAR admin: testele premium se dau gratuit
  due_at         timestamptz,
  created_at     timestamptz default now()
);
create index if not exists idx_gassign_creator on public.group_assignments(created_by, created_at desc);
create index if not exists idx_gassign_group   on public.group_assignments(group_id);

-- ─── 2. Bazinul de teste al temei ────────────────────────────────────────────
create table if not exists public.group_assignment_items (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.group_assignments(id) on delete cascade not null,
  source        text not null check (source in ('site', 'personal', 'public')),
  ref_id        uuid not null,          -- content.id | ai_personal_items.id | ai_public_library.id
  kind          text not null,          -- interactive | pdf | exam | practice
  title         text,
  category      text,
  is_free       boolean default true,
  position      int default 0,
  created_at    timestamptz default now(),
  unique (assignment_id, source, ref_id)
);
create index if not exists idx_gitems_assign on public.group_assignment_items(assignment_id, position);

-- ─── 3. Repartizarea: ce test a primit fiecare elev ──────────────────────────
create table if not exists public.group_assignment_picks (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid references public.group_assignments(id) on delete cascade not null,
  item_id       uuid references public.group_assignment_items(id) on delete cascade not null,
  student_id    uuid references auth.users(id) on delete cascade not null,
  score         int,
  max_score     int,
  attempts      int not null default 0,
  assigned_at   timestamptz default now(),
  opened_at     timestamptz,
  completed_at  timestamptz,
  unique (assignment_id, student_id)     -- un elev = un test per temă
);
create index if not exists idx_gpicks_assign  on public.group_assignment_picks(assignment_id);
create index if not exists idx_gpicks_student on public.group_assignment_picks(student_id);

-- ─── 4. Istoricul testelor primite (rotația între teme) ──────────────────────
-- Supraviețuiește ștergerii temei, ca rotația să nu se reseteze.
create table if not exists public.group_test_history (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid references auth.users(id) on delete cascade not null,
  group_id    uuid,                       -- fără FK: grupa poate fi ștearsă, istoricul rămâne
  student_id  uuid references auth.users(id) on delete cascade not null,
  source      text not null,
  ref_id      uuid not null,
  assigned_at timestamptz default now()
);
create index if not exists idx_ghist_lookup on public.group_test_history(teacher_id, student_id, group_id, assigned_at desc);

-- ─── 5. RLS ──────────────────────────────────────────────────────────────────
-- Scrierile trec DOAR prin /api/group-assignment (service_role, ocolește RLS).
-- Citirea: profesorul-creator își vede temele; elevul își vede repartizarea.
alter table public.group_assignments      enable row level security;
alter table public.group_assignment_items enable row level security;
alter table public.group_assignment_picks enable row level security;
alter table public.group_test_history     enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='group_assignments' and policyname='gassign_read') then
    create policy "gassign_read" on public.group_assignments for select
      using (auth.uid() = created_by or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='group_assignments' and policyname='gassign_service') then
    create policy "gassign_service" on public.group_assignments for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (select 1 from pg_policies where tablename='group_assignment_items' and policyname='gitems_read') then
    create policy "gitems_read" on public.group_assignment_items for select
      using (
        auth.role() = 'service_role'
        or exists (select 1 from public.group_assignments a where a.id = assignment_id and a.created_by = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where tablename='group_assignment_items' and policyname='gitems_service') then
    create policy "gitems_service" on public.group_assignment_items for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (select 1 from pg_policies where tablename='group_assignment_picks' and policyname='gpicks_read') then
    create policy "gpicks_read" on public.group_assignment_picks for select
      using (
        auth.uid() = student_id
        or auth.role() = 'service_role'
        or exists (select 1 from public.group_assignments a where a.id = assignment_id and a.created_by = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where tablename='group_assignment_picks' and policyname='gpicks_service') then
    create policy "gpicks_service" on public.group_assignment_picks for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (select 1 from pg_policies where tablename='group_test_history' and policyname='ghist_service') then
    create policy "ghist_service" on public.group_test_history for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- ── Verificare (opțional) ────────────────────────────────────────────────────
-- select * from public.group_assignments order by created_at desc;
-- select * from public.group_assignment_picks;
