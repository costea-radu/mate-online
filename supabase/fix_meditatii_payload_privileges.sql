-- =====================================================================
-- ExamenMate · Meditații — cheile de răspuns NU mai sunt citibile din browser
-- (Etapa 1 din AUDIT_AGENTI_AI.md, punctul 2.2)
--
-- Problema: `payload` din ai_meditatii_sessions / ai_meditatii_homework ține
-- întrebările generate ÎMPREUNĂ cu răspunsurile corecte și explicațiile.
-- API-ul le scoate din răspunsuri (sanitize), dar politica RLS „own_read"
-- dădea SELECT pe TOT rândul, deci un elev putea citi cheia quiz-ului activ
-- direct din consola browserului:
--   supabase.from('ai_meditatii_sessions').select('payload')
--
-- Soluția: privilegii PE COLOANE — rolul `authenticated` păstrează SELECT pe
-- toate coloanele, MAI PUȚIN `payload`; serverul (service_role) vede tot.
-- Aplicația nu citește aceste tabele direct din browser (toate citirile trec
-- prin /api/ai-meditatii), deci nimic nu se schimbă pentru elev.
-- Rulează o dată în Supabase → SQL Editor. Idempotent.
-- =====================================================================

-- Sesiunile de meditație
revoke all on table public.ai_meditatii_sessions from anon, authenticated;
grant select (id, user_id, kind, chapter, topic, difficulty, status, score, max_score,
              duration_sec, created_at, completed_at)
  on public.ai_meditatii_sessions to authenticated;

-- Temele date de Profesorul Virtual
revoke all on table public.ai_meditatii_homework from anon, authenticated;
grant select (id, user_id, kind, content_id, title, chapter, topic, difficulty, status,
              score, max_score, attempts, feedback, assigned_at, due_at, completed_at)
  on public.ai_meditatii_homework to authenticated;

-- Notă: politicile RLS existente (own_read / service_write) rămân neschimbate;
-- privilegiile pe coloane se aplică ÎNAINTEA lor. service_role nu e afectat.
