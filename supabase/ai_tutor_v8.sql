-- =====================================================================
-- ExamenMate · Profesor Virtual — completare v8
-- Barieră pe server pentru „Biblioteca utilizatorilor":
--   • ai_public_library.is_free → testele gratuite (accesibile și neabonaților)
--   • implicit, primele 3 teste publicate devin gratuite (le poți schimba din Admin)
-- Rulează DUPĂ v1–v7. Idempotent.
-- =====================================================================

alter table public.ai_public_library add column if not exists is_free boolean default false;

-- Seed: dacă nu e marcat niciun test gratuit, fă gratuite primele 3 publicate.
do $$
begin
  if not exists (select 1 from public.ai_public_library where is_free = true) then
    update public.ai_public_library set is_free = true
    where id in (select id from public.ai_public_library order by created_at asc limit 3);
  end if;
end $$;
