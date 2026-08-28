// =====================================================================
// test/pregen-blocaj.test.js — BLOCAJUL pre-generării (pasul 3 din
// GHID_LIMITE_AI.md). Rulare: npm test
//
// Simptomul din producție: „Explicații pre-generate" înghețat, iar „De
// pre-generat" doar creștea (606 → 610 într-o dimineață), deși cronul rula.
//
// Cauza: `ai_pregen_candidates` decide după TIMP (ai_knowledge.updated_at s-a
// mișcat după ultima generare), iar processBatch decide după HASH (sursa chiar
// s-a schimbat?). O reindexare sau o reordonare bumpează updated_at fără să
// schimbe textul indexat → materialul e raportat candidat, e sărit silențios
// și RĂMÂNE candidat. Cum funcția întoarce primele N materiale ordonate după
// created_at, câțiva astfel de „zombi" ocupau tot lotul la fiecare rulare și
// pre-generarea se oprea complet. (Aceeași capcană e descrisă și în
// supabase/content_reorder_trigger.sql.)
//
// Testele de mai jos fixează comportamentul reparat: zombii se REVALIDEAZĂ
// (ies din listă), lotul NU mai e blocat de ei, iar eșecurile se raportează
// în loc să dispară în tăcere.
// =====================================================================
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
process.env.AI_PREGEN_MODEL = 'test-model';
process.env.AI_PREGEN_CONCURRENCY = '2';

const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai.js');
const pregen = require('../api/_lib/pregen.js');

const VECHI = '2020-01-01T00:00:00.000Z';

// ─── Client Supabase fals: doar operațiile pe care le folosește pregen.js ────
function makeSupa(db) {
  const calls = { rpc: [], upserts: [], updates: [] };
  function builder(table) {
    const q = { table, op: 'select', payload: null, f: {}, neq: {}, is: {} };
    const chain = {
      select() { return chain; },
      eq(c, v) { q.f[c] = v; return chain; },
      is(c, v) { q.is[c] = v; return chain; },
      neq(c, v) { q.neq[c] = v; return chain; },
      order() { return chain; },
      limit() { return chain; },
      delete() { q.op = 'delete'; return chain; },
      update(p) { q.op = 'update'; q.payload = p; return chain; },
      upsert(p) { q.op = 'upsert'; q.payload = p; return chain; },
      maybeSingle() {
        return exec(q).then((r) => ({ data: Array.isArray(r.data) ? (r.data[0] || null) : r.data, error: null }));
      },
      then(res, rej) { return exec(q).then(res, rej); },
    };
    return chain;
  }
  async function exec(q) {
    if (q.table === 'content') return { data: db.content.filter((r) => r.id === q.f.id), error: null };
    if (q.table === 'ai_knowledge') return { data: db.knowledge[q.f.source_id] || [], error: null };
    if (q.table === 'ai_pregen') {
      if (q.op === 'delete') {
        const gone = db.pregen.filter((r) =>
          ('model' in q.neq ? r.model !== q.neq.model : false) || ('model' in q.is ? r.model == null : false));
        db.pregen = db.pregen.filter((r) => !gone.includes(r));
        return { data: gone, error: null };
      }
      if (q.op === 'upsert') {
        calls.upserts.push(q.payload);
        const i = db.pregen.findIndex((r) => r.content_id === q.payload.content_id && r.kind === q.payload.kind);
        if (i >= 0) db.pregen[i] = { ...db.pregen[i], ...q.payload }; else db.pregen.push({ ...q.payload });
        return { data: null, error: null };
      }
      if (q.op === 'update') {
        const hit = db.pregen.filter((r) => r.content_id === q.f.content_id);
        calls.updates.push({ content_id: q.f.content_id, payload: q.payload, rows: hit.length });
        for (const r of hit) Object.assign(r, q.payload);
        return { data: hit, error: null };
      }
      return { data: db.pregen.filter((r) => r.content_id === q.f.content_id), error: null };
    }
    return { data: [], error: null };
  }
  return {
    from: builder,
    rpc: async (name, args) => {
      calls.rpc.push({ name, args });
      if (name !== 'ai_pregen_candidates') return { data: null, error: null };
      return { data: db.candidates.slice(0, args.p_limit).map((id) => ({ content_id: id })), error: null };
    },
    _calls: calls, _db: db,
  };
}

// material indexat, cu sau fără explicații deja generate
function seed(ids) {
  const db = { content: [], knowledge: {}, pregen: [], candidates: ids.map((x) => x.id) };
  for (const it of ids) {
    db.content.push({ id: it.id, title: `Test ${it.id}`, category: 'clasa-8', content_type: 'pdf', is_free: true });
    db.knowledge[it.id] = [{ source_type: 'exercise', chunk_index: 0, topic: 'ecuatii', content: `enunț ${it.id}` }];
  }
  return db;
}

// stub-uri: niciun apel real la model / la jurnalul de costuri
function stubChat(text = 'Explicație canonică de test.') {
  let n = 0;
  ai.chat = async () => { n++; return { text, usage: { in: 10, out: 20, model: 'test-model' } }; };
  ai.logUsage = async () => {};
  return () => n;
}

// ─── 1. Zombi: hash proaspăt, dar raportat candidat → trebuie REVALIDAT ──────
test('processBatch: material la zi raportat drept candidat → revalidat, nu regenerat', async () => {
  const db = seed([{ id: 'c1' }]);
  const supa = makeSupa(db);
  const chatCount = stubChat();
  const src = await pregen.sourceFor(supa, 'c1');
  for (const kind of pregen.KIND_LIST) {
    db.pregen.push({ content_id: 'c1', kind, text: 'vechi', model: 'test-model', source_hash: src.hash, updated_at: VECHI });
  }

  const r = await pregen.processBatch(supa, 3);

  assert.strictEqual(chatCount(), 0, 'nu se cheamă modelul pentru un material neschimbat');
  assert.strictEqual(r.pregenerated, 0);
  assert.strictEqual(r.revalidated, 1, 'materialul e revalidat, ca să iasă din lista de candidați');
  for (const row of db.pregen) {
    assert.ok(row.updated_at > VECHI, `${row.kind}: updated_at trebuie mutat înainte (era ${row.updated_at})`);
  }
});

// ─── 2. Zombii NU mai blochează lotul (regresia care oprise totul) ───────────
test('processBatch: zombii din capul listei nu mai consumă lotul de generare', async () => {
  const db = seed([{ id: 'z1' }, { id: 'z2' }, { id: 'z3' }, { id: 'nou' }]);
  const supa = makeSupa(db);
  const chatCount = stubChat();
  for (const id of ['z1', 'z2', 'z3']) {
    const src = await pregen.sourceFor(supa, id);
    for (const kind of pregen.KIND_LIST) {
      db.pregen.push({ content_id: id, kind, text: 'vechi', model: 'test-model', source_hash: src.hash, updated_at: VECHI });
    }
  }
  // „nou" nu are nimic generat; stă DUPĂ cei trei zombi în ordinea funcției

  const r = await pregen.processBatch(supa, 3);

  assert.ok(supa._calls.rpc[0].args.p_limit > 3,
    'scanăm mai multe materiale decât generăm, ca zombii să nu mai fie un zid');
  assert.strictEqual(r.revalidated, 3, 'cei trei zombi ies din listă');
  assert.strictEqual(r.pregenerated, 2, 'materialul care chiar avea nevoie primește explicație + indiciu');
  assert.strictEqual(chatCount(), 2);
  const noi = db.pregen.filter((x) => x.content_id === 'nou');
  assert.strictEqual(noi.length, 2);
  assert.ok(noi.every((x) => x.model === 'test-model' && x.source_hash && x.text));
});

// ─── 3. Eșecurile se RAPORTEAZĂ (înainte dispăreau în tăcere) ────────────────
test('processBatch: generarea eșuată e raportată și materialul NU e revalidat', async () => {
  const db = seed([{ id: 'stricat' }]);
  const supa = makeSupa(db);
  stubChat('');   // model care întoarce răspuns gol

  const r = await pregen.processBatch(supa, 3);

  assert.strictEqual(r.pregenerated, 0);
  assert.ok(!r.revalidated, 'un material cu generarea picată nu are voie să iasă din listă');
  assert.strictEqual(r.failed, 2, 'ambele feluri (explicație + indiciu) sunt raportate ca eșuate');
  assert.match(String(r.lastError), /stricat/);
});

// ─── 4. Plafonul de cost per lot rămâne în picioare ──────────────────────────
test('processBatch: nu generează mai mult decât bugetul lotului', async () => {
  const db = seed([{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }]);
  const supa = makeSupa(db);
  stubChat();

  const r = await pregen.processBatch(supa, 2);

  const generate = new Set(db.pregen.map((x) => x.content_id));
  assert.ok(generate.size <= 2 + 1, `s-au generat ${generate.size} materiale la un buget de 2 (toleranță: paralelismul)`);
  assert.ok(r.pregenerated > 0, 'dar lotul chiar face treabă');
});
