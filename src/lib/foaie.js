// =====================================================================
// src/lib/foaie.js — geometria foii din „✍️ Spațiu de lucru" și imaginea ei
// pentru corector (fără React; testată în test/spatiu-de-lucru.test.js)
//
// Traseele au coordonate de „lume": px CSS de la colțul din stânga-sus al
// foii. Foaia nu are margini: elevul scrie mai departe în dreapta cât vrea.
//   pathD(pts)        → atributul `d` al unui <path> SVG (curbe netede)
//   planTiles(W, H)   → cum se taie scrisul în bucăți („dale") pentru model
//   exportSheet(st)   → { images, thumb, grid, size } — imaginile foii (canvas)
// =====================================================================

export const PEN_W = 2.4;

// Imaginea pentru corector: dale de cel mult 2000 × 1800 px, la mărimea reală a
// scrisului — un model de vedere le citește fără să le micșoreze (Claude: până
// la 2576 px pe latura lungă, ~4800 de tokeni pe imagine). O foaie foarte lată
// (s-a scris mult spre dreapta) se taie în mai multe dale, suprapuse puțin, ca
// un rând tăiat la margine să apară întreg măcar într-una. Peste MAX_TILES
// dale, scrisul se micșorează treptat (până la 40%).
export const EXP_PAD = 24;
export const TILE_W = 2000;
export const TILE_H = 1800;
export const TILE_OVER = 80;
export const MAX_TILES = 6;

export function boxOf(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
export function unionBox(boxes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of boxes) {
    if (!b) continue;
    if (b.x0 < x0) x0 = b.x0; if (b.y0 < y0) y0 = b.y0;
    if (b.x1 > x1) x1 = b.x1; if (b.y1 > y1) y1 = b.y1;
  }
  return x0 === Infinity ? null : { x0, y0, x1, y1 };
}
export const strokeBox = (s) => s.box || (s.box = boxOf(s.pts));

// Traseu neted (aceleași curbe ca la creionul din testele interactive):
// SVG pentru foaie, canvas pentru imaginea trimisă corectorului.
const r1 = (n) => Math.round(n * 10) / 10;
export function pathD(pts) {
  if (!pts || !pts.length) return '';
  if (pts.length === 1) return `M${r1(pts[0][0])} ${r1(pts[0][1])}l0.01 0`;   // un punct (capăt rotund)
  let d = `M${r1(pts[0][0])} ${r1(pts[0][1])}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    d += `Q${r1(pts[i][0])} ${r1(pts[i][1])} ${r1(mx)} ${r1(my)}`;
  }
  const L = pts[pts.length - 1];
  return d + `L${r1(L[0])} ${r1(L[1])}`;
}
function canvasPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const L = pts[pts.length - 1];
  ctx.lineTo(L[0], L[1]);
}
export function drawStrokes(ctx, strokes, view, width) {
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const s of strokes) {
    const b = strokeBox(s);
    if (view && (b.x1 < view.x0 - 8 || b.x0 > view.x1 + 8 || b.y1 < view.y0 - 8 || b.y0 > view.y1 + 8)) continue;
    if (s.pts.length < 2) {
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(s.pts[0][0], s.pts[0][1], width / 1.6, 0, 6.2832); ctx.fill();
      continue;
    }
    ctx.strokeStyle = s.color; ctx.lineWidth = width;
    canvasPath(ctx, s.pts); ctx.stroke();
  }
}

// W×H = mărimea scrisului (px de foaie). Întoarce scara și dreptunghiurile
// dalelor (în px de imagine), în ordinea PAGINILOR: coloana din stânga de sus
// în jos, apoi următoarea — așa cum avansează elevul pe foaie.
export function planTiles(W, H, { tileW = TILE_W, tileH = TILE_H, over = TILE_OVER, maxTiles = MAX_TILES } = {}) {
  const count = (s) => {
    const w = W * s, h = H * s;
    const c = w <= tileW ? 1 : Math.ceil((w - over) / (tileW - over));
    const r = h <= tileH ? 1 : Math.ceil((h - over) / (tileH - over));
    return [c, r];
  };
  let scale = 1;
  let [cols, rows] = count(scale);
  while (cols * rows > maxTiles && scale > 0.4) {
    scale = Math.round((scale - 0.1) * 100) / 100;
    [cols, rows] = count(scale);
  }
  const fullW = Math.max(1, Math.ceil(W * scale)), fullH = Math.max(1, Math.ceil(H * scale));
  const tw = cols > 1 ? tileW : fullW, th = rows > 1 ? tileH : fullH;
  // dalele se întind egal pe toată lățimea/înălțimea (suprapunerea ≥ `over`)
  const stepX = cols > 1 ? (fullW - tw) / (cols - 1) : 0;
  const stepY = rows > 1 ? (fullH - th) / (rows - 1) : 0;
  const tiles = [];
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      tiles.push({ col: c + 1, row: r + 1, x: Math.round(c * stepX), y: Math.round(r * stepY), w: tw, h: th });
    }
  }
  return { scale, cols, rows, tiles: tiles.slice(0, maxTiles), truncated: tiles.length > maxTiles };
}

// Golurile mari pe orizontală (paginile goale dintre scrisuri, „➕ Pagină nouă")
// se strâng în imagine la GAP_KEEP px: corectorul primește scrisul compact, în
// aceeași ordine de la stânga la dreapta, fără zeci de centimetri de alb.
// Întoarce traseele mutate (copii) — foaia elevului rămâne neatinsă.
export const GAP_MIN = 140, GAP_KEEP = 70;
export function compactGaps(strokes, { min = GAP_MIN, keep = GAP_KEEP } = {}) {
  const items = strokes.map((s) => ({ s, b: strokeBox(s) })).sort((a, b) => a.b.x0 - b.b.x0);
  // benzile verticale ocupate de scris (traseele care se ating pe x se unesc)
  const bands = [];
  for (const it of items) {
    const last = bands[bands.length - 1];
    if (last && it.b.x0 <= last.x1 + min) last.x1 = Math.max(last.x1, it.b.x1);
    else bands.push({ x0: it.b.x0, x1: it.b.x1 });
  }
  if (bands.length < 2) return strokes;
  const shift = [0];
  for (let i = 1; i < bands.length; i++) shift.push(shift[i - 1] + (bands[i].x0 - bands[i - 1].x1 - keep));
  const out = [];
  for (const it of items) {
    let k = 0;
    while (k + 1 < bands.length && it.b.x0 >= bands[k + 1].x0) k++;
    const dx = shift[k];
    if (!dx) { out.push(it.s); continue; }
    out.push({ ...it.s, pts: it.s.pts.map(([x, y]) => [x - dx, y]), box: { x0: it.b.x0 - dx, y0: it.b.y0, x1: it.b.x1 - dx, y1: it.b.y1 } });
  }
  return out;
}

// Foaia → imaginile pentru corector + miniatura din conversație (≤ 16 KB,
// cât păstrează serverul în metadata.image). null = nimic de trimis.
export function exportSheet(strokes) {
  const raw = (strokes || []).filter((s) => s && Array.isArray(s.pts) && s.pts.length);
  if (!raw.length || typeof document === 'undefined') return null;
  const list = compactGaps(raw);
  const bb = unionBox(list.map(strokeBox));
  // un punct rătăcit, singur pe foaie, nu e o rezolvare
  if (!bb || (list.length < 2 && bb.x1 - bb.x0 < 8 && bb.y1 - bb.y0 < 8)) return null;
  const x0 = Math.max(0, bb.x0 - EXP_PAD), y0 = Math.max(0, bb.y0 - EXP_PAD);
  const W = bb.x1 + EXP_PAD - x0, H = bb.y1 + EXP_PAD - y0;
  const plan = planTiles(W, H);
  const lw = Math.max(PEN_W * 1.1, 2 / plan.scale);
  const canvases = plan.tiles.map((t) => {
    const cv = document.createElement('canvas');
    cv.width = t.w; cv.height = t.h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, t.w, t.h);
    ctx.setTransform(plan.scale, 0, 0, plan.scale, -t.x - x0 * plan.scale, -t.y - y0 * plan.scale);
    const view = {
      x0: x0 + t.x / plan.scale, y0: y0 + t.y / plan.scale,
      x1: x0 + (t.x + t.w) / plan.scale, y1: y0 + (t.y + t.h) / plan.scale,
    };
    drawStrokes(ctx, list, view, lw);
    return cv;
  });
  // PNG (scrisul rămâne clar); o foaie foarte încărcată → JPEG de calitate,
  // ca toată cererea să rămână sub limita serverului (~4 MB)
  let images = canvases.map((cv) => cv.toDataURL('image/png'));
  if (images.some((u) => u.length > 1_400_000) || images.reduce((n, u) => n + u.length, 0) > 3_500_000) {
    images = canvases.map((cv) => cv.toDataURL('image/jpeg', 0.88));
  }
  let thumb = null;
  for (const [max, q] of [[220, 0.72], [160, 0.6], [110, 0.5]]) {
    const s = Math.min(1, max / Math.max(W, H));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(W * s)); cv.height = Math.max(1, Math.round(H * s));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
    drawStrokes(ctx, list, null, Math.max(PEN_W, 1.4 / s));
    thumb = cv.toDataURL('image/jpeg', q);
    if (thumb.length <= 16000) break;
    thumb = null;
  }
  return {
    images, thumb,
    grid: { cols: plan.cols, rows: plan.rows, truncated: plan.truncated },
    size: { w: Math.round(W), h: Math.round(H) },
  };
}
