// =====================================================================
// src/lib/chatAlert.js — SUNET + VIBRAȚIE la mesaj nou
//
// Sunetul e generat în browser (Web Audio), nu adus dintr-un fișier: două note
// scurte, ca la o notificare de telefon. Așa nu se încarcă nimic în plus și
// merge și fără rețea.
//
// Browserele nu lasă niciun sunet să pornească înainte ca omul să fi atins
// pagina măcar o dată — de aceea `pregatesteSunetul()` deblochează contextul
// audio la prima atingere sau apăsare de tastă, o singură dată.
//
// Vibrația merge pe Android (Chrome); pe iPhone e ignorată, fără eroare.
//
// Comutatorul „🔔 / 🔕" ține de acest browser (localStorage) și oprește ȘI
// sunetul, ȘI vibrația. Alerta de pe ecran (bula din colț) rămâne, ea nu
// deranjează pe nimeni.
// =====================================================================
const CHEIE = 'chat_alerte_sunet';

/** Sunetul și vibrația sunt pornite? (implicit da) */
export function alertePornite() {
  try { return localStorage.getItem(CHEIE) !== '0'; } catch { return true; }
}

/** Pornește / oprește sunetul și vibrația pe acest browser. */
export function setAlerte(on) {
  try { localStorage.setItem(CHEIE, on ? '1' : '0'); } catch { /* mod privat */ }
}

// ─── Sunet ───────────────────────────────────────────────────────────────────
let ctx = null;
function context() {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  } catch { ctx = null; }
  return ctx;
}

/** Deblochează sunetul la primul gest al utilizatorului (cerință de browser). */
export function pregatesteSunetul() {
  const deblocheaza = () => {
    const c = context();
    if (c && c.state === 'suspended') c.resume().catch(() => {});
    window.removeEventListener('pointerdown', deblocheaza);
    window.removeEventListener('keydown', deblocheaza);
  };
  window.addEventListener('pointerdown', deblocheaza, { once: true });
  window.addEventListener('keydown', deblocheaza, { once: true });
}

/** „Ding-dong" scurt: două note, cu stingere lină. */
export function sunaMesajNou() {
  if (!alertePornite()) return;
  try {
    const c = context();
    if (!c) return;
    if (c.state === 'suspended') c.resume().catch(() => {});
    const t0 = c.currentTime;
    [[880, 0], [1174.66, 0.13]].forEach(([hz, dt]) => {
      const osc = c.createOscillator();
      const vol = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = hz;
      vol.gain.setValueAtTime(0.0001, t0 + dt);
      vol.gain.exponentialRampToValueAtTime(0.16, t0 + dt + 0.02);
      vol.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 0.24);
      osc.connect(vol);
      vol.connect(c.destination);
      osc.start(t0 + dt);
      osc.stop(t0 + dt + 0.28);
    });
  } catch { /* fără sunet — alerta de pe ecran rămâne */ }
}

// ─── Vibrație (telefon) ──────────────────────────────────────────────────────
export function vibreaza(model = [90, 60, 90]) {
  if (!alertePornite()) return;
  try { navigator.vibrate?.(model); } catch { /* neacceptat */ }
}

// ─── Notificare de sistem (doar dacă omul a permis-o deja) ──────────────────
// Nu cerem noi permisiunea din senin; o cere butonul din bula de alertă.
export function stareNotificari() {
  try { return window.Notification ? Notification.permission : 'unsupported'; }
  catch { return 'unsupported'; }
}

export async function cereNotificari() {
  try {
    if (!window.Notification || Notification.permission !== 'default') return stareNotificari();
    return await Notification.requestPermission();
  } catch { return 'unsupported'; }
}

/** Notificare în afara paginii, când tabul e în fundal. */
export function alertaSistem({ title, body }) {
  try {
    if (!window.Notification || Notification.permission !== 'granted') return;
    if (document.visibilityState === 'visible') return;   // e deja pe ecran, ajunge bula
    // Pe Android constructorul aruncă (cere service worker) — prindem tăcut.
    const n = new Notification(title, { body, tag: 'examenmate-mesaj', icon: '/pwa-192x192.png' });
    n.onclick = () => { try { window.focus(); n.close(); } catch { /* ignore */ } };
  } catch { /* fără notificare de sistem */ }
}
