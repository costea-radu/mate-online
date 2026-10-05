-- =====================================================================
-- ExamenMate · AGENȚII DIN ADMIN: verificarea materialelor + agentul de debug
--
--   content_checks — verificările materialelor (Admin → 🔎 Verificare materiale):
--                    raportul (problemele găsite, cu corecturile propuse), ciorna
--                    corecturii și publicarea ei (cu fișierul vechi păstrat, pentru
--                    „Anulează")
--   debug_runs     — rulările agentului de debug (Admin → 🐞 Agent debug): jurnalul,
--                    problemele găsite în cod, corecturile propuse și PR-ul pe GitHub
--   client_errors  — erorile JavaScript din browserele vizitatorilor (grupate pe
--                    „amprentă"), ca agentul de debug să pornească de la erorile reale
--
-- Toate scrierile trec prin server (api/content-check.js, api/admin-debug.js,
-- api/client-error.js — service role). Browserul nu citește direct nimic de aici.
--
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- =====================================================================

-- ─── 1. Verificările materialelor ─────────────────────────────────────────────
create table if not exists public.content_checks (
  id          uuid primary key default gen_random_uuid(),
  content_id  uuid not null references public.content(id) on delete cascade,
  file_url    text,                 -- fișierul verificat (la momentul verificării)
  file_hash   text,                 -- sha256: corectura se aplică doar pe exact acest fișier
  kind        text check (kind in ('pdf', 'html')),
  model       text,
  effort      text,
  status      text not null default 'ok',   -- ok | minore | probleme | critic | reparat
  verdict     text,
  summary     text,
  report      jsonb not null default '{}'::jsonb,   -- itemii verificați, tipul documentului, a doua opinie
  issues      jsonb not null default '[]'::jsonb,   -- problemele (+ corecturile propuse, dismissed/fixed)
  draft       jsonb,                -- ciorna corecturii (fișierul nou, nepublicat încă)
  fix         jsonb,                -- corectura publicată: fișierul vechi / nou (pentru „Anulează")
  second_of   uuid references public.content_checks(id) on delete set null,
  cost_micro  bigint not null default 0,            -- costul AI, în micro-lei
  tokens_in   integer,
  tokens_out  integer,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
create index if not exists idx_content_checks_content on public.content_checks(content_id, created_at desc);
create index if not exists idx_content_checks_created on public.content_checks(created_at desc);

-- ─── 2. Agentul de debug ─────────────────────────────────────────────────────
create table if not exists public.debug_runs (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'ruleaza',     -- ruleaza | gata | oprit | eroare
  scope       text,                 -- general | erori | live | plan | plati | … | custom
  area        text,                 -- zona efectiv verificată (la „general": aleasă prin rotație)
  focus       text,                 -- ce a cerut adminul, în cuvintele lui
  model       text,
  effort      text,
  repo        text,
  branch      text,
  base_sha    text,                 -- versiunea codului citită (commitul de pe GitHub)
  messages    jsonb not null default '[]'::jsonb,  -- conversația cu modelul (pentru pașii următori)
  log         jsonb not null default '[]'::jsonb,  -- jurnalul afișat în Admin
  findings    jsonb not null default '[]'::jsonb,  -- problemele / îmbunătățirile găsite
  fixes       jsonb not null default '[]'::jsonb,  -- corecturile propuse (diff) + decizia adminului
  report      text,                 -- raportul final al agentului
  pr          jsonb,                -- pull request-ul creat cu corecturile aprobate
  error       text,
  steps       integer not null default 0,
  turns       integer not null default 0,
  cost_micro  bigint not null default 0,
  tokens_in   bigint not null default 0,
  tokens_out  bigint not null default 0,
  budget_lei  numeric,
  locked_until timestamptz,         -- un singur pas în lucru odată (două taburi deschise nu se încurcă)
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_debug_runs_created on public.debug_runs(created_at desc);
alter table public.debug_runs add column if not exists area text;
alter table public.debug_runs add column if not exists locked_until timestamptz;

-- ─── 3. Erorile din browser ──────────────────────────────────────────────────
create table if not exists public.client_errors (
  fingerprint text primary key,     -- mesaj + primul cadru din stivă (aceeași eroare = un rând)
  message     text not null,
  stack       text,
  url         text,
  release     text,                 -- versiunea aplicației (data build-ului)
  user_agent  text,
  count       integer not null default 1,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create index if not exists idx_client_errors_last on public.client_errors(last_seen desc);

-- o eroare raportată: rândul ei crește (count), fără citiri din browser
create or replace function public.report_client_error(p_fp text, p_message text, p_stack text, p_url text, p_release text, p_ua text)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.client_errors(fingerprint, message, stack, url, release, user_agent)
  values (left(p_fp, 80), left(coalesce(p_message, ''), 500), left(p_stack, 4000), left(p_url, 500), left(p_release, 80), left(p_ua, 300))
  on conflict (fingerprint) do update
    set count = public.client_errors.count + 1, last_seen = now(), url = excluded.url,
        release = coalesce(excluded.release, public.client_errors.release), user_agent = excluded.user_agent;
end$$;
revoke all on function public.report_client_error(text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.report_client_error(text, text, text, text, text, text) to service_role;

-- ─── 4. ROW LEVEL SECURITY — doar serverul citește și scrie ──────────────────
alter table public.content_checks enable row level security;
alter table public.debug_runs     enable row level security;
alter table public.client_errors  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['content_checks', 'debug_runs', 'client_errors'] loop
    if not exists (select 1 from pg_policies where tablename = t and policyname = t || '_service') then
      execute format('create policy %I on public.%I for all using ((select auth.role()) = ''service_role'') with check ((select auth.role()) = ''service_role'')', t || '_service', t);
    end if;
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ─── 5. Curățenie: erorile vechi de 60 de zile (rulat de cronul agentului) ───
create or replace function public.client_errors_purge() returns int
language sql security definer set search_path = public as $$
  with d as (delete from public.client_errors where last_seen < now() - interval '60 days' returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.client_errors_purge() from public, anon, authenticated;
grant execute on function public.client_errors_purge() to service_role;
