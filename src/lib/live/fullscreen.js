// =====================================================================
// src/lib/live/fullscreen.js — ECRANUL COMPLET al sălii (Fullscreen API,
// cu prefixul Safari). Folosit de sala live și de „Pregătirea de examen".
// Pe iPhone, Safari nu permite ecranul complet pentru o pagină (doar pentru
// video) — acolo butonul nu apare (fsSupported() = false).
// =====================================================================
import { useEffect, useState } from 'react';

export const fsElement = () => (typeof document === 'undefined' ? null : document.fullscreenElement || document.webkitFullscreenElement || null);

export function fsSupported() {
  if (typeof document === 'undefined') return false;
  const el = document.documentElement;
  return !!(document.fullscreenEnabled || document.webkitFullscreenEnabled || el.requestFullscreen || el.webkitRequestFullscreen);
}

export function enterFs(el) {
  const f = el && (el.requestFullscreen || el.webkitRequestFullscreen);
  if (!f) return false;
  try { const p = f.call(el, { navigationUI: 'hide' }); if (p && p.catch) p.catch(() => {}); return true; } catch { return false; }
}

export function exitFs() {
  const f = document.exitFullscreen || document.webkitExitFullscreen;
  if (f && fsElement()) { try { const p = f.call(document); if (p && p.catch) p.catch(() => {}); } catch { /* ignore */ } }
}

export function toggleFs(el) { if (fsElement()) exitFs(); else enterFs(el); }

// true cât timp sala e pe tot ecranul
export function useIsFullscreen() {
  const [on, setOn] = useState(() => !!fsElement());
  useEffect(() => {
    const onFs = () => setOn(!!fsElement());
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);
    return () => { document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('webkitfullscreenchange', onFs); };
  }, []);
  return on;
}
