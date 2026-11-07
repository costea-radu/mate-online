// =====================================================================
// src/lib/scrollToCard.js — revenirea la cardul testului după „Înapoi"
// (din PDF-uri și din testele interactive)
//
// Pagina duce cardul în mijlocul ecranului și îl ține acolo cât timp lista se
// mai așază (secțiunile se deschid, se încarcă stelele, imaginile…). Înainte,
// îl re-centra de 12 ori, la 250 ms — trei secunde în care orice derulare a
// elevului era trasă înapoi la card („derularea e câteva secunde înghețată").
// Acum:
//   • revenirea e la fel (prima centrare + re-centrare cât timp se mută cardul);
//   • de cum elevul derulează (rotița, degetul, tastele, un clic / bara de
//     derulare), pagina e a lui: nu mai re-centrăm nimic;
//   • când cardul nu se mai mișcă (lista s-a așezat), ne oprim singuri.
// Derularea spre card rămâne cea de până acum (lină: html { scroll-behavior:
// smooth }); cât durează animația, pagina se mișcă între punctul de plecare și
// card — asta e a noastră; o mișcare în afara acestui drum e a elevului.
// `env` (window / document) se poate înlocui în teste.
// =====================================================================
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ', 'Spacebar']);

export function scrollToCard(cardId, { initialDelay = 150, interval = 250, maxRecenters = 12, stableTicks = 2, env } = {}) {
  if (!cardId) return () => {};
  const win = (env && env.window) || (typeof window !== 'undefined' ? window : null);
  const doc = (env && env.document) || (typeof document !== 'undefined' ? document : null);
  if (!win || !doc) return () => {};
  let done = false;
  const timers = [];
  let findAttempts = 0, recenters = 0, stable = 0;
  let centered = false, lastTop = null;
  let path = null;     // [de la, până la] — unde poate fi pagina cât derulăm noi spre card

  const scrollY = () => win.scrollY || win.pageYOffset || 0;
  const docTop = (el) => el.getBoundingClientRect().top + scrollY();   // locul cardului în pagină (nu depinde de derulare)
  const later = (fn, ms) => timers.push(win.setTimeout(fn, ms));

  const onUser = () => { if (centered) finish(); };                  // după prima centrare, pagina e a elevului
  const onKey = (e) => { if (e && SCROLL_KEYS.has(e.key)) onUser(); };
  const opts = { passive: true, capture: true };
  const events = [['wheel', onUser], ['touchstart', onUser], ['touchmove', onUser], ['pointerdown', onUser], ['mousedown', onUser], ['keydown', onKey]];
  for (const [ev, fn] of events) win.addEventListener(ev, fn, opts);

  function finish() {
    if (done) return;
    done = true;
    timers.forEach((t) => win.clearTimeout(t));
    for (const [ev, fn] of events) win.removeEventListener(ev, fn, opts);
  }

  function center(el) {
    const from = scrollY();
    const to = docTop(el) + el.getBoundingClientRect().height / 2 - (win.innerHeight || 0) / 2;
    el.scrollIntoView({ block: 'center' });
    path = [Math.min(from, to) - 2, Math.max(from, to) + 2];
    centered = true;
  }

  function tick() {
    if (done) return;
    const el = doc.getElementById(`card-${cardId}`);
    if (!el) {
      if (findAttempts < 60) { findAttempts++; later(tick, 100); } else finish();
      return;
    }
    if (!centered) center(el);
    else {
      const top = docTop(el);
      const moved = Math.abs(top - lastTop) >= 1;
      // pagina a ieșit de pe drumul spre card, cu lista nemișcată → a derulat elevul (ex. cu bara de derulare)
      const y = scrollY();
      if (!moved && (y < path[0] || y > path[1])) { finish(); return; }
      if (moved) { stable = 0; center(el); }
      else if (++stable >= stableTicks) { finish(); return; }          // lista s-a așezat
    }
    lastTop = docTop(el);
    if (recenters++ < maxRecenters) later(tick, interval); else finish();
  }

  later(tick, initialDelay);
  return finish;
}

export default scrollToCard;
