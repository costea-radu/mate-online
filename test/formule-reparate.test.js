// Teste pentru FORMULELE STRICATE (api/_lib/texRepair.js + oglinda din browser
// src/lib/texRepair.js, folosită de src/lib/katex.js → renderMath): LaTeX-ul pe care
// KaTeX nu-l poate afișa — ex. paranteza înaltă din „2(1 − 1/6)" citită de model ca
// matrice, „2\begin{pmatrix}1-\frac{1}{6}\right)" — se repară (la scrierea lecției și,
// pentru lecțiile deja scrise, la afișare); ce nu se poate repara apare ca text simplu,
// nu ca LaTeX brut, cu roșu. Verificat cu KaTeX-ul real (pachetul npm al site-ului).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const katex = require('katex');
const T = require('../api/_lib/texRepair');

const parses = (t) => { try { katex.renderToString(t, { throwOnError: true, strict: 'ignore' }); return true; } catch { return false; } };

// [stricat, reparat]
const FIXES = [
  ['\\frac{8}{3}-2\\begin{pmatrix}1-\\frac{1}{6}\\right)', '\\frac{8}{3}-2\\left(1-\\frac{1}{6}\\right)'],   // poza din sală
  ['\\left(1-\\frac{1}{6}', '(1-\\frac{1}{6}'],
  ['2\\left(x+1\\right)\\right)', '2(x+1))'],
  ['\\frac{1}{2', '\\frac{1}{2}'],
  ['\\frac{a}{b}}', '\\frac{a}{b}'],
  ['\\begin{pmatrix} 1 & 2 \\\\ 3 & 4', '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4\\end{pmatrix}'],                      // matrice adevărată: se închide
  ['f(x)=\\begin{cases} x, & x<0 \\\\ 0, & x \\geq 0', 'f(x)=\\begin{cases} x, & x<0 \\\\ 0, & x \\geq 0\\end{cases}'],
  ['\\begin{vmatrix}a-b\\right|', '\\left|a-b\\right|'],
  ['\\end{pmatrix} + 3', ') + 3'],
  ['\\left 2 \\right 3', '2 3'],
];

test('repairTex: formulele stricate tipice se repară (cât mai puțin schimbate) și KaTeX le afișează', () => {
  for (const [bad, good] of FIXES) {
    assert.strictEqual(parses(bad), false, `stricată: ${bad}`);
    const r = T.repairTex(bad, parses);
    assert.strictEqual(r, good, bad);
    assert.strictEqual(parses(r), true, r);
  }
  // cele bune rămân neatinse
  for (const ok of ['x^2+\\sqrt{3}', '\\left[ 0, 1 \\right)', '\\frac{1}{2}', '\\begin{pmatrix} 1 & 2 \\\\ 3 & 4 \\end{pmatrix}', 'A = \\{1, 2\\}']) {
    assert.strictEqual(T.repairTex(ok, parses), ok);
  }
  // fără verificator: nimic de schimbat
  assert.strictEqual(T.repairTex('\\frac{1}{2', null), '\\frac{1}{2');
  // nereparabile → null (apelantul arată textul simplu)
  assert.strictEqual(T.repairTex('\\comandanecunoscuta{x}+1', parses), null);
});

test('texText / texAsText: rezerva ca text simplu, citibil, care se afișează mereu', () => {
  assert.strictEqual(T.texText('\\frac{8}{3}-2\\begin{pmatrix}1-\\frac{1}{6}\\right)'), '8/3-2(1-1/6)');
  assert.strictEqual(T.texText('\\sqrt[3]{x^{2}+1} \\cdot \\frac{\\pi}{2} \\leq \\mathbb{R}'), '³√(x²+1) · π/2 ≤ ℝ');
  assert.strictEqual(T.texText('a_{n}, x^{n+1}, 30^\\circ, \\{1, 2\\}'), 'aₙ, xⁿ⁺¹, 30°, {1, 2}');
  assert.strictEqual(T.texText('\\frac{x+1}{x-1} \\neq 0'), '(x+1)/(x-1) ≠ 0');
  for (const bad of ['\\comandanecunoscuta{x}+1', '\\bad{\\frac{1}{2}} % 50 & _ ^ ~ $', '\\{1, 2\\} \\cup \\foo', '']) {
    const t = T.texAsText(bad);
    assert.ok(/^\\text\{/.test(t), t);
    assert.strictEqual(parses(t), true, `${bad} → ${t}`);
  }
});

test('fixMathText: repară formulele $…$ dintr-un text (la scrierea lecțiilor); textul fără formule rămâne', () => {
  assert.strictEqual(
    T.fixMathText('Calculați $\\frac{8}{3}-2\\begin{pmatrix}1-\\frac{1}{6}\\right)$ și $x^2$.'),
    'Calculați $\\frac{8}{3}-2\\left(1-\\frac{1}{6}\\right)$ și $x^2$.',
  );
  assert.strictEqual(T.fixMathText('$$\\frac{1}{2$$'), '$$\\frac{1}{2}$$');
  assert.strictEqual(T.fixMathText('Nimic de reparat: 5 lei.'), 'Nimic de reparat: 5 lei.');
  assert.strictEqual(T.fixMathText('$\\comandanecunoscuta{x}$'), '$\\comandanecunoscuta{x}$', 'nereparabilă: rămâne (browserul o arată ca text)');
  assert.strictEqual(T.fixMathText(null), null);
});

test('oglinda din browser: src/lib/texRepair.js are ACELAȘI cod comun și dă aceleași rezultate', async () => {
  const block = (file) => {
    const src = fs.readFileSync(path.join(__dirname, '..', ...file.split('/')), 'utf8');
    const a = src.indexOf('// ── COD COMUN'), b = src.indexOf('// ── SFÂRȘIT COD COMUN');
    assert.ok(a >= 0 && b > a, `marcajele „COD COMUN" lipsesc din ${file}`);
    return src.slice(a, b);
  };
  assert.strictEqual(block('src/lib/texRepair.js'), block('api/_lib/texRepair.js'), 'copiază codul comun din api/_lib/texRepair.js în src/lib/texRepair.js');
  const B = await import('../src/lib/texRepair.js').catch(() => null);   // Node vechi → doar comparația textului
  if (!B) return;
  for (const [bad, good] of FIXES) assert.strictEqual(B.repairTex(bad, parses), good);
  assert.strictEqual(B.texAsText('\\foo{x}'), T.texAsText('\\foo{x}'));
});

test('în sală (katex.js → renderMath): fiecare formulă trece prin safeTex — reparată sau text simplu, niciodată eroare', async () => {
  const hadWindow = 'window' in global;
  const prev = global.window;
  global.window = { katex };
  try {
    const K = await import('../src/lib/katex.js').catch(() => null);
    if (!K) return;
    assert.strictEqual(K.safeTex('\\frac{8}{3}-2\\begin{pmatrix}1-\\frac{1}{6}\\right)'), '\\frac{8}{3}-2\\left(1-\\frac{1}{6}\\right)');
    assert.strictEqual(K.safeTex('x^2'), 'x^2');
    const fb = K.safeTex('\\comandanecunoscuta{x}+1');
    assert.ok(/^\\text\{/.test(fb) && parses(fb), fb);
    // fără KaTeX încărcat: neschimbat
    global.window = {};
    assert.strictEqual(K.safeTex('\\frac{1}{2'), '\\frac{1}{2');
  } finally {
    if (hadWindow) global.window = prev; else delete global.window;
  }
});
