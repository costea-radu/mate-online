// =====================================================================
// src/lib/materialPdf.js — materialul ÎNCĂRCAT de profesor → PDF (în browser)
//
// „📤 Încarcă material" (src/components/IncarcaMaterial.jsx): profesorul încarcă
// un PDF, un document Word sau poze; în Biblioteca utilizatorilor ajunge MEREU un
// PDF, care se deschide în vizualizator cu Profesorul Virtual alături.
//   · PDF  → rămâne cum e (verificăm doar că e PDF și câte pagini are);
//   · Word → docx-preview îl desenează (cu formulele Word — OMML → MathML —,
//            tabelele și imaginile), html-to-image face din fiecare pagină o
//            imagine, pdf-lib le pune într-un PDF; textul paginilor (formulele
//            ca LaTeX) îl păstrăm pentru Profesorul Virtual;
//   · poze → câte o pagină A4 pentru fiecare (orientarea după poză); textul
//            îl transcrie serverul la publicare (api/ai-public.js → transcribe).
// Nimic nu pleacă de pe calculator în timpul conversiei. Bibliotecile mari
// (pdf-lib, docx-preview, html-to-image) se încarcă abia aici, la cerere.
// =====================================================================
import { domText } from './mathmlTex.js';

export const MAX_FILE_MB = 24;            // limita bucketului (25 MB) — și a PDF-ului făcut
export const MAX_PHOTOS = 20;
const A4 = { w: 595.28, h: 841.89 };      // puncte PDF
const PHOTO_MAX_PX = 2200;                // latura lungă a pozei, în PDF
const OCR_MAX_PX = 1600;                  // latura lungă a pozei trimise la transcriere
// Limitele transcrierii (api/ai-public.js → transcribe): cel mult 8 poze, 1,5 MB
// fiecare și 4,2 MB pe cerere (Vercel primește cel mult 4,5 MB) — rămânem sub ele.
const OCR_MAX_CHARS = 1_300_000;
export const TRANSCRIBE_BATCH = 6;
export const TRANSCRIBE_BATCH_CHARS = 3_800_000;

// Pozele de transcris, în loturi: cel mult 6 poze și ~3,8 MB pe cerere, în ordine.
export function transcribeBatches(images, { max = TRANSCRIBE_BATCH, maxChars = TRANSCRIBE_BATCH_CHARS } = {}) {
  const lots = [];
  let cur = [];
  let size = 0;
  for (const u of images || []) {
    const len = String(u || '').length;
    if (cur.length && (cur.length >= max || size + len > maxChars)) { lots.push(cur); cur = []; size = 0; }
    cur.push(u); size += len;
  }
  if (cur.length) lots.push(cur);
  return lots;
}

const ext = (f) => String((f && f.name) || '').toLowerCase().split('.').pop();
const isPdf = (f) => f && (f.type === 'application/pdf' || ext(f) === 'pdf');
const isDocx = (f) => f && (f.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || ext(f) === 'docx');
const isImage = (f) => f && (/^image\//.test(f.type || '') || ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'gif', 'bmp'].includes(ext(f)));

// Ce a ales profesorul: { kind: 'pdf' | 'docx' | 'foto', files } sau { error }
export function detectMaterial(fileList) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return { error: 'Alege un fișier.' };
  if (files.some((f) => ext(f) === 'doc')) return { error: 'Fișierele .doc (Word 97–2003) nu se pot citi. Deschide-l în Word și salvează-l ca .docx sau ca PDF.' };
  const big = files.find((f) => f.size > MAX_FILE_MB * 1024 * 1024);
  if (big) return { error: `„${big.name}" are peste ${MAX_FILE_MB} MB.` };
  if (files.every(isImage)) {
    if (files.length > MAX_PHOTOS) return { error: `Cel mult ${MAX_PHOTOS} de poze o dată (câte una pe pagină).` };
    return { kind: 'foto', files };
  }
  if (files.length > 1) return { error: 'Alege UN PDF sau UN document Word — ori una sau mai multe poze (nu amestecate).' };
  if (isPdf(files[0])) return { kind: 'pdf', files };
  if (isDocx(files[0])) return { kind: 'docx', files };
  return { error: 'Formatul nu e acceptat. Încarcă un PDF, un document Word (.docx) sau poze (JPG, PNG).' };
}

// Titlul propus: numele fișierului, fără extensie și fără „_"
export function titleFromFile(f) {
  const base = String((f && f.name) || '').replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base.slice(0, 120);
}

async function pdfLib() { return import('pdf-lib'); }

// ── PDF: verificat și numărat ───────────────────────────────────────────────
export async function preparePdf(file) {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(5, buf.byteLength));
  if (String.fromCharCode(...head) !== '%PDF-') throw new Error('Fișierul nu pare a fi un PDF valid.');
  let pages = 0;
  try {
    const { PDFDocument } = await pdfLib();
    const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
    pages = doc.getPageCount();
  } catch { /* PDF ciudat, dar vizualizatoarele îl pot deschide — îl lăsăm */ }
  return { blob: new Blob([buf], { type: 'application/pdf' }), pages, source: 'pdf', fileName: file.name };
}

// ── POZE → PDF (câte o pagină A4) ───────────────────────────────────────────
async function loadBitmap(file) {
  // orientarea din EXIF (pozele de pe telefon) se aplică singură la decodare
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* cădem pe <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } catch {
    throw new Error(`Poza „${file.name}" nu se poate citi${/heic|heif/i.test(ext(file)) ? ' (format HEIC — trimite-o ca JPG)' : ''}.`);
  } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

function drawScaled(src, maxPx) {
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  const s = Math.min(1, maxPx / Math.max(w0, h0));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w0 * s)); cv.height = Math.max(1, Math.round(h0 * s));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(src, 0, 0, cv.width, cv.height);
  return cv;
}
// copia pentru transcriere: 1600 px, JPEG 0,8; o poză foarte „încărcată" (zgomot,
// hârtie texturată) se recomprimă, ca să nu treacă de 1,3 MB
function ocrDataUrl(cv) {
  let small = drawScaled(cv, OCR_MAX_PX);
  let url = small.toDataURL('image/jpeg', 0.8);
  if (url.length > OCR_MAX_CHARS) url = small.toDataURL('image/jpeg', 0.6);
  if (url.length > OCR_MAX_CHARS) { small = drawScaled(cv, 1100); url = small.toDataURL('image/jpeg', 0.6); }
  return url;
}

const canvasBlob = (cv, type = 'image/jpeg', q = 0.86) => new Promise((resolve, reject) => {
  cv.toBlob((b) => (b ? resolve(b) : reject(new Error('Imaginea nu s-a putut pregăti.'))), type, q);
});

export async function photosToPdf(files, { onProgress = null } = {}) {
  const { PDFDocument } = await pdfLib();
  const doc = await PDFDocument.create();
  const ocrImages = [];
  for (let i = 0; i < files.length; i++) {
    onProgress && onProgress(`Pregătesc poza ${i + 1} din ${files.length}…`);
    const bmp = await loadBitmap(files[i]);
    const cv = drawScaled(bmp, PHOTO_MAX_PX);
    const jpg = await doc.embedJpg(await (await canvasBlob(cv, 'image/jpeg', 0.86)).arrayBuffer());
    // pagină A4, pe orientarea pozei; poza încape întreagă, cu margini mici
    const land = cv.width > cv.height;
    const pw = land ? A4.h : A4.w, ph = land ? A4.w : A4.h, m = 18;
    const s = Math.min((pw - 2 * m) / cv.width, (ph - 2 * m) / cv.height);
    const w = cv.width * s, h = cv.height * s;
    const page = doc.addPage([pw, ph]);
    page.drawImage(jpg, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    // pentru transcriere: o copie mai mică (sub limita serverului pe poză)
    ocrImages.push(ocrDataUrl(cv));
    if (bmp.close) try { bmp.close(); } catch { /* ignore */ }
  }
  doc.setTitle(titleFromFile(files[0]) || 'Material');
  const bytes = await doc.save();
  return { blob: new Blob([bytes], { type: 'application/pdf' }), pages: files.length, source: 'foto', fileName: files.length === 1 ? files[0].name : `${files.length} poze`, ocrImages };
}

// ── WORD → PDF ──────────────────────────────────────────────────────────────
// docx-preview desenează documentul pe pagini (<section class="docx">, cu mărimea
// și marginile paginii din Word); fiecare pagină devine o imagine. O pagină mai
// înaltă decât foaia (documente fără sfârșituri de pagină salvate) se taie în foi.
export async function docxToPdf(file, { onProgress = null } = {}) {
  onProgress && onProgress('Deschid documentul Word…');
  const [dp, h2i, { PDFDocument }] = await Promise.all([import('docx-preview'), import('html-to-image'), pdfLib()]);
  const renderAsync = dp.renderAsync || (dp.default && dp.default.renderAsync);
  if (typeof renderAsync !== 'function') throw new Error('Cititorul de documente Word nu s-a putut încărca.');
  const host = document.createElement('div');
  // în pagină (altfel nu se așază), dar în afara ecranului
  host.style.cssText = 'position:fixed;left:-30000px;top:0;width:1400px;background:#fff;z-index:-1;pointer-events:none;';
  host.setAttribute('aria-hidden', 'true');
  document.body.appendChild(host);
  try {
    await renderAsync(await file.arrayBuffer(), host, null, {
      className: 'docx', inWrapper: false, ignoreWidth: false, ignoreHeight: false,
      breakPages: true, ignoreLastRenderedPageBreak: false, renderHeaders: true, renderFooters: true,
      renderFootnotes: true, renderEndnotes: true, useBase64URL: true, experimental: false,
    });
    // fonturile / imaginile din document: așteptăm să fie gata înainte de fotografiere
    try { await document.fonts.ready; } catch { /* ignore */ }
    await Promise.all(Array.from(host.querySelectorAll('img')).map((im) => (im.decode ? im.decode().catch(() => {}) : null)));
    const sections = Array.from(host.querySelectorAll('section.docx'));
    if (!sections.length) throw new Error('Documentul Word pare gol.');
    const doc = await PDFDocument.create();
    const pageTexts = [];
    let n = 0;
    for (const sec of sections) {
      n++;
      onProgress && onProgress(`Transform pagina ${n} din ${sections.length}…`);
      const wPx = sec.offsetWidth || 794;
      const hPx = sec.offsetHeight || 1123;
      // înălțimea foii din Word (docx-preview o pune ca min-height); altfel A4 pe lățimea paginii
      const sheet = parseFloat(getComputedStyle(sec).minHeight) || Math.round(wPx * Math.SQRT2);
      const ratio = 2;
      const canvas = await h2i.toCanvas(sec, { pixelRatio: ratio, backgroundColor: '#ffffff', skipFonts: true, cacheBust: false });
      const slices = hPx > sheet * 1.04 ? Math.ceil(hPx / sheet) : 1;
      const sliceH = slices > 1 ? sheet : hPx;
      for (let k = 0; k < slices; k++) {
        const y0 = Math.round(k * sliceH * ratio);
        const hh = Math.min(canvas.height - y0, Math.round(sliceH * ratio));
        if (hh <= 4) break;
        const part = document.createElement('canvas');
        part.width = canvas.width; part.height = Math.round(sliceH * ratio);
        const ctx = part.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, part.width, part.height);
        ctx.drawImage(canvas, 0, y0, canvas.width, hh, 0, 0, canvas.width, hh);
        const jpg = await doc.embedJpg(await (await canvasBlob(part, 'image/jpeg', 0.88)).arrayBuffer());
        const pw = wPx * 0.75, ph = sliceH * 0.75; // px CSS → puncte PDF
        const page = doc.addPage([pw, ph]);
        page.drawImage(jpg, { x: 0, y: 0, width: pw, height: ph });
      }
      // textul paginii (formulele ca LaTeX) — pentru Profesorul Virtual
      const t = domText(sec);
      for (let k = 0; k < slices; k++) pageTexts.push(k === 0 ? t : '');
    }
    doc.setTitle(titleFromFile(file) || 'Material');
    const bytes = await doc.save();
    const text = pageTexts.filter(Boolean).join('\n\n').trim();
    return { blob: new Blob([bytes], { type: 'application/pdf' }), pages: doc.getPageCount(), source: 'docx', fileName: file.name, text, pageTexts };
  } finally {
    host.remove();
  }
}

// Totul într-un singur pas, după ce a ales profesorul
export async function prepareMaterial(kind, files, opts = {}) {
  if (kind === 'pdf') return preparePdf(files[0]);
  if (kind === 'docx') return docxToPdf(files[0], opts);
  if (kind === 'foto') return photosToPdf(files, opts);
  throw new Error('Format necunoscut.');
}

export const fmtMb = (bytes) => (bytes < 1024 * 1024
  ? `${Math.max(1, Math.round(bytes / 1024))} KB`
  : `${(bytes / (1024 * 1024)).toFixed(bytes > 10 * 1024 * 1024 ? 0 : 1).replace('.', ',')} MB`);
