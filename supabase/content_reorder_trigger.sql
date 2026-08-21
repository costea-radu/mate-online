-- =====================================================================
-- content_reorder_trigger.sql — OPȚIONAL, recomandat. Idempotent.
-- Rulează în: Supabase → SQL Editor → New Query
-- =====================================================================
-- CONTEXT: triggerul `trg_content_ingest` (ai_tutor_schema.sql) pune în coada
-- AI (`ai_ingest_queue`) ORICE rând din `content` modificat, ca Profesorul
-- Virtual să reindexeze materialul. Noul panou Admin → Tot Conținutul →
-- „Ordinea de afișare" rescrie DOAR `sort_order` pentru zeci/sute de rânduri
-- odată. Fără acest fix, fiecare reordonare ar:
--   • re-vectoriza toate materialele atinse (cost mic, dar inutil — textul
--     indexat nu conține ordinea);
--   • bumpa `ai_knowledge.updated_at`, ceea ce le face „candidați" la
--     pre-generare (ai_pregen_candidates) deși hash-ul sursei e neschimbat →
--     cronul de pregen i-ar sări la nesfârșit, ocupând locurile din lot.
-- SOLUȚIA: la UPDATE, coada se alimentează DOAR dacă s-a schimbat ceva din
-- ce se indexează (titlu, descriere, categorie, tip, acces, conținut manual,
-- fișier). Schimbările doar de ordine/subcategorie/profil nu mai reindexează.
-- Inserările și ștergerile rămân ca înainte.
-- =====================================================================

create or replace function public.trg_enqueue_content() returns trigger as $$
begin
  if tg_op = 'DELETE' then
    perform public.enqueue_ingest('content', old.id, 'delete');
    return old;
  end if;
  if tg_op = 'UPDATE'
     and new.title          is not distinct from old.title
     and new.description    is not distinct from old.description
     and new.category       is not distinct from old.category
     and new.content_type   is not distinct from old.content_type
     and new.is_free        is not distinct from old.is_free
     and new.manual_content is not distinct from old.manual_content
     and new.file_url       is not distinct from old.file_url
  then
    return new; -- doar sort_order / subcategory / profile / updated_at → nimic de reindexat
  end if;
  perform public.enqueue_ingest('content', new.id, 'upsert');
  return new;
end$$ language plpgsql security definer set search_path = public;

-- Triggerul există deja (ai_tutor_schema.sql); îl re-creăm doar ca scriptul
-- să fie complet și sigur de rulat pe o bază reconstruită din zero.
drop trigger if exists trg_content_ingest on public.content;
create trigger trg_content_ingest
  after insert or update or delete on public.content
  for each row execute function public.trg_enqueue_content();

-- Verificare (opțional):
--   update public.content set sort_order = sort_order where id = '<un id>';
--   select count(*) from public.ai_ingest_queue where processed_at is null;  -- neschimbat
