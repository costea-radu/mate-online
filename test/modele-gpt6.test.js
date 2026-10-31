// =====================================================================
// test/modele-gpt6.test.js — modelele gpt-6.x (gpt-6.1-sol, gpt-6.1-terra)
// merg pe drumul modelelor cu raționament, la fel ca gpt-5.x:
//   · isNewGenModel le recunoaște (și cu prefixul gateway-ului), dar nu și
//     gpt-4o / gpt-4.1 / gpt-4.5 / gpt-3.5;
//   · cererea de la „Generează subiect examen" (ai-exam: 7500 de tokeni,
//     temperatura 0,7, schema test_examen) pleacă cu max_completion_tokens
//     16000, fără max_tokens / temperature — un provider care le refuză
//     (cum face OpenAI la modelele cu raționament) răspunde din PRIMA cerere;
//   · reîncercarea cu buget maxim la răspuns tăiat / gol li se aplică;
//   · verificatorul și regenerarea itemilor (fără AI_VERIFY_MODEL) primesc
//     aceiași parametri;
//   · prețurile gpt-6.1 sunt în tabel (nu mai cad pe implicitul 3/15).
// Până pe 1 nov. 2026 regexul recunoștea DOAR gpt-5.x: cu AI_GEN_CHAT_MODEL=
// gpt-6.1-sol, cererea pleca cu max_tokens + temperature → eroare 400.
// Apelurile LLM sunt simulate prin înlocuirea lui global.fetch.
// Rulare: npm test   (node --test test/modele-gpt6.test.js)
// =====================================================================
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
process.env.AI_GEN_CHAT_MODEL = 'gpt-6.1-sol'; // comutarea din Vercel
process.env.AI_VERIFY_GEN = '1';
delete process.env.AI_VERIFY_MODEL;  // verificatorul = modelul de generare
delete process.env.AI_PRICES_JSON;   // prețurile din cod, nu din env
delete process.env.AI_REASONING_EFFORT;
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai.js');
const exam = require('../api/ai-exam.js');

// ─── provider simulat, strict ca OpenAI la modelele cu raționament ──────────
// Refuză (400) max_tokens, temperatura ≠ 1 și efortul pe care modelul nu-l
// are; altfel răspunde cu handler(body, nr) — un string = conținutul
// mesajului, sau { status, body }. Cererile respinse rămân în `calls`.
const completion = (content, { finish = 'stop', usage = { prompt_tokens: 20, completion_tokens: 10 } } = {}) => ({
  choices: [{ message: { content }, finish_reason: finish }], usage,
});
function strictProvider(handler) {
  const calls = [];
  const refuse = (param, message) => ({ status: 400, body: { error: { message, type: 'invalid_request_error', param, code: 'unsupported_parameter' } } });
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    let r;
    if ('max_tokens' in body) r = refuse('max_tokens', "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead.");
    else if ('temperature' in body && body.temperature !== 1) r = refuse('temperature', `Unsupported value: 'temperature' does not support ${body.temperature} with this model. Only the default (1) value is supported.`);
    else if (/gpt-6\.1-sol/.test(body.model) && ['none', 'minimal'].includes(body.reasoning_effort)) {
      r = refuse('reasoning_effort', `Unsupported value: 'reasoning_effort' does not support '${body.reasoning_effort}' with this model. Supported values are: 'low', 'medium', 'high', 'xhigh', and 'max'.`);
    } else {
      r = await handler(body, calls.length);
      if (typeof r === 'string') r = { body: completion(r) };
    }
    const status = r.status || 200;
    return {
      ok: status >= 200 && status < 300, status,
      json: async () => r.body,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  return calls;
}
const msgs = [{ role: 'user', content: 'x' }];
const respinse = (calls) => calls.filter((c) => 'max_tokens' in c || ('temperature' in c && c.temperature !== 1));

// ─── recunoașterea modelelor ────────────────────────────────────────────────
test('isNewGenModel: gpt-5.x ȘI gpt-6.x (și următoarele), cu sau fără prefixul gateway-ului; nu modelele vechi', () => {
  const noi = ['gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-5.4', 'gpt-5.6-sol', 'gpt-5.6-terra',
    'gpt-6', 'gpt-6-sol', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6.1-sol-2026-09-29',
    'openai/gpt-6.1-sol', 'OpenAI/GPT-6.1-Terra', 'gpt-7', 'gpt-10', 'o1', 'o3', 'o4-mini', 'openai/o3-mini'];
  const vechi = ['gpt-4o-mini', 'gpt-4o', 'openai/gpt-4o-mini', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.5-preview',
    'gpt-3.5-turbo', 'chatgpt-4o-latest', 'gpt-oss-120b', 'claude-opus-5-5', 'anthropic/claude-opus-5-5',
    'text-embedding-3-small', 'whisper-1', 'google/gemini-3.1-pro', '', null, undefined];
  for (const m of noi) assert.strictEqual(ai.isNewGenModel(m), true, `ar trebui recunoscut: ${m}`);
  for (const m of vechi) assert.strictEqual(ai.isNewGenModel(m), false, `nu e model cu raționament: ${m}`);
});

test('AI_GEN_CHAT_MODEL=gpt-6.1-sol: modelul de generare; peste bugetul zilnic soft coboară tot pe modelul standard', () => {
  assert.strictEqual(ai.GEN_MODEL, 'gpt-6.1-sol');
  assert.strictEqual(ai.pickModel(ai.GEN_MODEL, { degraded: false }), 'gpt-6.1-sol');
  assert.strictEqual(ai.pickModel(ai.GEN_MODEL, { degraded: true }), ai.CHAT_MODEL);
});

// ─── corpul cererii ─────────────────────────────────────────────────────────
test('buildBody: cererea de la „Generează subiect examen" pe gpt-6.1-sol — 16000 de tokeni, fără max_tokens / temperature, schema strictă', () => {
  const opts = { temperature: 0.7, maxTokens: 7500, messages: msgs, system: 's', schema: exam.EXAM_SCHEMA, schemaName: 'test_examen' };
  for (const model of ['gpt-6.1-sol', 'openai/gpt-6.1-sol']) {
    const b = ai.buildBody({ model, ...opts });
    assert.strictEqual(b.max_completion_tokens, 16000, model);
    assert.ok(!('max_tokens' in b) && !('temperature' in b), model);
    assert.strictEqual(b.response_format.type, 'json_schema');
    assert.strictEqual(b.response_format.json_schema.name, 'test_examen');
    assert.strictEqual(b.response_format.json_schema.strict, true);
  }
  // terra (PDF / poze), buget mic → minimul de 3000 pentru raționament
  const t = ai.buildBody({ model: 'gpt-6.1-terra', temperature: 0.1, maxTokens: 800, messages: msgs });
  assert.strictEqual(t.max_completion_tokens, 3000);
  assert.ok(!('temperature' in t));
  // modelele vechi rămân pe max_tokens + temperature, ca înainte
  const o = ai.buildBody({ model: 'gpt-4o-mini', temperature: 0.7, maxTokens: 7500, messages: msgs });
  assert.strictEqual(o.max_tokens, 7500);
  assert.strictEqual(o.temperature, 0.7);
  assert.ok(!('max_completion_tokens' in o));
});

test('buildBody: efortul de raționament low…max ajunge la gpt-6.1 (inclusiv „max", ignorat până acum); valorile necunoscute nu', () => {
  const body = (model, reasoningEffort) => ai.buildBody({ model, temperature: 0.3, maxTokens: 900, messages: msgs, reasoningEffort });
  for (const eff of ['low', 'medium', 'high', 'xhigh', 'max']) assert.strictEqual(body('gpt-6.1-sol', eff).reasoning_effort, eff);
  assert.strictEqual(body('gpt-6.1-terra', 'none').reasoning_effort, 'none');
  assert.strictEqual(body('gpt-6.1-sol', 'turbo').reasoning_effort, undefined);
  assert.strictEqual(body('gpt-4o-mini', 'max').reasoning_effort, undefined);
});

// ─── cereri complete (provider strict) ──────────────────────────────────────
test('chatJson ca la „Generează subiect examen": gpt-6.1-sol răspunde din PRIMA cerere (regresia: înainte, 400 la max_tokens, apoi la temperature)', async () => {
  const calls = strictProvider(() => '{"title":"Model EN","subjects":[]}');
  const r = await ai.chatJson({
    system: 's', messages: msgs, temperature: 0.7, maxTokens: 7500,
    model: ai.pickModel(ai.GEN_MODEL, { degraded: false }), restoreLatex: false,
    schema: exam.EXAM_SCHEMA, schemaName: 'test_examen',
  });
  assert.deepStrictEqual(r.data, { title: 'Model EN', subjects: [] });
  assert.strictEqual(calls.length, 1, 'nicio cerere respinsă');
  assert.strictEqual(calls[0].model, 'gpt-6.1-sol');
  assert.strictEqual(calls[0].max_completion_tokens, 16000);
  assert.deepStrictEqual(r.usage, { in: 20, out: 10, model: 'gpt-6.1-sol' });
});

test('chatJson: răspuns TĂIAT pe gpt-6.1-sol → o reîncercare cu bugetul maxim (16000)', async () => {
  const calls = strictProvider((body, n) => (n === 1
    ? { body: completion('{"item":{"statement":"Calcula', { finish: 'length' }) }
    : '{"a":"b"}'));
  const r = await ai.chatJson({ messages: msgs, schema: ai.S.obj({ a: ai.S.str() }), model: 'gpt-6.1-sol', maxTokens: 1800 });
  assert.deepStrictEqual(r.data, { a: 'b' });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].max_completion_tokens, 5400);
  assert.strictEqual(calls[1].max_completion_tokens, 16000);
});

test('chat (lecțiile din meditații): răspuns GOL pe gpt-6.1-sol → reîncercare cu bugetul maxim', async () => {
  const calls = strictProvider((body, n) => (n === 1 ? { body: completion('', { finish: 'length' }) } : 'Lecția…'));
  const r = await ai.chat({ system: 's', messages: msgs, temperature: 0.4, maxTokens: 3000, model: 'gpt-6.1-sol' });
  assert.strictEqual(r.text, 'Lecția…');
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].max_completion_tokens, 9000);
  assert.strictEqual(calls[1].max_completion_tokens, 16000);
  assert.deepStrictEqual(respinse(calls), []);
});

test('chatVision pe gpt-6.1-terra (AI_VISION_MODEL): o singură cerere, cu parametrii modelelor cu raționament', async () => {
  const calls = strictProvider(() => 'Calculați 2 + 3.');
  const r = await ai.chatVision({ text: 'Transcrie.', imageDataUrl: 'data:image/png;base64,AAAA', model: 'gpt-6.1-terra' });
  assert.strictEqual(r.text, 'Calculați 2 + 3.');
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].max_completion_tokens, 3000);
  assert.ok(!('temperature' in calls[0]));
});

test('efortul refuzat de model (gpt-6.1-sol nu are „minimal") → cererea pleacă din nou fără el', async () => {
  const calls = strictProvider(() => '{"a":"b"}');
  const r = await ai.chatJson({ messages: msgs, schema: ai.S.obj({ a: ai.S.str() }), model: 'gpt-6.1-sol', maxTokens: 500, reasoningEffort: 'minimal' });
  assert.deepStrictEqual(r.data, { a: 'b' });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].reasoning_effort, 'minimal');
  assert.strictEqual(calls[1].reasoning_effort, undefined);
});

// ─── fluxul EN: validare → regenerare țintită → verificator ─────────────────
const userText = (body) => { const m = body.messages.filter((x) => x.role === 'user').pop(); return typeof m.content === 'string' ? m.content : m.content.map((p) => p.text || '').join(''); };
const vAnswer = (final_answer, letter = null) => JSON.stringify({ final_answer, letter, confidence: 'high', note: 'calcul direct' });
function enExam() {
  const grila = (n, extra = {}) => ({ number: String(n), statement: `Enunțul ${n}: calculați $2 \\cdot ${n}$ și alegeți varianta corectă.`, options: [`${2 * n - 1}`, `${2 * n}`, `${2 * n + 1}`, `${2 * n + 2}`], answer: 'b', points: 5, ...extra });
  const S1 = { label: 'SUBIECTUL I', points: 30, items: [grila(1), grila(2), grila(3), grila(4), grila(5), { number: '6', statement: 'Numărul $\\sqrt{16}$ este natural. Adevărat sau Fals?', options: ['Adevărat', 'Fals'], answer: 'a', points: 5 }] };
  const S2 = { label: 'SUBIECTUL al II-lea', points: 30, items: [1, 2, 3, 4, 5, 6].map((n) => grila(n, { statement: `Geometrie ${n}: în triunghiul $ABC$ cu $AB = ${n + 3}$ cm, aflați perimetrul.`, figure: { type: 'triunghi', labels: ['A', 'B', 'C'] } })) };
  const prob = (n) => ({ number: String(n), statement: `Problema ${n}: fie numărul $x = ${n} + \\frac{1}{2}$ și expresia $E(x)$.`, parts: [{ label: 'a', text: 'Arătați că $x > 0$.', points: 2, solution: 'evident' }, { label: 'b', text: 'Calculați $2x$.', points: 3, solution: `$2x = ${2 * n + 1}$` }] });
  const S3 = { label: 'SUBIECTUL al III-lea', points: 30, items: [1, 2, 3, 4, 5, 6].map(prob) };
  return { title: 'Model EN', subjects: [S1, S2, S3] };
}

test('subiect EN pe gpt-6.1-sol, fără AI_VERIFY_MODEL: regenerarea țintită și verificarea celor 12 grile trec din prima cerere', async () => {
  const calls = strictProvider((body) => {
    const u = userText(body);
    if (body.response_format?.json_schema?.name === 'verificare_item') return /Adevărat sau Fals/.test(u) ? vAnswer('Adevărat', 'a') : vAnswer('ok', 'b');
    const old = JSON.parse(/ITEMUL VECHI \(de înlocuit\):\n([\s\S]*?)\n\nScrie/.exec(u)[1]);
    return JSON.stringify({ item: { ...old, options: ['1', '2', '3', '4'], answer: 'b', statement: 'Item reparat: calculați $1+1$ și alegeți varianta corectă.' } });
  });
  const ex = enExam();
  ex.subjects[0].items[0].options = ['1', '2', '3']; // eroare structurală → regenerare țintită
  const report = await exam.verifyAndRepairExam(ex, { examType: 'evaluare-nationala', model: ai.pickModel(ai.GEN_MODEL, { degraded: false }), supa: null, userId: null });
  assert.deepStrictEqual(report.errors, []);
  assert.strictEqual(report.regenerated, 1);
  assert.strictEqual(report.checked, 12);
  assert.strictEqual(report.disagreed, 0);
  assert.deepStrictEqual(respinse(calls), [], 'nicio cerere respinsă de provider');
  assert.ok(calls.every((c) => c.model === 'gpt-6.1-sol'));
  const regen = calls.filter((c) => c.response_format?.json_schema?.name === 'item_test');
  const verif = calls.filter((c) => c.response_format?.json_schema?.name === 'verificare_item');
  assert.strictEqual(regen.length, 1);
  assert.strictEqual(regen[0].max_completion_tokens, 5400);
  assert.strictEqual(verif.length, 12);
  assert.ok(verif.every((c) => c.max_completion_tokens === 3000));
  assert.strictEqual(ex.subjects[0].items[0].options.length, 4);
});

// ─── prețuri ────────────────────────────────────────────────────────────────
test('prețurile gpt-6.1 sunt în tabel (2/10 și 1/5 USD/1M) — nu mai cad pe prețul implicit 3/15', () => {
  assert.deepStrictEqual(ai.priceFor('gpt-6.1-sol'), { in: 2, out: 10 });
  assert.deepStrictEqual(ai.priceFor('gpt-6.1-terra'), { in: 1, out: 5 });
  assert.deepStrictEqual(ai.priceFor('openai/gpt-6.1-sol'), ai.priceFor('gpt-6.1-sol'));      // prin gateway
  assert.deepStrictEqual(ai.priceFor('gpt-6.1-sol-2026-09-29'), ai.priceFor('gpt-6.1-sol')); // snapshot datat
  assert.notDeepStrictEqual(ai.priceFor('gpt-6.1-sol'), ai.priceFor('model-necunoscut-xyz'));
  // același consum: 6.1 sol sub 5.6 sol, 6.1 terra sub 5.6 terra
  const u = { in: 10_000, out: 8_000 };
  assert.ok(ai.costMicroLei('gpt-6.1-sol', u) < ai.costMicroLei('gpt-5.6-sol', u));
  assert.ok(ai.costMicroLei('gpt-6.1-terra', u) < ai.costMicroLei('gpt-5.6-terra', u));
});
