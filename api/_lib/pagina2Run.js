// =====================================================================
// api/_lib/pagina2Run.js — 🧽 BOTUL „DREPTUNGHIUL DE PE PAGINA 2" (testele de EN)
//
// Cererea lui Radu (6 nov. 2026): „La testele de evaluare națională, fă un bot
// care scoate dreptunghiul negru de pe pagina 2, în rest nu schimba nimic.
// Repostează în același loc testul, cu același nume, proprietăți și barem asociat."
//
// Testele: Evaluare Națională → „Variante date + modele" și „Simulări" (PDF).
// Pentru fiecare test (o singură dată; din nou doar dacă i se înlocuiește fișierul):
//   1. descarcă PDF-ul din Storage (cu service role);
//   2. motorul (api/_lib/pagina2.js) caută și scoate dreptunghiul, salvează
//      incremental și verifică prin randare că în rest nu s-a schimbat nimic;
//   3. copia ORIGINALULUI → content-files (privat) / _pagina2-originale/<id>/…
//      (pentru „↩ Restaurează"; se păstrează mereu);
//   4. PDF-ul curățat se urcă PESTE cel vechi, în aceeași cale din Storage →
//      adresa (file_url) rămâne aceeași, deci rândul din `content` (titlul,
//      rubrica, gratuit / premium, ordinea, data) NU se atinge, iar baremul
//      asociat (ai_pdf_text, legat de content_id + file_url) rămâne același;
//   5. îl descarcă din nou și compară amprenta (SHA-256) cu ce a urcat.
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

const SETTINGS_KEY = 'pagina2';
const STATE_PREFIX = 'pagina2:';
const CATEGORY = 'evaluare-nationala';
const SUBCATS = ['variante', 'simulari'];
const CONTENT_BUCKETS = ['content-files', 'content-files-free'];
const BACKUP_BUCKET = 'content-files';          // privat: originalele nu sunt publice
const BACKUP_DIR = '_pagina2-originale';
const ERR_LIMIT = 300;                          // erori MuPDF pe o instanță, înainte de una nouă (vezi pagina2.js)
const MAX_ATTEMPTS = 3;                         // „eroare" se reîncearcă de cel mult atâtea ori (apoi o dată pe zi)
const COLS = 'id, title, category, subcategory, content_type, file_url, is_free, created_at';

const nowIso = () => new Date().toISOString();
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const kb = (n) => `${Math.round(n / 102.4) / 10} KB`;
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
const isTest = (r) => !!r && r.category === CATEGORY && r.content_type === 'pdf' && SUBCATS.includes(r.subcategory) && !!r.file_url;
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
  if (st.status === 'eroare') {
    const t = Date.parse(st.at) || 0;
    return (st.attempts || 0) < MAX_ATTEMPTS || now - t > 86400000;
  }
  if (st.status === 'fara' || st.status === 'nesigur') return (st.v || 0) < P2.VERSION;   // motorul s-a schimbat
  if (st.status === 'de_curatat') return !dry;
  return false;                                                       // curatat · restaurat
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
async function cleanBytes(ctx, buf) {
  let r = P2.cleanPage2(await engine(ctx), buf);
  if (r.status === 'eroare' && P2.isWasmCrash(r.error)) {
    ctx.log('♻ MuPDF a căzut — reiau fișierul cu o instanță nouă');
    r = P2.cleanPage2(await engine(ctx, { fresh: true }), buf);
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

// copia originalului (o dată; numele are amprenta, deci aceeași copie se refolosește)
async function backupOriginal(supa, row, loc, buf, sha, prev) {
  if (prev && prev.backup && prev.backup.sha === sha) return prev.backup;
  const path = `${BACKUP_DIR}/${row.id}/${sha.slice(0, 12)}_${baseName(loc.filePath)}`;
  const err = await upload(supa, BACKUP_BUCKET, path, buf, { upsert: false });
  if (err && !/exist|duplicate|already/i.test(String(err.message || err))) throw new Error(`copia originalului nu s-a salvat (${err.message || err})`);
  const back = await download(supa, BACKUP_BUCKET, path);
  if (sha256(back) !== sha) throw new Error('copia originalului nu se potrivește cu fișierul (nu am atins testul)');
  return { bucket: BACKUP_BUCKET, path, sha, bytes: buf.length, at: nowIso() };
}

// ─── un test ─────────────────────────────────────────────────────────────────
const KIND_RO = { vector: 'desen', subpaths: 'bucăți de desen', image: 'imagine', mask: 'mască', inline: 'imagine inline', form: 'formular', overlay: 'alb peste scanare', hidden: 'ce era sub el rămâne ascuns' };
const kindsText = (k) => Object.entries(k || {}).filter(([, n]) => n).map(([key, n]) => (key === 'hidden' ? KIND_RO.hidden : `${KIND_RO[key] || key}${n > 1 ? ` ×${n}` : ''}`)).join(', ');
const pick = (r) => ({ rect: r.rect || null, kinds: r.kinds || null, overlay: r.overlay || null, notes: r.notes && r.notes.length ? r.notes : null, pages: r.pages || null, incremental: r.incremental === undefined ? null : !!r.incremental });

async function processOne(ctx, row, prev, { dry = false } = {}) {
  const { supa } = ctx;
  const base = { v: P2.VERSION, file_url: row.file_url, at: nowIso(), by: ctx.by || 'admin' };
  const stats = ctx.stats;
  stats.p2_verificate = (stats.p2_verificate || 0) + 1;
  const keepBackup = prev && prev.file_url === row.file_url && prev.backup ? { backup: prev.backup } : {};
  const saveErr = async (message, extra = {}) => {
    stats.p2_erori = (stats.p2_erori || 0) + 1;
    const attempts = (prev && prev.status === 'eroare' && prev.file_url === row.file_url ? prev.attempts || 0 : 0) + 1;
    const st = { ...base, ...keepBackup, ...extra, status: 'eroare', error: String(message).slice(0, 300), attempts };
    await saveState(supa, row.id, st);
    ctx.log(`⚠ „${row.title}": ${message}`);
    return st;
  };
  let loc, buf;
  try { loc = locate(row); buf = await download(supa, loc.bucket, loc.filePath); } catch (e) { return saveErr(errMsg(e)); }
  const sha = sha256(buf);
  // fișierul e chiar cel curățat de noi → nimic de făcut (nu-l „curățăm" a doua oară)
  if (prev && prev.status === 'curatat' && prev.file_url === row.file_url && prev.sha_after === sha) {
    ctx.log(`= „${row.title}": e deja curățat`);
    return prev;
  }
  const t0 = Date.now();
  const r = await cleanBytes(ctx, buf);
  const ms = Date.now() - t0;
  if (r.status === 'fara') {
    stats.p2_fara = (stats.p2_fara || 0) + 1;
    const st = { ...base, ...keepBackup, status: 'fara', ...pick(r), sha_before: sha, bytes_before: buf.length, ms };
    await saveState(supa, row.id, st);
    ctx.log(`· „${row.title}": pagina 2 nu are dreptunghiul negru${r.notes && r.notes.length ? ` (${r.notes.join('; ')})` : ''}`);
    return st;
  }
  if (r.status === 'nesigur') {
    stats.p2_nesigure = (stats.p2_nesigure || 0) + 1;
    const st = { ...base, ...keepBackup, status: 'nesigur', ...pick(r), error: r.error || null, sha_before: sha, bytes_before: buf.length, ms };
    await saveState(supa, row.id, st);
    ctx.log(`⚠ „${row.title}": am găsit dreptunghiul, dar nu-l pot scoate sigur (${r.error}) — testul rămâne neatins`);
    return st;
  }
  if (r.status !== 'curatat' || !r.bytes) return saveErr(r.error || 'motorul nu a întors fișierul');

  if (dry) {
    stats.p2_de_curatat = (stats.p2_de_curatat || 0) + 1;
    const st = { ...base, ...keepBackup, status: 'de_curatat', ...pick(r), sha_before: sha, bytes_before: buf.length, bytes_after: r.bytes.length, ms };
    await saveState(supa, row.id, st);
    ctx.log(`🔍 „${row.title}": dreptunghi găsit (${kindsText(r.kinds)}) — se poate scoate (${kb(r.bytes.length - buf.length)} în plus)`);
    return st;
  }

  // copia originalului, apoi fișierul nou PESTE cel vechi (aceeași cale)
  let backup;
  try { backup = await backupOriginal(supa, row, loc, buf, sha, prev); } catch (e) { return saveErr(errMsg(e)); }
  // între timp, adminul a înlocuit fișierul testului? → nu scriem peste
  const { data: cur } = await supa.from('content').select('id, file_url').eq('id', row.id).maybeSingle();
  if (!cur || cur.file_url !== row.file_url) { ctx.log(`= „${row.title}": fișierul s-a schimbat între timp — îl iau la rularea următoare`); return prev || null; }
  const shaAfter = sha256(r.bytes);
  const upErr = await upload(supa, loc.bucket, loc.filePath, r.bytes, { upsert: true });
  if (upErr) return saveErr(`urcarea fișierului curățat a eșuat (${upErr.message || upErr}) — testul a rămas cel vechi`);
  let check = null;
  try { check = sha256(await download(supa, loc.bucket, loc.filePath)); } catch (e) { check = `eroare: ${errMsg(e)}`; }
  if (check !== shaAfter) {
    // ceva nu e în regulă → punem originalul la loc (și verificăm); copia rămâne pentru „↩ Restaurează"
    const back = await upload(supa, loc.bucket, loc.filePath, buf, { upsert: true });
    let restored = false;
    if (!back) { try { restored = sha256(await download(supa, loc.bucket, loc.filePath)) === sha; } catch { restored = false; } }
    return saveErr(`fișierul urcat nu se potrivește la verificare — ${restored ? 'am pus originalul la loc' : 'nici originalul nu l-am putut pune la loc: folosește „↩ Restaurează"'}`,
      restored ? { backup } : { backup, sha_before: sha, sha_after: shaAfter, sha_bad: typeof check === 'string' && check.length === 64 ? check : null });
  }
  stats.p2_curatate = (stats.p2_curatate || 0) + 1;
  const st = { ...base, status: 'curatat', ...pick(r), backup, sha_before: sha, sha_after: shaAfter, bytes_before: buf.length, bytes_after: r.bytes.length, ms };
  await saveState(supa, row.id, st);
  ctx.log(`🧽 „${row.title}": dreptunghiul de pe pagina 2 a fost scos (${kindsText(r.kinds)}) · ${kb(r.bytes.length - buf.length)} în plus`);
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
  if (!todo.length) ctx.log(dry ? '🔍 nimic nou de căutat: toate testele au fost deja verificate' : '🧽 nimic de făcut: toate testele sunt deja verificate');
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
  const counts = { total: rows.length, curatat: 0, fara: 0, nesigur: 0, eroare: 0, restaurat: 0, de_curatat: 0, neverificat: 0 };
  const list = rows.map((r) => {
    let st = states.get(r.id) || null;
    if (st && st.file_url !== r.file_url) st = null;      // fișier înlocuit: încă neverificat
    const s = st ? st.status : 'neverificat';
    counts[s] = (counts[s] || 0) + 1;
    return {
      id: r.id, title: r.title, subcategory: r.subcategory, is_free: !!r.is_free, created_at: r.created_at,
      status: s, at: st ? st.at : null, by: st ? st.by : null, kinds: st ? st.kinds : null, kindsText: st ? kindsText(st.kinds) : '',
      rect: st ? st.rect : null, overlay: st ? st.overlay : null, notes: st ? st.notes : null, error: st ? st.error || null : null,
      bytes_before: st ? st.bytes_before || null : null, bytes_after: st ? st.bytes_after || null : null,
      backup: !!(st && st.backup), restored_at: st ? st.restored_at || null : null,
    };
  });
  return { settings: settings.value, settingsSetup: settings.setup, version: P2.VERSION, counts, rows: list };
}

// ─── ↩ restaurarea originalului ──────────────────────────────────────────────
async function restore(supa, contentId, { userId = null } = {}) {
  const { data: row } = await supa.from('content').select(COLS).eq('id', contentId).maybeSingle();
  if (!row) throw fail(404, 'Testul nu mai există.');
  const st = (await loadStates(supa, [contentId])).get(contentId);
  if (!st || !st.backup) throw fail(404, 'Nu am copia originalului pentru acest test (n-a fost curățat de bot).');
  if (st.file_url !== row.file_url) throw fail(409, 'Testul are între timp alt fișier (înlocuit din Admin) — copia veche nu se mai pune peste el.');
  const loc = locate(row);
  const curSha = sha256(await download(supa, loc.bucket, loc.filePath));
  // fișierul de acum trebuie să fie al nostru: cel curățat, originalul sau (după o urcare stricată) ce a rămas atunci
  if (![st.sha_after, st.backup.sha, st.sha_bad].filter(Boolean).includes(curSha)) throw fail(409, 'Fișierul testului s-a schimbat de la curățare — nu-l suprascriu.');
  if (curSha !== st.backup.sha) {
    const orig = await download(supa, st.backup.bucket, st.backup.path);
    if (sha256(orig) !== st.backup.sha) throw fail(500, 'Copia originalului nu mai e întreagă — nu am atins testul.');
    const err = await upload(supa, loc.bucket, loc.filePath, orig, { upsert: true });
    if (err) throw fail(500, `Restaurarea a eșuat: ${err.message || err}`);
    const check = sha256(await download(supa, loc.bucket, loc.filePath));
    if (check !== st.backup.sha) throw fail(500, 'Fișierul restaurat nu se potrivește la verificare — mai încearcă o dată.');
  }
  const next = { ...st, status: 'restaurat', restored_at: nowIso(), restored_by: userId || null };
  await saveState(supa, contentId, next);
  return { ok: true, status: next.status };
}

// linkul (semnat, 10 minute) la fișierul de acum sau la original
async function link(supa, contentId, which = 'acum') {
  const { data: row } = await supa.from('content').select(COLS).eq('id', contentId).maybeSingle();
  if (!row || !row.file_url) throw fail(404, 'Testul nu mai există.');
  if (which === 'original') {
    const st = (await loadStates(supa, [contentId])).get(contentId);
    if (!st || !st.backup) throw fail(404, 'Nu am copia originalului pentru acest test.');
    const { data, error } = await supa.storage.from(st.backup.bucket).createSignedUrl(st.backup.path, 600);
    if (error || !data || !data.signedUrl) throw fail(500, 'Nu am putut face linkul.');
    return { url: data.signedUrl };
  }
  return { url: await http.signedUrlFromPublic(supa, row.file_url, 600) };
}

module.exports = {
  SETTINGS_KEY, STATE_PREFIX, CATEGORY, SUBCATS, BACKUP_BUCKET, BACKUP_DIR, MAX_ATTEMPTS,
  loadSettings, saveSettings, normSettings, loadTests, loadStates, needsWork, processOne, cleanStep, cronStep, status, restore, link, kindsText,
  _reset: () => { inst = null; },
};
