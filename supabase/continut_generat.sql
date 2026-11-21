-- =====================================================================
-- ExamenMate · 🤖 CONȚINUTUL GENERAT (skill-ul „examenmate-continut") — 21 noiembrie 2026
--
-- Cererea: „fă modificările: tabela continut_generat, cele două Action-uri («Aduce surse»
-- și «Publică») și fila din Admin" — pentru task-urile programate care generează bareme,
-- teste interactive, fișe după fișierele model, variante EN, explicații la grila EN și
-- verifică testele interactive existente. Ce trece verificarea după barem se publică
-- direct; restul intră ca ciornă și se aprobă din Admin → „🤖 Conținut generat".
--
--   continut_generat — câte un rând pe „unitate" (materialul + baremul lui), scris de
--                      GitHub Action-ul „Publică" din repo-ul privat examenmate-continut
--                      (scripts/continut/publica.js → api/_lib/continutGenerat.js):
--                      ce s-a cerut (manifest), ce fișiere s-au urcat (fisiere), ce
--                      rânduri s-au creat sau schimbat (creat — pentru „Anulează"),
--                      verificările, starea și cine a decis.
--
-- Stările: in_lucru (Action-ul tocmai o procesează) · publicat (direct, verificată după
-- barem) · ciorna (așteaptă aprobarea) · aprobat (ciornă publicată din Admin) · respins ·
-- anulat (publicată, apoi retrasă din Admin) · esuat · conflict (între timp altcineva a
-- completat golul — nu s-a scris nimic) · verificat (procedura 6: testul era în regulă) ·
-- nimic (procedura n-a avut ce face).
--
-- Scriu și citesc DOAR serverul și Action-ul (rolul de serviciu); browserul nu atinge
-- tabela. Fără acces pentru vizitatori (anon).
-- Rulează în Supabase → SQL Editor → New Query → Run. Idempotent.
-- =====================================================================

create table if not exists public.continut_generat (
  id             uuid primary key default gen_random_uuid(),
  unitate        text not null unique,                     -- calea unității în repo: <data>/<procedura>-<id>
  procedura      smallint not null check (procedura between 1 and 6),
  status         text not null default 'in_lucru'
                 check (status in ('in_lucru', 'publicat', 'ciorna', 'aprobat', 'respins', 'anulat', 'esuat', 'conflict', 'verificat', 'nimic')),
  decizie        text check (decizie in ('publica', 'ciorna', 'nimic', 'verificat', 'esuat')),
  titlu          text not null default '',
  motiv          text,                                     -- de ce e ciornă / de ce a eșuat / conflictul
  sursa_id       uuid references public.content(id) on delete set null,             -- materialul de pornire
  model_id       uuid references public.admin_model_files(id) on delete set null,   -- procedura 3
  manifest       jsonb not null default '{}'::jsonb,       -- manifestul unității (fără secrete)
  fisiere        jsonb not null default '{}'::jsonb,       -- { rol: { bucket, path, file_url, bytes } }
  creat          jsonb not null default '{}'::jsonb,       -- ce s-a creat / schimbat (pentru „Anulează")
  verificari     jsonb,
  rulare         text,                                     -- rularea task-ului programat
  eroare         text,
  creat_la       timestamptz not null default now(),
  actualizat_la  timestamptz not null default now(),
  decis_la       timestamptz,
  decis_de       uuid references auth.users(id) on delete set null
);
alter table public.continut_generat enable row level security;

grant select, insert, update, delete on public.continut_generat to authenticated;
grant select, insert, update, delete on public.continut_generat to service_role;

-- În acest proiect, privilegiile implicite (pg_default_acl) dau unei tabele noi TOATE drepturile
-- și pentru anon. Jurnalul nu e public (îl citește doar Admin, prin server) → anon nimic.
revoke all on public.continut_generat from anon;

create index if not exists idx_continut_generat_stare on public.continut_generat(status, creat_la desc);
create index if not exists idx_continut_generat_sursa on public.continut_generat(procedura, sursa_id);
create index if not exists idx_continut_generat_model on public.continut_generat(model_id);

do $$
begin
  -- doar serverul (rolul de serviciu); nicio politică pentru authenticated: Admin citește și
  -- decide prin api/continut-generat.js, Action-ul scrie cu cheia de serviciu
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'continut_generat' and policyname = 'continut_generat_service') then
    create policy continut_generat_service on public.continut_generat for all to service_role
      using (true) with check (true);
  end if;
end $$;

comment on table public.continut_generat is
  'Conținutul generat de skill-ul examenmate-continut (task-uri programate): jurnal, ciorne, ce s-a publicat direct și ce s-a anulat. Scris de GitHub Action-ul „Publică", citit de Admin → 🤖 Conținut generat.';

-- Verificare rapidă:
-- select procedura, status, count(*) from public.continut_generat group by 1, 2 order by 1, 2;
-- select creat_la, procedura, status, titlu, motiv from public.continut_generat order by creat_la desc limit 30;
