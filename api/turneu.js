// =====================================================================
// api/turneu.js — turneele de grupă (pasul 4)
//
// POST /api/turneu { action }
//   list     → turneele grupelor mele (cu clasament)
//   optiuni  → PROFESOR: grupele mele + primele materiale din fiecare tip
//   materiale→ PROFESOR: { q, tip } — caută pe SERVER în tot site-ul
//   create   → PROFESOR: { groupId, title, message, contentIds[], zile }
//   close    → PROFESOR: { id } — încheie turneul mai devreme
//   join     → ELEV: { id } — înscriere la un turneu PUBLIC
//
// GET /api/turneu?action=cron  (doar cron) → închide turneele expirate, dă
//   premiile pentru locurile 1-3 și se asigură că există un „Turneu al
//   săptămânii" public, deschis oricui.
// =====================================================================
const ai = require('./_lib/ai');
const turneu = require('./_lib/turneu');

// Câte materiale întoarce o căutare (lista din formular se derulează).
const LIMITA_CAUTARE = 80;

// Tiparele de căutare: unul EXACT și unul „fără diacritice", în care literele
// cu variante românești (a/ă/â, i/î, s/ș, t/ț) devin „_" (orice caracter). Așa
// „fractii" îl găsește pe „Fracții", iar „Fracţii" (cu sedilă) tot pe el.
function tipare(termen) {
  const curat = String(termen || '').replace(/[%_,()"\\]/g, ' ').trim().replace(/\s+/g, ' ');
  if (!curat) return { exact: null, larg: null };
  const larg = curat.replace(/[aăâîisștțAĂÂÎISȘTȚ]/g, '_');
  return { exact: `%${curat}%`, larg: larg === curat ? null : `%${larg}%` };
}

// O trecere de căutare: în titlu SAU în categorie („clasa-7", „bacalaureat"…).
async function cauta(supa, fel, tipar) {
  const { data, error } = await supa.from('content')
    .select('id, title, category, is_free, content_type')
    .eq('content_type', fel)
    .or(`title.ilike."${tipar}",category.ilike."${tipar}"`)
    .order('sort_order', { ascending: true })
    .limit(LIMITA_CAUTARE);
  return { rows: data || [], error };
}

// MATERIALELE pentru un turneu, căutate PE SERVER — nu doar în primele 300
// încărcate în pagină, cum era înainte (de aici venea „nu găsesc toate
// testele"). `tip` alege modul de căutare: 'interactive' sau 'pdf'.
async function materiale(supa, { q, tip }) {
  const fel = tip === 'pdf' ? 'pdf' : 'interactive';
  const { exact, larg } = tipare(q);

  let rows = [];
  let error = null;
  if (!exact) {
    // fără căutare: începutul listei, în ordinea din site
    const r = await supa.from('content')
      .select('id, title, category, is_free, content_type')
      .eq('content_type', fel)
      .order('sort_order', { ascending: true })
      .limit(LIMITA_CAUTARE);
    rows = r.data || []; error = r.error;
  } else {
    const r = await cauta(supa, fel, exact);
    rows = r.rows; error = r.error;
    // Potrivirile EXACTE stau primele. Abia dacă sunt puține încercăm și
    // varianta largă (scrisă fără diacritice) — altfel un cuvânt scurt ca
    // „test" ar aduce jumătate din site înaintea rezultatelor bune.
    if (!error && larg && rows.length < 10) {
      const r2 = await cauta(supa, fel, larg);
      const vazute = new Set(rows.map((x) => x.id));
      rows = rows.concat((r2.rows || []).filter((x) => !vazute.has(x.id))).slice(0, LIMITA_CAUTARE);
    }
  }
  if (error) return { ok: false, tip: fel, items: [], total: 0, error: error.message };

  // câte materiale de tipul ăsta există pe tot site-ul (pentru „x din y")
  let total = 0;
  try {
    const { count } = await supa.from('content')
      .select('id', { count: 'exact', head: true }).eq('content_type', fel);
    total = count || 0;
  } catch { /* numărătoarea e doar informativă */ }

  return {
    ok: true, tip: fel, q: String(q || ''), total, limita: LIMITA_CAUTARE,
    items: rows.map((c) => ({
      id: c.id, titlu: c.title, categorie: c.category, gratuit: !!c.is_free, tip: c.content_type,
    })),
  };
}

async function optiuni(supa, userId, profile) {
  const { data: grupe } = await supa.from('mentor_groups')
    .select('id, name').eq('teacher_id', userId).order('created_at', { ascending: false });

  // Lista completă NU mai vine de aici: formularul o cere cu `action: 'materiale'`,
  // pe tipuri și cu căutare pe server.
  const [inter, pdf] = await Promise.all([
    materiale(supa, { q: '', tip: 'interactive' }),
    materiale(supa, { q: '', tip: 'pdf' }),
  ]);

  return {
    ok: true,
    admin: !!profile.is_admin,
    grupe: grupe || [],
    materiale: { interactive: inter.items, pdf: pdf.items },
    total: { interactive: inter.total, pdf: pdf.total },
    limitaCautare: LIMITA_CAUTARE,
    maxExercitii: turneu.MAX_EXERCITII,
    maxZile: turneu.MAX_ZILE,
    premii: turneu.PREMII,
  };
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  const action = String((req.query && req.query.action) || (req.body && req.body.action) || 'list');
  const supa = ai.admin();

  try {
    if (action === 'cron') {
      if (!ai.isCronRequest(req)) return res.status(403).json({ error: 'Neautorizat' });
      const inchise = await turneu.finalizeExpired(supa);
      const saptamanal = await turneu.ensureWeeklyPublic(supa);
      return res.status(200).json({ ...inchise, saptamanal });
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const userId = await ai.authUser(req, supa);
    const profile = await ai.requireUser(supa, userId);
    const profesor = profile.role === 'profesor' || profile.is_admin;

    if (action === 'list') {
      return res.status(200).json({
        ok: true, profesor, admin: !!profile.is_admin,
        ...await turneu.list(supa, userId, { isTeacher: profesor }),
      });
    }

    if (action === 'optiuni') {
      if (!profesor) return res.status(403).json({ error: 'Doar conturile de profesor pot crea turnee.' });
      return res.status(200).json(await optiuni(supa, userId, profile));
    }

    // căutarea materialelor din formular (două moduri: interactive / PDF)
    if (action === 'materiale') {
      if (!profesor) return res.status(403).json({ error: 'Doar conturile de profesor pot crea turnee.' });
      return res.status(200).json(await materiale(supa, { q: req.body?.q, tip: req.body?.tip }));
    }

    if (action === 'create') {
      if (!profesor) return res.status(403).json({ error: 'Doar conturile de profesor pot crea turnee.' });
      const r = await turneu.create(supa, userId, profile, req.body || {});
      if (r.error) return res.status(400).json(r);
      return res.status(200).json(r);
    }

    if (action === 'join') {
      const r = await turneu.join(supa, userId, req.body?.id);
      if (r.error) return res.status(400).json(r);
      return res.status(200).json(r);
    }

    if (action === 'close') {
      const r = await turneu.close(supa, userId, profile, req.body?.id);
      if (r.error) return res.status(400).json(r);
      return res.status(200).json(r);
    }

    return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });
  } catch (err) {
    console.error('turneu error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
