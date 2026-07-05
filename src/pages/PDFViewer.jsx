import { authHeaders } from '../lib/api';
import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

export default function PDFViewer() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user, isPremium, loading: authLoading } = useAuth();
  const [blobUrl, setBlobUrl] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mobile, setMobile] = useState(false);

  const [searchParams] = useSearchParams();
  const idParam = searchParams.get('id');
  const [item, setItem] = useState(state?.item || null);

  useEffect(() => {
    if (item || !idParam) return;
    (async () => {
      const { data } = await supabase.from('content').select('*').eq('id', idParam).single();
      if (data) setItem(data);
      else { setError('Materialul nu a fost găsit.'); setLoading(false); }
    })();
  }, [idParam]); // eslint-disable-line

  function goBack() {
    if (state?.returnTo) {
      navigate(state.returnTo, { state: { scrollToCardId: state.scrollToCardId, returnTab: state.returnTab, returnSubcategory: state.returnSubcategory, returnContentType: state.returnContentType } });
    } else {
      navigate(-1);
    }
  }

  useEffect(() => {
    setMobile(isMobile());
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!item) { if (!idParam) navigate('/'); return; }
    if (!item.is_free && !isPremium) { navigate('/preturi'); return; }

    async function load() {
      try {
        let url = item.file_url;
        if (!item.is_free) {
          const res = await fetch('/api/get-file-url', {
            method: 'POST',
            headers: await authHeaders(),
            body: JSON.stringify({ userId: user.id, contentId: item.id }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          url = data.url;
        }

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

    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [authLoading, item, isPremium]);

  if (authLoading || loading) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#1a1a2e', gap:16 }}>
        <div className="spinner" />
        <p style={{ color:'rgba(255,255,255,0.5)', fontSize:'0.9rem' }}>Se încarcă fișierul...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#1a1a2e', gap:16, padding:24, textAlign:'center' }}>
        <div style={{ fontSize:'3rem' }}>⚠️</div>
        <p style={{ color:'rgba(255,255,255,0.7)' }}>{error}</p>
        <button className="btn btn-primary" onClick={goBack}>← Înapoi</button>
      </div>
    );
  }

  const barStyle = {
    display:'flex', alignItems:'center', justifyContent:'space-between',
    padding:'10px 20px', background:'var(--navy)', flexShrink:0,
    boxShadow:'0 2px 8px rgba(0,0,0,0.3)', gap:12,
  };

  const backBtn = {
    background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)',
    color:'#fff', borderRadius:6, padding:'6px 14px', cursor:'pointer',
    fontSize:'0.85rem', fontWeight:600, whiteSpace:'nowrap',
  };

  const badge = {
    fontSize:'0.75rem', fontWeight:700, padding:'4px 12px', borderRadius:20,
    background: item?.is_free ? 'rgba(39,174,96,0.2)' : 'rgba(232,185,49,0.2)',
    color: item?.is_free ? '#27ae60' : 'var(--gold)',
    border:`1px solid ${item?.is_free ? 'rgba(39,174,96,0.3)' : 'rgba(232,185,49,0.3)'}`,
    whiteSpace:'nowrap',
  };

  // ── Mobile: blob URL deschis ca link direct ──────────────────────────────
  if (mobile && blobUrl) {
    return (
      <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'#1a1a2e' }}>
        <div style={barStyle}>
          <button onClick={goBack} style={backBtn}>← Înapoi</button>
          <span style={{ color:'#fff', fontWeight:600, fontSize:'0.9rem', flex:1, textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            📄 {item?.title}
          </span>
          <span style={badge}>{item?.is_free ? 'Gratuit' : '⭐ Premium'}</span>
        </div>

        <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:24, padding:32, textAlign:'center' }}>
          <div style={{ fontSize:'4rem' }}>📄</div>
          <div style={{ color:'#fff', fontWeight:600, fontSize:'1.1rem' }}>{item?.title}</div>
          <p style={{ color:'rgba(255,255,255,0.6)', fontSize:'0.9rem', lineHeight:1.6, maxWidth:320 }}>
            Apasă butonul de mai jos pentru a deschide PDF-ul în aplicația nativă a dispozitivului tău.
          </p>
          <a
            href={blobUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display:'inline-block', padding:'14px 36px', background:'var(--gold)',
              color:'var(--navy-dark)', borderRadius:10, fontWeight:700,
              fontSize:'1rem', textDecoration:'none', boxShadow:'0 4px 16px rgba(232,185,49,0.35)',
            }}
          >
            📂 Deschide PDF-ul
          </a>
          <p style={{ color:'rgba(255,255,255,0.35)', fontSize:'0.78rem' }}>
            Linkul este temporar și expiră la închiderea paginii.
          </p>
        </div>
      </div>
    );
  }

  // ── Desktop: iframe cu blob URL ──────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'#1a1a2e' }}>
      <div style={barStyle}>
        <button onClick={goBack} style={backBtn}>← Înapoi</button>
        <span style={{ color:'rgba(255,255,255,0.35)' }}>|</span>
        <span style={{ color:'#fff', fontWeight:600, fontSize:'0.95rem', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          📄 {item?.title}
        </span>
        <span style={badge}>{item?.is_free ? 'Gratuit' : '⭐ Premium'}</span>
      </div>

      {blobUrl && (
        <iframe
          src={blobUrl}
          style={{ flex:1, border:'none', width:'100%' }}
          title={item?.title}
        />
      )}
    </div>
  );
}
