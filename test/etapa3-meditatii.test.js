// =====================================================================
// test/etapa3-meditatii.test.js — Etapa 3 (AUDIT_AGENTI_AI.md, 5.1–5.4)
// pe handlerele reale din api/ai-meditatii.js, cu un dublu de Supabase:
//   · 5.3 — exercițiile greșite devin CARDURI DE REPETIȚIE, iar recapitularea
//     le reia întâi pe ele (SM-2: corect → interval mai lung, „învățat" iese);
//   · 5.2 — nivelul se recalculează după fiecare set, iar dificultatea
//     următorului set îl urmează (clientul trimite difficulty:null);
//   · 5.1 — subiectele intră în ai_skill_mastery cu eticheta din programă;
//   · 5.4 — tema din site trebuie să se potrivească pe capitol (minMatch).
// Fără rețea și fără LLM (med.genQuestions / classifyMistakes sunt stub-uite).
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');

const ai = require('../api/_lib/ai');
const med = require('../api/_lib/meditatii');

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let db, seq = 0, rpcCalls = [], siteArgs = [], genArgs = [];

function fakeSupabase() {
  function table(name) {
    db[name] ||= [];
    const q = { f: [], op: null, payload: null, select: null, order: null, limit: null, single: false, maybe: false, count: false };
    const api = {
      select(cols, opts) { q.select = cols; q.count = !!opts?.count; if (!q.op) q.op = 'select'; return api; },
      insert(rows) { q.op = 'insert'; q.payload = rows; return api; },
      update(patch) { q.op = 'update'; q.payload = patch; return api; },
      upsert(rows, opts) { q.op = 'upsert'; q.payload = rows; q.opts = opts; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(c, v) { q.f.push((r) => r[c] === v); return api; },
      neq(c, v) { q.f.push((r) => r[c] !== v); return api; },
      in(c, vals) { q.f.push((r) => vals.includes(r[c])); return api; },
      lte(c, v) { q.f.push((r) => r[c] != null && String(r[c]) <= String(v)); return api; },
      gte(c, v) { q.f.push((r) => r[c] != null && String(r[c]) >= String(v)); return api; },
      lt(c, v) { q.f.push((r) => r[c] != null && Number(r[c]) < Number(v)); return api; },
      not(c, op, v) { if (op === 'is' && v === null) q.f.push((r) => r[c] != null); return api; },
      order(c, o) { q.order = [c, o?.ascending !== false]; return api; },
      limit(n) { q.limit = n; return api; },
      single() { q.single = true; return api; },
      maybeSingle() { q.maybe = true; return api; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    const matching = () => db[name].filter((r) => q.f.every((fn) => fn(r)));
    function finish(rows) {
      if (q.order) { const [c, asc] = q.order; rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (q.limit != null) rows = rows.slice(0, q.limit);
      if (q.count) return { data: null, count: rows.length, error: null };
      const data = rows.map((r) => ({ ...r }));
      if (q.single) return data[0] ? { data: data[0], error: null } : { data: null, error: { message: 'not found' } };
      if (q.maybe) return { data: data[0] || null, error: null };
      return { data, error: null };
    }
    function run() {
      if (q.op === 'insert') {
        const rows = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((r) => ({ id: `gen-${++seq}`, ...r }));
        db[name].push(...rows);
        return finish(rows);
      }
      if (q.op === 'upsert') {
        const keys = String(q.opts?.onConflict || 'id').split(',');
        (Array.isArray(q.payload) ? q.payload : [q.payload]).forEach((r) => {
          const ex = db[name].find((x) => keys.every((k) => x[k] === r[k]));
          if (ex) Object.assign(ex, r); else db[name].push({ id: `gen-${++seq}`, ...r });
        });
        return { data: null, error: null };
      }
      if (q.op === 'update') { const rows = matching(); rows.forEach((r) => Object.assign(r, q.payload)); return finish(rows); }
      if (q.op === 'delete') { const rows = matching(); db[name] = db[name].filter((r) => !rows.includes(r)); return { data: null, error: null }; }
      return finish(matching());
    }
    return api;
  }
  return {
    from: (name) => table(name),
    rpc: async (name, args) => { rpcCalls.push({ name, args }); return { data: null, error: null }; },
  };
}

ai.applyCors = () => {};
ai.admin = () => fakeSupabase();
ai.authUser = async () => USER;
ai.requireUser = async () => ({ id: USER, is_admin: true, subscription_status: 'active' });
ai.enforceRateLimit = async () => {};
ai.logUsage = async () => {};
ai.createNotification = async () => true;
med.classifyMistakes = async (items) => items.map((_, i) => ({ index: i, errorType: 'calcul', analysis: 'aici ai greșit' }));
const realSiteInteractiveFor = med.siteInteractiveFor;
med.siteInteractiveFor = async (supa, args) => { siteArgs.push(args); return []; }; // fără test din site
med.genQuestions = async (supa, args) => {
  genArgs.push(args);
  return {
    questions: Array.from({ length: args.count || 5 }, (_, i) => ({
      statement: `Întrebare nouă ${i + 1}`, options: ['a', 'b', 'c', 'd'], answer: 1, explanation: 'e', topic: 'ecuații simple în ℤ',
    })),
    provider: 'stub', usage: {},
  };
};

const handler = require('../api/ai-meditatii');
function res() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.setHeader = () => {}; r.status = (c) => { r.statusCode = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.end = () => r;
  return r;
}
async function call(body) { const r = res(); await handler({ method: 'POST', headers: {}, body, query: {} }, r); return r; }

const QUESTIONS = [
  { statement: 'Rezolvați $2x = 10$', options: ['3', '5', '7', '9'], answer: 1, explanation: 'x=5', topic: 'ecuatii_gradul_1' },
  { statement: 'Rezolvați $x + 1 = 4$', answer: '3', explanation: 'x=3', topic: 'ecuatii_gradul_1' },
];

function seed({ level = 'mediu', sessions = [] } = {}) {
  seq = 0; rpcCalls = []; siteArgs = []; genArgs = [];
  db = {
    ai_meditatii_profile: [{
      user_id: USER, grade: 7, exam_target: null, level, assessment: {}, memory: {}, focus: null,
      plan: { chapters: [{ id: 'c7-ecuatii', title: 'Ecuații și sisteme de ecuații liniare', status: 'in_lucru', mastery: 0.5, sessions: 2, topics: ['ecuația de gradul I cu o necunoscută'] }] },
      streak_days: 1, last_study_date: null, total_seconds: 0,
    }],
    ai_meditatii_sessions: sessions,
    ai_meditatii_mistakes: [], ai_meditatii_reviews: [], ai_meditatii_item_reviews: [],
    ai_skill_mastery: [], ai_notifications: [], progress: [], mentor_students: [], content: [],
    profiles: [{ id: USER, full_name: 'Ana Pop', subscription_status: 'active' }],
  };
}
const activeSet = (over = {}) => ({
  id: 'sess-1', user_id: USER, kind: 'exercitii', chapter: 'c7-ecuatii', topic: 'Ecuații și sisteme de ecuații liniare',
  status: 'activa', payload: { questions: QUESTIONS }, score: null, max_score: null, created_at: '2026-08-23T09:00:00.000Z', ...over,
});

// ─── 5.3 carduri de repetiție ────────────────────────────────────────────────
test('submit_set: fiecare exercițiu greșit devine card de repetiție, scadent mâine', async () => {
  seed({ sessions: [activeSet()] });
  const r = await call({ action: 'submit_set', sessionId: 'sess-1', answers: [0, '3'], durationSec: 60 });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.score, 1);
  const cards = db.ai_meditatii_item_reviews;
  assert.strictEqual(cards.length, 1, 'doar itemul greșit devine card');
  assert.match(cards[0].statement, /2x = 10/);
  assert.deepStrictEqual(cards[0].options, ['3', '5', '7', '9']);
  assert.strictEqual(cards[0].answer, '1');
  assert.strictEqual(cards[0].user_id, USER);
  assert.ok(new Date(cards[0].due_at).getTime() > Date.now(), 'scadent în viitor');
  assert.ok(cards[0].mistake_id, 'legat de greșeala din jurnal');
});

test('review_start: recapitularea începe cu exercițiile scadente, apoi itemi noi', async () => {
  seed();
  db.ai_meditatii_reviews.push({ id: 'rev-1', user_id: USER, chapter: 'c7-ecuatii', topic: 'Ecuații', stage: 0, due_at: '2026-08-01T00:00:00.000Z', done_at: null });
  db.ai_meditatii_item_reviews.push({
    id: 'card-1', user_id: USER, chapter: 'c7-ecuatii', topic: 'ecuații', statement: 'Rezolvați $2x = 10$',
    options: ['3', '5', '7', '9'], answer: '1', explanation: 'x=5', ease: 2.5, interval_days: 1, reps: 0, lapses: 1,
    due_at: '2026-08-22T00:00:00.000Z', retired: false,
  });
  const r = await call({ action: 'review_start', reviewId: 'rev-1' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.repeated, 1);
  assert.strictEqual(r.body.questions.length, 5);
  assert.match(r.body.questions[0].statement, /2x = 10/);
  assert.strictEqual(r.body.questions[0].repeated, true);
  assert.strictEqual(r.body.questions[1].repeated, undefined);
  // răspunsurile corecte nu pleacă spre client
  assert.ok(r.body.questions.every((q) => q.answer === undefined));
  // s-au cerut DOAR itemii lipsă, pentru capitolul respectiv
  assert.strictEqual(genArgs[0].count, 4);
  assert.strictEqual(genArgs[0].chapterId, 'c7-ecuatii');
  const sess = db.ai_meditatii_sessions.find((s) => s.kind === 'recapitulare');
  assert.deepStrictEqual(sess.payload.itemIds, ['card-1', null, null, null, null]);
});

test('submit_set (recapitulare): SM-2 pe cardul reluat — corect ridică intervalul, greșit îl aduce la o zi', async () => {
  // corect
  seed({ sessions: [activeSet({ kind: 'recapitulare', payload: { questions: [QUESTIONS[0]], reviewId: 'rev-1', itemIds: ['card-1'] } })] });
  db.ai_meditatii_reviews.push({ id: 'rev-1', user_id: USER, chapter: 'c7-ecuatii', stage: 0, due_at: '2026-08-01T00:00:00.000Z' });
  db.ai_meditatii_item_reviews.push({ id: 'card-1', user_id: USER, mistake_id: null, chapter: 'c7-ecuatii', statement: 'Rezolvați $2x = 10$', options: ['3', '5', '7', '9'], answer: '1', ease: 2.5, interval_days: 1, reps: 1, lapses: 1, due_at: '2026-08-22T00:00:00.000Z', retired: false });
  let r = await call({ action: 'submit_set', sessionId: 'sess-1', answers: [1], durationSec: 30 });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.itemsReviewed, 1);
  let card = db.ai_meditatii_item_reviews[0];
  assert.strictEqual(card.reps, 2);
  assert.strictEqual(card.interval_days, 6);
  assert.strictEqual(card.retired, false);

  // greșit
  seed({ sessions: [activeSet({ kind: 'recapitulare', payload: { questions: [QUESTIONS[0]], reviewId: 'rev-2', itemIds: ['card-2'] } })] });
  db.ai_meditatii_reviews.push({ id: 'rev-2', user_id: USER, chapter: 'c7-ecuatii', stage: 1, due_at: '2026-08-01T00:00:00.000Z' });
  db.ai_meditatii_item_reviews.push({ id: 'card-2', user_id: USER, mistake_id: null, chapter: 'c7-ecuatii', statement: 'Rezolvați $2x = 10$', options: ['3', '5', '7', '9'], answer: '1', ease: 2.5, interval_days: 6, reps: 2, lapses: 0, due_at: '2026-08-22T00:00:00.000Z', retired: false });
  r = await call({ action: 'submit_set', sessionId: 'sess-1', answers: [0], durationSec: 30 });
  card = db.ai_meditatii_item_reviews[0];
  assert.deepStrictEqual([card.reps, card.interval_days, card.lapses], [0, 1, 1]);
  assert.strictEqual(card.ease, 2.3);
});

test('submit_set (recapitulare): a treia reușită → cardul e „învățat", greșeala se marchează remediată', async () => {
  seed({ sessions: [activeSet({ kind: 'recapitulare', payload: { questions: [QUESTIONS[0]], reviewId: 'rev-1', itemIds: ['card-1'] } })] });
  db.ai_meditatii_reviews.push({ id: 'rev-1', user_id: USER, chapter: 'c7-ecuatii', stage: 1, due_at: '2026-08-01T00:00:00.000Z' });
  db.ai_meditatii_mistakes.push({ id: 'mis-1', user_id: USER, remediated: false, statement: 'x', error_type: 'calcul' });
  db.ai_meditatii_item_reviews.push({ id: 'card-1', user_id: USER, mistake_id: 'mis-1', chapter: 'c7-ecuatii', statement: 'Rezolvați $2x = 10$', options: ['3', '5', '7', '9'], answer: '1', ease: 2.5, interval_days: 6, reps: 2, lapses: 1, due_at: '2026-08-22T00:00:00.000Z', retired: false });
  const r = await call({ action: 'submit_set', sessionId: 'sess-1', answers: [1], durationSec: 30 });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(db.ai_meditatii_item_reviews[0].retired, true);
  assert.strictEqual(db.ai_meditatii_mistakes[0].remediated, true);
});

test('state: numără exercițiile scadente la reluare', async () => {
  seed();
  db.ai_meditatii_item_reviews.push(
    { id: 'c1', user_id: USER, retired: false, due_at: '2026-08-01T00:00:00.000Z', statement: 'a', answer: '1' },
    { id: 'c2', user_id: USER, retired: false, due_at: '2099-01-01T00:00:00.000Z', statement: 'b', answer: '1' },
    { id: 'c3', user_id: USER, retired: true, due_at: '2026-08-01T00:00:00.000Z', statement: 'c', answer: '1' },
  );
  const r = await call({ action: 'state' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.dueItems, 1);
});

// ─── 5.2 nivelul + dificultatea ──────────────────────────────────────────────
test('submit_set: nivelul se recalculează din ultimele seturi (și se salvează)', async () => {
  const done = (id, score, at) => ({ id, user_id: USER, kind: 'exercitii', status: 'finalizata', score, max_score: 10, completed_at: at, payload: {} });
  seed({ sessions: [activeSet({ payload: { questions: QUESTIONS } }), done('s1', 9, '2026-08-21T10:00:00.000Z'), done('s2', 10, '2026-08-22T10:00:00.000Z')] });
  const r = await call({ action: 'submit_set', sessionId: 'sess-1', answers: [1, '3'], durationSec: 40 });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual([r.body.levelChange.from, r.body.levelChange.to], ['mediu', 'avansat']);
  assert.strictEqual(db.ai_meditatii_profile[0].level, 'avansat');
  assert.ok(db.ai_meditatii_profile[0].memory.levelEma > 0.75);
  assert.match(r.body.nextStep.label, /Nivelul tău/);
});

test('submit_set: un set slab după seturi bune NU coboară nivelul, dar cere exerciții mai ușoare', async () => {
  const done = (id, score, at) => ({ id, user_id: USER, kind: 'exercitii', status: 'finalizata', score, max_score: 10, completed_at: at, payload: {} });
  seed({ level: 'avansat', sessions: [activeSet(), done('s1', 9, '2026-08-21T10:00:00.000Z'), done('s2', 10, '2026-08-22T10:00:00.000Z')] });
  const r = await call({ action: 'submit_set', sessionId: 'sess-1', answers: [0, 'gresit'], durationSec: 40 });
  assert.strictEqual(r.body.levelChange, null);
  assert.strictEqual(db.ai_meditatii_profile[0].level, 'avansat');
  assert.strictEqual(db.ai_meditatii_profile[0].memory.nextDifficulty, 'ușor');
  assert.strictEqual(r.body.nextStep.kind, 'easier');
});

test('exercises: dificultatea urmează recomandarea de după ultimul set, apoi nivelul', async () => {
  seed({ level: 'mediu' });
  db.ai_meditatii_profile[0].memory = { nextDifficulty: 'ușor' };
  let r = await call({ action: 'exercises', chapterId: 'c7-ecuatii', difficulty: null });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.difficulty, 'ușor');
  assert.strictEqual(genArgs[0].chapterId, 'c7-ecuatii');
  // fără recomandare → nivelul; cererea explicită a clientului are prioritate
  seed({ level: 'avansat' });
  r = await call({ action: 'exercises', chapterId: 'c7-ecuatii', difficulty: null });
  assert.strictEqual(r.body.difficulty, 'greu');
  seed({ level: 'avansat' });
  r = await call({ action: 'exercises', chapterId: 'c7-ecuatii', difficulty: 'ușor' });
  assert.strictEqual(r.body.difficulty, 'ușor');
});

// ─── 5.1 subiectele canonice ─────────────────────────────────────────────────
test('submit_set: subiectele intră în stăpânire cu eticheta din programă', async () => {
  seed({ sessions: [activeSet()] });
  await call({ action: 'submit_set', sessionId: 'sess-1', answers: [1, '3'], durationSec: 20 });
  const topics = rpcCalls.filter((c) => c.name === 'bump_skill_mastery').map((c) => c.args.p_topic);
  assert.strictEqual(topics.length, 2);
  assert.ok(topics.every((t) => t === 'ecuația de gradul I cu o necunoscută'), JSON.stringify(topics));
});

// ─── 5.4 tema din site trebuie să se potrivească ─────────────────────────────
test('siteInteractiveFor(minMatch): fără potrivire pe subiect nu se întoarce „umplutură"', async () => {
  const rows = [
    { id: 'x1', title: 'Test · Ecuații de gradul I', category: 'clasa-7', is_free: true },
    { id: 'x2', title: 'Test · Cercul și discul', category: 'clasa-7', is_free: true },
  ];
  const supa = { from: () => ({ select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: rows }) }) }), order: () => ({ limit: async () => ({ data: rows }) }) }) }) }) };
  const stub = {
    from: (name) => (name === 'content'
      ? { select: () => ({ eq: () => ({ in: () => ({ order: () => ({ limit: () => Promise.resolve({ data: rows }) }) }) }) }) }
      : { select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }),
  };
  void supa;
  const matched = await realSiteInteractiveFor(stub, { userId: USER, categories: ['clasa-7'], topics: ['Ecuații'], limit: 3, minMatch: true });
  assert.deepStrictEqual(matched.map((r) => r.id), ['x1'], 'doar materialul potrivit pe subiect');
  const loose = await realSiteInteractiveFor(stub, { userId: USER, categories: ['clasa-7'], topics: ['Ecuații'], limit: 3 });
  assert.deepStrictEqual(loose.map((r) => r.id), ['x1', 'x2'], 'fără minMatch, restul completează lista');
  const none = await realSiteInteractiveFor(stub, { userId: USER, categories: ['clasa-7'], topics: ['Trigonometrie'], limit: 3, minMatch: true });
  assert.deepStrictEqual(none, []);
});

test('submit_set (recapitulare): un item RELUAT și greșit din nou NU creează un card în plus', async () => {
  seed({ sessions: [activeSet({ kind: 'recapitulare', payload: { questions: [QUESTIONS[0], QUESTIONS[1]], reviewId: 'rev-1', itemIds: ['card-1', null] } })] });
  db.ai_meditatii_reviews.push({ id: 'rev-1', user_id: USER, chapter: 'c7-ecuatii', stage: 0, due_at: '2026-08-01T00:00:00.000Z' });
  db.ai_meditatii_item_reviews.push({ id: 'card-1', user_id: USER, mistake_id: null, chapter: 'c7-ecuatii', statement: QUESTIONS[0].statement, options: QUESTIONS[0].options, answer: '1', ease: 2.5, interval_days: 6, reps: 2, lapses: 0, due_at: '2026-08-22T00:00:00.000Z', retired: false });
  // ambele greșite: cardul existent se reprogramează, itemul NOU primește card
  const r = await call({ action: 'submit_set', sessionId: 'sess-1', answers: [0, 'gresit'], durationSec: 30 });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const forOld = db.ai_meditatii_item_reviews.filter((c) => c.statement === QUESTIONS[0].statement);
  assert.strictEqual(forOld.length, 1, 'exercițiul reluat rămâne cu UN singur card');
  assert.deepStrictEqual([forOld[0].reps, forOld[0].interval_days], [0, 1]);
  assert.strictEqual(db.ai_meditatii_item_reviews.length, 2, 'itemul nou greșit primește cardul lui');
});

test('submit_set: cardul primește greșeala LUI, chiar dacă analiza vine în altă ordine', async () => {
  seed({ sessions: [activeSet()] });
  const orig = med.classifyMistakes;
  med.classifyMistakes = async (items) => items.map((_, i) => ({ index: items.length - 1 - i, errorType: 'calcul', analysis: 'x' })).reverse().reverse();
  try {
    const r = await call({ action: 'submit_set', sessionId: 'sess-1', answers: [0, 'gresit'], durationSec: 30 });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    const byId = Object.fromEntries(db.ai_meditatii_mistakes.map((m) => [m.id, m.statement]));
    for (const card of db.ai_meditatii_item_reviews) {
      assert.strictEqual(byId[card.mistake_id], card.statement, 'cardul e legat de greșeala aceluiași enunț');
    }
  } finally { med.classifyMistakes = orig; }
});
