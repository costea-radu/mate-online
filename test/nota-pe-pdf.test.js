// =====================================================================
// test/nota-pe-pdf.test.js — cererea din 11 noiembrie 2026 (1):
// „Fă să se treacă nota cu roșu și pe PDF, la început și să se deruleze la
// partea de la început unde s-a trecut nota."
//
//   · după FIECARE corectare cu notă (nu doar prima din vizită) paginile se
//     derulează la începutul testului, unde e nota — și când nota apare abia după
//     o clipă (vizualizatorul site-ului se încarcă);
//   · corectarea din panoul profesorului — formularul „📝 Răspunde în chat" și
//     foaia de lucru (BAC și restul PDF-urilor) — scrie și ea nota cu roșu pe
//     prima pagină; foaia de lucru dă nota testului la subiectele de examen cu
//     barem (90 p + 10 din oficiu) și o salvează în rezultate;
//   · nota rămâne pe test și după închiderea modului „✏️ Rezolvă pe PDF".
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let libP = null;
const lib = () => (libP || (libP = import('../src/lib/pdfRezolvare.js')));

// DOM de test (ca în test/versiune-noua.test.js): zona cu paginile, pagina 1 și nota
function dom({ holder, pag, nota, scrollTop = 0 }) {
  const rect = (r) => ({ ...r, right: r.left + r.width, bottom: r.top + r.height });
  const h = { scrollTop, scrollLeft: 0, getBoundingClientRect: () => rect(holder), scrolls: [], scrollTo(o) { this.scrolls.push(o); } };
  const p = { getBoundingClientRect: () => rect(pag) };
  const g = { getBoundingClientRect: () => rect(nota), closest: (sel) => (sel === '[data-pdf-pagini]' ? h : sel === '[data-pagina]' ? p : null) };
  return { h, g };
}

test('asteaptaSiVeziNota: nota apare abia după o clipă → derulează la începutul primei pagini', async () => {
  const L = await lib();
  const { h, g } = dom({
    holder: { top: 100, left: 0, width: 390, height: 600 },
    pag: { top: -1692, left: 10, width: 370, height: 520 },      // elevul e pe pagina 4
    nota: { top: -1660, left: 230, width: 120, height: 40 },
    scrollTop: 1800,
  });
  let gata = false;
  const doc = { querySelector: (sel) => (sel === '.nota-rosie' && gata ? g : null) };
  setTimeout(() => { gata = true; }, 60);
  const poz = await L.asteaptaSiVeziNota({ doc, pasMs: 15, timeoutMs: 2000 });
  assert.ok(poz, 'a derulat');
  assert.strictEqual(poz.top, 0, 'înapoi la începutul primei pagini (antetul + nota)');
  assert.strictEqual(h.scrolls.length, 1);
  assert.strictEqual(h.scrolls[0].behavior, 'smooth');
});

test('asteaptaSiVeziNota: și când nota e deja pe ecran (a doua corectare) — derulează la ea; fără notă → null', async () => {
  const L = await lib();
  const { h, g } = dom({
    holder: { top: 100, left: 0, width: 390, height: 600 },
    pag: { top: 90, left: 10, width: 370, height: 520 },
    nota: { top: 120, left: 230, width: 120, height: 40 },
    scrollTop: 40,
  });
  const poz = await L.asteaptaSiVeziNota({ doc: { querySelector: () => g }, pasMs: 10 });
  assert.ok(poz);
  assert.strictEqual(h.scrolls.length, 1, 'derulează mereu, nu doar prima dată');
  const t0 = Date.now();
  assert.strictEqual(await L.asteaptaSiVeziNota({ doc: { querySelector: () => null }, pasMs: 10, timeoutMs: 80 }), null);
  assert.ok(Date.now() - t0 >= 70, 'a așteptat cât i s-a spus');
});

test('readTextPages poate citi doar prima pagină (locul notei, fără tot PDF-ul)', () => {
  const src = read('src/lib/pdfRezolvare.js');
  assert.match(src, /export async function readTextPages\(doc, \{ onlyVisible = true, maxPages = Infinity \} = \{\}\)/);
  assert.match(src, /for \(let n = 1; n <= Math\.min\(doc\.numPages, maxPages\); n\+\+\)/);
  const rz = read('src/components/RezolvarePdf.jsx');
  assert.match(rz, /export async function cutiiPagina1\(data\)/);
  assert.match(rz, /readTextPages\(doc, \{ maxPages: 1 \}\)/);
});

// ── foaia de lucru: nota testului (api/ai-handwriting.js) ─────────────────────
test('foaia de lucru: nota testului doar la subiectele de examen cu barem oficial (90 p + 10 din oficiu)', () => {
  const { notaDinFoaie } = require('../api/ai-handwriting.js');
  const barem = 'BAREM DE EVALUARE ȘI DE NOTARE. Se punctează orice modalitate de rezolvare corectă. Se acordă 10 puncte din oficiu.';
  const en = { kind: 'pdf', hasBarem: true, category: 'evaluare-nationala', barem, contentId: 'c1' };
  assert.deepStrictEqual(notaDinFoaie(en, { puncte: 20 }), { nota: 3, score: 20, total: 90 });
  assert.deepStrictEqual(notaDinFoaie({ ...en, category: 'bacalaureat' }, { puncte: 5 }), { nota: 1.5, score: 5, total: 90 }, 'BAC: doar un exercițiu → 1,50');
  assert.deepStrictEqual(notaDinFoaie(en, { puncte: 90 }), { nota: 10, score: 90, total: 90 });
  assert.strictEqual(notaDinFoaie(en, { puncte: 140 }).score, 90, 'nu trece de 90');
  assert.strictEqual(notaDinFoaie(en, { puncte: 0 }).nota, 1, 'nimic corect → nota 1 (din oficiu)');
  assert.strictEqual(notaDinFoaie(en, { puncte: null }), null, 'fără puncte (fără barem pe item) → fără notă');
  assert.strictEqual(notaDinFoaie({ ...en, hasBarem: false }, { puncte: 10 }), null);
  assert.strictEqual(notaDinFoaie({ ...en, category: 'clasa-7' }, { puncte: 10 }), null, 'fișele claselor: fără notă de examen');
  assert.strictEqual(notaDinFoaie({ ...en, barem: 'Rezolvări: 1) x = 2 …' }, { puncte: 10 }), null, 'fără „din oficiu" → nu e barem oficial');
  assert.strictEqual(notaDinFoaie({ ...en, kind: 'enunt' }, { puncte: 10 }), null);
  assert.strictEqual(notaDinFoaie(null, { puncte: 10 }), null);
});

test('foaia de lucru: nota intră în chat, în rezultate (progress, ca „✏️ Rezolvă pe PDF") și în răspuns', () => {
  const api = read('api/ai-handwriting.js');
  assert.match(api, /const notaT = notaDinFoaie\(src, r\);/);
  assert.match(api, /📝 \*\*Nota pe test: \$\{fmtNota\(notaT\.nota\)\}\*\*/);
  assert.match(api, /correct\.saveProgress\(supa, userId, \{ contentId: src\.contentId, title: src\.title, category: src\.category, score: notaT\.score, maxScore: notaT\.total/);
  assert.match(api, /saved = \{ kind: 'progress', neschimbat: true \};/, 'aceeași corectare în 30 de minute nu mai e o încercare');
  assert.match(api, /nota: notaT \? notaT\.nota : null, score: notaT \? notaT\.score : null, total: notaT \? notaT\.total : null,\s*\n\s*saved,/);
  assert.match(api, /nota: notaT \? notaT\.nota : null,\s*\n\s*verificat: true,/, '„Pregătește-mă de examen" primește nota');
});

// ── panoul profesorului → vizualizatorul PDF ──────────────────────────────────
test('evenimentul „em:nota-pdf": doar cu testul și nota (din formular sau din foaia de lucru)', async () => {
  const prev = global.window;
  const ev = [];
  global.window = new EventTarget();
  try {
    // arena.js importă aiClient (Vite, fără extensie) → o copie temporară, cu clientul înlocuit
    const os = require('node:os');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nota-pdf-'));
    fs.writeFileSync(path.join(dir, 'arena.mjs'), read('src/lib/arena.js').replace(/import \{ aiClient \} from '\.\/aiClient';/, 'const aiClient = {};'));
    const A = await import(require('node:url').pathToFileURL(path.join(dir, 'arena.mjs')).href);
    const off = A.onNotaPdf((d) => ev.push(d));
    A.notaPdfCorectata({ contentId: 'c1', nota: 3.3, score: 21, total: 90, sursa: 'foaie' });
    A.notaPdfCorectata({ contentId: null, libraryId: null, nota: 5 });   // fără test → nimic
    A.notaPdfCorectata({ contentId: 'c1', nota: null });               // fără notă → nimic
    A.notaPdfCorectata({ libraryId: 'L1', nota: '7.5', sursa: 'formular' });
    off();
    A.notaPdfCorectata({ contentId: 'c1', nota: 9 });                  // după dezabonare → nimic
    assert.deepStrictEqual(ev, [
      { contentId: 'c1', libraryId: null, nota: 3.3, score: 21, total: 90, sursa: 'foaie' },
      { contentId: null, libraryId: 'L1', nota: 7.5, score: null, total: null, sursa: 'formular' },
    ]);
  } finally { global.window = prev; }
});

test('AITutor: după formular și după foaia de lucru, nota pleacă spre PDF (și recenzia, la foaie)', () => {
  const t = read('src/components/AITutor.jsx');
  assert.match(t, /import \{ pregatireRezultat, testCorectat, notaPdfCorectata \} from '\.\.\/lib\/arena';/);
  assert.match(t, /if \(context\.pdf && r\.nota != null\) \{\s*\n\s*notaPdfCorectata\(\{ contentId: form\.src\.contentId \|\| context\.contentId \|\| null, libraryId: form\.src\.libraryId \|\| context\.libraryId \|\| null, nota: r\.nota, score: r\.score, total: r\.maxScore, sursa: 'formular' \}\);/);
  assert.match(t, /testCorectat\(\{ contentId: context\.contentId \|\| null, saved: r\.saved \|\| null \}\);\s*\n\s*if \(context\.pdf && r\.nota != null\) \{\s*\n\s*notaPdfCorectata\(\{ contentId: context\.contentId \|\| null, libraryId: context\.contentId \? null : \(context\.libraryId \|\| null\), nota: r\.nota, score: r\.score, total: r\.total, sursa: 'foaie' \}\);/);
});

test('PDFViewer: nota din panou se scrie pe prima pagină (vizualizatorul site-ului) și paginile se derulează la ea', () => {
  const pv = read('src/pages/PDFViewer.jsx');
  assert.match(pv, /import \{ useRezolvarePdf, rezolvareToolbar, RezolvareFooter, NotaPagina, cutiiPagina1 \} from '\.\.\/components\/RezolvarePdf';/);
  assert.match(pv, /useEffect\(\(\) => onNotaPdf\(\(d\) => \{/);
  // testul potrivit: contentId (platformă) sau libraryId (Biblioteca utilizatorilor)
  assert.match(pv, /const alTestului = isLib \? \(!!d\.libraryId && d\.libraryId === \(lib\?\.id \|\| libId\)\) : \(!!d\.contentId && d\.contentId === item\?\.id\);/);
  assert.match(pv, /setNotaExt\(\{ v: d\.nota, at: Date\.now\(\), sursa: d\.sursa \|\| null \}\);\s*\n\s*aratăTestulPentruNota\(\);/);
  assert.match(pv, /setTimeout\(\(\) => \{ asteaptaSiVeziNota\(\); \}, 350\);/);
  // vizualizatorul site-ului, doar în vizita asta (alegerea salvată revine la testul următor)
  assert.match(pv, /function aratăTestulPentruNota\(\) \{[\s\S]{0,400}setViewerPref\(\(p\) => \{\s*\n\s*if \(p === 'intern'\) return p;\s*\n\s*if \(prefInainteDeNota\.current === undefined\) prefInainteDeNota\.current = p;\s*\n\s*return 'intern';/);
  assert.ok(!/aratăTestulPentruNota[\s\S]{0,600}saveViewerPref/.test(pv.slice(pv.indexOf('function aratăTestulPentruNota'), pv.indexOf('function aratăTestulPentruNota') + 700)), 'nu salvează alegerea');
  assert.match(pv, /if \(prefInainteDeNota\.current !== undefined\) \{ setViewerPref\(prefInainteDeNota\.current\); prefInainteDeNota\.current = undefined; \}/);
  // în afara modului de rezolvare: stratul cu nota (și cea din ciorna „✏️ Rezolvă pe PDF")
  assert.match(pv, /const notaSursa = notaExt \|\| \(solve\.nota && solve\.nota\.v != null \? solve\.nota : null\);/);
  assert.match(pv, /: \(notaPeTest \? \{ overlay: \(\{ n, w, h \}\) => <NotaPagina n=\{n\} w=\{w\} h=\{h\} nota=\{notaPeTest\} \/> \} : \{\}\);/);
  // „✏️ Rezolvă pe PDF": după FIECARE corectare cu notă, vizualizatorul rămâne al site-ului
  assert.match(pv, /if \(r\.nota != null\) \{\s*\n\s*setNotaExt\(null\);[^\n]*\n\s*aratăTestulPentruNota\(\);\s*\n\s*setTimeout\(\(\) => \{ solve\.asteaptaSiVeziNota\(\); \}, 350\);/);
});

test('NotaPagina: doar pe prima pagină, fără să primească atingeri (derularea și zoomul rămân)', () => {
  const rz = read('src/components/RezolvarePdf.jsx');
  const i = rz.indexOf('export function NotaPagina');
  const bloc = rz.slice(i, rz.indexOf('\n}\n', i));
  assert.match(bloc, /if \(n !== 1 \|\| !nota \|\| nota\.v == null\) return null;/);
  assert.match(bloc, /pointerEvents: 'none'/);
  assert.match(bloc, /<NotaRosie nota=\{nota\.v\} w=\{w\} h=\{h\}/);
  assert.match(rz, /asteaptaSiVeziNota: \(o\) => asteaptaSiVeziNota\(o\),/);
});
