-- =====================================================================
-- ExamenMate · Meditații v3 — repetiție pe ITEMI (SM-2) + stăpânire BKT
-- (Etapa 3 din AUDIT_AGENTI_AI.md, punctele 5.3 și 5.5).
-- Rulează DUPĂ meditatii_schema.sql și ai_tutor_schema.sql. Idempotent.
--
--   · ai_meditatii_item_reviews — fiecare exercițiu GREȘIT devine un card de
--     repetiție cu factor de ușurință (ease), interval și scadență (due_at);
--     recapitulările reiau ÎNTÂI itemii scadenți, nu doar itemi noi;
--   · bump_skill_mastery — modelul BKT (Bayesian Knowledge Tracing) în locul
--     mediei exponențiale cu un singur parametru. `mastery` rămâne un număr
--     0..1 („probabilitatea ca elevul să stăpânească subiectul"), deci toate
--     rapoartele și pragurile existente (0.5 / 0.6 / 0.7) funcționează la fel.
-- =====================================================================

-- ── 1. Repetiție la nivel de ITEM (SM-2 simplificat) ────────────────────────
create table if not exists public.ai_meditatii_item_reviews (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete cascade not null,
  mistake_id    uuid references public.ai_meditatii_mistakes(id) on delete set null,
  chapter       text,
  topic         text,
  statement     text not null,
  options       jsonb,                 -- variantele (grilă) sau null
  answer        text not null,         -- indexul variantei corecte (grilă) sau răspunsul
  explanation   text,
  ease          numeric not null default 2.5,   -- factorul de ușurință SM-2 (1.3 … 3.0)
  interval_days numeric not null default 1,
  reps          int not null default 0,         -- repetări consecutive corecte
  lapses        int not null default 0,
  due_at        timestamptz not null default now() + interval '1 day',
  last_result   boolean,
  retired       boolean not null default false, -- învățat (3 repetări corecte) sau șters
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);
create index if not exists idx_medir_due on public.ai_meditatii_item_reviews(user_id, due_at) where retired = false;
create index if not exists idx_medir_mistake on public.ai_meditatii_item_reviews(mistake_id);

alter table public.ai_meditatii_item_reviews enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'ai_meditatii_item_reviews' and policyname = 'medir_own_read') then
    create policy "medir_own_read" on public.ai_meditatii_item_reviews for select using (auth.uid() = user_id);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'ai_meditatii_item_reviews' and policyname = 'medir_service') then
    create policy "medir_service" on public.ai_meditatii_item_reviews for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;
-- răspunsurile corecte NU se citesc din browser (ca la payload-ul sesiunilor)
revoke all on public.ai_meditatii_item_reviews from anon, authenticated;
grant select (id, user_id, chapter, topic, due_at, reps, lapses, retired, created_at)
  on public.ai_meditatii_item_reviews to authenticated;

-- ── 2. Stăpânirea competențelor: BKT în loc de EMA cu un parametru ──────────
--   P(L₀)=0.25 (necunoscut la început) · P(T)=0.12 (șansa de a învăța din
--   exercițiu) · P(S)=0.10 (greșeală din neatenție, deși știe) · P(G)=0.20
--   (nimerește deși nu știe — grilele au 4 variante).
--   Corect:  P(L|corect)  = L(1-S) / (L(1-S) + (1-L)G)
--   Greșit:  P(L|greșit)  = L·S / (L·S + (1-L)(1-G))
--   apoi P(L') = P(L|obs) + (1 - P(L|obs))·T
create or replace function public.bump_skill_mastery(
  p_user uuid, p_category text, p_topic text, p_correct boolean
) returns void language plpgsql security definer set search_path = public as $$
declare
  p_l0 numeric := 0.25; p_t numeric := 0.12; p_s numeric := 0.10; p_g numeric := 0.20;
  cur numeric; post numeric; nxt numeric; hit int := case when p_correct then 1 else 0 end;
begin
  select mastery into cur from public.ai_skill_mastery
    where user_id = p_user and category = coalesce(p_category, 'general') and topic = p_topic;
  if cur is null then cur := p_l0; end if;
  if p_correct then
    post := (cur * (1 - p_s)) / nullif(cur * (1 - p_s) + (1 - cur) * p_g, 0);
  else
    post := (cur * p_s) / nullif(cur * p_s + (1 - cur) * (1 - p_g), 0);
  end if;
  if post is null then post := cur; end if;
  nxt := round(least(0.999, greatest(0.001, post + (1 - post) * p_t)), 4);

  insert into public.ai_skill_mastery(user_id, category, topic, mastery, attempts, correct, last_interaction)
  values (p_user, coalesce(p_category, 'general'), p_topic, nxt, 1, hit, now())
  on conflict (user_id, category, topic) do update set
    mastery          = nxt,
    attempts         = public.ai_skill_mastery.attempts + 1,
    correct          = public.ai_skill_mastery.correct + hit,
    last_interaction = now();
end$$;

-- ── 3. Unificarea subiectelor duplicate (aceeași competență, alt nume) ──────
-- Apelată de /api/ai-ingest (admin, action='normalize_topics'): mută rândul
-- `p_from` peste `p_to` (sumă încercări/corecte, stăpânirea ponderată).
create or replace function public.merge_skill_topic(
  p_user uuid, p_category text, p_from text, p_to text
) returns void language plpgsql security definer set search_path = public as $$
declare src record; dst record;
begin
  if p_from = p_to then return; end if;
  select * into src from public.ai_skill_mastery where user_id = p_user and category = p_category and topic = p_from;
  if not found then return; end if;
  select * into dst from public.ai_skill_mastery where user_id = p_user and category = p_category and topic = p_to;
  if not found then
    update public.ai_skill_mastery set topic = p_to where id = src.id;
    return;
  end if;
  update public.ai_skill_mastery set
    mastery = round(((dst.mastery * greatest(dst.attempts, 1)) + (src.mastery * greatest(src.attempts, 1)))
                    / greatest(dst.attempts + src.attempts, 1), 4),
    attempts = dst.attempts + src.attempts,
    correct = dst.correct + src.correct,
    last_interaction = greatest(dst.last_interaction, src.last_interaction)
  where id = dst.id;
  delete from public.ai_skill_mastery where id = src.id;
end$$;
revoke all on function public.merge_skill_topic(uuid, text, text, text) from public;
grant execute on function public.merge_skill_topic(uuid, text, text, text) to service_role;
