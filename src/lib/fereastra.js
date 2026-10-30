// =====================================================================
// src/lib/fereastra.js — geometria ferestrei „✍️ Spațiu de lucru" (fără React;
// testată în test/fereastra-spatiu-lucru.test.js)
//
// Fereastra se mută și se redimensionează ca widgetul Profesorului Virtual:
// tragi de antet → se mută; tragi de o margine sau de un colț → crește /
// scade din partea aceea, iar marginea opusă stă pe loc. Rămâne mereu în
// ecran și cel puțin minW × minH.
//   geometrieFereastra(kind, start, dx, dy, scr, opt) → { x, y, w, h }
//     kind  = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
//     start = { x, y, w, h } la începutul tragerii; dx / dy = mișcarea
//     scr   = { w, h } ecranul; opt = { minW, minH, margin }
// =====================================================================

export const MIN_W = 320;
export const MIN_H = 300;

export function geometrieFereastra(kind, start, dx, dy, scr, { minW = MIN_W, minH = MIN_H, margin = 0 } = {}) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const maxW = Math.max(minW, scr.w - 2 * margin), maxH = Math.max(minH, scr.h - 2 * margin);
  let { x, y, w, h } = start;
  if (kind === 'move') {
    x = clamp(start.x + dx, margin, Math.max(margin, scr.w - margin - w));
    y = clamp(start.y + dy, margin, Math.max(margin, scr.h - margin - h));
    return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
  }
  if (kind.includes('e')) w = clamp(start.w + dx, minW, Math.min(maxW, scr.w - margin - start.x));
  if (kind.includes('s')) h = clamp(start.h + dy, minH, Math.min(maxH, scr.h - margin - start.y));
  if (kind.includes('w')) {
    const right = start.x + start.w;
    w = clamp(start.w - dx, minW, Math.min(maxW, right - margin));
    x = right - w;
  }
  if (kind.includes('n')) {
    const bottom = start.y + start.h;
    h = clamp(start.h - dy, minH, Math.min(maxH, bottom - margin));
    y = bottom - h;
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) };
}
