// =====================================================================
// test/pdf-nota-recenzii-taburi.test.js — cererea din 8 noiembrie 2026 (3):
//   „1. Nu folosi cuvântul (…) pentru a nu fi probleme de drepturi de autor. Șterge-l
//    2. lângă fiecare test PDF pune ca la cele interactive nota, punctajul, stele din
//    recenzii. Pune și recenzii.
//    3. la testele de evaluare națională, prima dată pune tabul de la testele PDF apoi
//    cele interactive. Deci PDF în stânga, interactiv în dreapta
//    4. butoanele de sus sunt acoperite de o bară difuză. E doar la iPhone acest lucru
//    sau la toate tipurile? Rezolvă dacă se poate"
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// ── 1) numele aplicației străine nu mai apare nicăieri ─────────────────────────
test('numele aplicației de limbi nu apare nicăieri în proiect (interfață, server, SQL, ghiduri, teste)', () => {
  const NUME = ['duo', 'lingo'].join('');   // scris așa ca nici testul să nu-l conțină
  const SARIT = new Set(['node_modules', 'dist', '.git', '.vercel', 'Claude outputs', 'android-twa', 'play-assets']);
  const EXT = /\.(jsx?|mjs|cjs|css|html|sql|md|json|txt)$/i;
  const gasite = [];
  (function umbla(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SARIT.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) umbla(p);
      else if (EXT.test(e.name) && fs.statSync(p).size < 3_000_000 && fs.readFileSync(p, 'utf8').toLowerCase().includes(NUME)) {
        gasite.push(path.relative(ROOT, p));
      }
    }
  })(ROOT);
  assert.deepStrictEqual(gasite, []);
  // textele vizibile rămân clare
  assert.match(read('src/pages/PregatesteMa.jsx'), /<p>Un test pe zi: rezolvi cât poți/);
  // 11 nov. 2026: fără „Nou" în cardul „Pregătește-mă de examen"
  assert.match(read('src/pages/Home.jsx'), /"pz-home-kicker">Un test pe zi, cu serie și ligă</);
});

// ── 2) nota, punctajul și stelele la testele PDF; recenzii și pentru PDF-uri ──────
test('listele de teste aduc rezultatul elevului și media recenziilor și pentru PDF-uri', () => {
  const ex = read('src/components/ExamContent.jsx');
  const item = ex.slice(ex.indexOf('export function ItemBlock'), ex.indexOf('export function Section'));
  assert.doesNotMatch(item, /contentType !== 'interactive'/, 'nicio restricție doar la interactive');
  assert.match(item, /supabase\.from\('progress'\)\.select\('\*'\)\.eq\('user_id', user\.id\)\.in\('content_id', ids\)/);
  assert.match(item, /fetchReviewStats\('content', items\.map\(i => i\.id\)\)/);
  const cp = read('src/components/ContentPage.jsx');
  assert.match(cp, /i\.content_type === 'interactive' \|\| i\.content_type === 'pdf'/, 'paginile pe clase: și PDF-urile');
  assert.match(cp, /\(isInteractive \|\| isPdf\) && user && progress && \(\s*<ProgressBadge progress=\{progress\} \/>/);
  // insigna arată procentul, nota (cu oficiu: 1 + puncte/10 la 90 de puncte) și punctajul
  assert.match(cp, /✓ \{pct\}%\{nota != null \? ` · nota \$\{nota\.replace\('\.', ','\)\}` : ''\}/, 'nota cu virgulă: „nota 2,50"');
  assert.match(cp, /\{progress\.score\}\/\{progress\.max_score\} pct/);
  assert.match(cp, /<RatingBadge stats=\{rating\} \/>/);
});

test('nota de pe cardul PDF: aceeași formulă ca la „Rezultate elevi" (90 de puncte + 10 din oficiu)', async () => {
  const { notaDinScor } = await import('../src/lib/nota.js');
  assert.strictEqual(notaDinScor(15, 90), '2.50', '3 grile corecte din tot testul');
  assert.strictEqual(notaDinScor(63, 90), '7.30');
  assert.strictEqual(notaDinScor(90, 90), '10.00');
  assert.strictEqual(notaDinScor(73, 100), '7.30', 'testele interactive pe 100');
});

test('recenzia la PDF: „Cum ți s-a părut testul?" după o corectare salvată — pe PDF sau din foaia de lucru', () => {
  const pdf = read('src/pages/PDFViewer.jsx');
  assert.match(pdf, /import \{ ReviewToast \} from '\.\.\/components\/ReviewWidget'/);
  assert.match(pdf, /if \(r\.saved && r\.saved\.kind === 'progress'\) cereRecenzie\(\);/, '„✏️ Rezolvă pe PDF"');
  assert.match(pdf, /onTestCorectat\(\(d\) => \{ if \(d && item\?\.id && d\.contentId === item\.id\) cereRecenzie\(\); \}\)/, 'foaia de lucru / formularul');
  assert.match(pdf, /if \(!user \|\| isLib \|\| !item\?\.id\) return;/, 'nu la Biblioteca utilizatorilor (au recenziile lor)');
  assert.match(pdf, /if \(!reviewCerut \|\| pregRez \|\| !user \|\| isLib \|\| !item\?\.id\) return undefined;/, 'așteaptă felicitarea testului zilei');
  assert.match(pdf, /em_review_skip_\$\{item\.id\}/, 'închis fără notă → nu mai întrebăm în vizita asta');
  assert.match(pdf, /<ReviewToast targetType="content" targetId=\{item\.id\} title=\{item\.title\} onClose=\{closeReview\} \/>/);
  // JOS, în zona paginilor, la PDF-ul desenat de site (pe telefon mereu): sus sunt bara de
  // rezolvare și nota cu roșu — 8 nov. 2026 (4); cu baremul deschis / PDF-ul browserului, sus
  assert.match(pdf, /pozitie=\{\{ position: 'absolute', top: 'auto', bottom: 10, left: 10, right: 10 \}\}/);
  assert.strictEqual((pdf.match(/position:'relative' \}\}>\s*\n\s*\{!showBaremDoc && reviewJos\}/g) || []).length, 2, 'pe telefon și pe calculator');
  assert.match(pdf, /\{showBaremDoc \? reviewJsx : null\}/, 'telefon, cu baremul deschis');
  assert.match(pdf, /\{blobUrl && internal && !showBaremDoc \? null : reviewJsx\}/, 'calculator: PDF-ul browserului / baremul');
  assert.match(read('src/components/ReviewWidget.jsx'), /\.\.\.\(pozitie \|\| \{\}\),/);
  // panoul profesorului anunță corectarea salvată
  const tutor = read('src/components/AITutor.jsx');
  assert.match(tutor, /testCorectat\(\{ contentId: context\.contentId \|\| null, saved: r\.saved \|\| null \}\)/);
  const arena = read('src/lib/arena.js');
  assert.match(arena, /export function testCorectat\(\{ contentId = null, saved = null \} = \{\}\) \{\s*if \(!contentId \|\| !saved \|\| saved\.kind !== 'progress'\) return;/);
  assert.match(arena, /export function onTestCorectat\(fn\)/);
  // serverul spune dacă s-a salvat (rândul din progress cerut de RLS-ul recenziilor)
  assert.match(read('api/rezolva-pdf.js'), /premiumNeeded, saved, conversationId: convId/);
  assert.match(read('supabase/reviews_schema.sql'), /select exists \(select 1 from public\.progress p where p\.user_id = uid and p\.content_id = p_id\)/);
  // Admin → ⭐ Recenzii → „🗗 Deschide": PDF-urile în vizualizatorul PDF
  assert.match(read('src/components/ReviewsAdmin.jsx'), /const pdf = titles\[`content:\$\{id\}`\]\?\.type === 'pdf';\s*window\.open\(`\$\{pdf \? '\/pdf-viewer' : '\/exercitiu'\}\?id=\$\{id\}`/);
  // și la testele interactive cardul de recenzie așteaptă felicitarea testului zilei
  assert.match(read('src/pages/InteractiveViewer.jsx'), /if \(pregRez\) return;   \/\/ întâi felicitarea testului zilei/);
});

// ── 3) EN: PDF în stânga (deschis implicit), interactiv în dreapta ──────────────
test('Evaluarea Națională: tabul PDF primul și deschis implicit, apoi cel interactiv; ?tab=interactive merge', () => {
  const en = read('src/pages/EvaluareNationala.jsx');
  const iPdf = en.indexOf('📄 PDF+Interactive'), iInt = en.indexOf('🧩 Teste Interactive');
  assert.ok(iPdf > 0 && iInt > iPdf, 'PDF înaintea celui interactiv');
  assert.match(en, /useState\(returnTab \|\| tabParam \|\| 'pdf'\)/);
  assert.match(en, /tabQ === 'pdf' \|\| tabQ === 'interactive' \? tabQ : null/);
  assert.strictEqual((en.match(/<TypeTabs [^>]*pdfFirst \/>/g) || []).length, 2, 'și comutatoarele din secțiuni: PDF | Interactive');
  const ex = read('src/components/ExamContent.jsx');
  assert.match(ex, /export function TypeTabs\(\{ category, subcategory, profile, returnTab, pdfFirst = false \}\)/);
  assert.match(ex, /\(pdfFirst \? \['pdf', 'interactive'\] : \['interactive', 'pdf'\]\)/);
  // Bacalaureatul rămâne cum era
  assert.doesNotMatch(read('src/pages/Bacalaureat.jsx'), /pdfFirst/);
});

test('Profesorul Virtual: linkurile „Teste interactive" de la EN deschid tabul interactiv', () => {
  const g = require('../api/_lib/siteGuide');
  const m = g.answer({ kind: 'materiale' });
  assert.match(m, /\[Evaluarea Națională\]\(\/evaluare-nationala\?tab=interactive\)/);
  assert.match(m, /\[EN\]\(\/evaluare-nationala\?tab=pdf\)/);
  const src = read('api/_lib/siteGuide.js');
  assert.match(src, /const examPageInteractive = \(exam, profile\) => \(exam === 'bac' \? examPage\(exam, profile\) : '\/evaluare-nationala\?tab=interactive'\);/);
  assert.match(src, /\[Teste interactive \$\{examLabel\(exam, p\.profile\)\}\]\(\$\{examPageInteractive\(exam, p\.profile\)\}\)/);
});

// ── 4) bara difuză de sus pe iPhone (Safari 26) ────────────────────────────────
test('iPhone (Safari 26): pe vizualizatoarele pe tot ecranul fundalul paginii e navy, ca bara lor de sus', () => {
  const app = read('src/App.jsx');
  assert.match(app, /const lockScroll = pathname === '\/exercitiu' \|\| pathname === '\/pdf-viewer' \|\| pathname === '\/exercitiu-ai';/);
  assert.match(app, /if \(!lockScroll\) return undefined;\s*const el = document\.documentElement;\s*el\.classList\.add\('em-ecran-plin'\);\s*return \(\) => el\.classList\.remove\('em-ecran-plin'\);/);
  const css = read('src/styles/global.css');
  assert.match(css, /html\.em-ecran-plin,\s*html\.em-ecran-plin body \{ background-color: var\(--navy\); \}/);
  // bara vizualizatorului PDF e navy (aceeași culoare)
  assert.match(read('src/pages/PDFViewer.jsx'), /background:'var\(--navy\)', flexShrink:0,/);
  // pe celelalte pagini, bara site-ului e sticky și navy (Safari o ia pe ea)
  assert.match(css, /\.navbar \{\s*background: var\(--navy\);\s*position: sticky;\s*top: 0;/);
  // pe Android rămâne theme-color
  assert.match(read('index.html'), /<meta name="theme-color" content="#1a3a5c" \/>/);
});
