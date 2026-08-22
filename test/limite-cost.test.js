// =====================================================================
// test/limite-cost.test.js — calculul de cost + degradarea pe model ieftin
// (sistemul de limite de consum AI — vezi GHID_LIMITE_AI.md)
// Rulare: npm test   (node --test test/*.test.js)
// Testele NU depind de valorile din env: așteptările se calculează din
// prețurile/cursul exportate de api/_lib/ai.js, deci trec și dacă
// personalizezi AI_USD_RON / AI_CHAT_MODEL / AI_PRICES_JSON.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai.js');

const expectedMicro = (model, usage) => {
  const p = ai.priceFor(model);
  const usd = p.perCall != null
    ? p.perCall
    : ((usage.in || 0) * (p.in || 0) + (usage.out || 0) * (p.out || 0)) / 1e6;
  return Math.round(usd * ai.USD_RON * 1e6);
};

test('priceFor: potrivire pe cel mai lung prefix', () => {
  // un sufix de snapshot nimerește intrarea modelului (terra are intrarea ei)
  assert.deepStrictEqual(ai.priceFor('gpt-5.6-terra-2026-08-01'), ai.priceFor('gpt-5.6-terra'));
  // o variantă gpt-5.6 FĂRĂ intrare proprie cade pe intrarea de bază „gpt-5.6"
  assert.deepStrictEqual(ai.priceFor('gpt-5.6-varianta-noua'), ai.priceFor('gpt-5.6'));
  // dar un model mai specific NU cade pe prefixul mai scurt
  assert.notDeepStrictEqual(ai.priceFor('gpt-5-nano'), ai.priceFor('gpt-5'));
  // snapshot-urile datate Claude nimeresc modelul de bază
  assert.deepStrictEqual(ai.priceFor('claude-haiku-4-5-20251001'), ai.priceFor('claude-haiku-4-5'));
  // case-insensitive
  assert.deepStrictEqual(ai.priceFor('GPT-4o-mini'), ai.priceFor('gpt-4o-mini'));
});

test('costMicroLei: tokeni × preț × curs, rotunjit la micro-lei', () => {
  const usage = { in: 3000, out: 800 };
  assert.strictEqual(ai.costMicroLei('gpt-4o-mini', usage), expectedMicro('gpt-4o-mini', usage));
  const big = { in: 10000, out: 3000 };
  assert.strictEqual(ai.costMicroLei('gpt-5.6-terra', big), expectedMicro('gpt-5.6-terra', big));
  // modelul premium trebuie să coste mult mai mult decât mini, la același usage
  // (terra 2/12 vs 4o-mini 0,15/0,60 USD/1M → ~17× la acest usage)
  assert.ok(ai.costMicroLei('gpt-5.6-terra', big) > 10 * ai.costMicroLei('gpt-4o-mini', big));
});

test('priceFor: cele trei mărimi gpt-5.6 au prețuri DIFERITE (terra ≠ sol)', () => {
  // Regresie: terra cădea pe intrarea comună „gpt-5.6" (5/30 = prețul lui sol)
  // și era contorizată de 2,5× mai scump decât costă → degradare prematură.
  const usage = { in: 10000, out: 3000 };
  const luna = ai.costMicroLei('gpt-5.6-luna', usage);
  const terra = ai.costMicroLei('gpt-5.6-terra', usage);
  const sol = ai.costMicroLei('gpt-5.6-sol', usage);
  assert.ok(luna < terra && terra < sol, `luna ${luna} < terra ${terra} < sol ${sol}`);
  // terra nu mai moștenește prețul conservator al intrării de bază
  assert.ok(terra < ai.costMicroLei('gpt-5.6', usage), 'terra sub intrarea de bază gpt-5.6');
  assert.notDeepStrictEqual(ai.priceFor('gpt-5.6-terra'), ai.priceFor('gpt-5.6-sol'));
});

test('costMicroLei: fără model → 0 (acțiuni fără LLM)', () => {
  assert.strictEqual(ai.costMicroLei(null, { in: 5000, out: 5000 }), 0);
  assert.strictEqual(ai.costMicroLei('', {}), 0);
  assert.strictEqual(ai.costMicroLei(undefined, {}), 0);
});

test('costMicroLei: whisper se tarifează per apel, nu pe tokeni', () => {
  const cost = ai.costMicroLei('whisper-1', {});
  assert.ok(cost > 0, 'whisper are cost fix per apel');
  assert.strictEqual(ai.costMicroLei('whisper-1', { in: 99999, out: 99999 }), cost, 'tokenii nu contează la STT');
});

test('costMicroLei: model necunoscut → prețul implicit conservator (nu 0)', () => {
  assert.ok(ai.costMicroLei('un-model-inexistent-xyz', { in: 1000, out: 1000 }) > 0);
});

test('dayStartBucharest: fix miezul nopții pe ora României, în ultimele 24h', () => {
  const ds = ai.dayStartBucharest();
  assert.ok(!Number.isNaN(Date.parse(ds)), 'ISO valid');
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Bucharest', hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ds)).map((x) => [x.type, x.value]));
  assert.strictEqual((+p.hour % 24) * 3600 + (+p.minute) * 60 + (+p.second), 0, 'ora 00:00:00 la București');
  const age = Date.now() - Date.parse(ds);
  assert.ok(age >= 0 && age < 24 * 3600 * 1000 + 2000, 'nu e în viitor și nu e mai vechi de o zi');
});

test('pickModel: degradarea coboară premium → standard și chat → economic', () => {
  const premium = 'gpt-5.6-terra';
  // sub limite (sau fără stare) → modelul cerut rămâne
  assert.strictEqual(ai.pickModel(premium, { degraded: false }), premium);
  assert.strictEqual(ai.pickModel(premium, null), premium);
  assert.strictEqual(ai.pickModel(premium, undefined), premium);
  // peste limita zilnică soft
  assert.strictEqual(ai.pickModel(premium, { degraded: true }), ai.CHAT_MODEL, 'premium → modelul standard');
  assert.strictEqual(ai.pickModel(ai.CHAT_MODEL, { degraded: true }), ai.ECON_CHAT_MODEL, 'chat → modelul economic');
});
