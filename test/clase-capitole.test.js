// =====================================================================
// test/clase-capitole.test.js — LECȚIILE CLASELOR PE CAPITOLE, cu pictogramele hărții
// (18 nov. 2026): „Împarte pe capitole lecțiile din «clase». Pune acele pictograme ca
// la hartă și la bareme."
//
// src/lib/capitoleClasa.js (capitolele, progresul pe capitol, ce stă deschis),
// src/components/CapitoleClasa.jsx (interfața), src/components/ContentPage.jsx și
// src/pages/ClassPage.jsx (unde apare), vite.config.js (api/_lib/capitoleHarta.js —
// aceleași reguli și în browser).
// Rulare: npm test
// =====================================================================
delete process.env.PLAN_PRAG;
delete process.env.PLAN_PRAG_PDF;
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const CH = require('../api/_lib/capitoleHarta');
const PL = require('../api/_lib/planPregatire');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let mod = null;
const load = async () => { if (!mod) mod = await import('../src/lib/capitoleClasa.js'); return mod; };
const m = (id, title, content_type = 'interactive') => ({ id, title, content_type });

// titluri reale din paginile claselor (nov. 2026)
const TITLURI = {
  'clasa-5': ['Test interactiv — Matematică, clasa a V-a', 'Metoda mersului invers', 'Fracții zecimale — operații', 'Unități de măsură pentru lungime'],
  'clasa-6': ['Mulțimi — clasa a VI-a', 'Procente — clasa a VI-a', 'Mulțimea numerelor întregi — clasa a VI-a', 'Fișa 18 — Bisectoare și mediatoare · clasa a VI-a', 'Teorema lui Pitagora — clasa a VI-a'],
  'clasa-8': ['Calcul algebric — formule', 'Piramida regulată', 'Funcții — clasa a VIII-a'],
  'clasa-10': ['Radicali · Rezolvare interactivă', 'Logaritmi · Rezolvare interactivă', 'Numere complexe'],
  'clasa-11': ['Matrice — operații', 'Limite de funcții', 'Derivate'],
  'clasa-12': ['Analiză matematică — clasa a XII-a', 'Polinoame', 'Legi de compoziție'],
};

// ═══════════════════════════ 1) capitolele unei file ═══════════════════════════

test('capitolele clasei: după titlu, în ordinea primului material din site, „Alte exerciții" la sfârșit', async () => {
  const M = await load();
  const items = [
    m(1, 'Test interactiv — Matematică, clasa a VI-a'),
    m(2, 'Procente — clasa a VI-a'),
    m(3, 'Triunghiul isoscel — proprietăți'),
    m(4, 'Proporții — clasa a VI-a'),
    m(5, 'Cercul — arce · clasa a VI-a'),
  ];
  const caps = M.peCapitole(items, 'clasa-6', 'interactive');
  assert.deepStrictEqual(caps.map((c) => c.id), ['c6-rapoarte', 'c6-triunghi', 'c6-cerc', 'alte']);
  assert.deepStrictEqual(caps[0].items.map((x) => x.id), [2, 4], 'în capitol, materialele rămân în ordinea din site');
  assert.strictEqual(caps[0].titlu, 'Rapoarte, proporții, procente');
  assert.strictEqual(caps[0].icon, 'procent');
  assert.deepStrictEqual([caps[3].titlu, caps[3].icon, caps[3].alte], ['Alte exerciții', 'alte', true]);
  assert.strictEqual(M.peCapitole([m(9, 'Fișă recapitulativă', 'pdf')], 'clasa-6', 'pdf')[0].titlu, 'Alte fișe');
  assert.deepStrictEqual(M.peCapitole([], 'clasa-6', 'pdf'), []);
});

test('același capitol ca pe hartă și la bareme — aceeași sursă (api/_lib/capitoleHarta.js), cu regula clasei a XII-a', async () => {
  const M = await load();
  for (const [cat, titluri] of Object.entries(TITLURI)) {
    const caps = M.peCapitole(titluri.map((t, i) => m(i, t)), cat, 'interactive');
    for (const c of caps) {
      for (const x of c.items) {
        const h = CH.capitolDin(x.title, cat);
        assert.strictEqual(c.id, h ? h.id : 'alte', `${cat}: ${x.title}`);
        if (h) assert.deepStrictEqual([c.titlu, c.icon], [h.titlu, h.icon]);
      }
    }
  }
  // la a XII-a „analiza" e capitolul integralelor (ca pe hartă)
  assert.strictEqual(M.peCapitole([m(1, 'Analiză matematică — clasa a XII-a')], 'clasa-12', 'interactive')[0].id, 'bac-integrale');
  // fiecare pictogramă a capitolelor claselor există în src/lib/pictograme.jsx
  const pict = read('src/lib/pictograme.jsx');
  for (const lista of [...Object.values(CH.CLASA), CH.BAC]) {
    for (const c of lista) assert.match(pict, new RegExp(`\\n  ${c.icon}: `), `pictograma „${c.icon}" (${c.titlu})`);
  }
});

// ═══════════════════════════ 2) progresul pe capitol ═══════════════════════════

test('trecut: pragurile hărții (70% interactive, 50% PDF); salvarea parțială nu e trecută', async () => {
  const M = await load();
  assert.strictEqual(M.PRAG.interactive, PL.PRAG_INTERACTIV);
  assert.strictEqual(M.PRAG.pdf, PL.PRAG_PDF);
  const I = m(1, 'x');
  const P = m(2, 'y', 'pdf');
  assert.strictEqual(M.trecut(I, { score: 7, max_score: 10 }), true);
  assert.strictEqual(M.trecut(I, { score: 69, max_score: 100 }), false);
  assert.strictEqual(M.trecut(P, { score: 5, max_score: 10 }), true);
  assert.strictEqual(M.trecut(P, { score: 4, max_score: 10 }), false);
  assert.strictEqual(M.trecut(I, { score: 10, max_score: 10, attempts: 0 }), false, 'neterminat (salvat parțial)');
  assert.strictEqual(M.trecut(I, { score: 3, max_score: 0 }), false);
  assert.strictEqual(M.trecut(I, null), false);
  // la fel ca pasul de pe hartă (planPregatire.stareNod → trecutAcum)
  const randuri = [
    { score: 7, max_score: 10 }, { score: 6, max_score: 10, attempts: 3 }, { score: 10, max_score: 10, attempts: 0 },
    { score: 5, max_score: 10, attempts: 1 }, { score: 0, max_score: 0 }, { score: '14', max_score: '20', attempts: '2' },
  ];
  for (const p of randuri) {
    assert.strictEqual(M.trecut(I, p), PL.stareNod({ tip: 'interactive' }, p).trecutAcum, `interactive ${JSON.stringify(p)}`);
    assert.strictEqual(M.trecut(P, p), PL.stareNod({ tip: 'pdf' }, p).trecutAcum, `pdf ${JSON.stringify(p)}`);
  }
});

test('capitolul numără ce a trecut elevul; e gata când le-a trecut pe toate; vizitatorul nu are progres', async () => {
  const M = await load();
  const items = [m('a', 'Procente — clasa a VI-a'), m('b', 'Proporții — clasa a VI-a'), m('c', 'Cercul — arce')];
  const progres = { a: { score: 8, max_score: 10 }, b: { score: 9, max_score: 10, attempts: 2 }, c: { score: 2, max_score: 10 } };
  const [rap, cerc] = M.peCapitole(items, 'clasa-6', 'interactive', progres);
  assert.deepStrictEqual([rap.total, rap.trecute, rap.gata], [2, 2, true]);
  assert.deepStrictEqual([cerc.total, cerc.trecute, cerc.gata], [1, 0, false]);
  for (const c of M.peCapitole(items, 'clasa-6', 'interactive', null)) assert.deepStrictEqual([c.trecute, c.gata], [0, false]);
  for (const c of M.peCapitole(items, 'clasa-6', 'interactive', {})) assert.strictEqual(c.gata, false);
});

// ═══════════════════════════ 3) ce capitole stau deschise ═══════════════════════════

test('la intrare: primul capitol (vizitator) / primul neterminat (elev); ce a lăsat elevul deschis; capitolul cardului', async () => {
  const M = await load();
  const items = [m('a', 'Procente'), m('b', 'Cercul — arce'), m('c', 'Triunghiul isoscel'), m('d', 'Fișă fără capitol')];
  const fara = M.peCapitole(items, 'clasa-6', 'interactive');
  const ids = fara.map((c) => c.id);
  assert.deepStrictEqual(ids, ['c6-rapoarte', 'c6-cerc', 'c6-triunghi', 'alte']);
  const set = (s) => [...s].sort();
  assert.deepStrictEqual(set(M.deschiseLaIntrare(fara, {})), ['c6-rapoarte']);
  const cu = M.peCapitole(items, 'clasa-6', 'interactive', { a: { score: 10, max_score: 10 } });
  assert.deepStrictEqual(set(M.deschiseLaIntrare(cu, { cuProgres: true })), ['c6-cerc'], 'primul neterminat');
  const toate = M.peCapitole(items, 'clasa-6', 'interactive', Object.fromEntries(items.map((x) => [x.id, { score: 1, max_score: 1 }])));
  assert.deepStrictEqual(set(M.deschiseLaIntrare(toate, { cuProgres: true })), ['c6-rapoarte'], 'toate gata → primul');
  // ținut minte în sesiune (capitolele necunoscute — ignorate) + capitolul cardului la care se întoarce
  assert.deepStrictEqual(set(M.deschiseLaIntrare(fara, { salvate: ['nu-exista', 'c6-triunghi'], cardId: 'b' })), ['c6-cerc', 'c6-triunghi']);
  assert.deepStrictEqual(set(M.deschiseLaIntrare(fara, { salvate: [] })), [], 'le-a închis pe toate → rămân închise');
  assert.deepStrictEqual(set(M.deschiseLaIntrare(fara, { cardId: 'd' })), ['alte'], 'întoarcerea dintr-un exercițiu: capitolul lui');
  assert.deepStrictEqual(set(M.deschiseLaIntrare(fara, { cardId: 'nu-e-aici' })), ['c6-rapoarte']);
  const unul = M.peCapitole([m('x', 'Procente')], 'clasa-6', 'interactive');
  assert.deepStrictEqual(set(M.deschiseLaIntrare(unul, { salvate: [] })), ['c6-rapoarte'], 'un singur capitol — deschis');
  assert.strictEqual(M.capitolulMaterialului(fara, 'c'), 'c6-triunghi');
  assert.strictEqual(M.capitolulMaterialului(fara, null), null);
});

test('textele: numeralul acordat și câte a trecut elevul', async () => {
  const M = await load();
  assert.deepStrictEqual(
    [M.cate('interactive', 1), M.cate('interactive', 5), M.cate('interactive', 20), M.cate('interactive', 101), M.cate('pdf', 1), M.cate('pdf', 12), M.cate('pdf', 120)],
    ['1 exercițiu', '5 exerciții', '20 de exerciții', '101 exerciții', '1 fișă', '12 fișe', '120 de fișe'],
  );
  const c = (total, trecute, gata = false) => ({ total, trecute, gata });
  assert.strictEqual(M.subtitluCapitol(c(5, 2), 'interactive', false), '5 exerciții');
  assert.strictEqual(M.subtitluCapitol(c(5, 0), 'interactive', true), '5 exerciții');
  assert.strictEqual(M.subtitluCapitol(c(5, 1), 'interactive', true), '5 exerciții · 1 trecut');
  assert.strictEqual(M.subtitluCapitol(c(5, 1), 'pdf', true), '5 fișe · 1 trecută');
  assert.strictEqual(M.subtitluCapitol(c(5, 3), 'pdf', true), '5 fișe · 3 trecute');
  assert.strictEqual(M.subtitluCapitol(c(5, 5, true), 'interactive', true), '5 exerciții · 🏁 toate trecute');
  assert.strictEqual(M.subtitluCapitol(c(1, 1, true), 'pdf', true), '1 fișă · 🏁 trecută');
});

// ═══════════════════════════ 4) aceleași reguli și în browser ═══════════════════════════

test('vite.config.js dă api/_lib/capitoleHarta.js browserului ca modul ES — un singur fișier de reguli', async () => {
  const cfg = read('vite.config.js');
  assert.match(cfg, /name: 'capitole-harta-esm'/);
  assert.match(cfg, /plugins: \[\s*capitoleHartaEsm\(\),/);
  const transformare = String.raw`code.replace(/^module\.exports\s*=\s*\{/m, 'export {')`;
  assert.ok(cfg.includes(transformare), 'transformarea din vite.config.js e cea verificată aici');
  const src = read('api/_lib/capitoleHarta.js');
  assert.strictEqual((src.match(/^module\.exports\s*=\s*\{/gm) || []).length, 1);
  assert.doesNotMatch(src, /\brequire\(/, 'fără dependențe — merge și în browser');
  assert.doesNotMatch(src, /\bprocess\.|\bBuffer\b|__dirname/);
  assert.doesNotMatch(src.replace(/^module\.exports\s*=\s*\{/m, ''), /\bmodule\.exports\b|\bexports\./);
  // aceeași transformare, aici → modul ES cu exact aceleași răspunsuri
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'capitole-harta-'));
  try {
    const f = path.join(dir, 'capitoleHarta.mjs');
    fs.writeFileSync(f, src.replace(/^module\.exports\s*=\s*\{/m, 'export {'));
    const E = await import(pathToFileURL(f).href);
    for (const [cat, titluri] of Object.entries(TITLURI)) {
      for (const t of titluri) assert.deepStrictEqual(E.capitolDin(t, cat), CH.capitolDin(t, cat), `${cat}: ${t}`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  assert.match(read('src/lib/capitoleClasa.js'), /import \{ capitolDin \} from '\.\.\/\.\.\/api\/_lib\/capitoleHarta\.js';/);
});

// ═══════════════════════════ 5) unde apare ═══════════════════════════

test('paginile claselor: filele interactive și PDF pe capitole, cu inelele și pictogramele hărții', () => {
  assert.match(read('src/pages/ClassPage.jsx'), /<ContentPage[^>]*\n\s+capitole\n\s+bareme\n\s+\/>/);
  // celelalte pagini rămân cum erau (doar clasele au `capitole`)
  assert.doesNotMatch(read('src/pages/Manuale.jsx'), /\bcapitole\b/);

  const cp = read('src/components/ContentPage.jsx');
  assert.match(cp, /import CapitoleClasa from '\.\/CapitoleClasa';/);
  assert.match(cp, /bareme = false, capitole = false \}\)/);
  assert.match(cp, /const peCapitole = capitole && \(activeTab === 'interactive' \|\| activeTab === 'pdf'\);/);
  assert.match(cp, /<CapitoleClasa[\s\S]*?progres=\{user \? progressMap : null\}[\s\S]*?progresGata=\{!user \|\| progresGata\}[\s\S]*?render=\{card\}/);
  assert.match(cp, /cardId=\{location\.state\?\.returnTab === activeTab \? location\.state\?\.scrollToCardId : null\}/);
  assert.match(cp, /setProgresGata\(true\);\n\s+\}, \(\) => setProgresGata\(true\)\);/, 'progresul (sau eroarea lui) deblochează alegerea capitolului deschis');
  assert.match(cp, /\{filtered\.map\(card\)\}/, 'fără `capitole`, lista rămâne cea de dinainte');

  const ui = read('src/components/CapitoleClasa.jsx');
  assert.match(ui, /import \{ InelCapitol, CSS_INEL \} from '\.\.\/lib\/pictograme\.jsx';/);
  assert.match(ui, /<style>\{CSS_INEL \+ CSS\}<\/style>/);
  assert.match(ui, /<InelCapitol c=\{c\} size=\{34\} \/>/, 'șirul capitolelor, ca pe hartă');
  assert.match(ui, /<details[\s\S]*?onToggle=\{laToggle\(c\.id\)\}>\s*<summary className="cc-cap-h">/);
  assert.match(ui, /<InelCapitol c=\{c\} size=\{44\} \/>/);
  assert.match(ui, /\{c\.items\.map\(render\)\}/);
  assert.match(ui, /sessionStorage\.getItem\(cheie\)[\s\S]*?catch \{ return null; \}/);
  assert.match(ui, /try \{ sessionStorage\.setItem[^\n]*catch/);
  assert.match(ui, /scroll-margin-top:84px/, 'navbarul lipicios nu acoperă capitolul la care duce șirul');
  assert.match(ui, /\.cc-cap-h::-webkit-details-marker\{display:none\}/);
});
