// Teste pentru lecțiile live scrise DOAR de Claude Opus 5.5 (api/_lib/liveLesson.js →
// writeJson / generateScript / completeScript, api/live.js → Admin, costul pe model,
// completarea itemilor lipsă): paginile PDF ajung la Claude ca documente, schema strictă e
// aceeași, verificările pe barem rămân; o bucată la care Claude nu răspunde se reîncearcă tot
// cu Claude (rezerva — doar cu LIVE_REZERVA_MODEL); fără cheie → eroare clară; un răspuns
// tăiat își păstrează itemii întregi; itemii care LIPSESC față de structura subiectului
// (ex. „Subiectul III, 1 b) și c)") se scriu separat, câte unul — la scriere și, pentru
// lecțiile deja scrise, din Admin („🧩 Completează itemii lipsă"), fără să atingă restul.
// Fără rețea: modelele și Supabase sunt înlocuite.
// o cheie de test ÎNAINTE de require (claude.js o citește la încărcare); fără rețea:
// fetch-ul e înlocuit acolo unde contează
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const claude = require('../api/_lib/claude');
const live = require('../api/_lib/live');
const LL = require('../api/_lib/liveLesson');
const pdf = require('../api/ai-pdf-context');

process.env.LIVE_INTREBARI_PASI = '0';   // întrebările pe pași: doar în testul lor (pornite acolo)
process.env.LIVE_CLAUDE_PAUZA_MS = '0';  // fără pauze reale la 429
delete process.env.LIVE_ITEMI_PE_APEL;
delete process.env.AZURE_SPEECH_KEY; delete process.env.OPENAI_API_KEY; delete process.env.LIVE_TTS_API_KEY;
delete process.env.SUPABASE_URL; delete process.env.VITE_SUPABASE_URL;

// ─── un subiect de EN cu Subiectele I și II (grile) ───────────────────────────
const SUBJECT = `
SUBIECTUL I (30 de puncte)
5p 1. Rezultatul calculului 2 + 3 · 4 este egal cu:
a) 20 b) 14 c) 24 d) 9
5p 2. Dacă a/3 = 4, atunci a este:
a) 7 b) 1 c) 12 d) 4/3
SUBIECTUL al II-lea (30 de puncte)
5p 1. În figura alăturată ABCD este un pătrat cu latura de 4 cm. Aria pătratului este:
a) 8 cm² b) 16 cm² c) 12 cm² d) 20 cm²
`;
const BAREM = `
BAREM DE EVALUARE ȘI DE NOTARE
SUBIECTUL I (30 de puncte)
Nr. item 1. 2. 3. 4. 5. 6.
Rezultate b. c. a. d. c. b.
Punctaj 5p 5p 5p 5p 5p 5p
SUBIECTUL al II-lea (30 de puncte)
Nr. item 1. 2. 3. 4. 5. 6.
Rezultate b. a. c. d. a. b.
Punctaj 5p 5p 5p 5p 5p 5p
`;
// ─── un subiect de BAC (Științele naturii): I.1–6, II și III cu 2 probleme × a, b, c ──
const SUBJECT_BAC = `Examenul de bacalaureat național 2026 — Matematică M_st-nat
SUBIECTUL I (30 de puncte)
5p 1. Calculați 8/3 − 2(1 − 1/6).
5p 2. Determinați numărul real m.
5p 3. Rezolvați în mulțimea numerelor reale ecuația.
5p 4. Calculați probabilitatea.
5p 5. În reperul cartezian xOy se consideră punctele.
5p 6. Calculați sin 30°.
SUBIECTUL al II-lea (30 de puncte)
1. Se consideră matricea A(x).
5p a) Arătați că det(A(0)) = 1.
5p b) Demonstrați că A(x)A(y) = A(x + y).
5p c) Determinați numerele reale x.
2. Pe mulțimea numerelor reale se definește legea de compoziție x ∘ y = xy − 2x − 2y + 6.
5p a) Arătați că x ∘ y = (x − 2)(y − 2) + 2.
5p b) Determinați elementul neutru.
5p c) Determinați numerele reale x.
SUBIECTUL al III-lea (30 de puncte)
1. Se consideră funcția f: (0, +∞) → R, f(x) = x − ln x.
5p a) Arătați că f'(x) = (x − 1)/x.
5p b) Determinați ecuația tangentei la graficul funcției f în punctul de abscisă x = 1.
5p c) Demonstrați că f(x) ≥ 1, pentru orice x ∈ (0, +∞).
2. Se consideră funcția f: R → R, f(x) = 3x² + 2x.
5p a) Calculați integrala.
5p b) Calculați aria.
5p c) Determinați numărul real a.`;
const BAREM_BAC = SUBJECT_BAC.replace('Examenul de bacalaureat', 'BAREM DE EVALUARE ȘI DE NOTARE — bacalaureat');
const BAC_REFS = ['I.1', 'I.2', 'I.3', 'I.4', 'I.5', 'I.6',
  'II.1.a', 'II.1.b', 'II.1.c', 'II.2.a', 'II.2.b', 'II.2.c', 'III.1.a', 'III.1.b', 'III.1.c', 'III.2.a', 'III.2.b', 'III.2.c'];

const seg = (say, board = []) => ({ say, board });
const rawItem = (ref, extra = {}) => ({
  ref, title: `Item ${ref}`, kind: 'grila', statement: 'Rezultatul calculului $2+3\\cdot 4$ este:', statementTry: null,
  options: ['20', '14', '24', '9'], answer: 'a', points: 5, barem: 'b. 5p',
  intro: [seg('Trecem la exercițiul următor.')],
  tryPoll: { type: 'grila', question: 'Rezultatul calculului?', options: ['20', '14', '24', '9'], answer: 'a', explain: 'Înmulțirea se face întâi.' },
  afterTry: [],
  modes: { barem: [{ say: `Explicația pentru ${ref}: întâi înmulțirea, apoi adunarea.`, board: ['$3\\cdot 4 = 12$', '$2 + 12 = 14$'], ask: null }], intuitiv: [seg('Înmulțirea leagă mai tare decât adunarea.')], greseli: [], alta_metoda: null },
  check: null, afterCheck: [],
  ...extra,
});
const textOf = (content) => (typeof content === 'string' ? content : content.find((b) => b.type === 'text').text);
// ce cere un apel: o bucată („Explică itemii 4–6 din SUBIECTUL I") sau itemi anume
// („Explică DOAR itemul III.1.b (problema 1, cerința b) din SUBIECTUL III")
function reqOf(args) {
  const t = textOf(args.messages[0].content);
  let m = /Explică itemii (\d+)–(\d+) din SUBIECTUL (I{1,3})\b/.exec(t);
  if (m) {
    const sec = m[3], from = +m[1], to = +m[2];
    const bac = /problema 1 \(a, b, c\)/.test(t);
    const refs = [];
    for (let k = from; k <= to; k++) refs.push(bac ? `${sec}.${Math.ceil(k / 3)}.${'abc'[(k - 1) % 3]}` : `${sec}.${k}`);
    return { sec, from, refs, key: `${sec}.${from}` };
  }
  m = /Explică DOAR (?:itemul|itemii) (.+?) din SUBIECTUL (I{1,3})\b/.exec(t);
  const refs = m[1].match(/\bI{1,3}\.\d(?:\.[a-d])?/g);
  return { sec: m[2], refs, key: `doar:${refs.join(',')}`, fill: true };
}
const itemsFor = (req, extra = {}) => req.refs.map((ref) => rawItem(ref, extra));

const claudeOk = (args, extra = {}) => ({
  text: JSON.stringify({ items: itemsFor(reqOf(args), extra) }),
  usage: { prompt_tokens: 1000, completion_tokens: 500, model: args.model }, provider: args.model, stopReason: 'end_turn',
});
const terraOk = (args) => ({ data: { items: itemsFor(reqOf(args)) }, usage: { in: 800, out: 400, model: args.model } });

// înlocuiește Claude și Terra pe durata unui test; seen = apelurile primite
function stub({ claudeFn, openaiFn, key = true }) {
  const orig = { chatClaude: claude.chatClaude, HAS_KEY: claude.HAS_KEY, chatJson: ai.chatJson };
  const seen = { claude: [], openai: [] };
  claude.HAS_KEY = key;
  claude.chatClaude = async (args) => { seen.claude.push(args); return claudeFn(args, seen); };
  ai.chatJson = async (args) => { seen.openai.push(args); return openaiFn(args, seen); };
  const restore = () => {
    claude.chatClaude = orig.chatClaude; claude.HAS_KEY = orig.HAS_KEY;
    ai.chatJson = orig.chatJson;
  };
  return { seen, restore };
}
const never = (who) => () => { throw new Error(`${who} nu trebuia chemat`); };
const keys = (calls) => calls.map((a) => reqOf(a).key).sort();

const PDF = (name) => ({ type: 'file', file: { filename: name, file_data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name}`).toString('base64')}` } });
const ATT = { I: [PDF('subiect-subiectul-I.pdf'), PDF('barem-subiectul-I.pdf')], II: [PDF('subiect-subiectul-II.pdf')], III: [PDF('subiect-subiectul-III.pdf')] };
const gen = (model, log = () => {}) => LL.generateScript({
  ctx: { text: SUBJECT, baremText: BAREM, baremStatus: 'ok' }, content: { id: 'c1', title: 'EN 2024 Varianta 7' },
  teacher: live.teacherById('radu'), exam: 'en', profile: null, log, attachments: ATT, model,
});
const genBac = (model, log = () => {}) => LL.generateScript({
  ctx: { text: SUBJECT_BAC, baremText: BAREM_BAC, baremStatus: 'ok' }, content: { id: 'c2', title: '2026 științele naturii varianta 02' },
  teacher: live.teacherById('radu'), exam: 'bac', profile: 'stiinte-naturii', log, attachments: ATT, model,
});
const ALL_REFS = ['I.1', 'I.2', 'I.3', 'I.4', 'I.5', 'I.6', 'II.1', 'II.2', 'II.3', 'II.4', 'II.5', 'II.6'];
const CLAUDE_EN_CHUNKS = ['I.1', 'I.4', 'II.1', 'II.3', 'II.5'];   // I: câte 3; II–III: câte 2

test('doar Claude Opus 5.5 scrie lecțiile; fără rezervă implicită; LIVE_GEN_MODEL / LIVE_REZERVA_MODEL doar la nevoie', () => {
  assert.strictEqual(LL.GEN_MODEL(), 'claude-opus-5-5');
  assert.strictEqual(LL.FALLBACK_MODEL(), null, 'fără Terra ca rezervă');
  process.env.LIVE_GEN_MODEL = 'gpt-5.6-terra'; process.env.LIVE_REZERVA_MODEL = 'gpt-5.6-terra';
  try { assert.strictEqual(LL.GEN_MODEL(), 'gpt-5.6-terra'); assert.strictEqual(LL.FALLBACK_MODEL(), 'gpt-5.6-terra'); }
  finally { delete process.env.LIVE_GEN_MODEL; delete process.env.LIVE_REZERVA_MODEL; }
  assert.ok(LL.isClaude('claude-opus-5-5'));
  assert.ok(!LL.isClaude('anthropic/claude-opus-5-5'), 'furnizorii compatibili OpenAI rămân pe ai.chatJson');
  assert.ok(!LL.isClaude('gpt-5.6-terra'));
});

test('paginile PDF pentru Anthropic: blocuri „document" înaintea textului; fără pagini → doar textul', () => {
  const c = LL.anthropicContent('Explică itemii', [PDF('subiect-subiectul-I.pdf'), null, { type: 'text', text: 'x' }]);
  assert.strictEqual(c.length, 2);
  assert.deepStrictEqual(c[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.4 subiect-subiectul-I.pdf').toString('base64') }, title: 'subiect-subiectul-I.pdf' });
  assert.deepStrictEqual(c[1], { type: 'text', text: 'Explică itemii' });
  assert.strictEqual(LL.anthropicContent('doar text', []), 'doar text');
});

test('structura subiectului: exercițiile și cerințele a), b), c) din text; bucățile lui Claude (II–III câte 2)', () => {
  const sections = { subject: LL.sectionMap(SUBJECT_BAC), barem: LL.sectionMap(BAREM_BAC) };
  assert.deepStrictEqual(LL.expectedRefs('bac', sections), BAC_REFS);
  // o secțiune fără barem nu se cere
  assert.deepStrictEqual(LL.expectedRefs('bac', { subject: sections.subject, barem: { I: sections.barem.I } }), BAC_REFS.slice(0, 6));
  // EN: textul are doar 2 exerciții la S. I → structura oficială (1–6)
  const en = { subject: LL.sectionMap(SUBJECT), barem: LL.sectionMap(BAREM) };
  assert.deepStrictEqual(LL.expectedRefs('en', en), ALL_REFS);
  // ce lipsește: un item „III.1" care le ia pe toate le acoperă; „III.1.a" acoperă „III.1" la EN
  const have = BAC_REFS.filter((r) => !['III.1.b', 'III.1.c'].includes(r)).map((ref) => ({ ref }));
  assert.deepStrictEqual(LL.missingOf(BAC_REFS, have), ['III.1.b', 'III.1.c']);
  assert.deepStrictEqual(LL.missingOf(['III.1.a', 'III.1.b'], [{ ref: 'III.1' }]), []);
  assert.deepStrictEqual(LL.missingOf(['III.1', 'III.2'], [{ ref: 'III.1.a' }]), ['III.2']);
  // fără textul subiectului (lecțiile deja scrise): structura oficială, pe secțiunile prezente
  assert.deepStrictEqual(LL.missingGuess({ exam: 'bac', items: have.map((it) => ({ ...it, section: it.ref.split('.')[0] })) }), ['III.1.b', 'III.1.c']);
  // bucățile: Claude câte 2 la II–III (3 depășeau uneori 16.000 de tokeni), Terra câte 3
  const plan = (model) => LL.callPlan('bac', sections, (s) => LL.chunkSize(model, s)).map((p) => `${p.section}.${p.from}-${p.to}`);
  assert.deepStrictEqual(plan('claude-opus-5-5'), ['I.1-3', 'I.4-6', 'II.1-2', 'II.3-4', 'II.5-6', 'III.1-2', 'III.3-4', 'III.5-6']);
  assert.deepStrictEqual(plan('gpt-5.6-terra'), ['I.1-3', 'I.4-6', 'II.1-3', 'II.4-6', 'III.1-3', 'III.4-6']);
  process.env.LIVE_ITEMI_PE_APEL = '3';
  try { assert.deepStrictEqual(plan('claude-opus-5-5'), plan('gpt-5.6-terra'), 'LIVE_ITEMI_PE_APEL are întâietate'); } finally { delete process.env.LIVE_ITEMI_PE_APEL; }
});

test('Claude Opus 5.5 scrie lecția: paginile ca documente, aceeași schemă strictă, literele grilelor tot din barem', async () => {
  const s = stub({ claudeFn: (a) => claudeOk(a), openaiFn: never('Terra') });
  try {
    const r = await gen('claude-opus-5-5');
    assert.deepStrictEqual(keys(s.seen.claude), CLAUDE_EN_CHUNKS);
    for (const a of s.seen.claude) {
      assert.strictEqual(a.model, 'claude-opus-5-5');
      assert.strictEqual(a.schema, LL.SCHEMA, 'aceeași schemă ca la Terra');
      assert.match(a.system, /DOAR pe baza baremului oficial/);
      assert.ok(a.system.includes(`FORMATUL RĂSPUNSULUI: un singur obiect JSON, exact după schema de mai jos (fără alt text, fără markdown):\n${JSON.stringify(LL.SCHEMA)}`), 'formatul și în instrucțiuni (pentru reîncercarea fără schemă)');
    }
    const secI = s.seen.claude.find((a) => reqOf(a).sec === 'I');
    const content = secI.messages[0].content;
    assert.deepStrictEqual(content.map((b) => b.type), ['document', 'document', 'text'], 'subiectul și baremul secțiunii, apoi cererea');
    assert.strictEqual(content[1].title, 'barem-subiectul-I.pdf');
    assert.match(content[2].text, /PAGINILE PDF ale subiectului și ale baremului/);
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), ALL_REFS);
    // modelul a zis „a" peste tot; baremul are ultimul cuvânt
    assert.strictEqual(r.script.items.find((it) => it.ref === 'I.2').tryPoll.answer, 'c');
    assert.strictEqual(r.script.items.find((it) => it.ref === 'II.1').tryPoll.answer, 'b');
    assert.deepStrictEqual(r.script.writer, { model: 'claude-opus-5-5', parts: { 'claude-opus-5-5': 5 }, notes: [] });
    assert.deepStrictEqual(r.script.missing, []);
    assert.deepStrictEqual(LL.usageParts(r.usage), [{ in: 5000, out: 2500, model: 'claude-opus-5-5' }]);
  } finally { s.restore(); }
});

test('cererea HTTP către Anthropic: documentele PDF, schema (output_config), fără gândire și fără temperatură', async () => {
  const origFetch = global.fetch;
  const bodies = [];
  global.fetch = async (url, opts) => {
    assert.strictEqual(url, 'https://api.anthropic.com/v1/messages');
    assert.strictEqual(opts.headers['x-api-key'], 'sk-ant-test');
    const body = JSON.parse(opts.body);
    bodies.push(body);
    const items = itemsFor(reqOf(body));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ items }) }], stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 700 } }) };
  };
  const origChat = ai.chatJson;
  ai.chatJson = never('Terra');
  try {
    const r = await gen('claude-opus-5-5');
    assert.strictEqual(bodies.length, 5);
    const b = bodies.find((x) => reqOf(x).sec === 'I');
    assert.strictEqual(b.model, 'claude-opus-5-5');
    assert.strictEqual(b.max_tokens, 16000);
    assert.deepStrictEqual(b.thinking, { type: 'disabled' });
    assert.deepStrictEqual(b.output_config, { format: { type: 'json_schema', schema: LL.SCHEMA } });
    assert.ok(!('temperature' in b));
    assert.deepStrictEqual(b.messages.map((m) => m.role), ['user']);
    assert.deepStrictEqual(b.messages[0].content.map((c) => c.type), ['document', 'document', 'text']);
    assert.deepStrictEqual(b.messages[0].content[0].source, { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.4 subiect-subiectul-I.pdf').toString('base64') });
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), ALL_REFS);
    assert.deepStrictEqual(r.script.writer.parts, { 'claude-opus-5-5': 5 });
    assert.deepStrictEqual(LL.usageParts(r.usage), [{ in: 10000, out: 3500, model: 'claude-opus-5-5' }]);
  } finally { global.fetch = origFetch; ai.chatJson = origChat; }
});

test('LIVE_GEN_MODEL=gpt-5.6-terra (doar la nevoie): Terra scrie, ca înainte (bucăți de câte 3) — Claude nu e chemat', async () => {
  const s = stub({ claudeFn: never('Claude'), openaiFn: terraOk });
  process.env.LIVE_GEN_MODEL = 'gpt-5.6-terra';
  try {
    const r = await gen(null);
    assert.deepStrictEqual(keys(s.seen.openai), ['I.1', 'I.4', 'II.1', 'II.4']);
    assert.ok(s.seen.openai.every((a) => a.model === 'gpt-5.6-terra' && a.schema === LL.SCHEMA && a.schemaName === 'lectie_live'));
    // paginile merg ca părți „file" (formatul OpenAI), după text
    const secI = s.seen.openai.find((a) => reqOf(a).sec === 'I');
    assert.deepStrictEqual(secI.messages[0].content.map((b) => b.type), ['text', 'file', 'file']);
    assert.deepStrictEqual(r.script.writer, { model: 'gpt-5.6-terra', parts: { 'gpt-5.6-terra': 4 }, notes: [] });
    assert.deepStrictEqual(LL.usageParts(r.usage), [{ in: 3200, out: 1600, model: 'gpt-5.6-terra' }]);
  } finally { s.restore(); delete process.env.LIVE_GEN_MODEL; }
});

test('fără ANTHROPIC_API_KEY: nicio lecție scrisă de alt model — eroare clară (Admin); cu LIVE_REZERVA_MODEL o scrie rezerva', async () => {
  let s = stub({ key: false, claudeFn: never('Claude'), openaiFn: never('Terra') });
  try {
    await assert.rejects(gen(null), (e) => e.code === 'NO_ANTHROPIC_KEY' && /ANTHROPIC_API_KEY lipsește/.test(e.message));
    assert.strictEqual(s.seen.openai.length, 0);
  } finally { s.restore(); }
  s = stub({ key: false, claudeFn: never('Claude'), openaiFn: terraOk });
  process.env.LIVE_REZERVA_MODEL = 'gpt-5.6-terra';
  const logs = [];
  try {
    const r = await gen(null, (m) => logs.push(m));
    assert.deepStrictEqual(keys(s.seen.openai), ['I.1', 'I.4', 'II.1', 'II.4'], 'în bucățile rezervei, de câte 3');
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), ALL_REFS);
    assert.deepStrictEqual(r.script.writer.parts, { 'gpt-5.6-terra': 4 });
    assert.ok(r.script.writer.notes.some((l) => /ANTHROPIC_API_KEY lipsește/.test(l)));
  } finally { s.restore(); delete process.env.LIVE_REZERVA_MODEL; }
});

test('pe bucăți, doar cu Claude: eroare → reîncercări, apoi itemii scriși separat; răspuns tăiat → itemii întregi rămân; itemi respinși → rescriși; costul pe model', async () => {
  const s = stub({
    claudeFn: (a) => {
      const q = reqOf(a);
      if (q.key === 'I.4') { const e = new Error('Internal server error'); e.status = 502; throw e; }
      if (q.key === 'II.1') return { text: '{"items":[{"ref":"II.1","title":"Sub', usage: { prompt_tokens: 1000, completion_tokens: 16000, model: a.model }, stopReason: 'max_tokens' };
      if (q.key === 'II.3') {   // tăiat în mijlocul lui II.4: II.3 e întreg
        const full = JSON.stringify({ items: itemsFor(q) });
        return { text: full.slice(0, full.indexOf('"ref":"II.4"') + 40), usage: { prompt_tokens: 1000, completion_tokens: 16000, model: a.model }, stopReason: 'max_tokens' };
      }
      if (q.key === 'II.5') return claudeOk(a, { modes: { barem: [], intuitiv: [], greseli: [], alta_metoda: null } });   // fără explicație pe barem → respinși
      return claudeOk(a);
    },
    openaiFn: never('Terra'),
  });
  const logs = [];
  try {
    const r = await gen(null, (m) => logs.push(m));
    const fills = ['doar:I.4', 'doar:I.5', 'doar:I.6', 'doar:II.1', 'doar:II.2', 'doar:II.4', 'doar:II.5', 'doar:II.6'];
    assert.deepStrictEqual(keys(s.seen.claude), [...CLAUDE_EN_CHUNKS, 'I.4', 'I.4', ...fills].sort(), 'I.4: 3 încercări; apoi câte un apel pe item');
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), ALL_REFS, 'lecția e întreagă, toată scrisă de Claude');
    assert.deepStrictEqual(r.script.missing, []);
    assert.deepStrictEqual(r.script.writer.parts, { 'claude-opus-5-5': 10 });
    assert.deepStrictEqual(LL.usageParts(r.usage), [{ in: 12000, out: 37000, model: 'claude-opus-5-5' }]);
    const notes = r.script.writer.notes.join('\n');
    assert.match(notes, /I, itemii 4–6 — claude-opus-5-5 a eșuat \(Internal server error\)/);
    assert.match(notes, /II, itemii 3–4 — răspuns tăiat la 16000 tokeni: păstrez 1 item întreg/);
    assert.match(notes, /lipsesc după prima trecere: I\.4, I\.5, I\.6, II\.1, II\.2, II\.4, II\.5, II\.6 — se scriu separat/);
    assert.ok(logs.length >= r.script.writer.notes.length);
    const fill = s.seen.claude.find((a) => reqOf(a).key === 'doar:II.5');
    assert.match(textOf(fill.messages[0].content), /Explică DOAR itemul II\.5 din SUBIECTUL II — ceilalți itemi sunt deja explicați/);
    assert.strictEqual(fill.messages[0].content[0].type, 'document');
  } finally { s.restore(); }
  // cu o rezervă pusă (LIVE_REZERVA_MODEL): bucata cu eroare o scrie rezerva, direct
  const s2 = stub({ claudeFn: (a) => { if (reqOf(a).key === 'I.4') { const e = new Error('Prompt is too long'); e.status = 502; throw e; } return claudeOk(a); }, openaiFn: terraOk });
  process.env.LIVE_REZERVA_MODEL = 'gpt-5.6-terra';
  try {
    const r = await gen(null);
    assert.deepStrictEqual(keys(s2.seen.openai), ['I.4'], 'o eroare care nu trece cu o pauză: fără reîncercări, direct rezerva');
    assert.deepStrictEqual(r.script.writer.parts, { 'claude-opus-5-5': 4, 'gpt-5.6-terra': 1 });
  } finally { s2.restore(); delete process.env.LIVE_REZERVA_MODEL; }
});

test('BAC: Claude omite III.1 b) și c) → se scriu separat, câte unul; lecția are toți cei 18 itemi', async () => {
  const s = stub({
    claudeFn: (a) => {
      const q = reqOf(a);
      // ca în lecția „2026 științele naturii varianta 02": la Subiectul III, problema 1 doar a)
      const drop = q.fill ? [] : ['III.1.b', 'III.1.c'];
      const items = q.refs.filter((ref) => !drop.includes(ref)).map((ref) => rawItem(ref));
      return { text: JSON.stringify({ items }), usage: { prompt_tokens: 1000, completion_tokens: 500, model: a.model }, stopReason: 'end_turn' };
    },
    openaiFn: never('Terra'),
  });
  try {
    const r = await genBac('claude-opus-5-5');
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), BAC_REFS);
    assert.deepStrictEqual(r.script.missing, []);
    const fills = s.seen.claude.filter((a) => reqOf(a).fill).map((a) => reqOf(a).refs[0]).sort();
    assert.deepStrictEqual(fills, ['III.1.b', 'III.1.c']);
    const one = s.seen.claude.find((a) => reqOf(a).key === 'doar:III.1.b');
    assert.match(textOf(one.messages[0].content), /Explică DOAR itemul III\.1\.b \(problema 1, cerința b\) din SUBIECTUL III/);
    assert.match(r.script.writer.notes.join('\n'), /lipsesc după prima trecere: III\.1\.b, III\.1\.c/);
  } finally { s.restore(); }
  // tot nu vin (modelul nu le găsește) → rămân în script.missing, pentru Admin
  const s2 = stub({
    claudeFn: (a) => {
      const q = reqOf(a);
      const items = q.refs.filter((ref) => !['III.1.b', 'III.1.c'].includes(ref)).map((ref) => rawItem(ref));
      return { text: JSON.stringify({ items }), usage: { prompt_tokens: 10, completion_tokens: 5, model: a.model }, stopReason: 'end_turn' };
    },
    openaiFn: never('Terra'),
  });
  try {
    const r = await genBac('claude-opus-5-5');
    assert.deepStrictEqual(r.script.missing, ['III.1.b', 'III.1.c']);
    assert.strictEqual(r.script.items.length, 16);
    assert.deepStrictEqual(s2.seen.claude.filter((a) => reqOf(a).fill).map((a) => reqOf(a).key).sort(), ['doar:III.1.b', 'doar:III.1.c'], 'câte o încercare pe item, doar Claude');
  } finally { s2.restore(); }
});

test('lecțiile deja scrise: completeScript scrie doar itemii lipsă; ceilalți își păstrează id-urile (vocea, întrebările)', async () => {
  const radu = live.teacherById('radu');
  const sectionsItems = (refs) => LL.normalizeItems(refs.filter((r) => r.startsWith('I.')).map((ref) => rawItem(ref)), { section: 'I', exam: 'bac' })
    .concat(LL.normalizeItems(refs.filter((r) => r.startsWith('II.')).map((ref) => rawItem(ref)), { section: 'II', exam: 'bac' }))
    .concat(LL.normalizeItems(refs.filter((r) => r.startsWith('III.')).map((ref) => rawItem(ref)), { section: 'III', exam: 'bac' }));
  const old = LL.assignIds({ title: '2026 științele naturii varianta 02', exam: 'bac', profile: 'stiinte-naturii', teacher: 'radu', teacherName: radu.name, ...LL.templates(radu, { title: 'x', exam: 'bac' }),
    writer: { model: 'claude-opus-5-5', parts: { 'claude-opus-5-5': 8 } }, items: sectionsItems(BAC_REFS.filter((r) => !['III.1.b', 'III.1.c'].includes(r))) });
  const idsOf = (sc) => Object.fromEntries(sc.items.map((it) => [it.ref, [LL.itemSegments(it).map((x) => x.id).join(','), it.tryPoll?.id]]));
  const before = idsOf(old);
  const s = stub({ claudeFn: (a) => claudeOk(a), openaiFn: never('Terra') });
  try {
    const r = await LL.completeScript({ script: old, ctx: { text: SUBJECT_BAC, baremText: BAREM_BAC }, teacher: radu, attachments: ATT, model: 'claude-opus-5-5', log: () => {} });
    assert.deepStrictEqual(r.report, { asked: ['III.1.b', 'III.1.c'], added: ['III.1.b', 'III.1.c'], missing: [] });
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), BAC_REFS);
    assert.deepStrictEqual(r.script.missing, []);
    const after = idsOf(r.script);
    for (const ref of Object.keys(before)) assert.deepStrictEqual(after[ref], before[ref], `${ref}: aceleași id-uri`);
    for (const ref of ['III.1.b', 'III.1.c']) assert.ok(after[ref][0] && after[ref][1], `${ref}: id-uri noi`);
    assert.deepStrictEqual(r.script.writer.parts, { 'claude-opus-5-5': 10 });
    assert.deepStrictEqual(LL.usageParts(r.usage), [{ in: 2000, out: 1000, model: 'claude-opus-5-5' }]);
    assert.notStrictEqual(r.script, old, 'scriptul vechi nu se modifică');
    assert.strictEqual(old.items.length, 16);
    // nimic de completat → niciun apel
    const n = s.seen.claude.length;
    const again = await LL.completeScript({ script: r.script, ctx: { text: SUBJECT_BAC, baremText: BAREM_BAC }, teacher: radu, model: 'claude-opus-5-5', log: () => {} });
    assert.deepStrictEqual(again.report, { asked: [], added: [], missing: [] });
    assert.strictEqual(s.seen.claude.length, n);
  } finally { s.restore(); }
});

test('429: o pauză și reîncercarea cu Claude; plafonul lunar de cheltuieli → fără reîncercări, lecția nu se scrie (fără rezervă)', async () => {
  // limita pe minut: prima cerere a bucății I.1 e respinsă o dată, apoi merge
  let rejected = false;
  let s = stub({
    claudeFn: (a) => {
      if (reqOf(a).key === 'I.1' && !rejected) { rejected = true; const e = new Error('Number of request tokens has exceeded your per-minute rate limit'); e.status = 429; e.retryAfter = 0; throw e; }
      return claudeOk(a);
    },
    openaiFn: never('Terra'),
  });
  try {
    const r = await gen(null);
    assert.strictEqual(s.seen.claude.length, 6, '5 bucăți + o reîncercare');
    assert.deepStrictEqual(r.script.writer.parts, { 'claude-opus-5-5': 5 });
  } finally { s.restore(); }
  // plafonul lunar (429 fără retry-after): o pauză n-ar ajuta
  s = stub({
    claudeFn: () => { const e = new Error('You have reached your API usage limits: your organization has crossed its monthly API usage threshold'); e.status = 429; throw e; },
    openaiFn: never('Terra'),
  });
  try {
    await assert.rejects(gen(null), (e) => e.code === 'SCRIPT_FAIL');
    assert.strictEqual(s.seen.claude.length, 5 + 12, 'câte o încercare pe bucată, apoi pe fiecare item — fără reîncercări');
  } finally { s.restore(); }
});

test('LaTeX-ul stricat de JSON („\\frac" cu un singur backslash = escape \\f) se repară și la Claude', async () => {
  const s = stub({
    claudeFn: (a) => {
      const r = claudeOk(a, { statement: 'Calculați $\\frac{1}{2} + \\frac{1}{4}$.' });
      return { ...r, text: r.text.split('\\\\frac').join('\\frac') };   // cum greșesc uneori modelele
    },
    openaiFn: never('Terra'),
  });
  try {
    const r = await gen('claude-opus-5-5');
    const st = r.script.items[0].statement;
    assert.ok(st.includes('\\frac{1}{2} + \\frac{1}{4}'), st);
    assert.ok(!st.includes('\f'));
  } finally { s.restore(); }
});

test('formulele pe care KaTeX nu le poate afișa se repară la scriere (paranteza înaltă citită ca matrice)', async () => {
  const bad = 'Calculați $\\frac{8}{3}-2\\begin{pmatrix}1-\\frac{1}{6}\\right)$.';
  const s = stub({ claudeFn: (a) => claudeOk(a, { statement: bad, modes: { barem: [{ say: 'Calculăm paranteza.', board: ['$2\\begin{pmatrix}1-\\frac{1}{6}\\right) = \\frac{5}{3}$'], ask: null }], intuitiv: [], greseli: [], alta_metoda: null } }), openaiFn: never('Terra') });
  try {
    const r = await gen('claude-opus-5-5');
    const it = r.script.items[0];
    assert.strictEqual(it.statement, 'Calculați $\\frac{8}{3}-2\\left(1-\\frac{1}{6}\\right)$.');
    assert.strictEqual(it.modes.barem[0].board[0], '$2\\left(1-\\frac{1}{6}\\right) = \\frac{5}{3}$');
  } finally { s.restore(); }
});

test('o formulă care nu se poate afișa nici după reparare → itemul se rescrie o dată, separat (dacă rescrierea nu vine, rămâne cel vechi)', async () => {
  const BAD = 'Calculați $\\comandanecunoscuta{x}+1$.';
  let s = stub({
    claudeFn: (a) => {
      const q = reqOf(a);
      if (!q.fill && q.key === 'I.1') return { text: JSON.stringify({ items: q.refs.map((ref) => rawItem(ref, ref === 'I.2' ? { statement: BAD } : {})) }), usage: { prompt_tokens: 1000, completion_tokens: 500, model: a.model }, stopReason: 'end_turn' };
      return claudeOk(a);
    },
    openaiFn: never('Terra'),
  });
  try {
    const r = await gen(null);
    assert.deepStrictEqual(s.seen.claude.filter((a) => reqOf(a).fill).map((a) => reqOf(a).key), ['doar:I.2']);
    assert.strictEqual(r.script.items.find((it) => it.ref === 'I.2').statement, 'Rezultatul calculului $2+3\\cdot 4$ este:', 'varianta rescrisă');
    assert.match(r.script.writer.notes.join('\n'), /formule care nu se pot afișa \(I\.2\) — itemii se rescriu/);
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), ALL_REFS);
  } finally { s.restore(); }
  // rescrierea nu vine → rămâne itemul vechi (formula apare ca text simplu în sală)
  s = stub({
    claudeFn: (a) => {
      const q = reqOf(a);
      if (q.fill) return { text: '{"items":[]}', usage: { prompt_tokens: 10, completion_tokens: 5, model: a.model }, stopReason: 'end_turn' };
      return { text: JSON.stringify({ items: q.refs.map((ref) => rawItem(ref, ref === 'I.2' ? { statement: BAD } : {})) }), usage: { prompt_tokens: 10, completion_tokens: 5, model: a.model }, stopReason: 'end_turn' };
    },
    openaiFn: never('Terra'),
  });
  try {
    const r = await gen(null);
    assert.strictEqual(r.script.items.find((it) => it.ref === 'I.2').statement, BAD);
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), ALL_REFS);
  } finally { s.restore(); }
});

test('întrebările pe pași: tot Claude Opus 5.5, fără pagini PDF; Claude cade → pașii din barem', async () => {
  process.env.LIVE_INTREBARI_PASI = '1';
  const item = {
    ref: 'III.1', section: 'III', title: 'Subiectul III, exercițiul 1', kind: 'rezolvare',
    statement: 'Se consideră expresia $E(x) = (x+1)^2 - x(x+2)$. Calculați $E(5)$.', statementTry: null, options: null, answer: '1', points: 5, barem: 'E(5) = 36 - 35 = 1',
    intro: [seg('Trecem la Subiectul al treilea.')], tryPoll: null, afterTry: [],
    modes: { barem: [seg('Înlocuim x cu cinci.', ['$E(5) = 6^2 - 5 \\cdot 7$']), seg('Calculăm.', ['$E(5) = 36 - 35 = 1$'])], intuitiv: [], greseli: [], alta_metoda: [] },
    check: null, afterCheck: [], steps: [],
  };
  const script = { title: 'EN 2024 Varianta 7', exam: 'en', profile: null, items: [item] };
  const reply = { items: [{ ref: 'III.1', steps: [{ before: 2, type: 'completare', question: 'Cât este $6^2 - 5 \\cdot 7$?', options: null, answer: '1', hint: 'Calculați întâi pătratul și produsul.', explain: 'Din barem: 36 − 35.', say: 'Înainte să scriu, încercați voi: cât face?' }] }] };
  let s = stub({ claudeFn: (a) => ({ text: JSON.stringify(reply), usage: { prompt_tokens: 300, completion_tokens: 100, model: a.model }, stopReason: 'end_turn' }), openaiFn: never('Terra') });
  try {
    const r = await LL.addStepQuestions({ script, teacher: live.teacherById('radu'), log: () => {}, model: 'claude-opus-5-5' });
    assert.strictEqual(s.seen.claude.length, 1);
    assert.strictEqual(s.seen.claude[0].schema, LL.STEP_FIX_SCHEMA);
    assert.strictEqual(typeof s.seen.claude[0].messages[0].content, 'string', 'fără pagini PDF');
    assert.deepStrictEqual(LL.usageParts(r.usage), [{ in: 300, out: 100, model: 'claude-opus-5-5' }]);
    assert.strictEqual(r.report.ai + r.report.fromBarem >= 1, true);
  } finally { s.restore(); }
  // Claude supraîncărcat → reîncercări; tot nu → întrebările din barem (fără alt model)
  s = stub({ claudeFn: () => { const e = new Error('Overloaded'); e.status = 502; throw e; }, openaiFn: never('Terra') });
  try {
    const r = await LL.addStepQuestions({ script, teacher: live.teacherById('radu'), log: () => {}, model: 'claude-opus-5-5' });
    assert.strictEqual(s.seen.claude.length, 3, 'supraîncărcat: trei încercări');
    assert.strictEqual(r.report.aiFailed, 1);
    assert.ok(r.report.fromBarem >= 1, 'pașii din barem');
    assert.deepStrictEqual([r.usage.in, r.usage.out], [0, 0], 'nimic de plătit');
  } finally { s.restore(); process.env.LIVE_INTREBARI_PASI = '0'; }
});

// ─── api/live.js: alegerea din Admin, lacătul, costul pe model, itemii lipsă ──
const U = { free: '11111111-1111-4111-8111-111111111111', admin: '33333333-3333-4333-8333-333333333333' };
const EN1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const BAC1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const BAREM_TEXT = 'BAREM DE EVALUARE ȘI DE NOTARE. SUBIECTUL I. Rezultate: 1. b 2. c 3. a. Se punctează orice modalitate corectă de rezolvare.';
function seed() {
  return {
    profiles: [
      { id: U.free, full_name: 'Ioana Popescu', email: 'ioana@example.com', subscription_status: null, role: 'elev', is_admin: false },
      { id: U.admin, full_name: 'Radu Costea', email: 'radu@example.com', subscription_status: null, role: 'admin', is_admin: true },
    ],
    content: [
      { id: EN1, title: 'EN 2024 Varianta 7', category: 'evaluare-nationala', subcategory: null, profile: null, content_type: 'pdf', file_url: `https://x/${EN1}.pdf`, is_free: true, created_at: '2026-01-01T00:00:00Z' },
      { id: BAC1, title: '2026 științele naturii varianta 02', category: 'bacalaureat', subcategory: null, profile: 'stiinte-naturii', content_type: 'pdf', file_url: `https://x/${BAC1}.pdf`, is_free: true, created_at: '2026-01-01T00:00:00Z' },
    ],
    ai_pdf_text: [
      { content_id: EN1, barem_status: 'ok', barem: { title: 'Barem' }, barem_text: BAREM_TEXT, text: 'SUBIECTUL I ...' },
      { content_id: BAC1, barem_status: 'ok', barem: { title: 'Barem' }, barem_text: BAREM_BAC, text: SUBJECT_BAC },
    ],
    app_settings: [{ key: 'live_free_lessons', value: { subjects: [] } }],
  };
}
function lessonScript(writer) {
  const radu = live.teacherById('radu');
  const B2 = 'SUBIECTUL I (30 de puncte)\nNr. item 1. 2.\nRezultate b. b.\nPunctaj 5p 5p\n';
  const items = LL.normalizeItems([rawItem('I.1'), rawItem('I.2')], { section: 'I', exam: 'en', grile: { I: { 1: 'b', 2: 'b' } }, baremText: B2 });
  return LL.assignIds({ title: 'EN 2024 Varianta 7', exam: 'en', pasi: LL.PASI_V, teacher: 'radu', teacherName: radu.name, writer, missing: [], ...LL.templates(radu, { title: 'EN 2024 Varianta 7', exam: 'en' }), items });
}
function harness() {
  const handler = require('../api/live');
  const fake = createFakeSupabase(seed());
  const used = [];
  const orig = { admin: ai.admin, authUser: ai.authUser, logUsage: ai.logUsage, gen: LL.generateScript, ctx: pdf.getPdfContext, dl: pdf.downloadContentPdf };
  ai.admin = () => fake;
  ai.authUser = async (req) => { const u = req.headers['x-user']; if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; } return u; };
  ai.logUsage = async (supa, userId, endpoint, usage) => { used.push({ endpoint, model: usage.model, in: usage.in, out: usage.out }); };
  pdf.getPdfContext = async (supa, content) => (content.id === BAC1
    ? { text: SUBJECT_BAC, baremText: BAREM_BAC, baremStatus: 'ok' }
    : { text: 'SUBIECTUL I', baremText: BAREM_TEXT, baremStatus: 'ok' });
  pdf.downloadContentPdf = async () => { throw new Error('fără rețea în teste'); };
  const call = async (action, body = {}, user = null) => {
    const res = fakeRes();
    await handler({ method: 'POST', headers: user ? { 'x-user': user } : {}, query: {}, body: { action, ...body } }, res);
    return res;
  };
  const restore = () => {
    Object.assign(ai, { admin: orig.admin, authUser: orig.authUser, logUsage: orig.logUsage });
    LL.generateScript = orig.gen; pdf.getPdfContext = orig.ctx; pdf.downloadContentPdf = orig.dl;
  };
  return { fake, used, call, restore };
}

test('Admin: lecțiile le scrie Claude Opus 5.5 (fără alegere); costul și ai_usage pe model; lacătul în timpul scrisului', async () => {
  const h = harness();
  const { fake, used, call } = h;
  const genCalls = [];
  let fail = null;
  LL.generateScript = async (args) => {
    const row = fake.db.tables.live_lessons.find((l) => l.subject_id === EN1 && l.status === 'nou');
    genCalls.push({ model: args.model || LL.GEN_MODEL(), lockMin: (new Date(row.locked_until).getTime() - Date.now()) / 60000 });
    const usage = { in: 1e6, out: 1e6, model: LL.GEN_MODEL(), byModel: { 'claude-opus-5-5': { in: 1e6, out: 0 }, 'gpt-5.6-terra': { in: 0, out: 1e6 } } };
    if (fail) { const e = new Error(fail); e.code = 'SCRIPT_FAIL'; e.usage = usage; throw e; }
    return { script: lessonScript({ model: LL.GEN_MODEL(), parts: { 'claude-opus-5-5': 5, 'gpt-5.6-terra': 1 } }), usage };
  };
  try {
    let ov = await call('admin_overview', {}, U.admin);
    assert.strictEqual(ov.statusCode, 200, JSON.stringify(ov.body));
    assert.deepStrictEqual(ov.body.writer, { model: 'claude-opus-5-5', fallback: null, claudeKey: true });
    // alegerea modelului nu mai există
    assert.strictEqual((await call('admin_set_writer', { model: 'gpt-5.6-terra' }, U.admin)).statusCode, 400);

    // lecția nouă: scrisă de Opus; lacătul ține cât poate trăi funcția, apoi se eliberează
    const prep = await call('admin_prepare', { subjectId: EN1, teacher: 'radu' }, U.admin);
    assert.strictEqual(prep.statusCode, 200, JSON.stringify(prep.body));
    assert.strictEqual(prep.body.lesson.status, 'gata');
    assert.strictEqual(genCalls.length, 1);
    assert.strictEqual(genCalls[0].model, 'claude-opus-5-5');
    assert.ok(genCalls[0].lockMin > 13, `lacătul în timpul scrisului: ${genCalls[0].lockMin} min`);
    const row = fake.db.tables.live_lessons.find((l) => l.subject_id === EN1);
    assert.strictEqual(row.locked_until, null, 'lacătul se eliberează');
    // costul: fiecare model la prețul lui
    const want = ai.costMicroLei('claude-opus-5-5', { in: 1e6, out: 0 }) + ai.costMicroLei('gpt-5.6-terra', { in: 0, out: 1e6 });
    assert.strictEqual(row.cost_micro, want);
    assert.deepStrictEqual(used, [
      { endpoint: 'live-lectie', model: 'claude-opus-5-5', in: 1e6, out: 0 },
      { endpoint: 'live-lectie', model: 'gpt-5.6-terra', in: 0, out: 1e6 },
    ]);
    ov = await call('admin_overview', {}, U.admin);
    const l = ov.body.lessons.find((x) => x.subject_id === EN1);
    assert.deepStrictEqual(l.writer, { model: 'claude-opus-5-5', parts: { 'claude-opus-5-5': 5, 'gpt-5.6-terra': 1 } });
    assert.deepStrictEqual(l.missing, []);

    // o încercare eșuată: tokenii consumați ajung totuși în ai_usage
    used.length = 0;
    fail = 'Lecția nu s-a putut pregăti (1 itemi explicați).';
    const bad = await call('admin_prepare', { subjectId: EN1, teacher: 'radu', regenerate: true }, U.admin);
    assert.strictEqual(bad.statusCode, 200, JSON.stringify(bad.body));
    assert.strictEqual(bad.body.lesson.status, 'eroare');
    assert.deepStrictEqual(used.map((u) => u.model), ['claude-opus-5-5', 'gpt-5.6-terra']);
  } finally { h.restore(); }
});

test('Admin → „🧩 Completează itemii lipsă": lecția gata primește doar III.1 b) și c), scriși de Opus; restul rămâne', async () => {
  const h = harness();
  const { fake, used, call } = h;
  const radu = live.teacherById('radu');
  const have = BAC_REFS.filter((r) => !['III.1.b', 'III.1.c'].includes(r));
  const items = ['I', 'II', 'III'].flatMap((S) => LL.normalizeItems(have.filter((r) => r.split('.')[0] === S).map((ref) => rawItem(ref)), { section: S, exam: 'bac' }));
  const script = LL.assignIds({ title: '2026 științele naturii varianta 02', exam: 'bac', profile: 'stiinte-naturii', pasi: LL.PASI_V, teacher: 'radu', teacherName: radu.name, ...LL.templates(radu, { title: 'x', exam: 'bac', profile: 'stiinte-naturii' }),
    writer: { model: 'claude-opus-5-5', parts: { 'claude-opus-5-5': 8 } }, items });
  const lesson = { id: 'dddddddd-0000-4000-8000-0000000000aa', subject_id: BAC1, teacher: 'radu', version: 1, status: 'gata', title: script.title, exam: 'bac', profile: 'stiinte-naturii', script,
    progress: { audio: {}, noVoice: true, total: LL.segmentsInOrder(script).length, done: 0 }, cost_micro: 1000, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  fake.db.tables.live_lessons = [lesson];
  const s = stub({ claudeFn: (a) => claudeOk(a), openaiFn: never('Terra') });
  try {
    // „Scriptul": ce PARE să lipsească (fără textul subiectului)
    const sc = await call('admin_lesson', { lessonId: lesson.id }, U.admin);
    assert.strictEqual(sc.statusCode, 200, JSON.stringify(sc.body));
    assert.deepStrictEqual(sc.body.lesson.missing, ['III.1.b', 'III.1.c']);
    assert.strictEqual(sc.body.lesson.missingChecked, false);
    // doar adminul; apoi completarea
    assert.strictEqual((await call('admin_prepare', { lessonId: lesson.id, fill: true }, U.free)).statusCode, 403);
    const r = await call('admin_prepare', { lessonId: lesson.id, fill: true }, U.admin);
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.lesson.status, 'gata', 'fără voce generată: rămâne gata (vocea browserului)');
    const row = fake.db.tables.live_lessons[0];
    assert.deepStrictEqual(row.script.items.map((it) => it.ref), BAC_REFS);
    assert.deepStrictEqual(row.script.missing, []);
    assert.deepStrictEqual(row.progress.itemi.added, ['III.1.b', 'III.1.c']);
    assert.ok(row.duration_sec > 0);
    assert.strictEqual(row.locked_until, null);
    assert.deepStrictEqual(s.seen.claude.map((a) => reqOf(a).key).sort(), ['doar:III.1.b', 'doar:III.1.c']);
    assert.ok(s.seen.claude.every((a) => a.model === 'claude-opus-5-5'));
    assert.strictEqual(row.cost_micro, 1000 + ai.costMicroLei('claude-opus-5-5', { in: 2000, out: 1000 }));
    assert.deepStrictEqual(used, [{ endpoint: 'live-lectie', model: 'claude-opus-5-5', in: 2000, out: 1000 }]);
    // în „Lecțiile recente": nimic lipsă; în „Scriptul": verificat pe subiect
    const ov = await call('admin_overview', {}, U.admin);
    assert.deepStrictEqual(ov.body.lessons.find((x) => x.id === lesson.id).missing, []);
    const sc2 = await call('admin_lesson', { lessonId: lesson.id }, U.admin);
    assert.deepStrictEqual(sc2.body.lesson.missing, []);
    assert.strictEqual(sc2.body.lesson.missingChecked, true);
  } finally { s.restore(); h.restore(); }
});
