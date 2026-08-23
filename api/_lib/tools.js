// =====================================================================
// api/_lib/tools.js — UNELTELE Profesorului Virtual (tool calling, Etapa 3 — 3.2)
//
// Modelul nu mai „ghicește" calculele și nu mai caută singur prin textul
// testului: cere unealta, primește rezultatul STRUCTURAT și abia apoi explică.
//   · calculate(expression)     — mathjs (instanța sigură din mathcheck): numeric,
//                                  simplify(...), derivative(...), fracții exacte;
//   · check_equivalence(a, b)   — „1/2" = „0,5"? (mathcheck.answersEquivalent);
//   · get_exercise(ref)         — enunțul exact al unui item („II.3", „III.2.b")
//                                  din testul deschis (PDF) / exercițiul interactiv;
//   · get_barem_item(ref)       — fragmentul de barem al itemului (agentul PDF).
// Marcajele [[ACTIUNE:…]] / [[MEDITATII:…]] (acțiuni în browser) rămân așa cum
// sunt — unelte sunt doar cele care au nevoie de date de pe server.
// Formatul: OpenAI Chat Completions `tools` (function calling); ai.chat /
// ai.chatStream rulează bucla de apeluri (vezi ai.js → runToolCalls).
// =====================================================================
const mathcheck = require('./mathcheck');
const { parseExerciseRef, sliceExercise, formatRef, locateBaremItem } = require('./barem');

const ENABLED = process.env.AI_TOOLS !== '0'; // implicit PORNIT
const MAX_EXPR = 300;

// ── calculate ────────────────────────────────────────────────────────────────
function calculate({ expression }) {
  const expr = String(expression || '').trim();
  if (!expr) return { error: 'expresie goală' };
  if (expr.length > MAX_EXPR) return { error: `expresia e prea lungă (max ${MAX_EXPR} caractere)` };
  const r = mathcheck.evaluateExpr(expr);
  if (r.error) return { error: r.error, hint: 'Scrie expresia în sintaxă mathjs: 2^3, sqrt(16), 3/4 + 1/6, simplify("2x+3x"), derivative("x^2", "x"), fraction(0.75)' };
  return { result: r.result, ...(r.exact ? { exact: r.exact } : {}) };
}

// ── check_equivalence ────────────────────────────────────────────────────────
function checkEquivalence({ a, b }) {
  const eq = mathcheck.answersEquivalent(String(a ?? ''), String(b ?? ''));
  return { equivalent: eq, note: eq === null ? 'nu se poate decide automat (text / forme diferite)' : eq ? 'matematic echivalente' : 'diferite' };
}

// ── get_exercise / get_barem_item (au nevoie de textele din context) ─────────
function refOf(ref) {
  const p = parseExerciseRef(String(ref || ''));
  return p && p.ex ? p : null;
}
function getExercise(ctx, { ref }) {
  const r = refOf(ref);
  if (!r) return { error: 'referință neînțeleasă — folosește forma „II.3" sau „Subiectul III, problema 2 b"' };
  const text = String(ctx.subjectText || ctx.exerciseText || '');
  if (!text.trim()) return { error: 'nu am textul testului' };
  const frag = sliceExercise(text, r) || sliceExercise(text, { ...r, letter: null });
  if (!frag) return { error: `nu am găsit itemul ${formatRef(r)} în text` };
  return { ref: formatRef(r), text: frag.slice(0, 2500) };
}
function getBaremItem(ctx, { ref }) {
  const r = refOf(ref);
  if (!r) return { error: 'referință neînțeleasă — folosește forma „II.3" sau „III.2.b"' };
  if (!ctx.baremText) return { error: 'acest test nu are barem asociat' };
  const loc = locateBaremItem(ctx.baremText, r);
  if (!loc) return { error: `nu am găsit itemul ${formatRef(r)} în barem` };
  return { ref: formatRef(r), kind: loc.kind, text: String(loc.text || '').slice(0, 3500), ...(loc.litera ? { letter: loc.litera } : {}), ...(loc.raspuns ? { answer: loc.raspuns } : {}) };
}

// ── Definițiile (format OpenAI) + rularea ────────────────────────────────────
const P = (props, required) => ({ type: 'object', properties: props, required, additionalProperties: false });

// tutorTools(ctx): uneltele disponibile pentru o conversație
//   ctx = { subjectText?, exerciseText?, baremText? }
function tutorTools(ctx = {}) {
  if (!ENABLED) return [];
  const tools = [
    {
      name: 'calculate',
      description: 'Calculează o expresie matematică (numeric sau simbolic). Folosește-o la ORICE calcul cu mai mulți pași, cu fracții, radicali, zecimale sau numere mari — nu calcula din cap. Suportă și simplify("…"), derivative("…","x"), fraction(…).',
      parameters: P({ expression: { type: 'string', description: 'expresia în sintaxă mathjs, ex: (3/4 + 1/6) * 12, sqrt(50), simplify("2x+3x-1")' } }, ['expression']),
      run: calculate,
    },
    {
      name: 'check_equivalence',
      description: 'Verifică dacă două rezultate sunt matematic echivalente (ex. 1/2 și 0,5; 2√3 și 2\\sqrt{3}; x=3 și 3).',
      parameters: P({ a: { type: 'string' }, b: { type: 'string' } }, ['a', 'b']),
      run: checkEquivalence,
    },
  ];
  if (ctx.subjectText || ctx.exerciseText) {
    tools.push({
      name: 'get_exercise',
      description: 'Returnează enunțul EXACT al unui item din testul/exercițiul deschis, după referință (ex. "II.3", "III.2.b", "Subiectul I, itemul 4").',
      parameters: P({ ref: { type: 'string', description: 'referința itemului' } }, ['ref']),
      run: (args) => getExercise(ctx, args),
    });
  }
  if (ctx.baremText) {
    tools.push({
      name: 'get_barem_item',
      description: 'Returnează fragmentul din BAREMUL OFICIAL pentru un item (răspunsul corect / pașii punctați), după referință (ex. "II.3", "III.2.b").',
      parameters: P({ ref: { type: 'string', description: 'referința itemului' } }, ['ref']),
      run: (args) => getBaremItem(ctx, args),
    });
  }
  return tools;
}

// Nota din promptul de sistem (scurtă — stă în partea dinamică a promptului)
function toolsNote(tools) {
  if (!tools || !tools.length) return '';
  const names = tools.map((t) => t.name);
  return `UNELTE (apeluri de funcții): ${names.join(', ')}. Folosește calculate pentru orice calcul neevident (nu calcula din cap numere cu mai mulți pași), check_equivalence când compari rezultatul elevului cu cel corect${names.includes('get_exercise') ? ', get_exercise pentru enunțul exact al unui item' : ''}${names.includes('get_barem_item') ? ', get_barem_item pentru baremul unui item' : ''}. Nu menționa uneltele în răspuns — prezintă doar rezultatele, ca un profesor.`;
}

module.exports = { tutorTools, toolsNote, calculate, checkEquivalence, getExercise, getBaremItem, ENABLED };
