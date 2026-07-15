-- =====================================================================
-- Salvarea subiectelor PDF combinate în „Testele și exercițiile mele”.
-- PDF-urile mari NU pot fi salvate ca base64 în tabel (API-ul Supabase
-- respinge cererile JSON mari cu eroarea 413) — le punem în Storage,
-- într-un bucket PRIVAT, iar în tabel rămâne doar calea fișierului.
-- Rulează O SINGURĂ DATĂ în Supabase → SQL Editor. Idempotent.
-- =====================================================================

-- 1) Bucket privat (max 25 MB / fișier, doar PDF)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('personal-pdfs', 'personal-pdfs', false, 26214400, array['application/pdf'])
on conflict (id) do nothing;

-- 2) Politici: fiecare utilizator își vede/încarcă/șterge DOAR propriile
--    fișiere (primul segment din cale = id-ul lui: <uid>/fisier.pdf)
drop policy if exists "personal_pdfs_select" on storage.objects;
create policy "personal_pdfs_select" on storage.objects for select
  using (bucket_id = 'personal-pdfs' and auth.uid()::text = (string_to_array(name, '/'))[1]);

drop policy if exists "personal_pdfs_insert" on storage.objects;
create policy "personal_pdfs_insert" on storage.objects for insert
  with check (bucket_id = 'personal-pdfs' and auth.uid()::text = (string_to_array(name, '/'))[1]);

drop policy if exists "personal_pdfs_update" on storage.objects;
create policy "personal_pdfs_update" on storage.objects for update
  using (bucket_id = 'personal-pdfs' and auth.uid()::text = (string_to_array(name, '/'))[1]);

drop policy if exists "personal_pdfs_delete" on storage.objects;
create policy "personal_pdfs_delete" on storage.objects for delete
  using (bucket_id = 'personal-pdfs' and auth.uid()::text = (string_to_array(name, '/'))[1]);

-- 3) kind='pdf' permis în biblioteca personală (dacă nu s-a rulat deja
--    supabase/ai_personal_pdf.sql)
alter table public.ai_personal_items drop constraint if exists ai_personal_items_kind_check;
alter table public.ai_personal_items
  add constraint ai_personal_items_kind_check
  check (kind in ('interactive', 'exam', 'practice', 'pdf'));
