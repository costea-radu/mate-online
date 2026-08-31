// =====================================================================
// api/duel.js — duelurile 1-la-1 din Arena (pasul 3)
//
// POST /api/duel  { action }
//   list          → duelurile mele (primite, trimise, active, încheiate)
//   optiuni       → colegii pe care îi pot provoca + exercițiile disponibile
//                   (TOATE cele de pe site, fără bareme, pe două liste:
//                    interactive și pdf)
//   materiale     → { tip: 'interactive'|'pdf', q? } — doar o listă, reîncărcată
//   cauta         → { q } — caută pe ORICINE de pe site (min. 3 litere)
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
const materiale = require('./_lib/materiale');

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

  // Materialele: TOATE cele de pe site (nu primele 300, cum era înainte) și
  // FĂRĂ bareme — vezi api/_lib/materiale.js. Vin despărțite pe cele două
  // moduri din formular: „🧩 Interactive" și „📄 PDF".
  const premium = ai.isPremium(profile) || profile.is_admin;
  const { materiale: liste, total } = await materiale.liste(supa, { doarGratuite: !premium });

  return {
    ok: true,
    colegi,
    materiale: liste,
    total,
    // compatibilitate: lista plată folosită de versiunea veche a formularului
    exercitii: [...liste.interactive, ...liste.pdf],
    premium,
    ore: duel.ORE_DUEL,
    maxPeZi: duel.MAX_PROVOCARI_PE_ZI,
  };
}

// Căutarea unui adversar în tot site-ul (nu doar printre colegi). Respectă
// „Poate fi găsit în căutare" din Colegii mei, ca în api/colegi.js.
async function cauta(supa, userId, q) {
  const termen = String(q || '').trim();
  if (termen.length < 3) return { ok: true, items: [], hint: 'Scrie cel puțin 3 litere din nume.' };
  const like = `%${termen.replace(/[%_,()]/g, ' ')}%`;
  const { data } = await supa.from('profiles')
    .select('id, full_name, role, colegi_discoverable')
    .neq('id', userId)
    .ilike('full_name', like)
    .limit(60);
  const items = (data || [])
    .filter((p) => p.colegi_discoverable !== false)
    .slice(0, 20)
    .map((p) => ({ id: p.id, nume: String(p.full_name || 'Utilizator').trim(), rol: p.role || null }));
  return { ok: true, items };
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
    if (action === 'cauta') return res.status(200).json(await cauta(supa, userId, req.body?.q));

    // lista de materiale pe un singur mod (interactive / pdf), fără bareme
    if (action === 'materiale') {
      const premium = ai.isPremium(profile) || profile.is_admin;
      return res.status(200).json(await materiale.lista(supa, {
        tip: req.body?.tip, q: req.body?.q, doarGratuite: !premium,
      }));
    }

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
