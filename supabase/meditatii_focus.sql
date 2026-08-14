-- =====================================================================
-- ExamenMate · Meditații — PREGĂTIREA PENTRU LUCRARE/TEST („focus")
-- Adaugă pe profilul de meditații coloana `focus`:
--   { kind: 'lucrare'|'lectii'|'test-initial',
--     chapter_ids: ['c7-ecuatii', ...],   -- capitolele alese pentru test
--     custom: 'text liber (capitol lipsă / indicații)',
--     deadline: 'YYYY-MM-DD',             -- data limită a recapitulării
--     set_at: timestamp }
-- NULL = fără pregătire de lucrare (examenul final = toată materia, ca acum).
-- Rulează în Supabase → SQL Editor → Run. Idempotent (se poate rula repetat).
-- =====================================================================

alter table public.ai_meditatii_profile
  add column if not exists focus jsonb;

comment on column public.ai_meditatii_profile.focus is
  'Pregătirea pentru lucrare/test: {kind, chapter_ids[], custom, deadline, set_at}; null = fără (examen final / toată materia)';
