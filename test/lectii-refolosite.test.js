// Teste pentru BIBLIOTECA DE LECȚII din „Planul meu" (api/_lib/lectii.js +
// api/ai-meditatii.js → lesson / lesson_simplify): teoria unui capitol se scrie
// O DATĂ pentru aceeași clasă (sau același examen) × nivel × stil și se servește
// apoi fără model (cost 0), iar greșeala frecventă a elevului se adaugă în cod.
// Fără rețea: modelul, RAG-ul și limitele sunt stub-uite.
const test = require('node:test');
const assert = require('node:assert');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');
const med = require('../api/_lib/meditatii');
const lectii = require('../api/_lib/lectii');

const U = { ana: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ion: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', eva: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
const CH = { id: 'c7-ecuatii', title: 'Ecuații și sisteme de ecuații liniare', topics: ['ecuația de gradul I cu o necunoscută'], status: 'de_parcurs' };
const LESSON = `## Pe scurt
[[SPUNE: Azi învățăm ecuațiile.]]
O ecuație este o egalitate cu o necunoscută. Le folosim zilnic: prețuri, distanțe, timp.
## Noțiunile esențiale
1. Necunoscuta este litera $x$. 2. A rezolva înseamnă a afla valoarea lui $x$ care face egalitatea adevărată.
3. Putem aduna sau scădea același număr în ambii membri. 4. Putem împărți la un număr nenul.
[[COMPLETARE:{"q":"Cât este $x$ dacă $x+2=5$?","a":"3","e":"$x=5-2$"}]]
## Formulele de ținut minte
- $ax+b=0 \\Rightarrow x=-\\frac{b}{a}$, $a \\neq 0$ — forma generală.
- $x+a=b \\Rightarrow x=b-a$ — trecem termenul în celălalt membru.
## Exemplu rezolvat
$2x+3=11$ ⇒ $2x=8$ ⇒ $x=4$. Verificare: $2\\cdot4+3=11$ adevărat.
[[GRILA:{"q":"$3x=12$, deci $x=$","o":["3","4","9","36"],"a":"b","e":"$12:3=4$"}]]
## Schema capitolului
- Ecuații → gradul I → forma $ax+b=0$ → soluția $x=-b/a$`;

let fake;
const calls = { chat: [], rate: 0, usage: [] };
let degraded = false;
let budgetOut = false;
let reply = LESSON;

function profileRow(userId, over = {}) {
  return {
    user_id: userId, grade: 7, exam_target: null, level: 'mediu', assessment: {}, memory: {}, focus: null,
    plan: { chapters: [{ ...CH }] }, streak_days: 0, total_seconds: 0, ...over,
  };
}
function setup({ profiles = null, noTable = false } = {}) {
  fake = createFakeSupabase({
    ai_meditatii_profile: profiles || [profileRow(U.ana), profileRow(U.ion), profileRow(U.eva)],
    ai_meditatii_sessions: [],
    app_settings: [],
  });
  if (noTable) fake.db.failTables.add('app_settings');
  calls.chat = []; calls.rate = 0; calls.usage = [];
  degraded = false; budgetOut = false; reply = LESSON;
}

ai.applyCors = () => {};
ai.admin = () => fake;
ai.authUser = async (req) => req.headers['x-user'];
ai.requireUser = async (supa, id) => ({ id, is_admin: false, subscription_status: 'active' });
ai.enforceRateLimit = async () => {
  calls.rate++;
  if (budgetOut) { const e = new Error('Creditele AI ale lunii s-au terminat.'); e.status = 429; e.code = 'BUDGET_MONTH'; throw e; }
  return { degraded };
};
ai.retrieve = async () => [];
ai.logUsage = async (supa, userId, endpoint) => { calls.usage.push(endpoint); };
ai.chat = async (args) => { calls.chat.push(args); return { text: reply, usage: { in: 100, out: 900, model: args.model } }; };
med.siteTheoryFor = async () => [];

const handler = require('../api/ai-meditatii');
async function call(user, body) {
  const res = fakeRes();
  await handler({ method: 'POST', headers: { 'x-user': user }, query: {}, body }, res);
  return res;
}
const lib = () => fake.db.tables.app_settings || [];
const profileOf = (id) => fake.db.tables.ai_meditatii_profile.find((p) => p.user_id === id);

test('lecția se scrie o dată pe clasă × nivel; al doilea elev o primește din bibliotecă, fără model', async () => {
  setup();
  const a = await call(U.ana, { action: 'lesson', chapterId: CH.id });
  assert.strictEqual(a.statusCode, 200, JSON.stringify(a.body));
  assert.strictEqual(calls.chat.length, 1);
  assert.strictEqual(calls.chat[0].model, ai.GEN_MODEL);
  assert.match(calls.chat[0].system, /pentru un elev de clasa a 7-a\./);
  assert.strictEqual(lib().length, 1);
  assert.match(lib()[0].key, /^lectie:v1:c7-ecuatii:clasa-7:mediu:[0-9a-f]{12}$/);
  assert.strictEqual(lib()[0].value.text, LESSON);

  const b = await call(U.ion, { action: 'lesson', chapterId: CH.id });
  assert.strictEqual(b.statusCode, 200, JSON.stringify(b.body));
  assert.strictEqual(calls.chat.length, 1, 'al doilea elev nu mai cheamă modelul');
  assert.strictEqual(calls.rate, 1, 'nici limitele AI (lecția nu costă nimic)');
  assert.strictEqual(b.body.lesson, a.body.lesson);
  assert.deepStrictEqual(calls.usage, ['ai-meditatii:lesson', 'ai-meditatii:lesson-lib']);
  // restul fluxului rămâne: capitolul trece la „teorie", sesiunea „lectie" se notează
  assert.strictEqual(profileOf(U.ion).plan.chapters[0].status, 'teorie');
  const sess = fake.db.tables.ai_meditatii_sessions.filter((s) => s.user_id === U.ion && s.kind === 'lectie');
  assert.strictEqual(sess.length, 1);
  assert.strictEqual(sess[0].payload.library, true);
});

test('alt nivel sau alt stil → altă lecție; examenul (EN) se împarte între clase', async () => {
  setup({
    profiles: [
      profileRow(U.ana, { exam_target: 'evaluare-nationala', grade: 8 }),
      profileRow(U.ion, { exam_target: 'evaluare-nationala', grade: 7 }),
      profileRow(U.eva, { exam_target: 'evaluare-nationala', grade: 8, level: 'avansat' }),
    ],
  });
  await call(U.ana, { action: 'lesson', chapterId: CH.id });
  await call(U.ion, { action: 'lesson', chapterId: CH.id });
  assert.strictEqual(calls.chat.length, 1, 'EN: aceeași lecție în clasa a 7-a și a 8-a');
  assert.match(calls.chat[0].system, /pentru un elev care se pregătește pentru Evaluarea Națională\./);
  await call(U.eva, { action: 'lesson', chapterId: CH.id });
  assert.strictEqual(calls.chat.length, 2, 'nivelul avansat are lecția lui');
  // stilul ales intră în prompt și în cheie
  profileOf(U.ion).memory = { styles: { preferred: 'prin exemple din viața reală' } };
  await call(U.ion, { action: 'lesson', chapterId: CH.id });
  assert.strictEqual(calls.chat.length, 3);
  assert.match(calls.chat[2].system, /stilul de explicație care funcționează cel mai bine: prin exemple din viața reală/);
  assert.strictEqual(new Set(lib().map((r) => r.key)).size, 3);
  assert.ok(lib().every((r) => r.key.includes(':en:')));
});

test('greșeala frecventă a elevului: o frază spusă de Prof. Tudor, adăugată în cod (biblioteca rămâne curată)', async () => {
  setup();
  await call(U.ana, { action: 'lesson', chapterId: CH.id });
  profileOf(U.ion).memory = { errorTypes: { calcul: 3, formula: 1 } };
  const b = await call(U.ion, { action: 'lesson', chapterId: CH.id });
  assert.strictEqual(calls.chat.length, 1);
  assert.match(b.body.lesson, /## Exemplu rezolvat\n\[\[SPUNE: La tine, cele mai multe greșeli apar la calcule/);
  assert.strictEqual(lib()[0].value.text, LESSON, 'în bibliotecă rămâne lecția fără personalizare');
  // fără greșeli repetate (o singură dată) → lecția exact ca în bibliotecă
  assert.strictEqual(lectii.personalize(LESSON, { memory: { errorTypes: { calcul: 1 } } }), LESSON);
  assert.match(lectii.personalize(LESSON, { memory: { errorTypes: { formula: 2 } } }), /## Formulele de ținut minte\n\[\[SPUNE: Fii atent aici: la formule/);
  // greșelile nu mai intră în promptul lecției (ar fi făcut-o unică pe elev)
  assert.doesNotMatch(calls.chat[0].system, /greșeli frecvente/);
});

test('în bibliotecă nu intră lecția modelului de rezervă și nici o lecție incompletă', async () => {
  setup();
  degraded = true;                       // peste bugetul zilnic → modelul standard
  await call(U.ana, { action: 'lesson', chapterId: CH.id });
  assert.notStrictEqual(calls.chat[0].model, ai.GEN_MODEL);
  assert.strictEqual(lib().length, 0);
  degraded = false;
  reply = '## Pe scurt\nDoar un început de lecție, tăiat.';
  await call(U.ana, { action: 'lesson', chapterId: CH.id });
  assert.strictEqual(lib().length, 0);
  reply = LESSON;
  await call(U.ana, { action: 'lesson', chapterId: CH.id });
  assert.strictEqual(lib().length, 1);
  assert.strictEqual(calls.chat.length, 3);
});

test('creditele lunii epuizate: lecția din bibliotecă merge; una nouă nu se generează', async () => {
  setup();
  await call(U.ana, { action: 'lesson', chapterId: CH.id });
  budgetOut = true;
  const b = await call(U.ion, { action: 'lesson', chapterId: CH.id });
  assert.strictEqual(b.statusCode, 200);
  assert.strictEqual(b.body.lesson, LESSON);
  profileOf(U.eva).level = 'avansat';
  const c = await call(U.eva, { action: 'lesson', chapterId: CH.id });
  assert.strictEqual(c.statusCode, 429);
  assert.strictEqual(c.body.code, 'BUDGET_MONTH');
});

test('fără tabela de setări (SQL nerulat) sau cu biblioteca oprită → lecția se generează, ca înainte', async () => {
  setup({ noTable: true });
  const a = await call(U.ana, { action: 'lesson', chapterId: CH.id });
  const b = await call(U.ion, { action: 'lesson', chapterId: CH.id });
  assert.strictEqual(a.statusCode, 200);
  assert.strictEqual(b.statusCode, 200);
  assert.strictEqual(calls.chat.length, 2);

  setup();
  process.env.PLAN_LECTII_REFOLOSITE = '0';
  try {
    await call(U.ana, { action: 'lesson', chapterId: CH.id });
    await call(U.ion, { action: 'lesson', chapterId: CH.id });
    assert.strictEqual(calls.chat.length, 2);
    assert.strictEqual(lib().length, 0);
  } finally { delete process.env.PLAN_LECTII_REFOLOSITE; }
  // o versiune nouă a bibliotecii → lecțiile se scriu din nou
  setup();
  await call(U.ana, { action: 'lesson', chapterId: CH.id });
  process.env.PLAN_LECTII_VERSIUNE = '2';
  try {
    await call(U.ion, { action: 'lesson', chapterId: CH.id });
    assert.strictEqual(calls.chat.length, 2);
    assert.ok(lib().some((r) => r.key.startsWith('lectie:v2:')));
  } finally { delete process.env.PLAN_LECTII_VERSIUNE; }
});

test('„Nu am înțeles": reexplicarea unei etape din bibliotecă se scrie o dată pe încercare', async () => {
  setup();
  await call(U.ana, { action: 'lesson', chapterId: CH.id });
  const ask = (user, over = {}) => call(user, {
    action: 'lesson_simplify', chapterId: CH.id, chapterTitle: CH.title,
    stageTitle: 'Formulele de ținut minte', stageText: '- $ax+b=0 \\Rightarrow x=-\\frac{b}{a}$', attempt: 1, ...over,
  });
  reply = '## Hai să o luăm altfel\n1. Mutăm $b$ în dreapta.\n2. Împărțim la $a$.\nDeci, pe scurt: $x=-b/a$.\n[[COMPLETARE:{"q":"$2x-4=0$, $x=$","a":"2","e":"$x=4:2$"}]]';
  const a = await ask(U.ana);
  assert.strictEqual(a.statusCode, 200, JSON.stringify(a.body));
  assert.strictEqual(calls.chat.length, 2);
  assert.match(calls.chat[1].system, /^.*Un elev de clasa a 7-a ți-a spus „NU AM ÎNȚELES"/m);
  const b = await ask(U.ion);
  assert.strictEqual(calls.chat.length, 2, 'aceeași etapă, aceeași încercare → din bibliotecă');
  assert.strictEqual(b.body.text, a.body.text);
  assert.ok(calls.usage.includes('ai-meditatii:lesson_simplify-lib'));
  // contorul de etape „grele" se ține și când reexplicarea vine din bibliotecă
  assert.strictEqual(profileOf(U.ion).memory.stageFeedback[CH.id].hard, 1);
  // a doua încercare (alt unghi) se scrie separat
  await ask(U.ion, { attempt: 2 });
  assert.strictEqual(calls.chat.length, 3);
  // un text trimis altfel (alt titlu de capitol) nu primește reexplicarea altuia
  await ask(U.eva, { chapterTitle: 'Alt titlu' });
  assert.strictEqual(calls.chat.length, 4);
});

test('reexplicarea unei lecții care nu e în bibliotecă nu se păstrează', async () => {
  setup();
  degraded = true;
  await call(U.ana, { action: 'lesson', chapterId: CH.id });   // lecția modelului de rezervă — nu intră în bibliotecă
  degraded = false;
  reply = '## Hai să o luăm altfel\n1. Pas unu, explicat simplu și pe larg.\n2. Pas doi.\nDeci, pe scurt: așa se face.';
  await call(U.ana, { action: 'lesson_simplify', chapterId: CH.id, chapterTitle: CH.title, stageTitle: 'Pe scurt', stageText: 'text unic', attempt: 1 });
  assert.ok(!lib().some((r) => r.key.startsWith('reexplicare:')));
});
