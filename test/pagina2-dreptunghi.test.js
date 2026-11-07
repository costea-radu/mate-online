// =====================================================================
// test/pagina2-dreptunghi.test.js — ⬜ alb peste dreptunghiul negru de pe pagina 2
// (testele de EN): motorul (api/_lib/pagina2.js), rularea cu Storage
// (api/_lib/pagina2Run.js — copia albă, originalul neatins), linkul copiei în
// api/get-file-url.js, API-ul (api/exam-bot.js), cronul și butonul din vizualizator.
//
// PDF-urile sunt sintetice, făcute aici, după felurile reale în care e desenat
// dreptunghiul (subiectele oficiale: desen + ramă + mască; simulările ISJ: un
// dreptunghi plin; imagini negre; pagini scanate; formulare; drumuri compuse),
// plus conținut „dezechilibrat" (q / Q, BT, BDC rămase deschise) și o pagină rotită.
// =====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { PDFDocument, StandardFonts, rgb, PDFName, degrees } = require('pdf-lib');

const P2 = require('../api/_lib/pagina2');
const P2R = require('../api/_lib/pagina2Run');
const ALB = require('../api/_lib/pagina2Alb');
const R = require('../api/_lib/examBotRun');
const http = require('../api/_lib/http');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const enc = (s) => new TextEncoder().encode(s);
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
function rawPage(doc, content, opts = {}, size = [W, H]) {
  const page = doc.addPage(size);
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
  // același formular desenat de două ori pe pagina 2 (a doua oară în afara paginii)
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
  // drum compus: dreptunghiul + rama instrucțiunilor într-un singur f*
  drumCompus: async () => { const { doc, font, ref } = await base(); rawPage(doc, header + '0 g 32 550 225 242 re 300 600 250 110 re 301 601 248 108 re f*\n' + instr + subiectul, { fonts: { F1: ref } }); return finish(doc, font); },
  // linia antetului la 1 pt deasupra dreptunghiului: rămâne
  antetLipit: async () => { const { doc, font, ref } = await base(); rawPage(doc, '0 g 20 803 540 0.6 re f\n' + '0 g 25 559 229 243 re f\n' + instr + subiectul, { fonts: { F1: ref } }); return finish(doc, font); },
  // text desenat ÎNAINTEA dreptunghiului (era ascuns): rămâne ascuns sub alb
  textAscuns: async () => { const { doc, font, ref } = await base(); rawPage(doc, '0.5 g ' + text('Numele elevului ............', 40, 760, 10) + text('Scoala ............', 40, 740, 10) + box + instr + subiectul, { fonts: { F1: ref } }); return finish(doc, font); },
  chenarLinii: async () => {
    const { doc, font, ref } = await base();
    rawPage(doc, header + '0 g 30 555 229 242 re f\n' + '0 G 0.6 w 25 802 m 264 802 l S 25 550 m 264 550 l S 25 550 m 25 802 l S 264 550 m 264 802 l S\n' + instr + subiectul, { fonts: { F1: ref } });
    return finish(doc, font);
  },
  // conținut care lasă starea grafică schimbată la sfârșit: un „cm" la nivelul paginii,
  // apoi un „q … cm" neînchis (fără echilibrarea q / Q, albul s-ar desena mărit și mutat)
  qNeinchis: async () => { const { doc, font, ref } = await base(); rawPage(doc, header + box + instr + subiectul + '2 0 0 2 -300 -400 cm q 0.5 0 0 0.5 10 10 cm 0.3 g\n', { fonts: { F1: ref } }); return finish(doc, font); },
  // conținut cu un „Q" în plus la început (unele generatoare) + text / strat opțional rămase deschise
  qInPlus: async () => { const { doc, font, ref } = await base(); rawPage(doc, 'Q Q ' + header + box + instr + subiectul + '/OC /Strat BDC BT /F1 9 Tf 40 300 Td (Q q) Tj\n', { fonts: { F1: ref } }); return finish(doc, font); },
  // pagina 2 rotită (/Rotate 90): pe ecran arată ca celelalte, dreptunghiul tot sus-stânga
  rotit: async () => {
    const { doc, font, ref } = await base();
    const p = rawPage(doc, 'q 0 1 -1 0 842 0 cm\n' + header + box + instr + subiectul + 'Q\n', { fonts: { F1: ref } }, [H, W]);
    p.setRotation(degrees(90));
    return finish(doc, font);
  },
  // fără dreptunghi: un desen negru mare, dar jos; un pătrat negru mic sus-stânga
  faraJos: async () => { const { doc, font, ref } = await base(); rawPage(doc, header + instr + subiectul + '0 g 100 100 m 300 100 l 200 300 l h f\n0 g 300 150 180 180 re f\n', { fonts: { F1: ref } }); return finish(doc, font); },
  faraMic: async () => { const { doc, font, ref } = await base(); rawPage(doc, header + '0 g 30 700 50 50 re f\n' + instr + subiectul, { fonts: { F1: ref } }); return finish(doc, font); },
  oPagina: async () => { const doc = await PDFDocument.create(); doc.addPage([W, H]).drawText('o pagina', { x: 50, y: 700, size: 12, font: await doc.embedFont(StandardFonts.Helvetica) }); return Buffer.from(await doc.save()); },
};
const cache = new Map();
const pdf = async (k) => { if (!cache.has(k)) cache.set(k, await MAKE[k]()); return cache.get(k); };

// ─── ce verificăm la fiecare variantă albă ───────────────────────────────────
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
async function assertAlb(name) {
  const buf = await pdf(name);
  const r = P2.albPage2(mupdf, buf);
  assert.strictEqual(r.status, 'curatat', `${name}: ${r.error || JSON.stringify(r.check)}`);
  assert.ok(r.bytes && r.bytes.length > buf.length, `${name}: PDF nou`);
  assert.ok(Buffer.from(r.bytes.subarray(0, buf.length)).equals(buf), `${name}: salvare incrementală — octeții originalului rămân la început`);
  assert.strictEqual(r.incremental, true);
  assert.ok(r.bytes.length - buf.length < 4000, `${name}: doar o actualizare mică (${r.bytes.length - buf.length} B)`);
  assert.strictEqual(r.check.ok, true);
  assert.strictEqual(r.check.diffOutside, 0, `${name}: în afara albului, pagina 2 e identică`);
  assert.strictEqual(r.check.otherPagesDiff, 0, `${name}: celelalte pagini sunt identice`);
  assert.ok(r.box[0] <= r.rect[0] && r.box[1] <= r.rect[1] && r.box[2] >= r.rect[2] && r.box[3] >= r.rect[3], `${name}: albul acoperă tot dreptunghiul`);
  const after = page2(r.bytes);
  assert.ok(P2._internals.darkFraction(after, r.rect, 110) <= 0.001, `${name}: în dreptunghi e alb`);
  assert.ok(P2._internals.inkFraction(after, r.rect) <= 0.002, `${name}: spațiu gol, alb (nici ce era sub el nu se vede)`);
  assert.deepStrictEqual(pagesText(r.bytes), pagesText(buf), `${name}: textul tuturor paginilor e același`);
  const again = P2.albPage2(mupdf, r.bytes);
  assert.strictEqual(again.status, 'fara', `${name}: a doua trecere nu mai găsește nimic`);
  const pl = await PDFDocument.load(r.bytes);
  assert.strictEqual(pl.getPageCount(), (await PDFDocument.load(buf)).getPageCount(), `${name}: pdf-lib îl citește`);
  return r;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Motorul: alb lipit peste dreptunghi, restul neatins
// ═══════════════════════════════════════════════════════════════════════════
test('motorul: subiectele oficiale (desen + ramă + mască) — alb peste dreptunghi, restul neatins', async () => {
  const r = await assertAlb('oficial');
  assert.ok(Math.abs(r.rect[0] - 24.5) < 1.5 && Math.abs(r.rect[1] - 41) < 1.5, JSON.stringify(r.rect));
});
test('motorul: simulările ISJ, imaginea neagră, chenarul din linii, drumul compus, textul ascuns sub dreptunghi', async () => {
  for (const k of ['vector', 'imagine', 'chenarLinii', 'drumCompus', 'textAscuns']) await assertAlb(k);
});
test('motorul: linia antetului lipită de dreptunghi rămâne; la scanări albul ia și rama / umbra, nu și antetul', async () => {
  const a = await assertAlb('antetLipit');
  assert.ok(a.box[1] > 38.95, `linia antetului (38,4–39 pt) nu e acoperită: ${JSON.stringify(a.box)}`);
  const s1 = await assertAlb('scanat');
  assert.ok(s1.box[0] <= s1.rect[0] && s1.box[2] >= s1.rect[2]);
  const s2 = await assertAlb('scanatChenar');
  assert.ok(s2.box[1] > 43.5, `linia antetului (1,5 pt deasupra) nu e acoperită: ${JSON.stringify(s2.box)}`);
  assert.ok(s2.box[2] >= 267.8, 'chenarul din dreapta e acoperit');
});
test('motorul: formulare — oricum ar fi desenat dreptunghiul, albul vine deasupra (și la formularul desenat de două ori)', async () => {
  for (const k of ['formular', 'paginaInFormular', 'formularInFormular', 'formularDeDouaOri', 'formularComun']) await assertAlb(k);
});
test('motorul: conținut dezechilibrat (q neînchis, Q în plus, BT / BDC deschise) și pagina rotită', async () => {
  for (const k of ['qNeinchis', 'qInPlus', 'rotit']) await assertAlb(k);
});
test('motorul: q / Q, BT / ET, BDC / EMC numărate corect (șirurile, comentariile, imaginile inline nu contează)', () => {
  const { contentBalance: bal, wrapContent: wrap } = P2._internals;
  assert.deepStrictEqual(bal(enc('q q 1 0 0 1 5 5 cm Q')), { depth: 1, minDepth: 0, inText: false, pathOpen: false, mc: 0 });
  assert.deepStrictEqual(bal(enc('Q q')), { depth: 0, minDepth: -1, inText: false, pathOpen: false, mc: 0 });
  assert.strictEqual(bal(enc('BT (q Q q) Tj [(Q) 3 (q)] TJ ET % q q q\nq')).depth, 1, 'șirurile, tablourile și comentariile nu sunt operatori');
  assert.strictEqual(bal(enc('<</Q 1 /q 2>> BDC EMC q')).depth, 1, 'numele din dicționare nu sunt operatori');
  assert.strictEqual(bal(enc('q BI /W 4 /H 1 /BPC 8 /CS /G ID QQ Q EI Q Q')).depth, -1, 'datele imaginii inline nu sunt operatori');
  assert.deepStrictEqual(bal(enc('/OC /X BDC BT 0 0 m 5 5 l')), { depth: 0, minDepth: 0, inText: true, pathOpen: true, mc: 1 });
  assert.strictEqual(bal(enc('0 0 m 5 5 l S')).pathOpen, false);
  const w = wrap({ depth: 2, minDepth: -1, inText: true, pathOpen: true, mc: 1 }, 'ALB');
  assert.strictEqual(w.pre, 'q\nq\n', 'o „q" pentru „Q"-ul în plus + una a noastră');
  assert.strictEqual(w.post, '\nET\nn\nEMC\nQ\nQ\nQ\nQ\nALB\n', 'se închide tot, apoi revine exact la începutul paginii');
  const plain = wrap({ depth: 0, minDepth: 0, inText: false, pathOpen: false, mc: 0 }, 'ALB');
  assert.deepStrictEqual(plain, { pre: 'q\n', post: '\nQ\nALB\n' });
});
test('motorul: fără dreptunghi pe pagina 2 → „fara" (nimic de schimbat)', async () => {
  for (const k of ['faraJos', 'faraMic', 'oPagina']) {
    const r = P2.albPage2(mupdf, await pdf(k));
    assert.strictEqual(r.status, 'fara', k);
    assert.strictEqual(r.bytes, null);
  }
  assert.match(P2.albPage2(mupdf, await pdf('oPagina')).notes.join(' '), /nu are pagina 2/);
  const bad = P2.albPage2(mupdf, Buffer.from('nu e un PDF'));
  assert.strictEqual(bad.status, 'eroare');
});
test('motorul: fără erori MuPDF (fiecare lasă ~70 de octeți din stiva WebAssembly) și cu instanță nouă la nevoie', async () => {
  const e0 = P2.mupdfErrors();
  for (const k of ['oficial', 'paginaInFormular', 'formularInFormular', 'scanat', 'rotit']) P2.albPage2(mupdf, await pdf(k));
  assert.strictEqual(P2.mupdfErrors() - e0, 0);
  assert.ok(P2.isWasmCrash('RuntimeError: memory access out of bounds'));
  assert.ok(!P2.isWasmCrash('PDF protejat cu parolă'));
  const fresh = await P2.loadMupdf({ fresh: true });
  assert.notStrictEqual(fresh, mupdf);
  assert.strictEqual(P2.albPage2(fresh, await pdf('vector')).status, 'curatat');
  mupdf = await P2.loadMupdf();
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Rularea: originalul neatins, copia albă în alt loc
// ═══════════════════════════════════════════════════════════════════════════
const FREE = 'https://fake.supabase/storage/v1/object/public/content-files-free/';
const PREM = 'https://fake.supabase/storage/v1/object/public/content-files/';
const ID = {
  en1: '11111111-0000-4000-8000-000000000001', en2: '11111111-0000-4000-8000-000000000002', en3: '11111111-0000-4000-8000-000000000003',
  enB: '11111111-0000-4000-8000-000000000004', bac: '11111111-0000-4000-8000-000000000005', fisa: '11111111-0000-4000-8000-000000000006',
  barem1: '11111111-0000-4000-8000-000000000007',
};
const K1 = 'content-files-free/pdf/evaluare-nationala/1700000000001_en_2025_v4.pdf';
const K2 = 'content-files/pdf/evaluare-nationala/1700000000002_sim_cluj.pdf';
const ADMIN = '99999999-9999-4999-8999-999999999999';
const ELEV = 'eeeeeeee-0000-4000-8000-000000000001';
const ABONAT = 'eeeeeeee-0000-4000-8000-000000000002';
async function seed() {
  const supa = createFakeSupabase({
    profiles: [{ id: ADMIN, is_admin: true }, { id: ELEV, is_admin: false }, { id: ABONAT, is_admin: false, subscription_status: 'active' }],
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
  supa.db.files.set(K1, await pdf('oficial'));
  supa.db.files.set(K2, await pdf('vector'));
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000003_sim.pdf', await pdf('faraJos'));
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000004_barem.pdf', await pdf('oficial'));
  supa.db.files.set('content-files-free/pdf/bacalaureat/1700000000005_bac.pdf', await pdf('oficial'));
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000006_fisa.pdf', await pdf('vector'));
  // fiecare urcare, cu upsert-ul ei (o scriere PESTE ceva = upsert)
  supa.db.puts = [];
  const real = supa.storage.from;
  supa.storage.from = (bucket) => { const b = real(bucket); return { ...b, upload: async (p, body, opts = {}) => { supa.db.puts.push({ key: `${bucket}/${p}`, upsert: !!opts.upsert }); return b.upload(p, body, opts); } }; };
  return supa;
}
const file = (supa, key) => supa.db.files.get(key);
const stateOf = (supa, id) => { const r = supa.db.tables.app_settings.find((x) => x.key === `pagina2:${id}`); return r ? r.value : null; };
const setState = (supa, id, value) => { supa.db.tables.app_settings = supa.db.tables.app_settings.filter((x) => x.key !== `pagina2:${id}`); supa.db.tables.app_settings.push({ key: `pagina2:${id}`, value }); };
const ctxOf = (supa, opts = {}) => R.makeCtx(supa, null, { budgetMs: 300000, ...opts });

test('rularea: doar testele de EN; ORIGINALUL RĂMÂNE NEATINS; varianta albă e o copie în același bucket; același rând, același barem', async () => {
  const supa = await seed();
  const rowsBefore = JSON.parse(JSON.stringify(supa.db.tables.content));
  const aiBefore = JSON.parse(JSON.stringify(supa.db.tables.ai_pdf_text));
  const filesBefore = new Map([...supa.db.files.entries()].map(([k, v]) => [k, sha(v)]));

  const ctx = ctxOf(supa);
  const r = await P2R.cleanStep(ctx);
  assert.deepStrictEqual([r.total, r.todo, r.done, r.left], [3, 3, 3, 0], JSON.stringify(r));
  // nimic din ce exista nu s-a schimbat: fișierele, rândurile din `content`, baremul asociat
  for (const [k, h] of filesBefore) assert.strictEqual(sha(file(supa, k)), h, `${k} neatins`);
  assert.deepStrictEqual(supa.db.tables.content, rowsBefore, 'titlul, rubrica, gratuit/premium, ordinea, data, adresa fișierului — la fel');
  assert.deepStrictEqual(supa.db.tables.ai_pdf_text, aiBefore, 'baremul asociat rămâne același');
  assert.ok(supa.db.puts.every((p) => !p.upsert), 'nicio scriere peste un fișier existent');
  assert.strictEqual(supa.db.puts.length, 2, 'doar cele două copii albe');
  // copiile albe: în bucket-ul originalului (gratuit / premium), în _pagina2-alb/<id>/
  for (const [id, key, bucket] of [[ID.en1, K1, 'content-files-free'], [ID.en2, K2, 'content-files']]) {
    const st = stateOf(supa, id);
    assert.strictEqual(st.status, 'curatat');
    assert.strictEqual(st.v, P2.VERSION);
    assert.strictEqual(st.alb.bucket, bucket, 'aceleași reguli de acces ca originalul');
    assert.ok(st.alb.path.startsWith(`_pagina2-alb/${id}/`), st.alb.path);
    assert.ok(st.alb.path.endsWith(key.split('/').pop()), 'același nume de fișier, cu amprenta în față');
    const alb = file(supa, `${bucket}/${st.alb.path}`);
    const orig = file(supa, key);
    assert.strictEqual(sha(alb), st.alb.sha);
    assert.strictEqual(st.sha_before, sha(orig));
    assert.ok(alb.subarray(0, orig.length).equals(orig), 'copia = originalul + o actualizare mică');
    assert.ok(P2._internals.darkFraction(page2(alb), st.rect, 110) <= 0.001, 'în copie, alb peste dreptunghi');
    assert.deepStrictEqual(pagesText(alb), pagesText(orig));
  }
  assert.strictEqual(stateOf(supa, ID.en3).status, 'fara');
  for (const id of [ID.enB, ID.bac, ID.fisa]) assert.strictEqual(stateOf(supa, id), null);
  assert.ok(ctx.lines.some((l) => /⬜ „Evaluare Națională 2025 — Varianta 4": varianta fără suprafața neagră e gata/.test(l)), ctx.lines.join('\n'));
  assert.strictEqual(ctx.stats.p2_curatate, 2);
  assert.strictEqual(ctx.stats.p2_fara, 1);

  // a doua rulare: nimic de făcut, nimic schimbat
  const puts = supa.db.puts.length;
  const r2 = await P2R.cleanStep(ctxOf(supa));
  assert.deepStrictEqual([r2.todo, r2.done], [0, 0]);
  assert.strictEqual(supa.db.puts.length, puts, 'nicio urcare');
});

test('rularea: „🔍 caută (fără modificări)" nu scrie nimic; apoi rularea adevărată face copiile', async () => {
  const supa = await seed();
  const r = await P2R.cleanStep(ctxOf(supa), { dry: true });
  assert.strictEqual(r.done, 3);
  assert.strictEqual(supa.db.puts.length, 0, 'nicio urcare');
  assert.strictEqual(stateOf(supa, ID.en1).status, 'de_curatat');
  assert.strictEqual(stateOf(supa, ID.en3).status, 'fara');
  assert.strictEqual((await P2R.cleanStep(ctxOf(supa), { dry: true })).todo, 0, 'testele deja verificate nu se mai iau');
  const r2 = await P2R.cleanStep(ctxOf(supa));
  assert.deepStrictEqual([r2.todo, r2.done], [2, 2]);
  assert.strictEqual(stateOf(supa, ID.en1).status, 'curatat');
  assert.strictEqual(stateOf(supa, ID.en2).status, 'curatat');
});

test('rularea: 🙈 ascunde / 👁 arată varianta albă; linkurile; fișier înlocuit din Admin → copie nouă, cea veche ștearsă', async () => {
  const supa = await seed();
  await P2R.cleanStep(ctxOf(supa));
  const st1 = stateOf(supa, ID.en1);
  assert.deepStrictEqual(await P2R.hide(supa, ID.en1, true, { userId: ADMIN }), { ok: true, hidden: true });
  let rep = await P2R.status(supa);
  assert.strictEqual(rep.rows.find((x) => x.id === ID.en1).status, 'ascuns');
  assert.strictEqual(rep.counts.ascuns, 1);
  assert.strictEqual(await ALB.albOf(supa, supa.db.tables.content.find((x) => x.id === ID.en1)), null, 'ascunsă → vizualizatorul arată doar originalul');
  // o rulare forțată păstrează alegerea adminului
  await P2R.cleanStep(ctxOf(supa), { ids: [ID.en1], force: true });
  assert.strictEqual(stateOf(supa, ID.en1).hidden, true);
  await P2R.hide(supa, ID.en1, false);
  rep = await P2R.status(supa);
  assert.strictEqual(rep.rows.find((x) => x.id === ID.en1).status, 'curatat');
  assert.ok(await ALB.albOf(supa, supa.db.tables.content.find((x) => x.id === ID.en1)));
  await assert.rejects(() => P2R.hide(supa, ID.en3, true), (e) => e.status === 404, 'fără variantă albă: nimic de ascuns');
  // linkurile (semnate): originalul = fișierul testului, varianta albă = copia
  assert.match((await P2R.link(supa, ID.en1, 'original')).url, /1700000000001_en_2025_v4\.pdf/);
  assert.doesNotMatch((await P2R.link(supa, ID.en1, 'original')).url, /_pagina2-alb/);
  assert.match((await P2R.link(supa, ID.en1, 'alb')).url, new RegExp(`_pagina2-alb/${ID.en1}/`));
  await assert.rejects(() => P2R.link(supa, ID.en3, 'alb'), (e) => e.status === 404);
  // adminul înlocuiește fișierul testului (altă cale): copie nouă, cea veche ștearsă
  const row = supa.db.tables.content.find((x) => x.id === ID.en1);
  row.file_url = `${FREE}pdf/evaluare-nationala/1800000000001_en_2025_v4_corectat.pdf`;
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1800000000001_en_2025_v4_corectat.pdf', await pdf('imagine'));
  assert.strictEqual(await ALB.albOf(supa, row), null, 'copia veche nu e a fișierului nou');
  const r3 = await P2R.cleanStep(ctxOf(supa));
  assert.strictEqual(r3.done, 1);
  const st2 = stateOf(supa, ID.en1);
  assert.strictEqual(st2.status, 'curatat');
  assert.strictEqual(st2.file_url, row.file_url);
  assert.notStrictEqual(st2.alb.path, st1.alb.path);
  assert.ok(st2.alb.path.endsWith('1800000000001_en_2025_v4_corectat.pdf'));
  assert.ok(supa.db.removed.includes(`content-files-free/${st1.alb.path}`), 'copia veche e ștearsă');
  assert.ok(!supa.db.removed.some((k) => !k.includes('/_pagina2-alb/')), 'doar copii albe șterse');
});

test('rularea: eroare / nesigur → rămâne doar originalul; erorile se reiau (de 3 ori, apoi o dată pe zi)', async () => {
  const supa = await seed();
  supa.db.files.delete(K2);                                   // nu se poate descărca
  const realFrom = supa.storage.from;
  let failUp = true;                                          // urcarea copiei albe a testului 1 eșuează o dată
  supa.storage.from = (bucket) => { const b = realFrom(bucket); return { ...b, upload: async (p, body, opts) => (failUp && p.includes('_pagina2-alb/') ? (failUp = false, { data: null, error: { message: 'Bucket is full' } }) : b.upload(p, body, opts)) }; };
  const orig1 = file(supa, K1);
  await P2R.cleanStep(ctxOf(supa));
  assert.strictEqual(stateOf(supa, ID.en1).status, 'eroare');
  assert.match(stateOf(supa, ID.en1).error, /urcarea variantei albe a eșuat \(Bucket is full\) — originalul a rămas neatins/);
  assert.ok(file(supa, K1).equals(orig1));
  assert.strictEqual(await ALB.albOf(supa, supa.db.tables.content.find((x) => x.id === ID.en1)), null);
  assert.strictEqual(stateOf(supa, ID.en2).status, 'eroare');
  assert.match(stateOf(supa, ID.en2).error, /nu am putut descărca/);
  assert.strictEqual(stateOf(supa, ID.en2).attempts, 1);
  await P2R.cleanStep(ctxOf(supa));
  assert.strictEqual(stateOf(supa, ID.en1).status, 'curatat', 'se reia singur');
  assert.strictEqual(stateOf(supa, ID.en2).attempts, 2);
  await P2R.cleanStep(ctxOf(supa));
  assert.strictEqual(stateOf(supa, ID.en2).attempts, 3);
  assert.strictEqual((await P2R.cleanStep(ctxOf(supa))).todo, 0, 'după 3 încercări: o dată pe zi');
  assert.ok(P2R.needsWork({ file_url: 'x' }, { v: P2.VERSION, status: 'eroare', attempts: 3, file_url: 'x', at: new Date(Date.now() - 2 * 86400000).toISOString() }));
  assert.ok(!P2R.needsWork({ file_url: 'x' }, { v: P2.VERSION, status: 'nesigur', file_url: 'x' }));
  assert.ok(!P2R.needsWork({ file_url: 'x' }, { v: P2.VERSION, status: 'fara', file_url: 'x' }));
  assert.ok(P2R.needsWork({ file_url: 'x' }, { v: 1, status: 'fara', file_url: 'x' }), 'starea versiunii vechi a botului → se reia');
  assert.ok(P2R.needsWork({ file_url: 'x' }, { v: 1, status: 'eroare', attempts: 3, file_url: 'x', at: new Date().toISOString() }));

  // nesigur (verificarea prin randare n-a ieșit curat) → nimic urcat, doar originalul
  const supa2 = await seed();
  const real = P2.albPage2;
  P2.albPage2 = () => ({ status: 'nesigur', error: 's-au schimbat 3 pixeli în afara dreptunghiului', rect: [1, 2, 3, 4], bytes: null, notes: [] });
  try { await P2R.cleanStep(ctxOf(supa2), { ids: [ID.en1] }); } finally { P2.albPage2 = real; }
  assert.strictEqual(stateOf(supa2, ID.en1).status, 'nesigur');
  assert.strictEqual(supa2.db.puts.length, 0);
  assert.strictEqual(await ALB.albOf(supa2, supa2.db.tables.content.find((x) => x.id === ID.en1)), null);
});

test('rularea: versiunea veche a botului scrisese peste original → originalul pus la loc din copia ei, apoi varianta albă', async () => {
  const supa = await seed();
  const orig1 = file(supa, K1), orig2 = file(supa, K2);
  // testul 1: curățat „în același loc" de versiunea veche (la o rulare a cronului de dinainte de actualizare)
  const v1Bytes = Buffer.from(P2.albPage2(mupdf, orig1).bytes);
  supa.db.files.set(K1, v1Bytes);
  const back1 = `_pagina2-originale/${ID.en1}/${sha(orig1).slice(0, 12)}_1700000000001_en_2025_v4.pdf`;
  supa.db.files.set(`content-files/${back1}`, orig1);
  setState(supa, ID.en1, { v: 1, status: 'curatat', file_url: supa.db.tables.content.find((x) => x.id === ID.en1).file_url, sha_before: sha(orig1), sha_after: sha(v1Bytes), backup: { bucket: 'content-files', path: back1, sha: sha(orig1) } });
  // testul 2: „eroare — am pus originalul la loc" (fișierul e originalul)
  const back2 = `_pagina2-originale/${ID.en2}/${sha(orig2).slice(0, 12)}_1700000000002_sim_cluj.pdf`;
  supa.db.files.set(`content-files/${back2}`, orig2);
  setState(supa, ID.en2, { v: 1, status: 'eroare', error: 'fișierul urcat nu se potrivește la verificare — am pus originalul la loc', attempts: 1, file_url: supa.db.tables.content.find((x) => x.id === ID.en2).file_url, backup: { bucket: 'content-files', path: back2, sha: sha(orig2) } });
  // raportul: stările vechi apar „neverificate" (de făcut), nu ca erori
  const rep0 = await P2R.status(supa);
  assert.deepStrictEqual([rep0.counts.eroare, rep0.counts.curatat, rep0.counts.neverificat], [0, 0, 3]);

  // „fără modificări": nu scrie nimic, dar ține minte că originalul trebuie pus la loc
  await P2R.cleanStep(ctxOf(supa), { dry: true });
  assert.strictEqual(supa.db.puts.length, 0);
  assert.ok(file(supa, K1).equals(v1Bytes));
  assert.strictEqual(stateOf(supa, ID.en1).status, 'de_curatat');
  assert.ok(stateOf(supa, ID.en1).v1 && stateOf(supa, ID.en1).v1.backup, 'datele versiunii vechi rămân');
  assert.strictEqual(stateOf(supa, ID.en2).v1, undefined, 'testul 2 are originalul la locul lui');

  const ctx = ctxOf(supa);
  await P2R.cleanStep(ctx);
  assert.ok(file(supa, K1).equals(orig1), 'originalul e la loc');
  assert.ok(file(supa, K2).equals(orig2), 'neatins');
  assert.deepStrictEqual(supa.db.puts.filter((p) => p.upsert).map((p) => p.key), [K1], 'singura scriere peste ceva: originalul pus la loc');
  for (const id of [ID.en1, ID.en2]) {
    const st = stateOf(supa, id);
    assert.strictEqual(st.status, 'curatat');
    assert.strictEqual(st.v1, undefined);
    assert.ok(st.alb);
  }
  assert.strictEqual(stateOf(supa, ID.en1).sha_before, sha(orig1), 'varianta albă e făcută din original');
  assert.strictEqual(ctx.stats.p2_originale, 1);
  assert.ok(ctx.lines.some((l) => /↩ „Evaluare Națională 2025 — Varianta 4": am pus la loc originalul/.test(l)));
  // copia privată a versiunii vechi rămâne (nu ștergem nimic al ei)
  assert.ok(file(supa, `content-files/${back1}`));
  // a doua rulare: nimic
  const puts = supa.db.puts.length;
  await P2R.cleanStep(ctxOf(supa));
  assert.strictEqual(supa.db.puts.length, puts);
});

test('rularea: MuPDF cade („memory access out of bounds") → instanță nouă, fișierul se reia', async () => {
  const supa = await seed();
  const real = P2.albPage2;
  let calls = 0;
  P2.albPage2 = (m, buf, o) => (++calls === 1 ? { status: 'eroare', error: 'RuntimeError: memory access out of bounds', bytes: null } : real(m, buf, o));
  const ctx = ctxOf(supa);
  try { await P2R.cleanStep(ctx, { ids: [ID.en1] }); } finally { P2.albPage2 = real; P2R._reset(); }
  assert.strictEqual(stateOf(supa, ID.en1).status, 'curatat');
  assert.ok(ctx.lines.some((l) => /MuPDF a căzut/.test(l)));
  mupdf = await P2.loadMupdf();
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Vizualizatorul primește linkul copiei (api/get-file-url.js) — cu aceleași reguli de acces
// ═══════════════════════════════════════════════════════════════════════════
test('api/get-file-url: cu `variante`, testele de EN primesc și linkul variantei albe; premium tot doar abonaților', async () => {
  const supa = await seed();
  await P2R.cleanStep(ctxOf(supa));
  const orig = { admin: http.admin, authUser: http.authUser };
  let uid = null;
  http.admin = () => supa;
  http.authUser = async () => { if (!uid) { const e = new Error('Neautentificat'); e.status = 401; throw e; } return uid; };
  delete require.cache[require.resolve('../api/get-file-url')];
  const handler = require('../api/get-file-url');
  const call = async (body) => { const res = fakeRes(); await handler({ method: 'POST', body, query: {}, headers: {} }, res); return res; };
  try {
    // gratuit, fără cont
    let res = await call({ contentId: ID.en1, variante: true });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.match(res.body.url, /1700000000001_en_2025_v4\.pdf/);
    assert.doesNotMatch(res.body.url, /_pagina2-alb/, 'url = originalul');
    assert.match(res.body.alb, new RegExp(`/content-files-free/_pagina2-alb/${ID.en1}/`));
    res = await call({ contentId: ID.en1 });
    assert.deepStrictEqual(Object.keys(res.body), ['url'], 'fără `variante`: ca înainte (celelalte locuri care descarcă PDF-ul)');
    // fără dreptunghi / alt material: doar originalul
    assert.deepStrictEqual(Object.keys((await call({ contentId: ID.en3, variante: true })).body), ['url']);
    assert.deepStrictEqual(Object.keys((await call({ contentId: ID.bac, variante: true })).body), ['url']);
    // premium: fără abonament → 403 (fără niciun link); abonat → ambele
    res = await call({ contentId: ID.en2, variante: true });
    assert.strictEqual(res.statusCode, 401);
    uid = ELEV;
    res = await call({ contentId: ID.en2, variante: true });
    assert.strictEqual(res.statusCode, 403);
    assert.strictEqual(res.body.alb, undefined);
    uid = ABONAT;
    res = await call({ contentId: ID.en2, variante: true });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.match(res.body.alb, new RegExp(`/content-files/_pagina2-alb/${ID.en2}/`));
    // ascunsă din Admin → doar originalul
    await P2R.hide(supa, ID.en2, true);
    assert.strictEqual((await call({ contentId: ID.en2, variante: true })).body.alb, undefined);
  } finally {
    http.admin = orig.admin; http.authUser = orig.authUser;
    delete require.cache[require.resolve('../api/get-file-url')];
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. API-ul, cronul, butonul din vizualizator
// ═══════════════════════════════════════════════════════════════════════════
test('api/exam-bot: pagina2_status / _step (cu și fără modificări) / _hide / _link / _settings — doar adminul', async () => {
  const supa = await seed();
  const orig = { admin: http.admin, authUser: http.authUser };
  let uid = ELEV;
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
    res = await call({ action: 'pagina2_step', dry: true });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.done, true);
    const dryRun = supa.db.tables.exam_bot_runs.find((x) => x.id === res.body.runId);
    assert.deepStrictEqual([dryRun.kind, dryRun.note, dryRun.status], ['pagina2', 'fără modificări', 'ok']);
    // lacătul: alt pas al botului „rulează" → 409
    supa.db.tables.exam_bot_runs.push({ id: 'cccccccc-0000-4000-8000-000000000001', kind: 'descoperire', by: 'cron', status: 'ruleaza', started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), stats: {}, log: [] });
    assert.strictEqual((await call({ action: 'pagina2_step' })).statusCode, 409);
    supa.db.tables.exam_bot_runs.find((x) => x.id === 'cccccccc-0000-4000-8000-000000000001').status = 'ok';
    res = await call({ action: 'pagina2_step' });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.progress.done, 2);
    assert.ok(res.body.log.some((l) => /⬜/.test(l)));
    res = await call({ action: 'pagina2_status' });
    assert.strictEqual(res.body.counts.curatat, 2);
    const row = res.body.rows.find((x) => x.id === ID.en1);
    assert.deepStrictEqual([row.status, row.alb, row.hidden], ['curatat', true, false]);
    res = await call({ action: 'pagina2_link', contentId: ID.en1, which: 'alb' });
    assert.match(res.body.url, /_pagina2-alb/);
    res = await call({ action: 'pagina2_link', contentId: ID.en1, which: 'original' });
    assert.doesNotMatch(res.body.url, /_pagina2-alb/);
    res = await call({ action: 'pagina2_hide', contentId: ID.en1, on: true });
    assert.deepStrictEqual(res.body, { ok: true, hidden: true });
    res = await call({ action: 'pagina2_hide', contentId: ID.en1, on: false });
    assert.deepStrictEqual(res.body, { ok: true, hidden: false });
    assert.strictEqual((await call({ action: 'pagina2_hide', contentId: ID.en3 })).statusCode, 404);
    assert.strictEqual((await call({ action: 'pagina2_hide' })).statusCode, 400);
    assert.strictEqual((await call({ action: 'pagina2_restore', contentId: ID.en1 })).statusCode, 400, 'nu mai există „restaurare": originalul nu se schimbă');
    res = await call({ action: 'pagina2_settings', value: { auto: false } });
    assert.deepStrictEqual(res.body.settings, { auto: false });
    assert.deepStrictEqual(supa.db.tables.app_settings.find((x) => x.key === 'pagina2').value, { auto: false });
  } finally {
    http.admin = orig.admin; http.authUser = orig.authUser;
    delete require.cache[require.resolve('../api/exam-bot')];
  }
});

test('cronul: face singur varianta albă a testelor noi (și cu botul de examene oprit); oprit din setări → nu; fără nimic de făcut → nicio urmă în jurnal', async () => {
  const supa = await seed();
  supa.db.tables.app_settings.push({ key: 'exam_bot', value: { enabled: false } });
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
  r = await R.cron(supa);
  assert.strictEqual(r.pagina2.nimic, true);
  assert.strictEqual(supa.db.tables.exam_bot_runs.filter((x) => x.kind === 'pagina2').length, 1);
  supa.db.tables.content.push({ id: '11111111-0000-4000-8000-000000000009', title: 'Simulare EN 2027', category: 'evaluare-nationala', subcategory: 'simulari', content_type: 'pdf', is_free: true, file_url: `${FREE}pdf/evaluare-nationala/1900000000009_sim.pdf`, created_at: '2026-11-07T10:00:00Z' });
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1900000000009_sim.pdf', await pdf('vector'));
  await P2R.saveSettings(supa, { auto: false });
  r = await R.cron(supa);
  assert.deepStrictEqual(r.pagina2, { sarit: 'oprit din setări' });
  assert.strictEqual(stateOf(supa, '11111111-0000-4000-8000-000000000009'), null);
  await P2R.saveSettings(supa, { auto: true });
  r = await R.cron(supa);
  assert.strictEqual(stateOf(supa, '11111111-0000-4000-8000-000000000009').status, 'curatat');
  const src = read('api/_lib/examBotRun.js');
  const c = src.slice(src.indexOf('async function cron('));
  assert.ok(c.indexOf("step('descoperire'") < c.indexOf('out.pagina2 = await pagina2()'));
  assert.ok(c.indexOf('out.pagina2 = await pagina2()') < c.indexOf("step('bareme'"));
});

test('vizualizatorul PDF: deschide varianta albă, „⬛ Original" ↔ „⬜ Fără suprafață neagră" în bară (calculator și telefon)', () => {
  const v = read('src/pages/PDFViewer.jsx');
  assert.match(v, /body: JSON\.stringify\(\{ contentId: item\.id, grant, variante: true \}\)/);
  assert.match(v, /let response = data\.alb \? await fetch\(data\.alb\)\.catch\(\(\) => null\) : null;/);
  assert.match(v, /if \(response && response\.ok\) which = 'alb';\s+else response = await fetch\(url\);/, 'dacă varianta albă nu vine, originalul');
  assert.match(v, /peOriginal \? '⬜ Fără suprafață neagră' : '⬛ Original'/);
  assert.match(v, /const variantaBtn = !!varianta && !showBaremDoc && \(/);
  assert.match(v, /\{baremBtn\}\s+\{variantaBtn\}\s+\{tutorBtn\}/g);
  assert.strictEqual((v.match(/\{variantaBtn\}/g) || []).length, 2, 'pe calculator și pe telefon');
  assert.match(v, /const u = next === 'alb' \? d\.alb : d\.url;/, 'cealaltă variantă se aduce la primul clic');
  assert.match(v, /if \(variantsRef\.current\.forId !== forId\) return;/);
  // celelalte locuri care descarcă PDF-uri (generatoarele) nu cer variantele
  for (const f of ['src/components/CombinedPdfGenerator.jsx', 'src/components/ExamGenerator.jsx', 'src/components/AIExerciseAgent.jsx']) assert.doesNotMatch(read(f), /variante: true/, f);
});

test('fără SQL nou: starea în app_settings, copia albă lângă original (același bucket), mupdf în pachetul funcției; Admin', () => {
  const run = read('api/_lib/pagina2Run.js');
  assert.doesNotMatch(run, /create table/i);
  assert.match(read('api/_lib/pagina2Alb.js'), /const ALB_DIR = '_pagina2-alb';/);
  assert.match(run, /bucket: loc\.bucket, path: `\$\{ALB_DIR\}\/\$\{row\.id\}\/\$\{shaAlb\.slice\(0, 12\)\}_\$\{baseName\(loc\.filePath\)\}`/);
  assert.match(run, /upload\(supa, alb\.bucket, alb\.path, r\.bytes, \{ upsert: false \}\)/, 'copia albă nu scrie peste nimic');
  assert.ok(!fs.readdirSync(path.join(__dirname, '..', 'supabase')).some((f) => /pagina2/i.test(f)), 'nicio tabelă nouă');
  const vj = JSON.parse(read('vercel.json'));
  assert.ok(vj.functions['api/**/*.js'].includeFiles.includes('api/_lib/**'));
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'node_modules', 'mupdf', 'dist', 'mupdf-wasm.wasm')));
  assert.match(read('src/components/AdminBotExamene.jsx'), /AdminPagina2/);
  const ui = read('src/components/AdminPagina2.jsx');
  for (const a of ["'pagina2_status'", "'pagina2_step'", "'pagina2_hide'", "'pagina2_link'", "'pagina2_settings'"]) assert.ok(ui.includes(a), a);
  assert.doesNotMatch(ui, /pagina2_restore/);
});
