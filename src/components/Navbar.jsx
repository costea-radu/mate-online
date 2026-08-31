import { useState, useRef, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ArenaIndicator from './ArenaIndicator';
import { supabase } from '../lib/supabase';
import AINotifications from './AINotifications';
import EinsteinIcon from './EinsteinIcon';
import { aiAssistantLabel } from '../lib/aiLabel';
import { useChatUnread, refreshChatUnread } from '../lib/chatUnread';
import ChatAlerts from './ChatAlerts';
import Sidebar from './Sidebar';
import { CLASE, EXAMENE, sectiuniMeniu, esteActiv } from '../lib/meniu';

// ─── Bulina roșie de mesaje noi (ca la Messenger) ─────────────────────────────
// `flotanta` = lipită în colțul unei iconițe; altfel stă în rând, după text.
function Bulina({ n, flotanta = false, titlu = 'mesaje noi' }) {
  if (!n) return null;
  return (
    <span
      title={`${n} ${titlu}`}
      aria-label={`${n} ${titlu}`}
      style={{
        background: '#e74c3c', color: '#fff', borderRadius: 10, fontSize: '.65rem',
        fontWeight: 700, padding: '1px 5px', minWidth: 16, textAlign: 'center',
        lineHeight: 1.5, display: 'inline-block',
        ...(flotanta
          ? { position: 'absolute', top: -3, right: -3, boxShadow: '0 0 0 2px var(--navy)' }
          : { marginLeft: 6 }),
      }}
    >
      {n > 99 ? '99+' : n}
    </span>
  );
}

// ─── Desktop dropdown ─────────────────────────────────────────────────────────
// `accent` = intrare principală (Examene, Clase): scoasă în evidență, fiindcă
// de acolo intră elevii în materialele propriu-zise.
function DesktopDropdown({ label, items, badge = 0, accent = false, badgeTitlu = 'mesaje noi', punct = false }) {
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
          background: accent ? 'rgba(232,185,49,0.14)' : 'none',
          border: accent ? '1px solid rgba(232,185,49,0.45)' : 'none',
          borderRadius: accent ? 999 : 0,
          cursor: 'pointer',
          color: accent ? 'var(--gold)' : (open ? 'var(--gold)' : 'rgba(255,255,255,0.85)'),
          fontFamily: 'var(--font-body)', fontSize: '0.92rem',
          fontWeight: accent ? 700 : 500, display: 'flex', alignItems: 'center', gap: 4,
          padding: accent ? '5px 14px' : '4px 0', transition: 'color 0.2s, background 0.2s', whiteSpace: 'nowrap',
        }}
      >
        {label}
        {/* activitate nouă pe forum — punctul auriu, ca la linkul de dinainte */}
        {punct && <span className="forum-dot" title="Activitate nouă pe forum" aria-label="Activitate nouă pe forum" />}
        <Bulina n={badge} titlu={badgeTitlu} />
        <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0,
          background: 'var(--navy-light)', borderRadius: 10, minWidth: 220,
          boxShadow: '0 8px 32px rgba(0,0,0,0.25)', zIndex: 1000,
          border: '1px solid rgba(255,255,255,0.08)', overflowX: 'hidden',
          // lista lungă („Mai multe") se derulează în loc să iasă din ecran
          maxHeight: 'min(70vh, 440px)', overflowY: 'auto', overscrollBehavior: 'contain',
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
              <Bulina n={item.badge || 0} />
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
// Aceleași categorii, în aceeași ordine, ca în bara laterală de pe desktop:
// structura vine din src/lib/meniu.js, iar stilurile refolosesc clasele
// `.sb-*` (doar mărite puțin, prin `.mm-nav`, ca să se apese ușor cu degetul).
function MobileMenu({ open, onClose, user, isPremium, isAdmin, aiLabel = 'Profesor Virtual', forumUnread = 0, forumHasNew = false, chatUnread = 0, onSignOut }) {
  const { pathname } = useLocation();
  const [deschise, setDeschise] = useState({});

  if (!open) return null;

  const sectiuni = sectiuniMeniu({ user, isAdmin, isPremium, aiLabel, chatUnread, forumUnread, forumHasNew });

  function icon(nume) {
    return (
      <span className="sb-icon" aria-hidden="true">
        {nume === 'einstein' ? <EinsteinIcon size={19} /> : nume}
      </span>
    );
  }

  function randItem(it, i) {
    if (it.tip === 'iesire') {
      return (
        <button key={`iesire-${i}`} type="button" onClick={onSignOut} className="sb-item sb-iesire">
          {icon(it.icon)}<span className="sb-text">{it.label}</span>
        </button>
      );
    }

    if (it.tip === 'pliabil') {
      const desfasurat = !!deschise[it.cheie];
      const activ = (it.prefixe || []).some((p) => pathname.startsWith(p));
      return (
        <div key={it.cheie}>
          <button
            type="button"
            className={`sb-item sb-sectiune${activ ? ' activ' : ''}`}
            onClick={() => setDeschise((d) => ({ ...d, [it.cheie]: !d[it.cheie] }))}
            aria-expanded={desfasurat}
          >
            {icon(it.icon)}
            <span className="sb-text">{it.label}</span>
            <span className="sb-text sb-sageata">{desfasurat ? '▲' : '▼'}</span>
          </button>
          {desfasurat && it.copii.map((c) => (
            <Link key={c.to} to={c.to} onClick={onClose}
              className={`sb-sub${esteActiv(pathname, c.to) ? ' activ' : ''}`}>
              {c.label}
            </Link>
          ))}
        </div>
      );
    }

    return (
      <Link key={it.to} to={it.to} onClick={onClose}
        className={`sb-item${esteActiv(pathname, it.to) ? ' activ' : ''}${it.accent ? ' sb-accent' : ''}`}>
        {icon(it.icon)}
        <span className="sb-text">{it.label}</span>
        {it.punct && <span className="forum-dot" title="Activitate nouă pe forum" aria-label="Activitate nouă pe forum" />}
        {it.badge > 0 && (
          <span className="sb-badge" title={`${it.badge} ${it.badgeTitlu || 'mesaje noi'}`}>
            {it.badge > 99 ? '99+' : it.badge}
          </span>
        )}
      </Link>
    );
  }

  return (
    <>
      {/* Overlay backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 998 }}
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

        <nav className="mm-nav" style={{ paddingBottom: 28 }}>
          {sectiuni.map((s, si) => (
            <div key={s.titlu || `sect-${si}`}>
              {s.titlu && <div className="sb-grup"><span className="sb-text">{s.titlu}</span></div>}
              {s.items.map(randItem)}
            </div>
          ))}
        </nav>
      </div>
    </>
  );
}

// ─── Navbar principal ─────────────────────────────────────────────────────────
export default function Navbar() {
  const { user, isPremium, isAdmin, isTeacher, isParent, signOut } = useAuth();
  const aiLabel = aiAssistantLabel({ isTeacher, isParent });
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [forumUnread, setForumUnread] = useState(0);   // răspunsuri la postările MELE (badge roșu)
  const [forumHasNew, setForumHasNew] = useState(false); // s-a postat ceva nou pe forum (indiciu auriu)

  // Mesaje noi din mesagerie → bulina roșie (src/lib/chatUnread.js).
  const { count: chatUnread } = useChatUnread(!!user);
  // La schimbarea paginii cerem numărul din nou, dar FĂRĂ să sărim peste pragul
  // din magazin — navigarea rapidă prin site nu bate serverul.
  useEffect(() => { if (user) refreshChatUnread(false); }, [user, location.pathname]);


  // Calculează indicatorii de la „Forum": (1) activitate nouă în general și
  // (2) răspunsuri la postările/comentariile utilizatorului. Reîmprospătat periodic.
  // SCALARE: interogăm DOAR cu tab-ul vizibil (un tab lăsat deschis în fundal nu
  // mai bate baza de date degeaba) și la 2 minute în loc de 1; la revenirea în
  // tab reîmprospătăm imediat, deci utilizatorul nu simte nicio diferență.
  useEffect(() => {
    let cancelled = false;

    async function computeForumState() {
      // Tab ascuns → nu interogăm; recuperăm imediat la 'visibilitychange'.
      if (document.visibilityState === 'hidden') return;
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
    const iv = setInterval(computeForumState, 120000);
    const onVisible = () => { if (document.visibilityState === 'visible') computeForumState(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { cancelled = true; clearInterval(iv); document.removeEventListener('visibilitychange', onVisible); };
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
              aria-label={chatUnread > 0 ? `Meniu — ${chatUnread} mesaje noi` : 'Meniu'}
              style={{ position: 'relative' }}
            >
              ☰
              <Bulina n={chatUnread} flotanta />
            </button>
          </div>

          {/* Desktop nav links */}
          {/* Bara de sus ține doar intrările spre materiale. „Abonament" (la
              profesori și părinți) și „Meditații cu AI" (la elevi) au fost
              scoase de aici — ambele stau în meniul lateral / drawer-ul ☰,
              la categoriile lor. Ce a rămas se împarte uniform pe lățime. */}
          <ul className="navbar-links" style={{ alignItems: 'center' }}>
            <li><DesktopDropdown label="🎓 Examene" items={EXAMENE} accent /></li>
            <li><DesktopDropdown label="📚 Clase" items={CLASE} accent /></li>
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
                <ArenaIndicator />
                <Link
                  to="/mesagerie"
                  aria-label={chatUnread > 0 ? `Mesagerie — ${chatUnread} mesaje noi` : 'Mesagerie'}
                  title={chatUnread > 0 ? `${chatUnread} mesaje noi` : 'Mesagerie'}
                  style={{
                    position: 'relative', display: 'inline-flex', alignItems: 'center',
                    fontSize: '1.3rem', lineHeight: 1, textDecoration: 'none',
                    opacity: location.pathname === '/mesagerie' ? 1 : 0.85,
                  }}
                >
                  💬
                  <Bulina n={chatUnread} flotanta />
                </Link>
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

      {/* Meniu lateral (desktop) — ascuns sub 768px prin CSS */}
      <Sidebar
        user={user}
        isPremium={isPremium}
        isAdmin={isAdmin}
        aiLabel={aiLabel}
        chatUnread={chatUnread}
        forumUnread={forumUnread}
        forumHasNew={forumHasNew}
        onSignOut={handleSignOut}
      />

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
        chatUnread={chatUnread}
        onSignOut={handleSignOut}
      />

      {/* Sunet + vibrație + bulă pe ecran la mesaj nou */}
      <ChatAlerts />
    </>
  );
}
