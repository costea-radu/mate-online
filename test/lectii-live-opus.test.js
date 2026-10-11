// Teste pentru opțiunea „Claude Opus 5.5 scrie lecțiile live" (api/_lib/liveLesson.js →
// writeJson / generateScript, api/live.js → admin_set_writer + costul pe model):
// paginile PDF ajung la Claude ca documente, schema strictă e aceeași, verificările pe
// barem rămân, iar orice bucată pe care Claude nu o scrie (fără cheie, eroare, 429,
// răspuns tăiat, niciun item valid) o scrie Terra — lecția nu rămâne nescrisă. Costul
// se socotește pe fiecare model. Fără rețea: modelele și Supabase sunt înlocuite.
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
const seg = (say, board = []) => ({ say, board });
const rawItem = (ref, extra = {}) => ({
  ref, title: `Item ${ref}`, kind: 'grila', statement: 'Rezultatul calculului $2+3\\cdot 4$ este:', statementTry: null,
  options: ['20', '14', '24', '9'], answer: 'a', points: 5, barem: 'b. 5p',
  intro: [seg('Trecem la exercițiul următor.')],
  tryPoll: { type: 'grila', question: 'Rezultatul calculului?', options: ['20', '14', '24', '9'], answer: 'a', explain: 'Înmulțirea se face întâi.' },
  afterTry: [],
  modes: { barem: [{ say: 'Întâi înmulțirea, apoi adunarea.', board: ['$3\\cdot 4 = 12$', '$2 + 12 = 14$'], ask: null }], intuitiv: [seg('Înmulțirea leagă mai tare decât adunarea.')], greseli: [], alta_metoda: null },
  check: null, afterCheck: [],
  ...extra,
});
const textOf = (content) => (typeof content === 'string' ? content : content.find((b) => b.type === 'text').text);
// bucata cerută de un apel: „Explică itemii 4–6 din SUBIECTUL I"
const chunkOf = (args) => {
  const m = /itemii (\d+)–(\d+) din SUBIECTUL (I{1,3})\b/.exec(textOf(args.messages[0].content));
  return { from: +m[1], to: +m[2], sec: m[3], key: `${m[3]}.${m[1]}` };
};
const itemsFor = ({ from, to, sec }, extra = {}) => Array.from({ length: to - from + 1 }, (_, i) => rawItem(`${sec}.${from + i}`, extra));

const claudeOk = (args, extra = {}) => ({
  text: JSON.stringify({ items: itemsFor(chunkOf(args), extra) }),
  usage: { prompt_tokens: 1000, completion_tokens: 500, model: args.model }, provider: args.model, stopReason: 'end_turn',
});
const terraOk = (args) => ({ data: { items: itemsFor(chunkOf(args)) }, usage: { in: 800, out: 400, model: args.model } });

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

const PDF = (name) => ({ type: 'file', file: { filename: name, file_data: `data:application/pdf;base64,${Buffer.from(`%PDF-1.4 ${name}`).toString('base64')}` } });
const ATT = { I: [PDF('subiect-subiectul-I.pdf'), PDF('barem-subiectul-I.pdf')], II: [PDF('subiect-subiectul-II.pdf')], III: [] };
const gen = (model, log = () => {}) => LL.generateScript({
  ctx: { text: SUBJECT, baremText: BAREM, baremStatus: 'ok' }, content: { id: 'c1', title: 'EN 2024 Varianta 7' },
  teacher: live.teacherById('radu'), exam: 'en', profile: null, log, attachments: ATT, model,
});
const ALL_REFS = ['I.1', 'I.2', 'I.3', 'I.4', 'I.5', 'I.6', 'II.1', 'II.2', 'II.3', 'II.4', 'II.5', 'II.6'];

test('alegerea din Admin: doar Claude Opus 5.5 (Opus 5 vechi → 5.5); orice altceva = implicitul', () => {
  assert.strictEqual(LL.writerChoice('claude-opus-5-5'), 'claude-opus-5-5');
  assert.strictEqual(LL.writerChoice('claude-opus-5'), 'claude-opus-5-5');
  for (const m of [null, '', 'gpt-5.6-sol', 'claude-fable-5-1', 'anthropic/claude-opus-5-5']) assert.strictEqual(LL.writerChoice(m), null, String(m));
  assert.ok(LL.isClaude('claude-opus-5-5'));
  assert.ok(!LL.isClaude('anthropic/claude-opus-5-5'), 'furnizorii compatibili OpenAI rămân pe ai.chatJson');
  assert.ok(!LL.isClaude('gpt-5.6-terra'));
  assert.strictEqual(LL.FALLBACK_MODEL(), ai.PDF_MODEL);
});

test('paginile PDF pentru Anthropic: blocuri „document" înaintea textului; fără pagini → doar textul', () => {
  const c = LL.anthropicContent('Explică itemii', [PDF('subiect-subiectul-I.pdf'), null, { type: 'text', text: 'x' }]);
  assert.strictEqual(c.length, 2);
  assert.deepStrictEqual(c[0], { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.4 subiect-subiectul-I.pdf').toString('base64') }, title: 'subiect-subiectul-I.pdf' });
  assert.deepStrictEqual(c[1], { type: 'text', text: 'Explică itemii' });
  assert.strictEqual(LL.anthropicContent('doar text', []), 'doar text');
});

test('Claude Opus 5.5 scrie lecția: paginile ca documente, aceeași schemă strictă, literele grilelor tot din barem', async () => {
  const s = stub({ claudeFn: (a) => claudeOk(a), openaiFn: never('Terra') });
  try {
    const r = await gen('claude-opus-5-5');
    assert.strictEqual(s.seen.claude.length, 4, '2 secțiuni × 2 bucăți de câte 3 itemi');
    for (const a of s.seen.claude) {
      assert.strictEqual(a.model, 'claude-opus-5-5');
      assert.strictEqual(a.schema, LL.SCHEMA, 'aceeași schemă ca la Terra');
      assert.match(a.system, /DOAR pe baza baremului oficial/);
      assert.ok(a.system.includes(`FORMATUL RĂSPUNSULUI: un singur obiect JSON, exact după schema de mai jos (fără alt text, fără markdown):\n${JSON.stringify(LL.SCHEMA)}`), 'formatul și în instrucțiuni (pentru reîncercarea fără schemă)');
    }
    const secI = s.seen.claude.find((a) => chunkOf(a).sec === 'I');
    const content = secI.messages[0].content;
    assert.deepStrictEqual(content.map((b) => b.type), ['document', 'document', 'text'], 'subiectul și baremul secțiunii, apoi cererea');
    assert.strictEqual(content[1].title, 'barem-subiectul-I.pdf');
    assert.match(content[2].text, /PAGINILE PDF ale subiectului și ale baremului/);
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), ALL_REFS);
    // modelul a zis „a" peste tot; baremul are ultimul cuvânt
    assert.strictEqual(r.script.items.find((it) => it.ref === 'I.2').tryPoll.answer, 'c');
    assert.strictEqual(r.script.items.find((it) => it.ref === 'II.1').tryPoll.answer, 'b');
    assert.deepStrictEqual(r.script.writer, { model: 'claude-opus-5-5', parts: { 'claude-opus-5-5': 4 } });
    assert.deepStrictEqual(LL.usageParts(r.usage), [{ in: 4000, out: 2000, model: 'claude-opus-5-5' }]);
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
    const items = itemsFor(chunkOf(body));
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'text', text: JSON.stringify({ items }) }], stop_reason: 'end_turn', usage: { input_tokens: 2000, output_tokens: 700 } }) };
  };
  const origChat = ai.chatJson;
  ai.chatJson = never('Terra');
  try {
    const r = await gen('claude-opus-5-5');
    assert.strictEqual(bodies.length, 4);
    const b = bodies.find((x) => chunkOf(x).sec === 'I');
    assert.strictEqual(b.model, 'claude-opus-5-5');
    assert.strictEqual(b.max_tokens, 16000);
    assert.deepStrictEqual(b.thinking, { type: 'disabled' });
    assert.deepStrictEqual(b.output_config, { format: { type: 'json_schema', schema: LL.SCHEMA } });
    assert.ok(!('temperature' in b));
    assert.deepStrictEqual(b.messages.map((m) => m.role), ['user']);
    assert.deepStrictEqual(b.messages[0].content.map((c) => c.type), ['document', 'document', 'text']);
    assert.deepStrictEqual(b.messages[0].content[0].source, { type: 'base64', media_type: 'application/pdf', data: Buffer.from('%PDF-1.4 subiect-subiectul-I.pdf').toString('base64') });
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), ALL_REFS);
    assert.deepStrictEqual(r.script.writer.parts, { 'claude-opus-5-5': 4 });
    assert.deepStrictEqual(LL.usageParts(r.usage), [{ in: 8000, out: 2800, model: 'claude-opus-5-5' }]);
  } finally { global.fetch = origFetch; ai.chatJson = origChat; }
});

test('implicitul (fără alegere): Terra, ca înainte — Claude nu e chemat', async () => {
  const s = stub({ claudeFn: never('Claude'), openaiFn: terraOk });
  try {
    const r = await gen(null);
    assert.strictEqual(s.seen.openai.length, 4);
    assert.ok(s.seen.openai.every((a) => a.model === LL.GEN_MODEL() && a.schema === LL.SCHEMA && a.schemaName === 'lectie_live'));
    // paginile merg ca părți „file" (formatul OpenAI), după text
    const secI = s.seen.openai.find((a) => chunkOf(a).sec === 'I');
    assert.deepStrictEqual(secI.messages[0].content.map((b) => b.type), ['text', 'file', 'file']);
    assert.deepStrictEqual(r.script.writer, { model: LL.GEN_MODEL(), parts: { [LL.GEN_MODEL()]: 4 } });
    assert.deepStrictEqual(LL.usageParts(r.usage), [{ in: 3200, out: 1600, model: LL.GEN_MODEL() }]);
  } finally { s.restore(); }
});

test('rezerva: fără ANTHROPIC_API_KEY, toată lecția o scrie Terra', async () => {
  const s = stub({ key: false, claudeFn: never('Claude'), openaiFn: terraOk });
  const logs = [];
  try {
    const r = await gen('claude-opus-5-5', (m) => logs.push(m));
    assert.strictEqual(s.seen.openai.length, 4);
    assert.ok(s.seen.openai.every((a) => a.model === ai.PDF_MODEL));
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), ALL_REFS);
    assert.deepStrictEqual(r.script.writer, { model: 'claude-opus-5-5', parts: { [ai.PDF_MODEL]: 4 } });
    assert.ok(logs.some((l) => /ANTHROPIC_API_KEY lipsește/.test(l)));
  } finally { s.restore(); }
});

test('rezerva pe bucăți: eroare / răspuns tăiat / niciun item valid → doar bucata aceea o scrie Terra; costul pe fiecare model', async () => {
  const s = stub({
    claudeFn: (a) => {
      const c = chunkOf(a);
      if (c.key === 'I.4') { const e = new Error('Internal server error'); e.status = 502; throw e; }
      if (c.key === 'II.1') return { text: '{"items":[{"ref":"II.1","title":"Sub', usage: { prompt_tokens: 1000, completion_tokens: 16000, model: a.model }, stopReason: 'max_tokens' };
      if (c.key === 'II.4') return claudeOk(a, { modes: { barem: [], intuitiv: [], greseli: [], alta_metoda: null } });   // fără explicație pe barem → omiși
      return claudeOk(a);
    },
    openaiFn: terraOk,
  });
  const logs = [];
  try {
    const r = await gen('claude-opus-5-5', (m) => logs.push(m));
    assert.strictEqual(s.seen.claude.length, 4);
    assert.deepStrictEqual(s.seen.openai.map((a) => chunkOf(a).key).sort(), ['I.4', 'II.1', 'II.4']);
    assert.ok(s.seen.openai.every((a) => a.model === ai.PDF_MODEL));
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), ALL_REFS, 'lecția e întreagă');
    assert.deepStrictEqual(r.script.writer.parts, { 'claude-opus-5-5': 1, [ai.PDF_MODEL]: 3 });
    // Claude: 3 răspunsuri plătite (cel cu eroare nu are tokeni), Terra: 3 bucăți
    const parts = Object.fromEntries(LL.usageParts(r.usage).map((u) => [u.model, [u.in, u.out]]));
    assert.deepStrictEqual(parts, { 'claude-opus-5-5': [3000, 17000], [ai.PDF_MODEL]: [2400, 1200] });
    assert.deepStrictEqual([r.usage.in, r.usage.out], [5400, 18200]);
    assert.ok(logs.some((l) => /I, itemii 4–6 — claude-opus-5-5 a eșuat \(Internal server error\)/.test(l)));
    assert.ok(logs.some((l) => /limita de 16000 tokeni/.test(l)));
    assert.ok(logs.some((l) => /niciun item valid de la claude-opus-5-5/.test(l)));
  } finally { s.restore(); }
});

test('429: o pauză și o singură reîncercare cu Claude; plafonul lunar de cheltuieli → direct Terra', async () => {
  // limita pe minut: prima cerere a bucății I.1 e respinsă o dată, apoi merge
  let rejected = false;
  let s = stub({
    claudeFn: (a) => {
      if (chunkOf(a).key === 'I.1' && !rejected) { rejected = true; const e = new Error('Number of request tokens has exceeded your per-minute rate limit'); e.status = 429; e.retryAfter = 0; throw e; }
      return claudeOk(a);
    },
    openaiFn: never('Terra'),
  });
  try {
    const r = await gen('claude-opus-5-5');
    assert.strictEqual(s.seen.claude.length, 5, '4 bucăți + o reîncercare');
    assert.deepStrictEqual(r.script.writer.parts, { 'claude-opus-5-5': 4 });
  } finally { s.restore(); }
  // plafonul lunar (429 fără retry-after): reîncercarea n-ar ajuta
  s = stub({
    claudeFn: () => { const e = new Error('You have reached your API usage limits: your organization has crossed its monthly API usage threshold'); e.status = 429; throw e; },
    openaiFn: terraOk,
  });
  try {
    const r = await gen('claude-opus-5-5');
    assert.strictEqual(s.seen.claude.length, 4, 'fără reîncercări');
    assert.strictEqual(s.seen.openai.length, 4);
    assert.deepStrictEqual(r.script.items.map((it) => it.ref), ALL_REFS);
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

test('întrebările pe pași: același model ales, fără pagini PDF, cu aceeași rezervă', async () => {
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
  // Claude cade → Terra scrie întrebările
  s = stub({ claudeFn: () => { const e = new Error('Overloaded'); e.status = 502; throw e; }, openaiFn: () => ({ data: reply, usage: { in: 200, out: 80 } }) });
  try {
    const r = await LL.addStepQuestions({ script, teacher: live.teacherById('radu'), log: () => {}, model: 'claude-opus-5-5' });
    assert.strictEqual(s.seen.claude.length, 2, 'supraîncărcat: o reîncercare');
    assert.strictEqual(s.seen.openai.length, 1);
    assert.strictEqual(s.seen.openai[0].model, ai.PDF_MODEL);
    assert.deepStrictEqual(LL.usageParts(r.usage), [{ in: 200, out: 80, model: ai.PDF_MODEL }]);
  } finally { s.restore(); process.env.LIVE_INTREBARI_PASI = '0'; }
});

// ─── api/live.js: alegerea din Admin, lacătul, costul pe model ────────────────
const U = { free: '11111111-1111-4111-8111-111111111111', admin: '33333333-3333-4333-8333-333333333333' };
const EN1 = 'aaaaaaaa-0000-4000-8000-000000000001';
const BAREM_TEXT = 'BAREM DE EVALUARE ȘI DE NOTARE. SUBIECTUL I. Rezultate: 1. b 2. c 3. a. Se punctează orice modalitate corectă de rezolvare.';
function seed() {
  return {
    profiles: [
      { id: U.free, full_name: 'Ioana Popescu', email: 'ioana@example.com', subscription_status: null, role: 'elev', is_admin: false },
      { id: U.admin, full_name: 'Radu Costea', email: 'radu@example.com', subscription_status: null, role: 'admin', is_admin: true },
    ],
    content: [{ id: EN1, title: 'EN 2024 Varianta 7', category: 'evaluare-nationala', subcategory: null, profile: null, content_type: 'pdf', file_url: `https://x/${EN1}.pdf`, is_free: true, created_at: '2026-01-01T00:00:00Z' }],
    ai_pdf_text: [{ content_id: EN1, barem_status: 'ok', barem: { title: 'Barem' }, barem_text: BAREM_TEXT, text: 'SUBIECTUL I ...' }],
    app_settings: [{ key: 'live_free_lessons', value: { subjects: [] } }],
  };
}
function lessonScript(writer) {
  const radu = live.teacherById('radu');
  const B2 = 'SUBIECTUL I (30 de puncte)\nNr. item 1. 2.\nRezultate b. b.\nPunctaj 5p 5p\n';
  const items = LL.normalizeItems([rawItem('I.1'), rawItem('I.2')], { section: 'I', exam: 'en', grile: { I: { 1: 'b', 2: 'b' } }, baremText: B2 });
  return LL.assignIds({ title: 'EN 2024 Varianta 7', exam: 'en', pasi: LL.PASI_V, teacher: 'radu', teacherName: radu.name, writer, ...LL.templates(radu, { title: 'EN 2024 Varianta 7', exam: 'en' }), items });
}

test('Admin: cine scrie lecțiile (doar adminul), lecția nouă o scrie modelul ales, costul și ai_usage pe model', async () => {
  const handler = require('../api/live');
  const fake = createFakeSupabase(seed());
  const used = [];
  const genCalls = [];
  const orig = { admin: ai.admin, authUser: ai.authUser, logUsage: ai.logUsage, gen: LL.generateScript, ctx: pdf.getPdfContext, dl: pdf.downloadContentPdf };
  ai.admin = () => fake;
  ai.authUser = async (req) => { const u = req.headers['x-user']; if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; } return u; };
  ai.logUsage = async (supa, userId, endpoint, usage) => { used.push({ endpoint, model: usage.model, in: usage.in, out: usage.out }); };
  pdf.getPdfContext = async () => ({ text: 'SUBIECTUL I', baremText: BAREM_TEXT, baremStatus: 'ok' });
  pdf.downloadContentPdf = async () => { throw new Error('fără rețea în teste'); };
  let fail = null;
  LL.generateScript = async (args) => {
    const row = fake.db.tables.live_lessons.find((l) => l.subject_id === EN1 && l.status === 'nou');
    genCalls.push({ model: args.model, lockMin: (new Date(row.locked_until).getTime() - Date.now()) / 60000 });
    const usage = { in: 1e6, out: 1e6, model: args.model, byModel: { 'claude-opus-5-5': { in: 1e6, out: 0 }, 'gpt-5.6-terra': { in: 0, out: 1e6 } } };
    if (fail) { const e = new Error(fail); e.code = 'SCRIPT_FAIL'; e.usage = usage; throw e; }
    return { script: lessonScript({ model: args.model || LL.GEN_MODEL(), parts: { 'claude-opus-5-5': 5, 'gpt-5.6-terra': 1 } }), usage };
  };
  const call = async (action, body = {}, user = null) => {
    const res = fakeRes();
    await handler({ method: 'POST', headers: user ? { 'x-user': user } : {}, query: {}, body: { action, ...body } }, res);
    return res;
  };
  try {
    // doar adminul alege; un model necunoscut e respins
    assert.strictEqual((await call('admin_set_writer', { model: 'claude-opus-5-5' }, U.free)).statusCode, 403);
    assert.strictEqual((await call('admin_set_writer', { model: 'gpt-9' }, U.admin)).statusCode, 400);
    let ov = await call('admin_overview', {}, U.admin);
    assert.strictEqual(ov.statusCode, 200, JSON.stringify(ov.body));
    assert.strictEqual(ov.body.writer.model, null, 'implicit: Terra');
    assert.strictEqual(ov.body.writer.default, LL.GEN_MODEL());
    assert.deepStrictEqual(ov.body.writer.choices, [{ id: 'claude-opus-5-5', label: 'Claude Opus 5.5' }]);
    assert.strictEqual(typeof ov.body.writer.claudeKey, 'boolean');
    // alegerea veche „Opus 5" ajunge pe Opus 5.5
    const set = await call('admin_set_writer', { model: 'claude-opus-5' }, U.admin);
    assert.strictEqual(set.statusCode, 200, JSON.stringify(set.body));
    assert.strictEqual(set.body.writer.model, 'claude-opus-5-5');
    const stored = fake.db.tables.app_settings.find((r) => r.key === 'live_gen_model');
    assert.strictEqual(stored.value.model, 'claude-opus-5-5');
    assert.strictEqual(stored.value.by, U.admin);

    // lecția nouă: scrisă de modelul ales; lacătul ține cât poate trăi funcția, apoi se eliberează
    const prep = await call('admin_prepare', { subjectId: EN1, teacher: 'radu' }, U.admin);
    assert.strictEqual(prep.statusCode, 200, JSON.stringify(prep.body));
    assert.strictEqual(prep.body.lesson.status, 'gata');
    assert.strictEqual(genCalls.length, 1);
    assert.strictEqual(genCalls[0].model, 'claude-opus-5-5');
    assert.ok(genCalls[0].lockMin > 13, `lacătul în timpul scrisului: ${genCalls[0].lockMin} min`);
    const row = fake.db.tables.live_lessons.find((l) => l.subject_id === EN1);
    assert.strictEqual(row.locked_until, null, 'lacătul se eliberează');
    // costul: fiecare model la prețul lui (Claude 1M intrare + Terra 1M ieșire)
    const want = ai.costMicroLei('claude-opus-5-5', { in: 1e6, out: 0 }) + ai.costMicroLei('gpt-5.6-terra', { in: 0, out: 1e6 });
    assert.strictEqual(row.cost_micro, want);
    assert.deepStrictEqual(used, [
      { endpoint: 'live-lectie', model: 'claude-opus-5-5', in: 1e6, out: 0 },
      { endpoint: 'live-lectie', model: 'gpt-5.6-terra', in: 0, out: 1e6 },
    ]);
    // „Lecțiile recente" arată cine a scris-o
    ov = await call('admin_overview', {}, U.admin);
    const l = ov.body.lessons.find((x) => x.subject_id === EN1);
    assert.deepStrictEqual(l.writer, { model: 'claude-opus-5-5', parts: { 'claude-opus-5-5': 5, 'gpt-5.6-terra': 1 } });

    // înapoi la implicit: regenerarea o scrie Terra (model null → GEN_MODEL)
    assert.strictEqual((await call('admin_set_writer', { model: null }, U.admin)).body.writer.model, null);
    const re = await call('admin_prepare', { subjectId: EN1, teacher: 'radu', regenerate: true }, U.admin);
    assert.strictEqual(re.statusCode, 200, JSON.stringify(re.body));
    assert.strictEqual(genCalls[1].model, null);

    // o încercare eșuată: tokenii consumați ajung totuși în ai_usage
    used.length = 0;
    fail = 'Lecția nu s-a putut pregăti (1 itemi explicați).';
    const bad = await call('admin_prepare', { subjectId: EN1, teacher: 'radu', regenerate: true }, U.admin);
    assert.strictEqual(bad.statusCode, 200, JSON.stringify(bad.body));
    assert.strictEqual(bad.body.lesson.status, 'eroare');
    assert.deepStrictEqual(used.map((u) => u.model), ['claude-opus-5-5', 'gpt-5.6-terra']);
  } finally {
    Object.assign(ai, { admin: orig.admin, authUser: orig.authUser, logUsage: orig.logUsage });
    LL.generateScript = orig.gen; pdf.getPdfContext = orig.ctx; pdf.downloadContentPdf = orig.dl;
  }
});
