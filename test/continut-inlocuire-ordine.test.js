// Teste pentru Admin → „Tot Conținutul":
//   • „🔁 Înlocuiește" — fișierul nou ia locul celui vechi în ACELAȘI rând
//     (data adăugării, poziția, rezultatele rămân), cheile de corectare ale unui
//     test interactiv se citesc din noul fișier, fișierul vechi se șterge doar
//     când nu-l mai folosește nimeni;
//   • „📥 Materialele noi apar: primele / ultimele" — setarea (site / categorie /
//     rubrică), cheia rubricii (aceeași ca în SQL și în browser) și „mută la
//     sfârșit materialele noi" rămase pe poziția 0.
// Triggerul SQL (supabase/setari_ordine_gratuite.sql) a fost verificat separat
// pe un Postgres real; aici: logica pură + handlerul api/content-admin.js pe un
// Supabase în memorie (test/tools/fakeSupabase.js).
const test = require('node:test');
const assert = require('node:assert');
const CA = require('../api/_lib/contentAdmin');
const http = require('../api/_lib/http');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

let fake = null;
http.admin = () => fake;                 // înainte de require(handler): îl destructurează la încărcare
http.authUser = async () => 'admin-user';
http.requireAdmin = async () => true;
const handler = require('../api/content-admin');

const BASE = 'https://fake.supabase/storage/v1/object/public';
const ID = {
  pdf: '11111111-1111-4111-8111-111111111111',
  test: '22222222-2222-4222-8222-222222222222',
  twin: '33333333-3333-4333-8333-333333333333',
  ext: '44444444-4444-4444-8444-444444444444',
};
const row = (over) => ({
  title: 'Material', description: null, category: 'clasa-5', subcategory: null, profile: null,
  content_type: 'pdf', is_free: true, sort_order: 0, interactive_data: null, created_at: '2026-03-01T08:00:00Z', updated_at: '2026-03-01T08:00:00Z', ...over,
});

function seed() {
  const f = createFakeSupabase({
    content: [
      row({ id: ID.pdf, title: 'EN 2024 Varianta 7', category: 'evaluare-nationala', subcategory: 'variante', is_free: false, sort_order: 4,
        file_url: `${BASE}/content-files/pdf/evaluare-nationala/1700000000000_EN_2024_V7.pdf`, created_at: '2025-11-02T10:00:00Z' }),
      row({ id: ID.test, title: 'Test interactiv 3', category: 'evaluare-nationala', subcategory: 'teste-interactive', content_type: 'interactive', is_free: true, sort_order: 2,
        file_url: `${BASE}/content-files-free/interactive/evaluare-nationala/1700000000001_task_test-3.html`,
        interactive_data: { type: 'test', html: true, ai_generated: true, agent: 'claude', agent_task: 'T1', exercise: { kind: 'grila', questions: [{ answer: 1 }] } } }),
      // același fișier folosit de două materiale (copie făcută de mână)
      row({ id: ID.twin, title: 'Copie', file_url: `${BASE}/content-files/pdf/evaluare-nationala/1700000000000_EN_2024_V7.pdf`, is_free: false }),
      // fișier dintr-un bucket care nu e al materialelor
      row({ id: ID.ext, title: 'Din discuții', file_url: `${BASE}/discussions/rezolvari/1_poza.pdf` }),
    ],
    live_lessons: [{ id: 'ffffffff-0000-4000-8000-000000000001', subject_id: ID.pdf, teacher: 'radu', status: 'gata' }],
  });
  // fișierele existente în Storage
  f.db.files.set('content-files/pdf/evaluare-nationala/1700000000000_EN_2024_V7.pdf', Buffer.from('%PDF-vechi'));
  f.db.files.set('content-files-free/interactive/evaluare-nationala/1700000000001_task_test-3.html', Buffer.from('<html>vechi</html>'));
  f.db.files.set('discussions/rezolvari/1_poza.pdf', Buffer.from('%PDF-discutii'));
  return f;
}
async function call(body) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body }, res);
  return res;
}
const get = (id) => fake.db.tables.content.find((r) => r.id === id);
const upload = (bucket, path, body = 'conținut nou, destul de lung') => fake.db.files.set(`${bucket}/${path}`, Buffer.from(body));

// ═════════════════════════════ logica pură ═════════════════════════════
test('safeFileName / replacementPath: fără diacritice și caractere refuzate de Storage, extensia păstrată', () => {
  assert.strictEqual(CA.safeFileName('Fișă de lucru – Fracții (v2).PDF'), 'Fisa_de_lucru_Fractii_v2.pdf');
  assert.strictEqual(CA.safeFileName('C:\\Users\\Radu\\Desktop\\Test ăîșțâ.html'), 'Test_aista.html');
  assert.strictEqual(CA.safeFileName('.pdf'), 'fisier.pdf');
  assert.strictEqual(CA.safeFileName(''), 'fisier');
  assert.match(CA.safeFileName('a'.repeat(200) + '.pdf'), /^a{80}\.pdf$/);
  assert.strictEqual(CA.replacementPath({ content_type: 'pdf', category: 'clasa-7' }, 'Ecuații.pdf', 123), 'pdf/clasa-7/123_Ecuatii.pdf');
  assert.strictEqual(CA.replacementPath({ content_type: 'interactive', category: 'bacalaureat' }, 'test 1.html', 9), 'interactive/bacalaureat/9_test_1.html');
});

test('checkReplacement: același fel de fișier ca tipul materialului, în folderul materialelor', () => {
  const pdf = { content_type: 'pdf', is_free: false };
  const inter = { content_type: 'interactive', is_free: true };
  assert.deepStrictEqual(CA.checkReplacement(pdf, 'pdf/clasa-5/1_a.pdf'), { ok: true, bucket: 'content-files', ext: 'pdf' });
  assert.deepStrictEqual(CA.checkReplacement(inter, 'interactive/clasa-5/1_a.htm'), { ok: true, bucket: 'content-files-free', ext: 'htm' });
  assert.match(CA.checkReplacement(pdf, 'pdf/clasa-5/1_a.html').error, /trebuie să fie un PDF/);
  assert.match(CA.checkReplacement(inter, 'interactive/clasa-5/1_a.pdf').error, /pagină HTML/);
  assert.match(CA.checkReplacement(pdf, 'pdf/clasa-5/../../agent-formats/x.pdf').error, /invalidă/);
  assert.match(CA.checkReplacement(pdf, 'agent-formats/1_model.pdf').error, /folderul materialelor/);
  assert.match(CA.checkReplacement(pdf, 'pdf/clasa-5/fara-extensie').error, /nu are extensie/);
  assert.strictEqual(CA.checkReplacement(null, 'pdf/a.pdf').ok, false);
});

test('interactiveDataAfterReplace: cheile vechi (exercise) dispar, restul rămâne; fără exercise → nimic de schimbat', () => {
  const d = { type: 'test', html: true, agent: 'claude', agent_task: 'T1', exercise: { kind: 'grila', questions: [] } };
  const out = CA.interactiveDataAfterReplace(d, '2026-10-06T10:00:00.000Z');
  assert.deepStrictEqual(out, { type: 'test', html: true, agent: 'claude', agent_task: 'T1', file_replaced_at: '2026-10-06T10:00:00.000Z' });
  assert.ok(d.exercise, 'obiectul primit nu e modificat');
  assert.strictEqual(CA.interactiveDataAfterReplace({ type: 'exercise', html: true }), null);
  assert.strictEqual(CA.interactiveDataAfterReplace(null), null);
});

test('rubricKey: aceeași regulă ca pe site (clase: categorie+tip; EN: +subcategorie; BAC: +profil, mai puțin la Capitole)', () => {
  assert.strictEqual(CA.rubricKey({ category: 'clasa-5', subcategory: 'x', profile: 'y', content_type: 'pdf' }), 'clasa-5|||pdf');
  assert.strictEqual(CA.rubricKey({ category: 'evaluare-nationala', subcategory: 'teste-interactive', profile: 'mate-info', content_type: 'interactive' }), 'evaluare-nationala|teste-interactive||interactive');
  assert.strictEqual(CA.rubricKey({ category: 'bacalaureat', subcategory: 'variante', profile: 'mate-info', content_type: 'pdf' }), 'bacalaureat|variante|mate-info|pdf');
  assert.strictEqual(CA.rubricKey({ category: 'bacalaureat', subcategory: 'capitole', profile: 'tehnologic', type: 'interactive' }), 'bacalaureat|capitole||interactive');
  assert.strictEqual(CA.rubricKey({ category: 'evaluare-nationala', subcategory: null, content_type: 'pdf' }), 'evaluare-nationala|||pdf');
});

test('setarea „materialele noi": curățată; prioritatea rubrică → categorie → site; schimbarea pe niveluri', () => {
  assert.deepStrictEqual(CA.normalizeNewPosition(null), { site: 'start', categories: {}, rubrics: {} });
  const dirty = { site: 'jos', categories: { 'clasa-5': 'end', 'clasa-99': 'end', 'clasa-6': 'sus' }, rubrics: { 'clasa-5|||pdf': 'start', 'x|y': 'end', 'clasa-99|||pdf': 'end' } };
  assert.deepStrictEqual(CA.normalizeNewPosition(dirty), { site: 'start', categories: { 'clasa-5': 'end' }, rubrics: { 'clasa-5|||pdf': 'start' } });

  const ti = { category: 'evaluare-nationala', subcategory: 'teste-interactive', content_type: 'interactive' };
  let cfg = CA.applyNewPosition(null, { scope: 'site', value: 'end' });
  assert.strictEqual(CA.newPositionFor(cfg, ti), 'end');
  cfg = CA.applyNewPosition(cfg, { scope: 'category', category: 'evaluare-nationala', value: 'start' });
  assert.strictEqual(CA.newPositionFor(cfg, ti), 'start', 'categoria bate site-ul');
  assert.strictEqual(CA.newPositionFor(cfg, { category: 'clasa-5', content_type: 'pdf' }), 'end');
  cfg = CA.applyNewPosition(cfg, { scope: 'rubric', rubric: { ...ti, type: 'interactive' }, value: 'end' });
  assert.strictEqual(CA.newPositionFor(cfg, ti), 'end', 'rubrica bate categoria');
  assert.strictEqual(CA.newPositionFor(cfg, { ...ti, content_type: 'pdf' }), 'start', 'alt tip = altă rubrică');
  // „ca la nivelul de deasupra" = scoate excepția
  cfg = CA.applyNewPosition(cfg, { scope: 'rubric', rubric: 'evaluare-nationala|teste-interactive||interactive', value: null });
  assert.deepStrictEqual(cfg.rubrics, {});
  cfg = CA.applyNewPosition(cfg, { scope: 'category', category: 'evaluare-nationala', value: null });
  assert.deepStrictEqual(cfg, { site: 'end', categories: {}, rubrics: {} });
  assert.throws(() => CA.applyNewPosition(cfg, { scope: 'site', value: 'mijloc' }), /Poziție/);
  assert.throws(() => CA.applyNewPosition(cfg, { scope: 'category', category: 'nu-exista', value: 'end' }), /Categorie/);
  assert.throws(() => CA.applyNewPosition(cfg, { scope: 'rubric', rubric: 'orice', value: 'end' }), /Rubrică/);
  assert.throws(() => CA.applyNewPosition(cfg, { scope: 'tot', value: 'end' }), /Nivel/);
});

test('planMoveNewToEnd: în rubricile ordonate, cele de pe poziția 0 trec la sfârșit, în ordinea adăugării', () => {
  const r = (id, over) => ({ id, category: 'evaluare-nationala', subcategory: 'teste-interactive', profile: null, content_type: 'interactive', ...over });
  const rows = [
    r('a', { sort_order: 1, created_at: '2026-01-01' }),
    r('b', { sort_order: 2, created_at: '2026-02-01' }),
    r('n2', { sort_order: 0, created_at: '2026-10-05' }),
    r('n1', { sort_order: null, created_at: '2026-10-01' }),
    // altă rubrică, doar după dată (toate 0) → neatinsă
    r('x', { content_type: 'pdf', subcategory: 'variante', sort_order: 0, created_at: '2026-01-01' }),
    r('y', { content_type: 'pdf', subcategory: 'variante', sort_order: 0, created_at: '2026-02-01' }),
    // a treia rubrică: ordonată, fără materiale noi → neatinsă
    r('z', { category: 'clasa-5', subcategory: null, content_type: 'pdf', sort_order: 3, created_at: '2026-01-01' }),
  ];
  const plan = CA.planMoveNewToEnd(rows);
  assert.deepStrictEqual(plan, { updates: [{ id: 'n1', sort_order: 3 }, { id: 'n2', sort_order: 4 }], rubrics: 1 });
  assert.deepStrictEqual(CA.planMoveNewToEnd([]), { updates: [], rubrics: 0 });
});

test('browserul folosește aceleași reguli (rubricKey, safeFileName, replacementPath, poziția materialelor noi)', async (t) => {
  const meta = await import('../src/lib/contentMeta.js').catch(() => null);
  if (!meta) return t.skip('Node fără import ESM');
  const samples = [
    { category: 'clasa-5', subcategory: 'x', profile: 'y', content_type: 'pdf' },
    { category: 'evaluare-nationala', subcategory: 'teste-interactive', profile: 'mate-info', content_type: 'interactive' },
    { category: 'bacalaureat', subcategory: 'variante', profile: 'mate-info', content_type: 'pdf' },
    { category: 'bacalaureat', subcategory: 'capitole', profile: 'tehnologic', content_type: 'interactive' },
    { category: 'bacalaureat', subcategory: null, profile: 'tehnologic', content_type: 'pdf' },
  ];
  for (const s of samples) assert.strictEqual(meta.rubricKey(s), CA.rubricKey(s), JSON.stringify(s));
  for (const n of ['Fișă de lucru – Fracții (v2).PDF', 'Test ăîșțâ.html', '.pdf', '', 'a b c.htm']) assert.strictEqual(meta.safeFileName(n), CA.safeFileName(n), n);
  assert.strictEqual(meta.replacementPath({ content_type: 'pdf', category: 'clasa-7' }, 'Ecuații.pdf', 5), CA.replacementPath({ content_type: 'pdf', category: 'clasa-7' }, 'Ecuații.pdf', 5));
  const cfg = { site: 'end', categories: { 'evaluare-nationala': 'start' }, rubrics: { 'evaluare-nationala|teste-interactive||interactive': 'end' } };
  for (const s of samples) assert.strictEqual(meta.newPositionInfo(cfg, s).value, CA.newPositionFor(cfg, s), JSON.stringify(s));
  assert.deepStrictEqual(meta.newPositionInfo(cfg, samples[1]), { value: 'end', from: 'rubric' });
  assert.deepStrictEqual(meta.newPositionInfo(cfg, { category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf' }), { value: 'start', from: 'category' });
  assert.deepStrictEqual(meta.newPositionInfo({}, samples[0]), { value: 'start', from: 'site' });
  assert.deepStrictEqual(meta.replaceKind({ content_type: 'pdf' }).exts, ['pdf']);
  assert.deepStrictEqual(meta.replaceKind({ content_type: 'interactive' }).exts, ['html', 'htm']);
});

// ═════════════════════════════ handlerul ═════════════════════════════
test('replace_file (PDF premium): același rând — data și poziția neschimbate; fișierul vechi rămâne dacă îl mai folosește alt material', async () => {
  fake = seed();
  const path = 'pdf/evaluare-nationala/1790000000000_EN_2024_V7_corectat.pdf';
  upload('content-files', path);
  const before = { ...get(ID.pdf) };
  const r = await call({ action: 'replace_file', id: ID.pdf, path, expectUrl: before.file_url });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const after = get(ID.pdf);
  assert.strictEqual(after.file_url, `${BASE}/content-files/${path}`);
  assert.strictEqual(after.created_at, before.created_at, 'data adăugării rămâne');
  assert.strictEqual(after.sort_order, before.sort_order, 'poziția rămâne');
  assert.strictEqual(after.title, before.title);
  assert.notStrictEqual(after.updated_at, before.updated_at);
  assert.deepStrictEqual(r.body.replaced, { from: 'EN_2024_V7.pdf', to: 'EN_2024_V7_corectat.pdf' });
  assert.strictEqual(r.body.liveLessons, 1, 'subiectul are o lecție de meditație live scrisă pe fișierul vechi');
  // fișierul vechi îl folosește și „Copie" → nu se șterge
  assert.strictEqual(r.body.removedOld, false);
  assert.deepStrictEqual(fake.db.removed, []);
  assert.ok(fake.db.files.has('content-files/pdf/evaluare-nationala/1700000000000_EN_2024_V7.pdf'));
});

test('replace_file (test interactiv): cheile vechi dispar (punctajul din noul HTML), fișierul vechi se șterge', async () => {
  fake = seed();
  const path = 'interactive/evaluare-nationala/1790000000001_test-3-nou.html';
  upload('content-files-free', path, '<html><script>var D=[{"t":"c","a":2,"p":1}];</script></html>');
  const r = await call({ action: 'replace_file', id: ID.test, path, expectUrl: get(ID.test).file_url });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const after = get(ID.test);
  assert.strictEqual(after.file_url, `${BASE}/content-files-free/${path}`);
  assert.strictEqual(after.sort_order, 2);
  assert.strictEqual(after.interactive_data.exercise, undefined);
  assert.strictEqual(after.interactive_data.agent_task, 'T1', 'proveniența rămâne');
  assert.ok(after.interactive_data.file_replaced_at);
  assert.strictEqual(r.body.keysFromNewFile, true);
  assert.strictEqual(r.body.removedOld, true);
  assert.deepStrictEqual(fake.db.removed, ['content-files-free/interactive/evaluare-nationala/1700000000001_task_test-3.html']);
  assert.strictEqual(r.body.liveLessons, 0);
});

test('replace_file: refuzuri — alt tip de fișier, fișierul nu a ajuns în Storage, materialul s-a schimbat între timp', async () => {
  fake = seed();
  const url0 = get(ID.pdf).file_url;
  // un HTML pentru un PDF
  upload('content-files', 'pdf/evaluare-nationala/2_x.html');
  let r = await call({ action: 'replace_file', id: ID.pdf, path: 'pdf/evaluare-nationala/2_x.html' });
  assert.strictEqual(r.statusCode, 400);
  assert.match(r.body.error, /PDF/);
  // calea arată spre un fișier care nu există
  r = await call({ action: 'replace_file', id: ID.pdf, path: 'pdf/evaluare-nationala/3_lipsa.pdf' });
  assert.strictEqual(r.statusCode, 400);
  assert.match(r.body.error, /nu a ajuns în Storage/);
  // browserul vedea alt fișier (ex. o corectură publicată între timp)
  upload('content-files', 'pdf/evaluare-nationala/4_nou.pdf');
  r = await call({ action: 'replace_file', id: ID.pdf, path: 'pdf/evaluare-nationala/4_nou.pdf', expectUrl: `${BASE}/content-files/pdf/altul.pdf` });
  assert.strictEqual(r.statusCode, 409);
  // id invalid / necunoscut
  r = await call({ action: 'replace_file', id: 'nu-e-uuid', path: 'pdf/a.pdf' });
  assert.strictEqual(r.statusCode, 400);
  r = await call({ action: 'replace_file', id: '99999999-9999-4999-8999-999999999999', path: 'pdf/a.pdf' });
  assert.strictEqual(r.statusCode, 404);
  assert.strictEqual(get(ID.pdf).file_url, url0, 'materialul a rămas neatins');
  assert.deepStrictEqual(fake.db.removed, []);
});

test('replace_file: fișierul vechi dintr-un bucket care nu e al materialelor nu se atinge', async () => {
  fake = seed();
  upload('content-files-free', 'pdf/clasa-5/5_nou.pdf');
  const r = await call({ action: 'replace_file', id: ID.ext, path: 'pdf/clasa-5/5_nou.pdf' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.removedOld, false);
  assert.ok(fake.db.files.has('discussions/rezolvari/1_poza.pdf'));
});

test('settings / set_new_position: fără SQL → setup=false și mesaj clar; cu SQL → se salvează curățat', async () => {
  fake = seed();
  fake.db.failTables.add('app_settings');
  let r = await call({ action: 'settings' });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(r.body, { setup: false, newPosition: { site: 'start', categories: {}, rubrics: {} } });
  r = await call({ action: 'set_new_position', scope: 'site', value: 'end' });
  assert.strictEqual(r.statusCode, 503);
  assert.strictEqual(r.body.code, 'SETTINGS_SETUP');
  assert.match(r.body.error, /setari_ordine_gratuite\.sql/);

  fake = seed();
  r = await call({ action: 'settings' });
  assert.deepStrictEqual(r.body, { setup: true, newPosition: { site: 'start', categories: {}, rubrics: {} } });
  r = await call({ action: 'set_new_position', scope: 'rubric', rubric: { category: 'evaluare-nationala', subcategory: 'teste-interactive', profile: 'mate-info', type: 'interactive' }, value: 'end' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  r = await call({ action: 'set_new_position', scope: 'category', category: 'bacalaureat', value: 'end' });
  assert.deepStrictEqual(r.body.newPosition, { site: 'start', categories: { bacalaureat: 'end' }, rubrics: { 'evaluare-nationala|teste-interactive||interactive': 'end' } });
  const stored = fake.db.tables.app_settings.find((x) => x.key === 'content_new_position');
  assert.deepStrictEqual(stored.value, r.body.newPosition, 'triggerul SQL citește exact acest JSON');
  assert.strictEqual(stored.updated_by, 'admin-user');
  r = await call({ action: 'set_new_position', scope: 'category', category: 'bacalaureat', value: '' });
  assert.deepStrictEqual(r.body.newPosition.categories, {}, '„ca pe tot site-ul" = fără excepție');
  r = await call({ action: 'set_new_position', scope: 'site', value: 'sus' });
  assert.strictEqual(r.statusCode, 400);
});

test('move_new_to_end: materialele apărute primele după ordonare trec la sfârșitul rubricii lor', async () => {
  fake = createFakeSupabase({
    content: [
      row({ id: 'a1', category: 'evaluare-nationala', subcategory: 'teste-interactive', content_type: 'interactive', sort_order: 1, created_at: '2026-01-01T00:00:00Z' }),
      row({ id: 'a2', category: 'evaluare-nationala', subcategory: 'teste-interactive', content_type: 'interactive', sort_order: 2, created_at: '2026-02-01T00:00:00Z' }),
      row({ id: 'n1', category: 'evaluare-nationala', subcategory: 'teste-interactive', content_type: 'interactive', sort_order: 0, created_at: '2026-10-01T00:00:00Z' }),
      row({ id: 'p1', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf', sort_order: 5, created_at: '2026-01-01T00:00:00Z' }),
      row({ id: 'p0', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf', sort_order: 0, created_at: '2026-10-02T00:00:00Z' }),
      row({ id: 'c0', category: 'clasa-5', content_type: 'pdf', sort_order: 0, created_at: '2026-10-02T00:00:00Z' }),
      row({ id: 'c1', category: 'clasa-5', content_type: 'pdf', sort_order: 1, created_at: '2026-01-02T00:00:00Z' }),
    ],
  });
  // doar rubrica „Teste interactive"
  let r = await call({ action: 'move_new_to_end', rubric: { category: 'evaluare-nationala', subcategory: 'teste-interactive', type: 'interactive' } });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual({ moved: r.body.moved, rubrics: r.body.rubrics, positions: r.body.positions }, { moved: 1, rubrics: 1, positions: { n1: 3 } });
  assert.strictEqual(fake.db.tables.content.find((x) => x.id === 'p0').sort_order, 0, 'altă rubrică — neatinsă');
  // toată categoria EN
  r = await call({ action: 'move_new_to_end', category: 'evaluare-nationala' });
  assert.deepStrictEqual(r.body.positions, { p0: 6 });
  assert.strictEqual(fake.db.tables.content.find((x) => x.id === 'c0').sort_order, 0, 'altă categorie — neatinsă');
  // tot site-ul
  r = await call({ action: 'move_new_to_end' });
  assert.deepStrictEqual(r.body.positions, { c0: 2 });
  r = await call({ action: 'move_new_to_end', category: 'nu-exista' });
  assert.strictEqual(r.statusCode, 400);
});
