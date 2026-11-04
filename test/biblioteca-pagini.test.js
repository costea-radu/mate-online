// =====================================================================
// test/biblioteca-pagini.test.js — cererea din 4 noiembrie 2026:
//   „în cont de prof, la «Asistent AI» nu văd toate testele și exercițiile
//    mele, deoarece sunt multe. Fă să apară pe pagini, toate."
//
// „📚 Testele și exercițiile mele" (src/pages/ProfesorVirtual.jsx) nu mai
// arată doar ultimele 60: fiecare pagină se cere separat (aiClient.listLibraryPage,
// cu numărul total), cu filtru pe fel, căutare în titlu și bara de paginare
// (src/lib/paginare.js).
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8');

test('pageWindow: prima, ultima și vecinele paginii curente, cu „…" între ele', async () => {
  const { pageWindow } = await import('../src/lib/paginare.js');
  assert.deepStrictEqual(pageWindow(1, 1), [1]);
  assert.deepStrictEqual(pageWindow(1, 3), [1, 2, 3]);
  assert.deepStrictEqual(pageWindow(6, 20), [1, '…', 4, 5, 6, 7, 8, '…', 20]);
  assert.deepStrictEqual(pageWindow(1, 20), [1, 2, 3, '…', 20]);
  assert.deepStrictEqual(pageWindow(20, 20), [1, '…', 18, 19, 20]);
  assert.deepStrictEqual(pageWindow(4, 7), [1, 2, 3, 4, 5, 6, 7]);
  // valori ciudate → limitate la intervalul valid
  assert.deepStrictEqual(pageWindow(99, 3), [1, 2, 3]);
  assert.deepStrictEqual(pageWindow(0, 0), [1]);
  assert.deepStrictEqual(pageWindow('2', '5'), [1, 2, 3, 4, 5]);
});

test('listLibraryPage: o pagină din TOATE elementele, cu numărul total, filtru și căutare', () => {
  const a = read('src/lib/aiClient.js');
  const fn = a.slice(a.indexOf('async listLibraryPage('), a.indexOf('async listLibrary(kind'));
  assert.ok(fn.length > 100);
  assert.match(fn, /\{ count: 'exact' \}/);
  assert.match(fn, /\.range\(from, from \+ size - 1\)/);
  assert.match(fn, /\.is\('payload->>setId', null\)/, 'variantele unui set rămân ascunse în spatele setului');
  assert.match(fn, /qq\.in\('kind', kinds\)/);
  assert.match(fn, /qq\.ilike\('title'/);
  assert.match(fn, /nb:payload->exam->>noBarem/, 'testele „fără barem" nu au butonul „📝 Barem"');
  // % și _ din căutare sunt litere, nu metacaractere ILIKE
  assert.match(fn, /replace\(\/\[\\\\%_\]\/g/);
});

test('„📚 Testele și exercițiile mele": pagini (20 / 50 / 100), filtru, căutare, bara de paginare', () => {
  const v = read('src/pages/ProfesorVirtual.jsx');
  assert.match(v, /aiClient\.listLibraryPage\(\{ page: p, pageSize/);
  assert.match(v, /const LIB_KINDS = \[/);
  assert.match(v, /const LIB_PREF = 'mate_lib_pagina';/);
  assert.match(v, /<nav aria-label="Paginile listei"/);
  assert.match(v, /pageWindow\(page, pages\)/);
  assert.match(v, /\[20, 50, 100\]/);
});
