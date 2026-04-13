-- Face bucket-ul content-files public
-- Rulează în Supabase → SQL Editor → New Query
UPDATE storage.buckets
SET public = true
WHERE id = 'content-files';
