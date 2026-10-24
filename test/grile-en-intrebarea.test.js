// Teste pentru cererea din 24 oct. 2026: „La Evaluare Națională, la subiectul al doilea nu
// apar întrebările, doar spune profesorul să răspundă pe ecran. Fă să apară întrebarea pe ecran."
// Cauza: la grilele de EN, când litera corectă nu se citea din TEXTUL tabelului din barem,
// întrebarea cădea din lecție — deși modelul o scrisese, iar profesorul spunea „răspundeți
// pe ecran".
//   · lecțiile noi: litera din lecție rămâne, dacă explicația pe barem o confirmă (normalizeItems);
//   · lecțiile deja scrise: întrebarea revine la încărcare (LL.restoreGrilaTries) — sala,
//     cheia de pe server (răspunsul elevului), Admin, simulările;
//   · o cheie greșită nu trece: litera contrazisă sau neconfirmată de explicație → fără întrebare;
//   · tabelul din barem se citește mai des (literele din fontul de ecuații, tabelul rupt pe rânduri).
process.env.LIVE_GEN_MODEL = 'gpt-5.6-terra';
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const B = require('../api/_lib/barem');
const L = require('../api/_lib/live');
const LL = require('../api/_lib/liveLesson');
const SO = require('../api/_lib/simulariOficiale');
const handler = require('../api/live');

const seg = (say, board = []) => ({ say, board });
// EN 2024, Subiectul al II-lea (grile), cum le scrie modelul: explicația se încheie cu varianta corectă
function rawII(ex, statement, options, answer, barem) {
  return {
    ref: `II.${ex}`, title: `Subiectul al II-lea, exercițiul ${ex}`, kind: 'grila', statement, statementTry: null,
    options, answer, points: 5, barem: `${answer}. 5p`,
    intro: [seg(`Exercițiul ${ex} de la Subiectul al doilea. Alegeți răspunsul pe ecran.`)],
    tryPoll: { type: 'grila', question: statement, options, answer, explain: 'Din barem.' },
    afterTry: [seg('Să vedem răspunsul corect.')],
    modes: { barem, intuitiv: [seg('Pe scurt, ca pe o riglă.')], greseli: [], alta_metoda: null },
    check: null, afterCheck: [],
  };
}
const RAW = [
  // confirmată: explicația spune „b" și scrie rezultatul variantei b
  rawII(1, 'În figura 1, punctele $A$, $B$ și $C$ sunt coliniare, $AB = 14$ cm și $AC = 38$ cm. Lungimea segmentului $BC$ este:',
    ['52 cm', '24 cm', '26 cm', '28 cm'], 'b',
    [seg('Punctul B este între A și C, deci BC este AC minus AB.', ['$BC = AC - AB$']),
      seg('Treizeci și opt minus paisprezece fac douăzeci și patru. Răspunsul corect este b.', ['$BC = 38 - 14 = 24$ cm $\\Rightarrow$ **b)**'])]),
  // confirmată doar prin rezultatul scris pe tablă (121 cm² = varianta b)
  rawII(2, 'Aria unui pătrat cu latura de $11$ cm este:', ['44 cm²', '121 cm²', '110 cm²', '111 cm²'], 'b',
    [seg('Aria pătratului este latura la pătrat.', ['$A = l^2 = 11^2 = 121$ cm²'])]),
  // contrazisă: lecția spune „a", explicația calculează 27 cm³ = varianta c
  rawII(3, 'Un cub are muchia de $3$ cm. Volumul cubului este:', ['9 cm³', '18 cm³', '27 cm³', '81 cm³'], 'a',
    [seg('Volumul cubului este muchia la cub.', ['$V = l^3 = 3^3 = 27$ cm³ $\\Rightarrow$ c)'])]),
  // neconfirmată: explicația nu ajunge la variantă
  rawII(4, 'Măsura unghiului complementar unghiului de $37^\\circ$ este:', ['53°', '63°', '143°', '133°'], 'a',
    [seg('Unghiurile complementare au suma de nouăzeci de grade.', ['$x + 37^\\circ = 90^\\circ$'])]),
];
// tabelul din barem — ca imagine în PDF, deci textul nu are literele
const BAREM_FARA_LITERE = 'SUBIECTUL I (30 de puncte)\nNr. item 1. 2. 3. 4. 5. 6.\nRezultate a. b. b. b. a. b.\nSUBIECTUL al II-lea (30 de puncte)\nSe punctează doar rezultatul, astfel: pentru fiecare răspuns se acordă fie 5 puncte, fie 0 puncte.\nSUBIECTUL al III-lea (30 de puncte)\n1. a) P = 390 m 2p';
const norm = (baremText, grile = B.grilaAnswers(baremText)) => LL.normalizeItems(RAW.map((r) => JSON.parse(JSON.stringify(r))), { section: 'II', exam: 'en', grile, baremText, log: () => {} });
const byRef = (items) => Object.fromEntries(items.map((it) => [it.ref, it]));

// o lecție scrisă ÎNAINTE de 24 oct.: întrebarea grilelor căzuse (litera nu se citea din barem)
function oldScript() {
  const items = norm(BAREM_FARA_LITERE).map((it) => ({ ...it, tryPoll: null }));
  items[0].check = { type: 'completare', question: 'Cât este $38 - 14$?', options: null, answer: '24', explain: '' };
  items[0].afterCheck = [seg('Să verificăm.')];
  return LL.assignIds({ title: 'EN 2024 Varianta 7', exam: 'en', teacher: 'radu', teacherName: 'Prof. Tudor', pasi: LL.PASI_V, intro: [], qna: [], breakSay: [], outro: [], items });
}

// ─── 1. Lecțiile noi ─────────────────────────────────────────────────────────
test('lecțiile noi: litera necitită din barem → rămâne cea din lecție, dacă explicația o confirmă; contrazisă sau neconfirmată → fără întrebare', () => {
  assert.deepStrictEqual(B.grilaAnswers(BAREM_FARA_LITERE).II, undefined, 'tabelul Subiectului al II-lea nu se citește din text');
  const it = byRef(norm(BAREM_FARA_LITERE));
  assert.strictEqual(it['II.1'].tryPoll.answer, 'b');
  assert.strictEqual(it['II.1'].tryPoll.unconfirmed, true, 'Admin o arată: „litera din lecție"');
  assert.deepStrictEqual(it['II.1'].tryPoll.options, ['52 cm', '24 cm', '26 cm', '28 cm']);
  assert.strictEqual(it['II.2'].tryPoll.answer, 'b', 'confirmată de rezultatul scris pe tablă');
  assert.strictEqual(it['II.3'].tryPoll, null, 'lecția zice a), explicația ajunge la c) → nu riscăm');
  assert.strictEqual(it['II.4'].tryPoll, null, 'explicația nu confirmă litera');
  // cu tabelul citit din barem, litera din barem are ultimul cuvânt (și corectează lecția)
  const ok = byRef(norm('SUBIECTUL al II-lea\nNr. item 1. 2. 3. 4. 5. 6.\nRezultate b. b. c. a. a. c.\nSUBIECTUL al III-lea\n1. a) 2p'));
  assert.deepStrictEqual(['II.1', 'II.2', 'II.3', 'II.4'].map((r) => [ok[r].tryPoll.answer, !!ok[r].tryPoll.unconfirmed]), [['b', false], ['b', false], ['c', false], ['a', false]]);
});

// ─── 2. Lecțiile deja scrise ─────────────────────────────────────────────────
test('lecțiile deja scrise: întrebarea grilei revine la încărcare (id ca la scriere, „litera din lecție"); lecția din bază nu se schimbă', () => {
  const old = oldScript();
  const before = JSON.parse(JSON.stringify(old));
  const s = LL.restoreGrilaTries(old);
  assert.deepStrictEqual(old, before, 'scriptul primit rămâne neatins');
  const it = byRef(s.items);
  assert.deepStrictEqual(it['II.1'].tryPoll, { type: 'grila', question: RAW[0].statement, options: ['52 cm', '24 cm', '26 cm', '28 cm'], answer: 'b', explain: '', unconfirmed: true, id: `p0t-${L.shortId('II.1try')}` });
  assert.strictEqual(it['II.1'].check, null, 'un singur sondaj: încercarea înainte, nu și verificarea după');
  assert.strictEqual(it['II.2'].tryPoll.id, `p1t-${L.shortId('II.2try')}`);
  assert.strictEqual(it['II.3'].tryPoll, null);
  assert.strictEqual(it['II.4'].tryPoll, null);
  assert.strictEqual(LL.restoreGrilaTries(s), s, 'a doua oară nu mai e nimic de făcut');
  // nicio frază nouă (vocea generată ajunge; doar cea a verificării căzute nu se mai aude);
  // cronologia: enunțul → întrebarea → rezultatul → explicația
  const oldIds = new Set(LL.segmentsInOrder(old).map((g) => g.id));
  assert.ok(LL.segmentsInOrder(s).every((g) => oldIds.has(g.id)));
  for (const mode of ['grup', 'privat']) {
    const tl = L.buildTimeline(s, {}, { mode, qna: false });
    const types = tl.scenes.filter((x) => x.item === 0).map((x) => x.type);
    assert.deepStrictEqual(types.slice(0, 4), ['item', 'sondaj', 'rezultate', 'explicatie'], mode);
    assert.strictEqual(tl.scenes.find((x) => x.type === 'sondaj').poll.answer, undefined, 'răspunsul nu pleacă în browser');
  }
  // doar grilele (Subiectele I–II, cu 4 variante): un item fără variante sau de la Subiectul III rămâne
  const noOpts = LL.restoreGrilaTries({ items: [{ ...old.items[0], options: null }] });
  assert.strictEqual(noOpts.items[0].tryPoll, null);
  const sIII = LL.restoreGrilaTries({ items: [{ ...old.items[0], ref: 'III.1', section: 'III' }] });
  assert.strictEqual(sIII.items[0].tryPoll, null);
  // simulările din subiectele oficiale folosesc acum și aceste grile
  assert.ok(SO.questionOf(it['II.1']));
  assert.strictEqual(SO.questionOf(it['II.1']).answer, 1);
});

// ─── 3. Prin server: sala, răspunsul elevului, Admin ─────────────────────────
test('prin server: sala primește întrebarea, răspunsul elevului se corectează cu litera bună; Admin vede „litera din lecție"', async () => {
  const U = '22222222-2222-4222-8222-222222222222';
  const ADMIN = '33333333-3333-4333-8333-333333333333';
  const SUBJ = 'aaaaaaaa-0000-4000-8000-000000000001';
  const script = oldScript();
  const now = new Date().toISOString();
  const lesson = { id: 'dddddddd-0000-4000-8000-0000000000e1', subject_id: SUBJ, teacher: 'radu', version: 1, status: 'gata', title: script.title, exam: 'en', profile: null, script, progress: { audio: {}, noVoice: true }, cost_micro: 0, created_at: now, updated_at: now };
  const session = { id: 'cccccccc-0000-4000-8000-0000000000e1', kind: 'privat', owner_id: U, teacher: 'radu', exam: 'en', profile: null, subject_id: SUBJ, starts_at: now, ends_at: new Date(Date.now() + 3600000).toISOString(), status: 'activa', state: {}, created_at: now, updated_at: now };
  const fake = createFakeSupabase({
    profiles: [
      { id: U, full_name: 'Andrei Ionescu', email: 'a@example.com', subscription_status: 'active', role: 'elev', is_admin: false },
      { id: ADMIN, full_name: 'Admin', email: 'x@example.com', role: 'admin', is_admin: true },
    ],
    content: [], ai_pdf_text: [], live_lessons: [lesson], live_sessions: [session],
  });
  const orig = { admin: ai.admin, authUser: ai.authUser };
  ai.admin = () => fake;
  ai.authUser = async (req) => req.headers['x-user'];
  const call = async (action, body, user) => { const res = fakeRes(); await handler({ method: 'POST', headers: { 'x-user': user }, query: {}, body: { action, ...body } }, res); return res; };
  try {
    const tl = await call('timeline', { sessionId: session.id }, U);
    assert.strictEqual(tl.statusCode, 200, JSON.stringify(tl.body));
    const id = `p0t-${L.shortId('II.1try')}`;
    const q = tl.body.timeline.scenes.find((x) => x.type === 'sondaj' && x.poll.id === id);
    assert.ok(q, 'întrebarea de la Subiectul al II-lea, ex. 1 e în sală');
    assert.deepStrictEqual(q.poll.options, ['52 cm', '24 cm', '26 cm', '28 cm']);
    assert.strictEqual(q.poll.answer, undefined);
    const bad = await call('poll_answer', { sessionId: session.id, pollId: id, answer: 'a' }, U);
    assert.strictEqual(bad.statusCode, 200, JSON.stringify(bad.body));
    assert.strictEqual(bad.body.correct, false);
    assert.strictEqual(bad.body.answer, 'b', '1-la-1: răspunsul corect vine pe loc');
    const good = await call('poll_answer', { sessionId: session.id, pollId: id, answer: 'b' }, U);
    assert.strictEqual(good.body.correct, true);
    const adm = await call('admin_lesson', { lessonId: lesson.id }, ADMIN);
    assert.strictEqual(adm.statusCode, 200, JSON.stringify(adm.body));
    assert.strictEqual(adm.body.lesson.script.items[0].tryPoll.unconfirmed, true);
    assert.strictEqual(fake.db.tables.live_lessons[0].script.items[0].tryPoll, null, 'în bază, lecția rămâne cum a fost scrisă');
  } finally { Object.assign(ai, orig); }
});

// ─── 4. Tabelul din barem, citit mai des ─────────────────────────────────────
test('tabelul din barem: literele din fontul de ecuații, tabelul rupt pe rânduri / câte o celulă pe rând', () => {
  const math = 'SUBIECTUL al II-lea\nNr. item 1. 2. 3. 4. 5. 6.\nRezultate 𝑏. 𝑎. 𝑏. 𝑐. 𝑎. 𝑐.\nSUBIECTUL al III-lea\n1. a) 2p';
  assert.deepStrictEqual(B.grilaAnswers(math).II, { 1: 'b', 2: 'a', 3: 'b', 4: 'c', 5: 'a', 6: 'c' });
  const wrapped = 'SUBIECTUL al II-lea (30 de puncte)\nNr. item 1. 2. 3.\n4. 5. 6.\nRezultate b. a. b.\nc. a. c.\nSUBIECTUL al III-lea\n1. a) 2p';
  assert.deepStrictEqual(B.grilaAnswers(wrapped).II, { 1: 'b', 2: 'a', 3: 'b', 4: 'c', 5: 'a', 6: 'c' });
  const cells = 'SUBIECTUL al II-lea\nNr.\nitem\n1.\n2.\n3.\n4.\n5.\n6.\nRezultate:\nb.\na.\nb.\nc.\na.\nc.\nPunctaj\n5p\nSUBIECTUL al III-lea\n1. a) 2p';
  assert.deepStrictEqual(B.grilaAnswers(cells).II, { 1: 'b', 2: 'a', 3: 'b', 4: 'c', 5: 'a', 6: 'c' });
  // fără potriviri false: rezolvări (EN vechi, BAC) și un tabel incomplet
  assert.deepStrictEqual(B.grilaAnswers('SUBIECTUL al II-lea\n1. Desenați un cub. 4p\n2. a) 3 + 4 = 7 2p b) 7 · 2 = 14 3p\nSUBIECTUL al III-lea\n1. a) 2p'), {});
  assert.deepStrictEqual(B.grilaAnswers('SUBIECTUL al II-lea\nNr. item 1. 2. 3. 4. 5. 6.\nRezultate b. a. b.\nSUBIECTUL al III-lea'), {});
});
