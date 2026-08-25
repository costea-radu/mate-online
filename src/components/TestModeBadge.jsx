// =====================================================================
// src/components/TestModeBadge.jsx — „Mesageria e oprită în timpul testului"
//
// Se arată în vizualizatoare (interactiv / PDF / exercițiu generat) cât timp
// elevul rezolvă un TEST PE GRUPĂ, adică atunci când vizualizatorul a fost
// deschis cu o repartizare (`?gt=…` sau `state.gtId`).
//
// Blocarea propriu-zisă e pe server (api/messages.js verifică
// `group_assignment_picks.active_until`); aici doar îl anunțăm pe elev.
// =====================================================================
import { useState } from 'react';

export default function TestModeBadge({ compact = false }) {
  const [open, setOpen] = useState(!compact);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} title="Mesageria e oprită în timpul testului"
        style={{
          border: '1px solid rgba(198,40,40,.35)', background: 'rgba(198,40,40,.08)',
          color: '#8a3b3b', borderRadius: 20, padding: '3px 10px', fontSize: '.72rem',
          fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--font-body)', whiteSpace: 'nowrap',
        }}>
        🔒 Test în desfășurare
      </button>
    );
  }

  return (
    <div style={{
      display: 'inline-flex', gap: 8, alignItems: 'center', maxWidth: '100%',
      background: 'rgba(198,40,40,.08)', border: '1px solid rgba(198,40,40,.35)',
      borderRadius: 10, padding: '6px 10px',
    }}>
      <span style={{ fontSize: '.95rem', lineHeight: 1 }}>🔒</span>
      <span style={{ fontSize: '.76rem', color: '#8a3b3b', fontWeight: 600, lineHeight: 1.35 }}>
        Test pe grupă în desfășurare — <strong>mesageria e oprită</strong> până trimiți rezultatul.
      </span>
      <button type="button" onClick={() => setOpen(false)} aria-label="Ascunde"
        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#8a3b3b', fontSize: '.8rem', lineHeight: 1 }}>✕</button>
    </div>
  );
}
