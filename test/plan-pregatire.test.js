// =====================================================================
// test/plan-pregatire.test.js — „🗺️ Harta pregătirii" (cererea din 13 nov. 2026):
//   „pune în «pregătește-mă de examen» un plan de pregătire cu exerciții în ordine:
//    (…) toate exercițiile interactive din subiectele de la «capitole cu exerciții»,
//    «exerciții pe subiecte» și apoi «teste interactive» de la tipul de examen ales
//    de elev. După terminarea testelor interactive, să se treacă la cele PDF. (…)
//    Să se poată alege și o clasă: (…) toate exercițiile interactive de la acea
//    clasă, în ordinea din site, apoi din clasele precedente. Apoi (…) exerciții PDF
//    (…) Planul să se poată vedea ca o hartă pe care s-au parcurs exerciții. Harta
//    să se updateze mereu, dacă se adaugă exerciții noi în site. Să se poată stagna
//    pe hartă la un exercițiu până îl termină, dar să poată și trece mai departe
//    după mai multe încercări. Dacă se întrerupe șirul de zile, să se poată relua
//    de unde a rămas. Păstrează liga și XP, dar introdu harta de pregătire."
//
// api/_lib/planPregatire.js (etapele, starea pașilor, pasul curent, sărirea),
// api/_lib/pregatireZilnica.js (ținta examen / clasă, testul zilei = pasul curent,
// bifa zilei și la clase), api/gamificare.js („plan_sari"), supabase/plan_pregatire.sql.
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
  c({ id: 'en-bar-1', title: 'Barem EN 2025 — varianta 1', category: 'evaluare-nationala', subcategory: 'bareme', content_type: 'pdf', sort_order: 1 }),
  c({ id: 'en-sim-1', title: 'Simulare județeană', category: 'evaluare-nationala', subcategory: 'simulari', content_type: 'pdf', sort_order: 1 }),
  c({ id: 'en-cap-pdf', title: 'Fișă PDF — fracții', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'pdf', sort_order: 1 }),
  c({ id: 'en-fise', title: 'Altă fișă', category: 'evaluare-nationala', subcategory: 'fise', content_type: 'pdf', sort_order: 1 }),
];
const BAC = [
  c({ id: 'bac-cap', title: 'Capitol comun — logaritmi', category: 'bacalaureat', subcategory: 'capitole', content_type: 'interactive', profile: null, sort_order: 1 }),
  c({ id: 'bac-mi-ex', title: 'M1 · Subiectul I', category: 'bacalaureat', subcategory: 'exercitii', content_type: 'interactive', profile: 'mate-info', sort_order: 1 }),
  c({ id: 'bac-sn-ex', title: 'M2 · Subiectul I', category: 'bacalaureat', subcategory: 'exercitii', content_type: 'interactive', profile: 'stiinte-naturii', sort_order: 1 }),
  c({ id: 'bac-mi-test', title: 'M1 · test interactiv', category: 'bacalaureat', subcategory: 'teste-interactive', content_type: 'interactive', profile: 'mate-info', sort_order: 1 }),
  c({ id: 'bac-mi-antr', title: 'M1 · test de antrenament', category: 'bacalaureat', subcategory: 'teste-antrenament', content_type: 'pdf', profile: 'mate-info', sort_order: 1 }),
  c({ id: 'bac-mi-var', title: 'M1 · varianta 3', category: 'bacalaureat', subcategory: 'variante', content_type: 'pdf', profile: 'mate-info', sort_order: 1 }),
];
const CLS = [
  c({ id: 'c7-i1', title: 'Cl. 7 · interactiv 1', category: 'clasa-7', content_type: 'interactive', sort_order: 1 }),
  c({ id: 'c7-i2', title: 'Cl. 7 · interactiv 2', category: 'clasa-7', content_type: 'interactive', sort_order: 2 }),
  c({ id: 'c7-p1', title: 'Cl. 7 · fișă 1', category: 'clasa-7', content_type: 'pdf', sort_order: 1 }),
  c({ id: 'c6-i1', title: 'Cl. 6 · interactiv 1', category: 'clasa-6', content_type: 'interactive', sort_order: 1 }),
  c({ id: 'c6-p1', title: 'Cl. 6 · fișă 1', category: 'clasa-6', content_type: 'pdf', sort_order: 1 }),
  c({ id: 'c5-i1', title: 'Cl. 5 · interactiv 1', category: 'clasa-5', content_type: 'interactive', sort_order: 1 }),
  c({ id: 'c8-i1', title: 'Cl. 8 · interactiv 1', category: 'clasa-8', content_type: 'interactive', sort_order: 1 }),
  c({ id: 'c7-bar', title: 'Barem fișa 1', category: 'clasa-7', content_type: 'pdf', sort_order: 9 }),
  c({ id: 'c7-man', title: 'Manual digital', category: 'clasa-7', content_type: 'manual', sort_order: 0 }),
];

function baza({ continut = [...EN, ...BAC, ...CLS], progress = [], plan = {}, tinta = null, faraColoana = false } = {}) {
  const stats = { user_id: U, total_xp: 0, coins: 0, streak_current: 0, streak_best: 0, freezes: 0, league_tier: 1, prep_exam: tinta };
  if (!faraColoana) stats.prep_plan = plan;
  const supa = createFakeSupabase({
    content: continut.map((r) => ({ ...r })),
    user_stats: [stats],
    profiles: [{ id: U, full_name: 'Ana Maria Popescu' }],
    daily_tests: [], progress: progress.map((r) => ({ user_id: U, ...r })), xp_events: [], user_badges: [], arena_feed: [],
  });
  supa.db.unique = { daily_tests: [['user_id', 'day']], user_badges: [['user_id', 'badge_id']], arena_feed: [['dedupe_key']] };
  return supa;
}
const stats = (supa) => supa.db.tables.user_stats.find((x) => x.user_id === U);
const randAzi = (supa) => supa.db.tables.daily_tests.find((r) => r.user_id === U && r.day === AZI);
const ids = (v) => v.noduri.map((n) => n.id);
const nod = (v, id) => v.noduri.find((n) => n.id === id);
const plan = (supa, profile = PREMIUM, tinta = TINTA_EN) => PL.stare(supa, U, { tinta, stats: stats(supa), premium: profile.subscription_status === 'active', azi: AZI });

// ═══════════════════════════ 1) etapele și ordinea ═══════════════════════════

test('EN: capitole → exerciții pe subiecte → teste interactive, apoi PDF (capitole, subiecte, variante, simulări) — fără bareme', () => {
  const et = PL.etape(TINTA_EN);
  assert.deepStrictEqual(et.map((e) => e.id), ['capitole', 'subiecte', 'teste', 'pdf-capitole', 'pdf-subiecte', 'pdf-variante', 'pdf-simulari']);
  assert.deepStrictEqual(et.slice(0, 3).map((e) => e.tip), ['interactive', 'interactive', 'interactive']);
  assert.ok(et.slice(3).every((e) => e.tip === 'pdf'));
  assert.strictEqual(et[1].subcategory, 'exercitii-subiecte');
  const rows = [...EN].sort((a, b) => a.sort_order - b.sort_order);
  const n = PL.construiesteNoduri(rows, et);
  assert.deepStrictEqual(n.map((x) => x.id), ['en-cap-1', 'en-cap-2', 'en-sub-1', 'en-sub-2', 'en-test-1', 'en-cap-pdf', 'en-var-1', 'en-sim-1'],
    'ordinea din site, fără barem și fără subcategoriile care nu apar pe pagină');
});

test('BAC: „Capitole" comune tuturor profilurilor, apoi doar profilul ales; PDF-urile cu „teste de antrenament"', () => {
  const t = P.tintaInfo('bac-mate-info');
  const et = PL.etape(t);
  assert.deepStrictEqual(et.map((e) => e.id), ['capitole', 'subiecte', 'teste', 'pdf-capitole', 'pdf-subiecte', 'pdf-variante', 'pdf-antrenament', 'pdf-simulari']);
  assert.strictEqual(et[1].subcategory, 'exercitii');
  const n = PL.construiesteNoduri(BAC, et).map((x) => x.id);
  assert.deepStrictEqual(n, ['bac-cap', 'bac-mi-ex', 'bac-mi-test', 'bac-mi-var', 'bac-mi-antr']);
  assert.ok(!n.includes('bac-sn-ex'), 'exercițiile altui profil nu intră');
});

test('clasa aleasă: interactivele ei, apoi ale claselor dinainte, apoi PDF-urile (aceeași ordine); fără bareme și manuale', () => {
  const t = P.tintaInfo('clasa-7');
  assert.strictEqual(t.tip, 'clasa');
  assert.deepStrictEqual(PL.categorii(t), ['clasa-7', 'clasa-6', 'clasa-5']);
  const et = PL.etape(t);
  assert.deepStrictEqual(et.map((e) => e.id), ['c7-int', 'c6-int', 'c5-int', 'c7-pdf', 'c6-pdf', 'c5-pdf']);
  assert.strictEqual(et[0].titlu, 'Clasa a VII-a · exerciții interactive');
  const n = PL.construiesteNoduri(CLS, et).map((x) => x.id);
  assert.deepStrictEqual(n, ['c7-i1', 'c7-i2', 'c6-i1', 'c5-i1', 'c7-p1', 'c6-p1']);
  assert.deepStrictEqual(PL.etape(P.tintaInfo('clasa-5')).map((e) => e.id), ['c5-int', 'c5-pdf']);
  assert.strictEqual(PL.etape(P.tintaInfo('clasa-12')).length, 16, 'a XII-a: 8 clase × (interactive + PDF)');
  assert.deepStrictEqual(PL.etape(null), []);
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

test('pasul curent: primul netrecut; pașii de după încuiați (cei lucrați din site rămân deschiși); sărirea doar după 3 încercări', () => {
  const noduri = ['a', 'b', 'c', 'd'].map((id) => ({ id, tip: 'interactive', gratuit: true, etapa: 'x' }));
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

test('fără abonament: pașii Premium și testele PDF apar cu ⭐ și nu opresc planul; cu Premium, toate', () => {
  const noduri = [
    { id: 'g1', tip: 'interactive', gratuit: true }, { id: 'p1', tip: 'interactive', gratuit: false },
    { id: 'g2', tip: 'interactive', gratuit: true }, { id: 'f1', tip: 'pdf', gratuit: true },
  ].map((n) => ({ ...n, etapa: 'x' }));
  const prog = new Map([['g1', { score: 100, max_score: 100, attempts: 1 }]]);
  const r = PL.calculeaza(noduri, prog, { premium: false });
  assert.strictEqual(r.curent, 2, 'sare peste pasul Premium');
  assert.deepStrictEqual(r.noduri.map((n) => n.accesibil), [true, false, true, false]);
  const v = PL.vedere(PL.calculeaza(noduri, new Map([['g1', { score: 1, max_score: 1, attempts: 1 }], ['g2', { score: 1, max_score: 1, attempts: 1 }]]), { premium: false }), [{ id: 'x', titlu: 'X', tip: 'interactive' }], { premium: false });
  assert.strictEqual(v.terminat, true, 'tot ce e gratuit e gata');
  assert.strictEqual(v.ramasePremium, 2);
  assert.strictEqual(PL.calculeaza(noduri, prog, { premium: true }).curent, 1);
});

// ═══════════════════════════ 3) cu baza de date ═══════════════════════════

test('harta EN din site: pașii în ordine, etapele cu numărători, pasul curent cu adresa (🗺️ &plan=1); PDF-ul cu cele 4 moduri', async () => {
  const supa = baza({ tinta: 'evaluare-nationala', progress: [
    { content_id: 'en-cap-1', score: 80, max_score: 100, attempts: 1 },
    { content_id: 'en-cap-2', score: 30, max_score: 100, attempts: 1 },
  ] });
  const v = await plan(supa);
  assert.deepStrictEqual(ids(v), ['en-cap-1', 'en-cap-2', 'en-sub-1', 'en-sub-2', 'en-test-1', 'en-cap-pdf', 'en-var-1', 'en-sim-1']);
  assert.deepStrictEqual([v.total, v.trecute, v.curent, v.procent], [8, 1, 1, 13]);
  assert.deepStrictEqual(v.etape.map((e) => [e.id, e.total, e.trecute]), [['capitole', 2, 1], ['subiecte', 2, 0], ['teste', 1, 0], ['pdf-capitole', 1, 0], ['pdf-variante', 1, 0], ['pdf-simulari', 1, 0]],
    'etapele goale (exerciții pe subiecte · PDF) nu apar');
  assert.ok(v.etape[0].curenta);
  assert.deepStrictEqual([v.pas.id, v.pas.nr, v.pas.stare, v.pas.incercari, v.pas.incercariRamase, v.pas.poateSari], ['en-cap-2', 2, 'incercat', 1, 2, false]);
  assert.strictEqual(v.pas.url, '/exercitiu?id=en-cap-2&pregatire=1&plan=1');
  assert.strictEqual(nod(v, 'en-sub-1').deschis, false, 'încuiat până trece pasul curent');
  assert.deepStrictEqual(stats(supa).prep_plan.trecute, ['en-cap-1'], 'pasul trecut e ținut minte');
  assert.strictEqual(stats(supa).prep_plan.start, AZI);
  assert.strictEqual(stats(supa).prep_plan.tinta, 'evaluare-nationala');
  // la PDF: „pe PDF", „în chat", „foaia de lucru", „cu poza"
  const toate = baza({ tinta: 'evaluare-nationala', progress: ['en-cap-1', 'en-cap-2', 'en-sub-1', 'en-sub-2', 'en-test-1'].map((id) => ({ content_id: id, score: 9, max_score: 10, attempts: 1 })) });
  const vp = await plan(toate);
  assert.strictEqual(vp.pas.id, 'en-cap-pdf');
  assert.deepStrictEqual(vp.pas.moduri.map((m) => m.mod), ['pdf', 'chat', 'foaie', 'poza']);
  assert.strictEqual(vp.pas.moduri[1].url, '/pdf-viewer?id=en-cap-pdf&pregatire=1&plan=1&mod=chat');
});

test('„harta se actualizează": un exercițiu nou apare la locul lui, cu „nou" (adăugat după începutul planului); unul dinainte devine pasul curent', async () => {
  const supa = baza({ tinta: 'evaluare-nationala', plan: { start: '2026-11-01', tinta: 'evaluare-nationala', trecute: ['en-cap-1', 'en-cap-2'] }, progress: [
    { content_id: 'en-cap-1', score: 9, max_score: 10, attempts: 1 }, { content_id: 'en-cap-2', score: 9, max_score: 10, attempts: 1 },
  ] });
  let v = await plan(supa);
  assert.strictEqual(v.pas.id, 'en-sub-1');
  supa.db.tables.content.push(c({ id: 'en-cap-nou', title: 'Puteri — interactiv (nou)', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'interactive', sort_order: 3, created_at: '2026-11-10T09:00:00Z' }));
  v = await plan(supa);
  assert.deepStrictEqual(ids(v).slice(0, 3), ['en-cap-1', 'en-cap-2', 'en-cap-nou']);
  assert.strictEqual(nod(v, 'en-cap-nou').nou, true);
  assert.strictEqual(nod(v, 'en-cap-1').nou, false);
  assert.deepStrictEqual([v.pas.id, v.pas.nou], ['en-cap-nou', true], 'exercițiul nou din capitolele deja parcurse e următorul pas');
});

test('„⏭ Treci mai departe": doar pe pasul curent, după 3 încercări; apoi planul continuă; fără coloana prep_plan → cere migrarea', async () => {
  const supa = baza({ tinta: 'evaluare-nationala', progress: [
    { content_id: 'en-cap-1', score: 20, max_score: 100, attempts: 2 },
  ] });
  const t = TINTA_EN;
  let r = await PL.sari(supa, U, { contentId: 'en-cap-1', tinta: t, stats: stats(supa), premium: true });
  assert.match(r.error, /după 3 încercări \(mai ai una\)/);
  r = await PL.sari(supa, U, { contentId: 'en-cap-2', tinta: t, stats: stats(supa), premium: true });
  assert.match(r.error, /doar de la pasul la care ai ajuns/);
  supa.db.tables.progress[0].attempts = 3;
  const v3 = await plan(supa);
  assert.deepStrictEqual([v3.pas.poateSari, nod(v3, 'en-cap-1').poateSari, nod(v3, 'en-cap-2').poateSari], [true, true, false], 'și pe hartă');
  r = await PL.sari(supa, U, { contentId: 'en-cap-1', tinta: t, stats: stats(supa), premium: true });
  assert.deepStrictEqual(r, { ok: true });
  assert.deepStrictEqual(stats(supa).prep_plan.sarite, ['en-cap-1']);
  const v = await plan(supa);
  assert.deepStrictEqual([nod(v, 'en-cap-1').stare, v.pas.id, v.sarite], ['sarit', 'en-cap-2', 1]);
  assert.strictEqual(nod(v, 'en-cap-1').deschis, true, 'pasul sărit se poate relua oricând');
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

test('ținta poate fi o clasă: alegerea, harta clasei (a VII-a, apoi a VI-a, a V-a), testul zilei = pasul curent', async () => {
  const supa = baza();
  const r = await P.alege(supa, U, ELEV, { examen: 'clasa-7' });
  assert.strictEqual(r.ok, true);
  const s = r.pregatire;
  assert.deepStrictEqual(s.examen, { id: 'clasa-7', label: 'Clasa a VII-a', scurt: 'Cl. VII', tip: 'clasa' });
  assert.strictEqual(s.clase.length, 8);
  assert.deepStrictEqual(ids(s.plan), ['c7-i1', 'c7-i2', 'c6-i1', 'c5-i1', 'c7-p1', 'c6-p1']);
  assert.strictEqual(s.plan.ramasePremium, 2, 'fără abonament, fișele PDF au ⭐');
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
  assert.strictEqual(s.plan.trecute, 1);
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
