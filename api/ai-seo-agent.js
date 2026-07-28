// =====================================================================
// api/ai-seo-agent.js — AGENTUL CLAUDE de SEO & marketing (admin).
//
// FAZELE 1–2 (GHID_AGENT_SEO_ACTIUNI.md): agentul nu mai doar recomandă — are
// UNELTE reale (bucla de tool-use e în api/_lib/claude.js, uneltele și
// contextul în api/_lib/seo.js):
//   • citire (se execută pe loc): gsc_query, ga4_report, url_inspect,
//     psi_report, fetch_page, db_stats, list_materials, read_material,
//     get_seo_meta, list_articles, read_article;
//   • scriere (NUMAI prin coada de aprobare `seo_actions` din admin):
//     set_page_meta, rename_material, publish_article, update_article,
//     submit_sitemap.
//
// Agentul NU are acces la cod — singura cale de modificare e baza de date.
// Fără ANTHROPIC_API_KEY, cade elegant pe comportamentul vechi (doar analiză).
// Contul folosit în consolele Google: admin.examenmate@gmail.com.
//
// Body: { userId, task, input?, history? }
//   task: 'audit'|'meta'|'blog'|'social'|'keywords'|'performance'|'chat'
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

    const { task = 'chat', input = '', history = [] } = req.body || {};

    const r = await seo.runAgent({ supa, task, input, history });
    await ai.logUsage(supa, userId, 'ai-seo-agent', {
      in: r.usage?.prompt_tokens || 0,
      out: r.usage?.completion_tokens || 0,
    });

    return res.status(200).json({
      text: r.text,
      provider: r.provider,
      googleConnected: r.googleConnected,
      toolCalls: r.toolCalls || 0,
      proposals: r.proposals || 0,
    });
  } catch (err) {
    console.error('ai-seo-agent error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
