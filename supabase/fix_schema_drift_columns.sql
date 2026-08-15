-- =====================================================================
-- FIX — drift de schemă: coloane folosite de cod, create de niciun fișier
-- Rulează în: Supabase → SQL Editor → New Query (idempotent, sigur de re-rulat)
-- =====================================================================
-- PROBLEMA: în producție aceste coloane există (au fost adăugate manual din
-- dashboard), dar NICIUN fișier de migrare nu le creează. La o reconstrucție a
-- bazei (staging / disaster-recovery) din scripturile din supabase/:
--   • `profiles.is_admin` lipsește → requireAdmin, get-file-url și politicile RLS
--     din admin_delete_policy.sql / pastreaza_rezultate.sql crapă;
--   • `content.subcategory` / `content.profile` lipsesc → Admin.jsx (insert) și
--     ai-exam.js / ai-generate-interactive.js (select) crapă.
-- Acest fișier le declară explicit, ca schema să fie reproductibilă din cod.
-- =====================================================================

-- profiles.is_admin — cheia întregii autorizări de admin.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- content.subcategory / content.profile — folosite la generare/afișare.
ALTER TABLE public.content
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS profile     text;

-- Verificare (opțional):
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='content'
--     AND column_name IN ('subcategory','profile');
--   SELECT column_name FROM information_schema.columns
--   WHERE table_schema='public' AND table_name='profiles' AND column_name='is_admin';
