// =====================================================================
// src/pages/ExercitiuAIViewer.jsx — pagină fullscreen pentru exercițiile
// interactive AI (Profesor Virtual / Biblioteca utilizatorilor), cu bară
// și buton „Închide” — identic ca stil cu viewerul de PDF-uri.
// Primește prin location.state: { html, title, mode?, id? }
//   mode 'library' → salvează scorul în „Testele mele”
//   mode 'public'  → salvează scorul în Biblioteca utilizatorilor
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { aiClient } from '../lib/aiClient';
import { notaDinScor } from '../lib/nota';
import { ReviewToast } from '../components/ReviewWidget';

export default function ExercitiuAIViewer() {
  const navigate = useNavigate();
  const { state } = useLocation();
  const [score, setScore] = useState(null);
  const [reviewOpen, setReviewOpen] = useState(false); // „Cum ți s-a părut testul?" (Biblioteca utilizatorilor)
  const reviewAskedRef = useRef(false);
  const html = state?.html || '';
  const title = state?.title || 'Exercițiu interactiv';

  useEffect(() => {
    function onMsg(e) {
      if (e.source === window || !e.data || e.data.type !== 'MATE_SCORE') return;
      const sc = e.data.score, mx = e.data.maxScore;
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
    }
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [state]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1a1a2e' }}>
      <div style={bar}>
        <button onClick={() => navigate(-1)} style={closeBtn}>✕ Închide</button>
        <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.9rem', flex: 1, textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          🧩 {title}
        </span>
        {score ? <span style={chip}>Scor: {score.sc}/{score.mx}{notaDinScor(score.sc, score.mx) ? ` · nota ${notaDinScor(score.sc, score.mx)}` : ''}</span> : <span style={{ minWidth: 90 }} />}
      </div>
      <iframe title={title} sandbox="allow-scripts" srcDoc={html} style={{ flex: 1, width: '100%', border: 'none', background: '#fff' }} />

      {/* Recenzie după test — doar pentru testele din Biblioteca utilizatorilor */}
      {reviewOpen && state?.id && state?.mode === 'public' && (
        <ReviewToast targetType="public_item" targetId={state.id} title={title} onClose={closeReview} />
      )}
    </div>
  );
}
