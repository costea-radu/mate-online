// =====================================================================
// test/cereri-26-noiembrie.test.js — cererile lui Radu din 25–26 nov. 2026 (partea de site):
//   · nota de la sfârșitul meditației live („pe cât a rezolvat pe ecran") — src/lib/live/nota.js;
//   · testele interactive cu PDF asociat întâi, cele fără PDF la sfârșit — contentMeta.cuPdfIntai;
//   · bridge-ul: indiciile testului rămân, fără „Ajutor" / „Foaie de lucru" pe fiecare exercițiu,
//     modul automat din „Pregătește-mă de examen", MATE_TOTAL_DONE — src/lib/tutorBridge.js;
//   · „Cum ți s-a părut testul?" abia la sfârșit; iconul 🗺️ deschide harta — InteractiveViewer;
//   · Home fără descrierile gri (Materiale, Pregătește-mă, harta elevilor).
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const nota = () => import('../src/lib/live/nota.js');
const meta = () => import('../src/lib/contentMeta.js');
const bridge = () => import('../src/lib/tutorBridge.js');

// cronologia unei lecții EN: I.1 (grilă, 5p), III.1 (8p: încercare + 2 pași + verificare)
const TL = {
  scenes: [
    { type: 'item', item: 0, ref: 'I.1', points: 5 },
    { type: 'sondaj', item: 0, ref: 'I.1', poll: { id: 'p0t-a' } },
    { type: 'item', item: 1, ref: 'III.1', points: 8 },
    { type: 'sondaj', item: 1, ref: 'III.1', poll: { id: 'p1t-b' } },
    { type: 'sondaj', item: 1, ref: 'III.1', poll: { id: 'p1s-c' }, step: { at: 1 } },
    { type: 'sondaj', item: 1, ref: 'III.1', poll: { id: 'p1s-d' }, step: { at: 2 } },
    { type: 'sondaj', item: 1, ref: 'III.1', poll: { id: 'p1c-e' }, verificare: true },
    { type: 'item', item: 2, ref: 'III.2', points: 5 },
    { type: 'sondaj', item: 2, ref: 'III.2', poll: { id: 'p2c-f' }, verificare: true },
  ],
};

test('nota meditației live: din itemii întrebați pe ecran, cu punctajul lor din barem; verificarea contează doar fără alte întrebări', async () => {
  const { notaLectie, fmtNota, felIntrebare } = await nota();
  assert.strictEqual(felIntrebare({ step: {} }), 'pas');
  assert.strictEqual(felIntrebare({ verificare: true }), 'verificare');
  assert.strictEqual(felIntrebare({}), 'incercare');
  // tot corect → 10
  const toate = { 'p0t-a': { correct: true }, 'p1t-b': { correct: true }, 'p1s-c': { correct: true }, 'p1s-d': { correct: true }, 'p1c-e': { correct: false }, 'p2c-f': { correct: true } };
  let n = notaLectie({ timeline: TL, raspunsuri: toate, vazute: Object.keys(toate) });
  assert.strictEqual(n.nota, 10, 'verificarea greșită de la III.1 nu contează (itemul are încercare și pași)');
  assert.deepStrictEqual([n.puncte, n.total, n.itemi], [18, 18, 3]);
  // I.1 greșit, III.1: 2 din 3 corecte, III.2 neapărut → (0 + 8·2/3) / 13
  const r = { 'p0t-a': { correct: false }, 'p1t-b': { correct: true }, 'p1s-c': { correct: true } };
  n = notaLectie({ timeline: TL, raspunsuri: r, vazute: ['p0t-a', 'p1t-b', 'p1s-c', 'p1s-d'] });
  assert.strictEqual(n.total, 13);
  assert.strictEqual(n.nota, Math.round((1 + (9 * (16 / 3)) / 13) * 100) / 100);
  assert.deepStrictEqual([n.corecte, n.intrebari], [2, 4], 'întrebarea apărută și lăsată fără răspuns = greșită');
  assert.strictEqual(fmtNota(7.5), '7,50');
  // nicio întrebare pe ecran → fără notă
  assert.strictEqual(notaLectie({ timeline: TL, raspunsuri: {}, vazute: [] }), null);
  assert.strictEqual(notaLectie({ timeline: null }), null);
});

test('LiveRoom: nota apare în cardul de sfârșit, din întrebările apărute pe ecran', () => {
  const s = read('src/pages/LiveRoom.jsx');
  assert.match(s, /import \{ notaLectie, fmtNota, fmtPuncte \} from '\.\.\/lib\/live\/nota'/);
  assert.match(s, /vazuteRef\.current\.add\(pollScene\.poll\.id\)/);
  assert.match(s, /Nota ta pe ce ai rezolvat pe ecran/);
  assert.match(read('src/styles/live.css'), /\.lv-nota-n \{/);
});

test('testele interactive cu PDF asociat întâi, cele fără PDF la sfârșit (ordinea de pe site rămâne în fiecare grupă)', async () => {
  const { cuPdfIntai } = await meta();
  const rows = [
    { id: 'a', content_type: 'interactive', pdf_sursa_id: null },
    { id: 'p', content_type: 'pdf' },
    { id: 'b', content_type: 'interactive', pdf_sursa_id: 'x' },
    { id: 'c', content_type: 'interactive', pdf_sursa_id: null },
    { id: 'd', content_type: 'interactive', pdf_sursa_id: 'y' },
  ];
  assert.deepStrictEqual(cuPdfIntai(rows).map((r) => r.id), ['p', 'b', 'd', 'a', 'c']);
  assert.deepStrictEqual(cuPdfIntai(null), []);
  for (const f of ['src/components/ContentPage.jsx', 'src/components/ExamContent.jsx']) assert.match(read(f), /setItems\(cuPdfIntai\(data \|\| \[\]\)\)/, f);
});

test('bridge: indiciile testului rămân; fără „Ajutor" / „Foaie de lucru" pe exerciții (sunt în bara de sus); modul automat doar la cerere', async () => {
  const { injectTutorBridge } = await bridge();
  const src = read('src/lib/tutorBridge.js');
  assert.match(src, /function rewireHintButtons\(\)\{ \/\* nimic: indiciile rămân ale testului \*\/ \}/);
  assert.doesNotMatch(src, /Ajutor — întreabă profesorul virtual/);
  assert.doesNotMatch(src, /function makeWorkBtn/);
  assert.match(src, /post\('MATE_TOTAL_DONE', null\)/);
  const h = injectTutorBridge('<html><body><button class="btn-hint">💡 Arată indiciile</button></body></html>', { auto: true });
  assert.ok(h.includes('window.__MATE_AUTO__=true'));
  assert.ok(!injectTutorBridge('<html><body></body></html>').includes('window.__MATE_AUTO__=true'));
  const body = h.slice(h.indexOf('(function(){'), h.lastIndexOf('})();') + 5);
  assert.doesNotThrow(() => new Function(body), 'scriptul bridge-ului se compilează');
});

test('InteractiveViewer: recenzia abia la sfârșitul testului; 🗺️ deschide harta; corectarea automată din „Pregătește-mă"', () => {
  const s = read('src/pages/InteractiveViewer.jsx');
  assert.match(s, /if \(d\.type === 'MATE_TOTAL_DONE' && fromTest\) \{ setTestGata\(true\); return; \}/);
  assert.match(s, /if \(!testGata\) return;/);
  assert.match(s, /const laHarta = \(\) => navigate\('\/pregateste-ma#harta'\);/);
  assert.match(s, /injectTutorBridge\(srcDoc, \{ auto: autoCorectare \}\)/);
  assert.match(s, /const autoCorectare = dinPregatire && !duelId && !gtId && !temaId;/);
  assert.match(read('src/pages/PregatesteMa.jsx'), /hash !== '#harta'/);
});

test('Home: fără descrierile gri la Materiale, „Pregătește-mă de examen" și harta elevilor', () => {
  const home = read('src/pages/Home.jsx');
  assert.doesNotMatch(home, /primești toate exercițiile în ordine, pe o hartă împărțită pe capitole/);
  const acasa = read('src/components/AcasaCont.jsx');
  assert.doesNotMatch(acasa, /<MaterialeCard sub=/);
  assert.match(read('src/components/HartaEleviCard.jsx'), /faraDescriere   \/\* Home: fără descrierea gri/);
});
