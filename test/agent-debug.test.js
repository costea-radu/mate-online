// Teste pentru AGENTUL DE DEBUG (Admin → 🐞 Agent debug): uneltele pe
// instantaneul codului (listare, citire, căutare), validarea corecturilor
// propuse (fragment unic, fișiere interzise, cod de server care nu se mai
// compilează), bucla pe pași (cu modelul simulat), limitele de pași/buget și
// fluxul HTTP: start → pași → aprobare → pull request → merge (GitHub simulat).
// Plus: fluxul SSE al API-ului Anthropic și raportarea erorilor din browser.
process.env.ANTHROPIC_API_KEY = 'test-key';
const test = require('node:test');
const assert = require('node:assert');
const D = require('../api/_lib/debugAgent');
const claude = require('../api/_lib/claude');

const FILES = {
  'api/live.js': "const L = require('./_lib/live');\nfunction privateBegin(req, res) {\n  const ends = new Date(now + 60 * 60000);\n  return ends;\n}\nmodule.exports = { privateBegin };\n",
  'src/pages/LiveRoom.jsx': "export default function LiveRoom() {\n  const left = privEnds - Date.now();\n  if (left <= 0) stop();\n  return null;\n}\n",
  'package.json': '{\n  "name": "examenmate"\n}\n',
  'test/live.test.js': "const test = require('node:test');\n",
};
const snap = () => D.fromFiles('abc1234567890', FILES);

// ─── 1. uneltele ─────────────────────────────────────────────────────────────
test('glob, listare, citire cu numere de rând, căutare', () => {
  assert.ok(D.globToRegex('src/**/*.jsx').test('src/pages/LiveRoom.jsx'));
  assert.ok(!D.globToRegex('api/*.js').test('api/_lib/live.js'));
  assert.ok(D.globToRegex('live').test('api/_lib/live.js'), 'fără caractere speciale = conține');
  const s = snap();
  assert.match(D.listFiles(s, { dir: 'api' }), /api\/live\.js \(7 r\.\)/);
  const rf = D.readFile(s, { path: './api/live.js', start_line: 2, end_line: 3 });
  assert.match(rf, /rândurile 2–3 din 7/);
  assert.match(rf, /^3\t {2}const ends/m);
  assert.match(D.readFile(s, { path: 'nu/exista.js' }), /nu există/);
  assert.match(D.searchCode(s, { pattern: 'privEnds' }), /^src\/pages\/LiveRoom\.jsx:2: const left = privEnds/);
  assert.match(D.searchCode(s, { pattern: '(' }), /invalidă/);
  assert.ok(D.wantFile('api/live.js') && !D.wantFile('Claude outputs/a.png') && !D.wantFile('package-lock.json'));
});

test('validateFix: fragment unic, fișier nou, fișiere interzise, cod de server care nu se mai compilează', () => {
  const s = snap();
  const ok = D.validateFix(s, [{ path: 'api/live.js', find: 'const ends = new Date(now + 60 * 60000);', replace: 'const ends = new Date(now + minutes * 60000);' }]);
  assert.strictEqual(ok.ok, true, ok.error);
  assert.strictEqual(ok.added, 1); assert.strictEqual(ok.removed, 1);
  assert.deepStrictEqual(ok.files, [{ path: 'api/live.js', created: false }]);
  // ambiguu
  const amb = D.validateFix(s, [{ path: 'api/live.js', find: 'e', replace: 'E' }]);
  assert.strictEqual(amb.ok, false);
  assert.match(amb.error, /apare de \d+ ori/);
  // fișier nou
  const nw = D.validateFix(s, [{ path: 'test/nou.test.js', find: '', replace: "const test = require('node:test');\n" }]);
  assert.strictEqual(nw.ok, true);
  assert.strictEqual(nw.files[0].created, true);
  // interzise
  assert.match(D.validateFix(s, [{ path: '.github/workflows/x.yml', find: '', replace: 'x' }]).error, /nu se modifică/);
  assert.match(D.validateFix(s, [{ path: '.env.production', find: '', replace: 'x' }]).error, /nu se modifică/);
  // sintaxă stricată în api/
  const bad = D.validateFix(s, [{ path: 'api/live.js', find: '  return ends;\n}', replace: '  return ends;\n' }]);
  assert.strictEqual(bad.ok, false);
  assert.match(bad.error, /nu se mai compilează/);
  // JSON stricat
  assert.match(D.validateFix(s, [{ path: 'package.json', find: '"examenmate"', replace: '"examenmate",' }]).error, /JSON/);
  // două editări pe același fișier: a doua vede rezultatul primei
  const two = D.validateFix(s, [
    { path: 'src/pages/LiveRoom.jsx', find: 'if (left <= 0) stop();', replace: 'if (left <= 0 && done) stop();' },
    { path: 'src/pages/LiveRoom.jsx', find: 'left <= 0 && done', replace: 'left <= 0 && lessonDone' },
  ]);
  assert.strictEqual(two.ok, true, two.error);
});

test('zona „generală": se alege zona verificată cel mai demult', () => {
  const all = Object.keys(D.AREAS);
  assert.strictEqual(D.pickArea([]), all[0]);
  assert.strictEqual(D.pickArea([all[0]]), all[1]);
  assert.strictEqual(D.pickArea(all.slice(0, -1)), all[all.length - 1]);
});

// ─── 2. bucla pe pași, cu modelul simulat ────────────────────────────────────
function fakeCall(script) {
  const calls = [];
  const fn = async (opts) => {
    calls.push(opts);
    const next = script.shift();
    const content = typeof next === 'function' ? next(opts) : next;
    const uses = content.filter((b) => b.type === 'tool_use');
    return { ok: true, model: opts.model, data: { content, stop_reason: uses.length ? 'tool_use' : 'end_turn', usage: { input_tokens: 1000, output_tokens: 300, cache_read_input_tokens: 5000 } }, text: claude.textOf(content), stop: uses.length ? 'tool_use' : 'end_turn' };
  };
  fn.calls = calls;
  return fn;
}
const toolUse = (id, name, input) => ({ type: 'tool_use', id, name, input });

test('pasul: unelte → problemă → corectură validată → raport; costul și jurnalul cresc', async () => {
  const call = fakeCall([
    [{ type: 'thinking', thinking: 'mă uit întâi la erori', signature: 'sig1' }, { type: 'text', text: 'Încep cu erorile reale.' }, toolUse('t1', 'recent_errors', {}), toolUse('t2', 'read_file', { path: 'api/live.js' })],
    [toolUse('t3', 'report_finding', { severity: 'majora', kind: 'bug', title: 'Ședința se oprește la 60 de minute', file: 'api/live.js', line: 3, details: 'ends fix', suggestion: 'prelungire' }),
      toolUse('t4', 'propose_fix', { finding_id: 'F1', title: 'Minutele din setare', explanation: 'folosește setarea', risk: 'mic', edits: [{ path: 'api/live.js', find: 'now + 60 * 60000', replace: 'now + minutes * 60000' }] }),
      toolUse('t5', 'propose_fix', { title: 'greșită', explanation: 'x', risk: 'mic', edits: [{ path: 'api/live.js', find: 'nu există', replace: 'y' }] })],
    [{ type: 'text', text: '## Rezumat\nAm găsit o problemă.\n## Probleme\n- [F1] …' }],
  ]);
  const run = { id: 'r1', scope: 'live', area: 'live', model: 'claude-opus-5-5', effort: 'high', messages: [], log: [], findings: [], fixes: [], turns: 0, cost_micro: 0 };
  const saves = [];
  await D.step(run, { snap: snap(), deadline: Date.now() + 600000, call, errors: async () => 'Nicio eroare.', onTurn: async (r) => saves.push(r.turns) });
  assert.strictEqual(run.status, 'gata');
  assert.match(run.report, /## Rezumat/);
  assert.strictEqual(run.findings.length, 1);
  assert.strictEqual(run.fixes.length, 1, 'corectura greșită nu se înregistrează');
  assert.strictEqual(run.fixes[0].finding_id, 'F1');
  assert.strictEqual(run.turns, 3);
  assert.deepStrictEqual(saves, [1, 2, 3], 'conversația se salvează după fiecare tur');
  assert.ok(run.cost_micro > 0);
  // prima cerere: sistemul + uneltele, gândire adaptivă, cache
  assert.strictEqual(call.calls[0].cache, true);
  assert.ok(call.calls[0].tools.some((t) => t.name === 'propose_fix'));
  // blocul de gândire se trimite înapoi NESCHIMBAT (cerința API-ului în bucla de unelte)
  const second = call.calls[1].messages;
  assert.deepStrictEqual(second[1].content[0], { type: 'thinking', thinking: 'mă uit întâi la erori', signature: 'sig1' });
  // rezultatul uneltei greșite i-a spus modelului de ce
  const third = call.calls[2].messages;
  const results = third[third.length - 1].content;
  assert.match(results.find((r) => r.tool_use_id === 't5').content, /RESPINSĂ LA VALIDARE/);
  assert.ok(run.log.some((l) => /🐞 \[F1\]/.test(l.text)) && run.log.some((l) => /🛠 \[C1\]/.test(l.text)));
});

test('limita de pași: ultimul tur cere raportul fără unelte (tool_choice none)', async () => {
  const call = fakeCall([
    [toolUse('a', 'list_files', { dir: 'api' })],
    [toolUse('b', 'list_files', { dir: 'src' })],
    (opts) => { assert.strictEqual(opts.toolChoice, 'none'); return [{ type: 'text', text: '## Rezumat\nLimită atinsă.' }]; },
  ]);
  const run = { id: 'r2', scope: 'general', area: 'live', model: 'claude-sonnet-5-5', messages: [], log: [], findings: [], fixes: [], turns: 0, cost_micro: 0 };
  await D.step(run, { snap: snap(), deadline: Date.now() + 600000, call, maxTurns: 2 });
  assert.strictEqual(run.status, 'gata');
  assert.strictEqual(call.calls.length, 3);
  const lastMsg = call.calls[2].messages[call.calls[2].messages.length - 1];
  assert.strictEqual(lastMsg.role, 'user');
  assert.ok(lastMsg.content.some((b) => b.type === 'text' && /raportul final/.test(b.text)), 'textul e lipit de rezultatele uneltelor (nu două mesaje user)');
});

test('compact: rezultatele vechi ale uneltelor se scurtează când conversația crește', () => {
  const big = 'x'.repeat(200000);
  const msgs = [];
  for (let i = 0; i < 6; i++) {
    msgs.push({ role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'read_file', input: {} }] });
    msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: big }] });
  }
  const out = D.compact(msgs);
  assert.ok(JSON.stringify(out).length <= 650000);
  assert.strictEqual(out[out.length - 1].content[0].content.length, big.length, 'ultimul rezultat rămâne întreg');
  assert.match(out[1].content[0].content, /rezultat scurtat/);
});

// ─── 3. fluxul SSE (streaming) al API-ului Anthropic ─────────────────────────
function sseBody(events) {
  const text = events.map(([ev, data]) => `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`).join('');
  const chunks = [text.slice(0, 37), text.slice(37, 200), text.slice(200)];   // bucăți tăiate oriunde
  return { async *[Symbol.asyncIterator]() { for (const c of chunks) yield Buffer.from(c); } };
}

test('streaming: text + gândire (cu semnătură) + unealtă din bucăți JSON; reîncercare fără effort la 400', async () => {
  const bodies = [];
  global.fetch = async (url, opts) => {
    const b = JSON.parse(opts.body);
    bodies.push(b);
    if (bodies.length === 1) return { ok: false, status: 400, json: async () => ({ error: { message: 'output_config.effort: not supported for this model' } }) };
    return {
      ok: true, status: 200,
      body: sseBody([
        ['message_start', { type: 'message_start', message: { id: 'm1', model: b.model, usage: { input_tokens: 50, cache_read_input_tokens: 900 } } }],
        ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Calculez: ' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '2+12=14' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'SIG' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 0 }],
        ['content_block_start', { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Citesc ' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'fișierul.' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 1 }],
        ['content_block_start', { type: 'content_block_start', index: 2, content_block: { type: 'tool_use', id: 'tu1', name: 'read_file', input: {} } }],
        ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: '{"path": "api/li' } }],
        ['content_block_delta', { type: 'content_block_delta', index: 2, delta: { type: 'input_json_delta', partial_json: 've.js"}' } }],
        ['content_block_stop', { type: 'content_block_stop', index: 2 }],
        ['message_delta', { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 77 } }],
        ['message_stop', { type: 'message_stop' }],
      ]),
    };
  };
  const r = await claude.callAdvanced({ model: 'claude-opus-5-5', system: 'S', messages: [{ role: 'user', content: 'x' }], tools: D.TOOLS, effort: 'xhigh' });
  assert.strictEqual(bodies.length, 2);
  assert.strictEqual(bodies[0].output_config.effort, 'xhigh');
  assert.strictEqual(bodies[1].output_config, undefined, 'a doua încercare fără effort');
  assert.deepStrictEqual(bodies[1].thinking, { type: 'adaptive' });
  assert.deepStrictEqual(bodies[1].system[0].cache_control, { type: 'ephemeral' });
  assert.deepStrictEqual(bodies[1].messages[0].content[0].cache_control, { type: 'ephemeral' });
  assert.strictEqual(r.stop, 'tool_use');
  assert.strictEqual(r.text, 'Citesc fișierul.');
  assert.deepStrictEqual(r.data.content[0], { type: 'thinking', thinking: 'Calculez: 2+12=14', signature: 'SIG' });
  assert.deepStrictEqual(r.data.content[2].input, { path: 'api/live.js' });
  assert.deepStrictEqual(r.data.usage, { input_tokens: 50, cache_read_input_tokens: 900, output_tokens: 77 });
  // costul cu cache: citirea din cache la Opus 5.5 = 5% din prețul de intrare
  assert.strictEqual(claude.effectiveInput('claude-opus-5-5', r.data.usage), 95);
  assert.ok(Math.abs(claude.costUsd('claude-opus-5-5', r.data.usage) - (95 * 4 + 77 * 20) / 1e6) < 1e-12);
});

// ─── 4. fluxul HTTP: start → pași → aprobare → PR → merge ────────────────────
const ai = require('../api/_lib/ai');
const GH = require('../api/_lib/github');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ADMIN = '33333333-3333-4333-8333-333333333333';
let fake = null;
ai.admin = () => fake;
ai.authUser = async (req) => req.headers['x-user'];
ai.logUsage = async () => {};
const gh = { prs: [], merged: [], deleted: [], ci: 'trecut' };
GH.config = () => ({ repo: 'costea-radu/mate-online', branch: 'main', token: 'tok' });
GH.headSha = async () => ({ sha: 'abc1234567890', message: 'ultimul commit' });
GH.tree = async () => Object.entries(FILES).map(([p, c]) => ({ path: p, size: c.length }));
GH.rawFile = async (cfg, sha, p) => FILES[p];
GH.fileAt = async (cfg, ref, p) => FILES[p] ?? null;
GH.ciRuns = async () => [];
GH.openPullRequest = async (cfg, o) => { gh.prs.push(o); return { number: 7, url: 'https://github.com/x/pull/7', branch: o.branch, head: 'h', base: o.baseSha, state: 'open' }; };
GH.pullStatus = async () => ({ number: 7, state: 'open', merged: false, mergeable: true, ci: gh.ci, checks: [{ name: 'Teste + build', status: 'completed', conclusion: gh.ci === 'trecut' ? 'success' : 'failure' }], preview: null });
GH.mergePull = async (cfg, n) => { gh.merged.push(n); return { merged: true, sha: 'm1' }; };
GH.deleteBranch = async (cfg, b) => { gh.deleted.push(b); return true; };
const handler = require('../api/admin-debug');
async function call(action, body = {}, user = ADMIN) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: { 'x-user': user }, query: {}, body: { action, ...body } }, res);
  return res;
}

test('HTTP: start → pas (simulat) → aprobare → pull request → testele trec → publicare', async () => {
  fake = createFakeSupabase({ profiles: [{ id: ADMIN, is_admin: true }, { id: 'u2', is_admin: false }], debug_runs: [], client_errors: [] });
  assert.strictEqual((await call('status', {}, 'u2')).statusCode, 403);
  const st = await call('status');
  assert.strictEqual(st.statusCode, 200, JSON.stringify(st.body));
  assert.strictEqual(st.body.token, true);

  const s0 = await call('start', { scope: 'live', focus: 'la 1-la-1 se oprește la 60 de minute', model: 'claude-opus-5-5', budgetLei: 15 });
  assert.strictEqual(s0.statusCode, 200, JSON.stringify(s0.body));
  const runId = s0.body.run.id;
  assert.strictEqual((await call('start', { scope: 'live' })).statusCode, 409, 'nu două rulări deodată');

  // modelul simulat, prin fetch (cererea reală trece prin claude.callAdvanced)
  const replies = [
    [toolUse('t1', 'read_file', { path: 'api/live.js' })],
    [toolUse('t2', 'report_finding', { severity: 'majora', kind: 'bug', title: '60 de minute fixe', file: 'api/live.js', line: 3, details: 'd' }),
      toolUse('t3', 'propose_fix', { finding_id: 'F1', title: 'Minute din setare', explanation: 'e', risk: 'mic', edits: [{ path: 'api/live.js', find: 'now + 60 * 60000', replace: 'now + minutes * 60000' }] })],
    [{ type: 'text', text: '## Rezumat\nO problemă, o corectură.' }],
  ];
  global.fetch = async () => {
    const content = replies.shift();
    return { ok: true, status: 200, json: async () => ({ content, stop_reason: content.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn', usage: { input_tokens: 2000, output_tokens: 400 } }) };
  };
  const s1 = await call('step', { runId });
  assert.strictEqual(s1.statusCode, 200, JSON.stringify(s1.body));
  const run = s1.body.run;
  assert.strictEqual(run.status, 'gata');
  assert.strictEqual(run.findings.length, 1);
  assert.strictEqual(run.fixes.length, 1);
  assert.strictEqual(run.fixes[0].edits, 1, 'editările întregi rămân pe server');
  assert.ok(run.fixes[0].diff[0].hunks.length);
  assert.ok(run.cost_lei > 0);
  assert.strictEqual(fake.db.tables.debug_runs[0].locked_until, null, 'lacătul pasului s-a eliberat');

  // fără aprobare nu se poate aplica
  assert.strictEqual((await call('apply', { runId })).statusCode, 400);
  const d = await call('decide', { runId, fixId: 'C1', decision: 'aprobat' });
  assert.strictEqual(d.body.run.fixes[0].decision, 'aprobat');
  const a = await call('apply', { runId });
  assert.strictEqual(a.statusCode, 200, JSON.stringify(a.body));
  assert.strictEqual(a.body.run.pr.number, 7);
  assert.strictEqual(gh.prs[0].files[0].path, 'api/live.js');
  assert.ok(gh.prs[0].files[0].content.includes('now + minutes * 60000'));
  assert.match(gh.prs[0].branch, /^agent-debug\//);
  assert.match(gh.prs[0].body, /C1 · Minute din setare/);
  // decizia nu se mai schimbă cât PR-ul e deschis
  assert.strictEqual((await call('decide', { runId, fixId: 'C1', decision: 'respins' })).statusCode, 409);

  // testele au picat → nu se publică
  gh.ci = 'esuat';
  const m0 = await call('merge', { runId });
  assert.strictEqual(m0.statusCode, 409);
  assert.strictEqual(m0.body.code, 'CI_FAILED');
  gh.ci = 'trecut';
  const m = await call('merge', { runId });
  assert.strictEqual(m.statusCode, 200, JSON.stringify(m.body));
  assert.strictEqual(m.body.run.pr.merged, true);
  assert.deepStrictEqual(gh.merged, [7]);
  assert.strictEqual(gh.deleted.length, 1);

  // .patch pentru aplicarea manuală
  const p = await call('patch', { runId });
  assert.match(p.body.patch, /^diff --git a\/api\/live\.js b\/api\/live\.js/m);
  assert.match(p.body.patch, /^-  const ends = new Date\(now \+ 60 \* 60000\);$/m);
  assert.match(p.body.patch, /^\+  const ends = new Date\(now \+ minutes \* 60000\);$/m);
  const list = await call('list');
  assert.strictEqual(list.body.runs[0].pr.merged, true);
});

// ─── 5. erorile din browser ──────────────────────────────────────────────────
test('erorile din browser: aceeași eroare = aceeași amprentă; e-mailurile și tokenurile se scot', async () => {
  const ce = require('../api/client-error');
  const a = ce.fingerprint('Cannot read properties of undefined (reading 12)', 'TypeError\n    at f (https://examenmate.com/assets/LiveRoom-AbC123de.js:1:2345)');
  const b = ce.fingerprint('Cannot read properties of undefined (reading 99)', 'TypeError\n    at f (https://examenmate.com/assets/LiveRoom-ZzY987xx.js:1:2345)');
  assert.strictEqual(a, b, 'numerele și hash-ul fișierului nu contează');
  assert.strictEqual(ce.clean('user ion@ex.ro token=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmn', 200), 'user <email> token=<…>');
  fake = createFakeSupabase({});
  const res = fakeRes();
  await ce({ method: 'POST', headers: { 'x-forwarded-for': '1.2.3.4', 'user-agent': 'UA' }, body: { errors: [{ message: 'ResizeObserver loop limit exceeded' }, { message: 'x is not a function', stack: 'at y (/assets/a.js:1:1)', url: '/meditatii?token=abc' }] } }, res);
  assert.strictEqual(res.body.saved, 1, 'zgomotul (ResizeObserver) se ignoră');
  const rpc = fake.db.rpcs[0];
  assert.strictEqual(rpc.name, 'report_client_error');
  assert.strictEqual(rpc.args.p_url, '/meditatii', 'fără parametrii adresei');
});
