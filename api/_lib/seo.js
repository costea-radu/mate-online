// =====================================================================
// api/_lib/seo.js — NUCLEUL agentului SEO care ACȚIONEAZĂ (Faza 1 din
// GHID_AGENT_SEO_ACTIUNI.md). Partajat de:
//   • api/ai-seo-agent.js  (rulare interactivă din admin)
//   • api/seo-cron.js      (snapshot zilnic GSC + rulare automată săptămânală)
//   • api/seo-actions.js   (coada de aprobare: approve execută acțiunile)
//
// Principii:
//   1. Uneltele de CITIRE se execută pe loc; cele de SCRIERE doar creează
//      rânduri `proposed` în `seo_actions` — execuția are loc EXCLUSIV după
//      aprobarea adminului (executeAction / revertAction).
//   2. Singura cale de modificare a site-ului este baza de date Supabase
//      (seo_meta, content, rezolvari) — zero acces la cod sau deploy.
// =====================================================================
const claude = require('./claude');
const google = require('./google');
const { signedUrlFromPublic } = require('./http');
const { pdfText } = require('./pdftext');

const SITE = (process.env.SITE_ORIGIN && process.env.SITE_ORIGIN !== '*')
  ? process.env.SITE_ORIGIN.replace(/\/$/, '')
  : 'https://examenmate.com';

// ─── Structura site-ului — generată dinamic ──────────────────────────────────
// Rutele statice publice (oglinda rutelor din src/App.jsx; fără admin/auth/viewere).
const STATIC_ROUTES = [
  '/ (acasă)',
  '/evaluare-nationala',
  '/bacalaureat (+ /bacalaureat/:profil)',
  '/manuale',
  '/rezolvari (rezolvări video/PDF + articole scrise)',
  '/discutii (comunitate)',
  '/profesor-virtual (tutor AI)',
  '/tema (rezolvare temă AI)',
  '/biblioteca-utilizatorilor',
  '/preturi',
  '/faq',
  '/despre-noi',
  '/contact',
];

// sitemap.xml se schimbă rar — îl ținem în cache 10 minute.
let _sitemapCache = { urls: null, exp: 0 };

async function sitemapUrls() {
  if (_sitemapCache.exp > Date.now()) return _sitemapCache.urls;
  let out = null;
  try {
    const res = await fetch(`${SITE}/sitemap.xml`, { signal: AbortSignal.timeout(4000) });
    const xml = res.ok ? await res.text() : '';
    if (xml.includes('<urlset') || xml.includes('<sitemapindex')) {
      const urls = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)]
        .map((m) => m[1].trim().replace(/^https?:\/\/[^/]+/, '') || '/');
      if (urls.length) out = urls.slice(0, 60);
    }
  } catch { /* sitemapul poate lipsi la primul deploy */ }
  _sitemapCache = { urls: out, exp: Date.now() + 10 * 60_000 };
  return out;
}

async function siteStructure(supa, byCat) {
  const lines = [...STATIC_ROUTES];

  Object.keys(byCat || {})
    .map((c) => (/^clasa-(\d+)$/.exec(c) || [])[1])
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((n) => lines.push(`/clase/${n} (clasa a ${n}-a — ${byCat[`clasa-${n}`]} materiale)`));

  try {
    const { count } = await supa.from('rezolvari').select('id', { count: 'exact', head: true });
    if (count) lines.push(`(pe /rezolvari: ${count} materiale video/PDF/imagine)`);
  } catch { /* tabel indisponibil — ignorăm */ }

  try {
    const { data: arts } = await supa
      .from('articole')
      .select('slug, title, kind')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(30);
    (arts || []).forEach((a) => lines.push(`/rezolvari/${a.slug} — [${a.kind}] ${a.title}`));
  } catch { /* tabelul apare în Faza 2 */ }

  const sm = await sitemapUrls();
  if (sm) {
    const known = new Set(lines.map((l) => l.split(' ')[0]));
    const extra = sm.filter((u) => !known.has(u));
    if (extra.length) lines.push('— în plus, din sitemap.xml:', ...extra.map((u) => `  ${u}`));
  }

  return lines.join('\n');
}

// Supabase (PostgREST) întoarce max 1000 de rânduri PER CERERE — pentru
// numărători corecte peste tot, citim paginat (plafonat la maxPages×1000).
async function allRows(supa, table, cols, { orderCol = null, desc = true, maxPages = 12 } = {}) {
  const out = [];
  for (let p = 0; p < maxPages; p++) {
    let q = supa.from(table).select(cols).range(p * 1000, p * 1000 + 999);
    if (orderCol) q = q.order(orderCol, { ascending: !desc });
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Context real din site: materiale pe categorii + titluri recente.
async function contentContext(supa) {
  let contentCtx = '';
  const byCat = {};
  try {
    const rows = await allRows(supa, 'content', 'title, category, content_type, is_free, created_at', { orderCol: 'created_at' });
    rows.forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + 1; });
    const recent = rows.slice(0, 25).map((r) => `- [${r.category}/${r.content_type}${r.is_free ? '/gratuit' : ''}] ${r.title}`).join('\n');
    contentCtx = `Materiale pe categorii (total ${rows.length}): ${JSON.stringify(byCat)}\nCele mai recente titluri:\n${recent}`;
  } catch { contentCtx = '(nu am putut citi conținutul)'; }
  return { contentCtx, byCat };
}

// ─── Sarcinile presetate ─────────────────────────────────────────────────────
const TASKS = {
  audit: 'Fă un AUDIT SEO on-page al site-ului pe baza contextului. Identifică problemele probabile (titluri, meta, structură, conținut subțire, interlinking, viteze) și dă o listă de acțiuni concrete, prioritizate (impact/efort). Dacă adminul a lipit conținutul unei pagini, auditeaz-o în detaliu. Folosește uneltele (fetch_page, url_inspect, psi_report, get_seo_meta) ca să verifici realitatea, nu presupuneri.',
  meta: 'Scrie META TITLE (max 60 caractere) și META DESCRIPTION (max 155 caractere) în română, optimizate pentru CTR, pentru fiecare pagină/categorie din context (sau pentru pagina lipită de admin). Verifică întâi cu get_seo_meta ce e deja setat și cu gsc_query ce interogări primește fiecare pagină, apoi PROPUNE modificările prin unealta set_page_meta (nu doar în text).',
  blog: 'Propune 10 idei de ARTICOLE DE BLOG cu potențial SEO (cuvinte cheie căutate de elevi/părinți: evaluare națională, bacalaureat, formule etc.). Pentru fiecare: titlu, cuvânt-cheie principal, intenția de căutare, schiță H2-uri. Ancorează ideile în interogările reale din gsc_query. Dacă adminul cere un articol anume, scrie-l complet. (Publicarea automată vine în Faza 2.)',
  social: 'Creează conținut SOCIAL MEDIA pentru platfomă: 5 postări Facebook/Instagram (text + idee vizual) și 3 idei TikTok/Reels pentru elevi. Ton prietenos, românesc, orientat pe examene. (Postarea automată vine în Faza 3.)',
  keywords: 'Fă o listă de CUVINTE CHEIE (română) pe care ExamenMate ar trebui să le țintească, grupate pe intenție (informațional/tranzacțional) și pe pagini-țintă existente. Include long-tail specifice claselor 5–12, EN și BAC. Pornește de la interogările reale din gsc_query (inclusiv pozițiile 5–20 cu impresii mari).',
  performance: 'Analizează PERFORMANȚA REALĂ din datele Google (Search Console și, dacă există, GA4): tendința clicurilor/impresiilor față de perioada anterioară, interogările și paginile câștigătoare, OPORTUNITĂȚILE (poziții 5–20 cu impresii mari — ce pagini de optimizat ca să urce în top 3), paginile cu impresii mari și CTR mic (de rescris meta). Folosește gsc_query pentru detalii pe interogările/paginile care contează. Pentru fiecare oportunitate clară, trimite o propunere concretă prin set_page_meta sau rename_material, cu explicația în `note`. Încheie cu un plan pe 2 săptămâni și cu lista propunerilor trimise. Dacă datele Google lipsesc, spune exact asta și recomandă conectarea lor.',
  chat: 'Răspunde la întrebarea adminului ca expert SEO & marketing pentru platforma de educație. Când e util, verifică realitatea cu uneltele de citire; când propui modificări concrete de meta/titluri, trimite-le prin uneltele de scriere.',
};

// ─── Definițiile uneltelor (schema Anthropic) ────────────────────────────────
const str = (description) => ({ type: 'string', description });
const TOOLS = [
  {
    name: 'gsc_query',
    description: 'Interoghează Search Console (searchAnalytics). Întoarce clicuri/impresii/CTR/poziție. Folosește pentru: top interogări/pagini, oportunități (poziții 5–20), CTR mic. Datele au ~2 zile întârziere.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: str('YYYY-MM-DD (ex. acum 28 de zile)'),
        endDate: str('YYYY-MM-DD (cel târziu acum 2 zile)'),
        dimensions: { type: 'array', items: { type: 'string', enum: ['query', 'page', 'date', 'device', 'country'] }, description: 'ex. ["query"] sau ["page"] sau ["query","page"]' },
        rowLimit: { type: 'integer', description: 'max 250 (implicit 50)' },
        pageContains: str('opțional: filtrează paginile care CONȚIN acest text (ex. "/rezolvari")'),
        queryContains: str('opțional: filtrează interogările care conțin acest text'),
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'ga4_report',
    description: 'Raport GA4 (Analytics Data API). Metrici uzuale: activeUsers, sessions, screenPageViews, conversions. Dimensiuni uzuale: pagePath, sessionDefaultChannelGroup, date.',
    input_schema: {
      type: 'object',
      properties: {
        metrics: { type: 'array', items: { type: 'string' }, description: 'ex. ["sessions","activeUsers"]' },
        dimensions: { type: 'array', items: { type: 'string' }, description: 'opțional, ex. ["pagePath"]' },
        startDate: str('ex. "28daysAgo" sau YYYY-MM-DD (implicit 28daysAgo)'),
        endDate: str('ex. "today" sau YYYY-MM-DD (implicit today)'),
        limit: { type: 'integer', description: 'max 200 (implicit 50)' },
      },
      required: ['metrics'],
    },
  },
  {
    name: 'url_inspect',
    description: 'Inspecția URL în Search Console: e indexată pagina? ce canonical a ales Google? probleme de crawling? Folosește URL-ul complet (https://...).',
    input_schema: { type: 'object', properties: { url: str('URL-ul complet de inspectat') }, required: ['url'] },
  },
  {
    name: 'psi_report',
    description: 'PageSpeed Insights (Core Web Vitals + scoruri Lighthouse) pentru un URL. Durează 15–60s — folosește rar, doar când viteza e tema.',
    input_schema: {
      type: 'object',
      properties: { url: str('URL-ul complet'), strategy: { type: 'string', enum: ['mobile', 'desktop'], description: 'implicit mobile' } },
      required: ['url'],
    },
  },
  {
    name: 'fetch_page',
    description: 'Descarcă HTML-ul REAL servit de site pentru o rută (ce văd crawlerele fără JavaScript): title, meta description, canonical, og-uri, textul vizibil. Folosește pentru verificarea meta-urilor live.',
    input_schema: { type: 'object', properties: { route: str('ruta relativă, ex. "/evaluare-nationala"') }, required: ['route'] },
  },
  {
    name: 'db_stats',
    description: 'Statistici din baza de date: materiale pe categorii/tipuri, rezolvări pe tipuri, meta-urile setate în seo_meta, starea cozii de acțiuni.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'list_materials',
    description: 'Listează materiale din tabelul `content` (PDF/interactive/manuale) sau `rezolvari` (video/PDF/imagine), cu ID-urile lor reale — obligatoriu înainte de rename_material.',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: ['content', 'rezolvari'] },
        category: str('opțional: clasa-5..clasa-8, evaluare-nationala, bacalaureat, manuale...'),
        search: str('opțional: caută în titlu'),
        limit: { type: 'integer', description: 'max 100 (implicit 30)' },
      },
      required: ['table'],
    },
  },
  {
    name: 'read_material',
    description: 'Citește un material: metadatele + textul real (extras din PDF / manual / exercițiu interactiv). Baza pentru titluri mai bune și pentru rezolvările scrise din Faza 2.',
    input_schema: {
      type: 'object',
      properties: { table: { type: 'string', enum: ['content', 'rezolvari'] }, id: str('ID-ul materialului (uuid din list_materials)') },
      required: ['table', 'id'],
    },
  },
  {
    name: 'get_seo_meta',
    description: 'Meta-urile dinamice deja setate în tabelul seo_meta (toate rutele sau una singură).',
    input_schema: { type: 'object', properties: { route: str('opțional: doar această rută') } },
  },

  // ── SCRIERE — creează PROPUNERI în coada de aprobare (nu execută direct) ──
  {
    name: 'set_page_meta',
    description: 'PROPUNE meta noi pentru o rută (title/description/og_image/JSON-LD). După aprobare devin live în minute, fără deploy. Title ≤ 60 caractere, description ≤ 155, în română, optimizate CTR.',
    input_schema: {
      type: 'object',
      properties: {
        route: str('ruta, ex. "/evaluare-nationala" sau "/" '),
        title: str('meta title nou (≈50–60 caractere)'),
        description: str('meta description nouă (≈140–155 caractere)'),
        og_image: str('opțional: URL absolut de imagine pentru share'),
        jsonld: { type: 'object', description: 'opțional: obiect JSON-LD complet (ex. FAQPage, Organization, Course) — va fi injectat ca <script type="application/ld+json">' },
        note: str('DE CE propui asta — cu cifre din date (apare în coada de aprobare)'),
      },
      required: ['route', 'title', 'description', 'note'],
    },
  },
  {
    name: 'rename_material',
    description: 'PROPUNE un titlu (și opțional o descriere) mai bune pentru un material din `content` sau `rezolvari` — titlurile sunt textele indexabile de pe paginile pe clase/examene. Valorile vechi se păstrează (reversibil).',
    input_schema: {
      type: 'object',
      properties: {
        table: { type: 'string', enum: ['content', 'rezolvari'] },
        id: str('ID-ul materialului (uuid REAL din list_materials — nu inventa)'),
        new_title: str('titlul nou (clar + cuvinte căutate, fără clickbait)'),
        new_description: str('opțional: descrierea nouă'),
        note: str('DE CE propui redenumirea (apare în coada de aprobare)'),
      },
      required: ['table', 'id', 'new_title', 'note'],
    },
  },
  {
    name: 'submit_sitemap',
    description: 'PROPUNE retrimiterea sitemap.xml către Search Console (după modificări importante de structură/conținut).',
    input_schema: { type: 'object', properties: { note: str('de ce acum') } },
  },
];

// ─── Executorul uneltelor ────────────────────────────────────────────────────
const J = (x) => JSON.stringify(x).slice(0, 15000);
const cleanRoute = (r) => {
  let s = String(r || '/').trim();
  if (!s.startsWith('/')) s = '/' + s;
  s = s.split('?')[0].split('#')[0].replace(/\/{2,}/g, '/');
  if (s.length > 1) s = s.replace(/\/+$/, '');
  if (!/^\/[a-zA-Z0-9\-_/]{0,90}$/.test(s)) throw new Error(`Rută invalidă: ${r}`);
  return s;
};

// Creează un rând `proposed` în coada de aprobare și întoarce confirmarea.
async function proposeAction(supa, { type, payload, note }, state) {
  const { data, error } = await supa
    .from('seo_actions')
    .insert({ type, payload, note: String(note || '').slice(0, 1000), status: 'proposed' })
    .select('id')
    .single();
  if (error) throw new Error(`Nu am putut salva propunerea (rulează supabase/seo_agent.sql?): ${error.message}`);
  if (state) state.proposals.push({ id: data.id, type });
  return data.id;
}

function makeToolExecutor({ supa, state }) {
  return async function executeTool(name, input) {
    switch (name) {
      // ── CITIRE ─────────────────────────────────────────────────────────
      case 'gsc_query': {
        const body = {
          startDate: String(input.startDate), endDate: String(input.endDate),
          rowLimit: Math.min(Math.max(parseInt(input.rowLimit, 10) || 50, 1), 250),
        };
        if (Array.isArray(input.dimensions) && input.dimensions.length) body.dimensions = input.dimensions.slice(0, 3);
        const filters = [];
        if (input.pageContains) filters.push({ dimension: 'page', operator: 'contains', expression: String(input.pageContains) });
        if (input.queryContains) filters.push({ dimension: 'query', operator: 'contains', expression: String(input.queryContains) });
        if (filters.length) body.dimensionFilterGroups = [{ filters }];
        const r = await google.gscQuery(body);
        const rows = (r.rows || []).map((row) => ({
          keys: row.keys, clicks: row.clicks, impressions: row.impressions,
          ctr: Number((row.ctr || 0).toFixed(4)), position: Number((row.position || 0).toFixed(1)),
        }));
        return J({ rows, count: rows.length });
      }
      case 'ga4_report': {
        if (!google.ga4Enabled()) return 'GA4 nu e conectat (GA4_PROPERTY_ID lipsește).';
        const body = {
          dateRanges: [{ startDate: String(input.startDate || '28daysAgo'), endDate: String(input.endDate || 'today') }],
          metrics: (input.metrics || []).slice(0, 5).map((m) => ({ name: String(m) })),
          limit: Math.min(Math.max(parseInt(input.limit, 10) || 50, 1), 200),
        };
        if (Array.isArray(input.dimensions) && input.dimensions.length) body.dimensions = input.dimensions.slice(0, 3).map((d) => ({ name: String(d) }));
        const r = await google.ga4Run(body);
        const rows = (r.rows || []).map((row) => ({
          dims: (row.dimensionValues || []).map((d) => d.value),
          metrics: (row.metricValues || []).map((m) => m.value),
        }));
        return J({ headers: { dims: (r.dimensionHeaders || []).map((h) => h.name), metrics: (r.metricHeaders || []).map((h) => h.name) }, rows });
      }
      case 'url_inspect':
        return J(await google.urlInspect(String(input.url)));
      case 'psi_report':
        return J(await google.psiReport(String(input.url), input.strategy === 'desktop' ? 'desktop' : 'mobile'));
      case 'fetch_page': {
        const route = cleanRoute(input.route);
        const res = await fetch(SITE + route, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'ExamenMate-SEO-Agent/1.0' } });
        const html = await res.text();
        const pick = (re) => (html.match(re) || [])[1] || null;
        const noScript = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
        const text = noScript.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        return J({
          route, status: res.status,
          title: pick(/<title>([\s\S]*?)<\/title>/i),
          metaDescription: pick(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i),
          canonical: pick(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']*)["']/i),
          ogTitle: pick(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']*)["']/i),
          hasJsonLd: /application\/ld\+json/.test(html),
          h1: [...noScript.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) => m[1].replace(/<[^>]+>/g, '').trim()).slice(0, 3),
          visibleTextFirst2500: text.slice(0, 2500),
          note: 'Acesta e HTML-ul văzut de crawlere FĂRĂ JavaScript (SPA: conținutul React lipsește din el).',
        });
      }
      case 'db_stats': {
        const out = {};
        try {
          // numărul EXACT (count pe server) + distribuția pe categorii (paginat)
          const { count: total } = await supa.from('content').select('id', { count: 'exact', head: true });
          const data = await allRows(supa, 'content', 'category, content_type, is_free');
          const byCat = {}, byType = {}; let free = 0;
          data.forEach((r) => {
            byCat[r.category] = (byCat[r.category] || 0) + 1;
            byType[r.content_type] = (byType[r.content_type] || 0) + 1;
            if (r.is_free) free++;
          });
          out.content = { total: total ?? data.length, byCat, byType, gratuite: free };
        } catch (e) { out.content = `eroare: ${e.message}`; }
        try {
          const { count: total } = await supa.from('rezolvari').select('id', { count: 'exact', head: true });
          const data = await allRows(supa, 'rezolvari', 'type');
          const byType = {};
          data.forEach((r) => { byType[r.type] = (byType[r.type] || 0) + 1; });
          out.rezolvari = { total: total ?? data.length, byType };
        } catch { out.rezolvari = null; }
        try {
          const { count } = await supa.from('articole').select('slug', { count: 'exact', head: true }).eq('status', 'published');
          out.articolePublicate = count || 0;
        } catch { out.articolePublicate = '(tabelul articole apare în Faza 2)'; }
        try {
          const { data } = await supa.from('seo_meta').select('route, title, updated_at').order('route');
          out.seoMeta = (data || []).map((r) => `${r.route} → ${r.title}`);
        } catch { out.seoMeta = '(tabelul seo_meta lipsește — rulează supabase/seo_agent.sql)'; }
        try {
          const { data } = await supa.from('seo_actions').select('status');
          const byStatus = {};
          (data || []).forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
          out.coadaActiuni = byStatus;
        } catch { out.coadaActiuni = null; }
        return J(out);
      }
      case 'list_materials': {
        const table = input.table === 'rezolvari' ? 'rezolvari' : 'content';
        const cols = table === 'content'
          ? 'id, title, description, category, content_type, is_free, created_at'
          : 'id, title, description, category, type, created_at';
        let q = supa.from(table).select(cols).order('created_at', { ascending: false })
          .limit(Math.min(Math.max(parseInt(input.limit, 10) || 30, 1), 100));
        if (input.category) q = q.eq('category', String(input.category));
        if (input.search) q = q.ilike('title', `%${String(input.search).replace(/[%_]/g, '')}%`);
        const { data, error } = await q;
        if (error) throw new Error(error.message);
        return J({ table, rows: (data || []).map((r) => ({ ...r, description: r.description ? String(r.description).slice(0, 120) : null })) });
      }
      case 'read_material': {
        const table = input.table === 'rezolvari' ? 'rezolvari' : 'content';
        const { data: row, error } = await supa.from(table).select('*').eq('id', String(input.id)).maybeSingle();
        if (error) throw new Error(error.message);
        if (!row) return `Nu există materialul cu id=${input.id} în ${table}. Folosește list_materials pentru id-uri reale.`;
        const meta = {
          table, id: row.id, title: row.title, description: row.description || null,
          category: row.category, type: row.content_type || row.type, is_free: row.is_free ?? null,
        };
        let text = '';
        try {
          const kind = row.content_type || row.type;
          if (kind === 'pdf' && row.file_url) {
            let url = row.file_url;
            try { url = await signedUrlFromPublic(supa, row.file_url, 120); } catch { /* poate fi deja public */ }
            const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
            if (res.ok) text = await pdfText(Buffer.from(await res.arrayBuffer()), 4000);
          } else if (kind === 'manual' && row.manual_content) {
            text = String(row.manual_content).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 4000);
          } else if (kind === 'interactive' && row.interactive_data) {
            text = JSON.stringify(row.interactive_data).slice(0, 3000);
          } else if (kind === 'video') {
            text = `(material video: ${row.video_url || 'fără URL'})`;
          } else if (kind === 'image') {
            text = '(material imagine — fără text extras)';
          }
        } catch (e) { text = `(nu am putut extrage textul: ${e.message})`; }
        return J({ ...meta, text: text || '(fără text)' });
      }
      case 'get_seo_meta': {
        let q = supa.from('seo_meta').select('route, title, description, og_image, jsonld, updated_at, updated_by').order('route');
        if (input.route) q = q.eq('route', cleanRoute(input.route));
        const { data, error } = await q;
        if (error) return `(tabelul seo_meta lipsește — rulează supabase/seo_agent.sql): ${error.message}`;
        return J({ rows: data || [] });
      }

      // ── SCRIERE → coada de aprobare ────────────────────────────────────
      case 'set_page_meta': {
        const route = cleanRoute(input.route);
        const title = String(input.title || '').trim();
        const description = String(input.description || '').trim();
        if (title.length < 10 || title.length > 70) throw new Error(`Title-ul are ${title.length} caractere — ținta e 50–60 (max 70).`);
        if (description.length < 40 || description.length > 200) throw new Error(`Description-ul are ${description.length} caractere — ținta e 140–155 (max 200).`);
        if (input.og_image && !/^https?:\/\//.test(String(input.og_image))) throw new Error('og_image trebuie să fie URL absolut (https://...).');
        // păstrăm valorile VECHI pentru diff + revert
        let old = null;
        try {
          const { data } = await supa.from('seo_meta').select('title, description, og_image, jsonld').eq('route', route).maybeSingle();
          old = data || null;
        } catch { old = null; }
        const payload = {
          route, title, description,
          og_image: input.og_image ? String(input.og_image) : null,
          jsonld: (input.jsonld && typeof input.jsonld === 'object') ? input.jsonld : null,
          old,
        };
        const id = await proposeAction(supa, { type: 'set_page_meta', payload, note: input.note }, state);
        return `Propunerea ${id} (set_page_meta ${route}) a fost trimisă în coada de aprobare. Se aplică DOAR după aprobarea adminului.`;
      }
      case 'rename_material': {
        const table = input.table === 'rezolvari' ? 'rezolvari' : 'content';
        const { data: row, error } = await supa.from(table).select('id, title, description').eq('id', String(input.id)).maybeSingle();
        if (error) throw new Error(error.message);
        if (!row) throw new Error(`Nu există materialul cu id=${input.id} în ${table} — folosește list_materials.`);
        const newTitle = String(input.new_title || '').trim();
        if (newTitle.length < 8 || newTitle.length > 140) throw new Error('Titlul nou trebuie să aibă 8–140 de caractere.');
        const payload = {
          table, id: row.id,
          old_title: row.title, new_title: newTitle,
          old_description: row.description || null,
          new_description: input.new_description ? String(input.new_description).trim().slice(0, 500) : null,
        };
        if (payload.new_title === payload.old_title && !payload.new_description) throw new Error('Titlul propus e identic cu cel actual.');
        const id = await proposeAction(supa, { type: 'rename_material', payload, note: input.note }, state);
        return `Propunerea ${id} (rename_material „${row.title}" → „${newTitle}") a fost trimisă în coada de aprobare.`;
      }
      case 'submit_sitemap': {
        const id = await proposeAction(supa, {
          type: 'submit_sitemap',
          payload: { sitemap: `${SITE}/sitemap.xml` },
          note: input.note || 'Retrimitere sitemap către Search Console.',
        }, state);
        return `Propunerea ${id} (submit_sitemap) a fost trimisă în coada de aprobare.`;
      }
      default:
        return `Unealtă necunoscută: ${name}`;
    }
  };
}

// ─── Execuția acțiunilor APROBATE (chemată din api/seo-actions.js) ───────────
async function executeAction(supa, action) {
  const p = action.payload || {};
  switch (action.type) {
    case 'set_page_meta': {
      const { error } = await supa.from('seo_meta').upsert({
        route: p.route, title: p.title, description: p.description,
        og_image: p.og_image || null, jsonld: p.jsonld || null,
        updated_at: new Date().toISOString(), updated_by: 'agent',
      }, { onConflict: 'route' });
      if (error) throw new Error(error.message);
      return { applied: 'seo_meta', route: p.route, live_in: '≤ 5 minute (cache CDN)' };
    }
    case 'rename_material': {
      const patch = { title: p.new_title };
      if (p.new_description) patch.description = p.new_description;
      const { error } = await supa.from(p.table).update(patch).eq('id', p.id);
      if (error) throw new Error(error.message);
      return { applied: p.table, id: p.id, title: p.new_title };
    }
    case 'submit_sitemap': {
      if (!google.enabled()) throw new Error('Contul de serviciu Google nu e configurat.');
      return await google.submitSitemap(p.sitemap || `${SITE}/sitemap.xml`);
    }
    case 'publish_article':
      throw new Error('publish_article se activează în Faza 2 (tabelul articole + pagina de articol).');
    case 'schedule_social':
      throw new Error('schedule_social se activează în Faza 3 (Meta Graph API + social_posts).');
    default:
      throw new Error(`Tip de acțiune necunoscut: ${action.type}`);
  }
}

// Anulează o acțiune EXECUTATĂ (valorile vechi sunt în payload).
async function revertAction(supa, action) {
  const p = action.payload || {};
  switch (action.type) {
    case 'set_page_meta': {
      if (p.old) {
        const { error } = await supa.from('seo_meta').upsert({
          route: p.route, title: p.old.title, description: p.old.description,
          og_image: p.old.og_image || null, jsonld: p.old.jsonld || null,
          updated_at: new Date().toISOString(), updated_by: 'revert',
        }, { onConflict: 'route' });
        if (error) throw new Error(error.message);
        return { reverted: p.route, restored: 'valorile anterioare' };
      }
      const { error } = await supa.from('seo_meta').delete().eq('route', p.route);
      if (error) throw new Error(error.message);
      return { reverted: p.route, restored: 'fără rând (meta statice implicite)' };
    }
    case 'rename_material': {
      const patch = { title: p.old_title };
      if (p.new_description) patch.description = p.old_description;
      const { error } = await supa.from(p.table).update(patch).eq('id', p.id);
      if (error) throw new Error(error.message);
      return { reverted: p.table, id: p.id, title: p.old_title };
    }
    default:
      throw new Error(`Acțiunea ${action.type} nu are revert automat.`);
  }
}

// ─── Rularea agentului (interactiv din admin sau automat din cron) ───────────
function buildSystem({ routesCtx, contentCtx, googleCtx, instr, hasTools }) {
  const toolsBlock = hasTools ? `

=== UNELTELE TALE (folosește-le!) ===
CITIRE — se execută imediat: gsc_query, ga4_report, url_inspect, psi_report, fetch_page, db_stats, list_materials, read_material, get_seo_meta.
SCRIERE — NU modifică nimic direct: creează PROPUNERI în coada de aprobare din admin: set_page_meta, rename_material, submit_sitemap.

Fluxul corect: (1) verifică datele reale (gsc_query / db_stats / get_seo_meta / fetch_page); (2) decide pe cifre, nu pe presupuneri; (3) trimite propuneri concrete prin uneltele de scriere, fiecare cu «note» care explică DE CE (cu cifrele care o justifică); (4) încheie cu un raport scurt: ce ai găsit + ce propuneri ai trimis.
Reguli: nu inventa rute sau id-uri (ia-le din structura site-ului / list_materials / db_stats); titluri ≤ 60 caractere, descrieri ≤ 155; propune DOAR modificări justificate de date; maximum ~6 propuneri pe rulare — calitate, nu volum. Modificările devin live abia după aprobarea adminului.` : `

(Uneltele de acțiune nu sunt disponibile în această rulare — dai doar recomandări în text.)`;

  return `Ești agentul SEO & MARKETING al platformei ExamenMate (${SITE}) — platformă românească de matematică pentru clasele 5–12, Evaluarea Națională și Bacalaureat, cu abonament premium, exerciții interactive, rezolvări video/PDF și Profesor Virtual AI.

Public țintă: elevi 10–19 ani, părinți, profesori (România). Concurență: siteuri de meditații, culegeri online, canale YouTube.

=== STRUCTURA SITE-ULUI (SPA React — generată dinamic din DB și sitemap) ===
${routesCtx}

=== CONȚINUT ACTUAL ===
${contentCtx}${googleCtx}${toolsBlock}

Reguli: răspunzi în română, concret și acționabil, fără generalități. Când scrii conținut (meta, articole, postări), e gata de copiat. Când ai date reale Google, ancorează totul în cifre (interogări, poziții, CTR). Site-ul e SPA client-side, dar rutele publice sunt servite prin api/page-meta cu meta dinamice din tabelul seo_meta — modificările tale de meta ajung live fără deploy.

SARCINA CURENTĂ: ${instr}`;
}

async function runAgent({ supa, task = 'chat', input = '', history = [], maxIters = 8 }) {
  const instr = TASKS[task] || TASKS.chat;
  const { contentCtx, byCat } = await contentContext(supa);

  let routesCtx = '';
  try { routesCtx = await siteStructure(supa, byCat); }
  catch { routesCtx = STATIC_ROUTES.join('\n'); }

  let googleCtx = '';
  try {
    if (google.enabled()) {
      const block = await google.contextBlock();
      if (block) googleCtx = `\n\n=== DATE REALE GOOGLE (cont: admin.examenmate@gmail.com) ===\n${block}`;
    } else {
      googleCtx = '\n\n=== DATE GOOGLE === (neconectate încă — vezi GHID_EMAIL_SI_SEO.md pentru Search Console/GA4)';
    }
  } catch (e) { googleCtx = `\n\n=== DATE GOOGLE === (eroare la citire: ${e.message})`; }

  const hasTools = claude.HAS_KEY;
  const system = buildSystem({ routesCtx, contentCtx, googleCtx, instr, hasTools });
  const messages = [
    ...(Array.isArray(history) ? history.slice(-8).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })) : []),
    { role: 'user', content: input ? String(input).slice(0, 12000) : 'Execută sarcina pe baza contextului site-ului.' },
  ];

  // Fără cheie Anthropic: comportamentul vechi (doar analiză/recomandări).
  if (!hasTools) {
    const r = await claude.chatClaude({ system, messages, temperature: 0.6, maxTokens: 3000 });
    return { ...r, toolCalls: 0, proposals: 0, googleConnected: google.enabled() };
  }

  const state = { proposals: [] };
  const executeTool = makeToolExecutor({ supa, state });
  const r = await claude.chatClaudeTools({ system, messages, tools: TOOLS, executeTool, maxTokens: 3000, maxIters });
  return { ...r, proposals: state.proposals.length, proposalsList: state.proposals, googleConnected: google.enabled() };
}

// ─── Snapshot zilnic GSC → gsc_snapshots (trenduri + măsurarea efectului) ────
async function snapshotGsc(supa, days = 1) {
  if (!google.enabled()) throw new Error('Contul de serviciu Google nu e configurat (GOOGLE_SERVICE_ACCOUNT_JSON).');
  const out = [];
  for (let i = 0; i < Math.min(Math.max(days, 1), 30); i++) {
    // ziua „finalizată": acum 3 zile (GSC are ~2 zile întârziere)
    const d = new Date(Date.now() - (3 + i) * 86400 * 1000);
    const dayStr = d.toISOString().slice(0, 10);
    for (const dim of ['query', 'page']) {
      const r = await google.gscQuery({ startDate: dayStr, endDate: dayStr, dimensions: [dim], rowLimit: 250 });
      // cheile de pagină devin rute relative; dedupe (două URL-uri pot da aceeași rută)
      const byKey = new Map();
      for (const row of (r.rows || [])) {
        const key = dim === 'page'
          ? (String(row.keys[0]).replace(/^https?:\/\/[^/]+/, '').split('?')[0] || '/')
          : String(row.keys[0]).slice(0, 300);
        const prev = byKey.get(key);
        if (prev) {
          prev.clicks += row.clicks || 0;
          prev.impressions += row.impressions || 0;
        } else {
          byKey.set(key, {
            day: dayStr, dim, key,
            clicks: row.clicks || 0, impressions: row.impressions || 0,
            ctr: row.ctr ?? null, position: row.position ?? null,
          });
        }
      }
      const rows = [...byKey.values()];
      if (rows.length) {
        const { error } = await supa.from('gsc_snapshots').upsert(rows, { onConflict: 'day,dim,key' });
        if (error) throw new Error(`gsc_snapshots (rulează supabase/seo_agent.sql?): ${error.message}`);
      }
      out.push({ day: dayStr, dim, rows: rows.length });
    }
  }
  return out;
}

module.exports = {
  SITE, STATIC_ROUTES, TASKS, TOOLS,
  siteStructure, contentContext, allRows,
  makeToolExecutor, proposeAction, executeAction, revertAction,
  runAgent, snapshotGsc,
};
