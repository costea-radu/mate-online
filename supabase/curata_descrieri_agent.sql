-- =====================================================================
-- ExamenMate — curăță descrierile de tip
--   „Generat automat de agentul Claude (task „…”) · 06.08.2026”
--   „Generat de agentul Claude (task „…”) · aprobat 06.08.2026”
-- de pe materialele DEJA postate de agent (cele noi nu le mai primesc —
-- vezi api/_lib/exgen.js). Rulează în Supabase → SQL Editor → New Query.
-- SIGUR DE RULAT REPETAT. Atinge DOAR rândurile postate de agent
-- (interactive_data->>'agent' = 'claude') a căror descriere începe cu
-- „Generat” — descrierile scrise de mână rămân neatinse.
-- =====================================================================

update content
set description = ''
where content_type = 'interactive'
  and interactive_data->>'agent' = 'claude'
  and description like 'Generat%';

-- Verificare (așteptat: 0 rânduri)
select id, title, description
from content
where interactive_data->>'agent' = 'claude'
  and description like 'Generat%';
