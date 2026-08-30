-- =====================================================================
-- ExamenMate · GAMIFICARE v7 — SALVARE PARȚIALĂ în dueluri
-- Rulează DUPĂ gamificare_v3_dueluri.sql. Idempotent.
--
-- Elevul care închide pagina la jumătatea exercițiului nu mai pierde tot:
-- InteractiveViewer trimite periodic răspunsurile de până atunci, iar
-- serverul le recalculează din chei și le reține ca rezultat PROVIZORIU.
-- Duelul se închide doar când ambii au trimis un rezultat FINAL (au apăsat
-- „Verifică") sau când expiră — atunci provizoriul devine rezultatul lor.
-- =====================================================================

alter table public.duels add column if not exists challenger_partial boolean not null default false;
alter table public.duels add column if not exists opponent_partial   boolean not null default false;

comment on column public.duels.challenger_partial is
  'true = rezultat provizoriu (salvare automată la jumătate), nu unul trimis de elev';

-- Verificare rapidă:
-- select id, challenger_score, challenger_partial, opponent_score, opponent_partial, status
--   from public.duels order by created_at desc limit 10;
