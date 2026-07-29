-- =====================================================================
-- ExamenMate — bucket public pentru media generată de agentul SEO
-- (videoclipurile din create_video — extensia Fazei 4).
-- Rulează în Supabase → SQL Editor → New Query. SIGUR DE RULAT REPETAT.
--
-- Scrierea se face DOAR de pe server (service role — ocolește RLS);
-- citirea e publică (Meta descarcă MP4-ul de la URL-ul public la
-- publicarea pe Facebook/Instagram, iar adminul îl descarcă din admin).
-- =====================================================================
insert into storage.buckets (id, name, public)
values ('agent-media', 'agent-media', true)
on conflict (id) do update set public = true;
