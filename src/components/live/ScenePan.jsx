// =====================================================================
// src/components/live/ScenePan.jsx — „CAMERA" sălii pe telefon: butonul care
// mută vederea între EXPLICAȚIE (ce scrie profesorul pe tabla din spatele lui)
// și EXERCIȚIU (enunțul / variantele, proiectate pe tablă).
//
// Camera urmează singură lecția (src/lib/live/framing.js → autoFocus): enunțul
// și întrebarea → exercițiul; explicația → tabla. Elevul o poate muta oricând
// (buton sau glisare); alegerea lui ține până la următoarea etapă a lecției.
// Apare doar când tabla și proiecția nu încap citibil deodată (telefon).
// =====================================================================
import { useEffect, useState } from 'react';
import { autoFocus } from '../../lib/live/framing';

// telefonul ținut culcat (ecran scund): cardurile stau în dreapta, nu jos
export function useMedia(query) {
  const get = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false);
  const [on, setOn] = useState(get);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const m = window.matchMedia(query);
    const f = () => setOn(m.matches);
    f();
    if (m.addEventListener) m.addEventListener('change', f); else m.addListener(f);
    return () => { if (m.removeEventListener) m.removeEventListener('change', f); else m.removeListener(f); };
  }, [query]);
  return on;
}
export const LANDSCAPE_SHORT = '(orientation: landscape) and (max-height: 520px)';

const keyOf = (s) => (s?.scene ? `${s.scene.type}|${s.scene.item ?? ''}|${s.scene.t0 ?? ''}|${s.inserted || ''}` : String(s?.phase || ''));

// focus = unde se uită camera acum; set(…) = alegerea elevului
export function useSceneFocus(state, { override = null } = {}) {
  const auto = override || autoFocus(state);
  const key = keyOf(state) + '|' + (override || '');
  const [manual, setManual] = useState(null);
  useEffect(() => { setManual(null); }, [key]);
  return { focus: manual || auto, auto, manual, set: setManual };
}

export default function ScenePan({ focus, onChange, hint = true }) {
  return (
    <div className="lv-pan" role="group" aria-label="Unde se uită camera">
      <button type="button" className={focus === 'tabla' ? 'is-on' : ''} aria-pressed={focus === 'tabla'}
        onClick={() => onChange('tabla')} title="Camera pe tablă: ce scrie profesorul">
        <span aria-hidden="true">{focus === 'ecran' ? '◂ ' : ''}✎</span> Explicația
      </button>
      <button type="button" className={focus === 'ecran' ? 'is-on' : ''} aria-pressed={focus === 'ecran'}
        onClick={() => onChange('ecran')} title="Camera pe exercițiu: enunțul proiectat pe tablă">
        <span aria-hidden="true">📝</span> Exercițiul{focus !== 'ecran' ? <span aria-hidden="true"> ▸</span> : null}
      </button>
      {hint && <span className="lv-pan-hint" aria-hidden="true">sau glisează</span>}
    </div>
  );
}
