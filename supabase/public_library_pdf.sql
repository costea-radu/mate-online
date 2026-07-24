-- =====================================================================
-- ExamenMate — Biblioteca utilizatorilor: publicarea PDF-urilor generate
--   • ai_public_library.kind acceptă și 'pdf' (subiecte combinate exact,
--     salvate ca fișier în Storage — „Păstrează datele problemelor")
-- Rulează în Supabase → SQL Editor. Idempotent.
-- =====================================================================

alter table public.ai_public_library drop constraint if exists ai_public_library_kind_check;
alter table public.ai_public_library
  add constraint ai_public_library_kind_check
  check (kind in ('exam', 'practice', 'interactive', 'pdf'));
