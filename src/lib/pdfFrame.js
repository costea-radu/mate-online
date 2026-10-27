// =====================================================================
// src/lib/pdfFrame.js — PDF-ul din vizualizator, pe calculator (fără React;
// testat în test/biblioteca-incarcare.test.js)
//
// Pe calculator PDF-ul se deschide în vizualizatorul browserului (Chrome / Edge),
// într-un iframe, cu coloana de miniaturi ale paginilor în stânga. „📑 Ascunde
// paginile" (src/pages/PDFViewer.jsx) o închide prin parametrul #navpanes=0 al
// vizualizatorului (Firefox: #pagemode=none) — iar panoul Profesorului Virtual ia
// locul eliberat: pagina rămâne cât era, profesorul se lățește.
//   pdfFrameSrc(url, { page, pagini }) → adresa pentru iframe
//   pageWidthPt(buf)                   → lățimea primei pagini (puncte PDF)
//   pdfColumnWidth(widthPt)            → coloana PDF-ului cu pagina la 100% (px)
//   paginiPanelWidth({ base, vw, pdfCol }) → lățimea profesorului, paginile ascunse
// =====================================================================

export const PAGINI_KEY = 'pdf:pagini';   // '' = cum vrea browserul · '0' = ascunse · '1' = arătate
export function readPaginiPref() {
  try { const v = localStorage.getItem(PAGINI_KEY); return v === '0' || v === '1' ? v : ''; } catch { return ''; }
}
export function savePaginiPref(v) {
  try { localStorage.setItem(PAGINI_KEY, v === '0' ? '0' : '1'); } catch { /* mod privat — rămâne până la reîncărcare */ }
}

// #page=N (saltul la baremul inclus) + coloana cu paginile. Fără nicio alegere,
// adresa rămâne cea de până acum (vizualizatorul face ce face de obicei).
export function pdfFrameSrc(url, { page = null, pagini = '' } = {}) {
  if (!url) return url;
  const p = [];
  if (page) p.push(`page=${page}`);
  if (pagini === '0') p.push('navpanes=0', 'pagemode=none');
  else if (pagini === '1') p.push('navpanes=1', 'pagemode=thumbs');
  return p.length ? `${url}#${p.join('&')}` : url;
}

// Lățimea primei pagini, din primul /MediaBox găsit în fișier (fără parser PDF —
// e doar o estimare: la fișierele cu obiectele comprimate nu-l găsim → A4).
export const A4_PT = 595;
export function pageWidthPt(buf) {
  try {
    if (!buf) return A4_PT;
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const n = Math.min(bytes.length, 600000);
    let head = '';
    for (let i = 0; i < n; i += 8192) head += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(n, i + 8192)));
    const m = head.match(/\/MediaBox\s*\[\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\]/);
    if (!m) return A4_PT;
    const w = Math.abs(parseFloat(m[3]) - parseFloat(m[1]));
    const h = Math.abs(parseFloat(m[4]) - parseFloat(m[2]));
    // /Rotate 90 lângă pagină → lățimea e înălțimea
    const rot = /\/Rotate\s+(90|270)\b/.test(head.slice(Math.max(0, m.index - 400), m.index + 400));
    const width = rot ? h : w;
    return width > 100 && width < 3000 ? width : A4_PT;
  } catch { return A4_PT; }
}

// Coloana PDF-ului, fără miniaturi: pagina la 100% (1 pt = 4/3 px, ca vizualizatorul
// Chrome) + marginile lui și bara de derulare
export const PAGE_MARGIN = 64;
export function pdfColumnWidth(widthPt = A4_PT) {
  return Math.round((widthPt || A4_PT) * 4 / 3) + PAGE_MARGIN;
}

// Coloana miniaturilor din vizualizatorul Chrome / Edge (~300 px, cu bara ei de derulare)
export const THUMBS_W = 300;
// Lățimea panoului profesorului cu paginile ascunse: primește cel puțin locul coloanei
// de miniaturi (pagina PDF rămâne cât era — pe laptop, la 1280–1366 px), iar pe ecranele
// late și mai mult: PDF-ului îi rămâne doar cât îi trebuie paginii la 100%.
// base = lățimea aleasă de elev (înaintea lățirilor automate).
export function paginiPanelWidth({ base = 400, vw = 1280, pdfCol = pdfColumnWidth() } = {}) {
  return Math.max(Math.round(base || 0) + THUMBS_W, Math.round(vw - pdfCol - 3));
}
