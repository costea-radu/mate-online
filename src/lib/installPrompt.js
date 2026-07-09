// =====================================================================
// src/lib/installPrompt.js — captează evenimentul de instalare PWA o
// singură dată pe încărcare și îl pune la dispoziția oricărei componente
// (bannerul plutitor + butonul din „Setări cont”).
// =====================================================================
let deferred = null;
const subs = new Set();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    subs.forEach((f) => { try { f(); } catch { /* ignore */ } });
  });
}

export const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true;

export const isIOS = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPadOS

export const getInstallPrompt = () => deferred;
export const clearInstallPrompt = () => { deferred = null; };
export const onInstallChange = (f) => { subs.add(f); return () => subs.delete(f); };
