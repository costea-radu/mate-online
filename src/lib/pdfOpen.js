// =====================================================================
// src/lib/pdfOpen.js — deschiderea unui PDF (fișă, test generat, temă,
// rezolvare) — 4 nov. 2026
//
// Până acum, PDF-urile se deschideau într-o FILĂ NOUĂ, în vizualizatorul
// browserului. Pe tablele interactive (Samsung Flip / Tizen, tablele cu Android)
// și pe telefoanele cu Android nu există vizualizator: fila rămânea cu „file
// format unsupported" sau fișierul doar se descărca. Acolo PDF-ul se deschide
// acum în FEREASTRA SITE-ULUI, peste pagină (src/components/PdfOverlay.jsx,
// desenat cu pdf.js), cu „⬇ Descarcă" și „✕ Închide".
//
//   pdfInPagina()                 → true = fereastra site-ului (nu filă nouă)
//   deschidePdf(src, { title, fileName, win })
//       src: Blob | ArrayBuffer | Uint8Array | URL; `win` = fereastra deschisă
//       SINCRON la clic (altfel browserul o blochează) — se închide dacă PDF-ul
//       rămâne în pagină
//   arataPdf(src, { title, fileName }) → doar fereastra site-ului
// =====================================================================
import { pdfInlineSupport } from './pdfjs';
import { readViewerPref } from './pdfFrame';

export const PDF_EVENT = 'em:pdf-deschide';

// „🖥️ Vizualizatorul ExamenMate" ales din bara PDF-ului se respectă și aici
export function pdfInPagina() {
  const p = readViewerPref();
  if (p === 'intern') return true;
  if (p === 'browser') return false;
  return !pdfInlineSupport();
}

async function toArrayBuffer(src) {
  if (typeof src === 'string') {
    const r = await fetch(src);
    if (!r.ok) throw new Error(`PDF-ul nu s-a putut descărca (HTTP ${r.status}).`);
    return r.arrayBuffer();
  }
  if (src instanceof ArrayBuffer) return src;
  if (src && src.buffer instanceof ArrayBuffer && typeof src.byteLength === 'number') {
    return src.buffer.slice(src.byteOffset || 0, (src.byteOffset || 0) + src.byteLength);
  }
  if (src && typeof src.arrayBuffer === 'function') return src.arrayBuffer();
  throw new Error('PDF lipsă.');
}

export async function arataPdf(src, { title = 'PDF', fileName = null } = {}) {
  const data = await toArrayBuffer(src);
  window.dispatchEvent(new CustomEvent(PDF_EVENT, { detail: { data, title, fileName } }));
}

export async function deschidePdf(src, { title = 'PDF', fileName = null, win = null } = {}) {
  if (pdfInPagina()) {
    if (win) { try { win.close(); } catch { /* deja închisă */ } }
    await arataPdf(src, { title, fileName });
    return 'pagina';
  }
  // browserul are vizualizator PDF: fila nouă, ca înainte
  const url = typeof src === 'string' ? src
    : URL.createObjectURL(src instanceof Blob ? src : new Blob([src], { type: 'application/pdf' }));
  if (typeof src !== 'string') setTimeout(() => URL.revokeObjectURL(url), 120000);
  if (win) win.location = url;
  else window.open(url, '_blank', 'noopener');
  return 'fila';
}
