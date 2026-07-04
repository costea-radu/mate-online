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
  // \frac{..}{..}
  s = s.replace(/\\frac\s*\{[^{}]*\}\s*\{[^{}]*\}/g, (m) => '$' + m + '$');
  // \sqrt[..]{..} sau \sqrt{..}
  s = s.replace(/\\sqrt\s*(\[[^\]]*\])?\s*\{[^{}]*\}/g, (m) => '$' + m + '$');
  // puteri / indici: x^2, a_1, x^{10}, a_{n}
  s = s.replace(/([A-Za-z0-9)\]])(\^|_)(\{[^{}]*\}|[A-Za-z0-9]+)/g, (m) => '$' + m + '$');
  // comenzi de sine stătătoare rămase
  s = s.replace(new RegExp('\\\\(' + CMDS + ')\\b', 'g'), (m) => '$' + m + '$');
  // colapsează încadrările alăturate ($$ apărut din tokeni lipiți) → un spațiu
  s = s.replace(/\$\s*\$/g, ' ');
  return s;
}

export function autoMath(input) {
  if (!input || (input.indexOf('\\') === -1 && input.indexOf('^') === -1 && input.indexOf('_') === -1)) return input;
  // separă zonele deja-matematice ca să nu le atingem
  const parts = input.split(/(\$\$[^$]*\$\$|\$[^$]*\$|\\\([^)]*\\\)|\\\[[^\]]*\\\])/g);
  return parts.map((seg, i) => (i % 2 === 1 ? seg : wrapBare(seg))).join('');
}
