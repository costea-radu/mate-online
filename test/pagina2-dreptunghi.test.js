// =====================================================================
// test/pagina2-dreptunghi.test.js — 🧽 dreptunghiul negru de pe pagina 2
// (testele de EN): motorul (api/_lib/pagina2.js), rularea cu Storage
// (api/_lib/pagina2Run.js), API-ul (api/exam-bot.js) și cronul.
//
// PDF-urile sunt sintetice, făcute aici, după felurile reale în care e desenat
// dreptunghiul (subiectele oficiale: desen + ramă + mască; simulările ISJ: un
// dreptunghi plin; imagini negre; pagini scanate; formulare; drumuri compuse).
// =====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PDFDocument, StandardFonts, rgb, PDFName } = require('pdf-lib');

const P2 = require('../api/_lib/pagina2');
const P2R = require('../api/_lib/pagina2Run');
const R = require('../api/_lib/examBotRun');
const http = require('../api/_lib/http');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
let mupdf;
test.before(async () => { mupdf = await P2.loadMupdf(); });

// ─── PDF-uri sintetice ───────────────────────────────────────────────────────
const W = 595, H = 842;
function resources(doc, { fonts = {}, xobjects = {} } = {}) {
  const ctx = doc.context;
  const res = ctx.obj({});
  if (Object.keys(fonts).length) { const f = ctx.obj({}); for (const [k, v] of Object.entries(fonts)) f.set(PDFName.of(k), v); res.set(PDFName.of('Font'), f); }
  if (Object.keys(xobjects).length) { const x = ctx.obj({}); for (const [k, v] of Object.entries(xobjects)) x.set(PDFName.of(k), v); res.set(PDFName.of('XObject'), x); }
  return res;
}
function rawPage(doc, content, opts = {}) {
  const page = doc.addPage([W, H]);
  page.node.set(PDFName.of('Resources'), resources(doc, opts));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(content)));
  return page;
}
function formXObject(doc, content, bbox, opts = {}) {
  return doc.context.register(doc.context.flateStream(content, { Type: 'XObject', Subtype: 'Form', BBox: bbox, Resources: resources(doc, opts) }));
}
function maskXObject(doc, w, h, fill) {
  return doc.context.register(doc.context.flateStream(new Uint8Array(Math.ceil(w / 8) * h).fill(fill), { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ImageMask: true, BitsPerComponent: 1 }));
}
function grayImage(doc, w, h, val) {
  return doc.context.register(doc.context.flateStream(new Uint8Array(w * h).fill(val), { Type: 'XObject', Subtype: 'Image', Width: w, Height: h, ColorSpace: 'DeviceGray', BitsPerComponent: 8 }));
}
const text = (s, x, y, size = 11) => `BT /F1 ${size} Tf ${x} ${y} Td (${s}) Tj ET\n`;
const subiectul = text('SUBIECTUL I', 40, 520, 12) + text('5p 1. Rezultatul calculului 12 - 2 x 5 este egal cu:', 40, 495) + text('a. 50   b. 22   c. 2   d. 0', 60, 478) + '0 0 0 RG 0.5 w 36 470 m 560 470 l S\n';
const instr = text('Toate subiectele sunt obligatorii.', 320, 700, 12) + text('Se acorda zece puncte din oficiu.', 320, 672, 12);
const header = text('Ministerul Educatiei', 260, 815, 9) + '0 0 0 rg 24 806 537 0.5 re f\n';
const box = '0 g 25 559 229 242 re f\n';

async function base() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const p1 = doc.addPage([W, H]);
  p1.drawText('EVALUAREA NATIONALA - pagina 1', { x: 140, y: 500, size: 16, font });
  p1.drawRectangle({ x: 346, y: 562, width: 225, height: 241, borderColor: rgb(0, 0, 0), borderWidth: 0.4 });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  return { doc, font, ref: helv.ref };
}
async function finish(doc, font) {
  const p3 = doc.addPage([W, H]);
  p3.drawText('SUBIECTUL al II-lea - pagina 3', { x: 40, y: 780, size: 12, font });
  p3.drawRectangle({ x: 400, y: 600, width: 120, height: 80, color: rgb(0, 0, 0) });   // un desen negru pe pagina 3: rămâne
  return Buffer.from(await doc.save());
}
// o pagină 2 scanată (JPEG pe toată pagina), desenată cu MuPDF
function scanJpeg(draw, gray = true) {
  const pw = 1240, ph = 1754, s = pw / W;
  const pix = new mupdf.Pixmap(gray ? mupdf.ColorSpace.DeviceGray : mupdf.ColorSpace.DeviceRGB, [0, 0, pw, ph], false);
  pix.clear(255);
  const px = pix.getPixels(), stride = pix.getStride(), n = gray ? 1 : 3;
  const fill = (x0, y0, x1, y1, v, skew = 0) => {
    for (let y = Math.round(y0 * s); y < Math.round(y1 * s); y++) {
      const sh = skew ? Math.round((y - y0 * s) / skew) : 0;
      for (let x = Math.round(x0 * s) + sh; x < Math.round(x1 * s) + sh; x++) if (x >= 0 && y >= 0 && x < pw && y < ph) for (let c = 0; c < n; c++) px[y * stride + x * n + c] = v;
    }
  };
  draw(fill);
  const jpg = pix.asJPEG(85, false);
  pix.destroy();
  return jpg;
}

const MAKE = {
  // subiectele oficiale: dreptunghi negru + ramă + dreptunghi alb + mască neagră (+ o mască goală la instrucțiuni)
  oficial: async () => {
    const { doc, font, ref } = await base();
    const c = header
      + '0 0 0 rg 24.8 559 229.2 241.8 re f*\n'
      + '0 0 0 rg 24.5 801 m 254.3 801 l 254.3 558.6 l 24.5 558.6 l h 24.9 800.6 m 24.9 559 l 253.9 559 l 253.9 800.6 l h f\n'
      + '1 1 1 rg 25 562.7 228.6 234.1 re f*\n'
      + 'q 0 0 0 rg 228.7 0 0 234.2 25 562.6 cm /Im1 Do Q\n'
      + '1 1 1 rg 300.5 603 249 104 re f* q 0 0 0 rg 249 0 0 104 300.5 603 cm /Im2 Do Q\n'
      + '0 0 0 rg ' + instr + subiectul;
    rawPage(doc, c, { fonts: { F1: ref }, xobjects: { Im1: maskXObject(doc, 200, 205, 0), Im2: maskXObject(doc, 160, 64, 0xff) } });
    return finish(doc, font);
  },
  // simulările ISJ: un singur dreptunghi plin
  vector: async () => { const { doc, font, ref } = await base(); rawPage(doc, header + '0 g 24 548 223 248 re f\n' + instr + subiectul, { fonts: { F1: ref } }); return finish(doc, font); },
  imagine: async () => {
    const { doc, font, ref } = await base();
    rawPage(doc, header + 'q 230 0 0 240 28 562 cm /Im0 Do Q\n' + instr + subiectul, { fonts: { F1: ref }, xobjects: { Im0: grayImage(doc, 60, 62, 0) } });
    return finish(doc, font);
  },
  // pagină scanată, dreptunghiul puțin strâmb, cu text OCR invizibil peste
  scanat: async () => {
    const { doc, font } = await base();
    const jpg = scanJpeg((fill) => { fill(30, 45, 260, 285, 15, 100); for (let k = 0; k < 6; k++) fill(330, 100 + k * 20, 540, 104 + k * 20, 30); fill(40, 330, 300, 334, 20); }, false);
    const page = doc.addPage([W, H]);
    page.drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: W, height: H });
    page.drawText('textul OCR invizibil', { x: 40, y: 500, size: 1, font, opacity: 0 });
    return finish(doc, font);
  },
  // scanare cu linia antetului la 1,5 pt deasupra, chenar la +5 pt în dreapta și umbră
  scanatChenar: async () => {
    const { doc, font } = await base();
    const jpg = scanJpeg((fill) => { fill(20, 42.5, 570, 43.5, 30); fill(33, 48, 265, 290, 175); fill(30, 45, 262, 287, 12); fill(267, 45, 267.8, 287, 40); fill(40, 300, 140, 310, 20); fill(330, 100, 540, 104, 30); });
    doc.addPage([W, H]).drawImage(await doc.embedJpg(jpg), { x: 0, y: 0, width: W, height: H });
    return finish(doc, font);
  },
  formular: async () => {
    const { doc, font, ref } = await base();
    rawPage(doc, header + 'q 1 0 0 1 25 559 cm /Fm1 Do Q\n' + instr + subiectul, { fonts: { F1: ref }, xobjects: { Fm1: formXObject(doc, '0 0 0 rg 0 0 229 242 re f\n', [0, 0, 229, 242]) } });
    return finish(doc, font);
  },
  // toată pagina într-un formular (unele programe fac așa); dreptunghiul e în el
  paginaInFormular: async () => {
    const { doc, font, ref } = await base();
    rawPage(doc, 'q 1 0 0 1 0 0 cm /Pg Do Q\n', { xobjects: { Pg: formXObject(doc, header + box + instr + subiectul, [0, 0, W, H], { fonts: { F1: ref } }) } });
    return finish(doc, font);
  },
  formularInFormular: async () => {
    const { doc, font, ref } = await base();
    const bx = formXObject(doc, '0 g 0 0 229 242 re f\n', [0, 0, 229, 242]);
    rawPage(doc, 'q /Pg Do Q\n', { xobjects: { Pg: formXObject(doc, header + 'q 1 0 0 1 25 559 cm /Bx Do Q\n' + instr + subiectul, [0, 0, W, H], { fonts: { F1: ref }, xobjects: { Bx: bx } }) } });
    return finish(doc, font);
  },
  ascunsInFormular: async () => {
    const { doc, font, ref } = await base();
    const pg = formXObject(doc, '0.5 g ' + text('Numele elevului ............', 40, 760, 10) + text('Scoala ............', 40, 740, 10) + box + instr + subiectul, [0, 0, W, H], { fonts: { F1: ref } });
    rawPage(doc, header + '/Pg Do\n', { fonts: { F1: ref }, xobjects: { Pg: pg } });
    return finish(doc, font);
  },
  // același formular desenat de două ori pe pagina 2 → nu se poate scoate doar o dată
  formularDeDouaOri: async () => {
    const { doc, font, ref } = await base();
    rawPage(doc, '/Pg Do q 1 0 0 1 0 -900 cm /Pg Do Q\n', { xobjects: { Pg: formXObject(doc, header + box + instr + subiectul, [0, 0, W, H], { fonts: { F1: ref } }) } });
    return finish(doc, font);
  },
  // formularul paginii 2 e folosit și de pagina 3: pagina 3 rămâne cum era (cu dreptunghiul ei)
  formularComun: async () => {
    const { doc, ref } = await base();
    const pg = formXObject(doc, header + box + instr + subiectul, [0, 0, W, H], { fonts: { F1: ref } });
    rawPage(doc, '/Pg Do\n', { xobjects: { Pg: pg } });
    rawPage(doc, '/Pg Do\n', { xobjects: { Pg: pg } });
    return Buffer.from(await doc.save());
  },
  // drum compus: dreptunghiul + rama instrucțiunilor într-un singur f* → doar bucata din dreptunghi
  drumCompus: async () => { const { doc, font, ref } = await base(); rawPage(doc, header + '0 g 32 550 225 242 re 300 600 250 110 re 301 601 248 108 re f*\n' + instr + subiectul, { fonts: { F1: ref } }); return finish(doc, font); },
  antetLipit: async () => { const { doc, font, ref } = await base(); rawPage(doc, '0 g 20 803 540 0.6 re f\n' + '0 g 25 559 229 243 re f\n' + instr + subiectul, { fonts: { F1: ref } }); return finish(doc, font); },
  // text cenușiu desenat ÎNAINTEA dreptunghiului: rămâne ascuns (alb în locul negrului)
  textAscuns: async () => { const { doc, font, ref } = await base(); rawPage(doc, '0.5 g ' + text('Numele elevului ............', 40, 760, 10) + text('Scoala ............', 40, 740, 10) + box + instr + subiectul, { fonts: { F1: ref } }); return finish(doc, font); },
  chenarLinii: async () => {
    const { doc, font, ref } = await base();
    rawPage(doc, header + '0 g 30 555 229 242 re f\n' + '0 G 0.6 w 25 802 m 264 802 l S 25 550 m 264 550 l S 25 550 m 25 802 l S 264 550 m 264 802 l S\n' + instr + subiectul, { fonts: { F1: ref } });
    return finish(doc, font);
  },
  // fără dreptunghi: un desen negru mare, dar jos; un pătrat negru mic sus-stânga
  faraJos: async () => { const { doc, font, ref } = await base(); rawPage(doc, header + instr + subiectul + '0 g 100 100 m 300 100 l 200 300 l h f\n0 g 300 150 180 180 re f\n', { fonts: { F1: ref } }); return finish(doc, font); },
  faraMic: async () => { const { doc, font, ref } = await base(); rawPage(doc, header + '0 g 30 700 50 50 re f\n' + instr + subiectul, { fonts: { F1: ref } }); return finish(doc, font); },
  oPagina: async () => { const doc = await PDFDocument.create(); doc.addPage([W, H]).drawText('o pagina', { x: 50, y: 700, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) }); return Buffer.from(await doc.save()); },
};
const cache = new Map();
const pdf = async (k) => { if (!cache.has(k)) cache.set(k, await MAKE[k]()); return cache.get(k); };

// ─── ce verificăm la fiecare PDF curățat ────────────────────────────────────
function pagesText(bytes) {
  const d = new mupdf.PDFDocument(bytes);
  const out = [];
  for (let i = 0; i < d.countPages(); i++) { const p = d.loadPage(i); const st = p.toStructuredText(); out.push(st.asText()); st.destroy(); p.destroy(); }
  d.destroy();
  return out;
}
function page2(bytes) {
  const d = new mupdf.PDFDocument(bytes);
  const p = d.loadPage(1);
  const g = P2._internals.renderGray(mupdf, p, 2);
  p.destroy(); d.destroy();
  return g;
}
async function assertCleaned(name, opts = {}) {
  const buf = await pdf(name);
  const r = P2.cleanPage2(mupdf, buf);
  assert.strictEqual(r.status, 'curatat', `${name}: ${r.error || JSON.stringify(r.check)}`);
  assert.ok(r.bytes && r.bytes.length > buf.length, `${name}: PDF nou`);
  assert.ok(Buffer.from(r.bytes.subarray(0, buf.length)).equals(buf), `${name}: salvare incrementală — octeții originalului rămân la început`);
  assert.strictEqual(r.incremental, true);
  assert.strictEqual(r.check.ok, true);
  assert.strictEqual(r.check.diffOutside, 0, `${name}: în afara dreptunghiului, pagina 2 e identică`);
  assert.strictEqual(r.check.otherPagesDiff, 0, `${name}: celelalte pagini sunt identice`);
  const after = page2(r.bytes);
  assert.ok(P2._internals.darkFraction(after, r.rect, 110) <= 0.03, `${name}: în dreptunghi e alb`);
  assert.deepStrictEqual(pagesText(r.bytes), pagesText(buf), `${name}: textul tuturor paginilor e același`);
  const again = P2.cleanPage2(mupdf, r.bytes);
  assert.strictEqual(again.status, 'fara', `${name}: a doua trecere nu mai găsește nimic`);
  const pl = await PDFDocument.load(r.bytes);
  assert.strictEqual(pl.getPageCount(), (await PDFDocument.load(buf)).getPageCount(), `${name}: pdf-lib (PDF-urile combinate) îl citește`);
  if (opts.kinds) for (const [k, v] of Object.entries(opts.kinds)) assert.strictEqual(r.kinds[k], v, `${name}: kinds.${k} (${JSON.stringify(r.kinds)})`);
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Motorul
// ═══════════════════════════════════════════════════════════════════════════
test('motorul: subiectele oficiale (desen + ramă + mască) — dreptunghiul scos, restul neatins', async () => {
  const r = await assertCleaned('oficial');
  assert.ok(r.kinds.vector >= 1 && r.kinds.mask === 1, JSON.stringify(r.kinds));
  assert.ok(Math.abs(r.rect[0] - 24.5) < 1.5 && Math.abs(r.rect[1] - 41) < 1.5, JSON.stringify(r.rect));
});
test('motorul: simulările ISJ (un dreptunghi plin), imaginea neagră, chenarul din linii, antetul lipit', async () => {
  await assertCleaned('vector', { kinds: { vector: 1 } });
  await assertCleaned('imagine', { kinds: { image: 1 } });
  await assertCleaned('chenarLinii');
  await assertCleaned('antetLipit');
});
test('motorul: drumul compus — doar bucata din dreptunghi, rama instrucțiunilor rămâne', async () => {
  await assertCleaned('drumCompus', { kinds: { subpaths: 1, vector: 0 } });
});
test('motorul: ce era sub dreptunghi (text desenat înaintea lui) rămâne ascuns — alb în locul negrului', async () => {
  const r = await assertCleaned('textAscuns', { kinds: { hidden: 1 } });
  assert.ok(P2._internals.inkFraction(page2(r.bytes), r.rect) <= 0.002, 'textul ascuns nu apare');
});
test('motorul: pagina scanată — imaginea rămâne, peste dreptunghi (cu marginea lui) vine alb', async () => {
  const r = await assertCleaned('scanat', { kinds: { overlay: 1 } });
  assert.ok(r.overlay[0] <= r.rect[0] && r.overlay[2] >= r.rect[2], 'albul acoperă tot dreptunghiul');
  const r2 = await assertCleaned('scanatChenar', { kinds: { overlay: 1 } });
  assert.ok(r2.overlay[1] > 43.5, `linia antetului (1,5 pt deasupra) nu e acoperită: ${JSON.stringify(r2.overlay)}`);
  assert.ok(r2.overlay[2] >= 267.8, 'chenarul din dreapta e acoperit');
});
test('motorul: formulare — întreg, în formularul paginii, formular în formular, ascuns în formular, comun cu pagina 3', async () => {
  await assertCleaned('formular', { kinds: { form: 1 } });
  await assertCleaned('paginaInFormular', { kinds: { vector: 1 } });
  await assertCleaned('formularInFormular', { kinds: { form: 1 } });
  const r = await assertCleaned('ascunsInFormular', { kinds: { vector: 1, hidden: 1 } });
  assert.ok(P2._internals.inkFraction(page2(r.bytes), r.rect) <= 0.002);
  await assertCleaned('formularComun', { kinds: { vector: 1 } });
  const n = P2.cleanPage2(mupdf, await pdf('formularDeDouaOri'));
  assert.strictEqual(n.status, 'nesigur');
  assert.match(n.error, /de mai multe ori/);
  assert.strictEqual(n.bytes, null, 'nesigur → nu întoarce nimic de urcat');
});
test('motorul: fără dreptunghi pe pagina 2 → „fara" (nimic de schimbat)', async () => {
  for (const k of ['faraJos', 'faraMic', 'oPagina']) {
    const r = P2.cleanPage2(mupdf, await pdf(k));
    assert.strictEqual(r.status, 'fara', k);
    assert.strictEqual(r.bytes, null);
  }
  assert.match(P2.cleanPage2(mupdf, await pdf('oPagina')).notes.join(' '), /nu are pagina 2/);
  const bad = P2.cleanPage2(mupdf, Buffer.from('nu e un PDF'));
  assert.strictEqual(bad.status, 'eroare');
});
test('motorul: fără erori MuPDF (fiecare lasă ~70 de octeți din stiva WebAssembly) și cu instanță nouă la nevoie', async () => {
  const e0 = P2.mupdfErrors();
  for (const k of ['oficial', 'paginaInFormular', 'formularInFormular', 'ascunsInFormular', 'scanat']) P2.cleanPage2(mupdf, await pdf(k));
  assert.strictEqual(P2.mupdfErrors() - e0, 0, 'readStream() doar pe referința indirectă a formularelor');
  assert.ok(P2.isWasmCrash('RuntimeError: memory access out of bounds'));
  assert.ok(!P2.isWasmCrash('PDF protejat cu parolă'));
  const fresh = await P2.loadMupdf({ fresh: true });
  assert.notStrictEqual(fresh, mupdf);
  assert.strictEqual(P2.cleanPage2(fresh, await pdf('vector')).status, 'curatat');
  mupdf = await P2.loadMupdf();
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Rularea: Storage, aceeași cale, același rând, același barem
// ═══════════════════════════════════════════════════════════════════════════
const FREE = 'https://fake.supabase/storage/v1/object/public/content-files-free/';
const PREM = 'https://fake.supabase/storage/v1/object/public/content-files/';
const ID = {
  en1: '11111111-0000-4000-8000-000000000001', en2: '11111111-0000-4000-8000-000000000002', en3: '11111111-0000-4000-8000-000000000003',
  enB: '11111111-0000-4000-8000-000000000004', bac: '11111111-0000-4000-8000-000000000005', fisa: '11111111-0000-4000-8000-000000000006',
  barem1: '11111111-0000-4000-8000-000000000007',
};
const ADMIN = '99999999-9999-4999-8999-999999999999';
async function seed() {
  const supa = createFakeSupabase({
    profiles: [{ id: ADMIN, is_admin: true }, { id: 'eeeeeeee-0000-4000-8000-000000000001', is_admin: false }],
    content: [
      { id: ID.en1, title: 'Evaluare Națională 2025 — Varianta 4', description: 'Subiectul oficial', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf', is_free: true, sort_order: 3, file_url: `${FREE}pdf/evaluare-nationala/1700000000001_en_2025_v4.pdf`, created_at: '2025-06-20T10:00:00Z' },
      { id: ID.en2, title: 'Simulare EN 2026 — ISJ Cluj', category: 'evaluare-nationala', subcategory: 'simulari', content_type: 'pdf', is_free: false, sort_order: 1, file_url: `${PREM}pdf/evaluare-nationala/1700000000002_sim_cluj.pdf`, created_at: '2026-03-01T10:00:00Z' },
      { id: ID.en3, title: 'Simulare EN 2024 — fără dreptunghi', category: 'evaluare-nationala', subcategory: 'simulari', content_type: 'pdf', is_free: true, sort_order: 2, file_url: `${FREE}pdf/evaluare-nationala/1700000000003_sim.pdf`, created_at: '2024-03-01T10:00:00Z' },
      { id: ID.enB, title: 'Barem — EN 2025 Varianta 4', category: 'evaluare-nationala', subcategory: 'bareme', content_type: 'pdf', is_free: true, file_url: `${FREE}pdf/evaluare-nationala/1700000000004_barem.pdf`, created_at: '2025-06-20T10:00:00Z' },
      { id: ID.bac, title: 'BAC 2025 M_mate-info Varianta 2', category: 'bacalaureat', subcategory: 'variante', profile: 'mate-info', content_type: 'pdf', is_free: true, file_url: `${FREE}pdf/bacalaureat/1700000000005_bac.pdf`, created_at: '2025-06-20T10:00:00Z' },
      { id: ID.fisa, title: 'Capitolul 3 — Fracții', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'pdf', is_free: true, file_url: `${FREE}pdf/evaluare-nationala/1700000000006_fisa.pdf`, created_at: '2025-01-01T10:00:00Z' },
    ],
    // baremul asociat (ales de admin) al testului 1 — trebuie să rămână
    ai_pdf_text: [{ content_id: ID.en1, file_url: `${FREE}pdf/evaluare-nationala/1700000000001_en_2025_v4.pdf`, text: 'SUBIECTUL I ...', barem_id: null, barem_status: 'ok_admin', barem_override_id: ID.barem1, barem_override_by: 'admin' }],
    exam_bot_runs: [], app_settings: [],
  });
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000001_en_2025_v4.pdf', await pdf('oficial'));
  supa.db.files.set('content-files/pdf/evaluare-nationala/1700000000002_sim_cluj.pdf', await pdf('vector'));
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000003_sim.pdf', await pdf('faraJos'));
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000004_barem.pdf', await pdf('oficial'));
  supa.db.files.set('content-files-free/pdf/bacalaureat/1700000000005_bac.pdf', await pdf('oficial'));
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000006_fisa.pdf', await pdf('vector'));
  return supa;
}
const file = (supa, key) => supa.db.files.get(key);
const stateOf = (supa, id) => { const r = supa.db.tables.app_settings.find((x) => x.key === `pagina2:${id}`); return r ? r.value : null; };
const ctxOf = (supa, opts = {}) => R.makeCtx(supa, null, { budgetMs: 300000, ...opts });

test('rularea: doar testele de EN (variante + simulări); același fișier, aceeași cale, același rând, același barem; copia originalului', async () => {
  const supa = await seed();
  const rowsBefore = JSON.parse(JSON.stringify(supa.db.tables.content));
  const aiBefore = JSON.parse(JSON.stringify(supa.db.tables.ai_pdf_text));
  const k1 = 'content-files-free/pdf/evaluare-nationala/1700000000001_en_2025_v4.pdf';
  const k2 = 'content-files/pdf/evaluare-nationala/1700000000002_sim_cluj.pdf';
  const orig1 = file(supa, k1), orig2 = file(supa, k2);
  const untouched = ['content-files-free/pdf/evaluare-nationala/1700000000003_sim.pdf', 'content-files-free/pdf/evaluare-nationala/1700000000004_barem.pdf', 'content-files-free/pdf/bacalaureat/1700000000005_bac.pdf', 'content-files-free/pdf/evaluare-nationala/1700000000006_fisa.pdf'].map((k) => [k, sha(file(supa, k))]);

  const ctx = ctxOf(supa);
  const r = await P2R.cleanStep(ctx);
  assert.deepStrictEqual([r.total, r.todo, r.done, r.left], [3, 3, 3, 0], JSON.stringify(r));
  // rândurile din `content` și baremul asociat: neatinse
  assert.deepStrictEqual(supa.db.tables.content, rowsBefore, 'titlul, rubrica, gratuit/premium, ordinea, data, adresa fișierului — la fel');
  assert.deepStrictEqual(supa.db.tables.ai_pdf_text, aiBefore, 'baremul asociat rămâne același');
  // fișierele curățate: în aceeași cale, cu originalul la început (incremental)
  for (const [k, orig] of [[k1, orig1], [k2, orig2]]) {
    const now = file(supa, k);
    assert.notStrictEqual(sha(now), sha(orig), `${k} s-a schimbat`);
    assert.ok(now.subarray(0, orig.length).equals(orig), `${k}: originalul rămâne la început`);
    assert.ok(P2._internals.darkFraction(page2(now), [30, 50, 240, 280], 110) < 0.03, `${k}: fără dreptunghi`);
    assert.deepStrictEqual(pagesText(now), pagesText(orig), `${k}: același text`);
  }
  // celelalte: neatinse (barem, BAC, capitol, simularea fără dreptunghi)
  for (const [k, h] of untouched) assert.strictEqual(sha(file(supa, k)), h, `${k} neatins`);
  // starea + copia originalului (în bucket-ul privat)
  const s1 = stateOf(supa, ID.en1);
  assert.strictEqual(s1.status, 'curatat');
  assert.strictEqual(s1.sha_after, sha(file(supa, k1)));
  assert.strictEqual(s1.sha_before, sha(orig1));
  assert.strictEqual(s1.backup.bucket, 'content-files');
  assert.ok(s1.backup.path.startsWith(`_pagina2-originale/${ID.en1}/`), s1.backup.path);
  assert.ok(file(supa, `content-files/${s1.backup.path}`).equals(orig1), 'copia = originalul');
  assert.strictEqual(stateOf(supa, ID.en2).status, 'curatat');
  assert.strictEqual(stateOf(supa, ID.en3).status, 'fara');
  for (const id of [ID.enB, ID.bac, ID.fisa]) assert.strictEqual(stateOf(supa, id), null);
  assert.ok(ctx.lines.some((l) => /🧽 „Evaluare Națională 2025 — Varianta 4": dreptunghiul de pe pagina 2 a fost scos/.test(l)), ctx.lines.join('\n'));
  assert.strictEqual(ctx.stats.p2_curatate, 2);
  assert.strictEqual(ctx.stats.p2_fara, 1);

  // a doua rulare: nimic de făcut, nimic schimbat
  const uploads = supa.db.uploads.length;
  const r2 = await P2R.cleanStep(ctxOf(supa));
  assert.deepStrictEqual([r2.todo, r2.done], [0, 0]);
  assert.strictEqual(supa.db.uploads.length, uploads, 'nicio urcare');
});

test('rularea: „🔍 caută (fără modificări)" nu schimbă nimic; apoi rularea adevărată curăță', async () => {
  const supa = await seed();
  const before = new Map([...supa.db.files.entries()].map(([k, v]) => [k, sha(v)]));
  const r = await P2R.cleanStep(ctxOf(supa), { dry: true });
  assert.strictEqual(r.done, 3);
  for (const [k, h] of before) assert.strictEqual(sha(supa.db.files.get(k)), h, `${k} neatins`);
  assert.strictEqual(supa.db.uploads.length, 0, 'nicio urcare, nicio copie');
  assert.strictEqual(stateOf(supa, ID.en1).status, 'de_curatat');
  assert.strictEqual(stateOf(supa, ID.en3).status, 'fara');
  // încă o căutare: testele deja verificate nu se mai iau
  assert.strictEqual((await P2R.cleanStep(ctxOf(supa), { dry: true })).todo, 0);
  // rularea adevărată: doar cele „de curățat"
  const r2 = await P2R.cleanStep(ctxOf(supa));
  assert.deepStrictEqual([r2.todo, r2.done], [2, 2]);
  assert.strictEqual(stateOf(supa, ID.en1).status, 'curatat');
  assert.strictEqual(stateOf(supa, ID.en2).status, 'curatat');
});

test('rularea: ↩ restaurează originalul; „curăță din nou" refolosește copia; fișier înlocuit din Admin → luat din nou', async () => {
  const supa = await seed();
  const k1 = 'content-files-free/pdf/evaluare-nationala/1700000000001_en_2025_v4.pdf';
  const orig1 = file(supa, k1);
  await P2R.cleanStep(ctxOf(supa));
  const cleaned = file(supa, k1);
  // restaurarea
  const rr = await P2R.restore(supa, ID.en1, { userId: ADMIN });
  assert.deepStrictEqual(rr, { ok: true, status: 'restaurat' });
  assert.ok(file(supa, k1).equals(orig1), 'originalul e la loc');
  assert.strictEqual(stateOf(supa, ID.en1).status, 'restaurat');
  // un test restaurat nu se mai curăță singur…
  assert.strictEqual((await P2R.cleanStep(ctxOf(supa))).todo, 0);
  // …decât la cerere („🧽 curăță din nou"), cu aceeași copie a originalului
  const copies = () => [...supa.db.files.keys()].filter((k) => k.startsWith(`content-files/_pagina2-originale/${ID.en1}/`));
  assert.strictEqual(copies().length, 1);
  const r = await P2R.cleanStep(ctxOf(supa), { ids: [ID.en1], force: true });
  assert.strictEqual(r.done, 1);
  assert.strictEqual(sha(file(supa, k1)), sha(cleaned));
  assert.strictEqual(stateOf(supa, ID.en1).status, 'curatat');
  assert.strictEqual(copies().length, 1, 'o singură copie a originalului');
  // „forțat" pe un test deja curățat: fișierul e chiar cel curățat → nu-l atinge
  const ups = supa.db.uploads.length;
  await P2R.cleanStep(ctxOf(supa), { ids: [ID.en1], force: true });
  assert.strictEqual(supa.db.uploads.length, ups);
  assert.strictEqual(stateOf(supa, ID.en1).status, 'curatat');
  // adminul înlocuiește fișierul testului (altă cale): testul se ia din nou
  const row = supa.db.tables.content.find((x) => x.id === ID.en1);
  row.file_url = `${FREE}pdf/evaluare-nationala/1800000000001_en_2025_v4_corectat.pdf`;
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1800000000001_en_2025_v4_corectat.pdf', await pdf('imagine'));
  const r3 = await P2R.cleanStep(ctxOf(supa));
  assert.strictEqual(r3.done, 1);
  assert.strictEqual(stateOf(supa, ID.en1).status, 'curatat');
  assert.strictEqual(stateOf(supa, ID.en1).file_url, row.file_url);
  assert.strictEqual(copies().length, 2, 'copia noului original');
  // restaurarea cu altă adresă decât cea curățată: refuzată
  const st = stateOf(supa, ID.en1);
  row.file_url = `${FREE}pdf/evaluare-nationala/1900000000001_alt.pdf`;
  await assert.rejects(() => P2R.restore(supa, ID.en1), (e) => e.status === 409);
  row.file_url = st.file_url;
  // linkurile (semnate) la fișierul de acum și la original
  assert.match((await P2R.link(supa, ID.en1, 'original')).url, /_pagina2-originale/);
  assert.match((await P2R.link(supa, ID.en1, 'acum')).url, /1800000000001_en_2025_v4_corectat/);
});

test('rularea: nesigur / eroare → testul rămâne neatins; o urcare greșită se repară singură; fișierul schimbat între timp nu e suprascris', async () => {
  const supa = await seed();
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000003_sim.pdf', await pdf('formularDeDouaOri'));
  supa.db.files.delete('content-files/pdf/evaluare-nationala/1700000000002_sim_cluj.pdf');
  const k1 = 'content-files-free/pdf/evaluare-nationala/1700000000001_en_2025_v4.pdf';
  const orig1 = file(supa, k1);
  // urcarea fișierului curățat „se strică" (alt conținut ajunge în Storage) → originalul înapoi
  const realFrom = supa.storage.from;
  let broken = 1;     // câte urcări peste test se strică
  supa.storage.from = (bucket) => {
    const b = realFrom(bucket);
    return { ...b, upload: async (p, body, opts) => (broken > 0 && opts && opts.upsert && p.endsWith('_en_2025_v4.pdf') ? (broken--, b.upload(p, Buffer.from(body).subarray(0, 100), opts)) : b.upload(p, body, opts)) };
  };
  const ctx = ctxOf(supa);
  await P2R.cleanStep(ctx);
  assert.strictEqual(stateOf(supa, ID.en1).status, 'eroare');
  assert.match(stateOf(supa, ID.en1).error, /nu se potrivește la verificare — am pus originalul la loc/);
  assert.ok(file(supa, k1).equals(orig1), 'originalul e la loc');
  // se strică și repunerea originalului → mesajul cere „↩ Restaurează", care merge (copia e păstrată)
  broken = 2;
  await P2R.cleanStep(ctxOf(supa), { ids: [ID.en1], force: true });
  supa.storage.from = realFrom;
  assert.match(stateOf(supa, ID.en1).error, /folosește „↩ Restaurează"/);
  assert.ok(!file(supa, k1).equals(orig1));
  await P2R.restore(supa, ID.en1);
  assert.ok(file(supa, k1).equals(orig1), 'restaurat din copie');
  stateOf(supa, ID.en1).status = 'eroare';
  assert.strictEqual(stateOf(supa, ID.en3).status, 'nesigur');
  assert.strictEqual(stateOf(supa, ID.en2).status, 'eroare');
  assert.match(stateOf(supa, ID.en2).error, /nu am putut descărca/);
  assert.strictEqual(stateOf(supa, ID.en2).attempts, 1);
  // erorile se reiau (de cel mult 3 ori la rând); nesigur — nu (până la o versiune nouă a motorului)
  await P2R.cleanStep(ctxOf(supa));
  assert.strictEqual(stateOf(supa, ID.en1).status, 'curatat');
  assert.strictEqual(stateOf(supa, ID.en2).attempts, 2);
  await P2R.cleanStep(ctxOf(supa));
  assert.strictEqual(stateOf(supa, ID.en2).attempts, 3);
  assert.strictEqual((await P2R.cleanStep(ctxOf(supa))).todo, 0, 'după 3 încercări: o dată pe zi');
  assert.ok(P2R.needsWork({ file_url: 'x' }, { status: 'eroare', attempts: 3, file_url: 'x', at: new Date(Date.now() - 2 * 86400000).toISOString() }));
  assert.ok(!P2R.needsWork({ file_url: 'x' }, { status: 'nesigur', v: P2.VERSION, file_url: 'x' }));
  assert.ok(P2R.needsWork({ file_url: 'x' }, { status: 'nesigur', v: P2.VERSION - 1, file_url: 'x' }), 'motor nou → se reia');

  // adminul înlocuiește fișierul chiar în timpul curățării → nu scriem peste
  const supa2 = await seed();
  const real2 = supa2.storage.from;
  supa2.storage.from = (bucket) => {
    const b = real2(bucket);
    return { ...b, download: async (p) => { const r = await b.download(p); if (p.endsWith('_sim_cluj.pdf')) supa2.db.tables.content.find((x) => x.id === ID.en2).file_url = `${PREM}pdf/evaluare-nationala/1800000000002_nou.pdf`; return r; } };
  };
  const k2 = 'content-files/pdf/evaluare-nationala/1700000000002_sim_cluj.pdf';
  const orig2 = file(supa2, k2);
  await P2R.cleanStep(ctxOf(supa2), { ids: [ID.en2] });
  supa2.storage.from = real2;
  assert.ok(file(supa2, k2).equals(orig2), 'fișierul vechi nu e suprascris');
  assert.strictEqual(stateOf(supa2, ID.en2), null);
});

test('rularea: MuPDF cade („memory access out of bounds") → instanță nouă, fișierul se reia', async () => {
  const supa = await seed();
  const real = P2.cleanPage2;
  let calls = 0;
  P2.cleanPage2 = (m, buf, o) => (++calls === 1 ? { status: 'eroare', error: 'RuntimeError: memory access out of bounds', bytes: null } : real(m, buf, o));
  const ctx = ctxOf(supa);
  try { await P2R.cleanStep(ctx, { ids: [ID.en1] }); } finally { P2.cleanPage2 = real; P2R._reset(); }
  assert.strictEqual(stateOf(supa, ID.en1).status, 'curatat');
  assert.ok(ctx.lines.some((l) => /MuPDF a căzut/.test(l)));
  mupdf = await P2.loadMupdf();
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. API-ul și cronul
// ═══════════════════════════════════════════════════════════════════════════
test('api/exam-bot: pagina2_status / _step (cu și fără modificări) / _restore / _link / _settings — doar adminul', async () => {
  const supa = await seed();
  const orig = { admin: http.admin, authUser: http.authUser };
  let uid = 'eeeeeeee-0000-4000-8000-000000000001';
  http.admin = () => supa;
  http.authUser = async () => uid;
  delete require.cache[require.resolve('../api/exam-bot')];
  const handler = require('../api/exam-bot');
  const call = async (body) => { const res = fakeRes(); await handler({ method: 'POST', body, query: {}, headers: {} }, res); return res; };
  try {
    assert.strictEqual((await call({ action: 'pagina2_status' })).statusCode, 403, 'un elev nu vede botul');
    uid = ADMIN;
    let res = await call({ action: 'pagina2_status' });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepStrictEqual([res.body.counts.total, res.body.counts.neverificat], [3, 3]);
    assert.strictEqual(res.body.settings.auto, true, 'implicit: cronul îl rulează singur');
    // caută fără modificări
    res = await call({ action: 'pagina2_step', dry: true });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.done, true);
    const dryRun = supa.db.tables.exam_bot_runs.find((x) => x.id === res.body.runId);
    assert.deepStrictEqual([dryRun.kind, dryRun.note, dryRun.status], ['pagina2', 'fără modificări', 'ok']);
    res = await call({ action: 'pagina2_status' });
    assert.deepStrictEqual([res.body.counts.de_curatat, res.body.counts.fara], [2, 1]);
    // lacătul: alt pas al botului „rulează" → 409
    supa.db.tables.exam_bot_runs.push({ id: 'cccccccc-0000-4000-8000-000000000001', kind: 'descoperire', by: 'cron', status: 'ruleaza', started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), stats: {}, log: [] });
    assert.strictEqual((await call({ action: 'pagina2_step' })).statusCode, 409);
    supa.db.tables.exam_bot_runs.find((x) => x.id === 'cccccccc-0000-4000-8000-000000000001').status = 'ok';
    // scoate dreptunghiul
    res = await call({ action: 'pagina2_step' });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.progress.done, 2);
    assert.ok(res.body.log.some((l) => /🧽/.test(l)));
    res = await call({ action: 'pagina2_status' });
    assert.strictEqual(res.body.counts.curatat, 2);
    const row = res.body.rows.find((x) => x.id === ID.en1);
    assert.strictEqual(row.status, 'curatat');
    assert.strictEqual(row.backup, true);
    assert.match(row.kindsText, /mască/);
    // linkuri, restaurare, setări
    res = await call({ action: 'pagina2_link', contentId: ID.en1, which: 'original' });
    assert.match(res.body.url, /_pagina2-originale/);
    res = await call({ action: 'pagina2_restore', contentId: ID.en1 });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.status, 'restaurat');
    assert.strictEqual((await call({ action: 'pagina2_restore', contentId: ID.en3 })).statusCode, 404, 'fără copie: nimic de restaurat');
    assert.strictEqual((await call({ action: 'pagina2_restore' })).statusCode, 400);
    res = await call({ action: 'pagina2_settings', value: { auto: false } });
    assert.deepStrictEqual(res.body.settings, { auto: false });
    assert.deepStrictEqual(supa.db.tables.app_settings.find((x) => x.key === 'pagina2').value, { auto: false });
  } finally {
    http.admin = orig.admin; http.authUser = orig.authUser;
    delete require.cache[require.resolve('../api/exam-bot')];
  }
});

test('cronul: curăță singur testele noi (și cu botul de examene oprit); oprit din setări → nu; fără nimic de făcut → nicio urmă în jurnal', async () => {
  const supa = await seed();
  supa.db.tables.app_settings.push({ key: 'exam_bot', value: { enabled: false } });
  // tabelele botului (setupInfo): goale, dar existente
  Object.assign(supa.db.tables, { exam_bot_items: [], exam_bot_index: [], exam_bot_pages: [] });
  let r = await R.cron(supa);
  assert.strictEqual(r.skipped, 'oprit din setări');
  assert.strictEqual(r.pagina2.left, 0, JSON.stringify(r));
  assert.strictEqual(stateOf(supa, ID.en1).status, 'curatat');
  assert.strictEqual(stateOf(supa, ID.en1).by, 'cron');
  const runs = supa.db.tables.exam_bot_runs.filter((x) => x.kind === 'pagina2');
  assert.strictEqual(runs.length, 1);
  assert.deepStrictEqual([runs[0].by, runs[0].status], ['cron', 'ok']);
  assert.strictEqual(runs[0].stats.p2_curatate, 2);
  // nimic nou → nicio rulare nouă în jurnal
  r = await R.cron(supa);
  assert.strictEqual(r.pagina2.nimic, true);
  assert.strictEqual(supa.db.tables.exam_bot_runs.filter((x) => x.kind === 'pagina2').length, 1);
  // un test nou + cronul oprit din setări → rămâne cum e
  supa.db.tables.content.push({ id: '11111111-0000-4000-8000-000000000009', title: 'Simulare EN 2027', category: 'evaluare-nationala', subcategory: 'simulari', content_type: 'pdf', is_free: true, file_url: `${FREE}pdf/evaluare-nationala/1900000000009_sim.pdf`, created_at: '2026-11-07T10:00:00Z' });
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1900000000009_sim.pdf', await pdf('vector'));
  await P2R.saveSettings(supa, { auto: false });
  r = await R.cron(supa);
  assert.deepStrictEqual(r.pagina2, { sarit: 'oprit din setări' });
  assert.strictEqual(stateOf(supa, '11111111-0000-4000-8000-000000000009'), null);
  await P2R.saveSettings(supa, { auto: true });
  r = await R.cron(supa);
  assert.strictEqual(stateOf(supa, '11111111-0000-4000-8000-000000000009').status, 'curatat');
  // în codul cronului, pasul vine după publicare (testele noi se curăță în aceeași rulare)
  const src = read('api/_lib/examBotRun.js');
  const c = src.slice(src.indexOf('async function cron('));
  assert.ok(c.indexOf("step('descoperire'") < c.indexOf('out.pagina2 = await pagina2()'));
  assert.ok(c.indexOf('out.pagina2 = await pagina2()') < c.indexOf("step('bareme'"));
});

test('fără SQL nou: starea în app_settings, copia originalului în content-files (privat), mupdf în pachetul funcției', () => {
  const run = read('api/_lib/pagina2Run.js');
  assert.doesNotMatch(run, /create table/i);
  assert.match(run, /BACKUP_BUCKET = 'content-files'/);
  assert.ok(!fs.readdirSync(path.join(__dirname, '..', 'supabase')).some((f) => /pagina2/i.test(f)), 'nicio tabelă nouă');
  const v = JSON.parse(read('vercel.json'));
  assert.ok(v.functions['api/**/*.js'].includeFiles.includes('api/_lib/**'));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'node_modules', 'mupdf', 'dist', 'mupdf-wasm.wasm')));
  const ui = read('src/components/AdminBotExamene.jsx');
  assert.match(ui, /AdminPagina2/);
  const p2ui = read('src/components/AdminPagina2.jsx');
  for (const a of ["'pagina2_status'", "'pagina2_step'", "'pagina2_restore'", "'pagina2_link'", "'pagina2_settings'"]) assert.ok(p2ui.includes(a), a);
});
