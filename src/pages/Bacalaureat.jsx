import { useState, useEffect } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

const PROFILES = {
  'mate-info':       { label: 'Mate-Info',         icon: '📐' },
  'stiinte-naturii': { label: 'Științele Naturii', icon: '🔬' },
  'tehnologic':      { label: 'Tehnologic',         icon: '⚙️' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
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

// ─── Card item ────────────────────────────────────────────────────────────────
function ContentCard({ item }) {
  const { isPremium, user } = useAuth();
  const canAccess = item.is_free || isPremium;
  const [loadingUrl, setLoadingUrl] = useState(false);
  const navigate = useNavigate();

  const typeConfig = {
    pdf:         { icon: '📄', bg: '#e3f2fd', actionLabel: 'Deschide / Descarcă' },
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
      style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', background: '#fff', borderRadius: 10, border: '1.5px solid #eef0f4', marginBottom: 8, opacity: canAccess ? 1 : 0.75, transition: 'box-shadow 0.2s' }}
      onMouseEnter={e => e.currentTarget.style.boxShadow = '0 2px 12px rgba(15,43,68,0.09)'}
      onMouseLeave={e => e.currentTarget.style.boxShadow = 'none'}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0 }}>
        <div style={{ width: 36, height: 36, borderRadius: 7, flexShrink: 0, background: cfg.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.1rem' }}>{cfg.icon}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 600, color: 'var(--navy)', fontSize: '0.93rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.title}</div>
          {item.description && <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 1 }}>{item.description}</div>}
        </div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, marginLeft: 14 }}>
        <span style={{ padding: '2px 9px', borderRadius: 20, fontSize: '0.7rem', fontWeight: 700, background: item.is_free ? '#e8f5e9' : '#fff3e0', color: item.is_free ? '#2e7d32' : '#e65100' }}>
          {item.is_free ? 'Gratuit' : 'Premium'}
        </span>
        {canAccess ? (
          <button onClick={handleOpen} disabled={loadingUrl} style={{ padding: '6px 16px', borderRadius: 7, fontWeight: 600, fontSize: '0.83rem', background: 'var(--navy)', color: '#fff', border: 'none', cursor: 'pointer', minWidth: 80 }}>
            {loadingUrl ? '⏳' : cfg.actionLabel}
          </button>
        ) : !user ? (
          <Link to="/autentificare" style={{ padding: '6px 14px', borderRadius: 7, fontWeight: 600, fontSize: '0.83rem', background: '#f0f4f8', color: 'var(--navy)', border: '1.5px solid #dde1e8', textDecoration: 'none' }}>🔒 Autentifică-te</Link>
        ) : (
          <Link to="/preturi" style={{ padding: '6px 14px', borderRadius: 7, fontWeight: 600, fontSize: '0.83rem', background: 'var(--gold)', color: 'var(--navy-dark)', textDecoration: 'none' }}>⭐ Premium</Link>
        )}
      </div>
    </div>
  );
}

// ─── Bloc iteme ───────────────────────────────────────────────────────────────
function ItemBlock({ category, subcategory, profile, contentType, emptyText }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      let q = supabase.from('content').select('*')
        .eq('category', category)
        .eq('content_type', contentType)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false });
      if (subcategory) q = q.eq('subcategory', subcategory);
      if (profile) q = q.eq('profile', profile);
      const { data, error } = await q;
      if (!error) setItems(data || []);
      setLoading(false);
    }
    load();
  }, [category, subcategory, profile, contentType]);

  if (loading) return <div style={{ padding: '10px 0', color: 'var(--text-muted)', fontSize: '0.83rem' }}>Se încarcă...</div>;
  if (items.length === 0) return (
    <div style={{ padding: '10px 14px', background: '#f7f9fc', borderRadius: 8, color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 6 }}>
      {emptyText || 'Niciun material disponibil momentan.'}
    </div>
  );
  return <div>{items.map(item => <ContentCard key={item.id} item={item} />)}</div>;
}

// ─── Secțiune colapsabilă ─────────────────────────────────────────────────────
function Section({ title, icon, defaultOpen = false, children, level = 1 }) {
  const [open, setOpen] = useState(defaultOpen);
  const bgColor = level === 1 ? 'var(--navy)' : level === 2 ? 'var(--navy-light)' : '#2a4a65';
  const fontSize = level === 1 ? '1rem' : level === 2 ? '0.92rem' : '0.87rem';

  return (
    <div style={{ marginBottom: level === 1 ? 12 : 8 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: level === 1 ? '13px 20px' : '10px 16px',
          background: bgColor, color: '#fff', border: 'none', cursor: 'pointer',
          borderRadius: open ? '10px 10px 0 0' : 10,
          fontWeight: 700, fontSize, fontFamily: 'var(--font-body)',
        }}
      >
        <span>{icon} {title}</span>
        <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{ border: '1.5px solid #dde1e8', borderTop: 'none', borderRadius: '0 0 10px 10px', padding: '16px', background: '#fafbfc' }}>
          {children}
        </div>
      )}
    </div>
  );
}

function SubTitle({ children }) {
  return (
    <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.82rem', marginBottom: 6, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em', opacity: 0.65 }}>
      {children}
    </div>
  );
}

// ─── Conținut PDF pentru un profil ───────────────────────────────────────────
function ProfilePDFContent({ profile }) {
  return (
    <>
      <Section title="Exerciții pe Subiecte" icon="📝" level={2}>
        <SubTitle>📄 PDF</SubTitle>
        <ItemBlock category="bacalaureat" subcategory="exercitii" profile={profile} contentType="pdf" />
        <SubTitle>🧩 Interactive</SubTitle>
        <ItemBlock category="bacalaureat" subcategory="exercitii" profile={profile} contentType="interactive" />
      </Section>

      <Section title="Variante Date + Olimpici + Rezerve" icon="📋" level={2}>
        <ItemBlock category="bacalaureat" subcategory="variante" profile={profile} contentType="pdf" />
      </Section>

      <Section title="Teste de Antrenament" icon="🏋" level={2}>
        <ItemBlock category="bacalaureat" subcategory="teste-antrenament" profile={profile} contentType="pdf" />
      </Section>

      <Section title="Simulări" icon="🎯" level={2}>
        <ItemBlock category="bacalaureat" subcategory="simulari" profile={profile} contentType="pdf" />
      </Section>

      <Section title="Bareme" icon="✅" level={2}>
        <ItemBlock category="bacalaureat" subcategory="bareme" profile={profile} contentType="pdf" />
      </Section>
    </>
  );
}

// ─── Pagina Bacalaureat ───────────────────────────────────────────────────────
export default function Bacalaureat() {
  const { profile: profileParam } = useParams();
  const profile = profileParam && PROFILES[profileParam] ? profileParam : 'mate-info';
  const [mainTab, setMainTab] = useState('pdf');

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Bacalaureat</span>
          </div>
          <h1>Bacalaureat</h1>
          <p>Teste și exerciții pentru pregătirea examenului de bacalaureat la matematică</p>
        </div>
      </div>

      <div className="content-list">
        <div className="container">
          {/* Tab principal: PDF | Teste Interactive */}
          <div className="tabs">
            <button className={`tab ${mainTab === 'pdf' ? 'active' : ''}`} onClick={() => setMainTab('pdf')}>
              📄 PDF
            </button>
            <button className={`tab ${mainTab === 'interactive' ? 'active' : ''}`} onClick={() => setMainTab('interactive')}>
              🧩 Teste Interactive
            </button>
          </div>

          {mainTab === 'pdf' && (
            <div style={{ marginTop: 16 }}>
              {/* Capitole — comune tuturor profilurilor */}
              <Section title="Capitole cu Exerciții" icon="📚">
                <SubTitle>📄 PDF</SubTitle>
                <ItemBlock category="bacalaureat" subcategory="capitole" contentType="pdf" />
                <SubTitle>🧩 Interactive</SubTitle>
                <ItemBlock category="bacalaureat" subcategory="capitole" contentType="interactive" />
              </Section>

              {/* Selector profil */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, marginTop: 8, flexWrap: 'wrap' }}>
                {Object.entries(PROFILES).map(([key, val]) => (
                  <Link
                    key={key}
                    to={`/bacalaureat/${key}`}
                    style={{
                      padding: '8px 20px', borderRadius: 8, fontWeight: 600, fontSize: '0.88rem',
                      background: profile === key ? 'var(--navy)' : '#fff',
                      color: profile === key ? '#fff' : 'var(--navy)',
                      border: `2px solid ${profile === key ? 'var(--navy)' : '#dde1e8'}`,
                      textDecoration: 'none', transition: 'all 0.2s',
                    }}
                  >
                    {val.icon} {val.label}
                  </Link>
                ))}
              </div>

              <ProfilePDFContent profile={profile} />
            </div>
          )}

          {mainTab === 'interactive' && (
            <div style={{ marginTop: 16 }}>
              {/* Selector profil pentru interactive */}
              <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
                {Object.entries(PROFILES).map(([key, val]) => (
                  <Link
                    key={key}
                    to={`/bacalaureat/${key}`}
                    style={{
                      padding: '8px 20px', borderRadius: 8, fontWeight: 600, fontSize: '0.88rem',
                      background: profile === key ? 'var(--navy)' : '#fff',
                      color: profile === key ? '#fff' : 'var(--navy)',
                      border: `2px solid ${profile === key ? 'var(--navy)' : '#dde1e8'}`,
                      textDecoration: 'none', transition: 'all 0.2s',
                    }}
                  >
                    {val.icon} {val.label}
                  </Link>
                ))}
              </div>

              <ItemBlock
                category="bacalaureat"
                subcategory="teste-interactive"
                profile={profile}
                contentType="interactive"
                emptyText="Testele interactive vor fi adăugate în curând."
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
