// =====================================================================
// api/_lib/verify.js — VERIFICATORUL INDEPENDENT al itemilor generați
// (Etapa 2 din AUDIT_AGENTI_AI.md, punctul 1.3, stratul 2)
//
// Un al doilea apel, cu un prompt de „rezolvitor" care primește DOAR enunțul
// (și variantele, la grilă) — NU și cheia generatorului — și întoarce
// răspunsul lui final. Comparăm:
//   · grilă: litera verificatorului = litera generatorului;
//   · răspuns liber: mathcheck.answersEquivalent (numeric/simbolic; null =
//     nu se poate decide → itemul NU e marcat ca greșit).
// Dezacordul = semnal că cheia generată e probabil greșită → apelantul
// regenerează itemul (o dată) sau îl elimină / îl marchează „nesigur".
//
// Modelul: AI_VERIFY_MODEL (implicit modelul de generare) — ideal ALT model
// decât generatorul (erori necorelate). Cost: ~1 apel mic per item, plafonat
// de AI_VERIFY_MAX_ITEMS și de un buget de timp (AI_VERIFY_TIME_MS).
// =====================================================================
const ai = require('./ai');
const mathcheck = require('./mathcheck');

const VERIFY_MODEL = process.env.AI_VERIFY_MODEL || ai.GEN_MODEL;
const MAX_ITEMS = parseInt(process.env.AI_VERIFY_MAX_ITEMS || '24', 10);
const CONCURRENCY = parseInt(process.env.AI_VERIFY_CONCURRENCY || '4', 10);
const TIME_MS = parseInt(process.env.AI_VERIFY_TIME_MS || '90000', 10);
const ENABLED = process.env.AI_VERIFY_GEN !== '0'; // implicit PORNIT

const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];

const SYSTEM = `Ești un profesor de matematică foarte riguros. Primești UN exercițiu (și, dacă e grilă, variantele lui). NU primești răspunsul altcuiva — îl rezolvi TU, de la zero, cu atenție la fiecare calcul, apoi verifici rezultatul printr-o a doua metodă sau prin înlocuire.
Răspunde STRICT cu JSON:
{"final_answer": "<răspunsul final, scurt: un număr, o expresie LaTeX între $...$, o mulțime {…} sau textul exact al unei variante>", "letter": "<la grilă: litera variantei corecte a/b/c/d; altfel null>", "confidence": "high|medium|low", "note": "<o propoziție: metoda și rezultatul>"}
Reguli: la grilă alegi EXACT una dintre variantele date (litera ei); dacă niciuna nu se potrivește, pune litera cea mai apropiată și confidence "low". La răspuns liber dai DOAR valoarea finală (fără explicații în final_answer). Virgula zecimală e acceptată. Dacă exercițiul e ambiguu sau nu are date suficiente, spune asta în "note" și pune confidence "low".`;

const SCHEMA = ai.S.obj({
  final_answer: ai.S.str(),
  letter: ai.S.nullable(ai.S.enum(['a', 'b', 'c', 'd', 'e', 'f'])),
  confidence: ai.S.enum(['high', 'medium', 'low']),
  note: ai.S.str(),
});

// Un item: { id, statement, options?: string[], answer (index|literă|text), parts?: [{label,text,solution}] }
function itemPrompt(it) {
  const opts = Array.isArray(it.options) && it.options.length
    ? '\nVARIANTE:\n' + it.options.map((o, i) => `${LETTERS[i]}) ${o}`).join('\n')
    : '';
  const parts = Array.isArray(it.parts) && it.parts.length
    ? '\nSUBPUNCTE:\n' + it.parts.map((p) => `${p.label || ''}) ${p.text || ''}`).join('\n') + '\n(Dă răspunsul final al ULTIMULUI subpunct care are o valoare calculabilă; dacă toate sunt de tip „arătați că", pune final_answer "demonstratie".)'
    : '';
  return `EXERCIȚIUL:\n${String(it.statement || '').slice(0, 2500)}${opts}${parts}`;
}

// litera cheii generatorului (index / literă / text de variantă)
function claimedLetter(it) {
  if (!Array.isArray(it.options) || !it.options.length) return null;
  const a = it.answer;
  if (Number.isInteger(a)) return LETTERS[a] || null;
  const s = String(a ?? '').trim();
  const m = /^([a-fA-F])\s*[).]?$/.exec(s);
  if (m) return m[1].toLowerCase();
  if (/^\d+$/.test(s)) return LETTERS[parseInt(s, 10)] || null;
  const flat = (x) => String(x || '').replace(/\s+/g, '').toLowerCase();
  const idx = it.options.findIndex((o) => flat(o) === flat(s));
  return idx >= 0 ? LETTERS[idx] : null;
}

// Verifică UN item → { agree: true|false|null, verifier: {answer, letter, confidence, note}, usage }
async function verifyItem(it, { model = VERIFY_MODEL } = {}) {
  const res = { agree: null, verifier: null, usage: { in: 0, out: 0, model } };
  try {
    const { data, usage } = await ai.chatJson({
      system: SYSTEM, messages: [{ role: 'user', content: itemPrompt(it) }],
      temperature: 0, maxTokens: 700, model, schema: SCHEMA, schemaName: 'verificare_item',
    });
    res.usage = usage;
    res.verifier = { answer: data.final_answer, letter: data.letter, confidence: data.confidence, note: data.note };
    const want = claimedLetter(it);
    if (want) {
      // grilă: litera verificatorului (sau textul ales) vs litera generatorului
      let got = data.letter || null;
      if (!got && data.final_answer) {
        const flat = (x) => String(x || '').replace(/\s+/g, '').toLowerCase();
        const idx = it.options.findIndex((o) => flat(o) === flat(data.final_answer));
        got = idx >= 0 ? LETTERS[idx] : null;
      }
      if (!got) res.agree = null;
      else if (got === want) res.agree = true;
      else res.agree = data.confidence === 'low' ? null : false; // nesigur → nu pedepsim generatorul
    } else {
      const claimed = it.answer != null && String(it.answer).trim() ? String(it.answer) : (it.solutionAnswer || null);
      if (!claimed || /demonstra/i.test(String(data.final_answer || ''))) res.agree = null;
      else {
        const eq = mathcheck.answersEquivalent(data.final_answer, claimed);
        res.agree = eq === true ? true : eq === false && data.confidence !== 'low' ? false : null;
      }
    }
  } catch (e) {
    res.error = e.message;
    if (e.usage) res.usage = e.usage;
  }
  return res;
}

// Verifică o LISTĂ de itemi, în paralel (plafon de concurență + timp).
// Întoarce { results: [{ id, agree, verifier, error? }], usage, checked, skipped }
async function verifyItems(items, { model = VERIFY_MODEL, maxItems = MAX_ITEMS, concurrency = CONCURRENCY, timeMs = TIME_MS } = {}) {
  const list = (Array.isArray(items) ? items : []).slice(0, maxItems);
  const results = new Array(list.length).fill(null);
  const usage = { in: 0, out: 0, model };
  const started = Date.now();
  let next = 0, skipped = (Array.isArray(items) ? items.length : 0) - list.length;
  async function worker() {
    while (next < list.length) {
      const i = next++;
      if (Date.now() - started > timeMs) { skipped++; results[i] = { id: list[i].id, agree: null, skipped: true }; continue; }
      const r = await verifyItem(list[i], { model });
      usage.in += r.usage?.in || 0; usage.out += r.usage?.out || 0;
      results[i] = { id: list[i].id, agree: r.agree, verifier: r.verifier, error: r.error };
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, list.length)) }, worker));
  return { results, usage, checked: results.filter((r) => r && !r.skipped).length, skipped };
}

module.exports = { verifyItem, verifyItems, claimedLetter, itemPrompt, ENABLED, VERIFY_MODEL, MAX_ITEMS };
