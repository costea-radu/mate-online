// =====================================================================
// test/pdf-table-interactive.test.js — cererea din 4 noiembrie 2026:
//   „pe tabla interactivă Samsung Flip nu se afișează PDF-urile, apare scris
//    «file format unsupported». Nici pe altă tablă interactivă nu se afișează
//    PDF-urile. Dacă se poate, fă să se afișeze."
//
// Tablele (Tizen, Android, televizoare) nu au vizualizator PDF în browser:
//   · src/lib/pdfjs.js — pdfInlineSupport() = are browserul vizualizator?
//     needsLegacyPdfJs() = construcția „legacy" a pdf.js (Chromium vechi);
//   · src/components/PdfCanvasViewer.jsx — PDF-ul desenat de site (pdf.js);
//   · src/pages/PDFViewer.jsx — „🖥️ Nu se vede PDF-ul?" (alegerea se ține minte);
//   · src/lib/pdfOpen.js + PdfOverlay — PDF-urile deschise înainte într-o filă
//     nouă (fișe, teste generate, teme) se deschid în fereastra site-ului.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8');
let pdfjsP = null;
const P = () => (pdfjsP || (pdfjsP = import('../src/lib/pdfjs.js')));

const CHROME_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const SAMSUNG_FLIP = 'Mozilla/5.0 (SMART-TV; LINUX; Tizen 6.0) AppleWebKit/537.36 (KHTML, like Gecko) 76.0.3809.146/6.0 TV Safari/537.36';
const ANDROID_BOARD = 'Mozilla/5.0 (Linux; Android 11; IFP) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/83.0.4103.106 Safari/537.36';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15';

test('pdfInlineSupport: vizualizatorul browserului doar pe calculatoare care îl au', async () => {
  const { pdfInlineSupport } = await P();
  assert.strictEqual(pdfInlineSupport({ userAgent: CHROME_WIN, pdfViewerEnabled: true }), true);
  assert.strictEqual(pdfInlineSupport({ userAgent: CHROME_WIN, pdfViewerEnabled: false }), false, 'vizualizatorul dezactivat → desenăm noi');
  // Samsung Flip (Tizen) și tablele cu Android → mereu desenat de site
  assert.strictEqual(pdfInlineSupport({ userAgent: SAMSUNG_FLIP, pdfViewerEnabled: true }), false);
  assert.strictEqual(pdfInlineSupport({ userAgent: ANDROID_BOARD }), false);
  // iPad cu „site pentru desktop" (se prezintă drept Macintosh, dar e tactil)
  assert.strictEqual(pdfInlineSupport({ userAgent: IPAD_DESKTOP, maxTouchPoints: 5, pdfViewerEnabled: true }), false);
  assert.strictEqual(pdfInlineSupport({ userAgent: IPAD_DESKTOP, maxTouchPoints: 0, pdfViewerEnabled: true }), true, 'Mac adevărat');
  // browser vechi fără pdfViewerEnabled: pluginul PDF
  const mime = { 'application/pdf': { enabledPlugin: { name: 'Chrome PDF Viewer' } } };
  assert.strictEqual(pdfInlineSupport({ userAgent: CHROME_WIN, mimeTypes: mime }), true);
  assert.strictEqual(pdfInlineSupport({ userAgent: CHROME_WIN, plugins: [{ name: 'PDF Viewer' }] }), true);
  assert.strictEqual(pdfInlineSupport({ userAgent: CHROME_WIN, mimeTypes: {}, plugins: [] }), false);
  assert.strictEqual(pdfInlineSupport(null), false);
});

test('needsLegacyPdfJs: construcția legacy pentru Chromium vechi (fără structuredClone / Array.at)', async () => {
  const { needsLegacyPdfJs, PDFJS_SOURCES } = await P();
  assert.strictEqual(needsLegacyPdfJs({}), true, 'fără structuredClone → legacy');
  assert.strictEqual(needsLegacyPdfJs({ structuredClone: () => null }), typeof Array.prototype.at !== 'function' || typeof Promise.allSettled !== 'function');
  assert.strictEqual(needsLegacyPdfJs(null), true);
  // aceeași versiune peste tot; legacy din două CDN-uri (o rețea de școală poate bloca unul)
  const all = [...PDFJS_SOURCES.MODERN, ...PDFJS_SOURCES.LEGACY];
  const vers = new Set(all.map((s) => (s.lib.match(/(\d+\.\d+\.\d+)/) || [])[1]));
  assert.strictEqual(vers.size, 1);
  assert.ok(PDFJS_SOURCES.LEGACY.length >= 2);
  PDFJS_SOURCES.LEGACY.forEach((s) => {
    assert.match(s.lib, /\/legacy\/build\/pdf\.min\.js$/);
    assert.match(s.worker, /\/legacy\/build\/pdf\.worker\.min\.js$/);
  });
});

test('PDFViewer: pe table PDF-ul e desenat de site; „🖥️ Nu se vede PDF-ul?" pe calculator, alegerea se ține minte', () => {
  const v = read('src/pages/PDFViewer.jsx');
  assert.match(v, /import PdfCanvasViewer from '\.\.\/components\/PdfCanvasViewer'/);
  assert.match(v, /const internal = mobile \|\| viewerPref === 'intern' \|\| \(viewerPref !== 'browser' && !inlineOk\);/);
  assert.match(v, /🖥️ Nu se vede PDF-ul\?/);
  assert.match(v, /🌐 Vizualizatorul browserului/);
  assert.match(v, /saveViewerPref\(next\)/);
  const f = read('src/lib/pdfFrame.js');
  assert.match(f, /export const VIEWER_KEY = 'pdf:vizualizator';/);
  const c = read('src/components/PdfCanvasViewer.jsx');
  assert.match(c, /loadPdfJs/);
  assert.match(c, /IntersectionObserver/, 'paginile se desenează când ajung aproape de ecran');
  assert.match(c, /typeof IntersectionObserver === 'undefined'/, 'browserele vechi: toate paginile, fără observator');
  assert.match(c, /pdf:potrivire/);
});

test('PDF-urile deschise înainte într-o filă nouă se deschid în fereastra site-ului acolo unde nu există vizualizator', () => {
  const o = read('src/lib/pdfOpen.js');
  assert.match(o, /export function pdfInPagina\(\)/);
  assert.match(o, /return !pdfInlineSupport\(\);/);
  assert.match(o, /export async function deschidePdf/);
  assert.match(read('src/App.jsx'), /<PdfOverlayHost \/>/);
  const sites = {
    'src/pages/ProfesorVirtual.jsx': /deschidePdf\(/,
    'src/components/CombinedPdfGenerator.jsx': /deschidePdf\(/,
    'src/pages/TemaElev.jsx': /deschidePdf\(/,
    'src/pages/GrupaTema.jsx': /deschidePdf\(/,
    'src/pages/RezolvariPage.jsx': /arataPdf\(/,
    'src/components/Discussions.jsx': /arataPdf\(/,
    'src/components/IncarcaMaterial.jsx': /arataPdf\(/,
  };
  for (const [f, re] of Object.entries(sites)) assert.match(read(f), re, f);
});
