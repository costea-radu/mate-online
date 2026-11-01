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
//   • „👥 Teste diferite / elev" → „🎓 Subiectele de examen" (din 1 nov. 2026;
//     înainte „👥 Test pe grupă → ⚡ Generează acum testele" în format PDF —
//     src/components/CombinedPdfGenerator.jsx, 31 oct. 2026) — MAI MULTE
//     teste deodată, diferite între ele, cu toate subiectele sau doar cu unele
//     (I · II · III · I + II) și, din 1 nov. 2026, cu exercițiile BIFATE — la
//     BAC și subpunctele a), b), c) ale problemelor de la Subiectele II și III
//     (`selection`): prepareExamSources → planCombinations → openSourceDocs →
//     composeExamPdf.
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

// ─── Ce EXERCIȚII intră (bife, cerut pe 1 nov. 2026) ─────────────────────────
// Profesorul bifează exercițiile fiecărui subiect; la BAC, la Subiectele II și
// III (câte 2 probleme), și subpunctele a), b), c). Selecția:
//   { items: { 1: [1, 2, 4], 2: [1, 2], 3: [2] }, parts: { '2.1': ['a', 'c'], … } }
// `parts` contează doar la problemele cu subpuncte (BAC II și III). Fiecare
// exercițiu și fiecare subpunct valorează 5 puncte (EN: 6 × 5 pe subiect; BAC:
// 6 × 5 la Subiectul I, 2 × 3 × 5 la II și III). Exercițiile își păstrează
// numărul din subiectul oficial (nu se renumerotează).
export const PART_LETTERS = ['a', 'b', 'c'];
const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
export function examLayout(exam) {
  const bac = /^bac/.test(String(exam || '')) || exam === '6-2-2';
  return bac
    ? { kind: 'bac', items: { 1: 6, 2: 2, 3: 2 }, parts: { 2: PART_LETTERS, 3: PART_LETTERS } }
    : { kind: 'en', items: { 1: 6, 2: 6, 3: 6 }, parts: {} };
}
// toate exercițiile (și subpunctele) subiectelor date
export function fullSelection(layout, subjects = [1, 2, 3]) {
  const subj = normSubjects(subjects);
  const items = {}, parts = {};
  for (const s of [1, 2, 3]) {
    items[s] = subj.includes(s) ? range(layout.items[s]) : [];
    if (layout.parts[s]) for (const it of items[s]) parts[`${s}.${it}`] = [...layout.parts[s]];
  }
  return { items, parts };
}
// curăță o selecție după structura examenului: numere valide, ordonate, fără
// dubluri; o problemă cu subpuncte e bifată ⇔ are cel puțin un subpunct
export function normSelection(sel, layout) {
  const items = {}, parts = {};
  for (const s of [1, 2, 3]) {
    const max = layout.items[s];
    let list = [...new Set(((sel && sel.items && sel.items[s]) || []).map(Number))]
      .filter((v) => Number.isInteger(v) && v >= 1 && v <= max).sort((a, b) => a - b);
    if (layout.parts[s]) {
      list = list.filter((it) => {
        const got = sel && sel.parts && sel.parts[`${s}.${it}`];
        const want = Array.isArray(got) ? layout.parts[s].filter((l) => got.includes(l)) : [...layout.parts[s]];
        if (want.length) parts[`${s}.${it}`] = want;
        return want.length > 0;
      });
    }
    items[s] = list;
  }
  return { items, parts };
}
export const selectionSubjects = (sel) => [1, 2, 3].filter((s) => ((sel && sel.items && sel.items[s]) || []).length > 0);
// subiectul s are TOATE exercițiile (și toate subpunctele) bifate?
export function subjectComplete(sel, layout, s) {
  const n = normSelection(sel, layout);
  if (n.items[s].length !== layout.items[s]) return false;
  return !layout.parts[s] || n.items[s].every((it) => n.parts[`${s}.${it}`].length === layout.parts[s].length);
}
export const selectionComplete = (sel, layout) => [1, 2, 3].every((s) => subjectComplete(sel, layout, s));
// punctajul bifat (al unui subiect sau al tuturor): 5 puncte pe exercițiu / subpunct
export function selectionPoints(sel, layout, only = null) {
  const n = normSelection(sel, layout);
  let pts = 0;
  for (const s of only ? [only] : [1, 2, 3]) {
    pts += layout.parts[s]
      ? n.items[s].reduce((sum, it) => sum + 5 * n.parts[`${s}.${it}`].length, 0)
      : 5 * n.items[s].length;
  }
  return pts;
}
// „5 puncte", „15 puncte", „20 de puncte", „90 de puncte"
export function pointsLabel(n) {
  const v = Math.abs(Math.round(Number(n) || 0));
  if (v === 1) return '1 punct';
  const r = v % 100;
  return `${v} ${r === 0 && v > 0 ? 'de ' : r >= 20 ? 'de ' : ''}puncte`;
}
// selecția care corespunde unei alegeri rapide (Toate / Doar I / …) sau null
export function presetOf(sel, layout) {
  const subj = selectionSubjects(normSelection(sel, layout));
  if (!subj.length || !subj.every((s) => subjectComplete(sel, layout, s))) return null;
  const c = SUBJECT_CHOICES.find((x) => x.subjects.join(',') === subj.join(','));
  return c ? c.id : null;
}
// rezumatul selecției: „Subiectul I: 1, 2, 4 · Subiectul al II-lea: 1 a), c); 2"
export const subjectName = (s) => (s === 1 ? 'Subiectul I' : `Subiectul al ${ROMAN[s]}-lea`);
export function selectionSummary(sel, layout) {
  const n = normSelection(sel, layout);
  return [1, 2, 3].filter((s) => n.items[s].length).map((s) => {
    if (subjectComplete(n, layout, s)) return `${subjectName(s)}: toate`;
    const its = n.items[s].map((it) => {
      const p = layout.parts[s] && n.parts[`${s}.${it}`];
      return p && p.length < layout.parts[s].length ? `${it} ${p.map((l) => `${l})`).join(', ')}` : String(it);
    });
    return `${subjectName(s)}: ${its.join(layout.parts[s] ? '; ' : ', ')}`;
  }).join(' · ');
}
// subpunctele cerute la o poziție sunt doar o parte din cele trei?
const partialWant = (w) => Array.isArray(w) && PART_LETTERS.some((l) => !w.includes(l));

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
      lines.get(key).push({ x: it.transform[4], str: it.str, h: Math.abs(it.transform[3]) || it.height || 0 });
    }
    const arr = [...lines.entries()].map(([y, parts]) => ({
      y,
      x: Math.min(...parts.map((q) => q.x)),
      text: parts.sort((a, b) => a.x - b.x).map((q) => q.str).join(' ').replace(/\s+/g, ' ').trim(),
      h: Math.round(Math.max(...parts.map((q) => q.h)) * 10) / 10, // mărimea literei (titlurile generate o copiază)
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
      // la sfârșitul documentului, bucata de pe ultima pagină merge și ea până la subsol
      if (contentMaxY[endP] - endTop > 14) chunks.push({ p: endP, top: contentMaxY[endP], bottom: endTop, ...(endTop <= contentMinY[endP] ? { toEnd: true } : {}) });
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
  // La BAC (Subiectul III cu cel mult 3 probleme) nu există spațiu de scris în
  // subiect — elevii scriu pe foaia de examen —, deci se taie și la Subiectul III.
  if (ink) {
    const s3 = Object.keys(regions).filter((k) => /^3\.\d$/.test(k)).length;
    const trim = s3 && s3 <= 3 ? /^[123]\.\d$/ : /^[12]\.\d$/;
    for (const [key, chunks] of Object.entries(regions)) {
      if (!trim.test(key)) continue;
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

  // Subpunctele a), b), c) ale problemelor de BAC (Subiectele II și III, câte 2
  // probleme) — pentru bifele pe subpuncte (1 nov. 2026). Rândul unui subpunct
  // începe la marginea din stânga cu „5p a)" (sau doar „a)"); trebuie găsite
  // toate trei, în ordine. La EN nu se caută: acolo Subiectele I și II sunt
  // grile, iar rândul variantelor începe tot cu „a)".
  // Tăietura dinaintea unui subpunct cade în MIJLOCUL albului dintre rândul lui
  // și rândul de deasupra (harta cernelii) — rândurile sunt mai apropiate decât
  // exercițiile, deci regula exercițiilor (14–30pt deasupra) ar tăia prin text.
  // → { y, clean }: `clean` = tăietura trece printr-un rând de pixeli complet alb.
  // Dacă rândurile se ating (de ex. numărătorul unei fracții urcă până în
  // rândul de deasupra), nicio linie orizontală nu le desparte fără să taie
  // din ele — atunci problema nu se desparte pe subpuncte (merge întreagă,
  // sau din altă sursă), ca să nu iasă niciodată o formulă ciuntită.
  const subCut = (mk) => {
    const lines = pageLines[mk.p];
    // rândul de deasupra: cel puțin 7,5pt mai sus; ce e mai aproape (numărătorul
    // unei fracții, un exponent — citite de pdf.js ca rânduri separate) ține de
    // rândul subpunctului, deci albul se caută DEASUPRA lor
    const own = lines.filter((L) => L.y > mk.y && L.y <= mk.y + 7.5);
    const above = lines.filter((L) => L.y > mk.y + 7.5 && L.y <= contentMaxY[mk.p]).sort((a, b) => a.y - b.y)[0];
    if (!above) return { y: Math.min(mk.y + 18, contentMaxY[mk.p]), clean: true };
    const d = above.y - mk.y;
    const m = ink && ink[mk.p];
    // fără hartă (Node, sau pagina n-a putut fi randată): ~62% din distanță,
    // dar peste literele mari (≈9,5pt) ale rândului
    if (!m) return { y: Math.min(mk.y + Math.max(Math.min(9.5, d - 3), d * 0.62), contentMaxY[mk.p]), clean: true };
    // cel mai lung șir de rânduri de pixeli albe dintre cele două rânduri de text
    const lo = Math.max(mk.y + 2, ...own.map((L) => L.y + 2));
    const rA = Math.max(0, Math.ceil((m.top - above.y) * m.scale) + 1);
    const rB = Math.min(m.rows.length - 1, Math.floor((m.top - lo) * m.scale));
    let best = null, run = null;
    for (let r = rA; r <= rB + 1; r++) {
      if (r <= rB && m.rows[r] === 0) { if (run == null) run = r; continue; }
      if (run != null && (!best || r - run > best.len)) best = { len: r - run, mid: (run + r - 1) / 2 };
      run = null;
    }
    if (!best) return { y: mk.y + d * 0.62, clean: false };
    return { y: Math.min(m.top - best.mid / m.scale, contentMaxY[mk.p]), clean: true };
  };
  const parts = {};
  for (const s of [2, 3]) {
    if (!counts[s] || counts[s] > 3) continue;
    for (let it = 1; it <= counts[s]; it++) {
      const key = `${s}.${it}`;
      const chunks = regions[key];
      if (!chunks || !chunks.length) continue;
      const found = [];
      for (const c of chunks) {
        for (const L of pageLines[c.p]) {
          if (found.length === PART_LETTERS.length) break;
          if (L.y >= c.top - 1 || L.y <= c.bottom || L.x > 130) continue;
          const m = L.text.match(/^(?:\(?\d+\s*p\)?\.?\s*)?([a-c])\s*\)/);
          if (m && m[1] === PART_LETTERS[found.length]) found.push({ letter: m[1], p: c.p, y: L.y });
        }
      }
      if (found.length !== PART_LETTERS.length) continue;
      const cuts = found.map(subCut);
      if (cuts.some((c) => !c.clean)) continue;
      const segs = splitRegion(chunks, found.map((mk, i) => ({ p: mk.p, y: cuts[i].y })));
      if (segs.length !== found.length + 1 || segs.some((g) => !g.length)) continue;
      parts[key] = { letters: found.map((f) => f.letter), stem: segs[0] };
      found.forEach((f, i) => { parts[key][f.letter] = segs[i + 1]; });
    }
  }
  // marginea din stânga a textului (rândul „SUBIECTUL I") — antetul generat se aliniază la ea
  return { regions, counts, parts, left: firstS ? firstS.x : null };
}

// Taie o regiune (bucăți pe una sau mai multe pagini, în ordinea citirii) la
// pozițiile `cuts` ([{ p, y }], tot în ordinea citirii) → cuts.length + 1 segmente.
export function splitRegion(chunks, cuts) {
  const segs = [[]];
  let ci = 0;
  const push = (c) => { if (c.top - c.bottom > 2) segs[segs.length - 1].push(c); };
  for (const c of chunks || []) {
    let top = c.top;
    // o tăietură de pe o pagină anterioară, sau chiar pe marginea de sus a
    // bucății → segmentul următor începe cu bucata aceasta
    while (ci < cuts.length && (cuts[ci].p < c.p || (cuts[ci].p === c.p && cuts[ci].y >= top))) { segs.push([]); ci++; }
    while (ci < cuts.length && cuts[ci].p === c.p && cuts[ci].y > c.bottom) {
      const y = cuts[ci].y;
      push({ p: c.p, top, bottom: y });
      segs.push([]);
      top = y; ci++;
    }
    push({ p: c.p, top, bottom: c.bottom, ...(c.toEnd ? { toEnd: true } : {}) });
  }
  while (segs.length < cuts.length + 1) segs.push([]);
  return segs;
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
      // la BAC (probleme cu subpuncte, rânduri apropiate) harta e de 2× mai fină:
      // albul dintre două rânduri are uneori doar 1–2pt
      const ink = await inkRows(doc, pages, (st.counts[2] || 0) <= 3 ? 2 : 1);
      if (Object.keys(ink).length) {
        try { const fin = structureFrom(pg, from, ink); if (structureOk(fin.counts)) st = fin; } catch { /* rămân regiunile după text */ }
      }
      return {
        bytes, numPages: pg.n, W: pg.W, H: pg.H, regions: st.regions, counts: st.counts, parts: st.parts || {},
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
async function inkRows(doc, pages, SCALE = 1) {
  const out = {};
  if (typeof document === 'undefined') return out;
  const DARK = 236;
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
// sursa `a` poate da poziția `key` cu subpunctele `want`? Fără `want` (sau cu
// toate trei) merge regiunea întreagă; cu doar unele, subpunctele sursei
// trebuie să fi fost găsite și separate (analysis.parts)
function usable(a, key, want) {
  if (!hasRegion(a, key)) return false;
  if (!partialWant(want)) return true;
  const P = a.parts && a.parts[key];
  return !!(P && want.length && want.every((l) => P.letters.includes(l) && P[l] && P[l].length));
}
// subiectele și pozițiile cerute: din selecție (bife) sau toate pozițiile subiectelor
const subjOf = (subjects, selection) => (selection ? selectionSubjects(selection) : normSubjects(subjects));
function positionsOf(list, s, selection) {
  let m = 0;
  for (const a of list || []) for (let it = 1; it <= 6; it++) if (hasRegion(a, `${s}.${it}`)) m = Math.max(m, it);
  const all = range(m);
  return selection ? all.filter((it) => ((selection.items && selection.items[s]) || []).includes(it)) : all;
}
const wantOf = (selection, key) => (selection && selection.parts ? selection.parts[key] : undefined);

// Câte teste DIFERITE se pot face din surse (produsul alegerilor pe poziții).
export function maxDistinctTests(list, subjects, selection = null) {
  let prod = 1;
  for (const s of subjOf(subjects, selection)) {
    for (const it of positionsOf(list, s, selection)) {
      const key = `${s}.${it}`;
      const want = wantOf(selection, key);
      let k = (list || []).filter((a) => usable(a, key, want)).length;
      if (!k) k = (list || []).filter((a) => hasRegion(a, key)).length; // problema întreagă
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
 *   • cu `selection` (bife): doar pozițiile bifate; la o problemă cu doar unele
 *     subpuncte bifate, doar sursele în care subpunctele s-au putut separa — dacă
 *     nu e niciuna, problema întreagă (`whole[key]`, semnalat în raport).
 * Pur (fără pdf.js / pdf-lib) — se testează direct în Node.
 * @param {Array<{regions}>} list sursele pregătite
 * @returns {Array<{ index, base, picks: { 's.it': sursa }, whole: { 's.it': true }, duplicate }>}
 */
export function planCombinations(list, { count = 1, subjects = [1, 2, 3], seed = null, selection = null } = {}) {
  const S = (list || []).length;
  if (!S) return [];
  const subj = subjOf(subjects, selection);
  if (!subj.length) throw new Error('Bifează cel puțin un exercițiu.');
  const n = Math.max(1, Math.min(200, parseInt(count, 10) || 1));
  const rnd = rngFrom(seed ?? ((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0));
  const all = [...Array(S).keys()];
  // pozițiile fiecărui subiect (la EN 6, la BAC 6 / 2 / 2 — sau doar cele bifate)
  const positions = {};
  for (const s of subj) positions[s] = positionsOf(list, s, selection);
  // la fiecare poziție: sursele bune (cu subpunctele cerute), altfel problema întreagă
  const whole = {};
  const okFor = {};
  for (const s of subj) {
    for (const it of positions[s]) {
      const key = `${s}.${it}`;
      const want = wantOf(selection, key);
      let ok = all.filter((i) => usable(list[i], key, want));
      if (!ok.length && partialWant(want)) { ok = all.filter((i) => hasRegion(list[i], key)); if (ok.length) whole[key] = true; }
      okFor[key] = new Set(ok);
    }
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
      for (const it of positions[s]) {
        const key = `${s}.${it}`;
        for (let k = 0; k < S; k++) {
          const cand = P[(off + it - 1 + k) % S];
          if (okFor[key].has(cand)) { picks[key] = cand; break; }
        }
      }
    }
    return picks;
  }
  function randomPicks() {
    const picks = {};
    for (const s of subj) {
      for (const it of positions[s]) {
        const key = `${s}.${it}`;
        const c = [...okFor[key]];
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
    const w = {};
    for (const key of Object.keys(picks)) if (whole[key]) w[key] = true;
    plans.push({ index: t + 1, base: bases[t % bases.length], picks, whole: w, duplicate });
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
 *  • titlurile subiectelor (SUBIECTUL I (30 de puncte) + indicațiile) din bază;
 *  • `selection` (bife): doar exercițiile bifate, iar la problemele de BAC doar
 *    subpunctele bifate (enunțul problemei + a), c) …, cu spațierea originală).
 *    Un subiect din care lipsește ceva primește titlul lui generat, cu punctajul
 *    bifat („SUBIECTUL al II-lea (15 puncte)") + indicațiile din bază; testul
 *    are copertă / antetul probei doar dacă e bifat TOT.
 * @returns {{ bytes, report, sources, pages, text, pageTexts, size, points, wholeFallback }}
 */
export async function composeExamPdf(prepared, plan, { subjects = [1, 2, 3], header = null, srcDocs = null, selection = null } = {}) {
  await ensureLibs();
  const { PDFDocument } = window.PDFLib;
  const list = Array.isArray(prepared) ? prepared : (prepared && prepared.list) || [];
  if (!list.length || !plan) throw new Error('Nu am surse pentru combinare.');
  const subj = subjOf(subjects, selection);
  const docs = srcDocs || await openSourceDocs(list);
  const baseI = list[plan.base] ? plan.base : 0;
  const base = list[baseI];
  const W = base.W, H = base.H, TOP = 46, BOT = H - 46, GAP = 8;
  // marginea textului (rândul „SUBIECTUL …" din sursa de bază) — antetele generate se aliniază la ea
  const hx = Math.max(30, Math.min(110, Math.round(base.left || 30)));
  // problemele cu subpuncte (BAC, Subiectele II și III: câte 2 probleme × 3 subpuncte × 5p)
  const withParts = (s) => s > 1 && (base.counts?.[s] || 0) > 0 && base.counts[s] <= 3;
  // lipsește ceva din subiectul s (o poziție nebifată sau o problemă cu doar unele subpuncte)?
  const partialSubject = (s) => !!selection && (
    positionsOf(list, s, null).some((it) => !((selection.items && selection.items[s]) || []).includes(it))
    || positionsOf(list, s, selection).some((it) => partialWant(wantOf(selection, `${s}.${it}`))));
  const full = subj.length === 3 && !subj.some(partialSubject);

  // 1) ce se așază, în ordine
  const blocks = [];
  const report = [];
  let points = 0;
  const wholeFallback = [];
  if (full && !base.hasCover && hasRegion(base, 'H')) blocks.push({ src: baseI, chunks: base.regions.H });
  for (const s of subj) {
    const items = [];
    let pts = 0;
    for (const it of positionsOf(list, s, selection)) {
      const key = `${s}.${it}`;
      const srcI = plan.picks ? plan.picks[key] : null;
      if (srcI == null || !hasRegion(list[srcI], key)) continue;
      const src = list[srcI];
      const want = wantOf(selection, key);
      const P = src.parts && src.parts[key];
      if (partialWant(want) && P && !(plan.whole && plan.whole[key]) && usable(src, key, want)) {
        // enunțul problemei rămâne lângă primul subpunct; între bucățile aceleiași
        // probleme nu se adaugă spațiu (tăieturile sunt în mijlocul albului dintre rânduri)
        const ls = P.letters.filter((l) => want.includes(l));
        items.push({ src: srcI, chunks: P.stem, keep: true, gap: 0 });
        ls.forEach((l, i) => items.push({ src: srcI, chunks: P[l], gap: i < ls.length - 1 ? 0 : GAP + 6 }));
        report.push(`S${s}.${it} ${ls.map((l) => `${l})`).join(', ')} ← ${src.label}`);
        pts += 5 * ls.length;
      } else {
        items.push({ src: srcI, chunks: src.regions[key] });
        const nota = partialWant(want) ? ' (problema întreagă: subpunctele nu s-au putut separa)' : '';
        if (nota) wholeFallback.push(key);
        report.push(`S${s}.${it} ← ${src.label}${nota}`);
        pts += withParts(s) ? 5 * ((P && P.letters.length) || PART_LETTERS.length) : 5;
      }
    }
    if (!items.length) continue;
    if (partialSubject(s) || !hasRegion(base, `S${s}`)) {
      // titlul generat, cu punctajul bifat; indicațiile („Încercuiește litera…") din
      // bază, cu mărimea literei din bază
      const src = (base.regions[`S${s}`] || []).flatMap((c) => ((base.pageLines && base.pageLines[c.p]) || [])
        .filter((L) => L.y <= c.top && L.y > c.bottom));
      const head = src.find((L) => normTxt(L.text).startsWith('subiectul'));
      const rest = src.filter((L) => L !== head && !normTxt(L.text).startsWith('subiectul'))
        .map((L) => ({ t: L.text.replace(/\(\s*\d+\s*(de\s+)?puncte\s*\)/gi, '').replace(/\s+/g, ' ').trim(), h: L.h }))
        .filter((x) => x.t.length > 2);
      const size = (h) => (h >= 8 && h <= 16 ? h : 12);
      const title = `${s === 1 ? 'SUBIECTUL I' : `SUBIECTUL al ${ROMAN[s]}-lea`} (${pointsLabel(pts)})`;
      blocks.push({
        img: await makeSubjectTitlePng({ title, lines: rest.map((x) => x.t), size: size(head && head.h), lineSize: size(rest[0] && rest[0].h) }, { widthPt: W - hx - 30 }),
        head: true,
      });
    } else {
      blocks.push({ src: baseI, chunks: base.regions[`S${s}`], head: true });
    }
    blocks.push(...items);
    points += pts;
  }
  if (!report.length) throw new Error('Nu am găsit în PDF-urile-sursă exercițiile subiectelor alese.');

  // 2) regiunile fiecărei surse se încorporează ÎMPREUNĂ: un singur pas de
  //    copiere pe sursă, deci fonturile și imaginile ei intră o singură dată
  const out = await PDFDocument.create();
  const bySrc = new Map();
  for (const b of blocks) {
    for (const c of b.chunks || []) {
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
  const hdr = typeof header === 'function' ? await header(W - 2 * hx, { points }) : header;
  if (hdr && hdr.png) {
    const img = await out.embedPng(hdr.png);
    const w = W - 2 * hx;
    const h = (hdr.heightPt || 60) * (w / (hdr.widthPt || w));
    page.drawImage(img, { x: hx, y: H - cursor - h, width: w, height: h });
    cursor += h + GAP;
    if (hdr.text) txt.push(hdr.text);
  }
  const heightOf = (b) => (b.img ? b.img.heightPt : (b.chunks || []).reduce((sum, c) => sum + (c.top - c.bottom), 0));
  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    // titlul subiectului („SUBIECTUL al II-lea" + indicațiile) rămâne lângă primul
    // lui exercițiu, iar enunțul unei probleme lângă primul ei subpunct: dacă nu
    // încap împreună, merg amândouă pe pagina următoare
    if ((b.head || b.keep) && cursor > TOP) {
      const next = blocks[bi + 1];
      const first = next && !next.head && next.chunks && next.chunks[0];
      const need = heightOf(b) + (first ? first.top - first.bottom : 0);
      if (cursor + need > BOT) newPage();
    }
    if (b.img) {
      const img = await out.embedPng(b.img.png);
      if (cursor + b.img.heightPt > BOT && cursor > TOP) newPage();
      page.drawImage(img, { x: hx, y: H - cursor - b.img.heightPt, width: b.img.widthPt, height: b.img.heightPt });
      cursor += b.img.heightPt;
      txt.push(b.img.text);
    }
    for (const c of b.chunks || []) {
      const emb = embedded.get(c);
      if (!emb) continue;
      const h = c.top - c.bottom;
      if (cursor + h > BOT && cursor > TOP) newPage();
      page.drawPage(emb, { x: 30, y: H - cursor - h });
      cursor += h;
      txt.push(chunkText(list[b.src], c));
    }
    cursor += b.gap ?? GAP;
  }
  pageTexts.push(txt.join('\n'));

  const bytes = await out.save();
  const used = [];
  [baseI, ...Object.values(plan.picks || {})].forEach((i) => { const l = list[i] && list[i].label; if (l && !used.includes(l)) used.push(l); });
  return {
    bytes, report, sources: used, pages: out.getPageCount(),
    text: pageTexts.filter(Boolean).join('\n\n'), pageTexts, size: bytes.length,
    points, full, wholeFallback,
  };
}

// Combină UN subiect (generatorul de subiecte, agentul din Admin): coperta +
// antetele dintr-o sursă, fiecare poziție din ALTĂ sursă. `subjects` (opțional)
// păstrează doar subiectele alese; `selection` (opțional) doar exercițiile bifate.
export async function combineExamPdfs(sources, { onProgress, subjects = [1, 2, 3], selection = null } = {}) {
  const prepared = await prepareExamSources(sources, { onProgress });
  onProgress?.('Compun subiectul nou…');
  const [plan] = planCombinations(prepared.list, { count: 1, subjects, selection });
  const r = await composeExamPdf(prepared, plan, { subjects, selection });
  return { bytes: r.bytes, report: r.report, sources: r.sources, text: r.text, pageTexts: r.pageTexts, pages: r.pages };
}

// Titlul unui subiect din care s-au bifat doar unele exerciții: „SUBIECTUL al
// II-lea (15 puncte)" + indicațiile subiectului — punctajul din PDF-ul-sursă
// („(30 de puncte)") nu mai e adevărat. Desenat pe canvas, ca antetul.
export async function makeSubjectTitlePng({ title = '', lines = [], size = 12, lineSize = 12 } = {}, { widthPt = 500, scale = 3 } = {}) {
  const LH = Math.max(size, lineSize) * 1.2;
  const heightPt = Math.round(size * 1.2 + LH * lines.length + 8);
  const c = document.createElement('canvas');
  c.width = Math.round(widthPt * scale);
  c.height = Math.round(heightPt * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  const SERIF = '"Times New Roman", Times, "Liberation Serif", "DejaVu Serif", serif';
  g.fillStyle = '#000';
  g.textBaseline = 'alphabetic';
  g.font = `bold ${size}px ${SERIF}`;
  g.fillText(title, 0, size * 1.05, widthPt);
  g.font = `${lineSize}px ${SERIF}`;
  lines.forEach((t, i) => g.fillText(t, 0, size * 1.05 + LH * (i + 1), widthPt));
  const png = await canvasPng(c);
  return { png, widthPt, heightPt, text: [title, ...lines].join('\n') };
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

// pentru testele din Node (test/teste-pdf-bife.test.js): analiza pe rânduri de text sintetice
export const _pentruTeste = { structureFrom };
