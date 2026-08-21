// Teste de integrare (fără rețea) pentru api/content-admin.js: ordinea
// operațiilor la schimbarea accesului (copiere → rând → ștergerea originalului;
// la eșec, copia se curăță și originalul rămâne), reorder și sort_all.
// Clientul Supabase e un dublu minimal; autentificarea/adminul sunt stub-uite.
const test = require('node:test');
const assert = require('node:assert');

const http = require('../api/_lib/http');
const calls = [];
let fakeDb; // { rows: [...] }
let failUpdate = false;

// ── dublu pentru supabase-js (doar ce folosește handlerul) ──
function fakeSupabase() {
  const storage = {
    from(bucket) {
      return {
        async copy(from, to, opts) { calls.push(['copy', bucket, from, opts?.destinationBucket]); return { error: null }; },
        async remove(paths) { calls.push(['remove', bucket, ...paths]); return { error: null }; },
        getPublicUrl(path) { return { data: { publicUrl: `https://xyz.supabase.co/storage/v1/object/public/${bucket}/${path}` } }; },
      };
    },
  };
  function table() {
    const q = { _filters: [], _select: null, _update: null, _order: null, _range: null };
    const api = {
      select(cols) { q._select = cols; return api; },
      update(patch) { q._update = patch; return api; },
      eq(col, val) { q._filters.push([col, val]); return api; },
      in(col, vals) { q._filters.push([col, vals]); return api; },
      order() { return api; },
      range(a, b) { q._range = [a, b]; return api; },
      single() { q._single = true; return api; },
      then(resolve) { return Promise.resolve(run()).then(resolve); },
    };
    function matching() {
      return fakeDb.rows.filter((r) => q._filters.every(([c, v]) => (Array.isArray(v) ? v.includes(r[c]) : r[c] === v)));
    }
    function run() {
      if (q._update) {
        if (failUpdate) return { data: null, error: { message: 'boom' } };
        const rows = matching();
        rows.forEach((r) => Object.assign(r, q._update));
        calls.push(['update', q._update, q._filters]);
        return { data: q._single ? rows[0] : rows, error: null };
      }
      let rows = matching();
      if (q._range) rows = rows.slice(q._range[0], q._range[1] + 1);
      if (q._single) return rows[0] ? { data: rows[0], error: null } : { data: null, error: { message: 'not found' } };
      return { data: rows, error: null };
    }
    return api;
  }
  return { from: () => table(), storage };
}

// stub-uri: clientul, utilizatorul și verificarea de admin
http.admin = () => fakeSupabase();
http.authUser = async () => 'admin-user';
http.requireAdmin = async () => true;
const handler = require('../api/content-admin');

function req(body) { return { method: 'POST', headers: { authorization: 'Bearer x' }, body }; }
function res() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
const FREE_URL = 'https://xyz.supabase.co/storage/v1/object/public/content-files-free/pdf/clasa-5/1_fractii.pdf';
const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';

test.beforeEach(() => {
  calls.length = 0; failUpdate = false;
  fakeDb = { rows: [
    { id: ID, title: 'Fracții', description: null, category: 'clasa-5', content_type: 'pdf', is_free: true, file_url: FREE_URL, subcategory: null, profile: null, sort_order: 0, created_at: '2026-03-01T00:00:00Z' },
    { id: ID2, title: 'Numere', description: null, category: 'clasa-5', content_type: 'pdf', is_free: true, file_url: null, subcategory: null, profile: null, sort_order: 0, created_at: '2026-04-01T00:00:00Z' },
    { id: ID3, title: 'Test', description: null, category: 'clasa-6', content_type: 'interactive', is_free: false, file_url: null, subcategory: null, profile: null, sort_order: 5, created_at: '2026-05-01T00:00:00Z' },
  ] };
});

test('update: gratuit → premium copiază în bucket-ul privat, scrie rândul, apoi șterge originalul', async () => {
  const r = res();
  await handler(req({ action: 'update', id: ID, data: { title: 'Fracții ordinare', is_free: false } }), r);
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.changed, true);
  assert.deepStrictEqual(r.body.moved, { from: 'content-files-free', to: 'content-files' });
  assert.strictEqual(r.body.row.title, 'Fracții ordinare');
  assert.strictEqual(r.body.row.is_free, false);
  assert.match(r.body.row.file_url, /\/object\/public\/content-files\/pdf\/clasa-5\/1_fractii\.pdf$/);
  assert.deepStrictEqual(calls.map((c) => c[0]), ['copy', 'update', 'remove']);
  assert.deepStrictEqual(calls[0], ['copy', 'content-files-free', 'pdf/clasa-5/1_fractii.pdf', 'content-files']);
  assert.deepStrictEqual(calls[2], ['remove', 'content-files-free', 'pdf/clasa-5/1_fractii.pdf']);
  assert.ok(calls[1][1].updated_at, 'updated_at setat');
});

test('update: dacă rândul nu se poate scrie, copia se curăță și originalul rămâne', async () => {
  failUpdate = true;
  const r = res();
  await handler(req({ action: 'update', id: ID, data: { is_free: false } }), r);
  assert.strictEqual(r.statusCode, 500);
  assert.deepStrictEqual(calls.map((c) => c[0]), ['copy', 'remove']);
  assert.deepStrictEqual(calls[1], ['remove', 'content-files', 'pdf/clasa-5/1_fractii.pdf']); // copia, nu originalul
  assert.strictEqual(fakeDb.rows[0].is_free, true);
});

test('update: fără schimbări → changed=false și niciun apel; validare → 400; id necunoscut → 404', async () => {
  let r = res();
  await handler(req({ action: 'update', id: ID, data: { title: 'Fracții', is_free: true, category: 'clasa-5' } }), r);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.changed, false);
  assert.deepStrictEqual(calls, []);

  r = res();
  await handler(req({ action: 'update', id: ID, data: { content_type: 'interactive' } }), r);
  assert.strictEqual(r.statusCode, 400);
  assert.match(r.body.error, /nu se potrivește/);

  r = res();
  await handler(req({ action: 'update', id: '99999999-9999-4999-8999-999999999999', data: { title: 'x' } }), r);
  assert.strictEqual(r.statusCode, 404);
});

test('update: schimbarea accesului fără fișier nu atinge Storage', async () => {
  const r = res();
  await handler(req({ action: 'update', id: ID2, data: { is_free: false } }), r);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.moved, null);
  assert.deepStrictEqual(calls.map((c) => c[0]), ['update']);
});

test('reorder: scrie 1..N doar unde se schimbă; id-urile care nu sunt UUID sunt ignorate', async () => {
  const r = res();
  await handler(req({ action: 'reorder', ids: [ID2, 'nu-e-uuid', ID, ID3] }), r);
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual({ total: r.body.total, updated: r.body.updated, missing: r.body.missing }, { total: 3, updated: 3, missing: 0 });
  assert.strictEqual(fakeDb.rows.find((x) => x.id === ID2).sort_order, 1);
  assert.strictEqual(fakeDb.rows.find((x) => x.id === ID).sort_order, 2);
  assert.strictEqual(fakeDb.rows.find((x) => x.id === ID3).sort_order, 3);
  // a doua oară, aceeași ordine → nimic de scris
  calls.length = 0;
  const r2 = res();
  await handler(req({ action: 'reorder', ids: [ID2, ID, ID3] }), r2);
  assert.strictEqual(r2.body.updated, 0);
  assert.deepStrictEqual(calls, []);
});

test('sort_all: renumerotează pe categorii, respectă filtrul de categorie și refuză criteriile necunoscute', async () => {
  let r = res();
  await handler(req({ action: 'sort_all', by: 'created_at', dir: 'desc' }), r);
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.total, 3);
  assert.strictEqual(fakeDb.rows.find((x) => x.id === ID2).sort_order, 1); // clasa-5: cel mai nou primul
  assert.strictEqual(fakeDb.rows.find((x) => x.id === ID).sort_order, 2);
  assert.strictEqual(fakeDb.rows.find((x) => x.id === ID3).sort_order, 1); // clasa-6: singur → 1

  r = res();
  await handler(req({ action: 'sort_all', by: 'title', dir: 'asc', category: 'clasa-5' }), r);
  assert.strictEqual(r.body.total, 2);
  assert.strictEqual(fakeDb.rows.find((x) => x.id === ID).sort_order, 1);  // Fracții < Numere
  assert.strictEqual(fakeDb.rows.find((x) => x.id === ID2).sort_order, 2);

  r = res();
  await handler(req({ action: 'sort_all', by: 'id' }), r);
  assert.strictEqual(r.statusCode, 400);
  r = res();
  await handler(req({ action: 'sort_all', category: 'clasa-99' }), r);
  assert.strictEqual(r.statusCode, 400);
});
