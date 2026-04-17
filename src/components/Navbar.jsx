import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const CLASE = [
  { to: '/clase/5',  label: 'Clasa a V-a' },
  { to: '/clase/6',  label: 'Clasa a VI-a' },
  { to: '/clase/7',  label: 'Clasa a VII-a' },
  { to: '/clase/8',  label: 'Clasa a VIII-a' },
  { to: '/clase/9',  label: 'Clasa a IX-a' },
  { to: '/clase/10', label: 'Clasa a X-a' },
  { to: '/clase/11', label: 'Clasa a XI-a' },
  { to: '/clase/12', label: 'Clasa a XII-a' },
];

const EXAMENE = [
  { to: '/evaluare-nationala',      label: 'Evaluare Națională' },
  { to: '/bacalaureat/mate-info',   label: 'Bacalaureat Mate-Info' },
  { to: '/bacalaureat/stiinte-naturii', label: 'Bacalaureat Șt. Naturii' },
  { to: '/bacalaureat/tehnologic',  label: 'Bacalaureat Tehnologic' },
];

// ─── Desktop dropdown ─────────────────────────────────────────────────────────
function DesktopDropdown({ label, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();
  const location = useLocation();

  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: open ? 'var(--gold)' : 'rgba(255,255,255,0.85)',
          fontFamily: 'var(--font-body)', fontSize: '0.92rem',
          fontWeight: 500, display: 'flex', alignItems: 'center', gap: 4,
          padding: '4px 0', transition: 'color 0.2s', whiteSpace: 'nowrap',
        }}
      >
        {label}
        <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0,
          background: 'var(--navy-light)', borderRadius: 10, minWidth: 220,
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)', zIndex: 1000,
          border: '1px solid rgba(255,255,255,0.08)', overflow: 'hidden',
        }}>
          {items.map(item => (
            <Link
              key={item.to}
              to={item.to}
              onClick={() => setOpen(false)}
              style={{
                display: 'block', padding: '10px 18px',
                color: location.pathname.startsWith(item.to) ? 'var(--gold)' : 'rgba(255,255,255,0.85)',
                fontWeight: location.pathname.startsWith(item.to) ? 600 : 400,
                fontSize: '0.88rem',
                borderBottom: '1px solid rgba(255,255,255,0.05)',
                background: location.pathname.startsWith(item.to) ? 'rgba(232,185,49,0.08)' : 'transparent',
              }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
              onMouseLeave={e => e.currentTarget.style.background = location.pathname.startsWith(item.to) ? 'rgba(232,185,49,0.08)' : 'transparent'}
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Mobile menu overlay ──────────────────────────────────────────────────────
function MobileMenu({ open, onClose, user, isPremium, isAdmin, onSignOut }) {
  const location = useLocation();
  const [claseOpen, setClaseOpen] = useState(false);
  const [exameneOpen, setExameneOpen] = useState(false);

  if (!open) return null;

  const linkStyle = {
    display: 'block', padding: '13px 24px',
    color: 'rgba(255,255,255,0.88)', fontSize: '0.97rem', fontWeight: 500,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    textDecoration: 'none',
  };
  const subLinkStyle = {
    display: 'block', padding: '10px 24px 10px 40px',
    color: 'rgba(255,255,255,0.65)', fontSize: '0.87rem',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
    textDecoration: 'none',
  };
  const sectionBtn = (isOpen) => ({
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    width: '100%', padding: '13px 24px',
    background: 'none', border: 'none', cursor: 'pointer',
    color: 'rgba(255,255,255,0.88)', fontSize: '0.97rem', fontWeight: 500,
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    fontFamily: 'var(--font-body)',
  });

  return (
    <>
      {/* Overlay backdrop */}
      <div
        onClick={onClose}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
          zIndex: 998,
        }}
      />
      {/* Drawer */}
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(300px, 85vw)',
        background: 'var(--navy)', zIndex: 999,
        overflowY: 'auto',
        boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '18px 24px', borderBottom: '1px solid rgba(255,255,255,0.1)',
        }}>
          <span style={{ fontFamily: 'var(--font-display)', color: 'var(--gold)', fontSize: '1.1rem' }}>
            Meniu
          </span>
          <button onClick={onClose} style={{
            background: 'none', border: 'none', color: 'rgba(255,255,255,0.6)',
            fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1,
          }}>✕</button>
        </div>

        {/* Clase — expandabil */}
        <button style={sectionBtn(claseOpen)} onClick={() => setClaseOpen(o => !o)}>
          <span>📚 Clase</span>
          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{claseOpen ? '▲' : '▼'}</span>
        </button>
        {claseOpen && CLASE.map(item => (
          <Link key={item.to} to={item.to} onClick={onClose}
            style={{ ...subLinkStyle, color: location.pathname === item.to ? 'var(--gold)' : 'rgba(255,255,255,0.65)' }}>
            {item.label}
          </Link>
        ))}

        {/* Examene — expandabil */}
        <button style={sectionBtn(exameneOpen)} onClick={() => setExameneOpen(o => !o)}>
          <span>📝 Examene</span>
          <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{exameneOpen ? '▲' : '▼'}</span>
        </button>
        {exameneOpen && EXAMENE.map(item => (
          <Link key={item.to} to={item.to} onClick={onClose}
            style={{ ...subLinkStyle, color: location.pathname.startsWith(item.to) ? 'var(--gold)' : 'rgba(255,255,255,0.65)' }}>
            {item.label}
          </Link>
        ))}

        {/* Linkuri simple */}
        <Link to="/manuale" onClick={onClose} style={{ ...linkStyle, color: location.pathname === '/manuale' ? 'var(--gold)' : 'rgba(255,255,255,0.88)' }}>
          📖 Auxiliare
        </Link>
        <Link to="/preturi" onClick={onClose} style={{ ...linkStyle, color: location.pathname === '/preturi' ? 'var(--gold)' : 'rgba(255,255,255,0.88)' }}>
          💳 Prețuri
        </Link>

        {/* Separator */}
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.12)', margin: '8px 0' }} />

        {/* Admin */}
        {isAdmin && (
          <Link to="/admin" onClick={onClose} style={{
            ...linkStyle,
            color: 'var(--gold)', fontWeight: 700,
          }}>
            ⚙ Admin
          </Link>
        )}

        {/* Cont / Auth */}
        {user ? (
          <>
            <Link to="/profil" onClick={onClose} style={{
              ...linkStyle,
              color: isPremium ? 'var(--gold)' : 'rgba(255,255,255,0.88)',
            }}>
              {isPremium ? '⭐ Contul meu' : '👤 Contul meu'}
            </Link>
            <button onClick={onSignOut} style={{
              ...linkStyle, background: 'none', border: 'none',
              cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-body)',
              color: 'rgba(255,100,100,0.85)',
            }}>
              🚪 Ieșire
            </button>
          </>
        ) : (
          <>
            <Link to="/autentificare" onClick={onClose} style={linkStyle}>
              🔑 Autentificare
            </Link>
            <Link to="/inregistrare" onClick={onClose} style={{
              ...linkStyle, color: 'var(--gold)', fontWeight: 700,
            }}>
              ✨ Înregistrare
            </Link>
          </>
        )}
      </div>
    </>
  );
}

// ─── Navbar principal ─────────────────────────────────────────────────────────
export default function Navbar() {
  const { user, isPremium, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    setMobileOpen(false);
    await signOut();
    navigate('/');
  }

  return (
    <>
      <nav className="navbar">
        <div className="container navbar-inner">
          <Link to="/" className="navbar-logo">
            <span className="logo-accent">Mate</span>Online
          </Link>

          {/* Buton hamburgher — doar pe mobile */}
          <button
            className="mobile-toggle"
            onClick={() => setMobileOpen(o => !o)}
            aria-label="Meniu"
          >
            ☰
          </button>

          {/* Desktop nav links */}
          <ul className="navbar-links" style={{ alignItems: 'center' }}>
            <li><DesktopDropdown label="Clase" items={CLASE} /></li>
            <li><DesktopDropdown label="Examene" items={EXAMENE} /></li>
            <li>
              <Link to="/manuale" className={location.pathname === '/manuale' ? 'active' : ''}>
                Auxiliare
              </Link>
            </li>
            <li>
              <Link to="/preturi" className={location.pathname === '/preturi' ? 'active' : ''}>
                Prețuri
              </Link>
            </li>
          </ul>

          {/* Desktop auth buttons */}
          <div className="navbar-auth">
            {isAdmin && (
              <Link to="/admin" style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: 6, fontSize: '0.78rem',
                fontWeight: 700, background: 'rgba(232,185,49,0.15)',
                color: 'var(--gold)', border: '1px solid rgba(232,185,49,0.3)',
                letterSpacing: '0.03em', textTransform: 'uppercase',
              }}>
                ⚙ Admin
              </Link>
            )}
            {user ? (
              <>
                <Link to="/profil" className="btn btn-sm btn-outline" style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>
                  {isPremium ? '⭐ Contul meu' : 'Contul meu'}
                </Link>
                <button onClick={handleSignOut} className="btn btn-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
                  Ieșire
                </button>
              </>
            ) : (
              <>
                <Link to="/autentificare" className="btn btn-sm" style={{ color: 'rgba(255,255,255,0.8)' }}>
                  Autentificare
                </Link>
                <Link to="/inregistrare" className="btn btn-sm btn-primary">
                  Înregistrare
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Mobile drawer */}
      <MobileMenu
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        user={user}
        isPremium={isPremium}
        isAdmin={isAdmin}
        onSignOut={handleSignOut}
      />
    </>
  );
}
