// =====================================================================
// api/_lib/seoRute.js — ce are FIECARE rută publică și fără un rând în
// `seo_meta` (12 nov. 2026, „vizibilitatea în motoarele de căutare"):
//   · title + description proprii (înainte: același titlu pe toate paginile);
//   · date structurate: Organization + WebSite pe prima pagină, BreadcrumbList
//     pe celelalte;
//   · un SCHELET HTML pentru <div id="root"> — titlul paginii, o frază, lista
//     materialelor din baza de date și legături spre paginile vecine. Îl văd
//     crawlerele care nu rulează JavaScript (rețelele sociale, cele mai multe
//     motoare AI) și vizitatorul în prima clipă; React îl înlocuiește la pornire.
// Textele stau în seoRute.json — același fișier îl citește și aplicația
// (src/lib/titluPagina.js), pentru titlul filei din browser.
// Un rând aprobat în `seo_meta` (Agentul SEO) are ÎNTÂIETATE, câmp cu câmp.
// Pur (fără rețea) — testat în test/seo-rute.test.js.
// =====================================================================
const RUTE = require('./seoRute.json');

const OG_IMPLICIT = '/og-examenmate.png';   // 1200×630, public/
const PROFILURI_BAC = ['mate-info', 'stiinte-naturii', 'tehnologic'];
const CLASE = [5, 6, 7, 8, 9, 10, 11, 12];

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const ruta = (route) => (Object.prototype.hasOwnProperty.call(RUTE, route) ? RUTE[route] : null);

// title + description implicite (null = rută necunoscută → rămân cele din index.html)
function metaImplicit(route) {
  const r = ruta(route);
  return r ? { title: r.title, description: r.description || '' } : null;
}

// Ruta CANONICĂ și dacă pagina se indexează. Un profil de BAC inexistent arată
// pagina de mate-info (src/pages/Bacalaureat.jsx) → canonic pe /bacalaureat;
// o clasă inexistentă nu are ce căuta în index.
function canonic(route) {
  let m = /^\/bacalaureat\/([^/]+)$/.exec(route);
  if (m && !PROFILURI_BAC.includes(m[1])) return { route: '/bacalaureat', index: true };
  m = /^\/clase\/([^/]+)$/.exec(route);
  if (m && !CLASE.includes(Number(m[1]))) return { route, index: false };
  const r = ruta(route);
  return { route, index: !(r && r.index === false) };
}

// Categoria din `content` a unei pagini de materiale (null = pagina nu listează materiale)
function categoriaRutei(route) {
  if (route === '/evaluare-nationala') return { category: 'evaluare-nationala', profile: null };
  let m = /^\/bacalaureat\/([^/]+)$/.exec(route);
  if (m && PROFILURI_BAC.includes(m[1])) return { category: 'bacalaureat', profile: m[1] };
  m = /^\/clase\/(\d+)$/.exec(route);
  if (m && CLASE.includes(Number(m[1]))) return { category: `clasa-${Number(m[1])}`, profile: null };
  if (route === '/manuale') return { category: 'manuale', profile: null };
  return null;
}

// Acasă › (părinte) › pagina
function firimituri(route) {
  const out = [{ nume: 'Acasă', path: '/' }];
  const r = ruta(route);
  if (!r || route === '/') return out;
  if (r.parinte && ruta(r.parinte)) out.push({ nume: ruta(r.parinte).nume, path: r.parinte });
  out.push({ nume: r.nume, path: route });
  return out;
}

function jsonLdImplicit(route, site) {
  if (route === '/') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        {
          '@type': 'EducationalOrganization', '@id': `${site}/#organization`, name: 'ExamenMate', url: `${site}/`,
          logo: `${site}/pwa-512x512.png`, description: RUTE['/'].description,
        },
        {
          '@type': 'WebSite', '@id': `${site}/#website`, name: 'ExamenMate', url: `${site}/`, inLanguage: 'ro',
          publisher: { '@id': `${site}/#organization` },
        },
      ],
    };
  }
  const f = firimituri(route);
  if (f.length < 2) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: f.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.nume, item: site + (x.path === '/' ? '/' : x.path) })),
  };
}

// Meta finale: rândul din seo_meta (dacă există), completat câmp cu câmp cu implicitele
function cuImplicite(route, row, site) {
  const impl = metaImplicit(route);
  return {
    title: (row && row.title) || (impl && impl.title) || null,
    description: (row && row.description) || (impl && impl.description) || null,
    og_image: (row && row.og_image) || site + OG_IMPLICIT,
    jsonld: (row && row.jsonld) || jsonLdImplicit(route, site),
  };
}

// ─── Scheletul paginii (pentru <div id="root">) ──────────────────────────────
const GRUPE = {
  variante: 'Variante date și modele', simulari: 'Simulări', 'teste-antrenament': 'Teste de antrenament',
  bareme: 'Bareme', capitole: 'Exerciții pe capitole', 'exercitii-subiecte': 'Exerciții pe subiecte',
  exercitii: 'Exerciții pe subiecte', 'teste-interactive': 'Teste interactive',
};
const ORDINE = ['teste-interactive', 'variante', 'simulari', 'teste-antrenament', 'capitole', 'exercitii-subiecte', 'exercitii', 'bareme'];
const MAX_PE_GRUPA = 40;
const MAX_TOTAL = 160;

// rândurile din `content` → [{ titlu, titluri: [...] }], cu grupele cunoscute întâi
function grupeaza(materiale) {
  const m = new Map();
  for (const it of materiale || []) {
    const t = String((it && it.title) || '').trim();
    if (!t) continue;
    const k = GRUPE[it.subcategory] ? it.subcategory : (it.content_type === 'interactive' ? 'teste-interactive' : '_');
    if (!m.has(k)) m.set(k, []);
    if (!m.get(k).includes(t)) m.get(k).push(t);
  }
  const chei = [...ORDINE.filter((k) => m.has(k)), ...[...m.keys()].filter((k) => !ORDINE.includes(k))];
  let rest = MAX_TOTAL;
  const out = [];
  for (const k of chei) {
    if (rest <= 0) break;
    const titluri = m.get(k).slice(0, Math.min(MAX_PE_GRUPA, rest));
    rest -= titluri.length;
    out.push({ titlu: GRUPE[k] || 'Materiale', titluri, total: m.get(k).length });
  }
  return out;
}

function legaturiHtml(r) {
  const l = (r.legaturi || []).filter((p) => ruta(p));
  if (!l.length) return '';
  return `
        <p class="schelet-leg">${l.map((p) => `<a class="btn btn-outline btn-sm" href="${esc(p)}">${esc(ruta(p).nume)}</a>`).join(' ')}</p>`;
}

// `materiale` = rânduri din content ({ title, subcategory, content_type });
// `articole` = [{ slug, title }] (doar pentru /rezolvari). '' = ruta nu are schelet.
function schelet(route, { materiale = [], articole = [] } = {}) {
  const r = ruta(route);
  if (!r || !r.h1 || r.index === false) return '';
  if (route === '/') {
    // Paginile vin din rețea la fiecare deschidere, deci scheletul îl vede o clipă
    // și cine are cont: de aceea aici nu sunt butoane de înscriere, doar navigare.
    return `
    <section class="hero hero-bara">
      <div class="container hero-bara-in">
        <div class="hero-bara-text">
          <h1>${esc(r.h1)}</h1>
          <p>${esc(r.intro || r.description)}</p>
        </div>
      </div>
    </section>
    <section class="section">
      <div class="container">
        <h2 class="acasa-titlu">Examene</h2>${legaturiHtml(r)}
        <h2 class="acasa-titlu">Materiale pe clase</h2>
        <p class="schelet-leg">${CLASE.map((n) => `<a class="btn btn-outline btn-sm" href="/clase/${n}">${esc(RUTE[`/clase/${n}`].nume)}</a>`).join(' ')}</p>
      </div>
    </section>`;
  }
  const f = firimituri(route);
  const fir = f.map((x, i) => (i === f.length - 1 ? `<span>${esc(x.nume)}</span>` : `<a href="${esc(x.path)}">${esc(x.nume)}</a>`)).join('<span>›</span>');
  const grupe = grupeaza(materiale);
  const liste = grupe.map((g) => `
        <h2 class="acasa-titlu">${esc(g.titlu)}</h2>
        <ul class="schelet-lista">
          ${g.titluri.map((t) => `<li>${esc(t.slice(0, 160))}</li>`).join('\n          ')}
        </ul>`).join('');
  const art = (articole || []).filter((a) => a && a.slug && a.title);
  const artHtml = art.length ? `
        <ul class="schelet-lista">
          ${art.map((a) => `<li><a href="/rezolvari/${esc(a.slug)}">${esc(String(a.title).slice(0, 160))}</a></li>`).join('\n          ')}
        </ul>` : '';
  return `
    <div class="page-header">
      <div class="container">
        <nav class="breadcrumb">${fir}</nav>
        <h1>${esc(r.h1)}</h1>
        ${r.intro ? `<p>${esc(r.intro)}</p>` : ''}
      </div>
    </div>
    <div class="content-list">
      <div class="container">${liste}${artHtml}${legaturiHtml(r)}
      </div>
    </div>`;
}

module.exports = {
  RUTE, OG_IMPLICIT, PROFILURI_BAC, CLASE,
  metaImplicit, canonic, categoriaRutei, firimituri, jsonLdImplicit, cuImplicite, grupeaza, schelet,
};
