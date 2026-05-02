import { useState, useEffect } from 'react';
import Discussions from './Discussions';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// ─── Helpers ─────────────────────────────────────────────────────────────────
function getOriginalFilename(url) {
  if (!url) return null;
  try {
    const decoded = decodeURIComponent(url);
    const parts = decoded.split('/');
    const filename = parts[parts.length - 1];
    // Remove timestamp prefix (e.g. "1776193195857_")
    return filename.replace(/^\d+_/, '');
  } catch {
    return null;
  }
}

// ─── Badge progres ────────────────────────────────────────────────────────────
function ProgressBadge({ progress }) {
  if (!progress) return null;
  const pct = Math.round((progress.score / progress.max_score) * 100);
  const color = pct >= 80 ? '#2e7d32' : pct >= 50 ? '#e65100' : '#c62828';
  const bg = pct >= 80 ? '#e8f5e9' : pct >= 50 ? '#fff3e0' : '#fce4ec';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <span style={{
        padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700,
        background: bg, color,
      }}>
        ✓ {pct}%
      </span>
      <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {progress.score}/{progress.max_score} pct
      </span>
    </div>
  );
}

// ─── Card item ────────────────────────────────────────────────────────────────
export function ContentCard({ item, isPremium, user, progress, _overrideSrcDoc }) {
  const canAccess = item.is_free || isPremium;
  const navigate = useNavigate();

  const typeConfig = {
    pdf:         { icon: '📄', bg: '#e3f2fd', actionLabel: 'Deschide / Descarcă' },
    interactive: { icon: _overrideSrcDoc ? '📖' : '🧩', bg: _overrideSrcDoc ? '#e8f5e9' : '#f3e5f5', actionLabel: 'Deschide' },
    manual:      { icon: '📖', bg: '#e8f5e9', actionLabel: 'Citește' },
  };
  const cfg = typeConfig[item.content_type] || typeConfig.pdf;

  const isPdf = item.content_type === 'pdf';
  const isInteractive = item.content_type === 'interactive';

  function handlePdfOpen() {
    navigate('/pdf-viewer', { state: { item } });
  }

  function handleInteractive(e) {
    e.preventDefault();
    navigate('/exercitiu', { state: { item, srcDoc: _overrideSrcDoc } });
  }

  return (
    <div
      style={{
        display: 'flex', flexDirection: 'column',
        padding: '14px 16px', background: '#fff', borderRadius: 10,
        border: '1.5px solid #eef0f4', marginBottom: 8,
        transition: 'box-shadow 0.2s', gap: 10,
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(15,43,68,0.09)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      {/* Rând 1: icon + titlu */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: cfg.bg, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '1.1rem',
          opacity: canAccess ? 1 : 0.5,
        }}>
          {cfg.icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontWeight: 600, color: canAccess ? 'var(--navy)' : 'var(--text-muted)',
            fontSize: '0.92rem',
          }}>
            {item.title}
          </div>
          {item.description && (
            <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {item.description}
            </div>
          )}
          {isPdf && getOriginalFilename(item.file_url) && (
            <div className="filename-original">
              {getOriginalFilename(item.file_url)}
            </div>
          )}
        </div>
      </div>

      {/* Rând 2: progres + badge + buton */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {isInteractive && user && canAccess && (
          <ProgressBadge progress={progress} />
        )}

        <span style={{
          padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700,
          background: item.is_free ? '#e8f5e9' : '#fff3e0',
          color: item.is_free ? '#2e7d32' : '#e65100',
        }}>
          {item.is_free ? 'Gratuit' : 'Premium'}
        </span>

        <div style={{ marginLeft: 'auto' }}>
          {canAccess ? (
            isPdf ? (
              // PDF normal → PDFViewer cu blob URL
              <button
                onClick={handlePdfOpen}
                disabled={!item.file_url}
                style={{
                  padding: '7px 18px', borderRadius: 7, fontWeight: 600, fontSize: '0.85rem',
                  background: item.file_url ? 'var(--navy)' : '#ccc',
                  color: '#fff', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                }}
              >
                {cfg.actionLabel}
              </button>
            ) : (
              <button
                onClick={handleInteractive}
                disabled={!item.file_url && !_overrideSrcDoc}
                style={{
                  padding: '7px 18px', borderRadius: 7, fontWeight: 600, fontSize: '0.85rem',
                  background: 'var(--navy)', color: '#fff', border: 'none', cursor: 'pointer',
                  opacity: (!item.file_url && !_overrideSrcDoc) ? 0.4 : 1,
                  whiteSpace: 'nowrap',
                }}
              >
                {cfg.actionLabel}
              </button>
            )
          ) : !user ? (
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {isPdf && item.file_url && (
                <button
                  onClick={() => navigate('/pdf-viewer', { state: { item, previewOnly: true } })}
                  style={{ padding:'7px 14px', borderRadius:7, fontWeight:600, fontSize:'0.82rem', background:'#f0f4f8', color:'var(--navy)', border:'1.5px solid #dde1e8', cursor:'pointer', whiteSpace:'nowrap' }}
                >
                  👁 Preview
                </button>
              )}
              <Link to="/autentificare" style={{ padding:'7px 14px', borderRadius:7, fontWeight:600, fontSize:'0.83rem', background:'#f0f4f8', color:'var(--navy)', border:'1.5px solid #dde1e8', textDecoration:'none', whiteSpace:'nowrap', display:'inline-block' }}>
                🔒 Autentifică-te
              </Link>
            </div>
          ) : (
            <div style={{ display:'flex', gap:6, flexWrap:'wrap' }}>
              {isPdf && item.file_url && (
                <button
                  onClick={() => navigate('/pdf-viewer', { state: { item, previewOnly: true } })}
                  style={{ padding:'7px 14px', borderRadius:7, fontWeight:600, fontSize:'0.82rem', background:'#f0f4f8', color:'var(--navy)', border:'1.5px solid #dde1e8', cursor:'pointer', whiteSpace:'nowrap' }}
                >
                  👁 Preview
                </button>
              )}
              <Link to="/preturi" style={{ padding:'7px 14px', borderRadius:7, fontWeight:600, fontSize:'0.83rem', background:'var(--gold)', color:'var(--navy-dark)', textDecoration:'none', whiteSpace:'nowrap', display:'inline-block' }}>
                🔒 Necesită Premium
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── Manual inline viewer ─────────────────────────────────────────────────────
function ManualViewer({ item }) {
  const [open, setOpen] = useState(false);
  const { isPremium, user } = useAuth();
  const canAccess = item.is_free || isPremium;

  // Dacă manual_content e un HTML complet, îl deschidem în viewer (ca interactive)
  const isFullHtml = item.manual_content && (
    item.manual_content.trim().startsWith('<!DOCTYPE') ||
    item.manual_content.trim().startsWith('<html')
  );

  if (isFullHtml && canAccess) {
    return (
      <ContentCard
        item={{ ...item, content_type: 'interactive' }}
        isPremium={isPremium}
        user={user}
        progress={null}
        _overrideSrcDoc={item.manual_content}
      />
    );
  }

  return (
    <div style={{ marginBottom: 8 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', background: '#fff',
          borderRadius: open ? '10px 10px 0 0' : 10,
          border: '1.5px solid #eef0f4',
          borderBottom: open ? 'none' : '1.5px solid #eef0f4',
          cursor: canAccess ? 'pointer' : 'default',
          transition: 'box-shadow 0.2s',
        }}
        onClick={() => canAccess && setOpen(o => !o)}
        onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(15,43,68,0.09)'}
        onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 38, height: 38, borderRadius: 8, background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem', opacity: canAccess ? 1 : 0.5 }}>📖</div>
          <div>
            <div style={{ fontWeight: 600, color: canAccess ? 'var(--navy)' : 'var(--text-muted)', fontSize: '0.93rem' }}>{item.title}</div>
            {item.description && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 1 }}>{item.description}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, background: item.is_free ? '#e8f5e9' : '#fff3e0', color: item.is_free ? '#2e7d32' : '#e65100' }}>
            {item.is_free ? 'Gratuit' : 'Premium'}
          </span>
          {canAccess
            ? <span style={{ fontSize: '0.9rem', color: 'var(--navy)', fontWeight: 700 }}>{open ? '▲' : '▼'}</span>
            : !user
              ? <Link to="/autentificare" onClick={e => e.stopPropagation()} style={{ padding: '6px 14px', borderRadius: 7, fontWeight: 600, fontSize: '0.82rem', background: '#f0f4f8', color: 'var(--navy)', border: '1.5px solid #dde1e8', textDecoration: 'none' }}>🔒 Autentifică-te</Link>
              : <Link to="/preturi" onClick={e => e.stopPropagation()} style={{ padding: '6px 14px', borderRadius: 7, fontWeight: 600, fontSize: '0.82rem', background: 'var(--gold)', color: 'var(--navy-dark)', textDecoration: 'none' }}>🔒 Necesită Premium</Link>
          }
        </div>
      </div>
      {open && canAccess && (
        <div style={{ padding: '24px 28px', background: '#fff', border: '1.5px solid #eef0f4', borderTop: '1px solid #f0f4f8', borderRadius: '0 0 10px 10px', lineHeight: 1.8, color: 'var(--text)' }}
          dangerouslySetInnerHTML={{ __html: item.manual_content || '<p>Conținut indisponibil.</p>' }}
        />
      )}
    </div>
  );
}

// ─── Componentă principală ────────────────────────────────────────────────────
export default function ContentPage({ category, title, subtitle, breadcrumb, tabs, emptyIcons }) {
  const { user, isPremium, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [items, setItems] = useState([]);
  const [progressMap, setProgressMap] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from('content')
        .select('*')
        .eq('category', category)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (!error) setItems(data || []);
      setLoading(false);
    }
    load();
  }, [category]);

  // Încarcă progresul pentru exercițiile interactive
  useEffect(() => {
    if (!user || items.length === 0) return;
    const interactiveIds = items
      .filter(i => i.content_type === 'interactive')
      .map(i => i.id);
    if (interactiveIds.length === 0) return;

    supabase
      .from('progress')
      .select('*')
      .eq('user_id', user.id)
      .in('content_id', interactiveIds)
      .then(({ data }) => {
        if (data) {
          const map = {};
          data.forEach(p => { map[p.content_id] = p; });
          setProgressMap(map);
        }
      });
  }, [user, items]);

  const filtered = items.filter(item => item.content_type === activeTab);

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>{breadcrumb}</span>
          </div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
      </div>

      <div className="content-list">
        <div className="container">
          <div className="tabs">
            {tabs.map(tab => (
              <button
                key={tab.id}
                className={`tab ${activeTab === tab.id ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                {items.filter(i => i.content_type === tab.id).length > 0 && (
                  <span style={{ marginLeft: 6, background: 'var(--gold)', color: 'var(--navy-dark)', borderRadius: 20, padding: '1px 7px', fontSize: '0.72rem', fontWeight: 700 }}>
                    {items.filter(i => i.content_type === tab.id).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {loading || authLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0' }}>
              <div className="spinner" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div className="empty-state-icon">{emptyIcons?.[activeTab] || '📄'}</div>
              <h3>{tabs.find(t => t.id === activeTab)?.label} – {title}</h3>
              <p>Materialele vor fi adăugate în curând. Revino mai târziu!</p>
            </div>
          ) : (
            <div style={{ marginTop: 8 }}>
              {filtered.map(item =>
                item.content_type === 'manual' && item.manual_content
                  ? <ManualViewer key={item.id} item={item} />
                  : <ContentCard key={item.id} item={item} isPremium={isPremium} user={user} progress={progressMap[item.id]} />
              )}
            </div>
          )}
        </div>
        {/* Secțiune discuții per categorie */}
        <Discussions fixedCategory={category} />
      </div>
    </>
  );
}
