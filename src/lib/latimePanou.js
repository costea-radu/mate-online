// =====================================================================
// src/lib/latimePanou.js — lățimea ferestrei Profesorului Virtual, PE CALCULATOR
//
// Pe telefon, panoul profesorului (lângă PDF / exercițiul interactiv) se trage
// în sus și în jos de bara albastră. Pe calculator, la fel, dar LATERAL: elevul
// trage de marginea stângă a panoului (mânerul cu cele două liniuțe) și îl face
// cât de lat vrea — lățimea se ține minte (localStorage), iar dublu-clic pe
// mâner trece între lățimea obișnuită și una mare. Același mâner îl are și
// widgetul plutitor de pe tot site-ul (FloatingTutor), pe marginea lui stângă.
//
//   const lat = useLatimePanou({ storageKey: 'pv:latime', initial: 400 });
//   <div style={{ width: lat.width, position: 'relative' }}>
//     <ManerLatime lat={lat} />  …
//
// Opțiuni: min (px), maxFrac (cât din fereastră poate ocupa), reserve (cât
// trebuie să rămână liber pentru PDF / exercițiu), edge ('left' = mânerul e pe
// marginea stângă: tragi spre stânga → panoul se lățește), onUserResize.
// =====================================================================
import { useCallback, useEffect, useRef, useState } from 'react';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function useLatimePanou({
  storageKey = 'pv:latime', initial = 400, min = 320, maxFrac = 0.82, reserve = 300, wide = 900,
  edge = 'left', onUserResize = null,
} = {}) {
  const [saved, setSaved] = useState(() => {
    try { const v = parseInt(localStorage.getItem(storageKey) || '', 10); return v > 0 ? v : initial; } catch { return initial; }
  });
  const [vw, setVw] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth));
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    const on = () => setVw(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  const max = Math.max(min, Math.min(Math.round(vw * maxFrac), vw - reserve));
  const width = clamp(saved, min, max);
  const wideW = clamp(Math.min(wide, Math.round(vw * 0.75)), min, max);

  const drag = useRef(null);
  const last = useRef(width);
  const cbRef = useRef(onUserResize);
  useEffect(() => { cbRef.current = onUserResize; }, [onUserResize]);

  const persist = useCallback((w) => {
    try { localStorage.setItem(storageKey, String(Math.round(w))); } catch { /* fără loc */ }
  }, [storageKey]);

  // setWidth(w, { save:false }) — o lățime de moment (ex. spațiul de lucru
  // deschis lățește panoul), fără să înlocuiască preferința elevului
  const setWidth = useCallback((w, { save = true } = {}) => {
    const v = clamp(Math.round(w), min, max);
    setSaved(v);
    last.current = v;
    if (save) persist(v);
  }, [min, max, persist]);

  const onPointerDown = useCallback((e) => {
    if (e.button && e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    drag.current = { x: e.clientX, w: width };
    last.current = width;
    setDragging(true);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* merge și fără */ }
  }, [width]);
  const onPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    e.preventDefault();
    const dx = e.clientX - d.x;
    const v = clamp(Math.round(edge === 'left' ? d.w - dx : d.w + dx), min, max);
    last.current = v;
    setSaved(v);
  }, [edge, min, max]);
  const onPointerUp = useCallback((e) => {
    if (!drag.current) return;
    drag.current = null;
    setDragging(false);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* deja eliberat */ }
    // ultima lățime vine din ref: starea din closure poate fi cea dinaintea ultimei mișcări
    persist(last.current);
    if (cbRef.current) cbRef.current(last.current);
  }, [persist]);
  const onDoubleClick = useCallback(() => {
    const v = width < wideW - 40 ? wideW : clamp(initial, min, max);
    setWidth(v);
    if (cbRef.current) cbRef.current(v);
  }, [width, wideW, initial, min, max, setWidth]);

  return {
    width, min, max, wideW, dragging, setWidth,
    isWide: width >= wideW - 40,
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onDoubleClick },
  };
}
