// =====================================================================
// api/_lib/mathcheck.js — ECHIVALENȚA MATEMATICĂ a două răspunsuri
// (Etapa 2 din AUDIT_AGENTI_AI.md, punctul 1.3)
//
// Până acum răspunsurile se comparau ca TEXT: „1/2" ≠ „0,5", „x=3" ≠ „3",
// „2√3" ≠ „2\sqrt{3}", „24 cm²" ≠ „24" — greșeli false care intrau în jurnalul
// de greșeli și în stăpânire. Aici:
//   1. normalizăm scrierea românească + LaTeX la o expresie pe care o înțelege
//      mathjs (virgulă zecimală, \frac, \sqrt, √, π, unități, „x =", mulțimi);
//   2. comparăm NUMERIC (toleranță relativă) sau, cu variabile, prin evaluare
//      în mai multe puncte aleatoare (a − b ≡ 0);
//   3. mulțimile/listele de soluții se compară ca multiseturi;
//   4. la orice incertitudine cădem pe egalitatea textului normalizat.
// Folosit de: corectarea deterministă din meditații, pre-verificarea din
// antrenament, verificatorul independent (verify.js) și setul de evaluare.
// =====================================================================
const { create, all } = require('mathjs');
const math = create(all, { number: 'number' });
// fără funcții periculoase (nu evaluăm nimic din afara expresiilor matematice)
math.import({
  import: () => { throw new Error('nu'); }, createUnit: () => { throw new Error('nu'); },
}, { override: true });
const MAX_EXPR = 300; // expresii mai lungi nu sunt răspunsuri, ci text — nu le evaluăm

const REL_TOL = 1e-6;

// ─── Normalizare ─────────────────────────────────────────────────────────────
// unitatea e despărțită de număr (nu tăiem „l" din „isoscel")
const UNIT_RE = /(?<![a-zA-Zăâîșț])\s*(?:cm|dm|mm|km|m|kg|g|lei|ron|ore|ora|minute|min|secunde|sec|s|l|ml|grade|km\/h|m\/s|u\.?m\.?|unit[ăa][țt]i)(?:\^?[23]|[²³])?\s*$/i;

function stripWrappers(s) {
  return String(s ?? '')
    .replace(/\$\$?/g, ' ')                 // delimitatorii LaTeX
    .replace(/\\\(|\\\)|\\\[|\\\]/g, ' ')
    .replace(/\\left|\\right|\\,|\\;|\\!|\\quad|\\text\{[^}]*\}|\\mathrm\{([^}]*)\}/g, (m, g1) => (g1 != null ? g1 : ' '))
    .replace(/\\displaystyle/g, ' ')
    .trim();
}

// transformă notațiile LaTeX / unicode în sintaxă mathjs
function latexToExpr(s) {
  let t = stripWrappers(s);
  // \frac{a}{b}, \dfrac{a}{b}, \sqrt[n]{x}, \sqrt{x}, \sqrt x, √(x), √x —
  // din interior spre exterior (imbricate): repetăm cât timp se mai schimbă ceva
  for (let i = 0, prev = null; i < 8 && prev !== t; i++) {
    prev = t;
    t = t.replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, 'nthRoot(($2),($1))');
    t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)');
    t = t.replace(/\\sqrt\s*(\d+(?:[.,]\d+)?|[a-zA-Z])/g, 'sqrt($1)');
    t = t.replace(/√\s*\(([^()]*)\)/g, 'sqrt($1)');
    t = t.replace(/√\s*(\d+(?:[.,]\d+)?|[a-zA-Z])/g, 'sqrt($1)');
    t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))');
    t = t.replace(/\\[dt]?frac\s*(\d)(\d)/g, '(($1)/($2))'); // \frac32
  }
  t = t
    .replace(/−|–/g, '-')                 // minus unicode / en-dash → minus
    .replace(/\\cdot|\\times|×|·|⋅/g, '*')
    .replace(/\\div|÷|:(?=\s*\d)/g, '/')
    .replace(/\\pi|π/g, 'pi')
    .replace(/\\infty|∞/g, 'Infinity')
    .replace(/\\pm|±/g, '+')            // a ± b → se tratează la mulțimi; altfel „+"
    .replace(/\\le(?:q)?|≤/g, '<=').replace(/\\ge(?:q)?|≥/g, '>=').replace(/\\ne(?:q)?|≠/g, '!=')
    .replace(/\\in\b|∈/g, ' in ')
    .replace(/\\?\bln\b/g, 'log').replace(/\\?\blg\b/g, 'log10').replace(/\\log\b/g, 'log10')
    .replace(/\\?\btg\b/g, 'tan').replace(/\\?\bctg\b/g, 'cot')
    .replace(/\\(sin|cos|tan|cot|arcsin|arccos|arctan|exp)\b/g, '$1')
    // „ln 2", „sin x" → log(2), sin(x) (mathjs cere paranteze)
    .replace(/\b(log10|log|sin|cos|tan|cot|sqrt|exp)\s+(-?\d+(?:[.,]\d+)?|[a-zA-Z])(?![a-zA-Z(])/g, '$1($2)')
    .replace(/\^\s*\{([^{}]*)\}/g, '^($1)')
    .replace(/_\s*\{([^{}]*)\}/g, '_$1')
    .replace(/\{|\}/g, (m) => (m === '{' ? '(' : ')'))
    .replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/\\[a-zA-Z]+/g, ' ')        // orice altă comandă LaTeX rămasă
    .replace(/\s+/g, ' ').trim();
  return t;
}

// „x = 3", „x ∈ {3}", „S = {…}", „x1 = 2" → partea din dreapta
function stripLhs(t) {
  const m = /^\s*[A-Za-z][A-Za-z0-9_]{0,3}\s*(?:=|∈|\bin\b)\s*(.+)$/.exec(t);
  return m ? m[1].trim() : t;
}

// virgula zecimală românească: „3,5" → „3.5" — dar nu în liste „{2, 3}" / „2; 3"
function decimalComma(t, isList) {
  if (isList) return t;
  return t.replace(/(\d),(\d)/g, '$1.$2');
}

// elimină unitatea de măsură de la final („24 cm²", „150 lei", „3 ore")
function stripUnit(t) {
  let prev = null, cur = t;
  while (prev !== cur) { prev = cur; cur = cur.replace(UNIT_RE, ''); }
  return cur.trim();
}

// împarte o listă/mulțime de valori: „{2; 3}", „2 și 3", „x1=2, x2=3"
// parantezele exterioare se scot doar dacă închid TOT („(1)/(2) + (1)/(3)" nu e „(…)")
function wrapsAll(t) {
  const open = t[0], close = t[t.length - 1];
  if (!'{(['.includes(open) || !'})]'.includes(close)) return false;
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if ('{(['.includes(c)) depth++;
    else if ('})]'.includes(c)) { depth--; if (depth === 0 && i < t.length - 1) return false; }
  }
  return depth === 0;
}
function splitList(raw) {
  let t = raw.trim();
  if (wrapsAll(t)) t = t.slice(1, -1).trim();
  const parts = t.split(/\s*(?:;|(?<![\wăâîșț])(?:și|si|sau|or|and)(?![\wăâîșț]))\s*/i).map((p) => p.trim()).filter(Boolean);
  // virgulele sunt separatori doar dacă nu arată a zecimale: „2, 3" (spațiu după) sau „2,3,4"
  const out = [];
  for (const p of parts) {
    if (/^-?\d+(?:,\d+)+$/.test(p) && p.split(',').length > 2) out.push(...p.split(','));
    else if (/,\s/.test(p)) out.push(...p.split(/,\s+/));
    else out.push(p);
  }
  return out.map((p) => stripLhs(p.trim())).filter(Boolean);
}

function isListLike(raw) {
  let t = String(raw || '');
  // acoladele comenzilor LaTeX (\frac{1}{2}, \sqrt{3}, x^{2}, a_{1}) NU sunt mulțimi
  for (let i = 0, prev = null; i < 6 && prev !== t; i++) {
    prev = t;
    t = t.replace(/\\[a-zA-Z]+\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}(?:\s*\{[^{}]*\})?/g, ' L ').replace(/\^\s*\{[^{}]*\}/g, ' P ').replace(/_\s*\{([^{}]*)\}/g, '_$1');
  }
  return /[{}\[\]]|;|(?<![\wăâîșț])(?:și|si|sau)(?![\wăâîșț])|\bx_?[12]\s*=|\d,\s+\d/i.test(t) && !/^\s*-?\d+,\d+\s*$/.test(t);
}

// Normalizarea completă a unui răspuns → { expr, parts, percent, raw }
function normalizeAnswer(raw) {
  const str = String(raw ?? '').trim();
  const percent = /%/.test(str);
  const list = isListLike(str);
  let t = latexToExpr(str.replace(/%/g, ''));
  t = stripUnit(t);
  t = stripLhs(t); // „x ∈ {1, 2}" → „{1, 2}" (înainte de împărțirea în elemente)
  const parts = list ? splitList(t).map((p) => decimalComma(stripUnit(p), false)) : null;
  t = decimalComma(t, false);
  t = stripUnit(t);
  return { expr: t, parts, percent, raw: str };
}

// ─── Evaluare ────────────────────────────────────────────────────────────────
function tryNumber(expr) {
  try {
    const v = math.evaluate(expr);
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v && typeof v === 'object' && typeof v.valueOf === 'function') {
      const n = Number(v.valueOf());
      if (Number.isFinite(n)) return n;
    }
  } catch { /* nu e numeric */ }
  return null;
}
function symbolsOf(node) {
  const out = new Set();
  node.traverse((n, path, parent) => {
    if (n.isSymbolNode) {
      const known = ['pi', 'e', 'Infinity', 'sqrt', 'nthRoot', 'sin', 'cos', 'tan', 'cot', 'log', 'log10', 'exp', 'abs', 'arcsin', 'arccos', 'arctan', 'asin', 'acos', 'atan'];
      if (!known.includes(n.name) && !(parent && parent.isFunctionNode && parent.fn === n)) out.add(n.name);
    }
  });
  return [...out];
}
const nearly = (a, b) => Math.abs(a - b) <= REL_TOL * Math.max(1, Math.abs(a), Math.abs(b));
// „0,7071" pentru √2/2, „3,14" pentru π: o zecimală scrisă cu d ≥ 2 cifre e
// acceptată ca ROTUNJIRE/TRUNCHIERE a valorii exacte (|a − b| < 10^-d).
// Întoarce numărul de zecimale dacă expresia e o zecimală simplă, altfel 0.
const decimalsOf = (expr) => { const m = /^\s*\(?\s*-?\d+\.(\d+)\s*\)?\s*$/.exec(String(expr || '')); return m ? m[1].length : 0; };
function roundedMatch(ea, eb, na, nb) {
  const da = decimalsOf(ea), db = decimalsOf(eb);
  if (!da && !db) return false;
  // „lit" = zecimala cu MAI PUȚINE cifre (cea scrisă aproximativ), „ex" = cealaltă
  const litIsA = da && (!db || da <= db);
  const d = litIsA ? da : db, lit = litIsA ? na : nb, ex = litIsA ? nb : na;
  if (d < 2) return false;
  const step = Math.pow(10, -d);
  if (Math.abs(lit - ex) <= step / 2 + 1e-12) return true;                 // rotunjire
  return Math.sign(lit) === Math.sign(ex) && Math.abs(ex) >= Math.abs(lit) && Math.abs(ex) - Math.abs(lit) < step - 1e-12; // trunchiere
}

// două expresii (fără „=") sunt echivalente?
function exprEquivalent(ea, eb) {
  if (!ea || !eb) return null;
  if (ea === eb) return true;
  const na = tryNumber(ea), nb = tryNumber(eb);
  if (na != null && nb != null) return nearly(na, nb) || roundedMatch(ea, eb, na, nb);
  if ((na == null) !== (nb == null)) {
    // una numerică, cealaltă cu variabile → nu pot fi egale decât dacă cealaltă e constantă
    return false;
  }
  // ambele cu variabile → evaluare în puncte aleatoare (deterministe)
  try {
    const pa = math.parse(ea), pb = math.parse(eb);
    const syms = [...new Set([...symbolsOf(pa), ...symbolsOf(pb)])];
    if (!syms.length) return null;
    const ca = pa.compile(), cb = pb.compile();
    const pts = [0.37, 1.91, -2.13, 3.7, 0.52, -0.81];
    let agree = 0, tested = 0;
    for (let i = 0; i < pts.length; i++) {
      const scope = {};
      syms.forEach((s, j) => { scope[s] = pts[(i + j * 2) % pts.length] + j * 0.11; });
      let va, vb;
      try { va = ca.evaluate(scope); vb = cb.evaluate(scope); } catch { continue; }
      if (typeof va !== 'number' || typeof vb !== 'number' || !Number.isFinite(va) || !Number.isFinite(vb)) continue;
      tested++;
      if (nearly(va, vb)) agree++;
    }
    if (tested < 3) return null;
    return agree === tested;
  } catch { return null; }
}

const KNOWN_FN = /(?<![a-zA-Z])(?:sqrt|nthRoot|sin|cos|tan|cot|log|log10|exp|abs|arcsin|arccos|arctan|asin|acos|atan|pi|Infinity|in)(?![a-zA-Z])/g;
const wordy = (s) => /[a-zA-Zăâîșț]{3,}/.test(String(s || '').replace(KNOWN_FN, ''));

// ─── API ─────────────────────────────────────────────────────────────────────
// answersEquivalent(a, b) → true | false | null (null = nu pot decide; apelantul
// cade pe altă metodă, ex. modelul)
function answersEquivalent(a, b) {
  const A = normalizeAnswer(a), B = normalizeAnswer(b);
  if (!A.raw || !B.raw) return null;
  const flat = (s) => s.replace(/\s+/g, '').toLowerCase();
  if (flat(A.raw) === flat(B.raw)) return true;
  // etichete de grilă („b", „B)", „c.") → se compară ca litere
  const lab = (s) => { const m = /^\s*([a-dA-D])\s*[).]?\s*$/.exec(s); return m ? m[1].toLowerCase() : null; };
  if (lab(A.raw) && lab(B.raw)) return lab(A.raw) === lab(B.raw);
  if (A.raw.length > MAX_EXPR || B.raw.length > MAX_EXPR) return null;
  if (flat(A.expr) === flat(B.expr) && A.expr) return true;
  // text (cuvinte, nu expresii): „triunghiul este isoscel" — nu decidem din text
  if (wordy(A.expr) || wordy(B.expr)) return null;
  // mulțimi / liste de soluții
  if (A.parts || B.parts) {
    const pa = A.parts || [A.expr], pb = B.parts || [B.expr];
    if (pa.length !== pb.length) return false;
    const used = new Array(pb.length).fill(false);
    for (const x of pa) {
      let hit = -1;
      for (let j = 0; j < pb.length; j++) {
        if (used[j]) continue;
        if (exprEquivalent(x, pb[j]) === true) { hit = j; break; }
      }
      if (hit === -1) return false;
      used[hit] = true;
    }
    return true;
  }
  let r = exprEquivalent(A.expr, B.expr);
  if (r === false && A.percent !== B.percent) {
    // „25%" vs „0,25": acceptăm ambele scrieri
    const na = tryNumber(A.expr), nb = tryNumber(B.expr);
    if (na != null && nb != null) {
      r = nearly(A.percent ? na / 100 : na, B.percent ? nb / 100 : nb) || nearly(na, nb);
    }
  }
  return r;
}

// Verdict numeric strict: true/false doar când AMBELE răspunsuri sunt numere
// (sau expresii numerice) — folosit ca „arbitru" peste verdictul modelului.
function numericVerdict(a, b) {
  const A = normalizeAnswer(a), B = normalizeAnswer(b);
  if (A.parts || B.parts) return null;
  const na = tryNumber(A.expr), nb = tryNumber(B.expr);
  if (na == null || nb == null) return null;
  if (A.percent !== B.percent) return null;
  if (nearly(na, nb)) return true;
  return roundedMatch(A.expr, B.expr, na, nb) ? null : false; // aproximare → decide modelul
}

// ─── Normalizatorul pentru BROWSER (HTML-ul generat: exgen, quizRender) ───────
// Versiune mică, fără mathjs: virgulă zecimală, spații, „x =", fracții a/b,
// √, unități, procente, mulțimi {a; b}. Ținută sincron cu src/lib/quizRender.js.
const BROWSER_ANS_EQ = `function ansEq(a,b){
  function num(s){ s=String(s||'').trim().replace(/\\((-?\\d+(?:\\.\\d+)?)\\)/g,'$1'); var m=/^(-?\\d+(?:\\.\\d+)?)\\s*\\/\\s*(-?\\d+(?:\\.\\d+)?)$/.exec(s); if(m){ var d=parseFloat(m[2]); return d?parseFloat(m[1])/d:NaN; } if(/^-?\\d+(?:\\.\\d+)?$/.test(s)) return parseFloat(s); var r=/^(-?\\d*(?:\\.\\d+)?)\\s*(?:sqrt|√)\\(?(\\d+(?:\\.\\d+)?)\\)?$/.exec(s); if(r){ var c=r[1]===''||r[1]==='-'?(r[1]==='-'?-1:1):parseFloat(r[1]); return c*Math.sqrt(parseFloat(r[2])); } return NaN; }
  function norm(s){ s=String(s||'').toLowerCase().replace(/\\$/g,'').replace(/\\\\(?:left|right|,|;|!)/g,'').replace(/\\\\(?:d)?frac\\{([^}]*)\\}\\{([^}]*)\\}/g,'($1)/($2)').replace(/\\\\sqrt\\{([^}]*)\\}/g,'sqrt($1)').replace(/\\\\cdot|×|·/g,'*').replace(/\\\\pi|π/g,'pi').replace(/²/g,'^2').replace(/³/g,'^3').replace(/\\^\\{([^}]*)\\}/g,function(m,g){ return /^[\\w.]+$/.test(g)?'^'+g:'^('+g+')'; }).replace(/%/g,'').replace(/(\\d)\\s*(cm|dm|mm|km|m|kg|g|lei|ron|ore|min|s|l)(\\^?[23])?\\s*$/,'$1').replace(/^\\s*[a-z][a-z0-9_]{0,3}\\s*(?:=|∈)\\s*/,'').replace(/(\\d),\\s+(?=[-\\d])/g,'$1;').replace(/(\\d),(\\d)/g,'$1.$2').replace(/\\s+/g,''); return s; }
  var A=norm(a), B=norm(b); if(A===B) return true;
  var set=function(s){ var m=/^[\\{\\[\\(](.*)[\\}\\]\\)]$/.exec(s); s=m?m[1]:s; return s.split(/;|și|si/).filter(Boolean).sort(); };
  if(/[;{]/.test(A)||/[;{]/.test(B)){ var sa=set(A), sb=set(B); if(sa.length!==sb.length) return false; for(var i=0;i<sa.length;i++){ var x=num(sa[i]), y=num(sb[i]); if(!(sa[i]===sb[i]||(!isNaN(x)&&!isNaN(y)&&Math.abs(x-y)<=1e-6*Math.max(1,Math.abs(x))))) return false; } return true; }
  var x=num(A), y=num(B); if(!isNaN(x)&&!isNaN(y)){ var pa=/%/.test(String(a)), pb=/%/.test(String(b)); var eq=function(u,v){ return Math.abs(u-v)<=1e-6*Math.max(1,Math.abs(u),Math.abs(v)); }; return eq(x,y)||(pa!==pb&&eq(pa?x/100:x, pb?y/100:y)); }
  return false;
}`;

module.exports = { answersEquivalent, numericVerdict, normalizeAnswer, latexToExpr, exprEquivalent, BROWSER_ANS_EQ };
