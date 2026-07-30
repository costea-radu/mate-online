-- =====================================================================
-- DIAGNOSTIC: unde au dispărut rezultatele elevilor din grupa „elevi 2026"?
-- Rulează în Supabase → SQL Editor, interogare cu interogare.
-- TOATE interogările sunt DOAR DE CITIRE — nu modifică nimic.
--
-- CONTEXT TEHNIC (de ce pot „dispărea" rezultate fără niciun DELETE pe
-- tabelul progress): schema `progress` (supabase/progress_schema.sql) are
--     user_id    REFERENCES auth.users(id) ON DELETE CASCADE
--     content_id REFERENCES content(id)    ON DELETE CASCADE
-- Adică Postgres șterge AUTOMAT rândul de progres când se șterge:
--   (A) MATERIALUL (testul/exercițiul) la care se referă — de ex. din
--       Admin → „Tot Conținutul" → 🗑 (dialogul întreabă doar „Sigur vrei
--       să ștergi …?", fără să avertizeze că se pierd și rezultatele
--       tuturor elevilor la acel material); SAU
--   (B) CONTUL elevului (auth.users).
-- În tot codul aplicației NU există niciun DELETE direct pe `progress`.
-- Interogările de mai jos arată care dintre cele două s-a întâmplat.
-- =====================================================================

-- 1) Elevii din grupă mai există? (cont auth + profil + link în grupă)
--    Dacă apar toți aici cu cont_auth_existent = true → conturile NU au
--    fost șterse → rămâne varianta (A): ștergerea materialelor.
select g.name as grupa, ms.student_id, p.full_name, p.email,
       (u.id is not null) as cont_auth_existent,
       u.created_at as cont_creat,
       u.last_sign_in_at as ultima_autentificare
from mentor_groups g
join mentor_students ms on ms.group_id = g.id
left join profiles p on p.id = ms.student_id
left join auth.users u on u.id = ms.student_id
where g.name ilike '%2026%'
order by p.full_name;

-- 2) Câte rezultate mai are în `progress` fiecare elev din grupă
select p.full_name,
       count(pr.id) as rezultate_ramase,
       min(pr.completed_at) as primul,
       max(pr.completed_at) as ultimul
from mentor_students ms
join mentor_groups g on g.id = ms.group_id and g.name ilike '%2026%'
left join profiles p on p.id = ms.student_id
left join progress pr on pr.user_id = ms.student_id
group by p.full_name
order by rezultate_ramase desc;

-- 3) DOVADA pentru varianta (A): conversațiile cu Profesorul Virtual țin
--    id-ul materialului în JSON (fără foreign key), deci SUPRAVIEȚUIESC
--    ștergerii materialului. Dacă elevii din grupă au conversații pe
--    materiale care NU mai există în `content`, materialele au fost șterse
--    → progresul lor a dispărut prin CASCADE exact atunci.
select p.full_name,
       coalesce(c.context->>'contentId', c.context->>'content_id') as content_id,
       (co.id is null) as MATERIAL_STERS,
       c.created_at as data_conversatiei
from ai_conversations c
join mentor_students ms on ms.student_id = c.user_id
join mentor_groups g on g.id = ms.group_id and g.name ilike '%2026%'
left join profiles p on p.id = c.user_id
left join content co
       on co.id::text = coalesce(c.context->>'contentId', c.context->>'content_id')
where coalesce(c.context->>'contentId', c.context->>'content_id') is not null
order by c.created_at desc
limit 200;

-- 4) Aceeași verificare pe TOT site-ul: câte materiale referite în
--    conversațiile AI mai există vs. câte au fost șterse
select (co.id is null) as material_sters,
       count(distinct coalesce(c.context->>'contentId', c.context->>'content_id')) as nr_materiale
from ai_conversations c
left join content co
       on co.id::text = coalesce(c.context->>'contentId', c.context->>'content_id')
where coalesce(c.context->>'contentId', c.context->>'content_id') is not null
group by 1;

-- 5) Varianta (B) — a șters curățarea conturilor inactive pe cineva?
--    NU AVEA CUM încă: sistemul există abia din 27–28 iulie, iar ștergerea
--    cere o avertizare trimisă cu minim 29–30 de zile înainte. În plus,
--    înainte de orice ștergere se creează o ARHIVĂ pentru mentori.
--    Dacă interogarea asta întoarce 0 rânduri, cleanup-ul n-a șters nimic.
select mentor_id, student_name, student_email, reason, deleted_at
from archived_student_results
order by deleted_at desc;

-- 6) Conturi cel mult AVERTIZATE de cleanup (nimic șters încă)
select email, full_name, last_active_at, deletion_warned_at, deletion_scheduled_at
from profiles
where deletion_scheduled_at is not null or deletion_warned_at is not null
order by deletion_scheduled_at nulls last;

-- 7) Când au fost ADĂUGATE materialele actuale — multe materiale create în
--    aceeași zi recentă = o înlocuire/reîncărcare în masă; ziua aceea e,
--    cel mai probabil, și ziua în care s-au șters cele vechi (și, odată cu
--    ele, rezultatele grupei „elevi 2026").
select date_trunc('day', created_at)::date as ziua,
       count(*) as materiale_adaugate
from content
group by 1
order by 1 desc
limit 30;

-- 8) (opțional — sari peste dacă dă eroare de coloană) Temele: ștergerea
--    unei teme șterge în cascadă și rezultatele ei (ai_assignments →
--    ai_assignment_results). Ce teme mai există acum:
select a.id, a.title, count(r.id) as rezultate
from ai_assignments a
left join ai_assignment_results r on r.assignment_id = a.id
group by a.id, a.title
order by a.id desc
limit 50;

-- =====================================================================
-- CÂND s-au șters exact? Postgres nu ține istoric implicit, deci data
-- exactă se poate afla doar din:
--   • Supabase Dashboard → Logs → Postgres — caută „DELETE FROM content"
--     (atenție: retenția e ~1 zi pe planul Free, ~7 zile pe Pro);
--   • interogarea 7 de mai sus (ziua reîncărcării în masă = momentul probabil);
--   • Backups (mai jos), comparând ce exista la fiecare dată.
--
-- RECUPERARE: Supabase Dashboard → Database → Backups.
--   • Plan Pro: există backupuri zilnice (sau PITR) — restaurezi într-un
--     proiect NOU (nu peste producție!), apoi copiezi DOAR rândurile lipsă
--     din `progress` (și, dacă vrei titlurile, materialele vechi din
--     `content`) înapoi în producție.
--   • Plan Free: nu există backupuri automate — rândurile șterse nu se mai
--     pot recupera; rămân doar datele AI (stăpânirea subiectelor,
--     conversațiile), care au supraviețuit pentru elevii respectivi.
-- =====================================================================
