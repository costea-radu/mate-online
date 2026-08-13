-- =====================================================================
-- PĂSTREAZĂ DATELE PUBLICE după ștergerea conturilor
-- (comentariile din forum, aprecierile, testele din „Biblioteca
--  utilizatorilor" și scorurile elevilor la testele publice)
-- Rulează în Supabase → SQL Editor → New Query. SIGUR DE RULAT REPETAT.
--
-- Problema reparată: `discussions.user_id`, `discussion_likes.user_id` și
-- `ai_public_results.student_id` aveau ON DELETE CASCADE, deci ștergerea
-- unui cont (din Setări cont, de către admin sau prin curățarea automată a
-- conturilor inactive — api/account-cleanup.js) ștergea și comentariile
-- lui din forum, aprecierile date și scorurile la testele publice.
-- După acest script:
--   1. comentariul păstrează ÎN EL numele autorului (coloana snapshot
--      `author_name`, completată automat la postare printr-un trigger);
--   2. ștergerea contului NU mai șterge comentariile / aprecierile /
--      scorurile — legăturile devin ON DELETE SET NULL, iar autorul apare
--      cu numele salvat în snapshot;
--   3. „Biblioteca utilizatorilor" (`ai_public_library`) era deja pregătită
--      (SET NULL + `creator_name`) — aici doar completăm `creator_name`
--      unde lipsește, ca plasa de siguranță să fie întreagă.
-- Materialele de pe site (`content`, inclusiv cele postate de agentul
-- Claude), rezolvările și articolele nu au legături spre conturi, deci
-- rămân oricum.
--
-- ATENȚIE: scriptul NU poate recupera datele DEJA șterse — pentru ele
-- singura cale e un backup Supabase (Database → Backups, plan Pro).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 0) Funcție ajutătoare: numele afișabil al unui cont (aceeași ordine ca
--    în aplicație: nume complet → username → partea locală din email)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.display_name_of(uid uuid)
returns text
language plpgsql
security definer                -- citește profiles indiferent de RLS
set search_path = public
as $$
declare n text;
begin
  select coalesce(
           nullif(btrim(p.full_name), ''),
           nullif(btrim(p.username), ''),
           nullif(split_part(coalesce(p.email, ''), '@', 1), '')
         )
    into n
    from public.profiles p
   where p.id = uid;
  return n;
exception when undefined_column then
  -- instalări mai vechi, fără coloana username
  select coalesce(
           nullif(btrim(p.full_name), ''),
           nullif(split_part(coalesce(p.email, ''), '@', 1), '')
         )
    into n
    from public.profiles p
   where p.id = uid;
  return n;
end $$;

-- Funcția e doar pentru uz INTERN (triggere + backfill) — nu prin API.
-- Fără revocare, PostgREST ar expune-o la /rest/v1/rpc/display_name_of și
-- oricine (anon) ar putea afla numele oricărui cont după UUID (lint 0028/0029).
-- Triggerele NU sunt afectate: la INSERT ele rulează ca proprietarul funcției,
-- nu ca utilizatorul care postează.
revoke execute on function public.display_name_of(uuid) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 1) FORUM (discussions): snapshot cu numele autorului + FK → SET NULL
-- ─────────────────────────────────────────────────────────────────────
alter table public.discussions add column if not exists author_name text;

-- backfill pentru comentariile existente (idempotent: doar unde lipsește)
update public.discussions d
set    author_name = public.display_name_of(d.user_id)
where  d.author_name is null
  and  d.user_id is not null;

-- trigger: la fiecare postare nouă, numele se salvează automat în rând
create or replace function public.discussions_fill_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.author_name is null and new.user_id is not null then
    new.author_name := public.display_name_of(new.user_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_discussions_fill_author on public.discussions;
create trigger trg_discussions_fill_author
  before insert on public.discussions
  for each row execute function public.discussions_fill_author();

-- funcție de trigger, nu de API — o scoatem din /rest/v1/rpc (lint 0028/0029)
revoke execute on function public.discussions_fill_author() from public, anon, authenticated;

-- legătura cu contul: ON DELETE CASCADE → ON DELETE SET NULL
-- (comentariul rămâne pe site; doar referința spre cont se golește)
alter table public.discussions alter column user_id drop not null;

do $$
declare fk text;
begin
  select conname into fk
  from   pg_constraint
  where  conrelid  = 'public.discussions'::regclass
    and  contype   = 'f'
    and  confrelid = 'auth.users'::regclass;
  if fk is not null then
    execute format('alter table public.discussions drop constraint %I', fk);
  end if;
  alter table public.discussions
    add constraint discussions_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) APRECIERILE (discussion_likes): FK → SET NULL
--    (numărul de aprecieri afișat la comentarii nu mai scade când un
--     cont dispare; UNIQUE(discussion_id, user_id) rămâne valid — în
--     Postgres valorile NULL sunt considerate distincte)
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fk text;
begin
  if to_regclass('public.discussion_likes') is null then return; end if;

  alter table public.discussion_likes alter column user_id drop not null;

  select conname into fk
  from   pg_constraint
  where  conrelid  = 'public.discussion_likes'::regclass
    and  contype   = 'f'
    and  confrelid = 'auth.users'::regclass;
  if fk is not null then
    execute format('alter table public.discussion_likes drop constraint %I', fk);
  end if;
  alter table public.discussion_likes
    add constraint discussion_likes_user_id_fkey
    foreign key (user_id) references auth.users(id) on delete set null;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) SCORURILE la testele publice (ai_public_results): snapshot cu numele
--    elevului + FK → SET NULL (autorul testului își păstrează statistica
--    și după ce contul elevului dispare)
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fk text;
begin
  if to_regclass('public.ai_public_results') is null then return; end if;

  alter table public.ai_public_results add column if not exists student_name text;

  update public.ai_public_results r
  set    student_name = public.display_name_of(r.student_id)
  where  r.student_name is null
    and  r.student_id is not null;

  alter table public.ai_public_results alter column student_id drop not null;

  select conname into fk
  from   pg_constraint
  where  conrelid  = 'public.ai_public_results'::regclass
    and  contype   = 'f'
    and  confrelid = 'auth.users'::regclass;
  if fk is not null then
    execute format('alter table public.ai_public_results drop constraint %I', fk);
  end if;
  alter table public.ai_public_results
    add constraint ai_public_results_student_id_fkey
    foreign key (student_id) references auth.users(id) on delete set null;
end $$;

-- trigger: numele elevului se salvează automat la fiecare scor nou
create or replace function public.pubres_fill_student()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.student_name is null and new.student_id is not null then
    new.student_name := public.display_name_of(new.student_id);
  end if;
  return new;
end $$;

do $$ begin
  if to_regclass('public.ai_public_results') is not null then
    drop trigger if exists trg_pubres_fill_student on public.ai_public_results;
    create trigger trg_pubres_fill_student
      before insert on public.ai_public_results
      for each row execute function public.pubres_fill_student();
  end if;
end $$;

-- funcție de trigger, nu de API — o scoatem din /rest/v1/rpc (lint 0028/0029)
revoke execute on function public.pubres_fill_student() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4) BIBLIOTECA UTILIZATORILOR (ai_public_library): era deja pe
--    ON DELETE SET NULL + creator_name — completăm doar numele lipsă
--    și ne asigurăm (defensiv, idempotent) că legătura chiar e SET NULL.
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fk text;
begin
  if to_regclass('public.ai_public_library') is null then return; end if;

  update public.ai_public_library l
  set    creator_name = public.display_name_of(l.created_by)
  where  (l.creator_name is null or btrim(l.creator_name) = '')
    and  l.created_by is not null;

  select conname into fk
  from   pg_constraint
  where  conrelid  = 'public.ai_public_library'::regclass
    and  contype   = 'f'
    and  confrelid = 'auth.users'::regclass
    and  confdeltype <> 'n';           -- doar dacă NU e deja SET NULL
  if fk is not null then
    execute format('alter table public.ai_public_library drop constraint %I', fk);
    alter table public.ai_public_library
      add constraint ai_public_library_created_by_fkey
      foreign key (created_by) references auth.users(id) on delete set null;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Verificare rapidă (opțional):
-- select count(*) filter (where user_id is null)     as comentarii_de_la_conturi_sterse,
--        count(*) filter (where author_name is not null) as cu_nume_salvat
-- from public.discussions;
--
-- Test complet pe un cont de probă: postează un comentariu cu el, șterge
-- contul din Setări cont, apoi verifică pe site că comentariul a rămas,
-- cu numele autorului afișat.
-- ─────────────────────────────────────────────────────────────────────
