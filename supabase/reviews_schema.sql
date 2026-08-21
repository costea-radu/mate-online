-- =====================================================================
-- ExamenMate – RECENZII (stele 1–5 + comentariu)
-- Rulează în Supabase → SQL Editor → New Query. SIGUR DE RULAT REPETAT.
--
-- Un singur tabel pentru toate recenziile, deosebite prin `target_type`:
--   'content'     → un test/exercițiu din site (content.id)
--                   — poate nota DOAR cine l-a rezolvat (are rând în `progress`);
--                   nota și comentariul apar imediat (media pe carduri);
--   'public_item' → un test din „Biblioteca utilizatorilor" (ai_public_library.id)
--                   — poate nota doar cine l-a rezolvat (rând în ai_public_results);
--   'site'        → părere generală despre ExamenMate (target_id NULL) — apare
--                   public DOAR după aprobare în Admin (approved = true).
-- O singură recenzie per (utilizator, țintă); utilizatorul și-o poate edita.
-- Echipa poate RĂSPUNDE la o recenzie (reply / reply_at — doar admin; apare
-- sub comentariu). Invitația automată pe email + coloanele din profiles
-- sunt în reviews_v2.sql (rulează-l după acest fișier).
--
-- Folosit de: src/lib/reviews.js, src/components/ReviewWidget.jsx (toast-ul
-- de după test, media „★ 4,6 (23)" și lista de păreri de pe carduri,
-- formularul „Părerea ta despre ExamenMate" din Profil, testimonialele de pe
-- Home), src/pages/Recenzii.jsx (/recenzii) și src/components/ReviewsAdmin.jsx
-- (panoul Admin → ⭐ Recenzii: aprobare, ștergere, coada de corecturi).
--
-- Siguranță:
--   • RLS: citire publică (mai puțin recenziile „site" neaprobate), scriere
--     doar pe rândurile proprii; adminul poate aproba/șterge orice;
--   • triggerul `reviews_before_write` împiedică auto-aprobarea și mutarea
--     recenziei pe alt utilizator/test, completează snapshotul cu numele și
--     rolul autorului (rămân și după ștergerea contului — ON DELETE SET NULL,
--     același tipar ca în pastreaza_date_publice.sql);
--   • verificarea „a rezolvat testul" stă în funcția `reviews_can_rate`
--     (SECURITY INVOKER: citește progress / ai_public_results sub RLS-ul
--     utilizatorului curent, deci nu poate fi folosită ca să afli ce au
--     rezolvat alții și nu declanșează lintul 0029).
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1) Tabelul
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.reviews (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references auth.users(id) on delete set null,
  author_name  text,                                   -- snapshot (trigger): rămâne după ștergerea contului
  author_role  text,                                   -- snapshot: 'elev' | 'profesor' | 'parinte'
  target_type  text not null check (target_type in ('content', 'public_item', 'site')),
  target_id    uuid,                                   -- NULL doar pentru 'site'
  stars        smallint not null check (stars between 1 and 5),
  body         text check (body is null or char_length(body) <= 1000),
  approved     boolean not null default false,         -- contează doar pentru 'site'
  reply        text check (reply is null or char_length(reply) <= 1000), -- răspunsul echipei (doar admin)
  reply_at     timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint reviews_target_consistent check ((target_type = 'site') = (target_id is null)),
  -- o singură recenzie per (utilizator, test); pentru 'site' vezi indexul parțial
  constraint reviews_one_per_target unique (user_id, target_type, target_id)
);

-- instalări din tranșa 1/2 (tabelul exista fără răspunsul echipei) — vezi reviews_v2.sql
alter table public.reviews add column if not exists reply    text check (reply is null or char_length(reply) <= 1000);
alter table public.reviews add column if not exists reply_at timestamptz;

-- 'site' are target_id NULL, iar NULL-urile sunt „distincte" în UNIQUE → index parțial
create unique index if not exists reviews_one_site_per_user
  on public.reviews (user_id) where target_type = 'site';

create index if not exists idx_reviews_target on public.reviews (target_type, target_id);
create index if not exists idx_reviews_user   on public.reviews (user_id);

-- ─────────────────────────────────────────────────────────────────────
-- 2) „Poate nota?" — doar cine a rezolvat ținta (sau oricine, pentru 'site')
-- ─────────────────────────────────────────────────────────────────────
-- SECURITY INVOKER (nu DEFINER): funcția e apelată din politica de INSERT,
-- deci TREBUIE să fie executabilă de rolul `authenticated` — iar o funcție
-- DEFINER executabilă de clienți declanșează lintul Supabase 0029
-- („Signed-In Users Can Execute SECURITY DEFINER Function", 21 aug 2026).
-- Nu are nevoie de DEFINER: verifică doar rândurile PROPRII ale
-- utilizatorului curent din `progress` / `ai_public_results`, pe care
-- RLS-ul acelor tabele i le arată oricum (progress_select_own, pubres_read).
-- ATENȚIE: nu o defini din nou cu DEFINER — lintul revine
-- (vezi fix_lints_21aug2026.sql pentru istoric).
create or replace function public.reviews_can_rate(p_type text, p_id uuid)
returns boolean
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();       -- verifică NUMAI utilizatorul curent
  ok  boolean := false;
begin
  if uid is null then return false; end if;
  if p_type = 'site' then return p_id is null; end if;
  if p_id is null then return false; end if;

  if p_type = 'content' then
    select exists (select 1 from public.progress p where p.user_id = uid and p.content_id = p_id) into ok;
    return ok;
  end if;

  if p_type = 'public_item' then
    if to_regclass('public.ai_public_results') is null then return false; end if;
    execute 'select exists (select 1 from public.ai_public_results r where r.student_id = $1 and r.public_id = $2)'
      into ok using uid, p_id;
    return ok;
  end if;

  return false;
end $$;

-- `authenticated` păstrează EXECUTE (politica RLS o apelează în numele lui);
-- anon nu are ce căuta la ea. Expusă la /rest/v1/rpc e inofensivă: întoarce
-- un boolean despre propriile rezolvări ale celui care o cheamă.
revoke execute on function public.reviews_can_rate(text, uuid) from public, anon;
grant  execute on function public.reviews_can_rate(text, uuid) to authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Trigger: snapshot autor + gard împotriva auto-aprobării / mutării
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.reviews_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  priv boolean;                 -- service_role sau admin → poate seta approved
  n    text;
  r    text;
begin
  priv := (auth.role() = 'service_role')
       or exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true);

  if tg_op = 'INSERT' then
    if not priv then
      new.approved := false;
      new.reply    := null;      -- răspunsul echipei îl scrie doar adminul
      new.reply_at := null;
    end if;
    if new.reply is not null and new.reply_at is null then new.reply_at := now(); end if;

    if new.user_id is not null then
      -- numele afișabil: nume complet → username → partea locală din email
      begin
        select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(p.username), ''),
                        nullif(split_part(coalesce(p.email, ''), '@', 1), ''))
          into n from public.profiles p where p.id = new.user_id;
      exception when undefined_column then      -- instalări fără coloana username
        select coalesce(nullif(btrim(p.full_name), ''),
                        nullif(split_part(coalesce(p.email, ''), '@', 1), ''))
          into n from public.profiles p where p.id = new.user_id;
      end;
      begin
        select p.role into r from public.profiles p where p.id = new.user_id;
      exception when undefined_column then
        r := null;
      end;
      if new.author_name is null then new.author_name := n; end if;
      if new.author_role is null then new.author_role := r; end if;
    end if;
    new.created_at := now();
    new.updated_at := now();
  else
    if not priv then
      -- utilizatorul își poate schimba DOAR stelele și comentariul
      new.approved    := old.approved;
      new.user_id     := old.user_id;
      new.target_type := old.target_type;
      new.target_id   := old.target_id;
      new.author_name := old.author_name;
      new.author_role := old.author_role;
      new.reply       := old.reply;
      new.reply_at    := old.reply_at;
    else
      -- răspunsul echipei: data se pune/actualizează automat la schimbare
      if new.reply is distinct from old.reply then
        new.reply_at := case when new.reply is null then null else now() end;
      end if;
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_reviews_before_write on public.reviews;
create trigger trg_reviews_before_write
  before insert or update on public.reviews
  for each row execute function public.reviews_before_write();

-- funcție de trigger, nu de API — o scoatem din /rest/v1/rpc (lint 0028/0029)
revoke execute on function public.reviews_before_write() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Grant-uri + RLS (același tipar ca supabase_grants.sql)
-- ─────────────────────────────────────────────────────────────────────
grant select                         on public.reviews to anon;
grant select, insert, update, delete on public.reviews to authenticated;
grant select, insert, update, delete on public.reviews to service_role;

alter table public.reviews enable row level security;

-- citire: tot ce nu e „site" + recenziile „site" aprobate + propriile recenzii + adminul vede tot
drop policy if exists "reviews_select" on public.reviews;
create policy "reviews_select"
  on public.reviews for select
  to anon, authenticated
  using (
    target_type <> 'site'
    or approved = true
    or user_id = (select auth.uid())
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)
  );

-- scriere: doar pe numele propriu și doar dacă a rezolvat ținta
drop policy if exists "reviews_insert_own" on public.reviews;
create policy "reviews_insert_own"
  on public.reviews for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.reviews_can_rate(target_type, target_id)
  );

drop policy if exists "reviews_update_own_or_admin" on public.reviews;
create policy "reviews_update_own_or_admin"
  on public.reviews for update
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)
  )
  with check (
    user_id = (select auth.uid())
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)
  );

drop policy if exists "reviews_delete_own_or_admin" on public.reviews;
create policy "reviews_delete_own_or_admin"
  on public.reviews for delete
  to authenticated
  using (
    user_id = (select auth.uid())
    or exists (select 1 from public.profiles p where p.id = (select auth.uid()) and p.is_admin = true)
  );

drop policy if exists "reviews_service_role" on public.reviews;
create policy "reviews_service_role"
  on public.reviews for all
  using (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────────────
-- 5) Statistici agregate per țintă (media + numărul de note) — citite de
--    ContentPage / ExamContent pentru „★ 4,6 (23)" de pe carduri.
--    security_invoker: se aplică RLS-ul cititorului (recenziile „site"
--    neaprobate nu intră în medie pentru public). Cere Postgres ≥ 15
--    (toate proiectele Supabase recente); pe o bază mai veche scoate
--    `with (security_invoker = true)` — media rămâne corectă pentru
--    'content'/'public_item', care sunt oricum publice.
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.reviews_stats
with (security_invoker = true) as
select
  target_type,
  target_id,
  round(avg(stars)::numeric, 2)                                          as avg_stars,
  count(*)::int                                                          as n,
  count(*) filter (where body is not null and btrim(body) <> '')::int    as n_comentarii
from public.reviews
-- media site-ului se calculează DOAR din recenziile aprobate (aceeași cifră
-- pentru vizitatori, utilizatori și admin); notele per test intră toate
where target_type <> 'site' or approved = true
group by target_type, target_id;

-- listarea recenziilor „site" aprobate (pagina /recenzii, Home) + cele în așteptare (Admin)
create index if not exists idx_reviews_site_approved
  on public.reviews (approved, created_at desc) where target_type = 'site';

grant select on public.reviews_stats to anon, authenticated, service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 6) Verificare rapidă (opțional)
-- select target_type, count(*) from public.reviews group by 1;
-- select * from public.reviews_stats order by n desc limit 20;
-- Test: rezolvă un test interactiv dintr-un cont de elev → după „Scor salvat"
-- apare cardul „Cum ți s-a părut testul?"; nota apare pe card în lista clasei.
-- Dintr-un cont care NU a rezolvat testul, INSERT-ul e respins de RLS.
-- ─────────────────────────────────────────────────────────────────────
