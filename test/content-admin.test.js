// Teste pentru Admin → „Tot Conținutul": editarea metadatelor + ordinea de
// afișare (node --test, fără rețea). Logica pură e în api/_lib/contentAdmin.js.
const test = require('node:test');
const assert = require('node:assert');
const {
  sanitizeUpdate, allowedContentTypes, fileExtension, planReorder, planSortAll, siteOrder, bucketFor,
} = require('../api/_lib/contentAdmin');

const PDF_URL = 'https://xyz.supabase.co/storage/v1/object/public/content-files-free/pdf/clasa-5/1776193195857_fractii.pdf';
const HTML_URL = 'https://xyz.supabase.co/storage/v1/object/public/content-files/interactive/bacalaureat/1776193195857_test.html';

const row = (over = {}) => ({
  id: 'a1', title: 'Fracții', description: '', category: 'clasa-5', content_type: 'pdf',
  is_free: true, file_url: PDF_URL, subcategory: null, profile: null, sort_order: 0,
  created_at: '2026-05-01T10:00:00Z', ...over,
});

// ─── tipul trebuie să corespundă fișierului ──────────────────────────────────
test('fileExtension / allowedContentTypes: PDF-ul rămâne pdf, HTML-ul poate fi interactiv sau manual', () => {
  assert.strictEqual(fileExtension(PDF_URL), 'pdf');
  assert.strictEqual(fileExtension(HTML_URL + '?token=1'), 'html');
  assert.strictEqual(fileExtension(null), null);
  assert.deepStrictEqual(allowedContentTypes(row()), ['pdf']);
  assert.deepStrictEqual(allowedContentTypes(row({ file_url: HTML_URL })), ['interactive', 'manual']);
  assert.deepStrictEqual(allowedContentTypes(row({ file_url: null })), ['manual']);
  assert.deepStrictEqual(allowedContentTypes(row({ file_url: 'https://x/y/fisier.docx' })), ['pdf', 'interactive', 'manual']);
});

test('sanitizeUpdate: refuză tipul incompatibil cu fișierul', () => {
  const { errors } = sanitizeUpdate({ content_type: 'interactive' }, row());
  assert.ok(errors.some((e) => /nu se potrivește/.test(e)));
  const ok = sanitizeUpdate({ content_type: 'manual' }, row({ file_url: HTML_URL, content_type: 'interactive' }));
  assert.deepStrictEqual(ok.errors, []);
  assert.deepStrictEqual(ok.patch, { content_type: 'manual' });
});

// ─── patch-ul conține DOAR ce se schimbă ─────────────────────────────────────
test('sanitizeUpdate: patch minimal, titlu curățat, descriere goală → null', () => {
  const { patch, errors } = sanitizeUpdate(
    { title: '  Fracții ordinare  ', description: '   ', category: 'clasa-5', content_type: 'pdf', is_free: true, sort_order: 0 },
    row(),
  );
  assert.deepStrictEqual(errors, []);
  assert.deepStrictEqual(patch, { title: 'Fracții ordinare' }); // descrierea era deja goală
});

test('sanitizeUpdate: titlul gol / prea lung, categorie sau ordine invalidă', () => {
  assert.ok(sanitizeUpdate({ title: '   ' }, row()).errors.length);
  assert.ok(sanitizeUpdate({ title: 'x'.repeat(301) }, row()).errors.length);
  assert.ok(sanitizeUpdate({ category: 'clasa-13' }, row()).errors.length);
  assert.ok(sanitizeUpdate({ sort_order: -1 }, row()).errors.length);
  assert.ok(sanitizeUpdate({ sort_order: 'abc' }, row()).errors.length);
  assert.deepStrictEqual(sanitizeUpdate({ sort_order: 7 }, row()).patch, { sort_order: 7 });
  assert.deepStrictEqual(sanitizeUpdate({ sort_order: '' }, row()).patch, {}); // câmp lăsat gol → neschimbat
});

test('sanitizeUpdate: accesul acceptă boolean sau „free"/„premium"', () => {
  assert.deepStrictEqual(sanitizeUpdate({ is_free: false }, row()).patch, { is_free: false });
  assert.deepStrictEqual(sanitizeUpdate({ is_free: 'premium' }, row()).patch, { is_free: false });
  assert.deepStrictEqual(sanitizeUpdate({ is_free: 'free' }, row()).patch, {});
  assert.strictEqual(bucketFor(false), 'content-files');
  assert.strictEqual(bucketFor(true), 'content-files-free');
});

// ─── subcategorie / profil ───────────────────────────────────────────────────
test('sanitizeUpdate: EN validează subcategoria și nu păstrează profil', () => {
  const cur = row({ category: 'evaluare-nationala', subcategory: 'variante', profile: 'mate-info' });
  const bad = sanitizeUpdate({ subcategory: 'exercitii' }, cur); // „exercitii" e doar la BAC
  assert.ok(bad.errors.length);
  const ok = sanitizeUpdate({ subcategory: 'simulari' }, cur);
  assert.deepStrictEqual(ok.errors, []);
  assert.deepStrictEqual(ok.patch, { subcategory: 'simulari', profile: null });
});

test('sanitizeUpdate: BAC validează profilul; mutarea într-o clasă curăță rubricile', () => {
  const cur = row({ category: 'bacalaureat', subcategory: 'variante', profile: 'mate-info' });
  assert.ok(sanitizeUpdate({ profile: 'real' }, cur).errors.length);
  assert.deepStrictEqual(sanitizeUpdate({ profile: 'tehnologic' }, cur).patch, { profile: 'tehnologic' });
  const moved = sanitizeUpdate({ category: 'clasa-12' }, cur);
  assert.deepStrictEqual(moved.errors, []);
  assert.deepStrictEqual(moved.patch, { category: 'clasa-12', subcategory: null, profile: null });
  // dintr-o clasă în BAC cu subcategorie validă
  const toBac = sanitizeUpdate({ category: 'bacalaureat', subcategory: 'teste-antrenament', profile: 'mate-info' }, row());
  assert.deepStrictEqual(toBac.errors, []);
  assert.deepStrictEqual(toBac.patch, { category: 'bacalaureat', subcategory: 'teste-antrenament', profile: 'mate-info' });
});

// ─── ordinea de afișare ──────────────────────────────────────────────────────
test('siteOrder: sort_order mic primul, la egalitate cel mai nou primul (ca pe site)', () => {
  const list = [
    row({ id: 'vechi', sort_order: 0, created_at: '2026-01-01T00:00:00Z' }),
    row({ id: 'nou',   sort_order: 0, created_at: '2026-06-01T00:00:00Z' }),
    row({ id: 'fixat', sort_order: 1, created_at: '2026-07-01T00:00:00Z' }),
    row({ id: 'null',  sort_order: null, created_at: '2026-03-01T00:00:00Z' }),
  ].sort(siteOrder).map((r) => r.id);
  assert.deepStrictEqual(list, ['nou', 'null', 'vechi', 'fixat']);
});

test('planReorder: scrie 1..N în ordinea primită, doar unde se schimbă; id-urile lipsă sunt raportate', () => {
  const rows = [
    { id: 'a', sort_order: 1 }, { id: 'b', sort_order: 2 }, { id: 'c', sort_order: 0 },
  ];
  const plan = planReorder(rows, ['c', 'a', 'b', 'b', 'zz']);
  assert.deepStrictEqual(plan.updates, [{ id: 'c', sort_order: 1 }, { id: 'a', sort_order: 2 }, { id: 'b', sort_order: 3 }]);
  assert.deepStrictEqual(plan.missing, ['zz']);
  assert.strictEqual(plan.total, 3);
  // nimic de schimbat → niciun update
  assert.deepStrictEqual(planReorder(rows, ['a', 'b']).updates, []);
});

test('planSortAll: renumerotează fiecare categorie separat, după dată sau titlu', () => {
  const rows = [
    row({ id: 'c5-vechi', category: 'clasa-5', created_at: '2026-01-01T00:00:00Z', sort_order: 0 }),
    row({ id: 'c5-nou',   category: 'clasa-5', created_at: '2026-06-01T00:00:00Z', sort_order: 0 }),
    row({ id: 'c6-1',     category: 'clasa-6', created_at: '2026-02-01T00:00:00Z', sort_order: 1, title: 'Test 10' }),
    row({ id: 'c6-2',     category: 'clasa-6', created_at: '2026-03-01T00:00:00Z', sort_order: 2, title: 'Test 2' }),
  ];
  // cele mai noi primele
  const desc = planSortAll(rows, { by: 'created_at', dir: 'desc' });
  const pos = (plan, id) => (plan.updates.find((u) => u.id === id) || {}).sort_order;
  assert.strictEqual(pos(desc, 'c5-nou'), 1);
  assert.strictEqual(pos(desc, 'c5-vechi'), 2);
  assert.strictEqual(pos(desc, 'c6-2'), 1);
  assert.strictEqual(pos(desc, 'c6-1'), 2);
  assert.strictEqual(desc.total, 4);
  // cele mai vechi primele: clasa-6 e deja 1,2 → nu se atinge
  const asc = planSortAll(rows, { by: 'created_at', dir: 'asc' });
  assert.deepStrictEqual(asc.updates, [{ id: 'c5-vechi', sort_order: 1 }, { id: 'c5-nou', sort_order: 2 }]);
  // alfabetic, cu numere „naturale": Test 2 < Test 10
  const az = planSortAll(rows, { by: 'title', dir: 'asc' });
  assert.strictEqual(pos(az, 'c6-2'), 1);
  assert.strictEqual(pos(az, 'c6-1'), 2);
  assert.throws(() => planSortAll(rows, { by: 'id' }));
  assert.throws(() => planSortAll(rows, { dir: 'sus' }));
});
