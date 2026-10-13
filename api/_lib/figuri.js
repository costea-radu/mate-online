// =====================================================================
// api/_lib/figuri.js — DESENUL din subiect (figura geometrică, graficul, schema),
// decupat din pagina PDF, pentru proiecția exercițiului din sală.
//
// Cererea din 13 oct.: „la problema de geometrie, pune și desenul din PDF". Figurile din
// subiectele oficiale sunt desenate cu linii (nu sunt imagini), deci nu se pot „extrage":
// le decupăm din pagină. MuPDF (WebAssembly, fără dependențe native) dă rândurile de text
// cu pozițiile lor și liniile desenului:
//   · zona exercițiului = de la rândul „N." (în subiectul lui) până la exercițiul următor,
//     următorul „SUBIECTUL…" sau subsolul paginii;
//   · figura = liniile din zonă care nu țin de text (fără liniile de fracție și barele
//     radicalilor, fără ramele și separatorii paginii), grupate, plus etichetele lor
//     (A, B, C', 4 cm…);
//   · se randează de 3× (≈ 216 dpi) pe alb → PNG în Storage (live-media), o singură dată
//     pe lecție: elevii primesc doar imaginea (fără PDF în browser).
// Itemii cu desen: cei al căror enunț pomenește figura („În figura alăturată…", „desenul",
// „schița", „tabelul alăturat") — și ceilalți itemi ai aceleiași probleme (a, b, c), care
// primesc același desen.
// O lecție primește desenele o singură dată (script.figv; script.figInfo = ce s-a găsit);
// o greșeală (PDF lipsă, MuPDF indisponibil) se notează în script.figErr, fără reîncercări —
// Admin → Script → „🖼 Refă desenele" le reface.
// LIVE_DESENE=0 → fără desene.
// =====================================================================
const fs = require('node:fs');
const path = require('node:path');
const live = require('./live');

const FIG_V = 1;                 // versiunea extragerii: o creștere le reface la toate lecțiile
const SCALE = 3;
const ON = () => !/^(0|nu|false|no|off)$/i.test(String(process.env.LIVE_DESENE || '1').trim());

let mupdfP = null;
let broken = false;              // MuPDF nu se încarcă aici: nu mai încercăm în instanța asta
async function loadMupdf() {
  if (broken) return null;
  try {
    if (!mupdfP) {
      // fișierul WebAssembly, citit explicit (așa îl ia și împachetarea funcțiilor pe Vercel)
      if (!globalThis.$libmupdf_wasm_Module) {
        try { globalThis.$libmupdf_wasm_Module = { wasmBinary: fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', 'mupdf', 'dist', 'mupdf-wasm.wasm')) }; } catch { /* îl caută MuPDF singur */ }
      }
      mupdfP = import('mupdf');
    }
    return await mupdfP;
  } catch (e) {
    broken = true;
    console.warn('figuri: MuPDF nu s-a încărcat —', e.message);
    return null;
  }
}

const wantsFigure = (it) => !!it && /figur|desen|alatur|schit/.test(live.foldRo(`${it.statement || ''} ${it.statementTry || ''}`));
const needsFigures = (script) => ON() && !!script && Array.isArray(script.items) && Number(script.figv || 0) < FIG_V;
// problema itemului: „III.6.a" → „III.6"
const exKey = (ref) => { const m = /^(I{1,3})\.(\d{1,2})/.exec(String(ref || '')); return m ? `${m[1]}.${m[2]}` : null; };
// problemele cu desen ale unui script (în ordine)
const figureKeys = (items) => [...new Set((items || []).filter(wantsFigure).map((it) => exKey(it.ref)).filter(Boolean))];
// scriptul fără desene (ex. preluat de la lecția altui profesor: fiecare lecție are fișierele ei)
function stripFigures(script) {
  if (!script || typeof script !== 'object') return script;
  const { figv, figInfo, figErr, ...rest } = script;
  return { ...rest, items: Array.isArray(script.items) ? script.items.map(({ figure, ...it }) => it) : script.items };
}

// ─── Pagina: rândurile de text și „semnele" desenate (linii, forme, imagini) ──
function pageModel(mupdf, page) {
  const [x0, y0, x1, y1] = page.getBounds();
  const st = JSON.parse(page.toStructuredText('preserve-whitespace').asJSON());
  const lines = [];
  for (const b of st.blocks || []) {
    for (const l of b.lines || []) {
      const t = String(l.text || '').trim();
      if (t) lines.push({ text: t, x0: l.bbox.x, y0: l.bbox.y, x1: l.bbox.x + l.bbox.w, y1: l.bbox.y + l.bbox.h });
    }
  }
  lines.sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
  const marks = [];
  const add = (r) => { if (r && r.every(Number.isFinite)) marks.push({ x0: r[0], y0: r[1], x1: r[2], y1: r[3] }); };
  const safe = (fn) => (...a) => { try { fn(...a); } catch { /* un semn neobișnuit: îl sărim, nu pagina */ } };
  const dev = new mupdf.Device({
    strokePath: safe((p, stroke, ctm) => add(p.getBounds(stroke, ctm))),
    fillPath: safe((p, evenOdd, ctm) => add(p.getBounds(null, ctm))),
    fillImage: safe((image, ctm) => add(mupdf.Rect.transform([0, 0, 1, 1], ctm))),
    fillImageMask: safe((image, ctm) => add(mupdf.Rect.transform([0, 0, 1, 1], ctm))),
  });
  page.run(dev, mupdf.Matrix.identity);
  dev.close();
  return { w: x1 - x0, h: y1 - y0, ox: x0, oy: y0, lines, marks };
}

// ─── Zona exercițiului (pagina + de sus până jos) ────────────────────────────
const SECTION_RE = /SUBIECTUL\s+(?:AL\s+)?(I{1,3}|[123])(?:\s*-?\s*LEA)?\b/i;
const ROMAN = { i: 'I', ii: 'II', iii: 'III', 1: 'I', 2: 'II', 3: 'III' };
const exLine = (n) => new RegExp(`^\\s*(?:\\(?\\d{1,2}\\s*p\\)?\\.?\\s+)?${n}\\s*[.)](?!\\d)`);
const isFooter = (ln, pm) => ln.y0 > pm.oy + pm.h * 0.92 || /^pagina\s+\d+\s+din\s+\d+/i.test(ln.text) || /^prob[ăa]\s+scris[ăa]/i.test(live.foldRo(ln.text));

// { page, top, bottom } — exercițiul `ex` din subiectul `sub` (în ordinea paginilor)
function findBand(models, sub, ex) {
  let section = null;
  for (let p = 0; p < models.length; p++) {
    const pm = models[p];
    for (let i = 0; i < pm.lines.length; i++) {
      const ln = pm.lines[i];
      const sm = SECTION_RE.exec(ln.text);
      if (sm) { section = ROMAN[String(sm[1]).toLowerCase()] || section; continue; }
      if (section !== sub || !exLine(ex).test(ln.text)) continue;
      // capătul: exercițiul următor, următorul subiect sau subsolul paginii
      let bottom = pm.oy + pm.h;
      for (let j = i + 1; j < pm.lines.length; j++) {
        const nx = pm.lines[j];
        if (exLine(ex + 1).test(nx.text) || SECTION_RE.test(nx.text) || isFooter(nx, pm)) { bottom = nx.y0; break; }
      }
      return { page: p, top: ln.y0, bottom };
    }
  }
  return null;
}

// ─── Figura din zonă: liniile desenului (grupate) + etichetele lor ────────────
const inter = (a, b, pad = 0) => a.x0 - pad < b.x1 && b.x0 - pad < a.x1 && a.y0 - pad < b.y1 && b.y0 - pad < a.y1;
const union = (list) => list.reduce((u, r) => ({ x0: Math.min(u.x0, r.x0), y0: Math.min(u.y0, r.y0), x1: Math.max(u.x1, r.x1), y1: Math.max(u.y1, r.y1) }),
  { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

function figureBox(pm, band) {
  const lines = pm.lines.filter((l) => l.y1 > band.top - 2 && l.y0 < band.bottom + 2);
  const covered = (m) => {
    // un semn al textului: linia de fracție sau bara radicalului — orizontală, subțire, scurtă,
    // acoperită (pe lățime) de text chiar deasupra sau dedesubt (axa numerelor, lungă, rămâne)
    if (m.y1 - m.y0 > 1.8 || m.x1 - m.x0 > 100) return false;
    const w = Math.max(1, m.x1 - m.x0);
    const over = lines.filter((l) => l.y1 > m.y0 - 10 && l.y0 < m.y1 + 10)
      .reduce((s, l) => s + Math.max(0, Math.min(l.x1, m.x1) - Math.max(l.x0, m.x0)), 0);
    return over >= w * 0.6;
  };
  const marks = pm.marks.filter((m) => {
    const cy = (m.y0 + m.y1) / 2, w = m.x1 - m.x0, h = m.y1 - m.y0;
    if (cy < band.top - 12 || cy > band.bottom) return false;
    if (w < 0.8 && h < 0.8) return false;
    if (w > pm.w * 0.6 && (h < 3 || h > (band.bottom - band.top) * 0.5)) return false;   // separatoare, rame
    if (lines.some((l) => m.x0 >= l.x0 - 1 && m.x1 <= l.x1 + 1 && m.y0 >= l.y0 - 1 && m.y1 <= l.y1 + 1)) return false;  // în rândul de text
    return !covered(m);
  });
  if (!marks.length) return null;
  // grupe de semne apropiate (≤ 14 pt); figura = grupa cu cea mai mare suprafață
  const groups = [];
  for (const m of marks) {
    const near = groups.filter((g) => inter(g.box, m, 14));
    const merged = { items: [m, ...near.flatMap((g) => g.items)], box: union([m, ...near.map((g) => g.box)]) };
    for (const g of near) groups.splice(groups.indexOf(g), 1);
    groups.push(merged);
  }
  // o figură are cel puțin o linie lungă (o latură, o axă); doar semne mici = litere
  // desenate ca forme (formule din PDF-urile vechi), nu un desen. Nici rândurile late și
  // joase (un tabel cu variantele de răspuns, un separator) nu sunt desene.
  const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
  const best = groups.filter((g) => g.items.some((m) => Math.max(m.x1 - m.x0, m.y1 - m.y0) >= 20)
    && !(g.box.x1 - g.box.x0 > pm.w * 0.55 && g.box.y1 - g.box.y0 < 45))
    .sort((a, b) => area(b.box) - area(a.box))[0];
  if (!best) return null;
  let box = best.box;
  // prea mic — o subliniere, un punct; o figură joasă (axa numerelor) are măcar câteva semne
  const bw = box.x1 - box.x0, bh = box.y1 - box.y0;
  if (bw < 36 || bh < 6 || (bh < 28 && best.items.length < 3)) return null;
  // etichetele: textele scurte lângă figură și tot textul din interiorul ei
  const labels = lines.filter((l) => inter(l, box, 16) && (l.text.length <= 12 || (l.x0 >= box.x0 - 2 && l.x1 <= box.x1 + 2)));
  box = union([box, ...labels]);
  const pad = 6;
  return {
    x0: Math.max(pm.ox, box.x0 - pad), y0: Math.max(pm.oy, box.y0 - pad),
    x1: Math.min(pm.ox + pm.w, box.x1 + pad), y1: Math.min(pm.oy + pm.h, box.y1 + pad),
  };
}

// PNG (pe alb) al dreptunghiului `box` din pagină
function renderBox(mupdf, page, box, scale = SCALE) {
  const r = [Math.floor(box.x0 * scale), Math.floor(box.y0 * scale), Math.ceil(box.x1 * scale), Math.ceil(box.y1 * scale)];
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, r, false);
  pix.clear(255);
  const dev = new mupdf.DrawDevice(mupdf.Matrix.scale(scale, scale), pix);
  page.run(dev, mupdf.Matrix.identity);
  dev.close();
  return { png: Buffer.from(pix.asPNG()), w: pix.getWidth(), h: pix.getHeight() };
}

// Desenele problemelor cu figură dintr-un script, din PDF-ul subiectului (Buffer).
// → [{ key, page, box, png, w, h }] — câte unul pe problemă; null = MuPDF indisponibil
async function figuresFromPdf(buf, items) {
  const mupdf = await loadMupdf();
  if (!mupdf) return null;
  const keys = figureKeys(items);
  if (!keys.length) return [];
  const doc = mupdf.Document.openDocument(buf, 'application/pdf');
  const pages = [], models = [];
  const n = Math.min(doc.countPages(), 12);
  for (let i = 0; i < n; i++) { const pg = doc.loadPage(i); pages.push(pg); models.push(pageModel(mupdf, pg)); }
  const out = [];
  for (const key of keys) {
    const [sub, ex] = key.split('.');
    const band = findBand(models, sub, Number(ex));
    if (!band) continue;
    const box = figureBox(models[band.page], band);
    if (!box) continue;
    out.push({ key, page: band.page, box, ...renderBox(mupdf, pages[band.page], box) });
  }
  return out;
}

// Pune desenele în script (o copie): it.figure = { url, w, h } la toți itemii problemei,
// script.figv, script.figInfo = { found, missing }. Urcă PNG-urile în Storage (live-media,
// lângă vocea lecției). null = MuPDF indisponibil.
async function attachFigures({ supa, script, lessonId, buf, log = () => {} }) {
  const figs = await figuresFromPdf(buf, script.items);
  if (figs == null) return null;
  const copy = stripFigures(JSON.parse(JSON.stringify(script)));
  const BUCKET = require('./tts').BUCKET;
  const stamp = Date.now().toString(36);          // URL nou la fiecare extragere (fișierele se țin un an în cache)
  const byKey = new Map();
  for (const f of figs) {
    const path = `lessons/${lessonId}/fig-${f.key.replace(/\./g, '')}.png`;
    const { error } = await supa.storage.from(BUCKET).upload(path, f.png, { contentType: 'image/png', upsert: true, cacheControl: '31536000' });
    if (error) { log(`live: desenul ${f.key}: ${error.message}`); continue; }
    byKey.set(f.key, { url: `${supa.storage.from(BUCKET).getPublicUrl(path).data.publicUrl}?v=${stamp}`, w: f.w, h: f.h });
  }
  for (const it of copy.items || []) {
    const f = byKey.get(exKey(it.ref));
    if (f) it.figure = f;
  }
  const keys = figureKeys(copy.items);
  copy.figv = FIG_V;
  copy.figInfo = { at: new Date().toISOString(), found: keys.filter((k) => byKey.has(k)), missing: keys.filter((k) => !byKey.has(k)) };
  if (keys.length) log(`live: lecția ${lessonId} — desene din PDF: ${copy.figInfo.found.join(', ') || 'niciunul'}${copy.figInfo.missing.length ? `; negăsite: ${copy.figInfo.missing.join(', ')}` : ''}`);
  return { script: copy, count: byKey.size };
}

// Desenele unei lecții (rândul din live_lessons, cu scriptul): { script, count } — scriptul
// de salvat (cu figv, chiar și fără niciun desen: nu se mai caută). pdfCtx = ai-pdf-context.
// Aruncă la o greșeală (PDF-ul nu se descarcă) — apelantul notează script.figErr.
async function figuresFor({ supa, row, pdfCtx, log = () => {} }) {
  const script = stripFigures(row.script);
  const mark = (extra = {}) => ({ script: { ...script, figv: FIG_V, ...extra }, count: 0 });
  if (!figureKeys(script.items).length) return mark();
  if (!(await loadMupdf())) return mark({ figErr: 'MuPDF nu s-a încărcat pe server' });
  const { data: content } = await supa.from('content').select('*').eq('id', row.subject_id).maybeSingle();
  if (!content?.file_url) return mark({ figErr: 'subiectul nu are PDF' });
  const buf = await pdfCtx.downloadContentPdf(supa, content);
  return (await attachFigures({ supa, script, lessonId: row.id, buf, log })) || mark({ figErr: 'MuPDF nu s-a încărcat pe server' });
}

module.exports = { FIG_V, ON, wantsFigure, needsFigures, exKey, figureKeys, stripFigures, pageModel, findBand, figureBox, renderBox, figuresFromPdf, attachFigures, figuresFor, loadMupdf };
