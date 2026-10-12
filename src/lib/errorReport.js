// =====================================================================
// src/lib/errorReport.js — erorile JavaScript ale vizitatorilor → /api/client-error
//
// Agentul de debug din Admin pornește de la erorile REALE ale site-ului (pe ce
// pagină, de câte ori, cu ce stivă). Aici le prindem: erorile neprinse, promisiunile
// respinse și ce prinde ErrorBoundary (pagina albă). Fără date personale: doar
// mesajul, stiva, calea paginii (fără parametri) și versiunea aplicației.
// O eroare se trimite o singură dată pe pagină; cel mult 8 pe încărcare.
// Nu rulează în dezvoltare (npm run dev) și nici pe localhost.
// NU se trimit (nu sunt erori ale site-ului): fișierele unei versiuni vechi după un
// deploy (pagina se reîncarcă singură — lib/chunkReload.js), eșecul înregistrării
// service worker-ului în unele browsere (prins în main.jsx), erorile din extensiile
// browserului. O promisiune respinsă fără Error („Rejected") vine cu tipul motivului.
// =====================================================================
import { CHUNK_ERROR, reloadForNewVersion } from './chunkReload';

const BENIGN = /Failed to register a ServiceWorker|ServiceWorker script evaluation failed|An unknown error occurred when fetching the script/i;
const EXTENSION = /(?:chrome|moz|safari(?:-web)?)-extension:\/\//i;
const sent = new Set();
let count = 0;
const RELEASE = String(import.meta.env.VITE_VERCEL_GIT_COMMIT_SHA || '').slice(0, 7) || null;

function enabled() {
  if (typeof window === 'undefined' || import.meta.env.DEV) return false;
  return !/^(localhost|127\.|192\.168\.|10\.)/.test(window.location.hostname);
}

// motivul unei promisiuni respinse fără Error (ex. șirul „Rejected"): tipul lui, ca agentul
// de debug să vadă de unde vine
function reasonInfo(err) {
  if (err instanceof Error || err == null) return '';
  let shape = '';
  try { shape = typeof err === 'object' ? JSON.stringify(err).slice(0, 300) : ''; } catch { /* circular */ }
  const ctor = err && err.constructor && err.constructor.name ? ` / ${err.constructor.name}` : '';
  return `motivul respingerii: ${typeof err}${ctor}${shape ? ` ${shape}` : ''}`;
}

export function reportError(err, extra = null) {
  try {
    if (!enabled() || count >= 8 || window.__mateReloading) return;
    const e = err instanceof Error ? err : { message: typeof err === 'string' ? err : (err && err.message) || String(err), stack: err && err.stack };
    const message = String(e.message || '').slice(0, 500);
    if (!message) return;
    // o versiune nouă a site-ului: pagina se reîncarcă (eroarea rămâne doar dacă s-a reîncărcat deja)
    if (CHUNK_ERROR.test(message) && reloadForNewVersion()) return;
    if (BENIGN.test(message)) return;
    const stack = [String(e.stack || ''), extra ? String(extra) : '', reasonInfo(err)].filter(Boolean).join('\n').slice(0, 4000);
    if (EXTENSION.test(stack)) return;
    const key = `${message}|${stack.split('\n').slice(0, 2).join('|')}`;
    if (sent.has(key)) return;
    sent.add(key);
    count++;
    const body = JSON.stringify({ message, stack, url: window.location.pathname, release: RELEASE });
    fetch('/api/client-error', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true }).catch(() => {});
  } catch { /* raportarea nu are voie să strice nimic */ }
}

export function installErrorReporting() {
  if (!enabled() || window.__mateErrors) return;
  window.__mateErrors = true;
  window.addEventListener('error', (ev) => {
    // resursele care nu se încarcă (img, script) vin tot aici, fără ev.error
    if (!ev.error && !ev.message) return;
    reportError(ev.error || { message: ev.message, stack: ev.filename ? `${ev.filename}:${ev.lineno}:${ev.colno}` : '' });
  });
  window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason || 'Promisiune respinsă fără motiv'));
}
