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
// Body: { userId, task, input?, history? }
//   task: 'audit'|'meta'|'blog'|'social'|'keywords'|'performance'|'chat'
// =====================================================================
const ai = require('./_lib/ai');
const claude = require('./_lib/claude');
const google = require('./_lib/google');

const SITE = 'https://examenmate.com';
const ROUTES = [
  '/', '/clase/5..8 (pagini pe clasă)', '/evaluare-nationala', '/bacalaureat',
  '/manuale', '/rezolvari', '/discutii', '/profesor-virtual (tutor AI)',
  '/tema (rezolvare temă AI)', '/preturi', '/faq', '/despre-noi', '/contact',
];

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
    try {
      const { data: rows } = await supa
        .from('content')
        .select('title, category, content_type, is_free, created_at')
        .order('created_at', { ascending: false })
        .limit(400);
      const byCat = {};
      (rows || []).forEach((r) => { byCat[r.category] = (byCat[r.category] || 0) + 1; });
      const recent = (rows || []).slice(0, 25).map((r) => `- [${r.category}/${r.content_type}${r.is_free ? '/gratuit' : ''}] ${r.title}`).join('\n');
      contentCtx = `Materiale pe categorii: ${JSON.stringify(byCat)}\nCele mai recente titluri:\n${recent}`;
    } catch { contentCtx = '(nu am putut citi conținutul)'; }

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

=== STRUCTURA SITE-ULUI (SPA React) ===
${ROUTES.join('\n')}

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
