// „🧩 Test din site" (tabla din „Planul meu"): lista are acum și TESTELE
// INTERACTIVE, nu doar PDF-urile. Testul interactiv ales de elev se înregistrează
// ca sesiune „din site" (action 'site_test'), ca scorul să intre în plan.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ai = require('../api/_lib/ai.js');
const handler = require('../api/ai-meditatii.js');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ─── clasificarea testului ales ────────────────────────────────────────────
test('siteTestKind: „Teste interactive" de la EN/BAC = simulare, cu examenul lor', () => {
  const k = handler.siteTestKind;
  assert.deepStrictEqual(
    k({ category: 'evaluare-nationala', subcategory: 'teste-interactive', title: 'Test 1' }, { exam_target: 'evaluare-nationala' }),
    { kind: 'simulare', topic: 'evaluare-nationala', examType: 'evaluare-nationala' },
  );
  // la BAC, profilul TESTULUI decide examenul (nu presupunem profilul elevului)
  assert.strictEqual(k({ category: 'bacalaureat', subcategory: 'teste-interactive', profile: 'stiinte-naturii' }, { exam_target: 'bac-mate-info' }).topic, 'bac-stiinte');
  assert.strictEqual(k({ category: 'bacalaureat', subcategory: 'teste-interactive', profile: 'tehnologic' }, {}).topic, 'bac-tehnologic');
  // fără profil pe test → examenul elevului
  assert.strictEqual(k({ category: 'bacalaureat', subcategory: 'teste-interactive' }, { exam_target: 'bac-mate-info', grade: 12 }).topic, 'bac-mate-info');
});

test('siteTestKind: exercițiile pe subiecte, capitolele și testele de la clase = set de exerciții', () => {
  const k = handler.siteTestKind;
  const a = k({ category: 'bacalaureat', subcategory: 'exercitii', title: '  Subiectul I —   Numere complexe ' }, {});
  assert.deepStrictEqual(a, { kind: 'exercitii', topic: 'Subiectul I — Numere complexe', examType: null });
  assert.strictEqual(k({ category: 'evaluare-nationala', subcategory: 'capitole', title: 'Fracții' }, {}).kind, 'exercitii');
  assert.strictEqual(k({ category: 'clasa-7', subcategory: null, title: 'Test: rapoarte și proporții' }, {}).kind, 'exercitii');
  assert.strictEqual(k({ category: 'clasa-7', title: 'x'.repeat(300) }, {}).topic.length, 120);
  assert.strictEqual(k({ category: 'clasa-7' }, {}).topic, 'Test din site');
});

// ─── acțiunea 'site_test' (handlerul complet, cu Supabase simulat) ──────────
function fakeSupa({ content = null, medProfile = { user_id: 'u1', exam_target: 'bac-mate-info', grade: 11 }, openSession = null } = {}) {
  const log = { inserts: [], filters: [] };
  const supa = {
    log,
    from(table) {
      const q = {
        _f: {},
        select() { return q; },
        eq(col, val) { q._f[col] = val; log.filters.push([table, col, val]); return q; },
        order() { return q; },
        limit() {
          if (table === 'ai_meditatii_sessions') return Promise.resolve({ data: openSession ? [openSession] : [], error: null });
          return Promise.resolve({ data: [], error: null });
        },
        maybeSingle() {
          if (table === 'content') {
            const ok = content && q._f.id === content.id && q._f.content_type === content.content_type;
            return Promise.resolve({ data: ok ? content : null, error: null });
          }
          if (table === 'ai_meditatii_profile') return Promise.resolve({ data: medProfile, error: null });
          return Promise.resolve({ data: null, error: null });
        },
        single() { return Promise.resolve({ data: q._insert ? { id: 'sess-nou' } : null, error: null }); },
        insert(row) { log.inserts.push({ table, row }); q._insert = row; return q; },
      };
      return q;
    },
  };
  return supa;
}

function fakeRes() {
  const r = { code: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

async function call(supa, body, account = { id: 'u1', subscription_status: 'active', is_admin: false }) {
  const saved = { admin: ai.admin, authUser: ai.authUser, requireUser: ai.requireUser };
  ai.admin = () => supa;
  ai.authUser = async () => 'u1';
  ai.requireUser = async () => account;
  try {
    const res = fakeRes();
    await handler({ method: 'POST', body: { action: 'site_test', ...body }, headers: {}, query: {} }, res);
    return res;
  } finally { Object.assign(ai, saved); }
}

const TEST_BAC = { id: 'c-42', title: 'Test interactiv BAC — funcții', is_free: false, content_type: 'interactive', category: 'bacalaureat', subcategory: 'teste-interactive', profile: 'mate-info' };

test('site_test înregistrează testul ales și îl deschide cu medSesId', async () => {
  const supa = fakeSupa({ content: TEST_BAC });
  const res = await call(supa, { contentId: 'c-42' });
  assert.strictEqual(res.code, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.siteTest.url, '/exercitiu?id=c-42&medSesId=sess-nou');
  assert.strictEqual(res.body.kind, 'simulare');
  const ins = supa.log.inserts.find((i) => i.table === 'ai_meditatii_sessions');
  assert.ok(ins, 'sesiunea se creează');
  assert.strictEqual(ins.row.status, 'activa');
  assert.strictEqual(ins.row.topic, 'bac-mate-info');
  assert.strictEqual(ins.row.payload.contentId, 'c-42');     // session_score cere payload.contentId
  assert.strictEqual(ins.row.payload.site, true);
  assert.strictEqual(ins.row.payload.picked, true);
  // doar materiale INTERACTIVE (un PDF nu se poate bifa prin viewer)
  assert.ok(supa.log.filters.some(([t, c, v]) => t === 'content' && c === 'content_type' && v === 'interactive'));
});

test('site_test: același test redeschis înainte de corectare → aceeași sesiune', async () => {
  const supa = fakeSupa({ content: TEST_BAC, openSession: { id: 'sess-vechi' } });
  const res = await call(supa, { contentId: 'c-42' });
  assert.strictEqual(res.code, 200);
  assert.strictEqual(res.body.siteTest.url, '/exercitiu?id=c-42&medSesId=sess-vechi');
  assert.strictEqual(supa.log.inserts.length, 0, 'nu se dublează sesiunea');
  assert.ok(supa.log.filters.some(([t, c, v]) => t === 'ai_meditatii_sessions' && c === 'payload->>contentId' && v === 'c-42'));
});

test('site_test: material inexistent sau PDF → 404; fără contentId → 400', async () => {
  const pdf = { ...TEST_BAC, content_type: 'pdf' };
  assert.strictEqual((await call(fakeSupa({ content: pdf }), { contentId: 'c-42' })).code, 404);
  assert.strictEqual((await call(fakeSupa({ content: null }), { contentId: 'c-1' })).code, 404);
  assert.strictEqual((await call(fakeSupa({ content: TEST_BAC }), {})).code, 400);
});

test('site_test: fără profil de meditații → 400; fără abonament → 402', async () => {
  assert.strictEqual((await call(fakeSupa({ content: TEST_BAC, medProfile: null }), { contentId: 'c-42' })).code, 400);
  const r = await call(fakeSupa({ content: TEST_BAC }), { contentId: 'c-42' }, { id: 'u1', subscription_status: null, is_admin: false });
  assert.strictEqual(r.code, 402);
});

// ─── clientul: lista are și interactivele ─────────────────────────────────
let libPromise = null;
const lib = () => (libPromise ||= import('../src/lib/siteTests.js').catch(() => null)); // Node vechi → skip

test('levelOf: nivelul elevului decide categoria (și profilul, la BAC)', async (t) => {
  const m = await lib(); if (!m) return t.skip('ESM indisponibil');
  assert.deepStrictEqual(m.levelOf({ examTarget: 'evaluare-nationala', grade: 8 }), { cat: 'evaluare-nationala', prof: null, label: 'Evaluarea Națională' });
  assert.deepStrictEqual(m.levelOf({ examTarget: 'bac-stiinte', grade: 12 }), { cat: 'bacalaureat', prof: 'stiinte-naturii', label: 'BAC Științele Naturii' });
  assert.strictEqual(m.levelOf({ grade: 6 }).cat, 'clasa-6');
  assert.strictEqual(m.levelOf(null, 'clasa-7').label, 'clasa a 7-a');   // rezervă: contextul paginii
  assert.strictEqual(m.levelOf(null, null), null);
});

test('sortInteractive: doar ce arată site-ul, întâi testele interactive', async (t) => {
  const m = await lib(); if (!m) return t.skip('ESM indisponibil');
  const rows = [
    { id: 'cap', subcategory: 'capitole' },
    { id: 'var', subcategory: 'variante' },              // rubrică doar-PDF → nu apare pe site
    { id: 'ex', subcategory: 'exercitii-subiecte' },
    { id: 't1', subcategory: 'teste-interactive' },
    { id: 't2', subcategory: 'teste-interactive' },
    { id: 'fara', subcategory: null },                   // fără rubrică → nu apare pe site
  ];
  assert.deepStrictEqual(m.sortInteractive(rows, 'evaluare-nationala').map((r) => r.id), ['t1', 't2', 'ex', 'cap']);
  // BAC: „exercitii" (nu „exercitii-subiecte")
  assert.deepStrictEqual(m.sortInteractive([{ id: 'a', subcategory: 'exercitii' }, { id: 'b', subcategory: 'teste-interactive' }], 'bacalaureat').map((r) => r.id), ['b', 'a']);
  // la clase nu există rubrici: toate interactivele, în ordinea site-ului
  assert.deepStrictEqual(m.sortInteractive([{ id: 'x' }, { id: 'y' }], 'clasa-7').map((r) => r.id), ['x', 'y']);
});

test('foldRo: căutarea merge și fără diacritice', async (t) => {
  const m = await lib(); if (!m) return t.skip('ESM indisponibil');
  assert.ok(m.foldRo('Simulare Județeană — Științe').includes(m.foldRo('judeteana')));
  assert.ok(m.foldRo('Funcții și ecuații').includes('functii si ecuatii'));
  assert.strictEqual(m.foldRo(null), '');
});

test('lista „Teste din site" aduce interactive + PDF și deschide interactivele prin site_test', () => {
  const src = read('src/components/SitePicker.jsx');
  assert.match(src, /ofType\('interactive'\)/, 'interogarea pentru testele interactive');
  assert.match(src, /ofType\('pdf'\)/, 'PDF-urile rămân');
  assert.match(src, /subcategory\.eq\.capitole/, 'la BAC, „Capitole" e comună tuturor profilurilor');
  assert.match(src, /sortInteractive\(rInter\.data, cat\)/, 'doar ce arată și site-ul');
  assert.match(src, /!== 'bareme'/, 'baremele nu se dau ca test');
  assert.match(src, /action: 'site_test'/);
  assert.match(src, /\/exercitiu\?id=\$\{r\.id\}/);
  // chatul (pachetul principal) încarcă lista LENEȘ, la prima deschidere
  const chat = read('src/components/AITutor.jsx');
  assert.match(chat, /lazy\(\(\) => import\('\.\/SitePicker'\)\)/);
  assert.doesNotMatch(chat, /from '\.\/SitePicker'/);
  assert.match(chat, /sitePicker: \(tab\) => setSitePick\(\(cur\) => \(cur && !tab \? cur : \{ tab: tab \|\| null \}\)\)/, 'comanda de la tablă doar DESCHIDE lista');
  const pag = read('src/pages/Meditatii.jsx');
  assert.match(pag, /chatCmd\.current\?\.sitePicker\?\.\(\)/);
  assert.doesNotMatch(pag, /Teste PDF din biblioteca site-ului, corectate după barem'/);
});
