// =====================================================================
// test/etapa3-unelte-scor.test.js — Etapa 3 (AUDIT_AGENTI_AI.md):
//   · 3.2 — uneltele tutorelui (calculate, check_equivalence, get_exercise,
//     get_barem_item) + bucla de tool calling din ai.chat / ai.chatStream;
//   · 4.6 — figurile din chat: marcajul [[FIGURA:{…}]], schema strictă a DSL-ului
//     și desenarea lui (src/lib/figureRender.js);
//   · 2.1 (restanță) — scorul testelor HTML recalculat pe server: cheile din
//     exercițiul structurat sau din HTML, echivalență matematică, plafonare;
//   · 5.2 / 5.3 — nivelul recalculat (EMA) și repetiția pe itemi (SM-2).
// Apelurile LLM sunt simulate prin înlocuirea lui global.fetch.
// Rulare: npm test   (node --test test/*.test.js)
// =====================================================================
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai.js');
const tools = require('../api/_lib/tools.js');
const figures = require('../api/_lib/figures.js');
const score = require('../api/_lib/score.js');
const med = require('../api/_lib/meditatii.js');
const exgen = require('../api/_lib/exgen.js');

// ─── 3.2 Uneltele ────────────────────────────────────────────────────────────
test('calculate: aritmetică, fracții exacte, LaTeX, simplify/derivative; erorile nu aruncă', () => {
  assert.strictEqual(tools.calculate({ expression: '(3/4 + 1/6) * 12' }).result, '11');
  assert.strictEqual(tools.calculate({ expression: '2^10' }).result, '1024');
  const f = tools.calculate({ expression: '\\frac{1}{2}+\\frac{1}{3}' });
  assert.strictEqual(f.exact, '5/6');
  assert.match(tools.calculate({ expression: 'simplify("2x+3x-1")' }).result, /5\s*\*\s*x\s*-\s*1/);
  assert.match(tools.calculate({ expression: 'derivative("x^2+3x","x")' }).result, /2\s*\*\s*x\s*\+\s*3/);
  assert.ok(tools.calculate({ expression: 'x+' }).error);
  assert.ok(tools.calculate({ expression: '' }).error);
  assert.ok(tools.calculate({ expression: 'x'.repeat(400) }).error);
  assert.ok(tools.calculate({ expression: 'import("fs")' }).error, 'funcțiile periculoase rămân blocate');
});

test('check_equivalence: „1/2" = „0,5"; text ≠ număr → nedecis', () => {
  assert.strictEqual(tools.checkEquivalence({ a: '1/2', b: '0,5' }).equivalent, true);
  assert.strictEqual(tools.checkEquivalence({ a: '2\\sqrt{3}', b: '2√3' }).equivalent, true);
  assert.strictEqual(tools.checkEquivalence({ a: '7', b: '8' }).equivalent, false);
  assert.strictEqual(tools.checkEquivalence({ a: 'isoscel', b: 'echilateral' }).equivalent, null);
});

const TEST_TEXT = `SUBIECTUL I
1. Rezultatul calculului 2+3 este:
2. Numărul 25% din 840 este:
SUBIECTUL al II-lea
1. În triunghiul ABC, AB = 6 cm. Perimetrul este:
2. Aria pătratului cu latura 4 cm este:`;
const BAREM_TEXT = `SUBIECTUL I
1. b) 5 puncte
2. b) 5 puncte
SUBIECTUL al II-lea
1. c) 5 puncte
2. a) 5 puncte`;

test('get_exercise / get_barem_item: referința „II.2" taie enunțul și baremul itemului', () => {
  const ctx = { subjectText: TEST_TEXT, baremText: BAREM_TEXT };
  const ex = tools.getExercise(ctx, { ref: 'II.2' });
  assert.match(ex.text, /Aria pătratului/);
  assert.strictEqual(ex.ref, 'II.2');
  const bar = tools.getBaremItem(ctx, { ref: 'II.2' });
  assert.strictEqual(bar.kind, 'grila');
  assert.strictEqual(bar.letter, 'a');
  // referință de neînțeles / lipsă barem → { error }, nu excepție
  assert.ok(tools.getExercise(ctx, { ref: 'bla' }).error);
  assert.ok(tools.getBaremItem({ subjectText: TEST_TEXT }, { ref: 'II.2' }).error);
});

test('tutorTools: uneltele de context apar doar când există textele', () => {
  assert.deepStrictEqual(tools.tutorTools({}).map((t) => t.name), ['calculate', 'check_equivalence']);
  assert.deepStrictEqual(tools.tutorTools({ subjectText: 'x', baremText: 'y' }).map((t) => t.name),
    ['calculate', 'check_equivalence', 'get_exercise', 'get_barem_item']);
  const note = tools.toolsNote(tools.tutorTools({ subjectText: 'x' }));
  assert.match(note, /calculate/);
  assert.match(note, /Nu menționa uneltele/);
});

// fetch simulat
function fakeFetch(handler) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const r = await handler(body, calls.length);
    if (r.sse) {
      let i = 0;
      return { ok: true, status: 200, body: { getReader: () => ({ read: async () => (i < r.sse.length ? { value: new TextEncoder().encode(r.sse[i++]), done: false } : { value: undefined, done: true }) }) } };
    }
    return { ok: true, status: 200, json: async () => r.body, text: async () => '' };
  };
  return calls;
}
const completion = (msg, usage = { prompt_tokens: 10, completion_tokens: 5 }) => ({ body: { choices: [{ message: msg, finish_reason: msg.tool_calls ? 'tool_calls' : 'stop' }], usage } });

test('chat: modelul cere o unealtă → o rulăm → îi dăm rezultatul → răspunde (usage însumat)', async () => {
  const calls = fakeFetch((body, n) => (n === 1
    ? completion({ content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'calculate', arguments: '{"expression":"(3/4+1/6)*12"}' } }] })
    : completion({ content: 'Rezultatul este 11.' }, { prompt_tokens: 20, completion_tokens: 7 })));
  const stats = {};
  const r = await ai.chat({ system: 's', messages: [{ role: 'user', content: 'cât face?' }], model: 'gpt-4o-mini', tools: tools.tutorTools({}), stats });
  assert.strictEqual(r.text, 'Rezultatul este 11.');
  assert.deepStrictEqual(r.usage, { in: 30, out: 12, model: 'gpt-4o-mini' });
  assert.deepStrictEqual(stats.tools, [{ name: 'calculate', args: { expression: '(3/4+1/6)*12' }, ok: true }]);
  // uneltele au fost declarate, iar rezultatul a plecat înapoi ca mesaj `tool`
  assert.ok(Array.isArray(calls[0].tools) && calls[0].tools[0].function.name === 'calculate');
  const toolMsg = calls[1].messages[calls[1].messages.length - 1];
  assert.strictEqual(toolMsg.role, 'tool');
  assert.strictEqual(toolMsg.tool_call_id, 'c1');
  assert.deepStrictEqual(JSON.parse(toolMsg.content), { result: '11' });
});

test('chat: o unealtă inexistentă / cu argumente greșite nu pică răspunsul', async () => {
  fakeFetch((body, n) => (n === 1
    ? completion({ content: null, tool_calls: [{ id: 'x', type: 'function', function: { name: 'nu_exista', arguments: 'nu-i JSON' } }] })
    : completion({ content: 'Continuăm.' })));
  const stats = {};
  const r = await ai.chat({ system: 's', messages: [{ role: 'user', content: 'x' }], model: 'gpt-4o-mini', tools: tools.tutorTools({}), stats });
  assert.strictEqual(r.text, 'Continuăm.');
  assert.strictEqual(stats.tools[0].ok, false);
});

test('chatStream: apelurile de unelte sosite pe bucăți se lipesc, apoi răspunsul curge normal', async () => {
  const calls = fakeFetch((body) => (body.messages.some((m) => m.role === 'tool')
    ? { sse: ['data: {"choices":[{"delta":{"content":"Este "}}]}\n\n', 'data: {"choices":[{"delta":{"content":"1024."},"finish_reason":"stop"}]}\n\n', 'data: [DONE]\n\n'] }
    : { sse: [
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c9","type":"function","function":{"name":"calcu","arguments":""}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"late","arguments":"{\\"expres"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"sion\\":\\"2^10\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: [DONE]\n\n',
    ] }));
  let out = '';
  const stats = {};
  for await (const d of ai.chatStream({ system: 's', messages: [{ role: 'user', content: '2^10?' }], model: 'gpt-4o-mini', tools: tools.tutorTools({}), stats })) out += d;
  assert.strictEqual(out, 'Este 1024.');
  assert.deepStrictEqual(stats.tools, [{ name: 'calculate', args: { expression: '2^10' }, ok: true }]);
  assert.strictEqual(calls.length, 2);
});

test('adaptBodyToError: providerul refuză uneltele → cererea se reia fără ele', () => {
  const body = ai.buildBody({ model: 'gpt-4o-mini', temperature: 0.4, maxTokens: 500, messages: [{ role: 'user', content: 'x' }], tools: tools.tutorTools({}) });
  assert.ok(body.tools.length >= 2 && body.tool_choice === 'auto');
  assert.strictEqual(ai.adaptBodyToError(body, "Unsupported parameter: 'tools'"), true);
  assert.strictEqual(body.tools, undefined);
  assert.strictEqual(body.tool_choice, undefined);
});

// ─── 4.6 Figurile din chat ───────────────────────────────────────────────────
test('extractFigures: marcajul [[FIGURA:{…}]] iese din text și devine obiect (max 2)', () => {
  const raw = 'Datele problemei:\n[[FIGURA:{"type":"triunghi","variant":"dreptunghic","labels":["A","B","C"],"unghi_drept":"A"}]]\nDeci $BC = 10$.';
  const r = figures.extractFigures(raw);
  assert.ok(!/FIGURA/.test(r.text));
  assert.match(r.text, /Datele problemei/);
  assert.deepStrictEqual(r.figures, [{ type: 'triunghi', variant: 'dreptunghic', labels: ['A', 'B', 'C'], unghi_drept: 'A' }]);
  const many = figures.extractFigures('[[FIGURA:{"type":"cerc"}]][[FIGURA:{"type":"cub"}]][[FIGURA:{"type":"sfera"}]]');
  assert.strictEqual(many.figures.length, 2);
  // marcaj stricat sau tip necunoscut → se scoate din text, fără figură
  const bad = figures.extractFigures('a [[FIGURA:{"type":"hexagon"}]] b [[FIGURA:{nu-i json}]] c');
  assert.deepStrictEqual(bad.figures, []);
  assert.strictEqual(bad.text.replace(/\s+/g, ' ').trim(), 'a b c');
});

test('cleanFigure: cheile null dispar, tipul se normalizează, „inaltime":{} → true', () => {
  const f = figures.cleanFigure({ type: 'Triunghi', labels: ['A', 'B', 'C'], variant: null, puncte: [{ label: 'M', pe: 'BC', la: 0.5, unghi: null, x: null, y: null }], inaltime: { din: null, picior: null }, segmente: null });
  assert.deepStrictEqual(f, { type: 'triunghi', labels: ['A', 'B', 'C'], puncte: [{ label: 'M', pe: 'BC', la: 0.5 }], inaltime: true });
  assert.strictEqual(figures.cleanFigure({ type: 'nu-exista' }), null);
  assert.strictEqual(figures.cleanFigure(null), null);
});

test('FIGURE_SCHEMA: strictă (toate cheile prezente, nullable) și acoperă tipurile din desenator', () => {
  const walk = (s, path) => {
    if (!s || typeof s !== 'object') return;
    if (s.type === 'object') {
      assert.strictEqual(s.additionalProperties, false, path);
      assert.deepStrictEqual(Object.keys(s.properties), s.required, path);
      for (const k of Object.keys(s.properties)) walk(s.properties[k], `${path}.${k}`);
    }
    if (s.items) walk(s.items, `${path}[]`);
    if (s.anyOf) s.anyOf.forEach((a, i) => walk(a, `${path}|${i}`));
  };
  walk(figures.FIGURE_SCHEMA, 'figure');
  const keys = Object.keys(figures.FIGURE_SCHEMA.properties);
  for (const k of ['type', 'labels', 'variant', 'unghi_drept', 'puncte', 'segmente', 'segmente_punctate', 'centru', 'inscris', 'raza', 'diametru', 'coarda', 'tangenta', 'functie', 'inaltime', 'diagonale', 'pozitii', 'varf', 'raze']) {
    assert.ok(keys.includes(k), `lipsește cheia ${k}`);
  }
  assert.deepStrictEqual(figures.FIGURE_SCHEMA.properties.type.enum, figures.FIGURE_TYPES);
  assert.match(figures.FIGURE_SPEC_CHAT, /\[\[FIGURA:/);
});

// ─── 2.1 Scorul recalculat pe server ─────────────────────────────────────────
test('score: cheile din exercițiul structurat → punctaj recalculat, cu echivalență matematică', async () => {
  const content = { interactive_data: { exercise: { kind: 'grila', questions: [
    { options: ['a', 'b', 'c', 'd'], answer: 1, points: 3 },
    { answer: '1/2', points: 7 },
  ] } } };
  const good = await score.verifiedScore(null, content, { answers: [1, '0,5'], score: 0, maxScore: 100 });
  assert.deepStrictEqual([good.score, good.maxScore, good.verified, good.source], [100, 100, true, 'exercise']);
  const half = await score.verifiedScore(null, content, { answers: [0, '0,5'], score: 100, maxScore: 100 });
  assert.strictEqual(half.score, 70); // doar itemul de 7 puncte
  const none = await score.verifiedScore(null, content, { answers: [null, ''], score: 100, maxScore: 100 });
  assert.strictEqual(none.score, 0);
});

test('score: cheile din HTML-ul generat (var D=…) — inclusiv cu „];" în explicații', async () => {
  const html = exgen.renderExerciseHtml({
    title: 'T', kind: 'grila', statement: '',
    questions: [
      { statement: 'Q1', options: ['1', '2', '3', '4'], answer: 1, hint: '', explanation: 'atenție la a]; b', points: 5 },
      { statement: 'Q2', answer: '1/2', hint: '', explanation: '', points: 5 },
    ],
  });
  const keys = score.keysFromHtml(html);
  assert.strictEqual(keys.items.length, 2);
  assert.deepStrictEqual(keys.items[0], { type: 'choice', answer: 1, points: 5 });
  assert.strictEqual(score.recompute(keys, [1, '0,5']).pct, 100);
  assert.strictEqual(score.recompute(keys, [1, '0,7']).pct, 50);
  assert.strictEqual(score.keysFromHtml('<html>fără chei</html>'), null);
});

test('score: fără răspunsuri sau fără chei → scorul trimis, PLAFONAT, marcat neverificat', async () => {
  const r = await score.verifiedScore(null, { interactive_data: null }, { answers: null, score: 999, maxScore: 100 });
  assert.deepStrictEqual([r.score, r.maxScore, r.verified], [100, 100, false]);
  const neg = await score.verifiedScore(null, {}, { answers: [1], score: -5, maxScore: 0 });
  assert.deepStrictEqual([neg.score, neg.maxScore, neg.verified], [0, 100, false]);
});

// ─── 5.2 / 5.3 Nivel + repetiție pe itemi ────────────────────────────────────
test('levelFromScores: EMA pe ultimele 3 seturi, cu histereză (nu sare la un singur set slab)', () => {
  assert.strictEqual(med.levelFromScores([0.9, 0.85, 0.8], 'mediu').level, 'avansat');
  assert.strictEqual(med.levelFromScores([0.3, 0.4, 0.35], 'mediu').level, 'incepator');
  assert.strictEqual(med.levelFromScores([0.4, 0.9, 0.9], 'avansat').level, 'avansat', 'un set slab nu coboară nivelul');
  const one = med.levelFromScores([0.2], 'mediu');
  assert.strictEqual(one.level, 'mediu'); // sub 2 seturi nu schimbăm nivelul
  assert.strictEqual(one.changed, false);
  assert.strictEqual(med.difficultyForLevel('incepator'), 'ușor');
  assert.strictEqual(med.difficultyForLevel('avansat'), 'greu');
  assert.strictEqual(med.difficultyForLevel(null), 'mediu');
});

test('sm2Next: corect → intervale 1 → 6 → ×ease, „învățat" după 3; greșit → înapoi la o zi', () => {
  let c = {};
  c = med.sm2Next(c, true); assert.deepStrictEqual([c.reps, c.interval_days, c.retired], [1, 1, false]);
  c = med.sm2Next(c, true); assert.deepStrictEqual([c.reps, c.interval_days, c.retired], [2, 6, false]);
  c = med.sm2Next(c, true); assert.strictEqual(c.reps, 3); assert.ok(c.interval_days > 6); assert.strictEqual(c.retired, true);
  const wrong = med.sm2Next({ ease: 2.5, reps: 2, interval_days: 6, lapses: 0 }, false);
  assert.deepStrictEqual([wrong.reps, wrong.interval_days, wrong.lapses, wrong.retired], [0, 1, 1, false]);
  assert.strictEqual(wrong.ease, 2.3);
  // ease-ul nu coboară sub 1.3
  let hard = { ease: 1.3, reps: 0, interval_days: 1 };
  for (let i = 0; i < 5; i++) hard = med.sm2Next(hard, false);
  assert.strictEqual(hard.ease, 1.3);
  // scadența e în viitor
  assert.ok(new Date(med.sm2Next({}, true).due_at).getTime() > Date.now());
});

test('cap la cap: HTML-ul generat trimite RĂSPUNSURILE, iar serverul obține același scor', () => {
  const html = exgen.renderExerciseHtml({
    title: 'T', kind: 'grila', statement: '',
    questions: [
      { statement: 'Q1', options: ['1', '2', '3', '4'], answer: 1, hint: '', explanation: 'a]; b', points: 5 },
      { statement: 'Q2', answer: '1/2', hint: '', explanation: '', points: 5 },
    ],
  });
  // DOM minimal: elevul bifează varianta b) la Q1 și scrie „0,5" la Q2
  const inputs = { q0: { checked: true, value: '1' }, q1: { value: '0,5' } };
  let clickFn = null, posted = null;
  const dummy = { set innerHTML(v) {}, set className(v) {}, style: {}, addEventListener(_, fn) { clickFn = fn; } };
  const document = {
    querySelector: (sel) => {
      const m = /name="q(\d+)"/.exec(sel);
      if (!m) return null;
      const el = inputs['q' + m[1]];
      if (!el) return null;
      return /:checked/.test(sel) ? (el.checked ? el : null) : el;
    },
    getElementById: () => dummy, body: {}, head: { appendChild() {} }, createElement: () => ({}),
  };
  const win = { addEventListener() {}, renderMathInElement: null, opener: null };
  const parent = { postMessage: (m) => { posted = m; } };
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]);
  // în browser scripturile împart același scop global — le rulăm împreună
  new Function('document', 'window', 'parent', scripts.join('\n'))(document, win, parent);
  clickFn();

  assert.strictEqual(posted.type, 'MATE_SCORE');
  assert.deepStrictEqual(posted.answers, [1, '0,5']);
  const rec = score.recompute(score.keysFromHtml(html), posted.answers);
  assert.strictEqual(rec.pct, posted.score, 'scorul serverului = scorul afișat elevului');
  // răspuns greșit → serverul NU crede procentul trimis
  const cheat = score.recompute(score.keysFromHtml(html), [0, 'x']);
  assert.strictEqual(cheat.pct, 0);
});


// ─── Regresie: indexarea nu mai poate ține invocarea până la 504 ─────────────
// „Reindexează tot" pica cu „Eroare server (504)": loadContentHtml descarcă
// HTML-ul fiecărui material din storage, iar o singură descărcare blocată
// ținea toată invocarea până o tăia platforma.
test('loadContentHtml: o descărcare blocată se abandonează, nu ține invocarea', async () => {
  process.env.AI_HTML_TIMEOUT_MS = '150';
  delete require.cache[require.resolve('../api/_lib/score.js')];
  const s2 = require('../api/_lib/score.js');
  const supa = {
    storage: { from: () => ({ download: () => new Promise(() => {}) }) }, // nu se rezolvă NICIODATĂ
  };
  const t0 = Date.now();
  const html = await s2.loadContentHtml(supa, { file_url: 'https://x.co/storage/v1/object/public/materiale/a.html' });
  const dt = Date.now() - t0;
  assert.equal(html, '', 'ar fi trebuit să întoarcă text gol');
  assert.ok(dt < 2000, `a durat ${dt}ms — termenul limită nu s-a aplicat`);
  delete process.env.AI_HTML_TIMEOUT_MS;
  delete require.cache[require.resolve('../api/_lib/score.js')];
});

test('loadContentHtml: o eroare de storage nu aruncă, ci sare peste material', async () => {
  const supa = { storage: { from: () => ({ download: async () => { throw new Error('bucket lipsă'); } }) } };
  const html = await score.loadContentHtml(supa, { file_url: 'https://x.co/storage/v1/object/public/materiale/b.html' });
  assert.equal(html, '');
});

test('loadContentHtml: fără file_url nu atinge storage-ul', async () => {
  let atins = false;
  const supa = { storage: { from: () => { atins = true; return { download: async () => ({ data: null }) }; } } };
  assert.equal(await score.loadContentHtml(supa, { file_url: null }), '');
  assert.equal(await score.loadContentHtml(supa, null), '');
  assert.equal(atins, false, 'a chemat storage-ul degeaba');
});

test('ai-ingest: lotul e plafonat pe FRAGMENTE, nu doar pe timp', () => {
  const src = require('node:fs').readFileSync(require.resolve('../api/ai-ingest.js'), 'utf8');
  assert.match(src, /AI_INGEST_CHUNKS_MAX/, 'lipsește plafonul de fragmente per invocare');
  assert.match(src, /toEmbed\.length >= CHUNKS_MAX/, 'plafonul nu e verificat în bucla de joburi');
  // un lot de materiale GRELE trebuie tăiat devreme (embeddings scalează cu fragmentele)
  const cap = parseInt(/AI_INGEST_CHUNKS_MAX \|\| '(\d+)'/.exec(src)[1], 10);
  let toEmbed = 0, done = 0;
  for (let i = 0; i < 20; i++) { if (done && toEmbed >= cap) break; toEmbed += 80; done++; }
  assert.ok(done <= 5, `lot greu tăiat abia la ${done} materiale (${toEmbed} fragmente)`);
});
