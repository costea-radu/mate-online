// =====================================================================
// test/cost-ai.test.js — 12 noiembrie 2026, „costul cu AI":
//   1) explicația PRE-GENERATĂ se servește înaintea limitelor și a RAG-ului:
//      fără model, fără embeddings, fără să consume acțiunile AI gratuite;
//   2) acțiunile gratuite nu numără servirile cu cost 0 (AI_PREGEN_IN_COTA=1 = ca înainte);
//   3) întrebările gratuite PE ZI în chat (AI_FREE_CHAT_DAILY; implicit oprit),
//      pe modelul economic;
//   4) panoul de statistici numește separat costurile „de fond".
// (Păstrarea explicațiilor la schimbarea modelului: test/gateway-model.test.js.)
// Fără rețea: Supabase în memorie, modelul și RAG-ul înlocuite.
// =====================================================================
process.env.AI_CHAT_API_KEY = process.env.AI_CHAT_API_KEY || 'test-key';
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const pregen = require('../api/_lib/pregen');

const GRATUIT = '11111111-1111-4111-8111-111111111111';   // cont fără abonament, acțiunile de probă folosite
const ABONAT = '22222222-2222-4222-8222-222222222222';
const NOU = '33333333-3333-4333-8333-333333333333';       // cont fără abonament, nicio acțiune AI
const C_LIBER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';   // material gratuit
const C_PREMIUM = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EXPLICATIE = 'Fracțiile se adună aducându-le la același numitor: $\\frac{1}{2}+\\frac{1}{3}=\\frac{5}{6}$.';
const ieri = () => new Date(Date.now() - 30 * 3600 * 1000).toISOString();
const acum = () => new Date().toISOString();

function baza() {
  return createFakeSupabase({
    profiles: [
      { id: GRATUIT, subscription_status: null, role: 'elev', is_admin: false },
      { id: ABONAT, subscription_status: 'active', role: 'elev', is_admin: false },
      { id: NOU, subscription_status: null, role: 'elev', is_admin: false },
    ],
    content: [
      { id: C_LIBER, title: 'Adunarea fracțiilor', category: 'clasa-5', is_free: true },
      { id: C_PREMIUM, title: 'Varianta 3 — Evaluare Națională', category: 'evaluare-nationala', is_free: false },
    ],
    ai_pregen: [
      { content_id: C_LIBER, kind: 'explain', text: EXPLICATIE, model: 'model-vechi' },
      { content_id: C_LIBER, kind: 'hint', text: 'Uită-te întâi la numitori. Sunt la fel?', model: 'model-vechi' },
      { content_id: C_PREMIUM, kind: 'explain', text: 'Explicația variantei 3.', model: 'model-vechi' },
    ],
    ai_usage: [
      { user_id: GRATUIT, endpoint: 'ai-chat', created_at: ieri() },
      { user_id: GRATUIT, endpoint: 'ai-vision', created_at: ieri() },
    ],
    ai_conversations: [], ai_messages: [],
  });
}
// fakeSupabase nu face JOIN-ul „content:content_id ( … )" din getServable — îl facem aici
function cuPregen(fake) {
  return {
    ...fake,
    from(table) {
      if (table !== 'ai_pregen') return fake.from(table);
      const f = {};
      const q = {
        select: () => q,
        eq: (c, v) => { f[c] = v; return q; },
        maybeSingle: async () => {
          const row = (fake.db.tables.ai_pregen || []).find((r) => r.content_id === f.content_id && r.kind === f.kind);
          if (!row) return { data: null, error: null };
          const c = (fake.db.tables.content || []).find((x) => x.id === row.content_id);
          return { data: { text: row.text, model: row.model, content: c ? { is_free: c.is_free, title: c.title, category: c.category } : null }, error: null };
        },
      };
      return q;
    },
  };
}

// handlerul cu modelul și RAG-ul numărate
function pregatit(t, fake) {
  const saved = { admin: ai.admin, authUser: ai.authUser, chat: ai.chat, chatStream: ai.chatStream, prepareChat: ai.prepareChat };
  const st = { cine: GRATUIT, model: 0, rag: 0 };
  const supa = cuPregen(fake);
  ai.admin = () => supa;
  ai.authUser = async () => st.cine;
  ai.chat = async () => { st.model++; return { text: 'Răspuns de la model.', usage: { in: 10, out: 10, model: 'test' } }; };
  ai.chatStream = async function* () { st.model++; yield 'Răspuns '; yield 'de la model.'; };
  ai.prepareChat = async (s, o) => {
    st.rag++;
    const convId = await ai.openConversation(s, { userId: o.userId, conversationId: o.conversationId, message: o.message, context: o.context });
    return { convId, primaryMaterial: null, priorMsgs: [], system: 's', sources: [], baremItem: null, regenerated: false, attachments: [], tools: null };
  };
  t.after(() => Object.assign(ai, saved));
  return st;
}
const chat = require('../api/ai-chat');
const chatStream = require('../api/ai-chat-stream');
async function cere(body) { const res = fakeRes(); await chat({ method: 'POST', headers: {}, query: {}, body }, res); return res; }
async function cereFlux(body) {
  const res = fakeRes();
  const linii = [];
  res.write = (s) => { linii.push(...String(s).split('\n').filter(Boolean).map((l) => JSON.parse(l))); return true; };
  await chatStream({ method: 'POST', headers: {}, query: {}, body }, res);
  return linii;
}

test('explicația pre-generată: fără model, fără RAG și fără să consume acțiunile gratuite', async (t) => {
  const fake = baza();
  const st = pregatit(t, fake);
  const explica = { message: 'Explică-mi exercițiul', mode: 'explain', context: { contentId: C_LIBER } };

  // contul și-a folosit acțiunile de probă, dar explicația gata făcută tot o primește
  const r = await cere(explica);
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.reply, EXPLICATIE);
  assert.deepStrictEqual(r.body.sources, [{ type: 'exercise', title: 'Adunarea fracțiilor', topic: null, category: 'clasa-5' }]);
  assert.strictEqual(r.body.aiBudget, null);
  assert.deepStrictEqual([st.model, st.rag], [0, 0], 'niciun apel la model, nicio căutare în cunoștințe');
  const u = fake.db.tables.ai_usage[fake.db.tables.ai_usage.length - 1];
  assert.deepStrictEqual([u.endpoint, u.tokens_in, u.tokens_out, u.cost_micro], ['ai-chat:pregen', 0, 0, 0]);
  const m = fake.db.tables.ai_messages;
  assert.deepStrictEqual(m.map((x) => [x.role, x.mode]), [['user', 'explain'], ['assistant', 'explain']]);
  assert.strictEqual(m[1].metadata.pregen, true);
  assert.strictEqual(fake.db.tables.ai_conversations.length, 1);

  // întrebarea următoare din aceeași conversație e o cerere AI adevărată → abonament
  const urm = await cere({ ...explica, message: 'De ce același numitor?', conversationId: r.body.conversationId });
  assert.strictEqual(urm.statusCode, 402);
  assert.strictEqual(urm.body.code, 'PREMIUM_REQUIRED');
  assert.match(urm.body.error, /Ai folosit cele 2 acțiuni gratuite/);

  // nu se servește: material premium la cont gratuit, poză atașată, „Regenerează", întrebare specifică
  for (const b of [
    { ...explica, context: { contentId: C_PREMIUM } },
    { ...explica, images: ['data:image/jpeg;base64,AAAA'] },
    { ...explica, context: { contentId: C_LIBER, attachedText: 'lucrarea mea' } },
    { ...explica, regenerate: true },
    { ...explica, message: 'De ce la exercițiul 3 se înmulțește cu 6 și nu cu 12, cum am făcut eu în caiet la școală?' },
  ]) {
    const x = await cere(b);
    assert.strictEqual(x.statusCode, 402, JSON.stringify(b).slice(0, 80));
  }
  assert.deepStrictEqual([st.model, st.rag], [0, 0]);

  // abonatul primește și explicația materialului premium, tot fără model
  st.cine = ABONAT;
  const p = await cere({ ...explica, context: { contentId: C_PREMIUM } });
  assert.strictEqual(p.body.reply, 'Explicația variantei 3.');
  // …iar întrebarea lui specifică merge la model, ca înainte
  const q = await cere({ ...explica, message: 'De ce la exercițiul 3 se înmulțește cu 6 și nu cu 12, cum am făcut eu în caiet la școală?' });
  assert.strictEqual(q.statusCode, 200, JSON.stringify(q.body));
  assert.match(q.body.reply, /^Răspuns de la model\./);
  assert.deepStrictEqual([st.model, st.rag], [1, 1]);
  assert.strictEqual(fake.db.tables.ai_usage[fake.db.tables.ai_usage.length - 1].endpoint, 'ai-chat');
});

test('pe flux: meta → bucăți → done, cu id-ul mesajului salvat', async (t) => {
  const fake = baza();
  const st = pregatit(t, fake);
  const linii = await cereFlux({ message: 'dă-mi un indiciu', mode: 'hint', context: { contentId: C_LIBER } });
  assert.deepStrictEqual(linii.map((l) => l.type), ['meta', 'delta', 'done']);
  assert.strictEqual(linii[0].sources[0].title, 'Adunarea fracțiilor');
  assert.strictEqual(linii[1].text, 'Uită-te întâi la numitori. Sunt la fel?');
  const salvat = fake.db.tables.ai_messages.find((x) => x.role === 'assistant');
  assert.strictEqual(linii[2].messageId, salvat.id);
  assert.strictEqual(linii[2].aiBudget, null);
  assert.strictEqual(fake.db.tables.ai_usage[fake.db.tables.ai_usage.length - 1].endpoint, 'ai-chat-stream:pregen');
  assert.deepStrictEqual([st.model, st.rag], [0, 0]);
  // fără explicație pre-generată pentru felul cerut → fluxul normal (aici: oprit de acțiunile gratuite)
  const fara = await cereFlux({ message: 'dă-mi un indiciu', mode: 'hint', context: { contentId: C_PREMIUM } });
  assert.deepStrictEqual(fara.map((l) => [l.type, l.code]), [['error', 'PREMIUM_REQUIRED']]);
  // abonatul, cu întrebare specifică: modelul, pe flux
  st.cine = ABONAT;
  const model = await cereFlux({ message: 'de ce nu pot aduna direct numărătorii între ei, fără numitor comun, aici?', mode: 'explain', context: { contentId: C_LIBER } });
  assert.strictEqual(model.filter((l) => l.type === 'delta').map((l) => l.text).join('').startsWith('Răspuns de la model.'), true);
  assert.deepStrictEqual([st.model, st.rag], [1, 1]);
});

test('acțiunile gratuite: servirile cu cost 0 nu se numără; limita orară le numără', async (t) => {
  const fake = baza();
  const st = pregatit(t, fake);
  st.cine = NOU;
  for (let i = 0; i < 4; i++) {
    const r = await cere({ message: 'explică-mi', mode: 'explain', context: { contentId: C_LIBER } });
    assert.strictEqual(r.statusCode, 200);
  }
  const profil = { id: NOU, subscription_status: null };
  assert.strictEqual(await ai.enforceFreeQuota(fake, profil), null, 'cele 4 explicații gata făcute nu i-au consumat acțiunile de probă');
  assert.deepStrictEqual(ai.SERVIRI_FARA_COST, ['ai-chat:pregen', 'ai-chat-stream:pregen']);
  // o cerere AI adevărată încă merge (are 2 de probă)
  const real = await cere({ message: 'cum rezolv ecuația 2x + 3 = 11 dacă x trebuie să fie număr natural par?', mode: 'tutor', context: {} });
  assert.strictEqual(real.statusCode, 200, JSON.stringify(real.body));
  assert.strictEqual(st.model, 1);

  // AI_PREGEN_IN_COTA=1: ca înainte — servirile se numără și se opresc la epuizare
  process.env.AI_PREGEN_IN_COTA = '1';
  t.after(() => { delete process.env.AI_PREGEN_IN_COTA; });
  await assert.rejects(() => ai.enforceFreeQuota(fake, profil), (e) => e.status === 402 && e.code === 'PREMIUM_REQUIRED');
  const oprit = await cere({ message: 'explică-mi', mode: 'explain', context: { contentId: C_LIBER } });
  assert.strictEqual(oprit.statusCode, 402);
  delete process.env.AI_PREGEN_IN_COTA;

  // limita orară (frâna la abuz) numără și servirile gratuite
  const filtre = [];
  const q = new Proxy({}, { get(_, prop) { return prop === 'then' ? (res) => res({ count: 0 }) : (...a) => { filtre.push([prop, ...a.filter((x) => typeof x === 'string')]); return q; }; } });
  await ai.enforceRateLimit({ from: () => q }, NOU, null, { budgets: false });
  assert.deepStrictEqual(filtre.filter((f) => f[0] === 'neq'), [['neq', 'endpoint', 'voce'], ['neq', 'endpoint', 'rezolva-pdf:grila']]);
});

test('întrebările gratuite pe zi în chat: oprite implicit; pornite, doar chatul și pe modelul economic', async (t) => {
  const fake = baza();
  const profil = { id: GRATUIT, subscription_status: null };
  t.after(() => { delete process.env.AI_FREE_CHAT_DAILY; });

  // implicit (0): după acțiunile de probă, abonament — ca până acum
  delete process.env.AI_FREE_CHAT_DAILY;
  await assert.rejects(() => ai.enforceFreeQuota(fake, profil, { chat: true }), (e) => e.status === 402 && /cele 2 acțiuni gratuite/.test(e.message));

  process.env.AI_FREE_CHAT_DAILY = '3';
  // chatul: 3 pe zi (cele de ieri nu se numără azi)
  assert.deepStrictEqual(await ai.enforceFreeQuota(fake, profil, { chat: true }), { zilnic: true, ramase: 2 });
  // foto-rezolvarea, corectarea, dictarea, antrenamentul: rămân la abonament
  await assert.rejects(() => ai.enforceFreeQuota(fake, profil), (e) => e.status === 402 && /cele 2 acțiuni gratuite/.test(e.message));
  // servirile cu cost 0 și celelalte funcții nu consumă întrebările zilei
  fake.db.tables.ai_usage.push(
    { user_id: GRATUIT, endpoint: 'ai-chat:pregen', created_at: acum() },
    { user_id: GRATUIT, endpoint: 'ai-chat-stream', created_at: acum() },
    { user_id: GRATUIT, endpoint: 'ai-chat', created_at: acum() },
  );
  assert.deepStrictEqual(await ai.enforceFreeQuota(fake, profil, { chat: true }), { zilnic: true, ramase: 0 });
  fake.db.tables.ai_usage.push({ user_id: GRATUIT, endpoint: 'ai-chat', created_at: acum() });
  await assert.rejects(() => ai.enforceFreeQuota(fake, profil, { chat: true }),
    (e) => e.status === 402 && e.code === 'PREMIUM_REQUIRED' && /cele 3 întrebări gratuite de azi/.test(e.message) && /Revino mâine sau abonează-te/.test(e.message));
  // abonatul și contul încă în acțiunile de probă nu sunt atinși
  assert.strictEqual(await ai.enforceFreeQuota(fake, { id: ABONAT, subscription_status: 'active' }, { chat: true }), null);
  assert.strictEqual(await ai.enforceFreeQuota(fake, { id: NOU, subscription_status: null }, { chat: true }), null);

  // întrebarea gratuită a zilei → modelul economic (aceeași coborâre ca peste bugetul zilnic soft)
  const lim = ai.limitsFor({ degraded: false, monthLei: 0 }, { zilnic: true, ramase: 1 });
  assert.strictEqual(lim.degraded, true);
  assert.strictEqual(ai.pickModel(ai.CHAT_MODEL, lim), ai.ECON_CHAT_MODEL);
  assert.strictEqual(ai.pickModel(ai.PDF_MODEL, lim), ai.CHAT_MODEL);
  const neschimbat = { degraded: false };
  assert.strictEqual(ai.limitsFor(neschimbat, null), neschimbat);

  // în handler: chatul cere cota cu { chat: true }
  const fs = require('node:fs');
  const path = require('node:path');
  for (const f of ['api/ai-chat.js', 'api/ai-chat-stream.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(src, /const lim = ai\.limitsFor\(lim0, await ai\.enforceFreeQuota\(supa, profile, \{ chat: true \}\)\);/, f);
    // servirea pre-generată stă înaintea limitelor și a RAG-ului
    assert.ok(src.indexOf('pregen.serveFirst(') < src.indexOf('ai.enforceRateLimit('), f);
    assert.ok(src.indexOf('pregen.serveFirst(') < src.indexOf('ai.prepareChat('), f);
    assert.ok(src.indexOf('siteGuide.route(') < src.indexOf('pregen.serveFirst('), f);
    assert.ok(src.indexOf('testlock.activeTest(') < src.indexOf('pregen.serveFirst('), `${f}: testul pe grupă oprește și explicația gata făcută`);
  }
  for (const f of ['api/ai-vision.js', 'api/ai-transcribe.js', 'api/ai-correct.js', 'api/ai-practice.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    assert.match(src, /ai\.enforceFreeQuota\(supa, profile\);/, f);
  }
});

test('canServe: fără poză, fără material încărcat, fără „Regenerează"', () => {
  const base = { mode: 'explain', context: { contentId: 'abc' }, conversationId: null, message: 'explica-mi' };
  assert.ok(pregen.canServe(base));
  assert.ok(pregen.canServe({ ...base, images: [] }));
  assert.ok(!pregen.canServe({ ...base, images: ['data:image/png;base64,AA'] }));
  assert.ok(!pregen.canServe({ ...base, context: { contentId: 'abc', attachedText: ' enunțul din poză ' } }));
  assert.ok(pregen.canServe({ ...base, context: { contentId: 'abc', attachedText: '  ' } }));
  assert.ok(!pregen.canServe({ ...base, regenerate: true }));
  assert.ok(!pregen.canServe({ ...base, context: null }));
});

test('statistici: costurile de fond au nume proprii; paginile claselor sunt recunoscute', async () => {
  const S = await import('../src/lib/statistici.js');
  assert.strictEqual(S.numeFunctieAI('ai-pregen'), '🧠 Explicații pre-generate (o dată per material)');
  assert.strictEqual(S.numeFunctieAI('live-lectie'), '🔴 Meditații live · scrierea lecțiilor');
  assert.strictEqual(S.numeFunctieAI('live-pasi'), '🔴 Meditații live · întrebările pe pași');
  assert.strictEqual(S.numeFunctieAI('live-chat'), '🔴 Meditații live · întrebări în sală');
  assert.strictEqual(S.numeFunctieAI('pregatire-chat'), '🎯 Pregătirea de examen · întrebări');
  assert.strictEqual(S.numeFunctieAI('fise'), '📄 Transcrierea fișelor');
  assert.strictEqual(S.numeFunctieAI('live'), '🔴 Meditații live');
  assert.strictEqual(S.numePagina('/clase/5'), 'Clasa a V-a');
  assert.strictEqual(S.numePagina('/clase/12'), 'Clasa a XII-a');
  assert.strictEqual(S.numePagina('/clase/clasa-8'), 'Clasa a VIII-a');
  assert.strictEqual(S.numePagina('/pregateste-ma'), 'Pregătește-mă de examen (testul zilei)');
  assert.strictEqual(S.numePagina('/asociere'), 'Asociere (invitație profesor / părinte)');
});
