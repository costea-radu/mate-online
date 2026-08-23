-- =====================================================================
-- ExamenMate · RAG v2 — conținut REAL în baza de cunoștințe + căutare HIBRIDĂ
-- (Etapa 3 din AUDIT_AGENTI_AI.md, punctul 1.5). Rulează DUPĂ ai_tutor_schema.sql.
-- Idempotent. Apoi, din Admin → „🔄 Reindexează tot" (o singură dată).
--
--   · unaccent + stemmer-ul românesc („romanian"): „fracții" = „fractii" = „fracțiile",
--     „triunghiul" = „triunghi" în căutarea lexicală (diacriticele și terminațiile nu mai contează);
--   · ai_knowledge.chapter_id: capitolul din programă (CURRICULUM din api/_lib/meditatii.js);
--   · match_ai_knowledge_hybrid: vector + lexical combinate prin RRF (Reciprocal Rank
--     Fusion), cu prag de similaritate și filtru pe capitol — în loc de „lexical doar
--     când vectorul nu întoarce nimic";
--   · triggerul de ingestie pe `content` sare peste UPDATE-urile care nu schimbă
--     nimic din ce se indexează (ex. sort_order) — împreună cu compararea
--     content_hash din api/ai-ingest.js, nu se mai re-vectorizează degeaba;
--   · coada de ingestie se curăță de rândurile procesate mai vechi de 7 zile.
-- =====================================================================

create extension if not exists unaccent with schema extensions;

alter table public.ai_knowledge add column if not exists chapter_id text;
create index if not exists idx_aik_chapter on public.ai_knowledge(chapter_id);

-- textul fără diacritice pentru tsvector (funcție proprie, IMMUTABLE → indexabilă)
create or replace function public.aik_unaccent(t text) returns text
language sql immutable strict parallel safe set search_path = public, extensions as $$
  select unaccent('unaccent'::regdictionary, coalesce(t, ''));
$$;

-- tsvector fără diacritice, cu stemmer românesc (titlu + conținut)
create or replace function public.aik_tsv_update() returns trigger as $$
begin
  new.tsv := to_tsvector('romanian', public.aik_unaccent(coalesce(new.title,'') || ' ' || coalesce(new.content,'')));
  return new;
end$$ language plpgsql set search_path = public, extensions;

drop trigger if exists trg_aik_tsv on public.ai_knowledge;
create trigger trg_aik_tsv
  before insert or update of title, content on public.ai_knowledge
  for each row execute function public.aik_tsv_update();

-- recalculăm tsv pentru rândurile existente (o singură dată, ieftin)
update public.ai_knowledge set tsv = to_tsvector('romanian', public.aik_unaccent(coalesce(title,'') || ' ' || coalesce(content,'')));

-- interogarea lexicală: termenii se leagă cu SAU (un singur cuvânt comun ajunge
-- să aducă un candidat; rangul îl ordonează), fără diacritice
create or replace function public.aik_query(q text) returns tsquery
language sql immutable strict parallel safe set search_path = public, extensions as $$
  select case
    when trim(public.aik_unaccent(q)) = '' then null
    else nullif(regexp_replace(plainto_tsquery('romanian', public.aik_unaccent(q))::text, ' & ', ' | ', 'g'), '')::tsquery
  end;
$$;

-- 6c. Căutare HIBRIDĂ: RRF peste rangul vectorial și cel lexical
--   query_embedding null → doar lexical (fără chei de embeddings)
--   min_similarity      → candidații DOAR vectoriali sub prag sunt eliminați
--   filter_chapter      → doar fragmentele din capitolul respectiv (CURRICULUM id)
create or replace function public.match_ai_knowledge_hybrid(
  query_embedding vector(1536),
  query_text text,
  match_count int default 6,
  filter_category text default null,
  allow_premium boolean default false,
  filter_chapter text default null,
  min_similarity float default 0.0
) returns table (
  id uuid, source_type text, source_id uuid, category text, topic text, chapter_id text,
  title text, content text, is_free boolean, similarity float, score float
) language sql stable security definer set search_path = public, extensions as $$
  -- filtrele sunt repetate în fiecare ramură (nu într-un CTE comun) ca planificatorul
  -- să poată folosi indexul HNSW pe ramura vectorială
  with vec as (
    select b.id, 1 - (b.embedding <=> query_embedding) as sim,
           row_number() over (order by b.embedding <=> query_embedding) as rnk
    from public.ai_knowledge b
    where query_embedding is not null and b.embedding is not null
      and (filter_category is null or b.category = filter_category or b.category = 'general')
      and (allow_premium or b.is_free)
      and (filter_chapter is null or b.chapter_id = filter_chapter)
    order by b.embedding <=> query_embedding
    limit greatest(match_count * 4, 20)
  ),
  lex as (
    select b.id, ts_rank_cd(b.tsv, public.aik_query(query_text))::float as lrank,
           row_number() over (order by ts_rank_cd(b.tsv, public.aik_query(query_text)) desc) as rnk
    from public.ai_knowledge b
    where query_text is not null and public.aik_query(query_text) is not null
      and b.tsv @@ public.aik_query(query_text)
      and (filter_category is null or b.category = filter_category or b.category = 'general')
      and (allow_premium or b.is_free)
      and (filter_chapter is null or b.chapter_id = filter_chapter)
    order by lrank desc
    limit greatest(match_count * 4, 20)
  ),
  fused as (
    select coalesce(v.id, l.id) as id,
           v.sim as similarity,
           (case when v.rnk is not null then 1.0 / (60 + v.rnk) else 0 end)
         + (case when l.rnk is not null then 1.0 / (60 + l.rnk) else 0 end) as score,
           (l.id is not null) as has_lex
    from vec v full outer join lex l on l.id = v.id
  )
  select k.id, k.source_type, k.source_id, k.category, k.topic, k.chapter_id, k.title, k.content, k.is_free,
         f.similarity, f.score
  from fused f join public.ai_knowledge k on k.id = f.id
  where f.has_lex or f.similarity is null or f.similarity >= min_similarity
  order by f.score desc, f.similarity desc nulls last
  limit match_count;
$$;

revoke all on function public.match_ai_knowledge_hybrid(vector, text, int, text, boolean, text, float) from public;
grant execute on function public.match_ai_knowledge_hybrid(vector, text, int, text, boolean, text, float) to service_role;

-- Triggerul de ingestie pe `content`: la UPDATE doar când se schimbă ceva indexat
drop trigger if exists trg_content_ingest on public.content;
drop trigger if exists trg_content_ingest_ins_del on public.content;
create trigger trg_content_ingest_ins_del
  after insert or delete on public.content
  for each row execute function public.trg_enqueue_content();
drop trigger if exists trg_content_ingest_upd on public.content;
create trigger trg_content_ingest_upd
  after update on public.content
  for each row
  when (old.title is distinct from new.title or old.description is distinct from new.description
        or old.file_url is distinct from new.file_url or old.category is distinct from new.category
        or old.is_free is distinct from new.is_free or old.content_type is distinct from new.content_type
        or old.manual_content is distinct from new.manual_content
        or old.interactive_data is distinct from new.interactive_data)
  execute function public.trg_enqueue_content();

-- Curățarea cozii: rândurile procesate mai vechi de 7 zile (apelată de ai-ingest)
create or replace function public.ai_ingest_queue_purge() returns int
language sql security definer set search_path = public as $$
  with d as (delete from public.ai_ingest_queue where processed_at is not null and processed_at < now() - interval '7 days' returning 1)
  select count(*)::int from d;
$$;
revoke all on function public.ai_ingest_queue_purge() from public;
grant execute on function public.ai_ingest_queue_purge() to service_role;
