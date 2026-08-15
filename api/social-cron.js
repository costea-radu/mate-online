// =====================================================================
// api/social-cron.js — cron-urile de SOCIAL MEDIA (Faza 3b din
// GHID_AGENT_SEO_ACTIUNI.md). Protejate ca celelalte cron-uri:
// header `x-vercel-cron` (pus automat de Vercel) sau ?secret=AI_CRON_SECRET.
//
// GET /api/social-cron?action=publish
//   la 15 minute (*/15 * * * *): publică pe Facebook/Instagram postările
//   `approved` scadente (scheduled_at ≤ acum sau null). Succes → `posted`
//   (+ external_id); eșec → `failed` (+ error) — adminul poate da Reîncearcă
//   din panoul „Calendar social". TikTok/YouTube nu trec pe aici: ele intră
//   direct cu status `manual` la aprobarea propunerii.
//
// GET /api/social-cron?action=metrics
//   zilnic: citește insights (reach/like/comentarii + permalink) pentru
//   postările publicate în ultimele 14 zile → social_posts.metrics. Agentul
//   le vede prin unealta list_social_posts și învață ce funcționează.
// =====================================================================
const ai = require('./_lib/ai');
const social = require('./_lib/social');

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const cronOk = ai.isCronRequest(req); // x-vercel-cron(-schedule) / vercel-cron UA / Bearer CRON_SECRET / ?secret=
  if (!cronOk) return res.status(403).json({ error: 'Neautorizat' });

  const supa = ai.admin();
  const action = req.query.action || 'publish';

  try {
    if (action === 'publish') {
      if (!social.enabled()) return res.status(200).json({ ok: true, skipped: 'Meta neconfigurat (META_PAGE_ID + META_PAGE_TOKEN) — nimic de publicat.' });
      const nowIso = new Date().toISOString();
      const { data: due, error } = await supa
        .from('social_posts')
        .select('*')
        .eq('status', 'approved')
        .in('platform', social.AUTO_PLATFORMS)
        .or(`scheduled_at.is.null,scheduled_at.lte.${nowIso}`)
        .order('scheduled_at', { ascending: true, nullsFirst: true })
        .limit(10);
      if (error) {
        return res.status(200).json({ ok: false, warning: `Tabelul social_posts lipsește — rulează supabase/social_posts.sql (${error.message})` });
      }

      const published = [], failed = [];
      for (const row of due || []) {
        // Revendicăm rândul ATOMIC înainte de publicare. Dacă un tick anterior
        // omorât la maxDuration (sau altă rulare) l-a luat deja, .eq('status',
        // 'approved') nu mai potrivește → sărim, ca să NU publicăm de două ori
        // (Reels/postări duplicate). Compromis asumat: dacă funcția e omorâtă
        // FIX în timpul publicării, rândul rămâne „publishing" (readministrabil),
        // ceea ce e preferabil unui duplicat public.
        const { data: claimed } = await supa.from('social_posts')
          .update({ status: 'publishing' }).eq('id', row.id).eq('status', 'approved').select('id');
        if (!claimed || !claimed.length) continue;
        try {
          const r = await social.publishPost(row);
          await supa.from('social_posts')
            .update({ status: 'posted', external_id: r.external_id, posted_at: new Date().toISOString(), error: null })
            .eq('id', row.id);
          published.push({ id: row.id, platform: row.platform, external_id: r.external_id, kind: r.kind });
        } catch (e) {
          console.error(`social-cron: publicare eșuată (${row.platform}, ${row.id}):`, e.message);
          await supa.from('social_posts')
            .update({ status: 'failed', error: String(e.message || 'eroare necunoscută').slice(0, 500) })
            .eq('id', row.id);
          failed.push({ id: row.id, platform: row.platform, error: e.message });
        }
      }
      return res.status(200).json({ ok: true, due: (due || []).length, published, failed });
    }

    if (action === 'metrics') {
      if (!social.enabled()) return res.status(200).json({ ok: true, skipped: 'Meta neconfigurat.' });
      const since = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
      const { data: rows, error } = await supa
        .from('social_posts')
        .select('id, platform, external_id, posted_at')
        .eq('status', 'posted')
        .not('external_id', 'is', null)
        .gte('posted_at', since)
        .order('posted_at', { ascending: false })
        .limit(30);
      if (error) return res.status(200).json({ ok: false, warning: error.message });

      let updated = 0;
      for (const row of rows || []) {
        try {
          const metrics = await social.fetchInsights(row);
          await supa.from('social_posts')
            .update({ metrics, metrics_at: new Date().toISOString() })
            .eq('id', row.id);
          updated++;
        } catch (e) { console.warn(`social-cron: metrici eșuate (${row.id}):`, e.message); }
      }
      return res.status(200).json({ ok: true, posts: (rows || []).length, updated });
    }

    return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });
  } catch (err) {
    console.error('social-cron error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
