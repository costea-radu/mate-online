// Teste pentru cererea lui Radu din 1 nov. 2026 (după-amiaza):
//   „fa ca acele teste care sunt in numar mai mare, sa se salveze intr-un singur
//    PDF cu titlul «X teste (grila sau nu) diferite, pentru X elevi», fiecare test
//    sa aibe numerotat: Varianta 1, varianta 2, etc"
//
//   1) src/lib/testeSet.js — titlul setului (cu „de" de la 20 în sus, „grilă" doar
//      când toți itemii sunt grilă), setul ca un singur „exam" cu „Varianta k";
//   2) src/lib/examPrint.js — setul se tipărește ca un document: fiecare variantă
//      de la pagină nouă, cu titlul ei;
//   3) legăturile: generatoarele salvează UN SINGUR element (variantele separat,
//      ascunse, nepublicate), „Testele mele" arată doar setul, ștergerea setului
//      șterge și variantele, testul pe grupă primește variantele, nu setul;
//      PDF-urile decupate exact au „Varianta k" pe copertă / în antet.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8');
let setP = null;
const S = () => (setP || (setP = import('../src/lib/testeSet.js')));
let fiseP = null;
const F = () => (fiseP || (fiseP = import('../src/lib/fiseTeste.js')));
let printP = null;
function examPrint() {
  if (printP) return printP;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-print-set-'));
  fs.writeFileSync(path.join(dir, 'katex.mjs'), 'export const autoMath = (s) => String(s);\n');
  fs.writeFileSync(path.join(dir, 'figureRender.mjs'), 'export const renderFigure = () => null;\n');
  const src = read('src/lib/examPrint.js')
    .replace("from './katex'", "from './katex.mjs'")
    .replace("from './figureRender'", "from './figureRender.mjs'");
  fs.writeFileSync(path.join(dir, 'examPrint.mjs'), src);
  printP = import(pathToFileURL(path.join(dir, 'examPrint.mjs')).href);
  return printP;
}

const grila = (k) => ({ number: String(k), statement: `G${k}`, options: ['1', '2', '3', '4'], answer: 'b', points: 10 });
const scris = (k) => ({ number: String(k), statement: `R${k}`, answer: String(k), solution: `S${k}`, points: 10 });
const exam = (items, extra = {}) => ({ title: 'T', durationMin: 50, oficiu: 10, totalPoints: 100, subjects: [{ label: 'Test', points: 90, items }], ...extra });

// ═══════════════════════════ 1) titlul și setul ═════════════════════════════
test('titlul setului: „X teste (grilă) diferite, pentru X elevi", cu „de" de la 20 în sus', async () => {
  const L = await S();
  assert.strictEqual(L.setTitle(25, true), '25 de teste grilă diferite, pentru 25 de elevi');
  assert.strictEqual(L.setTitle(10, false), '10 teste diferite, pentru 10 elevi');
  assert.strictEqual(L.setTitle(2, true), '2 teste grilă diferite, pentru 2 elevi');
  assert.strictEqual(L.setTitle(19), '19 teste diferite, pentru 19 elevi');
  assert.strictEqual(L.setTitle(20), '20 de teste diferite, pentru 20 de elevi');
  assert.strictEqual(L.setTitle(60, true), '60 de teste grilă diferite, pentru 60 de elevi');
  assert.strictEqual(L.variantLabel(3), 'Varianta 3');
  assert.strictEqual(L.variantTitle('Test din fișe — Clasa a VII-a · Radicali', 3), 'Test din fișe — Clasa a VII-a · Radicali · Varianta 3');
});

test('„grilă" doar când toți itemii au variante de răspuns; subiectele PDF: EN I și II da, III nu, BAC nu', async () => {
  const L = await S();
  assert.strictEqual(L.examIsGrila(exam([grila(1), grila(2)])), true);
  assert.strictEqual(L.examIsGrila(exam([grila(1), scris(2)])), false);
  assert.strictEqual(L.examIsGrila(exam([])), false);
  assert.strictEqual(L.quizIsGrila([{ statement: 'a', options: ['1', '2'], answer: 0 }]), true);
  assert.strictEqual(L.quizIsGrila([{ statement: 'a', options: ['1', '2'], answer: 0 }, { statement: 'b', answer: '3' }]), false);
  assert.strictEqual(L.combinedIsGrila('evaluare-nationala', [1, 2]), true);
  assert.strictEqual(L.combinedIsGrila('evaluare-nationala', [1]), true);
  assert.strictEqual(L.combinedIsGrila('evaluare-nationala', [1, 2, 3]), false);
  assert.strictEqual(L.combinedIsGrila('bac-mate-info', [1]), false);
});

test('setul ca un singur „exam": fiecare test e „Varianta k", cu rândul pentru nume; sus — prima variantă (pentru căutare)', async () => {
  const L = await S();
  const exams = [1, 2, 3].map((k) => exam([grila(k)], { title: `Test ${k}`, subtitle: k === 2 ? 'Exerciții din fișa „X"' : undefined, workSpace: false }));
  const set = L.buildExamSet(exams, { title: '3 teste grilă diferite, pentru 3 elevi', context: 'Test din fișe — Clasa a VII-a' });
  assert.strictEqual(set.title, '3 teste grilă diferite, pentru 3 elevi');
  assert.deepStrictEqual(set.variants.map((v) => v.title), ['Varianta 1', 'Varianta 2', 'Varianta 3']);
  assert.deepStrictEqual(set.variants.map((v) => v.subtitle), ['Test din fișe — Clasa a VII-a', 'Exerciții din fișa „X"', 'Test din fișe — Clasa a VII-a']);
  assert.ok(set.variants.every((v) => v.nameLine === true));
  assert.strictEqual(set.variants[1].subjects[0].items[0].statement, 'G2');
  assert.strictEqual(set.subjects[0].items[0].statement, 'G1');
  assert.strictEqual(set.workSpace, false);
  // titlul implicit, din conținut
  assert.strictEqual(L.buildExamSet(exams).title, '3 teste grilă diferite, pentru 3 elevi');
  assert.strictEqual(L.buildExamSet([exam([scris(1)]), exam([grila(1)])]).title, '2 teste diferite, pentru 2 elevi');
  assert.strictEqual(L.setText(['a', 'b']), 'Varianta 1\na\n\nVarianta 2\nb');
  assert.deepStrictEqual(L.setInfo(['x', null, 'y'], { grila: true, kind: 'pdf' }), { count: 2, childIds: ['x', 'y'], grila: true, kind: 'pdf' });
  // testele interactive → variantele tipăribile, cu barem
  const Fz = await F();
  const q = Fz.quizToExam('Q', [{ statement: 'a', options: ['1', '2', '3', '4'], answer: 2, explanation: 'x' }], { oficiu: 10 });
  assert.strictEqual(L.buildExamSet([q, q]).variants[1].subjects[0].items[0].answer, 'c');
});

// ═══════════════════════ 2) tipărirea setului ══════════════════════════════
test('tipărirea: setul = un document, fiecare variantă de la pagină nouă, cu „Varianta k" ca titlu', async () => {
  const P = await examPrint();
  const L = await S();
  const set = L.buildExamSet([1, 2, 3].map((k) => exam([grila(k), scris(k + 10)])), { title: '3 teste diferite, pentru 3 elevi', context: 'Radicali · Clasa a VII-a' });
  const html = P.examBodyHtml(set);
  assert.strictEqual((html.match(/<section class="exam-doc">/g) || []).length, 3);
  assert.deepStrictEqual([...html.matchAll(/<h1 class="exam-title">([^<]*)<\/h1>/g)].map((m) => m[1]), ['Varianta 1', 'Varianta 2', 'Varianta 3']);
  assert.strictEqual((html.match(/Numele și prenumele/g) || []).length, 3);
  assert.match(html, /Radicali · Clasa a VII-a/);
  // baremul: aceleași variante, cu răspunsurile, fără rândul pentru nume
  const barem = P.examBodyHtml(set, { withSolutions: true });
  assert.strictEqual((barem.match(/BAREM DE CORECTARE/g) || []).length, 3);
  assert.doesNotMatch(barem, /Numele și prenumele/);
  // documentul întreg: titlul ferestrei (= numele fișierului la „Salvează ca PDF") e titlul setului
  const doc = P.examDocumentHtml(set, { embedded: false });
  assert.match(doc, /<title>3 teste diferite, pentru 3 elevi<\/title>/);
  assert.match(doc, /\.exam-doc \+ \.exam-doc \{[^}]*break-before: page/);
  // un test obișnuit arată ca înainte
  assert.doesNotMatch(P.examBodyHtml(exam([grila(1)])), /exam-doc/);
  const src = read('src/lib/examPrint.js');
  assert.match(src, /withSolutions && Array\.isArray\(exam\.variants\) && exam\.variants\.length \? `Barem · \$\{t\}` : t/);
});

// ═══════════════════════ 3) legăturile în cod ══════════════════════════════
test('generatoarele: mai multe teste → UN SINGUR element salvat (setul); variantele nepublicate, cu „Varianta k"', () => {
  const cp = read('src/components/CombinedPdfGenerator.jsx');
  // decupate exact: PDF-urile unite, setul kind 'pdf'; „Varianta k" în antet / pe copertă
  assert.match(cp, /const multe = n > 1;/);
  assert.match(cp, /mergePdfs\(await Promise\.all\(teste\.map\(async \(t\) => new Uint8Array\(await t\.blob\.arrayBuffer\(\)\)\)\)\)/);
  assert.match(cp, /aiClient\.saveTestSet\(\{\s*kind: 'pdf', title,/);
  assert.match(cp, /label: eticheta2,/);
  assert.match(cp, /right: multe \? eticheta2 : `Test combinat nr\. \$\{nrTest\}`,\s*rightBold: multe,/);
  assert.match(cp, /publish: publish && !multe,/);
  // cu numerele schimbate: setul kind 'exam'
  assert.match(cp, /aiClient\.saveTestSet\(\{\s*kind: 'exam', title, category: cfg\.category, topic, exam: examSet, grila, publish,/);
  assert.match(cp, /if \(publish && !multe\) \{/);
  const fg = read('src/components/FiseTestGenerator.jsx');
  assert.match(fg, /const multe = plan\.length > 1;/);
  assert.match(fg, /exams\.every\(examIsGrila\)/);
  assert.match(fg, /teste\.every\(\(t\) => quizIsGrila\(t\.questions\)\)/);
  assert.match(fg, /aiClient\.saveTestSet\(\{/);
  assert.match(fg, /publica: publish && !multe/);
  const vg = read('src/components/VariantGenerator.jsx');
  assert.match(vg, /if \(salvate\.length > 1\) \{/);
  assert.match(vg, /setTitle\(salvate\.length, grila\)/);
  assert.match(vg, /aiClient\.saveTestSet\(\{/);
});

test('„Testele mele" arată doar setul (cu „▸ Variantele"); ștergerea setului șterge și variantele; testul pe grupă primește variantele', () => {
  const c = read('src/lib/aiClient.js');
  const list = c.slice(c.indexOf('async listLibrary('), c.indexOf('async getLibraryItem('));
  assert.match(list, /set:payload->set/);
  assert.match(list, /\.is\('payload->>setId', null\)/);
  const save = c.slice(c.indexOf('async saveTestSet('), c.indexOf('async getLibraryItems('));
  assert.match(save, /update\(\{ payload: \{ \.\.\.c\.payload, setId: r\.privateId \} \}\)/);
  assert.match(save, /set: \{ \.\.\.set, childIds: \[\] \}/, 'copia publică fără variantele private');
  assert.match(save, /syncTitle: false/);
  const del = c.slice(c.indexOf('async deleteLibraryItem('));
  assert.match(del, /p\?\.set\?\.childIds/);
  assert.match(del, /delete\(\)\.in\('id', kids\)/);
  const pv = read('src/pages/ProfesorVirtual.jsx');
  assert.match(pv, /▸'\} Variantele \(\{set\.count\}\)/);
  assert.match(pv, /aiClient\.getLibraryItems\(set\.childIds\)/);
  assert.match(pv, /window\.confirm\(`Ștergi PDF-ul cu toate cele \$\{set\.count\} variante\?/);
  assert.match(pv, /payload: \{ \.\.\.pdfPayload, publicId: r\.id \}/, 'republicarea păstrează `set`');
  const cat = read('api/_lib/catalog.js');
  assert.match(cat, /\.in\('kind', kinds\)\.is\('payload->>set', null\)/);
});

test('PDF-urile decupate exact: „Varianta k" pe prima pagină a testului complet (casetă), îngroșat în antetul celor parțiale', () => {
  const pc = read('src/lib/pdfCombine.js');
  assert.match(pc, /export async function composeExamPdf\(prepared, plan, \{ subjects = \[1, 2, 3\], header = null, srcDocs = null, selection = null, label = null \} = \{\}\)/);
  assert.match(pc, /if \(label && !\(hdr && hdr\.png\)\) \{\s*await stampLabel\(out, out\.getPage\(0\), label\);/);
  assert.match(pc, /async function stampLabel\(doc, page, label\) \{/);
  assert.match(pc, /StandardFonts\.HelveticaBold/);
  assert.match(pc, /g\.font = rightBold \? `bold 13px \$\{SERIF\}` : `10px \$\{SERIF\}`;/);
});
