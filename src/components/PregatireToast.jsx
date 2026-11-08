// =====================================================================
// src/components/PregatireToast.jsx — „🎯 Pregătește-mă de examen" (8 nov. 2026)
//
// Felicitarea după ce ziua s-a bifat (răspunsul `pregatire` de la api/ai-score.js,
// api/rezolva-pdf.js, api/ai-correct.js — api/_lib/pregatireZilnica.js →
// inregistreaza) sau, în testul zilei, cât mai e până la bifă („încă 1 exercițiu").
// Folosit de vizualizatorul interactiv și de cel PDF.
// =====================================================================
import { useEffect } from 'react';
import { Link } from 'react-router-dom';

// ce merită arătat: bifa de azi (mereu), o insignă câștigată mai târziu în zi
// (testul terminat complet) sau progresul spre bifă (doar în testul zilei)
export function deAratat(rez, { dinPregatire = false } = {}) {
  if (!rez) return null;
  if (rez.tocmaiBifata) return 'bifata';
  if (Array.isArray(rez.insigne) && rez.insigne.length) return 'insigna';
  if (dinPregatire && !rez.lucrat && rez.lipsa > 0) return 'progres';
  return null;
}

export default function PregatireToast({ rez, fel, onClose, top = 150 }) {
  // felicitarea stă 12 s, progresul 7 s
  useEffect(() => {
    if (!rez || !fel) return undefined;
    const t = setTimeout(() => onClose && onClose(), fel === 'progres' ? 7000 : 12000);
    return () => clearTimeout(t);
  }, [rez, fel, onClose]);
  if (!rez || !fel) return null;
  const bifata = fel === 'bifata' || fel === 'insigna';
  return (
    <div style={{ position: 'fixed', top, left: 16, zIndex: 2000, maxWidth: 340 }} role="status" aria-live="polite">
      <div style={{
        background: bifata ? 'linear-gradient(135deg, #fff8e1, #ffffff)' : '#fff',
        border: `2px solid ${bifata ? 'var(--gold)' : '#f1d27a'}`, borderRadius: 12, padding: '12px 14px',
        boxShadow: '0 8px 24px rgba(0,0,0,.25)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 800, color: 'var(--navy)' }}>
          <span style={{ fontSize: '1.4rem' }}>{bifata ? '🎯' : '📝'}</span>
          {fel === 'insigna' ? 'Insignă nouă!' : bifata ? 'Testul zilei — ziua e bifată!' : 'Testul zilei'}
          <button onClick={onClose} aria-label="Închide"
            style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#6b7689' }}>✕</button>
        </div>
        <div style={{ fontSize: '.82rem', color: '#44566b', marginTop: 6, lineHeight: 1.55 }}>
          {fel === 'insigna' ? (
            <>
              {(rez.insigne || []).map((b) => <div key={b.id}>{b.icon} <strong>{b.name}</strong></div>)}
              <div>Ai terminat testul de la început până la sfârșit. Bravo!</div>
            </>
          ) : bifata ? (
            <>
              <strong>+{rez.xp} XP · +{rez.coins} 🪙</strong>{rez.bun ? ' (bonus pentru 80%+)' : ''}
              {rez.serie ? <> · 🔥 {rez.serie} {rez.serie === 1 ? 'zi' : 'zile'} la rând</> : null}
              {rez.bonusSerie && <div>🏅 Bonus de serie: încă o săptămână fără pauză!</div>}
              {(rez.insigne || []).map((b) => <div key={b.id}>{b.icon} Insignă nouă: <strong>{b.name}</strong></div>)}
              <div>Poți continua testul — la verificare, fiecare răspuns corect aduce XP.</div>
            </>
          ) : (
            <>Ai lucrat la <strong>{rez.itemi}</strong> {rez.itemi === 1 ? 'exercițiu' : 'exerciții'} — încă <strong>{rez.lipsa}</strong> și ziua e bifată.</>
          )}
          {' '}<Link to="/pregateste-ma" style={{ color: 'var(--navy)', fontWeight: 700 }}>Pregătește-mă</Link>
        </div>
      </div>
    </div>
  );
}
