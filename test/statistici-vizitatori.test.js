// =====================================================================
// test/statistici-vizitatori.test.js — Admin → 🤖 Unelte AI (fostul „AI Tutor") →
// „📊 Statistici de utilizare" → TOȚI vizitatorii, pe pagini (18 nov. 2026):
//   „fă să văd mai mulți vizitatori care intră pe site, puși pe pagini, în admin la AI
//    Tutor la statistici de utilizare la utilizatori care revin cel mai des. Pune mai
//    mulți decât 25, pune-i pe toți care au accesat în ultimele x zile"
//   „Schimbă în Admin numele AI tutor în Unelte AI"
//
// supabase/statistici_vizitatori.sql (admin_vizitatori), api/admin-stats.js →
// action 'vizitatori', src/components/AdminStatistici.jsx → ListaVizitatori, Admin.jsx.
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('Admin: fila se numește „Unelte AI" (fostul „AI Tutor")', () => {
  const a = read('src/pages/Admin.jsx');
  assert.match(a, /\{ id: 'ai',\s+icon: '🤖', label: 'Unelte AI' \}/);
  assert.doesNotMatch(a, /label: 'AI Tutor'/);
});

test('SQL: admin_vizitatori — toți din perioadă, pe pagini; cu cont / fără cont / toți; doar serverul o cheamă', () => {
  const sql = read('supabase/statistici_vizitatori.sql');
  assert.match(sql, /create or replace function public\.admin_vizitatori\(\s*p_zile\s+integer default 30,\s*p_ordine text\s+default 'zile',\s*p_tip\s+text\s+default 'cont',\s*p_limita integer default 25,\s*p_de_la\s+integer default 0\s*\)/);
  assert.match(sql, /security definer\nset search_path = public/);
  assert.match(sql, /v_lim\s+integer := greatest\(1, least\(coalesce\(p_limita, 25\), 100\)\);/, 'cel mult 100 pe pagină');
  assert.match(sql, /\(select count\(\*\) from g\)/, 'totalul perioadei, pentru paginare');
  assert.match(sql, /where k <= 6/, 'paginile văzute cel mai des (primele 6)');
  assert.match(sql, /\(user_id is not null or visitor is not null\)/, 'vizitatorii fără id (fără acordul pentru cookie-uri) nu apar');
  assert.match(sql, /revoke all on function public\.admin_vizitatori\(integer, text, text, integer, integer\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.admin_vizitatori\(integer, text, text, integer, integer\) to service_role;/);
  assert.match(sql, /create index if not exists idx_page_views_visitor_time on public\.page_views\(visitor, created_at desc\)/);
  assert.doesNotMatch(sql, /create table/i, 'fără tabele noi');
});

test('api/admin-stats „vizitatori": pagina (25 pe pagină), filtrele curățate, funcția lipsă → setup: false', async () => {
  const { vizitatori, PE_PAGINA } = require('../api/admin-stats');
  assert.strictEqual(PE_PAGINA, 25);
  const apeluri = [];
  const supa = { rpc: async (fn, args) => { apeluri.push([fn, args]); return { data: { total: 52, randuri: [{ id: 'u', loc: 26 }] }, error: null }; } };
  const r = await vizitatori(supa, { zile: 90, ordine: 'accesari', tip: 'anonimi', pagina: 2 });
  assert.deepStrictEqual(apeluri[0], ['admin_vizitatori', { p_zile: 90, p_ordine: 'accesari', p_tip: 'anonimi', p_limita: 25, p_de_la: 25 }]);
  assert.deepStrictEqual([r.ok, r.total, r.pagini, r.pagina, r.randuri.length], [true, 52, 3, 2, 1]);
  await vizitatori(supa, { zile: 13, ordine: 'x', tip: 'y', pagina: -4 });
  assert.deepStrictEqual(apeluri[1][1], { p_zile: 30, p_ordine: 'zile', p_tip: 'cont', p_limita: 25, p_de_la: 0 });
  const lipsa = await vizitatori({ rpc: async () => ({ data: null, error: { message: 'Could not find the function public.admin_vizitatori(p_de_la, p_limita, p_ordine, p_tip, p_zile) in the schema cache' } }) }, {});
  assert.deepStrictEqual([lipsa.ok, lipsa.setup], [false, false]);
  const src = read('api/admin-stats.js');
  assert.match(src, /if \(req\.body && req\.body\.action === 'vizitatori'\) \{\n\s+return res\.status\(200\)\.json\(await vizitatori\(supabase, req\.body\)\);/);
  assert.ok(src.indexOf('await requireAdmin(supabase, userId);') < src.indexOf("req.body.action === 'vizitatori'"), 'doar adminul');
});

test('panoul: toți vizitatorii perioadei, câte 25 pe pagină, cu ce au văzut; fără script — primii 25, ca înainte', () => {
  const ui = read('src/components/AdminStatistici.jsx');
  assert.match(ui, /export function ListaVizitatori\(\{ zile, s, seg, reincarcat = null \}\)/);
  assert.match(ui, /body: JSON\.stringify\(\{ action: 'vizitatori', zile, ordine, tip, pagina \}\)/);
  assert.match(ui, /\{ id: 'cont', label: '👤 Cu cont' \},\n\s+\{ id: 'anonimi', label: '🕶️ Fără cont' \},\n\s+\{ id: 'toti', label: '👥 Toți' \},/);
  assert.match(ui, /🔁 Revin cel mai des \(zile\)/);
  assert.match(ui, /👣 Cele mai multe accesări \(pagini\)/);
  assert.match(ui, /pageWindow\(pagina, pagini\)\.map/, 'bara de pagini');
  assert.match(ui, /aria-current=\{p === pagina \? 'page' : undefined\}/);
  assert.match(ui, /Ce a văzut cel mai des/);
  assert.match(ui, /\{numePagina\(pg\.path\)\} <b style=\{\{ color: 'var\(--navy\)' \}\}>×\{fmt\(pg\.n\)\}<\/b>/);
  assert.match(ui, /🕶️ Vizitator fără cont/);
  // filtrele noi pornesc de la prima pagină, fără o cerere în plus
  assert.match(ui, /const pagina = pag\.cheie === cheie \? pag\.p : 1;/);
  // fără script: lista veche (primii 25 cu cont) + ce e de rulat
  assert.match(ui, /const faraScript = d && d\.ok === false && d\.setup === false;/);
  assert.match(ui, /rulează <code>supabase\/statistici_vizitatori\.sql<\/code>/);
  assert.match(ui, /<ListaVizitatori zile=\{s\.zile\} s=\{s\} seg=\{seg\} reincarcat=\{s\.incarcatLa\} \/>/);
  assert.doesNotMatch(ui, /Arată toți cei \$\{utilizatori\.length\}/, 'nu mai e limita de 25');
});
