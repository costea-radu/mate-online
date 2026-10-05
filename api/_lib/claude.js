// =====================================================================
// api/_lib/claude.js — client pentru API-ul Anthropic (Claude).
// Folosit de agenții noi din admin (generator exerciții, SEO/marketing).
// Env necesare (Vercel → Settings → Environment Variables):
//   ANTHROPIC_API_KEY  — cheia de la console.anthropic.com
//   CLAUDE_MODEL       — opțional, implicit 'claude-sonnet-5'
// Fallback: dacă ANTHROPIC_API_KEY lipsește, folosește providerul existent
// (ai.chat), ca agenții să funcționeze și fără cheie.
// =====================================================================
const KEY = process.env.ANTHROPIC_API_KEY || '';
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5';

// Modelele dintre care adminul poate alege în agenți (selectorul din admin).
// ATENȚIE: lista e oglindită în src/lib/aiModels.js (folosită de selectoarele
// din AISEOAgent, AIExerciseAgent și task-urile programate) — ține-le sincron.
// ID-urile sunt cele oficiale Anthropic (verificate pe platform.claude.com,
// 5 octombrie 2026): generația CURENTĂ e Opus 5.5 (4/20 $ pe milion de tokeni —
// mai ieftin decât Opus 5, la 5/25 $), Sonnet 5.5 (2/10 $) și Fable 5.1
// (10/50 $); Sonnet 5 / Opus 5 / Fable 5 rămân active (retragere nu mai devreme
// de iunie–iulie 2027); Haiku 4.5 e cel mai rapid/ieftin; 4.6/4.8 sunt
// snapshot-urile anterioare. Implicitul serverului (CLAUDE_MODEL) a rămas
// Sonnet 5, ca agenții existenți să nu-și schimbe costul fără să vrei.
// TOATE funcționează cu ACEEAȘI cheie ANTHROPIC_API_KEY — nu e nevoie de
// chei separate per model; modelul se alege per cerere în câmpul `model`.
const MODELS = [
  { id: 'claude-opus-5-5',   label: 'Opus 5.5',   note: 'generația curentă Opus — cel mai bun raport calitate/preț pentru verificări matematice și cod' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5', note: 'generația curentă Sonnet — rapid, jumătate din prețul lui Opus 5.5' },
  { id: 'claude-fable-5-1',  label: 'Fable 5.1',  note: 'cel mai capabil model public — cel mai scump (2,5× Opus 5.5)' },
  { id: 'claude-sonnet-5',   label: 'Sonnet 5',   note: 'rapid și echilibrat — implicit' },
  { id: 'claude-opus-5',     label: 'Opus 5',     note: 'foarte capabil — mai lent și mai scump' },
  { id: 'claude-fable-5',    label: 'Fable 5',    note: 'cel mai nou și mai capabil model (iunie 2026) — cel mai scump' },
  { id: 'claude-haiku-4-5',  label: 'Haiku 4.5',  note: 'cel mai rapid și mai ieftin — pentru sarcini simple' },
  { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6', note: 'generația anterioară Sonnet' },
  { id: 'claude-opus-4-8',   label: 'Opus 4.8',   note: 'generația anterioară Opus' },
];

// Modelul efectiv al unei rulări: cel cerut de admin (doar dacă e în lista de
// mai sus — nu trimitem string-uri arbitrare către API), altfel implicitul.
function resolveModel(requested) {
  const id = String(requested || '').trim();
  return MODELS.some((m) => m.id === id) ? id : MODEL;
}

// `schema` (opțional): JSON Schema strict → Structured Outputs Anthropic
// (`output_config.format`, GA — fără header beta): JSON garantat valid. Dacă
// API-ul respinge formatul (schemă nesuportată), apiCall reîncearcă fără el.
async function chatClaude({ system, messages = [], temperature = 0.7, maxTokens = 3000, model = null, schema = null }) {
  if (!KEY) {
    const ai = require('./ai');
    // Fallback-ul (format OpenAI) nu suportă blocuri compuse (ex: PDF) —
    // păstrăm doar textul din ele.
    const flat = messages.map((m) => ({
      role: m.role,
      content: Array.isArray(m.content)
        ? m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
        : m.content,
    }));
    if (schema) {
      const r = await ai.chatJson({ system, messages: flat, temperature, maxTokens, schema, schemaName: 'claude_fallback', restoreLatex: false });
      return { text: r.text, usage: r.usage, provider: 'fallback:' + (ai.CHAT_MODEL || 'openai'), data: r.data };
    }
    const r = await ai.chat({ system, messages: flat, temperature, maxTokens });
    return { text: r.text, usage: r.usage, provider: 'fallback:' + (ai.CHAT_MODEL || 'openai') };
  }

  const useModel = resolveModel(model);
  const r = await apiCall({
    model: useModel,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: maxTokens,
    ...(schema ? { output_config: { format: { type: 'json_schema', schema } } } : {}),
  });

  const usage = {
    prompt_tokens: r.data.usage?.input_tokens || 0,
    completion_tokens: r.data.usage?.output_tokens || 0,
    model: useModel, // necesar pt. costul corect în ai.logUsage (altfel cost 0)
  };
  return { text: r.text, usage, provider: useModel, stopReason: r.stop };
}

// ─── Apelul brut către API (partajat de chatClaude și chatClaudeTools) ───────
async function apiCallOnce(body) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    // Notă: modelele Claude recente nu mai acceptă `temperature` — nu îl trimitem.
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  const text = (data.content || []).filter((bl) => typeof bl.text === 'string').map((bl) => bl.text).join('');
  return { ok: res.ok, status: res.status, data, text, stop: data.stop_reason || null };
}

// Modelele Claude recente „gândesc” înainte să răspundă, iar gândirea
// consumă din max_tokens (de aceea buget mic → text gol, stop=max_tokens).
// Strategie: (1) cerem gândirea dezactivată — tot bugetul merge pe răspuns;
// (2) dacă modelul nu permite, dăm buget suplimentar pentru gândire;
// (3) dacă și așa a consumat tot (fără unelte cerute), reîncercare cu buget dublu.
async function apiCall(body) {
  const maxTokens = body.max_tokens || 3000;
  let r = await apiCallOnce({ ...body, max_tokens: maxTokens, thinking: { type: 'disabled' } });
  // Structured Outputs respinse (schemă cu elemente nesuportate / model fără
  // suport) → reîncercăm FĂRĂ output_config; apelantul parsează tolerant
  // (extractJson), exact ca înainte.
  if (!r.ok && r.status === 400 && body.output_config && /output_config|json_schema|schema|format/i.test(String(r.data?.error?.message || ''))) {
    console.warn('claude: output_config.format respins (%s) — reîncerc fără schemă', r.data?.error?.message || r.status);
    const { output_config, ...rest } = body; // eslint-disable-line no-unused-vars
    body = rest;
    r = await apiCallOnce({ ...body, max_tokens: maxTokens, thinking: { type: 'disabled' } });
  }
  // Reîncercarea fără `thinking` are sens DOAR când chiar parametrul thinking a
  // fost respins — alte erori 400 (ex. „This model does not support assistant
  // message prefill”) trebuie să iasă imediat, ca apelantul să schimbe metoda
  // (exgen.chatClaudeLong trece pe continuarea prin mesaj de utilizator).
  if (!r.ok && r.status === 400 && /thinking/i.test(String(r.data?.error?.message || ''))) {
    console.warn('claude: thinking:disabled respins (%s) — reîncerc cu buget extins', r.data?.error?.message || r.status);
    r = await apiCallOnce({ ...body, max_tokens: maxTokens + 10000 });
  }
  const wantsTool = (r.data?.content || []).some((bl) => bl.type === 'tool_use');
  if (r.ok && r.stop === 'max_tokens' && !r.text.trim() && !wantsTool) {
    console.warn('claude: gândirea a consumat tot bugetul — reîncerc cu buget dublu');
    r = await apiCallOnce({ ...body, max_tokens: Math.min((maxTokens + 10000) * 2, 64000) });
  }
  if (!r.ok) {
    const msg = r.data?.error?.message || `Claude API ${r.status}`;
    const err = new Error(msg); err.status = r.status === 429 ? 429 : 502;
    throw err;
  }
  return r;
}

// Mesaj adăugat când o rundă rămâne tăiată chiar și după reluări cu buget
// dublat: altfel adminul rămânea cu un preambul care sună a reușită („Scriu
// articolul complet.") și cu coada de aprobare goală, fără niciun indiciu.
const TRUNCATED_NOTE = '\n\n⚠️ Răspunsul s-a oprit la limita de buget (max_tokens), așa că ULTIMA acțiune (de obicei trimiterea articolului prin publish_article) nu a mai apucat să plece. Cere reluarea sarcinii — eventual cu un articol mai scurt.';

// ─── Bucla agentică cu UNELTE (tool use) — Faza 1, GHID_AGENT_SEO_ACTIUNI ────
// Rulează conversația cât timp modelul cere unelte: execută funcția prin
// `executeTool(name, input)`, adaugă rezultatul în conversație și continuă.
// `executeTool` întoarce un string (rezultatul pentru model); erorile lui devin
// text de eroare pentru model (bucla nu se oprește la o unealtă eșuată).
// Se oprește după `maxIters` runde de unelte, cu o cerere finală de raport.
async function chatClaudeTools({ system, messages = [], tools = [], executeTool, maxTokens = 3000, maxIters = 8, model = null }) {
  if (!KEY) {
    const e = new Error('Uneltele agentului au nevoie de ANTHROPIC_API_KEY (providerul fallback nu suportă bucla de unelte).');
    e.status = 501; e.code = 'NO_ANTHROPIC_KEY';
    throw e;
  }
  const useModel = resolveModel(model);
  const msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  const usage = { prompt_tokens: 0, completion_tokens: 0, model: useModel };
  const track = (r) => {
    usage.prompt_tokens += r.data.usage?.input_tokens || 0;
    usage.completion_tokens += r.data.usage?.output_tokens || 0;
  };
  let toolCalls = 0;
  let lastText = '';

  for (let iter = 0; iter < maxIters; iter++) {
    let budget = maxTokens;
    let r = await apiCall({ model: useModel, system, messages: msgs, tools, max_tokens: budget });
    track(r);
    // Rundă TĂIATĂ de buget (`stop_reason = max_tokens`): de regulă modelul
    // scria tocmai ARGUMENTUL unei unelte (ex. articolul întreg din
    // publish_article, 600–1500 de cuvinte), iar blocul tool_use rămâne
    // incomplet. Verificarea `stop !== 'tool_use'` de mai jos l-ar arunca
    // TĂCUT — deci reluăm runda cu buget dublat înainte să renunțăm.
    // (Reluarea e sigură: încă nu s-a executat nicio unealtă din runda asta.)
    for (let retry = 0; retry < 2 && r.stop === 'max_tokens'; retry++) {
      budget = Math.min(budget * 2, 64000);
      console.warn('claude(tools): rundă tăiată la max_tokens — reiau cu buget %d', budget);
      r = await apiCall({ model: useModel, system, messages: msgs, tools, max_tokens: budget });
      track(r);
    }
    const content = r.data.content || [];
    if (r.text.trim()) lastText = r.text;
    const uses = content.filter((bl) => bl.type === 'tool_use');
    if (r.stop !== 'tool_use' || !uses.length) {
      const cut = r.stop === 'max_tokens' ? TRUNCATED_NOTE : '';
      return { text: (lastText + cut).trim(), usage, provider: useModel, toolCalls, stopReason: r.stop };
    }

    // Păstrăm conținutul asistentului EXACT cum a venit (inclusiv blocurile de
    // gândire, dacă există) — API-ul cere asta pentru continuarea buclei.
    msgs.push({ role: 'assistant', content });
    const results = [];
    for (const u of uses) {
      toolCalls++;
      let out;
      try { out = await executeTool(u.name, u.input || {}); }
      catch (err) { out = `EROARE la ${u.name}: ${err.message}`; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: String(out ?? '').slice(0, 20000) });
    }
    if (iter === maxIters - 1) {
      results.push({ type: 'text', text: 'Ai atins limita de unelte pentru această rulare. Încheie ACUM cu raportul final (fără alte unelte); propunerile trimise deja rămân în coada de aprobare.' });
    }
    msgs.push({ role: 'user', content: results });
  }

  // Plafonul de iterații atins → o ultimă cerere pentru concluzie.
  const fin = await apiCall({ model: useModel, system, messages: msgs, tools, max_tokens: maxTokens });
  track(fin);
  return {
    text: fin.text.trim() || lastText || '(Limita de unelte a fost atinsă — vezi propunerile din coada de aprobare.)',
    usage, provider: useModel, toolCalls, stopReason: 'max_iterations',
  };
}

// Extrage JSON (obiect sau array) dintr-un răspuns de model, tolerant la
// ```json fences și la backslash-uri LaTeX neescapate.
function extractJson(text) {
  let s = String(text || '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const first = s.search(/[[{]/);
  if (first === -1) return null;
  const open = s[first];
  const close = open === '[' ? ']' : '}';
  const last = s.lastIndexOf(close);
  if (last <= first) return null;
  s = s.slice(first, last + 1);
  try { return JSON.parse(s); } catch { /* încearcă reparat */ }
  const fixed = s.replace(/\\(?![\\/"bfnrtu])/g, '\\\\');
  try { return JSON.parse(fixed); } catch { /* încearcă închis */ }
  return closeAndParse(fixed) || closeAndParse(s);
}

// Repară un JSON TRUNCHIAT (răspuns tăiat la limita de lungime): taie până la
// ultimul obiect complet și închide parantezele rămase deschise.
function closeAndParse(input) {
  for (let cut = input.length; cut > 0; cut = input.lastIndexOf('}', cut - 1)) {
    const part = input.slice(0, cut === input.length ? cut : cut + 1);
    let inStr = false, escNext = false;
    const stack = [];
    for (const ch of part) {
      if (escNext) { escNext = false; continue; }
      if (ch === '\\') { escNext = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{' || ch === '[') stack.push(ch);
      else if (ch === '}' || ch === ']') stack.pop();
    }
    if (inStr) continue;
    let candidate = part.replace(/,\s*$/, '');
    for (let i = stack.length - 1; i >= 0; i--) candidate += stack[i] === '{' ? '}' : ']';
    try { return JSON.parse(candidate); } catch { /* mai taie */ }
    if (cut === input.length) cut = input.length; // prima iterație: continuă cu lastIndexOf
  }
  return null;
}

// ═════════════════════════════════════════════════════════════════════════════
// APELURI „AVANSATE" — pentru agenții lungi din Admin (verificarea materialelor,
// agentul de debug): STREAMING + gândire adaptivă + effort + cache de prompt.
//
// De ce streaming: fără el, antetele răspunsului vin abia când modelul a
// terminat, iar fetch-ul din Node (undici) renunță după 300 s de așteptare —
// un model care gândește atent la un test întreg (18 itemi) sau care citește
// mult cod trece ușor de 5 minute. Cu streaming antetele vin imediat, iar
// fiecare bucată de răspuns ține conexiunea vie.
// De ce gândire adaptivă: la verificarea matematicii modelul TREBUIE să
// rezolve singur fiecare item înainte să judece cheia; „effort" spune cât de
// mult (low…max). Opus 5.5 nu mai acceptă `thinking: disabled` (eroare 400).
// De ce cache: bucla de unelte retrimite toată conversația la fiecare pas;
// cu cache, prefixul deja văzut costă 5–10% din prețul de intrare.
// ═════════════════════════════════════════════════════════════════════════════
const API_URL = 'https://api.anthropic.com/v1/messages';
const ADAPTIVE_RE = /^claude-(opus|sonnet|fable|mythos)-5/;
const supportsAdaptive = (model) => ADAPTIVE_RE.test(String(model || ''));
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'];

// Prețul cache-ului, ca fracțiune din prețul de intrare (platform.claude.com,
// octombrie 2026): scrierea (5 min) 1,25×; citirea 0,1× în general, 0,05× la
// Opus 5.5 și 0,025× la Fable / Mythos 5.1.
function cacheReadMult(model) {
  const m = String(model || '');
  if (/opus-5-5/.test(m)) return 0.05;
  if (/(fable|mythos)-5-1/.test(m)) return 0.025;
  return 0.1;
}
// Tokenii de intrare „echivalenți" la prețul de bază — ca ai.logUsage (care
// știe doar in/out) să calculeze costul corect și când o parte vine din cache.
function effectiveInput(model, u = {}) {
  return Math.round((u.input_tokens || 0) + 1.25 * (u.cache_creation_input_tokens || 0)
    + cacheReadMult(model) * (u.cache_read_input_tokens || 0));
}
function costUsd(model, u = {}) {
  let p = null;
  try { p = require('./ai').priceFor(model); } catch { p = null; }
  if (!p || p.perCall != null) return 0;
  return (effectiveInput(model, u) * (p.in || 0) + (u.output_tokens || 0) * (p.out || 0)) / 1e6;
}
const addUsage = (acc, u = {}) => {
  for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) acc[k] = (acc[k] || 0) + (u[k] || 0);
  return acc;
};

// ─── Fluxul SSE → mesajul complet (blocurile text / thinking / tool_use) ─────
// Blocurile de gândire se păstrează EXACT (text + semnătură): API-ul le cere
// înapoi neschimbate în bucla de unelte.
async function readSse(body, onEvent) {
  const msg = { id: null, model: null, content: [], stop_reason: null, usage: {} };
  const json = [];
  let error = null;
  const handle = (ev, raw) => {
    if (!raw) return;
    let d;
    try { d = JSON.parse(raw); } catch { return; }
    const type = d.type || ev;
    if (type === 'message_start') {
      Object.assign(msg.usage, d.message?.usage || {});
      msg.id = d.message?.id || null; msg.model = d.message?.model || null;
    } else if (type === 'content_block_start') {
      const b = { ...(d.content_block || {}) };
      if (b.type === 'text') b.text = b.text || '';
      if (b.type === 'thinking') { b.thinking = b.thinking || ''; b.signature = b.signature || ''; }
      if (b.type === 'tool_use') { b.input = {}; json[d.index] = ''; }
      msg.content[d.index] = b;
    } else if (type === 'content_block_delta') {
      const b = msg.content[d.index];
      const dl = d.delta || {};
      if (!b) return;
      if (dl.type === 'text_delta') b.text = (b.text || '') + (dl.text || '');
      else if (dl.type === 'thinking_delta') b.thinking = (b.thinking || '') + (dl.thinking || '');
      else if (dl.type === 'signature_delta') b.signature = dl.signature || b.signature;
      else if (dl.type === 'input_json_delta') json[d.index] = (json[d.index] || '') + (dl.partial_json || '');
    } else if (type === 'content_block_stop') {
      const b = msg.content[d.index];
      if (b && b.type === 'tool_use') {
        try { b.input = json[d.index] ? JSON.parse(json[d.index]) : {}; }
        catch { b.input = {}; Object.defineProperty(b, 'incomplete', { value: true, enumerable: false }); }
      }
    } else if (type === 'message_delta') {
      if (d.delta?.stop_reason) msg.stop_reason = d.delta.stop_reason;
      if (d.usage) Object.assign(msg.usage, d.usage);
    } else if (type === 'error') {
      error = d.error || { type: 'stream_error', message: 'eroare în fluxul răspunsului' };
    }
    if (onEvent) { try { onEvent(type, d); } catch { /* observatorul nu oprește fluxul */ } }
  };
  const decoder = new TextDecoder();
  let buf = '';
  const flush = (all = false) => {
    buf = buf.replace(/\r\n/g, '\n');
    let k;
    while ((k = buf.indexOf('\n\n')) >= 0 || (all && buf.trim())) {
      const raw = k >= 0 ? buf.slice(0, k) : buf;
      buf = k >= 0 ? buf.slice(k + 2) : '';
      let ev = null;
      const data = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) ev = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      handle(ev, data.join('\n'));
      if (k < 0) break;
    }
  };
  for await (const chunk of body) {
    buf += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    flush(false);
  }
  buf += decoder.decode();
  flush(true);
  msg.content = msg.content.filter(Boolean);
  // un tool_use tăiat (max_tokens) nu se execută: îl scoatem din conversație
  if (msg.stop_reason === 'max_tokens') msg.content = msg.content.filter((b) => !(b.type === 'tool_use' && b.incomplete));
  return { msg, error };
}

const textOf = (content) => (content || []).filter((b) => b && b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('');

async function streamOnce(body, { onEvent = null, timeoutMs = 0 } = {}) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, stream: true }),
      ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    });
  } catch (e) {
    return { ok: false, status: 0, data: { error: { message: `rețea: ${e.message}` } }, text: '', stop: null };
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    return { ok: false, status: res.status, data, text: '', stop: null };
  }
  let data;
  if (res.body && typeof res.body[Symbol.asyncIterator] === 'function') {
    let r;
    try { r = await readSse(res.body, onEvent); }
    catch (e) { return { ok: false, status: 0, data: { error: { message: `flux întrerupt: ${e.message}` } }, text: '', stop: null }; }
    if (r.error) return { ok: false, status: r.error.type === 'overloaded_error' ? 529 : 500, data: { error: r.error }, text: '', stop: null };
    data = r.msg;
  } else {
    data = await res.json().catch(() => ({}));   // răspuns JSON obișnuit (ex. simulat în teste)
  }
  return { ok: true, status: 200, data, text: textOf(data.content), stop: data.stop_reason || null };
}

// Cererea completă: modelul (validat), gândirea adaptivă, effort, schema JSON,
// cache-ul (sistemul + ultimul mesaj). NU modifică `messages` primit.
function buildAdvancedBody({ model, system, messages, tools = null, toolChoice = null, maxTokens = 16000, effort = 'high', thinking = true, schema = null, cache = true }) {
  const useModel = resolveModel(model);
  const sys = system ? (cache ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }] : system) : undefined;
  let msgs = (messages || []).map((m) => ({ role: m.role, content: m.content }));
  if (cache && msgs.length) {
    const last = msgs[msgs.length - 1];
    const blocks = typeof last.content === 'string' ? [{ type: 'text', text: last.content }] : (last.content || []).map((b) => ({ ...b }));
    const i = blocks.length - 1;
    if (i >= 0 && blocks[i].type !== 'thinking' && blocks[i].type !== 'redacted_thinking') blocks[i] = { ...blocks[i], cache_control: { type: 'ephemeral' } };
    msgs = [...msgs.slice(0, -1), { role: last.role, content: blocks }];
  }
  const body = { model: useModel, max_tokens: maxTokens, messages: msgs };
  if (sys) body.system = sys;
  if (tools && tools.length) { body.tools = tools; if (toolChoice) body.tool_choice = { type: toolChoice }; }
  if (thinking && supportsAdaptive(useModel)) body.thinking = { type: 'adaptive' };
  const oc = {};
  if (effort && EFFORTS.includes(effort) && supportsAdaptive(useModel)) oc.effort = effort;
  if (schema) oc.format = { type: 'json_schema', schema };
  if (Object.keys(oc).length) body.output_config = oc;
  return body;
}

const stripCache = (b) => {
  const strip = (x) => { if (x && typeof x === 'object' && x.cache_control) { const { cache_control, ...rest } = x; return rest; } return x; }; // eslint-disable-line no-unused-vars
  return {
    ...b,
    ...(Array.isArray(b.system) ? { system: b.system.map(strip) } : {}),
    messages: b.messages.map((m) => (Array.isArray(m.content) ? { ...m, content: m.content.map(strip) } : m)),
  };
};
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Un apel robust: reîncearcă la suprasolicitare/rețea și, la 400, renunță pe
// rând la ce nu acceptă modelul (effort, schema, gândirea, cache-ul).
async function callAdvanced(opts = {}) {
  if (!KEY) {
    const e = new Error('Agentul are nevoie de cheia ANTHROPIC_API_KEY (Vercel → Settings → Environment Variables).');
    e.status = 501; e.code = 'NO_ANTHROPIC_KEY';
    throw e;
  }
  let body = buildAdvancedBody(opts);
  let transient = 0;
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = await streamOnce(body, { onEvent: opts.onEvent || null, timeoutMs: opts.timeoutMs || 0 });
    if (r.ok) return { ...r, model: body.model, body };
    const msg = String(r.data?.error?.message || '');
    if (r.status === 400) {
      if (body.output_config?.effort && /effort/i.test(msg)) {
        const { effort, ...oc } = body.output_config; // eslint-disable-line no-unused-vars
        body = { ...body, output_config: oc };
        if (!Object.keys(oc).length) delete body.output_config;
        continue;
      }
      if (body.output_config?.format && /output_config|json_schema|schema|format/i.test(msg)) {
        const { format, ...oc } = body.output_config; // eslint-disable-line no-unused-vars
        body = { ...body, output_config: oc };
        if (!Object.keys(oc).length) delete body.output_config;
        continue;
      }
      if (body.thinking && /thinking|adaptive/i.test(msg)) { const { thinking, ...rest } = body; body = rest; continue; } // eslint-disable-line no-unused-vars
      if (body.tool_choice && /tool_choice/i.test(msg)) { const { tool_choice, ...rest } = body; body = rest; continue; } // eslint-disable-line no-unused-vars
      if (/cache_control|cache/i.test(msg)) { body = stripCache(body); continue; }
    }
    if ((r.status === 0 || r.status === 429 || r.status >= 500) && transient < 3) {
      transient++;
      await sleep([2500, 7000, 15000][transient - 1]);
      continue;
    }
    const err = new Error(msg || `Claude API ${r.status}`);
    err.status = r.status === 429 ? 429 : r.status === 400 ? 400 : 502;
    throw err;
  }
  throw Object.assign(new Error('Claude API: prea multe reîncercări'), { status: 502 });
}

// Un singur răspuns (opțional JSON pe schemă). Răspuns tăiat la max_tokens →
// încă o încercare, cu buget mai mare și efort mai mic.
async function chatAdvanced({ system, messages, model = null, maxTokens = 32000, effort = 'high', schema = null, onEvent = null, timeoutMs = 0 }) {
  const usage = {};
  let r = await callAdvanced({ system, messages, model, maxTokens, effort, schema, onEvent, timeoutMs });
  addUsage(usage, r.data.usage);
  let data = schema ? extractJson(r.text) : null;
  if (r.stop === 'max_tokens' && (!r.text.trim() || (schema && !data))) {
    const lower = EFFORTS[Math.max(0, EFFORTS.indexOf(effort) - 1)] || 'medium';
    r = await callAdvanced({ system, messages, model, maxTokens: Math.min(Math.round(maxTokens * 1.7), 120000), effort: lower, schema, onEvent, timeoutMs });
    addUsage(usage, r.data.usage);
    data = schema ? extractJson(r.text) : null;
  }
  // (LaTeX-ul stricat de JSON — „\frac" → form-feed + „rac" — îl repară apelantul,
  // doar în câmpurile de text: în fragmentele de cod/HTML un TAB e chiar TAB.)
  return {
    text: r.text, data, content: r.data.content || [], stopReason: r.stop, model: r.model,
    usage: { prompt_tokens: effectiveInput(r.model, usage), completion_tokens: usage.output_tokens || 0, model: r.model, raw: usage },
    costUsd: costUsd(r.model, usage),
  };
}

module.exports = {
  chatClaude, chatClaudeTools, extractJson, MODEL, MODELS, resolveModel, HAS_KEY: !!KEY,
  // apelurile avansate (agenții de verificare și de debug)
  callAdvanced, chatAdvanced, buildAdvancedBody, readSse, textOf, supportsAdaptive, EFFORTS,
  costUsd, effectiveInput, cacheReadMult, addUsage,
};
