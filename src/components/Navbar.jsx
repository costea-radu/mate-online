import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import AINotifications from './AINotifications';
import EinsteinIcon from './EinsteinIcon';
import { aiAssistantLabel } from '../lib/aiLabel';

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

// „Mai multe" — pentru aerisirea barei principale
const MAIMULTE = [
  { to: '/manuale',                    label: '📖 Auxiliare' },
  { to: '/rezolvari',                  label: '📝 Blog / Rezolvări / Teorie' },
  { to: '/biblioteca-utilizatorilor',  label: '🏛️ Biblioteca utilizatorilor' },
  { to: '/profesor-virtual',           label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><EinsteinIcon size={16} /> Profesor Virtual</span> },
  { to: '/despre-noi',                 label: 'Despre noi' },
  { to: '/faq',                        label: 'Întrebări frecvente' },
  { to: '/contact',                    label: 'Contact' },
  { to: '/termeni-conditii',           label: 'Termeni și condiții' },
  { to: '/politica-confidentialitate', label: 'Confidențialitate' },
  { to: '/politica-cookies',           label: 'Politica de cookie-uri' },
  { to: '/politica-retur',             label: 'Politica de retur' },
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
      // Caută în conținut, discuții, rezolvări și biblioteca utilizatorilor — în paralel
      const [
        { data: byTitle },
        { data: byFile },
        { data: byDisc },
        { data: byRez },
        { data: byPub }
      ] = await Promise.all([
        supabase.from('content').select('*').ilike('title', `%${query}%`).limit(10),
        supabase.from('content').select('*').ilike('file_url', `%${query}%`).limit(10),
        supabase.from('discussions').select('id, body, category_key, created_at, user_id')
          .ilike('body', `%${query}%`).is('parent_id', null).limit(5),
        supabase.from('rezolvari').select('id, title, description, category, type, is_free')
          .ilike('title', `%${query}%`).limit(5),
        supabase.from('ai_public_library').select('id, kind, title, category, creator_name, creator_role')
          .ilike('search_text', `%${query}%`).limit(6),
      ]);

      const combined = [...(byTitle || [])];
      const ids = new Set(combined.map(i => i.id));
      for (const item of (byFile || [])) {
        if (!ids.has(item.id)) { combined.push(item); ids.add(item.id); }
      }
      const discItems = (byDisc || []).map(d => ({ ...d, _type: 'discussion' }));
      const rezItems  = (byRez  || []).map(r => ({ ...r, _type: 'rezolvare' }));
      const pubItems  = (byPub  || []).map(p => ({ ...p, _type: 'public' }));
      setResults([...combined.slice(0, 8), ...pubItems, ...discItems, ...rezItems]);
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
            // Test/exercițiu din Biblioteca utilizatorilor
            if (item._type === 'public') {
              const icon = item.kind === 'exam' ? '📄' : item.kind === 'practice' ? '✍️' : '🧩';
              return (
                <button key={'pub-' + item.id} onClick={() => { onClose(); navigate('/biblioteca-utilizatorilor?q=' + encodeURIComponent(item.title)); }}
                  style={{ display:'block', width:'100%', textAlign:'left', padding:'12px 18px', background:'none', border:'none', borderBottom:'1px solid #f0f4f8', cursor:'pointer', transition:'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background='#f7f9fc'}
                  onMouseLeave={e => e.currentTarget.style.background='none'}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ fontSize:'1rem', flexShrink:0 }}>{icon}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, color:'var(--navy)', fontSize:'0.9rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.title}</div>
                      <div style={{ fontSize:'0.73rem', color:'#8e95a3', marginTop:2 }}>
                        🏛️ Biblioteca utilizatorilor · {item.creator_role === 'parinte' ? 'Părinte' : 'Prof.'} {item.creator_name || ''}
                      </div>
                    </div>
                    <span style={{ fontSize:'0.75rem', color:'#bbb' }}>→</span>
                  </div>
                </button>
              );
            }

            // Rezolvare
            if (item._type === 'rezolvare') {
              return (
                <button key={'rez-'+item.id} onClick={() => { navigate('/rezolvari'); onClose(); }}
                  style={{ display:'block', width:'100%', textAlign:'left', padding:'12px 18px', background:'none', border:'none', borderBottom:'1px solid #f0f4f8', cursor:'pointer', transition:'background 0.15s' }}
                  onMouseEnter={e => e.currentTarget.style.background='#f7f9fc'}
                  onMouseLeave={e => e.currentTarget.style.background='none'}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ fontSize:'1rem', flexShrink:0 }}>{item.type==='video'?'▶':item.type==='pdf'?'📄':'🖼'}</span>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:600, color:'var(--navy)', fontSize:'0.9rem', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{item.title}</div>
                      <div style={{ fontSize:'0.73rem', color:'#8e95a3', marginTop:2 }}>
                        📝 Blog / Rezolvări / Teorie · <span style={{ color:item.is_free?'#2e7d32':'#e65100', fontWeight:600 }}>{item.is_free?'Gratuit':'Premium'}</span>
                      </div>
                    </div>
                    <span style={{ fontSize:'0.75rem', color:'#bbb' }}>→</span>
                  </div>
                </button>
              );
            }

            // Postare din discuții
            if (item._type === 'discussion') {
              return (
                <button
                  key={'disc-' + item.id}
                  onClick={() => {
                    onClose();
                    navigate('/discutii', { state: { scrollTo: `disc-${item.id}` } });
                  }}
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
function MobileMenu({ open, onClose, user, isPremium, isAdmin, aiLabel = 'Profesor Virtual', forumUnread = 0, forumHasNew = false, onSignOut }) {
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

        {/* Linkuri simple */}
        <Link to="/manuale" onClick={onClose} style={{ ...linkStyle, color: location.pathname === '/manuale' ? 'var(--gold)' : 'rgba(255,255,255,0.88)' }}>
          📖 Auxiliare
        </Link>
        <Link to="/preturi" onClick={onClose} style={{ ...linkStyle, color: location.pathname === '/preturi' ? 'var(--gold)' : 'rgba(255,255,255,0.88)' }}>
          💳 Abonament
        </Link>
        <Link to="/rezolvari" onClick={onClose} style={{ ...linkStyle, color: location.pathname === '/rezolvari' ? 'var(--gold)' : 'rgba(255,255,255,0.88)' }}>
          📝 Blog / Rezolvări / Teorie
        </Link>
        <Link to="/profesor-virtual" onClick={onClose} style={{ ...linkStyle, color: location.pathname === '/profesor-virtual' ? 'var(--gold)' : 'rgba(255,255,255,0.88)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <EinsteinIcon size={20} /> {aiLabel}
        </Link>
        <Link to="/biblioteca-utilizatorilor" onClick={onClose} style={{ ...linkStyle, color: location.pathname === '/biblioteca-utilizatorilor' ? 'var(--gold)' : 'rgba(255,255,255,0.88)' }}>
          🏛️ Biblioteca utilizatorilor
        </Link>
        <Link to="/discutii" onClick={onClose} style={{
          ...linkStyle,
          color: location.pathname === '/discutii'
            ? 'var(--gold)'
            : (forumHasNew ? 'var(--gold-light)' : 'rgba(255,255,255,0.88)'),
          background: (forumHasNew && location.pathname !== '/discutii') ? 'rgba(232,185,49,0.10)' : undefined,
        }}>
          💬 Forum
          {forumHasNew && (
            <span className="forum-dot" title="Activitate nouă pe forum" aria-label="Activitate nouă pe forum" />
          )}
          {forumUnread > 0 && (
            <span style={{ color: '#ff6b6b', fontWeight: 700, marginLeft: 4 }}>({forumUnread})</span>
          )}
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
  const { user, isPremium, isAdmin, isTeacher, isParent, signOut } = useAuth();
  const aiLabel = aiAssistantLabel({ isTeacher, isParent });
  const maiMulte = MAIMULTE.map((it) => it.to === '/profesor-virtual'
    ? { ...it, label: <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><EinsteinIcon size={16} /> {aiLabel}</span> }
    : it);
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [forumUnread, setForumUnread] = useState(0);   // răspunsuri la postările MELE (badge roșu)
  const [forumHasNew, setForumHasNew] = useState(false); // s-a postat ceva nou pe forum (indiciu auriu)

  // Calculează indicatorii de la „Forum": (1) activitate nouă în general și
  // (2) răspunsuri la postările/comentariile utilizatorului. Reîmprospătat periodic.
  useEffect(() => {
    let cancelled = false;

    async function computeForumState() {
      // Cheia „văzut" — per utilizator dacă e logat, altfel comună pentru vizitatori.
      const seenKey = user ? `forum_seen_${user.id}` : 'forum_seen_guest';

      // Pe pagina de forum marcăm totul drept văzut și ascundem indicatorii.
      if (location.pathname === '/discutii') {
        try { localStorage.setItem(seenKey, new Date().toISOString()); } catch { /* ignore */ }
        if (!cancelled) { setForumUnread(0); setForumHasNew(false); }
        return;
      }

      let lastSeen = null;
      try { lastSeen = localStorage.getItem(seenKey); } catch { /* ignore */ }

      // Fără reper „văzut" (primă utilizare, alt browser sau după re-logare):
      // moștenim reperul de vizitator sau pornim de la momentul curent și îl
      // salvăm. Altfel s-ar număra tot istoricul forumului și indicatorii
      // s-ar aprinde la fiecare reconectare, fără activitate cu adevărat nouă.
      if (!lastSeen) {
        let inherited = null;
        if (user) { try { inherited = localStorage.getItem('forum_seen_guest'); } catch { /* ignore */ } }
        lastSeen = inherited || new Date().toISOString();
        try { localStorage.setItem(seenKey, lastSeen); } catch { /* ignore */ }
      }

      // ── (1) Indiciu general: cineva a postat / a discutat ceva nou ──
      let actQ = supabase
        .from('discussions')
        .select('id', { count: 'exact', head: true });
      if (user) actQ = actQ.neq('user_id', user.id); // ignoră propriile postări
      if (lastSeen) actQ = actQ.gt('created_at', lastSeen);
      const { count: activityCount } = await actQ;
      if (!cancelled) setForumHasNew((activityCount || 0) > 0);

      // ── (2) Notificare de răspuns: răspunsuri la postările/comentariile MELE ──
      if (!user) { if (!cancelled) setForumUnread(0); return; }

      // Postările/comentariile mele (limităm numărul pentru lungimea URL-ului).
      const { data: mine, error: mineErr } = await supabase
        .from('discussions')
        .select('id')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(150);

      if (mineErr || !mine || mine.length === 0) { if (!cancelled) setForumUnread(0); return; }

      const myIds = mine.map((d) => d.id);
      let q = supabase
        .from('discussions')
        .select('id', { count: 'exact', head: true })
        .in('parent_id', myIds)
        .neq('user_id', user.id);
      if (lastSeen) q = q.gt('created_at', lastSeen);

      const { count } = await q;
      if (!cancelled) setForumUnread(count || 0);
    }

    computeForumState();
    const iv = setInterval(computeForumState, 60000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [user, location.pathname]);

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
            <span className="logo-accent">Examen</span>Mate
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
            <li><DesktopDropdown label="Examene" items={EXAMENE} /></li>
            <li><DesktopDropdown label="Clase" items={CLASE} /></li>
            <li>
              <Link to="/preturi" className={location.pathname === '/preturi' ? 'active' : ''}>
                💳 Abonament
              </Link>
            </li>
            <li>
              <Link
                to="/discutii"
                className={`${location.pathname === '/discutii' ? 'active' : ''}${forumHasNew ? ' forum-has-new' : ''}`.trim()}
              >
                💬 Forum
                {forumHasNew && (
                  <span className="forum-dot" title="Activitate nouă pe forum" aria-label="Activitate nouă pe forum" />
                )}
                {forumUnread > 0 && (
                  <span style={{ color: '#ff6b6b', fontWeight: 700, marginLeft: 4 }}>({forumUnread})</span>
                )}
              </Link>
            </li>
            <li><DesktopDropdown label="Mai multe" items={maiMulte} /></li>
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
                <AINotifications />
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
        aiLabel={aiLabel}
        forumUnread={forumUnread}
        forumHasNew={forumHasNew}
        onSignOut={handleSignOut}
      />
    </>
  );
}
