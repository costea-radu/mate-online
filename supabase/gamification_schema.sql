-- =====================================================
-- Gamificare: insigne pentru elevi (Profesorul Virtual)
-- Rulează în Supabase → SQL Editor → New Query
-- =====================================================

CREATE TABLE IF NOT EXISTS public.user_badges (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  badge_id TEXT NOT NULL,            -- identificatorul insignei (vezi src/lib/badges.js)
  name TEXT,                         -- numele afișat (denormalizat, ca AI-ul să-l poată cita)
  icon TEXT,                         -- emoji-ul insignei
  earned_at TIMESTAMPTZ DEFAULT NOW(),
  meta JSONB,                        -- detalii opționale (ex: exercițiul care a declanșat-o)
  UNIQUE(user_id, badge_id)          -- o insignă se câștigă o singură dată
);

ALTER TABLE public.user_badges ENABLE ROW LEVEL SECURITY;

-- Elevul își vede și își primește doar propriile insigne
CREATE POLICY "Users can view own badges"
  ON public.user_badges FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own badges"
  ON public.user_badges FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_badges_user ON public.user_badges(user_id);
