// =====================================================================
// src/lib/figureRender.js — desenează figuri geometrice (SVG) din
// specificația JSON „figure" a itemilor de examen generați de AI.
// Stilul urmează subiectele oficiale de Evaluare Națională: linii negre
// subțiri, etichete italice serif, muchiile nevăzute punctate.
//
// renderFigure(fig) → { svg, w, h } sau null dacă specificația e invalidă.
// Renderer-ul e DEFENSIV: orice câmp lipsă/greșit → figură simplificată
// sau null, niciodată excepție care să strice PDF-ul.
// =====================================================================

const STROKE = '#1a1a1a';
const SW = 1.15; // grosimea liniilor
const FONT = `font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="13.5" fill="#111"`;
const DASH = 'stroke-dasharray="4.5 3.5"';
const VW = 230; // lățimea viewBox-ului (px logici)
const OUT_W = 215; // lățimea la care se afișează în pagină

// ── primitive ────────────────────────────────────────────────────────────────
const L = (a, b, dashed = false) =>
  `<line x1="${r1(a[0])}" y1="${r1(a[1])}" x2="${r1(b[0])}" y2="${r1(b[1])}" stroke="${STROKE}" stroke-width="${SW}" ${dashed ? DASH : ''} stroke-linecap="round"/>`;
const DOT = (p, rad = 1.8) => `<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="${rad}" fill="${STROKE}"/>`;
const r1 = (n) => Math.round(n * 10) / 10;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function TXT(p, label, H) {
  // etichetă centrată pe punctul dat, ținută în interiorul canvas-ului
  const x = Math.max(9, Math.min(VW - 9, p[0]));
  const y = Math.max(10, Math.min(H - 7, p[1]));
  return `<text x="${r1(x)}" y="${r1(y)}" text-anchor="middle" dominant-baseline="middle" ${FONT}>${esc(label)}</text>`;
}

// arc de elipsă: jumătatea din față (de jos) sau din spate (de sus)
function halfEllipse(cx, cy, rx, ry, front, dashed = false) {
  const sweep = front ? 0 : 1;
  return `<path d="M ${r1(cx - rx)} ${r1(cy)} A ${r1(rx)} ${r1(ry)} 0 0 ${sweep} ${r1(cx + rx)} ${r1(cy)}" fill="none" stroke="${STROKE}" stroke-width="${SW}" ${dashed ? DASH : ''}/>`;
}

// marcaj de unghi drept în vârful P, pe direcțiile u și v (vectori unitate)
function rightAngle(P, u, v, s = 9) {
  const a = [P[0] + u[0] * s, P[1] + u[1] * s];
  const b = [P[0] + u[0] * s + v[0] * s, P[1] + u[1] * s + v[1] * s];
  const c = [P[0] + v[0] * s, P[1] + v[1] * s];
  return `<path d="M ${r1(a[0])} ${r1(a[1])} L ${r1(b[0])} ${r1(b[1])} L ${r1(c[0])} ${r1(c[1])}" fill="none" stroke="${STROKE}" stroke-width="1"/>`;
}
const norm = (v) => { const d = Math.hypot(v[0], v[1]) || 1; return [v[0] / d, v[1] / d]; };
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

// ── contextul unei figuri: puncte etichetate + elemente desenate ────────────
function ctx(H) {
  const c = {
    H, parts: [], pts: {}, // label → [x,y]
    add(s) { c.parts.push(s); },
    reg(label, p, { dot = true, labelPos = null } = {}) {
      if (!label) return;
      c.pts[label] = p;
      if (dot) c.add(DOT(p));
      c.labels = c.labels || [];
      c.labels.push({ label, p, labelPos });
    },
    finishLabels(center) {
      for (const { label, p, labelPos } of c.labels || []) {
        let pos = labelPos;
        if (!pos) {
          const d = norm(sub(p, center));
          const dir = (d[0] === 0 && d[1] === 0) ? [0, -1] : d;
          pos = [p[0] + dir[0] * 13, p[1] + dir[1] * 13];
        }
        c.add(TXT(pos, label, H));
      }
    },
    svg() {
      return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${H}" width="${OUT_W}" role="img">${c.parts.join('')}</svg>`;
    },
  };
  return c;
}

// centrul (media) unui set de puncte
const centroid = (pts) => {
  const arr = Array.isArray(pts) ? pts : Object.values(pts);
  if (!arr.length) return [VW / 2, 80];
  return [arr.reduce((s, p) => s + p[0], 0) / arr.length, arr.reduce((s, p) => s + p[1], 0) / arr.length];
};

// listă de etichete sigure (max n, completată cu implicite)
function takeLabels(fig, defaults, n = defaults.length) {
  const raw = Array.isArray(fig.labels) ? fig.labels.map((x) => String(x || '').trim()).filter(Boolean) : [];
  const out = [];
  for (let i = 0; i < n; i++) out.push(raw[i] || defaults[i] || String.fromCharCode(65 + i));
  return out;
}

// „pe": latura pe care stă un punct suplimentar — acceptă "BC" sau ["B","C"]
function parseSide(pe, pts) {
  if (Array.isArray(pe) && pe.length >= 2 && pts[pe[0]] && pts[pe[1]]) return [pe[0], pe[1]];
  const s = String(pe || '');
  const keys = Object.keys(pts).sort((a, b) => b.length - a.length);
  for (const k1 of keys) {
    if (s.startsWith(k1) && pts[s.slice(k1.length)]) return [k1, s.slice(k1.length)];
  }
  return null;
}

// puncte pe laturi + segmente suplimentare (comune poligoanelor și 3D)
function applyExtras(c, fig) {
  for (const p of Array.isArray(fig.puncte) ? fig.puncte : []) {
    try {
      if (!p || !p.label || c.pts[p.label]) continue;
      const side = parseSide(p.pe, c.pts);
      if (!side) continue;
      let t = Number(p.la); if (!isFinite(t)) t = 0.5;
      t = Math.max(0.08, Math.min(0.92, t));
      c.reg(p.label, lerp(c.pts[side[0]], c.pts[side[1]], t));
    } catch { /* punct ignorat */ }
  }
  const seg = (list, dashed) => {
    for (const s of Array.isArray(list) ? list : []) {
      try {
        let a, b;
        if (Array.isArray(s) && s.length >= 2) { a = c.pts[s[0]]; b = c.pts[s[1]]; }
        else if (typeof s === 'string') { const pr = parseSide(s, c.pts); if (pr) { a = c.pts[pr[0]]; b = c.pts[pr[1]]; } }
        if (a && b) c.add(L(a, b, dashed));
      } catch { /* segment ignorat */ }
    }
  };
  seg(fig.segmente, false);
  seg(fig.segmente_punctate, true);
}

// ── figuri 2D ────────────────────────────────────────────────────────────────
function segmentFig(fig) {
  const labels = takeLabels(fig, ['A', 'B'], Math.min(Math.max((fig.labels || []).length, 2), 6));
  const H = 64, y = 34, x0 = 18, x1 = 212;
  const c = ctx(H);
  let pos = Array.isArray(fig.pozitii) ? fig.pozitii.map(Number) : null;
  if (!pos || pos.length !== labels.length || pos.some((v) => !isFinite(v))) {
    pos = labels.map((_, i) => i / (labels.length - 1));
  }
  const lo = Math.min(...pos), hi = Math.max(...pos), span = hi - lo || 1;
  c.add(L([x0 - 4, y], [x1 + 4, y]));
  labels.forEach((lab, i) => {
    const x = x0 + ((pos[i] - lo) / span) * (x1 - x0);
    c.reg(lab, [x, y], { labelPos: [x, y - 13] });
  });
  c.finishLabels([0, 0]); // labelPos e mereu dat
  return c;
}

function unghiFig(fig) {
  const H = 168;
  const O = [40, 148];
  const raysIn = Array.isArray(fig.raze) && fig.raze.length ? fig.raze.map((x) => String(x || '').trim()).filter(Boolean) : ['A', 'B'];
  const rays = raysIn.slice(0, 6);
  const n = rays.length;
  const spread = n === 2 ? 52 : Math.min(42 * (n - 1), 138);
  const c = ctx(H);
  c.reg(String(fig.varf || 'O'), O, { labelPos: [O[0] - 10, O[1] + 12] });
  rays.forEach((lab, i) => {
    const ang = (6 + (n === 1 ? 30 : (spread * i) / (n - 1))) * Math.PI / 180;
    const dir = [Math.cos(ang), -Math.sin(ang)];
    // lungimea maximă până la marginea canvas-ului (semidreapta nu se taie),
    // cu spațiu lăsat pentru etichetă — semidreptele pot avea lungimi diferite,
    // ca în figurile oficiale
    let t = 150;
    if (dir[0] > 1e-6) t = Math.min(t, (VW - 22 - O[0]) / dir[0]);
    if (dir[0] < -1e-6) t = Math.min(t, (18 - O[0]) / dir[0]);
    if (dir[1] < -1e-6) t = Math.min(t, (20 - O[1]) / dir[1]);
    const len = Math.max(56, t);
    const P = [O[0] + len * dir[0], O[1] + len * dir[1]];
    c.add(L(O, P));
    c.reg(lab, P, { labelPos: [P[0] + 11 * dir[0], P[1] + 11 * dir[1] - 3], dot: false });
  });
  c.finishLabels(O);
  return c;
}

function triunghiFig(fig) {
  const H = 172;
  const variant = String(fig.variant || 'oarecare');
  const labels = takeLabels(fig, ['A', 'B', 'C'], 3);
  const c = ctx(H);
  let P = {};
  if (variant === 'dreptunghic') {
    // unghiul drept în vârful indicat (implicit al doilea din listă)
    const ra = labels.includes(String(fig.unghi_drept)) ? String(fig.unghi_drept) : labels[1];
    const rest = labels.filter((l) => l !== ra);
    P[ra] = [40, 152]; P[rest[0]] = [40, 34]; P[rest[1]] = [212, 152];
    c.add(rightAngle(P[ra], [0, -1], [1, 0]));
  } else {
    const apex = variant === 'echilateral' ? [117, 24] : variant === 'isoscel' ? [116, 22] : [88, 26];
    const bl = variant === 'echilateral' ? [43, 152] : [17, 152];
    const br = variant === 'echilateral' ? [191, 152] : [215, 152];
    P[labels[0]] = apex; P[labels[1]] = bl; P[labels[2]] = br;
  }
  const tri = labels.map((l) => P[l]);
  c.add(L(tri[0], tri[1])); c.add(L(tri[1], tri[2])); c.add(L(tri[2], tri[0]));
  labels.forEach((l) => c.reg(l, P[l]));
  // înălțime opțională: din vârf pe latura opusă
  try {
    if (fig.inaltime && typeof fig.inaltime === 'object') {
      const from = c.pts[fig.inaltime.din] ? String(fig.inaltime.din) : labels[0];
      const others = labels.filter((l) => l !== from);
      const A = c.pts[from], B = c.pts[others[0]], C = c.pts[others[1]];
      const d = sub(C, B); const t = ((A[0] - B[0]) * d[0] + (A[1] - B[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
      const Ft = [B[0] + d[0] * t, B[1] + d[1] * t];
      c.add(L(A, Ft));
      c.add(rightAngle(Ft, norm(sub(B, Ft)), norm(sub(A, Ft)), 8));
      if (fig.inaltime.picior) c.reg(String(fig.inaltime.picior), Ft);
    }
  } catch { /* fără înălțime */ }
  applyExtras(c, fig);
  c.finishLabels(centroid(tri));
  return c;
}

// patrulatere: labels în ordinea A=stânga-jos, B=dreapta-jos, C=dreapta-sus, D=stânga-sus
function patrulaterFig(fig, type) {
  const labels = takeLabels(fig, ['A', 'B', 'C', 'D'], 4);
  let P4, H = 172, marks = [];
  if (type === 'patrat') {
    P4 = [[49, 158], [177, 158], [177, 30], [49, 30]];
  } else if (type === 'dreptunghi') {
    H = 150; P4 = [[25, 132], [205, 132], [205, 32], [25, 32]];
  } else if (type === 'paralelogram') {
    H = 152; P4 = [[16, 134], [156, 134], [212, 34], [72, 34]];
  } else if (type === 'romb') {
    H = 168; P4 = [[20, 88], [115, 150], [210, 88], [115, 26]];
  } else { // trapez (bazele AB și DC)
    H = 158; const v = String(fig.variant || 'oarecare');
    if (v === 'dreptunghic') { P4 = [[26, 140], [214, 140], [140, 36], [26, 36]]; marks = ['a', 'd']; }
    else if (v === 'isoscel') { P4 = [[22, 140], [208, 140], [163, 36], [67, 36]]; }
    else { P4 = [[20, 140], [212, 140], [158, 36], [74, 36]]; }
  }
  const c = ctx(H);
  for (let i = 0; i < 4; i++) c.add(L(P4[i], P4[(i + 1) % 4]));
  labels.forEach((l, i) => c.reg(l, P4[i]));
  if (marks.includes('a')) c.add(rightAngle(P4[0], [0, -1], [1, 0]));
  if (marks.includes('d')) c.add(rightAngle(P4[3], [0, 1], [1, 0]));
  if (fig.diagonale) { c.add(L(P4[0], P4[2])); c.add(L(P4[1], P4[3])); }
  applyExtras(c, fig);
  c.finishLabels(centroid(P4));
  return c;
}

function cercFig(fig) {
  const H = 190, O = [115, 96], R = 74;
  const c = ctx(H);
  c.add(`<circle cx="${O[0]}" cy="${O[1]}" r="${R}" fill="none" stroke="${STROKE}" stroke-width="${SW}"/>`);
  const onCircle = (deg) => [O[0] + R * Math.cos(deg * Math.PI / 180), O[1] - R * Math.sin(deg * Math.PI / 180)];
  c.reg(String(fig.centru || 'O'), O, { labelPos: [O[0] + 11, O[1] - 8] });
  // poligon înscris
  const ins = Array.isArray(fig.inscris) ? fig.inscris.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 6) : [];
  if (ins.length >= 2) {
    const start = ins.length === 4 ? 45 : 90;
    const ptsI = ins.map((_, i) => onCircle(start + (360 * i) / ins.length));
    for (let i = 0; i < ptsI.length; i++) c.add(L(ptsI[i], ptsI[(i + 1) % ptsI.length]));
    ins.forEach((l, i) => c.reg(l, ptsI[i]));
  }
  // diametru / rază / coardă / puncte pe cerc / tangentă
  try {
    if (Array.isArray(fig.diametru) && fig.diametru.length === 2) {
      const A = onCircle(160), B = onCircle(-20);
      c.add(L(A, B)); c.reg(String(fig.diametru[0]), A); c.reg(String(fig.diametru[1]), B);
    }
    if (fig.raza && !c.pts[String(fig.raza)]) {
      const A = onCircle(-35); c.add(L(O, A)); c.reg(String(fig.raza), A);
    }
    if (Array.isArray(fig.coarda) && fig.coarda.length === 2 && !c.pts[String(fig.coarda[0])] && !c.pts[String(fig.coarda[1])]) {
      const A = onCircle(205), B = onCircle(325);
      c.add(L(A, B)); c.reg(String(fig.coarda[0]), A); c.reg(String(fig.coarda[1]), B);
    }
    for (const p of Array.isArray(fig.puncte) ? fig.puncte : []) {
      if (!p || !p.label || c.pts[p.label]) continue;
      const deg = isFinite(Number(p.unghi)) ? Number(p.unghi) : 250;
      c.reg(String(p.label), onCircle(deg));
    }
    if (fig.tangenta && fig.tangenta.la && c.pts[String(fig.tangenta.la)]) {
      const T = c.pts[String(fig.tangenta.la)];
      const u = norm([-(T[1] - O[1]), T[0] - O[0]]); // perpendicular pe rază
      c.add(L([T[0] - u[0] * 62, T[1] - u[1] * 62], [T[0] + u[0] * 62, T[1] + u[1] * 62]));
    }
  } catch { /* element ignorat */ }
  // segmentele se aplică după ce toate punctele există
  const figSeg = { segmente: fig.segmente, segmente_punctate: fig.segmente_punctate };
  applyExtras(c, figSeg);
  c.finishLabels(O);
  return c;
}

function xOyFig(fig) {
  const H = 196;
  const c = ctx(H);
  const Ox = 96, Oy = 106; // originea pe canvas
  // colectăm valorile ca să alegem scara
  const f = (fig.functie && isFinite(Number(fig.functie.a)) && isFinite(Number(fig.functie.b)))
    ? { a: Number(fig.functie.a), b: Number(fig.functie.b) } : null;
  const ptsIn = (Array.isArray(fig.puncte) ? fig.puncte : [])
    .filter((p) => p && p.label && isFinite(Number(p.x)) && isFinite(Number(p.y)))
    .map((p) => ({ label: String(p.label), x: Number(p.x), y: Number(p.y) })).slice(0, 5);
  let m = 2;
  if (f) {
    if (f.a !== 0) m = Math.max(m, Math.abs(f.b / f.a));
    m = Math.max(m, Math.abs(f.b));
  }
  for (const p of ptsIn) m = Math.max(m, Math.abs(p.x), Math.abs(p.y));
  const s = 78 / m;
  const X = (x, y) => [Ox + x * s, Oy - y * s];
  // axele cu săgeți
  c.add(L([Ox - 84, Oy], [Ox + 122, Oy]));
  c.add(`<path d="M ${Ox + 122} ${Oy} l -7 -3.4 v 6.8 z" fill="${STROKE}"/>`);
  c.add(L([Ox, Oy + 80], [Ox, Oy - 96]));
  c.add(`<path d="M ${Ox} ${Oy - 96} l -3.4 7 h 6.8 z" fill="${STROKE}"/>`);
  c.add(`<text x="${Ox + 120}" y="${Oy + 13}" text-anchor="middle" ${FONT}>x</text>`);
  c.add(`<text x="${Ox + 11}" y="${Oy - 92}" text-anchor="middle" ${FONT}>y</text>`);
  c.add(`<text x="${Ox - 9}" y="${Oy + 12}" text-anchor="middle" ${FONT}>O</text>`);
  // dreapta: graficul funcției sau prin primele două puncte date
  let A = null, B = null;
  if (f) {
    if (f.a !== 0) { A = [-f.b / f.a, 0]; B = [0, f.b]; if (Math.abs(f.b) < 1e-9) { A = [-m * 0.7, -m * 0.7 * f.a]; B = [m * 0.7, m * 0.7 * f.a]; } }
    else { A = [-m * 0.7, f.b]; B = [m * 0.85, f.b]; }
  } else if (ptsIn.length >= 2) { A = [ptsIn[0].x, ptsIn[0].y]; B = [ptsIn[1].x, ptsIn[1].y]; }
  if (A && B && (A[0] !== B[0] || A[1] !== B[1])) {
    const E1 = [A[0] + (A[0] - B[0]) * 0.45, A[1] + (A[1] - B[1]) * 0.45];
    const E2 = [B[0] + (B[0] - A[0]) * 0.45, B[1] + (B[1] - A[1]) * 0.45];
    c.add(L(X(E1[0], E1[1]), X(E2[0], E2[1])));
  }
  for (const p of ptsIn) {
    const S = X(p.x, p.y);
    // eticheta: sub axă pentru punctele de pe Ox, la stânga pentru cele de pe
    // Oy, altfel dreapta-sus — ca să nu cadă peste axă sau peste dreaptă
    const pos = p.y === 0 ? [S[0] + 3, S[1] + 13] : p.x === 0 ? [S[0] - 12, S[1] + 2] : [S[0] + 11, S[1] - 10];
    c.reg(p.label, S, { labelPos: pos });
  }
  c.finishLabels([Ox, Oy]);
  return c;
}

// ── corpuri geometrice (3D) ──────────────────────────────────────────────────
function boxFig(fig, type) {
  const H = 205;
  const c = ctx(H);
  const cube = type === 'cub';
  const wF = cube ? 106 : 118, hF = cube ? 106 : 66, d = cube ? [50, -35] : [54, -37];
  const x0 = cube ? 26 : 24, y0 = 190;
  // baza ABCD (jos), fețele: A stânga-față, B dreapta-față, C dreapta-spate, D stânga-spate
  const A = [x0, y0], B = [x0 + wF, y0], C = [x0 + wF + d[0], y0 + d[1]], D = [x0 + d[0], y0 + d[1]];
  const up = (p) => [p[0], p[1] - hF];
  const A2 = up(A), B2 = up(B), C2 = up(C), D2 = up(D);
  const labels = takeLabels(fig, ['A', 'B', 'C', 'D', "A'", "B'", "C'", "D'"], 8);
  // muchii văzute
  [[A, B], [B, B2], [B2, A2], [A2, A], [B, C], [C, C2], [A2, B2], [B2, C2], [C2, D2], [D2, A2]].forEach(([p, q]) => c.add(L(p, q)));
  // muchii nevăzute
  [[A, D], [D, C], [D, D2]].forEach(([p, q]) => c.add(L(p, q, true)));
  [A, B, C, D, A2, B2, C2, D2].forEach((p, i) => c.reg(labels[i], p));
  applyExtras(c, fig);
  c.finishLabels(centroid([A, B, C, D, A2, B2, C2, D2]));
  return c;
}

function prismaFig(fig) {
  if (String(fig.variant || '').startsWith('patrulater')) return boxFig(fig, 'paralelipiped');
  const H = 205;
  const c = ctx(H);
  const A = [26, 190], B = [158, 190], C = [204, 158];
  const hF = 112;
  const up = (p) => [p[0], p[1] - hF];
  const A2 = up(A), B2 = up(B), C2 = up(C);
  const labels = takeLabels(fig, ['A', 'B', 'C', "A'", "B'", "C'"], 6);
  [[A, B], [A, A2], [B, B2], [C, C2], [A2, B2], [B2, C2], [C2, A2]].forEach(([p, q]) => c.add(L(p, q)));
  [[A, C], [B, C]].forEach(([p, q]) => c.add(L(p, q, true)));
  [A, B, C, A2, B2, C2].forEach((p, i) => c.reg(labels[i], p));
  applyExtras(c, fig);
  c.finishLabels(centroid([A, B, C, A2, B2, C2]));
  return c;
}

function piramidaFig(fig) {
  const H = 205;
  const c = ctx(H);
  const tri = String(fig.variant || '').startsWith('triunghiular');
  const defaults = tri ? ['V', 'A', 'B', 'C'] : ['V', 'A', 'B', 'C', 'D'];
  const labels = takeLabels(fig, defaults, defaults.length);
  const V = tri ? [104, 22] : [114, 22];
  let base, hidden, baseC;
  if (tri) {
    base = [[20, 176], [196, 184], [148, 132]];
    hidden = [[0, 2], [1, 2]]; // AC, BC
    baseC = [121, 168];
  } else {
    base = [[22, 152], [110, 186], [206, 154], [124, 120]];
    hidden = [[2, 3], [3, 0]]; // CD, DA
    baseC = [115, 153];
  }
  for (let i = 0; i < base.length; i++) {
    const j = (i + 1) % base.length;
    const isHid = hidden.some(([a, b]) => (a === i && b === j) || (a === j && b === i));
    c.add(L(base[i], base[j], isHid));
  }
  base.forEach((p, i) => {
    const backIdx = tri ? 2 : 3;
    c.add(L(V, p, i === backIdx)); // muchia spre vârful din spate e punctată
  });
  c.reg(labels[0], V, { labelPos: [V[0] + 1, V[1] - 12] });
  base.forEach((p, i) => c.reg(labels[i + 1], p));
  if (fig.inaltime) {
    c.add(L(V, baseC, true));
    c.add(rightAngle(baseC, [1, 0], norm(sub(V, baseC)), 7));
    const lab = (typeof fig.inaltime === 'object' && fig.inaltime.picior) ? String(fig.inaltime.picior) : 'O';
    if (!c.pts[lab]) c.reg(lab, baseC, { labelPos: [baseC[0] + 11, baseC[1] + 10] });
  }
  applyExtras(c, fig);
  c.finishLabels([116, 120]);
  return c;
}

function conFig(fig) {
  const H = 200;
  const c = ctx(H);
  const labels = takeLabels(fig, ['V', 'A', 'B'], 3);
  const V = [115, 20], cy = 164, rx = 90, ry = 19;
  const A = [115 - rx, cy], B = [115 + rx, cy];
  c.add(halfEllipse(115, cy, rx, ry, true));
  c.add(halfEllipse(115, cy, rx, ry, false, true));
  c.add(L(V, A)); c.add(L(V, B));
  c.reg(labels[0], V, { labelPos: [116, 9] });
  c.reg(labels[1], A, { labelPos: [A[0] - 10, A[1] + 6] });
  c.reg(labels[2], B, { labelPos: [B[0] + 10, B[1] + 6] });
  if (fig.inaltime) {
    const O = [115, cy];
    c.add(L(V, O, true));
    c.add(rightAngle(O, [1, 0], [0, -1], 7));
    const lab = (typeof fig.inaltime === 'object' && fig.inaltime.picior) ? String(fig.inaltime.picior) : 'O';
    c.reg(lab, O, { labelPos: [O[0] - 10, O[1] + 11] });
  }
  applyExtras(c, fig);
  c.finishLabels([115, 100]);
  return c;
}

function cilindruFig(fig) {
  const H = 200;
  const c = ctx(H);
  const cx = 115, rx = 64, ry = 15, yT = 34, yB = 166;
  c.add(`<ellipse cx="${cx}" cy="${yT}" rx="${rx}" ry="${ry}" fill="none" stroke="${STROKE}" stroke-width="${SW}"/>`);
  c.add(halfEllipse(cx, yB, rx, ry, true));
  c.add(halfEllipse(cx, yB, rx, ry, false, true));
  c.add(L([cx - rx, yT], [cx - rx, yB])); c.add(L([cx + rx, yT], [cx + rx, yB]));
  if (fig.inaltime || fig.centre) {
    c.add(L([cx, yT], [cx, yB], true));
    c.reg("O'", [cx, yT], { labelPos: [cx + 11, yT - 8] });
    c.reg('O', [cx, yB], { labelPos: [cx + 11, yB + 10] });
  }
  const labels = Array.isArray(fig.labels) ? fig.labels : [];
  if (labels[0]) c.reg(String(labels[0]), [cx - rx, yB], { labelPos: [cx - rx - 10, yB + 6] });
  if (labels[1]) c.reg(String(labels[1]), [cx + rx, yB], { labelPos: [cx + rx + 10, yB + 6] });
  applyExtras(c, fig);
  c.finishLabels([cx, 100]);
  return c;
}

function sferaFig(fig) {
  const H = 200;
  const c = ctx(H);
  const O = [115, 100], R = 82;
  c.add(`<circle cx="${O[0]}" cy="${O[1]}" r="${R}" fill="none" stroke="${STROKE}" stroke-width="${SW}"/>`);
  c.add(halfEllipse(O[0], O[1], R, 22, true));
  c.add(halfEllipse(O[0], O[1], R, 22, false, true));
  c.reg(String(fig.centru || 'O'), O, { labelPos: [O[0] - 10, O[1] - 10] });
  if (fig.raza) {
    const ang = -28 * Math.PI / 180;
    const A = [O[0] + R * Math.cos(ang), O[1] + R * Math.sin(ang)];
    c.add(L(O, A));
    c.reg(typeof fig.raza === 'string' ? fig.raza : 'A', A);
  }
  c.finishLabels(O);
  return c;
}

function trunchiConFig(fig) {
  const H = 200;
  const c = ctx(H);
  const cx = 115, rB = 92, ryB = 18, rT = 50, ryT = 11, yB = 166, yT = 44;
  c.add(`<ellipse cx="${cx}" cy="${yT}" rx="${rT}" ry="${ryT}" fill="none" stroke="${STROKE}" stroke-width="${SW}"/>`);
  c.add(halfEllipse(cx, yB, rB, ryB, true));
  c.add(halfEllipse(cx, yB, rB, ryB, false, true));
  c.add(L([cx - rB, yB], [cx - rT, yT])); c.add(L([cx + rB, yB], [cx + rT, yT]));
  if (fig.inaltime) {
    c.add(L([cx, yT], [cx, yB], true));
    c.reg("O'", [cx, yT], { labelPos: [cx + 11, yT - 9] });
    c.reg('O', [cx, yB], { labelPos: [cx + 11, yB + 10] });
  }
  applyExtras(c, fig);
  c.finishLabels([cx, 105]);
  return c;
}

function trunchiPiramidaFig(fig) {
  const H = 205;
  const c = ctx(H);
  const labels = takeLabels(fig, ['A', 'B', 'C', 'D', "A'", "B'", "C'", "D'"], 8);
  const base = [[18, 158], [104, 192], [208, 160], [116, 134]];
  const top = [[56, 66], [102, 82], [156, 67], [108, 56]];
  const hiddenB = [[2, 3], [3, 0]];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    c.add(L(base[i], base[j], hiddenB.some(([a, b]) => a === i && b === j)));
    c.add(L(top[i], top[j]));
    c.add(L(base[i], top[i], i === 3));
  }
  base.forEach((p, i) => c.reg(labels[i], p));
  // B' (vârful din față al feței de sus) primește eticheta în stânga-jos,
  // altfel s-ar suprapune cu muchia punctată DD'
  top.forEach((p, i) => c.reg(labels[i + 4], p, i === 1 ? { labelPos: [p[0] - 13, p[1] + 9] } : {}));
  applyExtras(c, fig);
  c.finishLabels(centroid([...base, ...top]));
  return c;
}

// ── dispecer ────────────────────────────────────────────────────────────────
const BUILDERS = {
  segment: segmentFig,
  unghi: unghiFig,
  triunghi: triunghiFig,
  patrat: (f) => patrulaterFig(f, 'patrat'),
  dreptunghi: (f) => patrulaterFig(f, 'dreptunghi'),
  paralelogram: (f) => patrulaterFig(f, 'paralelogram'),
  romb: (f) => patrulaterFig(f, 'romb'),
  trapez: (f) => patrulaterFig(f, 'trapez'),
  cerc: cercFig,
  xoy: xOyFig,
  cub: (f) => boxFig(f, 'cub'),
  paralelipiped: (f) => boxFig(f, 'paralelipiped'),
  prisma: prismaFig,
  piramida: piramidaFig,
  con: conFig,
  cilindru: cilindruFig,
  sfera: sferaFig,
  'trunchi-con': trunchiConFig,
  'trunchi-piramida': trunchiPiramidaFig,
};

// normalizează numele tipului (diacritice, sinonime)
function normType(t) {
  const s = String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const map = {
    'sistem de axe': 'xoy', 'axe': 'xoy', 'xoy': 'xoy', 'grafic': 'xoy', 'functie': 'xoy',
    'triunghi dreptunghic': 'triunghi', 'patrulater': 'patrat', 'cerc': 'cerc',
    'paralelipiped dreptunghic': 'paralelipiped', 'prisma dreapta': 'prisma',
    'trunchi de con': 'trunchi-con', 'trunchi de piramida': 'trunchi-piramida',
    'piramida patrulatera': 'piramida', 'piramida triunghiulara': 'piramida',
  };
  return map[s] || s;
}

/**
 * Desenează figura descrisă de specificația `fig` (obiect JSON produs de AI).
 * @returns {{svg: string, w: number, h: number} | null}
 */
export function renderFigure(fig) {
  try {
    if (!fig || typeof fig !== 'object') return null;
    const builder = BUILDERS[normType(fig.type)];
    if (!builder) return null;
    const c = builder(fig);
    if (!c) return null;
    const svg = c.svg();
    return { svg, w: OUT_W, h: Math.round((c.H * OUT_W) / VW) };
  } catch {
    return null; // orice specificație invalidă → fără figură, PDF-ul rămâne intact
  }
}
