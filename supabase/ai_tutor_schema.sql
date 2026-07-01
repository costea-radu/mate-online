-- =====================================================================
-- ExamenMate · Profesor Virtual (AI / RAG) — schema bazei de date
-- Rulează în Supabase → SQL Editor → New Query → Run.
-- Idempotent: se poate rula de mai multe ori în siguranță.
-- =====================================================================

-- 0. Extensia pentru vectori (RAG). Supabase o include.
create extension if not exists vector;

-- =====================================================================
-- 1. BAZA DE CUNOȘTINȚE (fragmente vectorizate pentru RAG)
--    Fiecare exercițiu / rezolvare / manual / teorie devine unul sau
--    mai multe fragmente cu embedding. Căutarea pe similaritate aduce
--    materialele relevante la fiecare întrebare a elevului.
-- =====================================================================
create table if not exists public.ai_knowledge (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null check (source_type in ('exercise','solution','manual','theory','faq')),
  source_id    uuid,                       -- content.id sau rezolvari.id (null pentru teorie introdusă manual)
  chunk_index  int  not null default 0,
  category     text,                        -- clasa-5..8, evaluare-nationala, bacalaureat, manuale, general
  topic        text,                        -- subiect fin: fractii, ecuatii, geometrie, procente...
  title        text,
  content      text not null,
  metadata     jsonb not null default '{}'::jsonb,
  is_free      boolean not null default true,
  embedding    vector(1536),                -- text-embedding-3-small = 1536 dimensiuni
  tsv          tsvector,                    -- fallback lexical (când embedding lipsește)
  content_hash text,                        -- evită re-embedding pentru fragmente neschimbate
  updated_at   timestamptz default now(),
  created_at   timestamptz default now(),
  unique (source_type, source_id, chunk_index)
);

create index if not exists idx_aik_category  on public.ai_knowledge(category);
create index if not exists idx_aik_source    on public.ai_knowledge(source_type, source_id);
create index if not exists idx_aik_tsv       on public.ai_knowledge using gin(tsv);
-- Index vectorial HNSW (rapid pe similaritate cosinus)
create index if not exists idx_aik_embedding on public.ai_knowledge using hnsw (embedding vector_cosine_ops);

-- tsvector se actualizează automat (limba 'simple' funcționează bine și pentru română)
create or replace function public.aik_tsv_update() returns trigger as $$
begin
  new.tsv := to_tsvector('simple', coalesce(new.title,'') || ' ' || coalesce(new.content,''));
  return new;
end$$ language plpgsql;

drop trigger if exists trg_aik_tsv on public.ai_knowledge;
create trigger trg_aik_tsv
  before insert or update of title, content on public.ai_knowledge
  for each row execute function public.aik_tsv_update();

-- =====================================================================
-- 2. COADA DE INGESTIE + TRIGGERE
--    La ORICE inserare/modificare/ștergere în `content` sau `rezolvari`,
--    materialul intră în coadă. Endpoint-ul /api/ai-ingest îl vectorizează.
--    Astfel AI-ul "învață constant" din ce adaugi, fără reantrenare.
-- =====================================================================
create table if not exists public.ai_ingest_queue (
  id           bigint generated always as identity primary key,
  source_type  text not null check (source_type in ('content','rezolvari')),
  source_id    uuid not null,
  op           text not null default 'upsert' check (op in ('upsert','delete')),
  enqueued_at  timestamptz default now(),
  processed_at timestamptz
);
-- Un singur job în așteptare per (sursă, operație)
create unique index if not exists uq_queue_pending
  on public.ai_ingest_queue(source_type, source_id, op)
  where processed_at is null;

create or replace function public.enqueue_ingest(p_source text, p_id uuid, p_op text)
returns void language sql security definer set search_path = public as $$
  insert into public.ai_ingest_queue(source_type, source_id, op)
  values (p_source, p_id, p_op)
  on conflict (source_type, source_id, op) where processed_at is null do nothing;
$$;

create or replace function public.trg_enqueue_content() returns trigger as $$
begin
  if tg_op = 'DELETE' then perform public.enqueue_ingest('content', old.id, 'delete'); return old;
  else perform public.enqueue_ingest('content', new.id, 'upsert'); return new; end if;
end$$ language plpgsql security definer set search_path = public;

create or replace function public.trg_enqueue_rezolvari() returns trigger as $$
begin
  if tg_op = 'DELETE' then perform public.enqueue_ingest('rezolvari', old.id, 'delete'); return old;
  else perform public.enqueue_ingest('rezolvari', new.id, 'upsert'); return new; end if;
end$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_content_ingest on public.content;
create trigger trg_content_ingest
  after insert or update or delete on public.content
  for each row execute function public.trg_enqueue_content();

drop trigger if exists trg_rezolvari_ingest on public.rezolvari;
create trigger trg_rezolvari_ingest
  after insert or update or delete on public.rezolvari
  for each row execute function public.trg_enqueue_rezolvari();

-- =====================================================================
-- 3. CONVERSAȚII + MESAJE (memoria asistentului)
-- =====================================================================
create table if not exists public.ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references auth.users(id) on delete cascade not null,
  title      text default 'Conversație nouă',
  context    jsonb not null default '{}'::jsonb,   -- {category, content_id, ...}
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists idx_aiconv_user on public.ai_conversations(user_id, updated_at desc);

create table if not exists public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.ai_conversations(id) on delete cascade not null,
  role            text not null check (role in ('user','assistant','system')),
  content         text not null,
  mode            text,                                  -- assistant|tutor|explain|hint
  metadata        jsonb not null default '{}'::jsonb,    -- {sources, usage, ...}
  created_at      timestamptz default now()
);
create index if not exists idx_aimsg_conv on public.ai_messages(conversation_id, created_at);

-- =====================================================================
-- 4. STĂPÂNIREA COMPETENȚELOR (urmărirea progresului pe subiecte)
--    Actualizată la fiecare verificare de exercițiu (medie exponențială).
-- =====================================================================
create table if not exists public.ai_skill_mastery (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid references auth.users(id) on delete cascade not null,
  category         text not null default 'general',
  topic            text not null,
  mastery          numeric not null default 0,   -- 0..1
  attempts         int not null default 0,
  correct          int not null default 0,
  last_interaction timestamptz default now(),
  unique (user_id, category, topic)
);
create index if not exists idx_mastery_user on public.ai_skill_mastery(user_id);

create or replace function public.bump_skill_mastery(
  p_user uuid, p_category text, p_topic text, p_correct boolean
) returns void language plpgsql security definer set search_path = public as $$
declare alpha numeric := 0.4; hit int := case when p_correct then 1 else 0 end;
begin
  insert into public.ai_skill_mastery(user_id, category, topic, mastery, attempts, correct, last_interaction)
  values (p_user, coalesce(p_category,'general'), p_topic, hit, 1, hit, now())
  on conflict (user_id, category, topic) do update set
    mastery          = round(public.ai_skill_mastery.mastery * (1-alpha) + hit * alpha, 4),
    attempts         = public.ai_skill_mastery.attempts + 1,
    correct          = public.ai_skill_mastery.correct + hit,
    last_interaction = now();
end$$;

-- =====================================================================
-- 5. JURNAL DE UTILIZARE (cost + rate limiting)
-- =====================================================================
create table if not exists public.ai_usage (
  id         bigint generated always as identity primary key,
  user_id    uuid references auth.users(id) on delete set null,
  endpoint   text,
  tokens_in  int default 0,
  tokens_out int default 0,
  created_at timestamptz default now()
);
create index if not exists idx_usage_user_time on public.ai_usage(user_id, created_at);

-- =====================================================================
-- 6. FUNCȚII DE CĂUTARE (RAG) — apelate doar de server (service_role)
-- =====================================================================
-- 6a. Căutare vectorială (semantică)
create or replace function public.match_ai_knowledge(
  query_embedding vector(1536),
  match_count int default 6,
  filter_category text default null,
  allow_premium boolean default false
) returns table (
  id uuid, source_type text, source_id uuid, category text, topic text,
  title text, content text, is_free boolean, similarity float
) language sql stable security definer set search_path = public as $$
  select k.id, k.source_type, k.source_id, k.category, k.topic, k.title, k.content, k.is_free,
         1 - (k.embedding <=> query_embedding) as similarity
  from public.ai_knowledge k
  where k.embedding is not null
    and (filter_category is null or k.category = filter_category or k.category = 'general')
    and (allow_premium or k.is_free)
  order by k.embedding <=> query_embedding
  limit match_count;
$$;

-- 6b. Căutare lexicală (fallback când nu există embedding-uri)
create or replace function public.match_ai_knowledge_lexical(
  query_text text,
  match_count int default 6,
  filter_category text default null,
  allow_premium boolean default false
) returns table (
  id uuid, source_type text, source_id uuid, category text, topic text,
  title text, content text, is_free boolean, similarity float
) language sql stable security definer set search_path = public as $$
  select k.id, k.source_type, k.source_id, k.category, k.topic, k.title, k.content, k.is_free,
         ts_rank(k.tsv, websearch_to_tsquery('simple', query_text))::float as similarity
  from public.ai_knowledge k
  where k.tsv @@ websearch_to_tsquery('simple', query_text)
    and (filter_category is null or k.category = filter_category or k.category = 'general')
    and (allow_premium or k.is_free)
  order by similarity desc
  limit match_count;
$$;

-- Doar serverul (service_role) poate căuta → conținutul premium nu se scurge către client
revoke all on function public.match_ai_knowledge(vector, int, text, boolean) from public;
revoke all on function public.match_ai_knowledge_lexical(text, int, text, boolean) from public;
grant execute on function public.match_ai_knowledge(vector, int, text, boolean) to service_role;
grant execute on function public.match_ai_knowledge_lexical(text, int, text, boolean) to service_role;

-- =====================================================================
-- 7. ROW LEVEL SECURITY
-- =====================================================================
alter table public.ai_knowledge     enable row level security;
alter table public.ai_ingest_queue  enable row level security;
alter table public.ai_conversations enable row level security;
alter table public.ai_messages      enable row level security;
alter table public.ai_skill_mastery enable row level security;
alter table public.ai_usage         enable row level security;

-- ai_knowledge / queue / usage: NUMAI service_role (serverul). Clientul nu citește direct.
do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_knowledge' and policyname='aik_service') then
    create policy "aik_service" on public.ai_knowledge for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_ingest_queue' and policyname='queue_service') then
    create policy "queue_service" on public.ai_ingest_queue for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_usage' and policyname='usage_service') then
    create policy "usage_service" on public.ai_usage for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- Conversații & mesaje: utilizatorul vede/creează doar ce e al lui (în plus serverul are acces complet).
do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_conversations' and policyname='conv_own') then
    create policy "conv_own" on public.ai_conversations for all
      using (auth.uid() = user_id or auth.role() = 'service_role')
      with check (auth.uid() = user_id or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_messages' and policyname='msg_own') then
    create policy "msg_own" on public.ai_messages for all
      using (
        auth.role() = 'service_role'
        or exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid())
      )
      with check (
        auth.role() = 'service_role'
        or exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = auth.uid())
      );
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_skill_mastery' and policyname='mastery_own_read') then
    create policy "mastery_own_read" on public.ai_skill_mastery for select
      using (auth.uid() = user_id or auth.role() = 'service_role');
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_skill_mastery' and policyname='mastery_service_write') then
    create policy "mastery_service_write" on public.ai_skill_mastery for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- =====================================================================
-- GATA. Pasul următor: rulează /api/ai-ingest?action=reindex o dată
-- (din panoul de admin) ca să indexezi conținutul existent.
-- =====================================================================
