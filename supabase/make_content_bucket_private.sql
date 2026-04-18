-- Pasul 1: Face bucket-ul content-files privat din nou
UPDATE storage.buckets
SET public = false
WHERE id = 'content-files';

-- Pasul 2: Politică RLS — service_role poate genera signed URLs
-- (dacă nu există deja)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'objects'
    AND schemaname = 'storage'
    AND policyname = 'Service role full access storage'
  ) THEN
    CREATE POLICY "Service role full access storage"
      ON storage.objects FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;
