-- =====================================================================
-- ai_pregen.sql — EXPLICAȚII PRE-GENERATE PER EXERCIȚIU (pasul 3 din
-- GHID_LIMITE_AI.md). Rulezi O DATĂ în Supabase → SQL Editor.
-- Idempotent: poate fi rulat de mai multe ori fără efecte secundare.
--
-- Pentru fiecare material din `content` care are cunoștințe indexate în
-- `ai_knowledge`, cronul generează O DATĂ o explicație canonică („explain")
-- și un indiciu („hint"), pe modelul ieftin. Cererile canonice din chat
-- („explică-mi exercițiul", „dă-mi un indiciu") se servesc apoi DIN TABelă —
-- cost 0, latență ~0 — în loc să genereze din nou pentru fiecare elev.
-- =====================================================================

-- 1) Tabela explicațiilor pre-generate
create table if not exists public.ai_pregen (
  content_id  uuid not null references public.content(id) on delete cascade,
  kind        text not null check (kind in ('explain','hint')),
  text        text not null,
  model       text,                        -- modelul cu care s-a generat
  source_hash text,                        -- hash-ul sursei (detectează învechirea)
  updated_at  timestamptz default now(),
  primary key (content_id, kind)
);

comment on table public.ai_pregen is 'Explicații/indicii canonice pre-generate per material (vezi GHID_LIMITE_AI.md, pasul 3)';

-- RLS strict: doar serverul (service_role) citește/scrie — filtrarea
-- gratuit/premium se aplică în cod, la servire.
alter table public.ai_pregen enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_pregen' and policyname='pregen_service') then
    create policy "pregen_service" on public.ai_pregen for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;

-- 2) Candidații la pre-generare: materiale cu cunoștințe indexate cărora le
--    lipsește explicația sau indiciul, ORI ale căror cunoștințe s-au schimbat
--    după ultima generare (materialul a fost editat → explicația e învechită).
create or replace function public.ai_pregen_candidates(p_limit int default 10)
returns table (content_id uuid)
language sql stable security definer set search_path = public as $$
  select c.id
  from public.content c
  where exists (select 1 from public.ai_knowledge k where k.source_id = c.id)
    and (
      not exists (select 1 from public.ai_pregen p where p.content_id = c.id and p.kind = 'explain')
      or not exists (select 1 from public.ai_pregen p where p.content_id = c.id and p.kind = 'hint')
      or exists (
        select 1 from public.ai_knowledge k2
        where k2.source_id = c.id
          and k2.updated_at > (select min(p2.updated_at) from public.ai_pregen p2 where p2.content_id = c.id)
      )
    )
  order by c.created_at desc
  limit greatest(p_limit, 1);
$$;

-- doar serverul o poate apela — ca la funcțiile RAG
revoke all on function public.ai_pregen_candidates(int) from public;
revoke all on function public.ai_pregen_candidates(int) from anon;
revoke all on function public.ai_pregen_candidates(int) from authenticated;

-- =====================================================================
-- VERIFICARE (opțional, după rulare):
--   select count(*) from public.ai_pregen_candidates(1000);
--     → câte materiale așteaptă pre-generare (scade spre 0 pe măsură ce
--       rulează cronul de ingest, care procesează câteva per rulare).
--
-- MONITORIZARE ACOPERIRE:
--   select kind, count(*) as generate, max(updated_at) as ultima
--   from public.ai_pregen group by kind;
--
--   -- cât s-au folosit (serviri cu cost 0, din jurnalul de utilizare):
--   select count(*) as serviri_gratuite
--   from public.ai_usage
--   where endpoint like 'ai-chat%:pregen' and created_at > now() - interval '30 days';
-- =====================================================================
