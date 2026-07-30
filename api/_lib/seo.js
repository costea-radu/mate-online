// =====================================================================
// api/_lib/seo.js — NUCLEUL agentului SEO care ACȚIONEAZĂ (Fazele 1–3 din
// GHID_AGENT_SEO_ACTIUNI.md). Partajat de:
//   • api/ai-seo-agent.js  (rulare interactivă din admin)
//   • api/seo-cron.js      (snapshot zilnic GSC + rulare automată săptămânală)
//   • api/seo-actions.js   (coada de aprobare: approve execută acțiunile)
//   • api/social-cron.js   (publicarea postărilor sociale aprobate, la 15 min)
//
// Principii:
//   1. Uneltele de CITIRE se execută pe loc; cele de SCRIERE doar creează
//      rânduri `proposed` în `seo_actions` — execuția are loc EXCLUSIV după
//      aprobarea adminului (executeAction / revertAction).
//   2. Singura cale de modificare a site-ului este baza de date Supabase
//      (seo_meta, content, rezolvari, articole, social_posts) — zero acces
//      la cod sau deploy.
//
// FAZA 2 (motorul de conținut): publish_article / update_article scriu în
// tabelul `articole` (supabase/articole.sql); articolele apar pe pagina
// Rezolvări și pe /rezolvari/{slug}, servite SSR de api/page-meta.js, cu
// HTML generat din markdown de api/_lib/markdown.js (escape-first, fără XSS).
//
// FAZA 3 (social): schedule_social scrie în `social_posts`
// (supabase/social_posts.sql); Facebook/Instagram se publică automat de
// api/social-cron.js (Meta Graph API în api/_lib/social.js, imagini branded
// din api/social-image.js), TikTok/YouTube intră în coada manuală din admin.
//
// FAZA 4 (YouTube + măsurare): yt_update_video optimizează metadatele
// clipurilor EXISTENTE (api/_lib/youtube.js, OAuth cu refresh token) — tot
// prin coada de aprobare; rank-trackingul din admin (api/seo-rank.js →
// SEORankTracker.jsx) și raportul lunar (api/seo-cron.js?action=monthly)
// se hrănesc din helperele de la finalul acestui fișier (rankData,
// measureActionEffects, monthlyContext).
// =====================================================================
const claude = require('./claude');
const google = require('./google');
const social = require('./social');
const youtube = require('./youtube');
const video = require('./video');
const { signedUrlFromPublic } = require('./http');
const { pdfText } = require('./pdftext');
const { mdToHtml, stripLeadingTitle, mdExcerpt, validSlug } = require('./markdown');

// ─── FAZA 2 — articolele din pagina Rezolvări ────────────────────────────────
const ARTICLE_KINDS = ['articol', 'rezolvare', 'explicatie'];
const ARTICLE_CATEGORIES = [
  'general', 'clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'clasa-9',
  'clasa-10', 'clasa-11', 'clasa-12', 'evaluare-nationala', 'bacalaureat',
];

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
  '/rezolvari (pagina „Blog / Rezolvări / Teorie": rezolvări video/PDF + articole scrise)',
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
  blog: 'Scrie CONȚINUT pentru pagina „Blog / Rezolvări / Teorie" (/rezolvari): articole SEO, rezolvări scrise pas cu pas, explicații/teorie. Fluxul: (1) gsc_query — ce caută oamenii și pentru ce NU există pagină dedicată (prioritatea #1: cerere dovedită); (2) list_articles — ce există deja, ca să nu dublezi; (3) read_material — bazează rezolvările/explicațiile pe materialele REALE din site; (4) scrie articolul COMPLET (substanță: explicație + exemple + formule LaTeX + linkuri interne + tabele unde ajută) și trimite-l prin publish_article, cu materialele folosite în sources. Unde se potrivește natural publicului articolului, prezintă și funcționalitățile platformei (cu link intern): elevilor — Profesorul Virtual (întrebări din PDF-uri/exerciții, explicații pas cu pas) și testele interactive; părinților — contul de părinte (evoluția copilului, încercări, teme, folosirea AI-ului); profesorilor — contul de profesor (grupe, teme, clasamente, generare de teste în format EN/BAC, publicare). Ține cont de calendarul școlar (simulări feb–mar, EN+BAC iunie — publică cu 2–3 luni înainte). Dacă adminul cere doar idei, dă lista (titlu + cuvânt cheie + intenție + schiță H2) fără să publici; dacă cere un articol anume, scrie-l și propune-l.',
  social: 'Planifică și PROGRAMEAZĂ postări social media reale prin unealta schedule_social (și, unde un clip scurt ar prinde mai bine, creează-l cu create_video — montaj de slide-uri branded, publicat automat ca Reels/video la aprobare; un create_video pe youtube sau tiktok intră automat în AMBELE cozi manuale — YouTube și TikTok). Fluxul: (1) list_social_posts — vezi ce e deja programat (fără dubluri) și ce metrici au avut postările vechi (învață din ele); (2) list_articles + gsc_query — ce merită promovat acum (articole noi, teme căutate, calendarul școlar); (3) programează un mix pe săptămâna următoare (3–6 postări, la ore cu audiență, ex. 17:00–20:30): PĂRINȚI → Facebook (ghiduri, calendarul examenelor, articolele noi din Blog/Rezolvări, ton cald fără reclamă agresivă; prezintă-le periodic CONTUL DE PĂRINTE — văd rezultatele și evoluția copilului, dacă a rezolvat singur sau cu Profesorul Virtual, câte încercări a avut la fiecare test și ce teme a primit); ELEVI → Instagram (formula/exercițiul zilei cu card generat prin image:{template,…}) și TikTok/Reels (clip scurt — scrie scenariul în text) — arată-le PROFESORUL VIRTUAL (le răspunde la întrebări din PDF-uri, exerciții interactive sau orice exercițiu) și testele interactive cu verificare pe loc; PROFESORI → Facebook (prezintă-le CONTUL DE PROFESOR: grupe de elevi, teste interactive trimise ca temă, clasamente și evoluția fiecărui elev, generare de teste în formatul exact EN/BAC cu barem, exerciții interactive sau PDF, publicarea testelor și folosirea lor la clasă); (4) fiecare postare cu linkul ei (primește UTM automat — efectul se vede în ga4_report). Textele în română, gata de publicat, cu 2–4 hashtag-uri relevante (#matematica #evaluareanationala #bacalaureat). Dacă adminul cere o campanie sau o temă anume, fă exact asta.',
  keywords: 'Fă o listă de CUVINTE CHEIE (română) pe care ExamenMate ar trebui să le țintească, grupate pe intenție (informațional/tranzacțional) și pe pagini-țintă existente. Include long-tail specifice claselor 5–12, EN și BAC. Pornește de la interogările reale din gsc_query (inclusiv pozițiile 5–20 cu impresii mari).',
  performance: 'Analizează PERFORMANȚA REALĂ din datele Google (Search Console și, dacă există, GA4): tendința clicurilor/impresiilor față de perioada anterioară, interogările și paginile câștigătoare, OPORTUNITĂȚILE (poziții 5–20 cu impresii mari — ce pagini de optimizat ca să urce în top 3), paginile cu impresii mari și CTR mic (de rescris meta), interogările FĂRĂ pagină dedicată (candidate la articol nou), articolele care stagnează/pierd poziții (candidate la refresh). Folosește gsc_query pentru detalii pe interogările/paginile care contează. Pentru fiecare oportunitate clară, trimite o propunere concretă prin set_page_meta / rename_material / publish_article / update_article, cu explicația în `note`. Încheie cu un plan pe 2 săptămâni și cu lista propunerilor trimise. Dacă datele Google lipsesc, spune exact asta și recomandă conectarea lor.',
  youtube: 'Două moduri de lucru pe YouTube — alege după situație (sau după cererea adminului). MODUL A — OPTIMIZARE metadate pentru clipurile EXISTENTE: (1) yt_list_videos; (2) gsc_query — CE CAUTĂ oamenii (folosește exact formulările căutate); (3) yt_get_video pe clipurile cu potențial (titlu generic, descriere goală); (4) yt_update_video: titlu ≤ 70 caractere cu formularea căutată (fără clickbait), descriere cu primele 2 rânduri care „vând" + link către site cu UTM (?utm_source=youtube&utm_medium=video&utm_campaign=slug) + 8–15 taguri; propune DOAR cu motiv concret în note. MODUL B — CLIPURI NOI cu create_video (mai ales când canalul e gol): montaje simple de 15–45s — prezentarea site-ului (intro → lista funcții → statistica → final), turul unei pagini (scene imagine cu og:image/carduri generate), formula/exercițiul zilei, countdown examene; dă titlu + descriere + taguri gata de lipit (o singură propunere pe youtube sau tiktok → clipul ajunge randat în AMBELE cozi manuale, YouTube ȘI TikTok — adminul îl urcă din YouTube Studio, respectiv din aplicația TikTok, în câte 2 minute; același clip poate merge și pe Instagram Reels, AUTOMAT, cu o a doua propunere create_video pe instagram). Texte scurte pe scene, Unicode — NU LaTeX; imagini DOAR cu URL-uri reale. Dacă adminul dă o temă/indicații, urmează-le exact. Dacă YouTube nu e conectat (YT_CLIENT_ID/SECRET/REFRESH_TOKEN), spune asta pentru modul A — modul B funcționează oricum.',
  report: 'Scrie RAPORTUL LUNAR de SEO & marketing al platformei, pe baza DATELOR MĂSURATE primite în mesaj (nu inventa cifre — folosește-le pe acelea; uneltele doar pentru verificări punctuale, max 2–3 apeluri). Structura: (1) Rezumat executiv — 3–5 fraze: ce s-a schimbat luna asta și de ce; (2) Trafic organic — clicuri/impresii/CTR/poziție medie vs. luna anterioară, cu interpretare; (3) Interogări & pagini — câștigătorii, pierzătorii, oportunitățile rămase; (4) Efectul acțiunilor executate — pentru fiecare acțiune măsurată: a funcționat? (cifrele înainte/după sunt în date); ce învățăm; (5) Conținut & social — articolele noi și postările (cu metricile lor), ce canal aduce vizite (UTM/GA4); (6) Planul lunii următoare — 4–6 acțiuni concrete, prioritizate (impact/efort), legate de calendarul școlar; NU trimite propuneri prin unelte acum — raportul e pentru citit. Ton: direct, cu cifre, fără umplutură. Format: Markdown cu titluri ## și liste scurte.',
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
  {
    name: 'list_articles',
    description: 'Listează articolele de pe pagina „Blog / Rezolvări / Teorie" (tabelul articole): slug, titlu, tip, categorie, status, date. OBLIGATORIU înainte de publish_article (ca să nu dublezi teme/sluguri) și înainte de update_article.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['published', 'draft', 'toate'], description: 'implicit „toate"' },
        category: str(`opțional: ${ARTICLE_CATEGORIES.join(', ')}`),
        search: str('opțional: caută în titlu/slug'),
        limit: { type: 'integer', description: 'max 100 (implicit 30)' },
      },
    },
  },
  {
    name: 'read_article',
    description: 'Citește un articol complet (metadate + sursa markdown). Folosește înainte de update_article, ca să pornești de la textul real.',
    input_schema: { type: 'object', properties: { slug: str('slug-ul articolului (din list_articles)') }, required: ['slug'] },
  },
  {
    name: 'list_social_posts',
    description: 'Calendarul social media (tabelul social_posts): postările programate, cele care așteaptă postare manuală (TikTok/YouTube), cele publicate cu METRICILE lor (reach/like/comentarii) și cele eșuate. OBLIGATORIU înainte de schedule_social — eviți dublurile și înveți din ce a funcționat.',
    input_schema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: social.PLATFORMS, description: 'opțional: doar această platformă' },
        status: { type: 'string', enum: ['approved', 'manual', 'posted', 'failed', 'canceled', 'toate'], description: 'implicit „toate"' },
        limit: { type: 'integer', description: 'max 60 (implicit 25)' },
      },
    },
  },

  {
    name: 'yt_list_videos',
    description: 'Clipurile canalului YouTube ExamenMate, cu vizualizări/like-uri/comentarii și data publicării. Folosește înainte de yt_update_video (id-uri reale) și ca să vezi ce clipuri au titluri slabe față de ce caută oamenii.',
    input_schema: {
      type: 'object',
      properties: {
        search: str('opțional: filtrează clipurile care conțin acest text în titlu/descriere'),
        limit: { type: 'integer', description: 'max 50 (implicit 25)' },
      },
    },
  },
  {
    name: 'yt_get_video',
    description: 'Un clip YouTube cu metadatele COMPLETE (titlul, descrierea integrală, tagurile) + statistici. OBLIGATORIU înainte de yt_update_video — pornești de la ce există.',
    input_schema: { type: 'object', properties: { id: str('ID-ul clipului (din yt_list_videos)') }, required: ['id'] },
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
    name: 'publish_article',
    description: `PROPUNE publicarea unui articol NOU pe pagina „Blog / Rezolvări / Teorie", cu URL propriu ${'`/rezolvari/{slug}`'} — indexabil, servit server-side, gratuit (aduce trafic; conversia vine din linkurile interne și CTA-ul automat către materialele premium). Scrie articolul COMPLET, cu substanță reală (explicație + exemple + formule LaTeX între $...$): „thin content" face rău în Google. Bazează rezolvările/explicațiile pe materialele reale (read_material) și listează-le în sources. Verifică ÎNTÂI cu list_articles că tema/slug-ul nu există deja.`,
    input_schema: {
      type: 'object',
      properties: {
        slug: str('URL-ul: litere mici, cifre, cratime (ex. "formule-arii-clasa-7"). Scurt, cu cuvântul cheie.'),
        kind: { type: 'string', enum: ARTICLE_KINDS, description: 'articol = ghid/SEO; rezolvare = rezolvare scrisă pas cu pas; explicatie = noțiune explicată' },
        title: str('titlul afișat (H1 + <title>), clar, cu cuvântul cheie căutat — 10–120 caractere (ideal ≤ 60)'),
        description: str('meta description + textul cardului din listă — 40–200 caractere (ideal 140–155)'),
        category: { type: 'string', enum: ARTICLE_CATEGORIES, description: 'categoria din filtrele paginii Blog / Rezolvări / Teorie' },
        content_md: str('articolul COMPLET în Markdown (fără titlul repetat pe prima linie): ## secțiuni, liste, tabele pentru formule, LaTeX între $...$, linkuri interne relative (ex. /clase/7, /evaluare-nationala, /rezolvari). Minim ~800 caractere; țintește 600–1500 de cuvinte cu valoare reală. HTML brut NU e permis (se escapează).'),
        keywords: { type: 'array', items: { type: 'string' }, description: 'max 12 cuvinte cheie țintite (din gsc_query unde există date)' },
        sources: {
          type: 'array',
          description: 'materialele din site pe care se bazează articolul (id-uri REALE din list_materials) — apar ca linkuri „Materiale folosite" în pagină',
          items: {
            type: 'object',
            properties: { table: { type: 'string', enum: ['content', 'rezolvari'] }, id: str('uuid-ul materialului') },
            required: ['table', 'id'],
          },
        },
        note: str('DE CE propui articolul — cu cifre din date unde există (apare în coada de aprobare)'),
      },
      required: ['slug', 'kind', 'title', 'description', 'category', 'content_md', 'note'],
    },
  },
  {
    name: 'update_article',
    description: 'PROPUNE actualizarea unui articol EXISTENT (refresh de conținut pentru poziții care stagnează/scad, corecturi, extinderi). Trimite DOAR câmpurile care se schimbă; valorile vechi se păstrează în propunere (reversibil). Cu publish=true republici un articol retras în draft.',
    input_schema: {
      type: 'object',
      properties: {
        slug: str('slug-ul articolului existent (din list_articles)'),
        title: str('opțional: titlu nou'),
        description: str('opțional: descriere nouă (40–200 caractere)'),
        category: { type: 'string', enum: ARTICLE_CATEGORIES, description: 'opțional: categorie nouă' },
        kind: { type: 'string', enum: ARTICLE_KINDS, description: 'opțional: tip nou' },
        content_md: str('opțional: conținutul Markdown COMPLET nou (înlocuiește tot corpul; minim ~800 caractere)'),
        keywords: { type: 'array', items: { type: 'string' }, description: 'opțional: lista nouă de cuvinte cheie' },
        sources: {
          type: 'array',
          description: 'opțional: lista nouă de materiale-sursă (înlocuiește lista veche)',
          items: {
            type: 'object',
            properties: { table: { type: 'string', enum: ['content', 'rezolvari'] }, id: str('uuid-ul materialului') },
            required: ['table', 'id'],
          },
        },
        publish: { type: 'boolean', description: 'true: publică articolul dacă e în draft (ex. republici unul retras)' },
        note: str('DE CE propui actualizarea — cu cifre din gsc_snapshots/gsc_query unde există'),
      },
      required: ['slug', 'note'],
    },
  },
  {
    name: 'submit_sitemap',
    description: 'PROPUNE retrimiterea sitemap.xml către Search Console (după modificări importante de structură/conținut). La publicarea articolelor NU e nevoie separat — publish_article retrimite sitemap-ul automat la aprobare.',
    input_schema: { type: 'object', properties: { note: str('de ce acum') } },
  },
  {
    name: 'schedule_social',
    description: `PROPUNE o postare social media. După aprobare: Facebook/Instagram se PUBLICĂ AUTOMAT la ora programată (cron la 15 min); TikTok/YouTube intră în coada manuală din admin (adminul postează copy-paste). Instagram cere OBLIGATORIU media: dă "image" (card branded generat de site) sau "media_url" (imagine JPEG/video MP4 public). Linkurile către site primesc UTM automat (utm_source=platformă, utm_medium=social) — efectul se urmărește apoi cu ga4_report. Verifică ÎNTÂI list_social_posts (fără dubluri; învață din metricile postărilor vechi).`,
    input_schema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: social.PLATFORMS, description: 'facebook = pagina (părinți); instagram = feed/Reels (elevi); tiktok/youtube = coada manuală' },
        text: str('textul COMPLET al postării, în română, gata de publicat, cu 2–4 hashtag-uri. FĂRĂ LaTeX și fără $...$ — captionurile nu randează formule: scrie matematica cu simboluri Unicode (² ³ √ π × ≤). Pentru TikTok/YouTube include și scenariul clipului (cadre + replici). Max ~2000 caractere pe Instagram, ~4000 în rest.'),
        when: str('când se publică: ISO 8601 cu fus orar, ex. "2026-08-03T18:30:00+03:00" (ora României). Lipsă = cât mai curând. Alege ore cu audiență: 17:00–20:30 în timpul săptămânii.'),
        link: str('opțional: linkul promovat — rută relativă (ex. "/rezolvari/formule-arii-clasa-7") sau URL absolut. Primește UTM automat dacă e pe examenmate.com.'),
        media_url: str('opțional: URL public de imagine (JPEG) sau video (MP4 → Reels pe Instagram, video pe Facebook). NU inventa URL-uri — folosește doar imagini care există (sau folosește "image").'),
        image: {
          type: 'object',
          description: `alternativă la media_url: card branded ExamenMate generat automat (1080×1080 JPEG). Șabloane: ${social.IMAGE_TEMPLATES.join(' | ')}. Texte SCURTE, cu simboluri Unicode (π √ ² ≈ ×) — NU LaTeX.`,
          properties: {
            template: { type: 'string', enum: social.IMAGE_TEMPLATES, description: 'formula = formula zilei; exercitiu = provocare cu răspunsul în comentarii; greseala = greșeala frecventă; countdown = zile până la examen (title = NUMĂRUL); anunt = articol/funcție nouă' },
            title: str('textul mare al cardului (≤ 90 caractere; la countdown: doar numărul, ex. "325")'),
            subtitle: str('opțional: rândul secundar (≤ 200 caractere; la countdown: "de zile până la …")'),
            badge: str('opțional: insigna din colț, ex. "Clasa a 7-a", "EN 2027" (≤ 30 caractere)'),
          },
          required: ['template', 'title'],
        },
        campaign: str('opțional: slugul utm_campaign (ex. "formule-arii-clasa-7"); implicit derivat din link'),
        note: str('DE CE propui postarea acum — public țintă + cârlig (apare în coada de aprobare)'),
      },
      required: ['platform', 'text', 'note'],
    },
  },
  {
    name: 'yt_update_video',
    description: 'PROPUNE metadate noi pentru un clip YouTube EXISTENT (titlu ≤ 100 caractere — ideal ≤ 70; descriere ≤ 5000 bytes, cu primele 2 rânduri care contează + link către site cu UTM; 8–15 taguri). Trimite DOAR câmpurile care se schimbă; valorile vechi se păstrează (reversibil). Citește ÎNTÂI clipul cu yt_get_video.',
    input_schema: {
      type: 'object',
      properties: {
        id: str('ID-ul clipului (REAL, din yt_list_videos / yt_get_video — nu inventa)'),
        title: str('opțional: titlul nou (formularea căutată de oameni, fără clickbait)'),
        description: str('opțional: descrierea nouă COMPLETĂ (înlocuiește tot: primele 2 rânduri „vând", apoi capitole/timestamps dacă există, linkuri către site cu UTM)'),
        tags: { type: 'array', items: { type: 'string' }, description: 'opțional: lista nouă de taguri (înlocuiește toate; 8–15, max ~480 caractere în total)' },
        note: str('DE CE propui schimbarea — cu interogările/cifrele din GSC care o justifică (apare în coada de aprobare)'),
      },
      required: ['id', 'note'],
    },
  },
  {
    name: 'create_video',
    description: 'PROPUNE crearea unui VIDEOCLIP simplu branded ExamenMate: montaj de slide-uri (intro | lista | imagine | statistica | final) + imagini reale din site, MP4 vertical 1080×1920 (Reels/Shorts/TikTok) sau orizontal, 10–75s, cu muzică de fundal (instrumental propriu, fără voce). Clipul se RANDEAZĂ automat la aprobare. Destinație: instagram/facebook → ACELAȘI clip se PUBLICĂ AUTOMAT pe AMBELE platforme Meta la ora aleasă (Reels pe Instagram + video pe Facebook — o singură propunere); youtube/tiktok → ACELAȘI clip intră GATA FĂCUT în AMBELE cozi manuale, YouTube ȘI TikTok (adminul îl descarcă și îl urcă — API-urile lor cer audit pentru publicare directă). Idei: prezentarea site-ului, turul unei pagini/funcții, formula zilei pe scene, countdown examene, articol nou. Texte SCURTE pe scene, cu simboluri Unicode (² √ π) — NU LaTeX. Imagini: DOAR URL-uri reale (og_image, carduri social-image generate anterior, imagini publice din site).',
    input_schema: {
      type: 'object',
      properties: {
        platform: { type: 'string', enum: social.PLATFORMS, description: 'unde ajunge clipul: instagram sau facebook (se publică AUTOMAT pe AMBELE platforme Meta — Reels + video Facebook) | youtube sau tiktok (clipul intră automat în AMBELE cozi manuale — YouTube + TikTok)' },
        scenes: {
          type: 'array',
          description: '2–12 scene, în ordinea redării. Fiecare: {template, title, subtitle?, bullets? (doar la lista, 1–5), image_url? (obligatoriu la imagine), badge?, seconds? (1.5–10, implicit 3.5)}',
          items: {
            type: 'object',
            properties: {
              template: { type: 'string', enum: ['intro', 'lista', 'imagine', 'statistica', 'final'], description: 'intro = titlu mare; lista = titlu + puncte; imagine = imagine reală + titlu; statistica = număr uriaș + explicație; final = CTA examenmate.com' },
              title: str('textul principal al scenei (≤ 120 caractere; la statistica: numărul/valoarea, ex. "500+")'),
              subtitle: str('opțional: rândul secundar (≤ 220 caractere)'),
              bullets: { type: 'array', items: { type: 'string' }, description: 'doar la template=lista: 1–5 puncte scurte (≤ 90 caractere fiecare)' },
              image_url: str('doar la template=imagine: URL absolut real (https://…) sau rută pe site (/…)'),
              badge: str('opțional: insigna din colț (ex. "Clasa a 7-a", ≤ 30 caractere)'),
              seconds: { type: 'number', description: 'durata scenei în secunde (1.5–10, implicit 3.5)' },
            },
            required: ['template'],
          },
        },
        text: str('FB/IG/TikTok: captionul complet al postării (cu hashtag-uri). YouTube: DESCRIEREA clipului (cu link către site). Fără LaTeX/$ — Unicode.'),
        title: str('obligatoriu la youtube și tiktok: titlul clipului pentru YouTube (≤ 100 caractere, ideal ≤ 70)'),
        tags: { type: 'array', items: { type: 'string' }, description: 'opțional (youtube/tiktok): 8–15 taguri pentru YouTube' },
        tiktok_text: str('opțional (doar la platform=youtube): captionul separat pentru TikTok, cu hashtag-uri (≤ 2200 caractere). Lipsă = se refolosește text.'),
        when: str('opțional (facebook/instagram): când se publică — ISO 8601 cu fus orar, ex. "2026-08-03T18:30:00+03:00". Lipsă = cât mai curând după aprobare.'),
        link: str('opțional: linkul promovat (rută relativă sau URL) — primește UTM automat pe FB/IG'),
        campaign: str('opțional: slugul utm_campaign; implicit derivat din link'),
        format: { type: 'string', enum: ['vertical', 'orizontal'], description: 'implicit vertical (1080×1920 — Reels/Shorts/TikTok); orizontal (1920×1080) pentru YouTube clasic' },
        note: str('DE CE propui clipul — public țintă + obiectiv (apare în coada de aprobare)'),
      },
      required: ['platform', 'scenes', 'text', 'note'],
    },
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

// ─── Validări pentru articole (publish_article / update_article) ─────────────
function checkArticleField(name, value) {
  switch (name) {
    case 'title': {
      const v = String(value || '').trim();
      if (v.length < 10 || v.length > 120) throw new Error(`Titlul are ${v.length} caractere — permis 10–120 (ideal ≤ 60).`);
      return v;
    }
    case 'description': {
      const v = String(value || '').trim();
      if (v.length < 40 || v.length > 200) throw new Error(`Descrierea are ${v.length} caractere — permis 40–200 (ideal 140–155).`);
      return v;
    }
    case 'category': {
      const v = String(value || '').trim();
      if (!ARTICLE_CATEGORIES.includes(v)) throw new Error(`Categorie invalidă: „${v}". Permise: ${ARTICLE_CATEGORIES.join(', ')}.`);
      return v;
    }
    case 'kind': {
      const v = String(value || '').trim();
      if (!ARTICLE_KINDS.includes(v)) throw new Error(`Tip invalid: „${v}". Permise: ${ARTICLE_KINDS.join(', ')}.`);
      return v;
    }
    case 'content_md': {
      const v = String(value || '').replace(/\r\n?/g, '\n').trim();
      if (v.length < 800) throw new Error(`Conținutul are doar ${v.length} caractere — minim 800. Articolele subțiri („thin content") fac rău în Google: scrie explicația completă, cu exemple.`);
      if (v.length > 60000) throw new Error('Conținutul depășește 60.000 de caractere — împarte în mai multe articole.');
      return v;
    }
    case 'keywords': {
      const arr = Array.isArray(value) ? value : [];
      return arr.map((k) => String(k).trim().slice(0, 60)).filter(Boolean).slice(0, 12);
    }
    default:
      return value;
  }
}

// Verifică id-urile din `sources` în DB și le îmbogățește cu titlu/categorie
// (apar ca linkuri „Materiale folosite" în pagină — deci trebuie să fie reale).
async function resolveSources(supa, sources) {
  if (!Array.isArray(sources) || !sources.length) return [];
  if (sources.length > 10) throw new Error('Maxim 10 materiale în sources.');
  const out = [];
  for (const s of sources) {
    const table = s && s.table === 'rezolvari' ? 'rezolvari' : s && s.table === 'content' ? 'content' : null;
    if (!table || !s.id) throw new Error('Fiecare intrare din sources are nevoie de {table: content|rezolvari, id}.');
    const { data: row, error } = await supa.from(table).select('id, title, category, is_free').eq('id', String(s.id)).maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error(`Materialul ${s.id} nu există în ${table} — folosește id-uri REALE din list_materials.`);
    out.push({ table, id: row.id, title: row.title, category: row.category || null, is_free: row.is_free ?? null });
  }
  return out;
}

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
        try {
          const { data } = await supa.from('social_posts').select('status');
          const byStatus = {};
          (data || []).forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
          out.social = byStatus;
        } catch { out.social = '(tabelul social_posts apare în Faza 3 — rulează supabase/social_posts.sql)'; }
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
      case 'list_articles': {
        let q = supa.from('articole')
          .select('slug, title, description, category, kind, status, keywords, published_at, updated_at')
          .order('updated_at', { ascending: false })
          .limit(Math.min(Math.max(parseInt(input.limit, 10) || 30, 1), 100));
        if (input.status === 'published' || input.status === 'draft') q = q.eq('status', input.status);
        if (input.category) q = q.eq('category', String(input.category));
        if (input.search) {
          const s = String(input.search).replace(/[%_]/g, '');
          q = q.or(`title.ilike.%${s}%,slug.ilike.%${s}%`);
        }
        const { data, error } = await q;
        if (error) return `(tabelul articole lipsește — rulează supabase/articole.sql): ${error.message}`;
        return J({
          rows: (data || []).map((r) => ({ ...r, url: `/rezolvari/${r.slug}`, description: r.description ? String(r.description).slice(0, 120) : null })),
        });
      }
      case 'read_article': {
        const { data: row, error } = await supa.from('articole').select('*').eq('slug', String(input.slug || '').trim()).maybeSingle();
        if (error) return `(tabelul articole lipsește — rulează supabase/articole.sql): ${error.message}`;
        if (!row) return `Nu există articolul cu slug="${input.slug}". Folosește list_articles pentru sluguri reale.`;
        const { content_html, ...rest } = row;
        return J({ ...rest, content_md: String(rest.content_md || '').slice(0, 24000) });
      }
      case 'list_social_posts': {
        let q = supa.from('social_posts')
          .select('platform, status, text_content, media_url, link_url, campaign, scheduled_at, posted_at, metrics, error, created_at')
          .order('created_at', { ascending: false })
          .limit(Math.min(Math.max(parseInt(input.limit, 10) || 25, 1), 60));
        if (input.platform && social.PLATFORMS.includes(input.platform)) q = q.eq('platform', input.platform);
        if (input.status && input.status !== 'toate') q = q.eq('status', input.status);
        const { data, error } = await q;
        if (error) return `(tabelul social_posts lipsește — rulează supabase/social_posts.sql): ${error.message}`;
        const rows = (data || []).map((r) => ({
          platform: r.platform, status: r.status,
          scheduled_at: r.scheduled_at, posted_at: r.posted_at,
          text: String(r.text_content || '').slice(0, 160),
          link: r.link_url || null, campaign: r.campaign || null,
          are_media: !!r.media_url,
          metrici: r.metrics ? {
            reach: r.metrics.reach ?? null, likes: r.metrics.likes ?? null,
            comments: r.metrics.comments ?? null, shares: r.metrics.shares ?? null,
          } : null,
          eroare: r.error || null,
        }));
        const byStatus = {};
        rows.forEach((r) => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
        return J({ rows, byStatus, metaConfigurat: { facebook: social.enabled(), instagram: social.igEnabled() } });
      }
      case 'yt_list_videos': {
        if (!youtube.enabled()) return 'YouTube neconectat (YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN lipsesc — vezi Faza 4a din GHID_AGENT_SEO_ACTIUNI.md). Poți totuși scrie metadate în text, pentru pus manual din YouTube Studio.';
        const r = await youtube.listVideos({ search: input.search ? String(input.search) : '', limit: input.limit });
        return J({
          canal: { titlu: r.channel.title, abonati: r.channel.stats.subscribers, vizualizariTotal: r.channel.stats.views, clipuri: r.channel.stats.videos },
          clipuri: r.videos.map((v) => ({
            id: v.id, titlu: v.title, publicat: v.publishedAt ? String(v.publishedAt).slice(0, 10) : null,
            vizibilitate: v.privacy, vizualizari: v.stats.views, likes: v.stats.likes, comentarii: v.stats.comments,
            descriere_inceput: String(v.description || '').slice(0, 120) || '(goală)',
            taguri: (v.tags || []).length,
          })),
          total: r.total,
        });
      }
      case 'yt_get_video': {
        if (!youtube.enabled()) return 'YouTube neconectat (YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN lipsesc — vezi Faza 4a din GHID_AGENT_SEO_ACTIUNI.md).';
        const v = await youtube.getVideo(String(input.id));
        return J({
          id: v.id, url: v.url, vizibilitate: v.privacy, statistici: v.stats,
          titlu: v.snippet.title || '', descriere: String(v.snippet.description || '').slice(0, 4000),
          taguri: v.snippet.tags || [], categoryId: v.snippet.categoryId || null,
          publicat: v.snippet.publishedAt || null,
        });
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
      case 'publish_article': {
        const slug = String(input.slug || '').trim().toLowerCase();
        if (!validSlug(slug)) throw new Error(`Slug invalid: „${input.slug}" — doar litere mici, cifre și cratime (3–120 caractere), ex. "formule-arii-clasa-7".`);
        const { data: existing, error: exErr } = await supa.from('articole').select('slug, status').eq('slug', slug).maybeSingle();
        if (exErr) throw new Error(`Tabelul articole lipsește? Rulează supabase/articole.sql. (${exErr.message})`);
        if (existing) throw new Error(`Slug-ul „${slug}" există deja (status: ${existing.status}) — folosește update_article sau alt slug.`);

        const title = checkArticleField('title', input.title);
        const description = checkArticleField('description', input.description);
        const category = checkArticleField('category', input.category);
        const kind = checkArticleField('kind', input.kind);
        const content_md = checkArticleField('content_md', stripLeadingTitle(input.content_md, title));
        const keywords = checkArticleField('keywords', input.keywords);
        const sources = await resolveSources(supa, input.sources);

        // HTML-ul e generat ACUM: adminul aprobă exact ce se va publica.
        const payload = {
          slug, kind, title, description, category, content_md,
          content_html: mdToHtml(content_md),
          keywords, sources,
          url: `${SITE}/rezolvari/${slug}`,
        };
        const id = await proposeAction(supa, { type: 'publish_article', payload, note: input.note }, state);
        return `Propunerea ${id} (publish_article „${title}" → /rezolvari/${slug}, ${content_md.length} caractere) a fost trimisă în coada de aprobare. Se publică DOAR după aprobarea adminului.`;
      }
      case 'update_article': {
        const slug = String(input.slug || '').trim().toLowerCase();
        const { data: row, error } = await supa.from('articole').select('*').eq('slug', slug).maybeSingle();
        if (error) throw new Error(`Tabelul articole lipsește? Rulează supabase/articole.sql. (${error.message})`);
        if (!row) throw new Error(`Nu există articolul cu slug="${slug}" — folosește list_articles (sau publish_article pentru unul nou).`);

        const changes = {};
        if (input.title != null) changes.title = { old: row.title, new: checkArticleField('title', input.title) };
        if (input.description != null) changes.description = { old: row.description, new: checkArticleField('description', input.description) };
        if (input.category != null) changes.category = { old: row.category, new: checkArticleField('category', input.category) };
        if (input.kind != null) changes.kind = { old: row.kind, new: checkArticleField('kind', input.kind) };
        if (input.content_md != null) {
          const titleForStrip = changes.title ? changes.title.new : row.title;
          changes.content_md = { old: row.content_md, new: checkArticleField('content_md', stripLeadingTitle(input.content_md, titleForStrip)) };
        }
        if (input.keywords != null) changes.keywords = { old: row.keywords || [], new: checkArticleField('keywords', input.keywords) };
        if (input.sources != null) changes.sources = { old: row.sources || [], new: await resolveSources(supa, input.sources) };

        const publish = input.publish === true && row.status !== 'published';
        Object.keys(changes).forEach((k) => {
          const c = changes[k];
          if (JSON.stringify(c.old ?? null) === JSON.stringify(c.new ?? null)) delete changes[k];
        });
        if (!Object.keys(changes).length && !publish) {
          throw new Error('Nicio schimbare față de articolul actual — trimite doar câmpurile care se modifică (sau publish=true pentru un draft).');
        }

        const payload = {
          slug, changes,
          content_html: changes.content_md ? mdToHtml(changes.content_md.new) : undefined,
          publish, old_status: row.status,
          url: `${SITE}/rezolvari/${slug}`,
        };
        const id = await proposeAction(supa, { type: 'update_article', payload, note: input.note }, state);
        const what = [...Object.keys(changes), ...(publish ? ['publicare (din draft)'] : [])].join(', ');
        return `Propunerea ${id} (update_article /rezolvari/${slug} — schimbă: ${what}) a fost trimisă în coada de aprobare.`;
      }
      case 'submit_sitemap': {
        const id = await proposeAction(supa, {
          type: 'submit_sitemap',
          payload: { sitemap: `${SITE}/sitemap.xml` },
          note: input.note || 'Retrimitere sitemap către Search Console.',
        }, state);
        return `Propunerea ${id} (submit_sitemap) a fost trimisă în coada de aprobare.`;
      }
      case 'schedule_social': {
        const platform = String(input.platform || '').toLowerCase();
        if (!social.PLATFORMS.includes(platform)) throw new Error(`Platformă necunoscută: „${input.platform}". Permise: ${social.PLATFORMS.join(', ')}.`);
        const auto = social.AUTO_PLATFORMS.includes(platform);

        // LaTeX-ul nu se randează în postări — convertim în Unicode (² √ π …)
        const text = social.plainMath(String(input.text || '')).replace(/\r\n?/g, '\n').trim();
        const maxText = platform === 'instagram' ? 2000 : 4000;
        if (text.length < 20) throw new Error('Textul postării e prea scurt (minim 20 de caractere) — scrie postarea completă, gata de publicat.');
        if (text.length > maxText) throw new Error(`Textul are ${text.length} caractere — maxim ${maxText} pe ${platform}.`);

        // când se publică (ISO cu fus orar; lipsă/trecut = cât mai curând)
        let scheduledAt = null;
        if (input.when) {
          const t = Date.parse(String(input.when));
          if (Number.isNaN(t)) throw new Error(`Data „${input.when}" nu e ISO 8601 valid — ex. "2026-08-03T18:30:00+03:00".`);
          if (t > Date.now() + 90 * 86400 * 1000) throw new Error('Postarea e programată la peste 90 de zile — prea departe; planifică pe săptămânile următoare.');
          scheduledAt = t <= Date.now() ? null : new Date(t).toISOString();
        }

        // media: imagine generată (card branded) SAU URL extern — nu ambele
        if (input.image && input.media_url) throw new Error('Alege ori "image" (card generat), ori "media_url" — nu ambele.');
        let mediaUrl = null, imageSpec = null;
        if (input.image && typeof input.image === 'object') {
          imageSpec = {
            template: String(input.image.template || ''),
            title: social.plainMath(String(input.image.title || '')).trim().slice(0, 90),
            subtitle: social.plainMath(String(input.image.subtitle || '')).trim().slice(0, 200),
            badge: String(input.image.badge || '').trim().slice(0, 30),
          };
          if (!imageSpec.title) throw new Error('image.title e obligatoriu (textul mare al cardului).');
          mediaUrl = social.imageUrl(imageSpec); // validează și șablonul; URL semnat
        } else if (input.media_url) {
          const m = String(input.media_url).trim();
          if (!/^https?:\/\//.test(m)) throw new Error('media_url trebuie să fie URL public absolut (https://…).');
          mediaUrl = m;
        }
        if (platform === 'instagram' && !mediaUrl) {
          throw new Error('Instagram cere imagine sau video: dă "image" (card branded — cel mai simplu) sau "media_url".');
        }

        // linkul promovat + UTM (doar pe domeniul propriu)
        const campaign = social.campaignSlug(input.campaign, input.link);
        const utmLink = input.link ? social.addUtm(String(input.link), { source: platform, campaign }) : null;

        const payload = {
          platform, text, scheduled_at: scheduledAt,
          link: input.link ? String(input.link) : null,
          utm_link: utmLink, campaign,
          media_url: mediaUrl, image: imageSpec,
          auto, // fb/ig = publicare automată; tiktok/youtube = coada manuală
          meta_configurat: platform === 'instagram' ? social.igEnabled() : platform === 'facebook' ? social.enabled() : null,
        };
        const id = await proposeAction(supa, { type: 'schedule_social', payload, note: input.note }, state);
        const cand = scheduledAt
          ? `programată ${new Date(scheduledAt).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' })}`
          : 'cât mai curând după aprobare';
        return `Propunerea ${id} (schedule_social ${platform}, ${cand}) a fost trimisă în coada de aprobare. ${auto ? 'După aprobare se publică automat.' : 'După aprobare intră în coada MANUALĂ din admin (TikTok/YouTube nu au API de postare fără audit).'}`;
      }
      case 'yt_update_video': {
        if (!youtube.enabled()) throw new Error('YouTube neconectat (YT_CLIENT_ID / YT_CLIENT_SECRET / YT_REFRESH_TOKEN) — fă pasul 4a din GHID_AGENT_SEO_ACTIUNI.md, apoi reia.');
        // Validăm ACUM (limitele YouTube) și citim clipul REAL — propunerea
        // păstrează valorile vechi pentru diff-ul din admin + revert.
        const checked = youtube.checkVideoMeta({
          title: input.title != null ? input.title : null,
          description: input.description != null ? input.description : null,
          tags: input.tags != null ? input.tags : null,
        });
        if (checked.title == null && checked.description == null && checked.tags == null) {
          throw new Error('Nicio schimbare: trimite cel puțin unul dintre title / description / tags.');
        }
        const v = await youtube.getVideo(String(input.id));
        const changes = {};
        if (checked.title != null && checked.title !== (v.snippet.title || '')) changes.title = { old: v.snippet.title || '', new: checked.title };
        if (checked.description != null && checked.description !== String(v.snippet.description || '').trim()) changes.description = { old: v.snippet.description || '', new: checked.description };
        if (checked.tags != null && JSON.stringify(checked.tags) !== JSON.stringify(v.snippet.tags || [])) changes.tags = { old: v.snippet.tags || [], new: checked.tags };
        if (!Object.keys(changes).length) throw new Error('Valorile propuse sunt identice cu cele actuale ale clipului — nimic de schimbat.');
        const payload = { id: v.id, url: v.url, video_title: v.snippet.title || '', changes, stats: v.stats };
        const pid = await proposeAction(supa, { type: 'yt_update_video', payload, note: input.note }, state);
        return `Propunerea ${pid} (yt_update_video „${v.snippet.title}" — schimbă: ${Object.keys(changes).join(', ')}) a fost trimisă în coada de aprobare. Se aplică pe YouTube DOAR după aprobarea adminului.`;
      }
      case 'create_video': {
        const platform = String(input.platform || '').toLowerCase();
        if (!social.PLATFORMS.includes(platform)) throw new Error(`Platformă necunoscută: „${input.platform}". Permise: ${social.PLATFORMS.join(', ')}.`);
        const auto = social.AUTO_PLATFORMS.includes(platform);

        // scenele: validate + curățate de LaTeX (slide-urile nu randează formule)
        const rawScenes = (Array.isArray(input.scenes) ? input.scenes : []).map((sc) => ({
          ...sc,
          title: social.plainMath(String(sc?.title || '')),
          subtitle: social.plainMath(String(sc?.subtitle || '')),
          bullets: Array.isArray(sc?.bullets) ? sc.bullets.map((b) => social.plainMath(String(b))) : sc?.bullets,
        }));
        const spec = video.checkVideoSpec({ format: input.format, scenes: rawScenes });

        const text = social.plainMath(String(input.text || '')).replace(/\r\n?/g, '\n').trim();
        const maxText = platform === 'instagram' ? 2000 : platform === 'youtube' ? 4800 : platform === 'tiktok' ? 2200 : 4000;
        if (text.length < 20) throw new Error('text e prea scurt (minim 20 de caractere) — scrie captionul/descrierea completă.');
        if (text.length > maxText) throw new Error(`text are ${text.length} caractere — maxim ${maxText} pe ${platform}.`);

        // youtube/tiktok = O SINGURĂ propunere → clipul intră în AMBELE cozi
        // manuale (cerința adminului: fiecare clip merge și pe YouTube, și pe
        // TikTok). De-asta titlul YouTube e obligatoriu la ambele platforme.
        const dual = platform === 'youtube' || platform === 'tiktok';
        let ytTitle = null, ytTags = null, tiktokText = null;
        if (dual) {
          if (!input.title) throw new Error(`La ${platform}, title (titlul clipului pentru YouTube) e obligatoriu — clipul intră în ambele cozi: YouTube și TikTok.`);
          const checked = youtube.checkVideoMeta({ title: input.title, tags: input.tags != null ? input.tags : null });
          ytTitle = checked.title;
          ytTags = checked.tags || null;
          if (platform === 'tiktok') {
            tiktokText = text; // textul propus E captionul TikTok
          } else if (input.tiktok_text) {
            tiktokText = social.plainMath(String(input.tiktok_text)).replace(/\r\n?/g, '\n').trim();
            if (tiktokText.length < 20) throw new Error('tiktok_text e prea scurt (minim 20 de caractere).');
            if (tiktokText.length > 2200) throw new Error(`tiktok_text are ${tiktokText.length} caractere — maxim 2200 pe TikTok.`);
          } else {
            tiktokText = text.length > 2200 ? text.slice(0, 2197).trimEnd() + '…' : text; // descrierea YouTube, scurtată la limita TikTok
          }
        }

        let scheduledAt = null;
        if (auto && input.when) {
          const t = Date.parse(String(input.when));
          if (Number.isNaN(t)) throw new Error(`Data „${input.when}" nu e ISO 8601 valid — ex. "2026-08-03T18:30:00+03:00".`);
          if (t > Date.now() + 90 * 86400 * 1000) throw new Error('Programat la peste 90 de zile — prea departe.');
          scheduledAt = t <= Date.now() ? null : new Date(t).toISOString();
        }

        const campaign = social.campaignSlug(input.campaign, input.link);
        const utmLink = (auto && input.link) ? social.addUtm(String(input.link), { source: platform, campaign }) : null;

        // clip FB/IG → la execuție se publică pe AMBELE platforme Meta
        // (Reels + video Facebook), dacă ambele sunt configurate
        const metaDual = auto && (platform === 'instagram' ? social.enabled() : social.igEnabled());
        const payload = {
          platform, auto, dual, meta_dual: metaDual,
          format: spec.format, scenes: spec.scenes, seconds: spec.seconds,
          text, title: ytTitle, tags: ytTags, tiktok_text: tiktokText,
          scheduled_at: scheduledAt,
          link: input.link ? String(input.link) : null,
          utm_link: utmLink, campaign,
          meta_configurat: platform === 'instagram' ? social.igEnabled() : platform === 'facebook' ? social.enabled() : null,
        };
        const pid = await proposeAction(supa, { type: 'create_video', payload, note: input.note }, state);
        const eticheta = dual ? 'youtube + tiktok' : metaDual ? 'instagram + facebook' : platform;
        return `Propunerea ${pid} (create_video ${eticheta}, ${spec.scenes.length} scene, ~${spec.seconds}s, ${spec.format}) a fost trimisă în coada de aprobare. Clipul se randează DOAR la aprobare (cu muzică de fundal); apoi ${auto ? (metaDual ? 'se publică automat pe AMBELE: Instagram (Reels) + Facebook (video)' : 'se publică automat') : 'intră gata făcut în AMBELE cozi manuale din admin — YouTube și TikTok (download + upload de către admin)'}.`;
      }
      default:
        return `Unealtă necunoscută: ${name}`;
    }
  };
}

// ─── EDITAREA unei propuneri „proposed" (chemată din api/seo-actions.js) ─────
// Adminul poate corecta TEXTELE unei propuneri înainte de aprobare — cu
// ACELEAȘI validări ca la creare. Patch-ul conține doar câmpurile schimbate.
// Întoarce payload-ul nou (nu scrie în DB — endpointul face update-ul).
function editActionPayload(action, patch = {}) {
  if (!action || action.status !== 'proposed') throw new Error('Doar propunerile în așteptare se pot edita.');
  const p = JSON.parse(JSON.stringify(action.payload || {}));

  switch (action.type) {
    case 'schedule_social': {
      if (patch.text != null) {
        const text = social.plainMath(String(patch.text)).replace(/\r\n?/g, '\n').trim();
        const maxText = p.platform === 'instagram' ? 2000 : 4000;
        if (text.length < 20) throw new Error('Textul postării e prea scurt (minim 20 de caractere).');
        if (text.length > maxText) throw new Error(`Textul are ${text.length} caractere — maxim ${maxText} pe ${p.platform}.`);
        p.text = text;
      }
      return p;
    }
    case 'create_video': {
      const dual = !!p.dual || p.platform === 'tiktok'; // clip youtube/tiktok → ambele cozi
      if (patch.text != null) {
        const text = social.plainMath(String(patch.text)).replace(/\r\n?/g, '\n').trim();
        const maxText = p.platform === 'instagram' ? 2000 : p.platform === 'youtube' ? 4800 : p.platform === 'tiktok' ? 2200 : 4000;
        if (text.length < 20) throw new Error('Textul e prea scurt (minim 20 de caractere).');
        if (text.length > maxText) throw new Error(`Textul are ${text.length} caractere — maxim ${maxText} pe ${p.platform}.`);
        p.text = text;
        if (p.platform === 'tiktok') p.tiktok_text = text; // textul E captionul TikTok
      }
      if (patch.tiktok_text != null && dual && p.platform === 'youtube') {
        const tt = social.plainMath(String(patch.tiktok_text)).replace(/\r\n?/g, '\n').trim();
        if (tt.length < 20) throw new Error('Captionul TikTok e prea scurt (minim 20 de caractere).');
        if (tt.length > 2200) throw new Error(`Captionul TikTok are ${tt.length} caractere — maxim 2200.`);
        p.tiktok_text = tt;
      }
      if (patch.title != null && (p.platform === 'youtube' || dual)) p.title = youtube.checkVideoMeta({ title: patch.title }).title;
      if (patch.tags != null && (p.platform === 'youtube' || dual)) p.tags = youtube.checkVideoMeta({ tags: patch.tags }).tags;
      return p;
    }
    case 'yt_update_video': {
      const ch = p.changes || {};
      for (const f of ['title', 'description', 'tags']) {
        if (patch[f] == null) continue;
        if (!ch[f]) throw new Error(`Câmpul „${f}" nu era în această propunere — respinge-o și cere agentului una nouă cu el.`);
        const checked = youtube.checkVideoMeta({ [f]: patch[f] })[f];
        if (JSON.stringify(checked ?? null) === JSON.stringify(ch[f].old ?? null)) delete ch[f];
        else ch[f].new = checked;
      }
      if (!Object.keys(ch).length) throw new Error('După editare nu mai rămâne nicio schimbare față de clipul actual — respinge propunerea.');
      p.changes = ch;
      return p;
    }
    case 'publish_article': {
      if (patch.title != null) p.title = checkArticleField('title', patch.title);
      if (patch.description != null) p.description = checkArticleField('description', patch.description);
      if (patch.content_md != null) {
        p.content_md = checkArticleField('content_md', stripLeadingTitle(patch.content_md, p.title));
        p.content_html = mdToHtml(p.content_md);
      }
      return p;
    }
    case 'update_article': {
      const ch = p.changes || {};
      const editable = { title: 'title', description: 'description', content_md: 'content_md' };
      for (const f of Object.keys(editable)) {
        if (patch[f] == null) continue;
        if (!ch[f]) throw new Error(`Câmpul „${f}" nu era în această propunere — respinge-o și cere agentului una nouă cu el.`);
        const titleForStrip = ch.title ? ch.title.new : (patch.title != null ? patch.title : null);
        const val = f === 'content_md'
          ? checkArticleField('content_md', stripLeadingTitle(patch.content_md, titleForStrip || ''))
          : checkArticleField(f, patch[f]);
        if (JSON.stringify(val ?? null) === JSON.stringify(ch[f].old ?? null)) delete ch[f];
        else ch[f].new = val;
      }
      if (ch.content_md) p.content_html = mdToHtml(ch.content_md.new);
      if (!Object.keys(ch).length && !p.publish) throw new Error('După editare nu mai rămâne nicio schimbare — respinge propunerea.');
      p.changes = ch;
      return p;
    }
    default:
      throw new Error(`Propunerile de tip „${action.type}" nu se pot edita — respinge-o și cere agentului una nouă.`);
  }
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
    case 'publish_article': {
      const now = new Date().toISOString();
      const { error } = await supa.from('articole').insert({
        slug: p.slug, title: p.title, description: p.description,
        category: p.category, kind: p.kind,
        content_md: p.content_md,
        content_html: p.content_html || mdToHtml(p.content_md),
        keywords: p.keywords || [], sources: p.sources || [],
        status: 'published', published_at: now, updated_at: now,
      });
      if (error) {
        if (/duplicate|unique|23505/i.test(error.message + (error.code || ''))) {
          throw new Error(`Slug-ul „${p.slug}" a fost ocupat între timp — cere agentului o propunere nouă (update_article sau alt slug).`);
        }
        throw new Error(`Nu am putut publica (rulează supabase/articole.sql?): ${error.message}`);
      }
      const result = { published: `/rezolvari/${p.slug}`, url: `${SITE}/rezolvari/${p.slug}`, live_in: '≤ 5 minute (cache CDN)' };
      // Sitemap-ul include automat articolul — îl retrimitem către GSC (best effort).
      try {
        if (google.enabled()) { await google.submitSitemap(`${SITE}/sitemap.xml`); result.sitemap = 'retrimis către Search Console'; }
        else result.sitemap = 'neretrimis (contul de serviciu Google nu e configurat)';
      } catch (e) { result.sitemap = `retrimitere eșuată: ${e.message}`; }
      return result;
    }
    case 'update_article': {
      const patch = { updated_at: new Date().toISOString() };
      for (const [field, c] of Object.entries(p.changes || {})) patch[field] = c.new;
      if (p.changes?.content_md) patch.content_html = p.content_html || mdToHtml(p.changes.content_md.new);
      if (p.publish) { patch.status = 'published'; patch.published_at = patch.published_at || new Date().toISOString(); }
      const { data, error } = await supa.from('articole').update(patch).eq('slug', p.slug).select('slug').maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error(`Articolul „${p.slug}" nu mai există.`);
      return {
        updated: `/rezolvari/${p.slug}`, url: `${SITE}/rezolvari/${p.slug}`,
        fields: Object.keys(p.changes || {}), ...(p.publish ? { republished: true } : {}),
        live_in: '≤ 5 minute (cache CDN)',
      };
    }
    case 'schedule_social': {
      // Aprobare ≠ publicare: rândul intră în calendarul social_posts, iar
      // publicarea o face api/social-cron.js la ora programată (FB/IG) sau
      // adminul, manual, din panoul Social (TikTok/YouTube).
      const status = p.auto ? 'approved' : 'manual';
      const { data, error } = await supa.from('social_posts').insert({
        platform: p.platform,
        text_content: p.text,
        media_url: p.media_url || null,
        link_url: p.utm_link || null,
        campaign: p.campaign || null,
        image: p.image || null,
        scheduled_at: p.scheduled_at || null,
        status,
        action_id: action.id || null,
      }).select('id').single();
      if (error) throw new Error(`Nu am putut programa postarea (rulează supabase/social_posts.sql?): ${error.message}`);
      const result = { queued: p.platform, post_id: data.id, status };
      if (p.auto) {
        result.publicare = p.scheduled_at
          ? `automat, la ${new Date(p.scheduled_at).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' })} (cron la 15 min)`
          : 'automat, la următoarea rulare a cronului (≤ 15 min)';
        const configured = p.platform === 'instagram' ? social.igEnabled() : social.enabled();
        if (!configured) result.atentie = 'Meta neconfigurat (META_PAGE_ID / META_PAGE_TOKEN / META_IG_USER_ID) — publicarea va eșua până faci pasul 3a din GHID_AGENT_SEO_ACTIUNI.md.';
      } else {
        result.publicare = 'manual — apare în panoul „Calendar social" din admin (copy-paste)';
      }
      return result;
    }
    case 'yt_update_video': {
      const changes = p.changes || {};
      const r = await youtube.updateVideo({
        id: p.id,
        title: changes.title ? changes.title.new : null,
        description: changes.description ? changes.description.new : null,
        tags: changes.tags ? changes.tags.new : null,
      });
      return { applied: 'youtube', id: r.id, url: r.url, title: r.title, fields: Object.keys(changes), live_in: 'imediat (YouTube)' };
    }
    case 'create_video': {
      // 1) randăm clipul (satori → sharp → ffmpeg) — poate dura 30–90s.
      //    Cu MUZICĂ de fundal: fișierul adminului din Storage
      //    (agent-media/audio/fundal.mp3) sau instrumentalul din repo.
      const spec = video.checkVideoSpec({ format: p.format, scenes: p.scenes });
      const music = await video.resolveMusic(supa).catch(() => null);
      const rendered = await video.renderVideo(spec, { music });
      // 2) îl urcăm în Storage (bucket public agent-media) → URL pentru Meta/coada manuală
      const up = await video.uploadVideo(supa, rendered.buffer, p.campaign || p.platform || 'clip');
      // 3) intră în calendarul social: youtube/tiktok → ACELAȘI clip în AMBELE
      //    cozi manuale; instagram/facebook → se publică AUTOMAT pe AMBELE
      //    platforme Meta (Reels + video Facebook) — Reels-urile publicate
      //    prin API NU se pot redistribui manual de pe Instagram pe Facebook.
      const status = p.auto ? 'approved' : 'manual';
      const dual = p.dual || (!p.auto && (p.platform === 'youtube' || p.platform === 'tiktok'));
      const metaDual = p.auto && (
        (p.platform === 'instagram' && social.enabled()) ||
        (p.platform === 'facebook' && social.igEnabled())
      );
      const ytText = `TITLU: ${p.title || ''}\n\nDESCRIERE:\n${p.text}${(p.tags || []).length ? `\n\nTAGURI: ${p.tags.join(', ')}` : ''}`;
      const ttFallback = String(p.tiktok_text || p.text || '');
      const ttText = ttFallback.length > 2200 ? ttFallback.slice(0, 2197).trimEnd() + '…' : ttFallback;
      const rows = dual
        ? [
          { platform: 'youtube', text_content: p.title ? ytText : p.text },
          { platform: 'tiktok', text_content: ttText },
        ]
        : metaDual
          ? [
            { platform: p.platform, text_content: p.text },
            { platform: p.platform === 'instagram' ? 'facebook' : 'instagram', text_content: p.text },
          ]
          : [{ platform: p.platform, text_content: p.platform === 'youtube' ? ytText : p.text }];

      const base = {
        media_url: up.url,
        link_url: p.utm_link || null,
        campaign: p.campaign || null,
        scheduled_at: p.scheduled_at || null,
        status,
        action_id: action.id || null,
      };
      const { data, error } = await supa.from('social_posts')
        .insert(rows.map((r) => ({ ...base, ...r })))
        .select('id, platform');
      if (error) throw new Error(`Clipul e randat (${up.url}), dar nu am putut crea postarea (rulează supabase/social_posts.sql?): ${error.message}`);
      const inserted = data || [];
      const postIds = {};
      inserted.forEach((r) => { postIds[r.platform] = r.id; });
      const result = {
        video: up.url, storage_path: up.path, seconds: rendered.seconds,
        post_id: inserted[0]?.id || null, post_ids: postIds, status,
      };
      if (p.auto) {
        const unde = metaDual ? 'pe AMBELE: Instagram (Reels) + Facebook (video)' : `(${p.platform === 'instagram' ? 'Reels' : 'video'})`;
        result.publicare = p.scheduled_at
          ? `automat ${unde}, la ${new Date(p.scheduled_at).toLocaleString('ro-RO', { timeZone: 'Europe/Bucharest' })}`
          : `automat ${unde}, la următoarea rulare a cronului (≤ 15 min)`;
        const configured = p.platform === 'instagram' ? social.igEnabled() : social.enabled();
        if (!configured) result.atentie = 'Meta neconfigurat — publicarea va eșua până la pasul 3a din ghid.';
      } else if (dual) {
        result.publicare = 'manual — clipul e gata în panoul „Calendar social", în AMBELE cozi: YouTube și TikTok (descarcă MP4 + copiază textele, ~2 min fiecare)';
      } else {
        result.publicare = 'manual — clipul e gata în panoul „Calendar social" (descarcă MP4 + copiază textele, ~2 min)';
      }
      return result;
    }
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
    case 'publish_article': {
      // Retragere de pe site: articolul trece în draft (conținutul se păstrează;
      // dispare din pagină, sitemap și page-meta — republicabil cu update_article).
      const { error } = await supa.from('articole')
        .update({ status: 'draft', updated_at: new Date().toISOString() })
        .eq('slug', p.slug);
      if (error) throw new Error(error.message);
      return { reverted: `/rezolvari/${p.slug}`, status: 'draft (retras de pe site, conținutul păstrat)' };
    }
    case 'update_article': {
      const patch = { updated_at: new Date().toISOString() };
      for (const [field, c] of Object.entries(p.changes || {})) patch[field] = c.old;
      if (p.changes?.content_md) patch.content_html = mdToHtml(String(p.changes.content_md.old || ''));
      if (p.publish && p.old_status === 'draft') patch.status = 'draft';
      const { error } = await supa.from('articole').update(patch).eq('slug', p.slug);
      if (error) throw new Error(error.message);
      return { reverted: `/rezolvari/${p.slug}`, restored: Object.keys(p.changes || {}) };
    }
    case 'schedule_social': {
      const postId = action.result?.post_id;
      if (!postId) throw new Error('Nu găsesc postarea programată (result.post_id lipsește).');
      const { data: row, error } = await supa.from('social_posts').select('*').eq('id', postId).maybeSingle();
      if (error) throw new Error(error.message);
      if (!row) throw new Error('Postarea nu mai există în social_posts.');
      if (row.status === 'canceled') return { reverted: postId, status: 'era deja anulată' };
      if (row.status === 'posted') {
        // publicată deja: pe Facebook o putem șterge prin API; pe restul nu
        if (row.platform === 'facebook' && row.external_id) {
          await social.deleteFbPost(row.external_id);
          const { error: upErr } = await supa.from('social_posts')
            .update({ status: 'canceled', error: 'ștearsă de pe Facebook prin revert' }).eq('id', postId);
          if (upErr) throw new Error(upErr.message);
          return { reverted: postId, deleted: 'postarea a fost ștearsă de pe Facebook' };
        }
        throw new Error(`Postarea e deja publicată pe ${row.platform} — ${row.platform === 'instagram' ? 'Instagram nu permite ștergerea prin API; șterge-o din aplicație' : 'marcheaz-o manual'}.`);
      }
      const { error: upErr } = await supa.from('social_posts').update({ status: 'canceled' }).eq('id', postId);
      if (upErr) throw new Error(upErr.message);
      return { reverted: postId, status: 'anulată (nu se mai publică)' };
    }
    case 'yt_update_video': {
      const changes = p.changes || {};
      const r = await youtube.updateVideo({
        id: p.id,
        title: changes.title ? changes.title.old : null,
        description: changes.description ? changes.description.old : null,
        tags: changes.tags ? changes.tags.old : null,
      });
      return { reverted: 'youtube', id: r.id, url: r.url, restored: Object.keys(changes) };
    }
    case 'create_video': {
      // identic cu schedule_social: anulăm postarea din calendar (clipul rămâne
      // în Storage — inofensiv; îl poți refolosi sau șterge din Supabase).
      // Clipurile youtube/tiktok au DOUĂ postări (ambele cozi) — le anulăm pe toate.
      const ids = [...new Set([
        ...(Object.values(action.result?.post_ids || {})),
        ...(action.result?.post_id ? [action.result.post_id] : []),
      ].filter(Boolean))];
      if (!ids.length) throw new Error('Nu găsesc postarea clipului (result.post_id lipsește).');
      const out = [];
      for (const postId of ids) {
        const { data: row, error } = await supa.from('social_posts').select('*').eq('id', postId).maybeSingle();
        if (error) throw new Error(error.message);
        if (!row) { out.push({ id: postId, status: 'nu mai există în social_posts' }); continue; }
        if (row.status === 'canceled') { out.push({ id: postId, platform: row.platform, status: 'era deja anulată' }); continue; }
        if (row.status === 'posted') {
          if (row.platform === 'facebook' && row.external_id) {
            await social.deleteFbPost(row.external_id);
            await supa.from('social_posts').update({ status: 'canceled', error: 'ștearsă de pe Facebook prin revert' }).eq('id', postId);
            out.push({ id: postId, platform: 'facebook', status: 'ștearsă de pe Facebook' });
            continue;
          }
          out.push({ id: postId, platform: row.platform, status: `deja publicată pe ${row.platform} — ${row.platform === 'instagram' ? 'Instagram nu permite ștergerea prin API; șterge-o din aplicație' : 'șterge-o manual din aplicație'}` });
          continue;
        }
        await supa.from('social_posts').update({ status: 'canceled' }).eq('id', postId);
        out.push({ id: postId, platform: row.platform, status: 'anulată (nu se mai publică)' });
      }
      return { reverted: out, nota: 'fișierul MP4 rămâne în Storage' };
    }
    default:
      throw new Error(`Acțiunea ${action.type} nu are revert automat.`);
  }
}

// ─── Rularea agentului (interactiv din admin sau automat din cron) ───────────
function buildSystem({ routesCtx, contentCtx, googleCtx, instr, hasTools }) {
  const toolsBlock = hasTools ? `

=== UNELTELE TALE (folosește-le!) ===
CITIRE — se execută imediat: gsc_query, ga4_report, url_inspect, psi_report, fetch_page, db_stats, list_materials, read_material, get_seo_meta, list_articles, read_article, list_social_posts, yt_list_videos, yt_get_video.
SCRIERE — NU modifică nimic direct: creează PROPUNERI în coada de aprobare din admin: set_page_meta, rename_material, publish_article, update_article, submit_sitemap, schedule_social, yt_update_video.

Fluxul corect: (1) verifică datele reale (gsc_query / db_stats / get_seo_meta / fetch_page / list_articles); (2) decide pe cifre, nu pe presupuneri; (3) trimite propuneri concrete prin uneltele de scriere, fiecare cu «note» care explică DE CE (cu cifrele care o justifică); (4) încheie cu un raport scurt: ce ai găsit + ce propuneri ai trimis.
Reguli: nu inventa rute sau id-uri (ia-le din structura site-ului / list_materials / list_articles / db_stats); titluri ≤ 60 caractere, descrieri ≤ 155; propune DOAR modificări justificate de date; maximum ~6 propuneri pe rulare — calitate, nu volum (un articol = o propunere mare, nu-l fragmenta). Modificările devin live abia după aprobarea adminului.
ARTICOLE (pagina „Blog / Rezolvări / Teorie", /rezolvari/{slug}): conținut GRATUIT și indexabil — rezolvări scrise pas cu pas, explicații de noțiuni, articole SEO. Fiecare trebuie să aibă substanță reală (explicație + exemple + formule LaTeX între $...$ + linkuri interne relative + tabele unde ajută) — „thin content" în serie face rău. Bazează-te pe materialele reale (read_material) și listează-le în sources: pagina afișează automat linkuri către ele + CTA premium (așa se face conversia).
SOCIAL (schedule_social): Facebook/Instagram se publică AUTOMAT la ora programată (după aprobare); TikTok/YouTube intră în coada manuală a adminului. Public: părinți → Facebook (ghiduri, calendar examene, articole noi); elevi → Instagram/TikTok (formula/exercițiul zilei, greșeli frecvente, countdown examene). Instagram cere media: folosește image:{template: formula|exercitiu|greseala|countdown|anunt, title, subtitle, badge} — carduri branded generate de site. ATENȚIE: NICIODATĂ LaTeX sau $...$ în textele sociale (nici în caption, nici pe carduri) — captionurile nu randează formule; scrie matematica cu simboluri Unicode (² ³ √ π × ≤ ≠). Linkurile către site primesc UTM automat; verifică efectul în ga4_report și învață din metricile din list_social_posts.
VIDEO (create_video): poți CREA clipuri simple branded — montaj de slide-uri (titlu/bullets/imagine/statistică/outro) randate în stilul ExamenMate, MP4 vertical 1080×1920 (sau orizontal), cu muzică de fundal. După aprobare: un clip pe instagram sau facebook se PUBLICĂ AUTOMAT pe AMBELE platforme Meta la ora aleasă (Reels pe Instagram + video pe Facebook — Reels-urile publicate prin API nu se pot redistribui manual între ele, de-asta merg pe ambele din start); un clip pe youtube sau tiktok intră gata făcut în AMBELE cozi manuale — YouTube ȘI TikTok, dintr-o singură propunere (adminul îl descarcă și îl urcă în câte 2 minute — API-urile lor nu permit publicare directă fără audit; dă title/tags pentru YouTube și, opțional, tiktok_text pentru captionul TikTok). Scenele au text scurt (Unicode, nu LaTeX); imaginile doar URL-uri REALE (og_image, carduri generate, imagini din site — nu inventa).
YOUTUBE: yt_update_video optimizează metadatele clipurilor EXISTENTE (titlu cu formularea căutată din GSC, descriere cu linkuri UTM, taguri) — reversibil; pentru clipuri NOI folosește create_video (clipul e produs de site, adminul doar îl urcă din YouTube Studio — coada manuală).` : `

(Uneltele de acțiune nu sunt disponibile în această rulare — dai doar recomandări în text.)`;

  return `Ești agentul SEO & MARKETING al platformei ExamenMate (${SITE}) — platformă românească de matematică pentru clasele 5–12, Evaluarea Națională și Bacalaureat, cu abonament premium, exerciții interactive, rezolvări video/PDF și Profesor Virtual AI.

Public țintă: elevi 10–19 ani, părinți, profesori (România). Concurență: siteuri de meditații, culegeri online, canale YouTube.

=== FUNCȚIONALITĂȚILE PLATFORMEI (descrie-le CONCRET în articole și postări — fiecare public trebuie să afle ce primește) ===
PENTRU ELEVI: PROFESORUL VIRTUAL (tutor AI, /profesor-virtual) răspunde la întrebări direct din materialul la care lucrează elevul — din PDF-uri, din exercițiile interactive sau din orice alt exercițiu — cu explicații pas cu pas, oricând; TESTE INTERACTIVE cu verificare pe loc, rezolvări imediate și explicații la fiecare întrebare; exerciții generate de AI pentru antrenament; temele primite de la profesor se rezolvă direct pe site.
PENTRU PĂRINȚI: există CONT DE PĂRINTE — părintele se asociază cu copilul printr-un simplu link de invitație și vede în contul lui: rezultatele și evoluția copilului (grafic de progres), dacă a rezolvat independent sau a folosit Profesorul Virtual (și câte întrebări a pus), de câte ori a încercat fiecare test, cât timp a lucrat și ce teme a primit de la profesor.
PENTRU PROFESORI: există CONT DE PROFESOR — profesorul își invită elevii printr-un link, îi organizează pe GRUPE (clase), trimite teste interactive ca TEMĂ, vede clasamentul grupelor și evoluția fiecărui elev (punctaje, număr de încercări, timp de lucru, dacă a folosit Profesorul Virtual); poate GENERA cu AI teste de examen în formatul EXACT al Evaluării Naționale sau al Bacalaureatului (cu barem), poate genera exerciții interactive sau PDF, poate PUBLICA testele generate și le poate folosi la clasă.
ALTE FACILITĂȚI: asistent AI la orice material, biblioteca utilizatorilor (materiale publicate de comunitate), rezolvări video/PDF, articole cu teorie și rezolvări scrise pas cu pas.
REGULĂ DE VOCABULAR (obligatorie, în TOT ce scrii): NU folosi NICIODATĂ cuvântul „teză"/„teze" — în România nu se mai susțin teze. Spune „lucrare", „test", „evaluare" sau „examen".

=== STRUCTURA SITE-ULUI (SPA React — generată dinamic din DB și sitemap) ===
${routesCtx}

=== CONȚINUT ACTUAL ===
${contentCtx}${googleCtx}${toolsBlock}

Reguli: răspunzi în română, concret și acționabil, fără generalități. Când scrii conținut (meta, articole, postări), e gata de copiat. Când ai date reale Google, ancorează totul în cifre (interogări, poziții, CTR). Site-ul e SPA client-side, dar rutele publice sunt servite prin api/page-meta cu meta dinamice din tabelul seo_meta — modificările tale de meta ajung live fără deploy.

SARCINA CURENTĂ: ${instr}`;
}

// `model` (opțional): ID-ul Claude ales de admin din selectorul de model
// (validat în claude.resolveModel — orice valoare necunoscută cade pe implicit).
async function runAgent({ supa, task = 'chat', input = '', history = [], maxIters = 8, model = null }) {
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
    const r = await claude.chatClaude({ system, messages, temperature: 0.6, maxTokens: 3000, model });
    return { ...r, toolCalls: 0, proposals: 0, googleConnected: google.enabled() };
  }

  const state = { proposals: [] };
  const executeTool = makeToolExecutor({ supa, state });
  const r = await claude.chatClaudeTools({ system, messages, tools: TOOLS, executeTool, maxTokens: 3000, maxIters, model });
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

// =====================================================================
// FAZA 4b — RANK-TRACKING și MĂSURARE (grafice în admin + raport lunar).
// Sursa: gsc_snapshots (populat zilnic de seo-cron?action=snapshot).
// =====================================================================
const dayStr = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));
// Ultima zi „finalizată" din GSC: acum 3 zile (datele au ~2 zile întârziere).
const lastFinalizedDay = (now = new Date()) => dayStr(new Date(now.getTime() - 3 * 86400 * 1000));
const addDays = (day, n) => dayStr(new Date(Date.parse(day + 'T00:00:00Z') + n * 86400 * 1000));

// Citește gsc_snapshots paginat (peste limita de 1000 de rânduri PostgREST).
async function snapshotRows(supa, { dim, fromDay, toDay, keys = null, maxPages = 30 }) {
  const out = [];
  for (let p = 0; p < maxPages; p++) {
    let q = supa.from('gsc_snapshots')
      .select('day, dim, key, clicks, impressions, ctr, position')
      .eq('dim', dim).gte('day', fromDay).lte('day', toDay)
      .order('day', { ascending: true })
      .range(p * 1000, p * 1000 + 999);
    if (Array.isArray(keys) && keys.length) q = q.in('key', keys.slice(0, 50));
    const { data, error } = await q;
    if (error) throw new Error(`gsc_snapshots (rulează supabase/seo_agent.sql?): ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

// Agregarea PURĂ a snapshot-urilor (testată în test/youtube.test.js):
// totaluri zilnice + top chei (după clicuri, apoi impresii) + seriile pe zi
// ale cheilor alese. Poziția pe cheie e media ponderată cu impresiile.
function buildRankData(rows, { keys = null, top = 8 } = {}) {
  const daily = new Map();   // day → {clicks, impressions}
  const byKey = new Map();   // key → {clicks, impressions, posW, impW, days}
  for (const r of rows || []) {
    const day = dayStr(r.day);
    const d = daily.get(day) || { clicks: 0, impressions: 0 };
    d.clicks += r.clicks || 0; d.impressions += r.impressions || 0;
    daily.set(day, d);
    const k = byKey.get(r.key) || { key: r.key, clicks: 0, impressions: 0, posW: 0, impW: 0, days: 0 };
    k.clicks += r.clicks || 0; k.impressions += r.impressions || 0; k.days++;
    if (r.position != null && (r.impressions || 0) > 0) { k.posW += Number(r.position) * r.impressions; k.impW += r.impressions; }
    byKey.set(r.key, k);
  }
  const aggregates = [...byKey.values()]
    .map((k) => ({ key: k.key, clicks: k.clicks, impressions: k.impressions, position: k.impW ? Number((k.posW / k.impW).toFixed(1)) : null, days: k.days }))
    .sort((a, b) => (b.clicks - a.clicks) || (b.impressions - a.impressions));

  const wanted = (Array.isArray(keys) && keys.length)
    ? keys.slice(0, 10)
    : aggregates.slice(0, Math.min(Math.max(top, 1), 10)).map((k) => k.key);
  const wantedSet = new Set(wanted);
  const series = {};
  wanted.forEach((k) => { series[k] = []; });
  for (const r of rows || []) {
    if (!wantedSet.has(r.key)) continue;
    series[r.key].push({
      day: dayStr(r.day),
      position: r.position != null ? Number(Number(r.position).toFixed(1)) : null,
      clicks: r.clicks || 0,
      impressions: r.impressions || 0,
    });
  }
  return {
    daily: [...daily.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([day, v]) => ({ day, ...v })),
    aggregates,
    series,
  };
}

// Eticheta + ruta măsurabilă a unei acțiuni executate (pure; pentru markerele
// de pe grafice și pentru „efectul acțiunilor"). rename_material și acțiunile
// sociale nu au o rută proprie în GSC → doar marker, fără măsurare pe pagină.
function actionSummary(action) {
  const p = action?.payload || {};
  switch (action?.type) {
    case 'set_page_meta':   return { label: `Meta ${p.route || '?'}`, route: p.route || null };
    case 'publish_article': return { label: `Articol /rezolvari/${p.slug || '?'}`, route: p.slug ? `/rezolvari/${p.slug}` : null };
    case 'update_article':  return { label: `Refresh /rezolvari/${p.slug || '?'}`, route: p.slug ? `/rezolvari/${p.slug}` : null };
    case 'rename_material': return { label: `Redenumire „${String(p.new_title || '').slice(0, 40)}"`, route: null };
    case 'submit_sitemap':  return { label: 'Sitemap retrimis', route: null };
    case 'schedule_social': return { label: `Postare ${p.platform || 'social'}`, route: null };
    case 'yt_update_video': return { label: `YouTube „${String(p.video_title || '').slice(0, 40)}"`, route: null };
    default:                return { label: action?.type || '?', route: null };
  }
}

// Acțiunile EXECUTATE din ultimele `sinceDays` zile — markerele graficelor.
async function actionMarkers(supa, sinceDays = 90) {
  const since = new Date(Date.now() - sinceDays * 86400 * 1000).toISOString();
  const { data, error } = await supa.from('seo_actions')
    .select('id, type, payload, note, executed_at, status')
    .in('status', ['executed', 'reverted'])
    .gte('executed_at', since)
    .order('executed_at', { ascending: true })
    .limit(120);
  if (error) return [];
  return (data || []).map((a) => {
    const s = actionSummary(a);
    return { id: a.id, type: a.type, day: dayStr(a.executed_at), label: s.label, route: s.route, status: a.status, note: a.note || null };
  });
}

// Efectul fiecărei acțiuni executate care ARE o rută: media pe zi a
// clicurilor/impresiilor + poziția, `windowDays` înainte vs. după execuție
// (din gsc_snapshots, dim='page'). „După" cere minim 5 zile finalizate.
function computeEffect(rows, { day, windowDays = 14 }) {
  const from = addDays(day, -windowDays), until = addDays(day, windowDays);
  const last = lastFinalizedDay();
  const bucket = (a, b) => {
    const rr = rows.filter((r) => dayStr(r.day) >= a && dayStr(r.day) <= b);
    if (!rr.length) return null;
    const clicks = rr.reduce((s, r) => s + (r.clicks || 0), 0);
    const imps = rr.reduce((s, r) => s + (r.impressions || 0), 0);
    const posW = rr.reduce((s, r) => s + (r.position != null ? Number(r.position) * (r.impressions || 0) : 0), 0);
    const impW = rr.reduce((s, r) => s + (r.position != null ? (r.impressions || 0) : 0), 0);
    const nDays = Math.max((Date.parse(b) - Date.parse(a)) / 86400000 + 1, 1);
    return {
      days: Math.round(nDays),
      clicksPerDay: Number((clicks / nDays).toFixed(2)),
      impressionsPerDay: Number((imps / nDays).toFixed(1)),
      position: impW ? Number((posW / impW).toFixed(1)) : null,
    };
  };
  const afterEnd = until < last ? until : last;
  const afterDays = Math.floor((Date.parse(afterEnd) - Date.parse(day)) / 86400000);
  if (afterDays < 5) return { pending: true, daysSoFar: Math.max(afterDays, 0) }; // prea devreme de măsurat
  return { before: bucket(addDays(day, -windowDays), addDays(day, -1)), after: bucket(day, afterEnd) };
}

async function measureActionEffects(supa, { sinceDays = 90, windowDays = 14 } = {}) {
  const markers = await actionMarkers(supa, sinceDays);
  const withRoute = markers.filter((m) => m.route && m.status === 'executed');
  if (!withRoute.length) return [];
  const routes = [...new Set(withRoute.map((m) => m.route))];
  const fromDay = addDays(withRoute.reduce((min, m) => (m.day < min ? m.day : min), lastFinalizedDay()), -windowDays);
  const rows = await snapshotRows(supa, { dim: 'page', fromDay, toDay: lastFinalizedDay(), keys: routes });
  const byRoute = new Map();
  rows.forEach((r) => {
    if (!byRoute.has(r.key)) byRoute.set(r.key, []);
    byRoute.get(r.key).push(r);
  });
  return withRoute.map((m) => ({
    ...m,
    effect: computeEffect(byRoute.get(m.route) || [], { day: m.day, windowDays }),
  }));
}

// Datele complete pentru panoul de rank-tracking din admin (api/seo-rank.js).
async function rankData(supa, { days = 28, dim = 'query', keys = null } = {}) {
  const nDays = [14, 28, 90].includes(Number(days)) ? Number(days) : 28;
  const d = dim === 'page' ? 'page' : 'query';
  const end = lastFinalizedDay();
  const start = addDays(end, -(nDays - 1));
  const prevStart = addDays(start, -nDays);

  const rows = await snapshotRows(supa, { dim: d, fromDay: prevStart, toDay: end });
  const cur = rows.filter((r) => dayStr(r.day) >= start);
  const prev = rows.filter((r) => dayStr(r.day) < start);

  const data = buildRankData(cur, { keys, top: 8 });
  const prevAgg = buildRankData(prev, { keys: [], top: 0 }).aggregates;
  const prevByKey = new Map(prevAgg.map((k) => [k.key, k]));
  const topWithDelta = data.aggregates.slice(0, 25).map((k) => {
    const p = prevByKey.get(k.key);
    return { ...k, prevClicks: p ? p.clicks : null, prevPosition: p ? p.position : null };
  });

  const markers = (await actionMarkers(supa, nDays + 3)).filter((m) => m.day >= start);
  const effects = await measureActionEffects(supa, { sinceDays: 60 }).catch(() => []);
  const totals = data.daily.reduce((s, d2) => ({ clicks: s.clicks + d2.clicks, impressions: s.impressions + d2.impressions }), { clicks: 0, impressions: 0 });
  const prevTotals = prev.reduce((s, r) => ({ clicks: s.clicks + (r.clicks || 0), impressions: s.impressions + (r.impressions || 0) }), { clicks: 0, impressions: 0 });

  return {
    start, end, days: nDays, dim: d,
    daily: data.daily, top: topWithDelta, series: data.series,
    markers, effects, totals, prevTotals,
    snapshotDays: new Set(cur.map((r) => dayStr(r.day))).size,
  };
}

// ─── Raportul LUNAR (seo-cron?action=monthly) ────────────────────────────────
// Luna calendaristică ANTERIOARĂ momentului dat (cronul rulează pe 1 ale lunii).
function monthRange(now = new Date()) {
  const y = now.getUTCFullYear(), m = now.getUTCMonth(); // luna curentă (0-based)
  const start = new Date(Date.UTC(m === 0 ? y - 1 : y, (m + 11) % 12, 1));
  const end = new Date(Date.UTC(y, m, 0)); // ziua 0 a lunii curente = ultima zi a lunii trecute
  const label = start.toLocaleDateString('ro-RO', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return { start: dayStr(start), end: dayStr(end), label };
}

const fmtDelta = (cur, prev) => {
  if (prev == null || !prev) return '';
  const d = ((cur - prev) / prev) * 100;
  return ` (${d >= 0 ? '+' : ''}${d.toFixed(0)}% vs. luna anterioară)`;
};

// Blocul de DATE MĂSURATE pe care îl primește agentul pentru raportul lunar.
// Totul e best-effort: ce lipsește se spune explicit, nu se inventează.
async function monthlyContext(supa, now = new Date()) {
  const { start, end, label } = monthRange(now);
  const prevRange = monthRange(new Date(Date.parse(start + 'T00:00:00Z')));
  const parts = [`=== DATE MĂSURATE PENTRU RAPORTUL LUNAR (${label}: ${start} → ${end}) ===`];

  // 1) GSC din gsc_snapshots: luna raportată vs. luna anterioară
  try {
    const rows = await snapshotRows(supa, { dim: 'query', fromDay: prevRange.start, toDay: end });
    const cur = rows.filter((r) => dayStr(r.day) >= start);
    const prev = rows.filter((r) => dayStr(r.day) < start);
    if (!cur.length) {
      parts.push(`— GSC: NICIO zi în gsc_snapshots pentru ${label}. Rulează backfill: /api/seo-cron?action=snapshot&days=28&secret=AI_CRON_SECRET.`);
    } else {
      const agg = buildRankData(cur, { keys: [], top: 0 });
      const prevData = buildRankData(prev, { keys: [], top: 0 });
      const t = agg.daily.reduce((s, d2) => ({ c: s.c + d2.clicks, i: s.i + d2.impressions }), { c: 0, i: 0 });
      const pt = prevData.daily.reduce((s, d2) => ({ c: s.c + d2.clicks, i: s.i + d2.impressions }), { c: 0, i: 0 });
      parts.push(
        `— TRAFIC ORGANIC (${agg.daily.length} zile cu date): clicuri ${t.c}${fmtDelta(t.c, pt.c)} · impresii ${t.i}${fmtDelta(t.i, pt.i)}` +
        ` · CTR ${t.i ? ((t.c / t.i) * 100).toFixed(1) : 0}%`
      );
      const prevByKey = new Map(prevData.aggregates.map((k) => [k.key, k]));
      const fmtQ = (k) => {
        const p = prevByKey.get(k.key);
        const pos = k.position != null ? `poz. ${k.position}` : 'poz. n/a';
        const posD = p && p.position != null && k.position != null ? ` (era ${p.position})` : '';
        return `„${k.key}" — ${k.clicks} clicuri, ${k.impressions} impresii, ${pos}${posD}`;
      };
      parts.push('— TOP INTEROGĂRI (luna raportată):\n' + agg.aggregates.slice(0, 12).map((k) => '  • ' + fmtQ(k)).join('\n'));
      const movers = agg.aggregates
        .filter((k) => k.position != null && prevByKey.get(k.key)?.position != null && k.impressions >= 10)
        .map((k) => ({ ...k, delta: prevByKey.get(k.key).position - k.position }))
        .sort((a, b) => b.delta - a.delta);
      const up = movers.filter((m) => m.delta >= 1).slice(0, 6);
      const down = movers.filter((m) => m.delta <= -1).sort((a, b) => a.delta - b.delta).slice(0, 6);
      if (up.length) parts.push('— URCĂRI de poziție:\n' + up.map((m) => `  • „${m.key}": ${(m.position + m.delta).toFixed(1)} → ${m.position} (+${m.delta.toFixed(1)})`).join('\n'));
      if (down.length) parts.push('— CĂDERI de poziție:\n' + down.map((m) => `  • „${m.key}": ${(m.position + m.delta).toFixed(1)} → ${m.position} (${m.delta.toFixed(1)})`).join('\n'));
    }
    const pageRows = await snapshotRows(supa, { dim: 'page', fromDay: start, toDay: end });
    const pages = buildRankData(pageRows, { keys: [], top: 0 }).aggregates.slice(0, 10);
    if (pages.length) parts.push('— TOP PAGINI:\n' + pages.map((k) => `  • ${k.key} — ${k.clicks} clicuri, ${k.impressions} impresii${k.position != null ? `, poz. ${k.position}` : ''}`).join('\n'));
  } catch (e) { parts.push(`— GSC (gsc_snapshots) indisponibil: ${e.message}`); }

  // 2) Acțiunile executate în lună + efectul celor măsurabile
  try {
    const { data: acts } = await supa.from('seo_actions')
      .select('id, type, payload, note, status, executed_at')
      .gte('executed_at', start + 'T00:00:00Z').lte('executed_at', end + 'T23:59:59Z')
      .in('status', ['executed', 'reverted'])
      .order('executed_at', { ascending: true }).limit(60);
    const list = acts || [];
    if (!list.length) parts.push('— ACȚIUNI EXECUTATE în lună: niciuna.');
    else {
      parts.push(`— ACȚIUNI EXECUTATE în lună (${list.length}):\n` + list.map((a) => `  • ${dayStr(a.executed_at)} · ${actionSummary(a).label}${a.status === 'reverted' ? ' (ANULATĂ ulterior)' : ''}`).join('\n'));
      const effects = await measureActionEffects(supa, { sinceDays: Math.ceil((Date.now() - Date.parse(start)) / 86400000) + 3 });
      const measured = effects.filter((e) => e.day >= start && e.day <= end && e.effect && !e.effect.pending && (e.effect.before || e.effect.after));
      if (measured.length) {
        parts.push('— EFECTUL MĂSURAT (14 zile înainte vs. după, din gsc_snapshots):\n' + measured.map((e) => {
          const b = e.effect.before, a = e.effect.after;
          const pos = (x) => (x && x.position != null ? x.position : '–');
          const cd = (x) => (x ? x.clicksPerDay : '–');
          return `  • ${e.label} (${e.day}): poziție ${pos(b)} → ${pos(a)} · clicuri/zi ${cd(b)} → ${cd(a)} · impresii/zi ${b ? b.impressionsPerDay : '–'} → ${a ? a.impressionsPerDay : '–'}`;
        }).join('\n'));
      }
    }
  } catch (e) { parts.push(`— Acțiuni: eroare la citire (${e.message})`); }

  // 3) Conținut publicat în lună
  try {
    const { data: arts } = await supa.from('articole')
      .select('slug, title, kind, published_at')
      .gte('published_at', start + 'T00:00:00Z').lte('published_at', end + 'T23:59:59Z')
      .order('published_at', { ascending: true }).limit(30);
    parts.push((arts || []).length
      ? `— ARTICOLE PUBLICATE în lună (${arts.length}):\n` + arts.map((a) => `  • [${a.kind}] „${a.title}" → /rezolvari/${a.slug}`).join('\n')
      : '— ARTICOLE PUBLICATE în lună: niciunul.');
  } catch { /* tabelul poate lipsi */ }

  // 4) Social: postările lunii + metricile lor
  try {
    const { data: posts } = await supa.from('social_posts')
      .select('platform, status, posted_at, metrics, campaign')
      .gte('posted_at', start + 'T00:00:00Z').lte('posted_at', end + 'T23:59:59Z')
      .eq('status', 'posted').limit(120);
    const byPlat = {};
    (posts || []).forEach((p) => {
      const b = byPlat[p.platform] || { n: 0, reach: 0, likes: 0, comments: 0 };
      b.n++; b.reach += p.metrics?.reach || 0; b.likes += p.metrics?.likes || 0; b.comments += p.metrics?.comments || 0;
      byPlat[p.platform] = b;
    });
    parts.push(Object.keys(byPlat).length
      ? '— SOCIAL (postări publicate în lună): ' + Object.entries(byPlat).map(([pl, b]) => `${pl}: ${b.n} postări (reach ${b.reach || '–'}, like ${b.likes}, comentarii ${b.comments})`).join(' · ')
      : '— SOCIAL: nicio postare publicată în lună.');
  } catch { /* tabelul poate lipsi */ }

  // 5) GA4: sesiuni pe canale + campaniile UTM (dacă e conectat)
  if (google.ga4Enabled()) {
    try {
      const dateRanges = [{ startDate: start, endDate: end }];
      const [channels, campaigns] = await Promise.all([
        google.ga4Run({ dateRanges, dimensions: [{ name: 'sessionDefaultChannelGroup' }], metrics: [{ name: 'sessions' }, { name: 'activeUsers' }], limit: 10 }),
        google.ga4Run({ dateRanges, dimensions: [{ name: 'sessionCampaignName' }], metrics: [{ name: 'sessions' }], orderBys: [{ metric: { metricName: 'sessions' }, desc: true }], limit: 12 }),
      ]);
      if (channels?.rows?.length) {
        parts.push('— GA4 CANALE (sesiuni · utilizatori):\n' + channels.rows.map((r) => `  • ${r.dimensionValues[0].value}: ${r.metricValues[0].value} · ${r.metricValues[1].value}`).join('\n'));
      }
      const camps = (campaigns?.rows || []).filter((r) => !/^\(/.test(r.dimensionValues[0].value));
      if (camps.length) parts.push('— GA4 CAMPANII UTM:\n' + camps.map((r) => `  • ${r.dimensionValues[0].value}: ${r.metricValues[0].value} sesiuni`).join('\n'));
    } catch (e) { parts.push(`— GA4 indisponibil: ${e.message}`); }
  } else {
    parts.push('— GA4: neconectat (GA4_PROPERTY_ID lipsește) — conversiile pe canale nu se pot măsura încă.');
  }

  return { label, start, end, text: parts.join('\n\n') };
}

module.exports = {
  SITE, STATIC_ROUTES, TASKS, TOOLS,
  ARTICLE_KINDS, ARTICLE_CATEGORIES,
  siteStructure, contentContext, allRows,
  makeToolExecutor, proposeAction, executeAction, revertAction, editActionPayload,
  checkArticleField, resolveSources,
  runAgent, snapshotGsc,
  // Faza 4b — rank-tracking + raport lunar
  buildRankData, actionSummary, computeEffect, measureActionEffects,
  actionMarkers, rankData, monthRange, monthlyContext, lastFinalizedDay,
};
