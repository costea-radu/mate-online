import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

// ─── Extrage calea din Storage dintr-un URL public ────────────────────────────
function extractStoragePath(url) {
  try {
    const marker = '/object/public/';
    const idx = url.indexOf(marker);
    if (idx === -1) return null;
    const after = url.slice(idx + marker.length);
    const slashIdx = after.indexOf('/');
    if (slashIdx === -1) return null;
    return { bucket: after.slice(0, slashIdx), path: after.slice(slashIdx + 1) };
  } catch { return null; }
}

// ─── Generează signed URL pentru PDF-uri premium ──────────────────────────────
async function resolveFileUrl(item) {
  if (!item.file_url) return null;
  if (item.is_free) return item.file_url;

  const parsed = extractStoragePath(item.file_url);
  if (!parsed) return item.file_url;

  const { data, error } = await supabase.storage
    .from(parsed.bucket)
    .createSignedUrl(parsed.path, 86400);

  if (error || !data?.signedUrl) {
    console.error('Signed URL error:', error);
    return null;
  }
  return data.signedUrl;
}

// ─── Card pentru un item de conținut ─────────────────────────────────────────
function ContentCard({ item, isPremium, user }) {
  const canAccess = item.is_free || isPremium;
  const [loadingUrl, setLoadingUrl] = useState(false);
  const navigate = useNavigate();

  const typeConfig = {
    pdf:         { icon: '📄', bg: '#e3f2fd', actionLabel: 'Deschide / Descarcă' },
    interactive: { icon: '🧩', bg: '#f3e5f5', actionLabel: 'Începe' },
    manual:      { icon: '📖', bg: '#e8f5e9', actionLabel: 'Citește' },
  };
  const cfg = typeConfig[item.content_type] || typeConfig.pdf;

  async function handleOpen() {
    if (!canAccess || !item.file_url) return;

    // Exercițiile interactive se deschid în viewer intern
    if (item.content_type === 'interactive') {
      navigate('/exercitiu', { state: { item } });
      return;
    }

    // PDF-urile se deschid în tab nou (cu signed URL dacă premium)
    setLoadingUrl(true);
    try {
      const url = await resolveFileUrl(item);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else alert('Nu s-a putut genera linkul. Încearcă din nou.');
    } finally {
      setLoadingUrl(false);
    }
  }

  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px', background: '#fff', borderRadius: 10,
        border: '1.5px solid #eef0f4', marginBottom: 10,
        opacity: canAccess ? 1 : 0.75, transition: 'box-shadow 0.2s',
      }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(15,43,68,0.09)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      {/* Stânga */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
        <div style={{
          width: 40, height: 40, borderRadius: 8, flexShrink: 0,
          background: cfg.bg, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontSize: '1.2rem',
        }}>
          {cfg.icon}
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {item.title}
          </div>
          {item.description && (
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
              {item.description}
            </div>
          )}
        </div>
      </div>

      {/* Dreapta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 16 }}>
        <span style={{
          padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700,
          background: item.is_free ? '#e8f5e9' : '#fff3e0',
          color: item.is_free ? '#2e7d32' : '#e65100',
        }}>
          {item.is_free ? 'Gratuit' : 'Premium'}
        </span>

        {canAccess ? (
          <button
            onClick={handleOpen}
            disabled={loadingUrl || (!item.file_url && item.content_type !== 'manual')}
            style={{
              padding: '7px 18px', borderRadius: 7, fontWeight: 600, fontSize: '0.85rem',
              background: 'var(--navy)', color: '#fff', border: 'none', cursor: 'pointer',
              opacity: (!item.file_url && item.content_type !== 'manual') ? 0.4 : 1,
              transition: 'background 0.2s', minWidth: 90,
            }}
            onMouseEnter={e => { if (!loadingUrl) e.currentTarget.style.background = 'var(--navy-light)'; }}
            onMouseLeave={e => e.currentTarget.style.background = 'var(--navy)'}
          >
            {loadingUrl ? '⏳' : cfg.actionLabel}
          </button>
        ) : !user ? (
          <Link to="/autentificare" style={{
            padding: '7px 18px', borderRadius: 7, fontWeight: 600, fontSize: '0.85rem',
            background: '#f0f4f8', color: 'var(--navy)', border: '1.5px solid #dde1e8',
            textDecoration: 'none',
          }}>
            🔒 Autentifică-te
          </Link>
        ) : (
          <Link to="/preturi" style={{
            padding: '7px 18px', borderRadius: 7, fontWeight: 600, fontSize: '0.85rem',
            background: 'var(--gold)', color: 'var(--navy-dark)', border: 'none',
            textDecoration: 'none',
          }}>
            ⭐ Premium
          </Link>
        )}
      </div>
    </div>
  );
}

// ─── Manual inline viewer ─────────────────────────────────────────────────────
function ManualViewer({ item }) {
  const [open, setOpen] = useState(false);
  const { isPremium, user } = useAuth();
  const canAccess = item.is_free || isPremium;

  if (!canAccess) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '16px 20px', background: '#fff', borderRadius: 10,
        border: '1.5px solid #eef0f4', marginBottom: 10, opacity: 0.75,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>📖</div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{item.title}</div>
            {item.description && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>{item.description}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, background: '#fff3e0', color: '#e65100' }}>Premium</span>
          {!user
            ? <Link to="/autentificare" style={{ padding: '7px 18px', borderRadius: 7, fontWeight: 600, fontSize: '0.85rem', background: '#f0f4f8', color: 'var(--navy)', border: '1.5px solid #dde1e8', textDecoration: 'none' }}>🔒 Autentifică-te</Link>
            : <Link to="/preturi" style={{ padding: '7px 18px', borderRadius: 7, fontWeight: 600, fontSize: '0.85rem', background: 'var(--gold)', color: 'var(--navy-dark)', textDecoration: 'none' }}>⭐ Premium</Link>
          }
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', background: '#fff',
          borderRadius: open ? '10px 10px 0 0' : 10,
          border: '1.5px solid #eef0f4',
          borderBottom: open ? 'none' : '1.5px solid #eef0f4',
          cursor: 'pointer',
        }}
        onClick={() => setOpen(o => !o)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: '#e8f5e9', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>📖</div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--navy)' }}>{item.title}</div>
            {item.description && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>{item.description}</div>}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, background: item.is_free ? '#e8f5e9' : '#fff3e0', color: item.is_free ? '#2e7d32' : '#e65100' }}>
            {item.is_free ? 'Gratuit' : 'Premium'}
          </span>
          <span style={{ fontSize: '1rem', color: 'var(--navy)', fontWeight: 700 }}>{open ? '▲' : '▼'}</span>
        </div>
      </div>
      {open && (
        <div
          style={{
            padding: '24px 28px', background: '#fff', border: '1.5px solid #eef0f4',
            borderTop: '1px solid #f0f4f8', borderRadius: '0 0 10px 10px',
            lineHeight: 1.8, color: 'var(--text)',
          }}
          dangerouslySetInnerHTML={{ __html: item.manual_content || '<p>Conținut indisponibil.</p>' }}
        />
      )}
    </div>
  );
}

// ─── Componentă principală reutilizabilă ──────────────────────────────────────
export default function ContentPage({ category, title, subtitle, breadcrumb, tabs, emptyIcons }) {
  const { user, isPremium, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [items, setItems] = useState([]);
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

  const filtered = items.filter(item => item.content_type === activeTab);

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link>
            <span>›</span>
            <span>{breadcrumb}</span>
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
                  <span style={{
                    marginLeft: 6, background: 'var(--gold)', color: 'var(--navy-dark)',
                    borderRadius: 20, padding: '1px 7px', fontSize: '0.72rem', fontWeight: 700,
                  }}>
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
                  : <ContentCard key={item.id} item={item} isPremium={isPremium} user={user} />
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
