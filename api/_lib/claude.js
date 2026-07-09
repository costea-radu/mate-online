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

  const payload = {
    model: MODEL,
    system,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  };

  async function callOnce(extra) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      // Notă: modelele Claude recente nu mai acceptă `temperature` — nu îl trimitem.
      body: JSON.stringify({ ...payload, ...extra }),
    });
    const data = await res.json().catch(() => ({}));
    const text = (data.content || []).filter((bl) => typeof bl.text === 'string').map((bl) => bl.text).join('');
    return { ok: res.ok, status: res.status, data, text, stop: data.stop_reason || null };
  }

  // Modelele Claude recente „gândesc” înainte să răspundă, iar gândirea
  // consumă din max_tokens (de aceea buget mic → text gol, stop=max_tokens).
  // Strategie: (1) cerem gândirea dezactivată — tot bugetul merge pe răspuns;
  // (2) dacă modelul nu permite, dăm buget suplimentar pentru gândire;
  // (3) dacă și așa a consumat tot, o singură reîncercare cu buget dublu.
  let r = await callOnce({ max_tokens: maxTokens, thinking: { type: 'disabled' } });
  if (!r.ok && r.status === 400) {
    console.warn('claude: thinking:disabled respins (%s) — reîncerc cu buget extins', r.data?.error?.message || r.status);
    r = await callOnce({ max_tokens: maxTokens + 10000 });
  }
  if (r.ok && r.stop === 'max_tokens' && !r.text.trim()) {
    console.warn('claude: gândirea a consumat tot bugetul — reîncerc cu buget dublu');
    r = await callOnce({ max_tokens: Math.min((maxTokens + 10000) * 2, 64000) });
  }

  if (!r.ok) {
    const msg = r.data?.error?.message || `Claude API ${r.status}`;
    const err = new Error(msg); err.status = r.status === 429 ? 429 : 502;
    throw err;
  }

  const usage = {
    prompt_tokens: r.data.usage?.input_tokens || 0,
    completion_tokens: r.data.usage?.output_tokens || 0,
  };
  return { text: r.text, usage, provider: MODEL, stopReason: r.stop };
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
