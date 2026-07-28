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

async function chatClaude({ system, messages = [], temperature = 0.7, maxTokens = 3000 }) {
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
    const r = await ai.chat({ system, messages: flat, temperature, maxTokens });
    return { text: r.text, usage: r.usage, provider: 'fallback:' + (ai.CHAT_MODEL || 'openai') };
  }

  const r = await apiCall({
    model: MODEL,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    max_tokens: maxTokens,
  });

  const usage = {
    prompt_tokens: r.data.usage?.input_tokens || 0,
    completion_tokens: r.data.usage?.output_tokens || 0,
  };
  return { text: r.text, usage, provider: MODEL, stopReason: r.stop };
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
  if (!r.ok && r.status === 400) {
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

// ─── Bucla agentică cu UNELTE (tool use) — Faza 1, GHID_AGENT_SEO_ACTIUNI ────
// Rulează conversația cât timp modelul cere unelte: execută funcția prin
// `executeTool(name, input)`, adaugă rezultatul în conversație și continuă.
// `executeTool` întoarce un string (rezultatul pentru model); erorile lui devin
// text de eroare pentru model (bucla nu se oprește la o unealtă eșuată).
// Se oprește după `maxIters` runde de unelte, cu o cerere finală de raport.
async function chatClaudeTools({ system, messages = [], tools = [], executeTool, maxTokens = 3000, maxIters = 8 }) {
  if (!KEY) {
    const e = new Error('Uneltele agentului au nevoie de ANTHROPIC_API_KEY (providerul fallback nu suportă bucla de unelte).');
    e.status = 501; e.code = 'NO_ANTHROPIC_KEY';
    throw e;
  }
  const msgs = messages.map((m) => ({ role: m.role, content: m.content }));
  const usage = { prompt_tokens: 0, completion_tokens: 0 };
  const track = (r) => {
    usage.prompt_tokens += r.data.usage?.input_tokens || 0;
    usage.completion_tokens += r.data.usage?.output_tokens || 0;
  };
  let toolCalls = 0;
  let lastText = '';

  for (let iter = 0; iter < maxIters; iter++) {
    const r = await apiCall({ model: MODEL, system, messages: msgs, tools, max_tokens: maxTokens });
    track(r);
    const content = r.data.content || [];
    if (r.text.trim()) lastText = r.text;
    const uses = content.filter((bl) => bl.type === 'tool_use');
    if (r.stop !== 'tool_use' || !uses.length) {
      return { text: lastText, usage, provider: MODEL, toolCalls, stopReason: r.stop };
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
  const fin = await apiCall({ model: MODEL, system, messages: msgs, tools, max_tokens: maxTokens });
  track(fin);
  return {
    text: fin.text.trim() || lastText || '(Limita de unelte a fost atinsă — vezi propunerile din coada de aprobare.)',
    usage, provider: MODEL, toolCalls, stopReason: 'max_iterations',
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

module.exports = { chatClaude, chatClaudeTools, extractJson, MODEL, HAS_KEY: !!KEY };
