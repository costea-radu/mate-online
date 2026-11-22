// =====================================================================
// test/plan-focus.test.js — „Ce lucrezi acum?" pe harta pregătirii, „▶ Începe" pornește
// amintirea, elevul ajunge la „Pregătește-mă" după autentificare (15 nov. 2026, seara):
//   „1. când se conectează un elev, fă să ajungă în home la pregătește-mă
//    2. fă să poată alege în hartă să facă direct teste interactive sau pdf. la premium,
//       fă să poată alege orice pas. testele premium să rămână premium și în pași
//    3. fă notificările pornite când se apasă «începe». scoate pasul aici la început.
//       el se vede în hartă"
//
// api/_lib/planPregatire.js (calculeaza cu `deLa`, focusul din prep_plan, alegeFocus),
// api/_lib/pregatireZilnica.js (alegeFocus → testul zilei pe pasul nou), api/gamificare.js
// ('plan_focus'), src/pages/PregatesteMa.jsx, src/components/MisiuneZilnica.jsx,
// src/lib/dupaLogin.js, src/pages/Login.jsx, src/App.jsx.
// Rulare: npm test
// =====================================================================
delete process.env.PLAN_PRAG;
delete process.env.PLAN_PRAG_PDF;
delete process.env.PLAN_INCERCARI;
delete process.env.PLAN_PDF_CAPITOLE;
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const xp = require('../api/_lib/xp');
const PL = require('../api/_lib/planPregatire');
const P = require('../api/_lib/pregatireZilnica');
const { createFakeSupabase } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const U = '11111111-1111-4111-8111-111111111111';
const AZI = xp.dayKey();
const PREMIUM = { id: U, subscription_status: 'active' };
const GRATUIT = { id: U, subscription_status: null };

let ord = 0;
const c = (o) => ({ is_free: true, profile: null, subcategory: null, file_url: `x/${o.id}.pdf`, sort_order: ++ord, created_at: '2026-10-01T10:00:00Z', ...o });
const EN = [
  c({ id: 'cap-1', title: 'Numere naturale — operații', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'interactive' }),
  c({ id: 'cap-2', title: 'Fracții — operații', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'interactive' }),
  c({ id: 'cap-3', title: 'Numere reale — radicali', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'interactive' }),
  c({ id: 'sub-1', title: 'Subiectul I, ex. 1 — interactiv', category: 'evaluare-nationala', subcategory: 'exercitii-subiecte', content_type: 'interactive' }),
  c({ id: 'test-1', title: 'Test interactiv EN 1', category: 'evaluare-nationala', subcategory: 'teste-interactive', content_type: 'interactive', is_free: false }),
  c({ id: 'test-2', title: 'Test interactiv EN 2', category: 'evaluare-nationala', subcategory: 'teste-interactive', content_type: 'interactive' }),
  c({ id: 'test-3', title: 'Test interactiv EN 3', category: 'evaluare-nationala', subcategory: 'teste-interactive', content_type: 'interactive' }),
  c({ id: 'var-1', title: 'EN 2025 — varianta 1', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf' }),
  c({ id: 'var-2', title: 'EN 2025 — varianta 2', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf' }),
];

function baza({ plan = {}, progress = [], tinta = 'evaluare-nationala', faraColoana = false } = {}) {
  const stats = { user_id: U, total_xp: 0, coins: 0, streak_current: 0, streak_best: 0, freezes: 0, league_tier: 1, prep_exam: tinta };
  if (!faraColoana) stats.prep_plan = plan;
  const supa = createFakeSupabase({
    content: EN.map((r) => ({ ...r })),
    user_stats: [stats],
    profiles: [{ id: U, full_name: 'Ana' }],
    daily_tests: [], progress: progress.map((r) => ({ user_id: U, ...r })), xp_events: [], user_badges: [], arena_feed: [],
    ai_pdf_text: [], exam_bot_index: [],   // fără informații despre bareme → la examen, toate subiectele PDF intră
  });
  supa.db.failTables.add('ai_pdf_text');
  supa.db.failTables.add('exam_bot_index');
  supa.db.unique = { daily_tests: [['user_id', 'day']], user_badges: [['user_id', 'badge_id']], arena_feed: [['dedupe_key']] };
  return supa;
}
const stats = (supa) => supa.db.tables.user_stats.find((x) => x.user_id === U);
const randAzi = (supa) => supa.db.tables.daily_tests.find((r) => r.user_id === U && r.day === AZI);
const nod = (h, id) => h.noduri.find((n) => n.id === id);

// ═══════════════════════════ 1) calculul: focusul, pașii deschiși ═══════════════════════════

test('calculeaza: pasul curent pornește de la `deLa`; dacă după el totul e gata, de la început', () => {
  const noduri = PL.construiesteNoduri(EN, PL.etape({ tip: 'examen', category: 'evaluare-nationala', profile: null }), { cuBarem: null }).filter((n) => n.harta === 'interactiv');
  const k = (id) => noduri.findIndex((n) => n.id === id);
  let r = PL.calculeaza(noduri, new Map(), { premium: true });
  assert.strictEqual(noduri[r.curent].id, 'cap-1');
  r = PL.calculeaza(noduri, new Map(), { premium: true, deLa: k('test-1') });
  assert.strictEqual(noduri[r.curent].id, 'test-1');
  // fără abonament: testul Premium rămâne ⭐ și nu oprește — pasul curent e primul test gratuit
  r = PL.calculeaza(noduri, new Map(), { premium: false, deLa: k('test-1') });
  assert.deepStrictEqual([noduri[r.curent].id, r.noduri[k('test-1')].accesibil], ['test-2', false]);
  // toți pașii de la focus încolo sunt trecuți → înapoi la primul netrecut
  const prog = new Map(['test-2', 'test-3'].map((id) => [id, { score: 90, max_score: 100, attempts: 1 }]));
  r = PL.calculeaza(noduri, prog, { premium: false, deLa: k('test-2') });
  assert.strictEqual(noduri[r.curent].id, 'cap-1');
});

test('cu Premium, orice pas e deschis; fără abonament, pașii de după pasul curent rămân încuiați, iar cei Premium ⭐', () => {
  const noduri = PL.construiesteNoduri(EN, PL.etape({ tip: 'examen', category: 'evaluare-nationala', profile: null }), { cuBarem: null }).filter((n) => n.harta === 'interactiv');
  const prem = PL.calculeaza(noduri, new Map(), { premium: true });
  assert.ok(prem.noduri.every((n) => n.deschis), 'toți deschiși');
  const grat = PL.calculeaza(noduri, new Map(), { premium: false });
  assert.deepStrictEqual(grat.noduri.map((n) => [n.id, n.deschis, n.accesibil]), [
    ['cap-1', true, true], ['cap-2', false, true], ['cap-3', false, true], ['sub-1', false, true],
    ['test-1', false, false], ['test-2', false, true], ['test-3', false, true],
  ]);
  assert.deepStrictEqual(PL.focusValid({ harta: 'pdf', id: '  x ', etapa: '' }), { harta: 'pdf', id: 'x', etapa: null });
  assert.strictEqual(PL.focusValid({ harta: 'altceva' }), null);
});

// ═══════════════════════════ 2) „Ce lucrezi acum?" — cu baza de date ═══════════════════════════

test('fără abonament: „📝 Teste interactive" → pasul de azi e primul test gratuit; harta PDF și pașii anume — doar cu Premium', async () => {
  const supa = baza();
  await P.stare(supa, U, GRATUIT);                      // testul zilei de azi: primul pas (cap-1)
  assert.strictEqual(randAzi(supa).content_id, 'cap-1');
  let r = await P.alegeFocus(supa, U, GRATUIT, { harta: 'interactiv', etapa: 'teste' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(stats(supa).prep_plan.focus, { harta: 'interactiv', id: 'test-1', etapa: 'teste' });
  assert.deepStrictEqual([r.pregatire.plan.pas.id, r.pregatire.plan.focus.harta, r.pregatire.plan.focus.activ], ['test-2', 'interactiv', true]);
  assert.strictEqual(randAzi(supa).content_id, 'test-2', 'testul zilei, încă nelucrat, trece pe pasul nou');
  assert.strictEqual(nod(r.pregatire.plan.interactiv, 'test-1').accesibil, false, 'testul Premium rămâne ⭐');
  r = await P.alegeFocus(supa, U, GRATUIT, { harta: 'pdf' });
  assert.match(r.error, /Premium/);
  r = await P.alegeFocus(supa, U, GRATUIT, { harta: 'interactiv', id: 'cap-3' });
  assert.match(r.error, /Premium poți porni de la orice pas/);
  r = await P.alegeFocus(supa, U, GRATUIT, { harta: null });   // înapoi în ordine
  assert.deepStrictEqual([r.ok, stats(supa).prep_plan.focus, r.pregatire.plan.pas.id, r.pregatire.plan.focus], [true, undefined, 'cap-1', null]);
});

test('cu Premium: „📄 Subiecte PDF" → pasul de azi din harta PDF; „📍 Pornește de aici" pe orice pas; ținta nouă șterge alegerea', async () => {
  const supa = baza();
  let r = await P.alegeFocus(supa, U, PREMIUM, { harta: 'pdf' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual([r.pregatire.plan.pas.id, r.pregatire.plan.pas.harta], ['var-1', 'pdf']);
  r = await P.alegeFocus(supa, U, PREMIUM, { harta: 'interactiv', id: 'cap-3' });
  assert.deepStrictEqual([r.pregatire.plan.pas.id, r.pregatire.plan.focus.id], ['cap-3', 'cap-3']);
  assert.ok(nod(r.pregatire.plan.interactiv, 'test-3').deschis, 'cu Premium, orice pas e deschis');
  r = await P.alegeFocus(supa, U, PREMIUM, { harta: 'interactiv', id: 'nu-exista' });
  assert.match(r.error, /nu mai e în planul tău/);
  // pasul ales trecut → harta merge mai departe de acolo
  supa.db.tables.progress.push({ user_id: U, content_id: 'cap-3', score: 95, max_score: 100, attempts: 1, completed_at: `${AZI}T10:00:00Z` });
  let s = await P.stare(supa, U, PREMIUM);
  assert.strictEqual(s.plan.pas.id, 'sub-1');
  // altă țintă → alegerea veche nu mai contează
  stats(supa).prep_exam = 'clasa-6';
  s = await P.stare(supa, U, PREMIUM);
  assert.strictEqual(s.plan.focus, null);
  assert.ok(!stats(supa).prep_plan.focus, 'șters din prep_plan');
  // fără coloana prep_plan: alegerea nu se poate salva
  const fara = baza({ faraColoana: true });
  r = await P.alegeFocus(fara, U, PREMIUM, { harta: 'pdf' });
  assert.match(r.error, /plan_pregatire\.sql/);
});

test('fără abonament, un focus vechi pe harta PDF (după ce a expirat Premium-ul) nu mai contează', async () => {
  const supa = baza({ plan: { v: 1, start: AZI, tinta: 'evaluare-nationala', sarite: [], trecute: [], focus: { harta: 'pdf', id: null, etapa: null } } });
  const s = await P.stare(supa, U, GRATUIT);
  assert.deepStrictEqual([s.plan.pas.id, s.plan.focus], ['cap-1', null]);
});

test('api/gamificare.js: „plan_focus"', () => {
  const g = read('api/gamificare.js');
  assert.match(g, /if \(action === 'plan_focus'\) \{/);
  assert.match(g, /pregatire\.alegeFocus\(supa, userId, profile, \{/);
});

// ═══════════════════════════ 3) pagina ═══════════════════════════

test('„Pasul de azi": fără titlul / capitolul pasului (sunt pe hartă) — „▶ Începe" + „📍 Vezi pasul pe hartă"; „Începe" pornește amintirea', () => {
  const pg = read('src/pages/PregatesteMa.jsx');
  assert.ok(!/pz-capazi|capPas/.test(pg), 'capitolul pasului nu mai e în card');
  assert.ok(!pg.includes("fontSize: '1.1rem', margin: '8px 0 4px' }}>{pas.titlu}"), 'nici titlul pasului');
  assert.match(pg, /<ActiuniPas n=\{pas\} esteCurent plan=\{plan\} busy=\{busy\} mare onDeschide=\{incepe\}/);
  assert.match(pg, /📍 Vezi pasul pe hartă/);
  assert.match(pg, /pornesteAmintirea\(\{ notif, texte: TEXTE_AMINTIRE \}\)/);
  assert.match(pg, /if \(notif && notif\.setup !== false && !notif\.on && !notif\.ales\) \{/, 'o singură dată, dacă elevul n-a ales');
  assert.match(pg, /ascundeIntrebarea=\{!!pas \|\| !!t\}/);
  // harta: „Ce lucrezi acum?" și „📍 Pornește de aici" (Premium)
  assert.match(pg, /<CeLucrezi plan=\{plan\} laClasa=\{laClasa\} busy=\{busy\} onAlege=\{focus\} \/>/);
  assert.match(pg, /action: 'plan_focus'/);
  assert.match(pg, /onAlege\(\{ harta: 'interactiv', etapa: 'teste' \}\)/);
  assert.match(pg, /onPornesteDeAici=\{\(n\) => focus\(\{ harta: n\.harta, id: n\.id \}\)\}/);
  assert.match(pg, /const poatePorni = !!plan\?\.premium && !esteCurent && n\.accesibil && n\.stare !== 'trecut';/);
  assert.match(pg, /<Link to="\/preturi" className="pz-ce-b stea"/, 'fără abonament, subiectele PDF duc la abonamente');
  const mz = read('src/components/MisiuneZilnica.jsx');
  assert.match(mz, /export async function pornesteAmintirea\(\{ notif, texte = TEXTE_MISIUNE \} = \{\}\) \{/);
  assert.match(mz, /if \(!notif \|\| notif\.setup === false \|\| notif\.on \|\| notif\.ales\) return null;/);
  assert.match(mz, /if \(ascundeIntrebarea && !notif\.on && !notif\.ales && !msg\) return null;/);
});

test('după autentificare, orice cont ajunge în Home (email + parolă direct; Google / Discord prin /profil); onboarding-ul rămâne în /profil', async () => {
  const dl = read('src/lib/dupaLogin.js');
  assert.match(dl, /export const ACASA = '\/';/);
  assert.match(dl, /export const destinatiePentru = \(role\) => \(role \? ACASA : '\/profil'\);/);
  assert.match(dl, /if \(profile\.role && pathname === '\/profil'\) navigate\(ACASA, \{ replace: true \}\);/);
  assert.match(dl, /localStorage\.getItem\('pending_account_type'\) \|\| localStorage\.getItem\('pending_teacher_code'\)/, 'onboarding-ul rămâne în /profil');
  assert.ok(!/pregateste-ma/.test(dl), 'nu mai trimite elevul la „Pregătește-mă"');
  const lg = read('src/pages/Login.jsx');
  assert.match(lg, /navigate\(await destinatieDupaLogin\(data\?\.user\?\.id\)\);/);
  assert.ok(!/navigate\('\/profil'\)/.test(lg));
  assert.strictEqual((lg.match(/marcheazaLogin\(\);/g) || []).length, 2, 'Google și Discord');
  const app = read('src/App.jsx');
  assert.match(app, /<ScrollToTop \/>\n {10}<DupaLogin \/>/);
});

test('subiectele PDF: metoda de rezolvare se alege în vizualizator („✏️ Rezolvă pe PDF" → pe PDF, cu poză, în chat, în foaia de lucru), nu în „Pregătește-mă"', () => {
  const pg = read('src/pages/PregatesteMa.jsx');
  assert.ok(!/MODURI_PDF|Cum trimiți rezolvarea|pz-moduri|urlPas\(n, m\.mod\)|urlPas\(pas, 'pdf'\)/.test(pg), 'fără butoanele metodelor în „Pregătește-mă"');
  // 21 nov. 2026: butonul se cheamă „✏️ Rezolvă" (fostul „✏️ Rezolvă pe PDF")
  assert.match(pg, /alegi în vizualizator, la <b>„✏️ Rezolvă"<\/b>, și poți schimba oricând/);
  const v = read('src/pages/PDFViewer.jsx');
  // metodele stau din 22 nov. 2026 în src/lib/metodeRezolvare.js (împreună cu ordinea lor)
  const mr = read('src/lib/metodeRezolvare.js');
  for (const [id, label] of [['pdf', 'Pe PDF'], ['poza', 'Cu poză'], ['chat', 'În chat'], ['foaie', 'În foaia de lucru']]) {
    assert.ok(mr.includes(`{ id: '${id}', icon: `) && mr.includes(`label: '${label}'`), id);
  }
  assert.match(v, /import \{\s*\n\s*METODE_REZOLVARE, METODA_INTERACTIV, METODA_LIVE, ordineMetode,/);
  // butonul din bară deschide meniul; în testul pe grupă / duel rămâne butonul de dinainte
  assert.match(v, /const solveBtn = \(canSolve \|\| rezolvaFoaie\) && !modTest \? \(/);
  assert.match(v, /onClick=\{deschideMeniuMetode\}/);
  assert.match(v, /role="menuitemradio" aria-checked=\{on\}[^>]*?onClick=\{\(\) => alegeMetoda\(m\.id\)\}/);
  // schimbarea oricând: metoda nouă o închide pe cea veche; scrisul de pe PDF rămâne în ciornă
  const alege = v.slice(v.indexOf('function alegeMetoda(m) {'), v.indexOf('function inchideMetoda() {'));
  assert.match(alege, /if \(solveOn\) \{ solve\.store\.flush\(\); setSolveOn\(false\); \}/);
  assert.match(alege, /if \(tutorOpen && workOpen\) setWork\(false\);/);
  assert.match(alege, /setFormaCeruta\(\{ mod: m, indemn: m === 'poza' \? INDEMN_POZA : INDEMN_CHAT \}\);/);
  assert.match(alege, /scrieMetoda\(m\);/);
  // de pe hartă, fără ?mod=: ultima metodă aleasă
  assert.match(v, /const \[modPlan\] = useState\(\(\) => \(dinPregatire \? \(modParam \|\| citesteMetoda\(\)\) : null\)\);/);
  assert.strictEqual((v.match(/\{meniuMetodeJsx\}/g) || []).length, 2, 'meniul, pe telefon și pe calculator');
});
