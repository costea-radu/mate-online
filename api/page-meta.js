// =====================================================================
// api/page-meta.js — servește index.html cu META CORECTE PER RUTĂ.
// (Faza 1b + Faza 2b din GHID_AGENT_SEO_ACTIUNI.md)
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
// FAZA 2 — articolele din pagina Rezolvări (/rezolvari/{slug}):
//   • meta derivate din tabelul `articole` (title/description), suprascrise
//     de un eventual rând din `seo_meta` pe aceeași rută;
//   • JSON-LD `Article` + og:type article + article:published_time;
//   • CONȚINUTUL COMPLET al articolului e injectat în <div id="root"> —
//     crawlerele și share-urile văd articolul întreg FĂRĂ JavaScript
//     (React redesenează pagina la hidratare; datele inițiale merg în
//     <script id="__ARTICOL__"> ca pagina să nu refacă cererea);
//   • slug inexistent/nepublicat → 404 + <meta name="robots" noindex>.
//
// Rutele care trec pe aici sunt DOAR cele publice (vezi rewrites în
// vercel.json); /admin, /profil, viewerele etc. rămân SPA simplu.
// =====================================================================
const http = require('./_lib/http');
const { mdExcerpt, validSlug } = require('./_lib/markdown');

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

// Articolul publicat pentru un slug (Faza 2) — cache 60s per slug.
const _artCache = new Map(); // slug → { row, exp }
async function articleFor(slug) {
  const c = _artCache.get(slug);
  if (c && c.exp > Date.now()) return c.row;
  let row = null;
  try {
    const { data } = await supa()
      .from('articole')
      .select('slug, title, description, category, kind, content_md, content_html, keywords, sources, published_at, updated_at')
      .eq('slug', slug)
      .eq('status', 'published')
      .maybeSingle();
    row = data || null;
  } catch { row = null; } // tabelul apare după rularea supabase/articole.sql
  if (_artCache.size > 500) _artCache.clear();
  _artCache.set(slug, { row, exp: Date.now() + 60_000 });
  return row;
}

// ─── Utilitare pure (testate în test/seo.test.js + test/articole.test.js) ────
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
// meta.ogType ('article' pentru articole) și meta.articleDates
// ({published, modified}) sunt opționale (Faza 2).
function injectMeta(html, { route, meta, site = SITE }) {
  let out = html;

  // 1) Scoatem tagurile pe care le regenerăm (canonical/OG/Twitter/JSON-LD din șablon)
  out = out
    .replace(/[ \t]*<link[^>]+rel=["']canonical["'][^>]*>\s*\n?/gi, '')
    .replace(/[ \t]*<meta[^>]+(?:property|name)=["'](?:og:|twitter:|article:)[^"']*["'][^>]*>\s*\n?/gi, '')
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
  const lines = [
    `<link rel="canonical" href="${esc(url)}" />`,
    '<meta property="og:site_name" content="ExamenMate" />',
    '<meta property="og:locale" content="ro_RO" />',
    `<meta property="og:type" content="${esc(meta?.ogType || 'website')}" />`,
    `<meta property="og:title" content="${esc(title)}" />`,
    `<meta property="og:description" content="${esc(description)}" />`,
    `<meta property="og:url" content="${esc(url)}" />`,
    `<meta property="og:image" content="${esc(image)}" />`,
    `<meta name="twitter:card" content="${meta?.og_image ? 'summary_large_image' : 'summary'}" />`,
    `<meta name="twitter:title" content="${esc(title)}" />`,
    `<meta name="twitter:description" content="${esc(description)}" />`,
    `<meta name="twitter:image" content="${esc(image)}" />`,
  ];
  if (meta?.articleDates?.published) {
    lines.push(`<meta property="article:published_time" content="${esc(meta.articleDates.published)}" />`);
    if (meta.articleDates.modified) {
      lines.push(`<meta property="article:modified_time" content="${esc(meta.articleDates.modified)}" />`);
    }
  }
  const block = lines.map((l) => '    ' + l).join('\n');
  out = out.replace(/<\/head>/i, `${block}${jsonld}\n  </head>`);

  return out;
}

// ─── FAZA 2 — articolele servite server-side ─────────────────────────────────
const KIND_INFO = {
  articol:    { icon: '📖', label: 'Articol' },
  rezolvare:  { icon: '✍️', label: 'Rezolvare scrisă' },
  explicatie: { icon: '💡', label: 'Explicație' },
};
const CATEGORY_LABELS = {
  general: 'General', 'clasa-5': 'Clasa a V-a', 'clasa-6': 'Clasa a VI-a',
  'clasa-7': 'Clasa a VII-a', 'clasa-8': 'Clasa a VIII-a', 'clasa-9': 'Clasa a IX-a',
  'clasa-10': 'Clasa a X-a', 'clasa-11': 'Clasa a XI-a', 'clasa-12': 'Clasa a XII-a',
  'evaluare-nationala': 'Evaluare Națională', bacalaureat: 'Bacalaureat', manuale: 'Manuale',
};
// Pagina de listare potrivită pentru o categorie (pentru linkuri interne/CTA).
function categoryRoute(cat) {
  const m = /^clasa-(\d+)$/.exec(cat || '');
  if (m) return `/clase/${m[1]}`;
  if (cat === 'evaluare-nationala') return '/evaluare-nationala';
  if (cat === 'bacalaureat') return '/bacalaureat';
  if (cat === 'manuale') return '/manuale';
  return '/rezolvari';
}

const roDate = (iso) => {
  try {
    return new Date(iso).toLocaleDateString('ro-RO', { day: 'numeric', month: 'long', year: 'numeric' });
  } catch { return null; }
};

// HTML-ul complet al articolului pentru <div id="root"> — ce văd crawlerele
// și utilizatorii înainte de hidratarea React. Aceleași clase CSS ca în
// src/pages/ArticolPage.jsx (stiluri din global.css, prezent în build).
function articleShell(a, site = SITE) {
  const kind = KIND_INFO[a.kind] || KIND_INFO.articol;
  const catLabel = CATEGORY_LABELS[a.category] || null;
  const catRoute = categoryRoute(a.category);
  const date = a.published_at ? roDate(a.published_at) : null;
  const updated = a.updated_at && a.published_at && String(a.updated_at).slice(0, 10) !== String(a.published_at).slice(0, 10)
    ? roDate(a.updated_at) : null;

  const metaBits = [
    `<span class="articol-badge">${kind.icon} ${esc(kind.label)}</span>`,
    catLabel ? `<a href="${esc(catRoute)}" class="articol-cat">${esc(catLabel)}</a>` : null,
    date ? `<span>📅 ${esc(date)}</span>` : null,
    updated ? `<span>(actualizat ${esc(updated)})</span>` : null,
  ].filter(Boolean).join('<span class="articol-dot">·</span>');

  const sources = Array.isArray(a.sources) ? a.sources.filter((s) => s && s.title) : [];
  const sourcesHtml = sources.length ? `
      <div class="articol-surse">
        <h2>📚 Materiale de pe ExamenMate folosite în acest articol</h2>
        <ul>
          ${sources.map((s) => `<li><a href="${esc(categoryRoute(s.category || a.category))}">${esc(String(s.title).slice(0, 160))}</a></li>`).join('\n          ')}
        </ul>
      </div>` : '';

  return `
    <div class="page-header">
      <div class="container">
        <nav class="breadcrumb"><a href="/">Acasă</a><span>›</span><a href="/rezolvari">Blog / Rezolvări / Teorie</a><span>›</span><span>${esc(kind.label)}</span></nav>
        <h1>${esc(a.title)}</h1>
        ${a.description ? `<p>${esc(a.description)}</p>` : ''}
      </div>
    </div>
    <div class="content-list">
      <div class="container articol-wrap">
        <div class="articol-meta-line">${metaBits}</div>
        <article class="articol-content">
${a.content_html || ''}
        </article>${sourcesHtml}
        <div class="articol-cta">
          <h2>Vrei mai mult decât atât?</h2>
          <p>Pe ExamenMate găsești exerciții interactive, rezolvări video și teste complete${catLabel ? ` pentru ${esc(catLabel)}` : ''} — plus Profesorul Virtual care îți explică pas cu pas.</p>
          <p><a class="btn btn-primary" href="${esc(catRoute)}">Vezi materialele${catLabel ? ` pentru ${esc(catLabel)}` : ''}</a> <a class="btn btn-outline" href="/preturi">Abonamente</a></p>
        </div>
        <p class="articol-back"><a href="/rezolvari">← Înapoi la Blog / Rezolvări / Teorie</a></p>
      </div>
    </div>`;
}

// JSON-LD `Article` pentru un articol publicat.
function articleJsonLd(a, site = SITE) {
  const out = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: String(a.title || '').slice(0, 110),
    description: String(a.description || '').slice(0, 300) || undefined,
    inLanguage: 'ro',
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${site}/rezolvari/${a.slug}` },
    datePublished: a.published_at || undefined,
    dateModified: a.updated_at || a.published_at || undefined,
    author: { '@type': 'Organization', name: 'ExamenMate', url: site },
    publisher: {
      '@type': 'Organization', name: 'ExamenMate', url: site,
      logo: { '@type': 'ImageObject', url: `${site}/pwa-512x512.png` },
    },
  };
  if (Array.isArray(a.keywords) && a.keywords.length) out.keywords = a.keywords.join(', ');
  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

// Pune conținutul serverului în interiorul <div id="root"> (React îl
// înlocuiește la hidratare). Dacă șablonul se schimbă, HTML-ul rămâne valid.
function injectRoot(html, inner) {
  let done = false;
  const out = html.replace(/(<div id="root">)(\s*)(<\/div>)/i, (m, open, _sp, close) => {
    done = true;
    return `${open}${inner}${close}`;
  });
  return done ? out : html;
}

// Datele articolului pentru React (evită a doua cerere la hidratare).
function injectArticleData(html, article) {
  const data = { ...article };
  delete data.content_md; // corpul markdown nu e necesar în browser
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return html.replace(/<\/body>/i, `  <script id="__ARTICOL__" type="application/json">${json}</script>\n  </body>`);
}

const noindex = (html) => html.replace(/<\/head>/i, '    <meta name="robots" content="noindex" />\n  </head>');

// ─── Handler ─────────────────────────────────────────────────────────────────
const sendHtml = (res, status, html, { cdn = 'public, s-maxage=300, stale-while-revalidate=86400' } = {}) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  // Browserele revalidează mereu (deploy-urile se văd imediat)…
  res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  // …iar CDN-ul Vercel ține 5 min + servește stale până revalidează.
  // (Header separat: nu poate fi suprascris de regulile `headers` din vercel.json.)
  res.setHeader('Vercel-CDN-Cache-Control', cdn);
  return res.status(status).send(html);
};

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

    // FAZA 2: /rezolvari/{slug} → pagina articolului, servită cu conținut.
    const artMatch = route.match(/^\/rezolvari\/([^/]+)$/);
    if (artMatch) {
      const slug = artMatch[1];
      const [html, article] = await Promise.all([
        baseHtml(),
        validSlug(slug) ? articleFor(slug) : Promise.resolve(null),
      ]);

      if (!article) {
        // slug necunoscut/nepublicat → 404 real (nu soft-404), neindexabil
        const out = noindex(injectMeta(html, {
          route, site: SITE,
          meta: {
            title: 'Articol negăsit – ExamenMate',
            description: 'Articolul căutat nu există sau nu mai este publicat. Vezi rezolvările, explicațiile și articolele disponibile pe ExamenMate.',
          },
        }));
        return sendHtml(res, 404, out, { cdn: 'public, s-maxage=60' });
      }

      const seoRow = await metaFor(route); // suprascriere manuală opțională
      const meta = {
        title: seoRow?.title || article.title,
        description: seoRow?.description || article.description || mdExcerpt(article.content_md || '', 155),
        og_image: seoRow?.og_image || null,
        jsonld: seoRow?.jsonld || articleJsonLd(article, SITE),
        ogType: 'article',
        articleDates: { published: article.published_at || null, modified: article.updated_at || null },
      };
      let out = injectMeta(html, { route, meta, site: SITE });
      out = injectRoot(out, articleShell(article, SITE));
      out = injectArticleData(out, article);
      return sendHtml(res, 200, out);
    }

    const [html, meta] = await Promise.all([baseHtml(), metaFor(route)]);
    const out = injectMeta(html, { route, meta, site: SITE });
    return sendHtml(res, 200, out);
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

// exportate pentru teste (test/seo.test.js, test/articole.test.js)
module.exports.injectMeta = injectMeta;
module.exports.normRoute = normRoute;
module.exports.articleShell = articleShell;
module.exports.articleJsonLd = articleJsonLd;
module.exports.injectRoot = injectRoot;
module.exports.injectArticleData = injectArticleData;
module.exports.categoryRoute = categoryRoute;
