-- =====================================================================
-- ExamenMate — FAZA 3 din GHID_AGENT_SEO_ACTIUNI.md
-- Calendarul de social media al agentului SEO: postări Facebook/Instagram
-- publicate AUTOMAT de cron (api/social-cron.js) + coada MANUALĂ pentru
-- TikTok/YouTube (copy-paste din admin, 5 min/zi).
-- Rulează în Supabase → SQL Editor → New Query. SIGUR DE RULAT REPETAT.
--
-- Cine scrie aici: DOAR serverul (service role), prin coada de aprobare
-- `seo_actions` (unealta schedule_social a agentului) + cron + admin.
-- Cine citește: DOAR serverul (api/social-queue.js, admin-only). Fără
-- politici publice — tabelul conține tokenuri de campanie și erori interne.
-- =====================================================================

create table if not exists social_posts (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null,         -- 'facebook' | 'instagram' | 'tiktok' | 'youtube'
  text_content text not null,         -- textul postării (cu hashtag-uri)
  media_url    text,                  -- imagine/video; OBLIGATORIU la Instagram
  link_url     text,                  -- linkul FINAL (cu UTM aplicat la propunere)
  campaign     text,                  -- slugul utm_campaign (raportare GA4)
  image        jsonb,                 -- șablonul cardului generat de api/social-image
                                      --   { template, title, subtitle, badge }
  scheduled_at timestamptz,           -- când se publică (null = cât mai curând)
  status       text not null default 'draft',
                                      -- draft    = propunere neaprobată încă
                                      -- approved = aprobată, așteaptă cron-ul (FB/IG)
                                      -- manual   = TikTok/YouTube — de postat de mână
                                      -- posted   = publicată (external_id / permalink)
                                      -- failed   = publicarea a eșuat (vezi error)
                                      -- canceled = anulată de admin / revert
  external_id  text,                  -- id-ul postării în Graph API după publicare
  posted_at    timestamptz,
  error        text,                  -- ultima eroare de publicare (pentru retry)
  metrics      jsonb,                 -- insights: reach/likes/comments/permalink…
  metrics_at   timestamptz,           -- când s-au citit ultima dată metricile
  action_id    uuid,                  -- legătura cu rândul din seo_actions
  created_at   timestamptz default now()
);

-- constrângeri „defensive" (agentul e validat și în cod, dar DB-ul e plasa finală)
do $$ begin
  alter table social_posts add constraint social_posts_platform_chk
    check (platform in ('facebook', 'instagram', 'tiktok', 'youtube'));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table social_posts add constraint social_posts_status_chk
    check (status in ('draft', 'approved', 'manual', 'posted', 'failed', 'canceled'));
exception when duplicate_object then null; end $$;

-- Indexuri: cron-ul caută postările approved scadente; adminul listează recent
create index if not exists idx_social_posts_due    on social_posts(status, scheduled_at);
create index if not exists idx_social_posts_recent on social_posts(created_at desc);

-- RLS: acces DOAR de pe server (service role ocolește RLS; nicio politică publică)
alter table social_posts enable row level security;
