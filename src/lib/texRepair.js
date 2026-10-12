// =====================================================================
// src/lib/texRepair.js — FORMULELE STRICATE, în browser (katex.js → renderMath)
//
// LaTeX-ul pe care KaTeX nu-l poate afișa (ex. „2\begin{pmatrix}1-\frac{1}{6}\right)" —
// o paranteză înaltă din PDF citită ca matrice) se repară înainte de afișare; ce nu
// se poate repara apare ca text simplu („8/3 − 2(1 − 1/6)"), nu ca LaTeX brut, cu roșu.
// OGLINDA lui api/_lib/texRepair.js (sursa, cu toate explicațiile): codul dintre
// marcajele „COD COMUN" e IDENTIC — test/formule-reparate.test.js verifică.
// Modifică ACOLO, apoi copiază aici.
// =====================================================================

// ── COD COMUN (identic în api/_lib/texRepair.js și src/lib/texRepair.js) ─────
// mediile „matrice" și parantezele lor: o „matrice" fără & și fără \\ e, de fapt, o
// paranteză înaltă (citită greșit din PDF) → \left( … \right)
const TEX_MATRIX = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['\\{', '\\}'], vmatrix: ['|', '|'], Vmatrix: ['\\|', '\\|'], matrix: ['', ''], smallmatrix: ['', ''] };

// \begin{X} / \end{X} fără pereche
function texFixEnvs(t) {
  const toks = [];
  const re = /\\(begin|end)\s*\{([a-zA-Z]+\*?)\}/g;
  let m;
  while ((m = re.exec(t))) toks.push({ kind: m[1], env: m[2], at: m.index, len: m[0].length });
  const open = [], bad = [];
  for (const k of toks) {
    if (k.kind === 'begin') { open.push(k); continue; }
    let j = open.length - 1;
    while (j >= 0 && open[j].env !== k.env) j--;
    if (j < 0) { bad.push(k); continue; }
    for (const x of open.splice(j + 1)) bad.push(x);   // deschise înăuntru, rămase fără pereche
    open.pop();
  }
  for (const x of open) bad.push(x);
  if (!bad.length) return t;
  bad.sort((a, b) => b.at - a.at);                      // de la coadă: indicii rămân valabili
  let out = t, tail = '';
  for (const k of bad) {
    const br = TEX_MATRIX[k.env];
    let rep = '';
    if (k.kind === 'begin') {
      // un mediu cu conținut adevărat (coloane, rânduri) se închide la sfârșit
      if (!br || /&|\\\\/.test(out.slice(k.at + k.len))) { tail = `\\end{${k.env}}${tail}`; continue; }
      rep = br[0] ? `\\left${br[0]}` : '';
    } else rep = br && br[1] ? `\\right${br[1]}` : '';
    out = out.slice(0, k.at) + rep + out.slice(k.at + k.len);
  }
  return out + tail;
}

// \left și \right fără pereche → doar parantezele (o paranteză simplă nu dă eroare)
function texStripLeftRight(t) {
  return t.replace(/\\(?:left|right)\s*\.(?![a-zA-Z])/g, '').replace(/\\(?:left|right)(?![a-zA-Z])\s*/g, '');
}
function texFixLeftRight(t) {
  const n = (re) => (t.match(re) || []).length;
  return n(/\\left(?![a-zA-Z])/g) === n(/\\right(?![a-zA-Z])/g) ? t : texStripLeftRight(t);
}

// acoladele: cele în plus se scot, cele care lipsesc se închid la sfârșit
function texFixBraces(t) {
  let depth = 0, out = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '\\') { out += c + (i + 1 < t.length ? t[i + 1] : ''); i++; continue; }
    if (c === '{') depth++;
    else if (c === '}') { if (!depth) continue; depth--; }
    out += c;
  }
  return out + '}'.repeat(depth);
}

// LaTeX-ul reparat (cât mai puțin schimbat) sau null; parses(t) → true dacă KaTeX îl afișează
function repairTex(tex, parses) {
  const src = String(tex == null ? '' : tex);
  if (!parses || parses(src)) return src;
  let t = src;
  for (const f of [texFixEnvs, texFixLeftRight, texFixBraces, texStripLeftRight]) {
    const next = f(t);
    if (next === t) continue;
    t = next;
    if (parses(t)) return t;
  }
  return null;
}

// ─── Ultima rezervă: formula ca text simplu ───────────────────────────────────
const TEX_SYM = {
  cdot: '·', times: '×', div: ':', pm: '±', mp: '∓', le: '≤', leq: '≤', leqslant: '≤', ge: '≥', geq: '≥', geqslant: '≥',
  neq: '≠', ne: '≠', approx: '≈', equiv: '≡', sim: '∼', infty: '∞', pi: 'π', alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ',
  Delta: 'Δ', epsilon: 'ε', varepsilon: 'ε', theta: 'θ', lambda: 'λ', mu: 'μ', sigma: 'σ', Sigma: 'Σ', omega: 'ω', Omega: 'Ω',
  phi: 'φ', varphi: 'φ', rho: 'ρ', tau: 'τ', in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', cup: '∪', cap: '∩',
  emptyset: '∅', varnothing: '∅', Rightarrow: '⇒', implies: '⇒', Leftrightarrow: '⇔', iff: '⇔', Leftarrow: '⇐', rightarrow: '→',
  to: '→', leftarrow: '←', mapsto: '↦', forall: '∀', exists: '∃', angle: '∠', measuredangle: '∡', perp: '⊥', parallel: '∥',
  circ: '∘', degree: '°', ldots: '…', cdots: '⋯', dots: '…', vdots: '⋮', prime: '′', lt: '<', gt: '>', mid: '|', vert: '|',
  lvert: '|', rvert: '|', Vert: '‖', triangle: '△', square: '□', quad: ' ', qquad: ' ', displaystyle: '', limits: '', nolimits: '',
  tg: 'tg', ctg: 'ctg', tan: 'tg', cot: 'ctg', sin: 'sin', cos: 'cos', log: 'log', ln: 'ln', lg: 'lg', lim: 'lim', max: 'max', min: 'min',
  det: 'det', int: '∫', sum: 'Σ', prod: 'Π', partial: '∂', nabla: '∇', neg: '¬', land: '∧', lor: '∨', wedge: '∧', vee: '∨',
};
const TEX_SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', '′': '′' };
const TEX_SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎', n: 'ₙ', i: 'ᵢ', k: 'ₖ', x: 'ₓ', a: 'ₐ', e: 'ₑ', o: 'ₒ', m: 'ₘ', p: 'ₚ', t: 'ₜ' };
const texMapAll = (s, map) => (s && [...s].every((ch) => map[ch]) ? [...s].map((ch) => map[ch]).join('') : null);

function texText(tex) {
  let t = String(tex == null ? '' : tex).replace(/\\\{/g, '\u0001').replace(/\\\}/g, '\u0002');
  t = t.replace(/\\(?:text|textrm|textbf|textit|textup|mathrm|mathbf|mathit|operatorname|mbox|boldsymbol)\s*\{([^{}]*)\}/g, '$1');
  t = t.replace(/\\mathbb\s*\{?\s*([RNZQC])\s*\}?/g, (m, c) => ({ R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ' })[c]);
  // „matricele" → parantezele lor; celelalte medii dispar
  t = t.replace(/\\(begin|end)\s*\{([a-zA-Z]+)\*?\}(?:\{[^{}]*\})?/g, (m, k, env) => {
    const br = TEX_MATRIX[env];
    return br ? (k === 'begin' ? br[0] : br[1]).replace(/\\/g, '') : ' ';
  }).replace(/&/g, ' ').replace(/\\\\/g, '; ');
  t = texStripLeftRight(t).replace(/\\(?:big|Big|bigg|Bigg)[lr]?(?![a-zA-Z])/g, '');
  // gradele („30^\circ", „30^{\circ}"), apoi simbolurile (ca „\frac{\pi}{2}" să devină „π/2", nu „(π)/2")
  t = t.replace(/\^\s*\{?\s*\\circ\s*\}?/g, '°');
  t = t.replace(/\\([a-zA-Z]+)/g, (m, name) => (Object.prototype.hasOwnProperty.call(TEX_SYM, name) ? TEX_SYM[name] : m));
  const grp = (x) => { const y = x.trim(); return /^[\p{L}\p{N}.,′']+$/u.test(y) ? y : `(${y})`; };
  for (let k = 0; k < 30; k++) {                        // din interior spre exterior
    const before = t;
    t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (m, a, b) => `${grp(a)}/${grp(b)}`)
      .replace(/\\[dt]?frac\s*(\d)\s*(\d)/g, '$1/$2')
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, (m, n, x) => `${texMapAll(n.trim(), TEX_SUP) || n.trim()}√${grp(x)}`)
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, (m, x) => `√${grp(x)}`)
      .replace(/\\(?:overline|overrightarrow|vec|widehat|hat|bar|underline|tilde|dot)\s*\{([^{}]*)\}/g, '$1')
      .replace(/\^\s*\{([^{}]*)\}/g, (m, x) => texMapAll(x.trim(), TEX_SUP) || `^(${x.trim()})`)
      .replace(/_\s*\{([^{}]*)\}/g, (m, x) => texMapAll(x.trim(), TEX_SUB) || `_(${x.trim()})`);
    if (t === before) break;
  }
  t = t.replace(/\^\s*([0-9a-z+-])/g, (m, c) => TEX_SUP[c] || `^${c}`)
    .replace(/_\s*([0-9a-z])/g, (m, c) => TEX_SUB[c] || `_${c}`);
  t = t.replace(/\\([a-zA-Z]+)/g, '$1');                // comenzile rămase: doar numele
  t = t.replace(/\\([%$#&_|])/g, '$1').replace(/\\[,;:! ]/g, ' ');
  t = t.replace(/[{}]/g, '').replace(/\u0001/g, '{').replace(/\u0002/g, '}');
  return t.replace(/\s+/g, ' ').trim();
}

// textul simplu, ca formulă KaTeX care nu poate eșua: \text{…} cu caracterele speciale scăpate
function texAsText(tex) {
  const s = texText(tex).replace(/[\\{}$%#&_^~]/g, (c) => ({ '\\': '/', '{': '\\{', '}': '\\}', $: '\\$', '%': '\\%', '#': '\\#', '&': '\\&', _: '\\_', '^': 'ˆ', '~': '∼' })[c]);
  return `\\text{${s}}`;
}
// ── SFÂRȘIT COD COMUN ─────────────────────────────────────────────────────────

export { repairTex, texText, texAsText };
