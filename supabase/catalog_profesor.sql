-- =====================================================================
-- ExamenMate · CATALOGUL PROFESORULUI — note, plusuri, minusuri, aprecieri
-- (11 noiembrie 2026)
--
-- Cererea: „fă ca profesorii să poată da note elevilor, plusuri, minusuri,
-- aprecieri".
--
--   teacher_marks — un rând pe ce a dat profesorul unui elev asociat lui:
--     kind = 'nota'      → value (1–10), title (pentru ce: lucrare, răspuns oral…)
--     kind = 'plus'      → title (pentru ce), opțional
--     kind = 'minus'     → title (pentru ce), opțional
--     kind = 'apreciere' → comment (textul aprecierii)
--
-- Cine vede: profesorul (ce a dat el), elevul (ce a primit) și părinții elevului
-- (asociați lui în mentor_students cu rolul 'parinte'). Scrie DOAR serverul
-- (api/teacher-manage.js → add_mark / delete_mark, rolul de serviciu), după ce
-- verifică asocierea profesor ↔ elev. Notele intră în mediile profesorului
-- („🔒 Încheie media", ca restul notelor din „Grupe / Rezultate elevi").
--
-- Rulează DUPĂ groups_parents_schema.sql, în Supabase → SQL Editor → New Query
-- → Run. Idempotent: se poate rula de mai multe ori.
-- =====================================================================

create table if not exists public.teacher_marks (
  id           uuid primary key default gen_random_uuid(),
  teacher_id   uuid references auth.users(id) on delete cascade not null,
  teacher_name text,                                   -- numele profesorului, la momentul notei
  student_id   uuid references auth.users(id) on delete cascade not null,
  group_id     uuid references public.mentor_groups(id) on delete set null,
  kind         text not null check (kind in ('nota', 'plus', 'minus', 'apreciere')),
  value        numeric(4,2) check (value is null or (value >= 1 and value <= 10)),
  title        text check (title is null or char_length(title) <= 120),
  comment      text check (comment is null or char_length(comment) <= 600),
  created_at   timestamptz not null default now(),
  constraint teacher_marks_nota_are_valoare check (kind <> 'nota' or value is not null),
  constraint teacher_marks_apreciere_are_text check (kind <> 'apreciere' or comment is not null)
);

alter table public.teacher_marks enable row level security;

grant select, insert, update, delete on public.teacher_marks to authenticated;
grant select, insert, update, delete on public.teacher_marks to service_role;

create index if not exists idx_teacher_marks_teacher on public.teacher_marks(teacher_id, created_at desc);
create index if not exists idx_teacher_marks_student on public.teacher_marks(student_id, created_at desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Citirea: profesorul care a dat-o, elevul care a primit-o, părinții elevului.
-- Scrierile: doar rolul de serviciu (API-ul) — nicio politică de scriere pentru
-- `authenticated`, deci browserul nu poate adăuga, schimba sau șterge note.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'teacher_marks' and policyname = 'teacher_marks_read') then
    create policy "teacher_marks_read" on public.teacher_marks for select to authenticated
      using (
        (select auth.uid()) = teacher_id
        or (select auth.uid()) = student_id
        or exists (
          select 1 from public.mentor_students ms
          where ms.mentor_id = (select auth.uid())
            and ms.mentor_role = 'parinte'
            and ms.student_id = teacher_marks.student_id
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'teacher_marks' and policyname = 'teacher_marks_service') then
    create policy "teacher_marks_service" on public.teacher_marks for all to service_role
      using (true) with check (true);
  end if;
end $$;

-- ── Verificare (opțional) ────────────────────────────────────────────────────
-- select kind, count(*) from public.teacher_marks group by kind;
-- select * from public.teacher_marks order by created_at desc limit 20;
