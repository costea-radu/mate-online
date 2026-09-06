-- =====================================================================
-- ExamenMate · MEDIILE ÎNCHEIATE + TIMPUL DE LUCRU LA TESTUL PE GRUPĂ
--
-- 1. MEDII ÎNCHEIATE (`mentor_grade_periods`)
--    În „Contul meu" → „Grupe / Rezultate elevi", profesorul apasă
--    „🔒 Încheie media" lângă un elev (sau lângă grupă) și notele de până în
--    acel moment se închid într-o MEDIE salvată. Notele care vin după intră
--    automat într-o perioadă nouă, cu propriul buton de încheiere — ca în
--    catalog: media pe teză, apoi media următoare, și tot așa.
--
--    • scope = 'student' → media unui elev (student_id completat);
--    • scope = 'group'   → media grupei (group_id completat; null = toți elevii).
--    Perioada următoare începe exact de unde s-a încheiat cea dinainte
--    (`closed_at` al ultimei medii → `from_at` al celei noi).
--
-- 2. TIMPUL DE LUCRU la „Test pe grupă — fiecare elev primește alt test"
--    (`group_assignments.time_limit_min`): 10 minute … 3 ore. Când elevul
--    apasă „Începe testul", `group_assignment_picks.started_at` reține
--    momentul, iar `active_until` devine start + timpul ales (în loc de
--    fereastra fixă de 3 ore). La expirare testul se încheie singur și se
--    marchează cu `timed_out`.
--
-- Rulează în Supabase → SQL Editor → New Query. Idempotent.
-- =====================================================================

-- ─── 1. Mediile încheiate ────────────────────────────────────────────────────
create table if not exists public.mentor_grade_periods (
  id          uuid primary key default gen_random_uuid(),
  teacher_id  uuid references auth.users(id) on delete cascade not null,
  scope       text not null default 'student' check (scope in ('student', 'group')),
  student_id  uuid references auth.users(id) on delete cascade,   -- scope='student'
  group_id    uuid,                                               -- scope='group' (null = toți elevii); fără FK: grupa poate fi ștearsă
  group_name  text,                                               -- snapshot, rămâne lizibil după ștergerea grupei
  period_no   int  not null default 1,                            -- Media 1, Media 2, …
  from_at     timestamptz,                                        -- de unde începe perioada (null = de la prima notă)
  closed_at   timestamptz not null default now(),                 -- „până în momentul respectiv"
  average     numeric(4,2),                                       -- media notelor (1–10), 2 zecimale
  grades      int  not null default 0,                            -- câte note au intrat în medie
  students    int  not null default 0,                            -- câți elevi (doar la scope='group')
  details     jsonb,                                              -- {studenti:[{id,name,nota,note}]} pentru media pe grupă
  created_at  timestamptz default now()
);

create index if not exists idx_grade_periods_teacher
  on public.mentor_grade_periods(teacher_id, closed_at desc);
create index if not exists idx_grade_periods_student
  on public.mentor_grade_periods(teacher_id, student_id, closed_at desc)
  where student_id is not null;

alter table public.mentor_grade_periods enable row level security;

do $$ begin
  -- profesorul își vede mediile lui; scrierea trece prin /api (service_role)
  if not exists (select 1 from pg_policies where tablename='mentor_grade_periods' and policyname='grade_periods_read') then
    create policy "grade_periods_read" on public.mentor_grade_periods for select
      using (auth.uid() = teacher_id or auth.uid() = student_id or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='mentor_grade_periods' and policyname='grade_periods_service') then
    create policy "grade_periods_service" on public.mentor_grade_periods for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- ─── 2. Timpul de lucru la testul pe grupă ───────────────────────────────────
do $$ begin
  if to_regclass('public.group_assignments') is not null then
    -- minute de lucru: 10 … 180 (null = fără limită de timp)
    alter table public.group_assignments
      add column if not exists time_limit_min int;
  end if;

  if to_regclass('public.group_assignment_picks') is not null then
    -- momentul în care elevul a apăsat „Începe testul" (baza cronometrului)
    alter table public.group_assignment_picks
      add column if not exists started_at timestamptz;
    -- testul s-a încheiat pentru că a expirat timpul, nu pentru că a trimis elevul
    alter table public.group_assignment_picks
      add column if not exists timed_out boolean not null default false;
    -- `active_until` vine din supabase/mesagerie.sql; îl adăugăm și aici, ca
    -- fișierul să poată fi rulat singur pe o instalare mai veche
    alter table public.group_assignment_picks
      add column if not exists active_until timestamptz;
  end if;
end $$;

-- ─── Verificare (opțional) ───────────────────────────────────────────────────
-- select * from public.mentor_grade_periods order by closed_at desc;
-- select id, title, time_limit_min from public.group_assignments order by created_at desc;
