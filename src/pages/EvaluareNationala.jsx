import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import ContentPage from '../components/ContentPage';

// Subcategoriile EN cu tab-urile lor
const SUBCATEGORIES = [
  {
    id: 'capitole',
    label: '📚 Capitole',
    description: 'Exerciții PDF și interactive organizate pe capitole',
    tabs: [
      { id: 'pdf',         label: '📄 PDF' },
      { id: 'interactive', label: '🧩 Interactive' },
    ],
  },
  {
    id: 'teste-antrenament',
    label: '🏋 Teste de Antrenament',
    description: 'Teste complete pentru pregătire',
    tabs: [
      { id: 'pdf',         label: '📄 PDF' },
      { id: 'interactive', label: '🧩 Interactive' },
    ],
  },
  {
    id: 'variante',
    label: '📋 Variante Date + Modele',
    description: 'Variante oficiale și modele de subiecte',
    tabs: [
      { id: 'pdf', label: '📄 PDF' },
    ],
  },
  {
    id: 'simulari',
    label: '🎯 Simulări',
    description: 'Simulări complete cu bareme',
    tabs: [
      { id: 'pdf',         label: '📄 PDF' },
      { id: 'interactive', label: '🧩 Interactive' },
    ],
  },
];

export default function EvaluareNationala() {
  const [activeSub, setActiveSub] = useState('capitole');
  const sub = SUBCATEGORIES.find(s => s.id === activeSub);

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link>
            <span>›</span>
            <span>Evaluare Națională</span>
          </div>
          <h1>Evaluarea Națională</h1>
          <p>Teste și exerciții pentru pregătirea examenului de clasa a VIII-a</p>
        </div>
      </div>

      <div className="content-list">
        <div className="container">
          {/* Subcategory tabs */}
          <div className="tabs" style={{ flexWrap: 'wrap' }}>
            {SUBCATEGORIES.map(s => (
              <button
                key={s.id}
                className={`tab ${activeSub === s.id ? 'active' : ''}`}
                onClick={() => setActiveSub(s.id)}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Conținut subcategorie */}
          <SubcategoryContent
            category="evaluare-nationala"
            subcategory={activeSub}
            tabs={sub.tabs}
            emptyIcons={{ pdf: '📝', interactive: '🧩' }}
          />
        </div>
      </div>
    </>
  );
}

// Componentă internă care încarcă conținut filtrat pe subcategory
function SubcategoryContent({ category, subcategory, tabs, emptyIcons }) {
  const { user, isPremium, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setActiveTab(tabs[0].id);
    async function load() {
      setLoading(true);
      const { data, error } = await supabase
        .from('content')
        .select('*')
        .eq('category', category)
        .eq('subcategory', subcategory)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (!error) setItems(data || []);
      setLoading(false);
    }
    load();
  }, [category, subcategory]);

  const filtered = items.filter(i => i.content_type === activeTab);

  return (
    <>
      <div className="tabs" style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
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
          <h3>Niciun material disponibil momentan</h3>
          <p>Materialele vor fi adăugate în curând. Revino mai târziu!</p>
        </div>
      ) : (
        <div style={{ marginTop: 8 }}>
          {filtered.map(item => (
            <ContentCardSimple key={item.id} item={item} isPremium={isPremium} user={user} />
          ))}
        </div>
      )}
    </>
  );
}

// Import local al cardului (copiat din ContentPage pentru a evita dependențe circulare)
import { useNavigate } from 'react-router-dom';

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

async function resolveFileUrl(item) {
  if (!item.file_url) return null;
  if (item.is_free) return item.file_url;
  const parsed = extractStoragePath(item.file_url);
  if (!parsed) return item.file_url;
  const { data, error } = await supabase.storage.from(parsed.bucket).createSignedUrl(parsed.path, 86400);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}

function ContentCardSimple({ item, isPremium, user }) {
  const canAccess = item.is_free || isPremium;
  const [loadingUrl, setLoadingUrl] = useState(false);
  const navigate = useNavigate();

  const typeConfig = {
    pdf:         { icon: '📄', bg: '#e3f2fd', actionLabel: 'Descarcă' },
    interactive: { icon: '🧩', bg: '#f3e5f5', actionLabel: 'Începe' },
  };
  const cfg = typeConfig[item.content_type] || typeConfig.pdf;

  async function handleOpen() {
    if (!canAccess || !item.file_url) return;
    if (item.content_type === 'interactive') { navigate('/exercitiu', { state: { item } }); return; }
    setLoadingUrl(true);
    try {
      const url = await resolveFileUrl(item);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else alert('Nu s-a putut genera linkul.');
    } finally { setLoadingUrl(false); }
  }

  return (
    <div
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', background: '#fff', borderRadius: 10, border: '1.5px solid #eef0f4', marginBottom: 10, opacity: canAccess ? 1 : 0.75, transition: 'box-shadow 0.2s' }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(15,43,68,0.09)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, minWidth: 0 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0, background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem' }}>{cfg.icon}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '0.95rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
          {item.description && <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>{item.description}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, marginLeft: 16 }}>
        <span style={{ padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 700, background: item.is_free ? '#e8f5e9' : '#fff3e0', color: item.is_free ? '#2e7d32' : '#e65100' }}>
          {item.is_free ? 'Gratuit' : 'Premium'}
        </span>
        {canAccess ? (
          <button onClick={handleOpen} disabled={loadingUrl} style={{ padding: '7px 18px', borderRadius: 7, fontWeight: 600, fontSize: '0.85rem', background: 'var(--navy)', color: '#fff', border: 'none', cursor: 'pointer', minWidth: 90 }}>
            {loadingUrl ? '⏳' : cfg.actionLabel}
          </button>
        ) : !user ? (
          <Link to="/autentificare" style={{ padding: '7px 18px', borderRadius: 7, fontWeight: 600, fontSize: '0.85rem', background: '#f0f4f8', color: 'var(--navy)', border: '1.5px solid #dde1e8', textDecoration: 'none' }}>🔒 Autentifică-te</Link>
        ) : (
          <Link to="/preturi" style={{ padding: '7px 18px', borderRadius: 7, fontWeight: 600, fontSize: '0.85rem', background: 'var(--gold)', color: 'var(--navy-dark)', textDecoration: 'none' }}>⭐ Premium</Link>
        )}
      </div>
    </div>
  );
}
