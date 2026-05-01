import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

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

// ─── Search Modal ─────────────────────────────────────────────────────────────
function getOriginalFilename(url) {
  if (!url) return null;
  try {
    const decoded = decodeURIComponent(url);
    const parts = decoded.split('/');
    const filename = parts[parts.length - 1];
    return filename.replace(/^\d+_/, '');
  } catch { return null; }
}

function SearchModal({ onClose }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const inputRef = useRef();
  const { user, isPremium } = useAuth();

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 50);
  }, []);

  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      // Caută în conținut (titlu + filename) și în discuții — în paralel
      const [
        { data: byTitle },
        { data: byFile },
        { data: byDisc }
      ] = await Promise.all([
        supabase.from('content').select('*').ilike('title', `%${query}%`).limit(10),
        supabase.from('content').select('*').ilike('file_url', `%${query}%`).limit(10),
        supabase.from('discussions').select('id, body, category_key, created_at, user_id')
          .ilike('body', `%${query}%`).is('parent_id', null).limit(5),
      ]);

      // Conținut — fără duplicate
      const combined = [...(byTitle || [])];
      const ids = new Set(combined.map(i => i.id));
      for (const item of (byFile || [])) {
        if (!ids.has(item.id)) { combined.push(item); ids.add(item.id); }
      }

      // Discuții — fără join pe profiles (evităm erori RLS)
      const discItems = (byDisc || []).map(d => ({ ...d, _type: 'discussion' }));

      setResults([...combined.slice(0, 10), ...discItems]);
      setLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const categoryLabels = {
    'clasa-5':'Clasa a V-a','clasa-6':'Clasa a VI-a','clasa-7':'Clasa a VII-a',
    'clasa-8':'Clasa a VIII-a','clasa-9':'Clasa a IX-a','clasa-10':'Clasa a X-a',
    'clasa-11':'Clasa a XI-a','clasa-12':'Clasa a XII-a',
    'evaluare-nationala':'Evaluare Națională','bacalaureat':'Bacalaureat','manuale':'Auxiliare',
  };

  function openItem(item) {
    const canAccess = item.is_free || isPremium;
    if (!canAccess) {
      // Nu poate accesa — duce la prețuri
      navigate('/preturi');
      onClose();
      return;
    }
    if (item.content_type === 'pdf') {
      navigate('/pdf-viewer', { state: { item } });
    } else if (item.content_type === 'interactive' || item.content_type === 'manual') {
      navigate('/exercitiu', { state: { item } });
    }
    onClose();
  }

  return (
    <>
      <div onClick={onClose} style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:1000 }} />
      <div style={{
        position:'fixed', top:'10%', left:'50%', transform:'translateX(-50%)',
        width:'min(560px, 92vw)', background:'#fff', borderRadius:14,
        boxShadow:'0 20px 60px rgba(0,0,0,0.3)', zIndex:1001, overflow:'hidden',
      }}>
        {/* Input */}
        <div style={{ display:'flex', alignItems:'center', padding:'14px 16px', borderBottom:'1px solid #eef0f4', gap:10 }}>
          <span style={{ fontSize:'1.1rem', flexShrink:0 }}>🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Caută exerciții, teste, capitole..."
            style={{
              flex:1, border:'none', outline:'none', fontSize:'1rem',
              color:'var(--navy)', background:'transparent', fontFamily:'var(--font-body)',
            }}
            onKeyDown={e => e.key === 'Escape' && onClose()}
          />
          {query && (
            <button onClick={() => setQuery('')} style={{ background:'none', border:'none', cursor:'pointer', color:'#aaa', fontSize:'1.1rem' }}>✕</button>
          )}
          <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:'#aaa', fontSize:'0.85rem', fontWeight:600, padding:'4px 8px', borderRadius:6, whiteSpace:'nowrap' }}>
            Închide
          </button>
        </div>

        {/* Results */}
        <div style={{ maxHeight:'60vh', overflowY:'auto' }}>
          {query.length < 2 ? (
            <div style={{ padding:'28px 20px', textAlign:'center', color:'#aaa', fontSize:'0.88rem' }}>
              Scrie cel puțin 2 caractere pentru a căuta...
            </div>
          ) : loading ? (
            <div style={{ padding:'28px 20px', textAlign:'center', color:'#aaa', fontSize:'0.88rem' }}>
              Se caută...
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding:'28px 20px', textAlign:'center', color:'#aaa', fontSize:'0.88rem' }}>
              Niciun rezultat pentru „{query}"
            </div>
          ) : results.map(item => {
            // Postare din discuții
            if (item._type === 'discussion') {
              return (
                <button
                  key={'disc-' + item.id}
                  onClick={() => { navigate('/discutii'); onClose(); }}
                  style={{ display:'block', width:'100%', textAlign:'left', padding:'12px 18px', background:'none', border:'none', borderBottom:'1px solid #f0f4f8', cursor:'pointer', transition:'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f7f9fc'}
                  onMouseLeave={e => e.currentTarget.style.background = 'none'}
                >
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ fontSize:'1rem', flexShrink:0 }}>💬</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, color:'var(--navy)', fontSize:'0.88rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {item.body?.slice(0, 80)}{item.body?.length > 80 ? '...' : ''}
                      </div>
                      <div style={{ fontSize:'0.73rem', color:'#8e95a3', marginTop:2 }}>
                        💬 Discuții · {item.profile?.full_name || 'Utilizator'}
                      </div>
                    </div>
                    <span style={{ fontSize:'0.75rem', color:'#bbb', flexShrink:0 }}>→</span>
                  </div>
                </button>
              );
            }

            // Fișier conținut
            const canAccess = item.is_free || isPremium;
            return (
              <button
                key={item.id}
                onClick={() => openItem(item)}
                style={{ display:'block', width:'100%', textAlign:'left', padding:'12px 18px', background:'none', border:'none', borderBottom:'1px solid #f0f4f8', cursor:'pointer', transition:'background 0.15s', opacity: canAccess ? 1 : 0.7 }}
                onMouseEnter={e => e.currentTarget.style.background = '#f7f9fc'}
                onMouseLeave={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <span style={{ fontSize:'1rem', flexShrink:0 }}>
                    {item.content_type === 'pdf' ? '📄' : item.content_type === 'interactive' ? '🧩' : '📖'}
                  </span>
                  <div style={{ flex:1, minWidth:0 }}>
                    <div style={{ fontWeight:600, color:'var(--navy)', fontSize:'0.9rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {item.title}
                    </div>
                    <div style={{ fontSize:'0.75rem', color:'#8e95a3', marginTop:2, display:'flex', gap:8, alignItems:'center' }}>
                      <span>{categoryLabels[item.category] || item.category}</span>
                      <span>·</span>
                      <span style={{ color: item.is_free ? '#2e7d32' : '#e65100', fontWeight:600 }}>
                        {item.is_free ? 'Gratuit' : 'Premium'}
                      </span>
                      {!canAccess && <span style={{ color:'#e65100', fontSize:'0.7rem' }}>🔒</span>}
                    </div>
                    {item.content_type === 'pdf' && getOriginalFilename(item.file_url) && (
                      <div style={{ fontSize:'0.67rem', color:'#b0b8c4', marginTop:2, fontStyle:'italic', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:340 }}>
                        {getOriginalFilename(item.file_url)}
                      </div>
                    )}
                  </div>
                  <span style={{ fontSize:'0.75rem', color:'#bbb', flexShrink:0 }}>{canAccess ? '→' : '🔒'}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
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
        <Link to="/discutii" onClick={onClose} style={{ ...linkStyle, color: location.pathname === '/discutii' ? 'var(--gold)' : 'rgba(255,255,255,0.88)' }}>
          💬 Discuții/Rezolvări
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
  const [searchOpen, setSearchOpen] = useState(false);

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

          {/* Butoane mobile: Căutare + Meniu */}
          <div className="mobile-actions">
            <button
              className="mobile-search-btn"
              onClick={() => setSearchOpen(true)}
              aria-label="Căutare"
            >
              🔍
            </button>
            <button
              className="mobile-toggle"
              onClick={() => setMobileOpen(o => !o)}
              aria-label="Meniu"
            >
              ☰
            </button>
          </div>

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
            <li>
              <Link to="/discutii" className={location.pathname === '/discutii' ? 'active' : ''}>
                💬 Discuții/Rezolvări
              </Link>
            </li>
          </ul>

          {/* Desktop auth buttons */}
          <div className="navbar-auth">
            {/* Buton căutare — vizibil pe desktop */}
            <button
              className="search-btn-desktop"
              onClick={() => setSearchOpen(true)}
              aria-label="Căutare"
            >
              🔍 Caută
            </button>
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

      {/* Search modal */}
      {searchOpen && (
        <SearchModal onClose={() => setSearchOpen(false)} />
      )}

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
