import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function PDFViewer() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user, isPremium, loading: authLoading } = useAuth();

  const [status, setStatus] = useState('loading'); // loading | error | ready
  const [errorMsg, setErrorMsg] = useState('');
  const [pageInfo, setPageInfo] = useState({ current: 1, total: 0 });
  const [zoomPct, setZoomPct] = useState(150);

  const canvasRef = useRef(null);
  const pdfRef = useRef(null);
  const renderingRef = useRef(false);
  const pendingRender = useRef(null);

  const item = state?.item;

  // ── Fetch + load PDF ──────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!item) { navigate('/'); return; }
    if (!item.is_free && !isPremium) { navigate('/preturi'); return; }

    async function load() {
      try {
        // 1. Get URL
        let url = item.file_url;
        if (!item.is_free) {
          const res = await fetch('/api/get-file-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, contentId: item.id }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          url = data.url;
        }

        // 2. Fetch as ArrayBuffer
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const buffer = await resp.arrayBuffer();

        // 3. Load PDF.js
        if (!window.pdfjsLib) {
          await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
          window.pdfjsLib.GlobalWorkerOptions.workerSrc =
            'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        }

        // 4. Parse PDF
        const pdf = await window.pdfjsLib.getDocument({ data: buffer }).promise;
        pdfRef.current = pdf;
        setPageInfo({ current: 1, total: pdf.numPages });
        setStatus('ready');
      } catch (err) {
        console.error(err);
        setErrorMsg(err.message || 'Eroare necunoscută');
        setStatus('error');
      }
    }

    load();
  }, [authLoading, item, isPremium]);

  // ── Render whenever page or zoom changes ──────────────────────────────────
  useEffect(() => {
    if (status !== 'ready' || !pdfRef.current) return;
    renderPage(pageInfo.current, zoomPct / 100);
  }, [status, pageInfo.current, zoomPct]);

  async function renderPage(pageNum, scale) {
    if (!pdfRef.current || !canvasRef.current) return;

    // Queue: if already rendering, remember the latest request
    if (renderingRef.current) {
      pendingRender.current = { pageNum, scale };
      return;
    }

    renderingRef.current = true;
    try {
      const page = await pdfRef.current.getPage(pageNum);
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: ctx, viewport }).promise;
    } catch (e) {
      console.error('Render error:', e);
    } finally {
      renderingRef.current = false;
      // If a newer request came in while rendering, execute it now
      if (pendingRender.current) {
        const { pageNum: p, scale: s } = pendingRender.current;
        pendingRender.current = null;
        renderPage(p, s);
      }
    }
  }

  function goPage(delta) {
    setPageInfo(prev => {
      const next = Math.max(1, Math.min(prev.total, prev.current + delta));
      return { ...prev, current: next };
    });
  }

  function changeZoom(delta) {
    setZoomPct(prev => Math.max(50, Math.min(400, prev + delta)));
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (authLoading || status === 'loading') {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#1a1a2e', gap:16 }}>
        <div className="spinner" />
        <p style={{ color:'rgba(255,255,255,0.5)', fontSize:'0.9rem' }}>Se încarcă PDF-ul...</p>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#1a1a2e', gap:16, padding:24, textAlign:'center' }}>
        <div style={{ fontSize:'3rem' }}>⚠️</div>
        <p style={{ color:'rgba(255,255,255,0.7)' }}>{errorMsg}</p>
        <button className="btn btn-primary" onClick={() => navigate(-1)}>← Înapoi</button>
      </div>
    );
  }

  const progress = pageInfo.total > 0 ? (pageInfo.current / pageInfo.total) * 100 : 0;

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', background:'#1a1a2e' }}>

      {/* ── Top bar ── */}
      <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--navy)', flexShrink:0, flexWrap:'wrap', boxShadow:'0 2px 8px rgba(0,0,0,0.4)' }}>
        <button onClick={() => navigate(-1)} style={btnStyle}>← Înapoi</button>
        <span style={{ color:'rgba(255,255,255,0.35)' }}>|</span>
        <span style={{ color:'#fff', fontWeight:600, fontSize:'0.88rem', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', minWidth:0 }}>
          📄 {item?.title}
        </span>

        {/* Page nav */}
        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          <button onClick={() => goPage(-1)} disabled={pageInfo.current <= 1} style={navBtn(pageInfo.current <= 1)}>‹</button>
          <span style={{ color:'#fff', fontSize:'0.82rem', whiteSpace:'nowrap' }}>{pageInfo.current} / {pageInfo.total}</span>
          <button onClick={() => goPage(1)} disabled={pageInfo.current >= pageInfo.total} style={navBtn(pageInfo.current >= pageInfo.total)}>›</button>
        </div>

        {/* Zoom */}
        <div style={{ display:'flex', alignItems:'center', gap:6, flexShrink:0 }}>
          <button onClick={() => changeZoom(-25)} style={btnStyle}>−</button>
          <span style={{ color:'rgba(255,255,255,0.7)', fontSize:'0.78rem', minWidth:38, textAlign:'center' }}>{zoomPct}%</span>
          <button onClick={() => changeZoom(25)} style={btnStyle}>+</button>
        </div>

        <span style={{ fontSize:'0.72rem', fontWeight:700, padding:'3px 10px', borderRadius:20, background: item?.is_free ? 'rgba(39,174,96,0.2)' : 'rgba(232,185,49,0.2)', color: item?.is_free ? '#27ae60' : 'var(--gold)', border:`1px solid ${item?.is_free ? 'rgba(39,174,96,0.3)' : 'rgba(232,185,49,0.3)'}`, whiteSpace:'nowrap' }}>
          {item?.is_free ? 'Gratuit' : '⭐ Premium'}
        </span>
      </div>

      {/* Progress */}
      <div style={{ height:3, background:'rgba(255,255,255,0.1)', flexShrink:0 }}>
        <div style={{ height:'100%', background:'var(--gold)', width:`${progress}%`, transition:'width 0.3s' }} />
      </div>

      {/* ── Canvas ── */}
      <div style={{ flex:1, overflow:'auto', display:'flex', justifyContent:'center', alignItems:'flex-start', padding:16, background:'#2a2a3e' }}>
        <canvas ref={canvasRef} style={{ display:'block', boxShadow:'0 4px 24px rgba(0,0,0,0.5)', maxWidth:'100%' }} />
      </div>

      {/* ── Bottom nav ── */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'10px 16px', background:'var(--navy)', flexShrink:0, borderTop:'1px solid rgba(255,255,255,0.08)' }}>
        <button onClick={() => goPage(-1)} disabled={pageInfo.current <= 1} style={{ ...bottomBtn, opacity: pageInfo.current <= 1 ? 0.35 : 1 }}>← Anterioară</button>
        <span style={{ color:'rgba(255,255,255,0.45)', fontSize:'0.82rem' }}>{pageInfo.current} / {pageInfo.total}</span>
        <button onClick={() => goPage(1)} disabled={pageInfo.current >= pageInfo.total} style={{ ...bottomBtn, opacity: pageInfo.current >= pageInfo.total ? 0.35 : 1 }}>Următoare →</button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

const btnStyle = {
  background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.15)',
  color:'#fff', borderRadius:6, padding:'6px 12px', cursor:'pointer',
  fontSize:'0.85rem', fontWeight:600,
};

const navBtn = (disabled) => ({
  background:'rgba(255,255,255,0.1)', border:'none', color:'#fff',
  borderRadius:6, width:30, height:30, cursor: disabled ? 'default' : 'pointer',
  fontSize:'1rem', opacity: disabled ? 0.3 : 1,
});

const bottomBtn = {
  padding:'10px 20px', background:'rgba(255,255,255,0.1)', border:'none',
  color:'#fff', borderRadius:8, cursor:'pointer', fontWeight:600, fontSize:'0.88rem',
};
