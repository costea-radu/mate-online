-- =====================================================================
-- ExamenMate · TESTUL INTERACTIV → PDF-UL DUPĂ CARE E FĂCUT (19 noiembrie 2026, runda a doua)
--
-- Cererea: „S-au asociat puține teste. Fiecare test interactiv e generat după un PDF. Doar la
-- evaluare națională testele de la 32 până la 61 nu sunt după PDF. Încearcă să faci o asociere
-- mai bună"
--
--   content.pdf_sursa_id — pe rândul unui TEST INTERACTIV: PDF-ul după care e făcut.
--     Un PDF poate avea mai multe teste (ex. varianta veche, gratuită, din iulie și cea nouă a
--     generatorului; o fișă reîncărcată și testul făcut după versiunea ei veche).
--   content.interactiv_id (supabase/pdf_interactiv.sql) rămâne testul PRINCIPAL al PDF-ului —
--     cel deschis de „🧩 Interactiv"; elevul fără abonament primește un test GRATUIT al aceluiași
--     PDF, dacă există (src/pages/PDFViewer.jsx).
--   Adminul le schimbă din 📋 Tot Conținutul → ✏️ (la PDF: testul principal; la test: PDF-ul lui);
--   serverul le ține în acord (api/content-admin.js).
--
-- Fără tabele noi (coloana moștenește drepturile și politicile tabelei content). Idempotent.
-- =====================================================================

alter table public.content
  add column if not exists pdf_sursa_id uuid references public.content(id) on delete set null;

comment on column public.content.pdf_sursa_id is
  'Test interactiv → PDF-ul după care e făcut (un PDF poate avea mai multe teste; content.interactiv_id = testul principal).';

create index if not exists idx_content_pdf_sursa
  on public.content(pdf_sursa_id) where pdf_sursa_id is not null;

-- testele principale de până acum își știu PDF-ul
update public.content t
   set pdf_sursa_id = p.id
  from public.content p
 where p.interactiv_id = t.id
   and p.content_type = 'pdf'
   and t.content_type = 'interactive'
   and t.pdf_sursa_id is null;
