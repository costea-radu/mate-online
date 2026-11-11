// =====================================================================
// src/lib/versiune.js — a apărut o VERSIUNE NOUĂ a site-ului cât pagina era deschisă?
//
// Fiecare build scrie /version.json = momentul build-ului (vite.config.js), aceeași
// valoare cu __BUILD_TIME__ din codul paginii. Paginile vin din rețea (service worker-ul
// le cere întâi serverului), deci de obicei pagina e deja la zi; rămâne veche doar dacă a
// venit din precache (rețea lentă / lipsă) sau dacă tab-ul e deschis de dinainte de
// deploy (pe telefon, Safari îl „trezește" fără să-l reîncarce). Atunci:
//  - pagina abia deschisă (sub 15 s) → se reîncarcă acum, o singură dată (chunkReload.js);
//  - altfel (elevul poate fi la jumătatea unui test) → la următoarea schimbare de pagină
//    din aplicație se încarcă pagina din nou, nu prin navigarea internă (App.jsx).
// =====================================================================
import { reloadForNewVersion } from './chunkReload.js';

/* global __BUILD_TIME__ */
export const VERSIUNE = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : null;
export const PROASPAT_MS = 15000;    // „pagina abia s-a deschis"

let deActualizat = false;

// true = serverul are altă versiune decât cea care rulează aici
export async function versiuneNoua({ versiune = VERSIUNE, fetchFn = (typeof fetch === 'function' ? fetch : null) } = {}) {
  if (!versiune || !fetchFn) return false;
  try {
    const r = await fetchFn(`/version.json?t=${Date.now()}`, { cache: 'no-store' });
    if (!r || !r.ok) return false;
    const j = await r.json();
    return !!(j && typeof j.v === 'string' && j.v && j.v !== versiune);
  } catch {
    return false;    // fără rețea / fișier lipsă: nu știm → nu facem nimic
  }
}

// versiunea nouă: acum dacă pagina abia s-a deschis, altfel la următoarea schimbare de pagină
export function actualizeaza({ acum = (typeof performance !== 'undefined' ? performance.now() : Infinity) } = {}) {
  if (acum < PROASPAT_MS && reloadForNewVersion()) return 'acum';
  deActualizat = true;
  return 'la-urmatoarea-pagina';
}

export async function verificaVersiunea(opts = {}) {
  return (await versiuneNoua(opts)) ? actualizeaza(opts) : null;
}

// App.jsx, la fiecare schimbare de rută: true = pagina se încarcă din nou, cu versiunea nouă
export function laSchimbareaPaginii() {
  if (!deActualizat) return false;
  deActualizat = false;
  return reloadForNewVersion();
}

export function asteaptaActualizare() { return deActualizat; }
