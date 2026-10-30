// =====================================================================
// test/statistici-utilizare.test.js — cererea din 30 octombrie 2026 (4):
//   „în ai tutor fă să apară o statistică a celor mai vizitate pagini, a
//    celor mai folosite teste, a celor mai multe accesări, o listă a
//    utilizatorilor care revin cel mai des, și alte informații care crezi că
//    sunt importante."
//
//   · vizitele: src/lib/vizite.js → api/vizita.js (api/_lib/vizite.js curăță
//     tot ce vine din browser) → page_views (supabase/statistici_vizite.sql);
//   · panoul: api/admin-stats.js { action: 'site' } → admin_statistici(zile)
//     → src/components/AdminStatistici.jsx, primul în Admin → 🤖 AI Tutor.
// Funcția SQL a fost rulată pe un PostgreSQL 16 local (cu tabelele Supabase
// simulate) la scriere; aici se verifică fișierul, serverul și interfața.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const vizite = require('../api/_lib/vizite');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const http = require('../api/_lib/http');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const stat = () => import(path.join(__dirname, '..', 'src', 'lib', 'statistici.js'));
const U = '44444444-4444-4444-4444-444444444444';
const C = 'aaaaaaaa-0000-4000-8000-000000000001';

// ─── Ce vine din browser se curăță ──────────────────────────────────────────
test('ruta: fără ?…/#…, fără / la coadă, cu diacritice; nimic ciudat; adminul nu se numără', () => {
  assert.strictEqual(vizite.curataRuta('/clase/clasa-7?x=1#y'), '/clase/clasa-7');
  assert.strictEqual(vizite.curataRuta('/'), '/');
  assert.strictEqual(vizite.curataRuta('/arena/'), '/arena');
  assert.strictEqual(vizite.curataRuta('//arena//harta'), '/arena/harta');
  assert.strictEqual(vizite.curataRuta('/rezolvari/ecua%C8%9Bii-de-gradul-i'), '/rezolvari/ecuații-de-gradul-i');
  assert.strictEqual(vizite.curataRuta('arena'), null, 'trebuie să înceapă cu /');
  assert.strictEqual(vizite.curataRuta('/<script>'), null);
  assert.strictEqual(vizite.curataRuta('/a b'), null);
  assert.strictEqual(vizite.curataRuta('/' + 'x'.repeat(200)), null);
  assert.strictEqual(vizite.curataRuta('/admin'), null);
  assert.strictEqual(vizite.curataRuta('/admin/x'), null);
  assert.strictEqual(vizite.curataRuta(null), null);
});

test('sursa = doar domeniul; vizita = rută + UUID + dispozitiv valid; propriul site nu e „sursă"', () => {
  assert.strictEqual(vizite.domeniu('https://www.google.com/search?q=mate'), 'google.com');
  assert.strictEqual(vizite.domeniu('m.facebook.com'), 'facebook.com');
  assert.strictEqual(vizite.domeniu('javascript:alert(1)'), null);
  assert.strictEqual(vizite.domeniu('localhost'), null);
  assert.strictEqual(vizite.domeniu(''), null);
  const v = vizite.curataVizita({ path: '/pdf-viewer?id=x', contentId: C.toUpperCase(), visitor: 'abcd-1234-efgh', device: 'telefon', referrer: 'https://www.google.ro/' });
  assert.deepStrictEqual(v, { path: '/pdf-viewer', content_id: C, visitor: 'abcd-1234-efgh', device: 'telefon', referrer: 'google.ro' });
  const rau = vizite.curataVizita({ path: '/arena', contentId: '1 OR 1=1', visitor: '<x>', device: 'frigider', referrer: 'https://examenmate.com/x' }, { siteHost: 'examenmate.com' });
  assert.deepStrictEqual(rau, { path: '/arena', content_id: null, visitor: null, device: null, referrer: null });
  assert.strictEqual(vizite.curataVizita({ path: '/admin' }), null);
  assert.strictEqual(vizite.curataVizita(null), null);
});

test('plafonul per IP: o pagină în buclă nu umple tabela; fereastra se reia', () => {
  const permis = vizite.limitator({ max: 3, windowMs: 1000 });
  assert.deepStrictEqual([1, 2, 3, 4].map(() => permis('1.2.3.4', 0)), [true, true, true, false]);
  assert.strictEqual(permis('5.6.7.8', 0), true, 'alt IP are fereastra lui');
  assert.strictEqual(permis('1.2.3.4', 1500), true, 'după un minut, din nou');
});

// ─── api/vizita.js ───────────────────────────────────────────────────────────
test('api/vizita: scrie vizita (cu utilizatorul din token, fără id anonim); răspunde mereu 204', async () => {
  const supa = createFakeSupabase({ page_views: [] });
  const saved = { admin: http.admin, authUser: http.authUser };
  // api/vizita.js ia funcțiile din modulul http la încărcare → îl reîncărcăm cu stuburile puse
  http.admin = () => supa;
  http.authUser = async (req) => { if (req.headers.authorization === 'Bearer ok') return U; throw new Error('nu'); };
  delete require.cache[require.resolve('../api/vizita')];
  try {
    const handler = require('../api/vizita');
    const r1 = fakeRes();
    await handler({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.1' }, body: { path: '/clase/clasa-6', device: 'calculator', visitor: 'vizitator-anonim-1', referrer: 'https://google.com' } }, r1);
    assert.strictEqual(r1.statusCode, 204);
    const r2 = fakeRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer ok', 'x-forwarded-for': '9.9.9.2' }, body: JSON.stringify({ path: '/exercitiu', contentId: C, visitor: 'vizitator-anonim-1', device: 'telefon' }) }, r2);
    assert.strictEqual(r2.statusCode, 204);
    // sesiune stricată → se numără ca vizitator, nu cade
    const r3 = fakeRes();
    await handler({ method: 'POST', headers: { authorization: 'Bearer expirat' }, body: { path: '/arena' } }, r3);
    assert.strictEqual(r3.statusCode, 204);
    // adminul / gunoiul nu se scriu
    for (const body of [{ path: '/admin' }, { path: 'nimic' }, {}]) {
      const r = fakeRes();
      await handler({ method: 'POST', headers: {}, body }, r);
      assert.strictEqual(r.statusCode, 204);
    }
    const rows = supa.db.tables.page_views;
    assert.strictEqual(rows.length, 3);
    assert.deepStrictEqual(rows.map((r) => r.path), ['/clase/clasa-6', '/exercitiu', '/arena']);
    assert.strictEqual(rows[0].user_id, null);
    assert.strictEqual(rows[0].visitor, 'vizitator-anonim-1');
    assert.strictEqual(rows[0].referrer, 'google.com');
    assert.strictEqual(rows[1].user_id, U);
    assert.strictEqual(rows[1].visitor, null, 'cu cont, id-ul anonim nu se păstrează');
    assert.strictEqual(rows[1].content_id, C);
    assert.strictEqual(rows[2].user_id, null);
    // tabela lipsă (migrarea nerulată) → tot 204, fără excepții
    supa.db.failTables.add('page_views');
    const r4 = fakeRes();
    await handler({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.3' }, body: { path: '/' } }, r4);
    assert.strictEqual(r4.statusCode, 204);
  } finally {
    Object.assign(http, saved);
    delete require.cache[require.resolve('../api/vizita')];
  }
});

// ─── api/admin-stats.js { action: 'site' } ──────────────────────────────────
test('api/admin-stats „site": doar admin; perioada 7 / 30 / 90; funcția lipsă → mesajul cu scriptul', async () => {
  const { statisticiSite } = require('../api/admin-stats');
  const calls = [];
  const supa = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { zile: args.p_zile, vizite: { vizualizari: 12 }, pagini: [{ path: '/', vizualizari: 5 }] }, error: null }; } };
  const r = await statisticiSite(supa, 7);
  assert.deepStrictEqual(calls[0], { name: 'admin_statistici', args: { p_zile: 7 } });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.vizite.vizualizari, 12);
  await statisticiSite(supa, 13);
  assert.strictEqual(calls[1].args.p_zile, 30, 'altă perioadă → 30 de zile');
  const lipsa = await statisticiSite({ rpc: async () => ({ data: null, error: { message: 'Could not find the function public.admin_statistici(p_zile) in the schema cache' } }) }, 30);
  assert.strictEqual(lipsa.ok, false);
  assert.strictEqual(lipsa.setup, false);

  const src = read('api/admin-stats.js');
  assert.match(src, /await requireAdmin\(supabase, userId\);\s*\n\s*if \(req\.body && req\.body\.action === 'site'\)/, 'verificarea de admin vine înainte');
});

// ─── SQL ─────────────────────────────────────────────────────────────────────
test('migrarea: page_views cu RLS + GRANT (authenticated, service_role; fără anon); funcția doar pentru server', () => {
  const sql = read('supabase/statistici_vizite.sql');
  assert.match(sql, /create table if not exists public\.page_views/);
  const i = sql.indexOf('create table if not exists public.page_views');
  const bloc = sql.slice(i, sql.indexOf('create index', i));
  assert.match(bloc, /alter table public\.page_views enable row level security;/);
  assert.match(bloc, /grant select, insert, update, delete on public\.page_views to authenticated;/);
  assert.match(bloc, /grant select, insert, update, delete on public\.page_views to service_role;/);
  assert.doesNotMatch(sql, /to anon\b/, 'vizitele nu sunt date publice');
  assert.match(sql, /create policy page_views_service on public\.page_views for all to service_role/);
  assert.match(sql, /user_id\s+uuid references auth\.users\(id\) on delete cascade/, 'se șterg odată cu contul');
  assert.match(sql, /create or replace function public\.admin_statistici\(p_zile integer default 30\)/);
  assert.match(sql, /security definer\s+set search_path = public/);
  assert.match(sql, /revoke all on function public\.admin_statistici\(integer\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.admin_statistici\(integer\) to service_role;/);
  // fiecare parte a panoului: vizite, teste, AI, conturi, Arena — cu tabelele lipsă tolerate
  for (const k of ["'pagini'", "'materiale'", "'revin'", "'accesari'", "'teste'", "'ai'", "'conturi'", "'retentie'", "'ore'", "'dispozitive'", "'surse'", "'misiuni'"]) assert.ok(sql.includes(k), k);
  assert.match(sql, /exception when undefined_table or undefined_column then/);
  // text[] || 'x' e interpretat ca literal de tablou (prins la rularea pe PostgreSQL 16) → array_append
  assert.doesNotMatch(sql, /v_lipsa := v_lipsa \|\|/);
  assert.match(sql, /v_lipsa := array_append\(v_lipsa, 'daily_exercises'\);/);
  // igiena: 180 de zile, în cronul zilnic
  assert.match(read('api/account-cleanup.js'), /from\('page_views'\)\s*\.select\('id'\)\.lt\('created_at', cutoff\)/);
});

// ─── Interfața ──────────────────────────────────────────────────────────────
test('numele prietenoase și zilele fără vizite', async () => {
  const S = await stat();
  assert.strictEqual(S.numePagina('/'), 'Acasă');
  assert.strictEqual(S.numePagina('/clase/clasa-12'), 'Clasa a XII-a');
  assert.strictEqual(S.numePagina('/bacalaureat/mate-info'), 'Bacalaureat · mate-info');
  assert.strictEqual(S.numePagina('/rezolvari/ecuatii-de-gradul-i'), 'Rezolvare · ecuatii de gradul i');
  assert.strictEqual(S.numePagina('/ceva-nou'), '/ceva-nou');
  assert.strictEqual(S.numeFunctieAI('ai-chat'), '💬 Chat cu Profesorul Virtual');
  assert.strictEqual(S.numeFunctieAI('voce_refa'), '🔊 Vocea profesorului (lecții live)');
  assert.match(S.numeFunctieAI('seo-cron-monthly'), /Unelte de admin/);
  const z = S.zileComplete([{ zi: '2026-10-29', vizualizari: 3, utilizatori: 1 }], '2026-10-26T10:00:00Z', '2026-10-30T10:00:00Z');
  assert.deepStrictEqual(z.map((d) => d.zi), ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
  assert.deepStrictEqual(z.map((d) => d.vizualizari), [0, 0, 0, 3, 0]);
});

test('panoul „📊 Statistici de utilizare" e primul în Admin → 🤖 AI Tutor, cu tot ce s-a cerut', () => {
  const panel = read('src/components/AIAdminPanel.jsx');
  assert.match(panel, /import AdminStatistici from '\.\/AdminStatistici';/);
  assert.ok(panel.indexOf('<AdminStatistici box={box} />') < panel.indexOf('storageKey="kb"'), 'înaintea bazei de cunoștințe');
  const ui = read('src/components/AdminStatistici.jsx');
  for (const t of ['Cele mai vizitate pagini', 'Cele mai accesate materiale', 'Cele mai folosite teste', 'Utilizatorii care revin cel mai des',
    'Cele mai multe accesări', 'Funcțiile AI cele mai folosite', 'Orele de vârf', 'Dispozitive', 'De unde vin', 'Revin (retenție)', 'Conturi noi', 'Pagini văzute pe zi']) {
    assert.ok(ui.includes(t), t);
  }
  assert.match(ui, /body: JSON\.stringify\(\{ action: 'site', zile: z \}\)/);
  assert.match(ui, /Rulează <code>supabase\/statistici_vizite\.sql<\/code>/);
  // graficul: coloane ≤ 24 px, ținta de hover = toată banda, detalii și la tastatură, tabelul zilelor
  assert.match(ui, /Math\.min\(24, bandW - 2\)/);
  assert.match(ui, /onFocus=\{\(\) => setActiv\(i\)\}/);
  assert.match(ui, /Vezi tabelul zilelor/);
});

test('vizitele se trimit la fiecare rută (fără admini), cu id anonim doar cu acordul pentru cookie-uri; politicile spun asta', () => {
  const app = read('src/App.jsx');
  assert.match(app, /function VizitaTracker\(\)/);
  assert.match(app, /trimiteVizita\(\{ pathname: location\.pathname, search: location\.search, isAdmin \}\)/);
  assert.match(app, /<VizitaTracker \/>/);
  const lib = read('src/lib/vizite.js');
  assert.match(lib, /if \(!hasConsent\(\)\) return null;/);
  assert.match(lib, /if \(!pathname \|\| isAdmin\) return;/);
  assert.match(lib, /fetch\('\/api\/vizita', \{ method: 'POST', headers: await authHeaders\(\), body: JSON\.stringify\(body\), keepalive: true \}\)/);
  assert.match(lib, /if \(pathname !== '\/exercitiu' && pathname !== '\/pdf-viewer'\) return null;/);
  assert.match(read('src/pages/PoliticaConfidentialitate.jsx'), /Statistici interne de vizitare/);
  assert.match(read('src/pages/PoliticaCookies.jsx'), /name: 'em_vid'/);
});
