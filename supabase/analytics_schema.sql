-- =====================================================
-- Schema pentru analytics (vizitatori)
-- Rulează în Supabase → SQL Editor → New Query
-- =====================================================

CREATE TABLE IF NOT EXISTS public.analytics (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  page TEXT NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_page ON public.analytics(page);
CREATE INDEX IF NOT EXISTS idx_analytics_date ON public.analytics(created_at);

ALTER TABLE public.analytics ENABLE ROW LEVEL SECURITY;

-- Oricine poate insera (inclusiv anonim)
CREATE POLICY "analytics_insert" ON public.analytics FOR INSERT WITH CHECK (true);
-- Doar service_role poate citi (pentru admin)
CREATE POLICY "analytics_select_service" ON public.analytics FOR SELECT USING (auth.role() = 'service_role');

-- Funcție pentru top pagini
CREATE OR REPLACE FUNCTION public.top_pages(since TIMESTAMPTZ)
RETURNS TABLE(page TEXT, visits BIGINT) AS $$
  SELECT page, COUNT(*) as visits
  FROM public.analytics
  WHERE created_at >= since
  GROUP BY page
  ORDER BY visits DESC
  LIMIT 10;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;

-- Funcție pentru vizite zilnice
CREATE OR REPLACE FUNCTION public.daily_visits(since TIMESTAMPTZ)
RETURNS TABLE(day DATE, visits BIGINT) AS $$
  SELECT DATE(created_at) as day, COUNT(*) as visits
  FROM public.analytics
  WHERE created_at >= since
  GROUP BY DATE(created_at)
  ORDER BY day ASC;
$$ LANGUAGE sql SECURITY DEFINER SET search_path = public;
