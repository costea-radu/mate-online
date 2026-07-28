# 🤖 Ghid: Agentul SEO care ACȚIONEAZĂ — plan complet de implementare

Agentul SEO actual (`api/ai-seo-agent.js` + `src/components/AISEOAgent.jsx`) **analizează
și recomandă**: citește conținutul din Supabase, datele reale din Search Console/GA4
(prin contul de serviciu) și produce texte gata de folosit. Acest ghid descrie cum îl
transformi într-un agent care **execută**: modifică meta-urile paginilor live, redenumește
materialele cu titluri optimizate, publică articole și rezolvări indexabile pe pagina
Rezolvări, postează pe rețelele sociale — totul cu aprobarea ta, dintr-o coadă de acțiuni
în panoul de admin. **Agentul NU are acces la cod** — singura lui cale de modificare a
site-ului este baza de date Supabase.

> **Precondiție:** pasul 5 din `GHID_EMAIL_SI_SEO.md` (contul de serviciu Google +
> `GOOGLE_SERVICE_ACCOUNT_JSON`, `GSC_SITE_URL`, opțional `GA4_PROPERTY_ID` în Vercel).
> Fără el, agentul nu are date reale pe care să-și bazeze acțiunile.

## Ce obții la final

| Capacitate | Cum funcționează |
|---|---|
| **Modifică titluri/meta LIVE** | tabel `seo_meta` + injectare serverless în HTML — schimbarea e live în secunde, fără deploy |
| **Publică articole & rezolvări indexabile** | pagina „Rezolvări" devine Blog/Rezolvări: articole, rezolvări scrise și explicații în Supabase, servite server-side (Google și Facebook văd conținutul complet) |
| **Urcă paginile în Google** | bucla săptămânală: date GSC → propuneri → aprobare → aplicare → măsurarea efectului |
| **Optimizează titlurile materialelor** | unealta de redenumire scrie în tabelele `content`/`rezolvari` (titlurile afișate pe site), cu aprobarea ta |
| **Postează pe Facebook + Instagram** | Meta Graph API + calendar `social_posts` + cron care publică |
| **TikTok / YouTube** | agentul pregătește coada (text, hashtag-uri, script); postezi manual — apoi automatizare prin audit sau agregator |
| **Raportează ce funcționează** | UTM automat pe linkuri + citirea GA4 și a metricilor sociale înapoi în DB |
| **Siguranță** | orice scriere trece prin coada de aprobare `seo_actions`; totul logat și reversibil |

**Ordinea recomandată:** Faza 1 (fundația) → Faza 2 (Blog/Rezolvări) → Faza 3 (social) → Faza 4 (YouTube + măsurare avansată).

---

## Arhitectura pe scurt

```
                    ┌──────────────────────────────────────────────┐
                    │  api/ai-seo-agent.js — buclă agentică (tools) │
                    └──────────────────────────────────────────────┘
   UNELTE DE CITIRE (se execută direct)      UNELTE DE SCRIERE (cer aprobare)
   • gsc_query        (există în google.js)  • set_page_meta      → seo_meta
   • ga4_report       (există în google.js)  • publish_article    → articole (pag. Rezolvări)
   • url_inspect      (Search Console API)   • rename_material    → content / rezolvari
   • psi_report       (PageSpeed Insights)   • submit_sitemap     → GSC API
   • fetch_page       (HTML-ul unei rute)    • schedule_social    → social_posts
   • read_material    (textul unui material) • send_newsletter    (există deja)
   • db_stats         (Supabase)
                                                      │
                                  scrierile intră ca rânduri `proposed` în
                                  ┌──────────────────────────────┐
                                  │  seo_actions (coada de       │
                                  │  aprobare din panoul admin)  │──► Aprobi → se execută
                                  └──────────────────────────────┘──► Respingi → nimic
```

Două principii:

1. **Agentul propune, tu aprobi.** Fiecare unealtă de scriere creează un rând în
   `seo_actions` cu payload-ul complet (diff-ul afișat în admin). Execuția are loc
   doar după click pe „Aprobă". Mai târziu poți activa auto-aprobarea pe tipuri
   de acțiuni „ieftine" (ex. meta), dar postările publice merită ținute manual mai mult.
2. **O singură cale de modificare: baza de date.** Agentul scrie exclusiv în Supabase
   (meta, articole/rezolvări, titluri de materiale, postări) — instant, fără deploy,
   ușor de anulat. **Zero acces la cod**: fără GitHub, fără fișiere, fără deploy.
   Funcțiile serverless din acest ghid le implementezi tu o singură dată, într-o
   sesiune de dezvoltare; după aceea agentul doar completează datele pe care site-ul
   le servește.

---

## FAZA 1 — Fundația: meta dinamice + unelte + coada de aprobare

> **✅ FAZA 1 IMPLEMENTATĂ (28 iulie 2026).** Fișierele: `supabase/seo_agent.sql`
> (tabelele 1a — DE RULAT MANUAL în SQL Editor), `api/page-meta.js` (1b),
> `api/sitemap.js` + `public/robots.txt` (1c), bucla de tool-use în
> `api/_lib/claude.js` + uneltele în `api/_lib/seo.js` (1d — inclusiv
> `rename_material` și scope-ul complet `webmasters` în `google.js`),
> `api/seo-actions.js` + `src/components/SEOActionsQueue.jsx` (1e — coada de
> aprobare, cu revert), `api/seo-cron.js` + cron-urile din `vercel.json` (1f).
> După deploy: rulează SQL-ul, apoi fă backfill-ul istoricului GSC:
> `/api/seo-cron?action=snapshot&days=28&secret=AI_CRON_SECRET`.
> Teste: `test/seo.test.js` (injectarea meta) — `npm test`.

> **✅ Deja implementat (iulie 2026):** structura site-ului din promptul agentului se
> generează acum DINAMIC — vezi `siteStructure()` (mutat în `api/_lib/seo.js`): rute statice
> + paginile pe clasă care au materiale în DB + articolele publicate din tabelul
> `articole` + URL-urile din `sitemap.xml` (ultimele două se activează automat când
> Fazele 1–2 le creează). Agentul nu mai depinde de o listă scrisă de mână.

Cea mai importantă fază. Rezolvă și cea mai mare problemă SEO actuală: site-ul e un
SPA, iar `index.html` are **un singur title/description pentru toate rutele**. Google
mai rulează JavaScript (lent), dar Facebook/WhatsApp — unde părinții distribuie
linkuri — **nu rulează deloc**: orice pagină partajată arată identic.

### 1a. Tabelele în Supabase

Creează `supabase/seo_agent.sql` și rulează-l în SQL Editor (sigur de rulat repetat):

```sql
-- Meta dinamice per rută (servite la fiecare request de api/page-meta)
create table if not exists seo_meta (
  route       text primary key,      -- '/', '/evaluare-nationala', '/rezolvari/arii-clasa-7'
  title       text not null,         -- max ~60 caractere
  description text not null,         -- max ~155 caractere
  og_image    text,                  -- URL imagine pentru share (opțional)
  jsonld      jsonb,                 -- date structurate (opțional)
  updated_at  timestamptz default now(),
  updated_by  text default 'agent'
);

-- Coada de acțiuni a agentului: propus → aprobat → executat
create table if not exists seo_actions (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now(),
  type        text not null,          -- 'set_page_meta' | 'publish_article' | 'rename_material' | 'schedule_social' | 'submit_sitemap'
  payload     jsonb not null,         -- parametrii acțiunii (din el se afișează diff-ul)
  note        text,                   -- explicația agentului: DE CE propune asta
  status      text not null default 'proposed',  -- proposed|approved|rejected|executed|failed
  result      jsonb,                  -- rezultatul execuției (URL PR, id postare etc.)
  decided_at  timestamptz,
  executed_at timestamptz
);

-- Istoric zilnic Search Console — trenduri și măsurarea efectului fiecărei optimizări
create table if not exists gsc_snapshots (
  day         date not null,
  dim         text not null,          -- 'query' | 'page'
  key         text not null,          -- interogarea sau URL-ul
  clicks      int default 0,
  impressions int default 0,
  ctr         numeric,
  position    numeric,
  primary key (day, dim, key)
);

-- RLS: tabelele se administrează DOAR de pe server (service role ocolește RLS)
alter table seo_meta      enable row level security;
alter table seo_actions   enable row level security;
alter table gsc_snapshots enable row level security;

-- seo_meta nu conține nimic sensibil — poate fi citit public (îl folosește și SPA-ul)
drop policy if exists seo_meta_public_read on seo_meta;
create policy seo_meta_public_read on seo_meta for select using (true);
```

### 1b. Injectarea meta în HTML (fără deploy, fără SSR complet)

**Fișier nou: `api/page-meta.js`** — servește `index.html` cu meta corecte per rută:

1. Ia HTML-ul de bază: `fetch(SITE_URL + '/index.html')` (fișierul static rămâne
   accesibil direct), cu cache în memoria funcției.
2. Citește rândul din `seo_meta` pentru ruta cerută (fallback: valorile actuale).
3. Înlocuiește `<title>`, `<meta name="description">`, adaugă `<link rel="canonical">`,
   Open Graph (`og:title`, `og:description`, `og:image`, `og:url`), Twitter Card și
   `<script type="application/ld+json">` din coloana `jsonld`.
4. Răspunde cu `Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`
   (CDN-ul Vercel servește rapid; modificările apar în max. 5 minute).

**În `vercel.json`**, înaintea rewrite-ului catch-all către `index.html`, adaugă
rutele publice (NU și `/admin`, `/profil` etc. — acelea rămân SPA simplu):

```json
{ "source": "/", "destination": "/api/page-meta?route=/" },
{ "source": "/(evaluare-nationala|bacalaureat|manuale|rezolvari|discutii|preturi|faq|despre-noi|contact|clase/.*)", "destination": "/api/page-meta?route=/$1" }
```

**Unealta agentului: `set_page_meta(route, title, description, og_image?, jsonld?)`**
— după aprobare face upsert în `seo_meta`. Modificarea e live în minute, fără deploy.
Asta e diferența dintre „agentul recomandă meta" (azi) și „agentul schimbă meta" (mâine).

### 1c. sitemap.xml, robots.txt și date structurate

- **`api/sitemap.js`** → servit ca `/sitemap.xml` (rewrite): rutele statice + paginile
  pe clase + (din Faza 2) articolele publicate din `articole` (rutele `/rezolvari/{slug}`). Generat din DB, mereu actual.
- **`public/robots.txt`**: `Sitemap: https://examenmate.com/sitemap.xml` + `Disallow: /admin`.
- **JSON-LD de pornire** (pus de agent prin `set_page_meta`): `Organization` + `WebSite`
  pe `/`, `FAQPage` pe `/faq` (întrebările există deja în pagină), `Course` /
  `LearningResource` pe paginile de materiale, `BreadcrumbList` unde există ierarhie.

> **Notă:** ping-ul clasic de sitemap a fost retras de Google; trimiterea se face prin
> Search Console API (`sitemaps.submit`), iar Indexing API e rezervat oficial paginilor
> de tip job/eveniment live. Deci: sitemap corect + conținut bun + răbdare.

### 1d. Bucla agentică (tool use) în `api/_lib/claude.js`

Extinde wrapperul cu suport de **tools** (function calling — există și la Anthropic,
și la API-urile compatibile OpenAI):

1. `chatClaude({ system, messages, tools, maxTokens })` trimite și definițiile uneltelor.
2. Cât timp modelul cere o unealtă (`stop_reason: 'tool_use'`): execută funcția,
   adaugă rezultatul în conversație, continuă. Limitează la ~8 iterații.
3. În `ai-seo-agent.js`: uneltele de **citire** se execută pe loc; cele de **scriere**
   inserează în `seo_actions` cu status `proposed` și îi răspund modelului
   „propunerea a fost trimisă spre aprobare" (agentul își încheie raportul menționând
   ce a propus).

Unelte noi de citire, pe lângă `gscQuery`/`ga4Run` existente:

| Unealtă | Sursă | Ce află agentul |
|---|---|---|
| `url_inspect(url)` | Search Console API (URL Inspection) | dacă/cum e indexată o pagină, probleme de crawling |
| `psi_report(url)` | PageSpeed Insights API (`PAGESPEED_API_KEY`, gratuit) | Core Web Vitals, recomandări de viteză |
| `fetch_page(route)` | fetch pe site-ul propriu | HTML-ul real servit (verifică ce văd crawlerele) |
| `db_stats()` | Supabase | materiale pe categorii, ce s-a adăugat recent |
| `read_material(id)` | Supabase + extractorul PDF existent (`_lib/pdftext.js`) | textul real al unui material — baza rezolvărilor scrise din Faza 2 |

Și prima unealtă de **scriere** (tot prin coada de aprobare):
**`rename_material(tabel, id, titlu_nou, descriere_nouă?)`** — actualizează titlul și
descrierea unui material în `content` sau `rezolvari`. Titlurile materialelor sunt
textele vizibile (și indexabile) de pe paginile pe clase/examene/rezolvări, deci parte
din SEO-ul on-page; payload-ul acțiunii păstrează valoarea veche, ca orice redenumire
să fie reversibilă cu un click.

> **Atenție la scope:** `google.js` folosește acum `webmasters.readonly`. Pentru
> `sitemaps.submit` e nevoie de scope-ul complet `https://www.googleapis.com/auth/webmasters`
> — schimbă constanta (contul de serviciu are deja permisiune „Full" în Search Console).

### 1e. Coada de aprobare în panoul admin

În `AISEOAgent.jsx` (sau componentă nouă `SEOActionsQueue.jsx`):

- Lista acțiunilor `proposed`: tip, explicația agentului (`note`), **diff-ul**
  (pentru meta și redenumiri: vechi → nou; pentru articole: preview complet).
- Butoane **✅ Aprobă & execută** / **❌ Respinge**; istoric cu status și rezultat.
- Endpoint nou `api/seo-actions.js` (admin-only, refolosește `ai.requireAdmin`):
  `list`, `approve` (execută + scrie `result`), `reject`.

### 1f. Cron-uri noi (în `vercel.json`)

| Cron | Frecvență | Ce face |
|---|---|---|
| `/api/seo-cron?action=snapshot` | zilnic (ex. `0 5 * * *`) | salvează în `gsc_snapshots` ziua „finalizată" (acum 3 zile — GSC are ~2 zile întârziere): top interogări + pagini |
| `/api/seo-cron?action=autorun` | săptămânal (ex. luni `0 6 * * 1`) | rulează agentul pe sarcina `performance` + generarea de propuneri; trimite digest pe email adminului (mailer-ul există) cu ce așteaptă aprobare |

**Rezultatul Fazei 1:** agentul vede trenduri reale, propune modificări concrete,
tu aprobi cu un click, schimbarea e live — și peste 2–4 săptămâni agentul îți arată,
cu cifre din `gsc_snapshots`, dacă a funcționat.

---

## FAZA 2 — Pagina „Rezolvări" devine Blog / Rezolvări (motorul de conținut)

> **✅ FAZA 2 IMPLEMENTATĂ (28 iulie 2026).** Fișierele: `supabase/articole.sql`
> (tabelul 2a — DE RULAT MANUAL în SQL Editor), `api/_lib/markdown.js` (Markdown→HTML
> „escape-first", fără dependențe: zero HTML brut ⇒ zero XSS, formulele LaTeX rămân
> text pentru KaTeX), `api/page-meta.js` extins (2b — `/rezolvari/{slug}` servit cu
> meta din articol + JSON-LD `Article` + og:type article + **conținutul complet în
> `#root`**, plus datele în `<script id="__ARTICOL__">` ca React să nu refacă
> cererea la hidratare; slug inexistent → **404 + noindex**), `src/pages/ArticolPage.jsx`
> + ruta `/rezolvari/:slug` în `App.jsx`, carduri de articol + filtrele „📖 Articol /
> ✍️ Rezolvare scrisă / 💡 Explicație" în `RezolvariPage.jsx`; (2c) uneltele agentului:
> `list_articles`, `read_article` (citire) + `publish_article`, `update_article`
> (scriere, prin coada de aprobare; HTML-ul e generat la propunere — aprobi exact ce
> se publică; la aprobare sitemap-ul se retrimite automat către GSC; revert =
> articolul revine în draft / valorile vechi), preview complet + revert în
> `SEOActionsQueue.jsx`, stiluri `.articol-*` în `global.css` (folosite și de SSR,
> și de pagina React). Rewrite-ul din `vercel.json`, articolele din `sitemap.xml`
> și din `siteStructure()` existau din Faza 1 — se activează singure.
> **După deploy: rulează `supabase/articole.sql` în SQL Editor — atât.**
> Teste: `test/articole.test.js` (markdown, XSS, LaTeX, shell articol, 404) — `npm test`.

**Nu se creează o pagină nouă de blog.** Pagina existentă `/rezolvari` (care listează
acum materiale video/PDF/imagine din tabelul `rezolvari`) se extinde cu **conținut
scris indexabil** — articole, rezolvări pas cu pas și explicații — fiecare cu URL
propriu `/rezolvari/{slug}`. Long-tail-ul („formule arii clasa a 7-a", „subiecte
evaluare națională 2027 rezolvate") se câștigă cu astfel de pagini dedicate, nu cu
homepage-ul.

### 2a. Tabelul articolelor

```sql
create table if not exists articole (
  slug         text primary key,     -- URL: /rezolvari/{slug}
  title        text not null,
  description  text,                 -- meta description + textul cardului din listă
  category     text,                 -- aceleași valori ca filtrele paginii (clasa-5 … bacalaureat)
  kind         text not null default 'articol',  -- 'articol' | 'rezolvare' | 'explicatie'
  content_md   text not null,        -- sursa scrisă de agent (markdown)
  content_html text,                 -- HTML generat la publicare
  keywords     text[],
  sources      jsonb,                -- id-urile materialelor din site pe care se bazează
  status       text not null default 'draft',   -- draft | published
  published_at timestamptz,
  updated_at   timestamptz default now()
);
alter table articole enable row level security;
drop policy if exists articole_public_read on articole;
create policy articole_public_read on articole for select using (status = 'published');
```

### 2b. Schimbările în site (le implementezi o singură dată, în sesiune de dezvoltare)

- **`RezolvariPage.jsx`**: încarcă și articolele publicate, ca noi carduri lângă cele
  existente — filtrul „Toate tipurile" primește opțiunile „📖 Articol", „✍️ Rezolvare
  scrisă", „💡 Explicație"; căutarea și filtrul pe categorie funcționează neschimbate.
  Cardul de articol duce la `/rezolvari/{slug}`.
- **Rută nouă în `App.jsx`**: `/rezolvari/:slug` → `ArticolPage.jsx` — conținutul HTML
  randat (cu KaTeX pentru formule, biblioteca există deja), breadcrumb, CTA-uri către
  materialele premium înrudite.
- **`api/page-meta.js` se extinde**: pentru `/rezolvari/:slug` injectează meta + JSON-LD
  `Article` + **conținutul complet al articolului în `#root`** — crawlerele și
  share-urile văd articolul întreg fără JavaScript; React preia pagina la hidratare.
- Rewrite nou în `vercel.json`: `/rezolvari/:slug` → page-meta; articolele publicate
  intră automat în `sitemap.xml`.
- **Articolele sunt gratuite** — ele aduc traficul din Google. Conversia vine din
  CTA-urile din interior către materialele premium pe aceeași temă (PDF-ul complet,
  varianta video, exercițiile interactive).

### 2c. Uneltele agentului

- `publish_article(slug, kind, title, description, category, content_md, keywords, sources)`
  → coada de aprobare cu preview complet; la aprobare: HTML generat, `status='published'`,
  sitemap retrimis către Search Console.
- `update_article(slug, …)` — refresh pe articolele care stagnează în poziții
  (detectat din `gsc_snapshots`).
- `read_material(id)` (din Faza 1) — textul real al materialelor: rezolvările și
  explicațiile se bazează pe conținutul existent al site-ului, nu pe improvizații.

### 2d. Cele trei tipuri de conținut

1. **Rezolvări scrise pas cu pas** (`kind='rezolvare'`): pornind de la materialele
   existente în site (PDF-uri, video-uri, exerciții — citite cu `read_material`),
   agentul redactează rezolvarea detaliată a problemelor reprezentative — exact ce
   caută elevii pe Google — cu link către materialul complet premium din `sources`.
2. **Explicații de noțiuni** (`kind='explicatie'`): „Toate formulele de arii, cu
   exemple", „Teorema lui Pitagora explicată simplu" — bazate pe lecțiile și
   exercițiile existente, cu linkuri interne către exercițiile interactive.
3. **Articole SEO** (`kind='articol'`): interogările din GSC fără pagină dedicată
   (cerere dovedită — prioritatea #1) + ghidurile pentru părinți („cum îți ajuți
   copilul la EN", „calendar examene") + calendarul sezonier, publicat cu 2–3 luni
   înainte (Google are nevoie de timp să ranking-uiască):

| Perioadă | Eveniment | Conținut pregătit din timp |
|---|---|---|
| septembrie | început de an școlar | ghiduri „materia clasei a V-a…a XII-a", planuri de recuperare |
| decembrie–ianuarie | încheierea mediilor | recapitulări pe capitole, teste de verificare |
| februarie–martie | **simulări EN & BAC** | subiecte anterioare rezolvate; **rezolvarea simulării în ziua ei** |
| aprilie–mai | sprintul final | planuri pe 8/4 săptămâni, formule esențiale, greșeli frecvente |
| iunie–iulie | **EN + BAC** | subiecte & bareme comentate **în ziua examenului** — vârful anual de trafic |
| august | sesiunea a II-a, corigențe | pregătire intensivă |

> **Cu măsură:** fiecare pagină publicată trebuie să aibă substanță reală (explicație +
> exemple + linkuri interne). Zeci de pagini subțiri generate în serie („thin content")
> fac mai mult rău decât bine în Google.

---

## FAZA 3 — Social media: Facebook + Instagram automat, TikTok/YouTube semi-automat

### Ce permite fiecare platformă (situația reală)

| Platformă | Postare prin API | Condiții |
|---|---|---|
| **Facebook Page** | ✅ direct și gratuit | aplicație Meta proprie; pentru pagina TA, ca admin, merge în dev mode, **fără App Review** |
| **Instagram** | ✅ direct și gratuit | cont Business/Creator legat de pagina FB; **obligatoriu imagine sau video** (nu există postare doar-text) |
| **Grupuri Facebook** | ❌ | Meta a retras API-ul de grupuri — doar manual (dar grupurile de părinți rămân canal-cheie!) |
| **TikTok** | ⚠️ doar după audit | Content Posting API cere aplicație aprobată de TikTok; până atunci doar draft/privat |
| **YouTube** | ⚠️ upload merge, dar… | clipurile urcate de aplicații ne-auditate rămân **forțat private** până treci auditul YouTube; **poți însă edita liber titlurile/descrierile clipurilor existente** |

**Strategia pragmatică:** automatizezi complet FB + IG acum; pentru TikTok/YouTube
agentul umple o coadă din care postezi manual (5 min/zi); automatizarea completă vine
în Faza 4 (audit oficial sau agregator de tip Ayrshare / Post Bridge, contra cost).

### 3a. Configurarea Meta (o singură dată, ~30 min)

1. **developers.facebook.com** → Create App (tip Business) — poate rămâne în modul Development.
2. În **Graph API Explorer**: selectează aplicația → User Token cu permisiunile
   `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`, `instagram_basic`,
   `instagram_content_publish` → schimbă-l în token long-lived (endpoint
   `oauth/access_token?grant_type=fb_exchange_token`) → `GET /me/accounts` → copiază
   **Page Access Token** (long-lived, practic nu expiră) și **Page ID**.
3. Contul de Instagram: trecut pe **Business/Creator** și legat de pagina FB (din
   aplicația Instagram sau Meta Business Suite). Apoi
   `GET /{PAGE_ID}?fields=instagram_business_account` → **IG User ID**.
4. În Vercel: `META_PAGE_ID`, `META_PAGE_TOKEN`, `META_IG_USER_ID`.

Publicarea (în `api/_lib/social.js`, fetch simplu, fără dependențe — ca `google.js`):

- **FB text/link:** `POST /{PAGE_ID}/feed` cu `message`, `link`.
- **FB foto:** `POST /{PAGE_ID}/photos` cu `url`, `caption`.
- **IG:** `POST /{IG_USER_ID}/media` (`image_url`, `caption`) → `POST /{IG_USER_ID}/media_publish`
  (`creation_id`). Pentru Reels: `media_type=REELS` + `video_url`.
- **Metrici înapoi:** `GET /{post_id}/insights` (FB) și `GET /{media_id}/insights` (IG)
  → salvate în `social_posts.metrics`.

### 3b. Calendarul și publicarea

```sql
create table if not exists social_posts (
  id           uuid primary key default gen_random_uuid(),
  platform     text not null,         -- 'facebook' | 'instagram' | 'tiktok' | 'youtube'
  text_content text not null,         -- textul postării (cu hashtag-uri)
  media_url    text,                  -- obligatoriu la Instagram
  link_url     text,                  -- primește UTM automat la publicare
  scheduled_at timestamptz,
  status       text not null default 'draft',  -- draft|approved|posted|failed|manual
  external_id  text,                  -- id-ul postării după publicare
  metrics      jsonb,
  created_at   timestamptz default now()
);
alter table social_posts enable row level security;
```

- Unealta agentului: `schedule_social(platform, text, media?, link?, when)` → coada de
  aprobare → la aprobare `status='approved'`.
- **Cron `/api/social-cron` la 15 min**: publică postările `approved` scadente pe FB/IG;
  cele de TikTok/YouTube trec pe `manual` și apar în admin ca listă „de postat azi"
  (copy-paste + media descărcabilă). O dată pe zi citește metricile postărilor recente.
- **UTM automat** pe orice `link_url`: `utm_source={platform}&utm_medium=social&utm_campaign={slug}`
  — așa vezi în GA4 (agentul are deja `ga4Run`) ce canal aduce **conturi create**, nu doar vizite.

### 3c. Generatorul de imagini branded (rezolvă cerința de media pentru IG)

**`api/social-image.js`** — funcție care randează carduri PNG din șabloane cu culorile
ExamenMate (pe Vercel: `@vercel/og` pe runtime Edge, sau `satori` + `resvg` pe Node):

- „📐 Formula zilei" (formula + mini-exemplu), „⏳ X zile până la Evaluarea Națională",
  „🧠 Exercițiul zilei" (+ rezolvarea în comentarii — engagement), „✅ Greșeala frecventă".
- Agentul alege șablonul + textul; URL-ul generat devine `media_url` pentru IG/FB.

### 3d. Ce postează, pentru cine (playbook)

| Public | Canal | Conținut de la agent | Frecvență |
|---|---|---|---|
| Elevi (10–19) | TikTok / Reels / Shorts | exercițiul zilei, greșeli frecvente, „rezolvă în 60 sec", countdown examene | 3–5/săpt. |
| Părinți | pagina FB (+ grupuri, manual) | ghiduri, calendarul examenelor, sfaturi, articolele noi din Rezolvări | 2–3/săpt. |
| Profesori | email (mailer există) + FB | materiale demo, funcțiile pentru clasă, invitații de parteneriat | campanii punctuale |
| Toți | YouTube | rezolvări video cu titluri/descrieri/capitole optimizate de agent | la fiecare video |

Grupurile de Facebook ale părinților („Evaluarea Națională 2027", „Bacalaureat", grupuri
de clasă/școală) sunt cel mai puternic canal gratuit către părinți — postare doar manuală,
dar agentul îți scrie textele adaptate fiecărui grup (fără ton de reclamă, cu valoare reală).

---

## FAZA 4 — YouTube și măsurare avansată

> **Reamintire:** agentul nu modifică niciodată codul. Când auditurile lui găsesc
> probleme tehnice (viteză, structură, atribute lipsă), le raportează cu instrucțiuni
> precise, iar tu le implementezi separat, într-o sesiune de dezvoltare.

### 4a. YouTube

- **Chiar înainte de audit:** unealta `yt_update_video(id, title, description, tags)`
  (scope `youtube` prin OAuth cu refresh token) — agentul optimizează metadatele
  clipurilor EXISTENTE pe baza interogărilor din GSC. Câștig imediat, fără restricții.
- **Upload automat:** cere auditul YouTube (altfel clipurile rămân private) — sau rămâi
  pe fluxul semi-automat: agentul pregătește titlul/descrierea/capitolele, tu urci din
  YouTube Studio.

### 4b. Rank-tracking și raportare

- Grafice în admin din `gsc_snapshots`: evoluția pozițiilor pe interogările-țintă,
  marcată cu momentele acțiunilor executate (`seo_actions.executed_at`) — vezi negru
  pe alb efectul fiecărei optimizări.
- Raport lunar generat de agent (are toate datele): trafic, poziții, conversii pe canale
  (UTM), acțiuni executate și efectul lor, planul lunii următoare — trimis pe email.

---

## Bucla de optimizare săptămânală (așa „urcă" paginile în Google)

1. **Snapshot** zilnic GSC → `gsc_snapshots` (trenduri, nu fotografie statică).
2. **Analiză** (cron săptămânal): interogări pe **pozițiile 5–20 cu impresii mari** =
   candidatele de top 3 (rescriere meta + întărirea conținutului + linkuri interne);
   pagini cu **impresii mari și CTR mic** = titluri/descrieri noi (meta sau redenumirea
   materialelor); **interogări fără pagină dedicată** = articol/rezolvare nouă în
   Rezolvări; pagini care **pierd poziții** = refresh de conținut.
3. **Propuneri** în coada de aprobare + digest pe email.
4. **Aprobare** cu un click → execuție automată (meta live, articol publicat, sitemap retrimis).
5. **Măsurare** după 2–4 săptămâni pe aceleași interogări → agentul raportează efectul
   și își ajustează strategia. Bucla asta închisă, pe date reale, e avantajul față de
   orice consultanță punctuală.

Completări off-site (agentul scrie, tu trimiți): pitch-uri către presa educațională
(ex. edupedu.ro), parteneriate cu școli și profesori (un profesor convins aduce clase
întregi — funcțiile de profesor din platformă sunt cârligul), prezență în comunitățile
de resurse didactice, schimb de mențiuni cu creatori educaționali.

---

## Variabilele de mediu — tabel centralizator

| Variabilă | Faza | Descriere |
|---|---|---|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | există | contul de serviciu (GSC + GA4) |
| `GSC_SITE_URL` | există | proprietatea din Search Console |
| `GA4_PROPERTY_ID` | există (opț.) | proprietatea GA4 |
| `PAGESPEED_API_KEY` | 1 (opț.) | cheie API PageSpeed Insights (gratuită, din Google Cloud) |
| `META_PAGE_ID` / `META_PAGE_TOKEN` | 3 | pagina Facebook + token long-lived |
| `META_IG_USER_ID` | 3 | contul Instagram Business |
| `YT_CLIENT_ID` / `YT_CLIENT_SECRET` / `YT_REFRESH_TOKEN` | 4 | OAuth YouTube (metadate; upload după audit) |

---

## Siguranță (de citit înainte de a da drumul la scriere)

1. **Aprobare implicită pentru orice scriere.** Auto-aprobarea se activează târziu,
   selectiv (ex. doar `set_page_meta`), niciodată pentru postările publice la început.
2. **Prompt injection:** un agent care citește conținut extern (pagini web, rezultate,
   comentarii) poate primi instrucțiuni ascunse în acel conținut. Tocmai de-asta uneltele
   de scriere nu execută direct — omul în buclă e plasa de siguranță, nu un „nice to have".
3. **Chei minime:** service role doar pe server (deja e așa), tokenurile Meta doar în
   Vercel env (niciodată în cod/git). Agentul nu primește nicio cheie de GitHub sau de
   deploy — codul rămâne exclusiv în mâinile tale.
4. **Jurnal complet:** `seo_actions` păstrează cine/ce/când/cu ce rezultat — plus
   `ai.logUsage` existent pentru costuri. Orice acțiune e reversibilă (meta: valoarea
   veche e în istoricul acțiunii; articole: `status='draft'`; PR: revert).
5. **Limite:** păstrează `maxTokens` și numărul de iterații de tool-use plafonate;
   cron-urile au deja `AI_CRON_SECRET` ca model de protecție.

---

## Estimare de efort și ordinea lucrului

| Faza | Livrabile | Efort estimat |
|---|---|---|
| **1. Fundația** | SQL + `page-meta` + sitemap/robots + tool use + unealta de redenumire + coada de aprobare + 2 cron-uri | 1–2 zile de lucru cu AI |
| **2. Blog/Rezolvări** | tabel `articole` + extinderea paginii Rezolvări + ruta `/rezolvari/:slug` servită SSR + unelte de publicare | ~1 zi |
| **3. Social** | setup Meta (30 min, manual) + `social.js` + calendar + cron + generator imagini | 1–2 zile |
| **4. YouTube & măsurare** | metadate YouTube prin API + grafice rank-tracking + raport lunar | ~1 zi |

Fiecare fază e valoroasă singură și se poate lansa independent. Când vrei să pornim,
deschide o sesiune pe folderul `mate-online` și cere: **„implementează Faza 1 din
GHID_AGENT_SEO_ACTIUNI.md"**.

---

## Update (28 iulie 2026): selector de model AI + tema articolelor de blog

Două îmbunătățiri în agentul SEO din admin:

1. **Selector de model AI (Sonnet/Opus, inclusiv Opus 5).** Deasupra sarcinilor
   rapide există acum butoane de model: **Sonnet 5** (implicit — rapid și echilibrat),
   **Opus 5** (cel mai capabil, recomandat pentru articole și analize complexe;
   mai lent și mai scump), plus generația anterioară (Sonnet 4.6, Opus 4.8).
   - Alegerea se trimite per cerere (`model` în body-ul către `api/ai-seo-agent.js`)
     și e validată pe server: lista permisă e `MODELS` din `api/_lib/claude.js`
     (oglindită în `src/components/AISEOAgent.jsx` — ține-le sincron). Un ID
     necunoscut cade pe implicitul `CLAUDE_MODEL`/`claude-sonnet-5`.
   - Rularea săptămânală automată (`api/seo-cron.js?action=autorun`) folosește în
     continuare modelul implicit din env (`CLAUDE_MODEL`).
   - Răspunsul afișează modelul folosit („model: claude-opus-5") în antetul agentului.

2. **„Articole Blog" cu temă aleasă de admin.** Click pe sarcina „📝 Articole
   Blog/Rezolvări" deschide un panou în care scrii TEMA articolului (ex. „Formule
   de arii și perimetre — clasa a 7-a"); agentul se documentează (list_articles,
   read_material, gsc_query) și trimite articolul complet prin `publish_article`
   în coada de aprobare. Butonul „🎲 Lasă agentul să aleagă tema" păstrează
   comportamentul vechi (tema se alege din datele Google / golurile de conținut).
