-- =====================================================================
-- ExamenMate – ai_public_results: scorurile elevilor la testele din
-- „Biblioteca utilizatorilor" (ai_public_library).
--
-- CONTEXT: tabela era folosită de api/ai-public.js (action='record'), dar
-- nu a existat niciodată o migrație pentru ea → scrierile eșuau în tăcere
-- (endpointul ignora eroarea și întorcea {ok:true}). Acest fișier o creează.
--
-- Rulează în Supabase → SQL Editor → New Query (idempotent).
-- =====================================================================

create table if not exists public.ai_public_results (
  id           uuid primary key default gen_random_uuid(),
  public_id    uuid references public.ai_public_library(id) on delete cascade not null,
  student_id   uuid references auth.users(id) on delete cascade not null,
  score        int,
  max_score    int,
  attempts     int default 1,
  completed_at timestamptz default now(),
  created_at   timestamptz default now(),
  -- un singur rând per (test, elev) — endpointul face select→update/insert pe
  -- această pereche și păstrează scorul maxim.
  unique (public_id, student_id)
);

create index if not exists idx_pubres_public  on public.ai_public_results(public_id);
create index if not exists idx_pubres_student on public.ai_public_results(student_id);

alter table public.ai_public_results enable row level security;

do $$ begin
  -- Rezultatele: le vede elevul respectiv, autorul testului sau serviciul.
  if not exists (select 1 from pg_policies where tablename='ai_public_results' and policyname='pubres_read') then
    create policy "pubres_read" on public.ai_public_results for select
      using (
        auth.uid() = student_id
        or auth.role() = 'service_role'
        or exists (
          select 1 from public.ai_public_library l
          where l.id = public_id and l.created_by = auth.uid()
        )
      );
  end if;
  -- Scrierea doar prin endpointul serverless (service_role).
  if not exists (select 1 from pg_policies where tablename='ai_public_results' and policyname='pubres_service_write') then
    create policy "pubres_service_write" on public.ai_public_results for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- ── Verificare (opțional) ────────────────────────────────────────────
-- select * from public.ai_public_results order by completed_at desc limit 20;
