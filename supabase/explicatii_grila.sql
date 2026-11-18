-- =====================================================================
-- ExamenMate · EXPLICAȚIILE LA GRILĂ — Evaluarea Națională (18 noiembrie 2026)
--
-- Cererea: „Pune barem cu explicații pt grila la evaluare națională. Baremul oficial
-- oferă doar rezolvarea grilei fără explicații. În baremul oficial pune buton pentru
-- explicații la grilă. Explicația la grilă o să fie generată ulterior și încărcată."
--
--   barem_explicatii — câte un PDF cu explicațiile grilei (Subiectele I și II, cu
--                      variante de răspuns) pentru un barem oficial de EN. Cheia e
--                      baremul (content.id): baremul separat sau, la „subiecte + barem"
--                      în același PDF, chiar subiectul. Fișierul stă în Storage, în
--                      bucket-ul privat `content-files`; linkul se semnează pe server
--                      la fiecare deschidere, cu aceleași reguli ca baremul (gratuit →
--                      oricine; Premium → abonații și adminii).
--
-- Scriu și citesc DOAR serverul (api/bareme.js → acțiunile explicatii*, service role);
-- browserul nu atinge tabela. Fără acces pentru vizitatori (anon).
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- Fără el, butonul nu apare la elevi, iar Admin → 💡 Explicații grilă spune ce e de rulat.
-- =====================================================================

create table if not exists public.barem_explicatii (
  barem_id    uuid primary key references public.content(id) on delete cascade,
  file_url    text not null,                                   -- PDF-ul în Storage (content-files)
  titlu       text,                                            -- numele afișat (implicit: al fișierului)
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id) on delete set null
);
alter table public.barem_explicatii enable row level security;

grant select, insert, update, delete on public.barem_explicatii to authenticated;
grant select, insert, update, delete on public.barem_explicatii to service_role;

do $$
begin
  -- doar serverul (rolul de serviciu); nicio politică pentru authenticated: nimeni nu
  -- citește sau scrie direct din browser (linkurile se dau semnate, după verificare)
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'barem_explicatii' and policyname = 'barem_explicatii_service') then
    create policy barem_explicatii_service on public.barem_explicatii for all to service_role
      using (true) with check (true);
  end if;
end $$;

-- Verificare rapidă:
-- select e.barem_id, c.title, e.titlu, e.updated_at from public.barem_explicatii e join public.content c on c.id = e.barem_id order by e.updated_at desc;
