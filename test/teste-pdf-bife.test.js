// Teste pentru cererea lui Radu din 1 nov. 2026, la generatorul PDF al testelor
// pe grupă („👥 Test pe grupă" → 📄 PDF → „⚡ Generează acum testele"):
//   „fa sa pot alege exercitiile pe care sa le includ la fiecare subiect, prin
//    bifare. la bac, la subiectul II si III, fa sa pot bifa subpunctele a), b)
//    sau c)"
// Partea pură (selecția, punctajele, planul, recunoașterea subpunctelor pe
// rândurile de text) rulează în Node; decuparea și compunerea PDF-urilor
// (pdf.js + pdf-lib) au fost verificate în Chromium, pe subiecte sintetice.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8');
let libP = null;
const lib = () => (libP || (libP = import('../src/lib/pdfCombine.js')));

// ═════════════════════════ 1) selecția și punctajele ═════════════════════════
test('structura examenului: EN 6 · 6 · 6 fără subpuncte; BAC 6 · 2 · 2, cu a), b), c) la Subiectele II și III', async () => {
  const C = await lib();
  const en = C.examLayout('evaluare-nationala');
  const bac = C.examLayout('bac-mate-info');
  assert.deepStrictEqual(en.items, { 1: 6, 2: 6, 3: 6 });
  assert.deepStrictEqual(en.parts, {});
  assert.deepStrictEqual(bac.items, { 1: 6, 2: 2, 3: 2 });
  assert.deepStrictEqual(bac.parts, { 2: ['a', 'b', 'c'], 3: ['a', 'b', 'c'] });
  for (const t of ['bac-stiinte', 'bac-tehnologic']) assert.strictEqual(C.examLayout(t).kind, 'bac');
  // toate bifate: 90 de puncte la ambele examene
  assert.strictEqual(C.selectionPoints(C.fullSelection(en), en), 90);
  assert.strictEqual(C.selectionPoints(C.fullSelection(bac), bac), 90);
  assert.strictEqual(C.selectionComplete(C.fullSelection(bac), bac), true);
  assert.deepStrictEqual(C.fullSelection(bac, [2]).items, { 1: [], 2: [1, 2], 3: [] });
  assert.deepStrictEqual(C.fullSelection(bac, [2]).parts, { '2.1': ['a', 'b', 'c'], '2.2': ['a', 'b', 'c'] });
});

test('selecția: curățată după structură; punctajul — 5 pe exercițiu, la BAC 5 pe subpunct', async () => {
  const C = await lib();
  const en = C.examLayout('evaluare-nationala');
  const bac = C.examLayout('bac-mate-info');
  const s = C.normSelection({ items: { 1: [4, 2, 2, 9, 1], 2: ['3'], 3: [] } }, en);
  assert.deepStrictEqual(s.items, { 1: [1, 2, 4], 2: [3], 3: [] });
  assert.strictEqual(C.selectionPoints(s, en), 20);
  assert.strictEqual(C.selectionPoints(s, en, 1), 15);
  // BAC: o problemă e bifată ⇔ are cel puțin un subpunct; fără `parts` → toate trei
  const b = C.normSelection({ items: { 1: [1, 6], 2: [1, 2], 3: [2] }, parts: { '2.1': ['c', 'a', 'x'], '2.2': [], '3.2': ['b'] } }, bac);
  assert.deepStrictEqual(b.items, { 1: [1, 6], 2: [1], 3: [2] });
  assert.deepStrictEqual(b.parts, { '2.1': ['a', 'c'], '3.2': ['b'] });
  assert.strictEqual(C.selectionPoints(b, bac), 10 + 10 + 5);
  assert.deepStrictEqual(C.normSelection({ items: { 2: [2] } }, bac).parts, { '2.2': ['a', 'b', 'c'] });
  assert.strictEqual(C.subjectComplete(b, bac, 1), false);
  assert.strictEqual(C.selectionComplete(b, bac), false);
  assert.deepStrictEqual(C.selectionSubjects(b), [1, 2, 3]);
  assert.deepStrictEqual(C.selectionSubjects({ items: { 1: [], 2: [], 3: [] } }), []);
});

test('alegerile rapide corespund bifelor; rezumatul și „N (de) puncte"', async () => {
  const C = await lib();
  const en = C.examLayout('evaluare-nationala');
  const bac = C.examLayout('bac-mate-info');
  assert.strictEqual(C.presetOf(C.fullSelection(en), en), 'toate');
  assert.strictEqual(C.presetOf(C.fullSelection(en, [1, 2]), en), 's12');
  assert.strictEqual(C.presetOf(C.fullSelection(bac, [3]), bac), 's3');
  assert.strictEqual(C.presetOf(C.fullSelection(en, [2, 3]), en), null, 'II + III nu e o alegere rapidă');
  assert.strictEqual(C.presetOf({ items: { 1: [1, 2, 3, 4, 5] } }, en), null, 'un exercițiu lipsă → selecție proprie');
  assert.strictEqual(C.presetOf({ items: { 2: [1, 2] }, parts: { '2.1': ['a', 'b'] } }, bac), null, 'un subpunct lipsă → selecție proprie');
  assert.strictEqual(
    C.selectionSummary({ items: { 1: [1, 2, 4], 2: [1, 2], 3: [1, 2] }, parts: { '2.1': ['a', 'c'], '3.1': ['a', 'b', 'c'], '3.2': ['a', 'b', 'c'] } }, bac),
    'Subiectul I: 1, 2, 4 · Subiectul al II-lea: 1 a), c); 2 · Subiectul al III-lea: toate',
  );
  assert.strictEqual(C.selectionSummary({ items: { 3: [2, 5] } }, en), 'Subiectul al III-lea: 2, 5');
  assert.deepStrictEqual([5, 15, 20, 25, 30, 60, 90, 100, 101, 120, 1].map(C.pointsLabel),
    ['5 puncte', '15 puncte', '20 de puncte', '25 de puncte', '30 de puncte', '60 de puncte', '90 de puncte', '100 de puncte', '101 puncte', '120 de puncte', '1 punct']);
});

// ═════════════════════════ 2) planul, cu bifele ═════════════════════════════
// o sursă BAC „analizată"; `parti: false` = subpunctele nu s-au putut separa
function bac(label, { parti = true } = {}) {
  const ch = (p, top, bottom) => [{ p, top, bottom }];
  const regions = { S1: ch(1, 700, 690), S2: ch(1, 520, 510), S3: ch(2, 790, 780) };
  for (let i = 1; i <= 6; i++) regions[`1.${i}`] = ch(1, 690 - 20 * i, 670 - 20 * i);
  for (const k of ['2.1', '2.2', '3.1', '3.2']) regions[k] = ch(k[0] === '2' ? 1 : 2, 500, 400);
  const parts = {};
  if (parti) for (const k of ['2.1', '2.2', '3.1', '3.2']) parts[k] = { letters: ['a', 'b', 'c'], stem: ch(1, 500, 480), a: ch(1, 480, 460), b: ch(1, 460, 440), c: ch(1, 440, 400) };
  return { regions, parts, counts: { 1: 6, 2: 2, 3: 2 }, signature: '6-2-2', label };
}

test('planCombinations cu bife: doar pozițiile bifate; subpunctele parțiale doar din surse cu subpunctele separate', async () => {
  const C = await lib();
  const surse = [bac('A'), bac('B', { parti: false }), bac('C'), bac('D', { parti: false }), bac('E')];
  const sel = { items: { 1: [2, 5], 2: [1], 3: [] }, parts: { '2.1': ['a', 'c'] } };
  const planuri = C.planCombinations(surse, { count: 12, selection: sel, seed: 4 });
  for (const p of planuri) {
    assert.deepStrictEqual(Object.keys(p.picks).sort(), ['1.2', '1.5', '2.1']);
    assert.ok(['A', 'C', 'E'].includes(surse[p.picks['2.1']].label), 'problema cu a) și c) vine dintr-o sursă cu subpunctele separate');
    assert.deepStrictEqual(p.whole, {});
  }
  // problema întreagă (toate trei subpunctele) poate veni din orice sursă
  const tot = C.planCombinations(surse, { count: 10, selection: { items: { 2: [1] }, parts: { '2.1': ['a', 'b', 'c'] } }, seed: 2 });
  assert.ok(new Set(tot.map((p) => p.picks['2.1'])).size === 5);
  // combinațiile: 5 × 5 la Subiectul I, 3 la problema cu subpuncte parțiale
  assert.strictEqual(C.maxDistinctTests(surse, null, sel), 75);
  // nicio sursă cu subpunctele separate → problema întreagă, semnalată
  const fara = [bac('X', { parti: false }), bac('Y', { parti: false })];
  const [p] = C.planCombinations(fara, { count: 1, selection: sel, seed: 1 });
  assert.deepStrictEqual(p.whole, { '2.1': true });
  assert.ok(p.picks['2.1'] === 0 || p.picks['2.1'] === 1);
  // nimic bifat → eroare clară
  assert.throws(() => C.planCombinations(surse, { selection: { items: { 1: [], 2: [], 3: [] } } }), /Bifează cel puțin un exercițiu/);
  // fără selecție: exact ca înainte (aceeași sămânță → același plan, toate pozițiile)
  const vechi = C.planCombinations(surse, { count: 3, seed: 8 });
  assert.strictEqual(Object.keys(vechi[0].picks).length, 10);
  assert.deepStrictEqual(vechi, C.planCombinations(surse, { count: 3, seed: 8, selection: null }));
});

// ═════════════════════════ 3) subpunctele, pe rândurile de text ═════════════
// Pagini sintetice în coordonatele pdf.js (y în sus): un subiect de BAC cu
// rânduri la 14pt (subpunctele unei probleme sunt rânduri consecutive), problema
// III.2 trece pe pagina 3 (a) jos pe pagina 2, b) și c) sus pe pagina 3).
function bacPages() {
  const L = (y, text, x = 45) => ({ y, x, text });
  const p1 = [L(760, 'Proba E. c)', 260), L(700, 'SUBIECTUL I (30 de puncte)')];
  for (let i = 1; i <= 6; i++) p1.push(L(700 - 24 * i, `5p ${i}. Arătați că ${i} + ${i} = ${2 * i}.`));
  p1.push(L(520, 'SUBIECTUL al II-lea (30 de puncte)'));
  p1.push(L(496, '1. Se consideră matricea A(x).'), L(482, '5p a) Arătați că det A(0) = 1.'), L(468, '5p b) Calculați A(1)·A(2).'), L(454, '5p c) Determinați x.'));
  p1.push(L(420, '2. Pe R se definește legea x ∘ y = xy − 2x.'), L(406, '5p a) Arătați că 1 ∘ 2 = −2.'), L(392, '5p b) Rezolvați ecuația.'), L(378, '5p c) Determinați elementul neutru.'));
  const p2 = [L(790, 'SUBIECTUL al III-lea (30 de puncte)'), L(766, '1. Se consideră funcția f.'), L(752, '5p a) Arătați că f(0) = 1.'),
    L(738, '5p b) Calculați limita.'), L(724, '5p c) Demonstrați inegalitatea.'), L(60, '2. Se consideră funcția g.'), L(46, '5p a) Arătați că g(1) = 0.')];
  const p3 = [L(800, '5p b) Calculați integrala.'), L(786, '5p c) Determinați aria.')];
  return { n: 3, contentMaxY: { 1: 812, 2: 812, 3: 812 }, contentMinY: { 1: 34, 2: 34, 3: 34 }, pageLines: { 1: p1, 2: p2, 3: p3 } };
}
const inaltime = (chunks) => chunks.reduce((s, c) => s + (c.top - c.bottom), 0);

test('analiza: subpunctele a), b), c) ale problemelor de BAC, și peste pagină; segmentele acoperă exact problema', async () => {
  const C = await lib();
  const st = C._pentruTeste.structureFrom(bacPages(), 1);
  assert.deepStrictEqual(st.counts, { 1: 6, 2: 2, 3: 2 });
  assert.deepStrictEqual(Object.keys(st.parts).sort(), ['2.1', '2.2', '3.1', '3.2']);
  for (const [key, P] of Object.entries(st.parts)) {
    assert.deepStrictEqual(P.letters, ['a', 'b', 'c'], key);
    // nimic pierdut, nimic dublat: enunț + a) + b) + c) = regiunea problemei
    assert.ok(Math.abs(inaltime([...P.stem, ...P.a, ...P.b, ...P.c]) - inaltime(st.regions[key])) < 1e-9, key);
  }
  // tăieturile cad între rânduri: enunțul are rândul „1.", a) are rândul lui „a)" etc.
  const P = st.parts['2.1'];
  const intre = (chunks, y) => chunks.some((c) => c.p === 1 && y < c.top && y > c.bottom);
  assert.ok(intre(P.stem, 496) && !intre(P.stem, 482));
  assert.ok(intre(P.a, 482) && !intre(P.a, 468) && !intre(P.a, 496));
  assert.ok(intre(P.b, 468) && !intre(P.b, 454));
  assert.ok(intre(P.c, 454));
  // III.2: a) jos pe pagina 2, b) și c) pe pagina 3
  const Q = st.parts['3.2'];
  assert.deepStrictEqual(Q.stem.map((c) => c.p), [2]);
  assert.deepStrictEqual(Q.a.map((c) => c.p), [2]);
  assert.deepStrictEqual(Q.b.map((c) => c.p), [3]);
  assert.deepStrictEqual(Q.c.map((c) => c.p), [3]);
  assert.ok(Q.b[0].top >= 800 && Q.b[0].bottom < 800 && Q.b[0].bottom > 786);
});

test('analiza: la EN nu se caută subpuncte (rândul variantelor grilei începe tot cu „a)"); un subpunct lipsă → problema rămâne întreagă', async () => {
  const C = await lib();
  const L = (y, text, x = 45) => ({ y, x, text });
  const pag = (s, start) => {
    const out = [L(start, `SUBIECTUL ${s === 1 ? 'I' : s === 2 ? 'al II-lea' : 'al III-lea'} (30 de puncte)`)];
    for (let i = 1; i <= 6; i++) {
      out.push(L(start - 60 * i, `5p ${i}. Enunțul ${s}.${i}.`));
      out.push(L(start - 60 * i - 14, s < 3 ? 'a) 2 b) 3 c) 4 d) 5' : '(2p) a) Arată că x > 0.'));
      out.push(L(start - 60 * i - 28, s < 3 ? '' : '(3p) b) Calculează x.'));
    }
    return out.filter((x) => x.text);
  };
  const en = { n: 4, contentMaxY: { 1: 812, 2: 812, 3: 812, 4: 812 }, contentMinY: { 1: 34, 2: 34, 3: 34, 4: 34 }, pageLines: { 1: [L(500, 'Copertă')], 2: pag(1, 780), 3: pag(2, 780), 4: pag(3, 780) } };
  const st = C._pentruTeste.structureFrom(en, 2);
  assert.deepStrictEqual(st.counts, { 1: 6, 2: 6, 3: 6 });
  assert.deepStrictEqual(st.parts, {});
  // BAC cu c) negăsit la II.2 → doar II.2 rămâne fără subpuncte (se ia întreagă)
  const pg = bacPages();
  pg.pageLines[1] = pg.pageLines[1].filter((x) => x.text !== '5p c) Determinați elementul neutru.');
  const st2 = C._pentruTeste.structureFrom(pg, 1);
  assert.ok(!st2.parts['2.2']);
  assert.ok(st2.parts['2.1'] && st2.parts['3.1'] && st2.parts['3.2']);
});

test('splitRegion: tăieturi pe aceeași pagină, pe pagina următoare și chiar pe marginea de sus a unei bucăți', async () => {
  const C = await lib();
  const chunks = [{ p: 2, top: 100, bottom: 34, toEnd: true }, { p: 3, top: 812, bottom: 700 }];
  const segs = C.splitRegion(chunks, [{ p: 2, y: 55 }, { p: 3, y: 812 }, { p: 3, y: 790 }]);
  assert.deepStrictEqual(segs, [
    [{ p: 2, top: 100, bottom: 55 }],
    [{ p: 2, top: 55, bottom: 34, toEnd: true }],
    [{ p: 3, top: 812, bottom: 790 }],
    [{ p: 3, top: 790, bottom: 700 }],
  ]);
  assert.deepStrictEqual(C.splitRegion(chunks, []), [chunks.map((c) => ({ ...c }))]);
});

// ═════════════════════════ 4) motorul și interfața ══════════════════════════
test('motorul: doar ce e bifat; enunțul + subpunctele bifate; titlul subiectului cu punctajul bifat; coperta doar la testul întreg', async () => {
  const src = read('src/lib/pdfCombine.js');
  assert.match(src, /const full = subj\.length === 3 && !subj\.some\(partialSubject\);/);
  assert.match(src, /items\.push\(\{ src: srcI, chunks: P\.stem, keep: true, gap: 0 \}\);/);
  assert.match(src, /ls\.forEach\(\(l, i\) => items\.push\(\{ src: srcI, chunks: P\[l\], gap: i < ls\.length - 1 \? 0 : GAP \+ 6 \}\)\);/);
  assert.match(src, /const title = `\$\{s === 1 \? 'SUBIECTUL I' : `SUBIECTUL al \$\{ROMAN\[s\]\}-lea`\} \(\$\{pointsLabel\(pts\)\}\)`;/);
  assert.match(src, /img: await makeSubjectTitlePng\(\{ title, lines: rest\.map\(\(x\) => x\.t\), size: size\(head && head\.h\), lineSize: size\(rest\[0\] && rest\[0\]\.h\) \}, \{ widthPt: W - hx - 30 \}\),\s*head: true,/);
  assert.match(src, /\(problema întreagă: subpunctele nu s-au putut separa\)/);
  // harta cernelii e de 2× mai fină la BAC (albul dintre rânduri)
  assert.match(src, /const ink = await inkRows\(doc, pages, \(st\.counts\[2\] \|\| 0\) <= 3 \? 2 : 1\);/);
});

test('generatorul: bifele pe exerciții și subpuncte, alegerile rapide, butonul oprit fără nimic bifat', async () => {
  const g = read('src/components/CombinedPdfGenerator.jsx');
  assert.match(g, /function BifeExercitii\(\{ layout, sel, onChange, disabled \}\)/);
  assert.match(g, /<BifeExercitii layout=\{layout\} sel=\{sel\} onChange=\{setSel\} disabled=\{!!busy\} \/>/);
  assert.match(g, /aria-label=\{`\$\{subjectName\(s\)\}, problema \$\{it\}, subpunctul \$\{l\}\)`\}/);
  assert.match(g, /aria-label=\{`\$\{subjectName\(s\)\}, exercițiul \$\{it\}`\}/);
  assert.match(g, /onClick=\{\(\) => setSel\(fullSelection\(layout, c\.subjects\)\)\} aria-pressed=\{preset === c\.id\}/);
  assert.match(g, /disabled=\{!!busy \|\| !subjects\.length\}/);
  assert.match(g, /composeExamPdf\(prep, plan, \{\s*subjects, srcDocs: docs, selection: selectie,/);
  assert.match(g, /maxDistinctTests\(prep\.list, subjects, selectie\)/);
  assert.match(g, /combined: \{ exam: examType, subjects, nr: nrTest, report: r\.report, points: r\.points, \.\.\.\(complet \? \{\} : \{ selection: selectie \}\) \}/);
  // alt examen → altă structură: subiectele bifate rămân, întregi
  assert.match(g, /useEffect\(\(\) => \{\s*setSel\(\(cur\) => \{\s*const subj = selectionSubjects\(cur\);\s*return fullSelection\(examLayout\(examType\), subj\.length \? subj : \[1, 2, 3\]\);/);
});
