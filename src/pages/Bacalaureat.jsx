import { useState, useEffect, useRef } from 'react';
import Discussions from '../components/Discussions';
import { Link, useParams, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ContentCard } from '../components/ContentPage';

const PROFILES = {
  'mate-info':       { label: 'Mate-Info',         icon: '📐' },
  'stiinte-naturii': { label: 'Științele Naturii', icon: '🔬' },
  'tehnologic':      { label: 'Tehnologic',         icon: '⚙️' },
};

// ─── Bloc de iteme ────────────────────────────────────────────────────────────
function ItemBlock({ category, subcategory, profile, contentType, emptyText }) {
  const { user, isPremium } = useAuth();
  const [items, setItems] = useState([]);
  const [progressMap, setProgressMap] = useState({});
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

  useEffect(() => {
    if (!user || items.length === 0 || contentType !== 'interactive') return;
    const ids = items.map(i => i.id);
    supabase.from('progress').select('*').eq('user_id', user.id).in('content_id', ids)
      .then(({ data }) => {
        if (data) {
          const map = {};
          data.forEach(p => { map[p.content_id] = p; });
          setProgressMap(map);
        }
      });
  }, [user, items, contentType]);

  if (loading) return (
    <div style={{ padding: '10px 0', color: 'var(--text-muted)', fontSize: '0.83rem' }}>
      Se încarcă...
    </div>
  );
  if (items.length === 0) return (
    <div style={{ padding: '10px 14px', background: '#f7f9fc', borderRadius: 8, color: 'var(--text-muted)', fontSize: '0.82rem', marginBottom: 6 }}>
      {emptyText || 'Niciun material disponibil momentan.'}
    </div>
  );
  return (
    <div>
      {items.map(item => (
        <ContentCard key={item.id} item={item} isPremium={isPremium} user={user} progress={progressMap[item.id]} />
      ))}
    </div>
  );
}

// ─── Secțiune colapsabilă ─────────────────────────────────────────────────────
function Section({ title, icon, defaultOpen = false, children, level = 1 }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { if (defaultOpen) setOpen(true); }, [defaultOpen]);
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
function ProfilePDFContent({ profile, forceOpen = false }) {
  return (
    <>
      <Section title="Exerciții pe Subiecte" icon="📝" level={2} defaultOpen={forceOpen}>
        <SubTitle>📄 PDF</SubTitle>
        <ItemBlock category="bacalaureat" subcategory="exercitii" profile={profile} contentType="pdf" />
        <SubTitle>🧩 Interactive</SubTitle>
        <ItemBlock category="bacalaureat" subcategory="exercitii" profile={profile} contentType="interactive" />
      </Section>
      <Section title="Variante Date + Olimpici + Rezerve" icon="📋" level={2} defaultOpen={forceOpen}>
        <ItemBlock category="bacalaureat" subcategory="variante" profile={profile} contentType="pdf" />
      </Section>
      <Section title="Teste de Antrenament" icon="🏋" level={2} defaultOpen={forceOpen}>
        <ItemBlock category="bacalaureat" subcategory="teste-antrenament" profile={profile} contentType="pdf" />
      </Section>
      <Section title="Simulări + Modele" icon="🎯" level={2} defaultOpen={forceOpen}>
        <ItemBlock category="bacalaureat" subcategory="simulari" profile={profile} contentType="pdf" />
      </Section>
      <Section title="Bareme" icon="✅" level={2} defaultOpen={forceOpen}>
        <ItemBlock category="bacalaureat" subcategory="bareme" profile={profile} contentType="pdf" />
      </Section>
    </>
  );
}

// ─── Pagina Bacalaureat ───────────────────────────────────────────────────────
export default function Bacalaureat() {
  const { profile: profileParam } = useParams();
  const profile = profileParam && PROFILES[profileParam] ? profileParam : 'mate-info';
  const location = useLocation();
  const returnTab = location.state?.returnTab;
  const scrollCardId = location.state?.scrollToCardId;
  const [mainTab, setMainTab] = useState(returnTab || 'interactive');
  const scrollRestored = useRef(false);
  const forceOpen = !!scrollCardId && returnTab === 'pdf';

  useEffect(() => {
    if (!scrollCardId || scrollRestored.current) return;
    scrollRestored.current = true;

    let attempts = 0;
    function tryScroll() {
      const el = document.getElementById(`card-${scrollCardId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
      } else if (attempts < 50) {
        attempts++;
        setTimeout(tryScroll, 100);
      }
    }
    setTimeout(tryScroll, 150);
  }, [scrollCardId]);

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
          <div className="tabs">
            <button className={`tab ${mainTab === 'interactive' ? 'active' : ''}`} onClick={() => setMainTab('interactive')}>
              🧩 Teste Interactive
            </button>
            <button className={`tab ${mainTab === 'pdf' ? 'active' : ''}`} onClick={() => setMainTab('pdf')}>
              📄 PDF
            </button>
          </div>

          {mainTab === 'pdf' && (
            <div style={{ marginTop: 16 }}>
              {/* Capitole comune */}
              <Section title="Capitole cu Exerciții" icon="📚" defaultOpen={forceOpen}>
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

              <ProfilePDFContent profile={profile} forceOpen={forceOpen} />
            </div>
          )}

          {mainTab === 'interactive' && (
            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
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
        <Discussions fixedCategory="bacalaureat" />
      </div>
    </>
  );
}
