// =====================================================================
// api/social-queue.js — CALENDARUL SOCIAL din admin (Faza 3 din
// GHID_AGENT_SEO_ACTIUNI.md). Admin-only (ca api/seo-actions.js).
//
// POST { action }
//   action='list'                    → { posts[], meta: {facebook, instagram} }
//   action='publish_now',  id       → publică IMEDIAT o postare `approved`
//                                      (FB/IG) — util și ca test al config Meta
//   action='mark_posted',  id, url? → marchează o postare `manual` ca postată
//                                      (TikTok/YouTube, după copy-paste)
//   action='cancel',       id       → anulează (approved/manual/failed → canceled)
//   action='retry',        id       → failed → approved (o reia cronul)
//   action='refresh_metrics'        → recitește insights pentru ultimele postări
//
// Postările ajung aici DOAR prin coada de aprobare seo_actions (unealta
// schedule_social a agentului): aprobi propunerea → rând în social_posts.
// =====================================================================
const ai = require('./_lib/ai');
const social = require('./_lib/social');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    await ai.requireAdmin(supa, userId);

    const { action = 'list', id = null, url = null } = req.body || {};
    const meta = { facebook: social.enabled(), instagram: social.igEnabled() };

    if (action === 'list') {
      const { data, error } = await supa
        .from('social_posts')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(120);
      if (error) {
        return res.status(200).json({ posts: [], meta, warning: `Tabelul social_posts lipsește — rulează supabase/social_posts.sql în Supabase (${error.message})` });
      }
      return res.status(200).json({ posts: data || [], meta });
    }

    if (action === 'refresh_metrics') {
      if (!social.enabled()) return res.status(400).json({ error: 'Meta neconfigurat (META_PAGE_ID + META_PAGE_TOKEN).' });
      const since = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
      const { data: rows, error } = await supa
        .from('social_posts')
        .select('id, platform, external_id')
        .eq('status', 'posted')
        .not('external_id', 'is', null)
        .gte('posted_at', since)
        .limit(20);
      if (error) return res.status(500).json({ error: error.message });
      let updated = 0;
      for (const row of rows || []) {
        try {
          const m = await social.fetchInsights(row);
          await supa.from('social_posts').update({ metrics: m, metrics_at: new Date().toISOString() }).eq('id', row.id);
          updated++;
        } catch { /* best effort — restul continuă */ }
      }
      return res.status(200).json({ ok: true, updated });
    }

    if (!id) return res.status(400).json({ error: 'Lipsește id-ul postării.' });
    const { data: row, error: readErr } = await supa.from('social_posts').select('*').eq('id', id).maybeSingle();
    if (readErr) return res.status(500).json({ error: readErr.message });
    if (!row) return res.status(404).json({ error: 'Postarea nu există.' });

    if (action === 'publish_now') {
      if (row.status !== 'approved' && row.status !== 'failed') {
        return res.status(409).json({ error: `Postarea are statusul „${row.status}" — doar approved/failed se pot publica acum.` });
      }
      if (!social.AUTO_PLATFORMS.includes(row.platform)) {
        return res.status(400).json({ error: `${row.platform} nu se publică automat — folosește „Am postat-o" după ce o postezi manual.` });
      }
      try {
        const r = await social.publishPost(row);
        const { data: upd, error } = await supa.from('social_posts')
          .update({ status: 'posted', external_id: r.external_id, posted_at: new Date().toISOString(), error: null })
          .eq('id', id).select('*').single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ post: upd });
      } catch (e) {
        await supa.from('social_posts').update({ status: 'failed', error: String(e.message || '').slice(0, 500) }).eq('id', id);
        return res.status(502).json({ error: `Publicarea a eșuat: ${e.message}` });
      }
    }

    if (action === 'mark_posted') {
      if (row.status !== 'manual') return res.status(409).json({ error: `Doar postările din coada manuală se marchează așa (statusul e „${row.status}").` });
      const metrics = { ...(row.metrics || {}) };
      if (url && /^https?:\/\//.test(String(url))) metrics.permalink = String(url).slice(0, 500);
      const { data: upd, error } = await supa.from('social_posts')
        .update({ status: 'posted', posted_at: new Date().toISOString(), metrics })
        .eq('id', id).select('*').single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ post: upd });
    }

    if (action === 'cancel') {
      if (!['approved', 'manual', 'failed', 'draft'].includes(row.status)) {
        return res.status(409).json({ error: `Postarea are statusul „${row.status}" — doar cele nepublicate se anulează.` });
      }
      const { data: upd, error } = await supa.from('social_posts')
        .update({ status: 'canceled' }).eq('id', id).select('*').single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ post: upd });
    }

    if (action === 'retry') {
      if (row.status !== 'failed') return res.status(409).json({ error: 'Doar postările eșuate se reiau.' });
      const { data: upd, error } = await supa.from('social_posts')
        .update({ status: 'approved', error: null }).eq('id', id).select('*').single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ post: upd });
    }

    return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });
  } catch (err) {
    console.error('social-queue error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
