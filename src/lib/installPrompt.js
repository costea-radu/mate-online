// =====================================================================
// src/lib/installPrompt.js — captează evenimentul de instalare PWA o
// singură dată pe încărcare și îl pune la dispoziția oricărei componente
// (bannerul plutitor + butonul din „Setări cont”).
//
// Ține minte și DACĂ aplicația e deja instalată (em_pwa_installed), ca
// invitația de instalare să NU mai apară cuiva care o are deja:
//  • la evenimentul `appinstalled` (instalare reușită);
//  • la orice pornire în fereastra proprie a aplicației (standalone) —
//    pe desktop/Android, aplicația instalată împarte localStorage cu
//    browserul, deci și tab-urile normale află;
//  • prin navigator.getInstalledRelatedApps() (Chrome/Edge), verificat
//    la fiecare încărcare — prinde și instalările mai vechi.
// Flagul se șterge singur când API-ul confirmă că aplicația NU mai e
// instalată (după dezinstalare invitația reapare).
// =====================================================================
let deferred = null;
const subs = new Set();
const FLAG = 'em_pwa_installed';

const notify = () => subs.forEach((f) => { try { f(); } catch { /* ignore */ } });

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS

// ── „E deja instalată?” — memorat local, verificat prin API unde există ──
const readFlag = () => { try { return localStorage.getItem(FLAG) === '1'; } catch { return false; } };
const writeFlag = (on) => { try { on ? localStorage.setItem(FLAG, '1') : localStorage.removeItem(FLAG); } catch { /* ignore */ } };

export const isInstalled = () => isStandalone() || readFlag();
export const markInstalled = () => { writeFlag(true); notify(); };

// Chrome/Edge: getInstalledRelatedApps() spune sigur dacă PWA-ul e instalat
// (manifestul se declară pe sine în `related_applications`).
// Returnează true / false / null (API indisponibil sau eșuat).
async function probeInstalled() {
  try {
    if (typeof navigator.getInstalledRelatedApps !== 'function') return null;
    const apps = await navigator.getInstalledRelatedApps();
    return Array.isArray(apps) && apps.length > 0;
  } catch { return null; }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    // Browserul oferă instalarea deși noi o credeam instalată? Întrebăm
    // API-ul sigur: doar un „NU e instalată” ferm re-armează invitația
    // (Edge, de exemplu, emite evenimentul și când aplicația e instalată).
    if (readFlag()) {
      probeInstalled().then((inst) => { if (inst === false) { writeFlag(false); notify(); } });
    }
    notify();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    writeFlag(true);
    notify();
  });

  if (isStandalone()) {
    // Rulăm chiar în aplicația instalată → ține minte pentru tab-urile normale.
    writeFlag(true);
  } else {
    // Verificare proactivă la fiecare încărcare în browser: prinde
    // instalările făcute înainte de introducerea acestui flag.
    probeInstalled().then((inst) => { if (inst === true) { writeFlag(true); notify(); } });
  }
}

export const getInstallPrompt = () => deferred;
export const clearInstallPrompt = () => { deferred = null; };
export const onInstallChange = (f) => { subs.add(f); return () => subs.delete(f); };
