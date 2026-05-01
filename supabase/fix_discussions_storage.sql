-- Fix politici Storage pentru bucket-ul discussions
-- Rulează în Supabase → SQL Editor → New Query

-- Șterge politicile existente (pot fi incorecte)
DROP POLICY IF EXISTS "Discuții publice citire" ON storage.objects;
DROP POLICY IF EXISTS "Discuții upload autentificat" ON storage.objects;
DROP POLICY IF EXISTS "Discuții ștergere proprie" ON storage.objects;

-- Recreează politici corecte
CREATE POLICY "discussions_select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'discussions');

CREATE POLICY "discussions_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'discussions'
    AND auth.role() = 'authenticated'
  );

CREATE POLICY "discussions_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'discussions'
    AND auth.uid()::text = (string_to_array(name, '/'))[1]
  );

-- Asigură că bucket-ul e public
UPDATE storage.buckets SET public = true WHERE id = 'discussions';
