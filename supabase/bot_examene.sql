-- =====================================================================
-- ExamenMate · 🤖 BOTUL DE EXAMENE (30 octombrie 2026)
--
-- Caută pe internet subiectele oficiale de matematică (EN, BAC Mate-Info /
-- Științele Naturii / Tehnologic: variante date în sesiune, rezerve, sesiunea
-- specială pentru olimpici, simulări, modele, teste de antrenament) și baremele
-- lor, le publică în rubrica potrivită și verifică dacă fiecare subiect de pe
-- site are baremul lui. Admin → „📚 Bot examene"; cronul: /api/exam-bot?action=cron.
--
--   exam_bot_items  — fiecare fișier găsit online: de unde (articol / pagină),
--                     ce este (clasificarea), ce a făcut botul cu el (publicat,
--                     de verificat, duplicat, ignorat + motivul)
--   exam_bot_index  — fiecare PDF de EN / BAC de pe site: amprenta lui, baremul
--                     pe care îl vede site-ul și dovada potrivirii, căutarea online
--   exam_bot_runs   — jurnalul rulărilor (cron + butoanele din Admin)
--   exam_bot_pages  — articolele / paginile deja citite (nu se recitesc zilnic)
--   ai_pdf_text.barem_override_by — cine a legat baremul: 'admin' sau 'bot'
--
-- Toate citirile și scrierile trec prin server (api/exam-bot.js, rolul de
-- serviciu). Fără acces pentru vizitatori (anon) — datele sunt doar pentru Admin.
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- =====================================================================

-- ─── 1. Fișierele găsite online ──────────────────────────────────────────────
create table if not exists public.exam_bot_items (
  id            uuid primary key default gen_random_uuid(),
  url           text not null unique,                 -- PDF-ul (sau „arhiva.zip#fisier.pdf")
  source        text,                                 -- edupedu | subiecte.edu.ro | edu.ro | pagina | cautare | ai | ghicit | arhiva | bot
  page_url      text,                                 -- articolul / pagina unde a apărut
  page_title    text,
  page_date     timestamptz,
  link_text     text,
  file_name     text,                                 -- numele original al fișierului
  parent_id     uuid references public.exam_bot_items(id) on delete set null,   -- arhiva din care a ieșit
  status        text not null default 'nou'
                check (status in ('nou', 'publicat', 'asteptare', 'duplicat', 'ignorat', 'respins', 'eroare')),
  confidence    text,                                 -- sigur | nesigur
  cls           jsonb,                                -- examen, an, profil, felul, varianta, barem…
  reasons       jsonb,                                -- de ce (ignorat / de verificat / duplicat)
  pair_key      text,                                 -- subiectul și baremul lui au aceeași pereche
  identity      text,
  sha256        text,
  bytes         integer,
  pages         integer,
  text_head     text,                                 -- începutul textului (previzualizare în Admin)
  fp            jsonb,                                -- amprenta textului (duplicate)
  content_id    uuid references public.content(id) on delete set null,   -- materialul publicat (sau cel care există deja)
  attempts      integer not null default 0,
  last_error    text,
  found_at      timestamptz not null default now(),
  processed_at  timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.exam_bot_items enable row level security;

grant select, insert, update, delete on public.exam_bot_items to authenticated;
grant select, insert, update, delete on public.exam_bot_items to service_role;

create index if not exists idx_exam_bot_items_status on public.exam_bot_items(status, found_at);
create index if not exists idx_exam_bot_items_sha on public.exam_bot_items(sha256);
create index if not exists idx_exam_bot_items_pair on public.exam_bot_items(pair_key);
create index if not exists idx_exam_bot_items_content on public.exam_bot_items(content_id);

-- ─── 2. Indexul PDF-urilor de pe site (raportul baremelor) ───────────────────
create table if not exists public.exam_bot_index (
  content_id     uuid primary key references public.content(id) on delete cascade,
  file_url       text,
  title          text,
  category       text,
  subcategory    text,
  profile        text,
  is_barem       boolean not null default false,
  needs_barem    boolean not null default false,       -- variante / simulări / teste de antrenament
  tokens         jsonb,                                -- an, variantă, profil, felul (titlu + fișier + antet)
  describe       text,
  fp             jsonb,
  sha256         text,
  barem_status   text,                                 -- ok | ok_antet | ok_continut | inclus | ok_admin | ok_bot | negasit | ambiguu | continut_diferit | este_barem | nu_necesita | fara_text | eroare
  barem_id       uuid references public.content(id) on delete set null,
  barem_title    text,
  barem_how      text,
  barem_evidence text,
  barem_score    real,
  search_status  text,                                 -- gasit | negasit_online | fara_text
  searched_at    timestamptz,
  search_note    text,
  ignored        boolean not null default false,       -- adminul: „nu are barem / nu mai căuta"
  error          text,
  checked_at     timestamptz
);
alter table public.exam_bot_index enable row level security;

grant select, insert, update, delete on public.exam_bot_index to authenticated;
grant select, insert, update, delete on public.exam_bot_index to service_role;

create index if not exists idx_exam_bot_index_status on public.exam_bot_index(needs_barem, barem_status);

-- ─── 3. Jurnalul rulărilor ───────────────────────────────────────────────────
create table if not exists public.exam_bot_runs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,                        -- descoperire | verificare | bareme
  by            text not null default 'admin',        -- admin | cron
  status        text not null default 'ruleaza'
                check (status in ('ruleaza', 'ok', 'eroare', 'oprit')),
  note          text,
  started_at    timestamptz not null default now(),
  heartbeat_at  timestamptz not null default now(),
  finished_at   timestamptz,
  stats         jsonb not null default '{}'::jsonb,
  log           jsonb not null default '[]'::jsonb,
  cost_usd      numeric not null default 0             -- doar căutarea web / AI (botul în sine: 0)
);
alter table public.exam_bot_runs enable row level security;

grant select, insert, update, delete on public.exam_bot_runs to authenticated;
grant select, insert, update, delete on public.exam_bot_runs to service_role;

create index if not exists idx_exam_bot_runs_started on public.exam_bot_runs(started_at desc);
create index if not exists idx_exam_bot_runs_running on public.exam_bot_runs(status, heartbeat_at) where status = 'ruleaza';

-- ─── 4. Paginile citite ──────────────────────────────────────────────────────
create table if not exists public.exam_bot_pages (
  url         text primary key,
  title       text,
  source      text,
  links       integer not null default 0,
  first_seen  timestamptz not null default now(),
  seen_at     timestamptz not null default now()
);
alter table public.exam_bot_pages enable row level security;

grant select, insert, update, delete on public.exam_bot_pages to authenticated;
grant select, insert, update, delete on public.exam_bot_pages to service_role;

-- ─── 5. Politicile: doar serverul (rolul de serviciu) ────────────────────────
do $$
declare t text;
begin
  foreach t in array array['exam_bot_items', 'exam_bot_index', 'exam_bot_runs', 'exam_bot_pages'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_service') then
      execute format('create policy %I on public.%I for all to service_role using (true) with check (true)', t || '_service', t);
    end if;
  end loop;
end $$;
-- (fără politici pentru `authenticated`: RLS îi refuză pe toți ceilalți; Admin citește prin API)

-- ─── 6. Cine a legat baremul de subiect (Profesorul Virtual îl arată) ────────
-- (ai_pdf_text vine din supabase/ai_pdf_cache.sql; dacă lipsește, pasul se sare)
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'ai_pdf_text') then
    alter table public.ai_pdf_text add column if not exists barem_override_by text;
    comment on column public.ai_pdf_text.barem_override_by is
      'Cine a ales baremul din barem_override_id: admin (manual) sau bot (botul de examene, după verificarea titlului, a numelui fișierului, a antetului și a conținutului).';
  end if;
end $$;

-- Verificare rapidă:
-- select status, count(*) from public.exam_bot_items group by status;
-- select barem_status, count(*) from public.exam_bot_index where needs_barem group by barem_status;
-- select kind, by, status, started_at, stats from public.exam_bot_runs order by started_at desc limit 10;
