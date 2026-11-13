// =====================================================================
// test/plan-pregatire.test.js — „🗺️ Harta pregătirii" (cererile din 13 nov. 2026):
//   „pune în «pregătește-mă de examen» un plan de pregătire cu exerciții în ordine:
//    (…) toate exercițiile interactive din subiectele de la «capitole cu exerciții»,
//    «exerciții pe subiecte» și apoi «teste interactive» de la tipul de examen ales
//    de elev. După terminarea testelor interactive, să se treacă la cele PDF. (…)
//    Să se poată alege și o clasă (…) Harta să se updateze mereu, dacă se adaugă
//    exerciții noi în site. Să se poată stagna pe hartă la un exercițiu până îl
//    termină, dar să poată și trece mai departe după mai multe încercări. Dacă se
//    întrerupe șirul de zile, să se poată relua de unde a rămas."
//   și, după-amiaza: „scoate din hartă PDF exerciții pe capitole și exerciții pe
//    subiecte. păstrează doar subiecte de examen cu corectare după barem. împarte
//    harta în două: prima dată harta exercițiilor interactive și a doua harta
//    exercițiilor PDF" + „fă să apară progresul din hartă în «rezultate», la
//    profesori și părinți".
//
// api/_lib/planPregatire.js (etapele, cele două hărți, baremele, starea pașilor,
// pasul curent, sărirea, rezumatul pentru profesori / părinți),
// api/_lib/pregatireZilnica.js (ținta examen / clasă, testul zilei = pasul zilei,
// bifa zilei și la clase, rezumateElevi), api/gamificare.js („plan_sari"),
// api/teacher-students.js (progresul din hartă în „Rezultate"), supabase/plan_pregatire.sql.
// Rulare: npm test
// =====================================================================
delete process.env.PLAN_PRAG;
delete process.env.PLAN_PRAG_PDF;
delete process.env.PLAN_INCERCARI;
delete process.env.PREGATIRE_PRAG_ITEMI;
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const xp = require('../api/_lib/xp');
const ai = require('../api/_lib/ai');
const PL = require('../api/_lib/planPregatire');
const P = require('../api/_lib/pregatireZilnica');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const U = '66666666-6666-4666-8666-666666666666';
const AZI = xp.dayKey();
const ELEV = { id: U, subscription_status: null, role: 'elev', is_admin: false };
const PREMIUM = { ...ELEV, subscription_status: 'active' };
const TINTA_EN = P.tintaInfo('evaluare-nationala');

let ord = 0;
const c = (o) => ({ is_free: true, profile: null, subcategory: null, file_url: `x/${o.id}.pdf`, sort_order: ++ord, created_at: '2026-10-01T10:00:00Z', ...o });
// EN: în site, ordinea e sort_order ↑ (apoi created_at ↓); amestecate intenționat în listă
const EN = [
  c({ id: 'en-test-1', title: 'Test interactiv EN 1', category: 'evaluare-nationala', subcategory: 'teste-interactive', content_type: 'interactive', sort_order: 1 }),
  c({ id: 'en-cap-2', title: 'Fracții — interactiv', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'interactive', sort_order: 2 }),
  c({ id: 'en-cap-1', title: 'Numere reale — interactiv', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'interactive', sort_order: 1 }),
  c({ id: 'en-sub-1', title: 'Subiectul I, ex. 1 — interactiv', category: 'evaluare-nationala', subcategory: 'exercitii-subiecte', content_type: 'interactive', sort_order: 1, is_free: false }),
  c({ id: 'en-sub-2', title: 'Subiectul I, ex. 2 — interactiv', category: 'evaluare-nationala', subcategory: 'exercitii-subiecte', content_type: 'interactive', sort_order: 2 }),
  c({ id: 'en-var-1', title: 'EN 2025 — varianta 1', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf', sort_order: 1 }),
  c({ id: 'en-var-2', title: 'EN 2025 — varianta 2', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf', sort_order: 2 }),
  c({ id: 'en-bar-1', title: 'Barem EN 2025 — varianta 1', category: 'evaluare-nationala', subcategory: 'bareme', content_type: 'pdf', sort_order: 1 }),
  c({ id: 'en-sim-1', title: 'Simulare județeană', category: 'evaluare-nationala', subcategory: 'simulari', content_type: 'pdf', sort_order: 1 }),
  c({ id: 'en-cap-pdf', title: 'Fișă PDF — fracții', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'pdf', sort_order: 1 }),
  c({ id: 'en-sub-pdf', title: 'Exerciții pe subiecte — PDF', category: 'evaluare-nationala', subcategory: 'exercitii-subiecte', content_type: 'pdf', sort_order: 1 }),
  c({ id: 'en-fise', title: 'Altă fișă', category: 'evaluare-nationala', subcategory: 'fise', content_type: 'pdf', sort_order: 1 }),
];
const BAC = [
  c({ id: 'bac-cap', title: 'Capitol comun — logaritmi', category: 'bacalaureat', subcategory: 'capitole', content_type: 'interactive', profile: null, sort_order: 1 }),
  c({ id: 'bac-mi-ex', title: 'M1 · Subiectul I', category: 'bacalaureat', subcategory: 'exercitii', content_type: 'interactive', profile: 'mate-info', sort_order: 1 }),
  c({ id: 'bac-sn-ex', title: 'M2 · Subiectul I', category: 'bacalaureat', subcategory: 'exercitii', content_type: 'interactive', profile: 'stiinte-naturii', sort_order: 1 }),
  c({ id: 'bac-mi-test', title: 'M1 · test interactiv', category: 'bacalaureat', subcategory: 'teste-interactive', content_type: 'interactive', profile: 'mate-info', sort_order: 1 }),
  c({ id: 'bac-mi-antr', title: 'M1 · test de antrenament', category: 'bacalaureat', subcategory: 'teste-antrenament', content_type: 'pdf', profile: 'mate-info', sort_order: 1 }),
  c({ id: 'bac-mi-var', title: 'M1 · varianta 3', category: 'bacalaureat', subcategory: 'variante', content_type: 'pdf', profile: 'mate-info', sort_order: 1 }),
  c({ id: 'bac-mi-cap-pdf', title: 'M1 · fișă pe capitole', category: 'bacalaureat', subcategory: 'capitole', content_type: 'pdf', profile: null, sort_order: 1 }),
];
const CLS = [
  c({ id: 'c7-i1', title: 'Cl. 7 · interactiv 1', category: 'clasa-7', content_type: 'interactive', sort_order: 1 }),
  c({ id: 'c7-i2', title: 'Cl. 7 · interactiv 2', category: 'clasa-7', content_type: 'interactive', sort_order: 2 }),
  c({ id: 'c7-p1', title: 'Cl. 7 · fișă 1', category: 'clasa-7', content_type: 'pdf', sort_order: 1 }),
  c({ id: 'c6-i1', title: 'Cl. 6 · interactiv 1', category: 'clasa-6', content_type: 'interactive', sort_order: 1 }),
  c({ id: 'c6-p1', title: 'Cl. 6 · fișă recapitulativă', category: 'clasa-6', content_type: 'pdf', sort_order: 1 }),
  c({ id: 'c5-i1', title: 'Cl. 5 · interactiv 1', category: 'clasa-5', content_type: 'interactive', sort_order: 1 }),
  c({ id: 'c8-i1', title: 'Cl. 8 · interactiv 1', category: 'clasa-8', content_type: 'interactive', sort_order: 1 }),
  c({ id: 'c7-bar', title: 'Barem fișa 1', category: 'clasa-7', content_type: 'pdf', sort_order: 9 }),
  c({ id: 'c7-man', title: 'Manual digital', category: 'clasa-7', content_type: 'manual', sort_order: 0 }),
];
// baremele legate: varianta 1 — potrivirea site-ului; simularea — legătura botului;
// varianta 2 — negăsit; fișa clasei a VI-a — baremul ales de admin
const AI_PDF_TEXT = [
  { content_id: 'en-var-1', file_url: 'x/en-var-1.pdf', barem_status: 'ok', barem_id: 'en-bar-1', barem_override_id: null },
  { content_id: 'en-var-2', file_url: 'x/en-var-2.pdf', barem_status: 'negasit', barem_id: null, barem_override_id: null },
  { content_id: 'c6-p1', file_url: 'x/c6-p1.pdf', barem_status: 'negasit', barem_id: null, barem_override_id: 'c7-bar' },
  { content_id: 'bac-mi-var', file_url: 'x/bac-mi-var.pdf', barem_status: 'ok_antet', barem_id: 'b1', barem_override_id: null },
];
const EXAM_BOT_INDEX = [
  { content_id: 'en-sim-1', barem_status: 'ok_bot', barem_id: 'en-bar-1' },
  { content_id: 'bac-mi-antr', barem_status: 'negasit', barem_id: null },
];

function baza({ continut = [...EN, ...BAC, ...CLS], progress = [], plan = {}, tinta = null, faraColoana = false, faraBareme = false } = {}) {
  const stats = { user_id: U, total_xp: 0, coins: 0, streak_current: 0, streak_best: 0, freezes: 0, league_tier: 1, prep_exam: tinta };
  if (!faraColoana) stats.prep_plan = plan;
  const supa = createFakeSupabase({
    content: continut.map((r) => ({ ...r })),
    user_stats: [stats],
    profiles: [{ id: U, full_name: 'Ana Maria Popescu' }],
    daily_tests: [], progress: progress.map((r) => ({ user_id: U, ...r })), xp_events: [], user_badges: [], arena_feed: [],
    ai_pdf_text: AI_PDF_TEXT.map((r) => ({ ...r })), exam_bot_index: EXAM_BOT_INDEX.map((r) => ({ ...r })),
  });
  supa.db.unique = { daily_tests: [['user_id', 'day']], user_badges: [['user_id', 'badge_id']], arena_feed: [['dedupe_key']] };
  if (faraBareme) { supa.db.failTables.add('ai_pdf_text'); supa.db.failTables.add('exam_bot_index'); }
  return supa;
}
const stats = (supa) => supa.db.tables.user_stats.find((x) => x.user_id === U);
const randAzi = (supa) => supa.db.tables.daily_tests.find((r) => r.user_id === U && r.day === AZI);
const ids = (h) => h.noduri.map((n) => n.id);
const nod = (h, id) => h.noduri.find((n) => n.id === id);
const plan = (supa, profile = PREMIUM, tinta = TINTA_EN) => PL.stare(supa, U, { tinta, stats: stats(supa), premium: profile.subscription_status === 'active', azi: AZI });

// ═══════════════════════════ 1) etapele, cele două hărți, baremele ═══════════════════════════

test('EN: harta interactivă (capitole → exerciții pe subiecte → teste interactive); harta PDF doar cu subiecte de examen (variante, simulări)', () => {
  const et = PL.etape(TINTA_EN);
  assert.deepStrictEqual(et.map((e) => [e.id, e.harta]), [['capitole', 'interactiv'], ['subiecte', 'interactiv'], ['teste', 'interactiv'], ['pdf-variante', 'pdf'], ['pdf-simulari', 'pdf']],
    'fără „Capitole · PDF" și „Exerciții pe subiecte · PDF"');
  assert.ok(et.filter((e) => e.harta === 'pdf').every((e) => e.doarCuBarem && e.dacaNuStim === 'toate'));
  assert.strictEqual(et[1].subcategory, 'exercitii-subiecte');
  const rows = [...EN].sort((a, b) => a.sort_order - b.sort_order);
  const n = PL.construiesteNoduri(rows, et, { cuBarem: new Set(['en-var-1', 'en-sim-1']) });
  assert.deepStrictEqual(n.map((x) => x.id), ['en-cap-1', 'en-cap-2', 'en-sub-1', 'en-sub-2', 'en-test-1', 'en-var-1', 'en-sim-1'],
    'ordinea din site; fără barem / PDF-urile pe capitole / pe subiecte / varianta fără barem');
  assert.deepStrictEqual(n.map((x) => x.harta), ['interactiv', 'interactiv', 'interactiv', 'interactiv', 'interactiv', 'pdf', 'pdf']);
  // nu se știe nimic despre bareme (tabelele lipsă): subiectele oficiale intră toate
  assert.deepStrictEqual(PL.construiesteNoduri(rows, et, { cuBarem: null }).filter((x) => x.harta === 'pdf').map((x) => x.id), ['en-var-1', 'en-var-2', 'en-sim-1']);
  assert.deepStrictEqual(PL.construiesteNoduri(rows, et, { cuBarem: new Set() }).filter((x) => x.harta === 'pdf'), []);
});

test('BAC: „Capitole" comune profilurilor, apoi doar profilul ales; harta PDF: variante, teste de antrenament, simulări (cu barem)', () => {
  const t = P.tintaInfo('bac-mate-info');
  const et = PL.etape(t);
  assert.deepStrictEqual(et.map((e) => e.id), ['capitole', 'subiecte', 'teste', 'pdf-variante', 'pdf-antrenament', 'pdf-simulari']);
  assert.strictEqual(et[1].subcategory, 'exercitii');
  const n = PL.construiesteNoduri(BAC, et, { cuBarem: new Set(['bac-mi-var', 'bac-mi-antr', 'bac-mi-cap-pdf']) }).map((x) => x.id);
  assert.deepStrictEqual(n, ['bac-cap', 'bac-mi-ex', 'bac-mi-test', 'bac-mi-var', 'bac-mi-antr']);
  assert.ok(!n.includes('bac-sn-ex'), 'exercițiile altui profil nu intră');
  assert.ok(!n.includes('bac-mi-cap-pdf'), 'fișele pe capitole nu mai intră în harta PDF, nici cu barem');
});

test('clasa aleasă: harta interactivă (ea, apoi clasele dinainte); harta PDF doar cu fișele care au barem — fără informații, niciuna', () => {
  const t = P.tintaInfo('clasa-7');
  assert.strictEqual(t.tip, 'clasa');
  assert.deepStrictEqual(PL.categorii(t), ['clasa-7', 'clasa-6', 'clasa-5']);
  const et = PL.etape(t);
  assert.deepStrictEqual(et.map((e) => e.id), ['c7-int', 'c6-int', 'c5-int', 'c7-pdf', 'c6-pdf', 'c5-pdf']);
  assert.strictEqual(et[0].titlu, 'Clasa a VII-a · exerciții interactive');
  assert.strictEqual(et[3].titlu, 'Clasa a VII-a · fișe PDF cu barem');
  assert.deepStrictEqual(PL.construiesteNoduri(CLS, et, { cuBarem: new Set(['c6-p1']) }).map((x) => x.id), ['c7-i1', 'c7-i2', 'c6-i1', 'c5-i1', 'c6-p1']);
  assert.deepStrictEqual(PL.construiesteNoduri(CLS, et, { cuBarem: null }).map((x) => x.id), ['c7-i1', 'c7-i2', 'c6-i1', 'c5-i1']);
  assert.deepStrictEqual(PL.etape(P.tintaInfo('clasa-5')).map((e) => e.id), ['c5-int', 'c5-pdf']);
  assert.strictEqual(PL.etape(P.tintaInfo('clasa-12')).length, 16, 'a XII-a: 8 clase × (interactive + PDF)');
  assert.deepStrictEqual(PL.etape(null), []);
});

test('baremele (cu baza de date): potrivirea site-ului, baremul ales de admin, legătura botului; fără: fișierul schimbat, „negăsit"; tabelele lipsă → null', async () => {
  const supa = baza();
  const rows = [...EN, ...CLS].filter((r) => r.content_type === 'pdf');
  const s = await PL.bareme(supa, rows);
  assert.deepStrictEqual([...s].sort(), ['c6-p1', 'en-sim-1', 'en-var-1']);
  supa.db.tables.ai_pdf_text[0].file_url = 'x/alt-fisier.pdf';   // PDF-ul a fost înlocuit → potrivirea veche nu mai contează
  assert.ok(!(await PL.bareme(supa, rows)).has('en-var-1'));
  assert.strictEqual(await PL.bareme(baza({ faraBareme: true }), rows), null);
  assert.deepStrictEqual([...(await PL.bareme(supa, []))], []);
});

// ═══════════════════════════ 2) starea pașilor ═══════════════════════════

test('starea unui pas: nou · neterminat (doar salvarea automată) · încercat · trecut (70% interactiv, 50% PDF) · sărit', () => {
  const I = { id: 'a', tip: 'interactive' }, F = { id: 'b', tip: 'pdf' };
  assert.strictEqual(PL.stareNod(I, null).stare, 'nou');
  assert.strictEqual(PL.stareNod(I, { score: 40, max_score: 100, attempts: 0 }).stare, 'inceput');
  assert.deepStrictEqual(['stare', 'pct', 'incercari'].map((k) => PL.stareNod(I, { score: 60, max_score: 100, attempts: 2 })[k]), ['incercat', 60, 2]);
  assert.strictEqual(PL.stareNod(I, { score: 7, max_score: 10, attempts: 1 }).stare, 'trecut');
  assert.strictEqual(PL.stareNod(F, { score: 45, max_score: 90, attempts: 1 }).stare, 'trecut', 'PDF: 50% (nota 5)');
  assert.strictEqual(PL.stareNod(F, { score: 40, max_score: 90, attempts: 1 }).stare, 'incercat');
  assert.strictEqual(PL.stareNod(I, { score: 1, max_score: 10, attempts: 3 }, { sarite: new Set(['a']) }).stare, 'sarit');
  assert.strictEqual(PL.stareNod(I, { score: 9, max_score: 10, attempts: 4 }, { sarite: new Set(['a']) }).stare, 'trecut', 'trecut după sărire → trecut');
  assert.strictEqual(PL.stareNod(I, { score: 2, max_score: 10, attempts: 5 }, { trecute: new Set(['a']) }).stare, 'trecut', 'o reluare mai slabă nu-l scoate');
  assert.strictEqual(PL.stareNod(I, { score: 2, max_score: 10, attempts: null }).incercari, 1, 'rândurile vechi: o încercare');
  assert.deepStrictEqual([PL.PRAG_INTERACTIV, PL.PRAG_PDF, PL.INCERCARI_SARIRE], [70, 50, 3]);
});

test('pasul curent al unei hărți: primul netrecut; pașii de după încuiați (cei lucrați din site rămân deschiși); sărirea doar după 3 încercări', () => {
  const noduri = ['a', 'b', 'c', 'd'].map((id) => ({ id, tip: 'interactive', harta: 'interactiv', gratuit: true, etapa: 'x' }));
  const prog = new Map([
    ['a', { score: 90, max_score: 100, attempts: 1 }],
    ['b', { score: 30, max_score: 100, attempts: 2 }],
    ['d', { score: 20, max_score: 100, attempts: 0 }],
  ]);
  let r = PL.calculeaza(noduri, prog, { premium: false });
  assert.strictEqual(r.curent, 1);
  assert.deepStrictEqual(r.noduri.map((n) => n.deschis), [true, true, false, true], 'c încuiat; d început din site → deschis');
  assert.strictEqual(r.noduri[1].poateSari, false, 'două încercări: încă nu');
  prog.set('b', { score: 30, max_score: 100, attempts: 3 });
  r = PL.calculeaza(noduri, prog, {});
  assert.strictEqual(r.noduri[1].poateSari, true);
  r = PL.calculeaza(noduri, prog, { sarite: new Set(['b']) });
  assert.strictEqual(r.curent, 2, 'după sărire → următorul');
  assert.strictEqual(r.noduri[1].stare, 'sarit');
});

test('cele două hărți merg separat: fiecare cu pasul ei; fără abonament, pașii Premium și harta PDF au ⭐ și nu opresc nimic', () => {
  const noduri = [
    { id: 'g1', tip: 'interactive', gratuit: true }, { id: 'p1', tip: 'interactive', gratuit: false },
    { id: 'g2', tip: 'interactive', gratuit: true }, { id: 'f1', tip: 'pdf', gratuit: true }, { id: 'f2', tip: 'pdf', gratuit: true },
  ].map((n) => ({ ...n, harta: n.tip === 'pdf' ? 'pdf' : 'interactiv', etapa: n.tip === 'pdf' ? 'y' : 'x' }));
  const lista = [{ id: 'x', titlu: 'X', tip: 'interactive', harta: 'interactiv' }, { id: 'y', titlu: 'Y', tip: 'pdf', harta: 'pdf' }];
  const prog = new Map([['g1', { score: 100, max_score: 100, attempts: 1 }]]);
  let h = PL.calculeazaHarti(noduri, prog, { premium: false });
  assert.deepStrictEqual([h.interactiv.curent, h.interactiv.noduri[h.interactiv.curent].id], [2, 'g2'], 'sare peste pasul Premium');
  assert.strictEqual(h.pdf.curent, -1, 'fără abonament, harta PDF nu are pas');
  let v = PL.vedere(h, lista, { premium: false });
  assert.deepStrictEqual([v.pas.id, v.pas.harta, v.pdf.ramasePremium, v.pdf.pas], ['g2', 'interactiv', 2, null]);
  // cu Premium: pasul zilei din harta interactivă, iar harta PDF are pasul ei, în paralel
  h = PL.calculeazaHarti(noduri, prog, { premium: true });
  v = PL.vedere(h, lista, { premium: true });
  assert.deepStrictEqual([v.pas.id, v.interactiv.pas.nr, v.pdf.pas.id, v.pdf.pas.nr], ['p1', 2, 'f1', 1], 'numerotarea — în harta fiecăruia');
  // harta interactivă gata → pasul zilei trece pe harta PDF
  const toate = new Map(['g1', 'p1', 'g2'].map((id) => [id, { score: 9, max_score: 10, attempts: 1 }]));
  v = PL.vedere(PL.calculeazaHarti(noduri, toate, { premium: true }), lista, { premium: true });
  assert.deepStrictEqual([v.interactiv.terminat, v.pas.id, v.pas.harta, v.terminat], [true, 'f1', 'pdf', false]);
  assert.deepStrictEqual(v.pas.moduri.map((m) => m.mod), ['pdf', 'chat', 'foaie', 'poza']);
  // fără abonament: tot ce e gratuit e gata → „terminat"
  v = PL.vedere(PL.calculeazaHarti(noduri, new Map([['g1', { score: 1, max_score: 1, attempts: 1 }], ['g2', { score: 1, max_score: 1, attempts: 1 }]]), { premium: false }), lista, { premium: false });
  assert.deepStrictEqual([v.terminat, v.pas, v.interactiv.ramasePremium, v.pdf.ramasePremium], [true, null, 1, 2]);
});

// ═══════════════════════════ 3) cu baza de date ═══════════════════════════

test('harta EN din site: cele două hărți, etapele cu numărători, pasul zilei (🗺️ &plan=1); harta PDF doar cu subiectele care au barem', async () => {
  const supa = baza({ tinta: 'evaluare-nationala', progress: [
    { content_id: 'en-cap-1', score: 80, max_score: 100, attempts: 1 },
    { content_id: 'en-cap-2', score: 30, max_score: 100, attempts: 1 },
    { content_id: 'en-var-1', score: 63, max_score: 90, attempts: 1 },
  ] });
  const v = await plan(supa);
  assert.deepStrictEqual(ids(v.interactiv), ['en-cap-1', 'en-cap-2', 'en-sub-1', 'en-sub-2', 'en-test-1']);
  assert.deepStrictEqual(ids(v.pdf), ['en-var-1', 'en-sim-1'], 'varianta 2 n-are barem; capitolele și exercițiile pe subiecte PDF nu intră');
  assert.deepStrictEqual([v.interactiv.total, v.interactiv.trecute, v.interactiv.curent, v.interactiv.procent], [5, 1, 1, 20]);
  assert.deepStrictEqual(v.interactiv.etape.map((e) => [e.id, e.total, e.trecute]), [['capitole', 2, 1], ['subiecte', 2, 0], ['teste', 1, 0]]);
  assert.deepStrictEqual(v.pdf.etape.map((e) => [e.id, e.total, e.trecute]), [['pdf-variante', 1, 1], ['pdf-simulari', 1, 0]]);
  assert.deepStrictEqual([v.pas.id, v.pas.harta, v.pas.nr, v.pas.stare, v.pas.incercari, v.pas.incercariRamase, v.pas.poateSari], ['en-cap-2', 'interactiv', 2, 'incercat', 1, 2, false]);
  assert.strictEqual(v.pas.url, '/exercitiu?id=en-cap-2&pregatire=1&plan=1');
  assert.deepStrictEqual([v.pdf.pas.id, v.pdf.pas.nr], ['en-sim-1', 2], 'harta PDF își are pasul ei, în paralel');
  assert.strictEqual(v.pdf.pas.moduri[1].url, '/pdf-viewer?id=en-sim-1&pregatire=1&plan=1&mod=chat');
  assert.strictEqual(nod(v.interactiv, 'en-sub-1').deschis, false, 'încuiat până trece pasul curent');
  assert.deepStrictEqual([v.total, v.trecute], [7, 2]);
  assert.deepStrictEqual(stats(supa).prep_plan.trecute.sort(), ['en-cap-1', 'en-var-1'], 'pașii trecuți sunt ținuți minte');
  assert.strictEqual(stats(supa).prep_plan.start, AZI);
  assert.strictEqual(stats(supa).prep_plan.tinta, 'evaluare-nationala');
  // fără informații despre bareme (tabelele lipsă): subiectele de examen intră toate
  const fara = await plan(baza({ tinta: 'evaluare-nationala', faraBareme: true }));
  assert.deepStrictEqual(ids(fara.pdf), ['en-var-1', 'en-var-2', 'en-sim-1']);
});

test('„harta se actualizează": un exercițiu nou apare la locul lui, cu „nou" (adăugat după începutul planului); unul dinainte devine pasul curent', async () => {
  const supa = baza({ tinta: 'evaluare-nationala', plan: { start: '2026-11-01', tinta: 'evaluare-nationala', trecute: ['en-cap-1', 'en-cap-2'] }, progress: [
    { content_id: 'en-cap-1', score: 9, max_score: 10, attempts: 1 }, { content_id: 'en-cap-2', score: 9, max_score: 10, attempts: 1 },
  ] });
  let v = await plan(supa);
  assert.strictEqual(v.pas.id, 'en-sub-1');
  supa.db.tables.content.push(c({ id: 'en-cap-nou', title: 'Puteri — interactiv (nou)', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'interactive', sort_order: 3, created_at: '2026-11-10T09:00:00Z' }));
  v = await plan(supa);
  assert.deepStrictEqual(ids(v.interactiv).slice(0, 3), ['en-cap-1', 'en-cap-2', 'en-cap-nou']);
  assert.strictEqual(nod(v.interactiv, 'en-cap-nou').nou, true);
  assert.strictEqual(nod(v.interactiv, 'en-cap-1').nou, false);
  assert.deepStrictEqual([v.pas.id, v.pas.nou], ['en-cap-nou', true], 'exercițiul nou din capitolele deja parcurse e următorul pas');
  // un subiect nou, cu barem legat, apare și pe harta PDF
  supa.db.tables.content.push(c({ id: 'en-var-3', title: 'EN 2026 — model', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf', sort_order: 3, created_at: '2026-11-12T09:00:00Z' }));
  supa.db.tables.exam_bot_index.push({ content_id: 'en-var-3', barem_status: 'ok_bot', barem_id: 'x' });
  v = await plan(supa);
  assert.deepStrictEqual(ids(v.pdf), ['en-var-1', 'en-var-3', 'en-sim-1']);
  assert.strictEqual(nod(v.pdf, 'en-var-3').nou, true);
});

test('„⏭ Treci mai departe": doar pe pasul curent al hărții lui, după 3 încercări (și pe harta PDF); fără coloana prep_plan → cere migrarea', async () => {
  const supa = baza({ tinta: 'evaluare-nationala', progress: [
    { content_id: 'en-cap-1', score: 20, max_score: 100, attempts: 2 },
    { content_id: 'en-var-1', score: 20, max_score: 90, attempts: 3 },
  ] });
  const t = TINTA_EN;
  let r = await PL.sari(supa, U, { contentId: 'en-cap-1', tinta: t, stats: stats(supa), premium: true });
  assert.match(r.error, /după 3 încercări \(mai ai una\)/);
  r = await PL.sari(supa, U, { contentId: 'en-cap-2', tinta: t, stats: stats(supa), premium: true });
  assert.match(r.error, /doar de la pasul la care ai ajuns/);
  supa.db.tables.progress[0].attempts = 3;
  const v3 = await plan(supa);
  assert.deepStrictEqual([v3.pas.poateSari, nod(v3.interactiv, 'en-cap-1').poateSari, nod(v3.interactiv, 'en-cap-2').poateSari, nod(v3.pdf, 'en-var-1').poateSari], [true, true, false, true], 'și pe hartă, în fiecare hartă');
  assert.deepStrictEqual(await PL.sari(supa, U, { contentId: 'en-cap-1', tinta: t, stats: stats(supa), premium: true }), { ok: true });
  assert.deepStrictEqual(await PL.sari(supa, U, { contentId: 'en-var-1', tinta: t, stats: stats(supa), premium: true }), { ok: true }, 'harta PDF: independent de cea interactivă');
  assert.deepStrictEqual(stats(supa).prep_plan.sarite, ['en-cap-1', 'en-var-1']);
  const v = await plan(supa);
  assert.deepStrictEqual([nod(v.interactiv, 'en-cap-1').stare, v.pas.id, v.pdf.pas.id, v.interactiv.sarite, v.pdf.sarite], ['sarit', 'en-cap-2', 'en-sim-1', 1, 1]);
  assert.strictEqual(nod(v.interactiv, 'en-cap-1').deschis, true, 'pasul sărit se poate relua oricând');
  assert.match((await PL.sari(supa, U, { contentId: 'nu-exista', tinta: t, stats: stats(supa), premium: true })).error, /nu mai e în planul tău/);
  const vechi = baza({ tinta: 'evaluare-nationala', faraColoana: true, progress: [{ content_id: 'en-cap-1', score: 0, max_score: 100, attempts: 5 }] });
  const rv = await PL.sari(vechi, U, { contentId: 'en-cap-1', tinta: t, stats: stats(vechi), premium: true });
  assert.strictEqual(rv.setup, false);
  assert.match(rv.error, /plan_pregatire\.sql/);
  const hv = await plan(vechi);
  assert.strictEqual(hv.coloana, false, 'harta merge și fără migrare');
  assert.strictEqual(hv.pas.id, 'en-cap-1');
});

// ═══════════════════════════ 4) „Pregătește-mă": ținta, testul zilei, bifa ═══════════════════════════

test('ținta poate fi o clasă: alegerea, harta interactivă a clasei (a VII-a, apoi a VI-a, a V-a), harta PDF doar cu fișele cu barem; testul zilei = pasul curent', async () => {
  const supa = baza();
  const r = await P.alege(supa, U, ELEV, { examen: 'clasa-7' });
  assert.strictEqual(r.ok, true);
  const s = r.pregatire;
  assert.deepStrictEqual(s.examen, { id: 'clasa-7', label: 'Clasa a VII-a', scurt: 'Cl. VII', tip: 'clasa' });
  assert.strictEqual(s.clase.length, 8);
  assert.deepStrictEqual(ids(s.plan.interactiv), ['c7-i1', 'c7-i2', 'c6-i1', 'c5-i1']);
  assert.deepStrictEqual(ids(s.plan.pdf), ['c6-p1'], 'doar fișa cu barem (aleasă de admin)');
  assert.strictEqual(s.plan.pdf.ramasePremium, 1, 'fără abonament, fișa PDF are ⭐');
  assert.deepStrictEqual(s.test, { id: 'c7-i1', titlu: 'Cl. 7 · interactiv 1', tip: 'interactiv', plan: true, url: '/exercitiu?id=c7-i1&pregatire=1&plan=1' });
  assert.strictEqual(randAzi(supa).exam, 'clasa-7');
  assert.strictEqual(stats(supa).prep_exam, 'clasa-7');
  assert.strictEqual((await P.rezumat(supa, U)).examen, 'clasa-7');
});

test('testul zilei urmează harta: pasul trecut azi → rândul zilei (încă nelucrat) trece pe pasul următor', async () => {
  const supa = baza();
  await P.alege(supa, U, PREMIUM, { examen: 'evaluare-nationala' });
  assert.strictEqual(randAzi(supa).content_id, 'en-cap-1');
  supa.db.tables.progress.push({ user_id: U, content_id: 'en-cap-1', score: 10, max_score: 10, attempts: 1 });
  const s = await P.stare(supa, U, PREMIUM);
  assert.strictEqual(s.test.id, 'en-cap-2');
  assert.strictEqual(randAzi(supa).content_id, 'en-cap-2');
  assert.strictEqual(s.plan.interactiv.trecute, 1);
});

test('bifa zilei la o țintă-clasă: contează exercițiile claselor din plan (a VII-a și dinainte), nu și cele de după; la o țintă-examen, clasele nu contează', async () => {
  const supa = baza({ tinta: 'clasa-7' });
  const cls = (id) => CLS.find((x) => x.id === id);
  assert.strictEqual(await P.inregistreaza(supa, U, { content: cls('c8-i1'), itemi: 5 }), null, 'a VIII-a nu e în planul clasei a VII-a');
  assert.strictEqual(await P.inregistreaza(supa, U, { content: cls('c7-bar'), itemi: 5 }), null, 'baremul nu se numără');
  const r = await P.inregistreaza(supa, U, { content: cls('c6-i1'), itemi: 3, pct: 90 });
  assert.deepStrictEqual([r.lucrat, r.tocmaiBifata, r.examen], [true, true, 'Clasa a VII-a']);
  assert.strictEqual(randAzi(supa).exam, 'clasa-7');
  const ex = baza({ tinta: 'evaluare-nationala' });
  assert.strictEqual(await P.inregistreaza(ex, U, { content: cls('c7-i1'), itemi: 5 }), null);
  assert.ok(await P.inregistreaza(ex, U, { content: EN.find((x) => x.id === 'en-cap-1'), itemi: 3 }));
});

test('după o pauză: seria se rupe, dar planul continuă de unde a rămas („pauza" pentru mesajul de bun venit)', async () => {
  const zi = (n) => xp.addDays(AZI, n);
  const supa = baza({ tinta: 'evaluare-nationala', progress: [{ content_id: 'en-cap-1', score: 10, max_score: 10, attempts: 1 }] });
  supa.db.tables.daily_tests.push(
    { id: 'd1', user_id: U, day: zi(-9), exam: 'evaluare-nationala', status: 'lucrat', items_done: 4, content_id: 'en-cap-1', content_title: 'x', content_type: 'interactive' },
    { id: 'd2', user_id: U, day: zi(-8), exam: 'evaluare-nationala', status: 'lucrat', items_done: 3, content_id: 'en-cap-1', content_title: 'x', content_type: 'interactive' },
  );
  const s = await P.stare(supa, U, ELEV);
  assert.deepStrictEqual([s.serie, s.total, s.pauza], [0, 2, true]);
  assert.strictEqual(s.plan.pas.id, 'en-cap-2', 'continuă de la pasul următor, nu de la început');
  const nou = baza({ tinta: 'evaluare-nationala' });
  assert.strictEqual((await P.stare(nou, U, ELEV)).pauza, false, 'elevul nou nu primește „bine ai revenit"');
});

test('api/gamificare „plan_sari": 200 cu starea nouă; 400 cu motivul; 503 fără migrare', async () => {
  const supa = baza({ tinta: 'evaluare-nationala', progress: [{ content_id: 'en-cap-1', score: 0, max_score: 100, attempts: 3 }] });
  const handler = require('../api/gamificare');
  const orig = { authUser: ai.authUser, requireUser: ai.requireUser, admin: ai.admin };
  ai.authUser = async () => U;
  ai.requireUser = async () => PREMIUM;
  ai.admin = () => supa;
  try {
    let res = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { action: 'plan_sari', contentId: 'en-cap-1' } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.pregatire.plan.pas.id, 'en-cap-2');
    res = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { action: 'plan_sari', contentId: 'en-cap-2' } }, res);
    assert.strictEqual(res.statusCode, 400);
    const vechi = baza({ tinta: 'evaluare-nationala', faraColoana: true, progress: [{ content_id: 'en-cap-1', score: 0, max_score: 100, attempts: 3 }] });
    ai.admin = () => vechi;
    res = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { action: 'plan_sari', contentId: 'en-cap-1' } }, res);
    assert.strictEqual(res.statusCode, 503);
  } finally { Object.assign(ai, orig); }
});

test('migrarea: doar coloana user_stats.prep_plan (jsonb), fără tabele noi', () => {
  const sql = read('supabase/plan_pregatire.sql');
  assert.match(sql, /alter table public\.user_stats add column if not exists prep_plan jsonb not null default '\{\}'::jsonb;/);
  assert.ok(!/create table/i.test(sql.replace(/--.*$/gm, '')), 'fără create table (deci fără GRANT-uri noi)');
});

// ═══════════════════════════ 5) „Rezultate" la profesori și părinți ═══════════════════════════

test('rezumatul pentru profesori / părinți: ținta, cele două hărți (trecute, sărite, neterminate, pasul la care e), seria — fără lista pașilor', async () => {
  const supa = baza({ tinta: 'evaluare-nationala', progress: [
    { content_id: 'en-cap-1', score: 80, max_score: 100, attempts: 1, completed_at: '2026-11-10T10:00:00Z' },
    { content_id: 'en-cap-2', score: 30, max_score: 100, attempts: 2, completed_at: '2026-11-11T10:00:00Z' },
    { content_id: 'en-test-1', score: 3, max_score: 10, attempts: 0, completed_at: '2026-11-12T10:00:00Z' },
  ] });
  supa.db.tables.daily_tests.push(
    { id: 'z1', user_id: U, day: xp.addDays(AZI, -1), exam: 'evaluare-nationala', status: 'lucrat' },
    { id: 'z2', user_id: U, day: AZI, exam: 'evaluare-nationala', status: 'lucrat' },
  );
  const r = await P.rezumateElevi(supa, [{ id: U, premium: false }, { id: 'fara-tinta', premium: false }], supa.db.tables.progress);
  assert.deepStrictEqual(Object.keys(r), [U], 'doar elevii care și-au ales ținta');
  const x = r[U];
  assert.deepStrictEqual(x.tinta, { id: 'evaluare-nationala', label: 'Evaluarea Națională', scurt: 'EN', tip: 'examen' });
  assert.deepStrictEqual([x.interactiv.total, x.interactiv.trecute, x.interactiv.neterminate, x.interactiv.procent], [5, 1, 1, 20]);
  assert.deepStrictEqual(x.interactiv.pas, { nr: 2, titlu: 'Fracții — interactiv', stare: 'incercat', incercari: 2, pct: 30 });
  assert.deepStrictEqual([x.pdf.total, x.pdf.pas, x.pdf.ramasePremium], [2, null, 2], 'cont gratuit: harta PDF cu ⭐');
  assert.deepStrictEqual(x.interactiv.etape.map((e) => [e.titlu, e.total, e.trecute]), [['Capitole cu exerciții', 2, 1], ['Exerciții pe subiecte', 2, 0], ['Teste interactive', 1, 0]]);
  assert.ok(!('noduri' in x.interactiv), 'fără lista pașilor');
  assert.deepStrictEqual([x.serie, x.zile, x.ultimaZi], [2, 2, AZI]);
  // tabelele pregătirii lipsă → rezultatele merg mai departe, fără hartă
  const lipsa = baza({ tinta: 'evaluare-nationala' });
  lipsa.db.failTables.add('user_stats');
  assert.deepStrictEqual(await P.rezumateElevi(lipsa, [{ id: U }], []), {});
});

test('api/teacher-students: fiecare elev are `plan` (progresul din hartă) — la profesor și la părinte; fără tabele, rezultatele merg', async () => {
  const supa = baza({ tinta: 'evaluare-nationala', progress: [{ content_id: 'en-cap-1', score: 9, max_score: 10, attempts: 1, completed_at: '2026-11-10T10:00:00Z' }] });
  supa.db.tables.profiles.push({ id: 'prof', role: 'profesor', full_name: 'Ion Ionescu' }, { id: 'mama', role: 'parinte', full_name: 'Elena Popescu' }, { id: 'dan', role: 'elev', full_name: 'Dan Rusu' });
  supa.db.tables.profiles[0].role = 'elev';
  supa.db.tables.mentor_students = [
    { mentor_id: 'prof', student_id: U, group_id: null }, { mentor_id: 'prof', student_id: 'dan', group_id: null },
    { mentor_id: 'mama', student_id: U, group_id: null },
  ];
  supa.db.tables.mentor_groups = [];
  const sbPath = require.resolve('@supabase/supabase-js');
  const httpLib = require('../api/_lib/http');
  const vechi = { sb: require.cache[sbPath], authUser: httpLib.authUser };
  require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true, exports: { createClient: () => supa } };
  delete require.cache[require.resolve('../api/teacher-students.js')];
  let cine = 'prof';
  httpLib.authUser = async () => cine;
  try {
    const students = require('../api/teacher-students.js');
    const call = async (u) => { cine = u; const res = fakeRes(); await students({ method: 'POST', headers: { authorization: 'Bearer x' }, body: { userId: u } }, res); return res; };
    let r = await call('prof');
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    const ana = r.body.students.find((s) => s.id === U);
    assert.deepStrictEqual([ana.plan.tinta.id, ana.plan.interactiv.trecute, ana.plan.interactiv.pas.titlu], ['evaluare-nationala', 1, 'Fracții — interactiv']);
    assert.strictEqual(r.body.students.find((s) => s.id === 'dan').plan, null, 'elevul fără țintă: fără hartă');
    r = await call('mama');
    assert.strictEqual(r.body.students[0].plan.interactiv.total, 5, 'și părintele vede harta copilului');
    supa.db.failTables.add('user_stats');
    r = await call('prof');
    assert.strictEqual(r.statusCode, 200, 'fără tabelele pregătirii, rezultatele merg');
    assert.strictEqual(r.body.students.find((s) => s.id === U).plan, null);
  } finally {
    if (vechi.sb) require.cache[sbPath] = vechi.sb; else delete require.cache[sbPath];
    httpLib.authUser = vechi.authUser;
    delete require.cache[require.resolve('../api/teacher-students.js')];
  }
});

// ═══════════════════════════ 6) paginile ═══════════════════════════

test('„Pregătește-mă": două hărți, în ordine — 1 · exercițiile interactive, 2 · subiectele PDF cu barem; pasul zilei din harta lui', () => {
  const pg = read('src/pages/PregatesteMa.jsx');
  const i1 = pg.indexOf('<HartaPlan plan={plan.interactiv}');
  const i2 = pg.indexOf('<HartaPlan plan={plan.pdf} legenda={false}');
  assert.ok(i1 > 0 && i2 > i1, 'întâi harta interactivă, apoi harta PDF (fără a doua legendă)');
  assert.match(pg, /const hartaPas = plan\?\.pas\?\.harta && noduri\[plan\.pas\.harta\] \? plan\.pas\.harta : null;/);
  assert.match(pg, /<FisaPas n=\{nodAles\} harta=\{plan\[nodAles\.harta\]\}/, 'fișa pasului numără în harta lui');
  assert.match(pg, /Subiecte de examen PDF, cu barem/);
  assert.match(pg, /Fișe PDF cu barem/);
  assert.match(pg, /pasul zilei rămâne pe harta exercițiilor interactive până o termini/);
  const h = read('src/components/HartaPlan.jsx');
  assert.match(h, /export default function HartaPlan\(\{ plan, alesId = null, onAlege = \(\) => \{\}, legenda = true \}\)/);
  assert.ok(!h.includes('test PDF</li>'), 'legenda nu mai amestecă testele PDF (au harta lor)');
});

test('„Rezultate" (profesor și părinte): progresul din hartă — insigna din rândul elevului și caseta „🗺️ Harta pregătirii"', () => {
  const tr = read('src/components/TeacherResults.jsx');
  assert.match(tr, /import HartaPlanRezumat, \{ PlanChip \} from '\.\/HartaPlanRezumat';/);
  assert.match(tr, /rows: \[\], plan: s\.plan \|\| null \}\);/);
  assert.match(tr, /\{!student\.archived && student\.plan && <div><PlanChip plan=\{student\.plan\} \/><\/div>\}/);
  assert.match(tr, /\{!student\.archived && <HartaPlanRezumat plan=\{student\.plan\} nume=\{student\.name\.split\(' '\)\[0\]\} \/>\}/);
  // aceeași componentă servește și părinții (role="parinte"): fără condiție pe isTeacher
  const linie = tr.split('\n').find((l) => l.includes('<HartaPlanRezumat '));
  assert.ok(!/isTeacher|isParent/.test(linie));
  const rz = read('src/components/HartaPlanRezumat.jsx');
  assert.match(rz, /\{ id: 'interactiv', nr: 1, icon: '🧩', nume: 'Exerciții interactive' \}/);
  assert.match(rz, /\{ id: 'pdf', nr: 2, icon: '📄', nume: 'Subiecte PDF cu barem' \}/);
  assert.ok(!/nota|fmtNota/i.test(rz.replace(/fără notele zilei/g, '')), 'fără notele zilei — acelea le vede doar elevul');
});
