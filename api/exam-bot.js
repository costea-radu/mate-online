// =====================================================================
// api/exam-bot.js — 🤖 BOTUL DE EXAMENE (Admin → „📚 Bot examene" + cron)
//
// Caută permanent pe internet subiectele oficiale de matematică (EN, BAC
// Mate-Info / Științele Naturii / Tehnologic): variante date în sesiune,
// rezerve, sesiunea specială (olimpici), simulări, modele, teste de
// antrenament — și baremele lor; le publică pe site în rubrica potrivită și
// verifică dacă fiecare subiect de pe site are baremul lui (titlu, nume de
// fișier, antet, conținut). Fără AI; AI-ul e doar un buton opțional, la cerere.
//
// GET  /api/exam-bot?action=cron           (CRON_SECRET; vercel.json: la 2 ore)
// POST /api/exam-bot  (doar admin)
//   { action: 'status' }                                   → raportul + setările
//   { action: 'list', view, q?, category?, profile? }      → fara | cu | bareme | gasite | ignorate | ignorate_bot | altele | jurnal
//   { action: 'step', kind, runId?, phase?, force?, ids? }  → un pas: descoperire | verificare | bareme
//   { action: 'stop', runId }
//   { action: 'find_barem', contentId, useAi?, aiModel? }  → caută baremul unui subiect (bot / + AI)
//   { action: 'candidates', contentId }                    → baremele de pe site, verificate pe conținut
//   { action: 'associate', contentId, baremId|null }       → leagă manual (null = desface)
//   { action: 'ignore', contentId, on }                    → „nu are barem / nu mai căuta"
//   { action: 'item_publish', itemId, edits? }             → „De verificat" → publicat
//   { action: 'item_reject' | 'item_retry', itemId }
//   { action: 'settings', value }
// Logica: api/_lib/examBotRun.js · examBot.js · examBotNet.js. SQL: supabase/bot_examene.sql.
// =====================================================================
const http = require('./_lib/http');
const R = require('./_lib/examBotRun');

const STEP_MS = parseInt(process.env.EXAM_BOT_STEP_MS || '200000', 10);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const uuidOrNull = (v) => (v && UUID.test(String(v)) ? String(v) : null);

async function step(supa, userId, body) {
  const kind = ['descoperire', 'verificare', 'bareme'].includes(body.kind) ? body.kind : null;
  if (!kind) { const e = new Error('Pas necunoscut.'); e.status = 400; throw e; }
  const st = await R.loadSettings(supa);
  const run = await R.startRun(supa, { kind, by: 'admin', runId: uuidOrNull(body.runId) });
  const ctx = R.makeCtx(supa, st.value, { budgetMs: STEP_MS, by: 'admin' });
  let progress = null, done = false;
  try {
    if (kind === 'descoperire') {
      const phase = body.phase === 'proceseaza' ? 'proceseaza' : 'cauta';
      if (phase === 'cauta') await supa.from(R.T.runs).update({ note: 'cautare' }).eq('id', run.id);
      const { count } = await supa.from(R.T.runs).select('id', { head: true, count: 'exact' }).eq('kind', 'descoperire');
      progress = await R.discoverStep(ctx, { phase, backfillTurn: count || 0 });
      done = !!progress.done;
    } else if (kind === 'verificare') {
      progress = await R.verifyStep(ctx, { force: body.force === true, ids: Array.isArray(body.ids) ? body.ids.map(uuidOrNull).filter(Boolean) : null });
      done = progress.left === 0;
    } else {
      progress = await R.findMissingStep(ctx, { ids: Array.isArray(body.ids) ? body.ids.map(uuidOrNull).filter(Boolean) : null, force: body.force === true });
      done = progress.left === 0;
    }
    const saved = await R.saveRun(supa, run, ctx, { final: done });
    return { ok: true, runId: run.id, kind, done, progress, log: ctx.lines, stats: ctx.stats, total: saved.stats, blocked: [...ctx.net.blocked] };
  } catch (e) {
    ctx.log(`⚠ ${e.message}`);
    await R.saveRun(supa, run, ctx, { final: true, status: 'eroare' }).catch(() => {});
    throw e;
  }
}

module.exports = async function handler(req, res) {
  if (http.handledMethod(req, res, { allowGet: true })) return;
  const supa = http.admin();
  const action = String((req.query && req.query.action) || (req.body && req.body.action) || 'status');
  try {
    if (req.method === 'GET') {
      if (action !== 'cron' || !http.isCronRequest(req)) return res.status(403).json({ error: 'Neautorizat' });
      return res.status(200).json(await R.cron(supa));
    }
    const userId = await http.authUser(req, supa);
    await http.requireAdmin(supa, userId);
    const b = req.body || {};

    if (action === 'status') return res.status(200).json(await R.report(supa));
    if (action === 'list') return res.status(200).json(await R.listView(supa, String(b.view || 'fara'), { q: String(b.q || '').slice(0, 100), category: String(b.category || ''), profile: String(b.profile || '') }));
    if (action === 'step') return res.status(200).json(await step(supa, userId, b));
    if (action === 'stop') {
      const id = uuidOrNull(b.runId);
      if (id) await supa.from(R.T.runs).update({ status: 'oprit', finished_at: new Date().toISOString() }).eq('id', id).eq('status', 'ruleaza');
      return res.status(200).json({ ok: true });
    }
    if (action === 'settings') {
      const value = await R.saveSettings(supa, b.value || {}, userId);
      return res.status(200).json({ ok: true, settings: value });
    }

    const contentId = uuidOrNull(b.contentId);
    const itemId = uuidOrNull(b.itemId);
    const st = await R.loadSettings(supa);

    if (action === 'find_barem') {
      if (!contentId) return res.status(400).json({ error: 'contentId lipsă' });
      const run = await R.startRun(supa, { kind: 'bareme', by: 'admin' });
      const ctx = R.makeCtx(supa, st.value, { budgetMs: STEP_MS, by: 'admin' });
      try {
        const r = await R.findMissingStep(ctx, { ids: [contentId], force: true, useAi: b.useAi === true, aiModel: b.aiModel ? String(b.aiModel) : null });
        await R.saveRun(supa, run, ctx, { final: true });
        return res.status(200).json({ ok: true, result: r.results[0] || null, log: ctx.lines, stats: ctx.stats });
      } catch (e) { ctx.log(`⚠ ${e.message}`); await R.saveRun(supa, run, ctx, { final: true, status: 'eroare' }).catch(() => {}); throw e; }
    }
    if (action === 'candidates') {
      if (!contentId) return res.status(400).json({ error: 'contentId lipsă' });
      const ctx = R.makeCtx(supa, st.value, { budgetMs: 120000 });
      return res.status(200).json(await R.baremCandidates(ctx, contentId));
    }
    if (action === 'associate') {
      if (!contentId) return res.status(400).json({ error: 'contentId lipsă' });
      const ctx = R.makeCtx(supa, st.value, { budgetMs: 60000 });
      return res.status(200).json(await R.manualAssociate(ctx, contentId, uuidOrNull(b.baremId)));
    }
    if (action === 'ignore') {
      if (!contentId) return res.status(400).json({ error: 'contentId lipsă' });
      return res.status(200).json(await R.setIgnored(supa, contentId, b.on !== false));
    }
    if (action === 'item_publish') {
      if (!itemId) return res.status(400).json({ error: 'itemId lipsă' });
      const run = await R.startRun(supa, { kind: 'descoperire', by: 'admin' });
      const ctx = R.makeCtx(supa, st.value, { budgetMs: STEP_MS, by: 'admin' });
      try {
        const r = await R.itemPublish(ctx, itemId, b.edits && typeof b.edits === 'object' ? b.edits : {});
        await R.saveRun(supa, run, ctx, { final: true });
        return res.status(200).json({ ...r, log: ctx.lines });
      } catch (e) { ctx.log(`⚠ ${e.message}`); await R.saveRun(supa, run, ctx, { final: true, status: 'eroare' }).catch(() => {}); throw e; }
    }
    if (action === 'item_reject') { if (!itemId) return res.status(400).json({ error: 'itemId lipsă' }); return res.status(200).json(await R.itemSetStatus(supa, itemId, 'respins')); }
    if (action === 'item_retry') { if (!itemId) return res.status(400).json({ error: 'itemId lipsă' }); return res.status(200).json(await R.itemSetStatus(supa, itemId, 'nou')); }
    return res.status(400).json({ error: `Acțiune necunoscută: ${action}` });
  } catch (err) {
    if (!err.status || err.status >= 500) console.error('exam-bot error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};

module.exports._internals = { step };
