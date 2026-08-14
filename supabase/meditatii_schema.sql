-- =====================================================================
-- ExamenMate · „Meditații cu Profesorul Virtual" — schema bazei de date
-- Rulează în Supabase → SQL Editor → New Query → Run.
-- Idempotent: se poate rula de mai multe ori în siguranță.
-- Rulează DUPĂ ai_tutor_schema.sql (folosește aceleași convenții).
-- =====================================================================

-- =====================================================================
-- 1. PROFILUL DE MEDITAȚII (unul per elev) — „memoria pedagogică"
--    Ține clasa, examenul-țintă, nivelul stabilit la evaluarea inițială,
--    planul personalizat de învățare și tot ce a învățat profesorul
--    virtual despre elev (stil de explicații preferat, greșeli repetate).
-- =====================================================================
create table if not exists public.ai_meditatii_profile (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  grade          int  not null check (grade between 5 and 12),
  exam_target    text check (exam_target is null or exam_target in
                   ('evaluare-nationala','bac-mate-info','bac-stiinte','bac-tehnologic')),
  level          text check (level is null or level in ('incepator','mediu','avansat')),
  assessment     jsonb not null default '{}'::jsonb,  -- rezultatul testului inițial {score, maxScore, gaps[], summary}
  plan           jsonb not null default '{}'::jsonb,  -- {chapters:[{id,title,status,mastery}], weeklyGoal, estWeeks}
  memory         jsonb not null default '{}'::jsonb,  -- memorie pedagogică {styles{}, errorTypes{}, notes[], lastChapter}
  streak_days    int  not null default 0,             -- zile consecutive de studiu
  last_study_date date,
  total_seconds  int  not null default 0,             -- timp total de studiu (secunde)
  focus          jsonb,                               -- pregătirea pentru lucrare/test {kind, chapter_ids[], custom, deadline}
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);

-- instalările mai vechi primesc coloana `focus` la re-rulare (idempotent);
-- vezi și supabase/meditatii_focus.sql (doar acest pas, separat)
alter table public.ai_meditatii_profile add column if not exists focus jsonb;

-- =====================================================================
-- 2. SESIUNILE DE MEDITAȚIE (jurnalul activității)
--    evaluare = testul inițial · lectie = teorie · exercitii = antrenament
--    remediere = „încă 10 de același fel" · recapitulare = repetiție
--    simulare = simulare de examen · tema = temă dată de profesor
-- =====================================================================
create table if not exists public.ai_meditatii_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  kind         text not null check (kind in
                 ('evaluare','lectie','exercitii','remediere','recapitulare','simulare','tema')),
  chapter      text,
  topic        text,
  difficulty   text,
  status       text not null default 'activa' check (status in ('activa','finalizata','abandonata')),
  payload      jsonb not null default '{}'::jsonb,   -- întrebările generate + răspunsuri + analiza greșelilor
  score        int,
  max_score    int,
  duration_sec int not null default 0,
  created_at   timestamptz default now(),
  completed_at timestamptz
);
create index if not exists idx_medsess_user on public.ai_meditatii_sessions(user_id, created_at desc);
create index if not exists idx_medsess_active on public.ai_meditatii_sessions(user_id, status) where status = 'activa';

-- =====================================================================
-- 3. TEMELE date de Profesorul Virtual
--    kind='content'     → material EXISTENT din site (content.id) — prioritar
--    kind='interactive' → set de întrebări generat (payload.questions)
--    kind='practice'    → un exercițiu de antrenament generat
-- =====================================================================
create table if not exists public.ai_meditatii_homework (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete cascade not null,
  kind         text not null check (kind in ('content','interactive','practice')),
  content_id   uuid,                                  -- pentru kind='content'
  title        text,
  chapter      text,
  topic        text,
  difficulty   text,
  payload      jsonb not null default '{}'::jsonb,
  status       text not null default 'data' check (status in ('data','rezolvata','expirata')),
  score        int,
  max_score    int,
  attempts     int not null default 0,
  feedback     jsonb not null default '{}'::jsonb,    -- corectarea + explicarea greșelilor
  assigned_at  timestamptz default now(),
  due_at       timestamptz,
  completed_at timestamptz
);
create index if not exists idx_medhw_user on public.ai_meditatii_homework(user_id, status, assigned_at desc);

-- =====================================================================
-- 4. JURNALUL GREȘELILOR (detectarea greșelilor tipice)
--    error_type: calcul | formula | concept | regula | neatentie | necunoscut
-- =====================================================================
create table if not exists public.ai_meditatii_mistakes (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid references auth.users(id) on delete cascade not null,
  chapter        text,
  topic          text,
  error_type     text not null default 'necunoscut' check (error_type in
                   ('calcul','formula','concept','regula','neatentie','necunoscut')),
  statement      text,
  student_answer text,
  correct_answer text,
  analysis       text,                                -- explicația profesorului: DE CE e greșit
  remediated     boolean not null default false,      -- a primit + rezolvat exerciții de remediere
  created_at     timestamptz default now()
);
create index if not exists idx_medmist_user on public.ai_meditatii_mistakes(user_id, created_at desc);
create index if not exists idx_medmist_open on public.ai_meditatii_mistakes(user_id, remediated) where remediated = false;

-- =====================================================================
-- 5. REPETIȚIA INTELIGENTĂ (spaced repetition pe capitole)
--    stage 0 → recapitulare după 1 zi; 1 → după 7 zile; 2 → după 30 zile.
--    Un rând per (elev, capitol); la fiecare recapitulare reușită stage
--    avansează și due_at se împinge mai departe.
-- =====================================================================
create table if not exists public.ai_meditatii_reviews (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  chapter    text not null,
  topic      text,
  stage      int  not null default 0 check (stage between 0 and 3),
  due_at     timestamptz not null,
  done_at    timestamptz,                             -- ultima recapitulare finalizată
  created_at timestamptz default now(),
  unique (user_id, chapter)
);
create index if not exists idx_medrev_due on public.ai_meditatii_reviews(user_id, due_at) where done_at is null or stage < 3;

-- =====================================================================
-- 6. updated_at automat pe profil
-- =====================================================================
-- search_path fixat chiar în definiție: lint-ul „Function Search Path Mutable"
-- revenea pentru că ALTER-ul din fix_security_lints_aug2026.sql era ANULAT la
-- fiecare re-rulare a acestui fișier (create or replace resetează setarea).
create or replace function public.med_profile_touch() returns trigger as $$
begin
  new.updated_at := now();
  return new;
end$$ language plpgsql set search_path = public;

drop trigger if exists trg_med_profile_touch on public.ai_meditatii_profile;
create trigger trg_med_profile_touch
  before update on public.ai_meditatii_profile
  for each row execute function public.med_profile_touch();

-- =====================================================================
-- 7. ROW LEVEL SECURITY
--    Elevul își CITEȘTE propriile date (pentru dashboard); scrierile trec
--    DOAR prin server (service_role) — nivelul, planul, notele și temele
--    nu pot fi falsificate din browser. Profesorii/părinții văd raportul
--    prin endpointul serverless (autorizat pe mentor_students).
-- =====================================================================
alter table public.ai_meditatii_profile  enable row level security;
alter table public.ai_meditatii_sessions enable row level security;
alter table public.ai_meditatii_homework enable row level security;
alter table public.ai_meditatii_mistakes enable row level security;
alter table public.ai_meditatii_reviews  enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_meditatii_profile' and policyname='medprof_own_read') then
    create policy "medprof_own_read" on public.ai_meditatii_profile for select
      using (auth.uid() = user_id or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_meditatii_profile' and policyname='medprof_service_write') then
    create policy "medprof_service_write" on public.ai_meditatii_profile for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (select 1 from pg_policies where tablename='ai_meditatii_sessions' and policyname='medsess_own_read') then
    create policy "medsess_own_read" on public.ai_meditatii_sessions for select
      using (auth.uid() = user_id or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_meditatii_sessions' and policyname='medsess_service_write') then
    create policy "medsess_service_write" on public.ai_meditatii_sessions for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (select 1 from pg_policies where tablename='ai_meditatii_homework' and policyname='medhw_own_read') then
    create policy "medhw_own_read" on public.ai_meditatii_homework for select
      using (auth.uid() = user_id or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_meditatii_homework' and policyname='medhw_service_write') then
    create policy "medhw_service_write" on public.ai_meditatii_homework for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (select 1 from pg_policies where tablename='ai_meditatii_mistakes' and policyname='medmist_own_read') then
    create policy "medmist_own_read" on public.ai_meditatii_mistakes for select
      using (auth.uid() = user_id or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_meditatii_mistakes' and policyname='medmist_service_write') then
    create policy "medmist_service_write" on public.ai_meditatii_mistakes for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;

  if not exists (select 1 from pg_policies where tablename='ai_meditatii_reviews' and policyname='medrev_own_read') then
    create policy "medrev_own_read" on public.ai_meditatii_reviews for select
      using (auth.uid() = user_id or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_meditatii_reviews' and policyname='medrev_service_write') then
    create policy "medrev_service_write" on public.ai_meditatii_reviews for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- =====================================================================
-- GATA. Pasul următor: vezi GHID_MEDITATII.md pentru restul instalării.
-- =====================================================================
