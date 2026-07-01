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
