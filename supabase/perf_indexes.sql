-- =====================================================================
-- perf_indexes.sql — indexuri pentru interogările repetitive (pregătire
-- pentru trafic mare; vezi CHANGELOG 14 august 2026 (4)).
-- Rulează O DATĂ în Supabase → SQL Editor. Sigur de rulat de mai multe ori.
-- =====================================================================

-- (1) Navbar interoghează periodic „activitate nouă pe forum": un COUNT pe
-- discussions filtrat după created_at. Fără index, fiecare tic = citirea
-- întregului tabel (seq scan) — pentru FIECARE vizitator cu site-ul deschis.
create index if not exists idx_disc_created
  on public.discussions (created_at desc);

-- (2) Același tic numără și „răspunsuri la postările mele":
-- parent_id IN (...) + created_at > ultimul-văzut. Compozitul acoperă complet
-- filtrarea (parent_id singur există deja ca idx_disc_parent, dar cu compozit
-- nu se mai citesc rândurile vechi doar ca să fie respinse pe created_at).
create index if not exists idx_disc_parent_created
  on public.discussions (parent_id, created_at desc);

-- (3) Rapoartele de cost AI (ai_cost_breakdown/ai_top_users, alarma de prag)
-- și curățarea zilnică filtrează ai_usage GLOBAL după created_at; indexul
-- existent idx_usage_user_time începe cu user_id, deci nu ajută aici.
create index if not exists idx_usage_time
  on public.ai_usage (created_at);
