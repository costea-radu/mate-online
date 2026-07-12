// =====================================================================
// src/lib/pdfCombine.js — COMBINARE EXACTĂ (vectorială) a subiectelor PDF
// Aceeași metodă cu care a fost construit manual „EN 2023 + itemi 2024”:
// fiecare exercițiu e DECUPAT ca regiune vectorială din PDF-ul sursă și
// așezat într-un PDF nou — redactare identică, fără AI, fără greșeli.
// Rulează în browser: pdf.js (citire+coordonate) + pdf-lib (compunere).
// =====================================================================

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const PDFLIB_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if ([...document.scripts].some((s) => s.src === src)) return resolve();
    const el = document.createElement('script');
    el.src = src; el.onload = resolve; el.onerror = () => reject(new Error('Nu s-a putut încărca ' + src));
    document.head.appendChild(el);
  });
}

async function ensureLibs() {
  if (!window.pdfjsLib) await loadScript(PDFJS_URL);
  if (!window.PDFLib) await loadScript(PDFLIB_URL);
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
}

// pdf.js sparge deseori diacriticele în bucăți („Prob ă scris ă”) — de aceea
// detectăm antetele/footerele pe text NORMALIZAT (fără diacritice și spații).
const normTxt = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').toLowerCase();
const HEADER_N = ['ministerul', 'centrulnational', 'evaluareanationala', 'examenulnational', 'politicisievaluare'];
const FOOTER_N = ['probascrisa', 'pagina'];
const BAREM_N = ['baremdeevaluare', 'baremdecorectare', 'baremdenotare'];

// Analizează un PDF: markerele subiectelor/itemilor + zona de conținut pe pagini.
// Coordonate pdf.js/pdf-lib: originea JOS-stânga (y crește în sus).
async function analyze(bytes) {
  const doc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  const n = doc.numPages;
  const first = await doc.getPage(1);
  const W = first.view[2], H = first.view[3];

  const contentMaxY = {}, contentMinY = {}, pageLines = {};
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    // grupăm pe linii (y rotunjit)
    const lines = new Map();
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const y = Math.round(it.transform[5]);
      const key = [...lines.keys()].find((k) => Math.abs(k - y) <= 2) ?? y;
      if (!lines.has(key)) lines.set(key, []);
      lines.get(key).push({ x: it.transform[4], str: it.str });
    }
    const arr = [...lines.entries()].map(([y, parts]) => ({
      y,
      x: Math.min(...parts.map((q) => q.x)),
      text: parts.sort((a, b) => a.x - b.x).map((q) => q.str).join(' ').replace(/\s+/g, ' ').trim(),
    })).sort((a, b) => b.y - a.y);
    pageLines[p] = arr;

    let maxY = H - 30, minY = 34;
    for (const L of arr) {
      const nt = normTxt(L.text);
      if (HEADER_N.some((k) => nt.includes(k)) && L.y > H * 0.7) maxY = Math.min(maxY, L.y - 6);
      if (FOOTER_N.some((k) => nt.includes(k)) && L.y < H * 0.3) minY = Math.max(minY, L.y + 12);
    }
    contentMaxY[p] = maxY; contentMinY[p] = minY;
  }

  // markere, cu filtru secvențial (1→6 în interiorul subiectului)
  const marks = [];
  let baremAt = null; // NU preluăm partea de barem din fișier
  for (let p = 2; p <= n && !baremAt; p++) {
    for (const L of pageLines[p]) {
      if (L.y > contentMaxY[p] || L.y < contentMinY[p]) continue;
      const nt = normTxt(L.text);
      if (BAREM_N.some((k) => nt.includes(k)) || nt.startsWith('baremdeevaluare')) { baremAt = { p, y: L.y }; break; }
      if (/^SUBIECTUL/i.test(L.text) || nt.startsWith('subiectul')) {
        const which = /III|3-?lea/i.test(L.text) ? 3 : (/II|2-?lea/i.test(L.text) ? 2 : 1);
        marks.push({ p, y: L.y, kind: 'S', v: which });
      } else {
        const m = L.text.match(/^(?:\d+\s*p\.?\s*)?([1-6])\s*\.(?:\s|$)/);
        if (m && L.x < 100) marks.push({ p, y: L.y, kind: 'I', v: Number(m[1]) });
      }
    }
  }
  marks.sort((a, b) => (a.p - b.p) || (b.y - a.y));
  const seq = [];
  let curS = 0, expect = 1;
  for (const mk of marks) {
    if (mk.kind === 'S') { curS = mk.v; expect = 1; seq.push({ ...mk }); }
    else if (curS && mk.v === expect) { seq.push({ ...mk, s: curS }); expect++; }
  }
  // limita de sus a decupajului: la JUMĂTATEA distanței față de rândul de deasupra
  // (formulele înalte — fracții, radicali — nu mai sunt tăiate)
  for (const mk of seq) {
    const above = pageLines[mk.p].filter((L) => L.y > mk.y + 3 && L.y <= contentMaxY[mk.p]).sort((a, b) => a.y - b.y)[0];
    const pad = above ? Math.max(14, Math.min(30, (above.y - mk.y) * 0.55)) : 18;
    mk.cut = Math.min(mk.y + pad, contentMaxY[mk.p]);
  }

  // regiuni (posibil pe mai multe pagini)
  const regions = {};
  for (let i = 0; i < seq.length; i++) {
    const cur = seq[i];
    const startTop = cur.cut;
    let endP, endTop;
    if (i + 1 < seq.length) {
      endP = seq[i + 1].p;
      endTop = seq[i + 1].cut;
    } else if (baremAt) {
      // ultimul item se oprește ÎNAINTE de barem
      endP = baremAt.p; endTop = Math.min(baremAt.y + 8, contentMaxY[baremAt.p]);
    } else {
      endP = n; endTop = contentMinY[n];
    }
    const chunks = [];
    if (endP === cur.p) {
      chunks.push({ p: cur.p, top: startTop, bottom: Math.max(endTop, contentMinY[cur.p]) });
    } else {
      chunks.push({ p: cur.p, top: startTop, bottom: contentMinY[cur.p] });
      for (let mid = cur.p + 1; mid < endP; mid++) chunks.push({ p: mid, top: contentMaxY[mid], bottom: contentMinY[mid] });
      if (contentMaxY[endP] - endTop > 14) chunks.push({ p: endP, top: contentMaxY[endP], bottom: endTop });
    }
    const key = cur.kind === 'S' ? `S${cur.v}` : `${cur.s}.${cur.v}`;
    regions[key] = chunks.filter((c) => c.top - c.bottom > 5);
  }
  return { bytes, numPages: n, W, H, regions };
}

// Combină: coperta+antetele din prima sursă; itemul de pe fiecare poziție vine
// din sursa aleasă de PLANUL aleatoriu (fiecare poziție din ALT fișier).
export async function combineExamPdfs(sources, { onProgress } = {}) {
  await ensureLibs();
  const { PDFDocument } = window.PDFLib;

  const idx = [];
  for (let i = 0; i < sources.length; i++) {
    onProgress?.(`Analizez ${i + 1}/${sources.length}: ${sources[i].label}…`);
    try {
      const a = await analyze(sources[i].bytes);
      const items = Object.keys(a.regions).filter((k) => k.includes('.')).length;
      if (items >= 12) idx.push({ ...a, label: sources[i].label });
    } catch { /* sursă ignorată */ }
  }
  if (idx.length < 2) throw new Error('Nu am putut analiza suficiente PDF-uri-sursă (minim 2 cu structură oficială).');

  const base = idx[0];
  const W = base.W, H = base.H, TOP = 46, BOT = H - 46, GAP = 8;

  onProgress?.('Compun subiectul nou…');
  const out = await PDFDocument.create();
  const srcDocs = [];
  for (const a of idx) srcDocs.push(await PDFDocument.load(a.bytes, { ignoreEncryption: true }));

  // coperta variantei de bază, neatinsă
  const [cover] = await out.copyPages(srcDocs[0], [0]);
  out.addPage(cover);

  let page = out.addPage([W, H]);
  let cursor = TOP; // de sus în jos
  const ensureRoom = (h) => {
    if (cursor + h > BOT - TOP + TOP) { page = out.addPage([W, H]); cursor = TOP; }
  };
  async function place(srcI, chunks) {
    for (const c of chunks) {
      const h = c.top - c.bottom;
      ensureRoom(h);
      const emb = await out.embedPage(srcDocs[srcI].getPage(c.p - 1), { left: 30, right: W - 30, bottom: c.bottom, top: c.top });
      page.drawPage(emb, { x: 30, y: H - cursor - h });
      cursor += h;
    }
    cursor += GAP;
  }

  // planul: pozițiile alternează între surse (amestecate), baza dă antetele
  const order = idx.map((_, i) => i).sort(() => Math.random() - 0.5);
  const report = [];
  let pos = 0;
  for (let s = 1; s <= 3; s++) {
    if (base.regions[`S${s}`]) await place(0, base.regions[`S${s}`]);
    for (let it = 1; it <= 6; it++) {
      pos++;
      // sursa planificată; dacă nu are itemul, cădem pe bază
      let chosen = order[pos % order.length];
      if (!idx[chosen].regions[`${s}.${it}`]) chosen = 0;
      const reg = idx[chosen].regions[`${s}.${it}`];
      if (reg) { await place(chosen, reg); report.push(`S${s}.${it} ← ${idx[chosen].label}`); }
    }
  }

  const bytesOut = await out.save();
  return { bytes: bytesOut, report, sources: idx.map((a) => a.label) };
}

// Descarcă sursele PDF ale unei rubrici (listă de rânduri `content`).
export async function fetchPdfSources(rows, getUrl, { max = 5, onProgress, ordered = false } = {}) {
  const picked = (ordered ? [...rows] : [...rows].sort(() => Math.random() - 0.5)).slice(0, max);
  const out = [];
  for (const r of picked) {
    try {
      onProgress?.(`Descarc: ${r.title}…`);
      const url = await getUrl(r);
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const buf = new Uint8Array(await resp.arrayBuffer());
      if (buf.length > 12 * 1024 * 1024) continue;
      out.push({ label: r.title, bytes: buf });
    } catch { /* sursă ignorată */ }
  }
  return out;
}

// Amestecă rândurile STRATIFICAT pe subcategorii: câte unul din fiecare
// (Simulări, Variante Date + Modele, Exerciții pe Subiecte…), apoi reia —
// garantează combinarea între subcategorii diferite.
export function stratifyBySubcategory(rows) {
  const groups = {};
  rows.forEach((r) => { (groups[r.subcategory || ''] = groups[r.subcategory || ''] || []).push(r); });
  Object.values(groups).forEach((a) => a.sort(() => Math.random() - 0.5));
  const keys = Object.keys(groups).sort(() => Math.random() - 0.5);
  const out = [];
  let added = true;
  while (added) {
    added = false;
    for (const k of keys) { const it = groups[k].pop(); if (it) { out.push(it); added = true; } }
  }
  return out;
}
