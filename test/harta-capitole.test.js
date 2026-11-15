// =====================================================================
// test/harta-capitole.test.js — „🗺️ Harta pregătirii" pe CAPITOLE, cu pictograme,
// cu liga, la elev, la părinți și la profesori (15 nov. 2026):
//   „Hărți cu pictograme, împărțită pe capitole, la fiecare capitol mai mulți pași.
//    Dacă adaug PDF cu numele capitolului să îl adauge în plus la capitolul din hartă
//    ca un pas în plus. Elevul să vadă progresul pe capitole, dar și pe ligă. Acest
//    progres să apară și la părinți și profesori în rezultate dar și ca un card separat."
//
// api/_lib/capitoleHarta.js (capitolul după titlu), api/_lib/planPregatire.js (pașii pe
// capitole, „Fișe pe capitole", capitolele cu numărătorile lor), api/_lib/barem.js
// (fișele: baremul după titlu), api/_lib/pregatireZilnica.js (ligiElevi, hartaScurt),
// api/teacher-students.js (liga; mode: 'harti'), paginile (Home, Rezultate, cardul separat).
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
const CH = require('../api/_lib/capitoleHarta');
const PL = require('../api/_lib/planPregatire');
const P = require('../api/_lib/pregatireZilnica');
const B = require('../api/_lib/barem');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const cap = (titlu, cat) => (CH.capitolDin(titlu, cat) || { id: null }).id;

// ═══════════════════════════ 1) capitolul, după titlu ═══════════════════════════

test('fiecare capitol își recunoaște propriul nume (un PDF numit după capitol ajunge mereu în el)', () => {
  const liste = [
    ...[5, 6, 7, 8].map((g) => [`clasa-${g}`, CH.CLASA[g]]),
    ['evaluare-nationala', CH.EN], ['bacalaureat', CH.BAC], ['clasa-10', CH.BAC],
  ];
  for (const [cat, lista] of liste) {
    for (const c of lista) {
      assert.strictEqual(cap(c.titlu, cat), c.id, `${cat}: „${c.titlu}"`);
      assert.strictEqual(cap(`${c.titlu} — fișa 13`, cat), c.id, `${cat}: „${c.titlu} — fișa 13"`);
    }
    assert.strictEqual(new Set(lista.map((c) => c.id)).size, lista.length, `${cat}: id-uri unice`);
  }
});

test('capitolele titlurilor din site (clase, EN, BAC); ce nu se recunoaște → null („Alte …")', () => {
  const cazuri = [
    ['Mulțimea numerelor întregi — adunarea', 'clasa-6', 'c6-intregi'],
    ['Numere întregi — fișa 13', 'clasa-6', 'c6-intregi'],
    ['Mărimi direct proporționale', 'clasa-6', 'c6-rapoarte'],        // „proporționale" nu e „raționale"
    ['Numere raționale pozitive', 'clasa-6', 'c6-rationale'],
    ['Teorema lui Thales', 'clasa-7', 'c7-asemanare'],
    ['Radicali — scoaterea factorilor de sub radical', 'clasa-7', 'c7-reale'],
    ['Ecuația de gradul al II-lea', 'clasa-8', 'c8-ecuatia2'],
    ['Piramida patrulateră regulată', 'clasa-8', 'c8-corpuri'],
    ['Fracții zecimale', 'clasa-5', 'c5-zecimale'],
    ['Metoda mersului invers', 'clasa-5', 'c5-metode'],
    ['ALGEBRĂ - Fișă 4: Proporții', 'evaluare-nationala', 'en-rapoarte'],
    ['Numere reale — calcul cu radicali', 'evaluare-nationala', 'en-reale'],
    ['Probabilități', 'evaluare-nationala', 'en-date'],
    ['Polinoame', 'bacalaureat', 'bac-polinoame'],
    ['Matrice și determinanți', 'bacalaureat', 'bac-matrice'],
    ['Numere complexe — forma algebrică', 'bacalaureat', 'bac-complexe'],
    ['Analiză matematică — derivate', 'clasa-11', 'bac-analiza'],
    ['Analiză matematică', 'clasa-12', 'bac-integrale'],              // la a XII-a, analiza = integralele
    ['Recapitulare finală', 'clasa-6', null],
    ['Test de evaluare inițială', 'evaluare-nationala', null],
  ];
  for (const [t, cat, id] of cazuri) assert.strictEqual(cap(t, cat), id, `${cat}: „${t}"`);
  assert.deepStrictEqual([CH.subiectDin('Subiectul al II-lea, ex. 3'), CH.subiectDin('subiectul III'), CH.subiectDin('Fracții')], [2, 3, null]);
  assert.deepStrictEqual([CH.anDin('EN 2025 — varianta 1'), CH.anDin('Simulare', 'x/ENVIII_Matematica_2024_var_07.pdf'), CH.anDin('Teză 2025-2026'), CH.anDin('Fără an')], ['2025', '2024', '2026', null]);
});

// ═══════════════════════════ 2) pașii pe capitole; PDF-ul numit după capitol ═══════════════════════════

let ord = 0;
const c = (o) => ({ is_free: true, profile: null, subcategory: null, file_url: `x/${o.id}.pdf`, sort_order: ++ord, created_at: '2026-10-01T10:00:00Z', ...o });
const CL6 = [
  c({ id: 'i1', title: 'Numere întregi — adunarea', category: 'clasa-6', content_type: 'interactive' }),
  c({ id: 'i2', title: 'Triunghiul — interactiv', category: 'clasa-6', content_type: 'interactive' }),
  c({ id: 'i3', title: 'Recapitulare finală', category: 'clasa-6', content_type: 'interactive' }),
  c({ id: 'i4', title: 'Numere întregi — înmulțirea', category: 'clasa-6', content_type: 'interactive' }),
  c({ id: 'i5', title: 'Cercul', category: 'clasa-6', content_type: 'interactive' }),
  c({ id: 'p1', title: 'Numere întregi — fișa 13', category: 'clasa-6', content_type: 'pdf' }),
  c({ id: 'p2', title: 'Fișă recapitulativă', category: 'clasa-6', content_type: 'pdf' }),
];

test('clasa: pașii stau pe capitole — capitolele în ordinea primului lor exercițiu din site, „Alte exerciții" la sfârșit', () => {
  const lista = PL.etape({ tip: 'clasa', clasa: 6 });
  const n = PL.construiesteNoduri(CL6, lista, { cuBarem: new Set() }).filter((x) => x.harta === 'interactiv');
  assert.deepStrictEqual(n.map((x) => x.id), ['i1', 'i4', 'i2', 'i5', 'i3']);
  assert.deepStrictEqual([...new Set(n.map((x) => x.capTitlu))], ['Numere întregi', 'Triunghiul', 'Cercul', 'Alte exerciții']);
  assert.deepStrictEqual(n.map((x) => x.capIcon), ['intregi', 'intregi', 'triunghi', 'cerc', 'alte']);
});

test('PDF numit după capitol, cu barem → pas în plus la capitolul lui (harta PDF a clasei); fără barem — nu', () => {
  const lista = PL.etape({ tip: 'clasa', clasa: 6 });
  let n = PL.construiesteNoduri(CL6, lista, { cuBarem: new Set(['p1']) }).filter((x) => x.harta === 'pdf');
  assert.deepStrictEqual(n.map((x) => [x.id, x.capTitlu, x.capIcon]), [['p1', 'Numere întregi', 'intregi']]);
  n = PL.construiesteNoduri(CL6, lista, { cuBarem: new Set() }).filter((x) => x.harta === 'pdf');
  assert.deepStrictEqual(n, [], 'regula hărții PDF rămâne: doar cu barem');
});

test('examen: fișele PDF pe capitole (cu barem, recunoscute pe un capitol) — etapa „Fișe pe capitole"; PLAN_PDF_CAPITOLE=0 o oprește', () => {
  const EN = [
    c({ id: 'e-int', title: 'Numere întregi — interactiv', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'interactive' }),
    c({ id: 'e-f1', title: 'Numere întregi — fișa 2', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'pdf' }),
    c({ id: 'e-f2', title: 'Fișă de lucru', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'pdf' }),
    c({ id: 'e-f3', title: 'Cercul — fișa 1', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'pdf' }),
    c({ id: 'e-v1', title: 'EN 2025 — varianta 1', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf' }),
  ];
  const tinta = { tip: 'examen', category: 'evaluare-nationala', profile: null };
  const n = PL.construiesteNoduri(EN, PL.etape(tinta), { cuBarem: new Set(['e-f1', 'e-f2', 'e-v1']) }).filter((x) => x.harta === 'pdf');
  assert.deepStrictEqual(n.map((x) => [x.id, x.etapa, x.capTitlu]), [
    ['e-f1', 'pdf-capitole', 'Numere întregi'],   // fișa 2 are barem și e pe un capitol
    ['e-v1', 'pdf-variante', 'Anul 2025'],        // subiectele de examen — pe ani
  ], 'fără barem (Cercul) sau fără capitol (Fișă de lucru) — nu intră');
  process.env.PLAN_PDF_CAPITOLE = '0';
  try {
    assert.ok(!PL.etape(tinta).some((e) => e.id === 'pdf-capitole'));
  } finally { delete process.env.PLAN_PDF_CAPITOLE; }
});

test('capitolele unei hărți: câți pași, câți trecuți / săriți, „gata", capitolul pasului curent; rezumatul — fără pași', () => {
  const lista = PL.etape({ tip: 'clasa', clasa: 6 }).filter((e) => e.harta === 'interactiv');
  const noduri = PL.construiesteNoduri(CL6, lista, { cuBarem: new Set() });
  const progres = new Map([
    ['i1', { score: 9, max_score: 10, attempts: 1 }], ['i4', { score: 8, max_score: 10, attempts: 1 }],
    ['i2', { score: 2, max_score: 10, attempts: 1 }],
  ]);
  const h = PL.calculeaza(noduri, progres, { premium: true });
  const v = PL.vedereHarta(h, lista, { premium: true });
  assert.deepStrictEqual(v.capitole.map((x) => [x.titlu, x.total, x.trecute, x.gata, x.curent]), [
    ['Numere întregi', 2, 2, true, false], ['Triunghiul', 1, 0, false, true], ['Cercul', 1, 0, false, false], ['Alte exerciții', 1, 0, false, false],
  ]);
  assert.deepStrictEqual(v.pas.capitol, { id: v.capitole[1].id, titlu: 'Triunghiul', icon: 'triunghi', total: 1, trecute: 0 });
  assert.deepStrictEqual(v.noduri.map((x) => x.k), [0, 0, 1, 2, 3], 'fiecare pas știe capitolul lui (k)');
  const r = PL.rezumat({ tinta: null, interactiv: v, pdf: null, reguli: {} });
  assert.strictEqual(r.interactiv.pas.capitol, 'Triunghiul');
  assert.deepStrictEqual(Object.keys(r.interactiv.capitole[0]).sort(), ['curent', 'etapa', 'gata', 'icon', 'sarite', 'titlu', 'total', 'trecute']);
});

// ═══════════════════════════ 3) fișele: baremul după titlu ═══════════════════════════

test('fișe: baremul se leagă după titlu (aceleași cuvinte, aceleași numere); ambiguu sau alt număr → niciunul', () => {
  const fisa = { id: 'f4', title: 'ALGEBRĂ - Fișă 4: Proporții', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'pdf' };
  const b4 = { id: 'b4', title: 'Barem — ALGEBRĂ - Fișă 4: Proporții', category: 'evaluare-nationala', subcategory: 'bareme', content_type: 'pdf' };
  const b5 = { id: 'b5', title: 'Barem — ALGEBRĂ - Fișă 5: Proporții', category: 'evaluare-nationala', subcategory: 'bareme', content_type: 'pdf' };
  const sim = { id: 'sim', title: '2026 barem simulare Suceava (ianuarie)', category: 'evaluare-nationala', subcategory: 'bareme', content_type: 'pdf' };
  assert.strictEqual(B.esteFisa(fisa), true);
  assert.strictEqual(B.esteFisa({ category: 'evaluare-nationala', subcategory: 'variante' }), false, 'subiectele oficiale nu sunt fișe');
  assert.strictEqual(B.esteFisa({ category: 'clasa-6', subcategory: null }), true);
  let r = B.matchBaremByTitle(fisa, [sim, b5, b4]);
  assert.deepStrictEqual([r.status, r.barem && r.barem.id], ['ok', 'b4']);
  r = B.matchBaremByTitle(fisa, [sim, b5]);
  assert.deepStrictEqual([r.status, r.barem], ['negasit', null], 'baremul fișei 5 sau al unei simulări — nu');
  r = B.matchBaremByTitle(fisa, [b4, { ...b4, id: 'b4bis' }]);
  assert.strictEqual(r.status, 'ambiguu');
});

test('fișe: o potrivire automată veche, făcută pe conținut, nu mai e de încredere; cea după titlu / a adminului — da', () => {
  const fisa = { id: 'f4', title: 'Fișă 4', category: 'evaluare-nationala', subcategory: 'capitole' };
  const subiect = { id: 'v1', title: 'EN 2025 varianta 1', category: 'evaluare-nationala', subcategory: 'variante' };
  const veche = { barem_status: 'ok_continut', barem_id: 'sim', barem: { matchedBy: 'continut' } };
  assert.strictEqual(B.baremCacheValid(fisa, veche), false);
  assert.strictEqual(B.baremCacheValid(fisa, { ...veche, barem: JSON.stringify({ matchedBy: 'titlu' }) }), true);
  assert.strictEqual(B.baremCacheValid(fisa, { ...veche, barem_override_id: 'b4' }), true, 'baremul ales de admin rămâne');
  assert.strictEqual(B.baremCacheValid(subiect, veche), true, 'la subiectele oficiale — ca înainte');
  assert.match(read('api/ai-pdf-context.js'), /if \(!B\.baremCacheValid\(content, data\)\) return null;/);
});

// ═══════════════════════════ 4) liga elevilor (profesori / părinți) ═══════════════════════════

const ANA = '11111111-1111-4111-8111-111111111111';
const DAN = '22222222-2222-4222-8222-222222222222';
const IOANA = '33333333-3333-4333-8333-333333333333';
function bazaLiga() {
  const supa = createFakeSupabase({
    user_stats: [
      { user_id: ANA, league_tier: 2, total_xp: 1500 }, { user_id: DAN, league_tier: 2, total_xp: 40 }, { user_id: IOANA, league_tier: 1, total_xp: 0 },
    ],
    league_seasons: [{ id: 's1', week_start: xp.weekStart() }],
    league_standings: [
      { season_id: 's1', user_id: ANA, tier: 2, cohort: 1, points: 120, updated_at: '2026-11-10T10:00:00Z' },
      { season_id: 's1', user_id: DAN, tier: 2, cohort: 1, points: 30, updated_at: '2026-11-10T11:00:00Z' },
      { season_id: 's1', user_id: 'altcineva', tier: 2, cohort: 1, points: 80, updated_at: '2026-11-10T12:00:00Z' },
    ],
  });
  return supa;
}

test('ligiElevi: divizia, punctele, locul în grupa de ligă, zona de promovare, nivelul — și fără clasament (doar divizia)', async () => {
  const supa = bazaLiga();
  const l = await P.ligiElevi(supa, [ANA, DAN, IOANA, 'fara-statistici']);
  const t2 = xp.tierInfo(2), t1 = xp.tierInfo(1);
  assert.deepStrictEqual([l[ANA].nume, l[ANA].icon, l[ANA].puncte, l[ANA].loc, l[ANA].membri, l[ANA].zona], [t2.name, t2.icon, 120, 1, 3, 'promovare']);
  assert.deepStrictEqual([l[DAN].loc, l[DAN].puncte], [3, 30]);
  assert.strictEqual(l[DAN].zona, xp.PROMOTE_TOP >= 3 ? 'promovare' : null);
  assert.deepStrictEqual([l[IOANA].nume, l[IOANA].loc, l[IOANA].puncte], [t1.name, null, 0], 'încă nu a intrat în liga săptămânii');
  assert.strictEqual(l[ANA].nivel.level, xp.levelOf(1500).level);
  assert.ok(!('fara-statistici' in l));
  // tabelele ligii lipsesc → doar divizia din user_stats
  const fara = bazaLiga();
  fara.db.failTables.add('league_seasons');
  const l2 = await P.ligiElevi(fara, [ANA]);
  assert.deepStrictEqual([l2[ANA].nume, l2[ANA].loc], [t2.name, null]);
});

test('api/teacher-students: fiecare elev are `liga`; mode: \'harti\' → doar hărțile și liga (fără email, fără rezultate)', async () => {
  const supa = bazaLiga();
  supa.db.tables.profiles = [
    { id: 'prof', role: 'profesor', full_name: 'Ion Ionescu' },
    { id: ANA, role: 'elev', full_name: 'Ana Pop', email: 'ana@example.com' },
    { id: DAN, role: 'elev', full_name: 'Dan Rusu', email: 'dan@example.com' },
  ];
  supa.db.tables.mentor_students = [{ mentor_id: 'prof', student_id: ANA, group_id: null }, { mentor_id: 'prof', student_id: DAN, group_id: null }];
  supa.db.tables.mentor_groups = [];
  supa.db.tables.progress = [];
  supa.db.tables.content = [];
  supa.db.tables.daily_tests = [];
  const sbPath = require.resolve('@supabase/supabase-js');
  const httpLib = require('../api/_lib/http');
  const vechi = { sb: require.cache[sbPath], authUser: httpLib.authUser };
  require.cache[sbPath] = { id: sbPath, filename: sbPath, loaded: true, exports: { createClient: () => supa } };
  delete require.cache[require.resolve('../api/teacher-students.js')];
  httpLib.authUser = async () => 'prof';
  try {
    const students = require('../api/teacher-students.js');
    const call = async (body) => { const res = fakeRes(); await students({ method: 'POST', headers: { authorization: 'Bearer x' }, body: { userId: 'prof', ...body } }, res); return res; };
    let r = await call({});
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.students.find((s) => s.id === ANA).liga.loc, 1);
    r = await call({ mode: 'harti' });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.mode, 'harti');
    const ana = r.body.students.find((s) => s.id === ANA);
    assert.deepStrictEqual([ana.liga.puncte, ana.plan, 'email' in ana], [120, null, false]);
  } finally {
    if (vechi.sb) require.cache[sbPath] = vechi.sb; else delete require.cache[sbPath];
    httpLib.authUser = vechi.authUser;
    delete require.cache[require.resolve('../api/teacher-students.js')];
  }
});

// ═══════════════════════════ 5) paginile ═══════════════════════════

test('harta elevului: capitole cu pictograme (inelul de progres), șirul capitolelor; liga lângă hartă', () => {
  const h = read('src/components/HartaPlan.jsx');
  assert.match(h, /import \{ Pictograma, InelCapitol, CSS_INEL \} from '\.\.\/lib\/pictograme';|InelCapitol/);
  assert.match(h, /export default function HartaPlan\(\{ plan, alesId = null, onAlege = \(\) => \{\}, legenda = true \}\)/);
  const pic = read('src/lib/pictograme.jsx');
  for (const k of new Set([...Object.values(CH.CLASA).flat(), ...CH.EN, ...CH.BAC].map((x) => x.icon))) {
    assert.ok(new RegExp(`\\b${k}\\s*:`).test(pic), `pictograma „${k}" e desenată`);
  }
  const pg = read('src/pages/PregatesteMa.jsx');
  assert.match(pg, /<LigaCard a=\{arena\} \/>/);
  assert.match(pg, /LigaScurt/);
  const home = read('src/pages/Home.jsx');
  assert.match(home, /aiClient\.gamificare\(\{ action: 'harta_scurt' \}\)/);
  assert.match(home, /\{inceput && <HartaPeScurt h=\{harta\} liga=\{liga\} \/>\}/);
  assert.match(read('api/gamificare.js'), /action === 'harta_scurt'/);
});

test('părinți și profesori: progresul pe capitole și liga — în „Rezultate" ȘI în cardul separat (Rezultate + Home)', () => {
  const tr = read('src/components/TeacherResults.jsx');
  assert.match(tr, /import HartaEleviCard from '\.\/HartaEleviCard';/);
  assert.match(tr, /\{!loading && !error && <HartaEleviCard elevi=\{studentsAll\} rol=\{role\} \/>\}/);
  assert.ok(tr.indexOf('<HartaEleviCard') < tr.indexOf('id="rezultate-elevi"'), 'cardul separat stă deasupra rezultatelor');
  const rz = read('src/components/HartaPlanRezumat.jsx');
  assert.match(rz, /export function PlanChip\(\{ plan, liga = null, style \}\)/);
  assert.match(rz, /export default function HartaPlanRezumat\(\{ plan, liga = null, nume = 'Elevul' \}\)/);
  assert.match(rz, /<InelePeHarta capitole=\{caps\} \/>/);
  const card = read('src/components/HartaEleviCard.jsx');
  assert.match(card, /body: JSON\.stringify\(\{ mode: 'harti' \}\)/);
  assert.match(card, /export function HartaEleviAcasa\(\{ rol = 'profesor' \}\)/);
  const a = read('src/components/AcasaCont.jsx');
  assert.match(a, /<HartaEleviAcasa rol="parinte" \/>/);
  assert.match(a, /<HartaEleviAcasa rol="profesor" \/>/);
  const elev = a.slice(a.indexOf('export function AcasaElev'), a.indexOf('export function AcasaParinte'));
  assert.ok(!elev.includes('HartaEleviAcasa'), 'elevul își vede harta în cardul mare „Pregătește-mă"');
});
