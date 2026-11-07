// =====================================================================
// src/lib/baraSus.js — bara de sus a testelor (interactive, PDF) mereu la vedere
// pe telefon: „← Înapoi", „✓ Corectează total", „📋 Barem"…
//
// Cererea (7 nov. 2026): „pe telefon la teste interactive și PDF-uri nu se vede bine
// bara de sus cu butoanele «înapoi», «corectează», «barem»". Două cauze:
//
//  1. iPhone, Safari 26: după ce se închide tastatura (pașii testului, chatul),
//     pagina rămâne „urcată" cu înălțimea barei de stare, iar bara testului ajunge
//     sub ceas și baterie (bug WebKit 300523). Vizualizatoarele ocupă exact ecranul
//     (100dvh, cu derularea în interior), deci documentul n-are de ce să fie
//     derulat: de cum tastatura e închisă îl readucem la 0 — și la orice derulare
//     a documentului. Cât e tastatura deschisă nu-l atingem (iOS ține câmpul la vedere).
//  2. Aplicația pusă pe ecranul principal (bara de stare „black-translucent",
//     index.html): pagina începe SUB bara de stare → bara are nevoie de spațiul de
//     sus al ecranului (env(safe-area-inset-top)); în lateral, de „notch" (landscape).
// =====================================================================
import { useEffect } from 'react';

// padding-ul barei: cel puțin `px`, dar nu sub bara de stare / „notch"
export const sigurSus = (px) => `max(${px}px, env(safe-area-inset-top, 0px))`;
export const sigurStanga = (px) => `max(${px}px, env(safe-area-inset-left, 0px))`;
export const sigurDreapta = (px) => `max(${px}px, env(safe-area-inset-right, 0px))`;
// toate patru, pentru `style` (jos rămâne cât a fost)
export const paddingBara = (v, h) => ({ paddingTop: sigurSus(v), paddingBottom: v, paddingLeft: sigurStanga(h), paddingRight: sigurDreapta(h) });

// Tastatura e deschisă când fereastra vizibilă e mult mai mică decât cea mai mare
// văzută (bara de jos a browserului care se strânge / se lărgește înseamnă < 120 px).
export const KEYBOARD_MIN = 120;
export const tastaturaDeschisa = ({ vvH = 0, maxH = 0 } = {}) => vvH > 0 && maxH > 0 && vvH < maxH - KEYBOARD_MIN;

// Trebuie readus documentul la 0? — nu cât se scrie (câmp din pagină în focus sau
// tastatura deschisă de un câmp din iframe-ul testului) și nici când elevul a mărit
// pagina cu două degete (atunci o plimbă el; bara iese din ecran pentru că așa vrea)
export function trebuieReadus({ scrollY = 0, offsetTop = 0, vvH = 0, maxH = 0, scrie = false, zoom = 1 } = {}) {
  if (scrie || zoom > 1.01 || tastaturaDeschisa({ vvH, maxH })) return false;
  return Math.abs(scrollY) > 0.5 || Math.abs(offsetTop) > 0.5;
}

const scrieAcum = (doc) => {
  const ae = doc && doc.activeElement;
  return !!ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable === true);
};

// Ascultă derulările / tastatura și readuce documentul la 0 când trebuie.
// Întoarce funcția de oprire. (`w` = window; în teste, o fereastră simulată.)
export function tineBaraSus(w, { delay = 120 } = {}) {
  if (!w || !w.addEventListener) return () => {};
  const vv = w.visualViewport || null;
  const inaltime = () => (vv ? vv.height : w.innerHeight) || 0;
  let maxH = inaltime();
  let lastW = w.innerWidth;
  let t = null;
  const verifica = () => {
    clearTimeout(t);
    t = setTimeout(() => {
      if (w.innerWidth !== lastW) { lastW = w.innerWidth; maxH = 0; }   // ecranul s-a rotit
      const vvH = inaltime();
      if (vvH > maxH) maxH = vvH;
      const st = { scrollY: w.scrollY || w.pageYOffset || 0, offsetTop: vv ? vv.offsetTop || 0 : 0, vvH, maxH, scrie: scrieAcum(w.document), zoom: vv ? vv.scale || 1 : 1 };
      if (!trebuieReadus(st)) return;
      try { w.scrollTo(0, 0); } catch { /* noop */ }
      // Safari 26: fereastra vizibilă poate rămâne decalată și cu scrollY = 0 → o „împingem"
      if (vv && (vv.offsetTop || 0) > 0.5) { try { w.scrollBy(0, 1); w.scrollBy(0, -1); } catch { /* noop */ } }
    }, delay);
  };
  w.addEventListener('scroll', verifica, { passive: true });
  w.addEventListener('focusout', verifica);
  w.addEventListener('resize', verifica);
  if (vv) { vv.addEventListener('resize', verifica); vv.addEventListener('scroll', verifica); }
  verifica();
  return () => {
    clearTimeout(t);
    w.removeEventListener('scroll', verifica);
    w.removeEventListener('focusout', verifica);
    w.removeEventListener('resize', verifica);
    if (vv) { vv.removeEventListener('resize', verifica); vv.removeEventListener('scroll', verifica); }
  };
}

// Se montează în vizualizator (InteractiveViewer, PDFViewer, ExercitiuAIViewer).
export function useBaraSusVizibila() {
  useEffect(() => tineBaraSus(typeof window !== 'undefined' ? window : null), []);
}
