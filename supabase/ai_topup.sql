-- =====================================================================
-- ai_topup.sql — PACHETE TOP-UP DE BUGET AI (pasul 2 din GHID_LIMITE_AI.md)
-- Rulezi O DATĂ în Supabase → SQL Editor, DUPĂ ai_limite_cost.sql.
-- Idempotent: poate fi rulat de mai multe ori fără efecte secundare.
--
-- Un pachet cumpărat prin Stripe (mode: payment) adaugă utilizatorului
-- `credit_micro` micro-lei de buget AI, valabil până la `expires_at`
-- (implicit 30 de zile — aceeași fereastră ca bugetul lunar rulant, deci
-- semantica e simplă: „+X lei la bugetul lunii curente").
-- =====================================================================

-- 1) Tabela pachetelor cumpărate
create table if not exists public.ai_topups (
  id                bigint generated always as identity primary key,
  user_id           uuid references auth.users(id) on delete cascade,
  pack_id           text not null,                -- id-ul pachetului (ex. 'mic', 'mare')
  name              text,                         -- numele afișat la cumpărare
  credit_micro      bigint not null default 0,    -- bugetul adăugat, în micro-lei
  price_bani        int,                          -- cât a plătit (bani; 1000 = 10 lei)
  stripe_session_id text unique,                  -- idempotență: webhookul poate sosi de mai multe ori
  purchased_at      timestamptz default now(),
  expires_at        timestamptz not null
);
create index if not exists idx_topups_user_exp on public.ai_topups(user_id, expires_at);

comment on table public.ai_topups is 'Pachete top-up de buget AI cumpărate prin Stripe (vezi GHID_LIMITE_AI.md)';

-- RLS strict: doar serverul (service_role) citește/scrie — ca la ai_usage.
alter table public.ai_topups enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_topups' and policyname='topups_service') then
    create policy "topups_service" on public.ai_topups for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- 2) ai_spent2 — înlocuiește ai_spent în cod (ai_spent rămâne pentru
--    compatibilitate). Întoarce, în plus: creditul top-up ACTIV (nefolosit
--    de timp, adică neexpirat) și cea mai apropiată expirare a unui pachet.
create or replace function public.ai_spent2(
  p_user uuid,
  p_day_start timestamptz,
  p_month_start timestamptz
) returns table (
  day_micro bigint,
  month_micro bigint,
  day_actions int,
  month_actions int,
  topup_micro bigint,
  topup_expires timestamptz
) language sql stable security definer set search_path = public as $$
  select
    coalesce(sum(u.cost_micro) filter (where u.created_at >= p_day_start), 0)::bigint as day_micro,
    coalesce(sum(u.cost_micro), 0)::bigint                                            as month_micro,
    coalesce(count(u.*) filter (where u.created_at >= p_day_start), 0)::int           as day_actions,
    coalesce(count(u.*), 0)::int                                                      as month_actions,
    (select coalesce(sum(t.credit_micro), 0)::bigint
       from public.ai_topups t
      where t.user_id = p_user and t.expires_at > now())                              as topup_micro,
    (select min(t.expires_at)
       from public.ai_topups t
      where t.user_id = p_user and t.expires_at > now())                              as topup_expires
  from public.ai_usage u
  where u.user_id = p_user
    and u.created_at >= p_month_start;
$$;

-- doar serverul o poate apela
revoke all on function public.ai_spent2(uuid, timestamptz, timestamptz) from public;
revoke all on function public.ai_spent2(uuid, timestamptz, timestamptz) from anon;
revoke all on function public.ai_spent2(uuid, timestamptz, timestamptz) from authenticated;

-- =====================================================================
-- VERIFICARE (opțional, după rulare):
--   select * from public.ai_spent2('00000000-0000-0000-0000-000000000000'::uuid, now() - interval '1 day', now() - interval '30 days');
--     → un rând cu 0-uri și topup_expires NULL = funcția merge.
--
-- MONITORIZARE PACHETE:
--   -- pachetele cumpărate în ultimele 30 de zile + venitul lor:
--   select t.pack_id, count(*) as vandute, round(sum(t.price_bani)/100.0, 2) as lei_incasati,
--          round(sum(t.credit_micro)/1e6::numeric, 2) as lei_buget_oferit
--   from public.ai_topups t
--   where t.purchased_at > now() - interval '30 days'
--   group by 1 order by lei_incasati desc;
-- =====================================================================
