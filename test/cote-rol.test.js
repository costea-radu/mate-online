// =====================================================================
// test/cote-rol.test.js — cote PER ROL + pool comun cu „transfer" între
// cotele lunare (vezi GHID_LIMITE_AI.md). Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai.js');

test('quotasForRole: valorile implicite cerute per rol', () => {
  const elev = ai.quotasForRole('elev');
  assert.strictEqual(elev.corectari, 20, 'elev: 20 corectări/lună');
  assert.strictEqual(elev.teste, 20);
  assert.strictEqual(elev.interactive, 40);
  assert.strictEqual(elev.foto, 10);

  const prof = ai.quotasForRole('profesor');
  assert.strictEqual(prof.corectari, 5, 'profesor: 5 corectări/lună');
  assert.strictEqual(prof.teste, 40, 'profesor: 40 subiecte/lună');

  const parinte = ai.quotasForRole('parinte');
  assert.strictEqual(parinte.corectari, 20, 'părinte: ca elevul');

  // rol necunoscut sau lipsă → cotele de elev
  assert.deepStrictEqual(ai.quotasForRole(null), elev);
  assert.deepStrictEqual(ai.quotasForRole('altceva'), elev);
});

test('quotasForRole: suprascriere fină per rol din AI_QUOTAS_JSON', () => {
  // QUOTAS_JSON se citește la import — testăm mecanismul prin modulul re-cerut
  const prev = process.env.AI_QUOTAS_JSON;
  process.env.AI_QUOTAS_JSON = '{"profesor":{"corectari":3},"elev":{"teste":30}}';
  try {
    delete require.cache[require.resolve('../api/_lib/ai.js')];
    const ai2 = require('../api/_lib/ai.js');
    assert.strictEqual(ai2.quotasForRole('profesor').corectari, 3);
    assert.strictEqual(ai2.quotasForRole('profesor').teste, 40, 'nesuprascris → default de rol');
    assert.strictEqual(ai2.quotasForRole('elev').teste, 30);
  } finally {
    if (prev === undefined) delete process.env.AI_QUOTAS_JSON;
    else process.env.AI_QUOTAS_JSON = prev;
    delete require.cache[require.resolve('../api/_lib/ai.js')];
    require('../api/_lib/ai.js'); // reîncarcă curat pentru celelalte teste
  }
});

test('allocateQuotas: fără depășiri → nimic transferat', () => {
  const a = ai.allocateQuotas([
    { key: 'corectari', used: 3, limit: 20 },
    { key: 'teste', used: 1, limit: 20 },
    { key: 'interactive', used: 0, limit: 40 },
  ]);
  for (const it of a) {
    assert.deepStrictEqual(it.borrowedIn, []);
    assert.deepStrictEqual(it.borrowedOut, []);
    assert.strictEqual(it.unallocated, 0);
    assert.strictEqual(it.effUsed, it.used);
  }
});

test('allocateQuotas: depășirea uneia consumă din rezerva celorlalte, în ordine', () => {
  const a = ai.allocateQuotas([
    { key: 'corectari', used: 23, limit: 20 }, // 3 peste
    { key: 'teste', used: 19, limit: 20 },     // rezervă 1
    { key: 'interactive', used: 5, limit: 40 },// rezervă 35
  ]);
  const [c, t, i] = a;
  assert.strictEqual(c.effUsed, 20, 'propriul plafon');
  assert.deepStrictEqual(c.borrowedIn, [{ from: 'teste', n: 1 }, { from: 'interactive', n: 2 }], '1 din teste, apoi 2 din interactive');
  assert.deepStrictEqual(t.borrowedOut, [{ to: 'corectari', n: 1 }], 'teste: transferat 1');
  assert.strictEqual(t.effUsed, 20, 'teste plin: 19 propriu + 1 transferat');
  assert.deepStrictEqual(i.borrowedOut, [{ to: 'corectari', n: 2 }]);
  assert.strictEqual(i.effUsed, 7, '5 propriu + 2 absorbite');
  assert.strictEqual(c.unallocated, 0);
});

test('allocateQuotas: pool epuizat complet → unallocated > 0', () => {
  const a = ai.allocateQuotas([
    { key: 'corectari', used: 45, limit: 20 },
    { key: 'teste', used: 20, limit: 20 },
    { key: 'interactive', used: 40, limit: 40 },
  ]);
  const c = a[0];
  assert.strictEqual(c.unallocated, 25, 'nimic liber de absorbit');
  assert.deepStrictEqual(c.borrowedIn, []);
});

test('allocateQuotas: suma folosită = suma alocată (nu se pierde/creează capacitate)', () => {
  const items = [
    { key: 'a', used: 12, limit: 10 },
    { key: 'b', used: 7, limit: 20 },
    { key: 'c', used: 0, limit: 5 },
  ];
  const a = ai.allocateQuotas(items);
  const totalEff = a.reduce((s, it) => s + it.effUsed, 0);
  const totalUsed = items.reduce((s, it) => s + it.used, 0);
  const totalUnalloc = a.reduce((s, it) => s + it.unallocated, 0);
  assert.strictEqual(totalEff + totalUnalloc, totalUsed, 'conservare');
});
