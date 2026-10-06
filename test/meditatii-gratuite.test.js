// Teste pentru MEDITAȚIILE GRATUITE (meditații live cu profesorul virtual):
// câteva lecții pregătite (implicit 2 — una de EN, una de BAC, alese automat până
// le alege adminul) se fac 1-la-1 fără plată și fără abonament, de oricine are cont;
// ședința de grup cu un astfel de subiect e și ea gratuită; plafonul lunar și cel al
// întrebărilor din chat; adminul schimbă lista (Admin → 🎥 Meditații live → 🎁).
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
      content(C.cls, 'Fracții', 'clasa-5'),
    ],
    ai_pdf_text: [pdfRow(C.en1), pdfRow(C.en2), pdfRow(C.en3), pdfRow(C.enFisa), pdfRow(C.bac1), pdfRow(C.bac2)],
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
  assert.deepStrictEqual(L.groupAccess({ profile: free }), { ok: false, via: null, price: 10 });
});

test('normalizeFreeIds: UUID-uri unice, litere mici, cel mult 12', () => {
  assert.deepStrictEqual(L.normalizeFreeIds([C.en1, C.en1.toUpperCase(), 'x', null, C.bac1]), [C.en1, C.bac1]);
  const many = Array.from({ length: 20 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`);
  assert.strictEqual(L.normalizeFreeIds(many).length, L.FREE_MAX);
  assert.deepStrictEqual(L.normalizeFreeIds('nu-e-listă'), []);
});

test('pickFreeLessons: o lecție de EN și una de BAC, cele mai potrivite pentru o primă încercare', () => {
  const rows = seed().live_lessons.map((l) => ({ ...l, pasi: l.script.pasi, sv: l.script.v, noVoice: l.progress.noVoice }));
  const pick = L.pickFreeLessons(rows).map((l) => l.subject_id);
  // EN: varianta completă cu întrebări pe pași și voce (nu fișa „Subiectul I, ex. 5", nu modelul fără pași/voce);
  // BAC: Mate-Info înaintea Științelor naturii, la calitate egală
  assert.deepStrictEqual(pick, [C.en1, C.bac1]);
  // fără BAC → două de EN; doar lecțiile gata; ultima versiune
  const enOnly = rows.filter((l) => l.exam === 'en');
  assert.deepStrictEqual(L.pickFreeLessons(enOnly).map((l) => l.subject_id), [C.en1, C.en3]);
  assert.deepStrictEqual(L.pickFreeLessons([{ ...rows[0], status: 'script' }]), []);
  assert.strictEqual(L.pickFreeLessons(rows, { count: 3 }).length, 3);
});

// ═════════════════════════════ handlerul ═════════════════════════════
test('alegerea automată: două lecții gata (EN + BAC), salvate o dată; lobby-ul le arată la vedere', async () => {
  fake = createFakeSupabase(seed());
  const p = await call('program');
  assert.strictEqual(p.statusCode, 200, JSON.stringify(p.body));
  assert.deepStrictEqual(p.body.freeLessons.map((f) => [f.subjectId, f.examLabel, f.ready]), [[C.en1, 'Evaluarea Națională', true], [C.bac1, 'BAC Mate-Info', true]]);
  assert.strictEqual(p.body.prices.gratuiteLuna, 4);
  const saved = fake.db.tables.app_settings.find((r) => r.key === 'live_free_lessons');
  assert.deepStrictEqual(saved.value.subjects, [C.en1, C.bac1]);
  assert.strictEqual(saved.value.auto, true);
  // o lecție nouă, „mai bună", nu schimbă alegerea (rămâne stabilă până o schimbă adminul)
  fake.db.tables.live_lessons.push(lesson(C.en2, { title: 'EN 2023 Varianta 2', updated: '2026-10-01T00:00:00Z' }));
  handler._internals.resetFree();
  const again = await call('program', {}, U.free);
  assert.deepStrictEqual(again.body.freeLessons.map((f) => f.subjectId), [C.en1, C.bac1]);
  assert.deepStrictEqual(again.body.me.free, { monthly: 4, used: 0, left: 4 });
  // ședințele de grup cu un subiect gratuit: „Gratuit" (fără cont: intră în cont)
  const anonSessions = p.body.days.flatMap((d) => d.sessions);
  for (const s of anonSessions) {
    const isFree = !!s.subject && [C.en1, C.bac1].includes(s.subject.id);
    assert.strictEqual(s.free, isFree);
    assert.strictEqual(s.access.price, isFree ? 0 : 10);
  }
});

test('fără SQL-ul setărilor: tot cele alese automat (calculate la cerere); adminul primește mesajul de instalare', async () => {
  fake = createFakeSupabase(seed());
  fake.db.failTables.add('app_settings');
  const p = await call('program');
  assert.deepStrictEqual(p.body.freeLessons.map((f) => f.subjectId), [C.en1, C.bac1]);
  const ov = await call('admin_overview', {}, U.admin);
  assert.strictEqual(ov.statusCode, 200, JSON.stringify(ov.body));
  assert.strictEqual(ov.body.free.setup, false);
  assert.strictEqual(ov.body.free.auto, true);
  const set = await call('admin_set_free', { subjectIds: [C.en2] }, U.admin);
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
  assert.strictEqual(subj.body.subjects[0].id, C.en1, 'meditația gratuită e prima în listă');
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
  assert.strictEqual(paid.body.price, 20);
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
  assert.strictEqual(r2.body.price, 10);
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

test('adminul alege meditațiile gratuite; una scoasă dintre ele → ședința nepornită revine la plata obișnuită', async () => {
  fake = createFakeSupabase(seed({ live_lessons: [...seed().live_lessons, lesson(C.en2, { title: 'EN 2023 Varianta 2' })] }));
  // elevul pornește (nu începe încă) meditația gratuită aleasă automat
  const st = await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.free);
  assert.strictEqual(st.body.via, 'gratuit');

  const ov = await call('admin_overview', {}, U.admin);
  assert.strictEqual(ov.statusCode, 200, JSON.stringify(ov.body));
  const f = ov.body.free;
  assert.strictEqual(f.setup, true);
  assert.strictEqual(f.auto, true);
  assert.deepStrictEqual(f.lessons.map((l) => l.subjectId), [C.en1, C.bac1]);
  assert.deepStrictEqual({ monthly: f.monthly, answers: f.answers, max: f.max }, { monthly: 4, answers: 10, max: 12 });
  assert.ok(f.ready.some((r) => r.subjectId === C.en2 && r.free === false), 'lista din care alege: lecțiile gata');
  assert.ok(f.ready.every((r) => r.exam), 'doar subiecte de EN/BAC');
  assert.strictEqual(ov.body.lessons.find((l) => l.subject_id === C.en1).free, true);
  assert.strictEqual(ov.body.lessons.find((l) => l.subject_id === C.en2).free, false);

  // doar adminul; doar subiecte de EN/BAC (nu bareme, nu clase); cel mult 12
  assert.strictEqual((await call('admin_set_free', { subjectIds: [C.en2] }, U.free)).statusCode, 403);
  assert.strictEqual((await call('admin_set_free', { subjectIds: [C.baremEn] }, U.admin)).statusCode, 400);
  assert.strictEqual((await call('admin_set_free', { subjectIds: [C.cls] }, U.admin)).statusCode, 400);
  const many = Array.from({ length: 13 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i + 100).padStart(12, '0')}`);
  assert.strictEqual((await call('admin_set_free', { subjectIds: many }, U.admin)).statusCode, 400);
  assert.strictEqual((await call('admin_set_free', {}, U.admin)).statusCode, 400);

  const set = await call('admin_set_free', { subjectIds: [C.bac1, C.en2] }, U.admin);
  assert.strictEqual(set.statusCode, 200, JSON.stringify(set.body));
  assert.deepStrictEqual(set.body.free.lessons.map((l) => l.subjectId), [C.bac1, C.en2]);
  assert.strictEqual(set.body.free.auto, false);
  const stored = fake.db.tables.app_settings.find((r) => r.key === 'live_free_lessons');
  assert.deepStrictEqual(stored.value.subjects, [C.bac1, C.en2]);
  assert.strictEqual(stored.updated_by, U.admin);
  const p = await call('program', {}, U.free);
  assert.deepStrictEqual(p.body.freeLessons.map((x) => x.subjectId), [C.bac1, C.en2]);

  // ședința nepornită pe en1 (nu mai e gratuită) → plata obișnuită
  const begin = await call('private_begin', { sessionId: st.body.sessionId }, U.free);
  assert.strictEqual(begin.statusCode, 402);
  assert.match(begin.body.error, /nu mai e gratuită/);
  const prem = await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.prem);
  assert.strictEqual(prem.body.via, 'inclus');
  // lista goală = nicio meditație gratuită (fără să revină alegerea automată)
  const none = await call('admin_set_free', { subjectIds: [] }, U.admin);
  assert.deepStrictEqual(none.body.free.lessons, []);
  handler._internals.resetFree();
  assert.deepStrictEqual((await call('program')).body.freeLessons, []);
});
