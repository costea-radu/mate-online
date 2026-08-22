#!/usr/bin/env node
// =====================================================================
// eval/run.js — SETUL DE EVALUARE al agenților AI („golden set")
// (Etapa 2 din AUDIT_AGENTI_AI.md, punctul 3.3)
//
// Rulează itemii din eval/items/*.json (enunț + răspuns oficial) prin:
//   · mode=tutor  : Profesorul Virtual (persona + regulile reale din
//                   api/_lib/ai.js, fără RAG), cerând la final „RĂSPUNS FINAL: …";
//   · mode=verify : verificatorul independent (api/_lib/verify.js) — cât de
//                   bine rezolvă modelul de verificare itemii;
//   · mode=both   : ambele (implicit).
// Compară răspunsul extras cu cel oficial prin api/_lib/mathcheck.js
// (echivalență matematică) — la grilă, litera.
//
//   npm run eval                              # toate itemii, modelul din env
//   npm run eval -- --models gpt-4o-mini,gpt-5-mini --mode tutor
//   npm run eval -- --models gpt-5-mini --effort low  # reasoning_effort (1.4)
//   npm run eval -- --only en --limit 10      # doar fișierele/examenele „en"
//   npm run eval -- --mock                    # fără rețea: verifică harness-ul
//
// Cheile: OPENAI_API_KEY / AI_CHAT_* din env sau din .env / .env.local
// (citite de aici, NU sunt comise). Raportul: eval/reports/<data>_<mod>_<model>.{json,md}
// și un rezumat în consolă. Costul rulării se afișează estimativ (ai.costMicroLei).
// =====================================================================
const fs = require('fs');
const path = require('path');

// ── .env local (opțional) ────────────────────────────────────────────────────
for (const f of ['.env.local', '.env']) {
  const p = path.join(__dirname, '..', f);
  if (!fs.existsSync(p)) continue;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

// ── argumente ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf('--' + name); if (i === -1) return def; const v = args[i + 1]; return v && !v.startsWith('--') ? v : true; };
const MODE = String(opt('mode', 'both'));
const ONLY = opt('only', null);
const LIMIT = parseInt(opt('limit', '0'), 10) || 0;
const MOCK = opt('mock', null); // true | 'wrong'
const CONC = parseInt(opt('concurrency', '3'), 10) || 3;
const OUT = String(opt('out', path.join(__dirname, 'reports')));
const INCLUDE_REVIEW = !!opt('include-review', null);
// efortul de raționament (modele gpt-5.x / o-series): 'minimal'|'low'|'medium'|'high'
// — se setează ÎNAINTE de a încărca ai.js (citește AI_REASONING_EFFORT)
const EFFORT = opt('effort', null);
if (EFFORT && EFFORT !== true) process.env.AI_REASONING_EFFORT = String(EFFORT);
if (MOCK) process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-mock';

const ai = require('../api/_lib/ai');
const mathcheck = require('../api/_lib/mathcheck');
const verify = require('../api/_lib/verify');
const MODELS = String(opt('models', opt('model', ai.CHAT_MODEL))).split(',').map((s) => s.trim()).filter(Boolean);

// ── itemii ───────────────────────────────────────────────────────────────────
function loadItems() {
  const dir = path.join(__dirname, 'items');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
  let items = [];
  for (const f of files) {
    if (ONLY && !f.includes(String(ONLY)) && !f.includes('seed')) { /* filtrare după examen, mai jos */ }
    let arr;
    try { arr = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); } catch (e) { console.warn(`itemi: ${f} nu e JSON valid (${e.message}) — sărit`); continue; }
    if (!Array.isArray(arr)) continue;
    for (const it of arr) items.push({ ...it, file: f });
  }
  if (ONLY) items = items.filter((it) => it.file.includes(String(ONLY)) || String(it.exam || '').includes(String(ONLY)) || String(it.id || '').startsWith(String(ONLY)));
  if (!INCLUDE_REVIEW) items = items.filter((it) => !it.needsReview);
  if (LIMIT) items = items.slice(0, LIMIT);
  return items;
}

// ── mock: fetch fals (fără rețea) ────────────────────────────────────────────
let mockItemByPrompt = null;
function installMock() {
  const wrong = MOCK === 'wrong';
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    const txt = body.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n');
    const it = mockItemByPrompt(txt);
    const isJson = !!body.response_format;
    let content;
    if (!it) content = isJson ? '{}' : 'Nu știu.';
    else if (isJson) {
      const letter = Array.isArray(it.options) ? (wrong ? nextLetter(it.answer) : String(it.answer).toLowerCase()) : null;
      content = JSON.stringify({ final_answer: wrong ? '999' : (Array.isArray(it.options) ? it.options[letterIndex(it.answer)] : it.answer), letter, confidence: 'high', note: 'mock' });
    } else {
      content = Array.isArray(it.options)
        ? `Rezolvare mock.\nRĂSPUNS FINAL: litera ${wrong ? nextLetter(it.answer) : it.answer})`
        : `Rezolvare mock.\nRĂSPUNS FINAL: ${wrong ? '999' : it.answer}`;
    }
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 50, completion_tokens: 20 } }), text: async () => '' };
  };
}
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];
const letterIndex = (l) => LETTERS.indexOf(String(l).toLowerCase());
const nextLetter = (l) => LETTERS[(letterIndex(l) + 1) % 4];

// ── extragerea răspunsului final din explicația tutorelui ────────────────────
function extractFinal(text, item) {
  const t = String(text || '');
  if (Array.isArray(item.options)) {
    const res = [
      /r[ăa]spuns(?:ul)?\s+final\s*:?\s*(?:litera\s*)?\(?([a-f])\)?(?![a-zăâîșț])/gi,
      /r[ăa]spunsul?\s+(?:corect\s+|final\s+|bun\s+)?(?:este|e|va\s+fi|ar\s+fi)\s*:?\s*(?:litera\s*|varianta\s*)?\(?([a-f])\)?(?![a-zăâîșț])/gi,
      /(?:varianta|litera)\s+corect[ăa]\s+(?:este|e)\s*:?\s*\(?([a-f])\)?(?![a-zăâîșț])/gi,
    ];
    let last = null;
    for (const re of res) { for (const m of t.matchAll(re)) last = m[1].toLowerCase(); }
    return last;
  }
  const m = [...t.matchAll(/r[ăa]spuns(?:ul)?\s+final\s*:?\s*(.+)$/gim)].pop();
  if (m) return m[1].replace(/[.\s]+$/, '').trim();
  const m2 = [...t.matchAll(/r[ăa]spunsul?\s+(?:corect\s+|final\s+)?(?:este|e)\s*:?\s*(.+)$/gim)].pop();
  return m2 ? m2[1].replace(/[.\s]+$/, '').trim() : null;
}

function judge(item, got) {
  if (got == null || got === '') return 'fara_raspuns';
  if (Array.isArray(item.options)) return String(got).toLowerCase() === String(item.answer).toLowerCase() ? 'corect' : 'gresit';
  const eq = mathcheck.answersEquivalent(got, item.answer);
  return eq === true ? 'corect' : eq === false ? 'gresit' : 'nedecis';
}

// ── rularea unui item ────────────────────────────────────────────────────────
const TUTOR_EXTRA = `\n\nPENTRU EVALUARE: rezolvi exercițiul COMPLET (elevul a cerut explicit rezolvarea completă) și închei OBLIGATORIU cu o linie separată, exact în forma „RĂSPUNS FINAL: …" — la grilă „RĂSPUNS FINAL: litera x)", altfel valoarea finală (număr, fracție, expresie LaTeX între $...$ sau mulțime).`;

async function runTutor(item, model) {
  const system = ai.systemFor('tutor', 'Nu am găsit materiale relevante în baza de date.', TUTOR_EXTRA);
  const user = Array.isArray(item.options)
    ? `${item.statement}\n${item.options.map((o, i) => `${LETTERS[i]}) ${o}`).join('\n')}\n\nRezolvă complet și spune-mi răspunsul final.`
    : `${item.statement}\n\nRezolvă complet și spune-mi răspunsul final.`;
  const t0 = Date.now();
  const { text, usage } = await ai.chat({ system, messages: [{ role: 'user', content: user }], temperature: 0.3, maxTokens: 1200, model });
  const got = extractFinal(text, item);
  return { got, verdict: judge(item, got), ms: Date.now() - t0, usage, text };
}

async function runVerify(item, model) {
  const t0 = Date.now();
  const r = await verify.verifyItem({ id: item.id, statement: item.statement, options: item.options, answer: item.answer }, { model });
  const got = Array.isArray(item.options) ? (r.verifier?.letter || null) : (r.verifier?.answer ?? null);
  const verdict = r.error ? 'eroare' : r.agree === true ? 'corect' : r.agree === false ? 'gresit' : judge(item, got);
  return { got, verdict, ms: Date.now() - t0, usage: r.usage, note: r.verifier?.note, confidence: r.verifier?.confidence, error: r.error };
}

async function pool(items, fn, conc) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(conc, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

function summarize(rows) {
  const n = rows.length;
  const c = (v) => rows.filter((r) => r.verdict === v).length;
  const decided = rows.filter((r) => r.verdict === 'corect' || r.verdict === 'gresit').length;
  return { n, corect: c('corect'), gresit: c('gresit'), nedecis: c('nedecis'), fara_raspuns: c('fara_raspuns'), eroare: c('eroare'), acuratete: decided ? Math.round((c('corect') / decided) * 1000) / 10 : null };
}

(async () => {
  const items = loadItems();
  if (!items.length) { console.error('Niciun item în eval/items/*.json (sau filtrul --only nu a găsit nimic).'); process.exit(1); }
  if (MOCK) {
    mockItemByPrompt = (txt) => items.find((it) => txt.includes(String(it.statement).slice(0, 60)));
    installMock();
  }
  if (!ai.hasChat()) { console.error('Lipsește OPENAI_API_KEY / AI_CHAT_API_KEY (pune-le în .env.local sau rulează cu --mock).'); process.exit(1); }
  fs.mkdirSync(OUT, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  const modes = MODE === 'both' ? ['tutor', 'verify'] : [MODE];
  const summary = [];
  for (const model of MODELS) {
    for (const mode of modes) {
      console.log(`\n▶ ${mode} · ${model} · ${items.length} itemi${MOCK ? ' · MOCK' : ''}`);
      const rows = await pool(items, async (it) => {
        let r;
        try { r = mode === 'tutor' ? await runTutor(it, model) : await runVerify(it, model); }
        catch (e) { r = { got: null, verdict: 'eroare', error: e.message, usage: e.usage || { in: 0, out: 0 } }; }
        const mark = r.verdict === 'corect' ? '✓' : r.verdict === 'gresit' ? '✗' : '?';
        process.stdout.write(`  ${mark} ${it.id} ${r.verdict}${r.verdict !== 'corect' ? ` (oficial: ${it.answer} · obținut: ${r.got ?? '—'})` : ''}\n`);
        return { id: it.id, exam: it.exam, topic: it.topic, official: it.answer, got: r.got, verdict: r.verdict, ms: r.ms, error: r.error, note: r.note, confidence: r.confidence, usage: r.usage, tutorText: mode === 'tutor' ? r.text : undefined };
      }, CONC);
      const s = summarize(rows);
      const usage = rows.reduce((a, r) => ({ in: a.in + (r.usage?.in || 0), out: a.out + (r.usage?.out || 0) }), { in: 0, out: 0 });
      const costLei = ai.costMicroLei(model, usage) / 1e6;
      const byExam = {};
      for (const r of rows) { byExam[r.exam] = byExam[r.exam] || []; byExam[r.exam].push(r); }
      const perExam = Object.fromEntries(Object.entries(byExam).map(([k, v]) => [k, summarize(v)]));
      const rep = { date: new Date().toISOString(), mode, model, effort: ai.REASONING_EFFORT || null, mock: !!MOCK, summary: s, perExam, usage, costLei: +costLei.toFixed(4), rows };
      const base = path.join(OUT, `${stamp}_${mode}_${model.replace(/[^a-z0-9.-]/gi, '_')}`);
      fs.writeFileSync(base + '.json', JSON.stringify(rep, null, 2));
      const md = [`# Eval ${mode} · ${model}${ai.REASONING_EFFORT ? ` (effort ${ai.REASONING_EFFORT})` : ''}${MOCK ? ' · MOCK' : ''} · ${rep.date.slice(0, 16)}`, '',
        `**Acuratețe: ${s.acuratete ?? '—'}%** (${s.corect} corecte / ${s.gresit} greșite / ${s.nedecis} nedecise / ${s.fara_raspuns} fără răspuns / ${s.eroare} erori, din ${s.n}) · cost ≈ ${rep.costLei} lei`, '',
        '| examen | n | corecte | greșite | nedecise | acuratețe |', '|---|---|---|---|---|---|',
        ...Object.entries(perExam).map(([k, v]) => `| ${k} | ${v.n} | ${v.corect} | ${v.gresit} | ${v.nedecis} | ${v.acuratete ?? '—'}% |`), '',
        '## Itemi cu probleme', '', ...rows.filter((r) => r.verdict !== 'corect').map((r) => `- **${r.id}** (${r.topic}): ${r.verdict} — oficial \`${r.official}\`, obținut \`${r.got ?? '—'}\`${r.error ? ` — eroare: ${r.error}` : ''}`),
      ].join('\n');
      fs.writeFileSync(base + '.md', md);
      console.log(`  → ${s.corect}/${s.n} corecte (${s.acuratete ?? '—'}% pe cele decise) · ${s.nedecis} nedecise · cost ≈ ${rep.costLei} lei · raport: ${path.relative(process.cwd(), base)}.md`);
      summary.push({ mode, model, ...s, costLei: rep.costLei });
    }
  }
  console.log('\n══ Rezumat ══');
  for (const s of summary) console.log(`${s.mode.padEnd(7)} ${s.model.padEnd(24)} acuratețe ${String(s.acuratete ?? '—').padStart(5)}%  (${s.corect}/${s.n}, nedecise ${s.nedecis})  ≈ ${s.costLei} lei`);
})().catch((e) => { console.error(e); process.exit(1); });
