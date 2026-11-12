// =====================================================================
// test/abonament-copil.test.js — 11 noiembrie 2026 (seara), „de la cont la abonament":
//   1) PĂRINTELE plătește abonamentul COPILULUI: se activează pe contul elevului
//      (api/create-checkout.js → pentruElev, api/_lib/abonamentCopil.js), doar
//      pentru un copil asociat cu el; îl gestionează din contul lui (create-portal);
//   2) ELEVUL își invită părintele cu un link semnat (api/asociere.js);
//   3) planul ales înainte de înregistrare nu se mai pierde (src/lib/continuare.js);
//   4) pagina /preturi: planul și plata primele, cinci rânduri la „Ce primești".
// Fără rețea: Stripe și Supabase sunt simulate.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

const PARINTE = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const COPIL = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const COPIL2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const STRAIN = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROF = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

// ── baza de date simulată (tabele în memorie) ──
let DB = null;
function reseteaza() {
  DB = {
    profiles: [
      { id: PARINTE, full_name: 'Mihai Ionescu', email: 'mihai@example.com', role: 'parinte', subscription_status: 'inactive', is_admin: false, stripe_customer_id: null, subscription_id: null },
      { id: COPIL, full_name: 'Andrei Ionescu', email: 'andrei@example.com', role: 'elev', subscription_status: 'inactive', is_admin: false, stripe_customer_id: null, subscription_id: null },
      { id: COPIL2, full_name: 'Maria Ionescu', email: 'maria@example.com', role: 'elev', subscription_status: 'active', is_admin: false, stripe_customer_id: 'cus_maria', subscription_id: 'sub_maria' },
      { id: STRAIN, full_name: 'Alt Elev', email: 'alt@example.com', role: 'elev', subscription_status: 'inactive', is_admin: false, stripe_customer_id: null, subscription_id: null },
      { id: PROF, full_name: 'Elena Popescu', email: 'elena@example.com', role: 'profesor', subscription_status: 'inactive', is_admin: false, stripe_customer_id: null, subscription_id: null },
    ],
    mentor_students: [
      { mentor_id: PARINTE, student_id: COPIL, mentor_role: 'parinte' },
      { mentor_id: PARINTE, student_id: COPIL2, mentor_role: 'parinte' },
      { mentor_id: PROF, student_id: STRAIN, mentor_role: 'profesor' },
    ],
    ai_notifications: [],
  };
}
reseteaza();
function supabaseFals() {
  return {
    from(table) {
      const rows = () => (DB[table] || (DB[table] = []));
      const q = { op: 'select', filters: [], values: null, lim: null };
      const potrivite = () => rows().filter((r) => q.filters.every(([k, c, v]) => (k === 'eq' ? r[c] === v : k === 'in' ? v.includes(r[c]) : k === 'is' ? r[c] == null : true)));
      const ruleaza = () => {
        if (q.op === 'update') { for (const r of potrivite()) Object.assign(r, q.values); return { data: null, error: null }; }
        if (q.op === 'upsert') {
          const chei = String((q.opts && q.opts.onConflict) || '').split(',').filter(Boolean);
          const exista = rows().find((r) => chei.length && chei.every((k) => r[k] === q.values[k]));
          if (!exista) rows().push({ ...q.values });
          return { data: null, error: null };
        }
        if (q.op === 'insert') { rows().push({ ...q.values }); return { data: null, error: null }; }
        const d = potrivite();
        return { data: q.lim ? d.slice(0, q.lim) : d, error: null };
      };
      const b = {
        select() { return b; },
        update(v) { q.op = 'update'; q.values = v; return b; },
        upsert(v, opts) { q.op = 'upsert'; q.values = v; q.opts = opts; return b; },
        insert(v) { q.op = 'insert'; q.values = v; return b; },
        eq(c, v) { q.filters.push(['eq', c, v]); return b; },
        in(c, v) { q.filters.push(['in', c, v]); return b; },
        is(c, v) { q.filters.push(['is', c, v]); return b; },
        gte() { return b; },
        limit(n) { q.lim = n; return b; },
        single() { const r = ruleaza(); return Promise.resolve({ data: r.data[0] || null, error: r.data[0] ? null : { message: 'no rows' } }); },
        maybeSingle() { const r = ruleaza(); return Promise.resolve({ data: r.data ? r.data[0] || null : null, error: null }); },
        then(ok, ko) { return Promise.resolve(ruleaza()).then(ok, ko); },
      };
      return b;
    },
  };
}

// ── Stripe simulat ──
const sesiuni = [];
const portaluri = [];
const abonamente = { sub_maria: { id: 'sub_maria', metadata: { supabase_user_id: COPIL2, platit_de: PARINTE } } };
const stripePath = require.resolve('stripe');
require.cache[stripePath] = {
  id: stripePath, filename: stripePath, loaded: true,
  exports: () => ({
    checkout: { sessions: { create: async (opts) => { sesiuni.push(opts); return { url: 'https://checkout.stripe.test/s' }; } } },
    billingPortal: { sessions: { create: async (opts) => { portaluri.push(opts); return { url: 'https://portal.stripe.test/p' }; } } },
    subscriptions: { retrieve: async (id) => { if (!abonamente[id]) throw new Error('No such subscription'); return abonamente[id]; } },
    customers: { retrieve: async (id) => ({ id }) },
  }),
};
const supabasePath = require.resolve('@supabase/supabase-js');
require.cache[supabasePath] = { id: supabasePath, filename: supabasePath, loaded: true, exports: { createClient: () => supabaseFals() } };

let cine = PARINTE;
const http = require('../api/_lib/http');
http.authUser = async () => cine;
http.admin = () => supabaseFals();
process.env.SITE_URL = 'https://examenmate.com';

const AC = require('../api/_lib/abonamentCopil');
const checkout = require('../api/create-checkout.js');
const portal = require('../api/create-portal.js');
const asociere = require('../api/asociere.js');

function cerere(handler, body) {
  return new Promise((resolve) => {
    const res = {
      code: 200, headers: {},
      setHeader(k, v) { this.headers[k] = v; }, getHeader(k) { return this.headers[k]; },
      status(c) { this.code = c; return this; },
      json(o) { resolve({ status: this.code, body: o }); return this; },
      end() { resolve({ status: this.code, body: null }); return this; },
    };
    Promise.resolve(handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body, query: {} }, res)).catch((e) => resolve({ status: 500, body: { error: e.message } }));
  });
}

test('copiii părintelui: doar cei asociați cu el ca părinte, cu starea abonamentului', async () => {
  reseteaza();
  const supa = supabaseFals();
  assert.deepStrictEqual(await AC.copiiiParintelui(supa, PARINTE), [
    { id: COPIL, nume: 'Andrei Ionescu', premium: false },
    { id: COPIL2, nume: 'Maria Ionescu', premium: true },
  ]);
  assert.deepStrictEqual(await AC.copiiiParintelui(supa, STRAIN), []);
  assert.deepStrictEqual(await AC.copiiiParintelui(supa, PROF), [], 'elevii unui profesor nu sunt „copiii" lui');
  // copilul pentru care se plătește: asociat cu acest părinte, altfel 403
  assert.strictEqual((await AC.copilulParintelui(supa, PARINTE, COPIL)).id, COPIL);
  await assert.rejects(() => AC.copilulParintelui(supa, PARINTE, STRAIN), (e) => e.status === 403 && e.code === 'NU_E_COPILUL_TAU');
  await assert.rejects(() => AC.copilulParintelui(supa, PROF, STRAIN), (e) => e.status === 403, 'profesorul nu plătește „pentru copil"');
  await assert.rejects(() => AC.copilulParintelui(supa, PARINTE, 'nu-e-uuid'), (e) => e.status === 400 && e.code === 'COPIL_NEALES');
  await assert.rejects(() => AC.copilulParintelui(supa, PARINTE, PARINTE), (e) => e.status === 400);
  assert.strictEqual(AC.numeDin({ email: 'ana.pop@example.com' }), 'ana.pop');
  assert.strictEqual(AC.numeDin(null), 'Elev');
});

test('părintele plătește pentru copil: abonamentul merge pe contul ELEVULUI, factura la părinte', async () => {
  reseteaza(); cine = PARINTE; sesiuni.length = 0;
  const r = await cerere(checkout, { plan: 'anual', pentruElev: COPIL });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.url, 'https://checkout.stripe.test/s');
  const s = sesiuni[0];
  assert.strictEqual(s.mode, 'subscription');
  assert.strictEqual(s.customer_email, 'mihai@example.com', 'e-mailul plătitorului');
  assert.deepStrictEqual(s.metadata, { supabase_user_id: COPIL, plan: 'anual', platit_de: PARINTE });
  assert.deepStrictEqual(s.subscription_data.metadata, { supabase_user_id: COPIL, plan: 'anual', platit_de: PARINTE });
  assert.match(s.success_url, /\/profil\?session_id=\{CHECKOUT_SESSION_ID\}&plan=anual&val=500&copil=1$/);
  assert.match(s.cancel_url, /\/preturi\?anulat=1&plan=anual$/);
  // webhookul (neschimbat) activează contul din metadata.supabase_user_id
  assert.match(read('api/stripe-webhook.js'), /session\.metadata\?\.supabase_user_id/);

  // copil care are deja abonament → refuz; elev care nu e al lui → 403; id stricat → 400
  sesiuni.length = 0;
  const are = await cerere(checkout, { plan: 'lunar', pentruElev: COPIL2 });
  assert.strictEqual(are.status, 400);
  assert.strictEqual(are.body.code, 'COPIL_ABONAT');
  assert.match(are.body.error, /Maria Ionescu are deja un abonament activ/);
  const strain = await cerere(checkout, { plan: 'lunar', pentruElev: STRAIN });
  assert.strictEqual(strain.status, 403);
  const stricat = await cerere(checkout, { plan: 'lunar', pentruElev: 'x' });
  assert.strictEqual(stricat.status, 400);
  assert.strictEqual(sesiuni.length, 0, 'nicio sesiune de plată la refuz');
  // un elev nu poate „plăti pentru" alt cont
  cine = STRAIN;
  assert.strictEqual((await cerere(checkout, { plan: 'lunar', pentruElev: COPIL })).status, 403);
});

test('fără „pentruElev" plata e ca înainte: abonamentul pe contul care plătește', async () => {
  reseteaza(); cine = COPIL; sesiuni.length = 0;
  const r = await cerere(checkout, { plan: 'lunar' });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(sesiuni[0].metadata, { supabase_user_id: COPIL, plan: 'lunar' });
  assert.deepStrictEqual(sesiuni[0].subscription_data.metadata, { supabase_user_id: COPIL, plan: 'lunar' });
  assert.doesNotMatch(sesiuni[0].success_url, /copil=/);
  cine = COPIL2;
  const are = await cerere(checkout, { plan: 'lunar' });
  assert.strictEqual(are.status, 400);
  assert.match(are.body.error, /Ai deja un abonament activ/);
  // lista copiilor, pentru pagina de prețuri
  cine = PARINTE;
  const lista = await cerere(checkout, { type: 'copii' });
  assert.deepStrictEqual(lista.body.copii.map((c) => [c.nume, c.premium]), [['Andrei Ionescu', false], ['Maria Ionescu', true]]);
});

test('portalul de plată al copilului: doar părintele care a plătit abonamentul', async () => {
  reseteaza(); cine = PARINTE; portaluri.length = 0;
  const r = await cerere(portal, { pentruElev: COPIL2 });
  assert.strictEqual(r.status, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(portaluri[0], { customer: 'cus_maria', return_url: 'https://examenmate.com/preturi' });
  // copil fără abonament → 400; abonament plătit de altcineva → 403; elev străin → 403
  assert.strictEqual((await cerere(portal, { pentruElev: COPIL })).status, 400);
  abonamente.sub_maria.metadata.platit_de = COPIL2;   // și l-a plătit singur
  const altul = await cerere(portal, { pentruElev: COPIL2 });
  assert.strictEqual(altul.status, 403);
  assert.strictEqual(altul.body.error.includes('nu a fost făcut de pe contul tău'), true);
  abonamente.sub_maria.metadata.platit_de = PARINTE;
  assert.strictEqual((await cerere(portal, { pentruElev: STRAIN })).status, 403);
  assert.strictEqual(portaluri.length, 1);
  // fără pentruElev: portalul propriu, ca înainte
  cine = COPIL2;
  const propriu = await cerere(portal, {});
  assert.strictEqual(propriu.status, 200);
  assert.deepStrictEqual(portaluri[1], { customer: 'cus_maria', return_url: 'https://examenmate.com/profil' });
});

test('elevul își invită părintele: link semnat, valabil 14 zile; părintele se asociază cu contul lui', async () => {
  reseteaza(); cine = STRAIN;
  const inv = await cerere(asociere, { action: 'invita_parinte' });
  assert.strictEqual(inv.status, 200, JSON.stringify(inv.body));
  assert.strictEqual(inv.body.zile, 14);
  assert.match(inv.body.token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, 'merge într-o adresă');
  const token = inv.body.token;
  // profesorii și părinții nu trimit invitația
  cine = PARINTE;
  assert.strictEqual((await cerere(asociere, { action: 'invita_parinte' })).body.code, 'DOAR_ELEV');

  // părintele deschide linkul → asociat ca părinte; copilul e anunțat
  const as = await cerere(asociere, { elevToken: token });
  assert.strictEqual(as.status, 200, JSON.stringify(as.body));
  assert.deepStrictEqual(as.body, { student_id: STRAIN, student_name: 'Alt Elev', mentor_role: 'parinte' });
  assert.ok(DB.mentor_students.some((l) => l.mentor_id === PARINTE && l.student_id === STRAIN && l.mentor_role === 'parinte'));
  assert.strictEqual(DB.ai_notifications.length, 1);
  assert.strictEqual(DB.ai_notifications[0].recipient_id, STRAIN);
  // a doua oară nu dublează asocierea
  await cerere(asociere, { elevToken: token });
  assert.strictEqual(DB.mentor_students.filter((l) => l.mentor_id === PARINTE && l.student_id === STRAIN).length, 1);
  // de acum îi poate face abonamentul
  sesiuni.length = 0;
  assert.strictEqual((await cerere(checkout, { plan: 'lunar', pentruElev: STRAIN })).status, 200);
  assert.strictEqual(sesiuni[0].metadata.supabase_user_id, STRAIN);

  // refuzuri: token stricat / fabricat, propria invitație, cont de elev
  assert.strictEqual((await cerere(asociere, { elevToken: 'abc.def' })).body.code, 'INVITATIE_EXPIRATA');
  const fabricat = `${Buffer.from(JSON.stringify({ t: 'invita', elev: COPIL })).toString('base64url')}.${'A'.repeat(43)}`;
  assert.strictEqual((await cerere(asociere, { elevToken: fabricat })).body.code, 'INVITATIE_EXPIRATA', 'semnătura se verifică');
  cine = STRAIN;
  assert.strictEqual((await cerere(asociere, { elevToken: token })).body.code, 'PROPRIA_INVITATIE');
  cine = COPIL;
  assert.strictEqual((await cerere(asociere, { elevToken: token })).body.code, 'CONT_DE_ELEV');
  // un cont fără tip ales devine de părinte
  DB.profiles.push({ id: 'ffffffff-ffff-4fff-8fff-ffffffffffff', full_name: 'Tata Nou', email: 't@example.com', role: null, subscription_status: 'inactive' });
  cine = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
  assert.strictEqual((await cerere(asociere, { elevToken: token })).body.mentor_role, 'parinte');
  assert.strictEqual(DB.profiles.find((p) => p.id === cine).role, 'parinte');
  // asocierea clasică (codul mentorului) a rămas neschimbată
  assert.match(read('api/asociere.js'), /\.eq\('teacher_code', normCode\)/);
});

test('planul ales și invitația copilului: ținute minte până după autentificare', async () => {
  const C = await import('../src/lib/continuare.js');
  const stocare = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
  const st = stocare();
  const t0 = 1_800_000_000_000;
  assert.strictEqual(C.undeContinua({ storage: st, now: t0 }), null);
  assert.strictEqual(C.tineMintePlanul('anual', { storage: st, now: t0 }), true);
  assert.strictEqual(C.tineMintePlanul('gratis', { storage: st, now: t0 }), false, 'doar planurile care există');
  assert.strictEqual(C.planTinutMinte({ storage: st, now: t0 + 3600_000 }), 'anual');
  assert.strictEqual(C.undeContinua({ storage: st, now: t0 + 3600_000 }), '/preturi?plan=anual');
  assert.strictEqual(C.undeContinua({ storage: st, now: t0 + 3600_000 }), null, 'o singură dată');
  // după 24 h planul nu mai contează; cu abonament deja făcut nu mai ducem nicăieri
  C.tineMintePlanul('lunar', { storage: st, now: t0 });
  assert.strictEqual(C.undeContinua({ storage: st, now: t0 + C.PLAN_VALABIL_MS + 1 }), null);
  C.tineMintePlanul('lunar', { storage: st, now: t0 });
  assert.strictEqual(C.undeContinua({ storage: st, now: t0, areAbonament: true }), null);
  assert.strictEqual(C.planTinutMinte({ storage: st, now: t0 }), null);
  // invitația copilului are întâietate și rămâne până o folosește pagina de asociere
  const tok = `${'a'.repeat(40)}.${'b'.repeat(43)}`;
  C.tineMintePlanul('anual', { storage: st, now: t0 });
  assert.strictEqual(C.tineMinteInvitatia(tok, { storage: st }), true);
  assert.strictEqual(C.tineMinteInvitatia('<script>', { storage: st }), false);
  assert.strictEqual(C.undeContinua({ storage: st, now: t0 }), `/asociere?elev=${tok}`);
  assert.strictEqual(C.undeContinua({ storage: st, now: t0 }), `/asociere?elev=${tok}`);
  C.uitaInvitatia({ storage: st });
  assert.strictEqual(C.undeContinua({ storage: st, now: t0 }), '/preturi?plan=anual');
  // fără localStorage nimic nu pică
  assert.strictEqual(C.tineMintePlanul('anual', { storage: null }), false);
  assert.strictEqual(C.undeContinua({ storage: null }), null);

  const cont = read('src/components/Continuare.jsx');
  assert.match(cont, /if \(loading \|\| !user\?\.id \|\| !profile \|\| !profile\.role\) return;/, 'după ce contul are tipul ales');
  assert.match(cont, /pathname\.startsWith\('\/asociere'\) \|\| new URLSearchParams\(search\)\.has\('session_id'\)/);
  assert.match(read('src/App.jsx'), /<Continuare \/>/);
});

test('/preturi: planul și plata primele; părintele alege copilul; elevul trimite linkul părintelui', () => {
  const p = read('src/pages/Pricing.jsx');
  // ordinea: (părinte) copilul → planurile → butonul de plată → „Ce primești"
  const ord = ['className="pret-copii"', 'className="pret-planuri"', 'className="pret-plata"', 'className="pret-ce"', 'className="pret-intrebari"'];
  let last = -1;
  for (const s of ord) { const i = p.indexOf(s); assert.ok(i > last, s); last = i; }
  assert.match(p, /\.\.\.\(parinte \? \{ pentruElev: copil\.id \} : \{\}\)/);
  assert.match(p, /cere\('\/api\/create-checkout', \{ type: 'copii' \}\)/);
  assert.match(p, /disabled=\{loading \|\| \(parinte && !copil\)\}/);
  assert.match(p, /tineMintePlanul\(planAles\.id\);\s*\n\s*navigate\('\/inregistrare'\);/);
  assert.match(p, /PLANS\.some\(\(p\) => p\.id === params\.get\('plan'\)\) \? params\.get\('plan'\) : 'anual'/);
  assert.match(p, /cere\('\/api\/asociere', \{ action: 'invita_parinte' \}\)/);
  assert.match(p, /`\$\{window\.location\.origin\}\/asociere\?elev=\$\{d\.token\}`/);
  assert.match(p, /handleManage\(c\.id\)/);
  // „Ce primești": cinci rânduri pe tip de cont, fără numele modelelor AI
  const bloc = p.slice(p.indexOf('const CE_PRIMESTI = {'), p.indexOf('async function cere'));
  assert.strictEqual((bloc.match(/\['[^']+', '[^']+'\]/g) || []).length, 10, '5 pentru elev / părinte + 5 pentru profesor');
  assert.ok(!/GPT|Claude|OpenAI|Anthropic|AI_STACK|AIPoweredBy/.test(p));
  assert.ok(!/sessionStorage\.setItem\('em_plan'/.test(p), 'planul nu mai stă într-o cheie pe care n-o citea nimeni');
  assert.ok(!/to="\/asociere"/.test(p), 'fără linkul spre /asociere fără cod (dădea „Link invalid")');
  // pagina de asociere: invitația copilului
  const a = read('src/pages/Asociere.jsx');
  assert.match(a, /const elevToken = params\.get\('elev'\) \|\| '';/);
  assert.match(a, /tineMinteInvitatia\(elevToken\);/);
  assert.match(a, /body: JSON\.stringify\(\{ elevToken \}\)/);
  assert.match(a, /to=\{`\/preturi\?copil=\$\{copil\.id\}`\}/);
  assert.match(a, /to="\/inregistrare\?tip=parinte"/);
  // „Contul meu", după plata făcută de părinte
  const prof = read('src/pages/Profile.jsx');
  assert.match(prof, /setCheckoutSuccess\(pentruCopil \? 'copil' : true\);/);
  assert.match(prof, /let stop = pentruCopil;/);
});
