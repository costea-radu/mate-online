// =====================================================================
// api/_lib/github.js — accesul la codul site-ului pe GitHub, pentru agentul de
// debug (api/admin-debug.js):
//   · CITIRE: commitul de pe ramura principală, lista fișierelor, conținutul lor
//     (merge și fără token, cât timp depozitul e public);
//   · SCRIERE (doar cu GITHUB_TOKEN): ramură nouă + commit + pull request cu
//     corecturile aprobate de admin; starea verificărilor (CI, Vercel); merge.
//
// Variabile (Vercel → Settings → Environment Variables):
//   GITHUB_TOKEN   — token „fine-grained" doar pentru depozitul site-ului, cu
//                    Contents: Read and write + Pull requests: Read and write
//                    (Metadata: Read vine automat). Fără el: doar citire + raport.
//   GITHUB_REPO    — opțional, implicit costea-radu/mate-online
//   GITHUB_BRANCH  — opțional, implicit main
// =====================================================================
const API = 'https://api.github.com';

function config() {
  return {
    repo: String(process.env.GITHUB_REPO || 'costea-radu/mate-online').trim(),
    branch: String(process.env.GITHUB_BRANCH || 'main').trim(),
    token: String(process.env.GITHUB_TOKEN || '').trim(),
  };
}

function ghErr(status, message, data = null) {
  const e = new Error(message);
  e.status = status; e.data = data;
  return e;
}

async function gh(cfg, path, { method = 'GET', body = null, auth = true, raw = false } = {}) {
  const headers = {
    Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'ExamenMate-agent-debug',
  };
  if (auth && cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
  if (raw) {
    if (!res.ok) throw ghErr(res.status, `GitHub ${res.status} la ${path}`);
    return res.text();
  }
  const data = res.status === 204 ? {} : await res.json().catch(() => ({}));
  if (!res.ok) {
    const limited = res.status === 403 && /rate limit/i.test(String(data.message || ''));
    throw ghErr(res.status, limited
      ? 'GitHub: limita de cereri fără token s-a atins (60 pe oră). Setează GITHUB_TOKEN în Vercel.'
      : `GitHub ${res.status}: ${data.message || 'eroare'}${path.includes('/merge') ? '' : ''}`, data);
  }
  return data;
}

// ─── citire ──────────────────────────────────────────────────────────────────
// commitul de pe ramură; fără token și cu API-ul limitat → protocolul git (info/refs)
async function headSha(cfg = config()) {
  try {
    const c = await gh(cfg, `/repos/${cfg.repo}/commits/${encodeURIComponent(cfg.branch)}`);
    return { sha: c.sha, tree: c.commit?.tree?.sha || null, message: c.commit?.message || '', date: c.commit?.committer?.date || null };
  } catch (e) {
    if (cfg.token || e.status !== 403) throw e;
    const r = await fetch(`https://github.com/${cfg.repo}.git/info/refs?service=git-upload-pack`, { headers: { 'User-Agent': 'git/2.40 ExamenMate' }, signal: AbortSignal.timeout(20000) });
    const text = await r.text();
    const m = new RegExp(`([0-9a-f]{40}) refs/heads/${cfg.branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).exec(text);
    if (!m) throw e;
    return { sha: m[1], tree: null, message: '', date: null };
  }
}

async function tree(cfg, sha) {
  const t = await gh(cfg, `/repos/${cfg.repo}/git/trees/${sha}?recursive=1`);
  return (t.tree || []).filter((x) => x.type === 'blob').map((x) => ({ path: x.path, size: x.size || 0, sha: x.sha }));
}

async function rawFile(cfg, sha, path) {
  const url = `https://raw.githubusercontent.com/${cfg.repo}/${sha}/${path.split('/').map(encodeURIComponent).join('/')}`;
  const res = await fetch(url, { headers: cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}, signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw ghErr(res.status, `GitHub raw ${res.status}: ${path}`);
  return res.text();
}

// conținutul unui fișier de pe ramura curentă (pentru re-aplicarea corecturilor)
async function fileAt(cfg, ref, path) {
  try { return await rawFile(cfg, ref, path); }
  catch (e) { if (e.status === 404) return null; throw e; }
}

// ─── scriere: ramură + commit + pull request ─────────────────────────────────
// files: [{ path, content }] — conținutul COMPLET al fișierelor schimbate/noi
async function openPullRequest(cfg, { baseSha, files, branch, title, body, message }) {
  if (!cfg.token) throw ghErr(412, 'Pentru a aplica o corectură în cod e nevoie de GITHUB_TOKEN în Vercel (vezi ghidul).');
  const base = await gh(cfg, `/repos/${cfg.repo}/git/commits/${baseSha}`);
  const entries = [];
  for (const f of files) {
    const blob = await gh(cfg, `/repos/${cfg.repo}/git/blobs`, { method: 'POST', body: { content: Buffer.from(f.content, 'utf8').toString('base64'), encoding: 'base64' } });
    entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
  const t = await gh(cfg, `/repos/${cfg.repo}/git/trees`, { method: 'POST', body: { base_tree: base.tree.sha, tree: entries } });
  const commit = await gh(cfg, `/repos/${cfg.repo}/git/commits`, { method: 'POST', body: { message: message || title, tree: t.sha, parents: [baseSha] } });
  await gh(cfg, `/repos/${cfg.repo}/git/refs`, { method: 'POST', body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
  const pr = await gh(cfg, `/repos/${cfg.repo}/pulls`, { method: 'POST', body: { title, head: branch, base: cfg.branch, body, maintainer_can_modify: true } });
  return { number: pr.number, url: pr.html_url, branch, head: commit.sha, base: baseSha, state: pr.state, created_at: pr.created_at };
}

// starea PR-ului: deschis / unit, se poate uni, verificările (GitHub Actions + Vercel)
async function pullStatus(cfg, number) {
  const pr = await gh(cfg, `/repos/${cfg.repo}/pulls/${number}`);
  const sha = pr.head?.sha;
  let checks = [];
  let statuses = [];
  try {
    const cr = await gh(cfg, `/repos/${cfg.repo}/commits/${sha}/check-runs?per_page=50`);
    checks = (cr.check_runs || []).map((c) => ({ name: c.name, status: c.status, conclusion: c.conclusion, url: c.html_url || c.details_url || null }));
  } catch { /* fără drept de citire a verificărilor: le sărim */ }
  try {
    const st = await gh(cfg, `/repos/${cfg.repo}/commits/${sha}/status`);
    statuses = (st.statuses || []).map((s) => ({ name: s.context, status: s.state === 'pending' ? 'in_progress' : 'completed', conclusion: s.state === 'success' ? 'success' : s.state === 'pending' ? null : 'failure', url: s.target_url || null }));
  } catch { /* idem */ }
  const all = [...checks, ...statuses];
  const pending = all.some((c) => c.status !== 'completed');
  const failed = all.some((c) => c.status === 'completed' && c.conclusion && !['success', 'neutral', 'skipped'].includes(c.conclusion));
  const preview = statuses.find((s) => /vercel/i.test(s.name) && s.url)?.url || null;
  return {
    number, url: pr.html_url, state: pr.state, merged: !!pr.merged, mergeable: pr.mergeable, mergeable_state: pr.mergeable_state,
    head: sha, checks: all, ci: !all.length ? 'fara' : pending ? 'in_lucru' : failed ? 'esuat' : 'trecut', preview,
  };
}

async function mergePull(cfg, number, { title = null } = {}) {
  const r = await gh(cfg, `/repos/${cfg.repo}/pulls/${number}/merge`, { method: 'PUT', body: { merge_method: 'squash', ...(title ? { commit_title: title } : {}) } });
  return { merged: !!r.merged, sha: r.sha || null, message: r.message || '' };
}

async function closePull(cfg, number) {
  await gh(cfg, `/repos/${cfg.repo}/pulls/${number}`, { method: 'PATCH', body: { state: 'closed' } });
}

async function deleteBranch(cfg, branch) {
  try { await gh(cfg, `/repos/${cfg.repo}/git/refs/heads/${branch.split('/').map(encodeURIComponent).join('/')}`, { method: 'DELETE' }); return true; }
  catch { return false; }
}

// ─── CI: ultimele rulări ale verificării automate (teste + build) pe ramura principală ──
async function ciRuns(cfg, { limit = 5 } = {}) {
  const r = await gh(cfg, `/repos/${cfg.repo}/actions/runs?branch=${encodeURIComponent(cfg.branch)}&per_page=${limit}`);
  return (r.workflow_runs || []).map((w) => ({ id: w.id, name: w.name, status: w.status, conclusion: w.conclusion, sha: w.head_sha, url: w.html_url, at: w.created_at, title: w.display_title || '' }));
}

// fragmentul relevant din jurnalul unei rulări picate (testele „not ok", erorile de build)
async function ciFailureExcerpt(cfg, runId, { maxChars = 6000 } = {}) {
  const jobs = await gh(cfg, `/repos/${cfg.repo}/actions/runs/${runId}/jobs`);
  const failed = (jobs.jobs || []).filter((j) => j.conclusion === 'failure');
  const out = [];
  for (const j of failed.slice(0, 2)) {
    let log = '';
    try {
      const res = await fetch(`${API}/repos/${cfg.repo}/actions/jobs/${j.id}/logs`, { headers: { 'User-Agent': 'ExamenMate-agent-debug', ...(cfg.token ? { Authorization: `Bearer ${cfg.token}` } : {}) }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
      if (res.ok) log = await res.text();
    } catch { log = ''; }
    const lines = log.split('\n').map((l) => l.replace(/^\S+Z\s/, ''));
    const keep = [];
    lines.forEach((l, i) => {
      if (/not ok \d+|AssertionError|Error:|error TS|✘|failed|SyntaxError|Cannot find module/i.test(l)) {
        keep.push(...lines.slice(Math.max(0, i - 2), i + 6));
      }
    });
    out.push(`── job „${j.name}" (eșuat) ──\n${(keep.length ? keep : lines.slice(-60)).join('\n')}`);
  }
  return out.join('\n\n').slice(0, maxChars);
}

module.exports = { config, gh, headSha, tree, rawFile, fileAt, openPullRequest, pullStatus, mergePull, closePull, deleteBranch, ciRuns, ciFailureExcerpt };
