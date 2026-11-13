-- =====================================================================
-- ExamenMate · „🗺️ HARTA PREGĂTIRII" — planul de parcurs din
-- „🎯 Pregătește-mă de examen" (13 noiembrie 2026)
--
-- Planul (ordinea exercițiilor) se construiește din `content` la fiecare
-- deschidere, iar starea pașilor vine din `progress` — deci NU e nevoie de o
-- tabelă nouă. Aici se adaugă doar ce nu se poate deduce:
--
--   user_stats.prep_plan (jsonb):
--     { v, start, tinta, sarite: [content_id…], trecute: [content_id…] }
--       start   — ziua în care a început planul (exercițiile adăugate în site
--                 după ea apar pe hartă cu „nou")
--       tinta   — examenul / clasa pentru care s-a pornit planul
--       sarite  — pașii peste care elevul a trecut după câteva încercări
--                 („⏭ Treci mai departe")
--       trecute — pașii trecuți o dată (o reluare mai slabă nu-i mai scoate
--                 de pe hartă)
--
-- Ținta poate fi acum și o clasă: user_stats.prep_exam primește și
-- 'clasa-5' … 'clasa-12' (coloana e text, fără constrângere — nimic de schimbat).
--
-- Scrie doar serverul (api/gamificare.js, cu rolul de serviciu). Elevul își
-- citește rândul din user_stats prin politica existentă („stats: select own").
-- Fără tabele noi → fără GRANT-uri noi (regula din CLAUDE.md privește
-- `create table`). Rulează în Supabase → SQL Editor → New Query → Run, după
-- gamificare_v2.sql și pregatire_zilnica.sql. Idempotent.
-- =====================================================================

alter table public.user_stats add column if not exists prep_plan jsonb not null default '{}'::jsonb;

comment on column public.user_stats.prep_plan is
  'Harta pregătirii (13 nov. 2026): { v, start, tinta, sarite[], trecute[] } — pașii săriți după câteva încercări și cei trecuți; ordinea vine din content, starea din progress.';

comment on column public.user_stats.prep_exam is
  'Ținta din „Pregătește-mă de examen": evaluare-nationala, bac-mate-info, bac-stiinte, bac-tehnologic sau o clasă (clasa-5 … clasa-12).';

-- Verificare rapidă:
-- select user_id, prep_exam, prep_plan->>'start' as start,
--        jsonb_array_length(coalesce(prep_plan->'sarite', '[]'::jsonb)) as sarite,
--        jsonb_array_length(coalesce(prep_plan->'trecute', '[]'::jsonb)) as trecute
--   from public.user_stats where prep_exam is not null order by updated_at desc limit 20;
