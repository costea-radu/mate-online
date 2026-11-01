-- =====================================================================
-- ExamenMate · BANCA DE EXERCIȚII din fișele claselor 5–12 (1 nov. 2026)
--
-- „🧩 Generează exerciții/teste…" → „👥 Teste diferite / elev" → „📚 Fișele
-- claselor 5–12": profesorul bifează nivelele / tipurile de exerciții dintr-o
-- fișă (așa cum sunt scrise în ea: „Nivel 3", „MODEL 2", „Exercițiul 1 …"),
-- iar fiecare elev primește alt test.
--
-- Fișele au exercițiile câte 2–4 pe rând și formulele lipsă din stratul de
-- text, deci fișa o citește O SINGURĂ DATĂ modelul cu vedere (api/fise.js →
-- api/_lib/fise.js). Rezultatul — grupele, cu exercițiile lor în LaTeX — se
-- păstrează aici și îl folosesc toți profesorii: testele din fișe se compun
-- apoi fără niciun cost. Dacă fișierul fișei se schimbă (alt file_url), fișa
-- se citește din nou la următoarea cerere.
--
-- Citirea (o singură dată per fișă, ~1–2 lei) se plătește din contul
-- platformei, nu din creditele profesorului: rândul din ai_usage are
-- user_id null și endpoint „fise:transcriere" (vezi ai_usage_daily).
--
-- Tabela e citită și scrisă DOAR de server (rolul de serviciu); profesorii o
-- văd prin /api/fise. Rulează în Supabase → SQL Editor → New Query. Idempotent.
-- =====================================================================

create table if not exists public.fise_banca (
  content_id  uuid primary key references public.content(id) on delete cascade,
  file_url    text,                                   -- fișierul citit (altul → se citește din nou)
  category    text,                                   -- clasa-5 … clasa-12
  title       text,                                   -- titlul fișei, la citire
  status      text not null default 'pending'
              check (status in ('pending', 'ok', 'partial')), -- pending = încă necitită; partial = o bucată de pagini n-a putut fi citită
  reading_since timestamptz,                          -- „se citește chiar acum" (lacăt: o singură citire odată)
  groups      jsonb not null default '[]'::jsonb,     -- [{ key, title, kind, instruction, exercises:[{ n, text, figure? }] }]
  summary     jsonb not null default '[]'::jsonb,     -- doar titlurile grupelor + câte exerciții au (lista fișelor)
  exercises   int not null default 0,                 -- câte exerciții are fișa, în total
  pages       int,
  model       text,                                   -- modelul care a citit fișa
  cost_micro  bigint not null default 0,              -- costul citirii (micro-lei)
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
-- (rulat din nou după o versiune mai veche a fișierului: coloanele noi se adaugă)
alter table public.fise_banca add column if not exists reading_since timestamptz;
alter table public.fise_banca add column if not exists summary jsonb not null default '[]'::jsonb;
create index if not exists idx_fise_banca_category on public.fise_banca(category);

alter table public.fise_banca enable row level security;

grant select, insert, update, delete on public.fise_banca to authenticated;
grant select, insert, update, delete on public.fise_banca to service_role;

-- Politica: doar serverul (rolul de serviciu). Fără politici pentru
-- `authenticated`: RLS îi refuză pe toți ceilalți — profesorii citesc prin API.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fise_banca' and policyname = 'fise_banca_service') then
    create policy fise_banca_service on public.fise_banca for all to service_role using (true) with check (true);
  end if;
end $$;

-- =====================================================================
-- VERIFICARE (opțional, după rulare):
--   select category, count(*) as fise, sum(exercises) as exercitii,
--          round(sum(cost_micro) / 1e6, 2) as lei_citire
--   from public.fise_banca where status <> 'pending' group by 1 order by 1;
-- O fișă citită greșit se citește din nou din pagină (admin: „🔄 Citește din nou")
-- sau ștergându-i rândul: delete from public.fise_banca where content_id = '…';
-- =====================================================================
