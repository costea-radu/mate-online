-- Permite citirea profilurilor publice (nume, avatar) pentru discuții
-- Rulează în Supabase → SQL Editor → New Query

-- Verifică politicile existente pe profiles
-- Adaugă politică de citire publică pentru câmpurile non-sensibile
DROP POLICY IF EXISTS "Public profiles readable" ON public.profiles;

CREATE POLICY "Public profiles readable"
  ON public.profiles FOR SELECT
  USING (true);
