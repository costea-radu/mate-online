-- =====================================================
-- ExamenMate – Conturi: Profesor / Elev + asociere
-- Rulează acest SQL în Supabase → SQL Editor → New Query
-- Este idempotent (se poate rula de mai multe ori în siguranță).
-- =====================================================

-- 1. Coloane noi pe tabela de profiluri
--    role         : 'elev' sau 'profesor' (NULL = neales încă → se alege la prima logare)
--    teacher_code : cod unic de invitație al profesorului (folosit în linkul de asociere)
--    teacher_id   : pentru elevi, profilul profesorului cu care s-au asociat
--    teacher_name : numele profesorului (denormalizat, pentru afișare „Asociat cu Prof. ...")
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS teacher_code TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS teacher_name TEXT;

-- 2. Constrângere pe valorile permise pentru role (adăugată o singură dată)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_role_check
      CHECK (role IS NULL OR role IN ('elev', 'profesor'));
  END IF;
END$$;

-- 3. Index unic pe teacher_code (permite multipli NULL, dar coduri unice)
CREATE UNIQUE INDEX IF NOT EXISTS profiles_teacher_code_key
  ON public.profiles (teacher_code)
  WHERE teacher_code IS NOT NULL;

-- 4. Index pentru căutarea rapidă a elevilor unui profesor
CREATE INDEX IF NOT EXISTS idx_profiles_teacher_id ON public.profiles (teacher_id);

-- 5. Actualizează trigger-ul de creare automată a profilului
--    pentru a prelua tipul de cont (account_type) ales la înregistrare.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, avatar_url, role)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',  -- email/parolă
      NEW.raw_user_meta_data->>'name'         -- Google / Discord OAuth
    ),
    NEW.email,
    NEW.raw_user_meta_data->>'avatar_url',
    CASE
      WHEN NEW.raw_user_meta_data->>'account_type' IN ('elev', 'profesor')
        THEN NEW.raw_user_meta_data->>'account_type'
      ELSE NULL
    END
  )
  ON CONFLICT (id) DO UPDATE SET
    full_name  = COALESCE(EXCLUDED.full_name, profiles.full_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, profiles.avatar_url),
    role       = COALESCE(profiles.role, EXCLUDED.role);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- NOTĂ DESPRE SECURITATE
-- Citirea rezultatelor elevilor și asocierea elev↔profesor se fac prin
-- funcțiile serverless `api/teacher-students.js` și `api/asociere.js`,
-- care folosesc service_role (ocolesc RLS). Astfel nu sunt necesare
-- politici RLS suplimentare, iar profesorul vede doar elevii proprii.

-- ── Verificare (opțional) ──────────────────────────────────────────
-- SELECT id, email, role, teacher_code, teacher_id, teacher_name
-- FROM public.profiles ORDER BY created_at DESC LIMIT 20;
