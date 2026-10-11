// Teste pentru GENERATOARELE DE EXERCIȚII ÎN COD (api/_lib/generatoare.js) și
// legarea lor în med.genQuestions: la capitolele cu tipuri standard setul se face
// în cod (cost 0, rezultat calculat), la rest rămâne modelul; la testul inițial
// modelul scrie doar întrebările capitolelor fără generatoare.
process.env.AI_VERIFY_GEN = '0';          // fără verificatorul independent (rețea)
const test = require('node:test');
const assert = require('node:assert');
const { create, all } = require('mathjs');
const ai = require('../api/_lib/ai');
const claude = require('../api/_lib/claude');
const med = require('../api/_lib/meditatii');
const mc = require('../api/_lib/mathcheck');
const G = require('../api/_lib/generatoare');

const math = create(all);
const calls = { claude: 0, chatJson: 0, before: 0, lastCount: null, lastSpec: null };
ai.retrieve = async () => [];
claude.chatClaude = async ({ system, model }) => {
  calls.claude++;
  const n = Number((/(\d+) (?:întrebări|exerciții|itemi)/.exec(system) || [])[1]) || 3;
  calls.lastCount = n;
  calls.lastSpec = system;
  return { data: { questions: Array.from({ length: n }, (_, i) => ({ statement: `Întrebare de la model ${i + 1}`, options: ['1', '2', '3', '4'], answer: 1, explanation: 'e', chapter: 'c9-vectori' })) }, provider: model, usage: {} };
};
ai.chatJson = async () => { calls.chatJson++; return { data: { questions: [] }, usage: {} }; };
const reset = () => Object.assign(calls, { claude: 0, chatJson: 0, before: 0, lastCount: null, lastSpec: null });
const beforeAI = async () => { calls.before++; };

// ─── generatoarele ───────────────────────────────────────────────────────────
test('fiecare generator: enunț, răspuns parsabil, grile cu 4 variante distincte, fără artefacte', () => {
  const topics = new Set();
  for (const list of [...Object.values(med.CURRICULUM), med.EN_RECAP]) for (const c of list) for (const t of c.topics) topics.add(t);
  for (const [id, g] of Object.entries(G.GEN)) {
    assert.ok(topics.has(g.topic), `${id}: subiect din afara programei („${g.topic}")`);
    let made = 0;
    for (let seed = 1; seed <= 40; seed++) {
      for (const lvl of [1, 2, 3]) {
        const q = G.makeOne(id, G.rngFrom(seed * 101 + lvl), lvl, new Set());
        if (!q) continue;
        made++;
        const blob = `${q.statement}|${q.explanation}|${(q.options || []).join('|')}|${q.answer}`;
        assert.doesNotMatch(blob, /\+ -|- -|(^|[^\d.])1x\b|undefined|NaN/, `${id}: ${blob}`);
        assert.strictEqual((q.statement.match(/\$/g) || []).length % 2, 0, `${id}: ${q.statement}`);
        assert.strictEqual((q.explanation.match(/\$/g) || []).length % 2, 0, `${id}: ${q.explanation}`);
        if (q.options) {
          assert.strictEqual(new Set(q.options).size, 4, `${id}: ${q.options}`);
          assert.ok(q.answer >= 0 && q.answer < 4);
        } else {
          assert.strictEqual(mc.answersEquivalent(q.answer, q.answer), true, `${id}: răspuns neparsabil ${q.answer}`);
        }
      }
    }
    assert.ok(made > 0, `${id} nu produce nimic`);
  }
  for (const [cid, ids] of Object.entries(G.CHAPTERS)) for (const id of ids) assert.ok(G.GEN[id], `${cid}: ${id} lipsește`);
});

test('rezultatele calculate se verifică independent (expresia din enunț evaluată cu mathjs)', () => {
  const toExpr = (t) => {
    let s = String(t);
    for (let i = 0; i < 6; i++) {
      s = s.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, '(($1)/($2))').replace(/\\sqrt\[(\d+)\]\{([^{}]*)\}/g, 'nthRoot(($2),$1)')
        .replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)').replace(/\\log_\{(\d+)\}\s*([\d.]+)/g, 'log($2,$1)')
        .replace(/C_\{(\d+)\}\^\{(\d+)\}/g, 'combinations($1,$2)').replace(/A_\{(\d+)\}\^\{(\d+)\}/g, 'permutations($1,$2)').replace(/P_\{(\d+)\}/g, 'factorial($1)');
    }
    return s.replace(/\\left|\\right/g, '').replace(/(\d)\{,\}(\d)/g, '$1.$2').replace(/\\cdot/g, '*').replace(/:/g, '/')
      .replace(/\|([^|]+)\|/g, 'abs($1)').replace(/\\(sin|cos)\s*(\d+)\^\{\\circ\}/g, '$1($2 deg)').replace(/\\operatorname\{tg\}\s*(\d+)\^\{\\circ\}/g, 'tan($1 deg)')
      .replace(/\\(sin|cos)\s*(\(\([^)]*\)\/\([^)]*\)\)|\\pi)/g, '$1($2)').replace(/\\pi/g, 'pi').replace(/\^\{([^{}]*)\}/g, '^($1)').replace(/[{}]/g, '');
  };
  const value = (a) => math.evaluate(toExpr(String(a).replace(/,/g, '.')));
  const ids = ['ordinea-op', 'zecimale-operatii', 'intregi-operatii', 'puteri-intregi', 'rationale-operatii', 'radical-patrat', 'radicali-operatii',
    'modul', 'trig-valori', 'cerc-trigonometric', 'puteri-rationale', 'radicali-ordin-n', 'logaritmi', 'combinatorica'];
  let checked = 0;
  for (const id of ids) {
    for (let seed = 1; seed <= 60; seed++) {
      const q = G.makeOne(id, G.rngFrom(seed * 7 + 3), 1 + (seed % 3), new Set());
      const m = q && /^Calculați:? \$(.+)\$\.$/.exec(q.statement);
      if (!m) continue;
      const a = math.evaluate(toExpr(m[1])), b = value(q.answer);
      assert.ok(Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)), `${id}: ${m[1]} = ${a}, dar răspunsul e ${q.answer}`);
      checked++;
    }
  }
  assert.ok(checked > 500, `prea puține verificate (${checked})`);
});

test('„încă 10 de același fel": exercițiul greșit e recunoscut ca tip (în capitolul lui)', () => {
  for (const [cid, ids] of Object.entries(G.CHAPTERS)) {
    if (cid.startsWith('en-rec')) continue;
    for (const id of ids) {
      let hit = 0, n = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const q = G.makeOne(id, G.rngFrom(seed), 2, new Set());
        if (!q) continue;
        n++;
        if (G.matchMistake({ statement: q.statement, topic: q.topic }, cid) === id) hit++;
      }
      assert.ok(hit >= n * 0.8, `${cid}/${id}: recunoscut ${hit}/${n}`);
    }
  }
  // fără capitol: doar o potrivire sigură; un enunț oarecare → model
  assert.strictEqual(G.matchMistake({ statement: 'Demonstrați că triunghiul ABC este isoscel.' }, 'c6-triunghi'), null);
});

// ─── med.genQuestions ────────────────────────────────────────────────────────
test('setul la un capitol acoperit se face în cod: fără model, fără limite AI, de la simplu la complex', async () => {
  reset();
  const r = await med.genQuestions(null, { purpose: 'exersare', chapterId: 'c7-ecuatii', chapter: 'Ecuații', topics: [], difficulty: 'mediu', count: 10, beforeAI });
  assert.strictEqual(r.provider, 'cod');
  assert.strictEqual(r.questions.length, 10);
  assert.deepStrictEqual([calls.claude, calls.chatJson, calls.before], [0, 0, 0]);
  assert.ok(r.questions.every((q) => q.chapter === 'c7-ecuatii' && q.statement && q.explanation && q.gen === undefined));
  assert.strictEqual(new Set(r.questions.map((q) => q.statement)).size, 10, 'fără repetări');
  assert.ok(new Set(r.questions.map((q) => q.topic)).size >= 2, 'tipuri diferite din capitol');
  // tema și recapitularea, la fel
  const t = await med.genQuestions(null, { purpose: 'tema', chapterId: 'c8-functii', count: 8, difficulty: 'ușor', beforeAI });
  assert.strictEqual(t.provider, 'cod');
  assert.strictEqual(t.questions.length, 8);
  const rv = await med.genQuestions(null, { purpose: 'recapitulare', chapterId: 'c11-matrice', count: 3, beforeAI });
  assert.strictEqual(rv.provider, 'cod');
  assert.strictEqual(calls.before, 0);
});

test('capitol fără generatoare (sau simulare) → modelul, cu limitele AI verificate întâi', async () => {
  reset();
  const r = await med.genQuestions(null, { purpose: 'exersare', chapterId: 'c9-vectori', chapter: 'Vectori în plan', count: 4, beforeAI });
  assert.strictEqual(r.provider, 'claude-opus-5-5');
  assert.strictEqual(calls.before, 1);
  assert.strictEqual(calls.claude, 1);
  reset();
  await med.genQuestions(null, { purpose: 'simulare', chapterId: 'c7-ecuatii', count: 3, beforeAI });
  assert.strictEqual(calls.claude, 1, 'simulările rămân la model / subiectele oficiale');
  // limitele depășite → eroarea limitelor (ca înainte), doar când chiar e nevoie de model
  const over = async () => { const e = new Error('limita'); e.status = 429; throw e; };
  await assert.rejects(() => med.genQuestions(null, { purpose: 'exersare', chapterId: 'c9-vectori', count: 4, beforeAI: over }), /limita/);
  const ok = await med.genQuestions(null, { purpose: 'exersare', chapterId: 'c7-reale', count: 5, beforeAI: over });
  assert.strictEqual(ok.provider, 'cod');
});

test('remedierea: același tip ca exercițiul greșit, 10 exerciții; tip necunoscut → modelul', async () => {
  reset();
  const mistake = { statement: 'Rezolvați sistemul $\\begin{cases} 2x + y = 7 \\\\ x - y = 2 \\end{cases}$ și scrieți valoarea lui $x$.', topic: 'sisteme de două ecuații cu două necunoscute', chapter: 'c7-ecuatii' };
  const r = await med.genQuestions(null, { purpose: 'remediere', chapterId: 'c7-ecuatii', mistake, count: 10, beforeAI });
  assert.strictEqual(r.provider, 'cod');
  assert.strictEqual(r.questions.length, 10);
  assert.ok(r.questions.every((q) => /Rezolvați sistemul/.test(q.statement)), 'toate sisteme');
  assert.strictEqual(calls.before, 0);
  const other = await med.genQuestions(null, { purpose: 'remediere', chapterId: 'c7-ecuatii', mistake: { statement: 'Un tren pleacă la ora 8 cu viteza de 60 km/h...', chapter: 'c7-ecuatii' }, count: 10, beforeAI });
  assert.strictEqual(other.provider, 'claude-opus-5-5');
  assert.strictEqual(calls.before, 1);
});

test('testul inițial: capitolele acoperite din cod, restul de la model, în ordinea capitolelor', async () => {
  reset();
  const spec = ['- c7-ecuatii: Ecuații', '- c9-vectori: Vectori în plan', '- c7-metrice: Relații metrice', '- c9-logica-multimi: Logică'].join('\n');
  const r = await med.genQuestions(null, { purpose: 'evaluare', chaptersSpec: spec, count: 12, beforeAI });
  assert.strictEqual(r.provider, 'claude-opus-5-5+cod');
  assert.strictEqual(r.questions.length, 12);
  assert.strictEqual(calls.lastCount, 6, 'modelul scrie doar cele 6 locuri ale capitolelor fără generatoare');
  assert.match(calls.lastSpec, /c9-vectori/);
  assert.doesNotMatch(calls.lastSpec, /c7-ecuatii/);
  // capitolele se alternează ca în listă: cod, model, cod, model…
  assert.deepStrictEqual(r.questions.slice(0, 4).map((q) => q.chapter), ['c7-ecuatii', 'c9-vectori', 'c7-metrice', 'c9-vectori']);
  // fără model (limite): testul pleacă doar cu întrebările din cod, dacă sunt măcar jumătate
  reset();
  const over = async () => { const e = new Error('limita'); e.status = 429; throw e; };
  const half = await med.genQuestions(null, { purpose: 'evaluare', chaptersSpec: spec, count: 12, beforeAI: over });
  assert.strictEqual(half.questions.length, 6);
  // toate capitolele acoperite → tot testul din cod, de la ușor la greu
  reset();
  const all7 = await med.genQuestions(null, { purpose: 'evaluare', chaptersSpec: ['- c7-reale: R', '- c7-ecuatii: E', '- c7-cerc: C'].join('\n'), count: 12, beforeAI });
  assert.strictEqual(all7.provider, 'cod');
  assert.strictEqual(all7.questions.length, 12);
  assert.strictEqual(calls.claude + calls.before, 0);
});

test('PLAN_GENERATOARE_COD=0 → totul la model, ca înainte', async () => {
  reset();
  process.env.PLAN_GENERATOARE_COD = '0';
  try {
    const r = await med.genQuestions(null, { purpose: 'exersare', chapterId: 'c7-ecuatii', count: 4, beforeAI });
    assert.strictEqual(r.provider, 'claude-opus-5-5');
    assert.strictEqual(calls.before, 1);
  } finally { delete process.env.PLAN_GENERATOARE_COD; }
});

test('în handler: setul la un capitol acoperit merge și cu creditele AI epuizate; în statistici apare „:cod"', async () => {
  const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
  const U = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const fake = createFakeSupabase({
    ai_meditatii_profile: [{ user_id: U, grade: 7, exam_target: null, level: 'mediu', memory: {}, plan: { chapters: [
      { id: 'c7-ecuatii', title: 'Ecuații și sisteme de ecuații liniare', topics: ['ecuația de gradul I cu o necunoscută'], status: 'teorie' },
      { id: 'c9-vectori', title: 'Vectori în plan', topics: ['operații cu vectori'], status: 'de_parcurs' },
    ] } }],
    ai_meditatii_sessions: [], ai_meditatii_homework: [], content: [],
  });
  const saved = { admin: ai.admin, authUser: ai.authUser, requireUser: ai.requireUser, rate: ai.enforceRateLimit, log: ai.logUsage, cors: ai.applyCors, site: med.siteInteractiveFor };
  const logs = [];
  Object.assign(ai, {
    admin: () => fake, applyCors: () => {}, authUser: async () => U,
    requireUser: async () => ({ id: U, subscription_status: 'active' }),
    enforceRateLimit: async () => { const e = new Error('Creditele AI ale lunii s-au terminat.'); e.status = 429; e.code = 'BUDGET_MONTH'; throw e; },
    logUsage: async (s, u, endpoint) => { logs.push(endpoint); },
  });
  med.siteInteractiveFor = async () => [];
  try {
    const handler = require('../api/ai-meditatii');
    const res = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { action: 'exercises', chapterId: 'c7-ecuatii' } }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.questions.length, 10);
    assert.ok(res.body.questions.every((q) => q.answer === undefined), 'răspunsurile nu pleacă la client');
    assert.ok(logs.includes('ai-meditatii:exercises:cod'));
    // capitol fără generatoare: limitele AI se aplică
    const r2 = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { action: 'exercises', chapterId: 'c9-vectori' } }, r2);
    assert.strictEqual(r2.statusCode, 429);
    assert.strictEqual(r2.body.code, 'BUDGET_MONTH');
  } finally {
    Object.assign(ai, { admin: saved.admin, authUser: saved.authUser, requireUser: saved.requireUser, enforceRateLimit: saved.rate, logUsage: saved.log, applyCors: saved.cors });
    med.siteInteractiveFor = saved.site;
  }
});
