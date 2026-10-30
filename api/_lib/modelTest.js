// =====================================================================
// api/_lib/modelTest.js — „📐 Test după model" (generatorul profesorului)
//
// Profesorul încarcă un test DE-AL LUI (PDF, Word sau poză) ca MODEL. Nu-l
// copiem: îi citim STRUCTURA — formatul (grilă / redactare), exercițiile în
// ordine (ce verifică fiecare, enunțul de pornire, punctajul), numărul lor și
// dificultatea — și i-o arătăm ca formular pe care o poate modifica. La
// generare, structura (eventual modificată) intră în prompt și AI-ul scrie un
// test NOU: același număr de exerciții, aceeași ordine și același tip, pe
// aceleași competențe, cu alte date.
//
//   analyzeModel(text, { chatJson, model })  → structura citită din model
//   sanitizeModel(body.model)                → structura primită de la client,
//                                              curățată (limite, tipuri)
//   modelFormat(m)                           → 'grila' | 'redactare' | 'mixt'
//   modelBlock(m, { difficulty })            → blocul din promptul de generare
//
// Folosit de api/ai-generate-interactive.js (action 'model' + câmpul `model`).
// =====================================================================

const MAX_EXERCITII = 24;          // cât duce și generatorul de teste
const MAX_ENUNT = 1200;            // enunțul de pornire, per exercițiu
const MAX_TEMA = 140;
const MAX_TEXT_MODEL = 14000;      // textul citit din fișier (ca materialul încărcat)
const DIFICULTATI = ['ușor', 'mediu', 'greu'];
const TIPURI = ['grila', 'redactare'];
const CATEGORII = [
  'clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'clasa-9', 'clasa-10', 'clasa-11', 'clasa-12',
  'evaluare-nationala', 'bacalaureat',
];

const clean = (s, max) => String(s == null ? '' : s).replace(/\u0000/g, '').trim().slice(0, max);
const oneLine = (s, max) => clean(s, max * 2).replace(/\s+/g, ' ').trim().slice(0, max);

// „usor", „Ușor", „easy" → 'ușor'; altceva → implicit
function normDificultate(d, implicit = 'mediu') {
  const s = String(d || '').toLowerCase().trim();
  if (/^(u[sș]or|easy|simplu)/.test(s)) return 'ușor';
  if (/^(greu|dificil|hard|avansat)/.test(s)) return 'greu';
  if (/^(mediu|medium|normal)/.test(s)) return 'mediu';
  return implicit;
}

// „grilă", „grila", „choice" → 'grila'; orice altceva → 'redactare'
function normTip(t) {
  const s = String(t || '').toLowerCase().trim();
  return /^(gril|choice|quiz|variante)/.test(s) ? 'grila' : 'redactare';
}

function intOrNull(v, lo, hi) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n)) return null;
  return Math.max(lo, Math.min(hi, n));
}

// ─── Structura primită de la client (după ce profesorul a modificat-o) ───────
// Nu avem încredere în nimic din browser: limite pe număr, lungimi și tipuri.
// null = fără model (generarea obișnuită).
function sanitizeModel(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const list = Array.isArray(raw.exercises) ? raw.exercises : [];
  const exercises = list.slice(0, MAX_EXERCITII).map((e) => ({
    type: normTip(e && e.type),
    topic: oneLine(e && e.topic, MAX_TEMA),
    statement: clean(e && e.statement, MAX_ENUNT),
    points: intOrNull(e && e.points, 0, 100),
    difficulty: normDificultate(e && e.difficulty, normDificultate(raw.difficulty)),
  })).filter((e) => e.topic || e.statement);
  if (!exercises.length) return null;
  return {
    title: oneLine(raw.title, 120) || 'Test după model',
    difficulty: normDificultate(raw.difficulty),
    exercises,
  };
}

// Formatul de ansamblu, din tipurile exercițiilor
function modelFormat(m) {
  const tipuri = new Set(((m && m.exercises) || []).map((e) => e.type));
  if (tipuri.size === 1) return tipuri.has('grila') ? 'grila' : 'redactare';
  return 'mixt';
}

// ─── Blocul din promptul de generare ─────────────────────────────────────────
function modelBlock(m) {
  if (!m || !m.exercises || !m.exercises.length) return '';
  const n = m.exercises.length;
  const randuri = m.exercises.map((e, i) => {
    const cap = [
      `Exercițiul ${i + 1} — ${e.type === 'grila' ? 'GRILĂ (exact 4 variante, una corectă)' : 'CU REDACTAREA RĂSPUNSULUI (fără variante)'}`,
      e.topic ? `ce verifică: ${e.topic}` : null,
      `dificultate: ${e.difficulty}`,
      e.points != null ? `${e.points} p în model` : null,
    ].filter(Boolean).join(' · ');
    return e.statement ? `${cap}\n  Enunțul din model (DOAR reper — nu-l copia): ${e.statement.replace(/\s*\n\s*/g, ' ')}` : cap;
  }).join('\n');
  return `
=== TESTUL-MODEL AL PROFESORULUI — structura de urmat («${m.title}», ${n} ${n === 1 ? 'exercițiu' : 'exerciții'}) ===
${randuri}
=== SFÂRȘIT MODEL ===
REGULĂ ABSOLUTĂ — TEST DUPĂ MODEL: testul nou are EXACT ${n} ${n === 1 ? 'item' : 'itemi'}, în ORDINEA de mai sus. Itemul k este un exercițiu NOU, de același TIP ca exercițiul k din model (grilă ↔ grilă, redactare ↔ redactare), pe aceeași competență („ce verifică") și în același stil, cu dificultatea scrisă la el.
- Schimbă datele (alte numere, alte litere, alt context), NU copia enunțurile modelului și nu le schimba doar ordinea.
- Păstrează formatul modelului: dacă exercițiul din model are subpuncte a), b), c), scrie și tu subpunctele în același enunț.
- Dacă modelul are greșeli de recunoaștere (text dintr-o poză sau dintr-un PDF), reconstituie sensul matematic; nu inventa alte capitole.
`;
}

// ─── Citirea modelului (un singur apel AI, JSON pe schemă) ───────────────────
function modelSchema(S) {
  return S.obj({
    title: S.str('titlul testului-model, scurt (ex: „Test — fracții, clasa a V-a"); „Test" dacă nu are'),
    category: S.nullable(S.enum(CATEGORII, 'clasa sau examenul, DOAR dacă reiese clar din model')),
    difficulty: S.enum(DIFICULTATI, 'dificultatea de ansamblu a testului'),
    durationMin: S.nullable(S.int('timpul de lucru scris pe model, în minute; null dacă nu scrie')),
    oficiu: S.nullable(S.int('punctele din oficiu scrise pe model; null dacă nu scrie')),
    exercises: S.arr(S.obj({
      type: S.enum(TIPURI, 'grila = are variante de răspuns (a, b, c, d); redactare = rezolvare scrisă / răspuns liber'),
      topic: S.str('ce verifică exercițiul, 3–8 cuvinte (capitolul / competența)'),
      statement: S.str('enunțul din model, cu formulele în LaTeX între $...$ (cu tot cu subpunctele a), b)…)'),
      points: S.nullable(S.int('punctajul exercițiului, dacă e scris pe model; altfel null')),
      difficulty: S.enum(DIFICULTATI, 'dificultatea acestui exercițiu'),
    })),
  });
}

const ANALYZE_SYSTEM = `Ești profesor de matematică în România. Primești TEXTUL unui test-model al unui coleg (extras dintr-un PDF, dintr-un fișier Word sau dintr-o fotografie) și îi descrii STRUCTURA, ca un alt test să poată fi scris după el.
Reguli:
- Fiecare exercițiu numerotat al testului = un element din "exercises", în ordinea din test. Subpunctele a), b), c) ale aceluiași exercițiu rămân UN singur exercițiu (enunțul le cuprinde pe toate).
- "type": "grila" dacă exercițiul are variante de răspuns de ales (a, b, c, d / A, B, C, D); altfel "redactare".
- "topic": ce verifică exercițiul, pe scurt (capitolul sau competența din programă).
- "statement": enunțul copiat din model, cu formulele în LaTeX între $...$. Textul vine dintr-o recunoaștere automată și poate avea greșeli: reconstituie sensul matematic, fără să inventezi.
- "difficulty": ușor / mediu / greu, după numărul de pași și după clasă.
- NU include baremul, rezolvările sau răspunsurile (dacă apar în text) ca exerciții. Nu inventa exerciții care nu sunt în test.
- Cel mult ${MAX_EXERCITII} de exerciții.
- IMPORTANT JSON valid: scrie fiecare backslash din LaTeX de DOUĂ ori (ex: "$\\\\frac{1}{2}$").`;

// Întoarce { model: { title, category, difficulty, durationMin, oficiu, exercises }, usage }.
// `chatJson` și `S` vin din api/_lib/ai.js (injectate — modulul rămâne testabil).
async function analyzeModel(text, { chatJson, S, model, maxTokens = 6000 } = {}) {
  const t = clean(text, MAX_TEXT_MODEL);
  if (t.length < 20) {
    const e = new Error('Nu am găsit destul text în model. Încarcă un PDF cu text, un fișier Word sau o poză mai clară.');
    e.status = 400; throw e;
  }
  const { data, usage } = await chatJson({
    system: ANALYZE_SYSTEM,
    messages: [{ role: 'user', content: `TESTUL-MODEL:\n"""\n${t}\n"""\nDescrie-i structura ca obiect JSON.` }],
    temperature: 0.1, maxTokens, model,
    schema: modelSchema(S), schemaName: 'structura_test_model',
  });
  const raw = data && typeof data === 'object' ? data : {};
  const exercises = (Array.isArray(raw.exercises) ? raw.exercises : []).slice(0, MAX_EXERCITII).map((e) => ({
    type: normTip(e && e.type),
    topic: oneLine(e && e.topic, MAX_TEMA),
    statement: clean(e && e.statement, MAX_ENUNT),
    points: intOrNull(e && e.points, 0, 100),
    difficulty: normDificultate(e && e.difficulty, normDificultate(raw.difficulty)),
  })).filter((e) => e.topic || e.statement);
  if (!exercises.length) {
    const e = new Error('Nu am recunoscut exerciții în model. Verifică fișierul (sau textul citit) și încearcă din nou.');
    e.status = 422; throw e;
  }
  return {
    model: {
      title: oneLine(raw.title, 120) || 'Test',
      category: CATEGORII.includes(raw.category) ? raw.category : null,
      difficulty: normDificultate(raw.difficulty),
      durationMin: intOrNull(raw.durationMin, 5, 180),
      oficiu: intOrNull(raw.oficiu, 0, 20),
      exercises,
    },
    usage,
  };
}

module.exports = {
  MAX_EXERCITII, MAX_ENUNT, MAX_TEXT_MODEL, DIFICULTATI, CATEGORII,
  normDificultate, normTip, sanitizeModel, modelFormat, modelBlock, modelSchema, analyzeModel,
};
