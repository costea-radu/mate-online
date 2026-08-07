-- =====================================================================
-- CORECTAREA AI A TESTELOR ȘI EXERCIȚIILOR PDF (Prof. Virtual / Meditator)
-- Rulează în Supabase → SQL Editor → New Query.
--
-- Ce face:
--  1) Tabelul ai_pdf_results — punctajele exercițiilor corectate de AI
--     pentru materialele care NU sunt în platformă (poze / PDF-uri încărcate
--     de elev în chat). Corectările testelor PDF DIN platformă se salvează
--     în `progress` (același loc ca testele interactive) și apar automat
--     în conturile de profesor / părinte / elev.
--  2) RLS: elevul își vede doar propriile rezultate; scrierea se face de pe
--     server (service role), ca punctajele să nu poată fi falsificate.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.ai_pdf_results (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- materialul din platformă (dacă există); NULL = poză / PDF încărcat de elev
  content_id UUID REFERENCES public.content(id) ON DELETE SET NULL,
  -- cheia stabilă a exercițiului: content_id (site) sau hash-ul textului (încărcat)
  source_key TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'incarcat',      -- 'pdf' (din site) | 'incarcat' (poză/PDF din chat)
  title TEXT NOT NULL DEFAULT 'Exercițiu corectat de Prof. Virtual',
  category TEXT,                                -- ex. evaluare-nationala / bacalaureat / clasa-7
  score NUMERIC NOT NULL DEFAULT 0,
  max_score NUMERIC NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 1,
  time_spent INTEGER NOT NULL DEFAULT 0,        -- secunde, cumulat
  used_tutor BOOLEAN NOT NULL DEFAULT TRUE,     -- corectat în chatul Prof. Virtual
  breakdown JSONB,                              -- punctajul pe exerciții / subpuncte a), b), c)
  feedback TEXT,                                -- rezumatul corectării
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (user_id, source_key)                  -- reîncercările se cumulează pe același rând
);

CREATE INDEX IF NOT EXISTS idx_ai_pdf_results_user ON public.ai_pdf_results(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_pdf_results_content ON public.ai_pdf_results(content_id);

ALTER TABLE public.ai_pdf_results ENABLE ROW LEVEL SECURITY;

-- Elevul își vede propriile rezultate (contul de elev → „Rezultatele mele")
DROP POLICY IF EXISTS "ai_pdf_results_select_own" ON public.ai_pdf_results;
CREATE POLICY "ai_pdf_results_select_own"
  ON public.ai_pdf_results FOR SELECT
  USING (auth.uid() = user_id);

-- Scrierea se face DOAR de pe server (service role) — punctajul vine din corectarea AI
DROP POLICY IF EXISTS "ai_pdf_results_service_all" ON public.ai_pdf_results;
CREATE POLICY "ai_pdf_results_service_all"
  ON public.ai_pdf_results FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
