-- Permite service_role să vadă toate profilurile (pentru statistici admin)
-- Rulează în Supabase → SQL Editor → New Query

-- Politică existentă pentru service_role pe profiles
-- (dacă nu există deja din schema.sql)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'profiles' 
    AND policyname = 'Service role full access to profiles'
  ) THEN
    CREATE POLICY "Service role full access to profiles"
      ON public.profiles FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

-- IMPORTANT: Adaugă aceste variabile în Vercel → Settings → Environment Variables:
-- SUPABASE_URL = valoarea din Supabase → Settings → API → URL
-- SUPABASE_SERVICE_ROLE_KEY = valoarea din Supabase → Settings → API → service_role key
-- (acestea sunt diferite de VITE_SUPABASE_URL și VITE_SUPABASE_ANON_KEY)
