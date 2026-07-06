import { useState, useEffect, useRef } from 'react';
import Discussions from '../components/Discussions';
import { Link, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { ContentCard, scrollToCard } from '../components/ContentPage';
import { ItemBlock, Section, TypeTabs } from '../components/ExamContent';


// ─── Pagina Evaluare Națională ────────────────────────────────────────────────
export default function EvaluareNationala() {
  const location = useLocation();
  const returnTab = location.state?.returnTab;
  const scrollCardId = location.state?.scrollToCardId;
  const targetSub = location.state?.returnSubcategory;
  const [mainTab, setMainTab] = useState(returnTab || 'interactive');
  const scrollRestored = useRef(false);

  // Deschidem doar secțiunea care conține fișierul deschis anterior
  const openOnly = (subs) => !!scrollCardId && subs.includes(targetSub);

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
            <Link to="/">Acasă</Link><span>›</span><span>Evaluare Națională</span>
          </div>
          <h1>Evaluarea Națională</h1>
          <p>Teste și exerciții pentru pregătirea examenului de clasa a VIII-a</p>
        </div>
      </div>

      <div className="content-list">
        <div className="container">
          <div className="tabs">
            <button
              className={`tab ${mainTab === 'interactive' ? 'active' : ''}`}
              onClick={() => setMainTab('interactive')}
            >
              🧩 Teste Interactive
            </button>
            <button
              className={`tab ${mainTab === 'pdf' ? 'active' : ''}`}
              onClick={() => setMainTab('pdf')}
            >
              📄 PDF+Interactive
            </button>
          </div>

          {mainTab === 'pdf' && (
            <div style={{ marginTop: 16 }}>
              <Section title="Capitole cu Exerciții" icon="📚" defaultOpen={openOnly(['capitole'])}>
                <TypeTabs category="evaluare-nationala" subcategory="capitole" returnTab="pdf" />
              </Section>

              <Section title="Teste de Antrenament" icon="🏋" defaultOpen={openOnly(['exercitii-subiecte', 'variante', 'simulari', 'bareme'])}>
                <Section title="Exerciții pe Subiecte" icon="📝" level={2} defaultOpen={openOnly(['exercitii-subiecte'])}>
                  <TypeTabs category="evaluare-nationala" subcategory="exercitii-subiecte" returnTab="pdf" />
                </Section>

                <Section title="Variante Date + Modele" icon="📋" level={2} defaultOpen={openOnly(['variante'])}>
                  <ItemBlock category="evaluare-nationala" subcategory="variante" contentType="pdf" returnTab="pdf" />
                </Section>

                <Section title="Simulări" icon="🎯" level={2} defaultOpen={openOnly(['simulari'])}>
                  <ItemBlock category="evaluare-nationala" subcategory="simulari" contentType="pdf" returnTab="pdf" />
                </Section>

                <Section title="Bareme" icon="✅" level={2} defaultOpen={openOnly(['bareme'])}>
                  <ItemBlock category="evaluare-nationala" subcategory="bareme" contentType="pdf" returnTab="pdf" />
                </Section>
              </Section>
            </div>
          )}

          {mainTab === 'interactive' && (
            <div style={{ marginTop: 16 }}>
              <ItemBlock
                category="evaluare-nationala"
                subcategory="teste-interactive"
                contentType="interactive"
                returnTab="interactive"
                emptyText="Testele interactive vor fi adăugate în curând."
              />
            </div>
          )}
        </div>
        <Discussions fixedCategory="evaluare-nationala" />
      </div>
    </>
  );
}
