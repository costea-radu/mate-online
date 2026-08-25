// =====================================================================
// src/pages/ExercitiuAIViewer.jsx — pagină fullscreen pentru exercițiile
// interactive AI (Profesor Virtual / Biblioteca utilizatorilor), cu bară
// și buton „Închide” — identic ca stil cu viewerul de PDF-uri.
// Primește prin location.state: { html, title, mode?, id?, exercise? }
//   mode 'library' → salvează scorul în „Testele mele”
//   mode 'public'  → salvează scorul în Biblioteca utilizatorilor
// Etapa 3 (4.7): Profesorul Virtual e montat ȘI aici, lângă exercițiu — cu
// starea exercițiului (pașii, răspunsurile elevului) prin tutorBridge, ca în
// InteractiveViewer; acțiunile „scrie tu / alege tu" ajung în iframe.
// =====================================================================
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import TestModeBadge from '../components/TestModeBadge';
import { notaDinScor } from '../lib/nota';
import { ReviewToast } from '../components/ReviewWidget';
import { ChatPanel, TutorFab } from '../components/AITutor';
import EinsteinIcon from '../components/EinsteinIcon';
import { injectTutorBridge } from '../lib/tutorBridge';

export default function ExercitiuAIViewer() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [score, setScore] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false); // „Cum ți s-a părut testul?" (Biblioteca utilizatorilor)
  const reviewAskedRef = useRef(false);
  const html = state?.html || '';
  const title = state?.title || 'Exercițiu interactiv';

  // ── Profesorul Virtual lângă exercițiu (Etapa 3) ─────────────────────────
  const [tutorOpen, setTutorOpen] = useState(!!state?.openTutor);
  const [exState, setExState] = useState(null);       // starea exercițiului din iframe (tutorBridge)
  const [autoPrompt, setAutoPrompt] = useState(null); // „Nu înțeleg acest pas" din iframe
  const iframeRef = useRef(null);
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 800);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 800);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const finalDoc = useMemo(() => (html ? injectTutorBridge(html) : null), [html]);

  useEffect(() => {
    function onMsg(e) {
      if (e.source === window || !e.data || typeof e.data !== 'object') return;
      const d = e.data;
      if (d.type === 'MATE_TUTOR_STATE' && d.payload) { setExState(d.payload); return; }
      if (d.type === 'MATE_TUTOR_OPEN') {
        setTutorOpen(true);
        setAutoPrompt({ id: Date.now(), text: d.text || 'Nu înțeleg acest exercițiu — explică-mi pasul următor.' });
        return;
      }
      if (d.type !== 'MATE_SCORE') return;
      const sc = d.score, mx = d.maxScore;
      if (typeof sc !== 'number' || typeof mx !== 'number' || mx <= 0) return;
      setScore({ sc, mx });
      if (state?.id && state?.mode === 'public') {
        // Recenzia se cere ABIA după ce scorul e înregistrat pe server: RLS-ul
        // tabelului `reviews` permite nota doar cui are rând în ai_public_results.
        aiClient.publicRecord({ id: state.id, score: sc, maxScore: mx })
          .then(() => {
            if (reviewAskedRef.current) return;
            try { if (sessionStorage.getItem(`em_review_skip_${state.id}`)) return; } catch { /* ignore */ }
            reviewAskedRef.current = true;
            setTimeout(() => setReviewOpen(true), 1200);
          })
          .catch(() => {});
      }
      if (state?.id && state?.mode === 'library') aiClient.updateLibraryScore(state.id, sc, mx).catch(() => {});
      // Test pe grupă: scorul merge la profesor, pe repartizarea acestui elev.
      if (state?.gtId) aiClient.groupAssignmentScore({ pickId: state.gtId, score: sc, maxScore: mx }).catch(() => {});
      // Temă (exerciții bifate de profesor): scorul intră pe exercițiul din temă.
      if (state?.hwId) aiClient.homeworkScore({ progressId: state.hwId, score: sc, maxScore: mx }).catch(() => {});
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [state]);

  // acțiunile profesorului („scrie tu", „alege tu B") → iframe (tutorBridge)
  function sendTutorAction(action) {
    try { iframeRef.current?.contentWindow?.postMessage({ type: 'MATE_TUTOR_ACTION', action }, '*'); } catch { /* noop */ }
  }

  // contextul chatului: exercițiul (textul din bridge sau JSON-ul primit în state)
  const tutorContext = useMemo(() => {
    const ex = state?.exercise;
    const fromJson = ex && typeof ex === 'object'
      ? [ex.statement, ...((ex.questions || ex.steps || []).map((q, i) => `${i + 1}. ${q.statement || q.prompt || ''}`))].filter(Boolean).join('\n').slice(0, 6000)
      : '';
    return {
      interactive: true,
      category: state?.category || null,
      title,
      exerciseText: exState?.text
        ? `Exercițiul „${title}":\n${exState.text}`
        : fromJson ? `Exercițiul „${title}":\n${fromJson}` : `Exercițiul „${title}" (elevul nu a început încă niciun pas).`,
    };
  }, [state, title, exState]);

  function closeReview() {
    setReviewOpen(false);
    try { if (state?.id) sessionStorage.setItem(`em_review_skip_${state.id}`, '1'); } catch { /* ignore */ }
  }

  const bar = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '10px 20px', background: 'var(--navy)', flexShrink: 0,
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)', gap: 12,
  };
  const closeBtn = {
    background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
    color: '#fff', borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
    fontSize: '0.85rem', fontWeight: 600, whiteSpace: 'nowrap',
  };
  const chip = {
    fontSize: '0.78rem', fontWeight: 700, padding: '4px 12px', borderRadius: 20,
    background: 'rgba(39,174,96,0.2)', color: '#27ae60', border: '1px solid rgba(39,174,96,0.3)', whiteSpace: 'nowrap',
  };

  if (!html) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 14, background: '#1a1a2e', color: '#fff' }}>
        <div>Exercițiul nu mai este disponibil (pagina a fost reîncărcată).</div>
        <button onClick={() => navigate(-1)} style={{ ...closeBtn, background: 'var(--gold)', color: 'var(--navy)', border: 'none' }}>✕ Închide</button>
      </div>
    );
  }

  const testActiv = !!(state?.gtId || state?.mode === 'group');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1a1a2e' }}>
      <div style={bar}>
        <button onClick={() => navigate(-1)} style={closeBtn}>✕ Închide</button>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem', flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          🧩 {title}
        </span>
        {/* În timpul unui TEST PE GRUPĂ, „Întreabă profesorul" dispare */}
        {!testActiv && (
          <button onClick={() => setTutorOpen((o) => !o)} title="Întreabă-l pe Profesorul Virtual despre acest exercițiu"
            style={{ ...closeBtn, background: tutorOpen ? 'var(--gold)' : 'rgba(255,255,255,0.1)', color: tutorOpen ? 'var(--navy)' : '#fff', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <EinsteinIcon size={18} /> {tutorOpen ? 'Închide profesorul' : 'Întreabă profesorul'}
          </button>
        )}
        {testActiv && <TestModeBadge compact />}
        {score ? <span style={chip}>Scor: {score.sc}/{score.mx}{notaDinScor(score.sc, score.mx) ? ` · nota ${notaDinScor(score.sc, score.mx)}` : ''}</span> : <span style={{ minWidth: 90 }} />}
      </div>

      {/* Exercițiul + Profesorul Virtual, unul lângă altul (ca în InteractiveViewer) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: narrow ? 'column' : 'row', minHeight: 0 }}>
        <iframe ref={iframeRef} title={title} sandbox="allow-scripts" srcDoc={finalDoc || html} style={{ flex: 1, width: '100%', minHeight: 0, border: 'none', background: '#fff' }} />
        {tutorOpen && !testActiv && (
          <div style={{
            flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', minHeight: 0,
            ...(narrow ? { height: '52%', borderTop: '3px solid var(--gold)' } : { width: 400, maxWidth: '45vw', borderLeft: '3px solid var(--gold)' }),
          }}>
            <div style={{ background: 'var(--navy)', color: '#fff', padding: '8px 12px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
              <div style={{ fontWeight: 700, fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <EinsteinIcon size={20} /> Profesorul Virtual
              </div>
              <button onClick={() => { setAutoPrompt(null); setTutorOpen(false); }}
                style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: '.78rem', fontWeight: 600 }}>
                ✕
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <ChatPanel compact context={tutorContext} onAction={sendTutorAction} autoPrompt={autoPrompt} />
            </div>
          </div>
        )}
      </div>
      {!tutorOpen && <TutorFab onOpen={() => setTutorOpen(true)} />}

      {/* Recenzie după test — doar pentru testele din Biblioteca utilizatorilor */}
      {reviewOpen && state?.id && state?.mode === 'public' && (
        <ReviewToast targetType="public_item" targetId={state.id} title={title} onClose={closeReview} />
      )}
    </div>
  );
}
