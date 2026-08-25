// =====================================================================
// src/components/CookieConsent.jsx — bannerul de consimțământ.
//
// Fără „Accept" nu se încarcă NICIUN script de măsurare (vezi
// src/lib/analytics.js). Alegerea se ține în localStorage, deci bannerul
// apare o singură dată per dispozitiv. Cookie-urile strict necesare
// (autentificare) nu depind de acest banner și rămân întotdeauna active.
// =====================================================================
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { consentState, setConsent } from '../lib/analytics';

export default function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Așteptăm un moment ca bannerul să nu concureze cu prima randare.
    const t = setTimeout(() => { if (!consentState()) setVisible(true); }, 800);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  function decide(granted) {
    setConsent(granted);
    setVisible(false);
  }

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Setări pentru cookie-uri"
      style={{
        position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 4000,
        maxWidth: 620, margin: '0 auto',
        background: 'var(--white)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
        padding: '18px 20px',
      }}
    >
      <div style={{ fontWeight: 700, color: 'var(--navy)', marginBottom: 6, fontSize: '.98rem' }}>
        🍪 Ne ajuți cu statisticile?
      </div>
      <p style={{ fontSize: '.88rem', color: 'var(--text-light)', margin: '0 0 14px', lineHeight: 1.55 }}>
        Folosim cookie-uri de analiză (Google Analytics și Meta) ca să vedem ce materiale
        sunt căutate și ce pagini nu funcționează. Nu sunt necesare ca să folosești site-ul —
        dacă refuzi, nu se încarcă nimic. Detalii în{' '}
        <Link to="/politica-cookies" style={{ color: 'var(--navy)', fontWeight: 600 }}>
          politica de cookie-uri
        </Link>.
      </p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" style={{ flex: '1 1 160px' }} onClick={() => decide(true)}>
          Accept
        </button>
        <button className="btn btn-outline" style={{ flex: '1 1 160px' }} onClick={() => decide(false)}>
          Doar strict necesare
        </button>
      </div>
    </div>
  );
}
