// =====================================================================
// src/lib/pdfjs.js — pdf.js la cerere (din CDN) + „poate browserul să arate
// singur un PDF?" (4 nov. 2026)
//
// Cererea lui Radu: „pe tabla interactivă Samsung Flip nu se afișează
// PDF-urile, apare scris «file format unsupported». Nici pe altă tablă
// interactivă nu se afișează PDF-urile."
//
// De ce: pe calculator, PDF-ul se deschidea în vizualizatorul browserului (un
// iframe). Browserele tablelor interactive — Samsung Flip (Tizen), tablele cu
// Android, televizoarele — NU au vizualizator PDF: iframe-ul rămâne cu „file
// format unsupported". Acolo PDF-ul se desenează acum de site, pe <canvas>, cu
// pdf.js (ca pe telefon): src/components/PdfCanvasViewer.jsx.
//
//   pdfInlineSupport(nav)  → true doar dacă browserul are vizualizator PDF
//   needsLegacyPdfJs(win)  → browser vechi: construcția „legacy" a pdf.js
//   loadPdfJs()            → window.pdfjsLib (o singură încărcare)
//
// Construcția MODERNĂ a pdf.js 3.11 cere un browser recent (structuredClone,
// Array.prototype.at — Chrome 98+). Tablele au adesea Chromium 76–94: pentru
// ele vine construcția LEGACY (aceeași versiune, cu polyfill-uri). Dacă un CDN
// e blocat în rețeaua școlii, se încearcă următorul.
// =====================================================================

const VER = '3.11.174';
const MODERN = [
  { lib: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VER}/pdf.min.js`, worker: `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${VER}/pdf.worker.min.js` },
];
const LEGACY = [
  { lib: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VER}/legacy/build/pdf.min.js`, worker: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${VER}/legacy/build/pdf.worker.min.js` },
  { lib: `https://unpkg.com/pdfjs-dist@${VER}/legacy/build/pdf.min.js`, worker: `https://unpkg.com/pdfjs-dist@${VER}/legacy/build/pdf.worker.min.js` },
];
export const PDFJS_SOURCES = { MODERN, LEGACY };

// Browserul poate arăta un PDF în pagină (în iframe), cu vizualizatorul lui?
//  • navigator.pdfViewerEnabled — standardul (Chrome 94+, Firefox 99+, Safari 16.4+);
//  • mai vechi: pluginul PDF din navigator.mimeTypes / navigator.plugins;
//  • telefoanele, tabletele, televizoarele și tablele interactive (Tizen, webOS,
//    Android, inclusiv cu „site pentru desktop") → NU: acolo desenăm noi PDF-ul.
export function pdfInlineSupport(nav = (typeof navigator !== 'undefined' ? navigator : null)) {
  if (!nav) return false;
  try {
    const ua = String(nav.userAgent || '');
    if (/Android|iPhone|iPad|iPod|Tizen|SMART-TV|SmartTV|SMARTTV|Web0S|webOS|NetCast|BRAVIA|HbbTV|CrKey|AFT[A-Z]|Silk\//i.test(ua)) return false;
    // iPad cu „site pentru desktop" se prezintă drept Macintosh, dar are ecran tactil
    if (/Macintosh/.test(ua) && Number(nav.maxTouchPoints || 0) > 1) return false;
    if (typeof nav.pdfViewerEnabled === 'boolean') return nav.pdfViewerEnabled;
    const mt = nav.mimeTypes;
    const pdfMime = mt && (mt['application/pdf'] || (typeof mt.namedItem === 'function' ? mt.namedItem('application/pdf') : null));
    if (pdfMime && pdfMime.enabledPlugin) return true;
    const pl = nav.plugins;
    if (pl && pl.length) for (let i = 0; i < pl.length; i++) if (/pdf/i.test((pl[i] && pl[i].name) || '')) return true;
  } catch { /* browser ciudat → desenăm noi */ }
  return false;
}

// Construcția legacy: browserele fără structuredClone / Array.prototype.at /
// Promise.allSettled (Chromium < 98 — tablele interactive, televizoarele).
export function needsLegacyPdfJs(win = (typeof window !== 'undefined' ? window : null)) {
  try {
    if (!win) return true;
    return typeof win.structuredClone !== 'function'
      || typeof Array.prototype.at !== 'function'
      || typeof Promise.allSettled !== 'function';
  } catch { return true; }
}

function addScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { s.remove(); reject(new Error('script')); };
    document.head.appendChild(s);
  });
}

let pdfjsPromise = null;
export function loadPdfJs() {
  if (typeof window !== 'undefined' && window.pdfjsLib && window.pdfjsLib.getDocument) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const order = needsLegacyPdfJs() ? LEGACY : [...MODERN, ...LEGACY];
      for (const src of order) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await addScript(src.lib);
          // un browser vechi poate încărca scriptul modern fără să-l poată rula
          if (window.pdfjsLib && window.pdfjsLib.getDocument) {
            window.pdfjsLib.GlobalWorkerOptions.workerSrc = src.worker;
            return window.pdfjsLib;
          }
        } catch { /* CDN blocat → următorul */ }
      }
      throw new Error('Nu s-a putut încărca vizualizatorul PDF.');
    })().catch((e) => { pdfjsPromise = null; throw e; });
  }
  return pdfjsPromise;
}
