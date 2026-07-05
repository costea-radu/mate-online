-- =====================================================================
-- ExamenMate — completare v9: „Setări cont"
-- Coloane noi pe profiles pentru profil și notificări.
-- Rulează DUPĂ v1–v8. Idempotent.
-- =====================================================================
alter table public.profiles add column if not exists username text;
alter table public.profiles add column if not exists notifications_enabled boolean default true;

-- username unic (dacă e completat) — index parțial
create unique index if not exists idx_profiles_username_unique
  on public.profiles (lower(username)) where username is not null;
