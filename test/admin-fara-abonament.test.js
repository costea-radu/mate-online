// Adminul folosește TOATE funcțiile fără abonament Stripe.
// Verifică poarta comună din api/_lib/ai.js (isPremium / requirePremium /
// enforceFreeQuota — prin ea trec toate endpoint-urile AI) și blocajul din
// api/create-checkout.js (adminul nu poate porni nicio plată).
const test = require('node:test');
const assert = require('node:assert');

// ── Stripe simulat: numărăm sesiunile de plată create (fără rețea) ──
const stripeCalls = [];
const stripePath = require.resolve('stripe');
require.cache[stripePath] = {
  id: stripePath, filename: stripePath, loaded: true,
  exports: () => ({
    checkout: { sessions: { create: async (opts) => { stripeCalls.push(opts); return { url: 'https://checkout.stripe.test/s' }; } } },
  }),
};

// ── Autentificarea și clientul Supabase stub-uite (înainte de require-ul handlerului) ──
let currentProfile = null;
const http = require('../api/_lib/http');
http.authUser = async () => currentProfile.id;
http.admin = () => ({
  from() {
    const api = {
      select() { return api; },
      eq() { return api; },
      limit() { return Promise.resolve({ data: [], error: null }); },
      single() { return Promise.resolve({ data: currentProfile, error: null }); },
      maybeSingle() { return Promise.resolve({ data: { subscription_started_at: null }, error: null }); },
    };
    return api;
  },
});

const ai = require('../api/_lib/ai.js');
const checkout = require('../api/create-checkout.js');

const adminFaraAbonament = { id: 'a1', email: 'admin@test.ro', is_admin: true, subscription_status: 'inactive', role: 'profesor' };
const abonat = { id: 'u1', email: 'abonat@test.ro', is_admin: false, subscription_status: 'active', role: 'elev' };
const gratuit = { id: 'u2', email: 'elev@test.ro', is_admin: false, subscription_status: 'inactive', role: 'elev' };

function fakeRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
async function callCheckout(profile, body = {}) {
  currentProfile = profile;
  const res = fakeRes();
  await checkout({ method: 'POST', headers: { authorization: 'Bearer x' }, body }, res);
  return res;
}

test('isPremium: adminul are acces premium și după anularea abonamentului', () => {
  assert.strictEqual(ai.isPremium(adminFaraAbonament), true);
  assert.strictEqual(ai.isPremium({ ...adminFaraAbonament, subscription_status: null }), true);
  assert.strictEqual(ai.isPremium(abonat), true);
  assert.strictEqual(ai.isPremium(gratuit), false);
  assert.strictEqual(ai.isPremium(null), false);
  // doar is_admin === true contează, nu o valoare „aproape adevărată"
  assert.strictEqual(ai.isPremium({ is_admin: 'true', subscription_status: 'inactive' }), false);
});

test('requirePremium nu blochează adminul; contul gratuit rămâne blocat', () => {
  assert.doesNotThrow(() => ai.requirePremium(adminFaraAbonament));
  assert.throws(() => ai.requirePremium(gratuit), (e) => e.status === 402 && e.code === 'PREMIUM_REQUIRED');
});

test('enforceFreeQuota: adminul nu consumă „încercările gratuite" (nici nu se interoghează)', async () => {
  const supa = { from() { throw new Error('nu trebuia interogat'); } };
  await ai.enforceFreeQuota(supa, adminFaraAbonament);
});

test('enforceFreeQuota: contul gratuit e oprit după încercările gratuite', async () => {
  const supa = { from: () => ({ select: () => ({ eq: () => Promise.resolve({ count: 999 }) }) }) };
  await assert.rejects(() => ai.enforceFreeQuota(supa, gratuit), (e) => e.status === 402 && e.code === 'PREMIUM_REQUIRED');
});

test('create-checkout: adminul nu poate porni un abonament (nicio sesiune Stripe)', async () => {
  stripeCalls.length = 0;
  const res = await callCheckout(adminFaraAbonament, { plan: 'anual' });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'ADMIN_NO_CHECKOUT');
  assert.strictEqual(stripeCalls.length, 0);
});

test('create-checkout: adminul nu poate cumpăra nici pachete AI', async () => {
  stripeCalls.length = 0;
  const res = await callCheckout({ ...adminFaraAbonament, subscription_status: 'active' }, { type: 'topup', pack: 'orice' });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'ADMIN_NO_CHECKOUT');
  assert.strictEqual(stripeCalls.length, 0);
});

test('create-checkout: un utilizator obișnuit ajunge în continuare la plată', async () => {
  stripeCalls.length = 0;
  const res = await callCheckout(gratuit, { plan: 'lunar' });
  assert.strictEqual(res.statusCode, 200);
  assert.strictEqual(res.body.url, 'https://checkout.stripe.test/s');
  assert.strictEqual(stripeCalls.length, 1);
  assert.strictEqual(stripeCalls[0].mode, 'subscription');
});

test('create-checkout: abonatul activ nu poate cumpăra un al doilea abonament', async () => {
  stripeCalls.length = 0;
  const res = await callCheckout(abonat, { plan: 'lunar' });
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(stripeCalls.length, 0);
});
