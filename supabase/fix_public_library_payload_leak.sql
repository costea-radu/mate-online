-- =====================================================================
-- FIX SECURITATE — răspunsurile/soluțiile testelor premium din bibliotecă
-- Rulează în: Supabase → SQL Editor → New Query
-- =====================================================================
-- PROBLEMA: politica RLS `pub_read_all` pe ai_public_library e `USING (true)`,
-- iar coloana `payload` conține, pentru exerciții, chiar cheia:
--     practice: { statement, options, answer, answer_type, solution }
-- Endpoint-ul ai-public.js filtrează corect payload-ul (is_free / premium /
-- creator), DAR tabelul e citit și direct cu cheia anon (Navbar, căutare), deci
-- un client putea ocoli endpoint-ul:
--     supabase.from('ai_public_library').select('payload').eq('is_free', false)
-- și primi răspunsurile + soluțiile pentru toate testele premium.
--
-- SOLUȚIA (privilegiu la nivel de COLOANĂ): retragem SELECT pe TABEL de la
-- anon/authenticated și acordăm SELECT DOAR pe coloanele ne-sensibile. Astfel
-- căutarea din Navbar (care cere doar id, kind, title, category, creator_*)
-- merge NESCHIMBATĂ, dar `payload` devine necitibil direct — accesibil doar prin
-- endpoint-ul server (service_role, care NU e afectat de revoke).
-- RLS `pub_read_all` rămâne cum e (vizibilitatea pe rânduri nu se schimbă).
-- =====================================================================

REVOKE SELECT ON public.ai_public_library FROM anon, authenticated;

GRANT SELECT (
  id, created_by, creator_name, creator_role, kind, title,
  category, topic, search_text, created_at, is_free, free_set_by_admin
) ON public.ai_public_library TO anon, authenticated;

-- NOTĂ:
--   • `payload` NU e în listă → citirea lui directă de client dă „permission denied".
--   • service_role păstrează SELECT complet (endpoint-urile ai-public.js: list/get/
--     record/create funcționează neschimbat).
--   • Dacă adaugi în viitor o coloană ne-sensibilă nouă și vrei să fie citibilă de
--     client, adaug-o în GRANT-ul de mai sus (altfel `select('*')` va eșua — de aceea
--     Navbar selectează coloane EXPLICITE, nu `*`).
