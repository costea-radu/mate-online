-- Rulează în Supabase → SQL Editor → New Query

CREATE TABLE IF NOT EXISTS public.rezolvari (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,          -- clasa-5..12, evaluare-nationala, bacalaureat, general
  content_id UUID REFERENCES public.content(id) ON DELETE SET NULL, -- exercițiu asociat (opțional)
  type TEXT NOT NULL,     -- 'image', 'pdf', 'video'
  file_url TEXT,          -- URL fișier (imagine/PDF din Storage)
  video_url TEXT,         -- URL YouTube/TikTok
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rez_category ON public.rezolvari(category);
CREATE INDEX IF NOT EXISTS idx_rez_type ON public.rezolvari(type);

ALTER TABLE public.rezolvari ENABLE ROW LEVEL SECURITY;

-- Toți pot citi
CREATE POLICY "rezolvari_select" ON public.rezolvari
  FOR SELECT USING (true);

-- Doar service_role poate modifica (prin admin API)
CREATE POLICY "rezolvari_service" ON public.rezolvari
  FOR ALL USING (auth.role() = 'service_role');

-- Adaugă câmpul is_free la rezolvari
ALTER TABLE public.rezolvari ADD COLUMN IF NOT EXISTS is_free BOOLEAN DEFAULT true;
