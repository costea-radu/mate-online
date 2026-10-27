// =====================================================================
// src/components/math/MathKeyboard.jsx — TASTATURA MATEMATICĂ (cererea din 26 oct. 2026)
//
// „Fă ca elevul să poată scrie simboluri matematice ca radical, radical de ordin n,
// integrală, limită, fracție, putere, vector, aranjamente, combinări, grade, matrice de
// ordin 2 și 3, determinant, indice, intersecție, reuniune, aparține, rezultă, infinit,
// pi, sau alte forme, de pe telefon sau calculator. Pune o tastatură specială pentru
// introducere răspuns cu aceste simboluri. Să accepte răspuns și în formă de text."
//
// Câmpul e un editor matematic adevărat (MathLive, licență MIT, încărcat abia la prima
// deschidere): fracția are căsuțe pentru numărător și numitor, radicalul pentru ordin și
// sub-radical, matricea pentru fiecare element — elevul nu vede cod. Tastatura de mai jos
// e a noastră (etichete în română, aceleași pe telefon și pe calculator); pe telefon
// tastatura sistemului nu mai apare peste câmp, pe calculator se poate scrie și de la
// tastatură (/ = fracție, ^ = putere, _ = indice, „sqrt", „pi", „inf"…).
// Rezultatul e LaTeX (\frac{1}{2}, \sqrt[3]{8}, C_{5}^{2}…), pe care serverul îl verifică
// matematic (api/_lib/mathcheck.js); răspunsul scris ca TEXT („radical din 2", „1/2")
// merge și el, din câmpul obișnuit.
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react';
import { ensureKatex } from '../../lib/katex';
import { expandTex } from '../../lib/mathPlain';

// ─── MathLive, o singură dată ────────────────────────────────────────────────
let loading = null;
export function loadMathLive() {
  if (!loading) {
    loading = (async () => {
      const ml = await import('mathlive');
      await import('mathlive/fonts.css');          // fonturile KaTeX_* (aceleași ca la KaTeX)
      const { MathfieldElement } = ml;
      try {
        MathfieldElement.fontsDirectory = null;     // le aduce CSS-ul de mai sus
        MathfieldElement.soundsDirectory = null;    // fără sunete la taste
        MathfieldElement.decimalSeparator = ',';    // virgula zecimală românească („2,5")
      } catch { /* versiune fără aceste setări */ }
      return ml;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// ─── tastele ─────────────────────────────────────────────────────────────────
// l = eticheta (LaTeX, desenată cu KaTeX) sau t = eticheta-text; i = ce se inserează
// (MathLive: #0 = selecția sau o căsuță, #? = o căsuță, #@ = ce e înainte); c = comandă
const K = (l, i, title, extra = {}) => ({ l, i, title, ...extra });
const T = (t, i, title, extra = {}) => ({ t, i, title, ...extra });
// AMPLIFICAREA și SIMPLIFICAREA fracțiilor, cu notația de la clasă (cererea din 27 oct.
// 2026): factorul stă SUS, cu paranteză — în STÂNGA fracției la amplificare (²⁾ 3/4),
// în DREAPTA ei la simplificare (18/24 ⁽⁶). În LaTeX: {}^{2)}\frac{3}{4} și
// \frac{18}{24}^{(6}. Fiecare tastă pune fracția cu tot cu factorul, cu căsuțe: la amplificare
// întâi factorul, apoi numărătorul și numitorul; la simplificare numărătorul, numitorul, apoi
// factorul (⇥ trece la căsuța următoare). („#@" nu prinde o fracție scrisă înainte.)
export const KEY_AMPLIFICARE = K('{}^{n)}\\frac{a}{b}', '{}^{#?)}\\frac{#?}{#?}', 'Amplificare: factorul sus, în stânga fracției, cu paranteză — ex. ²⁾3/4 = 6/8 (scrii factorul, apoi fracția)', { frac: true });
export const KEY_SIMPLIFICARE = K('\\frac{a}{b}^{(n}', '\\frac{#?}{#?}^{(#?}', 'Simplificare: factorul sus, în dreapta fracției, cu paranteză — ex. 18/24⁽⁶ = 3/4 (scrii fracția, apoi factorul)', { frac: true });
const TABS = [
  {
    id: 'baza', label: '123', title: 'Cifre și operații',
    // fracția, amplificarea și simplificarea stau una lângă alta; literele „n" și „a"
    // au rămas în fila „abc"
    keys: [
      T('7', '7'), T('8', '8'), T('9', '9'), K('\\div', '\\div', 'împărțit'), T('(', '('), T(')', ')'), K('x', 'x', 'x'),
      T('4', '4'), T('5', '5'), T('6', '6'), K('\\cdot', '\\cdot', 'ori'), K('\\frac{a}{b}', '\\frac{#@}{#?}', 'Fracție'), KEY_AMPLIFICARE, KEY_SIMPLIFICARE,
      T('1', '1'), T('2', '2'), T('3', '3'), T('−', '-', { title: 'minus' }), K('\\sqrt{x}', '\\sqrt{#0}', 'Radical'), K('x^2', '#@^{2}', 'La pătrat'), K('x^n', '#@^{#?}', 'Putere'),
      T('0', '0'), T(',', ',', { title: 'virgulă' }), T('=', '='), T('+', '+'), K('\\pi', '\\pi', 'pi'), K('\\infty', '\\infty', 'Infinit'), K('y', 'y', 'y'),
    ],
  },
  {
    id: 'puteri', label: '√ xⁿ', title: 'Puteri, radicali, funcții',
    keys: [
      K('\\sqrt{x}', '\\sqrt{#0}', 'Radical'), K('\\sqrt[n]{x}', '\\sqrt[#?]{#0}', 'Radical de ordin n'), K('\\sqrt[3]{x}', '\\sqrt[3]{#0}', 'Radical de ordinul 3'), K('x^2', '#@^{2}', 'La pătrat'), K('x^3', '#@^{3}', 'La cub'), K('x^n', '#@^{#?}', 'Putere'), K('x_1', '#@_{#?}', 'Indice'),
      K('\\frac{a}{b}', '\\frac{#@}{#?}', 'Fracție'), K('|x|', '\\left|#0\\right|', 'Modul'), K('x^{\\circ}', '^{\\circ}', 'Grade'), K('n!', '!', 'Factorial'), K('\\%', '\\%', 'Procent'), K('e', 'e', 'e'), K('i', 'i', 'i (numere complexe)'),
      K('\\ln', '\\ln\\left(#0\\right)', 'Logaritm natural'), K('\\lg', '\\lg\\left(#0\\right)', 'Logaritm zecimal'), K('\\log_a', '\\log_{#?}\\left(#0\\right)', 'Logaritm în baza a'), K('\\sin', '\\sin\\left(#0\\right)', 'sinus'), K('\\cos', '\\cos\\left(#0\\right)', 'cosinus'), K('\\mathrm{tg}', '\\operatorname{tg}\\left(#0\\right)', 'tangentă'), K('\\mathrm{ctg}', '\\operatorname{ctg}\\left(#0\\right)', 'cotangentă'),
      K('\\le', '\\le', 'mai mic sau egal'), K('\\ge', '\\ge', 'mai mare sau egal'), K('<', '<', 'mai mic'), K('>', '>', 'mai mare'), K('\\ne', '\\ne', 'diferit'), K('\\pm', '\\pm', 'plus-minus'), K('\\approx', '\\approx', 'aproximativ'),
    ],
  },
  {
    id: 'analiza', label: '∫ lim', title: 'Limite, derivate, integrale',
    keys: [
      K('\\lim_{x\\to a}', '\\lim_{x\\to #?}#0', 'Limită', { wide: true }), K('\\lim_{x\\to\\infty}', '\\lim_{x\\to\\infty}#0', 'Limită la infinit', { wide: true }), K('\\lim_{x\\to 0}', '\\lim_{x\\to 0}#0', 'Limită în 0', { wide: true }), K('\\int', '\\int #0\\,\\mathrm{d}x', 'Integrală'),
      K('\\int_a^b', '\\int_{#?}^{#?}#0\\,\\mathrm{d}x', 'Integrală definită'), K('\\sum', '\\sum_{k=#?}^{#?}#0', 'Sumă'), K("f'", "'", 'Derivata (prim)'), K("f'(x)", "f'\\left(x\\right)", 'f prim de x'), K("f''(x)", "f''\\left(x\\right)", 'f secund de x'), K('f(x)', 'f\\left(#0\\right)', 'f de x'), K('\\to', '\\to', 'tinde la'),
      K('-\\infty', '-\\infty', 'minus infinit'), K('+\\infty', '+\\infty', 'plus infinit'), K('e^x', 'e^{#?}', 'e la puterea'), K('\\Big|_a^b', '\\Big|_{#?}^{#?}', 'De la a la b (Leibniz–Newton)'), K('\\mathrm{d}x', '\\,\\mathrm{d}x', 'dx'), K('x^n', '#@^{#?}', 'Putere'), K('\\frac{a}{b}', '\\frac{#@}{#?}', 'Fracție'),
      K('\\sqrt{x}', '\\sqrt{#0}', 'Radical'), K('\\ln', '\\ln\\left(#0\\right)', 'Logaritm natural'), K('\\pi', '\\pi', 'pi'), K('e', 'e', 'e'), K('x', 'x', 'x'), T('(', '('), T(')', ')'),
    ],
  },
  {
    id: 'multimi', label: '∩ ∈ ⇒', title: 'Mulțimi, intervale, logică',
    keys: [
      K('\\in', '\\in', 'Aparține'), K('\\notin', '\\notin', 'Nu aparține'), K('\\cap', '\\cap', 'Intersecție'), K('\\cup', '\\cup', 'Reuniune'), K('\\subset', '\\subset', 'Inclus'), K('\\setminus', '\\setminus', 'Diferență'), K('\\emptyset', '\\emptyset', 'Mulțimea vidă'),
      K('\\mathbb{R}', '\\mathbb{R}', 'Numere reale'), K('\\mathbb{N}', '\\mathbb{N}', 'Numere naturale'), K('\\mathbb{Z}', '\\mathbb{Z}', 'Numere întregi'), K('\\mathbb{Q}', '\\mathbb{Q}', 'Numere raționale'), K('\\mathbb{C}', '\\mathbb{C}', 'Numere complexe'), K('\\{\\,\\}', '\\left\\lbrace #0\\right\\rbrace', 'Mulțime { }'), T(';', ';', { title: 'punct și virgulă' }),
      K('(a,b)', '\\left(#?,#?\\right)', 'Interval deschis'), K('[a,b]', '\\left[#?,#?\\right]', 'Interval închis'), K('(a,b]', '\\left(#?,#?\\right]', 'Interval (a, b]'), K('[a,b)', '\\left[#?,#?\\right)', 'Interval [a, b)'), K('\\Rightarrow', '\\Rightarrow', 'Rezultă'), K('\\Leftrightarrow', '\\Leftrightarrow', 'Echivalent'), K('\\forall', '\\forall', 'Oricare'),
      K('\\exists', '\\exists', 'Există'), K('\\le', '\\le', 'mai mic sau egal'), K('\\ge', '\\ge', 'mai mare sau egal'), K('\\ne', '\\ne', 'diferit'), K('\\infty', '\\infty', 'Infinit'), K('-\\infty', '-\\infty', 'minus infinit'), K('x', 'x', 'x'),
    ],
  },
  {
    id: 'matrice', label: '[ ] A C', title: 'Matrice, determinanți, vectori, combinatorică, geometrie',
    keys: [
      K('\\begin{pmatrix}a&b\\\\c&d\\end{pmatrix}', '\\begin{pmatrix}#?&#?\\\\#?&#?\\end{pmatrix}', 'Matrice de ordinul 2', { wide: true }), K('\\begin{pmatrix}\\cdot&\\cdot&\\cdot\\\\\\cdot&\\cdot&\\cdot\\\\\\cdot&\\cdot&\\cdot\\end{pmatrix}', '\\begin{pmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{pmatrix}', 'Matrice de ordinul 3', { wide: true, tall: true }),
      K('A^{-1}', '#@^{-1}', 'Inversa'), K('{}^{t}\\!A', '{}^{t}#?', 'Transpusa'), K('\\det', '\\det\\left(#0\\right)', 'Determinantul'),
      K('\\begin{vmatrix}a&b\\\\c&d\\end{vmatrix}', '\\begin{vmatrix}#?&#?\\\\#?&#?\\end{vmatrix}', 'Determinant de ordinul 2', { wide: true }), K('\\begin{vmatrix}\\cdot&\\cdot&\\cdot\\\\\\cdot&\\cdot&\\cdot\\\\\\cdot&\\cdot&\\cdot\\end{vmatrix}', '\\begin{vmatrix}#?&#?&#?\\\\#?&#?&#?\\\\#?&#?&#?\\end{vmatrix}', 'Determinant de ordinul 3', { wide: true, tall: true }),
      K('I_2', 'I_{2}', 'Matricea unitate I₂'), K('\\vec{i}', '\\vec{i}', 'Versorul i'), K('\\vec{j}', '\\vec{j}', 'Versorul j'),
      K('\\vec{v}', '\\vec{#0}', 'Vector'), K('\\overrightarrow{AB}', '\\overrightarrow{#0}', 'Vectorul AB'), K('A_n^k', 'A_{#?}^{#?}', 'Aranjamente'), K('C_n^k', 'C_{#?}^{#?}', 'Combinări'), K('P_n', 'P_{#?}', 'Permutări'), K('n!', '!', 'Factorial'), K('\\widehat{ABC}', '\\widehat{#0}', 'Unghi', { small: true }),
      K('\\triangle', '\\triangle', 'Triunghi'), K('\\parallel', '\\parallel', 'Paralel'), K('\\perp', '\\perp', 'Perpendicular'), K('\\overline{AB}', '\\overline{#0}', 'Segment (bară)'), K('\\equiv', '\\equiv', 'Congruent'), K('\\sim', '\\sim', 'Asemenea'), K('x^{\\circ}', '^{\\circ}', 'Grade'),
    ],
  },
  {
    id: 'litere', label: 'abc', title: 'Litere',
    keys: [
      ...'abcdefg'.split('').map((c) => K(c, c, c)),
      ...'hijklmn'.split('').map((c) => K(c, c, c)),
      ...'opqrstu'.split('').map((c) => K(c, c, c)),
      ...'vwxyz'.split('').map((c) => K(c, c, c)), K('A', 'A', 'A'), K('B', 'B', 'B'),
      K('\\alpha', '\\alpha', 'alfa'), K('\\beta', '\\beta', 'beta'), K('\\gamma', '\\gamma', 'gama'), K('\\Delta', '\\Delta', 'delta'), K('\\theta', '\\theta', 'teta'), K('\\lambda', '\\lambda', 'lambda'), K('\\varphi', '\\varphi', 'fi'),
    ],
  },
];
// rândul de jos, mereu: mutarea cursorului, căsuța următoare, ștergerea
const NAV = [
  { t: '←', c: 'moveToPreviousChar', title: 'Înapoi' },
  { t: '→', c: 'moveToNextChar', title: 'Înainte' },
  { t: '⇥ căsuța următoare', c: 'moveToNextPlaceholder', title: 'Treci în căsuța următoare (ex. din numărător în numitor)', wide: true },
  { t: '⌫', c: 'deleteBackward', title: 'Șterge' },
  { t: '🗑', c: 'clear', title: 'Șterge tot' },
];

// eticheta unei taste, desenată cu KaTeX (o dată, apoi din cache)
const labelCache = new Map();
function KeyLabel({ tex }) {
  const [html, setHtml] = useState(() => labelCache.get(tex) || null);
  useEffect(() => {
    if (html) return undefined;
    let alive = true;
    ensureKatex().then(() => {
      try {
        const h = window.katex.renderToString(tex, { throwOnError: false, displayMode: false });
        labelCache.set(tex, h);
        if (alive) setHtml(h);
      } catch { /* rămâne textul */ }
    });
    return () => { alive = false; };
  }, [tex, html]);
  // eslint-disable-next-line react/no-danger
  return html ? <span className="mk-tex" dangerouslySetInnerHTML={{ __html: html }} /> : <span className="mk-tex">{tex.replace(/\\/g, '')}</span>;
}

// ─── panoul: câmpul + tastatura + butoanele ──────────────────────────────────
// value: LaTeX-ul de pornire; onSubmit(latex) — „Trimite" / „✓ Pune în mesaj"; onText() —
// „Abc" (înapoi la câmpul de text); compact: tastatura mai joasă (cardul întrebării)
export default function MathPanel({ value = '', onSubmit, onCancel = null, onText = null, onChange = null, submitLabel = 'Trimite', busy = false, disabled = false,
  autoFocus = true, compact = false, hint = true, placeholder = '' }) {
  const host = useRef(null);
  const mfRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(null);
  const [tab, setTab] = useState('baza');
  const [empty, setEmpty] = useState(!value);
  const submitRef = useRef(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  const latex = useCallback(() => {
    const mf = mfRef.current;
    if (!mf) return '';
    let v;
    try { v = String(mf.getValue('latex-expanded') || mf.value || ''); } catch { v = String(mf.value || ''); }
    return expandTex(v).trim();          // „\frac34" → „\frac{3}{4}" (forma scurtă a editorului)
  }, []);
  const submit = useCallback(() => {
    const v = latex().replace(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g, '').trim();
    if (!v || busy || disabled) return;
    onSubmit?.(v);
  }, [latex, busy, disabled, onSubmit]);
  submitRef.current = submit;

  useEffect(() => {
    let alive = true;
    loadMathLive().then(() => {
      if (!alive || !host.current) return;
      const mf = document.createElement('math-field');
      mf.setAttribute('math-virtual-keyboard-policy', 'manual');
      try {
        mf.mathVirtualKeyboardPolicy = 'manual';   // tastatura e a noastră (mai jos)
        mf.smartFence = true;
        mf.menuItems = [];                          // fără meniul MathLive (☰)
        mf.inlineShortcutTimeout = 0;
      } catch { /* versiune fără proprietăți */ }
      mf.setAttribute('aria-label', 'Răspunsul tău, cu simboluri matematice');
      if (placeholder) mf.setAttribute('placeholder', placeholder);
      mf.value = value || '';
      mf.addEventListener('input', (ev) => {
        if (ev.inputType === 'insertLineBreak') { ev.preventDefault?.(); submitRef.current?.(); return; }
        const v = String(mf.value || '');
        setEmpty(!v.replace(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g, '').trim());
        changeRef.current?.(v);
      });
      // Enter = trimite (pe calculator)
      mf.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); ev.stopPropagation(); submitRef.current?.(); } }, { capture: true });
      host.current.appendChild(mf);
      mfRef.current = mf;
      setReady(true);
      if (autoFocus) setTimeout(() => { try { mf.focus({ preventScroll: true }); } catch { /* ignore */ } }, 60);
    }).catch((e) => { if (alive) setFailed(e?.message || 'Tastatura nu s-a putut încărca.'); });
    return () => { alive = false; try { mfRef.current?.remove(); } catch { /* ignore */ } mfRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const press = (k) => {
    const mf = mfRef.current;
    if (!mf || disabled) return;
    try {
      if (k.c === 'clear') { mf.value = ''; setEmpty(true); changeRef.current?.(''); }
      else if (k.c) mf.executeCommand(k.c);
      else mf.executeCommand(['insert', k.i, { focus: true, selectionMode: 'placeholder', feedback: false, scrollIntoView: true }]);
      mf.focus({ preventScroll: true });
    } catch { /* comanda nu există în această versiune */ }
  };
  // tastele nu iau focusul (cursorul rămâne în câmp, ca la tastatura telefonului)
  const keep = (e) => e.preventDefault();
  const cur = TABS.find((x) => x.id === tab) || TABS[0];

  return (
    <div className={`mk${compact ? ' is-compact' : ''}`}>
      <div className="mk-field-row">
        <div className={`mk-field${ready ? '' : ' is-loading'}`} ref={host}>
          {!ready && !failed && <span className="mk-loading">Se încarcă tastatura matematică…</span>}
          {failed && <span className="mk-loading is-err">⚠ {failed} Scrie răspunsul ca text.</span>}
        </div>
      </div>
      <div className="mk-tabs" role="tablist" aria-label="Simbolurile">
        {TABS.map((x) => (
          <button key={x.id} type="button" role="tab" aria-selected={x.id === tab} className={`mk-tab${x.id === tab ? ' is-on' : ''}`} title={x.title}
            onPointerDown={keep} onClick={() => setTab(x.id)}>{x.label}</button>
        ))}
      </div>
      <div className={`mk-keys mk-keys-${cur.id}`} role="group" aria-label={cur.title}>
        {cur.keys.map((k, n) => (
          <button key={`${cur.id}-${n}`} type="button" className={`mk-key${k.wide ? ' is-wide' : ''}${k.tall ? ' is-tall' : ''}${k.small ? ' is-small' : ''}${k.frac ? ' is-frac' : ''}${k.t && /^\d$/.test(k.t) ? ' is-digit' : ''}`} title={k.title || k.t || k.l}
            aria-label={k.title || k.t || k.l} disabled={!ready || disabled} onPointerDown={keep} onClick={() => press(k)}>
            {k.t ? k.t : <KeyLabel tex={k.l} />}
          </button>
        ))}
      </div>
      <div className="mk-nav">
        {NAV.map((k) => (
          <button key={k.c} type="button" className={`mk-key mk-navkey${k.wide ? ' is-wide' : ''}`} title={k.title} aria-label={k.title} disabled={!ready || disabled}
            onPointerDown={keep} onClick={() => press(k)}>{k.t}</button>
        ))}
      </div>
      <div className="mk-actions">
        {onText && <button type="button" className="mk-btn-soft" onPointerDown={keep} onClick={() => onText(latex())} title="Scrie răspunsul ca text, cu tastatura obișnuită">Abc · text</button>}
        {onCancel && <button type="button" className="mk-btn-soft" onClick={onCancel}>Renunț</button>}
        <button type="button" className="mk-btn-main" disabled={!ready || empty || busy || disabled} onPointerDown={keep} onClick={submit}>{busy ? '…' : submitLabel}</button>
      </div>
      {hint && <div className="mk-hint">Poți scrie și ca text: <i>radical din 2</i>, <i>1/2</i>, <i>x la pătrat</i>, <i>2^3</i>, <i>infinit</i>. Pe calculator: / face fracție, ^ putere, _ indice.</div>}
    </div>
  );
}
