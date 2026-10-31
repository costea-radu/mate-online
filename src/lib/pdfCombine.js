// =====================================================================
// src/lib/pdfCombine.js — COMBINARE EXACTĂ (vectorială) a subiectelor PDF
// Aceeași metodă cu care a fost construit manual „EN 2023 + itemi 2024”:
// fiecare exercițiu e DECUPAT ca regiune vectorială din PDF-ul sursă și
// așezat într-un PDF nou — redactare identică, fără AI, fără greșeli.
// Rulează în browser: pdf.js (citire+coordonate) + pdf-lib (compunere).
//
// Folosit de:
//   • „📄 Generează subiect examen" (src/components/ExamGenerator.jsx) și
//     agentul din Admin (src/components/AIExerciseAgent.jsx) — UN subiect:
//     combineExamPdfs(sources);
//   • „👥 Test pe grupă → ⚡ Generează acum testele" în format PDF
//     (src/components/CombinedPdfGenerator.jsx, 31 oct. 2026) — MAI MULTE
//     teste deodată, diferite între ele, cu toate subiectele sau doar cu unele
//     (I · II · III · I + II): prepareExamSources → planCombinations →
//     openSourceDocs → composeExamPdf.
//
// Pe scurt:
//   1. analyze — markerele „SUBIECTUL …" și „1." … „6." din textul PDF-ului
//      (pdf.js) și zona de conținut a fiecărei pagini (fără antet / subsol);
//      fiecare exercițiu devine o regiune (posibil pe mai multe pagini).
//      Subiectele de EN au copertă (pagina 1, ca până acum); cele de BAC încep
//      direct cu antetul probei și SUBIECTUL I pe pagina 1 — se recunosc ambele.
//   2. prepareExamSources — păstrează sursele cu aceeași STRUCTURĂ (6·6·6 la
//      EN, 6·2·2 la BAC), ca pe o poziție să vină mereu același tip de exercițiu.
//   3. planCombinations — POZIȚIE CU POZIȚIE: exercițiul 3 al Subiectului II
//      vine dintre exercițiile 3 ale Subiectului II din surse; în același test
//      pozițiile vin din surse diferite, iar testele diferă între ele.
//   4. composeExamPdf — coperta (sau antetul probei) din sursa de bază, titlurile
//      subiectelor, exercițiile. Regiunile unei surse se încorporează într-un
//      singur pas (fonturile se copiază o dată → PDF mai mic). Se întoarce și
//      TEXTUL testului, pentru Profesorul Virtual: o pagină-sursă încorporată își
//      păstrează în PDF tot textul (e doar decupată vizual), deci textul citit
//      din fișier ar amesteca exercițiile celelalte.
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

// generator pseudo-aleator cu sămânță (mulberry32) + amestec Fisher–Yates —
// `sort(() => Math.random() - 0.5)` nu dă o permutare uniformă
function rngFrom(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(list, rnd = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ─── Ce subiecte intră în test (cerut pe 31 oct. 2026, la testele pe grupă) ──
export const SUBJECT_CHOICES = [
  { id: 'toate', subjects: [1, 2, 3], label: 'Toate subiectele (I, II și III)' },
  { id: 's1', subjects: [1], label: 'Doar Subiectul I' },
  { id: 's2', subjects: [2], label: 'Doar Subiectul al II-lea' },
  { id: 's3', subjects: [3], label: 'Doar Subiectul al III-lea' },
  { id: 's12', subjects: [1, 2], label: 'Doar Subiectele I și II' },
];
export function normSubjects(list) {
  const s = [...new Set((Array.isArray(list) ? list : []).map(Number))]
    .filter((v) => v === 1 || v === 2 || v === 3)
    .sort((a, b) => a - b);
  return s.length ? s : [1, 2, 3];
}
const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };
export function subjectsLabel(list) {
  const s = normSubjects(list);
  if (s.length === 3) return 'Subiectele I, II și III';
  if (s.length === 1) return s[0] === 1 ? 'Subiectul I' : `Subiectul al ${ROMAN[s[0]]}-lea`;
  return `Subiectele ${ROMAN[s[0]]} și ${ROMAN[s[1]]}`;
}
export const isFullTest = (list) => normSubjects(list).length === 3;
// fiecare subiect are 30 de puncte (EN și BAC); oficiul (10p) e doar la testul complet
export const subjectsPoints = (list) => normSubjects(list).length * 30;

// pdf.js sparge deseori diacriticele în bucăți („Prob ă scris ă”) — de aceea
// detectăm antetele/footerele pe text NORMALIZAT (fără diacritice și spații).
const normTxt = (t) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, '').toLowerCase();
const HEADER_N = ['ministerul', 'centrulnational', 'evaluareanationala', 'examenulnational', 'politicisievaluare'];
const FOOTER_N = ['probascrisa', 'pagina'];
const BAREM_N = ['baremdeevaluare', 'baremdecorectare', 'baremdenotare'];

// Textul paginilor: rândurile (cu y-ul lor) + zona de conținut a fiecărei pagini.
// Coordonate pdf.js/pdf-lib: originea JOS-stânga (y crește în sus).
async function readPages(doc) {
  const n = doc.numPages;
  const first = await doc.getPage(1);
  const W = first.view[2], H = first.view[3];
  const contentMaxY = {}, contentMinY = {}, pageLines = {};
  for (let p = 1; p <= n; p++) {
    const page = p === 1 ? first : await doc.getPage(p);
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
  return { n, W, H, contentMaxY, contentMinY, pageLines };
}

// Markerele subiectelor/itemilor de la pagina `from` încolo → regiunile.
// `ink` (opțional, inkRows): rândurile de pixeli cu „cerneală" ale paginilor —
// tăieturile nu mai trec prin desene, iar albul de la capătul paginii se taie.
function structureFrom(pg, from, ink = null) {
  const { n, contentMaxY, contentMinY, pageLines } = pg;
  // e cerneală (text, linie, figură) pe rândul de la y-ul dat al paginii p?
  const isInk = (p, y) => {
    const m = ink && ink[p];
    if (!m) return false;
    const r = Math.round((m.top - y) * m.scale);
    return r >= 0 && r < m.rows.length && m.rows[r] === 1;
  };
  // markere, cu filtru secvențial (1→6 în interiorul subiectului)
  const marks = [];
  let baremAt = null; // NU preluăm partea de barem din fișier
  for (let p = from; p <= n && !baremAt; p++) {
    for (const L of pageLines[p]) {
      if (L.y > contentMaxY[p] || L.y < contentMinY[p]) continue;
      const nt = normTxt(L.text);
      if (BAREM_N.some((k) => nt.includes(k)) || nt.startsWith('baremdeevaluare')) { baremAt = { p, y: L.y }; break; }
      if (/^SUBIECTUL/i.test(L.text) || nt.startsWith('subiectul')) {
        // numărul subiectului se citește din textul NORMALIZAT (pdf.js sparge
        // des literele: „I I - l e a”) și DOAR imediat după „subiectul(al)” —
        // altfel „(30 de puncte)” de pe rândul Subiectului I era luat drept 3,
        // iar geometria Subiectului II ajungea sub cheile Subiectului I.
        const tail = nt.replace(/^subiectul(al)?/, '');
        const which = /^(iii|3)/.test(tail) ? 3 : (/^(ii|2)/.test(tail) ? 2 : 1);
        marks.push({ p, y: L.y, x: L.x, kind: 'S', v: which });
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
  // GARANȚIE: subiectele trebuie să apară în ordine strict crescătoare (I → II → III).
  // Dubluri sau ordine inversă = antete citite greșit → sursa e refuzată, ca un
  // item de geometrie (S2) să nu poată ajunge niciodată sub cheile Subiectului I.
  const sOrder = seq.filter((m) => m.kind === 'S').map((m) => m.v);
  if (sOrder.length < 2 || !sOrder.every((v, i) => i === 0 || v > sOrder[i - 1])) {
    throw new Error('structură de subiecte nerecunoscută');
  }
  // limita de sus a decupajului: la JUMĂTATEA distanței față de rândul de deasupra
  // (formulele înalte — fracții, radicali — nu mai sunt tăiate)
  for (let i = 0; i < seq.length; i++) {
    const mk = seq[i];
    const above = pageLines[mk.p].filter((L) => L.y > mk.y + 3 && L.y <= contentMaxY[mk.p]).sort((a, b) => a.y - b.y)[0];
    const pad = above ? Math.max(14, Math.min(30, (above.y - mk.y) * 0.55)) : 18;
    mk.cut = Math.min(mk.y + pad, contentMaxY[mk.p]);
    // Tăietura trece printr-un desen? (figura exercițiului de deasupra coboară mai
    // jos decât textul lui, sau etichetele figurii acestui exercițiu urcă peste
    // rândul lui.) → o mutăm în cel mai apropiat alb: în jos cel mult până la 14pt
    // deasupra rândului exercițiului (loc pentru fracții, radicali), în sus cel
    // mult 12pt (doar un element mic, nu figura întreagă a exercițiului de deasupra)
    if (isInk(mk.p, mk.cut)) {
      const floor = mk.y + 14;
      const prev = seq[i - 1];
      const ceil = Math.min(contentMaxY[mk.p], prev && prev.p === mk.p ? prev.y - 2 : Infinity);
      const opt = [];
      let y = mk.cut;
      while (y > floor && isInk(mk.p, y)) y -= 1;
      if (y > floor) {
        let y2 = y;
        while (y2 > floor && !isInk(mk.p, y2)) y2 -= 1;
        opt.push({ at: Math.max((y + y2) / 2, y - 8), dist: mk.cut - y });
      }
      y = mk.cut;
      while (y < ceil && isInk(mk.p, y)) y += 1;
      if (y < ceil && y - mk.cut <= 12) {
        let y2 = y;
        while (y2 < ceil && !isInk(mk.p, y2)) y2 += 1;
        opt.push({ at: Math.min((y + y2) / 2, y + 8), dist: y - mk.cut });
      }
      if (opt.length) mk.cut = opt.sort((a, b) => a.dist - b.dist)[0].at;
    }
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
    // `toEnd`: bucata merge până la subsolul paginii (exercițiul următor e pe altă
    // pagină) — dedesubt poate fi mult alb, tăiat mai jos, după harta cernelii
    const chunks = [];
    if (endP === cur.p) {
      const bottom = Math.max(endTop, contentMinY[cur.p]);
      chunks.push({ p: cur.p, top: startTop, bottom, toEnd: bottom <= contentMinY[cur.p] });
    } else {
      chunks.push({ p: cur.p, top: startTop, bottom: contentMinY[cur.p], toEnd: true });
      for (let mid = cur.p + 1; mid < endP; mid++) chunks.push({ p: mid, top: contentMaxY[mid], bottom: contentMinY[mid], toEnd: true });
      if (contentMaxY[endP] - endTop > 14) chunks.push({ p: endP, top: contentMaxY[endP], bottom: endTop });
    }
    const key = cur.kind === 'S' ? `S${cur.v}` : `${cur.s}.${cur.v}`;
    regions[key] = chunks.filter((c) => c.top - c.bottom > 5);
  }
  // Albul de sub ultimul exercițiu al unei pagini: regiunea lui merge până la
  // subsol (următorul e pe pagina următoare), iar în testul nou albul acela
  // împingea exercițiile pe pagina următoare — un test „doar Subiectul I" ieșea
  // cu exercițiul 6 singur pe a doua pagină. La Subiectele I și II (grile, fără
  // spațiu de scris) bucata se oprește sub ultima cerneală reală, deci figurile,
  // tabelele și liniile rămân întregi. Subiectul III rămâne neatins (la EN, sub
  // probleme poate fi spațiul de scris al elevului).
  if (ink) {
    for (const [key, chunks] of Object.entries(regions)) {
      if (!/^[12]\.\d$/.test(key)) continue;
      for (const c of chunks) {
        if (!c.toEnd || !ink[c.p]) continue;
        let y = c.bottom;
        while (y < c.top && !isInk(c.p, y)) y += 1;
        if (y < c.top) c.bottom = Math.max(c.bottom, Math.min(y - 10, c.top - 10));
      }
    }
  }
  // antetul probei, deasupra primului subiect (la BAC: „Proba E. c) … Filiera …
  // Toate subiectele sunt obligatorii…") — ține loc de copertă când nu există
  const firstS = seq.find((m) => m.kind === 'S');
  if (firstS && contentMaxY[firstS.p] - firstS.cut > 14) {
    regions.H = [{ p: firstS.p, top: contentMaxY[firstS.p], bottom: firstS.cut }];
  }
  const counts = { 1: 0, 2: 0, 3: 0 };
  for (const k of Object.keys(regions)) {
    const m = /^([123])\.([1-6])$/.exec(k);
    if (m && regions[k].length) counts[m[1]] = Math.max(counts[m[1]], Number(m[2]));
  }
  // marginea din stânga a textului (rândul „SUBIECTUL I") — antetul generat se aliniază la ea
  return { regions, counts, left: firstS ? firstS.x : null };
}

// O sursă e bună dacă are toate cele trei subiecte, cu exercițiile recunoscute:
// la EN 6 · 6 · 6 (6 · 5 · 5 la formatul vechi), la BAC 6 · 2 · 2.
export function structureOk(counts) {
  const c = counts || {};
  return (c[1] || 0) >= 5 && (c[2] || 0) >= 2 && (c[3] || 0) >= 2;
}
export const signatureOf = (counts) => `${(counts && counts[1]) || 0}-${(counts && counts[2]) || 0}-${(counts && counts[3]) || 0}`;

// Analizează un PDF: regiunile exercițiilor + structura. Întâi cu pagina 1 drept
// copertă (subiectele de EN — exact ca până acum), apoi fără copertă (BAC:
// antetul probei și SUBIECTUL I stau pe pagina 1).
async function analyze(bytes) {
  const doc = await window.pdfjsLib.getDocument({ data: bytes.slice(0) }).promise;
  try {
    const pg = await readPages(doc);
    let err = null;
    for (const from of [2, 1]) {
      if (from > pg.n) continue;
      let st = null;
      try {
        st = structureFrom(pg, from);
        if (!structureOk(st.counts)) { err = new Error('structură de subiecte incompletă'); st = null; }
      } catch (e) { err = e; }
      if (!st) continue;
      // structura e bună → paginile se randează o dată (mic), iar regiunile se
      // refac cu tăieturile prin alb și fără albul de la capătul paginii
      const pages = [];
      for (let p = from; p <= pg.n; p++) pages.push(p);
      const ink = await inkRows(doc, pages);
      if (Object.keys(ink).length) {
        try { const fin = structureFrom(pg, from, ink); if (structureOk(fin.counts)) st = fin; } catch { /* rămân regiunile după text */ }
      }
      return {
        bytes, numPages: pg.n, W: pg.W, H: pg.H, regions: st.regions, counts: st.counts,
        signature: signatureOf(st.counts), hasCover: from === 2, pageLines: pg.pageLines, left: st.left,
      };
    }
    throw err || new Error('structură de subiecte nerecunoscută');
  } finally {
    // fiecare document ține un worker pdf.js — îl eliberăm după citire
    try { doc.destroy(); } catch { /* noop */ }
  }
}

// Rândurile de pixeli cu „cerneală" (text, linii, figuri, imagini) ale paginilor,
// pe lățimea zonei care se decupează: pagina se randează mic, cu pdf.js. Le
// folosesc tăieturile dintre exerciții (să nu treacă prin desene) și tăierea
// albului de la capătul paginii. Fără canvas (sau dacă randarea pică) → {}, iar
// regiunile rămân cele calculate după text, ca înainte.
async function inkRows(doc, pages) {
  const out = {};
  if (typeof document === 'undefined') return out;
  const SCALE = 1, DARK = 236;
  for (const p of pages) {
    try {
      const page = await doc.getPage(p);
      const vp = page.getViewport({ scale: SCALE });
      const w = Math.ceil(vp.width), h = Math.ceil(vp.height);
      const cv = document.createElement('canvas');
      cv.width = w; cv.height = h;
      const g = cv.getContext('2d', { willReadFrequently: true });
      g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      const px = g.getImageData(0, 0, w, h).data;
      const left = page.view[0], top = page.view[3];
      const c0 = Math.max(0, Math.floor((30 - left) * SCALE));
      const c1 = Math.min(w - 1, Math.ceil((page.view[2] - left - 30) * SCALE));
      const rows = new Uint8Array(h);
      for (let r = 0; r < h; r++) {
        for (let x = c0; x <= c1; x++) {
          const i = (r * w + x) * 4;
          if (px[i] < DARK || px[i + 1] < DARK || px[i + 2] < DARK) { rows[r] = 1; break; }
        }
      }
      out[p] = { rows, top, scale: SCALE };
      try { page.cleanup(); } catch { /* noop */ }
    } catch { /* pagina rămâne fără hartă — tăieturile ei rămân după text */ }
  }
  return out;
}

// Verifică rapid dacă un PDF are structura oficială de subiect (toate cele trei
// subiecte, cu exercițiile recunoscute din textul PDF-ului) — scanările fără strat
// de text și capitolele fără structură de examen sunt refuzate, ca să fie
// ÎNLOCUITE cu alt fișier. Întoarce analiza (refolosită la combinare) sau false.
export async function probeExamPdf(bytes) {
  await ensureLibs();
  try { return await analyze(bytes); } catch { return false; }
}

// Structurile cunoscute: EN de azi (6 · 6 · 6) și BAC (6 · 2 · 2) — au prioritate.
const PREFERRED = ['6-6-6', '6-2-2'];
// Sursele cu ACEEAȘI structură (cel mai numeros grup, cu prioritate pentru
// structurile oficiale de azi) — altfel, la o poziție, ar putea ajunge un alt
// tip de exercițiu (modelul vechi de EN avea 5 probleme la Subiectul II).
export function pickGroup(list) {
  const groups = new Map();
  for (const a of list || []) {
    const k = a.signature || signatureOf(a.counts);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const total = (k) => k.split('-').reduce((s, v) => s + (Number(v) || 0), 0);
  const pref = (k) => (PREFERRED.includes(k) ? 1 : 0);
  const cand = [...groups.entries()].filter(([, g]) => g.length >= 2)
    .sort((A, B) => (pref(B[0]) - pref(A[0])) || (B[1].length - A[1].length) || (total(B[0]) - total(A[0])));
  if (!cand.length) return { list: [...(list || [])], signature: null };
  return { list: cand[0][1], signature: cand[0][0] };
}

// Analizează sursele (refolosește analiza făcută la verificare, dacă există) și
// păstrează grupul cu aceeași structură. Cel puțin 2 surse, altfel eroare.
export async function prepareExamSources(sources, { onProgress } = {}) {
  await ensureLibs();
  const ok = [];
  for (let i = 0; i < (sources || []).length; i++) {
    const s = sources[i];
    onProgress?.(`Analizez ${i + 1}/${sources.length}: ${s.label}…`);
    try {
      const a = s.analysis && s.analysis.regions ? s.analysis : await analyze(s.bytes);
      ok.push({ ...a, label: s.label, subcategory: s.subcategory || '' });
    } catch { /* sursă ignorată */ }
  }
  const g = pickGroup(ok);
  if (g.list.length < 2) throw new Error('Nu am putut analiza suficiente PDF-uri-sursă (minim 2 cu structură oficială).');
  return { list: g.list, signature: g.signature, analyzed: ok.length, dropped: ok.length - g.list.length };
}

const hasRegion = (a, key) => !!(a && a.regions && a.regions[key] && a.regions[key].length);

// Câte teste DIFERITE se pot face din surse (produsul alegerilor pe poziții).
export function maxDistinctTests(list, subjects) {
  const subj = normSubjects(subjects);
  let prod = 1;
  for (const s of subj) {
    for (let it = 1; it <= 6; it++) {
      const k = (list || []).filter((a) => hasRegion(a, `${s}.${it}`)).length;
      if (k) prod *= k;
      if (prod > 1e9) return Infinity;
    }
  }
  return prod;
}

/**
 * Planul a `count` teste: pentru fiecare, sursa de BAZĂ (coperta / antetul
 * probei + titlurile subiectelor) și sursa fiecărei poziții „s.it".
 *   • poziție cu poziție: exercițiul it al subiectului s vine dintre exercițiile
 *     it ale subiectului s din surse (la EN poziția fixează tipul exercițiului);
 *   • în același test, pozițiile unui subiect vin din surse DIFERITE (cât ajung);
 *   • testele dintr-o „tură" (câte surse sunt) diferă la FIECARE poziție; între
 *     ture permutările se trag din nou, iar un test identic cu unul deja făcut
 *     se trage iar (cel mult 40 de încercări — `duplicate` dacă nu se poate).
 * Pur (fără pdf.js / pdf-lib) — se testează direct în Node.
 * @param {Array<{regions}>} list sursele pregătite
 * @returns {Array<{ index, base, picks: { 's.it': sursa }, duplicate }>}
 */
export function planCombinations(list, { count = 1, subjects = [1, 2, 3], seed = null } = {}) {
  const S = (list || []).length;
  if (!S) return [];
  const subj = normSubjects(subjects);
  const n = Math.max(1, Math.min(200, parseInt(count, 10) || 1));
  const rnd = rngFrom(seed ?? ((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0));
  const all = [...Array(S).keys()];
  // câte poziții are fiecare subiect (la EN 6, la BAC 6 / 2 / 2)
  const positions = {};
  for (const s of subj) {
    let m = 0;
    for (let i = 0; i < S; i++) for (let it = 1; it <= 6; it++) if (hasRegion(list[i], `${s}.${it}`)) m = Math.max(m, it);
    positions[s] = m;
  }
  // baza: o sursă care are titlurile tuturor subiectelor alese; se rotește între teste
  const complete = all.filter((i) => subj.every((s) => hasRegion(list[i], `S${s}`)));
  const bases = shuffle(complete.length ? complete : all, rnd);
  const perms = {};
  const perm = (s, r) => perms[`${s}:${r}`] || (perms[`${s}:${r}`] = shuffle(all, rnd));
  const sigOf = (picks) => Object.keys(picks).sort().map((k) => `${k}:${picks[k]}`).join('|');

  function latin(r, off) {
    const picks = {};
    for (const s of subj) {
      const P = perm(s, r);
      for (let it = 1; it <= positions[s]; it++) {
        const key = `${s}.${it}`;
        for (let k = 0; k < S; k++) {
          const cand = P[(off + it - 1 + k) % S];
          if (hasRegion(list[cand], key)) { picks[key] = cand; break; }
        }
      }
    }
    return picks;
  }
  function randomPicks() {
    const picks = {};
    for (const s of subj) {
      for (let it = 1; it <= positions[s]; it++) {
        const key = `${s}.${it}`;
        const c = all.filter((i) => hasRegion(list[i], key));
        if (c.length) picks[key] = c[Math.floor(rnd() * c.length)];
      }
    }
    return picks;
  }

  const seen = new Set();
  const plans = [];
  for (let t = 0; t < n; t++) {
    let picks = latin(Math.floor(t / S), t % S);
    let sig = sigOf(picks);
    for (let tries = 0; seen.has(sig) && tries < 40; tries++) { picks = randomPicks(); sig = sigOf(picks); }
    const duplicate = seen.has(sig);
    seen.add(sig);
    plans.push({ index: t + 1, base: bases[t % bases.length], picks, duplicate });
  }
  return plans;
}

// Documentele pdf-lib ale surselor — deschise o singură dată pentru toate testele.
export async function openSourceDocs(list) {
  await ensureLibs();
  const { PDFDocument } = window.PDFLib;
  const docs = [];
  for (const a of list || []) docs.push(await PDFDocument.load(a.bytes, { ignoreEncryption: true }));
  return docs;
}

// textul unei regiuni / al unei pagini-sursă (rândurile citite la analiză)
const chunkText = (a, c) => ((a.pageLines && a.pageLines[c.p]) || [])
  .filter((L) => L.y <= c.top && L.y > c.bottom).map((L) => L.text).join('\n');
const pageText = (a, p) => ((a.pageLines && a.pageLines[p]) || []).map((L) => L.text).join('\n');

/**
 * Compune UN test după plan.
 *  • testul complet (I, II, III): coperta sursei de bază, neatinsă (EN), sau
 *    antetul probei de pe pagina 1 (BAC, fără copertă);
 *  • doar unele subiecte: fără copertă (spune „Toate subiectele sunt
 *    obligatorii… două ore") — în locul ei, antetul `header`: rezultatul lui
 *    makeHeaderPng sau o funcție (lățimeaPt) → makeHeaderPng(…), ca antetul să
 *    aibă exact lățimea textului din pagină;
 *  • titlurile subiectelor (SUBIECTUL I (30 de puncte) + indicațiile) din bază.
 * @returns {{ bytes, report, sources, pages, text, pageTexts, size }}
 */
export async function composeExamPdf(prepared, plan, { subjects = [1, 2, 3], header = null, srcDocs = null } = {}) {
  await ensureLibs();
  const { PDFDocument } = window.PDFLib;
  const list = Array.isArray(prepared) ? prepared : (prepared && prepared.list) || [];
  if (!list.length || !plan) throw new Error('Nu am surse pentru combinare.');
  const subj = normSubjects(subjects);
  const full = subj.length === 3;
  const docs = srcDocs || await openSourceDocs(list);
  const baseI = list[plan.base] ? plan.base : 0;
  const base = list[baseI];
  const W = base.W, H = base.H, TOP = 46, BOT = H - 46, GAP = 8;

  // 1) ce se așază, în ordine
  const blocks = [];
  const report = [];
  if (full && !base.hasCover && hasRegion(base, 'H')) blocks.push({ src: baseI, chunks: base.regions.H });
  for (const s of subj) {
    if (hasRegion(base, `S${s}`)) blocks.push({ src: baseI, chunks: base.regions[`S${s}`], head: true });
    for (let it = 1; it <= 6; it++) {
      const key = `${s}.${it}`;
      const srcI = plan.picks ? plan.picks[key] : null;
      if (srcI == null || !hasRegion(list[srcI], key)) continue;
      blocks.push({ src: srcI, chunks: list[srcI].regions[key] });
      report.push(`S${s}.${it} ← ${list[srcI].label}`);
    }
  }
  if (!report.length) throw new Error('Nu am găsit în PDF-urile-sursă exercițiile subiectelor alese.');

  // 2) regiunile fiecărei surse se încorporează ÎMPREUNĂ: un singur pas de
  //    copiere pe sursă, deci fonturile și imaginile ei intră o singură dată
  const out = await PDFDocument.create();
  const bySrc = new Map();
  for (const b of blocks) {
    for (const c of b.chunks) {
      if (!bySrc.has(b.src)) bySrc.set(b.src, []);
      bySrc.get(b.src).push(c);
    }
  }
  const embedded = new Map();
  for (const [srcI, chunks] of bySrc) {
    const pages = chunks.map((c) => docs[srcI].getPage(c.p - 1));
    const boxes = chunks.map((c) => ({ left: 30, right: W - 30, bottom: c.bottom, top: c.top }));
    const embs = await out.embedPages(pages, boxes);
    chunks.forEach((c, i) => embedded.set(c, embs[i]));
  }

  // 3) paginile
  const pageTexts = [];
  if (full && base.hasCover) {
    // coperta variantei de bază, neatinsă
    const [cover] = await out.copyPages(docs[baseI], [0]);
    out.addPage(cover);
    pageTexts.push(pageText(base, 1));
  }
  let page = out.addPage([W, H]);
  let cursor = TOP; // de sus în jos
  let txt = [];
  const newPage = () => { pageTexts.push(txt.join('\n')); page = out.addPage([W, H]); cursor = TOP; txt = []; };
  // antetul generat (testele parțiale), aliniat cu textul paginii (marginea
  // rândului „SUBIECTUL …" din sursa de bază, simetric)
  const hx = Math.max(30, Math.min(110, Math.round(base.left || 30)));
  const hdr = typeof header === 'function' ? await header(W - 2 * hx) : header;
  if (hdr && hdr.png) {
    const img = await out.embedPng(hdr.png);
    const w = W - 2 * hx;
    const h = (hdr.heightPt || 60) * (w / (hdr.widthPt || w));
    page.drawImage(img, { x: hx, y: H - cursor - h, width: w, height: h });
    cursor += h + GAP;
    if (hdr.text) txt.push(hdr.text);
  }
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    // titlul subiectului („SUBIECTUL al II-lea" + indicațiile) rămâne lângă primul
    // lui exercițiu: dacă nu încap împreună, subiectul începe pe pagina următoare
    if (b.head && cursor > TOP) {
      const next = blocks[bi + 1];
      const need = b.chunks.reduce((sum, c) => sum + (c.top - c.bottom), 0)
        + (next && !next.head && next.chunks[0] ? next.chunks[0].top - next.chunks[0].bottom : 0);
      if (cursor + need > BOT) newPage();
    }
    for (const c of b.chunks) {
      const emb = embedded.get(c);
      if (!emb) continue;
      const h = c.top - c.bottom;
      if (cursor + h > BOT && cursor > TOP) newPage();
      page.drawPage(emb, { x: 30, y: H - cursor - h });
      cursor += h;
      txt.push(chunkText(list[b.src], c));
    }
    cursor += GAP;
  }
  pageTexts.push(txt.join('\n'));

  const bytes = await out.save();
  const used = [];
  [baseI, ...Object.values(plan.picks || {})].forEach((i) => { const l = list[i] && list[i].label; if (l && !used.includes(l)) used.push(l); });
  return {
    bytes, report, sources: used, pages: out.getPageCount(),
    text: pageTexts.filter(Boolean).join('\n\n'), pageTexts, size: bytes.length,
  };
}

// Combină UN subiect (generatorul de subiecte, agentul din Admin): coperta +
// antetele dintr-o sursă, fiecare poziție din ALTĂ sursă. `subjects` (opțional)
// păstrează doar subiectele alese.
export async function combineExamPdfs(sources, { onProgress, subjects = [1, 2, 3] } = {}) {
  const prepared = await prepareExamSources(sources, { onProgress });
  onProgress?.('Compun subiectul nou…');
  const [plan] = planCombinations(prepared.list, { count: 1, subjects });
  const r = await composeExamPdf(prepared, plan, { subjects });
  return { bytes: r.bytes, report: r.report, sources: r.sources, text: r.text, pageTexts: r.pageTexts, pages: r.pages };
}

// Antetul testelor PARȚIALE (doar unele subiecte): coperta oficială spune „Toate
// subiectele sunt obligatorii… timpul de lucru…", deci nu se mai pune; în locul
// ei — titlul, subiectele și „Numele și prenumele". Se desenează pe canvas
// (fonturile sistemului au diacriticele românești, fonturile standard din pdf-lib
// nu le au) și intră în PDF ca imagine; textul lui se întoarce separat.
export async function makeHeaderPng({ title = '', subtitle = '', right = '', nameLine = true } = {}, { widthPt = 535, scale = 3 } = {}) {
  const heightPt = nameLine ? 66 : 42;
  const c = document.createElement('canvas');
  c.width = Math.round(widthPt * scale);
  c.height = Math.round(heightPt * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  const SERIF = '"Times New Roman", Times, "Liberation Serif", "DejaVu Serif", serif';
  g.fillStyle = '#000';
  g.textBaseline = 'alphabetic';
  if (right) {
    g.font = `10px ${SERIF}`;
    g.textAlign = 'right';
    g.fillText(right, widthPt, 14);
    g.textAlign = 'left';
  }
  const rightW = right ? g.measureText(right).width + 14 : 0;
  g.font = `bold 13px ${SERIF}`;
  g.fillText(title, 0, 14, Math.max(80, widthPt - rightW));
  if (subtitle) { g.font = `11px ${SERIF}`; g.fillText(subtitle, 0, 31, widthPt); }
  if (nameLine) {
    g.font = `10.5px ${SERIF}`;
    const y = 55;
    const field = (label, x0, x1) => {
      g.fillText(label, x0, y);
      const dot = Math.max(1.5, g.measureText('.').width);
      let x = x0 + g.measureText(`${label} `).width;
      let dots = '';
      while (x + dot <= x1) { dots += '.'; x += dot; }
      g.fillText(dots, x0 + g.measureText(`${label} `).width, y);
    };
    field('Numele și prenumele:', 0, widthPt * 0.6);
    field('Clasa:', widthPt * 0.63, widthPt * 0.79);
    field('Data:', widthPt * 0.82, widthPt);
  }
  g.strokeStyle = '#000';
  g.lineWidth = 0.6;
  g.beginPath(); g.moveTo(0, heightPt - 2); g.lineTo(widthPt, heightPt - 2); g.stroke();
  const png = await canvasPng(c);
  const text = [
    [title, right].filter(Boolean).join(' · '),
    subtitle,
    nameLine ? 'Numele și prenumele: ..........  Clasa: ......  Data: ......' : '',
  ].filter(Boolean).join('\n');
  return { png, widthPt, heightPt, text };
}
async function canvasPng(c) {
  const blob = await new Promise((resolve) => { try { c.toBlob(resolve, 'image/png'); } catch { resolve(null); } });
  if (blob) return new Uint8Array(await blob.arrayBuffer());
  const b64 = c.toDataURL('image/png').split(',')[1] || '';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

// Mai multe PDF-uri într-unul singur (testele unei grupe, de tipărit deodată).
export async function mergePdfs(list) {
  await ensureLibs();
  const { PDFDocument } = window.PDFLib;
  const out = await PDFDocument.create();
  for (const b of list || []) {
    const d = await PDFDocument.load(b, { ignoreEncryption: true });
    const pages = await out.copyPages(d, d.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}

// Descarcă sursele PDF ale unei rubrici (listă de rânduri `content`).
// NU se oprește la primele `max` rânduri: dacă un fișier pică (download,
// mărime, structură), încearcă URMĂTORUL — altfel subcategorii întregi
// (ex. Variante Date) cădeau tăcut și rămâneau doar Simulările.
// Continuă până acoperă TOATE subcategoriile prezente (când se poate).
// `perSubCap` (opțional): câte surse cel mult dintr-o subcategorie (implicit
// max/numărul de subcategorii — mix echilibrat). Analiza făcută de `probe` se
// păstrează pe sursă (`analysis`) și nu se mai repetă la combinare.
export async function fetchPdfSources(rows, getUrl, { max = 5, onProgress, ordered = false, probe = null, perSubCap: capOpt = null } = {}) {
  const queue = ordered ? [...rows] : shuffle(rows);
  const allSubs = new Set(queue.map((r) => r.subcategory || ''));
  // plafon pe subcategorie → mix ECHILIBRAT (nu 4 simulări + 1 variantă)
  const perSubCap = capOpt || Math.max(2, Math.ceil(max / Math.max(1, allSubs.size)));
  const covered = new Set();
  const perSub = {};
  const out = [];
  let tried = 0;
  for (const r of queue) {
    const sub = r.subcategory || '';
    if ((perSub[sub] || 0) >= perSubCap) continue;
    if (out.length >= max && covered.has(sub)) {
      if (covered.size >= allSubs.size) break;
      continue; // mai căutăm doar subcategorii lipsă
    }
    if (out.length >= max + 2 || ++tried > Math.max(12, max * 4)) break;
    try {
      onProgress?.(`Descarc: ${r.title}…`);
      const url = await getUrl(r);
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const buf = new Uint8Array(await resp.arrayBuffer());
      if (buf.length > 12 * 1024 * 1024) continue;
      let analysis = null;
      if (probe) {
        onProgress?.(`Verific structura: ${r.title}…`);
        const pr = await probe(buf);
        if (!pr) continue; // fără structură de subiect → următorul
        if (typeof pr === 'object') analysis = pr;
      }
      out.push({ label: `${r.title}${sub ? ` [${sub}]` : ''}`, bytes: buf, subcategory: sub, ...(analysis ? { analysis } : {}) });
      covered.add(sub);
      perSub[sub] = (perSub[sub] || 0) + 1;
    } catch { /* sursă ignorată — încercăm următoarea */ }
  }
  return out;
}

// Amestecă rândurile STRATIFICAT pe subcategorii: câte unul din fiecare
// (Simulări, Variante Date + Modele, Exerciții pe Subiecte…), apoi reia —
// garantează combinarea între subcategorii diferite.
export function stratifyBySubcategory(rows) {
  const groups = {};
  rows.forEach((r) => { (groups[r.subcategory || ''] = groups[r.subcategory || ''] || []).push(r); });
  Object.keys(groups).forEach((k) => { groups[k] = shuffle(groups[k]); });
  const keys = shuffle(Object.keys(groups));
  const out = [];
  let added = true;
  while (added) {
    added = false;
    for (const k of keys) { const it = groups[k].pop(); if (it) { out.push(it); added = true; } }
  }
  return out;
}
