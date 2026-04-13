-- =====================================================
-- Fix RLS: conținutul premium e vizibil tuturor (metadate)
-- dar fișierele rămân protejate prin signed URL
-- Rulează în Supabase → SQL Editor → New Query
-- =====================================================

-- Șterge politicile vechi pentru content
DROP POLICY IF EXISTS "Free content visible to everyone" ON public.content;
DROP POLICY IF EXISTS "Premium content visible to subscribers" ON public.content;
DROP POLICY IF EXISTS "Service role full access to content" ON public.content;
DROP POLICY IF EXISTS "Authenticated users can insert content" ON public.content;
DROP POLICY IF EXISTS "Authenticated users can delete content" ON public.content;

-- Politică nouă: TOT conținutul e vizibil tuturor (SELECT)
-- Protecția reală e la nivel de fișier (signed URL în Storage)
CREATE POLICY "All content visible to everyone"
  ON public.content FOR SELECT
  USING (true);

-- Insert/Delete doar pentru utilizatori autentificați
CREATE POLICY "Authenticated users can insert content"
  ON public.content FOR INSERT
  WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can delete content"
  ON public.content FOR DELETE
  USING (auth.role() = 'authenticated');

-- Service role acces complet
CREATE POLICY "Service role full access to content"
  ON public.content FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
