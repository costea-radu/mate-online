// =====================================================================
// src/components/SpatiuDeLucru.jsx — caietul digital al elevului
//
// O FOAIE ALBĂ, FĂRĂ LINII, care nu se termină: elevul scrie cu degetul sau
// cu creionul și merge mai departe în DREAPTA (sau în jos) cât vrea, ca pe
// tabla interactivă. Foaia se trage cu „✋ Derulează", cu DOUĂ DEGETE (și în
// modul scris), cu rotița mouse-ului (Shift + rotița = lateral), cu bara de
// derulare sau cu ◀ ▶. „➕ Pagină nouă" duce la o porțiune goală, în dreapta
// a tot ce s-a scris; „⟲" — înapoi la începutul foii.
//
// Scrisul RĂMÂNE scris de mână. „✨ Transformă în text" a fost scos (27 oct.
// 2026): citea greșit scrisul urât. „🎓 Cere corectarea" trimite chiar SCRISUL
// — o imagine a foii (exportSheet) — corectorului AI (api/ai-handwriting.js):
// un model competent îl citește și îl corectează strict după barem, unde
// există. Corectarea face parte din Premium (`corectLocked` = fără abonament).
//
// Tehnic: traseele au coordonate de „lume" (px CSS de la colțul din stânga-sus
// al foii) și se desenează ca <path> într-un SVG cât foaia — derularea e cea
// nativă a browserului (lină, și pe telefon), fără redesenare. Zona derulabilă
// are mereu cu un ecran gol mai mult decât ce s-a scris și decât poziția
// curentă: de aceea foaia „nu se termină". (Varianta veche — o pânză canvas
// cât toată foaia — nu putea crește lateral: pe telefon, pânzele foarte mari
// depășesc limita de memorie a browserului.)
//
// Se deschide din: exercițiile interactive (iframe → MATE_WORKSPACE_OPEN →
// InteractiveViewer), vizualizatorul PDF (ÎN zona de conversație a
// Profesorului Virtual — `embedded`), tabla din „Planul meu" (bara de scris
// și formularul „📝 Răspunde în chat"), sala meditațiilor live și Pregătirea
// de examen („Caietul meu" — acolo e doar ciornă, fără butoane AI).
//
// FEREASTRA (30 oct. 2026) se mută și se redimensionează peste tot, ca widgetul
// Profesorului Virtual: pe calculator e o fereastră PLUTITOARE (nu mai
// întunecă pagina — exercițiul de dedesubt rămâne la vedere și se poate
// folosi), se trage de antet ca s-o muți și de ORICE margine sau colț ca s-o
// faci cât vrei (mânerele au liniuța widgetului); pe telefon stă jos, pe toată
// lățimea, și se trage de bara albastră în sus / în jos — ca panoul
// profesorului. Mărimea și locul se țin minte (localStorage).
//
// Props:
//   open, onClose
//   embedded     — fără fereastră: foaia ia locul conversației din chat.
//                  Mărimea o dă panoul (pe telefon se trage de bara lui, pe
//                  calculator de marginea lui stângă).
//   title        — ce scrie în antetul ferestrei (exercițiul la care lucrează)
//   enunt        — enunțul CURAT, de arătat elevului (fără răspunsuri — vezi
//                  collectEnunt() din tutorBridge.js). Lipsește → fără panou.
//   figura       — URL-ul desenului problemei (opțional, sub enunț)
//   storageKey   — cheia ciornei locale (`sdl2:<cheie>`): supraviețuiește
//                  reîncărcării paginii
//   onCorect     — ({ images, thumb, grid, size }) => void : „🎓 Cere corectarea"
//   corectLocked — true = elevul nu are Premium: butonul arată ⭐ și, la apăsare,
//                  explică (nu trimite nimic)
//   onAttach     — ({ images, thumb, grid, size }) => void : scrisul pleacă ca
//                  IMAGINE (la întrebarea din chat / la răspunsul unei cerințe)
//   attachLabel  — eticheta acelui buton
// =====================================================================
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ensureKatex, renderMath, autoMath } from '../lib/katex';
// geometria foii + imaginea pentru corector (pure — testate fără DOM)
import { PEN_W, boxOf, unionBox, strokeBox, pathD, exportSheet } from '../lib/foaie';
// locul și mărimea ferestrei după o tragere (pure — testate fără DOM)
import { geometrieFereastra, MIN_W, MIN_H } from '../lib/fereastra';

const ERASER_R = 15;
const COLORS = ['#12263a', '#c62828', '#1565c0', '#2e7d32'];
// Foaia e ALBĂ și FĂRĂ LINII peste tot — în fereastră și în zona de conversație
export const SHEET_BG = '#ffffff';
// câte ecrane goale are mereu foaia „în față" (în dreapta și în jos)
const AHEAD = 1;
const SVGNS = 'http://www.w3.org/2000/svg';
const MAX_HISTORY = 200;

// Fereastra: mărimea (și locul) alese de elev se țin minte de la o deschidere
// la alta — pe calculator { x, y, w, h } (ferestrele vechi aveau doar { w, h }:
// se deschid centrate), pe telefon doar înălțimea.
const WIN_KEY = 'sdl:fereastra';
const SHEET_KEY = 'sdl:fereastra:tel';
const MIN_H_TEL = 220;        // pe telefon: cât de jos se poate strânge foaia
const NARROW = 720;           // sub atât (telefon): pe toată lățimea, jos pe ecran
// mânerele ferestrei: marginile și colțurile (n = sus, s = jos, e = dreapta, w = stânga)
const GRIP_CURSOR = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize', move: 'move', sheet: 'ns-resize' };

// (noua geometrie după o tragere — mutare, margine sau colț: src/lib/fereastra.js)
const ENUNT_MIN = 46, ENUNT_MAX_FRAC = 0.55;
const ENUNT_MAX_FRAC_NARROW = 0.24;   // pe telefon: foaia trebuie să rămână mare

// Radiera atinge traseul? Distanța până la fiecare SEGMENT (nu doar până la
// puncte: o linie trasă repede are puncte rare, iar radiera trecea printre ele).
function nearStroke(pts, x, y, r) {
  const r2 = r * r;
  if (pts.length === 1) return (pts[0][0] - x) ** 2 + (pts[0][1] - y) ** 2 <= r2;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len2)) : 0;
    const qx = ax + t * dx - x, qy = ay + t * dy - y;
    if (qx * qx + qy * qy <= r2) return true;
  }
  return false;
}

// ── Enunțul arătat elevului ────────────────────────────────
// Plasă de siguranță: chiar dacă într-o zi cineva pune din greșeală textul
// „bogat" (cel pentru model) în `enunt`, marcajele cu răspunsul corect și cu
// indicația oficială se taie AICI, înainte să ajungă pe ecran.
const SECRET_RE = /\s*\|?\s*\[răspuns corect[^\]]*\]/gi;
const HINT_RE = /\s*\|\s*Indicația oficială:[^\n]*/gi;
const ANS_RE = /\s*\|\s*Răspunsul elevului:[^|\n]*/gi;
const EXPL_RE = /\s*\[explicația oficială[^\]]*\]/gi;
function cleanEnunt(raw) {
  let t = String(raw || '').trim();
  if (!t) return '';
  t = t.replace(SECRET_RE, '').replace(HINT_RE, '').replace(ANS_RE, '').replace(EXPL_RE, '');
  t = t.replace(/← ALES DE ELEV/g, '');
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  return t;
}

function TextEnunt({ text }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = autoMath(text);
    ensureKatex().then(() => { if (ref.current) renderMath(ref.current); });
  }, [text]);
  return (
    <div ref={ref} style={{
      whiteSpace: 'pre-wrap', fontSize: '.84rem', lineHeight: 1.6, color: '#2b3d50',
      fontFamily: 'Georgia, "Times New Roman", serif', overflowWrap: 'break-word',
    }} />
  );
}

export default function SpatiuDeLucru({
  open = false, onClose, title = '', enunt = null, figura = null, storageKey = null,
  onCorect = null, corectLocked = false, onAttach = null, attachLabel = '📎 Pune în întrebare',
  embedded = false,
}) {
  const scrollRef = useRef(null);   // zona derulabilă (derularea nativă a browserului)
  const svgRef = useRef(null);      // foaia: cât zona derulabilă, cu un ecran gol în față
  const gRef = useRef(null);        // traseele (<path>), gestionate direct (nu prin React)

  const strokesRef = useRef([]);              // [{ id, color, pts, box }] — ordinea = ordinea scrisului
  const pathsRef = useRef(new Map());         // id → <path>
  const contentRef = useRef(null);            // dreptunghiul a tot ce s-a scris
  const historyRef = useRef([]);              // pentru „↩ Înapoi": add / erase / clear
  const drawingRef = useRef(null);
  const panRef = useRef(null);                // tragere cu mouse-ul (✋ / rotița apăsată) sau cu două degete
  const touchesRef = useRef(new Map());       // degetele de pe foaie (pentru derularea cu două degete)
  const penSeenRef = useRef(false);
  const seqRef = useRef(1);
  const saveTimerRef = useRef(0);
  const posRafRef = useRef(0);
  const viewRef = useRef({ x: 0, y: 0 });     // ultima poziție pe foaie (se salvează și după închidere)

  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [area, setArea] = useState({ w: 0, h: 0 });            // zona vizibilă a foii
  const [pos, setPos] = useState({ page: 1, pages: 1, atStart: true, atLeft: true });
  const [count, setCount] = useState(0);                        // câte trasee are foaia
  const [err, setErr] = useState(null);
  const [lockInfo, setLockInfo] = useState(false);              // banda „⭐ Premium"
  const [busy, setBusy] = useState(null);                       // 'corect' | 'attach'
  const toolRef = useRef(tool);
  const colorRef = useRef(color);
  useEffect(() => { toolRef.current = tool; }, [tool]);
  useEffect(() => { colorRef.current = color; }, [color]);

  // ── Fereastra: loc, mărime, maximizare, mânere de tras ──────────
  // Ca widgetul Profesorului Virtual: pe calculator o MUȚI trăgând de antet și
  // o faci cât vrei trăgând de ORICE margine sau colț; pe telefon stă jos, pe
  // toată lățimea, și se trage de bara albastră în sus / în jos. Locul și
  // mărimea se țin minte (localStorage). Fereastra nu mai întunecă pagina:
  // exercițiul de dedesubt rămâne la vedere și se poate folosi.
  const dialogRef = useRef(null);
  const [scr, setScr] = useState(() => ({
    w: typeof window === 'undefined' ? 1200 : window.innerWidth,
    h: typeof window === 'undefined' ? 800 : window.innerHeight,
  }));
  const [win, setWin] = useState(() => {
    try { const o2 = JSON.parse(localStorage.getItem(WIN_KEY) || 'null'); if (o2 && o2.w && o2.h) return o2; } catch { /* implicit */ }
    return null;
  });
  const [sheetH, setSheetH] = useState(() => {
    try { const v = parseInt(localStorage.getItem(SHEET_KEY) || '0', 10); return v > 0 ? v : null; } catch { return null; }
  });
  const [maxi, setMaxi] = useState(false);
  const dragRef = useRef(null);
  const [dragging, setDragging] = useState(null);   // ce se trage acum (pentru stratul de deasupra iframe-urilor)
  // Ultima geometrie trasă, ținută într-un ref: la sfârșitul tragerii, starea din
  // closure poate fi încă cea veche (React n-a apucat să redeseneze dacă ultima
  // mișcare și ridicarea degetului cad în același cadru) — și se salva mai nimic.
  const lastSizeRef = useRef(null);

  useEffect(() => {
    const onR = () => setScr({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onR);
    window.addEventListener('orientationchange', onR);
    return () => { window.removeEventListener('resize', onR); window.removeEventListener('orientationchange', onR); };
  }, []);

  const narrow = scr.w < NARROW;
  const MARGIN = narrow ? 4 : 12;
  const maxW = Math.max(MIN_W, scr.w - 2 * MARGIN);
  const maxH = Math.max(MIN_H, scr.h - 2 * MARGIN);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const winW = maxi || narrow ? maxW : clamp(win ? win.w : Math.min(1100, maxW), MIN_W, maxW);
  const winH = maxi ? maxH
    : narrow ? clamp(sheetH || Math.round(scr.h * 0.94), Math.min(MIN_H_TEL, maxH), scr.h - MARGIN)
      : clamp(win ? win.h : Math.round(scr.h * 0.94), MIN_H, maxH);
  // locul: centrată până o muți (ferestrele salvate fără x / y — tot centrate)
  const winX = maxi || narrow ? MARGIN : clamp(win && win.x != null ? win.x : Math.round((scr.w - winW) / 2), MARGIN, Math.max(MARGIN, scr.w - MARGIN - winW));
  const winY = maxi ? MARGIN : narrow ? scr.h - winH
    : clamp(win && win.y != null ? win.y : Math.round((scr.h - winH) / 2), MARGIN, Math.max(MARGIN, scr.h - MARGIN - winH));
  const enuntFrac = narrow ? ENUNT_MAX_FRAC_NARROW : ENUNT_MAX_FRAC;

  // Tragerea: 'move' (antetul, pe calculator), o margine / un colț ('n', 'se'…)
  // sau 'sheet' (bara albastră, pe telefon: înălțimea foii de jos).
  function startDrag(kind, e) {
    if (maxi) return;
    if (e.button != null && e.button !== 0) return;
    // butoanele din antet (⛶, ✕) nu pornesc tragerea
    if (kind === 'move' || kind === 'sheet') { if (e.target && e.target.closest && e.target.closest('button')) return; }
    e.preventDefault(); e.stopPropagation();
    const r = dialogRef.current.getBoundingClientRect();
    dragRef.current = { kind, sx: e.clientX, sy: e.clientY, start: { x: r.left, y: r.top, w: r.width, h: r.height } };
    setDragging(kind);
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* merge și fără */ }
  }
  function moveDrag(e) {
    const d = dragRef.current;
    if (!d) return;
    e.preventDefault();
    const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
    if (d.kind === 'sheet') {
      // pe telefon: tragi bara în sus → foaia crește (ca panoul profesorului)
      lastSizeRef.current = Math.round(clamp(d.start.h - dy, Math.min(MIN_H_TEL, maxH), scr.h - MARGIN));
      setSheetH(lastSizeRef.current);
      return;
    }
    lastSizeRef.current = geometrieFereastra(d.kind, d.start, dx, dy, scr, { margin: MARGIN });
    setWin(lastSizeRef.current);
  }
  function endDrag(e) {
    const d = dragRef.current;
    if (!d) return;
    dragRef.current = null;
    setDragging(null);
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* deja eliberat */ }
    const last = lastSizeRef.current;
    lastSizeRef.current = null;
    if (last == null) return;
    try { localStorage.setItem(d.kind === 'sheet' ? SHEET_KEY : WIN_KEY, JSON.stringify(last)); } catch { /* fără loc */ }
  }
  const dragProps = (kind) => ({
    onPointerDown: (e) => startDrag(kind, e), onPointerMove: moveDrag, onPointerUp: endDrag, onPointerCancel: endDrag,
  });

  // ── Panoul cu enunțul ───────────────────────────────────
  const enuntText = useMemo(() => cleanEnunt(enunt), [enunt]);
  const [enuntOpen, setEnuntOpen] = useState(() => {
    try { return localStorage.getItem('sdl:enunt') !== '0'; } catch { return true; }
  });
  const [enuntH, setEnuntH] = useState(() => {
    try { const v = parseInt(localStorage.getItem('sdl:enuntH') || '0', 10); return v > 0 ? v : 132; } catch { return 132; }
  });
  const enuntRef = useRef(null);
  const lastEnuntHRef = useRef(null);
  function toggleEnunt() {
    setEnuntOpen((v) => { try { localStorage.setItem('sdl:enunt', v ? '0' : '1'); } catch { /* nimic */ } return !v; });
  }
  function startEnuntResize(e) {
    e.preventDefault(); e.stopPropagation();
    enuntRef.current = { y: e.clientY, h: enuntH };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* merge și fără */ }
  }
  function moveEnuntResize(e) {
    const r = enuntRef.current;
    if (!r) return;
    e.preventDefault();
    lastEnuntHRef.current = clamp(r.h + (e.clientY - r.y), ENUNT_MIN, Math.round(winH * enuntFrac));
    setEnuntH(lastEnuntHRef.current);
  }
  function endEnuntResize(e) {
    if (!enuntRef.current) return;
    enuntRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* deja eliberat */ }
    const last = lastEnuntHRef.current;
    if (last) { try { localStorage.setItem('sdl:enuntH', String(last)); } catch { /* fără loc */ } }
  }

  // ── Foaia „fără sfârșit": mărimea zonei derulabile ──────────────────────
  // Mereu cu un ecran gol în dreapta și în jos — față de tot ce s-a scris ȘI
  // față de poziția curentă. Cât elevul trage foaia spre stânga, zona crește
  // odată cu el; când se întoarce, se strânge la loc (dar nu sub poziția lui).
  // Se scrie direct pe element: la tragerea cu degetul, o redesenare React
  // ar veni prea târziu și derularea s-ar opri la marginea veche.
  const ensureExtent = useCallback((minW = 0, minH = 0) => {
    const sc = scrollRef.current, svg = svgRef.current;
    if (!sc || !svg) return;
    const vw = sc.clientWidth || 1, vh = sc.clientHeight || 1;
    const bb = contentRef.current;
    const W = Math.ceil(Math.max(vw * (1 + AHEAD), sc.scrollLeft + vw * (1 + AHEAD), bb ? bb.x1 + vw : 0, minW));
    const H = Math.ceil(Math.max(vh * (1 + AHEAD), sc.scrollTop + vh * (1 + AHEAD), bb ? bb.y1 + vh : 0, minH));
    if (svg.getAttribute('width') !== String(W)) svg.setAttribute('width', String(W));
    if (svg.getAttribute('height') !== String(H)) svg.setAttribute('height', String(H));
  }, []);

  // „pagina 2 din 3" — paginile au lățimea zonei vizibile
  const updatePos = useCallback(() => {
    posRafRef.current = 0;
    const sc = scrollRef.current;
    if (!sc) return;
    const vw = sc.clientWidth || 1;
    const bb = contentRef.current;
    const page = Math.floor((sc.scrollLeft + vw * 0.5) / vw) + 1;
    const pages = Math.max(page, bb ? Math.ceil((bb.x1 + 1) / vw) : 1);
    const atLeft = sc.scrollLeft < 4;
    const atStart = atLeft && sc.scrollTop < 4;
    setPos((p) => (p.page === page && p.pages === pages && p.atStart === atStart && p.atLeft === atLeft ? p : { page, pages, atStart, atLeft }));
  }, []);
  const updatePosSoon = useCallback(() => {
    if (!posRafRef.current) posRafRef.current = requestAnimationFrame(updatePos);
  }, [updatePos]);

  function onScroll() {
    const sc = scrollRef.current;
    if (sc) viewRef.current = { x: Math.round(sc.scrollLeft), y: Math.round(sc.scrollTop) };
    ensureExtent();
    updatePosSoon();
    scheduleSave();
  }

  // ── Traseele pe foaie (SVG) ─────────────────────────────────────────────
  function makePath(s) {
    const p = document.createElementNS(SVGNS, 'path');
    p.setAttribute('d', pathD(s.pts));
    p.setAttribute('stroke', s.color);
    p.setAttribute('stroke-width', String(PEN_W));
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    return p;
  }
  const rebuildPaths = useCallback(() => {
    const g = gRef.current;
    pathsRef.current = new Map();
    if (!g) return;
    while (g.firstChild) g.removeChild(g.firstChild);
    for (const s of strokesRef.current) {
      const p = makePath(s);
      g.appendChild(p);
      pathsRef.current.set(s.id, p);
    }
  }, []);
  const refreshContent = useCallback(() => {
    contentRef.current = unionBox(strokesRef.current.map(strokeBox));
    setCount(strokesRef.current.length);
    ensureExtent();
    updatePosSoon();
  }, [ensureExtent, updatePosSoon]);

  // ── Ciornă salvată local ──────────────────────────────────────────────
  const LSK = storageKey ? `sdl2:${storageKey}` : null;
  const lskRef = useRef(LSK);
  useEffect(() => { lskRef.current = LSK; }, [LSK]);

  const saveNow = useCallback((key = lskRef.current) => {
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = 0;
    if (!key) return;
    try {
      if (!strokesRef.current.length) { localStorage.removeItem(key); return; }
      const strokes = strokesRef.current.map((s) => ({
        id: s.id, color: s.color,
        pts: s.pts.map(([x, y]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2]),
      }));
      // la închidere, zona derulabilă nu mai există — poziția vine din viewRef
      localStorage.setItem(key, JSON.stringify({ v: 3, strokes, view: viewRef.current }));
    } catch { /* fără loc în localStorage — ciorna nu se salvează, atât */ }
  }, []);
  function scheduleSave() {
    if (!lskRef.current) return;
    clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveNow(), 500);
  }

  // La deschidere: ciorna (dacă are cheie) — sau ce era deja pe foaie
  useLayoutEffect(() => {
    if (!open) return undefined;
    let view = null;
    if (LSK) {
      let loaded = [];
      try {
        const o = JSON.parse(localStorage.getItem(LSK) || 'null');
        if (o && Array.isArray(o.strokes)) {
          // ciornele vechi (cu `line` / `meta` — din vremea „Transformă") se
          // citesc la fel: aceleași coordonate, câmpurile în plus se ignoră
          loaded = o.strokes
            .filter((s) => s && Array.isArray(s.pts) && s.pts.length && s.pts.every((p) => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1])))
            .map((s, i) => ({ id: Number.isFinite(s.id) ? s.id : i + 1, color: typeof s.color === 'string' ? s.color : COLORS[0], pts: s.pts }));
          loaded.sort((a, b) => a.id - b.id);
          if (o.view && Number.isFinite(o.view.x) && Number.isFinite(o.view.y)) view = o.view;
        }
      } catch { loaded = []; /* ciornă coruptă — pornim de la foaie albă */ }
      strokesRef.current = loaded;
      historyRef.current = [];
    }
    for (const s of strokesRef.current) { s.box = null; strokeBox(s); }
    seqRef.current = strokesRef.current.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
    rebuildPaths();
    refreshContent();
    const sc = scrollRef.current;
    if (sc && view) {
      ensureExtent(view.x + sc.clientWidth * 2, view.y + sc.clientHeight * 2);
      sc.scrollLeft = view.x; sc.scrollTop = view.y;
      viewRef.current = { x: Math.round(sc.scrollLeft), y: Math.round(sc.scrollTop) };
    } else if (sc) {
      viewRef.current = { x: Math.round(sc.scrollLeft), y: Math.round(sc.scrollTop) };
    }
    const key = LSK;
    return () => { if (key) saveNow(key); };
  }, [open, LSK]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const flush = () => saveNow();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [open, saveNow]);

  // Mărimea zonei vizibile → mărimea foii și indicatorul de pagină
  useEffect(() => {
    if (!open) return undefined;
    const el = scrollRef.current;
    if (!el) return undefined;
    const upd = () => {
      setArea((a) => (a.w === el.clientWidth && a.h === el.clientHeight ? a : { w: el.clientWidth, h: el.clientHeight }));
      ensureExtent();
      updatePosSoon();
    };
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null;
    if (ro) ro.observe(el);
    upd();
    return () => { if (ro) ro.disconnect(); };
  }, [open, embedded, ensureExtent, updatePosSoon]);

  // ── Scrisul ───────────────────────────────────────────────────────────
  // Coordonatele de „lume": SVG-ul se mișcă odată cu derularea, deci poziția
  // față de colțul lui este direct poziția pe foaie.
  function toWorld(e) {
    const r = svgRef.current.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  function pushHistory(h) {
    historyRef.current.push(h);
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
  }
  function addPoint(d, x, y) {
    const last = d.pts[d.pts.length - 1];
    if (Math.abs(x - last[0]) < 0.7 && Math.abs(y - last[1]) < 0.7) return false;
    d.pts.push([x, y]);
    return true;
  }
  // Al doilea deget a atins foaia: trasul abia început cu primul deget era, de
  // fapt, începutul unei derulări cu două degete → se anulează.
  function abandonStroke() {
    const d = drawingRef.current;
    drawingRef.current = null;
    if (!d || d.eraser) return;
    const recent = performance.now() - d.t0 < 400 || d.pts.length < 10;
    if (!recent) { finishStroke(d); return; }
    strokesRef.current = strokesRef.current.filter((s) => s !== d);
    const p = pathsRef.current.get(d.id);
    if (p && p.parentNode) p.parentNode.removeChild(p);
    pathsRef.current.delete(d.id);
  }
  function finishStroke(d) {
    d.box = boxOf(d.pts);
    pushHistory({ t: 'add', id: d.id });
    refreshContent();
    followDown(d.box);
    scheduleSave();
  }

  function onDown(e) {
    const sc = scrollRef.current;
    if (!sc) return;
    if (e.pointerType === 'touch') {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touchesRef.current.size === 2 && !(drawingRef.current && drawingRef.current.pen)) {
        // DOUĂ DEGETE → derulare (în orice unealtă), ca pe tabla interactivă
        abandonStroke();
        const [a, b] = [...touchesRef.current.values()];
        panRef.current = { two: true, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, sl: sc.scrollLeft, st: sc.scrollTop };
        return;
      }
      if (touchesRef.current.size > 2) return;
    }
    // ✋ cu mouse-ul / creionul, sau rotița apăsată (oricare unealtă) → tragi foaia
    if (e.button === 1 || (toolRef.current === 'pan' && e.pointerType !== 'touch')) {
      e.preventDefault();
      panRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, sl: sc.scrollLeft, st: sc.scrollTop };
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* merge și fără */ }
      return;
    }
    if (toolRef.current === 'pan') return;   // ✋ cu degetul → derularea nativă (touch-action)
    if (e.pointerType === 'pen') penSeenRef.current = true;
    if (penSeenRef.current && e.pointerType === 'touch') return;   // palma sprijinită nu scrie
    if (e.button && e.button !== 0 && e.button !== 5) return;
    if (drawingRef.current) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* merge și fără capture */ }
    const [x, y] = toWorld(e);
    // capătul „radieră" al creionului (sau butonul lui) șterge, oricare unealtă e aleasă
    const eraser = toolRef.current === 'eraser' || e.button === 5 || (e.buttons & 32) === 32;
    if (eraser) { drawingRef.current = { eraser: true, id: e.pointerId, removed: [] }; erase(x, y); return; }
    const d = { id: seqRef.current++, color: colorRef.current, pts: [[x, y]], t0: performance.now(), ptr: e.pointerId, pen: e.pointerType === 'pen' };
    drawingRef.current = d;
    strokesRef.current.push(d);
    const p = makePath(d);
    if (gRef.current) gRef.current.appendChild(p);
    pathsRef.current.set(d.id, p);
  }

  function onMove(e) {
    if (e.pointerType === 'touch' && touchesRef.current.has(e.pointerId)) {
      touchesRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const sc = scrollRef.current;
    const pan = panRef.current;
    if (pan && sc) {
      if (pan.two) {
        if (touchesRef.current.size >= 2) {
          const [a, b] = [...touchesRef.current.values()];
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          ensureExtent(pan.sl - (mx - pan.mx) + sc.clientWidth * 2, pan.st - (my - pan.my) + sc.clientHeight * 2);
          sc.scrollLeft = pan.sl - (mx - pan.mx);
          sc.scrollTop = pan.st - (my - pan.my);
        }
        return;
      }
      if (pan.id === e.pointerId) {
        e.preventDefault();
        const nl = pan.sl - (e.clientX - pan.x), nt = pan.st - (e.clientY - pan.y);
        ensureExtent(nl + sc.clientWidth * 2, nt + sc.clientHeight * 2);
        sc.scrollLeft = nl; sc.scrollTop = nt;
      }
      return;
    }
    const d = drawingRef.current;
    if (!d) return;
    if (!d.eraser && d.ptr !== e.pointerId) return;
    if (d.eraser && d.id !== e.pointerId) return;
    e.preventDefault();
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const list = evs && evs.length ? evs : [e];
    if (d.eraser) { for (const ev of list) { const [x, y] = toWorld(ev); erase(x, y); } return; }
    let changed = false;
    for (const ev of list) { const [x, y] = toWorld(ev); if (addPoint(d, x, y)) changed = true; }
    if (changed) { const p = pathsRef.current.get(d.id); if (p) p.setAttribute('d', pathD(d.pts)); }
  }

  function onUp(e) {
    if (e.pointerType === 'touch') touchesRef.current.delete(e.pointerId);
    const pan = panRef.current;
    if (pan) {
      if (pan.two ? touchesRef.current.size < 2 : pan.id === e.pointerId) {
        panRef.current = null;
        try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* deja eliberat */ }
        scheduleSave();
      }
      return;
    }
    const d = drawingRef.current;
    if (!d) return;
    if (d.eraser ? d.id !== e.pointerId : d.ptr !== e.pointerId) return;
    drawingRef.current = null;
    if (d.eraser) {
      if (d.removed.length) { pushHistory({ t: 'erase', list: d.removed }); refreshContent(); scheduleSave(); }
      return;
    }
    finishStroke(d);
  }

  function erase(x, y) {
    const d = drawingRef.current;
    const keep = [];
    let changed = false;
    for (const s of strokesRef.current) {
      const b = strokeBox(s);
      if (x < b.x0 - ERASER_R || x > b.x1 + ERASER_R || y < b.y0 - ERASER_R || y > b.y1 + ERASER_R) { keep.push(s); continue; }
      const hit = nearStroke(s.pts, x, y, ERASER_R);
      if (hit) {
        changed = true;
        if (d && d.removed) d.removed.push(s);
        const p = pathsRef.current.get(s.id);
        if (p && p.parentNode) p.parentNode.removeChild(p);
        pathsRef.current.delete(s.id);
      } else keep.push(s);
    }
    if (changed) strokesRef.current = keep;
  }

  // Foaia urcă odată cu elevul: după un rând scris jos de tot, apare loc
  // dedesubt (cât un rând și ceva — dar nu mai mult de ~o treime din ce se
  // vede: în zona de conversație de pe telefon foaia e mică).
  function followDown(box) {
    const sc = scrollRef.current;
    if (!sc || !box) return;
    const vh = sc.clientHeight;
    const room = Math.min(110, vh * 0.3);
    if (box.y1 - sc.scrollTop > vh - room * 0.6) {
      const top = Math.max(0, box.y1 + room - vh);
      ensureExtent(0, top + vh * 2);
      try { sc.scrollTo({ top, behavior: 'smooth' }); } catch { sc.scrollTop = top; }
    }
  }

  function undo() {
    const h = historyRef.current.pop();
    if (!h) return;
    if (h.t === 'add') {
      strokesRef.current = strokesRef.current.filter((s) => s.id !== h.id);
    } else if (h.t === 'erase' || h.t === 'clear') {
      strokesRef.current = [...strokesRef.current, ...h.list].sort((a, b) => a.id - b.id);
    }
    rebuildPaths();
    refreshContent();
    scheduleSave();
  }

  function clearAll() {
    if (!strokesRef.current.length) return;
    pushHistory({ t: 'clear', list: strokesRef.current });
    strokesRef.current = [];
    rebuildPaths();
    refreshContent();
    setErr(null);
    goTo(0, 0, false);
    saveNow();
  }

  // ── Navigarea pe foaie ──────────────────────────────────────────────────
  function goTo(left, top, smooth = true) {
    const sc = scrollRef.current;
    if (!sc) return;
    const l = Math.max(0, Math.round(left)), t = Math.max(0, Math.round(top));
    ensureExtent(l + sc.clientWidth * 2, t + sc.clientHeight * 2);
    try { sc.scrollTo({ left: l, top: t, behavior: smooth ? 'smooth' : 'auto' }); } catch { sc.scrollLeft = l; sc.scrollTop = t; }
  }
  // Paginile stau una lângă alta, fiecare cât zona vizibilă: ◀ ▶ sar exact la
  // începutul paginii vecine (între ele foaia se trage liber, cu ✋ / degetele).
  function pageNext() {
    const sc = scrollRef.current;
    if (!sc) return;
    const vw = sc.clientWidth || 1;
    goTo((Math.floor((sc.scrollLeft + 4) / vw) + 1) * vw, sc.scrollTop);
  }
  function pagePrev() {
    const sc = scrollRef.current;
    if (!sc) return;
    const vw = sc.clientWidth || 1;
    goTo((Math.ceil((sc.scrollLeft - 4) / vw) - 1) * vw, sc.scrollTop);
  }
  // „➕ Pagină nouă": prima pagină goală din dreapta a tot ce s-a scris
  // (dacă elevul e deja pe una goală, următoarea), de sus.
  function newPage() {
    const sc = scrollRef.current;
    if (!sc) return;
    const vw = sc.clientWidth || 1;
    const bb = contentRef.current;
    let left = bb ? Math.ceil((bb.x1 + 30) / vw) * vw : (Math.floor((sc.scrollLeft + 4) / vw) + 1) * vw;
    if (left < sc.scrollLeft + 10) left = (Math.floor((sc.scrollLeft + 4) / vw) + 1) * vw;
    goTo(left, 0);
  }

  // ── Butoanele care trimit scrisul ───────────────────────────────────────
  async function act(kind) {
    if (busy) return;
    setErr(null);
    if (kind === 'corect' && corectLocked) { setLockInfo(true); return; }
    if (!strokesRef.current.length) { setErr('Scrie întâi rezolvarea pe foaie.'); return; }
    setBusy(kind);
    await new Promise((ok) => setTimeout(ok, 30));   // butonul apucă să arate „⏳"
    let pack = null;
    try { pack = exportSheet(strokesRef.current); } catch { pack = null; }
    setBusy(null);
    if (!pack || !pack.images.length) { setErr('Nu am găsit nimic de trimis pe foaie — scrie rezolvarea, apoi apasă din nou.'); return; }
    saveNow();
    if (kind === 'corect') { if (onCorect) onCorect(pack); } else if (onAttach) onAttach(pack);
    if (onClose) onClose();
  }

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { if (onClose) onClose(); return; }
      const ae = document.activeElement;
      const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
      if (!typing && (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); undo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const hasInk = count > 0;
  const mic = (area.w || 999) < 560;      // panou îngust: telefonul sau panoul lateral de 400 px

  // ── Foaia (aceeași în fereastră și în zona de conversație) ──────────────
  const navBtn = (disabled = false) => ({
    width: 30, height: 28, borderRadius: 14, border: 'none', background: 'none', cursor: disabled ? 'default' : 'pointer',
    color: disabled ? '#b5c0cc' : '#24384d', fontSize: '.86rem', fontWeight: 800, lineHeight: 1, padding: 0,
  });
  const sheetJsx = (
    <div style={{ flex: 1, minHeight: 0, position: 'relative', background: SHEET_BG }}>
      <div ref={scrollRef} onScroll={onScroll}
        data-foaie="1"
        style={{ position: 'absolute', inset: 0, overflow: 'auto', overscrollBehavior: 'contain', background: SHEET_BG }}>
        {/* lățimea/înălțimea le pune DOAR ensureExtent (nu React): o redesenare
            nu are voie să strângă foaia sub poziția la care a ajuns elevul */}
        <svg
          ref={svgRef}
          xmlns={SVGNS}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onLostPointerCapture={(e) => { if (drawingRef.current && !drawingRef.current.eraser && drawingRef.current.ptr === e.pointerId) onUp(e); }}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            display: 'block', background: SHEET_BG,
            // ✋ cu degetul: derularea nativă (lină, cu inerție); altfel scrisul
            // primește atingerea, iar derularea se face cu două degete
            touchAction: tool === 'pan' ? 'pan-x pan-y' : 'none',
            cursor: tool === 'eraser' ? 'cell' : tool === 'pan' ? 'grab' : 'crosshair',
            userSelect: 'none', WebkitUserSelect: 'none', WebkitTouchCallout: 'none',
          }}>
          <g ref={gRef} />
        </svg>
      </div>

      {/* foaia goală: un singur rând de îndrumare (nu prinde atingerile) */}
      {!hasInk && (
        <div aria-hidden style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', padding: 20, textAlign: 'center', color: '#9aa8b8', fontSize: mic ? '.8rem' : '.88rem', lineHeight: 1.55,
        }}>
          <div>
            ✍️ Scrie aici cu degetul sau cu creionul.<br />
            Foaia continuă în dreapta → trage-o cu ✋ sau cu două degete.
          </div>
        </div>
      )}

      {/* navigarea pe foaie: ◀ pagina ▶, înapoi la început */}
      <div style={{
        position: 'absolute', left: 10, bottom: 10, display: 'flex', alignItems: 'center', gap: 2,
        background: 'rgba(255,255,255,.94)', border: '1px solid #dde3ea', borderRadius: 18, padding: '2px 3px',
        boxShadow: '0 2px 10px rgba(15,43,68,.12)', zIndex: 2,
      }}>
        <button type="button" onClick={pagePrev} disabled={pos.atLeft} aria-label="Pagina din stânga" title="Pagina din stânga" style={navBtn(pos.atLeft)}>◀</button>
        <span style={{ fontSize: '.72rem', fontWeight: 700, color: '#44566b', minWidth: 38, textAlign: 'center', whiteSpace: 'nowrap' }}
          title="Pagina pe care o vezi · câte pagini ai scris">
          {pos.page}/{pos.pages}
        </span>
        <button type="button" onClick={pageNext} aria-label="Pagina din dreapta" title="Pagina din dreapta" style={navBtn(false)}>▶</button>
        {!pos.atStart && (
          <button type="button" onClick={() => goTo(0, 0)} aria-label="Înapoi la începutul foii" title="Înapoi la începutul foii"
            style={{ ...navBtn(false), borderLeft: '1px solid #e3e8ee', borderRadius: 0, width: 32 }}>⟲</button>
        )}
      </div>
    </div>
  );

  // ⭐ fără abonament: explicația, cu drumul spre abonamente
  const lockJsx = lockInfo && (
    <div role="status" style={{
      background: '#fff8e1', color: '#5d4500', border: '1px solid #f1d27a', borderRadius: 10,
      padding: '8px 10px', fontSize: '.78rem', display: 'flex', gap: 8, alignItems: 'center', lineHeight: 1.4,
      boxShadow: '0 3px 12px rgba(15,43,68,.12)', pointerEvents: 'auto',
    }}>
      <span style={{ flex: 1 }}>
        ⭐ <strong>Corectarea face parte din abonamentul Premium.</strong> Profesorul virtual îți citește scrisul de mână și îl punctează după barem.{' '}
        <Link to="/preturi" style={{ color: 'var(--navy, #0f2b44)', fontWeight: 800, textDecoration: 'underline' }}>Vezi abonamentele →</Link>
      </span>
      <button type="button" onClick={() => setLockInfo(false)} aria-label="Închide"
        style={{ background: 'none', border: '1px solid #f1d27a', borderRadius: 7, color: '#5d4500', padding: '2px 8px', cursor: 'pointer' }}>✕</button>
    </div>
  );
  const errJsx = err && (
    <div role="alert" style={{
      background: '#fdecea', color: '#8a2b25', border: '1px solid #f5c6c2', borderRadius: 10,
      padding: '7px 10px', fontSize: '.78rem', display: 'flex', gap: 8, alignItems: 'center',
      boxShadow: '0 3px 12px rgba(15,43,68,.12)', pointerEvents: 'auto',
    }}>
      <span style={{ flex: 1 }}>{err}</span>
      <button type="button" onClick={() => setErr(null)} aria-label="Închide eroarea"
        style={{ background: 'none', border: '1px solid #f5c6c2', borderRadius: 7, color: '#8a2b25', padding: '2px 8px', cursor: 'pointer' }}>✕</button>
    </div>
  );

  const corectTitle = corectLocked
    ? 'Corectarea scrisului de mână face parte din abonamentul Premium'
    : 'Profesorul virtual îți citește scrisul și îl corectează după barem';

  // ── ÎN ZONA DE CONVERSAȚIE (vizualizatorul PDF) ─────────────────────────
  // Fără fereastră, antet și mânere: foaia ia locul mesajelor din chat. Sus,
  // un rând de unelte în stilul barei chatului; jos, după ce elevul scrie,
  // butoanele care trimit scrisul (plutitoare, ca foaia să rămână liberă).
  if (embedded) {
    const barBtn = (on) => ({
      background: on ? 'var(--gold, #e8b931)' : 'none',
      border: '1px solid ' + (on ? 'var(--gold, #e8b931)' : 'var(--border, #dde1e8)'),
      color: on ? 'var(--navy, #0f2b44)' : 'var(--text-light, #5a6170)',
      borderRadius: 8, padding: mic ? '4px 8px' : '4px 10px', fontSize: '.76rem', fontWeight: 600,
      cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.35, flexShrink: 0,
    });
    const chip = {
      pointerEvents: 'auto', borderRadius: 20, padding: '7px 13px', fontSize: '.8rem', fontWeight: 800,
      cursor: 'pointer', whiteSpace: 'nowrap', boxShadow: '0 3px 12px rgba(15,43,68,.18)',
    };
    const dot = (c, on) => ({
      width: 20, height: 20, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0, flexShrink: 0,
      border: on ? '3px solid var(--gold, #e8b931)' : '2px solid #fff', boxShadow: '0 0 0 1px #cfd8e3',
    });
    return (
      <div aria-label="Spațiu de lucru" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', background: SHEET_BG }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: mic ? 4 : 6, padding: '8px 12px', background: '#fff',
          borderBottom: '1px solid var(--border, #dde1e8)', flexShrink: 0, overflowX: 'auto', scrollbarWidth: 'none',
        }}>
          <button type="button" style={barBtn(tool === 'pen')} onClick={() => setTool('pen')} title="Scrie cu degetul sau cu creionul" aria-label="Scrie">{mic ? '✎' : '✎ Scrie'}</button>
          <button type="button" style={barBtn(tool === 'eraser')} onClick={() => setTool('eraser')} title="Șterge ce ai scris" aria-label="Radieră">{mic ? '◯' : '◯ Radieră'}</button>
          <button type="button" style={barBtn(tool === 'pan')} onClick={() => setTool('pan')} title="Trage foaia în dreapta, în stânga, în sus sau în jos (merge și cu două degete)" aria-label="Derulează">{mic ? '✋' : '✋ Derulează'}</button>
          {mic ? (
            // pe ecran îngust, o singură bulină: fiecare apăsare trece la culoarea următoare
            <button type="button" onClick={() => { setColor(COLORS[(COLORS.indexOf(color) + 1) % COLORS.length]); setTool('pen'); }}
              aria-label="Schimbă culoarea" title="Schimbă culoarea" style={dot(color, false)} />
          ) : COLORS.map((c) => (
            <button type="button" key={c} onClick={() => { setColor(c); setTool('pen'); }} aria-label={'Culoare ' + c} style={dot(c, color === c)} />
          ))}
          <button type="button" style={barBtn(false)} onClick={undo} title="Anulează ultima schimbare (Ctrl+Z)" aria-label="Înapoi">{mic ? '↩' : '↩ Înapoi'}</button>
          <button type="button" style={barBtn(false)} onClick={clearAll} title="Șterge tot ce ai scris (se poate anula cu ↩)" aria-label="Șterge tot">{mic ? '🗑' : '✕ Șterge tot'}</button>
          <button type="button" onClick={newPage}
            title="O pagină goală, în dreapta a tot ce ai scris — te întorci trăgând foaia înapoi sau cu ◀"
            aria-label="Pagină nouă"
            style={{ ...barBtn(false), marginLeft: 'auto', fontWeight: 800, color: 'var(--navy, #0f2b44)' }}>
            {mic ? '➕' : '➕ Pagină nouă'}
          </button>
        </div>

        {sheetJsx}

        {/* jos, plutitoare: mesajele și butoanele care trimit scrisul */}
        <div style={{
          position: 'absolute', left: 10, right: 10, bottom: mic ? 50 : 10, display: 'flex', flexDirection: 'column',
          alignItems: 'flex-end', gap: 6, pointerEvents: 'none', zIndex: 3,
        }}>
          {lockJsx}
          {errJsx}
          {hasInk && (onCorect || onAttach) && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end', marginLeft: mic ? 0 : 150 }}>
              {onCorect && (
                <button type="button" disabled={!!busy}
                  style={{ ...chip, background: 'var(--gold, #e8b931)', color: 'var(--navy, #0f2b44)', border: 'none', ...(busy ? { opacity: 0.6, cursor: 'progress' } : {}) }}
                  onClick={() => act('corect')} title={corectTitle}>
                  {busy === 'corect' ? '⏳ Pregătesc foaia…' : `🎓 Cere corectarea${corectLocked ? ' ⭐' : ''}`}
                </button>
              )}
              {onAttach && (
                <button type="button" disabled={!!busy}
                  style={{ ...chip, background: '#fff', color: '#8a6d00', border: '1px solid #e8b931', ...(busy ? { opacity: 0.6, cursor: 'progress' } : {}) }}
                  onClick={() => act('attach')} title="Scrisul tău pleacă la profesor ca imagine, împreună cu ce scrii în câmpul de jos">
                  {busy === 'attach' ? '⏳' : attachLabel}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── ÎN FEREASTRĂ (exerciții interactive, „Planul meu", sala live) ───────
  const toolBtn = (on) => ({
    background: on ? 'var(--gold, #e8b931)' : '#fff',
    border: '1px solid ' + (on ? 'var(--gold, #e8b931)' : '#d7dee7'),
    color: on ? '#12263a' : '#44566b',
    borderRadius: 9, padding: narrow ? '5px 9px' : '6px 11px', fontSize: '.8rem', fontWeight: 700,
    cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.2, flexShrink: 0,
  });
  const actBtn = {
    background: 'var(--gold, #e8b931)', color: '#12263a', border: 'none', borderRadius: 10,
    padding: narrow ? '8px 12px' : '9px 16px', fontSize: narrow ? '.82rem' : '.86rem', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const ghostBtn = { ...actBtn, background: '#fff', border: '1px solid #e8b931', color: '#8a6d00', fontWeight: 700 };
  const off = !hasInk || !!busy;

  // mânerele ferestrei (calculator): liniuța widgetului pe mijlocul fiecărei
  // margini + colțurile; aceeași liniuță, aurie, cât tragi
  const bara = (vert) => ({
    width: vert ? 6 : 48, height: vert ? 48 : 6, borderRadius: 4,
    background: dragging ? 'var(--gold, #e8b931)' : 'var(--navy, #0f2b44)',
    opacity: dragging ? 1 : 0.5, boxShadow: '0 0 0 2px #fff, 0 2px 6px rgba(15,43,68,.25)', pointerEvents: 'none',
  });
  const grip = (kind, pos, title) => (
    <div key={kind} role="separator" aria-orientation={kind === 'e' || kind === 'w' ? 'vertical' : 'horizontal'}
      aria-label={title} title={`${title} · dublu-clic pe antet: tot ecranul`} {...dragProps(kind)}
      style={{
        position: 'absolute', zIndex: 4, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
        cursor: GRIP_CURSOR[kind], display: 'flex', alignItems: 'center', justifyContent: 'center', ...pos,
      }}>
      {(kind === 'e' || kind === 'w') && <span aria-hidden style={bara(true)} />}
      {(kind === 's') && <span aria-hidden style={bara(false)} />}
    </div>
  );

  return (
    <>
    <div
      ref={dialogRef}
      role="dialog" aria-modal="false" aria-label="Spațiu de lucru"
      style={{
        position: 'fixed', zIndex: 100000, left: winX, top: winY, width: winW, height: winH,
        background: '#fff', borderRadius: narrow ? '14px 14px 0 0' : 14,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        boxShadow: '0 18px 60px rgba(0,0,0,.35), 0 0 0 1px rgba(15,43,68,.14)',
      }}>

        <div
          onDoubleClick={() => setMaxi((v) => !v)}
          {...(narrow ? dragProps('sheet') : dragProps('move'))}
          title={narrow
            ? 'Trage bara în sus sau în jos ca să mărești sau să micșorezi foaia · dublu-clic: tot ecranul'
            : 'Trage de aici ca să muți fereastra · dublu-clic: tot ecranul'}
          style={{
            background: 'var(--navy, #0f2b44)', color: '#fff', padding: narrow ? '12px 10px 7px' : '9px 14px',
            display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, position: 'relative',
            cursor: maxi ? 'default' : narrow ? 'ns-resize' : (dragging === 'move' ? 'grabbing' : 'grab'),
            touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none',
          }}>
          {/* pe telefon, bara e mânerul (ca la panoul profesorului): liniuța de sus */}
          {narrow && !maxi && (
            <span aria-hidden style={{
              position: 'absolute', top: 4, left: '50%', transform: 'translateX(-50%)',
              width: 44, height: 4, borderRadius: 3, background: 'rgba(255,255,255,.5)',
            }} />
          )}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '.95rem' }}>✍️ Spațiu de lucru</div>
            {title && (
              <div style={{ fontSize: '.72rem', opacity: .82, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </div>
            )}
          </div>
          <button type="button" onClick={() => setMaxi((v) => !v)} aria-label={maxi ? 'Micșorează fereastra' : 'Mărește fereastra pe tot ecranul'}
            title={maxi ? 'Micșorează fereastra' : 'Pe tot ecranul'}
            style={{
              background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8,
              padding: '5px 10px', fontSize: '.9rem', fontWeight: 700, cursor: 'pointer', lineHeight: 1,
            }}>{maxi ? '⤵' : '⛶'}</button>
          <button type="button" onClick={onClose} aria-label="Închide spațiul de lucru" style={{
            background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8,
            padding: '5px 11px', fontSize: '.85rem', fontWeight: 700, cursor: 'pointer',
          }}>{narrow ? '✕' : '✕ Închide'}</button>
        </div>

        <div style={{
          display: 'flex', alignItems: 'center', gap: narrow ? 4 : 6, flexWrap: narrow ? 'nowrap' : 'wrap',
          overflowX: narrow ? 'auto' : 'visible', scrollbarWidth: 'none',
          padding: narrow ? '6px 8px' : '7px 12px', background: '#f2f6fa', borderBottom: '1px solid #dde4ec', flexShrink: 0,
        }}>
          {/* pe telefon: un singur rând, doar pictogramele (foaia rămâne mare) */}
          <button type="button" style={toolBtn(tool === 'pen')} onClick={() => setTool('pen')} title="Scrie cu degetul sau cu creionul" aria-label="Scrie">{narrow ? '✎' : '✎ Scrie'}</button>
          <button type="button" style={toolBtn(tool === 'eraser')} onClick={() => setTool('eraser')} title="Șterge ce ai scris" aria-label="Radieră">{narrow ? '◯' : '◯ Radieră'}</button>
          <button type="button" style={toolBtn(tool === 'pan')} onClick={() => setTool('pan')} title="Trage foaia în dreapta, în stânga, în sus sau în jos (merge și cu două degete)" aria-label="Derulează">{narrow ? '✋' : '✋ Derulează'}</button>
          {!narrow && <span style={{ width: 1, height: 20, background: '#cfd8e3', margin: '0 3px' }} />}
          {narrow ? (
            // o singură bulină: fiecare apăsare trece la culoarea următoare
            <button type="button" onClick={() => { setColor(COLORS[(COLORS.indexOf(color) + 1) % COLORS.length]); setTool('pen'); }}
              aria-label="Schimbă culoarea" title="Schimbă culoarea"
              style={{ width: 22, height: 22, borderRadius: '50%', background: color, cursor: 'pointer', padding: 0, flexShrink: 0, border: '2px solid #fff', boxShadow: '0 0 0 1px #cfd8e3' }} />
          ) : COLORS.map((c) => (
            <button type="button" key={c} onClick={() => { setColor(c); setTool('pen'); }} aria-label={'Culoare ' + c}
              style={{
                width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                border: color === c ? '3px solid var(--gold, #e8b931)' : '2px solid #fff',
                boxShadow: '0 0 0 1px #cfd8e3',
              }} />
          ))}
          {!narrow && <span style={{ width: 1, height: 20, background: '#cfd8e3', margin: '0 3px' }} />}
          <button type="button" style={toolBtn(false)} onClick={undo} title="Anulează ultima schimbare (Ctrl+Z)" aria-label="Înapoi">{narrow ? '↩' : '↩ Înapoi'}</button>
          <button type="button" style={toolBtn(false)} onClick={clearAll} title="Șterge tot ce ai scris (se poate anula cu ↩)" aria-label="Șterge tot">{narrow ? '🗑' : '✕ Șterge tot'}</button>
          <button type="button" onClick={newPage}
            title="O pagină goală, în dreapta a tot ce ai scris — te întorci trăgând foaia înapoi sau cu ◀"
            aria-label="Pagină nouă"
            style={{ ...toolBtn(false), marginLeft: 'auto', fontWeight: 800, color: '#12263a', borderColor: '#e8b931' }}>
            {narrow ? '➕' : '➕ Pagină nouă'}
          </button>
        </div>

        {/* ── Enunțul exercițiului ── */}
        {enuntText && (
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', borderBottom: '1px solid #dde4ec', background: '#fbfdff' }}>
            <button
              type="button"
              onClick={toggleEnunt}
              aria-expanded={enuntOpen}
              style={{
                display: 'flex', alignItems: 'center', gap: 7, width: '100%', textAlign: 'left',
                background: '#eef4fb', border: 'none', borderBottom: enuntOpen ? '1px solid #dde4ec' : 'none',
                padding: '5px 12px', cursor: 'pointer', color: '#1a4d80', fontWeight: 700, fontSize: '.78rem',
              }}>
              <span style={{ transform: enuntOpen ? 'rotate(90deg)' : 'none', transition: 'transform .15s', display: 'inline-block' }}>▸</span>
              📄 Enunțul exercițiului
              <span style={{ marginLeft: 'auto', fontWeight: 600, opacity: .7 }}>{enuntOpen ? 'ascunde' : 'arată'}</span>
            </button>
            {enuntOpen && (
              <>
                <div style={{
                  height: Math.min(enuntH, Math.round(winH * enuntFrac)),
                  overflowY: 'auto', overflowX: 'auto', overscrollBehavior: 'contain', padding: '8px 12px',
                }}>
                  <TextEnunt text={enuntText} />
                  {figura && <img src={figura} alt="Desenul din subiect" style={{ display: 'block', maxWidth: '100%', maxHeight: 240, margin: '8px auto 0' }} />}
                </div>
                {/* mânerul de tras: cât de mult din fereastră ocupă enunțul */}
                <div
                  onPointerDown={startEnuntResize} onPointerMove={moveEnuntResize}
                  onPointerUp={endEnuntResize} onPointerCancel={endEnuntResize}
                  title="Trage ca să vezi mai mult sau mai puțin din enunț"
                  style={{
                    height: 11, cursor: 'ns-resize', touchAction: 'none', background: '#eef4fb',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                  <span style={{ width: 46, height: 3, borderRadius: 3, background: '#b9c9dc' }} />
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Foaia ── */}
        {sheetJsx}

        {(lockJsx || errJsx) && (
          <div style={{ padding: '6px 12px 0', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0, background: '#fff', borderTop: '1px solid #dde4ec' }}>
            {lockJsx}
            {errJsx}
          </div>
        )}

        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: narrow ? '7px 10px 14px' : '9px 12px', borderTop: (lockJsx || errJsx) ? 'none' : '1px solid #dde4ec', background: '#fff', flexShrink: 0,
        }}>
          {onCorect && (
            <button type="button" style={{ ...actBtn, ...(off ? { opacity: 0.6, cursor: busy ? 'progress' : 'default' } : {}) }}
              disabled={off}
              onClick={() => act('corect')}
              title={corectTitle}>
              {busy === 'corect' ? '⏳ Pregătesc foaia…' : `🎓 Cere corectarea${corectLocked ? ' ⭐' : ''}`}
            </button>
          )}
          {onAttach && (
            <button type="button" style={{ ...ghostBtn, ...(off ? { opacity: 0.6, cursor: busy ? 'progress' : 'default' } : {}) }}
              disabled={off}
              onClick={() => act('attach')}
              aria-label={attachLabel}
              title={`${attachLabel} — scrisul tău pleacă la profesor ca imagine`}>
              {busy === 'attach' ? '⏳' : (narrow && onCorect ? '📎' : attachLabel)}
            </button>
          )}
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: '.74rem', color: '#6b7c8f', display: narrow && (onCorect || onAttach) ? 'none' : undefined }}>
            {hasInk
              ? 'Mergi mai departe în dreapta: trage foaia cu ✋ sau cu două degete, ori apasă ▶ / „➕ Pagină nouă".'
              : 'Scrie oriunde pe foaie — e albă și continuă în dreapta cât vrei.'}
          </span>
        </div>
        {/* ── Mânerele ferestrei, ca la widget: ORICE margine și orice colț ── */}
        {/* (pe telefon, mânerul e bara albastră de sus — vezi antetul) */}
        {!maxi && !narrow && (
          <>
            {grip('w', { left: 0, top: 50, bottom: 24, width: 14 }, 'Trage marginea din stânga ca să lățești sau să îngustezi fereastra')}
            {grip('e', { right: 0, top: 50, bottom: 24, width: 14 }, 'Trage marginea din dreapta ca să lățești sau să îngustezi fereastra')}
            {grip('n', { top: 0, left: 24, right: 24, height: 6 }, 'Trage marginea de sus ca să înalți fereastra')}
            {grip('s', { bottom: 0, left: 24, right: 24, height: 12 }, 'Trage marginea de jos ca să înalți fereastra')}
            {grip('nw', { left: 0, top: 0, width: 16, height: 16 }, 'Trage colțul ca să redimensionezi fereastra')}
            {grip('ne', { right: 0, top: 0, width: 16, height: 16 }, 'Trage colțul ca să redimensionezi fereastra')}
            {grip('sw', { left: 0, bottom: 0, width: 22, height: 22 }, 'Trage colțul ca să redimensionezi fereastra')}
            {grip('se', {
              right: 0, bottom: 0, width: 22, height: 22,
              backgroundImage: 'linear-gradient(135deg, transparent 48%, #b9c9dc 48%, #b9c9dc 56%, transparent 56%, transparent 70%, #b9c9dc 70%, #b9c9dc 78%, transparent 78%)',
            }, 'Trage colțul ca să redimensionezi fereastra')}
          </>
        )}
    </div>
    {/* cât tragi, un strat transparent acoperă pagina: exercițiul / PDF-ul sunt
        în iframe-uri, care altfel „fură" mișcarea mouse-ului (ca la ManerLatime) */}
    {dragging && <div aria-hidden style={{ position: 'fixed', inset: 0, zIndex: 100001, cursor: GRIP_CURSOR[dragging] || 'default' }} />}
    </>
  );
}
