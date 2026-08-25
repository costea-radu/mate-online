// =====================================================================
// src/lib/testMode.js — „elevul are un test pe grupă în desfășurare"
//
// Cât timp e pornit:
//   • Profesorul Virtual e oprit — widgetul plutitor, butonul „Profesorul
//     virtual" din vizualizatoare și caseta de întrebări din chat;
//   • mesageria e oprită (canalul grupei și discuțiile cu colegii).
//
// Rămâne pornită CORECTAREA („📝 Răspunde în chat"): la testele PDF ea e
// modul în care punctajul ajunge la profesor. Elevul nu poate CERE ajutor,
// dar își poate TRIMITE răspunsurile.
//
// Semnalul ăsta e doar pentru interfață — adevărul e pe server
// (`group_assignment_picks.active_until`, api/_lib/testlock.js), care refuză
// oricum cererile chiar dacă elevul deschide alt tab.
// =====================================================================
import { useEffect, useState } from 'react';

const KEY = 'em_test_activ';
const EVENT = 'mate:test-mode';
const WINDOW_MS = 3 * 3600 * 1000;   // aceeași fereastră ca pe server

function read() {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    if (!v || !v.until || Date.now() > v.until) { sessionStorage.removeItem(KEY); return null; }
    return v;
  } catch { return null; }
}

export function isTestMode() { return !!read(); }
export function testModeInfo() { return read(); }

export function startTestMode({ pickId = null, title = null } = {}) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ pickId, title, until: Date.now() + WINDOW_MS }));
  } catch { /* sessionStorage blocat — serverul blochează oricum */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { active: true } })); } catch { /* ignore */ }
}

export function endTestMode() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { active: false } })); } catch { /* ignore */ }
}

// Hook: `true` cât timp testul e în desfășurare (se actualizează la pornire /
// oprire, la revenirea în tab și la schimbarea paginii).
export function useTestMode() {
  const [on, setOn] = useState(() => isTestMode());
  useEffect(() => {
    const check = () => setOn(isTestMode());
    check();
    window.addEventListener(EVENT, check);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    const iv = setInterval(check, 60000);   // expirarea celor 3 ore
    return () => {
      window.removeEventListener(EVENT, check);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', check);
      clearInterval(iv);
    };
  }, []);
  return on;
}
