-- =====================================================================
-- fix_lints_14aug2026.sql — raportul Advisors din 14 august 2026 (2 warninguri)
-- Rulează în Supabase → SQL Editor → New Query.
-- =====================================================================

-- ── 1. „Function Search Path Mutable" — public.med_profile_touch (RECIDIVĂ) ──
-- A mai fost reparat pe 7 august (fix_security_lints_aug2026.sql), dar ALTER-ul
-- de atunci a fost ANULAT între timp: meditatii_schema.sql definește funcția cu
-- `create or replace` FĂRĂ search_path, iar re-rularea fișierului (la update-urile
-- Meditațiilor) resetează setarea. De aceea:
--   a) ALTER-ul de mai jos repară baza de date ACUM;
--   b) definițiile din meditatii_schema.sql și ai_tutor_schema.sql au primit
--      `set search_path = public` chiar în corpul funcției — orice re-rulare
--      viitoare păstrează setarea; lint-ul nu mai are cum să revină.
ALTER FUNCTION public.med_profile_touch() SET search_path = public;

-- Preventiv, aceeași capcană (funcție definită fără search_path în fișier):
ALTER FUNCTION public.aik_tsv_update() SET search_path = public;

-- ── 2. „Leaked Password Protection Disabled" — NU se rezolvă din SQL ─────────
-- Verificarea parolelor compromise (HaveIBeenPwned) e disponibilă DOAR pe
-- planul Pro sau mai sus — pe Free butonul nu poate fi activat, iar warningul
-- rămâne afișat. La trecerea pe Pro: Authentication → Sign In / Up →
-- Password Protection → „Prevent use of leaked passwords" (un click, fără cod).

-- ── Verificare (ambele funcții trebuie să arate „search_path=public") ────────
SELECT proname, proconfig
FROM pg_proc
WHERE proname IN ('med_profile_touch', 'aik_tsv_update');
