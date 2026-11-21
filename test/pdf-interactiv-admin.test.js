// =====================================================================
// test/pdf-interactiv-admin.test.js — Admin → „🔗 PDF ↔ Interactiv" și asocierea automată
// (21 nov. 2026): „1) fă în admin o rubrică în care pot asocia manual un PDF de un test
// interactiv. Fă ca PDF-urile să se asocieze automat cu un test interactiv generat după modelul
// lui. 2) la viewer-ul PDF redenumește «Rezolvă pe PDF» în «Rezolvă». La PDF-uri redenumește
// «deschide/descarcă» în «deschide PDF», iar «interactiv» în «deschide interactiv»."
//
// api/_lib/pdfTestPotrivire.js (potrivirea, pură), api/content-admin.js (perechi / asociaza /
// asociaza_lot / dezleaga), src/components/AdminPdfInteractiv.jsx, src/pages/Admin.jsx,
// src/components/AIExerciseAgent.jsx, api/ai-exercise-agent.js, src/pages/PDFViewer.jsx.
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const P = require('../api/_lib/pdfTestPotrivire');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// ═══════════════════════════ potrivirea după titlu ═══════════════════════════
test('tokeni(): fără tipul materialului, examen, profil și clasă; numerele fără zerouri; subiectul separat', () => {
  assert.deepStrictEqual(P.tokeni('BAC 2014 tehnologic v1'), { cuvinte: ['varianta'], numere: ['2014', '1'], subiecte: [] });
  assert.deepStrictEqual(P.tokeni('BAC 2021 · Matematică M_tehnologic · Varianta 02 — rezolvare interactivă'), { cuvinte: ['varianta'], numere: ['2021', '2'], subiecte: [] });
  assert.deepStrictEqual(P.tokeni('Fișă 9 — Metoda mersului invers (clasa a V-a)'), { cuvinte: ['metoda', 'mersului', 'invers'], numere: ['9'], subiecte: [] });
  assert.deepStrictEqual(P.tokeni('SUBIECTUL II, EX. 5: Cercul'), { cuvinte: ['cercul'], numere: ['5'], subiecte: ['2'] });
  assert.deepStrictEqual(P.tokeni('Subiectul al III-lea, ex. 2 · Primitive'), { cuvinte: ['primitive'], numere: ['2'], subiecte: ['3'] });
  assert.deepStrictEqual(P.tokeni('Mediana în triunghi — clasa a 6-a'), { cuvinte: ['mediana', 'triunghi'], numere: [], subiecte: [] });
  assert.deepStrictEqual(P.tokeni(''), { cuvinte: [], numere: [], subiecte: [] });
});

test('scorTitluri(): perechile reale din bază (generatorul, încărcările) — aceleași teste ies 1, cele vecine mult mai jos', () => {
  const s = P.scorTitluri;
  // BAC: varianta cu zero în față, profilul în titlul testului
  assert.strictEqual(s('BAC 2021 · Matematică M_tehnologic · Varianta 2 — rezolvare interactivă', '2021 Varianta 02'), 1);
  assert.strictEqual(s('BAC 2021 · Matematică M_tehnologic · Varianta 2 — rezolvare interactivă', '2021 Varianta 03'), 0.75);
  assert.strictEqual(s('BAC 2014 tehnologic v1', '2014 Varianta 01'), 1);
  assert.strictEqual(s('BAC 2026 · M mate-info · Varianta 7 — rezolvare interactivă', '2026 mate-info varianta 07'), 1);
  // clasele: „Fișa N - BAC: …", „GEOMETRIE - Fișă N: …"
  assert.strictEqual(s('Ecuații logaritmice · Rezolvare interactivă', 'Fișa 5 - BAC: Ecuații logaritmice'), 1);
  assert.strictEqual(s('Ecuații logaritmice · Rezolvare interactivă', 'Fișa 6 - BAC: Ecuații exponențiale'), 0.5);
  assert.strictEqual(s('Fișă 9 — Metoda mersului invers (clasa a V-a)', 'Fișă 9: Metoda mersului invers'), 1);
  assert.strictEqual(s('Fișă 4: Puteri – set 1 — Matematică clasa a V-a', 'Fișă 4: Puteri -set 1'), 1);
  assert.strictEqual(s('Fișă 4: Puteri – set 1 — Matematică clasa a V-a', 'Fișă 5: Puteri - set 2 (remedial)'), 0, 'numere fără niciunul comun');
  assert.strictEqual(s('Cercul — poziții relative · clasa a VI-a', 'GEOMETRIE - Fișă 10: Cercul - poziții relative'), 1);
  assert.ok(s('Cercul — poziții relative · clasa a VI-a', 'GEOMETRIE - Fișă 9: Cercul - arce') < 0.5);
  // EN: capitolele („SUBIECTUL II, EX. 5: Cercul"), exercițiile pe subiecte
  assert.strictEqual(s('Cercul · Rezolvare interactivă', 'SUBIECTUL II, EX. 5: Cercul'), 1);
  assert.strictEqual(s('Subiectul III exercițiul 2', 'Subiectul III - Exercițiul 2'), 1);
  assert.strictEqual(s('Subiectul III exercițiul 2', 'Subiectul III - Exercițiul 3'), 0);
  assert.strictEqual(s('Subiectul III exercițiul 2', 'Subiectul II - Exercițiul 2'), 0, 'alt subiect');
  assert.strictEqual(s('Simulare oficială 2024 — test interactiv', '2024 simulare oficială'), 1);
  assert.strictEqual(s('Simulare oficială 2024 — test interactiv', '2024 simulare Ilfov'), 0.75);
  // doar numere: niciodată peste 0,5 (sub orice prag) — „Test interactiv EN - 9" nu spune ce PDF e
  assert.strictEqual(s('Test interactiv Evaluare Națională - 9', '2021 model 9'), 0.25);
  assert.ok(s('Test interactiv Evaluare Națională - 9', 'Simulare 9') <= 0.5);
  assert.strictEqual(s('Test 33 · Evaluare Națională', '2023 simulare Botoșani'), 0);
  assert.strictEqual(s('Test interactiv — Matematică, clasa a V-a', 'Fișă 1: Nr. naturale - aproximări, rotunjiri'), 0);
});

test('nivelPotrivire(): „sigur" doar cu prag și distanță față de al doilea; egalitatea → nicio propunere', () => {
  const n = (...scoruri) => P.nivelPotrivire(scoruri.map((scor, i) => ({ row: { id: i }, scor })));
  assert.strictEqual(n(1, 0.75), 'sigur');
  assert.strictEqual(n(1, 0.85), 'probabil', 'prea aproape de al doilea');
  assert.strictEqual(n(0.8), 'probabil');
  assert.strictEqual(n(0.67, 0.67, 0.67), null, '„Calcule cu numere întregi" ↔ fișele 7, 11, 12');
  assert.strictEqual(n(0.5), null);
  assert.strictEqual(n(), null);
});

const PDF = (id, title, extra = {}) => ({ id, title, content_type: 'pdf', category: 'bacalaureat', subcategory: 'variante', profile: 'tehnologic', interactiv_id: null, ...extra });
const TEST = (id, title, extra = {}) => ({ id, title, content_type: 'interactive', category: 'bacalaureat', subcategory: 'teste-interactive', profile: 'tehnologic', pdf_sursa_id: null, ...extra });

test('propunePdf(): doar aceeași categorie și profil compatibil; aceeași variantă la alt profil nu contează', () => {
  const pdfs = [
    PDF('p-teh-2', '2021 Varianta 02'), PDF('p-teh-3', '2021 Varianta 03'),
    PDF('p-mi-2', '2021 Varianta 02', { profile: 'mate-info' }),
    PDF('p-en', '2021 Varianta 02', { category: 'evaluare-nationala', profile: null }),
  ];
  const r = P.propunePdf(TEST('t', 'BAC 2021 · Matematică M_tehnologic · Varianta 2 — rezolvare interactivă'), pdfs);
  assert.strictEqual(r.alesul.row.id, 'p-teh-2');
  assert.strictEqual(r.nivel, 'sigur');
  assert.deepStrictEqual(r.lista.map((x) => x.row.id), ['p-teh-2', 'p-teh-3']);
  // testul fără profil (capitole) poate merge la un PDF cu profil și invers
  assert.ok(P.compatibili(TEST('x', 'a', { profile: null }), PDF('y', 'b')));
  assert.match(P.motivIncompatibil(TEST('x', 'a'), PDF('y', 'b', { profile: 'mate-info' })), /profiluri de Bacalaureat diferite/);
  assert.match(P.motivIncompatibil(TEST('x', 'a', { category: 'clasa-9' }), PDF('y', 'b')), /categorii diferite/);
  // potrivirea exactă bate varianta de rezervă; două PDF-uri cu același titlu (încărcat de două ori) → nicio propunere
  const rez = P.propunePdf(TEST('t', 'BAC 2021 · Varianta 2'), [PDF('a', '2021 Varianta 02'), PDF('b', '2021 Varianta 02 (rezervă)')]);
  assert.deepStrictEqual([rez.alesul.row.id, rez.nivel], ['a', 'sigur']);
  const egal = P.propunePdf(TEST('t', 'BAC 2021 · Varianta 2'), [PDF('a', '2021 Varianta 02'), PDF('b', '2021 Varianta 02')]);
  assert.strictEqual(egal.nivel, null);
});

// ═══════════════════════════ jurnalul generatorului ═══════════════════════════
test('construiesteJurnal(): „pe rând" (PDF-ul + baremul ca context) → PDF-ul; combinat din teste / din PDF-uri → fără PDF', () => {
  const pdfs = [
    PDF('pdf-v2', '2021 Varianta 02'), PDF('pdf-v3', '2021 Varianta 03'),
    PDF('barem-v2', 'Barem 2021 Varianta 02', { subcategory: 'bareme' }),
    { id: 'en-1', title: '2021 model 1', content_type: 'pdf', category: 'evaluare-nationala', subcategory: 'variante', profile: null },
  ];
  const teste = [TEST('t-rand', 'BAC 2021 · Varianta 2'), TEST('t-comb', 'Test combinat'), { ...TEST('t-en', 'Test 33 · Evaluare Națională'), category: 'evaluare-nationala', profile: null }, TEST('t-sters', 'Test vechi')];
  const tasks = [
    { id: 'task-pdf', name: 'Test nou BAC tehnologic interactiv', category: 'bacalaureat', subcategory: 'variante', profile: 'tehnologic', ctype: 'pdf' },
    { id: 'task-int', name: 'test EN nou interactiv', category: 'evaluare-nationala', subcategory: 'teste-interactive', profile: null, ctype: 'interactive' },
  ];
  const runs = [
    { content_id: 't-rand', task_id: 'task-pdf', combined_from: ['2021 Varianta 02', 'Barem 2021 Varianta 02'] },
    { content_id: 't-comb', task_id: 'task-pdf', combined_from: ['2021 Varianta 02', '2021 Varianta 03'] },
    { content_id: 't-en', task_id: 'task-int', combined_from: Array.from({ length: 14 }, (_, i) => `Test interactiv EN - ${i + 1}`) },
    { content_id: 't-sters', task_id: 'task-dispărut', combined_from: ['2021 Varianta 03'] },
    { content_id: 'alt-test', task_id: 'task-pdf', combined_from: ['2021 Varianta 02'] },
  ];
  const j = P.construiesteJurnal({ runs, tasks, teste, pdfs });
  assert.deepStrictEqual(j['t-rand'], { combinat: false, pdfId: 'pdf-v2', sursa: '2021 Varianta 02', task: 'Test nou BAC tehnologic interactiv' });
  assert.deepStrictEqual(j['t-comb'], { combinat: true, n: 2, din: 'pdf', task: 'Test nou BAC tehnologic interactiv' });
  assert.deepStrictEqual(j['t-en'], { combinat: true, n: 14, din: 'teste', task: 'test EN nou interactiv' });
  assert.strictEqual(j['t-sters'].pdfId, 'pdf-v3', 'task-ul șters: titlul se caută în categoria testului');
  assert.strictEqual(j['alt-test'], undefined, 'doar testele cerute');
  assert.deepStrictEqual(P.construiesteJurnal(), {});
});

// ═══════════════════════════ „🤖 Asociază automat" ═══════════════════════════
test('propuneri(): jurnalul → sigur; titlul → sigur / de verificat; spre un PDF cu test → de verificat; combinatele și numerele singure → nimic', () => {
  const pdfs = [
    PDF('pdf-v2', '2021 Varianta 02'), PDF('pdf-v3', '2021 Varianta 03'),
    PDF('pdf-v5', '2021 Varianta 05', { interactiv_id: 'vechi-5' }),
    { id: 'fisa-5', title: 'Fișa 5 - BAC: Ecuații logaritmice', content_type: 'pdf', category: 'clasa-10', subcategory: null, profile: null, interactiv_id: null },
    { id: 'en-m9', title: '2021 model 9', content_type: 'pdf', category: 'evaluare-nationala', subcategory: 'variante', profile: null, interactiv_id: null },
  ];
  const teste = [
    TEST('din-jurnal', 'Test generat'),
    TEST('dupa-titlu', 'BAC 2021 · Matematică M_tehnologic · Varianta 3 — rezolvare interactivă'),
    TEST('pdf-cu-test', 'BAC 2021 · Matematică M_tehnologic · Varianta 5 — rezolvare interactivă'),
    TEST('vechi-5', 'BAC 2021 tehnologic v5', { pdf_sursa_id: 'pdf-v5' }),
    { id: 'clasa', title: 'Ecuații logaritmice · Rezolvare interactivă', content_type: 'interactive', category: 'clasa-10', profile: null, pdf_sursa_id: null },
    { id: 'combinat', title: 'Test 33 · Evaluare Națională', content_type: 'interactive', category: 'evaluare-nationala', profile: null, pdf_sursa_id: null },
    { id: 'numere', title: 'Test interactiv Evaluare Națională - 9', content_type: 'interactive', category: 'evaluare-nationala', profile: null, pdf_sursa_id: null },
  ];
  const jurnal = { 'din-jurnal': { combinat: false, pdfId: 'pdf-v2' }, combinat: { combinat: true, n: 14, din: 'teste' } };
  const r = P.propuneri({ pdfs, teste, jurnal });
  const dupa = Object.fromEntries(r.map((x) => [x.testId, x]));
  assert.deepStrictEqual(Object.keys(dupa).sort(), ['clasa', 'din-jurnal', 'dupa-titlu', 'pdf-cu-test']);
  assert.deepStrictEqual([dupa['din-jurnal'].pdfId, dupa['din-jurnal'].nivel, dupa['din-jurnal'].motiv], ['pdf-v2', 'sigur', 'jurnal']);
  assert.deepStrictEqual([dupa['dupa-titlu'].pdfId, dupa['dupa-titlu'].nivel, dupa['dupa-titlu'].motiv], ['pdf-v3', 'sigur', 'titlu']);
  assert.deepStrictEqual([dupa['pdf-cu-test'].pdfId, dupa['pdf-cu-test'].nivel, dupa['pdf-cu-test'].pdfAreTest], ['pdf-v5', 'probabil', true]);
  assert.deepStrictEqual([dupa.clasa.pdfId, dupa.clasa.nivel], ['fisa-5', 'sigur']);
  assert.strictEqual(r[r.length - 1].nivel, 'probabil', 'cele sigure întâi');
  assert.deepStrictEqual(P.propuneri(), []);
});

test('alegePrincipal(): cel mai nou test făcut după PDF', () => {
  assert.strictEqual(P.alegePrincipal([{ id: 'a', created_at: '2026-07-20' }, { id: 'b', created_at: '2026-10-01' }]), 'b');
  assert.strictEqual(P.alegePrincipal([]), null);
  assert.strictEqual(P.procent(0.923), '92%');
});

// ═══════════════════════════ serverul (content-admin) ═══════════════════════════
const http = require('../api/_lib/http');
let fake = null;
http.admin = () => fake;
http.authUser = async () => 'admin-user';
http.requireAdmin = async () => true;
const handler = require('../api/content-admin');
const call = async (body) => { const r = fakeRes(); await handler({ method: 'POST', body, headers: {} }, r); return r; };

const PA = uuid(1), PB = uuid(2), PC = uuid(3), BAREM = uuid(4);
const T1 = uuid(11), T2 = uuid(12), T3 = uuid(13), TCLS = uuid(14);
function baza() {
  return createFakeSupabase({
    content: [
      { id: PA, title: '2021 Varianta 02', content_type: 'pdf', category: 'bacalaureat', subcategory: 'variante', profile: 'tehnologic', interactiv_id: T1, created_at: '2026-04-01' },
      { id: PB, title: '2021 Varianta 03', content_type: 'pdf', category: 'bacalaureat', subcategory: 'variante', profile: 'tehnologic', interactiv_id: null, created_at: '2026-04-02' },
      { id: PC, title: '2021 Varianta 02', content_type: 'pdf', category: 'bacalaureat', subcategory: 'variante', profile: 'mate-info', interactiv_id: null, created_at: '2026-04-03' },
      { id: BAREM, title: 'Barem 2021 Varianta 02', content_type: 'pdf', category: 'bacalaureat', subcategory: 'bareme', profile: 'tehnologic', interactiv_id: null, created_at: '2026-04-04' },
      { id: T1, title: 'BAC 2021 · M_tehnologic · Varianta 2', content_type: 'interactive', category: 'bacalaureat', subcategory: 'teste-interactive', profile: 'tehnologic', pdf_sursa_id: PA, created_at: '2026-10-01' },
      { id: T2, title: 'BAC 2021 tehnologic v2', content_type: 'interactive', category: 'bacalaureat', subcategory: 'teste-interactive', profile: 'tehnologic', pdf_sursa_id: PA, is_free: true, created_at: '2026-07-20' },
      { id: T3, title: 'BAC 2021 · M_tehnologic · Varianta 3', content_type: 'interactive', category: 'bacalaureat', subcategory: 'teste-interactive', profile: 'tehnologic', pdf_sursa_id: null, created_at: '2026-10-02' },
      { id: TCLS, title: 'Radicali · Rezolvare interactivă', content_type: 'interactive', category: 'clasa-10', profile: null, pdf_sursa_id: null, created_at: '2026-08-01' },
    ],
  });
}
const row = (id) => fake.db.tables.content.find((r) => r.id === id);

test('asociaza: testul fără PDF → făcut după PDF și principalul lui (PDF-ul n-avea); un barem / altă categorie / alt profil → refuzat', async () => {
  fake = baza();
  let r = await call({ action: 'asociaza', pdfId: PB, testId: T3 });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual([row(T3).pdf_sursa_id, row(PB).interactiv_id, r.body.principal], [PB, T3, true]);
  assert.deepStrictEqual(r.body.pdf, { id: PB, title: '2021 Varianta 03', content_type: 'pdf', category: 'bacalaureat', subcategory: 'variante', profile: 'tehnologic', is_free: false, created_at: '2026-04-02', interactiv_id: T3 });
  assert.strictEqual(r.body.test.pdf_sursa_id, PB);
  for (const [body, mesaj] of [
    [{ pdfId: BAREM, testId: T3 }, /barem/],
    [{ pdfId: PB, testId: TCLS }, /categorii diferite/],
    [{ pdfId: PC, testId: T3 }, /profiluri de Bacalaureat diferite/],
    [{ pdfId: T1, testId: T3 }, /nu e un PDF/],
    [{ pdfId: PB, testId: PA }, /nu e un test interactiv/],
    [{ pdfId: 'x', testId: T3 }, /Alege și PDF-ul, și testul/],
  ]) {
    const e = await call({ action: 'asociaza', ...body });
    assert.strictEqual(e.statusCode, 400, JSON.stringify(body));
    assert.match(e.body.error, mesaj);
  }
});

test('asociaza: „daca-lipseste" păstrează principalul; „da" îl schimbă; testul mutat lasă PDF-ului vechi celălalt test ca principal', async () => {
  fake = baza();
  // T3 după PA (care are principal T1) → T1 rămâne principal
  let r = await call({ action: 'asociaza', pdfId: PA, testId: T3 });
  assert.deepStrictEqual([row(T3).pdf_sursa_id, row(PA).interactiv_id, r.body.principal], [PA, T1, false]);
  // „⭐ fă-l principal"
  r = await call({ action: 'asociaza', pdfId: PA, testId: T3, principal: 'da' });
  assert.deepStrictEqual([row(PA).interactiv_id, r.body.principal, row(T1).pdf_sursa_id], [T3, true, PA], 'T1 rămâne făcut după PA');
  // T3 (principalul lui PA) mutat la PB → PA primește cel mai nou dintre testele rămase (T1, nu T2)
  r = await call({ action: 'asociaza', pdfId: PB, testId: T3 });
  assert.deepStrictEqual([row(T3).pdf_sursa_id, row(PB).interactiv_id, row(PA).interactiv_id], [PB, T3, T1]);
  assert.strictEqual(r.body.vechi.id, PA);
  assert.strictEqual(r.body.vechi.interactiv_id, T1);
});

test('dezleaga: ambele părți; principalul scos → PDF-ul primește alt test făcut după el, dacă are', async () => {
  fake = baza();
  let r = await call({ action: 'dezleaga', pdfId: PA, testId: T1 });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual([row(T1).pdf_sursa_id, row(PA).interactiv_id, r.body.altPrincipal], [null, T2, T2]);
  r = await call({ action: 'dezleaga', pdfId: PA, testId: T2 });
  assert.deepStrictEqual([row(T2).pdf_sursa_id, row(PA).interactiv_id, r.body.altPrincipal], [null, null, null]);
});

test('asociaza_lot: doar testele încă fără PDF (cele legate între timp rămân), principal doar unde lipsește', async () => {
  fake = baza();
  const r = await call({ action: 'asociaza_lot', perechi: [{ pdfId: PB, testId: T3 }, { pdfId: PB, testId: T2 }, { pdfId: BAREM, testId: TCLS }] });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.facute, 1);
  assert.deepStrictEqual(r.body.rezultate.map((x) => [x.ok, !!x.sarit]), [[true, false], [false, true], [false, false]]);
  assert.match(r.body.rezultate[2].eroare, /barem/);
  assert.deepStrictEqual([row(T3).pdf_sursa_id, row(PB).interactiv_id, row(T2).pdf_sursa_id], [PB, T3, PA]);
  assert.strictEqual((await call({ action: 'asociaza_lot', perechi: [] })).statusCode, 400);
});

test('perechi: PDF-urile fără bareme, testele, jurnalul generatorului pentru testele fără PDF (fără tabelele agentului → gol)', async () => {
  fake = baza();
  fake.db.tables.agent_tasks = [{ id: 'k', name: 'Task BAC', category: 'bacalaureat', subcategory: 'variante', profile: 'tehnologic', ctype: 'pdf' }];
  fake.db.tables.agent_task_runs = [{ content_id: T3, task_id: 'k', combined_from: ['2021 Varianta 03', 'Barem 2021 Varianta 03'] }];
  let r = await call({ action: 'perechi' });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(r.body.pdfs.map((p) => p.id), [PA, PB, PC], 'fără barem');
  assert.ok(r.body.pdfs.every((p) => !('file_url' in p) && 'interactiv_id' in p));
  assert.deepStrictEqual(r.body.teste.map((t) => t.id).sort(), [T1, T2, T3, TCLS].sort());
  assert.deepStrictEqual(r.body.jurnal, { [T3]: { combinat: false, pdfId: PB, sursa: '2021 Varianta 03', task: 'Task BAC' } });
  fake.db.failTables.add('agent_task_runs');
  r = await call({ action: 'perechi' });
  assert.deepStrictEqual(r.body.jurnal, {});
});

test('legaturiInAcord (✏️ din Tot Conținutul): testul mutat la alt PDF lasă PDF-ului vechi celălalt test ca principal', async () => {
  fake = baza();
  const cur = { ...row(T1) };
  row(T1).pdf_sursa_id = PB;
  await handler.legaturiInAcord(fake, cur, { pdf_sursa_id: PB });
  assert.deepStrictEqual([row(PA).interactiv_id, row(PB).interactiv_id], [T2, T1]);
});

// ═══════════════════════════ asocierea automată la creare ═══════════════════════════
test('agentul Claude: PDF-ul-model de pe site (și sursa automatizării „pe rând") merge cu testul la «Adaugă Interactiv»', () => {
  const ag = read('src/components/AIExerciseAgent.jsx');
  assert.match(ag, /const \[sursaPdf, setSursaPdf\] = useState\(null\);/);
  assert.match(ag, /\? \{ name: `\$\{r\.title\}\.pdf`, pdf: r\.pdf, text: null, sursa: \{ id: item\.id, title: r\.title \|\| item\.title \|\| '', category: item\.category \|\| null, profile: item\.profile \|\| null \} \}/);
  assert.match(ag, /setSursaPdf\(resp\.sourceId \? \{ id: resp\.sourceId, title: resp\.sourceTitle \|\| '', category: r\.category, profile: r\.profile \|\| null \} : null\);/);
  assert.match(ag, /const sursaGen = \(modelFile && modelFile\.sursa\) \|\| \(formatFile && formatFile\.sursa\) \|\| null;/);
  assert.match(ag, /setSursaPdf\(\(prev\) => sursaGen \|\| \(iterare \? prev : null\)\);/);
  assert.strictEqual((ag.match(/pdfSursa: sursaPdf,/g) || []).length, 2, 'ambele drumuri spre «Adaugă Interactiv»');
  assert.match(ag, /\.select\('id, title, category, subcategory, profile, content_type'\)/, 'pickerul aduce și profilul');
  const api = read('api/ai-exercise-agent.js');
  assert.match(api, /const sursa = ctype === 'pdf' && r\.sourceId \? \{ sourceId: r\.sourceId, sourceTitle: r\.sourceTitle \|\| null \} : \{\};/);
  assert.strictEqual((api.match(/\.\.\.sursa \}\);/g) || []).length, 2);
  // generatorul programat își păstrează asocierea („pe rând" dintr-un PDF)
  const ex = read('api/_lib/exgen.js');
  assert.strictEqual((ex.match(/await asociazaPdf\(supa, \{ sourceId: /g) || []).length, 2, 'la postarea automată și la aprobare');
});

test('«🧩 Exerciții Interactive»: PDF-ul ales singur după titlu (sau de la agent), asociat după încărcare', () => {
  const adm = read('src/pages/Admin.jsx');
  assert.match(adm, /import AdminPdfInteractiv, \{ AlegePdfSursa \} from '\.\.\/components\/AdminPdfInteractiv';/);
  assert.match(adm, /<AlegePdfSursa s=\{s\} form=\{form\} value=\{pdfSursa\} onChange=\{setPdfSursa\} \/>/);
  assert.match(adm, /const leg = nou\?\.id && pdfSursa\.id \? await asociazaCuPdf\(pdfSursa\.id, nou\.id\) : '';/);
  assert.match(adm, /apiPost\('\/api\/content-admin', \{ action: 'asociaza', pdfId, testId, principal: 'daca-lipseste' \}\)/);
  assert.match(adm, /if \(sursa\) setPdfSursa\(\{ id: sursa\.id, title: sursa\.title \|\| '', din: 'agent' \}\);/);
  const c = read('src/components/AdminPdfInteractiv.jsx');
  assert.match(c, /export function AlegePdfSursa\(\{ s, form, value, onChange \}\)/);
  assert.match(c, /if \(value\.din === 'manual' \|\| value\.din === 'agent'\) return;/, 'alegerea adminului / a agentului nu se suprascrie');
  assert.match(c, /const a = prop && prop\.nivel === 'sigur' \? prop\.alesul : null;/);
  assert.match(c, /\} else if \(value\.din === 'titlu'\) \{\s*\n\s*onChange\(\{ id: '', title: '', din: null \}\);/, 'alegerea automată care nu mai e sigură se scoate');
});

// ═══════════════════════════ fila din Admin ═══════════════════════════
test('Admin → „🔗 PDF ↔ Interactiv": fila, acțiunile serverului, propunerile automate; drumul din Tot Conținutul', () => {
  const adm = read('src/pages/Admin.jsx');
  assert.match(adm, /\{ id: 'pdf-interactiv', icon: '🔗', label: 'PDF ↔ Interactiv' \},/);
  assert.match(adm, /\{tab === 'pdf-interactiv' && <AdminPdfInteractiv s=\{s\} \/>\}/);
  assert.match(adm, /new CustomEvent\('admin:goto-tab', \{ detail: 'pdf-interactiv' \}\)/);
  const c = read('src/components/AdminPdfInteractiv.jsx');
  for (const a of ['perechi', 'asociaza', 'asociaza_lot', 'dezleaga']) assert.match(c, new RegExp(`action: '${a}'`), a);
  assert.match(c, /from '\.\.\/\.\.\/api\/_lib\/pdfTestPotrivire\.js';/);
  assert.match(c, /const lista = propuneri\(\{ pdfs: date\.pdfs, teste: date\.teste, jurnal: date\.jurnal \|\| \{\} \}\);/);
  assert.match(c, /bifate: new Set\(lista\.filter\(\(p\) => p\.nivel === 'sigur'\)\.map\(\(p\) => p\.testId\)\)/, 'doar cele sigure bifate');
  assert.match(c, /for \(let i = 0; i < alese\.length; i \+= 25\)/, 'loturi de câte 25');
  // aceeași regulă în browser: fără require, încheiat cu module.exports = { … } (pluginul din vite.config.js)
  const lib = read('api/_lib/pdfTestPotrivire.js');
  assert.doesNotMatch(lib, /\brequire\(|\bprocess\.|\bBuffer\b|__dirname/);
  assert.strictEqual((lib.match(/^module\.exports\s*=\s*\{/gm) || []).length, 1);
  assert.match(read('vite.config.js'), /\(capitoleHarta\|contentAdmin\|pdfTestPotrivire\)/);
});

test('Admin: hook-ul „dupaIncarcare" stă înaintea return-urilor condiționate (fără eroarea React #310 la /admin deschis direct)', () => {
  const adm = read('src/pages/Admin.jsx');
  const i = adm.indexOf('const [dupaIncarcare, setDupaIncarcare] = useState(null);');
  assert.ok(i > 0);
  assert.ok(i < adm.indexOf('  if (loading) {\n    return ('), 'înainte de spinner');
  assert.ok(i < adm.indexOf('if (!user || !isAdmin) return null;'));
  assert.strictEqual((adm.match(/const \[dupaIncarcare, setDupaIncarcare\]/g) || []).length, 1);
});

// ═══════════════════════════ redenumirile ═══════════════════════════
test('vizualizatorul PDF: „✏️ Rezolvă" (nu „Rezolvă pe PDF"); cardurile PDF: „Deschide PDF" și „🧩 Deschide interactiv"', () => {
  const v = read('src/pages/PDFViewer.jsx');
  assert.match(v, /\{metodaInfo \? `\$\{metodaInfo\.icon\} \$\{tiny \? metodaInfo\.scurt : metodaInfo\.label\}` : '✏️ Rezolvă'\} ▾/);
  assert.match(v, /\? \(solveActive \? '✏️ Rezolvi pe PDF' : '✏️ Rezolvă'\)/);
  assert.doesNotMatch(v, /'✏️ Rezolvă pe PDF'/, 'nicio etichetă de buton cu „Rezolvă pe PDF"');
  const cp = read('src/components/ContentPage.jsx');
  assert.match(cp, /actionLabel: 'Deschide PDF'/);
  assert.match(cp, /🧩 Deschide interactiv\{testPereche\.premium \? ' ⭐' : ''\}/);
  // textele care trimit la buton
  assert.match(read('src/pages/PregatesteMa.jsx'), /la <b>„✏️ Rezolvă"<\/b>/);
  assert.match(read('src/components/AdminBareme.jsx'), /\(Profesorul Virtual, „✏️ Rezolvă"\)/);
  assert.doesNotMatch(read('src/components/ContentAdminTools.jsx'), /„✏️ Rezolvă pe PDF ▾"/);
});
