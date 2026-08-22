#!/usr/bin/env node
// =====================================================================
// eval/import-db.js — itemi REALI din baza de date → eval/items/db-<categorie>.json
//
// Ia exercițiile interactive STRUCTURATE din `content.interactive_data.exercise`
// (listele de întrebări cu răspuns: grile cu index, răspunsuri libere) și le
// scrie ca itemi de evaluare: enunț + variante + răspunsul oficial (litera /
// textul). Așa setul de evaluare crește cu materialele tale, fără să scrii
// nimic de mână. Rulează cu SUPABASE_URL (sau VITE_SUPABASE_URL) și
// SUPABASE_SERVICE_ROLE_KEY în env / .env.local:
//
//   node eval/import-db.js                 # toate categoriile
//   node eval/import-db.js --category evaluare-nationala --limit 200
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
const CATEGORY = opt('category', null);
const LIMIT = parseInt(opt('limit', '500'), 10) || 500;
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

(async () => {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('Lipsesc SUPABASE_URL/VITE_SUPABASE_URL și SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
  const supa = createClient(url, key);
  let q = supa.from('content').select('id, title, category, subcategory, interactive_data').eq('content_type', 'interactive').not('interactive_data', 'is', null).limit(LIMIT);
  if (CATEGORY) q = q.eq('category', CATEGORY);
  const { data, error } = await q;
  if (error) { console.error(error.message); process.exit(1); }
  const byCat = {};
  let n = 0;
  for (const row of data || []) {
    const ex = row.interactive_data?.exercise;
    const qs = Array.isArray(ex?.questions) ? ex.questions : Array.isArray(ex) ? ex : null;
    if (!qs) continue;
    qs.forEach((qq, i) => {
      const statement = String(qq?.statement || qq?.enunt || '').trim();
      if (statement.length < 6) return;
      const options = Array.isArray(qq.options) && qq.options.length ? qq.options.map(String) : null;
      let answer;
      if (options) {
        const idx = Number.isInteger(qq.answer) ? qq.answer : /^\d+$/.test(String(qq.answer)) ? parseInt(qq.answer, 10) : LETTERS.indexOf(String(qq.answer || '').toLowerCase());
        if (!(idx >= 0 && idx < options.length)) return;
        answer = LETTERS[idx];
      } else {
        answer = String(qq.answer ?? '').trim();
        if (!answer) return;
      }
      const cat = row.category || 'general';
      (byCat[cat] = byCat[cat] || []).push({
        id: `db-${String(row.id).slice(0, 8)}-${i + 1}`, exam: cat, subject: row.subcategory || null,
        topic: (row.title || '').slice(0, 80), statement, ...(options ? { options } : {}), answer,
        source: `content ${row.id} · ${row.title || ''}`.trim(),
      });
      n++;
    });
  }
  const dir = path.join(__dirname, 'items');
  fs.mkdirSync(dir, { recursive: true });
  for (const [cat, items] of Object.entries(byCat)) {
    const f = path.join(dir, `db-${cat}.json`);
    fs.writeFileSync(f, JSON.stringify(items, null, 2));
    console.log(`${items.length.toString().padStart(4)} itemi → ${path.relative(process.cwd(), f)}`);
  }
  console.log(`Total: ${n} itemi din ${(data || []).length} materiale interactive.`);
})().catch((e) => { console.error(e); process.exit(1); });
