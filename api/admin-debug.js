// =====================================================================
// api/admin-debug.js — AGENTUL DE DEBUG (Admin → „🐞 Agent debug"). Doar admin.
//
// POST { action, ... }
//   status      — ce e configurat (cheia Claude, GitHub + token, tabelele, CI)
//   start       — o rulare nouă („▶ Rulează"): zona, cererea, modelul, bugetul
//   step        — încă un pas al rulării (≤ ~4,5 minute); browserul îl cere până
//                 când rularea e „gata" — jurnalul, problemele și corecturile vin pe parcurs
//   stop / get / list
//   decide      — „Aprob" / „Resping" o corectură propusă
//   apply       — corecturile aprobate → ramură nouă + pull request pe GitHub
//                 (GitHub Actions rulează testele și build-ul; Vercel face preview)
//   pr_status   — verificările PR-ului (teste, build, Vercel)
//   merge       — „Publică": merge în ramura principală → Vercel publică site-ul
//   close_pr    — renunță la PR (ramura se șterge)
//   patch       — corecturile aprobate ca fișier .patch (fără token GitHub)
//   errors      — erorile JavaScript din browserele vizitatorilor
//
// Logica agentului: api/_lib/debugAgent.js · GitHub: api/_lib/github.js
// Tabela: supabase/agenti_verificare_debug.sql (debug_runs, client_errors).
// =====================================================================
const ai = require('./_lib/ai');
const claude = require('./_lib/claude');
const GH = require('./_lib/github');
const D = require('./_lib/debugAgent');
const V = require('./_lib/verificare');

const SETUP_HINT = 'Agentul de debug nu e încă activat: rulează supabase/agenti_verificare_debug.sql în Supabase → SQL Editor.';
const isMissingTable = (err) => !!err && /relation .* does not exist|does not exist|schema cache/i.test(String(err.message || err));
function fail(status, message, code = null) { const e = new Error(message); e.status = status; if (code) e.code = code; return e; }
function dbCheck(error, what = '') {
  if (!error) return;
  if (isMissingTable(error)) throw fail(503, SETUP_HINT, 'DEBUG_SETUP');
  throw fail(500, `${what ? what + ': ' : ''}${error.message}`);
}
const STEP_MS = () => Math.max(60000, Math.min(600000, parseInt(process.env.DEBUG_PAS_MS || '270000', 10) || 270000));
const MAX_TURNS = () => Math.max(6, Math.min(60, parseInt(process.env.DEBUG_PASI_MAX || '24', 10) || 24));
const DEFAULT_BUDGET = () => Math.max(1, parseFloat(process.env.DEBUG_BUGET_LEI || '20') || 20);
const LIGHT_COLS = 'id, status, scope, area, focus, model, effort, repo, branch, base_sha, log, findings, fixes, report, pr, error, steps, turns, cost_micro, tokens_in, tokens_out, budget_lei, created_at, updated_at';

async function adminUser(req, supa) {
  const userId = await ai.authUser(req, supa);
  await ai.requireAdmin(supa, userId);
  return userId;
}

function light(r) {
  if (!r) return null;
  return {
    id: r.id, status: r.status, scope: r.scope, area: r.area, focus: r.focus, model: r.model, effort: r.effort,
    repo: r.repo, branch: r.branch, base_sha: r.base_sha, log: r.log || [], findings: r.findings || [],
    fixes: (r.fixes || []).map(({ edits, ...f }) => ({ ...f, edits: (edits || []).length })),   // editările întregi rămân pe server
    report: r.report || null, pr: r.pr || null, error: r.error || null, turns: r.turns || 0, steps: r.steps || 0,
    cost_lei: Math.round((r.cost_micro || 0) / 1e4) / 100, budget_lei: r.budget_lei != null ? Number(r.budget_lei) : null,
    created_at: r.created_at, updated_at: r.updated_at,
  };
}

async function loadRun(supa, id, cols = '*') {
  if (!id) throw fail(400, 'Lipsește rularea.');
  const { data, error } = await supa.from('debug_runs').select(cols).eq('id', String(id)).maybeSingle();
  dbCheck(error, 'rularea');
  if (!data) throw fail(404, 'Rularea nu există.');
  return data;
}

// ─── semnalele reale (pentru unelte) ─────────────────────────────────────────
async function errorsText(supa) {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const { data, error } = await supa.from('client_errors').select('message, stack, url, release, user_agent, count, first_seen, last_seen').gte('last_seen', since).order('last_seen', { ascending: false }).limit(40);
  if (error) return isMissingTable(error) ? 'Tabela client_errors lipsește (SQL-ul nu e rulat) — nu am erori din browser.' : `Eroare la citire: ${error.message}`;
  if (!data || !data.length) return 'Nicio eroare JavaScript raportată din browserele vizitatorilor în ultimele 14 zile.';
  const rows = data.slice().sort((a, b) => b.count - a.count);
  return rows.map((e, k) => [
    `#${k + 1} · ${e.count}× · ultima: ${String(e.last_seen).slice(0, 16).replace('T', ' ')} · prima: ${String(e.first_seen).slice(0, 10)}${e.release ? ` · versiunea ${e.release}` : ''}`,
    `   ${e.message}`,
    `   pagina: ${e.url || '?'} · ${String(e.user_agent || '').slice(0, 90)}`,
    e.stack ? `   stiva: ${String(e.stack).split('\n').slice(0, 6).join(' | ').slice(0, 700)}` : '',
  ].filter(Boolean).join('\n')).join('\n');
}

async function ciText(cfg) {
  let runs;
  try { runs = await GH.ciRuns(cfg, { limit: 6 }); }
  catch (e) { return `Nu am putut citi rulările CI: ${e.message}`; }
  if (!runs.length) return 'Nu există rulări CI pe ramura principală (workflow-ul .github/workflows/verificare.yml lipsește sau încă n-a rulat).';
  const lines = runs.map((r) => `${String(r.at).slice(0, 16).replace('T', ' ')} · ${r.name} · ${r.status}${r.conclusion ? `/${r.conclusion}` : ''} · ${r.sha.slice(0, 8)} · ${r.title}`);
  const lastDone = runs.find((r) => r.status === 'completed');
  if (lastDone && lastDone.conclusion === 'failure') {
    let ex = '';
    try { ex = await GH.ciFailureExcerpt(cfg, lastDone.id); } catch (e) { ex = `(jurnalul nu se poate citi: ${e.message})`; }
    lines.push('', `ULTIMA RULARE A EȘUAT — fragmente din jurnal:`, ex || '(fără fragmente)');
  } else if (lastDone) lines.push('', `Ultima rulare terminată: ${lastDone.conclusion}.`);
  return lines.join('\n');
}

async function commitsText(cfg, sha) {
  try {
    if (sha) {
      const c = await GH.gh(cfg, `/repos/${cfg.repo}/commits/${encodeURIComponent(sha)}`);
      const files = (c.files || []).slice(0, 40).map((f) => `${f.status} ${f.filename} (+${f.additions} −${f.deletions})${f.patch ? `\n${String(f.patch).slice(0, 1500)}` : ''}`);
      return `${c.sha.slice(0, 8)} · ${String(c.commit?.committer?.date || '').slice(0, 16)} · ${c.commit?.message || ''}\n\n${files.join('\n\n')}`.slice(0, 30000);
    }
    const list = await GH.gh(cfg, `/repos/${cfg.repo}/commits?sha=${encodeURIComponent(cfg.branch)}&per_page=15`);
    return (list || []).map((c) => `${c.sha.slice(0, 8)} · ${String(c.commit?.committer?.date || '').slice(0, 16).replace('T', ' ')} · ${String(c.commit?.message || '').split('\n')[0]}`).join('\n');
  } catch (e) { return `Istoricul nu se poate citi: ${e.message}`; }
}

// ─── acțiuni ─────────────────────────────────────────────────────────────────
async function status(req, res, supa) {
  await adminUser(req, supa);
  const cfg = GH.config();
  const out = { hasKey: claude.HAS_KEY, repo: cfg.repo, branch: cfg.branch, token: !!cfg.token, head: null, githubError: null, setup: true, ciWorkflow: null, errors7d: null };
  try { out.head = await GH.headSha(cfg); } catch (e) { out.githubError = e.message; }
  if (out.head?.sha) {
    try { out.ciWorkflow = !!(await GH.fileAt(cfg, out.head.sha, '.github/workflows/verificare.yml')); } catch { out.ciWorkflow = null; }
  }
  const { error } = await supa.from('debug_runs').select('id', { count: 'exact', head: true });
  if (error) { if (isMissingTable(error)) out.setup = false; else throw fail(500, error.message); }
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const { count, error: e2 } = await supa.from('client_errors').select('fingerprint', { count: 'exact', head: true }).gte('last_seen', since);
  if (!e2) out.errors7d = count || 0;
  out.scopes = D.SCOPES;
  out.models = claude.MODELS.map((m) => ({ id: m.id, label: m.label, note: m.note, price: ai.priceFor(m.id) }));
  out.defaults = { budgetLei: DEFAULT_BUDGET(), maxTurns: MAX_TURNS() };
  return res.status(200).json(out);
}

async function start(req, res, supa) {
  const userId = await adminUser(req, supa);
  if (!claude.HAS_KEY) throw fail(501, 'Agentul de debug are nevoie de cheia ANTHROPIC_API_KEY (Vercel → Settings → Environment Variables).', 'NO_ANTHROPIC_KEY');
  const scope = Object.prototype.hasOwnProperty.call(D.SCOPES, req.body?.scope) ? req.body.scope : 'general';
  const focus = String(req.body?.focus || '').trim().slice(0, 2000) || null;
  if (scope === 'custom' && !focus) throw fail(400, 'Scrie ce să verifice agentul.');
  const model = claude.resolveModel(req.body?.model || 'claude-opus-5-5');
  const effort = claude.EFFORTS.includes(req.body?.effort) ? req.body.effort : 'high';
  const budget = Math.max(1, Math.min(200, parseFloat(req.body?.budgetLei) || DEFAULT_BUDGET()));
  // nu pornim două rulări deodată (costuri dublate, PR-uri care se calcă)
  const { data: busy } = await supa.from('debug_runs').select('id, updated_at').eq('status', 'ruleaza').order('created_at', { ascending: false }).limit(1);
  const lastMove = busy && busy[0] ? new Date(busy[0].updated_at || Date.now()).getTime() : 0;
  if (busy && busy[0] && Date.now() - lastMove < 15 * 60000) throw fail(409, 'O altă rulare e încă în lucru. Oprește-o (⏹) sau continu-o.', 'BUSY');
  const cfg = GH.config();
  let head;
  try { head = await GH.headSha(cfg); } catch (e) { throw fail(502, `Nu pot citi codul de pe GitHub: ${e.message}`); }
  let area = scope;
  if (scope === 'general') {
    const { data: prev } = await supa.from('debug_runs').select('area').order('created_at', { ascending: false }).limit(30);
    area = D.pickArea((prev || []).map((p) => p.area).reverse());
  }
  const row = {
    status: 'ruleaza', scope, area, focus, model, effort, repo: cfg.repo, branch: cfg.branch, base_sha: head.sha,
    messages: [], log: [], findings: [], fixes: [], budget_lei: budget, created_by: userId, updated_at: new Date().toISOString(),
  };
  const { data, error } = await supa.from('debug_runs').insert(row).select(LIGHT_COLS).maybeSingle();
  dbCheck(error, 'rularea');
  return res.status(200).json({ run: light(data) });
}

async function stepAction(req, res, supa) {
  const userId = await adminUser(req, supa);
  const run = await loadRun(supa, req.body?.runId);
  if (run.status !== 'ruleaza') return res.status(200).json({ run: light(run) });
  // un singur pas odată
  const now = new Date();
  const until = new Date(now.getTime() + STEP_MS() + 120000).toISOString();
  const { data: locked } = await supa.from('debug_runs').update({ locked_until: until })
    .eq('id', run.id).or(`locked_until.is.null,locked_until.lt.${now.toISOString()}`).select('id').maybeSingle();
  if (!locked) return res.status(200).json({ run: light(run), busy: true });
  const cfg = GH.config();
  const save = async (r) => {
    const patch = {
      status: r.status, messages: r.messages, log: (r.log || []).slice(-400), findings: r.findings, fixes: r.fixes, report: r.report || null,
      turns: r.turns, cost_micro: r.cost_micro, tokens_in: r.tokens_in, tokens_out: r.tokens_out, error: r.error || null, updated_at: new Date().toISOString(),
    };
    const { error } = await supa.from('debug_runs').update(patch).eq('id', r.id);
    if (error) console.error('admin-debug: salvarea pasului:', error.message);
  };
  try {
    const snap = await D.loadSnapshot(cfg, run.base_sha);
    run.steps = (run.steps || 0) + 1;
    await D.step(run, {
      snap, deadline: Date.now() + STEP_MS(), maxTurns: MAX_TURNS(), budgetLei: Number(run.budget_lei) || DEFAULT_BUDGET(),
      usdRon: ai.USD_RON || 4.6, canPR: !!cfg.token,
      errors: () => errorsText(supa), ci: () => ciText(cfg), commits: (sha) => commitsText(cfg, sha),
      onTurn: save,
    });
    if (run.status === 'gata') {
      const usage = { prompt_tokens: run.tokens_in || 0, completion_tokens: run.tokens_out || 0, model: run.model };
      // costul se loghează o singură dată, la final (în ai_usage, ca restul agenților)
      await ai.logUsage(supa, userId, 'admin-debug', usage);
    }
  } catch (e) {
    console.error('admin-debug step:', e);
    run.log = [...(run.log || []), D.logLine('error', `⛔ ${e.message}`)];
    // erorile trecătoare (rețea, suprasolicitare) nu opresc rularea: pasul următor reîncearcă
    if (e.status && [429, 502, 503, 529].includes(e.status)) run.error = null;
    else { run.status = 'eroare'; run.error = String(e.message || e).slice(0, 500); }
  } finally {
    await save(run);
    await supa.from('debug_runs').update({ locked_until: null, steps: run.steps || 0 }).eq('id', run.id);
  }
  return res.status(200).json({ run: light(run) });
}

async function stop(req, res, supa) {
  await adminUser(req, supa);
  const run = await loadRun(supa, req.body?.runId, LIGHT_COLS);
  if (run.status === 'ruleaza') {
    const log = [...(run.log || []), D.logLine('info', '⏹ Oprit de admin.')];
    const { data } = await supa.from('debug_runs').update({ status: 'oprit', log, updated_at: new Date().toISOString() }).eq('id', run.id).select(LIGHT_COLS).maybeSingle();
    return res.status(200).json({ run: light(data || run) });
  }
  return res.status(200).json({ run: light(run) });
}

async function get(req, res, supa) {
  await adminUser(req, supa);
  return res.status(200).json({ run: light(await loadRun(supa, req.body?.runId, LIGHT_COLS)) });
}

async function list(req, res, supa) {
  await adminUser(req, supa);
  const { data, error } = await supa.from('debug_runs').select('id, status, scope, area, focus, model, findings, fixes, pr, cost_micro, created_at, updated_at').order('created_at', { ascending: false }).limit(25);
  dbCheck(error, 'rulările');
  return res.status(200).json({
    runs: (data || []).map((r) => ({
      id: r.id, status: r.status, scope: r.scope, area: r.area, focus: r.focus, model: r.model, created_at: r.created_at,
      findings: (r.findings || []).length, critical: (r.findings || []).filter((f) => f.severity === 'critica').length,
      fixes: (r.fixes || []).length, approved: (r.fixes || []).filter((f) => f.decision === 'aprobat').length,
      pr: r.pr ? { number: r.pr.number, url: r.pr.url, merged: !!r.pr.merged, state: r.pr.state } : null,
      cost_lei: Math.round((r.cost_micro || 0) / 1e4) / 100,
    })),
  });
}

async function decide(req, res, supa) {
  await adminUser(req, supa);
  const run = await loadRun(supa, req.body?.runId, LIGHT_COLS);
  if (run.pr && !run.pr.closed) throw fail(409, 'Corecturile au fost deja trimise într-un pull request. Închide-l ca să schimbi decizia.');
  const id = String(req.body?.fixId || '');
  const decision = ['aprobat', 'respins'].includes(req.body?.decision) ? req.body.decision : null;
  const fixes = (run.fixes || []).map((f) => (f.id === id ? { ...f, decision } : f));
  const { data, error } = await supa.from('debug_runs').update({ fixes, updated_at: new Date().toISOString() }).eq('id', run.id).select(LIGHT_COLS).maybeSingle();
  dbCheck(error, 'decizia');
  return res.status(200).json({ run: light(data) });
}

// corecturile aprobate, aplicate pe versiunea CURENTĂ a fișierelor din ramura principală
async function buildFiles(cfg, run, ref) {
  const approved = (run.fixes || []).filter((f) => f.decision === 'aprobat');
  if (!approved.length) throw fail(400, 'Aprobă cel puțin o corectură.');
  const contents = new Map();
  const problems = [];
  for (const f of approved) {
    for (const e of f.edits || []) {
      if (!contents.has(e.path)) contents.set(e.path, await GH.fileAt(cfg, ref, e.path));
      const cur = contents.get(e.path);
      if (cur == null) {
        if (e.find === '') { contents.set(e.path, e.replace); continue; }
        problems.push(`${f.id}: fișierul ${e.path} nu mai există`);
        continue;
      }
      if (e.find === '') { problems.push(`${f.id}: ${e.path} există deja (corectura voia să-l creeze)`); continue; }
      const r = V.applyEdits(cur, [{ find: e.find, replace: e.replace }]);
      if (!r.results[0].ok) problems.push(`${f.id} (${e.path}): ${r.results[0].reason} — codul s-a schimbat între timp`);
      else contents.set(e.path, r.text);
    }
  }
  if (problems.length) throw fail(409, `Unele corecturi nu se mai potrivesc pe codul de acum: ${problems.join('; ')}. Rulează agentul din nou.`, 'CONFLICT');
  return { approved, files: [...contents].filter(([, c]) => c != null).map(([path, content]) => ({ path, content })) };
}

function prBody(run, approved) {
  const lines = [
    `Corecturi propuse de **agentul de debug** din Admin (${run.model}, ${run.scope === 'general' ? `zona: ${D.AREAS[run.area]?.label || run.area}` : D.SCOPES[run.scope] || run.scope}) și aprobate de admin.`,
    run.focus ? `\n> Cererea: ${run.focus}` : '',
    '',
    ...approved.map((f) => {
      const fin = (run.findings || []).find((x) => x.id === f.finding_id);
      return `### ${f.id} · ${f.title}\n- Risc: ${f.risk}${fin ? `\n- Problema [${fin.id}] (${fin.severity}): ${fin.title} — \`${fin.file}${fin.line ? `:${fin.line}` : ''}\`` : ''}\n- Fișiere: ${(f.files || []).map((x) => `\`${x.path}\`${x.created ? ' (nou)' : ''}`).join(', ')}\n\n${f.explanation}`;
    }),
    '',
    '---',
    'Testele și build-ul rulează automat (GitHub Actions → „Verificare"). Publicarea (merge) se face din Admin → 🐞 Agent debug.',
  ];
  return lines.filter((x) => x !== null).join('\n').slice(0, 60000);
}

async function apply(req, res, supa) {
  await adminUser(req, supa);
  const run = await loadRun(supa, req.body?.runId);
  if (run.pr && !run.pr.closed && !run.pr.merged) throw fail(409, 'Există deja un pull request pentru această rulare.');
  const cfg = GH.config();
  if (!cfg.token) throw fail(412, 'Pentru „Aplică" e nevoie de GITHUB_TOKEN în Vercel (vezi ghidul). Până atunci poți descărca corecturile ca .patch.', 'NO_GITHUB_TOKEN');
  const head = await GH.headSha(cfg);
  const { approved, files } = await buildFiles(cfg, run, head.sha);
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13).replace('T', '-');
  const branch = `agent-debug/${stamp}-${run.id.slice(0, 6)}`;
  const title = approved.length === 1 ? `Agent debug: ${approved[0].title}` : `Agent debug: ${approved.length} corecturi (${approved[0].title}${approved.length > 1 ? ' …' : ''})`;
  const pr = await GH.openPullRequest(cfg, { baseSha: head.sha, files, branch, title: title.slice(0, 200), body: prBody(run, approved), message: `${title.slice(0, 200)}\n\nCorecturi ${approved.map((f) => f.id).join(', ')} aprobate în Admin → Agent debug.` });
  const log = [...(run.log || []), D.logLine('info', `🚀 Pull request #${pr.number} creat (${files.length} fișiere) — testele și build-ul rulează pe GitHub.`)];
  const { data, error } = await supa.from('debug_runs').update({ pr: { ...pr, fixes: approved.map((f) => f.id) }, log, updated_at: new Date().toISOString() }).eq('id', run.id).select(LIGHT_COLS).maybeSingle();
  dbCheck(error, 'rularea');
  return res.status(200).json({ run: light(data) });
}

async function prStatus(req, res, supa) {
  await adminUser(req, supa);
  const run = await loadRun(supa, req.body?.runId, LIGHT_COLS);
  if (!run.pr?.number) throw fail(400, 'Rularea nu are un pull request.');
  const st = await GH.pullStatus(GH.config(), run.pr.number);
  const pr = { ...run.pr, state: st.state, merged: st.merged || !!run.pr.merged, closed: st.state === 'closed' && !st.merged, mergeable: st.mergeable, mergeable_state: st.mergeable_state, ci: st.ci, checks: st.checks, preview: st.preview, checked_at: new Date().toISOString() };
  const { data } = await supa.from('debug_runs').update({ pr }).eq('id', run.id).select(LIGHT_COLS).maybeSingle();
  return res.status(200).json({ run: light(data || { ...run, pr }) });
}

async function merge(req, res, supa) {
  await adminUser(req, supa);
  const run = await loadRun(supa, req.body?.runId, LIGHT_COLS);
  if (!run.pr?.number) throw fail(400, 'Rularea nu are un pull request.');
  const cfg = GH.config();
  const st = await GH.pullStatus(cfg, run.pr.number);
  if (st.merged) return res.status(200).json({ run: light(run), already: true });
  if (st.state !== 'open') throw fail(409, 'Pull request-ul e închis.');
  if (st.ci === 'esuat' && !req.body?.force) throw fail(409, 'Testele sau build-ul au picat pe acest pull request — nu îl public. (Vezi detaliile pe GitHub.)', 'CI_FAILED');
  if (st.ci === 'in_lucru' && !req.body?.force) throw fail(409, 'Testele încă rulează — mai așteaptă un minut.', 'CI_PENDING');
  const m = await GH.mergePull(cfg, run.pr.number, { title: `${(run.pr.title || 'Agent debug')} (#${run.pr.number})` });
  if (!m.merged) throw fail(409, `GitHub nu a făcut merge: ${m.message || 'conflict'}`);
  await GH.deleteBranch(cfg, run.pr.branch);
  const log = [...(run.log || []), D.logLine('info', `✅ Publicat: PR #${run.pr.number} unit în ${cfg.branch} — Vercel publică site-ul în 1–2 minute.`)];
  const pr = { ...run.pr, merged: true, merged_at: new Date().toISOString(), merge_sha: m.sha, ci: st.ci };
  const { data } = await supa.from('debug_runs').update({ pr, log, updated_at: new Date().toISOString() }).eq('id', run.id).select(LIGHT_COLS).maybeSingle();
  return res.status(200).json({ run: light(data || { ...run, pr, log }) });
}

async function closePr(req, res, supa) {
  await adminUser(req, supa);
  const run = await loadRun(supa, req.body?.runId, LIGHT_COLS);
  if (!run.pr?.number) throw fail(400, 'Rularea nu are un pull request.');
  const cfg = GH.config();
  await GH.closePull(cfg, run.pr.number);
  await GH.deleteBranch(cfg, run.pr.branch);
  const log = [...(run.log || []), D.logLine('info', `✕ PR #${run.pr.number} închis — nimic nu s-a schimbat pe site.`)];
  const { data } = await supa.from('debug_runs').update({ pr: { ...run.pr, closed: true, state: 'closed' }, log, updated_at: new Date().toISOString() }).eq('id', run.id).select(LIGHT_COLS).maybeSingle();
  return res.status(200).json({ run: light(data) });
}

// corecturile aprobate ca .patch (git apply) — pentru cine nu pune tokenul GitHub
async function patch(req, res, supa) {
  await adminUser(req, supa);
  const run = await loadRun(supa, req.body?.runId);
  const cfg = GH.config();
  const { files } = await buildFiles(cfg, run, run.base_sha);
  const out = [];
  for (const f of files) {
    const before = (await GH.fileAt(cfg, run.base_sha, f.path)) ?? '';
    const created = before === '' && f.content !== '';
    const hunks = V.lineDiff(before, f.content, { context: 3, clip: 1e9, maxHunks: 1e4 });
    out.push(`diff --git a/${f.path} b/${f.path}`);
    if (created) out.push('new file mode 100644');
    out.push(created ? '--- /dev/null' : `--- a/${f.path}`, `+++ b/${f.path}`);
    for (const h of hunks) {
      const a = h.lines.filter(([op]) => op !== '+').length;
      const b = h.lines.filter(([op]) => op !== '-').length;
      out.push(`@@ -${created ? 0 : h.startA ?? 0},${a} +${h.startB ?? 1},${b} @@`);
      for (const [op, t] of h.lines) out.push(`${op}${t}`);
    }
  }
  return res.status(200).json({ patch: `${out.join('\n')}\n`, name: `agent-debug-${run.id.slice(0, 8)}.patch` });
}

async function errors(req, res, supa) {
  await adminUser(req, supa);
  try { await supa.rpc('client_errors_purge'); } catch { /* migrarea nerulată */ }
  const { data, error } = await supa.from('client_errors').select('*').order('last_seen', { ascending: false }).limit(60);
  dbCheck(error, 'erorile');
  return res.status(200).json({ errors: data || [] });
}

// ═════════════════════════════════════════════════════════════════════════════
const ACTIONS = { status, start, step: stepAction, stop, get, list, decide, apply, pr_status: prStatus, merge, close_pr: closePr, patch, errors };

module.exports = async function handler(req, res) {
  ai.applyCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
  const supa = ai.admin();
  try {
    const fn = ACTIONS[req.body?.action];
    if (!fn) return res.status(400).json({ error: 'action invalid' });
    return await fn(req, res, supa);
  } catch (e) {
    if (!e.status || e.status >= 500) console.error('admin-debug:', e);
    return res.status(e.status || 500).json({ error: e.message || 'Eroare server', code: e.code || null });
  }
};
