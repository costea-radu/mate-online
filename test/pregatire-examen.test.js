// Teste pentru „PREGĂTIRE DE EXAMEN" (Planul meu, ca o meditație live):
// pozițiile din examen, progresul, propunerile profesorului, alegerea exercițiilor
// (doar de pe poziția cerută, din subiectele examenului elevului, fără repetare),
// testul de verificare (fără răspunsuri trimise în browser) și acțiunile HTTP
// prep_* din api/live.js, pe un Supabase în memorie (test/tools/fakeSupabase.js).
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const L = require('../api/_lib/live');
const LL = require('../api/_lib/liveLesson');
const P = require('../api/_lib/pregatire');
const pdf = require('../api/ai-pdf-context');
const handler = require('../api/live');

// ─── pozițiile ────────────────────────────────────────────────────────────────
test('pozițiile: EN = 18 (S. I, II, III × 6), BAC = 10 (S. I × 6, apoi problemele II.1, II.2, III.1, III.2), în ordinea din examen', () => {
  const en = P.positions('en');
  assert.strictEqual(en.length, 18);
  assert.deepStrictEqual(en.slice(0, 3).map((p) => p.pos), ['I.1', 'I.2', 'I.3']);
  assert.deepStrictEqual([en[6].pos, en[12].pos, en[17].pos], ['II.1', 'III.1', 'III.6']);
  assert.strictEqual(en[0].label, 'Subiectul I, exercițiul 1');
  assert.strictEqual(en[7].label, 'Subiectul al II-lea, exercițiul 2');
  assert.strictEqual(en[12].spoken, 'Subiectul al treilea, exercițiul 1');
  const bac = P.positions('bac');
  assert.deepStrictEqual(bac.map((p) => p.pos), ['I.1', 'I.2', 'I.3', 'I.4', 'I.5', 'I.6', 'II.1', 'II.2', 'III.1', 'III.2']);
  assert.strictEqual(P.nextPosition('en', 'I.6').pos, 'II.1');
  assert.strictEqual(P.nextPosition('bac', 'III.2'), null);
  assert.deepStrictEqual(P.examOf('bac-stiinte'), { target: 'bac-stiinte', exam: 'bac', profile: 'stiinte-naturii', label: 'BAC Științele Naturii', spoken: 'bacalaureat, profilul științele naturii' });
  assert.strictEqual(P.examOf('clasa-7'), null);
});

test('itemsAt: doar itemii de pe poziție (III.1 = a, b, în ordine)', () => {
  const script = { items: [
    { ref: 'I.1', statement: 'a' }, { ref: 'I.2', statement: 'b' }, { ref: 'III.1.b', statement: 'd' },
    { ref: 'III.1.a', statement: 'c' }, { ref: 'III.2', statement: 'e' }, { ref: 'I.1', statement: '' },
  ] };
  assert.deepStrictEqual(P.itemsAt(script, 'I.1').map((i) => i.statement), ['a']);
  assert.deepStrictEqual(P.itemsAt(script, 'III.1').map((i) => i.ref), ['III.1.a', 'III.1.b']);
  assert.deepStrictEqual(P.itemsAt(script, 'II.4'), []);
  assert.deepStrictEqual(P.itemsAt(null, 'I.1'), []);
});

// ─── alegerea elevului: subpunctele (BAC) ─────────────────────────────────────
test('subpunctele (BAC): S. II ex. 2 b), S. III ex. 1 c)… se pot alege direct; la EN nu există', () => {
  const subs = P.subPositions('bac');
  assert.strictEqual(subs.length, 12);
  assert.deepStrictEqual(subs.slice(0, 4).map((p) => p.pos), ['II.1.a', 'II.1.b', 'II.1.c', 'II.2.a']);
  assert.deepStrictEqual(P.subPositions('en'), []);
  const b = P.positionOf('bac', 'II.2.b');
  assert.deepStrictEqual({ parent: b.parent, letter: b.letter, multi: b.multi, label: b.label, short: b.short, spoken: b.spoken },
    { parent: 'II.2', letter: 'b', multi: false, label: 'Subiectul al II-lea, exercițiul 2 b)', short: 'S. II · ex. 2 b)', spoken: 'Subiectul al doilea, exercițiul 2, punctul b' });
  assert.strictEqual(P.positionOf('en', 'III.1.b'), null, 'la EN problemele se lucrează întregi');
  assert.strictEqual(P.positionOf('bac', 'II.4.a'), null);
  // după un subpunct: următorul subpunct, apoi poziția de după problemă
  assert.strictEqual(P.nextPosition('bac', 'II.1.a').pos, 'II.1.b');
  assert.strictEqual(P.nextPosition('bac', 'II.1.c').pos, 'II.2');
  assert.strictEqual(P.nextPosition('bac', 'II.2.c').pos, 'III.1');
  assert.strictEqual(P.nextPosition('bac', 'III.2.c'), null);
  // un subpunct e un singur item: testul are câte exerciții are la itemii simpli
  assert.strictEqual(P.testSize(b), P.settings().testSingle);
  // itemii: doar subpunctul cerut
  const script = { items: [{ ref: 'III.1.a', statement: 'a' }, { ref: 'III.1.b', statement: 'b' }, { ref: 'III.1.c', statement: 'c' }, { ref: 'III.2.b', statement: 'x' }] };
  assert.deepStrictEqual(P.itemsAt(script, 'III.1.c').map((i) => i.ref), ['III.1.c']);
  assert.deepStrictEqual(P.itemsAt(script, 'III.1').map((i) => i.ref), ['III.1.a', 'III.1.b', 'III.1.c']);
});

test('subpunctele: progres separat de problema întreagă; profesorul propune apoi subpunctul următor', () => {
  const at = (m) => `2026-09-2${m}T10:00:00Z`;
  const rows = [
    { id: 1, status: 'finalizata', created_at: at(1), prep: { mode: 'antrenament', pos: 'III.1.c', ex: [{ sid: 'a', done: true, polls: { x: { correct: true } } }, { sid: 'b', done: true, polls: {} }] } },
    { id: 2, status: 'finalizata', created_at: at(2), prep: { mode: 'antrenament', pos: 'II.2', ex: [{ sid: 'c', done: true, polls: {} }] } },
    { id: 3, status: 'finalizata', created_at: at(3), completed_at: at(3), prep: { mode: 'test', pos: 'II.1.a', items: [{ sid: 'd', polls: ['q'] }], result: { correct: 3, total: 3, passed: true } } },
  ];
  const prog = P.progressFrom(rows, 'bac');
  assert.strictEqual(prog.byPos['III.1.c'].done, 2);
  assert.strictEqual(prog.byPos['III.1'].done, 0, 'problema întreagă are progresul ei');
  assert.strictEqual(prog.byPos['II.1.a'].mastered, true);
  assert.strictEqual(prog.byPos['II.1'].mastered, false);
  const pub = P.publicProgress('bac', prog);
  assert.strictEqual(pub.length, 22);
  const c = pub.find((p) => p.pos === 'III.1.c');
  assert.deepStrictEqual({ parent: c.parent, letter: c.letter, done: c.done, status: c.status }, { parent: 'III.1', letter: 'c', done: 2, status: 'in_lucru' });
  // după testul trecut la II.1 a) → „Trecem la Subiectul al doilea, exercițiul 1, punctul b?"
  const after = P.proposeAfterTest({ exam: 'bac', pos: 'II.1.a', result: { correct: 3, total: 3, passed: true }, prog });
  assert.strictEqual(after.options[0].key, 'advance');
  assert.strictEqual(after.options[0].pos, 'II.1.b');
  assert.match(after.say, /Trecem la Subiectul al doilea, exercițiul 1, punctul b\?/);
  // la reintrare: ultima poziție lucrată (testul trecut) → prima netrecută, în ordinea din examen
  const cur = P.currentPosition('bac', prog);
  assert.strictEqual(cur.pos.pos, 'I.1');
  // ultima lucrată e un subpunct netrecut → profesorul propune să continue acolo
  const prog2 = P.progressFrom(rows.slice(0, 1), 'bac');
  const w = P.proposeWelcome({ exam: 'bac', target: 'bac-tehnologic', prog: prog2 });
  assert.strictEqual(w.pos, 'III.1.c');
  assert.match(w.say, /Subiectul al treilea, exercițiul 1, punctul c: ai lucrat 2 din 10/);
});

// ─── date de test ─────────────────────────────────────────────────────────────
const U = {
  prem: '22222222-2222-4222-8222-222222222222',
  free: '11111111-1111-4111-8111-111111111111',
  noexam: '44444444-4444-4444-8444-444444444444',
  bac: '55555555-5555-4555-8555-555555555555',
};
const seg = (say, board = []) => ({ say, board });
const BAREM_TEXT = 'BAREM DE EVALUARE ȘI DE NOTARE. SUBIECTUL I. Rezultate: 1. b 2. c 3. a. Se punctează orice modalitate corectă de rezolvare. '.repeat(2);
function rawGrila(ref, answer) {
  return {
    ref, title: `Subiectul I, exercițiul ${ref.split('.')[1]}`, kind: 'grila', statement: `Enunțul ${ref}: calculați $2+3\\cdot 4$.`,
    options: ['20', '14', '24', '9'], answer, points: 5, barem: `${answer}. 5p`,
    intro: [seg(`Trecem la exercițiul ${ref}.`)],
    tryPoll: { type: 'grila', question: `Cât face ${ref}?`, options: ['20', '14', '24', '9'], answer, explain: 'Înmulțirea se face întâi.' },
    afterTry: [seg('Să vedem.')],
    modes: { barem: [seg('Întâi înmulțirea, apoi adunarea.', ['$3\\cdot 4=12$', '$2+12=14$'])], intuitiv: [seg('Înmulțirea leagă mai tare.')], greseli: [], alta_metoda: null },
    check: null, afterCheck: [],
  };
}
function rawProblem(ref, answer) {
  return {
    ref, title: `Subiectul al III-lea, problema 1 ${ref.slice(-1)})`, kind: 'rezolvare', statement: `Problema ${ref}.`,
    options: null, answer, points: 3, barem: `${answer} 3p`,
    intro: [seg(`Problema ${ref}.`)], tryPoll: { type: 'completare', question: `Cât este rezultatul la ${ref}?`, options: null, answer, explain: 'Din barem.' },
    afterTry: [seg('Să vedem.')], modes: { barem: [seg('Pașii din barem.', ['$x=' + answer + '$'])], intuitiv: [], greseli: [seg('Atenție la semn.')], alta_metoda: null },
    check: null, afterCheck: [],
  };
}
// scriptul lecției unui subiect (itemii I.1, I.2 grilă + III.1 a/b)
function scriptFor(title) {
  const radu = L.teacherById('radu');
  const itemsI = LL.normalizeItems([rawGrila('I.1', 'b'), rawGrila('I.2', 'b')], { section: 'I', exam: 'en', grile: { I: { 1: 'b', 2: 'b' } }, baremText: BAREM_TEXT });
  const itemsIII = LL.normalizeItems([rawProblem('III.1.a', '30'), rawProblem('III.1.b', '7')], { section: 'III', exam: 'en', baremText: BAREM_TEXT });
  return LL.assignIds({ title, exam: 'en', teacher: 'radu', teacherName: radu.name, ...LL.templates(radu, { title, exam: 'en' }), items: [...itemsI, ...itemsIII] });
}
const cid = (k) => `aaaaaaaa-0000-4000-8000-${String(k).padStart(12, '0')}`;
function seed({ subjects = 14, ready = 14, bacSubjects = 2 } = {}) {
  const content = [], ai_pdf_text = [], live_lessons = [];
  for (let k = 1; k <= subjects; k++) {
    content.push({ id: cid(k), title: `EN ${2010 + k} Varianta ${k}`, category: 'evaluare-nationala', subcategory: null, profile: null, content_type: 'pdf', file_url: `https://x/${k}.pdf`, is_free: true, created_at: '2026-01-01T00:00:00Z' });
    ai_pdf_text.push({ content_id: cid(k), barem_status: 'ok', barem: { title: 'Barem' }, barem_text: BAREM_TEXT, text: 'SUBIECTUL I ...' });
    if (k <= ready) live_lessons.push({ id: `bbbbbbbb-0000-4000-8000-${String(k).padStart(12, '0')}`, subject_id: cid(k), teacher: 'radu', version: 1, status: 'gata', title: `EN ${2010 + k} Varianta ${k}`, exam: 'en', script: scriptFor(`EN ${2010 + k} Varianta ${k}`), progress: { noVoice: true }, updated_at: '2026-09-01T00:00:00Z' });
  }
  for (let k = 1; k <= bacSubjects; k++) {
    const id = `cccccccc-0000-4000-8000-${String(k).padStart(12, '0')}`;
    content.push({ id, title: `BAC ${2020 + k} M_tehnologic Varianta ${k}`, category: 'bacalaureat', subcategory: null, profile: 'tehnologic', content_type: 'pdf', file_url: `https://x/b${k}.pdf`, is_free: true, created_at: '2026-01-01T00:00:00Z' });
    ai_pdf_text.push({ content_id: id, barem_status: 'ok', barem: { title: 'Barem' }, barem_text: BAREM_TEXT, text: 'SUBIECTUL I ...' });
  }
  return {
    profiles: [
      { id: U.prem, full_name: 'andrei ionescu', email: 'a@example.com', subscription_status: 'active', role: 'elev', is_admin: false },
      { id: U.free, full_name: 'Ioana Pop', email: 'i@example.com', subscription_status: null, role: 'elev', is_admin: false },
      { id: U.noexam, full_name: 'Mihai', email: 'm@example.com', subscription_status: 'active', role: 'elev', is_admin: false },
      { id: U.bac, full_name: 'Elena', email: 'e@example.com', subscription_status: 'active', role: 'elev', is_admin: false },
    ],
    ai_meditatii_profile: [
      { user_id: U.prem, grade: 8, exam_target: 'evaluare-nationala' },
      { user_id: U.free, grade: 8, exam_target: 'evaluare-nationala' },
      { user_id: U.noexam, grade: 6, exam_target: null },
      { user_id: U.bac, grade: 12, exam_target: 'bac-tehnologic' },
    ],
    content, ai_pdf_text, live_lessons, ai_meditatii_sessions: [],
  };
}

// ─── înlocuirile (fără rețea) ─────────────────────────────────────────────────
let fake = null;
const calls = { chat: 0, script: 0 };
const fresh = (opts) => { handler._internals.resetCaches(); return createFakeSupabase(seed(opts)); };
ai.admin = () => fake;
ai.authUser = async (req) => { const u = req.headers['x-user']; if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; } return u; };
ai.logUsage = async () => {};
ai.enforceRateLimit = async () => ({});
ai.chatJson = async () => { calls.chat++; return { data: { say: 'Pentru că înmulțirea se face înaintea adunării.', text: 'Pentru că $3\\cdot 4=12$ se face întâi.', board: ['$3\\cdot 4 = 12$'] }, usage: { model: 'test' } }; };
LL.generateScript = async ({ content }) => { calls.script++; return { script: scriptFor(content.title), usage: { model: 'test', input_tokens: 1, output_tokens: 1 } }; };
pdf.getPdfContext = async () => ({ text: 'SUBIECTUL I', baremText: BAREM_TEXT, baremStatus: 'ok' });
pdf.downloadContentPdf = async () => { throw new Error('fără rețea în teste'); };
delete process.env.AZURE_SPEECH_KEY; delete process.env.OPENAI_API_KEY; delete process.env.LIVE_TTS_API_KEY;
delete process.env.SUPABASE_URL; delete process.env.VITE_SUPABASE_URL;

async function call(action, body = {}, user = U.prem) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: user ? { 'x-user': user } : {}, query: {}, body: { action, ...body } }, res);
  return res;
}
const scenesOf = (tl) => tl.scenes.map((s) => s.type);
const pollsIn = (tl) => tl.scenes.filter((s) => s.type === 'sondaj').map((s) => s.poll);
const keyOf = (k) => { const l = fake.db.tables.live_lessons.find((x) => x.subject_id === k); return l.script; };

// rezolvă un exercițiu de antrenament: răspunde (corect / greșit) la fiecare întrebare, apoi „gata"
async function solveExercise(pos, { right = true } = {}) {
  const ex = await call('prep_exercise', { pos });
  assert.strictEqual(ex.statusCode, 200, JSON.stringify(ex.body));
  if (ex.body.exhausted) return ex;
  for (const poll of pollsIn(ex.body.timeline)) {
    const { id } = P.splitNs(poll.id);
    const sp = keyOf(ex.body.exercise.sid).items.flatMap((it) => [it.tryPoll, it.check]).find((p) => p && p.id === id);
    const ans = right ? sp.answer : (sp.type === 'grila' ? (sp.answer === 'a' ? 'b' : 'a') : '999');
    const r = await call('prep_answer', { rowId: ex.body.rowId, pollId: poll.id, answer: ans });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.correct, right);
  }
  const d = await call('prep_done', { rowId: ex.body.rowId, sid: ex.body.exercise.sid, seconds: 90 });
  assert.strictEqual(d.statusCode, 200, JSON.stringify(d.body));
  return { ex, done: d };
}

test('acces: doar cu abonament și cu examenul ales în „Planul meu"', async () => {
  fake = fresh();
  assert.strictEqual((await call('prep_state', {}, null)).statusCode, 401);
  const free = await call('prep_state', {}, U.free);
  assert.strictEqual(free.statusCode, 402);
  assert.strictEqual(free.body.code, 'PREMIUM_REQUIRED');
  const noexam = await call('prep_state', {}, U.noexam);
  assert.strictEqual(noexam.statusCode, 409);
  assert.strictEqual(noexam.body.code, 'PREP_NO_EXAM');
});

test('prima intrare: profesorul propune Subiectul I, exercițiul 1 (cel puțin 10 exerciții, apoi testul)', async () => {
  fake = fresh();
  const r = await call('prep_state');
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.exam.label, 'Evaluarea Națională');
  assert.strictEqual(r.body.current, 'I.1');
  assert.strictEqual(r.body.positions.length, 18);
  assert.match(r.body.proposal.say, /^Bună, Andrei!/);
  assert.match(r.body.proposal.say, /Subiectul întâi, exercițiul 1/);
  assert.match(r.body.proposal.say, /cel puțin 10 exerciții/);
  assert.deepStrictEqual(r.body.proposal.options.map((o) => o.key), ['next', 'test', 'choose']);
  assert.ok(r.body.proposal.options[0].primary);
});

test('exercițiul: doar itemul de pe poziție, dintr-un subiect al examenului, cu id-uri unice în sală', async () => {
  fake = fresh();
  const r = await call('prep_exercise', { pos: 'III.1' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const { exercise, timeline } = r.body;
  assert.deepStrictEqual(exercise.refs, ['III.1.a', 'III.1.b']);
  assert.strictEqual(exercise.n, 1);
  assert.strictEqual(exercise.target, 10);
  assert.ok(exercise.title.startsWith('EN '));
  assert.ok(timeline.noVoice, 'vocea browserului');
  assert.deepStrictEqual(scenesOf(timeline).slice(0, 5), ['intro', 'item', 'sondaj', 'rezultate', 'explicatie']);
  assert.ok(scenesOf(timeline).includes('intrebare_intelegere'), '„Ai înțeles?" cu alte moduri');
  const ns = P.nsOf(exercise.sid);
  assert.ok(pollsIn(timeline).every((p) => p.id.startsWith(ns)));
  assert.ok(timeline.scenes.flatMap((s) => s.segs || []).every((g) => g.id.startsWith(ns) || g.id.startsWith('pin') || g.id.includes('~pin')));
  // rândul de progres: un bloc de lucru în „Planul meu"
  const rows = fake.db.tables.ai_meditatii_sessions;
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].chapter, 'pregatire:evaluare-nationala');
  assert.strictEqual(rows[0].kind, 'exercitii');
  assert.strictEqual(rows[0].payload.prep.pos, 'III.1');
  // același exercițiu, nerezolvat → se reia (nu se sare la altul)
  const again = await call('prep_exercise', { pos: 'III.1' });
  assert.strictEqual(again.body.exercise.sid, exercise.sid);
  assert.strictEqual(fake.db.tables.ai_meditatii_sessions.length, 1);
  // „alt exercițiu" → alt subiect
  const other = await call('prep_exercise', { pos: 'III.1', skip: exercise.sid });
  assert.notStrictEqual(other.body.exercise.sid, exercise.sid);
});

test('răspunsurile se verifică pe server; după 10 exerciții profesorul propune testul, fără să repete subiectele', async () => {
  fake = fresh();
  const sids = new Set();
  let last = null;
  for (let k = 1; k <= 10; k++) {
    const { ex, done } = await solveExercise('I.1', { right: k !== 3 });
    assert.strictEqual(ex.body.exercise.n, k);
    assert.ok(!sids.has(ex.body.exercise.sid), 'fiecare exercițiu din alt subiect');
    sids.add(ex.body.exercise.sid);
    last = done.body;
    if (k === 3) assert.match(done.body.proposal.say, /De data asta n-a ieșit|reține pașii/);
    if (k < 10) assert.strictEqual(done.body.proposal.options[0].key, 'next');
  }
  assert.strictEqual(last.proposal.options[0].key, 'test', JSON.stringify(last.proposal));
  assert.match(last.proposal.say, /test scurt/);
  const pos = last.positions.find((p) => p.pos === 'I.1');
  assert.strictEqual(pos.done, 10);
  assert.strictEqual(pos.correct, 9);
  assert.strictEqual(pos.total, 10);
  // „Progresul meu": rândul de antrenament e finalizat, cu scorul
  const row = fake.db.tables.ai_meditatii_sessions.find((r) => r.payload.prep.mode === 'antrenament');
  assert.strictEqual(row.status, 'finalizata');
  assert.strictEqual(row.score, 9);
  assert.strictEqual(row.max_score, 10);
  assert.match(row.topic, /Subiectul I, exercițiul 1 \(10 exerciții\)/);
  // la reintrare: e momentul testului
  const st = await call('prep_state');
  assert.strictEqual(st.body.proposal.options[0].key, 'test');
});

test('testul: exerciții noi, fără răspunsuri în browser; promovat → poziția următoare', async () => {
  fake = fresh();
  for (let k = 1; k <= 10; k++) await solveExercise('I.1');
  const trainedSids = new Set(fake.db.tables.ai_meditatii_sessions[0].payload.prep.ex.map((e) => e.sid));
  const t = await call('prep_test', { pos: 'I.1' });
  assert.strictEqual(t.statusCode, 200, JSON.stringify(t.body));
  assert.strictEqual(t.body.test.exercises, 5, 'testul are 5 exerciții');
  const json = JSON.stringify(t.body.timeline);
  assert.ok(!scenesOf(t.body.timeline).includes('rezultate') && !scenesOf(t.body.timeline).includes('explicatie'));
  assert.ok(!/"answer"/.test(json), 'răspunsurile corecte nu pleacă în browser la test');
  const testRow = fake.db.tables.ai_meditatii_sessions.find((r) => r.id === t.body.rowId);
  // doar 4 subiecte nelucrate (din 14): toate intră în test, al cincilea e unul lucrat
  assert.strictEqual(testRow.payload.prep.items.filter((e) => !trainedSids.has(e.sid)).length, 4, 'întâi exercițiile noi');
  for (const poll of pollsIn(t.body.timeline)) {
    const e = testRow.payload.prep.items.find((x) => poll.id.startsWith(P.nsOf(x.sid)));
    const sp = keyOf(e.sid).items.flatMap((it) => [it.tryPoll]).find((p) => p && p.id === P.splitNs(poll.id).id);
    const a = await call('prep_answer', { rowId: t.body.rowId, pollId: poll.id, answer: sp.answer });
    assert.strictEqual(a.statusCode, 200);
    assert.strictEqual(a.body.correct, undefined, 'la test nu se spune dacă e corect');
    assert.strictEqual(a.body.answer, undefined);
  }
  const f = await call('prep_test_finish', { rowId: t.body.rowId, seconds: 300 });
  assert.strictEqual(f.statusCode, 200, JSON.stringify(f.body));
  assert.deepStrictEqual(f.body.result, { correct: 5, total: 5, passed: true, pct: 100 });
  assert.strictEqual(f.body.review, null);
  assert.strictEqual(f.body.proposal.options[0].key, 'advance');
  assert.strictEqual(f.body.proposal.options[0].pos, 'I.2');
  assert.match(f.body.proposal.say, /Trecem la Subiectul întâi, exercițiul 2\?/);
  assert.strictEqual(f.body.positions.find((p) => p.pos === 'I.1').status, 'stapanit');
  // după test, profesorul propune I.2
  const st = await call('prep_state');
  assert.strictEqual(st.body.current, 'I.2');
  // testul, după încheiere, nu mai primește răspunsuri
  const late = await call('prep_answer', { rowId: t.body.rowId, pollId: pollsIn(t.body.timeline)[0].id, answer: 'a' });
  assert.strictEqual(late.statusCode, 409);
});

test('test nepromovat: profesorul propune să mai rămână (încă 5 exerciții), cu explicațiile greșelilor pe barem', async () => {
  fake = fresh({ subjects: 20, ready: 20 });
  for (let k = 1; k <= 10; k++) await solveExercise('I.1');
  const t = await call('prep_test', { pos: 'I.1' });
  assert.strictEqual(t.body.test.exercises, 5);
  for (const poll of pollsIn(t.body.timeline)) await call('prep_answer', { rowId: t.body.rowId, pollId: poll.id, answer: 'd' });
  const f = await call('prep_test_finish', { rowId: t.body.rowId });
  assert.strictEqual(f.body.result.passed, false);
  assert.strictEqual(f.body.proposal.options[0].key, 'stay');
  assert.ok(f.body.proposal.options.some((o) => o.key === 'review'));
  assert.ok(f.body.proposal.options.some((o) => o.key === 'advance' && o.pos === 'I.2'), 'poate trece totuși mai departe');
  assert.match(f.body.proposal.say, /încă 5 exerciții/);
  assert.ok(f.body.review && scenesOf(f.body.review).includes('explicatie') && !scenesOf(f.body.review).includes('sondaj'));
  const p = f.body.positions.find((x) => x.pos === 'I.1');
  assert.strictEqual(p.nextTestAt, 15);
  assert.strictEqual(p.status, 'in_lucru');
  // după încă 5 exerciții → iar testul
  let d = null;
  for (let k = 0; k < 5; k++) d = (await solveExercise('I.1')).done;
  assert.strictEqual(d.body.proposal.options[0].key, 'test');
});

test('fără lecții scrise: profesorul scrie lecția unui subiect nou (o singură dată, doar textul), apoi o refolosește', async () => {
  fake = fresh({ subjects: 4, ready: 0 });
  calls.script = 0;
  const r = await call('prep_exercise', { pos: 'I.2' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.generated, true);
  assert.strictEqual(calls.script, 1);
  const l = fake.db.tables.live_lessons[0];
  assert.strictEqual(l.status, 'gata', 'fără voce configurată: gata, cu vocea browserului (merge și la live)');
  assert.strictEqual(l.progress.noVoice, true);
  assert.deepStrictEqual(fake.db.tables.ai_meditatii_sessions[0].payload.prep.gen.length, 1);
  // pregătirea din timp a următorului
  const pf = await call('prep_prefetch', { pos: 'I.2', current: r.body.exercise.sid });
  assert.strictEqual(pf.body.ready, true);
  assert.strictEqual(calls.script, 2);
  const pf2 = await call('prep_prefetch', { pos: 'I.2', current: r.body.exercise.sid });
  assert.strictEqual(pf2.body.ready, true);
  assert.strictEqual(calls.script, 2, 'nu mai scrie încă una dacă următorul e gata');
});

test('plafonul zilnic de lecții noi (PREP_GENERARI_ZI) și epuizarea exercițiilor', async () => {
  fake = fresh({ subjects: 5, ready: 0 });
  process.env.PREP_GENERARI_ZI = '2';
  try {
    calls.script = 0;
    await solveExercise('I.1');
    await solveExercise('I.1');
    const r = await call('prep_exercise', { pos: 'I.1' });
    assert.strictEqual(calls.script, 2);
    assert.strictEqual(r.body.exhausted, true);
    assert.strictEqual(r.body.proposal.options[0].key, 'test');
  } finally { delete process.env.PREP_GENERARI_ZI; }
});

test('BAC: doar subiectele profilului elevului (tehnologic)', async () => {
  fake = fresh({ subjects: 2, ready: 2, bacSubjects: 2 });
  calls.script = 0;
  const st = await call('prep_state', {}, U.bac);
  assert.strictEqual(st.body.positions.filter((p) => !p.parent).length, 10, 'pozițiile întregi, în ordinea din examen');
  assert.strictEqual(st.body.positions.filter((p) => p.parent).length, 12, 'plus subpunctele II.1 a) … III.2 c), la alegerea elevului');
  assert.strictEqual(st.body.exam.label, 'BAC Tehnologic');
  const r = await call('prep_exercise', { pos: 'I.1' }, U.bac);
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.match(r.body.exercise.title, /M_tehnologic/);
  assert.strictEqual(calls.script, 1);
});

test('BAC: elevul alege doar un subpunct (S. III ex. 1 b) — nu neapărat la rând), cu progresul lui', async () => {
  fake = fresh({ subjects: 2, ready: 2, bacSubjects: 2 });
  const st = await call('prep_state', {}, U.bac);
  const sub = st.body.positions.find((p) => p.pos === 'III.1.b');
  assert.deepStrictEqual({ parent: sub.parent, letter: sub.letter, short: sub.short }, { parent: 'III.1', letter: 'b', short: 'S. III · ex. 1 b)' });
  assert.strictEqual(sub.spoken, 'Subiectul al treilea, exercițiul 1, punctul b');
  const r = await call('prep_exercise', { pos: 'III.1.b' }, U.bac);
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.exercise.refs, ['III.1.b'], 'doar subpunctul ales, nu toată problema');
  assert.strictEqual(r.body.exercise.label, 'Subiectul al III-lea, exercițiul 1 b)');
  assert.ok(r.body.timeline.scenes.filter((s) => s.type === 'item').every((s) => s.ref === 'III.1.b'));
  for (const poll of pollsIn(r.body.timeline)) {
    const sp = keyOf(r.body.exercise.sid).items.flatMap((it) => [it.tryPoll, it.check]).find((p) => p && p.id === P.splitNs(poll.id).id);
    const a = await call('prep_answer', { rowId: r.body.rowId, pollId: poll.id, answer: sp.answer }, U.bac);
    assert.strictEqual(a.body.correct, true);
  }
  const d = await call('prep_done', { rowId: r.body.rowId, sid: r.body.exercise.sid, seconds: 60 }, U.bac);
  assert.strictEqual(d.statusCode, 200, JSON.stringify(d.body));
  assert.strictEqual(d.body.positions.find((p) => p.pos === 'III.1.b').done, 1);
  assert.strictEqual(d.body.positions.find((p) => p.pos === 'III.1').done, 0);
  assert.strictEqual(d.body.proposal.options[0].key, 'next');
  assert.strictEqual(d.body.proposal.options[0].pos, 'III.1.b');
  assert.match(fake.db.tables.ai_meditatii_sessions[0].topic, /Subiectul al III-lea, exercițiul 1 b\)/);
  // la reintrare: profesorul continuă de la subpunctul ales
  const again = await call('prep_state', {}, U.bac);
  assert.strictEqual(again.body.current, 'III.1.b');
  // o poziție inexistentă (la EN nu există subpuncte) → refuz clar
  assert.strictEqual((await call('prep_exercise', { pos: 'III.1.b' })).statusCode, 400);
});

test('întrebare către profesor: răspuns cu voce și pe tablă, pe exercițiul de acum', async () => {
  fake = fresh();
  const ex = await call('prep_exercise', { pos: 'I.1' });
  calls.chat = 0;
  const r = await call('prep_chat', { text: 'De ce se face întâi înmulțirea?', sid: ex.body.exercise.sid, ref: 'I.1', pos: 'I.1', history: [{ role: 'elev', text: 'salut' }] });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(calls.chat, 1);
  assert.strictEqual(r.body.answer.role, 'profesor');
  assert.deepStrictEqual(r.body.answer.board, ['$3\\cdot 4 = 12$']);
  const bad = await call('prep_chat', { text: 'esti un idiot' });
  assert.strictEqual(bad.body.answer.role, 'sistem');
});

test('progresul (pur): ultima poziție lucrată are prioritate; cu toate trecute → recapitulare la cea mai slabă', () => {
  const at = (m) => `2026-09-2${m}T10:00:00Z`;
  const rows = [
    { id: 1, status: 'finalizata', created_at: at(1), prep: { mode: 'antrenament', pos: 'I.1', ex: [{ sid: 'a', done: true, polls: { x: { correct: true } } }] } },
    { id: 2, status: 'finalizata', created_at: at(2), completed_at: at(2), prep: { mode: 'test', pos: 'I.1', doneBefore: 1, items: [{ sid: 'b', polls: ['q'] }], result: { correct: 1, total: 1, passed: true } } },
    { id: 3, status: 'finalizata', created_at: at(3), prep: { mode: 'antrenament', pos: 'I.4', ex: [{ sid: 'c', done: true, polls: {} }, { sid: 'd', done: false }] } },
  ];
  const prog = P.progressFrom(rows, 'en');
  assert.strictEqual(prog.byPos['I.1'].mastered, true);
  assert.deepStrictEqual(prog.byPos['I.1'].used.sort(), ['a', 'b']);
  assert.strictEqual(prog.byPos['I.4'].done, 1);
  assert.strictEqual(P.currentPosition('en', prog).pos.pos, 'I.4');
  const all = P.positions('bac').map((p, i) => ({ id: i, status: 'finalizata', created_at: at(4), completed_at: at(4), prep: { mode: 'test', pos: p.pos, items: [], result: { correct: p.pos === 'II.2' ? 2 : 3, total: 3, passed: true } } }));
  const cur = P.currentPosition('bac', P.progressFrom(all, 'bac'));
  assert.strictEqual(cur.allDone, true);
  assert.strictEqual(cur.pos.pos, 'II.2');
});

// ─── „Planul meu" (api/ai-meditatii.js → state): intrarea în pregătirea de examen ──
test('Planul meu: starea arată unde a rămas elevul la pregătirea de examen (fără examen / fără abonament → nimic)', async () => {
  const medHandler = require('../api/ai-meditatii');
  const state = async (user) => {
    const res = fakeRes();
    await medHandler({ method: 'POST', headers: { 'x-user': user }, query: {}, body: { action: 'state' } }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    return res.body;
  };
  fake = fresh();
  let s = await state(U.prem);
  assert.strictEqual(s.examPrep.label, 'Evaluarea Națională');
  assert.strictEqual(s.examPrep.started, false);
  assert.strictEqual(s.examPrep.current.pos, 'I.1');
  assert.strictEqual(s.examPrep.current.spoken, 'Subiectul întâi, exercițiul 1');
  assert.strictEqual(s.examPrep.perPosition, 10);
  assert.strictEqual(s.examPrep.list.length, 18);
  assert.deepStrictEqual([...new Set(s.examPrep.list.map((p) => p.sub))], ['I', 'II', 'III']);
  // după trei exerciții: „continuăm" de la aceeași poziție, cu progresul pe bandă
  for (let k = 0; k < 3; k++) await solveExercise('I.2');
  s = await state(U.prem);
  assert.strictEqual(s.examPrep.started, true);
  assert.strictEqual(s.examPrep.current.pos, 'I.2');
  assert.strictEqual(s.examPrep.current.done, 3);
  assert.strictEqual(s.examPrep.exercises, 3);
  assert.strictEqual(s.examPrep.list.find((p) => p.pos === 'I.2').status, 'in_lucru');
  assert.strictEqual(s.examPrep.list.find((p) => p.pos === 'I.1').status, 'nou');
  // rândurile pregătirii apar în „Progresul meu" cu titlul lor (nu cu id-ul capitolului)
  assert.ok(s.sessions.some((r) => r.chapter === 'pregatire:evaluare-nationala' && /Pregătire de examen · Subiectul I, exercițiul 2/.test(r.topic)));
  assert.deepStrictEqual(s.examPrep.subs, [], 'la EN nu există subpuncte de ales');
  // BAC: benzile = cele 10 poziții întregi; subpunctele (12) se pot alege direct
  const b = await state(U.bac);
  assert.strictEqual(b.examPrep.list.length, 10);
  assert.strictEqual(b.examPrep.subs.length, 12);
  assert.deepStrictEqual(b.examPrep.subs.find((x) => x.pos === 'II.2.b'), { pos: 'II.2.b', sub: 'II', ex: 2, parent: 'II.2', letter: 'b', label: 'Subiectul al II-lea, exercițiul 2 b)', short: 'S. II · ex. 2 b)', status: 'nou', done: 0, mastered: false });
  assert.strictEqual(b.examPrep.positions, 10, '„X din 10 stăpânite" — doar pozițiile întregi');
  // fără examen ales (clasa a VI-a) → fără pregătire de examen
  assert.strictEqual((await state(U.noexam)).examPrep, null);
  // fără abonament → nimic (sala cere abonament)
  assert.ok(!(await state(U.free)).examPrep);
});
