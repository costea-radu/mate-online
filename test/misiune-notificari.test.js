// =====================================================================
// test/misiune-notificari.test.js — cererea din 30 octombrie 2026 (3, punctul 1):
//   „pune notificare pentru misiunea zilnică"
//
// api/_lib/misiuneNotificari.js (ora României, mesajele, cronul cu Supabase
// simulat: doar cine are amintirea pornită, doar dacă misiunea nu e făcută, o
// singură dată pe zi, fără liniște 22–8, clopoțelul când Web Push nu ajunge,
// alerta de serie seara), api/gamificare.js (acțiunile + cronul cu secret),
// SQL-ul (GRANT-urile din CLAUDE.md), vercel.json, cardul și service worker-ul.
// =====================================================================
process.env.CRON_SECRET = process.env.CRON_SECRET || 'secret-test-cron';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const xp = require('../api/_lib/xp');
const MN = require('../api/_lib/misiuneNotificari');
const PUSH = require('../api/_lib/push');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const U = {
  ana: '11111111-1111-4111-8111-111111111111',      // amintire la 17, misiunea nefăcută
  bogdan: '22222222-2222-4222-8222-222222222222',   // amintire la 17, misiunea deja făcută
  cris: '33333333-3333-4333-8333-333333333333',     // amintire la 17, notificările oprite din cont
  dan: '44444444-4444-4444-8444-444444444444',      // amintire oprită
  ema: '55555555-5555-4555-8555-555555555555',      // amintire la 19 (încă nu e ora)
};
// 30 octombrie 2026, 15:20 UTC = 17:20 în România (ora de iarnă, UTC+2)
const NOW = new Date('2026-10-30T15:20:00Z');
const AZI = xp.dayKey(NOW);

function seed() {
  const st = (id, extra) => ({ user_id: id, total_xp: 0, coins: 0, mission_category: 'clasa-7', mission_notify: true, mission_notify_hour: 17, mission_notified_on: null, mission_streak_notified_on: null, ...extra });
  return createFakeSupabase({
    user_stats: [
      st(U.ana), st(U.bogdan), st(U.cris), st(U.dan, { mission_notify: false }), st(U.ema, { mission_notify_hour: 19 }),
    ],
    profiles: [
      { id: U.ana, notifications_enabled: true }, { id: U.bogdan }, { id: U.cris, notifications_enabled: false },
      { id: U.dan }, { id: U.ema },
    ],
    daily_exercises: [
      { user_id: U.ana, day: AZI, status: 'deschis', content_id: 'c-frac', content_title: 'Fracții zecimale', category: 'clasa-7' },
      { user_id: U.ana, day: xp.addDays(AZI, -1), status: 'indeplinit', content_id: 'c1' },
      { user_id: U.ana, day: xp.addDays(AZI, -2), status: 'indeplinit', content_id: 'c2' },
      { user_id: U.bogdan, day: AZI, status: 'indeplinit', content_id: 'c3', content_title: 'Puteri' },
    ],
    ai_notifications: [],
  });
}

function stubPush(sentFor = () => 1) {
  const calls = [];
  const orig = PUSH.sendToUser;
  PUSH.sendToUser = async (supa, userId, payload) => { calls.push({ userId, payload }); const n = sentFor(userId); return { sent: n, failed: 0, gone: 0 }; };
  return { calls, restore: () => { PUSH.sendToUser = orig; } };
}

// ─── Logica pură ────────────────────────────────────────────────────────────
test('ora României: iarnă UTC+2, vară UTC+3; liniștea 22:00–8:00', () => {
  assert.strictEqual(MN.oraRo(new Date('2026-10-30T15:20:00Z')), 17);
  assert.strictEqual(MN.oraRo(new Date('2026-07-01T14:05:00Z')), 17);
  assert.strictEqual(MN.oraRo(new Date('2026-12-31T22:30:00Z')), 0);
  assert.strictEqual(MN.eLiniste(22), true);
  assert.strictEqual(MN.eLiniste(7), true);
  assert.strictEqual(MN.eLiniste(8), false);
  assert.strictEqual(MN.eLiniste(21), false);
  assert.deepStrictEqual([MN.ORE[0], MN.ORE[MN.ORE.length - 1]], [8, 21], 'elevul alege între 8:00 și 21:00');
  assert.strictEqual(MN.oraValida(17), true);
  assert.strictEqual(MN.oraValida(23), false);
});

test('momentul amintirii: la ora aleasă sau în ora următoare, o singură dată pe zi', () => {
  assert.strictEqual(MN.eMomentul({ ora: 17, trimisLa: null }, 17, AZI), true);
  assert.strictEqual(MN.eMomentul({ ora: 17, trimisLa: null }, 18, AZI), true, 'o oră de cron ratată se recuperează');
  assert.strictEqual(MN.eMomentul({ ora: 17, trimisLa: null }, 19, AZI), false);
  assert.strictEqual(MN.eMomentul({ ora: 17, trimisLa: null }, 16, AZI), false);
  assert.strictEqual(MN.eMomentul({ ora: 17, trimisLa: AZI }, 17, AZI), false, 'deja trimisă azi');
  assert.strictEqual(MN.eMomentul({ ora: 17, trimisLa: xp.addDays(AZI, -1) }, 17, AZI), true);
  assert.strictEqual(MN.eMomentul({ ora: 21, trimisLa: null }, 22, AZI), false, 'nu după 22:00');
});

test('mesajele: exercițiul zilei, seria, linkul direct spre exercițiu; alerta de seară', () => {
  const a = MN.mesajAmintire({ titlu: 'Fracții zecimale', clasa: 'clasa-7', serie: 2, exercitiuId: 'c-frac', azi: AZI });
  assert.match(a.title, /Misiunea zilei · seria ta: 2 zile/);
  assert.match(a.body, /Fracții zecimale/);
  assert.match(a.body, /50%/);
  assert.strictEqual(a.url, '/exercitiu?id=c-frac&misiune=1');
  assert.strictEqual(a.tag, `misiune-${AZI}`);
  assert.strictEqual(a.requireInteraction, false, 'amintirea dispare singură');
  const b = MN.mesajAmintire({ clasa: 'clasa-5', serie: 0, azi: AZI });
  assert.strictEqual(b.title, '🎯 Misiunea zilei te așteaptă');
  assert.match(b.body, /clasa a V-a/);
  assert.strictEqual(b.url, '/arena', 'fără exercițiu atribuit încă → Arena (îl atribuie la deschidere)');
  assert.match(MN.mesajAmintire({ serie: 1 }).title, /1 zi 🔥/);
  const s = MN.mesajSerie({ serie: 5, titlu: 'Puteri', exercitiuId: 'x', azi: AZI });
  assert.match(s.title, /Seria ta de 5 zile se pierde la noapte/);
  assert.match(s.body, /Puteri/);
  assert.strictEqual(s.tag, `misiune-${AZI}`, 'înlocuiește amintirea de după-amiază');
});

// ─── Cronul ─────────────────────────────────────────────────────────────────
test('cronul de la 17: doar cine are amintirea pornită, misiunea nefăcută și notificările permise', async () => {
  const supa = seed();
  const p = stubPush();
  try {
    const r = await MN.cron(supa, { now: NOW });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.ora, 17);
    assert.deepStrictEqual(p.calls.map((c) => c.userId), [U.ana], 'doar Ana: Bogdan a făcut-o, Cris a oprit notificările, Dan a oprit amintirea, Ema are 19:00');
    const pay = p.calls[0].payload;
    assert.match(pay.title, /seria ta: 2 zile/, 'seria de până ieri e încă vie');
    assert.match(pay.body, /Fracții zecimale/);
    assert.strictEqual(pay.url, '/exercitiu?id=c-frac&misiune=1');
    assert.strictEqual(r.amintiri.trimise, 1);
    assert.strictEqual(r.amintiri.push, 1);
    assert.strictEqual(r.amintiri.facute, 1);
    assert.strictEqual(r.amintiri.oprite, 1);
    // toate cele 3 de la ora 17 sunt revendicate pe azi (nu se mai verifică la 18:00)
    const st = (id) => supa.db.tables.user_stats.find((x) => x.user_id === id);
    assert.strictEqual(st(U.ana).mission_notified_on, AZI);
    assert.strictEqual(st(U.bogdan).mission_notified_on, AZI);
    assert.strictEqual(st(U.ema).mission_notified_on, null);
    // a doua rulare (aceeași oră sau 18:00) nu mai trimite nimic
    const r2 = await MN.cron(supa, { now: new Date('2026-10-30T16:10:00Z') });
    assert.strictEqual(r2.amintiri.trimise, 0);
    assert.strictEqual(p.calls.length, 1);
    assert.strictEqual(supa.db.tables.ai_notifications.length, 0, 'Web Push a ajuns — fără dublură în clopoțel');
  } finally { p.restore(); }
});

test('fără Web Push livrat (iPhone, permisiune refuzată, chei lipsă): amintirea ajunge în clopoțel, o dată pe zi', async () => {
  const supa = seed();
  const p = stubPush(() => 0);
  try {
    const r = await MN.cron(supa, { now: NOW });
    assert.strictEqual(r.amintiri.clopotel, 1);
    const n = supa.db.tables.ai_notifications;
    assert.strictEqual(n.length, 1);
    assert.strictEqual(n[0].recipient_id, U.ana);
    assert.strictEqual(n[0].type, 'misiune');
    assert.strictEqual(n[0].data.url, '/exercitiu?id=c-frac&misiune=1');
    assert.strictEqual(n[0].dedupe_key, `misiune-zi:${AZI}`);
  } finally { p.restore(); }
});

test('liniștea de noapte: cronul de la 23:00 nu trimite nimic', async () => {
  const supa = seed();
  const p = stubPush();
  try {
    const r = await MN.cron(supa, { now: new Date('2026-10-30T21:05:00Z') });
    assert.match(r.sarit || '', /liniste/);
    assert.strictEqual(p.calls.length, 0);
  } finally { p.restore(); }
});

test('seara (20:00): „seria se pierde la noapte" — doar la serie ≥ 2, misiunea nefăcută, o singură dată', async () => {
  const supa = seed();
  // Ana a primit deja amintirea de la 17; Ema (ora 19) are seria 1 → fără alertă
  supa.db.tables.user_stats.find((x) => x.user_id === U.ana).mission_notified_on = AZI;
  supa.db.tables.daily_exercises.push({ user_id: U.ema, day: xp.addDays(AZI, -1), status: 'indeplinit', content_id: 'c9' });
  const p = stubPush();
  try {
    const seara = new Date('2026-10-30T18:07:00Z'); // 20:07 în România
    const r = await MN.cron(supa, { now: seara });
    const serie = p.calls.filter((c) => /se pierde la noapte/.test(c.payload.title));
    assert.deepStrictEqual(serie.map((c) => c.userId), [U.ana]);
    assert.match(serie[0].payload.title, /Seria ta de 2 zile/);
    assert.strictEqual(r.serie.trimise, 1);
    const again = await MN.cron(supa, { now: new Date('2026-10-30T18:40:00Z') });
    assert.strictEqual(again.serie.trimise, 0, 'o singură alertă de serie pe zi');
  } finally { p.restore(); }
});

test('fără migrare: cronul spune ce e de rulat, fără să arunce', async () => {
  const supa = seed();
  supa.db.failTables.add('user_stats');
  const r = await MN.cron(supa, { now: NOW });
  assert.strictEqual(r.ok, false);
});

// ─── API ────────────────────────────────────────────────────────────────────
test('api/gamificare: „misiune" aduce și amintirea; „misiune_notificari" o pornește, cu ora și abonarea Web Push', async () => {
  const ai = require('../api/_lib/ai');
  const supa = seed();
  supa.db.tables.user_stats.find((x) => x.user_id === U.dan).mission_notify = null;
  const orig = { admin: ai.admin, authUser: ai.authUser, requireUser: ai.requireUser, pushInfo: PUSH.pushInfo, save: PUSH.saveSubscription };
  const saved = [];
  ai.admin = () => supa;
  ai.authUser = async () => U.dan;
  ai.requireUser = async () => ({ id: U.dan, subscription_status: 'inactive' });
  PUSH.pushInfo = async () => ({ on: true, key: 'BKEY', why: null });
  PUSH.saveSubscription = async (s, uid, sub) => { saved.push({ uid, sub }); return true; };
  delete require.cache[require.resolve('../api/gamificare')];
  const handler = require('../api/gamificare');
  try {
    let res = fakeRes();
    await handler({ method: 'POST', query: {}, headers: {}, body: { action: 'misiune_notificari', on: true, ora: 18, subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x'.repeat(60), auth: 'y'.repeat(16) } } } }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.notificari.on, true);
    assert.strictEqual(res.body.notificari.ora, 18);
    assert.strictEqual(res.body.notificari.push.key, 'BKEY');
    assert.strictEqual(res.body.pushSalvat, true);
    assert.strictEqual(saved.length, 1);
    const row = supa.db.tables.user_stats.find((x) => x.user_id === U.dan);
    assert.deepStrictEqual([row.mission_notify, row.mission_notify_hour], [true, 18]);
    // ora invalidă → 400
    res = fakeRes();
    await handler({ method: 'POST', query: {}, headers: {}, body: { action: 'misiune_notificari', ora: 3 } }, res);
    assert.strictEqual(res.statusCode, 400);
    // oprită: abonarea nu se mai trimite
    res = fakeRes();
    await handler({ method: 'POST', query: {}, headers: {}, body: { action: 'misiune_notificari', on: false } }, res);
    assert.strictEqual(res.body.notificari.on, false);
    assert.strictEqual(res.body.notificari.ales, true, 'a răspuns — cardul nu mai insistă');
    // cronul cere secretul
    res = fakeRes();
    await handler({ method: 'GET', query: { action: 'cron-misiune' }, headers: {} }, res);
    assert.strictEqual(res.statusCode, 403);
    res = fakeRes();
    await handler({ method: 'GET', query: { action: 'cron-misiune' }, headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok('amintiri' in res.body);
  } finally {
    Object.assign(ai, { admin: orig.admin, authUser: orig.authUser, requireUser: orig.requireUser });
    PUSH.pushInfo = orig.pushInfo; PUSH.saveSubscription = orig.save;
    delete require.cache[require.resolve('../api/gamificare')];
  }
});

// ─── SQL, cron, card, service worker ────────────────────────────────────────
test('SQL: coloanele din user_stats + push_subscriptions cu RLS și GRANT (fără anon), idempotent', () => {
  const sql = read('supabase/misiune_notificari.sql');
  for (const c of ['mission_notify boolean', 'mission_notify_hour smallint', 'mission_notified_on date', 'mission_streak_notified_on date']) {
    assert.ok(sql.includes(`add column if not exists ${c}`), c);
  }
  assert.match(sql, /create table if not exists public\.push_subscriptions/);
  assert.match(sql, /alter table public\.push_subscriptions enable row level security/);
  assert.match(sql, /grant select, insert, update, delete on public\.push_subscriptions to authenticated/);
  assert.match(sql, /grant select, insert, update, delete on public\.push_subscriptions to service_role/);
  assert.doesNotMatch(sql, /to anon/);
});

test('vercel.json: cronul amintirilor rulează la fiecare oră; cardul și service worker-ul', () => {
  const v = JSON.parse(read('vercel.json'));
  const c = v.crons.find((x) => x.path === '/api/gamificare?action=cron-misiune');
  assert.ok(c, 'cronul misiunii');
  assert.strictEqual(c.schedule, '5 * * * *');
  const card = read('src/components/MisiuneZilnica.jsx');
  assert.match(card, /function AmintireMisiune/);
  assert.match(card, /misiune_notificari_proba/);
  assert.match(card, /askNotifyPermission\(\)/, 'permisiunea se cere doar la clicul elevului');
  assert.match(card, /<AmintireMisiune /);
  const sw = read('public/sw-push.js');
  assert.match(sw, /requireInteraction: data\.requireInteraction !== false/);
  assert.match(read('src/components/AINotifications.jsx'), /misiune: '🎯'/);
});
