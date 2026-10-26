// =====================================================================
// src/components/math/MathInput.jsx — TASTATURA MATEMATICĂ, în câmpurile site-ului
//
//   MathAnswer — câmpul de RĂSPUNS (întrebările profesorului din sala live, din
//     Pregătirea de examen): „Abc" = textul obișnuit (acceptă și „radical din 2",
//     „1/2", „x la pătrat"), „√x" = editorul matematic cu tastatura specială.
//     Alegerea se ține minte în browser.
//   MathInsert — butonul „√x" de lângă un câmp de TEXT (chatul din sala live, chatul
//     Profesorului Virtual de lângă PDF, formularul „📝 Răspunde în chat"): formula
//     scrisă cu tastatura intră în text, la cursor, ca $…$ (chatul o desenează cu KaTeX,
//     profesorul o citește ca LaTeX).
// Editorul (MathLive + tastatura) se încarcă abia la prima deschidere (MathKeyboard.jsx).
// =====================================================================
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { latexToPlain, mathPref, setMathPref } from '../../lib/mathPlain';
import '../../styles/mathkeyboard.css';

const MathPanel = lazy(() => import('./MathKeyboard'));
const Loading = () => <div className="mk-loading-box">Se încarcă tastatura matematică…</div>;

// textul intră la cursor (sau la sfârșit), cu un spațiu înainte dacă trebuie
export function insertAtCursor(el, current, piece) {
  const v = String(current || '');
  const start = el && typeof el.selectionStart === 'number' ? el.selectionStart : v.length;
  const end = el && typeof el.selectionEnd === 'number' ? el.selectionEnd : v.length;
  const before = v.slice(0, start), after = v.slice(end);
  const pad = before && !/\s$/.test(before) ? ' ' : '';
  const next = `${before}${pad}${piece}${after && !/^\s/.test(after) ? ' ' : ''}${after}`;
  const caret = (before + pad + piece).length;
  return { next, caret };
}

// ─── câmpul de răspuns (întrebările profesorului) ─────────────────────────────
// onSubmit(answer): textul scris, sau LaTeX-ul editorului (fără $…$ — serverul îl verifică matematic)
export function MathAnswer({ onSubmit, disabled = false, busy = false, placeholder = 'Scrie rezultatul', inputRef = null, submitLabel = 'Trimite', autoComplete = 'off' }) {
  const [mode, setMode] = useState(mathPref);
  const [text, setText] = useState('');
  const own = useRef(null);
  const ref = inputRef || own;
  const send = (v) => { const a = String(v ?? '').trim(); if (!a || disabled || busy) return; onSubmit(a); };
  if (mode === 'math') {
    return (
      <div className="mk-answer">
        <Suspense fallback={<Loading />}>
          <MathPanel compact submitLabel={submitLabel} busy={busy} disabled={disabled}
            onSubmit={(latex) => send(latex)}
            onText={(latex) => { setMode('text'); setMathPref('text'); setText(latexToPlain(latex)); setTimeout(() => ref.current?.focus(), 40); }} />
        </Suspense>
      </div>
    );
  }
  return (
    <form className="lv-poll-fill mk-fill" onSubmit={(e) => { e.preventDefault(); send(text); }}>
      <input ref={ref} value={text} onChange={(e) => setText(e.target.value)} disabled={disabled || busy}
        placeholder={placeholder} inputMode="text" autoComplete={autoComplete} />
      <button type="button" className="mk-toggle" disabled={disabled} onClick={() => { setMode('math'); setMathPref('math'); }}
        title="Tastatura cu simboluri: radical, fracție, putere, integrală, limită, matrice, mulțimi…" aria-label="Tastatura cu simboluri matematice">√x</button>
      <button type="submit" className="lv-btn-primary" disabled={disabled || busy || !text.trim()}>{busy ? '…' : submitLabel}</button>
    </form>
  );
}

// ─── butonul „√x" de lângă un câmp de text ────────────────────────────────────
// Folosire: <MathInsert open={o} setOpen={setO} onInsert={(tex) => …} /> — panoul se
// pune unde vrea părintele (de obicei deasupra rândului de scris), cu <MathInsertPanel>.
export function MathInsertButton({ open, setOpen, className = '', style = null, title = 'Simboluri matematice: radical, fracție, putere, integrală, limită, matrice, mulțimi…' }) {
  return (
    <button type="button" className={`mk-insert-btn${open ? ' is-on' : ''}${className ? ` ${className}` : ''}`} style={style} title={title} aria-label="Tastatura cu simboluri matematice"
      aria-expanded={open} onClick={() => setOpen(!open)}>√x</button>
  );
}
// telefonul: lățimea ecranului (tastatura „andocată" jos, ca tastatura telefonului)
const NARROW = '(max-width: 640px)';
function useNarrow() {
  const [narrow, setNarrow] = useState(() => { try { return window.matchMedia(NARROW).matches; } catch { return false; } });
  useEffect(() => {
    let mq = null;
    try { mq = window.matchMedia(NARROW); } catch { return undefined; }
    const on = () => setNarrow(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);
  return narrow;
}

// dock: pe telefon, panoul stă JOS pe ecran, peste pagină (ca tastatura telefonului) — pentru câmpurile
// dintr-o zonă mică, care se derulează (formularul „📝 Răspunde în chat", chatul de lângă PDF);
// caption: pentru ce câmp scrie elevul („Răspunsul la I.1 a)"), arătat doar când e andocat
export function MathInsertPanel({ open, onInsert, onClose, label = '✓ Pune în mesaj', dock = false, caption = '' }) {
  const narrow = useNarrow();
  if (!open) return null;
  const docked = dock && narrow && typeof document !== 'undefined';
  const panel = (
    <div className={`mk-insert-panel${docked ? ' is-dock' : ''}`} role={docked ? 'dialog' : undefined} aria-label={docked ? (caption || 'Tastatura matematică') : undefined}>
      {docked && caption && <div className="mk-dock-cap">√x · {caption}</div>}
      <Suspense fallback={<Loading />}>
        <MathPanel compact submitLabel={label} onCancel={onClose}
          onSubmit={(latex) => { onInsert(`$${latex}$`); onClose(); }} />
      </Suspense>
    </div>
  );
  return docked ? createPortal(panel, document.body) : panel;
}
