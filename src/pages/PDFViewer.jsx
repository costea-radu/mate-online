import { useEffect, useState, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function PDFViewer() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user, isPremium, loading: authLoading } = useAuth();

  const [pdfData, setPdfData] = useState(null); // ArrayBuffer
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // PDF.js state
  const [pdfDoc, setPdfDoc] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [rendering, setRendering] = useState(false);
  const canvasRef = useRef(null);
  const renderTaskRef = useRef(null);

  const item = state?.item;

  // ── Fetch PDF data ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (authLoading) return;
    if (!item) { navigate('/'); return; }

    const canAccess = item.is_free || isPremium;
    if (!canAccess) { navigate('/preturi'); return; }

    async function load() {
      try {
        let url;
        if (item.is_free) {
          url = item.file_url;
        } else {
          const res = await fetch('/api/get-file-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId: user.id, contentId: item.id }),
          });
          const data = await res.json();
          if (!res.ok) throw new Error(data.error);
          url = data.url;
        }

        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        setPdfData(buffer);
      } catch (err) {
        console.error(err);
        setError('Nu s-a putut încărca fișierul. Încearcă din nou.');
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [item, isPremium, authLoading]);

  // ── Load PDF.js and initialize ──────────────────────────────────────────────
  useEffect(() => {
    if (!pdfData) return;

    async function initPdf() {
      // Load PDF.js from CDN
      if (!window.pdfjsLib) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          script.onload = resolve;
          script.onerror = reject;
          document.head.appendChild(script);
        });
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      const pdf = await window.pdfjsLib.getDocument({ data: pdfData }).promise;
      setPdfDoc(pdf);
      setTotalPages(pdf.numPages);
      setCurrentPage(1);
    }

    initPdf().catch(err => {
      console.error('PDF.js error:', err);
      setError('Eroare la procesarea PDF-ului.');
    });
  }, [pdfData]);

  // ── Render page ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    async function renderPage() {
      // Cancel any in-progress render
      if (renderTaskRef.current) {
        await renderTaskRef.current.cancel().catch(() => {});
      }

      setRendering(true);
      try {
        const page = await pdfDoc.getPage(currentPage);
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const renderTask = page.render({ canvasContext: ctx, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (err) {
        if (err?.name !== 'RenderingCancelledException') {
          console.error('Render error:', err);
        }
      } finally {
        setRendering(false);
      }
    }

    renderPage();
  }, [pdfDoc, currentPage, scale]);

  // ── Touch/pinch zoom ────────────────────────────────────────────────────────
  const lastTouchDist = useRef(null);

  function handleTouchStart(e) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastTouchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  }

  function handleTouchMove(e) {
    if (e.touches.length === 2 && lastTouchDist.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = dist / lastTouchDist.current;
      lastTouchDist.current = dist;
      setScale(s => Math.min(4, Math.max(0.5, s * delta)));
    }
  }

  // ── Loading / Error screens ─────────────────────────────────────────────────
  if (authLoading || loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#1a1a2e', gap: 16 }}>
        <div className="spinner" />
        <p style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.9rem' }}>Se încarcă fișierul...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', background: '#1a1a2e', gap: 16, textAlign: 'center', padding: 24 }}>
        <div style={{ fontSize: '3rem' }}>⚠️</div>
        <p style={{ color: 'rgba(255,255,255,0.7)' }}>{error}</p>
        <button className="btn btn-primary" onClick={() => navigate(-1)}>← Înapoi</button>
      </div>
    );
  }

  const progress = totalPages > 0 ? (currentPage / totalPages) * 100 : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1a1a2e', userSelect: 'none' }}>

      {/* ── Top bar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', background: 'var(--navy)', flexShrink: 0,
        boxShadow: '0 2px 8px rgba(0,0,0,0.4)', gap: 8, flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={() => navigate(-1)} style={{
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)',
            color: '#fff', borderRadius: 6, padding: '6px 12px', cursor: 'pointer',
            fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap',
          }}>← Înapoi</button>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: '0.8rem' }}>|</span>
          <span style={{ color: '#fff', fontWeight: 600, fontSize: '0.88rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            📄 {item?.title}
          </span>
        </div>

        {/* Navigare pagini */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage <= 1}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 6, width: 32, height: 32, cursor: 'pointer', fontSize: '1rem', opacity: currentPage <= 1 ? 0.3 : 1 }}
          >‹</button>
          <span style={{ color: '#fff', fontSize: '0.82rem', whiteSpace: 'nowrap' }}>
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage >= totalPages}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 6, width: 32, height: 32, cursor: 'pointer', fontSize: '1rem', opacity: currentPage >= totalPages ? 0.3 : 1 }}
          >›</button>
        </div>

        {/* Zoom */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button onClick={() => setScale(s => Math.max(0.5, s - 0.25))}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 6, width: 32, height: 32, cursor: 'pointer', fontSize: '1.1rem' }}>−</button>
          <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: '0.78rem', minWidth: 40, textAlign: 'center' }}>
            {Math.round(scale * 100)}%
          </span>
          <button onClick={() => setScale(s => Math.min(4, s + 0.25))}
            style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', borderRadius: 6, width: 32, height: 32, cursor: 'pointer', fontSize: '1.1rem' }}>+</button>
          <span style={{
            fontSize: '0.72rem', fontWeight: 700, padding: '3px 10px', borderRadius: 20,
            background: item?.is_free ? 'rgba(39,174,96,0.2)' : 'rgba(232,185,49,0.2)',
            color: item?.is_free ? '#27ae60' : 'var(--gold)',
            border: `1px solid ${item?.is_free ? 'rgba(39,174,96,0.3)' : 'rgba(232,185,49,0.3)'}`,
            marginLeft: 4,
          }}>
            {item?.is_free ? 'Gratuit' : '⭐ Premium'}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ height: 3, background: 'rgba(255,255,255,0.1)', flexShrink: 0 }}>
        <div style={{ height: '100%', background: 'var(--gold)', width: `${progress}%`, transition: 'width 0.3s' }} />
      </div>

      {/* ── Canvas area ── */}
      <div
        style={{ flex: 1, overflow: 'auto', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '16px', background: '#2a2a3e' }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
      >
        {rendering && (
          <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', color: 'rgba(255,255,255,0.4)', fontSize: '0.85rem', pointerEvents: 'none' }}>
            Se randează...
          </div>
        )}
        <canvas
          ref={canvasRef}
          style={{
            display: 'block',
            boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
            maxWidth: '100%',
            touchAction: 'pan-x pan-y',
          }}
        />
      </div>

      {/* ── Bottom navigation (mobile friendly) ── */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 20px', background: 'var(--navy)', flexShrink: 0,
        borderTop: '1px solid rgba(255,255,255,0.08)',
      }}>
        <button
          onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
          disabled={currentPage <= 1}
          style={{
            padding: '10px 24px', background: 'rgba(255,255,255,0.1)', border: 'none',
            color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
            fontSize: '0.9rem', opacity: currentPage <= 1 ? 0.3 : 1,
          }}
        >← Pagina anterioară</button>

        <span style={{ color: 'rgba(255,255,255,0.5)', fontSize: '0.82rem' }}>
          {currentPage} / {totalPages}
        </span>

        <button
          onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
          disabled={currentPage >= totalPages}
          style={{
            padding: '10px 24px', background: 'rgba(255,255,255,0.1)', border: 'none',
            color: '#fff', borderRadius: 8, cursor: 'pointer', fontWeight: 600,
            fontSize: '0.9rem', opacity: currentPage >= totalPages ? 0.3 : 1,
          }}
        >Pagina următoare →</button>
      </div>
    </div>
  );
}
