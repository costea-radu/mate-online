// =====================================================================
// api/seo-cron.js — cron-urile agentului SEO (Faza 1f din
// GHID_AGENT_SEO_ACTIUNI.md). Protejate ca celelalte cron-uri:
// header `x-vercel-cron` (pus automat de Vercel) sau ?secret=AI_CRON_SECRET.
//
// GET /api/seo-cron?action=snapshot[&days=N]
//   zilnic (0 5 * * *): salvează în `gsc_snapshots` ziua „finalizată"
//   (acum 3 zile — GSC are ~2 zile întârziere): top interogări + pagini.
//   La prima rulare poți face backfill manual: ?action=snapshot&days=28
//
// GET /api/seo-cron?action=autorun
//   săptămânal (luni 0 6 * * 1): rulează agentul pe sarcina `performance`
//   cu unelte → propunerile intră în coada de aprobare; trimite digest pe
//   email adminului cu ce așteaptă aprobare.
//
// GET /api/seo-cron?action=monthly      (Faza 4b din ghid)
//   lunar (ziua 1, 0 7 1 * *): raportul LUNII ANTERIOARE — datele măsurate
//   (trafic din gsc_snapshots, efectul acțiunilor executate, articolele,
//   postările sociale cu metrici, canalele/campaniile GA4) sunt calculate
//   în cod (seo.monthlyContext); agentul doar le interpretează și scrie
//   planul lunii următoare. Raportul pleacă pe emailul adminului.
// =====================================================================
const ai = require('./_lib/ai');
const seo = require('./_lib/seo');
const mailer = require('./_lib/mailer');

async function adminUserId(supa) {
  try {
    const { data } = await supa.from('profiles').select('id').eq('is_admin', true).limit(1).maybeSingle();
    return data?.id || null;
  } catch { return null; }
}

async function emailDigest(supa, agentText) {
  if (!mailer.enabled()) return false;
  const { data: pending } = await supa
    .from('seo_actions')
    .select('id, type, note, created_at')
    .eq('status', 'proposed')
    .order('created_at', { ascending: false })
    .limit(15);
  const items = pending || [];

  const labels = {
    set_page_meta: '🏷️ Meta pagină', rename_material: '✏️ Redenumire material',
    submit_sitemap: '🗺️ Retrimitere sitemap', publish_article: '📰 Articol', schedule_social: '📱 Postare social',
    update_article: '🔄 Actualizare articol', yt_update_video: '▶️ Metadate YouTube',
    create_video: '🎬 Videoclip nou',
  };
  const list = items.map((a) =>
    `<li style="margin:7px 0"><strong>${labels[a.type] || a.type}</strong><br><span style="color:#5a6379">${mailer.escapeHtml(a.note || '(fără notă)')}</span></li>`
  ).join('');

  const html = mailer.template({
    title: items.length
      ? `Agentul SEO: ${items.length === 1 ? 'o propunere așteaptă' : items.length + ' propuneri așteaptă'} aprobarea ta`
      : 'Agentul SEO a rulat — nicio propunere nouă',
    preheader: items[0]?.note || 'Raportul săptămânal al agentului SEO',
    bodyHtml: `
      ${items.length ? `<p>Acestea așteaptă în coada de aprobare:</p><ul style="padding-left:20px">${list}</ul>` : '<p>Nu există propuneri în așteptare.</p>'}
      <p style="margin-top:16px"><a href="${seo.SITE}/admin" style="display:inline-block;background:#17233f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Deschide coada de aprobare</a></p>
      <hr style="border:none;border-top:1px solid #eef1f6;margin:18px 0">
      <p style="color:#5a6379;font-size:13px;white-space:pre-wrap">${mailer.escapeHtml(String(agentText || '').slice(0, 2500))}</p>`,
    footerNote: 'Email automat de la agentul SEO (rulare săptămânală). Aprobi sau respingi din panoul de admin.',
  });

  const r = await mailer.sendMail({
    to: mailer.ADMIN_EMAIL,
    subject: items.length
      ? `Agent SEO: ${items.length} ${items.length === 1 ? 'propunere' : 'propuneri'} de aprobat`
      : 'Agent SEO: raport săptămânal (fără propuneri noi)',
    html,
  });
  return r.ok;
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method Not Allowed' });

  const cronOk = req.headers['x-vercel-cron'] || (process.env.AI_CRON_SECRET && req.query.secret === process.env.AI_CRON_SECRET);
  if (!cronOk) return res.status(403).json({ error: 'Neautorizat' });

  const supa = ai.admin();
  const action = req.query.action || 'snapshot';

  try {
    if (action === 'snapshot') {
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 1, 1), 30);
      const result = await seo.snapshotGsc(supa, days);
      return res.status(200).json({ ok: true, snapshot: result });
    }

    if (action === 'autorun') {
      const r = await seo.runAgent({
        supa,
        task: 'performance',
        input: 'Rulare automată săptămânală. Analizează trendurile din datele reale (folosește gsc_query pe ultimele 28 de zile vs. perioada anterioară unde e util), identifică cele mai bune 3–5 oportunități și trimite propuneri CONCRETE prin uneltele de scriere (set_page_meta / rename_material / submit_sitemap), fiecare cu nota ei. La final, raport scurt: ce ai găsit, ce ai propus, la ce să ne uităm săptămâna viitoare.',
        maxIters: 8,
      });
      const uid = await adminUserId(supa);
      if (uid) await ai.logUsage(supa, uid, 'seo-cron-autorun', { in: r.usage?.prompt_tokens || 0, out: r.usage?.completion_tokens || 0 });
      const emailed = await emailDigest(supa, r.text).catch((e) => { console.warn('seo-cron: email digest eșuat:', e.message); return false; });
      return res.status(200).json({ ok: true, proposals: r.proposals || 0, toolCalls: r.toolCalls || 0, emailed, report: String(r.text || '').slice(0, 4000) });
    }

    if (action === 'monthly') {
      // 1) datele măsurate ale lunii anterioare — calculate în cod, nu de model
      const ctx = await seo.monthlyContext(supa);
      // 2) agentul interpretează datele și scrie raportul (max 2–3 unelte)
      const r = await seo.runAgent({
        supa,
        task: 'report',
        input: `Scrie raportul lunar pentru ${ctx.label}.\n\n${ctx.text}`,
        maxIters: 4,
      });
      const uid = await adminUserId(supa);
      if (uid) await ai.logUsage(supa, uid, 'seo-cron-monthly', { in: r.usage?.prompt_tokens || 0, out: r.usage?.completion_tokens || 0 });

      // 3) emailul către admin, cu raportul întreg (markdown → HTML)
      let emailed = false;
      if (mailer.enabled()) {
        const html = mailer.template({
          title: `Raport SEO lunar — ${ctx.label}`,
          preheader: 'Trafic, poziții, efectul optimizărilor și planul lunii următoare.',
          bodyHtml: `
            ${mailer.mdToHtml(String(r.text || '(raport gol)'))}
            <p style="margin-top:16px"><a href="${seo.SITE}/admin" style="display:inline-block;background:#17233f;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600">Deschide panoul de admin (grafice rank-tracking)</a></p>`,
          footerNote: 'Email automat de la agentul SEO (raport lunar, ziua 1 a lunii). Cifrele vin din gsc_snapshots / seo_actions / GA4; graficele detaliate sunt în admin.',
        });
        const sent = await mailer.sendMail({ to: mailer.ADMIN_EMAIL, subject: `📊 Raport SEO lunar — ${ctx.label}`, html });
        emailed = !!sent.ok;
      }
      return res.status(200).json({ ok: true, month: ctx.label, emailed, toolCalls: r.toolCalls || 0, report: String(r.text || '').slice(0, 6000) });
    }

    return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });
  } catch (err) {
    console.error('seo-cron error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server' });
  }
};
