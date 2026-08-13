-- =====================================================================
-- ai_alerte.sql — ALERTE AUTOMATE DE COST AI (pasul 4, ultimul, din
-- GHID_LIMITE_AI.md). Rulezi O DATĂ în Supabase → SQL Editor.
-- Idempotent: poate fi rulat de mai multe ori fără efecte secundare.
--
-- Susține două mecanisme (ambele pe cron-urile EXISTENTE):
--   · raportul zilnic pe email către admin (cost pe endpoint/model + top
--     utilizatori), trimis de scanarea zilnică din /api/ai-notify;
--   · alarma de prag (🚨): verificată la fiecare 10 minute pe cronul de
--     ingest — dacă costul zilei depășește AI_ALERT_DAY_LEI, primești
--     email IMEDIAT (o singură dată pe zi — dedup în ai_cost_alerts).
-- =====================================================================

-- 1) Dedup pentru alarme (o alarmă de un fel pe zi)
create table if not exists public.ai_cost_alerts (
  day         date not null,
  kind        text not null default 'day_total',
  total_micro bigint not null default 0,   -- costul în momentul alarmei (micro-lei)
  sent_at     timestamptz default now(),
  primary key (day, kind)
);

alter table public.ai_cost_alerts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_cost_alerts' and policyname='cost_alerts_service') then
    create policy "cost_alerts_service" on public.ai_cost_alerts for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- 2) Detalierea costului pe o fereastră de timp: endpoint × model.
--    (folosită și de raportul zilnic, și de verificarea pragului)
create or replace function public.ai_cost_breakdown(
  p_since timestamptz,
  p_until timestamptz default null
) returns table (
  endpoint text,
  model text,
  actiuni int,
  lei numeric
) language sql stable security definer set search_path = public as $$
  select
    u.endpoint,
    u.model,
    count(*)::int                                as actiuni,
    round(sum(u.cost_micro) / 1e6::numeric, 4)   as lei
  from public.ai_usage u
  where u.created_at >= p_since
    and (p_until is null or u.created_at < p_until)
  group by u.endpoint, u.model
  order by lei desc, actiuni desc;
$$;

-- 3) Top utilizatori după cost pe o fereastră de timp (user_id NULL =
--    costurile de platformă: pre-generare etc.).
create or replace function public.ai_top_users(
  p_since timestamptz,
  p_limit int default 5
) returns table (
  user_id uuid,
  email text,
  full_name text,
  lei numeric,
  actiuni int
) language sql stable security definer set search_path = public as $$
  select
    u.user_id,
    p.email,
    p.full_name,
    round(sum(u.cost_micro) / 1e6::numeric, 4) as lei,
    count(*)::int                              as actiuni
  from public.ai_usage u
  left join public.profiles p on p.id = u.user_id
  where u.created_at >= p_since
  group by u.user_id, p.email, p.full_name
  order by lei desc
  limit greatest(p_limit, 1);
$$;

-- doar serverul le poate apela — ca la celelalte funcții AI
revoke all on function public.ai_cost_breakdown(timestamptz, timestamptz) from public;
revoke all on function public.ai_cost_breakdown(timestamptz, timestamptz) from anon;
revoke all on function public.ai_cost_breakdown(timestamptz, timestamptz) from authenticated;
revoke all on function public.ai_top_users(timestamptz, int) from public;
revoke all on function public.ai_top_users(timestamptz, int) from anon;
revoke all on function public.ai_top_users(timestamptz, int) from authenticated;

-- =====================================================================
-- VERIFICARE (opțional, după rulare):
--   select * from public.ai_cost_breakdown(now() - interval '24 hours');
--     → costul pe endpoint/model în ultimele 24h (gol dacă nu e activitate).
--   select * from public.ai_top_users(now() - interval '30 days', 10);
--     → top utilizatori pe ultimele 30 de zile.
-- =====================================================================
