-- Rulează în Supabase → SQL Editor → New Query

ALTER TABLE public.discussions ADD COLUMN IF NOT EXISTS category_key TEXT;
CREATE INDEX IF NOT EXISTS idx_disc_category ON public.discussions(category_key);
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
