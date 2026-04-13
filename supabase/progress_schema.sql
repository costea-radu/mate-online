-- =====================================================
-- Tabelă pentru tracking progres exerciții interactive
-- Rulează în Supabase → SQL Editor → New Query
-- =====================================================

CREATE TABLE IF NOT EXISTS public.progress (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  content_id UUID REFERENCES public.content(id) ON DELETE CASCADE NOT NULL,
  score INTEGER NOT NULL DEFAULT 0,         -- punctaj obținut (0-100)
  max_score INTEGER NOT NULL DEFAULT 100,   -- punctaj maxim posibil
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  attempts INTEGER DEFAULT 1,               -- număr de încercări
  UNIQUE(user_id, content_id)               -- un singur record per user per exercițiu
);

-- RLS
ALTER TABLE public.progress ENABLE ROW LEVEL SECURITY;

-- Utilizatorul vede și modifică doar propriul progres
CREATE POLICY "Users can view own progress"
  ON public.progress FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own progress"
  ON public.progress FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own progress"
  ON public.progress FOR UPDATE
  USING (auth.uid() = user_id);

-- Index pentru performanță
CREATE INDEX IF NOT EXISTS idx_progress_user ON public.progress(user_id);
CREATE INDEX IF NOT EXISTS idx_progress_content ON public.progress(content_id);
