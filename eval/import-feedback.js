#!/usr/bin/env node
// =====================================================================
// eval/import-feedback.js — setul de REGRESIE din 👎 (ai_feedback, value = -1)
//
// Fiecare răspuns marcat 👎 de un elev devine un item cu `needsReview: true`:
// întrebarea elevului (mesajul user de dinainte), răspunsul considerat greșit
// și nota lui (dacă există). NU are răspuns oficial — îl completezi tu în
// JSON („answer") după ce îl verifici; până atunci runnerul îl sare (rulează
// cu --include-review ca să-l vezi în raport). Așa, fiecare 👎 devine un caz
// de test pe care îl poți re-rula la orice schimbare de model/prompt.
//
//   node eval/import-feedback.js --days 30 --limit 200
// =====================================================================
const fs = require('fs');
const path = require('path');
for (const f of ['.env.local', '.env']) {
  const p = path.join(__dirname, '..', f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf('--' + n); return i === -1 ? d : (args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : true); };
const DAYS = parseInt(opt('days', '90'), 10) || 90;
const LIMIT = parseInt(opt('limit', '200'), 10) || 200;

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Lipsesc SUPABASE_URL/VITE_SUPABASE_URL și SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
  const supa = createClient(url, key);
  const since = new Date(Date.now() - DAYS * 86400000).toISOString();
  const { data: fb, error } = await supa.from('ai_feedback').select('message_id, note, created_at').eq('value', -1).gte('created_at', since).order('created_at', { ascending: false }).limit(LIMIT);
  if (error) { console.error(error.message); process.exit(1); }
  const items = [];
  for (const f of fb || []) {
    const { data: msg } = await supa.from('ai_messages').select('id, conversation_id, content, mode, created_at').eq('id', f.message_id).maybeSingle();
    if (!msg) continue;
    const { data: prev } = await supa.from('ai_messages').select('content').eq('conversation_id', msg.conversation_id).eq('role', 'user').lt('created_at', msg.created_at).order('created_at', { ascending: false }).limit(1);
    const question = prev?.[0]?.content || '';
    if (!question.trim()) continue;
    items.push({
      id: `fb-${String(msg.id).slice(0, 8)}`, exam: 'feedback', topic: msg.mode || 'tutor',
      statement: question.slice(0, 2000), answer: null, needsReview: true,
      badAnswer: String(msg.content || '').slice(0, 3000), note: f.note || null, date: f.created_at,
      source: `ai_feedback 👎 · conversația ${msg.conversation_id}`,
    });
  }
  const dir = path.join(__dirname, 'items');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `feedback-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify(items, null, 2));
  console.log(`${items.length} itemi (needsReview) → ${path.relative(process.cwd(), out)} — completează „answer" după verificare.`);
})().catch((e) => { console.error(e); process.exit(1); });
