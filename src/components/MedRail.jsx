// =====================================================================
// src/components/MedRail.jsx — MENIUL LATERAL al paginii „Meditații"
//
// TOATE comenzile paginii stau ÎN STÂNGA TABLEI, într-o bandă îngustă cu
// pictograme: acțiunile de pe tablă (exerciții, teorie, temă, test din site),
// pregătirea pentru lucrare, secțiunile (Astăzi, Plan, Teme…) și rapoartele.
// Sub tablă nu mai rămâne niciun buton — doar vocea elevului.
//
// Pe desktop banda se desface singură la HOVER (peste conținut, fără să
// împingă tabla). Pe telefon — unde nu există hover — rămâne lipită de
// marginea din stânga și se desface la atingerea butonului ☰.
//
// Structura vine din pagină (secțiuni → intrări), ca meniul să rămână un
// simplu afișaj: nu știe nimic despre acțiunile pe care le pornește.
//   sectiune = { titlu?, tone?: 'accent', items: [ … ] }
//   intrare  = { id, icon, label, title?, badge?, badgeGold?, accent?, active?,
//                disabled?, onClick }
// =====================================================================
import { useState, useEffect } from 'react';

function Item({ it, onPick }) {
  const cls = `mr-item${it.active ? ' activ' : ''}${it.accent ? ' mr-accent' : ''}`;
  return (
    <button type="button" className={cls} title={it.title || it.label} disabled={it.disabled}
      onClick={() => { it.onClick?.(); onPick?.(); }}>
      <span className="mr-ico" aria-hidden="true">{it.icon}</span>
      <span className="mr-text">{it.label}</span>
      {it.badge ? <span className={`mr-badge${it.badgeGold ? ' gold' : ''}`}>{it.badge}</span> : null}
    </button>
  );
}

export default function MedRail({ sections = [], footer = null }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // pe telefon, alegerea unei intrări închide sertarul
  const pick = () => setOpen(false);
  const groups = sections.filter((s) => s && (s.items || []).filter(Boolean).length);

  return (
    <>
      {open && <div className="med-rail-backdrop" onClick={() => setOpen(false)} aria-hidden="true" />}
      <aside className={`med-rail${open ? ' is-open' : ''}`} aria-label="Meniul meditațiilor">
        <div className="med-rail-inner">
          <button type="button" className="mr-toggle" onClick={() => setOpen((o) => !o)}
            aria-expanded={open} aria-label={open ? 'Închide meniul' : 'Deschide meniul'}>
            {open ? '✕' : '☰'}
          </button>
          {/* pe desktop: un indiciu discret că banda se desface la hover */}
          <div className="mr-head" aria-hidden="true">
            <span className="mr-head-ico">☰</span>
            <span className="mr-text mr-head-txt">Meniul meditației</span>
          </div>
          {groups.map((s, si) => (
            <div key={s.titlu || `s${si}`} className={`mr-grup-box${s.tone === 'accent' ? ' is-accent' : ''}`}>
              {si > 0 && <div className="mr-sep" />}
              {s.titlu && <div className="mr-grup">{s.titlu}</div>}
              {s.items.filter(Boolean).map((it) => <Item key={it.id} it={it} onPick={pick} />)}
            </div>
          ))}
          {footer && <div className="mr-foot">{footer}</div>}
        </div>
      </aside>
    </>
  );
}
