// Teste pentru parsarea căilor Supabase Storage (node --test, fără dependențe)
// + citirea paginată peste limita de 1000 de rânduri PostgREST.
const test = require('node:test');
const assert = require('node:assert');
const { parseStoragePath, allRows, inBatches } = require('../api/_lib/http');

test('parseStoragePath: URL public standard', () => {
  const { bucket, filePath } = parseStoragePath(
    'https://xyz.supabase.co/storage/v1/object/public/materiale/clasa-9/test.pdf');
  assert.strictEqual(bucket, 'materiale');
  assert.strictEqual(filePath, 'clasa-9/test.pdf');
});

test('parseStoragePath: elimină query params', () => {
  const { filePath } = parseStoragePath(
    'https://xyz.supabase.co/storage/v1/object/public/b/a/b.pdf?token=abc&x=1');
  assert.strictEqual(filePath, 'a/b.pdf');
});

test('parseStoragePath: format signed (/object/sign/)', () => {
  const { bucket, filePath } = parseStoragePath(
    'https://xyz.supabase.co/storage/v1/object/sign/rezolvari/2025/bac.pdf');
  assert.strictEqual(bucket, 'rezolvari');
  assert.strictEqual(filePath, '2025/bac.pdf');
});

test('parseStoragePath: URL fără /object/ aruncă eroare', () => {
  assert.throws(() => parseStoragePath('https://example.com/oops/file.pdf'));
});

// ─── allRows: paginare peste limita de 1000 (bug-ul rezultatelor dispărute) ──
// Simulăm un „tabel" cu 2350 de rânduri servit în pagini de max 1000, ca
// PostgREST: fără paginare, dashboardul profesorului pierdea rândurile vechi.
test('allRows: adună TOATE rândurile, în pagini de 1000', async () => {
  const table = Array.from({ length: 2350 }, (_, i) => ({ i }));
  const calls = [];
  const rows = await allRows(async (from, to) => {
    calls.push([from, to]);
    return { data: table.slice(from, to + 1), error: null };
  });
  assert.strictEqual(rows.length, 2350);
  assert.deepStrictEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.strictEqual(rows[2349].i, 2349); // ultimul rând nu se pierde
});

test('allRows: se oprește la prima pagină incompletă și propagă erorile', async () => {
  const rows = await allRows(async () => ({ data: [{ a: 1 }], error: null }));
  assert.strictEqual(rows.length, 1); // < 1000 → o singură cerere
  await assert.rejects(allRows(async () => ({ data: null, error: { message: 'boom' } })), /boom/);
});

test('inBatches: loturile .in(...) se combină și fiecare lot e paginat', async () => {
  const ids = Array.from({ length: 250 }, (_, i) => `id${i}`);
  const batches = [];
  const rows = await inBatches(ids, async (chunk, from, to) => {
    batches.push({ n: chunk.length, from, to });
    // fiecare id are câte un rând
    return { data: from === 0 ? chunk.map((id) => ({ id })) : [], error: null };
  });
  assert.strictEqual(rows.length, 250);
  assert.deepStrictEqual(batches.map((b) => b.n), [100, 100, 50]); // loturi de 100
});
