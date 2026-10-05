// Teste pentru ÎNTREBĂRILE PE PAȘI din meditațiile live (Subiectele II și III):
// profesorul se oprește înaintea rezultatelor intermediare din barem, elevii răspund
// pe ecran, apoi el scrie pasul pe tablă — cel puțin o întrebare la FIECARE subpunct.
//   · lecția (api/_lib/liveLesson.js): pașii scriși de model în explicația pe barem
//     („ask"), verificările deterministe (rezultatul nu e deja pe tablă / în întrebare /
//     în enunțul „Arătați că…"), subpunctele a), b) la EN, completarea subpunctelor
//     rămase fără întrebare (un apel scurt, apoi rândurile de pe tablă, fără AI),
//     lecțiile scrise înainte (addStepQuestions: id-urile și vocea rămân);
//   · cronologia (api/_lib/live.js): explicația oprită la fiecare pas, rezultatele
//     clasei (grup), verdictul pe loc (1-la-1), încadrarea în 2 ore (o întrebare pe
//     subpunct înainte să taie itemi), LIVE_INTREBARI_PASI=0;
//   · browserul: tabla continuă după întrebare (un singur bloc), camera pe tablă;
//   · Pregătirea de examen: pașii în exerciții, la test prima întrebare pe subpunct,
//     recapitularea fără întrebări.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const LL = require('../api/_lib/liveLesson');
const L = require('../api/_lib/live');
const P = require('../api/_lib/pregatire');
const ai = require('../api/_lib/ai');
const mathcheck = require('../api/_lib/mathcheck');

const seg = (say, board = [], ask = null) => ({ say, board, ask });
const ask = (question, answer, extra = {}) => ({ type: 'completare', question, options: null, answer, hint: 'Folosiți formula.', explain: 'Din barem.', say: 'Încercați voi și scrieți rezultatul pe ecran.', ...extra });

// O problemă de EN, Subiectul al III-lea, cu subpunctele a) și b)
function rawEn(over = {}) {
  return {
    ref: 'III.1', title: 'Subiectul al III-lea, problema 1', kind: 'rezolvare',
    statement: 'Se consideră expresia $E(x) = (x+1)^2 - x(x+2)$, unde $x$ este număr real.\na) Calculați $E(2)$.\nb) Arătați că $E(x) = 1$ pentru orice număr real $x$.',
    statementTry: null, options: null, answer: '1', points: 5, barem: 'a) E(2) = 9 − 8 = 1 2p  b) (x+1)² = x² + 2x + 1 2p; E(x) = 1 1p',
    intro: [seg('Problema 1.')], tryPoll: null, afterTry: [],
    modes: {
      barem: [
        seg('La punctul a înlocuim x cu doi.', ['a) $E(2) = (2+1)^2 - 2 \\cdot (2+2)$']),
        seg('Deci E de doi este nouă minus opt, adică unu.', ['$E(2) = 9 - 8 = 1$ (2p)'], ask('Cât este $(2+1)^2$?', '9')),
        seg('La punctul b desfacem pătratul.', ['b) $(x+1)^2 = x^2 + 2x + 1$ (2p)'], ask('Desfaceți pătratul: $(x+1)^2 = \\;?$', 'x^2+2x+1')),
        seg('Apoi x ori x plus doi și reducem.', ['$x(x+2) = x^2 + 2x$', '$E(x) = x^2 + 2x + 1 - x^2 - 2x = 1$ (1p)'],
          { type: 'grila', question: 'Cât este $x(x+2)$?', options: ['a) $x^2+2$', 'b) $x^2+2x$', 'c) $2x^2$', 'd) $3x$'], answer: 'b)', hint: 'Distributivitatea.', explain: '$x \\cdot x + 2x$', say: 'Alegeți varianta corectă.' }),
      ],
      intuitiv: [seg('Verificați cu un număr.')], greseli: [seg('Atenție la semnul minus.')], alta_metoda: null,
    },
    check: null, afterCheck: [],
    ...over,
  };
}
// Un subpunct de BAC (Subiectul al II-lea, 1. b)): itemul e chiar subpunctul
function rawBac(over = {}) {
  return {
    ref: 'II.1.b', title: 'Subiectul al II-lea, problema 1 b)', kind: 'rezolvare',
    statement: 'Se consideră matricea $A(x) = \\begin{pmatrix} 1 & x \\\\ 0 & 1 \\end{pmatrix}$. b) Determinați numărul real $x$ pentru care $\\det(A(x) + A(1)) = 4$.',
    statementTry: null, options: null, answer: '$x = 3$', points: 5, barem: '$A(x)+A(1)$ 2p; det = 4 3p',
    intro: [seg('Trecem la punctul b.')], tryPoll: null, afterTry: [],
    modes: {
      barem: [
        seg('Adunăm matricele.', ['$A(x) + A(1) = \\begin{pmatrix} 2 & x+1 \\\\ 0 & 2 \\end{pmatrix}$ (2p)']),
        seg('Determinantul este doi ori doi minus zero, adică patru, pentru orice x.', ['$\\det(A(x) + A(1)) = 2 \\cdot 2 - 0 = 4$ (3p)']),
      ],
      intuitiv: [], greseli: [], alta_metoda: null,
    },
    check: null, afterCheck: [],
    ...over,
  };
}
const norm = (raws, section = 'III', exam = 'en', log = () => {}) => LL.normalizeItems(raws, { section, exam, baremText: '', log });
const scriptOf = (items, extra = {}) => LL.assignIds({ title: 'Subiect de test', exam: 'en', teacher: 'radu', teacherName: 'Prof. Tudor', pasi: LL.PASI_V, intro: [], qna: [], breakSay: [], outro: [], items, ...extra });

// ─── 1. Lecția ───────────────────────────────────────────────────────────────
test('pașii scriși de model: întrebarea se pune ÎNAINTEA segmentului care scrie rezultatul; subpunctele a), b) la EN', () => {
  const [it] = norm([rawEn()]);
  assert.deepStrictEqual(LL.itemParts(it), ['a', 'b']);
  assert.deepStrictEqual(it.steps.map((s) => [s.at, s.part, s.type, s.answer]), [[1, 'a', 'completare', '9'], [2, 'b', 'completare', 'x^2+2x+1'], [3, 'b', 'grila', 'b']]);
  // grila: variantele curățate de „a) ", litera corectă
  assert.deepStrictEqual(it.steps[2].options, ['$x^2+2$', '$x^2+2x$', '$2x^2$', '$3x$']);
  // fraza cu care profesorul pune întrebarea (rostită) și indiciul
  assert.ok(it.steps.every((s) => s.ask.length === 1 && s.ask[0].say && s.src === 'ai'));
  assert.strictEqual(it.steps[0].hint, 'Folosiți formula.');
  // explicația pe barem rămâne neatinsă (fără „ask")
  assert.ok(it.modes.barem.every((s) => !('ask' in s)));
  assert.deepStrictEqual(LL.missingParts(it), [], 'fiecare subpunct are întrebarea lui');
  // fără „Care este rezultatul final?" lângă pași
  assert.strictEqual(it.check, null);
  // BAC: itemul e chiar subpunctul (o singură parte)
  assert.deepStrictEqual(LL.itemParts(rawBac()), [null]);
  // EN fără nimic care să arate pe tablă / în frază unde începe b) → un singur subpunct
  // (întrebările nu pot fi puse pe subpuncte fără să greșească eticheta)
  const unmarked = rawEn();
  unmarked.modes.barem[0].board = ['$E(2) = (2+1)^2 - 2 \\cdot (2+2)$'];
  unmarked.modes.barem[2] = { ...unmarked.modes.barem[2], say: 'Desfacem pătratul.', board: ['$(x+1)^2 = x^2 + 2x + 1$'] };
  assert.deepStrictEqual(LL.itemParts(norm([unmarked])[0]), [null]);
  // „La punctul b, …" în frază ajunge
  unmarked.modes.barem[2].say = 'La punctul b desfacem pătratul.';
  assert.deepStrictEqual(LL.itemParts(norm([unmarked])[0]), ['a', 'b']);
});

test('pașii: rezultatul deja pe tablă, scris în întrebare sau dat în enunțul „Arătați că…" → întrebarea cade', () => {
  const logs = [];
  const r = rawEn();
  // rezultatul lui (2+1)^2 era deja scris în segmentul de dinainte → nu mai e o întrebare
  r.modes.barem[0].board = ['a) $(2+1)^2 = 9$', '$2 \\cdot (2+2) = 8$'];
  r.modes.barem[1].ask = ask('Cât este $(2+1)^2$?', '9');
  // întrebarea își conține răspunsul
  r.modes.barem[2].ask = ask('Arătați că $(x+1)^2 = x^2+2x+1$', 'x^2+2x+1');
  // rezultatul final al lui b) e chiar în enunț („Arătați că E(x) = 1")
  r.modes.barem[3].ask = ask('Cât rămâne după reducere, $E(x) = \\;?$', '1');
  const [it] = norm([r], 'III', 'en', (m) => logs.push(m));
  assert.deepStrictEqual(it.steps, []);
  assert.ok(logs.some((l) => /deja pe tablă/.test(l)), logs.join('\n'));
  assert.ok(logs.some((l) => /își conține răspunsul/.test(l)));
  assert.ok(logs.some((l) => /dat în enunț/.test(l)));
  assert.deepStrictEqual(LL.missingParts(it), ['a', 'b']);
  // „= 3x" nu înseamnă că rezultatul „3" e scris; „= 16 ⇒" da; fracțiile scrise altfel, la fel
  assert.strictEqual(LL.revealsAnswer('$f(x) = 3x + 1$', '3'), false);
  assert.strictEqual(LL.revealsAnswer('$\\Delta = 16 \\Rightarrow$ două soluții', '16'), true);
  assert.strictEqual(LL.revealsAnswer('$x = \\frac{1}{2}$', '\\dfrac{1}{2}'), true);
  assert.strictEqual(LL.revealsAnswer('$x = 2,5$', '2'), false, '2,5 e un număr zecimal');
});

test('pașii: grila fără 4 variante / fără literă cade; cel mult unul înaintea unui segment, cel mult 4, întâi câte unul pe subpunct', () => {
  const r = rawEn();
  r.modes.barem[3].ask = { type: 'grila', question: 'Cât este $x(x+2)$?', options: ['$x^2$', '$2x$'], answer: 'a', hint: '', explain: '', say: '' };
  const [a] = norm([r]);
  assert.deepStrictEqual(a.steps.map((s) => s.at), [1, 2]);
  // 6 întrebări propuse la b) → rămân 4, cu cea de la a) păstrată
  const it = norm([rawEn()])[0];
  const many = [0, 1, 2, 3, 4].map((k) => ({ ...ask(`Întrebarea ${k} despre $y_${k}$?`, String(100 + k)), at: k === 0 ? 2 : Math.min(4, k + 1) }));
  LL.addSteps(it, many);
  assert.ok(it.steps.length <= 4);
  assert.ok(it.steps.some((s) => s.part === 'a'), 'subpunctul a) își păstrează întrebarea');
  assert.strictEqual(new Set(it.steps.map((s) => s.at)).size, it.steps.length, 'cel mult o întrebare înaintea unui segment');
  assert.deepStrictEqual(it.steps.map((s) => s.at), it.steps.map((s) => s.at).slice().sort((x, y) => x - y), 'în ordinea explicației');
  // fără întrebări la Subiectul I și la grile
  const gr = norm([{ ...rawEn({ ref: 'II.3', options: ['1', '2', '3', '4'], kind: 'grila' }) }], 'II');
  assert.deepStrictEqual(gr[0].steps, []);
});

test('fără AI: subpunctele rămase fără întrebare primesc rezultatul unui pas scris pe tablă', () => {
  assert.deepStrictEqual(LL.lastEquality('$\\Delta = b^2 - 4ac = 16$ (2p)'), { lhs: '\\Delta = b^2 - 4ac', rhs: '16' });
  assert.strictEqual(LL.lastEquality('a) $E(2) = (2+1)^2 - 2 \\cdot (2+2)$'), null, 'o expresie încă necalculată nu e un rezultat');
  assert.deepStrictEqual(LL.lastEquality('a) $E(2) = (2+1)^2 - 2 \\cdot (2+2)$', { strict: false }), { lhs: 'E(2)', rhs: '(2+1)^2 - 2 \\cdot (2+2)' }, '… dar e o înlocuire de calculat');
  assert.strictEqual(LL.lastEquality('$= 16 - 12 = 4$'), null, 'rândul de continuare nu are membrul stâng');
  assert.strictEqual(LL.lastEquality('$x \\in \\{1, 3\\}$'), null);
  const r = rawEn();
  for (const s of r.modes.barem) s.ask = null;
  const [it] = norm([r]);
  assert.deepStrictEqual(LL.missingParts(it), ['a', 'b']);
  const n = LL.addBaremSteps(it, LL.missingParts(it));
  assert.strictEqual(n, 2);
  // a): „E(2) = 9 - 8 = 1" ar da rezultatul pe care enunțul îl spune deja (E(x) = 1 la b) →
  // înlocuirea de calculat, înaintea explicației; b): pătratul desfăcut
  assert.deepStrictEqual(it.steps.map((s) => [s.at, s.part, s.answer, s.src]), [[0, 'a', '(2+1)^2 - 2 \\cdot (2+2)', 'barem'], [2, 'b', 'x^2 + 2x + 1', 'barem']]);
  assert.match(it.steps[0].question, /E\(2\) = \\;\?/);
  assert.strictEqual(L.checkPollAnswer(it.steps[0], '1', mathcheck.answersEquivalent), true, 'elevul scrie valoarea: 1');
  assert.ok(it.steps[1].ask[0].say.length > 10);
  assert.deepStrictEqual(LL.missingParts(it), []);
  // răspunsul elevului se verifică matematic („x²+2x+1" = „x^2 + 2x + 1")
  assert.strictEqual(L.checkPollAnswer(it.steps[1], 'x^2+2x+1', mathcheck.answersEquivalent), true);
  assert.strictEqual(L.checkPollAnswer(it.steps[1], '(x+1)*(x+1)', mathcheck.answersEquivalent), true);
});

test('subpunctele fără întrebare: un apel scurt (segmentele numerotate, „LIPSĂ"), apoi pașii din barem; generateScript pune „pasi"', async () => {
  const orig = ai.chatJson;
  const seen = [];
  ai.chatJson = async ({ messages, schemaName, system }) => {
    seen.push({ schemaName, text: messages[0].content, system });
    if (schemaName === 'intrebari_pe_pasi') {
      return { data: { items: [
        // înainte de [3] = segmentul cu (x+1)^2 desfăcut
        { ref: 'III.1', steps: [{ before: 3, ...ask('Ce obțineți desfăcând $(x+1)^2$?', 'x^2+2x+1') }] },
        { ref: 'II.1.b', steps: [{ before: 2, ...ask('Cât este $\\det\\begin{pmatrix} 2 & x+1 \\\\ 0 & 2 \\end{pmatrix}$?', '4') }] },
      ] }, usage: { in: 50, out: 20 } };
    }
    const sec = /SUBIECTUL (I{1,3})\b/.exec(typeof messages[0].content === 'string' ? messages[0].content : messages[0].content[0].text)[1];
    const strip = (r) => { for (const s of r.modes.barem) s.ask = null; return r; };
    const items = sec === 'III' ? [strip(rawEn())] : sec === 'II' ? [strip(rawBac({ ref: 'II.1.b' }))] : [
      { ...rawEn({ ref: 'I.1', title: 'S. I, 1', kind: 'rezultat', statement: 'Calculați $2+3\\cdot 4$.', answer: '14', tryPoll: { type: 'completare', question: 'Cât este $2+3\\cdot 4$?', options: null, answer: '14', explain: '' } }) },
    ];
    return { data: { items }, usage: { in: 100, out: 100 } };
  };
  try {
    const SUBJ = 'SUBIECTUL I\n1. Calculați\nSUBIECTUL al II-lea\n1. Matricea\nSUBIECTUL al III-lea\n1. Expresia';
    const BAR = 'SUBIECTUL I\n1. 14 5p\nSUBIECTUL al II-lea\n1. b) 4 3p\nSUBIECTUL al III-lea\n1. a) 1 2p b) 3p';
    const r = await LL.generateScript({ ctx: { text: SUBJ, baremText: BAR, baremStatus: 'ok' }, content: { id: 'c1', title: 'BAC test' }, teacher: L.teacherById('radu'), exam: 'en', profile: null, log: () => {} });
    const fix = seen.filter((x) => x.schemaName === 'intrebari_pe_pasi');
    assert.strictEqual(fix.length, 2, 'câte un apel pe secțiune (II și III), doar pentru itemii fără întrebări');
    const t3 = fix.map((x) => x.text).find((t) => /ITEMUL III\.1/.test(t));
    assert.match(t3, /\[1\] spune: „La punctul a/);
    assert.match(t3, /a\) — LIPSĂ, b\) — LIPSĂ/);
    assert.match(fix[0].system, /CEL PUȚIN o întrebare la FIECARE subpunct/);
    const byRef = Object.fromEntries(r.script.items.map((it) => [it.ref, it]));
    assert.strictEqual(r.script.pasi, LL.PASI_V);
    // III.1: b) de la model, a) din rândurile de pe tablă
    assert.deepStrictEqual(byRef['III.1'].steps.map((s) => [s.part, s.src]), [['a', 'barem'], ['b', 'ai']]);
    assert.deepStrictEqual(byRef['II.1.b'].steps.map((s) => [s.at, s.answer]), [[1, '4']]);
    assert.deepStrictEqual(byRef['I.1'].steps, [], 'Subiectul I: fără întrebări pe pași (are încercarea de la început)');
    assert.strictEqual(r.steps.missing.length, 0);
    assert.ok(r.usage.in >= 150, 'costul apelului scurt intră în lecție');
    // id-urile: pași + frazele lor, unice, în ordinea vocii
    const ids = LL.segmentsInOrder(r.script).map((s) => s.id);
    assert.strictEqual(new Set(ids).size, ids.length);
    assert.ok(byRef['III.1'].steps.every((s) => /^p\d+s-/.test(s.id) && ids.includes(s.ask[0].id)));
    // prompturile cer întrebările pe pași
    const sp = LL.systemPrompt(L.teacherById('radu'), 'bac', 'mate-info');
    assert.match(sp, /6b\. ÎNTREBĂRILE PE PAȘI/);
    assert.match(LL.userPrompt({ exam: 'bac', section: 'II', from: 1, to: 3, subjectSection: '', baremSection: '', title: 'T' }), /întrebările pe pași/);
  } finally { ai.chatJson = orig; }
});

test('lecțiile scrise înainte: addStepQuestions adaugă doar întrebările (id-urile și vocea rămân); modelul nu răspunde → pașii din barem', async () => {
  const strip = (r) => { for (const s of r.modes.barem) s.ask = null; return r; };
  const old = scriptOf(norm([strip(rawEn())]), { pasi: undefined });
  delete old.pasi;
  delete old.items[0].steps;                              // ca într-o lecție veche
  assert.strictEqual(LL.needsSteps(old), true);
  const before = LL.segmentsInOrder(old).map((s) => s.id);
  const orig = ai.chatJson;
  ai.chatJson = async () => { const e = new Error('rețeaua a căzut'); e.usage = { in: 5, out: 0 }; throw e; };
  try {
    const r = await LL.addStepQuestions({ script: old, teacher: L.teacherById('radu'), log: () => {} });
    assert.strictEqual(r.script.pasi, LL.PASI_V);
    assert.strictEqual(LL.needsSteps(r.script), false);
    assert.strictEqual(r.report.aiFailed, 1);
    assert.strictEqual(r.report.fromBarem, 2);
    const after = LL.segmentsInOrder(r.script).map((s) => s.id);
    assert.deepStrictEqual(after.filter((id) => before.includes(id)), before, 'segmentele vechi își păstrează id-urile (și vocea)');
    assert.strictEqual(after.length, before.length + 2, '+ frazele celor două întrebări');
    assert.ok(!old.items[0].steps, 'originalul rămâne neatins');
    // „force" le scrie din nou, de la zero
    ai.chatJson = async () => ({ data: { items: [{ ref: 'III.1', steps: [{ before: 2, ...ask('Cât este $(2+1)^2$?', '9') }, { before: 3, ...ask('Desfaceți $(x+1)^2$.', 'x^2+2x+1') }] }] }, usage: { in: 1, out: 1 } });
    const again = await LL.addStepQuestions({ script: r.script, teacher: L.teacherById('radu'), log: () => {}, force: true });
    assert.deepStrictEqual(again.script.items[0].steps.map((s) => [s.part, s.src, s.answer]), [['a', 'ai', '9'], ['b', 'ai', 'x^2+2x+1']]);
  } finally { ai.chatJson = orig; }
});

// ─── 2. Cronologia ───────────────────────────────────────────────────────────
test('cronologia: explicația pe barem se oprește la fiecare pas (grup: rezultatele clasei; 1-la-1: așteaptă elevul)', () => {
  const script = scriptOf(norm([rawEn()]));
  const tl = L.buildTimeline(script, {}, { mode: 'grup', qnaSec: 30 });
  const types = tl.scenes.map((s) => `${s.type}${s.step ? `#${s.step.n}` : ''}${s.cont ? '+' : ''}`);
  assert.deepStrictEqual(types.slice(0, 13), ['item', 'explicatie', 'sondaj#1', 'rezultate#1', 'explicatie+', 'sondaj#2', 'rezultate#2', 'explicatie+', 'sondaj#3', 'rezultate#3', 'explicatie+', 'explicatie', 'intrebari']);
  const q1 = tl.scenes.find((s) => s.type === 'sondaj');
  assert.strictEqual(q1.poll.answer, undefined, 'răspunsul nu pleacă în browser cât e deschisă întrebarea');
  assert.strictEqual(q1.poll.hint, 'Folosiți formula.');
  assert.deepStrictEqual(q1.step, { n: 1, of: 3, part: 'a' });
  assert.strictEqual(q1.dur, L.POLL_STEP_SEC());
  assert.strictEqual(tl.scenes.find((s) => s.type === 'rezultate').poll.answer, '9');
  // fraza cu care se pune întrebarea e la sfârșitul bucății de explicație dinainte
  const e1 = tl.scenes[1];
  assert.strictEqual(e1.segs[e1.segs.length - 1].id, script.items[0].steps[0].ask[0].id);
  // pe tablă: toată rezolvarea, în aceeași ordine (bucățile nu pierd și nu dublează rânduri)
  const lines = tl.scenes.filter((s) => s.type === 'explicatie' && s.mode === 'barem').flatMap((s) => s.segs.flatMap((g) => g.board));
  assert.deepStrictEqual(lines, script.items[0].modes.barem.flatMap((s) => s.board));
  for (let i = 1; i < tl.scenes.length; i++) assert.ok(Math.abs(tl.scenes[i].t0 - (tl.scenes[i - 1].t0 + tl.scenes[i - 1].dur)) < 1e-6);
  // 1-la-1: întrebările așteaptă elevul, fără scena de rezultate (verdictul e pe card)
  const p = L.buildTimeline(script, {}, { mode: 'privat' });
  const st = p.scenes.filter((s) => s.step);
  assert.strictEqual(st.length, 3);
  assert.ok(st.every((s) => s.type === 'sondaj' && s.wait === true && s.dur === 0));
  // toate întrebările itemului, în ordine; cheile de pe server le cuprind
  assert.deepStrictEqual(L.itemPolls(script.items[0]).map((x) => x.id), script.items[0].steps.map((x) => x.id));
});

test('cronologia: o întrebare pe subpunct, fără verificarea de la sfârșit, fără pași; LIVE_INTREBARI_PASI=0', () => {
  const it = norm([rawEn()])[0];
  it.check = { type: 'completare', question: 'Cât este $E(5)$?', options: null, answer: '1', explain: '' };
  it.afterCheck = [{ say: 'Să verificăm.', board: [] }];
  const script = scriptOf([it]);
  const qs = (o) => L.buildTimeline(script, {}, { mode: 'grup', ...o }).scenes.filter((s) => s.type === 'sondaj').map((s) => (s.step ? `${s.step.part}${s.step.n}` : s.verificare ? 'check' : 'try'));
  assert.deepStrictEqual(qs({}), ['a1', 'b2', 'b3', 'check']);
  assert.deepStrictEqual(qs({ stepsPerPart: 1 }), ['a1', 'b2', 'check']);
  assert.deepStrictEqual(qs({ stepsPerPart: 1, leanCheck: true }), ['a1', 'b2']);
  assert.deepStrictEqual(qs({ steps: false }), ['check']);
  const noSteps = L.buildTimeline(script, {}, { mode: 'grup', steps: false });
  assert.ok(!noSteps.scenes.some((s) => s.cont), 'fără pași, explicația e dintr-o bucată');
  assert.ok(!noSteps.scenes.flatMap((s) => s.segs || []).some((g) => script.items[0].steps.some((st) => st.ask[0].id === g.id)), 'fără frazele întrebărilor');
  process.env.LIVE_INTREBARI_PASI = '0';
  try {
    assert.deepStrictEqual(qs({}), ['check']);
    assert.deepStrictEqual(L.itemPolls(script.items[0]).length, 1);
    assert.deepStrictEqual(norm([rawEn()])[0].steps, [], 'nici lecțiile noi nu le mai primesc');
  } finally { delete process.env.LIVE_INTREBARI_PASI; }
});

test('încadrarea în 2 ore: întâi al doilea mod, apoi o singură întrebare pe subpunct — abia apoi mai puțini itemi', () => {
  const items = [];
  for (let k = 1; k <= 6; k++) items.push({ ...norm([rawEn({ ref: `III.${k}` })])[0] });
  const script = scriptOf(items);
  // fiecare segment de explicație durează mult → lecția nu încape cu toate întrebările
  const audio = {};
  for (const it of script.items) for (const s of it.modes.barem) audio[s.id] = { dur: 95 };
  const full = L.buildTimeline(script, audio, { mode: 'grup' }).duration;
  const lean = L.buildTimeline(script, audio, { mode: 'grup', dropAlt: [0, 1, 2, 3, 4, 5], stepsPerPart: 1, leanCheck: true }).duration;
  const target = Math.round((full + lean) / 2);
  const fit = L.fitTimeline(script, audio, target);
  assert.ok(fit.duration <= target);
  assert.strictEqual(fit.covered, 6, 'toți itemii rămân');
  assert.strictEqual(fit.fit.stepsPerPart, 1);
  const perItem = fit.scenes.filter((s) => s.type === 'sondaj' && s.step).length;
  assert.strictEqual(perItem, 12, 'câte o întrebare la fiecare subpunct (6 probleme × a, b)');
});

// ─── 3. Browserul ────────────────────────────────────────────────────────────
function importLive(names, main) {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'live-pasi-'));
  for (const n of names) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'live', `${n}.js`), 'utf8').replace(/from '\.\/([\w-]+)'/g, "from './$1.mjs'");
    fs.writeFileSync(path.join(dir, `${n}.mjs`), src);
  }
  return import(require('node:url').pathToFileURL(path.join(dir, `${main}.mjs`)).href);
}

test('browserul: tabla continuă după fiecare întrebare (un singur bloc „pe barem"); pe telefon camera stă pe tablă', async () => {
  const T = await importLive(['timeline'], 'timeline');
  const F = await import('../src/lib/live/framing.js');
  const tl = L.buildTimeline(scriptOf(norm([rawEn()])), {}, { mode: 'grup', qnaSec: 30 });
  const i3 = tl.scenes.findIndex((s) => s.type === 'sondaj' && s.step?.n === 3);
  const b = T.boardState(tl, i3, 0);
  assert.strictEqual(b.blocks.length, 1, 'fără separator între bucățile explicației');
  assert.deepStrictEqual(b.blocks[0].lines.map((l) => l.text), ['a) $E(2) = (2+1)^2 - 2 \\cdot (2+2)$', '$E(2) = 9 - 8 = 1$ (2p)', 'b) $(x+1)^2 = x^2 + 2x + 1$ (2p)']);
  // după explicația pe barem vine al doilea mod (alt bloc, cu separator)
  const iAlt = tl.scenes.findIndex((s) => s.type === 'explicatie' && s.mode !== 'barem');
  const b2 = T.boardState(tl, iAlt, 1e9);
  assert.deepStrictEqual(b2.blocks.map((x) => x.mode), ['barem', tl.scenes[iAlt].mode]);
  assert.strictEqual(b2.blocks[0].lines.length, 5);
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: tl.scenes[i3] }), 'tabla', 'întrebarea pe pas: pașii de până acum sunt pe tablă');
  assert.strictEqual(F.autoFocus({ phase: 'live', scene: { type: 'sondaj' } }), 'ecran', 'încercarea de la început: exercițiul');
});

test('browserul, 1-la-1: la întrebarea pe pas profesorul așteaptă răspunsul, apoi scrie pasul', async () => {
  const { PrivatePlayer } = await importLive(['player', 'clock', 'timeline'], 'player');
  const realNow = Date.now;
  let now = 5_000_000;
  Date.now = () => now;
  try {
    const engine = { active: new Set(), play(id) { this.active.add(id); return Promise.resolve({}); }, isPlaying(id) { return this.active.has(id); }, stopAll() { this.active.clear(); }, stopExcept(k) { for (const id of [...this.active]) if (!k.has(id)) this.active.delete(id); }, mouth: () => ({ open: 0 }) };
    let last = null;
    const p = new PrivatePlayer({ engine, onState: (s) => { last = s; } });
    const tl = { ...L.buildTimeline(scriptOf(norm([rawEn()])), {}, { mode: 'privat' }), noVoice: true };
    p.setTimeline(tl);
    p.start(); clearInterval(p.timer); p.timer = null;
    const run = (sec) => { for (let k = 0; k < sec * 4; k++) { now += 250; p.tick(); } };
    run(40);
    assert.strictEqual(p.scene.type, 'sondaj');
    assert.strictEqual(p.status, 'asteapta', 'oricât ar dura, nu trece singur peste întrebare');
    assert.deepStrictEqual(p.scene.step, { n: 1, of: 3, part: 'a' });
    const id = p.scene.poll.id;
    p.pollDone(id, { correct: false, answer: '9' });   // „Nu știu — arată-mi"
    assert.strictEqual(p.scene.type, 'explicatie');
    assert.strictEqual(p.scene.cont, true);
    run(1);
    assert.ok(last.board.blocks[0].lines.length >= 1);
  } finally { Date.now = realNow; }
});

// ─── 4. Pregătirea de examen ─────────────────────────────────────────────────
test('Pregătirea de examen: pașii în exercițiu; la test prima întrebare de la fiecare subpunct (aceleași id-uri la notare); recapitularea fără întrebări', () => {
  const it = norm([rawEn()])[0];
  const items = scriptOf([it]).items;
  const ex = P.exerciseTimeline({ items, sid: 'subj-1', n: 1, title: 'EN 2024' });
  const exPolls = ex.scenes.filter((s) => s.type === 'sondaj');
  assert.strictEqual(exPolls.length, 3);
  const ns = P.nsOf('subj-1');
  assert.ok(exPolls.every((s) => s.poll.id.startsWith(ns)), 'id-uri cu prefixul subiectului');
  assert.ok(ex.scenes.flatMap((s) => s.segs || []).every((g) => g.id.startsWith(ns) || /^pin/.test(g.id.slice(ns.length)) || g.id.startsWith(ns)));
  assert.strictEqual(P.pollsOf(P.namespaced(items, 'subj-1')).length, 3);
  assert.ok(P.hasPolls(it));
  const tt = P.testTimeline([{ sid: 'subj-1', items }], { introSay: 'Testul.' });
  const testIds = tt.scenes.filter((s) => s.type === 'sondaj').map((s) => s.poll.id);
  assert.deepStrictEqual(testIds, P.testPollsOf(items, 'subj-1').map((q) => q.id), 'notarea numără exact întrebările din test');
  assert.strictEqual(testIds.length, 2, 'a) și b): câte una');
  const rv = P.reviewTimeline([{ sid: 'subj-1', items }], { introSay: 'Recapitulăm.' });
  assert.ok(!rv.scenes.some((s) => s.type === 'sondaj'));
  const askIds = new Set(P.namespaced(items, 'subj-1')[0].steps.map((s) => s.ask[0].id));
  assert.ok(!rv.scenes.flatMap((s) => s.segs || []).some((g) => askIds.has(g.id)), 'nici frazele cu care se pun întrebările');
});
