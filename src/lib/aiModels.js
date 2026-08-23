// =====================================================================
// src/lib/aiModels.js — modelele Claude dintre care poate alege adminul
// în agenți (SEO, generator de exerciții, task-uri programate).
// OGLINDA listei permise de server (api/_lib/claude.js → MODELS) — ține-le
// sincron. Serverul validează oricum: un ID necunoscut cade pe implicit.
// TOATE modelele merg cu ACEEAȘI cheie ANTHROPIC_API_KEY din Vercel —
// nu e nevoie de chei separate; modelul se trimite per cerere.
// =====================================================================
export const AI_MODELS = [
  { id: 'claude-sonnet-5',   label: 'Sonnet 5',   hint: 'rapid și echilibrat — recomandat pentru sarcinile de zi cu zi' },
  { id: 'claude-opus-5',     label: 'Opus 5',     hint: 'foarte capabil — ideal pentru teste complexe și analize (mai lent și mai scump)' },
  { id: 'claude-fable-5',    label: 'Fable 5',    hint: 'cel mai nou și mai capabil model Anthropic (iunie 2026) — cel mai scump' },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',  hint: 'cel mai rapid și mai ieftin — pentru sarcini simple (atenție la calcule)' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', hint: 'generația anterioară Sonnet' },
  { id: 'claude-opus-4-8',   label: 'Opus 4.8',   hint: 'generația anterioară Opus' },
];

export const DEFAULT_AI_MODEL = AI_MODELS[0].id;

// =====================================================================
// AI_STACK — ce comunicăm PUBLIC despre modelele folosite.
// SINGURUL LOC DE ADEVĂR pentru textele de pe site: <AIPoweredBy />
// (footer, pagina Profesor Virtual, chat, Home, Prețuri, Despre noi) și
// categoria „Profesorul Virtual (AI)" din FAQ citesc de aici.
//
// ATENȚIE: textul de pe site NU citește env-ul serverului. Când schimbi un
// model în Vercel (AI_CHAT_MODEL, AI_TUTOR_MODEL, AI_PDF_CHAT_MODEL,
// AI_GEN_CHAT_MODEL, CLAUDE_MODEL), actualizează și lista de mai jos —
// altfel site-ul promite altceva decât rulează. Formulările sunt intenționat
// „folosim modelele…", nu „fiecare răspuns e generat de…": peste bugetul
// zilnic soft chatul coboară pe modelul economic (api/_lib/ai.js → pickModel).
// =====================================================================
export const AI_STACK = {
  // Pentru CLIENȚI (elevi, părinți, profesori): Profesorul Virtual (chat,
  // explicații pas cu pas, citirea subiectelor PDF), corectarea după barem,
  // generatorul de teste și exercițiile interactive — pe modele OpenAI —
  // PLUS generarea seturilor de exerciții din „Meditații", pe Claude Opus 5
  // (Anthropic). De aceea blocul „pentru tine" are DOUĂ liste de modele:
  //   modele          → OpenAI (chatul, pozele și vocea merg doar aici)
  //   modeleAnthropic → Claude, tot pentru clienți (doar Meditații)
  // `furnizor` rămâne 'OpenAI' pentru că textele despre datele trimise din
  // chat (FAQ, Politica de confidențialitate) îl folosesc ca destinatar.
  clienti: {
    furnizor: 'OpenAI',
    modele: ['GPT-4o mini', 'GPT-5 mini', 'GPT-5.6 Terra', 'GPT-5.6 Sol'],
    furnizorAnthropic: 'Anthropic',
    modeleAnthropic: ['Claude Opus 5'],
    furnizori: 'OpenAI și Anthropic',
    descriere: 'GPT-4o mini răspunde rapid în chat; GPT-5 mini preia explicațiile pas cu pas — rezolvările comentate, indiciile și „explică-mi din nou"; GPT-5.6 Terra și GPT-5.6 Sol preiau sarcinile care cer precizie maximă — citirea subiectelor PDF, citirea pozelor cu exerciții, corectarea după barem, generarea de teste și exerciții. Claude Opus 5, de la Anthropic, generează seturile de exerciții din „Meditații cu Profesorul Virtual".',
  },
  // Anthropic (Claude): (a) uneltele administrative interne ale echipei și
  // (b) GENERAREA seturilor de exerciții din „Meditații cu Profesorul Virtual"
  // — corectat pe 23 august 2026 (Etapa 3, punctul 2.5 din auditul agenților):
  // până atunci textul spunea că modelele Anthropic sunt folosite DOAR intern,
  // deși generatorul de meditații rulează pe Claude Opus 5, iar la exercițiile
  // de remediere primește și răspunsul greșit al elevului (fără nume, e-mail
  // sau alte date de identificare). Ține textul sincron cu codul:
  // api/_lib/meditatii.js → OPUS_MODEL.
  intern: {
    furnizor: 'Anthropic',
    modele: ['Claude Opus 5', 'Claude Fable 5'],
    descriere: 'Folosite în două locuri: (1) uneltele administrative ale echipei ExamenMate — generarea și verificarea testelor și exercițiilor din biblioteca site-ului, articolele, optimizările paginilor; (2) generarea seturilor de exerciții din „Meditații cu Profesorul Virtual" — aceasta este o funcție pentru tine, nu una internă, și rulează pe Claude Opus 5. La exercițiile de remediere, modelul primește și exercițiul greșit împreună cu răspunsul dat de elev, ca să genereze exerciții de același tip. Nu primește numele, e-mailul sau alte date care te identifică, iar datele trimise prin API nu sunt folosite la antrenarea modelelor.',
  },
};

// Toate modelele care lucrează PENTRU CLIENȚI, într-o singură listă
// („GPT-4o mini", „GPT-5 mini", …, „Claude Opus 5").
export const AI_STACK_CLIENTI_MODELE = [
  ...AI_STACK.clienti.modele,
  ...AI_STACK.clienti.modeleAnthropic,
];

// Linie scurtă pentru CHAT (disclaimerul de sub caseta de scris): doar
// modelele OpenAI — chatul nu trece prin Anthropic.
// „OpenAI GPT-4o mini · GPT-5 mini · GPT-5.6 Terra · GPT-5.6 Sol"
export const AI_STACK_SCURT = `${AI_STACK.clienti.furnizor} ${AI_STACK.clienti.modele.join(' · ')}`;

// Linie scurtă pentru PLATFORMĂ (Prețuri, Despre noi): include și modelul
// Anthropic folosit pentru clienți.
// „OpenAI GPT-4o mini · … · GPT-5.6 Sol · Anthropic Claude Opus 5"
export const AI_STACK_SCURT_TOT = `${AI_STACK_SCURT} · ${AI_STACK.clienti.furnizorAnthropic} ${AI_STACK.clienti.modeleAnthropic.join(' · ')}`;
