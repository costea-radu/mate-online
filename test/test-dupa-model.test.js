// =====================================================================
// test/test-dupa-model.test.js — cererea din 30 octombrie 2026 (1):
//   „în contul de profesor la generare de teste PDF, pune opțiunea să genereze
//    fără spațiu de lucru, și un buton de încărcare un fișier de model pentru
//    generare: format, exerciții, nr. și dificultate să poată fi modificate."
//
//   · „✍️ Spațiu de lucru" pe foaie: cu (caroiajul de sub problemele de
//     redactat) sau FĂRĂ — src/lib/examPrint.js (`workSpace`), comutatorul
//     src/components/OptiuneSpatiuLucru.jsx în ExamGenerator + InteractiveGenForm;
//   · „📐 Test după model": structura testului-model citită de server
//     (api/_lib/modelTest.js, api/ai-generate-interactive.js → action 'model'),
//     editabilă (ModelTestPanel), apoi generarea DUPĂ ea.
// Logica pură se rulează direct; handlerul cu `ai` / Supabase simulate;
// componentele React se verifică pe sursă (nu rulează în Node).
// =====================================================================
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'sk-test';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ai = require('../api/_lib/ai');
const med = require('../api/_lib/meditatii');
const mt = require('../api/_lib/modelTest');
const { fakeRes } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

// examPrint.js importă fără extensie („./katex", ca în Vite) și randează KaTeX
// în browser → o copie temporară, cu cele două importuri înlocuite de stuburi.
let printP = null;
function examPrint() {
  if (printP) return printP;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exam-print-'));
  fs.writeFileSync(path.join(dir, 'katex.mjs'), 'export const autoMath = (s) => String(s);\n');
  fs.writeFileSync(path.join(dir, 'figureRender.mjs'), 'export const renderFigure = () => null;\n');
  const src = read('src/lib/examPrint.js')
    .replace("from './katex'", "from './katex.mjs'")
    .replace("from './figureRender'", "from './figureRender.mjs'");
  fs.writeFileSync(path.join(dir, 'examPrint.mjs'), src);
  printP = import(pathToFileURL(path.join(dir, 'examPrint.mjs')).href);
  return printP;
}

// un test „oficial" (cu puncte din oficiu): o grilă + o problemă cu subpuncte + una fără
const EXAM = {
  title: 'Test de verificare', durationMin: 50, totalPoints: 100, oficiu: 10,
  subjects: [{
    label: 'Test', points: 90, items: [
      { number: '1', statement: 'Cât face 2+3?', options: ['4', '5', '6', '7'], answer: 'b', points: 30 },
      { number: '2', statement: 'Fie x+1=4.', parts: [{ label: 'a', text: 'Aflați x.', points: 15 }, { label: 'b', text: 'Verificați.', points: 15 }], points: 30 },
      { number: '3', statement: 'Calculați aria unui pătrat cu latura 3.', answer: '9', solution: 'A = 3·3 = 9', points: 30 },
    ],
  }],
};

// ─── 1) Spațiul de lucru la tipărire ────────────────────────────────────────
test('PDF: implicit, problemele de redactat au caroiaj (spațiu de lucru), ca până acum', async () => {
  const P = await examPrint();
  const html = P.examBodyHtml(EXAM, { withSolutions: false });
  assert.ok((html.match(/class="solspace"/g) || []).length >= 3, 'caroiaj sub fiecare cerință / problemă de redactat');
  assert.match(html, /class="item written"/);
  assert.doesNotMatch(html, /foaie separată/);
});

test('PDF „fără spațiu de lucru": niciun caroiaj, testul rămâne întreg, elevul află unde scrie', async () => {
  const P = await examPrint();
  for (const html of [
    P.examBodyHtml(EXAM, { withSolutions: false, workSpace: false }),        // cerut la tipărire
    P.examBodyHtml({ ...EXAM, workSpace: false }, { withSolutions: false }), // păstrat în test
  ]) {
    assert.doesNotMatch(html, /class="solspace"/, 'fără caroiaj');
    assert.doesNotMatch(html, /item written/);
    for (const t of ['Cât face 2+3?', 'Fie x+1=4.', 'Aflați x.', 'Verificați.', 'Calculați aria']) assert.ok(html.includes(t), t);
    assert.match(html, /Rezolvările complete se scriu pe o foaie separată\./);
    assert.match(html, /<div class="pts">30p<\/div>/, 'punctajele rămân');
  }
  // alegerea explicită de la tipărire are întâietate față de cea din test
  assert.match(P.examBodyHtml({ ...EXAM, workSpace: false }, { workSpace: true }), /class="solspace"/);
  // baremul nu are oricum caroiaj și nici rândul despre foaie
  const barem = P.examBodyHtml({ ...EXAM, workSpace: false }, { withSolutions: true });
  assert.doesNotMatch(barem, /solspace|foaie separată/);
  assert.match(barem, /BAREM DE CORECTARE/);
  // test doar cu grile: fără spațiu de lucru nu e nimic de redactat → fără rândul despre foaie
  const grile = { ...EXAM, workSpace: false, subjects: [{ ...EXAM.subjects[0], items: [EXAM.subjects[0].items[0]] }] };
  assert.doesNotMatch(P.examBodyHtml(grile), /foaie separată/);
  assert.strictEqual(P.hasWorkSpace({}), true);
  assert.strictEqual(P.hasWorkSpace({ workSpace: false }), false);
  assert.strictEqual(P.hasWorkSpace({ workSpace: false }, true), true);
});

test('comutatorul „✍️ Spațiu de lucru" e la generarea testelor PDF (subiect de examen + teste/exerciții PDF)', () => {
  const opt = read('src/components/OptiuneSpatiuLucru.jsx');
  assert.match(opt, /Cu spațiu de lucru/);
  assert.match(opt, /Fără spațiu de lucru/);
  assert.match(opt, /aria-pressed=\{!cu\}/);

  const eg = read('src/components/ExamGenerator.jsx');
  assert.match(eg, /import OptiuneSpatiuLucru from '\.\/OptiuneSpatiuLucru';/);
  assert.match(eg, /const ex = workSpace \? res\.exam : \{ \.\.\.res\.exam, workSpace: false \};/, 'alegerea intră în test');
  assert.match(eg, /saveLibraryItem\(\{ kind: 'exam', title: ex\.title, category: examType, payload: \{ exam: ex \} \}\)/, 'și în „Testele mele"');
  assert.match(eg, /function alegeSpatiu\(v\)/);
  assert.match(eg, /updateLibraryItem\(savedId, \{ payload: \{ exam: ex \} \}\)/, 'schimbată după generare → copia din bibliotecă urmează');
  assert.match(eg, /<OptiuneSpatiuLucru value=\{exam\.workSpace !== false\} onChange=\{alegeSpatiu\}/);

  const form = read('src/components/InteractiveGenForm.jsx');
  assert.match(form, /const \[workSpace, setWorkSpace\] = useState\(init\.workSpace \?\? true\);/);
  assert.match(form, /showOutput && output === 'pdf' && \([\s\S]{0,700}<OptiuneSpatiuLucru value=\{workSpace\} onChange=\{setWorkSpace\}/);
  assert.match(form, /const quizMeta = \(\) => \(\{ durationMin, oficiu, \.\.\.\(workSpace \? \{\} : \{ workSpace: false \}\) \}\);/);

  const pv = read('src/pages/ProfesorVirtual.jsx');
  assert.match(pv, /title, durationMin, totalPoints: 100, oficiu, workSpace,/, 'exportul PDF o respectă');
  assert.match(pv, /if \(p\.meta\?\.workSpace === false\) setWorkSpace\(false\);/);
  assert.match(pv, /<OptiuneSpatiuLucru value=\{workSpace\} onChange=\{setWorkSpace\} compact/);
});

// ─── 2) Structura modelului (logica pură) ───────────────────────────────────
test('sanitizeModel: limite, tipuri și dificultăți normalizate; fără exerciții → fără model', () => {
  assert.strictEqual(mt.sanitizeModel(null), null);
  assert.strictEqual(mt.sanitizeModel({ exercises: [] }), null);
  assert.strictEqual(mt.sanitizeModel({ exercises: [{ topic: '', statement: '  ' }] }), null);
  const lung = 'x'.repeat(5000);
  const m = mt.sanitizeModel({
    title: '  Test   fracții  ', difficulty: 'Greu',
    exercises: [
      { type: 'grilă', topic: 'fracții', statement: lung, points: 250, difficulty: 'usor' },
      { type: 'orice', topic: 'ecuații', statement: 'Rezolvați 2x=4.', points: '10' },
      ...Array.from({ length: 40 }, (_, i) => ({ type: 'grila', topic: `t${i}` })),
    ],
  });
  assert.strictEqual(m.title, 'Test fracții');
  assert.strictEqual(m.difficulty, 'greu');
  assert.strictEqual(m.exercises.length, mt.MAX_EXERCITII, 'cel mult 24, cât duce generatorul');
  assert.strictEqual(m.exercises[0].type, 'grila');
  assert.strictEqual(m.exercises[0].statement.length, mt.MAX_ENUNT);
  assert.strictEqual(m.exercises[0].points, 100);
  assert.strictEqual(m.exercises[0].difficulty, 'ușor');
  assert.strictEqual(m.exercises[1].type, 'redactare', 'orice alt tip → redactare');
  assert.strictEqual(m.exercises[1].points, 10);
  assert.strictEqual(m.exercises[1].difficulty, 'greu', 'fără dificultate → cea de ansamblu');
});

test('modelFormat + modelBlock: ordinea, tipul și competența fiecărui exercițiu ajung în prompt', () => {
  const m = mt.sanitizeModel({ title: 'Model', exercises: [
    { type: 'grila', topic: 'fracții', statement: 'Cât face $\\frac{1}{2}+\\frac{1}{4}$?', points: 5, difficulty: 'ușor' },
    { type: 'redactare', topic: 'ecuații', statement: 'Rezolvați:\na) 2x=4\nb) x+1=3', difficulty: 'greu' },
  ] });
  assert.strictEqual(mt.modelFormat(m), 'mixt');
  assert.strictEqual(mt.modelFormat({ exercises: [{ type: 'grila' }, { type: 'grila' }] }), 'grila');
  assert.strictEqual(mt.modelFormat({ exercises: [{ type: 'redactare' }] }), 'redactare');
  const b = mt.modelBlock(m);
  assert.match(b, /TESTUL-MODEL AL PROFESORULUI/);
  assert.match(b, /EXACT 2 itemi, în ORDINEA de mai sus/);
  assert.match(b, /Exercițiul 1 — GRILĂ \(exact 4 variante, una corectă\) · ce verifică: fracții · dificultate: ușor · 5 p în model/);
  assert.match(b, /Exercițiul 2 — CU REDACTAREA RĂSPUNSULUI \(fără variante\) · ce verifică: ecuații · dificultate: greu/);
  assert.match(b, /Rezolvați: a\) 2x=4 b\) x\+1=3/, 'enunțul pe un rând, ca reper');
  assert.match(b, /NU copia enunțurile modelului/);
  assert.strictEqual(mt.modelBlock(null), '');
});

test('analyzeModel: un apel cu schemă strictă; rezultatul curățat; text prea scurt / fără exerciții → eroare clară', async () => {
  let cerere = null;
  const chatJson = async (o) => {
    cerere = o;
    return { data: { title: 'Lucrare — fracții', category: 'clasa-5', difficulty: 'mediu', durationMin: 45, oficiu: 10, exercises: [
      { type: 'grila', topic: 'adunarea fracțiilor', statement: 'Cât face $\\frac{1}{2}+\\frac{1}{3}$?', points: 10, difficulty: 'ușor' },
      { type: 'redactare', topic: 'probleme cu fracții', statement: 'O carte are 120 de pagini…', points: null, difficulty: 'greu' },
    ] }, usage: { in: 900, out: 300, model: 'gpt-5.6-terra' } };
  };
  const r = await mt.analyzeModel('1. Cât face 1/2+1/3? a) 2/5 b) 5/6 c) 1/6 d) 2/6\n2. O carte are 120 de pagini…', { chatJson, S: ai.S, model: 'gpt-5.6-terra' });
  assert.strictEqual(cerere.schemaName, 'structura_test_model');
  assert.strictEqual(cerere.model, 'gpt-5.6-terra');
  assert.ok(cerere.schema.properties.exercises, 'schema descrie exercițiile');
  assert.deepStrictEqual(cerere.schema.properties.exercises.items.properties.type.enum, ['grila', 'redactare']);
  assert.match(cerere.system, /Subpunctele a\), b\), c\) ale aceluiași exercițiu rămân UN singur exercițiu/);
  assert.match(cerere.messages[0].content, /O carte are 120 de pagini/);
  assert.strictEqual(r.model.category, 'clasa-5');
  assert.strictEqual(r.model.durationMin, 45);
  assert.strictEqual(r.model.exercises.length, 2);
  assert.strictEqual(r.model.exercises[1].type, 'redactare');
  assert.strictEqual(r.usage.model, 'gpt-5.6-terra');

  await assert.rejects(() => mt.analyzeModel('prea scurt', { chatJson, S: ai.S }), (e) => e.status === 400 && /destul text/.test(e.message));
  const gol = async () => ({ data: { title: 'x', difficulty: 'mediu', exercises: [] }, usage: {} });
  await assert.rejects(() => mt.analyzeModel('un text destul de lung, dar fără exerciții în el', { chatJson: gol, S: ai.S }), (e) => e.status === 422);
  // o categorie inventată nu trece
  const ciudat = async () => ({ data: { title: 't', category: 'clasa-13', difficulty: 'mediu', exercises: [{ type: 'grila', topic: 'x', statement: 'y' }] }, usage: {} });
  assert.strictEqual((await mt.analyzeModel('un text destul de lung pentru analiză', { chatJson: ciudat, S: ai.S })).model.category, null);
});

// ─── 3) Handlerul: citirea modelului + generarea după el ────────────────────
function stubAi({ chat }) {
  const saved = {};
  for (const k of ['admin', 'applyCors', 'authUser', 'requireUser', 'enforceRateLimit', 'enforceFeatureQuota', 'logUsage', 'retrieve', 'contextBlock', 'chatJson']) saved[k] = ai[k];
  const savedVerify = med.verifyQuestionSet;
  const log = { tabele: [], usage: [], cota: 0 };
  const supa = { from: (t) => { log.tabele.push(t); const p = new Proxy(function () {}, { get: (_, k) => (k === 'then' ? (res) => res({ data: [], error: null }) : () => p) }); return p; } };
  Object.assign(ai, {
    admin: () => supa, applyCors: () => {}, authUser: async () => 'prof-1',
    requireUser: async () => ({ id: 'prof-1', subscription_status: 'active', role: 'profesor', is_admin: false }),
    enforceRateLimit: async () => ({}),
    enforceFeatureQuota: async () => { log.cota++; },
    logUsage: async (s, u, endpoint) => { log.usage.push(endpoint); },
    retrieve: async () => [], contextBlock: () => '(exemple)',
    chatJson: chat,
  });
  med.verifyQuestionSet = async (questions) => ({ questions, report: { checked: questions.length }, usage: { in: 0, out: 0 } });
  const restore = () => { Object.assign(ai, saved); med.verifyQuestionSet = savedVerify; };
  return { log, restore };
}

test('API action „model": citește structura cu modelul PDF, fără cota de generări; costul se vede', async () => {
  let cerere = null;
  const { log, restore } = stubAi({ chat: async (o) => { cerere = o; return { data: { title: 'Test', difficulty: 'mediu', exercises: [{ type: 'grila', topic: 'fracții', statement: 'Cât face 1/2+1/2?', difficulty: 'ușor' }] }, usage: { in: 1000, out: 400, model: o.model } }; } });
  try {
    const handler = require('../api/ai-generate-interactive');
    const res = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { action: 'model', modelText: '1. Cât face 1/2+1/2? a) 1 b) 2 c) 1/4 d) 0' } }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.model.exercises.length, 1);
    assert.strictEqual(res.body.model.exercises[0].type, 'grila');
    assert.strictEqual(cerere.model, ai.PDF_MODEL);
    assert.deepStrictEqual(log.usage, ['ai-generate-interactive:model']);
    assert.strictEqual(log.cota, 0, 'citirea modelului nu consumă din cota „interactive"');
    assert.ok(res.body.cost && res.body.cost.credits > 0);
    assert.ok(!log.tabele.includes('content'));
    // text gol → 400, fără apel AI
    cerere = null;
    const r2 = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { action: 'model', modelText: '' } }, r2);
    assert.strictEqual(r2.statusCode, 400);
    assert.strictEqual(cerere, null);
  } finally { restore(); }
});

test('API generare DUPĂ MODEL: exact exercițiile modelului, în ordine, cu tipul lor; fără sursele din baza de date', async () => {
  let cerere = null;
  const Q = [
    { statement: 'Cât face $\\frac{1}{3}+\\frac{1}{6}$?', options: ['$\\frac{1}{2}$', '$\\frac{2}{9}$', '$\\frac{1}{9}$', '$1$'], answer: 0, explanation: 'Aducem la același numitor.' },
    { statement: 'Rezolvați ecuația $3x-2=7$.', options: null, answer: 'x=3', explanation: '3x = 9, deci x = 3.' },
    { statement: 'Cât la sută din 80 este 20?', options: ['20%', '25%', '30%', '40%'], answer: 1, explanation: '20/80 = 25%.' },
  ];
  const { log, restore } = stubAi({ chat: async (o) => { cerere = o; return { data: { questions: Q }, usage: { in: 2000, out: 900, model: o.model } }; } });
  try {
    const handler = require('../api/ai-generate-interactive');
    const res = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: {
      category: 'clasa-5', difficulty: 'mediu', kind: 'exercitiu', count: 10, qtype: 'grila', dataMode: 'keep', durationMin: 30, oficiu: 10,
      model: { title: 'Lucrarea mea', exercises: [
        { type: 'grila', topic: 'adunarea fracțiilor', statement: 'Cât face 1/2+1/4?', difficulty: 'ușor' },
        { type: 'redactare', topic: 'ecuații de gradul I', statement: 'Rezolvați 2x+1=5.', difficulty: 'mediu' },
        { type: 'grila', topic: 'procente', statement: 'Cât la sută din 50 este 10?', difficulty: 'greu' },
      ] },
    } }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.kind, 'test', 'cu model e mereu un test');
    assert.strictEqual(res.body.fromModel, true);
    assert.match(res.body.title, /^Test după model \(3 itemi, 30 min\) · Lucrarea mea$/);
    assert.strictEqual(res.body.questions.length, 3);
    assert.strictEqual(log.cota, 1, 'generarea consumă cota, ca orice test');
    // promptul: structura modelului, numărul exact și tipul pe item (nu „doar grilă" de la client)
    assert.match(cerere.system, /DUPĂ TESTUL-MODEL al profesorului \(mai jos\), cu EXACT 3 itemi/);
    assert.match(cerere.system, /Exercițiul 2 — CU REDACTAREA RĂSPUNSULUI/);
    assert.match(cerere.system, /Tipul fiecărei întrebări e cel al exercițiului corespunzător din model/);
    assert.doesNotMatch(cerere.system, /TOATE întrebările sunt GRILĂ/);
    assert.match(cerere.system, /REGIM DE LUCRU CU DATELE: .*/);
    assert.ok(!cerere.system.includes('SUBIECTE REALE DIN CATEGORIE'), 'sursele din baza de date nu se mai citesc');
    assert.ok(!log.tabele.includes('content'));
    assert.match(cerere.messages[0].content, /DUPĂ TESTUL-MODEL al profesorului/);
  } finally { restore(); }
});

test('generarea fără model rămâne neschimbată (exercițiu, sursele din categorie, „doar grilă")', async () => {
  let cerere = null;
  const { restore } = stubAi({ chat: async (o) => { cerere = o; return { data: { questions: [
    { statement: 'Cât face 2+2?', options: ['3', '4', '5', '6'], answer: 1, explanation: 'Adunare.' },
    { statement: 'Cât face 3+3?', options: ['5', '6', '7', '8'], answer: 1, explanation: 'Adunare.' },
    { statement: 'Cât face 4+4?', options: ['7', '8', '9', '10'], answer: 1, explanation: 'Adunare.' },
  ] }, usage: { in: 10, out: 10, model: o.model } }; } });
  try {
    const handler = require('../api/ai-generate-interactive');
    const res = fakeRes();
    await handler({ method: 'POST', headers: {}, query: {}, body: { category: 'clasa-5', qtype: 'grila' } }, res);
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.kind, 'exercitiu');
    assert.strictEqual(res.body.fromModel, false);
    assert.match(cerere.system, /TOATE întrebările sunt GRILĂ/);
    assert.doesNotMatch(cerere.system, /TESTUL-MODEL/);
  } finally { restore(); }
});

// ─── 4) Interfața: butonul de încărcare + formularul editabil ───────────────
test('„📐 Test după model": încărcare (PDF / Word / poză), formatul, exercițiile, numărul și dificultatea se modifică', () => {
  const form = read('src/components/InteractiveGenForm.jsx');
  const panel = read('src/components/ModelTestPanel.jsx');
  const client = read('src/lib/aiClient.js');
  assert.match(client, /analyzeModel: \(\{ modelText \}\) => post\('\/api\/ai-generate-interactive', \{ action: 'model', modelText \}\)/);
  assert.match(client, /\.\.\.\(model \? \{ model \} : \{\}\)/);
  // același drum de citire ca materialul (PDF → pdf_text, Word → docx_text, poză → vision)
  assert.match(form, /async function citesteFisier\(file, \{ note \} = \{\}\)/);
  assert.match(form, /async function loadModel\(e\)/);
  assert.match(form, /aiClient\.analyzeModel\(\{ modelText: text\.slice\(0, 14000\) \}\)/);
  assert.match(form, /<ModelTestPanel g=\{g\} \/>/);
  // payload-ul generării: structura modificată de profesor
  assert.match(form, /model: \{\s*title: model\.title,\s*difficulty,\s*exercises: model\.exercises\.map/);
  assert.match(form, /const effCount = model \? model\.exercises\.length : itemCount;/);
  // formatul și dificultatea de sus se aplică pe toate exercițiile modelului
  assert.match(form, /const setQtypeAll = \(t\) =>/);
  assert.match(form, /type: t === 'mixt' \? \(x\.typeOrig \|\| x\.type\) : t/);
  assert.match(form, /const setDifficultyAll = \(d\) =>/);
  assert.match(form, /setQtype: setQtypeAll/);
  assert.match(form, /setDifficulty: setDifficultyAll/);
  // numărul: în plus → copii ale exercițiilor modelului; în minus → de la coadă
  assert.match(form, /const setModelCount = \(n\) =>/);
  assert.match(form, /const sursa = m\.exercises\[i % m\.exercises\.length\];/);

  assert.match(panel, /📐 Încarcă modelul \(PDF, Word, poză\)/);
  assert.match(panel, /accept="\.pdf,\.docx,\.doc,application\/pdf,application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document,image\/\*"/);
  assert.match(panel, /📷 Fă poză la model/);
  assert.match(panel, /Număr de exerciții/);
  assert.match(panel, /🔘 Grilă/);
  assert.match(panel, /✍️ Redactare/);
  assert.match(panel, /patchModelEx\(x\.id, \{ difficulty: e\.target\.value \}\)/);
  assert.match(panel, /➕ Adaugă un exercițiu/);
  assert.match(panel, /✕ Renunță la model/);
  assert.match(panel, /moveModelEx\(x\.id, -1\)/);

  // butonul de generare spune că testul se face după model (și în testul pe grupă)
  assert.match(read('src/pages/ProfesorVirtual.jsx'), /✨ Generează testul după model/);
  const vg = read('src/components/VariantGenerator.jsx');
  assert.match(vg, /g\.payload\(\{ kind: 'test', count: g\.effCount \}\)/);
  assert.match(vg, /Generează testul\$\{g\.model \? ' după model' : ''\}/);
});
