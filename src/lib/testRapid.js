// =====================================================================
// src/lib/testRapid.js — „▶ Începe un test": primul test interactiv GRATUIT al
// unei rubrici, pe care utilizatorul nu l-a rezolvat încă (11 nov. 2026).
//
// De ce: din Home și din paginile de examen, până la primul test erau 3–4
// atingeri (pagina examenului → secțiune → subsecțiune → card). Butonul
// „▶ Începe un test" duce direct în test (/exercitiu?id=…), fără cont.
// Fără AI: două interogări mici, ținute minte un minut.
// =====================================================================
import { supabase } from './supabase';
import { alegeTest } from './alegeTest';

const memorie = new Map();
const TTL = 60000;

// → { id, title } sau null (nimic gratuit în rubrică / baza de date nu răspunde)
export function testRapid({ category = 'evaluare-nationala', profile = null, userId = null } = {}) {
  const cheie = `${category}|${profile || ''}|${userId || ''}`;
  const m = memorie.get(cheie);
  if (m && Date.now() - m.la < TTL) return m.p;
  const p = (async () => {
    let q = supabase.from('content').select('id, title, subcategory')
      .eq('category', category).eq('content_type', 'interactive').eq('is_free', true)
      .order('sort_order', { ascending: true }).order('created_at', { ascending: false }).limit(40);
    if (profile) q = q.eq('profile', profile);
    const { data, error } = await q;
    if (error || !data || !data.length) return null;
    let rezolvate = new Set();
    if (userId) {
      try {
        const { data: pr } = await supabase.from('progress').select('content_id').eq('user_id', userId).in('content_id', data.map((r) => r.id));
        rezolvate = new Set((pr || []).map((r) => r.content_id));
      } catch { /* fără progres: primul din listă */ }
    }
    const t = alegeTest(data, rezolvate);
    return t ? { id: t.id, title: t.title } : null;
  })().catch(() => null);
  memorie.set(cheie, { p, la: Date.now() });
  return p;
}

export { alegeTest, linkTest } from './alegeTest';
