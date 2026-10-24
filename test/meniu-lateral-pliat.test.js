// Meniul lateral al site-ului (src/components/Sidebar.jsx) pornește PLIAT la
// fiecare încărcare de pagină (cerut 24 oct. 2026) și se desface la hover. Un
// clic cu mouse-ul pe o intrare nu-l mai ține desfăcut prin focus (`:focus-within`).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8');
const jsx = read('src/components/Sidebar.jsx');
const css = read('src/styles/global.css');

test('bara pornește pliată pe orice pagină', () => {
  assert.match(jsx, /const \[pliat, setPliat\] = useState\(true\);/);
});

test('conținutul e decalat implicit cu banda îngustă — la încărcare nu așteaptă nicio clasă din JS', () => {
  assert.match(css, /\.app-shell \{ padding-left: var\(--sidebar-rail\);/);
  assert.match(css, /body\.sidebar-deschis \.app-shell \{ padding-left: var\(--sidebar-w\); \}/);
  assert.match(jsx, /classList\.toggle\('sidebar-deschis', !pliat\)/);
  assert.doesNotMatch(css + jsx, /sidebar-pliat/, 'clasa veche (cu sensul invers) nu mai apare');
});

test('clicul cu mouse-ul lasă focusul, tastatura îl păstrează', () => {
  assert.match(jsx, /<aside [^>]*onClick=\{lasaFocusul\}/);
  const start = jsx.indexOf('function lasaFocusul(e)');
  assert.ok(start > 0, 'lasaFocusul există');
  const f = jsx.slice(start, jsx.indexOf('el.blur();', start) + 10);
  assert.match(f, /if \(e\.detail === 0\) return;/, 'Enter de la tastatură (detail 0) nu pierde focusul');
  assert.match(f, /e\.target\.closest\('a, button'\)/);
});
