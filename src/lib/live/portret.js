// =====================================================================
// src/lib/live/portret.js — PROFESORUL VIU (v2): scena în straturi, animată
//
// Din O SINGURĂ fotografie a clasei (o persoană care și-a dat acordul sau una
// generată cu AI), în browser, fără niciun serviciu plătit, profesorul:
//   · vorbește — gura urmează exact vocea generată (lip.js, 25 cadre/s);
//   · respiră (mai adânc între fraze, o inspirație scurtă înainte de a vorbi);
//   · își mută greutatea de pe un picior pe altul, din când în când;
//   · întoarce capul spre tablă când scrie ceva nou, spre proiecție când apare
//     un enunț sau un video, se uită în notițe la începutul unui item, apoi
//     revine la „clasă" (camera) — cu o clipire la schimbarea privirii, ca oamenii;
//   · gesticulează: mâna cu markerul „bate ritmul" pe silabele accentuate, cealaltă
//     se mișcă mai puțin; când ascultă (sondaje), mâinile se relaxează;
//   · dă din cap la accente, ridică sprâncenele la întrebări, zâmbește la „bravo";
//   · clipește la intervale naturale (uneori de două ori).
//
// Straturile (construite o dată, offline — tools/portret/construieste_rig.py):
//   fundal.jpg (clasa fără profesor) → scrisul de pe tablă și proiecția (HTML) →
//   PROFESORUL (această pânză WebGL: corpul + antebrațele, separat) → pupitrul
//   din față (prim-plan.png). Așa se poate mișca fără să „tragă" tabla după el.
//
// Capul se întoarce „în 3D": reperele feței au adâncime (MediaPipe), deci nasul
// se mișcă mai mult decât obrajii, iar conturul capului aproape deloc.
// =====================================================================

// ─── reperele MediaPipe Face Mesh (indici oficiali) ──────────────────────────
const LIP_UP_IN = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];
const LIP_LO_IN = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308];
const EYE_A_UP = [33, 246, 161, 160, 159, 158, 157, 173, 133];
const EYE_A_LO = [33, 7, 163, 144, 145, 153, 154, 155, 133];
const EYE_B_UP = [263, 466, 388, 387, 386, 385, 384, 398, 362];
const EYE_B_LO = [263, 249, 390, 373, 374, 380, 381, 382, 362];
const BROW_A = [70, 63, 105, 66, 107, 55, 65, 52, 53, 46];
const BROW_B = [300, 293, 334, 296, 336, 285, 295, 282, 283, 276];
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const CHIN = 152, TOP = 10, NOSE_BASE = 2, M_LEFT = 61, M_RIGHT = 291;

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));

function loadImage(src) {
  return new Promise((resolve, reject) => {
    if (!src) { resolve(null); return; }
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.decoding = 'async';
    im.onload = () => resolve(im);
    im.onerror = () => reject(new Error('nu am putut încărca ' + src));
    im.src = src;
  });
}

// Zona pânzei profesorului (în pixelii scenei): tot ce se poate mișca, cu o margine
export function actorRegion(rig) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
  const A = rig.actor;
  if (A) { grow(A.x, A.y); grow(A.x + A.w, A.y + A.h); }
  for (const L of rig.limbs || []) { grow(L.x, L.y); grow(L.x + L.w, L.y + L.h); }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: rig.width, h: rig.height };
  const M = Math.round((rig.E || 20) * 1.2);
  return { x: Math.floor(x0 - M), y: Math.floor(y0 - M), w: Math.ceil(x1 - x0 + 2 * M), h: Math.ceil(y1 - y0 + 2 * M) };
}

// ─── geometria: ponderile de deformare, calculate o singură dată ─────────────
export function buildGeometry(rig) {
  const P = rig.pts;
  const n = P.length / 2;
  const nL = rig.nLandmarks || 478;
  const X = (i) => P[2 * i], Y = (i) => P[2 * i + 1];
  const mean = (idx) => { let x = 0, y = 0; for (const i of idx) { x += X(i); y += Y(i); } return [x / idx.length, y / idx.length]; };
  const eyeA = mean([...EYE_A_UP, ...EYE_A_LO]), eyeB = mean([...EYE_B_UP, ...EYE_B_LO]);
  const E = rig.E || Math.hypot(eyeB[0] - eyeA[0], eyeB[1] - eyeA[1]) || 30;
  const mouthC = mean([...LIP_UP_IN, ...LIP_LO_IN]);
  const mouthW = Math.hypot(X(M_RIGHT) - X(M_LEFT), Y(M_RIGHT) - Y(M_LEFT)) || E * 0.8;
  let ux = X(TOP) - X(CHIN), uy = Y(TOP) - Y(CHIN);
  const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;             // „sus" pe față (în imagine, uy < 0)
  const rx = -uy, ry = ux;                                            // „dreapta" imaginii, pe față
  const eyesMid = [(eyeA[0] + eyeB[0]) / 2, (eyeA[1] + eyeB[1]) / 2];
  const faceC = [(eyesMid[0] + mouthC[0]) / 2, (eyesMid[1] + mouthC[1]) / 2];
  const loc = (x, y, c = faceC, s = E) => [((x - c[0]) * rx + (y - c[1]) * ry) / s, ((x - c[0]) * ux + (y - c[1]) * uy) / s];

  let halfW = 0, topW = -Infinity, chinW = Infinity;
  for (const i of FACE_OVAL) { const [a, b] = loc(X(i), Y(i)); halfW = Math.max(halfW, Math.abs(a)); topW = Math.max(topW, b); chinW = Math.min(chinW, b); }
  const headCy = (topW + chinW) / 2, headRy = (topW - chinW) / 2;

  // linia buzelor (conturul interior de sus), pe orizontală
  const lipLine = LIP_UP_IN.map((i) => loc(X(i), Y(i), mouthC, mouthW)).sort((a, b) => a[0] - b[0]);
  const lipAt = (mu) => {
    if (mu <= lipLine[0][0]) return lipLine[0][1];
    for (let k = 1; k < lipLine.length; k++) {
      if (mu <= lipLine[k][0]) { const [a0, b0] = lipLine[k - 1], [a1, b1] = lipLine[k]; return b0 + (b1 - b0) * ((mu - a0) / ((a1 - a0) || 1)); }
    }
    return lipLine[lipLine.length - 1][1];
  };
  const upIn = new Set(LIP_UP_IN), loIn = new Set(LIP_LO_IN);
  const noseW = loc(X(NOSE_BASE), Y(NOSE_BASE), mouthC, mouthW)[1];
  // buzele în poză pot fi puțin întredeschise: cât trebuie „închisă" gura în repaus
  const gap0 = Math.max(0, -((X(14) - X(13)) * ux + (Y(14) - Y(13)) * uy));
  const jawClose = -Math.min(gap0, mouthW * 0.2) / (mouthW * 0.28);

  const eyeInfo = [[EYE_A_UP, EYE_A_LO, BROW_A], [EYE_B_UP, EYE_B_LO, BROW_B]].map(([up, lo, brow]) => {
    const U = up.map((i) => [X(i), Y(i)]).sort((a, b) => a[0] - b[0]);
    const D = lo.map((i) => [X(i), Y(i)]).sort((a, b) => a[0] - b[0]);
    const Bw = brow.map((i) => [X(i), Y(i)]).sort((a, b) => a[0] - b[0]);
    const interp = (arr, x) => {
      if (x <= arr[0][0]) return arr[0][1];
      for (let k = 1; k < arr.length; k++) if (x <= arr[k][0]) { const f = (x - arr[k - 1][0]) / ((arr[k][0] - arr[k - 1][0]) || 1); return arr[k - 1][1] + f * (arr[k][1] - arr[k - 1][1]); }
      return arr[arr.length - 1][1];
    };
    return { x0: U[0][0], x1: U[U.length - 1][0], up: (x) => interp(U, x), lo: (x) => interp(D, x), brow: (x) => interp(Bw, x), upSet: new Set(up), loSet: new Set(lo) };
  });

  // adâncimea (spre cameră = pozitiv), 0 pe conturul feței
  const Z = rig.z || null;
  let zOval = 0;
  if (Z) { for (const i of FACE_OVAL) zOval += -Z[i]; zOval /= FACE_OVAL.length; }

  // scheletul
  const pose = rig.pose || {};
  const sh = pose.shoulders || [[faceC[0] - E * 2.5, faceC[1] + E * 3], [faceC[0] + E * 2.5, faceC[1] + E * 3]];
  const hp = pose.hips || [[sh[0][0] + E, sh[0][1] + E * 6], [sh[1][0] - E, sh[1][1] + E * 6]];
  const shY = (sh[0][1] + sh[1][1]) / 2, hipY = (hp[0][1] + hp[1][1]) / 2;
  const bodyCx = (sh[0][0] + sh[1][0] + hp[0][0] + hp[1][0]) / 4;
  const feet = [bodyCx, hipY + (hipY - shY) * 2.1];                       // pivotul pentru aplecare
  const liftAt = (y) => Math.pow(clamp((hipY - y) / Math.max(1, hipY - shY)), 1.3);

  const headW = new Float32Array(n), jawW = new Float32Array(n), lipUpW = new Float32Array(n);
  const cornerL = new Float32Array(n), cornerR = new Float32Array(n), browW = new Float32Array(n);
  const liftW = new Float32Array(n), depth = new Float32Array(n);
  const eyeIdx = new Int8Array(n).fill(-1), eyeGap = new Float32Array(n), eyeLidF = new Float32Array(n);
  const cL = [X(M_LEFT), Y(M_LEFT)], cR = [X(M_RIGHT), Y(M_RIGHT)];
  for (let i = 0; i < n; i++) {
    const x = X(i), y = Y(i);
    const [u, w] = loc(x, y);
    // capul: elipsa feței + părul; gâtul se mișcă mai puțin
    const d = Math.hypot(u / (halfW * 1.25), (w - headCy - 0.08 * headRy) / (headRy * 1.28));
    let h = 1 - smooth(0.92, 1.75, d);
    if (w < chinW) h *= 1 - smooth(0, 1.1, chinW - w) * 0.78;
    headW[i] = h;
    liftW[i] = Math.max(liftAt(y), h);
    // adâncimea: din reperele MediaPipe; în păr și pe gât, cea a conturului feței
    // cel mai apropiat, stinsă treptat (fără „rupturi" la întoarcerea capului)
    if (Z && i < nL) depth[i] = (-Z[i] - zOval);
    else if (Z && h > 0.001) {
      let best = Infinity, dv = 0;
      for (const o of FACE_OVAL) { const dd = Math.hypot(X(o) - x, Y(o) - y); if (dd < best) { best = dd; dv = -Z[o] - zOval; } }
      depth[i] = dv * Math.max(0, 1 - best / (E * 0.9));
    }
    // gura
    const [mu, mw] = loc(x, y, mouthC, mouthW);
    const hf = Math.exp(-Math.pow(mu / 0.95, 2));
    if (i < nL && loIn.has(i) && !upIn.has(i)) jawW[i] = 0.35 + 0.65 * Math.exp(-Math.pow(mu / 0.6, 2));
    else if (i < nL && upIn.has(i) && !loIn.has(i)) jawW[i] = 0;
    else if (i < nL && upIn.has(i) && loIn.has(i)) jawW[i] = 0.3;
    else if (mw < lipAt(mu) - 0.01) {
      const below = lipAt(mu) - mw;
      const chinFade = 1 - smooth(1.9, 3.1, below);
      jawW[i] = hf * chinFade * smooth(0, 0.08, below) ** 0.2;
    }
    if (mw >= lipAt(mu) - 0.01 && mw < noseW) lipUpW[i] = hf * (1 - smooth(0, noseW - lipAt(mu), mw - lipAt(mu)));
    const s = mouthW * 0.32;
    cornerL[i] = Math.exp(-(((x - cL[0]) ** 2) + ((y - cL[1]) ** 2)) / (2 * s * s));
    cornerR[i] = Math.exp(-(((x - cR[0]) ** 2) + ((y - cR[1]) ** 2)) / (2 * s * s));
    // ochii
    for (let k = 0; k < 2; k++) {
      const ei = eyeInfo[k];
      const margin = (ei.x1 - ei.x0) * 0.08;
      if (x < ei.x0 - margin || x > ei.x1 + margin) continue;
      const xx = clamp(x, ei.x0, ei.x1);
      const yu = ei.up(xx), yl = ei.lo(xx), yb = ei.brow(xx);
      const gap = Math.max(0, yl - yu);
      if (gap <= 0.3) continue;
      if (i < nL && ei.loSet.has(i) && !ei.upSet.has(i)) continue;
      if (y >= yu - 1 && y <= yl + 0.5) { eyeIdx[i] = k; eyeGap[i] = yl - y; eyeLidF[i] = 1; }
      else if (y < yu && y > yb) { const f = 1 - (yu - y) / Math.max(1, yu - yb); eyeIdx[i] = k; eyeGap[i] = gap; eyeLidF[i] = clamp(f) ** 1.3; }
    }
    const eyeY = Math.min(eyeInfo[0].up((eyeInfo[0].x0 + eyeInfo[0].x1) / 2), eyeInfo[1].up((eyeInfo[1].x0 + eyeInfo[1].x1) / 2));
    if (Math.abs(u) < halfW * 1.05 && y < eyeY) browW[i] = smooth(0, E * 0.45, eyeY - y) * (1 - smooth(topW - 0.2, topW + 0.3, w));
  }

  // antebrațele
  const limbs = (rig.limbs || []).map((L) => {
    const m = L.pts.length / 2;
    const [ex, ey] = L.elbow, [wx, wy] = L.wrist, [tx, ty] = L.tip;
    const vx = tx - ex, vy = ty - ey, vl = Math.hypot(vx, vy) || 1;
    const wProj = ((wx - ex) * vx + (wy - ey) * vy) / vl;
    const handW = new Float32Array(m);
    for (let k = 0; k < m; k++) {
      const pr = ((L.pts[2 * k] - ex) * vx + (L.pts[2 * k + 1] - ey) * vy) / vl;
      handW[k] = smooth(wProj - E * 0.12, wProj + E * 0.25, pr);
    }
    // semnul „în jos": rotind cu +θ, vârful coboară dacă antebrațul e spre dreapta
    const down = (wx - ex) >= 0 ? 1 : -1;
    return { ...L, m, handW, down, lift: liftAt(ey) };
  });

  const region = actorRegion(rig);

  return {
    n, nL, E, mouthW, mouthC, faceC, ux, uy, rx, ry, headRy, halfW, jawClose,
    pivot: [X(CHIN) - ux * E * 0.45, Y(CHIN) - uy * E * 0.45],
    headC: [faceC[0], faceC[1]],
    feet, shY, hipY,
    headW, jawW, lipUpW, cornerL, cornerR, browW, liftW, depth, eyeIdx, eyeGap, eyeLidF,
    limbs, region,
    // ține ceva cu amândouă mâinile (ex. markerul la piept): mâinile se mișcă împreună
    handsTogether: !!rig.handsTogether,
    cavity: { up: LIP_UP_IN, lo: LIP_LO_IN },
  };
}

// ─── pozițiile vârfurilor pentru un set de parametri ─────────────────────────
// p = { jaw (jawClose..1), wide -1..1, smile, blink 0..1, brow -0.5..1,
//       yaw, pitch, roll (rad), htx, hty (px),
//       breathe 0..1, lean (rad), btx, bty (px),
//       armR, armL, handR, handL (rad; + = mâna coboară) }
function bodyXform(g, p, x, y, lift) {
  // respirația: pieptul și umerii urcă puțin (capul odată cu ei)
  y -= lift * (p.breathe - 0.5) * g.E * 0.12;
  // aplecarea: rotație mică în jurul picioarelor (ascunse de pupitru) + deplasare
  const fx = g.feet[0], fy = g.feet[1];
  const c = Math.cos(p.lean || 0), s = Math.sin(p.lean || 0);
  const dx = x - fx, dy = y - fy;
  return [fx + dx * c - dy * s + (p.btx || 0), fy + dx * s + dy * c + (p.bty || 0)];
}

export function deformBody(rig, g, p, out) {
  const P = rig.pts;
  const { E, mouthW, ux, uy, rx, ry } = g;
  const J = mouthW * 0.28 * p.jaw;
  const Up = mouthW * 0.06 * Math.max(0, p.jaw);
  const wide = p.wide * mouthW * 0.07;
  const smileUp = p.smile * mouthW * 0.04;
  const cr = Math.cos(p.roll), sr = Math.sin(p.roll);
  const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw);
  const cp = Math.cos(p.pitch), sp = Math.sin(p.pitch);
  const [pvx, pvy] = g.pivot;
  const [hcx, hcy] = g.headC;
  for (let i = 0; i < g.n; i++) {
    let x = P[2 * i], y = P[2 * i + 1];
    // 1. gura
    const j = g.jawW[i] * J - g.lipUpW[i] * Up;
    x -= ux * j; y -= uy * j;
    const cL = g.cornerL[i], cR = g.cornerR[i];
    if (cL > 0.01 || cR > 0.01) {
      const side = (cR - cL);
      x += rx * wide * side; y += ry * wide * side;
      const lift = (cL + cR) * smileUp - (cL + cR) * Math.max(0, -p.wide) * mouthW * 0.02;
      x += ux * lift; y += uy * lift;
      // zâmbetul trage colțurile puțin în lături
      x += rx * side * p.smile * mouthW * 0.03; y += ry * side * p.smile * mouthW * 0.03;
    }
    // 2. clipitul
    if (g.eyeIdx[i] >= 0 && p.blink > 0) {
      const dy = p.blink * g.eyeGap[i] * g.eyeLidF[i] * 0.97;
      x -= ux * dy; y -= uy * dy;
    }
    // 3. sprâncenele
    const b = g.browW[i] * p.brow * E * 0.08;
    if (b) { x += ux * b; y += uy * b; }
    // 4. capul: întoarcere și înclinare „în 3D" (după adâncime), apoi rotația
    //    în jurul gâtului și o mică deplasare
    const h = g.headW[i];
    if (h > 0.001) {
      const d = g.depth[i];
      const lx = (x - hcx) * rx + (y - hcy) * ry, ly = (x - hcx) * ux + (y - hcy) * uy;   // în sistemul feței
      const nx = lx * cy + d * sy - lx;                     // întoarcerea (yaw)
      const ny = ly * cp - d * sp - ly;                     // înclinarea (pitch; + = în jos)
      x += (rx * nx + ux * ny) * h; y += (ry * nx + uy * ny) * h;
      const dx = x - pvx, dy2 = y - pvy;
      const qx = pvx + dx * cr - dy2 * sr, qy = pvy + dx * sr + dy2 * cr;
      x += (qx - x + (p.htx || 0)) * h; y += (qy - y + (p.hty || 0)) * h;
    }
    // 5. trunchiul și tot corpul
    const q = bodyXform(g, p, x, y, g.liftW[i]);
    out[2 * i] = q[0]; out[2 * i + 1] = q[1];
  }
  return out;
}

export function deformLimb(g, L, angDown, handDown, p, out) {
  const [ex, ey] = L.elbow, [wx, wy] = L.wrist;
  const a = angDown * L.down, hb = handDown * L.down;
  const ca = Math.cos(a), sa = Math.sin(a);
  // încheietura, după rotația antebrațului
  const wdx = wx - ex, wdy = wy - ey;
  const wrx = ex + wdx * ca - wdy * sa, wry = ey + wdx * sa + wdy * ca;
  const ch = Math.cos(hb), shb = Math.sin(hb);
  for (let k = 0; k < L.m; k++) {
    const x0 = L.pts[2 * k], y0 = L.pts[2 * k + 1];
    let dx = x0 - ex, dy = y0 - ey;
    let x = ex + dx * ca - dy * sa, y = ey + dx * sa + dy * ca;
    const hw = L.handW[k];
    if (hw > 0.001) {
      dx = x - wrx; dy = y - wry;
      const hx = wrx + dx * ch - dy * shb, hy = wry + dx * shb + dy * ch;
      x += (hx - x) * hw; y += (hy - y) * hw;
    }
    const q = bodyXform(g, p, x, y, L.lift);
    out[2 * k] = q[0]; out[2 * k + 1] = q[1];
  }
  return out;
}

// ─── WebGL ───────────────────────────────────────────────────────────────────
const VS = `
attribute vec2 aPos; attribute vec2 aUv; attribute vec2 aCav;
uniform vec2 uOrigin; uniform vec2 uSize; varying vec2 vUv; varying vec2 vCav;
void main(){ vUv=aUv; vCav=aCav; vec2 c = (aPos - uOrigin) / uSize * 2.0 - 1.0; gl_Position = vec4(c.x, -c.y, 0.0, 1.0); }`;
const FS_TEX = `
precision mediump float; varying vec2 vUv; uniform sampler2D uTex;
void main(){ gl_FragColor = texture2D(uTex, vUv); }`;
// interiorul gurii: umbră caldă, dinții de sus (cu rosturi fine), limba jos
const FS_CAV = `
precision mediump float; varying vec2 vCav; uniform float uOpen; uniform vec3 uLip;
void main(){
  float v = vCav.y; float u = vCav.x;
  vec3 dark = vec3(0.09, 0.03, 0.03);
  float edge = smoothstep(0.0, 0.3, v) * smoothstep(1.0, 0.6, v) * smoothstep(0.0, 0.25, u) * smoothstep(1.0, 0.75, u);
  vec3 wall = mix(uLip * 0.5, dark, edge);
  float teethH = mix(0.46, 0.24, clamp(uOpen, 0.0, 1.0));
  float band = smoothstep(teethH + 0.07, teethH - 0.03, v) * smoothstep(0.03, 0.14, v);
  float mid = smoothstep(0.16, 0.34, u) * smoothstep(0.84, 0.66, u);
  float gaps = 0.93 + 0.07 * smoothstep(0.3, 0.5, abs(fract(u * 8.0) - 0.5));
  vec3 teethC = vec3(0.66, 0.62, 0.56) * gaps * mix(0.66, 1.0, smoothstep(0.03, teethH * 0.8, v));
  float tongue = smoothstep(0.7, 1.0, v) * smoothstep(0.35, 0.75, uOpen) * smoothstep(0.15, 0.4, u) * smoothstep(0.85, 0.6, u);
  vec3 col = mix(wall, vec3(0.5, 0.2, 0.2), tongue * 0.75);
  col = mix(col, teethC, band * mid * 0.9);
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
  return s;
}
function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'program');
  return p;
}

function makeRenderer(canvas, rig, g, atlas) {
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true, antialias: true, preserveDrawingBuffer: false });
  if (!gl) throw new Error('WebGL indisponibil');
  if (gl.isContextLost && gl.isContextLost()) throw new Error('contextul WebGL a fost pierdut');
  const pTex = program(gl, FS_TEX), pCav = program(gl, FS_CAV);
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);             // filtrare corectă la margini
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const AW = rig.atlas.w, AH = rig.atlas.h;
  const buffers = [];
  const buf = (data, kind = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) => { const b = gl.createBuffer(); gl.bindBuffer(kind, b); gl.bufferData(kind, data, usage); buffers.push(b); return b; };
  const uvOf = (pts, rc) => { const uv = new Float32Array(pts.length); for (let k = 0; k < pts.length; k += 2) { uv[k] = (rc.ax + pts[k] - rc.x) / AW; uv[k + 1] = (rc.ay + pts[k + 1] - rc.y) / AH; } return uv; };
  const big = g.n > 65535;
  if (big) gl.getExtension('OES_element_index_uint');
  const body = {
    pos: buf(new Float32Array(g.n * 2), gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW),
    uv: buf(uvOf(rig.pts, rig.actor)),
    idx: buf(big ? new Uint32Array(rig.tris) : new Uint16Array(rig.tris), gl.ELEMENT_ARRAY_BUFFER),
    count: rig.tris.length,
  };
  const limbs = g.limbs.map((L) => ({
    pos: buf(new Float32Array(L.m * 2), gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW),
    uv: buf(uvOf(L.pts, L)),
    idx: buf(new Uint16Array(L.tris), gl.ELEMENT_ARRAY_BUFFER),
    count: L.tris.length,
  }));
  // interiorul gurii: fâșie între conturul interior de sus și cel de jos
  const m = g.cavity.up.length;
  const cavPos = new Float32Array(m * 4), cavAttr = new Float32Array(m * 4);
  const cavIdx = [];
  for (let k = 0; k < m; k++) {
    cavAttr[4 * k] = k / (m - 1); cavAttr[4 * k + 1] = 0; cavAttr[4 * k + 2] = k / (m - 1); cavAttr[4 * k + 3] = 1;
    if (k < m - 1) { const a = 2 * k, b = 2 * k + 1, c = 2 * k + 2, d = 2 * k + 3; cavIdx.push(a, b, c, c, b, d); }
  }
  const cav = { pos: buf(cavPos, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW), attr: buf(cavAttr), idx: buf(new Uint16Array(cavIdx), gl.ELEMENT_ARRAY_BUFFER) };
  // culoarea buzelor (din atlas — interiorul gurii o continuă)
  let lip = [0.55, 0.28, 0.27];
  try {
    const c2 = document.createElement('canvas'); c2.width = 3; c2.height = 3;
    const cx = c2.getContext('2d');
    const A = rig.actor, i0 = 14;
    cx.drawImage(atlas, A.ax + rig.pts[2 * i0] - A.x - 1, A.ay + rig.pts[2 * i0 + 1] - A.y + 0.5, 3, 3, 0, 0, 3, 3);
    const d = cx.getImageData(1, 1, 1, 1).data;
    if (d[3] > 200) lip = [d[0] / 255, d[1] / 255, d[2] / 255];
  } catch { /* textura „murdară" (CORS) — rămâne culoarea implicită */ }

  const loc = {
    tex: { aPos: gl.getAttribLocation(pTex, 'aPos'), aUv: gl.getAttribLocation(pTex, 'aUv'), uOrigin: gl.getUniformLocation(pTex, 'uOrigin'), uSize: gl.getUniformLocation(pTex, 'uSize'), uTex: gl.getUniformLocation(pTex, 'uTex') },
    cav: { aPos: gl.getAttribLocation(pCav, 'aPos'), aCav: gl.getAttribLocation(pCav, 'aCav'), uOrigin: gl.getUniformLocation(pCav, 'uOrigin'), uSize: gl.getUniformLocation(pCav, 'uSize'), uOpen: gl.getUniformLocation(pCav, 'uOpen'), uLip: gl.getUniformLocation(pCav, 'uLip') },
  };
  const R = g.region;
  const bindAttr = (locn, b, size) => { if (locn < 0) return; gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.enableVertexAttribArray(locn); gl.vertexAttribPointer(locn, size, gl.FLOAT, false, 0, 0); };

  return {
    gl,
    draw(bodyPos, limbPos, open) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      // textura NOASTRĂ, la fiecare cadru (altă instanță pe aceeași pânză — ex. StrictMode —
      // poate să fi legat/șters alta între timp)
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      // 1) interiorul gurii (sub plasă)
      for (let k = 0; k < m; k++) {
        const a = g.cavity.up[k], b = g.cavity.lo[k];
        cavPos[4 * k] = bodyPos[2 * a]; cavPos[4 * k + 1] = bodyPos[2 * a + 1];
        cavPos[4 * k + 2] = bodyPos[2 * b]; cavPos[4 * k + 3] = bodyPos[2 * b + 1];
      }
      gl.useProgram(pCav);
      gl.uniform2f(loc.cav.uOrigin, R.x, R.y); gl.uniform2f(loc.cav.uSize, R.w, R.h);
      gl.uniform1f(loc.cav.uOpen, open); gl.uniform3f(loc.cav.uLip, lip[0], lip[1], lip[2]);
      gl.bindBuffer(gl.ARRAY_BUFFER, cav.pos); gl.bufferData(gl.ARRAY_BUFFER, cavPos, gl.DYNAMIC_DRAW);
      bindAttr(loc.cav.aPos, cav.pos, 2); bindAttr(loc.cav.aCav, cav.attr, 2);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, cav.idx);
      gl.drawElements(gl.TRIANGLES, cavIdx.length, gl.UNSIGNED_SHORT, 0);
      if (loc.cav.aCav >= 0) gl.disableVertexAttribArray(loc.cav.aCav);
      // 2) corpul, apoi antebrațele (în fața lui)
      gl.useProgram(pTex);
      gl.uniform2f(loc.tex.uOrigin, R.x, R.y); gl.uniform2f(loc.tex.uSize, R.w, R.h);
      gl.uniform1i(loc.tex.uTex, 0);
      const drawMesh = (mesh, pos) => {
        gl.bindBuffer(gl.ARRAY_BUFFER, mesh.pos); gl.bufferData(gl.ARRAY_BUFFER, pos, gl.DYNAMIC_DRAW);
        bindAttr(loc.tex.aPos, mesh.pos, 2); bindAttr(loc.tex.aUv, mesh.uv, 2);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, mesh.idx);
        gl.drawElements(gl.TRIANGLES, mesh.count, mesh === body && big ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT, 0);
      };
      drawMesh(body, bodyPos);
      limbs.forEach((mesh, k) => drawMesh(mesh, limbPos[k]));
    },
    // NU „pierdem" contextul WebGL: aceeași pânză poate fi refolosită imediat
    // (React StrictMode montează de două ori) — eliberăm doar resursele noastre
    destroy() {
      try {
        buffers.forEach((b) => gl.deleteBuffer(b));
        gl.deleteTexture(tex); gl.deleteProgram(pTex); gl.deleteProgram(pCav);
      } catch { /* ignore */ }
    },
  };
}

// ─── „Viața" profesorului ────────────────────────────────────────────────────
// Un generator pseudo-aleator mic (fiecare profesor/ședință își are „ticurile" lui)
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
function noise(t, s) {
  return Math.sin(t * 0.31 + s) * 0.5 + Math.sin(t * 0.73 + s * 1.7) * 0.3 + Math.sin(t * 1.37 + s * 2.3) * 0.2;
}
// resort amortizat (pentru mișcări cu inerție: capul, mâinile)
function spring(k = 60, c = 12) {
  return {
    x: 0, v: 0, target: 0,
    step(dt) { const a = -k * (this.x - this.target) - c * this.v; this.v += a * dt; this.x += this.v * dt; return this.x; },
    kick(v) { this.v += v; },
  };
}

// Ținte ale privirii (radiani): tabla din stânga imaginii, proiecția din dreapta,
// notițele de pe pupitru, clasa (camera). Semnul „yaw" + = spre dreapta imaginii.
const LOOK = {
  clasa: [0, 0],
  tabla: [-0.2, -0.03],
  ecran: [0.22, -0.02],
  notite: [0.03, 0.26],
  gandeste: [-0.11, -0.1],
};

export function createAnimator(g, seed = Math.random() * 1000) {
  const R = rng(Math.floor(seed) + 7);
  const E = g.E;
  // resorturile sunt în radiani; „lovitura" v dă un vârf de ≈ v · (factorul de mai jos)
  const st = {
    prevT: null,
    jaw: g.jawClose, wide: 0,
    nextBlink: 1 + R() * 2, blinkStart: -1, doubleBlink: false,
    speakAmt: 0, energy: 0, lastLow: 0, lastBeat: -10, silentSince: 0, lastSpeaking: false,
    nod: spring(55, 11),        // vârf ≈ 0.06·v
    tilt: spring(30, 9),        // vârf ≈ 0.075·v
    yawS: spring(48, 13), pitchS: spring(48, 13),
    look: 'clasa', lookUntil: 0, nextScan: 4 + R() * 4,
    brow: 0, browTarget: 0, browUntil: 0,
    smileBoost: 0, smileUntil: 0,
    lean: 0, leanFrom: 0, leanTo: 0, leanT0: 0, leanDur: 1, nextShift: 4 + R() * 5,
    breath: R() * 6, breathRate: 1 / 4.2, inhale: 0,
    armR: spring(90, 13),       // vârf ≈ 0.047·v
    armL: spring(80, 13),       // vârf ≈ 0.05·v
    handR: spring(120, 15), handL: spring(110, 15),   // vârf ≈ 0.04·v
    listenUntil: 0,
  };

  function setLook(name, dur, t) {
    const prev = st.look;
    st.look = name; st.lookUntil = t + dur;
    const [y, p] = LOOK[name] || LOOK.clasa;
    st.yawS.target = y + (name === 'clasa' ? 0 : (R() - 0.5) * 0.04);
    st.pitchS.target = p;
    // la o schimbare mare a privirii, oamenii clipesc
    if (prev !== name && st.blinkStart < 0 && R() < 0.7) st.nextBlink = t + 0.03;
  }

  function cue(type, t, opt = {}) {
    switch (type) {
      case 'tabla': if (st.look !== 'notite') setLook('tabla', opt.dur || 0.9 + R() * 0.8, t); break;
      case 'ecran': setLook('ecran', opt.dur || 1.3 + R() * 1.2, t); break;
      case 'notite': setLook('notite', opt.dur || 1.0 + R() * 0.8, t); break;
      case 'clasa': setLook('clasa', 0, t); break;
      case 'asculta': st.listenUntil = t + (opt.dur || 20); setLook('clasa', 0, t); st.smileBoost = Math.max(st.smileBoost, 0.25); st.smileUntil = t + 3; break;
      case 'vorbeste': st.listenUntil = 0; break;
      case 'bravo': st.smileBoost = 0.7; st.smileUntil = t + 2.2; st.nod.kick(0.9); break;
      case 'salut': st.smileBoost = 0.8; st.smileUntil = t + 3; st.nod.kick(0.8); st.browTarget = 0.6; st.browUntil = t + 0.8; break;
      case 'intrebare': st.browTarget = 0.75; st.browUntil = t + (opt.dur || 1.2); st.tilt.kick(R() < 0.5 ? 0.35 : -0.35); break;
      case 'gandeste': setLook('gandeste', opt.dur || 1.6, t); st.browTarget = -0.3; st.browUntil = t + (opt.dur || 1.6); break;
      case 'chat':
        // citește chatul pe laptop — rar cât vorbește, și nu mai des de o dată la 6 s
        if (t - (st.lastChatLook || -99) > 6 && (st.speakAmt < 0.5 || R() < 0.25) && st.look === 'clasa') { st.lastChatLook = t; setLook('notite', 1 + R() * 0.6, t); }
        break;
      default: break;
    }
  }

  function step(t, m) {
    const dt = st.prevT == null ? 1 / 30 : Math.min(0.1, Math.max(0.001, t - st.prevT));
    st.prevT = t;
    const speaking = !!m.speaking;
    const open = speaking ? clamp(m.open) : 0;

    // ── vorbirea: cât vorbește, energia, începutul frazelor, accentele ──
    st.speakAmt += ((speaking ? 1 : 0) - st.speakAmt) * (1 - Math.exp(-dt / 0.6));
    st.energy += (open - st.energy) * (1 - Math.exp(-dt / 0.45));
    if (speaking && !st.lastSpeaking && t - st.silentSince > 0.6) {
      // începutul unei fraze după o pauză: o inspirație scurtă, capul se ridică
      // puțin, mâna cu markerul „se pregătește" (urcă)
      st.inhale = 1; st.nod.kick(-0.4); st.armR.kick(-1.0); st.armL.kick(-0.5);
      if (R() < 0.4) { st.browTarget = 0.35; st.browUntil = t + 0.6; }
    }
    if (!speaking && st.lastSpeaking) {
      st.silentSince = t;
      if (R() < 0.5) st.nod.kick(0.5);                       // sfârșitul frazei: o mică încuviințare
      // oamenii clipesc des la capătul unei fraze
      if (st.blinkStart < 0 && R() < 0.45) st.nextBlink = Math.min(st.nextBlink, t + 0.1 + R() * 0.25);
    }
    st.lastSpeaking = speaking;
    if (open < 0.15) st.lastLow = t;
    const listening = !speaking && t < st.listenUntil;
    if (speaking && open > 0.5 && t - st.lastLow < 0.3 && t - st.lastBeat > 0.42) {
      // o silabă accentuată: „bătaia" — mâna cu markerul coboară scurt, uneori și capul
      st.lastBeat = t;
      const e = 0.7 + st.energy;
      if (R() < 0.62) st.armR.kick((2.2 + R() * 1.6) * e);
      if (R() < 0.25) st.armL.kick((1.3 + R() * 1.0) * e);
      if (R() < 0.35) st.nod.kick((0.4 + R() * 0.4) * e);
      if (R() < 0.18) { st.browTarget = 0.55; st.browUntil = t + 0.35; }
      if (R() < 0.12) st.tilt.kick((R() - 0.5) * 0.7);
      if (R() < 0.3) st.handR.kick((R() - 0.35) * 3);
    }

    // ── gura: deschidere rapidă, închidere puțin mai lentă ──
    const target = speaking ? g.jawClose + (1 - g.jawClose) * Math.pow(open, 0.85) : g.jawClose * (0.8 + 0.2 * Math.sin(t * 0.13 + seed));
    const k = target > st.jaw ? 1 - Math.exp(-dt / 0.035) : 1 - Math.exp(-dt / 0.07);
    st.jaw += (target - st.jaw) * k;
    const wt = speaking && open > 0.08 ? (clamp(m.shape ?? 0.5) - 0.5) * 2 : 0;
    st.wide += (wt - st.wide) * (1 - Math.exp(-dt / 0.08));

    // ── privirea: ținte (tablă / proiecție / notițe) și revenirea la clasă ──
    if (st.look !== 'clasa' && t > st.lookUntil) setLook('clasa', 0, t);
    if (st.look === 'clasa' && t > st.nextScan) {
      // „se uită prin clasă": mici priviri spre elevi (mai des când ascultă)
      st.yawS.target = (R() - 0.5) * (listening ? 0.24 : 0.12);
      st.pitchS.target = (R() - 0.5) * 0.03;
      st.nextScan = t + (listening ? 1.8 : 2.8) + R() * 3.5;
    }
    const yawL = st.yawS.step(dt), pitchL = st.pitchS.step(dt);
    const nod = st.nod.step(dt), tilt = st.tilt.step(dt);
    if (listening && R() < dt / 4.5) st.nod.kick(0.5 + R() * 0.4);        // încuviințări rare, cât ascultă
    // cât elevii răspund, se mai uită din când în când la proiecție (cum vin răspunsurile)
    if (listening && st.look === 'clasa' && R() < dt / 11) setLook('ecran', 1.2 + R() * 1.3, t);
    const a = 1 + st.speakAmt * 0.7;

    // ── sprâncenele, zâmbetul ──
    if (t > st.browUntil) st.browTarget = st.speakAmt * 0.08 * (0.5 + 0.5 * Math.sin(t * 0.9 + seed));
    st.brow += (st.browTarget - st.brow) * (1 - Math.exp(-dt / 0.12));
    if (t > st.smileUntil) st.smileBoost *= Math.exp(-dt / 0.8);
    const smile = clamp(0.16 + 0.1 * noise(t * 0.2, seed + 6) + (listening ? 0.12 : 0) + st.smileBoost, 0, 1);

    // ── clipitul: la 2–6 s (mai des când vorbește), uneori dublu ──
    let blink = 0;
    if (st.blinkStart < 0 && t >= st.nextBlink) { st.blinkStart = t; st.doubleBlink = R() < 0.15; }
    if (st.blinkStart >= 0) {
      const e = t - st.blinkStart;
      const one = (x) => (x < 0 ? 0 : x < 0.07 ? x / 0.07 : x < 0.1 ? 1 : x < 0.22 ? 1 - (x - 0.1) / 0.12 : 0);
      blink = one(e) + (st.doubleBlink ? one(e - 0.27) : 0);
      if (e > (st.doubleBlink ? 0.5 : 0.23)) { st.blinkStart = -1; st.nextBlink = t + (speaking ? 1.8 : 2.6) + R() * (speaking ? 3.2 : 4); }
    }

    // ── corpul: respirația și mutarea greutății de pe un picior pe altul ──
    st.breathRate += ((speaking ? 1 / 3.6 : 1 / 4.4) - st.breathRate) * (1 - Math.exp(-dt / 2));
    st.breath += dt * st.breathRate * 2 * Math.PI;
    st.inhale *= Math.exp(-dt / 0.5);
    const breathe = 0.5 + 0.45 * Math.sin(st.breath) * (speaking ? 0.7 : 1) + st.inhale * 0.4;
    if (t > st.nextShift) {
      st.leanFrom = st.lean; st.leanT0 = t; st.leanDur = 1.3 + R() * 1.1;
      const side = st.leanTo > 0 ? -1 : 1;
      st.leanTo = side * (0.004 + R() * 0.005);
      st.nextShift = t + 6 + R() * 10;
    }
    st.lean = st.leanFrom + (st.leanTo - st.leanFrom) * smooth(0, 1, (t - st.leanT0) / st.leanDur);
    // când privește spre tablă/proiecție, tot corpul se orientează puțin într-acolo
    const lean = st.lean + 0.0012 * noise(t * 0.5, seed + 9) + yawL * 0.012;

    // ── mâinile ──
    const armIdle = speaking ? 0.035 : listening ? 0.012 : 0.018;
    const relax = (!speaking && t - st.silentSince > 2.5) ? 0.06 : 0;       // mâinile coboară puțin când tace
    // gesturi „de arătat": spre tablă (stânga imaginii) ridică mâna cu markerul,
    // spre proiecție (dreapta) ridică cealaltă mână
    const point = t < st.lookUntil ? (st.look === 'tabla' ? 1 : st.look === 'ecran' ? 2 : 0) : 0;
    const together = g.handsTogether;
    st.armR.target = armIdle * noise(t * 0.9, seed + 11) + relax + (point === 1 ? -0.1 : 0) + (together && point === 2 ? -0.08 : 0);
    st.armL.target = armIdle * 0.7 * noise(t * 0.8, seed + 12) + relax * 0.6 + (point === 2 ? -0.12 : 0);
    st.handR.target = 0.05 * noise(t * 1.1, seed + 13);
    st.handL.target = 0.04 * noise(t * 0.95, seed + 14);

    return {
      jaw: st.jaw, wide: st.wide, smile, blink: clamp(blink), brow: clamp(st.brow, -0.5, 1),
      yaw: 0.04 * a * noise(t * 0.8, seed + 1) + yawL,
      pitch: 0.028 * a * noise(t * 0.9, seed + 2) + nod + pitchL,
      roll: 0.018 * a * noise(t * 0.7, seed + 3) + tilt,
      htx: (0.25 * noise(t * 0.35, seed + 4) + yawL * 2.2) * E * 0.25,
      hty: 0.2 * noise(t * 0.42, seed + 5) * E * 0.15,
      breathe, lean, btx: st.lean * E * 30, bty: 0,
      ...(() => {
        const aR = clamp(st.armR.step(dt), -0.25, 0.3), aL = clamp(st.armL.step(dt), -0.2, 0.25);
        const hR = clamp(st.handR.step(dt), -0.25, 0.25), hL = clamp(st.handL.step(dt), -0.2, 0.2);
        // amândouă mâinile pe marker: aceeași mișcare (bătăile ritmului, gesturile „de arătat")
        return { armR: aR, armL: together ? aR : aL, handR: hR, handL: together ? hR : hL };
      })(),
    };
  }

  return { step, cue: (type, t, opt) => cue(type, t, opt) };
}

// ─── API-ul pentru PortraitScene ─────────────────────────────────────────────
export async function createPortrait({ canvas, rig, mouth, seed = null }) {
  const atlas = await loadImage(rig.atlas.src);
  const g = buildGeometry(rig);
  const r = makeRenderer(canvas, rig, g, atlas);
  const bodyPos = new Float32Array(g.n * 2);
  const limbPos = g.limbs.map((L) => new Float32Array(L.m * 2));
  const anim = createAnimator(g, seed ?? ((rig.seed || 0) + Math.random() * 1000));
  const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let raf = 0, last = 0, dead = false, now = 0;
  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(2, Math.round(canvas.clientWidth * dpr)), h = Math.max(2, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  };
  const render = (p) => {
    deformBody(rig, g, p, bodyPos);
    g.limbs.forEach((L, k) => deformLimb(g, L, L.side === 'R' ? p.armR : p.armL, L.side === 'R' ? p.handR : p.handL, p, limbPos[k]));
    r.draw(bodyPos, limbPos, Math.max(0, p.jaw));
  };
  const frame = (ms) => {
    if (dead) return;
    raf = requestAnimationFrame(frame);
    if (ms - last < 30 || document.hidden) return;        // ~30 cadre/s, ca o cameră web
    last = ms;
    now = ms / 1000;
    resize();
    const m = mouth ? mouth() : { open: 0, shape: 0.5, speaking: false };
    const p = anim.step(now, m);
    if (reduced) {
      for (const k of ['yaw', 'pitch', 'roll', 'htx', 'hty', 'lean', 'btx', 'armR', 'armL', 'handR', 'handL']) p[k] *= 0.3;
    }
    render(p);
  };
  raf = requestAnimationFrame(frame);
  return {
    geometry: g,
    region: g.region,
    cue(type, opt) { anim.cue(type, now || performance.now() / 1000, opt); },
    // pentru teste: desenează un singur cadru cu parametrii dați
    renderWith(params) {
      resize();
      render({ jaw: g.jawClose, wide: 0, smile: 0.15, blink: 0, brow: 0, yaw: 0, pitch: 0, roll: 0, htx: 0, hty: 0, breathe: 0.5, lean: 0, btx: 0, bty: 0, armR: 0, armL: 0, handR: 0, handL: 0, ...params });
    },
    // pentru înregistrări cadru-cu-cadru (timp controlat din afară)
    frameAt(t, m) { now = t; resize(); const p = anim.step(t, m || { open: 0, shape: 0.5, speaking: false }); render(p); return p; },
    stop() { cancelAnimationFrame(raf); },
    destroy() { dead = true; cancelAnimationFrame(raf); r.destroy(); },
  };
}
