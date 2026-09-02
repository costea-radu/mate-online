-- =====================================================================
-- ExamenMate · Profesor Virtual — CACHE pentru FORMULARELE de răspuns
-- („Răspunde în chat" → api/ai-correct.js, action='form')
--
-- Până acum, FIECARE elev care apăsa „📝 Răspunde în chat" pe același test
-- PDF punea modelul să reconstruiască formularul de la zero (test + barem →
-- ~3500 tokeni de ieșire, 10–25 s de așteptare). Pentru un test dat,
-- structura formularului este însă mereu aceeași: aceleași exerciții,
-- aceleași subpuncte, aceleași puncte din barem.
--
-- De acum formularul se construiește O SINGURĂ DATĂ și se refolosește de
-- toți utilizatorii:
--   · test din platformă (content_id) → cheia „c:<content_id>";
--   · poză / PDF încărcat de elev      → cheia „u:<hash-ul textului>",
--     deci și doi elevi care încarcă același material primesc același
--     formular, fără o a doua generare.
--
-- Invalidare: `source_hash` = amprenta (test + barem + categorie) folosită
-- la generare. Dacă se schimbă fișierul, baremul sau categoria, amprenta
-- diferă și formularul se regenerează automat (și se rescrie aici).
-- Tokenul semnat NU se păstrează: el se re-semnează la fiecare cerere, ca
-- să-și păstreze termenul de valabilitate (AI_CORRECT_FORM_TTL).
--
-- Rulează o dată în Supabase → SQL Editor. Idempotent.
-- =====================================================================

create table if not exists public.ai_correct_forms (
  cache_key   text primary key,                 -- 'c:<content_id>' | 'u:<sha256 text>'
  content_id  uuid references public.content(id) on delete cascade,
  source_hash text not null,                    -- sha256(test + barem + categorie)
  title       text not null default '',
  items       jsonb not null,                   -- cerințele normalizate (id, eticheta, cerinta, puncte, subpuncte)
  has_barem   boolean not null default false,
  total       numeric not null default 0,       -- punctajul maxim al cerințelor
  oficiu      int     not null default 0,       -- punctele din oficiu (10 la examene oficiale)
  category    text    not null default '',
  hits        int     not null default 0,       -- de câte ori a fost refolosit (economia făcută)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_ai_correct_forms_content on public.ai_correct_forms(content_id);
create index if not exists idx_ai_correct_forms_updated on public.ai_correct_forms(updated_at desc);

-- Doar serverul (service_role) citește/scrie: formularul conține cerințele
-- testelor premium (și punctajele din barem) — nu trebuie să ajungă la
-- clienți pe această cale, ci doar prin răspunsul verificat al API-ului.
alter table public.ai_correct_forms enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='ai_correct_forms' and policyname='ai_correct_forms_service') then
    create policy "ai_correct_forms_service" on public.ai_correct_forms for all
      using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
  end if;
end $$;
revoke all on public.ai_correct_forms from anon, authenticated;

-- Contorul de refolosiri, incrementat la fiecare servire din cache
-- (o singură cerere, fără citire-apoi-scriere).
create or replace function public.ai_correct_form_hit(p_key text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.ai_correct_forms set hits = hits + 1 where cache_key = p_key;
$$;
revoke all on function public.ai_correct_form_hit(text) from public;
revoke all on function public.ai_correct_form_hit(text) from anon;
revoke all on function public.ai_correct_form_hit(text) from authenticated;
grant execute on function public.ai_correct_form_hit(text) to service_role;

-- Când se înlocuiește fișierul unui material, formularul lui nu mai e valabil.
-- (Redundant cu source_hash, dar curăță rândul imediat.)
create or replace function public.ai_correct_forms_invalidate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'UPDATE' and new.file_url is distinct from old.file_url) then
    delete from public.ai_correct_forms where content_id = new.id;
  end if;
  return new;
end $$;

drop trigger if exists trg_ai_correct_forms_invalidate on public.content;
create trigger trg_ai_correct_forms_invalidate
  after update of file_url on public.content
  for each row execute function public.ai_correct_forms_invalidate();

-- funcție de trigger, nu de API — o scoatem din /rest/v1/rpc (lint 0028/0029).
-- PostgreSQL dă implicit EXECUTE lui PUBLIC pe orice funcție nouă; triggerul
-- nu are nevoie de el (rulează cu drepturile proprietarului funcției).
revoke execute on function public.ai_correct_forms_invalidate() from public, anon, authenticated;

-- Verificare (opțional) — ambele funcții trebuie să iasă cu `false, false`:
--   select p.oid::regprocedure as functie,
--          has_function_privilege('anon',          p.oid, 'EXECUTE') as anon,
--          has_function_privilege('authenticated', p.oid, 'EXECUTE') as autentificat
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('ai_correct_form_hit', 'ai_correct_forms_invalidate');
