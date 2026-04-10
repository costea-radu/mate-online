import { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, isPremium, isAdmin, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const links = [
    { to: '/clase/5', label: 'Clasa 5' },
    { to: '/clase/6', label: 'Clasa 6' },
    { to: '/clase/7', label: 'Clasa 7' },
    { to: '/clase/8', label: 'Clasa 8' },
    { to: '/evaluare-nationala', label: 'Evaluare Națională' },
    { to: '/bacalaureat', label: 'Bacalaureat' },
    { to: '/manuale', label: 'Manuale' },
    { to: '/preturi', label: 'Prețuri' },
  ];

  const isActive = (path) => location.pathname === path || location.pathname.startsWith(path + '/');

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

        <ul className={`navbar-links ${open ? 'open' : ''}`}>
          {links.map(link => (
            <li key={link.to}>
              <Link
                to={link.to}
                className={isActive(link.to) ? 'active' : ''}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className={`navbar-auth ${open ? 'open' : ''}`}>
          {isAdmin && (
            <Link
              to="/admin"
              onClick={() => setOpen(false)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '5px 12px',
                borderRadius: 6,
                fontSize: '0.78rem',
                fontWeight: 700,
                background: 'rgba(232,185,49,0.15)',
                color: 'var(--gold)',
                border: '1px solid rgba(232,185,49,0.3)',
                letterSpacing: '0.03em',
                textTransform: 'uppercase',
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
