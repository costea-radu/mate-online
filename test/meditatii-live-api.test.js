// Teste de INTEGRARE pentru api/live.js (meditațiile live), pe un Supabase în
// memorie (test/tools/fakeSupabase.js): lobby-ul (programul zilei, prețurile,
// drepturile), intrarea în sală (plată / bilet / abonament), ceasul comun al
// ședinței de grup, chatul (moderare, ritm, răspunsul profesorului), întrebările
// (fereastra de timp, corectitudinea), 1-la-1 (incluse în abonament, bilet),
// adminul și cronul (pregătirea lecției fără voce configurată → vocea browserului).
// Fără rețea: autentificarea, modelul AI și cititorul de PDF sunt înlocuite.
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const L = require('../api/_lib/live');
const LL = require('../api/_lib/liveLesson');
const pdf = require('../api/ai-pdf-context');
const handler = require('../api/live');

// ─── datele de test ──────────────────────────────────────────────────────────
const U = {
  free: '11111111-1111-4111-8111-111111111111',
  prem: '22222222-2222-4222-8222-222222222222',
  admin: '33333333-3333-4333-8333-333333333333',
};
const C = {
  en1: 'aaaaaaaa-0000-4000-8000-000000000001',
  en2: 'aaaaaaaa-0000-4000-8000-000000000002',
  en3: 'aaaaaaaa-0000-4000-8000-000000000003',
  enNoBarem: 'aaaaaaaa-0000-4000-8000-000000000004',
  bac1: 'bbbbbbbb-0000-4000-8000-000000000001',
  bac2: 'bbbbbbbb-0000-4000-8000-000000000002',
};
const BAREM_TEXT = 'BAREM DE EVALUARE ȘI DE NOTARE. SUBIECTUL I. Rezultate: 1. b 2. c 3. a. Se punctează orice modalitate corectă de rezolvare.';
const content = (id, title, category, extra = {}) => ({ id, title, category, subcategory: null, profile: null, content_type: 'pdf', file_url: `https://x/${id}.pdf`, is_free: true, created_at: '2026-01-01T00:00:00Z', ...extra });
const pdfRow = (id, status = 'ok') => ({ content_id: id, barem_status: status, barem: { title: 'Barem' }, barem_text: BAREM_TEXT, text: 'SUBIECTUL I ...' });

function seed() {
  return {
    profiles: [
      { id: U.free, full_name: 'Ioana Popescu', email: 'ioana@example.com', subscription_status: null, role: 'elev', is_admin: false },
      { id: U.prem, full_name: 'Andrei Ionescu', email: 'andrei@example.com', subscription_status: 'active', role: 'elev', is_admin: false },
      { id: U.admin, full_name: 'Radu Costea', email: 'radu@example.com', subscription_status: null, role: 'admin', is_admin: true },
    ],
    content: [
      content(C.en1, 'EN 2024 Varianta 7', 'evaluare-nationala'),
      content(C.en2, 'EN 2023 Varianta 2', 'evaluare-nationala'),
      content(C.en3, 'EN 2022 Model', 'evaluare-nationala'),
      content(C.enNoBarem, 'EN 2021 Varianta 9', 'evaluare-nationala'),
      content('aaaaaaaa-0000-4000-8000-0000000000b1', 'Barem EN 2024 Varianta 7', 'evaluare-nationala', { subcategory: 'bareme' }),
      content(C.bac1, 'BAC 2024 M1 Mate-Info Varianta 3', 'bacalaureat', { profile: 'mate-info' }),
      content(C.bac2, 'BAC 2023 M2 Științe ale naturii Varianta 5', 'bacalaureat', { profile: 'stiinte-naturii' }),
    ],
    ai_pdf_text: [pdfRow(C.en1), pdfRow(C.en2), pdfRow(C.en3, 'ok_antet'), pdfRow(C.enNoBarem, 'lipsa'), pdfRow(C.bac1), pdfRow(C.bac2)],
  };
}

// scriptul unei lecții (doi itemi de grilă, pe barem), ca cel scris de model
const seg = (say, board = []) => ({ say, board });
function rawItem(ref, answer = 'b') {
  return {
    ref, title: `Subiectul I, exercițiul ${ref.split('.')[1]}`, kind: 'grila', statement: 'Rezultatul calculului $2+3\\cdot 4$ este:',
    options: ['20', '14', '24', '9'], answer, points: 5, barem: `${answer}. 5p`,
    intro: [seg('Trecem la exercițiul următor.')],
    tryPoll: { type: 'grila', question: 'Rezultatul calculului?', options: ['20', '14', '24', '9'], answer, explain: 'Înmulțirea se face întâi.' },
    afterTry: [seg('Să vedem cum ați răspuns.')],
    modes: { barem: [seg('Întâi înmulțirea: trei ori patru egal doisprezece, apoi adunăm doi.', ['$3\\cdot 4 = 12$', '$2 + 12 = 14$'])], intuitiv: [seg('Înmulțirea leagă mai tare decât adunarea.')], greseli: [], alta_metoda: null },
    check: null, afterCheck: [],
  };
}
function lessonScript() {
  const radu = L.teacherById('radu');
  const BAREM = 'SUBIECTUL I (30 de puncte)\nNr. item 1. 2.\nRezultate b. b.\nPunctaj 5p 5p\n';
  const items = LL.normalizeItems([rawItem('I.1'), rawItem('I.2')], { section: 'I', exam: 'en', grile: { I: { 1: 'b', 2: 'b' } }, baremText: BAREM });
  return LL.assignIds({ title: 'EN 2024 Varianta 7', exam: 'en', teacher: 'radu', teacherName: radu.name, ...LL.templates(radu, { title: 'EN 2024 Varianta 7', exam: 'en' }), items });
}

// ─── înlocuirile (fără rețea) ─────────────────────────────────────────────────
let fake = null;
const calls = { chat: 0, script: 0 };
ai.admin = () => fake;
ai.authUser = async (req) => {
  const u = req.headers['x-user'];
  if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; }
  return u;
};
ai.logUsage = async () => {};
ai.chatJson = async () => { calls.chat++; return { data: { say: 'Pentru că înmulțirea se face înaintea adunării.', text: 'Pentru că înmulțirea se face înaintea adunării: $3\\cdot 4=12$.', board: [] }, usage: { model: 'test', input_tokens: 10, output_tokens: 10 } }; };
LL.generateScript = async () => { calls.script++; return { script: lessonScript(), usage: { model: 'test', input_tokens: 100, output_tokens: 100 } }; };
pdf.getPdfContext = async () => ({ text: 'SUBIECTUL I', baremText: BAREM_TEXT, baremStatus: 'ok' });
delete process.env.AZURE_SPEECH_KEY; delete process.env.OPENAI_API_KEY; delete process.env.LIVE_TTS_API_KEY;
delete process.env.SUPABASE_URL; delete process.env.VITE_SUPABASE_URL;

async function call(action, body = {}, user = null) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: user ? { 'x-user': user } : {}, query: {}, body: { action, ...body } }, res);
  return res;
}

const now = Date.now();
const iso = (ms) => new Date(ms).toISOString();

test('lobby: programul de azi și de mâine, un singur profesor, prețurile și drepturile', async () => {
  fake = createFakeSupabase(seed());
  const anon = await call('program');
  assert.strictEqual(anon.statusCode, 200, JSON.stringify(anon.body));
  const p = anon.body;
  assert.deepStrictEqual(p.teachers.map((t) => t.id), ['radu']);
  assert.strictEqual(p.days.length, 2);
  for (const d of p.days) {
    assert.strictEqual(d.sessions.length, 3, 'trei ședințe pe zi (15, 17, 19)');
    assert.ok(d.sessions.every((s) => s.teacher === 'radu' && s.access.ok === false && s.access.price === 10));
  }
  assert.deepStrictEqual(p.prices, { grup: 10, privat: 20, privatMin: 60, privatIncluse: 8 });
  assert.strictEqual(p.me.loggedIn, false);
  // subiectele atribuite: doar cu barem, fără bareme ca subiecte, fără repetare în aceeași zi
  const todays = p.days[0].sessions.filter((s) => s.subject);
  const allowed = new Set([C.en1, C.en2, C.en3, C.bac1, C.bac2]);
  assert.ok(todays.every((s) => allowed.has(s.subject.id)), 'numai subiecte cu barem');
  assert.strictEqual(new Set(todays.map((s) => s.subject.id)).size, todays.length, 'fără repetări în aceeași zi');
  // abonatul: toate incluse; 8 ședințe 1-la-1 incluse luna aceasta
  const prem = (await call('program', {}, U.prem)).body;
  assert.ok(prem.days[0].sessions.every((s) => s.access.ok && s.access.via === 'abonament'));
  assert.strictEqual(prem.me.premium, true);
  assert.strictEqual(prem.me.private.ok, true);
  assert.strictEqual(prem.me.private.includedLeft, 8);
  // elevul fără abonament: plătește
  const free = (await call('program', {}, U.free)).body;
  assert.strictEqual(free.me.private.ok, false);
  assert.strictEqual(free.me.private.price, 20);
  assert.strictEqual(free.me.name, 'Ioana P.');
  // al doilea apel nu dublează ședințele
  assert.strictEqual(fake.db.tables.live_sessions.filter((s) => s.kind === 'grup').length, 6);
});

// o ședință de grup care a început acum 10 minute, cu lecția gata
function liveGroupSession() {
  const today = L.dayKey(new Date());
  const s = { id: 'cccccccc-0000-4000-8000-000000000001', kind: 'grup', day: today, slot: '15', teacher: 'radu', exam: 'en', profile: null, subject_id: C.en1, starts_at: iso(now - 10 * 60000), ends_at: iso(now + 110 * 60000), status: 'programata', state: {}, created_at: iso(now - 86400000), updated_at: iso(now - 86400000) };
  const script = lessonScript();
  const lesson = { id: 'dddddddd-0000-4000-8000-000000000001', subject_id: C.en1, teacher: 'radu', version: 1, status: 'gata', title: script.title, exam: 'en', profile: null, script, progress: { audio: {}, noVoice: true, total: LL.segmentsInOrder(script).length, done: 0 }, cost_micro: 0, created_at: iso(now - 3600000), updated_at: iso(now - 3600000) };
  return { s, lesson };
}

test('intrarea în sală: fără abonament → plata; cu bilet → cronologia, ceasul comun pornește', async () => {
  const { s, lesson } = liveGroupSession();
  fake = createFakeSupabase({ ...seed(), live_sessions: [s], live_lessons: [lesson] });
  const r1 = await call('join', { sessionId: s.id }, U.free);
  assert.strictEqual(r1.statusCode, 402);
  assert.strictEqual(r1.body.code, 'LIVE_PAYMENT');
  assert.strictEqual(r1.body.price, 10);
  assert.strictEqual(r1.body.teacher.name, 'Prof. Radu');
  // biletul (cum îl scrie webhook-ul Stripe)
  fake.db.tables.live_tickets = [{ id: 'eeeeeeee-0000-4000-8000-000000000001', user_id: U.free, kind: 'grup', session_id: s.id, status: 'platit', created_at: iso(now) }];
  const r2 = await call('join', { sessionId: s.id }, U.free);
  assert.strictEqual(r2.statusCode, 200, JSON.stringify(r2.body));
  assert.strictEqual(r2.body.access, 'bilet');
  assert.ok(r2.body.timeline && r2.body.timeline.scenes.length > 3, 'cronologia lecției');
  assert.ok(r2.body.session.startedAt, 'ceasul comun a pornit');
  assert.strictEqual(r2.body.noVoice, true);
  assert.strictEqual(r2.body.channel, `live:${s.id}`);
  const stored = fake.db.tables.live_sessions[0];
  assert.strictEqual(stored.status, 'activa');
  assert.ok(stored.state.tl && Object.keys(stored.state.tl.polls).length >= 2, 'ferestrele întrebărilor, pe server');
  // abonatul intră fără bilet; al doilea participant vede ACELAȘI ceas
  const r3 = await call('join', { sessionId: s.id }, U.prem);
  assert.strictEqual(r3.statusCode, 200);
  assert.strictEqual(r3.body.access, 'abonament');
  assert.strictEqual(r3.body.session.startedAt, r2.body.session.startedAt);
  assert.strictEqual(fake.db.tables.live_participants.length, 2);
  // prezența
  const hb = await call('heartbeat', { sessionId: s.id, seconds: 60 }, U.free);
  assert.strictEqual(hb.body.present, 2);
});

test('chatul: moderare, ritmul mesajelor, profesorul răspunde doar la întrebări', async () => {
  const { s, lesson } = liveGroupSession();
  fake = createFakeSupabase({ ...seed(), live_sessions: [s], live_lessons: [lesson] });
  await call('join', { sessionId: s.id }, U.prem);
  const m1 = await call('chat', { sessionId: s.id, text: 'Bună seara! scrieți-mi pe www.exemplu.ro' }, U.prem);
  assert.strictEqual(m1.statusCode, 200, JSON.stringify(m1.body));
  assert.ok(m1.body.message.text.includes('[link ascuns]'));
  assert.strictEqual(m1.body.flagged, true);
  assert.strictEqual(m1.body.answer, null, 'nu e o întrebare');
  const tooFast = await call('chat', { sessionId: s.id, text: 'încă un mesaj' }, U.prem);
  assert.strictEqual(tooFast.statusCode, 429);
  fake.db.tables.live_messages.forEach((m) => { m.created_at = iso(now - 60000); });
  const q = await call('chat', { sessionId: s.id, text: 'De ce se face întâi înmulțirea?' }, U.prem);
  assert.strictEqual(q.statusCode, 200, JSON.stringify(q.body));
  assert.strictEqual(q.body.answer.role, 'profesor');
  assert.strictEqual(q.body.answer.author, 'Prof. Radu');
  assert.strictEqual(q.body.answer.replyTo, q.body.message.id);
  assert.strictEqual(calls.chat, 1);
  // cine nu are acces nu poate scrie
  const other = await call('chat', { sessionId: s.id, text: 'salut' }, U.free);
  assert.strictEqual(other.statusCode, 402);
  // mesajele (plasa de siguranță): mesajul lui + răspunsul profesorului
  const list = await call('messages', { sessionId: s.id }, U.prem);
  assert.strictEqual(list.body.messages.length, 3);
  assert.ok(list.body.messages.every((m) => m.author !== 'Andrei Ionescu'), 'numele complet nu apare');
});

test('întrebările: doar în fereastra lor de timp; corectitudinea după barem; rezultatele clasei', async () => {
  const { s, lesson } = liveGroupSession();
  fake = createFakeSupabase({ ...seed(), live_sessions: [s], live_lessons: [lesson] });
  await call('join', { sessionId: s.id }, U.prem);
  const st = fake.db.tables.live_sessions[0].state;
  const [pollId, win] = Object.entries(st.tl.polls)[0];
  // prea devreme (lecția abia a început)
  const early = await call('poll_answer', { sessionId: s.id, pollId, answer: 'b' }, U.prem);
  assert.strictEqual(early.statusCode, 409);
  // mutăm ceasul: suntem în mijlocul întrebării
  st.startedAt = iso(Date.now() - (win[0] + 5) * 1000);
  const ok = await call('poll_answer', { sessionId: s.id, pollId, answer: 'b' }, U.prem);
  assert.strictEqual(ok.statusCode, 200, JSON.stringify(ok.body));
  assert.strictEqual(ok.body.correct, true);
  assert.strictEqual(ok.body.answer, undefined, 'în grup, răspunsul corect se arată abia la rezultate');
  assert.strictEqual(ok.body.results.total, 1);
  // își schimbă răspunsul: tot un singur vot
  const again = await call('poll_answer', { sessionId: s.id, pollId, answer: 'a' }, U.prem);
  assert.strictEqual(again.body.correct, false);
  assert.strictEqual(again.body.results.total, 1);
  // după fereastră → închis
  st.startedAt = iso(Date.now() - (win[1] + 30) * 1000);
  const late = await call('poll_answer', { sessionId: s.id, pollId, answer: 'b' }, U.prem);
  assert.strictEqual(late.statusCode, 409);
  // reîncărcarea paginii: răspunsul meu revine la intrare
  const rj = await call('join', { sessionId: s.id }, U.prem);
  assert.deepStrictEqual(rj.body.myAnswers[pollId], { answer: 'a', correct: false });
});

test('1-la-1: inclus în abonament (se consumă la pornire), fără barem → refuz, fără abonament → plata', async () => {
  const { lesson } = liveGroupSession();
  fake = createFakeSupabase({ ...seed(), live_lessons: [lesson] });
  const subj = await call('private_subjects', { exam: 'en' }, U.prem);
  assert.strictEqual(subj.statusCode, 200);
  const ids = subj.body.subjects.map((x) => x.id);
  assert.ok(ids.includes(C.en1) && ids.includes(C.en3) && !ids.includes(C.enNoBarem), 'doar subiecte cu barem');
  assert.strictEqual(subj.body.subjects[0].id, C.en1, 'lecția gata e prima');
  const noBarem = await call('private_start', { teacher: 'radu', subjectId: C.enNoBarem }, U.prem);
  assert.strictEqual(noBarem.statusCode, 409);
  assert.strictEqual(noBarem.body.code, 'NO_BAREM');
  const st = await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.prem);
  assert.strictEqual(st.statusCode, 200, JSON.stringify(st.body));
  assert.strictEqual(st.body.via, 'inclus');
  // același subiect, încă deschis → se reia, nu se mai creează unul
  const again = await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.prem);
  assert.strictEqual(again.body.resumed, true);
  assert.strictEqual(again.body.sessionId, st.body.sessionId);
  // nepornită → nu consumă din cele 8
  let prog = (await call('program', {}, U.prem)).body;
  assert.strictEqual(prog.me.private.includedLeft, 8);
  const join = await call('join', { sessionId: st.body.sessionId }, U.prem);
  assert.strictEqual(join.statusCode, 200);
  assert.ok(join.body.timeline, 'lecția e gata → cronologia 1-la-1');
  const begin = await call('private_begin', { sessionId: st.body.sessionId }, U.prem);
  assert.strictEqual(begin.statusCode, 200);
  assert.ok(Math.abs(new Date(begin.body.ends_at) - Date.now() - 60 * 60000) < 5000, '60 de minute de acum');
  prog = (await call('program', {}, U.prem)).body;
  assert.strictEqual(prog.me.private.includedLeft, 7);
  assert.strictEqual(prog.me.privateSessions[0].started, true);
  // altcineva nu poate intra în ședința lui
  const intruder = await call('join', { sessionId: st.body.sessionId }, U.free);
  assert.strictEqual(intruder.statusCode, 402);
  // elevul fără abonament
  const free = await call('private_start', { teacher: 'radu', subjectId: C.en2 }, U.free);
  assert.strictEqual(free.statusCode, 402);
  assert.strictEqual(free.body.price, 20);
  // încheierea
  const end = await call('leave', { sessionId: st.body.sessionId, seconds: 30, end: true }, U.prem);
  assert.strictEqual(end.statusCode, 200);
  assert.strictEqual(fake.db.tables.live_sessions.find((x) => x.id === st.body.sessionId).status, 'incheiata');
});

test('admin + cron: programul zilei, pregătirea lecției fără voce configurată (vocea browserului)', async () => {
  fake = createFakeSupabase(seed());
  const denied = await call('admin_overview', {}, U.free);
  assert.strictEqual(denied.statusCode, 403);
  const ov = await call('admin_overview', {}, U.admin);
  assert.strictEqual(ov.statusCode, 200, JSON.stringify(ov.body));
  assert.strictEqual(ov.body.sessions.length, 3);
  assert.ok(ov.body.subjects.en.length === 3 && ov.body.subjects.bac.length === 2);
  assert.strictEqual(ov.body.tts, null);
  // pregătirea unei lecții (scriptul „scris de model" + fără voce → gata, cu vocea browserului)
  const sess = ov.body.sessions.find((x) => x.subject);
  const prep = await call('admin_prepare', { subjectId: sess.subject.id, teacher: 'radu' }, U.admin);
  assert.strictEqual(prep.statusCode, 200, JSON.stringify(prep.body));
  assert.strictEqual(prep.body.lesson.status, 'gata');
  assert.strictEqual(prep.body.lesson.noVoice, true);
  assert.strictEqual(calls.script >= 1, true);
  const row = fake.db.tables.live_lessons.find((l) => l.subject_id === sess.subject.id);
  assert.strictEqual(row.locked_until, null, 'lacătul se eliberează');
  assert.ok(row.script.items.length === 2);
  // anularea unei ședințe
  const cancel = await call('admin_set_subject', { sessionId: sess.id, cancel: true }, U.admin);
  assert.strictEqual(cancel.body.session.status, 'anulata');
  // cronul (GET, cu secretul)
  const origCron = ai.isCronRequest;
  ai.isCronRequest = () => true;
  try {
    const res = fakeRes();
    await handler({ method: 'GET', headers: {}, query: { action: 'cron' }, body: {} }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.sessions, 6);
    assert.deepStrictEqual(res.body.errors, []);
  } finally { ai.isCronRequest = origCron; }
  // fără secret → refuzat
  const res2 = fakeRes();
  await handler({ method: 'GET', headers: {}, query: { action: 'cron' }, body: {} }, res2);
  assert.strictEqual(res2.statusCode, 405);
});

test('fără tabele (SQL nerulat) → mesaj clar pentru admin, nu o eroare obscură', async () => {
  fake = createFakeSupabase(seed());
  fake.db.failTables.add('live_sessions');
  const r = await call('program');
  assert.strictEqual(r.statusCode, 503);
  assert.match(r.body.error, /meditatii_live\.sql/);
  assert.strictEqual(r.body.code, 'LIVE_SETUP');
});
