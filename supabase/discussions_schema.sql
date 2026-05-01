-- =====================================================
-- Schema pentru Discuții / Rezolvări
-- Rulează în Supabase → SQL Editor → New Query
-- =====================================================

-- Tabela principală: postări (comentarii + fișiere)
CREATE TABLE IF NOT EXISTS public.discussions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content_id UUID REFERENCES public.content(id) ON DELETE CASCADE, -- legătura cu un exercițiu (opțional)
  parent_id UUID REFERENCES public.discussions(id) ON DELETE CASCADE, -- răspuns la o postare
  body TEXT,                          -- textul comentariului
  file_url TEXT,                      -- URL fișier (poză/PDF) din Storage
  file_type TEXT,                     -- 'image' sau 'pdf'
  file_name TEXT,                     -- numele original al fișierului
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pentru performanță
CREATE INDEX IF NOT EXISTS idx_disc_content ON public.discussions(content_id);
CREATE INDEX IF NOT EXISTS idx_disc_parent  ON public.discussions(parent_id);
CREATE INDEX IF NOT EXISTS idx_disc_user    ON public.discussions(user_id);

-- RLS
ALTER TABLE public.discussions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Toți pot citi discuțiile"
  ON public.discussions FOR SELECT USING (true);

CREATE POLICY "Utilizatorii autentificați pot posta"
  ON public.discussions FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Utilizatorii pot edita propriile postări"
  ON public.discussions FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Utilizatorii pot șterge propriile postări"
  ON public.discussions FOR DELETE
  USING (auth.uid() = user_id);

-- Bucket Storage pentru fișierele uploadate de utilizatori
INSERT INTO storage.buckets (id, name, public)
VALUES ('discussions', 'discussions', true)
ON CONFLICT (id) DO NOTHING;

-- Politică Storage: oricine poate citi
CREATE POLICY "Discuții publice citire"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'discussions');

-- Politică Storage: utilizatorii autentificați pot uploada
CREATE POLICY "Discuții upload autentificat"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'discussions' AND
    auth.role() = 'authenticated'
  );

-- Politică Storage: utilizatorii pot șterge propriile fișiere
CREATE POLICY "Discuții ștergere proprie"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'discussions' AND
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Adaugă coloana category_key pentru discuții legate de o categorie (nu un exercițiu specific)
ALTER TABLE public.discussions ADD COLUMN IF NOT EXISTS category_key TEXT;
CREATE INDEX IF NOT EXISTS idx_disc_category ON public.discussions(category_key);
