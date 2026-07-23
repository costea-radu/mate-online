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
const { parseExerciseRef, sliceExercise, formatRef } = require('./barem'); // localizare deterministă item

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

// Model separat (opțional) pentru agentul de teste PDF — fidelitatea față de
// barem cere un model bun; setează AI_PDF_CHAT_MODEL (ex. gpt-5.6-terra) în env.
const PDF_MODEL = process.env.AI_PDF_CHAT_MODEL || CHAT_MODEL;
// Model separat (opțional) pentru GENERAREA de teste/exerciții și CORECTAREA
// răspunsurilor — acolo modelul calculează singur (fără barem), deci greșelile
// de calcul ajung direct „răspuns oficial". Setează AI_GEN_CHAT_MODEL în env.
const GEN_MODEL = process.env.AI_GEN_CHAT_MODEL || CHAT_MODEL;

// ─── Compatibilitate parametri între generațiile de modele ───────────────────
// Modelele noi OpenAI (gpt-5.x, o1/o3/o4...) REFUZĂ `max_tokens` (cer
// `max_completion_tokens`) și unele refuză `temperature` ≠ 1. Construim
// corpul potrivit după numele modelului și, ca plasă de siguranță, reparăm
// automat la eroarea 400 „unsupported parameter" și reîncercăm o dată.
const isNewGenModel = (m) => /\bgpt-5|^o[1-9]\b|\bo[1-9]-/i.test(String(m || ''));
function buildBody({ model, temperature, maxTokens, messages, system, json, stream }) {
  const body = { model, messages: system ? [{ role: 'system', content: system }, ...messages] : messages };
  if (isNewGenModel(model)) {
    // Modelele cu raționament „ard" tokeni pe gândirea internă ÎNAINTE de a
    // scrie răspunsul; cu bugetul clasic (900–5000) rămân des cu răspuns GOL
    // sau trunchiat (JSON invalid). Le dăm spațiu de raționament: 3× bugetul,
    // minim 3000, plafonat la 16000.
    body.max_completion_tokens = Math.min(Math.max(maxTokens * 3, 3000), 16000);
  } else { body.max_tokens = maxTokens; body.temperature = temperature; }
  if (json) body.response_format = { type: 'json_object' };
  if (stream) body.stream = true;
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
  if (/response_format/.test(t) && body.response_format) { delete body.response_format; changed = true; }
  return changed;
}
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
async function chat({ system, messages = [], temperature = 0.4, maxTokens = 900, json = false, model = CHAT_MODEL }) {
  if (!hasChat()) throw new Error('AI_CHAT_API_KEY (sau OPENAI_API_KEY) nu este setat.');
  const body = buildBody({ model, temperature, maxTokens, messages, system, json });
  let r = await postLLM(body);
  let data = await r.json();
  let text = data.choices?.[0]?.message?.content ?? '';
  const usage = {
    in: data.usage?.prompt_tokens || 0,
    out: data.usage?.completion_tokens || 0,
  };
  // AUTO-VINDECARE: modelele cu raționament pot epuiza tot bugetul pe gândire
  // și întorc conținut GOL (finish_reason=length). Reîncercăm O dată cu
  // bugetul maxim — altfel apar „format invalid" / fallback-uri inutile.
  if (!String(text).trim() && isNewGenModel(model) && (body.max_completion_tokens || 0) < 16000) {
    console.warn(`chat: răspuns gol la ${model} (finish=${data.choices?.[0]?.finish_reason || '?'}) — reîncerc cu buget maxim`);
    body.max_completion_tokens = 16000;
    r = await postLLM(body);
    data = await r.json();
    text = data.choices?.[0]?.message?.content ?? '';
    usage.in += data.usage?.prompt_tokens || 0;
    usage.out += data.usage?.completion_tokens || 0;
  }
  return { text, usage };
}

// ─── Apel LLM în STREAMING (async generator de fragmente text) ───────────────
async function* chatStream({ system, messages = [], temperature = 0.5, maxTokens = 900, model = CHAT_MODEL }) {
  if (!hasChat()) throw new Error('AI_CHAT_API_KEY (sau OPENAI_API_KEY) nu este setat.');
  const body = buildBody({ model, temperature, maxTokens, messages, system, stream: true });
  const r = await postLLM(body);
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

// Rolurile pe moduri — folosite de AMBII agenți (interactiv și PDF).
const MODE_ROLES = {
  assistant: 'Rol: asistent al platformei. Ajuți cu întrebări despre matematică ȘI despre folosirea site-ului (exerciții, abonament, rezolvări). Răspunsuri scurte și utile.',
  tutor: 'Rol: profesor. Explică pas cu pas, cu un exemplu scurt, apoi verifică înțelegerea printr-o întrebare. Încurajează elevul.',
  explain: 'Rol: explică TEORIA subiectului cerut, structurat: definiție → idee cheie → formulă → un exemplu rezolvat scurt. Folosește stilul din context.',
  hint: 'Rol: dai UN SINGUR indiciu pentru pasul următor. NU dezvălui rezolvarea completă și NU da răspunsul final. Termină cu o întrebare care îl ghidează pe elev mai departe.',
  exams: 'Rol: ajuți profesorul/părintele cu EXAMENELE (Evaluare Națională, Bacalaureat): unde sunt subiectele, variantele, baremele și simulările, structura probelor, idei de plan de lecție. Dă pași scurți și LINK-uri interne. Poți răspunde și la matematică.',
  students: 'Rol: ajuți cu ELEVII asociați: unde vezi rezultatele lor și RAPORTUL AI pe subiecte (în /profil), cum asociezi un elev prin cod, cum folosești grupele și ce teme le poți trimite. Dă pași clari și LINK-uri interne.',
};

function systemFor(mode, ctxBlock, extra = '') {
  const mentor = mode === 'exams' || mode === 'students';
  const persona = mentor ? MENTOR_PERSONA : PERSONA;
  const base = `${persona}\n\n=== MATERIALE DIN BAZA DE DATE (context RAG) ===\n${ctxBlock}\n=== SFÂRȘIT CONTEXT ===\n${mentor ? '\n' + SITE_MAP + '\n' : '\n' + STUDENT_TIP + '\n'}`;
  return `${base}\n${MODE_ROLES[mode] || MODE_ROLES.tutor}\n${extra}`.trim();
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
IDENTIFICAREA EXERCIȚIULUI: contextul include și CONȚINUTUL COMPLET AL TESTULUI (toate exercițiile, cu numerele și subiectele lor). Când elevul spune „exercițiul 3", „subiectul II, 2.b", „problema cu matricea" etc., CAUTĂ exercițiul EXACT în acest conținut și lucrează pe enunțul lui REAL — nu inventa niciodată un enunț. Dacă nu îl găsești, spune-i ce exerciții vezi în test și cere-i să confirme la care se referă.
Reguli pedagogice STRICTE pentru această sesiune:
- Implicit NU dezvălui răspunsul unui pas nerezolvat — ghidezi prin întrebări și pași mici.
- EXCEPȚIE (are prioritate): dacă elevul îți cere EXPLICIT răspunsul final (ex. „spune-mi răspunsul", „dă-mi rezultatul", „care e soluția?", „zi-mi direct cât face"), i-l dai CONCRET și complet, împreună cu TOȚI pașii rezolvării până la el, în ordine, clar și concis. La final încurajează-l scurt să încerce singur un pas sau un exercițiu asemănător. La fel după ce problema a fost corectată: explici liber rezolvarea completă.
- Pornește de la INDICAȚIA OFICIALĂ a pasului curent: reformuleaz-o natural și prietenos, ca un profesor la tablă — nu o cita mecanic. Abia dacă elevul tot nu înțelege, explică altfel, cu alt exemplu.
- Dacă elevul a greșit un pas: arată UNDE e greșeala și DE CE e greșeală, apoi sugerează metoda corectă.
- Când elevul îți cere să-i verifici pașii: confirmă ce e corect, corectează delicat ce nu e, pas cu pas.
- Răspunsuri scurte (3–8 rânduri), câte UN pas o dată; termină des cu o întrebare care îl duce mai departe.`;

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
- Linkurile către paginile site-ului le scrii mereu RELATIVE, în format markdown: [Titlu](/cale) — ex: [Rezolvări](/rezolvari). NICIODATĂ cu domeniu; adresa „examenmate.ro" NU există.
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
- Dacă o formulă pare deteriorată în textul extras: când ai rezolvarea-model, folosește forma expresiilor de acolo (ea repetă expresiile enunțului) și mergi mai departe natural, FĂRĂ să-i ceri elevului confirmări; fără rezolvarea-model, spui sincer ce ai înțeles și îl rogi să confirme datele sau să fotografieze exercițiul cu butonul 📷.
- Dacă exercițiul cerut nu apare deloc în textul extras (PDF scanat sau trunchiat): spune-i sincer și propune-i să-l fotografieze ori să-l scrie în chat.`;

// ─── Agentul PDF: reguli pentru rezolvarea-model (baremul) asociată ──────────
const PDF_BAREM_RULES = `REZOLVAREA-MODEL de mai sus este SURSA TA DE ADEVĂR — are prioritate absolută față de orice altă metodă sau amintire a ta.
Reguli STRICTE:
- La ORICE întrebare despre un exercițiu din test, PRIMUL pas este să găsești itemul corespunzător în rezolvarea-model (același subiect, același număr de exercițiu, aceeași literă) și să-l citești integral.
- VERIFICI potrivirea: itemul găsit trebuie să repete expresiile și numerele enunțului din test. Dacă NU corespunde (alte valori, altă cerință, altă variantă), spui explicit că pentru acest exercițiu nu ai o rezolvare verificată în platformă, rezolvi singur foarte atent (verifici de două ori fiecare calcul) și recomanzi secțiunea [Rezolvări](/rezolvari). NU folosești un item nepotrivit.
- EXPLICAȚIA TA = pașii rezolvării-model POVESTIȚI natural, ca metoda ta de la clasă: la fiecare pas spui CE facem și DE CE, cu ACELEAȘI relații, ACELEAȘI calcule și ACELEAȘI rezultate intermediare și finale. NU improvizezi altă metodă, NU sari peste pași, NU rezumi.
- CUVÂNTUL „barem" NU apare în răspunsurile tale, și nici formulări ca „conform baremului", „baremul spune", „rezolvarea oficială/model indică". Predai metoda ca fiind a ta, ca la tablă. Excepție unică: elevul întreabă EXPLICIT despre barem sau despre punctaje — doar atunci poți vorbi deschis despre el.
- VERIFICARE FINALĂ OBLIGATORIE: înainte de a încheia răspunsul, compară rezultatul tău final cu cel din rezolvarea-model. Dacă diferă, răspunsul tău e greșit — refă-l înainte să-l trimiți.
- NU amesteci rezolvări de la alte variante, alte profiluri sau alți ani. Sursa ta este DOAR baza de date a platformei — nu trimite elevul pe alte site-uri.
- PEDAGOGIE: implicit dai ÎNDRUMARE — primul pas, reformulat prietenos, fără rezultatul final, încheiat cu o întrebare care îl duce mai departe. Rezolvarea COMPLETĂ (toți pașii, în ordine, până la rezultatul final) o dai când elevul o cere explicit (ex. „spune-mi răspunsul", „rezolvă tot", „dă-mi soluția completă", „nu înțeleg, arată-mi rezolvarea").`;

const BAREM_MISSING = `BAREM: pentru acest test NU am găsit în platformă baremul corespunzător (sau potrivirea era nesigură — decât baremul greșit, mai bine niciunul). Dacă elevul cere explicații „din barem": spune-i sincer că baremul nu e disponibil în platformă pentru acest test, rezolvă atent pas cu pas (verifică de două ori fiecare calcul) și recomandă-i secțiunea [Rezolvări](/rezolvari) sau celelalte materiale din platformă. NU trimite elevul pe site-uri externe.`;

// Persona SCURTĂ pentru promptul focalizat (enunț + rezolvare, nimic altceva).
// Un prompt mic = modelul nu are din ce să improvizeze și urmează fidel pașii.
const PDF_FOCUS_PERSONA = `Ești „Profesorul Virtual" de pe ExamenMate — profesor de matematică român, calm, prietenos și răbdător. Elevul are deschis un test PDF și te-a întrebat despre un exercițiu anume. Mai jos ai ENUNȚUL exercițiului și REZOLVAREA lui — aceasta este SINGURA metodă pe care o predai; tu doar o POVESTEȘTI natural, ca la tablă.
Reguli:
- Răspunzi DOAR în limba română, clar și la nivelul elevului.
- Formulele în LaTeX: $...$ inline sau $$...$$ pe rând separat (conținutul dintre $$...$$ stă pe UN singur rând). Folosește NUMAI acești delimitatori.
- COPIEZI expresiile EXACT, cu exponenți și semne intacte: dacă în rezolvare scrie $m^2-3$, scrii $m^2-3$, NU $m-3$; dacă scrie $(x_1x_2x_3x_4)^2$, păstrezi puterea a 2-a.
- Terminologie școlară: „descompunere în factori", NU „factorizare".
- Rămâi strict pe teme educaționale, cu limbaj potrivit minorilor.`;

// Reguli SCURTE și imperative pentru rezolvarea-model extrasă (itemul exact).
// Stau la FINALUL promptului — acolo modelul le respectă cel mai bine.
const PDF_ITEM_RULES = `AȘA RĂSPUNZI ACUM (obligatoriu):
- ÎNCEPI răspunsul numind exercițiul și reluând pe scurt cerința lui din enunț (ex. „La subiectul III, exercițiul 2 b), trebuie să arătăm că…") — exact cerința din ENUNȚUL de mai sus, nu alta.
- Rezolvarea de mai sus este SINGURA metodă pe care o predai la acest exercițiu. Nu improviza alta.
- Elevul vrea un INDICIU sau nu știe cum să înceapă? → DOAR primul pas, reformulat prietenos ca îndrumare, FĂRĂ rezultatul final; închei cu o întrebare care îl duce mai departe.
- Elevul cere explicit explicația sau rezolvarea completă? → prezinți TOȚI pașii, în ordinea lor, numerotați: la fiecare spui CE facem și DE CE și scrii calculul cu formulele lui (în LaTeX). Rezultatele intermediare și finale sunt EXACT cele de mai sus. Închei cu rezultatul final, clar.
- STRICT INTERZIS: să anunți rezultatul fără să fi arătat toți pașii până la el; să folosești altă metodă; să adaugi pași, condiții sau „verificări" care nu apar în rezolvare; să scrii cuvântul „barem" ori formulări ca „conform baremului...", „baremul indică...", „rezolvarea oficială..." (excepție: elevul întreabă explicit de barem sau punctaje).
- Model CORECT de răspuns complet: „Pasul 1: scriem vectorii de poziție, pentru că... $...$; Pasul 2: egalăm coordonatele... $...$; deci rezultatul este $...$". Model GREȘIT: „Conform baremului, rezultatul este $12$".`;

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

// ── Extrage din barem rezolvarea EXERCIȚIULUI ÎNTREBAT (focalizare) ──────────
// Baremul întreg are mii de caractere și modelul „se pierde" în el. Un pas
// separat, ieftin, identifică exercițiul din întrebare și copiază identic
// fragmentul lui de barem; promptul principal primește apoi FIX rezolvarea.
async function extractBaremItem({ message, priorMsgs = [], subjectText = '', baremText = '' }) {
  if (!hasChat() || !baremText) return null;
  try {
    const prior = priorMsgs.filter((m) => m.role === 'user').slice(-2).map((m) => m.content).join('\n');
    const sys = 'Primești întrebarea unui elev despre un test, textul testului și BAREMUL testului. Identifică exercițiul la care se referă întrebarea (folosește și mesajele anterioare dacă întrebarea e vagă), apoi: (1) extrage din TEST, CUVÂNT CU CUVÂNT, enunțul acelui exercițiu; (2) extrage din BAREM, CUVÂNT CU CUVÂNT, fragmentul care rezolvă EXACT acel exercițiu (toate rândurile lui, cu exponenții și semnele intacte). Răspunde DOAR cu JSON: {"exercitiu":"II.2.b","enunt":"<enunțul copiat identic din test>","barem":"<fragmentul copiat identic din barem>"}. Dacă întrebarea nu se referă la un exercițiu anume, răspunde {"exercitiu":null,"enunt":"","barem":""}.';
    const user = `ÎNTREBAREA ELEVULUI: ${String(message).slice(0, 600)}\n\nMESAJELE ANTERIOARE ALE ELEVULUI (context): ${prior || '—'}\n\nTESTUL:\n"""${String(subjectText).slice(0, 9000)}"""\n\nBAREMUL:\n"""${String(baremText).slice(0, 11000)}"""`;
    const { text } = await chat({ system: sys, messages: [{ role: 'user', content: user }], temperature: 0, maxTokens: 1100, json: true, model: PDF_MODEL });
    const parsed = JSON.parse(text);
    const frag = parsed && parsed.barem ? String(parsed.barem).trim() : '';
    if (frag.length > 20 && fragmentFromBarem(frag, baremText)) {
      // enunțul e acceptat doar dacă provine într-adevăr din textul testului
      const en = parsed.enunt ? String(parsed.enunt).trim() : '';
      const enOk = en.length > 10 && fragmentFromBarem(en, subjectText);
      return { exercitiu: parsed.exercitiu || null, enunt: enOk ? en.slice(0, 1500) : null, barem: frag.slice(0, 3500) };
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
async function prepareChat(supa, { userId, message, mode = 'tutor', conversationId = null, context = {}, premium = false }) {
  const isPdfAgent = !!context.pdf;
  const hasBarem = !!(context.pdf && context.baremText);

  // 1. RAG (întrebarea + textul exercițiului, dacă există).
  //    Agentul PDF cu rezolvare-model NU primește alte materiale — ar dilua
  //    sursa de adevăr; sursa afișată elevului este chiar baremul asociat.
  let docs = [], ctxBlock = '', primaryMaterial = null;
  if (!hasBarem) {
    const retrievalQuery = [message, context.exerciseText].filter(Boolean).join('\n');
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

  // 3. Istoric recent (ultimele 10 mesaje)
  const { data: history } = await supa.from('ai_messages')
    .select('role, content').eq('conversation_id', convId)
    .order('created_at', { ascending: false }).limit(10);
  const priorMsgs = (history || []).reverse().map((m) => ({ role: m.role, content: m.content }));

  // 4. System prompt — construit de agentul potrivit.
  let system, baremItem = null;
  if (isPdfAgent) {
    const built = await pdfAgentSystem(supa, { userId, mode, context, message, priorMsgs, ctxBlock });
    system = built.system;
    baremItem = built.baremItem;
  } else {
    system = await interactiveAgentSystem(supa, { userId, mode, context, ctxBlock });
  }

  const sources = hasBarem
    ? [{ type: 'solution', title: context.baremTitle || 'Baremul oficial al testului', topic: null, category: context.category || null }]
    : docs.map((d) => ({ type: d.source_type, title: d.title, topic: d.topic, category: d.category }));
  return { docs, ctxBlock, primaryMaterial, convId, priorMsgs, system, sources, baremItem };
}

// ─── AGENTUL 1: exerciții interactive + chat general (comportament NESCHIMBAT) ─
async function interactiveAgentSystem(supa, { userId, mode, context, ctxBlock }) {
  const mentor = mode === 'exams' || mode === 'students';
  const parts = [];
  const lvl = levelLabel(context);
  if (lvl) parts.push(`NIVELUL ELEVULUI: ${lvl}. Adaptează limbajul, notațiile, exemplele și profunzimea explicațiilor la acest nivel.`);
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
      const frag = sliceExercise(context.baremText, ref);
      if (frag) {
        const enunt = sliceExercise(context.exerciseText || '', ref);
        baremItem = { exercitiu: formatRef(ref), enunt: enunt ? enunt.slice(0, 1500) : null, barem: frag.slice(0, 3500) };
      }
    }
    if (!baremItem) {
      baremItem = await extractBaremItem({ message, priorMsgs, subjectText: context.exerciseText || '', baremText: context.baremText });
    }
  }

  // Pasul 2a: PROMPT FOCALIZAT — avem rezolvarea exactă a exercițiului întrebat.
  if (baremItem) {
    baremItem.allowed = [context.exerciseText, baremItem.enunt, baremItem.barem, message]
      .filter(Boolean).join('\n'); // pentru verificarea anti-deviere (numere permise)
    const system = [
      PDF_FOCUS_PERSONA,
      MODE_ROLES[mode] || MODE_ROLES.tutor,
      lvlLine,
      `EXERCIȚIUL${baremItem.exercitiu ? ` ${baremItem.exercitiu}` : ''} din testul „${context.title || 'PDF'}" — ENUNȚUL:\n"""${baremItem.enunt || '(enunțul nu a putut fi izolat din test — folosește forma expresiilor așa cum apare în rezolvarea de mai jos)'}"""`,
      `REZOLVAREA LUI (document intern — elevul NU îl vede; predă-l ca metoda ta):\n"""${baremItem.barem}"""`,
      PDF_ITEM_RULES,
    ].filter(Boolean).join('\n\n');
    return { system, baremItem };
  }

  // Pasul 2b: fără item sigur → promptul amplu (test întreg + barem întreg).
  const parts = [];
  if (lvlLine) parts.push(lvlLine);
  parts.push(`TESTUL DESCHIS: „${context.title || 'material PDF'}". TEXTUL LUI COMPLET (extras automat):\n"""${String(context.exerciseText || '').slice(0, 20000)}"""`);
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
    parts.push(`REZOLVAREA-MODEL a testului deschis (document intern pentru tine — elevul NU îl vede; NU îl numi „barem" în răspuns):\n"""${String(context.baremText).slice(0, 12000)}"""`);
    parts.push(PDF_BAREM_RULES);
  } else {
    parts.push(BAREM_MISSING);
  }
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

async function pdfReplyCheck({ reply, baremItem }) {
  // 1) verificarea numerică (deterministă, gratuită). UN singur număr nou poate
  //    fi un calcul intermediar legitim (extracția pierde fracții) — improvizația
  //    reală aduce MAI MULTE numere străine (ex. 81 și 256).
  const foreign = foreignNums(reply, baremItem.allowed || baremItem.barem);
  if (foreign.length >= 2) {
    return { ok: false, motiv: `folosește numere care nu apar în rezolvare: ${foreign.slice(0, 4).join(', ')}` };
  }
  // 2) verificarea semantică (LLM ieftin) — prinde metode/expresii schimbate
  //    (ex. „m^2-3" devenit „m-3"); dacă verificatorul pică, nu blocăm.
  try {
    const sys = 'Ești verificator de fidelitate. Primești REZOLVAREA-MODEL a unui exercițiu și RĂSPUNSUL unui profesor către elev. Răspunsul poate fi doar o îndrumare (primul pas) sau rezolvarea completă — ambele sunt în regulă. ATENȚIE: textul rezolvării-model provine din extracție automată din PDF și poate avea fracții sau expresii sparte pe rânduri ori simboluri pierdute — dacă răspunsul le reconstruiește coerent (ex. „(3+4)/2 = 7/2" acolo unde textul arată cifre împrăștiate), NU e deviere. Verifică: metoda și rezultatele răspunsului sunt cele din rezolvarea-model (atenție la exponenți și semne: m^2-3 NU e totuna cu m-3)? Dacă răspunsul introduce ALTĂ metodă, ALTE valori sau ALTE concluzii decât cele din rezolvare, e deviere. Răspunde DOAR cu JSON: {"ok":true} sau {"ok":false,"motiv":"<pe scurt ce a deviat>"}.';
    const user = `REZOLVAREA-MODEL:\n"""${String(baremItem.barem).slice(0, 3500)}"""\n\nRĂSPUNSUL PROFESORULUI:\n"""${String(reply).slice(0, 3500)}"""`;
    const { text } = await chat({ system: sys, messages: [{ role: 'user', content: user }], temperature: 0, maxTokens: 200, json: true });
    const p = JSON.parse(text);
    if (p && p.ok === false) return { ok: false, motiv: String(p.motiv || 'a deviat de la rezolvare').slice(0, 160) };
  } catch (e) { console.warn('pdfReplyCheck:', e.message); }
  return { ok: true };
}

// fallback determinist: pașii baremului, prezentați direct (fără punctaje).
// Textul extras din PDF poate conține „moloz" de la fracțiile sparte pe
// rânduri (linii doar cu cifre/simboluri) — le eliminăm, nu ajută elevul.
function fragmentFallback(baremItem, mode) {
  const clean = String(baremItem.barem)
    .replace(/\b\d+\s*p(?:uncte)?\.?(?=\s|$)/gi, '')
    .split(/\n+/)
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .filter((l) => l && !(l.length < 14 && !/[a-zA-ZăâîșțĂÂÎȘȚ]{2,}/.test(l))) // fără resturi de fracții
    .join('\n')
    .replace(/\n{3,}/g, '\n\n').trim();
  if (mode === 'hint') {
    const first = (clean.split(/\n+/)[0] || clean).slice(0, 300);
    return `Uite de unde să pornești: ${first}\n\nÎncearcă pasul acesta și spune-mi ce obții.`;
  }
  return `Hai să vedem rezolvarea, pas cu pas (redactarea poate fi imperfectă — textul vine direct din document):\n\n${clean}\n\nSpune-mi „explică pasul 1" (sau alt pas) și ți-l detaliez cu toate calculele.`;
}

// generare + verificare + o reîncercare + fallback — folosit de ai-chat și
// ai-chat-stream când itemul de barem a fost extras (răspunsul se bufferizează).
async function verifiedPdfReply({ system, messages, baremItem, mode = 'tutor', maxTokens = 900 }) {
  const gen = (sys) => chat({ system: sys, messages, temperature: 0.2, maxTokens, model: PDF_MODEL });
  // răspuns gol/trunchiat (modelele cu raționament pot epuiza bugetul) = eșec
  const checked = async (reply) => {
    if (!String(reply || '').trim() || String(reply).trim().length < 30) {
      return { ok: false, motiv: 'răspuns gol sau trunchiat' };
    }
    return pdfReplyCheck({ reply, baremItem });
  };
  const first = await gen(system);
  let usage = { in: first.usage.in, out: first.usage.out };
  const c1 = await checked(first.text);
  if (c1.ok) return { text: first.text, usage, verified: true };

  console.warn('verifiedPdfReply: prima încercare a deviat —', c1.motiv);
  const harder = `${system}\n\nATENȚIE: încercarea anterioară a deviat de la rezolvare (${c1.motiv}). Scrie din nou răspunsul STRICT pe pașii, expresiile și rezultatele REZOLVĂRII de mai sus, fără nicio abatere și fără numere din altă parte.`;
  const second = await gen(harder);
  usage = { in: usage.in + second.usage.in, out: usage.out + second.usage.out };
  const c2 = await checked(second.text);
  if (c2.ok) return { text: second.text, usage, verified: true };

  console.warn('verifiedPdfReply: și a doua încercare a deviat —', c2.motiv, '→ fallback pe pașii baremului');
  return { text: fragmentFallback(baremItem, mode), usage, verified: false };
}

module.exports = {
  CORS, applyCors, admin, authUser, requireAdmin, signedUrlFromPublic,
  chat, chatStream, chatVision, embed, transcribe, retrieve, topMaterial, routeForCategory, contextBlock, systemFor, prepareChat, PERSONA,
  extractBaremItem, fragmentFromBarem, verifiedPdfReply,
  levelLabel, interactiveCatalog, studentState,
  createNotification, teachersOf, mentorsOf,
  requireUser, isPremium, requirePremium, enforceFreeQuota, enforceRateLimit, logUsage, signToken, verifyToken, sha256,
  hasEmbeddings, hasChat, hasSTT, EMBED_DIM, CHAT_MODEL, EMBED_MODEL, VISION_MODEL, STT_MODEL, FREE_ACTIONS, PDF_MODEL, GEN_MODEL,
};
// (integrare Profesor Virtual ↔ exerciții interactive: levelLabel, interactiveCatalog, studentState — vezi mai sus)
