-- =====================================================================
-- ExamenMate · OPȚIONAL (Etapa 3, AUDIT_AGENTI_AI.md 2.1): scorurile testelor
-- interactive se scriu DOAR de pe server (api/ai-score.js, ai-meditatii), nu
-- din browser. Rulează DUPĂ ce deploy-ul cu Etapa 3 e activ — altfel
-- InteractiveViewer nu mai poate salva scoruri pe drumul vechi.
--
-- Ce face: scoate politicile INSERT/UPDATE ale utilizatorilor pe `progress`
-- (citirea rămâne). Rolul de serviciu (folosit de API) nu e afectat de RLS.
-- Revenire: rulează din nou supabase/progress_schema.sql (politicile originale).
-- =====================================================================
do $$
declare p record;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'progress' and cmd in ('INSERT', 'UPDATE') loop
    execute format('drop policy if exists %I on public.progress', p.policyname);
  end loop;
end $$;
-- (dacă vrei și să interzici explicit scrierea pentru `authenticated`, fără politici RLS de INSERT/UPDATE
-- cererile sunt oricum respinse; nu e nevoie de revoke)
