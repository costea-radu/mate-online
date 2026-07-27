-- =====================================================================
-- supabase/email_system.sql — suport pentru sistemul de EMAIL
-- Rulează O DATĂ în Supabase → SQL Editor → New query → Run.
-- Sigur de rulat de mai multe ori (IF NOT EXISTS peste tot).
-- =====================================================================

-- 1) Preferințe email pe profil
--    email_alerts      = primește alerte pe email (profesori/părinți) — implicit DA
--    newsletter_opt_in = primește newsletterul — implicit DA (soft opt-in,
--                        fiecare email are link de dezabonare cu un click)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email_alerts BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS newsletter_opt_in BOOLEAN NOT NULL DEFAULT TRUE;

-- 2) Mesajele din formularul de contact (dovadă + anti-spam rate limit)
CREATE TABLE IF NOT EXISTS public.contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT,
  message TEXT NOT NULL,
  ip_hash TEXT,
  user_agent TEXT,
  handled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS contact_messages_ip_time_idx ON public.contact_messages (ip_hash, created_at DESC);
-- RLS pornit, FĂRĂ politici publice: doar serverul (service role) scrie/citește.
ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- 3) Campanii de newsletter (scrise de agentul SEO, trimise din admin)
CREATE TABLE IF NOT EXISTS public.newsletter_campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subject TEXT NOT NULL,
  markdown TEXT NOT NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.newsletter_campaigns ENABLE ROW LEVEL SECURITY;

-- 4) Evidența trimiterilor (fără duplicate între loturi / reluări)
CREATE TABLE IF NOT EXISTS public.newsletter_sends (
  campaign_id UUID NOT NULL REFERENCES public.newsletter_campaigns(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (campaign_id, user_id)
);
ALTER TABLE public.newsletter_sends ENABLE ROW LEVEL SECURITY;
