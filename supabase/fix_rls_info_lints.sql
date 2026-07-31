-- =====================================================================
-- Fix cele 7 lint-uri INFO „RLS Enabled No Policy" (Supabase Advisor)
-- Tabele: archived_student_results, contact_messages, gsc_snapshots,
--         newsletter_campaigns, newsletter_sends, seo_actions, social_posts
-- Rulează în: Supabase → SQL Editor → New Query. Sigur de rulat repetat.
--
-- CONTEXT (verificat în cod pe 31 iulie 2026): toate cele 7 tabele sunt
-- folosite EXCLUSIV de rutele API de pe server, cu service role — care
-- OCOLEȘTE RLS. Frontend-ul (cheia anon) nu le atinge niciodată direct
-- (mențiunile din src/ sunt doar comentarii). RLS activat fără politici
-- înseamnă deja „acces interzis pentru toată lumea", deci NU există o
-- gaură de securitate — linterul doar întreabă dacă e intenționat.
--
-- Politicile de mai jos fac intenția explicită (deny-all documentat) și
-- sting cele 7 lint-uri, FĂRĂ nicio schimbare de comportament:
--   USING (false) / WITH CHECK (false) = nimeni prin anon/authenticated;
--   service_role ocolește RLS, deci serverul funcționează neschimbat.
-- =====================================================================

-- ── 1. archived_student_results ──────────────────────────────────────────────
-- Arhiva rezultatelor elevilor (snapshot creat înainte de ștergerea conturilor
-- inactive). Folosit de: teacher-manage.js, teacher-students.js, _lib/inactivity.js.
DROP POLICY IF EXISTS "archived_student_results_service_only" ON public.archived_student_results;
CREATE POLICY "archived_student_results_service_only"
  ON public.archived_student_results FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 2. contact_messages ──────────────────────────────────────────────────────
-- Mesajele din formularul de contact. Folosit de: contact.js, ai-notify.js.
DROP POLICY IF EXISTS "contact_messages_service_only" ON public.contact_messages;
CREATE POLICY "contact_messages_service_only"
  ON public.contact_messages FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 3. gsc_snapshots ─────────────────────────────────────────────────────────
-- Istoricul zilnic de poziții din Google Search Console. Folosit de:
-- seo-cron.js, seo-rank.js, _lib/seo.js (frontend-ul citește prin /api/seo-rank).
DROP POLICY IF EXISTS "gsc_snapshots_service_only" ON public.gsc_snapshots;
CREATE POLICY "gsc_snapshots_service_only"
  ON public.gsc_snapshots FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 4. newsletter_campaigns ──────────────────────────────────────────────────
-- Campaniile de newsletter. Folosit de: newsletter.js.
DROP POLICY IF EXISTS "newsletter_campaigns_service_only" ON public.newsletter_campaigns;
CREATE POLICY "newsletter_campaigns_service_only"
  ON public.newsletter_campaigns FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 5. newsletter_sends ──────────────────────────────────────────────────────
-- Trimiterile individuale de newsletter (jurnal per destinatar). Folosit de: newsletter.js.
DROP POLICY IF EXISTS "newsletter_sends_service_only" ON public.newsletter_sends;
CREATE POLICY "newsletter_sends_service_only"
  ON public.newsletter_sends FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 6. seo_actions ───────────────────────────────────────────────────────────
-- Jurnalul de acțiuni al agentului SEO. Folosit de: ai-seo-agent.js,
-- seo-actions.js, seo-cron.js, seo-rank.js, social-queue.js, _lib/seo.js.
DROP POLICY IF EXISTS "seo_actions_service_only" ON public.seo_actions;
CREATE POLICY "seo_actions_service_only"
  ON public.seo_actions FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── 7. social_posts ──────────────────────────────────────────────────────────
-- Coada de postări social media. Folosit de: social-queue.js, social-cron.js,
-- _lib/social.js, _lib/seo.js (frontend-ul citește prin /api/social-queue).
DROP POLICY IF EXISTS "social_posts_service_only" ON public.social_posts;
CREATE POLICY "social_posts_service_only"
  ON public.social_posts FOR ALL
  TO anon, authenticated
  USING (false) WITH CHECK (false);

-- ── Întărire suplimentară (inertă azi, utilă mâine) ──────────────────────────
-- Supabase acordă implicit drepturi anon/authenticated pe tabelele din public.
-- Cu deny-all de mai sus ele nu contează, dar revocarea lor previne și scenariul
-- în care cineva adaugă în viitor, din greșeală, o politică permisivă pe aceste
-- tabele. service_role nu e afectat. Dacă vreodată vrei acces din client, dă
-- înapoi GRANT + politică, după modelul din supabase_grants.sql.
REVOKE ALL ON public.archived_student_results FROM anon, authenticated;
REVOKE ALL ON public.contact_messages         FROM anon, authenticated;
REVOKE ALL ON public.gsc_snapshots            FROM anon, authenticated;
REVOKE ALL ON public.newsletter_campaigns     FROM anon, authenticated;
REVOKE ALL ON public.newsletter_sends         FROM anon, authenticated;
REVOKE ALL ON public.seo_actions              FROM anon, authenticated;
REVOKE ALL ON public.social_posts             FROM anon, authenticated;

-- ── Verificare rezultat ──────────────────────────────────────────────────────
-- Așteptat: 7 rânduri (câte o politică „…_service_only" per tabel).
-- Apoi: Supabase → Advisors → „Rerun linter" — cele 7 lint-uri INFO dispar.
SELECT tablename, policyname, roles, cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('archived_student_results', 'contact_messages', 'gsc_snapshots',
                    'newsletter_campaigns', 'newsletter_sends', 'seo_actions', 'social_posts')
ORDER BY tablename;
