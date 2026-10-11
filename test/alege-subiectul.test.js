// Teste pentru lista „Alege subiectul" a meditațiilor 1-la-1 (Meditații live) — cererea
// lui Radu din 11 oct. 2026: întâi variantele date, apoi modelele, testele de antrenament,
// simulările; la sfârșit „Subiectul I, ex. 1", „Subiectul I, ex. 2"… (la EN și la BAC) —
// exercițiile de pe o poziție, din subiectele oficiale, pe barem (Pregătirea de examen pe
// acea poziție). Titlurile sunt cele reale de pe site (rubricile EN / BAC).
// Pe un Supabase în memorie (test/tools/fakeSupabase.js), fără rețea.
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const L = require('../api/_lib/live');
const P = require('../api/_lib/pregatire');
const pdf = require('../api/ai-pdf-context');
const handler = require('../api/live');

const kind = (title, subcategory = null) => L.subjectKind({ title, subcategory });

// ═════════════════════════════ felul subiectului ═════════════════════════════
test('subjectKind: variante date, modele, teste de antrenament, simulări, fișe pe exerciții — din rubrică + titlu', () => {
  // EN — „Variante Date + Modele" e o singură rubrică
  assert.strictEqual(kind('2025 variantă oficială', 'variante'), 'varianta');
  assert.strictEqual(kind('2026 - varianta 05 rezervă', 'variante'), 'varianta');
  assert.strictEqual(kind('2021 sesiune specială', 'variante'), 'varianta');
  assert.strictEqual(kind('2024 model', 'variante'), 'model');
  assert.strictEqual(kind('2022 model oficial', 'variante'), 'model');
  assert.strictEqual(kind('2021 model 13', 'variante'), 'model');
  assert.strictEqual(kind('2026 simulare Suceava (ianuarie)', 'simulari'), 'simulare');
  assert.strictEqual(kind('Subiectul I - Exercițiul 1', 'exercitii-subiecte'), 'fisa');
  // BAC — modelele stau în rubrica „Simulări"
  assert.strictEqual(kind('2026 mate-info varianta 07', 'variante'), 'varianta');
  assert.strictEqual(kind('2016 Varianta 02', 'variante'), 'varianta');
  assert.strictEqual(kind('2026 - Model', 'simulari'), 'model');
  assert.strictEqual(kind('2014 Model', 'simulari'), 'model');
  assert.strictEqual(kind('2020 Test 09', 'teste-antrenament'), 'test');
  assert.strictEqual(kind('2019 Simulare Clasa a XI-a', 'simulari'), 'simulare');
  assert.strictEqual(kind('2026 - Simulare Națională', 'simulari'), 'simulare');
  assert.strictEqual(kind('SUBIECTUL III, Ex. 2', 'exercitii'), 'fisa');
  // fără rubrică (lista din eligibleSubjects le are, dar titlul ajunge)
  assert.strictEqual(kind('BAC 2024 M1 Mate-Info Varianta 3'), 'varianta');
  assert.strictEqual(kind('2020 Test 09'), 'test');
  assert.strictEqual(kind('Subiectul I, ex. 5: radicali'), 'fisa');
  assert.strictEqual(kind('Recapitulare finală'), 'alt');
});

test('subjectOrder: variante → modele → teste → simulări → fișe; cel mai nou an întâi; oficiala înaintea rezervei, naționala înaintea județenelor', () => {
  const rows = [
    ['2021 simulare oficială', 'simulari'], ['2024 model', 'variante'], ['2026 simulare Bacău', 'simulari'],
    ['Subiectul II - Exercițiul 1', 'exercitii-subiecte'], ['2026 - varianta 05 rezervă', 'variante'], ['2022 model 2', 'variante'],
    ['2026 simulare oficială', 'simulari'], ['Subiectul I - Exercițiul 2', 'exercitii-subiecte'], ['2022 model oficial', 'variante'],
    ['2026 - varianta 01 oficială', 'variante'], ['2021 sesiune specială', 'variante'], ['2021 variantă oficială iunie', 'variante'],
    ['2022 model 10', 'variante'], ['Subiectul I - Exercițiul 1', 'exercitii-subiecte'], ['2020 Test 09', 'teste-antrenament'],
    ['2021 Test 01', 'teste-antrenament'], ['2026 model', 'variante'],
  ].map(([title, subcategory], i) => ({ id: `id-${i}`, title, subcategory }));
  assert.deepStrictEqual(rows.sort(L.subjectOrder).map((r) => r.title), [
    '2026 - varianta 01 oficială', '2026 - varianta 05 rezervă', '2021 variantă oficială iunie', '2021 sesiune specială',
    '2026 model', '2024 model', '2022 model oficial', '2022 model 2', '2022 model 10',
    '2021 Test 01', '2020 Test 09',
    '2026 simulare oficială', '2026 simulare Bacău', '2021 simulare oficială',
    'Subiectul I - Exercițiul 1', 'Subiectul I - Exercițiul 2', 'Subiectul II - Exercițiul 1',
  ]);
  // BAC: modelul din rubrica „Simulări" trece la Modele; Clasa a XI-a după simularea națională
  const bac = [['2019 Simulare Clasa a XI-a', 'simulari'], ['2019 Model', 'simulari'], ['2019 Simulare', 'simulari'], ['2020 Varianta 06', 'variante'], ['2020 Varianta 01', 'variante']]
    .map(([title, subcategory], i) => ({ id: `b-${i}`, title, subcategory }));
  assert.deepStrictEqual(bac.sort(L.subjectOrder).map((r) => r.title), ['2020 Varianta 01', '2020 Varianta 06', '2019 Model', '2019 Simulare', '2019 Simulare Clasa a XI-a']);
  assert.strictEqual(L.yearOfTitle('Simulare 2023-2024'), 2024);
  assert.strictEqual(L.yearOfTitle('Subiectul I - Exercițiul 1'), 0);
});

test('P.targetFor: examenul listei → ținta Pregătirii de examen', () => {
  assert.strictEqual(P.targetFor('en'), 'evaluare-nationala');
  assert.strictEqual(P.targetFor('bac', 'mate-info'), 'bac-mate-info');
  assert.strictEqual(P.targetFor('bac', 'stiinte-naturii'), 'bac-stiinte');
  assert.strictEqual(P.targetFor('bac', 'tehnologic'), 'bac-tehnologic');
  assert.strictEqual(P.targetFor('bac', 'pedagogic'), null);
  assert.strictEqual(P.targetFor('bac'), null);
});

// ═════════════════════════════ handlerul ═════════════════════════════
const U = { elev: '11111111-1111-4111-8111-111111111111', admin: '33333333-3333-4333-8333-333333333333' };
let n = 0;
const nid = () => `aaaaaaaa-0000-4000-8000-${String(++n).padStart(12, '0')}`;
const BAREM_TEXT = 'BAREM DE EVALUARE ȘI DE NOTARE. SUBIECTUL I. Rezultate: 1. b 2. c 3. a. Se punctează orice modalitate corectă de rezolvare.';
function seed() {
  const content = [], ai_pdf_text = [];
  const add = (title, category, subcategory, profile = null, barem = true) => {
    const id = nid();
    content.push({ id, title, category, subcategory, profile, content_type: 'pdf', file_url: `https://x/${id}.pdf`, is_free: true, created_at: '2026-01-01T00:00:00Z' });
    if (barem) ai_pdf_text.push({ content_id: id, barem_status: 'ok', barem: { title: 'Barem' }, barem_text: BAREM_TEXT, text: 'SUBIECTUL I ...' });
    return id;
  };
  const ids = {
    enFisa1: add('Subiectul I - Exercițiul 1', 'evaluare-nationala', 'exercitii-subiecte'),
    enSim: add('2026 simulare Iași', 'evaluare-nationala', 'simulari'),
    enModel: add('2024 model', 'evaluare-nationala', 'variante'),
    enVar: add('2025 variantă oficială', 'evaluare-nationala', 'variante'),
    enVarOld: add('2023 variantă oficială', 'evaluare-nationala', 'variante'),
    enNoBarem: add('2022 variantă oficială 1', 'evaluare-nationala', 'variante', null, false),
    enBarem: add('2025 barem variantă oficială', 'evaluare-nationala', 'bareme'),
    miSim: add('2026 - Simulare Națională', 'bacalaureat', 'simulari', 'mate-info'),
    miModel: add('2026 - Model', 'bacalaureat', 'simulari', 'mate-info'),
    miTest: add('2020 Test 09', 'bacalaureat', 'teste-antrenament', 'mate-info'),
    miVar: add('2025 Varianta 03', 'bacalaureat', 'variante', 'mate-info'),
    miFisa: add('SUBIECTUL I, Ex. 1', 'bacalaureat', 'exercitii', 'mate-info'),
    tehVar: add('2026 tehnologic varianta 02', 'bacalaureat', 'variante', 'tehnologic'),
  };
  return {
    ids,
    db: {
      profiles: [
        { id: U.elev, full_name: 'Ioana Pop', email: 'i@example.com', subscription_status: 'active', role: 'elev', is_admin: false },
        { id: U.admin, full_name: 'Radu Costea', email: 'r@example.com', subscription_status: null, role: 'admin', is_admin: true },
      ],
      content, ai_pdf_text, live_lessons: [],
      app_settings: [{ key: 'live_free_lessons', value: { subjects: [] } }],   // fără meditații gratuite aici
    },
  };
}

let fake = null;
ai.admin = () => fake;
ai.authUser = async (req) => { const u = req.headers['x-user']; if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; } return u; };
ai.logUsage = async () => {};
pdf.getPdfContext = async () => ({ text: 'SUBIECTUL I', baremText: BAREM_TEXT, baremStatus: 'ok' });
pdf.downloadContentPdf = async () => { throw new Error('fără rețea în teste'); };
delete process.env.SUPABASE_URL; delete process.env.VITE_SUPABASE_URL;
test.beforeEach(() => handler._internals.resetCaches());

async function call(action, body = {}, user = U.elev) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: user ? { 'x-user': user } : {}, query: {}, body: { action, ...body } }, res);
  return res;
}

test('private_subjects (EN): variantele întâi, apoi modelele și simulările; fișa „Subiectul I - Exercițiul 1" nu, iar la sfârșit pozițiile S. I–III', async () => {
  const s = seed();
  fake = createFakeSupabase(s.db);
  const r = await call('private_subjects', { exam: 'en', teacher: 'radu' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.subjects.map((x) => [x.title, x.kind]), [
    ['2025 variantă oficială', 'varianta'], ['2023 variantă oficială', 'varianta'], ['2024 model', 'model'], ['2026 simulare Iași', 'simulare'],
  ], 'fără subiectul fără barem, fără barem, fără fișă');
  assert.deepStrictEqual(r.body.kinds.map((k) => k.id), ['varianta', 'model', 'test', 'simulare', 'alt']);
  assert.strictEqual(r.body.prep.target, 'evaluare-nationala');
  assert.strictEqual(r.body.prep.exercises, 10);
  assert.strictEqual(r.body.prep.positions.length, 18);
  assert.deepStrictEqual(r.body.prep.positions.slice(0, 2).map((p) => [p.pos, p.label]), [['I.1', 'Subiectul I, exercițiul 1'], ['I.2', 'Subiectul I, exercițiul 2']]);
  assert.strictEqual(r.body.prep.positions[17].label, 'Subiectul al III-lea, exercițiul 6');
});

test('private_subjects (BAC Mate-Info): variante → modele → teste de antrenament → simulări; la sfârșit S. I ex. 1–6, S. II ex. 1–2, S. III ex. 1–2', async () => {
  const s = seed();
  fake = createFakeSupabase(s.db);
  const r = await call('private_subjects', { exam: 'bac', profile: 'mate-info', teacher: 'radu' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.subjects.map((x) => x.title), ['2025 Varianta 03', '2026 - Model', '2020 Test 09', '2026 - Simulare Națională']);
  assert.ok(r.body.subjects.every((x) => x.profile === 'mate-info'), 'doar profilul ales');
  assert.strictEqual(r.body.prep.target, 'bac-mate-info');
  assert.deepStrictEqual(r.body.prep.positions.map((p) => p.pos), ['I.1', 'I.2', 'I.3', 'I.4', 'I.5', 'I.6', 'II.1', 'II.2', 'III.1', 'III.2']);
  const teh = await call('private_subjects', { exam: 'bac', profile: 'tehnologic', teacher: 'radu' });
  assert.strictEqual(teh.body.prep.target, 'bac-tehnologic');
  assert.deepStrictEqual(teh.body.subjects.map((x) => x.title), ['2026 tehnologic varianta 02']);
});

test('Admin: subiectele sălilor vin în aceeași ordine (variante întâi), fiecare cu felul lui', async () => {
  const s = seed();
  fake = createFakeSupabase(s.db);
  const ov = await call('admin_overview', {}, U.admin);
  assert.strictEqual(ov.statusCode, 200, JSON.stringify(ov.body));
  assert.deepStrictEqual(ov.body.subjects.en.map((x) => x.kind), ['varianta', 'varianta', 'model', 'simulare', 'fisa']);
  assert.deepStrictEqual(ov.body.subjects.bac.filter((x) => x.profile === 'mate-info').map((x) => x.kind), ['varianta', 'model', 'test', 'simulare', 'fisa']);
  // din ce poate alege meditațiile gratuite: fără fișe; „gata" = cu lecție
  const en = ov.body.free.slots.find((x) => x.type === 'en');
  assert.deepStrictEqual(en.options.map((o) => o.title), ['2025 variantă oficială', '2023 variantă oficială', '2024 model', '2026 simulare Iași']);
  assert.ok(en.options.every((o) => o.ready === false));
});
