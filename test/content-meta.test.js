// Teste pentru src/lib/contentMeta.js (rubricile site-ului + regulile de
// vizibilitate folosite de Admin → Tot Conținutul). Modulul e ESM (frontend);
// Node 22+ îl importă direct (detectare de sintaxă), deci testul nu are
// nevoie de bundler. Pe un Node mai vechi testul se sare, nu eșuează.
const test = require('node:test');
const assert = require('node:assert');

let metaPromise = null;
function load() {
  if (!metaPromise) metaPromise = import('../src/lib/contentMeta.js').catch(() => null); // Node vechi → null → skip
  return metaPromise;
}

const row = (over = {}) => ({
  id: 'x', title: 't', category: 'clasa-5', content_type: 'pdf', is_free: true, sort_order: 0,
  created_at: '2026-05-01T00:00:00Z', subcategory: null, profile: null, file_url: null, ...over,
});

test('matchesGroup: clasele filtrează pe categorie + tip, EN + subcategorie, BAC + profil (fără la Capitole)', async (t) => {
  const meta = await load(); if (!meta) return t.skip('Node fără import ESM');
  const { matchesGroup } = meta;
  assert.ok(matchesGroup(row({ subcategory: 'orice' }), { category: 'clasa-5', type: 'pdf' }));
  assert.ok(!matchesGroup(row({ content_type: 'interactive' }), { category: 'clasa-5', type: 'pdf' }));
  const en = row({ category: 'evaluare-nationala', subcategory: 'variante' });
  assert.ok(matchesGroup(en, { category: 'evaluare-nationala', type: 'pdf', subcategory: 'variante' }));
  assert.ok(!matchesGroup(en, { category: 'evaluare-nationala', type: 'pdf', subcategory: 'simulari' }));
  const bac = row({ category: 'bacalaureat', subcategory: 'simulari', profile: 'mate-info' });
  assert.ok(matchesGroup(bac, { category: 'bacalaureat', type: 'pdf', subcategory: 'simulari', profile: 'mate-info' }));
  assert.ok(!matchesGroup(bac, { category: 'bacalaureat', type: 'pdf', subcategory: 'simulari', profile: 'tehnologic' }));
  const cap = row({ category: 'bacalaureat', subcategory: 'capitole', profile: 'tehnologic' });
  assert.ok(matchesGroup(cap, { category: 'bacalaureat', type: 'pdf', subcategory: 'capitole', profile: '' }), 'Capitole ignoră profilul');
});

test('visibleTypesFor / visibilityWarning: ce afișează fiecare rubrică', async (t) => {
  const meta = await load(); if (!meta) return t.skip('Node fără import ESM');
  const { visibleTypesFor, visibilityWarning } = meta;
  assert.deepStrictEqual(visibleTypesFor('clasa-7'), ['pdf', 'interactive']);
  assert.deepStrictEqual(visibleTypesFor('manuale'), ['interactive']);
  assert.deepStrictEqual(visibleTypesFor('evaluare-nationala', 'variante'), ['pdf']);
  assert.deepStrictEqual(visibleTypesFor('evaluare-nationala', 'capitole'), ['pdf', 'interactive']);
  assert.deepStrictEqual(visibleTypesFor('bacalaureat', 'teste-interactive'), ['interactive']);
  assert.deepStrictEqual(visibleTypesFor('bacalaureat', null), []);

  assert.strictEqual(visibilityWarning(row()), null);
  assert.match(visibilityWarning(row({ category: 'evaluare-nationala' })), /Fără subcategorie/);
  assert.match(visibilityWarning(row({ category: 'bacalaureat', subcategory: 'simulari' })), /Fără profil/);
  assert.strictEqual(visibilityWarning(row({ category: 'bacalaureat', subcategory: 'capitole' })), null, 'Capitole fără profil e OK');
  assert.match(visibilityWarning(row({ category: 'evaluare-nationala', subcategory: 'variante', content_type: 'interactive' })), /afișează doar PDF/);
  assert.match(visibilityWarning(row({ content_type: 'manual' })), /nu apare pe site/);
  assert.match(visibilityWarning(row({ category: 'manuale', content_type: 'pdf' })), /afișează doar interactiv/);
});

test('allowedContentTypes / storageInfo / siteOrder: oglinda regulilor de pe server', async (t) => {
  const meta = await load(); if (!meta) return t.skip('Node fără import ESM');
  const { allowedContentTypes, storageInfo, siteOrder } = meta;
  const pdf = 'https://xyz.supabase.co/storage/v1/object/public/content-files-free/pdf/clasa-5/1776193195857_fractii%20ordinare.pdf';
  assert.deepStrictEqual(allowedContentTypes({ file_url: pdf }), ['pdf']);
  assert.deepStrictEqual(allowedContentTypes({ file_url: 'https://x/object/public/content-files/interactive/c/1_t.html' }), ['interactive', 'manual']);
  assert.deepStrictEqual(allowedContentTypes({ file_url: null }), ['manual']);
  assert.deepStrictEqual(storageInfo(pdf), { bucket: 'content-files-free', path: 'pdf/clasa-5/1776193195857_fractii ordinare.pdf', name: 'fractii ordinare.pdf' });
  const sorted = [
    row({ id: 'b', sort_order: 2 }), row({ id: 'nou', sort_order: 0, created_at: '2026-06-01T00:00:00Z' }),
    row({ id: 'vechi', sort_order: 0, created_at: '2026-01-01T00:00:00Z' }), row({ id: 'a', sort_order: 1 }),
  ].sort(siteOrder).map((r) => r.id);
  assert.deepStrictEqual(sorted, ['nou', 'vechi', 'a', 'b']);
});
