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

// Vizualizator PDF intern (canvas + zoom din butoane sau CU DOUĂ DEGETE).
// `data` = ArrayBuffer-ul PDF-ului.
const MIN_ZOOM = 0.6, MAX_ZOOM = 5;
function PdfCanvasViewer({ data, blobUrl, onFail }) {
  const holderRef = useRef(null);   // containerul cu scroll
  const pagesRef = useRef(null);    // învelișul paginilor — scalat CSS în timpul pinch-ului
  const pdfRef = useRef(null);
  const renderSeq = useRef(0);
  const pendingScroll = useRef(null); // scroll de aplicat după re-randare (păstrează punctul ciupit)
  const zoomRef = useRef(1);          // zoomul curent, citit din handlerele touch (montate o dată)
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [zoom, setZoom] = useState(1);
  const [vw, setVw] = useState(0); // re-randare la rotirea ecranului

  useEffect(() => {
    let t = null;
    const onResize = () => { clearTimeout(t); t = setTimeout(() => setVw((n) => n + 1), 300); };
    window.addEventListener('resize', onResize);
    return () => { clearTimeout(t); window.removeEventListener('resize', onResize); };
  }, []);

  // iOS Safari: oprește zoomul nativ al întregii pagini cât timp ciupești PDF-ul
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return;
    const prevent = (e) => e.preventDefault();
    el.addEventListener('gesturestart', prevent);
    el.addEventListener('gesturechange', prevent);
    return () => {
      el.removeEventListener('gesturestart', prevent);
      el.removeEventListener('gesturechange', prevent);
    };
  }, []);

  useEffect(() => { zoomRef.current = zoom; }, [zoom]);

  // ── Pinch-to-zoom (două degete) — pe evenimente TOUCH native ────────────
  // De ce touch, nu pointer events: lista `e.touches` are MEREU pozițiile
  // proaspete ale AMBELOR degete (pointer events „îngheață" un deget când
  // browserul preia derularea → direcție inversată, zoom accidental la
  // scroll), iar preventDefault() pe gestul cu două degete oprește complet
  // derularea nativă cât timp ciupești. Cu un deget derulezi normal.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder) return;
    const st = { active: false, d0: 1, zoom0: 1, scale: 1, originX: 0, originY: 0, midX: 0, midY: 0 };
    const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
    const mid = (t) => ({ x: (t[0].clientX + t[1].clientX) / 2, y: (t[0].clientY + t[1].clientY) / 2 });

    function onTouchStart(e) {
      if (e.touches.length !== 2) return;
      e.preventDefault(); // gestul cu două degete e al nostru — fără scroll/zoom nativ
      const rect = holder.getBoundingClientRect();
      const m = mid(e.touches);
      st.active = true;
      st.d0 = Math.max(30, dist(e.touches));
      st.zoom0 = zoomRef.current;
      st.scale = 1;
      st.midX = m.x; st.midY = m.y;
      // punctul ciupit, în coordonatele conținutului
      st.originX = m.x - rect.left + holder.scrollLeft;
      st.originY = m.y - rect.top + holder.scrollTop;
      const w = pagesRef.current;
      if (w) {
        w.style.transformOrigin = `${st.originX}px ${st.originY}px`;
        w.style.willChange = 'transform';
      }
    }

    function onTouchMove(e) {
      if (!st.active || e.touches.length < 2) return;
      e.preventDefault();
      const m = mid(e.touches);
      // pan cu două degete: mișcarea mijlocului dintre degete mută pagina
      holder.scrollLeft -= m.x - st.midX;
      holder.scrollTop -= m.y - st.midY;
      st.midX = m.x; st.midY = m.y;
      // scalare fluidă din CSS; desenul clar vine la ridicarea degetelor
      let s = dist(e.touches) / st.d0;
      s = Math.min(MAX_ZOOM / st.zoom0, Math.max(MIN_ZOOM / st.zoom0, s));
      st.scale = s;
      const w = pagesRef.current;
      if (w) w.style.transform = `scale(${s})`;
    }

    function onTouchEnd(e) {
      if (!st.active || e.touches.length >= 2) return;
      st.active = false;
      const w = pagesRef.current;
      const newZoom = Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, st.zoom0 * st.scale)) * 100) / 100;
      if (Math.abs(newZoom - st.zoom0) < 0.02) {
        // gest neglijabil — revenim fără re-randare
        if (w) { w.style.transform = ''; w.style.willChange = ''; }
        return;
      }
      // Scrollul care ține punctul ciupit pe loc (corect și dacă s-a făcut pan
      // în timpul gestului): left' = scroll_curent + origin·(s−1).
      pendingScroll.current = {
        left: holder.scrollLeft + st.originX * (st.scale - 1),
        top: holder.scrollTop + st.originY * (st.scale - 1),
      };
      // transformarea CSS rămâne până redesenăm (fără „săritură" vizuală)
      setZoom(newZoom);
    }

    holder.addEventListener('touchstart', onTouchStart, { passive: false });
    holder.addEventListener('touchmove', onTouchMove, { passive: false });
    holder.addEventListener('touchend', onTouchEnd, { passive: false });
    holder.addEventListener('touchcancel', onTouchEnd, { passive: false });
    return () => {
      holder.removeEventListener('touchstart', onTouchStart);
      holder.removeEventListener('touchmove', onTouchMove);
      holder.removeEventListener('touchend', onTouchEnd);
      holder.removeEventListener('touchcancel', onTouchEnd);
    };
  }, []); // eslint-disable-line

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

  // Redă paginile (la deschidere, zoom — butoane sau pinch — ori rotire).
  // În doi pași: întâi TOATE canvasele la dimensiunea finală (ca scrollul
  // să poată fi repoziționat exact pe punctul ciupit), apoi desenul.
  useEffect(() => {
    const doc = pdfRef.current;
    const holder = holderRef.current;
    const wrap = pagesRef.current;
    if (status !== 'ok' || !doc || !holder || !wrap) return;
    const seq = ++renderSeq.current;
    (async () => {
      try {
        const cw = holder.clientWidth || window.innerWidth;
        // 1) construim paginile goale, la dimensiunea finală
        const jobs = [];
        for (let n = 1; n <= doc.numPages; n++) {
          if (seq !== renderSeq.current) return; // s-a schimbat zoomul între timp
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const scale = ((cw - 12) / base.width) * zoom;
          const vp = page.getViewport({ scale });
          // limită de pixeli per pagină (memoria pe telefoane) + laturi ≤4096 (limită iOS)
          let dpr = Math.min(window.devicePixelRatio || 1, 2);
          const MAX_PX = 5000000;
          if (vp.width * vp.height * dpr * dpr > MAX_PX) {
            dpr = Math.max(0.5, Math.sqrt(MAX_PX / (vp.width * vp.height)));
          }
          dpr = Math.min(dpr, 4096 / vp.width, 4096 / vp.height);
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
          jobs.push({ page, vp, canvas, dpr });
        }
        if (seq !== renderSeq.current) return;
        // schimbăm conținutul dintr-o mișcare: scoatem scala CSS a pinch-ului
        wrap.innerHTML = '';
        jobs.forEach((j) => wrap.appendChild(j.canvas));
        wrap.style.transform = '';
        wrap.style.willChange = '';
        // 2) scrollul care ține punctul ciupit pe loc
        if (pendingScroll.current) {
          holder.scrollLeft = Math.max(0, pendingScroll.current.left);
          holder.scrollTop = Math.max(0, pendingScroll.current.top);
          pendingScroll.current = null;
        }
        // 3) desenăm paginile
        for (const j of jobs) {
          if (seq !== renderSeq.current) return;
          await j.page.render({
            canvasContext: j.canvas.getContext('2d'),
            viewport: j.vp,
            transform: j.dpr !== 1 ? [j.dpr, 0, 0, j.dpr, 0, 0] : null,
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
        <button style={zBtn} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.25) * 100) / 100))} aria-label="Micșorează">−</button>
        <span title="Poți mări și cu două degete, direct pe pagină"
          style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.78rem', fontWeight: 700, minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button style={zBtn} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.25) * 100) / 100))} aria-label="Mărește">+</button>
        {blobUrl && (
          <a href={blobUrl} target="_blank" rel="noopener noreferrer"
            style={{ marginLeft: 8, color: 'rgba(255,255,255,0.55)', fontSize: '0.72rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}>
            deschide extern ↗
          </a>
        )}
      </div>
      {/* paginile — cu un deget derulezi, cu două degete dai zoom */}
      <div
        ref={holderRef}
        style={{
          flex: 1, minHeight: 0, overflow: 'auto', WebkitOverflowScrolling: 'touch', padding: '8px 6px',
          // pan-x/pan-y: derularea cu UN deget rămâne nativă; pinch-ul cu DOUĂ
          // degete nu mai e „mâncat" de browser și ajunge la handlerele noastre
          touchAction: 'pan-x pan-y',
          overscrollBehavior: 'contain',
        }}
      >
        {status === 'loading' && (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 40 }}>
            <div className="spinner" />
            <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem' }}>Se pregătește PDF-ul…</span>
          </div>
        )}
        <div ref={pagesRef} />
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

  // iOS: tastatura poate „împinge" pagina în sus; după închiderea ei rămânea
  // aplicația deplasată, cu o zonă goală dedesubt. O readucem la poziția 0
  // (doar când nu se scrie — cât timp e focus pe input, lăsăm iOS să-l țină vizibil).
  useEffect(() => {
    let t = null;
    const reset = () => {
      clearTimeout(t);
      t = setTimeout(() => {
        const ae = document.activeElement;
        const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
        if (!typing) { try { window.scrollTo(0, 0); } catch { /* noop */ } }
      }, 120);
    };
    window.addEventListener('focusout', reset);
    window.visualViewport?.addEventListener('resize', reset);
    return () => {
      clearTimeout(t);
      window.removeEventListener('focusout', reset);
      window.visualViewport?.removeEventListener('resize', reset);
    };
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
        {/* html/body blocate cât e deschis PDF-ul: fără derulat „pe lângă" aplicație
            (zona goală albă care apărea la unele derulări pe telefon) */}
        <style>{`.pdf-root{height:100vh;height:100dvh}html,body{overflow:hidden;overscroll-behavior:none}`}</style>
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
