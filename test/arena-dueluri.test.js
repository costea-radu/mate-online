// =====================================================================
// test/arena-dueluri.test.js — regulile duelului 1-la-1 (api/_lib/duel.js)
// și capitolele hărții (api/harta.js). Rulare: npm test (node --test).
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');

const duel = require('../api/_lib/duel');
const harta = require('../api/harta');

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';
const baza = { challenger_id: A, opponent_id: B, challenger_max: 10, opponent_max: 10 };

test('duel: câștigă procentul mai mare', () => {
  const r = duel.castigator({ ...baza, challenger_score: 9, opponent_score: 7 });
  assert.strictEqual(r.winner, A);
  assert.strictEqual(r.result, 'victorie');
});

test('duel: la procent egal decide timpul mai scurt', () => {
  const r = duel.castigator({ ...baza, challenger_score: 8, opponent_score: 8, challenger_sec: 300, opponent_sec: 120 });
  assert.strictEqual(r.winner, B, 'cine a terminat mai repede câștigă');
});

test('duel: procent egal și timpi lipsă sau identici → remiză', () => {
  assert.strictEqual(duel.castigator({ ...baza, challenger_score: 8, opponent_score: 8 }).winner, null);
  assert.strictEqual(duel.castigator({ ...baza, challenger_score: 8, opponent_score: 8 }).result, 'egalitate');
  const egal = duel.castigator({ ...baza, challenger_score: 8, opponent_score: 8, challenger_sec: 200, opponent_sec: 200 });
  assert.strictEqual(egal.winner, null);
});

test('duel: procentul contează, nu punctajul brut (teste de mărimi diferite)', () => {
  // 9/10 = 90% vs 15/20 = 75% → câștigă primul, deși are punctaj brut mai mic
  const r = duel.castigator({
    challenger_id: A, opponent_id: B,
    challenger_score: 9, challenger_max: 10,
    opponent_score: 15, opponent_max: 20,
  });
  assert.strictEqual(r.winner, A);
});

test('duel: neprezentare — câștigă cine a jucat; nimeni n-a jucat → fără câștigător', () => {
  const doarA = duel.castigator({ ...baza, challenger_score: 5, opponent_score: null }, { neprezentare: true });
  assert.strictEqual(doarA.winner, A);
  assert.strictEqual(doarA.result, 'neprezentare');

  const doarB = duel.castigator({ ...baza, challenger_score: null, opponent_score: 3 }, { neprezentare: true });
  assert.strictEqual(doarB.winner, B);

  const niciunul = duel.castigator({ ...baza, challenger_score: null, opponent_score: null }, { neprezentare: true });
  assert.strictEqual(niciunul.winner, null);
  assert.strictEqual(niciunul.result, null);
});

test('duel: adversarul nu-și vede scorul înainte să joace', () => {
  const d = {
    id: 'd1', ...baza, status: 'activ', content_id: 'c1', content_title: 'Fracții',
    challenger_score: 9, challenger_sec: 100, opponent_score: null,
  };
  const vazutDeB = duel.forUser(d, B);
  assert.strictEqual(vazutDeB.amJucat, false);
  assert.strictEqual(vazutDeB.scorulLui, null, 'scorul adversarului rămâne ascuns până joci');
  assert.strictEqual(vazutDeB.aJucat, true, 'dar vezi că adversarul a jucat deja');

  const vazutDeA = duel.forUser(d, A);
  assert.strictEqual(vazutDeA.amJucat, true);
  assert.strictEqual(vazutDeA.scorulMeu.pct, 90);
});

test('duel: după final, ambii văd tot', () => {
  const d = {
    id: 'd2', ...baza, status: 'terminat', content_id: 'c1', content_title: 'Fracții',
    challenger_score: 9, opponent_score: 6, winner_id: A, result: 'victorie',
  };
  assert.strictEqual(duel.forUser(d, B).scorulLui.pct, 90);
  assert.strictEqual(duel.forUser(d, B).rezultat, 'pierdut');
  assert.strictEqual(duel.forUser(d, A).rezultat, 'castigat');
});

// „bază de date" minimală: recordScore citește duelul și iese înainte de orice
// scriere în cazurile de mai jos, deci lanțul select→eq→maybeSingle e suficient.
const fakeSupa = (row) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
});

test('duel: scorul dintr-ALT exercițiu nu intră în duel', async () => {
  const d = { id: 'd3', ...baza, status: 'activ', content_id: 'material-greu' };
  const r = await duel.recordScore(fakeSupa(d), A, 'd3', {
    contentId: 'alt-material-usor', score: 10, maxScore: 10, verified: true,
  });
  assert.deepStrictEqual(r, { altMaterial: true });
});

test('duel: scorul neverificat (material fără chei) nu intră în duel', async () => {
  const d = { id: 'd4', ...baza, status: 'activ', content_id: 'material-fara-chei' };
  const r = await duel.recordScore(fakeSupa(d), A, 'd4', {
    contentId: 'material-fara-chei', score: 100, maxScore: 100, verified: false,
  });
  assert.deepStrictEqual(r, { neverificat: true });
});

test('duel: nu poți juca într-un duel în care nu ești parte', async () => {
  const d = { id: 'd5', ...baza, status: 'activ', content_id: 'm1' };
  const strain = '33333333-3333-3333-3333-333333333333';
  const r = await duel.recordScore(fakeSupa(d), strain, 'd5', {
    contentId: 'm1', score: 10, maxScore: 10, verified: true,
  });
  assert.strictEqual(r, null);
});

test('duel: salvarea parțială nu poate înlocui un rezultat final', async () => {
  const d = { id: 'd6', ...baza, status: 'activ', content_id: 'm1',
    challenger_score: 9, challenger_max: 10, challenger_partial: false };
  const r = await duel.recordScore(fakeSupa(d), A, 'd6', {
    contentId: 'm1', score: 3, maxScore: 10, verified: true, partial: true,
  });
  assert.deepStrictEqual(r, { deja: true });
});

test('duel: un rezultat provizoriu mai slab nu îl coboară pe cel bun', async () => {
  const d = { id: 'd7', ...baza, status: 'activ', content_id: 'm1',
    challenger_score: 8, challenger_max: 10, challenger_partial: true };
  const slab = await duel.recordScore(fakeSupa(d), A, 'd7', {
    contentId: 'm1', score: 4, maxScore: 10, verified: true, partial: true,
  });
  assert.deepStrictEqual(slab, { partial: true, pastrat: true });
});

test('duel: XP-ul urmează rezultatul, nu doar victoria', () => {
  const laLimita = duel.xpDuel(duel.XP_INFRANGERE, 85);   // pierdut, dar 85%
  const cuChiu = duel.xpDuel(duel.XP_VICTORIE, 30);       // câștigat, dar 30%
  assert.ok(laLimita > duel.XP_INFRANGERE, 'procentul adaugă XP');
  assert.ok(cuChiu < duel.xpDuel(duel.XP_VICTORIE, 100), 'victoria slabă nu ia maximum');
  assert.strictEqual(duel.xpDuel(duel.XP_VICTORIE, 0), duel.XP_VICTORIE);
});

test('harta: capitolele unei categorii sunt în ordinea programei', () => {
  const c7 = harta.capitoleleCategoriei('clasa-7');
  assert.ok(c7.length >= 5);
  assert.ok(c7.every((c) => c.grade === 7));
  assert.strictEqual(c7[0].id, 'c7-reale');

  const en = harta.capitoleleCategoriei('evaluare-nationala');
  assert.ok(en.length > c7.length, 'Evaluarea Națională acoperă clasele 5-8');
  assert.deepStrictEqual([...new Set(en.map((c) => c.grade))], [5, 6, 7, 8]);

  const bac = harta.capitoleleCategoriei('bacalaureat');
  assert.ok(bac.every((c) => c.grade >= 9 && c.grade <= 12));

  assert.deepStrictEqual(harta.capitoleleCategoriei('inexistent'), []);
});
