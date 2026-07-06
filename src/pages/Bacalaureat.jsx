import { useState, useEffect, useRef } from 'react';
import Discussions from '../components/Discussions';
import { Link, useParams, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ContentCard, scrollToCard } from '../components/ContentPage';
import { ItemBlock, Section, TypeTabs } from '../components/ExamContent';

const PROFILES = {
  'mate-info':       { label: 'Mate-Info',         icon: '📐' },
  'stiinte-naturii': { label: 'Științele Naturii', icon: '🔬' },
  'tehnologic':      { label: 'Tehnologic',         icon: '⚙️' },
};


// ─── Conținut PDF pentru un profil ───────────────────────────────────────────
function ProfilePDFContent({ profile, targetSub }) {
  const openOnly = (sub) => !!targetSub && sub === targetSub;
  return (
    <>
      <Section title="Exerciții pe Subiecte" icon="📝" level={2} defaultOpen={openOnly('exercitii')}>
        <TypeTabs category="bacalaureat" subcategory="exercitii" profile={profile} returnTab="pdf" />
      </Section>
      <Section title="Variante Date + Olimpici + Rezerve" icon="📋" level={2} defaultOpen={openOnly('variante')}>
        <ItemBlock category="bacalaureat" subcategory="variante" profile={profile} contentType="pdf" returnTab="pdf" />
      </Section>
      <Section title="Teste de Antrenament" icon="🏋" level={2} defaultOpen={openOnly('teste-antrenament')}>
        <ItemBlock category="bacalaureat" subcategory="teste-antrenament" profile={profile} contentType="pdf" returnTab="pdf" />
      </Section>
      <Section title="Simulări + Modele" icon="🎯" level={2} defaultOpen={openOnly('simulari')}>
        <ItemBlock category="bacalaureat" subcategory="simulari" profile={profile} contentType="pdf" returnTab="pdf" />
      </Section>
      <Section title="Bareme" icon="✅" level={2} defaultOpen={openOnly('bareme')}>
        <ItemBlock category="bacalaureat" subcategory="bareme" profile={profile} contentType="pdf" returnTab="pdf" />
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
  const targetSub = location.state?.returnSubcategory;
  const [mainTab, setMainTab] = useState(returnTab || 'interactive');
  const scrollRestored = useRef(false);
  const capitoleOpen = !!scrollCardId && targetSub === 'capitole';

  useEffect(() => {
    if (!scrollCardId || scrollRestored.current) return;
    scrollRestored.current = true;
    const cancel = scrollToCard(scrollCardId, { initialDelay: 200 });
    return () => { scrollRestored.current = false; cancel(); };
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
              📄 PDF+Interactive
            </button>
          </div>

          {mainTab === 'pdf' && (
            <div style={{ marginTop: 16 }}>
              {/* Capitole comune */}
              <Section title="Capitole cu Exerciții" icon="📚" defaultOpen={capitoleOpen}>
                <TypeTabs category="bacalaureat" subcategory="capitole" returnTab="pdf" />
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

              <ProfilePDFContent profile={profile} targetSub={capitoleOpen ? null : targetSub} />
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
                returnTab="interactive"
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
