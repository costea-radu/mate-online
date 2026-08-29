// =====================================================================
// api/duel.js — duelurile 1-la-1 din Arena (pasul 3)
//
// POST /api/duel  { action }
//   list          → duelurile mele (primite, trimise, active, încheiate)
//   optiuni       → colegii pe care îi pot provoca + exercițiile disponibile
//   create        → { opponentId, contentId }
//   respond       → { id, accept: true|false }
//   set_open      → { open: true|false }  („nu accept provocări acum")
//   start         → { id } — pornește cronometrul (la deschiderea exercițiului)
//
// GET /api/duel?action=cron   (doar cron, cu CRON_SECRET) → închide duelurile
//   depășite: cine a jucat câștigă prin neprezentare, restul expiră.
//
// Rezultatele NU se scriu de aici: scorul intră doar prin api/ai-score.js,
// după ce serverul l-a recalculat din cheile materialului.
// =====================================================================
const ai = require('./_lib/ai');
const duel = require('./_lib/duel');

// Colegii acceptați + exercițiile interactive la care am acces.
async function optiuni(supa, userId, profile) {
  const { data: links } = await supa.from('buddies')
    .select('requester_id, addressee_id')
    .eq('status', 'accepted')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);
  const ids = (links || []).map((l) => (l.requester_id === userId ? l.addressee_id : l.requester_id));

  let colegi = [];
  if (ids.length) {
    const { data: profs } = await supa.from('profiles')
      .select('id, full_name, role').in('id', ids);
    // duelul are sens între elevi; profesorii/părinții rămân în listă doar dacă
    // sunt singurii colegi (un profesor poate vrea să se măsoare cu un elev)
    colegi = (profs || []).map((p) => ({
      id: p.id,
      nume: String(p.full_name || 'Coleg').trim() || 'Coleg',
      rol: p.role || null,
    })).sort((a, b) => a.nume.localeCompare(b.nume, 'ro'));
  }

  const premium = ai.isPremium(profile) || profile.is_admin;
  let q = supa.from('content')
    .select('id, title, category, is_free')
    .eq('content_type', 'interactive')
    .order('sort_order', { ascending: true })
    .limit(120);
  if (!premium) q = q.eq('is_free', true);
  const { data: mat } = await q;

  return {
    ok: true,
    colegi,
    exercitii: (mat || []).map((c) => ({ id: c.id, titlu: c.title, categorie: c.category, gratuit: !!c.is_free })),
    premium,
    ore: duel.ORE_DUEL,
    maxPeZi: duel.MAX_PROVOCARI_PE_ZI,
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
      return res.status(200).json(await duel.expire(supa));
    }

    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const userId = await ai.authUser(req, supa);
    const profile = await ai.requireUser(supa, userId);

    if (action === 'list') return res.status(200).json({ ok: true, ...await duel.list(supa, userId) });
    if (action === 'optiuni') return res.status(200).json(await optiuni(supa, userId, profile));

    if (action === 'create') {
      const r = await duel.create(supa, userId, req.body || {}, { isPremium: ai.isPremium(profile) || profile.is_admin });
      if (r.error) return res.status(400).json(r);
      return res.status(200).json(r);
    }

    if (action === 'respond') {
      const r = await duel.respond(supa, userId, { id: req.body?.id, accept: !!req.body?.accept });
      if (r.error) return res.status(400).json(r);
      return res.status(200).json(r);
    }

    if (action === 'set_open') return res.status(200).json(await duel.setOpen(supa, userId, !!req.body?.open));

    // cronometrul pornește la deschiderea exercițiului (timpul se măsoară pe server)
    if (action === 'start') {
      const r = await duel.start(supa, userId, req.body?.id);
      if (r.error) return res.status(400).json(r);
      return res.status(200).json(r);
    }

    return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });
  } catch (err) {
    console.error('duel error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
