// =====================================================================
// test/semn-raspunsuri.test.js — RĂSPUNSURILE DESPRE SEMN la întrebările
// lui Prof. Tudor („Care este semnul derivatei f'(x) = (x − 1)/x pentru x ∈ (0, 1)?")
//
// Baremul spune „f'(x) < 0"; elevul poate scrie „−", „minus", „negativ(ă)",
// „< 0", „mai mic decât 0", „derivata e negativă", „f′(x) < 0" — toate primite.
// La fel „+", „plus", „pozitiv(ă)", „> 0" pentru „f'(x) > 0". NU sunt primite:
// semnul opus, alt obiect („f(x) < 0", „x − 1 < 0"), numerele („−2", „−∞"),
// „+ și −", negația („nu e negativ"). Verificăm modulul (api/_lib/semn.js),
// oglinda din browser (src/lib/semn.js — identică), meditațiile live și
// pregătirea de examen (checkPollAnswer), tabla din „Planul meu" (tabla.js →
// checkAnswer) și corectarea exercițiilor din „Planul meu" (gradeAnswers).
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const S = require('../api/_lib/semn');
const L = require('../api/_lib/live');
const mathcheck = require('../api/_lib/mathcheck');

const NEG = "f'(x) < 0";
const POS = "f'(x) > 0";

// spun toate „negativ" → primite pentru f'(x) < 0
const MINUS = [
  '-', '−', '–', ' - ', '-.', '(-)', '[-]', '--', '- - -',
  'minus', 'Minus', 'MINUS', 'negativ', 'Negativă', 'negativa', 'negativǎ', 'negative', 'negativi', 'neg', 'strict negativă',
  'e negativă', 'Este negativă.', 'este -', 'e minus', 'semnul -', 'semnul minus', 'semnul este -', 'semn negativ',
  'are semnul minus', 'are semn negativ', 'derivata e negativă', 'Derivata este negativă', 'semnul derivatei este negativ',
  'raportul este negativ', "f'(x) e negativă", "f' este negativ", "f'(x) negativ", "f'(x) ia valori negative",
  "f′(x) e negativă", "f’(x) < 0", "f'(x)<0", "F'(x) < 0", "f'<0", "f ' (x) < 0", '<0', '< 0', '<0.', "0 > f'(x)",
  "f'(x) = -", "f'(x)=-", "f'(x): -", 'mai mic decât 0', 'mai mică decât zero', 'mai mic ca 0', 'e mai mică decât 0', 'sub 0',
  'negativ pe (0,1)', 'negativă pe intervalul (0, 1)', "f'(x) < 0 pe (0,1)", "f'(x) < 0 pentru x ∈ (0,1)", "f'(x) < 0, ∀x∈(0,1)",
  'pe (0,1) e negativă', 'negativ pe R', 'negativ (-)', '- (negativ)', "f'(x) < 0 (negativ)", 'negativ, adică -', "-, f'(x)<0",
  'minus, deci f e descrescătoare', "f'(x)<0 => f descrescătoare", "f'(x) < 0 ⇒ f ↘", 'negativ deoarece x-1<0 și x>0', 'deci -',
  "f'(x) = (x-1)/x < 0", "f'(x)=\\frac{x-1}{x}<0", "$f'(x)<0$", "f'(x) \\lt 0", "f^{\\prime}(x) < 0",
];
// spun toate „pozitiv" → primite pentru f'(x) > 0
const PLUS = ['+', '＋', '(+)', '++', 'plus', 'Plus', 'pozitiv', 'Pozitivă', 'pozitive', 'strict pozitivă', 'e pozitivă', 'semnul +',
  '>0', '> 0', "f'(x) > 0", "f'(x)>0", "0 < f'(x)", 'mai mare decât 0', 'mai mari decât zero', "f'(x) = +", 'pozitiv pe (1, ∞)'];
// nu spun (doar) „negativ" despre f'(x) → NU sunt primite pentru f'(x) < 0
const NOT_NEG = [
  '', ' ', '0', 'zero', '-1', '-2', '- 1', '-∞', '-\\infty', 'minus infinit', 'minus 1', '1', '?', 'nu știu',
  'nu e negativ', 'nu e pozitiv', '+ și -', '- și +', '-, +', '+ -', '- +', 'pozitiv sau negativ', 'negativ apoi pozitiv',
  "f(x) < 0", "f(x) e negativă", 'x < 0', 'x - 1 < 0', '1 - x < 0', "-f'(x) < 0", 'x - 1 e negativ', 'numărătorul e negativ',
  '2 -', 'x -', "f'(x)-", "f'(x) ≠ 0", '≠0', "f'(x) ≮ 0", '0<x<1', 'x<1', '(x-1)/x', "f'(x)", "f'(x) ≥ 0", "f'(x) ≤ 0",
  "f'(x) = 0", 'nenegativ', 'pozitiv sau zero',
  ...PLUS,
];

test('semn: „−", „minus", „negativ", „< 0", „derivata e negativă"… sunt primite pentru „f\'(x) < 0"', () => {
  for (const a of MINUS) assert.strictEqual(S.signEquivalent(a, NEG), true, `„${a}"`);
  // baremul scris în alte feluri (LaTeX, cu intervalul, cu cuvântul)
  for (const e of ["f'(x)<0", "$f'(x) < 0$", "f^{\\prime}(x) \\lt 0", "f'(x) < 0 pe (0, 1)", "f'(x)<0, \\forall x \\in (0,1)",
    '\\text{negativ}', 'negativă', '-', "negativ (f'(x) < 0)", "negativ, adică f'(x) < 0"]) {
    for (const a of ['-', 'minus', 'negativ', '<0', "f'(x) < 0"]) assert.strictEqual(S.signEquivalent(a, e), true, `„${a}" la „${e}"`);
  }
});

test('semn: „+", „plus", „pozitiv", „> 0"… sunt primite pentru „f\'(x) > 0"; semnul opus e greșit', () => {
  for (const a of PLUS) assert.strictEqual(S.signEquivalent(a, POS), true, `„${a}"`);
  for (const a of ['-', 'minus', 'negativ', '<0', "f'(x) < 0", '- - -']) assert.strictEqual(S.signEquivalent(a, POS), false, `„${a}" la „${POS}"`);
  for (const a of ['+', 'plus', 'pozitiv', '>0', "f'(x) > 0"]) assert.strictEqual(S.signEquivalent(a, NEG), false, `„${a}" la „${NEG}"`);
});

test('semn: NU sunt primite numerele, alt obiect, mai multe semne, negația, „≤ 0" la „< 0"', () => {
  for (const a of NOT_NEG) assert.notStrictEqual(S.signEquivalent(a, NEG), true, `„${a}"`);
  // alt obiect → null: decide restul verificării (care îl găsește greșit)
  assert.strictEqual(S.signEquivalent('f(x) < 0', NEG), null);
  assert.strictEqual(S.signEquivalent('a < 0', '\\Delta < 0'), null);
});

test('semn: baremul cu „≥ 0" / „≤ 0", Δ, alte expresii; răspunsurile care nu sunt despre semn rămân neatinse', () => {
  const GE = "f'(x) \\geq 0", LE = "f'(x) \\le 0";
  for (const a of ['+', 'pozitiv', "f'(x) ≥ 0", "f'(x)>=0", 'nenegativă', 'pozitivă sau zero', 'mai mare sau egal cu 0']) assert.strictEqual(S.signEquivalent(a, GE), true, a);
  assert.strictEqual(S.signEquivalent('-', GE), false);
  for (const a of ['-', 'negativ sau nul', "f'(x) =< 0", "f'(x) ≤ 0"]) assert.strictEqual(S.signEquivalent(a, LE), true, a);
  for (const a of ['negativ', 'Δ<0', 'delta < 0', '∆ < 0', 'delta e negativ', '-']) assert.strictEqual(S.signEquivalent(a, '\\Delta < 0'), true, a);
  for (const a of ['-', 'x-1<0', 'x - 1 e negativ']) assert.strictEqual(S.signEquivalent(a, 'x - 1 < 0'), true, a);
  assert.strictEqual(S.signEquivalent('x+1<0', 'x - 1 < 0'), null);
  assert.strictEqual(S.signEquivalent('a pozitiv', 'a > 0'), true);
  // concluzia în barem → întrebarea e despre monotonie, nu despre semn
  assert.strictEqual(S.signEquivalent('-', "f'(x) < 0 \\Rightarrow f \\searrow"), null);
  assert.strictEqual(S.signEquivalent('-', "f'(x)<0, deci f este descrescătoare"), null);
  // baremul nu e despre semn → null (verificarea obișnuită decide)
  for (const e of ['12', '-3', '-2', 'x^2+2x+1', '\\{1, 3\\}', '(0, 1)', '-\\infty', '0', 'x < 1', '0 < x < 1']) {
    assert.strictEqual(S.signOf(e, true), null, e);
    assert.strictEqual(S.signEquivalent('-', e), null, `„-" la „${e}"`);
  }
});

test('signOf: semnul și subiectul afirmației', () => {
  assert.deepStrictEqual(S.signOf("f'(x) < 0"), { sign: 'neg', lhs: "f'(x)" });
  assert.deepStrictEqual(S.signOf('−'), { sign: 'neg', lhs: '' });
  assert.deepStrictEqual(S.signOf('derivata este pozitivă'), { sign: 'pos', lhs: '' });
  assert.deepStrictEqual(S.signOf('0 > \\Delta'), { sign: 'neg', lhs: 'delta' });
  assert.deepStrictEqual(S.signOf("f'(x) \\geq 0 pe [1, 3]"), { sign: 'nonneg', lhs: "f'(x)" });
  assert.deepStrictEqual(S.signOf('nepozitivă'), { sign: 'nonpos', lhs: '' });
  assert.strictEqual(S.signOf('-5'), null);
  assert.strictEqual(S.signOf("f'(x) < 0 ⇒ f ↘", true), null, 'în barem, concluzia arată că se cere altceva');
  assert.deepStrictEqual(S.signOf("f'(x) < 0 ⇒ f ↘"), { sign: 'neg', lhs: "f'(x)" }, 'răspunsul elevului: doar afirmația');
});

test('oglinda din browser: src/lib/semn.js are ACELAȘI cod comun și dă aceleași verdicte', async () => {
  const block = (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', ...file.split('/')), 'utf8');
    const a = src.indexOf('// ── COD COMUN'), b = src.indexOf('// ── SFÂRȘIT COD COMUN');
    assert.ok(a >= 0 && b > a, `marcajele „COD COMUN" lipsesc din ${file}`);
    return src.slice(a, b);
  };
  assert.strictEqual(block('src/lib/semn.js'), block('api/_lib/semn.js'), 'copiază codul comun din api/_lib/semn.js în src/lib/semn.js');
  const B = await import('../src/lib/semn.js').catch(() => null);   // Node vechi → doar comparația textului
  if (!B) return;
  for (const a of [...MINUS, ...NOT_NEG]) assert.strictEqual(B.signEquivalent(a, NEG), S.signEquivalent(a, NEG), `„${a}"`);
});

test('meditațiile live + pregătirea de examen: checkPollAnswer primește semnul (serverul o folosește cu mathcheck)', () => {
  const poll = { id: 'p1', type: 'completare', answer: NEG };
  for (const a of MINUS) {
    assert.strictEqual(L.checkPollAnswer(poll, a, mathcheck.answersEquivalent), true, `„${a}"`);
    assert.strictEqual(L.checkPollAnswer(poll, a), true, `„${a}" (fără equiv)`);
  }
  for (const a of NOT_NEG.filter((x) => x.trim())) assert.strictEqual(L.checkPollAnswer(poll, a, mathcheck.answersEquivalent), false, `„${a}"`);
  const plus = { id: 'p2', type: 'completare', answer: '$f\'(x) > 0$' };
  for (const a of PLUS) assert.strictEqual(L.checkPollAnswer(plus, a, mathcheck.answersEquivalent), true, `„${a}"`);
  assert.strictEqual(L.checkPollAnswer(plus, '-', mathcheck.answersEquivalent), false);
  // și răspunsurile acceptate în plus (`accept`)
  assert.strictEqual(L.checkPollAnswer({ type: 'completare', answer: '2', accept: ['negativ'] }, 'minus', mathcheck.answersEquivalent), true);
  // restul verificării rămâne la fel
  assert.strictEqual(L.checkPollAnswer({ type: 'completare', answer: '1/2' }, '0,5', mathcheck.answersEquivalent), true);
  assert.strictEqual(L.checkPollAnswer({ type: 'completare', answer: '-3' }, '-', mathcheck.answersEquivalent), false);
  assert.strictEqual(L.checkPollAnswer({ type: 'grila', answer: 'b' }, '-'), false);
});

test('„Planul meu" — întrebările de pe tablă (tabla.js → checkAnswer) primesc semnul', async () => {
  const T = await import('../src/lib/tabla.js').catch(() => null);   // Node vechi → skip
  if (!T) return;
  const q = (a) => ({ type: 'completare', q: 'Care este semnul derivatei?', answer: a });
  for (const a of MINUS) assert.ok(T.checkAnswer(q(NEG), a), `„${a}"`);
  // („≮" rămâne în afară: comparația ca text din tabla.js scoate semnele combinate, „≮" → „<" — caz teoretic)
  for (const a of NOT_NEG.filter((x) => x.trim() && !x.includes('≮'))) assert.ok(!T.checkAnswer(q(NEG), a), `„${a}"`);
  for (const a of ['-', 'minus', '<0']) assert.ok(T.checkAnswer(q('negativ'), a), `„${a}" la „negativ"`);
  for (const a of ['+', 'plus', 'pozitivă']) assert.ok(T.checkAnswer(q('$f\'(x) > 0$'), a), `„${a}"`);
  assert.ok(T.checkAnswer(q('1/2'), '0,5'), 'echivalențele de până acum rămân');
});

test('„Planul meu" — exercițiile corectate pe server (gradeAnswers) primesc semnul', () => {
  const med = require('../api/ai-meditatii');
  const qs = [{ statement: 'Semnul lui f\'(x) pe (0, 1)?', answer: NEG }, { statement: 'Semnul lui g\'(x)?', answer: 'pozitiv' }, { statement: '2+3', answer: '5' }];
  const g = med.gradeAnswers(qs, ['minus', '+', '5']);
  assert.deepStrictEqual(g.results.map((r) => r.correct), [true, true, true]);
  assert.strictEqual(g.correct, 3);
  const bad = med.gradeAnswers(qs, ['+', 'negativ', '6']);
  assert.deepStrictEqual(bad.results.map((r) => r.correct), [false, false, false]);
});
