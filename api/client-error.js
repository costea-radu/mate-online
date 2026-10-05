// =====================================================================
// api/client-error.js — erorile JavaScript din browserele vizitatorilor
// (src/lib/errorReport.js le trimite aici). Le folosește agentul de debug din
// Admin, ca să pornească de la erorile REALE ale site-ului.
//
// Public (fără cont), deci: corp mic, câmpuri tăiate, e-mailurile și
// parametrii din adrese scoși, aceeași eroare = un singur rând (amprentă →
// count++), limită de cereri pe IP. Scrierea trece printr-o funcție SQL
// (report_client_error), cu cheia serverului — browserul nu scrie direct.
// =====================================================================
const crypto = require('node:crypto');
const ai = require('./_lib/ai');

// (zgomot: extensii, rețea căzută, tab-uri vechi după un deploy — acelea se reîncarcă singure, vezi src/main.jsx)
const IGNORE = /dynamically imported module|Importing a module script failed|ResizeObserver loop|^Script error\.?$|Non-Error promise rejection|chrome-extension:|moz-extension:|safari-(web-)?extension:|^Failed to fetch$|^Load failed$|NetworkError when attempting|^The (user|operation) (aborted|was aborted)|AbortError|^cancel(l)?ed$|webkit-masked-url/i;
const hits = new Map();                  // ip → [momentele cererilor] (în memoria instanței)
const LIMIT = 30, WINDOW = 10 * 60 * 1000;

const clean = (s, n) => String(s ?? '')
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')                         // fără adrese de e-mail
  .replace(/(access_token|refresh_token|token|code|key)=[^&\s"']+/gi, '$1=<…>')
  .replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '<jwt>')
  .slice(0, n);
// doar calea paginii (fără parametri sau fragment: pot conține tokenuri)
function cleanUrl(u) {
  try { const x = new URL(String(u || ''), 'https://examenmate.com'); return clean(x.pathname, 300); } catch { return null; }
}
// amprenta: mesajul (cu numerele și id-urile generalizate) + primul cadru din stivă
function fingerprint(message, stack) {
  const m = String(message).replace(/\b[0-9a-f]{8}-[0-9a-f-]{27,}\b/gi, '<id>').replace(/\d+/g, 'N').slice(0, 200);
  const frame = (String(stack || '').split('\n').map((l) => l.trim()).find((l) => /\.(js|jsx|mjs)\b/.test(l)) || '')
    .replace(/\?[^:)\s]*/g, '').replace(/https?:\/\/[^/]+/g, '').replace(/-[A-Za-z0-9_]{8}\.js/g, '.js').slice(0, 200);
  return crypto.createHash('sha1').update(`${m}|${frame}`).digest('hex').slice(0, 40);
}

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const ip = String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'x').split(',')[0].trim();
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW);
  if (list.length >= LIMIT) return res.status(429).json({ ok: false });
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();

  const items = (Array.isArray(body?.errors) ? body.errors : [body]).slice(0, 5);
  const supa = ai.admin();
  let saved = 0;
  for (const e of items) {
    const message = clean(e?.message, 500).trim();
    if (!message || IGNORE.test(message)) continue;
    const stack = clean(e?.stack, 4000);
    try {
      const { error } = await supa.rpc('report_client_error', {
        p_fp: fingerprint(message, stack), p_message: message, p_stack: stack || null,
        p_url: cleanUrl(e?.url), p_release: clean(e?.release, 80) || null, p_ua: clean(req.headers['user-agent'], 300) || null,
      });
      if (!error) saved++;
    } catch { /* tabela lipsește: nu stricăm nimic */ }
  }
  return res.status(200).json({ ok: true, saved });
};
module.exports.fingerprint = fingerprint;
module.exports.clean = clean;
