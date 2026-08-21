-- =====================================================================
-- fix_lints_21aug2026.sql — raportul Advisors din 21 august 2026 (2 warninguri)
-- Rulează în Supabase → SQL Editor → New Query. Sigur de rulat repetat.
-- =====================================================================

-- ── 1. „Signed-In Users Can Execute SECURITY DEFINER Function" (lint 0029) ───
--      public.reviews_can_rate(p_type text, p_id uuid)
-- Funcția (din reviews_schema.sql, tranșa de recenzii) e apelată din politica
-- RLS de INSERT pe `reviews` — „poate nota doar cine a rezolvat testul". O
-- politică rulează cu drepturile utilizatorului care scrie, deci funcția
-- TREBUIE să rămână executabilă de rolul `authenticated`; ce deranja lintul
-- era combinația DEFINER + executabilă de clienți.
--
-- Rezolvare: SECURITY INVOKER. Funcția verifică doar rândurile PROPRII ale
-- utilizatorului curent (progress.user_id = auth.uid(), respectiv
-- ai_public_results.student_id = auth.uid()), iar RLS-ul acelor tabele i le
-- arată oricum (progress_select_own / pubres_read) — deci nu pierde nimic și
-- nu mai poate fi bănuită că ocolește RLS. Fără schimbări de comportament:
-- elevul care a rezolvat testul poate nota; cine nu l-a rezolvat, nu.
ALTER FUNCTION public.reviews_can_rate(text, uuid) SECURITY INVOKER;

-- search_path rămâne fixat (altfel apare lintul 0011 „Function Search Path Mutable")
ALTER FUNCTION public.reviews_can_rate(text, uuid) SET search_path = public;

-- anon nu are ce căuta la ea; authenticated + service_role rămân (politica RLS)
REVOKE EXECUTE ON FUNCTION public.reviews_can_rate(text, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.reviews_can_rate(text, uuid) TO authenticated, service_role;

-- Definiția din supabase/reviews_schema.sql a fost actualizată la SECURITY
-- INVOKER, ca o re-rulare a fișierului să NU readucă lintul (aceeași capcană
-- ca la med_profile_touch în fix_lints_14aug2026.sql).

-- ── 2. „Leaked Password Protection Disabled" — NU se rezolvă din SQL ─────────
-- Neschimbat față de 14 august: verificarea parolelor compromise (HaveIBeenPwned)
-- e disponibilă doar pe planul Pro sau mai sus; pe Free warningul rămâne.
-- La trecerea pe Pro: Authentication → Sign In / Up → Password Protection →
-- „Prevent use of leaked passwords" (un click, fără cod).

-- ── Verificare ───────────────────────────────────────────────────────────────
-- a) prosecdef trebuie să fie FALSE (invoker) și proconfig să conțină search_path:
SELECT proname, prosecdef AS security_definer, proconfig
FROM pg_proc
WHERE proname = 'reviews_can_rate';

-- b) drepturile de execuție: authenticated și service_role DA, anon NU:
SELECT grantee, privilege_type
FROM information_schema.routine_privileges
WHERE routine_schema = 'public' AND routine_name = 'reviews_can_rate'
ORDER BY grantee;

-- c) test funcțional (dintr-un cont de elev care a rezolvat un test interactiv):
--    după „Scor salvat" cardul „Cum ți s-a părut testul?" trimite nota fără
--    eroare; dintr-un cont care NU l-a rezolvat, INSERT-ul e respins de RLS.
-- Apoi: Supabase → Advisors → „Rerun linter" — warningul 0029 dispare.
