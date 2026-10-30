// =====================================================================
// api/_lib/vizite.js — vizitele din site, pentru „📊 Statistici de utilizare"
// (Admin → 🤖 AI Tutor). Logica pură (testată în test/statistici-utilizare.test.js).
//
// O vizită = o rută văzută în aplicație (src/lib/vizite.js o trimite la fiecare
// schimbare de pagină). Nu avem încredere în nimic din browser: ruta se
// curăță (fără ?…, fără caractere ciudate, scurtă), materialul trebuie să fie
// un UUID, dispozitivul unul din trei, sursa doar un domeniu, iar id-ul anonim
// al vizitatorului (trimis DOAR cu acordul pentru cookie-uri) are o formă fixă.
// Rutele de admin nu se numără. Utilizatorul îl stabilește serverul, din token.
// =====================================================================

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DISPOZITIVE = ['telefon', 'tableta', 'calculator'];
const MAX_PATH = 160;

// „/clase/clasa-7?x=1#y" → „/clase/clasa-7"; null dacă nu e o rută validă
function curataRuta(p) {
  let s = String(p == null ? '' : p).trim().split(/[?#]/)[0];
  if (!s.startsWith('/')) return null;
  s = s.replace(/\/{2,}/g, '/');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  try { s = decodeURIComponent(s); } catch { /* rămâne cum e */ }
  // litere (și cu diacritice), cifre, - _ . / ~ % — altceva nu e o rută a site-ului
  if (!/^[\p{L}\p{N}\-_./~%]+$/u.test(s)) return null;
  if (s.length > MAX_PATH) return null;
  // adminul nu intră în statistici (nici paginile lui)
  if (s === '/admin' || s.startsWith('/admin/')) return null;
  return s;
}

// „https://www.google.com/search?q=…" → „google.com"; null pentru altceva
function domeniu(ref) {
  const s = String(ref == null ? '' : ref).trim();
  if (!s) return null;
  let host = s;
  try { host = new URL(/^[a-z]+:\/\//i.test(s) ? s : `https://${s}`).hostname; } catch { return null; }
  host = host.toLowerCase().replace(/^www\./, '').replace(/^m\./, '');
  if (!/^[a-z0-9.-]{3,80}$/.test(host) || !host.includes('.')) return null;
  return host;
}

// Corpul primit de la browser → rândul din page_views (fără user_id: îl pune
// serverul) sau null (nu se înregistrează nimic).
function curataVizita(body, { siteHost = null } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const path = curataRuta(b.path);
  if (!path) return null;
  const contentId = UUID_RE.test(String(b.contentId || '')) ? String(b.contentId).toLowerCase() : null;
  const visitor = /^[a-z0-9-]{8,40}$/i.test(String(b.visitor || '')) ? String(b.visitor) : null;
  const device = DISPOZITIVE.includes(b.device) ? b.device : null;
  let referrer = domeniu(b.referrer);
  // venit din propriul site → nu e o „sursă"
  if (referrer && siteHost && (referrer === siteHost || referrer.endsWith(`.${siteHost}`))) referrer = null;
  return { path, content_id: contentId, visitor, device, referrer };
}

// Plafon simplu per adresă IP (în memoria instanței): o pagină care trimite
// vizite în buclă nu umple tabela. Fereastră de un minut.
function limitator({ max = 90, windowMs = 60000 } = {}) {
  const hits = new Map();
  return function permis(key, now = Date.now()) {
    const k = String(key || '?');
    const e = hits.get(k);
    if (!e || now - e.t >= windowMs) {
      hits.set(k, { t: now, n: 1 });
      if (hits.size > 5000) { // curățenie: ferestrele vechi pleacă
        for (const [kk, v] of hits) if (now - v.t >= windowMs) hits.delete(kk);
      }
      return true;
    }
    e.n += 1;
    return e.n <= max;
  };
}

module.exports = { UUID_RE, DISPOZITIVE, curataRuta, domeniu, curataVizita, limitator };
