-- =====================================================================
-- ExamenMate · Profesor Virtual — completare v7
--   • ai_assignments.creator_role → „profesor" / „parinte" (pentru atribuire)
--   • ai_public_library → teste/exerciții publicate de profesori (Biblioteca utilizatorilor)
-- Rulează DUPĂ v1–v6. Idempotent.
-- =====================================================================

alter table public.ai_assignments add column if not exists creator_role text default 'profesor';

create table if not exists public.ai_public_library (
  id           uuid primary key default gen_random_uuid(),
  created_by   uuid references auth.users(id) on delete set null,
  creator_name text,
  creator_role text default 'profesor',
  kind         text not null check (kind in ('exam', 'practice', 'interactive')),
  title        text not null,
  category     text,
  topic        text,
  payload      jsonb not null default '{}'::jsonb,  -- exam:{exam} | practice:{statement,options,answer,answer_type,solution} | interactive:{html}
  search_text  text,                                 -- pentru căutare (titlu + subiect + enunț)
  created_at   timestamptz default now()
);
create index if not exists idx_pubkib_created on public.ai_public_library(created_at desc);
create index if not exists idx_pubkib_cat on public.ai_public_library(category);
create index if not exists idx_pubkib_search on public.ai_public_library using gin (to_tsvector('simple', coalesce(search_text, '')));

alter table public.ai_public_library enable row level security;
do $$ begin
  -- Oricine poate citi (biblioteca e publică); scrierea doar prin server (endpoint).
  if not exists (select 1 from pg_policies where tablename='ai_public_library' and policyname='pub_read_all') then
    create policy "pub_read_all" on public.ai_public_library for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename='ai_public_library' and policyname='pub_service_write') then
    create policy "pub_service_write" on public.ai_public_library for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
  -- creatorul își poate șterge propriile publicații
  if not exists (select 1 from pg_policies where tablename='ai_public_library' and policyname='pub_owner_delete') then
    create policy "pub_owner_delete" on public.ai_public_library for delete
      using (auth.uid() = created_by);
  end if;
end $$;
