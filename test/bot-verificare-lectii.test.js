// Teste pentru cererea din 26 oct. 2026 (punctul 2): „fă un bot care să verifice dacă o lecție
// generată are sunet, întrebări pentru exerciții".
//   · raportul (api/_lib/lessonCheck.js): sunetul fiecărei fraze (fișierul chiar e în Storage,
//     nu e gol), întrebările la fiecare exercițiu (grila pe ecran, fiecare subpunct de la
//     Subiectele II–III, întrebări valide), itemii, cronologia;
//   · fișierele „lipsă" se confirmă direct (HEAD 404) — o listă greșită nu pornește reparații;
//   · rularea: Admin („🔎 Verifică acum"), după fiecare pregătire, în cron (fără AI, fără cost);
//   · reparația automată (implicit doar „voce_refa"): refacerea DOAR frazelor cu fișierul pierdut,
//     nu cât o ședință de grup cu lecția e aproape, de cel mult 2 ori;
//   · raportul stă în live_lesson_qa (nu în live_lessons: o verificare nu schimbă lecția).
process.env.LIVE_TTS_PAUZA_MS = '0';
process.env.LIVE_DESENE = '0';
delete process.env.LIVE_BOT_REPARA;
delete process.env.LIVE_BOT_VERIFICARI;
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const L = require('../api/_lib/live');
const LL = require('../api/_lib/liveLesson');
const LC = require('../api/_lib/lessonCheck');
const tts = require('../api/_lib/tts');
const handler = require('../api/live');
const { qaRun, qaCron, qaStamp, qaFixArgs, resetCaches } = handler._internals;

const teacher = L.teacherById('radu');
const ADMIN = '33333333-3333-4333-8333-333333333333';
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const later = (min) => new Date(Date.now() + min * 60000).toISOString();
const seg = (say, board = [], ask = null) => (ask ? { say, board, ask } : { say, board });

// ─── lecțiile de test ────────────────────────────────────────────────────────
// Subiectul I (6 grile) + opțional o problemă de la Subiectul III cu subpunctele a), b)
function grila(n) {
  return {
    ref: `I.${n}`, title: `Subiectul I, exercițiul ${n}`, kind: 'grila', statement: `Rezultatul calculului $${n} + 3 \\cdot 4$ este:`,
    options: ['1', String(n + 12), '3', '4'], answer: 'b', points: 5, barem: 'b 5p',
    intro: [seg(`Exercițiul ${n}.`)], tryPoll: { type: 'grila', question: 'Care este rezultatul?', options: ['1', String(n + 12), '3', '4'], answer: 'b', explain: '' },
    afterTry: [seg('Să vedem răspunsul corect.')],
    modes: { barem: [seg(`Întâi înmulțirea, apoi adunarea: ${n + 12}.`, [`$${n} + 12 = ${n + 12}$`])], intuitiv: [seg('Înmulțirea leagă mai tare.')], greseli: [seg('Nu adunați întâi.')], alta_metoda: null },
    check: null, afterCheck: [],
  };
}
const ask = (question, answer) => ({ type: 'completare', question, options: null, answer, hint: 'Folosiți formula.', explain: 'Din barem.', say: 'Încercați voi și scrieți rezultatul pe ecran.' });
function problemaIII({ askB = true } = {}) {
  return {
    ref: 'III.1', title: 'Subiectul al III-lea, problema 1', kind: 'rezolvare',
    statement: 'Se consideră expresia $E(x) = (x+1)^2 - x(x+2)$, unde $x$ este număr real.\na) Calculați $E(2)$.\nb) Arătați că $E(x) = 1$ pentru orice număr real $x$.',
    statementTry: null, options: null, answer: '1', points: 5, barem: 'a) E(2) = 9 − 8 = 1 2p  b) (x+1)² = x² + 2x + 1 2p; E(x) = 1 1p',
    intro: [seg('Problema 1.')], tryPoll: null, afterTry: [],
    modes: {
      barem: [
        seg('La punctul a înlocuim x cu doi.', ['a) $E(2) = (2+1)^2 - 2 \\cdot (2+2)$']),
        seg('Deci E de doi este nouă minus opt, adică unu.', ['$E(2) = 9 - 8 = 1$ (2p)'], ask('Cât este $(2+1)^2$?', '9')),
        seg('La punctul b desfacem pătratul.', ['b) $(x+1)^2 = x^2 + 2x + 1$ (2p)'], askB ? ask('Desfaceți pătratul: $(x+1)^2 = \\;?$', 'x^2+2x+1') : null),
        seg('Apoi reducem termenii asemenea.', ['$E(x) = x^2 + 2x + 1 - x^2 - 2x = 1$ (1p)']),
      ],
      intuitiv: [seg('Verificați cu un număr.')], greseli: [seg('Atenție la semnul minus.')], alta_metoda: null,
    },
    check: null, afterCheck: [],
  };
}
function script({ withIII = false, askB = true, n = 6 } = {}) {
  const items = LL.normalizeItems(Array.from({ length: n }, (_, i) => grila(i + 1)), { section: 'I', exam: 'en', grile: { I: Object.fromEntries(Array.from({ length: n }, (_, i) => [i + 1, 'b'])) }, baremText: '' });
  if (withIII) items.push(...LL.normalizeItems([problemaIII({ askB })], { section: 'III', exam: 'en', baremText: '' }));
  return LL.assignIds({ title: 'EN test', exam: 'en', teacher: 'radu', teacherName: teacher.name, pasi: LL.PASI_V, v: 2, missing: [], ...LL.templates(teacher, { title: 'EN test', exam: 'en' }), items });
}
let serial = 0;
const uuid = (p) => `${p}-0000-4000-8000-${String(++serial).padStart(12, '0')}`;
const HOST = 'https://abcdefgh.supabase.co/storage/v1/object/public/live-media';
// lecția „gata", cu vocea tuturor frazelor (unless: fără voce; dur: durata)
function lesson({ status = 'gata', sc = script(), voiceless = () => false, dur = () => 2.5, ...rest } = {}) {
  const id = uuid('dddddddd');
  const audio = {};
  for (const s of LL.segmentsInOrder(sc)) if (!voiceless(s)) audio[s.id] = { url: `${HOST}/lessons/${id}/${s.id}.mp3`, dur: dur(s), lip: [[0, 0.2, 'A']] };
  return {
    id, subject_id: uuid('aaaaaaaa'), teacher: 'radu', version: 1, status, title: 'EN test', exam: 'en', script: sc,
    progress: { audio, total: LL.segmentsInOrder(sc).length, done: Object.keys(audio).length, phase: status === 'gata' ? 'gata' : 'voce' },
    error: null, cost_micro: 0, created_at: ago(900), updated_at: ago(30), locked_until: null, ...rest,
  };
}
const filesOf = (row) => new Set(Object.values(row.progress.audio).map((a) => LC.fileOfUrl(a.url)));
// Storage-ul (fals) cu fișierele vocii unei lecții, fără cele din `lost`
function putFiles(fake, row, lost = new Set()) {
  for (const [segId] of Object.entries(row.progress.audio)) if (!lost.has(segId)) fake.db.files.set(`live-media/lessons/${row.id}/${segId}.mp3`, Buffer.from('mp3'));
}
// HEAD pe adresa unui fișier: 200 dacă e în Storage-ul fals, altfel 404 (sau `code`)
function stubFetch(fake, { code = null } = {}) {
  const orig = global.fetch;
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push([opts.method || 'GET', url]);
    if (code != null) return { status: code };
    const key = String(url).replace(`${HOST}/`, 'live-media/');
    return { status: fake.db.files.has(key) ? 200 : 404 };
  };
  return { calls, restore: () => { global.fetch = orig; } };
}
// vocea înlocuită (fără rețea): fișierul ajunge în Storage-ul fals
function stubVoice(fake) {
  const orig = { provider: tts.provider, voiceSegment: tts.voiceSegment };
  const calls = [];
  tts.provider = () => 'openai';
  tts.voiceSegment = async (supa, { path: p }) => {
    calls.push(p);
    fake.db.files.set(`live-media/${p}.mp3`, Buffer.from('mp3'));
    return { url: `${HOST}/${p}.mp3`, dur: 2, lip: [[0, 0.2, 'A']], provider: 'openai', cost: 10 };
  };
  return { calls, restore: () => Object.assign(tts, orig) };
}
const codes = (rep) => rep.issues.map((i) => i.code);
// o voce configurată (altfel raportul spune, pe bună dreptate, „fără voce configurată")
function withTts() {
  const orig = tts.provider;
  tts.provider = () => 'openai';
  return { restore: () => { tts.provider = orig; } };
}

// ─── 1. Raportul (deterministic, fără AI) ────────────────────────────────────
test('lecția completă: sunet 100%, fiecare exercițiu cu întrebare → ✓, scor 100', () => {
  const row = lesson({ sc: script({ withIII: true }) });
  const rep = LC.checkLesson(row, { files: filesOf(row), ttsOn: true });
  assert.deepStrictEqual(rep.issues, [], JSON.stringify(rep.issues));
  assert.strictEqual(rep.ok, true);
  assert.strictEqual(rep.score, 100);
  assert.strictEqual(rep.sound.mode, 'generat');
  assert.strictEqual(rep.sound.pct, 100);
  assert.strictEqual(rep.sound.filesChecked, true);
  assert.strictEqual(rep.questions.items, 7);
  assert.strictEqual(rep.questions.withQuestion, 7, 'toate exercițiile au întrebări');
  assert.strictEqual(rep.questions.tries, 6, 'grilele: întrebarea pe ecran');
  assert.ok(rep.questions.steps >= 2, 'problema: o întrebare la a) și una la b)');
  assert.ok(rep.summary.startsWith('✓ sunet 100%'), rep.summary);
  assert.match(rep.summary, /întrebări la 7\/7 exerciții/);
  assert.strictEqual(rep.v, LC.QA_V);
});

test('sunetul: lecția fără voce generată, fișierele pierdute din Storage, sunetul gol, vocea încă în lucru, fără voce configurată', () => {
  // fără nicio voce (lecție „gata" cu vocea browserului)
  const mute = lesson({ voiceless: () => true });
  let rep = LC.checkLesson(mute, { files: new Set(), ttsOn: true });
  assert.ok(codes(rep).includes('fara_voce'));
  assert.strictEqual(rep.issues.find((i) => i.code === 'fara_voce').level, 'grav');
  assert.deepStrictEqual(rep.fixes, ['voce']);
  assert.strictEqual(rep.ok, false);
  assert.strictEqual(rep.sound.mode, 'browser');
  assert.match(rep.summary, /^⚠ fără voce generată/);
  // fișierele a trei fraze lipsesc din Storage
  const row = lesson();
  const lost = Object.keys(row.progress.audio).slice(3, 6);
  const files = filesOf(row);
  for (const id of lost) files.delete(`${id}.mp3`);
  rep = LC.checkLesson(row, { files, ttsOn: true });
  const fl = rep.issues.find((i) => i.code === 'fisiere_lipsa');
  assert.ok(fl && fl.level === 'grav' && fl.fix === 'voce_refa', JSON.stringify(rep.issues));
  assert.deepStrictEqual(rep.sound.brokenIds.sort(), lost.slice().sort(), 'exact frazele de refăcut');
  assert.strictEqual(rep.sound.lostFiles, 3);
  // aceleași fișiere, dar lista din Storage neconfirmată (files = null) → nu acuzăm nimic
  rep = LC.checkLesson(row, { files: null, ttsOn: true });
  assert.ok(!codes(rep).includes('fisiere_lipsa'));
  assert.strictEqual(rep.sound.filesChecked, false);
  // sunet gol (sub 0,15 s)
  const firstId = LL.segmentsInOrder(row.script)[0].id;
  const zero = lesson({ dur: (s) => (s.id === firstId ? 0 : 2.5) });
  rep = LC.checkLesson(zero, { files: filesOf(zero), ttsOn: true });
  assert.ok(codes(rep).includes('voce_goala'));
  assert.deepStrictEqual(rep.sound.brokenIds, [firstId]);
  // vocea încă se generează („audio"): informare, nu problemă
  let k = 0;
  const half = lesson({ status: 'audio', voiceless: () => (k++ % 2 === 1) });
  rep = LC.checkLesson(half, { files: filesOf(half), ttsOn: true });
  assert.ok(codes(rep).includes('voce_in_lucru'));
  assert.strictEqual(rep.ok, true, 'vocea în lucru nu e o lecție stricată');
  // aceeași voce parțială la o lecție „gata" → lipsește (major), cu reparația „voce"
  k = 0;
  const partial = lesson({ status: 'gata', voiceless: () => (k++ % 2 === 1) });
  rep = LC.checkLesson(partial, { files: filesOf(partial), ttsOn: true });
  assert.ok(codes(rep).includes('voce_partiala'));
  assert.ok(rep.fixes.includes('voce'));
  // nicio voce configurată (OPENAI_API_KEY / AZURE_SPEECH_KEY)
  rep = LC.checkLesson(mute, { files: null, ttsOn: false });
  assert.ok(codes(rep).includes('fara_tts'));
  assert.ok(!codes(rep).includes('fara_voce'), 'fără cheie, „fără voce" e chiar cauza de mai sus');
});

test('întrebările: exercițiul fără nicio întrebare, grila fără întrebarea pe ecran, subpunctul b) fără întrebare, întrebare invalidă', () => {
  // grila I.2 fără întrebarea de pe ecran (și fără altă întrebare)
  const sc = script({ withIII: true, askB: false });
  const g = sc.items.find((it) => it.ref === 'I.2');
  g.tryPoll = null;
  // grila I.3: variantele stricate (3 variante, litera lipsă)
  const g3 = sc.items.find((it) => it.ref === 'I.3');
  g3.tryPoll = { ...g3.tryPoll, options: ['1', '2', '3'], answer: '' };
  const row = lesson({ sc });
  const rep = LC.checkLesson(row, { files: filesOf(row), ttsOn: true });
  const by = (code) => rep.issues.filter((i) => i.code === code);
  assert.deepStrictEqual(by('fara_intrebare').map((i) => i.ref), ['I.2'], JSON.stringify(rep.issues));
  assert.strictEqual(by('fara_intrebare')[0].fix, 'regenereaza', 'grila se repară doar regenerând');
  assert.deepStrictEqual(by('pasi_lipsa').map((i) => [i.ref, i.fix]), [['III.1', 'pasi']]);
  assert.match(by('pasi_lipsa')[0].text, /subpunctele b\) n-au/);
  assert.deepStrictEqual(rep.questions.partsMissing, [{ ref: 'III.1', parts: ['b'] }]);
  assert.deepStrictEqual(LL.stepGapRefs(sc), ['III.1'], 'reparația „pasi" completează doar golurile');
  assert.deepStrictEqual(LL.stepGapRefs(script({ withIII: true })), []);
  const inv = by('intrebare_invalida');
  assert.strictEqual(inv.length, 1);
  assert.match(inv[0].text, /grila are 3 variante, nu 4/);
  assert.match(inv[0].text, /litera corectă lipsește/);
  assert.strictEqual(rep.questions.ok, false);
  assert.strictEqual(rep.ok, false);
  assert.ok(rep.fixes.includes('pasi') && rep.fixes.includes('regenereaza'));
  assert.match(rep.summary, /1 cu subpuncte fără întrebare/);
});

test('verificarea unei întrebări (pollProblems) și răspunsurile-text', () => {
  assert.deepStrictEqual(LC.pollProblems({ id: 'a', type: 'grila', question: 'Q?', options: ['1', '2', '3', '4'], answer: 'c' }), []);
  assert.deepStrictEqual(LC.pollProblems({ id: 'a', type: 'grila', question: 'Q?', options: ['1', '2', '2', '4'], answer: 'c' }), ['două variante sunt la fel']);
  assert.deepStrictEqual(LC.pollProblems({ id: 'a', type: 'completare', question: 'Q?', answer: '' }), ['răspunsul corect lipsește']);
  assert.deepStrictEqual(LC.pollProblems({ type: 'completare', question: '', answer: '3' }), ['fără id (nu apare în sală)', 'întrebarea e goală']);
  assert.deepStrictEqual(LC.pollProblems(null), ['lipsește']);
  assert.ok(LC.pollProblems({ id: 'a', type: 'completare', question: 'Q?', answer: 'x'.repeat(81) })[0].includes('prea lung'));
  assert.strictEqual(LC.wordyAnswer('triunghiul este isoscel'), true);
  assert.strictEqual(LC.wordyAnswer('\\frac{\\sqrt{3}}{2}'), false);
  assert.strictEqual(LC.wordyAnswer('x = 3'), false);
});

test('itemii: prea puțini, lipsă, lecția nescrisă / eșuată', () => {
  const few = lesson({ sc: script({ n: 2 }) });
  let rep = LC.checkLesson(few, { files: filesOf(few), ttsOn: true });
  assert.ok(codes(rep).includes('prea_putini_itemi'));
  const sc = script();
  sc.missing = ['I.5', 'I.6'];
  const gap = lesson({ sc });
  rep = LC.checkLesson(gap, { files: filesOf(gap), ttsOn: true });
  const m = rep.issues.find((i) => i.code === 'itemi_lipsa');
  assert.ok(m && m.fix === 'itemi' && /I\.5, I\.6/.test(m.text));
  assert.match(rep.summary, /lipsesc 2 itemi/);
  rep = LC.checkLesson({ id: 'x', status: 'nou', script: null, progress: {} });
  assert.deepStrictEqual([rep.ok, codes(rep)], [true, ['fara_script']], 'nescrisă încă: doar informare');
  rep = LC.checkLesson({ id: 'x', status: 'eroare', error: 'timeout', script: null, progress: {} });
  assert.deepStrictEqual([rep.ok, rep.fixes], [false, ['regenereaza']]);
});

// ─── 2. Fișierele din Storage, confirmate (HEAD) ──────────────────────────────
test('fișierele vocii: lipsa se confirmă direct (HEAD 404); o listă greșită (HEAD 200 / rețeaua) nu acuză nimic', async () => {
  const row = lesson();
  const fake = createFakeSupabase({ live_lessons: [row] });
  const lost = new Set(Object.keys(row.progress.audio).slice(0, 2));
  putFiles(fake, row, lost);
  const f404 = stubFetch(fake);
  try {
    const names = await LC.confirmFiles(fake, row);
    assert.ok(names instanceof Set);
    assert.strictEqual(names.size, Object.keys(row.progress.audio).length - 2);
    assert.strictEqual(f404.calls.length, 2, 'doar fișierele lipsă, cu HEAD');
    assert.ok(f404.calls.every(([m]) => m === 'HEAD'));
  } finally { f404.restore(); }
  // Storage-ul spune „lipsă", dar adresa răspunde (listă incompletă) → nu verificăm acum
  const f200 = stubFetch(fake, { code: 200 });
  try { assert.strictEqual(await LC.confirmFiles(fake, row), null); } finally { f200.restore(); }
  const fNet = stubFetch(fake, { code: 0 });
  try { assert.strictEqual(await LC.confirmFiles(fake, row), null); } finally { fNet.restore(); }
  // toate fișierele sunt → lista, fără nicio cerere HEAD
  putFiles(fake, row);
  const fAll = stubFetch(fake);
  try {
    assert.strictEqual((await LC.confirmFiles(fake, row)).size, Object.keys(row.progress.audio).length);
    assert.strictEqual(fAll.calls.length, 0);
  } finally { fAll.restore(); }
  assert.strictEqual(LC.fileOfUrl(`${HOST}/lessons/x/s-1.mp3?t=1`), 's-1.mp3');
});

// ─── 3. Rularea: Admin, după pregătire, cron ──────────────────────────────────
ai.authUser = async (req) => {
  const u = req.headers['x-user'];
  if (!u) { const e = new Error('Neautentificat.'); e.status = 401; throw e; }
  return u;
};
ai.logUsage = async () => {};
let fake = null;
ai.admin = () => fake;
async function call(action, body = {}, user = null) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: user ? { 'x-user': user } : {}, query: {}, body: { action, ...body } }, res);
  return res;
}
const profiles = () => [{ id: ADMIN, full_name: 'Radu Costea', email: 'radu@example.com', role: 'admin', is_admin: true }, { id: 'u-elev', full_name: 'Elev', email: 'e@example.com', role: 'elev', is_admin: false }];

test('Admin → „🤖 Botul de verificare": verifică o lecție / toate (paginat); raportul în live_lesson_qa, lecția neatinsă', async () => {
  resetCaches();
  const good = lesson();
  // subpunctul b) fără întrebare + fraze fără voce. (O grilă fără întrebare n-ar ajunge în raport:
  // loadLesson o reface — botul verifică lecția exact cum o primesc elevii.)
  const sc = script({ withIII: true, askB: false });
  sc.items[1].tryPoll = null;
  const bad = lesson({ sc, voiceless: (s) => s.id.endsWith('1') });
  fake = createFakeSupabase({ profiles: profiles(), live_lessons: [good, bad] });
  putFiles(fake, good); putFiles(fake, bad);
  const f = stubFetch(fake);
  const t = withTts();
  try {
    const denied = await call('admin_qa', {}, 'u-elev');
    assert.strictEqual(denied.statusCode, 403);
    const before = fake.db.tables.live_lessons.map((l) => l.updated_at);
    const one = await call('admin_qa', { lessonId: bad.id }, ADMIN);
    assert.strictEqual(one.statusCode, 200, JSON.stringify(one.body));
    assert.strictEqual(one.body.setup, true);
    assert.strictEqual(one.body.report.ok, false);
    assert.ok(codes(one.body.report).includes('pasi_lipsa'), JSON.stringify(codes(one.body.report)));
    assert.ok(!codes(one.body.report).includes('fara_intrebare'), 'grila și-a primit întrebarea înapoi (restoreGrilaTries)');
    assert.ok(codes(one.body.report).includes('voce_partiala'));
    assert.strictEqual(one.body.report.title, 'EN test');
    const saved = fake.db.tables.live_lesson_qa.find((r) => r.lesson_id === bad.id);
    assert.ok(saved && saved.ok === false && saved.score < 100 && saved.stamp === qaStamp(bad));
    assert.deepStrictEqual(fake.db.tables.live_lessons.map((l) => l.updated_at), before, 'verificarea nu schimbă lecția');
    // toate (cele mai noi versiuni), câte `limit`, cu pagina următoare
    const page1 = await call('admin_qa', { limit: 1 }, ADMIN);
    assert.strictEqual(page1.body.total, 2);
    assert.strictEqual(page1.body.reports.length, 1);
    assert.strictEqual(page1.body.next, 1);
    const page2 = await call('admin_qa', { limit: 1, after: 1 }, ADMIN);
    assert.strictEqual(page2.body.next, null);
    const okOne = [...page1.body.reports, ...page2.body.reports].find((r) => r.lessonId === good.id);
    assert.strictEqual(okOne.report.ok, true, JSON.stringify(okOne.report.issues));
    // doar rapoartele salvate (lista din Admin, fără verificare nouă)
    const list = await call('admin_qa', { list: true }, ADMIN);
    assert.deepStrictEqual(list.body.reports.map((r) => [r.lessonId, r.report?.ok]).sort(), [[bad.id, false], [good.id, true]].sort());
  } finally { f.restore(); t.restore(); }
});

test('fără tabela live_lesson_qa (SQL-ul nerulat): verificarea merge, doar raportul nu se salvează', async () => {
  resetCaches();
  const row = lesson();
  fake = createFakeSupabase({ profiles: profiles(), live_lessons: [row] });
  fake.db.failTables.add('live_lesson_qa');
  putFiles(fake, row);
  const f = stubFetch(fake);
  const t = withTts();
  try {
    const r = await call('admin_qa', { lessonId: row.id }, ADMIN);
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.report.ok, true);
    assert.strictEqual(r.body.setup, false, 'Admin arată: rulează supabase/notificari_lectii.sql');
    const c = await qaCron(fake, { max: 8 });
    assert.strictEqual(c.setup, false);
    assert.strictEqual(c.checked, 0);
  } finally { f.restore(); t.restore(); resetCaches(); }
});

test('cronul: verifică lecțiile neverificate (o dată; din nou doar dacă lecția se schimbă), câte LIVE_BOT_VERIFICARI', async () => {
  resetCaches();
  const a = lesson(), b = lesson(), c = lesson();
  fake = createFakeSupabase({ live_lessons: [a, b, c] });
  [a, b, c].forEach((r) => putFiles(fake, r));
  const f = stubFetch(fake);
  const t = withTts();
  try {
    let rep = await qaCron(fake, { max: 2 });
    assert.strictEqual(rep.checked, 2, 'câte max pe rulare');
    rep = await qaCron(fake, { max: 2 });
    assert.strictEqual(rep.checked, 1, 'restul, la rularea următoare');
    rep = await qaCron(fake, { max: 8 });
    assert.strictEqual(rep.checked, 0, 'nimic schimbat → nimic de verificat');
    assert.strictEqual(fake.db.tables.live_lesson_qa.length, 3);
    // lecția s-a schimbat (o frază și-a pierdut vocea, updated_at nou) → verificată din nou
    const row = fake.db.tables.live_lessons.find((l) => l.id === b.id);
    const first = Object.keys(row.progress.audio)[0];
    delete row.progress.audio[first];
    row.updated_at = new Date(Date.now() + 1000).toISOString();
    rep = await qaCron(fake, { max: 8 });
    assert.strictEqual(rep.checked, 1);
    const q = fake.db.tables.live_lesson_qa.find((r) => r.lesson_id === b.id);
    assert.strictEqual(q.ok, false);
    assert.ok(q.report.issues.some((i) => i.code === 'voce_partiala'));
    assert.strictEqual(rep.fixed.length, 0, '„voce" (vocea care n-a fost generată) nu se repară singur implicit');
    // LIVE_BOT_VERIFICARI=0 → cronul nu verifică nimic
    process.env.LIVE_BOT_VERIFICARI = '0';
    const full = await handler._internals.cron(fake);
    assert.strictEqual(full.qa.checked, 0);
  } finally { f.restore(); t.restore(); delete process.env.LIVE_BOT_VERIFICARI; }
});

test('reparația automată (voce_refa): refacerea DOAR frazelor cu fișierul pierdut; nu lângă o ședință de grup; de cel mult 2 ori', async () => {
  resetCaches();
  const row = lesson();
  const lost = new Set(Object.keys(row.progress.audio).slice(2, 5));
  fake = createFakeSupabase({ live_lessons: [row] });
  putFiles(fake, row, lost);
  const f = stubFetch(fake);
  const v = stubVoice(fake);
  try {
    // o ședință de grup cu lecția începe peste 20 de minute → nu acum
    fake.db.tables.live_sessions = [{ id: 'gggggggg-0000-4000-8000-000000000001', kind: 'grup', subject_id: row.subject_id, teacher: 'radu', status: 'programata', starts_at: later(20), ends_at: later(140), state: {} }];
    let rep = await qaCron(fake, { max: 8 });
    assert.strictEqual(rep.checked, 1);
    assert.deepStrictEqual(rep.fixed, [], 'ședința de grup e aproape');
    assert.strictEqual(v.calls.length, 0);
    const q0 = fake.db.tables.live_lesson_qa[0];
    assert.ok(q0.report.issues.some((i) => i.code === 'fisiere_lipsa' && i.fix === 'voce_refa'));
    // fără ședință → reparația
    fake.db.tables.live_sessions = [];
    rep = await qaCron(fake, { max: 8 });
    assert.deepStrictEqual(rep.fixed.map((x) => [x.lesson, x.fix, x.ok]), [[row.id, 'voce_refa', true]], JSON.stringify(rep));
    assert.deepStrictEqual(v.calls.map((p) => p.split('/').pop()).sort(), [...lost].sort(), 'doar cele 3 fraze');
    const saved = fake.db.tables.live_lessons.find((l) => l.id === row.id);
    assert.strictEqual(saved.status, 'gata', 'lecția rămâne gata (ședințele o pot folosi oricând)');
    assert.strictEqual(Object.keys(saved.progress.audio).length, Object.keys(row.progress.audio).length);
    const q1 = fake.db.tables.live_lesson_qa.find((r) => r.lesson_id === row.id);
    assert.strictEqual(q1.ok, true, JSON.stringify(q1.report.issues));
    assert.strictEqual(q1.report.tries.voce_refa.n, 1, 'încercarea rămâne notată');
    // LIVE_BOT_REPARA=0 → nicio reparație automată
    process.env.LIVE_BOT_REPARA = '0';
    fake.db.files.delete(`live-media/lessons/${row.id}/${[...lost][0]}.mp3`);
    q1.checked_at = ago(60 * 24 * 8);                              // raportul are peste o săptămână
    rep = await qaCron(fake, { max: 8 });
    assert.strictEqual(rep.checked, 1);
    assert.deepStrictEqual(rep.fixed, []);
    // înapoi la implicit: a doua încercare… dar abia după 6 ore de la prima
    delete process.env.LIVE_BOT_REPARA;
    rep = await qaCron(fake, { max: 8 });
    assert.deepStrictEqual(rep.fixed, [], 'prea curând după încercarea precedentă');
    const q2 = fake.db.tables.live_lesson_qa.find((r) => r.lesson_id === row.id);
    q2.report.tries.voce_refa = { n: 2, at: ago(60 * 24) };
    rep = await qaCron(fake, { max: 8 });
    assert.deepStrictEqual(rep.fixed, [], 'de cel mult 2 ori pe problemă');
  } finally { f.restore(); v.restore(); delete process.env.LIVE_BOT_REPARA; }
});

test('reparațiile din Admin („🔧 Repară"): ce argumente de pregătire primește fiecare problemă', () => {
  const rep = { sound: { brokenIds: ['s1', 's2'] } };
  assert.deepStrictEqual(qaFixArgs('voce_refa', rep), { voiceFix: 'refa', dropAudio: ['s1', 's2'] });
  assert.deepStrictEqual(qaFixArgs('voce', rep), { voiceFix: true, dropAudio: ['s1', 's2'] });
  assert.deepStrictEqual(qaFixArgs('pasi', rep), { stepsGaps: true, stepsAi: false });
  assert.deepStrictEqual(qaFixArgs('pasi', rep, { ai: true }), { stepsGaps: true, stepsAi: true });
  assert.deepStrictEqual(qaFixArgs('itemi', rep), { fill: true });
  assert.deepStrictEqual(qaFixArgs('figuri', rep), { forceFigures: true });
  assert.strictEqual(qaFixArgs('regenereaza', rep), null, '„Regenerează" rămâne manual');
  // amprenta: se schimbă la vocea nouă, la întrebările noi, la versiunea verificărilor
  const row = lesson();
  const s0 = qaStamp(row);
  const more = { ...row, progress: { ...row.progress, audio: { ...row.progress.audio, extra: { url: 'x', dur: 1 } } } };
  assert.notStrictEqual(qaStamp(more), s0);
  assert.strictEqual(qaStamp({ ...row }), s0);
});

test('panoul din Admin: botul, insignele din lista lecțiilor, butoanele de reparație', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'LiveQaBot.jsx'), 'utf8');
  for (const fix of ['voce_refa', 'voce', 'pasi', 'pasi_ai', 'itemi', 'figuri']) assert.ok(src.includes(`${fix}:`) || src.includes(`'${fix}'`), fix);
  assert.ok(/adminQa\(/.test(src));
  const admin = fs.readFileSync(path.join(__dirname, '..', 'src', 'components', 'LiveAdmin.jsx'), 'utf8');
  assert.ok(admin.includes('<LiveQaBot') && admin.includes('QaBadge'));
  const apiClient = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'live', 'api.js'), 'utf8');
  assert.ok(apiClient.includes("action: 'admin_qa'"));
});
