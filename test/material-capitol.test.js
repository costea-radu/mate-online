// =====================================================================
// test/material-capitol.test.js — MATERIALUL NOU, LA CAPITOLUL LUI (18 nov. 2026):
//   „Fă ca atunci când se adaugă un PDF sau test interactiv nou, să se adauge la
//    capitolul corespunzător din site. Eu din admin aleg doar clasa sau examenul și
//    profilul."
//
// src/lib/rubricaMaterial.js (rubrica de la EN / BAC după titlu, capitolul),
// api/_lib/contentAdmin.js → planPlasare (după ultimul material al capitolului),
// api/content-admin.js → action 'plaseaza', src/components/ContentAdminTools.jsx
// (ContentMetaFields `auto`, UndeApare), src/pages/Admin.jsx (formularele), vite.config.js.
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const http = require('../api/_lib/http');
const A = require('../api/_lib/contentAdmin');
const CH = require('../api/_lib/capitoleHarta');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let mod = null;
const load = async () => { if (!mod) mod = await import('../src/lib/rubricaMaterial.js'); return mod; };

// ═══════════════════════════ 1) rubrica de la EN / BAC, după titlu ═══════════════════════════

// titluri reale din site, cu rubrica în care stau (nov. 2026)
const REALE = [
  ['evaluare-nationala', 'pdf', 'SUBIECTUL I, EX. 1: Calcule cu numere naturale', '', 'capitole'],
  ['evaluare-nationala', 'pdf', 'SUBIECTUL I, EX. 2: Divizibilitate + Teorema împărțirii cu rest', '', 'capitole'],
  ['evaluare-nationala', 'pdf', 'Subiectul I - Exercițiul 4', '', 'exercitii-subiecte'],
  ['evaluare-nationala', 'pdf', 'Evaluare Națională 2026 — Matematică, Test de antrenament (ISJ Sibiu, ianuarie)', '', 'variante'],
  ['evaluare-nationala', 'pdf', 'Evaluare Națională 2027 — Matematică, Model oficial de subiect', '', 'variante'],
  ['evaluare-nationala', 'pdf', '2026 - varianta 05 rezervă', '', 'variante'],
  ['evaluare-nationala', 'pdf', '2026 simulare Bacău', '1776170791245_Simulare-judeteana-BACAU-ENVIII2026-MATEMATICA-subiecte-si-barem.pdf', 'simulari'],
  ['evaluare-nationala', 'pdf', 'Barem — Evaluare Națională 2024 — Matematică, Varianta 2 (varianta de rezervă)', '', 'bareme'],
  ['evaluare-nationala', 'interactive', 'Procente · Rezolvare interactivă', '', 'capitole'],
  ['evaluare-nationala', 'interactive', 'Geometrie plană 2 · Subiectul III, ex. 5 · Rezolvare interactivă', '', 'capitole'],
  ['evaluare-nationala', 'interactive', 'Subiectul III exercițiul 1', '', 'exercitii-subiecte'],
  ['evaluare-nationala', 'interactive', 'Test 61 · Evaluare Națională', '', 'teste-interactive'],
  ['evaluare-nationala', 'interactive', 'Test interactiv Matematică 1 · Subiectul I, II', '', 'teste-interactive'],
  ['bacalaureat', 'pdf', 'SUBIECTUL I, EX. 1: Numere complexe', '', 'capitole'],
  ['bacalaureat', 'pdf', 'SUBIECTUL I, Ex. 3', '', 'exercitii'],
  ['bacalaureat', 'pdf', 'Bacalaureat 2026 — Matematică M_tehnologic, Test de antrenament (ISJ Brăila, mai)', '', 'teste-antrenament'],
  ['bacalaureat', 'pdf', '2020 Test 10', '1776616716759_E_c_matematica_M_st-nat_2020_Test_10.pdf', 'teste-antrenament'],
  ['bacalaureat', 'pdf', '2025 Model', '1776973826711_E.c-matematica-M-st-nat-BAC2025-model-var.pdf', 'simulari'],
  ['bacalaureat', 'pdf', 'Bacalaureat 2026 — Matematică M_mate-info, Simulare județeană Sibiu', '', 'simulari'],
  ['bacalaureat', 'pdf', 'Bacalaureat 2026 — Matematică M_st-nat, Varianta 5 (varianta de rezervă)', '', 'variante'],
  ['bacalaureat', 'pdf', '2016 Simulare Clasa a XI-a', '1777221162697_e_c_xi_matematica_m_mate-info_2016_bar_simulare.pdf', 'bareme'],
  ['bacalaureat', 'interactive', 'Radicali', '', 'capitole'],
  ['bacalaureat', 'interactive', 'Funcții · Subiectul I, Ex. 2 · Rezolvare interactivă', '', 'exercitii'],
  ['bacalaureat', 'interactive', 'BAC 2026 · Matematică M_tehnologic · Varianta 7 — rezolvare interactivă', '', 'teste-interactive'],
];

test('rubrica automată la EN / BAC: titlurile reale ajung în rubrica în care stau pe site', async () => {
  const M = await load();
  for (const [category, contentType, title, fileName, asteptat] of REALE) {
    const r = M.rubricaAuto({ title, fileName, category, contentType });
    assert.strictEqual(r.subcategory, asteptat, `${category} · ${contentType} · „${title}"`);
    assert.ok(r.motiv, 'spune și de ce');
  }
  // ce nu se recunoaște rămâne de ales de admin (nu ghicim)
  assert.deepStrictEqual(M.rubricaAuto({ title: 'Fișă nouă', category: 'evaluare-nationala', contentType: 'pdf' }), { subcategory: '', motiv: null });
  // la clase și la auxiliare nu există rubrici
  assert.strictEqual(M.rubricaAuto({ title: 'Procente', category: 'clasa-6', contentType: 'pdf' }).subcategory, '');
  assert.strictEqual(M.rubricaAuto({ title: 'Procente', category: 'manuale', contentType: 'interactive' }).subcategory, '');
});

test('capitolul nou: doar în listele pe capitole (clasele, „Capitole" de la EN / BAC), cu regulile hărții', async () => {
  const M = await load();
  assert.strictEqual(M.rubricaPeCapitole('clasa-7', ''), true);
  assert.strictEqual(M.rubricaPeCapitole('evaluare-nationala', 'capitole'), true);
  assert.strictEqual(M.rubricaPeCapitole('bacalaureat', 'capitole'), true);
  assert.strictEqual(M.rubricaPeCapitole('evaluare-nationala', 'variante'), false);
  assert.strictEqual(M.rubricaPeCapitole('manuale', ''), false);
  assert.deepStrictEqual(M.capitolulNou({ title: 'Teorema lui Thales — fișa 3', category: 'clasa-7' }), CH.capitolDin('Teorema lui Thales — fișa 3', 'clasa-7'));
  assert.strictEqual(M.capitolulNou({ title: 'Procente', category: 'evaluare-nationala', subcategory: 'simulari' }), null);
  assert.strictEqual(M.capitolulNou({ title: 'Fișă recapitulativă', category: 'clasa-7' }), null);
});

// ═══════════════════════════ 2) locul: după ultimul material al capitolului ═══════════════════════════

const d = (m) => new Date(Date.UTC(2026, 10, 1, 0, m)).toISOString();
const clasa6 = () => [
  // pe site (sort_order 0, cel mai nou primul): Mulțimi, Procente, Proporții, Cercul, Triunghiul
  { id: 'a', title: 'Mulțimi — clasa a VI-a', category: 'clasa-6', content_type: 'interactive', subcategory: null, profile: null, sort_order: 0, created_at: d(50) },
  { id: 'b', title: 'Procente — clasa a VI-a', category: 'clasa-6', content_type: 'interactive', subcategory: null, profile: null, sort_order: 0, created_at: d(40) },
  { id: 'c', title: 'Proporții — clasa a VI-a', category: 'clasa-6', content_type: 'interactive', subcategory: null, profile: null, sort_order: 0, created_at: d(30) },
  { id: 'e', title: 'Cercul — arce · clasa a VI-a', category: 'clasa-6', content_type: 'interactive', subcategory: null, profile: null, sort_order: 0, created_at: d(20) },
  { id: 'f', title: 'Triunghiul isoscel — proprietăți', category: 'clasa-6', content_type: 'interactive', subcategory: null, profile: null, sort_order: 0, created_at: d(10) },
  { id: 'p', title: 'Procente — fișă PDF', category: 'clasa-6', content_type: 'pdf', subcategory: null, profile: null, sort_order: 0, created_at: d(5) },
];

test('planPlasare: materialul nou intră după ultimul material al capitolului lui; restul listei nu se mișcă', () => {
  const nou = { id: 'n', title: 'Regula de trei simplă — fișa 7', category: 'clasa-6', content_type: 'interactive', subcategory: null, profile: null, sort_order: 0, created_at: d(60) };
  const plan = A.planPlasare([...clasa6(), nou], nou, CH.capitolDin);
  assert.deepStrictEqual(plan.ids, ['a', 'b', 'c', 'n', 'e', 'f'], 'după „Proporții" (ultimul din „Rapoarte"), înaintea capitolului următor; PDF-ul nu e în listă');
  assert.deepStrictEqual([plan.capitol.id, plan.capitol.icon], ['c6-rapoarte', 'procent']);
  assert.strictEqual(plan.dupa.title, 'Proporții — clasa a VI-a');
  assert.deepStrictEqual([plan.loc, plan.total, plan.capitolNou], [4, 6, false]);
  // renumerotarea păstrează ordinea celorlalte
  assert.deepStrictEqual(A.planReorder([...clasa6(), nou], plan.ids).updates.map((u) => [u.id, u.sort_order]), [['a', 1], ['b', 2], ['c', 3], ['n', 4], ['e', 5], ['f', 6]]);
  // capitol nou în listă → la sfârșit
  const nou2 = { ...nou, id: 'm', title: 'Numere raționale — fișa 1' };
  const p2 = A.planPlasare(clasa6(), nou2, CH.capitolDin);
  assert.deepStrictEqual([p2.ids.at(-1), p2.capitolNou, p2.dupa.id], ['m', true, 'f']);
  // fără capitol în titlu, sau listă fără capitole → regula „📥 Materialele noi apar"
  assert.strictEqual(A.planPlasare(clasa6(), { ...nou, title: 'Fișă recapitulativă' }, CH.capitolDin), null);
  assert.strictEqual(A.planPlasare(clasa6(), { ...nou, category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf' }, CH.capitolDin), null);
  // la EN, rubrica „Capitole" (aceeași rubrică: categorie + subcategorie + tip)
  const en = [
    { id: 'x1', title: 'SUBIECTUL I, EX. 1: Divizibilitate - 1', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'pdf', sort_order: 1, created_at: d(1) },
    { id: 'x2', title: 'SUBIECTUL I, EX. 2: Procente', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'pdf', sort_order: 2, created_at: d(2) },
    { id: 'x3', title: 'Evaluare Națională 2025 — Varianta 3', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf', sort_order: 1, created_at: d(3) },
  ];
  const nouEn = { id: 'x9', title: 'SUBIECTUL I, EX. 2: Divizibilitate - 2', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'pdf', sort_order: 0, created_at: d(9) };
  assert.deepStrictEqual(A.planPlasare(en, nouEn, CH.capitolDin).ids, ['x1', 'x9', 'x2']);
});

test('api/content-admin „plaseaza": scrie noua ordine a rubricii; fără capitol nu atinge nimic', async () => {
  const rows = clasa6();
  const nou = { id: '00000000-0000-4000-8000-000000000099', title: 'Proporționalitate inversă — fișa 9', category: 'clasa-6', content_type: 'interactive', subcategory: null, profile: null, sort_order: 0, created_at: d(70) };
  const fake = createFakeSupabase({ content: [...rows, nou] });
  http.admin = () => fake;
  http.authUser = async () => 'admin-1';
  http.requireAdmin = async () => true;
  const handler = require('../api/content-admin');
  const res = fakeRes();
  await handler({ method: 'POST', body: { action: 'plaseaza', id: nou.id }, headers: {} }, res);
  assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.placed, true);
  assert.strictEqual(res.body.capitol.id, 'c6-rapoarte');
  assert.strictEqual(res.body.dupa.title, 'Proporții — clasa a VI-a');
  const ordine = fake.db.tables.content.filter((r) => r.content_type === 'interactive').sort(A.siteOrder).map((r) => r.id);
  assert.deepStrictEqual(ordine, ['a', 'b', 'c', nou.id, 'e', 'f']);
  assert.strictEqual(fake.db.tables.content.find((r) => r.id === 'p').sort_order, 0, 'PDF-urile (altă filă) rămân neatinse');

  // titlu fără capitol → placed: false, nicio scriere
  const fara = { ...nou, id: '00000000-0000-4000-8000-000000000098', title: 'Fișă recapitulativă' };
  const fake2 = createFakeSupabase({ content: [...clasa6(), fara] });
  http.admin = () => fake2;
  delete require.cache[require.resolve('../api/content-admin')];
  const res2 = fakeRes();
  await require('../api/content-admin')({ method: 'POST', body: { action: 'plaseaza', id: fara.id }, headers: {} }, res2);
  assert.deepStrictEqual([res2.statusCode, res2.body.placed], [200, false]);
  assert.ok(!fake2.db.log.some((l) => l.op === 'update'), 'nicio renumerotare');
  // id greșit
  const res3 = fakeRes();
  await require('../api/content-admin')({ method: 'POST', body: { action: 'plaseaza', id: 'x' }, headers: {} }, res3);
  assert.strictEqual(res3.statusCode, 400);
});

// ═══════════════════════════ 3) Admin: formularele ═══════════════════════════

test('Admin: la încărcare se alege doar clasa / examenul (+ profilul la BAC); rubrica și capitolul vin singure', () => {
  const ui = read('src/components/ContentAdminTools.jsx');
  assert.match(ui, /export function rubricaEfectiva\(form, \{ contentType = 'pdf', fileName = '' \} = \{\}\)/);
  assert.match(ui, /export function ContentMetaFields\(\{ s, form, setForm, titlePlaceholder, auto = false, contentType = 'pdf', fileName = '' \}\)/);
  assert.match(ui, /🤖 Automat — \$\{subcategoryLabel\(form\.category, ef\.subcategory\)\}/);
  assert.match(ui, /export function UndeApare\(\{ form, contentType = 'pdf', fileName = '' \}\)/);
  assert.match(ui, /const plan = peCapitole && rows \? planPlasare\(rows, nou, capitolDin\) : null;/, 'același calcul ca serverul');
  assert.match(ui, /import \{ planPlasare \} from '\.\.\/\.\.\/api\/_lib\/contentAdmin\.js';/);
  assert.match(ui, /<Pictograma nume=\{cap\.icon\} size=\{15\} \/>/, 'pictograma capitolului, ca pe hartă');
  // editarea unui material rămâne cu rubrica aleasă de mână
  assert.match(ui, /<ContentMetaFields s=\{s\} form=\{form\} setForm=\{setForm\} titlePlaceholder="Titlul materialului" \/>/);

  const adm = read('src/pages/Admin.jsx');
  assert.strictEqual((adm.match(/ auto contentType="(pdf|interactive)" fileName=\{file\?\.name \|\| ''\} \/>/g) || []).length, 2, 'PDF și interactiv');
  assert.strictEqual((adm.match(/<UndeApare form=\{form\} contentType="(pdf|interactive)"/g) || []).length, 2);
  assert.strictEqual((adm.match(/const ef = rubricaEfectiva\(form, \{ contentType: '(pdf|interactive)', fileName: file\.name \}\);/g) || []).length, 2);
  assert.strictEqual((adm.match(/subcategory: ef\.subcategory \|\| null,/g) || []).length, 2);
  assert.strictEqual((adm.match(/\}\)\.select\('id'\)\.single\(\);\n\s+if \(dbErr\) throw dbErr;\n\s+const loc = nou\?\.id \? await plaseazaLaCapitol\(nou\.id\) : '';/g) || []).length, 2);
  assert.match(adm, /apiPost\('\/api\/content-admin', \{ action: 'plaseaza', id \}\)/);
  assert.match(adm, /if \(needsProfile\(form\.category, ef\.subcategory\) && !form\.profile\) return 'Alege profilul de Bacalaureat\.';/);
});

test('contentAdmin.js merge și în browser (fără dependențe), prin pluginul din vite.config.js', () => {
  const cfg = read('vite.config.js');
  assert.match(cfg, /const COMUNE_SERVER = \/\[\\\\\/\]api\[\\\\\/\]_lib\[\\\\\/\]\(capitoleHarta\|contentAdmin\)\\\.js\$\/;/);
  const src = read('api/_lib/contentAdmin.js');
  assert.doesNotMatch(src, /\brequire\(/);
  assert.doesNotMatch(src, /\bprocess\.|\bBuffer\b|__dirname/);
  assert.strictEqual((src.match(/^module\.exports\s*=\s*\{/gm) || []).length, 1);
  assert.match(src, /rubricaPeCapitole, planPlasare,/);
});
