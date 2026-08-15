-- =====================================================================
-- FIX CRITIC DE SECURITATE — scrierea în `content` DOAR pentru admini
-- Rulează în: Supabase → SQL Editor → New Query
-- =====================================================================
-- PROBLEMA: politicile din fix_content_rls.sql permiteau INSERT și DELETE
-- oricărui utilizator AUTENTIFICAT:
--     WITH CHECK (auth.role() = 'authenticated')   -- insert
--     USING      (auth.role() = 'authenticated')   -- delete
-- Cum Admin.jsx scrie/șterge conținut cu cheia din browser (rol authenticated),
-- calea reală de autorizare e RLS — iar RLS nu verifica deloc `is_admin`.
-- Rezultat: orice elev logat putea rula din consolă
--     supabase.from('content').delete().neq('id', '00000000-...')
-- și ȘTERGE TOT catalogul, sau putea injecta rânduri arbitrare.
--
-- SOLUȚIA: scrierile (INSERT/UPDATE/DELETE) devin permise doar dacă utilizatorul
-- are is_admin=true în profiles. Citirea rămâne publică (metadate publice;
-- fișierele sunt protejate separat prin signed URL). service_role păstrează
-- acces complet (endpoint-urile server care publică conținut generat).
-- Același tipar ca în admin_delete_policy.sql / pastreaza_rezultate.sql.
-- =====================================================================

-- 1) Șterge politicile permisive vechi (numele din fix_content_rls.sql).
DROP POLICY IF EXISTS "Authenticated users can insert content" ON public.content;
DROP POLICY IF EXISTS "Authenticated users can delete content" ON public.content;
DROP POLICY IF EXISTS "Authenticated users can update content" ON public.content;

-- 2) Politici noi, condiționate pe is_admin.
CREATE POLICY "Admins can insert content"
  ON public.content FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can update content"
  ON public.content FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can delete content"
  ON public.content FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- NOTĂ:
--   • Politica de SELECT ("All content visible to everyone" / "content_select_public",
--     USING (true)) rămâne NESCHIMBATĂ — metadatele conținutului sunt publice.
--   • Politica service_role ("Service role full access to content" /
--     "content_modify_service") rămâne NESCHIMBATĂ — endpoint-urile server
--     (ex. publicarea testelor generate) continuă să funcționeze.
--   • Grant-urile de tabel (authenticated are INSERT/UPDATE/DELETE) NU trebuie
--     retrase: ele sunt necesare ca RLS-ul de mai sus să poată permite adminului;
--     RLS e gardul real, nu grant-ul.

-- 3) (Opțional, verificare) — cine e admin:
--    SELECT id, email, is_admin FROM public.profiles WHERE is_admin = true;
