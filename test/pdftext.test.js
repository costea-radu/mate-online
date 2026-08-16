// Teste pentru asamblarea textului din PDF (node --test, fără dependențe):
// FRACȚIILE ETAJATE din Word/MathType trebuie să devină \frac{num}{den} —
// înainte, „a/3 = b/4 = 5" ieșea „_{3}^{a} = ^{b}_{4} = 5" și Profesorul
// Virtual citea numitorul ca putere („a³ = b⁴ = 5"). Exponenții și indicii
// adevărați trebuie să rămână neatinși.
const test = require('node:test');
const assert = require('node:assert');
const { linesFromTextContent, cutBarem } = require('../api/_lib/pdftext');

// un item de text așa cum îl dă pdf.js: transform=[size,0,0,size,x,y]
const it = (str, x, y, size = 12, w = null) =>
  ({ str, width: w != null ? w : str.length * size * 0.5, transform: [size, 0, 0, size, x, y] });
const extract = (items) => linesFromTextContent({ items });

// geometria Word (corp 12): numărător la +5.8pt, numitor la −5.2pt, glife de 7.9pt
function wordFraction(num, den, x, y) {
  const wN = num.length * 7.9 * 0.5, wD = den.length * 7.9 * 0.5;
  const wBar = Math.max(wN, wD) + 3;
  return [
    it(num, x + (wBar - wN) / 2, y + 5.8, 7.9),
    it(den, x + (wBar - wD) / 2, y - 5.2, 7.9),
  ];
}

test('fracțiile etajate devin \\frac{}{}, nu exponent+indice (bug-ul „a³=b⁴=5")', () => {
  const y = 700;
  const out = extract([
    it('2. Stiind ca ', 70, y),                 // ~ x: 70..148
    ...wordFraction('a', '3', 150, y),
    it(' = ', 158, y),
    ...wordFraction('b', '4', 178, y),
    it(' = 5 , rezultatul calculului a + b este egal cu:', 186, y),
  ]);
  assert.match(out, /\\frac\{a\}\{3\}/);
  assert.match(out, /\\frac\{b\}\{4\}/);
  assert.doesNotMatch(out, /\^\{a\}|\^\{b\}|_\{3\}|_\{4\}/); // nu sup/sub!
  // ordinea pe rând: fracțiile stau la locul lor în propoziție
  assert.match(out, /Stiind ca \\frac\{a\}\{3\} = \\frac\{b\}\{4\} = 5/);
});

test('exponenții adevărați rămân exponenți (2^{3})', () => {
  const y = 600;
  const out = extract([
    it('4. Rezultatul calculului 2', 70, y),    // baza „2" se termină ~ x=226
    it('3', 226.5, y + 4.6, 7.8),               // exponentul, lipit de bază
    it(' + 2 este egal cu:', 231, y),
  ]);
  assert.match(out, /2\^\{3\}/);
  assert.doesNotMatch(out, /\\frac/);
});

test('indicii adevărați rămân indici (x_{1})', () => {
  const y = 500;
  const out = extract([
    it('5. Daca x', 70, y),
    it('1', 124.5, y - 3.4, 7.8),
    it(' = 2 , atunci:', 129, y),
  ]);
  assert.match(out, /x_\{1\}/);
  assert.doesNotMatch(out, /\\frac/);
});

test('x cu indice ȘI exponent (x₁²) NU devine fracție', () => {
  const y = 400;
  const out = extract([
    it('7. Suma x', 70, y),                     // baza „x" se termină ~ x=124
    it('2', 124.5, y + 4.6, 7.8),               // exponent
    it('1', 124.5, y - 3.4, 7.8),               // indice — nu e \frac{2}{1}!
    it(' + 3 este 10.', 129, y),
  ]);
  assert.doesNotMatch(out, /\\frac/);
  assert.match(out, /\^\{2\}/);
  assert.match(out, /_\{1\}/);
});

test('numărător compus și indice interpus pe rând (MathType): \\frac{x + 1}{2}', () => {
  const y = 300;
  const out = extract([
    it('m = ', 70, y),
    it('n', 60, y - 3.4, 7.8),                  // un indice al altui simbol, mai la stânga
    it('x + 1', 95, y + 7, 10),                 // numărător compus, la +7pt
    it('2', 103, y - 6.8, 10),                  // numitor la −6.8pt
    it(' , atunci:', 125, y),
  ]);
  assert.match(out, /\\frac\{x \+ 1\}\{2\}/);
});

test('bara de fracție desenată ca text („—") este consumată', () => {
  const y = 200;
  const out = extract([
    it('k = ', 70, y),
    it('7', 95, y + 5.8, 7.9),
    it('—', 93, y + 3.5, 7.9),                  // bara, glifă separată
    it('9', 95, y - 5.2, 7.9),
    it(' .', 110, y),
  ]);
  assert.match(out, /\\frac\{7\}\{9\}/);
  assert.doesNotMatch(out, /—/);
});

test('tabelele compacte NU devin fracții', () => {
  const out = extract([
    it('1', 70, 120, 9), it('45', 130, 120, 9), it('20 min', 200, 120, 9),
    it('2', 70, 109, 9), it('90', 130, 109, 9), it('40 min', 200, 109, 9),
    it('3', 70, 98, 9), it('60', 130, 98, 9), it('30 min', 200, 98, 9),
  ]);
  assert.doesNotMatch(out, /\\frac/);
});

test('rândurile scurte de text cu spațiere normală NU devin fracții', () => {
  const out = extract([
    it('Model de test', 70, 90), it('Varianta 3', 70, 76), it('Sesiunea 2026', 70, 62),
  ]);
  assert.doesNotMatch(out, /\\frac/);
  assert.match(out, /Model de test\nVarianta 3\nSesiunea 2026/);
});

test('cutBarem taie partea de barem', () => {
  const t = cutBarem('Subiect...\nBAREM DE EVALUARE\nPunctaje');
  assert.strictEqual(t.includes('Punctaje'), false);
  assert.strictEqual(t.includes('Subiect'), true);
});
