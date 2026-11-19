// =====================================================================
// test/pdf-interactiv.test.js — PDF ↔ testul interactiv + punctajul cumulat (19 nov. 2026)
//   „1. Asociază fiecare PDF cu testul interactiv generat după el. Verifică să fie
//    asocierea corectă. 2. Fă ca în butonul «rezolvă pe PDF» de pe PDF-uri, pe lângă
//    variantele de rezolvare din rolldown, să apară și «interactiv», care deschide testul
//    interactiv asociat PDF-ului. Pentru testele de evaluare națională fă să apară sub
//    «pe PDF» iar la celelalte tipuri de PDF: bac și clase, să apară primul. La schimbarea
//    metodei de rezolvare în timpul rezolvării, să se păstreze punctajul acumulat până atunci."
//
// supabase/pdf_interactiv.sql, api/_lib/punctajCumulat.js, api/rezolva-pdf.js,
// api/ai-correct.js, api/ai-handwriting.js, api/ai-score.js, api/_lib/exgen.js,
// api/_lib/contentAdmin.js, src/pages/PDFViewer.jsx, src/pages/InteractiveViewer.jsx,
// src/lib/tutorBridge.js, src/components/AITutor.jsx, src/components/ContentAdminTools.jsx.
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const PC = require('../api/_lib/punctajCumulat');
const { createFakeSupabase } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const T0 = Date.parse('2026-11-19T10:00:00Z');
const H = 3600 * 1000;

// ═══════════════════════════ baza de date ═══════════════════════════
test('SQL: content.interactiv_id (PDF → test, on delete set null) + progress.itemi; fără tabele noi', () => {
  const sql = read('supabase/pdf_interactiv.sql');
  assert.match(sql, /alter table public\.content\s+add column if not exists interactiv_id uuid references public\.content\(id\) on delete set null;/);
  assert.match(sql, /create index if not exists idx_content_interactiv\s+on public\.content\(interactiv_id\) where interactiv_id is not null;/);
  assert.match(sql, /alter table public\.progress\s+add column if not exists itemi jsonb;/);
  assert.doesNotMatch(sql, /create table/i, 'fără tabele noi (regula GRANT din CLAUDE.md nu se aplică)');
});

// ═══════════════════════════ cheile exercițiilor ═══════════════════════════
test('cheie(): aceeași cheie pentru toate metodele (formular, harta PDF-ului, testul interactiv, foaia)', () => {
  const cazuri = [
    ['I.3', '1.3'], ['1.3', '1.3'], ['III.1.a', '3.1.a'], ['iii.2a', '3.2.a'], ['3.2.b', '3.2.b'], ['II.1', '2.1'], ['I-6', '1.6'],
    ['Subiectul II Geometrie — alegeți varianta corectă, exercițiul 4', '2.4'],
    ['Subiectul al III-lea, exercițiul 2 a)', '3.2.a'],
    ['Subiectul III, ex. 2 a)', '3.2.a'],
    ['subiectul I exercitiul 6', '1.6'],
    ['1.a', '1.a'], ['2', '2'], ['Ex. 3', 'ex.3'],
  ];
  for (const [lbl, k] of cazuri) assert.strictEqual(PC.cheie(lbl), k, lbl);
  assert.strictEqual(PC.cheie(''), null);
  assert.ok(PC.deExamen('3.2.a') && PC.deExamen('1.6') && !PC.deExamen('1.a') && !PC.deExamen('exercitiul3'));
});

test('din fiecare metodă: doar exercițiile corectate (necompletatul / ⭐ Premium nu șterg nimic)', () => {
  assert.deepStrictEqual(PC.dinRezolvaPdf([
    { key: '1.1', puncte: 5, puncte_max: 5, verdict: 'corect' },
    { key: '1.4', puncte: 0, puncte_max: 5, verdict: 'necompletat' },
    { key: '1.5', puncte: null, puncte_max: 5, verdict: 'blocat', blocat: true },
    { key: '3.1', puncte: 3, puncte_max: 5, verdict: 'partial', parti: [{ l: 'a', puncte: 2, puncte_max: 2, verdict: 'corect' }, { l: 'b', puncte: 1, puncte_max: 3, verdict: 'partial' }] },
    { key: '3.2', puncte: 2, puncte_max: 5, verdict: 'partial', parti: [{ l: 'a', puncte: 2, puncte_max: 2, verdict: 'corect' }, { l: 'b', puncte: 0, puncte_max: 3, verdict: 'necompletat' }] },
  ]), [{ k: '1.1', p: 5, m: 5 }, { k: '3.1.a', p: 2, m: 2 }, { k: '3.1.b', p: 1, m: 3 }, { k: '3.2.a', p: 2, m: 2 }]);
  assert.deepStrictEqual(PC.dinFormular([
    { id: 'I.2', answered: true, verdict: 'corect', puncte: 5, maxPuncte: 5 },
    { id: 'I.5', answered: false, verdict: 'necompletat', puncte: 0, maxPuncte: 5 },
    { id: 'III.1.b', answered: true, verdict: 'partial', puncte: 9, maxPuncte: 3 },   // plafonat la maxim
  ]), [{ k: '1.2', p: 5, m: 5 }, { k: '3.1.b', p: 3, m: 3 }]);
  assert.deepStrictEqual(PC.dinFoaie([
    { eticheta: 'Subiectul III, ex. 2 a)', puncte: 2, puncte_max: 2, verdict: 'corect' },
    { eticheta: 'Exercițiul', puncte: 3, puncte_max: 5, verdict: 'partial' },          // fără loc în test
  ]), [{ k: '3.2.a', p: 2, m: 2 }]);
  assert.deepStrictEqual(PC.dinInteractiv([
    { lbl: 'III.1', p: 5, m: 5 }, { lbl: 'Subiectul II, exercițiul 3', p: 0, m: 5 }, { lbl: 'Exercițiul 4', p: 3, m: 3 }, { lbl: 'I.1', p: 7, m: 5 },
  ]), [{ k: '3.1', p: 5, m: 5 }, { k: '2.3', p: 0, m: 5 }, { k: '1.1', p: 5, m: 5 }]);
});

// ═══════════════════════════ cumulul ═══════════════════════════
test('combina(): pe PDF → în chat → în testul interactiv — punctele se adună, refăcutul se înlocuiește', () => {
  const pdf = PC.combina(null, PC.dinRezolvaPdf([
    { key: '1.1', puncte: 5, puncte_max: 5, verdict: 'corect' },
    { key: '1.2', puncte: 0, puncte_max: 5, verdict: 'gresit' },
    { key: '3.1', puncte: 3, puncte_max: 5, verdict: 'partial', parti: [{ l: 'a', puncte: 2, puncte_max: 2, verdict: 'corect' }, { l: 'b', puncte: 1, puncte_max: 3, verdict: 'partial' }] },
  ]), { metoda: 'pdf', acum: T0, max: 90 });
  assert.deepStrictEqual([pdf.score, pdf.max, pdf.nAlte, pdf.continuat], [8, 90, 0, false]);
  assert.strictEqual(pdf.itemi.v, 1);

  const chat = PC.combina(pdf.itemi, PC.dinFormular([
    { id: 'I.2', answered: true, verdict: 'corect', puncte: 5, maxPuncte: 5 },     // refăcut: 0 → 5
    { id: 'I.3', answered: true, verdict: 'corect', puncte: 5, maxPuncte: 5 },     // nou
    { id: 'III.1.b', answered: true, verdict: 'corect', puncte: 3, maxPuncte: 3 }, // refăcut: 1 → 3
  ]), { metoda: 'chat', acum: T0 + H, max: 90 });
  assert.deepStrictEqual([chat.score, chat.acum, chat.dinAlte, chat.nAlte, chat.metode, chat.continuat], [20, 13, 7, 2, ['pdf'], true]);
  assert.match(PC.linie(chat, { nota: 2.8 }), /📈 \*\*Punctajul testului, cumulat: 20\/90p\*\* · nota \*\*2,80\*\* — am păstrat și cele 2 exerciții corectate mai devreme \(pe PDF\): 7p\./);

  // exercițiul întreg din testul interactiv înlocuiește subpunctele lui (și invers)
  const inter = PC.combina(chat.itemi, PC.dinInteractiv([{ lbl: 'III.1', p: 5, m: 5 }, { lbl: 'II.1', p: 5, m: 5 }]), { metoda: 'interactiv', acum: T0 + 2 * H, max: 90 });
  assert.deepStrictEqual(Object.keys(inter.itemi.itemi).sort(), ['1.1', '1.2', '1.3', '2.1', '3.1']);
  assert.strictEqual(inter.score, 25);
  assert.deepStrictEqual(inter.metode.sort(), ['chat', 'pdf']);
  const sub = PC.combina(inter.itemi, [{ k: '3.1.a', p: 1, m: 2 }], { metoda: 'poza', acum: T0 + 3 * H, max: 90 });
  assert.ok(!('3.1' in sub.itemi.itemi) && sub.itemi.itemi['3.1.a'].p === 1, '„3.1.a" înlocuiește „3.1"');
});

test('combina(): după 24 h fără corectare începe o rezolvare nouă; cifrele stricate din browser nu trec', () => {
  const a = PC.combina(null, [{ k: '1.1', p: 5, m: 5 }], { metoda: 'pdf', acum: T0, max: 90 });
  const tarziu = PC.combina(a.itemi, [{ k: '1.2', p: 5, m: 5 }], { metoda: 'chat', acum: T0 + 25 * H, max: 90 });
  assert.deepStrictEqual([tarziu.score, tarziu.continuat, tarziu.nAlte], [5, false, 0]);
  assert.strictEqual(PC.valabil(a.itemi, T0 + 23 * H), true);
  assert.strictEqual(PC.valabil({ v: 2, itemi: {} }, T0), false);
  // progress.itemi îl poate scrie și browserul (RLS): puncte peste maxim / maxime uriașe se ignoră
  const stricat = { v: 1, la: new Date(T0).toISOString(), max: 999999, itemi: { '1.1': { p: 500, m: 5 }, '1.2': { p: 5, m: 5000 }, '1.3': { p: 4, m: 5, metoda: 'hack' } } };
  const r = PC.combina(stricat, [{ k: '2.1', p: 5, m: 5 }], { metoda: 'chat', acum: T0 + H, max: 90 });
  assert.deepStrictEqual(Object.keys(r.itemi.itemi).sort(), ['1.3', '2.1']);
  assert.deepStrictEqual([r.score, r.max, r.itemi.itemi['1.3'].metoda], [9, 90, null]);
  // fără maxim dat: maximul de dinainte, plafonat
  assert.strictEqual(PC.combina(stricat, [], { acum: T0 + H }).max, 1000);
});

test('testIntreg(): la variantele / simulările de EN și BAC exercițiile testului interactiv se adaugă; la fișe nu', () => {
  assert.ok(PC.testIntreg({ category: 'evaluare-nationala', subcategory: 'variante' }));
  assert.ok(PC.testIntreg({ category: 'bacalaureat', subcategory: 'simulari' }));
  assert.ok(PC.testIntreg({ category: 'evaluare-nationala', subcategory: 'variante-ai' }));
  assert.ok(!PC.testIntreg({ category: 'bacalaureat', subcategory: 'capitole' }));
  assert.ok(!PC.testIntreg({ category: 'clasa-7', subcategory: null }));
});

// ═══════════════════════════ testul interactiv → PDF ═══════════════════════════
test('api/ai-score → cumuleazaInPdf: doar PDF-ul care are chiar acest test; exercițiile intră în punctajul lui', async () => {
  const { cumuleazaInPdf } = require('../api/ai-score');
  const PDF = '11111111-1111-4111-8111-111111111111', INT = '22222222-2222-4222-8222-222222222222', ALT = '33333333-3333-4333-8333-333333333333';
  const FISA = '44444444-4444-4444-8444-444444444444';
  const supa = createFakeSupabase({
    content: [
      { id: PDF, title: 'BAC 2014 Varianta 01', category: 'bacalaureat', subcategory: 'variante', content_type: 'pdf', interactiv_id: INT },
      { id: FISA, title: 'Fișa 3', category: 'clasa-7', subcategory: null, content_type: 'pdf', interactiv_id: INT },
      { id: INT, title: 'BAC 2014 · Varianta 1 — rezolvare interactivă', category: 'bacalaureat', content_type: 'interactive' },
    ],
    progress: [{ user_id: 'u1', content_id: PDF, score: 10, max_score: 90, attempts: 1, time_spent: 60, completed_at: new Date().toISOString(), itemi: { v: 1, la: new Date().toISOString(), max: 90, itemi: { '1.1': { p: 5, m: 5, metoda: 'pdf' }, '1.2': { p: 5, m: 5, metoda: 'chat' } } } }],
  });
  // alt test decât cel asociat → nimic
  assert.strictEqual(await cumuleazaInPdf(supa, 'u1', { pdfId: PDF, interactiv: { id: ALT }, itemi: [{ lbl: 'I.3', p: 5, m: 5 }] }), null);
  assert.strictEqual(await cumuleazaInPdf(supa, 'u1', { pdfId: 'nu-e-uuid', interactiv: { id: INT }, itemi: [] }), null);
  const r = await cumuleazaInPdf(supa, 'u1', { pdfId: PDF, interactiv: { id: INT }, itemi: [{ lbl: 'I.3', p: 5, m: 5 }, { lbl: 'II.1', p: 10, m: 15 }, { lbl: 'Exercițiul 9', p: 3, m: 3 }] });
  assert.deepStrictEqual([r.adaugat, r.score, r.max, r.nAlte, r.acum], [true, 25, 90, 2, 15]);
  const row = supa.db.tables.progress.find((x) => x.content_id === PDF);
  assert.deepStrictEqual([row.score, row.max_score, row.attempts], [25, 90, 2]);
  assert.deepStrictEqual(Object.keys(row.itemi.itemi).sort(), ['1.1', '1.2', '1.3', '2.1']);
  assert.strictEqual(row.itemi.itemi['2.1'].metoda, 'interactiv');
  // fișa (nu e test întreg de examen): punctajul PDF-ului rămâne, nu se amestecă
  const f = await cumuleazaInPdf(supa, 'u1', { pdfId: FISA, interactiv: { id: INT }, itemi: [{ lbl: 'I.3', p: 5, m: 5 }] });
  assert.deepStrictEqual([f.adaugat, f.score], [false, null]);
  assert.ok(!supa.db.tables.progress.some((x) => x.content_id === FISA));
});

test('api/ai-score: pdfId + itemi în cerere → răspunsul are și punctajul PDF-ului', () => {
  const src = read('api/ai-score.js');
  assert.match(src, /pdfId = null, itemi = null \} = req\.body \|\| \{\};/);
  assert.match(src, /if \(!pdf \|\| pdf\.content_type !== 'pdf' \|\| pdf\.interactiv_id !== interactiv\.id\) return null;/, 'doar testul asociat');
  assert.match(src, /const noi = PC\.testIntreg\(pdf\) \? PC\.dinInteractiv\(itemi\) : \[\];/);
  assert.match(src, /pdfRez = await cumuleazaInPdf\(supa, userId, \{ pdfId, interactiv: content, itemi \}\);/);
  assert.match(src, /pregatire: pregatireRez, pdf: pdfRez \}\);/);
  // salvarea parțială (la 10 s) nu atinge PDF-ul
  assert.ok(src.indexOf('if (partial) {') < src.indexOf('pdfRez = await cumuleazaInPdf('));
});

// ═══════════════════════════ corectările păstrează punctajul ═══════════════════════════
test('✏️ pe PDF (api/rezolva-pdf.js): cumulul pe exerciții, nota testului, mesajul cu „📈 cumulat"', () => {
  const src = read('api/rezolva-pdf.js');
  assert.match(src, /cit = await PC\.citeste\(supa, userId, src\.contentId\);/);
  assert.match(src, /if \(cit\.coloana\) cum = PC\.combina\(cit\.itemi, PC\.dinRezolvaPdf\(items\), \{ metoda: 'pdf', max: sum\.total \}\);/);
  assert.match(src, /score: scorTest, maxScore: maxTest, sessionSeconds: q\.durationSec, itemi: cum \? cum\.itemi : undefined/);
  assert.match(src, /cumul: cum && cum\.nAlte \? \{ \.\.\.cum, nota \} : null,/);
  assert.match(src, /acum: \{ score: sum\.score, total: sum\.total \},/);
  const R = require('../api/_lib/pdfRezolvare');
  const sum = { score: 10, total: 90, pending: [], bySubject: { 1: { atinse: 2, puncte: 10, corectate: 2 }, 2: { atinse: 0 }, 3: { atinse: 0 } }, complete: false };
  const msg = R.formatMessage({ items: [], sum, structura: '6-6-6', title: 'Test', hasBarem: true, nota: 4.5, saved: { kind: 'progress' }, cumul: { score: 35, max: 90, nota: 4.5, nAlte: 4, dinAlte: 25, metode: ['chat', 'poza'] } });
  assert.match(msg, /— \*\*10\/90p\*\* acum/);
  assert.match(msg, /📈 \*\*Punctajul testului, cumulat: 35\/90p\*\* · nota \*\*4,50\*\* — am păstrat și cele 4 exerciții corectate mai devreme \(în chat, cu poză\): 25p\./);
  assert.match(msg, /📝 Nota \*\*4,50\*\* e pe testul așa cum e acum/);
  // fără cumul: mesajul de dinainte
  assert.match(R.formatMessage({ items: [], sum, structura: '6-6-6', title: 'Test', hasBarem: true, nota: 2 }), /— \*\*10\/90p\*\* · cu cele 10p din oficiu: \*\*20p\*\*, nota \*\*2,00\*\*/);
});

test('📷 💬 ✍️ formularul (api/ai-correct.js) și foaia de lucru (api/ai-handwriting.js) păstrează și ele punctajul', () => {
  const c = read('api/ai-correct.js');
  assert.match(c, /const METODE_FORMULAR = \['pdf', 'poza', 'chat', 'foaie'\];/);
  assert.match(c, /cum = PC\.combina\(cit\.itemi, PC\.dinFormular\(graded\), \{ metoda, max: maxScore \}\);/);
  assert.match(c, /contentId, title, category, score: scorTest, maxScore: maxTest, sessionSeconds,\s*\n\s*itemi: cum \? cum\.itemi : undefined,/);
  assert.match(c, /cumulat: cum \? \{ score: scorTest, max: maxTest, pct: pctTest, nota: notaTest, dinAlte: cum\.dinAlte, nAlte: cum\.nAlte, metode: cum\.metode \} : null,/);
  // fără coloana itemi (migrarea nerulată) → salvarea de dinainte
  assert.match(c, /if \(itemi === undefined \|\| error\) \{/);
  const h = read('api/ai-handwriting.js');
  assert.match(h, /cum = PC\.combina\(cit\.itemi, noi, \{ metoda: 'foaie', max: notaT\.total \}\);/);
  assert.match(h, /score: notaT\.score, maxScore: notaT\.total, sessionSeconds: 0, itemi: cum \? cum\.itemi : undefined/);
});

test('saveProgress: cu itemi când există coloana, fără ea altfel (instalări vechi)', async () => {
  const { saveProgress } = require('../api/ai-correct');
  const supa = createFakeSupabase({ progress: [] });
  await saveProgress(supa, 'u1', { contentId: 'c1', title: 'T', category: 'bacalaureat', score: 20.4, maxScore: 90, sessionSeconds: 30, itemi: { v: 1, itemi: {} } });
  const r = supa.db.tables.progress[0];
  assert.deepStrictEqual([r.score, r.max_score, r.attempts, r.time_spent, r.itemi.v], [20, 90, 1, 30, 1]);
  await saveProgress(supa, 'u1', { contentId: 'c1', title: 'T', category: 'bacalaureat', score: 30, maxScore: 90, sessionSeconds: 10 });
  assert.deepStrictEqual([r.score, r.attempts, r.time_spent], [30, 2, 40]);
});

// ═══════════════════════════ „🧩 Interactiv" în vizualizatorul PDF ═══════════════════════════
function ordineDinSursa() {
  const v = read('src/pages/PDFViewer.jsx');
  const a = v.indexOf('export const METODA_INTERACTIV');
  const b = v.indexOf('// testele întregi de examen: exercițiile din testul interactiv');
  const cod = v.slice(a, b).replace(/export /g, '');
  // eslint-disable-next-line no-new-func
  return new Function(`${cod}; return { METODA_INTERACTIV, ordineMetode };`)();
}

test('meniul „✏️ Rezolvă pe PDF ▾": „🧩 Interactiv" la EN sub „Pe PDF", la BAC și la clase primul; doar cu test asociat', () => {
  const { METODA_INTERACTIV, ordineMetode } = ordineDinSursa();
  assert.deepStrictEqual(METODA_INTERACTIV, { id: 'interactiv', icon: '🧩', label: 'Interactiv', scurt: 'Interactiv' });
  const M = ['pdf', 'poza', 'chat', 'foaie'].map((id) => ({ id }));
  const ids = (l) => l.map((m) => m.id);
  assert.deepStrictEqual(ids(ordineMetode(M, { interactiv: true, en: true })), ['pdf', 'interactiv', 'poza', 'chat', 'foaie']);
  assert.deepStrictEqual(ids(ordineMetode(M, { interactiv: true, en: false })), ['interactiv', 'pdf', 'poza', 'chat', 'foaie']);
  assert.deepStrictEqual(ids(ordineMetode(M.slice(1), { interactiv: true, en: true })), ['interactiv', 'poza', 'chat', 'foaie'], 'EN fără „Pe PDF"');
  assert.deepStrictEqual(ids(ordineMetode(M, { interactiv: false, en: true })), ['pdf', 'poza', 'chat', 'foaie']);

  const v = read('src/pages/PDFViewer.jsx');
  assert.match(v, /const interactivId = !isLib && !modTest && item && item\.content_type === 'pdf' && item\.interactiv_id \? item\.interactiv_id : null;/);
  assert.match(v, /const metodeVazute = ordineMetode\(METODE_REZOLVARE\.filter\(\(m\) => \(m\.id === 'pdf' \? \(canSolve \|\| solveGeneric\) : true\)\), \{ interactiv: !!interactivId, en: isEnPdf \}\);/);
  assert.match(v, /if \(m === METODA_INTERACTIV\.id\) \{ deschideInteractiv\(\); return; \}/);
  // nu se ține minte ca metodă implicită (de pe hartă n-ar trebui să plece singur din PDF)
  assert.ok(!METODE_REZOLVARE_IDS(v).includes('interactiv'));
  // deschide testul cu PDF-ul de întoarcere și starea lui
  assert.match(v, /navigate\(`\/exercitiu\?id=\$\{interactivId\}`, \{\s*\n\s*state: \{\s*\n\s*returnTo: `\/pdf-viewer\?id=\$\{item\.id\}`,\s*\n\s*dinPdf: \{ id: item\.id, title: item\.title \|\| '', adauga: testIntregPdf, stare \},/);
  assert.match(v, /if \(solveOn\) \{ solve\.store\.flush\(\); setSolveOn\(false\); \}\s*\n\s*const \{ srcDoc: _s, \.\.\.stare \}/, 'scrisul de pe PDF rămâne în ciornă');
  // punctajul de până acum, în meniu
  assert.match(v, /📈 Punctajul tău la test: \{fmtPunct\(punctajTest\.score\)\}\/\{fmtPunct\(punctajTest\.max\)\}p/);
  assert.match(v, /Poți schimba metoda oricând: punctajul de până acum se păstrează/);
  assert.match(v, /metodaActiva \? 'schimbă metoda' : metodeVazute\.map\(\(m\) => PE_SCURT\[m\.id\] \|\| m\.scurt\)\.join\(' · '\)/);
  // metoda din meniu ajunge la formular (punctajul cumulat știe cum s-a rezolvat)
  assert.match(v, /metoda: formaCeruta\.mod \|\| null \}\);/);
});
function METODE_REZOLVARE_IDS(v) {
  const bloc = v.slice(v.indexOf('export const METODE_REZOLVARE = ['), v.indexOf('];', v.indexOf('export const METODE_REZOLVARE = [')));
  return [...bloc.matchAll(/id: '([a-z]+)'/g)].map((m) => m[1]);
}

test('testul interactiv deschis din PDF: banda „📄 Rezolvi interactiv testul…", „↩ Înapoi la PDF", exercițiile spre server', () => {
  const iv = read('src/pages/InteractiveViewer.jsx');
  assert.match(iv, /const dinPdf = state\?\.dinPdf && state\.dinPdf\.id \? state\.dinPdf : null;/);
  assert.match(iv, /<div data-din-pdf role="status"/);
  assert.match(iv, /📄 \{isMobile \? null : 'Rezolvi interactiv testul '\}<b>„\{dinPdf\.title\}"<\/b>/);
  assert.match(iv, /'— exercițiile rezolvate aici se adaugă la punctaj; cele de pe PDF rămân'/);
  assert.match(iv, /'— punctajul de pe PDF rămâne cum era'/);
  assert.match(iv, /\{isMobile \? '↩ PDF' : '↩ Înapoi la PDF'\}<\/button>/);
  assert.match(iv, /if \(dinPdf\) \{ inapoiLaPdf\(\); return; \}/, '„← Înapoi" duce tot la PDF');
  assert.match(iv, /postMessage\(\{ type: 'MATE_ITEMS_REQ' \}, '\*'\)/);
  assert.match(iv, /\.\.\.\(dinPdf \? \{ pdfId: dinPdf\.id, itemi \} : \{\}\)/);
  assert.match(iv, /saveScore\(d\.score, d\.maxScore, d\.answers, d\.items\);/);
  const ac = read('src/lib/aiClient.js');
  assert.match(ac, /\.\.\.\(pdfId \? \{ pdfId, itemi: Array\.isArray\(itemi\) \? itemi\.slice\(0, 120\) : null \} : \{\}\)/);
});

test('puntea testului (tutorBridge): exercițiile rezolvate — șablonul cu pași (PROBS/ST) și cardurile-grilă', () => {
  const b = read('src/lib/tutorBridge.js');
  assert.match(b, /function collectItems\(\)\{/);
  assert.match(b, /var P = gget\('PROBS'\), S = gget\('ST'\), ps = gget\('probScore'\);/);
  assert.match(b, /out\.push\(\{ lbl: String\(p\.lbl \|\| \('Exercițiul ' \+ p\.n\)\), p: Math\.max\(0, Math\.min\(mx, pts\)\), m: mx \}\);/);
  assert.match(b, /out\.push\(\{ lbl: lbl, p: cardCorrect\(card\) \? pc : 0, m: pc \}\);/);
  assert.match(b, /if \(d\.type === 'MATE_ITEMS_REQ'\) postItems\(\);/);
  assert.match(b, /items: collectItems\(\) \|\| undefined \}, '\*'\)/);
});

test('profesorul virtual: metoda trimisă, fișa de corectare arată punctajul cumulat, nota testului pe PDF', () => {
  const t = read('src/components/AITutor.jsx');
  assert.match(t, /metoda: formMetodaRef\.current \|\| \(formImages\.length \? 'poza' : 'chat'\) \},/);
  assert.match(t, /\{r\.cumulat && r\.cumulat\.nAlte > 0 && \(/);
  assert.match(t, /📈 <strong>Punctajul testului, cumulat: \{r\.cumulat\.score\}\/\{r\.cumulat\.max\}p<\/strong>/);
  const rz = read('src/components/RezolvarePdf.jsx');
  assert.match(rz, /\{r\.cumulat \? 'Punctajul testului \(cu celelalte metode\)' : 'Ultima corectare'\}/);
});

// ═══════════════════════════ generatorul și adminul ═══════════════════════════
test('generatorul: testul făcut dintr-un singur PDF devine testul interactiv al PDF-ului (dacă nu are deja unul)', async () => {
  const { asociazaPdf } = require('../api/_lib/exgen');
  const supa = createFakeSupabase({
    content: [
      { id: 'p1', content_type: 'pdf', interactiv_id: null },
      { id: 'p2', content_type: 'pdf', interactiv_id: 'vechi' },
      { id: 'i1', content_type: 'interactive' },
    ],
  });
  assert.strictEqual(await asociazaPdf(supa, { sourceId: 'p1', ctype: 'interactive', contentId: 'nou' }), false, 'sursa nu e PDF');
  assert.strictEqual(await asociazaPdf(supa, { sourceId: 'p1', ctype: 'pdf', contentId: 'nou' }), true);
  assert.strictEqual(supa.db.tables.content[0].interactiv_id, 'nou');
  assert.strictEqual(await asociazaPdf(supa, { sourceId: 'p2', ctype: 'pdf', contentId: 'nou' }), false, 'asocierea existentă rămâne');
  assert.strictEqual(supa.db.tables.content[1].interactiv_id, 'vechi');
  assert.strictEqual(await asociazaPdf(supa, { sourceId: 'i1', ctype: 'pdf', contentId: 'nou' }), false);
  const g = read('api/_lib/exgen.js');
  assert.match(g, /if \(g\.sourceId\) await asociazaPdf\(supa, \{ sourceId: g\.sourceId, ctype: task\.ctype \|\| 'interactive', contentId: posted\.contentId \}\);/);
  assert.match(g, /if \(run\.result\.sourceId\) await asociazaPdf\(supa, \{ sourceId: run\.result\.sourceId, ctype: task\.ctype \|\| 'interactive', contentId: posted\.contentId \}\);/);
  assert.match(g, /const sursa = g\.sourceId \? \{ sourceId: g\.sourceId \} : \{\};/, 'la aprobarea manuală se știe sursa');
});

test('admin: „🧩 Test interactiv asociat" la editarea unui PDF; serverul verifică ținta', () => {
  const { sanitizeUpdate } = require('../api/_lib/contentAdmin');
  const cur = { id: '11111111-1111-4111-8111-111111111111', content_type: 'pdf', category: 'clasa-5', title: 'Fișa', interactiv_id: null };
  const T = '22222222-2222-4222-8222-222222222222';
  assert.deepStrictEqual(sanitizeUpdate({ interactiv_id: T }, cur), { patch: { interactiv_id: T }, errors: [] });
  assert.deepStrictEqual(sanitizeUpdate({ interactiv_id: '' }, { ...cur, interactiv_id: T }), { patch: { interactiv_id: null }, errors: [] });
  assert.deepStrictEqual(sanitizeUpdate({ interactiv_id: '' }, cur), { patch: {}, errors: [] });
  assert.deepStrictEqual(sanitizeUpdate({ interactiv_id: 'x' }, cur).errors, ['Testul interactiv asociat e invalid.']);
  assert.deepStrictEqual(sanitizeUpdate({ interactiv_id: T }, { ...cur, content_type: 'interactive' }).errors, ['Doar un PDF poate avea un test interactiv asociat.']);
  assert.deepStrictEqual(sanitizeUpdate({ interactiv_id: cur.id }, cur).errors, ['Materialul nu poate fi asociat cu el însuși.']);
  const api = read('api/content-admin.js');
  assert.match(api, /if \(!tinta \|\| tinta\.content_type !== 'interactive'\) return res\.status\(400\)/);
  const ui = read('src/components/ContentAdminTools.jsx');
  assert.match(ui, /export function InteractivAsociat\(\{ s, item, value, onChange \}\)/);
  assert.match(ui, /\.eq\('category', item\.category\)\.eq\('content_type', 'interactive'\)/);
  assert.match(ui, /\{item\.content_type === 'pdf' && form\.content_type === 'pdf' && \(\s*\n\s*<InteractivAsociat/);
  assert.match(ui, /\.\.\.\(item\.content_type === 'pdf' \? \{ interactiv_id: form\.interactiv_id \|\| null \} : \{\}\),/);
});
