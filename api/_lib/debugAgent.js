// =====================================================================
// api/_lib/debugAgent.js — AGENTUL DE DEBUG (Admin → „🐞 Agent debug")
//
// La „▶ Rulează", un model Claude (implicit Opus 5.5) citește codul REAL al
// site-ului (instantaneul commitului de pe GitHub), pornește de la semnalele
// reale (erorile JavaScript din browserele vizitatorilor, rezultatul testelor
// automate, commiturile recente) și caută probleme: erori, logică greșită,
// securitate, plăți, pierderi de date, telefon, costuri AI. Raportează fiecare
// problemă (fișier + rând) și propune CORECTURI ca editări exacte (find →
// replace), validate pe loc (fragmentul există o singură dată, JavaScript-ul de
// pe server încă se compilează). Nimic nu se schimbă în cod fără acordul
// adminului: corecturile aprobate devin un pull request pe GitHub, testele și
// build-ul rulează automat (GitHub Actions), iar „Publică" face merge.
//
// Rularea merge pe PAȘI (fiecare cerere HTTP ≤ ~4,5 minute): conversația se
// salvează în debug_runs după fiecare tur, iar browserul cere pasul următor —
// o rulare lungă nu se pierde la limita de timp a funcției.
// Aici: instantaneul codului, uneltele, promptul, pasul. HTTP: api/admin-debug.js.
// =====================================================================
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const claude = require('./claude');
const GH = require('./github');
const V = require('./verificare');

// ═════════════════════════════════════════════════════════════════════════════
// 1. INSTANTANEUL CODULUI
// ═════════════════════════════════════════════════════════════════════════════
const TEXT_EXT = /\.(js|jsx|mjs|cjs|ts|tsx|css|html|json|md|sql|ya?ml|toml|txt|py|sh|xml|webmanifest)$/i;
const SKIP = [/^Claude outputs\//, /^android-twa\//, /^play-assets\//, /^node_modules\//, /^dist\//, /^_to_delete\//, /^eval\/reports\//,
  /^package-lock\.json$/, /^public\/live\/[^/]+\/rig\.json$/, /^src\/lib\/live\/demo\.json$/, /^CHANGELOG-REPARATII\.md$/];
const MAX_FILE_BYTES = 300 * 1024;
const mem = new Map();               // sha → instantaneu (în memoria instanței)

const wantFile = (p, size = 0) => TEXT_EXT.test(p) && !SKIP.some((r) => r.test(p)) && size <= MAX_FILE_BYTES;

async function loadSnapshot(cfg, sha, { listTree = GH.tree, fetchFile = GH.rawFile } = {}) {
  if (mem.has(sha)) return mem.get(sha);
  const tmp = path.join(os.tmpdir(), `examenmate-cod-${sha}.json`);
  try {
    const j = JSON.parse(fs.readFileSync(tmp, 'utf8'));
    const snap = { sha, files: new Map(j.files) };
    mem.set(sha, snap);
    return snap;
  } catch { /* nu e în cache-ul instanței */ }
  const entries = (await listTree(cfg, sha)).filter((f) => wantFile(f.path, f.size));
  const files = new Map();
  let i = 0;
  const worker = async () => {
    while (i < entries.length) {
      const e = entries[i++];
      try { files.set(e.path, await fetchFile(cfg, sha, e.path)); } catch { /* fișier sărit */ }
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  const snap = { sha, files: new Map([...files].sort((a, b) => a[0].localeCompare(b[0]))) };
  mem.set(sha, snap);
  if (mem.size > 3) mem.delete(mem.keys().next().value);
  try { fs.writeFileSync(tmp, JSON.stringify({ sha, files: [...snap.files] })); } catch { /* /tmp plin: nu e grav */ }
  return snap;
}
const fromFiles = (sha, obj) => ({ sha, files: new Map(Object.entries(obj)) });   // (teste)

// ═════════════════════════════════════════════════════════════════════════════
// 2. UNELTELE AGENTULUI
// ═════════════════════════════════════════════════════════════════════════════
const normPath = (p) => String(p || '').trim().replace(/^\.?\/+/, '').replace(/\\/g, '/');
const clip = (s, n) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));
const lineCount = (t) => String(t || '').split('\n').length;

// „src/**/*.jsx", „api/*.js", „live" (fără caractere speciale = conține)
function globToRegex(glob) {
  const g = String(glob || '').trim();
  if (!g) return null;
  if (!/[*?]/.test(g)) return new RegExp(g.replace(/[.+^${}()|[\]\\]/g, '\\$&'), 'i');
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') { re += '.*'; i++; if (g[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`, 'i');
}

function listFiles(snap, { dir = '', pattern = '' } = {}) {
  const d = normPath(dir).replace(/\/+$/, '');
  const re = pattern ? globToRegex(pattern) : null;
  const paths = [...snap.files.keys()].filter((p) => (!d || p === d || p.startsWith(`${d}/`)) && (!re || re.test(p)));
  if (!paths.length) return 'Niciun fișier găsit (instantaneul are doar fișierele text: cod, SQL, CSS, ghiduri).';
  const out = paths.slice(0, 300).map((p) => `${p} (${lineCount(snap.files.get(p))} r.)`);
  return out.join('\n') + (paths.length > 300 ? `\n… și încă ${paths.length - 300} (restrânge cu dir/pattern)` : '');
}

function readFile(snap, { path: p, start_line: start = 1, end_line: end = null } = {}) {
  const key = normPath(p);
  const text = snap.files.get(key);
  if (text == null) return `Fișierul „${p}" nu există în instantaneu. Folosește list_files sau search_code.`;
  const lines = text.split('\n');
  const a = Math.max(1, parseInt(start, 10) || 1);
  let b = end ? Math.min(lines.length, parseInt(end, 10) || lines.length) : Math.min(lines.length, a + 299);
  if (b - a > 399) b = a + 399;
  if (a > lines.length) return `${key} are doar ${lines.length} rânduri.`;
  let out = '';
  for (let k = a; k <= b; k++) {
    const ln = `${k}\t${lines[k - 1]}\n`;
    if (out.length + ln.length > 40000) { b = k - 1; break; }
    out += ln;
  }
  return `${key} — rândurile ${a}–${b} din ${lines.length}\n${out}${b < lines.length ? `… (continuă cu read_file, start_line=${b + 1})` : ''}`;
}

function searchCode(snap, { pattern, path_pattern: pathPattern = '', ignore_case: ignoreCase = true, max_results: max = 60 } = {}) {
  let re;
  try { re = new RegExp(String(pattern || ''), ignoreCase === false ? '' : 'i'); }
  catch (e) { return `Expresie regulată invalidă: ${e.message}`; }
  if (!pattern) return 'Lipsește pattern.';
  const pre = pathPattern ? globToRegex(pathPattern) : null;
  const lim = Math.max(1, Math.min(120, parseInt(max, 10) || 60));
  const out = [];
  let total = 0;
  for (const [p, text] of snap.files) {
    if (pre && !pre.test(p)) continue;
    const lines = text.split('\n');
    for (let k = 0; k < lines.length; k++) {
      if (!re.test(lines[k])) continue;
      total++;
      if (out.length < lim) out.push(`${p}:${k + 1}: ${clip(lines[k].trim(), 220)}`);
    }
  }
  if (!out.length) return 'Nicio potrivire.';
  return out.join('\n') + (total > out.length ? `\n… încă ${total - out.length} potriviri (restrânge cu path_pattern)` : '');
}

// ─── Corecturile propuse: validate pe instantaneu ────────────────────────────
const BLOCKED = [/^\.github\//, /(^|\/)\.env/, /^package-lock\.json$/, /^node_modules\//, /^dist\//, /\.(png|jpe?g|gif|webp|mp4|mp3|ttf|woff2?|pdf|ico)$/i];
// fișierele CommonJS ale serverului: le compilăm înainte să acceptăm corectura
const isServerJs = (p) => /^api\/.*\.js$/.test(p) || /^test\/.*\.js$/.test(p) || /^tools\/.*\.js$/.test(p);
function compiles(code) {
  try { new vm.Script(String(code).replace(/^#!.*\n/, ''), { filename: 'f.js' }); return null; }
  catch (e) { return e.message; }
}

// edits: [{ path, find, replace }] → { ok, error?, files: [{ path, created, before, after }], diff, added, removed }
function validateFix(snap, edits) {
  if (!Array.isArray(edits) || !edits.length) return { ok: false, error: 'edits e gol.' };
  if (edits.length > 25) return { ok: false, error: 'Prea multe editări într-o singură corectură (max 25) — împarte-o.' };
  const cur = new Map();
  const created = new Set();
  for (const [k, e] of edits.entries()) {
    const p = normPath(e?.path);
    const find = String(e?.find ?? '');
    const replace = String(e?.replace ?? '');
    if (!p) return { ok: false, error: `editarea ${k + 1}: lipsește path.` };
    if (BLOCKED.some((r) => r.test(p))) return { ok: false, error: `editarea ${k + 1}: „${p}" nu se modifică din agent (.github, .env, package-lock, fișiere binare).` };
    const before = cur.has(p) ? cur.get(p) : snap.files.get(p);
    if (before == null) {
      if (find !== '') return { ok: false, error: `editarea ${k + 1}: fișierul „${p}" nu există. Pentru un fișier NOU: find = "" și replace = conținutul întreg.` };
      cur.set(p, replace);
      created.add(p);
      continue;
    }
    if (find === '') return { ok: false, error: `editarea ${k + 1}: find e gol, dar „${p}" există deja.` };
    if (find === replace) return { ok: false, error: `editarea ${k + 1}: find și replace sunt identice.` };
    const r = V.applyEdits(before, [{ find, replace }]);
    if (!r.results[0].ok) return { ok: false, error: `editarea ${k + 1} (${p}): ${r.results[0].reason}. Copiază fragmentul EXACT din read_file (fără numerele de rând și fără TAB-ul de după ele).` };
    cur.set(p, r.text);
  }
  const files = [];
  let added = 0, removed = 0;
  const diff = [];
  for (const [p, after] of cur) {
    const before = created.has(p) ? '' : snap.files.get(p);
    if (isServerJs(p)) {
      const errAfter = compiles(after);
      if (errAfter && !compiles(before || '')) return { ok: false, error: `după corectură, „${p}" nu se mai compilează: ${errAfter}` };
    }
    if (/\.json$/i.test(p)) { try { JSON.parse(after); } catch (e) { return { ok: false, error: `după corectură, „${p}" nu mai e JSON valid: ${e.message}` }; } }
    const hunks = V.lineDiff(before || '', after, { context: 3, clip: 300, maxHunks: 30 });
    for (const h of hunks) for (const [op] of h.lines) { if (op === '+') added++; else if (op === '-') removed++; }
    diff.push({ path: p, created: created.has(p), hunks });
    files.push({ path: p, created: created.has(p) });
  }
  return { ok: true, files, diff, added, removed, contents: cur };
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. ZONELE, PROMPTUL, UNELTELE (schemele)
// ═════════════════════════════════════════════════════════════════════════════
const AREAS = {
  live: { label: 'Meditații live (sala, 1-la-1, demo, plăți bilete)', start: 'src/pages/LiveRoom.jsx, src/pages/MeditatiiLive.jsx, src/lib/live/*, src/components/live/*, api/live.js, api/_lib/live.js, api/_lib/liveLesson.js' },
  plan: { label: '„Planul meu" și Pregătirea de examen', start: 'src/pages/Meditatii.jsx, src/pages/PregatireExamen.jsx, api/ai-meditatii.js, api/_lib/meditatii.js, api/_lib/pregatire.js' },
  plati: { label: 'Plăți, abonamente, credite AI', start: 'api/create-checkout.js, api/stripe-webhook.js, api/create-portal.js, src/pages/Pricing.jsx, api/_lib/ai.js (isPremium, budgetInfo)' },
  conturi: { label: 'Conturi, autentificare, roluri, ștergerea contului', start: 'src/context/AuthContext.jsx, src/pages/Login.jsx, src/pages/Register.jsx, api/_lib/http.js, api/account-cleanup.js, api/teacher-manage.js' },
  teste: { label: 'Testele interactive, PDF-urile, scorurile', start: 'src/pages/InteractiveViewer.jsx, src/pages/PDFViewer.jsx, api/get-file-url.js, api/ai-score.js, api/ai-progress.js, src/components/ContentPage.jsx' },
  tutor: { label: 'Profesorul virtual (chat AI, corectare, voce)', start: 'src/components/AITutor.jsx, api/ai-chat.js, api/ai-chat-stream.js, api/ai-correct.js, api/_lib/ai.js' },
  admin: { label: 'Admin și agenții (generator, SEO, task-uri)', start: 'src/pages/Admin.jsx, src/components/AIExerciseAgent.jsx, api/ai-exercise-agent.js, api/_lib/exgen.js, api/agent-tasks.js, api/agent-cron.js' },
  cron: { label: 'Cronurile, SEO, social media, e-mailuri', start: 'vercel.json, api/*cron*.js, api/_lib/seo.js, api/_lib/social.js, api/ai-notify.js, api/_lib/mailer.js' },
  db: { label: 'Baza de date și securitatea (RLS, autorizare pe server)', start: 'supabase/*.sql, api/_lib/http.js, toate rutele api/ care citesc req.body' },
  gamificare: { label: 'Gamificare: XP, dueluri, turnee, harta', start: 'api/gamificare.js, api/duel.js, api/turneu.js, api/_lib/xp.js, src/components/DueluriPanel.jsx, src/components/TurneePanel.jsx' },
  mobil: { label: 'Telefonul și performanța (layout, încărcare, PWA)', start: 'src/styles/*.css, src/App.jsx, src/main.jsx, vite.config.js, src/components/Navbar.jsx' },
};
const SCOPES = {
  general: 'Verificare generală (prin rotație: altă zonă la fiecare rulare)',
  erori: 'Erorile reale din site (browserele vizitatorilor) + testele automate',
  ...Object.fromEntries(Object.entries(AREAS).map(([k, v]) => [k, v.label])),
  custom: 'Doar ce scriu eu la „Ce să verifice"',
};
// „general": zona verificată cel mai demult
function pickArea(previousScopes = []) {
  const order = Object.keys(AREAS);
  const lastSeen = new Map(order.map((k) => [k, -1]));
  previousScopes.forEach((s, i) => { if (lastSeen.has(s)) lastSeen.set(s, Math.max(lastSeen.get(s), previousScopes.length - i)); });
  return order.slice().sort((a, b) => lastSeen.get(a) - lastSeen.get(b))[0];
}

const TOOLS = [
  { name: 'list_files', description: 'Listează fișierele text din instantaneul codului (cu numărul de rânduri). dir = un folder (ex. "api/_lib"); pattern = glob (ex. "src/**/*.jsx") sau un fragment din cale.',
    input_schema: { type: 'object', properties: { dir: { type: 'string' }, pattern: { type: 'string' } } } },
  { name: 'read_file', description: 'Citește un fișier, cu numerele rândurilor (max ~400 de rânduri pe apel). Pentru fișiere lungi, citește pe bucăți (start_line / end_line).',
    input_schema: { type: 'object', properties: { path: { type: 'string' }, start_line: { type: 'integer' }, end_line: { type: 'integer' } }, required: ['path'] } },
  { name: 'search_code', description: 'Caută o expresie regulată (JavaScript) în tot codul; întoarce „cale:rând: text". path_pattern restrânge căutarea (glob sau fragment de cale).',
    input_schema: { type: 'object', properties: { pattern: { type: 'string' }, path_pattern: { type: 'string' }, ignore_case: { type: 'boolean' }, max_results: { type: 'integer' } }, required: ['pattern'] } },
  { name: 'recent_errors', description: 'Erorile JavaScript reale din browserele vizitatorilor din ultimele 14 zile (grupate, cu numărul de apariții, pagina și stiva).',
    input_schema: { type: 'object', properties: {} } },
  { name: 'ci_status', description: 'Rezultatul ultimelor rulări ale testelor automate și build-ului (GitHub Actions) pe ramura principală; la eșec, fragmentul relevant din jurnal.',
    input_schema: { type: 'object', properties: {} } },
  { name: 'recent_commits', description: 'Ultimele commituri (mesaj, dată); cu sha → fișierele schimbate în acel commit și fragmente din diferențe. Bug-urile apar des în codul nou.',
    input_schema: { type: 'object', properties: { sha: { type: 'string' } } } },
  { name: 'report_finding', description: 'Înregistrează o problemă VERIFICATĂ în cod sau o îmbunătățire valoroasă. Întoarce id-ul (F1, F2…).',
    input_schema: { type: 'object', properties: {
      severity: { type: 'string', enum: ['critica', 'majora', 'minora', 'info'] },
      kind: { type: 'string', enum: ['bug', 'securitate', 'plati', 'date', 'performanta', 'ux', 'cost_ai', 'imbunatatire'] },
      title: { type: 'string' }, file: { type: 'string' }, line: { type: 'integer' },
      details: { type: 'string', description: 'ce se întâmplă, în ce condiții, de ce (cu dovada din cod)' },
      suggestion: { type: 'string', description: 'cum se repară / ce ar trebui schimbat' },
    }, required: ['severity', 'kind', 'title', 'file', 'details'] } },
  { name: 'propose_fix', description: 'Propune o corectură de cod (adminul o aprobă sau o respinge; apoi devine pull request, cu teste și build automate). edits = editări exacte: find = fragment copiat IDENTIC din fișier (unic), replace = textul nou. Fișier nou: find = "" și replace = tot conținutul. Întoarce id-ul (C1, C2…) sau eroarea de validare (atunci corectează și trimite din nou).',
    input_schema: { type: 'object', properties: {
      finding_id: { type: 'string' }, title: { type: 'string' },
      explanation: { type: 'string', description: 'ce schimbă și de ce e corect; efectele asupra altor părți' },
      risk: { type: 'string', enum: ['mic', 'mediu', 'mare'] },
      edits: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } }, required: ['path', 'find', 'replace'] } },
    }, required: ['title', 'explanation', 'risk', 'edits'] } },
];

function systemPrompt({ sha, scope, area, focus, maxTurns, canPR }) {
  const what = scope === 'erori' ? 'Pornește de la ERORILE REALE din browserele vizitatorilor (recent_errors) și de la rezultatul testelor automate (ci_status): găsește cauza fiecăreia în cod și repar-o.'
    : scope === 'custom' ? 'Verifică exact ce a cerut adminul (mai jos).'
      : `Zona de verificat: ${AREAS[area]?.label || area}. Punct de plecare: ${AREAS[area]?.start || 'alege tu fișierele relevante'}.`;
  return [
    'Ești agentul de debug al platformei ExamenMate (examenmate.com — pregătire pentru Evaluarea Națională și Bacalaureat la matematică): un inginer software senior, atent, sceptic și concret. Lucrezi pe codul REAL al site-ului, instantaneul commitului ' + String(sha).slice(0, 10) + ' de pe GitHub. Scrii în limba română, cu diacritice.',
    '',
    'PROIECTUL:',
    '- Frontend: React 18 + Vite (SPA + PWA), react-router 6; pagini în src/pages, componente în src/components, logică în src/lib, stiluri inline și src/styles/*.css. Se folosește mult pe telefon.',
    '- Backend: funcții serverless Vercel în api/*.js (CommonJS, Node 20), utilitare în api/_lib/; cronuri în vercel.json; maxDuration 800 s.',
    '- Supabase: Postgres cu RLS (serverul folosește cheia service role), Storage (content-files privat, content-files-free public), Realtime, Auth. SQL-ul e în supabase/*.sql și îl rulează adminul manual.',
    '- Plăți Stripe (abonament + bilete), AI: OpenAI + Anthropic (api/_lib/ai.js, api/_lib/claude.js), cu limite de cost.',
    '- Teste: node --test test/*.test.js (fără rețea; Supabase simulat în test/tools/fakeSupabase.js). Comentariile și textele din interfață sunt în română.',
    '',
    `MISIUNEA: ${what}`,
    focus ? `CEREREA ADMINULUI: ${focus}` : '',
    '',
    'CUM LUCREZI:',
    '1. Începe cu semnalele reale: recent_errors (erorile vizitatorilor), ci_status (testele + build-ul), recent_commits (codul nou are cele mai multe bug-uri). Apoi citește codul zonei.',
    '2. Urmărește fluxurile cap-coadă (interfață → api → bază de date) și caută: erori care opresc pagina, logică greșită, cazuri-limită (null/undefined, liste goale, fus orar România, diacritice, telefon), condiții de cursă, autorizare lipsă pe server, date personale expuse, plăți și credite greșite, pierderi de date, cereri în buclă, costuri AI scăpate de sub control.',
    '3. Verifică fiecare suspiciune în cod ÎNAINTE s-o raportezi: citește funcția, apelanții și testele. Nu raporta ce n-ai verificat. Nu raporta stil, preferințe, „ar fi frumos să…" — doar probleme reale sau îmbunătățiri cu impact clar.',
    '4. report_finding pentru fiecare problemă reală (fișier + rând + dovada).',
    `5. propose_fix pentru problemele pe care le poți repara SIGUR: modificări minime, în stilul codului existent (comentarii în română), fără refactorizări mari. Fiecare corectură e independentă de celelalte. Nu atinge .github/, .env, package-lock.json. Când repari o funcție pură și e simplu, adaugă un test în test/*.test.js. Modificările de SQL trebuie rulate manual în Supabase — spune asta în explicație.${canPR ? '' : ' (Tokenul GitHub lipsește: corecturile rămân propuneri, adminul le poate aplica manual.)'}`,
    '6. find trebuie copiat EXACT din read_file — fără numărul rândului și fără TAB-ul de după el — și trebuie să apară o singură dată în fișier (include 1–3 rânduri de context).',
    `7. Ai cel mult ${maxTurns} pași (un pas = un răspuns al tău, cu oricâte unelte). Folosește mai multe unelte într-un singur pas când se poate (ex. citește 3 fișiere deodată).`,
    '',
    'LA FINAL (fără alte unelte) scrii RAPORTUL, în acest format:',
    '## Rezumat — 2–4 propoziții: ce ai verificat și concluzia.',
    '## Probleme — fiecare: [F#] gravitate · fișier:rând · ce se întâmplă · corectura propusă [C#] sau ce trebuie făcut.',
    '## Îmbunătățiri recomandate — doar cele cu impact clar.',
    '## Ce n-am verificat — ce ar merita data viitoare.',
  ].filter((x) => x !== '').join('\n');
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. PASUL (un tur sau mai multe, până la limita de timp)
// ═════════════════════════════════════════════════════════════════════════════
const MAX_STORED_CHARS = 650000;        // conversația salvată în debug_runs (rezultatele vechi se scurtează)

function compact(messages) {
  let size = JSON.stringify(messages).length;
  if (size <= MAX_STORED_CHARS) return messages;
  const out = messages.map((m) => ({ ...m, content: Array.isArray(m.content) ? m.content.map((b) => ({ ...b })) : m.content }));
  // scurtăm rezultatele uneltelor, de la cele mai vechi (ultimele 2 mesaje rămân întregi)
  for (let i = 0; i < out.length - 2 && size > MAX_STORED_CHARS; i++) {
    const m = out[i];
    if (m.role !== 'user' || !Array.isArray(m.content)) continue;
    for (const b of m.content) {
      if (b.type !== 'tool_result' || typeof b.content !== 'string' || b.content.length <= 1600) continue;
      const before = b.content.length;
      b.content = `${b.content.slice(0, 1200)}\n… [rezultat scurtat ca să încapă conversația; recitește dacă îți trebuie]`;
      size -= before - b.content.length;
    }
  }
  return out;
}

function logLine(kind, text) { return { t: new Date().toISOString(), kind, text: clip(text, 400) }; }

function describeCall(name, input = {}) {
  switch (name) {
    case 'list_files': return `📂 listez ${input.dir || input.pattern || 'fișierele'}`;
    case 'read_file': return `📖 citesc ${input.path}${input.start_line ? ` (r. ${input.start_line}–${input.end_line || '…'})` : ''}`;
    case 'search_code': return `🔎 caut /${clip(input.pattern, 60)}/${input.path_pattern ? ` în ${input.path_pattern}` : ''}`;
    case 'recent_errors': return '🧯 citesc erorile din browserele vizitatorilor';
    case 'ci_status': return '🧪 verific rezultatul testelor automate (CI)';
    case 'recent_commits': return input.sha ? `🕘 mă uit în commitul ${String(input.sha).slice(0, 8)}` : '🕘 citesc commiturile recente';
    default: return `🔧 ${name}`;
  }
}

// Execută o unealtă. ctx: { snap, run, deps: { errors(), ci(), commits(sha) } }
async function runTool(name, input, ctx) {
  const { snap, run, deps } = ctx;
  switch (name) {
    case 'list_files': return listFiles(snap, input);
    case 'read_file': return readFile(snap, input);
    case 'search_code': return searchCode(snap, input);
    case 'recent_errors': return deps.errors ? await deps.errors() : 'Erorile din browser nu sunt disponibile.';
    case 'ci_status': return deps.ci ? await deps.ci() : 'CI indisponibil.';
    case 'recent_commits': return deps.commits ? await deps.commits(input.sha || null) : 'Istoricul nu e disponibil.';
    case 'report_finding': {
      const id = `F${(run.findings || []).length + 1}`;
      const f = {
        id, severity: ['critica', 'majora', 'minora', 'info'].includes(input.severity) ? input.severity : 'minora',
        kind: String(input.kind || 'bug').slice(0, 20), title: clip(input.title || '', 300), file: normPath(input.file || ''),
        line: Number.isInteger(input.line) ? input.line : null, details: clip(input.details || '', 4000), suggestion: clip(input.suggestion || '', 2000),
      };
      run.findings = [...(run.findings || []), f];
      run.log = [...(run.log || []), logLine('finding', `🐞 [${id}] ${f.title} (${f.file}${f.line ? `:${f.line}` : ''})`)];
      return `Înregistrat ca ${id}.`;
    }
    case 'propose_fix': {
      const v = validateFix(snap, input.edits);
      if (!v.ok) {
        run.log = [...(run.log || []), logLine('info', `↺ corectura „${clip(input.title || '', 80)}" nu a trecut validarea: ${v.error}`)];
        return `CORECTURA RESPINSĂ LA VALIDARE: ${v.error}`;
      }
      const id = `C${(run.fixes || []).length + 1}`;
      const fix = {
        id, finding_id: input.finding_id ? String(input.finding_id).slice(0, 10) : null, title: clip(input.title || '', 300),
        explanation: clip(input.explanation || '', 4000), risk: ['mic', 'mediu', 'mare'].includes(input.risk) ? input.risk : 'mediu',
        edits: input.edits.map((e) => ({ path: normPath(e.path), find: String(e.find ?? ''), replace: String(e.replace ?? '') })),
        files: v.files, diff: v.diff, added: v.added, removed: v.removed, decision: null,
      };
      run.fixes = [...(run.fixes || []), fix];
      run.log = [...(run.log || []), logLine('fix', `🛠 [${id}] ${fix.title} (${v.files.map((f) => f.path).join(', ')}; +${v.added} −${v.removed})`)];
      return `Corectura ${id} a fost înregistrată (+${v.added} −${v.removed} rânduri) și așteaptă aprobarea adminului.`;
    }
    default: return `Unealtă necunoscută: ${name}`;
  }
}

// Mesajul de pornire: zona, cererea, harta proiectului
function firstMessage({ scope, area, focus, snap, maxTurns }) {
  const dirs = new Map();
  for (const p of snap.files.keys()) {
    const top = p.includes('/') ? p.split('/')[0] + '/' : p;
    dirs.set(top, (dirs.get(top) || 0) + 1);
  }
  const map = [...dirs].map(([d, n]) => (d.endsWith('/') ? `${d} (${n} fișiere)` : d)).join(', ');
  return [
    `Pornește verificarea. ${scope === 'general' ? `Zona aleasă prin rotație: ${AREAS[area]?.label}.` : ''}`,
    focus ? `Cererea adminului: ${focus}` : '',
    `Harta instantaneului: ${map}.`,
    `Ai ${maxTurns} pași. Începe cu semnalele reale (recent_errors, ci_status, recent_commits), apoi codul.`,
  ].filter(Boolean).join('\n');
}

// adaugă un text la ultimul mesaj „user" (sau un mesaj nou) — API-ul nu acceptă două mesaje user la rând
function joinUser(messages, text) {
  const out = messages.slice();
  const last = out[out.length - 1];
  if (last && last.role === 'user') {
    const a = Array.isArray(last.content) ? last.content : [{ type: 'text', text: String(last.content) }];
    out[out.length - 1] = { role: 'user', content: [...a, { type: 'text', text }] };
  } else out.push({ role: 'user', content: text });
  return out;
}

// Un PAS al rulării: continuă conversația până la `deadline` (ms epoch) sau până
// termină modelul. Modifică și întoarce `run` (de salvat de apelant după fiecare tur
// prin onTurn). deps: { snap, call, errors, ci, commits, onTurn, priceRun }
async function step(run, { snap, deadline, call = claude.callAdvanced, errors = null, ci = null, commits = null, onTurn = null, maxTurns = 24, budgetLei = 25, usdRon = 4.6, canPR = false }) {
  const area = run.area || run.scope;
  const system = systemPrompt({ sha: snap.sha, scope: run.scope, area, focus: run.focus, maxTurns, canPR });
  if (!Array.isArray(run.messages) || !run.messages.length) {
    run.messages = [{ role: 'user', content: firstMessage({ scope: run.scope, area, focus: run.focus, snap, maxTurns }) }];
    run.log = [...(run.log || []), logLine('info', `▶ Pornesc pe commitul ${snap.sha.slice(0, 8)} (${snap.files.size} fișiere) · ${run.scope === 'general' ? `zona: ${AREAS[area]?.label}` : SCOPES[run.scope] || run.scope}`)];
  }
  const usage = {};
  while (Date.now() < deadline - 25000) {
    if (run.turns >= maxTurns + 1) { run.status = 'gata'; run.report = run.report || '(Limita de pași a fost atinsă înainte de raportul final.)'; break; }
    const spentLei = (run.cost_micro || 0) / 1e6;
    if (spentLei >= budgetLei) {
      run.log = [...run.log, logLine('info', `💰 Bugetul rulării (${budgetLei} lei) s-a atins — cer raportul final.`)];
    }
    const lastTurn = run.turns >= maxTurns || spentLei >= budgetLei;
    const messages = lastTurn ? joinUser(run.messages, 'Limita de pași sau de buget s-a atins: scrie ACUM raportul final, fără alte unelte.') : run.messages;
    const r = await call({
      model: run.model, system, messages, tools: TOOLS, toolChoice: lastTurn ? 'none' : null, maxTokens: 32000,
      effort: run.effort || 'high', cache: true, timeoutMs: Math.max(60000, deadline - Date.now() - 15000),
    });
    claude.addUsage(usage, r.data.usage);
    const cost = claude.costUsd(r.model || run.model, r.data.usage || {});
    run.cost_micro = (run.cost_micro || 0) + Math.round(cost * usdRon * 1e6);
    run.tokens_in = (run.tokens_in || 0) + claude.effectiveInput(r.model || run.model, r.data.usage || {});
    run.tokens_out = (run.tokens_out || 0) + (r.data.usage?.output_tokens || 0);
    run.turns = (run.turns || 0) + 1;
    const content = (r.data.content || []).filter((b) => b && !(b.type === 'tool_use' && b.incomplete));
    const text = claude.textOf(content).trim();
    if (text) run.log = [...run.log, logLine('think', `💭 ${text.split('\n')[0]}`)];
    const uses = lastTurn ? [] : content.filter((b) => b.type === 'tool_use');
    // răspuns tăiat la limita de lungime, fără unelte: îi cerem să continue (de cel mult 2 ori)
    if (!uses.length && !lastTurn && r.stop === 'max_tokens' && (run.cuts || 0) < 2) {
      run.cuts = (run.cuts || 0) + 1;
      run.messages = compact([...messages, { role: 'assistant', content }, { role: 'user', content: 'Răspunsul tău a fost tăiat la limita de lungime. Continuă exact de unde ai rămas.' }]);
      if (onTurn) await onTurn(run);
      continue;
    }
    if (!uses.length) {
      run.messages = compact([...messages, { role: 'assistant', content }]);
      run.report = text || run.report || '(Agentul nu a scris raportul final.)';
      run.status = 'gata';
      run.log = [...run.log, logLine('info', `✅ Gata: ${(run.findings || []).length} probleme, ${(run.fixes || []).length} corecturi propuse.`)];
      if (onTurn) await onTurn(run);
      break;
    }
    const results = [];
    for (const u of uses) {
      run.log = [...run.log, logLine('tool', describeCall(u.name, u.input))];
      let out;
      try { out = await runTool(u.name, u.input || {}, { snap, run, deps: { errors, ci, commits } }); }
      catch (e) { out = `EROARE la ${u.name}: ${e.message}`; }
      results.push({ type: 'tool_result', tool_use_id: u.id, content: String(out ?? '').slice(0, 45000) });
    }
    run.messages = compact([...run.messages, { role: 'assistant', content }, { role: 'user', content: results }]);
    if (onTurn) await onTurn(run);
  }
  return run;
}

module.exports = {
  loadSnapshot, fromFiles, wantFile, globToRegex, listFiles, readFile, searchCode, validateFix, compiles,
  AREAS, SCOPES, pickArea, TOOLS, systemPrompt, firstMessage, step, runTool, compact, describeCall, logLine,
};
