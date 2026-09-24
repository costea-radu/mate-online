// =====================================================================
// src/lib/live/homography.js — pune un dreptunghi HTML pe un patrulater
// dintr-o fotografie (tabla albă, ecranul tablei digitale), în perspectivă.
// Rezultatul e un `matrix3d(...)` pentru CSS (transform-origin: 0 0).
// =====================================================================

// rezolvă sistemul liniar 8×8 (eliminare Gauss cu pivot)
function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let k = c; k <= n; k++) M[c][k] /= d;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row) => row[n]);
}

// Omografia care duce colțurile (0,0) (w,0) (w,h) (0,h) în quad[0..3]
// (ordinea: stânga-sus, dreapta-sus, dreapta-jos, stânga-jos), în pixeli.
export function quadMatrix(w, h, quad) {
  const src = [[0, 0], [w, 0], [w, h], [0, h]];
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = src[i], [u, v] = quad[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
  }
  const [a, bb, c, d, e, f, g, hh] = solve(A, b);
  // matrix3d în ordinea coloanelor (CSS)
  return `matrix3d(${[a, d, 0, g, bb, e, 0, hh, 0, 0, 1, 0, c, f, 0, 1].map((x) => +x.toFixed(10)).join(',')})`;
}

// quad în fracții (0..1) din fotografie → quad în pixeli pentru mărimea afișată
export function scaleQuad(quadFrac, width, height) {
  return quadFrac.map(([x, y]) => [x * width, y * height]);
}
