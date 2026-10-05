// =====================================================================
// api/content-check.js — AGENTUL DE VERIFICARE a materialelor (Admin →
// „🔎 Verificare materiale"). Doar administratorii.
//
// POST { action, ... }
//   overview      — materialele site-ului (PDF + interactive) + ultima verificare a fiecăruia
//   check         — verifică UN material (verificări automate + Claude); opțional
//                   „a doua opinie" (secondOf = id-ul verificării anterioare)
//   get / history — o verificare / verificările unui material
//   dismiss       — „nu e o greșeală" (problema nu se mai raportează data viitoare)
//   prepare_fix   — aplică corecturile alese într-un fișier NOU (ciornă) și întoarce
//                   previzualizarea (diferențele / PDF-ul corectat); originalul rămâne
//   preview       — sursa HTML (ciorna sau fișierul de pe site) / linkul PDF-ului
//   publish_fix   — materialul de pe site trece pe fișierul corectat
//   discard_fix   — renunță la ciornă (fișierul ei se șterge)
//   undo_fix      — după publicare: revine la fișierul original
//
// Logica (verificările automate, corecturile, PDF-ul, promptul): api/_lib/verificare.js.
// Tabela: supabase/agenti_verificare_debug.sql (content_checks). Ghid: GHID_AGENTI_VERIFICARE_DEBUG.md.
// =====================================================================
const crypto = require('node:crypto');
const ai = require('./_lib/ai');
const claude = require('./_lib/claude');
const V = require('./_lib/verificare');
const { parseStoragePath, allRows } = require('./_lib/http');

const SETUP_HINT = 'Agentul de verificare nu e încă activat: rulează supabase/agenti_verificare_debug.sql în Supabase → SQL Editor.';
const isMissingTable = (err) => !!err && /relation .* does not exist|does not exist|schema cache/i.test(String(err.message || err));
function fail(status, message, code = null) { const e = new Error(message); e.status = status; if (code) e.code = code; return e; }
function dbCheck(error, what = '') {
  if (!error) return;
  if (isMissingTable(error)) throw fail(503, SETUP_HINT, 'CHECK_SETUP');
  throw fail(500, `${what ? what + ': ' : ''}${error.message}`);
}
const MAX_FILE = 30 * 1024 * 1024;                    // PDF-uri mai mari: nu (limita API-ului e 32 MB pe cerere)
const PDF_PART_PAGES = 60;                            // peste ~90 de pagini, PDF-ul se verifică pe bucăți
const kindOf = (row) => {
  const url = String(row?.file_url || '').split('?')[0].toLowerCase();
  if (/\.pdf$/.test(url) || (row?.content_type === 'pdf' && !/\.html?$/.test(url))) return 'pdf';
  if (/\.html?$/.test(url) || row?.content_type === 'interactive') return 'html';
  return null;
};
const BAREM_OK = new Set(['ok', 'ok_antet', 'ok_continut', 'inclus', 'ok_admin']);
const lei = (usd) => Math.round(usd * (ai.USD_RON || 4.6) * 1e6);   // micro-lei
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

async function adminUser(req, supa) {
  const userId = await ai.authUser(req, supa);
  await ai.requireAdmin(supa, userId);
  return userId;
}

async function download(supa, fileUrl) {
  const { bucket, filePath } = parseStoragePath(fileUrl);
  const { data, error } = await supa.storage.from(bucket).download(filePath);
  if (error || !data) throw fail(502, `Nu am putut descărca fișierul din Storage (${error?.message || 'gol'}).`);
  const buf = Buffer.from(await data.arrayBuffer());
  if (buf.length > MAX_FILE) throw fail(413, 'Fișierul e prea mare pentru verificare (peste 30 MB).');
  return { buf, bucket, filePath };
}

async function loadContent(supa, id) {
  if (!id) throw fail(400, 'Lipsește materialul.');
  const { data, error } = await supa.from('content').select('id, title, description, category, subcategory, profile, content_type, file_url, is_free, created_at').eq('id', id).maybeSingle();
  dbCheck(error, 'materialul');
  if (!data) throw fail(404, 'Materialul nu (mai) există.');
  return data;
}

async function loadCheck(supa, id) {
  if (!id) throw fail(400, 'Lipsește verificarea.');
  const { data, error } = await supa.from('content_checks').select('*').eq('id', id).maybeSingle();
  dbCheck(error, 'verificarea');
  if (!data) throw fail(404, 'Verificarea nu există.');
  return data;
}

// rezumatul unei verificări, pentru listă
function light(c) {
  const issues = Array.isArray(c.issues) ? c.issues : [];
  const open = issues.filter((i) => !i.dismissed && !i.fixed);
  const count = (sev) => open.filter((i) => i.severity === sev).length;
  return {
    id: c.id, content_id: c.content_id, created_at: c.created_at, model: c.model, kind: c.kind,
    status: c.status, verdict: c.verdict, summary: c.summary,
    critica: count('critica'), majora: count('majora'), minora: count('minora'), info: count('info'),
    fixable: open.filter((i) => i.fix_kind === 'patch' && i.fixable !== false).length,
    cost_lei: Math.round((c.cost_micro || 0) / 1e4) / 100,
    fix: c.fix || null, draft: c.draft ? { created_at: c.draft.created_at, issueIds: c.draft.issueIds } : null,
    stale: false,
  };
}

// ─── overview ────────────────────────────────────────────────────────────────
async function overview(req, res, supa) {
  await adminUser(req, supa);
  const items = await allRows((from, to) => supa.from('content')
    .select('id, title, description, category, subcategory, profile, content_type, file_url, is_free, created_at')
    .order('created_at', { ascending: false }).range(from, to));
  let checks = [];
  let setup = true;
  try {
    checks = await allRows((from, to) => supa.from('content_checks')
      .select('id, content_id, file_url, created_at, model, kind, status, verdict, summary, issues, cost_micro, fix, draft')
      .order('created_at', { ascending: false }).range(from, to), { maxPages: 10 });
  } catch (e) {
    if (isMissingTable(e)) setup = false; else throw e;
  }
  const latest = {};
  const totals = { lei: 0, checks: checks.length };
  for (const c of checks) {
    totals.lei += (c.cost_micro || 0) / 1e6;
    if (!latest[c.content_id]) latest[c.content_id] = { ...light(c), stale: false, file_url: c.file_url };
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const [cid, l] of Object.entries(latest)) {
    const row = byId.get(cid);
    // fișierul s-a schimbat după verificare (re-încărcat de admin) → verificarea e veche
    l.stale = !!row && row.file_url !== l.file_url && !(l.fix?.new_url && row.file_url === l.fix.new_url);
    delete l.file_url;
  }
  return res.status(200).json({
    items: items.filter((i) => kindOf(i)).map((i) => ({ ...i, kind: kindOf(i) })),
    latest, setup, hasKey: claude.HAS_KEY, totals: { checks: totals.checks, lei: Math.round(totals.lei * 100) / 100 },
    models: claude.MODELS.map((m) => ({ id: m.id, label: m.label, note: m.note, price: ai.priceFor(m.id) })),
    usdRon: ai.USD_RON || 4.6,
  });
}

// ─── check ───────────────────────────────────────────────────────────────────
function staticHints(checks) {
  const out = [];
  for (const s of checks.syntax) out.push(`JavaScript cu eroare de sintaxă la rândul ${s.line}: ${s.message}`);
  for (const l of checks.latex) out.push(`rândul ${l.line}: șir JavaScript cu LaTeX scris cu un singur backslash (${l.commands.map((c) => '\\' + c).join(', ')}): „${l.literal}" — corectura automată dublează backslash-urile (nu o mai propune tu)`);
  for (const k of checks.katex) out.push(`formulă pe care KaTeX nu o poate citi (${k.where}): „${k.tex}" — ${k.error}`);
  if (checks.interactive && !checks.scoreReport) out.push('nu există raportarea scorului (MATE_SCORE)');
  return out;
}

// problemele marcate „nu e o greșeală" la verificările anterioare ale materialului
async function dismissedFor(supa, contentId) {
  const { data } = await supa.from('content_checks').select('issues').eq('content_id', contentId).order('created_at', { ascending: false }).limit(20);
  const out = [];
  for (const c of data || []) for (const i of c.issues || []) if (i.dismissed) out.push(`${i.location}: ${i.title}${i.dismiss_note ? ` (adminul: ${i.dismiss_note})` : ''}`);
  return [...new Set(out)];
}

async function baremFor(supa, content) {
  try {
    const { data: p } = await supa.from('ai_pdf_text').select('barem_status, barem_id, barem_override_id').eq('content_id', content.id).maybeSingle();
    const bid = p?.barem_override_id || (p && BAREM_OK.has(p.barem_status) ? p.barem_id : null);
    if (!bid || bid === content.id) return null;
    const { data: b } = await supa.from('content').select('id, title, file_url').eq('id', bid).maybeSingle();
    if (!b?.file_url) return null;
    const { buf } = await download(supa, b.file_url);
    return buf.length <= 12 * 1024 * 1024 ? { title: b.title, b64: buf.toString('base64') } : null;
  } catch { return null; }
}

// marchează problemele ale căror corecturi chiar se pot aplica (pe fișierul verificat)
async function markFixable(report, { kind, text = null, buf = null }) {
  if (kind === 'html') {
    for (const i of report.issues) {
      if (i.fix_kind !== 'patch' || !i.edits.length) continue;
      const r = V.applyEdits(text, i.edits);
      const bad = r.results.filter((x) => !x.ok);
      i.fixable = bad.length === 0;
      i.fix_problem = bad.length ? bad.map((x) => x.reason)[0] : null;
    }
    return;
  }
  let pages = null;
  try { pages = await V.pdfLines(buf); } catch { pages = null; }
  for (const i of report.issues) {
    if (i.fix_kind !== 'patch' || !i.edits.length) continue;
    if (!pages) { i.fixable = true; i.fix_mode = 'erata'; continue; }
    const located = i.edits.map((e) => V.locateInPdf(pages, e.find, i.page));
    i.fixable = true;                              // ce nu se găsește intră în ERATĂ
    i.fix_mode = located.every((l) => l.ok) ? 'pe_loc' : located.some((l) => l.ok) ? 'mixt' : 'erata';
    i.fix_problem = located.find((l) => !l.ok)?.reason || null;
  }
}

async function check(req, res, supa) {
  const userId = await adminUser(req, supa);
  if (!claude.HAS_KEY) throw fail(501, 'Agentul de verificare are nevoie de cheia ANTHROPIC_API_KEY (Vercel → Settings → Environment Variables).', 'NO_ANTHROPIC_KEY');
  const content = await loadContent(supa, req.body?.contentId);
  const kind = kindOf(content);
  if (!kind) throw fail(400, 'Materialul nu are un fișier PDF sau HTML de verificat.');
  const model = claude.resolveModel(req.body?.model || 'claude-opus-5-5');
  const effort = claude.EFFORTS.includes(req.body?.effort) ? req.body.effort : 'high';
  const secondOf = req.body?.secondOf ? await loadCheck(supa, req.body.secondOf) : null;
  if (secondOf && secondOf.content_id !== content.id) throw fail(400, 'Verificarea anterioară e a altui material.');

  const { buf } = await download(supa, content.file_url);
  const fileHash = sha(buf);
  const meta = { title: content.title, description: content.description, category: content.category, subcategory: content.subcategory, profile: content.profile };
  const previous = secondOf ? (secondOf.issues || []).filter((i) => i.source !== 'automat' && !i.dismissed) : [];
  const dismissed = await dismissedFor(supa, content.id);
  const schema = V.reportSchema(ai.S);
  const system = V.systemPrompt({ kind });
  const usage = {};
  let cost = 0;
  let report;
  let staticFound = [];
  let html = null;

  if (kind === 'html') {
    html = buf.toString('utf8');
    const checks = V.staticChecks(html);
    staticFound = V.staticIssues(checks);
    const src = V.htmlForModel(html);
    const r = await claude.chatAdvanced({
      system, model, effort, schema, maxTokens: 48000,
      messages: [{ role: 'user', content: V.userContent({ kind, meta, html: src.text, staticFindings: staticHints(checks), previous, dismissed }) }],
    });
    claude.addUsage(usage, r.usage.raw); cost += r.costUsd;
    const data = r.data || claude.extractJson(r.text);
    if (!data) throw fail(502, r.stopReason === 'max_tokens' ? 'Răspunsul agentului a fost tăiat (prea lung). Încearcă din nou cu effort mai mic.' : 'Agentul nu a întors un raport valid. Încearcă din nou.');
    report = V.normalizeReport(data, { kind, restore: ai.restoreLatexControl });
    if (src.truncated) report.summary = `${report.summary} (Atenție: fișierul e foarte mare — s-au verificat primele ${Math.round(src.chars / 1000)} mii de caractere.)`;
  } else {
    const { PDFDocument } = require('pdf-lib');
    let pageCount = 0;
    try { pageCount = (await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false })).getPageCount(); } catch { pageCount = 0; }
    const barem = await baremFor(supa, content);
    const parts = [];
    if (pageCount > 90) {
      const pdfpages = require('./_lib/pdfpages');
      for (let p = 0; p < pageCount; p += PDF_PART_PAGES) {
        const idx = Array.from({ length: Math.min(PDF_PART_PAGES, pageCount - p) }, (_, k) => p + k);
        const part = await pdfpages.extractPagesPdf(buf, idx);
        if (part) parts.push({ b64: part.toString('base64'), offset: p, n: parts.length + 1, from: p + 1, to: p + idx.length });
      }
      parts.forEach((x) => { x.of = parts.length; });
    } else parts.push({ b64: buf.toString('base64'), offset: 0, n: 1, of: 1, from: 1, to: pageCount || null });
    const merged = [];
    let first = null;
    for (const part of parts) {
      const r = await claude.chatAdvanced({
        system, model, effort, schema, maxTokens: 48000,
        messages: [{ role: 'user', content: V.userContent({ kind, meta, pdfB64: part.b64, baremB64: barem?.b64 || null, baremTitle: barem?.title || null, previous, dismissed, part: parts.length > 1 ? part : null }) }],
      });
      claude.addUsage(usage, r.usage.raw); cost += r.costUsd;
      const data = r.data || claude.extractJson(r.text);
      if (!data) throw fail(502, 'Agentul nu a întors un raport valid pentru PDF. Încearcă din nou.');
      const rep = V.normalizeReport(data, { kind, restore: ai.restoreLatexControl });
      if (parts.length > 1) rep.issues.forEach((i) => { if (i.page) i.page += part.offset; });
      first = first || rep;
      merged.push(rep);
    }
    report = { ...first };
    if (merged.length > 1) {
      report.issues = merged.flatMap((m) => m.issues);
      report.items = merged.flatMap((m) => m.items);
      report.items_checked = merged.reduce((n, m) => n + (m.items_checked || 0), 0);
      report.summary = merged.map((m, k) => `Partea ${k + 1}: ${m.summary}`).join(' ');
      report.verdict = merged.some((m) => m.verdict === 'probleme_grave') ? 'probleme_grave' : merged.some((m) => m.verdict === 'probleme_minore') ? 'probleme_minore' : 'ok';
    }
    report.pages = pageCount || null;
    report.barem = barem ? barem.title : null;
  }

  // problemele găsite automat (sigure) + cele ale modelului (fără dubluri)
  const fold = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const aiIssues = report.issues.filter((i) => !(i.category === 'latex_formatare' && staticFound.some((s) => s.category === 'latex_formatare' && fold(i.evidence) && (fold(s.evidence).includes(fold(i.evidence)) || fold(i.evidence).includes(fold(s.evidence))))));
  const issues = [...staticFound.map((s, k) => ({ ...s, id: `s${k + 1}` })), ...aiIssues];
  const fixReport = { issues };
  await markFixable(fixReport, { kind, text: html, buf });
  if (!issues.length) report.verdict = 'ok';
  else if (issues.some((i) => i.severity === 'critica' || i.severity === 'majora')) report.verdict = 'probleme_grave';
  else if (report.verdict === 'ok' && issues.some((i) => i.severity === 'minora')) report.verdict = 'probleme_minore';

  const usageLog = { prompt_tokens: claude.effectiveInput(model, usage), completion_tokens: usage.output_tokens || 0, model };
  await ai.logUsage(supa, userId, 'content-check', usageLog);
  const row = {
    content_id: content.id, file_url: content.file_url, file_hash: fileHash, kind, model, effort,
    status: V.statusOf(issues), verdict: report.verdict, summary: report.summary,
    report: { document_kind: report.document_kind, official: report.official, items_checked: report.items_checked, items: report.items, previous_review: report.previous_review, pages: report.pages || null, barem: report.barem || null },
    issues, cost_micro: lei(cost), tokens_in: usageLog.prompt_tokens, tokens_out: usageLog.completion_tokens,
    created_by: userId, second_of: secondOf ? secondOf.id : null,
  };
  const { data: saved, error } = await supa.from('content_checks').insert(row).select('*').maybeSingle();
  dbCheck(error, 'salvarea verificării');
  return res.status(200).json({ check: saved, light: light(saved) });
}

// ─── get / history / dismiss ─────────────────────────────────────────────────
async function get(req, res, supa) {
  await adminUser(req, supa);
  const c = await loadCheck(supa, req.body?.checkId);
  const content = await loadContent(supa, c.content_id).catch(() => null);
  return res.status(200).json({ check: c, content, stale: !!content && content.file_url !== c.file_url && !(c.fix?.new_url && content.file_url === c.fix.new_url) });
}

async function history(req, res, supa) {
  await adminUser(req, supa);
  const { data, error } = await supa.from('content_checks').select('*').eq('content_id', String(req.body?.contentId || '')).order('created_at', { ascending: false }).limit(20);
  dbCheck(error, 'istoricul');
  return res.status(200).json({ checks: (data || []).map(light) });
}

async function dismiss(req, res, supa) {
  await adminUser(req, supa);
  const c = await loadCheck(supa, req.body?.checkId);
  const id = String(req.body?.issueId || '');
  const undo = !!req.body?.undo;
  const note = String(req.body?.note || '').slice(0, 300) || null;
  const issues = (c.issues || []).map((i) => (i.id === id ? { ...i, dismissed: !undo, dismiss_note: undo ? null : note } : i));
  const { data, error } = await supa.from('content_checks').update({ issues, status: V.statusOf(issues) }).eq('id', c.id).select('*').maybeSingle();
  dbCheck(error, 'verificarea');
  return res.status(200).json({ check: data, light: light(data) });
}

// ─── corectura: ciornă → previzualizare → publicare / anulare ────────────────
async function prepareFix(req, res, supa) {
  await adminUser(req, supa);
  const c = await loadCheck(supa, req.body?.checkId);
  const content = await loadContent(supa, c.content_id);
  if (content.file_url !== c.file_url) throw fail(409, 'Fișierul materialului s-a schimbat după această verificare. Verifică-l din nou înainte de corectură.', 'STALE');
  const want = new Set(Array.isArray(req.body?.issueIds) ? req.body.issueIds.map(String) : []);
  const chosen = (c.issues || []).filter((i) => want.has(i.id) && !i.dismissed && !i.fixed && (i.fix_kind === 'patch' || (c.kind === 'pdf' && i.fix_kind === 'manual')));
  if (!chosen.length) throw fail(400, 'Alege cel puțin o problemă cu corectură.');
  const { buf, bucket, filePath } = await download(supa, c.file_url);
  if (c.file_hash && sha(buf) !== c.file_hash) throw fail(409, 'Fișierul din Storage diferă de cel verificat. Verifică-l din nou.', 'STALE');
  // ciorna veche (dacă există) se înlocuiește
  if (c.draft?.path) await supa.storage.from(c.draft.bucket || bucket).remove([c.draft.path]).catch(() => {});

  const newPath = V.correctedPath(filePath);
  let out, contentType, preview = {};
  if (c.kind === 'html') {
    const before = buf.toString('utf8');
    const edits = chosen.flatMap((i) => i.edits.map((e) => ({ ...e, issue: i.id })));
    const r = V.applyEdits(before, edits);
    const failed = r.results.map((x, k) => ({ ...x, issue: edits[k].issue })).filter((x) => !x.ok);
    if (failed.length === edits.length) throw fail(422, `Nicio corectură nu s-a putut aplica: ${failed[0].reason}.`, 'FIX_FAILED');
    const v = V.validatePatched(before, r.text);
    if (!v.ok) throw fail(422, `Corectura nu e sigură, nu o aplic: ${v.problems.join('; ')}.`, 'FIX_UNSAFE');
    out = Buffer.from(r.text, 'utf8');
    contentType = 'text/html; charset=utf-8';
    preview = {
      edits: edits.map((e, k) => ({ issue: e.issue, ok: r.results[k].ok, how: r.results[k].how || null, reason: r.results[k].reason || null, ...V.editPreview(before, e) })),
      diff: V.lineDiff(before, r.text),
      failed,
    };
  } else {
    const edits = [];
    const erratum = [];
    for (const i of chosen) {
      if (i.fix_kind === 'patch') for (const e of i.edits) edits.push({ id: i.id, page: i.page, find: e.find, replace: e.replace, location: i.location, note: null });
      else erratum.push({ id: i.id, location: i.location, text: [i.title, i.correct ? `Corect: ${i.correct}` : ''].filter(Boolean).join(' — ') });
    }
    const dateLabel = new Date().toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Bucharest' });
    const r = await V.patchPdf(buf, edits, { erratum, title: content.title, dateLabel });
    out = r.pdf;
    contentType = 'application/pdf';
    preview = { placed: r.placed, errata: r.errata };
  }
  const { error: upErr } = await supa.storage.from(bucket).upload(newPath, out, { contentType, upsert: false });
  if (upErr) throw fail(502, `Nu am putut salva fișierul corectat: ${upErr.message}`);
  const url = supa.storage.from(bucket).getPublicUrl(newPath)?.data?.publicUrl;
  const draft = { bucket, path: newPath, url, issueIds: chosen.map((i) => i.id), created_at: new Date().toISOString(), bytes: out.length, preview: c.kind === 'pdf' ? preview : { failed: preview.failed } };
  const { data, error } = await supa.from('content_checks').update({ draft }).eq('id', c.id).select('*').maybeSingle();
  dbCheck(error, 'ciorna');
  let signed = null;
  try { signed = (await supa.storage.from(bucket).createSignedUrl(newPath, 3600))?.data?.signedUrl || null; } catch { signed = null; }
  return res.status(200).json({ check: data, light: light(data), preview: { ...preview, url: signed } });
}

// sursa pentru previzualizare: HTML (text) sau link semnat (PDF)
async function previewSource(req, res, supa) {
  await adminUser(req, supa);
  const c = await loadCheck(supa, req.body?.checkId);
  const which = req.body?.which === 'draft' ? 'draft' : 'current';
  let bucket, filePath;
  if (which === 'draft') {
    if (!c.draft?.path) throw fail(404, 'Nu există o ciornă de corectură.');
    bucket = c.draft.bucket; filePath = c.draft.path;
  } else {
    const content = await loadContent(supa, c.content_id);
    ({ bucket, filePath } = parseStoragePath(content.file_url));
  }
  if (c.kind === 'html') {
    const { data, error } = await supa.storage.from(bucket).download(filePath);
    if (error || !data) throw fail(502, 'Nu am putut citi fișierul.');
    return res.status(200).json({ html: Buffer.from(await data.arrayBuffer()).toString('utf8') });
  }
  const { data } = await supa.storage.from(bucket).createSignedUrl(filePath, 3600);
  return res.status(200).json({ url: data?.signedUrl || null });
}

async function publishFix(req, res, supa) {
  const userId = await adminUser(req, supa);
  const c = await loadCheck(supa, req.body?.checkId);
  if (!c.draft?.url) throw fail(400, 'Pregătește întâi corectura (previzualizarea).');
  const content = await loadContent(supa, c.content_id);
  if (content.file_url !== c.file_url) throw fail(409, 'Fișierul materialului s-a schimbat între timp. Verifică-l din nou.', 'STALE');
  const { error: upErr } = await supa.from('content').update({ file_url: c.draft.url }).eq('id', content.id).eq('file_url', c.file_url);
  dbCheck(upErr, 'materialul');
  const ids = new Set(c.draft.issueIds || []);
  const issues = (c.issues || []).map((i) => (ids.has(i.id) ? { ...i, fixed: true } : i));
  const fix = { published_at: new Date().toISOString(), by: userId, old_url: c.file_url, new_url: c.draft.url, new_path: c.draft.path, bucket: c.draft.bucket, issueIds: [...ids] };
  const open = issues.filter((i) => !i.dismissed && !i.fixed);
  const status = open.length ? V.statusOf(issues) : 'reparat';
  const { data, error } = await supa.from('content_checks').update({ issues, fix, draft: null, status }).eq('id', c.id).select('*').maybeSingle();
  dbCheck(error, 'verificarea');
  return res.status(200).json({ check: data, light: light(data) });
}

async function discardFix(req, res, supa) {
  await adminUser(req, supa);
  const c = await loadCheck(supa, req.body?.checkId);
  if (c.draft?.path) await supa.storage.from(c.draft.bucket).remove([c.draft.path]).catch(() => {});
  const { data, error } = await supa.from('content_checks').update({ draft: null }).eq('id', c.id).select('*').maybeSingle();
  dbCheck(error, 'verificarea');
  return res.status(200).json({ check: data, light: light(data) });
}

async function undoFix(req, res, supa) {
  await adminUser(req, supa);
  const c = await loadCheck(supa, req.body?.checkId);
  if (!c.fix?.new_url || c.fix.undone_at) throw fail(400, 'Nu există o corectură publicată de anulat.');
  const content = await loadContent(supa, c.content_id);
  if (content.file_url !== c.fix.new_url) throw fail(409, 'Materialul are între timp alt fișier — anularea l-ar suprascrie. Nu fac nimic.', 'STALE');
  const { error } = await supa.from('content').update({ file_url: c.fix.old_url }).eq('id', content.id).eq('file_url', c.fix.new_url);
  dbCheck(error, 'materialul');
  if (c.fix.new_path) await supa.storage.from(c.fix.bucket).remove([c.fix.new_path]).catch(() => {});
  const ids = new Set(c.fix.issueIds || []);
  const issues = (c.issues || []).map((i) => (ids.has(i.id) ? { ...i, fixed: false } : i));
  const { data, error: e2 } = await supa.from('content_checks').update({ issues, fix: { ...c.fix, undone_at: new Date().toISOString() }, status: V.statusOf(issues) }).eq('id', c.id).select('*').maybeSingle();
  dbCheck(e2, 'verificarea');
  return res.status(200).json({ check: data, light: light(data) });
}

// ═════════════════════════════════════════════════════════════════════════════
const ACTIONS = {
  overview, check, get, history, dismiss,
  prepare_fix: prepareFix, preview: previewSource, publish_fix: publishFix, discard_fix: discardFix, undo_fix: undoFix,
};

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const supa = ai.admin();
  try {
    const fn = ACTIONS[req.body?.action];
    if (!fn) return res.status(400).json({ error: 'action invalid' });
    return await fn(req, res, supa);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('content-check:', e);
    return res.status(e.status || 500).json({ error: e.message || 'Eroare server', code: e.code || null });
  }
};
module.exports.kindOf = kindOf;
