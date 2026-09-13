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

// Aplică `fn` DOAR pe bucățile din afara zonelor deja împachetate în $…$.
// Fără asta, pașii de mai jos re-împachetează ce s-a încadrat deja și rup formula.
function outsideMath(s, fn) {
  return s.split(/(\$[^$]*\$)/g).map((seg, i) => (i % 2 === 1 ? seg : fn(seg))).join('');
}

// Indexul de DUPĂ acolada care închide grupul început la `i` (sau -1).
function matchBrace(s, i) {
  if (s[i] !== '{') return -1;
  let d = 0;
  for (let k = i; k < s.length; k++) {
    if (s[k] === '\\') { k++; continue; }              // caracter evadat — sărit
    if (s[k] === '{') d++;
    else if (s[k] === '}') { d--; if (d === 0) return k + 1; }
  }
  return -1;
}

// Comenzile cu argumente în acolade și câte argumente iau.
const BRACE_CMDS = [
  ['dfrac', 2], ['tfrac', 2], ['frac', 2], ['binom', 2],
  ['sqrt', 1], ['overline', 1], ['underline', 1], ['overrightarrow', 1], ['vec', 1], ['widehat', 1],
];

// Încadrează în $…$ fiecare comandă cu argumente, cu tot cu acoladele ei,
// oricât de imbricate. Scanare, nu regex: acoladele echilibrate nu se pot
// exprima ca expresie regulată.
function wrapBraceCmds(s) {
  let out = '', i = 0;
  while (i < s.length) {
    let end = -1;
    if (s[i] === '\\') {
      for (const [name, nArgs] of BRACE_CMDS) {
        if (!s.startsWith('\\' + name, i)) continue;
        const after = s[i + 1 + name.length];
        if (after && /[a-zA-Z]/.test(after)) continue;    // \fraction ≠ \frac
        let j = i + 1 + name.length;
        while (s[j] === ' ') j++;
        if (name === 'sqrt' && s[j] === '[') {            // ordinul radicalului
          const k = s.indexOf(']', j);
          if (k < 0) continue;
          j = k + 1;
          while (s[j] === ' ') j++;
        }
        let ok = true;
        for (let a = 0; a < nArgs; a++) {
          while (s[j] === ' ') j++;
          const e = matchBrace(s, j);
          if (e < 0) { ok = false; break; }
          j = e;
        }
        if (ok) { end = j; break; }
      }
    }
    if (end > i) { out += '$' + s.slice(i, end) + '$'; i = end; }
    else { out += s[i]; i++; }
  }
  return out;
}

function wrapBare(s) {
  if (!s) return s;
  // grade scrise stricat în text: „70^∘" / „70^{∘}" (caret literal) → „70°"
  s = s.replace(/(\d)\s*\^\s*(?:\{\s*[∘°]\s*\}|[∘°])/g, '$1°');
  // \frac{..}{..}, \sqrt[..]{..} și rudele lor — cu acolade ECHILIBRATE, oricât
  // de adânc. Cu regex nu se putea: „\frac{-b\pm\sqrt{b^{2}-4ac}}{2a}" are trei
  // niveluri, rămânea neîncadrat, iar pasul de puteri de mai jos îl rupea.
  s = wrapBraceCmds(s);
  // Operatori mari, ÎMPREUNĂ cu limitele lor: \int_{0}^{1}, \sum_{i=1}^{n},
  // \lim_{x \to 0}. Altfel pasul de puteri lua doar „t_{0}" din „\int_{0}"
  // și ieșea „$\in t_{0}$^{1}" — exact notațiile pe care le dă recunoașterea
  // scrisului de mână (api/ai-handwriting.js).
  s = outsideMath(s, (seg) => seg.replace(
    /\\(?:iint|oint|int|sum|prod|limsup|liminf|lim)(?:\s*[_^]\s*(?:\{(?:[^{}]|\{[^{}]*\})*\}|\\[a-zA-Z]+|[A-Za-z0-9]+))*/g,
    (m) => '$' + m + '$',
  ));
  // puteri / indici: x^2, a_1, x^{10}, a_{n}, 4(10)^3, (x+1)^2, [a]_n, 70^\circ
  // Baza cu paranteze e prinsă ÎNTREAGĂ (cu tot cu coeficient), altfel „$"
  // ar cădea în mijlocul expresiei: 4(10)^3 devenea 4(10$)^3$ (roșu, nerandat).
  // Exponentul poate fi și o COMANDĂ (\circ): altfel „70^\circ" rămânea
  // „70^" + „∘" — caretul apărea literal în enunț (eroarea de redactare).
  // Se aplică DOAR în afara zonelor deja împachetate mai sus: altfel „40^2" din
  // interiorul unui \sqrt{…} tocmai încadrat se re-împacheta și rupea formula —
  // „\sqrt{40^2 + 30^2}" ieșea „$\sqrt{$40^2$ + $30^2$}$", roșu, nerandat.
  const powRe = /((?:\d+[A-Za-z]?)?\([^()]*\)|\[[^\][]*\]|\d+(?:[.,]\d+)?|[A-Za-z0-9])(\^|_)(\{[^{}]*\}|\\[a-zA-Z]+|[A-Za-z0-9]+)/g;
  s = outsideMath(s, (seg) => seg.replace(powRe, (m) => '$' + m + '$'));
  // comenzile rămase se încadrează DOAR în afara zonelor deja împachetate mai
  // sus (altfel \circ din „$70^\circ$" se re-împacheta și strica expresia)
  const cmdRe = new RegExp('\\\\(' + CMDS + ')\\b', 'g');
  s = outsideMath(s, (seg) => seg.replace(cmdRe, (m) => '$' + m + '$'));
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
