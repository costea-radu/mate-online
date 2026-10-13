// =====================================================================
// api/_lib/texRepair.js — FORMULELE STRICATE (LaTeX pe care KaTeX nu-l poate afișa)
//
// Modelele greșesc uneori LaTeX-ul când citesc formulele din paginile PDF — ex.
// paranteza înaltă din „2(1 − 1/6)" citită ca matrice: „2\begin{pmatrix}1-\frac{1}{6}\right)"
// (fără \end, cu un \right fără \left). KaTeX nu o poate afișa, iar în sală apărea
// textul brut, cu roșu. Aici:
//   repairTex(tex, parses) → LaTeX-ul reparat (mediile fără pereche, \left/\right
//                            dezechilibrate, acoladele), sau null dacă nu se poate;
//   texText(tex)           → formula ca text simplu („8/3 − 2(1 − 1/6)"), ultima rezervă;
//   texAsText(tex)         → același text, ca formulă KaTeX care nu poate eșua (\text{…});
//   fixMathText(text)      → (doar pe server) repară formulele $…$ dintr-un text, la
//                            scrierea lecțiilor (liveLesson.normalizeItems).
// OGLINDA: src/lib/texRepair.js are ACELAȘI cod între marcajele „COD COMUN" (în
// browser, katex.js → renderMath îl folosește la fiecare formulă: și lecțiile scrise
// înainte se văd corect). test/formule-reparate.test.js verifică. Modifică AICI, apoi copiază.
// =====================================================================

// ── COD COMUN (identic în api/_lib/texRepair.js și src/lib/texRepair.js) ─────
// mediile „matrice" și parantezele lor: o „matrice" fără & și fără \\ e, de fapt, o
// paranteză înaltă (citită greșit din PDF) → \left( … \right)
const TEX_MATRIX = { pmatrix: ['(', ')'], bmatrix: ['[', ']'], Bmatrix: ['\\{', '\\}'], vmatrix: ['|', '|'], Vmatrix: ['\\|', '\\|'], matrix: ['', ''], smallmatrix: ['', ''] };

// Backslash-urile PIERDUTE în JSON: un model care scrie „\infty", „\mathbb" cu UN singur
// backslash produce, după decodare, caractere de control („\t" → TAB, „\f" → FF, „\b" →
// BS…) sau escape-uri rămase ca text („\u001bmathbb"). Le refacem comenzi LaTeX: TAB +
// „o" → „\to", <control> + „infty" → „\infty", „\u001bmathbb" → „\mathbb"; celelalte
// caractere de control dispar (rândul nou rămâne).
const TEX_CTRL = { '\t': '\\t', '\f': '\\f', '\b': '\\b', '\v': '\\v', '\r': '\\r' };
function texFixControl(t) {
  const s = String(t == null ? '' : t);
  if (!/[\u0000-\u0009\u000b-\u001f\u007f]|\\u00[01][0-9a-fA-F]/.test(s)) return s;
  return s
    .replace(/\\u00[01][0-9a-fA-F](?=[a-zA-Z])/g, '\\')
    .replace(/\\u00[01][0-9a-fA-F]/g, '')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, (c, i, all) => (/[a-zA-Z]/.test(all[i + 1] || '') ? (TEX_CTRL[c] || '\\') : (c === '\t' ? ' ' : '')));
}

// ℝ citit greșit din textul extras („f: 0 → 0", în PDF-urile cu fontul MathType): o funcție
// „f: 0 → 0" nu apare în subiecte — e mereu f: ℝ → ℝ
function texFixSets(t) {
  return t.replace(/(\b[a-zA-Z]\s*:\s*)0(\s*(?:\\to|\\rightarrow|→)\s*)0(?![\d.])/g, '$1\\mathbb{R}$2\\mathbb{R}');
}

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
  // întâi backslash-urile pierdute (altfel KaTeX „trece" peste TAB+„o") și ℝ citit „0"
  const src = texFixSets(texFixControl(tex));
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
  let t = texFixControl(tex).replace(/\\\{/g, '\u0001').replace(/\\\}/g, '\u0002');
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
  return t.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
}

// textul simplu, ca formulă KaTeX care nu poate eșua: \text{…} cu caracterele speciale scăpate
function texAsText(tex) {
  const s = texText(tex).replace(/[\\{}$%#&_^~]/g, (c) => ({ '\\': '/', '{': '\\{', '}': '\\}', $: '\\$', '%': '\\%', '#': '\\#', '&': '\\&', _: '\\_', '^': 'ˆ', '~': '∼' })[c]);
  return `\\text{${s}}`;
}
// ── SFÂRȘIT COD COMUN ─────────────────────────────────────────────────────────

// ─── Pe server: formulele dintr-un text, verificate cu KaTeX ─────────────────
let katex = null;
try { katex = require('katex'); } catch { /* fără KaTeX: textul rămâne cum e */ }
const parses = (t) => {
  try { katex.renderToString(t, { throwOnError: true, strict: 'ignore' }); return true; } catch { return false; }
};

// „… $\frac{8}{3}-2\begin{pmatrix}1-\frac{1}{6}\right)$ …" → „… $\frac{8}{3}-2\left(1-\frac{1}{6}\right)$ …".
// Formulele care nu se pot repara rămân (browserul le arată ca text simplu).
function fixMathText(text) {
  if (typeof text !== 'string' || !text) return text;
  // în formule: backslash-urile pierdute (caractere de control, „\u001b") și rândurile noi
  // (un rând nou în $…$ rupea formula în două, iar perechile de $ se amestecau)
  let t = text.replace(/\$\$[\s\S]*?\$\$|\$[^$]*\$/g, (m) => texFixControl(m).replace(/\n/g, ' '));
  // în afara formulelor, caracterele de control nu au ce căuta
  t = t.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ');
  if (!katex || t.indexOf('$') === -1) return t;
  return t.replace(/\$\$([^$]+)\$\$|\$([^$]+)\$/g, (m, disp, inl) => {
    const tex = disp != null ? disp : inl;
    const fixed = repairTex(tex, parses);
    if (fixed == null || fixed === tex) return m;
    return disp != null ? `$$${fixed}$$` : `$${fixed}$`;
  });
}

// o formulă din text pe care KaTeX nu o poate afișa nici după reparare (null = toate merg)
function brokenMath(text) {
  if (!katex || typeof text !== 'string' || text.indexOf('$') === -1) return null;
  for (const m of text.matchAll(/\$\$([^$]+)\$\$|\$([^$]+)\$/g)) {
    const tex = m[1] != null ? m[1] : m[2];
    if (repairTex(tex, parses) == null) return tex;
  }
  return null;
}

module.exports = { repairTex, texFixControl, texText, texAsText, fixMathText, brokenMath, parses };
