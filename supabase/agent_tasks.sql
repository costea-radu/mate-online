-- =====================================================================
-- ExamenMate — TASK-URI PROGRAMATE pentru agentul Claude de exerciții
-- (ca „scheduled tasks" din Claude.ai, dar cu RUBRICA site-ului pe post
-- de context: clase / tipuri de examene, în care agentul lucrează și în
-- care poate POSTA AUTOMAT după generare).
--
-- Rulează în Supabase → SQL Editor → New Query. SIGUR DE RULAT REPETAT.
-- Se administrează DOAR de pe server (service role) — rutele:
--   api/agent-tasks.js (CRUD + rulare manuală, doar admin)
--   api/agent-cron.js  (cron orar Vercel: execută task-urile scadente)
-- =====================================================================

-- Definițiile task-urilor programate
create table if not exists agent_tasks (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  name          text not null,                       -- numele dat de admin
  enabled       boolean not null default true,

  -- PROGRAMUL (orele sunt ORA ROMÂNIEI — Europe/Bucharest; cronul convertește)
  schedule_kind text not null default 'weekly'
                check (schedule_kind in ('daily','weekly','monthly')),
  run_hour      int  not null default 7  check (run_hour between 0 and 23),
  run_weekday   int  not null default 1  check (run_weekday between 1 and 7),   -- 1=luni … 7=duminică (la weekly)
  run_monthday  int  not null default 1  check (run_monthday between 1 and 28), -- ziua lunii (la monthly)

  -- CONTEXTUL: rubrica site-ului în care lucrează și postează agentul
  category      text not null,                       -- 'clasa-5'…'clasa-8' | 'evaluare-nationala' | 'bacalaureat'
  subcategory   text,                                -- ex. 'variante', 'simulari', 'teste-interactive', 'a+b' = mix
  profile       text,                                -- profil BAC: 'tehnologic' | 'stiinte-naturii' | 'mate-info'
  ctype         text not null default 'interactive'
                check (ctype in ('pdf','interactive')),  -- tipul SURSELOR din rubrică

  -- CONTEXT SUPLIMENTAR (opțional): alte rubrici-referință (ex. baremele
  -- testelor) — array de {category, subcategory, profile, ctype}, max 3.
  -- NU sunt teste-sursă de combinat; agentul le primește ca referință.
  extra_rubrics jsonb,

  -- CE generează (aceleași opțiuni ca automatizarea manuală din admin)
  result_kind   text not null default 'auto'
                check (result_kind in ('auto','interactive','exam','format')),
  data_mode     text not null default 'modify' check (data_mode in ('keep','modify')),
  instructions  text,                                -- instrucțiuni opționale pentru agent
  ai_model      text,                                -- ID Claude (ex. 'claude-opus-5'); null = implicitul serverului

  -- MODELUL DE FORMAT (la result_kind='format'): fișier HTML/PDF încărcat de
  -- admin, păstrat în Storage — {bucket, path, name, kind:'html'|'pdf'}.
  -- HTML → rezultatul clonează EXACT designul lui; PDF → structura testului.
  format_model  jsonb,

  -- POSTAREA
  auto_post     boolean not null default false,      -- true = publică direct pe site; false = așteaptă aprobarea
  is_free       boolean not null default false,      -- materialul postat: gratuit sau premium
  post_type     text not null default 'test' check (post_type in ('exercise','test')),
  notify        boolean not null default true,       -- email către admin după fiecare rulare

  -- PROGRESUL modului „pe rând" (instrucțiuni de tip „ia pe rând fișierele"):
  -- id-urile materialelor din rubrică deja procesate de acest task
  seq_done      jsonb,

  -- STAREA ultimei rulări (istoricul complet e în agent_task_runs)
  last_run_at   timestamptz,
  last_status   text,                                -- 'posted' | 'pending_review' | 'skipped' | 'error'
  last_error    text
);

-- Istoricul rulărilor (rezultatele „așteaptă aprobare" stau în `result`)
create table if not exists agent_task_runs (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  task_id       uuid not null references agent_tasks(id) on delete cascade,
  trigger_kind  text not null default 'cron',        -- 'cron' | 'manual'
  status        text not null,                       -- 'posted' | 'pending_review' | 'error'
  title         text,                                -- titlul testului generat
  provider      text,                                -- modelul Claude folosit
  content_id    uuid,                                -- rândul din `content` (după postare)
  error         text,
  combined_from jsonb,                               -- titlurile testelor-sursă
  result        jsonb                                -- {kind:'html',html} sau {kind:'exercise',exercise} — golit după postare
);

-- MIGRARE pentru instalările care au rulat deja versiunea inițială a acestui
-- script (create table if not exists NU adaugă coloane noi la tabele vechi):
alter table agent_tasks add column if not exists extra_rubrics jsonb;
alter table agent_tasks add column if not exists format_model  jsonb;
alter table agent_tasks add column if not exists seq_done      jsonb;
alter table agent_tasks drop constraint if exists agent_tasks_result_kind_check;
alter table agent_tasks add  constraint agent_tasks_result_kind_check
  check (result_kind in ('auto','interactive','exam','format'));

create index if not exists idx_agent_tasks_enabled  on agent_tasks(enabled, run_hour);
create index if not exists idx_agent_task_runs_task on agent_task_runs(task_id, created_at desc);

-- RLS: acces DOAR de pe server (service role ocolește RLS). Politicile
-- deny-all explicite documentează intenția și țin liniștit Supabase Advisor
-- (același tipar ca supabase/fix_rls_info_lints.sql).
alter table agent_tasks     enable row level security;
alter table agent_task_runs enable row level security;

drop policy if exists agent_tasks_service_only on agent_tasks;
create policy agent_tasks_service_only on agent_tasks
  for all to anon, authenticated using (false) with check (false);

drop policy if exists agent_task_runs_service_only on agent_task_runs;
create policy agent_task_runs_service_only on agent_task_runs
  for all to anon, authenticated using (false) with check (false);

revoke all on agent_tasks     from anon, authenticated;
revoke all on agent_task_runs from anon, authenticated;

-- Verificare (așteptat: 2 rânduri cu rls_enabled = true)
select relname as tabel, relrowsecurity as rls_enabled
from pg_class
where relname in ('agent_tasks', 'agent_task_runs');
