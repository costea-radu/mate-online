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
//   · CAROIAJUL (subiectele de EN din 2024 încoace: elevul rezolvă pe foaia subiectului,
//     pe pătrățele): un tabel Word cu mii de pătrățele de ~5 mm, desenat peste toată
//     pagina, plus tabelul în care e așezat subiectul (coloana cu punctajul, ramele).
//     Laturile lor sunt dreptunghiuri subțiri (~0,5 pt) — nu țin de desen: nu intră în
//     decupare și nici în imagine (15 oct.: „nu se vede bine desenul" — decuparea lua
//     tot caroiajul, adică toată pagina, iar figura ieșea mică într-un colț);
//   · un desen care e o IMAGINE (cum sunt figurile din subiectele de EN noi) se decupează
//     exact pe marginea ei, cu etichetele care stau pe ea;
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

const FIG_V = 2;                 // versiunea extragerii: o creștere le reface la toate lecțiile (2: fără caroiaj)
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
  // k: 'stroke' (o linie trasă), 'fill' (o formă plină — și laturile tabelelor Word, ca
  // dreptunghiuri subțiri), 'image'
  const add = (r, k) => { if (r && r.every(Number.isFinite)) marks.push({ x0: r[0], y0: r[1], x1: r[2], y1: r[3], k }); };
  const safe = (fn) => (...a) => { try { fn(...a); } catch { /* un semn neobișnuit: îl sărim, nu pagina */ } };
  const dev = new mupdf.Device({
    strokePath: safe((p, stroke, ctm) => add(p.getBounds(stroke, ctm), 'stroke')),
    fillPath: safe((p, evenOdd, ctm) => add(p.getBounds(null, ctm), 'fill')),
    fillImage: safe((image, ctm) => add(mupdf.Rect.transform([0, 0, 1, 1], ctm), 'image')),
    fillImageMask: safe((image, ctm) => add(mupdf.Rect.transform([0, 0, 1, 1], ctm), 'image')),
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
      // …sau rândul tabelului în care e așezat exercițiul (subiectele făcute în Word): se
      // termină la prima linie care traversează pagina (ultimul exercițiu de pe pagină nu
      // mai ține până la subsol)
      for (const m of pm.marks) {
        if (m.k === 'image' || m.y1 - m.y0 > 1.5 || m.x1 - m.x0 < pm.w * 0.75) continue;
        if (m.y0 > ln.y1 + 4 && m.y0 < bottom) bottom = m.y0;
      }
      return { page: p, top: ln.y0, bottom };
    }
  }
  return null;
}

// ─── Caroiajul și ramele (subiectele de EN din 2024 încoace) ──────────────────
const thinOf = (m) => Math.min(m.x1 - m.x0, m.y1 - m.y0);
const lenOf = (m) => Math.max(m.x1 - m.x0, m.y1 - m.y0);
// Caroiajul pe care se rezolvă: sute de laturi de pătrățel — dreptunghiuri subțiri,
// orizontale și verticale, toate cam de aceeași lungime (~14 pt), pe cel puțin jumătate
// din lățimea paginii. → { cell, lo, hi, x0, x1, k } sau null (pagina nu are caroiaj)
function gridOf(pm) {
  const cand = pm.marks.filter((m) => m.k !== 'image' && thinOf(m) <= 1.2 && lenOf(m) >= 4 && lenOf(m) <= 30);
  if (cand.length < 60) return null;
  const hist = new Map();
  for (const m of cand) { const n = Math.round(lenOf(m)); hist.set(n, (hist.get(n) || 0) + 1); }
  let cell = 0, top = 0;
  for (const [n, c] of hist) { const both = c + (hist.get(n + 1) || 0); if (both > top) { top = both; cell = n; } }
  if (top < cand.length * 0.6) return null;                 // lungimi amestecate: un desen, nu un caroiaj
  const lo = cell - 1.5, hi = cell + 2.5;
  const cells = cand.filter((m) => lenOf(m) >= lo && lenOf(m) <= hi);
  if (cells.length < 60) return null;
  let x0 = Infinity, x1 = -Infinity, fills = 0;
  for (const m of cells) { x0 = Math.min(x0, m.x0); x1 = Math.max(x1, m.x1); if (m.k === 'fill') fills++; }
  if (x1 - x0 < pm.w * 0.5) return null;                    // un desen făcut din pătrățele, nu foaia de rezolvare
  return { cell, lo, hi, x0, x1, k: fills * 2 >= cells.length ? 'fill' : 'stroke' };
}
// Un semn care NU ține de desen: latura unui pătrățel din caroiaj, rama paginii, liniile
// tabelului în care e așezat subiectul (coloana cu punctajul din stânga, marginea din
// dreapta, liniile dintre exerciții). Toate sunt dreptunghiuri pline subțiri (așa desenează
// Word laturile tabelelor); un desen nu are linii pe toată înălțimea paginii, nici cât tot
// rândul exercițiului (`band`), nici linii pline pe margine.
function frameMark(m, pm, grid, band = null) {
  if (m.k === 'image' || thinOf(m) > 1.2) return false;
  const w = m.x1 - m.x0, h = m.y1 - m.y0;
  if (w <= 1.2 && h > pm.h * 0.5) return true;
  if (m.k === 'fill' && h <= 1.2 && w > pm.w * 0.6) return true;            // liniile dintre exerciții
  if (m.k === 'fill' && (m.x1 <= pm.ox + 70 || m.x0 >= pm.ox + pm.w - 50)) return true;
  if (band && m.k === 'fill' && w <= 1.2 && h >= (band.bottom - band.top) * 0.8) return true;   // marginea rândului
  if (grid && m.k === grid.k) {
    const len = lenOf(m);
    if (len <= 1.5 || (len >= grid.lo && len <= grid.hi)) return true;
    const cx = (m.x0 + m.x1) / 2;
    if (cx < grid.x0 - 2 || cx > grid.x1 + 2) return true;
  }
  return false;
}

// ─── Figura din zonă: liniile desenului (grupate) + etichetele lor ────────────
const inter = (a, b, pad = 0) => a.x0 - pad < b.x1 && b.x0 - pad < a.x1 && a.y0 - pad < b.y1 && b.y0 - pad < a.y1;
const union = (list) => list.reduce((u, r) => ({ x0: Math.min(u.x0, r.x0), y0: Math.min(u.y0, r.y0), x1: Math.max(u.x1, r.x1), y1: Math.max(u.y1, r.y1) }),
  { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity });

function figureBox(pm, band, grid = gridOf(pm)) {
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
    if (frameMark(m, pm, grid, band)) return false;                                      // caroiajul, tabelul paginii
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
  // un desen care e o imagine: exact pe marginea ei (are deja alb în jur) + etichetele de pe
  // ea și literele punctelor lipite de ea („A", „B'") — nu și bucățile de enunț de alături
  const image = best.items.every((m) => m.k === 'image');
  // (o imagine care intră puțin în exercițiul următor se taie la zona exercițiului ei)
  if (image) box = { ...box, y0: Math.max(box.y0, band.top - 12), y1: Math.min(box.y1, band.bottom) };
  const onIt = (l) => { const cx = (l.x0 + l.x1) / 2, cy = (l.y0 + l.y1) / 2; return cx > box.x0 - 2 && cx < box.x1 + 2 && cy > box.y0 - 2 && cy < box.y1 + 2; };
  // etichetele: textele scurte lângă figură și tot textul din interiorul ei
  const labels = image
    ? lines.filter((l) => onIt(l) || (/^[A-Z][A-Za-z0-9'′’]{0,2}$/.test(l.text) && inter(l, box, 6)))
    : lines.filter((l) => inter(l, box, 16) && (l.text.length <= 12 || (l.x0 >= box.x0 - 2 && l.x1 <= box.x1 + 2)));
  box = union([box, ...labels]);
  const pad = image ? 0 : 6;
  return {
    x0: Math.max(pm.ox, box.x0 - pad), y0: Math.max(pm.oy, box.y0 - pad),
    x1: Math.min(pm.ox + pm.w, box.x1 + pad), y1: Math.min(pm.oy + pm.h, box.y1 + pad),
  };
}

// Desenarea paginii fără semnele care nu țin de desen (`skip`: caroiajul, ramele):
// totul trece mai departe la `draw`, mai puțin liniile pe care skip(semn) le respinge.
function filterDevice(mupdf, draw, skip) {
  const box = (r) => ({ x0: r[0], y0: r[1], x1: r[2], y1: r[3] });
  const keep = (r, k) => { try { return !skip({ ...box(r), k }); } catch { return true; } };
  const fwd = (name) => (...a) => draw[name](...a);
  return new mupdf.Device({
    fillPath: (p, evenOdd, ctm, cs, color, alpha) => { if (keep(p.getBounds(null, ctm), 'fill')) draw.fillPath(p, evenOdd, ctm, cs, color, alpha); },
    strokePath: (p, stroke, ctm, cs, color, alpha) => { if (keep(p.getBounds(stroke, ctm), 'stroke')) draw.strokePath(p, stroke, ctm, cs, color, alpha); },
    clipPath: fwd('clipPath'), clipStrokePath: fwd('clipStrokePath'),
    fillText: fwd('fillText'), strokeText: fwd('strokeText'), clipText: fwd('clipText'), clipStrokeText: fwd('clipStrokeText'), ignoreText: fwd('ignoreText'),
    fillShade: fwd('fillShade'), fillImage: fwd('fillImage'), fillImageMask: fwd('fillImageMask'), clipImageMask: fwd('clipImageMask'),
    popClip: fwd('popClip'), beginMask: fwd('beginMask'), endMask: fwd('endMask'), beginGroup: fwd('beginGroup'), endGroup: fwd('endGroup'),
    beginTile: (...a) => draw.beginTile(...a), endTile: fwd('endTile'), beginLayer: fwd('beginLayer'), endLayer: fwd('endLayer'),
  });
}

// PNG (pe alb) al dreptunghiului `box` din pagină; `skip` (opțional) = semnele lăsate deoparte
function renderBox(mupdf, page, box, scale = SCALE, skip = null) {
  const r = [Math.floor(box.x0 * scale), Math.floor(box.y0 * scale), Math.ceil(box.x1 * scale), Math.ceil(box.y1 * scale)];
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, r, false);
  pix.clear(255);
  const draw = new mupdf.DrawDevice(mupdf.Matrix.scale(scale, scale), pix);
  if (skip) {
    const dev = filterDevice(mupdf, draw, skip);
    page.run(dev, mupdf.Matrix.identity);
    dev.close();
  } else page.run(draw, mupdf.Matrix.identity);
  draw.close();
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
    const pm = models[band.page];
    const grid = gridOf(pm);
    const box = figureBox(pm, band, grid);
    if (!box) continue;
    out.push({ key, page: band.page, box, ...renderBox(mupdf, pages[band.page], box, SCALE, (m) => frameMark(m, pm, grid, band)) });
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

module.exports = { FIG_V, ON, wantsFigure, needsFigures, exKey, figureKeys, stripFigures, pageModel, findBand, gridOf, frameMark, figureBox, renderBox, figuresFromPdf, attachFigures, figuresFor, loadMupdf };
