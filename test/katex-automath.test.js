// =====================================================================
// test/katex-automath.test.js — autoMath: încadrarea LaTeX-ului „gol"
//
// autoMath pune $…$ în jurul matematicii pe care modelul a scris-o fără
// delimitatori. Greșelile lui se văd direct pe ecran: formulă roșie,
// nerandată. Cazurile de mai jos sunt cele care stricau afișarea
// enunțului în „Spațiul de lucru" (vezi GHID_SPATIU_DE_LUCRU.md).
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// katex.js e un modul ES din front-end; îl încărcăm ca text și evaluăm
// partea de autoMath (restul cere `window`).
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'katex.js'), 'utf8');
const body = src.slice(src.indexOf('const CMDS =')).replace(/^export /gm, '');
// eslint-disable-next-line no-new-func
const autoMath = new Function(body + '\nreturn autoMath;')();

// O încadrare e „ruptă" dacă $-urile nu se închid sau cad în mijlocul acoladelor
function rupt(out) {
  const n = (out.match(/\$/g) || []).length;
  return n % 2 !== 0 || /\{\$/.test(out) || /\$\}/.test(out);
}

const CAZURI = [
  ['radical cu puteri',        'AC = \\sqrt{40^2 + 30^2}'],
  ['radical cu acolade',       'AC = \\sqrt{40^{2} + 30^{2}}'],
  ['radical de ordin 3',       'x = \\sqrt[3]{27}'],
  ['fracție cu radical',       '\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}'],
  ['fracție cu puteri',        'E(x) = \\frac{(x-3)^2}{3x(x+3)}'],
  ['integrală cu limite',      '\\int_{0}^{1} x^2 dx'],
  ['sumă cu limite',           '\\sum_{i=1}^{n} i^2'],
  ['limită',                   '\\lim_{x \\to 0} \\frac{\\sin x}{x}'],
  ['puteri și paranteze',      'x^2 + a_1 + 4(10)^3 + (x+1)^2'],
  ['grade',                    'm(∡ABC) = 70^\\circ'],
  ['comenzi libere',           'AB \\cdot CD \\leq 10'],
  ['text românesc curat',      'Se consideră trapezul ABCD cu AB ∥ CD, ∡DAB = 90°'],
  ['deja încadrat',            'Aria este $\\frac{a\\cdot h}{2}$ cm²'],
  ['aritmetică simplă',        '3 · 1,2+0,4= 4'],
  ['mixt text + formule',      'Notăm $x=2$, deci $\\sqrt{x^{2}+5}=3$'],
];

test('autoMath nu rupe încadrarea pe nicio notație uzuală', () => {
  for (const [nume, intrare] of CAZURI) {
    const out = autoMath(intrare);
    assert.ok(!rupt(out), `„${nume}" a ieșit rupt: ${out}`);
  }
});

test('autoMath prinde ÎNTREAGĂ formula cu acolade imbricate', () => {
  // regresie: „\frac{-b\pm\sqrt{b^{2}-4ac}}{2a}" rămânea neîncadrat, iar
  // pasul de puteri îl rupea în „\frac{-b$\pm \sqrt{b^{2}-4ac}$}{2a}"
  assert.strictEqual(
    autoMath('\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}'),
    '$\\frac{-b\\pm\\sqrt{b^{2}-4ac}}{2a}$',
  );
  assert.strictEqual(autoMath('AC = \\sqrt{40^2 + 30^2}'), 'AC = $\\sqrt{40^2 + 30^2}$');
});

test('autoMath ține operatorii mari cu limitele lor', () => {
  // regresie: „\int_{0}^{1}" ieșea „$\in t_{0}$^{1}" — caret literal pe ecran
  assert.ok(autoMath('\\int_{0}^{1} x^2 dx').startsWith('$\\int_{0}^{1}'));
  assert.ok(autoMath('\\sum_{i=1}^{n} i^2').startsWith('$\\sum_{i=1}^{n}'));
});

test('autoMath lasă în pace textul fără matematică', () => {
  const t = 'Se consideră trapezul ABCD cu AB ∥ CD, ∡DAB = 90°';
  assert.strictEqual(autoMath(t), t);
});
