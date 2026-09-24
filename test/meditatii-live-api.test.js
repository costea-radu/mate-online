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
  bacPed: 'bbbbbbbb-0000-4000-8000-000000000003',
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
      content(C.bacPed, 'BAC 2024 M_pedagogic Varianta 2', 'bacalaureat', { profile: 'pedagogic' }),
    ],
    ai_pdf_text: [pdfRow(C.en1), pdfRow(C.en2), pdfRow(C.en3, 'ok_antet'), pdfRow(C.enNoBarem, 'lipsa'), pdfRow(C.bac1), pdfRow(C.bac2), pdfRow(C.bacPed)],
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

test('lobby: azi și mâine, câte o ședință în fiecare sală (EN, BAC Mate-Info, Șt. Naturii, Tehnologic), la aceeași oră', async () => {
  fake = createFakeSupabase(seed());
  const anon = await call('program');
  assert.strictEqual(anon.statusCode, 200, JSON.stringify(anon.body));
  const p = anon.body;
  assert.deepStrictEqual(p.teachers.map((t) => t.id), ['radu']);
  assert.deepStrictEqual(p.rooms.map((r) => r.label), ['Evaluarea Națională', 'BAC Mate-Info', 'BAC Științele Naturii', 'BAC Tehnologic']);
  assert.deepStrictEqual(p.intervals.map((i) => i.label), ['17:00–19:00']);
  assert.strictEqual(p.days.length, 2);
  for (const d of p.days) {
    assert.strictEqual(d.sessions.length, 4, 'patru săli pe zi');
    assert.ok(d.sessions.every((s) => s.teacher === 'radu' && s.access.ok === false && s.access.price === 10));
    assert.strictEqual(new Set(d.sessions.map((s) => s.starts_at)).size, 1, 'toate la aceeași oră');
    assert.deepStrictEqual(d.sessions.map((s) => s.room.n).sort(), [1, 2, 3, 4]);
  }
  // fiecare sală primește DOAR subiecte ale examenului ei (fără pedagogic, fără alt profil);
  // mâine (azi, după 19:00, ședințele s-au încheiat și nu mai primesc subiect)
  const t0 = Object.fromEntries(p.days[1].sessions.map((s) => [s.room.id, s]));
  assert.ok([C.en1, C.en2, C.en3].includes(t0.en.subject.id));
  assert.strictEqual(t0.mi.subject.id, C.bac1);
  assert.strictEqual(t0.sn.subject.id, C.bac2);
  assert.strictEqual(t0.teh.subject, null, 'niciun subiect de tehnologic cu barem → sala așteaptă, nu primește alt profil');
  assert.strictEqual(t0.teh.examLabel, 'BAC Tehnologic');
  assert.ok(!p.days.flatMap((d) => d.sessions).some((s) => s.subject?.id === C.bacPed), 'fără BAC pedagogic');
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
  assert.strictEqual(fake.db.tables.live_sessions.filter((s) => s.kind === 'grup').length, 8);
});

// o ședință de grup (implicit: a început acum 10 minute), cu lecția gata
function liveGroupSession({ startsInMin = -10 } = {}) {
  const today = L.dayKey(new Date());
  const t0 = Date.now() + startsInMin * 60000;
  const s = { id: 'cccccccc-0000-4000-8000-000000000001', kind: 'grup', day: today, slot: '17-en', teacher: 'radu', exam: 'en', profile: null, subject_id: C.en1, starts_at: iso(t0), ends_at: iso(t0 + 120 * 60000), status: 'programata', state: {}, created_at: iso(now - 86400000), updated_at: iso(now - 86400000) };
  const script = lessonScript();
  const lesson = { id: 'dddddddd-0000-4000-8000-000000000001', subject_id: C.en1, teacher: 'radu', version: 1, status: 'gata', title: script.title, exam: 'en', profile: null, script, progress: { audio: {}, noVoice: true, total: LL.segmentsInOrder(script).length, done: 0 }, cost_micro: 0, created_at: iso(now - 3600000), updated_at: iso(now - 3600000) };
  return { s, lesson };
}

const TICKET = (sessionId) => ({ id: 'eeeeeeee-0000-4000-8000-000000000001', user_id: U.free, kind: 'grup', session_id: sessionId, status: 'platit', created_at: iso(now) });

// doi elevi intră în sala de așteptare; vine ora de început → pornește ședința COMUNĂ
async function groupStartedWithTwo() {
  const { s, lesson } = liveGroupSession({ startsInMin: 5 });
  fake = createFakeSupabase({ ...seed(), live_sessions: [s], live_lessons: [lesson], live_tickets: [TICKET(s.id)] });
  await call('join', { sessionId: s.id }, U.free);
  await call('join', { sessionId: s.id }, U.prem);
  fake.db.tables.live_sessions[0].starts_at = iso(Date.now() - 1000);        // a sosit ora de început
  const r = await call('timeline', { sessionId: s.id }, U.prem);
  return { s, lesson, r };
}

test('sala de așteptare: nu pornește nimic înainte de ora de început; cu 2 elevi → ședința comună', async () => {
  const { s, lesson } = liveGroupSession({ startsInMin: 5 });
  fake = createFakeSupabase({ ...seed(), live_sessions: [s], live_lessons: [lesson], live_tickets: [TICKET(s.id)] });
  const a = await call('join', { sessionId: s.id }, U.free);
  assert.strictEqual(a.statusCode, 200, JSON.stringify(a.body));
  assert.strictEqual(a.body.session.startedAt, null, 'înainte de oră: sala de așteptare');
  assert.strictEqual(a.body.session.mode, null);
  assert.ok(a.body.timeline, 'lecția se vede deja (numărătoarea)');
  const b = await call('join', { sessionId: s.id }, U.prem);
  assert.strictEqual(b.body.session.startedAt, null);
  const g = await groupStartedWithTwo();
  assert.ok(g.r.body.startedAt, 'ceasul comun a pornit');
  assert.strictEqual(g.r.body.mode, null);
  assert.ok(!g.r.body.timeline.scenes.some((x) => x.type === 'intrebare_intelegere'), 'cronologia de grup');
  const st = fake.db.tables.live_sessions[0];
  assert.strictEqual(st.status, 'activa');
  assert.ok(st.state.tl && Object.keys(st.state.tl.polls).length >= 2);
  // al doilea elev vede același ceas
  const other = await call('timeline', { sessionId: s.id }, U.free);
  assert.strictEqual(other.body.startedAt, g.r.body.startedAt);
});

test('un singur elev la ora de început → ședința devine 1-la-1 (fără cost în plus); cine vine apoi are și el 1-la-1', async () => {
  const { s, lesson } = liveGroupSession({ startsInMin: -1 });
  fake = createFakeSupabase({ ...seed(), live_sessions: [s], live_lessons: [lesson] });
  const r = await call('join', { sessionId: s.id }, U.prem);
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.session.mode, 'individual');
  assert.strictEqual(r.body.session.modeWhy, 'singur', 'sala îi spune de ce e 1-la-1');
  assert.strictEqual(r.body.session.startedAt, null);
  assert.ok(r.body.timeline.scenes.some((x) => x.type === 'intrebare_intelegere'), 'cronologia 1-la-1 („Ai înțeles?")');
  assert.strictEqual(fake.db.tables.live_sessions[0].state.mode, 'individual');
  // întrebările: fără fereastră de timp, răspunsul corect vine imediat (ca la 1-la-1)
  const pollId = r.body.timeline.scenes.find((x) => x.type === 'sondaj').poll.id;
  const pa = await call('poll_answer', { sessionId: s.id, pollId, answer: 'a' }, U.prem);
  assert.strictEqual(pa.statusCode, 200, JSON.stringify(pa.body));
  assert.strictEqual(pa.body.correct, false);
  assert.strictEqual(pa.body.answer, 'b');
  // chatul: profesorul răspunde la orice, doar elevului care a întrebat
  const c = await call('chat', { sessionId: s.id, text: 'nu am înțeles pasul doi' }, U.prem);
  assert.strictEqual(c.statusCode, 200, JSON.stringify(c.body));
  assert.ok(c.body.answer && c.body.answer.role === 'profesor');
  assert.strictEqual(c.body.answer.private, true);
  assert.ok(c.body.answer.say, 'textul de rostit (fără LaTeX)');
  // al doilea elev intră mai târziu: tot 1-la-1, și NU vede conversația primului
  fake.db.tables.live_tickets = [TICKET(s.id)];
  const r2 = await call('join', { sessionId: s.id }, U.free);
  assert.strictEqual(r2.body.session.mode, 'individual');
  assert.strictEqual(r2.body.messages.length, 0);
  const mine = await call('messages', { sessionId: s.id }, U.prem);
  assert.strictEqual(mine.body.messages.length, 2, 'întrebarea lui + răspunsul profesorului');
});

test('ședința comună s-a terminat, dar ora nu: cine intră târziu primește lecția 1-la-1', async () => {
  const { s, lesson } = liveGroupSession({ startsInMin: -60 });
  s.state = { startedAt: iso(Date.now() - 55 * 60000), tl: { stamp: 'x', duration: 1800, polls: {}, qna: [], keys: {} }, lessonId: lesson.id };
  s.status = 'activa';
  fake = createFakeSupabase({ ...seed(), live_sessions: [s], live_lessons: [lesson] });
  const r = await call('join', { sessionId: s.id }, U.prem);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.session.mode, 'individual');
  assert.ok(r.body.timeline.scenes.some((x) => x.type === 'intrebare_intelegere'));
  // cine era deja în sală apasă „Continuă 1-la-1" (cere cronologia din nou)
  const t = await call('timeline', { sessionId: s.id }, U.prem);
  assert.strictEqual(t.statusCode, 200, JSON.stringify(t.body));
  assert.strictEqual(t.body.mode, 'individual');
  assert.strictEqual(t.body.modeWhy, 'dupa');
  assert.ok(t.body.timeline.scenes.some((x) => x.type === 'intrebare_intelegere'));
  // chatul devine privat: profesorul îi răspunde doar lui
  const c = await call('chat', { sessionId: s.id, text: 'Cum se rezolvă ultimul exercițiu?' }, U.prem);
  assert.strictEqual(c.statusCode, 200, JSON.stringify(c.body));
  assert.strictEqual(c.body.answer.private, true);
});

test('intrarea în sală: fără abonament → plata; cu bilet → cronologia, ceasul comun pornește', async () => {
  const { s, lesson } = liveGroupSession({ startsInMin: 5 });
  fake = createFakeSupabase({ ...seed(), live_sessions: [s], live_lessons: [lesson] });
  const r1 = await call('join', { sessionId: s.id }, U.free);
  assert.strictEqual(r1.statusCode, 402);
  assert.strictEqual(r1.body.code, 'LIVE_PAYMENT');
  assert.strictEqual(r1.body.price, 10);
  assert.strictEqual(r1.body.teacher.name, 'Prof. Radu');
  // biletul (cum îl scrie webhook-ul Stripe)
  fake.db.tables.live_tickets = [TICKET(s.id)];
  const r2 = await call('join', { sessionId: s.id }, U.free);
  assert.strictEqual(r2.statusCode, 200, JSON.stringify(r2.body));
  assert.strictEqual(r2.body.access, 'bilet');
  assert.ok(r2.body.timeline && r2.body.timeline.scenes.length > 3, 'cronologia lecției');
  assert.strictEqual(r2.body.noVoice, true);
  assert.strictEqual(r2.body.timeline.noVoice, true, 'playerul știe că vorbește vocea browserului');
  assert.strictEqual(r2.body.channel, `live:${s.id}`);
  // abonatul intră fără bilet
  const r3 = await call('join', { sessionId: s.id }, U.prem);
  assert.strictEqual(r3.statusCode, 200);
  assert.strictEqual(r3.body.access, 'abonament');
  assert.strictEqual(fake.db.tables.live_participants.length, 2);
  // prezența
  const hb = await call('heartbeat', { sessionId: s.id, seconds: 60 }, U.free);
  assert.strictEqual(hb.body.present, 2);
});

test('chatul: moderare, ritmul mesajelor, profesorul răspunde doar la întrebări', async () => {
  const { s } = await groupStartedWithTwo();
  const chatCalls0 = calls.chat;
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
  assert.strictEqual(calls.chat - chatCalls0, 1, 'un singur apel la model (doar pentru întrebare)');
  // cine nu are acces nu poate scrie (biletul e al altei ședințe)
  fake.db.tables.live_tickets = [];
  const other = await call('chat', { sessionId: s.id, text: 'salut' }, U.free);
  assert.strictEqual(other.statusCode, 402);
  // mesajele (plasa de siguranță): mesajul lui + răspunsul profesorului
  const list = await call('messages', { sessionId: s.id }, U.prem);
  assert.strictEqual(list.body.messages.length, 3);
  assert.ok(list.body.messages.every((m) => m.author !== 'Andrei Ionescu'), 'numele complet nu apare');
});

test('întrebările: doar în fereastra lor de timp; corectitudinea după barem; rezultatele clasei', async () => {
  const { s } = await groupStartedWithTwo();
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
  // mâine: ședințele de azi s-ar putea să se fi încheiat deja (după 19:00), fără subiect
  const ov = await call('admin_overview', { day: L.addDays(L.dayKey(new Date()), 1) }, U.admin);
  assert.strictEqual(ov.statusCode, 200, JSON.stringify(ov.body));
  assert.strictEqual(ov.body.sessions.length, 4);
  assert.ok(ov.body.subjects.en.length === 3 && ov.body.subjects.bac.length === 2, 'fără pedagogic');
  assert.deepStrictEqual(ov.body.rooms.map((r) => `${r.id}:${r.subjects}`), ['en:3', 'mi:1', 'sn:1', 'teh:0']);
  // nota nu șterge subiectul; un subiect de alt examen nu intră în sală
  const enRoom = ov.body.sessions.find((x) => x.room.id === 'en');
  const note = await call('admin_set_subject', { sessionId: enRoom.id, note: 'test' }, U.admin);
  assert.strictEqual(note.body.session.subject_id, enRoom.subject.id);
  assert.strictEqual(note.body.session.admin_note, 'test');
  const wrong = await call('admin_set_subject', { sessionId: enRoom.id, subjectId: C.bac1 }, U.admin);
  assert.strictEqual(wrong.statusCode, 400);
  assert.match(wrong.body.error, /Evaluarea Națională/);
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
    assert.strictEqual(res.body.sessions, 8);
    assert.deepStrictEqual(res.body.errors, []);
    assert.deepStrictEqual(res.body.emptyRooms, ['teh'], 'cronul știe ce sală n-are subiecte (citește întâi baremele ei)');
  } finally { ai.isCronRequest = origCron; }
  // fără secret → refuzat
  const res2 = fakeRes();
  await handler({ method: 'GET', headers: {}, query: { action: 'cron' }, body: {} }, res2);
  assert.strictEqual(res2.statusCode, 405);
});

async function runCron() {
  const origCron = ai.isCronRequest;
  ai.isCronRequest = () => true;
  try {
    const res = fakeRes();
    await handler({ method: 'GET', headers: {}, query: { action: 'cron' }, body: {} }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    return res.body;
  } finally { ai.isCronRequest = origCron; }
}

test('cronul economic: fără elevi nu se scrie nicio lecție; cu un bilet → doar lecția aceea', async () => {
  fake = createFakeSupabase(seed());
  const prevOre = process.env.LIVE_PREGATIRE_ORE;
  process.env.LIVE_PREGATIRE_ORE = '48';                  // toate ședințele următoare intră în orizont
  try {
    const script0 = calls.script;
    const r1 = await runCron();
    assert.deepStrictEqual(r1.prepared, [], 'nimeni nu vine → nicio lecție scrisă (niciun cost)');
    assert.ok(r1.skipped >= 3, `sărite: ${r1.skipped}`);
    assert.strictEqual(calls.script, script0);
    // un elev cumpără bilet la o ședință de mâine → lecția ei se scrie la următoarea rulare
    const target = fake.db.tables.live_sessions.find((x) => x.subject_id && Date.parse(x.starts_at) > Date.now() && x.day !== L.dayKey(new Date()));
    fake.db.tables.live_tickets = [TICKET(target.id)];
    const r2 = await runCron();
    assert.strictEqual(r2.prepared.length, 1, JSON.stringify(r2.prepared));
    assert.strictEqual(r2.prepared[0].session, target.id);
    assert.strictEqual(r2.prepared[0].status, 'gata');
    assert.strictEqual(calls.script, script0 + 1);
    // a treia rulare: nimic de făcut (lecția e gata, refolosită)
    const r3 = await runCron();
    assert.deepStrictEqual(r3.prepared, []);
    assert.strictEqual(calls.script, script0 + 1);
  } finally {
    if (prevOre === undefined) delete process.env.LIVE_PREGATIRE_ORE; else process.env.LIVE_PREGATIRE_ORE = prevOre;
  }
});

test('vocea generată: dacă eșuează → vocea browserului (ședința nu se blochează); cu cheia bună → „Generează vocea"', async () => {
  const tts = require('../api/_lib/tts');
  const origVoice = tts.voiceSegment;
  process.env.AZURE_SPEECH_KEY = 'cheie-test'; process.env.AZURE_SPEECH_REGION = 'westeurope';
  try {
    fake = createFakeSupabase(seed());
    tts.voiceSegment = async () => { throw new Error('401 Unauthorized'); };
    const bad = await call('admin_prepare', { subjectId: C.en1, teacher: 'radu' }, U.admin);
    assert.strictEqual(bad.statusCode, 200, JSON.stringify(bad.body));
    assert.strictEqual(bad.body.lesson.status, 'gata');
    assert.strictEqual(bad.body.lesson.noVoice, true, 'merge cu vocea browserului');
    const row = () => fake.db.tables.live_lessons.find((l) => l.subject_id === C.en1);
    assert.match(row().error || '', /vocea generată a eșuat/);
    // cheia e reparată → adminul apasă „Generează vocea"
    let n = 0;
    tts.voiceSegment = async ({ }, { path }) => { n++; return { url: `https://x/${path}.mp3`, dur: 2.5, lip: [], cost: 10 }; };
    const good = await call('admin_prepare', { subjectId: C.en1, teacher: 'radu', revoice: true }, U.admin);
    assert.strictEqual(good.statusCode, 200, JSON.stringify(good.body));
    assert.strictEqual(good.body.lesson.status, 'gata');
    assert.strictEqual(good.body.lesson.noVoice, false);
    assert.strictEqual(Object.keys(row().progress.audio).length, row().progress.total);
    assert.strictEqual(n, row().progress.total);
    assert.strictEqual(row().error, null);
  } finally {
    tts.voiceSegment = origVoice;
    delete process.env.AZURE_SPEECH_KEY; delete process.env.AZURE_SPEECH_REGION;
  }
});

test('fără tabele (SQL nerulat) → mesaj clar pentru admin, nu o eroare obscură', async () => {
  fake = createFakeSupabase(seed());
  fake.db.failTables.add('live_sessions');
  const r = await call('program');
  assert.strictEqual(r.statusCode, 503);
  assert.match(r.body.error, /meditatii_live\.sql/);
  assert.strictEqual(r.body.code, 'LIVE_SETUP');
});
