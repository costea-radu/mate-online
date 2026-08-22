// =====================================================================
// test/etapa2-pdf-multimodal.test.js — Etapa 2 (AUDIT_AGENTI_AI.md, 1.1):
//   · paginile PDF către model (api/_lib/pdfpages.js): textul pe pagini,
//     găsirea paginii exercițiului (după enunț / referință), extragerea unui
//     PDF nou doar cu pagina, content part-ul `file`, plafonul de mărime;
//   · ai.pdfPageAttachments: din cache-ul ai_pdf_text (page_texts) → pagina
//     atașată mesajului; a doua cerere nu mai descarcă fișierul (cache);
//   · fallback-ul la provider fără atașamente (adaptBodyToError);
//   · corectarea cu POZE ale rezolvării scrise de mână (ai-correct grade):
//     mesaj multimodal (text + image_url), filtrarea pozelor, cerința
//     rezolvată doar în poză nu e „necompletată".
// PDF-urile de test se construiesc în memorie cu pdf-lib; LLM-ul și
// descărcarea fișierului sunt simulate prin global.fetch.
// Rulare: npm test   (node --test test/*.test.js)
// =====================================================================
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
process.env.AI_PDF_VISION = '1';
const test = require('node:test');
const assert = require('node:assert');
const { PDFDocument, StandardFonts } = require('pdf-lib');
const pdfpages = require('../api/_lib/pdfpages.js');
const ai = require('../api/_lib/ai.js');
const correct = require('../api/ai-correct.js');

// PDF minimal cu text (Helvetica — fără diacritice), o listă de linii pe pagină
async function makePdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage([595, 842]);
    let y = 800;
    for (const line of lines) { page.drawText(line, { x: 50, y, size: 12, font }); y -= 18; }
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}
const TEST_PAGES = [
  ['SUBIECTUL I', '1. Rezultatul calculului 2+3 este:', '2. Numarul 17 este prim.'],
  ['SUBIECTUL al II-lea', '1. In triunghiul ABC, AB = 6 cm.', '2. Aria patratului cu latura 4 cm este:'],
  ['SUBIECTUL al III-lea', '1. Fie f(x) = 2x + 1.', 'a) Calculati f(2).'],
];

// ─── pdfpages ────────────────────────────────────────────────────────────────
test('pageTexts: textul fiecărei pagini, în ordine', async () => {
  const buf = await makePdf(TEST_PAGES);
  const pages = await pdfpages.pageTexts(buf);
  assert.strictEqual(pages.length, 3);
  assert.match(pages[0], /SUBIECTUL I/);
  assert.match(pages[1], /Aria patratului/);
  assert.match(pages[2], /Calculati f\(2\)/);
});

test('findPages: după enunț, după referință (subiect + număr); negăsit → []', async () => {
  const pages = await pdfpages.pageTexts(await makePdf(TEST_PAGES));
  assert.deepStrictEqual(pdfpages.findPages(pages, { enunt: 'Aria patratului cu latura 4 cm este:' }), [1]);
  assert.deepStrictEqual(pdfpages.findPages(pages, { enunt: 'aria PATRATULUI cu latura' }), [1]); // normalizat
  assert.deepStrictEqual(pdfpages.findPages(pages, { ref: { subject: 'III', ex: '1' } }), [2]);
  assert.deepStrictEqual(pdfpages.findPages(pages, { ref: { subject: 'II', ex: '2' } }), [1]);
  assert.deepStrictEqual(pdfpages.findPages(pages, { ref: { subject: 'I', ex: '1' } }), [0]);
  assert.deepStrictEqual(pdfpages.findPages(pages, { enunt: 'acest enunt nu exista' }), []);
  assert.deepStrictEqual(pdfpages.findPages(pages, {}), []);
  assert.deepStrictEqual(pdfpages.findPages([], { enunt: 'x' }), []);
});

test('extractPagesPdf: un PDF nou doar cu pagina cerută; filePart: content part `file` (base64) cu plafon de mărime', async () => {
  const buf = await makePdf(TEST_PAGES);
  const sub = await pdfpages.extractPagesPdf(buf, [1]);
  assert.ok(Buffer.isBuffer(sub) && sub.length < buf.length);
  const pages = await pdfpages.pageTexts(sub);
  assert.strictEqual(pages.length, 1);
  assert.match(pages[0], /SUBIECTUL al II-lea/);
  assert.strictEqual(await pdfpages.extractPagesPdf(buf, [7, -1]), null); // indici invalizi
  const two = await pdfpages.extractPagesPdf(buf, [2, 0, 0]);              // dedup + ordonat
  assert.strictEqual((await pdfpages.pageTexts(two)).length, 2);
  const part = pdfpages.filePart(sub, 'pagina-2.pdf');
  assert.strictEqual(part.type, 'file');
  assert.strictEqual(part.file.filename, 'pagina-2.pdf');
  assert.match(part.file.file_data, /^data:application\/pdf;base64,JVBERi/);
  assert.strictEqual(pdfpages.filePart(Buffer.alloc(pdfpages.MAX_PART_BYTES + 1)), null);
  assert.strictEqual(pdfpages.filePart(null), null);
});

test('userContent / textOf: fără atașamente → string; cu atașamente → listă de părți; textul se recuperează', () => {
  assert.strictEqual(pdfpages.userContent('salut', []), 'salut');
  const part = { type: 'file', file: { filename: 'p.pdf', file_data: 'data:application/pdf;base64,AA==' } };
  const c = pdfpages.userContent('salut', [part, null]);
  assert.deepStrictEqual(c, [{ type: 'text', text: 'salut' }, part]);
  assert.strictEqual(pdfpages.textOf(c), 'salut');
  assert.strictEqual(pdfpages.textOf('x'), 'x');
});

// ─── supabase fals (ca în test/etapa1-chat-corectare.test.js) ───────────────
function supaStub(handlers) {
  function make(table) {
    const ops = [];
    const p = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === 'then') {
          const out = handlers[table] ? handlers[table](ops) : { data: null, error: null };
          return (res, rej) => Promise.resolve(out).then(res, rej);
        }
        return (...args) => { ops.push([prop, args]); return p; };
      },
    });
    return p;
  }
  return { from: (table) => make(table), storage: { from: () => ({ download: async () => ({ data: null }) }) } };
}

// ─── pdfPageAttachments ──────────────────────────────────────────────────────
test('pdfPageAttachments: pagina exercițiului din cache-ul ai_pdf_text → atașată; a doua oară fără descărcare', async () => {
  const buf = await makePdf(TEST_PAGES);
  const pageTexts = await pdfpages.pageTexts(buf);
  const content = { id: 'c-att-1', title: 'Test EN', file_url: 'https://files.example/test.pdf', is_free: true, category: 'evaluare-nationala', content_type: 'pdf' };
  let downloads = 0;
  global.fetch = async (url) => {
    if (String(url).includes('files.example')) { downloads++; return { ok: true, status: 200, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }; }
    throw new Error('apel neașteptat: ' + url);
  };
  const supa = supaStub({
    content: () => ({ data: content, error: null }),
    ai_pdf_text: () => ({ data: { content_id: content.id, file_url: content.file_url, text: pageTexts.join('\n\n'), chars: 100, barem_status: 'ok', barem: null, barem_text: '', page_texts: pageTexts, barem_override_id: null, updated_at: new Date().toISOString() }, error: null }),
  });
  const ctx = { pdf: true, contentId: content.id };
  // după ENUNȚ (itemul de barem localizat)
  let parts = await ai.pdfPageAttachments(supa, { context: ctx, message: 'explică-mi', priorMsgs: [], baremItem: { enunt: 'Aria patratului cu latura 4 cm este:' } });
  assert.strictEqual(parts.length, 1);
  assert.strictEqual(parts[0].type, 'file');
  assert.strictEqual(parts[0].file.filename, 'pagina-2.pdf');
  assert.strictEqual(downloads, 1);
  const sub = Buffer.from(parts[0].file.file_data.split(',')[1], 'base64');
  assert.match((await pdfpages.pageTexts(sub))[0], /Aria patratului/);
  // aceeași pagină → din cache (fără a doua descărcare)
  parts = await ai.pdfPageAttachments(supa, { context: ctx, message: 'și II.2?', priorMsgs: [], baremItem: null });
  assert.strictEqual(parts.length, 1);
  assert.strictEqual(downloads, 1);
  // referință din conversație, fără item de barem → altă pagină
  parts = await ai.pdfPageAttachments(supa, { context: ctx, message: 'cum rezolv III.1?', priorMsgs: [], baremItem: null });
  assert.strictEqual(parts[0].file.filename, 'pagina-3.pdf');
  assert.strictEqual(downloads, 2);
  // fără referință și fără enunț → nimic atașat
  parts = await ai.pdfPageAttachments(supa, { context: ctx, message: 'bună', priorMsgs: [], baremItem: null });
  assert.deepStrictEqual(parts, []);
  // nu e PDF deschis → nimic
  assert.deepStrictEqual(await ai.pdfPageAttachments(supa, { context: { pdf: false }, message: 'I.1', priorMsgs: [] }), []);
});

test('pdfPageAttachments: cache fără page_texts (migrarea v2 nerulată) sau eroare → [] fără a pica chatul', async () => {
  const content = { id: 'c-att-2', title: 'T', file_url: 'https://files.example/t.pdf', is_free: true, content_type: 'pdf' };
  const supa = supaStub({
    content: () => ({ data: content, error: null }),
    ai_pdf_text: () => ({ data: { content_id: content.id, file_url: content.file_url, text: 'SUBIECTUL I 1. ceva', chars: 20, barem_status: 'ok', barem: null, barem_text: '', updated_at: new Date().toISOString() }, error: null }),
  });
  assert.deepStrictEqual(await ai.pdfPageAttachments(supa, { context: { pdf: true, contentId: content.id }, message: 'I.1', priorMsgs: [] }), []);
  const broken = { from: () => { throw new Error('db down'); } };
  assert.deepStrictEqual(await ai.pdfPageAttachments(broken, { context: { pdf: true, contentId: 'x' }, message: 'I.1', priorMsgs: [] }), []);
});

test('adaptBodyToError: atașamentele refuzate de provider → se retrimite doar textul', () => {
  const body = { model: 'm', messages: [{ role: 'system', content: 's' }, { role: 'user', content: [{ type: 'text', text: 'întrebare' }, { type: 'file', file: { filename: 'p.pdf', file_data: 'data:application/pdf;base64,AA==' } }] }] };
  assert.strictEqual(ai.adaptBodyToError(body, "Invalid content type: 'file' is not supported for this model"), true);
  assert.strictEqual(body.messages[1].content, 'întrebare');
  assert.strictEqual(ai.adaptBodyToError(body, 'file not supported'), false); // nimic de schimbat a doua oară
});

// ─── corectarea cu poze (ai-correct grade) ──────────────────────────────────
function fakeLLM(handler) {
  const calls = [];
  global.fetch = async (url, opts) => {
    if (!String(url).includes('/chat/completions')) throw new Error('apel neașteptat: ' + url);
    const body = JSON.parse(opts.body);
    calls.push(body);
    const content = await handler(body);
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 30, completion_tokens: 20 } }), text: async () => '' };
  };
  return calls;
}
function fakeRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}
// ai-correct apelează ai.* prin obiectul modulului → le înlocuim pe durata testului
function stubAuth(t) {
  const saved = {};
  const patch = (k, v) => { saved[k] = ai[k]; ai[k] = v; };
  patch('authUser', async () => 'u-1');
  patch('requireUser', async () => ({ id: 'u-1', is_admin: false, plan: 'premium' }));
  patch('enforceRateLimit', async () => ({ degraded: false }));
  patch('enforceFreeQuota', async () => {});
  patch('enforceFeatureQuota', async () => {});
  patch('logUsage', async () => {});
  patch('admin', () => supaStub({}));
  t.after(() => { for (const k of Object.keys(saved)) ai[k] = saved[k]; });
}
const PNG = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');
const TEST_TEXT = 'Exercitiul 1. Rezolvati ecuatia 2x + 4 = 10.\nExercitiul 2. Calculati 15% din 200.\nExercitiul 3. Aflati aria unui patrat cu latura 5 cm.';
const ITEMS = [
  { id: 'ex1', eticheta: 'Exercițiul 1', puncte: 10, cerinta: 'Rezolvați ecuația $2x+4=10$' },
  { id: 'ex2', eticheta: 'Exercițiul 2', puncte: 10, cerinta: 'Calculați $15\\%$ din $200$' },
  { id: 'ex3', eticheta: 'Exercițiul 3', puncte: 10, cerinta: 'Aria pătratului cu latura $5$ cm' },
];

test('grade cu poze: mesaj multimodal (text + image_url), pozele invalide sunt filtrate, cerința rezolvată doar în poză primește punctele', async (t) => {
  stubAuth(t);
  const calls = fakeLLM(() => JSON.stringify({
    items: [
      { id: 'ex1', puncte: 10, verdict: 'corect', explicatie: 'Corect, $x=3$.', tema: 'ecuații' },
      { id: 'ex2', puncte: 6, verdict: 'partial', explicatie: 'Metoda din poză e bună, rezultatul e 30.', tema: 'procente' },
      { id: 'ex3', puncte: 0, verdict: 'necompletat', explicatie: '', tema: 'arii' },
    ],
    feedback: 'Bravo pentru prima, revezi procentele.',
  }));
  const token = correct.signForm({ items: ITEMS, contentId: null, testText: TEST_TEXT, hasBarem: false, total: 30, oficiu: 0 });
  const req = { method: 'POST', headers: {}, body: {
    action: 'grade', token, items: ITEMS, testText: TEST_TEXT, title: 'Fișă', context: { category: 'clasa-6' },
    answers: { ex1: 'x = 3' },                          // ex2 rezolvat DOAR în poză, ex3 deloc
    images: [PNG, 'data:text/plain;base64,AAAA', 'http://x/y.png', PNG, PNG, PNG], // 2 invalide, 4 valide → max 3
  } };
  const res = fakeRes();
  await correct(req, res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  // mesajul către model: text + 3 poze, detail high
  const user = calls[0].messages.find((m) => m.role === 'user');
  assert.ok(Array.isArray(user.content));
  assert.strictEqual(user.content[0].type, 'text');
  assert.match(user.content[0].text, /POZE CU REZOLVAREA SCRISĂ DE MÂNĂ \(3\)/);
  const imgs = user.content.filter((p) => p.type === 'image_url');
  assert.strictEqual(imgs.length, 3);
  assert.ok(imgs.every((p) => p.image_url.url === PNG && p.image_url.detail === 'high'));
  // corectarea: ex2 (doar în poză) e „răspuns" și punctat; ex3 rămâne necompletat
  const byId = Object.fromEntries(res.body.items.map((g) => [g.id, g]));
  assert.strictEqual(byId.ex1.verdict, 'corect'); assert.strictEqual(byId.ex1.puncte, 10);
  assert.strictEqual(byId.ex2.verdict, 'partial'); assert.strictEqual(byId.ex2.puncte, 6); assert.strictEqual(byId.ex2.answered, true);
  assert.strictEqual(byId.ex3.verdict, 'necompletat'); assert.strictEqual(byId.ex3.puncte, 0); assert.strictEqual(byId.ex3.answered, false);
  assert.strictEqual(res.body.score, 16);
  assert.strictEqual(res.body.maxScore, 30);
});

test('grade: fără poze, mesajul rămâne text simplu și cerințele goale sunt necompletate chiar dacă modelul le punctează', async (t) => {
  stubAuth(t);
  const calls = fakeLLM(() => JSON.stringify({
    items: [
      { id: 'ex1', puncte: 10, verdict: 'corect', explicatie: 'ok', tema: 'ecuații' },
      { id: 'ex2', puncte: 10, verdict: 'corect', explicatie: 'halucinat', tema: 'procente' },
      { id: 'ex3', puncte: 10, verdict: 'corect', explicatie: 'halucinat', tema: 'arii' },
    ],
    feedback: 'f',
  }));
  const token = correct.signForm({ items: ITEMS, contentId: null, testText: TEST_TEXT, hasBarem: false, total: 30, oficiu: 0 });
  const res = fakeRes();
  await correct({ method: 'POST', headers: {}, body: { action: 'grade', token, items: ITEMS, testText: TEST_TEXT, title: 'Fișă', answers: { ex1: 'x = 3' }, images: [] } }, res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(typeof calls[0].messages.find((m) => m.role === 'user').content, 'string');
  const byId = Object.fromEntries(res.body.items.map((g) => [g.id, g]));
  assert.strictEqual(byId.ex2.verdict, 'necompletat');
  assert.strictEqual(byId.ex3.puncte, 0);
  assert.strictEqual(res.body.score, 10);
});

test('grade: nici răspunsuri, nici poze → 400 (fără apel la model)', async (t) => {
  stubAuth(t);
  const calls = fakeLLM(() => '{}');
  const token = correct.signForm({ items: ITEMS, contentId: null, testText: TEST_TEXT, hasBarem: false, total: 30, oficiu: 0 });
  const res = fakeRes();
  await correct({ method: 'POST', headers: {}, body: { action: 'grade', token, items: ITEMS, testText: TEST_TEXT, answers: {}, images: ['http://nu/e/data-url.png'] } }, res);
  assert.strictEqual(res.statusCode, 400);
  assert.match(res.body.error, /poză/);
  assert.strictEqual(calls.length, 0);
});
