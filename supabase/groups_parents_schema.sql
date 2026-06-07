-- =====================================================
-- ExamenMate – Grupe, cont Părinte, asociere multiplă, timp
-- Rulează în Supabase → SQL Editor → New Query (idempotent).
-- =====================================================

-- 1. Permite rolul 'parinte' (pe lângă 'elev' și 'profesor')
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'profiles_role_check') THEN
    ALTER TABLE public.profiles DROP CONSTRAINT profiles_role_check;
  END IF;
  ALTER TABLE public.profiles
    ADD CONSTRAINT profiles_role_check
    CHECK (role IS NULL OR role IN ('elev', 'profesor', 'parinte'));
END$$;

-- 2. Timp petrecut (secunde) pe exercițiu
ALTER TABLE public.progress ADD COLUMN IF NOT EXISTS time_spent INTEGER DEFAULT 0;

-- 3. Grupe create de profesor
CREATE TABLE IF NOT EXISTS public.mentor_groups (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mentor_groups_teacher ON public.mentor_groups(teacher_id);

-- 4. Asociere multiplă elev ↔ mentor (profesor SAU părinte)
--    Un elev poate fi asociat cu mai mulți profesori și mai mulți părinți.
CREATE TABLE IF NOT EXISTS public.mentor_students (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mentor_id  UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  student_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE NOT NULL,
  mentor_role TEXT NOT NULL CHECK (mentor_role IN ('profesor', 'parinte')),
  group_id UUID REFERENCES public.mentor_groups(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (mentor_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_mentor_students_mentor  ON public.mentor_students(mentor_id);
CREATE INDEX IF NOT EXISTS idx_mentor_students_student ON public.mentor_students(student_id);
CREATE INDEX IF NOT EXISTS idx_mentor_students_group   ON public.mentor_students(group_id);

-- 5. RLS pe tabelele noi (accesate doar prin funcțiile serverless cu service_role,
--    care ocolesc RLS). Activăm RLS fără politici permisive = închis pentru anon.
ALTER TABLE public.mentor_groups   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mentor_students ENABLE ROW LEVEL SECURITY;

-- 6. Migrare: asocierile existente (profiles.teacher_id) → mentor_students
INSERT INTO public.mentor_students (mentor_id, student_id, mentor_role)
SELECT teacher_id, id, 'profesor'
FROM public.profiles
WHERE teacher_id IS NOT NULL
ON CONFLICT (mentor_id, student_id) DO NOTHING;

-- ── Verificare (opțional) ──────────────────────────────────────────
-- SELECT * FROM public.mentor_students;
-- SELECT * FROM public.mentor_groups;
