-- =====================================================================
-- ai_limite_cost.sql — LIMITE DE CONSUM AI (cost per acțiune + bugete)
-- Vezi GHID_LIMITE_AI.md. Rulezi O DATĂ în Supabase → SQL Editor.
-- Idempotent: poate fi rulat de mai multe ori fără efecte secundare.
--
-- Adaugă în jurnalul `ai_usage`:
--   · model      — modelul LLM folosit la acțiune (ex. gpt-4o-mini)
--   · cost_micro — costul acțiunii în MICRO-LEI (1 leu = 1.000.000),
--                  calculat pe server la logare (tokeni × preț model × curs)
-- și funcția agregată `ai_spent` pe care serverul o folosește pentru
-- bugetele zilnice/lunare (o singură interogare, pe indexul existent).
-- =====================================================================

-- 1) Coloanele noi pe jurnal (rândurile vechi rămân cu model NULL, cost 0)
alter table public.ai_usage add column if not exists model text;
alter table public.ai_usage add column if not exists cost_micro bigint not null default 0;

comment on column public.ai_usage.model is 'Modelul LLM al acțiunii (null la acțiunile fără LLM sau logate înainte de migrare)';
comment on column public.ai_usage.cost_micro is 'Costul acțiunii în micro-lei (1 leu = 1.000.000); calculat pe server la logare';

-- 2) Sumele consumate de un utilizator: azi (de la p_day_start) și în
--    fereastra lunară (de la p_month_start = acum 30 de zile).
--    Folosește idx_usage_user_time(user_id, created_at) — deja existent.
create or replace function public.ai_spent(
  p_user uuid,
  p_day_start timestamptz,
  p_month_start timestamptz
) returns table (
  day_micro bigint,
  month_micro bigint,
  day_actions int,
  month_actions int
) language sql stable security definer set search_path = public as $$
  select
    coalesce(sum(cost_micro) filter (where created_at >= p_day_start), 0)::bigint  as day_micro,
    coalesce(sum(cost_micro), 0)::bigint                                           as month_micro,
    coalesce(count(*) filter (where created_at >= p_day_start), 0)::int            as day_actions,
    coalesce(count(*), 0)::int                                                     as month_actions
  from public.ai_usage
  where user_id = p_user
    and created_at >= p_month_start;
$$;

-- doar serverul (service_role) o poate apela — ca la funcțiile RAG
revoke all on function public.ai_spent(uuid, timestamptz, timestamptz) from public;
revoke all on function public.ai_spent(uuid, timestamptz, timestamptz) from anon;
revoke all on function public.ai_spent(uuid, timestamptz, timestamptz) from authenticated;

-- 3) Vedere de MONITORIZARE pentru admin (interogabilă din SQL Editor):
--    consum pe zi × endpoint × model, cu costul în lei.
--    security_invoker → respectă RLS-ul strict al tabelei ai_usage
--    (adică e vizibilă doar cu service_role / din SQL Editor, nu din browser).
create or replace view public.ai_usage_daily
with (security_invoker = true) as
select
  (created_at at time zone 'Europe/Bucharest')::date as zi,
  endpoint,
  model,
  count(*)                                  as actiuni,
  sum(tokens_in)                            as tokens_in,
  sum(tokens_out)                           as tokens_out,
  round(sum(cost_micro) / 1e6::numeric, 4)  as cost_lei
from public.ai_usage
group by 1, 2, 3
order by 1 desc, cost_lei desc;

comment on view public.ai_usage_daily is 'Monitorizare consum AI: pe zi (ora României) × endpoint × model, cost în lei';

-- =====================================================================
-- VERIFICARE (opțional, după rulare):
--   select * from public.ai_spent('00000000-0000-0000-0000-000000000000'::uuid, now() - interval '1 day', now() - interval '30 days');
--     → un rând cu 0-uri (utilizator inexistent) = funcția merge.
--   select * from public.ai_usage_daily limit 20;
--     → consumul pe zile (cost_lei = 0 pe rândurile logate înainte de migrare).
--
-- INTEROGĂRI UTILE DE MONITORIZARE:
--   -- top 10 utilizatori după cost, ultimele 30 de zile:
--   select u.user_id, p.email, round(sum(u.cost_micro)/1e6::numeric, 2) as lei, count(*) as actiuni
--   from public.ai_usage u left join public.profiles p on p.id = u.user_id
--   where u.created_at > now() - interval '30 days'
--   group by 1, 2 order by lei desc limit 10;
--
--   -- costul platformei pe zile, ultimele 14 zile:
--   select zi, round(sum(cost_lei), 2) as lei_total, sum(actiuni) as actiuni
--   from public.ai_usage_daily
--   where zi > current_date - 14
--   group by 1 order by 1 desc;
-- =====================================================================
