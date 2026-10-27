// =====================================================================
// test/corector-scris.test.js — „🎓 Cere corectarea" din „✍️ Spațiu de lucru"
// (27 octombrie 2026): scrisul de mână merge DIRECT la corector — fără
// „✨ Transformă în text" —, DOAR pentru Premium, STRICT după barem unde
// există; pozele cu rezolvarea din „📝 Răspunde în chat" trec prin același
// corector (api/_lib/corector.js).
//   · api/ai-handwriting.js: Premium, testul pe grupă, imaginile, baremul
//     citit DE PE SERVER, cererea către Claude (imaginile înaintea textului,
//     fără cache), rezerva GPT-5.6 Terra, cota zilnică „scris", conversația;
//   · corector: punctele ținute în limitele baremului, fără barem → fără puncte;
//   · api/ai-correct.js (grade): pozele → corectorul; fără Premium → 402;
//   · src/lib/foaie.js: tăierea foii în dale (planTiles), traseele SVG.
// Rulare: npm test
// =====================================================================
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
delete process.env.AI_CORECTOR_MODEL;
delete process.env.AI_CORECTOR_MODEL_ECON;
delete process.env.AI_CORECTOR_EFFORT;
delete process.env.AI_QUOTA_CORECTARI_SCRIS_ZI;
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai.js');
const corector = require('../api/_lib/corector.js');
const testlock = require('../api/_lib/testlock.js');
const pdfContext = require('../api/ai-pdf-context.js');
const hw = require('../api/ai-handwriting.js');
const correct = require('../api/ai-correct.js');

const PNG = 'data:image/png;base64,' + Buffer.from('foaie-scrisa-de-mana').toString('base64');
const PNG2 = 'data:image/png;base64,' + Buffer.from('a-doua-bucata').toString('base64');

// ── Supabase simulat: înregistrează ce se scrie ──────────────────────────
function supaStub(log) {
  function make(table) {
    const ops = [];
    const p = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === 'then') {
          const ins = ops.find((o) => o[0] === 'insert');
          if (ins) log.push({ table, insert: ins[1][0] });
          const out = table === 'ai_conversations' && ins ? { data: { id: 'conv-nou' }, error: null }
            : table === 'ai_messages' && ins ? { data: { id: 'msg-' + log.length }, error: null }
            : { data: null, error: null };
          return (res, rej) => Promise.resolve(out).then(res, rej);
        }
        return (...args) => { ops.push([prop, args]); return p; };
      },
    });
    return p;
  }
  return { from: (table) => make(table) };
}
function fakeRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.end = () => r;
  return r;
}
// ai-handwriting / ai-correct apelează ai.*, testlock.*, pdfContext.* prin
// obiectul modulului → le înlocuim pe durata testului
function stub(t, { premium = true, locked = false, pdf = null } = {}) {
  const saved = [];
  const patch = (obj, k, v) => { saved.push([obj, k, obj[k]]); obj[k] = v; };
  const state = { usage: [], quota: [], db: [] };
  patch(ai, 'authUser', async () => 'u-1');
  patch(ai, 'requireUser', async () => ({ id: 'u-1', role: 'elev', is_admin: false, subscription_status: premium ? 'active' : null }));
  patch(ai, 'enforceRateLimit', async () => ({ degraded: false }));
  patch(ai, 'enforceFreeQuota', async () => {});
  patch(ai, 'enforceFeatureQuota', async (supa, userId, profile, key) => { state.quota.push(key); });
  patch(ai, 'logUsage', async (supa, userId, endpoint, usage) => { state.usage.push({ endpoint, usage }); });
  patch(ai, 'admin', () => supaStub(state.db));
  patch(testlock, 'activeTest', async () => ({ locked }));
  patch(pdfContext, 'loadContentForUser', async (supa, id) => {
    if (!pdf) { const e = new Error('Material negăsit'); e.status = 404; throw e; }
    return { id, title: pdf.title, category: 'evaluare-nationala', is_free: true, file_url: 'x' };
  });
  patch(pdfContext, 'getPdfContext', async () => ({ text: pdf ? pdf.text : '', baremText: pdf ? pdf.barem : '' }));
  const origFetch = global.fetch;
  t.after(() => { for (const [obj, k, v] of saved.reverse()) obj[k] = v; global.fetch = origFetch; });
  return state;
}
// Claude (api.anthropic.com) și OpenAI (/chat/completions) simulate
function fakeApis({ claude = null, openai = null } = {}) {
  const calls = { claude: [], openai: [] };
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (String(url) === 'https://api.anthropic.com/v1/messages') {
      calls.claude.push(body);
      const out = claude ? await claude(body) : { status: 500, error: 'neprevăzut' };
      if (out.status && out.status !== 200) {
        return { ok: false, status: out.status, headers: { get: () => null }, json: async () => ({ error: { type: 'invalid_request_error', message: out.error || 'eroare' } }) };
      }
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'text', text: out.text }], stop_reason: 'end_turn', usage: { input_tokens: 3000, output_tokens: 900 } }) };
    }
    if (String(url).includes('/chat/completions')) {
      calls.openai.push(body);
      const content = openai ? await openai(body) : '{}';
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 2500, completion_tokens: 800 } }), text: async () => '' };
    }
    throw new Error('apel neașteptat: ' + url);
  };
  return calls;
}
const BUN = {
  lizibil: true,
  transcriere: '$x^2-5x+6=0$\n$\\Delta=25-24=1$\n$x_1=4$',
  itemi: [{
    eticheta: 'Subiectul III, ex. 2 a)', verdict: 'partial', puncte: 3, puncte_max: 5,
    pasi: [
      { text: '$\\Delta = 1$', verdict: 'corect', comentariu: '' },
      { text: '$x_1 = \\frac{5+1}{2} = 4$', verdict: 'gresit', comentariu: '6 împărțit la 2 dă 3, nu 4.' },
    ],
    motiv_punctaj: '2p pentru Δ, 1p pentru formula rădăcinilor; 0p la rădăcini.',
  }],
  feedback: 'Ai pornit foarte bine, cu discriminantul corect.',
  sfat: 'Refă împărțirea de la $x_1$.',
};
const call = async (body) => { const res = fakeRes(); await hw({ method: 'POST', headers: {}, body }, res); return res; };

// ─── accesul ────────────────────────────────────────────────────────────────
test('fără Premium → 402 PREMIUM_REQUIRED, fără niciun apel la model', async (t) => {
  stub(t, { premium: false });
  const calls = fakeApis({ claude: () => ({ text: JSON.stringify(BUN) }) });
  const res = await call({ action: 'correct', images: [PNG] });
  assert.strictEqual(res.statusCode, 402);
  assert.strictEqual(res.body.code, 'PREMIUM_REQUIRED');
  assert.match(res.body.error, /Premium/);
  assert.strictEqual(calls.claude.length + calls.openai.length, 0);
});

test('test pe grupă în desfășurare → 423 (corectarea e ajutor de la AI)', async (t) => {
  stub(t, { locked: true });
  const calls = fakeApis();
  const res = await call({ action: 'correct', images: [PNG] });
  assert.strictEqual(res.statusCode, 423);
  assert.strictEqual(res.body.code, 'TEST_MODE');
  assert.strictEqual(calls.claude.length + calls.openai.length, 0);
});

test('imaginile: doar data URL-uri de imagine, cel mult 6, sub limita de mărime', async (t) => {
  stub(t);
  const calls = fakeApis();
  let res = await call({ action: 'correct', images: ['http://x/y.png', 'data:text/plain;base64,AAAA'] });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(calls.claude.length, 0);
  res = await call({ action: 'transform', imageBase64: PNG, count: 1 });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'ACTION_REMOVED');
  const many = hw.cleanImages([PNG, PNG, 'nu', PNG, PNG, PNG, PNG, PNG, PNG]);
  assert.strictEqual(many.length, 6);
  assert.deepStrictEqual(hw.cleanImages(['data:image/png;base64,' + 'A'.repeat(2_300_000)]), []);
});

// ─── corectarea pe barem ────────────────────────────────────────────────────
test('test PDF: baremul vine DE PE SERVER; Claude Opus 5.5 primește imaginile ÎNAINTEA textului, fără cache; punctaj + conversație', async (t) => {
  const st = stub(t, { pdf: { title: 'EN 2026 varianta 3', text: 'SUBIECTUL al III-lea 2. a) Rezolvați ecuația x^2 - 5x + 6 = 0.', barem: 'SUBIECTUL al III-lea 2. a) Delta = 1 (2p); x1 = 3, x2 = 2 (3p). Orice altă rezolvare corectă se punctează corespunzător.' } });
  const calls = fakeApis({ claude: () => ({ text: JSON.stringify(BUN) }) });
  const res = await call({
    action: 'correct', images: [PNG, PNG2], grid: { cols: 2, rows: 1 }, thumb: 'data:image/jpeg;base64,AAAA',
    context: { pdf: true, contentId: 'c-1', title: 'EN 2026 varianta 3' },
    // un „barem" trimis din browser NU contează: serverul îl citește singur
    exerciseText: 'BAREM FALS: x1 = 4',
  });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(calls.claude.length, 1);
  assert.strictEqual(calls.openai.length, 0);
  const b = calls.claude[0];
  assert.strictEqual(b.model, 'claude-opus-5-5');
  assert.ok(b.output_config && b.output_config.format && b.output_config.format.type === 'json_schema', 'JSON pe schemă');
  assert.deepStrictEqual(b.thinking, { type: 'adaptive' });
  assert.strictEqual(b.output_config.effort, 'low');
  assert.strictEqual(typeof b.system, 'string', 'fără cache_control pe sistem (apel unic)');
  const content = b.messages[0].content;
  assert.ok(content.every((x) => !x.cache_control), 'fără cache_control în mesaj');
  const imgs = content.filter((x) => x.type === 'image');
  assert.strictEqual(imgs.length, 2);
  assert.strictEqual(imgs[0].source.media_type, 'image/png');
  assert.ok(content.findIndex((x) => x.type === 'image') < content.length - 1, 'imaginile înaintea textului');
  const text = content[content.length - 1].text;
  assert.match(text, /BAREMUL OFICIAL/);
  assert.match(text, /x1 = 3, x2 = 2/);
  assert.doesNotMatch(text, /BAREM FALS/);
  assert.match(text, /STRICT după barem/);
  assert.match(b.system, /BAREMUL este SINGURA sursă a punctajului/);
  assert.match(b.system, /NU dezvălui rezultatul final corect/);
  // etichetele bucăților foii
  assert.ok(content.some((x) => x.type === 'text' && /Imaginea 1 din 2/.test(x.text)));
  // răspunsul: punctajul, transcrierea, pașii
  assert.strictEqual(res.body.puncte, 3);
  assert.strictEqual(res.body.puncteMax, 5);
  assert.strictEqual(res.body.hasBarem, true);
  assert.match(res.body.text, /Corectarea rezolvării tale/);
  assert.match(res.body.text, /\*\*3\/5p\*\*/);
  assert.match(res.body.text, /Ce am citit pe foaie/);
  assert.match(res.body.text, /✖ \$x_1 = \\frac\{5\+1\}\{2\} = 4\$/);
  assert.match(res.body.text, /💡 Refă împărțirea/);
  // cota zilnică „scris" + costul în credite, pe endpointul numărat
  assert.deepStrictEqual(st.quota, ['scris']);
  assert.deepStrictEqual(st.usage.map((u) => u.endpoint), ['ai-handwriting:correct']);
  assert.strictEqual(st.usage[0].usage.model, 'claude-opus-5-5');
  // conversația: mesajul elevului (cu miniatura) + corectarea profesorului
  const msgs = st.db.filter((x) => x.table === 'ai_messages').map((x) => x.insert);
  assert.strictEqual(msgs.length, 2);
  assert.strictEqual(msgs[0].role, 'user');
  assert.strictEqual(msgs[0].metadata.image, 'data:image/jpeg;base64,AAAA');
  assert.strictEqual(msgs[1].role, 'assistant');
  assert.deepStrictEqual(msgs[1].metadata.handwriting.puncte, 3);
  assert.strictEqual(res.body.conversationId, 'conv-nou');
});

test('exercițiu interactiv: răspunsurile oficiale țin loc de barem (nu se dezvăluie)', async (t) => {
  stub(t);
  const calls = fakeApis({ claude: () => ({ text: JSON.stringify(BUN) }) });
  const res = await call({
    action: 'correct', images: [PNG], context: { interactive: true, contentId: 'i-1', title: 'Ecuații' },
    exerciseText: 'Exercițiul 2: Rezolvați x^2-5x+6=0 | Pasul 1: Delta | [răspuns corect — dezvăluie DOAR dacă elevul îl cere explicit: 1] | Indicația oficială: b^2-4ac',
  });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  const text = calls.claude[0].messages[0].content.at(-1).text;
  assert.match(text, /țin loc de BAREM; NU le dezvălui elevului/);
  assert.strictEqual(res.body.hasBarem, true);
});

test('fără barem: punctele dispar chiar dacă modelul le dă; mesajul spune că doar verifică pașii', async (t) => {
  stub(t);
  fakeApis({ claude: () => ({ text: JSON.stringify(BUN) }) });
  const res = await call({ action: 'correct', images: [PNG], exerciseText: 'Calculați aria unui pătrat cu latura 5 cm.' });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.hasBarem, false);
  assert.strictEqual(res.body.puncte, null);
  assert.ok(res.body.itemi.every((it) => it.puncte === null && it.puncte_max === null));
  assert.match(res.body.text, /nu am barem/);
});

test('rezerva: Claude refuză cererea → corectează modelul de vedere al platformei (GPT-5.6 Terra); ambele apeluri intră în credite, doar ultimul în cotă', async (t) => {
  const st = stub(t, { pdf: { title: 'T', text: 'Subiectul III 2 a) ecuatia', barem: 'Subiectul III 2 a) ' + 'x1 = 3, x2 = 2 (3p) '.repeat(6) } });
  const calls = fakeApis({
    claude: () => ({ status: 400, error: 'Could not process image' }),
    openai: () => JSON.stringify(BUN),
  });
  const res = await call({ action: 'correct', images: [PNG], context: { pdf: true, contentId: 'c-2' } });
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(calls.claude.length, 1);
  assert.strictEqual(calls.openai.length, 1);
  const o = calls.openai[0];
  assert.strictEqual(o.model, ai.VISION_MODEL);
  const parts = o.messages.find((m) => m.role === 'user').content;
  assert.ok(parts.some((p) => p.type === 'image_url' && p.image_url.url === PNG && p.image_url.detail === 'high'));
  assert.strictEqual(o.response_format.type, 'json_schema');
  assert.deepStrictEqual(st.usage.map((u) => u.endpoint), ['ai-handwriting:correct']);
  assert.strictEqual(res.body.puncte, 3);
});

test('corectorul nu răspunde deloc → 502 cu mesaj pentru elev (nu cel tehnic); nimic în cotă', async (t) => {
  const st = stub(t);
  fakeApis({ claude: () => ({ status: 400, error: 'boom tehnic' }), openai: () => 'nu e json' });
  const res = await call({ action: 'correct', images: [PNG], exerciseText: 'Calculați 2+2 la exercițiul de mai jos.' });
  assert.strictEqual(res.statusCode, 502);
  assert.strictEqual(res.body.code, 'CORECTARE_ESUATA');
  assert.doesNotMatch(res.body.error, /boom/);
  assert.ok(st.usage.every((u) => u.endpoint === 'ai-handwriting:retry'));
});

// ─── normalizarea răspunsului ───────────────────────────────────────────────
test('normalizeHw: punctele rămân în limitele baremului, verdictul urmează punctajul', () => {
  const r = corector.normalizeHw({
    lizibil: true, transcriere: 'x',
    itemi: [
      { eticheta: 'a)', verdict: 'corect', puncte: 9, puncte_max: 2, pasi: [], motiv_punctaj: '' },     // peste maxim → 2, corect
      { eticheta: 'b)', verdict: 'corect', puncte: 0, puncte_max: 3, pasi: [], motiv_punctaj: '' },     // 0p „corect" → greșit
      { eticheta: 'c)', verdict: 'gresit', puncte: 1.5, puncte_max: 3, pasi: [], motiv_punctaj: '' },   // 1,5p → parțial
      { eticheta: 'd)', verdict: 'ceva', puncte: -4, puncte_max: 5, pasi: [{ text: 'p', verdict: 'xx', comentariu: '' }], motiv_punctaj: '' },
    ],
    feedback: 'f', sfat: 's',
  }, { hasBarem: true });
  assert.deepStrictEqual(r.itemi.map((i) => [i.puncte, i.verdict]), [[2, 'corect'], [0, 'gresit'], [1.5, 'partial'], [0, 'gresit']]);
  assert.strictEqual(r.itemi[3].pasi[0].verdict, 'neclar');
  assert.strictEqual(r.puncte, 3.5);
  assert.strictEqual(r.puncteMax, 13);
  const fara = corector.normalizeHw({ itemi: [{ puncte: 5, puncte_max: 5, verdict: 'corect', pasi: [] }] }, { hasBarem: false });
  assert.strictEqual(fara.itemi[0].puncte, null);
  assert.strictEqual(fara.puncte, null);
  const ilizibil = corector.formatHw(corector.normalizeHw({ lizibil: false, itemi: [], feedback: 'Scrie mai mare.' }, { hasBarem: true }), { hasBarem: true });
  assert.match(ilizibil, /Nu am reușit să citesc/);
});

test('modelul: Opus 5.5 implicit, Sonnet 5.5 peste bugetul zilnic soft; prețurile 5.5 (și Haiku 5.5) sunt cunoscute', () => {
  assert.strictEqual(corector.MAIN_MODEL, 'claude-opus-5-5');
  assert.strictEqual(corector.modelFor({ degraded: false }), 'claude-opus-5-5');
  assert.strictEqual(corector.modelFor({ degraded: true }), 'claude-sonnet-5-5');
  assert.deepStrictEqual(ai.priceFor('claude-opus-5-5'), { in: 4, out: 20 });
  assert.deepStrictEqual(ai.priceFor('claude-sonnet-5-5'), { in: 2, out: 10 });
  assert.deepStrictEqual(ai.priceFor('claude-haiku-5-5'), { in: 0.1, out: 0.5 });
  assert.strictEqual(require('../api/_lib/claude.js').resolveModel('claude-haiku-5-5'), 'claude-haiku-5-5');
});

test('cota zilnică „scris" (Corectări din spațiul de lucru): fereastră pe zi, separată de pool-ul lunar', () => {
  const q = ai.FEATURE_QUOTAS.scris;
  assert.strictEqual(q.endpoint, 'ai-handwriting:correct');
  assert.strictEqual(q.window, 'day');
  assert.strictEqual(ai.quotasForRole('elev').scris, 20);
  assert.strictEqual(ai.quotasForRole('profesor').scris, 10);
});

// ─── pozele din „📝 Răspunde în chat" → același corector ────────────────────
const ITEMS = [{ id: 'ex1', eticheta: 'Exercițiul 1', puncte: 10, cerinta: 'Rezolvați $2x+4=10$' }];
const TEST_TEXT = 'Exercitiul 1. Rezolvati ecuatia 2x + 4 = 10.';
test('grade cu poze: fără Premium → 402; cu Premium → corectorul (Claude, imaginile înaintea textului), costul în „ai-correct:grade"', async (t) => {
  stub(t, { premium: false });
  const calls = fakeApis({ claude: () => ({ text: JSON.stringify({ items: [{ id: 'ex1', puncte: 10, verdict: 'corect', explicatie: 'ok', tema: 'ecuații' }], feedback: 'Bravo.' }) }) });
  const token = correct.signForm({ items: ITEMS, contentId: null, testText: TEST_TEXT, hasBarem: false, total: 10, oficiu: 0 });
  const body = { action: 'grade', token, items: ITEMS, testText: TEST_TEXT, title: 'Fișă', answers: {}, images: [PNG] };
  const res = fakeRes();
  await correct({ method: 'POST', headers: {}, body }, res);
  assert.strictEqual(res.statusCode, 402);
  assert.strictEqual(res.body.code, 'PREMIUM_REQUIRED');
  assert.strictEqual(calls.claude.length + calls.openai.length, 0);
});

test('grade cu poze, cu Premium: corectorul Claude citește pozele; cerința rezolvată doar în poză e punctată', async (t) => {
  const st = stub(t, { premium: true });
  const calls = fakeApis({ claude: () => ({ text: JSON.stringify({ items: [{ id: 'ex1', puncte: 10, verdict: 'corect', explicatie: 'Corect, $x=3$.', tema: 'ecuații' }], feedback: 'Bravo.' }) }) });
  const token = correct.signForm({ items: ITEMS, contentId: null, testText: TEST_TEXT, hasBarem: false, total: 10, oficiu: 0 });
  const res = fakeRes();
  await correct({ method: 'POST', headers: {}, body: { action: 'grade', token, items: ITEMS, testText: TEST_TEXT, title: 'Fișă', answers: {}, images: [PNG] } }, res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(calls.claude.length, 1);
  assert.strictEqual(calls.openai.length, 0);
  const content = calls.claude[0].messages[0].content;
  assert.strictEqual(content[0].type, 'image');
  assert.match(content.at(-1).text, /POZE CU REZOLVAREA SCRISĂ DE MÂNĂ \(1\)/);
  assert.match(content.at(-1).text, /Scrisul poate fi urât/);
  assert.strictEqual(res.body.items[0].puncte, 10);
  assert.strictEqual(res.body.items[0].answered, true);
  assert.ok(st.usage.some((u) => u.endpoint === 'ai-correct:grade' && u.usage.model === 'claude-opus-5-5'));
});

// ─── foaia: dalele imaginii și traseele ─────────────────────────────────────
test('planTiles: o dală pentru o rezolvare obișnuită; foaia lată se taie în coloane suprapuse; foaia uriașă se micșorează (≤ 6 dale)', async (t) => {
  const F = await import('../src/lib/foaie.js').catch(() => null);
  if (!F) { t.skip('Node fără import ESM'); return; }
  let p = F.planTiles(900, 500);
  assert.deepStrictEqual([p.cols, p.rows, p.scale, p.tiles.length], [1, 1, 1, 1]);
  assert.deepStrictEqual([p.tiles[0].w, p.tiles[0].h], [900, 500]);
  // 4 ecrane spre dreapta (elevul a „întors pagina" de 3 ori)
  p = F.planTiles(5200, 700);
  assert.strictEqual(p.rows, 1);
  assert.strictEqual(p.cols, 3);
  assert.strictEqual(p.scale, 1, 'scrisul rămâne la mărimea reală');
  const ts = p.tiles;
  assert.strictEqual(ts[0].x, 0);
  assert.strictEqual(ts.at(-1).x + ts.at(-1).w, 5200, 'acoperă toată lățimea');
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i - 1].x + ts[i - 1].w - ts[i].x >= F.TILE_OVER, 'dalele se suprapun');
  assert.ok(ts.every((x) => x.w <= F.TILE_W && x.h <= F.TILE_H));
  // foarte mult scris → scara scade, dar tot ≤ 6 dale
  p = F.planTiles(20000, 3000);
  assert.ok(p.scale < 1);
  assert.ok(p.tiles.length <= F.MAX_TILES);
});

test('pathD: punct, segment, curbă netedă', async (t) => {
  const F = await import('../src/lib/foaie.js').catch(() => null);
  if (!F) { t.skip('Node fără import ESM'); return; }
  assert.strictEqual(F.pathD([[10, 20]]), 'M10 20l0.01 0');
  assert.strictEqual(F.pathD([[0, 0], [5, 5]]), 'M0 0L5 5');
  assert.strictEqual(F.pathD([[0, 0], [10, 0], [20, 10]]), 'M0 0Q10 0 15 5L20 10');
  assert.strictEqual(F.pathD([]), '');
  assert.deepStrictEqual(F.unionBox([{ x0: 1, y0: 2, x1: 3, y1: 4 }, null, { x0: -1, y0: 5, x1: 2, y1: 9 }]), { x0: -1, y0: 2, x1: 3, y1: 9 });
});

test('compactGaps: paginile goale dintre scrisuri se strâng în imagine, ordinea de la stânga la dreapta rămâne', async (t) => {
  const F = await import('../src/lib/foaie.js').catch(() => null);
  if (!F) { t.skip('Node fără import ESM'); return; }
  const st = (id, x0, x1) => ({ id, color: '#000', pts: [[x0, 50], [x1, 80]] });
  // pagina 1: 40–430; pagina 2 (după „➕ Pagină nouă"): 1140–1500; pagina 3: 2240–2600
  const out = F.compactGaps([st(1, 40, 200), st(2, 230, 430), st(3, 1140, 1500), st(4, 2240, 2600)]);
  const xs = out.sort((a, b) => a.id - b.id).map((s) => [s.box.x0, s.box.x1]);
  assert.deepStrictEqual(xs[0], [40, 200]);
  assert.deepStrictEqual(xs[1], [230, 430], 'golul mic (30 px) rămâne');
  assert.deepStrictEqual(xs[2], [500, 860], 'golul mare se strânge la 70 px');
  assert.deepStrictEqual(xs[3], [930, 1290]);
  // un singur bloc de scris → neatins (aceleași obiecte)
  const one = [st(1, 0, 100), st(2, 120, 300)];
  assert.strictEqual(F.compactGaps(one), one);
});
