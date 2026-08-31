// =====================================================================
// test/materiale-fara-bareme.test.js — lista de materiale pentru dueluri și
// turnee (api/_lib/materiale.js).
//
// Ce apărăm aici:
//   1. BAREMELE nu ajung niciodată în listă — nici după subcategorie, nici
//      după titlu, nici după numele oficial de fișier („..._bar_05_LRO.pdf").
//   2. Lista NU se oprește la primele 300 de rânduri: se citește paginat,
//      deci apar toate materialele de pe site.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');

const materiale = require('../api/_lib/materiale');

// supa fals: întoarce `rows` paginat, exact cum o face PostgREST cu .range()
function fakeSupa(rows) {
  const q = {
    _feluri: null,
    _gratuite: false,
    select() { return this; },
    in(col, val) { if (col === 'content_type') this._feluri = val; return this; },
    eq(col, val) { if (col === 'is_free') this._gratuite = val; return this; },
    order() { return this; },
    range(from, to) {
      let list = rows;
      if (this._feluri) list = list.filter((r) => this._feluri.includes(r.content_type));
      if (this._gratuite) list = list.filter((r) => r.is_free);
      const data = list.slice(from, to + 1);
      return Promise.resolve({ data, error: null });
    },
  };
  // fiecare `.from()` pornește un lanț nou, cu filtrele lui
  return { from: () => ({ ...q }) };
}

const test1 = { id: 't1', title: 'Evaluare Națională 2024 · Varianta 5', category: 'evaluare-nationala', is_free: true, content_type: 'pdf', subcategory: 'variante', file_url: 'https://x/1_ENVIII_Matematica_2024_var_05_LRO.pdf' };
const barem1 = { id: 'b1', title: 'Evaluare Națională 2024 · Barem varianta 5', category: 'evaluare-nationala', is_free: true, content_type: 'pdf', subcategory: 'bareme', file_url: 'https://x/2_ENVIII_Matematica_2024_bar_05_LRO.pdf' };
// barem „ascuns": subcategoria e greșită, dar numele oficial de fișier îl dă de gol
const barem2 = { id: 'b2', title: 'Bacalaureat 2023 varianta 3', category: 'bacalaureat', is_free: false, content_type: 'pdf', subcategory: 'variante', file_url: 'https://x/3_E_c_matematica_M_mate-info_2023_bar_03_LRO.pdf' };
const inter1 = { id: 'i1', title: 'Fracții ordinare', category: 'clasa-5', is_free: true, content_type: 'interactive', subcategory: null, file_url: null };

test('materiale: baremele nu apar în listă (subcategorie, titlu sau nume de fișier)', async () => {
  const supa = fakeSupa([test1, barem1, barem2, inter1]);
  const { materiale: liste, total } = await materiale.liste(supa, {});

  const idPdf = liste.pdf.map((x) => x.id);
  assert.deepStrictEqual(idPdf, ['t1'], 'doar testul, fără cele două bareme');
  assert.deepStrictEqual(liste.interactive.map((x) => x.id), ['i1']);
  assert.strictEqual(total.pdf, 1);
  assert.strictEqual(total.interactive, 1);
});

test('materiale: lista trece de 300 de rânduri (citire paginată)', async () => {
  const multe = Array.from({ length: 1319 }, (_, i) => ({
    id: `x${i}`, title: `Exercițiu ${i}`, category: 'clasa-7',
    is_free: true, content_type: i % 2 ? 'pdf' : 'interactive', subcategory: null, file_url: null,
  }));
  const supa = fakeSupa(multe);
  const { total } = await materiale.liste(supa, {});
  assert.strictEqual(total.interactive + total.pdf, 1319, 'apar toate, nu primele 300');
});

test('materiale: doarGratuite lasă afară materialele premium', async () => {
  const supa = fakeSupa([test1, inter1, { ...inter1, id: 'i2', is_free: false }]);
  const { total } = await materiale.liste(supa, { doarGratuite: true });
  assert.strictEqual(total.interactive, 1);
});

test('materiale: căutarea merge și fără diacritice', async () => {
  const supa = fakeSupa([inter1, { ...inter1, id: 'i3', title: 'Ecuații de gradul I' }]);
  const r = await materiale.lista(supa, { tip: 'interactive', q: 'fractii' });
  assert.deepStrictEqual(r.items.map((x) => x.id), ['i1']);
  assert.strictEqual(r.total, 2, 'totalul rămâne al listei întregi');
});
