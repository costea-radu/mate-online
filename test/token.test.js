// Teste pentru tokenul semnat efemer (signToken/verifyToken).
const test = require('node:test');
const assert = require('node:assert');
const ai = require('../api/_lib/ai');

test('signToken → verifyToken: round-trip', () => {
  const payload = { exercise: 'x', answer: 42 };
  const t = ai.signToken(payload);
  assert.deepStrictEqual(ai.verifyToken(t), payload);
});

test('verifyToken respinge un token modificat (tamper)', () => {
  const t = ai.signToken({ answer: 1 });
  const tampered = t.slice(0, -3) + (t.slice(-3) === 'AAA' ? 'BBB' : 'AAA');
  assert.strictEqual(ai.verifyToken(tampered), null);
});

test('verifyToken respinge gunoi', () => {
  assert.strictEqual(ai.verifyToken('nu-e-un-token'), null);
  assert.strictEqual(ai.verifyToken(''), null);
});
