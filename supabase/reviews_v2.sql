-- =====================================================================
-- ExamenMate – RECENZII v2 (21 august 2026)
-- Rulează în Supabase → SQL Editor → New Query. SIGUR DE RULAT REPETAT.
-- Presupune că reviews_schema.sql a fost rulat cel puțin o dată.
--
-- Ce adaugă:
--   1. Răspunsul echipei la o recenzie: reviews.reply + reply_at (doar adminul
--      le poate scrie — triggerul `reviews_before_write` e actualizat, aceeași
--      definiție ca în reviews_schema.sql);
--   2. Emailul automat „Ce părere ai despre ExamenMate?" (api/review-invite.js,
--      cron zilnic): profiles.review_invite_sent_at (o singură invitație per
--      cont), profiles.subscription_started_at (pus de stripe-webhook la
--      abonare; pentru abonații existenți = acum) și funcția
--      `review_invite_candidates(p_limit)` care alege destinatarii:
--        · au email și nu au fost invitați;
--        · nu s-au dezabonat de la emailuri (newsletter_opt_in);
--        · nu au lăsat deja o recenzie de site;
--        · au rezolvat ≥ 3 teste (progress) SAU sunt abonați de ≥ 7 zile.
--   3. JSON-LD AggregateRating pe /recenzii nu are nevoie de SQL — citește
--      reviews / reviews_stats cu service role din api/page-meta.js.
-- =====================================================================

-- ─────────────────────────────────────────────────────────────────────
-- 1) Răspunsul echipei
-- ─────────────────────────────────────────────────────────────────────
alter table public.reviews add column if not exists reply    text check (reply is null or char_length(reply) <= 1000);
alter table public.reviews add column if not exists reply_at timestamptz;

-- Triggerul (identic cu cel din reviews_schema.sql): utilizatorii nu pot
-- scrie reply/reply_at; adminul da, iar data se pune automat la schimbare.
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
revoke execute on function public.reviews_before_write() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Invitația la recenzie (email automat)
-- ─────────────────────────────────────────────────────────────────────
-- preferința de email există din email_system.sql; o adăugăm defensiv
alter table public.profiles add column if not exists newsletter_opt_in boolean not null default true;
-- când a început abonamentul curent (api/stripe-webhook.js la checkout)
alter table public.profiles add column if not exists subscription_started_at timestamptz;
-- când a primit invitația la recenzie (NULL = niciodată)
alter table public.profiles add column if not exists review_invite_sent_at timestamptz;

-- Abonații existenți nu au dată de început → îi considerăm abonați „de azi":
-- primesc invitația peste 7 zile, nu toți deodată la prima rulare a cronului.
update public.profiles
set    subscription_started_at = now()
where  subscription_status = 'active'
  and  subscription_started_at is null;

create index if not exists idx_profiles_review_invite
  on public.profiles (review_invite_sent_at) where review_invite_sent_at is null;

-- Destinatarii eligibili pentru invitație. SECURITY DEFINER fiindcă citește
-- profiles/progress/reviews pentru TOȚI utilizatorii — de aceea e executabilă
-- DOAR de service_role (cronul), niciodată din client (lint 0029).
create or replace function public.review_invite_candidates(p_limit int default 80)
returns table (
  id           uuid,
  email        text,
  full_name    text,
  role         text,
  tests        int,
  premium_days int
)
language sql
security definer
set search_path = public
as $$
  select p.id,
         p.email,
         p.full_name,
         p.role,
         (select count(*) from public.progress g where g.user_id = p.id)::int as tests,
         case when p.subscription_status = 'active' and p.subscription_started_at is not null
              then greatest(0, floor(extract(epoch from (now() - p.subscription_started_at)) / 86400))::int
              else null end as premium_days
  from   public.profiles p
  where  p.email is not null
    and  p.email like '%@%'
    and  p.review_invite_sent_at is null
    and  coalesce(p.newsletter_opt_in, true)
    and  not exists (select 1 from public.reviews r where r.user_id = p.id and r.target_type = 'site')
    and  (
           (select count(*) from public.progress g where g.user_id = p.id) >= 3
        or (p.subscription_status = 'active' and p.subscription_started_at <= now() - interval '7 days')
         )
  order by p.created_at
  limit  greatest(1, least(coalesce(p_limit, 80), 500))
$$;

revoke execute on function public.review_invite_candidates(int) from public, anon, authenticated;
grant  execute on function public.review_invite_candidates(int) to service_role;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Verificare (opțional)
-- select count(*) from public.review_invite_candidates(500);   -- câți ar primi emailul
-- select id, reply, reply_at from public.reviews where reply is not null;
-- Apoi: Supabase → Advisors → Rerun linter — funcția nouă nu e executabilă
-- de utilizatori, deci nu apare la lintul 0029.
-- ─────────────────────────────────────────────────────────────────────
