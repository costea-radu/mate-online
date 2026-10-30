// =====================================================================
// test/fereastra-spatiu-lucru.test.js — cererea din 30 octombrie 2026 (3):
//   „fă ca fereastra spațiul de lucru să poată fi modificată în toate zonele
//    în care apare: la fel ca în widget, să poată fi redimensionată și la
//    exerciții interactive și ori de apare."
//
// Fereastra „✍️ Spațiu de lucru" (src/components/SpatiuDeLucru.jsx) — aceeași
// în exercițiile interactive, „Planul meu", sala live și Pregătirea de examen:
//   · pe calculator: PLUTITOARE (nu mai întunecă pagina), se MUTĂ trăgând de
//     antet și se redimensionează de ORICE margine / colț (liniuța widgetului);
//   · pe telefon: jos, pe toată lățimea; bara albastră se trage în sus / jos;
//   · locul și mărimea se țin minte.
// Geometria (pură) se rulează direct; componenta React se verifică pe sursă.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const lib = () => import(path.join(__dirname, '..', 'src', 'lib', 'fereastra.js'));
const SCR = { w: 1400, h: 900 };
const START = { x: 300, y: 100, w: 800, h: 600 };

test('mutarea: fereastra se mută cu pointerul, dar rămâne în ecran', async () => {
  const { geometrieFereastra: g } = await lib();
  assert.deepStrictEqual(g('move', START, 50, -40, SCR, { margin: 12 }), { x: 350, y: 60, w: 800, h: 600 });
  // nu iese în stânga / sus …
  assert.deepStrictEqual(g('move', START, -900, -900, SCR, { margin: 12 }), { x: 12, y: 12, w: 800, h: 600 });
  // … nici în dreapta / jos
  assert.deepStrictEqual(g('move', START, 2000, 2000, SCR, { margin: 12 }), { x: 588, y: 288, w: 800, h: 600 });
});

test('redimensionarea de ORICE margine: dreapta / jos cresc, stânga / sus țin marginea opusă pe loc', async () => {
  const { geometrieFereastra: g } = await lib();
  assert.deepStrictEqual(g('e', START, 100, 0, SCR), { x: 300, y: 100, w: 900, h: 600 });
  assert.deepStrictEqual(g('s', START, 0, 120, SCR), { x: 300, y: 100, w: 800, h: 720 });
  // stânga: tragi spre stânga → mai lată, marginea din dreapta (1100) stă pe loc
  const w = g('w', START, -200, 0, SCR);
  assert.deepStrictEqual(w, { x: 100, y: 100, w: 1000, h: 600 });
  assert.strictEqual(w.x + w.w, START.x + START.w);
  // sus: tragi în sus → mai înaltă, marginea de jos (700) stă pe loc
  const n = g('n', START, 0, -80, SCR);
  assert.deepStrictEqual(n, { x: 300, y: 20, w: 800, h: 680 });
  assert.strictEqual(n.y + n.h, START.y + START.h);
});

test('colțurile combină două margini; limitele: minimum 320 × 300, nu iese din ecran', async () => {
  const { geometrieFereastra: g, MIN_W, MIN_H } = await lib();
  assert.strictEqual(MIN_W, 320);
  assert.strictEqual(MIN_H, 300);
  assert.deepStrictEqual(g('se', START, 50, 60, SCR), { x: 300, y: 100, w: 850, h: 660 });
  assert.deepStrictEqual(g('nw', START, -100, -50, SCR), { x: 200, y: 50, w: 900, h: 650 });
  assert.deepStrictEqual(g('ne', START, 40, -30, SCR), { x: 300, y: 70, w: 840, h: 630 });
  assert.deepStrictEqual(g('sw', START, 60, 40, SCR), { x: 360, y: 100, w: 740, h: 640 });
  // micșorată prea mult → se oprește la minim (marginea opusă tot pe loc)
  const mic = g('nw', START, 2000, 2000, SCR);
  assert.deepStrictEqual(mic, { x: 780, y: 400, w: 320, h: 300 });
  // mărită peste ecran → până la marginea lui
  assert.deepStrictEqual(g('se', START, 5000, 5000, SCR, { margin: 12 }), { x: 300, y: 100, w: 1088, h: 788 });
  assert.deepStrictEqual(g('w', START, -5000, 0, SCR, { margin: 12 }), { x: 12, y: 100, w: 1088, h: 600 });
});

test('fereastra e plutitoare, ca widgetul: nu mai întunecă pagina; se mută de antet; mânere pe toate marginile și colțurile', () => {
  const src = read('src/components/SpatiuDeLucru.jsx');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /rgba\(10,22,36,\.55\)/, 'fără fundalul întunecat peste pagină');
  assert.doesNotMatch(code, /aria-modal="true"/);
  assert.match(code, /role="dialog" aria-modal="false" aria-label="Spațiu de lucru"/);
  assert.match(code, /position: 'fixed', zIndex: 100000, left: winX, top: winY, width: winW, height: winH/);
  // antetul: pe calculator mută fereastra, pe telefon e mânerul înălțimii (ca panoul profesorului)
  assert.match(code, /\{\.\.\.\(narrow \? dragProps\('sheet'\) : dragProps\('move'\)\)\}/);
  assert.match(code, /e\.target\.closest\('button'\)/, 'butoanele din antet nu pornesc tragerea');
  // toate cele 8 mânere
  for (const k of ['w', 'e', 'n', 's', 'nw', 'ne', 'sw', 'se']) assert.match(code, new RegExp(`grip\\('${k}', \\{`), `mânerul ${k}`);
  // liniuța widgetului (ManerLatime): navy, aurie cât tragi
  assert.match(code, /background: dragging \? 'var\(--gold, #e8b931\)' : 'var\(--navy, #0f2b44\)'/);
  // stratul transparent cât tragi: iframe-urile nu fură mișcarea mouse-ului
  assert.match(code, /\{dragging && <div aria-hidden style=\{\{ position: 'fixed', inset: 0, zIndex: 100001/);
  // geometria pură, din src/lib/fereastra.js
  assert.match(src, /import \{ geometrieFereastra, MIN_W, MIN_H \} from '\.\.\/lib\/fereastra';/);
  assert.match(code, /lastSizeRef\.current = geometrieFereastra\(d\.kind, d\.start, dx, dy, scr, \{ margin: MARGIN \}\);/);
});

test('locul și mărimea se țin minte; ferestrele salvate înainte (doar mărimea) se deschid centrate; telefonul ține înălțimea', () => {
  const src = read('src/components/SpatiuDeLucru.jsx');
  assert.match(src, /const WIN_KEY = 'sdl:fereastra';/);
  assert.match(src, /const SHEET_KEY = 'sdl:fereastra:tel';/);
  assert.match(src, /localStorage\.setItem\(d\.kind === 'sheet' \? SHEET_KEY : WIN_KEY, JSON\.stringify\(last\)\)/);
  assert.match(src, /win && win\.x != null \? win\.x : Math\.round\(\(scr\.w - winW\) \/ 2\)/);
  assert.match(src, /win && win\.y != null \? win\.y : Math\.round\(\(scr\.h - winH\) \/ 2\)/);
  // pe telefon: jos, pe toată lățimea; bara se trage în sus → foaia crește
  assert.match(src, /const winY = maxi \? MARGIN : narrow \? scr\.h - winH/);
  assert.match(src, /lastSizeRef\.current = Math\.round\(clamp\(d\.start\.h - dy,/);
  // ⛶ / dublu-clic: tot ecranul, ca înainte
  assert.match(src, /onDoubleClick=\{\(\) => setMaxi\(\(v\) => !v\)\}/);
});

test('aceeași fereastră peste tot unde apare (exerciții interactive, Planul meu, sala live, Pregătirea de examen); în PDF, panoul', () => {
  for (const f of ['src/pages/InteractiveViewer.jsx', 'src/components/AITutor.jsx', 'src/pages/LiveRoom.jsx', 'src/pages/PregatireExamen.jsx']) {
    assert.match(read(f), /<SpatiuDeLucru/, f);
  }
  // în vizualizatorul PDF foaia stă în panoul profesorului, care se trage de margine (calculator) / de bara albastră (telefon)
  assert.match(read('src/components/AITutor.jsx'), /<SpatiuDeLucru\s+embedded/);
  assert.match(read('src/pages/PDFViewer.jsx'), /\{!narrow && <ManerLatime lat=\{lat\} \/>\}/);
});
