// =====================================================================
// src/components/Rolldown.jsx — secțiune pliabilă (rolldown) pentru
// panourile lungi din Admin (baza de cunoștințe, generatorul de exerciții,
// exercițiile încărcate de agent, task-urile programate etc.).
//
// • Conținutul rămâne MONTAT și când secțiunea e închisă (display:none),
//   ca starea internă (chat, exercițiu generat, formulare, liste încărcate)
//   să NU se piardă la pliere/depliere.
// • Starea deschis/închis se ține minte per secțiune (storageKey) în
//   localStorage, ca panoul de admin să se redeschidă cum l-ai lăsat.
// =====================================================================
import { useState } from 'react';

export default function Rolldown({
  title,                 // titlul secțiunii (text sau JSX)
  children,              // conținutul pliabil
  box = {},              // stilul cutiei exterioare (ex. cardul alb din Admin)
  defaultOpen = false,   // implicit: închis (rolldown)
  storageKey = null,     // ex. 'kb' → ține minte starea în localStorage
  small = false,         // true → titlu mic (subsecțiune), nu h3
  hint = null,           // text mic afișat lângă titlu (opțional)
}) {
  const [open, setOpen] = useState(() => {
    if (storageKey) {
      try {
        const v = localStorage.getItem('admin_rolldown:' + storageKey);
        if (v === '1') return true;
        if (v === '0') return false;
      } catch { /* localStorage indisponibil — folosim defaultOpen */ }
    }
    return defaultOpen;
  });

  function toggle() {
    setOpen((o) => {
      const next = !o;
      if (storageKey) {
        try { localStorage.setItem('admin_rolldown:' + storageKey, next ? '1' : '0'); } catch { /* ignore */ }
      }
      return next;
    });
  }

  const arrow = (
    <span aria-hidden="true" style={{
      display: 'inline-block', fontSize: small ? '.7rem' : '.8rem', color: 'var(--gold, #e8b931)',
      transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', flexShrink: 0,
    }}>▶</span>
  );

  return (
    <div style={box}>
      <button
        type="button" onClick={toggle} aria-expanded={open}
        title={open ? 'Închide secțiunea' : 'Deschide secțiunea'}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          background: 'none', border: 'none', padding: 0, margin: 0,
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        {arrow}
        {small ? (
          <span style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '.9rem' }}>{title}</span>
        ) : (
          <h3 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', margin: 0 }}>{title}</h3>
        )}
        {hint && <span style={{ fontSize: '.72rem', color: 'var(--text-muted)', fontWeight: 400 }}>{hint}</span>}
      </button>
      {/* montat mereu; doar ascuns când e închis — starea internă supraviețuiește */}
      <div style={{ display: open ? 'block' : 'none', marginTop: 12 }}>{children}</div>
    </div>
  );
}
