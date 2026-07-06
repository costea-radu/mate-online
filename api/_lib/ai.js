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
const FREE_ACTIONS = parseInt(process.env.AI_FREE_ACTIONS || '1', 10); // acțiuni AI gratuite pentru cont fără abonament
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
- Scrii formulele în LaTeX: între $...$ pentru inline și $$...$$ pe rând separat. Exemple: $x^2$, $\\frac{a}{b}$, $\\sqrt{2}$, $\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}$. Restul textului rămâne în română normală.
- Explici pas cu pas, numerotat, cu un exemplu scurt când ajută.
- Nu inventezi formule sau rezultate; dacă nu ești sigur, spui sincer și explici metoda generală. Nu inventezi surse.
SIGURANȚĂ (vorbești cu minori):
- Rămâi STRICT pe teme educaționale (matematică și folosirea platformei). Refuzi politicos orice subiect nepotrivit, periculos sau fără legătură cu școala și readuci discuția la învățare.
- Folosești limbaj potrivit vârstei, fără conținut nepotrivit.
- Scopul tău e ca elevul să ÎNVEȚE: la teme îl ghidezi spre soluție prin pași și întrebări, nu îi dai pur și simplu răspunsul de copiat.`;

function systemFor(mode, ctxBlock, extra = '') {
  const base = `${PERSONA}\n\n=== MATERIALE DIN BAZA DE DATE (context RAG) ===\n${ctxBlock}\n=== SFÂRȘIT CONTEXT ===\n`;
  const byMode = {
    assistant: 'Rol: asistent al platformei. Ajuți cu întrebări despre matematică ȘI despre folosirea site-ului (exerciții, abonament, rezolvări). Răspunsuri scurte și utile.',
    tutor: 'Rol: profesor. Explică pas cu pas, cu un exemplu scurt, apoi verifică înțelegerea printr-o întrebare. Încurajează elevul.',
    explain: 'Rol: explică TEORIA subiectului cerut, structurat: definiție → idee cheie → formulă → un exemplu rezolvat scurt. Folosește stilul din context.',
    hint: 'Rol: dai UN SINGUR indiciu pentru pasul următor. NU dezvălui rezolvarea completă și NU da răspunsul final. Termină cu o întrebare care îl ghidează pe elev mai departe.',
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
    throw premiumError(`Ai folosit acțiunea gratuită cu Profesorul Virtual. Abonează-te pentru acces nelimitat (explicații, exerciții, foto-rezolvare, voce și teste de examen).`);
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

  // 4. System prompt
  const extra = context.exerciseText
    ? `\nElevul lucrează la acest exercițiu:\n"""${String(context.exerciseText).slice(0, 1500)}"""`
    : '';
  const system = systemFor(mode, ctxBlock, extra);

  const sources = docs.map((d) => ({ type: d.source_type, title: d.title, topic: d.topic, category: d.category }));
  return { docs, ctxBlock, primaryMaterial, convId, priorMsgs, system, sources };
}

module.exports = {
  CORS, applyCors, admin, authUser, requireAdmin, signedUrlFromPublic,
  chat, chatStream, chatVision, embed, transcribe, retrieve, topMaterial, routeForCategory, contextBlock, systemFor, prepareChat, PERSONA,
  createNotification, teachersOf, mentorsOf,
  requireUser, isPremium, requirePremium, enforceFreeQuota, enforceRateLimit, logUsage, signToken, verifyToken, sha256,
  hasEmbeddings, hasChat, hasSTT, EMBED_DIM, CHAT_MODEL, EMBED_MODEL, VISION_MODEL, STT_MODEL, FREE_ACTIONS,
};
