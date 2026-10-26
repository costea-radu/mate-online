// =====================================================================
// src/lib/mathPlain.js — răspunsurile scrise cu TASTATURA MATEMATICĂ (LaTeX)
//
// · latexToPlain: forma „simplă" a unui răspuns LaTeX, cum l-ar scrie elevul fără
//   tastatură — „\frac{1}{2}" → „1/2", „2\sqrt{3}" → „2√3", „x^{2}+1" → „x^2+1".
//   Folosită când elevul trece înapoi la text („Abc") și la demo-ul fără server.
//   (Serverul are aceeași idee în api/_lib/mathcheck.js → plainForm, plus tot restul.)
// · looksLatex: răspunsul vine de la tastatură (se afișează cu KaTeX)
// · preferința „√x / Abc" a elevului, ținută în browser
// =====================================================================
export const looksLatex = (s) => /\\[a-zA-Z]|[\^_]\{|\\\{/.test(String(s || ''));

// forma scurtă pe care o dă editorul (MathLive) pentru o fracție / un radical cu câte o cifră:
// „\frac34", „\sqrt2" → „\frac{3}{4}", „\sqrt{2}" (aceeași formulă, mai ușor de citit de profesor,
// de corectare și de orice alt cititor de LaTeX). Un argument scurt = o cifră, o literă sau o
// constantă (\pi, \infty, literele grecești) — ca în TeX, unde \frac34 înseamnă \frac{3}{4}.
const TOK = String.raw`(\\(?:pi|infty|alpha|beta|gamma|delta|Delta|theta|lambda|mu|varphi|phi|omega)(?![a-zA-Z])|[0-9A-Za-z])`;
const FRAC_SHORT = new RegExp(String.raw`\\([dtc]?frac)\s*` + TOK + String.raw`\s*` + TOK, 'g');
const SQRT_SHORT = new RegExp(String.raw`\\sqrt\s*` + TOK, 'g');
export function expandTex(latex) {
  return String(latex ?? '').replace(FRAC_SHORT, '\\$1{$2}{$3}').replace(SQRT_SHORT, '\\sqrt{$1}');
}

// simbolurile tastaturii → caracterul lor (granița: nicio literă după, ca „\in" ≠ „\infty")
const SYMBOLS = [
  ['cdot', '·'], ['times', '·'], ['div', ':'], ['pm', '±'], ['mp', '∓'], ['approx', '≈'],
  ['leq', '≤'], ['le', '≤'], ['geq', '≥'], ['ge', '≥'], ['neq', '≠'], ['ne', '≠'],
  ['notin', '∉'], ['in', '∈'], ['cup', '∪'], ['cap', '∩'], ['setminus', '\\'], ['subseteq', '⊆'], ['subset', '⊂'],
  ['emptyset', '∅'], ['varnothing', '∅'], ['forall', '∀'], ['exists', '∃'],
  ['Rightarrow', '⇒'], ['implies', '⇒'], ['Leftrightarrow', '⇔'], ['iff', '⇔'], ['to', '→'], ['rightarrow', '→'],
  ['int', '∫'], ['sum', 'Σ'], ['triangle', '△'], ['parallel', '∥'], ['perp', '⊥'], ['equiv', '≡'], ['sim', '~'], ['angle', '∢'],
  ['alpha', 'α'], ['beta', 'β'], ['gamma', 'γ'], ['delta', 'δ'], ['Delta', 'Δ'], ['theta', 'θ'], ['lambda', 'λ'], ['mu', 'μ'],
  ['varphi', 'φ'], ['phi', 'φ'], ['omega', 'ω'], ['pi', 'π'], ['infty', '∞'],
];
const FUNCS = /\\(ln|lg|log|sin|cos|tg|ctg|tan|cot|arcsin|arccos|arctg|arctan|det|lim|max|min|rang|rank)(?![a-zA-Z])/g;

export function latexToPlain(latex) {
  let t = String(latex ?? '').replace(/\$/g, '').trim();
  if (!t) return '';
  // matricele → [[1, 2], [3, 4]]; determinantul → det([[…]]) (ca pe server: „, " nu e virgulă zecimală)
  t = t.replace(/\\begin\{([pbBvV]?matrix)\}([\s\S]*?)\\end\{\1\}/g, (m, env, body) => {
    const rows = body.split(/\\\\/).map((r) => r.trim()).filter(Boolean).map((r) => r.split('&').map((c) => c.trim() || '0'));
    const lit = `[${rows.map((r) => `[${r.join(', ')}]`).join(', ')}]`;
    return /^[vV]matrix$/.test(env) ? `det(${lit})` : lit;
  });
  t = t.replace(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g, '')
    .replace(/\{,\}/g, ',')
    .replace(/\\lbrace|\\\{/g, '{').replace(/\\rbrace|\\\}/g, '}')
    .replace(/\\left\s*\\?([({[|.])|\\right\s*\\?([)}\]|.])/g, (m, a, b) => ((a || b) === '.' ? '' : (a || b)))
    .replace(/\\(?:Big|big|Bigg|bigg)[lr]?\s*\|/g, '|')
    .replace(/\\(?:[lr]?vert|mid)(?![a-zA-Z])/g, '|')
    .replace(/\^\s*\{\s*\\circ\s*\}|\^\s*\\circ(?![a-zA-Z])|\\degree(?![a-zA-Z])/g, '°')
    .replace(/\\%/g, '%')
    .replace(/\{\}\^\{t\}\s*(?:\\!\s*)?/g, 'ᵗ')                       // transpusa: {}^{t}A → ᵗA
    .replace(/\\operatorname\*?\{([^{}]*)\}/g, '$1')
    .replace(/\\mathbb\{([A-Za-z])\}/g, (m, l) => ({ R: 'ℝ', N: 'ℕ', Z: 'ℤ', Q: 'ℚ', C: 'ℂ' }[l] || l))
    .replace(/\\mathrm\{([^{}]*)\}/g, '$1');
  t = expandTex(t)                     // forma scurtă a editorului: „\frac34", „\sqrt2"
    .replace(/\\pi(?![a-zA-Z])/g, 'π').replace(/\\infty(?![a-zA-Z])/g, '∞');
  for (let i = 0; i < 6; i++) {
    const prev = t;
    t = t.replace(/\\[dtc]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, (m, a, b, at, all) => {
      const wrap = (x) => (/^[\w.,√π]+$/.test(x.trim()) ? x.trim() : `(${x.trim()})`);
      const f = `${wrap(a)}/${wrap(b)}`;
      // „\frac{1}{2}x" → „(1/2)x" (nu „1/2x", care s-ar citi 1/(2x)); la fel înainte de √, (, cifră
      return /^\s*(?:[\w(√∛π]|\\(?:sqrt|pi|left|frac|ln|log|sin|cos))/.test(all.slice(at + m.length)) ? `(${f})` : f;
    })
      .replace(/\\sqrt\s*\[\s*3\s*\]\s*\{([^{}]*)\}/g, (m, x) => (/^[\w.,]+$/.test(x.trim()) ? `∛${x.trim()}` : `∛(${x.trim()})`))
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, '($2)^(1/($1))')
      // „\sqrt{2}x" → „√(2)x" (nu „√2x", care s-ar citi √(2x))
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, (m, x, at, all) => (/^[\w.,π]+$/.test(x.trim()) && !/^[\w.(]/.test(all.slice(at + m.length)) ? `√${x.trim()}` : `√(${x.trim()})`))
      .replace(/\\(?:vec|overrightarrow)\s*\{([^{}]*)\}/g, '$1⃗')
      .replace(/\\(?:widehat|hat)\s*\{([^{}]*)\}/g, '∢$1')
      .replace(/\\overline\s*\{([^{}]*)\}/g, '[$1]')
      .replace(/\\text\s*\{([^{}]*)\}/g, '$1');
    if (t === prev) break;
  }
  t = t.replace(/\^\s*\{([^{}]*)\}/g, (m, x) => (/^[\w.]+$/.test(x.trim()) ? `^${x.trim()}` : `^(${x.trim()})`))
    .replace(/_\s*\{([^{}]*)\}/g, '_$1')
    .replace(FUNCS, '$1');
  for (const [name, ch] of SYMBOLS) t = t.replace(new RegExp(`\\\\${name}(?![a-zA-Z])`, 'g'), ch);
  t = t.replace(/\\[,;!:]|\\quad|\\qquad/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

const PREF = 'mate_tastatura';
export function mathPref() { try { return localStorage.getItem(PREF) === 'math' ? 'math' : 'text'; } catch { return 'text'; } }
export function setMathPref(v) { try { localStorage.setItem(PREF, v === 'math' ? 'math' : 'text'); } catch { /* mod privat */ } }
