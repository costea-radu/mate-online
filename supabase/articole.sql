-- =====================================================================
-- ExamenMate — FAZA 2 din GHID_AGENT_SEO_ACTIUNI.md
-- Pagina „Rezolvări" devine Blog/Rezolvări: articole, rezolvări scrise
-- și explicații INDEXABILE, fiecare cu URL propriu /rezolvari/{slug}.
-- Rulează în Supabase → SQL Editor → New Query. SIGUR DE RULAT REPETAT.
--
-- Cine scrie aici: DOAR serverul (service role), prin coada de aprobare
-- `seo_actions` (unealta publish_article / update_article a agentului SEO).
-- Cine citește: oricine — dar NUMAI articolele cu status='published'
-- (SPA-ul cu cheia anon + api/page-meta + api/sitemap).
-- =====================================================================

create table if not exists articole (
  slug         text primary key,     -- URL: /rezolvari/{slug} (doar a-z, 0-9, cratime)
  title        text not null,        -- titlul afișat (H1) + <title>
  description  text,                 -- meta description + textul cardului din listă
  category     text,                 -- aceleași valori ca filtrele paginii (clasa-5 … bacalaureat)
  kind         text not null default 'articol',  -- 'articol' | 'rezolvare' | 'explicatie'
  content_md   text not null,        -- sursa scrisă de agent (markdown)
  content_html text,                 -- HTML generat la publicare (api/_lib/markdown.js)
  keywords     text[],               -- cuvintele cheie țintite
  sources      jsonb,                -- materialele din site pe care se bazează:
                                     --   [{ table, id, title, category }] (îmbogățite la publicare)
  status       text not null default 'draft',   -- draft | published
  published_at timestamptz,
  updated_at   timestamptz default now()
);

-- constrângeri „defensive" (agentul e validat și în cod, dar DB-ul e plasa finală)
do $$ begin
  alter table articole add constraint articole_kind_chk
    check (kind in ('articol', 'rezolvare', 'explicatie'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table articole add constraint articole_status_chk
    check (status in ('draft', 'published'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table articole add constraint articole_slug_chk
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) between 3 and 120);
exception when duplicate_object then null; end $$;

-- Indexuri pentru listări (pagina Rezolvări, sitemap, articole înrudite)
create index if not exists idx_articole_status_pub on articole(status, published_at desc);
create index if not exists idx_articole_categorie  on articole(category, status);

-- RLS: scrierea DOAR de pe server (service role ocolește RLS);
-- citirea publică DOAR pentru articolele publicate (le folosește SPA-ul cu anon key)
alter table articole enable row level security;
drop policy if exists articole_public_read on articole;
create policy articole_public_read on articole for select using (status = 'published');
