// =====================================================================
// src/lib/live/lip.js — MIȘCAREA GURII profesorului
// Serverul (api/_lib/live.js → lipFromPcm) calculează din voce, la 25 de
// cadre pe secundă, cât de deschisă e gura și ce formă are (rotundă „o/u" …
// lată „i/e/s"). Aici doar citim octetul cadrului curent și îl netezim.
// Fără voce generată (rezerva cu vocea browserului) folosim un tipar
// sintetic, pe silabe, ca gura să nu stea nemișcată cât vorbește.
// =====================================================================
export const LIP_FPS = 25;

const cache = new Map();
function bytesOf(b64) {
  if (!b64) return null;
  let b = cache.get(b64);
  if (b) return b;
  try {
    const bin = atob(b64);
    b = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  } catch { b = null; }
  if (b) {
    cache.set(b64, b);
    if (cache.size > 80) cache.delete(cache.keys().next().value);
  }
  return b;
}

// { open 0..1, shape 0..1 } la secunda `t` a segmentului (interpolat între cadre)
export function lipAt(b64, t) {
  const b = bytesOf(b64);
  if (!b || t < 0) return { open: 0, shape: 0.5 };
  const x = t * LIP_FPS;
  const i = Math.floor(x);
  if (i >= b.length) return { open: 0, shape: 0.5 };
  const a = b[i], c = b[Math.min(b.length - 1, i + 1)];
  const f = x - i;
  const open = ((a >> 4) * (1 - f) + (c >> 4) * f) / 15;
  const shape = ((a & 15) * (1 - f) + (c & 15) * f) / 15;
  return { open, shape };
}

// Tipar sintetic (fără date din voce): silabe de lungimi și deschideri diferite
// (~4,5 pe secundă), cu închideri scurte între cuvinte — nu un „tic-tac" regulat
const hash = (k) => { const x = Math.sin(k * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
export function syntheticLip(t, seed = 0) {
  if (t < 0) return { open: 0, shape: 0.5 };
  // lungimea silabelor variază: timpul „deformat" lent
  const u = t * 4.5 + 0.6 * Math.sin(t * 1.7 + seed) + 0.3 * Math.sin(t * 3.1 + seed * 2);
  const k = Math.floor(u), f = u - k;
  const kk = k + Math.floor(seed * 1000);
  const amp = hash(kk) < 0.18 ? 0.08 : 0.3 + 0.7 * hash(kk + 17.3);          // uneori o consoană închisă (m, p, b)
  const open = amp * Math.pow(Math.sin(Math.PI * f), 1.3) * 0.85;
  const shape = 0.2 + 0.65 * hash(kk + 41.9);
  return { open, shape };
}
