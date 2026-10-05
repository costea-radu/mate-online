// =====================================================================
// src/lib/live/framing.js — „CAMERA" care filmează clasa (încadrarea scenei)
//
// Pe un ecran lat se văd deodată tabla (scrisul profesorului), profesorul și
// proiecția (exercițiul). Pe telefon nu încap toate citibil, așa că „camera"
// se mută (panoramare lină) între:
//   · „tabla"    — explicația scrisă pe tabla din spatele profesorului (cu el alături);
//   · „ecran"    — exercițiul, proiectat pe partea dreaptă a tablei;
//   · „profesor" — planul mediu obișnuit (salut, întrebări, pauze).
// Totul se calculează în pixelii fotografiei (rig.width × rig.height); funcțiile
// sunt pure (testate în test/meditatii-live-client.test.js).
// =====================================================================
export const BOARD_W = 1000;      // lățimea „logică" a tablei (px), înainte de perspectivă
export const SCREEN_W = 960;      // lățimea „logică" a proiecției
const BOARD_FONT = 64;            // mărimea scrisului pe tablă, în pixelii logici (live.css)
const SCREEN_FONT = 36;           // mărimea textului proiectat
const MIN_BOARD_PX = 13;          // sub atât (pe ecran), scrisul de pe tablă nu mai e citibil
const MIN_SCREEN_PX = 12.5;       // idem, textul proiectat

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const dims = (rig) => ({ W: rig?.width || 1600, H: rig?.height || 900 });

// patrulaterul (coordonate 0..1) → dreptunghiul care îl cuprinde, în pixelii pozei
export function quadBox(q, W, H) {
  const xs = q.map((p) => p[0] * W), ys = q.map((p) => p[1] * H);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

// Zonele pe care se poate opri camera
export function sceneRegions(rig) {
  const { W, H } = dims(rig);
  const out = {};
  const frame = Array.isArray(rig?.boardFrame) ? quadBox(rig.boardFrame, W, H) : null;
  if (Array.isArray(rig?.board)) {
    const b = quadBox(rig.board, W, H);
    // explicația: tabla (cu rama ei) și profesorul de lângă ea — scrisul „din spatele lui"
    const a = rig.actor;
    const right = a ? Math.min(a.x + a.w * 0.6, b.x1 + (b.x1 - b.x0) * 0.5) : b.x1 + 8;
    out.tabla = {
      x0: Math.min(b.x0, frame ? frame.x0 : b.x0) - 6,
      y0: Math.min(b.y0, frame ? frame.y0 : b.y0) - 8,
      x1: Math.max(b.x1 + 8, right),
      y1: Math.max(b.y1, frame ? frame.y1 : b.y1) + 12,
    };
  }
  if (Array.isArray(rig?.screen)) {
    const s = quadBox(rig.screen, W, H);
    out.ecran = { x0: s.x0 - 8, y0: s.y0 - 8, x1: s.x1 + 8, y1: s.y1 + 8 };
  }
  return out;
}

// Încadrarea „de ansamblu" (cea de până acum): camera din rig acoperă cadrul; pe
// un ecran lat tabla și proiecția rămân întregi; cu zoom > 1 (fereastra mică,
// PiP, colțul tablei din „Planul meu") camera se apropie de profesor.
export function frameOverview(rig, size, zoom = 1) {
  const { W, H } = dims(rig);
  const cam = Array.isArray(rig.camera) ? { x: rig.camera[0], y: rig.camera[1], w: rig.camera[2], h: rig.camera[3] } : { x: 0, y: 0, w: W, h: H };
  const quadXs = [...(rig.board || []), ...(rig.screen || [])].map((q) => q[0] * W);
  const keep = quadXs.length ? { x0: Math.min(...quadXs) - 10, x1: Math.max(...quadXs) + 10 } : null;
  let sc = Math.max(size.w / cam.w, size.h / cam.h, size.w / W, size.h / H);
  if (keep && size.h > 0 && size.w / size.h >= 1.2) sc = Math.max(size.w / W, size.h / H, Math.min(sc, size.w / (keep.x1 - keep.x0)));
  sc *= zoom;
  const dw = W * sc, dh = H * sc;
  let cx = cam.x + cam.w / 2, cy = cam.y + cam.h / 2;
  if (rig.pts) {
    const nx = rig.pts[2], ny = rig.pts[3];                                    // reperul 1 = vârful nasului
    const faceH = rig.pts[2 * 152 + 1] - rig.pts[2 * 10 + 1];
    const visW = size.w / sc;
    if (zoom > 1) { cx = nx; cy = ny + faceH * 1.1; }
    else if (keep && visW >= keep.x1 - keep.x0 - 1 && visW < cam.w) cx = (keep.x0 + keep.x1) / 2;   // tabla și proiecția, amândouă
    else if (size.w / size.h < cam.w / cam.h) cx = nx;                         // ecran îngust (telefon): profesorul în mijloc
  }
  const ox = Math.min(0, Math.max(size.w - dw, size.w / 2 - cx * sc));
  const oy = Math.min(0, Math.max(size.h - dh, size.h / 2 - cy * sc));
  return { sc, ox, oy, dw, dh };
}

// Camera oprită pe o zonă: cât mai aproape (zona încape întreagă), fără margini
// goale. `inset` = ce acoperă sala peste scenă (butonul camerei sus, cardul cu
// întrebarea jos sau în dreapta): zona se potrivește și se centrează în restul.
// Valorile ≤ 1 sunt fracții din cadru, cele > 1 sunt pixeli.
export function frameRegion(rig, region, size, inset = null, minScale = 0) {
  const { W, H } = dims(rig);
  const px = (v, total) => (!v ? 0 : v <= 1 ? v * total : v);
  const top = px(inset?.top, size.h), bottom = px(inset?.bottom, size.h);
  const left = px(inset?.left, size.w), right = px(inset?.right, size.w);
  const fw = Math.max(40, size.w - left - right), fh = Math.max(40, size.h - top - bottom);
  const rw = Math.max(1, region.x1 - region.x0), rh = Math.max(1, region.y1 - region.y0);
  const sc = Math.max(Math.min(fw / rw, fh / rh), size.w / W, size.h / H, minScale);
  const dw = W * sc, dh = H * sc;
  const cx = (region.x0 + region.x1) / 2, cy = (region.y0 + region.y1) / 2;
  const ox = clamp(left + fw / 2 - cx * sc, size.w - dw, 0);
  const oy = clamp(top + fh / 2 - cy * sc, size.h - dh, 0);
  return { sc, ox, oy, dw, dh };
}

// Cât de mare iese scrisul (px pe ecran) și dacă zona încape întreagă în cadru
function readable(rig, f, size) {
  const { W, H } = dims(rig);
  const check = (q, logical, font, min) => {
    if (!Array.isArray(q)) return true;
    const b = quadBox(q, W, H);
    const px = font * ((b.x1 - b.x0) / logical) * f.sc;
    const inside = b.x0 * f.sc + f.ox >= -2 && b.x1 * f.sc + f.ox <= size.w + 2 && b.y0 * f.sc + f.oy >= -2 && b.y1 * f.sc + f.oy <= size.h + 2;
    return inside && px >= min;
  };
  return check(rig.board, BOARD_W, BOARD_FONT, MIN_BOARD_PX) && check(rig.screen, SCREEN_W, SCREEN_FONT, MIN_SCREEN_PX);
}

// „Îngust" = încadrarea de ansamblu nu arată citibil ȘI tabla, ȘI proiecția
// (telefonul, în ambele orientări): atunci camera se mută între ele.
export function isNarrow(rig, size) {
  if (!rig || !size || size.w <= 0 || size.h <= 0) return false;
  if (!rig.board && !rig.screen) return false;
  return !readable(rig, frameOverview(rig, size, 1), size);
}

// Încadrarea finală, după ce vrea lecția / elevul (`focus`). Cu telefonul culcat
// (ecran scund) camera nu se depărtează niciodată față de planul obișnuit: doar
// se mută pe zonă (tabla are deja înălțimea cadrului).
export function frameScene(rig, size, { zoom = 1, focus = null, inset = null } = {}) {
  const overview = frameOverview(rig, size, zoom);
  const narrow = zoom === 1 && isNarrow(rig, size);
  if (narrow && (focus === 'tabla' || focus === 'ecran')) {
    const r = sceneRegions(rig)[focus];
    if (r) return { ...frameRegion(rig, r, size, inset, size.w > size.h ? overview.sc : 0), focus, narrow: true };
  }
  return { ...overview, focus: null, narrow };
}

// Ce acoperă sala peste scenă, pe telefon: butonul camerei (sus), subtitrările și
// cardul cu întrebarea (jos — sau în dreapta, cu telefonul culcat)
export function sceneInset({ landscape = false, card = false } = {}) {
  return landscape ? { top: 46, right: card ? 0.47 : 0 } : { top: 52, bottom: card ? 0.46 : 0.22 };
}

// Pe telefon, unde se uită camera în fiecare moment al lecției (dacă elevul nu
// a ales el): exercițiul cât e citit / încercat / corectat, tabla cât se explică.
// La întrebările pe pași, tabla: pașii de până acum sunt chiar acolo.
export function autoFocus(state) {
  const sc = state?.scene;
  if (!sc || state?.phase === 'asteptare' || state?.phase === 'final') return 'profesor';
  if (state.inserted === 'raspuns') return sc.answerBoard?.length ? 'tabla' : 'profesor';
  if (sc.step && (sc.type === 'sondaj' || sc.type === 'rezultate')) return 'tabla';
  switch (sc.type) {
    case 'item': case 'sondaj': case 'rezultate': case 'video': return 'ecran';
    case 'explicatie': case 'intrebare_intelegere': return 'tabla';
    default: return 'profesor';
  }
}
