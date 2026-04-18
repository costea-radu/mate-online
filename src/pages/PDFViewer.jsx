import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function PDFViewer() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user, isPremium, loading: authLoading } = useAuth();
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const item = state?.item;

  useEffect(() => {
    if (authLoading) return;
    if (!item) { navigate('/'); return; }

    const canAccess = item.is_free || isPremium;
    if (!canAccess) { navigate('/preturi'); return; }

    async function load() {
      try {
        let url;

        if (item.is_free) {
          // Gratuit — URL direct
          url = item.file_url;
        } else {
          // Premium — signed URL de la server
          const res = await fetch('/api/get-file-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, contentId: item.id }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          url = data.url;
        }

        // Fetch PDF ca ArrayBuffer și creăm blob URL local
        // Blob URL-ul nu dezvăluie URL-ul real al fișierului
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const blob = new Blob([buffer], { type: 'application/pdf' });
        const localUrl = URL.createObjectURL(blob);
        setBlobUrl(localUrl);
      } catch (err) {
        console.error(err);
        setError('Nu s-a putut încărca fișierul. Încearcă din nou.');
      } finally {
        setLoading(false);
      }
    }

    load();

    // Curățăm blob URL la unmount
    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [item, isPremium, authLoading]);

  if (authLoading || loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#f0f4f8', gap: 16 }}>
        <div className="spinner" />
        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>Se încarcă fișierul...</p>
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
            onClick={() => navigate(-1)}
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
            📄 {item?.title}
          </div>
        </div>
        <div style={{
          fontSize: '0.75rem', fontWeight: 700, padding: '4px 12px', borderRadius: 20,
          background: item?.is_free ? 'rgba(39,174,96,0.2)' : 'rgba(232,185,49,0.2)',
          color: item?.is_free ? '#27ae60' : 'var(--gold)',
          border: `1px solid ${item?.is_free ? 'rgba(39,174,96,0.3)' : 'rgba(232,185,49,0.3)'}`,
        }}>
          {item?.is_free ? 'Gratuit' : '⭐ Premium'}
        </div>
      </div>

      {/* PDF iframe cu blob URL */}
      {blobUrl && (
        <iframe
          src={blobUrl}
          style={{ flex: 1, border: 'none', width: '100%' }}
          title={item?.title}
        />
      )}
    </div>
  );
}
