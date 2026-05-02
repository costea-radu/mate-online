import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';

export default function InteractiveViewer() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { isPremium, user, loading: authLoading } = useAuth();
  const [srcDoc, setSrcDoc] = useState(state?.srcDoc || null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scoreSaved, setScoreSaved] = useState(false);
  const [savedScore, setSavedScore] = useState(null);

  const item = state?.item;

  // ─── Salvare progres primit de la iframe ────────────────────────────────────
  useEffect(() => {
    async function handleMessage(event) {
      // Acceptăm mesaje de la orice origine (iframe e încărcat din Supabase Storage)
      if (!event.data || event.data.type !== 'MATE_SCORE') return;

      const { score, maxScore } = event.data;
      if (typeof score !== 'number' || typeof maxScore !== 'number') return;
      if (!user || !item) return;

      try {
        const { error } = await supabase
          .from('progress')
          .upsert(
            {
              user_id: user.id,
              content_id: item.id,
              score,
              max_score: maxScore,
              completed_at: new Date().toISOString(),
            },
            { onConflict: 'user_id,content_id' }
          );

        if (!error) {
          setScoreSaved(true);
          setSavedScore({ score, maxScore });
        }
      } catch (err) {
        console.error('Progress save error:', err);
      }
    }

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [user, item]);

  useEffect(() => {
    if (authLoading) return;
    if (!item) { navigate('/'); return; }

    const canAccess = item.is_free || isPremium;
    if (!canAccess) { navigate('/preturi'); return; }

    // srcDoc direct din state (transmis de ContentPage)
    if (state?.srcDoc) {
      setLoading(false);
      return;
    }

    async function load() {
      try {
        let url = item.file_url;

        // Premium: obține signed URL de la server
        if (!item.is_free) {
          const res = await fetch('/api/get-file-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, contentId: item.id }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error || 'Eroare server');
          url = data.url;
        }

        // Fetch cu XMLHttpRequest ca fallback pentru iOS Safari
        const html = await new Promise((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          xhr.open('GET', url, true);
          xhr.responseType = 'text';
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
            else reject(new Error(`HTTP ${xhr.status}`));
          };
          xhr.onerror = () => reject(new Error('Eroare de rețea'));
          xhr.send();
        });
        setSrcDoc(html);
      } catch (err) {
        console.error('InteractiveViewer load error:', err);
        setError('Nu s-a putut încărca exercițiul. Încearcă din nou.');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [item, isPremium, authLoading]);

  if (authLoading || loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f0f4f8', gap: 16 }}>
        <div className="spinner" />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Se încarcă exercițiul...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f0f4f8', gap: 16, textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: '3rem' }}>⚠️</div>
        <h2 style={{ fontFamily: 'var(--font-display)', color: 'var(--navy)' }}>Eroare</h2>
        <p style={{ color: 'var(--text-muted)' }}>{error}</p>
        <button className="btn btn-primary" onClick={() => navigate(-1)}>← Înapoi</button>
      </div>
    );
  }

  const scorePct = savedScore ? Math.round((savedScore.score / savedScore.maxScore) * 100) : null;
  const scoreColor = scorePct >= 80 ? '#2e7d32' : scorePct >= 50 ? '#e65100' : '#c62828';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: 'var(--navy-dark)' }}>
      {/* Bara de sus */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 20px', background: 'var(--navy)', flexShrink: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => item?.category === 'manuale' ? navigate('/') : navigate(-1)}
            style={{
              background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
              color: '#fff', borderRadius: 6, padding: '6px 14px', cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: 600,
            }}
          >
            ← Înapoi
          </button>
          <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem' }}>|</div>
          <div style={{ color: '#fff', fontWeight: 600, fontSize: '0.95rem' }}>
            🧩 {item?.title}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Scor salvat */}
          {scoreSaved && savedScore && (
            <div style={{
              background: scoreColor, color: '#fff',
              padding: '4px 14px', borderRadius: 20,
              fontSize: '0.82rem', fontWeight: 700,
              animation: 'fadeIn 0.4s ease',
            }}>
              ✓ Scor salvat: {savedScore.score}/{savedScore.maxScore} ({scorePct}%)
            </div>
          )}

          <div style={{
            fontSize: '0.75rem', fontWeight: 700, padding: '4px 12px', borderRadius: 20,
            background: item?.is_free ? 'rgba(39,174,96,0.2)' : 'rgba(232,185,49,0.2)',
            color: item?.is_free ? '#27ae60' : 'var(--gold)',
            border: `1px solid ${item?.is_free ? 'rgba(39,174,96,0.3)' : 'rgba(232,185,49,0.3)'}`,
          }}>
            {item?.is_free ? 'Gratuit' : '⭐ Premium'}
          </div>
        </div>
      </div>

      {/* Instrucțiune pentru dezvoltatori de exerciții */}
      {srcDoc !== null && (
        <iframe
          srcDoc={srcDoc}
          style={{ flex: 1, border: 'none', width: '100%' }}
          title={item?.title}
          sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-top-navigation-by-user-activation"
        />
      )}
    </div>
  );
}
