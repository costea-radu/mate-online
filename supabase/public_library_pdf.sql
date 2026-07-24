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

-- Gratuite automate CU respectarea deciziilor adminului:
-- • sistemul menține minim 3 teste gratuite (cele mai RECENTE), dar
-- • atinge doar rândurile cu free_set_by_admin = false;
-- • orice comutare făcută de admin (gratuit SAU premium) marchează rândul
--   free_set_by_admin = true și nu mai e suprascrisă niciodată automat.
alter table public.ai_public_library add column if not exists free_set_by_admin boolean default false;
