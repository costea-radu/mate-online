// =====================================================================
// api/ai-seo-agent.js — AGENTUL CLAUDE de SEO & marketing (admin).
// Primește o sarcină (preset sau întrebare liberă) + context real din site
// (categorii, număr de materiale, titluri recente) și răspunde cu
// recomandări/conținut gata de folosit.
//
// NOU: dacă e configurat contul de serviciu Google (GOOGLE_SERVICE_ACCOUNT_JSON
// + GSC_SITE_URL, opțional GA4_PROPERTY_ID), agentul primește și DATE REALE
// din Search Console (clicuri, impresii, poziții, interogări) și GA4 (trafic).
// Contul folosit în consolele Google: admin.examenmate@gmail.com.
//
// NOU (2): structura site-ului din prompt NU mai e o listă scrisă de mână —
// se generează DINAMIC la fiecare cerere: rute statice (din App.jsx) +
// paginile pe clasă care au materiale în DB + articolele publicate în
// tabelul `articole` (Faza 2 din GHID_AGENT_SEO_ACTIUNI.md) + URL-urile din
// sitemap.xml (Faza 1), imediat ce acestea vor exista. Agentul vede mereu
// structura reală și actuală a site-ului, fără modificări de cod.
//
// Body: { userId, task, input?, history? }
//   task: 'audit'|'meta'|'blog'|'social'|'keywords'|'performance'|'chat'
// =====================================================================
const ai = require('./_lib/ai');
const claude = require('./_lib/claude');
const google = require('./_lib/google');

const SITE = 'https://examenmate.com';

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
    // Atenție: fiind SPA cu rewrite catch-all, /sitemap.xml poate răspunde 200 cu
    // index.html dacă sitemapul nu există încă — acceptăm doar XML real de sitemap.
    if (xml.includes('<urlset') || xml.includes('<sitemapindex')) {
      const urls = [...xml.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)]
        .map((m) => m[1].trim().replace(/^https?:\/\/[^/]+/, '') || '/');
      if (urls.length) out = urls.slice(0, 60);
    }
  } catch { /* sitemapul apare în Faza 1 — până atunci mergem pe DB */ }
  _sitemapCache = { urls: out, exp: Date.now() + 10 * 60_000 };
  return out;
}

async function siteStructure(supa, byCat) {
  const lines = [...STATIC_ROUTES];

  // Paginile pe clasă — doar clasele care au efectiv materiale în DB.
  Object.keys(byCat || {})
    .map((c) => (/^clasa-(\d+)$/.exec(c) || [])[1])
    .filter(Boolean)
    .sort((a, b) => Number(a) - Number(b))
    .forEach((n) => lines.push(`/clase/${n} (clasa a ${n}-a — ${byCat[`clasa-${n}`]} materiale)`));

  // Câte rezolvări (video/PDF/imagine) există în tabelul dedicat.
  try {
    const { count } = await supa.from('rezolvari').select('id', { count: 'exact', head: true });
    if (count) lines.push(`(pe /rezolvari: ${count} materiale video/PDF/imagine)`);
  } catch { /* tabel indisponibil — ignorăm */ }

  // Articolele publicate de agent — tabelul `articole` apare în Faza 2.
  try {
    const { data: arts } = await supa
      .from('articole')
      .select('slug, title, kind')
      .eq('status', 'published')
      .order('published_at', { ascending: false })
      .limit(30);
    (arts || []).forEach((a) => lines.push(`/rezolvari/${a.slug} — [${a.kind}] ${a.title}`));
  } catch { /* tabelul nu există încă — normal înainte de Faza 2 */ }

  // Sitemap-ul live — sursa de adevăr completă, imediat ce există (Faza 1).
  const sm = await sitemapUrls();
  if (sm) {
    const known = new Set(lines.map((l) => l.split(' ')[0]));
    const extra = sm.filter((u) => !known.has(u));
    if (extra.length) lines.push('— în plus, din sitemap.xml:', ...extra.map((u) => `  ${u}`));
  }

  return lines.join('\n');
}

const TASKS = {
  audit: 'Fă un AUDIT SEO on-page al site-ului pe baza contextului. Identifică problemele probabile (titluri, meta, structură, conținut subțire, interlinking, viteze) și dă o listă de acțiuni concrete, prioritizate (impact/efort). Dacă adminul a lipit conținutul unei pagini, auditeaz-o în detaliu.',
  meta: 'Scrie META TITLE (max 60 caractere) și META DESCRIPTION (max 155 caractere) în română, optimizate pentru CTR, pentru fiecare pagină/categorie din context (sau pentru pagina lipită de admin). Format: URL → title → description.',
  blog: 'Propune 10 idei de ARTICOLE DE BLOG cu potențial SEO (cuvinte cheie căutate de elevi/părinți: evaluare națională, bacalaureat, formule etc.). Pentru fiecare: titlu, cuvânt-cheie principal, intenția de căutare, schiță H2-uri. Dacă adminul cere un articol anume, scrie-l complet.',
  social: 'Creează conținut SOCIAL MEDIA pentru platfomă: 5 postări Facebook/Instagram (text + idee vizual) și 3 idei TikTok/Reels pentru elevi. Ton prietenos, românesc, orientat pe examene.',
  keywords: 'Fă o listă de CUVINTE CHEIE (română) pe care ExamenMate ar trebui să le țintească, grupate pe intenție (informațional/tranzacțional) și pe pagini-țintă existente. Include long-tail specifice claselor 5–12, EN și BAC.',
  performance: 'Analizează PERFORMANȚA REALĂ din datele Google (Search Console și, dacă există, GA4) din context: tendința clicurilor/impresiilor față de perioada anterioară, interogările și paginile câștigătoare, OPORTUNITĂȚILE (poziții 5–20 cu impresii mari — ce pagini de optimizat ca să urce în top 3), paginile cu impresii mari și CTR mic (de rescris meta). Încheie cu un plan de acțiune concret pe 2 săptămâni, prioritizat. Dacă datele Google lipsesc din context, spune exact asta și recomandă conectarea lor.',
  chat: 'Răspunde la întrebarea adminului ca expert SEO & marketing pentru platforma de educație.',
};

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  const supa = ai.admin();
  try {
    const userId = await ai.authUser(req, supa);
    await ai.requireAdmin(supa, userId);

    const { task = 'chat', input = '', history = [] } = req.body || {};
    const instr = TASKS[task] || TASKS.chat;

    // Context real din site: materiale pe categorii + titluri recente
    let contentCtx = '';
    let byCat = {};
    try {
      const { data: rows } = await supa
        .from('content')
        .select('title, category, content_type, is_free, created_at')
        .order('created_at', { ascending: false })
        .limit(400);
      (rows || []).forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + 1; });
      const recent = (rows || []).slice(0, 25).map((r) => `- [${r.category}/${r.content_type}${r.is_free ? '/gratuit' : ''}] ${r.title}`).join('\n');
      contentCtx = `Materiale pe categorii: ${JSON.stringify(byCat)}\nCele mai recente titluri:\n${recent}`;
    } catch { contentCtx = '(nu am putut citi conținutul)'; }

    // Structura REALĂ a site-ului — generată dinamic din DB (+ sitemap când există)
    let routesCtx = '';
    try { routesCtx = await siteStructure(supa, byCat); }
    catch { routesCtx = STATIC_ROUTES.join('\n'); }

    // Date REALE din Google (Search Console + GA4) — dacă sunt conectate
    let googleCtx = '';
    try {
      if (google.enabled()) {
        const block = await google.contextBlock();
        if (block) googleCtx = `\n\n=== DATE REALE GOOGLE (cont: admin.examenmate@gmail.com) ===\n${block}`;
      } else {
        googleCtx = '\n\n=== DATE GOOGLE === (neconectate încă — vezi GHID_EMAIL_SI_SEO.md pentru Search Console/GA4)';
      }
    } catch (e) { googleCtx = `\n\n=== DATE GOOGLE === (eroare la citire: ${e.message})`; }

    const system = `Ești agentul SEO & MARKETING al platformei ExamenMate (${SITE}) — platformă românească de matematică pentru clasele 5–12, Evaluarea Națională și Bacalaureat, cu abonament premium, exerciții interactive, rezolvări video/PDF și Profesor Virtual AI.

Public țintă: elevi 10–19 ani, părinți, profesori (România). Concurență: siteuri de meditații, culegeri online, canale YouTube.

=== STRUCTURA SITE-ULUI (SPA React — generată dinamic din DB și sitemap) ===
${routesCtx}

=== CONȚINUT ACTUAL ===
${contentCtx}${googleCtx}

Reguli: răspunzi în română, concret și acționabil, fără generalități. Când scrii conținut (meta, articole, postări), e gata de copiat. Când ai date reale Google în context, ancorează recomandările în cifre (interogări, poziții, CTR), nu în presupuneri. Ține cont că site-ul e SPA client-side (recomandările tehnice SEO să menționeze prerender/SSR/meta dinamice unde e relevant.)

SARCINA CURENTĂ: ${instr}`;

    const messages = [
      ...(Array.isArray(history) ? history.slice(-8).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '').slice(0, 4000) })) : []),
      { role: 'user', content: input ? String(input).slice(0, 12000) : 'Execută sarcina pe baza contextului site-ului.' },
    ];

    const { text, usage, provider } = await claude.chatClaude({ system, messages, temperature: 0.6, maxTokens: 3000 });
    await ai.logUsage(supa, userId, 'ai-seo-agent', usage);

    return res.status(200).json({ text, provider, googleConnected: google.enabled() });
  } catch (err) {
    console.error('ai-seo-agent error:', err);
    return res.status(err.status || 500).json({ error: err.message || 'Eroare server', code: err.code || null });
  }
};
