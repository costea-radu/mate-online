-- =====================================================================
-- PĂSTREAZĂ REZULTATELE ELEVILOR după ștergerea materialelor
-- Rulează în Supabase → SQL Editor → New Query. SIGUR DE RULAT REPETAT.
--
-- Problema reparată: `progress.content_id` avea ON DELETE CASCADE, deci
-- ștergerea unui material (test interactiv) din admin ștergea AUTOMAT și
-- toate rezultatele elevilor la el (așa au dispărut rezultatele grupei
-- „elevi 2026"). După acest script:
--   1. rezultatul păstrează ÎN EL titlul/tipul/categoria testului
--      (coloane snapshot, completate la fiecare salvare de punctaj);
--   2. ștergerea materialului NU mai șterge rezultatele — legătura devine
--      ON DELETE SET NULL, iar dashboardul profesorului/părintelui
--      afișează titlul din snapshot;
--   3. adminul poate vedea câte rezultate există la un material înainte
--      să-l șteargă (politică RLS de citire pentru admin).
--
-- ATENȚIE: scriptul NU poate recupera rezultatele DEJA șterse — pentru
-- ele singura cale e un backup Supabase (Database → Backups, plan Pro).
-- =====================================================================

-- 1) Coloanele snapshot (titlul rămâne chiar dacă materialul dispare)
alter table public.progress add column if not exists test_title   text;
alter table public.progress add column if not exists content_type text;
alter table public.progress add column if not exists category     text;

-- 2) Completează snapshotul pentru rezultatele EXISTENTE, din materialele
--    care încă există (idempotent: doar unde titlul lipsește)
update public.progress p
set    test_title   = c.title,
       content_type = coalesce(p.content_type, c.content_type),
       category     = coalesce(p.category, c.category)
from   public.content c
where  c.id = p.content_id
  and  p.test_title is null;

-- 3) Legătura cu materialul: ON DELETE CASCADE → ON DELETE SET NULL
--    (rezultatul rămâne, doar referința se golește; titlul e în snapshot)
alter table public.progress alter column content_id drop not null;

do $$
declare fk text;
begin
  select conname into fk
  from   pg_constraint
  where  conrelid  = 'public.progress'::regclass
    and  contype   = 'f'
    and  confrelid = 'public.content'::regclass;
  if fk is not null then
    execute format('alter table public.progress drop constraint %I', fk);
  end if;
  alter table public.progress
    add constraint progress_content_id_fkey
    foreign key (content_id) references public.content(id) on delete set null;
end $$;

-- Notă: UNIQUE(user_id, content_id) rămâne valid — în Postgres valorile
-- NULL sunt considerate distincte, deci un elev poate avea mai multe
-- rezultate „orfane" (de la materiale șterse diferite) fără conflict.

-- 4) Adminul poate CITI progresul tuturor (pentru avertismentul din
--    dialogul de ștergere: „elevii au N rezultate la acest material")
do $$ begin
  create policy "Admins can view all progress"
    on public.progress for select
    using (exists (
      select 1 from public.profiles pr
      where pr.id = auth.uid() and pr.is_admin = true
    ));
exception when duplicate_object then null; end $$;

-- 5) Verificare rapidă (opțional): rezultate fără material = supraviețuitoare
-- select count(*) as rezultate_totale,
--        count(*) filter (where content_id is null) as fara_material,
--        count(*) filter (where test_title is not null) as cu_titlu_snapshot
-- from public.progress;
