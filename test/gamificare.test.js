// =====================================================================
// test/gamificare.test.js — motorul Arenei (api/_lib/xp.js): formula de XP,
// plafoanele, zilele/săptămânile în ora României, rotația misiunii și
// nivelurile. Fără dependențe externe — rulează și fără node_modules.
// Rulare: npm test (node --test).
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');

const xp = require('../api/_lib/xp');

test('zilele și săptămânile sunt calculate în ora României', () => {
  // 1 ianuarie 2026, 22:30 UTC = 2 ianuarie 00:30 la București
  assert.strictEqual(xp.dayKey(new Date('2026-01-01T22:30:00Z')), '2026-01-02');
  // vara (UTC+3): 31 iulie 21:30 UTC = 1 august 00:30
  assert.strictEqual(xp.dayKey(new Date('2026-07-31T21:30:00Z')), '2026-08-01');
  // săptămâna începe LUNI
  assert.strictEqual(xp.weekStart(new Date('2026-08-29T10:00:00Z')), '2026-08-24'); // sâmbătă → luni
  assert.strictEqual(xp.weekStart(new Date('2026-08-24T10:00:00Z')), '2026-08-24'); // chiar luni
  assert.strictEqual(xp.weekStart(new Date('2026-08-30T21:30:00Z')), '2026-08-31'); // duminică 00:30 luni RO → săptămâna nouă
  assert.strictEqual(xp.daysBetween('2026-08-24', '2026-08-26'), 2);
  assert.strictEqual(xp.addDays('2026-02-28', 1), '2026-03-01');
});

test('dificultatea vine din material, altfel din categorie', () => {
  assert.strictEqual(xp.difficultyOf({ difficulty: 4, category: 'clasa-5' }), 4);
  assert.strictEqual(xp.difficultyOf({ category: 'clasa-5' }), 1);
  assert.strictEqual(xp.difficultyOf({ category: 'bacalaureat' }), 5);
  assert.strictEqual(xp.difficultyOf({ category: 'necunoscut' }), 2);
  assert.strictEqual(xp.difficultyOf(null), 2);
});

test('XP: precizia și dificultatea contează, nu doar numărul de exerciții', () => {
  const perfect = xp.computeXp({ score: 10, maxScore: 10, correct: 10, total: 10, difficulty: 2 });
  const slab    = xp.computeXp({ score: 3,  maxScore: 10, correct: 3,  total: 10, difficulty: 2 });
  const greu    = xp.computeXp({ score: 10, maxScore: 10, correct: 10, total: 10, difficulty: 5 });

  assert.ok(perfect.xp > slab.xp, 'precizia mare trebuie să dea mai mult XP');
  assert.ok(greu.xp > perfect.xp, 'un exercițiu greu valorează mai mult');
  assert.strictEqual(perfect.pct, 100);
  assert.strictEqual(slab.detalii.w_precizie, 0.6, 'sub 40% se aplică penalizarea de precizie');
});

test('XP: reluarea aceluiași exercițiu dă tot mai puțin (anti-farming)', () => {
  const a1 = xp.computeXp({ score: 10, maxScore: 10, correct: 10, total: 10, difficulty: 2, attempts: 1 }).xp;
  const a2 = xp.computeXp({ score: 10, maxScore: 10, correct: 10, total: 10, difficulty: 2, attempts: 2 }).xp;
  const a5 = xp.computeXp({ score: 10, maxScore: 10, correct: 10, total: 10, difficulty: 2, attempts: 5 }).xp;
  assert.ok(a1 > a2 && a2 > a5, 'XP-ul scade la fiecare reluare');
  assert.ok(a5 > 0, 'dar nu ajunge la zero');
  // 20 de reluări nu pot depăși prima rezolvare
  assert.ok(a1 > xp.computeXp({ score: 10, maxScore: 10, correct: 10, total: 10, difficulty: 2, attempts: 20 }).xp * 3);
});

test('XP: bonus de progres când elevul reia și se îmbunătățește', () => {
  const fara = xp.computeXp({ score: 9, maxScore: 10, correct: 9, total: 10, difficulty: 2, attempts: 2 });
  const cu   = xp.computeXp({ score: 9, maxScore: 10, correct: 9, total: 10, difficulty: 2, attempts: 2, prevPct: 50 });
  assert.strictEqual(cu.xp - fara.xp, 15);
  // o îmbunătățire mică (sub 20 de puncte procentuale) nu ia bonus
  const mic = xp.computeXp({ score: 9, maxScore: 10, correct: 9, total: 10, difficulty: 2, attempts: 2, prevPct: 80 });
  assert.strictEqual(mic.xp, fara.xp);
});

test('XP: plafon per exercițiu — un test uriaș nu valorează cât o săptămână', () => {
  const urias = xp.computeXp({ score: 60, maxScore: 60, correct: 60, total: 60, difficulty: 5 });
  assert.ok(urias.xp <= xp.XP_MAX_PER_TEST + 15, 'plafon + eventualul bonus de progres');
});

test('XP: fără correct/total (test încărcat manual) se estimează din procent', () => {
  const est = xp.computeXp({ score: 80, maxScore: 100, difficulty: 2 });
  assert.strictEqual(est.detalii.itemi, 10);
  assert.strictEqual(est.detalii.corecte, 8);
  assert.ok(est.xp > 0);
});

test('XP: scorul NEVERIFICAT (material fără chei) dă mult mai puțin XP', () => {
  const ok  = xp.computeXp({ score: 10, maxScore: 10, correct: 10, total: 10, difficulty: 5 });
  const fals = xp.computeXp({ score: 10, maxScore: 10, correct: 10, total: 10, difficulty: 5, verified: false });
  assert.ok(fals.xp < ok.xp / 2, 'un scor trimis de browser nu poate valora cât unul recalculat');
  assert.ok(fals.xp <= xp.UNVERIFIED_MAX_XP);
  assert.strictEqual(fals.detalii.verificat, false);
});

test('dificultatea acoperă și liceul', () => {
  assert.strictEqual(xp.difficultyOf({ category: 'clasa-12' }), 5);
  assert.strictEqual(xp.difficultyOf({ category: 'clasa-9' }), 3);
  // un exercițiu de liceu nu poate valora mai puțin decât unul de gimnaziu
  const gimnaziu = xp.computeXp({ score: 5, maxScore: 5, correct: 5, total: 5, difficulty: xp.difficultyOf({ category: 'clasa-8' }) }).xp;
  const liceu    = xp.computeXp({ score: 5, maxScore: 5, correct: 5, total: 5, difficulty: xp.difficultyOf({ category: 'clasa-11' }) }).xp;
  assert.ok(liceu >= gimnaziu);
});

test('nivelurile cresc monoton și se opresc la Legendă', () => {
  assert.strictEqual(xp.levelOf(0).level, 1);
  assert.strictEqual(xp.levelOf(0).name, 'Începător');
  assert.strictEqual(xp.levelOf(99).level, 1);
  assert.strictEqual(xp.levelOf(100).level, 2);
  assert.strictEqual(xp.levelOf(650).level, 4);
  const max = xp.levelOf(999999);
  assert.strictEqual(max.name, 'Legendă');
  assert.strictEqual(max.xpNext, null);
  assert.strictEqual(max.progressPct, 100);
  let prev = 0;
  for (const v of [0, 150, 400, 900, 2000, 6000]) {
    const l = xp.levelOf(v).level;
    assert.ok(l >= prev, 'nivelul nu scade când crește XP-ul');
    prev = l;
  }
});

test('misiunea zilei se rotește, dar e stabilă în aceeași zi', () => {
  const a = xp.missionForDay('2026-08-29');
  assert.deepStrictEqual(a, xp.missionForDay('2026-08-29'));
  const tipuri = new Set(['2026-08-29', '2026-08-30', '2026-08-31'].map((d) => xp.missionForDay(d).kind));
  assert.strictEqual(tipuri.size, 3, 'trei zile la rând → trei misiuni diferite');
});

test('diviziile ligii sunt între Bronz și Maestru', () => {
  assert.strictEqual(xp.tierInfo(1).name, 'Bronz');
  assert.strictEqual(xp.tierInfo(5).name, 'Maestru');
  assert.strictEqual(xp.tierInfo(99).name, 'Maestru', 'nu se poate urca peste ultima divizie');
  assert.strictEqual(xp.tierInfo(0).name, 'Bronz');
});
