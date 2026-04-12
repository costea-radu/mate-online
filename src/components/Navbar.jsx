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
  { to: '/evaluare-nationala', label: 'Evaluare Națională' },
  { to: '/bacalaureat/mate-info', label: 'Bacalaureat Mate-Info' },
  { to: '/bacalaureat/stiinte-naturii', label: 'Bacalaureat Științele Naturii' },
  { to: '/bacalaureat/tehnologic', label: 'Bacalaureat Tehnologic' },
];

function Dropdown({ label, items, onClose }) {
  const location = useLocation();
  return (
    <div style={{
      position: 'absolute', top: 'calc(100% + 8px)', left: 0,
      background: 'var(--navy-light)', borderRadius: 10, minWidth: 220,
      boxShadow: '0 8px 32px rgba(0,0,0,0.25)', zIndex: 1000,
      border: '1px solid rgba(255,255,255,0.08)',
      overflow: 'hidden',
    }}>
      {items.map(item => (
        <Link
          key={item.to}
          to={item.to}
          onClick={onClose}
          style={{
            display: 'block', padding: '10px 18px',
            color: location.pathname === item.to || location.pathname.startsWith(item.to + '/')
              ? 'var(--gold)' : 'rgba(255,255,255,0.85)',
            fontWeight: location.pathname.startsWith(item.to) ? 600 : 400,
            fontSize: '0.88rem',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
            transition: 'background 0.15s',
            background: location.pathname.startsWith(item.to) ? 'rgba(232,185,49,0.08)' : 'transparent',
          }}
          onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.07)'}
          onMouseLeave={e => e.currentTarget.style.background = location.pathname.startsWith(item.to) ? 'rgba(232,185,49,0.08)' : 'transparent'}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

function NavDropdown({ label, items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef();

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
          padding: '4px 0', transition: 'color 0.2s',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
        <span style={{ fontSize: '0.65rem', opacity: 0.7, marginTop: 1 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>
      {open && <Dropdown items={items} onClose={() => setOpen(false)} />}
    </div>
  );
}

export default function Navbar() {
  const { user, isPremium, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  async function handleSignOut() {
    await signOut();
    setOpen(false);
    navigate('/');
  }

  return (
    <nav className="navbar">
      <div className="container navbar-inner">
        <Link to="/" className="navbar-logo">
          <span className="logo-accent">Mate</span>Online
        </Link>

        <button className="mobile-toggle" onClick={() => setOpen(!open)} aria-label="Meniu">
          {open ? '✕' : '☰'}
        </button>

        {/* Desktop nav */}
        <ul className={`navbar-links ${open ? 'open' : ''}`} style={{ alignItems: 'center' }}>
          <li><NavDropdown label="Clase" items={CLASE} /></li>
          <li><NavDropdown label="Examene" items={EXAMENE} /></li>
          <li>
            <Link
              to="/manuale"
              className={location.pathname === '/manuale' ? 'active' : ''}
              onClick={() => setOpen(false)}
            >
              Manuale
            </Link>
          </li>
          <li>
            <Link
              to="/preturi"
              className={location.pathname === '/preturi' ? 'active' : ''}
              onClick={() => setOpen(false)}
            >
              Prețuri
            </Link>
          </li>
        </ul>

        <div className={`navbar-auth ${open ? 'open' : ''}`}>
          {isAdmin && (
            <Link
              to="/admin"
              onClick={() => setOpen(false)}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 5,
                padding: '5px 12px', borderRadius: 6, fontSize: '0.78rem',
                fontWeight: 700, background: 'rgba(232,185,49,0.15)',
                color: 'var(--gold)', border: '1px solid rgba(232,185,49,0.3)',
                letterSpacing: '0.03em', textTransform: 'uppercase',
              }}
            >
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
  );
}
