// Plățile unice (pachete AI 10/20 lei, bilete la meditațiile live — grup / 1-la-1)
// primesc factură imediat în Stripe, pe clientul Stripe al contului; abonamentul
// nu mai are probă gratuită. Verifică parametrii trimiși la Stripe Checkout
// (api/create-checkout.js) și legarea clientului de cont în webhook
// (api/stripe-webhook.js) — fără rețea.
const test = require('node:test');
const assert = require('node:assert');
const { Readable } = require('node:stream');

// Proba e scoasă din cod: nici o variabilă de mediu rămasă în Vercel nu o mai pornește.
process.env.TRIAL_DAYS = '2';

// ── Stripe simulat ──
const sesiuni = [];
const cautati = [];
const clienti = {
  cus_ok: { id: 'cus_ok', object: 'customer' },
  cus_sters: { id: 'cus_sters', object: 'customer', deleted: true },
};
let evenimentWebhook = null;
const stripePath = require.resolve('stripe');
require.cache[stripePath] = {
  id: stripePath, filename: stripePath, loaded: true,
  exports: () => ({
    checkout: { sessions: { create: async (opts) => { sesiuni.push(opts); return { url: 'https://checkout.stripe.test/s' }; } } },
    customers: {
      retrieve: async (id) => {
        cautati.push(id);
        if (clienti[id]) return clienti[id];
        const e = new Error(`No such customer: '${id}'; a similar object exists in test mode`);
        e.code = 'resource_missing'; e.statusCode = 404;
        throw e;
      },
    },
    webhooks: { constructEvent: () => evenimentWebhook },
  }),
};

// ── Supabase simulat: interogări înlănțuite, fiecare înregistrată ──
const operatii = [];
let profilCurent = null;
const sesiuneGrup = () => ({
  id: 's1', kind: 'grup', teacher: null, slot: 'necunoscut', day: '2026-10-22',
  starts_at: new Date(Date.now() + 3600e3).toISOString(),
  ends_at: new Date(Date.now() + 7200e3).toISOString(),
  status: 'programata', exam: 'en', profile: null,
});
function supabaseFals() {
  return {
    from(table) {
      const q = { table, op: 'select', filters: [] };
      const b = {
        select(cols) { if (q.op === 'select') q.cols = cols; return b; },
        update(values) { q.op = 'update'; q.values = values; return b; },
        upsert(values, opts) { q.op = 'upsert'; q.values = values; q.opts = opts; return b; },
        eq(c, v) { q.filters.push(['eq', c, v]); return b; },
        is(c, v) { q.filters.push(['is', c, v]); return b; },
        limit() { operatii.push(q); return Promise.resolve({ data: [], error: null }); },
        single() { operatii.push(q); return Promise.resolve({ data: profilCurent, error: null }); },
        maybeSingle() {
          operatii.push(q);
          return Promise.resolve({ data: table === 'live_sessions' ? sesiuneGrup() : null, error: null });
        },
        then(ok, ko) { operatii.push(q); return Promise.resolve({ data: null, error: null }).then(ok, ko); },
      };
      return b;
    },
  };
}
const supabasePath = require.resolve('@supabase/supabase-js');
require.cache[supabasePath] = {
  id: supabasePath, filename: supabasePath, loaded: true,
  exports: { createClient: () => supabaseFals() },
};

// ── Autentificarea stub-uită (înainte de require-ul handlerelor) ──
const http = require('../api/_lib/http');
http.authUser = async () => profilCurent.id;
http.admin = () => supabaseFals();

const checkout = require('../api/create-checkout.js');
const webhook = require('../api/stripe-webhook.js');
const L = require('../api/_lib/live'); // prețurile biletelor (LIVE_PRICE_GRUP_LEI / _PRIVAT_LEI)

const abonat = { id: 'u1', email: 'abonat@test.ro', is_admin: false, subscription_status: 'active', stripe_customer_id: null };
const gratuit = { id: 'u2', email: 'elev@test.ro', is_admin: false, subscription_status: 'inactive', stripe_customer_id: null };

function fakeRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.send = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
async function plata(profil, body) {
  profilCurent = profil;
  sesiuni.length = 0; cautati.length = 0;
  const res = fakeRes();
  await checkout({ method: 'POST', headers: { authorization: 'Bearer x' }, body }, res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(sesiuni.length, 1);
  return sesiuni[0];
}
function areFactura(s) {
  assert.strictEqual(s.mode, 'payment');
  assert.strictEqual(s.invoice_creation?.enabled, true, 'factura se emite imediat după plată');
  // metadata (din ea creditează webhookul) e pe sesiune, pe plată și pe factură
  assert.deepStrictEqual(s.payment_intent_data.metadata, s.metadata);
  assert.deepStrictEqual(s.invoice_creation.invoice_data.metadata, s.metadata);
  // plata are descriere lizibilă (nu doar id-ul ch_… în Stripe)
  assert.ok(s.payment_intent_data.description && s.payment_intent_data.description.length > 10);
  assert.ok(s.invoice_creation.invoice_data.description);
}

test('pachet AI mic (10 lei): factură imediată; fără client salvat, Checkout îl creează din e-mail', async () => {
  const s = await plata(abonat, { type: 'topup', pack: 'mic' });
  areFactura(s);
  assert.strictEqual(s.line_items[0].price_data.unit_amount, 1000);
  assert.match(s.payment_intent_data.description, /^Pachet AI Mic — \+/);
  assert.match(s.invoice_creation.invoice_data.description, /Credite AI suplimentare/);
  assert.strictEqual(s.metadata.topup_pack, 'mic');
  assert.strictEqual(s.metadata.supabase_user_id, 'u1');
  assert.strictEqual(s.customer_email, 'abonat@test.ro');
  assert.strictEqual(s.customer_creation, 'always');
  assert.strictEqual(s.customer, undefined);
  assert.strictEqual(cautati.length, 0, 'fără id salvat nu se interoghează Stripe');
});

test('pachet AI mare (20 lei): factura merge pe clientul Stripe al abonamentului', async () => {
  const s = await plata({ ...abonat, stripe_customer_id: 'cus_ok' }, { type: 'topup', pack: 'mare' });
  areFactura(s);
  assert.strictEqual(s.line_items[0].price_data.unit_amount, 2000);
  assert.strictEqual(s.customer, 'cus_ok');
  // Stripe refuză `customer` împreună cu `customer_email` / `customer_creation`
  assert.strictEqual(s.customer_email, undefined);
  assert.strictEqual(s.customer_creation, undefined);
  assert.deepStrictEqual(cautati, ['cus_ok']);
});

test('client Stripe inutilizabil (șters / din modul test): plata nu se blochează', async () => {
  for (const id of ['cus_sters', 'cus_din_modul_test']) {
    const s = await plata({ ...abonat, stripe_customer_id: id }, { type: 'topup', pack: 'mic' });
    areFactura(s);
    assert.strictEqual(s.customer, undefined, id);
    assert.strictEqual(s.customer_email, 'abonat@test.ro', id);
    assert.strictEqual(s.customer_creation, 'always', id);
  }
});

test('bilet la meditația live de grup: factură imediată, la prețul biletului', async () => {
  const s = await plata(gratuit, { type: 'live', kind: 'grup', sessionId: 's1' });
  areFactura(s);
  assert.strictEqual(s.line_items[0].price_data.unit_amount, Math.round(L.PRICE_GROUP_LEI() * 100));
  assert.match(s.payment_intent_data.description, /^Meditație live de grup/);
  assert.strictEqual(s.metadata.live_kind, 'grup');
  assert.strictEqual(s.metadata.live_session_id, 's1');
});

test('bilet la meditația 1-la-1: factură imediată, la prețul biletului', async () => {
  const s = await plata(gratuit, { type: 'live', kind: 'privat' });
  areFactura(s);
  assert.strictEqual(s.line_items[0].price_data.unit_amount, Math.round(L.PRICE_PRIVATE_LEI() * 100));
  assert.match(s.payment_intent_data.description, /^Meditație 1-la-1/);
  assert.strictEqual(s.metadata.live_kind, 'privat');
});

test('abonament: fără probă gratuită (chiar cu TRIAL_DAYS setat), plată și factură de la început', async () => {
  for (const plan of ['lunar', 'anual']) {
    const s = await plata({ ...gratuit, stripe_customer_id: 'cus_ok' }, { plan });
    assert.strictEqual(s.mode, 'subscription');
    assert.strictEqual(s.subscription_data.trial_period_days, undefined, plan);
    assert.strictEqual(s.subscription_data.trial_settings, undefined, plan);
    assert.strictEqual(s.subscription_data.trial_end, undefined, plan);
    assert.doesNotMatch(s.success_url, /proba=/);
    // factura abonamentului o face Stripe Billing; `invoice_creation` e doar pentru mode: 'payment'
    assert.strictEqual(s.invoice_creation, undefined);
    // abonamentul nu refolosește clientul (webhookul dezactivează contul după client)
    assert.strictEqual(s.customer, undefined);
    assert.strictEqual(s.customer_email, 'elev@test.ro');
    assert.strictEqual(cautati.length, 0);
  }
});

// ── Webhook ──
async function trimite(sesiune) {
  evenimentWebhook = { type: 'checkout.session.completed', data: { object: sesiune } };
  operatii.length = 0;
  const req = Readable.from([Buffer.from('{}')]);
  req.method = 'POST';
  req.headers = { 'stripe-signature': 't=1,v1=semnatura' };
  const res = fakeRes();
  await webhook(req, res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  return operatii;
}
const legareClient = (ops) => ops.filter((o) => o.table === 'profiles' && o.op === 'update');

test('webhook, bilet live: biletul se scrie, iar clientul Stripe se leagă de cont doar dacă profilul n-avea unul', async () => {
  profilCurent = { full_name: 'Elev Test', email: 'elev@test.ro' };
  const ops = await trimite({
    id: 'cs_bilet', customer: 'cus_nou', amount_total: 1000, currency: 'ron',
    metadata: { supabase_user_id: 'u2', live_kind: 'grup', live_session_id: 's1' },
  });
  const bilet = ops.find((o) => o.table === 'live_tickets' && o.op === 'upsert');
  assert.strictEqual(bilet.values.stripe_session_id, 'cs_bilet');
  assert.strictEqual(bilet.values.status, 'platit');
  const leg = legareClient(ops);
  assert.strictEqual(leg.length, 1);
  assert.deepStrictEqual(leg[0].values, { stripe_customer_id: 'cus_nou' });
  assert.deepStrictEqual(leg[0].filters, [['eq', 'id', 'u2'], ['is', 'stripe_customer_id', null]]);
});

test('webhook, pachet AI: creditarea ca înainte + legarea clientului (fără să suprascrie)', async () => {
  profilCurent = { full_name: 'Abonat Test', email: 'abonat@test.ro' };
  const ops = await trimite({
    id: 'cs_topup', customer: 'cus_ok', amount_total: 2000, currency: 'ron',
    metadata: { supabase_user_id: 'u1', topup_pack: 'mare', topup_name: 'Pachet AI Mare', topup_credit_lei: '10', topup_days: '30' },
  });
  const credit = ops.find((o) => o.table === 'ai_topups' && o.op === 'upsert');
  assert.strictEqual(credit.values.credit_micro, 10e6);
  assert.strictEqual(credit.values.stripe_session_id, 'cs_topup');
  const leg = legareClient(ops);
  assert.strictEqual(leg.length, 1);
  assert.deepStrictEqual(leg[0].filters, [['eq', 'id', 'u1'], ['is', 'stripe_customer_id', null]]);
});

test('webhook, abonament: neschimbat — clientul abonamentului se scrie pe profil', async () => {
  profilCurent = { full_name: 'Elev Test', email: 'elev@test.ro' };
  const ops = await trimite({
    id: 'cs_abonament', customer: 'cus_abonament', subscription: 'sub_1', amount_total: 5000, currency: 'ron',
    metadata: { supabase_user_id: 'u2', plan: 'lunar' },
  });
  const upd = legareClient(ops);
  assert.strictEqual(upd.length, 1);
  assert.strictEqual(upd[0].values.stripe_customer_id, 'cus_abonament');
  assert.strictEqual(upd[0].values.subscription_status, 'active');
  assert.ok(!upd[0].filters.some(([f]) => f === 'is'), 'abonamentul suprascrie clientul, ca înainte');
});
