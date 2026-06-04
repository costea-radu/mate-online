// Modal de alegere a tipului de cont (Elev / Profesor).
// Folosit la prima logare pentru utilizatorii fără rol setat.
// Componentă pur prezentațională: apelează onSelect('elev' | 'profesor').

const OPTIONS = [
  {
    value: 'elev',
    icon: '🎒',
    title: 'Elev',
    tag: 'doar rezolv',
    desc: 'Rezolvi exerciții și teste interactive și îți urmărești scorurile.',
  },
  {
    value: 'profesor',
    icon: '🧑‍🏫',
    title: 'Profesor',
    tag: 'rezolv || corectez',
    desc: 'Inviți elevi cu un link și le urmărești rezultatele la teste într-un tabel.',
  },
];

export default function RoleChooser({ onSelect, busy = false, error = '', selected = null }) {
  return (
    <>
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(9,30,48,0.55)', zIndex: 1200 }} />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
          width: 'min(560px, 92vw)', background: '#fff', borderRadius: 'var(--radius-lg)',
          boxShadow: '0 24px 70px rgba(0,0,0,0.35)', zIndex: 1201, padding: '32px 28px',
          maxHeight: '90vh', overflowY: 'auto',
        }}
      >
        <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: '1.5rem', marginBottom: 6 }}>
          Ce tip de cont ai?
        </h2>
        <p style={{ color: 'var(--text-light)', fontSize: '0.92rem', marginBottom: 22 }}>
          Alege o opțiune pentru a continua. Setarea se face o singură dată.
        </p>

        {error && (
          <div style={{ background: '#fce4ec', color: 'var(--danger)', padding: '10px 14px', borderRadius: 'var(--radius)', marginBottom: 16, fontSize: '0.86rem' }}>
            {error}
          </div>
        )}

        <div style={{ display: 'grid', gap: 14 }}>
          {OPTIONS.map((opt) => {
            const isSel = selected === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                disabled={busy}
                onClick={() => onSelect(opt.value)}
                style={{
                  textAlign: 'left', display: 'flex', alignItems: 'flex-start', gap: 16,
                  padding: '18px 20px', borderRadius: 'var(--radius-lg)', cursor: busy ? 'wait' : 'pointer',
                  border: `2px solid ${isSel ? 'var(--gold)' : 'var(--border)'}`,
                  background: isSel ? 'rgba(232,185,49,0.08)' : 'var(--white)',
                  transition: 'all 0.2s', opacity: busy && !isSel ? 0.6 : 1,
                }}
                onMouseEnter={(e) => { if (!busy && !isSel) e.currentTarget.style.borderColor = 'var(--navy-light)'; }}
                onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.borderColor = 'var(--border)'; }}
              >
                <span style={{ fontSize: '1.9rem', lineHeight: 1, flexShrink: 0 }}>{opt.icon}</span>
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <strong style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)', fontSize: '1.12rem' }}>
                      {opt.title}
                    </strong>
                    <span style={{
                      fontSize: '0.72rem', fontWeight: 700, color: 'var(--navy)',
                      background: 'var(--cream-dark)', padding: '2px 8px', borderRadius: 20,
                    }}>
                      {opt.tag}
                    </span>
                  </span>
                  <span style={{ display: 'block', color: 'var(--text-light)', fontSize: '0.88rem', marginTop: 4 }}>
                    {opt.desc}
                  </span>
                </span>
                {busy && isSel && <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
