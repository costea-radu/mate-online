// =====================================================================
// test/bara-sus-telefon.test.js — bara de sus a testelor (interactive, PDF) la
// vedere pe telefon (src/lib/baraSus.js): nu sub bara de stare (aplicația de pe
// ecranul principal), nu „urcată" după închiderea tastaturii (iPhone, Safari 26),
// iar bara PDF-ului de pe telefon nu mai iese din ecran.
// =====================================================================
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let mod = null;
const load = async () => { if (!mod) mod = await import('../src/lib/baraSus.js'); return mod; };

// o fereastră de telefon simulată: documentul derulat, fereastra vizibilă, tastatura
function fereastra({ h = 760, w = 390 } = {}) {
  const ev = new Map();
  const on = (map) => (type, fn) => { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn); };
  const off = (map) => (type, fn) => { if (map.has(type)) map.get(type).delete(fn); };
  const vvEv = new Map();
  const win = {
    innerWidth: w, innerHeight: h, scrollY: 0, scrolls: [],
    document: { activeElement: { tagName: 'BODY' } },
    addEventListener: on(ev), removeEventListener: off(ev),
    scrollTo(x, y) { this.scrolls.push([x, y]); this.scrollY = y; this.visualViewport.offsetTop = 0; },
    scrollBy() {},
    visualViewport: { height: h, offsetTop: 0, addEventListener: on(vvEv), removeEventListener: off(vvEv) },
    fire(type, onVv = false) { for (const fn of [...((onVv ? vvEv : ev).get(type) || [])]) fn(); },
    listeners: () => [...ev.values(), ...vvEv.values()].reduce((n, s) => n + s.size, 0),
  };
  return win;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('decizia: documentul se readuce la 0 doar cu tastatura închisă și fără un câmp în focus', async () => {
  const { trebuieReadus, tastaturaDeschisa, KEYBOARD_MIN } = await load();
  assert.strictEqual(KEYBOARD_MIN, 120);
  assert.strictEqual(trebuieReadus({ scrollY: 47, vvH: 760, maxH: 760 }), true, 'bara urcată sub bara de stare → înapoi');
  assert.strictEqual(trebuieReadus({ scrollY: 0, offsetTop: 3, vvH: 760, maxH: 760 }), true, 'fereastra vizibilă decalată (Safari 26)');
  assert.strictEqual(trebuieReadus({ scrollY: 0, vvH: 760, maxH: 760 }), false, 'la locul ei: nimic');
  assert.strictEqual(trebuieReadus({ scrollY: 210, vvH: 420, maxH: 760 }), false, 'tastatura deschisă (câmpul din iframe-ul testului): iOS ține câmpul la vedere');
  assert.strictEqual(trebuieReadus({ scrollY: 210, vvH: 760, maxH: 760, scrie: true }), false, 'se scrie în chat');
  assert.strictEqual(trebuieReadus({ scrollY: 0, offsetTop: 30, vvH: 691, maxH: 760, zoom: 1.1 }), false, 'pagina mărită cu două degete: o plimbă elevul, nu o tragem înapoi');
  assert.strictEqual(trebuieReadus({ scrollY: 0, offsetTop: 30, vvH: 691, maxH: 760, zoom: 1 }), true);
  assert.strictEqual(tastaturaDeschisa({ vvH: 700, maxH: 760 }), false, 'bara de jos a browserului care se strânge nu e tastatura');
  assert.strictEqual(tastaturaDeschisa({ vvH: 430, maxH: 760 }), true);
});

test('pe fereastra simulată: după tastatură, bara revine sus; cât e tastatura deschisă, nu', async () => {
  const { tineBaraSus } = await load();
  const w = fereastra();
  const stop = tineBaraSus(w, { delay: 5 });
  await wait(20);
  assert.deepStrictEqual(w.scrolls, [], 'la deschidere, documentul e la 0: nimic');
  // elevul scrie într-un pas al testului (iframe): tastatura, iOS derulează documentul
  w.document.activeElement = { tagName: 'IFRAME' };
  w.visualViewport.height = 420; w.scrollY = 210;
  w.fire('resize', true); w.fire('scroll');
  await wait(20);
  assert.deepStrictEqual(w.scrolls, [], 'cât e tastatura deschisă, nu se atinge');
  // tastatura se închide, dar documentul rămâne urcat cu bara de stare (47 px)
  w.visualViewport.height = 760; w.scrollY = 47;
  w.fire('resize', true);
  await wait(20);
  assert.deepStrictEqual(w.scrolls, [[0, 0]], 'bara testului revine sub bara de stare, nu sub ea');
  // o derulare a documentului fără tastatură (scroll chaining) → tot înapoi
  w.scrollY = 30; w.fire('scroll');
  await wait(20);
  assert.strictEqual(w.scrolls.length, 2);
  // elevul mărește pagina cu două degete și o plimbă: nu o tragem înapoi
  w.visualViewport.scale = 1.1; w.visualViewport.height = 691; w.visualViewport.offsetTop = 30;
  w.fire('scroll', true);
  await wait(20);
  assert.strictEqual(w.scrolls.length, 2, 'cu zoom, nu se atinge');
  w.visualViewport.scale = 1; w.visualViewport.height = 760; w.visualViewport.offsetTop = 0;
  // ecranul rotit: înălțimea de referință se ia de la capăt
  w.innerWidth = 844; w.visualViewport.height = 390; w.scrollY = 0;
  w.fire('resize');
  await wait(20);
  assert.strictEqual(w.scrolls.length, 2, 'peisaj: 390 px nu înseamnă tastatură');
  w.scrollY = 12; w.fire('scroll');
  await wait(20);
  assert.strictEqual(w.scrolls.length, 3);
  stop();
  assert.strictEqual(w.listeners(), 0, 'la ieșirea din test, ascultătorii se scot');
});

test('spațiul de sus: bara nu stă sub bara de stare / „notch" (aplicația de pe ecranul principal)', async () => {
  const { paddingBara, sigurSus } = await load();
  assert.strictEqual(sigurSus(6), 'max(6px, env(safe-area-inset-top, 0px))');
  assert.deepStrictEqual(paddingBara(6, 8), {
    paddingTop: 'max(6px, env(safe-area-inset-top, 0px))', paddingBottom: 6,
    paddingLeft: 'max(8px, env(safe-area-inset-left, 0px))', paddingRight: 'max(8px, env(safe-area-inset-right, 0px))',
  });
  assert.match(read('index.html'), /apple-mobile-web-app-status-bar-style" content="black-translucent"/, 'de aceea: pagina începe sub bara de stare');
});

test('vizualizatoarele folosesc bara „sigură": testele interactive, PDF-urile, exercițiile AI', () => {
  const iv = read('src/pages/InteractiveViewer.jsx');
  assert.match(iv, /import \{ useBaraSusVizibila, paddingBara \} from '\.\.\/lib\/baraSus';/);
  assert.match(iv, /\n  useBaraSusVizibila\(\);\n/);
  assert.match(iv, /gap: 5, \.\.\.paddingBara\(6, 8\), background: 'var\(--navy\)'/, 'bara de pe telefon');
  assert.match(iv, /\.\.\.paddingBara\(10, 20\), background: 'var\(--navy\)'/, 'bara de pe calculator');
  // bara testelor interactive pe telefon: aceleași pictograme (cererea din 4 nov.)
  for (const label of ['Înapoi', 'Foaie de lucru', 'Resetează testul', 'Toate exercițiile']) assert.ok(iv.includes(`aria-label="${label}"`), label);

  const pdf = read('src/pages/PDFViewer.jsx');
  assert.match(pdf, /\n  useBaraSusVizibila\(\);\n/);
  assert.doesNotMatch(pdf, /window\.visualViewport\?\.addEventListener\('resize', reset\)/, 'vechiul „reset" e înlocuit de baraSus');
  assert.match(pdf, /\.\.\.\(tiny \? paddingBara\(7, 8\) : paddingBara\(10, 20\)\)/);
  assert.match(pdf, /\.\.\.\(tiny \? \{ flexWrap:'wrap', rowGap:6 \} : \{\}\)/, 'pe telefon, ce nu încape trece pe al doilea rând — nu iese din ecran');
  assert.match(pdf, /\{tiny \? <span style=\{\{ flex:1 \}\} \/> : \(/, 'fără titlul care rămânea „📄…"');
  assert.match(pdf, /const tutorIcon = tiny && !modTest;/);
  assert.match(pdf, /aria-label=\{tutorOpen \? 'Închide profesorul virtual' : 'Profesorul virtual'\}/);
  assert.match(pdf, /'📋 Barem'/);
  assert.match(pdf, /← Înapoi/);

  const ai = read('src/pages/ExercitiuAIViewer.jsx');
  assert.match(ai, /\n  useBaraSusVizibila\(\);\n/);
  assert.match(ai, /\.\.\.paddingBara\(10, narrow \? 10 : 20\)/);
  assert.match(ai, /\.exai-root\{height:100vh;height:100dvh\}/);
});
