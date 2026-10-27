// =====================================================================
// test/biblioteca-incarcare.test.js — cererea din 27 octombrie 2026 (seara):
//   1) „📑 Ascunde paginile": coloana cu miniaturi din vizualizatorul PDF al
//      browserului dispare (#navpanes=0), iar Profesorul Virtual se lățește în
//      locul ei (src/lib/pdfFrame.js + src/pages/PDFViewer.jsx);
//   2) formularul „📝 Răspunde în chat" se mărește pe tot chatul;
//   3) tastatura de simboluri: amplificarea (²⁾ în stânga sus) și simplificarea
//      (⁽² în dreapta sus) fracțiilor — și profesorul / corectorii le înțeleg;
//   4) PDF-urile (și testele generate) din Biblioteca utilizatorilor se deschid
//      în vizualizator, cu Profesorul Virtual alături (/pdf-viewer?lib=<id>);
//   5) profesorii ÎNCARCĂ materiale — PDF, Word sau poze — în bibliotecă.
// Logica pură (pdfFrame, mathmlTex, materialPdf.detectMaterial, mathPlain) se
// importă direct; serverul cu Supabase / modele simulate; componentele React
// se verifică pe sursă (nu rulează în Node).
// =====================================================================
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
process.env.AI_PDF_VISION = '1';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const esm = (f) => import(path.join(__dirname, '..', f)).catch(() => null);

// ─── PDF-uri de test (pdf-lib, în memorie) ───────────────────────────────────
let pdfLib = null;
try { pdfLib = require('pdf-lib'); } catch { /* node_modules incomplet → testele cu PDF se sar */ }
async function makePdf(pages, size = [595, 842]) {
  const { PDFDocument, StandardFonts } = pdfLib;
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const lines of pages) {
    const page = doc.addPage(size);
    let y = size[1] - 40;
    for (const line of lines) { page.drawText(line, { x: 50, y, size: 12, font }); y -= 18; }
    if (!lines.length) page.drawRectangle({ x: 60, y: 60, width: 200, height: 120, borderWidth: 2 });
  }
  return Buffer.from(await doc.save({ useObjectStreams: false }));
}

// ─── Supabase fals: răspunsuri pe tabele + storage, cu jurnal de operații ─────
function supaStub(handlers = {}, { files = {} } = {}) {
  const log = [];
  function make(table) {
    const ops = [];
    const p = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === 'then') {
          log.push({ table, ops });
          const out = handlers[table] ? handlers[table](ops) : { data: null, error: null };
          return (res, rej) => Promise.resolve(out).then(res, rej);
        }
        return (...args) => { ops.push([prop, args]); return p; };
      },
    });
    return p;
  }
  const storageLog = [];
  return {
    log, storageLog,
    from: (table) => make(table),
    storage: {
      from: (bucket) => ({
        download: async (p) => {
          storageLog.push(['download', bucket, p]);
          const buf = files[p];
          return buf ? { data: { arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }, error: null } : { data: null, error: { message: 'lipsă' } };
        },
        upload: async (p, buf) => { storageLog.push(['upload', bucket, p, buf.length]); return { data: { path: p }, error: null }; },
        remove: async (ps) => { storageLog.push(['remove', bucket, ps]); return { data: null, error: null }; },
        createSignedUrl: async (p) => ({ data: { signedUrl: `https://signed.example/${p}` }, error: null }),
      }),
    },
  };
}
const opsOf = (supa, table, op) => supa.log.filter((l) => l.table === table).map((l) => l.ops).filter((ops) => ops.some(([o]) => o === op));

// ═════════════════════════════════════════════════════════════════════════════
// 1) „📑 Ascunde paginile"
// ═════════════════════════════════════════════════════════════════════════════
test('pdfFrameSrc: #navpanes=0 (Chrome/Edge) + pagemode=none (Firefox); fără alegere adresa rămâne neschimbată; #page=N păstrat', async (t) => {
  const F = await esm('src/lib/pdfFrame.js');
  if (!F) { t.skip('Node fără import ESM'); return; }
  assert.strictEqual(F.pdfFrameSrc('blob:x/1'), 'blob:x/1');
  assert.strictEqual(F.pdfFrameSrc('blob:x/1', { pagini: '' }), 'blob:x/1');
  assert.strictEqual(F.pdfFrameSrc('blob:x/1', { pagini: '0' }), 'blob:x/1#navpanes=0&pagemode=none');
  assert.strictEqual(F.pdfFrameSrc('blob:x/1', { pagini: '1' }), 'blob:x/1#navpanes=1&pagemode=thumbs');
  assert.strictEqual(F.pdfFrameSrc('blob:x/1', { page: 4, pagini: '0' }), 'blob:x/1#page=4&navpanes=0&pagemode=none');
  assert.strictEqual(F.pdfFrameSrc('blob:x/1', { page: 4 }), 'blob:x/1#page=4');
  assert.strictEqual(F.pdfFrameSrc(null, { pagini: '0' }), null);
});

test('pageWidthPt / pdfColumnWidth: lățimea primei pagini din /MediaBox (A4, Letter, peisaj); fișier ciudat → A4', async (t) => {
  const F = await esm('src/lib/pdfFrame.js');
  if (!F || !pdfLib) { t.skip('Node fără import ESM / pdf-lib'); return; }
  const a4 = await makePdf([['x']], [595.28, 841.89]);
  assert.ok(Math.abs(F.pageWidthPt(a4) - 595.28) < 0.01);
  assert.ok(Math.abs(F.pageWidthPt(new Uint8Array(a4)) - 595.28) < 0.01, 'merge și cu Uint8Array');
  const letter = await makePdf([['x']], [612, 792]);
  assert.strictEqual(F.pageWidthPt(letter.buffer.slice(letter.byteOffset, letter.byteOffset + letter.byteLength)), 612);
  const land = await makePdf([['x']], [842, 595]);
  assert.strictEqual(F.pageWidthPt(land), 842);
  assert.strictEqual(F.pageWidthPt(Buffer.from('nu e pdf')), F.A4_PT);
  assert.strictEqual(F.pageWidthPt(null), F.A4_PT);
  // pagina la 100% (1 pt = 4/3 px, ca vizualizatorul Chrome) + marginile lui
  assert.strictEqual(F.pdfColumnWidth(595.28), Math.round(595.28 * 4 / 3) + F.PAGE_MARGIN);
  assert.strictEqual(F.pdfColumnWidth(), Math.round(595 * 4 / 3) + F.PAGE_MARGIN);
  // paginile ascunse: profesorul primește cel puțin locul miniaturilor (pagina rămâne cât
  // era — laptop), iar pe ecranele late tot ce nu-i trebuie paginii la 100%
  const col = F.pdfColumnWidth();
  assert.strictEqual(F.THUMBS_W, 300);
  assert.strictEqual(F.paginiPanelWidth({ base: 400, vw: 1280, pdfCol: col }), 700);
  assert.strictEqual(F.paginiPanelWidth({ base: 400, vw: 1366, pdfCol: col }), 700);
  assert.strictEqual(F.paginiPanelWidth({ base: 400, vw: 1600, pdfCol: col }), 1600 - col - 3);
  assert.strictEqual(F.paginiPanelWidth({ base: 400, vw: 1920, pdfCol: col }), 1920 - col - 3);
  assert.strictEqual(F.paginiPanelWidth({ base: 520, vw: 1280, pdfCol: col }), 820, 'pornește de la lățimea aleasă de elev');
});

test('vizualizatorul PDF: „📑 Ascunde paginile" pe calculator, alegerea ținută minte, profesorul ia locul coloanei', () => {
  const src = read('src/pages/PDFViewer.jsx');
  assert.match(src, /import \{ pdfFrameSrc, pageWidthPt, pdfColumnWidth, paginiPanelWidth, readPaginiPref, savePaginiPref \} from '\.\.\/lib\/pdfFrame';/);
  assert.match(src, /const \[pagini, setPagini\] = useState\(readPaginiPref\);/);
  assert.match(src, /'📑 Ascunde paginile'/);
  assert.match(src, /'📑 Arată paginile'/);
  // doar pe calculator, la PDF-urile din vizualizatorul browserului (nu pe telefon / la testul generat)
  assert.match(src, /const paginiActive = !mobile && !narrow && !examHtml && !!blobUrl;/);
  assert.match(src, /\{paginiBtn\}/);
  // iframe-ul se reîncarcă cu noul parametru (și baremul separat la fel)
  assert.match(src, /const testKey = `\$\{testJump \? `test-\$\{testJump\.seq\}` : 'test'\}-\$\{pagini \|\| 'x'\}`;/);
  assert.match(src, /src=\{pdfFrameSrc\(baremView\.url, \{ pagini \}\)\}/);
  // profesorul deschis + paginile ascunse → panoul ia locul coloanei (de la lățimea elevului)
  assert.match(src, /const pdfCol = useMemo\(\(\) => pdfColumnWidth\(pageWidthPt\(pdfData\)\), \[pdfData\]\);/);
  assert.match(src, /const on = paginiActive && tutorOpen && faraPagini;/);
  assert.match(src, /const base = autoRef\.current\.before \?\? lat\.width;/);
  assert.match(src, /autoWiden\('pagini', on \? paginiPanelWidth\(\{ base, vw: window\.innerWidth, pdfCol \}\) : null\);/);
  assert.match(src, /savePaginiPref\(next\);/);
});

test('lățirile automate ale panoului (foaia + paginile ascunse) revin la lățimea elevului — dacă nu a ales el alta între timp', () => {
  const src = read('src/pages/PDFViewer.jsx');
  assert.doesNotMatch(src, /wideBeforeWorkRef/, 'mecanismul vechi, doar pentru foaie, a fost înlocuit');
  assert.match(src, /const autoRef = useRef\(\{ before: null, causes: new Map\(\) \}\);/);
  assert.match(src, /onUserResize: \(\) => \{ autoRef\.current\.before = null; \}/);
  assert.match(src, /if \(!narrow\) autoWiden\('foaie', next \? lat\.wideW : null\);/);
  assert.match(src, /const want = a\.causes\.size \? Math\.max\(a\.before \|\| 0, \.\.\.a\.causes\.values\(\)\) : a\.before;/);
  assert.match(src, /onClick=\{\(\) => \{ autoRef\.current\.before = null; lat\.setWidth\(lat\.isWide \? 400 : lat\.wideW\); \}\}/);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2) formularul „📝 Răspunde în chat" mărit pe tot chatul
// ═════════════════════════════════════════════════════════════════════════════
test('formularul de rezolvare: „⤢ Mărește" îl întinde peste tot chatul, „⤡ Micșorează" îl readuce; se închide nemărit', () => {
  const src = read('src/components/AITutor.jsx');
  assert.match(src, /const \[formMax, setFormMax\] = useState\(false\);/);
  assert.match(src, /useEffect\(\(\) => \{ if \(!form\) setFormMax\(false\); \}, \[form\]\);/);
  assert.match(src, /\{formMax \? '⤡ Micșorează' : '⤢ Mărește'\}/);
  assert.match(src, /onClick=\{\(\) => setFormMax\(\(v\) => !v\)\} aria-pressed=\{formMax\}/);
  // peste tot panoul chatului (rădăcina ChatPanel e position:relative); la tablă → tot ecranul
  assert.match(src, /\{ position: 'absolute', inset: 0, zIndex: 8 \}/);
  assert.match(src, /\? \{ position: 'fixed', inset: 0, zIndex: 1500, borderTop: '3px solid var\(--gold\)' \}/);
  assert.match(src, /: \{ maxHeight: '58%', minHeight: 160 \}\),/);
  assert.match(src, /<div style=\{\{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, position: 'relative' \}\}>/);
  // câmpurile de răspuns sunt mai înalte când formularul e mărit
  assert.strictEqual((src.match(/rows=\{formMax \? 5 : 2\} placeholder="Răspunsul \/ rezolvarea ta…"/g) || []).length, 2);
});

// ═════════════════════════════════════════════════════════════════════════════
// 3) amplificarea și simplificarea fracțiilor
// ═════════════════════════════════════════════════════════════════════════════
test('tastatura: amplificarea (paranteza în stânga sus) și simplificarea (în dreapta sus), lângă fracție, în fila „123"', () => {
  const src = read('src/components/math/MathKeyboard.jsx');
  assert.match(src, /export const KEY_AMPLIFICARE = K\('\{\}\^\{n\)\}\\\\frac\{a\}\{b\}', '\{\}\^\{#\?\)\}\\\\frac\{#\?\}\{#\?\}', 'Amplificare: /);
  assert.match(src, /export const KEY_SIMPLIFICARE = K\('\\\\frac\{a\}\{b\}\^\{\(n\}', '\\\\frac\{#\?\}\{#\?\}\^\{\(#\?\}', 'Simplificare: /);
  const baza = src.slice(src.indexOf("id: 'baza'"), src.indexOf("id: 'puteri'"));
  assert.match(baza, /K\('\\\\frac\{a\}\{b\}', '\\\\frac\{#@\}\{#\?\}', 'Fracție'\), KEY_AMPLIFICARE, KEY_SIMPLIFICARE,/);
  // fila rămâne 4 × 7 taste
  const keys = baza.slice(baza.indexOf('keys: ['), baza.indexOf('],'));
  const count = (keys.match(/\bT\(|\bK\(|KEY_AMPLIFICARE|KEY_SIMPLIFICARE/g) || []).length;
  assert.strictEqual(count, 28);
  assert.match(read('src/styles/mathkeyboard.css'), /\.mk-key\.is-frac/);
});

test('forma text a răspunsului: ²⁾3/4 = 6/8 și 18/24⁽⁶ = 3/4 (nu puteri); puterile obișnuite rămân ^', async (t) => {
  const M = await esm('src/lib/mathPlain.js');
  if (!M) { t.skip('Node fără import ESM'); return; }
  assert.strictEqual(M.latexToPlain('{}^{2)}\\frac{3}{4}=\\frac{6}{8}'), '²⁾3/4=6/8');
  assert.strictEqual(M.latexToPlain('\\frac{18}{24}^{(6}=\\frac{3}{4}'), '18/24⁽⁶=3/4');
  assert.strictEqual(M.latexToPlain('{}^{12)}\\frac{1}{2}'), '¹²⁾1/2');
  assert.strictEqual(M.latexToPlain('x^{2}+1'), 'x^2+1');
  assert.strictEqual(M.latexToPlain('{}^{t}A'), 'ᵗA', 'transpusa rămâne');
  assert.strictEqual(M.supText('10'), '¹⁰');
  assert.strictEqual(M.supText('n'), 'ⁿ');
});

test('profesorul virtual, corectarea formularului și corectorul scrisului cunosc notația', () => {
  const ai = require('../api/_lib/ai.js');
  assert.match(ai.FRACTII_NOTATIE, /AMPLIFICAREA ȘI SIMPLIFICAREA FRACȚIILOR/);
  assert.match(ai.FRACTII_NOTATIE, /\$\{\}\^\{3\)\}\\frac\{2\}\{5\}\$/);
  assert.match(ai.FRACTII_NOTATIE, /\\frac\{18\}\{24\}\^\{\(6\}/);
  assert.match(ai.FRACTII_NOTATIE, /NU sunt puteri/);
  assert.ok(ai.PERSONA.includes(ai.FRACTII_NOTATIE), 'agentul general / interactiv');
  const src = read('api/_lib/ai.js');
  const pdfPersona = src.slice(src.indexOf('const PDF_PERSONA'), src.indexOf('// ─── Agentul PDF: cum citește'));
  assert.match(pdfPersona, /\$\{FRACTII_NOTATIE\}/, 'agentul de teste PDF');
  assert.match(read('api/ai-correct.js'), /\$\{ai\.FRACTII_NOTATIE\}/, 'corectarea formularului');
  const corector = require('../api/_lib/corector.js');
  assert.match(corector.HW_SYSTEM, /Amplificarea și simplificarea fracțiilor/);
  assert.match(corector.HW_SYSTEM, /\$\{\}\^\{2\)\}\\frac\{3\}\{4\}\$/);
});

// ═════════════════════════════════════════════════════════════════════════════
// 4) Biblioteca utilizatorilor → vizualizatorul cu Profesorul Virtual
// ═════════════════════════════════════════════════════════════════════════════
const pdfCtx = require('../api/ai-pdf-context.js');
const ELEV = { id: 'e1', role: 'elev', subscription_status: null, is_admin: false };
const ABONAT = { id: 'e2', role: 'elev', subscription_status: 'active', is_admin: false };
const PROF = { id: 'p1', role: 'profesor', subscription_status: null, is_admin: false };
const ADMIN = { id: 'a1', role: 'elev', subscription_status: null, is_admin: true };
const EXAM = {
  title: 'Test fracții', subjects: [
    { label: 'Subiectul I', points: 30, items: [
      { number: 1, statement: 'Rezultatul calculului $\\frac{3}{4}+\\frac{5}{6}$ este:', points: 5, options: ['$\\frac{19}{12}$', '$1$'], answer: 'a' },
      { number: 2, statement: 'Simplificați fracția $\\frac{18}{24}$.', points: 5, answer: '$\\frac{3}{4}$', solution: 'Se simplifică prin 6.' },
    ] },
    { label: 'Subiectul al III-lea', points: 30, items: [
      { number: 1, statement: 'Maria are 120 de lei.', points: 5, parts: [
        { label: 'a', text: 'Cât cheltuiește în prima zi?', points: 2, solution: '120 : 4 = 30 lei' },
        { label: 'b', text: 'Cât îi rămâne?', points: 3, solution: '120 − 30 = 90 lei' },
      ] },
    ] },
  ],
};
const rowPdf = (extra = {}) => ({ id: 'L1', kind: 'pdf', title: 'Fișă fracții', category: 'clasa-5', is_free: false, created_by: 'p1', payload: { pdfPath: 'public-library/a.pdf', bucket: 'personal-pdfs', source: 'docx' }, ...extra });

test('loadLibraryForUser: gratuit pentru oricine; premium doar abonat / autor / admin (altfel 402); doar PDF și teste generate', async () => {
  const supaWith = (row) => supaStub({ ai_public_library: () => ({ data: row, error: null }) });
  assert.strictEqual((await pdfCtx.loadLibraryForUser(supaWith(rowPdf({ is_free: true })), 'L1', ELEV, 'e1')).id, 'L1');
  await assert.rejects(pdfCtx.loadLibraryForUser(supaWith(rowPdf()), 'L1', ELEV, 'e1'), (e) => e.status === 402 && e.code === 'PREMIUM_REQUIRED');
  assert.ok(await pdfCtx.loadLibraryForUser(supaWith(rowPdf()), 'L1', ABONAT, 'e2'));
  assert.ok(await pdfCtx.loadLibraryForUser(supaWith(rowPdf()), 'L1', PROF, 'p1'), 'autorul își vede materialul');
  assert.ok(await pdfCtx.loadLibraryForUser(supaWith(rowPdf()), 'L1', ADMIN, 'a1'));
  await assert.rejects(pdfCtx.loadLibraryForUser(supaWith(rowPdf({ kind: 'interactive' })), 'L1', ADMIN, 'a1'), (e) => e.status === 404);
  await assert.rejects(pdfCtx.loadLibraryForUser(supaWith(null), 'L1', ADMIN, 'a1'), (e) => e.status === 404);
  await assert.rejects(pdfCtx.loadLibraryForUser(supaWith(rowPdf()), null, ADMIN, 'a1'), (e) => e.status === 404);
});

test('examTexts / libraryContext(exam): enunțurile pentru profesor, rezolvările țin loc de barem', async () => {
  const { text, barem } = pdfCtx.examTexts(EXAM);
  assert.match(text, /Subiectul I \(30 de puncte\)/);
  assert.match(text, /1\. Rezultatul calculului .* \(5p\)/);
  assert.match(text, /a\) \$\\frac\{19\}\{12\}\$/);
  assert.match(text, /b\) Cât îi rămâne\? \(3p\)/);
  assert.match(barem, /Răspuns corect: a \(5p\)/);
  assert.match(barem, /Se simplifică prin 6\./);
  assert.match(barem, /a\) 120 : 4 = 30 lei \(2p\)/);
  assert.strictEqual(pdfCtx.examTexts({ subjects: [{ label: 'S', items: [{ number: 1, statement: 'x' }] }] }).barem, '', 'fără rezolvări → fără barem');
  const ctx = await pdfCtx.libraryContext(supaStub(), { id: 'EX1', kind: 'exam', title: 'Test fracții', category: 'clasa-5', payload: { exam: EXAM } });
  assert.strictEqual(ctx.baremStatus, 'biblioteca');
  assert.strictEqual(ctx.barem.matchedBy, 'biblioteca');
  assert.match(ctx.baremText, /90 lei/);
  assert.strictEqual(ctx.library.kind, 'exam');
});

test('libraryContext(pdf): textul adus la încărcare (Word / poze) se folosește direct, fără descărcare', async () => {
  const supa = supaStub();
  const ctx = await pdfCtx.libraryContext(supa, rowPdf({ payload: { pdfPath: 'public-library/a.pdf', text: 'Fișă: $\\frac{3}{4}+\\sqrt{2}$', pageTexts: ['Fișă: $\\frac{3}{4}+\\sqrt{2}$'], source: 'docx' } }));
  assert.match(ctx.text, /\\frac\{3\}\{4\}/);
  assert.deepStrictEqual(ctx.pageTexts, ['Fișă: $\\frac{3}{4}+\\sqrt{2}$']);
  assert.strictEqual(ctx.barem, null);
  assert.strictEqual(ctx.library.source, 'docx');
  assert.deepStrictEqual(supa.storageLog, [], 'nicio descărcare');
});

test('libraryContext(pdf) fără text: îl extrage din PDF o singură dată și îl păstrează în payload; „subiecte + barem" își dă baremul', async (t) => {
  if (!pdfLib) { t.skip('pdf-lib lipsă'); return; }
  const buf = await makePdf([['SUBIECTUL I', '1. Calculati 3/4 + 5/6.'], ['SUBIECTUL al II-lea', '1. Simplificati 18/24.']]);
  const supa = supaStub({ ai_public_library: () => ({ data: null, error: null }) }, { files: { 'public-library/a.pdf': buf } });
  const ctx = await pdfCtx.libraryContext(supa, rowPdf());
  assert.match(ctx.text, /Calculati 3\/4 \+ 5\/6/);
  assert.strictEqual(ctx.pageTexts.length, 2);
  const upd = opsOf(supa, 'ai_public_library', 'update')[0];
  assert.ok(upd, 'textul s-a păstrat în rând');
  const payload = upd.find(([o]) => o === 'update')[1][0].payload;
  assert.match(payload.text, /Simplificati 18\/24/);
  assert.strictEqual(payload.pageTexts.length, 2);
  assert.strictEqual(payload.pdfPath, 'public-library/a.pdf', 'restul payload-ului rămâne');
  // baremul inclus în același fișier
  const lung = 'SUBIECTUL I\n' + '1. Calculați suma numerelor 12 și 30. '.repeat(25) + '\nBAREM DE EVALUARE ȘI DE NOTARE\n' + 'Se punctează orice rezolvare corectă. 12 + 30 = 42 (5p). '.repeat(10);
  const c2 = await pdfCtx.libraryContext(supaStub(), rowPdf({ payload: { pdfPath: 'x.pdf', text: lung } }));
  assert.strictEqual(c2.baremStatus, 'inclus');
  assert.match(c2.baremText, /12 \+ 30 = 42/);
  assert.doesNotMatch(c2.text, /BAREM DE EVALUARE/);
});

function mockRes() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  r.setHeader = (k, v) => { r.headers[k] = v; };
  return r;
}
function withAi(patch, fn) {
  const ai = require('../api/_lib/ai.js');
  const keep = {};
  for (const k of Object.keys(patch)) { keep[k] = ai[k]; ai[k] = patch[k]; }
  return Promise.resolve().then(fn).finally(() => { for (const k of Object.keys(keep)) ai[k] = keep[k]; });
}

test('POST /api/ai-pdf-context { libraryId }: contextul materialului din bibliotecă; fără abonament → 402', async () => {
  const handler = require('../api/ai-pdf-context.js');
  await withAi({
    admin: () => supaStub({ ai_public_library: () => ({ data: { id: 'EX1', kind: 'exam', title: 'Test fracții', category: 'clasa-5', is_free: false, created_by: 'p9', payload: { exam: EXAM } }, error: null }) }),
    authUser: async () => 'e2', requireUser: async () => ABONAT,
  }, async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { libraryId: 'EX1' } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.baremStatus, 'biblioteca');
    assert.match(res.body.text, /Simplificați fracția/);
  });
  await withAi({
    admin: () => supaStub({ ai_public_library: () => ({ data: rowPdf(), error: null }) }),
    authUser: async () => 'e1', requireUser: async () => ELEV,
  }, async () => {
    const res = mockRes();
    await handler({ method: 'POST', body: { libraryId: 'L1' } }, res);
    assert.strictEqual(res.statusCode, 402);
    assert.strictEqual(res.body.code, 'PREMIUM_REQUIRED');
  });
});

test('chatul: pagina exercițiului din PDF-ul din bibliotecă merge la model; PDF fără text (poze) → primele pagini; fără acces → nimic', async (t) => {
  if (!pdfLib) { t.skip('pdf-lib lipsă'); return; }
  const ai = require('../api/_lib/ai.js');
  const pdfpages = require('../api/_lib/pdfpages.js');
  const buf = await makePdf([['SUBIECTUL I', '1. Calculati 3/4 + 5/6.'], ['SUBIECTUL al II-lea', '2. Aria patratului cu latura 4 cm este:'], ['SUBIECTUL al III-lea', '1. Maria are bani.']]);
  const pages = await pdfpages.pageTexts(buf);
  const supa = supaStub({
    profiles: () => ({ data: ABONAT, error: null }),
    ai_public_library: () => ({ data: rowPdf({ id: 'L-att', payload: { pdfPath: 'public-library/att.pdf', bucket: 'personal-pdfs', text: pages.join('\n\n'), pageTexts: pages } }), error: null }),
  }, { files: { 'public-library/att.pdf': buf } });
  const ctx = { pdf: true, libraryId: 'L-att' };
  let parts = await ai.pdfPageAttachments(supa, { context: ctx, message: 'explică', priorMsgs: [], baremItem: { enunt: 'Aria patratului cu latura 4 cm este:' }, userId: 'e2' });
  assert.strictEqual(parts.length, 1);
  assert.strictEqual(parts[0].file.filename, 'pagina-2.pdf');
  assert.deepStrictEqual(await ai.pdfPageAttachments(supa, { context: ctx, message: 'x', priorMsgs: [], userId: null }), [], 'fără utilizator → nimic');
  // poze încărcate fără transcriere: nicio pagină cu text → primele două, ca imagini
  const raster = await makePdf([[], [], []]);
  const s2 = supaStub({
    profiles: () => ({ data: ABONAT, error: null }),
    ai_public_library: () => ({ data: rowPdf({ id: 'L-foto', payload: { pdfPath: 'public-library/foto.pdf', bucket: 'personal-pdfs', source: 'foto' } }), error: null }),
  }, { files: { 'public-library/foto.pdf': raster } });
  parts = await ai.pdfPageAttachments(s2, { context: { pdf: true, libraryId: 'L-foto' }, message: 'ce scrie aici?', priorMsgs: [], userId: 'e2' });
  assert.strictEqual(parts.length, 1);
  assert.strictEqual(parts[0].file.filename, 'pagina-1-2.pdf');
  // material premium, elev fără abonament → nimic atașat (chatul nu pică)
  const s3 = supaStub({ profiles: () => ({ data: ELEV, error: null }), ai_public_library: () => ({ data: rowPdf({ id: 'L-p' }), error: null }) });
  assert.deepStrictEqual(await ai.pdfPageAttachments(s3, { context: { pdf: true, libraryId: 'L-p' }, message: 'I.1', priorMsgs: [], userId: 'e1' }), []);
});

test('corectarea scrisului: la un material din bibliotecă textul și baremul vin de pe server (testul generat → strict după rezolvări)', async () => {
  const hw = require('../api/ai-handwriting.js');
  const keep = { load: pdfCtx.loadLibraryForUser, ctx: pdfCtx.libraryContext };
  const seen = [];
  pdfCtx.loadLibraryForUser = async (supa, id, profile, uid) => { seen.push([id, uid]); return { id, kind: 'exam', title: 'Test fracții', category: 'clasa-5' }; };
  pdfCtx.libraryContext = async () => ({ text: 'Subiectul I\n1. Simplificați fracția 18/24. (5p) — enunțul complet al testului', baremText: 'Răspuns corect: 3/4 (5p). Se simplifică prin 6, pas cu pas, cu punctaj.'.repeat(2) });
  try {
    const src = await hw.resolveSource({}, ABONAT, { context: { pdf: true, libraryId: 'EX1', title: 'x' }, exerciseText: 'ignorat' }, 'e2');
    assert.strictEqual(src.kind, 'pdf');
    assert.strictEqual(src.hasBarem, true);
    assert.strictEqual(src.libraryId, 'EX1');
    assert.match(src.barem, /Se simplifică prin 6/);
    assert.deepStrictEqual(seen, [['EX1', 'e2']]);
    // fără acces → eroarea merge mai departe (402)
    pdfCtx.loadLibraryForUser = async () => { const e = new Error('abonament'); e.status = 402; throw e; };
    await assert.rejects(hw.resolveSource({}, ELEV, { context: { pdf: true, libraryId: 'EX1' } }, 'e1'), (e) => e.status === 402);
  } finally { pdfCtx.loadLibraryForUser = keep.load; pdfCtx.libraryContext = keep.ctx; }
});

test('„Răspunde în chat" la un material din bibliotecă: formularul semnat pe sursa „lib:<id>", cache pe material, rezultatul ajunge și la autor', () => {
  const correct = require('../api/ai-correct.js');
  const items = [{ id: 'I.1', eticheta: 'Subiectul I, ex. 1', puncte: 5 }];
  const tok = correct.signForm({ items, contentId: 'lib:EX1', testText: 'oricare', hasBarem: true, total: 5 });
  assert.ok(correct.verifyForm(tok, { items, contentId: 'lib:EX1', testText: '' }), 'textul nu mai intră în amprentă (serverul îl recitește)');
  assert.strictEqual(correct.verifyForm(tok, { items, contentId: null, testText: 'oricare' }), null);
  assert.strictEqual(correct.formCacheKey({ libraryId: 'EX1' }, 'h'), 'l:EX1');
  assert.strictEqual(correct.formCacheKey({ contentId: 'c1' }, 'h'), 'c:c1');
  assert.strictEqual(correct.formCacheKey({}, 'h'), 'u:h');
  const src = read('api/ai-correct.js');
  assert.match(src, /if \(!contentId && libraryId\) \{\s*const row = await pdfContext\.loadLibraryForUser\(supa, libraryId, profile, userId\);/);
  assert.match(src, /const libraryId = contentId \? null : \(context\.libraryId \|\| null\);/);
  assert.match(src, /await aiPublic\.recordPublicResult\(supa, \{ publicId: src\.libraryId, userId, profile, score, maxScore \}\)/);
  const chat = read('src/components/AITutor.jsx');
  assert.match(chat, /libraryId: context\.contentId \? null : \(context\.libraryId \|\| null\),/);
  assert.match(chat, /contentId: src\.contentId, libraryId: src\.libraryId \}\);/);
  assert.match(chat, /testText: form\.src\.contentId \|\| form\.src\.libraryId \? '' : form\.src\.testText/);
});

test('vizualizatorul: ?lib=<id> → publicGet (accesul pe server), PDF din URL-ul semnat sau testul generat ca document, profesorul cu libraryId', () => {
  const src = read('src/pages/PDFViewer.jsx');
  assert.match(src, /const libId = modTest \? null : searchParams\.get\('lib'\);/);
  assert.match(src, /const \{ item: row \} = await aiClient\.publicGet\(\{ id: libId \}\);/);
  assert.match(src, /const b = await aiClient\.getLibraryPdfBlob\(lib\?\.payload \|\| \{\}\);/);
  assert.match(src, /setExamHtml\(examDocumentHtml\(lib\.payload\?\.exam \|\| \{\}, \{ embedded: true \}\)\);/);
  assert.match(src, /srcDoc=\{examHtml\}\s+sandbox="allow-scripts allow-modals"/);
  assert.match(src, /aiClient\.pdfContext\(isLib \? \{ libraryId: lib\.id \} : \{ contentId: item\.id \}\)/);
  assert.match(src, /libraryId: isLib \? \(lib\?\.id \|\| null\) : null,/);
  assert.match(src, /contentId: isLib \? null : \(item\?\.id \|\| null\),/);
  assert.match(src, /const showBaremBtn = !modTest && !isLib && /);
  assert.match(src, /e\.premium\s*\? 'Acest material din bibliotecă face parte din abonament/);
  assert.match(read('src/lib/aiClient.js'), /pdfContext: \(\{ contentId = null, libraryId = null \}\) => post\('\/api\/ai-pdf-context', libraryId && !contentId \? \{ libraryId \} : \{ contentId \}\)/);
  // testul generat: documentul fără bara de tipărire, cu tipărirea separat
  const ex = read('src/lib/examPrint.js');
  assert.match(ex, /export function examDocumentHtml\(exam, \{ withSolutions = false, embedded = true \} = \{\}\)/);
  assert.match(ex, /\$\{embedded \? '' : `<div class="topbar">/);
  assert.match(ex, /autoMath\(s == null \? '' : String\(s\)\)/, 'numerele itemilor (numere în JSON) nu mai strică documentul');
});

test('biblioteca: PDF-urile și testele generate se deschid în vizualizator (nu într-o filă goală); profesorii au „📤 Încarcă material"', () => {
  const src = read('src/pages/BibliotecaUtilizatorilor.jsx');
  assert.match(src, /if \(it\.kind === 'pdf' \|\| it\.kind === 'exam'\) \{[\s\S]{0,200}navigate\(`\/pdf-viewer\?lib=\$\{it\.id\}`, \{ state: \{ returnTo: '\/biblioteca-utilizatorilor' \} \}\);/);
  assert.doesNotMatch(src, /window\.open\('', '_blank'\)/);
  assert.doesNotMatch(src, /printExam/);
  assert.match(src, /const canUpload = !!user && \(isTeacher \|\| isAdmin\);/);
  assert.match(src, /<IncarcaMaterial onDone=\{\(\) => load\(\)\} onCancel=\{\(\) => setUpload\(false\)\} \/>/);
  assert.match(src, /📤 Încarcă material \(PDF, Word, poze\)/);
});

// ═════════════════════════════════════════════════════════════════════════════
// 5) încărcarea materialelor
// ═════════════════════════════════════════════════════════════════════════════
test('detectMaterial: un PDF, un Word sau 1–20 poze; .doc, amestecuri și fișiere prea mari → mesaj clar', async (t) => {
  const M = await esm('src/lib/materialPdf.js');
  if (!M) { t.skip('Node fără import ESM'); return; }
  const f = (name, type = '', size = 1000) => ({ name, type, size });
  assert.strictEqual(M.detectMaterial([f('fisa.pdf', 'application/pdf')]).kind, 'pdf');
  assert.strictEqual(M.detectMaterial([f('fisa.PDF')]).kind, 'pdf');
  assert.strictEqual(M.detectMaterial([f('fisa.docx')]).kind, 'docx');
  assert.strictEqual(M.detectMaterial([f('a.jpg', 'image/jpeg'), f('b.png', 'image/png')]).kind, 'foto');
  assert.strictEqual(M.detectMaterial([f('a.heic')]).kind, 'foto');
  assert.match(M.detectMaterial([f('vechi.doc')]).error, /\.doc/);
  assert.match(M.detectMaterial([f('a.pdf'), f('b.png', 'image/png')]).error, /nu amestecate/);
  assert.match(M.detectMaterial([f('a.pdf'), f('b.pdf')]).error, /UN PDF/);
  assert.match(M.detectMaterial(Array.from({ length: 21 }, (_, i) => f(`p${i}.jpg`, 'image/jpeg'))).error, /20 de poze/);
  assert.match(M.detectMaterial([f('mare.pdf', 'application/pdf', 30 * 1024 * 1024)]).error, /24 MB/);
  assert.match(M.detectMaterial([f('x.txt', 'text/plain')]).error, /nu e acceptat/);
  assert.match(M.detectMaterial([]).error, /Alege/);
  assert.strictEqual(M.titleFromFile({ name: 'Fisa_de_lucru__fractii.docx' }), 'Fisa de lucru fractii');
  assert.strictEqual(M.fmtMb(1536), '2 KB');
  assert.strictEqual(M.fmtMb(1.5 * 1024 * 1024), '1,5 MB');
});

test('transcrierea pozelor, în loturi sub limitele serverului (≤ 6 poze, ≤ 3,8 MB pe cerere), în ordine', async (t) => {
  const M = await esm('src/lib/materialPdf.js');
  if (!M) { t.skip('Node fără import ESM'); return; }
  const mici = Array.from({ length: 14 }, (_, i) => `img${i}`);
  const lots = M.transcribeBatches(mici);
  assert.deepStrictEqual(lots.map((l) => l.length), [6, 6, 2]);
  assert.deepStrictEqual(lots.flat(), mici, 'ordinea pozelor rămâne');
  const mari = Array.from({ length: 5 }, (_, i) => String(i).repeat(1_300_000));
  const lm = M.transcribeBatches(mari);
  assert.deepStrictEqual(lm.map((l) => l.length), [2, 2, 1]);
  assert.ok(lm.every((l) => l.reduce((s, u) => s + u.length, 0) <= M.TRANSCRIBE_BATCH_CHARS));
  assert.deepStrictEqual(M.transcribeBatches([]), []);
  // limitele clientului nu trec de ale serverului (8 poze, 4,2 MB pe cerere)
  const pub = read('api/ai-public.js');
  assert.match(pub, /const TRANSCRIBE_MAX = 8;/);
  assert.match(pub, /total \+ u\.length <= 4_200_000/);
  assert.ok(M.TRANSCRIBE_BATCH <= 8 && M.TRANSCRIBE_BATCH_CHARS < 4_200_000);
  assert.match(read('src/lib/materialPdf.js'), /const OCR_MAX_CHARS = 1_300_000;/);
});

test('Word → PDF: formulele Word (OMML → MathML) ajung la profesor ca LaTeX (mathmlToTex / domText)', async (t) => {
  const T = await esm('src/lib/mathmlTex.js');
  if (!T) { t.skip('Node fără import ESM'); return; }
  // noduri „ca în DOM": element(tag, copii | text)
  const el = (tag, kids = [], attrs = {}) => {
    const childNodes = typeof kids === 'string' ? [{ nodeType: 3, textContent: kids }] : kids;
    return { nodeType: 1, localName: tag, childNodes, getAttribute: (a) => (a in attrs ? attrs[a] : null), get textContent() { return childNodes.map((c) => c.textContent).join(''); } };
  };
  const txt = (s) => ({ nodeType: 3, textContent: s });
  const frac = el('math', [el('mfrac', [el('mn', '3'), el('mn', '4')]), el('mo', '+'), el('msqrt', [el('mn', '2')])]);
  assert.strictEqual(T.mathmlToTex(frac), '\\frac{3}{4}+\\sqrt{2}');
  assert.strictEqual(T.mathmlToTex(el('math', [el('msup', [el('mi', 'x'), el('mn', '2')]), el('mo', '−'), el('msub', [el('mi', 'a'), el('mi', 'n')])])), 'x^2-a_n');
  assert.strictEqual(T.mathmlToTex(el('math', [el('mroot', [el('mi', 'x'), el('mn', '3')])])), '\\sqrt[3]{x}');
  assert.strictEqual(T.mathmlToTex(el('math', [el('munderover', [el('mo', '∑'), el('mrow', [el('mi', 'k'), el('mo', '='), el('mn', '1')]), el('mi', 'n')]), el('mi', 'k')])), '\\sum_{k=1}^n k');
  assert.strictEqual(T.mathmlToTex(el('math', [el('mfenced', [el('mi', 'a'), el('mi', 'b')], { open: '[', close: ')' })])), '\\left[a,b\\right)');
  assert.strictEqual(T.mathmlToTex(el('math', [el('mtable', [el('mtr', [el('mtd', [el('mn', '1')]), el('mtd', [el('mn', '2')])]), el('mtr', [el('mtd', [el('mn', '3')]), el('mtd', [el('mn', '4')])])])])), '\\begin{matrix}1 & 2 \\\\ 3 & 4\\end{matrix}');
  assert.strictEqual(T.mathmlToTex(el('math', [el('mover', [el('mrow', [el('mi', 'A'), el('mi', 'B')]), el('mo', '→')])])), '\\overrightarrow{AB}');
  assert.strictEqual(T.mathmlToTex(el('math', [el('mi', 'x'), el('mo', '∈'), el('mi', 'ℝ')])), 'x\\in \\mathbb{R}');
  // pagina: paragrafe pe rânduri, tabelul cu „ | ", formula între $…$, imaginea ca [figură]
  const page = el('section', [
    el('p', [txt('1. Calculați: '), frac]),
    el('table', [el('tr', [el('td', 'a'), el('td', 'b')]), el('tr', [el('td', '2'), el('td', '3')])]),
    el('p', [el('img')]),
    el('style', 'p{color:red}'),
  ]);
  assert.strictEqual(T.domText(page), '1. Calculați: $\\frac{3}{4}+\\sqrt{2}$\na | b\n2 | 3\n[figură]');
});

test('componenta de încărcare: confirmarea drepturilor, textul pozelor transcris în loturi, PDF-ul în folderul profesorului + publicare', () => {
  const src = read('src/components/IncarcaMaterial.jsx');
  assert.match(src, /accept="\.pdf,application\/pdf,\.docx,application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document,image\/\*"/);
  assert.match(src, /const allowed = !!user && \(isTeacher \|\| isAdmin\);/);
  assert.match(src, /if \(!rights\) \{ setErr\('Bifează confirmarea/);
  assert.match(src, /for \(const lot of transcribeBatches\(imgs\)\) \{[\s\S]{0,300}aiClient\.publicTranscribe\(\{ images: lot \}\)/);
  // câte un text pe poză, chiar dacă serverul întoarce mai puține — paginile nu alunecă
  assert.match(src, /lot\.forEach\(\(_, k\) => out\.push\(String\(got\[k\] \|\| ''\)\)\);/);
  assert.match(src, /aiClient\.uploadMaterial\(\{ title: t, category: category \|\| null, topic: topic\.trim\(\) \|\| null, blob: prep\.blob, extra \}\)/);
  assert.match(src, /to=\{`\/pdf-viewer\?lib=\$\{done\.publicId\}`\}/);
  assert.match(src, /👁 Vezi PDF-ul/);
  // transcrierea care nu merge nu oprește publicarea
  assert.match(src, /pageTexts = null; text = '';/);
  const cl = read('src/lib/aiClient.js');
  assert.match(cl, /async uploadMaterial\(\{ title, category = null, topic = null, blob, extra = \{\} \}\) \{/);
  assert.match(cl, /supabase\.storage\.from\('personal-pdfs'\)\s*\.upload\(path, blob, \{ contentType: 'application\/pdf', upsert: false \}\)/);
  assert.match(cl, /const payload = \{ pdfPath: path, bucket: 'personal-pdfs', origin: 'upload', \.\.\.extra \};/);
  assert.match(cl, /privateId = await this\.saveLibraryItem\(\{ kind: 'pdf', title, category, topic, payload \}\)/);
  assert.match(cl, /post\('\/api\/ai-public', \{ action: 'publish', kind: 'pdf', title, category, topic, payload \}\)/);
  assert.match(cl, /publicTranscribe: \(\{ images \}\) => post\('\/api\/ai-public', \{ action: 'transcribe', images \}\)/);
  // Word → PDF și pozele → PDF, în browser (bibliotecile încărcate la cerere)
  const mp = read('src/lib/materialPdf.js');
  assert.match(mp, /import\('docx-preview'\), import\('html-to-image'\), pdfLib\(\)/);
  assert.match(mp, /useBase64URL: true/);
  assert.match(mp, /createImageBitmap\(file, \{ imageOrientation: 'from-image' \}\)/);
});

test('„Asistent AI pentru profesori": fila „📤 Încarcă material" (doar profesor / admin)', () => {
  const src = read('src/pages/ProfesorVirtual.jsx');
  assert.match(src, /\.\.\.\(isTeacher \|\| isAdmin \? \[\{ id: 'upload', label: '📤 Încarcă material' \}\] : \[\]\),/);
  assert.match(src, /\{tab === 'upload' && <UploadTab \/>\}/);
  assert.match(src, /function UploadTab\(\) \{[\s\S]{0,1200}<IncarcaMaterial \/>/);
  assert.match(src, /const icon = it\.kind === 'exam' \|\| it\.kind === 'pdf' \? '📄'/, 'PDF-urile din „Testele mele" au iconița lor');
});

test('api/ai-public: transcrierea pozelor (doar profesor), payload-ul PDF curățat, căutare și în textul fișei', async () => {
  const pub = require('../api/ai-public.js');
  const clean = pub.cleanPdfPayload({ pdfPath: 'u/a.pdf', signedUrl: 'https://x', text: 'a'.repeat(50000), pageTexts: Array(50).fill('p'.repeat(7000)), source: 'exe', origin: 'altceva', pages: '9999', fileName: 'f'.repeat(300) });
  assert.strictEqual(clean.signedUrl, undefined);
  assert.strictEqual(clean.text.length, 40000);
  assert.strictEqual(clean.pageTexts.length, 40);
  assert.strictEqual(clean.pageTexts[0].length, 6000);
  assert.strictEqual(clean.source, undefined);
  assert.strictEqual(clean.origin, undefined);
  assert.strictEqual(clean.pages, 500);
  assert.strictEqual(clean.fileName.length, 140);
  assert.strictEqual(pub.cleanPdfPayload({ source: 'foto', origin: 'upload' }).source, 'foto');
  assert.match(pub.buildSearchText('pdf', 'Fișă', 'fracții', { text: 'Calculați 3/4 + 5/6' }), /Calculați 3\/4/);

  const PNG = 'data:image/png;base64,' + Buffer.from('poza').toString('base64');
  const calls = [];
  const patch = {
    admin: () => supaStub(), authUser: async () => 'p1',
    enforceRateLimit: async () => ({ degraded: false }),
    logUsage: async (s, u, ep, usage) => { calls.push(['log', ep, usage]); },
    chatJson: async (opts) => { calls.push(['chat', opts]); return { data: { pagini: [{ text: 'Fișa 1: $\\frac{3}{4}$' }, { text: 'Fișa 3' }] }, usage: { in: 10, out: 5 } }; },
  };
  // elev → 403
  await withAi({ ...patch, requireUser: async () => ELEV }, async () => {
    const res = mockRes();
    await pub({ method: 'POST', body: { action: 'transcribe', images: [PNG] } }, res);
    assert.strictEqual(res.statusCode, 403);
  });
  // profesor → câte un text pentru FIECARE poză primită, la locul ei (cea invalidă → '')
  await withAi({ ...patch, requireUser: async () => PROF }, async () => {
    const res = mockRes();
    await pub({ method: 'POST', body: { action: 'transcribe', images: [PNG, 'nu e imagine', PNG] } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.deepStrictEqual(res.body.pages, ['Fișa 1: $\\frac{3}{4}$', '', 'Fișa 3']);
    const chat = calls.find((c) => c[0] === 'chat')[1];
    const parts = chat.messages[0].content;
    assert.strictEqual(parts.filter((p) => p.type === 'image_url').length, 2, 'imaginea invalidă a fost lăsată deoparte');
    assert.strictEqual(chat.schemaName, 'transcriere_pagini');
    assert.ok(calls.some((c) => c[0] === 'log' && c[1] === 'ai-public:transcribe'));
    const res2 = mockRes();
    await pub({ method: 'POST', body: { action: 'transcribe', images: [] } }, res2);
    assert.strictEqual(res2.statusCode, 400);
  });
});

test('api/ai-public publish (PDF încărcat): copia publică în public-library/, textul fișei păstrat, adresa semnată nu', async (t) => {
  const pub = require('../api/ai-public.js');
  const buf = Buffer.from('%PDF-1.4 test');
  const supa = supaStub({
    ai_public_library: (ops) => {
      if (ops.some(([o]) => o === 'insert')) return { data: { id: 'NEW1', title: 'Fișă' }, error: null };
      return { data: [], error: null, count: 3 };
    },
  }, { files: { 'p1/123.pdf': buf } });
  await withAi({ admin: () => supa, authUser: async () => 'p1', requireUser: async () => ({ ...PROF, full_name: 'Ana Pop' }) }, async () => {
    const res = mockRes();
    await pub({ method: 'POST', body: { action: 'publish', kind: 'pdf', title: 'Fișă', category: 'clasa-5', payload: { pdfPath: 'p1/123.pdf', bucket: 'personal-pdfs', origin: 'upload', source: 'docx', text: 'Calculați $\\frac{3}{4}$', pageTexts: ['Calculați $\\frac{3}{4}$'], signedUrl: 'https://nu' } } }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.id, 'NEW1');
  });
  const up = supa.storageLog.find((l) => l[0] === 'upload');
  assert.match(up[2], /^public-library\/.+\.pdf$/);
  const ins = opsOf(supa, 'ai_public_library', 'insert')[0].find(([o]) => o === 'insert')[1][0];
  assert.strictEqual(ins.kind, 'pdf');
  assert.match(ins.payload.pdfPath, /^public-library\//);
  assert.strictEqual(ins.payload.text, 'Calculați $\\frac{3}{4}$');
  assert.strictEqual(ins.payload.signedUrl, undefined);
  assert.match(ins.search_text, /Calculați/);
});

test('fără tabele noi: încărcarea folosește bucketul personal-pdfs și ai_public_library / ai_personal_items existente; PWA fără bibliotecile de conversie', () => {
  // (regula din CLAUDE.md: orice `create table public.*` nou cere RLS + GRANT în același fișier — aici nu e cazul)
  for (const f of ['src/lib/materialPdf.js', 'src/components/IncarcaMaterial.jsx', 'api/ai-public.js', 'api/ai-pdf-context.js']) {
    assert.doesNotMatch(read(f), /create table/i, f);
  }
  const vite = read('vite.config.js');
  assert.match(vite, /'material-pdflib': \['pdf-lib'\],/);
  assert.match(vite, /'material-docx': \['docx-preview', 'jszip'\],/);
  assert.match(vite, /'material-img': \['html-to-image'\],/);
  assert.match(vite, /'assets\/material-\*'\]/);
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['docx-preview'] && pkg.dependencies['html-to-image']);
});
