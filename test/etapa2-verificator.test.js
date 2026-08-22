// =====================================================================
// test/etapa2-verificator.test.js — Etapa 2 (AUDIT_AGENTI_AI.md, 1.3 + 1.4):
//   · verificatorul independent (api/_lib/verify.js): acord/dezacord pe
//     grilă și pe răspuns liber, „nesigur" nu pedepsește, plafoane;
//   · verifyQuestionSet (meditații / exerciții interactive): itemii
//     infirmați ies, se generează înlocuitori, raportul e complet;
//   · verifyAndRepairExam (ai-exam): validare → regenerare țintită →
//     verificare → regenerare la dezacord → „unsure";
//   · modelul pe moduri (chatModelFor, AI_TUTOR_MODEL) și reasoning_effort.
// Apelurile LLM sunt simulate prin înlocuirea lui global.fetch.
// Rulare: npm test   (node --test test/*.test.js)
// =====================================================================
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
process.env.AI_VERIFY_GEN = '1';
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai.js');
const verify = require('../api/_lib/verify.js');
const med = require('../api/_lib/meditatii.js');
const exam = require('../api/ai-exam.js');

// ─── fetch simulat: un „router" după conținutul cererii ─────────────────────
// handler(body) → conținutul (string) al răspunsului modelului sau { status, body }
function fakeFetch(handler) {
  const calls = [];
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    let r = await handler(body, calls.length);
    if (typeof r === 'string') r = { body: { choices: [{ message: { content: r }, finish_reason: 'stop' }], usage: { prompt_tokens: 20, completion_tokens: 10 } } };
    const status = r.status || 200;
    return {
      ok: status >= 200 && status < 300, status,
      json: async () => r.body,
      text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
    };
  };
  return calls;
}
const userText = (body) => { const m = body.messages.filter((x) => x.role === 'user').pop(); return typeof m.content === 'string' ? m.content : m.content.map((p) => p.text || '').join(''); };
const isVerify = (body) => body.response_format?.json_schema?.name === 'verificare_item' || /NU primești răspunsul altcuiva/.test(body.messages[0]?.content || '');
const vAnswer = (final_answer, letter = null, confidence = 'high') => JSON.stringify({ final_answer, letter, confidence, note: 'calcul direct' });

// ─── verifyItem ──────────────────────────────────────────────────────────────
test('verifyItem (grilă): litera verificatorului = litera generatorului → agree=true; diferită → false', async () => {
  fakeFetch(() => vAnswer('4', 'b'));
  const it = { id: 1, statement: '$2+2=?$', options: ['3', '4', '5', '6'], answer: 1 };
  let r = await verify.verifyItem(it, { model: 'gpt-4o-mini' });
  assert.strictEqual(r.agree, true);
  assert.deepStrictEqual(r.usage, { in: 20, out: 10, model: 'gpt-4o-mini' });
  r = await verify.verifyItem({ ...it, answer: 'c' }, { model: 'gpt-4o-mini' });
  assert.strictEqual(r.agree, false);
  assert.strictEqual(r.verifier.letter, 'b');
});

test('verifyItem (grilă): verificatorul „nesigur" (confidence low) → null, nu dezacord; fără literă, cu textul variantei → se potrivește', async () => {
  fakeFetch(() => vAnswer('5', 'c', 'low'));
  const it = { id: 1, statement: 'x', options: ['3', '4', '5', '6'], answer: 1 };
  assert.strictEqual((await verify.verifyItem(it)).agree, null);
  fakeFetch(() => vAnswer('4', null));
  assert.strictEqual((await verify.verifyItem(it)).agree, true);
});

test('verifyItem (răspuns liber): echivalență matematică („0,5" = „1/2"); text nedecis → null; demonstrație → null', async () => {
  fakeFetch(() => vAnswer('0,5'));
  assert.strictEqual((await verify.verifyItem({ id: 1, statement: 'x', answer: '1/2' })).agree, true);
  fakeFetch(() => vAnswer('x = 7'));
  assert.strictEqual((await verify.verifyItem({ id: 1, statement: 'x', answer: '5' })).agree, false);
  fakeFetch(() => vAnswer('triunghiul este isoscel'));
  assert.strictEqual((await verify.verifyItem({ id: 1, statement: 'x', answer: 'isoscel' })).agree, null);
  fakeFetch(() => vAnswer('demonstratie'));
  assert.strictEqual((await verify.verifyItem({ id: 1, statement: 'x', answer: 'se arată că' })).agree, null);
});

test('verifyItem: eroarea providerului nu aruncă — agree=null + error', async () => {
  fakeFetch(() => ({ status: 500, body: { error: { message: 'boom' } } }));
  const r = await verify.verifyItem({ id: 1, statement: 'x', answer: '5' });
  assert.strictEqual(r.agree, null);
  assert.match(r.error, /LLM 500/);
});

test('verifyItems: plafon de itemi (maxItems) + buget de timp → skipped; usage însumat', async () => {
  fakeFetch(() => vAnswer('4', 'b'));
  const items = Array.from({ length: 6 }, (_, i) => ({ id: i, statement: 's' + i, options: ['3', '4', '5', '6'], answer: 1 }));
  const r = await verify.verifyItems(items, { model: 'm', maxItems: 4, concurrency: 2 });
  assert.strictEqual(r.checked, 4);
  assert.strictEqual(r.skipped, 2);
  assert.strictEqual(r.results.length, 4);
  assert.deepStrictEqual(r.usage, { in: 80, out: 40, model: 'm' });
  // timpul expirat → restul sunt sărite, fără apeluri
  const calls = fakeFetch(() => vAnswer('4', 'b'));
  const r2 = await verify.verifyItems(items, { model: 'm', timeMs: -1 });
  assert.strictEqual(r2.checked, 0);
  assert.strictEqual(calls.length, 0);
});

test('claimedLetter: index / literă / text de variantă', () => {
  const it = { options: ['12', '1/2', 'x=3', 'Fals'] };
  assert.strictEqual(verify.claimedLetter({ ...it, answer: 2 }), 'c');
  assert.strictEqual(verify.claimedLetter({ ...it, answer: 'B)' }), 'b');
  assert.strictEqual(verify.claimedLetter({ ...it, answer: 'x = 3' }), 'c');
  assert.strictEqual(verify.claimedLetter({ ...it, answer: '77' }), null);
  assert.strictEqual(verify.claimedLetter({ statement: 'liber', answer: '5' }), null);
});

// ─── verifyQuestionSet (meditații / exerciții interactive) ──────────────────
const Q = (n, answer = 1) => ({ statement: `Întrebarea ${n}: calculați $${n} + ${n}$ și alegeți varianta corectă.`, options: [`${2 * n - 1}`, `${2 * n}`, `${2 * n + 1}`, `${2 * n + 2}`], answer, explanation: 'adunare' });

test('verifyQuestionSet: itemii infirmați ies din set, se cer înlocuitori, raportul numără tot', async () => {
  let regenCalls = 0;
  fakeFetch((body) => {
    if (isVerify(body)) {
      // verificatorul: la „Întrebarea 2" alege altă literă (cheia e greșită)
      const u = userText(body);
      return /Întrebarea 2:/.test(u) ? vAnswer('5', 'c') : vAnswer('ok', 'b');
    }
    regenCalls++;
    return JSON.stringify({ questions: [{ statement: 'Întrebarea 9: calculați $9 + 9$ și alegeți varianta corectă.', options: ['17', '18', '19', '20'], answer: 1, explanation: 'x', chapter: null, topic: null }] });
  });
  const r = await med.verifyQuestionSet([Q(1), Q(2), Q(3)], { model: 'gpt-4o-mini', wantCount: 3, qtype: 'grila' });
  assert.strictEqual(regenCalls, 1);
  assert.strictEqual(r.questions.length, 3);
  assert.ok(r.questions.every((q) => !/Întrebarea 2:/.test(q.statement)));
  assert.ok(r.questions.some((q) => /Întrebarea 9:/.test(q.statement)));
  assert.strictEqual(r.report.disagreed, 1);
  assert.strictEqual(r.report.regenerated, 1);
  assert.strictEqual(r.report.checked, 4); // 3 + înlocuitorul
  assert.ok(r.usage.in > 0 && r.usage.out > 0);
});

test('verifyQuestionSet: validarea structurală elimină întrebările invalide înainte de verificator; verify=false → doar validare', async () => {
  const calls = fakeFetch(() => vAnswer('ok', 'b'));
  const bad = { statement: 'Grilă cu index greșit pentru variantele date', options: ['1', '2', '3', '4'], answer: 9 };
  const r = await med.verifyQuestionSet([Q(1), bad], { model: 'm', verify: false });
  assert.strictEqual(calls.length, 0);
  assert.strictEqual(r.questions.length, 1);
  assert.strictEqual(r.report.dropped, 1);
  assert.ok(r.report.errors.some((e) => /nu indică o variantă/.test(e)));
});

test('verifyQuestionSet: o eroare a verificatorului nu pică generarea (setul rămâne, cu avertisment)', async () => {
  fakeFetch(() => ({ status: 503, body: 'indisponibil' }));
  const r = await med.verifyQuestionSet([Q(1), Q(2)], { model: 'm' });
  assert.strictEqual(r.questions.length, 2);
  assert.strictEqual(r.report.disagreed, 0);
});

// ─── verifyAndRepairExam (ai-exam) ───────────────────────────────────────────
function enExam() {
  const grila = (n, extra = {}) => ({ number: String(n), statement: `Enunțul ${n}: calculați $2 \\cdot ${n}$ și alegeți varianta corectă.`, options: [`${2 * n - 1}`, `${2 * n}`, `${2 * n + 1}`, `${2 * n + 2}`], answer: 'b', points: 5, ...extra });
  const S1 = { label: 'SUBIECTUL I', points: 30, items: [grila(1), grila(2), grila(3), grila(4), grila(5), { number: '6', statement: 'Numărul $\\sqrt{16}$ este natural. Adevărat sau Fals?', options: ['Adevărat', 'Fals'], answer: 'a', points: 5 }] };
  const S2 = { label: 'SUBIECTUL al II-lea', points: 30, items: [1, 2, 3, 4, 5, 6].map((n) => grila(n, { statement: `Geometrie ${n}: în triunghiul $ABC$ cu $AB = ${n + 3}$ cm, aflați perimetrul.`, figure: { type: 'triunghi', labels: ['A', 'B', 'C'] } })) };
  const prob = (n, fig) => ({ number: String(n), statement: `Problema ${n}: fie numărul $x = ${n} + \\frac{1}{2}$ și expresia $E(x)$.`, parts: [{ label: 'a', text: 'Arătați că $x > 0$.', points: 2, solution: 'evident' }, { label: 'b', text: 'Calculați $2x$.', points: 3, solution: `$2x = ${2 * n + 1}$` }], ...(fig ? { figure: { type: 'patrat', labels: ['A', 'B', 'C', 'D'] } } : {}) });
  const S3 = { label: 'SUBIECTUL al III-lea', points: 30, items: [prob(1, false), prob(2, false), prob(3, true), prob(4, true), prob(5, true), prob(6, true)] };
  return { title: 'Model EN', subjects: [S1, S2, S3] };
}

test('verifyAndRepairExam: item infirmat → regenerat țintit și re-verificat; al doilea dezacord → „unsure"', async () => {
  const regen = [];
  fakeFetch((body) => {
    const u = userText(body);
    if (isVerify(body)) {
      if (/Adevărat sau Fals/.test(u)) return vAnswer('Adevărat', 'a');
      if (/Geometrie 2:/.test(u)) return vAnswer('9', 'd');         // II.2 greșit — și după regenerare
      if (/ÎNLOCUITOR/.test(u)) return vAnswer('ok', 'b');           // ceilalți înlocuitori se confirmă
      if (/Enunțul 3:/.test(u)) return vAnswer('7', 'c');           // cheia itemului I.3 e greșită
      return vAnswer('ok', 'b');
    }
    // regenerarea țintită: întoarce un item nou de aceeași formă
    const old = JSON.parse(/ITEMUL VECHI \(de înlocuit\):\n([\s\S]*?)\n\nScrie/.exec(u)[1]);
    regen.push(old.number);
    const item = { ...old, statement: `ÎNLOCUITOR pentru ${old.statement}`, answer: 'b' };
    return JSON.stringify({ item });
  });
  const ex = enExam();
  const report = await exam.verifyAndRepairExam(ex, { examType: 'evaluare-nationala', model: 'gpt-4o-mini', supa: null, userId: null });
  assert.strictEqual(report.validated, true);
  assert.deepStrictEqual(report.errors, []);
  assert.strictEqual(report.disagreed, 2);
  assert.strictEqual(report.regenerated, 2);
  assert.ok(/ÎNLOCUITOR/.test(ex.subjects[0].items[2].statement));
  assert.strictEqual(ex.subjects[0].items[2].unsure, undefined);     // re-verificat OK
  assert.deepStrictEqual(report.unsure, ['al II-lea · 2']);          // verificatorul a infirmat și înlocuitorul
  assert.strictEqual(ex.subjects[1].items[1].unsure, true);
  assert.strictEqual(ex.subjects[1].items[1].number, '2');           // poziția rămâne
  // I.6 rămâne Adevărat/Fals, punctajele EN rămân 5p/(2p+3p)
  assert.strictEqual(ex.subjects[0].items[5].options.length, 2);
  assert.strictEqual(ex.subjects[2].items[0].parts[1].points, 3);
});

test('verifyAndRepairExam: eroare structurală per item (3 variante) → regenerare țintită înainte de verificator', async () => {
  fakeFetch((body) => {
    const u = userText(body);
    if (isVerify(body)) return /Adevărat sau Fals/.test(u) ? vAnswer('Adevărat', 'a') : vAnswer('ok', 'b');
    const old = JSON.parse(/ITEMUL VECHI \(de înlocuit\):\n([\s\S]*?)\n\nScrie/.exec(u)[1]);
    return JSON.stringify({ item: { ...old, options: ['1', '2', '3', '4'], answer: 'b', statement: 'Item reparat: calculați $1+1$ și alegeți varianta corectă.' } });
  });
  const ex = enExam();
  ex.subjects[0].items[0].options = ['1', '2', '3'];
  const report = await exam.verifyAndRepairExam(ex, { examType: 'evaluare-nationala', model: 'm', supa: null, userId: null });
  assert.strictEqual(report.regenerated, 1);
  assert.deepStrictEqual(report.errors, []);
  assert.strictEqual(ex.subjects[0].items[0].options.length, 4);
});

test('verifyAndRepairExam: nu aruncă niciodată — la provider căzut, testul pleacă cu avertisment', async () => {
  fakeFetch(() => ({ status: 500, body: 'down' }));
  const ex = enExam();
  ex.subjects[0].items[5].answer = 'a';
  const report = await exam.verifyAndRepairExam(ex, { examType: 'evaluare-nationala', model: 'm', supa: null, userId: null });
  assert.strictEqual(report.validated, true);
  assert.strictEqual(report.disagreed, 0);
  assert.strictEqual(ex.subjects.length, 3);
});

// ─── 1.4: modelul pe moduri + reasoning_effort ──────────────────────────────
test('chatModelFor: PDF deschis → PDF_MODEL; tutor/explain/hint → TUTOR_MODEL; assistant/exams → CHAT_MODEL', () => {
  assert.strictEqual(ai.chatModelFor('tutor', { pdf: true }), ai.PDF_MODEL);
  assert.strictEqual(ai.chatModelFor('tutor'), ai.TUTOR_MODEL);
  assert.strictEqual(ai.chatModelFor('hint', {}), ai.TUTOR_MODEL);
  assert.strictEqual(ai.chatModelFor('explain', null), ai.TUTOR_MODEL);
  assert.strictEqual(ai.chatModelFor('assistant'), ai.CHAT_MODEL);
  assert.strictEqual(ai.chatModelFor('exams'), ai.CHAT_MODEL);
  assert.ok(ai.TUTOR_MODES.has('tutor') && !ai.TUTOR_MODES.has('assistant'));
});

test('buildBody: reasoning_effort doar la modelele cu raționament; valorile necunoscute sunt ignorate; providerul îl poate refuza', () => {
  const msgs = [{ role: 'user', content: 'x' }];
  const b1 = ai.buildBody({ model: 'gpt-5-mini', temperature: 0.3, maxTokens: 900, messages: msgs, reasoningEffort: 'low' });
  assert.strictEqual(b1.reasoning_effort, 'low');
  assert.strictEqual(b1.temperature, undefined);
  assert.strictEqual(b1.max_completion_tokens, 3000);
  const b2 = ai.buildBody({ model: 'gpt-4o-mini', temperature: 0.3, maxTokens: 900, messages: msgs, reasoningEffort: 'low' });
  assert.strictEqual(b2.reasoning_effort, undefined);
  assert.strictEqual(b2.temperature, 0.3);
  const b3 = ai.buildBody({ model: 'gpt-5-mini', temperature: 0.3, maxTokens: 900, messages: msgs, reasoningEffort: 'turbo' });
  assert.strictEqual(b3.reasoning_effort, undefined);
  assert.strictEqual(ai.adaptBodyToError(b1, 'Unsupported parameter: reasoning_effort'), true);
  assert.strictEqual(b1.reasoning_effort, undefined);
});

test('chat: reasoningEffort per apel ajunge în corpul cererii (model cu raționament)', async () => {
  const calls = fakeFetch(() => 'răspuns');
  const r = await ai.chat({ system: 's', messages: [{ role: 'user', content: 'u' }], model: 'gpt-5-mini', reasoningEffort: 'minimal' });
  assert.strictEqual(r.text, 'răspuns');
  assert.strictEqual(calls[0].reasoning_effort, 'minimal');
});
