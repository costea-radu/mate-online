// =====================================================================
// src/components/PdfCanvasViewer.jsx — vizualizatorul PDF al site-ului:
// paginile desenate cu pdf.js pe <canvas>, cu zoom din butoane sau CU DOUĂ
// DEGETE. (Mutat din src/pages/PDFViewer.jsx pe 4 nov. 2026.)
//
// Unde se folosește:
//  • pe telefon (vizualizatoarele native descarcă fișierul sau acoperă
//    aplicația, iar Profesorul Virtual dispărea);
//  • pe TABLELE INTERACTIVE și pe orice browser fără vizualizator PDF (Samsung
//    Flip cu Tizen, tablele cu Android — „file format unsupported" în iframe):
//    src/lib/pdfjs.js → pdfInlineSupport(); și oricând, la cerere — butonul
//    „🖥️ Vizualizator ExamenMate" din bara PDF-ului;
//  • în fereastra PDF de peste pagină (src/components/PdfOverlay.jsx).
//
// Pe ecranele mari (tablele: 65"–86", 4K) paginile se desenează DOAR când ajung
// aproape de ecran și se eliberează când se depărtează (IntersectionObserver):
// înainte, toate paginile aveau pânza alocată de la început — zeci de MB pe
// pagină la lățimea unei table, prea mult pentru browserele lor.
//
// Props: data (ArrayBuffer), blobUrl (pentru „deschide extern"), onFail,
//        jumpTo = { page, seq } (salt la o pagină — baremul inclus și înapoi),
//        dark (fundal închis, implicit da).
//   „✏️ Rezolvă pe PDF" (7 nov. 2026 — src/components/RezolvarePdf.jsx):
//        overlay = ({ n, w, h }) => ReactNode — stratul de deasupra paginii n (w × h
//                  = mărimea paginii în puncte), desenat într-un <div> peste pânză;
//        toolbar = { left, right, compact } — butoanele modului, în bara de zoom (compact: telefon);
//        footer  = ce apare după ultima pagină („✅ Am terminat — Corectează").
// =====================================================================
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadPdfJs } from '../lib/pdfjs';

const MIN_ZOOM = 0.4, MAX_ZOOM = 5;
const MAX_PX = 5000000;           // pixeli per pagină (memoria telefoanelor / tablelor)
const KEEP_DRAWN = 8;             // câte pagini desenate păstrăm în memorie, cel mult
const FIT_KEY = 'pdf:potrivire';  // 'width' (lățimea paginii) | 'page' (pagina întreagă)

function readFit() {
  try { return localStorage.getItem(FIT_KEY) === 'page' ? 'page' : 'width'; } catch { return 'width'; }
}

export default function PdfCanvasViewer({ data, blobUrl, onFail, jumpTo = null, overlay = null, toolbar = null, footer = null }) {
  const holderRef = useRef(null);   // containerul cu scroll
  const pagesRef = useRef(null);    // învelișul paginilor — scalat CSS în timpul pinch-ului
  const pdfRef = useRef(null);
  const renderSeq = useRef(0);
  const pendingScroll = useRef(null); // scroll de aplicat după re-randare (păstrează punctul ciupit)
  const zoomRef = useRef(1);          // zoomul curent, citit din handlerele touch (montate o dată)
  const slotsRef = useRef([]);        // paginile: { n, page, vp, dpr, el, canvas, task, drawnAt }
  const ioRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ok | error
  const [zoom, setZoom] = useState(1);
  const [fit, setFit] = useState(readFit);
  const fitRef = useRef(fit);
  fitRef.current = fit;
  const [vw, setVw] = useState(0); // re-randare la rotirea ecranului / redimensionarea panoului
  const [pageInfo, setPageInfo] = useState({ cur: 1, total: 0 });
  // straturile de deasupra paginilor (portaluri React în <div>-ul fiecărei pagini)
  const [ovs, setOvs] = useState({ seq: 0, list: [] });

  // salt la o pagină; dacă paginile nu sunt încă așezate, se face după randare
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

  // re-randare la redimensionare: și a ferestrei, și a panoului (profesorul
  // deschis / lățit lângă PDF schimbă lățimea paginii)
  useEffect(() => {
    let t = null;
    const holder = holderRef.current;
    // mărimea de acum nu e o schimbare (altfel paginile s-ar așeza de două ori la deschidere)
    let lastW = holder ? holder.clientWidth : 0, lastH = holder ? holder.clientHeight : 0;
    const bump = () => { clearTimeout(t); t = setTimeout(() => setVw((n) => n + 1), 250); };
    const ro = typeof ResizeObserver !== 'undefined' && holder ? new ResizeObserver(() => {
      const w = holder.clientWidth, h = holder.clientHeight;
      // la „lățimea paginii" contează doar lățimea: o schimbare doar de înălțime (bara
      // „✏️ Rezolvă pe PDF" care trece pe două rânduri, panoul profesorului tras pe
      // telefon) nu mai redesenează toate paginile
      const hMatters = fitRef.current === 'page';
      if (Math.abs(w - lastW) < 4 && (!hMatters || Math.abs(h - lastH) < 4)) { if (!hMatters) lastH = h; return; }
      lastW = w; lastH = h;
      bump();
    }) : null;
    if (ro) ro.observe(holder); else window.addEventListener('resize', bump);
    return () => { clearTimeout(t); if (ro) ro.disconnect(); else window.removeEventListener('resize', bump); };
  }, []);

  // iOS Safari: oprește zoomul nativ al întregii pagini cât timp ciupești PDF-ul
  useEffect(() => {
    const el = holderRef.current;
    if (!el) return undefined;
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
    if (!holder) return undefined;
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
        setPageInfo({ cur: 1, total: doc.numPages });
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

  // ── Desenul unei pagini (când ajunge aproape de ecran) și eliberarea ei ──
  function drawSlot(s, seq) {
    if (s.canvas || seq !== renderSeq.current) return;
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(s.vp.width * s.dpr);
    canvas.height = Math.floor(s.vp.height * s.dpr);
    canvas.style.cssText = 'display:block;width:100%;height:100%;border-radius:4px;background:#fff';
    s.canvas = canvas;
    s.drawnAt = Date.now();
    s.el.appendChild(canvas);
    try {
      s.task = s.page.render({
        canvasContext: canvas.getContext('2d'),
        viewport: s.vp,
        transform: s.dpr !== 1 ? [s.dpr, 0, 0, s.dpr, 0, 0] : null,
      });
      s.task.promise.catch(() => { /* anulată la zoom / derulare */ }).finally(() => { s.task = null; });
    } catch (e) { console.error('PdfCanvasViewer render:', e); }
    // prea multe pagini desenate: le eliberăm pe cele mai vechi, nevăzute
    const drawn = slotsRef.current.filter((x) => x.canvas && !x.visible);
    if (slotsRef.current.filter((x) => x.canvas).length > KEEP_DRAWN) {
      drawn.sort((a, b) => a.drawnAt - b.drawnAt).slice(0, Math.max(0, drawn.length - 2)).forEach(freeSlot);
    }
  }
  function freeSlot(s) {
    if (!s.canvas) return;
    try { s.task?.cancel?.(); } catch { /* noop */ }
    s.task = null;
    try { s.canvas.width = 0; s.canvas.height = 0; } catch { /* noop */ }
    s.canvas.remove();
    s.canvas = null;
  }

  // Așază paginile (la deschidere, zoom — butoane sau pinch —, potrivire ori
  // redimensionare): întâi TOATE locurile paginilor la dimensiunea finală (ca
  // scrollul să poată fi repoziționat exact pe punctul ciupit), apoi desenul,
  // doar pentru paginile de lângă ecran.
  useEffect(() => {
    const doc = pdfRef.current;
    const holder = holderRef.current;
    const wrap = pagesRef.current;
    if (status !== 'ok' || !doc || !holder || !wrap) return undefined;
    const seq = ++renderSeq.current;
    let io = null;
    (async () => {
      try {
        const cw = holder.clientWidth || window.innerWidth;
        const ch = holder.clientHeight || window.innerHeight;
        const slots = [];
        for (let n = 1; n <= doc.numPages; n++) {
          if (seq !== renderSeq.current) return; // s-a schimbat zoomul între timp
          // eslint-disable-next-line no-await-in-loop
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          const fitW = (cw - 12) / base.width;
          const fitP = Math.min(fitW, (ch - 20) / base.height);
          const scale = (fit === 'page' ? fitP : fitW) * zoom;
          const vp = page.getViewport({ scale });
          // limită de pixeli per pagină + laturi ≤4096 (limită iOS)
          let dpr = Math.min(window.devicePixelRatio || 1, 2);
          if (vp.width * vp.height * dpr * dpr > MAX_PX) dpr = Math.max(0.5, Math.sqrt(MAX_PX / (vp.width * vp.height)));
          dpr = Math.min(dpr, 4096 / vp.width, 4096 / vp.height);
          const el = document.createElement('div');
          el.setAttribute('data-pagina', String(n));
          el.style.cssText = `width:${Math.floor(vp.width)}px;height:${Math.floor(vp.height)}px;margin:0 auto 10px;background:#fff;border-radius:4px;box-shadow:0 2px 10px rgba(0,0,0,.35);position:relative`;
          // locul stratului de deasupra paginii („✏️ Rezolvă pe PDF"): peste pânză
          const ov = document.createElement('div');
          ov.setAttribute('data-strat', String(n));
          ov.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;z-index:2';   // fără inset: Chromium-ul vechi al tablelor
          el.appendChild(ov);
          slots.push({ n, page, vp, dpr, el, ov, bw: base.width, bh: base.height, canvas: null, task: null, drawnAt: 0, visible: false });
        }
        if (seq !== renderSeq.current) return;
        // schimbăm conținutul dintr-o mișcare: scoatem scala CSS a pinch-ului
        slotsRef.current.forEach(freeSlot);
        slotsRef.current = slots;
        wrap.innerHTML = '';
        slots.forEach((s) => wrap.appendChild(s.el));
        wrap.style.transform = '';
        wrap.style.willChange = '';
        setOvs({ seq, list: slots.map((s) => ({ n: s.n, el: s.ov, w: s.bw, h: s.bh })) });
        // scrollul care ține punctul ciupit pe loc
        if (pendingScroll.current) {
          holder.scrollLeft = Math.max(0, pendingScroll.current.left);
          holder.scrollTop = Math.max(0, pendingScroll.current.top);
          pendingScroll.current = null;
        }
        applyJump(); // un salt cerut înainte să existe paginile
        if (typeof IntersectionObserver === 'undefined') {
          // browser foarte vechi: le desenăm pe toate, una după alta
          for (const s of slots) {
            if (seq !== renderSeq.current) return;
            drawSlot(s, seq);
            // eslint-disable-next-line no-await-in-loop
            if (s.task) await s.task.promise.catch(() => {});
          }
          return;
        }
        const bySlot = new Map(slots.map((s) => [s.el, s]));
        io = new IntersectionObserver((entries) => {
          if (seq !== renderSeq.current) return;
          let best = null;
          entries.forEach((en) => {
            const s = bySlot.get(en.target);
            if (!s) return;
            s.visible = en.isIntersecting;
            if (en.isIntersecting) drawSlot(s, seq);
          });
          // pagina curentă = prima pagină vizibilă (indicatorul „3 / 12")
          slots.forEach((s) => { if (!best && s.visible) best = s; });
          if (best) setPageInfo((p) => (p.cur === best.n && p.total === slots.length ? p : { cur: best.n, total: slots.length }));
        }, { root: holder, rootMargin: '900px 0px' });
        ioRef.current = io;
        slots.forEach((s) => io.observe(s.el));
      } catch (e) {
        if (seq === renderSeq.current) console.error('PdfCanvasViewer render:', e);
      }
    })();
    return () => { if (io) io.disconnect(); };
  }, [status, zoom, vw, fit]); // eslint-disable-line react-hooks/exhaustive-deps

  // la închidere: pânzele se eliberează imediat (memoria tablelor e mică)
  useEffect(() => () => { slotsRef.current.forEach(freeSlot); slotsRef.current = []; }, []);
  // documentul nou (altă variantă a PDF-ului): straturile vechi nu mai au pagini
  useEffect(() => { setOvs((o) => (o.list.length ? { seq: o.seq, list: [] } : o)); }, [data]);

  function setFitMode(f) {
    setFit(f);
    setZoom(1);
    try { localStorage.setItem(FIT_KEY, f); } catch { /* fără storage */ }
  }

  const zBtn = {
    background: 'rgba(255,255,255,0.12)', border: '1px solid rgba(255,255,255,0.25)',
    color: '#fff', borderRadius: 8, minWidth: 34, height: 30, cursor: 'pointer',
    fontSize: '1rem', fontWeight: 700, lineHeight: 1, padding: '0 8px',
  };

  if (status === 'error') return null; // părintele afișează varianta de rezervă

  return (
    <div style={{ flex: 1, minHeight: 0, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      {/* bara de zoom + potrivire + deschidere externă (rezervă) */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '6px 10px', background: toolbar ? 'rgba(232,185,49,0.16)' : 'rgba(0,0,0,0.25)', flexShrink: 0, flexWrap: 'wrap', rowGap: 6, ...(toolbar ? { borderBottom: '1px solid rgba(232,185,49,0.45)' } : {}) }}>
        {toolbar && toolbar.left}
        <button type="button" style={zBtn} onClick={() => setZoom((z) => Math.max(MIN_ZOOM, Math.round((z - 0.25) * 100) / 100))} aria-label="Micșorează">−</button>
        <span title="Poți mări și cu două degete, direct pe pagină"
          style={{ color: 'rgba(255,255,255,0.8)', fontSize: '0.78rem', fontWeight: 700, minWidth: 44, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button type="button" style={zBtn} onClick={() => setZoom((z) => Math.min(MAX_ZOOM, Math.round((z + 0.25) * 100) / 100))} aria-label="Mărește">+</button>
        {/* pe telefon, în modul de rezolvare (toolbar.compact): doar simbolul — loc pentru
            nota din bară, ca bara să rămână pe două rânduri */}
        <button type="button" style={{ ...zBtn, fontSize: '.74rem' }}
          onClick={() => setFitMode(fit === 'page' ? 'width' : 'page')}
          aria-label={fit === 'page' ? 'Lățimea paginii' : 'Pagina întreagă'}
          title={fit === 'page' ? 'Paginile cât lățimea ecranului' : 'Pagina întreagă pe ecran (bun pe tabla interactivă)'}>
          {toolbar && toolbar.compact
            ? (fit === 'page' ? '↔' : '⤢')
            : (fit === 'page' ? '↔ Lățimea paginii' : '⤢ Pagina întreagă')}
        </button>
        {pageInfo.total > 1 && (
          <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.74rem', fontWeight: 700 }}>
            {pageInfo.cur} / {pageInfo.total}
          </span>
        )}
        {blobUrl && !toolbar && (
          <a href={blobUrl} target="_blank" rel="noopener noreferrer"
            style={{ marginLeft: 4, color: 'rgba(255,255,255,0.55)', fontSize: '0.72rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}>
            deschide extern ↗
          </a>
        )}
        {toolbar && toolbar.right}
      </div>
      {/* paginile — cu un deget derulezi, cu două degete dai zoom */}
      <div
        ref={holderRef}
        data-pdf-pagini="1"
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
        {status === 'ok' && footer}
      </div>
      {overlay && ovs.list.map((o) => createPortal(overlay(o), o.el, `ov-${ovs.seq}-${o.n}`))}
    </div>
  );
}
