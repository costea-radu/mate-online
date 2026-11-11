// =====================================================================
// src/lib/pdfRezolvare.js — „✏️ Rezolvă pe PDF" (7 nov. 2026)
//
// Cererea lui Radu: „pentru PDF-urile de la Evaluare Națională, poți să faci
// cumva să se poată rezolva grila de la subiectele I și II direct pe PDF, prin
// încercuire? iar la subiectul III să se poată scrie direct pe zona de
// rezolvare. cumva să pui ca un spațiu de lucru, dar invizibil, cu corectare și
// cu recunoaștere pe PDF a exercițiului rezolvat. PDF-ul să rămână tot PDF cu
// aceleași funcționalități. corectarea să fie pornită cu un buton «rezolvă pe
// PDF» cu buton la final «corectează»."
//
// Cum: peste fiecare pagină a PDF-ului stă un strat TRANSPARENT de scris
// (src/components/PdfInkLayer.jsx). Elevul încercuiește litera la grile și scrie
// rezolvarea la Subiectul al III-lea, chiar pe pagină. Din TEXTUL PDF-ului
// (pdf.js) se face HARTA testului — aceleași regiuni ale exercițiilor ca la
// „📎 Combină exact" (src/lib/pdfCombine.js → examStructureOf) plus, la grile,
// pozițiile literelor a) b) c) d). Cu ea:
//   · fiecare traseu ajunge la exercițiul în a cărui zonă a fost scris;
//   · la grile, cercul tras în jurul unei litere (sau al variantei) se
//     RECUNOAȘTE pe loc, fără AI — eticheta „b)" apare pe margine;
//   · la „✅ Corectează", grilele se punctează DETERMINIST pe server, cu litera din
//     tabelul baremului (api/_lib/barem.js → grilaAnswers), iar zonele scrise de
//     mână (Subiectul al III-lea) pleacă, ca imagini ale paginii cu scrisul pe
//     ea, la corectorul de scris de mână (Premium) — api/rezolva-pdf.js.
// Fără hartă (PDF scanat, structură nerecunoscută, test combinat din bibliotecă)
// totul merge la corector, ca imagini ale paginilor scrise (Premium).
//
// Coordonatele: puncte PDF, cu originea în colțul din STÂNGA-SUS al paginii
// (y crește în jos) — ca viewBox-ul SVG-ului de deasupra paginii; nu depind de
// zoom. Textul pdf.js vine cu originea JOS-stânga: se convertește aici.
//
// Partea pură (harta, recunoașterea, ciorna, planul imaginilor) e testată în
// test/rezolva-pe-pdf.test.js; funcțiile cu DOM (citirea textului, imaginile,
// PDF-ul descărcat) rulează doar în browser.
// =====================================================================
import { pageLinesFromItems, contentBoundsOf, examStructureOf, loadPdfLib } from './pdfCombine.js';

export const PEN_PT = 1.7;                                  // grosimea scrisului, în puncte de pagină
export const INK_COLORS = ['#1d4ed8', '#111827', '#c62828']; // pix albastru, negru, roșu
export const ROMAN = { 1: 'I', 2: 'II', 3: 'III' };
export const SUBJ = { 1: 'Subiectul I', 2: 'Subiectul al II-lea', 3: 'Subiectul al III-lea' };
export const itemShort = (key) => { const [s, ex] = String(key).split('.'); return `${ROMAN[s] || s}.${ex}`; };
export const itemLong = (key) => { const [s, ex] = String(key).split('.'); return `${SUBJ[s] || `Subiectul ${s}`}, ${s === '3' ? 'problema' : 'exercițiul'} ${ex}`; };
const LETTERS = ['a', 'b', 'c', 'd'];
export const storageKeyOf = (k) => `pdfink:${k}`;

// ═════════════════════════════ geometrie ══════════════════════════════
export function boxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts || []) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}
export function unionBox(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  return { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) };
}
const isLeft = (x1, y1, x2, y2, x, y) => (x2 - x1) * (y - y1) - (x - x1) * (y2 - y1);
// numărul de înfășurare al poligonului (traseul, închis implicit) în jurul punctului:
// ≠ 0 = punctul e înăuntru (merge și la un cerc care trece de punctul de pornire)
export function windingNumber(pts, x, y) {
  let wn = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % n];
    if (y1 <= y) { if (y2 > y && isLeft(x1, y1, x2, y2, x, y) > 0) wn++; }
    else if (y2 <= y && isLeft(x1, y1, x2, y2, x, y) < 0) wn--;
  }
  return wn;
}
function segCross(a, b, c, d) {
  const d1 = isLeft(c[0], c[1], d[0], d[1], a[0], a[1]), d2 = isLeft(c[0], c[1], d[0], d[1], b[0], b[1]);
  const d3 = isLeft(a[0], a[1], b[0], b[1], c[0], c[1]), d4 = isLeft(a[0], a[1], b[0], b[1], d[0], d[1]);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function decimate(pts, max = 120) {
  if (pts.length <= max) return pts;
  const step = pts.length / max, out = [];
  for (let i = 0; i < max; i++) out.push(pts[Math.floor(i * step)]);
  out.push(pts[pts.length - 1]);
  return out;
}
// traseul se taie pe sine (un cerc care trece de punctul de pornire, o buclă)?
export function selfIntersects(pts) {
  const q = decimate(pts);
  for (let i = 0; i < q.length - 1; i++) {
    for (let j = i + 2; j < q.length - 1; j++) {
      if (i === 0 && j === q.length - 2) continue;
      if (segCross(q[i], q[i + 1], q[j], q[j + 1])) return true;
    }
  }
  return false;
}
// cât se rotește DIRECȚIA traseului, cu semn (radiani): un cerc întreg ≈ 2π, un cerc
// lăsat deschis ≈ 1,6π, un C ≈ π, un S sau o linie ≈ 0. Pe segmente de cel puțin
// 1,5pt (tremurul mâinii nu contează).
export function tangentTurning(pts) {
  const q = [pts[0]];
  for (const p of pts) { const L = q[q.length - 1]; if (Math.hypot(p[0] - L[0], p[1] - L[1]) >= 1.5) q.push(p); }
  let tot = 0, prev = null;
  for (let i = 1; i < q.length; i++) {
    const a = Math.atan2(q[i][1] - q[i - 1][1], q[i][0] - q[i - 1][0]);
    if (prev != null) {
      let d = a - prev;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      tot += d;
    }
    prev = a;
  }
  return Math.abs(tot);
}
// un traseu „închis" (cerc, oval, buclă — și cercul lăsat puțin deschis, cum se
// încercuiește în grabă) — nu o linie, un C sau o bifă
export function isClosedish(pts, b = boxOf(pts)) {
  if (!pts || pts.length < 6 || !b) return false;
  const diag = Math.hypot(b.x1 - b.x0, b.y1 - b.y0);
  if (diag < 5) return false;
  const [fx, fy] = pts[0], [lx, ly] = pts[pts.length - 1];
  if (Math.hypot(fx - lx, fy - ly) <= Math.max(6, diag * 0.45)) return true;
  if (tangentTurning(pts) >= Math.PI * 1.45) return true;
  return selfIntersects(pts);
}

// ═════════════════════════════ harta testului ══════════════════════════════
// Rândurile unei pagini cu POZIȚIA FIECĂRUI CARACTER (literele variantelor stau
// adesea în același item pdf.js cu valoarea — „a) 20" — sau chiar cu enunțul).
// items: [{ str, x, y, w, h }] (originea jos-stânga)
export function richLines(items) {
  const rows = [];
  for (const it of items || []) {
    if (typeof it.str !== 'string' || !it.str.length) continue;
    const y = it.y;
    let row = rows.find((r) => Math.abs(r.y - y) <= 2);
    if (!row) { row = { y, items: [] }; rows.push(row); }
    row.items.push(it);
  }
  return rows.map((r) => {
    const its = r.items.slice().sort((a, b) => a.x - b.x);
    const chars = [];
    let h = 0;
    for (const it of its) {
      const len = it.str.length;
      const cw = len ? (it.w || 0) / len : 0;
      if (it.h > h) h = it.h;
      const prev = chars[chars.length - 1];
      if (prev && prev.c !== ' ' && it.x - (prev.x + prev.w) > Math.max(1.2, cw * 0.25) && it.str[0] !== ' ') {
        chars.push({ c: ' ', x: prev.x + prev.w, w: it.x - (prev.x + prev.w) });
      }
      for (let i = 0; i < len; i++) chars.push({ c: it.str[i], x: it.x + i * cw, w: cw });
    }
    return { y: r.y, h: h || 10, chars, text: chars.map((c) => c.c).join('') };
  }).sort((a, b) => b.y - a.y);
}

const OPT_RE = /(^|[\s ])([a-d])\s?\)/g;
const ITEM_START = (ex) => new RegExp(`^(?:\\(?\\d+\\s*p\\)?\\.?\\s*)?${ex}\\s*\\.`);
const PART_RE = /^(?:\(?\s*\d+\s*p\s*\)?\.?\s*)?([a-c])\s*\)/;

// Variantele a) – d) ale unei grile, în ordinea citirii (de sus în jos, de la stânga
// la dreapta), din rândurile zonei ei. Doar un șir care începe cu „a)" și continuă
// în ordine (a, b[, c[, d]]) — un „a)" rătăcit în enunț nu strică lista.
function optionsIn(rows, toTop, toLeft, p) {
  const found = [];
  let expect = 0;
  for (const L of rows) {
    OPT_RE.lastIndex = 0;
    const ms = [...L.text.matchAll(OPT_RE)];
    for (let k = 0; k < ms.length; k++) {
      const m = ms[k];
      const li = LETTERS.indexOf(m[2]);
      if (li !== expect) {
        if (li === 0 && found.length < 2) { found.length = 0; expect = 0; } else continue;
      }
      const iL = m.index + m[1].length;
      const iR = m.index + m[0].length - 1;
      const cl = L.chars[iL], cr = L.chars[iR];
      if (!cl || !cr) continue;
      // valoarea: de după „)" până la următoarea literă de pe rând (sau capătul rândului)
      const next = ms[k + 1];
      const end = next ? next.index + next[1].length - 1 : L.chars.length - 1;
      let a = iR + 1, b = end;
      while (a <= b && /\s/.test(L.chars[a].c)) a++;
      while (b >= a && /\s/.test(L.chars[b].c)) b--;
      const lx0 = cl.x, lx1 = cr.x + (cr.w || 3);
      const vx0 = a <= b ? L.chars[a].x : lx1 + 2;
      const vx1 = a <= b ? L.chars[b].x + (L.chars[b].w || 3) : lx1 + 14;
      const asc = L.h * 0.78, desc = L.h * 0.26;
      const y0 = toTop(L.y + asc), y1 = toTop(L.y - desc);
      found.push({
        l: m[2], p,
        lx0: toLeft(lx0), lx1: toLeft(lx1), vx0: toLeft(vx0), vx1: toLeft(Math.max(vx1, vx0 + 4)),
        y0, y1, h: L.h,
      });
      expect = li + 1;
      if (expect >= LETTERS.length) break;
    }
    if (expect >= LETTERS.length) break;
  }
  return found.length >= 2 ? found : [];
}

// Text SUPRAPUS: itemi diferiți (de cel puțin 3 litere) care stau unul peste altul.
// Într-un PDF obișnuit nu există; într-un test COMBINAT din regiuni decupate (pdfCombine)
// textul ascuns al paginilor-sursă cade peste exercițiile vizibile — harta ar ieși
// greșită, deci la un asemenea PDF corectarea trece pe corector (imagini).
export function overlappingText(items) {
  const big = (items || [])
    .filter((it) => !it.rot && it.w > 0 && it.h > 0 && String(it.str || '').replace(/\s/g, '').length >= 3)
    .map((it) => ({ s: it.str.trim(), x0: it.x, x1: it.x + it.w, y0: it.y - it.h * 0.2, y1: it.y + it.h * 0.8 }))
    .sort((a, b) => a.y0 - b.y0);
  let n = 0;
  for (let i = 0; i < big.length; i++) {
    const a = big[i];
    for (let j = i + 1; j < big.length && big[j].y0 < a.y1; j++) {
      const b = big[j];
      if (a.s === b.s) continue;
      const ix = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const iy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (ix <= 0 || iy <= 0) continue;
      const amin = Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
      if (ix * iy > 0.4 * amin) n++;
    }
  }
  return n;
}

// pages: [{ n, view: [x0, y0, x1, y1], rotate, items: [{ str, x, y, w, h }] }]
// → { ok, reason?, counts, pages: { n: { W, H } }, items: { '1.3': { key, s, ex, tip, chunks, anchor, options, parts } }, order }
export function buildExamMap(pages) {
  const list = (pages || []).filter((p) => p && Array.isArray(p.view)).sort((a, b) => a.n - b.n);
  if (!list.length) return { ok: false, reason: 'gol', pages: {} };
  const geo = {};
  for (const pg of list) geo[pg.n] = { W: pg.view[2] - pg.view[0], H: pg.view[3] - pg.view[1], x0: pg.view[0], top: pg.view[3] };
  if (list.some((p) => ((p.rotate || 0) % 360) !== 0)) return { ok: false, reason: 'rotit', pages: geo };
  // textul primei pagini: nota scrisă cu roșu se așază lângă el, nu peste el
  const cutii1 = cutiiText(list.find((p) => p.n === 1));
  const r0 = buildExamMapDin(list, geo);
  return { ...r0, cutii1 };
}

function buildExamMapDin(list, geo) {
  if (list.some((p, i) => p.n !== i + 1)) return { ok: false, reason: 'pagini', pages: geo };
  const n = list.length;
  const W = list[0].view[2], H = list[0].view[3];   // ca readPages (pdfCombine)
  const pageLines = {}, contentMaxY = {}, contentMinY = {}, rich = {};
  for (const pg of list) {
    const lines = pageLinesFromItems((pg.items || []).map((it) => ({ str: it.str, x: it.x, y: it.y, h: it.h })));
    pageLines[pg.n] = lines;
    const b = contentBoundsOf(lines, H);
    contentMaxY[pg.n] = b.maxY; contentMinY[pg.n] = b.minY;
    rich[pg.n] = richLines(pg.items);
  }
  const chars = list.reduce((s, pg) => s + (pg.items || []).reduce((t, it) => t + String(it.str || '').trim().length, 0), 0);
  if (chars < 200) return { ok: false, reason: 'fara-text', pages: geo };
  if (list.some((pg) => overlappingText(pg.items) >= 3)) return { ok: false, reason: 'text-suprapus', pages: geo };
  const st = examStructureOf({ n, W, H, contentMaxY, contentMinY, pageLines });
  if (!st) return { ok: false, reason: 'structura', pages: geo };

  const toTopP = (p) => (y) => geo[p].top - y;
  const toLeftP = (p) => (x) => x - geo[p].x0;
  const items = {};
  const order = Object.keys(st.regions).filter((k) => /^[123]\.\d+$/.test(k))
    .sort((a, b) => { const [s1, e1] = a.split('.').map(Number), [s2, e2] = b.split('.').map(Number); return (s1 - s2) || (e1 - e2); });
  for (const key of order) {
    const [s, ex] = key.split('.').map(Number);
    const src = st.regions[key] || [];
    if (!src.length) continue;
    const chunks = src.map((c) => ({ p: c.p, y0: toTopP(c.p)(c.top), y1: toTopP(c.p)(c.bottom) }));
    // rândurile din zona itemului, în ordinea citirii
    const rowsOf = (c) => rich[c.p].filter((L) => L.y <= c.top && L.y > c.bottom);
    // ancora: rândul cu numărul exercițiului („5p 3." / „3.")
    const c0 = src[0];
    const lines0 = (pageLines[c0.p] || []).filter((L) => L.y <= c0.top && L.y > c0.bottom);
    const L0 = lines0.find((L) => L.x < 140 && ITEM_START(ex).test(L.text)) || lines0[0] || null;
    const anchor = L0
      ? { p: c0.p, x: toLeftP(c0.p)(L0.x), y: toTopP(c0.p)(L0.y), h: L0.h || 11 }
      : { p: c0.p, x: 56, y: chunks[0].y0 + 14, h: 11 };
    let options = [];
    if (s === 1 || s === 2) {
      // variantele: întâi pe prima bucată, apoi (enunț lung) pe pagina următoare
      for (const c of src) {
        const got = optionsIn(rowsOf(c), toTopP(c.p), toLeftP(c.p), c.p);
        if (got.length) { options = got; break; }
      }
    }
    const parts = [];
    if (s === 3) {
      for (const c of src) {
        for (const L of (pageLines[c.p] || []).filter((x) => x.y <= c.top && x.y > c.bottom && x.x < 150)) {
          const m = L.text.match(PART_RE);
          if (m && m[1] === LETTERS[parts.length]) parts.push({ l: m[1], p: c.p, x: toLeftP(c.p)(L.x), y: toTopP(c.p)(L.y), h: L.h || 11 });
        }
      }
    }
    items[key] = { key, s, ex, tip: options.length >= 2 ? 'grila' : 'scris', chunks, anchor, options, parts };
  }
  const keys = order.filter((k) => items[k]);
  return {
    ok: keys.length > 0, counts: st.counts, hasCover: !!st.hasCover, pages: geo, items, order: keys,
    grile: keys.filter((k) => items[k].tip === 'grila').length,
    signature: `${st.counts[1] || 0}-${st.counts[2] || 0}-${st.counts[3] || 0}`,
  };
}

// Itemul în a cărui zonă cade punctul (x, y) al paginii p; null = în afara exercițiilor
// (coperta, antetul, subsolul). Puțin în afara zonei (≤ 24pt) → cel mai apropiat.
export function itemAt(map, p, y) {
  if (!map || !map.ok) return null;
  let best = null, bestD = Infinity;
  for (const key of map.order) {
    for (const c of map.items[key].chunks) {
      if (c.p !== p) continue;
      if (y >= c.y0 && y <= c.y1) return key;
      const d = y < c.y0 ? c.y0 - y : y - c.y1;
      if (d < bestD) { bestD = d; best = key; }
    }
  }
  return bestD <= 24 ? best : null;
}

// ═════════════════════════════ recunoașterea ══════════════════════════════
// O linie aproape dreaptă (tăietura peste o variantă): deschisă, direcția se
// rotește puțin (o bifă ✓ sau un C se rotesc mult), cel puțin cât ~o literă.
export function isStrike(pts, b = boxOf(pts), lh = 11) {
  if (!pts || pts.length < 2 || !b) return false;
  if (Math.max(b.x1 - b.x0, b.y1 - b.y0) < lh * 0.8) return false;
  if (isClosedish(pts, b)) return false;
  return tangentTurning(pts) < Math.PI * 0.5;
}
// punctele traseului, dese (cel mult ~1pt între ele): o linie trasă repede are puncte rare
function dense(pts, step = 1) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const n = Math.min(60, Math.floor(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 1; k <= n; k++) out.push([ax + ((bx - ax) * k) / (n + 1), ay + ((by - ay) * k) / (n + 1)]);
    out.push(pts[i]);
  }
  return out;
}

// Varianta aleasă la o grilă, după regulile foii de examen (EN):
//  · încercuiești litera (sau varianta): un traseu ÎNCHIS care cuprinde litera —
//    sau valoarea — unei SINGURE variante;
//  · vrei să schimbi: TAI varianta încercuită (o linie peste ea) și încercuiești alta;
//  · vrei să revii la o variantă tăiată: tai și varianta nouă, scrii LÂNGĂ varianta
//    tăiată litera ei și o încercuiești (un cerc „liber", cu scris înăuntru, lângă ea).
// O variantă doar tăiată (eliminată), fără cerc, nu e aleasă. Bifa (✓) nu e încercuire.
// → { letters, how: 'cerc' | 'revenire' | null, unclear, taiate }
export function recognizeChoice(item, strokes) {
  const opts = (item && item.options) || [];
  const circles = [];        // { s, b, opt }   opt = varianta din cerc (null = cerc „liber")
  const lines = [];          // { s, b }        tăieturi posibile
  let unclear = 0;
  for (const s of strokes || []) {
    const pts = s.pts || [];
    if (!pts.length) continue;
    const mine = opts.filter((o) => o.p === s.p);
    if (!mine.length) continue;
    const b = boxOf(pts);
    const lh = mine[0].h || 11;
    if (isClosedish(pts, b)) {
      const hits = [];
      for (const o of mine) {
        const ly = (o.y0 + o.y1) / 2;
        const L = windingNumber(pts, (o.lx0 + o.lx1) / 2, ly) !== 0;
        const V = windingNumber(pts, (o.vx0 + o.vx1) / 2, ly) !== 0;
        if (L || V) hits.push({ o, L });
      }
      if (hits.length === 1) { circles.push({ s, b, opt: hits[0].o }); continue; }
      if (hits.length > 1) {
        // un cerc mare peste mai multe variante: contează doar dacă o SINGURĂ literă e înăuntru
        const withL = hits.filter((h) => h.L);
        if (withL.length === 1 && (b.y1 - b.y0) <= lh * 2.6) circles.push({ s, b, opt: withL[0].o }); else unclear++;
        continue;
      }
      circles.push({ s, b, opt: null });
      continue;
    }
    if (isStrike(pts, b, lh)) lines.push({ s, b });
  }
  // în interiorul unui cerc „liber"? (literele scrise de mână dintr-o revenire)
  const insideFree = (b, p) => circles.some((c) => !c.opt && c.s.p === p
    && windingNumber(c.s.pts, (b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2) !== 0
    && (b.x1 - b.x0) <= (c.b.x1 - c.b.x0) && (b.y1 - b.y0) <= (c.b.y1 - c.b.y0));

  // zona unei variante: litera, valoarea și cercurile din jurul ei
  const areaOf = (o) => {
    let a = { x0: Math.min(o.lx0, o.vx0), y0: o.y0, x1: Math.max(o.lx1, o.vx1), y1: o.y1 };
    for (const c of circles) if (c.opt === o) a = unionBox(a, c.b);
    return a;
  };
  // TĂIETURILE: linia trece PESTE variantă (îi traversează o bună parte), nu doar o atinge
  const taiate = new Set();
  for (const ln of lines) {
    if (insideFree(ln.b, ln.s.p)) continue;
    const mine = opts.filter((o) => o.p === ln.s.p);
    const lh = mine[0].h || 11;
    const pts = dense(ln.s.pts);
    const counts = mine.map((o) => {
      const a = areaOf(o), m = lh * 0.25;
      const ins = pts.filter(([x, y]) => x >= a.x0 - m && x <= a.x1 + m && y >= a.y0 - m && y <= a.y1 + m);
      if (!ins.length) return { o, n: 0 };
      const bx = boxOf(ins);
      const crosses = (bx.x1 - bx.x0) >= 0.45 * Math.min(a.x1 - a.x0, (o.lx1 - o.lx0) * 2 + 4) || (bx.y1 - bx.y0) >= 0.6 * (a.y1 - a.y0);
      return { o, n: crosses ? ins.length : 0 };
    });
    const max = Math.max(0, ...counts.map((c) => c.n));
    if (max < 2) continue;
    counts.filter((c) => c.n >= Math.max(2, max * 0.5)).forEach((c) => taiate.add(c.o.l));
  }
  // REVENIREA: un cerc „liber", mic, cu scris înăuntru, lângă o variantă tăiată
  const inapoi = new Set();
  for (const c of circles.filter((x) => !x.opt)) {
    const mine = opts.filter((o) => o.p === c.s.p);
    const lh = mine[0].h || 11;
    if ((c.b.x1 - c.b.x0) > lh * 4 || (c.b.y1 - c.b.y0) > lh * 3.2) continue;
    const scris = (strokes || []).some((t) => t !== c.s && t.p === c.s.p && t.pts && t.pts.length
      && (() => { const tb = boxOf(t.pts); return windingNumber(c.s.pts, (tb.x0 + tb.x1) / 2, (tb.y0 + tb.y1) / 2) !== 0 && (tb.x1 - tb.x0) < (c.b.x1 - c.b.x0) && (tb.y1 - tb.y0) < (c.b.y1 - c.b.y0); })());
    if (!scris) continue;
    const cy = (c.b.y0 + c.b.y1) / 2;
    let best = null, bestD = Infinity;
    for (const o of mine) {
      if (!taiate.has(o.l)) continue;
      const a = areaOf(o);
      if (cy < a.y0 - lh * 0.9 || cy > a.y1 + lh * 0.9) continue;
      const dx = c.b.x1 < a.x0 ? a.x0 - c.b.x1 : (c.b.x0 > a.x1 ? c.b.x0 - a.x1 : 0);
      if (dx <= lh * 5 && dx < bestD) { bestD = dx; best = o; }
    }
    if (best) inapoi.add(best.l);
  }
  const incercuite = [...new Set(circles.filter((c) => c.opt).map((c) => c.opt.l))];
  const active = incercuite.filter((l) => !taiate.has(l));
  const letters = [...new Set([...active, ...inapoi])].sort();
  return {
    letters,
    how: active.length ? 'cerc' : (inapoi.size ? 'revenire' : null),
    unclear,
    taiate: [...taiate].sort(),
  };
}

// Toate traseele → itemii lor + ce s-a recunoscut la fiecare.
// ink: { [p]: [{ id, pts: [[x, y], …], c, w }] }
// → { items: { key: { key, tip, ids, n, pages, boxes: { p: box }, letters?, how?, unclear? } }, unassigned }
export function recognize(map, ink) {
  const items = {};
  let unassigned = 0;
  for (const [pk, list] of Object.entries(ink || {})) {
    const p = Number(pk);
    for (const s of list || []) {
      if (!s || !s.pts || !s.pts.length) continue;
      const b = s.box || boxOf(s.pts);
      const key = itemAt(map, p, (b.y0 + b.y1) / 2);
      if (!key) { unassigned++; continue; }
      const it = items[key] || (items[key] = { key, tip: map.items[key].tip, ids: [], strokes: [], boxes: {} });
      it.ids.push(s.id);
      it.strokes.push({ p, pts: s.pts });
      it.boxes[p] = unionBox(it.boxes[p], b);
    }
  }
  for (const it of Object.values(items)) {
    it.n = it.ids.length;
    it.sig = it.ids.slice().sort((a, b) => a - b).join(',');
    if (it.tip === 'grila') Object.assign(it, recognizeChoice(map.items[it.key], it.strokes));
    delete it.strokes;
  }
  return { items, unassigned };
}

// Ce se trimite la corectare.
// → { grile: [{ key, litere, cum }], nerecunoscute: [{ key, motiv }], scris: [key] }
//   grile          — variantele recunoscute (punctate pe server după barem, fără AI);
//   nerecunoscute  — grile cu scris (calcule), dar fără nicio variantă încercuită clar
//                    ('nimic') sau cu un cerc peste mai multe variante ('neclar'):
//                    nu se trimit la AI — elevul e rugat să încercuiască litera;
//   scris          — itemii scriși de mână (Subiectul al III-lea și orice item fără
//                    variante recunoscute în text): imagini → corector (Premium).
export function correctionPlan(map, rec) {
  const grile = [], nerecunoscute = [], scris = [];
  for (const key of (map && map.order) || []) {
    const it = rec && rec.items[key];
    if (!it || !it.n) continue;
    if (it.tip === 'grila') {
      if (it.letters && it.letters.length) grile.push({ key, litere: it.letters, cum: it.how });
      else nerecunoscute.push({ key, motiv: it.unclear ? 'neclar' : 'nimic' });
    } else scris.push(key);
  }
  return { grile, nerecunoscute, scris };
}

// Pe scurt, pentru bara modului: „I: 1, 3 · II: 2 · III: 1"
export function recognitionSummary(map, rec) {
  if (!map || !map.ok || !rec) return '';
  const by = { 1: [], 2: [], 3: [] };
  for (const key of map.order) {
    const it = rec.items[key];
    if (!it || !it.n) continue;
    const [s, ex] = key.split('.');
    const tag = it.tip === 'grila' ? (it.letters && it.letters.length === 1 ? `${ex}${it.letters[0]})` : (it.letters && it.letters.length > 1 ? `${ex}⚠` : `${ex}?`)) : ex;
    (by[s] || (by[s] = [])).push(tag);
  }
  return [1, 2, 3].filter((s) => by[s].length).map((s) => `${ROMAN[s]}: ${by[s].join(', ')}`).join(' · ');
}

// ═════════════════════════ imaginile pentru corector ═════════════════════════
// Câte o imagine pe pagină: toată lățimea paginii, pe înălțimea zonelor cerute
// (enunțul tipărit + scrisul elevului), plus scrisul lor care iese puțin din zonă.
// keys = null → paginile scrise, întregi (fără hartă: corectorul găsește singur itemii).
export function cropPlan(map, rec, ink, keys) {
  const out = [];
  const pages = (map && map.pages) || {};
  if (!keys) {
    for (const [pk, list] of Object.entries(ink || {})) {
      if (!list || !list.length) continue;
      const p = Number(pk), g = pages[p];
      if (!g) continue;
      out.push({ p, x0: 0, y0: 0, x1: g.W, y1: g.H, keys: null });
    }
    return out.sort((a, b) => a.p - b.p);
  }
  const byPage = new Map();
  for (const key of keys) {
    const it = map.items[key];
    if (!it) continue;
    const r = rec && rec.items[key];
    for (const c of it.chunks) {
      let box = { x0: 0, y0: c.y0, x1: pages[c.p].W, y1: c.y1 };
      if (r && r.boxes[c.p]) box = unionBox(box, { ...r.boxes[c.p], x0: 0, x1: pages[c.p].W });
      const cur = byPage.get(c.p) || { p: c.p, box: null, keys: [] };
      cur.box = unionBox(cur.box, box);
      if (!cur.keys.includes(key)) cur.keys.push(key);
      byPage.set(c.p, cur);
    }
  }
  for (const v of byPage.values()) {
    const g = pages[v.p];
    const y0 = Math.max(0, v.box.y0 - 6), y1 = Math.min(g.H, v.box.y1 + 6);
    if (y1 - y0 < 20) continue;
    out.push({ p: v.p, x0: 0, y0, x1: g.W, y1, keys: v.keys });
  }
  return out.sort((a, b) => a.p - b.p);
}

// Eticheta fiecărei imagini (pentru model): ce itemi sunt pe ea și care continuă
export function cropLabels(crops) {
  return crops.map((c, i) => {
    const head = `Imaginea ${i + 1} din ${crops.length} — pagina ${c.p} a testului`;
    if (!c.keys) return `${head} (pagina întreagă, cu scrisul elevului).`;
    const desc = c.keys.map((k) => {
      const cont = crops.slice(i + 1).some((d) => d.keys && d.keys.includes(k));
      const prev = crops.slice(0, i).some((d) => d.keys && d.keys.includes(k));
      return `${itemShort(k)}${prev ? ' (continuare)' : ''}${cont ? ' (continuă pe imaginea următoare)' : ''}`;
    });
    return `${head}; pe ea: ${desc.join(', ')}.`;
  });
}

// ═════════════════════════ ciorna (localStorage) ═════════════════════════
// Trasee compacte: [id, culoare, grosime×10, x0×10, y0×10, dx1, dy1, …] (zecimi de punct)
export function encodeInk(ink) {
  const out = {};
  for (const [p, list] of Object.entries(ink || {})) {
    const arr = [];
    for (const s of list || []) {
      if (!s || !s.pts || !s.pts.length) continue;
      const ci = Math.max(0, INK_COLORS.indexOf(s.c));
      const row = [s.id | 0, ci, Math.round((s.w || PEN_PT) * 10)];
      let px = 0, py = 0;
      s.pts.forEach(([x, y], i) => {
        const X = Math.round(x * 10), Y = Math.round(y * 10);
        if (i === 0) { row.push(X, Y); } else { row.push(X - px, Y - py); }
        px = X; py = Y;
      });
      arr.push(row);
    }
    if (arr.length) out[p] = arr;
  }
  return out;
}
export function decodeInk(enc) {
  const ink = {};
  let maxId = 0;
  for (const [p, arr] of Object.entries(enc || {})) {
    const list = [];
    for (const row of Array.isArray(arr) ? arr : []) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const [id, ci, w10] = row;
      const pts = [];
      let x = 0, y = 0;
      for (let i = 3; i + 1 < row.length; i += 2) {
        if (i === 3) { x = row[i]; y = row[i + 1]; } else { x += row[i]; y += row[i + 1]; }
        pts.push([x / 10, y / 10]);
      }
      if (!pts.length) continue;
      list.push({ id: id | 0, c: INK_COLORS[ci] || INK_COLORS[0], w: (w10 || 17) / 10, pts });
      if (id > maxId) maxId = id;
    }
    if (list.length) ink[p] = list;
  }
  return { ink, maxId };
}
export function readDraft(key) {
  try {
    const raw = localStorage.getItem(storageKeyOf(key));
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || d.v !== 1) return null;
    const { ink, maxId } = decodeInk(d.ink);
    return { ink, maxId, result: d.result || null, startedAt: d.startedAt || null };
  } catch { return null; }
}
export function saveDraft(key, { ink, result = null, startedAt = null }) {
  try {
    const enc = encodeInk(ink);
    if (!Object.keys(enc).length && !result) { localStorage.removeItem(storageKeyOf(key)); return true; }
    localStorage.setItem(storageKeyOf(key), JSON.stringify({ v: 1, ink: enc, result, startedAt, at: Date.now() }));
    return true;
  } catch { return false; }   // nu mai încape: scrisul rămâne pe ecran, doar nu se mai salvează
}

// Radiera atinge traseul? (distanța până la fiecare segment)
export function nearStroke(pts, x, y, r) {
  const r2 = r * r;
  if (pts.length === 1) return (pts[0][0] - x) ** 2 + (pts[0][1] - y) ** 2 <= r2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const qx = ax + t * dx - x, qy = ay + t * dy - y;
    if (qx * qx + qy * qy <= r2) return true;
  }
  return false;
}

// Traseu neted (curbe), ca pe „✍️ Foaia de lucru"
const r2 = (n) => Math.round(n * 100) / 100;
export function inkPath(pts) {
  if (!pts || !pts.length) return '';
  if (pts.length === 1) return `M${r2(pts[0][0])} ${r2(pts[0][1])}l0.01 0`;
  let d = `M${r2(pts[0][0])} ${r2(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${r2(pts[i][0])} ${r2(pts[i][1])} ${r2(mx)} ${r2(my)}`;
  }
  const L = pts[pts.length - 1];
  return d + `L${r2(L[0])} ${r2(L[1])}`;
}

// ═════════════════════════ în browser (pdf.js, canvas, pdf-lib) ═════════════════════════
// Textul care chiar SE VEDE pe pagină. Testele combinate (pdfCombine: regiuni
// decupate din alte PDF-uri) păstrează în fișier TOT textul paginilor-sursă — doar
// desenul e tăiat —, iar pdf.js îl dă pe tot, și pe cel ascuns, peste alte exerciții.
// Un item de text fără niciun pixel închis la culoare sub el (pagina randată mic) e
// ascuns: nu intră în hartă. mask = { w, h, px } (ImageData la scara 1).
export function visibleIn(mask, view, it) {
  if (!mask || !it.w || !it.h) return true;
  const x0 = Math.max(0, Math.floor(it.x - view[0])), x1 = Math.min(mask.w - 1, Math.ceil(it.x - view[0] + it.w));
  const base = view[3] - it.y;
  const y0 = Math.max(0, Math.floor(base - it.h * 0.85)), y1 = Math.min(mask.h - 1, Math.ceil(base + it.h * 0.2));
  if (x1 < x0 || y1 < y0) return false;   // în afara paginii
  const px = mask.px;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * mask.w + x) * 4;
      if (px[i] < 200 || px[i + 1] < 200 || px[i + 2] < 200) return true;
    }
  }
  return false;
}
async function inkMaskOf(page) {
  if (typeof document === 'undefined') return null;
  try {
    const vp = page.getViewport({ scale: 1 });
    const w = Math.ceil(vp.width), h = Math.ceil(vp.height);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d', { willReadFrequently: true });
    g.fillStyle = '#fff'; g.fillRect(0, 0, w, h);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    const px = g.getImageData(0, 0, w, h).data;
    cv.width = 0; cv.height = 0;
    return { w, h, px };
  } catch { return null; }   // fără randare: păstrăm tot textul
}
// Textul paginilor, cu pozițiile (pentru harta testului)
export async function readTextPages(doc, { onlyVisible = true } = {}) {
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    // eslint-disable-next-line no-await-in-loop
    const page = await doc.getPage(n);
    // eslint-disable-next-line no-await-in-loop
    const tc = await page.getTextContent();
    let items = tc.items.filter((it) => typeof it.str === 'string').map((it) => ({
      str: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0,
      h: Math.abs(it.transform[3]) || it.height || 0,
      // text rotit (filigran, etichete de figură): nu face parte din așezarea testului
      rot: Math.abs(it.transform[1]) + Math.abs(it.transform[2]) > 0.01 * (Math.abs(it.transform[0]) + Math.abs(it.transform[3]) || 1),
    }));
    if (onlyVisible && (page.rotate || 0) % 360 === 0) {
      // eslint-disable-next-line no-await-in-loop
      const mask = await inkMaskOf(page);
      if (mask) items = items.filter((it) => !it.str.trim() || visibleIn(mask, page.view, it));
    }
    pages.push({ n, view: page.view.slice(), rotate: page.rotate || 0, items });
    try { page.cleanup(); } catch { /* noop */ }
  }
  return pages;
}

function drawInk(ctx, list, scale, ox, oy) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of list || []) {
    const pts = s.pts;
    if (!pts || !pts.length) continue;
    ctx.strokeStyle = s.c || INK_COLORS[0];
    ctx.fillStyle = s.c || INK_COLORS[0];
    const w = Math.max(1.2, (s.w || PEN_PT) * scale);
    if (pts.length === 1) { ctx.beginPath(); ctx.arc((pts[0][0] - ox) * scale, (pts[0][1] - oy) * scale, w / 1.6, 0, 6.2832); ctx.fill(); continue; }
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo((pts[0][0] - ox) * scale, (pts[0][1] - oy) * scale);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
      ctx.quadraticCurveTo((pts[i][0] - ox) * scale, (pts[i][1] - oy) * scale, (mx - ox) * scale, (my - oy) * scale);
    }
    const L = pts[pts.length - 1];
    ctx.lineTo((L[0] - ox) * scale, (L[1] - oy) * scale);
    ctx.stroke();
  }
}

// O zonă a paginii (cu scrisul elevului peste ea) → canvas. Latura lungă ≤ maxSide px
// (cât citește modelul fără să micșoreze), cel mult maxScale px pe punct.
export async function renderCrop(doc, crop, inkList, { maxSide = 1568, maxScale = 2.6 } = {}) {
  const page = await doc.getPage(crop.p);
  const w = crop.x1 - crop.x0, h = crop.y1 - crop.y0;
  const scale = Math.max(0.6, Math.min(maxScale, maxSide / Math.max(w, h)));
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w * scale));
  cv.height = Math.max(1, Math.round(h * scale));
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
  const vp = page.getViewport({ scale, offsetX: -crop.x0 * scale, offsetY: -crop.y0 * scale });
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  drawInk(ctx, inkList, scale, crop.x0, crop.y0);
  try { page.cleanup(); } catch { /* noop */ }
  return cv;
}
export function canvasJpeg(cv, quality = 0.86) {
  try { return cv.toDataURL('image/jpeg', quality); } catch { return null; }
}
// miniatura pentru conversație (≤ 16 KB)
export function thumbOf(cv) {
  try {
    const W = 260, s = Math.min(1, W / cv.width);
    const t = document.createElement('canvas');
    t.width = Math.max(1, Math.round(cv.width * s)); t.height = Math.max(1, Math.round(Math.min(cv.height * s, 360)));
    const g = t.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, t.width, t.height);
    g.drawImage(cv, 0, 0, cv.width * s, cv.height * s);
    for (const q of [0.6, 0.45, 0.3]) {
      const u = t.toDataURL('image/jpeg', q);
      if (u.length <= 16000) return u;
    }
  } catch { /* fără miniatură */ }
  return null;
}

// „⬇ PDF cu rezolvarea": același PDF (text, pagini, tot), cu scrisul elevului
// desenat VECTORIAL peste pagini — rămâne un PDF obișnuit.
const hexRgb = (h) => { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h || ''); return m ? [1, 2, 3].map((i) => parseInt(m[i], 16) / 255) : [0.11, 0.3, 0.85]; };
// ═════════════════════════ NOTA, SCRISĂ CU ROȘU PE TEST (8 nov. 2026) ═════════════════════════
// „după corectare, notează cu roșu nota pe test, scris de mână, de exemplu:
// 7,30 (șapte ^30)" — ca profesorul pe lucrare: cifrele, apoi în paranteză nota
// în litere, cu sutimile în exponent. Pe prima pagină, sus, în dreapta.
const NOTE_LITERE = ['', 'unu', 'doi', 'trei', 'patru', 'cinci', 'șase', 'șapte', 'opt', 'nouă', 'zece'];

// 7.3 → { cifre: '7,30', cuvant: 'șapte', zecimale: '30', text: '7,30 (șapte^30)' }
export function notaScrisa(nota) {
  const n = Number(nota);
  if (!Number.isFinite(n)) return null;
  const v = Math.max(1, Math.min(10, Math.round(n * 100) / 100));
  const intreg = Math.floor(v + 1e-9);
  const zec = Math.round((v - intreg) * 100);
  const z2 = String(zec).padStart(2, '0');
  return {
    cifre: `${intreg},${z2}`, cuvant: NOTE_LITERE[intreg], zecimale: zec ? z2 : '',
    text: `${intreg},${z2} (${NOTE_LITERE[intreg]}${zec ? `^${z2}` : ''})`,
  };
}

// ─── 🔴 NOTA PE ECRAN (vizualizatorul de PDF, src/components/PdfCanvasViewer.jsx) ───
// Nota se scrie sus, pe PRIMA pagină. Elevul care corectează de pe pagina 2 sau 3 n-o
// vedea („nu apare nota cu roșu", 8 nov. 2026): după prima corectare din vizită și la clic
// pe nota din bară, zona cu paginile se derulează la ea — ca la o lucrare primită înapoi.
const docImplicit = () => (typeof document !== 'undefined' ? document : null);
function notaEl(doc) {
  const g = doc && doc.querySelector('.nota-rosie');
  const holder = g && g.closest('[data-pdf-pagini]');
  const pag = g && g.closest('[data-pagina]');
  return holder && pag ? { g, holder, pag } : null;
}
// nota e pe ecran (în zona cu paginile)?
export function notaPeEcran({ doc = docImplicit() } = {}) {
  const e = notaEl(doc);
  if (!e) return false;
  const h = e.holder.getBoundingClientRect(), b = e.g.getBoundingClientRect();
  return b.width > 0 && b.bottom > h.top + 4 && b.top < h.bottom - 4 && b.right > h.left + 4 && b.left < h.right - 4;
}
// derulează la notă: începutul primei pagini (antetul + nota) → { top, left }; null = nu e desenată
export function veziNota({ lin = true, doc = docImplicit() } = {}) {
  const e = notaEl(doc);
  if (!e) return null;
  const { holder } = e;
  const h = holder.getBoundingClientRect(), p = e.pag.getBoundingClientRect(), b = e.g.getBoundingClientRect();
  let top = holder.scrollTop + (p.top - h.top) - 8;
  // pagina mult mărită: nota nu încape cu tot antetul deasupra → nota, spre mijloc
  if (b.bottom - p.top + 16 > h.height) top = holder.scrollTop + (b.top - h.top) - h.height / 3;
  let left = holder.scrollLeft;
  if (b.right > h.right - 8) left += b.right - h.right + 16;
  else if (b.left < h.left + 8) left -= h.left - b.left + 16;
  const poz = { top: Math.max(0, Math.round(top)), left: Math.max(0, Math.round(left)) };
  if (typeof holder.scrollTo === 'function') holder.scrollTo({ ...poz, behavior: lin ? 'smooth' : 'auto' });
  else { holder.scrollTop = poz.top; holder.scrollLeft = poz.left; }
  return poz;
}

// cutiile rândurilor de text ale unei pagini citite cu readTextPages (puncte,
// colțul din stânga-sus = 0,0) — locurile pe care nota nu trebuie să le acopere
export function cutiiText(pg) {
  if (!pg || !Array.isArray(pg.view)) return [];
  const x0p = pg.view[0], top = pg.view[3];
  return (pg.items || [])
    .filter((it) => it && String(it.str || '').trim() && !it.rot && it.w > 0 && it.h > 0)
    .map((it) => ({ x0: it.x - x0p, x1: it.x - x0p + it.w, y0: top - it.y - it.h * 0.85, y1: top - it.y + it.h * 0.22 }));
}

// unde se scrie nota pe pagina 1 (puncte PDF, colțul din stânga-sus = 0,0): ancora
// e capătul din DREAPTA al rândului (textul se scrie spre stânga), ușor înclinat —
// spre stânga coboară. Cu `cutii` (textul paginii) și `latime` (lățimea notei):
// primul loc liber de sus în jos, în dreapta paginii (întâi în marginea de sus),
// ca nota să nu acopere antetul testului; fără loc liber → în marginea de sus.
export function pozitieNota(W, H, { cutii = null, latime = null } = {}) {
  const size = Math.max(18, Math.min(34, W * 0.052));
  const rot = -6;
  const sus = size * 1.12;                                  // linia de bază, în marginea de sus
  if (!Array.isArray(cutii) || !latime) return { x: W * 0.93, y: sus, size, rot };
  const panta = Math.tan((Math.abs(rot) * Math.PI) / 180);
  const ocupat = (x, y) => cutii.some((c) => {
    const a = Math.max(c.x0, x - latime - size * 0.25), b = Math.min(c.x1, x + size * 0.15);
    if (a >= b) return false;
    // marginile notei înclinate, pe porțiunea comună cu rândul de text
    const jos = y + size * 0.36 + (x - a) * panta;
    const virf = y - size * 0.92 + (x - b) * panta;
    return c.y0 < jos && c.y1 > virf;
  });
  for (let y = sus; y <= H * 0.2; y += size * 0.25) {
    for (const fx of [0.93, 0.955, 0.9]) {
      const x = W * fx;
      if (x - latime > W * 0.04 && !ocupat(x, y)) return { x, y, size, rot, liber: true };
    }
  }
  return { x: W * 0.93, y: sus, size, rot };
}

// lățimea aproximativă a notei (fontul de mână are ~0,45 em pe literă) — pentru
// sublinierea de sub ea și pentru imaginea din PDF-ul descărcat
export function latimeNota(ns, size) {
  if (!ns) return 0;
  const em = 0.45 * size;
  return em * (ns.cifre.length + 1) + em * 0.82 * (ns.cuvant.length + 2) + em * 0.5 * ns.zecimale.length;
}

// notaImg: { png: Uint8Array, x, y, w, h } (puncte, colțul din stânga-sus) — nota
// scrisă cu roșu, desenată în browser (font de mână) și pusă pe pagina 1
export async function exportInkPdf(bytes, ink, geo, { notaImg = null } = {}) {
  const L = await loadPdfLib();
  const doc = await L.PDFDocument.load(bytes.slice ? bytes.slice(0) : bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  if (notaImg && notaImg.png && pages[0] && geo && geo[1]) {
    try {
      const g1 = geo[1];
      const img = await doc.embedPng(notaImg.png);
      pages[0].drawImage(img, { x: g1.x0 + notaImg.x, y: g1.top - notaImg.y - notaImg.h, width: notaImg.w, height: notaImg.h });
    } catch { /* PDF-ul rămâne fără notă, cu scrisul */ }
  }
  for (const [pk, list] of Object.entries(ink || {})) {
    const page = pages[Number(pk) - 1];
    const g = geo && geo[pk];
    if (!page || !g || !list || !list.length) continue;
    const ops = [L.pushGraphicsState(), L.setLineCap(L.LineCapStyle.Round), L.setLineJoin(L.LineJoinStyle.Round)];
    for (const s of list) {
      const pts = s.pts;
      if (!pts || !pts.length) continue;
      const [r, gr, b] = hexRgb(s.c);
      ops.push(L.setStrokingRgbColor(r, gr, b), L.setLineWidth(s.w || PEN_PT));
      const X = (x) => x + g.x0, Y = (y) => g.top - y;
      ops.push(L.moveTo(X(pts[0][0]), Y(pts[0][1])));
      if (pts.length === 1) ops.push(L.lineTo(X(pts[0][0]) + 0.01, Y(pts[0][1])));
      for (let i = 1; i < pts.length; i++) ops.push(L.lineTo(X(pts[i][0]), Y(pts[i][1])));
      ops.push(L.stroke());
    }
    ops.push(L.popGraphicsState());
    page.pushOperators(...ops);
  }
  return doc.save();
}
