import { authHeaders } from '../lib/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../lib/supabase';
import { ChatPanel, TutorFab } from '../components/AITutor';
import EinsteinIcon from '../components/EinsteinIcon';
import { aiClient } from '../lib/aiClient';
import TestModeBadge from '../components/TestModeBadge';

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

// Pagina din PDF-ul deschis unde începe baremul inclus („subiecte + barem" în
// același fișier): prima pagină, de la a doua încolo, cu titlul „BAREM…".
async function findBaremPage(data) {
  if (!data) return null;
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  try {
    for (let n = 2; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const tc = await page.getTextContent();
      if (/\bBAREM(?:UL)?\b/i.test(tc.items.map((i) => i.str).join(' '))) return n;
    }
    return null;
  } finally {
    try { doc.destroy(); } catch { /* noop */ }
  }
}

// Vizualizator PDF intern (canvas + zoom din butoane sau CU DOUĂ DEGETE).
// `data` = ArrayBuffer-ul PDF-ului. `jumpTo` = { page, seq }: derulează la o
// pagină (baremul inclus în același PDF și înapoi la subiecte).
const MIN_ZOOM = 0.6, MAX_ZOOM = 5;
function PdfCanvasViewer({ data, blobUrl, onFail, jumpTo = null }) {
  const holderRef = useRef(null);   // containerul cu scroll
  const pagesRef = useRef(null);    // învelișul paginilor — scalat CSS în timpul pinch-ului
  const pdfRef = useRef(null);
  const renderSeq = useRef(0);
  const pendingScroll = useRef(null); // scroll de aplicat după re-randare (păstrează punctul ciupit)
  const zoomRef = useRef(1);          // zoomul curent, citit din handlerele touch (montate o dată)
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [zoom, setZoom] = useState(1);
  const [vw, setVw] = useState(0); // re-randare la rotirea ecranului

  // salt la o pagină; dacă paginile nu sunt încă desenate, se face după randare
  const jumpRef = useRef(null);
  function applyJump() {
    const j = jumpRef.current, holder = holderRef.current, wrap = pagesRef.current;
    const el = j && wrap && wrap.children[j.page - 1];
    if (!el || !holder) return;
    holder.scrollTop += el.getBoundingClientRect().top - holder.getBoundingClientRect().top - 8;
    jumpRef.current = null;
  }
  useEffect(() => {
    if (!jumpTo) return;
    jumpRef.current = jumpTo;
    applyJump();
  }, [jumpTo?.seq]); // eslint-disable-line

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
        applyJump(); // un salt cerut înainte să existe paginile
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
  const { user, isPremium, isAdmin, loading: authLoading } = useAuth();
  const [blobUrl, setBlobUrl] = useState(null);
  const [pdfData, setPdfData] = useState(null);       // ArrayBuffer — viewerul intern de pe mobil
  const [viewerFailed, setViewerFailed] = useState(false); // pdf.js indisponibil → varianta veche
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [mobile, setMobile] = useState(false);

  const [searchParams] = useSearchParams();
  const idParam = searchParams.get('id');
  const gtId = searchParams.get('gt');       // TEMĂ PE GRUPĂ (/tema-grupa)
  const duelId = searchParams.get('duel');   // DUEL 1-la-1 (/arena)
  // În duel, ca la testul pe grupă, Profesorul Virtual nu mai dă ajutor:
  // panoul rămâne deschis DOAR ca să poți trimite răspunsurile spre corectare
  // (la PDF-uri acolo se calculează punctajul), dar în „mod test".
  const modTest = !!gtId || !!duelId;
  const [item, setItem] = useState(state?.item || null);
  // „Grant": material premium trimis gratuit de admin printr-o temă pe grupă.
  const [grant, setGrant] = useState(state?.grant || null);

  // ─── Profesorul Virtual lângă PDF ─────────────────────────────────────────
  const [tutorOpen, setTutorOpen] = useState(!!state?.openTutor);
  // ✍️ Spațiul de lucru se deschide ÎN zona de conversație a profesorului
  // (butonul e în antetul panoului), nu ca fereastră peste PDF
  const [workOpen, setWorkOpen] = useState(false);
  const [tutorWide, setTutorWide] = useState(false); // fereastră mărită (doar pe desktop)
  const tutorConvId = state?.tutorConvId || null;
  const [pdfText, setPdfText] = useState(null);      // textul extras din PDF
  const [pdfFileName, setPdfFileName] = useState(null); // numele original al fișierului testului
  const [barem, setBarem] = useState(null);          // {id, title, text, fileName, matchedBy, evidence} — baremul asociat testului
  const [baremStatus, setBaremStatus] = useState(null); // 'este_barem' = PDF-ul deschis e chiar un barem
  const [pdfLoading, setPdfLoading] = useState(false);
  // Admin (Etapa 2, 3.1): alegerea manuală a baremului pentru acest test
  const [baremPick, setBaremPick] = useState({ open: false, loading: false, candidates: [], override: null, choice: '', saving: false, msg: null });
  const [narrow, setNarrow] = useState(typeof window !== 'undefined' && window.innerWidth < 800);
  // Telefon (sub 520 px): bara de sus se strânge — butoanele pe un rând, fără
  // subtitlu, fără eticheta Gratuit/Premium. Altfel bara ieșea din ecran
  // (≈490 px de conținut): titlul dispărea, iar eticheta se tăia.
  const [tiny, setTiny] = useState(typeof window !== 'undefined' && window.innerWidth < 520);
  useEffect(() => {
    const onResize = () => { setNarrow(window.innerWidth < 800); setTiny(window.innerWidth < 520); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // DUEL pe un test PDF: cronometrul pornește pe server la deschiderea testului,
  // exact ca la exercițiile interactive. Fără asta, egalitățile de procent
  // rămâneau remize, pentru că niciunul dintre timpi nu era măsurat.
  useEffect(() => {
    if (!duelId || !user) return;
    aiClient.duel({ action: 'start', id: duelId }).catch(() => {});
  }, [duelId, user]);

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

  // Textul PDF-ului (+ baremul asociat) se aduce o singură dată: când elevul
  // deschide profesorul, apasă „📋 Barem" sau, pentru un cont logat, la scurt
  // timp după ce s-a încărcat PDF-ul (serverul îl ține în cache — ai_pdf_text).
  // Din nou după ce adminul schimbă baremul asociat.
  // Întoarce { barem, baremStatus } (null la eroare).
  const ctxPromiseRef = useRef(null);
  const ctxFailedRef = useRef(false);
  function loadPdfContext() {
    if (!item?.id) return Promise.resolve(null);
    if (ctxPromiseRef.current) return ctxPromiseRef.current;
    setPdfLoading(true);
    const p = aiClient.pdfContext({ contentId: item.id })
      .then((r) => {
        ctxFailedRef.current = false;
        setPdfText(r?.text || '');
        setPdfFileName(r?.fileName || null);
        setBaremStatus(r?.baremStatus || null);
        // baremul asociat (BAC sau Evaluare Națională) + dovada potrivirii:
        // metadate (titlu/fișier), antetul PDF-urilor (an + variantă), conținut,
        // „inclus" (subiecte + barem în același fișier) sau „admin" (asociat manual)
        const b = r?.baremText && r?.barem
          ? { id: r.barem.id || null, title: r.barem.title || 'Barem', text: r.baremText, fileName: r.barem.fileName || null, matchedBy: r.barem.matchedBy || null, evidence: r.barem.evidence || null }
          : null;
        setBarem(b);
        return { barem: b, baremStatus: r?.baremStatus || null };
      })
      .catch(() => { ctxFailedRef.current = true; setPdfText(''); return null; })
      .finally(() => { setPdfLoading(false); ctxPromiseRef.current = null; });
    ctxPromiseRef.current = p;
    return p;
  }
  useEffect(() => {
    // (după o încercare eșuată — de ex. cea de la încărcare — profesorul mai încearcă o dată)
    if (!tutorOpen || !item?.id || (pdfText !== null && !ctxFailedRef.current) || pdfLoading) return;
    loadPdfContext();
  }, [tutorOpen, item?.id]); // eslint-disable-line
  // Cont logat: contextul se aduce și fără profesor deschis, ca „📋 Barem" să
  // știe din prima dacă există barem (și profesorul să pornească imediat).
  // Nu și în test/duel — acolo butonul de barem nu există.
  useEffect(() => {
    if (!user || modTest || loading || !item?.id || pdfText !== null) return;
    const t = setTimeout(() => { loadPdfContext(); }, 900);
    return () => clearTimeout(t);
  }, [user, modTest, loading, item?.id]); // eslint-disable-line

  // Admin: deschide lista de bareme-candidat din aceeași categorie
  async function openBaremPick() {
    if (baremPick.open) { setBaremPick((b) => ({ ...b, open: false, msg: null })); return; }
    setBaremPick((b) => ({ ...b, open: true, loading: true, msg: null }));
    try {
      const r = await aiClient.pdfBaremCandidates({ contentId: item.id });
      const override = r?.current?.override || null;
      setBaremPick((b) => ({ ...b, loading: false, candidates: r?.candidates || [], override, choice: override || (r?.current?.barem?.id || '') }));
    } catch (e) { setBaremPick((b) => ({ ...b, loading: false, msg: 'Eroare: ' + e.message })); }
  }
  // Admin: salvează asocierea (baremId=null → înapoi la potrivirea automată)
  async function saveBaremPick(baremId) {
    setBaremPick((b) => ({ ...b, saving: true, msg: null }));
    try {
      await aiClient.pdfSetBarem({ contentId: item.id, baremId });
      setBaremPick((b) => ({ ...b, saving: false, open: false, override: baremId || null, msg: null }));
      setPdfText(null); // reîncărcăm textul + baremul (serverul a pus noul barem în cache)
      loadPdfContext();
    } catch (e) { setBaremPick((b) => ({ ...b, saving: false, msg: 'Eroare: ' + e.message })); }
  }

  // ── „📋 Barem": baremul asociat se deschide ÎN LOCUL subiectelor ────────────
  // Butonul din bară (unde era „✍️ Spațiu de lucru", mutat acum în antetul
  // Profesorului Virtual). Baremul separat se descarcă o dată (get-file-url —
  // aceleași reguli de acces ca la orice PDF) și se arată în același
  // vizualizator, cu profesorul alături; un nou clic → înapoi la subiecte.
  // Baremul inclus în același PDF („subiecte + barem") → saltul la pagina lui.
  // În testul pe grupă și în duel butonul NU există: baremul = răspunsurile.
  const [baremView, setBaremView] = useState({ open: false, status: 'idle', data: null, url: null, forId: null, inclus: false, page: 1, seq: 0 });
  const [baremFailed, setBaremFailed] = useState(false); // pdf.js n-a putut desena baremul (telefon)
  const [note, setNote] = useState(null);                // { text, link? } — mesaj scurt sub bară
  const baremUrlRef = useRef(null);
  const baremPageRef = useRef(null);                     // pagina baremului inclus (căutată o dată)
  useEffect(() => () => { if (baremUrlRef.current) URL.revokeObjectURL(baremUrlRef.current); }, []);
  useEffect(() => {
    if (!note) return undefined;
    const t = setTimeout(() => setNote(null), 6000);
    return () => clearTimeout(t);
  }, [note]);
  // adminul a schimbat baremul asociat → cel descărcat nu mai e bun
  useEffect(() => {
    setBaremView((v) => (v.forId && v.forId !== (barem?.id || null)
      ? { ...v, open: false, status: 'idle', data: null, url: null, forId: null }
      : v));
  }, [barem?.id]);
  // PDF-ul deschis e chiar un barem → butonul n-are rost (după subcategorie sau
  // după verdictul serverului; titlul singur nu ajunge: „subiecte + barem")
  const isBaremItem = item?.subcategory === 'bareme';
  const showBaremBtn = !modTest && !isBaremItem && baremStatus !== 'este_barem';

  async function toggleBarem() {
    if (baremView.open) {
      // înapoi la subiecte (la baremul inclus: înapoi la prima pagină)
      setBaremView((v) => ({ ...v, open: false, status: v.status === 'loading' ? 'idle' : v.status, page: 1, seq: v.seq + 1 }));
      return;
    }
    if (baremView.status === 'loading') return;
    if (!user) {
      setNote({ text: 'Autentifică-te ca să deschizi baremul acestui test.', link: { to: '/autentificare', label: 'Autentificare' } });
      return;
    }
    let b = barem;
    if (pdfText === null || pdfLoading || ctxFailedRef.current) {
      setBaremView((v) => ({ ...v, status: 'loading' }));
      const r = await loadPdfContext();
      if (!r) {
        setBaremView((v) => ({ ...v, status: 'idle' }));
        setNote({ text: 'Nu am putut căuta baremul acum. Încearcă din nou peste câteva secunde.' });
        return;
      }
      b = r.barem;
    }
    if (!b || !b.id) {
      setBaremView((v) => ({ ...v, status: 'idle' }));
      setNote({ text: 'Nu am găsit baremul acestui test.' });
      return;
    }
    // baremul e în ACELAȘI PDF, după subiecte → sărim la pagina lui
    if (b.matchedBy === 'inclus' || b.id === item?.id) {
      setBaremView((v) => ({ ...v, status: 'loading' }));
      let page = baremPageRef.current;
      if (!page) {
        try { page = await findBaremPage(pdfData); } catch { page = null; }
        baremPageRef.current = page;
      }
      if (!page) {
        setBaremView((v) => ({ ...v, status: 'idle' }));
        setNote({ text: 'Baremul e inclus în acest PDF, după subiecte — derulează până la el.' });
        return;
      }
      setBaremView((v) => ({ ...v, open: true, status: 'ok', inclus: true, page, seq: v.seq + 1 }));
      setNote({ text: `📋 Baremul e în același PDF și începe la pagina ${page}.` });
      return;
    }
    if (baremView.forId === b.id && baremView.data) {
      setBaremView((v) => ({ ...v, open: true, status: 'ok', inclus: false }));
      return;
    }
    setBaremFailed(false);
    setBaremView((v) => ({ ...v, open: true, status: 'loading', inclus: false }));
    try {
      const res = await fetch('/api/get-file-url', {
        method: 'POST', headers: await authHeaders(), body: JSON.stringify({ contentId: b.id }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(d.error || `HTTP ${res.status}`); e.status = res.status; throw e; }
      const resp = await fetch(d.url);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buf = await resp.arrayBuffer();
      if (baremUrlRef.current) URL.revokeObjectURL(baremUrlRef.current);
      const url = URL.createObjectURL(new Blob([buf], { type: 'application/pdf' }));
      baremUrlRef.current = url;
      // dacă elevul a apăsat între timp „înapoi la subiecte", rămâne acolo
      setBaremView((v) => ({ ...v, status: 'ok', data: buf, url, forId: b.id, inclus: false }));
    } catch (e) {
      setBaremView((v) => ({ ...v, open: false, status: 'idle' }));
      setNote(e.status === 403
        ? { text: 'Baremul acestui test face parte din abonament.', link: { to: '/preturi', label: 'Vezi abonamentele' } }
        : { text: 'Nu am putut deschide baremul. Încearcă din nou.' });
    }
  }

  // ✍️ Spațiul de lucru (în zona de conversație). Pe desktop, panoul se lățește
  // cât e deschis (o foaie de 400 px e prea îngustă) și revine la închidere.
  const wideBeforeWorkRef = useRef(null);
  function setWork(next) {
    if (next === workOpen) return;
    if (!narrow) {
      if (next) { wideBeforeWorkRef.current = tutorWide; setTutorWide(true); }
      else if (wideBeforeWorkRef.current !== null) { setTutorWide(wideBeforeWorkRef.current); wideBeforeWorkRef.current = null; }
    }
    setWorkOpen(next);
  }

  const tutorContext = useMemo(() => ({
    pdf: true,
    category: item?.category || null,
    contentId: item?.id || null,
    title: item?.title || null,
    // formularul „Răspunde în chat" pornește doar dacă textul testului e citibil
    pdfReadable: !!(pdfText && pdfText.trim().length > 80),
    exerciseText: pdfText
      ? pdfText
      : (item?.title ? `Materialul PDF „${item.title}" este deschis, dar textul lui nu a putut fi citit automat (poate fi un PDF scanat). Cere-i elevului să scrie enunțul sau să îl fotografieze.` : ''),
    fileName: pdfFileName,               // numele original al fișierului testului
    baremText: barem?.text || null,
    baremTitle: barem?.title || null,
    baremFileName: barem?.fileName || null, // numele original al fișierului baremului
  }), [item, pdfText, pdfFileName, barem]);

  useEffect(() => {
    if (item || !idParam) return;
    (async () => {
      const { data } = await supabase.from('content').select('*').eq('id', idParam).single();
      if (data) { setItem(data); return; }
      // Temă pe grupă cu PDF premium dat gratuit: rândul nu trece de RLS,
      // deci îl aducem de pe server (cu grant).
      if (gtId) {
        try {
          const r = await aiClient.groupAssignmentPick({ pickId: gtId });
          if (r?.target?.item) { setItem(r.target.item); setGrant(r.target.grant || null); return; }
        } catch { /* cade pe mesajul de mai jos */ }
      }
      setError('Materialul nu a fost găsit.'); setLoading(false);
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
    if (!item.is_free && !isPremium && !isAdmin && !grant) { navigate('/preturi'); return; }

    let createdUrl = null; // pt. revocarea CORECTĂ a blob-ului în cleanup
    async function load() {
      try {
        // Semnăm TOT (gratuit + premium) prin get-file-url — funcționează și pe
        // bucket privat, deci nu mai depindem de URL-uri publice brute.
        const res = await fetch('/api/get-file-url', {
          method: 'POST',
          headers: await authHeaders(),
          body: JSON.stringify({ contentId: item.id, grant }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        const url = data.url;

        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const buffer = await response.arrayBuffer();
        const blob = new Blob([buffer], { type: 'application/pdf' });
        const localUrl = URL.createObjectURL(blob);
        createdUrl = localUrl;
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
      // revocăm URL-ul CHIAR creat (starea blobUrl e încă null când rulează efectul)
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [authLoading, item, isPremium, isAdmin, grant]);

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
    padding: tiny ? '8px 10px' : '10px 20px', background:'var(--navy)', flexShrink:0,
    boxShadow:'0 2px 8px rgba(0,0,0,0.3)', gap: tiny ? 8 : 12,
  };

  const backBtn = {
    background:'rgba(255,255,255,0.1)', border:'1px solid rgba(255,255,255,0.2)',
    color:'#fff', borderRadius:6, padding: tiny ? '6px 10px' : '6px 14px', cursor:'pointer',
    fontSize:'0.85rem', fontWeight:600, whiteSpace:'nowrap', flexShrink:0,
  };

  const badge = {
    fontSize:'0.75rem', fontWeight:700, padding:'4px 12px', borderRadius:20,
    background: item?.is_free ? 'rgba(39,174,96,0.2)' : 'rgba(232,185,49,0.2)',
    color: item?.is_free ? '#27ae60' : 'var(--gold)',
    border:`1px solid ${item?.is_free ? 'rgba(39,174,96,0.3)' : 'rgba(232,185,49,0.3)'}`,
    whiteSpace:'nowrap',
  };
  // butonul mic de admin din rândul cu baremul (⚙ barem)
  const adminBtn = {
    background:'#fff', border:'1px solid var(--border)', color:'var(--navy)', borderRadius:6,
    padding:'2px 8px', cursor:'pointer', fontSize:'.7rem', fontWeight:600, whiteSpace:'nowrap', flexShrink:0,
  };

  // ── Butonul din bară (vizibil și pe desktop, și pe mobil) ────────────────
  // TEST PE GRUPĂ (?gt=…): Profesorul Virtual e oprit — nu se pot pune întrebări.
  // Panoul rămâne totuși de deschis pentru „📝 Răspunde în chat": la testele
  // PDF formularul de răspuns e chiar modul în care punctajul ajunge la profesor.
  const tutorBtn = (
    <button
      onClick={() => setTutorOpen((o) => !o)}
      title={modTest ? 'Completează răspunsurile la test' : 'Întreabă-l despre exercițiile din acest material'}
      style={{
        background: tutorOpen ? 'var(--gold)' : 'rgba(232,185,49,0.15)',
        border: '1px solid var(--gold)', color: tutorOpen ? 'var(--navy)' : 'var(--gold)',
        borderRadius: 14, padding: tiny ? '4px 10px' : '4px 12px', cursor: 'pointer', flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.25,
        ...(tiny ? { minHeight: 32, justifyContent: 'center' } : {}),
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {modTest ? '📝' : <EinsteinIcon size={18} />}{' '}
        {tutorOpen ? 'Închide' : modTest ? 'Răspunde la test' : 'Profesorul virtual'}
      </span>
      {!tutorOpen && !tiny && (
        <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.9 }}>
          {modTest ? 'trimiți răspunsurile spre corectare' : 'te ajută la exercițiile din PDF'}
        </span>
      )}
    </button>
  );

  // ── „📋 Barem" în bară — locul fostului „✍️ Spațiu de lucru" ──────────────
  const baremLoading = baremView.status === 'loading';
  const baremBtn = showBaremBtn && (
    <button
      onClick={toggleBarem}
      aria-pressed={baremView.open}
      title={baremView.open ? 'Înapoi la subiectele testului' : 'Deschide baremul oficial asociat acestui test'}
      style={{
        background: baremView.open ? 'rgba(255,255,255,0.92)' : 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(255,255,255,0.3)',
        color: baremView.open ? 'var(--navy)' : '#fff', borderRadius: 14, padding: tiny ? '4px 10px' : '4px 12px',
        cursor: baremLoading && !baremView.open ? 'progress' : 'pointer', flexShrink: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1, lineHeight: 1.25,
        ...(tiny ? { minHeight: 32, justifyContent: 'center' } : {}),
      }}
    >
      <span style={{ fontSize: '0.82rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
        {baremView.open ? '📄 Subiectele' : baremLoading ? '⏳ Barem…' : '📋 Barem'}
      </span>
      {!tiny && (
        <span style={{ fontSize: '0.62rem', fontWeight: 600, opacity: 0.8, whiteSpace: 'nowrap' }}>
          {baremView.open ? 'înapoi la test' : 'deschide baremul'}
        </span>
      )}
    </button>
  );
  const badgeJsx = !tiny && <span style={badge}>{item?.is_free ? 'Gratuit' : '⭐ Premium'}</span>;

  // Baremul separat, în locul subiectelor (testul rămâne încărcat dedesubt,
  // ascuns — la întoarcere e exact unde l-ai lăsat)
  const showBaremDoc = baremView.open && !baremView.inclus;
  const baremPane = showBaremDoc && (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column', background: '#1a1a2e' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', flexShrink: 0,
        background: '#f0f9f1', color: '#1e7e34', borderBottom: '1px solid #cfe8d4', fontSize: '.78rem', fontWeight: 700,
      }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          📋 Barem: {barem?.title || 'baremul testului'}
        </span>
        <button type="button" onClick={toggleBarem}
          style={{ background: '#fff', border: '1px solid #cfe8d4', color: 'var(--navy)', borderRadius: 8, padding: '3px 10px', fontSize: '.74rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
          📄 Înapoi la subiecte
        </button>
      </div>
      {baremLoading || !baremView.data ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div className="spinner" />
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.85rem' }}>Se încarcă baremul…</span>
        </div>
      ) : !mobile ? (
        <iframe src={baremView.url} title={barem?.title || 'Barem'} style={{ flex: 1, border: 'none', width: '100%', minHeight: 0 }} />
      ) : !baremFailed ? (
        <PdfCanvasViewer key={baremView.forId} data={baremView.data} blobUrl={baremView.url} onFail={() => setBaremFailed(true)} />
      ) : (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 18, padding: 24, textAlign: 'center' }}>
          <div style={{ fontSize: '3rem' }}>📋</div>
          <a href={baremView.url} target="_blank" rel="noopener noreferrer"
            style={{ display: 'inline-block', padding: '12px 28px', background: 'var(--gold)', color: 'var(--navy-dark)', borderRadius: 10, fontWeight: 700, textDecoration: 'none' }}>
            📂 Deschide baremul
          </a>
        </div>
      )}
    </div>
  );

  // Mesajul scurt de sub bară (barem negăsit, abonament, autentificare)
  const noteJsx = note && (
    <div role="status" style={{
      position: 'fixed', top: 70, left: '50%', transform: 'translateX(-50%)', zIndex: 1600,
      background: '#fff', color: 'var(--navy)', borderRadius: 10, padding: '9px 12px 9px 14px',
      boxShadow: '0 8px 28px rgba(0,0,0,.35)', fontSize: '.84rem', fontWeight: 600, lineHeight: 1.4,
      width: 'max-content', maxWidth: 'min(92vw, 460px)', display: 'flex', alignItems: 'center', gap: 10,
    }}>
      <span>{note.text}</span>
      {note.link && (
        <Link to={note.link.to} style={{ background: 'var(--gold)', color: 'var(--navy)', borderRadius: 7, padding: '4px 10px', fontWeight: 700, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          {note.link.label}
        </Link>
      )}
      <button type="button" onClick={() => setNote(null)} aria-label="Închide mesajul"
        style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '.9rem', padding: '0 2px' }}>✕</button>
    </div>
  );

  // Testul deschis: la baremul inclus în același PDF, vizualizatorul sare la
  // pagina baremului și înapoi (pe desktop, iframe-ul se reîncarcă la #page=N)
  const testJump = baremView.inclus ? { page: baremView.open ? baremView.page : 1, seq: baremView.seq } : null;
  const testSrc = blobUrl && testJump ? `${blobUrl}#page=${testJump.page}` : blobUrl;
  const testKey = testJump ? `test-${testJump.seq}` : 'test';

  // ── Widgetul plutitor (vizibil în vizualizatorul de PDF; se poate MUTA) ──
  const tutorWidget = !tutorOpen && !modTest && <TutorFab onOpen={() => setTutorOpen(true)} />;

  // ── Panoul de chat, interconectat cu PDF-ul deschis ─────────────────────
  const tutorPanel = tutorOpen && (
    <div style={{
      flexShrink: 0, display: 'flex', flexDirection: 'column', background: '#fff', minHeight: 0,
      ...(narrow
        ? { height: `${panelPct}%`, borderTop: '3px solid var(--gold)' }
        : tutorWide
        ? { width: 'min(900px, 75vw)', maxWidth: '75vw', borderLeft: '3px solid var(--gold)' }
        : { width: 400, maxWidth: '45vw', borderLeft: '3px solid var(--gold)' }),
    }}>
      <div
        onPointerDown={barDown} onPointerMove={barMove} onPointerUp={barUp} onPointerCancel={barUp}
        style={{
          background: 'var(--navy)', color: '#fff', padding: narrow ? '4px 12px 8px' : '8px 12px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
          ...(narrow ? { cursor: 'ns-resize', touchAction: 'none', position: 'relative', userSelect: 'none', WebkitUserSelect: 'none' } : {}),
        }}>
        {narrow && (
          <div style={{
            position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
            width: 44, height: 4, borderRadius: 3, background: 'rgba(255,255,255,.45)',
          }} />
        )}
        <div style={{ fontWeight: 700, fontSize: '.9rem', display: 'flex', alignItems: 'center', gap: 6, flex: 1, minWidth: 0 }}>
          {modTest ? <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>📝 Răspunsurile tale</span>
            : <><EinsteinIcon size={20} /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Profesorul Virtual</span></>}
        </div>
        {/* Butoanele din antet nu pornesc tragerea panoului (pe telefon antetul e
            mânerul): fără stopPropagation, captura pointerului lua clicul butonului */}
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }} onPointerDown={(e) => e.stopPropagation()}>
          {/* ✍️ SPAȚIUL DE LUCRU — se deschide chiar aici, în zona de conversație
              (foaie goală, ca zona conversației, fără linii). Rămâne și în test:
              e ciorna elevului, nu ajutor de la AI. */}
          {user && (
            <button onClick={() => setWork(!workOpen)}
              aria-pressed={workOpen}
              title={workOpen ? 'Înapoi la conversație' : 'Scrie rezolvarea cu degetul sau cu creionul, aici — apoi o transformi în text'}
              style={{
                background: workOpen ? 'var(--gold)' : 'rgba(232,185,49,0.15)', border: '1px solid var(--gold)',
                color: workOpen ? 'var(--navy)' : 'var(--gold)', borderRadius: 14, padding: '3px 11px',
                cursor: 'pointer', fontSize: '.78rem', fontWeight: 700, whiteSpace: 'nowrap', lineHeight: 1.3,
              }}>
              {workOpen ? '💬 Conversația' : '✍️ Spațiu de lucru'}
            </button>
          )}
          {/* Mărire/micșorare fereastră — doar pe desktop (pe mobil se trage de bară) */}
          {!narrow && (
            <button onClick={() => { wideBeforeWorkRef.current = null; setTutorWide((w) => !w); }}
              title={tutorWide ? 'Micșorează fereastra' : 'Mărește fereastra'}
              aria-label={tutorWide ? 'Micșorează fereastra profesorului' : 'Mărește fereastra profesorului'}
              style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: '.82rem', fontWeight: 600, lineHeight: 1.2 }}>
              {tutorWide ? '❐' : '□'}
            </button>
          )}
          <button onClick={() => setTutorOpen(false)}
            style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.2)', color: '#fff', borderRadius: 6, padding: '3px 10px', cursor: 'pointer', fontSize: '.78rem', fontWeight: 600 }}>
            ✕
          </button>
        </div>
      </div>
      {pdfLoading && (
        <div style={{ padding: '6px 12px', fontSize: '.76rem', color: 'var(--text-muted)', background: '#fffdf5', borderBottom: '1px solid var(--border)' }}>
          📄 citesc materialul…
        </div>
      )}
      {!pdfLoading && barem && (
        <div title={[
          'Explicațiile și răspunsurile se dau pe baza acestui barem oficial',
          barem.fileName && barem.matchedBy !== 'inclus' ? `(fișier: ${barem.fileName})` : '',
          barem.evidence ? `— potrivire: ${barem.evidence}` : '',
          barem.matchedBy ? `[${{ inclus: 'baremul e în același PDF', metadate: 'titlu + numele fișierului', 'metadate+antet': 'titlu/fișier, confirmate de antetul PDF-urilor', 'metadate+continut': 'titlu/fișier, confirmate de conținut', antet: 'antetul PDF-urilor (an + variantă)', 'antet+continut': 'antetul PDF-urilor + conținut', continut: 'conținutul (numerele din enunțuri)', admin: 'asociat manual de administrator' }[barem.matchedBy] || barem.matchedBy}]` : '',
        ].filter(Boolean).join(' ')}
          style={{ padding: '5px 12px', fontSize: '.74rem', fontWeight: 600, color: '#1e7e34', background: '#f0f9f1', borderBottom: '1px solid var(--border)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
            📋 Barem asociat: {barem.matchedBy === 'inclus' ? 'inclus în acest PDF' : barem.title}
            {barem.evidence && barem.matchedBy !== 'inclus' ? <span style={{ fontWeight: 400, color: '#2d7a3a' }}> · {barem.evidence}</span> : null}
          </span>
          {isAdmin && <button type="button" onClick={openBaremPick} title="Admin: alege manual baremul acestui test" style={adminBtn}>⚙ barem</button>}
        </div>
      )}
      {/* Admin: testul n-are barem asociat automat → poate fi ales manual */}
      {!pdfLoading && !barem && isAdmin && pdfText !== null && (
        <div style={{ padding: '5px 12px', fontSize: '.74rem', fontWeight: 600, color: '#8a6d1a', background: '#fffbea', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ flex: 1 }}>📋 Fără barem asociat (doar adminii văd acest rând)</span>
          <button type="button" onClick={openBaremPick} title="Admin: alege manual baremul acestui test" style={adminBtn}>⚙ asociază barem</button>
        </div>
      )}
      {/* Admin: lista de bareme-candidat (aceeași categorie) — asocierea se salvează pe server (ai_pdf_text.barem_override_id) */}
      {isAdmin && baremPick.open && (
        <div style={{ padding: '8px 12px', fontSize: '.76rem', background: '#f7f9fc', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {baremPick.loading ? <span style={{ color: 'var(--text-muted)' }}>caut baremele din categorie…</span> : (
            <>
              <select value={baremPick.choice} onChange={(e) => setBaremPick((b) => ({ ...b, choice: e.target.value }))}
                style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '5px 7px', fontSize: '.76rem' }}>
                <option value="">— alege baremul (PDF din aceeași categorie) —</option>
                {baremPick.candidates.map((c) => <option key={c.id} value={c.id}>{c.isBarem ? '📋 ' : '📄 '}{c.title}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <button type="button" disabled={baremPick.saving || !baremPick.choice} onClick={() => saveBaremPick(baremPick.choice)} className="btn btn-primary" style={{ padding: '4px 10px', fontSize: '.74rem' }}>
                  {baremPick.saving ? 'Salvez…' : '✓ Folosește acest barem'}
                </button>
                <button type="button" disabled={baremPick.saving || !baremPick.override} onClick={() => saveBaremPick(null)} className="btn btn-outline" style={{ padding: '4px 10px', fontSize: '.74rem' }}
                  title="Șterge asocierea manuală; serverul potrivește din nou automat">↺ Automat</button>
                <span style={{ color: 'var(--text-muted)' }}>{baremPick.override ? 'asociere manuală activă' : 'potrivire automată'}</span>
              </div>
              {baremPick.msg && <span style={{ color: '#b71c1c' }}>{baremPick.msg}</span>}
            </>
          )}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        <ChatPanel compact context={tutorContext} initialConversationId={tutorConvId} testMode={modTest}
          workspace={{
            open: workOpen,
            onClose: () => setWork(false),
            title: item?.title || '',
            hint: (pdfText || '').slice(0, 700),
            // aceeași ciornă ca până acum (fereastra veche folosea aceeași cheie)
            storageKey: `pdf:${item?.id || 'material'}`,
          }} />
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
          {gtId && <TestModeBadge compact />}
          {duelId && (
            <span style={{
              background: 'rgba(232,185,49,0.16)', border: '1px solid var(--gold)', color: 'var(--gold)',
              borderRadius: 12, padding: '3px 10px', fontSize: '0.74rem', fontWeight: 800, whiteSpace: 'nowrap',
            }} title="Duel: Profesorul Virtual nu dă indicii">⚔️ DUEL</span>
          )}
          {baremBtn}
          {tutorBtn}
          {badgeJsx}
        </div>

        <div style={{ flex:1, minHeight:0, display:'flex', flexDirection:'column' }}>
          {/* subiectele rămân încărcate (doar ascunse) cât se vede baremul */}
          <div style={{ flex:1, minHeight:0, display: showBaremDoc ? 'none' : 'flex', flexDirection:'column' }}>
          {internalViewer ? (
            <PdfCanvasViewer data={pdfData} blobUrl={blobUrl} onFail={() => setViewerFailed(true)} jumpTo={testJump} />
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
          </div>
          {baremPane}

          {tutorPanel}
        </div>
        {tutorWidget}
        {noteJsx}
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
        {gtId && <TestModeBadge compact />}
        {baremBtn}
        {tutorBtn}
        {badgeJsx}
      </div>

      <div style={{ flex:1, display:'flex', flexDirection: narrow ? 'column' : 'row', minHeight:0 }}>
        {blobUrl && (
          <iframe
            key={testKey}
            src={testSrc}
            style={{ flex:1, border:'none', width:'100%', minHeight:0, display: showBaremDoc ? 'none' : 'block' }}
            title={item?.title}
          />
        )}
        {baremPane}
        {tutorPanel}
      </div>

      {tutorWidget}
      {noteJsx}
    </div>
  );
}
