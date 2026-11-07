// =====================================================================
// api/_lib/pagina2.js — 🧽 DREPTUNGHIUL NEGRU DE PE PAGINA 2 (testele de EN)
//
// Cererea lui Radu (6 nov. 2026): „La testele de evaluare națională, fă un bot
// care scoate dreptunghiul negru de pe pagina 2, în rest nu schimba nimic."
//
// Ce e dreptunghiul: subiectele de EN se tipăresc față-verso, iar pe pagina 1, sus
// în dreapta, e „colțul secretizat" (numele elevului, școala…), care se îndoaie și
// se lipește. Pe pagina 2, exact în spatele lui (sus, în stânga), PDF-urile oficiale
// — și multe simulări ale inspectoratelor, care le copiază — au un dreptunghi negru
// de ~230 × 240 pt, ca numele să nu se vadă prin hârtie. Pe ecran și la tipărirea
// de acasă e doar o pată de cerneală.
//
// E desenat în mai multe feluri, deci botul nu caută un anumit fel de desen, ci
// dreptunghiul AȘA CUM SE VEDE:
//   1. randează pagina 2 (MuPDF) și caută, sus în stânga, un dreptunghi plin de
//      negru (≥ 110 pt pe latură, ≥ 92% negru);
//   2. citește conținutul paginii (operațiile de desen, cu poziția lor) și scoate
//      DOAR ce cade în întregime în acel dreptunghi (+ 3 pt pentru ramă):
//        · forme pline / contururi închise la culoare → pictarea lor devine „n"
//          (drumul rămâne, deci tăieturile — „W n" — nu se schimbă);
//        · imagini, măști de imagine (cum e în subiectele oficiale), imagini
//          inline și formulare (Form XObject) aflate în întregime în dreptunghi;
//        · dintr-un drum compus, doar bucățile (sub-drumurile) din dreptunghi;
//      ce e alb (dreptunghiul alb de sub mască) rămâne — nu se vede;
//   3. paginile SCANATE (dreptunghiul e chiar în pixelii imaginii paginii): imaginea
//      rămâne neatinsă (fără recomprimare), iar imediat după ea se desenează un
//      dreptunghi ALB exact peste zona neagră (cu marginea ei, la scanările ușor
//      strâmbe) — ce se desenează după imagine rămâne deasupra, ca înainte;
//   4. salvează INCREMENTAL (octeții fișierului original rămân neatinși, la
//      început; se adaugă doar pagina 2 schimbată) — dacă PDF-ul nu permite,
//      salvare normală;
//   5. VERIFICĂ prin randare: în dreptunghi a rămas alb, în afara lui pagina 2 e
//      identică pixel cu pixel, iar celelalte pagini sunt identice. Altfel nu
//      întoarce nimic de urcat („nesigur") — fișierul de pe site rămâne cum era.
//
// Funcțiile primesc biblioteca MuPDF ca parametru (`mupdf`), ca să meargă și pe
// server (Node, `loadMupdf()`), și în teste. Nu știu nimic de Supabase: rularea
// (descărcare, copia originalului, urcarea în același loc) e în pagina2Run.js.
// =====================================================================
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const url = require('node:url');

const VERSION = 1;

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
  margin: 3,               // pt — rama și marginile antialiasate țin de dreptunghi
  ext: 10,                 // pt — umbrele / chenarele puțin mai mari decât dreptunghiul (≥ 80% în el)
  band: 3,                 // pt — la scanări: marginea strâmbă / estompată lipită de dreptunghi
  otherScale: 0.5,         // randarea celorlalte pagini, la verificare
  maxResidual: 0.03,       // după: cel mult 3% negru în dreptunghi
};

// ─── matrice (convenția PDF: [a b c d e f], punct-rând × matrice) ─────────────
const mul = (m, n) => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (!det) return null;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(m[4] * a + m[5] * c), -(m[4] * b + m[5] * d)];
}
const emptyBox = () => [Infinity, Infinity, -Infinity, -Infinity];
function addPt(bb, p) { if (p[0] < bb[0]) bb[0] = p[0]; if (p[1] < bb[1]) bb[1] = p[1]; if (p[0] > bb[2]) bb[2] = p[0]; if (p[1] > bb[3]) bb[3] = p[1]; }
function unitBox(ctm) { const bb = emptyBox(); for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) addPt(bb, apply(ctm, x, y)); return bb; }
const isEmpty = (bb) => !(bb[2] >= bb[0] && bb[3] >= bb[1]);
const inside = (bb, r) => !isEmpty(bb) && bb[0] >= r[0] && bb[1] >= r[1] && bb[2] <= r[2] && bb[3] <= r[3];
const grow = (r, d) => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
const area = (r) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
const overlap = (a, b) => area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
const round1 = (v) => Math.round(v * 10) / 10;

// ─── cititorul conținutului (lexer) ─────────────────────────────────────────
// Întoarce operațiile cu operanzii lor și pozițiile în octeți: start (primul
// operand sau operatorul), opStart (operatorul), end (după operator).
const WS = new Uint8Array(256);
for (const c of [0, 9, 10, 12, 13, 32]) WS[c] = 1;
const DELIM = new Uint8Array(256);
for (const ch of '()<>[]{}/%') DELIM[ch.charCodeAt(0)] = 1;
const latin1 = (b, s, e) => { let t = ''; for (let i = s; i < e; i++) t += String.fromCharCode(b[i]); return t; };
const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)$/;
const INLINE_KEYS = { W: 'Width', H: 'Height', IM: 'ImageMask', BPC: 'BitsPerComponent', CS: 'ColorSpace', F: 'Filter', D: 'Decode', DP: 'DecodeParms', I: 'Interpolate', L: 'Length' };

function lexContent(b) {
  const n = b.length;
  const ops = [];
  let args = [];
  let argStart = -1;
  const stack = [];
  let i = 0;
  const push = (v, s) => {
    if (stack.length) { stack[stack.length - 1].items.push(v); return; }
    if (argStart < 0) argStart = s;
    args.push(v);
  };
  while (i < n) {
    const c = b[i];
    if (WS[c]) { i++; continue; }
    if (c === 0x25) { while (i < n && b[i] !== 10 && b[i] !== 13) i++; continue; }      // % comentariu
    const s = i;
    if (c === 0x2F) {                                                                     // /Nume
      i++;
      let name = '';
      while (i < n && !WS[b[i]] && !DELIM[b[i]]) {
        if (b[i] === 0x23 && i + 2 < n) {
          const h = parseInt(String.fromCharCode(b[i + 1], b[i + 2]), 16);
          if (!Number.isNaN(h)) { name += String.fromCharCode(h); i += 3; continue; }
        }
        name += String.fromCharCode(b[i]); i++;
      }
      push({ t: 'name', v: name }, s);
      continue;
    }
    if (c === 0x28) {                                                                     // (șir)
      let depth = 1; i++;
      while (i < n && depth > 0) {
        const d = b[i];
        if (d === 0x5C) { i += 2; continue; }
        if (d === 0x28) depth++;
        else if (d === 0x29) depth--;
        i++;
      }
      push({ t: 'str' }, s);
      continue;
    }
    if (c === 0x3C) {
      if (b[i + 1] === 0x3C) { stack.push({ items: [], start: s, kind: 'dict' }); i += 2; continue; }
      i++;
      while (i < n && b[i] !== 0x3E) i++;
      i++;
      push({ t: 'hex' }, s);
      continue;
    }
    if (c === 0x3E) {
      i += b[i + 1] === 0x3E ? 2 : 1;
      const top = stack.pop();
      if (top) push({ t: 'dict', items: top.items }, top.start);
      continue;
    }
    if (c === 0x5B) { stack.push({ items: [], start: s, kind: 'arr' }); i++; continue; }
    if (c === 0x5D) { i++; const top = stack.pop(); if (top) push({ t: 'arr', items: top.items }, top.start); continue; }
    if (c === 0x7B || c === 0x7D || c === 0x29) { i++; continue; }
    while (i < n && !WS[b[i]] && !DELIM[b[i]]) i++;
    const tok = latin1(b, s, i);
    if (NUM_RE.test(tok)) { push({ t: 'num', v: parseFloat(tok) }, s); continue; }
    if (tok === 'true' || tok === 'false') { push({ t: 'bool', v: tok === 'true' }, s); continue; }
    if (tok === 'null') { push({ t: 'null' }, s); continue; }
    if (stack.length) { stack[stack.length - 1].items.push({ t: 'kw', v: tok }); continue; }
    if (tok === 'BI') {
      const r = readInlineImage(b, i);
      ops.push({ op: 'BI', args: [], start: s, opStart: s, end: r.end, inline: r.dict, ok: r.ok });
      i = r.end;
      args = []; argStart = -1;
      continue;
    }
    ops.push({ op: tok, args, start: argStart >= 0 ? argStart : s, opStart: s, end: i });
    args = []; argStart = -1;
  }
  return ops;
}

// BI … ID <date> EI — dicționarul imaginii inline și sfârșitul datelor
function readInlineImage(b, from) {
  const n = b.length;
  const dict = {};
  let i = from;
  let key = null;
  const sub = [];
  // dicționarul: perechi /Cheie valoare până la ID
  while (i < n) {
    while (i < n && WS[b[i]]) i++;
    if (i >= n) break;
    if (b[i] === 0x49 && b[i + 1] === 0x44 && (i + 2 >= n || WS[b[i + 2]])) { i += 2; break; }   // ID
    const s = i;
    // o valoare simplă (nume, număr, cuvânt, tablou scurt)
    if (b[i] === 0x2F) {
      i++; while (i < n && !WS[b[i]] && !DELIM[b[i]]) i++;
      const name = latin1(b, s + 1, i);
      if (key == null) key = name; else { dict[INLINE_KEYS[key] || key] = { t: 'name', v: name }; key = null; }
      continue;
    }
    if (b[i] === 0x5B) {
      let depth = 0;
      while (i < n) { if (b[i] === 0x5B) depth++; else if (b[i] === 0x5D) { depth--; if (!depth) { i++; break; } } i++; }
      if (key != null) { dict[INLINE_KEYS[key] || key] = { t: 'arr', raw: latin1(b, s, i) }; key = null; }
      continue;
    }
    if (b[i] === 0x3C && b[i + 1] === 0x3C) {
      let depth = 0;
      while (i < n) { if (b[i] === 0x3C && b[i + 1] === 0x3C) { depth++; i += 2; continue; } if (b[i] === 0x3E && b[i + 1] === 0x3E) { depth--; i += 2; if (!depth) break; continue; } i++; }
      if (key != null) { dict[INLINE_KEYS[key] || key] = { t: 'dict' }; key = null; }
      continue;
    }
    while (i < n && !WS[b[i]] && !DELIM[b[i]]) i++;
    if (i === s) { i++; continue; }
    const tok = latin1(b, s, i);
    if (key != null) {
      dict[INLINE_KEYS[key] || key] = NUM_RE.test(tok) ? { t: 'num', v: parseFloat(tok) } : (tok === 'true' || tok === 'false') ? { t: 'bool', v: tok === 'true' } : { t: 'kw', v: tok };
      key = null;
    }
    sub.push(tok);
  }
  // datele: un singur spațiu după ID, apoi până la „EI" despărțit de spații
  const dataStart = i < n && WS[b[i]] ? i + 1 : i;
  let j = dataStart;
  // lungimea, dacă se poate calcula (fără filtru): sare peste datele binare
  const num = (k) => (dict[k] && dict[k].t === 'num' ? dict[k].v : null);
  const w = num('Width'), h = num('Height');
  const im = dict.ImageMask && dict.ImageMask.v === true;
  const bpc = im ? 1 : num('BitsPerComponent');
  const cs = dict.ColorSpace && dict.ColorSpace.v;
  const comps = im ? 1 : ({ DeviceGray: 1, G: 1, DeviceRGB: 3, RGB: 3, DeviceCMYK: 4, CMYK: 4, Indexed: 1, I: 1 })[cs] || null;
  if (!dict.Filter && w && h && bpc && comps) {
    const len = h * Math.ceil((w * comps * bpc) / 8);
    if (dataStart + len <= n) j = dataStart + len;
  }
  let end = -1;
  for (; j + 1 < n; j++) {
    if (b[j] === 0x45 && b[j + 1] === 0x49 && (j === 0 || WS[b[j - 1]] || j === dataStart) && (j + 2 >= n || WS[b[j + 2]] || DELIM[b[j + 2]])) { end = j + 2; break; }
  }
  if (end < 0) return { dict, end: n, ok: false };
  return { dict, end, ok: true };
}

// ─── culori ─────────────────────────────────────────────────────────────────
const lumRGB = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;
const lumCMYK = (c, m, y, k) => lumRGB((1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k));
const nums = (args) => args.filter((a) => a.t === 'num').map((a) => a.v);
function lumOf(kind, v) {
  if (!v || !v.length) return null;
  if (kind === 'gray') return v[0];
  if (kind === 'rgb' && v.length >= 3) return lumRGB(v[0], v[1], v[2]);
  if (kind === 'cmyk' && v.length >= 4) return lumCMYK(v[0], v[1], v[2], v[3]);
  if (kind === 'sep') return 1 - v[0];                 // nuanța unei cerneli: 1 = plin
  if (kind === 'lab') return v[0] / 100;
  return null;                                          // necunoscut (Pattern, Indexed, DeviceN…)
}

// felul spațiului de culoare (cs / CS): după nume sau după resursa /ColorSpace
function csKind(name, res) {
  const direct = { DeviceGray: 'gray', CalGray: 'gray', G: 'gray', DeviceRGB: 'rgb', CalRGB: 'rgb', RGB: 'rgb', DeviceCMYK: 'cmyk', CMYK: 'cmyk', Pattern: 'pattern' };
  if (direct[name]) return direct[name];
  try {
    const cs = res && res.colorSpaces ? res.colorSpaces.get(name) : null;
    if (!cs || cs.isNull()) return 'unknown';
    const o = cs.resolve();
    if (o.isName()) return direct[o.asName()] || 'unknown';
    if (o.isArray() && o.length) {
      const fam = o.get(0).asName();
      if (fam === 'ICCBased') {
        const nn = o.get(1).resolve().get('N');
        const k = nn.isNull() ? 0 : nn.asNumber();
        return k === 1 ? 'gray' : k === 3 ? 'rgb' : k === 4 ? 'cmyk' : 'unknown';
      }
      if (fam === 'CalGray') return 'gray';
      if (fam === 'CalRGB') return 'rgb';
      if (fam === 'Separation') return 'sep';
      if (fam === 'Lab') return 'lab';
      if (fam === 'Pattern') return 'pattern';
    }
  } catch { /* necunoscut */ }
  return 'unknown';
}
const initialColor = (kind) => (kind === 'cmyk' ? [0, 0, 0, 1] : kind === 'rgb' ? [0, 0, 0] : kind === 'lab' ? [0, 0, 0] : kind === 'sep' ? [1] : [0]);

// ─── resursele (XObject, ColorSpace) ─────────────────────────────────────────
function resourcesOf(resObj) {
  const out = { obj: resObj, xobjects: null, colorSpaces: null };
  if (!resObj || resObj.isNull()) return out;
  const r = resObj.resolve();
  const x = r.get('XObject'); if (!x.isNull()) out.xobjects = x.resolve();
  const c = r.get('ColorSpace'); if (!c.isNull()) out.colorSpaces = c.resolve();
  return out;
}
function xobjectInfo(res, name) {
  if (!res || !res.xobjects) return null;
  const ref = res.xobjects.get(name);
  if (!ref || ref.isNull()) return null;
  const o = ref.resolve();
  const st = o.get('Subtype');
  const sub = st.isNull() ? null : st.asName();
  const num = (k) => { const v = o.get(k); return v.isNull() ? null : v.asNumber(); };
  const im = o.get('ImageMask');
  const filter = o.get('Filter');
  let filters = [];
  if (!filter.isNull()) {
    const f = filter.resolve();
    if (f.isName()) filters = [f.asName()];
    else if (f.isArray()) for (let k = 0; k < f.length; k++) filters.push(f.get(k).asName());
  }
  return {
    ref, obj: o, sub, num: ref.isIndirect() ? ref.asIndirect() : null,
    w: num('Width'), h: num('Height'), bpc: num('BitsPerComponent'),
    mask: !im.isNull() && im.asBoolean(), filters,
  };
}

// ─── interpretarea: fiecare operație de pictare, cu dreptunghiul ei (pe pagină) ─
// streamId: 'page' (conținutul paginii) sau numărul obiectului formularului.
function interpret(bytes, { ctm, res, streamId = 'page', depth = 0, items = [], seen = new Set(), via = null, pageRes = null } = {}) {
  const ops = lexContent(bytes);
  let gs = { ctm, fill: 0, stroke: 0, fillKind: 'gray', strokeKind: 'gray', lw: 1 };
  const stack = [];
  let path = null;
  const P = (x, y) => apply(gs.ctm, x, y);
  const newSub = (start) => { const sub = { start, end: start, bbox: emptyBox() }; path.subs.push(sub); return sub; };
  const ensurePath = () => { if (!path) path = { subs: [], bbox: emptyBox(), clip: false }; return path; };
  for (const o of ops) {
    const a = o.args;
    switch (o.op) {
      case 'q': stack.push(gs); gs = { ...gs }; break;
      case 'Q': if (stack.length) gs = stack.pop(); break;
      case 'cm': { const v = nums(a); if (v.length === 6) gs.ctm = mul(v, gs.ctm); break; }
      case 'w': { const v = nums(a); if (v.length) gs.lw = v[0]; break; }
      case 'g': gs.fillKind = 'gray'; gs.fill = lumOf('gray', nums(a)); break;
      case 'G': gs.strokeKind = 'gray'; gs.stroke = lumOf('gray', nums(a)); break;
      case 'rg': gs.fillKind = 'rgb'; gs.fill = lumOf('rgb', nums(a)); break;
      case 'RG': gs.strokeKind = 'rgb'; gs.stroke = lumOf('rgb', nums(a)); break;
      case 'k': gs.fillKind = 'cmyk'; gs.fill = lumOf('cmyk', nums(a)); break;
      case 'K': gs.strokeKind = 'cmyk'; gs.stroke = lumOf('cmyk', nums(a)); break;
      case 'cs': { const nm = a.find((x) => x.t === 'name'); gs.fillKind = csKind(nm && nm.v, res); gs.fill = lumOf(gs.fillKind, initialColor(gs.fillKind)); break; }
      case 'CS': { const nm = a.find((x) => x.t === 'name'); gs.strokeKind = csKind(nm && nm.v, res); gs.stroke = lumOf(gs.strokeKind, initialColor(gs.strokeKind)); break; }
      case 'sc': case 'scn': gs.fill = lumOf(gs.fillKind, nums(a)); break;
      case 'SC': case 'SCN': gs.stroke = lumOf(gs.strokeKind, nums(a)); break;
      case 'm': { ensurePath(); const v = nums(a); const sub = newSub(o.start); if (v.length >= 2) { const p = P(v[0], v[1]); addPt(sub.bbox, p); addPt(path.bbox, p); } sub.end = o.end; break; }
      case 'l': case 'c': case 'v': case 'y': {
        ensurePath();
        const sub = path.subs[path.subs.length - 1] || newSub(o.start);
        const v = nums(a);
        for (let k = 0; k + 1 < v.length; k += 2) { const p = P(v[k], v[k + 1]); addPt(sub.bbox, p); addPt(path.bbox, p); }
        sub.end = o.end;
        break;
      }
      case 're': {
        ensurePath();
        const v = nums(a);
        const sub = newSub(o.start);
        if (v.length >= 4) for (const [x, y] of [[v[0], v[1]], [v[0] + v[2], v[1]], [v[0], v[1] + v[3]], [v[0] + v[2], v[1] + v[3]]]) { const p = P(x, y); addPt(sub.bbox, p); addPt(path.bbox, p); }
        sub.end = o.end;
        break;
      }
      case 'h': if (path && path.subs.length) path.subs[path.subs.length - 1].end = o.end; break;
      case 'W': case 'W*': ensurePath().clip = true; break;
      case 'n': path = null; break;
      case 'f': case 'F': case 'f*': case 'S': case 's': case 'B': case 'B*': case 'b': case 'b*': {
        if (path && path.subs.length) {
          const fills = o.op !== 'S' && o.op !== 's';
          const strokes = /^(S|s|B|B\*|b|b\*)$/.test(o.op);
          // un contur iese din drum cu jumătate din grosimea liniei (colțurile, ceva mai mult);
          // o linie de grosime 0 se desenează cu 1 pixel → măcar 0,5 pt
          const half = strokes ? Math.max(0.5, Math.abs(gs.lw || 0) * Math.sqrt(Math.abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])) * 0.75) : 0;
          items.push({
            kind: 'path', op: o.op, streamId, depth, via, opStart: o.opStart, opEnd: o.end, bbox: grow(path.bbox, half), ctm: gs.ctm.slice(),
            subs: path.subs.map((s) => ({ start: s.start, end: s.end, bbox: grow(s.bbox, half) })), clip: path.clip,
            lum: Math.min(fills ? (gs.fill == null ? -1 : gs.fill) : 2, strokes ? (gs.stroke == null ? -1 : gs.stroke) : 2),
          });
        }
        path = null;
        break;
      }
      case 'Do': {
        const nm = a.find((x) => x.t === 'name');
        const info = nm ? xobjectInfo(res, nm.v) : null;
        if (!info) break;
        if (info.sub === 'Image') {
          items.push({ kind: info.mask ? 'mask' : 'image', name: nm.v, streamId, depth, via, start: o.start, end: o.end, bbox: unitBox(gs.ctm), ctm: gs.ctm.slice(), info, lum: info.mask ? (gs.fill == null ? -1 : gs.fill) : null, res: res && res.obj });
        } else if (info.sub === 'Form' && depth < 4 && !(info.num != null && seen.has(info.num))) {
          const fo = info.obj;
          const mv = fo.get('Matrix');
          let m = [1, 0, 0, 1, 0, 0];
          if (!mv.isNull() && mv.isArray() && mv.length === 6) { m = []; for (let k = 0; k < 6; k++) m.push(mv.get(k).asNumber()); }
          const fctm = mul(m, gs.ctm);
          const bb = fo.get('BBox');
          let fbox = emptyBox();
          if (!bb.isNull() && bb.isArray() && bb.length === 4) {
            const v = []; for (let k = 0; k < 4; k++) v.push(bb.get(k).asNumber());
            for (const [x, y] of [[v[0], v[1]], [v[2], v[1]], [v[0], v[3]], [v[2], v[3]]]) addPt(fbox, apply(fctm, x, y));
          }
          const formItem = { kind: 'form', name: nm.v, streamId, depth, via, start: o.start, end: o.end, bbox: fbox, ctm: fctm, ctmAtDo: gs.ctm.slice(), info, res: res && res.obj, children: [] };
          items.push(formItem);
          let fbytes = null;
          try { fbytes = streamBytes(info.ref.isIndirect() ? info.ref : fo); } catch { fbytes = null; noteErr(); }
          if (fbytes) {
            const fres = fo.get('Resources');
            const nseen = new Set(seen); if (info.num != null) nseen.add(info.num);
            const before = items.length;
            interpret(fbytes, { ctm: fctm, res: fres.isNull() ? res : resourcesOf(fres), streamId: info.num != null ? `obj${info.num}` : `form:${nm.v}`, depth: depth + 1, items, seen: nseen, via: formItem, pageRes });
            formItem.children = items.slice(before);
            formItem.bytes = fbytes;
          }
        }
        break;
      }
      case 'BI': {
        const d = o.inline || {};
        const im = d.ImageMask && d.ImageMask.v === true;
        items.push({ kind: im ? 'inline-mask' : 'inline', streamId, depth, via, start: o.start, end: o.end, bbox: unitBox(gs.ctm), ctm: gs.ctm.slice(), lum: im ? (gs.fill == null ? -1 : gs.fill) : null, ok: o.ok });
        break;
      }
      default: break;
    }
  }
  return items;
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

// ─── planul: ce scoatem ──────────────────────────────────────────────────────
// Un element care cade în întregime în dreptunghi (+ ramă) și nu e alb ține de
// dreptunghi sau e ascuns sub el → afară (ce e alb rămâne: nu se vede). La fel
// „straturile" dreptunghiului puțin mai mari decât el (umbra, chenarul — ca în
// simulările de la Constanța): cel mult 10 pt în afară, cel puțin jumătate din
// el pe fiecare latură și ≥ 80% din suprafața lor în dreptunghi.
// Imaginile / formularele mari care acoperă dreptunghiul (pagina scanată) nu se
// ating: sunt „acoperitorii" — dacă după scoatere zona rămâne neagră, peste
// ultimul dintre ei se pune un dreptunghi alb.
const NOT_WHITE = (lum) => lum == null || lum < 0 || lum < 0.99;
function partOfBox(bb, R, Rm, Rx) {
  if (inside(bb, Rm)) return true;
  if (!inside(bb, Rx)) return false;
  const w = bb[2] - bb[0], h = bb[3] - bb[1], RW = R[2] - R[0], RH = R[3] - R[1];
  if (w >= 0.5 * RW && h >= 0.5 * RH && overlap(bb, R) >= 0.8 * area(bb)) return true;   // umbra, un al doilea strat
  return (w >= 0.8 * RW && h <= 3) || (h >= 0.8 * RH && w <= 3);                          // o latură a chenarului
}
function plan(items, R, opt = OPT) {
  const Rm = grow(R, opt.margin);
  const Rx = grow(R, opt.ext);
  const edits = [];       // { streamId, start, end, text, why, via, item }
  const kinds = { vector: 0, subpaths: 0, image: 0, mask: 0, inline: 0, form: 0, overlay: 0 };
  const covers = [];      // elementele de pe pagină care acoperă dreptunghiul (în ordinea desenării)
  const visit = (list) => {
    for (const it of list) {
      if (it.kind === 'form') {
        if (partOfBox(it.bbox, R, Rm, Rx)) { edits.push({ streamId: it.streamId, start: it.start, end: it.end, text: ' ', why: 'form', via: it.via, item: it }); kinds.form++; continue; }
        if (!it.via && overlap(it.bbox, R) >= 0.5 * area(R)) covers.push(it);
        // în interiorul unui formular desenat direct de pagină (nu și mai adânc:
        // un formular din formular se scoate doar întreg)
        if (it.depth === 0 && overlap(it.bbox, R) > 0) visit(it.children.filter((c) => c.via === it));
        continue;
      }
      if (it.kind === 'path') {
        if (!NOT_WHITE(it.lum)) continue;
        if (partOfBox(it.bbox, R, Rm, Rx)) { edits.push({ streamId: it.streamId, start: it.opStart, end: it.opEnd, text: 'n', why: 'path', via: it.via, item: it }); kinds.vector++; continue; }
        const inner = it.subs.filter((s) => inside(s.bbox, Rm));
        if (inner.length && inner.length < it.subs.length && overlap(it.bbox, R) > 0) {
          for (const s of inner) edits.push({ streamId: it.streamId, start: s.start, end: s.end, text: ' ', why: 'subpath', via: it.via, item: { ...it, bbox: s.bbox, sub: s } });
          kinds.subpaths += inner.length;
        }
        continue;
      }
      if (it.kind === 'image' || it.kind === 'mask' || it.kind === 'inline' || it.kind === 'inline-mask') {
        const isMask = it.kind === 'mask' || it.kind === 'inline-mask';
        if (isMask && !NOT_WHITE(it.lum)) continue;
        if (partOfBox(it.bbox, R, Rm, Rx)) {
          edits.push({ streamId: it.streamId, start: it.start, end: it.end, text: ' ', why: it.kind, via: it.via, item: it });
          if (it.kind === 'image') kinds.image++; else if (it.kind === 'mask') kinds.mask++; else kinds.inline++;
          continue;
        }
        if (!it.via && overlap(it.bbox, R) >= 0.5 * area(R)) covers.push(it);   // imaginea paginii scanate (și măștile mari)
      }
    }
  };
  visit(items.filter((it) => !it.via));
  return { edits, kinds, covers, Rm, Rx };
}

// ─── aplicarea modificărilor pe octeți (scoateri, înlocuiri, inserări) ───────
function applyByteEdits(bytes, edits) {
  const list = edits.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const clean = [];
  let lastEnd = -1;
  for (const e of list) { if (e.start < lastEnd) continue; clean.push(e); lastEnd = e.end; }   // suprapuse: prima
  const parts = [];
  let pos = 0;
  for (const e of clean) {
    parts.push(bytes.subarray(pos, e.start));
    const t = new Uint8Array(e.text.length + 2);
    t[0] = 32; for (let k = 0; k < e.text.length; k++) t[k + 1] = e.text.charCodeAt(k) & 0xff; t[t.length - 1] = 32;
    parts.push(t);
    pos = e.end;
  }
  parts.push(bytes.subarray(pos));
  let total = 0; for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

// ─── memoria MuPDF ───────────────────────────────────────────────────────────
// Buffer-ele MuPDF (stream-urile citite, PDF-ul salvat, ce scriem în document)
// stau în memoria WebAssembly. Neeliberate explicit, se eliberează doar când
// trece GC-ul, iar la zeci de fișiere la rând memoria se umple și MuPDF cade
// („memory access out of bounds"). Le copiem în memoria JS și le eliberăm imediat.
function takeBytes(buf) {
  try { return (buf.asUint8Array ? buf.asUint8Array() : new Uint8Array(buf)).slice(); }
  finally { try { if (buf && buf.destroy) buf.destroy(); } catch { /* nimic */ } }
}
const streamBytes = (obj) => takeBytes(obj.readStream());

// Fiecare eroare MuPDF care ajunge în JavaScript (și o prindem) lasă în urmă
// ~70 de octeți din stiva WebAssembly a instanței (64 KB): după ~900 de erori
// instanța se strică („memory access out of bounds" / „malloc failed"). Le
// evităm (readStream() doar pe referința indirectă a unui stream — pe
// dicționarul rezolvat aruncă „object is not a stream") și le numărăm:
// rularea (pagina2Run.js) ia o instanță nouă înainte de prag.
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
  // copii (asUint8Array e o fereastră în memoria MuPDF, care se poate muta / elibera)
  const bufs = parts.map((p) => { try { return streamBytes(p); } catch { noteErr(); return new Uint8Array(0); } });
  let total = 0; for (const b of bufs) total += b.length + 1;
  const out = new Uint8Array(total);
  let off = 0;
  for (const b of bufs) { out.set(b, off); off += b.length; out[off++] = 10; }
  return out;
}

// resursele paginii 2, ale ei (copie) — ca să putem schimba o intrare /XObject
// fără să atingem paginile care împart același dicționar
function privateXObjects(doc, pageObj) {
  let res = pageObj.get('Resources');
  if (res.isNull()) res = pageObj.getInheritable('Resources');
  const copy = doc.newDictionary();
  if (!res.isNull()) res.resolve().forEach((v, k) => copy.put(k, v));
  const xo = copy.get('XObject');
  const xcopy = doc.newDictionary();
  if (!xo.isNull()) xo.resolve().forEach((v, k) => xcopy.put(k, v));
  copy.put('XObject', xcopy);
  pageObj.put('Resources', copy);
  return xcopy;
}

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
  }
  const pad = 1;
  const box = [(Rp[0] - out.left - pad) / s, (Rp[1] - out.top - pad) / s, (Rp[2] + out.right + pad) / s, (Rp[3] + out.bottom + pad) / s];
  return { box, sides: out, remnant };
}

// un număr pentru conținutul PDF: fără exponent, cu destule zecimale (matricea
// inversă a unei imagini de pagină are elemente de ordinul 0,001)
const fmt = (v) => {
  if (!Number.isFinite(v)) return '0';
  let t = v.toFixed(Math.abs(v) >= 1 ? 4 : 10);
  if (t.includes('.')) t = t.replace(/0+$/, '').replace(/\.$/, '');
  return t === '-0' ? '0' : t;
};

// un dreptunghi alb (în coordonatele paginii, pt de sus) desenat cu CTM-ul `ctm`
// valabil în acel loc din conținut: q <inversa> cm 1 g x y w h re f Q
function whiteRect(box, ctm) {
  const inv = invert(ctm);
  if (!inv) return null;
  return `q ${inv.map(fmt).join(' ')} cm 1 g ${fmt(box[0])} ${fmt(box[1])} ${fmt(box[2] - box[0])} ${fmt(box[3] - box[1])} re f Q`;
}

// „cerneală" (orice nu e alb) rămasă în dreptunghi, fără marginea de 1 pt
function inkFraction(r, R) {
  const inner = grow(R, -1);
  return darkFraction(r, inner, 230);
}

// pune în doc conținutul nou al paginii / formularelor (din modificările pe octeți)
function writeEdits(mupdf, doc, pageObj, pageBytes, edits, { pageOnly = false } = {}) {
  const pageEdits = edits.filter((e) => e.streamId === 'page');
  let pageRef = null;
  const formRefs = [];
  const formEdits = new Map();
  for (const e of edits) {
    if (e.streamId === 'page') continue;
    const f = e.via;
    if (!f || f.depth !== 0) throw Object.assign(new Error('dreptunghiul e într-un formular imbricat'), { nesigur: true });
    if (!formEdits.has(f)) formEdits.set(f, []);
    formEdits.get(f).push(e);
  }
  if (pageEdits.length) {
    pageRef = addStreamTo(mupdf, doc, applyByteEdits(pageBytes, pageEdits), doc.newDictionary());
    pageObj.put('Contents', pageRef);
  }
  if (formEdits.size && !pageOnly) {
    const xo = privateXObjects(doc, pageObj);
    for (const [f, list] of formEdits) {
      const dict = doc.newDictionary();
      f.info.obj.forEach((v, k) => { if (!['Length', 'Filter', 'DecodeParms', 'DL'].includes(String(k))) dict.put(k, v); });
      const ref = addStreamTo(mupdf, doc, applyByteEdits(f.bytes, list), dict);
      xo.put(f.name, ref);
      formRefs.push(ref);
    }
  }
  return { pageRef, formRefs };
}
// obiectele scrise de un pas anterior și înlocuite între timp (nu mai sunt folosite)
function dropObjects(doc, refs) {
  for (const r of refs) if (r) { try { doc.deleteObject(r); } catch { noteErr(); } }
}

// ─── curățarea paginii 2 ─────────────────────────────────────────────────────
// Întoarce { status, rect, kinds, bytes|null, check, notes }:
//   status: 'curatat' (bytes = PDF-ul nou) · 'fara' (pagina 2 n-are dreptunghiul)
//           · 'nesigur' (găsit, dar nu se poate scoate curat — nu se urcă nimic)
//           · 'eroare'
function cleanPage2(mupdf, input, options = {}) {
  const opt = { ...OPT, ...options };
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const out = { version: VERSION, status: 'fara', rect: null, kinds: null, bytes: null, check: null, notes: [], pages: 0 };
  let doc;
  try { doc = new mupdf.PDFDocument(bytes); } catch (e) { noteErr(); return { ...out, status: 'eroare', error: `PDF-ul nu se deschide: ${e.message}` }; }
  // paginile încărcate se eliberează înaintea documentului (ordinea contează în MuPDF)
  const loaded = [];
  const load = (d, i) => { const pg = d.loadPage(i); loaded.push(pg); return pg; };
  try {
    return run();
  } catch (e) {
    if (e && e.nesigur) return { ...out, status: 'nesigur', error: e.message };
    noteErr();
    return { ...out, status: 'eroare', error: e && e.message ? e.message : String(e) };
  } finally {
    for (const pg of loaded) { try { pg.destroy(); } catch { /* nimic */ } }
    try { doc.destroy(); } catch { /* memoria WebAssembly se eliberează oricum */ }
    // imaginile / fonturile decodate rămân în cache-ul MuPDF (până la 256 MB);
    // între fișiere nu folosesc la nimic → memoria rămâne mică la multe fișiere la rând
    try { if (mupdf.emptyStore) mupdf.emptyStore(); } catch { /* nimic */ }
  }
  function run() {
    if (doc.needsPassword && doc.needsPassword()) return { ...out, status: 'eroare', error: 'PDF protejat cu parolă' };
    out.pages = doc.countPages();
    if (out.pages <= opt.pageIndex) { out.notes.push('PDF-ul nu are pagina 2'); return out; }
    let page = load(doc, opt.pageIndex);
    const bounds = page.getBounds();
    const W = bounds[2] - bounds[0], H = bounds[3] - bounds[1];
    const before = renderGray(mupdf, page, opt.scale);
    const found = findDarkRect(before, W, H, opt);
    if (!found) return out;
    const R = found.rect;
    out.rect = R.map(round1);
    out.darkBefore = Math.round(found.dark * 1000) / 1000;

    // celelalte pagini, așa cum sunt acum (pentru verificare)
    const others = [];
    for (let i = 0; i < out.pages; i++) others.push(i === opt.pageIndex ? null : renderGray(mupdf, load(doc, i), opt.otherScale));

    // operațiile de desen ale paginii, cu pozițiile lor pe pagină
    const pageObj = page.getObject();
    const pageBytes = pageContentBytes(pageObj);
    let resObj = pageObj.get('Resources');
    if (resObj.isNull()) resObj = pageObj.getInheritable('Resources');
    const items = interpret(pageBytes, { ctm: page.getTransform(), res: resourcesOf(resObj) });
    const p = plan(items, R, opt);
    out.kinds = p.kinds;

    const uses = (name) => items.filter((it) => !it.via && (it.kind === 'form' || it.kind === 'image' || it.kind === 'mask') && it.name === name).length;
    for (const e of p.edits) if (e.via && e.via.depth === 0 && uses(e.via.name) > 1) return { ...out, status: 'nesigur', error: `formularul /${e.via.name} e folosit de mai multe ori pe pagină` };

    // 1) scoaterea a ce e în dreptunghi
    let edits = p.edits.slice();
    const editBoxes = edits.filter((e) => e.item).map((e) => e.item.bbox);   // tot ce se poate schimba pe pagină
    let written = edits.length ? writeEdits(mupdf, doc, pageObj, pageBytes, edits) : { pageRef: null, formRefs: [] };
    page = load(doc, opt.pageIndex);
    let mid = renderGray(mupdf, page, opt.scale);
    let residual = darkFraction(mid, R, opt.darkThr);

    // 1b) ce ascundea dreptunghiul rămâne ascuns: dacă după scoatere apare ceva în
    //     zona lui (un text, o linie desenate ÎNAINTE de dreptunghi), punem un
    //     dreptunghi alb exact unde începea cel negru (pe conturul pieselor scoase)
    if (edits.length && inkFraction(mid, R) > 0.002) {
      const removed = edits.filter((e) => e.item);
      // prima piesă scoasă, în ordinea desenării (pagina, apoi în formular);
      // dreptunghiul alb se desenează chiar înaintea ei, în același stream
      // (la un drum: înaintea întregului drum, nu în mijlocul lui)
      const startOf = (e) => (e.item.kind === 'path' ? e.item.subs[0].start : e.item.start);
      const keyOf = (e) => (e.streamId === 'page' ? [startOf(e), -1] : [e.via.start, startOf(e)]);
      const first = removed.reduce((a, e) => {
        const k = keyOf(e);
        return !a || k[0] < a.k[0] || (k[0] === a.k[0] && k[1] < a.k[1]) ? { k, e } : a;
      }, null).e;
      const U = emptyBox();
      for (const e of removed) { const b = e.item.bbox; addPt(U, [b[0], b[1]]); addPt(U, [b[2], b[3]]); }
      const box = [Math.max(U[0], p.Rx[0]), Math.max(U[1], p.Rx[1]), Math.min(U[2], p.Rx[2]), Math.min(U[3], p.Rx[3])];
      const ctm0 = first.item.kind === 'form' ? first.item.ctmAtDo : first.item.ctm;     // înaintea lui Do: fără /Matrix
      const text = ctm0 && !isEmpty(box) ? whiteRect(box, ctm0) : null;
      if (text) {
        editBoxes.push(box);
        const inForm = first.streamId !== 'page';
        const at = startOf(first);
        edits = [...edits, inForm ? { streamId: first.streamId, start: at, end: at, text, why: 'ascuns', via: first.via } : { streamId: 'page', start: at, end: at, text, why: 'ascuns' }];
        p.kinds.hidden = 1;
        const w2 = writeEdits(mupdf, doc, pageObj, pageBytes, edits, { pageOnly: !inForm });
        dropObjects(doc, [written.pageRef, ...(inForm ? written.formRefs : [])]);
        written = { pageRef: w2.pageRef, formRefs: inForm ? w2.formRefs : written.formRefs };
        page = load(doc, opt.pageIndex);
        mid = renderGray(mupdf, page, opt.scale);
        residual = darkFraction(mid, R, opt.darkThr);
      }
    }

    // 2) pagina scanată: dreptunghiul (cu chenarul / umbra lui) e în pixelii unei
    //    imagini → un dreptunghi alb peste el, imediat după imagine
    const fx = frameExtent(mid, R, opt);
    if (residual > opt.maxResidual || (fx.remnant && p.covers.length)) {
      const cover = p.covers.length ? p.covers[p.covers.length - 1] : null;
      if (!cover) return { ...out, status: 'nesigur', error: edits.length ? `după scoatere a rămas ${Math.round(residual * 100)}% negru în dreptunghi` : 'dreptunghiul se vede, dar nu l-am găsit în conținutul paginii' };
      const box = fx.box;
      editBoxes.push(box);
      const text = whiteRect(box, cover.kind === 'form' ? cover.ctmAtDo : cover.ctm);
      if (!text) return { ...out, status: 'nesigur', error: 'transformare degenerată' };
      edits = [...edits, { streamId: 'page', start: cover.end, end: cover.end, text, why: 'overlay' }];
      p.kinds.overlay++;
      out.overlay = box.map(round1);
      // conținutul paginii se rescrie din original, cu toate modificările odată
      // (formularele, dacă au fost, sunt deja scrise la pasul 1)
      writeEdits(mupdf, doc, pageObj, pageBytes, edits, { pageOnly: true });
      dropObjects(doc, [written.pageRef]);
    }

    const incremental = !!(doc.canBeSavedIncrementally && doc.canBeSavedIncrementally());
    const newBytes = takeBytes(doc.saveToBuffer(incremental ? 'incremental,compress' : 'compress'));
    out.incremental = incremental;

    // ✔ verificarea, pe fișierul nou (deschis din nou)
    if (fx.remnant && !p.kinds.overlay) out.notes.push('lângă dreptunghi a rămas un chenar subțire');
    const EB = emptyBox();
    for (const b of [R, ...editBoxes]) { addPt(EB, [b[0], b[1]]); addPt(EB, [b[2], b[3]]); }
    out.editBox = EB.map(round1);
    const check = verify(mupdf, newBytes, before, others, R, EB, opt);
    out.check = check;
    if (!check.ok) return { ...out, status: 'nesigur', error: check.why };
    return { ...out, status: 'curatat', bytes: newBytes };
  }
}

function verify(mupdf, newBytes, before, others, R, editBox, opt) {
  const res = { ok: false, why: null };
  let nd;
  try { nd = new mupdf.PDFDocument(newBytes); } catch (e) { noteErr(); res.why = `PDF-ul nou nu se deschide: ${e.message}`; return res; }
  const loaded = [];
  const load = (i) => { const pg = nd.loadPage(i); loaded.push(pg); return pg; };
  try { return verifyDoc(mupdf, load, res, before, others, R, editBox, opt, nd.countPages()); } finally {
    for (const pg of loaded) { try { pg.destroy(); } catch { /* nimic */ } }
    try { nd.destroy(); } catch { /* nimic */ }
  }
}
function verifyDoc(mupdf, load, res, before, others, R, editBox, opt, n) {
  res.pages = n;
  if (n !== others.length) { res.why = 'numărul de pagini s-a schimbat'; return res; }
  // pagina 2: dreptunghiul alb, restul identic
  const after = renderGray(mupdf, load(opt.pageIndex), opt.scale);
  if (after.w !== before.w || after.h !== before.h) { res.why = 'pagina 2 și-a schimbat mărimea'; return res; }
  res.darkAfter = Math.round(darkFraction(after, R, opt.darkThr) * 1000) / 1000;
  res.inkAfter = Math.round(inkFraction(after, R) * 1000) / 1000;
  // în afara a ce s-a scos / acoperit (+ 0,75 pt): identic, pixel cu pixel;
  // înăuntru: doar mai deschis (ce era negru s-a albit), niciodată mai închis
  const s = opt.scale;
  const E = grow(editBox, 0.75);
  const ex0 = Math.floor(E[0] * s), ey0 = Math.floor(E[1] * s), ex1 = Math.ceil(E[2] * s), ey1 = Math.ceil(E[3] * s);
  let diffOut = 0, maxOut = 0, darker = 0;
  for (let y = 0; y < after.h; y++) {
    const inY = y >= ey0 && y < ey1;
    for (let x = 0; x < after.w; x++) {
      const k = y * after.w + x;
      if (inY && x >= ex0 && x < ex1) { if (after.px[k] < before.px[k] - 32) darker++; continue; }
      const d = Math.abs(after.px[k] - before.px[k]);
      if (d > 0) { diffOut++; if (d > maxOut) maxOut = d; }
    }
  }
  res.diffOutside = diffOut;
  res.maxOutside = maxOut;
  res.darker = darker;
  if (res.darkAfter > opt.maxResidual) { res.why = `în dreptunghi a rămas ${Math.round(res.darkAfter * 100)}% negru`; return res; }
  if (diffOut > 0) { res.why = `s-au schimbat ${diffOut} pixeli în afara dreptunghiului`; return res; }
  if (darker > Math.max(8, 0.0002 * (ex1 - ex0) * (ey1 - ey0))) { res.why = `lângă dreptunghi au apărut ${darker} pixeli mai închiși`; return res; }
  // în jurul dreptunghiului s-au albit doar chenarul / umbra lui, nu o linie a paginii
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
      // (o linie ascunsă parțial sub dreptunghi care acum se vede întreagă e în regulă)
      if (changed && sideLine(before, Rp, side, d, extPx).beyond >= 0.2 && sideLine(after, Rp, side, d, extPx).cov < 0.5) { res.why = `s-a atins o linie a paginii lângă dreptunghi (${side}, ${Math.round(d / s * 10) / 10} pt)`; return res; }
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
  VERSION, OPT, cleanPage2, loadMupdf, isWasmCrash,
  mupdfErrors: () => ERR.n,
  // pentru teste
  _internals: { lexContent, interpret, findDarkRect, plan, applyByteEdits, renderGray, darkFraction, mul, apply, invert, unitBox, resourcesOf, pageContentBytes, verify, frameExtent, sideLine, writeEdits, whiteRect, inkFraction },
};
