// Teste pentru cererea din 26 oct. 2026 (punctul 1): „în «meditații live» arată 1-3 minute de
// pregătire lecție, dar durează mult până se pregătește o lecție live, iar un elev și-ar putea pierde
// interesul. Pune o notificare când se termină și poate intra elevul."
//   · estimarea reală (prepEta, din lecțiile scrise până acum) în locul lui „1–3 / 2–4 minute";
//   · progresul pe etape (status): bucățile scrise, întrebările, vocea începutului;
//   · 1-la-1: un singur apel lung (untilPlayable) — textul + vocea DOAR a începutului, apoi lecția
//     poate porni; momentele lui (scriptSec, headSec) hrănesc estimarea;
//   · „🔔 Anunță-mă când e gata": abonarea Web Push + cererea pe ședință; la final, notificarea —
//     o singură dată, doar cui a cerut-o, și cu pagina închisă; „Meditația a început" la grup;
//   · browserul: sunet, titlul tabului, notificarea de sistem; cardul „e gata — ▶ Începe" când
//     elevul era în alt tab (cele 60 de minute pornesc abia la clic).
process.env.LIVE_GEN_MODEL = 'gpt-5.6-terra';
process.env.LIVE_TTS_PAUZA_MS = '0';
process.env.LIVE_DESENE = '0';
process.env.VAPID_PUBLIC_KEY = 'BOrUeLR3c0gK3_Kq3aU2y7aN-test-public-key-0123456789abcdefghijklmnopqrstuvwxyz';
process.env.VAPID_PRIVATE_KEY = 'test-private-key';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const L = require('../api/_lib/live');
const LL = require('../api/_lib/liveLesson');
const tts = require('../api/_lib/tts');
const pdf = require('../api/ai-pdf-context');
const PUSH = require('../api/_lib/push');
const webpush = require('web-push');
const handler = require('../api/live');
const { etaFrom, prepEta, notifyLessonReady, notifySession, resetCaches, cron } = handler._internals;

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const U = { prem: '22222222-2222-4222-8222-222222222222', other: '44444444-4444-4444-8444-444444444444' };
const C = { en1: 'aaaaaaaa-0000-4000-8000-000000000001' };
const BAREM_TEXT = 'BAREM DE EVALUARE ȘI DE NOTARE. SUBIECTUL I. Rezultate: 1. b 2. b. Se punctează orice modalitate corectă de rezolvare.';
const iso = (ms) => new Date(ms).toISOString();
const ago = (min) => iso(Date.now() - min * 60000);
const later = (min) => iso(Date.now() + min * 60000);
const teacher = L.teacherById('radu');
function seed() {
  return {
    profiles: [
      { id: U.prem, full_name: 'Andrei Ionescu', email: 'andrei@example.com', subscription_status: 'active', role: 'elev', is_admin: false },
      { id: U.other, full_name: 'Maria Pop', email: 'maria@example.com', subscription_status: 'active', role: 'elev', is_admin: false },
    ],
    content: [{ id: C.en1, title: 'EN 2024 Varianta 7', category: 'evaluare-nationala', subcategory: null, profile: null, content_type: 'pdf', file_url: `https://x/${C.en1}.pdf`, is_free: true, created_at: '2026-01-01T00:00:00Z' }],
    ai_pdf_text: [{ content_id: C.en1, barem_status: 'ok', barem: { title: 'Barem' }, barem_text: BAREM_TEXT, text: 'SUBIECTUL I ...' }],
    app_settings: [{ key: 'live_free_lessons', value: { subjects: [] } }],
  };
}
// lecția (6 grile de la Subiectul I), ca una scrisă de model
const seg = (say, board = []) => ({ say, board });
function rawItem(n) {
  return {
    ref: `I.${n}`, title: `Subiectul I, exercițiul ${n}`, kind: 'grila', statement: `Rezultatul calculului $${n} + 3 \\cdot 4$ este:`,
    options: ['1', String(n + 12), '3', '4'], answer: 'b', points: 5, barem: 'b 5p',
    intro: [seg(`Exercițiul ${n}.`)], tryPoll: { type: 'grila', question: 'Rezultatul?', options: ['1', String(n + 12), '3', '4'], answer: 'b', explain: '' },
    afterTry: [seg('Să vedem răspunsul corect.')],
    modes: { barem: [seg(`Întâi înmulțirea, apoi adunarea: ${n + 12}.`, [`$${n} + 12 = ${n + 12}$`])], intuitiv: [seg('Înmulțirea leagă mai tare.')], greseli: [seg('Nu adunați întâi.')], alta_metoda: null },
    check: null, afterCheck: [],
  };
}
function lessonScript() {
  const items = LL.normalizeItems([1, 2, 3, 4, 5, 6].map(rawItem), { section: 'I', exam: 'en', grile: { I: { 1: 'b', 2: 'b', 3: 'b', 4: 'b', 5: 'b', 6: 'b' } }, baremText: '' });
  return LL.assignIds({ title: 'EN 2024 Varianta 7', exam: 'en', teacher: 'radu', teacherName: teacher.name, pasi: LL.PASI_V, v: 2, ...LL.templates(teacher, { title: 'EN 2024 Varianta 7', exam: 'en' }), items });
}

// ─── înlocuirile (fără rețea) ─────────────────────────────────────────────────
let fake = null;
ai.admin = () => fake;
ai.authUser = async (req) => {
  const u = req.headers['x-user'];
  if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; }
  return u;
};
ai.logUsage = async () => {};
const writes = [];
LL.generateScript = async ({ onProgress }) => {
  // scrisul, pe bucăți: progresul ajunge în sala de așteptare
  for (const done of [1, 2, 3]) { await onProgress?.({ phase: 'scriere', done, total: 3 }); writes.push(done); }
  await new Promise((ok) => setTimeout(ok, 1100));          // ≥ 1 s: momentele intră în estimare
  return { script: lessonScript(), usage: { model: 'test', input_tokens: 100, output_tokens: 100 } };
};
pdf.getPdfContext = async () => ({ text: 'SUBIECTUL I', baremText: BAREM_TEXT, baremStatus: 'ok' });
pdf.downloadContentPdf = async () => { throw new Error('fără rețea în teste'); };
const voiced = [];
tts.provider = () => 'openai';
tts.voiceSegment = async (supa, { path: p }) => { voiced.push(p); return { url: `https://x/${p}.mp3`, dur: 2, lip: null, provider: 'openai', cost: 10 }; };
// Web Push: notificările „trimise" (fără rețea); `pushFail(endpoint)` → codul de eroare al serviciului
const sent = [];
let pushFail = () => 0;
webpush.sendNotification = async (sub, body, opts) => {
  const code = pushFail(sub.endpoint);
  if (code) { const e = new Error('push'); e.statusCode = code; throw e; }
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body), opts });
  return { statusCode: 201 };
};
const SUB = (n = 1) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/abc${n}-${'x'.repeat(30)}`, keys: { p256dh: `BP${'q'.repeat(80)}`, auth: 'authsecret123456' } });

test.beforeEach(() => { resetCaches(); sent.length = 0; voiced.length = 0; writes.length = 0; pushFail = () => 0; });

async function call(action, body = {}, user = null) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: user ? { 'x-user': user, 'user-agent': 'Mozilla/5.0 (Android) Chrome/130' } : {}, query: {}, body: { action, ...body } }, res);
  return res;
}
const participant = (sid, uid) => fake.db.tables.live_participants.find((p) => p.session_id === sid && p.user_id === uid);

// ─── 1. Estimarea ────────────────────────────────────────────────────────────
test('estimarea: fără date — valorile tipice (Claude scrie în câteva minute, nu „1–3"); cu date — mediana și sferturile', () => {
  const none = etaFrom([], { claude: true });
  assert.deepStrictEqual([none.script, none.head, none.sec, none.n], [270, 45, 315, 0]);
  assert.strictEqual(none.label, '4–8 minute');
  assert.ok(none.minLo >= 3, 'nu mai promitem „1–3 minute"');
  assert.strictEqual(etaFrom([], { claude: false }).label, '2–4 minute', 'modelul de rezervă scrie mai repede');
  const rows = [200, 240, 260, 300, 330, 600].map((s) => ({ scriptSec: s, headSec: 40 }));
  const e = etaFrom(rows, { claude: true });
  assert.strictEqual(e.n, 6);
  assert.strictEqual(e.script, 300, 'mediana');
  assert.strictEqual(e.head, 40);
  assert.strictEqual(e.lo, 240 + 40);
  assert.strictEqual(e.hi, 330 + 40);
  assert.strictEqual(e.label, '4–7 minute');
  assert.strictEqual(e.scriptLabel, '4–6 minute', 'doar textul (Pregătirea de examen)');
  assert.strictEqual(none.scriptLabel, '3–7 minute');
  // valorile absurde (o lecție scrisă în 2 s, una „în 3 ore") nu strică media
  assert.strictEqual(etaFrom([{ scriptSec: 2 }, { scriptSec: 10800 }, { scriptSec: 'x' }], { claude: true }).n, 0);
});

test('estimarea vine din lecțiile scrise (progress.scriptSec / headSec) și apare în lobby în locul lui „2–4 min"', async () => {
  fake = createFakeSupabase({ ...seed(), live_lessons: [130, 150, 170, 190].map((s, i) => ({ id: `dddddddd-0000-4000-8000-00000000000${i}`, subject_id: `s${i}`, teacher: 'radu', version: 1, status: 'gata', progress: { scriptSec: s, headSec: 30 }, updated_at: ago(i) })) });
  const e = await prepEta(fake, { fresh: true });
  assert.strictEqual(e.n, 4);
  assert.deepStrictEqual([e.script, e.head, e.lo, e.hi], [170, 30, 150 + 30, 170 + 30]);
  assert.strictEqual(e.label, '3–4 minute');
  const prog = await call('program', {}, U.prem);
  assert.strictEqual(prog.statusCode, 200, JSON.stringify(prog.body));
  assert.strictEqual(prog.body.prepEta.label, '3–4 minute');
  const page = read('src/pages/MeditatiiLive.jsx');
  assert.ok(!/2–4 min pregătire|\(2–4 minute\)/.test(page), 'fără eticheta fixă de dinainte');
  assert.ok(page.includes('data?.prepEta?.label'));
  const admin = read('src/components/LiveAdmin.jsx');
  assert.ok(!/1–3 minute|1-3 minute/.test(admin));
  // Pregătirea de examen (aceeași scriere de lecție): estimarea reală + sunetul când e gata
  const prep = read('src/pages/PregatireExamen.jsx');
  assert.ok(!prep.includes('Durează 1–2 minute') && prep.includes('st?.prepEta?.scriptLabel'));
  assert.ok(prep.includes('sunaGata()') && prep.includes('flashTitle('));
  assert.ok(read('api/live.js').includes('prepEta: await prepEta(supa),\n    now: new Date().toISOString(),'), 'prep_state trimite estimarea');
});

// ─── 2. Sala de așteptare 1-la-1, de la început la sfârșit ─────────────────────
test('1-la-1: „🔔 Anunță-mă" → pregătirea (textul + vocea începutului) → notificarea, o singură dată', async () => {
  fake = createFakeSupabase({ ...seed() });
  const st = await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.prem);
  assert.strictEqual(st.statusCode, 200, JSON.stringify(st.body));
  const sid = st.body.sessionId;
  // intrarea: lecția nu e gata; cheia Web Push + estimarea
  const join = await call('join', { sessionId: sid }, U.prem);
  assert.strictEqual(join.statusCode, 200, JSON.stringify(join.body));
  assert.ok(!join.body.timeline, 'lecția nu e gata');
  assert.deepStrictEqual(join.body.notify, { push: process.env.VAPID_PUBLIC_KEY, setup: true, asked: false });
  assert.ok(join.body.eta && join.body.eta.label);
  // „🔔 Anunță-mă când e gata" (cu abonarea browserului)
  const n = await call('notify', { sessionId: sid, subscription: SUB(1) }, U.prem);
  assert.deepStrictEqual(n.body, { ok: true, setup: true, on: true, push: true });
  assert.strictEqual(fake.db.tables.push_subscriptions.length, 1);
  assert.strictEqual(fake.db.tables.push_subscriptions[0].user_id, U.prem);
  assert.ok(participant(sid, U.prem).notify_at);
  // progresul, fără să pregătească nimic (înainte de pregătire)
  const s0 = await call('status', { sessionId: sid }, U.prem);
  assert.strictEqual(s0.statusCode, 200, JSON.stringify(s0.body));
  assert.strictEqual(s0.body.lesson.playable, false);
  assert.ok(s0.body.eta.label);
  assert.strictEqual((await call('status', { sessionId: sid }, U.other)).statusCode, 403, 'doar cine a intrat');
  // pregătirea: un singur apel lung
  const prep = await call('prepare', { sessionId: sid, untilPlayable: true, budgetMs: 240000 }, U.prem);
  assert.strictEqual(prep.statusCode, 200, JSON.stringify(prep.body));
  assert.strictEqual(prep.body.lesson.playable, true);
  assert.strictEqual(prep.body.lesson.status, 'audio', 'vocea începutului e gata, restul continuă (cronul / 1-la-1)');
  const row = fake.db.tables.live_lessons[0];
  const sc = row.script;
  const head = LL.headSegments(sc).length;
  assert.ok(voiced.length >= head && voiced.length < LL.segmentsInOrder(sc).length, `${voiced.length} fraze: începutul (${head}), nu toată lecția`);
  assert.deepStrictEqual(writes, [1, 2, 3]);
  // momentele pregătirii: estimarea de data viitoare
  const p = row.progress;
  assert.ok(p.startedAt && p.scriptAt && p.playableAt, JSON.stringify(Object.keys(p)));
  assert.ok(p.scriptSec >= 1, `scriptSec ${p.scriptSec}`);
  assert.ok(p.headSec >= 0);
  assert.deepStrictEqual(p.head, { done: head, total: head });
  // notificarea: „✅ Prof. Tudor e gata!", la sala lui
  assert.strictEqual(sent.length, 1, JSON.stringify(sent));
  assert.strictEqual(sent[0].payload.title, `✅ ${teacher.name} e gata!`);
  assert.match(sent[0].payload.body, /EN 2024 Varianta 7/);
  assert.strictEqual(sent[0].payload.url, `/meditatii/sala/${sid}`);
  assert.strictEqual(sent[0].payload.tag, `live-${sid}`);
  assert.strictEqual(sent[0].opts.urgency, 'high');
  assert.ok(participant(sid, U.prem).notified_at);
  // status: lecția se poate porni
  const s1 = await call('status', { sessionId: sid }, U.prem);
  assert.strictEqual(s1.body.lesson.playable, true);
  assert.deepStrictEqual(s1.body.lesson.head, { done: head, total: head });
  // a doua pregătire / o reîncercare: nicio notificare în plus
  await call('prepare', { sessionId: sid, untilPlayable: true, budgetMs: 30000 }, U.prem);
  await notifyLessonReady(fake, row);
  assert.strictEqual(sent.length, 1, 'o singură dată');
  // intră din nou: nu mai e „ceruta"
  const again = await call('join', { sessionId: sid }, U.prem);
  assert.strictEqual(again.body.notify.asked, false);
  assert.ok(again.body.timeline, 'lecția pornește');
});

test('1-la-1: lecția gata deja la intrare (sau pornită) → nicio notificare întârziată; „Nu mai anunța"', async () => {
  fake = createFakeSupabase({ ...seed() });
  const sid = (await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.prem)).body.sessionId;
  await call('join', { sessionId: sid }, U.prem);
  await call('notify', { sessionId: sid, subscription: SUB(2) }, U.prem);
  // „Nu mai anunța"
  const off = await call('notify', { sessionId: sid, off: true }, U.prem);
  assert.deepStrictEqual([off.body.ok, off.body.on], [true, false]);
  assert.strictEqual(participant(sid, U.prem).notify_at, null);
  await call('prepare', { sessionId: sid, untilPlayable: true, budgetMs: 240000 }, U.prem);
  assert.strictEqual(sent.length, 0, 'a renunțat la notificare');
  // ceruta din nou, dar lecția e deja gata când intră → marcată, fără notificare
  await call('notify', { sessionId: sid }, U.prem);
  const j = await call('join', { sessionId: sid }, U.prem);
  assert.strictEqual(j.body.notify.asked, false);
  assert.ok(participant(sid, U.prem).notified_at, 'e deja aici');
  await notifyLessonReady(fake, fake.db.tables.live_lessons[0]);
  assert.strictEqual(sent.length, 0);
  // pornită → nici atât
  const begin = await call('private_begin', { sessionId: sid }, U.prem);
  assert.strictEqual(begin.statusCode, 200, JSON.stringify(begin.body));
  assert.strictEqual(sent.length, 0);
});

test('fără SQL-ul notificărilor (push_subscriptions lipsă): sala merge ca înainte — sunetul și notificarea din pagină', async () => {
  fake = createFakeSupabase({ ...seed() });
  fake.db.failTables.add('push_subscriptions');
  const sid = (await call('private_start', { teacher: 'radu', subjectId: C.en1 }, U.prem)).body.sessionId;
  const j = await call('join', { sessionId: sid }, U.prem);
  assert.strictEqual(j.statusCode, 200, JSON.stringify(j.body));
  assert.strictEqual(j.body.notify.push, null, 'fără cheie: browserul nu se abonează');
  const n = await call('notify', { sessionId: sid, subscription: SUB(3) }, U.prem);
  assert.deepStrictEqual([n.body.ok, n.body.push], [true, false]);
  const prep = await call('prepare', { sessionId: sid, untilPlayable: true, budgetMs: 240000 }, U.prem);
  assert.strictEqual(prep.body.lesson.playable, true);
  assert.strictEqual(sent.length, 0);
  assert.strictEqual(await notifyLessonReady(fake, fake.db.tables.live_lessons[0]), 0);
});

// ─── 3. Web Push: abonările, cheile, erorile ──────────────────────────────────
test('abonările: validate; cel mult 6 pe elev; cele expirate (404/410) se șterg, cele care eșuează de 8 ori la fel', async () => {
  assert.strictEqual(PUSH.cleanSubscription({ endpoint: 'http://x', keys: { p256dh: 'a', auth: 'b' } }), null, 'doar https');
  assert.strictEqual(PUSH.cleanSubscription({ endpoint: SUB().endpoint, keys: { p256dh: 'scurt', auth: 'authsecret123456' } }), null);
  assert.ok(PUSH.cleanSubscription(SUB()));
  fake = createFakeSupabase({ ...seed() });
  for (let i = 1; i <= 8; i++) assert.strictEqual(await PUSH.saveSubscription(fake, U.prem, SUB(i), 'UA'), true);
  assert.strictEqual(fake.db.tables.push_subscriptions.length, 6, 'cele mai vechi pleacă');
  assert.strictEqual(await PUSH.saveSubscription(fake, U.prem, { endpoint: 'nu' }, 'UA'), false);
  // trimiterea: una expirată (410), una cu eroare temporară (500), restul ajung
  const subs = fake.db.tables.push_subscriptions.map((s) => s.endpoint);
  pushFail = (ep) => (ep === subs[0] ? 410 : ep === subs[1] ? 500 : 0);
  const r = await PUSH.sendToUser(fake, U.prem, { title: 't', body: 'b', url: '/x' });
  assert.deepStrictEqual(r, { sent: 4, failed: 1, gone: 1 });
  assert.ok(!fake.db.tables.push_subscriptions.some((s) => s.endpoint === subs[0]), 'expirata, ștearsă');
  assert.strictEqual(fake.db.tables.push_subscriptions.find((s) => s.endpoint === subs[1]).fails, 1);
  fake.db.tables.push_subscriptions.find((s) => s.endpoint === subs[1]).fails = 7;
  await PUSH.sendToUser(fake, U.prem, { title: 't' });
  assert.ok(!fake.db.tables.push_subscriptions.some((s) => s.endpoint === subs[1]), 'a opta eroare la rând → ștearsă');
  await PUSH.removeSubscription(fake, U.prem, subs[2]);
  assert.ok(!fake.db.tables.push_subscriptions.some((s) => s.endpoint === subs[2]));
});

test('cheile VAPID: din Vercel, sau generate o singură dată de server (app_settings, citit doar de server)', async () => {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  try {
    fake = createFakeSupabase({ ...seed() });
    PUSH.resetCache();
    const info = await PUSH.pushInfo(fake);
    assert.strictEqual(info.on, true, JSON.stringify(info));
    const stored = fake.db.tables.app_settings.find((r) => r.key === 'web_push_vapid');
    assert.ok(stored && stored.value.publicKey === info.key && stored.value.privateKey);
    PUSH.resetCache();
    assert.strictEqual((await PUSH.vapidKeys(fake)).publicKey, info.key, 'aceeași pereche la fiecare instanță');
    assert.strictEqual(fake.db.tables.app_settings.filter((r) => r.key === 'web_push_vapid').length, 1);
  } finally { process.env.VAPID_PUBLIC_KEY = pub; process.env.VAPID_PRIVATE_KEY = priv; PUSH.resetCache(); }
  assert.strictEqual((await PUSH.vapidKeys(fake)).from, 'env');
  assert.ok(/^mailto:|^https:\/\//.test(PUSH.subject()));
});

// ─── 4. Grup: „Meditația a început" ──────────────────────────────────────────
test('grup: cine a cerut notificarea în sala de așteptare primește „🔴 Meditația a început" la pornire (o dată)', async () => {
  const script = lessonScript();
  const lesson = { id: 'dddddddd-0000-4000-8000-000000000009', subject_id: C.en1, teacher: 'radu', version: 1, status: 'gata', title: script.title, exam: 'en', profile: null, script, progress: { audio: {}, noVoice: true, total: LL.segmentsInOrder(script).length, done: 0 }, cost_micro: 0, created_at: ago(60), updated_at: ago(60) };
  const s = { id: 'cccccccc-0000-4000-8000-000000000009', kind: 'grup', day: L.dayKey(new Date()), slot: '17-en', teacher: 'radu', exam: 'en', profile: null, subject_id: C.en1, starts_at: later(10), ends_at: later(130), status: 'programata', state: {}, created_at: ago(600), updated_at: ago(600) };
  fake = createFakeSupabase({ ...seed(), live_sessions: [s], live_lessons: [lesson] });
  await call('join', { sessionId: s.id }, U.prem);
  await call('notify', { sessionId: s.id, subscription: SUB(4) }, U.prem);
  // lecția e gata, dar ora n-a sosit → nimic
  assert.strictEqual(await notifyLessonReady(fake, lesson), 0);
  assert.strictEqual(sent.length, 0);
  // a sosit ora: cronul trimite (o singură dată)
  fake.db.tables.live_sessions[0].starts_at = ago(1);
  const rep = await cron(fake);
  assert.strictEqual(rep.notified, 1, JSON.stringify(rep.errors));
  assert.strictEqual(sent.length, 1);
  assert.strictEqual(sent[0].payload.title, '🔴 Meditația a început');
  assert.match(sent[0].payload.body, new RegExp(`${teacher.name} predă acum`));
  assert.strictEqual(sent[0].opts.TTL, 1800);
  const again = await cron(fake);
  assert.strictEqual(again.notified, 0);
  assert.strictEqual(sent.length, 1);
  // notifySession direct: tot o dată
  assert.strictEqual(await notifySession(fake, fake.db.tables.live_sessions[0], { kind: 'start' }), 0);
});

// ─── 5. Browserul ────────────────────────────────────────────────────────────
test('browserul: titlul tabului clipește cât pagina e în fundal și se oprește când elevul revine', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const listeners = {};
  const doc = { title: 'ExamenMate', visibilityState: 'hidden', addEventListener: (e, f) => { listeners[e] = f; }, removeEventListener: (e) => { delete listeners[e]; } };
  const prev = globalThis.document;
  globalThis.document = doc;
  try {
    const N = await import('../src/lib/live/notify.js');
    assert.strictEqual(N.pageHidden(), true);
    const stop = N.flashTitle('✅ Prof. Tudor e gata!');
    assert.strictEqual(doc.title, '✅ Prof. Tudor e gata!');
    t.mock.timers.tick(1000);
    assert.strictEqual(doc.title, 'ExamenMate');
    t.mock.timers.tick(1000);
    assert.strictEqual(doc.title, '✅ Prof. Tudor e gata!');
    doc.visibilityState = 'visible';
    listeners.visibilitychange();
    assert.strictEqual(doc.title, 'ExamenMate', 'revenit: titlul normal');
    t.mock.timers.tick(3000);
    assert.strictEqual(doc.title, 'ExamenMate');
    assert.strictEqual(typeof stop, 'function');
    // pagina la vedere: nu clipește nimic
    N.flashTitle('X');
    assert.strictEqual(doc.title, 'ExamenMate');
  } finally { globalThis.document = prev; }
});

test('sala: etapele, „🔔 Anunță-mă", sunetul + notificarea de sistem (prin service worker), cardul „e gata — ▶ Începe"', () => {
  const wait = read('src/components/live/PrepWait.jsx');
  for (const s of ['Citește subiectul și baremul oficial', 'Scrie explicațiile pe barem', 'Pregătește întrebările pentru fiecare exercițiu', 'Înregistrează vocea pentru începutul lecției', 'Gata — poți intra', '🔔 Anunță-mă când e gata', 'Nu mai anunța'])
    assert.ok(wait.includes(s), s);
  const room = read('src/pages/LiveRoom.jsx');
  assert.ok(room.includes('liveApi.status(sessionId)') && room.includes('untilPlayable: unprivate'), 'progresul des + un singur apel lung');
  assert.ok(room.includes('sunaGata()') && room.includes('flashTitle(title)') && room.includes('systemNotify({'), 'sunet, titlul tabului, notificarea');
  // în alt tab: lecția NU pornește singură (nici cele 60 de minute) — întâi clicul
  assert.ok(room.includes('holdRef.current = true; setReadyHold(true)'));
  assert.ok(/if \(!joined \|\| !timeline \|\| readyHold \|\| holdRef\.current\) return undefined;/.test(room), 'playerul (și private_begin) așteaptă clicul');
  assert.ok(room.includes('▶ Începe lecția'));
  const notify = read('src/lib/live/notify.js');
  assert.ok(notify.includes('reg.showNotification(title, opts)'), 'pe Android, notificarea doar prin service worker');
  assert.ok(notify.includes('pushManager.subscribe({ userVisibleOnly: true'));
  const sw = read('public/sw-push.js');
  assert.ok(sw.includes("addEventListener('push'") && sw.includes("addEventListener('notificationclick'"));
  assert.ok(sw.includes('clients.openWindow'), 'clicul deschide sala dacă tabul a fost închis');
  const vite = read('vite.config.js');
  assert.ok(vite.includes("importScripts: ['/sw-push.js']"));
  const css = read('src/styles/live.css');
  assert.ok(css.includes('.lv-prep .lv-prep-btn {'), 'butonul albastru cu text alb și în sală (peste `.lv-room button`)');
});

test('SQL-ul (supabase/notificari_lectii.sql): RLS + GRANT pentru tabelele noi, fără acces pentru vizitatori (anon)', () => {
  const sql = read('supabase/notificari_lectii.sql');
  for (const t of ['push_subscriptions', 'live_lesson_qa']) {
    const create = sql.indexOf(`create table if not exists public.${t}`);
    assert.ok(create >= 0, t);
    const after = sql.slice(create);
    const rls = after.indexOf(`alter table public.${t} enable row level security;`);
    const gAuth = after.indexOf(`grant select, insert, update, delete on public.${t} to authenticated;`);
    const gSvc = after.indexOf(`grant select, insert, update, delete on public.${t} to service_role;`);
    assert.ok(rls > 0 && gAuth > rls && gSvc > gAuth, `${t}: RLS, apoi grant-urile, imediat după creare`);
    assert.ok(!new RegExp(`on public\\.${t} to anon`).test(sql), `${t}: fără anon`);
    assert.ok(new RegExp(`create policy \\w+ on public\\.${t}`).test(sql), `${t}: are politicile lui`);
  }
  assert.ok(sql.includes('add column if not exists notify_at') && sql.includes('add column if not exists notified_at'));
});
