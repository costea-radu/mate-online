// =====================================================================
// api/_lib/pdfpages.js — PAGINILE unui PDF pentru model (Etapa 2, punctul 1.1)
//
// Până acum modelul primea DOAR textul extras (cu euristicile din pdftext.js
// pentru fracții/exponenți/vectori) și „ghicea" radicalii sau figurile pierdute.
// API-urile actuale (OpenAI Chat Completions: content part `file`; Anthropic:
// bloc `document`) primesc PDF-ul ca atare și văd ȘI imaginea paginii. Aici:
//   · pageTexts(buf)   → textul fiecărei pagini (aceeași asamblare ca pdftext);
//   · findPages(...)   → paginile pe care stă exercițiul întrebat;
//   · extractPagesPdf  → un PDF NOU doar cu acele pagini (pdf-lib), base64;
//   · filePart(...)    → content part-ul de pus în mesajul user (format OpenAI).
// Trimitem DOAR pagina/paginile exercițiului (1–2), nu tot testul — cost mic,
// iar cache-ul de prompt (prefixul static) rămâne neatins.
// =====================================================================
const { pageRenderer, toPdfData } = require('./pdftext');

const MAX_PAGES = parseInt(process.env.AI_PDF_MAX_PAGES || '20', 10);
const MAX_PART_BYTES = parseInt(process.env.AI_PDF_PAGE_MAX_BYTES || String(1.5 * 1024 * 1024), 10); // pagina extrasă, înainte de base64

// textul fiecărei pagini, în ordine (aceeași asamblare geometrică ca pdftext.js)
async function pageTexts(buf, { max = MAX_PAGES } = {}) {
  const pdfParse = require('pdf-parse');
  const pages = [];
  await pdfParse(toPdfData(buf), {
    max,
    pagerender: (pageData) => pageRenderer(pageData).then((t) => { pages.push(String(t || '')); return t; }),
  });
  return pages.map((t) => t.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());
}

const norm = (s) => String(s || '').toLowerCase().replace(/[\s ]+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();

// Paginile (index 0-based) pe care apare exercițiul: după ENUNȚ (fragmentul
// lui) sau după referință (subiect + număr). Întoarce maxim 2 pagini adiacente.
function findPages(pages, { enunt = null, ref = null } = {}) {
  const N = (pages || []).map(norm);
  const hit = (needle) => N.findIndex((p) => needle && p.includes(needle));
  let idx = -1;
  if (enunt) {
    const e = norm(enunt);
    for (const len of [80, 50, 30]) { idx = hit(e.slice(0, len)); if (idx >= 0) break; }
  }
  if (idx < 0 && ref && ref.ex) {
    // blocul subiectului, apoi „N." la început de rând în pagina respectivă
    const subj = ref.subject ? { I: 'subiectul i', II: 'subiectul al ii', III: 'subiectul al iii' }[ref.subject] : null;
    const candidates = [];
    N.forEach((p, i) => { if (!subj || p.includes(subj) || (i > 0 && N.slice(0, i).some((q) => q.includes(subj)))) candidates.push(i); });
    const re = new RegExp(`(^|\\n| )${ref.ex}[.)] `);
    for (const i of candidates) { if (re.test((pages[i] || '').toLowerCase())) { idx = i; break; } }
  }
  if (idx < 0) return [];
  // enunțul poate continua pe pagina următoare (rar): o adăugăm doar dacă
  // exercițiul e găsit la finalul paginii (ultimele 15% din text)
  const out = [idx];
  if (enunt && idx + 1 < N.length) {
    const pos = N[idx].indexOf(norm(enunt).slice(0, 30));
    if (pos > N[idx].length * 0.85) out.push(idx + 1);
  }
  return out;
}

// Un PDF nou doar cu paginile date (index 0-based) → Buffer
async function extractPagesPdf(buf, pageIdx) {
  const { PDFDocument } = require('pdf-lib');
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const valid = [...new Set(pageIdx)].filter((i) => Number.isInteger(i) && i >= 0 && i < src.getPageCount()).sort((a, b) => a - b);
  if (!valid.length) return null;
  const copied = await out.copyPages(src, valid);
  copied.forEach((p) => out.addPage(p));
  const bytes = await out.save({ useObjectStreams: false }); // compatibil cu orice cititor (și pdf.js vechi)
  return Buffer.from(bytes);
}

// content part (format OpenAI Chat Completions) pentru un PDF: { type:'file', file:{filename, file_data} }
function filePart(pdfBuf, filename = 'pagina.pdf') {
  if (!pdfBuf || pdfBuf.length > MAX_PART_BYTES) return null;
  return { type: 'file', file: { filename, file_data: `data:application/pdf;base64,${pdfBuf.toString('base64')}` } };
}

// Mesajul user cu text + atașamente (pagini PDF / imagini). Fără atașamente → string.
function userContent(text, parts = []) {
  const extra = (parts || []).filter(Boolean);
  if (!extra.length) return text;
  return [{ type: 'text', text }, ...extra];
}

// Doar textul dintr-un content (string sau listă de părți) — pentru istoric/DB
function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n');
  return String(content ?? '');
}

module.exports = { pageTexts, findPages, extractPagesPdf, filePart, userContent, textOf, MAX_PART_BYTES };
