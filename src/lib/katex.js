// =====================================================================
// src/lib/katex.js — încărcare KaTeX la cerere (din CDN) + randare formule
// =====================================================================
let loadingPromise = null;
const KATEX_VER = '0.16.11';

export function ensureKatex() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.renderMathInElement) return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  loadingPromise = new Promise((resolve) => {
    // CSS
    if (!document.getElementById('katex-css')) {
      const css = document.createElement('link');
      css.id = 'katex-css';
      css.rel = 'stylesheet';
      css.href = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VER}/dist/katex.min.css`;
      document.head.appendChild(css);
    }
    // katex.min.js → apoi auto-render
    const s1 = document.createElement('script');
    s1.src = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VER}/dist/katex.min.js`;
    s1.onload = () => {
      const s2 = document.createElement('script');
      s2.src = `https://cdn.jsdelivr.net/npm/katex@${KATEX_VER}/dist/contrib/auto-render.min.js`;
      s2.onload = () => resolve();
      s2.onerror = () => resolve(); // degradare grațioasă: rămâne textul brut
      document.head.appendChild(s2);
    };
    s1.onerror = () => resolve();
    document.head.appendChild(s1);
  });
  return loadingPromise;
}

export function renderMath(el) {
  if (!el || typeof window === 'undefined' || !window.renderMathInElement) return;
  try {
    window.renderMathInElement(el, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
      ignoredTags: ['script', 'noscript', 'style', 'textarea', 'pre', 'code'],
    });
  } catch { /* ignorăm erorile de randare */ }
}

// ─────────────────────────────────────────────────────────────────────
// autoMath: încadrează automat LaTeX „gol" (fără $...$) în $...$, ca să
// se randeze chiar dacă modelul a uitat delimitatorii.
// Nu atinge ce e deja între $...$, $$...$$, \(...\), \[...\].
// ─────────────────────────────────────────────────────────────────────
const CMDS = 'cdot|times|div|pm|mp|angle|pi|alpha|beta|gamma|delta|theta|lambda|mu|omega|leq|geq|le|ge|neq|approx|equiv|infty|circ|Delta|Omega|deg|notin|in|subseteq|subset|supset|cup|cap|Rightarrow|rightarrow|leftarrow|to|forall|exists';

function wrapBare(s) {
  if (!s) return s;
  // grade scrise stricat în text: „70^∘" / „70^{∘}" (caret literal) → „70°"
  s = s.replace(/(\d)\s*\^\s*(?:\{\s*[∘°]\s*\}|[∘°])/g, '$1°');
  // \frac{..}{..}
  s = s.replace(/\\frac\s*\{[^{}]*\}\s*\{[^{}]*\}/g, (m) => '$' + m + '$');
  // \sqrt[..]{..} sau \sqrt{..}
  s = s.replace(/\\sqrt\s*(\[[^\]]*\])?\s*\{[^{}]*\}/g, (m) => '$' + m + '$');
  // puteri / indici: x^2, a_1, x^{10}, a_{n}, 4(10)^3, (x+1)^2, [a]_n, 70^\circ
  // Baza cu paranteze e prinsă ÎNTREAGĂ (cu tot cu coeficient), altfel „$"
  // ar cădea în mijlocul expresiei: 4(10)^3 devenea 4(10$)^3$ (roșu, nerandat).
  // Exponentul poate fi și o COMANDĂ (\circ): altfel „70^\circ" rămânea
  // „70^" + „∘" — caretul apărea literal în enunț (eroarea de redactare).
  s = s.replace(/((?:\d+[A-Za-z]?)?\([^()]*\)|\[[^\][]*\]|\d+(?:[.,]\d+)?|[A-Za-z0-9])(\^|_)(\{[^{}]*\}|\\[a-zA-Z]+|[A-Za-z0-9]+)/g, (m) => '$' + m + '$');
  // comenzile rămase se încadrează DOAR în afara zonelor deja împachetate mai
  // sus (altfel \circ din „$70^\circ$" se re-împacheta și strica expresia)
  const cmdRe = new RegExp('\\\\(' + CMDS + ')\\b', 'g');
  s = s.split(/(\$[^$]*\$)/g).map((seg, i) => (i % 2 === 1 ? seg : seg.replace(cmdRe, (m) => '$' + m + '$'))).join('');
  // colapsează încadrările alăturate ($$ apărut din tokeni lipiți) → un spațiu
  s = s.replace(/\$\s*\$/g, ' ');
  return s;
}

// Propoziții românești împachetate GREȘIT în $...$ (modelul pune uneori tot
// enunțul în math mode → cuvinte italice lipite: „Știindcăm(∠B)"). Le scoatem
// din matematică și re-încadrăm DOAR bucățile cu adevărat matematice.
const ROM_TEXT_RE = /[ăâîșțĂÂÎȘȚ]|(?:^|[^\\a-zA-Z])(și|sau|este|sunt|fie|dacă|atunci|deci|află|arată|calculează|determină|știind|unghiul|unghiului|triunghiul|laturile|numerele|valoarea)(?![a-zA-Z])/i;
function unwrapTextMath(seg) {
  const m = seg.match(/^(\${1,2})([\s\S]*)\1$/);
  if (!m) return seg;
  const inner = m[2];
  if (!ROM_TEXT_RE.test(inner)) return seg; // matematică adevărată — nu o atingem
  return wrapBare(inner.replace(/\.\s*(?=[A-ZĂÎÂȘȚ])/g, '. ')); // + spațiu după punct
}

export function autoMath(input) {
  if (!input || (input.indexOf('\\') === -1 && input.indexOf('^') === -1 && input.indexOf('_') === -1 && input.indexOf('$') === -1)) return input;
  // separă zonele deja-matematice: textul se încadrează, iar math-ul cu
  // propoziții românești înăuntru se DESPACHETEAZĂ (eroare de redactare)
  const parts = String(input).split(/(\$\$[^$]*\$\$|\$[^$]*\$|\\\([^)]*\\\)|\\\[[^\]]*\\\])/g);
  const out = parts.map((seg, i) => (i % 2 === 1 ? unwrapTextMath(seg) : wrapBare(seg))).join('');
  // spațiu după punctul dintre propoziții („BC).Știind" → „BC). Știind")
  return out.replace(/([)\]a-zăâîșț])\.(?=[A-ZĂÎÂȘȚ])/g, '$1. ');
}
