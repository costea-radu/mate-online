// Teste pentru SIMULĂRILE DIN SUBIECTELE OFICIALE din „Planul meu"
// (api/_lib/simulariOficiale.js + api/ai-meditatii.js → simulare): pozițiile
// examenului se iau din itemii puși pe barem în lecțiile meditațiilor live, fără
// model; generarea rămâne doar pentru când itemii oficiali nelucrați s-au terminat.
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const med = require('../api/_lib/meditatii');
const SO = require('../api/_lib/simulariOficiale');

const U = { en: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', bac: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };
const sid = (k) => `cccccccc-0000-4000-8000-${String(k).padStart(12, '0')}`;
const lid = (k) => `dddddddd-0000-4000-8000-${String(k).padStart(12, '0')}`;
const barem = (lines) => [{ say: 'Pe barem.', board: lines }];

// grilele de EN: răspunsul corect e mereu „b" (14), ca să se poată verifica ușor
function enGrila(ref, { figure = false } = {}) {
  const statement = `${figure ? 'În figura alăturată, ' : ''}Rezultatul calculului $2+3\\cdot 4$ (${ref}) este:`;
  return {
    ref, kind: 'grila', statement, options: ['20', '14', '24', '9'], answer: 'b',
    tryPoll: { id: `p-${ref}`, type: 'grila', question: statement, options: ['20', '14', '24', '9'], answer: 'b', explain: 'Întâi înmulțirea.' },
    modes: { barem: barem(['$3\\cdot 4=12$', '$2+12=14$ (5p)']) },
  };
}
function enScript(k) {
  const items = [];
  for (let e = 1; e <= 6; e++) items.push(enGrila(`I.${e}`));
  for (let e = 1; e <= 6; e++) items.push(enGrila(`II.${e}`, { figure: e === 3 }));
  items.push({ ref: 'III.1', kind: 'rezolvare', statement: 'Problema III.1 cu a) și b).', tryPoll: null, check: null, modes: { barem: barem(['...']) } });
  return { title: `EN ${2020 + k} Varianta ${k}`, items };
}
// BAC: S. I cu rezultat; II.1.a cu datele problemei (Arătați că → reformulat), II.1.b fără ele
function bacScript(k) {
  const items = [];
  for (let e = 1; e <= 6; e++) {
    items.push({
      ref: `I.${e}`, kind: 'rezultat', statement: `Calculați $\\frac{1}{2}+\\frac{${e}}{2}$ (I.${e}).`, answer: `${(1 + e) / 2}`,
      tryPoll: { id: `t-${e}`, type: 'completare', question: 'Cât este rezultatul?', options: null, answer: `\\frac{${1 + e}}{2}`, explain: 'Aduni numărătorii.' },
      modes: { barem: barem([`$\\frac{1}{2}+\\frac{${e}}{2}=\\frac{${1 + e}}{2}$`]) },
    });
  }
  items.push({
    ref: 'II.1.a', kind: 'rezolvare', statement: 'Se consideră matricea $A=\\begin{pmatrix}1&2\\\\0&1\\end{pmatrix}$. a) Arătați că $\\det A = 1$.',
    statementTry: 'Se consideră matricea $A=\\begin{pmatrix}1&2\\\\0&1\\end{pmatrix}$. a) Calculați $\\det A$.',
    tryPoll: { id: 'ta', type: 'completare', question: 'Cât este $\\det A$?', options: null, answer: '1', explain: '$1\\cdot 1-2\\cdot 0$' },
    modes: { barem: barem(['$\\det A=1\\cdot1-2\\cdot0=1$ (5p)']) },
  });
  items.push({
    ref: 'II.1.b', kind: 'rezolvare', statement: 'b) Determinați numărul real $x$ pentru care $\\det(A+xI_2)=0$.',
    tryPoll: { id: 'tb', type: 'completare', question: 'Cât este $x$?', options: null, answer: '-1', explain: '' },
    modes: { barem: barem(['$(1+x)^2=0$']) },
  });
  items.push({
    ref: 'III.1.a', kind: 'rezolvare', statement: 'Se consideră funcția $f(x)=x^2$. a) Arătați că $f\'(1)=2$.',
    statementTry: null, tryPoll: null, modes: { barem: barem(['$f\'(x)=2x$']) },
  });
  return { title: `BAC M_mate-info ${2020 + k}`, items };
}

let fake;
const calls = { gen: 0, rate: 0, usage: [] };
function setup({ en = 3, bac = 2, otherProfile = 1, siteTests = false } = {}) {
  const live_lessons = [];
  for (let k = 1; k <= en; k++) live_lessons.push({ id: lid(k), subject_id: sid(k), teacher: 'radu', version: 1, status: 'gata', exam: 'en', profile: null, title: enScript(k).title, script: enScript(k) });
  for (let k = 1; k <= bac; k++) live_lessons.push({ id: lid(100 + k), subject_id: sid(100 + k), teacher: 'radu', version: 1, status: 'script', exam: 'bac', profile: 'mate-info', title: bacScript(k).title, script: bacScript(k) });
  for (let k = 1; k <= otherProfile; k++) live_lessons.push({ id: lid(200 + k), subject_id: sid(200 + k), teacher: 'radu', version: 1, status: 'gata', exam: 'bac', profile: 'stiinte-naturii', title: 'BAC Științe', script: bacScript(9) });
  // o lecție încă nescrisă nu contează
  live_lessons.push({ id: lid(300), subject_id: sid(300), teacher: 'radu', version: 1, status: 'nou', exam: 'en', profile: null, title: null, script: null });
  fake = createFakeSupabase({
    ai_meditatii_profile: [
      { user_id: U.en, grade: 8, exam_target: 'evaluare-nationala', level: 'mediu', memory: {}, plan: { chapters: [] }, assessment: {} },
      { user_id: U.bac, grade: 12, exam_target: 'bac-mate-info', level: 'mediu', memory: {}, plan: { chapters: [] }, assessment: {} },
    ],
    ai_meditatii_sessions: [], ai_meditatii_homework: [], live_lessons,
  });
  calls.gen = 0; calls.rate = 0; calls.usage = [];
  med.siteInteractiveFor = async () => (siteTests ? [{ id: sid(900), title: 'Test din site', is_free: true }] : []);
}

ai.applyCors = () => {};
ai.admin = () => fake;
ai.authUser = async (req) => req.headers['x-user'];
ai.requireUser = async (supa, id) => ({ id, is_admin: false, subscription_status: 'active' });
ai.enforceRateLimit = async () => { calls.rate++; return {}; };
ai.logUsage = async (supa, userId, endpoint) => { calls.usage.push(endpoint); };
ai.createNotification = async () => true;
med.classifyMistakes = async (items) => items.map((_, i) => ({ index: i, errorType: 'calcul', analysis: '' }));
med.genQuestions = async (supa, args) => {
  calls.gen++;
  return { questions: Array.from({ length: args.count }, (_, i) => ({ statement: `Generat ${i + 1}`, options: ['1', '2', '3', '4'], answer: 0, explanation: '' })), provider: 'stub', usage: {} };
};

const handler = require('../api/ai-meditatii');
async function call(user, body) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: { 'x-user': user }, query: {}, body }, res);
  return res;
}
const sessOf = (id) => fake.db.tables.ai_meditatii_sessions.find((s) => s.id === id);

test('EN: simularea vine dintr-un subiect oficial (S. I + S. II, 12 grile), fără model', async () => {
  setup();
  const r = await call(U.en, { action: 'simulare' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.questions.length, 12);
  assert.strictEqual(r.body.source.kind, 'oficial');
  assert.strictEqual(r.body.source.titles.length, 1, 'tot dintr-un singur subiect');
  assert.strictEqual(calls.gen, 0);
  assert.strictEqual(calls.rate, 0, 'nici limitele AI: nu costă nimic');
  assert.ok(calls.usage.includes('ai-meditatii:simulare-oficiala'));
  // la client: fără răspuns, cu sursa (și figura la II.3)
  const q = r.body.questions;
  assert.ok(q.every((x) => x.answer === undefined && x.options.length === 4));
  assert.ok(q.every((x) => /^\/pdf-viewer\?id=cccccccc-/.test(x.source.url)));
  assert.deepStrictEqual(q.map((x) => x.source.ref), ['I.1', 'I.2', 'I.3', 'I.4', 'I.5', 'I.6', 'II.1', 'II.2', 'II.3', 'II.4', 'II.5', 'II.6']);
  assert.deepStrictEqual(q.filter((x) => x.source.figure).map((x) => x.source.ref), ['II.3']);
  // în sesiune: răspunsul din barem + explicația de pe tablă
  const s = sessOf(r.body.sessionId);
  assert.strictEqual(s.payload.provider, 'oficial');
  assert.strictEqual(s.payload.official.length, 12);
  assert.strictEqual(s.payload.questions[0].answer, 1);
  assert.match(s.payload.questions[0].explanation, /Întâi înmulțirea\.\n\$3\\cdot 4=12\$/);

  // corectarea: ca la orice simulare (grilele pe index)
  const answers = q.map((_, i) => (i < 10 ? 1 : 0));
  const g = await call(U.en, { action: 'submit_set', sessionId: r.body.sessionId, answers, durationSec: 600 });
  assert.strictEqual(g.statusCode, 200, JSON.stringify(g.body));
  assert.strictEqual(g.body.score, 10);
  assert.strictEqual(g.body.maxScore, 12);
});

test('simularea următoare ia alt subiect; după epuizare → generare (cu limitele AI)', async () => {
  setup({ en: 2 });
  const a = await call(U.en, { action: 'simulare', forceGenerate: true });
  const b = await call(U.en, { action: 'simulare', forceGenerate: true });
  assert.notDeepStrictEqual(a.body.source.titles, b.body.source.titles);
  const keys = [a, b].flatMap((r) => sessOf(r.body.sessionId).payload.official.map((o) => `${o.sid}|${o.ref}`));
  assert.strictEqual(new Set(keys).size, 24, 'niciun item oficial repetat');
  assert.strictEqual(calls.gen, 0);
  const c = await call(U.en, { action: 'simulare', forceGenerate: true });
  assert.strictEqual(c.statusCode, 200);
  assert.strictEqual(c.body.source, undefined);
  assert.strictEqual(calls.gen, 1, 'itemii oficiali nelucrați s-au terminat → generare');
  assert.strictEqual(calls.rate, 1);
});

test('testele din site au în continuare prioritate (fără „Simulare nouă")', async () => {
  setup({ siteTests: true });
  const r = await call(U.en, { action: 'simulare' });
  assert.ok(r.body.siteTest, JSON.stringify(r.body));
  const n = await call(U.en, { action: 'simulare', forceGenerate: true });
  assert.strictEqual(n.body.source.kind, 'oficial');
});

test('BAC: S. I + subpunctele cu datele problemei; doar profilul elevului; răspunsuri echivalente acceptate', async () => {
  setup({ en: 0 });
  const r = await call(U.bac, { action: 'simulare' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const refs = r.body.questions.map((q) => q.source.ref);
  assert.deepStrictEqual(refs, ['I.1', 'I.2', 'I.3', 'I.4', 'I.5', 'I.6', 'II.1.a']);
  assert.strictEqual(r.body.source.titles.length, 1);
  assert.ok(r.body.questions.every((q) => q.answer_type === 'open'));
  // „Arătați că" → enunțul reformulat (fără rezultat); întrebarea pusă vine sub enunț
  assert.match(r.body.questions[6].statement, /Calculați \$\\det A\$/);
  assert.doesNotMatch(r.body.questions[6].statement, /Arătați/);
  assert.match(r.body.questions[0].statement, /\n\nCât este rezultatul\?$/);
  // II.1.b (fără datele problemei) și III.1.a („Arătați că" fără reformulare) nu intră
  const official = sessOf(r.body.sessionId).payload.official;
  assert.ok(official.every((o) => o.sid !== sid(201)), 'nu din alt profil');
  // „1" la I.1 (= 2/2), „2,5" la 5/2: echivalența matematică
  const answers = ['1', '1.5', '4/2', '2,5', '3', '3.5', '1'];
  const g = await call(U.bac, { action: 'submit_set', sessionId: r.body.sessionId, answers, durationSec: 900 });
  assert.strictEqual(g.body.score, 7, JSON.stringify(g.body.results || g.body));
});

test('pregătirea doar pe Subiectul I: 12 itemi din S. I, din două subiecte', async () => {
  setup();
  fake.db.tables.ai_meditatii_profile[0].memory = { exam_scope: 's1' };
  const r = await call(U.en, { action: 'simulare', forceGenerate: true });
  assert.strictEqual(r.body.questions.length, 12);
  assert.ok(r.body.questions.every((q) => q.source.ref.startsWith('I.')));
  assert.strictEqual(r.body.source.titles.length, 2);
});

test('fără lecții scrise (sau tabelă lipsă) → generare, ca înainte', async () => {
  setup({ en: 0, bac: 0, otherProfile: 0 });
  const r = await call(U.en, { action: 'simulare', forceGenerate: true });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(calls.gen, 1);
  setup();
  fake.db.failTables.add('live_lessons');
  const t = await call(U.en, { action: 'simulare', forceGenerate: true });
  assert.strictEqual(t.statusCode, 200);
  assert.strictEqual(calls.gen, 1);
});

test('questionOf: doar itemi cu răspuns sigur din barem', () => {
  const ok = SO.questionOf(enGrila('I.1'));
  assert.strictEqual(ok.answer, 1);
  assert.strictEqual(SO.questionOf({ ...enGrila('I.2'), tryPoll: { type: 'grila', question: 'x', options: ['1', '2'], answer: 'z' } }), null);
  assert.strictEqual(SO.questionOf({ ref: 'II.2.a', statement: 'Fie $f$. a) Arătați că $f(0)=1$.', tryPoll: null, check: { type: 'completare', question: 'Rezultatul?', answer: '1' }, modes: {} }), null);
  const q = SO.questionOf({ ref: 'I.4', statement: 'Determinați $m$ pentru care $m+1=3$.', tryPoll: { type: 'completare', question: 'Cât este $m$?', answer: '$2$' }, modes: {} });
  assert.strictEqual(q.answer, '2');
  assert.match(q.statement, /\n\nCât este \$m\$\?$/);
  assert.deepStrictEqual(SO.planFor('bac', 's2').slots, ['II.1', 'II.2', 'II.1', 'II.2', 'II.1', 'II.2']);
});
