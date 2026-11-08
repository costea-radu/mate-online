// Teste pentru cererea lui Radu din 31 oct. 2026:
//  1) „👥 Test pe grupă" → „⚡ Generează acum testele" în format PDF: teste noi,
//     combinate exact din subiectele PDF ale site-ului (ca la „📄 Generează subiect
//     examen"), salvate în „Testele și exercițiile mele", publicate automat în
//     „Biblioteca utilizatorilor", descărcabile; cu alegerea subiectelor: toate,
//     doar I, doar II, doar III, doar I și II;
//  2) profesorii au „📄 Generează subiect examen" în „🎓 Examene" (navbar), care
//     deschide „Asistent AI pentru profesori" direct pe generator.
// Partea pură (planul combinării, structurile, etichetele) rulează direct în Node;
// compunerea PDF-urilor (pdf.js + pdf-lib în browser) a fost verificată în
// Chromium pe subiecte sintetice EN (cu copertă) și BAC (fără copertă).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeSupabase } = require('./tools/fakeSupabase');
const cat = require('../api/_lib/catalog');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8');
let libP = null;
const lib = () => (libP || (libP = import('../src/lib/pdfCombine.js')));
let meniuP = null;
const meniu = () => (meniuP || (meniuP = import('../src/lib/meniu.js')));

// o sursă „analizată": regiunile subiectelor și ale itemilor (doar cheile contează)
function sursa(counts, { label = 'x', fara = [] } = {}) {
  const regions = { S1: [{ p: 2, top: 700, bottom: 680 }], S2: [{ p: 3, top: 700, bottom: 680 }], S3: [{ p: 4, top: 700, bottom: 680 }] };
  counts.forEach((c, si) => { for (let i = 1; i <= c; i++) regions[`${si + 1}.${i}`] = [{ p: si + 2, top: 600, bottom: 500 }]; });
  fara.forEach((k) => delete regions[k]);
  return { regions, counts: { 1: counts[0], 2: counts[1], 3: counts[2] }, signature: counts.join('-'), label };
}
const amprenta = (plan) => Object.keys(plan.picks).sort().map((k) => `${k}:${plan.picks[k]}`).join('|');

// ═════════════════════════ 1) planul combinării ═════════════════════════════
test('planCombinations: fiecare poziție vine dintre exercițiile ACELEIAȘI poziții; testele diferă între ele', async () => {
  const C = await lib();
  const surse = Array.from({ length: 8 }, (_, i) => sursa([6, 6, 6], { label: `Simulare ${i + 1}` }));
  const planuri = C.planCombinations(surse, { count: 20, subjects: [1, 2, 3], seed: 42 });
  assert.strictEqual(planuri.length, 20);
  for (const p of planuri) {
    assert.deepStrictEqual(Object.keys(p.picks).sort(), ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6', '2.1', '2.2', '2.3', '2.4', '2.5', '2.6', '3.1', '3.2', '3.3', '3.4', '3.5', '3.6']);
    // în același test, cele 6 exerciții ale unui subiect vin din 6 surse diferite
    for (const s of [1, 2, 3]) assert.strictEqual(new Set([1, 2, 3, 4, 5, 6].map((i) => p.picks[`${s}.${i}`])).size, 6);
    assert.ok(surse[p.base], 'baza (coperta + titlurile subiectelor) e una dintre surse');
    assert.strictEqual(p.duplicate, false);
  }
  assert.strictEqual(new Set(planuri.map(amprenta)).size, 20, 'niciun test identic cu altul');
  // primele 8 teste (o „tură") diferă între ele la FIECARE poziție
  const tura = planuri.slice(0, 8);
  for (let a = 0; a < 8; a++) for (let b = a + 1; b < 8; b++) {
    for (const k of Object.keys(tura[a].picks)) assert.notStrictEqual(tura[a].picks[k], tura[b].picks[k], `testele ${a + 1} și ${b + 1} au la ${k} același exercițiu`);
  }
  // baza se rotește: coperțile diferă între teste
  assert.strictEqual(new Set(tura.map((p) => p.base)).size, 8);
});

test('planCombinations: doar subiectele alese — I, II, III, I și II', async () => {
  const C = await lib();
  const surse = Array.from({ length: 6 }, () => sursa([6, 6, 6]));
  const chei = (subjects) => Object.keys(C.planCombinations(surse, { count: 1, subjects, seed: 3 })[0].picks).sort();
  assert.deepStrictEqual(chei([1]), ['1.1', '1.2', '1.3', '1.4', '1.5', '1.6']);
  assert.deepStrictEqual(chei([2]), ['2.1', '2.2', '2.3', '2.4', '2.5', '2.6']);
  assert.deepStrictEqual(chei([3]), ['3.1', '3.2', '3.3', '3.4', '3.5', '3.6']);
  assert.strictEqual(chei([2, 1]).length, 12);
  assert.ok(chei([1, 2]).every((k) => !k.startsWith('3.')));
  assert.strictEqual(chei([]).length, 18, 'nimic ales → testul complet');
});

test('planCombinations: BAC (6 · 2 · 2), poziții lipsă, teste prea multe față de combinațiile posibile', async () => {
  const C = await lib();
  const bac = Array.from({ length: 3 }, (_, i) => sursa([6, 2, 2], { label: `BAC ${i}` }));
  const p = C.planCombinations(bac, { count: 12, subjects: [2], seed: 7 });
  assert.deepStrictEqual(Object.keys(p[0].picks).sort(), ['2.1', '2.2']);
  assert.strictEqual(C.maxDistinctTests(bac, [2]), 9);
  assert.strictEqual(new Set(p.map(amprenta)).size, 9, 'toate cele 9 combinații posibile');
  assert.strictEqual(p.filter((x) => x.duplicate).length, 3, 'restul sunt marcate „identic cu un test anterior"');
  // o poziție pe care o are o singură sursă vine mereu de acolo
  const lipsa = [sursa([6, 6, 6], { fara: ['2.3'] }), sursa([6, 6, 6]), sursa([6, 6, 6], { fara: ['2.3'] })];
  assert.ok(C.planCombinations(lipsa, { count: 5, seed: 9 }).every((x) => x.picks['2.3'] === 1));
  // doar două surse: tot se pot face multe teste diferite (2^6 = 64 la un subiect)
  const doua = [sursa([6, 6, 6]), sursa([6, 6, 6])];
  const p2 = C.planCombinations(doua, { count: 30, subjects: [1], seed: 3 });
  assert.strictEqual(new Set(p2.map(amprenta)).size, 30);
  assert.strictEqual(C.maxDistinctTests(doua, [1]), 64);
  // aceeași sămânță → același plan (reproductibil)
  assert.deepStrictEqual(C.planCombinations(bac, { count: 4, seed: 5 }), C.planCombinations(bac, { count: 4, seed: 5 }));
});

test('structura surselor: toate cele trei subiecte; grupul cu aceeași structură (EN de azi 6·6·6 înaintea modelului vechi)', async () => {
  const C = await lib();
  assert.strictEqual(C.structureOk({ 1: 6, 2: 6, 3: 6 }), true);   // EN
  assert.strictEqual(C.structureOk({ 1: 6, 2: 5, 3: 5 }), true);   // EN, formatul vechi
  assert.strictEqual(C.structureOk({ 1: 6, 2: 2, 3: 2 }), true);   // BAC
  assert.strictEqual(C.structureOk({ 1: 6, 2: 6, 3: 0 }), false);  // fără Subiectul III
  assert.strictEqual(C.structureOk({ 1: 0, 2: 6, 3: 6 }), false);  // fără Subiectul I
  assert.strictEqual(C.signatureOf({ 1: 6, 2: 2, 3: 2 }), '6-2-2');
  const g = C.pickGroup([sursa([6, 5, 5]), sursa([6, 5, 5]), sursa([6, 5, 5]), sursa([6, 6, 6]), sursa([6, 6, 6]), sursa([6, 6, 3])]);
  assert.strictEqual(g.signature, '6-6-6');
  assert.strictEqual(g.list.length, 2);
  assert.strictEqual(C.pickGroup([sursa([6, 5, 5]), sursa([6, 5, 5]), sursa([6, 6, 6])]).signature, '6-5-5', 'o singură sursă 6·6·6 nu ajunge');
  const fara = C.pickGroup([sursa([6, 5, 5]), sursa([6, 6, 6])]);
  assert.strictEqual(fara.signature, null);
  assert.strictEqual(fara.list.length, 2, 'fără pereche: ca înainte, toate sursele');
});

test('etichetele subiectelor și alegerile din interfață', async () => {
  const C = await lib();
  assert.deepStrictEqual(C.SUBJECT_CHOICES.map((c) => c.subjects), [[1, 2, 3], [1], [2], [3], [1, 2]]);
  assert.deepStrictEqual(C.SUBJECT_CHOICES.map((c) => c.label), [
    'Toate subiectele (I, II și III)', 'Doar Subiectul I', 'Doar Subiectul al II-lea', 'Doar Subiectul al III-lea', 'Doar Subiectele I și II',
  ]);
  assert.strictEqual(C.subjectsLabel([1]), 'Subiectul I');
  assert.strictEqual(C.subjectsLabel([2]), 'Subiectul al II-lea');
  assert.strictEqual(C.subjectsLabel([3]), 'Subiectul al III-lea');
  assert.strictEqual(C.subjectsLabel([2, 1]), 'Subiectele I și II');
  assert.strictEqual(C.subjectsLabel([1, 2, 3]), 'Subiectele I, II și III');
  assert.deepStrictEqual(C.normSubjects([3, 1, 1, 7]), [1, 3]);
  assert.strictEqual(C.subjectsPoints([1, 2]), 60);
  assert.strictEqual(C.isFullTest([1, 2, 3]), true);
  assert.strictEqual(C.isFullTest([1, 2]), false);
});

test('motorul PDF: analiza o singură dată, compunere cu încorporare pe sursă, textul testului, antet pentru testele parțiale', () => {
  const src = read('src/lib/pdfCombine.js');
  // EN ca până acum (pagina 1 = copertă), apoi BAC (fără copertă)
  assert.match(src, /for \(const from of \[2, 1\]\)/);
  assert.match(src, /hasCover: from === 2/);
  assert.match(src, /regions\.H = \[\{ p: firstS\.p, top: contentMaxY\[firstS\.p\], bottom: firstS\.cut \}\]/, 'antetul probei BAC ține loc de copertă');
  // regiunile unei surse se încorporează împreună (fonturile o singură dată)
  assert.match(src, /const embs = await out\.embedPages\(pages, boxes\);/);
  // testul complet: coperta bazei; parțial: antetul generat, fără copertă
  assert.match(src, /if \(full && base\.hasCover\) \{/);
  assert.match(src, /if \(full && !base\.hasCover && hasRegion\(base, 'H'\)\)/);
  assert.match(src, /const hdr = typeof header === 'function' \? await header\(W - 2 \* hx, \{ points \}\) : header;/);
  // textul — doar regiunile așezate (fișierul ar avea și textul decupat vizual)
  assert.match(src, /txt\.push\(chunkText\(list\[b\.src\], c\)\);/);
  // analiza verificării se păstrează pe sursă și nu se repetă
  assert.match(src, /if \(typeof pr === 'object'\) analysis = pr;/);
  assert.match(src, /const a = s\.analysis && s\.analysis\.regions \? s\.analysis : await analyze\(s\.bytes\);/);
  // worker-ul pdf.js al fiecărui document se eliberează
  assert.match(src, /doc\.destroy\(\);/);
  // „cerneala" paginii (randare mică): tăieturile nu trec prin figuri, iar albul de
  // sub ultimul exercițiu al paginii se taie doar la Subiectele I și II
  assert.match(src, /async function inkRows\(doc, pages, SCALE = 1\)/);
  assert.match(src, /const floor = mk\.y \+ 14;/);
  assert.match(src, /if \(y < ceil && y - mk\.cut <= 12\) \{/);
  assert.match(src, /const trim = s3 && s3 <= 3 \? \/\^\[123\]\\\.\\d\$\/ : \/\^\[12\]\\\.\\d\$\/;\s*for \(const \[key, chunks\] of Object\.entries\(regions\)\) \{\s*if \(!trim\.test\(key\)\) continue;\s*for \(const c of chunks\) \{\s*if \(!c\.toEnd \|\| !ink\[c\.p\]\) continue;/);
  // titlul unui subiect nu rămâne singur la capătul paginii
  assert.match(src, /if \(\(b\.head \|\| b\.keep\) && cursor > TOP\) \{/);
  // API-ul vechi rămâne (generatorul de subiecte și agentul din Admin)
  assert.match(src, /export async function combineExamPdfs\(sources, \{ onProgress, subjects = \[1, 2, 3\], selection = null \} = \{\}\)/);
  assert.match(src, /return \{ bytes: r\.bytes, report: r\.report, sources: r\.sources, text: r\.text, pageTexts: r\.pageTexts, pages: r\.pages \};/);
});

// ═════════════════════ 2) testul pe grupă în format PDF ═════════════════════
// (1 nov. 2026: generatorul s-a MUTAT din „👥 Test pe grupă" → „⚡ Generează acum
//  testele" în „🧩 Generează exerciții/teste interactive/PDF" → „👥 Teste diferite /
//  elev" — vezi și test/teste-diferite-fise.test.js)
test('„👥 Teste diferite / elev" → „🎓 Subiectele de examen": teste PDF combinate din subiectele site-ului; testul pe grupă le primește bifate', () => {
  const td = read('src/components/TesteDiferite.jsx');
  // se încarcă doar la nevoie (motorul pdf.js + pdf-lib)
  assert.match(td, /const CombinedPdfGenerator = lazy\(\(\) => import\('\.\/CombinedPdfGenerator'\)\);/);
  assert.match(td, /\{sursaEf === 'subiecte' && \(\s*<Suspense fallback=\{[\s\S]{0,160}\}>\s*<CombinedPdfGenerator poolSize=\{n\}[\s\S]{0,200}onDone=\{onDone\}/);
  assert.match(td, /\{sursaEf === 'variante' && \(\s*<VariantGenerator poolSize=\{n\}/);
  // în testul pe grupă nu mai e generatorul — doar trimiterea spre el și testele aduse, bifate
  const ga = read('src/components/GroupAssignment.jsx');
  assert.doesNotMatch(ga, /CombinedPdfGenerator|<VariantGenerator|genNow/);
  assert.match(ga, /🧩 Deschide generatorul/);
  // testele aduse din „Teste diferite / elev" intră ca „Testele generate de mine", bifate
  assert.match(ga, /setSources\(\['personal'\]\);\s*setPresetItems\(items\);\s*setChecked\(items\);\s*setPick\('manual'\);/);
  assert.match(ga, /function chooseFormat\(id\) \{[\s\S]{0,140}if \(presetItems\.length\) \{ setPresetItems\(\[\]\); setChecked\(\[\]\); setPick\('auto'\); \}/);
});

test('generatorul PDF: subiectele alese, salvare + publicare + descărcare, bazinul testului pe grupă', () => {
  const g = read('src/components/CombinedPdfGenerator.jsx');
  assert.match(g, /SUBJECT_CHOICES\.map\(\(c\) => \(/);
  assert.match(g, /const TEST_SUBCATS = new Set\(\['variante', 'simulari', 'teste-antrenament', ''\]\);/);
  assert.match(g, /fetchPdfSources\(stratifyBySubcategory\(rows\), getUrlFor, \{[\s\S]{0,140}probe: probeExamPdf/);
  assert.match(g, /const planuri = planCombinations\(prep\.list, \{ count: n, subjects, selection: selectie \}\);/);
  assert.match(g, /header: complet \? null : \(latime, info2\) => makeHeaderPng\(/);
  assert.match(g, /await aiClient\.saveCombinedPdf\(\{[\s\S]{0,500}text: r\.text, pageTexts: r\.pageTexts/);
  assert.match(g, /onDone\?\.\(teste\.map\(\(t\) => \(\{ source: 'personal', refId: t\.privateId, title: t\.title, isFree: true \}\)\), \{ format: 'pdf', category: cfg\.category \}\);/);
  // (1 nov. 2026, seara) mai multe teste = un SET, salvat ca un singur PDF (test/teste-set-variante.test.js);
  // „Descarcă toate…" rămâne doar dacă setul n-a putut fi salvat
  assert.match(g, /⬇ Descarcă toate testele într-un singur PDF/);
  assert.match(g, /⬇ Descarcă PDF-ul cu toate cele \{rezultat\.teste\.length\} variante/);
  assert.match(g, /mergePdfs\(/);
  assert.match(g, /descarca\(t\.blob, `\$\{slug\(t\.title\)\}\.pdf`\)/);
  assert.match(g, /const context = `\$\{exam\.short\}\$\{complet \? '' : ` · \$\{sl\}`\}\$\{alese \? ' \(exerciții alese\)' : ''\}`;/);
  assert.match(g, /const titlu = multe \? variantTitle\(`Test combinat — \$\{context\}`, plan\.index\) : `Test combinat nr\. \$\{nr\} — \$\{context\}`;/);
});

test('aiClient.saveCombinedPdf: copia privată + publicarea în bibliotecă (copia privată ține minte publicId)', () => {
  const c = read('src/lib/aiClient.js');
  const f = c.slice(c.indexOf('async saveCombinedPdf('), c.indexOf('async nextCombinedTestNumber('));
  assert.match(f, /supabase\.storage\.from\('personal-pdfs'\)\s*\.upload\(path, blob/);
  assert.match(f, /this\.saveLibraryItem\(\{ kind: 'pdf', title, category, topic, payload \}\)/);
  // (copia publică a unui set nu are lista variantelor private — `pub`)
  assert.match(f, /post\('\/api\/ai-public', \{ action: 'publish', kind: 'pdf', title, category, topic, payload: pub \}\)/);
  assert.match(f, /const withPub = \{ \.\.\.payload, publicId: r\.id \};/);
  assert.match(f, /update\(\{ title: finalTitle, payload: withPub \}\)/);
  assert.match(f, /publishError: e\.message \|\| 'publicarea a eșuat'/, 'publicarea picată nu pierde testul salvat');
  // numerotarea continuă de la un lot la altul (din 1 nov. 2026 numără și testele kind 'exam')
  assert.match(c, /async nextCombinedTestNumber\(\) \{\s*return this\.nextNumberedTitle\('Test combinat nr\.'\);/);
  assert.match(c, /\.ilike\('title', `\$\{prefix\}%`\)/);
  // „Testele mele": PDF-ul se descarcă; un PDF deja publicat nu se mai publică o dată
  const pv = read('src/pages/ProfesorVirtual.jsx');
  assert.match(pv, /async function downloadPdf\(\)/);
  assert.match(pv, /\{it\.kind === 'pdf' && \(\s*<button className="btn btn-sm btn-outline" disabled=\{downloading\} onClick=\{downloadPdf\}>/);
  // (și testele kind 'exam' publicate automat din „👥 Teste diferite / elev")
  assert.match(pv, /if \(_pub\) \{\s*const deja = await aiClient\.publicGet/);
});

test('bazinul: testele PDF generate (ai_personal_items, kind pdf) se aleg și se deschid de elev fără abonament', async () => {
  const supa = createFakeSupabase({
    ai_personal_items: [
      { id: 'p1', user_id: 'prof', kind: 'pdf', title: 'Test combinat nr. 1 — Evaluare Națională · Subiectul I', category: 'evaluare-nationala', payload: { pdfPath: 'prof/1.pdf', bucket: 'personal-pdfs', publicId: 'pub1' } },
      { id: 'p2', user_id: 'prof', kind: 'pdf', title: 'Test combinat nr. 2 — Evaluare Națională · Subiectul I', category: 'evaluare-nationala', payload: { pdfPath: 'prof/2.pdf', bucket: 'personal-pdfs' } },
      { id: 'x9', user_id: 'alt-prof', kind: 'pdf', title: 'al altcuiva', payload: { pdfPath: 'alt/9.pdf' } },
    ],
  });
  const pool = await cat.resolveChosen(supa, 'prof', [{ source: 'personal', refId: 'p2' }, { source: 'personal', refId: 'p1' }, { source: 'personal', refId: 'x9' }], 'pdf', 60);
  assert.deepStrictEqual(pool.map((p) => p.refId), ['p2', 'p1'], 'ordinea bifelor; testul altui profesor nu intră');
  assert.ok(pool.every((p) => p.kind === 'pdf' && p.isFree === true));
  const t = await cat.resolveTarget(supa, { source: 'personal', ref_id: 'p1' }, { userId: 'elev', profile: { subscription_status: 'inactive' } });
  assert.strictEqual(t.type, 'pdf-file');
  assert.match(t.url, /personal-pdfs\/prof\/1\.pdf/);
});

// ═════════════════ 3) „📄 Generează subiect examen" în meniul profesorilor ═════════════════
test('meniul „🎓 Examene": profesorii au „📄 Generează subiect examen" → Asistent AI, fila generatorului', async () => {
  const M = await meniu();
  assert.deepStrictEqual(M.EXAMEN_GENERATOR, { to: '/profesor-virtual?tab=exam', label: '📄 Generează subiect examen', accent: true });
  assert.strictEqual(M.examenePentru({ isTeacher: false }), M.EXAMENE);
  assert.deepStrictEqual(M.examenePentru({ isTeacher: true }), [...M.EXAMENE, M.EXAMEN_GENERATOR]);
  const examene = (opts) => M.sectiuniMeniu(opts).flatMap((s) => s.items).find((i) => i.cheie === 'examene').copii;
  assert.ok(examene({ isTeacher: true }).some((c) => c.to === '/profesor-virtual?tab=exam'), 'meniul lateral + drawer-ul ☰');
  assert.ok(!examene({ isTeacher: false }).some((c) => c.to === '/profesor-virtual?tab=exam'), 'elevii nu-l au');
  assert.ok(!examene({}).some((c) => c.accent));

  const nav = read('src/components/Navbar.jsx');
  assert.match(nav, /<DesktopDropdown label="🎓 Examene" items=\{examenePentru\(\{ isTeacher \}\)\} accent \/>/);
  assert.match(nav, /<Sidebar[\s\S]{0,120}isTeacher=\{isTeacher\}/);
  assert.match(nav, /<MobileMenu[\s\S]{0,200}isTeacher=\{isTeacher\}/);
  assert.match(read('src/components/Sidebar.jsx'), /sectiuniMeniu\(\{ user, isAdmin, isTeacher, isPremium/);

  // pagina deschide fila din adresă (și când e deja deschisă)
  const pv = read('src/pages/ProfesorVirtual.jsx');
  assert.match(pv, /const tabParam = params\.get\('tab'\);/);
  assert.match(pv, /useEffect\(\(\) => \{ if \(tabParam\) setTabAles\(tabParam\); \}, \[tabParam\]\);/);
  assert.match(pv, /\{ id: 'exam', label: '📄 Generează subiect examen' \}/);
  assert.match(pv, /\{tab === 'exam' && <ExamGenerator canManage=\{isTeacher\} \/>\}/);
  // (8 nov. 2026: și „🎯 Pregătește-mă de examen" e un link spre altă pagină, nu o filă)
  assert.match(pv, /const tab = TABS\.some\(\(t\) => t\.id === tabAles && t\.id !== 'meditatii' && t\.id !== 'pregatire'\) \? tabAles : 'chat';/, 'elevul care deschide ?tab=exam ajunge la chat');
});
