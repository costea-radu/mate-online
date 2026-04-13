import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ContentCard } from '../components/ContentPage';

// ─── Secțiune colapsabilă ─────────────────────────────────────────────────────
function Section({ title, icon, defaultOpen = false, children, level = 1 }) {
  const [open, setOpen] = useState(defaultOpen);
  const indent = level === 1 ? 0 : 20;
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
          transition: 'background 0.2s',
        }}
      >
        <span>{icon} {title}</span>
        <span style={{ fontSize: '0.7rem', opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{
          border: '1.5px solid #dde1e8', borderTop: 'none',
          borderRadius: '0 0 10px 10px', padding: '16px',
          background: '#fafbfc',
        }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── Sub-secțiune cu titlu simplu ─────────────────────────────────────────────
function SubTitle({ children }) {
  return (
    <div style={{ fontWeight: 700, color: 'var(--navy)', fontSize: '0.85rem', marginBottom: 8, marginTop: 4, textTransform: 'uppercase', letterSpacing: '0.04em', opacity: 0.7 }}>
      {children}
    </div>
  );
}

// ─── Pagina Evaluare Națională ────────────────────────────────────────────────
export default function EvaluareNationala() {
  const [mainTab, setMainTab] = useState('pdf');

  return (
    <>
      <div className="page-header">
        <div className="container">
          <div className="breadcrumb">
            <Link to="/">Acasă</Link><span>›</span><span>Evaluare Națională</span>
          </div>
          <h1>Evaluarea Națională</h1>
          <p>Teste și exerciții pentru pregătirea examenului de clasa a VIII-a</p>
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
              <Section title="Capitole cu Exerciții" icon="📚">
                <SubTitle>📄 PDF</SubTitle>
                <ItemBlock category="evaluare-nationala" subcategory="capitole" contentType="pdf" />
                <SubTitle>🧩 Interactive</SubTitle>
                <ItemBlock category="evaluare-nationala" subcategory="capitole" contentType="interactive" />
              </Section>

              {/* Teste de antrenament */}
              <Section title="Teste de Antrenament" icon="🏋">
                {/* Exerciții pe subiecte */}
                <Section title="Exerciții pe Subiecte" icon="📝" level={2}>
                  <SubTitle>📄 PDF</SubTitle>
                  <ItemBlock category="evaluare-nationala" subcategory="exercitii-subiecte" contentType="pdf" />
                  <SubTitle>🧩 Interactive</SubTitle>
                  <ItemBlock category="evaluare-nationala" subcategory="exercitii-subiecte" contentType="interactive" />
                </Section>

                <Section title="Variante Date + Modele" icon="📋" level={2}>
                  <ItemBlock category="evaluare-nationala" subcategory="variante" contentType="pdf" />
                </Section>

                <Section title="Simulări" icon="🎯" level={2}>
                  <ItemBlock category="evaluare-nationala" subcategory="simulari" contentType="pdf" />
                </Section>

                <Section title="Bareme" icon="✅" level={2}>
                  <ItemBlock category="evaluare-nationala" subcategory="bareme" contentType="pdf" />
                </Section>
              </Section>
            </div>
          )}

          {mainTab === 'interactive' && (
            <div style={{ marginTop: 16 }}>
              <ItemBlock category="evaluare-nationala" subcategory="teste-interactive" contentType="interactive"
                emptyText="Testele interactive vor fi adăugate în curând." />
            </div>
          )}
        </div>
      </div>
    </>
  );
}
