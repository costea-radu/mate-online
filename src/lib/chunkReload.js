// =====================================================================
// src/lib/chunkReload.js — o VERSIUNE NOUĂ a site-ului, într-un tab deschis de dinainte
//
// După un deploy, un tab vechi (mai ales pe telefon, la redeschidere, sau Admin ținut
// deschis) cere un fișier JS/CSS cu numele versiunii vechi, care nu mai există. Browserul
// spune asta în multe feluri — „'text/html' is not a valid JavaScript MIME type" (Safari),
// „Failed to fetch dynamically imported module" (Chrome), „Unable to preload CSS for
// /assets/…" (Vite)… Nu e o eroare a site-ului: pagina se reîncarcă O SINGURĂ dată (marcaj
// de 15 secunde anti-buclă) și ia versiunea nouă; agentul de debug nu o mai primește.
// =====================================================================
export const CHUNK_ERROR = /'text\/html' is not a valid JavaScript MIME type|Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Expected a JavaScript(?:-or-Wasm)? module script|Loading (?:CSS )?chunk \S+ failed|ChunkLoadError/i;

// true = pagina se reîncarcă acum; false = s-a reîncărcat deja de curând (eroarea e reală)
export function reloadForNewVersion() {
  if (typeof window === 'undefined') return false;
  const key = 'mate_chunk_reload';
  try {
    const last = Number(window.sessionStorage.getItem(key) || 0);
    if (Date.now() - last < 15000) return false;            // deja am reîncărcat → nu bucla
    window.sessionStorage.setItem(key, String(Date.now()));
  } catch {
    // storage indisponibil (ex. Safari privat) → marcaj în memorie ca să nu buclăm
    if (window.__mateChunkReloaded) return false;
    window.__mateChunkReloaded = true;
  }
  window.__mateReloading = true;                             // erorile de până la reîncărcare nu se mai raportează
  window.location.reload();
  return true;
}
