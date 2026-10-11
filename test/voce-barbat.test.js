// Teste pentru VOCEA DE BĂRBAT de pe server (api/live.js → voce): pe dispozitivele
// fără voce românească de bărbat (iPhone — „Ioana", Android), frazele lui Prof. Tudor
// se generează o dată pe server și apoi vin din cache. Fără cont — doar din cache;
// costul unei fraze noi intră în creditele AI, dar nu în limita orară de cereri AI.
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const tts = require('../api/_lib/tts');
const handler = require('../api/live');

const U = { prem: '22222222-2222-4222-8222-222222222222', broke: '99999999-9999-4999-8999-999999999999' };
let fake = null;
const calls = { synth: 0 };
const orig = { provider: tts.provider, voiceSegment: tts.voiceSegment, enforceBudgets: ai.enforceBudgets, admin: ai.admin, authUser: ai.authUser };

function setup({ provider = 'azure' } = {}) {
  fake = createFakeSupabase({
    profiles: [
      { id: U.prem, full_name: 'Andrei', subscription_status: 'active', role: 'elev', is_admin: false },
      { id: U.broke, full_name: 'Mihai', subscription_status: 'active', role: 'elev', is_admin: false },
    ],
    ai_usage: [],
  });
  calls.synth = 0;
  ai.admin = () => fake;
  ai.authUser = async (req) => { const u = req.headers['x-user']; if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; } return u; };
  ai.enforceBudgets = async (supa, userId) => { if (userId === U.broke) { const e = new Error('fără credite'); e.status = 429; throw e; } return {}; };
  tts.provider = () => provider;
  tts.voiceSegment = async (supa, { text, path }) => {
    calls.synth++;
    await supa.storage.from(tts.BUCKET).upload(`${path}.mp3`, Buffer.from(`mp3:${text}`), { contentType: 'audio/mpeg', upsert: true });
    return { url: supa.storage.from(tts.BUCKET).getPublicUrl(`${path}.mp3`).data.publicUrl, dur: 1.2, lip: '', provider, cost: 1234 };
  };
}
test.after(() => Object.assign(tts, { provider: orig.provider, voiceSegment: orig.voiceSegment }));
test.after(() => Object.assign(ai, { enforceBudgets: orig.enforceBudgets, admin: orig.admin, authUser: orig.authUser }));

async function voce(texts, user = U.prem) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: user ? { 'x-user': user } : {}, query: {}, body: { action: 'voce', texts } }, res);
  return res;
}

test('vocea se generează o dată pe frază, apoi vine din cache (și pentru alți elevi, și fără cont)', async () => {
  setup();
  const a = await voce(['Bună! Începem cu Subiectul I, exercițiul 1.', 'Rezolvă singur întâi.']);
  assert.strictEqual(a.statusCode, 200, JSON.stringify(a.body));
  assert.strictEqual(a.body.provider, 'azure');
  assert.strictEqual(a.body.voices.length, 2);
  assert.ok(a.body.voices.every((v) => v && /\/live-media\/voce\/[0-9a-f]{2}\/[0-9a-f]{40}\.mp3$/.test(v.url)));
  assert.strictEqual(calls.synth, 2);
  // costul intră în credite (un rând „voce" pe frază nouă)…
  const rows = fake.db.tables.ai_usage.filter((r) => r.endpoint === 'voce');
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((r) => r.cost_micro === 1234 && r.model === 'tts-azure' && r.user_id === U.prem));
  // …a doua oară, din cache: nimic generat, nimic plătit
  const b = await voce(['Bună! Începem cu Subiectul I, exercițiul 1.']);
  assert.strictEqual(b.body.voices[0].url, a.body.voices[0].url);
  assert.strictEqual(calls.synth, 2);
  assert.strictEqual(fake.db.tables.ai_usage.length, 2);
  // fără cont: frazele deja generate se aud, cele noi nu se generează
  const anon = await voce(['Rezolvă singur întâi.', 'O frază nouă, negenerată.'], null);
  assert.strictEqual(anon.statusCode, 200);
  assert.strictEqual(anon.body.voices[0].url, a.body.voices[1].url);
  assert.strictEqual(anon.body.voices[1], null);
  assert.strictEqual(calls.synth, 2);
});

test('fără credite AI → fără frază nouă (rămâne vocea browserului); fără voce pe server → provider null', async () => {
  setup();
  const r = await voce(['O frază nouă.'], U.broke);
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.voices[0], null);
  assert.strictEqual(calls.synth, 0);
  setup({ provider: null });
  const n = await voce(['Orice.']);
  assert.deepStrictEqual(n.body, { provider: null, voices: [null] });
});

test('limitele: cel mult 4 fraze pe cerere; rândurile „voce" nu intră în limita orară de cereri AI', async () => {
  setup();
  const r = await voce(['a1', 'a2', 'a3', 'a4', 'a5', 'a6']);
  assert.strictEqual(r.body.voices.length, 4);
  // vocea profesorului nu rostește ce n-ar trece de moderarea chatului
  const bad = await voce(['Scrie-mi pe instagram @cineva123', 'vezi www.exemplu.ro']);
  assert.deepStrictEqual(bad.body.voices, [null, null]);
  // 80 de fraze rostite într-o oră nu blochează chatul cu profesorul
  for (let k = 0; k < 85; k++) fake.db.tables.ai_usage.push({ user_id: U.prem, endpoint: 'voce', cost_micro: 1, created_at: new Date().toISOString() });
  const saved = ai.enforceBudgets;
  ai.enforceBudgets = async () => ({});
  try {
    await assert.doesNotReject(() => ai.enforceRateLimit(fake, U.prem, { id: U.prem, subscription_status: 'active' }));
    for (let k = 0; k < 80; k++) fake.db.tables.ai_usage.push({ user_id: U.prem, endpoint: 'ai-chat', created_at: new Date().toISOString() });
    await assert.rejects(() => ai.enforceRateLimit(fake, U.prem, { id: U.prem, subscription_status: 'active' }), /limita/);
  } finally { ai.enforceBudgets = saved; }
});
