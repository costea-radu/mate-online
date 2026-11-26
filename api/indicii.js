// =====================================================================
// api/indicii.js — 💡 indiciile exercițiilor care n-au indicii în fișier (26 nov. 2026)
//
// POST { contentId } → { ok, stare: 'gata', h, nc, fp } | { ok, stare: 'generare' } |
//                      { ok, stare: 'nimic' }
// Pentru testele interactive din `content` (EN: Subiectele I–II grilă, Subiectul al
// III-lea pe pași): indiciile se scriu O DATĂ, cu AI, și se servesc apoi tuturor
// elevilor (api/_lib/indiciiTest.js). Fără cont: indiciile nu dau nimic din răspuns,
// iar o generare se face o singură dată pe test (costul e al platformei, nu al elevului).
// Le cere InteractiveViewer, la MATE_HINTS_REQ din punte (src/lib/tutorBridge.js).
// =====================================================================
const ai = require('./_lib/ai');
const IT = require('./_lib/indiciiTest');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  try {
    const supa = ai.admin();
    const body = req.body || {};
    return res.status(200).json(await IT.obtine(supa, body.contentId));
  } catch (e) {
    const status = e.status || 500;
    if (status >= 500) console.error('indicii:', e.message);
    return res.status(status).json({ error: e.message || 'Eroare la indicii.' });
  }
};
