-- =====================================================================
-- FIX SECURITATE — bucket-ul content-files trebuie să fie PRIVAT
-- Rulează în: Supabase → SQL Editor → New Query
-- ⚠️ RULEAZĂ DOAR DUPĂ ce ai DEPLOYAT codul din acest lot (vezi mai jos).
-- =====================================================================
-- PROBLEMA: existau două scripturi contradictorii (make_content_bucket_public.sql
-- vs make_content_bucket_private.sql). Dacă bucket-ul e PUBLIC, PDF-urile premium
-- sunt descărcabile direct de la `content.file_url` (un URL public), iar tabela
-- `content` e world-readable (RLS SELECT true) → oricine citește file_url-ul și
-- descarcă premium-ul. Semnarea din get-file-url devine inutilă.
--
-- CONDIȚIE ca să nu rupi conținutul GRATUIT: în lotul acesta de cod, TOT
-- conținutul (gratuit + premium) e servit acum prin URL-uri SEMNATE
-- (get-file-url, get-preview-url — care descarcă pe server). Semnarea merge și pe
-- bucket privat. Deci: DEPLOY codul întâi, apoi rulează acest script.
--
-- Verifică starea curentă înainte:
--   SELECT id, public FROM storage.buckets WHERE id = 'content-files';
-- =====================================================================

-- 1) Bucket-ul devine privat.
UPDATE storage.buckets SET public = false WHERE id = 'content-files';

-- 2) Politica de storage pentru service_role (semnarea URL-urilor pe server).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Service role full access storage'
  ) THEN
    CREATE POLICY "Service role full access storage"
      ON storage.objects FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- 3) ⚠️ ȘTERGE fișierul supabase/make_content_bucket_public.sql din repo
--    (git rm) ca să nu fie re-rulat din greșeală și să redeschidă gaura.
