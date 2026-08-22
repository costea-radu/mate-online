-- =====================================================================
-- ExamenMate · Meditații — FINALIZAREA TEMELOR (completă / incompletă)
-- Adaugă statusul „incompleta" pe temele Profesorului Virtual:
--   data       → de rezolvat (temă nefăcută)
--   rezolvata  → FINALIZATĂ: toate problemele rezolvate (sau scor din site)
--   incompleta → FINALIZATĂ INCOMPLET: elevul a apăsat „🏁 Finalizează tema"
--                fără să termine toate problemele — se înregistrează ca atare,
--                nu mai e „nefăcută", nu blochează alte teme și poate fi
--                RELUATĂ oricând (răspunsurile date rămân în payload.answers)
--   expirata   → rezervat
-- Rulează în Supabase → SQL Editor → Run. Idempotent (se poate rula repetat).
-- Fără această migrare, serverul salvează temele incomplete ca „rezolvata" +
-- feedback.complete=false (interfața citește ambele forme) — deci nimic nu se
-- strică, dar statusul explicit e recomandat.
-- =====================================================================

do $$
declare c record;
begin
  -- constrângerea CHECK a coloanei status (numele poate diferi între instalări)
  for c in
    select conname from pg_constraint
    where conrelid = 'public.ai_meditatii_homework'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.ai_meditatii_homework drop constraint %I', c.conname);
  end loop;

  alter table public.ai_meditatii_homework
    add constraint ai_meditatii_homework_status_check
    check (status in ('data', 'rezolvata', 'incompleta', 'expirata'));
end $$;

comment on column public.ai_meditatii_homework.status is
  'data = de rezolvat · rezolvata = finalizată complet · incompleta = finalizată fără toate problemele (se poate relua oricând) · expirata = rezervat';
comment on column public.ai_meditatii_homework.feedback is
  'Corectarea: {grade, message, complete, answered, total, auto}; complete=false = temă incompletă';
comment on column public.ai_meditatii_homework.payload is
  'kind=interactive: {questions[], answers[] (răspunsurile elevului — ciornă sau finalizare incompletă, pentru reluare)}; kind=content: {url}';
