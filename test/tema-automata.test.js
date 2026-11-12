// =====================================================================
// test/tema-automata.test.js — cererea din 11 noiembrie 2026 (3):
// „Tot în contul de părinți, asistentul AI să facă doar asta: «crează o temă
// elevului», ceea ce creează automat o temă pt nivelul elevului, sau subiect de
// examen din cele din site, fără AI."
//
//   · alegerea (api/_lib/temaAutomata.js): întâi ce n-a lucrat, apoi sub 70%,
//     fără ce a primit deja; un subiect de examen nerezolvat; nivelul elevului;
//   · api/homework.js: auto_options / auto_create (părinte sau profesor, doar
//     pentru elevii lui; fără abonament → doar materialele gratuite); copilul
//     vede tema în „📌 Teme" (și dacă n-are profesor); părintele — „Temele date";
//   · asistentul părinților (pagina și widgetul) arată DOAR acest panou.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TA = require('../api/_lib/temaAutomata');

let fake = null;
const ai = require('../api/_lib/ai');
ai.admin = () => fake;
ai.authUser = async (req) => { const u = req.headers['x-user']; if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; } return u; };
const homework = require('../api/homework.js');

async function call(user, body) {
  const res = fakeRes();
  await homework({ method: 'POST', headers: { 'x-user': user }, body }, res);
  return res;
}

const clasa7 = (n, free = true) => ({ id: `c7-${n}`, title: `Clasa a VII-a · Exercițiul ${n}`, category: 'clasa-7', content_type: 'interactive', is_free: free, sort_order: n });
function seed({ premiumAna = false } = {}) {
  fake = createFakeSupabase({
    profiles: [
      { id: 'mama', role: 'parinte', full_name: 'Elena Popescu', subscription_status: null, is_admin: false },
      { id: 'prof', role: 'profesor', full_name: 'Ion Ionescu', subscription_status: null, is_admin: false },
      { id: 'ana', role: 'elev', full_name: 'Ana Popescu', subscription_status: premiumAna ? 'active' : null, is_admin: false },
      { id: 'dan', role: 'elev', full_name: 'Dan Rusu', subscription_status: null, is_admin: false },
    ],
    mentor_students: [{ mentor_id: 'mama', student_id: 'ana', mentor_role: 'parinte', group_id: null }],
    user_stats: [{ user_id: 'ana', mission_category: 'clasa-7', prep_exam: 'evaluare-nationala' }],
    content: [
      ...[1, 2, 3, 4, 5, 6, 7].map((n) => clasa7(n, n !== 4)),
      { id: 'en-1', title: 'EN · Test 1', category: 'evaluare-nationala', content_type: 'interactive', is_free: true, sort_order: 1 },
      { id: 'en-2', title: 'EN · Test 2', category: 'evaluare-nationala', content_type: 'interactive', is_free: true, sort_order: 2 },
      { id: 'en-bar', title: 'EN · Barem test 1', category: 'evaluare-nationala', subcategory: 'bareme', content_type: 'pdf', is_free: true, sort_order: 3 },
    ],
    progress: [
      { user_id: 'ana', content_id: 'c7-1', score: 9, max_score: 10, completed_at: '2026-11-01T10:00:00Z' },   // stăpânit
      { user_id: 'ana', content_id: 'c7-2', score: 3, max_score: 10, completed_at: '2026-11-02T10:00:00Z' },   // sub 70%
      { user_id: 'ana', content_id: 'en-1', score: 80, max_score: 100, completed_at: '2026-11-03T10:00:00Z' },
    ],
    homework: [], homework_items: [], homework_progress: [], ai_notifications: [],
  });
}

// ═══════════════════════════ 1) alegerea, fără AI ═══════════════════════════
test('alegeTema: întâi ce n-a lucrat niciodată, apoi sub 70%, fără ce a primit deja; la nevoie recapitulare', () => {
  const pool = [1, 2, 3, 4, 5, 6].map((n) => ({ id: `e${n}` }));
  const progres = new Map([['e1', 95], ['e2', 40], ['e4', 60]]);
  const ids = (xs) => xs.map((r) => r.id);
  assert.deepStrictEqual(ids(TA.alegeTema(pool, { progres, numar: 3 })), ['e3', 'e5', 'e6']);
  assert.deepStrictEqual(ids(TA.alegeTema(pool, { progres, numar: 5 })), ['e3', 'e5', 'e6', 'e2', 'e4']);
  assert.deepStrictEqual(ids(TA.alegeTema(pool, { progres, deja: new Set(['e3', 'e5']), numar: 3 })), ['e6', 'e2', 'e4']);
  // nu mai e nimic nou: recapitulare, cele mai slabe întâi — întâi ce n-a primit de curând
  const tot = TA.alegeTema(pool, { progres: new Map(pool.map((r, i) => [r.id, 90 - i])), numar: 2 });
  assert.deepStrictEqual(ids(tot), ['e6', 'e5']);
  assert.deepStrictEqual(ids(TA.alegeTema(pool, { progres: new Map(pool.map((r, i) => [r.id, 90 - i])), deja: new Set(['e6']), numar: 2 })), ['e5', 'e4']);
  assert.deepStrictEqual(TA.alegeTema([], { numar: 3 }), []);
  assert.strictEqual(TA.numarValid('8'), 8);
  assert.strictEqual(TA.numarValid(99), 5);
});

test('alegeSubiect, nivelul elevului și titlul temei', () => {
  const pool = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
  assert.strictEqual(TA.alegeSubiect(pool, { progres: new Map([['t1', 80]]) }).id, 't2');
  assert.strictEqual(TA.alegeSubiect(pool, { progres: new Map([['t1', 80], ['t2', 30], ['t3', 50]]) }).id, 't2', 'cel mai slab, sub 70%');
  assert.strictEqual(TA.alegeSubiect(pool, { progres: new Map([['t1', 80]]), deja: new Set(['t2', 't3']) }).id, 't2', 'tot nerezolvat, deși primit deja');
  assert.strictEqual(TA.alegeSubiect([], {}), null);
  assert.deepStrictEqual(TA.clasaSugerata({ misiune: 'clasa-6' }), { clasa: 'clasa-6', sursa: 'misiune' });
  assert.deepStrictEqual(TA.clasaSugerata({ categorii: ['clasa-7', 'clasa-8', 'clasa-7'] }), { clasa: 'clasa-7', sursa: 'rezultate' });
  assert.deepStrictEqual(TA.clasaSugerata({ categorii: ['evaluare-nationala'] }), { clasa: 'clasa-8', sursa: 'examen' });
  assert.deepStrictEqual(TA.clasaSugerata({}), { clasa: null, sursa: null });
  assert.strictEqual(TA.examenSugerat({ ales: 'bac-tehnologic', valide: ['bac-tehnologic'] }), 'bac-tehnologic');
  assert.strictEqual(TA.examenSugerat({ clasa: 'clasa-11', valide: [] }), 'bac-mate-info');
  assert.strictEqual(TA.examenSugerat({ clasa: 'clasa-7', valide: [] }), 'evaluare-nationala');
  assert.strictEqual(TA.titluTema('nivel', { clasaLabel: 'a VII-a', n: 5 }), 'Temă · Clasa a VII-a (5 exerciții)');
  assert.strictEqual(TA.titluTema('examen', { examLabel: 'Evaluarea Națională' }), 'Subiect de examen · Evaluarea Națională');
});

test('alegerea nu folosește niciun model AI', () => {
  const lib = read('api/_lib/temaAutomata.js');
  const hw = read('api/homework.js');
  const bloc = hw.slice(hw.indexOf('async function autoOptions'), hw.indexOf('// ─── ELEV: deschiderea unei teme'));
  for (const src of [lib, bloc]) assert.ok(!/chatJson|\.chat\(|openai|anthropic|claude|logUsage|enforceRateLimit/i.test(src), 'fără apeluri AI');
});

// ═══════════════════════════ 2) API ═══════════════════════════
test('auto_options: copiii părintelui, cu clasa (din Arenă) și examenul (din „Pregătește-mă")', async () => {
  seed();
  const r = await call('mama', { action: 'auto_options' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.students, [{ id: 'ana', name: 'Ana Popescu', premium: false, clasa: 'clasa-7', sursaClasa: 'misiune', examen: 'evaluare-nationala', examenAles: true }]);
  assert.strictEqual(r.body.clase.length, 8);
  assert.deepStrictEqual(r.body.examene.map((e) => e.id), ['evaluare-nationala', 'bac-mate-info', 'bac-stiinte', 'bac-tehnologic']);
  assert.strictEqual((await call('ana', { action: 'auto_options' })).statusCode, 403, 'elevii nu dau teme');
});

test('auto_create (nivel): exercițiile clasei — nelucrate, apoi sub 70%; fără abonament doar cele gratuite; copilul e anunțat', async () => {
  seed();
  const r = await call('mama', { action: 'auto_create', studentId: 'ana', fel: 'nivel', numar: 5, note: 'Până joi!' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.items.map((i) => i.id), ['c7-3', 'c7-5', 'c7-6', 'c7-7', 'c7-2'], 'c7-4 e premium; c7-1 e stăpânit');
  assert.strictEqual(r.body.title, 'Temă · Clasa a VII-a (5 exerciții)');
  const hw = fake.db.tables.homework[0];
  assert.deepStrictEqual([hw.teacher_id, hw.teacher_name, hw.student_id, hw.group_id, hw.note], ['mama', 'Elena Popescu', 'ana', null, 'Până joi!']);
  assert.strictEqual(fake.db.tables.homework_items.length, 5);
  assert.ok(fake.db.tables.homework_items.every((i) => i.source === 'site' && i.kind === 'interactive'));
  const n = fake.db.tables.ai_notifications.find((x) => x.recipient_id === 'ana');
  assert.strictEqual(n.title, 'Ai o temă nouă de la Elena Popescu (părinte)');
  assert.strictEqual(n.data.url, `/tema-elev?id=${hw.id}`);
});

test('auto_create (nivel): a doua temă nu repetă exercițiile primite de curând', async () => {
  seed();
  const r1 = await call('mama', { action: 'auto_create', studentId: 'ana', fel: 'nivel', numar: 3 });
  assert.deepStrictEqual(r1.body.items.map((i) => i.id), ['c7-3', 'c7-5', 'c7-6']);
  fake.db.tables.homework[0].created_at = new Date().toISOString();   // (în Postgres: now())
  const r2 = await call('mama', { action: 'auto_create', studentId: 'ana', fel: 'nivel', numar: 3 });
  assert.deepStrictEqual(r2.body.items.map((i) => i.id), ['c7-7', 'c7-2', 'c7-1'], 'nelucrat → sub 70% → recapitulare (nu aceleași exerciții)');
});

test('auto_create (nivel): cu abonament intră și cele premium; clasa aleasă de părinte are întâietate', async () => {
  seed({ premiumAna: true });
  const r = await call('mama', { action: 'auto_create', studentId: 'ana', fel: 'nivel', numar: 3 });
  assert.deepStrictEqual(r.body.items.map((i) => i.id), ['c7-3', 'c7-4', 'c7-5']);
  const r2 = await call('mama', { action: 'auto_create', studentId: 'ana', fel: 'nivel', clasa: 'clasa-5', numar: 3 });
  assert.strictEqual(r2.statusCode, 404, 'clasa a V-a n-are exerciții în date');
  assert.match(r2.body.error, /Nu am găsit exerciții interactive/);
});

test('auto_create (examen): un test din site, nerezolvat, fără bareme', async () => {
  seed();
  const r = await call('mama', { action: 'auto_create', studentId: 'ana', fel: 'examen', examen: 'evaluare-nationala' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual(r.body.items.map((i) => i.id), ['en-2']);
  assert.strictEqual(r.body.title, 'Subiect de examen · Evaluarea Națională');
});

test('auto_create: doar pentru copiii (elevii) lui; profesorul poate și el, la elevii lui', async () => {
  seed();
  let r = await call('mama', { action: 'auto_create', studentId: 'dan', fel: 'nivel' });
  assert.strictEqual(r.statusCode, 403);
  r = await call('ana', { action: 'auto_create', studentId: 'ana', fel: 'nivel' });
  assert.strictEqual(r.statusCode, 403);
  fake.db.tables.mentor_students.push({ mentor_id: 'prof', student_id: 'dan', mentor_role: 'profesor', group_id: null });
  r = await call('prof', { action: 'auto_create', studentId: 'dan', fel: 'nivel', clasa: 'clasa-7', numar: 3 });
  assert.strictEqual(r.statusCode, 200);
  assert.match(fake.db.tables.ai_notifications.find((x) => x.recipient_id === 'dan').title, /de la profesorul Ion Ionescu/);
});

test('copilul vede tema părintelui în „📌 Teme" (și fără profesor); părintele — „📝 Temele date", cu raportul', async () => {
  seed();
  const c = await call('mama', { action: 'auto_create', studentId: 'ana', fel: 'nivel', numar: 3 });
  let r = await call('ana', { action: 'student_list' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.hasTeacher, true, 'tabul „Teme" apare');
  assert.strictEqual(r.body.pending.length, 1);
  assert.deepStrictEqual([r.body.pending[0].id, r.body.pending[0].fromParent, r.body.pending[0].teacher], [c.body.id, true, 'Elena Popescu']);
  r = await call('dan', { action: 'student_list' });
  assert.deepStrictEqual([r.body.pending.length, r.body.hasTeacher], [0, false], 'alt elev nu vede tema');
  r = await call('mama', { action: 'mine' });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(r.body.homework[0].id, c.body.id);
  r = await call('mama', { action: 'report', id: c.body.id });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual(r.body.rows.map((x) => x.studentId), ['ana']);
  r = await call('ana', { action: 'open', id: c.body.id });
  assert.strictEqual(r.statusCode, 200, 'copilul o deschide');
  // butonul „Dă temă" (bifat de mână) rămâne al profesorilor
  r = await call('mama', { action: 'create', studentId: 'ana', items: [{ source: 'site', refId: 'c7-1' }] });
  assert.strictEqual(r.statusCode, 403);
});

// ═══════════════════════════ 3) asistentul părinților ═══════════════════════════
test('asistentul părinților (pagina /profesor-virtual și widgetul): doar „📝 Creează o temă elevului"', () => {
  const pv = read('src/pages/ProfesorVirtual.jsx');
  const i = pv.indexOf('if (isParent && !isTeacher) {');
  assert.ok(i > 0);
  const bloc = pv.slice(i, pv.indexOf('const TABS = isStudentView', i));
  assert.match(bloc, /<TemaAutomata \/>/);
  assert.ok(!/ChatPanel|ExamGenerator|InteractiveTab|LibraryTab|AIPoweredBy/.test(bloc), 'fără chat, generatoare sau bibliotecă');
  const w = read('src/components/AITutor.jsx');
  assert.match(w, /const TemaAutomata = lazy\(\(\) => import\('\.\/TemaAutomata'\)\);/);
  assert.match(w, /\{isParent && !isTeacher \? \(\s*\n\s*<div[^>]*>\s*\n\s*<Suspense[\s\S]{0,200}?<TemaAutomata compact onNavigate=\{\(\) => setOpen\(false\)\} \/>/);
  assert.match(w, /\{!medMode && isTeacher && \(\s*\n\s*<div style=\{\{ display: 'flex', borderBottom/, 'tab-urile chat / subiect: doar la profesori');
  // „Pregătește-mă" / „Meditații live" din widget: doar la elevi și vizitatori (11 nov. 2026, seara)
  assert.match(w, /\{!medMode && !isMentorAcc && pathname !== '\/pregateste-ma' && \(/);
  // meniul: „Asistent AI pentru părinți" rămâne (/profesor-virtual)
  assert.match(read('src/lib/meniu.js'), /\{ tip: 'link', to: '\/profesor-virtual', icon: 'einstein', label: aiLabel \}/);
  assert.strictEqual(require('node:vm').runInNewContext(`(${read('src/lib/aiLabel.js').replace(/export /g, '').match(/function aiAssistantLabel[\s\S]*?\n\}/)[0]})({ isParent: true })`), 'Asistent AI pentru părinți');
  const panou = read('src/components/TemaAutomata.jsx');
  assert.match(panou, /aiClient\.homeworkAuto\(\{/);
  assert.match(panou, /🧩 Temă pe nivelul lui/);
  assert.match(panou, /📄 Subiect de examen/);
  assert.match(panou, /fără AI/);
});
