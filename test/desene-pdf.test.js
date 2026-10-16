// Teste pentru DESENELE din PDF (api/_lib/figuri.js → api/live.js → tabla digitală):
// la problemele „În figura alăturată…", desenul (figura geometrică) se decupează din
// pagina PDF-ului subiectului, se urcă în Storage o singură dată pe lecție și apare pe
// tabla digitală lângă enunț (scena „item" a cronologiei: figure = { url, w, h }).
// PDF-ul e construit aici (pdf-lib), ca un subiect de EN pe două pagini: antet cu chenar,
// fracții desenate cu linii (nu sunt desene), separator între subiecte, un triunghi la
// S. I ex. 2, un dreptunghi la S. II ex. 1, un paralelipiped la S. III ex. 6 (pagina 2).
// Fără rețea: PDF-ul, autentificarea și Supabase sunt înlocuite.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const L = require('../api/_lib/live');
const LL = require('../api/_lib/liveLesson');
const FIG = require('../api/_lib/figuri');
const pdf = require('../api/ai-pdf-context');
const handler = require('../api/live');

delete process.env.AZURE_SPEECH_KEY; delete process.env.OPENAI_API_KEY; delete process.env.LIVE_TTS_API_KEY;
delete process.env.SUPABASE_URL; delete process.env.VITE_SUPABASE_URL;
delete process.env.LIVE_DESENE;

// ─── subiectul (A4, coordonatele pdf-lib: de jos în sus) ─────────────────────
const H = 842;
async function subjectPdf() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0);
  const page1 = doc.addPage([595, H]);
  const page2 = doc.addPage([595, H]);
  const t = (pg, s, x, y, size = 11) => pg.drawText(s, { x, y, size, font, color: black });
  const ln = (pg, x1, y1, x2, y2, w = 1) => pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color: black });
  // pagina 1: antetul, chenarul cu instrucțiunile
  t(page1, 'Ministerul Educatiei - Centrul National de Politici si Evaluare in Educatie', 60, 800, 9);
  page1.drawRectangle({ x: 50, y: 700, width: 495, height: 60, borderColor: black, borderWidth: 1 });
  t(page1, 'Toate subiectele sunt obligatorii. Se acorda zece puncte din oficiu.', 60, 735, 10);
  t(page1, 'SUBIECTUL I (30 de puncte)', 60, 680, 12);
  // S. I ex. 1: o fracție desenată (bara e o linie) — nu e un desen
  t(page1, '5p 1. Rezultatul calculului', 60, 658);
  t(page1, '1', 214, 665, 9); ln(page1, 212, 661.5, 222, 661.5, 0.6); t(page1, '2', 214, 652, 9);
  t(page1, '+ 3 este egal cu:', 228, 658);
  t(page1, 'a) 2      b) 4      c) 6      d) 8', 80, 640);
  // S. I ex. 2: triunghiul, în dreapta
  t(page1, '5p 2. In figura alaturata este reprezentat triunghiul ABC.', 60, 615);
  t(page1, 'Perimetrul triunghiului este:', 80, 597);
  t(page1, 'a) 12 cm    b) 15 cm    c) 18 cm    d) 20 cm', 80, 580);
  ln(page1, 430, 560, 520, 560); ln(page1, 520, 560, 470, 630); ln(page1, 470, 630, 430, 560);
  t(page1, 'A', 466, 634, 10); t(page1, 'B', 420, 548, 10); t(page1, 'C', 522, 548, 10);
  t(page1, '5p 3. Media aritmetica a numerelor 4 si 6 este:', 60, 530);
  t(page1, 'a) 4      b) 5      c) 6      d) 10', 80, 512);
  ln(page1, 50, 490, 545, 490, 0.8);                                   // separatorul dintre subiecte
  t(page1, 'SUBIECTUL al II-lea (30 de puncte)', 60, 470, 12);
  // S. II ex. 1: dreptunghiul cu diagonala
  t(page1, '5p 1. In figura alaturata, ABCD este un dreptunghi cu AB = 8 cm.', 60, 450);
  t(page1, 'Aria dreptunghiului ABCD este:', 80, 432);
  t(page1, 'a) 24 cm2   b) 32 cm2   c) 40 cm2   d) 48 cm2', 80, 414);
  page1.drawRectangle({ x: 440, y: 380, width: 90, height: 55, borderColor: black, borderWidth: 1 });
  ln(page1, 440, 380, 530, 435, 0.8);
  t(page1, 'A', 431, 370, 10); t(page1, 'B', 532, 370, 10); t(page1, 'C', 532, 438, 10); t(page1, 'D', 431, 438, 10);
  t(page1, '5p 2. Numarul real x pentru care 2x = 10 este:', 60, 355);
  t(page1, 'Proba scrisa la matematica - Test 1', 60, 60, 9);
  t(page1, 'Pagina 1 din 2', 270, 45, 9);
  // pagina 2: Subiectul III, ex. 5 (fără desen) și ex. 6 (paralelipipedul)
  t(page2, 'SUBIECTUL al III-lea (30 de puncte)', 60, 800, 12);
  t(page2, 'Scrie rezolvarile complete.', 60, 782, 10);
  t(page2, '5p 5. Se considera triunghiul ABC dreptunghic in A cu AB = 6 cm si AC = 8 cm.', 60, 750);
  t(page2, '(2p) a) Arata ca BC = 10 cm.', 80, 732);
  t(page2, '(3p) b) Calculeaza aria triunghiului ABC.', 80, 714);
  t(page2, '5p 6. In figura alaturata este reprezentat paralelipipedul', 60, 670);
  t(page2, "dreptunghic ABCDA'B'C'D' cu AB = AA' = 4 cm si BC = 2 cm.", 80, 652);
  t(page2, '(2p) a) Arata ca aria totala este egala cu 64 cm2.', 80, 634);
  t(page2, "(3p) b) Arata ca dreapta NP este paralela cu planul (ACD').", 80, 616);
  const F = [[400, 520], [480, 520], [480, 580], [400, 580]];
  const K = [[430, 545], [510, 545], [510, 605], [430, 605]];
  for (let i = 0; i < 4; i++) { ln(page2, ...F[i], ...F[(i + 1) % 4]); ln(page2, ...K[i], ...K[(i + 1) % 4]); ln(page2, ...F[i], ...K[i]); }
  [['A', 390, 510], ['B', 484, 510], ['C', 514, 538], ['D', 420, 548], ["A'", 388, 584], ["B'", 484, 584], ["C'", 514, 608], ["D'", 420, 610]].forEach(([s, x, y]) => t(page2, s, x, y, 10));
  t(page2, 'Pagina 2 din 2', 270, 45, 9);
  return Buffer.from(await doc.save());
}
let PDF = null;
const pdfBuf = async () => (PDF = PDF || await subjectPdf());
const mu = async () => import('mupdf');
async function models() {
  const mupdf = await mu();
  const doc = mupdf.Document.openDocument(await pdfBuf(), 'application/pdf');
  const pages = [0, 1].map((i) => doc.loadPage(i));
  return { mupdf, pages, models: pages.map((p) => FIG.pageModel(mupdf, p)) };
}
// partea „cu cerneală" a unui PNG (pixelii închiși la culoare)
async function inkRatio(png) {
  const mupdf = await mu();
  const pix = new mupdf.Image(png).toPixmap();
  const px = pix.getPixels(), n = pix.getNumberOfComponents();
  let dark = 0;
  for (let i = 0; i < px.length; i += n) if (px[i] < 100) dark++;
  return dark / (px.length / n);
}
// coordonatele MuPDF sunt de sus în jos
const top = (y) => H - y;

test('care itemi au desen: „În figura alăturată…", „desenul", „tabelul alăturat" — toată problema (a, b, c)', () => {
  assert.strictEqual(FIG.wantsFigure({ statement: 'În figura alăturată este reprezentat paralelipipedul.' }), true);
  assert.strictEqual(FIG.wantsFigure({ statement: 'Desenul de mai jos arată…' }), true);
  assert.strictEqual(FIG.wantsFigure({ statement: 'În tabelul alăturat sunt notele…' }), true);
  assert.strictEqual(FIG.wantsFigure({ statement: 'Calculați $\\frac{1}{2}+3$.' }), false);
  assert.strictEqual(FIG.exKey('III.6.b'), 'III.6');
  assert.strictEqual(FIG.exKey('I.2'), 'I.2');
  assert.strictEqual(FIG.exKey('x'), null);
  const items = [
    { ref: 'I.1', statement: 'Calculați.' },
    { ref: 'III.6.a', statement: 'În figura alăturată…' },
    { ref: 'III.6.b', statement: 'Arată că dreapta NP…' },
    { ref: 'II.1', statement: 'În figura alăturată, ABCD…' },
  ];
  assert.deepStrictEqual(FIG.figureKeys(items), ['III.6', 'II.1']);
  // scriptul fără desene (ex. preluat de la lecția altui profesor)
  const s = FIG.stripFigures({ title: 'T', figv: 1, figInfo: { found: ['I.2'] }, figErr: 'x', items: [{ ref: 'I.2', figure: { url: 'u' } }] });
  assert.deepStrictEqual(s, { title: 'T', items: [{ ref: 'I.2' }] });
});

test('zona exercițiului: subiectul lui (nu „1." din alt subiect), până la exercițiul următor / subiectul următor / subsol', async () => {
  const { models: ms } = await models();
  const b11 = FIG.findBand(ms, 'I', 1);
  const b21 = FIG.findBand(ms, 'II', 1);
  assert.strictEqual(b11.page, 0);
  assert.strictEqual(b21.page, 0);
  assert.ok(b11.top < top(640) && b11.bottom < top(600), JSON.stringify(b11));            // S. I ex. 1, nu S. II ex. 1
  assert.ok(Math.abs(b21.top - top(461)) < 6, JSON.stringify(b21));
  assert.ok(Math.abs(b21.bottom - top(366)) < 6, 'se oprește la „5p 2." din Subiectul II');
  const b13 = FIG.findBand(ms, 'I', 3);
  assert.ok(b13.bottom <= top(470), 'se oprește la „SUBIECTUL al II-lea"');
  const b36 = FIG.findBand(ms, 'III', 6);
  assert.strictEqual(b36.page, 1);
  assert.ok(b36.bottom > top(80) && b36.bottom < H, 'ultimul exercițiu: până la subsol');
  assert.strictEqual(FIG.findBand(ms, 'III', 2), null, 'exercițiul nu există');
});

test('figura din zonă: liniile desenului + etichetele; fără bara fracției, fără separatoare și rame', async () => {
  const { models: ms } = await models();
  const box = (sub, ex) => { const b = FIG.findBand(ms, sub, ex); return FIG.figureBox(ms[b.page], b); };
  // triunghiul (S. I ex. 2): x 430–520, y 560–630 + etichetele A (sus), B, C (jos)
  const tri = box('I', 2);
  assert.ok(tri, 'triunghiul');
  assert.ok(tri.x0 > 400 && tri.x0 < 425 && tri.x1 > 525 && tri.x1 < 545, JSON.stringify(tri));
  assert.ok(tri.y0 < top(634) && tri.y0 > top(660) && tri.y1 > top(560) && tri.y1 < top(530), JSON.stringify(tri));
  // dreptunghiul (S. II ex. 1), cu etichetele
  const rect = box('II', 1);
  assert.ok(rect && rect.x0 > 415 && rect.x0 < 440 && rect.x1 > 535 && rect.y0 < top(435) && rect.y1 > top(380), JSON.stringify(rect));
  // doar o fracție (linia ei e a textului) → niciun desen
  assert.strictEqual(box('I', 1), null);
  // separatorul dintre subiecte (toată lățimea paginii) nu e un desen
  assert.strictEqual(box('I', 3), null);
  // paralelipipedul, pe pagina 2
  const cub = box('III', 6);
  assert.ok(cub && cub.x0 > 370 && cub.x0 < 400 && cub.x1 > 510 && cub.y0 < top(605) && cub.y1 > top(520), JSON.stringify(cub));
});

test('axa numerelor (joasă, cu etichetele pe un rând) e un desen; tabelul variantelor nu', async () => {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pg = doc.addPage([595, H]);
  const black = rgb(0, 0, 0);
  const t = (s, x, y, size = 11) => pg.drawText(s, { x, y, size, font, color: black });
  const ln = (x1, y1, x2, y2, w = 1) => pg.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: w, color: black });
  t('SUBIECTUL I (30 de puncte)', 60, 780, 12);
  t('5p 4. Pe axa numerelor din figura alaturata, punctul A are coordonata:', 60, 740);
  ln(300, 700, 520, 700, 0.8);                                                   // axa
  for (const x of [320, 360, 400, 440, 480]) ln(x, 697, x, 703, 0.8);           // gradațiile
  pg.drawSvgPath('M 0 0 L -8 -3 L -8 3 Z', { x: 524, y: 700, color: black });    // săgeata
  t('-2       -1        0        1        2', 315, 686, 9);                    // etichetele, pe un singur rând
  t('A', 437, 707, 10);
  t('5p 5. In figura alaturata este reprezentat patratul ABCD. Latura lui este:', 60, 640);
  for (let i = 0; i < 4; i++) {                                                  // variantele, într-un tabel cu chenar
    pg.drawRectangle({ x: 60 + i * 100, y: 600, width: 100, height: 18, borderColor: black, borderWidth: 0.6 });
    t(`${'abcd'[i]}) ${i + 2} cm`, 66 + i * 100, 605, 10);
  }
  pg.drawRectangle({ x: 490, y: 560, width: 45, height: 45, borderColor: black, borderWidth: 1 });   // pătratul
  t('5p 6. In figura alaturata este reprezentat graficul functiei f.', 60, 520);   // desenul e o imagine
  const mupdf = await mu();
  const pix = new mupdf.Pixmap(mupdf.ColorSpace.DeviceRGB, [0, 0, 80, 60], false);
  pix.clear(255);
  const png = await doc.embedPng(Buffer.from(pix.asPNG()));
  pg.drawImage(png, { x: 440, y: 440, width: 80, height: 60 });
  t('5p 7. Calculati 2 + 2.', 60, 400);
  const d = mupdf.Document.openDocument(Buffer.from(await doc.save()), 'application/pdf');
  const m = [FIG.pageModel(mupdf, d.loadPage(0))];
  const axis = FIG.figureBox(m[0], FIG.findBand(m, 'I', 4));
  assert.ok(axis && axis.x0 < 300 && axis.x1 > 520 && axis.y0 < top(707) && axis.y1 > top(690), JSON.stringify(axis));
  const sq = FIG.figureBox(m[0], FIG.findBand(m, 'I', 5));
  assert.ok(sq && sq.x0 > 470 && sq.x0 < 490 && sq.y0 < top(605) && sq.y1 > top(560), `pătratul, nu tabelul: ${JSON.stringify(sq)}`);
  const img = FIG.figureBox(m[0], FIG.findBand(m, 'I', 6));
  // un desen-imagine se decupează exact pe marginea ei (are deja alb în jur)
  assert.ok(img && Math.abs(img.x0 - 440) < 1.5 && Math.abs(img.x1 - 520) < 1.5 && Math.abs(img.y0 - top(500)) < 1.5 && Math.abs(img.y1 - top(440)) < 1.5, `imaginea: ${JSON.stringify(img)}`);
});

// ─── Subiectele de EN din 2024 încoace: caroiajul pe care se rezolvă ─────────
// Ca în PDF-urile oficiale (Word): pagina e un tabel — coloana cu punctajul în stânga, rama
// în dreapta, liniile dintre exerciții — iar sub fiecare cerință e caroiajul: sute de
// pătrățele de ~5 mm, desenate ca dreptunghiuri pline subțiri (0,48 pt), peste toată
// lățimea. Desenul problemei e o IMAGINE în dreapta enunțului. Până pe 15 oct., decuparea
// lua caroiajul drept desen: „desenul" era toată pagina, cu figura mică într-un colț.
const CELL = 14.17;
async function gridPage({ figure = 'image' } = {}) {
  const mupdf = await mu();
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const black = rgb(0, 0, 0), gray = rgb(0.55, 0.55, 0.55);
  const pg = doc.addPage([595.32, H]);
  const t = (s, x, y, size = 11) => pg.drawText(s, { x, y, size, font, color: black });
  const bar = (x, y, w, h, color = black) => pg.drawRectangle({ x, y, width: w, height: h, color });   // dreptunghi plin (latura de tabel Word)
  // tabelul paginii: rama de sus/jos, coloana cu punctajul (x 40–64), marginea din dreapta (x 555)
  bar(34.6, H - 36, 526, 0.5); bar(34.6, H - 789.6, 526, 0.5);
  for (const x of [38.5, 66.6, 556.3]) bar(x, H - 755.4, 0.5, 719);
  bar(39, H - 36.6, 27.6, 0.5); bar(39, H - 755.9, 27.6, 0.5);
  // caroiajul: x 72–552, sub cerința a) (y 128–360) și sub b) (y 386–755), câte o latură pe pătrățel
  for (const [y0, y1] of [[128, 360], [386, 755]]) {
    const cols = Math.floor((552 - 72) / CELL), rows = Math.floor((y1 - y0) / CELL);
    for (let r = 0; r <= rows; r++) for (let c = 0; c < cols; c++) bar(72 + c * CELL, H - (y0 + r * CELL) - 0.24, CELL, 0.48, gray);
    for (let c = 0; c <= cols; c++) for (let r = 0; r < rows; r++) bar(72 + c * CELL - 0.24, H - (y0 + (r + 1) * CELL), 0.48, CELL, gray);
  }
  t('SUBIECTUL al III-lea (30 de puncte)', 200, H - 28, 8);
  t('5p', 44, H - 50); t('4. In figura alaturata este reprezentat dreptunghiul ABCD cu AB = 12 cm si BC = 9 cm.', 72, H - 52, 10);
  t('Punctul E apartine segmentului AC, astfel incat AE = 10 cm.', 72, H - 70, 10);
  t('(2p) a) Arata ca AC = 15 cm.', 72, H - 118, 10);
  t('(3p) b) Arata ca aria patrulaterului AMEQ este de patru ori mai mare.', 72, H - 380, 10);
  t('Proba scrisa la matematica                                Model', 36, H - 800, 9);
  t('7', 295, H - 812, 9);
  if (figure === 'image') {
    // desenul: o imagine albă cu dreptunghiul și diagonala (ca figurile din PDF-urile oficiale)
    const fd = await PDFDocument.create();
    const fp = fd.addPage([215, 166]);
    fp.drawRectangle({ x: 15, y: 15, width: 185, height: 136, borderColor: black, borderWidth: 2 });
    fp.drawLine({ start: { x: 15, y: 15 }, end: { x: 200, y: 151 }, thickness: 2, color: black });
    const fpix = mupdf.Document.openDocument(Buffer.from(await fd.save()), 'application/pdf').loadPage(0)
      .toPixmap(mupdf.Matrix.scale(2, 2), mupdf.ColorSpace.DeviceRGB, false);
    const png = await doc.embedPng(Buffer.from(fpix.asPNG()));
    pg.drawImage(png, { x: 348, y: H - 297, width: 215, height: 166 });
  } else {
    // desenul cu linii (vectorial), peste caroiaj, cu etichetele A, B, C, D
    const ln = (x1, y1, x2, y2) => pg.drawLine({ start: { x: x1, y: H - y1 }, end: { x: x2, y: H - y2 }, thickness: 1, color: black });
    ln(380, 150, 530, 150); ln(530, 150, 530, 270); ln(530, 270, 380, 270); ln(380, 270, 380, 150); ln(380, 270, 530, 150);
    t('D', 370, H - 148, 10); t('C', 533, H - 148, 10); t('A', 370, H - 280, 10); t('B', 533, H - 280, 10);
  }
  const buf = Buffer.from(await doc.save());
  const page = mupdf.Document.openDocument(buf, 'application/pdf').loadPage(0);
  return { mupdf, buf, page, pm: FIG.pageModel(mupdf, page) };
}
// partea „cu cerneală" a unei zone dintr-un PNG (x0, y0, x1, y1 în pixeli)
async function inkIn(png, [x0, y0, x1, y1]) {
  const mupdf = await mu();
  const pix = new mupdf.Image(png).toPixmap();
  const px = pix.getPixels(), n = pix.getNumberOfComponents(), w = pix.getWidth();
  let dark = 0, all = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { all++; if (px[(y * w + x) * n] < 200) dark++; }
  return dark / Math.max(1, all);
}

test('caroiajul subiectelor noi de EN: recunoscut (pătrățele de ~14 pt), fără desene făcute din pătrățele', async () => {
  const { pm } = await gridPage();
  const grid = FIG.gridOf(pm);
  assert.ok(grid, 'pagina are caroiaj');
  assert.ok(grid.cell >= 13 && grid.cell <= 15, JSON.stringify(grid));
  assert.strictEqual(grid.k, 'fill');
  assert.ok(grid.x0 < 75 && grid.x1 > 535, JSON.stringify(grid));
  // laturile pătrățelelor și ramele tabelului nu sunt desen; liniile desenului, da
  assert.strictEqual(FIG.frameMark({ x0: 100, y0: 200, x1: 114.2, y1: 200.5, k: 'fill' }, pm, grid), true, 'latura unui pătrățel');
  assert.strictEqual(FIG.frameMark({ x0: 556.3, y0: 36, x1: 556.8, y1: 755, k: 'fill' }, pm, grid), true, 'rama din dreapta');
  assert.strictEqual(FIG.frameMark({ x0: 40.4, y0: 160, x1: 40.9, y1: 306, k: 'fill' }, pm, grid), true, 'coloana cu punctajul');
  assert.strictEqual(FIG.frameMark({ x0: 380, y0: 150, x1: 530, y1: 151, k: 'stroke' }, pm, grid), false, 'latura dreptunghiului din desen');
  assert.strictEqual(FIG.frameMark({ x0: 348, y0: 131, x1: 563, y1: 297, k: 'image' }, pm, grid), false, 'imaginea desenului');
  // paginile vechi (fără caroiaj) — nimic recunoscut
  const { models: ms } = await models();
  assert.strictEqual(FIG.gridOf(ms[0]), null);
  assert.strictEqual(FIG.gridOf(ms[1]), null);
});

test('desenul-imagine de pe o pagină cu caroiaj: decupat pe marginea imaginii, fără caroiaj, rame sau enunț', async () => {
  const { mupdf, page, pm } = await gridPage();
  const band = FIG.findBand([pm], 'III', 4);
  assert.ok(band && band.top < 45 && band.bottom > 780, JSON.stringify(band));
  const box = FIG.figureBox(pm, band);
  assert.ok(box, 'desenul a fost găsit');
  // imaginea: x 348–563, y 131–297 (coordonatele MuPDF, de sus în jos)
  assert.ok(Math.abs(box.x0 - 348) < 1.5 && Math.abs(box.x1 - 563) < 1.5 && Math.abs(box.y0 - 131) < 1.5 && Math.abs(box.y1 - 297) < 1.5, JSON.stringify(box));
  // imaginea decupată: caroiajul și rama din jurul desenului nu apar (o zonă cu 10 pt mai mare)
  const grid = FIG.gridOf(pm);
  const around = { x0: box.x0 - 10, y0: box.y0 - 10, x1: box.x1 - 0, y1: box.y1 + 10 };
  const clean = FIG.renderBox(mupdf, page, around, 3, (m) => FIG.frameMark(m, pm, grid));
  const raw = FIG.renderBox(mupdf, page, around, 3);
  const margin = [0, 0, 27, clean.h];                       // fâșia din stânga desenului (cei 10 pt în plus)
  assert.ok(await inkIn(raw.png, margin) > 0.01, 'în PDF, acolo e caroiajul');
  assert.ok(await inkIn(clean.png, margin) < 0.002, 'în imaginea decupată, nu');
});

test('figuresFromPdf pe o pagină cu caroiaj: imaginea desenului (de 3×), nu toată pagina', async () => {
  const { buf, pm } = await gridPage();
  assert.ok(pm.marks.length > 1500, `caroiajul are multe laturi: ${pm.marks.length}`);
  const figs = await FIG.figuresFromPdf(buf, [{ ref: 'III.4.a', statement: 'În figura alăturată este reprezentat dreptunghiul ABCD…' }]);
  assert.strictEqual(figs.length, 1);
  const f = figs[0];
  assert.strictEqual(f.key, 'III.4');
  // cât imaginea (215 × 166 pt, de 3×) — înainte: toată pagina (~1600 × 2200)
  assert.ok(Math.abs(f.w - 645) <= 4 && Math.abs(f.h - 498) <= 4, `${f.w}×${f.h}`);
  const ink = await inkRatio(f.png);
  assert.ok(ink > 0.005 && ink < 0.2, `doar liniile desenului: ${ink}`);
});

test('desenul cu linii peste caroiaj: liniile figurii + etichetele, fără pătrățele', async () => {
  const { mupdf, page, pm } = await gridPage({ figure: 'linii' });
  const band = { page: 0, top: 40, bottom: 790 };
  const box = FIG.figureBox(pm, band);
  assert.ok(box, 'desenul a fost găsit');
  assert.ok(box.x0 > 355 && box.x0 < 375 && box.x1 > 535 && box.x1 < 550 && box.y0 > 130 && box.y0 < 145 && box.y1 > 275 && box.y1 < 290, JSON.stringify(box));
  // în imagine: liniile desenului (cerneală), dar nu caroiajul — între laturile dreptunghiului
  // (x 400–510, y 170–250) PDF-ul are pătrățele, imaginea decupată e albă
  const grid = FIG.gridOf(pm);
  const clean = FIG.renderBox(mupdf, page, box, 3, (m) => FIG.frameMark(m, pm, grid));
  const raw = FIG.renderBox(mupdf, page, box, 3);
  const inside = [Math.round((400 - box.x0) * 3), Math.round((175 - box.y0) * 3), Math.round((450 - box.x0) * 3), Math.round((200 - box.y0) * 3)];
  assert.ok(await inkIn(raw.png, inside) > 0.01, 'în PDF, caroiajul');
  assert.ok(await inkIn(clean.png, inside) < 0.002, 'în imagine, nu');
  assert.ok(await inkRatio(clean.png) > 0.005, 'liniile desenului rămân');
});

test('figuresFromPdf: un PNG pe problemă (de 3×), cu desenul în el', async () => {
  const items = [
    { ref: 'I.1', statement: 'Rezultatul calculului…' },
    { ref: 'I.2', statement: 'În figura alăturată este reprezentat triunghiul ABC.' },
    { ref: 'III.6.a', statement: 'În figura alăturată este reprezentat paralelipipedul…' },
    { ref: 'III.6.b', statement: 'Arată că dreapta NP…' },
  ];
  const figs = await FIG.figuresFromPdf(await pdfBuf(), items);
  assert.deepStrictEqual(figs.map((f) => [f.key, f.page]), [['I.2', 0], ['III.6', 1]]);
  for (const f of figs) {
    assert.strictEqual(f.png.subarray(1, 4).toString(), 'PNG');
    assert.ok(Math.abs(f.w - (f.box.x1 - f.box.x0) * 3) <= 3 && Math.abs(f.h - (f.box.y1 - f.box.y0) * 3) <= 3, `${f.key}: ${f.w}×${f.h}`);
    const ink = await inkRatio(f.png);
    assert.ok(ink > 0.01 && ink < 0.4, `${f.key}: ${ink}`);    // liniile desenului, pe alb
  }
  assert.deepStrictEqual(await FIG.figuresFromPdf(await pdfBuf(), [{ ref: 'I.1', statement: 'Calculați.' }]), [], 'fără probleme cu figură');
});

test('attachFigures: PNG-urile în live-media (lângă vocea lecției), it.figure la toți itemii problemei, figInfo', async () => {
  const fake = createFakeSupabase({});
  const script = {
    title: 'EN', items: [
      { ref: 'I.1', statement: 'Rezultatul calculului…' },
      { ref: 'I.2', statement: 'În figura alăturată este reprezentat triunghiul ABC.' },
      { ref: 'I.3', statement: 'Desenul de mai jos…' },                             // în PDF nu e niciun desen
      { ref: 'III.6.a', statement: 'În figura alăturată este reprezentat paralelipipedul…' },
      { ref: 'III.6.b', statement: 'Arată că dreapta NP…' },
    ],
  };
  const logs = [];
  const r = await FIG.attachFigures({ supa: fake, script, lessonId: 'L1', buf: await pdfBuf(), log: (m) => logs.push(m) });
  assert.strictEqual(r.count, 2);
  assert.deepStrictEqual(fake.db.uploads.map((u) => `${u.bucket}/${u.path}`), ['live-media/lessons/L1/fig-I2.png', 'live-media/lessons/L1/fig-III6.png']);
  const by = Object.fromEntries(r.script.items.map((it) => [it.ref, it.figure || null]));
  assert.match(by['I.2'].url, /^https:\/\/fake\.supabase\/storage\/v1\/object\/public\/live-media\/lessons\/L1\/fig-I2\.png\?v=\w+$/);
  assert.ok(by['I.2'].w > 100 && by['I.2'].h > 100);
  assert.strictEqual(by['III.6.b'], by['III.6.a'], 'și itemul b) al problemei');
  assert.ok(by['III.6.a']);
  assert.strictEqual(by['I.1'], null);
  assert.strictEqual(by['I.3'], null);
  assert.strictEqual(r.script.figv, FIG.FIG_V);
  assert.deepStrictEqual([r.script.figInfo.found, r.script.figInfo.missing], [['I.2', 'III.6'], ['I.3']]);
  assert.ok(!('figure' in script.items[1]), 'scriptul primit rămâne neatins');
  assert.ok(logs.some((m) => /desene din PDF: I\.2, III\.6; negăsite: I\.3/.test(m)), logs.join('\n'));
});

test('figuresFor: fără probleme cu figură nu descarcă nimic; fără PDF → figErr; altfel desenele', async () => {
  let downloads = 0;
  const pdfCtx = { downloadContentPdf: async () => { downloads++; return pdfBuf(); } };
  const fake = createFakeSupabase({ content: [{ id: 'S1', file_url: 'https://x/S1.pdf', is_free: true }, { id: 'S2', file_url: null }] });
  const plain = await FIG.figuresFor({ supa: fake, row: { id: 'L1', subject_id: 'S1', script: { items: [{ ref: 'I.1', statement: 'Calculați.' }] } }, pdfCtx });
  assert.strictEqual(downloads, 0);
  assert.strictEqual(plain.script.figv, FIG.FIG_V);
  assert.strictEqual(plain.count, 0);
  const noPdf = await FIG.figuresFor({ supa: fake, row: { id: 'L2', subject_id: 'S2', script: { items: [{ ref: 'I.2', statement: 'În figura alăturată…' }] } }, pdfCtx });
  assert.strictEqual(noPdf.script.figErr, 'subiectul nu are PDF');
  assert.strictEqual(noPdf.script.figv, FIG.FIG_V, 'nu se reîncearcă la fiecare intrare');
  const ok = await FIG.figuresFor({ supa: fake, row: { id: 'L3', subject_id: 'S1', script: { items: [{ ref: 'I.2', statement: 'În figura alăturată…' }] } }, pdfCtx });
  assert.strictEqual(downloads, 1);
  assert.ok(ok.script.items[0].figure.url.includes('/lessons/L3/fig-I2.png'));
  assert.strictEqual(FIG.needsFigures(ok.script), false);
  assert.strictEqual(FIG.needsFigures({ items: [] }), true);
});

test('cronologia: scena „item" are desenul (doar la itemii cu desen); tabla digitală îl arată lângă enunț', () => {
  const radu = L.teacherById('radu');
  const seg = (say) => ({ say, board: [] });
  const item = (ref, figure = null) => ({
    ref, section: 'I', title: `Subiectul I, exercițiul ${ref.split('.')[1]}`, statement: 'Enunț.', options: ['1', '2', '3', '4'], points: 5,
    intro: [seg('Trecem la exercițiul următor.')], modes: { barem: [seg('Explicația.')] }, ...(figure ? { figure } : {}),
  });
  const script = LL.assignIds({ title: 'T', exam: 'en', ...LL.templates(radu, { title: 'T', exam: 'en' }), items: [item('I.1'), item('I.2', { url: 'https://x/fig-I2.png?v=1', w: 300, h: 200 })] });
  const tl = L.buildTimeline(script, {}, { mode: 'privat' });
  const heads = tl.scenes.filter((s) => s.type === 'item');
  assert.strictEqual('figure' in heads[0], false);
  assert.deepStrictEqual(heads[1].figure, { url: 'https://x/fig-I2.png?v=1', w: 300, h: 200 });
  const board = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'live', 'Board.jsx'), 'utf8');
  assert.match(board, /const fig = head\.figure\?\.url \? head\.figure : null;/);
  assert.match(board, /<img className="lv-screen-fig" src=\{fig\.url\}/);
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'live.css'), 'utf8');
  assert.match(css, /\.lv-screen-fig \{[^}]*float: right/);
});

// 15 oct.: pe telefon, proiecția din sală e mică (și „pe perete", cu perspectivă) — desenul se
// mărește la atingere, peste toată sala (și pe ecranul complet)
test('desenul de pe proiecție se mărește la atingere: peste toată sala, și pe ecranul complet; alt item → se închide', () => {
  const board = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'live', 'Board.jsx'), 'utf8');
  assert.match(board, /function FigZoom\(/);
  assert.match(board, /createPortal\(/);
  assert.match(board, /fsElement\(\) \|\| document\.body/, 'pe ecranul complet, în elementul afișat (altfel nu s-ar vedea)');
  assert.match(board, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); setZoom\(true\); \}\}/);
  assert.match(board, /useEffect\(\(\) => \{ setZoom\(false\); \}, \[head\.item\]\)/);
  assert.match(board, /onTouchStart=\{\(e\) => e\.stopPropagation\(\)\}/, 'o glisare pe desenul mărit nu mută camera');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'styles', 'live.css'), 'utf8');
  assert.match(css, /\.lv-screen-fig \{[^}]*pointer-events: auto/, 'proiecția nu primește atingeri, desenul da');
  assert.match(css, /\.lv-screen-fig \{[^}]*max-height: 10em/);
  assert.match(css, /\.lv-fig-zoom \{[^}]*position: fixed/);
  const z = /\.lv-fig-zoom \{[^}]*z-index: (\d+)/.exec(css);
  assert.ok(z && Number(z[1]) > 900, 'peste sală (.lv-room are z-index 900)');
});

// ─── integrarea: api/live.js (o lecție scrisă înainte de desene) ──────────────
const U = { prem: '22222222-2222-4222-8222-222222222222', admin: '33333333-3333-4333-8333-333333333333' };
const SUBJ = 'aaaaaaaa-0000-4000-8000-000000000001';
const SUBJ2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();
let fake = null;
let downloads = 0;
ai.admin = () => fake;
ai.authUser = async (req) => { const u = req.headers['x-user']; if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; } return u; };
ai.logUsage = async () => {};
pdf.downloadContentPdf = async () => { downloads++; return pdfBuf(); };
async function call(action, body = {}, user = null) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: user ? { 'x-user': user } : {}, query: {}, body: { action, ...body } }, res);
  return res;
}
function lessonScript(statements) {
  const radu = L.teacherById('radu');
  const seg = (say, board = []) => ({ say, board });
  const raw = statements.map((st, i) => ({
    ref: `I.${i + 1}`, title: `Subiectul I, exercițiul ${i + 1}`, kind: 'grila', statement: st,
    options: ['12 cm', '15 cm', '18 cm', '20 cm'], answer: 'b', points: 5, barem: 'b. 5p',
    intro: [seg('Trecem la exercițiul următor.')],
    tryPoll: { type: 'grila', question: 'Care e răspunsul?', options: ['12 cm', '15 cm', '18 cm', '20 cm'], answer: 'b', explain: 'Din barem.' },
    afterTry: [seg('Să vedem cum ați răspuns.')],
    modes: { barem: [seg('Adunăm laturile.', ['$5+5+5 = 15$'])], intuitiv: [seg('Perimetrul e suma laturilor.')], greseli: [], alta_metoda: null },
    check: null, afterCheck: [],
  }));
  const BAREM = 'SUBIECTUL I (30 de puncte)\nNr. item 1. 2.\nRezultate b. b.\nPunctaj 5p 5p\n';
  const items = LL.normalizeItems(raw, { section: 'I', exam: 'en', grile: { I: { 1: 'b', 2: 'b' } }, baremText: BAREM });
  return LL.assignIds({ title: 'EN 2024 Varianta 7', exam: 'en', pasi: LL.PASI_V, teacher: 'radu', teacherName: radu.name, ...LL.templates(radu, { title: 'EN 2024 Varianta 7', exam: 'en' }), items });
}
function world({ statements, subject = SUBJ, fileUrl = `https://x/${SUBJ}.pdf` } = {}) {
  const today = L.dayKey(new Date());
  const t0 = now - 10 * 60000;
  const s = { id: 'cccccccc-0000-4000-8000-000000000001', kind: 'grup', day: today, slot: '17-en', teacher: 'radu', exam: 'en', profile: null, subject_id: subject, starts_at: iso(t0), ends_at: iso(t0 + 120 * 60000), status: 'programata', state: {}, created_at: iso(now - 86400000), updated_at: iso(now - 86400000) };
  const script = lessonScript(statements);
  const lesson = { id: 'dddddddd-0000-4000-8000-000000000001', subject_id: subject, teacher: 'radu', version: 1, status: 'gata', title: script.title, exam: 'en', profile: null, script, progress: { audio: {}, noVoice: true, total: LL.segmentsInOrder(script).length, done: 0 }, cost_micro: 0, created_at: iso(now - 3600000), updated_at: iso(now - 3600000) };
  fake = createFakeSupabase({
    profiles: [
      { id: U.prem, full_name: 'Andrei Ionescu', email: 'andrei@example.com', subscription_status: 'active', role: 'elev', is_admin: false },
      { id: U.admin, full_name: 'Radu Costea', email: 'radu@example.com', subscription_status: null, role: 'admin', is_admin: true },
    ],
    content: [{ id: subject, title: 'EN 2024 Varianta 7', category: 'evaluare-nationala', subcategory: null, profile: null, content_type: 'pdf', file_url: fileUrl, is_free: true, created_at: '2026-01-01T00:00:00Z' }],
    ai_pdf_text: [{ content_id: subject, barem_status: 'ok', barem: { title: 'Barem' }, barem_text: 'BAREM', text: 'SUBIECTUL I ...' }],
    app_settings: [{ key: 'live_free_lessons', value: { subjects: [] } }],
    live_sessions: [s], live_lessons: [lesson],
  });
  downloads = 0;
  return { s, lesson };
}
const FIGURE_ST = 'În figura alăturată este reprezentat triunghiul $ABC$. Perimetrul triunghiului este:';

test('intrarea în sală: lecția scrisă înainte de desene îl primește o singură dată; cronologia îl are', async () => {
  handler._internals.resetFree();
  const { s } = world({ statements: ['Rezultatul calculului $\\frac{1}{2}+3$ este:', FIGURE_ST] });
  const a = await call('join', { sessionId: s.id }, U.prem);
  assert.strictEqual(a.statusCode, 200, JSON.stringify(a.body));
  assert.strictEqual(downloads, 1);
  const row = fake.db.tables.live_lessons[0];
  assert.strictEqual(row.script.figv, FIG.FIG_V);
  assert.deepStrictEqual(row.script.figInfo.found, ['I.2']);
  assert.ok(row.script.items[1].figure && !row.script.items[0].figure);
  assert.strictEqual(row.status, 'gata', 'lecția rămâne gata (doar desenele s-au adăugat)');
  assert.strictEqual(row.locked_until, null, 'lacătul eliberat');
  assert.deepStrictEqual(fake.db.uploads.map((u) => u.path), [`lessons/${row.id}/fig-I2.png`]);
  const heads = a.body.timeline.scenes.filter((x) => x.type === 'item');
  assert.ok(heads[1].figure && heads[1].figure.url.includes(`/live-media/lessons/${row.id}/fig-I2.png`), JSON.stringify(heads[1]));
  assert.strictEqual(heads[0].figure, undefined);
  // a doua intrare: nimic de refăcut
  const b = await call('join', { sessionId: s.id }, U.prem);
  assert.strictEqual(b.statusCode, 200);
  assert.strictEqual(downloads, 1);
  assert.strictEqual(fake.db.uploads.length, 1);
  assert.ok(b.body.timeline.scenes.filter((x) => x.type === 'item')[1].figure);
  // Admin → „🖼 Refă desenele": decupate din nou
  const r = await call('admin_prepare', { lessonId: row.id, figures: true }, U.admin);
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(downloads, 2);
  assert.strictEqual(fake.db.uploads.length, 2);
  assert.ok(fake.db.tables.live_lessons[0].script.items[1].figure);
});

test('fără probleme cu figură: se notează o dată (fără descărcare); fără PDF → figErr, fără reîncercări; LIVE_DESENE=0 → nimic', async () => {
  handler._internals.resetFree();
  let w = world({ statements: ['Rezultatul calculului $2+3$ este:', 'Media aritmetică a numerelor 4 și 6 este:'] });
  await call('join', { sessionId: w.s.id }, U.prem);
  assert.strictEqual(downloads, 0);
  assert.strictEqual(fake.db.tables.live_lessons[0].script.figv, FIG.FIG_V);
  assert.strictEqual(fake.db.uploads.length, 0);

  w = world({ statements: ['Calculați.', FIGURE_ST], subject: SUBJ2, fileUrl: null });
  await call('join', { sessionId: w.s.id }, U.prem);
  assert.strictEqual(fake.db.tables.live_lessons[0].script.figErr, 'subiectul nu are PDF');
  await call('join', { sessionId: w.s.id }, U.prem);
  assert.strictEqual(downloads, 0);

  process.env.LIVE_DESENE = '0';
  try {
    w = world({ statements: ['Calculați.', FIGURE_ST] });
    const a = await call('join', { sessionId: w.s.id }, U.prem);
    assert.strictEqual(a.statusCode, 200);
    assert.strictEqual(downloads, 0);
    assert.strictEqual(fake.db.tables.live_lessons[0].script.figv, undefined);
  } finally { delete process.env.LIVE_DESENE; }
});

test('PDF-ul nu se descarcă: lecția merge mai departe (figErr), fără desen', async () => {
  handler._internals.resetFree();
  const { s } = world({ statements: ['Calculați.', FIGURE_ST] });
  const prev = pdf.downloadContentPdf;
  pdf.downloadContentPdf = async () => { throw new Error('Nu am putut descărca fișierul: HTTP 404'); };
  try {
    const a = await call('join', { sessionId: s.id }, U.prem);
    assert.strictEqual(a.statusCode, 200, JSON.stringify(a.body));
    assert.ok(a.body.timeline, 'lecția se joacă');
    const row = fake.db.tables.live_lessons[0];
    assert.match(row.script.figErr, /HTTP 404/);
    assert.strictEqual(row.status, 'gata');
    assert.ok(!row.script.items.some((it) => it.figure));
  } finally { pdf.downloadContentPdf = prev; }
});
