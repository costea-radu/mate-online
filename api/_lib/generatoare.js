// =====================================================================
// api/_lib/generatoare.js — GENERATOARE DE EXERCIȚII ÎN COD (fără model)
//
// Exercițiile de tip standard (calcule, ecuații, sisteme, procente, fracții,
// radicali, Pitagora, arii și volume, funcția liniară, progresii, logaritmi,
// combinatorică, determinanți, derivate, integrale…) au aceeași structură la
// fiecare elev — se schimbă doar numerele. Aici le facem în cod: numere alese la
// întâmplare (dar „frumoase"), rezultatul CALCULAT exact, rezolvarea pas cu pas
// și, la grile, variantele greșite luate din greșelile tipice. Cost 0, instant,
// fără verificator (rezultatul nu e ghicit de un model, e calculat).
//
// Folosite de med.genQuestions (api/_lib/meditatii.js) pentru seturile de
// exerciții la capitol, teme, recapitulări, „încă 10 de același fel" și testul
// inițial — DOAR la capitolele acoperite (CHAPTERS); restul (probleme cu text
// lung, demonstrații, capitolele fără generatoare) rămâne la model.
// PLAN_GENERATOARE_COD=0 le oprește (totul se generează cu modelul, ca înainte).
// =====================================================================
const crypto = require('node:crypto');

const enabled = () => process.env.PLAN_GENERATOARE_COD !== '0';

// ─── Numere aleatoare (cu sămânță, ca testele să fie reproductibile) ─────────
function rngFrom(seed) {
  let a = (seed == null ? crypto.randomBytes(4).readUInt32LE(0) : Number(seed)) >>> 0;
  const r = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  return {
    r, int,
    pick: (arr) => arr[Math.floor(r() * arr.length)],
    nz: (lo, hi) => { let v = 0; while (v === 0) v = int(lo, hi); return v; },
    shuffle: (arr) => { const x = arr.slice(); for (let i = x.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; },
  };
}

// ─── Aritmetică și scriere ───────────────────────────────────────────────────
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a || 1; };
const lcm = (a, b) => Math.abs(a * b) / gcd(a, b);
const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
const comb = (n, k) => Math.round(fact(n) / (fact(k) * fact(n - k)));
const arr = (n, k) => Math.round(fact(n) / fact(n - k));
// fracția redusă: { p, q } cu q > 0
function red(p, q) { if (q < 0) { p = -p; q = -q; } const g = gcd(p, q); return { p: p / g, q: q / g }; }
// fracția în LaTeX: „\frac{3}{4}", „-\frac{1}{2}", „5"
function fr(p, q = 1) { const f = red(p, q); if (f.q === 1) return `${f.p}`; return `${f.p < 0 ? '-' : ''}\\frac{${Math.abs(f.p)}}{${f.q}}`; }
// număr negativ între paranteze (în expresii)
const par = (x) => (String(x).startsWith('-') ? `(${x})` : `${x}`);
// k√m
const rad = (k, m) => (m === 1 ? `${k}` : `${k === 1 ? '' : k === -1 ? '-' : k}\\sqrt{${m}}`);
// zecimal cu virgulă: 2.75 → „2,75" (în LaTeX „2{,}75")
const decStr = (x) => String(Math.round(x * 1e6) / 1e6).replace('.', ',');
const decTex = (x) => decStr(x).replace(',', '{,}');
// termenul c·v într-o sumă: „ + 3x", „ - x", „ - 5"
function term(c, v, first) {
  if (!c) return '';
  const s = c < 0 ? (first ? '-' : ' - ') : (first ? '' : ' + ');
  const a = Math.abs(c);
  return s + (v ? (a === 1 ? v : `${a}${v}`) : `${a}`);
}
// polinomul din perechi [coeficient, variabilă]: [[2,'x^2'],[-3,'x'],[1,'']] → „2x^2 - 3x + 1"
function poly(parts) { let out = ''; for (const [c, v] of parts) out += term(c, v, out === ''); return out || '0'; }
const deg = (x) => `${x}^{\\circ}`;

// grilă: varianta corectă + greșelile tipice (distincte), amestecate
function grila(R, correct, wrongs, { math = true } = {}) {
  const opts = [];
  const add = (x) => { const s = String(x); if (s && !opts.includes(s) && opts.length < 4) opts.push(s); };
  add(correct);
  for (const w of wrongs) add(w);
  if (opts.length < 4) return null;
  const sh = R.shuffle(opts);
  return { options: sh.map((o) => (math ? `$${o}$` : o)), answer: sh.indexOf(String(correct)) };
}
const open = (statement, answer, explanation) => ({ statement, answer: String(answer), explanation });
const choice = (R, statement, correct, wrongs, explanation, opts) => {
  const g = grila(R, correct, wrongs, opts);
  return g ? { statement, ...g, explanation } : null;
};

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ș|ş/g, 's').replace(/ț|ţ/g, 't');
const has = (f, ...words) => words.every((w) => (w instanceof RegExp ? w.test(f) : f.includes(w)));
// formulele dintr-un enunț ($…$), ca semnele operațiilor să nu vină din text (ex. „Calculați:")
const mathOf = (f) => (String(f).match(/\$[^$]*\$/g) || []).join(' ');
// variabila ca simbol: x, 3x, (x — dar nu \max sau „exemplu"
const hasVar = (f, v = 'x') => new RegExp(`(^|[^a-z\\\\])${v}(?![a-z])`).test(mathOf(f) || f);

// ═════════════════════════════════════════════════════════════════════════════
// GENERATOARELE: { id, topic, match(f), make(R, nivel 1–3) → întrebare | null }
// `topic` = eticheta din programă (CURRICULUM, api/_lib/meditatii.js), ca
// stăpânirea pe subiecte (ai_skill_mastery) să se adune corect.
// `match` recunoaște un enunț de ACELAȘI TIP (pentru „încă 10 de același fel").
// ═════════════════════════════════════════════════════════════════════════════
const GEN = {};
function def(id, topic, match, make) { GEN[id] = { id, topic, match, make }; }

// ─── Clasa a 5-a ─────────────────────────────────────────────────────────────
def('ordinea-op', 'ordinea efectuării operațiilor',
  (f) => has(f, /calculat|efectuat/) && !hasVar(f) && !/[a-z]\s*=|\\frac|\\sqrt|,\d|\{,\}|\(-\d/.test(f),
  (R, lvl) => {
    if (lvl === 1) {
      const a = R.int(10, 60), b = R.int(2, 9), c = R.int(2, 9);
      return open(`Calculați: $${a} + ${b} \\cdot ${c}$.`, a + b * c,
        `Întâi înmulțirea: $${b} \\cdot ${c} = ${b * c}$, apoi adunarea: $${a} + ${b * c} = ${a + b * c}$.`);
    }
    if (lvl === 2) {
      const d = R.int(2, 9), k = R.int(2, 12), c = d * k, a = R.int(3, 12), b = R.int(3, 12);
      if (a * b <= k) return null;
      return open(`Calculați: $${a} \\cdot ${b} - ${c} : ${d}$.`, a * b - k,
        `Înmulțirea și împărțirea se fac înaintea scăderii: $${a} \\cdot ${b} = ${a * b}$, $${c} : ${d} = ${k}$, deci $${a * b} - ${k} = ${a * b - k}$.`);
    }
    const a = R.int(2, 15), b = R.int(2, 15), c = R.int(2, 6), d = R.int(2, 5), e = R.int(5, 15), f = R.int(1, 4);
    const v = (a + b) * c - d * (e - f);
    if (v <= 0) return null;
    return open(`Calculați: $(${a} + ${b}) \\cdot ${c} - ${d} \\cdot (${e} - ${f})$.`, v,
      `Parantezele întâi: $${a} + ${b} = ${a + b}$, $${e} - ${f} = ${e - f}$. Apoi înmulțirile: $${a + b} \\cdot ${c} = ${(a + b) * c}$, $${d} \\cdot ${e - f} = ${d * (e - f)}$. La final: $${(a + b) * c} - ${d * (e - f)} = ${v}$.`);
  });

def('puteri', 'puteri cu exponent natural',
  (f) => has(f, /putere|\^/) && !hasVar(f) && !/log|\\sqrt/.test(f),
  (R, lvl) => {
    const a = R.pick([2, 3, 5, 7]);
    if (lvl === 3) {
      const n = R.int(3, 9);
      return open(`Calculați: $\\left(2^{${n + 2}} + 2^{${n + 1}} + 2^{${n}}\\right) : 2^{${n}}$.`, 7,
        `Dăm factor comun $2^{${n}}$: $2^{${n}}(2^2 + 2 + 1) = 2^{${n}} \\cdot 7$, iar $2^{${n}} \\cdot 7 : 2^{${n}} = 7$.`);
    }
    const m = R.int(2, 7), n = R.int(2, 7);
    const p = R.int(1, m + n - 1);
    const k = lvl === 1 ? m + n - p : null;
    if (lvl === 1) {
      return open(`Scrieți ca putere a lui ${a}: $${a}^{${m}} \\cdot ${a}^{${n}} : ${a}^{${p}}$.`, `${a}^{${k}}`,
        `La înmulțire exponenții se adună, la împărțire se scad: $${a}^{${m} + ${n} - ${p}} = ${a}^{${k}}$.`);
    }
    const q = R.int(2, 3), s = R.int(1, m * q + n - 1);
    const e = m * q + n - s;
    return open(`Scrieți ca putere a lui ${a}: $(${a}^{${m}})^{${q}} \\cdot ${a}^{${n}} : ${a}^{${s}}$.`, `${a}^{${e}}`,
      `$(${a}^{${m}})^{${q}} = ${a}^{${m * q}}$; apoi $${a}^{${m * q} + ${n} - ${s}} = ${a}^{${e}}$.`);
  });

def('divizibilitate', 'criteriile de divizibilitate cu 2, 5, 10, 3, 9',
  (f) => has(f, /divizibil/) && has(f, /cifr|overline/),
  (R, lvl) => {
    if (lvl === 3) {
      // divizibil cu 3: câte cifre a
      const x = R.int(1, 9), y = R.int(0, 9);
      const ok = [];
      for (let a = 0; a <= 9; a++) if ((x + a + y) % 3 === 0) ok.push(a);
      return open(`Câte valori poate lua cifra $a$ astfel încât numărul $\\overline{${x}a${y}}$ să fie divizibil cu 3?`, ok.length,
        `Un număr e divizibil cu 3 când suma cifrelor lui este: $${x} + a + ${y} = ${x + y} + a$ trebuie să fie multiplu de 3, deci $a \\in \\{${ok.join(', ')}\\}$ — ${ok.length} valori.`);
    }
    let x, y, a;
    do { x = R.int(1, 9); y = R.int(0, 9); a = (9 - ((x + y) % 9)) % 9; } while (a === 0);
    if (lvl === 1) {
      return open(`Determinați cifra $a$ pentru care numărul $\\overline{${x}a${y}}$ este divizibil cu 9.`, a,
        `Suma cifrelor, $${x} + a + ${y} = ${x + y} + a$, trebuie să fie multiplu de 9. Singura cifră potrivită este $a = ${a}$ (suma devine $${x + y + a}$).`);
    }
    const z = R.pick([0, 5]);
    let t = 0;
    while ((x + t + y + z) % 9 !== 0) t++;
    if (t === 0) return null;                 // 0 și 9 ar merge amândouă
    return open(`Determinați cifra $a$ pentru care numărul $\\overline{${x}${y}a${z}}$ este divizibil cu 45.`, t,
      `Divizibil cu 45 înseamnă divizibil cu 5 și cu 9. Ultima cifră e ${z}, deci se împarte la 5. Pentru 9: $${x} + ${y} + a + ${z} = ${x + y + z} + a$ multiplu de 9 ⇒ $a = ${t}$.`);
  });

def('divizori', 'divizor, multiplu',
  (f) => has(f, /divizori/) && has(f, /cati|numarul/),
  (R) => {
    const [p, q] = R.shuffle([2, 3, 5]).slice(0, 2);
    const a = R.int(1, 3), b = R.int(1, 2);
    const n = p ** a * q ** b;
    return open(`Câți divizori naturali are numărul ${n}?`, (a + 1) * (b + 1),
      `Descompunem: $${n} = ${p}^{${a}} \\cdot ${q}^{${b}}$. Numărul divizorilor este $(${a} + 1)(${b} + 1) = ${(a + 1) * (b + 1)}$.`);
  });

def('fractii-adunare', 'adunarea și scăderea fracțiilor',
  (f) => has(f, /\\frac/) && /[+-]/.test(mathOf(f)) && !/\\cdot|:/.test(mathOf(f)) && !hasVar(f) && !/\\sqrt/.test(f),
  (R, lvl) => {
    const dens = lvl === 1 ? [2, 3, 4, 5, 6, 8, 10] : [3, 4, 5, 6, 8, 9, 10, 12, 15];
    let b = R.pick(dens), d = R.pick(dens);
    if (lvl === 1 && R.r() < 0.5) d = b;
    const a = R.int(1, b * 2 - 1), c = R.int(1, d * 2 - 1);
    if (gcd(a, b) !== 1 || gcd(c, d) !== 1) return null;
    const minus = lvl > 1 && R.r() < 0.5;
    const p = minus ? a * d - c * b : a * d + c * b, q = b * d;
    if (p <= 0) return null;
    const m = lcm(b, d);
    return open(`Calculați: $\\frac{${a}}{${b}} ${minus ? '-' : '+'} \\frac{${c}}{${d}}$. Scrieți rezultatul ca fracție ireductibilă.`, fr(p, q),
      `Aducem la numitorul comun ${m}: $\\frac{${a * (m / b)}}{${m}} ${minus ? '-' : '+'} \\frac{${c * (m / d)}}{${m}} = \\frac{${a * (m / b) + (minus ? -1 : 1) * c * (m / d)}}{${m}} = ${fr(p, q)}$.`);
  });

def('fractii-inmultire', 'înmulțirea și împărțirea fracțiilor',
  (f) => has(f, /\\frac/) && /\\cdot|:/.test(mathOf(f)) && !hasVar(f) && !/\\sqrt/.test(f),
  (R, lvl) => {
    const a = R.int(1, 9), b = R.int(2, 9), c = R.int(1, 9), d = R.int(2, 9);
    const div = lvl > 1 && R.r() < 0.5;
    const p = div ? a * d : a * c, q = div ? b * c : b * d;
    return open(`Calculați: $\\frac{${a}}{${b}} ${div ? ':' : '\\cdot'} \\frac{${c}}{${d}}$. Scrieți rezultatul ca fracție ireductibilă.`, fr(p, q),
      div ? `Împărțirea înseamnă înmulțirea cu inversa: $\\frac{${a}}{${b}} \\cdot \\frac{${d}}{${c}} = \\frac{${p}}{${q}} = ${fr(p, q)}$.`
        : `Înmulțim numărătorii între ei și numitorii între ei: $\\frac{${a} \\cdot ${c}}{${b} \\cdot ${d}} = \\frac{${p}}{${q}} = ${fr(p, q)}$.`);
  });

def('fractii-simplificare', 'amplificare și simplificare',
  (f) => has(f, /simplifica|ireductibil/) && has(f, /\\frac/) && !hasVar(f),
  (R) => {
    let p, q;
    do { p = R.int(1, 11); q = R.int(2, 13); } while (gcd(p, q) !== 1 || p === q);
    const k = R.int(2, 9);
    return open(`Scrieți fracția $\\frac{${p * k}}{${q * k}}$ ca fracție ireductibilă.`, fr(p, q),
      `Simplificăm cu ${k} (cel mai mare divizor comun): $\\frac{${p * k} : ${k}}{${q * k} : ${k}} = \\frac{${p}}{${q}}$.`);
  });

def('fractie-din-numar', 'aflarea unei fracții dintr-un număr',
  (f) => has(f, /\\frac/) && has(f, / din /) && !/%|procent/.test(f),
  (R) => {
    let a, b;
    do { a = R.int(1, 7); b = R.int(2, 9); } while (a >= b || gcd(a, b) !== 1);
    const n = b * R.int(2, 15);
    return open(`Calculați $\\frac{${a}}{${b}}$ din ${n}.`, (a * n) / b,
      `$\\frac{${a}}{${b}}$ din ${n} înseamnă $\\frac{${a}}{${b}} \\cdot ${n} = ${a} \\cdot (${n} : ${b}) = ${a} \\cdot ${n / b} = ${(a * n) / b}$.`);
  });

def('zecimale-operatii', 'operații cu fracții zecimale',
  (f) => /\d,\d|\d\{,\}\d/.test(f) && !/media|cel mai mare|cel mai mic|compar/.test(f) && !hasVar(f),
  (R, lvl) => {
    // lucrăm în sutimi, ca rezultatul să fie exact
    const a = R.int(11, 99) / 10, b = R.int(11, 49) / 10, c = R.int(2, 9);
    if (lvl === 1) {
      const s = Math.round((a + b) * 10) / 10;
      return open(`Calculați: $${decTex(a)} + ${decTex(b)}$.`, decStr(s), `Adunăm zecimi cu zecimi: $${decTex(a)} + ${decTex(b)} = ${decTex(s)}$.`);
    }
    const v = Math.round((a + b * c) * 100) / 100;
    if (lvl === 2) {
      return open(`Calculați: $${decTex(a)} + ${decTex(b)} \\cdot ${c}$.`, decStr(v),
        `Întâi înmulțirea: $${decTex(b)} \\cdot ${c} = ${decTex(Math.round(b * c * 100) / 100)}$, apoi adunarea: $${decTex(a)} + ${decTex(Math.round(b * c * 100) / 100)} = ${decTex(v)}$.`);
    }
    const d = R.pick([2, 4, 5]);
    const w = Math.round((a * 10 * c) / d) / 10;
    if (Math.abs(w * d - a * c) > 1e-9) return null;
    return open(`Calculați: $${decTex(a)} \\cdot ${c} : ${d}$.`, decStr(w),
      `$${decTex(a)} \\cdot ${c} = ${decTex(Math.round(a * c * 10) / 10)}$, apoi $${decTex(Math.round(a * c * 10) / 10)} : ${d} = ${decTex(w)}$.`);
  });

def('zecimale-transformare', 'transformări între fracții ordinare și zecimale',
  (f) => has(f, /fractie zecimala|fractia zecimala|ca fractie/) && has(f, /\\frac|,\d/),
  (R) => {
    const q = R.pick([2, 4, 5, 8, 10, 20, 25]);
    let p;
    do { p = R.int(1, q * 2); } while (gcd(p, q) !== 1);
    return open(`Scrieți fracția $\\frac{${p}}{${q}}$ ca fracție zecimală.`, decStr(p / q),
      `Amplificăm până la un numitor putere a lui 10 (sau împărțim ${p} la ${q}): $\\frac{${p}}{${q}} = ${decTex(p / q)}$.`);
  });

def('zecimale-comparare', 'scrierea și compararea fracțiilor zecimale',
  (f) => has(f, /cel mai mare|cel mai mic/) && /\d,\d|\d\{,\}\d/.test(f),
  (R) => {
    const base = R.int(1, 9);
    const vals = R.shuffle([0.4, 0.39, 0.309, 0.35, 0.305, 0.41, 0.399, 0.38]).slice(0, 4).map((x) => Math.round((base + x) * 1000) / 1000);
    const max = Math.max(...vals);
    return choice(R, `Care este cel mai mare dintre numerele: $${vals.map(decTex).join('$; $')}$?`, decTex(max),
      vals.filter((v) => v !== max).map(decTex),
      `Comparăm cifră cu cifră, după virgulă: zecimile întâi. Cel mai mare este $${decTex(max)}$.`);
  });

def('media-aritmetica', 'media aritmetică',
  (f) => has(f, /media aritmetica/),
  (R, lvl) => {
    const n = lvl === 1 ? 2 : lvl === 2 ? 3 : 4;
    const m = R.int(8, 40);
    const xs = [];
    let s = 0;
    for (let i = 0; i < n - 1; i++) { const x = m + R.int(-6, 6); xs.push(x); s += x; }
    const last = m * n - s;
    if (last <= 0) return null;
    xs.push(last);
    return open(`Calculați media aritmetică a numerelor ${xs.join(', ')}.`, m,
      `Adunăm numerele: $${xs.join(' + ')} = ${m * n}$, apoi împărțim la ${n}: $${m * n} : ${n} = ${m}$.`);
  });

def('unitati-masura', 'unități de măsură pentru lungime, arie, volum, timp',
  (f) => has(f, /transforma|exprima|= \?|cati|cate/) && /\b(cm|dm|mm|km|kg|min|minute|ore|ml|litri|l|ari|ar|metri|grame|centimetri)\b/.test(f),
  (R) => {
    const t = R.int(0, 3);
    if (t === 0) { const m = R.int(12, 95) / 10; return open(`Transformați în centimetri: $${decTex(m)}\\ \\text{m}$.`, Math.round(m * 100), `$1\\ \\text{m} = 100\\ \\text{cm}$, deci $${decTex(m)} \\cdot 100 = ${Math.round(m * 100)}\\ \\text{cm}$.`); }
    if (t === 1) { const h = R.int(1, 4), mi = R.pick([10, 15, 20, 30, 45, 50]); return open(`Câte minute are un interval de ${h} ore și ${mi} minute?`, h * 60 + mi, `$${h} \\cdot 60 + ${mi} = ${h * 60 + mi}$ de minute.`); }
    if (t === 2) { const l = R.int(2, 9); return open(`Câți centimetri cubi are $${l}\\ \\text{dm}^3$?`, l * 1000, `$1\\ \\text{dm}^3 = 1000\\ \\text{cm}^3$, deci $${l} \\cdot 1000 = ${l * 1000}\\ \\text{cm}^3$.`); }
    const k = R.int(2, 9); return open(`Câți metri pătrați are un teren de $${k}\\ \\text{ari}$?`, k * 100, `$1\\ \\text{ar} = 100\\ \\text{m}^2$, deci $${k * 100}\\ \\text{m}^2$.`);
  });

def('segmente', 'măsurarea segmentelor și unghiurilor',
  (f) => has(f, /coliniar|mijlocul/) && has(f, /cm/),
  (R) => {
    if (R.r() < 0.5) {
      const ab = R.int(3, 15), bc = R.int(3, 15);
      return open(`Punctele $A$, $B$, $C$ sunt coliniare, în această ordine, cu $AB = ${ab}$ cm și $BC = ${bc}$ cm. Calculați lungimea segmentului $AC$ (în cm).`, ab + bc,
        `$B$ este între $A$ și $C$, deci $AC = AB + BC = ${ab} + ${bc} = ${ab + bc}$ cm.`);
    }
    const ab = 2 * R.int(3, 20);
    return open(`Punctul $M$ este mijlocul segmentului $AB$, cu $AB = ${ab}$ cm. Calculați lungimea segmentului $AM$ (în cm).`, ab / 2,
      `Mijlocul împarte segmentul în două segmente egale: $AM = AB : 2 = ${ab / 2}$ cm.`);
  });

def('perimetre', 'figuri geometrice',
  (f) => has(f, /perimetr/),
  (R) => {
    const L = R.int(5, 20), l = R.int(2, L - 1);
    if (R.r() < 0.5) return open(`Un dreptunghi are lungimea de ${L} cm și lățimea de ${l} cm. Calculați perimetrul dreptunghiului (în cm).`, 2 * (L + l), `$P = 2(L + l) = 2(${L} + ${l}) = ${2 * (L + l)}$ cm.`);
    const a = R.int(3, 25);
    return open(`Un pătrat are latura de ${a} cm. Calculați perimetrul pătratului (în cm).`, 4 * a, `$P = 4 \\cdot ${a} = ${4 * a}$ cm.`);
  });

def('reducere-unitate', 'metoda reducerii la unitate',
  (f) => has(f, /costa|cost|lei/) && /\d/.test(f) && !/%/.test(f),
  (R) => {
    const u = R.int(2, 12), n = R.int(2, 9);
    let m = R.int(2, 12);
    if (m === n) m++;
    const obj = R.pick(['caiete', 'kg de mere', 'pixuri', 'bilete']);
    return open(`${n} ${obj} costă ${n * u} lei. Cât costă ${m} ${obj} (în lei)?`, m * u,
      `Reducem la unitate: unul costă $${n * u} : ${n} = ${u}$ lei, deci ${m} costă $${m} \\cdot ${u} = ${m * u}$ lei.`);
  });

def('metoda-figurativa', 'metoda figurativă',
  (f) => has(f, /suma/) && has(f, /diferenta|mai mare cu|de \d+ ori/),
  (R, lvl) => {
    if (lvl === 3) {
      const s = R.int(2, 9), k = R.int(2, 5);
      const small = s, big = k * s, sum = small + big;
      return open(`Suma a două numere este ${sum}, iar unul este de ${k} ori mai mare decât celălalt. Aflați numărul mai mare.`, big,
        `Numărul mic este o parte, cel mare ${k} părți: în total ${k + 1} părți. O parte $= ${sum} : ${k + 1} = ${small}$, deci numărul mare este $${k} \\cdot ${small} = ${big}$.`);
    }
    const b = R.int(10, 60), d = R.int(2, 20), a = b + d;
    return open(`Suma a două numere este ${a + b}, iar diferența lor este ${d}. Aflați numărul mai mare.`, a,
      `Scădem diferența din sumă: $${a + b} - ${d} = ${2 * b}$ = de două ori numărul mic, deci numărul mic e ${b}, iar cel mare $${b} + ${d} = ${a}$.`);
  });

def('metoda-comparatiei', 'metoda comparației',
  (f) => has(f, /costa|lei/) && has(f, / si /) && /\d.*\d.*\d/.test(f),
  (R) => {
    const x = R.int(2, 9), y = R.int(1, 6), a = R.int(2, 5), b = R.int(1, 3);
    const b2 = b + R.int(1, 3);
    return open(`${a} caiete și ${b} pixuri costă ${a * x + b * y} lei, iar ${a} caiete și ${b2} pixuri costă ${a * x + b2 * y} lei. Cât costă un pix (în lei)?`, y,
      `Comparăm: diferența este de ${b2 - b} pixuri și $${a * x + b2 * y} - ${a * x + b * y} = ${(b2 - b) * y}$ lei, deci un pix costă $${(b2 - b) * y} : ${b2 - b} = ${y}$ lei.`);
  });

// ─── Clasa a 6-a ─────────────────────────────────────────────────────────────
def('cmmdc-cmmmc', 'cmmdc și cmmmc',
  (f) => has(f, /c\.?m\.?m\.?d\.?c|c\.?m\.?m\.?m\.?c|cel mai mare divizor comun|cel mai mic multiplu comun/),
  (R) => {
    const g = R.pick([2, 3, 4, 5, 6, 7, 8, 9, 10, 12]);
    let a, b;
    do { a = R.int(2, 9); b = R.int(2, 9); } while (gcd(a, b) !== 1 || a === b);
    const x = g * a, y = g * b;
    if (R.r() < 0.5) return open(`Determinați cel mai mare divizor comun al numerelor ${x} și ${y}.`, g, `$${x} = ${g} \\cdot ${a}$ și $${y} = ${g} \\cdot ${b}$, cu ${a} și ${b} prime între ele, deci $(${x}, ${y}) = ${g}$.`);
    return open(`Determinați cel mai mic multiplu comun al numerelor ${x} și ${y}.`, g * a * b, `$[${x}, ${y}] = \\frac{${x} \\cdot ${y}}{(${x}, ${y})} = \\frac{${x * y}}{${g}} = ${g * a * b}$.`);
  });

def('factori-primi', 'descompunerea în factori primi',
  (f) => has(f, /factori primi|factor prim/),
  (R) => {
    const ps = R.shuffle([2, 3, 5, 7, 11, 13]).slice(0, 3).sort((a, b) => a - b);
    const n = ps[0] * ps[1] * ps[2] * R.pick([1, ps[0]]);
    return open(`Care este cel mai mare factor prim din descompunerea numărului ${n}?`, ps[2],
      `Descompunem: $${n} = ${n / (ps[0] * ps[1] * ps[2]) === 1 ? '' : `${ps[0]} \\cdot `}${ps.join(' \\cdot ')}$. Cel mai mare factor prim este ${ps[2]}.`);
  });

def('multimi-operatii', 'operații cu mulțimi',
  (f) => has(f, /\\cup|\\cap|reuniun|intersecti|\\setminus/) && has(f, /\\\{|multim/),
  (R) => {
    const A = R.shuffle([1, 2, 3, 4, 5, 6, 7, 8]).slice(0, R.int(3, 5)).sort((a, b) => a - b);
    const B = R.shuffle([2, 3, 4, 5, 6, 7, 8, 9]).slice(0, R.int(3, 5)).sort((a, b) => a - b);
    const U = [...new Set([...A, ...B])], I = A.filter((x) => B.includes(x));
    const S = (xs) => `\\{${xs.join(', ')}\\}`;
    if (R.r() < 0.5 || !I.length) return open(`Fie $A = ${S(A)}$ și $B = ${S(B)}$. Câte elemente are mulțimea $A \\cup B$?`, U.length, `$A \\cup B = ${S(U.sort((a, b) => a - b))}$, deci are ${U.length} elemente.`);
    return open(`Fie $A = ${S(A)}$ și $B = ${S(B)}$. Calculați suma elementelor mulțimii $A \\cap B$.`, I.reduce((s, x) => s + x, 0), `$A \\cap B = ${S(I)}$ (elementele comune), iar suma lor este ${I.reduce((s, x) => s + x, 0)}.`);
  });

def('procente', 'procente',
  (f) => has(f, /%|procent|la suta/),
  (R, lvl) => {
    const p = R.pick([5, 10, 15, 20, 25, 30, 40, 50, 60, 75]);
    const n = R.int(2, 30) * 20;
    if (lvl === 1) return open(`Calculați $${p}\\%$ din ${n}.`, (p * n) / 100, `$${p}\\%$ din ${n} $= \\frac{${p}}{100} \\cdot ${n} = ${(p * n) / 100}$.`);
    if (lvl === 2) {
      const up = R.r() < 0.5;
      const v = up ? n + (p * n) / 100 : n - (p * n) / 100;
      return open(`Un produs costă ${n} lei. Prețul ${up ? 'crește' : 'scade'} cu $${p}\\%$. Cât costă produsul după ${up ? 'scumpire' : 'reducere'} (în lei)?`, v,
        `$${p}\\%$ din ${n} este ${(p * n) / 100} lei, deci noul preț este $${n} ${up ? '+' : '-'} ${(p * n) / 100} = ${v}$ lei.`);
    }
    const part = (p * n) / 100;
    return open(`Câte procente reprezintă ${part} din ${n}?`, p, `$\\frac{${part}}{${n}} \\cdot 100 = ${p}$, deci $${p}\\%$.`);
  });

def('rapoarte', 'rapoarte',
  (f) => has(f, /raportul/) && !/asemanare|ariilor/.test(f),
  (R) => {
    const g = R.int(2, 9);
    let a, b;
    do { a = R.int(1, 9); b = R.int(2, 9); } while (gcd(a, b) !== 1 || a === b);
    return open(`Calculați raportul numerelor ${a * g} și ${b * g}, ca fracție ireductibilă.`, fr(a, b),
      `$\\frac{${a * g}}{${b * g}}$, simplificat cu ${g}, este $${fr(a, b)}$.`);
  });

def('proportii', 'proporții și proprietatea fundamentală',
  (f) => has(f, /proporti/) || /\\frac\{x\}\{\d+\}\s*=\s*\\frac/.test(f),
  (R) => {
    // x / (d·t) = (c·s) / (d·s)  ⇒  x = c·t
    let c, d;
    do { c = R.int(1, 9); d = R.int(2, 9); } while (gcd(c, d) !== 1 || c === d);
    const t = R.int(2, 6), s = R.int(2, 5);
    return open(`Aflați $x$ din proporția $\\frac{x}{${d * t}} = \\frac{${c * s}}{${d * s}}$.`, c * t,
      `Produsul extremilor este egal cu produsul mezilor: $x \\cdot ${d * s} = ${d * t} \\cdot ${c * s}$, deci $x = \\frac{${d * t * c * s}}{${d * s}} = ${c * t}$.`);
  });

def('regula-de-trei', 'regula de trei simplă',
  (f) => /\b(muncitori|robinete|zile|ore)\b/.test(f),
  (R) => {
    // invers proporțional: muncitori × zile = constant
    const w1 = R.pick([2, 3, 4, 5, 6, 8]), d1 = R.pick([6, 8, 10, 12, 15, 20, 24]);
    const total = w1 * d1;
    const opts = [2, 3, 4, 5, 6, 8, 10, 12].filter((w) => w !== w1 && total % w === 0);
    if (!opts.length) return null;
    const w2 = R.pick(opts);
    return open(`${w1} muncitori termină o lucrare în ${d1} zile. În câte zile termină aceeași lucrare ${w2} muncitori (lucrând la fel)?`, total / w2,
      `Mărimile sunt invers proporționale: $${w1} \\cdot ${d1} = ${w2} \\cdot x$, deci $x = ${total} : ${w2} = ${total / w2}$ zile.`);
  });

def('direct-proportionale', 'mărimi direct și invers proporționale',
  (f) => has(f, /direct proportional|invers proportional/),
  (R) => {
    const a = R.int(1, 5), b = R.int(2, 7), k = R.int(2, 12);
    if (a === b) return null;
    const n = (a + b) * k;
    return open(`Împărțiți numărul ${n} în două părți direct proporționale cu ${a} și ${b}. Care este partea mai mare?`, Math.max(a, b) * k,
      `Părțile sunt $${a}k$ și $${b}k$, cu $${a}k + ${b}k = ${n}$, deci $k = ${k}$. Partea mai mare: $${Math.max(a, b)} \\cdot ${k} = ${Math.max(a, b) * k}$.`);
  });

def('intregi-operatii', 'adunarea și scăderea numerelor întregi',
  (f) => /\(-\d|\(−\d/.test(f) && !hasVar(f) && !/\\frac/.test(f),
  (R, lvl) => {
    const a = R.nz(-20, 20), b = R.nz(-20, 20), c = R.nz(-9, 9);
    if (lvl === 1) return open(`Calculați: $${par(a)} + ${par(b)} - ${par(c)}$.`, a + b - c, `$${par(a)} + ${par(b)} = ${a + b}$, iar $${a + b} - ${par(c)} = ${a + b - c}$ (scăderea unui număr înseamnă adunarea opusului).`);
    const d = R.nz(-6, 6);
    return open(`Calculați: $${par(a)} + ${par(c)} \\cdot ${par(d)}$.`, a + c * d, `Întâi înmulțirea: $${par(c)} \\cdot ${par(d)} = ${c * d}$ (semne ${c * d > 0 ? 'egale → plus' : 'diferite → minus'}), apoi $${par(a)} + ${par(c * d)} = ${a + c * d}$.`);
  });

def('puteri-intregi', 'puteri cu bază număr întreg',
  (f) => /\(-\d+\)\^/.test(f),
  (R) => {
    const b = -R.int(2, 5), n = R.int(2, 4), m = R.int(2, 6);
    const v = b ** n + (-1) ** m;
    return open(`Calculați: $(${b})^{${n}} + (-1)^{${m}}$.`, v, `$(${b})^{${n}} = ${b ** n}$ (exponent ${n % 2 ? 'impar → negativ' : 'par → pozitiv'}), $(-1)^{${m}} = ${(-1) ** m}$; suma este ${v}.`);
  });

def('ecuatie-simpla', 'ecuații simple în ℤ',
  (f) => hasVar(f) && has(f, /=/) && !/x\^|\\frac|\\sqrt|\\begin/.test(f) && /ecuati|rezolvat|aflati|determinati/.test(f),
  (R, lvl) => {
    const x = R.nz(-15, 15);
    if (lvl === 1) { const a = R.nz(-20, 20); return open(`Rezolvați în $\\mathbb{Z}$ ecuația $x ${a < 0 ? '-' : '+'} ${Math.abs(a)} = ${x + a}$.`, x, `Trecem ${Math.abs(a)} în membrul drept cu semn schimbat: $x = ${x + a} ${a < 0 ? '+' : '-'} ${Math.abs(a)} = ${x}$.`); }
    const a = R.nz(-9, 9), b = R.nz(-12, 12);
    return open(`Rezolvați în $\\mathbb{Z}$ ecuația $${poly([[a, 'x'], [b, '']])} = ${a * x + b}$.`, x,
      `$${poly([[a, 'x']])} = ${a * x + b} ${b < 0 ? '+' : '-'} ${Math.abs(b)} = ${a * x}$, deci $x = ${a * x} : ${par(a)} = ${x}$.`);
  });

def('ecuatii-rationale', 'ecuații de forma x+a=b, ax=b în ℚ',
  (f) => hasVar(f) && has(f, /\\frac/) && has(f, /=/) && !/x\^/.test(f),
  (R) => {
    const p = R.nz(-9, 9), q = R.int(2, 9), a = R.nz(-5, 5) || 2, c = R.int(2, 9);
    const rhsP = a * p, rhsQ = q * c; // (a/c)·x = (a·p)/(q·c) ⇒ x = p/q
    return open(`Rezolvați în $\\mathbb{Q}$ ecuația $${fr(a, c)} \\cdot x = ${fr(rhsP, rhsQ)}$.`, fr(p, q),
      `Împărțim la $${fr(a, c)}$ (înmulțim cu inversul): $x = ${fr(rhsP, rhsQ)} \\cdot ${fr(c, a)} = ${fr(p, q)}$.`);
  });

def('rationale-operatii', 'operații cu numere raționale',
  (f) => has(f, /\\frac/) && /\(-|-\\frac/.test(f) && !hasVar(f),
  (R) => {
    const a = R.nz(-5, 5), b = R.int(2, 6), c = R.nz(-5, 5), d = R.int(2, 6), e = R.nz(-4, 4), g = R.int(2, 5);
    const P = a * d * g + c * e * b, Q = b * d * g;
    return open(`Calculați: $${fr(a, b)} + ${par(fr(c, d))} \\cdot ${par(fr(e, g))}$.`, fr(P, Q),
      `Întâi înmulțirea: $${par(fr(c, d))} \\cdot ${par(fr(e, g))} = ${fr(c * e, d * g)}$, apoi adunarea: $${fr(a, b)} + ${par(fr(c * e, d * g))} = ${fr(P, Q)}$.`);
  });

def('probleme-rationale', 'probleme cu numere raționale',
  (f) => has(f, /pagini|carte|drum|km/) && has(f, /\\frac|din/),
  (R) => {
    let a, b;
    do { a = R.int(1, 5); b = R.int(3, 9); } while (a >= b || gcd(a, b) !== 1);
    const total = b * R.int(5, 30);
    const read = (a * total) / b;
    return open(`Un elev a citit $${fr(a, b)}$ dintr-o carte, adică ${read} de pagini. Câte pagini are cartea?`, total,
      `$${fr(a, b)}$ din carte înseamnă ${read} pagini, deci $\\frac{1}{${b}}$ din carte are $${read} : ${a} = ${read / a}$ pagini, iar cartea întreagă $${read / a} \\cdot ${b} = ${total}$ pagini.`);
  });

def('intregi-comparare', 'compararea și ordonarea numerelor întregi',
  (f) => has(f, /cel mai mic|cel mai mare|ordon/) && /-\d/.test(f),
  (R) => {
    const xs = R.shuffle([...new Set([R.nz(-30, -1), R.nz(-30, -1), R.nz(-9, 9), R.nz(1, 30)])]);
    if (xs.length < 4) return null;
    const min = Math.min(...xs);
    return choice(R, `Care este cel mai mic dintre numerele: $${xs.join('$; $')}$?`, `${min}`, xs.filter((x) => x !== min).map(String),
      `Pe axă, cel mai mic număr e cel mai din stânga: dintre numerele negative, cel cu modulul cel mai mare. Răspuns: $${min}$.`);
  });

def('unghiuri-complementare', 'unghiuri complementare și suplementare',
  (f) => has(f, /complement|suplement/),
  (R, lvl) => {
    if (lvl === 3) {
      const k = R.pick([2, 3, 4, 5, 8]);
      const sup = R.r() < 0.5;
      const tot = sup ? 180 : 90;
      if (tot % (k + 1)) return null;
      const x = (k * tot) / (k + 1);
      return open(`Un unghi are măsura de ${k} ori mai mare decât ${sup ? 'suplementul' : 'complementul'} său. Aflați măsura unghiului (în grade).`, x,
        `Dacă ${sup ? 'suplementul' : 'complementul'} are $a$ grade, unghiul are $${k}a$, iar $a + ${k}a = ${tot}^{\\circ}$, deci $a = ${tot / (k + 1)}^{\\circ}$ și unghiul are $${x}^{\\circ}$.`);
    }
    const a = R.int(10, 80);
    if (R.r() < 0.5) return open(`Aflați măsura complementului unui unghi de $${deg(a)}$ (în grade).`, 90 - a, `Unghiurile complementare au suma $90^{\\circ}$: $90 - ${a} = ${90 - a}$, deci $${deg(90 - a)}$.`);
    const b = R.int(20, 160);
    return open(`Aflați măsura suplementului unui unghi de $${deg(b)}$ (în grade).`, 180 - b, `Unghiurile suplementare au suma $180^{\\circ}$: $180 - ${b} = ${180 - b}$, deci $${deg(180 - b)}$.`);
  });

def('unghiuri-opuse', 'unghiuri opuse la vârf',
  (f) => has(f, /opuse la varf/),
  (R) => {
    const x = R.int(5, 30), a = R.int(2, 4), b = R.int(a + 1, 7), c = R.int(1, 40);
    const d = (b - a) * x - c; // a·x + c = b·x - d  ⇒ x
    const m = a * x + c;
    if (m <= 0 || m >= 180 || d < 0) return null;
    const L = poly([[a, 'x'], [c, '']]), Rr = poly([[b, 'x'], [-d, '']]);
    return open(`Două unghiuri opuse la vârf au măsurile $(${L})^{\\circ}$ și $(${Rr})^{\\circ}$. Aflați măsura unghiurilor (în grade).`, m,
      `Unghiurile opuse la vârf sunt congruente: $${L} = ${Rr}$, deci $${poly([[b - a, 'x']])} = ${c + d}$, $x = ${x}$. Măsura: $${a} \\cdot ${x} + ${c} = ${m}^{\\circ}$.`);
  });

def('paralele-secanta', 'unghiuri formate de două drepte paralele cu o secantă',
  (f) => has(f, /paralel/) && has(f, /secant|altern|corespondent/),
  (R) => {
    const a = R.int(25, 155);
    if (R.r() < 0.5) return open(`Dreptele $a$ și $b$ sunt paralele, iar secanta $c$ formează cu ele două unghiuri alterne interne. Unul are $${deg(a)}$. Aflați măsura celuilalt (în grade).`, a, `Unghiurile alterne interne formate de două paralele cu o secantă sunt congruente: $${deg(a)}$.`);
    return open(`Dreptele $a$ și $b$ sunt paralele. Două unghiuri interne de aceeași parte a secantei au una dintre măsuri $${deg(a)}$. Aflați măsura celuilalt (în grade).`, 180 - a, `Unghiurile interne de aceeași parte a secantei sunt suplementare: $180 - ${a} = ${180 - a}$, deci $${deg(180 - a)}$.`);
  });

def('bisectoare', 'mediatoarea unui segment, bisectoarea unui unghi',
  (f) => has(f, /bisectoare|mediatoare/),
  (R) => {
    if (R.r() < 0.5) { const a = 2 * R.int(20, 85); return open(`Semidreapta $OC$ este bisectoarea unghiului $AOB$, cu $m(\\angle AOB) = ${deg(a)}$. Aflați $m(\\angle AOC)$ (în grade).`, a / 2, `Bisectoarea împarte unghiul în două unghiuri congruente: $${a} : 2 = ${a / 2}$, deci $${deg(a / 2)}$.`); }
    const d = R.int(3, 20);
    return open(`Punctul $M$ se află pe mediatoarea segmentului $AB$, iar $MA = ${d}$ cm. Cât este $MB$ (în cm)?`, d, `Orice punct de pe mediatoare este egal depărtat de capetele segmentului: $MB = MA = ${d}$ cm.`);
  });

def('triunghi-unghiuri', 'suma măsurilor unghiurilor unui triunghi',
  (f) => has(f, /triunghi/) && has(f, /unghi/) && /\^\{?\\circ|grade/.test(f),
  (R) => {
    const a = R.int(20, 100), b = R.int(20, 150 - a);
    return open(`Triunghiul $ABC$ are $m(\\angle A) = ${deg(a)}$ și $m(\\angle B) = ${deg(b)}$. Aflați $m(\\angle C)$ (în grade).`, 180 - a - b,
      `Suma unghiurilor unui triunghi este $180^{\\circ}$: $180 - ${a} - ${b} = ${180 - a - b}$, deci $${deg(180 - a - b)}$.`);
  });

def('triunghi-isoscel', 'triunghiul isoscel și echilateral',
  (f) => has(f, /isoscel|echilateral/),
  (R) => {
    const v = 2 * R.int(10, 80);
    return open(`Triunghiul $ABC$ este isoscel, cu baza $BC$ și $m(\\angle A) = ${deg(v)}$. Aflați $m(\\angle B)$ (în grade).`, (180 - v) / 2,
      `Unghiurile de la bază sunt congruente: $m(\\angle B) = m(\\angle C) = \\frac{180 - ${v}}{2} = ${(180 - v) / 2}^{\\circ}$.`);
  });

def('mediana-ipotenuza', 'liniile importante în triunghi',
  (f) => has(f, /median/) && has(f, /ipotenuz/),
  (R) => {
    const c = 2 * R.int(3, 25);
    return open(`Într-un triunghi dreptunghic, ipotenuza are ${c} cm. Aflați lungimea medianei corespunzătoare ipotenuzei (în cm).`, c / 2,
      `Mediana dusă din vârful unghiului drept este jumătate din ipotenuză: $${c} : 2 = ${c / 2}$ cm.`);
  });

// ─── Clasa a 7-a ─────────────────────────────────────────────────────────────
const SQF = [2, 3, 5, 6, 7, 10, 11];
def('radical-patrat', 'rădăcina pătrată',
  (f) => has(f, /\\sqrt\{\d+\}/) && !/\\sqrt\{\d+\}\s*\\cdot|\\frac/.test(f) && has(f, /calculat/),
  (R) => {
    const a = R.int(4, 20), b = R.int(2, 12);
    return open(`Calculați: $\\sqrt{${a * a}} - \\sqrt{${b * b}}$.`, a - b, `$\\sqrt{${a * a}} = ${a}$ și $\\sqrt{${b * b}} = ${b}$, deci rezultatul este $${a} - ${b} = ${a - b}$.`);
  });

def('radical-scoatere', 'scoaterea factorilor de sub radical',
  (f) => has(f, /\\sqrt/) && has(f, /scoate|forma a\\sqrt|scrieti/),
  (R) => {
    const k = R.int(2, 9), m = R.pick(SQF);
    return open(`Scoateți factorii de sub radical: $\\sqrt{${k * k * m}}$.`, rad(k, m),
      `$${k * k * m} = ${k * k} \\cdot ${m}$, deci $\\sqrt{${k * k * m}} = \\sqrt{${k * k}} \\cdot \\sqrt{${m}} = ${rad(k, m)}$.`);
  });

def('radicali-operatii', 'operații cu radicali',
  (f) => has(f, /\\sqrt/) && /[+-]\s*\d*\\sqrt|\\sqrt\{\d+\}\s*\\cdot/.test(f),
  (R, lvl) => {
    const m = R.pick([2, 3, 5]);
    if (lvl === 1) {
      const a = R.int(2, 9), b = R.int(1, 9), c = R.int(1, 9);
      const k = a + b - c;
      if (k === 0) return null;
      return open(`Calculați: $${rad(a, m)} + ${rad(b, m)} - ${rad(c, m)}$.`, rad(k, m), `Radicalii sunt asemenea; adunăm coeficienții: $(${a} + ${b} - ${c})\\sqrt{${m}} = ${rad(k, m)}$.`);
    }
    const p = R.int(1, 4), q = R.int(1, 4);
    const k = p + 2 * q;
    return open(`Calculați: $\\sqrt{${p * p * m}} + \\sqrt{${4 * q * q * m}}$.`, rad(k, m),
      `$\\sqrt{${p * p * m}} = ${rad(p, m)}$, $\\sqrt{${4 * q * q * m}} = ${rad(2 * q, m)}$; suma: $${rad(k, m)}$.`);
  });

def('rationalizare', 'raționalizarea numitorului',
  (f) => has(f, /rationaliz/) || /\\frac\{\d+\}\{\d*\\sqrt/.test(f),
  (R) => {
    const m = R.pick([2, 3, 5, 6, 7]), a = R.pick([1, 2, 3, 4, 6, 10, 12, 14, 15].filter((x) => x !== m));
    const g = gcd(a, m);
    const num = a / g, den = m / g;
    const ans = den === 1 ? rad(num, m) : `\\frac{${rad(num, m)}}{${den}}`;
    return open(`Raționalizați numitorul: $\\frac{${a}}{\\sqrt{${m}}}$.`, ans,
      `Amplificăm cu $\\sqrt{${m}}$: $\\frac{${a}\\sqrt{${m}}}{${m}}${g > 1 ? ` = ${ans}` : ''}$.`);
  });

def('media-geometrica', 'media geometrică',
  (f) => has(f, /media geometrica|medie proportionala/),
  (R) => {
    const a = R.int(1, 9), b = R.int(1, 9), k = R.int(1, 4);
    const x = a * a * k, y = b * b * k;
    if (x === y) return null;
    return open(`Calculați media geometrică a numerelor ${x} și ${y}.`, a * b * k, `$m_g = \\sqrt{${x} \\cdot ${y}} = \\sqrt{${x * y}} = ${a * b * k}$.`);
  });

def('ecuatie-gr1', 'ecuația de gradul I cu o necunoscută',
  (f) => hasVar(f) && has(f, /ecuati/) && !/x\^|x\s*\^|\\begin|\\left\\\{|sistem|\\frac\{x/.test(f),
  (R, lvl) => {
    const x = R.nz(-12, 12);
    if (lvl === 1) {
      const a = R.int(2, 9), b = R.nz(-20, 20);
      return open(`Rezolvați ecuația $${poly([[a, 'x'], [b, '']])} = ${a * x + b}$.`, x, `$${a}x = ${a * x + b} ${b < 0 ? '+' : '-'} ${Math.abs(b)} = ${a * x}$, deci $x = ${a * x} : ${a} = ${x}$.`);
    }
    if (lvl === 2) {
      const a = R.int(2, 9), c = R.int(1, 9);
      if (a === c) return null;
      const b = R.nz(-15, 15), d = (a - c) * x + b;
      return open(`Rezolvați ecuația $${poly([[a, 'x'], [b, '']])} = ${poly([[c, 'x'], [d, '']])}$.`, x,
        `Separăm termenii: $${poly([[a, 'x']])} - ${poly([[c, 'x']])} = ${d} ${b < 0 ? '+' : '-'} ${Math.abs(b)}$, adică $${poly([[a - c, 'x']])} = ${d - b}$, deci $x = ${x}$.`);
    }
    const a = R.int(2, 6), b = R.nz(-6, 6), c = R.int(2, 5);
    const rhs = a * (x + b) - c * x;
    if (a === c) return null;
    return open(`Rezolvați ecuația $${a}(${poly([[1, 'x'], [b, '']])}) = ${poly([[c, 'x'], [rhs, '']])}$.`, x,
      `Desfacem paranteza: $${poly([[a, 'x'], [a * b, '']])} = ${poly([[c, 'x'], [rhs, '']])}$, deci $${poly([[a - c, 'x']])} = ${rhs - a * b}$ și $x = ${x}$.`);
  });

def('sistem-2x2', 'sisteme de două ecuații cu două necunoscute',
  (f) => has(f, /sistem/) && hasVar(f, 'y') && !/cramer|incompatibil|parametr/.test(f),
  (R) => {
    const x = R.nz(-6, 8), y = R.nz(-6, 8);
    let a1, b1, a2, b2;
    do { a1 = R.nz(-4, 5); b1 = R.nz(-4, 5); a2 = R.nz(-4, 5); b2 = R.nz(-4, 5); } while (a1 * b2 - a2 * b1 === 0);
    const c1 = a1 * x + b1 * y, c2 = a2 * x + b2 * y;
    const askX = R.r() < 0.5;
    return open(`Rezolvați sistemul $\\begin{cases} ${poly([[a1, 'x'], [b1, 'y']])} = ${c1} \\\\ ${poly([[a2, 'x'], [b2, 'y']])} = ${c2} \\end{cases}$ și scrieți valoarea lui $${askX ? 'x' : 'y'}$.`, askX ? x : y,
      `Prin metoda reducerii (sau a substituției) se obține soluția $x = ${x}$, $y = ${y}$. Verificare: $${a1} \\cdot ${par(x)} + ${par(b1)} \\cdot ${par(y)} = ${c1}$ și $${a2} \\cdot ${par(x)} + ${par(b2)} \\cdot ${par(y)} = ${c2}$.`);
  });

def('probleme-ecuatii', 'probleme rezolvate cu ecuații și sisteme',
  (f) => (has(f, /varsta|ani|numar|numere/) && has(f, /triplul|dublul|de \d+ ori|suma|diferenta/) && !/\\begin/.test(f)) || has(f, /gaini|iepuri/),
  (R) => {
    const t = R.int(0, 2);
    if (t === 0) {
      const c = R.int(6, 15), k = R.int(3, 5), n = R.int(2, 8);
      const p = k * c; // tatăl are acum k·c; peste n ani: p + n = m(c + n)?
      const later = p + n, childLater = c + n;
      if (later % childLater) return null;
      const m = later / childLater;
      return open(`Un tată are ${p} de ani, iar fiul lui are ${c} ani. Peste câți ani vârsta tatălui va fi de ${m} ori vârsta fiului?`, n,
        `Peste $x$ ani: $${p} + x = ${m}(${c} + x)$, deci $${p} - ${m * c} = ${poly([[m - 1, 'x']])}$, $x = ${n}$.`);
    }
    if (t === 1) {
      const x = R.int(5, 40), a = R.int(2, 15), b = 2 * x - a;
      if (b <= 0) return null;
      return open(`Un număr mărit cu ${a} este egal cu triplul său micșorat cu ${b}. Aflați numărul.`, x,
        `Notăm numărul cu $x$: $x + ${a} = 3x - ${b}$, deci $2x = ${a} + ${b} = ${a + b}$ și $x = ${x}$.`);
    }
    const n = R.int(8, 20), y = R.int(2, n - 2);
    const z = n - y;
    return open(`Într-o curte sunt găini și iepuri, în total ${n} capete și ${2 * z + 4 * y} de picioare. Câți iepuri sunt?`, y,
      `Dacă toate ar fi găini: $${n} \\cdot 2 = ${2 * n}$ picioare. Diferența $${2 * z + 4 * y} - ${2 * n} = ${2 * y}$ vine de la iepuri, câte 2 picioare în plus fiecare: $${2 * y} : 2 = ${y}$ iepuri.`);
  });

// tripletele pitagoreice (scalate)
const TRIPLES = [[3, 4, 5], [5, 12, 13], [8, 15, 17], [7, 24, 25], [6, 8, 10], [9, 12, 15], [12, 16, 20], [20, 21, 29]];
def('pitagora', 'teorema lui Pitagora',
  (f) => has(f, /pitagora|ipotenuz|catet/) || (has(f, /dreptunghic/) && has(f, /lungimea|calculati/)),
  (R, lvl) => {
    if (lvl === 3) {
      const a = R.int(1, 7), b = R.int(1, 7);
      const s = a * a + b * b;
      let k = 1, m = s;
      for (let d = Math.floor(Math.sqrt(s)); d > 1; d--) if (s % (d * d) === 0) { k = d; m = s / (d * d); break; }
      if (m === 1) return null;
      return open(`Triunghiul $ABC$ este dreptunghic în $A$, cu $AB = ${a}$ cm și $AC = ${b}$ cm. Calculați lungimea ipotenuzei $BC$ (în cm).`, rad(k, m),
        `Teorema lui Pitagora: $BC^2 = ${a}^2 + ${b}^2 = ${s}$, deci $BC = \\sqrt{${s}} = ${rad(k, m)}$ cm.`);
    }
    const [p, q, h] = R.pick(TRIPLES);
    const k = lvl === 1 ? 1 : R.int(1, 3);
    const A = p * k, B = q * k, C = h * k;
    if (R.r() < 0.5) return open(`Triunghiul $ABC$ este dreptunghic în $A$, cu $AB = ${A}$ cm și $AC = ${B}$ cm. Calculați lungimea ipotenuzei $BC$ (în cm).`, C,
      `Teorema lui Pitagora: $BC^2 = AB^2 + AC^2 = ${A * A} + ${B * B} = ${C * C}$, deci $BC = ${C}$ cm.`);
    return open(`Triunghiul $ABC$ este dreptunghic în $A$, cu ipotenuza $BC = ${C}$ cm și cateta $AB = ${A}$ cm. Calculați lungimea catetei $AC$ (în cm).`, B,
      `Teorema lui Pitagora: $AC^2 = BC^2 - AB^2 = ${C * C} - ${A * A} = ${B * B}$, deci $AC = ${B}$ cm.`);
  });

def('inaltime-catete', 'teorema înălțimii, teorema catetei',
  (f) => has(f, /proiecti|inaltim|\\perp/) && has(f, /dreptunghic/),
  (R) => {
    // BD·DC = AD² cu pătrate perfecte
    const u = R.int(1, 4), v = R.int(u + 1, 6), k = R.int(1, 3);
    const bd = u * u * k, dc = v * v * k;
    if (R.r() < 0.5) return open(`În triunghiul $ABC$, dreptunghic în $A$, $AD \\perp BC$, $D \\in BC$, cu $BD = ${bd}$ cm și $DC = ${dc}$ cm. Calculați lungimea înălțimii $AD$ (în cm).`, u * v * k,
      `Teorema înălțimii: $AD^2 = BD \\cdot DC = ${bd} \\cdot ${dc} = ${bd * dc}$, deci $AD = ${u * v * k}$ cm.`);
    const s = bd * (bd + dc);
    let K = 1, M = s;
    for (let d = Math.floor(Math.sqrt(s)); d > 1; d--) if (s % (d * d) === 0) { K = d; M = s / (d * d); break; }
    return open(`În triunghiul $ABC$, dreptunghic în $A$, $AD \\perp BC$, $D \\in BC$, cu $BD = ${bd}$ cm și $DC = ${dc}$ cm. Calculați lungimea catetei $AB$ (în cm).`, rad(K, M),
      `Teorema catetei: $AB^2 = BD \\cdot BC = ${bd} \\cdot ${bd + dc} = ${s}$, deci $AB = ${rad(K, M)}$ cm.`);
  });

def('trigonometrie-dreptunghic', 'sinus, cosinus, tangentă',
  (f) => has(f, /\\sin|\\cos|\\tg|\\operatorname\{tg\}|sinus|cosinus|tangent/) && has(f, /dreptunghic/),
  (R) => {
    const [p, q, h] = R.pick(TRIPLES.slice(0, 4));
    const k = R.int(1, 3);
    const fn = R.pick(['sin', 'cos', 'tg']);
    const val = fn === 'sin' ? fr(q, h) : fn === 'cos' ? fr(p, h) : fr(q, p);
    const name = fn === 'tg' ? '\\operatorname{tg}' : `\\${fn}`;
    return open(`Triunghiul $ABC$ este dreptunghic în $A$, cu $AB = ${p * k}$ cm, $AC = ${q * k}$ cm și $BC = ${h * k}$ cm. Calculați $${name} B$.`, val,
      `${fn === 'sin' ? `$\\sin B = \\frac{AC}{BC}$ (cateta opusă / ipotenuză)` : fn === 'cos' ? `$\\cos B = \\frac{AB}{BC}$ (cateta alăturată / ipotenuză)` : `$\\operatorname{tg} B = \\frac{AC}{AB}$ (cateta opusă / cateta alăturată)`} $= ${val}$.`);
  });

def('arie-trig', 'arii cu formule trigonometrice',
  (f) => has(f, /aria/) && has(f, /\\sin|30\^|150\^|sinus/),
  (R) => {
    const a = 2 * R.int(2, 10), b = 2 * R.int(2, 10);
    const ang = R.pick([30, 150]);
    return open(`Triunghiul $ABC$ are $AB = ${a}$ cm, $AC = ${b}$ cm și $m(\\angle A) = ${deg(ang)}$. Calculați aria triunghiului (în $\\text{cm}^2$).`, (a * b) / 4,
      `$\\mathcal{A} = \\frac{AB \\cdot AC \\cdot \\sin A}{2} = \\frac{${a} \\cdot ${b} \\cdot \\frac{1}{2}}{2} = ${(a * b) / 4}\\ \\text{cm}^2$ (pentru că $\\sin ${deg(ang)} = \\frac{1}{2}$).`);
  });

def('arii-patrulatere', 'arii ale patrulaterelor',
  (f) => has(f, /aria/) && has(f, /dreptunghi|patrat|paralelogram|trapez|romb/) && !/cub|prism|piramid|cilindr|con\b/.test(f),
  (R) => {
    const t = R.int(0, 4);
    if (t === 0) { const L = R.int(4, 20), l = R.int(2, L); return open(`Un dreptunghi are lungimea ${L} cm și lățimea ${l} cm. Calculați aria lui (în $\\text{cm}^2$).`, L * l, `$\\mathcal{A} = L \\cdot l = ${L} \\cdot ${l} = ${L * l}\\ \\text{cm}^2$.`); }
    if (t === 1) { const b = R.int(4, 20), h = R.int(2, 15); return open(`Un paralelogram are o latură de ${b} cm, iar înălțimea corespunzătoare ei de ${h} cm. Calculați aria paralelogramului (în $\\text{cm}^2$).`, b * h, `$\\mathcal{A} = b \\cdot h = ${b} \\cdot ${h} = ${b * h}\\ \\text{cm}^2$.`); }
    if (t === 2) { const B = R.int(6, 20), b = R.int(2, B - 2), h = 2 * R.int(1, 8); return open(`Un trapez are bazele de ${B} cm și ${b} cm și înălțimea de ${h} cm. Calculați aria trapezului (în $\\text{cm}^2$).`, ((B + b) * h) / 2, `$\\mathcal{A} = \\frac{(B + b) \\cdot h}{2} = \\frac{${B + b} \\cdot ${h}}{2} = ${((B + b) * h) / 2}\\ \\text{cm}^2$.`); }
    if (t === 3) { const d1 = 2 * R.int(2, 10), d2 = R.int(3, 16); return open(`Un romb are diagonalele de ${d1} cm și ${d2} cm. Calculați aria rombului (în $\\text{cm}^2$).`, (d1 * d2) / 2, `$\\mathcal{A} = \\frac{d_1 \\cdot d_2}{2} = \\frac{${d1} \\cdot ${d2}}{2} = ${(d1 * d2) / 2}\\ \\text{cm}^2$.`); }
    const p = 4 * R.int(2, 15);
    return open(`Un pătrat are perimetrul de ${p} cm. Calculați aria pătratului (în $\\text{cm}^2$).`, (p / 4) ** 2, `Latura este $${p} : 4 = ${p / 4}$ cm, iar aria $${p / 4}^2 = ${(p / 4) ** 2}\\ \\text{cm}^2$.`);
  });

def('paralelogram', 'paralelogramul și proprietățile lui',
  (f) => has(f, /paralelogram/) && has(f, /unghi/),
  (R) => {
    const a = R.int(30, 150);
    if (a === 90) return null;
    return open(`Un unghi al paralelogramului $ABCD$ are $${deg(a)}$. Aflați măsura unghiului alăturat lui (în grade).`, 180 - a, `Unghiurile alăturate ale unui paralelogram sunt suplementare: $180 - ${a} = ${180 - a}$, deci $${deg(180 - a)}$.`);
  });

def('diagonale', 'dreptunghi, romb, pătrat',
  (f) => has(f, /diagonal/) && has(f, /patrat|dreptunghi/) && !/cub|paralelipiped/.test(f),
  (R) => {
    if (R.r() < 0.5) { const a = R.int(2, 15); return open(`Un pătrat are latura de ${a} cm. Calculați lungimea diagonalei (în cm).`, rad(a, 2), `Diagonala pătratului de latură $l$ este $l\\sqrt{2}$: $${rad(a, 2)}$ cm (din Pitagora: $d^2 = ${a}^2 + ${a}^2$).`); }
    const [p, q, h] = R.pick(TRIPLES.slice(0, 4)); const k = R.int(1, 3);
    return open(`Un dreptunghi are dimensiunile ${p * k} cm și ${q * k} cm. Calculați lungimea diagonalei (în cm).`, h * k, `Din teorema lui Pitagora: $d^2 = ${p * k}^2 + ${q * k}^2 = ${(h * k) ** 2}$, deci $d = ${h * k}$ cm.`);
  });

def('linia-mijlocie', 'trapezul, linia mijlocie',
  (f) => has(f, /lini[ae]i? mijloci/),
  (R) => {
    const B = R.int(8, 30), b = R.int(2, B - 2);
    if ((B + b) % 2) return null;
    return open(`Un trapez are bazele de ${B} cm și ${b} cm. Calculați lungimea liniei mijlocii (în cm).`, (B + b) / 2, `Linia mijlocie a trapezului este semisuma bazelor: $\\frac{${B} + ${b}}{2} = ${(B + b) / 2}$ cm.`);
  });

def('thales', 'teorema lui Thales',
  (f) => has(f, /thales/) || (has(f, /\\parallel|paralel/) && /\bnc\b/.test(f) && !/\bbc\s*=/.test(f)),
  (R) => {
    const am = R.int(2, 9), mb = R.int(2, 9), k = R.int(1, 3);
    const an = am * k, nc = mb * k;
    return open(`În triunghiul $ABC$, $M \\in AB$, $N \\in AC$ și $MN \\parallel BC$. Știind că $AM = ${am}$ cm, $MB = ${mb}$ cm și $AN = ${an}$ cm, calculați $NC$ (în cm).`, nc,
      `Teorema lui Thales: $\\frac{AM}{MB} = \\frac{AN}{NC}$, adică $\\frac{${am}}{${mb}} = \\frac{${an}}{NC}$, deci $NC = \\frac{${mb} \\cdot ${an}}{${am}} = ${nc}$ cm.`);
  });

def('asemanare', 'teorema fundamentală a asemănării',
  (f) => (has(f, /asemen|asemanar/) || (has(f, /\\parallel|paralel/) && /\bbc\s*=/.test(f))) && !/raportul|\\sim|sunt asemenea/.test(f),
  (R) => {
    const am = R.int(1, 5), mb = R.int(1, 6), bc = (am + mb) * R.int(1, 4);
    const mn = (am * bc) / (am + mb);
    return open(`În triunghiul $ABC$, $M \\in AB$, $N \\in AC$ și $MN \\parallel BC$, cu $AM = ${am}$ cm, $MB = ${mb}$ cm și $BC = ${bc}$ cm. Calculați $MN$ (în cm).`, mn,
      `Din teorema fundamentală a asemănării, $\\triangle AMN \\sim \\triangle ABC$: $\\frac{MN}{BC} = \\frac{AM}{AB} = \\frac{${am}}{${am + mb}}$, deci $MN = \\frac{${am} \\cdot ${bc}}{${am + mb}} = ${mn}$ cm.`);
  });

def('raport-asemanare', 'raportul de asemănare',
  (f) => has(f, /raportul/) && has(f, /asemanare|ariilor|perimetrelor/),
  (R) => {
    let a, b;
    do { a = R.int(1, 5); b = R.int(2, 7); } while (gcd(a, b) !== 1 || a === b);
    if (R.r() < 0.5) return open(`Două triunghiuri asemenea au raportul de asemănare $${fr(a, b)}$. Calculați raportul ariilor lor.`, fr(a * a, b * b), `Raportul ariilor este pătratul raportului de asemănare: $\\left(${fr(a, b)}\\right)^2 = ${fr(a * a, b * b)}$.`);
    const p = a * R.int(2, 6);
    return open(`Triunghiurile $ABC$ și $DEF$ sunt asemenea, cu raportul de asemănare $\\frac{AB}{DE} = ${fr(a, b)}$. Dacă perimetrul triunghiului $ABC$ este ${p} cm, calculați perimetrul triunghiului $DEF$ (în cm).`, (p * b) / a,
      `Perimetrele sunt în același raport: $\\frac{${p}}{P_{DEF}} = ${fr(a, b)}$, deci $P_{DEF} = \\frac{${p} \\cdot ${b}}{${a}} = ${(p * b) / a}$ cm.`);
  });

def('triunghiuri-asemenea', 'triunghiuri asemenea',
  (f) => has(f, /\\sim|sunt asemenea/),
  (R) => {
    const k = R.pick([2, 3, 4]), ab = R.int(2, 9), bc = R.int(2, 12);
    return open(`Triunghiurile $ABC$ și $DEF$ sunt asemenea ($\\triangle ABC \\sim \\triangle DEF$), cu $AB = ${ab}$ cm, $BC = ${bc}$ cm și $DE = ${ab * k}$ cm. Calculați $EF$ (în cm).`, bc * k,
      `Laturile corespunzătoare sunt proporționale: $\\frac{DE}{AB} = \\frac{EF}{BC} = ${k}$, deci $EF = ${k} \\cdot ${bc} = ${bc * k}$ cm.`);
  });

def('cerc-lungime-arie', 'lungimea cercului și aria discului',
  (f) => has(f, /cerc|disc/) && has(f, /lungimea|aria/),
  (R) => {
    const r = R.int(2, 15);
    if (R.r() < 0.5) return open(`Calculați lungimea unui cerc cu raza de ${r} cm (în cm, în funcție de $\\pi$).`, `${2 * r}\\pi`, `$L = 2\\pi r = 2\\pi \\cdot ${r} = ${2 * r}\\pi$ cm.`);
    return open(`Calculați aria unui disc cu raza de ${r} cm (în $\\text{cm}^2$, în funcție de $\\pi$).`, `${r * r}\\pi`, `$\\mathcal{A} = \\pi r^2 = \\pi \\cdot ${r}^2 = ${r * r}\\pi\\ \\text{cm}^2$.`);
  });

def('unghi-inscris', 'unghi la centru, unghi înscris',
  (f) => has(f, /inscris|unghi(ul)? la centru/),
  (R) => {
    const c = 2 * R.int(15, 85);
    if (R.r() < 0.5) return open(`Într-un cerc, unghiul la centru $AOB$ are $${deg(c)}$. Aflați măsura unghiului înscris $ACB$ care cuprinde același arc $AB$ (în grade).`, c / 2, `Unghiul înscris este jumătate din unghiul la centru care subîntinde același arc: $${c} : 2 = ${c / 2}$, deci $${deg(c / 2)}$.`);
    return open(`Unghiul înscris $ACB$ are $${deg(c / 2)}$. Aflați măsura arcului $AB$ cuprins între laturile lui (în grade).`, c, `Arcul cuprins are măsura dublă față de unghiul înscris: $2 \\cdot ${c / 2} = ${c}$, deci $${deg(c)}$.`);
  });

def('coarde-arce', 'coarde și arce',
  (f) => has(f, /\barc/) && has(f, /cerc/) && has(f, /congruent|impartit|coard/),
  (R) => {
    const n = R.pick([3, 4, 5, 6, 8, 9, 10, 12]);
    return open(`Un cerc este împărțit în ${n} arce congruente. Aflați măsura unui arc (în grade).`, 360 / n, `Cercul are $360^{\\circ}$: $360 : ${n} = ${360 / n}$, deci fiecare arc are $${deg(360 / n)}$.`);
  });

def('pozitii-dreapta-cerc', 'poziții relative ale unei drepte față de cerc',
  (f) => has(f, /dreapta/) && has(f, /cerc/) && has(f, /distanta|secant|tangent|exterioar|pozitia/),
  (R) => {
    const r = R.int(3, 12), d = R.int(1, 15);
    const pos = d < r ? 'secantă' : d === r ? 'tangentă' : 'exterioară';
    return choice(R, `Un cerc are raza de ${r} cm, iar distanța de la centrul lui la dreapta $d$ este de ${d} cm. Dreapta $d$ este față de cerc:`, pos,
      ['secantă', 'tangentă', 'exterioară', 'diametru'].filter((x) => x !== pos),
      `Comparăm distanța cu raza: $${d} ${d < r ? '<' : d === r ? '=' : '>'} ${r}$, deci dreapta este ${pos}.`, { math: false });
  });

def('produs-cartezian', 'produs cartezian, sistem de axe',
  (f) => has(f, /\\times|produs cartezian/),
  (R) => {
    const m = R.int(2, 6), n = R.int(2, 6);
    const A = Array.from({ length: m }, (_, i) => i + 1), B = Array.from({ length: n }, (_, i) => i + 1 + m);
    return open(`Fie $A = \\{${A.join(', ')}\\}$ și $B = \\{${B.join(', ')}\\}$. Câte elemente are mulțimea $A \\times B$?`, m * n, `$A \\times B$ conține toate perechile $(a, b)$: $${m} \\cdot ${n} = ${m * n}$ elemente.`);
  });

def('puncte-plan', 'reprezentarea punctelor în plan',
  (f) => has(f, /punctul/) && /\(\s*-?\d+\s*,\s*-?\d+\s*\)/.test(f) && has(f, /distant|ox|oy|origine/),
  (R) => {
    const [p, q, h] = R.pick(TRIPLES.slice(0, 4));
    const x = p * R.pick([1, -1]), y = q * R.pick([1, -1]);
    if (R.r() < 0.5) return open(`Calculați distanța de la punctul $A(${x}, ${y})$ la originea $O$ a sistemului de axe.`, h, `$OA = \\sqrt{${par(x)}^2 + ${par(y)}^2} = \\sqrt{${x * x + y * y}} = ${h}$.`);
    return open(`Calculați distanța de la punctul $A(${x}, ${y})$ la axa $Ox$.`, Math.abs(y), `Distanța la axa $Ox$ este $|y_A| = |${y}| = ${Math.abs(y)}$.`);
  });

def('probabilitate-simpla', 'medii, grafice, probabilități simple',
  (f) => has(f, /probabilitat/),
  (R, lvl) => {
    if (lvl === 1) {
      const a = R.int(1, 9), b = R.int(1, 9);
      return open(`Într-o urnă sunt ${a} bile albe și ${b} bile negre. Care este probabilitatea ca, extrăgând o bilă, aceasta să fie albă?`, fr(a, a + b), `Cazuri favorabile: ${a}, cazuri posibile: ${a + b}, deci $P = ${fr(a, a + b)}$.`);
    }
    const n = R.pick([20, 25, 30, 40, 50, 60]), k = R.pick([2, 3, 4, 5]);
    const fav = Math.floor(n / k);
    return open(`Se alege la întâmplare un număr din mulțimea $\\{1, 2, 3, \\ldots, ${n}\\}$. Care este probabilitatea ca numărul ales să fie divizibil cu ${k}?`, fr(fav, n),
      `Multiplii lui ${k} până la ${n} sunt ${fav} (cazuri favorabile), din ${n} cazuri posibile: $P = \\frac{${fav}}{${n}} = ${fr(fav, n)}$.`);
  });

// ─── Clasa a 8-a ─────────────────────────────────────────────────────────────
def('modul', 'modulul unui număr real',
  (f) => /\|[^|]+\|/.test(f) || has(f, /modulul/),
  (R) => {
    const a = R.nz(-15, 15), b = R.int(1, 9), c = R.int(b + 1, 15);
    const v = Math.abs(a) + Math.abs(b - c);
    return open(`Calculați: $|${a}| + |${b} - ${c}|$.`, v, `$|${a}| = ${Math.abs(a)}$, $|${b} - ${c}| = |${b - c}| = ${c - b}$; suma este ${v}.`);
  });

def('intervale', 'intervale',
  (f) => has(f, /interval/) && /[\[(]\s*-?\d+\s*,\s*-?\d+\s*[\])]/.test(f),
  (R) => {
    const a = R.int(-9, 3), b = R.int(a + 2, 12);
    const lo = R.pick(['(', '[']), hi = R.pick([')', ']']);
    let n = b - a + 1;
    if (lo === '(') n--;
    if (hi === ')') n--;
    return open(`Câte numere întregi aparțin intervalului $${lo}${a}, ${b}${hi}$?`, n,
      `Numerele întregi din interval sunt de la ${lo === '(' ? a + 1 : a} la ${hi === ')' ? b - 1 : b}${lo === '(' ? ` (${a} nu aparține — capăt deschis)` : ''}${hi === ')' ? ` (${b} nu aparține — capăt deschis)` : ''}: ${n} numere.`);
  });

def('inecuatie-gr1', 'inecuații de gradul I',
  (f) => has(f, /inecuati/) || /x\s*[<>]|\\le|\\ge|\\leq|\\geq/.test(f),
  (R) => {
    const a = R.nz(-6, 6), x0 = R.int(-8, 8), b = R.nz(-12, 12);
    const c = a * x0 + b;
    // a·x + b < c ⇔ x < x0 (a > 0) / x > x0 (a < 0)
    const rel = R.pick(['<', '\\le']);
    const sol = a > 0 ? (rel === '<' ? `(-\\infty, ${x0})` : `(-\\infty, ${x0}]`) : (rel === '<' ? `(${x0}, +\\infty)` : `[${x0}, +\\infty)`);
    const flip = a > 0 ? (rel === '<' ? `(${x0}, +\\infty)` : `[${x0}, +\\infty)`) : (rel === '<' ? `(-\\infty, ${x0})` : `(-\\infty, ${x0}]`);
    const bracket = sol.includes(']') || sol.includes('[') ? sol.replace(']', ')').replace('[', '(') : sol.replace(`${x0})`, `${x0}]`).replace(`(${x0}`, `[${x0}`);
    const off = a > 0 ? sol.replace(`${x0}`, `${x0 + 1}`) : sol.replace(`${x0}`, `${x0 - 1}`);
    return choice(R, `Mulțimea soluțiilor reale ale inecuației $${poly([[a, 'x'], [b, '']])} ${rel} ${c}$ este:`, sol, [flip, bracket, off],
      `$${poly([[a, 'x']])} ${rel} ${c - b}$; împărțim la ${a}${a < 0 ? ' (negativ — sensul inegalității se schimbă)' : ''}: $x ${a > 0 ? rel : rel === '<' ? '>' : '\\ge'} ${x0}$, adică $x \\in ${sol}$.`);
  });

def('formule-calcul', 'formulele de calcul prescurtat',
  (f) => /\(\s*[a-z]\s*[+-]\s*\d+\s*\)\^\{?2/.test(f) || has(f, /calcul prescurtat|patratul binomului/),
  (R) => {
    const a = R.int(2, 9), minus = R.r() < 0.5;
    const s = minus ? '-' : '+';
    const right = `x^2 ${s} ${2 * a}x + ${a * a}`;
    return choice(R, `Forma dezvoltată a expresiei $(x ${s} ${a})^2$ este:`, right,
      [`x^2 + ${a * a}`, `x^2 ${s} ${a}x + ${a * a}`, `x^2 ${s} ${2 * a}x - ${a * a}`, `x^2 ${minus ? '+' : '-'} ${2 * a}x + ${a * a}`],
      `$(a ${s} b)^2 = a^2 ${s} 2ab + b^2$: $(x ${s} ${a})^2 = x^2 ${s} 2 \\cdot x \\cdot ${a} + ${a}^2 = ${right}$.`);
  });

def('descompunere', 'descompunerea în factori',
  (f) => has(f, /descompune|factori/) && /x\^2|x\^\{2\}/.test(f),
  (R) => {
    const a = R.int(2, 12);
    if (R.r() < 0.5) {
      return choice(R, `Descompunerea în factori a expresiei $x^2 - ${a * a}$ este:`, `(x - ${a})(x + ${a})`,
        [`(x - ${a})^2`, `(x + ${a})^2`, `(x - ${a * a})(x + 1)`, `x(x - ${a * a})`], `Diferența de pătrate: $x^2 - ${a}^2 = (x - ${a})(x + ${a})$.`);
    }
    return choice(R, `Descompunerea în factori a expresiei $x^2 + ${2 * a}x + ${a * a}$ este:`, `(x + ${a})^2`,
      [`(x - ${a})^2`, `(x - ${a})(x + ${a})`, `x(x + ${2 * a})`, `(x + ${a * a})^2`], `Pătratul unei sume: $x^2 + 2 \\cdot ${a} \\cdot x + ${a}^2 = (x + ${a})^2$.`);
  });

def('fractii-algebrice', 'fracții algebrice',
  (f) => has(f, /simplific/) && /\\frac\{x/.test(f),
  (R) => {
    const a = R.int(1, 9);
    return open(`Simplificați fracția $\\frac{x^2 - ${a * a}}{x + ${a}}$, pentru $x \\neq -${a}$.`, `x - ${a}`,
      `$x^2 - ${a * a} = (x - ${a})(x + ${a})$, deci $\\frac{(x - ${a})(x + ${a})}{x + ${a}} = x - ${a}$.`);
  });

def('expresii-ex', 'expresii E(x)',
  (f) => /e\s*\(\s*x\s*\)/.test(f),
  (R) => {
    const a = R.int(1, 6), k = R.nz(-6, 9);
    // (x + a)^2 - (x - a)^2 = 4ax
    return open(`Se consideră expresia $E(x) = (x + ${a})^2 - (x - ${a})^2$, $x \\in \\mathbb{R}$. Calculați $E(${k})$.`, 4 * a * k,
      `Desfăcând pătratele: $E(x) = x^2 + ${2 * a}x + ${a * a} - x^2 + ${2 * a}x - ${a * a} = ${4 * a}x$, deci $E(${k}) = ${4 * a} \\cdot ${par(k)} = ${4 * a * k}$.`);
  });

def('functie-valoare', 'funcția liniară f(x)=ax+b',
  (f) => /f\s*\(\s*x\s*\)\s*=/.test(f) && !/x\^|\\ln|e\^/.test(f) && has(f, /calculat|f\(-?\d/),
  (R) => {
    const a = R.nz(-6, 6), b = R.nz(-10, 10), k = R.nz(-5, 5);
    return open(`Se consideră funcția $f: \\mathbb{R} \\to \\mathbb{R}$, $f(x) = ${poly([[a, 'x'], [b, '']])}$. Calculați $f(${k})$.`, a * k + b,
      `$f(${k}) = ${a} \\cdot ${par(k)} ${b < 0 ? '-' : '+'} ${Math.abs(b)} = ${a * k} ${b < 0 ? '-' : '+'} ${Math.abs(b)} = ${a * k + b}$.`);
  });

def('functie-grafic-punct', 'reprezentarea grafică',
  (f) => has(f, /graficul/) && has(f, /apartine|punctul/),
  (R) => {
    const a = R.nz(-5, 5), b = R.nz(-9, 9), k = R.nz(-4, 4);
    return open(`Determinați numărul real $m$ pentru care punctul $A(${k}, m)$ aparține graficului funcției $f: \\mathbb{R} \\to \\mathbb{R}$, $f(x) = ${poly([[a, 'x'], [b, '']])}$.`, a * k + b,
      `$A$ aparține graficului dacă $f(${k}) = m$: $m = ${a} \\cdot ${par(k)} ${b < 0 ? '-' : '+'} ${Math.abs(b)} = ${a * k + b}$.`);
  });

def('functie-intersectii', 'intersecțiile graficului cu axele',
  (f) => has(f, /intersecti/) && has(f, /ox|oy|axe/),
  (R) => {
    const a = R.nz(-6, 6), x0 = R.nz(-8, 8), b = -a * x0;
    if (R.r() < 0.5) return open(`Aflați abscisa punctului de intersecție a graficului funcției $f(x) = ${poly([[a, 'x'], [b, '']])}$ cu axa $Ox$.`, x0,
      `Pe $Ox$, $f(x) = 0$: $${poly([[a, 'x'], [b, '']])} = 0$, deci $x = ${x0}$.`);
    return open(`Aflați ordonata punctului de intersecție a graficului funcției $f(x) = ${poly([[a, 'x'], [b, '']])}$ cu axa $Oy$.`, b, `Pe $Oy$, $x = 0$: $f(0) = ${b}$.`);
  });

def('functie-arie', 'distanțe și arii legate de grafic',
  (f) => has(f, /aria/) && has(f, /graficul|axele/),
  (R) => {
    const x0 = R.nz(-6, 6), y0 = R.nz(-8, 8);
    if ((x0 * y0) % 2) return null;
    // f(x) = ax + b, cu f(x0) = 0 și f(0) = y0 ⇒ a = -y0/x0
    if (y0 % x0) return null;
    const a = -y0 / x0;
    return open(`Calculați aria triunghiului determinat de graficul funcției $f(x) = ${poly([[a, 'x'], [y0, '']])}$ și axele de coordonate.`, Math.abs(x0 * y0) / 2,
      `Graficul taie $Ox$ în $(${x0}, 0)$ și $Oy$ în $(0, ${y0})$. Triunghiul este dreptunghic, cu catetele ${Math.abs(x0)} și ${Math.abs(y0)}: $\\mathcal{A} = \\frac{${Math.abs(x0)} \\cdot ${Math.abs(y0)}}{2} = ${Math.abs(x0 * y0) / 2}$.`);
  });

def('functie-notiune', 'noțiunea de funcție',
  (f) => has(f, /f:\s*\\\{|multimea valorilor|suma valorilor/),
  (R) => {
    const a = R.nz(-4, 5), b = R.nz(-6, 6);
    const D = [R.int(-3, 0), R.int(1, 2), R.int(3, 5)];
    const vals = D.map((x) => a * x + b);
    return open(`Se consideră funcția $f: \\{${D.join(', ')}\\} \\to \\mathbb{R}$, $f(x) = ${poly([[a, 'x'], [b, '']])}$. Calculați suma valorilor funcției.`, vals.reduce((s, v) => s + v, 0),
      `$${D.map((x) => `f(${x}) = ${a * x + b}`).join('$, $')}$; suma: $${vals.reduce((s, v) => s + v, 0)}$.`);
  });

def('corpuri-volum', 'prisma dreaptă, paralelipipedul, cubul',
  (f) => has(f, /cub|paralelipiped|prism/) && has(f, /volum|aria|diagonal/),
  (R) => {
    const t = R.int(0, 3);
    if (t === 0) { const a = R.int(2, 10); return open(`Un cub are muchia de ${a} cm. Calculați volumul cubului (în $\\text{cm}^3$).`, a ** 3, `$V = l^3 = ${a}^3 = ${a ** 3}\\ \\text{cm}^3$.`); }
    if (t === 1) { const L = R.int(3, 12), l = R.int(2, 10), h = R.int(2, 10); return open(`Un paralelipiped dreptunghic are dimensiunile ${L} cm, ${l} cm și ${h} cm. Calculați volumul (în $\\text{cm}^3$).`, L * l * h, `$V = L \\cdot l \\cdot h = ${L} \\cdot ${l} \\cdot ${h} = ${L * l * h}\\ \\text{cm}^3$.`); }
    if (t === 2) { const a = R.int(2, 12); return open(`Un cub are muchia de ${a} cm. Calculați aria totală a cubului (în $\\text{cm}^2$).`, 6 * a * a, `$\\mathcal{A}_t = 6l^2 = 6 \\cdot ${a * a} = ${6 * a * a}\\ \\text{cm}^2$.`); }
    const a = R.int(2, 12);
    return open(`Un cub are muchia de ${a} cm. Calculați lungimea diagonalei cubului (în cm).`, rad(a, 3), `Diagonala cubului de muchie $l$ este $l\\sqrt{3}$: $${rad(a, 3)}$ cm.`);
  });

def('piramida', 'piramida și trunchiul de piramidă',
  (f) => has(f, /piramid/) && has(f, /volum/),
  (R) => {
    const l = R.int(2, 12), h = 3 * R.int(1, 6);
    return open(`O piramidă patrulateră regulată are latura bazei de ${l} cm și înălțimea de ${h} cm. Calculați volumul piramidei (în $\\text{cm}^3$).`, (l * l * h) / 3,
      `$V = \\frac{\\mathcal{A}_b \\cdot h}{3} = \\frac{${l}^2 \\cdot ${h}}{3} = \\frac{${l * l * h}}{3} = ${(l * l * h) / 3}\\ \\text{cm}^3$.`);
  });

def('corpuri-rotunde', 'cilindrul, conul, trunchiul de con, sfera',
  (f) => has(f, /cilindr|con|sfer/) && has(f, /volum|aria/),
  (R) => {
    const t = R.int(0, 2);
    const r = R.int(2, 9);
    if (t === 0) { const h = R.int(2, 12); return open(`Un cilindru circular drept are raza bazei de ${r} cm și înălțimea de ${h} cm. Calculați volumul cilindrului (în $\\text{cm}^3$, în funcție de $\\pi$).`, `${r * r * h}\\pi`, `$V = \\pi r^2 h = \\pi \\cdot ${r * r} \\cdot ${h} = ${r * r * h}\\pi\\ \\text{cm}^3$.`); }
    if (t === 1) { const h = 3 * R.int(1, 5); return open(`Un con circular drept are raza bazei de ${r} cm și înălțimea de ${h} cm. Calculați volumul conului (în $\\text{cm}^3$, în funcție de $\\pi$).`, `${(r * r * h) / 3}\\pi`, `$V = \\frac{\\pi r^2 h}{3} = \\frac{\\pi \\cdot ${r * r} \\cdot ${h}}{3} = ${(r * r * h) / 3}\\pi\\ \\text{cm}^3$.`); }
    const R3 = 3 * R.int(1, 3);
    return open(`O sferă are raza de ${R3} cm. Calculați volumul sferei (în $\\text{cm}^3$, în funcție de $\\pi$).`, `${(4 * R3 ** 3) / 3}\\pi`, `$V = \\frac{4\\pi R^3}{3} = \\frac{4\\pi \\cdot ${R3 ** 3}}{3} = ${(4 * R3 ** 3) / 3}\\pi\\ \\text{cm}^3$.`);
  });

def('arii-corpuri', 'arii și volume, secțiuni',
  (f) => has(f, /aria totala|aria laterala/),
  (R) => {
    const L = R.int(3, 12), l = R.int(2, 10), h = R.int(2, 10);
    return open(`Un paralelipiped dreptunghic are dimensiunile ${L} cm, ${l} cm și ${h} cm. Calculați aria totală (în $\\text{cm}^2$).`, 2 * (L * l + L * h + l * h),
      `$\\mathcal{A}_t = 2(Ll + Lh + lh) = 2(${L * l} + ${L * h} + ${l * h}) = ${2 * (L * l + L * h + l * h)}\\ \\text{cm}^2$.`);
  });

def('numere-reale', 'mulțimea numerelor reale',
  (f) => has(f, /irational|rational/) && has(f, /care|numar/),
  (R) => {
    const k = R.pick([4, 9, 16, 25, 36, 49]), m = R.pick(SQF);
    const irr = `\\sqrt{${m}}`;
    return choice(R, `Care dintre următoarele numere este irațional?`, irr, [`\\sqrt{${k}}`, `\\frac{${R.pick([1, 3, 5, 7])}}{8}`, `${R.int(1, 9)}{,}${R.int(1, 9)}`, '-3'],
      `$\\sqrt{${k}} = ${Math.sqrt(k)}$ e număr natural, fracțiile și zecimalele finite sunt raționale; $\\sqrt{${m}}$ nu se poate scrie ca fracție, deci e irațional.`);
  });

// ─── Liceu ───────────────────────────────────────────────────────────────────
def('progresie-aritmetica', 'progresia aritmetică',
  (f) => has(f, /progresi/) && has(f, /aritmetic/),
  (R, lvl) => {
    const a1 = R.int(-10, 15), r = R.nz(-5, 7), n = R.int(5, 15);
    const an = a1 + (n - 1) * r;
    if (lvl < 3) return open(`Fie $(a_n)_{n \\ge 1}$ o progresie aritmetică cu $a_1 = ${a1}$ și rația $r = ${r}$. Calculați $a_{${n}}$.`, an, `$a_n = a_1 + (n - 1)r$: $a_{${n}} = ${a1} + ${n - 1} \\cdot ${par(r)} = ${an}$.`);
    const S = (n * (a1 + an)) / 2;
    return open(`Fie $(a_n)_{n \\ge 1}$ o progresie aritmetică cu $a_1 = ${a1}$ și rația $r = ${r}$. Calculați suma primilor ${n} termeni.`, S, `$a_{${n}} = ${a1} + ${n - 1} \\cdot ${par(r)} = ${an}$, iar $S_{${n}} = \\frac{(a_1 + a_{${n}}) \\cdot ${n}}{2} = \\frac{${a1 + an} \\cdot ${n}}{2} = ${S}$.`);
  });

def('progresie-geometrica', 'progresia geometrică',
  (f) => has(f, /progresi/) && has(f, /geometric/),
  (R) => {
    const b1 = R.nz(-4, 5), q = R.pick([2, 3, -2, -1, 4]), n = R.int(3, 6);
    return open(`Fie $(b_n)_{n \\ge 1}$ o progresie geometrică cu $b_1 = ${b1}$ și rația $q = ${q}$. Calculați $b_{${n}}$.`, b1 * q ** (n - 1), `$b_n = b_1 \\cdot q^{n - 1}$: $b_{${n}} = ${b1} \\cdot ${par(q)}^{${n - 1}} = ${b1} \\cdot ${q ** (n - 1)} = ${b1 * q ** (n - 1)}$.`);
  });

def('siruri-termen', 'șiruri',
  (f) => /a_n\s*=|a_\{n\}\s*=/.test(f) && !/progresi/.test(f),
  (R) => {
    const p = R.nz(-3, 3), q = R.nz(-6, 6), n = R.int(2, 9);
    return open(`Se consideră șirul $(a_n)_{n \\ge 1}$ cu $a_n = ${poly([[1, 'n^2'], [p, 'n'], [q, '']])}$. Calculați $a_{${n}}$.`, n * n + p * n + q, `$a_{${n}} = ${n}^2 ${p < 0 ? '-' : '+'} ${Math.abs(p)} \\cdot ${n} ${q < 0 ? '-' : '+'} ${Math.abs(q)} = ${n * n + p * n + q}$.`);
  });

def('sume-gauss', 'sume remarcabile',
  (f) => /1\s*\+\s*2\s*\+\s*3/.test(f),
  (R) => {
    const n = R.int(10, 100);
    return open(`Calculați suma $1 + 2 + 3 + \\ldots + ${n}$.`, (n * (n + 1)) / 2, `Suma Gauss: $\\frac{n(n + 1)}{2} = \\frac{${n} \\cdot ${n + 1}}{2} = ${(n * (n + 1)) / 2}$.`);
  });

def('functie-compusa', 'proprietăți ale funcțiilor',
  (f) => has(f, /f\(f\(|\\circ|compus/),
  (R) => {
    const a = R.nz(-4, 4), b = R.nz(-5, 5), k = R.nz(-3, 3);
    const v = a * (a * k + b) + b;
    return open(`Se consideră funcția $f: \\mathbb{R} \\to \\mathbb{R}$, $f(x) = ${poly([[a, 'x'], [b, '']])}$. Calculați $(f \\circ f)(${k})$.`, v, `$f(${k}) = ${a * k + b}$, apoi $f(${a * k + b}) = ${a} \\cdot ${par(a * k + b)} ${b < 0 ? '-' : '+'} ${Math.abs(b)} = ${v}$.`);
  });

def('semn-gr1', 'semnul funcției de gradul I',
  (f) => has(f, /cel mai mic numar natural|semnul/) && /f\(x\)/.test(f),
  (R) => {
    const a = R.int(2, 6), x0 = R.int(1, 9), b = -a * x0;
    return open(`Se consideră funcția $f(x) = ${poly([[a, 'x'], [b, '']])}$. Care este cel mai mic număr natural $n$ pentru care $f(n) > 0$?`, x0 + 1,
      `$f(n) > 0 \\iff ${a}n > ${-b} \\iff n > ${x0}$, deci cel mai mic număr natural este ${x0 + 1}.`);
  });

def('gr2-varf', 'vârful parabolei, monotonie, extreme',
  (f) => has(f, /varf|minim|maxim|extrem/) && /x\^2|x\^\{2\}/.test(f),
  (R) => {
    const h = R.nz(-6, 6), k = R.int(-10, 10);
    // f(x) = (x - h)^2 + k = x^2 - 2hx + h^2 + k
    const b = -2 * h, c = h * h + k;
    if (R.r() < 0.5) return open(`Determinați valoarea minimă a funcției $f: \\mathbb{R} \\to \\mathbb{R}$, $f(x) = ${poly([[1, 'x^2'], [b, 'x'], [c, '']])}$.`, k,
      `Vârful parabolei: $x_V = -\\frac{b}{2a} = ${h}$, iar valoarea minimă este $f(${h}) = ${k}$ (sau $y_V = -\\frac{\\Delta}{4a}$).`);
    return open(`Determinați abscisa vârfului parabolei asociate funcției $f(x) = ${poly([[1, 'x^2'], [b, 'x'], [c, '']])}$.`, h, `$x_V = -\\frac{b}{2a} = -\\frac{${b}}{2} = ${h}$.`);
  });

def('viete', 'relațiile lui Viète',
  (f) => has(f, /x_1|x_\{1\}/) && /x\^2|x\^\{2\}/.test(f),
  (R) => {
    const r1 = R.nz(-6, 6), r2 = R.nz(-6, 6);
    const S = r1 + r2, P = r1 * r2;
    if (R.r() < 0.5) return open(`Fie $x_1$, $x_2$ soluțiile ecuației $${poly([[1, 'x^2'], [-S, 'x'], [P, '']])} = 0$. Calculați $x_1^2 + x_2^2$.`, S * S - 2 * P,
      `Viète: $x_1 + x_2 = ${S}$, $x_1 x_2 = ${P}$; $x_1^2 + x_2^2 = (x_1 + x_2)^2 - 2x_1x_2 = ${S * S} - ${par(2 * P)} = ${S * S - 2 * P}$.`);
    return open(`Fie $x_1$, $x_2$ soluțiile ecuației $${poly([[1, 'x^2'], [-S, 'x'], [P, '']])} = 0$. Calculați $x_1 + x_2 + x_1x_2$.`, S + P, `Viète: $x_1 + x_2 = ${S}$ și $x_1 x_2 = ${P}$, deci suma cerută este ${S + P}.`);
  });

def('gr2-inecuatie', 'semnul funcției, inecuații de gradul al II-lea',
  (f) => has(f, /inecuati|numere intregi/) && /x\^2|x\^\{2\}/.test(f),
  (R) => {
    const r1 = R.int(-6, 3), r2 = R.int(r1 + 1, 8);
    const S = r1 + r2, P = r1 * r2;
    return open(`Câte numere întregi verifică inecuația $${poly([[1, 'x^2'], [-S, 'x'], [P, '']])} \\le 0$?`, r2 - r1 + 1,
      `Rădăcinile sunt ${r1} și ${r2}; parabola e sub axă între rădăcini: $x \\in [${r1}, ${r2}]$, adică ${r2 - r1 + 1} numere întregi.`);
  });

def('gr2-grafic', 'graficul funcției de gradul al II-lea',
  (f) => has(f, /graficul/) && /x\^2|x\^\{2\}/.test(f) && has(f, /ox|oy|intersect/),
  (R) => {
    const r1 = R.nz(-6, 6), r2 = R.nz(-6, 6);
    if (r1 === r2) return null;
    return open(`Calculați suma absciselor punctelor de intersecție a graficului funcției $f(x) = ${poly([[1, 'x^2'], [-(r1 + r2), 'x'], [r1 * r2, '']])}$ cu axa $Ox$.`, r1 + r2,
      `Abscisele sunt soluțiile ecuației $f(x) = 0$; suma lor (Viète) este $-\\frac{b}{a} = ${r1 + r2}$ (soluțiile: ${Math.min(r1, r2)} și ${Math.max(r1, r2)}).`);
  });

def('trig-valori', 'reducerea la primul cadran',
  (f) => /\\sin|\\cos|\\operatorname\{tg\}|\\tg/.test(f) && /\d+\^\{?\\circ/.test(f) && !/triunghi/.test(f),
  (R) => {
    const t = R.int(0, 2);
    if (t === 0) return open(`Calculați: $\\sin 150^{\\circ} + \\cos 120^{\\circ}$.`, 0, `$\\sin 150^{\\circ} = \\sin 30^{\\circ} = \\frac{1}{2}$, $\\cos 120^{\\circ} = -\\cos 60^{\\circ} = -\\frac{1}{2}$; suma este 0.`);
    if (t === 1) { const k = R.int(2, 5); return open(`Calculați: $${k}\\sin 30^{\\circ} + \\cos 180^{\\circ}$.`, fr(k - 2, 2), `$\\sin 30^{\\circ} = \\frac{1}{2}$, $\\cos 180^{\\circ} = -1$: $\\frac{${k}}{2} - 1 = ${fr(k - 2, 2)}$.`); }
    return open(`Calculați: $\\operatorname{tg} 135^{\\circ} + \\operatorname{tg} 45^{\\circ}$.`, 0, `$\\operatorname{tg} 135^{\\circ} = -\\operatorname{tg} 45^{\\circ} = -1$ și $\\operatorname{tg} 45^{\\circ} = 1$; suma este 0.`);
  });

def('trig-fundamentala', 'formule trigonometrice fundamentale',
  (f) => /\\sin x|\\cos x/.test(f) && /\\frac/.test(f),
  (R) => {
    const [p, q, h] = R.pick(TRIPLES.slice(0, 4));
    return open(`Știind că $\\sin x = ${fr(p, h)}$ și $x \\in \\left(0, \\frac{\\pi}{2}\\right)$, calculați $\\cos x$.`, fr(q, h),
      `$\\cos^2 x = 1 - \\sin^2 x = 1 - ${fr(p * p, h * h)} = ${fr(q * q, h * h)}$; în cadranul I cosinusul e pozitiv: $\\cos x = ${fr(q, h)}$.`);
  });

def('cerc-trigonometric', 'cercul trigonometric',
  (f) => has(f, /radiani|\\pi/) && /\\sin|\\cos/.test(f),
  (R) => {
    const [ang, val] = R.pick([['\\frac{\\pi}{6}', '\\frac{1}{2}'], ['\\frac{\\pi}{2}', '1'], ['\\pi', '0'], ['\\frac{3\\pi}{2}', '-1']]);
    return open(`Calculați $\\sin ${ang}$.`, val, `Pe cercul trigonometric, $\\sin ${ang} = ${val}$.`);
  });

// teorema cosinusului cu laturi întregi (A = 60° sau 120°)
const COS60 = [[3, 8, 7], [5, 8, 7], [7, 15, 13], [8, 15, 13], [5, 21, 19], [16, 21, 19]];
const COS120 = [[3, 5, 7], [7, 8, 13], [5, 16, 19]];
def('teorema-cosinusului', 'aplicații: teorema sinusurilor, teorema cosinusului',
  (f) => has(f, /teorema cosinusului|teorema sinusurilor/) || (has(f, /triunghi/) && /60\^|120\^/.test(f) && has(f, /latur|bc/)),
  (R) => {
    const big = R.r() < 0.4;
    const [b, c, a] = R.pick(big ? COS120 : COS60);
    const A = big ? 120 : 60;
    return open(`Triunghiul $ABC$ are $AB = ${c}$, $AC = ${b}$ și $m(\\angle A) = ${deg(A)}$. Calculați lungimea laturii $BC$.`, a,
      `Teorema cosinusului: $BC^2 = AB^2 + AC^2 - 2 \\cdot AB \\cdot AC \\cos A = ${c * c} + ${b * b} ${big ? '+' : '-'} ${b * c} = ${a * a}$, deci $BC = ${a}$.`);
  });

def('puteri-rationale', 'puteri cu exponent rațional',
  (f) => /\^\{\s*\\frac|\^\{\d+\/\d+\}/.test(f),
  (R) => {
    const [base, root, pw] = R.pick([[8, 3, 2], [27, 3, 2], [16, 4, 3], [32, 5, 2], [9, 2, 3], [64, 3, 2], [81, 4, 3], [25, 2, 3]]);
    const v = Math.round(Math.pow(base, 1 / root)) ** pw;
    return open(`Calculați: $${base}^{\\frac{${pw}}{${root}}}$.`, v, `$${base}^{\\frac{${pw}}{${root}}} = \\left(\\sqrt[${root}]{${base}}\\right)^{${pw}} = ${Math.round(Math.pow(base, 1 / root))}^{${pw}} = ${v}$.`);
  });

def('radicali-ordin-n', 'radicali de ordin n',
  (f) => /\\sqrt\[\d\]/.test(f),
  (R) => {
    const a = R.int(1, 5), b = R.int(1, 3);
    return open(`Calculați: $\\sqrt[3]{${a ** 3}} + \\sqrt[4]{${b ** 4}}$.`, a + b, `$\\sqrt[3]{${a ** 3}} = ${a}$ și $\\sqrt[4]{${b ** 4}} = ${b}$; suma este ${a + b}.`);
  });

def('logaritmi', 'logaritmi și proprietăți',
  (f) => has(f, /\\log|log_|\\lg|\\ln/) && !/x/.test(f.replace(/\\log|log/g, '')),
  (R, lvl) => {
    if (lvl === 1) {
      const b = R.pick([2, 3, 5]), k = R.int(2, b === 2 ? 6 : 4), c = R.pick([2, 3]), m = R.int(1, 3);
      return open(`Calculați: $\\log_{${b}} ${b ** k} + \\log_{${c}} ${c ** m}$.`, k + m, `$\\log_{${b}} ${b ** k} = ${k}$ (pentru că $${b}^{${k}} = ${b ** k}$) și $\\log_{${c}} ${c ** m} = ${m}$; suma este ${k + m}.`);
    }
    const b = R.pick([2, 3, 6]), k = R.int(2, 4);
    const x = R.pick([2, 3, 4].filter((d) => (b ** k) % d === 0 && d !== b ** k));
    if (!x) return null;
    const y = (b ** k) / x;
    return open(`Calculați: $\\log_{${b}} ${x} + \\log_{${b}} ${y}$.`, k, `$\\log_{${b}} ${x} + \\log_{${b}} ${y} = \\log_{${b}} (${x} \\cdot ${y}) = \\log_{${b}} ${b ** k} = ${k}$.`);
  });

def('ecuatie-exponentiala', 'ecuații exponențiale și logaritmice',
  (f) => /\^\{?x|\^\{[^}]*x/.test(f) || /\\log_?\{?\d+\}?\s*\(?x/.test(f),
  (R) => {
    if (R.r() < 0.5) {
      const b = R.pick([2, 3, 5]), x = R.int(-1, 4), a = R.int(-2, 3), e = x + a;
      if (e < 0 || e > (b === 2 ? 7 : 4)) return null;
      return open(`Rezolvați în $\\mathbb{R}$ ecuația $${b}^{${poly([[1, 'x'], [a, '']])}} = ${b ** e}$.`, x, `$${b ** e} = ${b}^{${e}}$, deci $${poly([[1, 'x'], [a, '']])} = ${e}$ și $x = ${x}$.`);
    }
    const b = R.pick([2, 3]), k = R.int(1, b === 2 ? 5 : 3), c = R.int(-3, 5);
    return open(`Rezolvați în $\\mathbb{R}$ ecuația $\\log_{${b}} (${poly([[1, 'x'], [c, '']])}) = ${k}$.`, b ** k - c, `$${poly([[1, 'x'], [c, '']])} = ${b}^{${k}} = ${b ** k}$, deci $x = ${b ** k - c}$ (care verifică condiția de existență).`);
  });

def('complexe-operatii', 'operații cu numere complexe',
  (f) => /\d\s*[+-]\s*\d*i\b|\bi\^2|\\mathrm\{i\}/.test(f) || has(f, /numar complex|numarul complex/),
  (R) => {
    const a = R.nz(-5, 5), b = R.nz(-5, 5), c = R.nz(-5, 5), d = R.nz(-5, 5);
    const re = a * c - b * d, im = a * d + b * c;
    const z = (x, y) => `${x} ${y < 0 ? '-' : '+'} ${Math.abs(y) === 1 ? '' : Math.abs(y)}i`;
    const askRe = R.r() < 0.5;
    return open(`Calculați ${askRe ? 'partea reală' : 'partea imaginară'} a numărului complex $z = (${z(a, b)})(${z(c, d)})$.`, askRe ? re : im,
      `Desfacem parantezele: $z = ${a} \\cdot ${par(c)} + ${par(a)} \\cdot ${par(d)}i + ${par(b)} \\cdot ${par(c)}i + ${par(b)} \\cdot ${par(d)}i^2$; cu $i^2 = -1$: $z = ${im ? `${re} ${im < 0 ? '-' : '+'} ${Math.abs(im) === 1 ? '' : Math.abs(im)}i` : re}$. ${askRe ? `Partea reală: ${re}` : `Partea imaginară: ${im}`}.`);
  });

def('complexe-modul', 'modulul și conjugatul',
  (f) => has(f, /modulul/) && /i\b/.test(f),
  (R) => {
    const [p, q, h] = R.pick(TRIPLES.slice(0, 4));
    const a = p * R.pick([1, -1]), b = q * R.pick([1, -1]);
    return open(`Calculați modulul numărului complex $z = ${a} ${b < 0 ? '-' : '+'} ${Math.abs(b)}i$.`, h, `$|z| = \\sqrt{${par(a)}^2 + ${par(b)}^2} = \\sqrt{${a * a + b * b}} = ${h}$.`);
  });

def('complexe-forma', 'forma algebrică',
  (f) => has(f, /partea reala|partea imaginara|forma algebrica/),
  (R) => {
    const n = R.pick([2, 3, 4]);
    const vals = { 2: ['2i', 'partea imaginară', 2], 3: ['-2 + 2i', 'partea reală', -2], 4: ['-4', 'partea reală', -4] };
    const [form, part, v] = vals[n];
    return open(`Calculați ${part} a numărului complex $z = (1 + i)^{${n}}$.`, v, `$(1 + i)^2 = 1 + 2i + i^2 = 2i$${n === 3 ? `, $(1 + i)^3 = 2i(1 + i) = 2i - 2$` : n === 4 ? `, $(1 + i)^4 = (2i)^2 = -4$` : ''}; deci $z = ${form}$, iar ${part} este ${v}.`);
  });

def('complexe-ecuatie', 'ecuații de gradul al II-lea cu soluții complexe',
  (f) => /x\^2/.test(f) && has(f, /complex|\\mathbb\{c\}/),
  (R) => {
    const p = R.nz(-4, 4), q = R.int(1, 5);
    // rădăcinile p ± qi: x^2 - 2p x + (p^2 + q^2) = 0
    return open(`Fie $x_1$, $x_2$ soluțiile complexe ale ecuației $${poly([[1, 'x^2'], [-2 * p, 'x'], [p * p + q * q, '']])} = 0$. Calculați $x_1 \\cdot x_2$.`, p * p + q * q,
      `Viète: $x_1 x_2 = \\frac{c}{a} = ${p * p + q * q}$ (soluțiile sunt $${p} \\pm ${q === 1 ? '' : q}i$).`);
  });

def('combinatorica', 'permutări, aranjamente, combinări',
  (f) => /c_\{?\d|a_\{?\d|p_\{?\d|\d!|\\binom/.test(f) || has(f, /combinari|aranjamente|permutari/),
  (R, lvl) => {
    const n = R.int(4, 8), k = R.int(2, 3), m = R.int(3, 5);
    if (lvl === 1) return open(`Calculați: $C_{${n}}^{${k}}$.`, comb(n, k), `$C_{${n}}^{${k}} = \\frac{${n}!}{${k}! \\cdot ${n - k}!} = ${comb(n, k)}$.`);
    return open(`Calculați: $C_{${n}}^{${k}} + A_{${m}}^{2} - P_{3}$.`, comb(n, k) + arr(m, 2) - 6,
      `$C_{${n}}^{${k}} = ${comb(n, k)}$, $A_{${m}}^{2} = ${m} \\cdot ${m - 1} = ${arr(m, 2)}$, $P_3 = 3! = 6$; rezultatul: $${comb(n, k)} + ${arr(m, 2)} - 6 = ${comb(n, k) + arr(m, 2) - 6}$.`);
  });

def('binom-newton', 'binomul lui Newton',
  (f) => has(f, /dezvoltar|binomul/),
  (R) => {
    const n = R.int(4, 9);
    if (R.r() < 0.5) return open(`Calculați suma coeficienților binomiali ai dezvoltării $(a + b)^{${n}}$.`, 2 ** n, `$C_{${n}}^{0} + C_{${n}}^{1} + \\ldots + C_{${n}}^{${n}} = 2^{${n}} = ${2 ** n}$.`);
    const k = R.int(1, 3), c = R.pick([2, 3]);
    return open(`Calculați coeficientul lui $x^{${n - k}}$ din dezvoltarea $(x + ${c})^{${n}}$.`, comb(n, k) * c ** k,
      `Termenul general: $T_{k+1} = C_{${n}}^{k} x^{${n} - k} \\cdot ${c}^k$; pentru $x^{${n - k}}$, $k = ${k}$: $C_{${n}}^{${k}} \\cdot ${c}^{${k}} = ${comb(n, k)} \\cdot ${c ** k} = ${comb(n, k) * c ** k}$.`);
  });

def('numarare', 'probleme de numărare',
  (f) => has(f, /cate numere|in cate moduri|cate submultimi/),
  (R) => {
    const t = R.int(0, 2);
    if (t === 0) { const n = R.int(4, 6), k = 3; return open(`Câte numere de ${k} cifre distincte se pot forma cu cifrele $\\{${Array.from({ length: n }, (_, i) => i + 1).join(', ')}\\}$?`, arr(n, k), `Contează ordinea, cifrele distincte: $A_{${n}}^{${k}} = ${arr(n, k)}$.`); }
    if (t === 1) { const n = R.int(4, 10), k = 2; return open(`În câte moduri se pot alege ${k} elevi dintr-un grup de ${n} elevi?`, comb(n, k), `Nu contează ordinea: $C_{${n}}^{${k}} = \\frac{${n} \\cdot ${n - 1}}{2} = ${comb(n, k)}$.`); }
    const n = R.int(3, 7); return open(`Câte submulțimi are o mulțime cu ${n} elemente?`, 2 ** n, `O mulțime cu $n$ elemente are $2^n$ submulțimi: $2^{${n}} = ${2 ** n}$.`);
  });

def('finante', 'procente, dobânzi, TVA',
  (f) => has(f, /tva|dobanda|scumpi|ieftin|reducere|creste cu|scade cu/),
  (R) => {
    const t = R.int(0, 2);
    if (t === 0) { const p = 100 * R.int(1, 20); return open(`Prețul unui produs fără TVA este ${p} lei. Cât costă produsul cu TVA de $19\\%$ (în lei)?`, (p * 119) / 100, `$${p} + 19\\% \\cdot ${p} = ${p} \\cdot 1{,}19 = ${decTex((p * 119) / 100)}$ lei.`); }
    if (t === 1) { const p = 100 * R.int(1, 30), r = R.pick([5, 10, 20]); return open(`Un produs costă ${p} lei. Prețul crește cu $${r}\\%$, apoi noul preț scade cu $${r}\\%$. Cât costă produsul la final (în lei)?`, decStr(p * (1 + r / 100) * (1 - r / 100)), `După scumpire: $${p} \\cdot ${decTex(1 + r / 100)} = ${decTex(p * (1 + r / 100))}$; după ieftinire: $${decTex(p * (1 + r / 100))} \\cdot ${decTex(1 - r / 100)} = ${decTex(p * (1 + r / 100) * (1 - r / 100))}$ lei — mai puțin decât la început!`); }
    const s = 1000 * R.int(1, 10), r = R.pick([2, 4, 5, 10]);
    return open(`O sumă de ${s} lei este depusă la bancă pentru un an, cu o dobândă anuală de $${r}\\%$. Ce dobândă se obține după un an (în lei)?`, (s * r) / 100, `$${r}\\%$ din ${s} $= \\frac{${r} \\cdot ${s}}{100} = ${(s * r) / 100}$ lei.`);
  });

def('statistica', 'medii statistice, dispersie',
  (f) => has(f, /media|mediana/) && has(f, /date|note|valori/),
  (R) => {
    const n = R.pick([5, 7]);
    const xs = Array.from({ length: n }, () => R.int(4, 10)).sort((a, b) => a - b);
    return open(`Notele unui elev sunt: ${R.shuffle(xs).join(', ')}. Care este mediana acestor note?`, xs[(n - 1) / 2], `Ordonăm crescător: ${xs.join(', ')}; mediana este valoarea din mijloc: ${xs[(n - 1) / 2]}.`);
  });

def('probabilitati', 'probabilități',
  (f) => has(f, /probabilitat/) && has(f, /cifre|doua cifre|multim/),
  (R) => {
    const k = R.pick([2, 3, 5, 9]);
    const fav = Math.floor(99 / k) - Math.floor(9 / k);
    return open(`Calculați probabilitatea ca, alegând la întâmplare un număr de două cifre, acesta să fie divizibil cu ${k}.`, fr(fav, 90),
      `Numere de două cifre: 90 (cazuri posibile). Multiplii lui ${k} de două cifre: ${fav}. $P = \\frac{${fav}}{90} = ${fr(fav, 90)}$.`);
  });

def('dreapta-panta', 'panta unei drepte',
  (f) => has(f, /panta/),
  (R) => {
    const x1 = R.int(-5, 5), y1 = R.int(-5, 5), dx = R.nz(-4, 4), m = R.nz(-4, 4);
    const x2 = x1 + dx, y2 = y1 + m * dx;
    return open(`Calculați panta dreptei $AB$, unde $A(${x1}, ${y1})$ și $B(${x2}, ${y2})$.`, m, `$m_{AB} = \\frac{y_B - y_A}{x_B - x_A} = \\frac{${y2} - ${par(y1)}}{${x2} - ${par(x1)}} = \\frac{${y2 - y1}}{${dx}} = ${m}$.`);
  });

def('dreapta-ecuatie', 'ecuația dreptei',
  (f) => has(f, /dreapta/) && /y\s*=|x\s*[+-]\s*\d*y/.test(f),
  (R) => {
    const m = R.nz(-4, 4), n = R.nz(-6, 6), k = R.nz(-4, 4);
    return open(`Determinați numărul real $a$ pentru care punctul $A(${k}, a)$ se află pe dreapta de ecuație $y = ${poly([[m, 'x'], [n, '']])}$.`, m * k + n, `Coordonatele lui $A$ verifică ecuația: $a = ${m} \\cdot ${par(k)} ${n < 0 ? '-' : '+'} ${Math.abs(n)} = ${m * k + n}$.`);
  });

def('drepte-perpendiculare', 'drepte paralele și perpendiculare',
  (f) => has(f, /perpendicular|paralel/) && has(f, /dreapt/) && /y\s*=/.test(f),
  (R) => {
    const m = R.nz(-5, 5), n = R.nz(-6, 6);
    if (R.r() < 0.5) return open(`Calculați panta unei drepte perpendiculare pe dreapta $d: y = ${poly([[m, 'x'], [n, '']])}$.`, fr(-1, m), `Pantele a două drepte perpendiculare au produsul $-1$: $m' = -\\frac{1}{${m}} = ${fr(-1, m)}$.`);
    return open(`Calculați panta unei drepte paralele cu dreapta $d: y = ${poly([[m, 'x'], [n, '']])}$.`, m, `Dreptele paralele au aceeași pantă: ${m}.`);
  });

def('distante-plan', 'distanțe și arii în plan',
  (f) => /a\(\s*-?\d+\s*,\s*-?\d+\s*\)/.test(f) && has(f, /lungimea|distant|mijloc|aria/),
  (R) => {
    const t = R.int(0, 2);
    const x1 = R.int(-5, 5), y1 = R.int(-5, 5);
    if (t === 0) { const [p, q, h] = R.pick(TRIPLES.slice(0, 4)); const x2 = x1 + p * R.pick([1, -1]), y2 = y1 + q * R.pick([1, -1]); return open(`Calculați lungimea segmentului $AB$, unde $A(${x1}, ${y1})$ și $B(${x2}, ${y2})$.`, h, `$AB = \\sqrt{(${x2} - ${par(x1)})^2 + (${y2} - ${par(y1)})^2} = \\sqrt{${(x2 - x1) ** 2} + ${(y2 - y1) ** 2}} = ${h}$.`); }
    if (t === 1) { const x2 = x1 + 2 * R.nz(-4, 4), y2 = y1 + 2 * R.nz(-4, 4); const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; return open(`Fie $A(${x1}, ${y1})$ și $B(${x2}, ${y2})$. Calculați suma coordonatelor mijlocului segmentului $AB$.`, mx + my, `Mijlocul: $M\\left(\\frac{${x1} + ${par(x2)}}{2}, \\frac{${y1} + ${par(y2)}}{2}\\right) = M(${mx}, ${my})$; suma coordonatelor: ${mx + my}.`); }
    const b = R.int(2, 9), h = 2 * R.int(1, 6);
    return open(`Calculați aria triunghiului $ABC$, unde $A(0, 0)$, $B(${b}, 0)$ și $C(${R.int(-3, 6)}, ${h})$.`, (b * h) / 2, `Baza $AB = ${b}$ (pe axa $Ox$), înălțimea din $C$ este ordonata lui: ${h}. $\\mathcal{A} = \\frac{${b} \\cdot ${h}}{2} = ${(b * h) / 2}$.`);
  });

def('functie-inversa', 'funcții inversabile',
  (f) => has(f, /inversa|f\^\{-1\}/),
  (R) => {
    const a = R.nz(-5, 5), b = R.nz(-8, 8), x = R.nz(-5, 5);
    return open(`Funcția $f: \\mathbb{R} \\to \\mathbb{R}$, $f(x) = ${poly([[a, 'x'], [b, '']])}$ este inversabilă. Calculați $f^{-1}(${a * x + b})$.`, x, `$f^{-1}(${a * x + b}) = y \\iff f(y) = ${a * x + b} \\iff ${a}y ${b < 0 ? '-' : '+'} ${Math.abs(b)} = ${a * x + b}$, deci $y = ${x}$.`);
  });

def('functie-exp-log', 'funcția exponențială',
  (f) => /f\(x\)\s*=\s*\d\^x|f\(x\)\s*=\s*\\log/.test(f),
  (R) => {
    const b = R.pick([2, 3]), m = R.int(1, b === 2 ? 5 : 3), n = R.int(0, 2);
    if (m === n) return null;
    return open(`Se consideră funcția $f: \\mathbb{R} \\to (0, +\\infty)$, $f(x) = ${b}^x$. Calculați $f(${m}) + f(${n})$.`, b ** m + b ** n, `$f(${m}) = ${b}^{${m}} = ${b ** m}$ și $f(${n}) = ${b}^{${n}} = ${b ** n}$; suma este ${b ** m + b ** n}.`);
  });

const det2 = (a, b, c, d) => a * d - b * c;
const mat2 = (a, b, c, d) => `\\begin{pmatrix} ${a} & ${b} \\\\ ${c} & ${d} \\end{pmatrix}`;
def('determinanti', 'determinanți de ordin 2 și 3',
  (f) => has(f, /\\det|determinant|\\begin\{vmatrix\}/),
  (R, lvl) => {
    if (lvl < 3) {
      const a = R.int(-6, 9), b = R.int(-6, 9), c = R.int(-6, 9), d = R.int(-6, 9);
      return open(`Calculați determinantul $\\begin{vmatrix} ${a} & ${b} \\\\ ${c} & ${d} \\end{vmatrix}$.`, det2(a, b, c, d), `$${a} \\cdot ${par(d)} - ${par(b)} \\cdot ${par(c)} = ${a * d} - ${par(b * c)} = ${det2(a, b, c, d)}$.`);
    }
    const m = Array.from({ length: 9 }, () => R.int(-3, 4));
    const [a, b, c, d, e, g, h, i, j] = m;
    const D = a * (e * j - g * i) - b * (d * j - g * h) + c * (d * i - e * h);
    return open(`Calculați determinantul $\\begin{vmatrix} ${a} & ${b} & ${c} \\\\ ${d} & ${e} & ${g} \\\\ ${h} & ${i} & ${j} \\end{vmatrix}$.`, D,
      `Dezvoltăm după prima linie (sau regula lui Sarrus): $${a}(${e} \\cdot ${par(j)} - ${par(g)} \\cdot ${par(i)}) - ${par(b)}(${d} \\cdot ${par(j)} - ${par(g)} \\cdot ${par(h)}) + ${par(c)}(${d} \\cdot ${par(i)} - ${par(e)} \\cdot ${par(h)}) = ${D}$.`);
  });

def('matrice-operatii', 'operații cu matrice',
  (f) => has(f, /matric/) && /\\begin\{pmatrix\}/.test(f) && !/\\det|\^\{-1\}|invers/.test(f),
  (R) => {
    const A = Array.from({ length: 4 }, () => R.int(-3, 4)), B = Array.from({ length: 4 }, () => R.int(-3, 4));
    const [a, b, c, d] = A, [e, g, h, i] = B;
    const P = [a * e + b * h, a * g + b * i, c * e + d * h, c * g + d * i];
    const sum = P.reduce((s, x) => s + x, 0);
    return open(`Fie $A = ${mat2(a, b, c, d)}$ și $B = ${mat2(e, g, h, i)}$. Calculați suma elementelor matricei $A \\cdot B$.`, sum,
      `$A \\cdot B = ${mat2(...P)}$ (linie × coloană), iar suma elementelor este ${sum}.`);
  });

def('matrice-inversa', 'matricea inversă',
  (f) => has(f, /matric/) && has(f, /invers|\^\{-1\}/),
  (R) => {
    // det = 1 ⇒ inversa are elemente întregi
    const [a, b, c, d] = R.pick([[2, 1, 1, 1], [3, 2, 1, 1], [2, 3, 1, 2], [5, 2, 2, 1], [3, 1, 5, 2], [4, 3, 1, 1], [1, 2, 1, 3], [2, 5, 1, 3], [3, 4, 2, 3], [1, 1, 2, 3]]);
    const det = a * d - b * c;
    const inv = [d * det, -b * det, -c * det, a * det];
    return open(`Fie $A = ${mat2(a, b, c, d)}$. Calculați suma elementelor matricei $A^{-1}$.`, inv.reduce((s, x) => s + x, 0),
      `$\\det A = ${det}$, deci $A^{-1} = \\frac{1}{\\det A}${mat2(d, -b, -c, a)} = ${mat2(...inv)}$; suma elementelor: ${inv.reduce((s, x) => s + x, 0)}.`);
  });

def('sistem-parametru', 'sisteme compatibile/incompatibile',
  (f) => has(f, /sistem/) && has(f, /incompatibil|parametr|compatibil determinat/),
  (R) => {
    const a = R.nz(-3, 4), b = R.nz(-3, 4), c = R.int(1, 9), k = R.pick([2, 3, -2]);
    const c2 = k * c + R.nz(-3, 3);
    return open(`Determinați numărul real $m$ pentru care sistemul $\\begin{cases} ${poly([[a, 'x'], [b, 'y']])} = ${c} \\\\ ${poly([[k * a, 'x']])} + my = ${c2} \\end{cases}$ este incompatibil.`, k * b,
      `Sistemul e incompatibil când determinantul e 0 și ecuațiile se contrazic: $\\begin{vmatrix} ${a} & ${b} \\\\ ${k * a} & m \\end{vmatrix} = ${a}m - ${par(k * a * b)} = 0 \\Rightarrow m = ${k * b}$. Atunci a doua ecuație are membrul stâng de ${k} ori primul, dar $${c2} \\neq ${k} \\cdot ${c}$.`);
  });

def('cramer', 'metoda lui Cramer',
  (f) => has(f, /cramer/),
  (R) => {
    const x = R.nz(-5, 6), y = R.nz(-5, 6);
    let a1, b1, a2, b2;
    do { a1 = R.nz(-4, 5); b1 = R.nz(-4, 5); a2 = R.nz(-4, 5); b2 = R.nz(-4, 5); } while (det2(a1, b1, a2, b2) === 0);
    const c1 = a1 * x + b1 * y, c2 = a2 * x + b2 * y;
    const D = det2(a1, b1, a2, b2);
    return open(`Rezolvați prin metoda lui Cramer sistemul $\\begin{cases} ${poly([[a1, 'x'], [b1, 'y']])} = ${c1} \\\\ ${poly([[a2, 'x'], [b2, 'y']])} = ${c2} \\end{cases}$ și scrieți valoarea lui $x$.`, x,
      `$\\Delta = ${D}$, $\\Delta_x = \\begin{vmatrix} ${c1} & ${b1} \\\\ ${c2} & ${b2} \\end{vmatrix} = ${det2(c1, b1, c2, b2)}$, deci $x = \\frac{\\Delta_x}{\\Delta} = ${x}$ (și $y = ${y}$).`);
  });

def('limite-siruri', 'operații cu limite',
  (f) => has(f, /\\lim/) && /n\s*\\to|n\\to/.test(f),
  (R) => {
    const a = R.nz(-6, 6), c = R.int(1, 6), b = R.int(-9, 9), d = R.int(1, 9);
    if (R.r() < 0.6) return open(`Calculați $\\lim\\limits_{n \\to \\infty} \\frac{${poly([[a, 'n^2'], [b, '']])}}{${poly([[c, 'n^2'], [d, 'n']])}}$.`, fr(a, c),
      `Dăm factor comun $n^2$ la numărător și numitor: limita este raportul coeficienților dominanți, $${fr(a, c)}$.`);
    const k = R.int(2, 4);
    return open(`Calculați $\\lim\\limits_{n \\to \\infty} \\left(1 + \\frac{1}{n}\\right)^{${k}n}$.`, `e^{${k}}`, `$\\left(1 + \\frac{1}{n}\\right)^{${k}n} = \\left[\\left(1 + \\frac{1}{n}\\right)^{n}\\right]^{${k}} \\to e^{${k}}$.`);
  });

def('limite-functii', 'limita unei funcții într-un punct',
  (f) => has(f, /\\lim/) && /x\s*\\to/.test(f),
  (R) => {
    const a = R.nz(-6, 6);
    return open(`Calculați $\\lim\\limits_{x \\to ${a}} \\frac{x^2 - ${a * a}}{x ${a < 0 ? '+' : '-'} ${Math.abs(a)}}$.`, 2 * a,
      `Cazul $\\frac{0}{0}$: $x^2 - ${a * a} = (${poly([[1, 'x'], [-a, '']])})(${poly([[1, 'x'], [a, '']])})$, simplificăm: $\\lim\\limits_{x \\to ${a}} (${poly([[1, 'x'], [a, '']])}) = ${2 * a}$.`);
  });

def('asimptote', 'asimptote',
  (f) => has(f, /asimptot/),
  (R) => {
    const a = R.nz(-6, 6), b = R.int(-9, 9), c = R.int(1, 5), d = R.nz(-9, 9);
    if (a * d === b * c) return null;
    if (R.r() < 0.5) return open(`Determinați ecuația asimptotei orizontale spre $+\\infty$ la graficul funcției $f(x) = \\frac{${poly([[a, 'x'], [b, '']])}}{${poly([[c, 'x'], [d, '']])}}$. Scrieți valoarea lui $y$.`, fr(a, c), `$\\lim\\limits_{x \\to \\infty} f(x) = \\frac{${a}}{${c}}$, deci asimptota orizontală este $y = ${fr(a, c)}$.`);
    return open(`Determinați abscisa asimptotei verticale la graficul funcției $f(x) = \\frac{${poly([[a, 'x'], [b, '']])}}{${poly([[c, 'x'], [d, '']])}}$.`, fr(-d, c), `Numitorul se anulează în $x = ${fr(-d, c)}$ (iar numărătorul nu), deci asimptota verticală este $x = ${fr(-d, c)}$.`);
  });

def('continuitate', 'funcții continue',
  (f) => has(f, /continu/),
  (R) => {
    const k = R.int(-2, 3), p = R.nz(-4, 4), q = R.int(-5, 5);
    // f(x) = ax + 1 pentru x ≤ k, x^2 + p x + q pentru x > k  ⇒  a·k + 1 = k² + p·k + q
    if (k === 0) return null;
    const rhs = k * k + p * k + q - 1;
    if (rhs % k) return null;
    const a = rhs / k;
    return open(`Determinați numărul real $a$ pentru care funcția $f: \\mathbb{R} \\to \\mathbb{R}$, $f(x) = \\begin{cases} ax + 1, & x \\le ${k} \\\\ ${poly([[1, 'x^2'], [p, 'x'], [q, '']])}, & x > ${k} \\end{cases}$ este continuă.`, a,
      `Continuitate în ${k}: $${k}a + 1 = ${k}^2 ${p < 0 ? '-' : '+'} ${Math.abs(p)} \\cdot ${par(k)} ${q < 0 ? '-' : '+'} ${Math.abs(q)} = ${k * k + p * k + q}$, deci $a = ${a}$.`);
  });

def('derivate', 'derivata unei funcții',
  (f) => has(f, /f'|f\^\{\\prime\}|derivat/),
  (R, lvl) => {
    const a = R.nz(-3, 3), b = R.nz(-5, 5), c = R.int(-6, 6), k = R.nz(-3, 3);
    if (lvl < 3) return open(`Se consideră funcția $f: \\mathbb{R} \\to \\mathbb{R}$, $f(x) = ${poly([[a, 'x^3'], [b, 'x^2'], [c, 'x'], [R.int(-9, 9), '']])}$. Calculați $f'(${k})$.`, 3 * a * k * k + 2 * b * k + c,
      `$f'(x) = ${poly([[3 * a, 'x^2'], [2 * b, 'x'], [c, '']])}$, deci $f'(${k}) = ${3 * a * k * k + 2 * b * k + c}$.`);
    const m = R.int(1, 5);
    return open(`Se consideră funcția $f: (0, +\\infty) \\to \\mathbb{R}$, $f(x) = ${poly([[m, 'x^2']])} + \\ln x$. Calculați $f'(1)$.`, 2 * m + 1, `$f'(x) = ${2 * m}x + \\frac{1}{x}$, deci $f'(1) = ${2 * m} + 1 = ${2 * m + 1}$.`);
  });

def('lhospital', "regula lui l'Hospital",
  (f) => has(f, /\\lim/) && /e\^|\\ln|\\sin/.test(f) && /x\s*\\to\s*0|x\\to0/.test(f),
  (R) => {
    const a = R.int(2, 7);
    if (R.r() < 0.5) return open(`Calculați $\\lim\\limits_{x \\to 0} \\frac{e^{${a}x} - 1}{x}$.`, a, `Cazul $\\frac{0}{0}$; cu regula lui l'Hospital: $\\lim\\limits_{x \\to 0} \\frac{${a}e^{${a}x}}{1} = ${a}$.`);
    return open(`Calculați $\\lim\\limits_{x \\to 0} \\frac{\\sin ${a}x}{x}$.`, a, `Cazul $\\frac{0}{0}$; cu regula lui l'Hospital: $\\lim\\limits_{x \\to 0} \\frac{${a}\\cos ${a}x}{1} = ${a}$.`);
  });

def('extreme', 'monotonie și puncte de extrem',
  (f) => has(f, /extrem|minim local|maxim local|monoton/),
  (R) => {
    const k = R.int(1, 5);
    const min = R.r() < 0.5;
    return open(`Se consideră funcția $f: \\mathbb{R} \\to \\mathbb{R}$, $f(x) = x^3 - ${3 * k * k}x$. Determinați abscisa punctului de ${min ? 'minim' : 'maxim'} local.`, min ? k : -k,
      `$f'(x) = 3x^2 - ${3 * k * k} = 3(x - ${k})(x + ${k})$; $f'$ e pozitivă, negativă, apoi pozitivă: maxim local în $x = -${k}$, minim local în $x = ${k}$.`);
  });

def('inflexiune', 'convexitate, puncte de inflexiune',
  (f) => has(f, /inflexiune|convex|concav/),
  (R) => {
    const a = R.nz(-4, 4), b = R.int(-5, 5);
    return open(`Determinați abscisa punctului de inflexiune al graficului funcției $f(x) = ${poly([[1, 'x^3'], [-3 * a, 'x^2'], [b, 'x']])}$.`, a, `$f''(x) = ${poly([[6, 'x'], [-6 * a, '']])}$ se anulează și schimbă semnul în $x = ${a}$.`);
  });

def('legi-compozitie', 'legi de compoziție',
  (f) => /\\circ|\\ast|\*/.test(f) && has(f, /lege|x\s*\\circ\s*y|x\s*\*\s*y/),
  (R) => {
    const k = R.int(1, 4), c = R.int(0, 3);
    // x∘y = (x - k)(y - k) + k + c — scrisă desfăcut
    const lawText = poly([[1, 'xy'], [-k, 'x'], [-k, 'y'], [k * k + k + c, '']]);
    const x = R.int(-2, 6), y = R.int(-2, 6);
    const v = (x - k) * (y - k) + k + c;
    return open(`Pe mulțimea numerelor reale se definește legea de compoziție $x \\circ y = ${lawText}$. Calculați $${x} \\circ ${y}$.`, v,
      `$${x} \\circ ${y} = ${x} \\cdot ${par(y)} - ${k} \\cdot ${par(x)} - ${k} \\cdot ${par(y)} + ${k * k + k + c} = ${v}$ (sau, mai rapid, $x \\circ y = (x - ${k})(y - ${k}) + ${k + c}$).`);
  });

def('polinoame-rest', 'teorema împărțirii cu rest, teorema lui Bézout',
  (f) => has(f, /rest/) && has(f, /polinom|imparti/),
  (R) => {
    const a = R.nz(-3, 3), b = R.int(-5, 5), c = R.int(-5, 5), d = R.int(-9, 9), r = R.nz(-3, 3);
    const v = a * r ** 3 + b * r * r + c * r + d;
    return open(`Determinați restul împărțirii polinomului $f = ${poly([[a, 'X^3'], [b, 'X^2'], [c, 'X'], [d, '']])}$ la $X ${r < 0 ? '+' : '-'} ${Math.abs(r)}$.`, v,
      `Teorema restului: restul împărțirii la $X - ${par(r)}$ este $f(${r}) = ${v}$.`);
  });

def('polinoame-viete', 'rădăcini, relațiile lui Viète',
  (f) => has(f, /polinom/) && has(f, /radacin|x_1/),
  (R) => {
    const a = R.pick([1, 1, 2]), b = R.int(-6, 6), c = R.int(-6, 6), d = R.nz(-9, 9);
    const sum = fr(-b, a), prod = fr(-d, a);
    const askSum = R.r() < 0.5;
    return open(`Fie $x_1, x_2, x_3$ rădăcinile polinomului $f = ${poly([[a, 'X^3'], [b, 'X^2'], [c, 'X'], [d, '']])}$. Calculați ${askSum ? '$x_1 + x_2 + x_3$' : '$x_1 x_2 x_3$'}.`, askSum ? sum : prod,
      `Relațiile lui Viète pentru gradul 3: $x_1 + x_2 + x_3 = -\\frac{b}{a} = ${sum}$, $x_1x_2x_3 = -\\frac{d}{a} = ${prod}$.`);
  });

def('polinoame-valoare', 'operații cu polinoame',
  (f) => has(f, /polinom/) && /f\(\s*-?\d+\s*\)/.test(f),
  (R) => {
    const a = R.nz(-3, 3), b = R.int(-5, 5), c = R.int(-6, 6), k = R.nz(-3, 3);
    return open(`Se consideră polinomul $f = ${poly([[a, 'X^2'], [b, 'X'], [c, '']])}$. Calculați $f(${k})$.`, a * k * k + b * k + c, `$f(${k}) = ${a} \\cdot ${par(k)}^2 ${b < 0 ? '-' : '+'} ${Math.abs(b)} \\cdot ${par(k)} ${c < 0 ? '-' : '+'} ${Math.abs(c)} = ${a * k * k + b * k + c}$.`);
  });

def('primitive', 'primitiva unei funcții',
  (f) => has(f, /primitiv/),
  (R) => {
    const a = R.nz(-3, 3), b = R.int(-5, 5), c = R.int(-5, 5);
    // F(x) = a x^3 + b x^2 + c x + F(0)
    const F0 = R.int(-5, 5), k = R.nz(-2, 2);
    const v = a * k ** 3 + b * k * k + c * k + F0;
    return open(`Fie $F$ primitiva funcției $f(x) = ${poly([[3 * a, 'x^2'], [2 * b, 'x'], [c, '']])}$ cu $F(0) = ${F0}$. Calculați $F(${k})$.`, v,
      `$F(x) = ${poly([[a, 'x^3'], [b, 'x^2'], [c, 'x']])} + C$, iar $F(0) = ${F0}$ dă $C = ${F0}$. Deci $F(${k}) = ${v}$.`);
  });

def('integrala', 'formula Leibniz–Newton',
  (f) => has(f, /\\int/),
  (R, lvl) => {
    if (lvl === 3) {
      if (R.r() < 0.5) return open(`Calculați $\\int_{1}^{e} \\frac{1}{x}\\,dx$.`, 1, `$\\int_{1}^{e} \\frac{1}{x}\\,dx = \\ln x \\Big|_{1}^{e} = \\ln e - \\ln 1 = 1$.`);
      return open(`Calculați $\\int_{0}^{1} e^{x}\\,dx$.`, 'e - 1', `$\\int_{0}^{1} e^{x}\\,dx = e^{x} \\Big|_{0}^{1} = e - 1$.`);
    }
    const a = R.nz(-3, 3), b = R.int(-4, 4), m = R.int(1, 3);
    // ∫_0^m (3a x² + 2b x) dx = a m³ + b m²
    const v = a * m ** 3 + b * m * m;
    return open(`Calculați $\\int_{0}^{${m}} (${poly([[3 * a, 'x^2'], [2 * b, 'x']])})\\,dx$.`, v,
      `O primitivă este $F(x) = ${poly([[a, 'x^3'], [b, 'x^2']])}$; Leibniz–Newton: $F(${m}) - F(0) = ${v}$.`);
  });

def('integrala-proprietati', 'proprietăți ale integralei definite',
  (f) => has(f, /\\int/) && /f\(x\)\s*\\?,?\s*dx\s*=\s*-?\d/.test(f),
  (R) => {
    const p = R.int(-5, 9), q = R.int(-5, 9), k = R.int(2, 5);
    return open(`Știind că $\\int_{0}^{1} f(x)\\,dx = ${p}$ și $\\int_{0}^{1} g(x)\\,dx = ${q}$, calculați $\\int_{0}^{1} (${k}f(x) - g(x))\\,dx$.`, k * p - q, `Integrala e liniară: $${k} \\cdot ${par(p)} - ${par(q)} = ${k * p - q}$.`);
  });

def('arie-integrala', 'aria unei suprafețe plane',
  (f) => has(f, /aria/) && has(f, /\\int|graficul|subgrafic/),
  (R) => {
    const a = R.pick([3, 6, 9]), m = R.int(1, 3);
    // aria sub f(x) = m·x² pe [0, a] = m a³ / 3
    return open(`Calculați aria suprafeței plane delimitate de graficul funcției $f(x) = ${poly([[m, 'x^2']])}$, axa $Ox$ și dreptele $x = 0$, $x = ${a}$.`, (m * a ** 3) / 3,
      `$\\mathcal{A} = \\int_{0}^{${a}} ${m === 1 ? '' : m}x^2\\,dx = ${m === 1 ? '' : m}\\frac{x^3}{3} \\Big|_{0}^{${a}} = ${(m * a ** 3) / 3}$.`);
  });

def('volum-rotatie', 'volumul corpurilor de rotație',
  (f) => has(f, /volum/) && has(f, /rotati/),
  (R) => {
    const a = R.pick([3, 6]);
    // V = π ∫_0^a x² dx = π a³/3
    return open(`Calculați volumul corpului obținut prin rotația în jurul axei $Ox$ a graficului funcției $f: [0, ${a}] \\to \\mathbb{R}$, $f(x) = x$ (în funcție de $\\pi$).`, `${a ** 3 / 3}\\pi`,
      `$V = \\pi \\int_{0}^{${a}} f^2(x)\\,dx = \\pi \\int_{0}^{${a}} x^2\\,dx = \\pi \\frac{${a}^3}{3} = ${a ** 3 / 3}\\pi$.`);
  });

// ═════════════════════════════════════════════════════════════════════════════
// CAPITOLELE ACOPERITE: capitol → generatoarele lui (cele mai multe subiecte ale
// capitolului au un generator; altfel capitolul rămâne la model)
// ═════════════════════════════════════════════════════════════════════════════
const CHAPTERS = {
  'c5-naturale': ['ordinea-op', 'puteri'],
  'c5-divizibilitate': ['divizibilitate', 'divizori'],
  'c5-metode': ['reducere-unitate', 'metoda-comparatiei', 'metoda-figurativa'],
  'c5-fractii-ordinare': ['fractii-adunare', 'fractii-inmultire', 'fractii-simplificare', 'fractie-din-numar'],
  'c5-fractii-zecimale': ['zecimale-operatii', 'zecimale-transformare', 'zecimale-comparare', 'media-aritmetica'],
  'c5-geometrie': ['segmente', 'perimetre', 'unitati-masura'],
  'c6-multimi': ['multimi-operatii', 'factori-primi', 'cmmdc-cmmmc'],
  'c6-rapoarte': ['rapoarte', 'proportii', 'procente', 'direct-proportionale', 'regula-de-trei'],
  'c6-intregi': ['intregi-comparare', 'intregi-operatii', 'puteri-intregi', 'ecuatie-simpla'],
  'c6-rationale': ['rationale-operatii', 'ecuatii-rationale', 'probleme-rationale'],
  'c6-geometrie-drepte': ['unghiuri-opuse', 'unghiuri-complementare', 'paralele-secanta', 'bisectoare'],
  'c6-triunghi': ['triunghi-unghiuri', 'triunghi-isoscel', 'mediana-ipotenuza'],
  'c7-reale': ['radical-patrat', 'radical-scoatere', 'radicali-operatii', 'rationalizare', 'media-geometrica'],
  'c7-ecuatii': ['ecuatie-gr1', 'sistem-2x2', 'probleme-ecuatii'],
  'c7-date': ['produs-cartezian', 'puncte-plan', 'probabilitate-simpla'],
  'c7-patrulatere': ['paralelogram', 'diagonale', 'linia-mijlocie', 'arii-patrulatere'],
  'c7-asemanare': ['thales', 'asemanare', 'triunghiuri-asemenea', 'raport-asemanare'],
  'c7-metrice': ['inaltime-catete', 'pitagora', 'trigonometrie-dreptunghic', 'arie-trig'],
  'c7-cerc': ['unghi-inscris', 'coarde-arce', 'cerc-lungime-arie', 'pozitii-dreapta-cerc'],
  'c8-intervale': ['numere-reale', 'modul', 'intervale', 'inecuatie-gr1'],
  'c8-calcul-algebric': ['formule-calcul', 'descompunere', 'fractii-algebrice', 'expresii-ex'],
  'c8-functii': ['functie-notiune', 'functie-valoare', 'functie-grafic-punct', 'functie-intersectii', 'functie-arie'],
  'c8-corpuri': ['corpuri-volum', 'piramida', 'corpuri-rotunde', 'arii-corpuri'],
  'c9-siruri': ['siruri-termen', 'progresie-aritmetica', 'progresie-geometrica', 'sume-gauss'],
  'c9-functii-gr1': ['functie-compusa', 'functie-valoare', 'semn-gr1', 'inecuatie-gr1'],
  'c9-functia-gr2': ['gr2-grafic', 'gr2-varf', 'gr2-inecuatie', 'viete'],
  'c9-trigonometrie': ['cerc-trigonometric', 'trig-valori', 'trig-fundamentala', 'teorema-cosinusului'],
  'c10-puteri-radicali': ['puteri-rationale', 'radicali-ordin-n', 'logaritmi', 'ecuatie-exponentiala'],
  'c10-functii': ['functie-exp-log', 'functie-compusa', 'functie-inversa'],
  'c10-complexe': ['complexe-forma', 'complexe-operatii', 'complexe-modul', 'complexe-ecuatie'],
  'c10-numarare': ['combinatorica', 'binom-newton', 'numarare'],
  'c10-finante': ['finante', 'statistica', 'probabilitati'],
  'c10-geometrie-analitica': ['dreapta-ecuatie', 'dreapta-panta', 'drepte-perpendiculare', 'distante-plan'],
  'c11-matrice': ['matrice-operatii', 'determinanti', 'matrice-inversa'],
  'c11-sisteme': ['cramer', 'sistem-2x2', 'sistem-parametru'],
  'c11-limite-siruri': ['limite-siruri'],
  'c11-limite-functii': ['limite-functii', 'asimptote', 'continuitate'],
  'c11-derivate': ['derivate', 'lhospital'],
  'c11-grafic': ['extreme', 'inflexiune'],
  'c12-polinoame': ['polinoame-valoare', 'polinoame-rest', 'polinoame-viete'],
  'c12-integrala': ['integrala', 'integrala-proprietati'],
  'c12-aplicatii': ['arie-integrala', 'volum-rotatie'],
  // recapitulările de EN (lacunele din anii anteriori)
  'en-rec-numere': ['ordinea-op', 'divizibilitate', 'fractii-adunare', 'intregi-operatii', 'procente'],
  'en-rec-geometrie': ['unghiuri-complementare', 'triunghi-unghiuri', 'arii-patrulatere', 'perimetre'],
};

const LEVEL = { 'ușor': 1, usor: 1, mediu: 2, greu: 3, dificil: 3 };
const levelOf = (difficulty) => LEVEL[String(difficulty || '').toLowerCase()] || 2;

// O întrebare dintr-un generator (cu încercări, ca numerele „nefrumoase" să cadă)
function makeOne(id, R, lvl, seen) {
  const g = GEN[id];
  if (!g) return null;
  for (let t = 0; t < 30; t++) {
    let q = null;
    try { q = g.make(R, lvl); } catch { q = null; }
    if (!q || !q.statement || q.answer == null || q.answer === '' || /NaN|undefined|Infinity/.test(`${q.statement}|${q.answer}|${(q.options || []).join('|')}`)) continue;
    if (seen.has(q.statement)) continue;
    seen.add(q.statement);
    return { ...q, topic: g.topic, gen: id };
  }
  return null;
}

// `count` întrebări din generatoarele date, pe rând (câte un tip pe rând), cu
// nivelurile date (un nivel sau o listă, câte unul pe întrebare)
function makeSet(ids, count, R, levels) {
  const out = [];
  const seen = new Set();
  const order = R.shuffle(ids);
  for (let i = 0, miss = 0; out.length < count && miss < ids.length * 3; i++) {
    const lvl = Array.isArray(levels) ? levels[Math.min(out.length, levels.length - 1)] : levels;
    const q = makeOne(order[i % order.length], R, lvl, seen);
    if (q) out.push(q); else miss++;
  }
  return out;
}

// generatorul de ACELAȘI TIP cu un exercițiu greșit (pentru remediere)
function matchMistake(mistake, chapterId = null) {
  const f = fold(mistake?.statement || '');
  if (!f) return null;
  // o demonstrație nu e de același tip cu un calcul („Arătați că…" → modelul)
  if (/\b(demonstrati|aratati|justificati|verificati) ca\b/.test(f)) return null;
  const hits = Object.values(GEN).filter((g) => { try { return g.match(f); } catch { return false; } });
  if (!hits.length) return null;
  const list = CHAPTERS[chapterId] || [];
  if (!list.length) return hits.length === 1 ? hits[0].id : null;   // fără capitol: doar o potrivire sigură
  const inChapter = hits.filter((g) => list.includes(g.id)).sort((a, b) => list.indexOf(a.id) - list.indexOf(b.id));
  if (!inChapter.length) return null;
  return (inChapter.find((g) => g.topic === mistake?.topic) || inChapter[0]).id;
}

const covered = (chapterId) => Array.isArray(CHAPTERS[chapterId]) && CHAPTERS[chapterId].length > 0;

// ─── Cererea de la med.genQuestions ─────────────────────────────────────────
// → { questions, rest } | null. `rest` (doar la evaluare) = capitolele rămase
//   pentru model: { count, chapterIds }.
function forRequest({ purpose, chapterId = null, mistake = null, chapterIds = null, difficulty = 'mediu', count = 10, seed = null } = {}) {
  if (!enabled() || !count) return null;
  const R = rngFrom(seed);
  const lvl = levelOf(difficulty);
  if (purpose === 'remediere') {
    const id = matchMistake(mistake, chapterId);
    if (!id) return null;
    // „la aceeași dificultate sau puțin mai simple": jumătate la nivelul 1
    const levels = Array.from({ length: count }, (_, i) => (i < Math.ceil(count / 2) ? 1 : 2));
    const qs = makeSet([id], count, R, levels);
    return qs.length >= count ? { questions: qs, rest: null } : null;
  }
  if (['exersare', 'tema', 'recapitulare'].includes(purpose)) {
    if (!covered(chapterId)) return null;
    // de la simplu la complex: primele la nivelul cerut minus unu
    const levels = Array.from({ length: count }, (_, i) => Math.max(1, Math.min(3, lvl + (i < count / 3 ? -1 : i >= (2 * count) / 3 ? 1 : 0))));
    const qs = makeSet(CHAPTERS[chapterId], count, R, purpose === 'exersare' ? levels : lvl);
    return qs.length >= count ? { questions: qs.map((q) => ({ ...q, chapter: chapterId })), rest: null } : null;
  }
  if (purpose === 'evaluare' && Array.isArray(chapterIds) && chapterIds.length) {
    // `count` locuri, răspândite uniform pe capitole; de la ușor la greu
    const n = chapterIds.length;
    const slots = n <= count
      ? Array.from({ length: count }, (_, i) => chapterIds[i % n])
      : Array.from({ length: count }, (_, i) => chapterIds[Math.floor((i * n) / count)]);
    const questions = [];
    const aiSlots = [];
    const seen = new Set();
    slots.forEach((cid, i) => {
      const l = i < count / 3 ? 1 : i < (2 * count) / 3 ? 2 : 3;
      let q = null;
      if (covered(cid)) {
        const ids = R.shuffle(CHAPTERS[cid]);
        for (const id of ids) { q = makeOne(id, R, l, seen); if (q) break; }
      }
      if (q) questions.push({ ...q, chapter: cid, slot: i });
      else aiSlots.push({ slot: i, chapter: cid });
    });
    return { questions, rest: aiSlots.length ? { count: aiSlots.length, chapterIds: [...new Set(aiSlots.map((s) => s.chapter))], slots: aiSlots.map((s) => s.slot) } : null };
  }
  return null;
}

module.exports = {
  enabled, rngFrom, forRequest, makeSet, makeOne, matchMistake, covered, levelOf,
  GEN, CHAPTERS, fr, red, gcd, rad, poly,
};
