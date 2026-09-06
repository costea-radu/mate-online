// =====================================================================
// api/_lib/ai.js — utilitare partajate pentru Profesorul Virtual
// (fișier ignorat de Vercel ca rută, fiindcă numele începe cu "_")
//
// Furnizor LLM CONFIGURABIL prin variabile de mediu. Default: OpenAI.
// Funcționează cu orice API compatibil OpenAI (OpenAI, OpenRouter,
// Together, Groq, Azure, Ollama local etc.) — schimbi doar URL-ul + modelul.
// =====================================================================

const crypto = require('crypto');
const http = require('./http'); // CORS, autentificare, admin — partajate
const { parseExerciseRef, sliceExercise, formatRef, norm, locateBaremItem, shortAnswerOf } = require('./barem'); // localizare deterministă item

// ─── Configurare furnizor (chat + embeddings sunt independente) ──────────────
const CHAT_BASE  = process.env.AI_CHAT_BASE_URL  || 'https://api.openai.com/v1';
const CHAT_KEY   = process.env.AI_CHAT_API_KEY   || process.env.OPENAI_API_KEY || '';
const CHAT_MODEL = process.env.AI_CHAT_MODEL     || 'gpt-4o-mini';
// Prin Vercel AI Gateway (sau OpenRouter) modelele poartă prefixul providerului
// („openai/gpt-4o-mini"). Implicitele modelelor derivate moștenesc prefixul
// modelului de chat, ca să funcționeze și prin gateway, și direct pe OpenAI.
const MODEL_PREFIX = CHAT_MODEL.includes('/') ? CHAT_MODEL.slice(0, CHAT_MODEL.lastIndexOf('/') + 1) : '';
// Model cu vedere (foto-rezolvare, api/ai-vision.js): citește enunțul din poza
// elevului. IMPLICIT „terra" (gpt-5.6) — scrisul de mână, formulele și pozele
// strâmbe cer un model bun la vedere, iar o transcriere greșită strică tot ce
// urmează. NU mai moștenește modelul de chat. AI_VISION_MODEL îl schimbă;
// peste bugetul zilnic soft, pickModel coboară automat pe modelul standard.
const VISION_MODEL = process.env.AI_VISION_MODEL || MODEL_PREFIX + 'gpt-5.6-terra';

const EMBED_BASE  = process.env.AI_EMBED_BASE_URL || 'https://api.openai.com/v1';
const EMBED_KEY   = process.env.AI_EMBED_API_KEY  || process.env.OPENAI_API_KEY || '';
const EMBED_MODEL = process.env.AI_EMBED_MODEL    || 'text-embedding-3-small';
const EMBED_DIM   = parseInt(process.env.AI_EMBED_DIM || '1536', 10);

// Speech-to-text (fallback când browserul nu are recunoaștere vocală)
const STT_BASE  = process.env.AI_STT_BASE_URL || CHAT_BASE;
const STT_KEY   = process.env.AI_STT_API_KEY  || CHAT_KEY;
const STT_MODEL = process.env.AI_STT_MODEL    || 'whisper-1';

const RATE_PER_HOUR = parseInt(process.env.AI_RATE_PER_HOUR || '80', 10);
const FREE_ACTIONS = parseInt(process.env.AI_FREE_ACTIONS || '2', 10); // acțiuni AI gratuite pentru cont fără abonament
const SIGNING_SECRET = process.env.AI_SIGNING_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || 'dev-secret';

// CORS / applyCors / admin / authUser / requireAdmin / signedUrlFromPublic
// vin din _lib/http.js (sursă unică, cu antetul Authorization inclus).
const { CORS, applyCors, admin, authUser, requireAdmin, signedUrlFromPublic, isCronRequest } = http;

const hasEmbeddings = () => !!EMBED_KEY;
const hasChat = () => !!CHAT_KEY;

// Modelul agentului de teste PDF — citirea enunțurilor și fidelitatea față de
// barem cer un model bun, deci IMPLICIT „terra" (flagship-ul gpt-5.6), nu mai
// depinde de setarea din env (cu prefixul providerului moștenit de la modelul
// de chat, pentru AI Gateway). AI_PDF_CHAT_MODEL în env îl poate schimba;
// peste bugetul zilnic soft, pickModel coboară automat pe modelul standard.
const PDF_MODEL = process.env.AI_PDF_CHAT_MODEL || MODEL_PREFIX + 'gpt-5.6-terra';
// Modelul pentru GENERAREA de teste/exerciții și CORECTAREA răspunsurilor —
// acolo modelul calculează singur (fără barem), deci o greșeală de calcul ajunge
// direct „răspuns oficial" în cheia unui test dat elevilor. IMPLICIT „sol"
// (gpt-5.6-sol, flagship-ul), nu modelul de chat: e cel folosit în contul de
// profesor pentru teste și exerciții PDF/interactive. AI_GEN_CHAT_MODEL îl
// schimbă; peste bugetul zilnic soft, pickModel coboară automat pe CHAT_MODEL.
// ATENȚIE la cost: sol e ~27× mai scump la intrare și ~33× la ieșire față de
// gpt-4o-mini — vezi GHID_LIMITE_AI.md pentru bugete.
const GEN_MODEL = process.env.AI_GEN_CHAT_MODEL || MODEL_PREFIX + 'gpt-5.6-sol';
// Model separat (opțional) pentru EXPLICAȚIILE pas-cu-pas din chat — modurile
// „tutor" / „explain" / „hint" (punctul 1.4 din AUDIT_AGENTI_AI.md): acolo
// modelul calculează, iar 4o-mini greșește cel mai des la probleme cu mai mulți
// pași. Asistentul general („assistant"/„exams"/„students" — întrebări despre
// platformă) rămâne pe CHAT_MODEL. Decizia se ia cu `npm run eval -- --models
// a,b --mode tutor`; apoi setezi AI_TUTOR_MODEL (ex. gpt-5-mini) în env.
const TUTOR_MODEL = process.env.AI_TUTOR_MODEL || CHAT_MODEL;
const TUTOR_MODES = new Set(['tutor', 'explain', 'hint']);
// Efortul de raționament trimis modelelor cu raționament (gpt-5.x, o-series):
// 'minimal' | 'low' | 'medium' | 'high'. Nesetat → providerul decide (medium).
// Cu `low`, gpt-5-mini rămâne ieftin și rapid; se poate suprascrie per apel.
const REASONING_EFFORT = String(process.env.AI_REASONING_EFFORT || '').trim().toLowerCase() || null;
// Modelul de chat după MOD și context: pe un PDF deschis → modelul PDF (citește
// enunțurile, urmărește baremul); explicații pas-cu-pas → TUTOR_MODEL; altfel CHAT_MODEL.
function chatModelFor(mode, context = null) {
  if (context && context.pdf) return PDF_MODEL;
  return TUTOR_MODES.has(String(mode || '')) ? TUTOR_MODEL : CHAT_MODEL;
}

// =====================================================================
// COSTURI & BUGETE DE CONSUM AI (vezi GHID_LIMITE_AI.md)
// Fiecare acțiune AI e transformată în BANI (micro-lei) la logare, după
// modelul folosit. Pe baza sumelor din `ai_usage` se aplică:
//   · buget zilnic „soft"  → peste el, cererile trec pe un model mai ieftin
//   · buget zilnic „hard"  → peste el, AI-ul se oprește până a doua zi
//   · buget lunar (30 zile rulante) → plafonul economic al abonamentului
// =====================================================================

// Prețuri în USD per 1 MILION de tokeni {in, out}, per model. Potrivirea se
// face pe CEL MAI LUNG prefix (ex. „gpt-5.6-terra-2026-08-01" → intrarea
// „gpt-5.6-terra"; o variantă gpt-5.6 fără intrare proprie → „gpt-5.6").
// Verificate pe 22 august 2026 (developers.openai.com/api/docs/pricing, tarif
// Standard, context < 270K tokeni — peste, OpenAI dublează prețul de intrare;
// aplicația nu trimite atât). Completezi/suprascrii FĂRĂ cod prin env:
//   AI_PRICES_JSON='{"gpt-5.6-terra":{"in":2,"out":12}}'
const PRICES_USD = {
  'gpt-4o-mini':            { in: 0.15, out: 0.60 },
  'gpt-4o':                 { in: 2.50, out: 10 },
  'gpt-5-nano':             { in: 0.05, out: 0.40 },
  'gpt-5-mini':             { in: 0.25, out: 2 },
  'gpt-5':                  { in: 1.25, out: 10 },
  'gpt-5.4-nano':           { in: 0.20, out: 1.25 },
  'gpt-5.4':                { in: 1.25, out: 10 },
  'gpt-5.5':                { in: 5,    out: 30 },
  // Familia gpt-5.6 (iulie 2026) are mărimi cu prețuri DIFERITE — până acum
  // toate cădeau pe o singură intrare 5/30 (prețul de lansare al lui sol),
  // deci terra (modelul PDF/corectare) era contorizat de 2,5× mai scump decât
  // costă, iar degradarea peste bugetul zilnic soft pornea mult prea devreme.
  // Platforma folosește doar terra și sol (plus gpt-4o-mini).
  'gpt-5.6-terra':          { in: 2,    out: 12 },   // modelul PDF / corectare / pre-generare
  'gpt-5.6-sol':            { in: 4,    out: 20 },   // flagship (redus de la 5/30 după lansare)
  'gpt-5.6':                { in: 5,    out: 30 },   // altă variantă gpt-5.6, nefolosită → conservator
  'text-embedding-3-small': { in: 0.02, out: 0 },
  'text-embedding-3-large': { in: 0.13, out: 0 },
  'claude-haiku-4-5':       { in: 1,    out: 5 },
  'claude-sonnet-4-6':      { in: 3,    out: 15 },
  'claude-sonnet-5':        { in: 2,    out: 10 },
  'claude-opus-4-8':        { in: 5,    out: 25 },
  'claude-opus-5':          { in: 5,    out: 25 },
  'claude-fable-5':         { in: 10,   out: 50 },
  'whisper':                { perCall: 0.003 },      // STT e pe minut → estimare per apel (~20-30s)
};
let PRICES_EXTRA = {};
try { PRICES_EXTRA = JSON.parse(process.env.AI_PRICES_JSON || '{}'); }
catch { console.warn('AI_PRICES_JSON invalid (nu e JSON) — ignorat.'); }
const ALL_PRICES = { ...PRICES_USD, ...PRICES_EXTRA };

// Model necunoscut → preț implicit CONSERVATOR (mai bine supraestimăm costul
// decât să lăsăm un model scump nelimitat) + avertisment o singură dată.
const DEFAULT_PRICE = {
  in:  parseFloat(process.env.AI_PRICE_DEFAULT_IN  || '3'),
  out: parseFloat(process.env.AI_PRICE_DEFAULT_OUT || '15'),
};
// Curs USD→RON fix, setat puțin PESTE piață (marjă de siguranță în calcule).
const USD_RON = parseFloat(process.env.AI_USD_RON || '4.6');

const warnedOnce = new Set();
const warnOnce = (key, msg) => { if (!warnedOnce.has(key)) { warnedOnce.add(key); console.warn(msg); } };

function priceFor(model) {
  let id = String(model || '').toLowerCase();
  if (!id) return null;
  // Prin AI Gateway / OpenRouter modelul poartă prefixul providerului
  // („openai/gpt-4o-mini"). Fără curățare, niciun preț nu se potrivea și TOATE
  // apelurile cădeau pe prețul implicit conservator (3/15 USD) — costul lui
  // gpt-4o-mini era umflat de ~20×, bugetul zilnic soft se „consuma" după
  // câteva mesaje, iar pickModel retrograda modelele premium (terra) pe chat.
  id = id.replace(/^[a-z0-9_.-]+\//, '');
  let best = null;
  for (const key of Object.keys(ALL_PRICES)) {
    if (id.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  if (best) return ALL_PRICES[best];
  warnOnce(`price:${id}`, `priceFor: model necunoscut „${id}" — aplic prețul implicit (${DEFAULT_PRICE.in}/${DEFAULT_PRICE.out} USD/1M). Adaugă-l în AI_PRICES_JSON.`);
  return DEFAULT_PRICE;
}

// Costul unei acțiuni în MICRO-LEI (1 leu = 1.000.000 micro-lei; întreg → bigint).
function costMicroLei(model, usage = {}) {
  const p = priceFor(model);
  if (!p) return 0; // fără model (ex: acțiune fără LLM) → cost 0
  const usd = p.perCall != null
    ? p.perCall
    : ((usage.in || 0) * (p.in || 0) + (usage.out || 0) * (p.out || 0)) / 1e6;
  return Math.round(usd * USD_RON * 1e6);
}

// Bugetele, în LEI (0 = limita respectivă e dezactivată).
// RIDICATE pe 23 august 2026, o dată cu trecerea generării pe gpt-5.6-sol
// (4/20 USD/1M, ~30× față de gpt-4o-mini) și a foto-rezolvării pe terra.
// Reperul: o zi „grea" de elev trebuie să încapă SUB limita soft, altfel
// degradarea pe modelul economic pornește după prima acțiune și sol n-ar
// mai apuca să conteze. Un test de examen costă 1,0–1,7 lei (sol e model cu
// raționament: max_completion_tokens ajunge la 16000), plus verificarea.
//   zi soft: 0,8 → 2,5 lei  (×3,1)   — un test complet + verificare + chat
//   zi hard: 2,5 → 6 lei    (×2,4)   — oprire la abuz
//   lună:      6 → 12 lei   (×2)     — 24% dintr-un abonament de 50 lei
// Abonamentul e 50 lei/lună (api/create-checkout.js), deci marja rămâne ~76%
// pe dimensiunea AI. Adminii sunt scutiți (isBudgetExempt).
const BUDGET_DAY_SOFT_LEI = parseFloat(process.env.AI_BUDGET_DAY_SOFT_LEI || '2.5');
const BUDGET_DAY_HARD_LEI = parseFloat(process.env.AI_BUDGET_DAY_HARD_LEI || '6');
const BUDGET_MONTH_LEI    = parseFloat(process.env.AI_BUDGET_MONTH_LEI    || '12');
// Modelul „economic" pe care coboară CHATUL peste bugetul zilnic soft.
// (Cererile pe modele premium — PDF/GEN — coboară pe CHAT_MODEL.) Prefixul
// providerului se moștenește de la modelul de chat (AI Gateway).
const ECON_CHAT_MODEL = process.env.AI_ECON_CHAT_MODEL || MODEL_PREFIX + 'gpt-4o-mini';

// ─── CREDITE AI — unitatea în care vede elevul bugetul ───────────────────────
// Intern ținem lei (costul real al apelurilor). În interfață, în Stripe și în
// e-mailuri afișăm CREDITE: 100 credite = 1 leu de buget. Perechea din front
// e src/lib/aiCredit.js — dacă schimbi rata, schimb-o în ambele locuri.
const CREDITS_PER_LEU = parseInt(process.env.AI_CREDITS_PER_LEU || '100', 10) || 100;
const leiToCredits = (lei) => {
  const n = Number(lei);
  return Number.isFinite(n) && n > 0 ? Math.round(n * CREDITS_PER_LEU) : 0;
};
const fmtCredits = (lei) => leiToCredits(lei).toLocaleString('ro-RO');

// ─── Pachete TOP-UP (buget suplimentar, cumpărat prin Stripe) ────────────────
// Un pachet adaugă `creditLei` la bugetul lunar, pentru AI_TOPUP_DAYS zile
// (implicit 30 — aceeași fereastră ca bugetul rulant). Prețul include marja
// (recomandat 2–3× costul real). Suprascriere fără cod:
//   AI_TOPUP_PACKS_JSON='[{"id":"mic","nume":"Pachet AI Mic","pretLei":10,"creditLei":4}]'
const TOPUP_DAYS = parseInt(process.env.AI_TOPUP_DAYS || '30', 10);
const DEFAULT_TOPUP_PACKS = [
  { id: 'mic',  nume: 'Pachet AI Mic',  pretLei: 10, creditLei: 4 },
  { id: 'mare', nume: 'Pachet AI Mare', pretLei: 20, creditLei: 10 },
];
function topupPacks() {
  try {
    const arr = JSON.parse(process.env.AI_TOPUP_PACKS_JSON || 'null');
    if (Array.isArray(arr)) {
      const ok = arr.filter((p) => p && p.id && p.nume && +p.pretLei > 0 && +p.creditLei > 0)
        .map((p) => ({ id: String(p.id), nume: String(p.nume), pretLei: +p.pretLei, creditLei: +p.creditLei }));
      if (ok.length) return ok;
      if (arr.length === 0) return []; // listă goală explicită = pachetele sunt dezactivate
    }
  } catch { warnOnce('packs', 'AI_TOPUP_PACKS_JSON invalid (nu e JSON) — folosesc pachetele implicite.'); }
  return DEFAULT_TOPUP_PACKS;
}

// ─── Cote per funcție, PER ROL, cu POOL comun (vizibile în UI) ───────────────
// Registrul funcțiilor cu cotă: endpointul numărat din ai_usage + etichete.
// window: 'month' = fereastră de 30 de zile; 'day' = ziua curentă (ora RO).
const FEATURE_QUOTAS = {
  corectari:   { endpoint: 'ai-correct:grade',        label: 'Corectări de teste',            emoji: '📝', window: 'month' },
  teste:       { endpoint: 'ai-exam',                 label: 'Subiecte de examen generate',   emoji: '📄', window: 'month' },
  interactive: { endpoint: 'ai-generate-interactive', label: 'Exerciții interactive generate', emoji: '🧩', window: 'month' },
  foto:        { endpoint: 'ai-vision',               label: 'Foto-rezolvări',                emoji: '📷', window: 'day' },
};

// Limitele implicite PER ROL (0 = cota funcției e dezactivată pentru acel rol).
// Elevii corectează mult (teme, simulări) → corectări mai multe; profesorii
// generează subiecte pentru clase → subiecte mai multe, corectări puține
// (ei corectează cu baremul, nu cu AI-ul).
const QUOTA_ROLE_DEFAULTS = {
  elev:     { corectari: 20, teste: 20, interactive: 40, foto: 10 },
  profesor: { corectari: 5,  teste: 40, interactive: 40, foto: 10 },
  parinte:  { corectari: 20, teste: 20, interactive: 40, foto: 10 },
};
// Suprascrieri din env: GLOBALE (aceeași valoare pentru toate rolurile) —
// env-urile existente AI_QUOTA_* — și FINE, per rol:
//   AI_QUOTAS_JSON='{"profesor":{"corectari":3},"elev":{"teste":30}}'
const QUOTA_GLOBAL_ENV = {
  corectari: process.env.AI_QUOTA_CORECTARI_LUNA,
  teste: process.env.AI_QUOTA_TESTE_LUNA,
  interactive: process.env.AI_QUOTA_INTERACTIVE_LUNA,
  foto: process.env.AI_QUOTA_FOTO_ZI,
};
let QUOTAS_JSON = {};
try { QUOTAS_JSON = JSON.parse(process.env.AI_QUOTAS_JSON || '{}'); }
catch { console.warn('AI_QUOTAS_JSON invalid (nu e JSON) — ignorat.'); }

// Limitele efective ale unui rol ('elev' | 'profesor' | 'parinte'; altceva → elev).
function quotasForRole(role) {
  const r = role === 'profesor' || role === 'parinte' ? role : 'elev';
  const out = {};
  for (const key of Object.keys(FEATURE_QUOTAS)) {
    let v = QUOTA_ROLE_DEFAULTS[r][key];
    const g = QUOTA_GLOBAL_ENV[key];
    if (g != null && g !== '' && !Number.isNaN(+g)) v = +g;
    const j = QUOTAS_JSON && QUOTAS_JSON[r] ? QUOTAS_JSON[r][key] : null;
    if (j != null && !Number.isNaN(+j)) v = +j;
    out[key] = Math.max(0, Math.trunc(+v || 0));
  }
  return out;
}

// ─── POOL comun + „transfer" între cotele LUNARE ─────────────────────────────
// Cotele lunare (corectări / subiecte / interactive) se COMPLETEAZĂ între ele:
// când una se termină, acțiunile în plus consumă din rezerva celorlalte —
// echivalentul se scade de acolo, iar UI-ul arată „transferate la …".
// Foto rămâne separată (fereastră ZILNICĂ — nu se amestecă cu cele lunare).
// Alocarea e PURĂ, derivată din numărători — nimic de stocat: fereastra
// alunecă, iar alocarea se recalculează identic la fiecare citire.
function allocateQuotas(items) {
  const st = items.map((it) => ({
    key: it.key,
    used: Math.max(0, Math.trunc(+it.used || 0)),
    limit: Math.max(0, Math.trunc(+it.limit || 0)),
    absorbed: 0, borrowedIn: [], borrowedOut: [], unallocated: 0,
  }));
  for (const it of st) {
    let need = Math.max(0, it.used - it.limit);
    for (const src of st) {
      if (src === it || need <= 0) continue;
      const free = Math.max(0, src.limit - Math.min(src.used, src.limit) - src.absorbed);
      if (!free) continue;
      const take = Math.min(free, need);
      src.absorbed += take; need -= take;
      it.borrowedIn.push({ from: src.key, n: take });
      src.borrowedOut.push({ to: it.key, n: take });
    }
    it.unallocated = need; // >0 doar dacă tot pool-ul e epuizat
  }
  return st.map((it) => ({
    key: it.key, used: it.used, limit: it.limit,
    effUsed: Math.min(it.used, it.limit) + it.absorbed, // propriu (plafonat) + absorbit de la alții
    borrowedIn: it.borrowedIn, borrowedOut: it.borrowedOut, unallocated: it.unallocated,
  }));
}

// Miezul nopții de AZI pe ora României, ca timestamp ISO (începutul „zilei" de buget).
function dayStartBucharest(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Bucharest', hour12: false,
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now).map((p) => [p.type, p.value])
  );
  const msSinceMidnight = (((+parts.hour % 24) * 3600) + (+parts.minute * 60) + (+parts.second)) * 1000;
  return new Date(now.getTime() - msSinceMidnight).toISOString();
}

// ─── Compatibilitate parametri între generațiile de modele ───────────────────
// Modelele noi OpenAI (gpt-5.x, o1/o3/o4...) REFUZĂ `max_tokens` (cer
// `max_completion_tokens`) și unele refuză `temperature` ≠ 1. Construim
// corpul potrivit după numele modelului și, ca plasă de siguranță, reparăm
// automat la eroarea 400 „unsupported parameter" și reîncercăm o dată.
const isNewGenModel = (m) => /\bgpt-5|^o[1-9]\b|\bo[1-9]-/i.test(String(m || ''));
// `schema` (opțional): JSON Schema STRICT → Structured Outputs (decodare
// constrânsă: JSON garantat valid, enum-urile respectate). Fără schemă, `json`
// → modul clasic json_object. Vezi chatJson() și helperul S de mai jos.
const EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh']);
function buildBody({ model, temperature, maxTokens, messages, system, json, stream, schema = null, schemaName = 'raspuns', reasoningEffort = REASONING_EFFORT, tools = null }) {
  const body = { model, messages: system ? [{ role: 'system', content: system }, ...messages] : [...messages] };
  // unelte (tool calling, Etapa 3): format OpenAI `tools`; bucla de apeluri e în chat/chatStream
  if (Array.isArray(tools) && tools.length) {
    body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    body.tool_choice = 'auto';
  }
  if (isNewGenModel(model)) {
    // Modelele cu raționament „ard" tokeni pe gândirea internă ÎNAINTE de a
    // scrie răspunsul; cu bugetul clasic (900–5000) rămân des cu răspuns GOL
    // sau trunchiat (JSON invalid). Le dăm spațiu de raționament: 3× bugetul,
    // minim 3000, plafonat la 16000.
    body.max_completion_tokens = Math.min(Math.max(maxTokens * 3, 3000), 16000);
    // efortul de raționament (AI_REASONING_EFFORT sau per apel); modelele vechi
    // nu cunosc parametrul, deci nu-l trimitem acolo; dacă providerul îl
    // refuză, adaptBodyToError îl scoate și reîncearcă
    const eff = String(reasoningEffort || '').toLowerCase();
    if (EFFORTS.has(eff)) body.reasoning_effort = eff;
  } else { body.max_tokens = maxTokens; body.temperature = temperature; }
  if (schema) {
    body.response_format = { type: 'json_schema', json_schema: { name: String(schemaName || 'raspuns').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64), schema, strict: true } };
  } else if (json) body.response_format = { type: 'json_object' };
  if (stream) {
    body.stream = true;
    // cerem usage-ul real în ultimul chunk (OpenAI o suportă; dacă providerul
    // o refuză, adaptBodyToError o scoate și reîncearcă)
    body.stream_options = { include_usage: true };
  }
  return body;
}
// repară corpul după mesajul de eroare al providerului; întoarce true dacă a schimbat ceva
function adaptBodyToError(body, errText) {
  const t = String(errText || '');
  let changed = false;
  if (/max_tokens/.test(t) && 'max_tokens' in body) {
    body.max_completion_tokens = body.max_tokens; delete body.max_tokens; changed = true;
  } else if (/max_completion_tokens/.test(t) && 'max_completion_tokens' in body) {
    body.max_tokens = body.max_completion_tokens; delete body.max_completion_tokens; changed = true;
  }
  if (/temperature/.test(t) && 'temperature' in body) { delete body.temperature; changed = true; }
  if (/reasoning/i.test(t) && 'reasoning_effort' in body) { delete body.reasoning_effort; changed = true; }
  if (/response_format|json_schema|schema|strict/i.test(t) && body.response_format) {
    // Structured Outputs refuzate (gateway vechi, model fără suport, schemă
    // invalidă) → coborâm pe json_object (comportamentul de până acum); dacă
    // nici acela nu e acceptat, renunțăm la format de tot.
    if (body.response_format.type === 'json_schema') {
      warnOnce(`schema:${body.response_format.json_schema?.name}`, `Structured Outputs refuzate pentru „${body.response_format.json_schema?.name}" (${t.slice(0, 160)}) — cobor pe json_object.`);
      body.response_format = { type: 'json_object' };
    } else delete body.response_format;
    changed = true;
  }
  if (/stream_options/.test(t) && body.stream_options) { delete body.stream_options; changed = true; }
  if (/\btools?\b|tool_choice|function/i.test(t) && body.tools) {
    // providerul/modelul nu acceptă unelte → continuăm fără ele (răspunsul rămâne posibil)
    warnOnce('tools', `Uneltele (tool calling) au fost refuzate de provider (${t.slice(0, 120)}) — continui fără ele.`);
    delete body.tools; delete body.tool_choice; changed = true;
  }
  // atașamente (pagini PDF / imagini) refuzate de provider sau model → retrimitem
  // DOAR textul (comportamentul de dinainte de Etapa 2)
  if (/\bfile\b|file_data|image|multimodal|vision|content\[|content must be|invalid content/i.test(t) && hasParts(body.messages)) {
    body.messages = body.messages.map((m) => (Array.isArray(m.content) ? { ...m, content: textOfContent(m.content) } : m));
    warnOnce('parts', `Atașamentele (PDF/imagini) au fost refuzate de provider (${t.slice(0, 120)}) — retrimit doar textul.`);
    changed = true;
  }
  return changed;
}
const hasParts = (msgs) => Array.isArray(msgs) && msgs.some((m) => Array.isArray(m && m.content));
const textOfContent = (c) => (Array.isArray(c) ? c.filter((p) => p && p.type === 'text').map((p) => p.text).join('\n') : String(c ?? ''));
async function postLLM(body) {
  const call = () => fetch(`${CHAT_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CHAT_KEY}` },
    body: JSON.stringify(body),
  });
  let r = await call();
  if (!r.ok && r.status === 400) {
    const t = await r.text().catch(() => '');
    if (adaptBodyToError(body, t)) r = await call();
    else throw new Error(`LLM 400: ${t.slice(0, 300)}`);
  }
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`LLM ${r.status}: ${t.slice(0, 300)}`);
  }
  return r;
}

// ─── Apel LLM (chat completions, format OpenAI) ──────────────────────────────
async function chat({ system, messages = [], temperature = 0.4, maxTokens = 900, json = false, model = CHAT_MODEL, reasoningEffort = undefined, tools = null, stats = null }) {
  if (!hasChat()) throw new Error('AI_CHAT_API_KEY (sau OPENAI_API_KEY) nu este setat.');
  const body = buildBody({ model, temperature, maxTokens, messages, system, json, tools, ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) });
  let r = await postLLM(body);
  let data = await r.json();
  const usage = {
    in: data.usage?.prompt_tokens || 0,
    out: data.usage?.completion_tokens || 0,
    model, // pentru calculul costului la logUsage
  };
  // ── bucla de UNELTE (tool calling): modelul cere funcții → le rulăm → îi
  //    dăm rezultatele → continuă; cel mult TOOL_ROUNDS runde ──
  for (let round = 0; round < TOOL_ROUNDS; round++) {
    const msg = data.choices?.[0]?.message || {};
    if (!body.tools || !Array.isArray(msg.tool_calls) || !msg.tool_calls.length) break;
    body.messages.push({ role: 'assistant', content: msg.content ?? null, tool_calls: msg.tool_calls });
    for (const call of msg.tool_calls) body.messages.push(await runToolCall(tools, call, stats));
    if (round === TOOL_ROUNDS - 1) { delete body.tools; delete body.tool_choice; } // ultima rundă: răspuns, nu alt apel
    r = await postLLM(body);
    data = await r.json();
    usage.in += data.usage?.prompt_tokens || 0;
    usage.out += data.usage?.completion_tokens || 0;
  }
  let text = data.choices?.[0]?.message?.content ?? '';
  // AUTO-VINDECARE: modelele cu raționament pot epuiza tot bugetul pe gândire
  // și întorc conținut GOL sau TĂIAT la mijloc (finish_reason=length → JSON
  // invalid la generatoare). Reîncercăm O dată cu bugetul maxim.
  const finish = data.choices?.[0]?.finish_reason || '';
  if ((!String(text).trim() || finish === 'length') && isNewGenModel(model) && (body.max_completion_tokens || 0) < 16000) {
    console.warn(`chat: răspuns ${String(text).trim() ? 'trunchiat' : 'gol'} la ${model} (finish=${finish}) — reîncerc cu buget maxim`);
    body.max_completion_tokens = 16000;
    r = await postLLM(body);
    data = await r.json();
    text = data.choices?.[0]?.message?.content ?? '';
    usage.in += data.usage?.prompt_tokens || 0;
    usage.out += data.usage?.completion_tokens || 0;
  }
  return { text, usage };
}

// =====================================================================
// STRUCTURED OUTPUTS — răspunsuri JSON cu schemă strictă
// =====================================================================
// Helper compact pentru scheme STRICTE (regulile OpenAI strict + Claude):
//   · fiecare obiect: additionalProperties:false + TOATE cheile în required;
//   · câmp opțional = tip nullable (["string","null"]), nu cheie lipsă;
//   · fără minItems/maxItems/minimum/pattern/format (nesuportate în strict).
const S = {
  obj: (props, description = null) => ({
    type: 'object', properties: props, required: Object.keys(props), additionalProperties: false,
    ...(description ? { description } : {}),
  }),
  str: (description = null) => ({ type: 'string', ...(description ? { description } : {}) }),
  int: (description = null) => ({ type: 'integer', ...(description ? { description } : {}) }),
  num: (description = null) => ({ type: 'number', ...(description ? { description } : {}) }),
  bool: (description = null) => ({ type: 'boolean', ...(description ? { description } : {}) }),
  enum: (values, description = null) => ({ type: 'string', enum: values, ...(description ? { description } : {}) }),
  arr: (items, description = null) => ({ type: 'array', items, ...(description ? { description } : {}) }),
  // nullable: tip simplu → ["tip","null"]; obiect/array/enum → anyOf cu null
  nullable: (t) => {
    if (typeof t.type === 'string' && !t.enum && t.type !== 'object' && t.type !== 'array') return { ...t, type: [t.type, 'null'] };
    return { anyOf: [t, { type: 'null' }] };
  },
};

// ─── Repararea LaTeX-ului corupt de JSON.parse ───────────────────────────────
// Modelele scriu uneori „\frac" cu UN backslash în stringul JSON; „\f", „\t",
// „\b" sunt escape-uri JSON valide (form-feed, tab, backspace), deci și cu
// Structured Outputs (care garantează doar JSON VALID) parse-ul le transformă
// în caractere de control: „\frac" → „␌rac". Le restaurăm (caracterele de
// control nu apar legitim în text); „\n"/„\r" sunt rânduri reale — le
// restaurăm DOAR când sunt urmate de o comandă LaTeX cunoscută (\neq, \nu,
// \nabla, \notin, \rho, \right, \rightarrow, \rangle, \rceil, \rfloor).
function restoreLatexControl(s) {
  if (typeof s !== 'string' || !s) return s;
  return s
    .replace(/\f/g, '\\f')       // \frac, \forall, \frown...
    .replace(/\t/g, '\\t')       // \times, \theta, \tan, \to, \text, \triangle...
    .replace(/\u0008/g, '\\b')  // \begin, \binom, \beta...
    .replace(/\n(?=(?:eq|e|u|abla|ot|otin|mid|ewline)\b)/g, '\\n')
    .replace(/\r(?=(?:ho|ight|ightarrow|angle|ceil|floor|m)\b)/g, '\\r');
}
function deepRestoreLatex(obj) {
  if (Array.isArray(obj)) return obj.map(deepRestoreLatex);
  if (obj && typeof obj === 'object') { const o = {}; for (const k of Object.keys(obj)) o[k] = deepRestoreLatex(obj[k]); return o; }
  return restoreLatexControl(obj);
}

// Indexul variantei corecte la o grilă cu `n` opțiuni: întreg (0..n-1) sau
// literă („b", „B)") → index; orice altceva → null (itemul se respinge).
// Înainte, `Number("b") || 0` transforma tăcut litera în indexul 0 → cheie greșită.
function answerIndex(v, n) {
  if (Number.isInteger(v)) return v >= 0 && v < n ? v : null;
  const s = String(v ?? '').trim();
  if (/^\d+$/.test(s)) { const i = parseInt(s, 10); return i >= 0 && i < n ? i : null; }
  const m = /^([a-d])\)?$/i.exec(s);
  if (m) { const i = m[1].toLowerCase().charCodeAt(0) - 97; return i < n ? i : null; }
  return null;
}

// Parsare JSON tolerantă: JSON.parse → fără ```json``` → backslash-uri LaTeX
// dublate → JSON trunchiat închis (claude.extractJson). null dacă nu se poate.
function parseJsonLoose(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* mai jos */ }
  try { return require('./claude').extractJson(s); } catch { return null; }
}

// ─── chatJson: apel LLM cu răspuns JSON (schemă strictă sau json_object) ─────
// Întoarce { data, text, usage, structured } — `data` e obiectul parsat, cu
// LaTeX-ul restaurat (deepRestoreLatex). Dacă răspunsul nu se poate parsa,
// reîncearcă O dată cu un avertisment; dacă tot nu, aruncă eroare 502 (apelantul
// întoarce mesajul lui „mai încearcă"). `refusal` (Structured Outputs) → 502.
async function chatJson(opts) {
  const usage = { in: 0, out: 0, model: opts.model || CHAT_MODEL };
  try {
    return await chatJsonInner(opts, usage);
  } catch (e) {
    // tokenii consumați până la eroare rămân logabili de apelant (e.usage)
    if (e && typeof e === 'object' && !e.usage) e.usage = usage;
    throw e;
  }
}
async function chatJsonInner({ system, messages = [], schema = null, schemaName = 'raspuns', temperature = 0.3, maxTokens = 1500, model = CHAT_MODEL, restoreLatex = true, reasoningEffort = undefined }, usage) {
  if (!hasChat()) throw new Error('AI_CHAT_API_KEY (sau OPENAI_API_KEY) nu este setat.');
  const body = buildBody({ model, temperature, maxTokens, messages, system, json: true, schema, schemaName, ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) });
  const once = async () => {
    const r = await postLLM(body);
    const data = await r.json();
    const choice = data.choices?.[0] || {};
    usage.in += data.usage?.prompt_tokens || 0;
    usage.out += data.usage?.completion_tokens || 0;
    if (choice.message?.refusal) {
      const e = new Error(`Modelul a refuzat cererea: ${String(choice.message.refusal).slice(0, 200)}`);
      e.status = 502; throw e;
    }
    return { text: choice.message?.content ?? '', finish: choice.finish_reason || '' };
  };
  let { text, finish } = await once();
  // răspuns gol/trunchiat la modelele cu raționament → buget maxim, o dată
  if ((!String(text).trim() || finish === 'length') && isNewGenModel(model) && (body.max_completion_tokens || 0) < 16000) {
    console.warn(`chatJson: răspuns ${String(text).trim() ? 'trunchiat' : 'gol'} la ${model} (finish=${finish}) — reîncerc cu buget maxim`);
    body.max_completion_tokens = 16000;
    ({ text, finish } = await once());
  }
  let parsed = parseJsonLoose(text);
  if (parsed == null) {
    // o singură reîncercare, cu avertisment explicit
    body.messages = [...body.messages, { role: 'assistant', content: String(text).slice(0, 4000) },
      { role: 'user', content: 'Răspunsul anterior NU a fost JSON valid. Răspunde STRICT cu obiectul JSON cerut, fără alt text și fără markdown.' }];
    ({ text, finish } = await once());
    parsed = parseJsonLoose(text);
  }
  if (parsed == null) {
    const e = new Error('Modelul a returnat un format invalid. Mai încearcă o dată.');
    e.status = 502; throw e;
  }
  return {
    data: restoreLatex ? deepRestoreLatex(parsed) : parsed,
    text, usage,
    structured: body.response_format?.type === 'json_schema',
  };
}

// ─── Apel LLM în STREAMING (async generator de fragmente text) ───────────────
// `stats` (opțional): un obiect al apelantului pe care generatorul îl umple cu
// { model, usage:{in,out,model} } — usage-ul REAL vine în ultimul chunk SSE
// (stream_options.include_usage); dacă providerul nu-l trimite, rămâne doar
// `model`, iar apelantul estimează tokenii.
async function* chatStream({ system, messages = [], temperature = 0.5, maxTokens = 900, model = CHAT_MODEL, stats = null, reasoningEffort = undefined, tools = null }) {
  if (!hasChat()) throw new Error('AI_CHAT_API_KEY (sau OPENAI_API_KEY) nu este setat.');
  if (stats) stats.model = model;
  const body = buildBody({ model, temperature, maxTokens, messages, system, stream: true, tools, ...(reasoningEffort !== undefined ? { reasoningEffort } : {}) });
  const addUsage = (u) => {
    if (!stats || !u) return;
    const prev = stats.usage || { in: 0, out: 0, model };
    stats.usage = { in: prev.in + (u.prompt_tokens || 0), out: prev.out + (u.completion_tokens || 0), model };
  };
  // O rundă de stream: yield-uiește textul; întoarce { finish, text, toolCalls }
  // (apelurile de unelte sosesc pe bucăți: index → {id, name, arguments})
  async function* oneRound() {
    const r = await postLLM(body);
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let finish = null, text = '';
    const calls = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') { return { finish, text, calls }; }
        try {
          const json = JSON.parse(data);
          if (json.usage) addUsage(json.usage);
          const choice = json.choices?.[0];
          if (!choice) continue;
          if (choice.finish_reason) finish = choice.finish_reason;
          const delta = choice.delta || {};
          if (delta.content) { text += delta.content; yield delta.content; }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const i = tc.index ?? calls.length;
              calls[i] = calls[i] || { id: null, name: '', arguments: '' };
              if (tc.id) calls[i].id = tc.id;
              if (tc.function?.name) calls[i].name += tc.function.name;
              if (tc.function?.arguments) calls[i].arguments += tc.function.arguments;
            }
          }
        } catch { /* keepalive/parțial — ignorăm */ }
      }
    }
    return { finish, text, calls };
  }
  for (let round = 0; round <= TOOL_ROUNDS; round++) {
    const gen = oneRound();
    let res;
    while (true) { const n = await gen.next(); if (n.done) { res = n.value; break; } yield n.value; }
    const calls = (res?.calls || []).filter((c) => c && c.name);
    if (!body.tools || !calls.length) return;
    // runda de unelte: mesajul de asistent (cu apelurile) + rezultatele
    const toolCalls = calls.map((c, i) => ({ id: c.id || `call_${round}_${i}`, type: 'function', function: { name: c.name, arguments: c.arguments || '{}' } }));
    body.messages.push({ role: 'assistant', content: res.text || null, tool_calls: toolCalls });
    for (const call of toolCalls) body.messages.push(await runToolCall(tools, call, stats));
    if (round >= TOOL_ROUNDS - 1) { delete body.tools; delete body.tool_choice; } // ultima rundă: doar răspuns
  }
}

// ─── Tool calling (Etapa 3, 3.2): rularea unui apel de unealtă ──────────────
// Întoarce mesajul `tool` (format OpenAI) cu rezultatul JSON; erorile de
// rulare se întorc modelului ca { error } — nu pică răspunsul.
const TOOL_ROUNDS = Math.max(1, parseInt(process.env.AI_TOOL_ROUNDS || '4', 10));
async function runToolCall(tools, call, stats = null) {
  const name = call?.function?.name || '';
  const tool = (tools || []).find((t) => t.name === name);
  let args = {};
  try { args = JSON.parse(call?.function?.arguments || '{}'); } catch { args = {}; }
  let result;
  try {
    result = tool ? await tool.run(args || {}) : { error: `unealta „${name}" nu există` };
  } catch (e) { result = { error: String(e && e.message || e).slice(0, 200) }; }
  if (stats) (stats.tools = stats.tools || []).push({ name, args, ok: !(result && result.error) });
  return { role: 'tool', tool_call_id: call.id, content: JSON.stringify(result ?? null).slice(0, 6000) };
}

// ─── Apel LLM cu VEDERE (foto-rezolvare: citește o imagine) ──────────────────
async function chatVision({ system, text, imageDataUrl, maxTokens = 800, temperature = 0.1 }) {
  if (!hasChat()) throw new Error('AI_CHAT_API_KEY (sau OPENAI_API_KEY) nu este setat.');
  const messages = [
    { role: 'user', content: [
      { type: 'text', text: text || 'Transcrie exercițiul din imagine.' },
      { type: 'image_url', image_url: { url: imageDataUrl } },
    ] },
  ];
  const body = buildBody({ model: VISION_MODEL, temperature, maxTokens, messages, system });
  const r = await postLLM(body);
  const data = await r.json();
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    usage: { in: data.usage?.prompt_tokens || 0, out: data.usage?.completion_tokens || 0, model: VISION_MODEL },
  };
}

// ─── Embeddings (acceptă string sau listă) ───────────────────────────────────
async function embed(input) {
  if (!hasEmbeddings()) return null;
  const arr = Array.isArray(input) ? input : [input];
  const body = { model: EMBED_MODEL, input: arr };
  if (EMBED_MODEL.startsWith('text-embedding-3')) body.dimensions = EMBED_DIM;
  const r = await fetch(`${EMBED_BASE}/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${EMBED_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Embeddings ${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json();
  const vectors = data.data.map((d) => d.embedding);
  return Array.isArray(input) ? vectors : vectors[0];
}

// ─── Speech-to-text (Whisper) — fallback STT pe server ───────────────────────
const hasSTT = () => !!STT_KEY;
async function transcribe({ audioBuffer, mime = 'audio/webm', language = 'ro' }) {
  if (!hasSTT()) throw new Error('STT neconfigurat (lipsește cheia).');
  const form = new FormData();
  form.append('file', new Blob([audioBuffer], { type: mime }), 'audio.webm');
  form.append('model', STT_MODEL);
  if (language) form.append('language', language);
  const r = await fetch(`${STT_BASE}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${STT_KEY}` }, // fetch setează singur Content-Type multipart
    body: form,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`STT ${r.status}: ${t.slice(0, 200)}`);
  }
  const data = await r.json().catch(() => ({}));
  return data.text || '';
}

// ─── Notificări (cu dedup pe interval) ───────────────────────────────────────
async function createNotification(supa, { recipientId, type = 'info', title, body = null, data = {}, dedupeKey = null, dedupeDays = 7 }) {
  if (!recipientId) return false;
  if (dedupeKey) {
    const since = new Date(Date.now() - dedupeDays * 86400 * 1000).toISOString();
    const { data: existing } = await supa.from('ai_notifications')
      .select('id').eq('recipient_id', recipientId).eq('dedupe_key', dedupeKey)
      .gte('created_at', since).limit(1);
    if (existing && existing.length) return false; // deja notificat recent
  }
  await supa.from('ai_notifications').insert({ recipient_id: recipientId, type, title, body, data, dedupe_key: dedupeKey });
  return true;
}

// Profesorii unui elev (pentru alerte). Include și asocierea veche teacher_id.
async function teachersOf(supa, studentId) {
  const ids = new Set();
  const { data: links } = await supa.from('mentor_students')
    .select('mentor_id').eq('student_id', studentId).eq('mentor_role', 'profesor');
  (links || []).forEach((l) => ids.add(l.mentor_id));
  const { data: prof } = await supa.from('profiles').select('teacher_id').eq('id', studentId).single();
  if (prof?.teacher_id) ids.add(prof.teacher_id);
  return [...ids];
}

// Toți mentorii (profesori ȘI părinți) asociați unui elev — pentru notificări.
async function mentorsOf(supa, studentId) {
  const ids = new Set();
  const { data: links } = await supa.from('mentor_students')
    .select('mentor_id').eq('student_id', studentId);
  (links || []).forEach((l) => ids.add(l.mentor_id));
  const { data: prof } = await supa.from('profiles').select('teacher_id').eq('id', studentId).single();
  if (prof?.teacher_id) ids.add(prof.teacher_id);
  return [...ids];
}

// ─── Recuperare context (RAG): CĂUTARE HIBRIDĂ (Etapa 3, 1.5) ───────────────
// Vectorial + lexical, combinate prin RRF în match_ai_knowledge_hybrid
// (supabase/ai_rag_v2.sql). Fără migrarea v2 se recade pe cele două funcții
// vechi (vector, apoi lexical) — comportamentul de dinainte.
// Boost pe tip de sursă, în funcție de scop (MULTIPLICATIV: scorul RRF are altă
// scară decât similaritatea cosinus, o adunare l-ar domina):
//  prefer='solution' (explicații în chat) → barem/rezolvări primele
//  prefer='exercise' (generare) → exercițiile-model primele
const SOURCE_BOOST = {
  solution: { solution: 0.20, exercise: 0.05, manual: 0.02 },
  exercise: { exercise: 0.16, solution: 0.08, manual: 0.03 },
};
// prag de similaritate pentru candidații DOAR vectoriali (fără potrivire lexicală)
const RAG_MIN_SIM = parseFloat(process.env.AI_RAG_MIN_SIM || '0.25');
// Migrarea nerulată → nu mai încercăm hibridul la fiecare cerere. Latch-ul se
// pune DOAR pe „funcția nu există"; o eroare trecătoare (timeout, 5xx) nu
// trebuie să coboare căutarea pe varianta veche pentru toată instanța.
let hybridOff = false;
const RPC_MISSING_RE = /does not exist|schema cache|PGRST\d*20|42883|could not find/i;

async function retrieve(supa, { query, category = null, allowPremium = false, k = 6, prefer = null, chapterId = null, minSimilarity = RAG_MIN_SIM }) {
  if (!query || !query.trim()) return [];
  const fetchN = Math.min(k * 3, 24);
  const q = String(query).slice(0, 2000);
  let docs = [];
  let qvec = null;
  let hybridOk = false; // hibridul a răspuns (chiar și cu 0 rezultate)
  if (hasEmbeddings()) {
    try { qvec = await embed(q); } catch (e) { console.warn('embed(query) a eșuat:', e.message); }
  }
  // 1. HIBRID (vector + lexical, RRF)
  if (!hybridOff) {
    try {
      const { data, error } = await supa.rpc('match_ai_knowledge_hybrid', {
        query_embedding: qvec || null, query_text: q, match_count: fetchN,
        filter_category: category, allow_premium: allowPremium,
        filter_chapter: chapterId || null, min_similarity: minSimilarity,
      });
      if (error) throw new Error(error.message);
      docs = data || [];
      hybridOk = true;
    } catch (e) {
      if (RPC_MISSING_RE.test(String(e.message || ''))) {
        warnOnce('rag_hybrid', `Căutarea hibridă nu e disponibilă (${e.message}) — rulează supabase/ai_rag_v2.sql; folosesc căutarea veche.`);
        hybridOff = true;
      } else {
        console.warn('retrieve: căutarea hibridă a eșuat de data asta (%s) — folosesc căutarea veche', e.message);
      }
      docs = [];
    }
  }
  // 2. Fără hibrid (migrare lipsă sau eroare trecătoare): vectorial, apoi lexical.
  //    Un hibrid care a răspuns cu 0 rezultate NU se reia — chiar nu există nimic.
  if (!hybridOk) {
    if (qvec) {
      try {
        const { data, error } = await supa.rpc('match_ai_knowledge', {
          query_embedding: qvec, match_count: fetchN, filter_category: category, allow_premium: allowPremium,
        });
        if (!error && data) docs = data;
      } catch (e) { console.warn('Vector retrieve failed, fallback lexical:', e.message); }
    }
    if (!docs.length) {
      try {
        const { data, error } = await supa.rpc('match_ai_knowledge_lexical', {
          query_text: q, match_count: fetchN, filter_category: category, allow_premium: allowPremium,
        });
        if (!error && data) docs = data;
      } catch (e) { console.warn('Lexical retrieve failed:', e.message); }
    }
  }
  if (!docs.length) return [];
  // Re-ranking după scop (barem vs exercițiu-model)
  const boost = SOURCE_BOOST[prefer] || {};
  return docs
    .map((d) => ({ ...d, _score: (d.score != null ? d.score : (d.similarity || 0)) * (1 + (boost[d.source_type] || 0)) }))
    .sort((a, b) => b._score - a._score)
    .slice(0, k);
}

// Rută de vizualizare în funcție de categorie
function routeForCategory(cat) {
  if (!cat) return '/';
  if (cat.startsWith('clasa-')) return `/clase/${cat.replace('clasa-', '')}`;
  if (cat === 'evaluare-nationala') return '/evaluare-nationala';
  if (cat === 'bacalaureat') return '/bacalaureat';
  if (cat === 'manuale') return '/manuale';
  return '/';
}

// Alege cel mai relevant MATERIAL real din rezultate și construiește un link către el.
async function topMaterial(supa, docs) {
  if (!docs || !docs.length) return null;
  const doc = docs.find((d) => d.source_id && ['exercise', 'manual', 'solution'].includes(d.source_type));
  if (!doc) return null;
  if (doc.source_type === 'solution') {
    return { title: doc.title || 'Rezolvare model', url: '/rezolvari', type: 'rezolvare', category: doc.category };
  }
  try {
    const { data: c } = await supa.from('content')
      .select('id, title, content_type, category, is_free').eq('id', doc.source_id).single();
    if (c) {
      let url;
      if (c.content_type === 'pdf') url = `/pdf-viewer?id=${c.id}`;
      else if (c.content_type === 'interactive') url = `/exercitiu?id=${c.id}`;
      else if (c.content_type === 'manual') url = '/manuale';
      else url = routeForCategory(c.category);
      return { title: c.title || doc.title || 'Material', url, type: c.content_type, category: c.category, is_free: c.is_free };
    }
  } catch { /* fallback mai jos */ }
  return { title: doc.title || 'Material', url: routeForCategory(doc.category), type: doc.source_type, category: doc.category };
}

// ─── Formatează contextul recuperat pentru prompt ────────────────────────────
function contextBlock(docs) {
  if (!docs || !docs.length) return 'Nu am găsit materiale relevante în baza de date.';
  const labels = { exercise: 'Exercițiu', solution: 'Rezolvare model', manual: 'Manual', theory: 'Teorie', faq: 'Întrebare frecventă' };
  return docs.map((d, i) => {
    const head = `[${i + 1}] (${labels[d.source_type] || d.source_type}${d.topic ? ' · ' + d.topic : ''}${d.category ? ' · ' + d.category : ''})`;
    return `${head}\n${(d.title ? d.title + ' — ' : '')}${(d.content || '').slice(0, 1700)}`;
  }).join('\n\n');
}

// ─── Persona + reguli ale tutorelui (română) ─────────────────────────────────
const PERSONA = `Ești "Profesorul Virtual" de pe ExamenMate, un profesor de matematică român, calm, încurajator și răbdător, pentru elevi de clasele 5–12, Evaluare Națională și Bacalaureat.
Reguli:
- Răspunzi DOAR în limba română, clar și la nivelul elevului.
- Te bazezi pe MATERIALELE DIN CONTEXT pentru stilul de explicație, notații și tipurile de exerciții. Dacă în context apar exemple, urmează-le stilul.
- Scrii formulele în LaTeX: între $...$ pentru inline și $$...$$ pe rând separat. Exemple: $x^2$, $\\frac{a}{b}$, $\\sqrt{2}$, $\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$. Restul textului rămâne în română normală. IMPORTANT: conținutul dintre $$...$$ stă pe UN SINGUR rând, fără Enter în interior. Încadrezi ÎNTREAGA expresie matematică între $...$ — corect: $4(10)^3 = 4000$; GREȘIT: 4(10$)^3$ = 4000 sau 10$^3$ (niciodată „$" în mijlocul unei expresii ori doar în jurul exponentului). Folosește NUMAI delimitatorii $...$ și $$...$$ — NICIODATĂ \\[...\\] sau \\(...\\).
- RELAȚIILE LUI VIÈTE: la problemele cu rădăcinile $x_1, x_2, x_3, \\dots$ ale unui polinom (sume, produse, expresii simetrice precum $x_1+x_2+x_3$, $x_1 x_2 x_3$, $x_1^2+x_2^2+\\dots$, $\\frac{1}{x_1}+\\frac{1}{x_2}+\\dots$), folosești relațiile lui Viète: scrii ÎNTÂI relațiile pentru polinomul dat (cu semnele corecte: $x_1+x_2+\\dots = -\\frac{a_{n-1}}{a_n}$ etc.), apoi exprimi cerința prin ele. NU calcula rădăcinile explicit decât dacă problema o cere sau descompunerea e evidentă.
- Linkurile către paginile site-ului le scrii mereu RELATIVE, în format markdown: [Titlu](/cale) — ex: [Evaluare Națională](/evaluare-nationala). NICIODATĂ cu domeniu; adresa „examenmate.ro" NU există.
- Explici pas cu pas, numerotat, cu un exemplu scurt când ajută.
- Nu inventezi formule sau rezultate; dacă nu ești sigur, spui sincer și explici metoda generală. Nu inventezi surse.
- Terminologie școlară românească: spune întotdeauna „descompunere în factori" / „a descompune în factori" — NU folosi niciodată cuvântul „factorizare" sau verbul „a factoriza".
- Adresa oficială a platformei este https://examenmate.com — dacă o menționezi, folosește EXACT această adresă (nu .ro, nu altă terminație).
SIGURANȚĂ (vorbești cu minori):
- Rămâi STRICT pe teme educaționale (matematică și folosirea platformei). Refuzi politicos orice subiect nepotrivit, periculos sau fără legătură cu școala și readuci discuția la învățare.
- Folosești limbaj potrivit vârstei, fără conținut nepotrivit.
- Scopul tău e ca elevul să ÎNVEȚE: la teme îl ghidezi spre soluție prin pași și întrebări, nu îi dai pur și simplu răspunsul de copiat.`;

// Hartă de linkuri interne — ca Asistentul (profesor/părinte) să trimită la locul corect.
const SITE_MAP = `LINKURI INTERNE utile (folosește-le ca link-uri relative în răspuns):
- Evaluare Națională (subiecte, variante, bareme, simulări): /evaluare-nationala
- Bacalaureat: /bacalaureat  (Mate-Info: /bacalaureat/mate-info · Științele Naturii: /bacalaureat/stiinte-naturii · Tehnologic: /bacalaureat/tehnologic)
- Auxiliare / manuale: /manuale
- Blog / Rezolvări / Teorie (rezolvări video/PDF, articole, teorie): /rezolvari
- Biblioteca utilizatorilor (teste publice ale profesorilor): /biblioteca-utilizatorilor
- Clasele 5–12: /clase/5 … /clase/12
- Contul tău — rezultatele elevilor asociați, RAPORTUL AI pe subiecte, grupe și codul de asociere: /profil
- Asistentul AI / generare de subiecte și exerciții: /profesor-virtual`;

// Recomandare activă pentru ELEVI: testele și exercițiile interactive din site.
const STUDENT_TIP = `RECOMANDARE ACTIVĂ (pentru elevi): când elevul cere ajutor la învățat, la exersat sau la pregătirea pentru un examen, un test sau o lucrare (ex. „vreau să învăț fracțiile", „cum mă pregătesc pentru Evaluare?", „dă-mi exerciții"), pe lângă explicația ta, RECOMANDĂ-I testele și exercițiile INTERACTIVE de pe site: spune-i că acolo se verifică pe loc, primește REZOLVĂRI IMEDIATE și EXPLICAȚII la fiecare întrebare, și vede instant ce a greșit. Dă link-ul intern potrivit (relativ):
- Evaluare Națională (secțiunea „Teste Interactive"): /evaluare-nationala
- Bacalaureat (pe profilul lui): /bacalaureat
- Clasa lui (a 5-a … a 12-a): /clase/5 … /clase/12
- Teste publicate de profesori: /biblioteca-utilizatorilor
- Exerciții interactive generate pe loc, pe subiectul dorit: /profesor-virtual (tabul „Generează interactiv")
Fă recomandarea natural, într-o singură frază sau două la finalul răspunsului, legată de subiectul cerut — nu transforma răspunsul în reclamă și nu o repeta la fiecare mesaj din aceeași conversație.`;

// Persona pentru PROFESORI și PĂRINȚI (public adult, ton colegial).
const MENTOR_PERSONA = `Ești „Asistentul AI" de pe ExamenMate, pentru PROFESORI și PĂRINȚI. Ești un coleg calm, clar și practic.
Reguli:
- Răspunzi în limba română.
- Poți răspunde la: (a) matematică (explicații, verificări, idei de exerciții); (b) folosirea platformei și navigarea (UNDE se găsesc materialele, cu LINK-uri interne); (c) elevii asociați (unde se văd rezultatele lor și RAPORTUL AI pe subiecte, cum asociezi un elev prin cod, grupe, ce teme le poți trimite); (d) idei de planuri de lecție și structura examenelor (Evaluare Națională, Bacalaureat).
- Când spui unde se găsește ceva, dă LINK-ul intern RELATIV, în format markdown: [Titlu](/cale) — ex: [Evaluare Națională](/evaluare-nationala). NICIODATĂ cu domeniu; adresa „examenmate.ro" NU există.
- Formulele în LaTeX: $...$ inline, $$...$$ pe rând separat; conținutul dintre $$...$$ stă pe UN SINGUR rând, fără Enter în interior.
- Terminologie școlară: „descompunere în factori", NU „factorizare".
- Nu inventezi date despre elevi anume; pentru cifre exacte trimite la raportul din /profil. Rămâi pe teme educaționale și de platformă.`;

// Rolurile pe moduri — folosite de AMBII agenți (interactiv și PDF).
const MODE_ROLES = {
  assistant: 'Rol: asistent al platformei. Ajuți cu întrebări despre matematică ȘI despre folosirea site-ului (exerciții, abonament, rezolvări). Răspunsuri scurte și utile.',
  tutor: 'Rol: profesor. Explică pas cu pas, cu un exemplu scurt, apoi verifică înțelegerea printr-o întrebare. Încurajează elevul.',
  explain: 'Rol: explică TEORIA subiectului cerut, structurat: definiție → idee cheie → formulă → un exemplu rezolvat scurt. Folosește stilul din context.',
  hint: 'Rol: dai UN SINGUR indiciu pentru pasul următor. NU dezvălui rezolvarea completă și NU da răspunsul final. Termină cu o întrebare care îl ghidează pe elev mai departe.',
  exams: 'Rol: ajuți profesorul/părintele cu EXAMENELE (Evaluare Națională, Bacalaureat): unde sunt subiectele, variantele, baremele și simulările, structura probelor, idei de plan de lecție. Dă pași scurți și LINK-uri interne. Poți răspunde și la matematică.',
  students: 'Rol: ajuți cu ELEVII asociați: unde vezi rezultatele lor și RAPORTUL AI pe subiecte (în /profil), cum asociezi un elev prin cod, cum folosești grupele și ce teme le poți trimite. Dă pași clari și LINK-uri interne.',
};

// Ordinea e gândită pentru PROMPT CACHING la furnizor (OpenAI cachează AUTOMAT
// prefixele identice de ≥1024 tokeni, cu reducere mare la intrarea repetată):
// întâi TOT ce e STATIC — persona + recomandările + rolul modului, identice la
// fiecare cerere cu același mod (~1050-1100 tokeni la elevi) — și abia apoi
// partea VARIABILĂ (contextul RAG al întrebării + detaliile cererii).
// NU muta contextul RAG înapoi înaintea rolului: ar sparge prefixul cacheabil
// imediat după persona și pierzi reducerea. (Vezi GHID_LIMITE_AI.md, pasul 3.)
function systemFor(mode, ctxBlock, extra = '') {
  const mentor = mode === 'exams' || mode === 'students';
  const persona = mentor ? MENTOR_PERSONA : PERSONA;
  const staticPrefix = `${persona}\n\n${mentor ? SITE_MAP : STUDENT_TIP}\n\n${MODE_ROLES[mode] || MODE_ROLES.tutor}`;
  return `${staticPrefix}\n\n=== MATERIALE DIN BAZA DE DATE (context RAG) ===\n${ctxBlock}\n=== SFÂRȘIT CONTEXT ===\n${extra}`.trim();
}

// ─── Acces & utilizatori ─────────────────────────────────────────────────────
async function requireUser(supa, userId) {
  if (!userId) { const e = new Error('userId obligatoriu'); e.status = 400; throw e; }
  const { data, error } = await supa.from('profiles').select('id, subscription_status, role, is_admin').eq('id', userId).single();
  if (error || !data) { const e = new Error('Utilizator negăsit'); e.status = 401; throw e; }
  return data;
}
const isPremium = (p) => p?.subscription_status === 'active';

// Eroare „ai nevoie de abonament" (folosită pentru gating).
function premiumError(msg) {
  const e = new Error(msg || 'Această funcție face parte din abonament. Abonează-te pentru acces la Profesorul Virtual.');
  e.status = 402; e.code = 'PREMIUM_REQUIRED';
  return e;
}
function requirePremium(profile) {
  if (!isPremium(profile)) throw premiumError();
}
// Utilizatorii fără abonament au voie la un număr limitat de acțiuni AI (default 1).
async function enforceFreeQuota(supa, profile) {
  if (isPremium(profile)) return;
  const { count } = await supa.from('ai_usage').select('*', { count: 'exact', head: true }).eq('user_id', profile.id);
  if ((count || 0) >= FREE_ACTIONS) {
    throw premiumError(`Ai folosit cele ${FREE_ACTIONS} acțiuni gratuite cu Profesorul Virtual. Abonează-te pentru acces nelimitat (explicații, exerciții, foto-rezolvare, voce și teste de examen).`);
  }
}

// Limitele de consum, în ordinea severității:
//   1. rata orară (anti-abuz, ca înainte)
//   2. bugetul lunar hard (30 de zile rulante) → blocare
//   3. bugetul zilnic hard → blocare până a doua zi
//   4. bugetul zilnic soft → NU blochează: întoarce { degraded:true }, iar
//      endpoint-urile aleg un model mai ieftin prin ai.pickModel(...)
// `profile` e opțional (compatibil cu apelurile vechi); cu el, adminul e scutit
// de bugete (rata orară rămâne). Întoarce starea limitelor.
async function enforceRateLimit(supa, userId, profile = null) {
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count } = await supa.from('ai_usage').select('*', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', since);
  if ((count || 0) >= RATE_PER_HOUR) {
    const e = new Error(`Ai atins limita de ${RATE_PER_HOUR} cereri AI pe oră. Încearcă din nou mai târziu.`);
    e.status = 429; e.code = 'RATE_HOUR'; throw e;
  }
  return enforceBudgets(supa, userId, profile);
}

// Sumele consumate (azi / ultimele 30 de zile) + creditul top-up activ.
// Încearcă `ai_spent2` (cu top-up; migrarea ai_topup.sql), apoi `ai_spent`
// (fără top-up; migrarea ai_limite_cost.sql). Nimic rulat → null (nu blocăm).
async function budgetSpent(supa, userId) {
  const args = {
    p_user: userId,
    p_day_start: dayStartBucharest(),
    p_month_start: new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString(),
  };
  for (const fn of ['ai_spent2', 'ai_spent']) {
    try {
      const { data, error } = await supa.rpc(fn, args);
      if (error) throw new Error(error.message || 'rpc error');
      const row = Array.isArray(data) ? data[0] : data;
      if (row && row.month_micro != null) {
        if (row.topup_micro == null) { // varianta veche, fără top-up
          row.topup_micro = 0; row.topup_expires = null;
          warnOnce('ai_spent2', 'Pachetele top-up inactive — rulează supabase/ai_topup.sql (funcția ai_spent2 lipsește).');
        }
        return row;
      }
    } catch (e) {
      if (fn === 'ai_spent') {
        warnOnce('ai_spent', `Bugetele AI inactive — funcția SQL ai_spent lipsește (rulează supabase/ai_limite_cost.sql). Detaliu: ${e.message}`);
      }
    }
  }
  return null;
}

const budgetsEnabled = () => BUDGET_DAY_SOFT_LEI > 0 || BUDGET_DAY_HARD_LEI > 0 || BUDGET_MONTH_LEI > 0;
const isBudgetExempt = (profile) => !!(profile && (profile.is_admin || profile.role === 'admin'));

async function enforceBudgets(supa, userId, profile = null) {
  const state = {
    degraded: false, dayLei: 0, monthLei: 0, topupLei: 0, topupActive: false, topupExpires: null,
    effectiveMonthLei: BUDGET_MONTH_LEI,
    limits: { daySoftLei: BUDGET_DAY_SOFT_LEI, dayHardLei: BUDGET_DAY_HARD_LEI, monthLei: BUDGET_MONTH_LEI },
  };
  if (!budgetsEnabled() || isBudgetExempt(profile)) return state;
  const spent = await budgetSpent(supa, userId);
  if (!spent) return state; // migrarea nu e rulată → comportamentul de dinainte
  state.dayLei = (spent.day_micro || 0) / 1e6;
  state.monthLei = (spent.month_micro || 0) / 1e6;
  state.topupLei = (spent.topup_micro || 0) / 1e6;
  state.topupExpires = spent.topup_expires || null;
  // Pachetele top-up MĂRESC bugetul lunar pe durata valabilității lor.
  state.effectiveMonthLei = BUDGET_MONTH_LEI > 0 ? BUDGET_MONTH_LEI + state.topupLei : 0;
  // „Pachet activ" = mai există credit de acoperit (elevul a plătit pentru
  // capacitate suplimentară) → degradarea pe model ieftin NU se aplică,
  // iar cotele incluse per funcție se sar (vezi enforceFeatureQuota).
  state.topupActive = state.topupLei > 0 && (state.effectiveMonthLei === 0 || state.monthLei < state.effectiveMonthLei);
  if (state.effectiveMonthLei > 0 && state.monthLei >= state.effectiveMonthLei) {
    const packs = topupPacks();
    const e = new Error('Ai folosit bugetul de AI inclus în abonament pe această lună. Se eliberează treptat, pe măsură ce trec zilele (fereastră de 30 de zile).' +
      (packs.length ? ' Poți continua imediat cu un pachet AI suplimentar, din Contul meu → „⚡ Consum AI".' : ' Restul platformei funcționează normal.'));
    e.status = 429; e.code = 'BUDGET_MONTH'; throw e;
  }
  if (BUDGET_DAY_HARD_LEI > 0 && state.dayLei >= BUDGET_DAY_HARD_LEI && !state.topupActive) {
    const e = new Error('Ai atins limita zilnică de utilizare AI. Se resetează la miezul nopții — te așteptăm mâine!');
    e.status = 429; e.code = 'BUDGET_DAY'; throw e;
  }
  if (BUDGET_DAY_SOFT_LEI > 0 && state.dayLei >= BUDGET_DAY_SOFT_LEI && !state.topupActive) state.degraded = true;
  return state;
}

// Cota inclusă a unei funcții scumpe (corectări / teste / interactive / foto).
// Se aplică DOAR utilizatorilor fără pachet top-up activ și fără scutire.
// Cotele LUNARE formează un POOL comun (limita reală = suma lor; depășirea
// uneia „transferă" din rezerva celorlalte); foto are cotă ZILNICĂ separată.
// Aruncă 429 cu code='QUOTA_FEATURE' și feature=<cheia> când nu mai e loc.
async function enforceFeatureQuota(supa, userId, profile, featureKey, lim = null) {
  const q = FEATURE_QUOTAS[featureKey];
  if (!q) return;
  if (isBudgetExempt(profile)) return;
  if (lim && lim.topupActive) return; // pachet plătit → cotele incluse nu limitează
  const quotas = quotasForRole(profile && profile.role);
  const packs = topupPacks();
  const hint = packs.length ? ' Poți continua imediat cu un pachet AI suplimentar, din Contul meu → „⚡ Consum AI".' : ' Cota se eliberează pe măsură ce trec zilele.';

  // ── Fereastra ZILNICĂ (foto) — cotă proprie, fără pool ──
  if (q.window === 'day') {
    const limit = quotas[featureKey];
    if (!(limit > 0)) return; // dezactivată pentru acest rol
    const { count, error } = await supa.from('ai_usage').select('*', { count: 'exact', head: true })
      .eq('user_id', userId).eq('endpoint', q.endpoint).gte('created_at', dayStartBucharest());
    if (error) { warnOnce(`quota:${featureKey}`, `enforceFeatureQuota(${featureKey}): ${error.message}`); return; }
    if ((count || 0) >= limit) {
      const e = new Error(`Ai folosit toate cele ${limit} „${q.label.toLowerCase()}" incluse azi. Se resetează la miezul nopții.${hint}`);
      e.status = 429; e.code = 'QUOTA_FEATURE'; e.feature = featureKey; throw e;
    }
    return;
  }

  // ── Fereastra LUNARĂ → POOL comun între cotele lunare active ale rolului ──
  const activeKeys = Object.keys(FEATURE_QUOTAS)
    .filter((k) => FEATURE_QUOTAS[k].window === 'month' && quotas[k] > 0);
  if (!activeKeys.includes(featureKey)) return; // cota funcției e dezactivată pt. rol
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const endpoints = activeKeys.map((k) => FEATURE_QUOTAS[k].endpoint);
  const { data, error } = await supa.from('ai_usage').select('endpoint')
    .eq('user_id', userId).in('endpoint', endpoints).gte('created_at', since).limit(5000);
  if (error) { warnOnce(`quota:${featureKey}`, `enforceFeatureQuota(${featureKey}): ${error.message}`); return; }
  const totalUsed = (data || []).length;
  const totalLimit = activeKeys.reduce((s, k) => s + quotas[k], 0);
  if (totalUsed >= totalLimit) {
    const labels = activeKeys.map((k) => FEATURE_QUOTAS[k].label.toLowerCase()).join(' + ');
    const e = new Error(`Ai folosit toate acțiunile incluse luna aceasta (${labels} — cotele se completează între ele).${hint}`);
    e.status = 429; e.code = 'QUOTA_FEATURE'; e.feature = featureKey; throw e;
  }
  // Sub totalul pool-ului → permis. Dacă propria cotă e depășită, diferența se
  // „transferă" din rezerva celorlalte — vizibil în Contul meu → ⚡ Consum AI.
}

// Alege modelul după starea bugetului (starea = ce întoarce enforceRateLimit).
// Sub limite → modelul cerut. Peste limita zilnică soft:
//   · chatul standard coboară pe modelul economic;
//   · orice model premium (PDF/GEN etc.) coboară pe modelul standard de chat.
function pickModel(preferred, limits) {
  if (!limits || !limits.degraded) return preferred;
  return preferred === CHAT_MODEL ? ECON_CHAT_MODEL : CHAT_MODEL;
}

// Rezumat de consum pentru UI/rapoarte (nu aruncă erori, nu blochează).
// null dacă migrarea SQL nu e rulată încă.
async function budgetInfo(supa, userId, profile = null) {
  const spent = await budgetSpent(supa, userId);
  if (!spent) return null;
  const dayLei = (spent.day_micro || 0) / 1e6;
  const monthLei = (spent.month_micro || 0) / 1e6;
  const topupLei = (spent.topup_micro || 0) / 1e6;
  const effectiveMonthLei = BUDGET_MONTH_LEI > 0 ? BUDGET_MONTH_LEI + topupLei : 0;
  const exempt = isBudgetExempt(profile);
  const topupActive = !exempt && topupLei > 0 && (effectiveMonthLei === 0 || monthLei < effectiveMonthLei);

  // Consumul pe funcțiile cu cotă (o singură interogare pentru toate),
  // cu limitele ROLULUI și alocarea „transferurilor" din pool-ul lunar.
  const monthStart = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const dayStart = dayStartBucharest();
  const quotas = quotasForRole(profile && profile.role);
  const endpoints = Object.values(FEATURE_QUOTAS).map((q) => q.endpoint);
  const features = [];
  try {
    const { data } = await supa.from('ai_usage').select('endpoint, created_at')
      .eq('user_id', userId).in('endpoint', endpoints).gte('created_at', monthStart).limit(5000);
    const countFor = (endpoint, since = null) =>
      (data || []).filter((r) => r.endpoint === endpoint && (!since || r.created_at >= since)).length;

    // pool-ul lunar: alocăm depășirile pe rezerva celorlalte cote
    const monthlyKeys = Object.keys(FEATURE_QUOTAS)
      .filter((k) => FEATURE_QUOTAS[k].window === 'month' && quotas[k] > 0);
    const alloc = allocateQuotas(monthlyKeys.map((k) => ({
      key: k, used: countFor(FEATURE_QUOTAS[k].endpoint), limit: quotas[k],
    })));
    const byKey = new Map(alloc.map((a) => [a.key, a]));
    const labelOf = (k) => FEATURE_QUOTAS[k] ? FEATURE_QUOTAS[k].label : k;

    for (const [key, q] of Object.entries(FEATURE_QUOTAS)) {
      if (!(quotas[key] > 0)) continue; // cotă dezactivată pentru rol → nu apare
      if (q.window === 'day') {
        features.push({
          key, label: q.label, emoji: q.emoji, window: 'day',
          usedDay: countFor(q.endpoint, dayStart), limitDay: quotas[key],
          usedMonth: null, limitMonth: null,
        });
      } else {
        const a = byKey.get(key);
        features.push({
          key, label: q.label, emoji: q.emoji, window: 'month',
          usedMonth: a.used, limitMonth: a.limit, effUsedMonth: a.effUsed,
          borrowedIn: a.borrowedIn.map((b) => ({ ...b, fromLabel: labelOf(b.from) })),
          borrowedOut: a.borrowedOut.map((b) => ({ ...b, toLabel: labelOf(b.to) })),
          usedDay: null, limitDay: null,
        });
      }
    }
  } catch { /* doar afișare — nu blocăm */ }

  return {
    dayLei: +dayLei.toFixed(4), monthLei: +monthLei.toFixed(4),
    dayActions: spent.day_actions || 0, monthActions: spent.month_actions || 0,
    limits: { daySoftLei: BUDGET_DAY_SOFT_LEI, dayHardLei: BUDGET_DAY_HARD_LEI, monthLei: BUDGET_MONTH_LEI },
    effectiveMonthLei: +effectiveMonthLei.toFixed(4),
    topup: {
      creditLei: +topupLei.toFixed(4), credits: leiToCredits(topupLei),
      active: topupActive, expiresAt: spent.topup_expires || null, days: TOPUP_DAYS,
    },
    // creditele = aceleași cifre, în unitatea pe care o vede elevul
    creditsPerLeu: CREDITS_PER_LEU,
    creditsUsed: leiToCredits(monthLei),
    creditsTotal: leiToCredits(effectiveMonthLei),
    packs: topupPacks().map((p) => ({ ...p, credits: leiToCredits(p.creditLei) })),
    features,
    degraded: !exempt && !topupActive && BUDGET_DAY_SOFT_LEI > 0 && dayLei >= BUDGET_DAY_SOFT_LEI,
    exempt,
  };
}

// Logare consum: tokenii + modelul + costul în micro-lei. Dacă tabela nu are
// încă coloanele noi (migrarea nerulată), recade pe forma veche — logarea nu
// blochează NICIODATĂ răspunsul către elev.
async function logUsage(supa, userId, endpoint, usage = {}) {
  try {
    // Normalizează forma usage-ului. Unii provideri (Claude via claude.js/exgen)
    // întorc { prompt_tokens, completion_tokens, model/provider }, alții { in, out, model }.
    // Fără normalizare, apelurile Claude se logau cu 0 tokeni și 0 cost (model null)
    // — exact cele mai scumpe operații (generare exerciții, task-uri programate).
    const tokIn  = usage.in  != null ? usage.in  : (usage.prompt_tokens     || 0);
    const tokOut = usage.out != null ? usage.out : (usage.completion_tokens || 0);
    const model  = usage.model || usage.provider || null;
    const base = { user_id: userId, endpoint, tokens_in: tokIn, tokens_out: tokOut };
    const { error } = await supa.from('ai_usage')
      .insert({ ...base, model, cost_micro: costMicroLei(model, { in: tokIn, out: tokOut }) });
    if (error) {
      warnOnce('usage_cols', `ai_usage fără coloanele model/cost_micro? Rulează supabase/ai_limite_cost.sql. Detaliu: ${error.message}`);
      await supa.from('ai_usage').insert(base); // forma veche
    }
  } catch { /* nu blocăm răspunsul pentru logare */ }
}

// ─── Token semnat (generator efemer: păstrează răspunsul fără DB) ────────────
function signToken(payload, ttlSeconds = null) {
  // ttlSeconds (opțional): pune un `exp` (secunde unix) în token; verifyToken îl
  // respinge după expirare. Fără ttl → token fără expirare (comportament vechi).
  const data = ttlSeconds ? { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds } : payload;
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto.createHmac('sha256', SIGNING_SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', SIGNING_SECRET).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  } catch { return null; }
  let data;
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
  // dacă tokenul poartă un `exp` (secunde unix), îl respingem după expirare.
  if (data && typeof data.exp === 'number' && Date.now() / 1000 > data.exp) return null;
  return data;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ─── Nivelul elevului (după categoria materialului sau context.level) ────────
function levelLabel(context = {}) {
  const c = context.level || context.category || '';
  const map = {
    'clasa-5': 'clasa a 5-a', 'clasa-6': 'clasa a 6-a', 'clasa-7': 'clasa a 7-a', 'clasa-8': 'clasa a 8-a',
    'evaluare-nationala': 'Evaluare Națională (nivel clasa a 8-a)',
    'bacalaureat': 'Bacalaureat (nivel liceu)',
  };
  return map[c] || null;
}

// ─── Reguli pentru sesiunea cu exercițiu interactiv deschis lângă chat ────────
const INTERACTIVE_RULES = `EXERCIȚIU INTERACTIV DESCHIS: elevul are exercițiul deschis lângă chat, iar starea lui la zi (pașii, răspunsurile elevului, indicațiile oficiale și răspunsurile corecte — de dezvăluit doar la cerere explicită) este inclusă mai sus.
IDENTIFICAREA EXERCIȚIULUI: contextul include și CONȚINUTUL COMPLET AL TESTULUI (toate exercițiile, cu numerele și subiectele lor). Când elevul spune „exercițiul 3", „subiectul II, 2.b", „problema cu matricea" etc., CAUTĂ exercițiul EXACT în acest conținut și lucrează pe enunțul lui REAL — nu inventa niciodată un enunț. Dacă nu îl găsești, spune-i ce exerciții vezi în test și cere-i să confirme la care se referă.
Reguli pedagogice STRICTE pentru această sesiune:
- Implicit NU dezvălui răspunsul unui pas nerezolvat — ghidezi prin întrebări și pași mici.
- EXCEPȚIE (are prioritate): dacă elevul îți cere EXPLICIT răspunsul final (ex. „spune-mi răspunsul", „dă-mi rezultatul", „care e soluția?", „zi-mi direct cât face"), i-l dai CONCRET și complet, împreună cu TOȚI pașii rezolvării până la el, în ordine, clar și concis. La final încurajează-l scurt să încerce singur un pas sau un exercițiu asemănător. La fel după ce problema a fost corectată: explici liber rezolvarea completă.
- Pornește de la INDICAȚIA OFICIALĂ a pasului curent: reformuleaz-o natural și prietenos, ca un profesor la tablă — nu o cita mecanic. Abia dacă elevul tot nu înțelege, explică altfel, cu alt exemplu.
- Dacă elevul a greșit un pas: arată UNDE e greșeala și DE CE e greșeală, apoi sugerează metoda corectă.
- Când elevul îți cere să-i verifici pașii: confirmă ce e corect, corectează delicat ce nu e, pas cu pas.
- Răspunsuri scurte (3–8 rânduri), câte UN pas o dată; termină des cu o întrebare care îl duce mai departe.`;

// ─── Reguli pentru sesiunile de MEDITAȚII (profesor socratic + memorie) ──────
const MEDITATII_RULES = `SESIUNE DE MEDITAȚII: elevul lucrează cu tine în rubrica „Meditații cu Profesorul Virtual" — ești profesorul lui personal, care îl cunoaște și îi urmărește planul de învățare (profilul lui e mai jos).
Reguli pedagogice pentru meditații:
- PROFESOR SOCRATIC: implicit NU dai soluția direct — pui întrebări, oferi indicii pas cu pas și îl lași pe elev să descopere singur. EXCEPȚIE: dacă cere EXPLICIT răspunsul final, i-l dai complet, cu toți pașii.
- EXPLICAȚII DIFERITE: dacă elevul nu înțelege, schimbi abordarea la cerere sau din proprie inițiativă: (1) mai simplu, cu cuvinte de zi cu zi; (2) vizual, descriind un desen/o schemă; (3) prin exemple din viața reală; (4) pas cu pas, mărunt; (5) printr-o ALTĂ metodă de rezolvare. Dacă profilul elevului indică un stil preferat, începe direct cu acela.
- Îi cunoști greșelile frecvente (vezi profilul): când explici, atrage-i atenția exact asupra capcanelor unde greșește de obicei, fără să-l descurajezi.
- Leagă explicațiile de PLANUL lui: amintește-i natural la ce capitol lucrați și ce urmează; dacă cere „ce facem azi?", propune TU pasul următor din plan (teorie → exerciții → recapitulare), fără să-l întrebi ce vrea să studieze.
- TU CONDUCI MEDITAȚIA (ai inițiativa): nu aștepta să fie tras de mânecă. La primul mesaj dintr-o conversație nouă, întâmpină-l pe nume (dacă îl știi din profil), leagă-te de ultima activitate („data trecută ai greșit la...", „au trecut X zile de când...") și propune-i TU pasul de azi, în ordinea: recapitulare scadentă → greșeli de vindecat → temă nefăcută → capitolul următor. Elevul poate spune oricând „mai departe" (treci la pasul următor), „nu am înțeles", „vreau exerciții mai grele", „vreau să recapitulăm X" — și îți adaptezi imediat planul.
- PORNEȘTI PAȘII DIRECT DIN CONVERSAȚIE: când elevul ACCEPTĂ un pas concret („da", „hai", „începem", „dă-mi exercițiile", „vreau recapitularea"), emite la FINALUL răspunsului, pe un rând separat, EXACT UN marcaj (platforma îl execută automat):
[[MEDITATII:{"kind":"exercitii","chapterId":"<id>"}]] — pornește setul de exerciții la capitol
[[MEDITATII:{"kind":"lectie","chapterId":"<id>"}]] — deschide teoria capitolului
[[MEDITATII:{"kind":"recapitulare"}]] — pornește recapitularea scadentă
[[MEDITATII:{"kind":"tema"}]] — deschide tema nefăcută
[[MEDITATII:{"kind":"remediere"}]] — pornește cele 10 exerciții de remediere
[[MEDITATII:{"kind":"simulare"}]] — pornește simularea de examen (întâi TESTELE din site, generarea vine doar după epuizarea lor)
[[MEDITATII:{"kind":"plan"}]] — deschide planul, ca elevul să aleagă ALT capitol
[[MEDITATII:{"kind":"end"}]] — încheie meditația de azi și îi dă TEMĂ pentru acasă (folosește-l când elevul spune că vrea să termine/închide sau cere tema)
Reguli pentru marcaje: id-urile capitolelor sunt în PROFILUL elevului de mai jos — folosește-le EXACT; înainte de marcaj anunți natural ce urmează („Îți pregătesc acum exercițiile la Funcții — durează puțin."); NICIODATĂ marcaj fără acordul elevului din acest mesaj sau cel anterior; maximum UN marcaj pe mesaj.
- EXERCIȚIILE și SIMULĂRILE folosesc ÎNTÂI materialele interactive existente în site (nefăcute de elev încă); abia când s-au epuizat se generează altele noi, după modelul din site. Dacă elevul vrea să sară peste teorie („știu teoria", „vreau direct exerciții"), pornești direct exercițiile cu marcajul potrivit — nu-l obligi să treacă prin lecție.
- MOTIVARE: felicită-l concret pentru progres (serie de zile, capitole terminate), stabilește obiective mici și realiste.
- Rămâi cald, răbdător și încurajator — ești meditatorul lui de încredere, disponibil oricând.`;

// Profilul de meditații al elevului (memoria pedagogică) — injectat în chat.
async function meditatiiMemory(supa, userId) {
  try {
    const { data: p } = await supa.from('ai_meditatii_profile').select('*').eq('user_id', userId).maybeSingle();
    if (!p) return '';
    const bits = [];
    bits.push(`- Clasa a ${p.grade}-a${p.exam_target ? ` · se pregătește pentru ${p.exam_target === 'evaluare-nationala' ? 'Evaluarea Națională' : 'Bacalaureat (' + String(p.exam_target).replace('bac-', '') + ')'}` : ''}.`);
    if (p.level) bits.push(`- Nivel stabilit la evaluarea inițială: ${p.level}.`);
    const ch = p.plan?.chapters || [];
    if (ch.length) {
      const done = ch.filter((c) => c.status === 'finalizat').length;
      const cur = ch.find((c) => c.status === 'in_lucru' || c.status === 'teorie') || ch.find((c) => c.status === 'de_parcurs');
      bits.push(`- Plan: ${done}/${ch.length} capitole finalizate${cur ? `; capitolul curent: „${cur.title}"` : ''}.`);
      const upcoming = ch.filter((c) => c.status !== 'finalizat').slice(0, 6);
      if (upcoming.length) bits.push(`- Capitole din plan pentru marcajele MEDITATII (id → titlu): ${upcoming.map((c) => `${c.id} → ${c.title}`).join('; ')}.`);
    }
    const gaps = (p.assessment?.gaps || []).map((g) => g.title || g.chapter).filter(Boolean).slice(0, 3);
    if (gaps.length) bits.push(`- Lacune din anii anteriori: ${gaps.join('; ')}.`);
    const errs = Object.entries(p.memory?.errorTypes || {}).sort((a, b) => b[1] - a[1]).slice(0, 2);
    if (errs.length) {
      const labels = { calcul: 'greșeli de calcul', formula: 'formule aplicate greșit', concept: 'confuzii între concepte', regula: 'reguli uitate', neatentie: 'neatenție' };
      bits.push(`- Greșeli frecvente: ${errs.map(([k, v]) => `${labels[k] || k} (${v}×)`).join(', ')}.`);
    }
    if (p.memory?.styles?.preferred) bits.push(`- Stilul de explicație care funcționează cel mai bine la el: ${p.memory.styles.preferred}.`);
    // pregătirea pentru LUCRARE/TEST (focus): capitolele + data — prioritizează-le
    if (p.focus?.chapter_ids?.length) {
      const titleOf = new Map((p.plan?.chapters || []).map((c) => [c.id, c.title]));
      const names = p.focus.chapter_ids.map((id) => titleOf.get(id) || id).slice(0, 5).join('; ');
      const kindRo = { lucrare: 'o lucrare/un test din capitole', lectii: 'un test din lecții', 'test-initial': 'testul inițial (materia anului trecut)' }[p.focus.kind] || 'un test';
      bits.push(`- Se pregătește pentru ${kindRo}${p.focus.deadline ? `, cu data testului pe ${p.focus.deadline}` : ''}, din capitolele: ${names}${p.focus.chapter_ids.length > 5 ? '…' : ''} — prioritizează aceste capitole în recomandări și exerciții.${p.focus.custom ? ` Indicațiile lui: „${String(p.focus.custom).slice(0, 200)}".` : ''}`);
    }
    // pregătirea pe SUBIECTELE examenului (doar Subiectul I / II / I+II)
    if (p.exam_target && p.memory?.exam_scope) {
      const scopeRo = { s1: 'doar Subiectul I', s2: 'doar Subiectul al II-lea', s1s2: 'Subiectele I și II (fără al III-lea)' }[p.memory.exam_scope];
      if (scopeRo) bits.push(`- La pregătirea de examen și-a ales: ${scopeRo} — adaptează explicațiile, exercițiile propuse și recomandările STRICT la subiectele alese (tipurile de itemi și conținuturile lor).`);
    }
    if (p.streak_days > 1) bits.push(`- Serie de studiu: ${p.streak_days} zile consecutive (felicită-l când e cazul).`);
    if (p.last_study_date) {
      const days = Math.floor((Date.now() - new Date(p.last_study_date + 'T00:00:00').getTime()) / 86400000);
      if (days >= 2) bits.push(`- Nu a mai lucrat de ${days} zile — reia legătura cald, fără reproșuri, și propune un pas mic de reintrare.`);
    }
    try {
      const [{ data: mist }, { data: hw }, { data: revs }, { data: acc }] = await Promise.all([
        supa.from('ai_meditatii_mistakes').select('topic, error_type').eq('user_id', userId).eq('remediated', false)
          .order('created_at', { ascending: false }).limit(3),
        // temele NEFĂCUTE + cele finalizate INCOMPLET (se pot relua oricând)
        supa.from('ai_meditatii_homework').select('title, status, feedback').eq('user_id', userId)
          .in('status', ['data', 'incompleta', 'rezolvata']).order('assigned_at', { ascending: false }).limit(8),
        supa.from('ai_meditatii_reviews').select('topic, chapter, due_at, stage').eq('user_id', userId)
          .lte('due_at', new Date().toISOString()).lte('stage', 2).limit(3),
        supa.from('profiles').select('full_name').eq('id', userId).single(),
      ]);
      const firstName = (acc?.full_name || '').trim().split(/\s+/)[0];
      if (firstName) bits.unshift(`- Numele elevului: ${firstName} — adresează-i-te pe nume.`);
      if (mist && mist.length) bits.push(`- Greșeli recente neremediate la: ${[...new Set(mist.map((m) => String(m.topic || '').replace(/_/g, ' ')).filter(Boolean))].join(', ')} — propune-i „încă 10 de același fel" în rubrica Meditații.`);
      const hwPending = (hw || []).filter((h) => h.status === 'data').slice(0, 3);
      const hwIncomplete = (hw || []).filter((h) => h.status === 'incompleta' || (h.status === 'rezolvata' && h.feedback?.complete === false)).slice(0, 3);
      if (hwPending.length) bits.push(`- Teme nefăcute: ${hwPending.map((h) => `„${h.title}"`).join(', ')} — amintește-i prietenos de ele.`);
      if (hwIncomplete.length) bits.push(`- Teme finalizate INCOMPLET (nu toate problemele rezolvate; le poate relua oricând din rubrica Teme → „Reia tema"): ${hwIncomplete.map((h) => `„${h.title}"${h.feedback?.total ? ` (${h.feedback.answered ?? '?'}/${h.feedback.total} rezolvate)` : ''}`).join(', ')} — încurajează-l să le termine când are timp, fără reproșuri.`);
      if (revs && revs.length) bits.push(`- Recapitulări scadente (să nu uite materia): ${revs.map((r) => String(r.topic || r.chapter || '').replace(/_/g, ' ')).join(', ')} — propune-le TU la începutul discuției.`);
    } catch { /* ignorăm */ }
    return `PROFILUL DE MEDITAȚII AL ELEVULUI (memoria ta pedagogică — folosește-o discret, nu o recita):\n${bits.join('\n')}`;
  } catch { return ''; }
}

// ═════════════════════════════════════════════════════════════════════════════
// AGENTUL 2 — „Profesorul de teste PDF": agent DEDICAT sesiunilor cu un test
// PDF deschis lângă chat. Are persona lui și reguli proprii; agentul 1
// (exerciții interactive + chat general) rămâne pe PERSONA + INTERACTIVE_RULES,
// neschimbat. Misiunea agentului 2: citește TOT testul, găsește rezolvarea-model
// (baremul) potrivită, VERIFICĂ potrivirea și predă rezolvarea natural, pas cu
// pas — fără să pomenească vreodată cuvântul „barem" din proprie inițiativă.
// ═════════════════════════════════════════════════════════════════════════════
const PDF_PERSONA = `Ești „Profesorul Virtual" de pe ExamenMate — agentul specializat în TESTE PDF (variante de examen, fișe de lucru, culegeri). Ești un profesor de matematică român, calm, încurajator și răbdător, pentru elevi de clasele 5–12, Evaluare Națională și Bacalaureat. Elevul are testul PDF deschis lângă chat, iar textul lui este inclus mai jos.

MISIUNEA TA, în această ordine:
1. CITEȘTI tot textul testului și identifici EXACT exercițiul despre care întreabă elevul.
2. GĂSEȘTI rezolvarea acelui exercițiu în rezolvarea-model a testului (inclusă mai jos, dacă există) și VERIFICI că se potrivește cu enunțul (aceleași expresii, aceleași numere).
3. PREDAI rezolvarea natural, ca un profesor la tablă: întâi îndrumare; rezolvarea completă, cu TOȚI pașii și toate calculele, doar când elevul o cere explicit.

Reguli:
- Răspunzi DOAR în limba română, clar și la nivelul elevului.
- Scrii formulele în LaTeX: între $...$ pentru inline și $$...$$ pe rând separat. Exemple: $x^2$, $\\frac{a}{b}$, $\\sqrt{2}$, $\\vec{AB}$. Restul textului rămâne în română normală. IMPORTANT: conținutul dintre $$...$$ stă pe UN SINGUR rând, fără Enter în interior. Încadrezi ÎNTREAGA expresie matematică între $...$ — corect: $4(10)^3 = 4000$; GREȘIT: 4(10$)^3$ = 4000 sau 10$^3$. Folosește NUMAI delimitatorii $...$ și $$...$$ — NICIODATĂ \\[...\\] sau \\(...\\).
- RELAȚIILE LUI VIÈTE: la problemele cu rădăcinile $x_1, x_2, x_3, \\dots$ ale unui polinom (sume, produse, expresii simetrice), folosești relațiile lui Viète: scrii ÎNTÂI relațiile pentru polinomul dat (cu semnele corecte), apoi exprimi cerința prin ele. NU calcula rădăcinile explicit decât dacă problema o cere sau descompunerea e evidentă.
- Linkurile către paginile site-ului le scrii mereu RELATIVE, în format markdown: [Titlu](/cale) — ex: [Blog / Rezolvări / Teorie](/rezolvari). NICIODATĂ cu domeniu; adresa „examenmate.ro" NU există.
- Explici pas cu pas, numerotat. Nu inventezi formule, rezultate sau surse.
- Terminologie școlară românească: spune întotdeauna „descompunere în factori" — NU folosi niciodată cuvântul „factorizare".
- Adresa oficială a platformei este https://examenmate.com — dacă o menționezi, folosește EXACT această adresă.
SIGURANȚĂ (vorbești cu minori):
- Rămâi STRICT pe teme educaționale (matematică și folosirea platformei). Refuzi politicos orice subiect nepotrivit, periculos sau fără legătură cu școala și readuci discuția la învățare.
- Folosești limbaj potrivit vârstei, fără conținut nepotrivit.
- Scopul tău e ca elevul să ÎNVEȚE: implicit îl ghidezi spre soluție prin pași și întrebări, nu îi dai pur și simplu răspunsul de copiat.`;

// ─── Agentul PDF: cum citește textul extras al testului ──────────────────────
const PDF_READ_RULES = `CITIREA TESTULUI — textul testului este extras automat din PDF, deci poate avea mici defecte (formule rupte, exponenți, săgeți sau figuri pierdute). Reguli:
- Enunțul unui exercițiu îl iei DOAR din textul extras: când elevul zice „exercițiul 3", „subiectul II punctul b", „problema cu vectorii", îl cauți în text și lucrezi pe enunțul REAL. NU reconstrui din memorie formule sau valori „care sună plauzibil". Dacă nu găsești exercițiul, spui ce exerciții vezi în test și întrebi la care se referă.
- VECTORI: săgețile de deasupra literelor se pierd frecvent la extracție. Notația $\\vec{AB}$ înseamnă „vectorul AB". Dacă exercițiul este despre vectori (apare cuvântul „vector", notații $\\vec{...}$, sume de tip $\\vec{AB}+\\vec{BC}$, resturi de extracție ca „uuur" sau „ur" lângă litere), atunci egalitățile de acolo sunt EGALITĂȚI DE VECTORI — aceeași lungime, aceeași direcție și același sens — NU simple egalități de lungimi. Exemplu: $\\vec{AB}=\\vec{DC}$ înseamnă că ABCD este paralelogram; „AB = DC" scris într-o problemă de vectori se citește aproape sigur $\\vec{AB}=\\vec{DC}$. Suma $\\vec{AB}+\\vec{BC}=\\vec{AC}$ este regula triunghiului, nu o adunare de lungimi.
- RADICALI: semnul de radical se pierde des la extracție ($\\sqrt{3x+6}=6$ poate apărea ca „3x+6=6"). Semne că enunțul avea radical: cuvintele „radical"/„rădăcina", resturi ca „√", ori rezolvarea ÎNCEPE prin ridicare la pătrat / membrul drept din rezolvare este PĂTRATUL celui din enunț (36 = 6²). Atunci reconstruiești enunțul cu radical, iar numerele „noi" din rezolvare le explici prin ridicarea la pătrat ($6^2=36$) — membrul drept al ENUNȚULUI rămâne cel din test (6), NU cel din rezolvare (36). NU afirma niciodată că un număr „vine direct din enunț" dacă în enunțul din test scrie alt număr.
- Dacă o formulă pare deteriorată în textul extras: când ai rezolvarea-model, folosește forma expresiilor de acolo (ea repetă expresiile enunțului) și mergi mai departe natural, FĂRĂ să-i ceri elevului confirmări; fără rezolvarea-model, spui sincer ce ai înțeles și îl rogi să confirme datele sau să fotografieze exercițiul cu butonul 📷.
- Dacă exercițiul cerut nu apare deloc în textul extras (PDF scanat sau trunchiat): spune-i sincer și propune-i să-l fotografieze ori să-l scrie în chat.`;

// ─── Agentul PDF: reguli pentru rezolvarea-model (baremul) asociată ──────────
const PDF_BAREM_RULES = `REZOLVAREA-MODEL de mai sus este SURSA TA DE ADEVĂR — are prioritate absolută față de orice altă metodă sau amintire a ta.
Reguli STRICTE:
- La ORICE întrebare despre un exercițiu din test, PRIMUL pas este să găsești itemul corespunzător în rezolvarea-model (același subiect, același număr de exercițiu, aceeași literă) și să-l citești integral.
- VERIFICI potrivirea: itemul găsit trebuie să repete expresiile și numerele enunțului din test. Dacă NU corespunde (alte valori, altă cerință, altă variantă), spui explicit că pentru acest exercițiu nu ai o rezolvare verificată în platformă, rezolvi singur foarte atent (verifici de două ori fiecare calcul) și recomanzi secțiunea [Blog / Rezolvări / Teorie](/rezolvari). NU folosești un item nepotrivit.
- EXPLICAȚIA TA = pașii rezolvării-model POVESTIȚI natural, ca metoda ta de la clasă: la fiecare pas spui CE facem și DE CE, cu ACELEAȘI relații, ACELEAȘI calcule și ACELEAȘI rezultate intermediare și finale. NU improvizezi altă metodă, NU sari peste pași, NU rezumi.
- CUVÂNTUL „barem" NU apare în răspunsurile tale, și nici formulări ca „conform baremului", „baremul spune", „rezolvarea oficială/model indică". Predai metoda ca fiind a ta, ca la tablă. Excepție unică: elevul întreabă EXPLICIT despre barem sau despre punctaje — doar atunci poți vorbi deschis despre el.
- VERIFICARE FINALĂ OBLIGATORIE: înainte de a încheia răspunsul, compară rezultatul tău final cu cel din rezolvarea-model. Dacă diferă, răspunsul tău e greșit — refă-l înainte să-l trimiți.
- NU amesteci rezolvări de la alte variante, alte profiluri sau alți ani. Sursa ta este DOAR baza de date a platformei — nu trimite elevul pe alte site-uri.
- EVALUAREA NAȚIONALĂ — Subiectul I și Subiectul al II-lea sunt GRILE: rezolvarea-model NU are pași acolo, ci DOAR litera corectă a fiecărui item, în tabelul „Nr. item / Rezultate / Punctaj" (5 puncte pe item, se punctează doar rezultatul). La aceste exerciții rezolvi TU pas cu pas, cu calculele tale, și închei OBLIGATORIU cu litera oficială din tabel — niciodată alta; dacă rezolvarea ta duce la altă literă, ai citit greșit enunțul (simboluri pierdute la extracție) — recitește-l și refă calculul. Subiectul al III-lea are rezolvarea pe pași, cu punctaje (a) 2p, b) 3p) — o predai ca mai sus. (Baremele vechi de EN dau la Subiectul I și II doar REZULTATUL — îl predai la fel: rezolvi tu, închei cu rezultatul oficial.)
- PEDAGOGIE: la PRIMA întrebare despre un exercițiu PREZINȚI CLAR rezolvarea lui din rezolvarea-model: toți pașii, în ordine, numerotați, cu calculele și rezultatul final. Excepție: în modul „indiciu" sau când elevul cere explicit doar un indiciu/un început, dai DOAR primul pas, fără rezultatul final, încheiat cu o întrebare care îl duce mai departe.
- NELĂMURIRI ULTERIOARE: după ce ai prezentat rezolvarea, RECITEȘTI enunțul exercițiului din TEXTUL TESTULUI și discuți pe marginea lui: lămurești „de unde vine" un număr sau o formulă, explici altfel un pas, dai un exemplu ajutător sau chiar o abordare alternativă CORECTĂ — cu două condiții: să nu contrazici rezultatele rezolvării-model și, când metodele diferă, să spui că metoda prezentată prima este cea oficială.`;

const BAREM_MISSING = `BAREM: pentru acest test NU am găsit în platformă baremul corespunzător (sau potrivirea era nesigură — decât baremul greșit, mai bine niciunul). Dacă elevul cere explicații „din barem": spune-i sincer că baremul nu e disponibil în platformă pentru acest test, rezolvă atent pas cu pas (verifică de două ori fiecare calcul) și recomandă-i secțiunea [Blog / Rezolvări / Teorie](/rezolvari) sau celelalte materiale din platformă. NU trimite elevul pe site-uri externe.`;

// ─── Agentul PDF: REFORMULAREA explicației, la cerere (pentru orice răspuns) ──
const PDF_REFORMULATE = `REFORMULARE LA CERERE — elevul îți poate cere ORICÂND ultima explicație spusă altfel. Recunoști cererea și reformulezi TOT ce ai explicat, păstrând ACEEAȘI metodă și ACELEAȘI rezultate:
- „mai detaliat" / „cu mai multe detalii" → explicația completă, cu FIECARE pas scris, fiecare calcul făcut mărunt și motivul fiecărei treceri;
- „pe scurt" / „mai scurt" → doar esențialul, în 3–5 rânduri: pașii-cheie și rezultatul;
- „mai simplu" / „ca la un copil" → cuvinte foarte simple, de zi cu zi, comparații din viața reală, fără termeni tehnici (păstrezi doar notațiile strict necesare); cald, fără să-l faci pe elev să se simtă prost;
- „tot răspunsul" / „repetă tot" → reiei întreaga explicație de la capăt, curat și ordonat;
- orice altă cerere de acest fel (alt exemplu, altă perspectivă, doar un anumit pas etc.) → o urmezi întocmai.
ÎNCHEIERE OBLIGATORIE: închei FIECARE răspuns cu întrebarea, pe un rând separat, exact așa: „Reformulez mai simplu sau mai detaliat?"`;

// Persona SCURTĂ pentru promptul focalizat (enunț + rezolvare, nimic altceva).
// Un prompt mic = modelul nu are din ce să improvizeze și urmează fidel pașii.
const PDF_FOCUS_PERSONA = `Ești „Profesorul Virtual" de pe ExamenMate — profesor de matematică român, calm, prietenos și răbdător. Elevul are deschis un test PDF și te-a întrebat despre un exercițiu anume. Mai jos ai ENUNȚUL exercițiului și REZOLVAREA lui — aceasta este SINGURA metodă pe care o predai; tu doar o POVESTEȘTI natural, ca la tablă.
Reguli:
- Răspunzi DOAR în limba română, clar și la nivelul elevului.
- Formulele în LaTeX: $...$ inline sau $$...$$ pe rând separat (conținutul dintre $$...$$ stă pe UN singur rând). Folosește NUMAI acești delimitatori.
- COPIEZI expresiile EXACT, cu exponenți și semne intacte: dacă în rezolvare scrie $m^2-3$, scrii $m^2-3$, NU $m-3$; dacă scrie $(x_1x_2x_3x_4)^2$, păstrezi puterea a 2-a.
- TEXTUL REZOLVĂRII vine din extracție automată din PDF și poate avea fracții, exponenți sau limite de integrare SPARTE pe bucăți (cifre împrăștiate, resturi ca „^{2}^{1}"). NU copia molozul: reconstruiește expresiile coerent matematic, în LaTeX îngrijit, păstrând metoda și valorile rezolvării.
- SIMBOLURI PIERDUTE (radicali, exponenți): dacă enunțul din test și rezolvarea par să NU se potrivească (ex. în enunț membrul drept e 6, în rezolvare apare 36), aproape sigur extracția a pierdut un simbol: enunțul era $\\sqrt{3x+6}=6$, iar 36 vine din ridicarea la pătrat ($6^2=36$). Reconstruiește enunțul corect, explică elevului exact această legătură și NU afirma că un număr „vine direct din enunț" dacă în enunțul din test scrie alt număr.
- Terminologie școlară: „descompunere în factori", NU „factorizare".
- Rămâi strict pe teme educaționale, cu limbaj potrivit minorilor.`;

// Reguli SCURTE și imperative pentru rezolvarea-model extrasă (itemul exact).
// Stau la FINALUL promptului — acolo modelul le respectă cel mai bine.
const PDF_ITEM_RULES = `AȘA RĂSPUNZI ACUM (obligatoriu):
- ÎNCEPI răspunsul numind exercițiul și reluând pe scurt cerința lui din enunț (ex. „La subiectul III, exercițiul 2 b), trebuie să arătăm că…") — exact cerința din ENUNȚUL de mai sus, nu alta.
- LA PRIMA ÎNTREBARE despre acest exercițiu (și ori de câte ori elevul cere explicația sau rezolvarea): PREZINȚI CLAR rezolvarea de mai sus, COMPLETĂ — TOȚI pașii, în ordinea lor, numerotați: la fiecare spui CE facem și DE CE și scrii calculul cu formulele lui (în LaTeX). Rezultatele intermediare și finale sunt EXACT cele de mai sus. Închei cu rezultatul final, clar.
- Elevul cere DOAR un indiciu sau un început (ori modul e „indiciu")? → DOAR primul pas, reformulat prietenos ca îndrumare, FĂRĂ rezultatul final; închei cu o întrebare care îl duce mai departe.
- NELĂMURIRI ULTERIOARE („de unde vine...?", „de ce ai făcut așa?", „nu înțeleg pasul..."): răspunzi la obiect, sprijinit pe ENUNȚUL din test, pe TEXTUL TESTULUI și pe rezolvarea de mai sus; aici POȚI adăuga explicații proprii, un exemplu ajutător sau o abordare alternativă CORECTĂ — fără să contrazici rezultatele rezolvării de mai sus; când metodele diferă, spui că metoda prezentată prima este cea oficială.
- STRICT INTERZIS: să anunți rezultatul fără să fi arătat toți pașii până la el; să schimbi rezultatele intermediare sau finale; să scrii cuvântul „barem" ori formulări ca „conform baremului...", „baremul indică...", „rezolvarea oficială..." (excepție: elevul întreabă explicit de barem sau punctaje).
- Model CORECT de răspuns complet: „Pasul 1: scriem vectorii de poziție, pentru că... $...$; Pasul 2: egalăm coordonatele... $...$; deci rezultatul este $...$". Model GREȘIT: „Conform baremului, rezultatul este $12$".`;

// ── GRILELE de la Evaluarea Națională (Subiectul I / II) și itemii cu răspuns
// scurt (baremele vechi): rezolvarea-model dă DOAR litera / rezultatul, fără
// pași. Profesorul rezolvă singur, dar concluzia este OBLIGATORIU cea oficială.
const PDF_GRILA_RULES = `EXERCIȚIU DE TIP GRILĂ — rezolvarea-model oficială indică DOAR litera răspunsului corect (se punctează numai rezultatul; nu există pași oficiali). AȘA RĂSPUNZI ACUM (obligatoriu):
- ÎNCEPI numind exercițiul și reluând pe scurt cerința din enunț, cu variantele lui de răspuns a), b), c), d).
- REZOLVI exercițiul tu, pas cu pas, cu calculele scrise în LaTeX, ca un profesor la tablă — clar, la nivelul elevului de gimnaziu.
- ÎNCHEI OBLIGATORIU cu propoziția: „Răspunsul corect este litera X)" — unde X este EXACT litera oficială de mai sus. Rezolvarea ta TREBUIE să conducă la varianta X; dacă obții altceva, ai citit greșit enunțul (extracția pierde radicali, fracții, exponenți, figuri) — recitește-l, refă calculul și spune-i elevului ce simbol s-a pierdut. NU anunța NICIODATĂ altă literă drept răspuns corect și NU spune că răspunsul oficial ar fi greșit.
- Elevul cere DOAR un indiciu (ori modul e „indiciu")? → doar primul pas, ca îndrumare, FĂRĂ litera răspunsului; închei cu o întrebare care îl duce mai departe.
- Cuvântul „barem" NU apare în răspuns (excepție: elevul întreabă explicit de barem sau punctaje — atunci spui că exercițiul valorează 5 puncte și se punctează doar rezultatul).`;

const PDF_REZULTAT_RULES = `EXERCIȚIU CU RĂSPUNS SCURT — rezolvarea-model oficială indică DOAR rezultatul (se punctează numai rezultatul; nu există pași oficiali). AȘA RĂSPUNZI ACUM (obligatoriu):
- ÎNCEPI numind exercițiul și reluând pe scurt cerința din enunț.
- REZOLVI exercițiul pas cu pas, cu calculele scrise în LaTeX, ca un profesor la tablă.
- ÎNCHEI OBLIGATORIU cu: „Răspunsul corect este R" — unde R este EXACT rezultatul oficial de mai sus. Dacă obții altceva, ai citit greșit enunțul (simboluri pierdute la extracție) — recitește-l și refă calculul; NU anunța alt rezultat drept corect.
- Elevul cere DOAR un indiciu (ori modul e „indiciu")? → doar primul pas, fără rezultat; închei cu o întrebare.
- Cuvântul „barem" NU apare în răspuns (excepție: elevul întreabă explicit de barem sau punctaje).`;

// Reguli pentru NELĂMURIRILE de după prima explicație: sursa principală devine
// TESTUL (baremul rămâne sprijin) și profesorul are libertate de explicare.
const PDF_FOLLOWUP_RULES = `AȘA RĂSPUNZI ACUM (elevul revine cu o NELĂMURIRE după explicația inițială) — obligatoriu:
- SURSA PRINCIPALĂ este acum TESTUL: recitește enunțul exercițiului din test (îl ai mai sus) și răspunde pe baza LUI. Când e relevant, CITEAZĂ în răspuns bucata exactă din enunț despre care întreabă elevul.
- Răspunzi ÎNTÂI la întrebarea pusă, concret și la obiect; abia apoi, dacă ajută, reiei pe scurt pașii.
- Rezolvarea-model rămâne reperul pentru metodă și rezultate (NU le contrazici), dar ai LIBERTATE de explicare: cuvinte proprii, alt unghi, un exemplu asemănător, pași intermediari suplimentari, legături cu teoria — orice îl ajută pe elev să înțeleagă.
- SIMBOLURI PIERDUTE LA EXTRACȚIE: dacă enunțul din test și rezolvarea par să nu se potrivească (ex. în test membrul drept e 6, în rezolvare apare 36), aproape sigur s-a pierdut un simbol (radical, exponent, fracție). Reconstruiește enunțul corect (ex. $\\sqrt{3x+6}=6$; 36 apare din ridicarea la pătrat: $6^2=36$) și explică-i elevului exact această legătură. NU afirma niciodată că un număr „vine direct din enunț" dacă în enunțul din test scrie alt număr.
- Cuvântul „barem" tot NU apare în răspuns (excepție: elevul întreabă explicit de barem sau punctaje).`;

// ── Prima întrebare vs. NELĂMURIRE ulterioară despre ACELAȘI exercițiu ────────
// Prima explicație a unui exercițiu vine STRICT din barem; nelămuririle de
// după se sprijină pe TEST. Întrebare „nouă" = mesajul numește explicit un alt
// exercițiu (sau altă literă) decât cele deja discutate în conversație.
function isFollowUpQuestion(message, priorMsgs = []) {
  if (!(priorMsgs || []).some((m) => m && m.role === 'assistant')) return false; // încă nu am răspuns la nimic
  const now = parseExerciseRef(message);
  if (!now) return true; // întrebare vagă („de unde 36?", „nu înțeleg") → continuă discuția
  const priorRefs = (priorMsgs || [])
    .filter((m) => m && m.role === 'user')
    .map((m) => parseExerciseRef(m.content))
    .filter(Boolean);
  // compatibil cu o referință deja discutată: niciun câmp definit în ambele nu
  // diferă ȘI există cel puțin un câmp comun egal (altfel e alt exercițiu)
  return priorRefs.some((r) =>
    (!now.ex || !r.ex || now.ex === r.ex) &&
    (!now.subject || !r.subject || now.subject === r.subject) &&
    (!now.letter || !r.letter || now.letter === r.letter) &&
    ((now.ex && r.ex) || (now.subject && r.subject) || (now.letter && r.letter)));
}

// Câte din numerele fragmentului se regăsesc în barem — anti-halucinație:
// fragmentul „extras" trebuie să provină CHIAR din textul baremului.
function fragmentFromBarem(frag, baremText) {
  const nums = (s) => String(s || '').match(/\d+(?:[.,]\d+)?/g) || [];
  const fn = nums(frag);
  if (fn.length < 2) {
    const nfrag = String(frag || '').replace(/\s+/g, ' ').trim().toLowerCase();
    return nfrag.length >= 20 &&
      String(baremText || '').replace(/\s+/g, ' ').toLowerCase().includes(nfrag.slice(0, 40));
  }
  const bset = new Set(nums(baremText));
  const hit = fn.filter((n) => bset.has(n)).length;
  return hit / fn.length >= 0.7;
}

// ── Cerința reconstruită din barem (enunțul din test poate pierde simboluri) ──
// Baremul repetă enunțul: prima egalitate începe cu membrul stâng al cerinței,
// iar ultimul „=" dă rezultatul final. Ex: „∫√(f(x)(x+1))dx = ... = 1 − ln 2"
// → cerința: „∫√(f(x)(x+1))dx = 1 − ln 2". Testul extras pierduse radicalul.
function claimFromBarem(baremFrag) {
  const lines = String(baremFrag || '').split(/\n+/).map((l) => l.replace(/\b\d+\s*p(?:uncte)?\.?\s*$/i, '').trim()).filter(Boolean);
  if (!lines.length) return null;
  // membrul stâng: din prima linie cu „=", partea dinaintea primului „="
  let lhs = null;
  for (const l of lines) {
    const i = l.indexOf('=');
    if (i > 2) { lhs = l.slice(0, i).replace(/^[a-d]\s*\)\s*/i, '').trim(); break; }
  }
  // rezultatul final: ultima linie cu „=", partea de după ultimul „="
  let final = null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const eq = lines[i].lastIndexOf('=');
    if (eq !== -1 && eq < lines[i].length - 1) {
      const r = lines[i].slice(eq + 1).trim();
      if (r.length >= 1 && r.length <= 90) { final = r; break; }
    }
  }
  if (!lhs || !final || lhs.length < 3 || lhs.length > 160) return null;
  return { lhs, final };
}

// ── Referința exercițiului din conversație (mesajul curent + cele anterioare) ─
// „dă-mi rezolvarea completă" după „explică-mi III 2 b" → referința vine din
// mesajul anterior; „și punctul c?" moștenește subiectul și exercițiul.
function refFromConversation(message, priorMsgs = []) {
  const texts = [message, ...priorMsgs.filter((m) => m.role === 'user').map((m) => m.content).reverse()];
  let acc = { subject: null, ex: null, letter: null };
  for (const t of texts) {
    const p = parseExerciseRef(t);
    if (!p) continue;
    acc = { subject: acc.subject || p.subject, ex: acc.ex || p.ex, letter: acc.letter || p.letter };
    if (acc.ex) break; // cea mai recentă referință clară câștigă
  }
  return acc.ex ? acc : null;
}

// ── Itemul de barem localizat DETERMINIST pentru o referință („I.3", „III.2.b") ─
// Întoarce { exercitiu, enunt, barem, kind, litera?, raspuns? } sau null.
//   kind 'rezolvare' — pași de rezolvare (BAC, EN Subiectul al III-lea);
//   kind 'grila'     — grilă EN (Subiectul I/II): doar litera oficială;
//   kind 'rezultat'  — doar rezultatul (baremele vechi de EN).
function deterministicBaremItem({ baremText, subjectText }, ref) {
  const loc = locateBaremItem(baremText, ref);
  if (!loc) return null;
  const short = loc.kind === 'grila' || loc.kind === 'rezultat';
  // la grile, literele a)–d) sunt VARIANTE de răspuns, nu subpuncte → enunțul
  // întreg, cu toate variantele; la fel la itemii cu rezultat
  const enRef = short ? { ...ref, letter: null } : ref;
  const enunt = sliceExercise(subjectText || '', enRef, { ignoreLetter: short });
  return {
    exercitiu: formatRef(enRef),
    enunt: enunt ? enunt.slice(0, 1500) : null,
    barem: loc.text.slice(0, 3500),
    kind: loc.kind,
    litera: loc.litera || null,
    raspuns: loc.raspuns || null,
  };
}

// Schema răspunsului de la extractBaremItem (Structured Outputs)
const BAREM_ITEM_SCHEMA = S.obj({
  exercitiu: S.nullable(S.str('referința exercițiului, ex. "II.2.b"; null dacă întrebarea nu e despre un exercițiu anume')),
  enunt: S.str('enunțul copiat identic din test ("" dacă nu se aplică)'),
  barem: S.str('fragmentul copiat identic din barem ("" dacă nu se aplică)'),
});

// ── Extrage din barem rezolvarea EXERCIȚIULUI ÎNTREBAT (focalizare) ──────────
// Baremul întreg are mii de caractere și modelul „se pierde" în el. Un pas
// separat, ieftin, identifică exercițiul din întrebare și copiază identic
// fragmentul lui de barem; promptul principal primește apoi FIX rezolvarea.
// Dacă modelul a identificat exercițiul („I.3"), fragmentul se taie totuși
// DETERMINIST pe structura documentului (inclusiv litera din tabelul de grile
// al baremelor de EN) — copia modelului e doar rezerva.
async function extractBaremItem({ message, priorMsgs = [], subjectText = '', baremText = '' }) {
  if (!hasChat() || !baremText) return null;
  try {
    const prior = priorMsgs.filter((m) => m.role === 'user').slice(-2).map((m) => m.content).join('\n');
    const sys = 'Primești întrebarea unui elev despre un test, textul testului și BAREMUL testului. Identifică exercițiul la care se referă întrebarea (folosește și mesajele anterioare dacă întrebarea e vagă), apoi: (1) extrage din TEST, CUVÂNT CU CUVÂNT, enunțul acelui exercițiu; (2) extrage din BAREM, CUVÂNT CU CUVÂNT, fragmentul care rezolvă EXACT acel exercițiu (toate rândurile lui, cu exponenții și semnele intacte; la grilele cu tabel „Nr. item / Rezultate" copiază litera itemului, ex. „3. c. 5p"). Răspunde DOAR cu JSON: {"exercitiu":"II.2.b","enunt":"<enunțul copiat identic din test>","barem":"<fragmentul copiat identic din barem>"}. Dacă întrebarea nu se referă la un exercițiu anume, răspunde {"exercitiu":null,"enunt":"","barem":""}.';
    const user = `ÎNTREBAREA ELEVULUI: ${String(message).slice(0, 600)}\n\nMESAJELE ANTERIOARE ALE ELEVULUI (context): ${prior || '—'}\n\nTESTUL:\n"""${String(subjectText).slice(0, 9000)}"""\n\nBAREMUL:\n"""${String(baremText).slice(0, 11000)}"""`;
    // fragmentele se copiază IDENTIC din documente → fără restaurare LaTeX
    // (verificarea fragmentFromBarem compară numerele cu textul brut)
    const { data: parsed } = await chatJson({
      system: sys, messages: [{ role: 'user', content: user }], temperature: 0, maxTokens: 1100, model: PDF_MODEL,
      schema: BAREM_ITEM_SCHEMA, schemaName: 'barem_item', restoreLatex: false,
    });
    // exercițiul identificat → tăiere deterministă (structura oficială a documentului)
    const ref = parsed && parsed.exercitiu ? parseExerciseRef(String(parsed.exercitiu)) : null;
    if (ref && ref.ex) {
      const det = deterministicBaremItem({ baremText, subjectText }, ref);
      if (det) return det;
    }
    const frag = parsed && parsed.barem ? String(parsed.barem).trim() : '';
    const en = parsed && parsed.enunt ? String(parsed.enunt).trim() : '';
    const enOk = en.length > 10 && fragmentFromBarem(en, subjectText); // enunțul doar dacă provine din test
    // fragment scurt de grilă / rezultat („3. c. 5p") copiat de model — verificat în barem
    const short = shortAnswerOf(frag);
    if (short && String(baremText).replace(/\s+/g, ' ').includes(frag.replace(/\s+/g, ' ').slice(0, 12))) {
      const grila = /^[a-d]$/i.test(short);
      return {
        exercitiu: parsed.exercitiu || null, enunt: enOk ? en.slice(0, 1500) : null,
        barem: grila ? `${parsed.exercitiu || ''} — răspunsul corect: ${short.toLowerCase()}) (5 puncte; se punctează doar rezultatul)` : `${parsed.exercitiu || ''} — rezultatul corect: ${short}`,
        kind: grila ? 'grila' : 'rezultat', litera: grila ? short.toLowerCase() : null, raspuns: grila ? null : short,
      };
    }
    if (frag.length > 20 && fragmentFromBarem(frag, baremText)) {
      return { exercitiu: parsed.exercitiu || null, enunt: enOk ? en.slice(0, 1500) : null, barem: frag.slice(0, 3500), kind: 'rezolvare' };
    }
  } catch (e) { console.warn('extractBaremItem:', e.message); }
  return null; // fără fragment sigur → rămâne baremul întreg din prompt
}

const ACTION_PROTOCOL = `ACȚIUNI DIRECTE ÎN EXERCIȚIU — DOAR LA CEREREA EXPLICITĂ a elevului (ex. „scrie tu", „alege tu B", „completează tu răspunsul"). Emite atunci, pe un rând separat la finalul răspunsului, EXACT un marcaj:
[[ACTIUNE:{"kind":"fill","value":"1/2"}]] — scrie valoarea în câmpul de răspuns al pasului curent
[[ACTIUNE:{"kind":"choose","letter":"B"}]] — alege opțiunea de grilă
[[ACTIUNE:{"kind":"tf","value":true}]] — alege ADEVĂRAT (false pentru FALS)
[[ACTIUNE:{"kind":"add"}]] — apasă „Adaugă în rezolvare" (doar dacă elevul cere să confirmi pasul)
Reguli: niciodată nu emiți marcaje din proprie inițiativă; maximum un marcaj pe mesaj; înainte de marcaj spui în cuvinte ce faci și de ce. Dacă elevul cere răspunsul final sau rezolvarea completă, i le dai în chat (răspuns concret + toți pașii), dar în exercițiu completezi tot DOAR pas cu pas, la fiecare cerere explicită.`;

// ─── Catalogul exercițiilor interactive din site (pentru recomandări) ────────
async function interactiveCatalog(supa, category = null) {
  try {
    const { data } = await supa.from('content')
      .select('id, title, category, is_free')
      .eq('content_type', 'interactive')
      .order('sort_order', { ascending: true })
      .limit(60);
    if (!data || !data.length) return '';
    // exercițiile din categoria elevului primele
    const sorted = category ? [...data.filter((c) => c.category === category), ...data.filter((c) => c.category !== category)] : data;
    const rows = sorted.slice(0, 30).map((c) => `- [${c.title}](/exercitiu?id=${c.id}) · ${c.category}${c.is_free ? ' · gratuit' : ''}`);
    return `EXERCIȚII INTERACTIVE DIN SITE (linkurile deschid exercițiul direct, cu Profesorul Virtual alături):
${rows.join('\n')}
Când utilizatorul (elev sau profesor) întreabă despre un capitol/lecție, cere exersare, materiale ori un PLAN DE ÎNVĂȚARE: alege exercițiile potrivite DIN ACEASTĂ LISTĂ și dă linkul EXACT cum e scris, RELATIV, în format markdown [Titlu](/exercitiu?id=...) — niciodată cu domeniu, niciodată „examenmate.ro". Pentru secțiuni întregi folosește tot linkuri relative: [Evaluare Națională](/evaluare-nationala), [Bacalaureat](/bacalaureat), [Clasa a 5-a](/clase/5) etc. Pentru plan de învățare: împarte pe etape (1–2 exerciții pe etapă), cu un obiectiv mic și măsurabil la fiecare etapă (ex. „minim 80% la exercițiul X"), de la ușor la greu. NU inventa linkuri sau titluri care nu sunt în listă.`;
  } catch { return ''; }
}

// ─── Starea elevului (progres + insigne) — pentru motivare ───────────────────
async function studentState(supa, userId) {
  const bits = [];
  try {
    const { data: prog } = await supa.from('progress')
      .select('score, max_score, completed_at')
      .eq('user_id', userId).order('completed_at', { ascending: false }).limit(50);
    if (prog && prog.length) {
      const perfect = prog.filter((p) => p.max_score > 0 && p.score >= p.max_score).length;
      let ts = 0, tm = 0; prog.forEach((p) => { ts += p.score || 0; tm += p.max_score || 0; });
      bits.push(`- Exerciții interactive finalizate: ${prog.length} (${perfect} cu punctaj maxim); medie generală ${tm ? Math.round((ts / tm) * 100) : 0}%.`);
    } else {
      bits.push('- Nu a finalizat încă niciun exercițiu interactiv.');
    }
  } catch { /* tabelă lipsă — ignorăm */ }
  try {
    const { data: badges } = await supa.from('user_badges')
      .select('badge_id, name, earned_at')
      .eq('user_id', userId).order('earned_at', { ascending: false }).limit(5);
    if (badges && badges.length) bits.push(`- Insigne câștigate (cele mai noi primele): ${badges.map((b) => b.name || b.badge_id).join(', ')}.`);
  } catch { /* scriptul de gamificare nu a fost rulat încă */ }
  try {
    const { data: weak } = await supa.from('ai_skill_mastery')
      .select('topic, mastery').eq('user_id', userId)
      .lt('mastery', 0.7).order('mastery', { ascending: true }).limit(3);
    if (weak && weak.length) bits.push(`- Subiecte de întărit: ${weak.map((w) => w.topic).filter(Boolean).join(', ')}.`);
  } catch { /* ignorăm */ }
  if (!bits.length) return '';
  return `STAREA ELEVULUI (folosește-o pentru MOTIVARE):
${bits.join('\n')}
Motivează-l activ: felicită-l concret la reușite (punctaj maxim, insignă nouă, progres față de data trecută), propune-i provocări mici („hai să mai faci azi un exercițiu din capitolul acesta"), stabiliți împreună obiective realiste și amintește-i cât a progresat când se descurajează. Cald și sincer, fără laude exagerate la fiecare mesaj.`;
}

// ─── Pregătire mesaj chat (RAG + conversație + istoric + system) ──────────────
// Flux comun pentru ai-chat și ai-chat-stream (evită duplicarea).
// DOI AGENȚI: context.pdf → agentul de teste PDF (pdfAgentSystem);
//             altfel      → agentul interactiv/general (interactiveAgentSystem),
//             cu EXACT comportamentul de până acum.
// `regenerate` („Regenerează" din chat): răspunsul anterior al asistentului
// iese din istoricul dat modelului (altfel l-ar repeta), iar dacă ultimul mesaj
// al elevului este chiar întrebarea retrimisă, handlerul NU o mai salvează o
// dată (întoarcem `regenerated: true`). Răspunsul vechi rămâne în DB (istoric).
async function prepareChat(supa, { userId, message, mode = 'tutor', conversationId = null, context = {}, premium = false, regenerate = false, images = null }) {
  const isPdfAgent = !!context.pdf;
  const hasBarem = !!(context.pdf && context.baremText);
  // Etapa 3 (4.4): pozele elevului merg la model CA IMAGINI (nu doar transcrierea);
  // transcrierea rămâne în context.attachedText, SEPARAT de textul testului/exercițiului
  const photos = (Array.isArray(images) ? images : []).filter((u) => typeof u === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(u) && u.length <= 2_200_000).slice(0, 3);

  // 1. RAG (întrebarea + textul exercițiului, dacă există).
  //    Agentul PDF cu rezolvare-model NU primește alte materiale — ar dilua
  //    sursa de adevăr; sursa afișată elevului este chiar baremul asociat.
  let docs = [], ctxBlock = '', primaryMaterial = null;
  if (!hasBarem) {
    const retrievalQuery = [message, context.attachedText, context.exerciseText].filter(Boolean).join('\n').slice(0, 6000);
    docs = await retrieve(supa, {
      query: retrievalQuery, category: context.category || null,
      allowPremium: premium, k: 6, prefer: 'solution',
    });
    ctxBlock = contextBlock(docs);
    primaryMaterial = await topMaterial(supa, docs);
  }

  // 2. Conversație: o reluăm (dacă e a userului) sau o creăm.
  let convId = conversationId || null;
  if (convId) {
    const { data } = await supa.from('ai_conversations').select('id, user_id').eq('id', convId).maybeSingle();
    if (!data || data.user_id !== userId) convId = null;
  }
  if (!convId) {
    // Dacă inserarea eșuează, convId rămâne undefined și TOATE scrierile
    // ulterioare (mesaje, update conversație) eșuează în lanț, tăcut. Oprim aici.
    const { data, error } = await supa.from('ai_conversations')
      .insert({ user_id: userId, title: message.slice(0, 60), context }).select('id').single();
    if (error || !data?.id) {
      console.error('ai: creare conversație eșuată:', error);
      const e = new Error('Nu s-a putut porni conversația. Încearcă din nou.');
      e.status = 500; throw e;
    }
    convId = data.id;
  }

  // 3. Istoric recent (ultimele 10 mesaje, fără răspunsurile înlocuite)
  let rows = await loadHistory(supa, convId, 10);
  let regenerated = false;
  if (regenerate && conversationId && convId === conversationId) {
    const cut = dropLastTurn(rows, message);
    regenerated = cut.regenerated;
    // răspunsul înlocuit rămâne în DB (cu feedbackul lui), dar marcat
    // `superseded` — nu mai intră nici în istoricul modelului, nici în chat
    for (const r of cut.removedAssistant) {
      if (!r.id) continue;
      const { error } = await supa.from('ai_messages')
        .update({ metadata: { ...(r.metadata || {}), superseded: true } }).eq('id', r.id);
      if (error) console.warn('prepareChat: marcare superseded eșuată:', error.message);
    }
    rows = cut.msgs;
  }
  const priorMsgs = rows.map((m) => ({ role: m.role, content: m.content }));

  // 4. System prompt — construit de agentul potrivit.
  let system, baremItem = null, attachments = [];
  if (isPdfAgent) {
    const built = await pdfAgentSystem(supa, { userId, mode, context, message, priorMsgs, ctxBlock });
    system = built.system;
    baremItem = built.baremItem;
    // Etapa 2 (1.1): PAGINA din PDF cu exercițiul întrebat merge la model ca
    // fișier (text + imagine) — vede radicalii, fracțiile, figurile pierdute
    // la extracție. Doar pagina/paginile exercițiului, nu tot testul.
    attachments = await pdfPageAttachments(supa, { context, message, priorMsgs, baremItem });
    if (attachments.length) system += '\n\n' + PDF_PAGE_NOTE;
  } else {
    system = await interactiveAgentSystem(supa, { userId, mode, context, ctxBlock });
  }
  // Etapa 3 (4.4): exercițiul / lucrarea din poza sau PDF-ul încărcat de elev —
  // context SUPLIMENTAR (nu înlocuiește testul/exercițiul deschis)
  if (context.attachedText && String(context.attachedText).trim()) {
    system += `\n\nMATERIALUL ÎNCĂRCAT DE ELEV (poză / PDF — transcriere automată; enunțul sau lucrarea lui scrisă de mână):\n"""${String(context.attachedText).slice(0, 6000)}"""\nDacă elevul întreabă despre el, răspunde pe baza lui${isPdfAgent ? ' (testul deschis rămâne disponibil pentru context)' : ''}.`;
  }
  if (photos.length) {
    attachments = [...attachments, ...photos.map((u) => ({ type: 'image_url', image_url: { url: u, detail: 'high' } }))];
    system += `\n\nPOZA ELEVULUI: mesajul are atașată o imagine (exercițiul sau lucrarea lui scrisă de mână). CITEȘTE-O — are prioritate față de transcrierea automată; dacă e o rezolvare scrisă de mână, verific-o pas cu pas și spune-i exact unde a greșit.`;
  }
  // Etapa 3 (3.2): UNELTE — calculate / check_equivalence / get_exercise / get_barem_item
  const tools = require('./tools').tutorTools({
    subjectText: isPdfAgent ? context.exerciseText : null,
    exerciseText: !isPdfAgent ? context.exerciseText : null,
    baremText: isPdfAgent ? context.baremText : null,
  });
  if (tools.length) system += '\n\n' + require('./tools').toolsNote(tools);
  // Etapa 3 (4.6): figuri desenate în chat ([[FIGURA:{...}]] → src/lib/figureRender.js).
  // Specificația (≈700 tokeni) intră DOAR când conversația e de geometrie / grafice.
  const mentor = mode === 'exams' || mode === 'students';
  if (!mentor && FIGURES_IN_CHAT && GEO_RE.test([message, context.attachedText, baremItem && baremItem.enunt, String(context.exerciseText || '').slice(0, 4000)].filter(Boolean).join('\n'))) {
    system += '\n\n' + require('./figures').FIGURE_SPEC_CHAT;
  }

  // „Materiale folosite": agentul PDF citește TESTUL + BAREMUL — le afișăm pe
  // amândouă (cu numele original al fișierului, ca dovadă a corespondenței).
  const sources = isPdfAgent
    ? [
        { type: 'exercise', title: `Testul: ${context.title || 'materialul PDF deschis'}`, topic: context.fileName || null, category: context.category || null },
        ...(hasBarem
          ? [{ type: 'solution', title: `Baremul: ${context.baremTitle || 'baremul oficial al testului'}`, topic: context.baremFileName || null, category: context.category || null }]
          : docs.map((d) => ({ type: d.source_type, title: d.title, topic: d.topic, category: d.category }))),
      ]
    : docs.map((d) => ({ type: d.source_type, title: d.title, topic: d.topic, category: d.category }));
  return { docs, ctxBlock, primaryMaterial, convId, priorMsgs, system, sources, baremItem, regenerated, attachments, tools };
}
const FIGURES_IN_CHAT = process.env.AI_CHAT_FIGURES !== '0'; // implicit PORNIT
const GEO_RE = /triunghi|unghi|\bcerc|p[ăa]trat|dreptunghi|trapez|\bromb|paralelogram|\bcub\b|piramid|prism|\bcon\b|cilindr|sfer[ăa]|grafic|segment|perimetr|\bari[ae]\b|volum|diagonal|[îi]n[ăa]l[țt]im|median|bisectoar|tangent|coard[ăa]|mediatoar|sistem\w* de axe|xoy|\bf\s*\(\s*x\s*\)\s*=/i;

// ─── Etapa 2 (1.1): pagina PDF a exercițiului, ca atașament pentru model ─────
const PDF_VISION = process.env.AI_PDF_VISION !== '0'; // implicit PORNIT
const PDF_PAGE_NOTE = `PAGINA DIN PDF: mesajul elevului are atașată pagina (sau paginile) din test pe care se află exercițiul — ca fișier PDF, cu imaginea paginii. CITEȘTE ENUNȚUL ȘI FIGURILE DE PE PAGINĂ: ele au prioritate față de textul extras automat de mai sus (acolo radicalii, fracțiile etajate, săgețile de vector și figurile se pot pierde). Dacă textul extras și pagina diferă, crezi pagina și nu-i mai ceri elevului confirmări.`;
// cache mic, pe instanță, pentru paginile extrase (evită re-descărcarea la fiecare mesaj)
const pageCache = new Map();
const PAGE_CACHE_MAX = 24;
async function pdfPageAttachments(supa, { context, message, priorMsgs, baremItem }) {
  if (!PDF_VISION || !context || !context.pdf || !context.contentId) return [];
  try {
    const pdfCtx = require('../ai-pdf-context');   // lazy: evită dependența circulară
    const pdfpages = require('./pdfpages');
    const { data: content } = await supa.from('content').select('*').eq('id', context.contentId).maybeSingle();
    if (!content || !content.file_url) return [];
    const ctx = await pdfCtx.getPdfContext(supa, content).catch(() => null);
    const pages = Array.isArray(ctx?.pageTexts) ? ctx.pageTexts : [];
    if (!pages.length) return [];
    const ref = refFromConversation(message, priorMsgs);
    const idx = pdfpages.findPages(pages, { enunt: baremItem?.enunt || null, ref });
    if (!idx.length) return [];
    const key = `${content.id}:${content.file_url}:${idx.join(',')}`;
    let part = pageCache.get(key);
    if (!part) {
      const buf = await pdfCtx.downloadContentPdf(supa, content);
      const sub = await pdfpages.extractPagesPdf(buf, idx);
      part = pdfpages.filePart(sub, `pagina-${idx.map((i) => i + 1).join('-')}.pdf`);
      if (!part) return [];
      if (pageCache.size >= PAGE_CACHE_MAX) pageCache.delete(pageCache.keys().next().value);
      pageCache.set(key, part);
    }
    return [part];
  } catch (e) {
    warnOnce('pdfpage:' + (context && context.contentId), `pdfPageAttachments: ${e.message}`);
    return [];
  }
}

// Ultimele `limit` mesaje ale conversației, în ordine cronologică, FĂRĂ cele
// marcate `metadata.superseded` (înlocuite prin „Regenerează"). Dacă filtrul
// JSON nu e acceptat de PostgREST (versiune veche), recădem pe interogarea
// simplă și filtrăm în memorie — istoricul nu trebuie să dispară niciodată.
async function loadHistory(supa, convId, limit = 10) {
  const base = () => supa.from('ai_messages')
    .select('id, role, content, metadata').eq('conversation_id', convId)
    .order('created_at', { ascending: false });
  let { data, error } = await base()
    .or('metadata->>superseded.is.null,metadata->>superseded.neq.true').limit(limit);
  if (error) {
    warnOnce('hist_filter', `loadHistory: filtrul superseded a eșuat (${error.message}) — filtrez în memorie`);
    ({ data } = await base().limit(limit + 10));
    data = (data || []).filter((m) => !(m.metadata && m.metadata.superseded === true)).slice(0, limit);
  }
  return (data || []).reverse();
}

// „Regenerează": scoate din istoric ultimul răspuns al asistentului (toate
// răspunsurile consecutive de la coadă) și, dacă mesajul de dinaintea lor este
// chiar întrebarea retrimisă, și pe aceasta (regenerated=true → handlerul nu o
// mai salvează o dată). Funcție pură — testabilă.
function dropLastTurn(msgs, message) {
  const out = [...(msgs || [])];
  const removedAssistant = [];
  while (out.length && out[out.length - 1].role === 'assistant') removedAssistant.push(out.pop());
  const same = (a, b) => String(a || '').trim() === String(b || '').trim();
  if (removedAssistant.length && out.length && out[out.length - 1].role === 'user' && same(out[out.length - 1].content, message)) {
    out.pop();
    return { msgs: out, regenerated: true, removedAssistant };
  }
  return { msgs: out, regenerated: false, removedAssistant };
}

// ─── AGENTUL 1: exerciții interactive + chat general (comportament NESCHIMBAT) ─
async function interactiveAgentSystem(supa, { userId, mode, context, ctxBlock }) {
  const mentor = mode === 'exams' || mode === 'students';
  const parts = [];
  const lvl = levelLabel(context);
  if (lvl) parts.push(`NIVELUL ELEVULUI: ${lvl}. Adaptează limbajul, notațiile, exemplele și profunzimea explicațiilor la acest nivel.`);
  // Etapa 3 (4.7): pe paginile generice widgetul spune UNDE e elevul (pagina + categoria)
  if (context.page && !context.interactive && !context.pdf && !context.meditatii) {
    const pg = String(context.page).slice(0, 120);
    const cat = context.category ? ` (categoria „${context.category}")` : '';
    parts.push(`UNDE SE AFLĂ ELEVUL: pe pagina ${pg}${cat}${context.pageTitle ? ` — „${String(context.pageTitle).slice(0, 120)}"` : ''}. Dacă întreabă „ce e aici" / „ce fac pe pagina asta", explică-i pagina; la întrebări de matematică, adaptează nivelul la categorie.`);
  }
  if (context.exerciseText) {
    // Limită mare: AI-ul primește TESTUL INTERACTIV complet, ca să recunoască
    // exact exercițiul la care se referă elevul.
    const cap = context.interactive ? 14000 : 1500;
    parts.push(`Elevul lucrează la acest exercițiu:\n"""${String(context.exerciseText).slice(0, cap)}"""`);
  }
  if (context.interactive) {
    parts.push(INTERACTIVE_RULES);
    parts.push(ACTION_PROTOCOL);
  }
  // Meditații cu Profesorul Virtual: profesor socratic + memoria pedagogică
  if (context.meditatii && !mentor) {
    parts.push(MEDITATII_RULES);
    const medMem = await meditatiiMemory(supa, userId);
    if (medMem) parts.push(medMem);
    // mesajul automat afișat de platformă (coach) — modelul continuă natural de la el
    if (context.coachNote) {
      parts.push(`ULTIMUL TĂU MESAJ CĂTRE ELEV (trimis automat de platformă în numele tău — dacă elevul răspunde la el, ex. „da", „hai", continuă natural de la el, cu marcajul potrivit dacă acceptă): """${String(context.coachNote).slice(0, 600)}"""`);
    }
  }
  // catalogul de exerciții e util tuturor (elevi ȘI profesori/părinți);
  // starea de progres + motivarea sunt doar pentru elevi.
  const [catalog, state] = await Promise.all([
    interactiveCatalog(supa, context.category || null),
    mentor ? Promise.resolve('') : studentState(supa, userId),
  ]);
  if (catalog) parts.push(catalog);
  if (state) parts.push(state);
  return systemFor(mode, ctxBlock, parts.length ? '\n' + parts.join('\n\n') : '');
}

// ─── AGENTUL 2: teste PDF (persona proprie, barem = sursă de adevăr) ──────────
// Întoarce { system, baremItem }. Când itemul de barem a fost extras sigur,
// promptul este FOCALIZAT: DOAR enunțul + rezolvarea lui + regulile — fără tot
// testul, fără tot baremul, fără RAG/motivare. Un model mic „se pierde" într-un
// prompt de zeci de mii de caractere și improviza propria metodă (greșită);
// cu promptul mic nu are din ce să improvizeze.
async function pdfAgentSystem(supa, { userId, mode, context, message, priorMsgs, ctxBlock }) {
  const lvl = levelLabel(context);
  const lvlLine = lvl ? `NIVELUL ELEVULUI: ${lvl}. Adaptează limbajul și explicațiile la acest nivel.` : '';

  // Pasul 1: identificăm exercițiul și îi extragem enunțul + rezolvarea din barem.
  // ÎNTÂI DETERMINIST: referința elevului („subiectul III ex 2 b") taie DIRECT
  // itemul din barem și enunțul din test, pe structura oficială — fără să
  // depindem de „citirea" vreunui model. AI-ul extrage doar când referința e
  // vagă („problema cu vectorii") sau structura nu se potrivește.
  let baremItem = null;
  if (context.baremText) {
    const ref = refFromConversation(message, priorMsgs);
    if (ref) {
      // tăiere deterministă: SUBIECTUL → exercițiul → litera; la grilele EN
      // (Subiectul I/II) → litera oficială din tabelul baremului
      baremItem = deterministicBaremItem({ baremText: context.baremText, subjectText: context.exerciseText || '' }, ref);
    }
    if (!baremItem) {
      baremItem = await extractBaremItem({ message, priorMsgs, subjectText: context.exerciseText || '', baremText: context.baremText });
    }
  }

  // Pasul 2a: PROMPT FOCALIZAT — avem rezolvarea exactă a exercițiului întrebat.
  if (baremItem) {
    if (!baremItem.kind) baremItem.kind = 'rezolvare';
    const shortKind = baremItem.kind === 'grila' || baremItem.kind === 'rezultat';
    baremItem.allowed = [context.exerciseText, baremItem.enunt, baremItem.barem, message]
      .filter(Boolean).join('\n'); // pentru verificarea anti-deviere (numere permise)
    // PRIMA întrebare despre exercițiu → explicația vine STRICT din barem;
    // NELĂMURIRE ulterioară → sursa principală devine TESTUL, cu libertate.
    baremItem.followUp = isFollowUpQuestion(message, priorMsgs);
    // cerința reconstruită din barem — enunțul extras din test poate pierde
    // radicali/săgeți/bare (sunt desenate, nu caractere), baremul o repetă corect.
    // DOAR la exerciții de tip „Arătați că / Demonstrați" (au forma LHS = rezultat);
    // la „Determinați..." egalitatea reconstruită ar fi falsă; la grile nu există.
    const claim = !shortKind && /ar[ăa]ta[țt]?i|demonstra/i.test(baremItem.enunt || '') ? claimFromBarem(baremItem.barem) : null;
    // grilă / rezultat scurt: rezolvarea-model e doar concluzia oficială
    const modelLabel = baremItem.kind === 'grila'
      ? `RĂSPUNSUL OFICIAL al exercițiului (document intern — elevul NU îl vede): litera ${baremItem.litera}). Detaliu: """${baremItem.barem}"""`
      : baremItem.kind === 'rezultat'
        ? `REZULTATUL OFICIAL al exercițiului (document intern — elevul NU îl vede): ${baremItem.raspuns}. Detaliu: """${baremItem.barem}"""`
        : null;
    // numele ORIGINALE ale fișierelor — dovada corespondenței test ↔ barem
    const fileLine = (context.fileName || context.baremFileName)
      ? `FIȘIERELE SURSĂ (numele originale, pentru corespondența test ↔ barem):${context.fileName ? ` testul „${context.fileName}"` : ''}${context.fileName && context.baremFileName ? ' ·' : ''}${context.baremFileName ? ` baremul „${context.baremFileName}"` : ''}.`
      : '';
    // ── NELĂMURIRE ulterioară: TESTUL este sursa principală, baremul sprijin ──
    if (baremItem.followUp) {
      const system = [
        PDF_FOCUS_PERSONA,
        MODE_ROLES[mode] || MODE_ROLES.tutor,
        lvlLine,
        fileLine,
        `EXERCIȚIUL${baremItem.exercitiu ? ` ${baremItem.exercitiu}` : ''} din testul „${context.title || 'PDF'}" — ENUNȚUL DIN TEST, SURSA PRINCIPALĂ a răspunsului de acum (extras automat; poate avea simboluri pierdute):\n"""${baremItem.enunt || '(enunțul nu a putut fi izolat automat — caută-l NEAPĂRAT în textul complet al testului de mai jos)'}"""`,
        context.exerciseText
          ? `TEXTUL COMPLET AL TESTULUI (citește-l — de aici răspunzi la nelămuriri):\n"""${String(context.exerciseText).slice(0, 12000)}"""`
          : '',
        modelLabel
          ? `${modelLabel}\nConcluzia ta rămâne ÎNTOTDEAUNA cea oficială de mai sus (${baremItem.kind === 'grila' ? `litera ${baremItem.litera})` : baremItem.raspuns}); explicațiile și calculele sunt ale tale.`
          : `REZOLVAREA-MODEL a exercițiului (sprijin — metoda și rezultatele ei rămân valabile; document intern, elevul NU îl vede):\n"""${baremItem.barem}"""`,
        PDF_FOLLOWUP_RULES,
        PDF_REFORMULATE,
      ].filter(Boolean).join('\n\n');
      return { system, baremItem };
    }
    // ── PRIMA întrebare: explicația vine STRICT din rezolvarea-model ──
    const system = [
      PDF_FOCUS_PERSONA,
      MODE_ROLES[mode] || MODE_ROLES.tutor,
      lvlLine,
      fileLine,
      `EXERCIȚIUL${baremItem.exercitiu ? ` ${baremItem.exercitiu}` : ''} din testul „${context.title || 'PDF'}" — ENUNȚUL (extras din test; poate avea simboluri pierdute):\n"""${baremItem.enunt || '(enunțul nu a putut fi izolat automat — caută-l în TEXTUL COMPLET AL TESTULUI de mai jos și folosește forma expresiilor din rezolvare)'}"""`,
      claim ? `CERINȚA DE DEMONSTRAT, reconstruită din rezolvare (pe ACEASTA o enunți elevului, NU varianta din test dacă diferă): arată că $${claim.lhs} = ${claim.final}$. Rezultatul final al rezolvării tale trebuie să fie EXACT ${claim.final}.` : '',
      modelLabel || `REZOLVAREA LUI (document intern — elevul NU îl vede; predă-l ca metoda ta):\n"""${baremItem.barem}"""`,
      context.exerciseText
        ? `TEXTUL COMPLET AL TESTULUI (context suplimentar — enunțul și rezolvarea de mai sus rămân reperul principal; de aici citești restul testului când elevul are nelămuriri sau întreabă „de unde vine..."):\n"""${String(context.exerciseText).slice(0, 12000)}"""`
        : '',
      baremItem.kind === 'grila' ? PDF_GRILA_RULES : baremItem.kind === 'rezultat' ? PDF_REZULTAT_RULES : PDF_ITEM_RULES,
      PDF_REFORMULATE,
    ].filter(Boolean).join('\n\n');
    return { system, baremItem };
  }

  // Pasul 2b: fără item sigur → promptul amplu (test întreg + barem întreg).
  const parts = [];
  if (lvlLine) parts.push(lvlLine);
  parts.push(`TESTUL DESCHIS: „${context.title || 'material PDF'}"${context.fileName ? ` (fișier original: „${context.fileName}")` : ''}. TEXTUL LUI COMPLET (extras automat):\n"""${String(context.exerciseText || '').slice(0, 20000)}"""`);
  parts.push(PDF_READ_RULES);
  const state = await studentState(supa, userId);
  // Fără barem: materialele din platformă ajută la rezolvarea atentă.
  if (!context.baremText && ctxBlock) {
    parts.push(`=== MATERIALE DIN BAZA DE DATE (context) ===\n${ctxBlock}\n=== SFÂRȘIT CONTEXT ===`);
  }
  if (state) parts.push(state);
  // Blocul rezolvării-model vine ULTIMUL: finalul promptului e locul unde
  // modelul respectă cel mai fidel instrucțiunile.
  if (context.baremText) {
    parts.push(`REZOLVAREA-MODEL a testului deschis${context.baremFileName ? ` (fișier original: „${context.baremFileName}")` : ''} (document intern pentru tine — elevul NU îl vede; NU îl numi „barem" în răspuns):\n"""${String(context.baremText).slice(0, 12000)}"""`);
    parts.push(PDF_BAREM_RULES);
  } else {
    parts.push(BAREM_MISSING);
  }
  parts.push(PDF_REFORMULATE);
  const system = `${PDF_PERSONA}\n\n${MODE_ROLES[mode] || MODE_ROLES.tutor}\n\n${parts.join('\n\n')}`.trim();
  return { system, baremItem: null };
}

// ─── Agentul PDF: VERIFICAREA răspunsului față de rezolvarea-model ────────────
// Garanția cerută: elevul primește rezolvarea DIN BAREM, nu alta. Generăm,
// verificăm (numeric + semantic), regenerăm o dată dacă a deviat; dacă și a
// doua încercare deviază, prezentăm direct pașii din barem (fallback sigur).

// numerele „străine": apar în răspuns (≥2 cifre), dar nu apar nici în rezolvare,
// nici în enunț/test/întrebare — semn de metodă improvizată (ex. 81/256).
// Zecimalele compuse din cifre permise (ex. „3,5" din fracția 7/2 spartă la
// extracție) NU sunt străine — altfel respingeam răspunsuri corecte.
function foreignNums(reply, allowedText) {
  const nums = (s) => String(s || '').match(/\d+(?:[.,]\d+)?/g) || [];
  const allowed = new Set(nums(allowedText).flatMap((n) => [n, ...n.split(/[.,]/)]));
  const isAllowed = (n) => {
    if (n.length < 2 || allowed.has(n)) return true;
    const parts = n.split(/[.,]/);
    return parts.length > 1 && parts.every((p) => p.length < 2 || allowed.has(p));
  };
  return [...new Set(nums(reply))].filter((n) => !isAllowed(n));
}

// verificarea numerică (deterministă, gratuită). UN singur număr nou poate fi
// un calcul intermediar legitim (extracția pierde fracții) — improvizația
// reală aduce MAI MULTE numere străine (ex. 81 și 256). BLOCANTĂ.
function numericCheck(reply, baremItem) {
  const foreign = foreignNums(reply, baremItem.allowed || baremItem.barem);
  if (foreign.length >= 2) {
    return { ok: false, motiv: `folosește numere care nu apar în rezolvare: ${foreign.slice(0, 4).join(', ')}` };
  }
  return { ok: true };
}

// verificarea semantică (LLM ieftin) — prinde metode/expresii schimbate
// (ex. „m^2-3" devenit „m-3"). DOAR CONSULTATIVĂ: pe fragmente deteriorate de
// extracție dă fals-pozitive, deci poate cere o regenerare, dar nu poate
// împinge elevul pe fallback-ul cu text brut.
async function semanticCheck(reply, baremItem) {
  try {
    const sys = 'Ești verificator de fidelitate. Primești REZOLVAREA-MODEL a unui exercițiu și RĂSPUNSUL unui profesor către elev. Răspunsul poate fi doar o îndrumare (primul pas) sau rezolvarea completă — ambele sunt în regulă. ATENȚIE: textul rezolvării-model provine din extracție automată din PDF și poate avea fracții sau expresii sparte pe rânduri ori simboluri pierdute — dacă răspunsul le reconstruiește coerent (ex. „(3+4)/2 = 7/2" acolo unde textul arată cifre împrăștiate), NU e deviere. Verifică: metoda și rezultatele răspunsului sunt cele din rezolvarea-model (atenție la exponenți și semne: m^2-3 NU e totuna cu m-3)? Dacă răspunsul introduce ALTĂ metodă, ALTE valori sau ALTE concluzii decât cele din rezolvare, e deviere. Răspunde DOAR cu JSON: {"ok":true} sau {"ok":false,"motiv":"<pe scurt ce a deviat>"}.';
    const user = `REZOLVAREA-MODEL:\n"""${String(baremItem.barem).slice(0, 3500)}"""\n\nRĂSPUNSUL PROFESORULUI:\n"""${String(reply).slice(0, 3500)}"""`;
    const { data: p } = await chatJson({
      system: sys, messages: [{ role: 'user', content: user }], temperature: 0, maxTokens: 200,
      schema: S.obj({ ok: S.bool(), motiv: S.nullable(S.str('pe scurt ce a deviat; null dacă ok')) }), schemaName: 'verificare_fidelitate',
    });
    if (p && p.ok === false) return { ok: false, motiv: String(p.motiv || 'a deviat de la rezolvare').slice(0, 160) };
  } catch (e) { console.warn('pdfReplyCheck:', e.message); }
  return { ok: true };
}

// ── Verificarea la GRILE / răspuns scurt (EN): concluzia trebuie să fie cea
// oficială. Calculele intermediare ale profesorului sunt ale lui (numerele „noi"
// sunt firești aici), dar o ALTĂ literă / alt rezultat anunțate drept răspuns
// corect = deviere BLOCANTĂ. Lipsa concluziei = doar o regenerare.
const CLAIM_RES = [
  /r[ăa]spunsul?\s+(?:corect\s+|final\s+|bun\s+)?(?:este|e|va\s+fi|ar\s+fi)\s*:?\s*(?:litera\s*|varianta\s*)?\(?([a-d])\)(?![a-zăâîșț])/gi,
  /r[ăa]spunsul?\s+(?:corect\s+|final\s+|bun\s+)?(?:este|e|va\s+fi|ar\s+fi)\s*:?\s*(?:litera|varianta)\s+([a-d])(?![a-zăâîșț])/gi,
  /(?:varianta|litera)\s+corect[ăa]\s+(?:este|e)\s*:?\s*\(?([a-d])\)?(?![a-zăâîșț])/gi,
];
function shortAnswerCheck(reply, baremItem, mode) {
  const r = String(reply || '');
  if (baremItem.kind === 'grila') {
    const want = String(baremItem.litera || '').toLowerCase();
    const claims = CLAIM_RES.flatMap((re) => [...r.matchAll(re)].map((m) => m[1].toLowerCase()));
    const wrong = claims.filter((l) => l !== want);
    if (wrong.length) return { hard: `anunță răspunsul ${wrong[0]}) în loc de litera oficială ${want})`, soft: null };
    if (!claims.length && mode !== 'hint') return { hard: null, soft: `nu a încheiat cu „Răspunsul corect este litera ${want})"` };
    return { hard: null, soft: null };
  }
  // rezultat scurt: trebuie să apară în răspuns (comparăm fără spații/decorațiuni)
  const flat = (s) => String(s || '').replace(/\\left|\\right|\\,|\$/g, '').replace(/\s+/g, '').toLowerCase();
  const want = flat(baremItem.raspuns);
  if (mode !== 'hint' && want && !flat(r).includes(want)) return { hard: null, soft: `nu apare rezultatul oficial (${baremItem.raspuns})` };
  return { hard: null, soft: null };
}

// fallback determinist: pașii baremului, prezentați direct (fără punctaje).
// Textul extras din PDF poate conține „moloz" de la fracțiile sparte pe
// rânduri (linii doar cu cifre/simboluri) — le eliminăm, nu ajută elevul.
function fragmentFallback(baremItem, mode) {
  if (baremItem.kind === 'grila' || baremItem.kind === 'rezultat') {
    const oficial = baremItem.kind === 'grila' ? `litera ${baremItem.litera})` : baremItem.raspuns;
    if (mode === 'hint') {
      return `Uite un indiciu: recitește cu atenție cerința${baremItem.kind === 'grila' ? ' și variantele de răspuns' : ''}, apoi rezolvă pas cu pas pe caiet — spune-mi ce obții și verificăm împreună.\n\nReformulez mai simplu sau mai detaliat?`;
    }
    return `Răspunsul corect este ${oficial}.\n\nRezolvă exercițiul pe caiet și verifică dacă obții ${baremItem.kind === 'grila' ? `varianta ${baremItem.litera})` : 'acest rezultat'}; dacă vrei, scrie-mi „explică-mi pașii" și îl rezolvăm împreună, pas cu pas.\n\nReformulez mai simplu sau mai detaliat?`;
  }
  const clean = String(baremItem.barem)
    .replace(/\b\d+\s*p(?:uncte)?\.?(?=\s|$)/gi, '')
    .split(/\n+/)
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l && !(l.length < 14 && !/[a-zA-ZăâîșțĂÂÎȘȚ]{2,}/.test(l))) // fără resturi de fracții
    .join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (mode === 'hint') {
    const first = (clean.split(/\n+/)[0] || clean).slice(0, 300);
    return `Uite de unde să pornești: ${first}\n\nÎncearcă pasul acesta și spune-mi ce obții.\n\nReformulez mai simplu sau mai detaliat?`;
  }
  return `Hai să vedem rezolvarea, pas cu pas (redactarea poate fi imperfectă — textul vine direct din document):\n\n${clean}\n\nSpune-mi „explică pasul 1" (sau alt pas) și ți-l detaliez cu toate calculele.\n\nReformulez mai simplu sau mai detaliat?`;
}

// ── Cereri de tip „explică altfel" (reformulare / altă abordare) ─────────────
// Elevul cere DELIBERAT altă formulare, alt nivel de detaliu sau altă
// perspectivă — verificările stricte de fidelitate ar respinge exact ce a
// cerut (alt exemplu = alte numere), deci pentru aceste mesaje ele se opresc.
const OTHER_EXPLANATION_RE = /\breformul|alta metoda|alt mod|altfel|alta abordare|alta explicatie|alt exemplu|alta perspectiva|mai simplu|mai detaliat|mai multe detalii|detaliaza|pe scurt|mai scurt|rezuma|ca la un copil|ca unui copil|ca la prosti|pentru copii|nu inteleg|n am inteles|nu am inteles|tot nu|inca o data|din nou|repeta|tot raspunsul/;
const wantsOtherExplanation = (text) => OTHER_EXPLANATION_RE.test(norm(String(text || '')));

// generare + verificare + o reîncercare + fallback — folosit de ai-chat și
// ai-chat-stream când itemul de barem a fost extras (răspunsul se bufferizează).
// Reguli de decizie:
//  - BLOCANTE (pot duce la fallback-ul cu pașii bruți): răspuns gol/trunchiat
//    și verificarea numerică (≥2 numere străine = improvizație certă).
//  - CONSULTATIVĂ (doar cere o regenerare): verificarea semantică — pe
//    fragmente deteriorate de extracție dă fals-pozitive, iar un răspuns bine
//    redactat nu trebuie înlocuit cu text brut din cauza ei.
//  - RELAXARE: la NELĂMURIRI ulterioare (baremItem.followUp — testul e sursa
//    principală, cu libertate de explicare) și la cererile de REFORMULARE,
//    verificările de fidelitate se sar (doar răspunsul gol rămâne blocant) —
//    prima explicație a unui exercițiu rămâne strict verificată față de barem.
async function verifiedPdfReply({ system, messages, baremItem, mode = 'tutor', maxTokens = 900, model = PDF_MODEL, tools = null, stats = null }) {
  const gen = (sys) => chat({ system: sys, messages, temperature: 0.2, maxTokens, model, tools, stats });
  const isEmpty = (t) => !String(t || '').trim() || String(t).trim().length < 20;
  // marcajele de figuri ([[FIGURA:{...}]]) conțin numere (poziții, unghiuri) —
  // nu sunt „numere din răspuns": le scoatem înaintea verificărilor
  const noFig = (t) => String(t || '').replace(/\[\[FIGURA:[\s\S]*?\]\]/g, '');
  const lastUser = [...messages].reverse().find((m) => m && m.role === 'user');
  const relaxed = !!(baremItem && baremItem.followUp) || wantsOtherExplanation(lastUser && textOfContent(lastUser.content)); // conținutul poate fi listă (text + pagina PDF)

  const attempt = async (sys) => {
    const g = await gen(sys);
    if (isEmpty(g.text)) return { ...g, hard: 'răspuns gol sau trunchiat', soft: null };
    // grilă / rezultat scurt (EN): ALTĂ literă / alt rezultat anunțate drept
    // corecte = deviere și la reformulări (concluzia oficială nu se negociază)
    if (baremItem && (baremItem.kind === 'grila' || baremItem.kind === 'rezultat')) {
      const k = shortAnswerCheck(noFig(g.text), baremItem, mode);
      return { ...g, hard: k.hard, soft: relaxed ? null : k.soft };
    }
    if (relaxed) return { ...g, hard: null, soft: null }; // reformulare cerută explicit
    const n = numericCheck(noFig(g.text), baremItem);
    if (!n.ok) return { ...g, hard: n.motiv, soft: null };
    const s = await semanticCheck(noFig(g.text), baremItem);
    return { ...g, hard: null, soft: s.ok ? null : s.motiv };
  };

  const first = await attempt(system);
  let usage = { in: first.usage.in, out: first.usage.out, model };
  if (!first.hard && !first.soft) return { text: first.text, usage, verified: true };

  const motiv = first.hard || first.soft;
  console.warn('verifiedPdfReply: prima încercare —', motiv);
  const shortKind = baremItem && (baremItem.kind === 'grila' || baremItem.kind === 'rezultat');
  const harder = shortKind
    ? `${system}\n\nATENȚIE: încercarea anterioară a greșit concluzia (${motiv}). Scrie din nou răspunsul: rezolvarea ta pas cu pas, care conduce la ${baremItem.kind === 'grila' ? `litera ${baremItem.litera})` : `rezultatul ${baremItem.raspuns}`}, și ÎNCHEIE EXACT cu „Răspunsul corect este ${baremItem.kind === 'grila' ? `litera ${baremItem.litera})` : baremItem.raspuns}".`
    : `${system}\n\nATENȚIE: încercarea anterioară a deviat de la rezolvare (${motiv}). Scrie din nou răspunsul STRICT pe pașii, expresiile și rezultatele REZOLVĂRII de mai sus, fără nicio abatere și fără numere din altă parte.`;
  const second = await attempt(harder);
  usage = { in: usage.in + second.usage.in, out: usage.out + second.usage.out, model };
  if (!second.hard && !second.soft) return { text: second.text, usage, verified: true };

  // best-effort: un răspuns care a trecut de verificările BLOCANTE e mai bun
  // decât textul brut, chiar dacă verificatorul semantic încă „cârtește".
  if (!second.hard) {
    console.warn('verifiedPdfReply: trimit a doua încercare (semantic nesigur:', second.soft, ')');
    return { text: second.text, usage, verified: false };
  }
  if (!first.hard) {
    console.warn('verifiedPdfReply: trimit prima încercare (semantic nesigur:', first.soft, ')');
    return { text: first.text, usage, verified: false };
  }
  console.warn('verifiedPdfReply: ambele încercări blocate (', first.hard, '/', second.hard, ') → fallback pe pașii baremului');
  return { text: fragmentFallback(baremItem, mode), usage, verified: false };
}

module.exports = {
  CORS, applyCors, admin, authUser, requireAdmin, signedUrlFromPublic, isCronRequest,
  chat, chatStream, chatVision, embed, transcribe, retrieve, topMaterial, routeForCategory, contextBlock, systemFor, prepareChat, PERSONA,
  dropLastTurn, loadHistory, // „Regenerează" (exportate pentru teste)
  chatJson, S, deepRestoreLatex, restoreLatexControl, parseJsonLoose, buildBody, adaptBodyToError, answerIndex, // Structured Outputs
  extractBaremItem, fragmentFromBarem, verifiedPdfReply, wantsOtherExplanation, isFollowUpQuestion,
  deterministicBaremItem, shortAnswerCheck, fragmentFallback, pdfAgentSystem, // grile / rezultat scurt (EN) — exportate pentru teste
  levelLabel, interactiveCatalog, studentState, meditatiiMemory,
  createNotification, teachersOf, mentorsOf,
  requireUser, isPremium, requirePremium, enforceFreeQuota, enforceRateLimit, logUsage, signToken, verifyToken, sha256,
  hasEmbeddings, hasChat, hasSTT, EMBED_DIM, CHAT_MODEL, EMBED_MODEL, VISION_MODEL, STT_MODEL, FREE_ACTIONS, PDF_MODEL, GEN_MODEL,
  TUTOR_MODEL, TUTOR_MODES, REASONING_EFFORT, chatModelFor, isNewGenModel, pdfPageAttachments, refFromConversation,
  runToolCall, TOOL_ROUNDS,
  // limite de consum (vezi GHID_LIMITE_AI.md)
  pickModel, budgetInfo, costMicroLei, priceFor, dayStartBucharest, ECON_CHAT_MODEL, USD_RON,
  // cote per funcție + pachete top-up (pasul 2); per rol + pool comun
  enforceFeatureQuota, FEATURE_QUOTAS, topupPacks, TOPUP_DAYS, quotasForRole, allocateQuotas,
  // credite AI (unitatea afișată elevului: 100 credite = 1 leu de buget)
  CREDITS_PER_LEU, leiToCredits, fmtCredits,
  // folosit de _lib/pregen.js ca tonul explicațiilor pre-generate să fie identic cu chatul (pasul 3)
  MODE_ROLES,
};
// (integrare Profesor Virtual ↔ exerciții interactive: levelLabel, interactiveCatalog, studentState — vezi mai sus)
