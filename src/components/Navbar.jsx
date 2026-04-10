import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Navbar() {
  const { user, isPremium, signOut } = useAuth();
  const location = useLocation();
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
          {user ? (
            <>
              <Link to="/profil" className="btn btn-sm btn-outline" style={{ borderColor: 'var(--gold)', color: 'var(--gold)' }}>
                {isPremium ? '⭐ Contul meu' : 'Contul meu'}
              </Link>
              <button onClick={signOut} className="btn btn-sm" style={{ color: 'rgba(255,255,255,0.6)' }}>
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
