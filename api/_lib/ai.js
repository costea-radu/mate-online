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

// ─── Configurare furnizor (chat + embeddings sunt independente) ──────────────
const CHAT_BASE  = process.env.AI_CHAT_BASE_URL  || 'https://api.openai.com/v1';
const CHAT_KEY   = process.env.AI_CHAT_API_KEY   || process.env.OPENAI_API_KEY || '';
const CHAT_MODEL = process.env.AI_CHAT_MODEL     || 'gpt-4o-mini';
// Model cu vedere (foto-rezolvare). gpt-4o-mini suportă imagini.
const VISION_MODEL = process.env.AI_VISION_MODEL || (/4o|vision|gpt-5|sonnet|gemini/i.test(CHAT_MODEL) ? CHAT_MODEL : 'gpt-4o-mini');

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
const { CORS, applyCors, admin, authUser, requireAdmin, signedUrlFromPublic } = http;

const hasEmbeddings = () => !!EMBED_KEY;
const hasChat = () => !!CHAT_KEY;

// ─── Apel LLM (chat completions, format OpenAI) ──────────────────────────────
async function chat({ system, messages = [], temperature = 0.4, maxTokens = 900, json = false }) {
  if (!hasChat()) throw new Error('AI_CHAT_API_KEY (sau OPENAI_API_KEY) nu este setat.');
  const body = {
    model: CHAT_MODEL,
    temperature,
    max_tokens: maxTokens,
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
  };
  if (json) body.response_format = { type: 'json_object' };

  const r = await fetch(`${CHAT_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CHAT_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`LLM ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  const text = data.choices?.[0]?.message?.content ?? '';
  const usage = {
    in: data.usage?.prompt_tokens || 0,
    out: data.usage?.completion_tokens || 0,
  };
  return { text, usage };
}

// ─── Apel LLM în STREAMING (async generator de fragmente text) ───────────────
async function* chatStream({ system, messages = [], temperature = 0.5, maxTokens = 900 }) {
  if (!hasChat()) throw new Error('AI_CHAT_API_KEY (sau OPENAI_API_KEY) nu este setat.');
  const body = {
    model: CHAT_MODEL, temperature, max_tokens: maxTokens, stream: true,
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
  };
  const r = await fetch(`${CHAT_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CHAT_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`LLM ${r.status}: ${t.slice(0, 300)}`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
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
      if (data === '[DONE]') return;
      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* keepalive/parțial — ignorăm */ }
    }
  }
}

// ─── Apel LLM cu VEDERE (foto-rezolvare: citește o imagine) ──────────────────
async function chatVision({ system, text, imageDataUrl, maxTokens = 800, temperature = 0.1 }) {
  if (!hasChat()) throw new Error('AI_CHAT_API_KEY (sau OPENAI_API_KEY) nu este setat.');
  const body = {
    model: VISION_MODEL, temperature, max_tokens: maxTokens,
    messages: [
      ...(system ? [{ role: 'system', content: system }] : []),
      { role: 'user', content: [
        { type: 'text', text: text || 'Transcrie exercițiul din imagine.' },
        { type: 'image_url', image_url: { url: imageDataUrl } },
      ] },
    ],
  };
  const r = await fetch(`${CHAT_BASE}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CHAT_KEY}` },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Vision ${r.status}: ${t.slice(0, 300)}`);
  }
  const data = await r.json();
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    usage: { in: data.usage?.prompt_tokens || 0, out: data.usage?.completion_tokens || 0 },
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

// ─── Recuperare context (RAG): vectorial, cu fallback lexical ────────────────
// Boost pe tip de sursă, în funcție de scop:
//  prefer='solution' (explicații în chat) → barem/rezolvări primele
//  prefer='exercise' (generare) → exercițiile-model primele
const SOURCE_BOOST = {
  solution: { solution: 0.20, exercise: 0.05, manual: 0.02 },
  exercise: { exercise: 0.16, solution: 0.08, manual: 0.03 },
};

async function retrieve(supa, { query, category = null, allowPremium = false, k = 6, prefer = null }) {
  if (!query || !query.trim()) return [];
  const fetchN = Math.min(k * 3, 24);
  let docs = [];
  // 1. Semantic (dacă avem embeddings)
  if (hasEmbeddings()) {
    try {
      const qvec = await embed(query);
      if (qvec) {
        const { data, error } = await supa.rpc('match_ai_knowledge', {
          query_embedding: qvec, match_count: fetchN, filter_category: category, allow_premium: allowPremium,
        });
        if (!error && data) docs = data;
      }
    } catch (e) { console.warn('Vector retrieve failed, fallback lexical:', e.message); }
  }
  // 2. Lexical (fallback)
  if (!docs.length) {
    try {
      const { data, error } = await supa.rpc('match_ai_knowledge_lexical', {
        query_text: query, match_count: fetchN, filter_category: category, allow_premium: allowPremium,
      });
      if (!error && data) docs = data;
    } catch (e) { console.warn('Lexical retrieve failed:', e.message); }
  }
  if (!docs.length) return [];
  // Re-ranking după scop (barem vs exercițiu-model)
  const boost = SOURCE_BOOST[prefer] || {};
  return docs
    .map((d) => ({ ...d, _score: (d.similarity || 0) + (boost[d.source_type] || 0) }))
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
    return `${head}\n${(d.title ? d.title + ' — ' : '')}${(d.content || '').slice(0, 1200)}`;
  }).join('\n\n');
}

// ─── Persona + reguli ale tutorelui (română) ─────────────────────────────────
const PERSONA = `Ești "Profesorul Virtual" de pe ExamenMate, un profesor de matematică român, calm, încurajator și răbdător, pentru elevi de clasele 5–12, Evaluare Națională și Bacalaureat.
Reguli:
- Răspunzi DOAR în limba română, clar și la nivelul elevului.
- Te bazezi pe MATERIALELE DIN CONTEXT pentru stilul de explicație, notații și tipurile de exerciții. Dacă în context apar exemple, urmează-le stilul.
- Scrii formulele în LaTeX: între $...$ pentru inline și $$...$$ pe rând separat. Exemple: $x^2$, $\\frac{a}{b}$, $\\sqrt{2}$, $\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$. Restul textului rămâne în română normală. IMPORTANT: conținutul dintre $$...$$ stă pe UN SINGUR rând, fără Enter în interior.
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
- Rezolvări: /rezolvari
- Biblioteca utilizatorilor (teste publice ale profesorilor): /biblioteca-utilizatorilor
- Clasele 5–12: /clase/5 … /clase/12
- Contul tău — rezultatele elevilor asociați, RAPORTUL AI pe subiecte, grupe și codul de asociere: /profil
- Asistentul AI / generare de subiecte și exerciții: /profesor-virtual`;

// Recomandare activă pentru ELEVI: testele și exercițiile interactive din site.
const STUDENT_TIP = `RECOMANDARE ACTIVĂ (pentru elevi): când elevul cere ajutor la învățat, la exersat sau la pregătirea pentru examen/teză (ex. „vreau să învăț fracțiile", „cum mă pregătesc pentru Evaluare?", „dă-mi exerciții"), pe lângă explicația ta, RECOMANDĂ-I testele și exercițiile INTERACTIVE de pe site: spune-i că acolo se verifică pe loc, primește REZOLVĂRI IMEDIATE și EXPLICAȚII la fiecare întrebare, și vede instant ce a greșit. Dă link-ul intern potrivit (relativ):
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

function systemFor(mode, ctxBlock, extra = '') {
  const mentor = mode === 'exams' || mode === 'students';
  const persona = mentor ? MENTOR_PERSONA : PERSONA;
  const base = `${persona}\n\n=== MATERIALE DIN BAZA DE DATE (context RAG) ===\n${ctxBlock}\n=== SFÂRȘIT CONTEXT ===\n${mentor ? '\n' + SITE_MAP + '\n' : '\n' + STUDENT_TIP + '\n'}`;
  const byMode = {
    assistant: 'Rol: asistent al platformei. Ajuți cu întrebări despre matematică ȘI despre folosirea site-ului (exerciții, abonament, rezolvări). Răspunsuri scurte și utile.',
    tutor: 'Rol: profesor. Explică pas cu pas, cu un exemplu scurt, apoi verifică înțelegerea printr-o întrebare. Încurajează elevul.',
    explain: 'Rol: explică TEORIA subiectului cerut, structurat: definiție → idee cheie → formulă → un exemplu rezolvat scurt. Folosește stilul din context.',
    hint: 'Rol: dai UN SINGUR indiciu pentru pasul următor. NU dezvălui rezolvarea completă și NU da răspunsul final. Termină cu o întrebare care îl ghidează pe elev mai departe.',
    exams: 'Rol: ajuți profesorul/părintele cu EXAMENELE (Evaluare Națională, Bacalaureat): unde sunt subiectele, variantele, baremele și simulările, structura probelor, idei de plan de lecție. Dă pași scurți și LINK-uri interne. Poți răspunde și la matematică.',
    students: 'Rol: ajuți cu ELEVII asociați: unde vezi rezultatele lor și RAPORTUL AI pe subiecte (în /profil), cum asociezi un elev prin cod, cum folosești grupele și ce teme le poți trimite. Dă pași clari și LINK-uri interne.',
  };
  return `${base}\n${byMode[mode] || byMode.tutor}\n${extra}`.trim();
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

async function enforceRateLimit(supa, userId) {
  const since = new Date(Date.now() - 3600 * 1000).toISOString();
  const { count } = await supa.from('ai_usage').select('*', { count: 'exact', head: true })
    .eq('user_id', userId).gte('created_at', since);
  if ((count || 0) >= RATE_PER_HOUR) {
    const e = new Error(`Ai atins limita de ${RATE_PER_HOUR} cereri AI pe oră. Încearcă din nou mai târziu.`);
    e.status = 429; throw e;
  }
}
async function logUsage(supa, userId, endpoint, usage = {}) {
  try { await supa.from('ai_usage').insert({ user_id: userId, endpoint, tokens_in: usage.in || 0, tokens_out: usage.out || 0 }); }
  catch { /* nu blocăm răspunsul pentru logare */ }
}

// ─── Token semnat (generator efemer: păstrează răspunsul fără DB) ────────────
function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
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
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
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
Reguli pedagogice STRICTE pentru această sesiune:
- Implicit NU dezvălui răspunsul unui pas nerezolvat — ghidezi prin întrebări și pași mici.
- EXCEPȚIE (are prioritate): dacă elevul îți cere EXPLICIT răspunsul final (ex. „spune-mi răspunsul", „dă-mi rezultatul", „care e soluția?", „zi-mi direct cât face"), i-l dai CONCRET și complet, împreună cu TOȚI pașii rezolvării până la el, în ordine, clar și concis. La final încurajează-l scurt să încerce singur un pas sau un exercițiu asemănător. La fel după ce problema a fost corectată: explici liber rezolvarea completă.
- Pornește de la INDICAȚIA OFICIALĂ a pasului curent: reformuleaz-o natural și prietenos, ca un profesor la tablă — nu o cita mecanic. Abia dacă elevul tot nu înțelege, explică altfel, cu alt exemplu.
- Dacă elevul a greșit un pas: arată UNDE e greșeala și DE CE e greșeală, apoi sugerează metoda corectă.
- Când elevul îți cere să-i verifici pașii: confirmă ce e corect, corectează delicat ce nu e, pas cu pas.
- Răspunsuri scurte (3–8 rânduri), câte UN pas o dată; termină des cu o întrebare care îl duce mai departe.`;

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
async function prepareChat(supa, { userId, message, mode = 'tutor', conversationId = null, context = {}, premium = false }) {
  // 1. RAG (întrebarea + textul exercițiului, dacă există)
  const retrievalQuery = [message, context.exerciseText].filter(Boolean).join('\n');
  const docs = await retrieve(supa, {
    query: retrievalQuery, category: context.category || null,
    allowPremium: premium, k: 6, prefer: 'solution',
  });
  const ctxBlock = contextBlock(docs);
  const primaryMaterial = await topMaterial(supa, docs);

  // 2. Conversație: o reluăm (dacă e a userului) sau o creăm.
  let convId = conversationId || null;
  if (convId) {
    const { data } = await supa.from('ai_conversations').select('id, user_id').eq('id', convId).single();
    if (!data || data.user_id !== userId) convId = null;
  }
  if (!convId) {
    const { data } = await supa.from('ai_conversations')
      .insert({ user_id: userId, title: message.slice(0, 60), context }).select('id').single();
    convId = data?.id;
  }

  // 3. Istoric recent (ultimele 10 mesaje)
  const { data: history } = await supa.from('ai_messages')
    .select('role, content').eq('conversation_id', convId)
    .order('created_at', { ascending: false }).limit(10);
  const priorMsgs = (history || []).reverse().map((m) => ({ role: m.role, content: m.content }));

  // 4. System prompt (nivel + exercițiu curent + reguli interactive + catalog + motivare)
  const mentor = mode === 'exams' || mode === 'students';
  const parts = [];
  const lvl = levelLabel(context);
  if (lvl) parts.push(`NIVELUL ELEVULUI: ${lvl}. Adaptează limbajul, notațiile, exemplele și profunzimea explicațiilor la acest nivel.`);
  if (context.exerciseText) {
    const cap = context.interactive ? 3500 : 1500;
    parts.push(`Elevul lucrează la acest exercițiu:\n"""${String(context.exerciseText).slice(0, cap)}"""`);
  }
  if (context.interactive) {
    parts.push(INTERACTIVE_RULES);
    parts.push(ACTION_PROTOCOL);
  }
  // catalogul de exerciții e util tuturor (elevi ȘI profesori/părinți);
  // starea de progres + motivarea sunt doar pentru elevi
  const [catalog, state] = await Promise.all([
    interactiveCatalog(supa, context.category || null),
    mentor ? Promise.resolve('') : studentState(supa, userId),
  ]);
  if (catalog) parts.push(catalog);
  if (state) parts.push(state);
  const system = systemFor(mode, ctxBlock, parts.length ? '\n' + parts.join('\n\n') : '');

  const sources = docs.map((d) => ({ type: d.source_type, title: d.title, topic: d.topic, category: d.category }));
  return { docs, ctxBlock, primaryMaterial, convId, priorMsgs, system, sources };
}

module.exports = {
  CORS, applyCors, admin, authUser, requireAdmin, signedUrlFromPublic,
  chat, chatStream, chatVision, embed, transcribe, retrieve, topMaterial, routeForCategory, contextBlock, systemFor, prepareChat, PERSONA,
  levelLabel, interactiveCatalog, studentState,
  createNotification, teachersOf, mentorsOf,
  requireUser, isPremium, requirePremium, enforceFreeQuota, enforceRateLimit, logUsage, signToken, verifyToken, sha256,
  hasEmbeddings, hasChat, hasSTT, EMBED_DIM, CHAT_MODEL, EMBED_MODEL, VISION_MODEL, STT_MODEL, FREE_ACTIONS,
};
// (integrare Profesor Virtual ↔ exerciții interactive: levelLabel, interactiveCatalog, studentState — vezi mai sus)
