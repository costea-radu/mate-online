// =====================================================================
// test/etapa2-mathcheck.test.js — Etapa 2 (AUDIT_AGENTI_AI.md, 1.3):
//   · echivalența matematică a răspunsurilor (api/_lib/mathcheck.js) —
//     fracții/zecimale cu virgulă, LaTeX, mulțimi, unități, „x = 3";
//   · verdictul numeric (numericVerdict) folosit la corectare;
//   · oglinda din browser (BROWSER_ANS_EQ) — aceleași verdicte, iar copia
//     din src/lib/ansEq.js este IDENTICĂ (sursa unică e mathcheck.js);
//   · validarea structurală (api/_lib/validate.js): punctaje, grile, figuri
//     EN, LaTeX nerandabil reparat prin fixLatex, enunțuri duplicate.
// Rulare: npm test   (node --test test/*.test.js)
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const mc = require('../api/_lib/mathcheck.js');
const validate = require('../api/_lib/validate.js');
const med = require('../api/_lib/meditatii.js');

// ─── answersEquivalent ───────────────────────────────────────────────────────
const EQ = [
  ['1/2', '0,5'], ['0.5', '$\\frac{1}{2}$'], ['x = 3', '3'], ['x=3', 'x = 3'],
  ['2\\sqrt{3}', '2√3'], ['$2\\sqrt{3}$', '3,4641'], ['24 cm²', '24'], ['24 cm^2', '24 cm²'],
  ['{2; 3}', '{3, 2}'], ['x ∈ {1, 2}', '{2; 1}'], ['S = {1; 2}', '{1, 2}'], ['−5', '-5'],
  ['25%', '0,25'], ['25 %', '25%'], ['3/4', '75%'], ['\\frac{\\sqrt{2}}{2}', '0.7071'],
  ['a)', 'a'], ['b', 'B.'], ['ln 2', '\\ln 2'], ['2 și 3', '{2, 3}'], ['1.5', '3/2'],
  ['\\frac{1}{2} + \\frac{1}{3}', '5/6'], ['x_{1} = 2, x_{2} = 3', '{2; 3}'], ['1/3', '0,33'], ['2/3', '0,67'], ['2/3', '0,66'],
  ['$x=\\frac{3}{2}$', '1,5'], ['12 lei', '12'], ['π', '3,1416'], ['2π', '6,2832'],
  ['x^2+1', '1+x^2'], ['(x-1)^2', 'x^2-2x+1'], ['-1/(x-1)^2', '-\\frac{1}{(x-1)^2}'],
];
for (const [a, b] of EQ) {
  test(`answersEquivalent: „${a}" ≡ „${b}"`, () => {
    assert.strictEqual(mc.answersEquivalent(a, b), true, `${a} vs ${b}`);
    assert.strictEqual(mc.answersEquivalent(b, a), true, `${b} vs ${a} (simetric)`);
  });
}

const NEQ = [
  ['1/2', '0,6'], ['x = 3', '4'], ['{2; 3}', '{2; 4}'], ['{2; 3}', '{2}'], ['24 cm²', '42'],
  ['a', 'b'], ['25%', '0,52'], ['2\\sqrt{3}', '3\\sqrt{2}'], ['x^2+1', 'x^2-1'], ['7', '-7'],
  ['1/3', '0,34'], ['π', '3,1'], ['2,5', '2,49'], ['2/3', '0,65'],
];
for (const [a, b] of NEQ) {
  test(`answersEquivalent: „${a}" ≠ „${b}"`, () => {
    assert.strictEqual(mc.answersEquivalent(a, b), false, `${a} vs ${b}`);
  });
}

test('answersEquivalent: răspuns gol → null; text (cuvinte) → null, în afară de text identic → true', () => {
  assert.strictEqual(mc.answersEquivalent('', '5'), null);
  assert.strictEqual(mc.answersEquivalent(null, '5'), null);
  assert.strictEqual(mc.answersEquivalent('se demonstrează prin inducție', '5'), null);
  assert.strictEqual(mc.answersEquivalent('triunghiul este isoscel', 'triunghiul este isoscel'), true);
  assert.strictEqual(mc.answersEquivalent('triunghiul este isoscel', 'triunghiul este echilateral'), null); // nu putem decide din text
});

test('answersEquivalent: expresii prea lungi → null; funcțiile periculoase ale mathjs sunt dezactivate', () => {
  assert.strictEqual(mc.answersEquivalent('x'.repeat(400), 'x'), null);
  assert.notStrictEqual(mc.answersEquivalent('import("fs")', '1'), true);
  assert.notStrictEqual(mc.answersEquivalent('createUnit("zz")', '1'), true);
});

test('answersEquivalent: zecimale aproximative — rotunjire/trunchiere la ≥ 2 zecimale', () => {
  assert.strictEqual(mc.answersEquivalent('\\frac{\\sqrt{2}}{2}', '0,71'), true);
  assert.strictEqual(mc.answersEquivalent('\\frac{\\sqrt{2}}{2}', '0,70'), true);  // trunchiere
  assert.strictEqual(mc.answersEquivalent('\\frac{\\sqrt{2}}{2}', '0,72'), false);
  assert.strictEqual(mc.answersEquivalent('\\sqrt{2}', '1,4'), false);            // o singură zecimală: nu
  assert.strictEqual(mc.answersEquivalent('-1/3', '-0,33'), true);
  assert.strictEqual(mc.answersEquivalent('99,995', '100'), false);
});

// ─── numericVerdict (corectare: elev vs cheie) ──────────────────────────────
test('numericVerdict: ambele numerice → true/false; aproximare → null (decide modelul); altfel null', () => {
  assert.strictEqual(mc.numericVerdict('0,5', '1/2'), true);
  assert.strictEqual(mc.numericVerdict('0,6', '1/2'), false);
  assert.strictEqual(mc.numericVerdict('x = 7', '7'), true);
  assert.strictEqual(mc.numericVerdict('0,71', '\\frac{\\sqrt{2}}{2}'), null); // aproximare acceptabilă → nu forțăm „greșit"
  assert.strictEqual(mc.numericVerdict('nu știu', '7'), null);
  assert.strictEqual(mc.numericVerdict('x^2', '7'), null);
});

// ─── normalizeAnswer ─────────────────────────────────────────────────────────
test('normalizeAnswer: desface LaTeX, virgula zecimală, unitatea, mulțimile', () => {
  const n = mc.normalizeAnswer('$x = \\frac{3}{2}$ cm');
  assert.ok(n && /\(3\)\s*\/\s*\(2\)/.test(n.expr), JSON.stringify(n));
  assert.strictEqual(n.parts, null); // acoladele din \\frac NU fac din răspuns o mulțime
  const l = mc.normalizeAnswer('{1; 2,5; 3}');
  assert.deepStrictEqual(l.parts, ['1', '2.5', '3']);
  const p = mc.normalizeAnswer('25%');
  assert.strictEqual(p.percent, true);
  assert.strictEqual(mc.normalizeAnswer('\\frac{1}{2} + \\frac{1}{3}').parts, null);
});

// ─── Oglinda din browser ─────────────────────────────────────────────────────
test('BROWSER_ANS_EQ: funcția ansEq dă aceleași verdicte ca serverul pe cazurile uzuale', () => {
  // eslint-disable-next-line no-new-func
  const ansEq = new Function(mc.BROWSER_ANS_EQ + '; return ansEq;')();
  for (const [a, b] of [['1/2', '0,5'], ['x = 3', '3'], ['2√3', '2\\sqrt{3}'], ['24 cm²', '24'], ['{2; 3}', '{3, 2}'], ['a', 'A'], ['$\\frac{1}{2}$', '0.5'], ['25%', '0,25'], ['x^{2}', 'x^2'], ['2, 3', '{3; 2}'], ['3/4', '75%']]) {
    assert.strictEqual(ansEq(a, b), true, `${a} vs ${b}`);
  }
  for (const [a, b] of [['1/2', '0,6'], ['x = 3', '4'], ['{2; 3}', '{2; 4}'], ['a', 'b']]) {
    assert.strictEqual(ansEq(a, b), false, `${a} vs ${b}`);
  }
});

test('src/lib/ansEq.js: copia din browser este IDENTICĂ cu mathcheck.BROWSER_ANS_EQ', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'ansEq.js'), 'utf8');
  const m = /export const ANS_EQ_SRC = ("(?:[^"\\]|\\.)*");/.exec(src);
  assert.ok(m, 'ANS_EQ_SRC lipsește din src/lib/ansEq.js');
  assert.strictEqual(JSON.parse(m[1]), mc.BROWSER_ANS_EQ,
    'src/lib/ansEq.js a rămas în urma lui api/_lib/mathcheck.js — regenerează: node -e "const m=require(\'./api/_lib/mathcheck\');..." (vezi antetul fișierului)');
});

// ─── validateExam ────────────────────────────────────────────────────────────
function enExam() {
  const grila = (n, extra = {}) => ({ number: String(n), statement: `Enunțul ${n}: calculați $2^{${n}}$ și alegeți varianta corectă.`, options: ['1', '2', '3', '4'], answer: 'b', points: 5, ...extra });
  const S1 = { label: 'SUBIECTUL I', points: 30, items: [grila(1), grila(2), grila(3), grila(4), grila(5), { number: '6', statement: 'Numărul $\\sqrt{16}$ este natural. Adevărat sau Fals?', options: ['Adevărat', 'Fals'], answer: 'Adevărat', points: 5 }] };
  const S2 = { label: 'SUBIECTUL al II-lea', points: 30, items: [1, 2, 3, 4, 5, 6].map((n) => grila(n, { statement: `Geometrie ${n}: în triunghiul $ABC$ cu $AB = ${n + 3}$ cm, aflați perimetrul.`, figure: { type: 'triunghi', labels: ['A', 'B', 'C'] } })) };
  const prob = (n, fig) => ({ number: String(n), statement: `Problema ${n}: fie numărul $x = ${n} + \\frac{1}{2}$ și expresia $E(x)$.`, parts: [{ label: 'a', text: 'Arătați că $x > 0$.', points: 2, solution: 'evident' }, { label: 'b', text: 'Calculați $2x$.', points: 3, solution: `$2x = ${2 * n + 1}$` }], ...(fig ? { figure: { type: 'patrat', labels: ['A', 'B', 'C', 'D'] } } : {}) });
  const S3 = { label: 'SUBIECTUL al III-lea', points: 30, items: [prob(1, false), prob(2, false), prob(3, true), prob(4, true), prob(5, true), prob(6, true)] };
  return { title: 'Model EN', subjects: [S1, S2, S3] };
}

test('validateExam: un test EN corect → ok, literele normalizate, fără erori', () => {
  const r = validate.validateExam(enExam(), { examType: 'evaluare-nationala', fixLatex: med.fixLatex });
  assert.deepStrictEqual(r.errors, []);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.exam.subjects[0].items[5].answer, 'a'); // „Adevărat" → litera a
});

test('validateExam: punctaj greșit, 3 variante, răspuns fără variantă, enunț duplicat → erori', () => {
  const ex = enExam();
  ex.subjects[0].items[0].points = 10;                    // 35p în loc de 30
  ex.subjects[0].items[1].options = ['1', '2', '3'];      // 3 variante
  ex.subjects[0].items[2].answer = 'e';                   // nu există varianta e
  ex.subjects[1].items[1].statement = ex.subjects[1].items[0].statement; // duplicat
  const r = validate.validateExam(ex, { examType: 'evaluare-nationala' });
  assert.strictEqual(r.ok, false);
  assert.ok(r.errors.some((e) => /35p, nu 30p/.test(e)), r.errors.join('|'));
  assert.ok(r.errors.some((e) => /3 variante/.test(e)), r.errors.join('|'));
  assert.ok(r.errors.some((e) => /„e" nu indică/.test(e)), r.errors.join('|'));
  assert.ok(r.errors.some((e) => /duplicat/.test(e)), r.errors.join('|'));
});

test('validateExam (EN): figurile nepermise la Subiectul I / III.1 sunt eliminate; lipsa lor la II e avertisment', () => {
  const ex = enExam();
  ex.subjects[0].items[0].figure = { type: 'cerc', centru: 'O' };       // interzis la I
  ex.subjects[2].items[0].figure = { type: 'patrat', labels: ['A'] };   // interzis la III.1
  delete ex.subjects[1].items[2].figure;                                 // lipsă la II.3
  ex.subjects[1].items[3].figure = { type: 'hexagon-magic' };            // tip necunoscut
  ex.subjects[1].items[4].figure.labels = [1, 2, 3];                     // etichete ne-șiruri
  const r = validate.validateExam(ex, { examType: 'evaluare-nationala' });
  assert.strictEqual(ex.subjects[0].items[0].figure, undefined);
  assert.strictEqual(ex.subjects[2].items[0].figure, undefined);
  assert.strictEqual(ex.subjects[1].items[3].figure, undefined);
  assert.strictEqual(ex.subjects[1].items[4].figure.labels, undefined);
  assert.ok(r.errors.some((e) => /Subiectul I nu are figuri/.test(e)));
  assert.ok(r.warnings.some((w) => /II-lea · 3: lipsește figura/.test(w)), r.warnings.join('|'));
  assert.ok(r.warnings.some((w) => /necunoscut/.test(w)));
});

test('validateExam: LaTeX nerandabil → reparat prin fixLatex (fără avertisment) sau avertizat', () => {
  const ex = enExam();
  // \f din \frac a devenit caracter de control (JSON.parse) → fixLatex îl repară
  ex.subjects[0].items[0].statement = 'Calculați $\frac{1}{2} + \frac{1}{3}$.';
  // acoladă neînchisă → nu se poate repara
  ex.subjects[0].items[1].statement = 'Calculați $\\sqrt{16$.';
  const r = validate.validateExam(ex, { examType: 'evaluare-nationala', fixLatex: med.fixLatex });
  assert.ok(/\\frac\{1\}\{2\}/.test(ex.subjects[0].items[0].statement), ex.subjects[0].items[0].statement);
  assert.ok(!r.warnings.some((w) => /· 1 statement: LaTeX/.test(w)), r.warnings.join('|'));
  assert.ok(r.warnings.some((w) => /· 2 statement: LaTeX nerandabil/.test(w)), r.warnings.join('|'));
});

test('validateExam: fără subiecte → ok=false', () => {
  assert.strictEqual(validate.validateExam({ subjects: [] }).ok, false);
  assert.strictEqual(validate.validateExam(null).ok, false);
});

// ─── validateQuestions ───────────────────────────────────────────────────────
test('validateQuestions: păstrează doar întrebările valide (index corect, fără duplicate, cu răspuns)', () => {
  const qs = [
    { statement: 'Cât face $2 + 2$ în mulțimea numerelor naturale?', options: ['3', '4', '5', '6'], answer: 1, explanation: 'adunare' },
    { statement: 'Cât face $2 + 2$ în mulțimea numerelor naturale?', options: ['3', '4', '5', '6'], answer: 1 }, // duplicat
    { statement: 'Grilă cu index greșit pentru variantele date', options: ['1', '2', '3', '4'], answer: 7 },
    { statement: 'Grilă cu variante duplicate în listă', options: ['1', '1', '3', '4'], answer: 0 },
    { statement: 'Răspuns liber fără răspuns completat aici', answer: '' },
    { statement: 'Răspuns liber corect: rezolvați $x + 1 = 3$', answer: 'x = 2', explanation: 'scădem 1' },
    { statement: 'x', answer: '1' }, // enunț prea scurt
  ];
  const r = validate.validateQuestions(qs);
  assert.strictEqual(r.questions.length, 2);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.errors.length, 5);
  assert.ok(r.errors.some((e) => /duplicat/.test(e)));
  assert.ok(r.errors.some((e) => /nu indică o variantă/.test(e)));
});

test('normLetter: literă / index / textul variantei → litera; altfel null', () => {
  const opts = ['12', '1/2', 'x = 3', 'Fals'];
  assert.strictEqual(validate.normLetter('b)', opts), 'b');
  assert.strictEqual(validate.normLetter('2', opts), 'c');
  assert.strictEqual(validate.normLetter('x=3', opts), 'c');
  assert.strictEqual(validate.normLetter('Fals', opts), 'd');
  assert.strictEqual(validate.normLetter('e', opts), null);
  assert.strictEqual(validate.normLetter('99', opts), null);
});
