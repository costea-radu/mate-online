-- =====================================================================
-- ExamenMate — FAZA 1 din GHID_AGENT_SEO_ACTIUNI.md
-- Fundația agentului SEO care ACȚIONEAZĂ: meta dinamice per rută,
-- coada de aprobare a acțiunilor și istoricul zilnic Search Console.
-- Rulează în Supabase → SQL Editor → New Query. SIGUR DE RULAT REPETAT.
-- =====================================================================

-- Meta dinamice per rută (servite la fiecare request de api/page-meta)
create table if not exists seo_meta (
  route       text primary key,      -- '/', '/evaluare-nationala', '/rezolvari/arii-clasa-7'
  title       text not null,         -- max ~60 caractere
  description text not null,         -- max ~155 caractere
  og_image    text,                  -- URL imagine pentru share (opțional)
  jsonld      jsonb,                 -- date structurate (opțional)
  updated_at  timestamptz default now(),
  updated_by  text default 'agent'
);

-- Coada de acțiuni a agentului: propus → aprobat → executat
create table if not exists seo_actions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  type        text not null,          -- 'set_page_meta' | 'publish_article' | 'rename_material' | 'schedule_social' | 'submit_sitemap'
  payload     jsonb not null,         -- parametrii acțiunii (din el se afișează diff-ul; păstrează și valorile VECHI)
  note        text,                   -- explicația agentului: DE CE propune asta
  status      text not null default 'proposed',  -- proposed|approved|rejected|executed|failed|reverted
  result      jsonb,                  -- rezultatul execuției (ce s-a scris, eroarea etc.)
  decided_at  timestamptz,
  executed_at timestamptz
);

-- Istoric zilnic Search Console — trenduri și măsurarea efectului fiecărei optimizări
create table if not exists gsc_snapshots (
  day         date not null,
  dim         text not null,          -- 'query' | 'page'
  key         text not null,          -- interogarea sau ruta paginii
  clicks      int default 0,
  impressions int default 0,
  ctr         numeric,
  position    numeric,
  primary key (day, dim, key)
);

-- Indexuri pentru listările din admin și pentru rapoartele agentului
create index if not exists idx_seo_actions_status  on seo_actions(status, created_at desc);
create index if not exists idx_gsc_snapshots_dim   on gsc_snapshots(dim, key, day);

-- RLS: tabelele se administrează DOAR de pe server (service role ocolește RLS)
alter table seo_meta      enable row level security;
alter table seo_actions   enable row level security;
alter table gsc_snapshots enable row level security;

-- seo_meta nu conține nimic sensibil — poate fi citit public (îl folosește și SPA-ul)
drop policy if exists seo_meta_public_read on seo_meta;
create policy seo_meta_public_read on seo_meta for select using (true);
