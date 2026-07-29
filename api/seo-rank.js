// =====================================================================
// api/seo-rank.js — RANK-TRACKING pentru admin (Faza 4b din
// GHID_AGENT_SEO_ACTIUNI.md): evoluția pozițiilor/clicurilor pe
// interogările-țintă din istoricul zilnic `gsc_snapshots`, cu momentele
// acțiunilor executate (seo_actions.executed_at) marcate pe grafice și
// efectul măsurat al fiecărei optimizări (14 zile înainte vs. după).
//
// POST { action?, days?, dim?, keys? }   (admin-only)
//   action='data' (implicit) → {
//     start, end, days, dim,
//     daily:   [{day, clicks, impressions}]           — totaluri zilnice
//     top:     [{key, clicks, impressions, position, prevClicks, prevPosition}]
//     series:  { key: [{day, position, clicks, impressions}] }  — pentru grafic
//     markers: [{day, type, label, route, status}]    — acțiunile executate
//     effects: [{label, day, effect:{before,after}|{pending}}]
//     totals / prevTotals, snapshotDays
//   }
//   days: 14 | 28 | 90 (implicit 28) · dim: 'query' | 'page' (implicit query)
//   keys: [max 10] — seriile de desenat; lipsă = top 8 după clicuri
//
// Datele vin EXCLUSIV din Supabase (populat de seo-cron?action=snapshot) —
// endpointul nu lovește API-ul Google, deci e rapid și fără cotă.
// =====================================================================
const ai = require('./_lib/ai');
const seo = require('./_lib/seo');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    await ai.requireAdmin(supa, userId);

    const { action = 'data', days = 28, dim = 'query', keys = null } = req.body || {};
    if (action !== 'data') return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });

    const cleanKeys = Array.isArray(keys)
      ? keys.map((k) => String(k).slice(0, 300)).filter(Boolean).slice(0, 10)
      : null;

    try {
      const data = await seo.rankData(supa, { days, dim, keys: cleanKeys });
      if (!data.snapshotDays) {
        data.warning = 'Niciun snapshot GSC în fereastra aleasă. Cronul zilnic (seo-cron?action=snapshot) trebuie să fi rulat — pentru istoric imediat, fă backfill: /api/seo-cron?action=snapshot&days=28&secret=AI_CRON_SECRET.';
      }
      return res.status(200).json(data);
    } catch (e) {
      // tabelul lipsește → mesaj clar, nu 500 criptic
      return res.status(200).json({
        daily: [], top: [], series: {}, markers: [], effects: [],
        warning: `Nu am putut citi gsc_snapshots — rulează supabase/seo_agent.sql în Supabase. (${e.message})`,
      });
    }
  } catch (err) {
    console.error('seo-rank error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
