// =====================================================================
// src/lib/vizite.js — vizitele din site, pentru „📊 Statistici de utilizare"
// (Admin → 🤖 AI Tutor). La fiecare schimbare de rută (App.jsx → VizitaTracker)
// trimitem serverului (api/vizita.js) DOAR: ruta (fără ?…), materialul deschis
// (id-ul din /exercitiu?id=… și /pdf-viewer?id=…), dispozitivul (telefon /
// tabletă / calculator) și, la prima pagină din vizită, domeniul de unde a venit.
//
// Confidențialitate:
//   · cine e autentificat e recunoscut din token (pe server), nu din browser;
//   · vizitatorii fără cont primesc un id anonim (localStorage `em_vid`) DOAR
//     dacă au acceptat cookie-urile (CookieConsent) — altfel vizita se numără,
//     dar fără niciun identificator;
//   · adminii și paginile de admin nu se trimit deloc;
//   · nimic nu pleacă la terți (nu e Google Analytics) și nicio eroare de aici
//     nu ajunge în pagină.
// =====================================================================
import { authHeaders } from './api';
import { hasConsent } from './analytics';

const VID_KEY = 'em_vid';
const REF_KEY = 'em_ref_trimis';
let ultima = { path: null, at: 0 };

// id-ul anonim al vizitatorului — doar cu acordul pentru cookie-uri
function idAnonim() {
  if (!hasConsent()) return null;
  try {
    let v = localStorage.getItem(VID_KEY);
    if (!v) {
      v = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `v-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(VID_KEY, v);
    }
    return v;
  } catch { return null; }
}

export function dispozitiv() {
  try {
    const w = window.innerWidth || 1200;
    const tactil = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    if (w < 768) return 'telefon';
    if (tactil && w < 1300) return 'tableta';
    return 'calculator';
  } catch { return null; }
}

// domeniul de unde a venit — o singură dată pe vizită (prima pagină), doar extern
function sursa() {
  try {
    if (sessionStorage.getItem(REF_KEY)) return null;
    sessionStorage.setItem(REF_KEY, '1');
    const ref = document.referrer;
    if (!ref) return null;
    const host = new URL(ref).hostname;
    if (!host || host === window.location.hostname) return null;
    return host;
  } catch { return null; }
}

// materialul deschis: /exercitiu?id=… și /pdf-viewer?id=…
export function materialDin(pathname, search) {
  if (pathname !== '/exercitiu' && pathname !== '/pdf-viewer') return null;
  try {
    const id = new URLSearchParams(search || '').get('id');
    return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
  } catch { return null; }
}

export async function trimiteVizita({ pathname, search = '', isAdmin = false } = {}) {
  try {
    if (!pathname || isAdmin) return;
    if (pathname === '/admin' || pathname.startsWith('/admin/')) return;
    const cheie = pathname + '|' + (materialDin(pathname, search) || '');
    // aceeași pagină de două ori într-o clipă (redesenare, StrictMode) → o singură vizită
    if (ultima.path === cheie && Date.now() - ultima.at < 3000) return;
    ultima = { path: cheie, at: Date.now() };
    const body = {
      path: pathname,
      contentId: materialDin(pathname, search),
      visitor: idAnonim(),
      device: dispozitiv(),
      referrer: sursa(),
    };
    await fetch('/api/vizita', { method: 'POST', headers: await authHeaders(), body: JSON.stringify(body), keepalive: true });
  } catch { /* statisticile nu strică nimic */ }
}
