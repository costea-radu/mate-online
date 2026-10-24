// Teste pentru cererea din 23 oct. 2026: „Verifică dacă la meditații live profesorul
// lasă prima dată elevul să rezolve, apoi dă răspunsul. Dacă nu face asta, fă ca la
// subiectele 2 și 3, ca la subiectul 1, să pună întrebarea pe ecran prima dată."
//   · Subiectul I: „încercați singuri" înaintea explicației (era deja așa);
//   · Subiectele II și III: la fiecare subpunct, PRIMA întrebare pe pas vine înaintea
//     explicației lui (live.askFirst) — și la lecțiile deja scrise, fără să li se
//     schimbe scriptul (id-urile, vocea, `at` rămân); tabla e goală cât elevul încearcă;
//   · itemii care încep deja cu încercarea (tryPoll) rămân cum erau;
//   · ședința de grup încadrată în 2 ore păstrează tocmai întrebarea de dinaintea
//     explicației; serverul (computeTimeline) și versiunea cronologiei (v3);
//   · Pregătirea de examen (exercițiul; testul — doar enunțul și întrebarea, ca înainte);
//   · telefonul: camera pe exercițiu la întrebarea de dinaintea explicației;
//   · lecțiile noi (instrucțiunile modelului), Admin → „Scriptul", demo-ul.
process.env.LIVE_GEN_MODEL = 'gpt-5.6-terra';
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const L = require('../api/_lib/live');
const LL = require('../api/_lib/liveLesson');
const P = require('../api/_lib/pregatire');
const handler = require('../api/live');

const seg = (say, board = [], ask = null) => ({ say, board, ask });
const ask = (question, answer, extra = {}) => ({ type: 'completare', question, options: null, answer, hint: 'Folosiți formula.', explain: 'Din barem.', say: 'Încercați voi și scrieți rezultatul pe ecran.', ...extra });
const MAT = 'Se consideră matricea $A(a) = \\begin{pmatrix} a & 1 \\\\ 1 & a \\end{pmatrix}$, unde $a$ este număr real.';

// BAC, Subiectul al II-lea, 1. a) — ca în lecțiile scrise până acum: profesorul scria
// întâi matricea A(2) pe tablă și abia apoi întreba determinantul (întrebarea la fraza 2)
function rawBac(over = {}) {
  return {
    ref: 'II.1.a', title: 'Subiectul al II-lea, problema 1 a)', kind: 'rezolvare',
    statement: `${MAT} a) Calculați $\\det(A(2))$.`,
    statementTry: null, options: null, answer: '3', points: 5, barem: '$A(2)$ 2p; $\\det(A(2)) = 3$ 3p',
    intro: [seg('Subiectul al doilea, problema 1, punctul a.')], tryPoll: null, afterTry: [],
    modes: {
      barem: [
        seg('Înlocuim a cu doi în matrice.', ['$A(2) = \\begin{pmatrix} 2 & 1 \\\\ 1 & 2 \\end{pmatrix}$ (2p)']),
        seg('Determinantul este doi ori doi minus unu ori unu, adică trei.', ['$\\det(A(2)) = 2 \\cdot 2 - 1 \\cdot 1 = 3$ (3p)'],
          ask('Cât este $\\det\\begin{pmatrix} 2 & 1 \\\\ 1 & 2 \\end{pmatrix}$?', '3')),
      ],
      intuitiv: [seg('Diagonala principală minus diagonala secundară.')], greseli: [seg('Atenție la ordinea scăderii.')], alta_metoda: null,
    },
    check: null, afterCheck: [],
    ...over,
  };
}
// BAC, 1. b) — „Arătați că…" cu rezultat calculabil: începe deja cu încercarea (tryPoll pe
// cerința reformulată „Calculați…"); întrebarea pe pas rămâne la rezultatul intermediar
function rawShowThat() {
  return rawBac({
    ref: 'II.1.b', title: 'Subiectul al II-lea, problema 1 b)', answer: '8',
    statement: `${MAT} b) Arătați că $\\det(A(3)) = 8$.`,
    statementTry: `${MAT} b) Calculați $\\det(A(3))$.`,
    tryPoll: { type: 'completare', question: 'Calculați $\\det(A(3))$.', options: null, answer: '8', explain: '$9 - 1 = 8$' },
    modes: {
      barem: [
        seg('Înlocuim a cu trei în matrice.', ['$A(3) = \\begin{pmatrix} 3 & 1 \\\\ 1 & 3 \\end{pmatrix}$ (2p)']),
        seg('Produsul de pe diagonala principală este nouă.', ['$3 \\cdot 3 = 9$'], ask('Cât este $3 \\cdot 3$?', '9')),
        seg('Scădem unu și obținem opt, exact ce trebuia arătat.', ['$\\det(A(3)) = 9 - 1 = 8$ (3p)']),
      ],
      intuitiv: [seg('Diagonala principală minus diagonala secundară.')], greseli: [], alta_metoda: null,
    },
  });
}
// EN, Subiectul al III-lea, cu a) și b) în același item (întrebările scrise „la pas")
function rawEn() {
  return {
    ref: 'III.1', title: 'Subiectul al III-lea, problema 1', kind: 'rezolvare',
    statement: 'Se consideră expresia $E(x) = (x+1)^2 - x(x+2)$, unde $x$ este număr real.\na) Calculați $E(2)$.\nb) Arătați că $E(x) = 1$ pentru orice număr real $x$.',
    statementTry: null, options: null, answer: '1', points: 5, barem: 'a) 2p  b) 3p',
    intro: [seg('Problema 1.')], tryPoll: null, afterTry: [],
    modes: {
      barem: [
        seg('La punctul a înlocuim x cu doi.', ['a) $E(2) = (2+1)^2 - 2 \\cdot (2+2)$']),
        seg('Deci E de doi este nouă minus opt, adică unu.', ['$E(2) = 9 - 8 = 1$ (2p)'], ask('Cât este $(2+1)^2$?', '9')),
        seg('La punctul b desfacem pătratul.', ['b) $(x+1)^2 = x^2 + 2x + 1$ (2p)'], ask('Desfaceți pătratul: $(x+1)^2 = \\;?$', 'x^2+2x+1')),
        seg('Apoi x ori x plus doi și reducem.', ['$x(x+2) = x^2 + 2x$', '$E(x) = x^2 + 2x + 1 - x^2 - 2x = 1$ (1p)'], ask('Cât este $x(x+2)$?', 'x^2+2x')),
      ],
      intuitiv: [seg('Verificați cu un număr.')], greseli: [seg('Atenție la semnul minus.')], alta_metoda: null,
    },
    check: null, afterCheck: [],
  };
}
// Subiectul I: grilă, cu „încercați singuri"
function rawI() {
  return {
    ref: 'I.1', title: 'Subiectul I, exercițiul 1', kind: 'grila', statement: 'Rezultatul calculului $2+3\\cdot 4$ este:',
    statementTry: null, options: ['20', '14', '24', '9'], answer: 'b', points: 5, barem: 'b 5p',
    intro: [seg('Subiectul I, exercițiul 1.')],
    tryPoll: { type: 'grila', question: 'Rezultatul calculului $2+3\\cdot 4$ este:', options: ['20', '14', '24', '9'], answer: 'b', explain: 'Înmulțirea întâi.' },
    afterTry: [seg('Să vedem răspunsul corect.')],
    modes: { barem: [seg('Întâi înmulțirea, apoi adunarea.', ['$2 + 3 \\cdot 4 = 2 + 12 = 14$'])], intuitiv: [seg('Înmulțirea leagă mai tare.')], greseli: [], alta_metoda: null },
    check: null, afterCheck: [],
  };
}

const norm = (raws, section, exam, grile = {}) => LL.normalizeItems(raws, { section, exam, grile, baremText: '', log: () => {} });
// id-urile (frazele, întrebările) se dau aici, pe itemii înșiși — ca în lecțiile scrise
const scriptOf = (items, exam = 'bac') => LL.assignIds({ title: 'Subiect de test', exam, teacher: 'radu', teacherName: 'Prof. Tudor', pasi: LL.PASI_V, intro: [], qna: [], breakSay: [], outro: [], items });
const itemOf = (raw, section, exam) => scriptOf(norm([raw], section, exam), exam).items[0];
const kinds = (tl, item = 0) => tl.scenes.filter((s) => s.item === item).map((s) => `${s.type}${s.step ? `#${s.step.n}${s.step.first ? '!' : ''}` : ''}${s.cont ? '+' : ''}`);
// rândurile de pe tablă ale itemului, scrise până la scena k (inclusiv)
const boardUpTo = (tl, k) => tl.scenes.slice(0, k + 1).filter((s) => s.type === 'explicatie' && s.mode === 'barem').flatMap((s) => s.segs.flatMap((g) => g.board));

// ─── 1. Verificarea: Subiectul I lasă elevul să încerce întâi ────────────────
test('Subiectul I (neschimbat): întâi „încercați singuri" pe ecran, apoi răspunsul corect, apoi explicația', () => {
  const script = scriptOf(norm([rawI()], 'I', 'en', { I: { 1: 'b' } }), 'en');
  assert.deepStrictEqual(kinds(L.buildTimeline(script, {}, { mode: 'grup', qna: false })), ['item', 'sondaj', 'rezultate', 'explicatie', 'explicatie']);
  assert.deepStrictEqual(kinds(L.buildTimeline(script, {}, { mode: 'privat' })), ['item', 'sondaj', 'rezultate', 'explicatie', 'intrebare_intelegere']);
  assert.deepStrictEqual(L.stepsFor(script.items[0]), [], 'fără întrebări pe pași la Subiectul I');
});

// ─── 2. Subiectele II și III: întâi întrebarea ───────────────────────────────
test('BAC, Subiectul al II-lea (lecție scrisă înainte): întrebarea apare pe ecran înainte ca profesorul să scrie ceva pe tablă', () => {
  const [it] = norm([rawBac()], 'II', 'bac');
  assert.deepStrictEqual(it.steps.map((s) => s.at), [1], 'lecția o pusese la fraza a doua');
  const script = scriptOf([it]);
  for (const mode of ['grup', 'privat']) {
    const tl = L.buildTimeline(script, {}, { mode, qna: false });
    const k = kinds(tl);
    assert.deepStrictEqual(k.slice(0, mode === 'grup' ? 4 : 3), mode === 'grup' ? ['item', 'sondaj#1!', 'rezultate#1!', 'explicatie'] : ['item', 'sondaj#1!', 'explicatie'], `${mode}: ${k.join(' ')}`);
    const q = tl.scenes.findIndex((s) => s.type === 'sondaj');
    assert.deepStrictEqual(boardUpTo(tl, q), [], `${mode}: nimic pe tablă cât elevul încearcă`);
    // profesorul pune întrebarea imediat după enunț (fraza ei e la sfârșitul scenei enunțului)
    const head = tl.scenes[0];
    assert.strictEqual(head.type, 'item');
    assert.strictEqual(head.segs[head.segs.length - 1].id, it.steps[0].ask[0].id);
    assert.ok(!tl.scenes[q + (mode === 'grup' ? 2 : 1)].cont, 'explicația începe abia după întrebare');
    // toată rezolvarea ajunge pe tablă, în ordine
    assert.deepStrictEqual(boardUpTo(tl, tl.scenes.length - 1), it.modes.barem.flatMap((s) => s.board));
  }
});

test('EN, Subiectul al III-lea cu a) și b): la fiecare subpunct întâi întrebarea; pașii din mijloc rămân la rezultatele lor', () => {
  const it = itemOf(rawEn(), 'III', 'en');
  assert.deepStrictEqual(it.steps.map((s) => [s.at, s.part]), [[1, 'a'], [2, 'b'], [3, 'b']], 'cum le-a scris lecția');
  const eff = L.stepsFor(it).map((s) => [s.at, s.part, !!s.first]);
  assert.deepStrictEqual(eff, [[0, 'a', true], [2, 'b', true], [3, 'b', false]]);
  const tl = L.buildTimeline(scriptOf([it], 'en'), {}, { mode: 'grup', qna: false });
  assert.deepStrictEqual(kinds(tl).slice(0, 10), ['item', 'sondaj#1!', 'rezultate#1!', 'explicatie', 'sondaj#2!', 'rezultate#2!', 'explicatie+', 'sondaj#3', 'rezultate#3', 'explicatie+']);
  // întrebarea de la b): pe tablă e doar rezolvarea lui a), nimic din b)
  const qb = tl.scenes.findIndex((s) => s.step?.n === 2);
  assert.deepStrictEqual(boardUpTo(tl, qb), ['a) $E(2) = (2+1)^2 - 2 \\cdot (2+2)$', '$E(2) = 9 - 8 = 1$ (2p)']);
  assert.deepStrictEqual(tl.scenes[qb].step, { n: 2, of: 3, part: 'b', first: true });
});

test('itemul care începe deja cu „încercați singuri" (tryPoll) rămâne cum era', () => {
  const it = itemOf(rawShowThat(), 'II', 'bac');
  assert.ok(it.tryPoll && it.statementTry, 'încercarea pe cerința reformulată');
  assert.deepStrictEqual(L.stepsFor(it).map((s) => [s.at, !!s.first]), [[1, false]]);
  const tl = L.buildTimeline(scriptOf([it]), {}, { mode: 'grup', qna: false });
  assert.deepStrictEqual(kinds(tl).slice(0, 6), ['item', 'sondaj', 'rezultate', 'explicatie', 'sondaj#1', 'rezultate#1']);
  assert.strictEqual(tl.scenes[0].statementTry, it.statementTry, 'pe proiecție: „Calculați…", fără rezultat');
});

test('lecțiile deja scrise: scriptul nu se schimbă — id-urile frazelor (vocea), `at`, întrebările și ordinea lor rămân', () => {
  const script = scriptOf([...norm([rawBac(), rawShowThat()], 'II', 'bac')]);
  const before = JSON.parse(JSON.stringify(script));
  const polls = script.items.flatMap((it) => L.itemPolls(it).map((p) => p.id));
  L.buildTimeline(script, {}, { mode: 'grup' });
  L.buildTimeline(script, {}, { mode: 'privat' });
  L.fitTimeline(script, {}, 3600);
  assert.deepStrictEqual(script, before, 'cronologia doar mută întrebarea, fără să atingă lecția');
  assert.deepStrictEqual(script.items.flatMap((it) => L.itemPolls(it).map((p) => p.id)), polls);
  assert.deepStrictEqual(polls, [script.items[0].steps[0].id, script.items[1].tryPoll.id, script.items[1].steps[0].id]);
  // aceleași fraze (deci aceeași voce generată), fiecare o singură dată
  const ids = (tl) => tl.scenes.flatMap((s) => (s.segs || []).map((g) => g.id));
  const p = ids(L.buildTimeline(script, {}, { mode: 'privat' }));
  assert.strictEqual(new Set(p).size, p.length);
  const all = new Set(LL.segmentsInOrder(script).map((s) => s.id));
  assert.ok(p.every((id) => all.has(id)));
});

test('ședința de grup încadrată în 2 ore: rămâne tocmai întrebarea de dinaintea explicației, la fiecare subpunct', () => {
  const [it] = norm([rawEn()], 'III', 'en');
  const tl = L.buildTimeline(scriptOf([it], 'en'), {}, { mode: 'grup', qna: false, stepsPerPart: 1, leanCheck: true });
  const qs = tl.scenes.filter((s) => s.type === 'sondaj');
  assert.deepStrictEqual(qs.map((s) => [s.step.part, s.step.first]), [['a', true], ['b', true]]);
  // fiecare înaintea primului rând al subpunctului ei
  const qb = tl.scenes.indexOf(qs[1]);
  assert.ok(!boardUpTo(tl, qb).some((l) => /^b\)/.test(l)));
});

test('serverul: cronologia trimisă în sală (1-la-1 și grup) pune întrebarea întâi; cronologia are amprenta versiunii (v4 din 24 oct.)', () => {
  const { computeTimeline, compactState } = handler._internals;
  const script = scriptOf(norm([rawBac()], 'II', 'bac'));
  const lesson = { id: 'l1', status: 'gata', script, progress: { audio: {}, noVoice: true }, updated_at: '2026-10-23T10:00:00.000Z' };
  const priv = computeTimeline({ kind: 'privat', state: {} }, lesson);
  assert.deepStrictEqual(kinds(priv).slice(0, 3), ['item', 'sondaj#1!', 'explicatie']);
  const t0 = Date.now();
  const group = computeTimeline({ kind: 'grup', starts_at: new Date(t0).toISOString(), ends_at: new Date(t0 + 7200000).toISOString(), state: { startedAt: new Date(t0).toISOString() } }, lesson);
  assert.deepStrictEqual(kinds(group).slice(0, 4), ['item', 'sondaj#1!', 'rezultate#1!', 'explicatie']);
  // ședințele în curs își recalculează ferestrele întrebărilor (amprenta nouă)
  const st = compactState(group, lesson);
  assert.strictEqual(st.stamp, '2026-10-23T10:00:00.000Z|v4');
  const q = group.scenes.find((s) => s.type === 'sondaj');
  assert.deepStrictEqual(st.polls[q.poll.id], [q.t0, q.t0 + q.dur]);
});

test('Pregătirea de examen: la exercițiu întâi întrebarea; la test doar enunțul și întrebarea (fără fraza ei), ca înainte', () => {
  const items = scriptOf(norm([rawBac()], 'II', 'bac')).items;
  const ex = P.exerciseTimeline({ items, sid: 'subj-1', n: 1, title: 'BAC 2024' });
  assert.deepStrictEqual(kinds(ex).slice(0, 3), ['item', 'sondaj#1!', 'explicatie']);
  const tt = P.testTimeline([{ sid: 'subj-1', items }], { introSay: 'Testul.' });
  const head = tt.scenes.find((s) => s.type === 'item');
  assert.deepStrictEqual(head.segs.map((g) => g.say), ['Subiectul al doilea, problema 1, punctul a.'], 'la test, fără „încercați voi…"');
  assert.deepStrictEqual(tt.scenes.filter((s) => s.type === 'sondaj').map((s) => s.poll.id), P.testPollsOf(items, 'subj-1').map((q) => q.id));
});

test('telefonul: la întrebarea de dinaintea explicației camera stă pe exercițiu; la pașii din mijloc, pe tablă', async () => {
  const F = await import('../src/lib/live/framing.js');
  const tl = L.buildTimeline(scriptOf(norm([rawEn()], 'III', 'en'), 'en'), {}, { mode: 'grup', qna: false });
  const at = (n, type) => tl.scenes.find((s) => s.type === type && s.step?.n === n);
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: at(1, 'sondaj') }), 'ecran');
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: at(1, 'rezultate') }), 'ecran');
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: at(2, 'sondaj') }), 'ecran', 'b): întâi întrebarea');
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: at(3, 'sondaj') }), 'tabla', 'pasul din mijloc: pașii de până acum sunt pe tablă');
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: tl.scenes[0] }), 'ecran', 'enunțul (și întrebarea pusă după el)');
});

// ─── 3. Lecțiile noi, Admin, demo ────────────────────────────────────────────
test('lecțiile noi: instrucțiunile cer prima întrebare pe primul segment al subpunctului; o astfel de întrebare (chiar rezultatul subpunctului) trece verificările', () => {
  const radu = L.teacherById('radu');
  const sp = LL.systemPrompt(radu, 'bac', 'mate-info');
  assert.match(sp, /ÎNTÂI ÎNTREBAREA, APOI EXPLICAȚIA/);
  assert.match(sp, /pe primul segment al fiecărui subpunct/);
  assert.match(LL.userPrompt({ exam: 'bac', section: 'III', from: 1, to: 2, subjectSection: '', baremSection: '', title: 'T' }), /prima pe PRIMUL lui segment/);
  assert.match(LL.stepsSystemPrompt(radu, 'en', null), /PRIMUL segment al subpunctului/);
  assert.match(JSON.stringify(LL.STEP_FIX_SCHEMA), /la prima întrebare a unui subpunct, primul lui segment/);
  // modelul pune întrebarea pe prima frază și cere chiar rezultatul subpunctului (scris mai târziu)
  const raw = rawBac();
  raw.modes.barem[1].ask = null;
  raw.modes.barem[0].ask = ask('Cât este $\\det(A(2))$?', '3');
  const it = itemOf(raw, 'II', 'bac');
  assert.deepStrictEqual(it.steps.map((s) => [s.at, s.answer]), [[0, '3']]);
  assert.deepStrictEqual(L.stepsFor(it).map((s) => [s.at, !!s.first]), [[0, true]]);
});

test('Admin → „Scriptul": arată locul întrebării din sală („întâi, înaintea explicației"), fără să schimbe lecția', async () => {
  const ADMIN = '33333333-3333-4333-8333-333333333333';
  const script = scriptOf(norm([rawBac()], 'II', 'bac'));
  const lesson = { id: 'dddddddd-0000-4000-8000-0000000000f1', subject_id: 'bbbbbbbb-0000-4000-8000-000000000001', teacher: 'radu', version: 1, status: 'gata', title: 'BAC', exam: 'bac', profile: 'mate-info', script, progress: { audio: {}, noVoice: true }, cost_micro: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  const fake = createFakeSupabase({ profiles: [{ id: ADMIN, full_name: 'Admin', email: 'a@example.com', role: 'admin', is_admin: true }], live_lessons: [lesson] });
  const orig = { admin: ai.admin, authUser: ai.authUser };
  ai.admin = () => fake;
  ai.authUser = async (req) => req.headers['x-user'];
  try {
    const res = fakeRes();
    await handler({ method: 'POST', headers: { 'x-user': ADMIN }, query: {}, body: { action: 'admin_lesson', lessonId: lesson.id } }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    const st = res.body.lesson.script.items[0].steps[0];
    assert.strictEqual(st.at, 0);
    assert.strictEqual(st.first, true);
    assert.strictEqual(fake.db.tables.live_lessons[0].script.items[0].steps[0].at, 1, 'în baza de date, lecția rămâne cum a fost scrisă');
  } finally { Object.assign(ai, orig); }
});

test('demo-ul (/meditatii/demo, /meditatii/demo-1la1): la problema de la Subiectul III întrebarea apare prima; demo.json e la zi', async () => {
  const demo = require('../src/lib/live/demo.json');
  const { DEMO_SCRIPT } = await import('../src/lib/live/demoScript.js');
  const k = DEMO_SCRIPT.items.findIndex((it) => it.ref === 'III.1');
  for (const mode of ['grup', 'privat']) {
    const tl = demo[mode];
    const sc = tl.scenes.filter((s) => s.item === k);
    assert.strictEqual(sc[0].type, 'item');
    assert.strictEqual(sc[0].segs[sc[0].segs.length - 1].id, 'd-31q1', `${mode}: întrebarea, imediat după enunț`);
    assert.strictEqual(sc[1].type, 'sondaj');
    assert.strictEqual(sc[1].poll.question, 'Cât este $E(2)$?', 'ca la Subiectul I: chiar cerința de la a)');
    assert.strictEqual(sc[1].step.first, true);
  }
  // demo.json = cronologia scriptului demo, construită acum (node test/tools/live-demo.js)
  const grup = L.buildTimeline(DEMO_SCRIPT, {}, { mode: 'grup', qnaSec: 25, pause: false, stepSec: 25 });
  const privat = L.buildTimeline(DEMO_SCRIPT, {}, { mode: 'privat' });
  assert.deepStrictEqual(demo, JSON.parse(JSON.stringify({ grup: { ...grup, noVoice: true }, privat: { ...privat, noVoice: true } })));
});
