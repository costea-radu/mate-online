// =====================================================================
// src/lib/live/notify.js — „🔔 ANUNȚĂ-MĂ CÂND E GATA" (sala de așteptare live)
//
// Lecția nouă se pregătește în câteva minute; elevul poate face altceva între
// timp. Când lecția e gata, îl anunțăm pe toate căile pe care le are browserul:
//   · sunetul „gata" + vibrația (chatAlert.js) — mereu;
//   · titlul tabului clipește („✅ Lecția e gata!") cât pagina e în fundal;
//   · notificarea de sistem (dacă a permis-o): prin service worker, ca să meargă
//     și pe Android (unde `new Notification()` nu e voie) și ca un clic pe ea să
//     aducă tabul în față (public/sw-push.js);
//   · Web Push: abonarea (PushManager) ajunge la server (api/live.js → notify) —
//     notificarea vine și cu pagina ÎNCHISĂ (Chrome, Edge, Firefox, Android,
//     aplicația ExamenMate; pe iPhone doar aplicația pusă pe ecranul principal).
// Permisiunea se cere DOAR la apăsarea butonului (cerință a browserelor).
// =====================================================================

export function notifySupport() {
  const w = typeof window !== 'undefined' ? window : {};
  const system = 'Notification' in w;
  const push = system && typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in w;
  let permission = 'unsupported';
  try { if (system) permission = Notification.permission; } catch { permission = 'unsupported'; }
  // iPhone / iPad fără aplicația de pe ecranul principal: Safari nu are notificări pentru site-uri
  const ios = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent || '') && !w.MSStream;
  const standalone = !!(w.matchMedia && w.matchMedia('(display-mode: standalone)').matches) || !!(typeof navigator !== 'undefined' && navigator.standalone);
  return { system, push, permission, ios, standalone };
}

export async function askNotifyPermission() {
  try {
    if (!('Notification' in window)) return 'unsupported';
    if (Notification.permission !== 'default') return Notification.permission;
    return await Notification.requestPermission();
  } catch { return 'unsupported'; }
}

// cheia publică VAPID (base64url) → Uint8Array (applicationServerKey)
function keyBytes(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
const sameKey = (a, b) => {
  if (!a || !b || a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
};

// abonarea Web Push a acestui browser (refolosită dacă există, cu aceeași cheie) → JSON sau null
export async function subscribePush(publicKey) {
  try {
    if (!publicKey || !('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    if (Notification.permission !== 'granted') return null;
    const reg = await Promise.race([navigator.serviceWorker.ready, new Promise((ok) => setTimeout(() => ok(null), 6000))]);
    if (!reg || !reg.pushManager) return null;
    const key = keyBytes(publicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub && sub.options?.applicationServerKey && !sameKey(sub.options.applicationServerKey, key.buffer)) {
      try { await sub.unsubscribe(); } catch { /* o facem din nou */ }
      sub = null;
    }
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    return sub ? sub.toJSON() : null;
  } catch { return null; }
}

// notificarea de sistem, din pagină (tabul în fundal). tag-ul ei e același cu al notificării
// Web Push de pe server („live-<id>"): dacă vin amândouă, a doua o înlocuiește pe prima.
export async function systemNotify({ title, body, tag = 'examenmate-live', url = null }) {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return false;
    const opts = { body, tag, icon: '/pwa-192x192.png', badge: '/pwa-192x192.png', data: { url: url || window.location.pathname + window.location.search }, renotify: true, requireInteraction: true, vibrate: [200, 100, 200, 100, 400] };
    const reg = 'serviceWorker' in navigator ? await Promise.race([navigator.serviceWorker.getRegistration(), new Promise((ok) => setTimeout(() => ok(null), 2500))]) : null;
    if (reg && reg.showNotification) { await reg.showNotification(title, opts); return true; }
    const n = new Notification(title, opts);
    n.onclick = () => { try { window.focus(); n.close(); } catch { /* ignore */ } };
    return true;
  } catch { return false; }
}

// titlul tabului clipește cât pagina e în fundal; se oprește singur când elevul revine
export function flashTitle(text) {
  if (typeof document === 'undefined') return () => {};
  const original = document.title;
  let on = true, timer = null;          // pornește cu textul „gata", apoi alternează la fiecare secundă
  const stop = () => {
    clearInterval(timer); timer = null;
    document.title = original;
    document.removeEventListener('visibilitychange', onVis);
  };
  const onVis = () => { if (document.visibilityState === 'visible') stop(); };
  if (document.visibilityState === 'visible') return () => {};
  timer = setInterval(() => { on = !on; document.title = on ? text : original; }, 1000);
  document.title = text;
  document.addEventListener('visibilitychange', onVis);
  return stop;
}

export const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';
