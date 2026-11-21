// =====================================================================
// api/continut-generat.js — Admin → „🤖 Conținut generat" (21 nov. 2026)
//
// Ce a produs skill-ul „examenmate-continut" (task-urile programate → repo-ul privat
// examenmate-continut → GitHub Action-ul „Publică" → api/_lib/continutGenerat.js):
// ciornele de aprobat, ce s-a publicat direct (verificat după barem) cu „Anulează",
// problemele (eșuate, conflicte) și testele verificate fără schimbări. Doar administratorii.
//
// POST /api/continut-generat
//   { action: 'lista', grup?: 'ciorne'|'publicate'|'probleme'|'inchise'|'verificate'|'toate', procedura? }
//        → { setup, unitati, numarare, proceduri }
//   { action: 'linkuri', id }   → { fisiere: { rol: url semnat (10 min) }, vechi, site: [{ rol, title, url }] }
//   { action: 'aproba', id }    → { unitate }      (ciorna → publicată, cu aceleași reguli)
//   { action: 'respinge', id, motiv? } → { unitate }   (ciorna → respinsă; fișierele se șterg)
//   { action: 'anuleaza', id }  → { unitate }      (publicată → retrasă de pe site)
// Tabela: supabase/continut_generat.sql.
// =====================================================================
const ai = require('./_lib/ai');
const CG = require('./_lib/continutGenerat');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    await ai.requireAdmin(supa, userId);
    const body = req.body || {};
    const action = String(body.action || 'lista');

    if (action === 'lista') {
      const grup = String(body.grup || 'ciorne');
      const r = await CG.lista(supa, { grup, procedura: body.procedura || null });
      return res.status(200).json({ ...r, proceduri: CG.PROCEDURI });
    }
    if (action === 'linkuri') return res.status(200).json(await CG.linkuri(supa, body.id));
    if (action === 'aproba') return res.status(200).json({ unitate: await CG.aproba(supa, body.id, userId) });
    if (action === 'respinge') return res.status(200).json({ unitate: await CG.respinge(supa, body.id, userId, body.motiv) });
    if (action === 'anuleaza') return res.status(200).json({ unitate: await CG.anuleaza(supa, body.id, userId) });

    return res.status(400).json({ error: 'Acțiune necunoscută.' });
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('continut-generat error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
