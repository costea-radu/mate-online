-- =====================================================================
-- ExamenMate · 📤 FIȘIERELE MODEL (Admin) — 15 noiembrie 2026
--
-- Admin → „📤 Fișiere model": poze, PDF-uri sau documente Word cu exerciții-model,
-- din care task-urile programate de mai târziu vor genera exerciții noi. NU se
-- publică nicăieri: nu sunt materiale pentru elevi și nu intră în Biblioteca
-- utilizatorilor.
--
--   admin_model_files — fiecare fișier model: unde e (PDF-ul, în bucketul privat
--                       personal-pdfs, în folderul adminului: <id admin>/fisiere-model/…),
--                       textul extras (formulele ca LaTeX), clasa SAU examenul (EN /
--                       BAC + profil), capitolul (text liber, propus din capitolele
--                       site-ului; capitol_id = capitolul recunoscut, pentru
--                       corespondența automată), tipul exercițiilor (grilă / redactare /
--                       mixt), exercițiul de examen ilustrat (opțional), starea
--                       (neprocesat / procesat — o schimbă task-ul care îl folosește).
--
-- Toate citirile și scrierile trec prin server (api/fisiere-model.js, rolul de
-- serviciu, doar pentru administratori). Fără acces pentru vizitatori (anon).
-- Fișierele stau în bucketul privat personal-pdfs (supabase/personal_pdfs_bucket.sql:
-- fiecare cont scrie doar în folderul lui) — fără bucket nou.
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- =====================================================================

create table if not exists public.admin_model_files (
  id              uuid primary key default gen_random_uuid(),
  titlu           text not null default '',
  file_path       text not null,                         -- calea PDF-ului în bucket (nu e un URL public)
  bucket          text not null default 'personal-pdfs',
  sursa           text not null default 'pdf'
                  check (sursa in ('pdf', 'docx', 'foto')),   -- ce a încărcat adminul (pozele / Word-ul → PDF, în browser)
  nume_original   text,                                  -- numele fișierului încărcat („3 poze" la poze)
  pagini          integer,
  octeti          integer,
  text            text not null default '',              -- textul extras (Word: formulele ca LaTeX; poze: transcris; PDF: pdf-parse)
  text_sursa      text,                                  -- word | transcriere | pdf | fara
  clasa           smallint check (clasa between 5 and 12),
  examen          text check (examen in ('evaluare-nationala', 'bacalaureat')),
  profil          text check (profil in ('mate-info', 'stiinte-naturii', 'tehnologic')),
  capitol         text not null default '',
  capitol_id      text,                                  -- api/_lib/capitoleHarta.js (ex. c6-intregi, en-reale)
  tip_exercitiu   text not null default 'mixt'
                  check (tip_exercitiu in ('grila', 'redactare', 'mixt')),
  examen_asociat  jsonb,                                 -- { examen, subiect, exercitiu, eticheta: „EN Subiectul I exercițiul 3" }
  status          text not null default 'neprocesat'
                  check (status in ('neprocesat', 'procesat')),
  uploaded_at     timestamptz not null default now(),
  uploaded_by     uuid,
  updated_at      timestamptz not null default now(),
  processed_at    timestamptz,
  processed_by    text,                                  -- task-ul (sau adminul) care l-a folosit
  constraint admin_model_files_tinta check (clasa is not null or examen is not null)
);
alter table public.admin_model_files enable row level security;

grant select, insert, update, delete on public.admin_model_files to authenticated;
grant select, insert, update, delete on public.admin_model_files to service_role;

create index if not exists idx_admin_model_files_stare on public.admin_model_files(status, uploaded_at desc);
create index if not exists idx_admin_model_files_tinta on public.admin_model_files(clasa, examen, capitol_id);

-- Politicile: doar serverul (rolul de serviciu). Fără politici pentru `authenticated`:
-- RLS îi refuză pe toți ceilalți; Admin citește și scrie prin api/fisiere-model.js.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'admin_model_files' and policyname = 'admin_model_files_service') then
    create policy admin_model_files_service on public.admin_model_files for all to service_role using (true) with check (true);
  end if;
end $$;

comment on table public.admin_model_files is
  'Fișierele model din Admin („📤 Fișiere model"): sursa task-urilor programate care generează exerciții noi. Nu se publică nicăieri.';

-- Verificare rapidă:
-- select status, count(*) from public.admin_model_files group by status;
-- select titlu, clasa, examen, capitol, tip_exercitiu, examen_asociat->>'eticheta' from public.admin_model_files order by uploaded_at desc limit 20;
