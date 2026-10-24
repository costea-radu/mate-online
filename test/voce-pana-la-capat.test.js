// Teste pentru cererea din 24 oct. 2026: „Vocea se oprește la un anumit nr. de fraze. Fă să
// meargă până la final, fără să mai dau eu «continuă»" (Admin → Lecțiile recente: „vocea se
// generează… vocea: 237/306 fraze — continuă la primul elev care intră, sau apasă «▶ Continuă»").
// Vocea se genera doar cât o cerea cineva (pagina de Admin deschisă, elevul din sală, ședințele
// de grup din următoarele ore). Acum:
//   · cronul (la 15 minute) duce mai departe vocea începută a ORICĂREI lecții, până la „gata";
//   · vocea eșuată pe drum (creditul, furnizorul) se reia singură, la 2 ore, niciodată cât o
//     ședință cu lecția e în curs, și nu la nesfârșit;
//   · o frază fără nimic de rostit sau una pe care furnizorul o respinge mereu nu mai țin
//     lecția la „vocea se generează…" pentru totdeauna;
//   · cât cronul ține lecția (lacătul), 1-la-1 poate porni cu vocea făcută până atunci.
process.env.LIVE_TTS_PAUZA_MS = '0';
process.env.LIVE_DESENE = '0';
delete process.env.LIVE_VOCE_REIA_ORE;
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const L = require('../api/_lib/live');
const LL = require('../api/_lib/liveLesson');
const tts = require('../api/_lib/tts');
const handler = require('../api/live');
const { prepareLesson, cron, voiceBacklog, voiceAutoOf } = handler._internals;

const teacher = L.teacherById('radu');
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const later = (min) => new Date(Date.now() + min * 60000).toISOString();

// ─── lecțiile de test ────────────────────────────────────────────────────────
function script() {
  const seg = (say, board = []) => ({ say, board });
  const raw = (n) => ({
    ref: `I.${n}`, title: `Subiectul I, exercițiul ${n}`, kind: 'grila', statement: `Rezultatul calculului $${n} + 3 \\cdot 4$ este:`,
    options: ['1', String(n + 12), '3', '4'], answer: 'b', points: 5, barem: 'b 5p',
    intro: [seg(`Exercițiul ${n}.`)], tryPoll: { type: 'grila', question: 'Rezultatul?', options: ['1', String(n + 12), '3', '4'], answer: 'b', explain: '' },
    afterTry: [seg('Să vedem răspunsul corect.')],
    modes: { barem: [seg(`Întâi înmulțirea, apoi adunarea: ${n + 12}.`, [`$${n} + 12 = ${n + 12}$`])], intuitiv: [seg('Înmulțirea leagă mai tare.')], greseli: [seg('Nu adunați întâi.')], alta_metoda: null },
    check: null, afterCheck: [],
  });
  const items = LL.normalizeItems([1, 2, 3, 4, 5, 6].map(raw), { section: 'I', exam: 'en', grile: { I: { 1: 'b', 2: 'b', 3: 'b', 4: 'b', 5: 'b', 6: 'b' } }, baremText: '' });
  return LL.assignIds({ title: 'EN test', exam: 'en', teacher: 'radu', teacherName: teacher.name, pasi: LL.PASI_V, ...LL.templates(teacher, { title: 'EN test', exam: 'en' }), items });
}
let serial = 0;
const uuid = (prefix) => `${prefix}-0000-4000-8000-${String(serial).padStart(12, '0')}`;
// voiced: câte fraze au deja vocea (de la început); missing: câte NU au (de la sfârșit)
function lesson({ status = 'audio', voiced = 10, missing = null, updated = 20, version = 1, subject = null, progress = {}, ...rest } = {}) {
  serial++;
  const sc = script();
  const segs = LL.segmentsInOrder(sc);
  const n = missing != null ? segs.length - missing : Math.min(voiced, segs.length);
  const audio = Object.fromEntries(segs.slice(0, n).map((s) => [s.id, { url: `https://x/${s.id}.mp3`, dur: 2.5, lip: null }]));
  return {
    id: uuid('dddddddd'), subject_id: subject || uuid('aaaaaaaa'), teacher: 'radu', version, status, title: 'EN test', exam: 'en', script: sc,
    progress: { audio, total: segs.length, done: n, phase: status === 'gata' ? 'gata' : 'voce', ...progress },
    error: null, cost_micro: 0, created_at: ago(900), updated_at: ago(updated), locked_until: null, ...rest,
  };
}
// vocea înlocuită (fără rețea): fail(text) → o eroare de aruncat, sau nimic
function stubVoice(fail = () => null) {
  const orig = { provider: tts.provider, voiceSegment: tts.voiceSegment };
  const calls = [];
  tts.provider = () => 'openai';
  tts.voiceSegment = async (supa, { text, path }) => {
    calls.push(path);
    const e = fail(text, path);
    if (e) throw e;
    return { url: `https://x/${path}.mp3`, dur: 2, lip: null, provider: 'openai', cost: 10 };
  };
  return { calls, restore: () => Object.assign(tts, orig) };
}
const rowOf = (fake, id) => fake.db.tables.live_lessons.find((l) => l.id === id);

// ─── 1. Vocea începută se termină singură ────────────────────────────────────
test('cronul termină singur vocea începută (ex. 237/306 fraze) a oricărei lecții — fără „▶ Continuă", fără vreo ședință cu ea', async () => {
  const row = lesson({ status: 'audio', voiced: 10, updated: 20 });
  const total = row.progress.total;
  const fake = createFakeSupabase({ live_lessons: [row] });
  const v = stubVoice();
  try {
    const rep = await cron(fake);
    assert.deepStrictEqual(rep.errors, []);
    const saved = rowOf(fake, row.id);
    assert.strictEqual(saved.status, 'gata');
    assert.strictEqual(saved.progress.done, total);
    assert.strictEqual(Object.keys(saved.progress.audio).length, total, 'toate frazele au vocea generată');
    assert.ok(!saved.progress.noVoice);
    assert.strictEqual(v.calls.length, total - 10, 'doar frazele care nu aveau voce');
    assert.ok(saved.duration_sec > 0);
    assert.strictEqual(saved.locked_until, null, 'lacătul se eliberează');
    assert.deepStrictEqual(rep.voiced.map((x) => [x.lesson, x.auto, x.before, x.status]), [[row.id, 'continua', 10, 'gata']]);
    // rularea următoare: nimic de făcut
    const again = await cron(fake);
    assert.deepStrictEqual(again.voiced, []);
    assert.strictEqual(v.calls.length, total - 10);
  } finally { v.restore(); }
});

test('cronul lasă în pace: vocea pe care o generează cineva chiar acum, lacătul altei pregătiri, lecțiile doar cu textul, versiunile vechi, lecțiile făcute toate cu vocea browserului', async () => {
  const active = lesson({ status: 'audio', voiced: 10, updated: 1 });              // pagina de Admin / sala o generează acum
  const locked = lesson({ status: 'audio', voiced: 10, updated: 20, locked_until: later(5) });
  const textOnly = lesson({ status: 'script', voiced: 0, updated: 300 });          // Pregătirea de examen: doar textul
  const old = lesson({ status: 'audio', voiced: 10, updated: 60 });                // înlocuită prin „Regenerează"
  serial++;
  const newer = { id: uuid('dddddddd'), subject_id: old.subject_id, teacher: 'radu', version: 2, status: 'nou', script: null, progress: {}, cost_micro: 0, created_at: ago(60), updated_at: ago(60), locked_until: null };
  const browserOnly = lesson({ status: 'gata', voiced: 0, updated: 600, progress: { noVoice: true } });   // făcută înainte de cheile TTS
  const full = lesson({ status: 'gata', missing: 0, updated: 600 });
  const fake = createFakeSupabase({ live_lessons: [active, locked, textOnly, old, newer, browserOnly, full] });
  const v = stubVoice();
  try {
    assert.deepStrictEqual(await voiceBacklog(fake), []);
    const rep = await cron(fake);
    assert.deepStrictEqual(rep.voiced, []);
    assert.strictEqual(v.calls.length, 0, 'nicio frază generată');
    assert.strictEqual(rowOf(fake, textOnly.id).status, 'script', 'textul rămâne fără voce (o cere prima ședință live)');
    assert.strictEqual(rowOf(fake, browserOnly.id).progress.noVoice, true);
    // nimeni n-a mai cerut vocea de 3 minute (pagina închisă, telefonul blocat) → e a cronului
    rowOf(fake, active.id).updated_at = ago(4);
    const todo = await voiceBacklog(fake);
    assert.deepStrictEqual(todo.map((l) => [l.id, l.auto]), [[active.id, 'continua']]);
  } finally { v.restore(); }
});

// ─── 2. Vocea eșuată pe drum se reia singură ────────────────────────────────
test('vocea eșuată pe drum (creditul, furnizorul) se reia singură după 2 ore — niciodată cât o ședință cu lecția e în curs, și nu la nesfârșit', async () => {
  const why = 'vocea generată a eșuat de 8 ori (OpenAI TTS 429: You exceeded your current quota) — 10 din 31 fraze au vocea generată, restul le rostește vocea browserului';
  const failed = lesson({ status: 'gata', voiced: 10, updated: 180, error: why, progress: { noVoice: true, voiceTries: 1 } });
  const recent = lesson({ status: 'gata', voiced: 10, updated: 30, error: why, progress: { noVoice: true } });         // acum o jumătate de oră
  const inRoom = lesson({ status: 'gata', voiced: 10, updated: 180, error: why, progress: { noVoice: true } });        // un 1-la-1 cu ea e în curs
  const soon = lesson({ status: 'gata', voiced: 10, updated: 180, error: why, progress: { noVoice: true } });          // o ședință de grup începe în 30 de minute
  const gaveUp = lesson({ status: 'gata', voiced: 10, updated: 180, error: why, progress: { noVoice: true, voiceTries: 6 } });
  const fake = createFakeSupabase({
    live_lessons: [failed, recent, inRoom, soon, gaveUp],
    live_sessions: [
      { id: 'eeeeeeee-0000-4000-8000-000000000001', kind: 'privat', teacher: 'radu', subject_id: inRoom.subject_id, status: 'activa', starts_at: ago(10), ends_at: later(50), state: {} },
      { id: 'eeeeeeee-0000-4000-8000-000000000002', kind: 'grup', teacher: 'radu', subject_id: soon.subject_id, status: 'programata', starts_at: later(30), ends_at: later(150), state: {} },
    ],
  });
  const v = stubVoice();
  try {
    const todo = await voiceBacklog(fake);
    assert.deepStrictEqual(todo.map((l) => [l.id, l.auto]), [[failed.id, 'reia']]);
    const r = await prepareLesson(fake, failed.id, { revoice: true, budgetMs: 20000, log: () => {} });
    const saved = rowOf(fake, failed.id);
    assert.strictEqual(r.status, 'gata');
    assert.strictEqual(saved.status, 'gata');
    assert.strictEqual(saved.progress.noVoice, false, 'acum toată lecția are vocea generată');
    assert.strictEqual(saved.error, null, 'motivul vechi dispare');
    assert.strictEqual(saved.progress.done, saved.progress.total);
    assert.strictEqual(saved.progress.voiceTries, 0);
    assert.strictEqual(v.calls.length, saved.progress.total - 10);
    for (const l of [recent, inRoom, soon, gaveUp]) assert.strictEqual(Object.keys(rowOf(fake, l.id).progress.audio).length, 10, 'celelalte rămân cum erau');
    // ședințele s-au încheiat, iar cealaltă a așteptat destul → și ele se reiau
    fake.db.tables.live_sessions = [];
    rowOf(fake, recent.id).updated_at = ago(130);
    const next = await voiceBacklog(fake);
    assert.deepStrictEqual(next.map((l) => l.id).sort(), [recent.id, inRoom.id, soon.id].sort());
    assert.ok(!next.some((l) => l.id === gaveUp.id), 'după 6 reîncercări la rând fără nicio frază nouă, cronul se oprește');
  } finally { v.restore(); }
});

test('reluarea care eșuează din nou: lecția rămâne „gata" cu vocea browserului, iar cronul o mai încearcă de cel mult 6 ori la rând', async () => {
  const row = lesson({ status: 'gata', voiced: 10, updated: 180, progress: { noVoice: true, voiceTries: 2 } });
  const fake = createFakeSupabase({ live_lessons: [row] });
  const quota = () => Object.assign(new Error('OpenAI TTS 429: You exceeded your current quota, please check your plan and billing details.'), { status: 429, quota: true });
  const v = stubVoice(quota);
  try {
    await prepareLesson(fake, row.id, { revoice: true, budgetMs: 20000, log: () => {} });
    const saved = rowOf(fake, row.id);
    assert.strictEqual(saved.status, 'gata');
    assert.strictEqual(saved.progress.noVoice, true);
    assert.match(saved.error, /OpenAI TTS 429/);
    assert.strictEqual(Object.keys(saved.progress.audio).length, 10, 'vocea deja generată rămâne');
    assert.strictEqual(saved.progress.voiceTries, 3);
    // se oprește după 8 eșecuri la rând (+ cererile deja pornite, câte 6 în paralel)
    assert.ok(v.calls.length <= 8 + 6 && v.calls.length < saved.progress.total - 10, `${v.calls.length} cereri`);
    assert.strictEqual(voiceAutoOf({ status: 'gata', noVoice: true, done: 10, total: saved.progress.total, tries: 3 }), 'reia');
    assert.strictEqual(voiceAutoOf({ status: 'gata', noVoice: true, done: 10, total: saved.progress.total, tries: 6 }), 'oprita');
  } finally { v.restore(); }
});

// ─── 3. Frazele care n-ar ajunge niciodată la voce ───────────────────────────
test('o frază pe care furnizorul o respinge mereu: după 3 treceri fără nimic nou, lecția pleacă „gata" (doar fraza aceea are vocea browserului)', async () => {
  const row = lesson({ status: 'audio', missing: 1, updated: 20 });
  const fake = createFakeSupabase({ live_lessons: [row] });
  const v = stubVoice(() => Object.assign(new Error('OpenAI TTS 400: Invalid input'), { status: 400 }));
  try {
    for (let k = 1; k <= 2; k++) {
      await prepareLesson(fake, row.id, { budgetMs: 20000, log: () => {} });
      const s = rowOf(fake, row.id);
      assert.strictEqual(s.status, 'audio', `trecerea ${k}: se mai încearcă`);
      assert.strictEqual(s.progress.voiceTries, k);
    }
    await prepareLesson(fake, row.id, { budgetMs: 20000, log: () => {} });
    const saved = rowOf(fake, row.id);
    assert.strictEqual(saved.status, 'gata', 'nu mai rămâne „vocea se generează…" la nesfârșit');
    assert.strictEqual(saved.progress.noVoice, true);
    assert.match(saved.error, /OpenAI TTS 400: Invalid input/);
    assert.match(saved.error, new RegExp(`${row.progress.total - 1} din ${row.progress.total} fraze au vocea generată`));
    assert.strictEqual(v.calls.length, 3);
  } finally { v.restore(); }
});

test('o frază fără nimic de rostit (ex. doar „$$") se socotește făcută: lecția ajunge la „gata", iar 1-la-1 poate porni', async () => {
  const row = lesson({ status: 'audio', missing: 0, updated: 20 });
  const intro = row.script.intro[0];
  intro.say = '$$';                            // în capul lecției (intro): ar fi blocat și pornirea 1-la-1
  delete row.progress.audio[intro.id];
  row.progress.done -= 1;
  assert.strictEqual(tts.speakable(intro.say), '');
  assert.strictEqual(LL.playableHead(row.script, row.progress.audio), true);
  const fake = createFakeSupabase({ live_lessons: [row] });
  const v = stubVoice();
  try {
    await prepareLesson(fake, row.id, { budgetMs: 20000, log: () => {} });
    const saved = rowOf(fake, row.id);
    assert.strictEqual(saved.status, 'gata');
    assert.ok(!saved.progress.noVoice);
    assert.strictEqual(saved.progress.done, saved.progress.total);
    assert.strictEqual(v.calls.length, 0, 'nimic de cerut furnizorului');
  } finally { v.restore(); }
});

// ─── 4. Cât cronul ține lecția ───────────────────────────────────────────────
test('cât altă pregătire (ex. cronul) ține lecția, sala primește „ocupată", dar și dacă 1-la-1 poate porni cu vocea de până acum', async () => {
  const ready = lesson({ status: 'audio', missing: 5, locked_until: later(8) });    // începutul are voce
  const fresh = lesson({ status: 'audio', voiced: 0, locked_until: later(8) });
  const fake = createFakeSupabase({ live_lessons: [ready, fresh] });
  const v = stubVoice();
  try {
    const a = await prepareLesson(fake, ready.id, { budgetMs: 20000, log: () => {}, headCheck: true });    // sala 1-la-1
    assert.strictEqual(a.busy, true);
    assert.strictEqual(a.playable, true);
    assert.strictEqual(a.done, ready.progress.done);
    const b = await prepareLesson(fake, fresh.id, { budgetMs: 20000, log: () => {}, headCheck: true });
    assert.strictEqual(b.busy, true);
    assert.strictEqual(b.playable, false);
    // sala de grup așteaptă oricum „gata" (fără să citească tot scriptul la fiecare întrebare)
    const g = await prepareLesson(fake, ready.id, { budgetMs: 20000, log: () => {} });
    assert.deepStrictEqual([g.busy, g.playable], [true, false]);
    assert.strictEqual(v.calls.length, 0, 'lacătul e respectat: nicio frază generată de două ori');
  } finally { v.restore(); }
});

// ─── 5. Admin: ce se întâmplă cu vocea fiecărei lecții ───────────────────────
test('Admin → Lecțiile recente: vocea începută „o termină singur serverul"; vocea eșuată „se reia"; după 6 reîncercări, „s-a oprit"', async () => {
  const admin = '33333333-3333-4333-8333-333333333333';
  const started = lesson({ status: 'audio', voiced: 10, updated: 1 });
  const partial = lesson({ status: 'gata', voiced: 10, updated: 30, progress: { noVoice: true } });
  const stopped = lesson({ status: 'gata', voiced: 10, updated: 30, progress: { noVoice: true, voiceTries: 6 } });
  const browserOnly = lesson({ status: 'gata', voiced: 0, updated: 30, progress: { noVoice: true } });
  const done = lesson({ status: 'gata', missing: 0, updated: 30 });
  const fake = createFakeSupabase({
    profiles: [{ id: admin, full_name: 'Radu Costea', email: 'radu@example.com', role: 'admin', is_admin: true }],
    app_settings: [{ key: 'live_free_lessons', value: { subjects: [] } }],
    live_lessons: [started, partial, stopped, browserOnly, done],
  });
  const orig = { admin: ai.admin, authUser: ai.authUser };
  ai.admin = () => fake;
  ai.authUser = async () => admin;
  const v = stubVoice();
  try {
    const res = fakeRes();
    await handler({ method: 'POST', headers: { 'x-user': admin }, query: {}, body: { action: 'admin_overview' } }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    const auto = Object.fromEntries(res.body.lessons.map((l) => [l.id, l.voiceAuto]));
    assert.deepStrictEqual([auto[started.id], auto[partial.id], auto[stopped.id], auto[browserOnly.id], auto[done.id]], ['continua', 'reia', 'oprita', null, null]);
    assert.strictEqual(res.body.voiceRetryHours, 2);
  } finally { v.restore(); Object.assign(ai, orig); }
  // fără nicio voce configurată, nimic nu se generează singur
  assert.strictEqual(voiceAutoOf({ status: 'audio', done: 3, total: 9 }), null);
});
