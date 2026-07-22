import { authHeaders } from '../lib/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { ChatPanel } from '../components/AITutor';
import EinsteinIcon from '../components/EinsteinIcon';
import { aiClient } from '../lib/aiClient';

function isMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// ─── pdf.js de pe CDN (doar pe mobil): redăm PDF-ul ÎN pagină, pe <canvas>,
// ca Profesorul Virtual să rămână activ lângă el (vizualizatoarele native
// de pe telefon descarcă fișierul sau acoperă complet aplicația). ─────────
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
let pdfjsPromise = null;
function loadPdfJs() {
  if (typeof window !== 'undefined' && window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
  if (!pdfjsPromise) {
    pdfjsPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = PDFJS_URL;
      s.async = true;
      s.onload = () => {
        try {
          window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
          resolve(window.pdfjsLib);
        } catch (e) { reject(e); }
      };
      s.onerror = () => { pdfjsPromise = null; reject(new Error('Nu s-a putut încărca vizualizatorul PDF.')); };
      document.head.appendChild(s);
    });
  }
  return pdfjsPromise;
}

// Vizualizator PDF intern (canvas + zoom). `data` = ArrayBuffer-ul PDF-ului.
function PdfCanvasViewer({ data, blobUrl, onFail }) {
  const holderRef = useRef(null);
  const pdfRef = useRef(null);
  const renderSeq = useRef(0);
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [zoom, setZoom] = useState(1);
  const [vw, setVw] = useState(0); // re-randare la rotirea ecranului

  useEffect(() => {
    let t = null;
    const onResize = () => { clearTimeout(t); t = setTimeout(() => setVw((n) => n + 1), 300); };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(t); window.removeEventListener('resize', onResize); };
  }, []);

  // Deschide documentul (o singură dată per `data`)
  useEffect(() => {
    let dead = false;
    setStatus('loading');
    (async () => {
      try {
        const pdfjs = await loadPdfJs();
        // copie: pdf.js transferă bufferul către worker (l-ar „goli" pe original)
        const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
        if (dead) { try { doc.destroy(); } catch { /* noop */ } return; }
        pdfRef.current = doc;
        setStatus('ok');
      } catch (e) {
        console.error('PdfCanvasViewer:', e);
        if (!dead) { setStatus('error'); if (onFail) onFail(); }
      }
    })();
    return () => {
      dead = true;
      renderSeq.current++;
      try { pdfRef.current?.destroy?.(); } catch { /* noop */ }
      pdfRef.current = null;
    };
  }, [data]); // eslint-disable-line

  // Redă paginile (la deschidere, zoom sau rotire)
  useEffect(() => {
    const doc = pdfRef.current;
    const holder = holderRef.current;
    if (status !== 'ok' || !doc || !holder) return;
    const seq = ++renderSeq.current;
    (async () => {
      try {
        holder.innerHTML = '';
        const cw = holder.clientWidth || window.innerWidth;
        for (let n = 1; n <= doc.numPages; n++) {
          if (seq !== renderSeq.current) return; // s-a schimbat zoomul între timp
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = ((cw - 12) / base.width) * zoom;
          const vp = page.getViewport({ scale });
          // limită de pixeli per pagină (memoria pe telefoane)
          let dpr = Math.min(window.devicePixelRatio || 1, 2);
          const MAX_PX = 4000000;
          if (vp.width * vp.height * dpr * dpr > MAX_PX) {
            dpr = Math.max(1, Math.sqrt(MAX_PX / (vp.width * vp.height)));
          }
          const canvas = document.createElement('canvas');
          canvas.width = Math.floor(vp.width * dpr);
          canvas.height = Math.floor(vp.height * dpr);
          canvas.style.width = Math.floor(vp.width) + 'px';
          canvas.style.height = Math.floor(vp.height) + 'px';
          canvas.style.display = 'block';
          canvas.style.margin = '0 auto 10px';
          canvas.style.background = '#fff';
          canvas.style.borderRadius = '4px';
          canvas.style.boxShadow = '0 2px 10px rgba(0,0,0,.35)';
          if (seq !== renderSeq.current) return;
          holder.appendChild(canvas);
          const ctx = canvas.getContext('2d');
          await page.render({
            canvasContext: ctx,
            viewport: vp,
            transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null,
          }).promise;
        }
      } catch (e) {
        if (seq === renderSeq.current) console.error('PdfCanvasViewer render:', e);
      }
    })();
  }, [status, zoom, vw]);

  const zBtn = {
    background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)',
    color: '#fff', borderRadius: 8, width: 34, height: 30, cursor: 'pointer',
    fontSize: '1rem', fontWeight: 700, lineHeight: 1,
  };

  if (status === 'error') return null; // părintele afișează varianta de rezervă

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
      {/* bara de zoom + deschidere externă (rezervă) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, padding: '6px 10px', background: 'rgba(0,0,0,0.25)', flexShrink: 0 }}>
        <button style={zBtn} onClick={() => setZoom((z) => Math.max(0.6, Math.round((z - 0.25) * 100) / 100))} aria-label="Micșorează">−</button>
        <span style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.78rem', fontWeight: 700, minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button style={zBtn} onClick={() => setZoom((z) => Math.min(3, Math.round((z + 0.25) * 100) / 100))} aria-label="Mărește">+</button>
        {blobUrl && (
          <a href={blobUrl} target="_blank" rel="noopener noreferrer"
            style={{ marginLeft: 8, color: 'rgba(255,255,255,0.55)', fontSize: '0.72rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}>
            deschide extern ↗
          </a>
        )}
      </div>
      {/* paginile */}
      <div ref={holderRef} style={{ flex: 1, minHeight: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch', padding: '8px 6px' }}>
        {status === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 40 }}>
            <div className="spinner" />
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem' }}>Se pregătește PDF-ul…</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PDFViewer() {
  const { state } = useLocation();
  const navigate = useNavigate();
  const { user, isPremium, loading: authLoading } = useAuth();
  const [blobUrl, setBlobUrl] = useState(null);
  const [pdfData, setPdfData] = useState(null);       // ArrayBuffer — viewerul intern de pe mobil
  const [viewerFailed, setViewerFailed] = useState(false); // pdf.js indisponibil → varianta veche
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mobile, setMobile] = useState(false);

  const [searchParams] = useSearchParams();
  const idParam = searchParams.get('id');
  const [item, setItem] = useState(state?.item || null);

  // ─── Profesorul Virtual lângă PDF ─────────────────────────────────────────
  const [tutorOpen, setTutorOpen] = useState(!!state?.openTutor);
  const tutorConvId = state?.tutorConvId || null;
  const [pdfText, setPdfText] = useState(null);      // textul extras din PDF
  const [pdfLoading, setPdfLoading] = useState(false);
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 800);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 800);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Înălțimea panoului pe ecrane înguste (%) — se trage de bara albastră
  const [panelPct, setPanelPct] = useState(52);
  const dragBar = useRef(null);
  function barDown(e) {
    if (!narrow) return;
    dragBar.current = { y: e.clientY, pct: panelPct };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* noop */ }
  }
  function barMove(e) {
    const d = dragBar.current;
    if (!d) return;
    e.preventDefault();
    const pct = d.pct - ((e.clientY - d.y) / window.innerHeight) * 100;
    setPanelPct(Math.max(22, Math.min(90, pct)));
  }
  function barUp(e) {
    if (!dragBar.current) return;
    dragBar.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop */ }
  }

  // Textul PDF-ului se aduce o singură dată, când elevul deschide profesorul
  useEffect(() => {
    if (!tutorOpen || !item?.id || pdfText !== null || pdfLoading) return;
    setPdfLoading(true);
    aiClient.pdfContext({ contentId: item.id })
      .then((r) => setPdfText(r?.text || ''))
      .catch(() => setPdfText(''))
      .finally(() => setPdfLoading(false));
  }, [tutorOpen, item?.id]); // eslint-disable-line

  const tutorContext = useMemo(() => ({
    pdf: true,
    category: item?.category || null,
    contentId: item?.id || null,
    title: item?.title || null,
    exerciseText: pdfText
      ? pdfText
      : (item?.title ? `Materialul PDF „${item.title}" este deschis, dar textul lui nu a putut fi citit automat (poate fi un PDF scanat). Cere-i elevului să scrie enunțul sau să îl fotografieze.` : ''),
  }), [item, pdfText]);

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
        setPdfData(buffer);
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

  // ── Butonul din bară (vizibil și pe desktop, și pe mobil) ────────────────
  const tutorBtn = (
    <button
      onClick={() => setTutorOpen((o) => !o)}
      title="Întreabă-l despre exercițiile din acest material"
      style={{
        background: tutorOpen ? 'var(--gold)' : 'rgba(232,185,49,0.15)',
        border: '1px solid var(--gold)', color: tutorOpen ? 'var(--navy)' : 'var(--gold)',
        borderRadius: 14, padding: '4px 12px', cursor: 'pointer', flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.25,
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 700 }}>
        <EinsteinIcon size={18} /> {tutorOpen ? 'Închide profesorul' : 'Profesorul virtual'}
      </span>
      {!tutorOpen && (
        <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.9 }}>
          te ajută la exercițiile din PDF
        </span>
      )}
    </button>
  );

  // ── Widgetul plutitor (rămâne vizibil în vizualizatorul de PDF) ──────────
  const tutorWidget = !tutorOpen && (
    <>
      <style>{`@keyframes pdfGlow{0%,100%{box-shadow:0 0 0 0 rgba(232,185,49,.55),0 6px 18px rgba(0,0,0,.28)}50%{box-shadow:0 0 0 12px rgba(232,185,49,0),0 6px 18px rgba(0,0,0,.28)}}`}</style>
      <div onClick={() => setTutorOpen(true)}
        style={{
          position: 'fixed', right: 24, bottom: 84, zIndex: 1500, cursor: 'pointer',
          background: 'var(--navy)', color: '#fff', fontWeight: 700, fontSize: '.76rem',
          padding: '6px 11px', borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,.25)', whiteSpace: 'nowrap',
        }}>
        Întreabă-mă orice 👇
      </div>
      <button onClick={() => setTutorOpen(true)} aria-label="Profesorul Virtual"
        style={{
          position: 'fixed', right: 24, bottom: 20, zIndex: 1500,
          width: 58, height: 58, borderRadius: '50%', border: 'none', cursor: 'pointer',
          background: 'linear-gradient(135deg, var(--gold), #f4d06f)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          animation: 'pdfGlow 2s ease-in-out infinite',
        }}>
        <EinsteinIcon size={34} />
      </button>
    </>
  );

  // ── Panoul de chat, interconectat cu PDF-ul deschis ─────────────────────
  const tutorPanel = tutorOpen && (
    <div style={{
      flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', minHeight: 0,
      ...(narrow
        ? { height: `${panelPct}%`, borderTop: '3px solid var(--gold)' }
        : { width: 400, maxWidth: '45vw', borderLeft: '3px solid var(--gold)' }),
    }}>
      <div
        onPointerDown={barDown} onPointerMove={barMove} onPointerUp={barUp} onPointerCancel={barUp}
        style={{
          background: 'var(--navy)', color: '#fff', padding: narrow ? '4px 12px 8px' : '8px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          ...(narrow ? { cursor: 'ns-resize', touchAction: 'none', position: 'relative' } : {}),
        }}>
        {narrow && (
          <div style={{
            position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
            width: 44, height: 4, borderRadius: 3, background: 'rgba(255,255,255,.45)',
          }} />
        )}
        <div style={{ fontWeight: 700, fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <EinsteinIcon size={20} /> Profesorul Virtual
        </div>
        <button onClick={() => setTutorOpen(false)}
          style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: '.78rem', fontWeight: 600 }}>
          ✕
        </button>
      </div>
      {pdfLoading && (
        <div style={{ padding: '6px 12px', fontSize: '.76rem', color: 'var(--text-muted)', background: '#fffdf5', borderBottom: '1px solid var(--border)' }}>
          📄 citesc materialul…
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatPanel compact context={tutorContext} initialConversationId={tutorConvId} />
      </div>
    </div>
  );

  // ── Mobile: PDF-ul se redă ÎN pagină (pdf.js), cu Profesorul Virtual activ ──
  // Vizualizatoarele native de pe telefon descarcă fișierul sau acoperă
  // aplicația (și profesorul dispărea). Canvas-ul intern păstrează totul la un loc.
  if (mobile && (pdfData || blobUrl)) {
    const internalViewer = pdfData && !viewerFailed;
    return (
      <div className="pdf-root" style={{ display:'flex', flexDirection:'column', background:'#1a1a2e' }}>
        <style>{`.pdf-root{height:100vh;height:100dvh}`}</style>
        <div style={barStyle}>
          <button onClick={goBack} style={backBtn}>← Înapoi</button>
          <span style={{ color:'#fff', fontWeight:600, fontSize:'0.9rem', flex:1, textAlign:'center', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            📄 {item?.title}
          </span>
          {tutorBtn}
          <span style={badge}>{item?.is_free ? 'Gratuit' : '⭐ Premium'}</span>
        </div>

        <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
          {internalViewer ? (
            <PdfCanvasViewer data={pdfData} blobUrl={blobUrl} onFail={() => setViewerFailed(true)} />
          ) : (
            <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:24, padding:32, textAlign:'center', overflowY:'auto' }}>
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
          )}

          {tutorPanel}
        </div>
        {tutorWidget}
      </div>
    );
  }

  // ── Desktop: iframe cu blob URL + Profesorul Virtual alături ─────────────
  return (
    <div className="pdf-root" style={{ display:'flex', flexDirection:'column', background:'#1a1a2e' }}>
      <style>{`.pdf-root{height:100vh;height:100dvh}`}</style>
      <div style={barStyle}>
        <button onClick={goBack} style={backBtn}>← Înapoi</button>
        <span style={{ color:'rgba(255,255,255,0.35)' }}>|</span>
        <span style={{ color:'#fff', fontWeight:600, fontSize:'0.95rem', flex:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
          📄 {item?.title}
        </span>
        {tutorBtn}
        <span style={badge}>{item?.is_free ? 'Gratuit' : '⭐ Premium'}</span>
      </div>

      <div style={{ flex:1, display:'flex', flexDirection: narrow ? 'column' : 'row', minHeight:0 }}>
        {blobUrl && (
          <iframe
            src={blobUrl}
            style={{ flex:1, border:'none', width:'100%', minHeight:0 }}
            title={item?.title}
          />
        )}
        {tutorPanel}
      </div>

      {tutorWidget}
    </div>
  );
}
