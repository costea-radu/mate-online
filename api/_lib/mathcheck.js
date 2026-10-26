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
const UNIT_RE = /(?<![a-zA-Zăâîșț])\s*(?:cm|dm|mm|km|m|kg|g|lei|ron|ore|ora|minute|min|secunde|sec|s|l|ml|grade|°|km\/h|m\/s|u\.?m\.?|unit[ăa][țt]i)(?:\^?[23]|[²³])?\s*$/i;

function stripWrappers(s) {
  return preLatex(String(s ?? ''))
    .replace(/\$\$?/g, ' ')                 // delimitatorii LaTeX
    .replace(/\\\(|\\\)|\\\[|\\\]/g, ' ')
    .replace(/\\left|\\right|\\,|\\;|\\!|\\quad|\\text\{[^}]*\}|\\mathrm\{([^}]*)\}/g, (m, g1) => (g1 != null ? g1 : ' '))
    .replace(/\\displaystyle/g, ' ')
    .trim();
}

// ─── TASTATURA MATEMATICĂ și RĂSPUNSUL SCRIS ÎN CUVINTE (26 oct. 2026) ─────────
// Elevul răspunde fie cu tastatura matematică (LaTeX, ca MathLive: \frac{1}{2},
// \sqrt[3]{8}, C_{5}^{2}, A_{5}^{2}, 60^{\circ}, \begin{pmatrix}…\end{pmatrix},
// \begin{vmatrix}…\end{vmatrix}, \vec{v}, \{1, 3\}, (2, 5], \infty, \pi…), fie ca TEXT:
// „radical din 2", „3 radical din 2", „1 supra 2", „x la pătrat", „2 la puterea 3",
// „minus infinit", „combinări de 5 luate câte 2", „60 de grade". Totul ajunge la aceeași
// expresie, comparată ca până acum (numeric / simbolic / mulțimi), plus intervalele
// (paranteza contează: „(2, 5]" ≠ „(2, 5)") și matricele (element cu element).

// notații LaTeX / unicode → forma de lucru, ÎNAINTE de restul (acoladele de mulțime, |x|,
// gradele, operatorii numiți, virgula zecimală a tastaturii „2{,}5")
function preLatex(s) {
  let t = String(s ?? '');
  if (!t) return t;
  t = t.replace(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g, ' ')            // căsuțe goale (MathLive)
    .replace(/\{,\}/g, ',').replace(/\{\.\}/g, '.')
    .replace(/\\lbrace|\\\{/g, '{').replace(/\\rbrace|\\\}/g, '}')
    .replace(/\\left\s*\\?\{/g, '{').replace(/\\right\s*\\?\}/g, '}')
    .replace(/\\left\s*\.|\\right\s*\./g, ' ')
    .replace(/\\(?:left|right)?\\?(?:[lr]?vert|mid)\b/g, '|').replace(/\\(?:left|right)\s*\|/g, '|')
    .replace(/\\operatorname\*?\{([^{}]*)\}/g, ' $1 ')
    .replace(/\\mathbb\{([A-Za-z])\}/g, '$1').replace(/\\mathrm\{d\}/g, 'd')
    .replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ\b|\\degree\b|°/g, '°')         // gradele (se taie ca unitate)
    .replace(/\\%/g, '%')
    .replace(/\\cfrac/g, '\\frac')
    .replace(/\\(?:overrightarrow|vec|overline)\s*\{\s*([A-Za-z]{1,3}\d?)\s*\}/g, ' vec_$1 ')
    .replace(/\\vec\s+([A-Za-z])/g, ' vec_$1 ')
    .replace(/([A-Za-z]{1,3}\d?)⃗/g, ' vec_$1 ')                         // „v⃗", „AB⃗" (săgeata combinată)
    .replace(/∛\s*\(([^()]*)\)/g, 'nthRoot(($1),(3))').replace(/∛\s*(\d+(?:[.,]\d+)?|[a-zA-Z])/g, 'nthRoot(($1),(3))')
    .replace(/∜\s*\(([^()]*)\)/g, 'nthRoot(($1),(4))').replace(/∜\s*(\d+(?:[.,]\d+)?|[a-zA-Z])/g, 'nthRoot(($1),(4))');
  return t;
}

// matricele (\begin{pmatrix} 1 & 2 \\ 3 & 4 \end{pmatrix}) → [[1, 2], [3, 4]];
// determinantul (\begin{vmatrix}…\end{vmatrix}) → det([[…]]). Celulele rămân LaTeX
// (le transformă restul lui latexToExpr); separatorul „, " nu e confundat cu virgula zecimală.
const MATRIX_RE = /\\begin\{([pbBvV]?matrix|array)\}(?:\{[^{}]*\})?([\s\S]*?)\\end\{\1\}/g;
function matricesToExpr(t) {
  return String(t).replace(MATRIX_RE, (m, env, body) => {
    const rows = body.split(/\\\\|\\cr\b/).map((r) => r.trim()).filter(Boolean).map((r) => r.split('&').map((c) => c.trim() || '0'));
    if (!rows.length) return ' ';
    const lit = `[${rows.map((r) => `[${r.join(', ')}]`).join(', ')}]`;
    return env === 'vmatrix' || env === 'Vmatrix' ? ` det(${lit}) ` : ` ${lit} `;
  });
}
const hasMatrix = (s) => /\\begin\{[pbBvV]?matrix\}/.test(String(s || ''));

// ─── răspunsul în CUVINTE → notație ────────────────────────────────────────────
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const NUM_WORDS = { zero: 0, unu: 1, unul: 1, una: 1, doi: 2, doua: 2, trei: 3, patru: 4, cinci: 5, sase: 6, sapte: 7, opt: 8, noua: 9, zece: 10, unsprezece: 11, doisprezece: 12, douasprezece: 12, douazeci: 20, suta: 100 };
const ORDINALS = { doua: 2, treia: 3, patra: 4, cincea: 5, sasea: 6, saptea: 7, opta: 8, noua: 9, zecea: 10 };
const FRACTION_WORDS = [
  [/\b(?:o\s+)?jumatate\b|\bo\s+doime\b/g, '(1/2)'], [/\bo\s+treime\b/g, '(1/3)'], [/\bdoua\s+treimi\b/g, '(2/3)'],
  [/\bun\s+sfert\b|\bo\s+patrime\b/g, '(1/4)'], [/\btrei\s+sferturi\b/g, '(3/4)'],
];
// vocabularul care arată că răspunsul e scris în cuvinte (altfel nu atingem nimic)
const WORDS_RE = /\b(radical|rad|supra|puterea|patrat|cub|ori|inmultit|impartit|plus|minus|infinit|modul|modulul|combinari|aranjamente|permutari|factorial|logaritm|log|grade|virgula|jumatate|doime|treime|sfert|sferturi|egal|pi|vida|zero|unu|doi|doua|trei|patru|cinci|sase|sapte|opt|noua|zece|la\s+a)\b/;
// operandul de după „din" / „puterea": (grup) | număr | literă | funcție(…)
const OPERAND = String.raw`(\((?:[^()]|\([^()]*\))*\)|-?\d+(?:[.,]\d+)?|[a-z](?:_\w+)?|pi|∞)`;

function wordsToMath(raw) {
  const src = String(raw ?? '');
  if (src.length > 160 || /\\[a-zA-Z]/.test(src)) return src;        // LaTeX sau o frază lungă: nu e în cuvinte
  let t = fold(src);
  if (!WORDS_RE.test(t)) return src;
  for (const [re, v] of FRACTION_WORDS) t = t.replace(re, v);
  t = t.replace(/(\d)\s*virgula\s*(\d)/g, '$1,$2');
  // „la a doua" / „la a n-a" → ^2 / ^n (înaintea numerelor în cuvinte: „doua" e aici ordinal)
  t = t.replace(/\bla\s+a\s+(doua|treia|patra|cincea|sasea|saptea|opta|noua|zecea)\b/g, (m, w) => `^${ORDINALS[w]}`)
    .replace(/\bla\s+a\s+([a-z0-9]+)\s*-?\s*a\b/g, '^$1');
  // numerele în cuvinte, ca cuvinte întregi
  t = t.replace(/\b(zero|unu|unul|una|doi|doua|trei|patru|cinci|sase|sapte|opt|noua|zece|unsprezece|doisprezece|douasprezece|douazeci)\b/g, (m) => String(NUM_WORDS[m]));
  t = t.replace(/\b(plus\s+)?infinit\b/g, (m, p) => (p ? '+∞' : '∞')).replace(/\bminus\s+∞/g, '-∞')
    .replace(/\bmultimea\s+vida\b/g, '∅');
  t = t.replace(/\bminus\b/g, ' - ').replace(/\bplus\b/g, ' + ')
    .replace(/\b(?:inmultit\s+cu|ori)\b/g, ' * ')
    .replace(/\b(?:impartit\s+la|supra)\b/g, ' / ')
    .replace(/(\d|\))\s+pe\s+(\d|\()/g, '$1 / $2')
    .replace(/\begal\s+cu\b|\begal\b|\beste\s+egal\s+cu\b/g, ' = ');
  // radicalii: „radical de ordin(ul) 3 din 8", „radical din 2", „rad 2", „3 radical din 2"
  t = t.replace(new RegExp(String.raw`\b(?:radical|rad)\s+de\s+ordin(?:ul)?\s+([a-z0-9]+)\s+din\s+${OPERAND}`, 'g'), 'nthRoot(($2),($1))')
    .replace(new RegExp(String.raw`\b(?:radical|rad|sqrt)\s*(?:din\s+|de\s+)?${OPERAND}`, 'g'), '√($1)');
  // puterile: „x la pătrat", „x la cub", „2 la puterea 3", „la puterea - 1"
  t = t.replace(/\bla\s+patrat\b/g, '^2').replace(/\bla\s+cub\b/g, '^3')
    .replace(new RegExp(String.raw`\bla\s+puterea\s+(-\s*)?${OPERAND}`, 'g'), (m, neg, v) => `^(${neg ? '-' : ''}${v})`);
  // modulul, logaritmul, combinatorica
  t = t.replace(new RegExp(String.raw`\b(?:modul(?:ul)?\s+(?:din|lui|de)|valoarea\s+absoluta\s+a\s+lui)\s+${OPERAND}`, 'g'), 'abs($1)')
    .replace(new RegExp(String.raw`\blog(?:aritm(?:ul)?)?\s+(?:in|din|cu)\s+baza\s+${OPERAND}\s+(?:din|de|al\s+lui|a\s+lui)\s+${OPERAND}`, 'g'), 'log(($2),($1))')
    .replace(/\bcombinari\s+de\s+(\d+)\s+luate\s+cate\s+(\d+)\b/g, 'combinations(($1),($2))')
    .replace(/\baranjamente\s+de\s+(\d+)\s+luate\s+cate\s+(\d+)\b/g, 'permutations(($1),($2))')
    .replace(/\bpermutari\s+de\s+(\d+)\b/g, '($1)!').replace(/(\d+)\s+factorial\b/g, '($1)!');
  // gradele („60 de grade") — se taie ca unitate
  t = t.replace(/\s*(?:de\s+)?grade\b/g, '°');
  return t.replace(/\s+/g, ' ').trim();
}

// ─── intervalele: „(2, 5]", „[-1; 3)", „(-∞, 2] ∪ [5, +∞)" ──────────────────────
// → [{ lo, hi, loIn, hiIn }] sau null. Ambele capete trebuie să fie numere / ±∞.
function splitTop(s, seps) {
  const out = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if ('([{'.includes(ch)) depth++;
    else if (')]}'.includes(ch)) depth--;
    if (depth === 0 && seps.includes(ch)) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}
function intervalValue(e) {
  const t = String(e || '').trim().replace(/^\+/, '');
  if (/^(?:∞|Infinity)$/.test(t)) return Infinity;
  if (/^-\s*(?:∞|Infinity)$/.test(t)) return -Infinity;
  return tryNumber(decimalComma(latexToExpr(t), false));
}
function parseIntervals(raw) {
  let t = stripWrappers(String(raw ?? '')).replace(/\\infty/g, '∞').replace(/\\cup|∪|\s+U\s+/g, '∪').trim();
  t = t.replace(/^\s*[A-Za-z]{1,3}\s*(?:=|∈|\\in\b)\s*/, '');      // „x ∈ (0, 2]", „S = …"
  if (!t || !/^[[(\]]/.test(t)) return null;
  const pieces = t.split('∪').map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const p of pieces) {
    const m = /^([[(\]])([\s\S]*)([\])[])$/.exec(p);
    if (!m) return null;
    const inner = m[2];
    let parts = splitTop(inner, [';']);
    if (parts.length !== 2) {
      parts = splitTop(inner, [',']);
      // „2,5" fără spațiu poate fi și zecimală — dar într-o paranteză cu exact 2 bucăți e un interval
      if (parts.length !== 2) return null;
    }
    const lo = intervalValue(parts[0]), hi = intervalValue(parts[1]);
    if (lo == null || hi == null || !(lo <= hi)) return null;
    out.push({ lo, hi, loIn: m[1] === '[' && Number.isFinite(lo), hiIn: m[3] === ']' && Number.isFinite(hi) });
  }
  return out.length ? out : null;
}
// „(3; 1)", „M(2, -1)", „(x, y) = (2, 3)" → ['3', '1'] (expresii), sau null
function parseTuple(raw) {
  let t = stripWrappers(String(raw ?? '')).trim();
  t = t.replace(/^\s*\(\s*[a-z]\s*[,;]\s*[a-z]\s*\)\s*=\s*/i, '').replace(/^\s*[A-Z]\s*(?=\()/, '');
  const m = /^\(([\s\S]*)\)$/.exec(t);
  if (!m || !wrapsAll(t)) return null;
  let parts = splitTop(m[1], [';']);
  if (parts.length < 2) parts = splitTop(m[1], [',']);
  if (parts.length < 2 || parts.length > 4 || parts.some((p) => !p)) return null;
  return parts.map((p) => decimalComma(latexToExpr(p), false).trim());
}
const sameNum = (a, b) => (a === b) || (Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) <= REL_TOL * Math.max(1, Math.abs(a), Math.abs(b)));
function intervalsEqual(A, B) {
  if (A.length !== B.length) return false;
  const key = (x) => [x.lo, x.hi];
  const sa = A.slice().sort((x, y) => key(x)[0] - key(y)[0]), sb = B.slice().sort((x, y) => key(x)[0] - key(y)[0]);
  return sa.every((x, i) => sameNum(x.lo, sb[i].lo) && sameNum(x.hi, sb[i].hi) && x.loIn === sb[i].loIn && x.hiIn === sb[i].hiIn);
}

// forma „simplă" a unui răspuns LaTeX — cum l-ar scrie elevul fără tastatură:
// „\frac{1}{2}" → „1/2", „2\sqrt{3}" → „2√3", „x^{2}+1" → „x^2+1", „\{1, 3\}" → „{1; 3}"
// (botul de verificare: răspunsul corect scris simplu trebuie să fie primit)
function plainForm(latex) {
  let t = String(latex ?? '').replace(/\$/g, '').trim();
  if (!t) return '';
  t = preLatex(t);
  for (let i = 0; i < 6; i++) {
    const prev = t;
    t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (m, a, b) => {
      const wrap = (x) => (/^[\w.,√π]+$/.test(x.trim()) ? x.trim() : `(${x.trim()})`);
      return `${wrap(a)}/${wrap(b)}`;
    })
      .replace(/\\sqrt\s*\[\s*3\s*\]\s*\{([^{}]*)\}/g, (m, x) => (/^[\w.,]+$/.test(x.trim()) ? `∛${x.trim()}` : `∛(${x.trim()})`))
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, '($2)^(1/($1))')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, (m, x) => (/^[\w.,]+$/.test(x.trim()) ? `√${x.trim()}` : `√(${x.trim()})`));
    if (t === prev) break;
  }
  t = t.replace(/\^\s*\{([^{}]*)\}/g, (m, x) => (/^[\w.]+$/.test(x.trim()) ? `^${x.trim()}` : `^(${x.trim()})`))
    .replace(/_\s*\{([^{}]*)\}/g, '_$1')
    .replace(/\\cdot|\\times/g, '·').replace(/\\pi/g, 'π').replace(/\\infty/g, '∞')
    .replace(/\\left|\\right/g, '').replace(/\\[,;!]|\\quad/g, ' ')
    .replace(/\\le(?:q)?\b/g, '≤').replace(/\\ge(?:q)?\b/g, '≥').replace(/\\ne(?:q)?\b/g, '≠')
    .replace(/\\in\b/g, '∈').replace(/\\cup\b/g, '∪').replace(/\\cap\b/g, '∩').replace(/\\emptyset|\\varnothing/g, '∅')
    .replace(/\\ln\b/g, 'ln').replace(/\\log\b/g, 'log').replace(/\\(sin|cos|tg|ctg|tan|cot)\b/g, '$1')
    .replace(/\\text\{([^{}]*)\}/g, '$1');
  // mulțimile cu „;" (virgula ar putea fi citită zecimală)
  if (/^\{[^{}]*\}$/.test(t.trim())) t = `{${t.trim().slice(1, -1).split(/\s*[,;]\s*/).join('; ')}}`;
  return t.replace(/\s+/g, ' ').trim();
}

// combinatorica: C_{n}^{k} / C_n^k / C^{k}_{n} → combinations(n, k), A_{n}^{k} → permutations(n, k)
// (aranjamente), P_{n} → factorial(n), \binom{n}{k} → combinations(n, k)
const SUBSUP = String.raw`(?:_\s*(?:\{([^{}]+)\}|(\w))\s*\^\s*(?:\{([^{}]+)\}|(\w))|\^\s*(?:\{([^{}]+)\}|(\w))\s*_\s*(?:\{([^{}]+)\}|(\w)))`;
function combinatorics(t) {
  return String(t)
    .replace(/\\binom\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, 'combinations(($1),($2))')
    .replace(new RegExp(String.raw`(?<![A-Za-z\\])([CA])\s*${SUBSUP}`, 'g'), (m, L, a1, a2, a3, a4, b1, b2, b3, b4) => {
      // forma _n^k: (jos, sus); forma ^k_n: (sus, jos)
      const subFirst = a1 != null || a2 != null;
      const n = subFirst ? (a1 ?? a2) : (b3 ?? b4);
      const k = subFirst ? (a3 ?? a4) : (b1 ?? b2);
      return `${L === 'C' ? 'combinations' : 'permutations'}((${n}),(${k}))`;
    })
    .replace(/(?<![A-Za-z\\])P\s*_\s*(?:\{([^{}]+)\}|(\w))/g, (m, a, b) => `factorial((${a ?? b}))`);
}
// logaritmii cu bază: \log_{2}{8}, \log_2 8, log_2(8), log2 8 → log((8),(2))
function logBases(t) {
  return String(t)
    .replace(/\\log\s*_\s*(?:\{([^{}]+)\}|(\w+))\s*(?:\{([^{}]+)\}|\\left\s*\(([^()]+)\\right\s*\)|\(([^()]+)\)|(-?\d+(?:[.,]\d+)?|[a-zA-Z]))/g,
      (m, b1, b2, x1, x2, x3, x4) => `log((${x1 ?? x2 ?? x3 ?? x4}),(${b1 ?? b2}))`)
    .replace(/(?<![a-zA-Z\\])log\s*_?\s*(\d+)\s*(?:\(([^()]+)\)|(\d+(?:[.,]\d+)?|[a-zA-Z]))/g, (m, b, x1, x2) => `log((${x1 ?? x2}),(${b}))`);
}

// transformă notațiile LaTeX / unicode în sintaxă mathjs
function latexToExpr(s) {
  let t = logBases(combinatorics(matricesToExpr(stripWrappers(s))));
  // |x| → abs(x) (modulul; fără imbricări)
  for (let i = 0; i < 3 && t.includes('|'); i++) t = t.replace(/\|([^|]+)\|/g, 'abs($1)');
  // operațiile cu mulțimi și logica rămân simboluri (comparate ca text): ∩ ∪ ∅ ⇒ ⇔ ⊂ ∉
  t = t.replace(/\\cap\b/g, '∩').replace(/\\cup\b/g, '∪').replace(/\\emptyset|\\varnothing/g, '∅')
    .replace(/\\Rightarrow|\\implies|\\Longrightarrow/g, '⇒').replace(/\\Leftrightarrow|\\iff/g, '⇔')
    .replace(/\\subseteq|\\subset/g, '⊂').replace(/\\notin/g, '∉');
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
    // exponenții și indicii dinăuntru („\sqrt{x^{2}+1}"), ca acoladele lor să nu blocheze radicalul
    t = t.replace(/\^\s*\{([^{}]*)\}/g, '^($1)').replace(/_\s*\{([^{}]*)\}/g, '_$1');
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
    .replace(/\\(sin|cos|tan|cot|arcsin|arccos|arctan|exp|det)\b/g, '$1')        // \det\left(…\right) → det(…)
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
function splitList(raw, { set = false } = {}) {
  let t = raw.trim();
  if (wrapsAll(t)) t = t.slice(1, -1).trim();
  const parts = t.split(/\s*(?:;|(?<![\wăâîșț])(?:și|si|sau|or|and)(?![\wăâîșț]))\s*/i).map((p) => p.trim()).filter(Boolean);
  // virgulele sunt separatori doar dacă nu arată a zecimale: „2, 3" (spațiu după) sau „2,3,4";
  // într-o mulțime scrisă cu acolade, fără „;" („{1,3}"), virgula desparte elementele
  const out = [];
  const commaSplits = set && parts.length === 1;
  for (const p of parts) {
    if (commaSplits && /,/.test(p)) out.push(...p.split(/\s*,\s*/));
    else if (/^-?\d+(?:,\d+)+$/.test(p) && p.split(',').length > 2) out.push(...p.split(','));
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
// (răspunsul scris în cuvinte — „radical din 2", „1 supra 2" — trece întâi prin wordsToMath)
function normalizeAnswer(raw) {
  const str = wordsToMath(String(raw ?? '').trim());
  const percent = /%/.test(str.replace(/\\%/g, '%'));
  // o matrice / un determinant nu e o listă de valori (acoladele, „&", „\\")
  // … nici scrisă ca text: „[[1, 2], [3, 4]]", „det([[1, 2], [3, 4]])" (forma „Abc" a tastaturii)
  const list = !hasMatrix(str) && !/^\s*(?:det\s*\(\s*)?\[\s*\[/.test(str) && isListLike(preLatex(str));
  // o mulțime scrisă cu acolade („{1,3}", „S = \{1, 3\}"): virgula desparte elementele
  const set = list && /^\s*(?:[A-Za-z]{1,3}\s*(?:=|∈|\\in\b)\s*)?\{[^{}]*\}\s*$/.test(preLatex(str).replace(/\$/g, ''));
  let t = latexToExpr(str.replace(/%/g, ''));
  t = stripUnit(t);
  t = stripLhs(t); // „x ∈ {1, 2}" → „{1, 2}" (înainte de împărțirea în elemente)
  const parts = list ? splitList(t, { set }).map((p) => decimalComma(stripUnit(p), false)) : null;
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
      const known = ['pi', 'e', 'Infinity', 'sqrt', 'nthRoot', 'sin', 'cos', 'tan', 'cot', 'log', 'log10', 'exp', 'abs', 'arcsin', 'arccos', 'arctan', 'asin', 'acos', 'atan', 'combinations', 'permutations', 'factorial', 'det'];
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

// valoarea unei expresii cu ±∞ („+Infinity", „-Infinity") — tryNumber le lasă deoparte
function tryInfinite(expr) {
  try { const v = math.evaluate(expr); return typeof v === 'number' && !Number.isNaN(v) && !Number.isFinite(v) ? v : null; }
  catch { return null; }
}
// matricele (tastatura: \begin{pmatrix}…) → tablouri de numere, sau null
function tryMatrix(expr) {
  if (!/\[/.test(String(expr || ''))) return null;
  try {
    const v = math.evaluate(expr);
    const arr = v && typeof v.toArray === 'function' ? v.toArray() : Array.isArray(v) ? v : null;
    if (!arr || !arr.length) return null;
    const rows = Array.isArray(arr[0]) ? arr : [arr];
    const nums = rows.map((r) => r.map((x) => Number(x && typeof x.valueOf === 'function' ? x.valueOf() : x)));
    return nums.every((r) => r.every((x) => Number.isFinite(x))) ? nums : null;
  } catch { return null; }
}

// două expresii (fără „=") sunt echivalente?
function exprEquivalent(ea, eb) {
  if (!ea || !eb) return null;
  if (ea === eb) return true;
  // matricele: aceeași formă, element cu element
  const ma = tryMatrix(ea), mb = tryMatrix(eb);
  if (ma || mb) {
    if (!ma || !mb) return false;
    if (ma.length !== mb.length || ma.some((r, i) => r.length !== mb[i].length)) return false;
    return ma.every((r, i) => r.every((x, j) => nearly(x, mb[i][j])));
  }
  // ±∞ („+∞" = „∞" = „infinit")
  const ia = tryInfinite(ea), ib = tryInfinite(eb);
  if (ia != null || ib != null) return ia != null && ib != null ? ia === ib : false;
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

const KNOWN_FN = /(?<![a-zA-Z])(?:sqrt|nthRoot|sin|cos|tan|cot|log|log10|exp|abs|arcsin|arccos|arctan|asin|acos|atan|pi|Infinity|in|combinations|permutations|factorial|det|vec_[A-Za-z0-9]+)(?![a-zA-Z])/g;
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
  // intervalele (și reuniunile lor): capetele ȘI parantezele — „(2, 5]" ≠ „(2, 5)"
  const IA = parseIntervals(A.raw), IB = parseIntervals(B.raw);
  if (IA && IB) return intervalsEqual(IA, IB);
  // perechile ordonate („M(3; 1)", soluția (x, y) a unui sistem): în ordine, nu ca mulțime
  const TA = parseTuple(A.raw), TB = parseTuple(B.raw);
  if (TA && TB) {
    if (TA.length !== TB.length) return false;
    return TA.every((x, i) => x === TB[i] || exprEquivalent(x, TB[i]) === true);
  }
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
  // vectorii scriși fără săgeată („2i + 3j" pentru 2\vec{i} + 3\vec{j}): aceeași scriere
  if (r !== true && /vec_/.test(A.expr) !== /vec_/.test(B.expr)) {
    const plainVec = (e) => flat(e.replace(/vec_([A-Za-z0-9]+)/g, '$1').replace(/\*/g, ''));
    if (plainVec(A.expr) === plainVec(B.expr)) return true;
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

// ─── Evaluare sigură pentru unealta calculate (tool calling, Etapa 3) ─────────
// Acceptă sintaxă mathjs SAU scriere românească/LaTeX (trece prin latexToExpr
// când parsarea directă eșuează). Întoarce { result, exact? } sau { error }.
function evaluateExpr(expression) {
  const raw = String(expression || '').trim();
  if (!raw) return { error: 'expresie goală' };
  if (raw.length > MAX_EXPR) return { error: 'expresie prea lungă' };
  const candidates = [raw, decimalComma(latexToExpr(raw), false)];
  let lastErr = null;
  for (const expr of candidates) {
    try {
      const v = math.evaluate(expr);
      if (v === undefined) continue;
      if (typeof v === 'function') return { error: 'expresia nu are valoare' };
      const str = math.format(v, { precision: 12 });
      let exact = null;
      if (typeof v === 'number' && Number.isFinite(v) && !Number.isInteger(v)) {
        try {
          const f = math.fraction(v); // fraction.js v5: n/d pot fi BigInt
          const n = Number(f.n), d = Number(f.d), sgn = Number(f.s) < 0 ? '-' : '';
          if (d > 1 && d <= 10000 && Math.abs(n / d - v) < 1e-9) exact = `${sgn}${n}/${d}`;
        } catch { /* nu e raționabil */ }
      }
      return { result: str, ...(exact ? { exact } : {}) };
    } catch (e) { lastErr = e; }
  }
  return { error: `nu pot evalua: ${String(lastErr && lastErr.message || 'sintaxă').slice(0, 120)}` };
}

module.exports = { answersEquivalent, numericVerdict, normalizeAnswer, latexToExpr, exprEquivalent, evaluateExpr, BROWSER_ANS_EQ,
  // tastatura matematică / răspunsul în cuvinte (26 oct. 2026)
  wordsToMath, preLatex, matricesToExpr, parseIntervals, plainForm };
