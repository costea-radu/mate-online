-- =====================================================================
-- ExamenMate · PDF ↔ TESTUL INTERACTIV + PUNCTAJUL CUMULAT (19 noiembrie 2026)
--
-- Cererea: „Asociază fiecare PDF cu testul interactiv generat după el. […] Fă ca în
-- butonul «Rezolvă pe PDF» de pe PDF-uri, pe lângă variantele de rezolvare din
-- rolldown, să apară și «interactiv», care deschide testul interactiv asociat
-- PDF-ului. […] La schimbarea metodei de rezolvare în timpul rezolvării, să se
-- păstreze punctajul acumulat până atunci."
--
--   content.interactiv_id — pe rândul unui PDF: testul interactiv generat după el
--                           (metoda „🧩 Interactiv" din „✏️ Rezolvă pe PDF ▾"). Îl pune
--                           generatorul (api/_lib/exgen.js, la testele făcute dintr-un
--                           singur PDF) sau adminul (📋 Tot Conținutul → ✏️ la PDF).
--                           Testul șters → asocierea dispare singură (on delete set null).
--   progress.itemi        — punctajul PE EXERCIȚII al rezolvării în curs a unui test
--                           (api/_lib/punctajCumulat.js): la fiecare corectare — pe PDF,
--                           cu poză, în chat, în foaia de lucru sau în testul interactiv
--                           asociat — exercițiile corectate acum le înlocuiesc pe cele
--                           vechi, iar cele nerezolvate acum își păstrează punctele.
--                           Rezultatul testului (`score`) = suma exercițiilor.
--
-- Fără tabele noi: coloanele moștenesc drepturile și politicile RLS ale tabelelor
-- (content — citit de oricine, scris de admin / server; progress — fiecare elev
-- rândurile lui; serverul scrie cu rolul de serviciu).
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- Fără el: „🧩 Interactiv" nu apare, iar corectările merg ca înainte (ultima contează).
-- =====================================================================

alter table public.content
  add column if not exists interactiv_id uuid references public.content(id) on delete set null;

comment on column public.content.interactiv_id is
  'PDF → testul interactiv generat după el (metoda „🧩 Interactiv” din vizualizatorul PDF).';

create index if not exists idx_content_interactiv
  on public.content(interactiv_id) where interactiv_id is not null;

alter table public.progress
  add column if not exists itemi jsonb;

comment on column public.progress.itemi is
  'Punctajul pe exerciții al rezolvării în curs: {v, la, max, itemi: {"1.3": {p, m, metoda, la}}} — api/_lib/punctajCumulat.js.';
