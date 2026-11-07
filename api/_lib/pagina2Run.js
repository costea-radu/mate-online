// =====================================================================
// api/_lib/pagina2Run.js — ⬜ BOTUL „ALB PESTE DREPTUNGHIUL DE PE PAGINA 2" (testele de EN)
//
// Cererea lui Radu (7 nov. 2026): „fă cât mai simplu: lipește un dreptunghi alb peste
// dreptunghiul negru și păstrează spațiu gol alb acolo. Pune în bară buton «original»
// care se schimbă în «fără suprafață neagră», pentru a accesa ambele variante."
// (Prima versiune, din 6–7 nov., scria PDF-ul curățat PESTE original, în aceeași
// cale, apoi îl descărca să-l verifice — și cache-ul Storage dădea înapoi fișierul
// vechi: „fișierul urcat nu se potrivește la verificare".)
//
// Testele: Evaluare Națională → „Variante date + modele" și „Simulări" (PDF).
// Pentru fiecare test (o singură dată; din nou doar dacă i se înlocuiește fișierul):
//   1. descarcă PDF-ul din Storage (cu service role);
//   2. motorul (api/_lib/pagina2.js) găsește dreptunghiul și lipește alb peste el,
//      pe o copie; verifică prin randare că în rest nu s-a schimbat nimic;
//   3. copia („varianta albă") se urcă ÎN ALT LOC, în același bucket:
//      `_pagina2-alb/<id>/<amprenta>_<nume>.pdf` — o cale nouă de fiecare dată
//      (amprenta în nume), deci nu se scrie niciodată peste nimic;
//   4. ORIGINALUL RĂMÂNE NEATINS, la adresa lui (file_url): rândul din `content`
//      (titlu, rubrică, gratuit / premium, ordine) și baremul asociat (ai_pdf_text)
//      nu se schimbă.
// Vizualizatorul PDF deschide varianta albă, cu butonul „⬛ Original" / „⬜ Fără
// suprafață neagră" în bară (api/get-file-url.js → api/_lib/pagina2Alb.js).
// Starea fiecărui test: app_settings 'pagina2:<content_id>' (fără SQL nou).
// Setarea (cronul îl rulează singur sau nu): app_settings 'pagina2' = { auto }.
//
// Rulările (cronul, butoanele din Admin) trec prin aceeași evidență ca botul de
// examene (exam_bot_runs, kind 'pagina2'): același „lacăt", același jurnal.
// =====================================================================
'use strict';

const crypto = require('node:crypto');
const http = require('./http');
const SET = require('./settings');
const P2 = require('./pagina2');
const ALB = require('./pagina2Alb');

const SETTINGS_KEY = 'pagina2';
const { STATE_PREFIX, CATEGORY, SUBCATS, ALB_DIR } = ALB;
const CONTENT_BUCKETS = ['content-files', 'content-files-free'];
const ERR_LIMIT = 300;                          // erori MuPDF pe o instanță, înainte de una nouă (vezi pagina2.js)
const MAX_ATTEMPTS = 3;                         // „eroare" se reîncearcă de cel mult atâtea ori (apoi o dată pe zi)
const COLS = 'id, title, category, subcategory, content_type, file_url, is_free, created_at';

const nowIso = () => new Date().toISOString();
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
function fail(status, message, code = null) { const e = new Error(message); e.status = status; if (code) e.code = code; return e; }
const errMsg = (e) => (e && e.message ? e.message : String(e));

// ─── setări ──────────────────────────────────────────────────────────────────
const normSettings = (v) => ({ auto: !(v && typeof v === 'object' && v.auto === false) });
async function loadSettings(supa) {
  try { const r = await SET.readSetting(supa, SETTINGS_KEY); return { setup: r.setup, value: normSettings(r.value) }; } catch { return { setup: false, value: normSettings(null) }; }
}
async function saveSettings(supa, value, userId = null) {
  const v = normSettings(value);
  await SET.writeSetting(supa, SETTINGS_KEY, v, userId);
  return v;
}

// ─── testele și starea lor ──────────────────────────────────────────────────
const isTest = ALB.isEnTest;
async function loadTests(supa, ids = null) {
  let rows;
  if (ids && ids.length) {
    const { data, error } = await supa.from('content').select(COLS).in('id', ids);
    if (error) throw fail(500, error.message);
    rows = data || [];
  } else {
    rows = await http.allRows((from, to) => supa.from('content').select(COLS)
      .eq('category', CATEGORY).eq('content_type', 'pdf').in('subcategory', SUBCATS).order('created_at', { ascending: true }).range(from, to));
  }
  return rows.filter(isTest);
}
async function loadStates(supa, ids) {
  const map = new Map();
  if (!ids.length) return map;
  const rows = await http.inBatches(ids.map((id) => STATE_PREFIX + id), (keys, from, to) => supa.from(SET.TABLE).select('key, value').in('key', keys).range(from, to));
  for (const r of rows) if (r && r.value && typeof r.value === 'object') map.set(String(r.key).slice(STATE_PREFIX.length), r.value);
  return map;
}
const saveState = (supa, id, st) => SET.writeSetting(supa, STATE_PREFIX + id, st);

// Ce mai e de făcut la un test (pentru același fișier: o singură dată)
//   dry — „🔍 Caută (fără modificări)": testele încă neverificate
function needsWork(row, st, { force = false, dry = false, now = Date.now() } = {}) {
  if (force) return true;
  if (!st || st.file_url !== row.file_url) return true;              // nou / fișier înlocuit din Admin
  if ((st.v || 0) < P2.VERSION) return true;                         // starea versiunii vechi a botului (scria peste original)
  if (st.v1 && !dry) return true;                                    // originalul încă de pus la loc (după o căutare „fără modificări")
  if (st.status === 'eroare') {
    const t = Date.parse(st.at) || 0;
    return (st.attempts || 0) < MAX_ATTEMPTS || now - t > 86400000;
  }
  if (st.status === 'de_curatat') return !dry;
  return false;                                                       // curatat · fara · nesigur
}

// ─── motorul (o instanță MuPDF, înlocuită după o cădere / prea multe erori) ──
let inst = null;   // { mupdf, errBase }
async function engine(ctx, { fresh = false } = {}) {
  if (!inst || fresh || P2.mupdfErrors() - inst.errBase > ERR_LIMIT) {
    if (inst && ctx) ctx.log('♻ MuPDF: pornesc o instanță nouă');
    inst = { mupdf: await P2.loadMupdf({ fresh: !!inst || fresh }), errBase: P2.mupdfErrors() };
  }
  return inst.mupdf;
}
async function albBytes(ctx, buf) {
  let r = P2.albPage2(await engine(ctx), buf);
  if (r.status === 'eroare' && P2.isWasmCrash(r.error)) {
    ctx.log('♻ MuPDF a căzut — reiau fișierul cu o instanță nouă');
    r = P2.albPage2(await engine(ctx, { fresh: true }), buf);
  }
  return r;
}

// ─── Storage ─────────────────────────────────────────────────────────────────
function locate(row) {
  let loc;
  try { loc = http.parseStoragePath(row.file_url); } catch { throw fail(400, 'adresa fișierului nu e din Storage'); }
  if (!CONTENT_BUCKETS.includes(loc.bucket)) throw fail(400, `fișierul e în alt bucket („${loc.bucket}")`);
  return loc;
}
async function download(supa, bucket, path) {
  const { data, error } = await supa.storage.from(bucket).download(path);
  if (error || !data) throw new Error(`nu am putut descărca fișierul (${error ? error.message : 'gol'})`);
  return new Uint8Array(await data.arrayBuffer());
}
async function upload(supa, bucket, path, bytes, { upsert }) {
  const { error } = await supa.storage.from(bucket).upload(path, Buffer.from(bytes), { contentType: 'application/pdf', upsert, cacheControl: '3600' });
  return error || null;
}
const baseName = (p) => String(p).split('/').pop() || 'test.pdf';
const pick = (r) => ({ rect: r.rect || null, box: r.box || null, notes: r.notes && r.notes.length ? r.notes : null, pages: r.pages || null, incremental: r.incremental === undefined ? null : !!r.incremental });

// 🔙 Versiunea veche a botului (6–7 nov.) urca PDF-ul curățat PESTE original (și
// putea reuși la o rulare a cronului de dinaintea actualizării). Dacă fișierul de
// acum e cel scris de ea, punem la loc originalul din copia ei privată
// (`content-files/_pagina2-originale/<id>/…`): „⬛ Original" din vizualizator trebuie
// să fie chiar originalul. Datele ei — { backup, sha_after, sha_bad } — vin din
// starea veche (v1) sau, după o căutare „fără modificări", din `v1` al stării noi.
function legacyOf(prev) {
  if (!prev) return null;
  if (prev.v1 && prev.v1.backup) return prev.v1;
  if ((prev.v || 0) < 2 && prev.backup) return { backup: prev.backup, sha_after: prev.sha_after || null, sha_bad: prev.sha_bad || null };
  return null;
}
function writtenByV1(v1, sha) {
  return !!(v1 && v1.backup && v1.backup.sha && v1.backup.sha !== sha && [v1.sha_after, v1.sha_bad].filter(Boolean).includes(sha));
}
async function v1Original(ctx, v1) {
  const orig = await download(ctx.supa, v1.backup.bucket, v1.backup.path);
  if (sha256(orig) !== v1.backup.sha) throw new Error('copia originalului (de la versiunea veche a botului) nu mai e întreagă — nu am atins testul');
  return orig;
}
async function restoreV1Original(ctx, row, loc, v1) {
  const orig = await v1Original(ctx, v1);
  const { data: cur } = await ctx.supa.from('content').select('id, file_url').eq('id', row.id).maybeSingle();
  if (!cur || cur.file_url !== row.file_url) throw new Error('fișierul testului s-a schimbat între timp — îl iau la rularea următoare');
  const err = await upload(ctx.supa, loc.bucket, loc.filePath, orig, { upsert: true });
  if (err) throw new Error(`nu am putut pune originalul la loc (${err.message || err})`);
  ctx.stats.p2_originale = (ctx.stats.p2_originale || 0) + 1;
  ctx.log(`↩ „${row.title}": am pus la loc originalul (versiunea veche a botului scrisese peste el)`);
  return orig;
}

// ─── un test ─────────────────────────────────────────────────────────────────
async function processOne(ctx, row, prev, { dry = false } = {}) {
  const { supa } = ctx;
  const base = { v: P2.VERSION, file_url: row.file_url, at: nowIso(), by: ctx.by || 'admin' };
  const stats = ctx.stats;
  stats.p2_verificate = (stats.p2_verificate || 0) + 1;
  const same = !!(prev && prev.file_url === row.file_url);
  // alegerea adminului („🙈 Ascunde varianta albă") rămâne
  const keep = same && prev.hidden ? { hidden: true, hidden_at: prev.hidden_at || null, hidden_by: prev.hidden_by || null } : {};
  const v1 = same ? legacyOf(prev) : null;
  // cât nu știm că la adresa testului e originalul, datele versiunii vechi rămân în stare
  let pending = v1 ? { v1 } : {};
  const saveErr = async (message, extra = {}) => {
    stats.p2_erori = (stats.p2_erori || 0) + 1;
    const attempts = (same && prev.status === 'eroare' && (prev.v || 0) >= P2.VERSION ? prev.attempts || 0 : 0) + 1;
    const st = { ...base, ...keep, ...pending, ...extra, status: 'eroare', error: String(message).slice(0, 300), attempts };
    await saveState(supa, row.id, st);
    ctx.log(`⚠ „${row.title}": ${message}`);
    return st;
  };
  let loc, buf;
  try { loc = locate(row); buf = await download(supa, loc.bucket, loc.filePath); } catch (e) { return saveErr(errMsg(e)); }
  let sha = sha256(buf);
  if (writtenByV1(v1, sha)) {
    if (dry) {
      // „fără modificări": analizăm originalul din copie, fără să scriem ceva (rularea adevărată îl pune la loc)
      try { buf = await v1Original(ctx, v1); } catch (e) { return saveErr(errMsg(e)); }
    } else {
      try { buf = await restoreV1Original(ctx, row, loc, v1); } catch (e) { return saveErr(errMsg(e)); }
      pending = {};
    }
    sha = v1.backup.sha;
  } else pending = {};                 // la adresa testului e originalul
  // are deja varianta albă a ACESTUI original → nimic de făcut
  if (same && (prev.v || 0) >= P2.VERSION && prev.status === 'curatat' && prev.sha_before === sha && prev.alb) {
    ctx.log(`= „${row.title}": are deja varianta albă`);
    return prev;
  }
  const t0 = Date.now();
  const r = await albBytes(ctx, buf);
  const ms = Date.now() - t0;
  const info = { ...pick(r), sha_before: sha, bytes_before: buf.length, ms };
  if (r.status === 'fara') {
    stats.p2_fara = (stats.p2_fara || 0) + 1;
    const st = { ...base, ...pending, status: 'fara', ...info };
    await saveState(supa, row.id, st);
    ctx.log(`· „${row.title}": pagina 2 nu are dreptunghiul negru${r.notes && r.notes.length ? ` (${r.notes.join('; ')})` : ''}`);
    return st;
  }
  if (r.status === 'nesigur') {
    stats.p2_nesigure = (stats.p2_nesigure || 0) + 1;
    const st = { ...base, ...keep, ...pending, status: 'nesigur', ...info, error: r.error || null };
    await saveState(supa, row.id, st);
    ctx.log(`⚠ „${row.title}": am găsit dreptunghiul, dar albul nu iese curat (${r.error}) — rămâne doar originalul`);
    return st;
  }
  if (r.status !== 'curatat' || !r.bytes) return saveErr(r.error || 'motorul nu a întors fișierul');

  if (dry) {
    stats.p2_de_curatat = (stats.p2_de_curatat || 0) + 1;
    const st = { ...base, ...keep, ...pending, status: 'de_curatat', ...info, bytes_after: r.bytes.length };
    await saveState(supa, row.id, st);
    ctx.log(`🔍 „${row.title}": dreptunghi găsit — se poate acoperi cu alb`);
    return st;
  }

  // varianta albă: o cale NOUĂ (amprenta ei în nume), în bucket-ul originalului
  const shaAlb = sha256(r.bytes);
  const alb = { bucket: loc.bucket, path: `${ALB_DIR}/${row.id}/${shaAlb.slice(0, 12)}_${baseName(loc.filePath)}`, sha: shaAlb, bytes: r.bytes.length, at: nowIso() };
  const upErr = await upload(supa, alb.bucket, alb.path, r.bytes, { upsert: false });
  if (upErr && !/exist|duplicate|already/i.test(String(upErr.message || upErr))) return saveErr(`urcarea variantei albe a eșuat (${upErr.message || upErr}) — originalul a rămas neatins`);
  stats.p2_curatate = (stats.p2_curatate || 0) + 1;
  const st = { ...base, ...keep, status: 'curatat', ...info, alb, bytes_after: r.bytes.length };
  await saveState(supa, row.id, st);
  // varianta albă de dinainte (alt fișier / alt bucket) nu mai folosește la nimic
  if (prev && prev.alb && (prev.alb.bucket !== alb.bucket || prev.alb.path !== alb.path)) {
    try { await supa.storage.from(prev.alb.bucket).remove([prev.alb.path]); } catch { /* rămâne un fișier în plus, nefolosit */ }
  }
  ctx.log(`⬜ „${row.title}": varianta fără suprafața neagră e gata (alb peste dreptunghi; originalul rămâne)`);
  return st;
}

// ─── un pas (cronul / butoanele din Admin) ──────────────────────────────────
async function cleanStep(ctx, { ids = null, force = false, dry = false, max = null } = {}) {
  const rows = await loadTests(ctx.supa, ids);
  const states = await loadStates(ctx.supa, rows.map((r) => r.id));
  const todo = rows.filter((r) => needsWork(r, states.get(r.id), { force: force && !!ids, dry }));
  let done = 0;
  const results = [];
  for (const r of todo) {
    if (ctx.left() < 30000) break;
    if (max && done >= max) break;
    let st;
    try { st = await processOne(ctx, r, states.get(r.id), { dry }); } catch (e) { ctx.log(`⚠ „${r.title}": ${errMsg(e)}`); st = null; }
    results.push({ id: r.id, status: st ? st.status : null });
    done++;
  }
  if (!todo.length) ctx.log(dry ? '🔍 nimic nou de căutat: toate testele au fost deja verificate' : '⬜ nimic de făcut: toate testele sunt deja verificate');
  return { total: rows.length, todo: todo.length, done, left: Math.max(0, todo.length - done), results };
}

// cronul: doar dacă e pornit din setări și are ce face (altfel nu lasă nicio urmă în jurnal)
async function cronStep(supa, step) {
  const st = await loadSettings(supa);
  if (!st.value.auto) return { sarit: 'oprit din setări' };
  const rows = await loadTests(supa);
  const states = await loadStates(supa, rows.map((r) => r.id));
  const todo = rows.filter((r) => needsWork(r, states.get(r.id))).length;
  if (!todo) return { nimic: true, total: rows.length };
  return step('pagina2', 150000, (ctx) => cleanStep(ctx, {}));
}

// ─── raportul (Admin) ────────────────────────────────────────────────────────
async function status(supa) {
  const [settings, rows] = await Promise.all([loadSettings(supa), loadTests(supa)]);
  const states = await loadStates(supa, rows.map((r) => r.id));
  const counts = { total: rows.length, curatat: 0, ascuns: 0, fara: 0, nesigur: 0, eroare: 0, de_curatat: 0, neverificat: 0 };
  const list = rows.map((r) => {
    let st = states.get(r.id) || null;
    if (st && (st.file_url !== r.file_url || (st.v || 0) < P2.VERSION)) st = null;   // fișier înlocuit / starea versiunii vechi: încă neverificat
    let s = st ? st.status : 'neverificat';
    if (s === 'curatat' && st.hidden) s = 'ascuns';
    counts[s] = (counts[s] || 0) + 1;
    return {
      id: r.id, title: r.title, subcategory: r.subcategory, is_free: !!r.is_free, created_at: r.created_at,
      status: s, at: st ? st.at : null, by: st ? st.by : null,
      rect: st ? st.rect || null : null, box: st ? st.box || null : null, notes: st ? st.notes || null : null, error: st ? st.error || null : null,
      bytes_before: st ? st.bytes_before || null : null, bytes_after: st ? st.bytes_after || null : null,
      alb: !!(st && st.alb), hidden: !!(st && st.hidden),
    };
  });
  return { settings: settings.value, settingsSetup: settings.setup, version: P2.VERSION, counts, rows: list };
}

// ─── 🙈 ascunde / 👁 arată varianta albă (vizualizatorul arată atunci doar originalul) ─
async function hide(supa, contentId, on = true, { userId = null } = {}) {
  const { data: row } = await supa.from('content').select(COLS).eq('id', contentId).maybeSingle();
  if (!row) throw fail(404, 'Testul nu mai există.');
  const st = (await loadStates(supa, [contentId])).get(contentId);
  if (!st || (st.v || 0) < P2.VERSION || st.file_url !== row.file_url || !st.alb) throw fail(404, 'Testul n-are încă varianta albă.');
  const next = { ...st, hidden: !!on, hidden_at: on ? nowIso() : null, hidden_by: on ? userId || null : null };
  await saveState(supa, contentId, next);
  return { ok: true, hidden: !!on };
}

// linkul (semnat, 10 minute) la original sau la varianta albă
async function link(supa, contentId, which = 'original') {
  const { data: row } = await supa.from('content').select(COLS).eq('id', contentId).maybeSingle();
  if (!row || !row.file_url) throw fail(404, 'Testul nu mai există.');
  if (which === 'alb') {
    const st = (await loadStates(supa, [contentId])).get(contentId);
    const a = st && (st.v || 0) >= P2.VERSION && st.file_url === row.file_url ? st.alb : null;
    if (!a) throw fail(404, 'Testul n-are încă varianta albă.');
    const { data, error } = await supa.storage.from(a.bucket).createSignedUrl(a.path, 600);
    if (error || !data || !data.signedUrl) throw fail(500, 'Nu am putut face linkul.');
    return { url: data.signedUrl };
  }
  return { url: await http.signedUrlFromPublic(supa, row.file_url, 600) };
}

module.exports = {
  SETTINGS_KEY, STATE_PREFIX, CATEGORY, SUBCATS, ALB_DIR, MAX_ATTEMPTS,
  loadSettings, saveSettings, normSettings, loadTests, loadStates, needsWork, processOne, cleanStep, cronStep, status, hide, link,
  _reset: () => { inst = null; },
};
