// =====================================================================
// api/turneu.js — turneele de grupă (pasul 4)
//
// POST /api/turneu { action }
//   list     → turneele grupelor mele (cu clasament)
//   optiuni  → PROFESOR: grupele mele + TOATE materialele (fără bareme),
//              despărțite pe „interactive" și „pdf"
//   materiale→ PROFESOR: { q, tip } — reîncarcă o singură listă
//   create   → PROFESOR: { groupId, title, message, contentIds[], zile }
//   update   → ORGANIZATOR/ADMIN: { id, title?, message?, zile?, contentIds[]? }
//              — schimbă datele turneului și adaugă/scoate exerciții
//   delete   → ADMIN: { id } — șterge turneul cu tot cu clasament
//   close    → PROFESOR: { id } — încheie turneul mai devreme
//   join     → ELEV: { id } — înscriere la un turneu PUBLIC
//
// GET /api/turneu?action=cron  (doar cron) → închide turneele expirate, dă
//   premiile pentru locurile 1-3 și se asigură că există un „Turneu al
//   săptămânii" public, deschis oricui.
// =====================================================================
const ai = require('./_lib/ai');
const turneu = require('./_lib/turneu');
const materiale = require('./_lib/materiale');

// MATERIALELE pentru un turneu: TOATE cele de pe site, fără bareme (vezi
// api/_lib/materiale.js). Înainte veneau doar primele 80 dintr-o căutare pe
// server; acum lista completă ajunge o dată în pagină, iar filtrarea din
// formular e instantanee. `tip` alege lista: 'interactive' sau 'pdf'.
async function materialeLista(supa, { q, tip }) {
  return materiale.lista(supa, { tip, q });
}

async function optiuni(supa, userId, profile) {
  const { data: grupe } = await supa.from('mentor_groups')
    .select('id, name').eq('teacher_id', userId).order('created_at', { ascending: false });

  const { materiale: liste, total } = await materiale.liste(supa, {});

  return {
    ok: true,
    admin: !!profile.is_admin,
    grupe: grupe || [],
    materiale: liste,
    total,
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
      return res.status(200).json(await materialeLista(supa, { q: req.body?.q, tip: req.body?.tip }));
    }

    if (action === 'create') {
      if (!profesor) return res.status(403).json({ error: 'Doar conturile de profesor pot crea turnee.' });
      const r = await turneu.create(supa, userId, profile, req.body || {});
      if (r.error) return res.status(400).json(r);
      return res.status(200).json(r);
    }

    // editarea unui turneu: organizatorul lui sau adminul (inclusiv turneele
    // publice — de acolo se adaugă / se scot exerciții)
    if (action === 'update') {
      const r = await turneu.update(supa, userId, profile, req.body || {});
      if (r.error) return res.status(r.error.includes('Doar') ? 403 : 400).json(r);
      return res.status(200).json(r);
    }

    if (action === 'delete') {
      const r = await turneu.remove(supa, userId, profile, req.body?.id);
      if (r.error) return res.status(r.error.includes('Doar') ? 403 : 400).json(r);
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
