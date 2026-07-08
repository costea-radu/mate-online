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

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    // Notă: modelele Claude recente NU mai acceptă `temperature` (API-ul
    // răspunde cu „temperature is deprecated for this model") — nu îl trimitem.
    // Parametrul rămâne în semnătură pentru fallback-ul OpenAI, care îl suportă.
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || `Claude API ${res.status}`;
    const err = new Error(msg); err.status = res.status === 429 ? 429 : 502;
    throw err;
  }

  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const usage = {
    prompt_tokens: data.usage?.input_tokens || 0,
    completion_tokens: data.usage?.output_tokens || 0,
  };
  return { text, usage, provider: MODEL, stopReason: data.stop_reason || null };
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

module.exports = { chatClaude, extractJson, MODEL, HAS_KEY: !!KEY };
