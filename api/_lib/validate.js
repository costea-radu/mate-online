// =====================================================================
// api/_lib/validate.js — VALIDAREA STRUCTURALĂ, DETERMINISTĂ a testelor și
// întrebărilor generate (Etapa 2 din AUDIT_AGENTI_AI.md, punctul 1.3, stratul 1)
//
// Zero cost, zero model: verifică înainte de publicare/afișare
//   · punctajul fiecărui subiect (30p la EN/BAC), oficiul;
//   · grilele: 4 variante (I.6 la EN: 2 — Adevărat/Fals), fără variante
//     duplicate, răspunsul = o literă a–d (sau textul unei variante → literă);
//   · EN: fără figuri la Subiectul I și la III.1–III.2; figuri la II și III.3–6;
//   · specificația figurilor: tipul din lista permisă, etichete ca șiruri;
//   · LaTeX-ul din $...$ trebuie să fie randabil (KaTeX pe server); ce nu se
//     randează trece prin fixLatex; dacă tot nu, rămâne avertisment;
//   · enunțuri duplicate (normalizate) → se elimină.
// Întoarce { ok, errors, warnings, exam/questions (reparate unde se poate) }.
// =====================================================================
let katex = null;
try { katex = require('katex'); } catch { /* fără katex instalat: sărim verificarea LaTeX */ }

const FIGURE_TYPES = ['segment', 'unghi', 'triunghi', 'patrat', 'dreptunghi', 'paralelogram', 'romb', 'trapez', 'cerc', 'xOy', 'cub', 'paralelipiped', 'prisma', 'piramida', 'con', 'cilindru', 'sfera', 'trunchi-con', 'trunchi-piramida'];

// ─── LaTeX ───────────────────────────────────────────────────────────────────
// fragmentele $...$ / $$...$$ dintr-un text
function mathSegments(text) {
  const out = [];
  const s = String(text || '');
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let m;
  while ((m = re.exec(s)) !== null) out.push(m[1] != null ? m[1] : m[2]);
  return out;
}
function latexOk(seg) {
  if (!katex) return true;
  try { katex.renderToString(seg, { throwOnError: true, strict: 'ignore' }); return true; } catch { return false; }
}
// întoarce lista fragmentelor care NU se randează
function badLatex(text) {
  return mathSegments(text).filter((seg) => !latexOk(seg));
}

// ─── Normalizări ─────────────────────────────────────────────────────────────
const LETTERS = ['a', 'b', 'c', 'd', 'e', 'f'];
function normLetter(answer, options) {
  const a = String(answer ?? '').trim();
  const m = /^([a-fA-F])\s*[).]?$/.exec(a);
  if (m) {
    const i = LETTERS.indexOf(m[1].toLowerCase());
    return i < (options || []).length ? LETTERS[i] : null;
  }
  if (/^\d+$/.test(a)) { const i = parseInt(a, 10); return i >= 0 && i < (options || []).length ? LETTERS[i] : null; }
  // textul unei variante
  const flat = (s) => String(s || '').replace(/\s+/g, '').toLowerCase();
  const idx = (options || []).findIndex((o) => flat(o) === flat(a));
  return idx >= 0 ? LETTERS[idx] : null;
}
const normStatement = (s) => String(s || '').toLowerCase().replace(/\$/g, '').replace(/[^a-z0-9ăâîșț]+/g, ' ').trim();

function pointsOf(item) {
  if (Array.isArray(item?.parts) && item.parts.length) return item.parts.reduce((s, p) => s + (Number(p?.points) || 0), 0);
  return Number(item?.points) || 0;
}

// ─── Testul de examen (ai-exam) ──────────────────────────────────────────────
// opts: { examType: 'evaluare-nationala' | 'bac-*', fixLatex?: fn, perSubject: 30 }
function validateExam(exam, { examType = '', fixLatex = null, perSubject = 30 } = {}) {
  const errors = [], warnings = [];
  const en = examType === 'evaluare-nationala';
  const subjects = Array.isArray(exam?.subjects) ? exam.subjects : [];
  if (!subjects.length) return { ok: false, errors: ['fără subiecte'], warnings, exam };
  const seen = new Map();

  subjects.forEach((sub, si) => {
    const label = sub?.label || `Subiectul ${si + 1}`;
    const items = Array.isArray(sub?.items) ? sub.items : [];
    if (!items.length) { errors.push(`${label}: fără itemi`); return; }
    // punctajul subiectului
    const sum = Math.round(items.reduce((s, it) => s + pointsOf(it), 0) * 100) / 100;
    if (perSubject && sum !== perSubject) errors.push(`${label}: punctajul itemilor este ${sum}p, nu ${perSubject}p`);
    if (sub.points != null && Number(sub.points) !== perSubject && perSubject) warnings.push(`${label}: "points" este ${sub.points}, nu ${perSubject}`);

    items.forEach((it, ii) => {
      const ref = `${label} · ${it?.number || ii + 1}`;
      if (!it || typeof it !== 'object') { errors.push(`${ref}: item invalid`); return; }
      if (!String(it.statement || '').trim()) errors.push(`${ref}: enunț gol`);
      // duplicate
      const key = normStatement(it.statement).slice(0, 140);
      if (key.length > 20) {
        if (seen.has(key)) errors.push(`${ref}: enunț duplicat cu ${seen.get(key)}`);
        else seen.set(key, ref);
      }
      // grilă
      if (Array.isArray(it.options)) {
        const opts = it.options.map((o) => String(o ?? '').trim());
        const isTF = en && si === 0 && ii === 5; // I.6 Adevărat/Fals
        if (isTF ? opts.length !== 2 : opts.length !== 4) errors.push(`${ref}: ${opts.length} variante (așteptate ${isTF ? 2 : 4})`);
        if (new Set(opts.map((o) => o.replace(/\s+/g, '').toLowerCase())).size !== opts.length) errors.push(`${ref}: variante duplicate`);
        const letter = normLetter(it.answer, opts);
        if (!letter) errors.push(`${ref}: răspunsul „${it.answer}" nu indică o variantă`);
        else it.answer = letter; // normalizat la literă
      } else if (Array.isArray(it.parts)) {
        it.parts.forEach((p, pi) => {
          if (!String(p?.text || '').trim()) errors.push(`${ref} ${p?.label || pi}): cerință goală`);
          if (!(Number(p?.points) > 0)) errors.push(`${ref} ${p?.label || pi}): fără puncte`);
          if (!String(p?.solution || '').trim()) warnings.push(`${ref} ${p?.label || pi}): fără rezolvare`);
        });
      } else if (!String(it.answer ?? '').trim() && !String(it.solution || '').trim()) {
        warnings.push(`${ref}: fără răspuns și fără rezolvare`);
      }
      // figuri (EN)
      if (en) {
        const hasFig = it.figure && typeof it.figure === 'object';
        const num = parseInt(it.number, 10) || ii + 1;
        if (si === 0 && hasFig) { errors.push(`${ref}: Subiectul I nu are figuri`); delete it.figure; }
        if (si === 2 && num <= 2 && hasFig) { warnings.push(`${ref}: III.1–III.2 nu au figuri (eliminată)`); delete it.figure; }
        if ((si === 1 || (si === 2 && num >= 3)) && !hasFig) warnings.push(`${ref}: lipsește figura`);
      }
      if (it.figure && typeof it.figure === 'object') {
        if (!FIGURE_TYPES.includes(it.figure.type)) { warnings.push(`${ref}: tip de figură necunoscut „${it.figure.type}" (eliminată)`); delete it.figure; }
        else if (it.figure.labels != null && !(Array.isArray(it.figure.labels) && it.figure.labels.every((l) => typeof l === 'string'))) {
          warnings.push(`${ref}: etichetele figurii nu sunt șiruri (eliminate)`); delete it.figure.labels;
        }
      } else if (it.figure != null && typeof it.figure !== 'object') {
        delete it.figure; // ex. textul „(DOAR la problemele 3–6…)” copiat din prompt
      }
      // LaTeX
      const fields = [['statement', it.statement], ['solution', it.solution], ...((it.options || []).map((o, k) => [`options[${k}]`, o])),
        ...((it.parts || []).flatMap((p, k) => [[`parts[${k}].text`, p?.text], [`parts[${k}].solution`, p?.solution]]))];
      for (const [name, val] of fields) {
        if (typeof val !== 'string' || !val) continue;
        let bad = badLatex(val);
        if (bad.length && fixLatex) {
          const fixed = fixLatex(val);
          if (!badLatex(fixed).length) {
            // scriem înapoi valoarea reparată
            if (name === 'statement') it.statement = fixed; else if (name === 'solution') it.solution = fixed;
            else if (name.startsWith('options[')) it.options[parseInt(name.slice(8), 10)] = fixed;
            else if (name.startsWith('parts[')) { const k = parseInt(name.slice(6), 10); if (name.endsWith('.text')) it.parts[k].text = fixed; else it.parts[k].solution = fixed; }
            bad = [];
          }
        }
        if (bad.length) warnings.push(`${ref} ${name}: LaTeX nerandabil: ${bad.slice(0, 2).map((b) => b.slice(0, 40)).join(' | ')}`);
      }
    });
  });
  return { ok: errors.length === 0, errors, warnings, exam };
}

// ─── Liste de întrebări (ai-generate-interactive, meditații) ─────────────────
// q: { statement, options?: string[], answer: index|text, explanation? }
function validateQuestions(questions, { fixLatex = null } = {}) {
  const errors = [], warnings = [];
  const out = [];
  const seen = new Set();
  (Array.isArray(questions) ? questions : []).forEach((q, i) => {
    const ref = `întrebarea ${i + 1}`;
    if (!q || typeof q !== 'object' || String(q.statement || '').trim().length < 6) { errors.push(`${ref}: enunț gol`); return; }
    const key = normStatement(q.statement).slice(0, 140);
    if (key.length > 20 && seen.has(key)) { errors.push(`${ref}: enunț duplicat`); return; }
    seen.add(key);
    const item = { ...q };
    if (Array.isArray(item.options)) {
      const opts = item.options.map((o) => String(o ?? '').trim());
      if (opts.length < 2 || opts.length > 6) { errors.push(`${ref}: ${opts.length} variante`); return; }
      if (new Set(opts.map((o) => o.replace(/\s+/g, '').toLowerCase())).size !== opts.length) { errors.push(`${ref}: variante duplicate`); return; }
      if (!Number.isInteger(item.answer) || item.answer < 0 || item.answer >= opts.length) { errors.push(`${ref}: răspunsul nu indică o variantă`); return; }
      item.options = opts;
    } else if (!String(item.answer ?? '').trim()) { errors.push(`${ref}: fără răspuns`); return; }
    // LaTeX
    for (const f of ['statement', 'explanation']) {
      if (typeof item[f] !== 'string' || !item[f]) continue;
      let bad = badLatex(item[f]);
      if (bad.length && fixLatex) { const fixed = fixLatex(item[f]); if (!badLatex(fixed).length) { item[f] = fixed; bad = []; } }
      if (bad.length) warnings.push(`${ref} ${f}: LaTeX nerandabil: ${bad[0].slice(0, 40)}`);
    }
    if (Array.isArray(item.options)) {
      item.options = item.options.map((o) => { const b = badLatex(o); if (b.length && fixLatex) { const f = fixLatex(o); if (!badLatex(f).length) return f; } if (b.length) warnings.push(`${ref} varianta: LaTeX nerandabil`); return o; });
    }
    out.push(item);
  });
  return { ok: errors.length === 0, errors, warnings, questions: out };
}

module.exports = { validateExam, validateQuestions, badLatex, mathSegments, latexOk, normLetter, normStatement, FIGURE_TYPES };
