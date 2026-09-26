// „✍️ Spațiu de lucru" (src/components/SpatiuDeLucru.jsx): scrisul de mână NU
// se mai transformă singur în text — doar când elevul apasă un buton
// („✨ Transformă în text" sau, înainte să folosească textul, „🎓 Cere
// corectarea" / „✓ Pune în răspuns" / „📋 Copiază").
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src/components/SpatiuDeLucru.jsx'), 'utf8');
const between = (a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));

test('nu mai există transformarea automată (temporizatorul după ridicarea creionului)', () => {
  assert.doesNotMatch(src, /AUTO_DELAY|scheduleFlush|setAuto|Automat:/);
  // ridicarea creionului doar regrupează liniile și salvează ciorna
  const onUp = between('function onUp()', 'function erase(');
  assert.ok(onUp.length > 50, 'onUp există');
  assert.doesNotMatch(onUp, /transform\(|recognize|handwriting|setTimeout/);
});

test('recunoașterea pornește DOAR din butoane', () => {
  assert.strictEqual([...src.matchAll(/aiClient\.handwriting\(/g)].length, 1, 'o singură cerere de recunoaștere, în recognizeOnce');
  assert.strictEqual([...src.matchAll(/recognizeOnce\(/g)].length, 1, 'recognizeOnce e chemat doar de transform()');
  assert.strictEqual([...src.matchAll(/\btransform\(/g)].length, 2, 'transform() e chemat doar de transformaTot() și de act()');
  assert.match(src, /onClick=\{transformaTot\}/, 'butonul „✨ Transformă în text"');
  for (const k of ['corect', 'insert', 'copy']) assert.match(src, new RegExp(`onClick=\\{\\(\\) => act\\('${k}'\\)\\}`));
  assert.match(src, /✨ Transformă în text/);
});

test('butoanele de jos transformă întâi ce a rămas și nu lasă deoparte pe ascuns o linie necitită', () => {
  const act = between('function act(kind)', 'function runAct(');
  assert.match(act, /asteapta\.length/);
  assert.match(act, /transform\(asteapta\.map/);
  assert.match(act, /setThen\(kind\)/, 'textul se folosește după randare (efectul pe `then`)');
  assert.match(act, /warnedRef\.current !== failKey/, 'avertizează o dată pentru liniile necitite');
  // fereastra închisă între timp → nu se mai trimite nimic
  assert.match(src, /if \(!open\) return;\s+\/\/ fereastra s-a închis între timp/);
});

test('o linie salvată „în citire" în ciornă redevine cerneală la redeschidere', () => {
  assert.match(src, /v\.status === 'busy' \? \{ \.\.\.v, status: 'idle', latex: null \} : v/);
});
