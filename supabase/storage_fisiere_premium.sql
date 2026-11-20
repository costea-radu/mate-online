-- =====================================================================
-- ExamenMate · FIȘIERELE PREMIUM: DOAR PRIN LINKUL SEMNAT DE SERVER (19 noiembrie 2026)
--
-- Problema: politicile vechi din Storage dădeau ORICĂRUI cont autentificat (și unuia gratuit):
--   • citirea / descărcarea tuturor fișierelor din bucket-ul privat `content-files` (materialele
--     Premium — căile lor sunt publice, în content.file_url);
--   • încărcarea și ȘTERGEREA fișierelor din `content-files` și `content-files-free`.
-- Verificat înainte de schimbare: un cont gratuit „vedea" toate cele 530 de fișiere Premium.
--
-- De acum:
--   • elevii (gratuit sau Premium) primesc fișierele DOAR prin linkul semnat de server
--     (api/get-file-url.js: gratuit → oricine; Premium → abonații, adminii, tema pe grupă cu
--     „premium gratuit"), valabil 5 minute — neschimbat;
--   • în browser, doar ADMINII (profiles.is_admin) citesc, încarcă și șterg în cele două
--     bucket-uri — paginile din Admin (Adaugă PDF / Exerciții Interactive, Încarcă bareme,
--     Variante AI, Explicații grilă, Înlocuiește fișierul, Șterge, baremele din pagina clasei,
--     agentul de exerciții);
--   • serverul (rolul de serviciu) — ca înainte („Service role full access storage").
-- Fișierele gratuite rămân publice (bucket-ul `content-files-free` e public, ca înainte).
-- Celelalte bucket-uri (personal-pdfs, discussions, …) — neatinse.
--
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- =====================================================================

-- politicile prea largi
drop policy if exists "Authenticated users can create signed URLs" on storage.objects;
drop policy if exists "Authenticated users can download files" on storage.objects;
drop policy if exists "Authenticated users can upload files" on storage.objects;
drop policy if exists "Authenticated users can delete files" on storage.objects;

-- adminii: citesc (și ca să poată șterge — Storage cere SELECT + DELETE), încarcă, șterg
drop policy if exists "content_files_admin_select" on storage.objects;
create policy "content_files_admin_select" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('content-files', 'content-files-free')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

drop policy if exists "content_files_admin_insert" on storage.objects;
create policy "content_files_admin_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id in ('content-files', 'content-files-free')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );

drop policy if exists "content_files_admin_delete" on storage.objects;
create policy "content_files_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id in ('content-files', 'content-files-free')
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin = true)
  );
