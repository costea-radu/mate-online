// =====================================================================
// test/rezolva-pe-pdf.test.js — „✏️ Rezolvă pe PDF" (7 nov. 2026)
//
// Cererea lui Radu: la PDF-urile de Evaluare Națională, grila de la Subiectele I
// și II să se rezolve DIRECT PE PDF, prin încercuire, iar la Subiectul III să se
// scrie direct în zona de rezolvare — „un spațiu de lucru, dar invizibil", cu
// recunoașterea exercițiului rezolvat și corectare; pornit cu „Rezolvă pe PDF",
// cu „Corectează" la final; PDF-ul rămâne PDF.
//   · src/lib/pdfRezolvare.js — harta testului din textul PDF-ului (regiunile
//     exercițiilor + literele a)–d)), recunoașterea cercului, ciorna, imaginile;
//   · api/_lib/pdfRezolvare.js + api/rezolva-pdf.js — grilele după barem (fără AI,
//     și fără abonament), scrisul la corector (Premium), salvarea, conversația;
//   · legăturile din interfață (PDFViewer, PdfCanvasViewer, ChatPanel, aiClient).
// Desenul, stratul de scris și corectarea cap-coadă au fost verificate în
// Chromium, pe subiecte EN sintetice (variante pe coloană, pe rând, 2×2, test
// combinat din regiuni decupate), cu /api simulat.
// Rulare: npm test
// =====================================================================
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
delete process.env.AI_CORECTOR_MODEL;
delete process.env.AI_CORECTOR_MODEL_ECON;
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8');
let libP = null;
const lib = () => (libP || (libP = import('../src/lib/pdfRezolvare.js')));
const R = require('../api/_lib/pdfRezolvare.js');

// ── un subiect EN „cum îl dă pdf.js": itemi de text cu poziții (originea jos-stânga) ──
const W = 595, H = 842;
const it = (str, x, y, h = 11.5) => ({ str, x, y, w: str.length * h * 0.5, h });
const foot = (n) => [it('Probă scrisă la matematică', 57, 40, 9), it(`Pagina ${n} din 5`, 480, 40, 9)];
function enPages({ s1 = 'col', s2 = 'row' } = {}) {
  const pages = [{ n: 1, view: [0, 0, W, H], items: [it('Ministerul Educației', 220, 790), it('Evaluarea Națională pentru absolvenții clasei a VIII-a', 120, 760), it('Matematică', 260, 730), it('Varianta 3', 262, 715), ...foot(1)] }];
  const grila = (items, y, i, layout) => {
    items.push(it('5p', 57, y), it(`${i}.`, 81, y), it(`Enunțul exercițiului ${i} este egal cu:`, 101, y));
    y -= 16;
    if (layout === 'col') {
      ['a', 'b', 'c', 'd'].forEach((l, k) => { items.push(it(`${l}) ${k + 1}0`, 101, y)); y -= 15; });
    } else {
      // pe rând, cu litera și valoarea în itemi separați (cum le rupe des pdf.js)
      ['a', 'b', 'c', 'd'].forEach((l, k) => { items.push(it(`${l})`, 101 + k * 80, y), it(`${k + 2} cm`, 101 + k * 80 + 13, y)); });
      y -= 16;
    }
    return y - 10;
  };
  for (const [n, s, layout, title] of [[2, 1, s1, 'SUBIECTUL I. Încercuiește litera corespunzătoare răspunsului corect. (30 de puncte)'], [3, 2, s2, 'SUBIECTUL al II-lea. Încercuiește litera corespunzătoare răspunsului corect. (30 de puncte)']]) {
    const items = [it(title, 57, 790)];
    let y = 765;
    for (let i = 1; i <= 6; i++) y = grila(items, y, i, layout);
    pages.push({ n, view: [0, 0, W, H], items: [...items, ...foot(n)] });
  }
  // Subiectul al III-lea: enunț, „(2p) a)", spațiu de scris, „(3p) b)", spațiu de scris
  for (const [n, list] of [[4, [1, 2, 3]], [5, [4, 5, 6]]]) {
    const items = n === 4 ? [it('SUBIECTUL al III-lea. Scrie rezolvările complete. (30 de puncte)', 57, 790)] : [];
    let y = n === 4 ? 765 : 790;
    for (const i of list) {
      items.push(it(`${i}.`, 57, y), it(`Problema ${i}, cu datele ei.`, 75, y)); y -= 16;
      items.push(it('(2p)', 57, y), it('a)', 85, y), it('Arată că rezultatul e corect.', 100, y)); y -= 100;
      items.push(it('(3p)', 57, y), it('b)', 85, y), it('Determină valoarea cerută.', 100, y)); y -= 110;
    }
    pages.push({ n, view: [0, 0, W, H], items: [...items, ...foot(n)] });
  }
  return pages;
}
const circle = (cx, cy, rx, ry, turns = 1.05, start = -1.2, n = 40) => Array.from({ length: n + 1 }, (_, i) => {
  const t = start + (i / n) * turns * 2 * Math.PI;
  return [cx + rx * Math.cos(t), cy + ry * Math.sin(t)];
});
const lc = (o) => [(o.lx0 + o.lx1) / 2, (o.y0 + o.y1) / 2];     // centrul literei
const vc = (o) => [(o.vx0 + o.vx1) / 2, (o.y0 + o.y1) / 2];     // centrul valorii

// ═════════════════════════ 1) harta testului ═════════════════════════
test('harta: 6 · 6 · 6, grilele cu literele a)–d) (pe coloană și pe rând, cu itemii rupți), Subiectul III cu a) și b)', async () => {
  const P = await lib();
  const map = P.buildExamMap(enPages());
  assert.strictEqual(map.ok, true, map.reason);
  assert.strictEqual(map.signature, '6-6-6');
  assert.strictEqual(map.grile, 12);
  assert.deepStrictEqual(map.order.filter((k) => map.items[k].tip === 'scris'), ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6']);
  // 1.1, pe coloană: literele una sub alta, în ordine, sub enunț
  const o11 = map.items['1.1'].options;
  assert.deepStrictEqual(o11.map((o) => o.l), ['a', 'b', 'c', 'd']);
  assert.ok(o11.every((o) => o.p === 2 && Math.abs(o.lx0 - 101) < 0.5));
  assert.ok(o11[0].y0 < o11[1].y0 && o11[1].y0 < o11[2].y0, 'de sus în jos');
  // coordonatele sunt de sus (y în jos): „a)" e sub rândul cu enunțul
  assert.ok(o11[0].y0 > map.items['1.1'].anchor.y - 1);
  // 2.3, pe rând: „a)" și valoarea în itemi separați — patru litere pe același rând
  const o23 = map.items['2.3'].options;
  assert.deepStrictEqual(o23.map((o) => o.l), ['a', 'b', 'c', 'd']);
  assert.ok(new Set(o23.map((o) => Math.round(o.y0))).size === 1);
  assert.ok(o23[1].lx0 > o23[0].vx1, 'valoarea lui a) se oprește înainte de b)');
  // III.2: subpunctele a) și b), cu ancorele lor
  assert.deepStrictEqual(map.items['3.2'].parts.map((q) => q.l), ['a', 'b']);
  assert.ok(map.items['3.2'].anchor.x < 60);
  // fiecare item are zona lui; zonele nu se suprapun pe o pagină
  for (const p of [2, 3, 4, 5]) {
    const z = map.order.flatMap((k) => map.items[k].chunks.filter((c) => c.p === p)).sort((a, b) => a.y0 - b.y0);
    for (let i = 1; i < z.length; i++) assert.ok(z[i].y0 >= z[i - 1].y1 - 0.01, `pagina ${p}`);
  }
});

test('harta: PDF fără structură de examen, fără text (scanat), rotit sau cu text suprapus → fără hartă (corectorul citește imaginile)', async () => {
  const P = await lib();
  assert.strictEqual(P.buildExamMap([{ n: 1, view: [0, 0, W, H], items: [it('Fișă de lucru — fracții', 57, 790), ...Array.from({ length: 30 }, (_, i) => it(`Calculează ${i} + ${i} = ...`, 57, 760 - i * 20))] }]).ok, false);
  assert.strictEqual(P.buildExamMap([{ n: 1, view: [0, 0, W, H], items: [] }, { n: 2, view: [0, 0, W, H], items: [] }]).reason, 'fara-text');
  const rot = enPages(); rot[2].rotate = 90;
  assert.strictEqual(P.buildExamMap(rot).reason, 'rotit');
  // testul COMBINAT din regiuni decupate: textul ascuns al paginilor-sursă cade peste exercițiile vizibile
  const comb = enPages();
  comb[1].items = [...comb[1].items, ...comb[1].items.filter((x) => x.str.length >= 3).map((x) => ({ ...x, str: x.str + ' (ascuns)', y: x.y - 3 }))];
  assert.ok(P.overlappingText(comb[1].items) >= 3);
  assert.strictEqual(P.buildExamMap(comb).reason, 'text-suprapus');
  assert.strictEqual(P.overlappingText(enPages()[1].items), 0);
  // același text tipărit de două ori (bold simulat) nu e suprapunere
  const bold = enPages()[1].items.flatMap((x) => [x, { ...x, x: x.x + 0.3 }]);
  assert.strictEqual(P.overlappingText(bold), 0);
});

test('textul ascuns: un item fără niciun pixel închis sub el (sau în afara paginii) nu intră în hartă', async () => {
  const P = await lib();
  const w = 100, h = 100;
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  const mask = { w, h, px };
  const view = [0, 0, 100, 100];
  const item = { str: 'abc', x: 10, y: 50, w: 20, h: 10 };
  assert.strictEqual(P.visibleIn(mask, view, item), false, 'pagină albă');
  const i = (45 * w + 15) * 4; px[i] = 20; px[i + 1] = 20; px[i + 2] = 20;
  assert.strictEqual(P.visibleIn(mask, view, item), true, 'cerneală sub text');
  assert.strictEqual(P.visibleIn(mask, view, { ...item, y: 400 }), false, 'în afara paginii');
  assert.strictEqual(P.visibleIn(null, view, item), true, 'fără randare: păstrăm tot');
});

// ═════════════════════════ 2) recunoașterea ═════════════════════════
test('cercul: în jurul literei, al valorii, lăsat deschis, în spirală → varianta; bifa nu e încercuire', async () => {
  const P = await lib();
  const map = P.buildExamMap(enPages());
  const O = (k, l) => map.items[k].options.find((o) => o.l === l);
  const S = (p, pts) => ({ p, pts });
  assert.deepStrictEqual(P.recognizeChoice(map.items['1.1'], [S(2, circle(...lc(O('1.1', 'b')), 9, 8))]), { letters: ['b'], how: 'cerc', unclear: 0, taiate: [] });
  assert.deepStrictEqual(P.recognizeChoice(map.items['1.2'], [S(2, circle(...vc(O('1.2', 'c')), 11, 8))]).letters, ['c']);
  const d = O('1.3', 'd');
  assert.deepStrictEqual(P.recognizeChoice(map.items['1.3'], [S(2, circle((d.lx0 + d.vx1) / 2, (d.y0 + d.y1) / 2, 22, 9, 0.8))]).letters, ['d'], 'cerc lăsat deschis');
  assert.deepStrictEqual(P.recognizeChoice(map.items['1.4'], [S(2, circle(...lc(O('1.4', 'a')), 9, 8, 1.45))]).letters, ['a'], 'spirală');
  // (8 nov. 2026: bifa nu mai alege varianta — pe foaia de examen se încercuiește; o linie peste literă e o TĂIETURĂ)
  const [x, y] = lc(O('1.5', 'c'));
  assert.deepStrictEqual(P.recognizeChoice(map.items['1.5'], [S(2, [[x - 5, y], [x - 1, y + 5], [x + 7, y - 7]])]).letters, []);
  // pe rând (Subiectul II): cerc în jurul lui c)
  assert.deepStrictEqual(P.recognizeChoice(map.items['2.2'], [S(3, circle(...lc(O('2.2', 'c')), 9, 8))]).letters, ['c']);
});

test('fără variantă clară: două cercuri → ambele litere; cerc peste toate → neclar; calcule lângă variante → nimic', async () => {
  const P = await lib();
  const map = P.buildExamMap(enPages({ s2: 'row' }));
  const O = (k, l) => map.items[k].options.find((o) => o.l === l);
  const two = P.recognizeChoice(map.items['1.6'], [{ p: 2, pts: circle(...lc(O('1.6', 'a')), 9, 8) }, { p: 2, pts: circle(...lc(O('1.6', 'd')), 9, 8) }]);
  assert.deepStrictEqual(two.letters, ['a', 'd']);
  const a = O('2.4', 'a'), d = O('2.4', 'd');
  const big = P.recognizeChoice(map.items['2.4'], [{ p: 3, pts: circle((a.lx0 + d.vx1) / 2, (a.y0 + a.y1) / 2, (d.vx1 - a.lx0) / 2 + 8, 12) }]);
  assert.deepStrictEqual(big, { letters: [], how: null, unclear: 1, taiate: [] });
  const v = O('2.5', 'b');
  // calculele scrise sub rândul variantelor (nu peste o literă)
  const calc = P.recognizeChoice(map.items['2.5'], [{ p: 3, pts: [[v.vx0, v.y1 + 9], [v.vx0 + 10, v.y1 + 16], [v.vx0 + 20, v.y1 + 9]] }]);
  assert.deepStrictEqual(calc.letters, []);
});

test('tăieturi (regulile foii de examen): tai varianta încercuită și încercuiești alta; revii la o variantă tăiată scriind litera ei lângă ea, încercuită', async () => {
  const P = await lib();
  for (const layout of ['col', 'row']) {
    const map = P.buildExamMap(enPages({ s1: layout }));
    const O = (k, l) => map.items[k].options.find((o) => o.l === l);
    const line = (x0, y0, x1, y1) => [[x0, y0], [(x0 + x1) / 2, (y0 + y1) / 2 + 0.4], [x1, y1]];
    const strike = (o) => { const [x, y] = lc(o); return line(x - 12, y + 6, x + 12, y - 6); };
    // litera scrisă de mână (tijă + buclă) și încercuită, la dreapta valorii variantei tăiate
    const reselect = (o) => { const x = o.vx1 + 14, y = (o.y0 + o.y1) / 2; return [[[x, y - 7], [x, y + 4]], circle(x + 3, y + 1.5, 3, 3, 1, 0, 16), circle(x + 2, y, 10, 10)]; };
    const R2 = (k, list) => P.recognizeChoice(map.items[k], list.map((pts) => ({ p: 2, pts })));
    // a) b încercuit, tăiat; c încercuit → c
    assert.deepStrictEqual(R2('1.1', [circle(...lc(O('1.1', 'b')), 9, 8), strike(O('1.1', 'b')), circle(...lc(O('1.1', 'c')), 9, 8)]),
      { letters: ['c'], how: 'cerc', unclear: 0, taiate: ['b'] }, layout);
    // b) b încercuit și tăiat, c încercuit și tăiat, lângă b litera „b" încercuită → b
    assert.deepStrictEqual(R2('1.2', [circle(...lc(O('1.2', 'b')), 9, 8), strike(O('1.2', 'b')), circle(...lc(O('1.2', 'c')), 9, 8), strike(O('1.2', 'c')), ...reselect(O('1.2', 'b'))]),
      { letters: ['b'], how: 'revenire', unclear: 0, taiate: ['b', 'c'] }, layout);
    // variantele eliminate (doar tăiate) nu sunt alese; cercul rămâne
    assert.deepStrictEqual(R2('1.3', [strike(O('1.3', 'a')), strike(O('1.3', 'd')), circle(...lc(O('1.3', 'c')), 9, 8)]).letters, ['c'], layout);
    assert.deepStrictEqual(R2('1.4', [strike(O('1.4', 'b'))]).letters, [], layout);
    // X (două linii) peste varianta încercuită = tăiată
    const [x, y] = lc(O('1.5', 'a'));
    assert.deepStrictEqual(R2('1.5', [circle(x, y, 9, 8), line(x - 10, y - 8, x + 10, y + 8), line(x - 10, y + 8, x + 10, y - 8), circle(...lc(O('1.5', 'd')), 9, 8)]).letters, ['d'], layout);
    // un cerc liber cu litera înăuntru, dar lângă o variantă NETĂIATĂ, nu alege nimic în plus
    assert.deepStrictEqual(R2('1.6', [circle(...lc(O('1.6', 'a')), 9, 8), ...reselect(O('1.6', 'c'))]).letters, ['a'], layout);
  }
  // linia (tăietura) vs. bifa / cercul
  assert.strictEqual(P.isStrike([[0, 0], [12, 1], [24, 2]]), true);
  assert.strictEqual(P.isStrike([[0, 0], [4, 6], [12, -6]]), false, 'bifa se rotește mult');
  assert.strictEqual(P.isStrike(circle(10, 10, 8, 8)), false);
  assert.strictEqual(P.isStrike([[0, 0], [3, 0]]), false, 'prea scurtă');
});

test('recunoașterea pe tot testul: fiecare traseu la itemul în a cărui zonă e scris; planul corectării; rezumatul', async () => {
  const P = await lib();
  const map = P.buildExamMap(enPages());
  const O = (k, l) => map.items[k].options.find((o) => o.l === l);
  let id = 1;
  const S = (pts) => ({ id: id++, pts, c: P.INK_COLORS[0], w: P.PEN_PT });
  const z31 = map.items['3.1'].chunks[0];
  const ink = {
    1: [S([[100, 300], [200, 310]])],                                     // coperta → în afara exercițiilor
    2: [S(circle(...lc(O('1.1', 'b')), 9, 8)), S(circle(...lc(O('1.2', 'a')), 9, 8)), S(circle(...lc(O('1.2', 'c')), 9, 8)),
      S([[300, map.items['1.3'].options[0].y0], [320, map.items['1.3'].options[0].y1]])],
    4: [S([[100, z31.y0 + 60], [180, z31.y0 + 64]]), S([[100, z31.y0 + 80], [160, z31.y0 + 82]])],
  };
  const rec = P.recognize(map, ink);
  assert.strictEqual(rec.unassigned, 1);
  assert.deepStrictEqual(rec.items['1.1'].letters, ['b']);
  assert.deepStrictEqual(rec.items['1.2'].letters, ['a', 'c']);
  assert.deepStrictEqual(rec.items['1.3'].letters, []);
  assert.strictEqual(rec.items['3.1'].n, 2);
  assert.strictEqual(rec.items['3.1'].sig, '6,7');
  const plan = P.correctionPlan(map, rec);
  assert.deepStrictEqual(plan, {
    grile: [{ key: '1.1', litere: ['b'], cum: 'cerc' }, { key: '1.2', litere: ['a', 'c'], cum: 'cerc' }],
    nerecunoscute: [{ key: '1.3', motiv: 'nimic' }],
    scris: ['3.1'],
  });
  assert.strictEqual(P.recognitionSummary(map, rec), 'I: 1b), 2⚠, 3? · III: 1');
  // imaginea pentru corector: zona lui III.1 (enunțul + scrisul), toată lățimea paginii
  const crops = P.cropPlan(map, rec, ink, plan.scris);
  assert.strictEqual(crops.length, 1);
  assert.strictEqual(crops[0].p, 4);
  assert.ok(crops[0].y0 <= z31.y0 && crops[0].y1 >= z31.y1 - 0.01 && crops[0].x0 === 0 && crops[0].x1 === W);
  assert.deepStrictEqual(P.cropLabels(crops), ['Imaginea 1 din 1 — pagina 4 a testului; pe ea: III.1.']);
  // fără hartă: paginile scrise, întregi
  const full = P.cropPlan({ pages: map.pages }, null, ink, null);
  assert.deepStrictEqual(full.map((c) => [c.p, c.y0, c.y1]), [[1, 0, H], [2, 0, H], [4, 0, H]]);
});

test('ciorna: trasee compacte (zecimi de punct, diferențe), aceleași după citire', async () => {
  const P = await lib();
  const ink = { 2: [{ id: 3, c: P.INK_COLORS[2], w: 1.7, pts: [[10.04, 20.06], [11.5, 22.25], [15, 30]] }], 4: [{ id: 9, c: '#123456', w: 1.7, pts: [[1, 1]] }] };
  const enc = P.encodeInk(ink);
  assert.deepStrictEqual(enc[2][0], [3, 2, 17, 100, 201, 15, 22, 35, 77]);
  const { ink: back, maxId } = P.decodeInk(JSON.parse(JSON.stringify(enc)));
  assert.strictEqual(maxId, 9);
  assert.deepStrictEqual(back[2][0].pts, [[10, 20.1], [11.5, 22.3], [15, 30]]);
  assert.strictEqual(back[4][0].c, P.INK_COLORS[0], 'culoare necunoscută → albastru');
  assert.ok(P.inkPath(back[2][0].pts).startsWith('M10 20.1Q'));
});

// ═════════════════════════ 3) serverul: grilele, corectorul, totalul ═════════════════════════
const BAREM = `BAREM DE EVALUARE ȘI DE NOTARE
SUBIECTUL I (30 de puncte)
Nr. item 1. 2. 3. 4. 5. 6.
Rezultate c) b) c) b) b) b)
Punctaj 5p 5p 5p 5p 5p 5p
SUBIECTUL al II-lea (30 de puncte)
Nr. item 1. 2. 3. 4. 5. 6.
Rezultate c) b) b) c) c) c)
Punctaj 5p 5p 5p 5p 5p 5p
SUBIECTUL al III-lea (30 de puncte)
1. a) Dacă Bogdan ar avea 60 de lei, Ana ar avea 80 de lei 1p; 140 ≠ 120 1p
b) 2b + 20 = 120 2p; Ana are 70 de lei 1p`;

test('cererea, curățată: chei valide, fără dubluri, litere a–d, imaginile verificate și plafonate', () => {
  const big = 'data:image/jpeg;base64,' + 'A'.repeat(2_100_000);
  const ok = 'data:image/jpeg;base64,' + Buffer.from('zona').toString('base64');
  const q = R.cleanBody({
    grile: [{ key: '1.1', litere: ['B', 'z'] }, { key: '1.1', litere: ['c'] }, { key: '3.1', litere: ['a'] }, { key: '9.9', litere: ['a'] }, { key: '2.2', litere: [] }],
    nerecunoscute: [{ key: '1.1', motiv: 'nimic' }, { key: '2.3', motiv: 'neclar' }],
    scris: ['3.1', '3.1', 'x'],
    images: [{ url: big, label: 'prea mare' }, { url: 'javascript:alert(1)' }, { url: ok, label: 'Imaginea 1' }],
    structura: '6-6-6', harta: true, durationSec: 99999,
  });
  assert.deepStrictEqual(q.grile, [{ key: '1.1', litere: ['b'], cum: 'cerc' }]);
  assert.deepStrictEqual(q.nerecunoscute, [{ key: '2.3', motiv: 'neclar' }]);
  assert.deepStrictEqual(q.scris, ['3.1']);
  assert.deepStrictEqual(q.images, [ok]);
  assert.deepStrictEqual(q.labels, ['Imaginea 1']);
  assert.strictEqual(q.harta, true);
  assert.strictEqual(q.durationSec, 6 * 3600);
  assert.strictEqual(R.cleanBody({ structura: '../x' }).harta, false);
});

test('grilele, după tabelul baremului: 5p sau 0p; două variante = 0p; nerecunoscute = 0p cu motiv; fără literă în barem → corectorul', () => {
  const g = R.gradeGrile(
    [{ key: '1.1', litere: ['c'] }, { key: '1.2', litere: ['a'] }, { key: '1.3', litere: ['a', 'c'] }, { key: '2.6', litere: ['c'] }],
    [{ key: '2.1', motiv: 'nimic' }],
    BAREM,
  );
  const by = Object.fromEntries(g.results.map((x) => [x.key, x]));
  assert.strictEqual(by['1.1'].verdict, 'corect'); assert.strictEqual(by['1.1'].puncte, 5);
  assert.strictEqual(by['1.2'].verdict, 'gresit'); assert.strictEqual(by['1.2'].puncte, 0);
  assert.strictEqual(by['1.3'].puncte, 0); assert.match(by['1.3'].motiv, /mai multe variante/);
  assert.strictEqual(by['2.6'].verdict, 'corect');
  assert.strictEqual(by['2.1'].verdict, 'necompletat'); assert.match(by['2.1'].motiv, /încercuiește/);
  assert.deepStrictEqual(g.faraCheie, []);
  // fără barem (sau tabel necitit): grilele trec la corector
  const g2 = R.gradeGrile([{ key: '1.1', litere: ['c'] }], [], '');
  assert.deepStrictEqual(g2.faraCheie.map((x) => x.key), ['1.1']);
  assert.strictEqual(g2.results.length, 0);
});

test('corectorul: subpunctele III în limitele baremului, problema ≤ 5p (EN 6·6·6); grila din imagine → litera comparată cu baremul; itemul uitat → necorectat', () => {
  const keyMap = require('../api/_lib/barem.js').grilaAnswers(BAREM);
  const out = R.normalizeAi({
    itemi: [
      { cheie: '3.1', eticheta: 'x', litera: null, transcriere: 'b+b+20=120', subpuncte: [
        { litera: 'a', verdict: 'corect', puncte: 7, puncte_max: 2, pasi: [], motiv_punctaj: '' },
        { litera: 'b', verdict: 'corect', puncte: 1, puncte_max: 4, pasi: [{ text: '2b=100', verdict: 'corect', comentariu: '' }], motiv_punctaj: 'lipsește suma Anei' },
      ] },
      { cheie: '2.4', eticheta: 'x', litera: 'B', transcriere: '', subpuncte: [{ litera: '', verdict: 'corect', puncte: 5, puncte_max: 5, pasi: [], motiv_punctaj: '' }] },
      { cheie: '9.9', subpuncte: [] },
    ],
    feedback: 'Bine.', sfat: 'Citește cerința.',
  }, { want: ['3.1', '3.2', '2.4'], hasBarem: true, structura: '6-6-6', keyMap });
  const by = Object.fromEntries(out.items.map((x) => [x.key, x]));
  assert.strictEqual(by['3.1'].parti[0].puncte, 2, 'a) plafonat la maximul lui');
  assert.strictEqual(by['3.1'].puncte, 3);
  assert.strictEqual(by['3.1'].puncte_max, 5, 'problema EN: 5 puncte');
  assert.strictEqual(by['3.1'].verdict, 'partial');
  assert.strictEqual(by['2.4'].litera, 'b');
  assert.strictEqual(by['2.4'].verdict, 'gresit', 'baremul dă c) la II.4 — nu verdictul modelului');
  assert.strictEqual(by['3.2'].verdict, 'neclar');
  assert.strictEqual(by['3.2'].puncte, null);
  assert.ok(!by['9.9']);
});

test('totalul: din 90; „complet" doar cu toate trei subiectele atinse și totul punctat; mesajul nu dezvăluie litera corectă', () => {
  const items = [
    { key: '1.1', s: 1, ex: 1, tip: 'grila', litera: 'c', litere: ['c'], verdict: 'corect', puncte: 5, puncte_max: 5, motiv: '' },
    { key: '1.2', s: 1, ex: 2, tip: 'grila', litera: 'a', litere: ['a'], verdict: 'gresit', puncte: 0, puncte_max: 5, motiv: '' },
    { key: '2.1', s: 2, ex: 1, tip: 'grila', litera: 'c', litere: ['c'], verdict: 'corect', puncte: 5, puncte_max: 5, motiv: '' },
    { key: '3.1', s: 3, ex: 1, tip: 'scris', verdict: 'partial', puncte: 3, puncte_max: 5, parti: [{ l: 'a', verdict: 'corect', puncte: 2, puncte_max: 2, pasi: [] }], transcriere: 'b=50', motiv: '' },
  ];
  const sum = R.summarize(items, { structura: '6-6-6' });
  assert.deepStrictEqual([sum.score, sum.total, sum.complete], [13, 90, true]);
  const partial = R.summarize(items.slice(0, 3), { structura: '6-6-6' });
  assert.strictEqual(partial.complete, false, 'fără Subiectul III atins nu se salvează');
  const locked = R.summarize([...items.slice(0, 3), { key: '3.1', s: 3, ex: 1, tip: 'scris', verdict: 'blocat', blocat: true, puncte: null, puncte_max: 5 }], { structura: '6-6-6' });
  assert.strictEqual(locked.complete, false);
  assert.deepStrictEqual(locked.pending, ['3.1']);
  const msg = R.formatMessage({ items, sum, structura: '6-6-6', title: 'Varianta 3', hasBarem: true, nota: 2.3 });
  assert.match(msg, /\*\*13\/90p\*\*/);
  assert.match(msg, /nota \*\*2,30\*\*/);
  // nota pe un test început (8 nov. 2026): pusă și explicată, cu drumul de revenire
  const msgP = R.formatMessage({ items: items.slice(0, 3), sum: partial, structura: '6-6-6', title: 'Varianta 3', hasBarem: true, nota: 2, saved: { kind: 'progress' } });
  assert.match(msgP, /nota \*\*2,00\*\*/);
  assert.match(msgP, /ce n-ai rezolvat încă are 0 puncte\. Poți reveni oricând/);
  assert.match(msgP, /Nota s-a salvat la „Rezultatele mele" \(o vede și profesorul tău, la „Rezultate elevi"\)/);
  assert.strictEqual(R.fmtNota(7.3), '7,30');
  assert.match(msg, /necompletați: I\.3, I\.4/);
  assert.match(msg, /✖ 2\. ai ales a\) — 0\/5p/);
  assert.ok(!/corect(ul|ă)? (e|era) c\)/i.test(msg), 'nu spune litera corectă');
  assert.ok(!/(^|\s)_[^_\n]+_(\s|$)/m.test(msg), 'fără _italice_ (chatul nu le randează)');
  assert.match(msg, /Ce am citit: b=50/);
});

// ═════════════════════════ 4) endpointul (cu Supabase / Claude simulate) ═════════════════════════
const ai = require('../api/_lib/ai.js');
const testlock = require('../api/_lib/testlock.js');
const pdfContext = require('../api/ai-pdf-context.js');
const correct = require('../api/ai-correct.js');
const xp = require('../api/_lib/xp.js');
const duel = require('../api/_lib/duel.js');
const turneu = require('../api/_lib/turneu.js');
const pregatire = require('../api/_lib/pregatireZilnica.js');
const handler = require('../api/rezolva-pdf.js');

function supaStub(log, { usedFree = 0 } = {}) {
  function make(table) {
    const ops = [];
    const p = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === 'then') {
          const ins = ops.find((o) => o[0] === 'insert');
          if (ins) log.push({ table, insert: ins[1][0] });
          if (table === 'ai_usage' && !ins) log.push({ table, query: ops.map((o) => [o[0], ...o[1].filter((a) => typeof a === 'string')]) });
          const out = table === 'ai_conversations' && ins ? { data: { id: 'conv-pdf' }, error: null }
            : table === 'ai_messages' && ins ? { data: { id: 'msg-' + log.length }, error: null }
              : table === 'ai_usage' ? { data: null, count: usedFree, error: null }
                : { data: null, error: null };
          return (res, rej) => Promise.resolve(out).then(res, rej);
        }
        return (...args) => { ops.push([prop, args]); return p; };
      },
    });
    return p;
  }
  return { from: (t) => make(t) };
}
function stub(t, { premium = true, locked = false, usedFree = 0 } = {}) {
  const saved = [];
  const patch = (obj, k, v) => { saved.push([obj, k, obj[k]]); obj[k] = v; };
  const st = { usage: [], quota: [], db: [], progress: [], claude: [], pregatire: [] };
  patch(ai, 'authUser', async () => 'u-1');
  patch(ai, 'requireUser', async () => ({ id: 'u-1', role: 'elev', is_admin: false, subscription_status: premium ? 'active' : null }));
  patch(ai, 'enforceRateLimit', async () => ({ degraded: false }));
  patch(ai, 'enforceFeatureQuota', async (s, u, p, key) => { st.quota.push(key); });
  patch(ai, 'logUsage', async (s, u, endpoint) => { st.usage.push(endpoint); });
  patch(ai, 'admin', () => supaStub(st.db, { usedFree }));
  patch(testlock, 'activeTest', async () => ({ locked }));
  patch(pdfContext, 'loadContentForUser', async (s, id) => ({ id, title: 'EN Varianta 3', category: 'evaluare-nationala' }));
  patch(pdfContext, 'getPdfContext', async () => ({ text: 'SUBIECTUL I ... SUBIECTUL al III-lea 1. Ana și Bogdan ...', baremText: BAREM }));
  patch(correct, 'saveProgress', async (s, u, o) => { st.progress.push(o); return { attempts: 1, timeSpent: 0 }; });
  patch(xp, 'award', async () => ({ xpExercitiu: 0 }));
  patch(duel, 'recordByContent', async () => {});
  patch(turneu, 'recordScore', async () => {});
  // „🎯 Pregătește-mă de examen" (8 nov. 2026): ce primește testul zilei
  patch(pregatire, 'inregistreaza', async (s, u, o) => { st.pregatire.push({ userId: u, ...o }); return { tocmaiBifata: true, itemi: o.itemi, lipsa: 0 }; });
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url) !== 'https://api.anthropic.com/v1/messages') throw new Error('apel neașteptat: ' + url);
    const body = JSON.parse(opts.body);
    st.claude.push(body);
    const text = JSON.stringify({
      itemi: [{ cheie: '3.1', eticheta: 'III.1', litera: null, transcriere: 'b+b+20=120\n2b=100', subpuncte: [
        { litera: 'a', verdict: 'corect', puncte: 2, puncte_max: 2, pasi: [], motiv_punctaj: '1p+1p' },
        { litera: 'b', verdict: 'partial', puncte: 1, puncte_max: 3, pasi: [], motiv_punctaj: 'lipsește rezultatul' },
      ] }],
      feedback: 'Ai pornit bine.', sfat: 'Ce se cere la b)?',
    });
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 4000, output_tokens: 900 } }) };
  };
  // (în ordine inversă; o a doua simulare în același test se face după st.restore())
  st.restore = () => { while (saved.length) { const [obj, k, v] = saved.pop(); obj[k] = v; } global.fetch = origFetch; };
  t.after(st.restore);
  return st;
}
function fakeRes() {
  const r = { statusCode: 200, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = () => {};
  r.end = () => r;
  return r;
}
const IMG = 'data:image/jpeg;base64,' + Buffer.from('zona-III-1-cu-scris').toString('base64');
const BODY = {
  context: { contentId: 'en-3', title: 'EN Varianta 3', category: 'evaluare-nationala' },
  grile: [{ key: '1.1', litere: ['c'] }, { key: '1.2', litere: ['a'] }, { key: '2.1', litere: ['c'] }],
  nerecunoscute: [], scris: ['3.1'], harta: true, structura: '6-6-6', durationSec: 600,
  images: [{ url: IMG, label: 'Imaginea 1 din 1 — pagina 4 a testului; pe ea: III.1.' }],
};
const call = async (body) => { const res = fakeRes(); await handler({ method: 'POST', headers: {}, body }, res); return res; };

test('fără Premium: prima din cele 2 corectări gratuite ale grilei — după barem, fără AI; III rămâne „⭐ Premium"; nota pe testul început se salvează', async (t) => {
  const st = stub(t, { premium: false });
  const res = await call({ ...BODY, images: [] });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(st.claude.length, 0);
  assert.deepStrictEqual(st.quota, []);
  assert.strictEqual(res.body.premiumNeeded, true);
  // numărătoarea: corectările gratuite ale contului, sub „rezolva-pdf:grila"
  const q = st.db.find((x) => x.table === 'ai_usage' && x.query);
  assert.ok(q && JSON.stringify(q.query).includes('"eq","endpoint","rezolva-pdf:grila"'), JSON.stringify(q));
  assert.deepStrictEqual(st.usage, ['rezolva-pdf:grila']);
  assert.deepStrictEqual(res.body.gratuite, { folosite: 1, total: 2, ramase: 1 });
  assert.match(res.body.text, /🎁 Corectare gratuită a grilei: 1 din 2 — ți-a mai rămas una/);
  const by = Object.fromEntries(res.body.items.map((x) => [x.key, x]));
  assert.strictEqual(by['1.1'].verdict, 'corect');
  assert.strictEqual(by['1.2'].verdict, 'gresit');
  assert.strictEqual(by['3.1'].verdict, 'blocat');
  assert.strictEqual(res.body.score, 10);
  assert.strictEqual(res.body.complete, false);
  // nota se pune și pe un test început: 10p + 10 din oficiu → 2,00; se salvează
  // (la „Rezultatele mele" și „Rezultate elevi"), ca elevul să poată reveni
  assert.strictEqual(res.body.nota, 2);
  assert.strictEqual(st.progress.length, 1);
  assert.deepStrictEqual([st.progress[0].score, st.progress[0].maxScore], [10, 90]);
  assert.strictEqual(res.body.saved.kind, 'progress');
  assert.strictEqual(res.body.saved.partial, true);
  assert.match(res.body.text, /nota \*\*2,00\*\*/);
  assert.match(res.body.text, /Premium/);
  // corectarea intră în conversație
  assert.ok(st.db.some((x) => x.table === 'ai_messages' && /Corectarea rezolvării de pe PDF/.test(x.insert.content)));
  // „🎯 Pregătește-mă de examen": exercițiile lucrate pe PDF se numără la testul
  // zilei (și o parte de test): 3 grile + III.1 scris = 4, din subiectele I, II, III
  assert.strictEqual(st.pregatire.length, 1);
  const pz = st.pregatire[0];
  assert.strictEqual(pz.userId, 'u-1');
  assert.deepStrictEqual([pz.content.id, pz.content.category, pz.content.content_type], ['en-3', 'evaluare-nationala', 'pdf']);
  assert.strictEqual(pz.itemi, 4);
  assert.deepStrictEqual([...new Set(pz.subiecte)].sort(), [1, 2, 3]);
  assert.strictEqual(pz.nota, 2);
  assert.strictEqual(pz.complet, false);
  assert.strictEqual(res.body.pregatire.tocmaiBifata, true, 'răspunsul poartă bifa zilei (PregatireToast)');
});

test('fără Premium: a doua corectare gratuită e ultima; a treia → îndemnul spre Premium (402), fără nimic consumat', async (t) => {
  let st = stub(t, { premium: false, usedFree: 1 });
  let res = await call({ ...BODY, images: [] });
  assert.strictEqual(res.statusCode, 200);
  assert.deepStrictEqual(res.body.gratuite, { folosite: 2, total: 2, ramase: 0 });
  assert.match(res.body.text, /ultima corectare gratuită a grilei/);
  st.restore();
  st = stub(t, { premium: false, usedFree: 2 });
  res = await call({ ...BODY, images: [] });
  assert.strictEqual(res.statusCode, 402);
  assert.strictEqual(res.body.code, 'PREMIUM_REQUIRED');
  assert.match(res.body.error, /cele 2 corectări gratuite ale grilei/);
  assert.deepStrictEqual(res.body.gratuite, { folosite: 2, total: 2, ramase: 0 });
  assert.deepStrictEqual(st.usage, []);
  assert.ok(!st.db.some((x) => x.table === 'ai_messages'));
});

test('fără Premium: doar Subiectul III scris → Premium (402); doar grile neîncercuite clar → 400; niciuna nu consumă', async (t) => {
  let st = stub(t, { premium: false });
  let res = await call({ ...BODY, grile: [], images: [] });
  assert.strictEqual(res.statusCode, 402);
  assert.match(res.body.error, /Subiectul al III-lea/);
  assert.deepStrictEqual(st.usage, []);
  st.restore();
  st = stub(t, { premium: false });
  res = await call({ ...BODY, grile: [], scris: [], images: [], nerecunoscute: [{ key: '1.4', motiv: 'nimic' }] });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'GRILA_NERECUNOSCUTA');
  assert.deepStrictEqual(st.usage, []);
});

test('corectările gratuite ale grilei nu sunt cereri AI: nu consumă acțiunile AI gratuite, nici limita orară', async () => {
  assert.deepStrictEqual(ai.NU_E_CERERE_AI, ['voce', 'rezolva-pdf:grila']);
  // interogarea reală a celor două limite, pe un Supabase simulat
  const filtre = [];
  const q = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') return (res) => res({ count: 0, data: null, error: null });
      return (...args) => { filtre.push([prop, ...args.filter((a) => typeof a === 'string')]); return q; };
    },
  });
  const supa = { from: () => q };
  await ai.enforceFreeQuota(supa, { id: 'u-1', subscription_status: null });
  // + răspunsurile servite din pre-generare (cost 0, fără model) — nici ele nu consumă acțiunile gratuite
  assert.deepStrictEqual(filtre.filter((f) => f[0] === 'neq'), [['neq', 'endpoint', 'voce'], ['neq', 'endpoint', 'rezolva-pdf:grila'],
    ['neq', 'endpoint', 'ai-chat:pregen'], ['neq', 'endpoint', 'ai-chat-stream:pregen']]);
  filtre.length = 0;
  await ai.enforceRateLimit(supa, 'u-1', null, { budgets: false });
  assert.deepStrictEqual(filtre.filter((f) => f[0] === 'neq'), [['neq', 'endpoint', 'voce'], ['neq', 'endpoint', 'rezolva-pdf:grila']]);
  assert.ok(filtre.some((f) => f[0] === 'gte' && f[1] === 'created_at'));
});

test('Premium: imaginea zonei III.1 merge la corector ÎNAINTEA textului, cu eticheta ei; cota „scris"; testul întreg corectat → progress din 90', async (t) => {
  const st = stub(t, { premium: true });
  const res = await call(BODY);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(st.claude.length, 1);
  const content = st.claude[0].messages[0].content;
  assert.strictEqual(content[0].type, 'text');
  assert.match(content[0].text, /pagina 4 a testului; pe ea: III\.1/);
  assert.strictEqual(content[1].type, 'image');
  assert.strictEqual(content[content.length - 1].type, 'text');
  assert.match(content[content.length - 1].text, /"3\.1" — Subiectul al III-lea, problema 1/);
  assert.match(content[content.length - 1].text, /BAREMUL OFICIAL/);
  assert.match(st.claude[0].system, /SCRISUL DE MÂNĂ/);
  assert.deepStrictEqual(st.quota, ['scris']);
  assert.ok(st.usage.includes('ai-handwriting:correct'));
  assert.strictEqual(res.body.score, 13);
  assert.strictEqual(res.body.total, 90);
  assert.strictEqual(res.body.complete, true);
  assert.strictEqual(res.body.nota, 2.3);
  assert.deepStrictEqual(st.progress.map((p) => [p.contentId, p.score, p.maxScore]), [['en-3', 13, 90]]);
  const p31 = res.body.items.find((x) => x.key === '3.1');
  assert.deepStrictEqual(p31.parti.map((q) => [q.l, q.puncte, q.puncte_max]), [['a', 2, 2], ['b', 1, 3]]);
  assert.strictEqual(res.body.conversationId, 'conv-pdf');
});

test('test pe grupă în desfășurare → 423; nimic de corectat → 400', async (t) => {
  const st = stub(t, { locked: true });
  assert.strictEqual((await call(BODY)).statusCode, 423);
  st.restore();
  stub(t, {});
  assert.strictEqual((await call({ context: BODY.context })).statusCode, 400);
});

// ═════════════════════════ 5) interfața: legăturile ═════════════════════════
test('interfața: „✏️ Rezolvă pe PDF" în bara PDF-ului (doar EN, nu barem, nu în test/duel), stratul de scris, „✅ Corectează", conversația', () => {
  const v = read('src/pages/PDFViewer.jsx');
  assert.match(v, /const isEnPdf = item\?\.category === 'evaluare-nationala' && !isBaremItem && baremStatus !== 'este_barem';/);
  assert.match(v, /const canSolve = isEnPdf && !modTest && !examHtml && !!pdfData;/);
  assert.match(v, /const internal = mobile \|\| solveActive \|\|/);
  assert.strictEqual((v.match(/\{\.\.\.solveProps\}/g) || []).length, 2, 'telefon + calculator');
  assert.strictEqual((v.match(/\{solveBtn\}/g) || []).length, 2);
  assert.match(v, /cmdRef=\{chatCmdRef\}/);
  assert.match(v, /aiClient\.rezolvaPdf\(/);
  assert.match(v, /solve\.keepResult\(r, req\.sigs\)/);
  const c = read('src/components/PdfCanvasViewer.jsx');
  assert.match(c, /createPortal\(overlay\(o\), o\.el/);
  assert.match(c, /\{status === 'ok' && footer\}/);
  assert.match(c, /\{toolbar && toolbar\.left\}/);
  const t = read('src/components/AITutor.jsx');
  assert.match(t, /beginExternal: \(\{ userText, thumb = null, pendingText = '⏳ Corectez…' \} = \{\}\) =>/);
  assert.match(t, /conversationId: \(\) => convId,/);
  assert.match(read('src/lib/aiClient.js'), /rezolvaPdf: \(payload\) => post\('\/api\/rezolva-pdf', payload\)/);
  const r = read('src/components/RezolvarePdf.jsx');
  assert.match(r, /if \(store\.penSeen && e\.pointerType === 'touch'\) return;/);
  assert.match(r, /if \(touches\.size >= 2\) \{ abandon\(\); return; \}/);
  assert.match(r, /\(e\.buttons & 32\) === 32/);
});

test('interfața (8 nov.): „✏️ Rezolvă" pulsează; la BAC și la celelalte PDF-uri deschide foaia de lucru; corectările gratuite ale grilei', () => {
  const v = read('src/pages/PDFViewer.jsx');
  // la orice PDF care nu e test de EN (și nu e barem) → foaia de lucru din panoul profesorului
  assert.match(v, /const rezolvaFoaie = !canSolve && \(!!pdfData \|\| !!examHtml\) && !isBaremItem && baremStatus !== 'este_barem';/);
  assert.match(v, /const solveBtn = \(canSolve \|\| rezolvaFoaie\) && \(/);
  assert.match(v, /onClick=\{canSolve \? toggleSolve : toggleFoaia\}/);
  assert.match(v, /function toggleFoaia\(\) \{\s*if \(tutorOpen && workOpen\) \{ setWork\(false\); return; \}/);
  assert.match(v, /setTutorOpen\(true\);\s*setWork\(true\);/);
  // pulsează cât nu e pornit
  assert.match(v, /className=\{rezolvaActiv \? undefined : 'em-pulse'\}/);
  const css = read('src/styles/global.css');
  assert.match(css, /@keyframes emPulse/);
  assert.match(css, /\.em-pulse \{ animation: emPulse/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.em-pulse \{ animation: none;/);
  // fără abonament: doar grila, după barem (2 corectări gratuite), apoi îndemnul spre Premium
  assert.match(v, /if \(!premium && !req\.grile\.length\) \{/);
  assert.match(v, /if \(r\.gratuite\) \{/);
  assert.match(v, /h\.fail\(e\.message, \{ premium: !!e\.premium, banner: e\.gratuite \? '🔒 Ai folosit corectările gratuite ale grilei\.' : null \}\)/);
  const t = read('src/components/AITutor.jsx');
  assert.match(t, /fail: \(text, \{ premium = false, banner = null \} = \{\}\) => \{/);
  // banda de sus spune motivul adevărat (nu „Ai folosit cele 2 încercări gratuite" — acțiunile cu AI-ul)
  assert.match(t, /if \(premium\) setUpsell\(banner \|\| '🔒 Corectarea face parte din abonamentul Premium\.'\);/);
  assert.match(t, /typeof upsell === 'string' \? upsell : '🔒 Ai folosit cele 2 încercări gratuite\.'/);
  const r = read('src/components/RezolvarePdf.jsx');
  assert.match(r, /export const GRATUITE_GRILA = 2;/);
  assert.match(r, /gratuite: r\.gratuite \|\| null/);
  assert.match(r, /<Link to="\/preturi"/);
  // butonul e unul singur: „✅ Corectează" (cu ⭐ după ce s-au terminat corectările gratuite)
  assert.match(r, /`✅ Corectează\$\{gata \? ' ⭐' : ''\}`/);
});

test('interfața: 402 „corectările gratuite s-au terminat" → capătul PDF-ului arată îndemnul spre Premium', () => {
  assert.match(read('src/lib/aiClient.js'), /if \(data\.gratuite\) e\.gratuite = data\.gratuite;/);
  assert.match(read('src/pages/PDFViewer.jsx'), /if \(e\.gratuite\) solve\.markGratuite\(e\.gratuite\);/);
  const r = read('src/components/RezolvarePdf.jsx');
  assert.match(r, /function markGratuite\(g\) \{/);
  assert.match(r, /store\.setResult\(\{ \.\.\.\(store\.result \|\| \{ byKey: \{\}, sigs: \{\} \}\), gratuite: g \}\);/);
});
