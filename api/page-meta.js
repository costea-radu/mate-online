// =====================================================================
// api/page-meta.js — servește index.html cu META CORECTE PER RUTĂ.
// (Faza 1b din GHID_AGENT_SEO_ACTIUNI.md)
//
// Problema rezolvată: site-ul e un SPA, iar index.html static are un singur
// title/description pentru toate rutele. Google rulează JS (lent), dar
// Facebook/WhatsApp — unde părinții distribuie linkuri — NU rulează deloc:
// orice pagină partajată arăta identic.
//
// Cum funcționează (fără SSR complet, fără deploy la fiecare modificare):
//   1. Ia HTML-ul de bază: fetch(<site>/index.html) — fișierul static rămâne
//      accesibil direct; cache în memoria funcției 5 minute.
//      ATENȚIE: nu activa `cleanUrls` în vercel.json (ar redirecționa
//      /index.html și ar strica acest fetch).
//   2. Citește rândul din `seo_meta` pentru ruta cerută (fallback: valorile
//      actuale din HTML). Tabelul poate să NU existe încă — se merge pe fallback.
//   3. Înlocuiește <title> + <meta description>, adaugă <link canonical>,
//      Open Graph, Twitter Card și JSON-LD din coloana `jsonld`.
//   4. Răspunde cu cache pe CDN 5 minute (+ stale-while-revalidate 24h):
//      modificările aprobate în admin apar pe site în max. 5 minute.
//
// Rutele care trec pe aici sunt DOAR cele publice (vezi rewrites în
// vercel.json); /admin, /profil, viewerele etc. rămân SPA simplu.
// =====================================================================
const http = require('./_lib/http');

const SITE = (process.env.SITE_ORIGIN && process.env.SITE_ORIGIN !== '*')
  ? process.env.SITE_ORIGIN.replace(/\/$/, '')
  : 'https://examenmate.com';
// De unde luăm index.html: URL-ul propriului deployment (are exact asset-urile
// build-ului curent); fallback pe domeniul public.
const FETCH_BASE = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : SITE;

// ─── Cache în memoria funcției ───────────────────────────────────────────────
let _html = { text: null, exp: 0, stale: null };
async function baseHtml() {
  if (_html.text && _html.exp > Date.now()) return _html.text;
  let text = null;
  for (const base of [FETCH_BASE, SITE]) {
    try {
      const res = await fetch(`${base}/index.html`, {
        redirect: 'manual',
        headers: { 'x-meta-inject': '1' },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) {
        const t = await res.text();
        if (t.includes('<html')) { text = t; break; }
      }
    } catch { /* încercăm următoarea bază */ }
  }
  if (!text) {
    if (_html.stale) return _html.stale; // mai bine HTML vechi decât eroare
    throw new Error('index.html indisponibil');
  }
  _html = { text, exp: Date.now() + 5 * 60_000, stale: text };
  return text;
}

let _supa = null;
const supa = () => _supa || (_supa = http.admin());
const _metaCache = new Map(); // route → { row, exp }
async function metaFor(route) {
  const c = _metaCache.get(route);
  if (c && c.exp > Date.now()) return c.row;
  let row = null;
  try {
    const { data } = await supa()
      .from('seo_meta')
      .select('title, description, og_image, jsonld')
      .eq('route', route)
      .maybeSingle();
    row = data || null;
  } catch { row = null; } // tabelul poate lipsi înainte de rularea SQL-ului
  if (_metaCache.size > 500) _metaCache.clear();
  _metaCache.set(route, { row, exp: Date.now() + 60_000 });
  return row;
}

// ─── Utilitare pure (testate în test/seo.test.js) ────────────────────────────
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
const dec = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// Normalizează parametrul ?route= (vine din rewrite; query-ul original se
// poate amesteca) — orice suspect cade pe '/'.
function normRoute(q) {
  let r = Array.isArray(q) ? q.find((v) => /^\//.test(String(v))) : q;
  r = String(r || '/');
  try { r = decodeURIComponent(r); } catch { /* păstrăm cum e */ }
  r = r.split('?')[0].split('#')[0];
  if (!/^\/[a-zA-Z0-9\-_/]*$/.test(r)) return '/';
  r = r.replace(/\/{2,}/g, '/');
  if (r.length > 1) r = r.replace(/\/+$/, '');
  return r || '/';
}

// Injectează meta-urile în HTML-ul de bază. `meta` poate fi null (fallback
// pe title/description existente în HTML — dar canonical + OG se adaugă mereu).
function injectMeta(html, { route, meta, site = SITE }) {
  let out = html;

  // 1) Scoatem tagurile pe care le regenerăm (canonical/OG/Twitter/JSON-LD din șablon)
  out = out
    .replace(/[ \t]*<link[^>]+rel=["']canonical["'][^>]*>\s*\n?/gi, '')
    .replace(/[ \t]*<meta[^>]+(?:property|name)=["'](?:og:|twitter:)[^"']*["'][^>]*>\s*\n?/gi, '')
    .replace(/[ \t]*<script[^>]+type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*\n?/gi, '');

  // 2) Valorile finale (rândul din seo_meta sau ce există deja în HTML)
  const curTitle = dec(((out.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || 'ExamenMate').trim());
  const curDesc = dec((out.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i) || [])[1] || '');
  const title = String(meta?.title || curTitle).slice(0, 120);
  const description = String(meta?.description || curDesc).slice(0, 300);
  const url = site + (route === '/' ? '/' : route);
  const image = meta?.og_image || `${site}/pwa-512x512.png`;

  // 3) Title + description
  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${esc(title)}</title>`);
  if (/<meta[^>]+name=["']description["']/i.test(out)) {
    out = out.replace(/<meta[^>]+name=["']description["'][^>]*\/?>/i, `<meta name="description" content="${esc(description)}" />`);
  }

  // 4) Canonical + Open Graph + Twitter + JSON-LD, înainte de </head>
  let jsonld = '';
  if (meta?.jsonld && typeof meta.jsonld === 'object') {
    // </script> în date ar închide tagul — de aceea escapăm '<'
    jsonld = `\n    <script type="application/ld+json">${JSON.stringify(meta.jsonld).replace(/</g, '\\u003c')}</script>`;
  }
  const block = [
    `<link rel="canonical" href="${esc(url)}" />`,
    '<meta property="og:site_name" content="ExamenMate" />',
    '<meta property="og:locale" content="ro_RO" />',
    '<meta property="og:type" content="website" />',
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta name="twitter:card" content="${meta?.og_image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ].map((l) => '    ' + l).join('\n');
  out = out.replace(/<\/head>/i, `${block}${jsonld}\n  </head>`);

  return out;
}

// ─── Handler ─────────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return res.status(405).send('Method Not Allowed');
    }
    // Plasă de siguranță anti-buclă (fetch-ul propriu poartă acest header;
    // în mod normal nu ajunge aici — /index.html e servit static).
    if (req.headers['x-meta-inject']) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send('<!doctype html><html><head><title>ExamenMate</title></head><body></body></html>');
    }

    const route = normRoute(req.query?.route);
    const [html, meta] = await Promise.all([baseHtml(), metaFor(route)]);
    const out = injectMeta(html, { route, meta, site: SITE });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Browserele revalidează mereu (deploy-urile se văd imediat)…
    res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    // …iar CDN-ul Vercel ține 5 min + servește stale până revalidează.
    // (Header separat: nu poate fi suprascris de regulile `headers` din vercel.json.)
    res.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=300, stale-while-revalidate=86400');
    return res.status(200).send(out);
  } catch (err) {
    console.error('page-meta:', err.message);
    if (_html.stale) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).send(_html.stale);
    }
    res.setHeader('Retry-After', '30');
    return res.status(503).send('Momentan indisponibil. Reîncearcă în câteva secunde.');
  }
};

// exportate pentru teste (test/seo.test.js)
module.exports.injectMeta = injectMeta;
module.exports.normRoute = normRoute;
