// Teste pentru cererea din 26 oct. 2026 (punctul 3): „la meditații live și rezolvare PDF în chat,
// fă ca elevul să poată scrie simboluri matematice ca radical, radical de ordin n, integrală,
// limită, fracție, putere, vector, aranjamente, combinări, grade, matrice de ordin 2 și 3,
// determinant, indice, intersecție, reuniune, aparține, rezultă, infinit, pi, sau alte forme, de
// pe telefon sau calculator. Pune o tastatură specială pentru introducere răspuns cu aceste
// simboluri. Să accepte răspuns și în formă de text."
//   · serverul (api/_lib/mathcheck.js) primește răspunsul scris cu tastatura (LaTeX, ca MathLive)
//     și pe cel scris ca TEXT („radical din 2", „1/2", „x la pătrat", „60 de grade"…);
//   · intervalele țin cont de paranteze, perechile de ordine, matricele de fiecare element;
//   · forma „Abc" a browserului (src/lib/mathPlain.js) e primită de server ca răspuns corect;
//   · tastatura are toate simbolurile cerute și apare în sala live, la întrebări, în chat și la PDF.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../api/_lib/mathcheck');
const live = require('../api/_lib/live');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const plainLib = () => import('../src/lib/mathPlain.js');
const eq = (a, b) => M.answersEquivalent(a, b) === true;

// ─── 1. răspunsul scris cu tastatura (LaTeX) ─────────────────────────────────
test('tastatura: fracția, radicalii (și de ordin n), puterile, indicii — primite ca valori', () => {
  for (const [elev, corect] of [
    ['\\frac{1}{2}', '0,5'], ['\\frac{3}{4}', '0.75'], ['\\frac34', '3/4'], ['\\frac{x+1}{2}', '(x+1)/2'],
    ['\\sqrt{2}', '√2'], ['3\\sqrt{2}', '3√2'], ['2\\sqrt{3}', '\\sqrt{12}'], ['\\sqrt{x^{2}+1}', '√(x^2+1)'],
    ['\\sqrt[3]{8}', '2'], ['\\sqrt[4]{16}', '2'], ['\\sqrt[3]{x}', 'x^(1/3)'],
    ['2^{3}', '8'], ['x^{2}+1', 'x^2+1'], ['x_{1}', 'x_1'], ['2{,}5', '2,5'], ['2{,}5', '5/2'],
    ['\\left|-3\\right|', '3'], ['\\frac{\\pi}{2}', 'pi/2'], ['\\pi', 'π'],
  ]) assert.ok(eq(elev, corect), `${elev} = ${corect}`);
  assert.ok(!eq('\\sqrt[3]{8}', '3'));
  assert.ok(!eq('\\frac{\\pi}{3}', 'pi/2'));
  assert.ok(!eq('\\frac{1}{3}', '0,5'));
});

test('tastatura: aranjamente, combinări, permutări, grade, logaritmi, infinit', () => {
  for (const [elev, corect] of [
    ['C_{5}^{2}', '10'], ['C^{2}_{5}', '10'], ['A_{5}^{2}', '20'], ['P_{4}', '24'], ['4!', '24'],
    ['60^{\\circ}', '60'], ['60^{\\circ}', '60°'],
    ['\\log_{2}\\left(8\\right)', '3'], ['\\ln\\left(e\\right)', '1'], ['\\lg\\left(100\\right)', '2'],
    ['-\\infty', '-∞'], ['+\\infty', '∞'],
  ]) assert.ok(eq(elev, corect), `${elev} = ${corect}`);
  assert.ok(!eq('C_{5}^{2}', '20'), 'combinările nu sunt aranjamente');
  assert.ok(!eq('30^{\\circ}', '60'));
  assert.ok(!eq('\\infty', '-∞'));
});

test('tastatura: matricele de ordin 2 și 3 (element cu element), determinanții (valoarea)', () => {
  const m2 = '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}';
  const m3 = '\\begin{pmatrix}1&0&\\frac{1}{2}\\\\0&1&0\\\\2&3&4\\end{pmatrix}';
  assert.ok(eq(m2, m2));
  assert.ok(eq(m2, '[[1, 2], [3, 4]]'), 'matricea scrisă ca text');
  assert.ok(!eq('\\begin{pmatrix}1&2\\\\3&5\\end{pmatrix}', m2), 'un element greșit');
  assert.ok(!eq('\\begin{pmatrix}1&3\\\\2&4\\end{pmatrix}', m2), 'transpusa nu e aceeași matrice');
  assert.ok(eq(m3, '[[1, 0, 0.5], [0, 1, 0], [2, 3, 4]]'));
  assert.ok(eq('\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}', '-2'), 'determinantul de ordin 2');
  assert.ok(eq('\\begin{vmatrix}1&0&0\\\\0&2&0\\\\0&0&3\\end{vmatrix}', '6'), 'determinantul de ordin 3');
  assert.ok(eq(`\\det\\left(${m2}\\right)`, '-2'), 'butonul „det"');
  assert.ok(eq('det([[1, 2], [3, 4]])', '-2'));
  assert.ok(!eq('\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}', '2'));
});

test('tastatura: intervalele (paranteza contează), mulțimile (ordinea nu), perechile (ordinea da), vectorii, logica', () => {
  assert.ok(eq('\\left(2,5\\right]', '(2; 5]'));
  assert.ok(!eq('\\left(2,5\\right]', '(2, 5)'), 'închis la dreapta ≠ deschis');
  assert.ok(eq('\\left[-1,3\\right)', '[-1; 3)'));
  assert.ok(eq('\\left(-\\infty,2\\right]\\cup\\left[5,+\\infty\\right)', '(-∞; 2] ∪ [5; +∞)'));
  assert.ok(eq('\\left\\lbrace1;3\\right\\rbrace', '{3, 1}'), 'mulțimea {1; 3} = {3, 1}');
  assert.ok(eq('x\\in\\left\\lbrace-2;2\\right\\rbrace', '{-2; 2}'));
  assert.ok(!eq('\\left\\lbrace1;3\\right\\rbrace', '{1; 2}'));
  assert.ok(eq('\\left(1;3\\right)', '(1; 3)'));
  assert.ok(!eq('\\left(3;1\\right)', '(1; 3)'), 'perechea (3; 1) ≠ (1; 3)');
  assert.ok(eq('\\vec{v}', 'v⃗'));
  assert.ok(eq('\\overrightarrow{AB}', '\\vec{AB}'));
  assert.ok(eq('AB⃗', '\\overrightarrow{AB}'));
  assert.ok(!eq('AB⃗', '\\overrightarrow{BA}'));
  assert.ok(eq('A\\cap B', 'A ∩ B'));
  assert.ok(!eq('A\\cup B', 'A ∩ B'), 'reuniunea nu e intersecția');
  assert.ok(eq('\\emptyset', '∅'));
  assert.ok(eq('\\Rightarrow', '⇒'));
});

// ─── 2. răspunsul ca TEXT (fără tastatură) ───────────────────────────────────
test('text: „radical din 2", „1 supra 2", „x la pătrat", „2 la puterea 3", „combinări de 5 luate câte 2", „60 de grade", „minus infinit"', () => {
  for (const [text, corect] of [
    ['radical din 2', '\\sqrt{2}'], ['3 radical din 2', '3\\sqrt{2}'], ['radical de ordinul 3 din 27', '3'],
    ['1 supra 2', '\\frac{1}{2}'], ['x la pătrat', 'x^{2}'], ['x la a doua', 'x^2'], ['2 la puterea 3', '8'],
    ['combinări de 5 luate câte 2', 'C_{5}^{2}'], ['aranjamente de 5 luate câte 2', 'A_{5}^{2}'],
    ['60 de grade', '60^{\\circ}'], ['minus infinit', '-\\infty'], ['infinit', '+\\infty'],
    ['mulțimea vidă', '\\emptyset'], ['o jumătate', '0,5'], ['pi supra 2', '\\frac{\\pi}{2}'],
    ['1/2', '\\frac{1}{2}'], ['2√3', '2\\sqrt{3}'],
  ]) assert.ok(eq(text, corect), `„${text}" = ${corect}`);
  assert.ok(!eq('radical din 3', '\\sqrt{2}'));
  assert.ok(!eq('x la cub', 'x^{2}'));
  // un răspuns-propoziție rămâne text: același text = corect; altul = „nu pot decide" (null → altă metodă)
  assert.strictEqual(M.answersEquivalent('Triunghiul este isoscel', 'triunghiul este isoscel'), true);
  assert.strictEqual(M.answersEquivalent('triunghiul este isoscel', 'triunghiul este echilateral'), null);
  // LaTeX-ul nu e „în cuvinte" (nu-l atingem)
  assert.strictEqual(M.wordsToMath('\\frac{1}{2}+\\pi'), '\\frac{1}{2}+\\pi');
});

test('cheia întrebării: elevul care răspunde cu tastatura SAU ca text e primit (checkPollAnswer)', () => {
  const poll = { id: 'p1', type: 'completare', question: 'Cât este 1/2 + 1/4?', answer: '\\frac{3}{4}' };
  for (const a of ['\\frac{3}{4}', '\\frac34', '3/4', '0,75', 'trei sferturi', '3 supra 4']) assert.strictEqual(live.checkPollAnswer(poll, a, M.answersEquivalent), true, a);
  assert.strictEqual(live.checkPollAnswer(poll, '\\frac{2}{4}', M.answersEquivalent), false);
  const mat = { id: 'p2', type: 'completare', question: 'Scrieți matricea A + B.', answer: '\\begin{pmatrix}2&0\\\\1&3\\end{pmatrix}' };
  assert.strictEqual(live.checkPollAnswer(mat, '\\begin{pmatrix}2&0\\\\1&3\\end{pmatrix}', M.answersEquivalent), true);
  assert.strictEqual(live.checkPollAnswer(mat, '[[2, 0], [1, 3]]', M.answersEquivalent), true);
  assert.strictEqual(live.checkPollAnswer(mat, '\\begin{pmatrix}2&1\\\\0&3\\end{pmatrix}', M.answersEquivalent), false);
});

// ─── 3. forma „Abc" din browser (mathPlain.js) ───────────────────────────────
test('„Abc": răspunsul de la tastatură, trecut în text, rămâne corect pentru server', async () => {
  const { latexToPlain, expandTex, looksLatex } = await plainLib();
  const cases = {
    '\\frac{1}{2}': '1/2', '\\frac34': '3/4', '\\sqrt{2}': '√2', '3\\sqrt{2}': '3√2', '\\sqrt[3]{8}': '∛8',
    'x^{2}+1': 'x^2+1', 'C_{5}^{2}': 'C_5^2', '60^{\\circ}': '60°', '\\left(2,5\\right]': '(2,5]',
    '\\left\\lbrace1;3\\right\\rbrace': '{1;3}', '-\\infty': '-∞', '\\frac{\\pi}{2}': 'π/2', '\\log_{2}\\left(8\\right)': 'log_2(8)',
    '\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}': '[[1, 2], [3, 4]]', '\\begin{vmatrix}1&2\\\\3&4\\end{vmatrix}': 'det([[1, 2], [3, 4]])',
    '2\\sqrt{3}+\\frac{1}{2}x': '2√3+(1/2)x', '\\sqrt{2}x': '√(2)x', 'x\\in\\left\\lbrace-2;2\\right\\rbrace': 'x∈{-2;2}',
  };
  for (const [tex, plain] of Object.entries(cases)) {
    assert.strictEqual(latexToPlain(tex), plain, tex);
    assert.strictEqual(M.answersEquivalent(latexToPlain(tex), tex), true, `serverul primește „${plain}" pentru ${tex}`);
  }
  // simbolurile cerute au și ele forma text
  assert.strictEqual(latexToPlain('A\\cap B\\cup C'), 'A∩ B∪ C');
  assert.strictEqual(latexToPlain('x\\le 3\\Rightarrow x\\ne 4'), 'x≤ 3⇒ x≠ 4');
  assert.strictEqual(latexToPlain('\\int_{0}^{1}x\\,\\mathrm{d}x'), '∫_0^1x dx');
  assert.strictEqual(latexToPlain('\\lim_{x\\to\\infty}\\frac{1}{x}'), 'lim_x→∞1/x');
  assert.strictEqual(latexToPlain('\\overrightarrow{AB}'), 'AB⃗');
  // forma scurtă a editorului se scrie întreagă (profesorul / corectarea o citesc mai ușor)
  assert.strictEqual(expandTex('\\frac34+\\sqrt2'), '\\frac{3}{4}+\\sqrt{2}');
  assert.strictEqual(expandTex('\\frac\\pi2'), '\\frac{\\pi}{2}');
  assert.strictEqual(expandTex('\\frac{12}{5}'), '\\frac{12}{5}', 'forma lungă rămâne');
  assert.strictEqual(expandTex('\\sqrt[3]{8}'), '\\sqrt[3]{8}');
  assert.ok(looksLatex('\\frac{1}{2}') && looksLatex('x^{2}') && !looksLatex('1/2') && !looksLatex('radical din 2'));
});

// ─── 4. tastatura: simbolurile cerute, pe telefon și pe calculator ────────────
test('tastatura are toate simbolurile cerute (radical, ordin n, integrală, limită, … pi)', () => {
  const kb = read('src/components/math/MathKeyboard.jsx');
  for (const title of ['Radical', 'Radical de ordin n', 'Integrală', 'Integrală definită', 'Limită', 'Fracție', 'Putere', 'Vector', 'Vectorul AB',
    'Aranjamente', 'Combinări', 'Permutări', 'Grade', 'Matrice de ordinul 2', 'Matrice de ordinul 3', 'Determinant de ordinul 2', 'Determinant de ordinul 3',
    'Determinantul', 'Indice', 'Intersecție', 'Reuniune', 'Aparține', 'Rezultă', 'Infinit', 'pi', 'Modul', 'Logaritm natural', 'Interval (a, b]', 'Mulțime { }']) {
    assert.ok(kb.includes(`'${title}'`), `tasta „${title}"`);
  }
  // ce inserează câteva taste (MathLive): căsuțe de completat, nu cod
  assert.ok(kb.includes("'\\\\sqrt[#?]{#0}', 'Radical de ordin n'"));
  assert.ok(kb.includes("'\\\\frac{#@}{#?}', 'Fracție'"));
  assert.ok(kb.includes("'\\\\begin{pmatrix}#?&#?&#?\\\\\\\\#?&#?&#?\\\\\\\\#?&#?&#?\\\\end{pmatrix}', 'Matrice de ordinul 3'"));
  assert.ok(kb.includes("'C_{#?}^{#?}', 'Combinări'") && kb.includes("'A_{#?}^{#?}', 'Aranjamente'"));
  // pe telefon tastatura sistemului nu acoperă câmpul; virgula zecimală românească; Enter = Trimite
  assert.ok(kb.includes("math-virtual-keyboard-policy', 'manual'"));
  assert.ok(kb.includes("decimalSeparator = ','"));
  assert.ok(/Enter/.test(kb) && kb.includes('submitRef.current?.()'));
  assert.ok(kb.includes('expandTex(v)'), 'rezultatul: LaTeX întreg (\\frac{3}{4}, nu \\frac34)');
});

test('tastatura apare: la întrebările din sala live, în chatul sălii, în chatul Profesorului Virtual (PDF) și în „📝 Răspunde în chat"', () => {
  const poll = read('src/components/live/PollCard.jsx');
  assert.ok(poll.includes('<MathAnswer') && poll.includes("from '../math/MathInput'"));
  const input = read('src/components/math/MathInput.jsx');
  assert.ok(input.includes("lazy(() => import('./MathKeyboard'))"), 'editorul se încarcă doar la prima deschidere');
  assert.ok(input.includes('Abc · text') || read('src/components/math/MathKeyboard.jsx').includes('Abc · text'), 'înapoi la text („Abc")');
  assert.ok(input.includes('setText(latexToPlain(latex))'), 'formula trece în text, nu se pierde');
  assert.ok(input.includes('createPortal') && input.includes("'(max-width: 640px)'"), 'pe telefon, tastatura stă jos pe ecran (zonele mici)');
  const chat = read('src/components/live/LiveChat.jsx');
  assert.ok(chat.includes('<MathInsertButton') && chat.includes('<MathInsertPanel') && chat.includes('maxLength={500}'));
  const tutor = read('src/components/AITutor.jsx');
  assert.ok(tutor.includes('<MathInsertButton') && tutor.includes('label="✓ Pune în întrebare"'), 'chatul de lângă PDF');
  assert.ok(tutor.includes('formMathRow(it.id, it.eticheta)') && tutor.includes('formMathRow(s.id,'), 'fiecare cerință și subpunct din formular');
  assert.ok(tutor.includes('<MathText text={m.content} />'), 'mesajul elevului cu formule se vede desenat');
  // MathLive nu intră în precache (doar cine deschide tastatura o descarcă)
  const vite = read('vite.config.js');
  assert.ok(vite.includes("'assets/mathlive*'") && vite.includes("'assets/MathKeyboard*'"));
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies.mathlive, 'mathlive în dependențe');
  // CSS: în sala live culorile butoanelor nu sunt suprascrise (`.lv-room button { color: inherit }`)
  const css = read('src/styles/mathkeyboard.css');
  assert.ok(css.includes('.mk .mk-btn-main { color: #fff; }') && css.includes('.lv-side:has(.mk-insert-panel)'));
});

test('serverul primește răspunsurile lungi ale tastaturii (matricea de ordin 3) și mesajele cu formule', () => {
  const api = read('api/live.js');
  const m3 = '\\begin{pmatrix}\\frac{1}{2}&-\\frac{3}{4}&\\sqrt{2}\\\\0&1&\\frac{5}{6}\\\\-1&2&\\frac{7}{8}\\end{pmatrix}';
  assert.ok(m3.length > 80 && m3.length <= 300, 'mai lung decât vechea limită (80), sub cea nouă (300)');
  const limits = [...api.matchAll(/const answer = String\(req\.body\?\.answer \?\? ''\)\.trim\(\)\.slice\(0, (\d+)\)/g)].map((m) => Number(m[1]));
  assert.deepStrictEqual(limits, [300, 300], 'sala live (poll_answer) și Pregătirea de examen (prep_answer)');
  assert.ok(/moderate\(req\.body\?\.text \|\| '', \{ max: 500 \}\)/.test(api), 'mesajele din chat (cu $…$): până la 500');
  assert.ok(live.checkPollAnswer({ id: 'p', type: 'completare', question: 'A?', answer: m3 }, m3, M.answersEquivalent));
  assert.ok(live.checkPollAnswer({ id: 'p', type: 'completare', question: 'A?', answer: m3 }, '[[1/2, -3/4, √2], [0, 1, 5/6], [-1, 2, 7/8]]', M.answersEquivalent));
});
