-- =====================================================================
-- supabase/continut_generat_proceduri.sql — procedurile 7, 8 și 9 în jurnalul conținutului generat
-- (26 nov. 2026)
--
-- Tabela continut_generat a fost creată cu „check (procedura between 1 and 6)"; procedura 7
-- (lecțiile live, 22 nov.), 8 (PDF + barem pentru un test interactiv fără PDF) și 9 (verificarea
-- construcției unui test interactiv — skill-ul „examenmate-teste-interactive") au nevoie de 7–9.
-- Fără schimbarea asta, Action-ul „Publică" nu poate înregistra unitățile lor.
-- Se poate rula de mai multe ori.
-- =====================================================================
alter table public.continut_generat drop constraint if exists continut_generat_procedura_check;
alter table public.continut_generat
  add constraint continut_generat_procedura_check check (procedura between 1 and 9);
