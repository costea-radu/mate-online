// Teste pentru FINALIZAREA TEMELOR din meditații (node --test, fără rețea):
//   · „🏁 Finalizează tema" merge și cu probleme nerezolvate → temă INCOMPLETĂ
//     (problemele nerezolvate nu primesc răspunsul și nu intră la greșeli);
//   · toate rezolvate → temă FINALIZATĂ („rezolvata");
//   · răspunsurile se păstrează → tema se RELUĂ de unde a rămas (și ciorna);
//   · o temă neterminată NU blochează alte teme la cererea elevului
//     (cronul automat rămâne plafonat la 2 teme nefăcute);
//   · fără migrarea SQL (CHECK fără „incompleta") → fallback „rezolvata" +
//     feedback.complete=false, citit la fel de UI.
// Clientul Supabase e un dublu minimal; autentificarea/abonamentul sunt stub-uite.
const test = require('node:test');
const assert = require('node:assert');

const ai = require('../api/_lib/ai');
const med = require('../api/_lib/meditatii');

const USER = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HW = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const HW2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const HW3 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CONTENT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let db;                     // { tabel: [rânduri] }
let rejectIncompleta = false; // simulează CHECK-ul vechi (fără migrare)
let notifications = [];
let seq = 0;

// ── dublu pentru supabase-js (doar ce folosesc handlerele temelor) ──
function fakeSupabase() {
  function table(name) {
    db[name] ||= [];
    const q = { f: [], op: null, payload: null, select: null, order: null, limit: null, range: null, single: false, maybe: false };
    const api = {
      select(cols) { q.select = cols; if (!q.op) q.op = 'select'; return api; },
      insert(rows) { q.op = 'insert'; q.payload = rows; return api; },
      update(patch) { q.op = 'update'; q.payload = patch; return api; },
      upsert(rows, opts) { q.op = 'upsert'; q.payload = rows; q.opts = opts; return api; },
      delete() { q.op = 'delete'; return api; },
      eq(c, v) { q.f.push((r) => r[c] === v); return api; },
      in(c, vals) { q.f.push((r) => vals.includes(r[c])); return api; },
      lte(c, v) { q.f.push((r) => r[c] != null && String(r[c]) <= String(v)); return api; },
      not(c, op, v) { if (op === 'is' && v === null) q.f.push((r) => r[c] != null); return api; },
      order(c, o) { q.order = [c, o?.ascending !== false]; return api; },
      limit(n) { q.limit = n; return api; },
      range(a, b) { q.range = [a, b]; return api; },
      single() { q.single = true; return api; },
      maybeSingle() { q.maybe = true; return api; },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    const matching = () => db[name].filter((r) => q.f.every((fn) => fn(r)));
    // `alias:col->key` / `alias:col->>key` din select (ca în handlerul state)
    function project(row) {
      if (!q.select || q.select === '*') return { ...row };
      const out = {};
      q.select.split(',').map((s) => s.trim()).filter(Boolean).forEach((part) => {
        let alias = null, expr = part;
        const m = part.match(/^([A-Za-z_]+):(.+)$/);
        if (m) { alias = m[1]; expr = m[2]; }
        const j = expr.match(/^([A-Za-z_]+)->>?([A-Za-z_]+)$/);
        if (j) out[alias || j[2]] = row[j[1]] ? (expr.includes('->>') ? (row[j[1]][j[2]] == null ? null : String(row[j[1]][j[2]])) : row[j[1]][j[2]] ?? null) : null;
        else out[alias || expr] = row[expr];
      });
      return out;
    }
    function finish(rows) {
      if (q.order) { const [c, asc] = q.order; rows = [...rows].sort((a, b) => (a[c] > b[c] ? 1 : a[c] < b[c] ? -1 : 0) * (asc ? 1 : -1)); }
      if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
      if (q.limit != null) rows = rows.slice(0, q.limit);
      const data = rows.map(project);
      if (q.single) return data[0] ? { data: data[0], error: null } : { data: null, error: { message: 'not found' } };
      if (q.maybe) return { data: data[0] || null, error: null };
      return { data, error: null };
    }
    function run() {
      if (q.op === 'insert') {
        const rows = (Array.isArray(q.payload) ? q.payload : [q.payload]).map((r) => ({ id: `gen-${++seq}`, ...r }));
        db[name].push(...rows);
        return finish(rows);
      }
      if (q.op === 'upsert') {
        const keys = String(q.opts?.onConflict || 'id').split(',');
        const rows = Array.isArray(q.payload) ? q.payload : [q.payload];
        rows.forEach((r) => {
          const ex = db[name].find((x) => keys.every((k) => x[k] === r[k]));
          if (ex) Object.assign(ex, r); else db[name].push({ id: `gen-${++seq}`, ...r });
        });
        return { data: null, error: null };
      }
      if (q.op === 'update') {
        if (name === 'ai_meditatii_homework' && rejectIncompleta && q.payload.status === 'incompleta') {
          return { data: null, error: { code: '23514', message: 'new row for relation "ai_meditatii_homework" violates check constraint "ai_meditatii_homework_status_check"' } };
        }
        const rows = matching();
        rows.forEach((r) => Object.assign(r, q.payload));
        return finish(rows);
      }
      if (q.op === 'delete') {
        const rows = matching();
        db[name] = db[name].filter((r) => !rows.includes(r));
        return { data: null, error: null };
      }
      return finish(matching());
    }
    return api;
  }
  return { from: (name) => table(name), rpc: async () => ({ data: null, error: null }) };
}

// ── stub-uri: clientul, utilizatorul (admin = are meditații), notificările ──
ai.applyCors = () => {};
ai.admin = () => fakeSupabase();
ai.authUser = async () => USER;
ai.requireUser = async () => ({ id: USER, is_admin: true, subscription_status: 'active' });
ai.enforceRateLimit = async () => {};
ai.logUsage = async () => {};
ai.isCronRequest = () => true;
ai.createNotification = async (supa, n) => { notifications.push(n); return true; };
// fără LLM: clasificarea greșelilor e deterministă; site-first dă un test din site
med.classifyMistakes = async (items) => items.map((_, i) => ({ index: i, errorType: 'calcul', analysis: 'explicație' }));
med.siteInteractiveFor = async () => [{ id: CONTENT, title: 'Test din site · Ecuații', url: `/exercitiu?id=${CONTENT}` }];
med.genQuestions = async () => ({ questions: [], provider: 'stub', usage: {} });

const handler = require('../api/ai-meditatii');

function post(body) { return { method: 'POST', headers: {}, body, query: {} }; }
function res() {
  const r = { statusCode: 200, body: null, headers: {} };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}
async function call(body) { const r = res(); await handler(post(body), r); return r; }

const QUESTIONS = [
  { statement: '2+2=?', options: ['3', '4', '5'], answer: 1, explanation: 'e1', topic: 'adunare' },
  { statement: '3·3=?', options: ['6', '9', '12'], answer: 1, explanation: 'e2', topic: 'inmultire' },
  { statement: 'x+1=5, x=?', answer: '4', explanation: 'e3', topic: 'ecuatii' },
  { statement: '10-7=?', answer: '3', explanation: 'e4', topic: 'scadere' },
];

test.beforeEach(() => {
  rejectIncompleta = false; notifications = []; seq = 0;
  db = {
    ai_meditatii_profile: [{
      user_id: USER, grade: 7, exam_target: null, level: 'mediu', assessment: {}, memory: {}, focus: null,
      plan: { chapters: [{ id: 'c7-ecuatii', title: 'Ecuații', status: 'in_lucru', mastery: 0.4, topics: ['ecuații'] }] },
      streak_days: 0, last_study_date: null, total_seconds: 0,
    }],
    ai_meditatii_homework: [{
      id: HW, user_id: USER, kind: 'interactive', title: 'Temă · Ecuații', chapter: 'c7-ecuatii', topic: 'Ecuații',
      status: 'data', payload: { questions: QUESTIONS }, score: null, max_score: null, attempts: 0, feedback: {},
      assigned_at: '2026-08-20T10:00:00.000Z', due_at: '2026-08-23T10:00:00.000Z', completed_at: null,
    }],
    ai_meditatii_mistakes: [], ai_meditatii_sessions: [], ai_meditatii_reviews: [], ai_skill_mastery: [],
    ai_notifications: [], progress: [], mentor_students: [], profiles: [{ id: USER, full_name: 'Ana Pop', subscription_status: 'active', is_admin: false }],
  };
});

// ═══ helperii puri ══════════════════════════════════════════════════════════
test('homeworkOutcome: numără răspunsurile reale; complet doar când sunt toate', () => {
  const qs = QUESTIONS;
  assert.deepStrictEqual(med.homeworkOutcome(qs, [1, 1, '4', '3']), { answered: 4, total: 4, complete: true, status: 'rezolvata' });
  // gol / spații / null = nerezolvat; 0 (prima variantă) = răspuns valid
  assert.deepStrictEqual(med.homeworkOutcome(qs, [0, null, '  ', '']), { answered: 1, total: 4, complete: false, status: 'incompleta' });
  assert.deepStrictEqual(med.homeworkOutcome(qs, null), { answered: 0, total: 4, complete: false, status: 'incompleta' });
  // răspunsuri în plus (peste numărul întrebărilor) nu contează
  assert.strictEqual(med.homeworkOutcome(qs, [1, 1, '4', '3', 'x', 'y']).answered, 4);
  assert.strictEqual(med.answeredCount([null, 0, '', 'a']), 2);
});

test('isHomeworkIncomplete / isHomeworkFinal: statusul nou ȘI forma de fallback', () => {
  assert.strictEqual(med.isHomeworkIncomplete({ status: 'incompleta' }), true);
  assert.strictEqual(med.isHomeworkIncomplete({ status: 'rezolvata', feedback: { complete: false } }), true);
  assert.strictEqual(med.isHomeworkIncomplete({ status: 'rezolvata', feedback: { complete: true } }), false);
  assert.strictEqual(med.isHomeworkIncomplete({ status: 'rezolvata', feedback: {} }), false);
  assert.strictEqual(med.isHomeworkIncomplete({ status: 'data' }), false);
  assert.strictEqual(med.isHomeworkFinal({ status: 'incompleta' }), true);
  assert.strictEqual(med.isHomeworkFinal({ status: 'rezolvata' }), true);
  assert.strictEqual(med.isHomeworkFinal({ status: 'data' }), false);
});

// ═══ finalizarea unui set pregătit de profesor ══════════════════════════════
test('homework_submit: finalizare cu probleme nerezolvate → temă INCOMPLETĂ, răspunsurile rămân, nerezolvatele nu primesc răspunsul', async () => {
  // 2 rezolvate (una corectă, una greșită), 2 nerezolvate
  const r = await call({ action: 'homework_submit', id: HW, answers: [1, 0, null, ''], durationSec: 90 });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.complete, false);
  assert.strictEqual(r.body.answered, 2);
  assert.strictEqual(r.body.total, 4);
  assert.strictEqual(r.body.status, 'incompleta');
  assert.strictEqual(r.body.score, 1);
  assert.strictEqual(r.body.maxScore, 4);
  assert.match(r.body.feedback, /incomplet/i);
  // problemele nerezolvate: marcate, FĂRĂ răspunsul corect / rezolvare
  const [q1, q2, q3, q4] = r.body.results;
  assert.strictEqual(q1.correct, true);
  assert.strictEqual(q2.correct, false); assert.ok(!q2.skipped); assert.strictEqual(q2.answer, 1);
  assert.strictEqual(q3.skipped, true); assert.strictEqual(q3.answer, null); assert.strictEqual(q3.explanation, '');
  assert.strictEqual(q4.skipped, true); assert.strictEqual(q4.answer, null);
  // în jurnalul greșelilor intră DOAR problema greșită (nu și cele nerezolvate)
  assert.strictEqual(db.ai_meditatii_mistakes.length, 1);
  assert.strictEqual(db.ai_meditatii_mistakes[0].statement, '3·3=?');
  // rândul temei: status, scor, răspunsurile salvate pentru reluare
  const hw = db.ai_meditatii_homework[0];
  assert.strictEqual(hw.status, 'incompleta');
  assert.strictEqual(hw.score, 1); assert.strictEqual(hw.max_score, 4); assert.strictEqual(hw.attempts, 1);
  assert.deepStrictEqual(hw.payload.answers, [1, 0, null, null]);
  assert.deepStrictEqual({ complete: hw.feedback.complete, answered: hw.feedback.answered, total: hw.feedback.total }, { complete: false, answered: 2, total: 4 });
  assert.ok(hw.feedback.grade >= 1 && hw.feedback.grade <= 10);
  // nota: 1 corect din 4 → 1 + 9·0,25 = 3,25
  assert.strictEqual(hw.feedback.grade, 3.25);
});

test('homework_submit: toate rezolvate → temă FINALIZATĂ („rezolvata", complete=true)', async () => {
  const r = await call({ action: 'homework_submit', id: HW, answers: [1, 1, '4', '3'] });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.complete, true);
  assert.strictEqual(r.body.status, 'rezolvata');
  assert.strictEqual(r.body.score, 4);
  assert.strictEqual(r.body.grade, 10);
  assert.ok(r.body.results.every((x) => !x.skipped));
  const hw = db.ai_meditatii_homework[0];
  assert.strictEqual(hw.status, 'rezolvata');
  assert.strictEqual(hw.feedback.complete, true);
  assert.strictEqual(med.isHomeworkIncomplete(hw), false);
});

test('homework_submit: 0 răspunsuri → se poate finaliza (incompletă 0/4), fără greșeli în jurnal', async () => {
  const r = await call({ action: 'homework_submit', id: HW, answers: [] });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.complete, false);
  assert.strictEqual(r.body.answered, 0);
  assert.strictEqual(r.body.score, 0);
  assert.strictEqual(db.ai_meditatii_mistakes.length, 0);
  assert.strictEqual(db.ai_meditatii_homework[0].status, 'incompleta');
});

test('fără migrarea SQL: CHECK-ul respinge „incompleta" → fallback „rezolvata" + feedback.complete=false', async () => {
  rejectIncompleta = true;
  const r = await call({ action: 'homework_submit', id: HW, answers: [1, null, null, null] });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.status, 'rezolvata');
  assert.strictEqual(r.body.complete, false);
  const hw = db.ai_meditatii_homework[0];
  assert.strictEqual(hw.status, 'rezolvata');
  assert.strictEqual(hw.feedback.complete, false);
  assert.strictEqual(med.isHomeworkIncomplete(hw), true); // UI-ul o vede tot ca incompletă
});

// ═══ reluarea ═══════════════════════════════════════════════════════════════
test('homework_start: tema incompletă se reia cu răspunsurile salvate; cea completă pornește de la zero', async () => {
  await call({ action: 'homework_submit', id: HW, answers: [1, 0, null, null] });
  let r = await call({ action: 'homework_start', id: HW });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.resumed, true);
  assert.strictEqual(r.body.incomplete, true);
  assert.deepStrictEqual(r.body.answers, [1, 0, null, null]);
  assert.strictEqual(r.body.answered, 2); assert.strictEqual(r.body.total, 4);
  // întrebările trimise NU conțin răspunsul corect
  assert.ok(r.body.questions.every((q) => q.answer === undefined && q.explanation === undefined));

  // elevul continuă și termină → tema devine FINALIZATĂ (ultima încercare contează)
  r = await call({ action: 'homework_submit', id: HW, answers: [1, 1, '4', '3'] });
  assert.strictEqual(r.body.complete, true);
  assert.strictEqual(db.ai_meditatii_homework[0].status, 'rezolvata');
  assert.strictEqual(db.ai_meditatii_homework[0].attempts, 2);

  // o temă finalizată COMPLET se reia fără răspunsuri (încercare nouă)
  r = await call({ action: 'homework_start', id: HW });
  assert.strictEqual(r.body.resumed, false);
  assert.strictEqual(r.body.answers, null);
  assert.strictEqual(r.body.status, 'rezolvata');
});

test('homework_draft („Las-o pe mai târziu"): răspunsurile rămân, tema rămâne de rezolvat, reluarea le readuce', async () => {
  let r = await call({ action: 'homework_draft', id: HW, answers: [null, 1, ' 4 ', null] });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.answered, 2);
  const hw = db.ai_meditatii_homework[0];
  assert.strictEqual(hw.status, 'data');               // NU e finalizată
  assert.strictEqual(hw.attempts, 0);
  assert.deepStrictEqual(hw.payload.answers, [null, 1, ' 4 ', null]);
  assert.deepStrictEqual(hw.payload.questions, QUESTIONS); // întrebările nu se pierd
  r = await call({ action: 'homework_start', id: HW });
  assert.strictEqual(r.body.resumed, true);
  assert.deepStrictEqual(r.body.answers, [null, 1, ' 4 ', null]);
  // starea dashboardului: ciorna apare ca număr, fără conținut
  r = await call({ action: 'state' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const h = r.body.homework.find((x) => x.id === HW);
  assert.strictEqual(h.draftAnswered, 2);
  assert.strictEqual(h.draft, undefined);
  assert.strictEqual(r.body.pendingHomework, 1);
  assert.strictEqual(r.body.incompleteHomework, 0);
});

test('state: tema incompletă iese din „nefăcute", intră la incompleteHomework și în media temelor', async () => {
  await call({ action: 'homework_submit', id: HW, answers: [1, 1, null, null] }); // 2/4 corecte
  const r = await call({ action: 'state' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.pendingHomework, 0);
  assert.strictEqual(r.body.incompleteHomework, 1);
  assert.strictEqual(r.body.homework[0].incomplete, true);
  assert.ok(!r.body.briefing.suggestions.some((s) => s.kind === 'tema')); // nu mai e propusă ca „nefăcută"
  assert.ok(r.body.prediction && r.body.prediction.grade >= 1); // media temelor include scorul (2/4)
});

// ═══ temele DIN SITE (exerciții interactive) ════════════════════════════════
test('homework_finalize: tema din site închisă fără scor → incompletă; cu scor → rămâne rezolvată', async () => {
  db.ai_meditatii_homework.push({
    id: HW2, user_id: USER, kind: 'content', content_id: CONTENT, title: 'Test din site', chapter: 'c7-ecuatii', topic: 'Ecuații',
    status: 'data', payload: { url: `/exercitiu?id=${CONTENT}` }, score: null, max_score: null, attempts: 0, feedback: {},
    assigned_at: '2026-08-21T10:00:00.000Z', due_at: null, completed_at: null,
  });
  db.ai_notifications.push({ recipient_id: USER, dedupe_key: `med_hw:${HW2}`, read: false });
  // setul generat nu se finalizează pe această cale
  let r = await call({ action: 'homework_finalize', id: HW });
  assert.strictEqual(r.statusCode, 400);
  // fără scor → incompletă (fără notă), notificarea „temă nouă" se stinge
  r = await call({ action: 'homework_finalize', id: HW2 });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.complete, false);
  assert.strictEqual(r.body.status, 'incompleta');
  const hw = db.ai_meditatii_homework.find((h) => h.id === HW2);
  assert.strictEqual(hw.status, 'incompleta');
  assert.strictEqual(hw.feedback.complete, false);
  assert.strictEqual(hw.feedback.grade, null);
  assert.strictEqual(db.ai_notifications[0].read, true);
  // reluare: linkul cu temaId e același
  r = await call({ action: 'homework_start', id: HW2 });
  assert.strictEqual(r.body.kind, 'content');
  assert.ok(r.body.url.includes(`temaId=${HW2}`));
  assert.strictEqual(r.body.incomplete, true);
  // elevul reia și apasă „Corectează" → scorul o trece pe REZOLVATĂ (completă)
  r = await call({ action: 'homework_score', id: HW2, score: 70, maxScore: 100 });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(hw.status, 'rezolvata');
  assert.strictEqual(hw.feedback.complete, true);
  assert.strictEqual(hw.feedback.grade, 7);
  // acum „finalizează" nu mai schimbă nimic
  r = await call({ action: 'homework_finalize', id: HW2 });
  assert.strictEqual(r.body.complete, true);
  assert.strictEqual(r.body.grade, 7);
  assert.strictEqual(hw.status, 'rezolvata');
});

test('reconciliere: tema din site finalizată incomplet devine rezolvată dacă apare scor în progress', async () => {
  db.ai_meditatii_homework.push({
    id: HW2, user_id: USER, kind: 'content', content_id: CONTENT, title: 'Test din site', status: 'incompleta',
    payload: {}, score: null, max_score: null, attempts: 0, feedback: { complete: false, grade: null },
    assigned_at: '2026-08-21T10:00:00.000Z', completed_at: '2026-08-21T11:00:00.000Z',
  });
  db.progress.push({ user_id: USER, content_id: CONTENT, score: 45, max_score: 90, attempts: 1, completed_at: '2026-08-22T09:00:00.000Z' });
  await med.reconcileContentHomework(fakeSupabase(), USER);
  const hw = db.ai_meditatii_homework.find((h) => h.id === HW2);
  assert.strictEqual(hw.status, 'rezolvata');
  assert.strictEqual(hw.score, 45);
  assert.strictEqual(hw.feedback.grade, 5.5); // 1 + 9·0,5
});

// ═══ o temă neterminată nu blochează alte teme ══════════════════════════════
test('homework_assign: cu 2 teme nefăcute elevul primește totuși altă temă (la cerere)', async () => {
  db.ai_meditatii_homework.push({
    id: HW3, user_id: USER, kind: 'interactive', title: 'Temă · Fracții', status: 'data', payload: { questions: QUESTIONS },
    feedback: {}, assigned_at: '2026-08-21T10:00:00.000Z',
  });
  assert.strictEqual(db.ai_meditatii_homework.filter((h) => h.status === 'data').length, 2);
  const r = await call({ action: 'homework_assign' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.ok(r.body.assigned, 'tema trebuia dată, nu blocată: ' + JSON.stringify(r.body));
  assert.strictEqual(r.body.assigned.title, 'Test din site · Ecuații');
  assert.strictEqual(db.ai_meditatii_homework.filter((h) => h.status === 'data').length, 3);
});

test('cron: temele AUTOMATE rămân plafonate la 2 nefăcute (nu se adună zilnic la elevii inactivi)', async () => {
  db.ai_meditatii_homework.push({
    id: HW3, user_id: USER, kind: 'interactive', title: 'Temă · Fracții', status: 'data', payload: { questions: QUESTIONS },
    feedback: {}, assigned_at: '2026-08-21T10:00:00.000Z',
  });
  db.ai_meditatii_profile[0].last_study_date = '2026-01-05'; // inactiv de mult
  const r = res();
  await handler({ method: 'GET', headers: {}, query: { action: 'cron' } }, r);
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.homeworkAssigned, 0);
  assert.strictEqual(db.ai_meditatii_homework.filter((h) => h.status === 'data').length, 2);
  // cu o singură temă nefăcută, cronul dă temă
  db.ai_meditatii_homework = db.ai_meditatii_homework.filter((h) => h.id !== HW3);
  const r2 = res();
  await handler({ method: 'GET', headers: {}, query: { action: 'cron' } }, r2);
  assert.strictEqual(r2.body.homeworkAssigned, 1);
});

// ═══ raportul pentru mentori ════════════════════════════════════════════════
test('buildMentorReport: temele incomplete se numără separat și intră la recomandări', async () => {
  await call({ action: 'homework_submit', id: HW, answers: [1, null, null, null] });
  const report = await med.buildMentorReport(fakeSupabase(), USER);
  assert.strictEqual(report.homework.total, 1);
  assert.strictEqual(report.homework.done, 1);
  assert.strictEqual(report.homework.incomplete, 1);
  assert.strictEqual(report.homework.pending, 0);
  assert.strictEqual(report.homework.avgPercent, 25);
  assert.ok(report.recommendations.some((t) => /incomplet/i.test(t)));
});
