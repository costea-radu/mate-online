// =====================================================================
// src/lib/analytics.js — GA4 + Meta Pixel, cu consimțământ (GDPR).
//
// Reguli implementate aici:
//   1. NIMIC nu se încarcă până când vizitatorul nu apasă „Accept" în
//      bannerul de cookie-uri (src/components/CookieConsent.jsx). Fără
//      consimțământ nu se face nicio cerere către Google sau Meta.
//   2. Evenimentele trimise ÎNAINTE de consimțământ intră într-o coadă
//      scurtă; dacă vizitatorul acceptă, coada se trimite, dacă refuză,
//      se aruncă. Așa nu pierdem conversia cuiva care acceptă pe pagina
//      de mulțumire.
//   3. Un singur apel `track()` scrie în ambele sisteme, cu numele
//      corect pentru fiecare (GA4 și Meta au denumiri diferite).
//
// Variabile de mediu (Vercel → Settings → Environment Variables):
//   VITE_GA4_ID         G-XXXXXXXXXX      (Google Analytics 4)
//   VITE_META_PIXEL_ID  1234567890        (Meta / Facebook Pixel)
// Lipsesc → codul nu face nimic (dezvoltare locală, preview-uri).
// =====================================================================

const GA4_ID = import.meta.env.VITE_GA4_ID || '';
const PIXEL_ID = import.meta.env.VITE_META_PIXEL_ID || '';

const STORAGE_KEY = 'em_cookie_consent'; // 'granted' | 'denied'
const MAX_QUEUE = 20;

let loaded = false;
let queue = [];

export function consentState() {
  try { return localStorage.getItem(STORAGE_KEY) || null; }
  catch { return null; } // cookie-uri blocate / mod privat → tratăm ca „nedecis"
}

export function hasConsent() {
  return consentState() === 'granted';
}

// ─── Încărcarea scripturilor (o singură dată, doar cu consimțământ) ──────────
function loadGA4() {
  if (!GA4_ID || window.gtag) return;
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = gtag;

  // Consent Mode v2 — declarăm explicit ce e permis (am cerut acordul).
  gtag('consent', 'default', {
    ad_storage: 'granted',
    ad_user_data: 'granted',
    ad_personalization: 'granted',
    analytics_storage: 'granted',
  });

  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA4_ID)}`;
  document.head.appendChild(s);

  gtag('js', new Date());
  // SPA: trimitem noi page_view la fiecare schimbare de rută.
  gtag('config', GA4_ID, { send_page_view: false });
}

function loadPixel() {
  if (!PIXEL_ID || window.fbq) return;
  /* eslint-disable */
  !function (f, b, e, v, n, t, s) {
    if (f.fbq) return; n = f.fbq = function () {
      n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
    };
    if (!f._fbq) f._fbq = n; n.push = n; n.loaded = !0; n.version = '2.0'; n.queue = [];
    t = b.createElement(e); t.async = !0; t.src = v;
    s = b.getElementsByTagName(e)[0]; s.parentNode.insertBefore(t, s);
  }(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');
  /* eslint-enable */
  window.fbq('consent', 'grant');
  window.fbq('init', PIXEL_ID);
}

function loadAll() {
  if (loaded) return;
  loaded = true;
  try { loadGA4(); } catch (e) { console.warn('GA4:', e.message); }
  try { loadPixel(); } catch (e) { console.warn('Meta Pixel:', e.message); }
}

// ─── API public ─────────────────────────────────────────────────────────────

// Se apelează o dată, la pornirea aplicației. Încarcă doar dacă vizitatorul
// și-a dat deja acordul într-o vizită anterioară.
export function initAnalytics() {
  if (hasConsent()) { loadAll(); flush(); }
}

export function setConsent(granted) {
  try { localStorage.setItem(STORAGE_KEY, granted ? 'granted' : 'denied'); } catch { /* mod privat */ }
  if (granted) { loadAll(); flush(); }
  else { queue = []; }
}

function flush() {
  const pending = queue;
  queue = [];
  pending.forEach(({ fn, args }) => { try { fn(...args); } catch { /* ignoră */ } });
}

function defer(fn, ...args) {
  if (consentState() === 'denied') return true;   // a refuzat → nu reținem nimic
  if (!hasConsent()) {                            // încă nu a decis → coadă
    if (queue.length < MAX_QUEUE) queue.push({ fn, args });
    return true;
  }
  return false;
}

// Vizualizare de pagină (SPA — se apelează la fiecare schimbare de rută).
export function trackPageView(path, title) {
  if (defer(trackPageView, path, title)) return;
  const page = path || (typeof window !== 'undefined' ? window.location.pathname : '/');
  if (window.gtag && GA4_ID) {
    window.gtag('event', 'page_view', {
      page_path: page,
      page_title: title || document.title,
      page_location: window.location.href,
    });
  }
  if (window.fbq) window.fbq('track', 'PageView');
}

// Evenimentele care contează. `name` e numele GA4; maparea către Meta e mai jos.
const META_MAP = {
  sign_up: 'CompleteRegistration',
  begin_checkout: 'InitiateCheckout',
  purchase: 'Purchase',
  start_trial: 'StartTrial',
  lead: 'Lead',
};

export function track(name, params = {}) {
  if (defer(track, name, params)) return;
  if (window.gtag && GA4_ID) window.gtag('event', name, params);
  if (window.fbq) {
    const metaName = META_MAP[name];
    const metaParams = {};
    if (params.value != null) metaParams.value = params.value;
    if (params.currency) metaParams.currency = params.currency;
    if (params.plan) metaParams.content_name = params.plan;
    if (metaName) window.fbq('track', metaName, metaParams);
    else window.fbq('trackCustom', name, params);
  }
}

// ─── Scurtături pentru evenimentele de conversie ────────────────────────────

export const trackSignUp = (method = 'email') => track('sign_up', { method });

export const trackBeginCheckout = (plan, valueLei) =>
  track('begin_checkout', { plan, value: valueLei, currency: 'RON' });

// Abonare reușită. `plan` = 'lunar' | 'anual'.
export function trackPurchase({ plan, valueLei, transactionId, trial = false }) {
  track('purchase', {
    plan,
    value: valueLei,
    currency: 'RON',
    transaction_id: transactionId || undefined,
  });
  if (trial) track('start_trial', { plan, value: valueLei, currency: 'RON' });
}

// Elev asociat cu un părinte + test inițial gratuit pornit — pașii care duc
// la abonare, urmăriți ca să știm care canal aduce oameni care chiar încep.
export const trackParentLink = () => track('lead', { method: 'asociere_parinte' });
export const trackFreeAssessment = () => track('free_assessment_started', {});
