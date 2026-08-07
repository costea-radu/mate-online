// =====================================================================
// test/limite-topup.test.js — pachetele top-up + cotele per funcție
// (pasul 2 al limitelor de consum AI — vezi GHID_LIMITE_AI.md)
// Rulare: npm test   (node --test test/*.test.js)
// topupPacks() citește env-ul LA APEL (nu la import), deci îl putem varia.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai.js');

function withPacksEnv(value, fn) {
  const prev = process.env.AI_TOPUP_PACKS_JSON;
  if (value === undefined) delete process.env.AI_TOPUP_PACKS_JSON;
  else process.env.AI_TOPUP_PACKS_JSON = value;
  try { return fn(); }
  finally {
    if (prev === undefined) delete process.env.AI_TOPUP_PACKS_JSON;
    else process.env.AI_TOPUP_PACKS_JSON = prev;
  }
}

test('topupPacks: pachetele implicite au marjă (prețul > creditul oferit)', () => {
  withPacksEnv(undefined, () => {
    const packs = ai.topupPacks();
    assert.ok(packs.length >= 1, 'există pachete implicite');
    for (const p of packs) {
      assert.ok(p.id && p.nume, 'pachetul are id și nume');
      assert.ok(p.pretLei > 0 && p.creditLei > 0, 'preț și credit pozitive');
      assert.ok(p.pretLei > p.creditLei, `marjă: prețul (${p.pretLei}) trebuie să depășească creditul (${p.creditLei})`);
    }
  });
});

test('topupPacks: suprascriere din env + filtrarea intrărilor invalide', () => {
  withPacksEnv('[{"id":"x","nume":"Pachet X","pretLei":15,"creditLei":6},{"id":"","pretLei":-1}]', () => {
    const packs = ai.topupPacks();
    assert.strictEqual(packs.length, 1, 'intrarea invalidă e filtrată');
    assert.deepStrictEqual(packs[0], { id: 'x', nume: 'Pachet X', pretLei: 15, creditLei: 6 });
  });
});

test('topupPacks: JSON invalid → pachetele implicite (nu crăpăm)', () => {
  withPacksEnv('nu-e-json', () => {
    assert.ok(ai.topupPacks().length >= 1);
  });
});

test('topupPacks: listă goală explicită = pachetele dezactivate', () => {
  withPacksEnv('[]', () => {
    assert.deepStrictEqual(ai.topupPacks(), []);
  });
});

test('FEATURE_QUOTAS: cheile și endpointurile așteptate de endpoint-uri', () => {
  const q = ai.FEATURE_QUOTAS;
  // endpointurile trebuie să corespundă EXACT valorilor logate de logUsage
  assert.strictEqual(q.corectari.endpoint, 'ai-correct:grade');
  assert.strictEqual(q.teste.endpoint, 'ai-exam');
  assert.strictEqual(q.interactive.endpoint, 'ai-generate-interactive');
  assert.strictEqual(q.foto.endpoint, 'ai-vision');
  for (const [key, f] of Object.entries(q)) {
    assert.ok(f.label && f.emoji, `${key} are etichetă pentru UI`);
    assert.ok((f.perMonth ?? 0) >= 0 && (f.perDay ?? 0) >= 0, `${key} are limite numerice`);
    assert.ok((f.perMonth > 0) || (f.perDay > 0) || f.perMonth === 0 || f.perDay === 0, `${key} configurabil`);
  }
});

test('TOPUP_DAYS: valabilitate pozitivă, aliniată cu fereastra lunară', () => {
  assert.ok(ai.TOPUP_DAYS > 0 && ai.TOPUP_DAYS <= 90, 'între 1 și 90 de zile');
});
