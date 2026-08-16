// Teste pentru modelele prin Vercel AI Gateway (id-uri cu prefix de provider,
// ex. „openai/gpt-4o-mini") + pre-generarea pe modelul de PDF (node --test):
// 1) prețurile trebuie să se potrivească ȘI cu prefix — altfel orice apel prin
//    gateway cădea pe prețul implicit conservator (3/15 USD), costul lui
//    gpt-4o-mini ieșea umflat ~20×, bugetul zilnic soft se „termina" după
//    câteva mesaje și pickModel retrograda terra înapoi pe modelul de chat;
// 2) implicitele derivate (PDF, economic) moștenesc prefixul providerului;
// 3) pre-generarea folosește modelul de PDF și își purjează cache-ul generat
//    cu modele vechi (intrările se regenerează cu modelul curent).
process.env.AI_CHAT_API_KEY = 'test-key';
process.env.AI_CHAT_MODEL = 'openai/gpt-4o-mini';
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai');
const pregen = require('../api/_lib/pregen');

test('prețuri: id-ul cu prefix de gateway = id-ul simplu', () => {
  assert.deepStrictEqual(ai.priceFor('openai/gpt-5.6-terra'), ai.priceFor('gpt-5.6-terra'));
  assert.deepStrictEqual(ai.priceFor('openai/gpt-4o-mini'), ai.priceFor('gpt-4o-mini'));
  assert.deepStrictEqual(ai.priceFor('anthropic/claude-opus-5'), ai.priceFor('claude-opus-5'));
});

test('gpt-4o-mini prin gateway nu mai costă cât prețul implicit (~20×)', () => {
  const big = { in: 1_000_000, out: 1_000_000 };
  const viaGateway = ai.costMicroLei('openai/gpt-4o-mini', big);
  assert.strictEqual(viaGateway, ai.costMicroLei('gpt-4o-mini', big));
  // modelul necunoscut primește prețul implicit — mult peste 4o-mini
  assert.ok(ai.costMicroLei('model-necunoscut-xyz', big) > 10 * viaGateway);
});

test('implicitele moștenesc prefixul providerului din AI_CHAT_MODEL', () => {
  // fără AI_PDF_CHAT_MODEL / AI_ECON_CHAT_MODEL în env, implicitele vin cu prefix
  assert.strictEqual(ai.PDF_MODEL, 'openai/gpt-5.6-terra');
  assert.strictEqual(ai.ECON_CHAT_MODEL, 'openai/gpt-4o-mini');
});

test('degradarea peste buget rămâne coerentă cu id-uri prefixate', () => {
  assert.strictEqual(ai.pickModel(ai.PDF_MODEL, { degraded: true }), ai.CHAT_MODEL);
  assert.strictEqual(ai.pickModel(ai.CHAT_MODEL, { degraded: true }), ai.ECON_CHAT_MODEL);
});

test('pre-generarea purjează intrările făcute cu ALT model decât cel curent', async () => {
  const calls = [];
  const supa = {
    from: (table) => ({
      delete: () => ({
        neq: (col, val) => { calls.push(['neq', table, col, val]); return { select: async () => ({ data: [{}, {}], error: null }) }; },
        is: (col, val) => { calls.push(['is', table, col, val]); return { select: async () => ({ data: [], error: null }) }; },
      }),
    }),
    rpc: async (fn) => { calls.push(['rpc', fn]); return { data: [], error: null }; },
  };
  const r = await pregen.processBatch(supa, 2);
  // 1. șterge intrările cu model diferit de cel configurat (implicit: modelul de PDF)
  assert.deepStrictEqual(calls[0], ['neq', 'ai_pregen', 'model', ai.PDF_MODEL]);
  // 2. șterge și intrările fără model (nu le-ar prinde .neq)
  assert.deepStrictEqual(calls[1], ['is', 'ai_pregen', 'model', null]);
  // 3. abia apoi cere candidații — cei șterși redevin „lipsă" și se regenerează
  assert.deepStrictEqual(calls[2], ['rpc', 'ai_pregen_candidates']);
  assert.strictEqual(r.purged, 2);
});
