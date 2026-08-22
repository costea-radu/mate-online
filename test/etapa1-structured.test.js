// =====================================================================
// test/etapa1-structured.test.js — Structured Outputs (json_schema strict)
// cu fallback pe json_object, restaurarea LaTeX-ului după JSON.parse,
// indexul răspunsului la grilă (Etapa 1 din AUDIT_AGENTI_AI.md, 1.2).
// Rulare: npm test   (node --test test/*.test.js)
// Apelurile LLM sunt simulate prin înlocuirea lui global.fetch — nu se
// trimite nimic pe rețea.
// =====================================================================
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai.js');
const { S } = ai;

// ─── schema helper ───────────────────────────────────────────────────────────
test('S.obj: regulile modului strict — additionalProperties:false, toate cheile required', () => {
  const sch = S.obj({ a: S.str(), b: S.nullable(S.int()), c: S.arr(S.obj({ x: S.bool() })) });
  assert.strictEqual(sch.additionalProperties, false);
  assert.deepStrictEqual(sch.required, ['a', 'b', 'c']);
  assert.deepStrictEqual(sch.properties.b.type, ['integer', 'null']);
  assert.strictEqual(sch.properties.c.items.additionalProperties, false);
  assert.deepStrictEqual(sch.properties.c.items.required, ['x']);
});

test('S.nullable: tipuri simple → [tip,null]; obiect/array/enum → anyOf cu null', () => {
  assert.deepStrictEqual(S.nullable(S.str()).type, ['string', 'null']);
  assert.ok(S.nullable(S.arr(S.str())).anyOf.some((t) => t.type === 'null'));
  assert.ok(S.nullable(S.enum(['a', 'b'])).anyOf.some((t) => t.enum));
  assert.ok(S.nullable(S.obj({ z: S.num() })).anyOf.some((t) => t.type === 'object'));
});

// ─── corpul cererii ──────────────────────────────────────────────────────────
test('buildBody: schema → response_format json_schema strict, cu numele curățat', () => {
  const body = ai.buildBody({
    model: 'gpt-4o-mini', temperature: 0.2, maxTokens: 100, system: 's',
    messages: [{ role: 'user', content: 'x' }], json: true,
    schema: S.obj({ ok: S.bool() }), schemaName: 'verificare fidelitate!',
  });
  assert.strictEqual(body.response_format.type, 'json_schema');
  assert.strictEqual(body.response_format.json_schema.strict, true);
  assert.match(body.response_format.json_schema.name, /^[a-zA-Z0-9_-]+$/);
  assert.deepStrictEqual(body.response_format.json_schema.schema, S.obj({ ok: S.bool() }));
  // fără schemă rămâne json_object (comportamentul vechi)
  const plain = ai.buildBody({ model: 'gpt-4o-mini', temperature: 0.2, maxTokens: 100, messages: [], json: true });
  assert.deepStrictEqual(plain.response_format, { type: 'json_object' });
});

test('adaptBodyToError: json_schema respins → json_object → fără format', () => {
  const body = ai.buildBody({ model: 'gpt-4o-mini', temperature: 0.2, maxTokens: 100, messages: [], json: true, schema: S.obj({ a: S.str() }) });
  assert.strictEqual(ai.adaptBodyToError(body, 'Invalid parameter: response_format of type json_schema is not supported'), true);
  assert.deepStrictEqual(body.response_format, { type: 'json_object' });
  assert.strictEqual(ai.adaptBodyToError(body, 'response_format is not supported by this model'), true);
  assert.strictEqual(body.response_format, undefined);
  // o eroare fără legătură nu schimbă nimic
  assert.strictEqual(ai.adaptBodyToError({ messages: [] }, 'rate limit exceeded'), false);
});

// ─── LaTeX după JSON.parse ───────────────────────────────────────────────────
test('restoreLatexControl: \\f \\t \\b se restaurează mereu; \\n/\\r doar înaintea comenzilor LaTeX', () => {
  // JSON.parse('"$\\frac{1}{2}$"') ar da form-feed + „rac" — simulăm rezultatul
  const broken = '$\frac{1}{2} \times \beta \neq 3$\nRând nou normal.\n\\rho \rho \right';
  const fixed = ai.restoreLatexControl(broken);
  assert.ok(fixed.includes('\\frac{1}{2}'), fixed);
  assert.ok(fixed.includes('\\times'), fixed);
  assert.ok(fixed.includes('\\beta'), fixed);
  assert.ok(fixed.includes('\\neq 3'), fixed);
  assert.ok(fixed.includes('\\rho \\right'), fixed);
  // rândul nou REAL („\nRând") rămâne rând nou
  assert.ok(fixed.includes('$\nRând nou normal.'), fixed);
});

test('deepRestoreLatex: parcurge obiecte și liste', () => {
  const out = ai.deepRestoreLatex({ a: ['\frac12', { b: 'x\tan' }], n: 3 });
  assert.strictEqual(out.a[0], '\\frac12');
  assert.strictEqual(out.a[1].b, 'x\\tan');
  assert.strictEqual(out.n, 3);
});

test('parseJsonLoose: JSON curat, ```json```, backslash-uri LaTeX nedublate, gunoi', () => {
  assert.deepStrictEqual(ai.parseJsonLoose('{"a":1}'), { a: 1 });
  assert.deepStrictEqual(ai.parseJsonLoose('```json\n{"a":"\\\\frac{1}{2}"}\n```'), { a: '\\frac{1}{2}' });
  assert.deepStrictEqual(ai.parseJsonLoose('{"a":"\\sqrt{2}"}'), { a: '\\sqrt{2}' });
  assert.strictEqual(ai.parseJsonLoose('nu e json'), null);
  assert.strictEqual(ai.parseJsonLoose(''), null);
});

// ─── indexul răspunsului la grilă ────────────────────────────────────────────
test('answerIndex: index valid, literă a–d, respinge orice altceva (nu mai cade pe 0)', () => {
  assert.strictEqual(ai.answerIndex(2, 4), 2);
  assert.strictEqual(ai.answerIndex('1', 4), 1);
  assert.strictEqual(ai.answerIndex('b', 4), 1);
  assert.strictEqual(ai.answerIndex('C)', 4), 2);
  assert.strictEqual(ai.answerIndex('e', 4), null);   // înainte: Number('e') || 0 → 0 (cheie greșită)
  assert.strictEqual(ai.answerIndex(7, 4), null);
  assert.strictEqual(ai.answerIndex('d', 2), null);   // index în afara opțiunilor
  assert.strictEqual(ai.answerIndex(null, 4), null);
});

// ─── chatJson cu fetch simulat ───────────────────────────────────────────────
function fakeFetch(responses) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const r = responses.shift();
    if (!r) throw new Error('fără răspuns pregătit');
    const status = r.status || 200;
    const payload = r.body;
    return {
      ok: status >= 200 && status < 300, status,
      json: async () => payload,
      text: async () => (typeof payload === 'string' ? payload : JSON.stringify(payload)),
    };
  };
  return calls;
}
const completion = (content, { usage = { prompt_tokens: 10, completion_tokens: 5 }, finish = 'stop', refusal = null } = {}) => ({
  choices: [{ message: { content, refusal }, finish_reason: finish }], usage,
});

test('chatJson: răspuns JSON valid → data parsat, usage cu model, structured=true', async () => {
  const calls = fakeFetch([{ body: completion('{"ok":true,"motiv":null}') }]);
  const r = await ai.chatJson({ system: 's', messages: [{ role: 'user', content: 'u' }], schema: S.obj({ ok: S.bool(), motiv: S.nullable(S.str()) }), schemaName: 'x', model: 'gpt-4o-mini' });
  assert.deepStrictEqual(r.data, { ok: true, motiv: null });
  assert.deepStrictEqual(r.usage, { in: 10, out: 5, model: 'gpt-4o-mini' });
  assert.strictEqual(r.structured, true);
  assert.strictEqual(calls[0].response_format.type, 'json_schema');
});

test('chatJson: providerul respinge json_schema → reîncearcă automat cu json_object', async () => {
  const calls = fakeFetch([
    { status: 400, body: { error: { message: 'Invalid parameter: response_format json_schema' } } },
    { body: completion('{"a":"\\\\frac{1}{2}"}') },
  ]);
  const r = await ai.chatJson({ messages: [{ role: 'user', content: 'u' }], schema: S.obj({ a: S.str() }), model: 'gpt-4o-mini' });
  assert.strictEqual(calls.length, 2);
  assert.strictEqual(calls[0].response_format.type, 'json_schema');
  assert.deepStrictEqual(calls[1].response_format, { type: 'json_object' });
  assert.deepStrictEqual(r.data, { a: '\\frac{1}{2}' });
  assert.strictEqual(r.structured, false);
});

test('chatJson: LaTeX cu un singur backslash în JSON valid se restaurează (\\frac → form-feed)', async () => {
  // conținutul JSON conține „\f" (escape valid) → după parse ar fi form-feed + „rac"
  fakeFetch([{ body: completion('{"statement":"$\\frac{3}{4}$ și $\\tan x$"}') }]);
  const r = await ai.chatJson({ messages: [{ role: 'user', content: 'u' }], schema: S.obj({ statement: S.str() }), model: 'gpt-4o-mini' });
  assert.strictEqual(r.data.statement, '$\\frac{3}{4}$ și $\\tan x$');
});

test('chatJson: răspuns neparsabil → o reîncercare cu avertisment; apoi 502 cu usage atașat', async () => {
  const calls = fakeFetch([
    { body: completion('nu e json', { usage: { prompt_tokens: 7, completion_tokens: 3 } }) },
    { body: completion('tot nu', { usage: { prompt_tokens: 8, completion_tokens: 2 } }) },
  ]);
  await assert.rejects(
    ai.chatJson({ messages: [{ role: 'user', content: 'u' }], schema: S.obj({ a: S.str() }), model: 'gpt-4o-mini' }),
    (e) => e.status === 502 && e.usage && e.usage.in === 15 && e.usage.out === 5,
  );
  assert.strictEqual(calls.length, 2);
  // reîncercarea poartă avertismentul explicit
  const last = calls[1].messages[calls[1].messages.length - 1];
  assert.match(last.content, /JSON valid/);
});

test('chatJson: refuz explicit (Structured Outputs) → eroare 502', async () => {
  fakeFetch([{ body: completion(null, { refusal: 'Nu pot.' }) }]);
  await assert.rejects(
    ai.chatJson({ messages: [{ role: 'user', content: 'u' }], schema: S.obj({ a: S.str() }), model: 'gpt-4o-mini' }),
    (e) => e.status === 502 && /refuzat/.test(e.message),
  );
});

test('chatJson: model cu raționament, răspuns gol → reîncercare cu buget maxim', async () => {
  const calls = fakeFetch([
    { body: completion('', { finish: 'length' }) },
    { body: completion('{"a":"b"}') },
  ]);
  const r = await ai.chatJson({ messages: [{ role: 'user', content: 'u' }], schema: S.obj({ a: S.str() }), model: 'gpt-5-mini', maxTokens: 500 });
  assert.deepStrictEqual(r.data, { a: 'b' });
  assert.strictEqual(calls[1].max_completion_tokens, 16000);
});
