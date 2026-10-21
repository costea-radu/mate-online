// Teste pentru MEDITAȚIILE GRATUITE (meditații live cu profesorul virtual): CÂTE UNA PE
// FIECARE EXAMEN (EN, BAC Mate-Info, BAC Științele Naturii, BAC Tehnologic — cererea lui
// Radu din 11 oct. 2026; până atunci, două: una de EN, una de BAC), alese automat până le
// alege adminul; se fac 1-la-1 fără plată și fără abonament, de oricine are cont; ședința
// de grup cu un astfel de subiect e și ea gratuită; plafonul lunar și cel al întrebărilor
// din chat; adminul schimbă meditația fiecărui examen (Admin → 🎥 Meditații live → 🎁).
// Pe un Supabase în memorie (test/tools/fakeSupabase.js), fără rețea.
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const L = require('../api/_lib/live');
const LL = require('../api/_lib/liveLesson');
const pdf = require('../api/ai-pdf-context');
const handler = require('../api/live');

const U = {
  free: '11111111-1111-4111-8111-111111111111',
  prem: '22222222-2222-4222-8222-222222222222',
  admin: '33333333-3333-4333-8333-333333333333',
};
const C = {
  en1: 'aaaaaaaa-0000-4000-8000-000000000001',
  en2: 'aaaaaaaa-0000-4000-8000-000000000002',
  en3: 'aaaaaaaa-0000-4000-8000-000000000003',
  enFisa: 'aaaaaaaa-0000-4000-8000-000000000005',
  baremEn: 'aaaaaaaa-0000-4000-8000-0000000000b1',
  bac1: 'bbbbbbbb-0000-4000-8000-000000000001',
  bac2: 'bbbbbbbb-0000-4000-8000-000000000002',
  teh1: 'bbbbbbbb-0000-4000-8000-000000000003',
  teh2: 'bbbbbbbb-0000-4000-8000-000000000004',
  enNoBarem: 'aaaaaaaa-0000-4000-8000-000000000006',
  cls: 'cccccccc-0000-4000-8000-000000000009',
};
const BAREM_TEXT = 'BAREM DE EVALUARE ȘI DE NOTARE. SUBIECTUL I. Rezultate: 1. b 2. c 3. a. Se punctează orice modalitate corectă de rezolvare.';
const content = (id, title, category, extra = {}) => ({ id, title, category, subcategory: null, profile: null, content_type: 'pdf', file_url: `https://x/${id}.pdf`, is_free: true, created_at: '2026-01-01T00:00:00Z', ...extra });
const pdfRow = (id, status = 'ok') => ({ content_id: id, barem_status: status, barem: { title: 'Barem' }, barem_text: BAREM_TEXT, text: 'SUBIECTUL I ...' });

const seg = (say, board = []) => ({ say, board });
function rawItem(ref, answer = 'b') {
  return {
    ref, title: `Subiectul I, exercițiul ${ref.split('.')[1]}`, kind: 'grila', statement: 'Rezultatul calculului $2+3\\cdot 4$ este:',
    options: ['20', '14', '24', '9'], answer, points: 5, barem: `${answer}. 5p`,
    intro: [seg('Trecem la exercițiul următor.')],
    tryPoll: { type: 'grila', question: 'Rezultatul calculului?', options: ['20', '14', '24', '9'], answer, explain: 'Înmulțirea se face întâi.' },
    afterTry: [seg('Să vedem cum ați răspuns.')],
    modes: { barem: [seg('Întâi înmulțirea, apoi adunarea.', ['$3\\cdot 4 = 12$', '$2 + 12 = 14$'])], intuitiv: [seg('Înmulțirea leagă mai tare.')], greseli: [], alta_metoda: null },
    check: null, afterCheck: [],
  };
}
function lessonScript(title = 'EN 2024 Varianta 7', exam = 'en') {
  const radu = L.teacherById('radu');
  const BAREM = 'SUBIECTUL I (30 de puncte)\nNr. item 1. 2.\nRezultate b. b.\nPunctaj 5p 5p\n';
  const items = LL.normalizeItems([rawItem('I.1'), rawItem('I.2')], { section: 'I', exam, grile: { I: { 1: 'b', 2: 'b' } }, baremText: BAREM });
  return LL.assignIds({ title, exam, pasi: LL.PASI_V, v: 2, teacher: 'radu', teacherName: radu.name, ...LL.templates(radu, { title, exam }), items });
}
let lid = 0;
function lesson(subjectId, { title, exam = 'en', profile = null, status = 'gata', noVoice = false, steps = true, version = 1, updated = '2026-09-01T00:00:00Z' } = {}) {
  const script = lessonScript(title, exam);
  if (!steps) delete script.pasi;
  lid += 1;
  return {
    id: `dddddddd-0000-4000-8000-${String(lid).padStart(12, '0')}`, subject_id: subjectId, teacher: 'radu', version, status, title, exam, profile, script,
    progress: { audio: {}, noVoice, total: LL.segmentsInOrder(script).length, done: 0 }, cost_micro: 0, created_at: updated, updated_at: updated,
  };
}

function seed(extra = {}) {
  return {
    profiles: [
      { id: U.free, full_name: 'Ioana Popescu', email: 'ioana@example.com', subscription_status: null, role: 'elev', is_admin: false },
      { id: U.prem, full_name: 'Andrei Ionescu', email: 'andrei@example.com', subscription_status: 'active', role: 'elev', is_admin: false },
      { id: U.admin, full_name: 'Radu Costea', email: 'radu@example.com', subscription_status: null, role: 'admin', is_admin: true },
    ],
    content: [
      content(C.en1, 'EN 2024 Varianta 7', 'evaluare-nationala', { subcategory: 'variante' }),
      content(C.en2, 'EN 2023 Varianta 2', 'evaluare-nationala', { subcategory: 'variante' }),
      content(C.en3, 'EN 2022 Model', 'evaluare-nationala', { subcategory: 'variante' }),
      content(C.enFisa, 'Subiectul I, ex. 5: radicali', 'evaluare-nationala', { subcategory: 'exercitii-subiecte' }),
      content(C.baremEn, 'Barem EN 2024 Varianta 7', 'evaluare-nationala', { subcategory: 'bareme' }),
      content(C.bac1, 'BAC 2024 M1 Mate-Info Varianta 3', 'bacalaureat', { profile: 'mate-info', subcategory: 'variante' }),
      content(C.bac2, 'BAC 2023 M2 Științe ale naturii Varianta 5', 'bacalaureat', { profile: 'stiinte-naturii', subcategory: 'variante' }),
      // BAC Tehnologic: subiecte cu barem, dar nicio lecție gata încă
      content(C.teh1, 'BAC 2021 Tehnologic Model', 'bacalaureat', { profile: 'tehnologic', subcategory: 'simulari' }),
      content(C.teh2, 'BAC 2022 Tehnologic Varianta 4', 'bacalaureat', { profile: 'tehnologic', subcategory: 'variante' }),
      content(C.enNoBarem, 'EN 2021 Varianta 9', 'evaluare-nationala', { subcategory: 'variante' }),
      content(C.cls, 'Fracții', 'clasa-5'),
    ],
    ai_pdf_text: [pdfRow(C.en1), pdfRow(C.en2), pdfRow(C.en3), pdfRow(C.enFisa), pdfRow(C.bac1), pdfRow(C.bac2), pdfRow(C.teh1), pdfRow(C.teh2)],
    live_lessons: [
      lesson(C.en1, { title: 'EN 2024 Varianta 7' }),
      lesson(C.en3, { title: 'EN 2022 Model', noVoice: true, steps: false }),
      lesson(C.enFisa, { title: 'Subiectul I, ex. 5: radicali' }),
      lesson(C.bac2, { title: 'BAC 2023 M2 Științe ale naturii Varianta 5', exam: 'bac', profile: 'stiinte-naturii' }),
      lesson(C.bac1, { title: 'BAC 2024 M1 Mate-Info Varianta 3', exam: 'bac', profile: 'mate-info' }),
    ],
    ...extra,
  };
}
const FREE_SET = (ids) => ({ app_settings: [{ key: 'live_free_lessons', value: { subjects: ids, auto: false } }] });

// ─── înlocuirile (fără rețea) ─────────────────────────────────────────────────
let fake = null;
const calls = { chat: 0 };
ai.admin = () => fake;
ai.authUser = async (req) => {
  const u = req.headers['x-user'];
  if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; }
  return u;
};
ai.logUsage = async () => {};
ai.chatJson = async () => { calls.chat++; return { data: { say: 'Pentru că înmulțirea se face înaintea adunării.', text: 'Înmulțirea se face înaintea adunării.', board: [] }, usage: { model: 'test', input_tokens: 10, output_tokens: 10 } }; };
LL.generateScript = async () => ({ script: lessonScript(), usage: { model: 'test', input_tokens: 1, output_tokens: 1 } });
pdf.getPdfContext = async () => ({ text: 'SUBIECTUL I', baremText: BAREM_TEXT, baremStatus: 'ok' });
pdf.downloadContentPdf = async () => { throw new Error('fără rețea în teste'); };
delete process.env.AZURE_SPEECH_KEY; delete process.env.OPENAI_API_KEY; delete process.env.LIVE_TTS_API_KEY;
delete process.env.SUPABASE_URL; delete process.env.VITE_SUPABASE_URL;

test.beforeEach(() => { handler._internals.resetCaches(); delete process.env.LIVE_GRATUIT_LUNA; delete process.env.LIVE_GRATUIT_INTREBARI; });

async function call(action, body = {}, user = null) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: user ? { 'x-user': user } : {}, query: {}, body: { action, ...body } }, res);
  return res;
}
const iso = (ms) => new Date(ms).toISOString();

// ═════════════════════════════ logica pură ═════════════════════════════
test('freeAccess / groupAccess: gratuit pentru oricine are cont, cu plafon lunar; abonatul și adminul rămân pe drumul lor', () => {
  const free = { id: U.free, subscription_status: null };
  const prem = { id: U.prem, subscription_status: 'active' };
  const admin = { id: U.admin, is_admin: true };
  assert.deepStrictEqual(L.freeAccess({ profile: free, free: true, freeUsed: 1 }), { ok: true, via: 'gratuit', price: 0, free: true, freeLeft: 3, freeMonthly: 4 });
  assert.deepStrictEqual(L.freeAccess({ profile: free, free: true, freeUsed: 4 }), { ok: false, via: null, free: true, freeLeft: 0, freeMonthly: 4 });
  assert.strictEqual(L.freeAccess({ profile: free, free: false }).ok, false);
  assert.strictEqual(L.freeAccess({ profile: null, free: true }).ok, false, 'fără cont nu se poate');
  process.env.LIVE_GRATUIT_LUNA = '1';
  assert.strictEqual(L.freeAccess({ profile: free, free: true, freeUsed: 1 }).ok, false);
  delete process.env.LIVE_GRATUIT_LUNA;
  assert.deepStrictEqual(L.groupAccess({ profile: free, free: true }), { ok: true, via: 'gratuit', price: 0, free: true });
  assert.deepStrictEqual(L.groupAccess({ profile: null, free: true }), { ok: false, via: null, price: 0, free: true }, 'fără cont: „Gratuit · intră în cont"');
  assert.strictEqual(L.groupAccess({ profile: prem, free: true }).via, 'abonament');
  assert.strictEqual(L.groupAccess({ profile: admin, free: true }).via, 'admin');
  assert.deepStrictEqual(L.groupAccess({ profile: free }), { ok: false, via: null, price: 20 });
});

test('normalizeFreeIds: UUID-uri unice, litere mici, cel mult 12', () => {
  assert.deepStrictEqual(L.normalizeFreeIds([C.en1, C.en1.toUpperCase(), 'x', null, C.bac1]), [C.en1, C.bac1]);
  const many = Array.from({ length: 20 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`);
  assert.strictEqual(L.normalizeFreeIds(many).length, L.FREE_MAX);
  assert.deepStrictEqual(L.normalizeFreeIds('nu-e-listă'), []);
});

test('pickFreeLessons: câte o lecție pe examen (EN, Mate-Info, Șt. Naturii, Tehnologic), cea mai potrivită pentru o primă încercare', () => {
  const rows = seed().live_lessons.map((l) => ({ ...l, pasi: l.script.pasi, sv: l.script.v, noVoice: l.progress.noVoice }));
  const pick = L.pickFreeLessons(rows).map((l) => l.subject_id);
  // EN: varianta completă cu întrebări pe pași și voce (nu fișa „Subiectul I, ex. 5", nu modelul fără pași/voce);
  // BAC: câte una pe profil, în ordinea examenelor; Tehnologic n-are nicio lecție gata → lipsește
  assert.deepStrictEqual(pick, [C.en1, C.bac1, C.bac2]);
  assert.deepStrictEqual(L.pickFreeLessons(rows, { types: ['stiinte-naturii'] }).map((l) => l.subject_id), [C.bac2]);
  // doar lecțiile gata; ultima versiune; la calitate egală, ordinea listelor (variantele întâi, anul cel mai nou)
  assert.deepStrictEqual(L.pickFreeLessons([{ ...rows[0], status: 'script' }]), []);
  const twoEn = [{ ...rows[0], subject_id: 'x1', title: 'EN 2023 model' }, { ...rows[0], subject_id: 'x2', title: 'EN 2022 Varianta 1' }];
  assert.deepStrictEqual(L.pickFreeLessons(twoEn).map((l) => l.subject_id), ['x2']);
  assert.deepStrictEqual(L.FREE_TYPE_IDS, ['en', 'mate-info', 'stiinte-naturii', 'tehnologic']);
  assert.strictEqual(L.freeTypeOf({ exam: 'bac', profile: 'pedagogic' }), null);
});

test('pickFreeSubject (examen fără nicio lecție gata): cel mai bun subiect cu barem — complet, nu o fișă; varianta înaintea modelului', () => {
  const subs = [
    { id: 'm', title: '2025 - Model', subcategory: 'simulari' },
    { id: 'f', title: 'SUBIECTUL I, Ex. 1', subcategory: 'exercitii' },
    { id: 'v', title: '2022 Varianta 04', subcategory: 'variante' },
  ];
  assert.strictEqual(L.pickFreeSubject(subs).id, 'v');
  assert.strictEqual(L.pickFreeSubject([subs[1]]), null);
  assert.strictEqual(L.pickFreeSubject([]), null);
});

test('freeSlotsFrom: formatul nou (câte una pe examen), formatul vechi (o listă) și lista golită de admin', () => {
  // nou: un examen lipsă = automat; null = adminul a scos-o
  const v2 = L.freeSlotsFrom({ v: 2, slots: { en: C.en1.toUpperCase(), 'mate-info': null, tehnologic: 'nu-e-uuid' }, auto: ['en', 'mate-info'] });
  assert.deepStrictEqual(v2.slots, { en: C.en1, 'mate-info': null });
  assert.deepStrictEqual([...v2.auto], ['en']);
  // vechi: prima lecție a fiecărui examen; restul examenelor rămân automate
  const typeOf = (id) => ({ [C.en1]: 'en', [C.en2]: 'en', [C.bac1]: 'mate-info' }[id] || null);
  const old = L.freeSlotsFrom({ subjects: [C.bac1, C.en1, C.en2, C.cls], auto: false }, typeOf);
  assert.deepStrictEqual(old.slots, { 'mate-info': C.bac1, en: C.en1 });
  assert.strictEqual(old.auto.size, 0);
  assert.deepStrictEqual([...L.freeSlotsFrom({ subjects: [C.en1], auto: true }, typeOf).auto], ['en']);
  // lista golită de admin: nicio meditație gratuită, la niciun examen (nu revine alegerea automată)
  assert.deepStrictEqual(L.freeSlotsFrom({ subjects: [] }).slots, { en: null, 'mate-info': null, 'stiinte-naturii': null, tehnologic: null });
  assert.deepStrictEqual(L.freeSlotsFrom(null).slots, {});
  // de salvat: în ordinea examenelor, cu lista `subjects` și pentru versiunile vechi ale serverului
  const val = L.freeValue({ tehnologic: C.teh2, en: C.en1, 'mate-info': null }, new Set(['tehnologic', 'mate-info']));
  assert.deepStrictEqual(val, { v: 2, slots: { en: C.en1, 'mate-info': null, tehnologic: C.teh2 }, auto: ['tehnologic'], subjects: [C.en1, C.teh2] });
});

// ═════════════════════════════ handlerul ═════════════════════════════
test('alegerea automată: câte una pe examen (lecțiile gata; Tehnologic, fără niciuna gata → varianta cu barem), salvată o dată; lobby-ul le arată', async () => {
  fake = createFakeSupabase(seed());
  const p = await call('program');
  assert.strictEqual(p.statusCode, 200, JSON.stringify(p.body));
  assert.deepStrictEqual(p.body.freeLessons.map((f) => [f.subjectId, f.examLabel, f.type, f.ready]), [
    [C.en1, 'Evaluarea Națională', 'en', true], [C.bac1, 'BAC Mate-Info', 'mate-info', true],
    [C.bac2, 'BAC Științele Naturii', 'stiinte-naturii', true], [C.teh2, 'BAC Tehnologic', 'tehnologic', false],
  ]);
  assert.strictEqual(p.body.prices.gratuiteLuna, 4);
  const saved = fake.db.tables.app_settings.find((r) => r.key === 'live_free_lessons');
  assert.deepStrictEqual(saved.value.slots, { en: C.en1, 'mate-info': C.bac1, 'stiinte-naturii': C.bac2, tehnologic: C.teh2 });
  assert.deepStrictEqual(saved.value.auto, ['en', 'mate-info', 'stiinte-naturii', 'tehnologic']);
  assert.deepStrictEqual(saved.value.subjects, [C.en1, C.bac1, C.bac2, C.teh2]);
  // o lecție nouă, „mai bună", nu schimbă alegerea (rămâne stabilă până o schimbă adminul)
  fake.db.tables.live_lessons.push(lesson(C.en2, { title: 'EN 2023 Varianta 2', updated: '2026-10-01T00:00:00Z' }));
  handler._internals.resetFree();
  const again = await call('program', {}, U.free);
  assert.deepStrictEqual(again.body.freeLessons.map((f) => f.subjectId), [C.en1, C.bac1, C.bac2, C.teh2]);
  assert.deepStrictEqual(again.body.me.free, { monthly: 4, used: 0, left: 4 });
  // ședințele de grup cu un subiect gratuit: „Gratuit" (fără cont: intră în cont)
  const freeIds = [C.en1, C.bac1, C.bac2, C.teh2];
  for (const s of p.body.days.flatMap((d) => d.sessions)) {
    const isFree = !!s.subject && freeIds.includes(s.subject.id);
    assert.strictEqual(s.free, isFree);
    assert.strictEqual(s.access.price, isFree ? 0 : 20);
  }
  // 1-la-1 pe meditația gratuită de Tehnologic (lecția se scrie la prima folosire): gratuit
  const st = await call('private_start', { teacher: 'radu', subjectId: C.teh2 }, U.free);
  assert.strictEqual(st.statusCode, 200, JSON.stringify(st.body));
  assert.strictEqual(st.body.via, 'gratuit');
});

test('formatul vechi (o listă, alese de admin): rămâne prima lecție a fiecărui examen, restul examenelor se completează automat, o singură dată', async () => {
  fake = createFakeSupabase(seed({ app_settings: [{ key: 'live_free_lessons', value: { subjects: [C.bac1, C.en3, C.en1], auto: false }, updated_at: '2026-10-06T10:00:00.000Z' }] }));
  const p = await call('program');
  assert.deepStrictEqual(p.body.freeLessons.map((f) => f.subjectId), [C.en3, C.bac1, C.bac2, C.teh2], 'EN: prima din listă (en3), nu și en1');
  const saved = fake.db.tables.app_settings.find((r) => r.key === 'live_free_lessons');
  assert.strictEqual(saved.value.v, 2);
  assert.deepStrictEqual(saved.value.slots, { en: C.en3, 'mate-info': C.bac1, 'stiinte-naturii': C.bac2, tehnologic: C.teh2 });
  assert.deepStrictEqual(saved.value.auto, ['stiinte-naturii', 'tehnologic'], 'alese de admin: EN și Mate-Info');
  const ov = await call('admin_overview', {}, U.admin);
  assert.deepStrictEqual(ov.body.free.slots.map((x) => [x.type, x.lesson?.subjectId, x.auto]), [
    ['en', C.en3, false], ['mate-info', C.bac1, false], ['stiinte-naturii', C.bac2, true], ['tehnologic', C.teh2, true],
  ]);
  // lista golită de admin (formatul vechi) → nicio meditație gratuită
  fake = createFakeSupabase(seed({ app_settings: [{ key: 'live_free_lessons', value: { subjects: [], auto: false } }] }));
  handler._internals.resetCaches();
  assert.deepStrictEqual((await call('program')).body.freeLessons, []);
});

test('alegerea automată nu suprascrie o alegere făcută între timp din Admin (scrie doar peste rândul citit)', async () => {
  const S = require('../api/_lib/settings');
  fake = createFakeSupabase({ app_settings: [{ key: 'k', value: { a: 1 }, updated_at: '2026-10-11T10:00:00.000Z' }] });
  assert.strictEqual(await S.updateSettingIf(fake, 'k', { a: 2 }, '2026-10-11T09:00:00.000Z'), false);
  assert.deepStrictEqual(fake.db.tables.app_settings[0].value, { a: 1 });
  assert.strictEqual(await S.updateSettingIf(fake, 'k', { a: 3 }, '2026-10-11T10:00:00.000Z'), true);
  assert.deepStrictEqual(fake.db.tables.app_settings[0].value, { a: 3 });
});

test('fără SQL-ul setărilor: tot cele alese automat (calculate la cerere); adminul primește mesajul de instalare', async () => {
  fake = createFakeSupabase(seed());
  fake.db.failTables.add('app_settings');
  const p = await call('program');
  assert.deepStrictEqual(p.body.freeLessons.map((f) => f.subjectId), [C.en1, C.bac1, C.bac2, C.teh2]);
  const ov = await call('admin_overview', {}, U.admin);
  assert.strictEqual(ov.statusCode, 200, JSON.stringify(ov.body));
  assert.strictEqual(ov.body.free.setup, false);
  assert.strictEqual(ov.body.free.auto, true);
  const set = await call('admin_set_free', { type: 'en', subjectId: C.en2 }, U.admin);
  assert.strictEqual(set.statusCode, 503);
  assert.match(set.body.error, /setari_ordine_gratuite\.sql/);
  // elevul tot poate porni gratuit
  const st = await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.free);
  assert.strictEqual(st.statusCode, 200, JSON.stringify(st.body));
  assert.strictEqual(st.body.via, 'gratuit');
});

test('1-la-1 gratuit: fără abonament și fără plată; nu consumă ședințele incluse; plafonul lunar', async () => {
  process.env.LIVE_GRATUIT_LUNA = '2';
  fake = createFakeSupabase(seed({ ...FREE_SET([C.en1, C.bac1]), live_lessons: [...seed().live_lessons, lesson(C.en2, { title: 'EN 2023 Varianta 2' })] }));
  const subj = await call('private_subjects', { exam: 'en' }, U.free);
  assert.strictEqual(subj.statusCode, 200);
  assert.strictEqual(subj.body.subjects[0].id, C.en1, 'varianta cea mai nouă e prima în listă (și e meditația gratuită)');
  assert.strictEqual(subj.body.subjects[0].free, true);
  assert.ok(subj.body.subjects.filter((s) => s.id !== C.en1).every((s) => !s.free));
  assert.strictEqual(subj.body.freeAccess.ok, true);
  assert.strictEqual(subj.body.access.ok, false, 'fără gratuite, ar plăti');

  const st = await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.free);
  assert.strictEqual(st.statusCode, 200, JSON.stringify(st.body));
  assert.strictEqual(st.body.via, 'gratuit');
  const join = await call('join', { sessionId: st.body.sessionId }, U.free);
  assert.strictEqual(join.statusCode, 200, JSON.stringify(join.body));
  assert.strictEqual(join.body.session.free, true, 'sala știe că e o meditație gratuită');
  assert.ok(join.body.timeline);
  const begin = await call('private_begin', { sessionId: st.body.sessionId }, U.free);
  assert.strictEqual(begin.statusCode, 200, JSON.stringify(begin.body));
  assert.strictEqual(begin.body.via, 'gratuit');
  let prog = (await call('program', {}, U.free)).body;
  assert.deepStrictEqual(prog.me.free, { monthly: 2, used: 1, left: 1 });
  // un subiect care NU e gratuit → plata obișnuită
  const paid = await call('private_start', { teacher: 'radu', subjectId: C.en2 }, U.free);
  assert.strictEqual(paid.statusCode, 402);
  assert.strictEqual(paid.body.price, 30);
  // a doua meditație gratuită
  const st2 = await call('private_start', { teacher: 'radu', subjectId: C.bac1 }, U.free);
  assert.strictEqual(st2.body.via, 'gratuit');
  await call('private_begin', { sessionId: st2.body.sessionId }, U.free);
  prog = (await call('program', {}, U.free)).body;
  assert.strictEqual(prog.me.free.left, 0);
  // plafonul lunar: încă una gratuită → plata (cu explicația)
  await call('leave', { sessionId: st.body.sessionId, end: true }, U.free);
  const third = await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.free);
  assert.strictEqual(third.statusCode, 402);
  assert.match(third.body.error, /cele 2 meditații gratuite/);

  // abonatul: meditația gratuită nu-i consumă din cele 8 incluse
  const p1 = await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.prem);
  assert.strictEqual(p1.body.via, 'gratuit');
  await call('private_begin', { sessionId: p1.body.sessionId }, U.prem);
  prog = (await call('program', {}, U.prem)).body;
  assert.strictEqual(prog.me.private.includedLeft, 8);
  assert.strictEqual(prog.me.free.used, 1);
});

test('ședința de grup cu un subiect gratuit: elevul fără abonament intră fără bilet', async () => {
  const today = L.dayKey(new Date());
  const mk = (id, slot, subject) => ({ id, kind: 'grup', day: today, slot, teacher: 'radu', exam: 'en', profile: null, subject_id: subject, starts_at: iso(Date.now() + 5 * 60000), ends_at: iso(Date.now() + 125 * 60000), status: 'programata', state: {}, created_at: iso(Date.now() - 86400000), updated_at: iso(Date.now() - 86400000) });
  const sFree = mk('eeeeeeee-0000-4000-8000-000000000001', '17-en', C.en1);
  const sPaid = mk('eeeeeeee-0000-4000-8000-000000000002', '19-en', C.en3);
  fake = createFakeSupabase(seed({ ...FREE_SET([C.en1]), live_sessions: [sFree, sPaid] }));
  const r = await call('join', { sessionId: sFree.id }, U.free);
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.access, 'gratuit');
  assert.strictEqual(r.body.session.free, true);
  const r2 = await call('join', { sessionId: sPaid.id }, U.free);
  assert.strictEqual(r2.statusCode, 402);
  assert.strictEqual(r2.body.price, 20);
  const prem = await call('join', { sessionId: sFree.id }, U.prem);
  assert.strictEqual(prem.body.access, 'abonament');
});

test('chatul într-o meditație gratuită: profesorul răspunde la cel mult LIVE_GRATUIT_INTREBARI întrebări', async () => {
  process.env.LIVE_GRATUIT_INTREBARI = '1';
  fake = createFakeSupabase(seed(FREE_SET([C.en1])));
  const st = await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.free);
  await call('join', { sessionId: st.body.sessionId }, U.free);
  await call('private_begin', { sessionId: st.body.sessionId }, U.free);
  const before = calls.chat;
  const q1 = await call('chat', { sessionId: st.body.sessionId, text: 'De ce se face întâi înmulțirea?' }, U.free);
  assert.strictEqual(q1.statusCode, 200, JSON.stringify(q1.body));
  assert.strictEqual(q1.body.answer.role, 'profesor');
  fake.db.tables.live_messages.forEach((m) => { m.created_at = iso(Date.now() - 60000); });   // fără „mai încet"
  const q2 = await call('chat', { sessionId: st.body.sessionId, text: 'Și dacă erau paranteze?' }, U.free);
  assert.strictEqual(q2.statusCode, 200, JSON.stringify(q2.body));
  assert.strictEqual(q2.body.answer.role, 'sistem');
  assert.match(q2.body.answer.text, /meditațiile gratuite/);
  assert.strictEqual(calls.chat - before, 1, 'un singur apel la model');
  // ședința plătită / inclusă: fără plafonul acesta
  const p = await call('private_start', { teacher: 'radu', subjectId: C.en3 }, U.prem);
  assert.strictEqual(p.body.via, 'inclus');
  await call('private_begin', { sessionId: p.body.sessionId }, U.prem);
  await call('chat', { sessionId: p.body.sessionId, text: 'Prima întrebare?' }, U.prem);
  fake.db.tables.live_messages.forEach((m) => { m.created_at = iso(Date.now() - 60000); });
  const p2 = await call('chat', { sessionId: p.body.sessionId, text: 'A doua întrebare?' }, U.prem);
  assert.strictEqual(p2.body.answer.role, 'profesor');
});

test('adminul alege meditația gratuită a fiecărui examen; una scoasă → ședința nepornită revine la plata obișnuită', async () => {
  fake = createFakeSupabase(seed({ live_lessons: [...seed().live_lessons, lesson(C.en2, { title: 'EN 2023 Varianta 2' })] }));
  // elevul pornește (nu începe încă) meditația gratuită aleasă automat
  const st = await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.free);
  assert.strictEqual(st.body.via, 'gratuit');

  const ov = await call('admin_overview', {}, U.admin);
  assert.strictEqual(ov.statusCode, 200, JSON.stringify(ov.body));
  const f = ov.body.free;
  assert.strictEqual(f.setup, true);
  assert.strictEqual(f.auto, true);
  assert.deepStrictEqual({ monthly: f.monthly, answers: f.answers, max: f.max }, { monthly: 4, answers: 10, max: 4 });
  assert.deepStrictEqual(f.slots.map((x) => [x.type, x.label, x.lesson?.subjectId, x.auto]), [
    ['en', 'Evaluarea Națională', C.en1, true], ['mate-info', 'BAC Mate-Info', C.bac1, true],
    ['stiinte-naturii', 'BAC Științele Naturii', C.bac2, true], ['tehnologic', 'BAC Tehnologic', C.teh2, true],
  ]);
  assert.deepStrictEqual(f.lessons.map((l) => l.subjectId), [C.en1, C.bac1, C.bac2, C.teh2]);
  const enSlot = f.slots[0];
  assert.deepStrictEqual(enSlot.options.map((o) => [o.subjectId, o.kind, o.ready]), [[C.en1, 'varianta', true], [C.en2, 'varianta', true], [C.en3, 'model', true]],
    'subiectele cu barem ale examenului, în ordinea listelor, fără fișe și fără cele fără barem');
  assert.deepStrictEqual(f.slots[3].options.map((o) => [o.subjectId, o.ready]), [[C.teh2, false], [C.teh1, false]]);
  assert.strictEqual(ov.body.lessons.find((l) => l.subject_id === C.en1).free, true);
  assert.strictEqual(ov.body.lessons.find((l) => l.subject_id === C.en2).free, false);

  // doar adminul; doar subiecte ale examenului ales, cu barem (nu bareme, nu clase)
  assert.strictEqual((await call('admin_set_free', { type: 'en', subjectId: C.en2 }, U.free)).statusCode, 403);
  assert.strictEqual((await call('admin_set_free', { type: 'en', subjectId: C.baremEn }, U.admin)).statusCode, 400);
  assert.strictEqual((await call('admin_set_free', { type: 'en', subjectId: C.cls }, U.admin)).statusCode, 400);
  const wrong = await call('admin_set_free', { type: 'mate-info', subjectId: C.en2 }, U.admin);
  assert.strictEqual(wrong.statusCode, 400);
  assert.match(wrong.body.error, /nu e de BAC Mate-Info/);
  const noBarem = await call('admin_set_free', { type: 'en', subjectId: C.enNoBarem }, U.admin);
  assert.strictEqual(noBarem.statusCode, 400);
  assert.match(noBarem.body.error, /nu are barem/);
  assert.strictEqual((await call('admin_set_free', { type: 'pedagogic', subjectId: C.en2 }, U.admin)).statusCode, 400);
  assert.strictEqual((await call('admin_set_free', {}, U.admin)).statusCode, 400);

  // EN: alta în locul celei de acum (tot una singură)
  const set = await call('admin_set_free', { type: 'en', subjectId: C.en2 }, U.admin);
  assert.strictEqual(set.statusCode, 200, JSON.stringify(set.body));
  assert.deepStrictEqual(set.body.free.lessons.map((l) => l.subjectId), [C.en2, C.bac1, C.bac2, C.teh2]);
  assert.strictEqual(set.body.free.slots[0].auto, false);
  const stored = fake.db.tables.app_settings.find((r) => r.key === 'live_free_lessons');
  assert.strictEqual(stored.value.slots.en, C.en2);
  assert.ok(!stored.value.auto.includes('en'));
  assert.strictEqual(stored.updated_by, U.admin);
  const p = await call('program', {}, U.free);
  assert.deepStrictEqual(p.body.freeLessons.map((x) => x.subjectId), [C.en2, C.bac1, C.bac2, C.teh2]);

  // ședința nepornită pe en1 (nu mai e gratuită) → plata obișnuită
  const begin = await call('private_begin', { sessionId: st.body.sessionId }, U.free);
  assert.strictEqual(begin.statusCode, 402);
  assert.match(begin.body.error, /nu mai e gratuită/);
  // sala arată plata unui bilet 1-LA-1 (nu de grup), cu prețul lui
  assert.strictEqual(begin.body.code, 'LIVE_PAYMENT');
  assert.strictEqual(begin.body.kind, 'privat');
  assert.strictEqual(begin.body.price, 30);
  const prem = await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.prem);
  assert.strictEqual(prem.body.via, 'inclus');

  // Științele Naturii: fără meditație gratuită — rămâne așa (alegerea automată nu revine)
  const none = await call('admin_set_free', { type: 'stiinte-naturii', subjectId: null }, U.admin);
  assert.strictEqual(none.statusCode, 200, JSON.stringify(none.body));
  assert.strictEqual(none.body.free.slots[2].none, true);
  handler._internals.resetFree();
  assert.deepStrictEqual((await call('program')).body.freeLessons.map((x) => x.subjectId), [C.en2, C.bac1, C.teh2]);
  // … și înapoi la alegerea automată
  const auto = await call('admin_set_free', { type: 'stiinte-naturii', auto: true }, U.admin);
  assert.deepStrictEqual([auto.body.free.slots[2].lesson?.subjectId, auto.body.free.slots[2].auto], [C.bac2, true]);

  // butonul „🎁" din „Lecțiile recente": devine meditația examenului ei (o înlocuiește), apoi scoasă
  const on = await call('admin_set_free', { subjectId: C.en3, on: true }, U.admin);
  assert.deepStrictEqual(on.body.free.lessons.map((l) => l.subjectId), [C.en3, C.bac1, C.bac2, C.teh2]);
  const offOther = await call('admin_set_free', { subjectId: C.en2, on: false }, U.admin);
  assert.deepStrictEqual(offOther.body.free.lessons.map((l) => l.subjectId), [C.en3, C.bac1, C.bac2, C.teh2], 'en2 nu mai era gratuită: nimic de scos');
  const off = await call('admin_set_free', { subjectId: C.en3, on: false }, U.admin);
  assert.deepStrictEqual(off.body.free.lessons.map((l) => l.subjectId), [C.bac1, C.bac2, C.teh2]);

  // formatul vechi (o listă, de la o pagină de Admin rămasă deschisă): ultima a fiecărui examen; restul → niciuna
  const many = Array.from({ length: 13 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i + 100).padStart(12, '0')}`);
  assert.strictEqual((await call('admin_set_free', { subjectIds: many }, U.admin)).statusCode, 400);
  const legacy = await call('admin_set_free', { subjectIds: [C.en1, C.bac1, C.en2] }, U.admin);
  assert.strictEqual(legacy.statusCode, 200, JSON.stringify(legacy.body));
  assert.deepStrictEqual(legacy.body.free.lessons.map((l) => l.subjectId), [C.en2, C.bac1]);
  // lista goală = nicio meditație gratuită (fără să revină alegerea automată)
  const empty = await call('admin_set_free', { subjectIds: [] }, U.admin);
  assert.deepStrictEqual(empty.body.free.lessons, []);
  handler._internals.resetFree();
  assert.deepStrictEqual((await call('program')).body.freeLessons, []);
});
