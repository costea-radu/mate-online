// =====================================================================
// test/teste-diferite-barem.test.js — cererea din 4 noiembrie 2026:
//   „la generatorul de exerciții și teste, la «teste diferite/elev», la opțiunea
//    «schimbă numerele și notațiile» pune buton: cu barem sau fără barem.
//    «Cu barem» se face cu AI, de aceea fă ca să se aranjeze în pagină mai bine"
//
//   1) „📝 Cu barem" / „📄 Fără barem" (src/components/TesteDiferite.jsx) —
//      fără barem: AI-ul nu scrie rezolvările (api/ai-exam.js, prompt + stripSolutions;
//      api/ai-generate-interactive.js), testul are noBarem și nu primește
//      butonul „📝 Barem";
//   2) așezarea în pagină (src/lib/examPrint.js): variantele scurte ale grilelor
//      pe un rând (4 / 2 coloane), cerințele cu caroiajul lor nedespărțite,
//      baremul ca baremele oficiale (tabel la grile, subpuncte cu punctaj).
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8');
let printP = null;
function examPrint() {
  if (printP) return printP;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-print-barem-'));
  fs.writeFileSync(path.join(dir, 'katex.mjs'), 'export const autoMath = (s) => String(s);\n');
  fs.writeFileSync(path.join(dir, 'figureRender.mjs'), 'export const renderFigure = () => null;\n');
  const src = read('src/lib/examPrint.js')
    .replace("from './katex'", "from './katex.mjs'")
    .replace("from './figureRender'", "from './figureRender.mjs'");
  fs.writeFileSync(path.join(dir, 'examPrint.mjs'), src);
  printP = import(pathToFileURL(path.join(dir, 'examPrint.mjs')).href);
  return printP;
}

const EXAM = {
  title: 'Test EN · numerele schimbate', oficiu: 10, durationMin: 120, totalPoints: 100,
  subjects: [
    { label: 'SUBIECTUL I', points: 30, items: [
      { number: '1', statement: 'Rezultatul calculului $12 - 2 \\cdot 5$ este:', options: ['2', '50', '10', '-2'], answer: 'a', points: 5, solution: '$2 \\cdot 5 = 10$, $12 - 10 = 2$' },
      { number: '2', statement: 'Media aritmetică a numerelor 4 și 10 este:', options: ['7', '14', '6', '5'], answer: 'a', points: 5, solution: '(4 + 10) : 2 = 7' },
    ] },
    { label: 'SUBIECTUL al II-lea', points: 30, items: [
      { number: '1', statement: 'Alegeți afirmația adevărată despre triunghiul echilateral cu latura de 6 cm:', options: ['Perimetrul triunghiului este egal cu 18 cm', 'Aria triunghiului este egală cu 36 cm²'], answer: 'a', points: 5 },
    ] },
    { label: 'SUBIECTUL al III-lea', points: 30, items: [
      { number: '1', statement: 'Un biciclist parcurge un traseu în trei zile.', parts: [
        { label: 'a', text: 'Verificați dacă traseul are 60 km.', points: 2, solution: '20 + 25 + 15 = 60' },
        { label: 'b', text: 'Aflați ce procent din traseu a parcurs în prima zi.', points: 3, solution: '20/60 = 33,(3)%' },
      ] },
    ] },
  ],
};

test('variantele grilelor: 4 coloane (scurte), 2 (medii) sau una sub alta (lungi)', async () => {
  const { optCols, plainLen } = await examPrint();
  assert.strictEqual(plainLen('$\\frac{3}{5}$'), 3);
  assert.strictEqual(plainLen('  12  cm  '), 5);
  assert.strictEqual(optCols(['2', '50', '10', '-2']), 4);
  assert.strictEqual(optCols(['$\\frac{3}{5}$', '$\\sqrt{2}$', '0,(3)', '1']), 4);
  assert.strictEqual(optCols(['Perimetrul este 18 cm', 'Aria este 36 cm²', 'Înălțimea e 3 cm', 'Nicio variantă']), 2);
  assert.strictEqual(optCols(['Perimetrul triunghiului este egal cu 18 cm', 'Aria triunghiului este egală cu 36 cm²', 'x', 'y']), 1);
  assert.strictEqual(optCols(['Adevărat', 'Fals']), 2);
  assert.strictEqual(optCols([]), 1);
  assert.strictEqual(optCols(null), 1);
});

test('testul: grilele scurte pe un rând, cerințele problemelor fiecare cu caroiajul ei (.wblock)', async () => {
  const { examBodyHtml } = await examPrint();
  const html = examBodyHtml(EXAM);
  assert.strictEqual((html.match(/<div class="opts cols-4">/g) || []).length, 2, 'cele două grile scurte: câte 4 variante pe rând');
  // afirmațiile lungi (Subiectul al II-lea) → una sub alta
  assert.match(html, /<div class="opts"><div class="opt"><b>a\)<\/b> Perimetrul triunghiului este egal cu 18 cm<\/div>/);
  // Subiectul al III-lea: fiecare cerință e un bloc nedespărțit (enunțul stă cu prima cerință)
  const blocks = html.match(/<div class="wblock">/g) || [];
  assert.strictEqual(blocks.length, 2);
  assert.match(html, /<div class="wblock"><span class="stmt">Un biciclist parcurge un traseu în trei zile\.<\/span><div class="part"><b>\(2p\) a\)<\/b>/);
  // punctajul problemei = suma subpunctelor (problema nu are „points")
  assert.match(html, /<div class="pts">5p<\/div>/);
});

test('baremul: tabel la grile (răspuns · punctaj · justificare), subpuncte cu punctaj și rezolvare', async () => {
  const { examBodyHtml } = await examPrint();
  const html = examBodyHtml(EXAM, { withSolutions: true });
  assert.match(html, /BAREM DE CORECTARE/);
  assert.match(html, /<table class="bt"><thead><tr><th>Nr\.<\/th><th>Răspuns corect<\/th><th>Punctaj<\/th><th>Justificare<\/th><\/tr><\/thead>/);
  assert.match(html, /<td class="r"><b>a\)<\/b> 2<\/td><td class="p">5p<\/td>/);
  // Subiectul al II-lea fără justificări → tabel fără coloana „Justificare"
  assert.match(html, /<table class="bt"><thead><tr><th>Nr\.<\/th><th>Răspuns corect<\/th><th>Punctaj<\/th><\/tr><\/thead>/);
  // problema: subpunctele cu punctajul și rezolvarea
  assert.match(html, /<div class="bpart"><b>a\)<\/b> <span class="pts">\(2p\)<\/span> Verificați dacă traseul are 60 km\.<div class="sol">20 \+ 25 \+ 15 = 60<\/div><\/div>/);
  // la tipărire: titlul subiectului rămâne lângă primul exercițiu, rândurile tabelului nu se rup
  const { printDocumentHtml } = await examPrint();
  const doc = printDocumentHtml('t', html);
  assert.match(doc, /\.subject-head, \.subject-instr \{ break-after: avoid;/);
  assert.match(doc, /\.bt tr \{ break-inside: avoid; \}/);
  assert.match(doc, /\.solrow, \.solspace, \.fig, \.part, \.wblock \{ break-inside: avoid; \}/);
});

test('„📄 Fără barem": rezolvările dispar, răspunsurile scurte rămân, testul e marcat noBarem', async () => {
  const { examFaraBarem } = await import('../src/lib/fiseTeste.js');
  const fara = examFaraBarem(EXAM);
  assert.strictEqual(fara.noBarem, true);
  const items = fara.subjects.flatMap((s) => s.items);
  assert.ok(items.every((it) => !('solution' in it)));
  assert.ok(items.flatMap((it) => it.parts || []).every((p) => !('solution' in p)));
  assert.strictEqual(fara.subjects[0].items[0].answer, 'a', 'litera grilei rămâne');
  assert.ok(EXAM.subjects[0].items[0].solution, 'testul original nu e modificat');
  assert.strictEqual(examFaraBarem(null), null);
  const { examNoBarem } = await examPrint();
  assert.strictEqual(examNoBarem(fara), true);
  assert.strictEqual(examNoBarem(EXAM), false);
  // setul de variante e „fără barem" doar dacă toate variantele sunt
  const { buildExamSet } = await import('../src/lib/testeSet.js');
  assert.strictEqual(buildExamSet([fara, fara]).noBarem, true);
  assert.strictEqual(buildExamSet([fara, EXAM]).noBarem, undefined);
});

test('serverul: „barem: false" → promptul cere fără rezolvări, iar rezolvările rămase sunt scoase', () => {
  const ai = require('../api/ai-exam.js');
  const ex = JSON.parse(JSON.stringify(EXAM));
  ai.stripSolutions(ex);
  assert.strictEqual(ex.noBarem, true);
  assert.ok(ex.subjects.flatMap((s) => s.items).every((it) => !it.solution));
  assert.ok(ex.subjects[2].items[0].parts.every((p) => !p.solution && p.text));
  const src = read('api/ai-exam.js');
  assert.match(src, /const faraBarem = req\.body\?\.barem === false;/);
  assert.match(src, /FĂRĂ BAREM \(cerut de profesor\)/);
  assert.match(src, /if \(faraBarem\) stripSolutions\(exam\);/);
  const gi = read('api/ai-generate-interactive.js');
  assert.match(gi, /const faraBarem = req\.body\?\.barem === false;/);
  assert.match(gi, /if \(faraBarem\) questions = questions\.map\(\(q\) => \(\{ \.\.\.q, explanation: '' \}\)\);/);
  const c = read('src/lib/aiClient.js');
  assert.match(c, /generateExam: \(\{ examType, instructions = '', dataMode = 'modify', chapters = \[\], barem = true \}\)/);
  assert.match(c, /\.\.\.\(barem === false \? \{ barem: false \} : \{\}\)/);
});

test('„👥 Teste diferite / elev" → „🔢 Schimbă numerele": alegerea „📝 Cu barem" / „📄 Fără barem"', () => {
  const t = read('src/components/TesteDiferite.jsx');
  assert.match(t, /role="radiogroup" aria-label="Baremul testelor cu numerele schimbate"/);
  assert.match(t, /<strong>Cu barem<\/strong>/);
  assert.match(t, /<strong>Fără barem<\/strong>/);
  assert.match(t, /const \[barem, setBarem\] = useState\(\(\) => init\.barem !== false\);/);
  assert.match(t, /barem=\{barem\}/);
  const g = read('src/components/CombinedPdfGenerator.jsx');
  assert.match(g, /aiClient\.generateExam\(\{ examType, dataMode: 'modify', instructions: '', chapters: \[\], barem \}\)/);
  assert.match(g, /barem \? ex0f : examFaraBarem\(ex0f\)/);
  const f = read('src/components/FiseTestGenerator.jsx');
  assert.match(f, /const faraBarem = !barem && dataMode === 'modify' && output === 'pdf';/);
  // fără barem → fără butonul „📝 Barem"
  const l = read('src/components/ListaTesteExam.jsx');
  assert.match(l, /export const areBarem = \(ex\) => !ex\?\.noBarem &&/);
  const pv = read('src/pages/ProfesorVirtual.jsx');
  assert.match(pv, /\.nb/);
});
