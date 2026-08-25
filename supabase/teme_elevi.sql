-- =====================================================================
-- ExamenMate · TEME date de profesor — pe GRUPĂ sau pe ELEV, separat
--
-- Diferența față de „TEST pe grupă" (supabase/teme_grupa.sql):
--   • la TEST pe grupă fiecare elev primește ALT test dintr-un bazin;
--   • la TEMĂ toți elevii vizați primesc ACELAȘI set de exerciții — cele
--     bifate de profesor din butonul „dă temă" (lângă grupă sau lângă elev).
--
-- Tema poate fi:
--   • pe grupă  → group_id completat, student_id null (merge la toți elevii grupei);
--   • pe un elev → student_id completat (merge doar la el).
--
-- Exercițiile nerezolvate apar elevului în „📌 Teme nefăcute" (Contul meu).
--
-- Rulează în Supabase → SQL Editor → New Query. Idempotent.
-- =====================================================================

-- ─── 1. Tema ─────────────────────────────────────────────────────────────────
create table if not exists public.homework (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid references auth.users(id) on delete cascade not null,
  teacher_name text,
  group_id     uuid references public.mentor_groups(id) on delete set null,
  group_name   text,                                   -- snapshot lizibil după ștergerea grupei
  student_id   uuid references auth.users(id) on delete cascade,  -- null = toată grupa
  student_name text,
  title        text not null default 'Temă',
  note         text,                                   -- mesajul profesorului (opțional)
  due_at       timestamptz,
  created_at   timestamptz default now()
);
create index if not exists idx_homework_teacher on public.homework(teacher_id, created_at desc);
create index if not exists idx_homework_group   on public.homework(group_id);
create index if not exists idx_homework_student on public.homework(student_id);

-- ─── 2. Exercițiile temei (cele bifate de profesor) ──────────────────────────
create table if not exists public.homework_items (
  id          uuid primary key default gen_random_uuid(),
  homework_id uuid references public.homework(id) on delete cascade not null,
  source      text not null check (source in ('site', 'personal', 'public')),
  ref_id      uuid not null,        -- content.id | ai_personal_items.id | ai_public_library.id
  kind        text not null,        -- interactive | pdf | exam | practice
  title       text,
  category    text,
  is_free     boolean default true,
  position    int default 0,
  created_at  timestamptz default now(),
  unique (homework_id, source, ref_id)
);
create index if not exists idx_hwitems_hw on public.homework_items(homework_id, position);

-- ─── 3. Rezolvarea fiecărui exercițiu, de către fiecare elev ─────────────────
create table if not exists public.homework_progress (
  id           uuid primary key default gen_random_uuid(),
  homework_id  uuid references public.homework(id) on delete cascade not null,
  item_id      uuid references public.homework_items(id) on delete cascade not null,
  student_id   uuid references auth.users(id) on delete cascade not null,
  score        int,
  max_score    int,
  attempts     int not null default 0,
  opened_at    timestamptz,
  completed_at timestamptz,
  created_at   timestamptz default now(),
  unique (homework_id, item_id, student_id)
);
create index if not exists idx_hwprog_hw      on public.homework_progress(homework_id);
create index if not exists idx_hwprog_student on public.homework_progress(student_id);

-- ─── 4. Titlu editabil pentru linkurile de TEST pe grupă ─────────────────────
-- „Spațiu pentru alocare denumire" lângă linkul creat de profesor: titlul se
-- poate schimba oricând, fără să se strice linkul deja trimis.
alter table public.group_assignments add column if not exists renamed_at timestamptz;

-- ─── 5. RLS ──────────────────────────────────────────────────────────────────
-- Scrierile trec DOAR prin /api/homework (service_role, ocolește RLS).
-- Citirea: profesorul-creator își vede temele; elevul își vede rezolvările.
alter table public.homework          enable row level security;
alter table public.homework_items    enable row level security;
alter table public.homework_progress enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='homework' and policyname='hw_read') then
    create policy "hw_read" on public.homework for select
      using (auth.uid() = teacher_id or auth.uid() = student_id or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='homework' and policyname='hw_service') then
    create policy "hw_service" on public.homework for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (select 1 from pg_policies where tablename='homework_items' and policyname='hwitems_read') then
    create policy "hwitems_read" on public.homework_items for select
      using (
        auth.role() = 'service_role'
        or exists (select 1 from public.homework h where h.id = homework_id and (h.teacher_id = auth.uid() or h.student_id = auth.uid()))
      );
  end if;
  if not exists (select 1 from pg_policies where tablename='homework_items' and policyname='hwitems_service') then
    create policy "hwitems_service" on public.homework_items for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (select 1 from pg_policies where tablename='homework_progress' and policyname='hwprog_read') then
    create policy "hwprog_read" on public.homework_progress for select
      using (
        auth.uid() = student_id
        or auth.role() = 'service_role'
        or exists (select 1 from public.homework h where h.id = homework_id and h.teacher_id = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where tablename='homework_progress' and policyname='hwprog_service') then
    create policy "hwprog_service" on public.homework_progress for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- ── Verificare (opțional) ────────────────────────────────────────────────────
-- select * from public.homework order by created_at desc;
-- select * from public.homework_progress where completed_at is null;
