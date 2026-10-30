// =====================================================================
// api/vizita.js — înregistrează o vizită (o rută văzută în aplicație) pentru
// „📊 Statistici de utilizare" din Admin → 🤖 AI Tutor.
//
// POST /api/vizita { path, contentId?, visitor?, device?, referrer? }
//   · merge și fără cont (vizitator); cu sesiune (Authorization: Bearer …)
//     utilizatorul vine din token, iar id-ul anonim nu se mai păstrează;
//   · tot ce vine din browser se curăță în api/_lib/vizite.js (rută, UUID,
//     dispozitiv, domeniul sursei); rutele de admin nu se numără;
//   · plafon per IP (90 / minut / instanță) — o pagină în buclă nu umple tabela;
//   · răspunde MEREU 204: statisticile nu au voie să strice nimic în pagină.
// Tabela: supabase/statistici_vizite.sql (page_views, scrisă doar de server).
// =====================================================================
const { handledMethod, admin, authUser } = require('./_lib/http');
const vizite = require('./_lib/vizite');

const permis = vizite.limitator({ max: 90, windowMs: 60000 });
const SITE_HOST = (() => {
  try { return new URL(process.env.SITE_ORIGIN || 'https://examenmate.com').hostname.replace(/^www\./, ''); }
  catch { return 'examenmate.com'; }
})();

module.exports = async function handler(req, res) {
  if (handledMethod(req, res)) return;
  try {
    const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || '').split(',')[0].trim() || 'local';
    if (!permis(ip)) return res.status(204).end();
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const v = vizite.curataVizita(body, { siteHost: SITE_HOST });
    if (!v) return res.status(204).end();

    const supa = admin();
    let userId = null;
    if (req.headers.authorization || req.headers.Authorization) {
      try { userId = await authUser(req, supa); } catch { userId = null; } // sesiune expirată → ca vizitator
    }
    const { error } = await supa.from('page_views')
      .insert({ ...v, user_id: userId, ...(userId ? { visitor: null } : {}) });
    // migrarea nerulată → tăcere (panoul din Admin spune ce e de făcut)
    if (error && !/does not exist|schema cache/i.test(error.message || '')) console.warn('vizita:', error.message);
  } catch (e) {
    console.warn('vizita:', e?.message || e);
  }
  return res.status(204).end();
};
