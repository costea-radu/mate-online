-- =====================================================================
-- supabase/inactive_accounts.sql — POLITICA DE CONTURI INACTIVE
--
-- Ce face:
--   • adaugă pe `profiles` coloanele de urmărire a activității și ale
--     ștergerii programate (avertizare la 12 luni, ștergere după 30 zile);
--   • creează tabela `archived_student_results` — la ștergerea unui elev,
--     rezultatele lui la teste și activitatea rămân la profesor/părinte,
--     care le poate șterge definitiv din dashboardul propriu.
--
-- Rulează O DATĂ în Supabase → SQL Editor → New query → Run.
-- Idempotent: se poate rula de mai multe ori în siguranță.
-- =====================================================================

-- 1) Coloane de urmărire pe profil
--    last_active_at        = ultima activitate reală (actualizată de aplicație
--                            la fiecare sesiune, max. o dată la 12 ore)
--    deletion_warned_at    = când s-a trimis emailul de avertizare (12 luni)
--    deletion_reminded_at  = când s-a trimis reamintirea (cu 7 zile înainte)
--    deletion_scheduled_at = data programată a ștergerii (avertizare + 30 zile);
--                            NULL = contul este activ / reactivat
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_active_at        TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deletion_warned_at    TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deletion_reminded_at  TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS deletion_scheduled_at TIMESTAMPTZ;

-- 2) Backfill: pornim de la ultima autentificare reală din auth.users
--    (sau data creării contului, dacă nu există autentificări).
UPDATE public.profiles p
SET last_active_at = COALESCE(u.last_sign_in_at, u.created_at, p.created_at, NOW())
FROM auth.users u
WHERE u.id = p.id AND p.last_active_at IS NULL;

UPDATE public.profiles
SET last_active_at = COALESCE(created_at, NOW())
WHERE last_active_at IS NULL;

-- 3) Conturile noi pornesc „active" din prima clipă
ALTER TABLE public.profiles ALTER COLUMN last_active_at SET DEFAULT NOW();

-- 4) Indexuri pentru scanarea zilnică (cron /api/account-cleanup)
CREATE INDEX IF NOT EXISTS idx_profiles_last_active
  ON public.profiles (last_active_at);
CREATE INDEX IF NOT EXISTS idx_profiles_deletion_sched
  ON public.profiles (deletion_scheduled_at)
  WHERE deletion_scheduled_at IS NOT NULL;

-- 5) ARHIVA elevilor șterși — un rând per (mentor, elev), cu tot ce vedea
--    mentorul în dashboard: rezultate la teste, stăpânirea subiectelor,
--    utilizarea Profesorului Virtual, temele rezolvate.
CREATE TABLE IF NOT EXISTS public.archived_student_results (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mentor_id     UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL,          -- fostul profiles.id (fără FK — contul nu mai există)
  student_name  TEXT,
  student_email TEXT,
  student_role  TEXT,
  reason        TEXT NOT NULL DEFAULT 'inactivity',  -- 'inactivity' | 'self_delete'
  results       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- rezultate teste (titlu, punctaj, încercări, timp, dată, întrebări AI)
  extras        JSONB NOT NULL DEFAULT '{}'::jsonb,  -- { stats, mastery, aiOnly, assignments }
  deleted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Un singur snapshot per (mentor, elev) — rulările repetate suprascriu, nu duplică
CREATE UNIQUE INDEX IF NOT EXISTS uq_archived_mentor_student
  ON public.archived_student_results (mentor_id, student_id);
CREATE INDEX IF NOT EXISTS idx_archived_mentor
  ON public.archived_student_results (mentor_id, deleted_at DESC);

-- RLS pornit, FĂRĂ politici publice: accesul se face DOAR prin funcțiile
-- serverless (service_role) — /api/teacher-students (citire) și
-- /api/teacher-manage acțiunea delete_archived (ștergere de către mentor).
ALTER TABLE public.archived_student_results ENABLE ROW LEVEL SECURITY;

-- ── Verificare (opțional) ──────────────────────────────────────────
-- SELECT id, email, last_active_at, deletion_warned_at, deletion_scheduled_at
-- FROM public.profiles ORDER BY last_active_at ASC LIMIT 20;
-- SELECT mentor_id, student_name, reason, deleted_at FROM public.archived_student_results;
