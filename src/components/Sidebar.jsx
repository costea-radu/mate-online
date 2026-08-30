import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import EinsteinIcon from './EinsteinIcon';

// ─────────────────────────────────────────────────────────────────────────────
// src/components/Sidebar.jsx — MENIUL LATERAL (stil „Admin")
//
// Bară fixă, lipită de marginea din stânga a paginii, imediat sub navbar.
// Conține TOT ce era în „Mai multe" plus restul intrărilor din navbar
// (Examene, Clase, Abonament / Meditații, Admin, Cont).
//
// Pe mobil (≤768px) bara dispare — acolo rămâne drawer-ul ☰ de până acum.
// Indicatorii (bulina de mesaje, punctul auriu de forum) vin ca props din
// Navbar, ca să nu întrebăm serverul de două ori pentru aceleași numere.
// ─────────────────────────────────────────────────────────────────────────────

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
  { to: '/evaluare-nationala',          label: 'Evaluare Națională' },
  { to: '/bacalaureat/mate-info',       label: 'Bacalaureat Mate-Info' },
  { to: '/bacalaureat/stiinte-naturii', label: 'Bacalaureat Șt. Naturii' },
  { to: '/bacalaureat/tehnologic',      label: 'Bacalaureat Tehnologic' },
];

const INFORMATII = [
  { to: '/despre-noi',                 label: 'Despre noi' },
  { to: '/faq',                        label: 'Întrebări frecvente' },
  { to: '/contact',                    label: 'Contact' },
  { to: '/termeni-conditii',           label: 'Termeni și condiții' },
  { to: '/politica-confidentialitate', label: 'Confidențialitate' },
  { to: '/politica-cookies',           label: 'Politica de cookie-uri' },
  { to: '/politica-retur',             label: 'Politica de retur' },
];

// ─── Bulina roșie (mesaje noi) ───────────────────────────────────────────────
function Bulina({ n, titlu = 'mesaje noi' }) {
  if (!n) return null;
  return (
    <span
      title={`${n} ${titlu}`}
      aria-label={`${n} ${titlu}`}
      style={{
        background: '#e74c3c', color: '#fff', borderRadius: 10, fontSize: '.62rem',
        fontWeight: 700, padding: '1px 5px', minWidth: 16, textAlign: 'center',
        lineHeight: 1.5, marginLeft: 'auto', flexShrink: 0,
      }}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

// Pagina curentă: potrivire exactă sau pe prefix de secțiune (/clase/7 etc.).
function esteActiv(pathname, to) {
  if (to === '/') return pathname === '/';
  return pathname === to || pathname.startsWith(`${to}/`);
}

export default function Sidebar({
  user,
  isPremium = false,
  isAdmin = false,
  aiLabel = 'Profesor Virtual',
  chatUnread = 0,
  forumUnread = 0,
  forumHasNew = false,
  onSignOut,
}) {
  const location = useLocation();
  const { pathname } = location;

  // Secțiunile pliabile se deschid singure când ești deja înăuntru.
  const [exameneOpen, setExameneOpen] = useState(() => EXAMENE.some(i => esteActiv(pathname, i.to)));
  const [claseOpen, setClaseOpen]     = useState(() => pathname.startsWith('/clase'));

  useEffect(() => {
    if (EXAMENE.some(i => esteActiv(pathname, i.to))) setExameneOpen(true);
    if (pathname.startsWith('/clase')) setClaseOpen(true);
  }, [pathname]);

  // ─── Stiluri (aceeași gramatică vizuală ca în panoul Admin) ───────────────
  const itemStyle = (active) => ({
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%', padding: '10px 18px', textAlign: 'left',
    color: active ? 'var(--gold)' : 'rgba(255,255,255,0.62)',
    background: active ? 'rgba(232,185,49,0.10)' : 'none',
    borderLeft: active ? '3px solid var(--gold)' : '3px solid transparent',
    fontWeight: active ? 600 : 400,
    fontSize: '0.86rem', lineHeight: 1.35,
    fontFamily: 'var(--font-body)',
    border: 'none', borderLeftWidth: 3, borderLeftStyle: 'solid',
    borderLeftColor: active ? 'var(--gold)' : 'transparent',
    cursor: 'pointer', transition: 'all 0.18s',
  });

  const subItemStyle = (active) => ({
    ...itemStyle(active),
    padding: '8px 18px 8px 38px',
    fontSize: '0.82rem',
  });

  const grupTitlu = {
    padding: '16px 21px 6px', fontSize: '0.66rem', fontWeight: 700,
    letterSpacing: '0.09em', textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.30)',
  };

  const hoverOn  = (e, active) => { if (!active) e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; };
  const hoverOff = (e, active) => { if (!active) e.currentTarget.style.background = 'none'; };

  // Un link de meniu, cu starea „activ" calculată din rută.
  function Item({ to, children, badge = 0, badgeTitlu, dot = false }) {
    const active = esteActiv(pathname, to);
    return (
      <Link
        to={to}
        style={{ ...itemStyle(active), textDecoration: 'none' }}
        onMouseEnter={e => hoverOn(e, active)}
        onMouseLeave={e => hoverOff(e, active)}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
          {children}
          {dot && <span className="forum-dot" title="Activitate nouă pe forum" aria-label="Activitate nouă pe forum" />}
        </span>
        <Bulina n={badge} titlu={badgeTitlu} />
      </Link>
    );
  }

  // Cap de secțiune pliabilă (Examene / Clase).
  function Sectiune({ open, setOpen, children }) {
    return (
      <button
        onClick={() => setOpen(o => !o)}
        style={{ ...itemStyle(false), justifyContent: 'space-between' }}
        onMouseEnter={e => hoverOn(e, false)}
        onMouseLeave={e => hoverOff(e, false)}
      >
        <span>{children}</span>
        <span style={{ fontSize: '0.62rem', opacity: 0.6 }}>{open ? '▲' : '▼'}</span>
      </button>
    );
  }

  return (
    <aside className="app-sidebar" aria-label="Meniu principal">
      <nav style={{ padding: '10px 0 28px' }}>

        <Item to="/">🏠 Acasă</Item>

        {/* ── Materiale ── */}
        <div style={grupTitlu}>Materiale</div>

        <Sectiune open={exameneOpen} setOpen={setExameneOpen}>🎓 Examene</Sectiune>
        {exameneOpen && EXAMENE.map(item => {
          const active = esteActiv(pathname, item.to);
          return (
            <Link key={item.to} to={item.to}
              style={{ ...subItemStyle(active), textDecoration: 'none' }}
              onMouseEnter={e => hoverOn(e, active)}
              onMouseLeave={e => hoverOff(e, active)}>
              {item.label}
            </Link>
          );
        })}

        <Sectiune open={claseOpen} setOpen={setClaseOpen}>📚 Clase</Sectiune>
        {claseOpen && CLASE.map(item => {
          const active = pathname === item.to;
          return (
            <Link key={item.to} to={item.to}
              style={{ ...subItemStyle(active), textDecoration: 'none' }}
              onMouseEnter={e => hoverOn(e, active)}
              onMouseLeave={e => hoverOff(e, active)}>
              {item.label}
            </Link>
          );
        })}

        <Item to="/manuale">📖 Auxiliare</Item>
        <Item to="/rezolvari">📝 Blog / Rezolvări / Teorie</Item>
        <Item to="/biblioteca-utilizatorilor">🏛️ Biblioteca utilizatorilor</Item>

        {/* ── Învățare cu AI ── */}
        <div style={grupTitlu}>Învățare cu AI</div>

        <Item to="/meditatii"><EinsteinIcon size={16} /> Meditații cu AI</Item>
        <Item to="/profesor-virtual"><EinsteinIcon size={16} /> {aiLabel}</Item>

        {/* ── Comunitate ── */}
        <div style={grupTitlu}>Comunitate</div>

        <Item to="/mesagerie" badge={chatUnread}>💬 Mesagerie</Item>
        <Item to="/discutii" badge={forumUnread} badgeTitlu="răspunsuri noi" dot={forumHasNew}>💬 Forum</Item>
        <Item to="/arena">⚔️ Arena matematică</Item>
        <Item to="/recenzii">⭐ Recenzii</Item>

        {/* ── Cont ── */}
        <div style={grupTitlu}>Cont</div>

        <Item to="/preturi">💳 Abonament</Item>

        {isAdmin && (
          <Link to="/admin"
            style={{ ...itemStyle(esteActiv(pathname, '/admin')), color: 'var(--gold)', fontWeight: 700, textDecoration: 'none' }}
            onMouseEnter={e => hoverOn(e, esteActiv(pathname, '/admin'))}
            onMouseLeave={e => hoverOff(e, esteActiv(pathname, '/admin'))}>
            ⚙ Admin
          </Link>
        )}

        {user ? (
          <>
            <Item to="/profil">{isPremium ? '⭐ Contul meu' : '👤 Contul meu'}</Item>
            <button
              onClick={onSignOut}
              style={{ ...itemStyle(false), color: 'rgba(255,120,120,0.80)' }}
              onMouseEnter={e => hoverOn(e, false)}
              onMouseLeave={e => hoverOff(e, false)}>
              🚪 Ieșire
            </button>
          </>
        ) : (
          <>
            <Item to="/autentificare">🔑 Autentificare</Item>
            <Link to="/inregistrare"
              style={{ ...itemStyle(esteActiv(pathname, '/inregistrare')), color: 'var(--gold)', fontWeight: 700, textDecoration: 'none' }}
              onMouseEnter={e => hoverOn(e, esteActiv(pathname, '/inregistrare'))}
              onMouseLeave={e => hoverOff(e, esteActiv(pathname, '/inregistrare'))}>
              ✨ Înregistrare
            </Link>
          </>
        )}

        {/* ── Informații ── */}
        <div style={grupTitlu}>Informații</div>
        {INFORMATII.map(item => (
          <Item key={item.to} to={item.to}>{item.label}</Item>
        ))}

      </nav>
    </aside>
  );
}
