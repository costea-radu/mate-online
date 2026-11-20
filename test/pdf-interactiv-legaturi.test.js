// =====================================================================
// test/pdf-interactiv-legaturi.test.js — legătura PDF ↔ testul interactiv peste tot pe site
// (20 nov. 2026): „Fă o legătură mai bună între testele PDF și testele interactive și asociază-le."
//
// src/lib/pdfInteractiv.js, src/components/ContentPage.jsx (cardurile), src/components/ExamContent.jsx,
// src/pages/InteractiveViewer.jsx (banda cu PDF-ul testului deschis direct), src/pages/Admin.jsx.
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
let mod = null;
const load = async () => { if (!mod) mod = await import('../src/lib/pdfInteractiv.js'); return mod; };

// o listă ca pe pagina BAC: PDF-ul cu testul generatorului (Premium) + testul vechi, gratuit
const PDF = { id: 'pdf-1', content_type: 'pdf', title: '2026 mate-info varianta 03', category: 'bacalaureat', subcategory: 'variante', interactiv_id: 'test-nou' };
const FISA = { id: 'pdf-2', content_type: 'pdf', title: 'Fișă 9: Trigonometrie', category: 'clasa-7', subcategory: null, interactiv_id: 'test-fisa' };
const FARA = { id: 'pdf-3', content_type: 'pdf', title: 'Simulare 2025', category: 'bacalaureat', subcategory: 'simulari', interactiv_id: null };
const TEST = { id: 'test-x', content_type: 'interactive', title: 'Test interactiv EN - 3', category: 'evaluare-nationala', subcategory: 'teste-interactive', pdf_sursa_id: 'pdf-en-3' };
const COMBINAT = { id: 'test-32', content_type: 'interactive', title: 'Test 33 · Evaluare Națională', category: 'evaluare-nationala', subcategory: 'teste-interactive', pdf_sursa_id: null };

const ROWS = [
  { id: 'test-nou', content_type: 'interactive', title: 'BAC 2026 · M_mate-info · Varianta 3', is_free: false, created_at: '2026-10-01', pdf_sursa_id: 'pdf-1' },
  { id: 'test-vechi', content_type: 'interactive', title: 'Bac 2026 varianta 3 (iulie)', is_free: true, created_at: '2026-07-20', pdf_sursa_id: 'pdf-1' },
  { id: 'test-fisa', content_type: 'interactive', title: 'Fișă de lucru – Trigonometrie', is_free: true, created_at: '2026-08-01', pdf_sursa_id: 'pdf-2' },
  { id: 'pdf-en-3', content_type: 'pdf', title: '2021 model 3', category: 'evaluare-nationala', subcategory: 'variante', is_free: false, interactiv_id: 'test-x' },
];

// ═══════════════════════════ ce se aduce, ce se leagă ═══════════════════════════
test('deAdus(): perechile cardurilor (testul principal al PDF-ului, PDF-ul testului) și PDF-urile cu test', async () => {
  const { deAdus } = await load();
  const r = deAdus([PDF, FISA, FARA, TEST, COMBINAT, null, { content_type: 'manual', id: 'm' }]);
  assert.deepStrictEqual(r.ids.sort(), ['pdf-en-3', 'test-fisa', 'test-nou']);
  assert.deepStrictEqual(r.pdfIds.sort(), ['pdf-1', 'pdf-2']);
  assert.deepStrictEqual(deAdus([]), { ids: [], pdfIds: [] });
  assert.deepStrictEqual(deAdus(null), { ids: [], pdfIds: [] });
});

test('construiesteLegaturi(): PDF → testele lui (principalul + cele făcute după el), test → PDF-ul lui', async () => {
  const { construiesteLegaturi } = await load();
  const leg = construiesteLegaturi([PDF, FISA, FARA, TEST, COMBINAT], ROWS);
  assert.deepStrictEqual(Object.keys(leg).sort(), ['pdf-1', 'pdf-2', 'test-x'], 'fără legătură: PDF-ul fără test, testul combinat');
  assert.strictEqual(leg['pdf-1'].tip, 'pdf');
  assert.strictEqual(leg['pdf-1'].principalId, 'test-nou');
  assert.deepStrictEqual(leg['pdf-1'].teste.map((t) => t.id).sort(), ['test-nou', 'test-vechi']);
  assert.deepStrictEqual(leg['test-x'], { tip: 'interactive', pdf: { id: 'pdf-en-3', title: '2021 model 3', content_type: 'pdf', category: 'evaluare-nationala', subcategory: 'variante', is_free: false, created_at: null } });
  // pagina clasei are în listă și PDF-ul, și testul: perechea se ia din listă, fără să mai fie adusă
  const clasa = construiesteLegaturi([FISA, { ...ROWS[2] }], []);
  assert.deepStrictEqual(clasa['pdf-2'].teste.map((t) => t.id), ['test-fisa']);
  assert.strictEqual(clasa['test-fisa'].pdf.title, 'Fișă 9: Trigonometrie');
  // testul șters / ascuns: cardul testului rămâne fără legătură; PDF-ul își păstrează principalul (vizualizatorul îl arată la fel)
  const lipsa = construiesteLegaturi([PDF, TEST], []);
  assert.strictEqual(lipsa['test-x'], undefined);
  assert.deepStrictEqual(lipsa['pdf-1'], { tip: 'pdf', principalId: 'test-nou', teste: [] });
  // un rând care nu e PDF nu devine „PDF-ul testului"
  assert.strictEqual(construiesteLegaturi([TEST], [{ id: 'pdf-en-3', content_type: 'interactive' }])['test-x'], undefined);
});

test('testulPdfului(): același test ca „🧩 Interactiv" din vizualizator — fără abonament, testul gratuit al PDF-ului', async () => {
  const { construiesteLegaturi, testulPdfului, alegeTestInteractiv } = await load();
  const leg = construiesteLegaturi([PDF, FISA], ROWS);
  assert.strictEqual(testulPdfului(leg['pdf-1'], true).id, 'test-nou');
  assert.strictEqual(testulPdfului(leg['pdf-1'], true).premium, false);
  assert.strictEqual(testulPdfului(leg['pdf-1'], false).id, 'test-vechi', 'gratuitul, pentru elevul fără abonament');
  assert.strictEqual(testulPdfului(leg['pdf-1'], false).premium, false);
  const doarPremium = construiesteLegaturi([PDF], [ROWS[0]]);
  assert.deepStrictEqual([testulPdfului(doarPremium['pdf-1'], false).id, testulPdfului(doarPremium['pdf-1'], false).premium], ['test-nou', true], '„🧩 Interactiv ⭐"');
  assert.strictEqual(testulPdfului(leg['pdf-2'], false).title, 'Fișă de lucru – Trigonometrie');
  assert.strictEqual(testulPdfului(null, true), null);
  assert.strictEqual(testulPdfului({ tip: 'interactive', pdf: {} }, true), null);
  // regula e aceeași funcție ca în vizualizator
  assert.match(read('src/pages/PDFViewer.jsx'), /const testAles = alegeTestInteractiv\(testePdf, interactivPrincipal, areAcces\);/);
  assert.strictEqual(typeof alegeTestInteractiv, 'function');
});

test('stareTestDinPdf(): testul deschis de pe cardul PDF-ului — „← Înapoi" la listă, „📄 Deschide PDF-ul", cumul la testele întregi', async () => {
  const { stareTestDinPdf, starePdfDinTest, esteTestIntreg } = await load();
  const retur = { returnTo: '/bacalaureat/mate-info', scrollToCardId: 'pdf-1', returnTab: 'pdf', returnSubcategory: 'variante', returnContentType: 'pdf' };
  const st = stareTestDinPdf(PDF, retur);
  assert.strictEqual(st.returnTo, '/bacalaureat/mate-info', '„← Înapoi" din test duce la listă');
  assert.strictEqual(st.scrollToCardId, 'pdf-1');
  assert.deepStrictEqual(Object.keys(st.dinPdf).sort(), ['adauga', 'dinLista', 'id', 'stare', 'title']);
  assert.strictEqual(st.dinPdf.dinLista, true);
  assert.strictEqual(st.dinPdf.adauga, true, 'variantele de BAC: exercițiile testului se adaugă la punctajul PDF-ului');
  assert.strictEqual(st.dinPdf.stare.item, PDF, 'PDF-ul se deschide cu rândul lui și cu întoarcerea la listă');
  assert.strictEqual(st.dinPdf.stare.returnTo, '/bacalaureat/mate-info');
  assert.strictEqual(stareTestDinPdf(FISA, {}).dinPdf.adauga, false, 'la fișe punctajul PDF-ului rămâne');
  assert.strictEqual(stareTestDinPdf(FISA, {}).scrollToCardId, 'pdf-2');
  // PDF-ul testului: fără `item` (vizualizatorul aduce singur rândul întreg), cu întoarcerea testului
  const sp = starePdfDinTest({ returnTo: '/evaluare-nationala', scrollToCardId: 'test-x', returnTab: 'interactive', srcDoc: '<html>', item: TEST });
  assert.deepStrictEqual(sp, { returnTo: '/evaluare-nationala', scrollToCardId: 'test-x', returnTab: 'interactive', returnSubcategory: null, returnContentType: null });
  assert.deepStrictEqual(starePdfDinTest(), { returnTo: null, scrollToCardId: null, returnTab: null, returnSubcategory: null, returnContentType: null });
  // testele întregi de examen: aceleași rubrici ca pe server (api/_lib/punctajCumulat.js → testIntreg)
  const PC = require('../api/_lib/punctajCumulat');
  for (const p of [PDF, FISA, FARA, { category: 'evaluare-nationala', subcategory: 'variante-ai' }, { category: 'bacalaureat', subcategory: 'capitole' }, null]) {
    assert.strictEqual(esteTestIntreg(p), PC.testIntreg(p), JSON.stringify(p));
  }
});

test('incarcaLegaturi(): câteva cereri pe toată lista (pe bucăți), nu una pe card; o eroare → fără legături', async () => {
  const { incarcaLegaturi, COLOANE_LEGATURA } = await load();
  const cereri = [];
  const fake = {
    from(t) {
      const q = { t, filtre: [] };
      cereri.push(q);
      const b = {
        select(c) { q.cols = c; return b; },
        eq(k, v) { q.filtre.push(['eq', k, v]); return b; },
        in(k, v) { q.filtre.push(['in', k, v]); return b; },
        then(ok, ko) {
          const inn = q.filtre.find((f) => f[0] === 'in');
          const data = ROWS.filter((r) => inn[2].includes(r[inn[1]]) && q.filtre.every((f) => f[0] !== 'eq' || r[f[1]] === f[2]));
          return Promise.resolve({ data, error: null }).then(ok, ko);
        },
      };
      return b;
    },
  };
  const leg = await incarcaLegaturi(fake, [PDF, FISA, FARA, TEST, COMBINAT]);
  assert.strictEqual(cereri.length, 2, 'perechile după id + testele făcute după PDF-uri');
  assert.ok(cereri.every((q) => q.t === 'content' && q.cols === COLOANE_LEGATURA));
  assert.deepStrictEqual(cereri[1].filtre[0], ['eq', 'content_type', 'interactive']);
  assert.deepStrictEqual(leg['pdf-1'].teste.map((t) => t.id).sort(), ['test-nou', 'test-vechi']);
  assert.strictEqual(leg['test-x'].pdf.title, '2021 model 3');
  // 130 de PDF-uri cu test → bucăți de câte 60 (URL-ul cererii are o limită)
  cereri.length = 0;
  const multe = Array.from({ length: 130 }, (_, i) => ({ id: `p${i}`, content_type: 'pdf', interactiv_id: `t${i}` }));
  await incarcaLegaturi(fake, multe);
  assert.strictEqual(cereri.length, 6);
  assert.ok(cereri.every((q) => q.filtre.find((f) => f[0] === 'in')[2].length <= 60));
  // fără nimic de legat → nicio cerere
  cereri.length = 0;
  assert.deepStrictEqual(await incarcaLegaturi(fake, [FARA, COMBINAT]), {});
  assert.strictEqual(cereri.length, 0);
  // cererea care cade nu strică lista
  const stricat = { from: () => ({ select() { return this; }, eq() { return this; }, in() { return Promise.reject(new Error('rețea')); } }) };
  assert.deepStrictEqual(Object.keys(await incarcaLegaturi(stricat, [PDF, TEST])), ['pdf-1'], 'PDF-ul își păstrează principalul, fără teste aduse');
});

// ═══════════════════════════ cardurile din liste ═══════════════════════════
test('cardurile: „🧩 Interactiv" pe PDF-ul cu test, „📄 PDF" și „📄 Făcut după PDF-ul „…"" pe test', () => {
  const cp = read('src/components/ContentPage.jsx');
  assert.match(cp, /import \{ incarcaLegaturi, testulPdfului, stareTestDinPdf, starePdfDinTest \} from '\.\.\/lib\/pdfInteractiv';/);
  assert.match(cp, /export function useLegaturiPdf\(items\) \{/);
  assert.match(cp, /incarcaLegaturi\(supabase, items\)\.then\(\(m\) => \{ if \(viu\) setLegaturi\(m \|\| \{\}\); \}/);
  assert.match(cp, /export function ContentCard\(\{ item, isPremium, user, progress, rating, _overrideSrcDoc, forceTab, legatura \}\) \{/);
  assert.match(cp, /const testPereche = isPdf && !_overrideSrcDoc \? testulPdfului\(legatura, isPremium \|\| isAdmin\) : null;/);
  assert.match(cp, /navigate\(`\/exercitiu\?id=\$\{testPereche\.id\}`, \{ state: stareTestDinPdf\(item, retur\) \}\);/);
  assert.match(cp, /navigate\(`\/pdf-viewer\?id=\$\{pdfPereche\.id\}`, \{ state: starePdfDinTest\(retur\) \}\);/);
  assert.match(cp, /🧩 Interactiv\{testPereche\.premium \? ' ⭐' : ''\}/);
  assert.match(cp, /📄 PDF\{pdfPereche\.is_free === false && !\(isPremium \|\| isAdmin\) \? ' ⭐' : ''\}/);
  assert.match(cp, /📄 Făcut după PDF-ul „\{pdfPereche\.title\}"/);
  assert.match(cp, /🧩 Are test interactiv\{testPereche\.title \? `: „\$\{testPereche\.title\}"` : ''\}/);
  // pagina clasei (și capitolele ei) și listele de examen dau cardurilor legăturile
  assert.match(cp, /const legaturi = useLegaturiPdf\(items\);/);
  assert.match(cp, /rating=\{ratingMap\[item\.id\]\} legatura=\{legaturi\[item\.id\]\} \/>/);
  const ex = read('src/components/ExamContent.jsx');
  assert.match(ex, /import \{ ContentCard, useLegaturiPdf \} from '\.\/ContentPage';/);
  assert.match(ex, /const legaturi = useLegaturiPdf\(items\);/);
  assert.match(ex, /forceTab=\{returnTab\} legatura=\{legaturi\[item\.id\]\} \/>/);
  // baremele (fila lor) nu primesc perechea
  assert.doesNotMatch(read('src/components/BaremeClasa.jsx'), /legatura=/);
});

// ═══════════════════════════ testul deschis direct ═══════════════════════════
test('testul interactiv deschis direct își arată PDF-ul: banda, „📄 Deschide PDF-ul", exercițiile intră în punctajul PDF-ului', () => {
  const iv = read('src/pages/InteractiveViewer.jsx');
  assert.match(iv, /import \{ esteTestIntreg, starePdfDinTest \} from '\.\.\/lib\/pdfInteractiv';/);
  assert.match(iv, /const pdfLegat = dinPdf \|\| pdfSursa;/);
  // nu în tema pe grupă, duel, tema de la Meditator, sesiunea de meditații
  assert.match(iv, /const pdfSursaId = !dinPdf && !gtId && !duelId && !temaId && !medSesId && item && item\.content_type === 'interactive' && item\.pdf_sursa_id \? item\.pdf_sursa_id : null;/);
  assert.match(iv, /supabase\.from\('content'\)\.select\('id, title, category, subcategory, content_type'\)\.eq\('id', pdfSursaId\)\.maybeSingle\(\)/);
  assert.match(iv, /setPdfSursa\(\{ id: data\.id, title: data\.title \|\| '', adauga: esteTestIntreg\(data\), stare: starePdfDinTest\(state \|\| \{\}\), direct: true \}\);/);
  assert.match(iv, /navigate\(`\/pdf-viewer\?id=\$\{pdfLegat\.id\}`, \{ state: pdfLegat\.stare && typeof pdfLegat\.stare === 'object' \? pdfLegat\.stare : undefined \}\);/);
  assert.match(iv, /\{pdfLegat && \(\s*\n\s*<div data-din-pdf role="status"/);
  assert.match(iv, /'— exercițiile rezolvate aici intră și în punctajul PDF-ului'/);
  assert.match(iv, /'— îl poți rezolva și pe PDF: cu poză, în chat sau pe foaia de lucru'/);
  assert.match(iv, /\.eq\('user_id', user\.id\)\.eq\('content_id', pdfLegat\.id\)\.maybeSingle\(\);/);
  assert.match(iv, /\}, \[user, item, temaId, medSesId, authLoading, pdfLegat\?\.id\]\);/);
  assert.doesNotMatch(iv, /\{dinPdf && \(/, 'banda e a oricărui test cu PDF, nu doar a celui deschis din PDF');
});

test('serverul: testul deschis direct (făcut după PDF — pdf_sursa_id) intră în punctajul PDF-ului; alt PDF — nu', () => {
  const s = read('api/ai-score.js');
  assert.match(s, /const legat = !!pdf && \(pdf\.interactiv_id === interactiv\.id \|\| interactiv\.pdf_sursa_id === pdf\.id\);/);
  assert.match(s, /if \(!pdf \|\| pdf\.content_type !== 'pdf' \|\| !legat\) return null;/);
});

// ═══════════════════════════ adminul ═══════════════════════════
test('Admin → Tot Conținutul: perechea fiecărui PDF / test și filtrul „PDF ↔ test" (asociate / neasociate)', () => {
  const a = read('src/pages/Admin.jsx');
  assert.match(a, /import \{ useState, useEffect, useRef, useMemo \} from 'react';/);
  assert.match(a, /useState\(\{ category: '', type: '', q: '', kind: '', pereche: '' \}\)/);
  assert.match(a, /const deLegat = \(i\) => \(i\.content_type === 'pdf' \|\| i\.content_type === 'interactive'\) && !esteBarem\(i\);/);
  assert.match(a, /\(!filter\.pereche \|\| \(deLegat\(i\) && \(filter\.pereche === 'cu' \? !!pereche\(i\) : !pereche\(i\)\)\)\)/);
  assert.match(a, /<option value="cu">🔗 Asociate \(PDF ↔ test\)<\/option>/);
  assert.match(a, /<option value="fara">⛓️‍💥 Neasociate<\/option>/);
  assert.match(a, /🧩 Test interactiv: „\{p\.title\}"/);
  assert.match(a, /📄 Făcut după PDF-ul „\{p\.title\}"/);
  assert.match(a, /'📄 nefăcut după un PDF'/);
});
