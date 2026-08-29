// =====================================================================
// src/lib/arena.js — starea Arenei (XP, streak, misiune, ligă), cu memorie
// scurtă ca să nu cerem serverul la fiecare navigare.
// Ascultă/emite evenimentul 'em:arena' — indicatorul din Navbar și pagina
// /arena se actualizează împreună după fiecare exercițiu rezolvat.
// =====================================================================
import { aiClient } from './aiClient';

const TTL = 3 * 60 * 1000;
let cache = null;
let cachedAt = 0;
let inflight = null;

export async function arenaState({ force = false } = {}) {
  if (!force && cache && Date.now() - cachedAt < TTL) return cache;
  // `force` NU se poate lipi de o cerere deja pornită: aceea a plecat înainte
  // de XP-ul tocmai câștigat și ar întoarce valorile vechi.
  if (inflight && !force) return inflight;
  inflight = aiClient.gamificare()
    .then((r) => { cache = r; cachedAt = Date.now(); return r; })
    .catch((e) => { cache = null; throw e; })
    .finally(() => { inflight = null; });
  return inflight;
}

// După ce s-a câștigat XP: invalidăm memoria și anunțăm componentele.
export function arenaChanged(patch = null) {
  cache = null;
  cachedAt = 0;
  try { window.dispatchEvent(new CustomEvent('em:arena', { detail: patch })); } catch { /* SSR */ }
}

export function onArenaChange(fn) {
  const h = (e) => fn(e.detail || null);
  window.addEventListener('em:arena', h);
  return () => window.removeEventListener('em:arena', h);
}
