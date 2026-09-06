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

// Când profesorul a pus o limită de timp (10 minute – 3 ore), `deadline` e
// momentul în care testul se închide singur. Vine de la server (calculat din
// `started_at`), deci nu se resetează dacă elevul redeschide pagina.
export const TIMEUP_EVENT = 'mate:test-timeup';

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

// `deadline` — ISO sau ms: sfârșitul timpului de lucru (null = fără limită).
export function startTestMode({ pickId = null, title = null, deadline = null } = {}) {
  const dl = deadline ? new Date(deadline).getTime() : null;
  try {
    sessionStorage.setItem(KEY, JSON.stringify({
      pickId, title,
      deadline: Number.isFinite(dl) ? dl : null,
      // fereastra de siguranță rămâne de 3 ore și DUPĂ termenul testului, ca
      // să apucăm să afișăm „timpul a expirat" și să închidem testul curat
      until: Date.now() + WINDOW_MS,
    }));
  } catch { /* sessionStorage blocat — serverul blochează oricum */ }
  try { window.dispatchEvent(new CustomEvent(EVENT, { detail: { active: true } })); } catch { /* ignore */ }
}

// Câte milisecunde mai are elevul (null = test fără limită de timp).
export function testTimeLeft() {
  const v = read();
  if (!v || !v.deadline) return null;
  return Math.max(0, v.deadline - Date.now());
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

// Hook pentru cronometru: milisecundele rămase, actualizate din secundă în
// secundă. `null` = testul nu are limită de timp (sau nu e niciun test pornit).
// Când ajunge la 0, anunță o singură dată prin evenimentul `mate:test-timeup`.
export function useTestCountdown() {
  const [left, setLeft] = useState(() => testTimeLeft());
  useEffect(() => {
    let anuntat = false;
    const tick = () => {
      const ms = testTimeLeft();
      setLeft(ms);
      if (ms === 0 && !anuntat) {
        anuntat = true;
        try { window.dispatchEvent(new CustomEvent(TIMEUP_EVENT)); } catch { /* ignore */ }
      }
      if (ms == null) anuntat = false;
    };
    tick();
    const iv = setInterval(tick, 1000);
    window.addEventListener(EVENT, tick);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(iv);
      window.removeEventListener(EVENT, tick);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, []);
  return left;
}

// „1 h 30 min", „45 min", „08:12" — cum se scrie timpul rămas.
export function fmtRamas(ms) {
  if (ms == null) return '';
  const t = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// „10 minute", „1 oră", „1 oră și 30 de minute", „2 ore" — timpul ALES.
// „de" se pune de la 20 în sus (10 minute, dar 30 de minute) — ca în română.
export function fmtDurata(min) {
  const n = parseInt(min, 10);
  if (!Number.isFinite(n) || n <= 0) return 'fără limită de timp';
  const h = Math.floor(n / 60), m = n % 60;
  const ore = h === 0 ? '' : h === 1 ? '1 oră' : `${h} ore`;
  const minute = m === 0 ? '' : m === 1 ? '1 minut' : (m >= 20 ? `${m} de minute` : `${m} minute`);
  if (ore && minute) return `${ore} și ${minute}`;
  return ore || minute;
}
