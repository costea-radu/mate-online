// =====================================================================
// api/_lib/examBotRun.js — 🤖 BOTUL DE EXAMENE: lucrul cu baza de date
//
// Trei treburi, fiecare pe „pași" care încap în timpul unei funcții Vercel
// (Admin le cheamă pe rând până termină; cronul face câte o felie):
//
//  1. 🔎 CĂUTAREA ONLINE (descoperire): sursele (edupedu.ro, subiecte.edu.ro,
//     edu.ro, paginile urmărite, căutarea web opțională) → linkurile PDF / ZIP →
//     exam_bot_items. Fiecare fișier nou: descărcat, citit (antetul PDF-ului),
//     clasificat (api/_lib/examBot.js), comparat cu ce e deja pe site (aceeași
//     amprentă = duplicat). Ce e SIGUR se publică singur în rubrica lui (titlu
//     SEO, nume de fișier SEO, descriere cu numele original); ce e nesigur
//     așteaptă în Admin („De verificat"). Subiectul și baremul găsite împreună
//     se leagă (verificate: titlu + fișier + antet + conținut).
//  2. ✅ VERIFICAREA BAREMELOR: toate PDF-urile de EN / BAC de pe site intră în
//     exam_bot_index — pentru fiecare subiect, baremul pe care îl vede site-ul
//     (aceeași potrivire ca la deschiderea PDF-ului: api/ai-pdf-context.js),
//     felul potrivirii și dovada. Raportul din Admin vine de aici.
//  3. 🔍 BAREMELE LIPSĂ: pentru subiectele fără barem — întâi baremele deja de
//     pe site (toate cele compatibile, verificate pe conținut), apoi online
//     (numele oficial al baremului, căutarea pe edupedu, căutarea web, la cerere
//     și AI). Baremul găsit se încarcă la „Bareme" și se leagă de subiect
//     (ai_pdf_text.barem_override_id, by = 'bot').
//
// Tabelele: supabase/bot_examene.sql. Setările: app_settings 'exam_bot'.
// =====================================================================
const crypto = require('node:crypto');
const E = require('./examBot');
const N = require('./examBotNet');
const B = require('./barem');
const SET = require('./settings');
const http = require('./http');
const { unzip } = require('./unzip');

let _pdf = null;
const PDF = () => (_pdf || (_pdf = require('../ai-pdf-context')));

const T = { items: 'exam_bot_items', index: 'exam_bot_index', runs: 'exam_bot_runs', pages: 'exam_bot_pages' };
const SETTINGS_KEY = 'exam_bot';
const EXAM_CATS = ['evaluare-nationala', 'bacalaureat'];
const NEEDS_BAREM_SUBS = new Set(['variante', 'simulari', 'teste-antrenament']);
const BAREM_OK = new Set(['ok', 'ok_antet', 'ok_continut', 'inclus', 'ok_admin', 'ok_bot']);
const BAREM_LIPSA = ['negasit', 'ambiguu', 'continut_diferit'];
const SETUP_HINT = 'Botul de examene nu e încă activat: rulează o dată supabase/bot_examene.sql în Supabase → SQL Editor.';

const nowIso = () => new Date().toISOString();
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const isMissing = (err) => !!err && /relation .* does not exist|does not exist|schema cache|could not find the table/i.test(String(err.message || err));
const hhmmss = () => new Intl.DateTimeFormat('ro-RO', { timeZone: 'Europe/Bucharest', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date());
function fail(status, message, code = null) { const e = new Error(message); e.status = status; if (code) e.code = code; return e; }

// ═══════════════════════════════════════════════════════════════════════════
// Setări, instalare, rulări
// ═══════════════════════════════════════════════════════════════════════════
async function loadSettings(supa) {
  try {
    const r = await SET.readSetting(supa, SETTINGS_KEY);
    return { setup: r.setup, value: E.normalizeSettings(r.value), updatedAt: r.updatedAt || null };
  } catch { return { setup: false, value: E.normalizeSettings(null), updatedAt: null }; }
}
async function saveSettings(supa, value, userId = null) {
  const v = E.normalizeSettings(value);
  await SET.writeSetting(supa, SETTINGS_KEY, v, userId);
  return v;
}

async function setupInfo(supa) {
  const out = { tables: true, missing: [], overrideBy: true };
  for (const t of Object.values(T)) {
    const { error } = await supa.from(t).select('*', { head: true, count: 'exact' }).limit(1);
    if (error && isMissing(error)) { out.tables = false; out.missing.push(t); }
  }
  const { error: e2 } = await supa.from('ai_pdf_text').select('barem_override_by', { head: true, count: 'exact' }).limit(1);
  if (e2) out.overrideBy = false;
  return out;
}

function newStats() {
  return {
    pagini: 0, linkuri: 0, noi: 0, descarcate: 0, publicate: 0, asteptare: 0, duplicate: 0, ignorate: 0, erori: 0,
    verificate: 0, bareme_cautate: 0, bareme_gasite: 0, asocieri: 0, cautari_web: 0, cautari_ai: 0, cost_usd: 0,
  };
}
function mergeStats(a, b) {
  const out = { ...(a || {}) };
  for (const [k, v] of Object.entries(b || {})) if (typeof v === 'number') out[k] = Math.round(((out[k] || 0) + v) * 10000) / 10000;
  return out;
}

// (testele pun aici o rețea simulată: setNetFactory((opts) => new N.Net({ ...opts, fetchImpl, lookup })))
let netFactory = null;
const setNetFactory = (f) => { netFactory = typeof f === 'function' ? f : null; };

function makeCtx(supa, settings, { budgetMs = 200000, net = null, by = 'admin' } = {}) {
  const t0 = Date.now();
  const lines = [];
  const ctx = {
    supa, settings: E.normalizeSettings(settings), t0, budgetMs, by, lines,
    left: () => budgetMs - (Date.now() - t0),
    log: (m) => { lines.push(`${hhmmss()} ${m}`); if (lines.length > 500) lines.shift(); },
    stats: newStats(),
    published: [],        // ce s-a publicat în acest pas: { content_id, item_id, row, cls, text, isBarem }
    linked: new Set(),    // subiectele legate de un barem în acest pas (pentru anunț)
    texts: new Map(),     // content_id → textul PDF (citit o dată pe pas)
  };
  const opts = { deadline: t0 + budgetMs - 4000, log: ctx.log };
  ctx.net = net || (netFactory ? netFactory(opts) : new N.Net(opts));
  return ctx;
}

// O rulare (cronul sau un buton din Admin): rândul din exam_bot_runs + „lacătul"
async function startRun(supa, { kind, by = 'admin', runId = null } = {}) {
  const since = new Date(Date.now() - 6 * 60000).toISOString();
  const { data: busy, error } = await supa.from(T.runs).select('id, kind, by, started_at').eq('status', 'ruleaza').gte('heartbeat_at', since).limit(5);
  if (error) { if (isMissing(error)) throw fail(503, SETUP_HINT, 'SETUP'); throw fail(500, error.message); }
  const other = (busy || []).find((r) => r.id !== runId);
  if (other) throw fail(409, `Botul lucrează deja (${other.kind}, pornit ${other.by === 'cron' ? 'de cron' : 'din Admin'}). Încearcă peste câteva minute.`, 'BUSY');
  if (runId) {
    const { data } = await supa.from(T.runs).select('*').eq('id', runId).maybeSingle();
    if (data && data.status !== 'oprit') {
      await supa.from(T.runs).update({ status: 'ruleaza', heartbeat_at: nowIso() }).eq('id', runId);
      return { ...data, status: 'ruleaza' };
    }
  }
  const row = { kind, by, status: 'ruleaza', started_at: nowIso(), heartbeat_at: nowIso(), stats: {}, log: [], cost_usd: 0 };
  const { data, error: e2 } = await supa.from(T.runs).insert(row).select().maybeSingle();
  if (e2 || !data) throw fail(500, `Nu am putut porni rularea (${e2 ? e2.message : 'fără rând'})`);
  return data;
}
async function saveRun(supa, run, ctx, { final = false, status = null, note = null } = {}) {
  const stats = mergeStats(run.stats, ctx.stats);
  const log = [...(Array.isArray(run.log) ? run.log : []), ...ctx.lines].slice(-400);
  const patch = { stats, log, heartbeat_at: nowIso(), cost_usd: Math.round(((Number(run.cost_usd) || 0) + (ctx.stats.cost_usd || 0)) * 10000) / 10000 };
  if (note) patch.note = String(note).slice(0, 500);
  if (final) { patch.status = status || 'ok'; patch.finished_at = nowIso(); }
  await supa.from(T.runs).update(patch).eq('id', run.id);
  return { ...run, ...patch };
}

// ═══════════════════════════════════════════════════════════════════════════
// Indexul site-ului (ce PDF-uri de EN / BAC există și ce bareme au)
// ═══════════════════════════════════════════════════════════════════════════
const CONTENT_COLS = 'id, title, description, category, subcategory, profile, content_type, file_url, is_free, created_at';
async function loadExamPdfs(supa, ids = null) {
  if (ids && ids.length) {
    const { data } = await supa.from('content').select(CONTENT_COLS).in('id', ids);
    return (data || []).filter((r) => r.content_type === 'pdf' && EXAM_CATS.includes(r.category) && r.file_url);
  }
  const rows = await http.allRows((from, to) => supa.from('content').select(CONTENT_COLS)
    .eq('content_type', 'pdf').in('category', EXAM_CATS).order('created_at', { ascending: true }).range(from, to));
  return rows.filter((r) => r.file_url);
}
async function loadIndex(supa) {
  try {
    return await http.allRows((from, to) => supa.from(T.index).select('*').order('content_id', { ascending: true }).range(from, to));
  } catch (e) { if (isMissing(e)) throw fail(503, SETUP_HINT, 'SETUP'); throw e; }
}

// e un subiect care ar trebui să aibă barem? (variante / simulări / teste de antrenament)
function needsBarem(row) {
  if (!row || !EXAM_CATS.includes(row.category) || B.isBaremRow(row)) return false;
  if (NEEDS_BAREM_SUBS.has(row.subcategory)) return true;
  if (row.subcategory) return false;                       // capitole, exerciții pe subiecte, teste interactive
  return /\b(varianta|model|simulare|antrenament|sesiunea|rezerva|olimpic|test(ul)?\s*\d)/.test(B.norm(row.title)) || !!B.yearOf(B.norm(row.title));
}

// textul unui PDF de pe site: din cache-ul serverului (ai_pdf_text) sau descărcat
async function textOf(ctx, row) {
  if (!row) return '';
  if (ctx.texts.has(row.id)) return ctx.texts.get(row.id);
  let text = '';
  try {
    const { data } = await ctx.supa.from('ai_pdf_text').select('text, file_url').eq('content_id', row.id).maybeSingle();
    if (data && data.file_url === row.file_url && String(data.text || '').trim().length > 50) text = data.text;
  } catch { /* fără cache */ }
  if (!text) {
    try { text = (await PDF().contentPdfText(ctx.supa, row, 30000)).text || ''; } catch (e) { ctx.log(`⚠ nu am putut citi „${row.title}": ${e.message}`); text = ''; }
  }
  ctx.texts.set(row.id, text);
  return text;
}

const tokensLite = (tk) => (tk ? { exam: tk.exam || null, year: tk.year || null, variant: tk.variant || null, kind: tk.kind || null, flags: tk.flags || '', profile: tk.profile || null } : null);

// Un rând din index: amprenta, baremul (așa cum îl vede site-ul), dovada
async function indexOne(ctx, row, prev = null) {
  const { supa } = ctx;
  const isBaremTitle = B.isBaremRow(row);
  const needs = needsBarem(row);
  let text = '', status = 'nu_necesita', baremId = null, how = null, evidence = null, baremTitle = null, error = null, score = null;
  if (needs) {
    try {
      const pc = await PDF().getPdfContext(supa, row);   // aceeași potrivire ca la deschiderea PDF-ului (cu cache)
      text = pc.text || '';
      ctx.texts.set(row.id, text);
      status = pc.baremStatus || 'negasit';
      if (status === 'ok_admin' && pc.barem && pc.barem.matchedBy === 'bot') status = 'ok_bot';
      baremId = pc.barem ? pc.barem.id || (status === 'inclus' ? row.id : null) : null;
      how = pc.barem ? pc.barem.matchedBy || null : null;
      evidence = pc.barem ? pc.barem.evidence || null : null;
      baremTitle = pc.barem ? pc.barem.title || null : null;
      score = pc.barem && typeof pc.barem.contentScore === 'number' ? pc.barem.contentScore : null;
      if (!String(text).trim()) { status = 'fara_text'; }
    } catch (e) { error = e.message; status = 'eroare'; }
  } else if (isBaremTitle) {
    text = await textOf(ctx, row);
    status = 'este_barem';
  }
  const doc = text ? B.docTokens(text) : null;
  const tk = B.tokensOf(row, doc);
  const isBarem = isBaremTitle || !!(doc && doc.isBarem && !needs);
  const idx = {
    content_id: row.id, file_url: row.file_url, title: row.title, category: row.category, subcategory: row.subcategory || null, profile: row.profile || null,
    is_barem: isBarem || status === 'este_barem', needs_barem: needs && !(doc && doc.isBarem),
    tokens: { ...tokensLite(tk), exam: B.examOf(row) }, describe: B.describeTokens(tk) || null,
    fp: text ? E.fingerprint(text) : (prev && prev.file_url === row.file_url ? prev.fp : null),
    barem_status: doc && doc.isBarem && needs ? 'este_barem' : status, barem_id: baremId, barem_how: how, barem_evidence: evidence, barem_title: baremTitle,
    barem_score: score, error, checked_at: nowIso(),
  };
  const { error: e } = await supa.from(T.index).upsert(idx, { onConflict: 'content_id' });
  if (e) { if (isMissing(e)) throw fail(503, SETUP_HINT, 'SETUP'); ctx.log(`⚠ index: ${e.message}`); }
  ctx.stats.verificate++;
  return { ...(prev || {}), ...idx };
}

// ✅ VERIFICAREA: indexează PDF-urile noi / schimbate / vechi (felie cu felie)
async function verifyStep(ctx, { force = false, ids = null } = {}) {
  const rows = await loadExamPdfs(ctx.supa, ids);
  const index = await loadIndex(ctx.supa);
  const byId = new Map(index.map((r) => [r.content_id, r]));
  const old = Date.now() - 7 * 86400000;
  const day = Date.now() - 86400000;
  const todo = rows.filter((r) => {
    const p = byId.get(r.id);
    if (force || !p || p.file_url !== r.file_url || !p.checked_at) return true;
    const t = Date.parse(p.checked_at) || 0;
    if (t < old) return true;
    return p.needs_barem && !p.ignored && !BAREM_OK.has(p.barem_status) && t < day;   // fără barem: re-verificat zilnic
  }).sort((a, b) => (byId.has(a.id) ? 1 : 0) - (byId.has(b.id) ? 1 : 0));
  let done = 0;
  for (const r of todo) {
    if (ctx.left() < 25000) break;
    try { await indexOne(ctx, r, byId.get(r.id)); } catch (e) { if (e.code === 'SETUP') throw e; ctx.log(`⚠ „${r.title}": ${e.message}`); }
    done++;
  }
  // rândurile materialelor șterse ies din index (FK cu cascade face asta în SQL; aici, pentru siguranță)
  if (!ids) {
    const alive = new Set(rows.map((r) => r.id));
    const gone = index.filter((x) => !alive.has(x.content_id)).map((x) => x.content_id);
    if (gone.length) await ctx.supa.from(T.index).delete().in('content_id', gone.slice(0, 500));
  }
  if (done) ctx.log(`✅ verificate ${done} PDF-uri (${todo.length - done} rămase din ${rows.length})`);
  return { total: rows.length, todo: todo.length, done, left: Math.max(0, todo.length - done) };
}

// ═══════════════════════════════════════════════════════════════════════════
// Asocierea subiect ↔ barem
// ═══════════════════════════════════════════════════════════════════════════
async function associate(ctx, subjectRow, baremRow, verdict, by = 'bot') {
  await PDF().setOverride(ctx.supa, subjectRow, baremRow.id, { by });
  const ev = verdict ? JSON.stringify({ ...verdict.evidence, cum: verdict.how }) : null;
  await ctx.supa.from(T.index).update({
    barem_status: by === 'bot' ? 'ok_bot' : 'ok_admin', barem_id: baremRow.id, barem_title: baremRow.title,
    barem_how: by === 'bot' ? `bot · ${verdict && verdict.how ? verdict.how : 'verificat'}` : 'admin',
    barem_evidence: ev, barem_score: verdict && typeof verdict.score === 'number' ? verdict.score : null,
    search_status: 'gasit', searched_at: nowIso(), checked_at: nowIso(),
  }).eq('content_id', subjectRow.id);
  ctx.stats.asocieri++;
  if (ctx.linked) ctx.linked.add(subjectRow.id);
  ctx.log(`🔗 „${subjectRow.title}" ↔ „${baremRow.title}"${verdict && verdict.score != null ? ` (conținut ${Math.round(verdict.score * 100)}%)` : ''}`);
}

// baremele de pe site compatibile cu un subiect (după amprentele din index), cele mai potrivite întâi
function compatibleBaremes(index, subj, { max = 12 } = {}) {
  const s = subj.tokens || {};
  return index
    .filter((x) => x.is_barem && x.content_id !== subj.content_id && x.category === subj.category
      && (subj.category !== 'bacalaureat' || !x.profile || !subj.profile || x.profile === subj.profile)
      && !B.tokensContradict({ ...s, words: [] }, { ...(x.tokens || {}), words: [] }))
    .map((x) => ({ x, a: B.tokensAgreement({ ...s, words: [] }, { ...(x.tokens || {}), words: [] }) }))
    .sort((a, b) => b.a - a.a)
    .slice(0, max)
    .map((y) => y.x);
}

// ═══════════════════════════════════════════════════════════════════════════
// Fișierele găsite online (exam_bot_items)
// ═══════════════════════════════════════════════════════════════════════════
async function insertItems(ctx, list) {
  const fresh = [];
  for (let i = 0; i < list.length; i += 200) {
    const chunk = list.slice(i, i + 200);
    const urls = chunk.map((c) => c.url);
    const { data: have, error } = await ctx.supa.from(T.items).select('url').in('url', urls);
    if (error) { if (isMissing(error)) throw fail(503, SETUP_HINT, 'SETUP'); throw fail(500, error.message); }
    const known = new Set((have || []).map((r) => r.url));
    const rows = chunk.filter((c) => !known.has(c.url)).map((c) => ({
      url: c.url, source: c.source || null, page_url: c.pageUrl || null, page_title: c.pageTitle ? String(c.pageTitle).slice(0, 500) : null,
      page_date: c.pageDate && Number.isFinite(Date.parse(c.pageDate)) ? new Date(Date.parse(c.pageDate)).toISOString() : null,
      link_text: c.text ? String(c.text).slice(0, 300) : null, file_name: E.fileNameFromUrl(c.url).slice(0, 300),
      status: 'nou', found_at: nowIso(), updated_at: nowIso(), parent_id: c.parentId || null,
    }));
    if (!rows.length) continue;
    const { data: ins, error: e2 } = await ctx.supa.from(T.items).upsert(rows, { onConflict: 'url', ignoreDuplicates: true }).select('*');
    if (e2) { ctx.log(`⚠ nu am putut salva linkurile: ${e2.message}`); continue; }
    fresh.push(...(ins || []));
  }
  ctx.stats.noi += fresh.length;
  return fresh;
}
const updItem = (ctx, id, patch) => ctx.supa.from(T.items).update({ ...patch, updated_at: nowIso() }).eq('id', id);

// candidatul trece filtrul de dinainte de descărcare?
function preFilter(c) {
  const L = E.classifyLink(c);
  if (!L.pdf && !L.zip) return false;
  if (!L.download) return false;
  if (!E.isTrustedHost(E.hostOf(c.url), c.settings || E.DEFAULT_SETTINGS) && c.source !== 'cautare' && c.source !== 'ai' && c.source !== 'pagina') return false;
  return true;
}

// ─── Sursele → linkurile candidate ──────────────────────────────────────────
async function seenRecently(ctx, url) {
  const { data } = await ctx.supa.from(T.pages).select('first_seen').eq('url', url).maybeSingle();
  if (!data) return false;
  return (Date.now() - (Date.parse(data.first_seen) || 0)) > 3 * 86400000;   // articolele mai noi de 3 zile se recitesc (se adaugă baremele)
}
async function markPage(ctx, url, title, links, source) {
  const { data } = await ctx.supa.from(T.pages).select('url').eq('url', url).maybeSingle();
  if (data) await ctx.supa.from(T.pages).update({ seen_at: nowIso(), links, title: title ? String(title).slice(0, 500) : null }).eq('url', url);
  else await ctx.supa.from(T.pages).insert({ url, title: title ? String(title).slice(0, 500) : null, links, source, first_seen: nowIso(), seen_at: nowIso() });
}

function discoveryYears(ctx, now = new Date(), backfillTurn = 0) {
  const ey = E.examYearOf(now);
  const years = [ey, ey - 1].filter((y) => y >= ctx.settings.minYear);
  const older = [];
  for (let y = ey - 2; y >= ctx.settings.minYear; y--) older.push(y);
  if (older.length) years.push(older[backfillTurn % older.length]);
  return [...new Set(years)];
}

async function collect(ctx, { years, search = true, now = new Date() } = {}) {
  const S = ctx.settings, net = ctx.net;
  const out = [];
  const add = (f, source) => { if (f && f.url) out.push({ ...f, source, settings: S }); };
  const fileExt = (u) => E.extOf(E.fileNameFromUrl(u));

  // 1) edupedu.ro — etichetele urmărite (articolele noi) + căutările pe ani
  if (S.sources.edupedu && ctx.left() > 60000) {
    const arts = [];
    arts.push(...await N.edupeduTags(net));
    if (search) {
      for (const q of E.discoveryQueries(years)) {
        if (ctx.left() < 90000) break;
        const r = await N.edupeduSearch(net, q);
        arts.push(...(r.items || []));
      }
    }
    const seen = new Set();
    for (const a of arts) {
      if (!a.link || seen.has(a.link)) continue;
      seen.add(a.link);
      if (ctx.left() < 60000) break;
      if (!E.relevantArticle(a.title)) continue;
      const y = E.yearFromText(E.fold(a.title));
      if (y && +y < S.minYear) continue;
      if (!a.html && await seenRecently(ctx, a.link)) continue;
      const r = await N.articleLinks(net, a);
      if (!r.ok) continue;
      ctx.stats.pagini++;
      let n = 0;
      for (const l of r.links) { const ext = fileExt(l.url); if (ext === 'pdf' || ext === 'zip') { add({ url: l.url, text: l.text, pageTitle: r.title, pageUrl: r.url, pageDate: r.date }, 'edupedu'); n++; } }
      for (const g of r.guesses) { add({ url: g, text: '', pageTitle: r.title, pageUrl: r.url, pageDate: r.date }, 'ghicit'); n++; }
      await markPage(ctx, r.url, r.title, n, 'edupedu');
    }
  }
  // 2) subiecte.edu.ro — paginile pe ani (dacă robots.txt le permite)
  if (S.sources.subiecte) {
    for (const seed of N.subiecteSeeds(years)) {
      if (ctx.left() < 60000) break;
      const r = await N.crawl(net, seed, { depth: 2, maxPages: 15 });
      ctx.stats.pagini += r.pages || 0;
      for (const f of r.files) add(f, 'subiecte.edu.ro');
      if (r.error && /robots/.test(r.error)) { ctx.log('⛔ subiecte.edu.ro nu permite roboții (robots.txt) — sărit; fișierele oficiale vin din celelalte surse.'); net.blocked.delete('subiecte.edu.ro'); break; }
    }
  }
  // 3) edu.ro — pagina cu modelele de subiecte
  if (S.sources.eduRo && ctx.left() > 60000) {
    for (const u of N.EDU_RO_PAGES) {
      const r = await N.crawl(net, u, { depth: 0, maxPages: 1 });
      ctx.stats.pagini += r.pages || 0;
      for (const f of r.files) add(f, 'edu.ro');
    }
  }
  // 4) paginile urmărite (inspectorate școlare etc.)
  if (S.sources.pagini) {
    for (const u of S.pages) {
      if (ctx.left() < 60000) break;
      const r = await N.watchPage(net, u);
      ctx.stats.pagini += r.pages || 0;
      for (const f of r.files) add(f, 'pagina');
      if (r.error && !r.pages) ctx.log(`⚠ pagina urmărită ${u}: ${r.error}`);
    }
  }
  // 5) căutarea web (Brave / Serper / Google), dacă e configurată. Cronul o face o dată
  //    pe zi (8 căutări/zi ≈ 240/lună — intră în creditul lunar Brave); butonul din Admin, oricând.
  const p = E.roParts(now);
  const webMarker = `cautare-web:${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  let webAzi = null;
  if (S.sources.cautare && search && N.searchProvider() && ctx.by === 'cron') {
    ({ data: webAzi } = await ctx.supa.from(T.pages).select('url').eq('url', webMarker).maybeSingle());
    if (webAzi) ctx.log('🌐 căutarea web: făcută deja azi (cronul o face o dată pe zi, ca să nu coste)');
  }
  if (S.sources.cautare && search && N.searchProvider() && !webAzi) {
    let rezultate = 0;
    for (const q of E.webQueries(years.slice(0, 2))) {
      if (ctx.left() < 75000) break;
      const r = await N.webSearch(net, q);
      ctx.stats.cautari_web++;
      if (!r.ok) { ctx.log(`⚠ căutarea web: ${r.error}`); break; }
      rezultate += r.results.length;
      for (const x of r.results) {
        const ext = fileExt(x.url);
        if (ext === 'pdf' || ext === 'zip') add({ url: x.url, text: x.title, pageTitle: `${x.title} ${x.snippet}`, pageUrl: null }, 'cautare');
        else if (E.isTrustedHost(E.hostOf(x.url), S) && E.relevantArticle(x.title) && ctx.left() > 75000) {
          const a = await N.articleLinks(net, { link: x.url, title: x.title });
          if (!a.ok) continue;
          for (const l of a.links) { const e2 = fileExt(l.url); if (e2 === 'pdf' || e2 === 'zip') add({ url: l.url, text: l.text, pageTitle: a.title, pageUrl: a.url, pageDate: a.date }, 'cautare'); }
        }
      }
    }
    if (ctx.stats.cautari_web) await markPage(ctx, webMarker, 'căutarea web din ziua aceasta', rezultate, 'cautare');
  }
  // unice + filtrul de dinainte de descărcare
  const uniq = new Map();
  for (const c of out) if (!uniq.has(c.url)) uniq.set(c.url, c);
  const all = [...uniq.values()];
  const kept = all.filter(preFilter);
  ctx.stats.linkuri += all.length;
  ctx.log(`🔎 ${all.length} linkuri spre fișiere, ${kept.length} de matematică (EN / BAC) — din ${ctx.stats.pagini} pagini`);
  if (net.blocked.size) ctx.log(`⛔ alte site-uri care nu permit roboți (sărite): ${[...net.blocked].join(', ')}`);
  return kept;
}

// ─── Procesarea unui fișier găsit ───────────────────────────────────────────
function sameDocIn(index, cls, fp) {
  if (!fp || !fp.m || !fp.m.length) return null;
  const cat = cls.exam === 'en' ? 'evaluare-nationala' : cls.exam === 'bac' ? 'bacalaureat' : null;
  const mine = { exam: cls.exam || null, year: cls.year ? String(cls.year) : null, variant: cls.variant ? String(cls.variant) : null, kind: null, profile: cls.profile || null, flags: '' };
  for (const x of index) {
    if (!x.fp || (cat && x.category !== cat)) continue;
    if (!!x.is_barem !== !!cls.isBarem) continue;
    const t = x.tokens || {};
    // alt an / altă variantă / alt profil (după antet) → alt document, oricât ar semăna textul
    if (B.tokensContradict(mine, { exam: t.exam || null, year: t.year || null, variant: t.variant || null, kind: null, profile: t.profile || null, flags: '' })) continue;
    if (E.sameDocument(fp, x.fp)) return x;
  }
  return null;
}

async function processPdf(ctx, it, buf, index) {
  const { supa } = ctx;
  const sha = sha256(buf);
  const dupSha = index.find((x) => x.sha256 === sha);
  if (dupSha) {
    await updItem(ctx, it.id, { status: 'duplicat', sha256: sha, bytes: buf.length, content_id: dupSha.content_id, reasons: [`există deja pe site: „${dupSha.title}"`], processed_at: nowIso() });
    ctx.stats.duplicate++;
    return { status: 'duplicat' };
  }
  const { data: twin } = await supa.from(T.items).select('id, content_id, status').eq('sha256', sha).neq('id', it.id).limit(1);
  if (twin && twin[0]) {
    await updItem(ctx, it.id, { status: 'duplicat', sha256: sha, bytes: buf.length, content_id: twin[0].content_id || null, reasons: ['același fișier ca unul găsit deja (altă adresă)'], processed_at: nowIso() });
    ctx.stats.duplicate++;
    return { status: 'duplicat' };
  }
  let tx = { text: '', full: '', pages: [] };
  try { tx = await PDF().pdfBufferText(buf, 40000); } catch (e) { ctx.log(`⚠ ${it.file_name}: textul nu s-a putut citi (${e.message})`); }
  const text = tx.full || tx.text || '';
  const link = E.classifyLink({ url: it.url, text: it.link_text || '', pageTitle: it.page_title || '', pageUrl: it.page_url || '', pageDate: it.page_date || null });
  const doc = E.classifyDoc(text);
  const dec = E.decide(link, doc, { settings: ctx.settings });
  const fp = text ? E.fingerprint(text) : null;
  const base = {
    sha256: sha, bytes: buf.length, pages: Array.isArray(tx.pages) ? tx.pages.length || null : null, cls: dec.cls, confidence: dec.confidence,
    reasons: dec.reasons, pair_key: E.pairKey(dec.cls), identity: E.identity(dec.cls), text_head: text.slice(0, 1500), fp, processed_at: nowIso(),
  };
  if (dec.status === 'ignorat') {
    await updItem(ctx, it.id, { ...base, status: 'ignorat' });
    ctx.stats.ignorate++;
    return { status: 'ignorat' };
  }
  const dup = sameDocIn(index, dec.cls, fp);
  if (dup) {
    await updItem(ctx, it.id, { ...base, status: 'duplicat', content_id: dup.content_id, reasons: [...dec.reasons, `există deja pe site: „${dup.title}"`] });
    ctx.stats.duplicate++;
    return { status: 'duplicat' };
  }
  const canPublish = dec.confidence === 'sigur' && ctx.settings.autoPublish && ctx.published.length < ctx.settings.maxNewPerRun && E.rubricFor(dec.cls);
  if (!canPublish) {
    await updItem(ctx, it.id, { ...base, status: 'asteptare' });
    ctx.stats.asteptare++;
    ctx.log(`⏸ de verificat: ${it.file_name}${dec.reasons.length ? ` — ${dec.reasons[0]}` : ''}`);
    return { status: 'asteptare' };
  }
  try {
    await publish(ctx, { ...it, ...base }, dec.cls, buf, text, fp, index);
    return { status: 'publicat' };
  } catch (e) {
    await updItem(ctx, it.id, { ...base, status: 'eroare', last_error: e.message, attempts: (it.attempts || 0) + 1 });
    ctx.stats.erori++;
    ctx.log(`⚠ publicarea „${it.file_name}" a eșuat: ${e.message}`);
    return { status: 'eroare' };
  }
}

async function processZip(ctx, it, buf, index) {
  let entries = [];
  try { entries = unzip(buf, { filter: (n) => /\.pdf$/i.test(n) }); } catch (e) {
    await updItem(ctx, it.id, { status: 'ignorat', reasons: [`arhivă care nu se poate deschide: ${e.message}`], processed_at: nowIso() });
    ctx.stats.ignorate++;
    return;
  }
  const kids = [];
  for (const e of entries) {
    const c = { url: `${it.url}#${e.name}`, text: e.name.split('/').pop(), pageTitle: it.page_title, pageUrl: it.page_url, pageDate: it.page_date, source: 'arhiva', parentId: it.id };
    const L = E.classifyLink(c);
    if (!L.download) continue;
    kids.push({ c, data: e.data });
  }
  const fresh = await insertItems(ctx, kids.map((k) => k.c));
  const byUrl = new Map(fresh.map((r) => [r.url, r]));
  let n = 0;
  for (const k of kids) {
    if (ctx.left() < 20000) break;
    const row = byUrl.get(k.c.url);
    if (!row) continue;
    ctx.stats.descarcate++;
    await processPdf(ctx, row, k.data, index);
    n++;
  }
  await updItem(ctx, it.id, { status: 'ignorat', reasons: [`arhivă despachetată: ${entries.length} PDF-uri, ${kids.length} la matematică, ${n} procesate`], processed_at: nowIso() });
}

async function processItem(ctx, it, index) {
  const r = await ctx.net.file(it.url);
  if (!r.ok) {
    const attempts = (it.attempts || 0) + 1;
    const final = attempts >= 3 || /robots|nu e PDF|prea mare|HTTP 4\d\d|domeniu|internă|invalid/.test(String(r.error));
    await updItem(ctx, it.id, { status: final ? 'ignorat' : 'eroare', attempts, last_error: r.error, reasons: [`descărcarea: ${r.error}`] });
    if (final) ctx.stats.ignorate++; else ctx.stats.erori++;
    return;
  }
  ctx.stats.descarcate++;
  if (r.kind === 'zip') return processZip(ctx, it, r.buf, index);
  return processPdf(ctx, it, r.buf, index);
}

// fișierele „noi" (și cele cu erori vechi de peste 6 ore) → procesate
async function processPending(ctx, { limit = null } = {}) {
  const max = limit || ctx.settings.maxNewPerRun;
  const { data: nou } = await ctx.supa.from(T.items).select('*').eq('status', 'nou').order('found_at', { ascending: true }).limit(max);
  const retryBefore = new Date(Date.now() - 6 * 3600000).toISOString();
  const { data: err } = await ctx.supa.from(T.items).select('*').eq('status', 'eroare').lt('attempts', 3).lt('updated_at', retryBefore).limit(10);
  const list = [...(nou || []), ...(err || [])];
  if (!list.length) return { done: 0, left: 0 };
  const index = await loadIndex(ctx.supa);
  let done = 0;
  for (const it of list) {
    if (ctx.left() < 30000) break;
    await processItem(ctx, it, index);
    done++;
  }
  const { count } = await ctx.supa.from(T.items).select('id', { head: true, count: 'exact' }).eq('status', 'nou');
  await pairPublished(ctx, index);
  return { done, left: count || 0 };
}

// ─── Publicarea pe site ─────────────────────────────────────────────────────
async function dropBroadcast(supa, contentId) {
  // triggerul notify_new_content anunță fiecare material nou; botul face UN anunț la final
  try {
    const { data } = await supa.from('ai_broadcasts').select('id').eq('type', 'material').eq('data->>contentId', String(contentId));
    const ids = (data || []).map((b) => b.id);
    if (ids.length) {
      await supa.from('ai_broadcast_reads').delete().in('broadcast_id', ids);
      await supa.from('ai_broadcasts').delete().in('id', ids);
    }
  } catch { /* fără anunțuri */ }
}

async function publish(ctx, it, cls, buf, text, fp, index, { edits = {} } = {}) {
  const { supa } = ctx;
  const rub = E.rubricFor(cls);
  if (!rub) throw new Error('nu pot stabili rubrica (examen / profil)');
  const title = String(edits.title || E.titleFor(cls) || it.file_name).trim().slice(0, 300);
  const subcategory = edits.subcategory || rub.subcategory;
  const profile = rub.category === 'bacalaureat' ? (edits.profile || rub.profile) : null;
  const isFree = typeof edits.is_free === 'boolean' ? edits.is_free : ctx.settings.isFree;
  const bucket = isFree ? 'content-files-free' : 'content-files';
  const path = `pdf/${rub.category}/${Date.now()}_${E.fileNameFor(cls)}`;
  const up = await supa.storage.from(bucket).upload(path, buf, { contentType: 'application/pdf', upsert: false });
  if (up.error) throw new Error(`Storage: ${up.error.message}`);
  const { data: urlData } = supa.storage.from(bucket).getPublicUrl(path);
  const row = {
    title, description: E.descriptionFor(cls, { originalName: it.file_name, sourceHost: E.hostOf(it.page_url || it.url) }),
    category: rub.category, content_type: 'pdf', is_free: isFree, file_url: (urlData && urlData.publicUrl) || path,
    subcategory, profile, sort_order: 0,
  };
  const { data: ins, error } = await supa.from('content').insert(row).select(CONTENT_COLS).maybeSingle();
  if (error || !ins) {
    try { await supa.storage.from(bucket).remove([path]); } catch { /* nimic */ }
    throw new Error(`content: ${error ? error.message : 'fără rând'}`);
  }
  await dropBroadcast(supa, ins.id);
  const doc = B.docTokens(text);
  const tk = B.tokensOf(ins, doc);
  const ix = {
    content_id: ins.id, file_url: ins.file_url, title: ins.title, category: ins.category, subcategory: ins.subcategory, profile: ins.profile,
    is_barem: !!cls.isBarem, needs_barem: !cls.isBarem && NEEDS_BAREM_SUBS.has(ins.subcategory),
    tokens: { ...tokensLite(tk), exam: B.examOf(ins) }, describe: B.describeTokens(tk) || null, fp, sha256: it.sha256 || sha256(buf),
    barem_status: cls.isBarem ? 'este_barem' : cls.embedded ? 'inclus' : 'negasit', barem_id: cls.embedded ? ins.id : null, checked_at: nowIso(),
  };
  await supa.from(T.index).upsert(ix, { onConflict: 'content_id' });
  index.push(ix);
  await updItem(ctx, it.id, {
    status: 'publicat', content_id: ins.id, cls, confidence: it.confidence || 'sigur', reasons: it.reasons || [], processed_at: nowIso(),
    sha256: ix.sha256, bytes: buf.length, pair_key: E.pairKey(cls), identity: E.identity(cls),
    ...(it.pages ? { pages: it.pages } : {}), text_head: String(text || '').slice(0, 1500), ...(fp ? { fp } : {}),
  });
  ctx.texts.set(ins.id, text);
  ctx.published.push({ content_id: ins.id, item_id: it.id, row: ins, cls, text, isBarem: !!cls.isBarem });
  ctx.stats.publicate++;
  ctx.log(`📄 publicat: ${title} → ${rub.category === 'bacalaureat' ? `BAC ${E.PROFILES[profile] ? E.PROFILES[profile].label : ''} · ` : 'EN · '}${subcategory}`);
  return ins;
}

// subiectele și baremele publicate în acest pas → legate între ele (sau de cele de pe site)
async function pairPublished(ctx, index) {
  const subs = ctx.published.filter((p) => !p.isBarem && !p.cls.embedded);
  const bars = ctx.published.filter((p) => p.isBarem);
  for (const s of subs) {
    if (ctx.left() < 15000) break;
    const ix = index.find((x) => x.content_id === s.content_id);
    const same = bars.filter((b) => E.pairKey(b.cls) === E.pairKey(s.cls)).map((b) => b.row);
    const fromSite = ix ? compatibleBaremes(index, ix, { max: 8 }).map((x) => ({ id: x.content_id, title: x.title, file_url: x.file_url, category: x.category, profile: x.profile, subcategory: x.subcategory })) : [];
    const cands = [...same, ...fromSite.filter((r) => !same.some((x) => x.id === r.id))];
    for (const b of cands) {
      const v = E.verifyPair({ row: s.row, text: s.text }, { row: b, text: await textOf(ctx, b) });
      if (v.ok) { await associate(ctx, s.row, b, v, 'bot'); ctx.stats.bareme_gasite++; break; }
    }
  }
  // baremele noi pentru subiecte care erau deja pe site, fără barem
  for (const b of bars) {
    if (ctx.left() < 15000) break;
    const bt = B.tokensOf(b.row, B.docTokens(b.text));
    const subjects = index.filter((x) => x.needs_barem && !x.ignored && !BAREM_OK.has(x.barem_status) && x.category === b.row.category
      && (b.row.category !== 'bacalaureat' || x.profile === b.row.profile)
      && !ctx.published.some((p) => p.content_id === x.content_id)
      && !B.tokensContradict({ ...(x.tokens || {}), words: [] }, { ...bt, words: [] }));
    for (const x of subjects.slice(0, 6)) {
      const row = { id: x.content_id, title: x.title, file_url: x.file_url, category: x.category, profile: x.profile, subcategory: x.subcategory };
      const v = E.verifyPair({ row, text: await textOf(ctx, row) }, { row: b.row, text: b.text });
      if (v.ok) { await associate(ctx, row, b.row, v, 'bot'); ctx.stats.bareme_gasite++; }
    }
  }
}

// un singur anunț în clopoțel pentru toate subiectele publicate într-o rulare
async function announce(ctx) {
  if (!ctx.settings.announce) return;
  const subs = ctx.published.filter((p) => !p.isBarem);
  if (!subs.length) return;
  const en = subs.filter((p) => p.row.category === 'evaluare-nationala').length;
  const url = en >= subs.length - en ? '/evaluare-nationala' : `/bacalaureat/${subs.find((p) => p.row.profile)?.row.profile || 'mate-info'}`;
  const titles = subs.slice(0, 3).map((p) => p.row.title.replace(/^Evaluare Națională /, 'EN ').replace(/ — Matematică/, ''));
  // „(cu barem)" doar dacă e adevărat: baremul inclus în PDF sau legat în acest pas
  const cuBarem = subs.filter((p) => p.cls.embedded || (ctx.linked && ctx.linked.has(p.content_id))).length;
  const bar = cuBarem === subs.length ? ' (cu barem)' : cuBarem ? ` (${cuBarem} cu barem)` : '';
  try {
    await ctx.supa.from('ai_broadcasts').insert({
      type: 'material',
      title: `📚 ${subs.length === 1 ? 'Un subiect oficial nou' : `${subs.length} subiecte oficiale noi`}${bar}`,
      body: `${titles.join(' · ')}${subs.length > 3 ? ' …' : ''}`,
      data: { url, botExamene: true, contentIds: subs.map((p) => p.content_id).slice(0, 50) },
    });
  } catch { /* fără anunț */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// 🔍 Baremele lipsă
// ═══════════════════════════════════════════════════════════════════════════
const RELAXED = (S) => ({ ...S, minYear: 1990, isjYears: 50, exams: { en: true, 'mate-info': true, 'stiinte-naturii': true, tehnologic: true } });

// clasificarea unui subiect de pe site (pentru căutări și pentru titlul baremului)
function subjectClass(ctx, row, text) {
  const link = E.classifyLink({ url: row.file_url, text: row.title, pageTitle: `${row.title} ${row.subcategory || ''}` });
  const c = E.decide(link, E.classifyDoc(text), { settings: RELAXED(ctx.settings) }).cls;
  if (row.category === 'bacalaureat' && row.profile) c.profile = row.profile;
  if (row.category === 'evaluare-nationala') c.exam = 'en';
  if (row.category === 'bacalaureat') c.exam = 'bac';
  if (!c.tip) c.tip = row.subcategory === 'simulari' ? 'simulare' : row.subcategory === 'teste-antrenament' ? 'antrenament' : c.variant ? 'sesiune' : null;
  return c;
}

// încearcă un URL candidat la baremul unui subiect → { ok, content? }
async function tryBaremUrl(ctx, cand, subject, sc, index) {
  const r = await ctx.net.file(cand.url);
  if (!r.ok) return { ok: false, why: r.error };
  const pdfs = r.kind === 'zip'
    ? (() => { try { return unzip(r.buf, { filter: (n) => /\.pdf$/i.test(n) }).map((e) => ({ url: `${cand.url}#${e.name}`, name: e.name.split('/').pop(), buf: e.data })); } catch { return []; } })()
    : [{ url: cand.url, name: E.fileNameFromUrl(cand.url), buf: r.buf }];
  for (const f of pdfs) {
    const L0 = E.classifyLink({ url: f.url, text: f.name, pageTitle: cand.pageTitle || '', pageUrl: cand.pageUrl || '' });
    if (L0.lang === 'alta' || (r.kind === 'zip' && !L0.download)) continue;
    let tx;
    try { tx = await PDF().pdfBufferText(f.buf, 40000); } catch { continue; }
    const text = tx.full || tx.text || '';
    if (!text) continue;
    const dec = E.decide(L0, E.classifyDoc(text), { settings: RELAXED(ctx.settings) });
    if (!dec.cls.isBarem) continue;
    const fakeRow = { id: null, title: E.titleFor({ ...dec.cls }) || f.name, file_url: `https://x/${f.name}`, category: subject.row.category, profile: subject.row.profile, subcategory: 'bareme' };
    const v = E.verifyPair(subject, { row: fakeRow, text });
    if (!v.ok) continue;
    // e deja pe site? → doar îl legăm
    const fp = E.fingerprint(text);
    const onSite = sameDocIn(index, { ...dec.cls, exam: subject.row.category === 'evaluare-nationala' ? 'en' : 'bac', isBarem: true }, fp);
    if (onSite) {
      const row = { id: onSite.content_id, title: onSite.title, file_url: onSite.file_url, category: onSite.category, profile: onSite.profile };
      await associate(ctx, subject.row, row, v, 'bot');
      return { ok: true, existed: true, row };
    }
    // nou → îl publicăm la „Bareme", cu felul (sesiune / simulare…) subiectului, apoi îl legăm
    const cls = { ...sc, ...Object.fromEntries(Object.entries(dec.cls).filter(([k, val]) => val !== null && val !== undefined && ['year', 'variant', 'kind', 'profile', 'exam'].includes(k))), isBarem: true, embedded: false };
    if (subject.row.category === 'bacalaureat') cls.profile = subject.row.profile || cls.profile;
    const items = await insertItems(ctx, [{ url: f.url, text: f.name, pageTitle: cand.pageTitle || '', pageUrl: cand.pageUrl || null, pageDate: cand.pageDate || null, source: cand.source || 'cautare' }]);
    const it = items[0] || (await ctx.supa.from(T.items).select('*').eq('url', f.url).maybeSingle()).data;
    if (!it) return { ok: false, why: 'nu am putut salva fișierul găsit' };
    if (!ctx.settings.autoPublish) {
      // publicarea automată e oprită: baremul (verificat) așteaptă adminul în „Găsite de bot";
      // la „Publică", se leagă singur de subiect (pairPublished)
      await updItem(ctx, it.id, {
        status: 'asteptare', confidence: 'sigur', cls, sha256: sha256(f.buf), bytes: f.buf.length, fp, text_head: text.slice(0, 1500),
        pair_key: E.pairKey(cls), identity: E.identity(cls), processed_at: nowIso(),
        reasons: [`baremul subiectului „${subject.row.title}" — verificat (${v.how}); publicarea automată e oprită`],
      });
      return { ok: true, pending: true, row: { id: null, title: E.titleFor(cls) || f.name } };
    }
    const ins = await publish(ctx, { ...it, sha256: sha256(f.buf), confidence: 'sigur', reasons: [`găsit pentru „${subject.row.title}" — ${v.how}`] }, cls, f.buf, text, fp, index);
    await associate(ctx, subject.row, ins, v, 'bot');
    return { ok: true, existed: false, row: ins };
  }
  return { ok: false, why: 'niciun PDF de acolo nu e baremul acestui subiect' };
}

async function findBaremFor(ctx, ix, index, { useAi = false, aiModel = null } = {}) {
  const { supa } = ctx;
  const { data: row } = await supa.from('content').select(CONTENT_COLS).eq('id', ix.content_id).maybeSingle();
  if (!row) return { found: false, note: 'materialul nu mai există' };
  ctx.stats.bareme_cautate++;
  const text = await textOf(ctx, row);
  const note = (status, msg) => supa.from(T.index).update({ search_status: status, searched_at: nowIso(), search_note: String(msg).slice(0, 500) }).eq('content_id', row.id);
  if (!text || text.trim().length < 150) { await note('fara_text', 'PDF fără text (scanat?) — nu pot verifica baremul pe conținut'); return { found: false, note: 'PDF fără text' }; }
  const subject = { row, text };
  const sc = subjectClass(ctx, row, text);
  const ixRow = index.find((x) => x.content_id === row.id) || ix;

  // A) baremele care sunt DEJA pe site (toate cele compatibile, verificate pe conținut)
  for (const c of compatibleBaremes(index, ixRow, { max: 10 })) {
    if (ctx.left() < 25000) break;
    const brow = { id: c.content_id, title: c.title, file_url: c.file_url, category: c.category, profile: c.profile, subcategory: c.subcategory };
    const v = E.verifyPair(subject, { row: brow, text: await textOf(ctx, brow) });
    if (v.ok) { await associate(ctx, row, brow, v, 'bot'); ctx.stats.bareme_gasite++; return { found: true, how: 'site', barem: brow, verdict: v }; }
  }
  // B) online
  const cands = [];
  const addC = (c) => { if (c && c.url && !cands.some((x) => x.url === c.url)) cands.push(c); };
  const orig = B.fileNameOf(row);
  const { data: myItem } = await supa.from(T.items).select('url, page_url, page_title, file_name').eq('content_id', row.id).limit(1);
  const srcItem = myItem && myItem[0];
  const names = [...new Set([...E.baremNameGuesses(orig), ...(srcItem ? E.baremNameGuesses(srcItem.file_name || E.fileNameFromUrl(srcItem.url)) : [])])];
  // B1) numele oficial al baremului, lângă subiect (același folder pe CDN)
  if (srcItem) for (const g of names) for (const u of E.siblingUrlGuesses(srcItem.url.split('#')[0], g)) {
    if (ctx.left() < 30000) break;
    const h = await ctx.net.head(u);
    if (h.ok) addC({ url: h.url || u, pageTitle: srcItem.page_title, pageUrl: srcItem.page_url, source: 'ghicit' });
  }
  // B2) baremele găsite deja de bot (ex. așteaptă verificarea) cu aceeași pereche
  const { data: botBar } = await supa.from(T.items).select('url, page_title, page_url, cls, status').eq('pair_key', E.pairKey(sc)).limit(10);
  for (const b of botBar || []) if (b.cls && b.cls.isBarem && b.status !== 'respins') addC({ url: b.url.split('#')[0], pageTitle: b.page_title, pageUrl: b.page_url, source: 'bot' });
  // B3) căutarea pe edupedu.ro (numele oficial + descrierea)
  if (ctx.settings.sources.edupedu) {
    for (const q of [...names, ...E.baremQueries(sc, '')].slice(0, 4)) {
      if (ctx.left() < 40000 || cands.length >= 8) break;
      const r = await N.edupeduSearch(ctx.net, q, { perPage: 8 });
      for (const a of (r.items || []).slice(0, 4)) {
        if (!E.relevantArticle(a.title)) continue;
        const al = await N.articleLinks(ctx.net, a);
        if (!al.ok) continue;
        for (const l of al.links) {
          if (E.extOf(E.fileNameFromUrl(l.url)) !== 'pdf') continue;
          const L = E.classifyLink({ url: l.url, text: l.text, pageTitle: al.title, pageUrl: al.url });
          if (!L.isBarem || L.lang === 'alta' || (L.year && sc.year && L.year !== String(sc.year))) continue;
          if (sc.exam === 'bac' && L.profileOwn && sc.profile && L.profileOwn !== sc.profile) continue;
          addC({ url: l.url, pageTitle: al.title, pageUrl: al.url, pageDate: al.date, source: 'edupedu' });
        }
      }
    }
  }
  // B4) căutarea web (dacă e configurată)
  if (ctx.settings.sources.cautare && N.searchProvider() && cands.length < 3) {
    for (const q of [...names.map((g) => `"${g}"`), ...E.baremQueries(sc, '')].slice(0, 2)) {
      if (ctx.left() < 40000) break;
      const r = await N.webSearch(ctx.net, q);
      ctx.stats.cautari_web++;
      for (const x of (r.results || []).slice(0, 8)) {
        if (/\.pdf($|\?)/i.test(x.url)) addC({ url: x.url, pageTitle: `${x.title} ${x.snippet}`, source: 'cautare' });
      }
    }
  }
  // B5) AI — doar la cerere (butonul „🤖 Caută cu AI")
  if (useAi) {
    const descriere = [
      `- examenul: ${sc.exam === 'en' ? 'Evaluarea Națională, clasa a VIII-a, Matematică' : `Bacalaureat, Matematică ${E.PROFILES[sc.profile] ? E.PROFILES[sc.profile].cod : ''}`}`,
      `- anul: ${sc.year || 'necunoscut'}`, `- felul: ${sc.tip ? E.TIPURI[sc.tip] : 'necunoscut'}${sc.judet ? ` (${sc.judet})` : ''}${sc.luna ? `, ${sc.luna}` : ''}`,
      `- varianta: ${sc.variant || 'necunoscută'}`, `- titlul de pe site: ${row.title}`, `- numele fișierului: ${orig}`,
      `- începutul subiectului:\n"""${text.slice(0, 700)}"""`,
    ].join('\n');
    try {
      const ai = await N.aiSearch({ ce: 'barem', descriere, model: aiModel || undefined });
      ctx.stats.cautari_ai += ai.searches;
      ctx.stats.cost_usd += ai.costUsd;
      ctx.log(`🤖 AI (${ai.model}): ${ai.searches} căutări, ${ai.proposed.length} linkuri propuse (~${(ai.costUsd * 4.6).toFixed(2).replace('.', ',')} lei)`);
      for (const p of ai.proposed) {
        if (/\.(pdf|zip)($|\?)/i.test(p.url)) addC({ url: p.url, pageTitle: p.why, source: 'ai' });
        else if (ctx.left() > 40000) {
          const al = await N.articleLinks(ctx.net, { link: p.url, title: p.why });
          if (!al.ok) continue;
          for (const l of al.links) {
            if (E.extOf(E.fileNameFromUrl(l.url)) !== 'pdf') continue;
            const L = E.classifyLink({ url: l.url, text: l.text, pageTitle: al.title, pageUrl: al.url });
            if (L.isBarem && L.lang !== 'alta') addC({ url: l.url, pageTitle: al.title, pageUrl: al.url, pageDate: al.date, source: 'ai' });
          }
        }
      }
    } catch (e) {
      ctx.log(`⚠ căutarea cu AI: ${e.message}`);
      if (e.status === 501) { await note('negasit_online', 'AI indisponibil: lipsește ANTHROPIC_API_KEY'); return { found: false, note: e.message }; }
    }
  }
  // C) fiecare candidat: descărcat, clasificat, verificat (titlu, fișier, antet, conținut)
  const tried = [];
  for (const c of cands.slice(0, 10)) {
    if (ctx.left() < 20000) break;
    const r = await tryBaremUrl(ctx, c, subject, sc, index);
    tried.push(`${E.fileNameFromUrl(c.url)}: ${r.ok ? 'potrivit' : r.why}`);
    if (r.ok && r.pending) {
      await note('gasit_asteptare', `găsit online, așteaptă publicarea (Găsite de bot): ${r.row.title}`);
      return { found: true, pending: true, how: 'online', barem: r.row };
    }
    if (r.ok) {
      ctx.stats.bareme_gasite++;
      await note('gasit', `găsit ${r.existed ? 'pe site' : 'online'}: ${r.row.title}`);
      return { found: true, how: r.existed ? 'site' : 'online', barem: r.row };
    }
  }
  const msg = cands.length ? `negăsit online (am încercat ${cands.length}: ${tried.slice(0, 4).join('; ')})` : 'negăsit online (nicio sursă nu are un barem potrivit încă)';
  await note('negasit_online', msg);
  ctx.log(`… fără barem: „${row.title}" — ${msg}`);
  return { found: false, note: msg, tried };
}

async function findMissingStep(ctx, { ids = null, max = null, useAi = false, aiModel = null, force = false } = {}) {
  const index = await loadIndex(ctx.supa);
  const week = Date.now() - 7 * 86400000;
  let list = index.filter((x) => x.needs_barem && !x.ignored && BAREM_LIPSA.includes(x.barem_status));
  if (ids && ids.length) list = index.filter((x) => ids.includes(x.content_id));
  else if (!force) list = list.filter((x) => !x.searched_at || (Date.parse(x.searched_at) || 0) < week);
  list.sort((a, b) => (Date.parse(a.searched_at || 0) || 0) - (Date.parse(b.searched_at || 0) || 0));
  const lim = max == null ? list.length : max;
  const results = [];
  for (const x of list.slice(0, lim)) {
    if (ctx.left() < 45000) break;
    try { results.push({ content_id: x.content_id, title: x.title, ...(await findBaremFor(ctx, x, index, { useAi, aiModel })) }); } catch (e) {
      if (e.code === 'SETUP') throw e;
      ctx.log(`⚠ „${x.title}": ${e.message}`);
      results.push({ content_id: x.content_id, title: x.title, found: false, note: e.message });
    }
  }
  if (ctx.published.length) await announce(ctx);
  return { total: list.length, done: results.length, left: Math.max(0, Math.min(list.length, lim) - results.length), results };
}

// 🔎 Descoperirea (un pas): sursele → fișiere noi → procesate (+ legate)
async function discoverStep(ctx, { phase = 'cauta', now = new Date(), backfillTurn = 0 } = {}) {
  if (phase === 'cauta') {
    const years = discoveryYears(ctx, now, backfillTurn);
    ctx.log(`🔎 caut subiecte și bareme pentru ${years.join(', ')}`);
    const cands = await collect(ctx, { years, now });
    const fresh = await insertItems(ctx, cands);
    ctx.log(`➕ ${fresh.length} fișiere noi de verificat`);
  }
  const r = await processPending(ctx);
  if (ctx.published.length) await announce(ctx);
  return { phase: 'proceseaza', ...r, done: r.left === 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// Raportul și listele pentru Admin
// ═══════════════════════════════════════════════════════════════════════════
async function report(supa) {
  const [setup, settings] = await Promise.all([setupInfo(supa), loadSettings(supa)]);
  const out = {
    setup, settings: settings.value, settingsSetup: settings.setup,
    config: { search: N.searchProvider(), searchLabel: N.SEARCH_LABEL[N.searchProvider()] || null, ai: !!process.env.ANTHROPIC_API_KEY, aiModel: N.AI_MODEL_DEFAULT, cron: !!(process.env.CRON_SECRET || process.env.AI_CRON_SECRET) },
    examYear: E.examYearOf(), hot: E.isHotSeason(),
    counts: null, items: null, runs: [],
  };
  if (!setup.tables) return out;
  const [rows, index] = await Promise.all([loadExamPdfs(supa), loadIndex(supa)]);
  const alive = new Set(rows.map((r) => r.id));
  const ix = index.filter((x) => alive.has(x.content_id));
  const c = { pdfs: rows.length, verificate: ix.length, neverificate: Math.max(0, rows.length - ix.length), subiecte: 0, cuBarem: 0, faraBarem: 0, ambigue: 0, bareme: 0, bareme_orfane: 0, nuNecesita: 0, ignorate: 0, faraText: 0, erori: 0, deLaBot: 0 };
  const used = new Set();
  for (const x of ix) {
    if (x.barem_id && BAREM_OK.has(x.barem_status)) used.add(x.barem_id);
    if (x.is_barem) { c.bareme++; continue; }
    if (!x.needs_barem) { c.nuNecesita++; continue; }
    c.subiecte++;
    if (x.ignored) { c.ignorate++; continue; }
    if (BAREM_OK.has(x.barem_status)) { c.cuBarem++; if (x.barem_status === 'ok_bot') c.deLaBot++; } else if (x.barem_status === 'ambiguu') c.ambigue++;
    else if (x.barem_status === 'fara_text') c.faraText++;
    else if (x.barem_status === 'eroare') c.erori++;
    else c.faraBarem++;
  }
  c.bareme_orfane = ix.filter((x) => x.is_barem && !used.has(x.content_id)).length;
  out.counts = c;
  // fișierele găsite de bot, pe stări
  const st = {};
  const items = await http.allRows((from, to) => supa.from(T.items).select('status, found_at').order('found_at', { ascending: false }).range(from, to), { maxPages: 10 });
  const month = Date.now() - 30 * 86400000;
  for (const r of items) { st[r.status] = (st[r.status] || 0) + 1; }
  out.items = { total: items.length, ...st, noi30: items.filter((r) => (Date.parse(r.found_at) || 0) > month).length };
  const { data: runs } = await supa.from(T.runs).select('id, kind, by, status, started_at, finished_at, stats, cost_usd, note').order('started_at', { ascending: false }).limit(8);
  out.runs = runs || [];
  return out;
}

const LIST_LIMIT = 400;
async function listView(supa, view, { q = '', category = '', profile = '' } = {}) {
  const match = (r) => (!category || r.category === category) && (!profile || r.profile === profile)
    && (!q || B.norm(`${r.title} ${r.describe || ''} ${r.barem_title || ''}`).includes(B.norm(q)));
  if (view === 'gasite') {
    const { data } = await supa.from(T.items).select('id, url, source, page_url, page_title, page_date, link_text, file_name, status, confidence, cls, reasons, content_id, bytes, pages, found_at, processed_at, last_error, text_head')
      .neq('status', 'ignorat').order('found_at', { ascending: false }).limit(LIST_LIMIT);
    return { rows: data || [] };
  }
  if (view === 'ignorate_bot') {
    const { data } = await supa.from(T.items).select('id, url, source, page_url, page_title, file_name, status, reasons, found_at, last_error').eq('status', 'ignorat').order('found_at', { ascending: false }).limit(LIST_LIMIT);
    return { rows: data || [] };
  }
  if (view === 'jurnal') {
    const { data } = await supa.from(T.runs).select('*').order('started_at', { ascending: false }).limit(40);
    return { rows: data || [] };
  }
  const index = await loadIndex(supa);
  const cols = (x) => ({
    content_id: x.content_id, title: x.title, category: x.category, subcategory: x.subcategory, profile: x.profile, describe: x.describe,
    barem_status: x.barem_status, barem_id: x.barem_id, barem_title: x.barem_title, barem_how: x.barem_how, barem_evidence: x.barem_evidence, barem_score: x.barem_score,
    search_status: x.search_status, searched_at: x.searched_at, search_note: x.search_note, ignored: x.ignored, checked_at: x.checked_at, error: x.error, file_url: x.file_url,
  });
  let rows;
  if (view === 'cu') rows = index.filter((x) => x.needs_barem && !x.ignored && BAREM_OK.has(x.barem_status));
  else if (view === 'bareme') {
    const used = new Map();
    for (const x of index) if (x.barem_id && BAREM_OK.has(x.barem_status)) used.set(x.barem_id, (used.get(x.barem_id) || 0) + 1);
    rows = index.filter((x) => x.is_barem).map((x) => ({ ...x, folosit: used.get(x.content_id) || 0 }));
  } else if (view === 'ignorate') rows = index.filter((x) => x.needs_barem && x.ignored);
  else if (view === 'altele') rows = index.filter((x) => !x.is_barem && !x.needs_barem);
  else rows = index.filter((x) => x.needs_barem && !x.ignored && !BAREM_OK.has(x.barem_status));    // 'fara'
  rows = rows.filter(match).sort((a, b) => String(a.title).localeCompare(String(b.title), 'ro', { numeric: true }));
  return { rows: rows.slice(0, LIST_LIMIT).map((x) => ({ ...cols(x), ...(x.folosit !== undefined ? { folosit: x.folosit } : {}) })), total: rows.length };
}

// ─── Acțiunile manuale din Admin ────────────────────────────────────────────
async function baremCandidates(ctx, contentId) {
  const index = await loadIndex(ctx.supa);
  const ix = index.find((x) => x.content_id === contentId);
  const { data: row } = await ctx.supa.from('content').select(CONTENT_COLS).eq('id', contentId).maybeSingle();
  if (!row) throw fail(404, 'Material negăsit.');
  const text = await textOf(ctx, row);
  const subject = { row, text };
  const list = (ix ? compatibleBaremes(index, ix, { max: 15 }) : index.filter((x) => x.is_barem && x.category === row.category).slice(0, 15));
  const out = [];
  for (const c of list) {
    if (ctx.left() < 10000) break;
    const brow = { id: c.content_id, title: c.title, file_url: c.file_url, category: c.category, profile: c.profile, subcategory: c.subcategory };
    const v = E.verifyPair(subject, { row: brow, text: await textOf(ctx, brow) });
    out.push({ id: c.content_id, title: c.title, profile: c.profile, describe: c.describe, ok: v.ok, how: v.how, why: v.why, score: v.score, evidence: v.evidence });
  }
  // celelalte bareme ale examenului (alt an / altă variantă după titlu, fișier și antet) — tot le poate alege adminul
  const rest = index.filter((x) => x.is_barem && x.category === row.category && x.content_id !== row.id
    && (row.category !== 'bacalaureat' || !x.profile || !row.profile || x.profile === row.profile) && !list.includes(x)).slice(0, 40);
  for (const c of rest) out.push({ id: c.content_id, title: c.title, profile: c.profile, describe: c.describe, ok: false, how: null, why: 'alt an / altă variantă / alt fel (după titlu, fișier și antet)', score: null, evidence: null });
  out.sort((a, b) => (b.ok - a.ok) || ((b.score || 0) - (a.score || 0)));
  return { subject: { id: row.id, title: row.title, describe: ix ? ix.describe : null }, candidates: out };
}

async function manualAssociate(ctx, contentId, baremId) {
  const { data: rows } = await ctx.supa.from('content').select(CONTENT_COLS).in('id', [contentId, baremId].filter(Boolean));
  const row = (rows || []).find((r) => r.id === contentId);
  if (!row) throw fail(404, 'Material negăsit.');
  if (!baremId) {
    await PDF().setOverride(ctx.supa, row, null);
    await ctx.supa.from(T.index).update({ barem_status: 'negasit', barem_id: null, barem_title: null, barem_how: null, barem_evidence: null, checked_at: null }).eq('content_id', contentId);
    return { ok: true, unlinked: true };
  }
  const brow = (rows || []).find((r) => r.id === baremId);
  if (!brow || brow.content_type !== 'pdf') throw fail(400, 'Baremul ales nu este un PDF de pe site.');
  const v = E.verifyPair({ row, text: await textOf(ctx, row) }, { row: brow, text: await textOf(ctx, brow) });
  await associate(ctx, row, brow, v, 'admin');
  return { ok: true, verdict: v };
}

async function setIgnored(supa, contentId, on) {
  const { error } = await supa.from(T.index).update({ ignored: !!on }).eq('content_id', contentId);
  if (error) throw fail(500, error.message);
  return { ok: true };
}

// „De verificat" → publicat (cu modificările adminului), respins sau reîncercat
async function itemPublish(ctx, itemId, edits = {}) {
  const { data: it } = await ctx.supa.from(T.items).select('*').eq('id', itemId).maybeSingle();
  if (!it) throw fail(404, 'Fișierul nu mai există în lista botului.');
  if (it.status === 'publicat' && it.content_id) return { ok: true, already: true, content_id: it.content_id };
  const r = await ctx.net.file(it.url.split('#')[0]);
  if (!r.ok) throw fail(502, `Nu am putut descărca fișierul: ${r.error}`);
  let buf = r.buf;
  if (r.kind === 'zip') {
    const name = it.url.includes('#') ? it.url.slice(it.url.indexOf('#') + 1) : null;
    const e = unzip(r.buf, { filter: (n) => n === name })[0];
    if (!e) throw fail(404, 'Fișierul nu mai e în arhivă.');
    buf = e.data;
  }
  const tx = await PDF().pdfBufferText(buf, 40000).catch(() => ({ full: '' }));
  const text = tx.full || tx.text || '';
  const cls = { ...(it.cls || {}) };
  for (const k of ['exam', 'year', 'profile', 'tip', 'variant', 'luna', 'judet', 'scope']) if (edits[k] !== undefined) cls[k] = edits[k] === '' ? null : edits[k];
  if (edits.isBarem !== undefined) cls.isBarem = !!edits.isBarem;
  if (!E.rubricFor(cls)) throw fail(400, 'Alege examenul (și profilul, la BAC) înainte de publicare.');
  const index = await loadIndex(ctx.supa);
  const ins = await publish(ctx, { ...it, confidence: it.confidence || 'nesigur' }, cls, buf, text, text ? E.fingerprint(text) : null, index, { edits });
  await pairPublished(ctx, index);
  await announce(ctx);   // un subiect publicat manual se anunță la fel (un barem, nu)
  return { ok: true, content_id: ins.id, title: ins.title };
}
async function itemSetStatus(supa, itemId, status) {
  const patch = status === 'nou' ? { status: 'nou', attempts: 0, last_error: null } : { status };
  const { error } = await supa.from(T.items).update({ ...patch, updated_at: nowIso() }).eq('id', itemId);
  if (error) throw fail(500, error.message);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════════════════════
// Cronul (vercel.json: la 2 ore) — singur, pe felii
// ═══════════════════════════════════════════════════════════════════════════
async function cron(supa, { now = new Date(), budgetMs = 640000 } = {}) {
  const t0 = Date.now();
  const st = await loadSettings(supa);
  if (!st.value.enabled) return { ok: true, skipped: 'oprit din setări' };
  const setup = await setupInfo(supa);
  if (!setup.tables) return { ok: false, skipped: SETUP_HINT };
  const S = st.value;
  const rest = () => budgetMs - (Date.now() - t0);
  // un pas al cronului = o rulare în jurnal; dacă botul lucrează deja (pornit din Admin), pasul se sare
  const step = async (kind, ms, fn) => {
    if (rest() < 60000) return { sarit: 'fără timp' };
    let run;
    try { run = await startRun(supa, { kind, by: 'cron' }); } catch (e) { return { sarit: e.message }; }
    const ctx = makeCtx(supa, S, { budgetMs: Math.min(ms, rest() - 10000), by: 'cron' });
    try { const r = await fn(ctx); await saveRun(supa, run, ctx, { final: true }); return r; } catch (e) {
      ctx.log(`⚠ ${e.message}`);
      await saveRun(supa, run, ctx, { final: true, status: 'eroare' });
      return { eroare: e.message };
    }
  };
  // a venit vremea căutării online? (zilnic; în perioadele de examen, la câteva ore)
  const { data: last } = await supa.from(T.runs).select('started_at').eq('kind', 'descoperire').in('status', ['ok', 'ruleaza']).eq('note', 'cautare').order('started_at', { ascending: false }).limit(1);
  const lastAt = last && last[0] ? Date.parse(last[0].started_at) || 0 : 0;
  const every = (E.isHotSeason(now) ? S.seasonHours : S.intervalHours) * 3600000;
  const due = Date.now() - lastAt >= every - 5 * 60000;
  const out = { ok: true, due };
  // 1) indexul: materialele noi / schimbate de pe site
  out.verificare = await step('verificare', 150000, (ctx) => verifyStep(ctx));
  // 2) căutarea online + publicarea (sau doar fișierele rămase neprocesate)
  const { count: nou } = await supa.from(T.items).select('id', { head: true, count: 'exact' }).eq('status', 'nou');
  if (due || nou) {
    const { count: runde } = await supa.from(T.runs).select('id', { head: true, count: 'exact' }).eq('kind', 'descoperire');
    out.descoperire = await step('descoperire', 330000, async (ctx) => {
      const r = await discoverStep(ctx, { phase: due ? 'cauta' : 'proceseaza', now, backfillTurn: runde || 0 });
      if (due) await supa.from(T.runs).update({ note: 'cautare' }).eq('status', 'ruleaza').eq('kind', 'descoperire').eq('by', 'cron');
      return r;
    });
  }
  // 3) baremele lipsă (câteva pe rulare, fără AI)
  if (S.maxBaremSearchPerRun > 0) out.bareme = await step('bareme', 200000, (ctx) => findMissingStep(ctx, { max: S.maxBaremSearchPerRun }));
  out.ms = Date.now() - t0;
  return out;
}

module.exports = {
  T, SETTINGS_KEY, EXAM_CATS, NEEDS_BAREM_SUBS, BAREM_OK, SETUP_HINT,
  loadSettings, saveSettings, setupInfo, newStats, mergeStats, makeCtx, setNetFactory, startRun, saveRun,
  loadExamPdfs, loadIndex, needsBarem, textOf, indexOne, verifyStep,
  associate, compatibleBaremes, insertItems, preFilter, collect, discoveryYears, processPdf, processZip, processItem, processPending,
  publish, pairPublished, announce, subjectClass, tryBaremUrl, findBaremFor, findMissingStep, discoverStep,
  report, listView, baremCandidates, manualAssociate, setIgnored, itemPublish, itemSetStatus, cron,
};
