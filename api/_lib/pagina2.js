// =====================================================================
// api/_lib/pagina2.js — ⬜ ALB PESTE DREPTUNGHIUL NEGRU DE PE PAGINA 2 (testele de EN)
//
// Ce e dreptunghiul: subiectele de EN se tipăresc față-verso, iar pe pagina 1, sus
// în dreapta, e „colțul secretizat" (numele elevului, școala…), care se îndoaie și
// se lipește. Pe pagina 2, exact în spatele lui (sus, în stânga), PDF-urile oficiale
// — și multe simulări ale inspectoratelor, care le copiază — au un dreptunghi negru
// de ~230 × 240 pt, ca numele să nu se vadă prin hârtie. Pe ecran și la tipărirea
// de acasă e doar o pată de cerneală.
//
// Cererea lui Radu (7 nov. 2026), după prima versiune (care scotea dreptunghiul din
// conținutul paginii și scria PDF-ul peste original): „fă cât mai simplu: lipește un
// dreptunghi alb peste dreptunghiul negru și păstrează spațiu gol alb acolo".
//
// Deci, pe o COPIE a testului (originalul nu se atinge — pagina2Run.js):
//   1. randează pagina 2 (MuPDF) și caută, sus în stânga, un dreptunghi plin de
//      negru (≥ 110 pt pe latură, ≥ 92% negru) — oricum ar fi desenat (desen,
//      imagine, mască, pagină scanată);
//   2. zona albă = dreptunghiul + rama / umbra / marginea lui estompată (cel mult
//      10 pt), dar NU linia antetului sau rama unui tabel care trec pe lângă el;
//   3. lipește un dreptunghi ALB peste zonă, DEASUPRA a tot ce e pe pagină: conținutul
//      paginii rămâne neatins (octet cu octet), doar închis între „q … Q" (cu q / Q
//      numărate, ca starea grafică să revină exact la început), iar după el vine
//      `q … cm 1 g x y w h re f Q`;
//   4. salvează INCREMENTAL (octeții originalului rămân la începutul fișierului;
//      se adaugă doar pagina 2 schimbată + două stream-uri mici);
//   5. VERIFICĂ prin randare: în zonă e alb, în afara ei pagina 2 e identică pixel
//      cu pixel, celelalte pagini sunt identice. Altfel „nesigur" (nimic de urcat).
//
// Funcțiile primesc biblioteca MuPDF ca parametru (`mupdf`), ca să meargă și pe
// server (Node, `loadMupdf()`), și în teste. Nu știu nimic de Supabase.
// =====================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

// 1 — scotea dreptunghiul din conținut și scria peste original (6–7 nov. 2026)
// 2 — alb lipit peste el, pe o copie (7 nov. 2026)
const VERSION = 2;

const OPT = {
  pageIndex: 1,            // pagina 2
  scale: 2,                // px / pt la căutarea dreptunghiului și la verificare
  zoneX: 0.62,             // sus-stânga: x ≤ 62% din lățime…
  zoneY: 0.55,             // …și y ≤ 55% din înălțime (de sus)
  minSide: 110,            // pt — dreptunghiul are ~230 × 240 pt
  maxSide: 430,
  minAspect: 0.5,
  maxAspect: 2,
  darkThr: 110,            // gri (0–255) sub care un pixel e „negru"
  minDarkFrac: 0.92,       // cât de plin de negru trebuie să fie dreptunghiul
  ext: 10,                 // pt — rama / umbra lipite de dreptunghi (cel mult atât în afară)
  otherScale: 0.5,         // randarea celorlalte pagini, la verificare
  maxResidual: 0.03,       // după: cel mult 3% negru în dreptunghi
};

// ─── mici unelte ─────────────────────────────────────────────────────────────
function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d)];
}
const grow = (r, d) => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
const round1 = (v) => Math.round(v * 10) / 10;
const latin1 = (b, s, e) => { let t = ''; for (let i = s; i < e; i++) t += String.fromCharCode(b[i]); return t; };
const ascii = (s) => { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 0xff; return u; };

// un număr pentru conținutul PDF: fără exponent, cu destule zecimale (matricea
// inversă a paginii poate avea elemente mici)
const fmt = (v) => {
  if (!Number.isFinite(v)) return '0';
  let t = v.toFixed(Math.abs(v) >= 1 ? 4 : 10);
  if (t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '');
  return t === '-0' ? '0' : t;
};

// ─── cititorul conținutului (doar cât să numărăm q / Q, BT / ET, BMC / EMC) ──
// Operatorii unui stream de conținut, sărind corect peste șiruri, comentarii,
// dicționare și datele binare ale imaginilor inline (BI … ID … EI).
const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DELIM = new Uint8Array(256);
for (const ch of '()<>[]{}/%') DELIM[ch.charCodeAt(0)] = 1;
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;

function contentOps(b) {
  const n = b.length;
  const ops = [];
  let depth = 0;           // în [ ] sau << >>: cuvintele nu sunt operatori
  let i = 0;
  while (i < n) {
    const c = b[i];
    if (WS[c]) { i++; continue; }
    if (c === 0x25) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }      // % comentariu
    if (c === 0x2F) { i++; while (i < n && !WS[b[i]] && !DELIM[b[i]]) i++; continue; }    // /Nume
    if (c === 0x28) {                                                                     // (șir)
      let d = 1; i++;
      while (i < n && d > 0) {
        if (b[i] === 0x5C) { i += 2; continue; }
        if (b[i] === 0x28) d++;
        else if (b[i] === 0x29) d--;
        i++;
      }
      continue;
    }
    if (c === 0x3C) {
      if (b[i + 1] === 0x3C) { depth++; i += 2; continue; }
      i++; while (i < n && b[i] !== 0x3E) i++; i++;                                     // <hex>
      continue;
    }
    if (c === 0x3E) { if (b[i + 1] === 0x3E) { depth = Math.max(0, depth - 1); i += 2; } else i++; continue; }
    if (c === 0x5B) { depth++; i++; continue; }
    if (c === 0x5D) { depth = Math.max(0, depth - 1); i++; continue; }
    if (c === 0x7B || c === 0x7D || c === 0x29) { i++; continue; }
    const s = i;
    while (i < n && !WS[b[i]] && !DELIM[b[i]]) i++;
    const tok = latin1(b, s, i);
    if (depth || NUM_RE.test(tok) || tok === 'true' || tok === 'false' || tok === 'null') continue;
    if (tok === 'BI') { i = inlineImageEnd(b, i); ops.push('BI'); continue; }
    ops.push(tok);
  }
  return ops;
}

// BI … ID <date> EI — unde se termină datele imaginii inline
function inlineImageEnd(b, from) {
  const n = b.length;
  const dict = {};
  let key = null;
  let i = from;
  while (i < n) {
    while (i < n && WS[b[i]]) i++;
    if (i >= n) break;
    if (b[i] === 0x49 && b[i + 1] === 0x44 && (i + 2 >= n || WS[b[i + 2]])) { i += 2; break; }   // ID
    const s = i;
    if (b[i] === 0x2F) {
      i++; while (i < n && !WS[b[i]] && !DELIM[b[i]]) i++;
      const name = latin1(b, s + 1, i);
      if (key == null) key = name; else { dict[key] = name; key = null; }
      continue;
    }
    if (b[i] === 0x5B) {
      let d = 0;
      while (i < n) { if (b[i] === 0x5B) d++; else if (b[i] === 0x5D) { d--; if (!d) { i++; break; } } i++; }
      key = null;
      continue;
    }
    if (b[i] === 0x3C && b[i + 1] === 0x3C) {
      let d = 0;
      while (i < n) { if (b[i] === 0x3C && b[i + 1] === 0x3C) { d++; i += 2; continue; } if (b[i] === 0x3E && b[i + 1] === 0x3E) { d--; i += 2; if (!d) break; continue; } i++; }
      key = null;
      continue;
    }
    while (i < n && !WS[b[i]] && !DELIM[b[i]]) i++;
    if (i === s) { i++; continue; }
    if (key != null) { dict[key] = latin1(b, s, i); key = null; }
  }
  // datele: un spațiu după ID; lungimea, dacă se poate calcula (fără filtru), sare peste ele
  const dataStart = i < n && WS[b[i]] ? i + 1 : i;
  let j = dataStart;
  const num = (...keys) => { for (const k of keys) if (dict[k] != null && NUM_RE.test(dict[k])) return parseFloat(dict[k]); return null; };
  const w = num('W', 'Width'), h = num('H', 'Height');
  const im = dict.IM === 'true' || dict.ImageMask === 'true';
  const bpc = im ? 1 : num('BPC', 'BitsPerComponent');
  const cs = dict.CS || dict.ColorSpace;
  const comps = im ? 1 : ({ DeviceGray: 1, G: 1, DeviceRGB: 3, RGB: 3, DeviceCMYK: 4, CMYK: 4, Indexed: 1, I: 1 })[cs] || null;
  if (!dict.F && !dict.Filter && w && h && bpc && comps) {
    const len = h * Math.ceil((w * comps * bpc) / 8);
    if (dataStart + len <= n) j = dataStart + len;
  }
  for (; j + 1 < n; j++) {
    if (b[j] === 0x45 && b[j + 1] === 0x49 && (j === dataStart || WS[b[j - 1]]) && (j + 2 >= n || WS[b[j + 2]] || DELIM[b[j + 2]])) return j + 2;
  }
  return n;
}

// Starea în care rămâne conținutul paginii la sfârșit:
//   minDepth — cât de jos coboară q / Q (sub 0 = mai multe Q decât q, la un moment dat)
//   depth    — q − Q, la sfârșit
//   inText   — s-a terminat într-un BT fără ET
//   pathOpen — un drum început și nedesenat
//   mc       — BMC / BDC fără EMC (un strat opțional ascuns ar ascunde și albul)
const PATH_OPS = new Set(['m', 'l', 'c', 'v', 'y', 'h', 're']);
const PAINT_OPS = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'n']);
function contentBalance(bytes) {
  let depth = 0, minDepth = 0, inText = false, pathOpen = false, mc = 0;
  for (const op of contentOps(bytes)) {
    if (op === 'q') depth++;
    else if (op === 'Q') { depth--; if (depth < minDepth) minDepth = depth; }
    else if (op === 'BT') inText = true;
    else if (op === 'ET') inText = false;
    else if (op === 'BMC' || op === 'BDC') mc++;
    else if (op === 'EMC') mc = Math.max(0, mc - 1);
    else if (PATH_OPS.has(op)) pathOpen = true;
    else if (PAINT_OPS.has(op)) pathOpen = false;
  }
  return { depth, minDepth, inText, pathOpen, mc };
}

// Ce se pune înainte și după conținutul paginii: înainte, destule „q" cât să nu
// coboare niciodată sub starea de la început (+ una a noastră); după, se închide
// ce a rămas deschis și se revine EXACT la starea de la început, apoi albul.
function wrapContent(bal, rectOps) {
  const push = 1 + Math.max(0, -bal.minDepth);
  const pre = 'q\n'.repeat(push);
  const post = '\n'
    + (bal.inText ? 'ET\n' : '')
    + (bal.pathOpen ? 'n\n' : '')
    + 'EMC\n'.repeat(bal.mc)
    + 'Q\n'.repeat(push + bal.depth)
    + rectOps + '\n';
  return { pre, post };
}

// un dreptunghi alb (în coordonatele paginii, pt de sus) desenat cu CTM-ul `ctm`
// de la începutul paginii: q <inversa> cm 1 g x y w h re f Q
function whiteRect(box, ctm) {
  const inv = invert(ctm);
  if (!inv) return null;
  return `q ${inv.map(fmt).join(' ')} cm 1 g ${fmt(box[0])} ${fmt(box[1])} ${fmt(box[2] - box[0])} ${fmt(box[3] - box[1])} re f Q`;
}

// ─── memoria MuPDF ───────────────────────────────────────────────────────────
// Buffer-ele MuPDF stau în memoria WebAssembly; le copiem în memoria JS și le
// eliberăm imediat (la zeci de fișiere la rând memoria s-ar umple).
function takeBytes(buf) {
  try { return (buf.asUint8Array ? buf.asUint8Array() : new Uint8Array(buf)).slice(); }
  finally { try { if (buf && buf.destroy) buf.destroy(); } catch { /* nimic */ } }
}
// Fiecare eroare MuPDF care ajunge în JavaScript lasă ~70 de octeți din stiva
// WebAssembly a instanței (64 KB): le evităm (readStream() doar pe referința
// indirectă a unui stream) și le numărăm — rularea ia o instanță nouă înainte de prag.
const ERR = { n: 0 };
const noteErr = () => { ERR.n++; };
function addStreamTo(mupdf, doc, bytes, dict) {
  const b = new mupdf.Buffer(bytes);
  try { return doc.addStream(b, dict); }
  finally { try { b.destroy(); } catch { /* nimic */ } }
}

// conținutul paginii: unul sau mai multe stream-uri (citite, lipite cu \n)
function pageContentBytes(pageObj) {
  const c = pageObj.get('Contents');
  if (c.isNull()) return new Uint8Array(0);
  const parts = [];
  const r = c.resolve();
  if (r.isArray()) { for (let k = 0; k < r.length; k++) parts.push(r.get(k)); } else parts.push(c);
  const bufs = parts.map((p) => { try { return takeBytes(p.readStream()); } catch { noteErr(); return new Uint8Array(0); } });
  let total = 0; for (const b of bufs) total += b.length + 1;
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { out.set(b, off); off += b.length; out[off++] = 10; }
  return out;
}

// ─── randarea în tonuri de gri ───────────────────────────────────────────────
function renderGray(mupdf, page, scale) {
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceGray, false, true);
  const w = pix.getWidth(), h = pix.getHeight(), stride = pix.getStride();
  const src = pix.getPixels();
  const px = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) px.set(src.subarray(y * stride, y * stride + w), y * w);
  try { pix.destroy && pix.destroy(); } catch { /* nimic */ }
  return { w, h, px, scale };
}

// ─── dreptunghiul negru, pe randare (sus în stânga) ──────────────────────────
// Rânduri cu un șir lung de pixeli negri, consecutive, cu capete apropiate →
// un dreptunghi; îl validăm (plin ≥ 92%, laturi, proporții). Toleranțele țin
// cont de scanările ușor strâmbe și de zgomot.
function findDarkRect(r, pageW, pageH, opt = OPT) {
  const { w, h, px, scale } = r;
  const zx = Math.min(w, Math.round(pageW * opt.zoneX * scale));
  const zy = Math.min(h, Math.round(pageH * opt.zoneY * scale));
  const minLen = opt.minSide * scale * 0.9;
  const gap = Math.max(1, Math.round(scale));
  const tol = 6 * scale;
  const runs = new Array(zy);
  for (let y = 0; y < zy; y++) {
    let best = null, s = -1, last = -1;
    const row = y * w;
    for (let x = 0; x <= zx; x++) {
      const dark = x < zx && px[row + x] < opt.darkThr;
      if (dark) { if (s < 0) s = x; last = x; continue; }
      if (s >= 0 && x - last > gap) {
        if (!best || last - s > best[1] - best[0]) best = [s, last];
        s = -1;
      }
    }
    if (s >= 0 && (!best || last - s > best[1] - best[0])) best = [s, last];
    runs[y] = best && best[1] - best[0] + 1 >= minLen ? best : null;
  }
  const med = (arr) => { const t = arr.slice().sort((a, b) => a - b); return t[t.length >> 1]; };
  const cands = [];
  let y = 0;
  while (y < zy) {
    if (!runs[y]) { y++; continue; }
    const rows = [y];
    let ss = [runs[y][0]], ee = [runs[y][1]];
    let miss = 0, yy = y + 1;
    for (; yy < zy; yy++) {
      const rr = runs[yy];
      const ms = med(ss), me = med(ee);
      if (rr && Math.abs(rr[0] - ms) <= tol && Math.abs(rr[1] - me) <= tol) { rows.push(yy); ss.push(rr[0]); ee.push(rr[1]); miss = 0; if (ss.length > 400) { ss = ss.slice(-200); ee = ee.slice(-200); } continue; }
      if (++miss > 2 * gap) break;
    }
    const x0 = med(ss), x1 = med(ee) + 1, y0 = rows[0], y1 = rows[rows.length - 1] + 1;
    cands.push([x0, y0, x1, y1]);
    y = rows[rows.length - 1] + 1;          // de la primul rând nepotrivit (o linie lipită deasupra nu „mănâncă" dreptunghiul)
  }
  let best = null;
  for (const c of cands) {
    const wpt = (c[2] - c[0]) / scale, hpt = (c[3] - c[1]) / scale;
    if (wpt < opt.minSide || hpt < opt.minSide || wpt > opt.maxSide || hpt > opt.maxSide) continue;
    const asp = wpt / hpt;
    if (asp < opt.minAspect || asp > opt.maxAspect) continue;
    let dark = 0, tot = 0;
    for (let yy = c[1]; yy < c[3]; yy++) for (let xx = c[0]; xx < c[2]; xx++) { tot++; if (px[yy * w + xx] < opt.darkThr) dark++; }
    const frac = tot ? dark / tot : 0;
    if (frac < opt.minDarkFrac) continue;
    if (!best || (c[2] - c[0]) * (c[3] - c[1]) > (best.px[2] - best.px[0]) * (best.px[3] - best.px[1])) best = { px: c, frac };
  }
  if (!best) return null;
  const c = best.px;
  return { rect: [c[0] / scale, c[1] / scale, c[2] / scale, c[3] / scale], dark: best.frac };
}

function darkFraction(r, rect, thr) {
  const { w, h, px, scale } = r;
  const x0 = Math.max(0, Math.floor(rect[0] * scale)), y0 = Math.max(0, Math.floor(rect[1] * scale));
  const x1 = Math.min(w, Math.ceil(rect[2] * scale)), y1 = Math.min(h, Math.ceil(rect[3] * scale));
  let dark = 0, tot = 0;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { tot++; if (px[y * w + x] < thr) dark++; }
  return tot ? dark / tot : 0;
}
// „cerneală" (orice nu e alb) rămasă în dreptunghi, fără marginea de 1 pt
const inkFraction = (r, R) => darkFraction(r, grow(R, -1), 230);

// ─── marginea dreptunghiului, pe randare: chenar / umbră, dar nu liniile paginii ─
// Pe fiecare latură, linia paralelă la distanța d (în px) în afara dreptunghiului:
//   cov    — cât din lungimea laturii e „cerneală" (< 215) pe linia aceea;
//   att    — cât din cerneala ei e lipită de cerneala liniei de dinainte (spre
//            dreptunghi): marginea strâmbă / estompată a unei scanări;
//   beyond — cât din continuarea liniei, DINCOLO de colțuri (între ext și 3·ext),
//            e cerneală. Un chenar / o umbră se opresc la colțuri (beyond mic);
//            linia antetului, rama unui tabel continuă (beyond mare) → nu se ating.
const INK = 215;
function sideLine(r, Rp, side, d, extPx) {
  const { w, h, px } = r;
  const [x0, y0, x1, y1] = Rp;
  const ink = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? -1 : px[y * w + x] < INK ? 1 : 0);
  const horiz = side === 'top' || side === 'bottom';
  const step = side === 'top' || side === 'left' ? -1 : 1;
  const fixed = side === 'top' ? y0 - d : side === 'bottom' ? y1 - 1 + d : side === 'left' ? x0 - d : x1 - 1 + d;
  const a0 = horiz ? x0 : y0, a1 = horiz ? x1 : y1;
  const at = (t, f) => (horiz ? ink(t, f) : ink(f, t));
  let n = 0, k = 0, att = 0, bn = 0, bk = 0;
  for (let t = a0; t < a1; t++) {
    const v = at(t, fixed);
    if (v < 0) continue;
    n++;
    if (v) { k++; if (at(t, fixed - step) === 1 || at(t - 1, fixed - step) === 1 || at(t + 1, fixed - step) === 1) att++; }
  }
  for (const [s, e] of [[a0 - 3 * extPx, a0 - extPx], [a1 + extPx, a1 + 3 * extPx]]) for (let t = s; t < e; t++) { const v = at(t, fixed); if (v >= 0) { bn++; bk += v; } }
  return { cov: n ? k / n : 0, att: k ? att / k : 1, beyond: bn ? bk / bn : 0, n };
}
// cât se întinde chenarul / umbra / marginea estompată pe fiecare latură (px);
// se oprește la prima linie cu cerneală care nu ține de dreptunghi
function frameExtent(r, R, opt) {
  const s = r.scale;
  const Rp = [Math.round(R[0] * s), Math.round(R[1] * s), Math.round(R[2] * s), Math.round(R[3] * s)];
  const extPx = Math.round(opt.ext * s);
  const out = {};
  const pad = {};
  let remnant = false;
  for (const side of ['left', 'top', 'right', 'bottom']) {
    let ext = 0;
    for (let d = 1; d <= extPx; d++) {
      const l = sideLine(r, Rp, side, d, extPx);
      if (!l.n) break;
      if (l.cov < 0.02) continue;                                   // alb (un spațiu până la chenar)
      if (l.beyond >= 0.2) break;                                   // o linie care trece pe lângă: a paginii
      if (l.cov >= 0.5 || (ext === d - 1 && l.att >= 0.9)) { ext = d; remnant = true; continue; }   // chenar / umbră / margine lipită
      break;                                                        // un text, un desen: stop
    }
    out[side] = ext;
    // marginea albului: până la 1,5 pt peste marginea antialiasată a dreptunghiului
    // (altfel, la zoom mic, alte vizualizatoare lasă o linie gri, abia vizibilă),
    // dar numai cât e alb curat — nu atinge linia antetului sau un text de alături
    let free = 0;
    for (let d = ext + 1; d <= ext + 3; d++) { const l = sideLine(r, Rp, side, d, extPx); if (!l.n || l.cov >= 0.02) break; free++; }
    pad[side] = Math.max(1, free);
  }
  const box = [(Rp[0] - out.left - pad.left) / s, (Rp[1] - out.top - pad.top) / s, (Rp[2] + out.right + pad.right) / s, (Rp[3] + out.bottom + pad.bottom) / s];
  return { box, sides: out, pad, remnant };
}

// ─── albul peste dreptunghiul de pe pagina 2 ─────────────────────────────────
// Întoarce { status, rect, box, bytes|null, check, notes, pages, incremental }:
//   status: 'curatat' (bytes = PDF-ul cu albul) · 'fara' (pagina 2 n-are dreptunghiul)
//           · 'nesigur' (verificarea n-a ieșit curat — nimic de urcat) · 'eroare'
function albPage2(mupdf, input, options = {}) {
  const opt = { ...OPT, ...options };
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const out = { version: VERSION, status: 'fara', rect: null, box: null, bytes: null, check: null, notes: [], pages: 0 };
  let doc;
  try { doc = new mupdf.PDFDocument(bytes); } catch (e) { noteErr(); return { ...out, status: 'eroare', error: `PDF-ul nu se deschide: ${e.message}` }; }
  // paginile încărcate se eliberează înaintea documentului (ordinea contează în MuPDF)
  const loaded = [];
  const load = (d, i) => { const pg = d.loadPage(i); loaded.push(pg); return pg; };
  try {
    return run();
  } catch (e) {
    noteErr();
    return { ...out, status: 'eroare', error: e && e.message ? e.message : String(e) };
  } finally {
    for (const pg of loaded) { try { pg.destroy(); } catch { /* nimic */ } }
    try { doc.destroy(); } catch { /* memoria WebAssembly se eliberează oricum */ }
    // imaginile / fonturile decodate rămân în cache-ul MuPDF; între fișiere nu folosesc la nimic
    try { if (mupdf.emptyStore) mupdf.emptyStore(); } catch { /* nimic */ }
  }
  function run() {
    if (doc.needsPassword && doc.needsPassword()) return { ...out, status: 'eroare', error: 'PDF protejat cu parolă' };
    out.pages = doc.countPages();
    if (out.pages <= opt.pageIndex) { out.notes.push('PDF-ul nu are pagina 2'); return out; }
    const page = load(doc, opt.pageIndex);
    const bounds = page.getBounds();
    const before = renderGray(mupdf, page, opt.scale);
    const found = findDarkRect(before, bounds[2] - bounds[0], bounds[3] - bounds[1], opt);
    if (!found) return out;
    const R = found.rect;
    out.rect = R.map(round1);
    out.darkBefore = Math.round(found.dark * 1000) / 1000;

    // celelalte pagini, așa cum sunt acum (pentru verificare)
    const others = [];
    for (let i = 0; i < out.pages; i++) others.push(i === opt.pageIndex ? null : renderGray(mupdf, load(doc, i), opt.otherScale));

    // zona albă: dreptunghiul cu rama / umbra lui
    const fx = frameExtent(before, R, opt);
    const box = fx.box;
    out.box = box.map(round1);

    // conținutul paginii între q … Q, apoi albul deasupra (stream-urile vechi rămân neatinse)
    const pageObj = page.getObject();
    const rect = whiteRect(box, page.getTransform());
    if (!rect) return { ...out, status: 'nesigur', error: 'transformare degenerată' };
    const { pre, post } = wrapContent(contentBalance(pageContentBytes(pageObj)), rect);
    const contents = doc.newArray();
    contents.push(addStreamTo(mupdf, doc, ascii(pre), doc.newDictionary()));
    const c = pageObj.get('Contents');
    if (!c.isNull()) {
      const r = c.resolve();
      if (r.isArray()) { for (let k = 0; k < r.length; k++) contents.push(r.get(k)); } else contents.push(c);
    }
    contents.push(addStreamTo(mupdf, doc, ascii(post), doc.newDictionary()));
    pageObj.put('Contents', contents);

    const incremental = !!(doc.canBeSavedIncrementally && doc.canBeSavedIncrementally());
    const newBytes = takeBytes(doc.saveToBuffer(incremental ? 'incremental,compress' : 'compress'));
    out.incremental = incremental;

    // ✔ verificarea, pe fișierul nou (deschis din nou)
    const check = verify(mupdf, newBytes, before, others, R, box, opt);
    out.check = check;
    if (!check.ok) return { ...out, status: 'nesigur', error: check.why };
    return { ...out, status: 'curatat', bytes: newBytes };
  }
}

function verify(mupdf, newBytes, before, others, R, box, opt) {
  const res = { ok: false, why: null };
  let nd;
  try { nd = new mupdf.PDFDocument(newBytes); } catch (e) { noteErr(); res.why = `PDF-ul nou nu se deschide: ${e.message}`; return res; }
  const loaded = [];
  const load = (i) => { const pg = nd.loadPage(i); loaded.push(pg); return pg; };
  try { return verifyDoc(mupdf, load, res, before, others, R, box, opt, nd.countPages()); } finally {
    for (const pg of loaded) { try { pg.destroy(); } catch { /* nimic */ } }
    try { nd.destroy(); } catch { /* nimic */ }
  }
}
function verifyDoc(mupdf, load, res, before, others, R, box, opt, n) {
  res.pages = n;
  if (n !== others.length) { res.why = 'numărul de pagini s-a schimbat'; return res; }
  // pagina 2: alb în zonă, restul identic
  const after = renderGray(mupdf, load(opt.pageIndex), opt.scale);
  if (after.w !== before.w || after.h !== before.h) { res.why = 'pagina 2 și-a schimbat mărimea'; return res; }
  res.darkAfter = Math.round(darkFraction(after, R, opt.darkThr) * 1000) / 1000;
  res.inkAfter = Math.round(inkFraction(after, R) * 1000) / 1000;
  // în afara zonei albe (+ 0,75 pt — marginea ei antialiasată): identic, pixel cu pixel
  const s = opt.scale;
  const E = grow(box, 0.75);
  const ex0 = Math.floor(E[0] * s), ey0 = Math.floor(E[1] * s), ex1 = Math.ceil(E[2] * s), ey1 = Math.ceil(E[3] * s);
  let diffOut = 0, maxOut = 0;
  for (let y = 0; y < after.h; y++) {
    const inY = y >= ey0 && y < ey1;
    for (let x = 0; x < after.w; x++) {
      if (inY && x >= ex0 && x < ex1) continue;
      const k = y * after.w + x;
      const d = Math.abs(after.px[k] - before.px[k]);
      if (d > 0) { diffOut++; if (d > maxOut) maxOut = d; }
    }
  }
  res.diffOutside = diffOut;
  res.maxOutside = maxOut;
  if (res.darkAfter > opt.maxResidual) { res.why = `în dreptunghi a rămas ${Math.round(res.darkAfter * 100)}% negru`; return res; }
  if (diffOut > 0) { res.why = `s-au schimbat ${diffOut} pixeli în afara dreptunghiului`; return res; }
  // lângă dreptunghi s-au albit doar rama / umbra lui, nu o linie a paginii
  // (antetul, rama unui tabel) care trece pe lângă el și continuă dincolo de colțuri
  const Rp = [Math.round(R[0] * s), Math.round(R[1] * s), Math.round(R[2] * s), Math.round(R[3] * s)];
  const extPx = Math.round(opt.ext * s);
  const reach = { left: Rp[0] - ex0, top: Rp[1] - ey0, right: ex1 - Rp[2], bottom: ey1 - Rp[3] };
  for (const side of ['left', 'top', 'right', 'bottom']) {
    for (let d = 2; d <= reach[side]; d++) {
      const horiz = side === 'top' || side === 'bottom';
      const fixed = side === 'top' ? Rp[1] - d : side === 'bottom' ? Rp[3] - 1 + d : side === 'left' ? Rp[0] - d : Rp[2] - 1 + d;
      let changed = 0;
      for (let t = horiz ? Rp[0] : Rp[1]; t < (horiz ? Rp[2] : Rp[3]); t++) {
        const x = horiz ? t : fixed, y = horiz ? fixed : t;
        if (x < 0 || y < 0 || x >= after.w || y >= after.h) continue;
        if (Math.abs(after.px[y * after.w + x] - before.px[y * after.w + x]) > 16) changed++;
      }
      if (changed && sideLine(before, Rp, side, d, extPx).beyond >= 0.2) { res.why = `albul ar acoperi o linie a paginii lângă dreptunghi (${side}, ${Math.round(d / s * 10) / 10} pt)`; return res; }
    }
  }
  // celelalte pagini: identice, pixel cu pixel
  let otherDiff = 0;
  for (let i = 0; i < n; i++) {
    if (i === opt.pageIndex) continue;
    const a = others[i];
    const b = renderGray(mupdf, load(i), opt.otherScale);
    if (!a || a.w !== b.w || a.h !== b.h) { otherDiff += b.w * b.h; continue; }
    for (let k = 0; k < a.px.length; k++) if (a.px[k] !== b.px[k]) otherDiff++;
  }
  res.otherPagesDiff = otherDiff;
  if (otherDiff > 0) { res.why = `alte pagini s-au schimbat (${otherDiff} pixeli)`; return res; }
  res.ok = true;
  return res;
}

// ─── MuPDF pe server (același fel ca api/_lib/figuri.js) ─────────────────────
// { fresh: true } → o instanță WebAssembly nouă (alt URL al modulului), după o
// „memory access out of bounds": instanța veche nu mai e de folosit.
let mupdfP = null;
let mupdfGen = 0;
async function loadMupdf({ fresh = false } = {}) {
  if (fresh) mupdfP = null;
  if (!mupdfP) {
    if (fresh || !globalThis.$libmupdf_wasm_Module) {
      let wasmBinary = null;
      // fișierul WebAssembly, citit explicit, cu calea scrisă întreagă: așa îl ia și
      // împachetarea funcțiilor pe Vercel (la fel ca în api/_lib/figuri.js)
      try { wasmBinary = fs.readFileSync(path.join(__dirname, '..', '..', 'node_modules', 'mupdf', 'dist', 'mupdf-wasm.wasm')); } catch { /* îl caută MuPDF singur */ }
      globalThis.$libmupdf_wasm_Module = wasmBinary ? { wasmBinary } : {};
    }
    // import('mupdf') scris întreg (îl vede împachetarea); instanța nouă = același fișier, alt URL
    const p = fresh ? import(`${url.pathToFileURL(require.resolve('mupdf')).href}?i=${++mupdfGen}`) : import('mupdf');
    mupdfP = p.catch((e) => { mupdfP = null; throw e; });
  }
  return mupdfP;
}
const isWasmCrash = (msg) => /memory access out of bounds|unreachable|RuntimeError|table index is out of bounds|null function|function signature mismatch/i.test(String(msg || ''));

module.exports = {
  VERSION, OPT, albPage2, loadMupdf, isWasmCrash,
  mupdfErrors: () => ERR.n,
  // pentru teste
  _internals: { contentOps, contentBalance, wrapContent, findDarkRect, renderGray, darkFraction, inkFraction, invert, pageContentBytes, verify, frameExtent, sideLine, whiteRect },
};
