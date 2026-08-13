// =====================================================================
// test/costwatch.test.js — alertele automate de cost (pasul 4 din
// GHID_LIMITE_AI.md). Rulare: npm test  (node --test test/*.test.js)
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const cw = require('../api/_lib/costwatch.js');

const ROWS = [
  { endpoint: 'ai-correct:grade', model: 'gpt-5.6-terra', actiuni: 3, lei: 1.95 },
  { endpoint: 'ai-chat', model: 'gpt-4o-mini', actiuni: 120, lei: 0.6 },
  { endpoint: 'ai-chat', model: 'gpt-5-nano', actiuni: 30, lei: 0.05 },
  { endpoint: 'ai-chat:pregen', model: null, actiuni: 40, lei: 0 },
  { endpoint: 'ai-chat-stream:pregen', model: null, actiuni: 15, lei: 0 },
  { endpoint: 'ai-pregen:explain', model: 'gpt-4o-mini', actiuni: 6, lei: 0.04 },
];

test('summarize: totaluri corecte + endpointuri unite peste modele', () => {
  const s = cw.summarize(ROWS);
  assert.strictEqual(s.totalActions, 214);
  assert.ok(Math.abs(s.totalLei - 2.64) < 1e-9, `total ${s.totalLei}`);
  const chat = s.byEndpoint.find((r) => r.endpoint === 'ai-chat');
  assert.strictEqual(chat.actiuni, 150, 'ai-chat unește ambele modele');
  assert.strictEqual(s.byEndpoint[0].endpoint, 'ai-correct:grade', 'sortat după cost, descrescător');
});

test('summarize: numără servirile gratuite din pre-generare și costul lor de fond', () => {
  const s = cw.summarize(ROWS);
  assert.strictEqual(s.pregenServed, 55, ':pregen din chat + stream');
  assert.ok(Math.abs(s.platformLei - 0.04) < 1e-9, 'generarea de fond (ai-pregen:*)');
});

test('summarize: fără rânduri → zerouri (fără crash)', () => {
  const s = cw.summarize([]);
  assert.strictEqual(s.totalActions, 0);
  assert.strictEqual(s.totalLei, 0);
  assert.deepStrictEqual(s.byEndpoint, []);
});

test('fmtLei: format stabil cu 2 zecimale', () => {
  assert.strictEqual(cw.fmtLei(2.639), '2.64 lei');
  assert.strictEqual(cw.fmtLei(0), '0.00 lei');
  assert.strictEqual(cw.fmtLei(null), '0.00 lei');
});

test('bucharestDay: format YYYY-MM-DD, stabil ca și cheie de dedup', () => {
  const d = cw.bucharestDay();
  assert.match(d, /^\d{4}-\d{2}-\d{2}$/);
  // aceeași zi la două apeluri consecutive (nu traversăm miezul nopții în teste)
  assert.strictEqual(d, cw.bucharestDay());
});

test('subiectele emailurilor: conțin suma și numărul de acțiuni', () => {
  const s = cw.summarize(ROWS);
  assert.ok(cw.reportSubject(s).includes('2.64 lei') && cw.reportSubject(s).includes('214'));
  assert.ok(cw.alertSubject(25.5).includes('25.50 lei'));
});

test('ALERT_DAY_LEI: prag numeric pozitiv implicit', () => {
  assert.ok(cw.ALERT_DAY_LEI > 0, 'implicit 20, configurabil prin AI_ALERT_DAY_LEI');
});
