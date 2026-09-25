// =====================================================================
// test/tabla-prof-tudor.test.js — tabla cu Prof. Tudor („Planul meu")
//
// src/lib/tabla.js desparte ce SCRIE profesorul pe tablă (matematica) de ce
// SPUNE (subtitrare + voce: [[SPUNE: …]]) și de întrebările puse DIRECT PE
// TABLĂ ([[GRILA:{…}]] / [[COMPLETARE:{…}]]). Aici verificăm: marcajele nu
// ajung niciodată pe tablă (nici pe jumătate, în timpul streamingului),
// întrebările se citesc chiar dacă modelul a scris LaTeX cu un singur
// backslash în JSON, răspunsurile echivalente sunt primite, iar vorbirea
// transformă formulele în cuvinte românești.
// Modulul e ESM (frontend); Node 22+ îl importă direct.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');

let libPromise = null;
function load() {
  if (!libPromise) libPromise = import('../src/lib/tabla.js').catch(() => null); // Node vechi → skip
  return libPromise;
}

const LECTIE = `## Pe scurt
[[SPUNE: Azi învățăm ecuațiile de gradul I. Scriu pe tablă ideea de bază.]]
O **ecuație de gradul I** are forma $ax + b = 0$, cu $a \\neq 0$.
## Noțiunile esențiale
1. Putem aduna același număr în ambii membri.
2. Soluția este $x = -\\frac{b}{a}$.
[[GRILA:{"q":"Care ecuație este de gradul I?","o":["$x^2 = 4$","$3x - 6 = 0$","$\\frac{1}{x} = 2$","$0 \\cdot x = 5$"],"a":"b","e":"Doar $3x - 6 = 0$."}]]
## Exemplu rezolvat
Rezolvăm $5x - 7 = 3x + 9$: $2x = 16$, deci $x = 8$.
[[COMPLETARE:{"q":"Rezolvă $2x + 3 = 11$. Cât este $x$?","a":"4","e":"$2x = 8$, deci $x = 4$."}]]`;

test('tabla: pe tablă rămâne doar matematica — ce SPUNE și întrebările ies din text', async (t) => {
  const T = await load(); if (!T) return t.skip('Node fără import ESM');
  const s = T.splitBoard(LECTIE);
  assert.ok(!/\[\[/.test(s.board), 'niciun marcaj pe tablă');
  assert.ok(!s.board.includes('Azi învățăm'), 'ce spune nu se scrie');
  assert.ok(s.board.includes('ecuație de gradul I'));
  assert.deepStrictEqual(s.talk, ['Azi învățăm ecuațiile de gradul I. Scriu pe tablă ideea de bază.']);
  assert.strictEqual(s.questions.length, 2);
  assert.strictEqual(s.questions[0].type, 'grila');
  assert.strictEqual(s.questions[0].answer, 'b');
  assert.strictEqual(s.questions[0].options.length, 4);
  assert.strictEqual(s.questions[1].type, 'completare');
  assert.strictEqual(s.questions[1].answer, '4');
  // ordinea bucăților e păstrată (vorbirea le spune în ordinea din lecție)
  assert.deepStrictEqual(s.segments.map((x) => x.kind), ['board', 'say', 'board', 'q', 'board', 'q']);
});

test('tabla: LaTeX cu UN backslash în JSON (\\frac, \\neq, \\times) nu se strică', async (t) => {
  const T = await load(); if (!T) return t.skip('Node fără import ESM');
  // în JSON, „\f" = form-feed, „\n" = rând nou, „\t" = tab — fără reparație ar ieși „rac", „eq", „imes"
  const q = T.parseQuestion('GRILA', '{"q":"Cât este $\\frac{1}{2} \\times 4$ și $2 \\neq 3$?","o":["$1$","$2$","$\\sqrt{4}+1$","$0$"],"a":"b","e":"$\\frac{1}{2} \\cdot 4 = 2$"}');
  assert.ok(q, 'întrebarea se citește');
  assert.ok(q.q.includes('\\frac{1}{2}') && q.q.includes('\\times') && q.q.includes('\\neq'), q.q);
  assert.ok(q.options[2].includes('\\sqrt{4}'));
  assert.ok(q.explain.includes('\\cdot'));
  // backslash-urile deja dublate (JSON corect) rămân corecte
  const ok = T.parseQuestion('COMPLETARE', '{"q":"$\\\\sqrt{12}$ = ?","a":"2\\\\sqrt{3}","e":"ok"}');
  assert.strictEqual(ok.q, '$\\sqrt{12}$ = ?');
  assert.strictEqual(ok.answer, '2\\sqrt{3}');
});

test('tabla: răspunsul corect la grilă — literă, textul variantei sau numărul ei', async (t) => {
  const T = await load(); if (!T) return t.skip('Node fără import ESM');
  const o = '"o":["1","2","3","4"]';
  assert.strictEqual(T.parseQuestion('GRILA', `{"q":"x?",${o},"a":"C)"}`).answer, 'c');
  assert.strictEqual(T.parseQuestion('GRILA', `{"q":"x?",${o},"a":"2"}`).answer, 'b', 'textul variantei are prioritate');
  assert.strictEqual(T.parseQuestion('GRILA', '{"q":"x?","o":["$a$","$b$","$c$","$d$"],"a":3}').answer, 'c', 'numărul variantei, de la 1');
  assert.strictEqual(T.parseQuestion('GRILA', `{"q":"x?",${o},"a":"e"}`), null, 'litera trebuie să existe');
  assert.strictEqual(T.parseQuestion('GRILA', '{"q":"x?","o":["1"],"a":"a"}'), null, 'cel puțin două variante');
  assert.strictEqual(T.parseQuestion('COMPLETARE', '{"q":"","a":"4"}'), null, 'fără enunț, fără întrebare');
  // JSON neterminat (modelul a uitat acolada) — se repară
  assert.strictEqual(T.parseQuestion('COMPLETARE', '{"q":"x?","a":"4"').answer, '4');
});

test('tabla: marcajul început în timpul streamingului nu apare pe tablă', async (t) => {
  const T = await load(); if (!T) return t.skip('Node fără import ESM');
  assert.strictEqual(T.stripPartial('Deci $x = 4$.\n[[GRILA:{"q":"Cât e $x$'), 'Deci $x = 4$.\n');
  assert.strictEqual(T.stripPartial('Deci $x = 4$. [[SP'), 'Deci $x = 4$. ');
  assert.strictEqual(T.stripPartial('Deci [['), 'Deci ');
  assert.strictEqual(T.stripPartial('Intervalul [0, 1]'), 'Intervalul [0, 1]', 'parantezele matematice rămân');
  assert.strictEqual(T.stripPartial('x [[ALTCEVA'), 'x [[ALTCEVA', 'alte marcaje nu sunt ale tablei');
  // un marcaj întreg, în mijlocul textului, dispare; restul rămâne
  assert.strictEqual(T.boardTextOf('A\n[[SPUNE: bravo!]]\nB'), 'A\n\nB');
});

test('tabla: planul de vorbire — ordinea, ce se scrie și cât din tablă acoperă fiecare propoziție', async (t) => {
  const T = await load(); if (!T) return t.skip('Node fără import ESM');
  const plan = T.speechPlan(LECTIE);
  assert.ok(plan.length > 5);
  assert.strictEqual(plan[0].caption, 'Pe scurt');                 // titlul etapei
  assert.strictEqual(plan[1].board, false);                        // [[SPUNE]] — doar vorbit
  assert.ok(plan.every((it) => it.spoken && !/\$|\\|\[\[/.test(it.spoken)), 'în vorbire nu rămân $, \\ sau marcaje');
  const board = plan.filter((it) => it.board);
  assert.strictEqual(board[board.length - 1].boardEnd, 1, 'la final, tabla e scrisă toată');
  for (let i = 1; i < plan.length; i++) assert.ok(plan[i].boardEnd >= plan[i - 1].boardEnd, 'progresul tablei nu scade');
  assert.ok(!plan.some((it) => /Care ecuație/.test(it.caption)), 'întrebările le citește cardul lor, nu lecția');
  // fără tablă (doar ce spune)
  assert.ok(T.speechPlan(LECTIE, { readBoard: false }).every((it) => !it.board));
});

test('tabla: formulele se citesc în română, fără să strice cratimele din cuvinte', async (t) => {
  const T = await load(); if (!T) return t.skip('Node fără import ESM');
  assert.strictEqual(T.speakMath('$x^2 - 5x + 6 = 0$'), 'x la pătrat minus 5x plus 6 egal 0');
  assert.strictEqual(T.speakMath('$\\frac{3}{4} \\cdot 8 = 6$'), '3 supra 4 ori 8 egal 6');
  assert.strictEqual(T.speakMath('$\\sqrt{16} = 4$, iar $a \\neq 0$'), 'radical din 16 egal 4, iar a diferit de 0');
  assert.strictEqual(T.speakMath('Într-un triunghi s-a văzut că $a_1 = -3$ ✓'), 'Într-un triunghi s-a văzut că a 1 egal minus 3');
  assert.strictEqual(T.speakMath('**Atenție:** $8 : 2 = 4$'), 'Atenție: 8 împărțit la 2 egal 4');
  assert.strictEqual(T.speakMath('## Exemplu rezolvat'), 'Exemplu rezolvat');
});

test('tabla: verificarea răspunsului — echivalențe matematice la completare, litera la grilă', async (t) => {
  const T = await load(); if (!T) return t.skip('Node fără import ESM');
  const c = (answer) => ({ type: 'completare', answer });
  assert.ok(T.checkAnswer(c('1/2'), '0,5'));
  assert.ok(T.checkAnswer(c('4'), 'x = 4'));
  assert.ok(T.checkAnswer(c('2\\sqrt{3}'), '2√3'));
  assert.ok(T.checkAnswer(c('obtuz'), 'Obtuz'));
  assert.ok(!T.checkAnswer(c('4'), '5'));
  assert.ok(!T.checkAnswer(c('4'), ''));
  const g = { type: 'grila', answer: 'b', options: ['1', '2', '3', '4'] };
  assert.ok(T.checkAnswer(g, 'b') && T.checkAnswer(g, 'B'));
  assert.ok(!T.checkAnswer(g, 'a'));
  assert.strictEqual(T.answerText(g), 'b) 2');
  assert.strictEqual(T.answerText(c('4')), '$4$');
  assert.match(T.verdictSpeech(g, false), /Nu chiar\. Răspunsul corect este varianta b\./);
  assert.match(T.verdictSpeech(g, true), /^Corect, bravo!/);
});

test('tabla: PDF-ul lecției — fără ce se spune, cu întrebările ca „Verifică-te" (fără răspuns)', async (t) => {
  const T = await load(); if (!T) return t.skip('Node fără import ESM');
  const p = T.printTextOf(LECTIE);
  assert.ok(!p.includes('Azi învățăm') && !p.includes('[['));
  assert.ok(p.includes('Verifică-te:** Care ecuație este de gradul I?'));
  assert.ok(p.includes('b) $3x - 6 = 0$'));
  assert.ok(!/"a"\s*:/.test(p), 'răspunsul corect nu apare');
});

test('server: regulile tablei (chat) — numele profesorului și formatele pe care le citește tabla', async (t) => {
  const T = await load(); if (!T) return t.skip('Node fără import ESM');
  const ai = require('../api/_lib/ai');
  const rules = ai.meditatiiBoardRules();
  assert.match(rules, /Prof\. Tudor/);
  for (const m of ['[[SPUNE:', '[[GRILA:', '[[COMPLETARE:', '[[MEDITATII:']) assert.ok(rules.includes(m), m);
  // exemplele din instrucțiuni sunt exact formatul pe care clientul îl citește
  const ex = rules.match(/\[\[(GRILA|COMPLETARE):(\{.*?\})\]\]/g);
  assert.strictEqual(ex.length, 2);
  for (const e of ex) {
    const [, kind, json] = /\[\[(GRILA|COMPLETARE):(\{.*\})\]\]/.exec(e);
    assert.ok(T.parseQuestion(kind, json), `${kind} se citește`);
  }
  // numele se schimbă din env, ca în sala live
  process.env.LIVE_PROF_RADU_NUME = 'Prof. Andrei';
  try { assert.match(ai.meditatiiBoardRules(), /tu ești Prof\. Andrei/); }
  finally { delete process.env.LIVE_PROF_RADU_NUME; }
});

test('server: lecția și reexplicarea cer marcajele tablei (prompturile din ai-meditatii.js)', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'api', 'ai-meditatii.js'), 'utf8');
  const lesson = src.slice(src.indexOf('async function lesson('), src.indexOf('async function lessonSimplify('));
  assert.match(lesson, /LECȚIA SE ȚINE LA TABLĂ/);
  assert.match(lesson, /\[\[SPUNE: …\]\]/);
  assert.match(lesson, /\$\{BOARD_QUESTION_FORMAT\}/);
  const simplify = src.slice(src.indexOf('async function lessonSimplify('), src.indexOf('async function recordStageFeedback('));
  assert.match(simplify, /\$\{BOARD_QUESTION_FORMAT\}/);
  assert.match(simplify, /\[\[SPUNE: …\]\]/);
  // starea trimite numele profesorului de la tablă
  assert.match(src, /teacher: live\.publicTeacher\(/);
});
