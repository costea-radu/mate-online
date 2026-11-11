// =====================================================================
// src/components/RezolvarePdf.jsx — „✏️ Rezolvă pe PDF" (7 nov. 2026)
//
// O „foaie de lucru INVIZIBILĂ" peste paginile PDF-ului de Evaluare Națională:
// elevul încercuiește litera la grilele de la Subiectele I și II și scrie
// rezolvarea la Subiectul al III-lea direct pe pagină (degetul, creionul sau
// mouse-ul). PDF-ul rămâne PDF: zoom, două degete, „⤢ Pagina întreagă", 📋 Barem,
// Profesorul Virtual — toate rămân; scrisul stă într-un strat transparent, câte
// unul pe pagină (PdfCanvasViewer → `overlay`).
//
// Aici:
//   createInkStore()   — traseele pe pagini, „↩ Înapoi", ciorna (localStorage);
//   InkPage            — stratul unei pagini: scrisul, radiera, etichetele
//                        recunoașterii („b)", „✍️") și ale corectării („✔ 5p");
//   useRezolvarePdf()  — harta testului (din textul PDF-ului), recunoașterea,
//                        cererea de corectare + imaginile, PDF-ul descărcat;
//   rezolvareToolbar / RezolvareFooter — uneltele (în bara de zoom) și „✅ Corectează"
//                        de după ultima pagină.
// Corectarea o pornește src/pages/PDFViewer.jsx (api/rezolva-pdf.js); logica
// pură e în src/lib/pdfRezolvare.js.
// =====================================================================
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import '@fontsource/caveat/700.css';   // scrisul de mână al notei (roșu, pe prima pagină)
import { loadPdfJs } from '../lib/pdfjs';
import {
  PEN_PT, INK_COLORS, boxOf, nearStroke, inkPath, buildExamMap, readTextPages, recognize,
  correctionPlan, recognitionSummary, cropPlan, cropLabels, readDraft, saveDraft, renderCrop,
  canvasJpeg, thumbOf, exportInkPdf, itemShort, notaScrisa, pozitieNota, latimeNota, veziNota, notaPeEcran,
} from '../lib/pdfRezolvare';

// ─── NOTA, scrisă cu roșu pe test (8 nov. 2026) ───────────────────────────────
// „7,30 (șapte³⁰)" pe prima pagină, sus în dreapta, ca pe o lucrare corectată.
// `vechi` = elevul a mai scris după corectare: nota se estompează până la
// următorul „✅ Corectează".
const ROSU = '#d32f2f';
const FONT_MANA = "Caveat, 'Segoe Script', 'Bradley Hand', cursive";
export function NotaRosie({ nota, w, h, vechi = false, cutii = null }) {
  const ns = notaScrisa(nota);
  const size0 = pozitieNota(w, h).size;
  const P = useMemo(() => pozitieNota(w, h, { cutii, latime: latimeNota(ns, size0) }), [w, h, cutii, nota]); // eslint-disable-line react-hooks/exhaustive-deps
  const textRef = useRef(null);
  const [tw, setTw] = useState(() => latimeNota(ns, P.size));
  // lățimea adevărată, după ce fontul de mână s-a încărcat (sublinierea o urmează)
  useLayoutEffect(() => {
    let viu = true;
    const masoara = () => { try { const b = textRef.current && textRef.current.getBBox(); if (viu && b && b.width > 0) setTw(b.width); } catch { /* jsdom */ } };
    masoara();
    try { document.fonts && document.fonts.load(`700 ${Math.round(P.size)}px Caveat`).then(masoara).catch(() => {}); } catch { /* fără API de fonturi */ }
    return () => { viu = false; };
  }, [nota, P.size]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ns) return null;
  const s = P.size;
  const sus = ns.zecimale ? s * 0.38 : 0;
  return (
    <g pointerEvents="none" transform={`rotate(${P.rot} ${P.x} ${P.y})`} opacity={vechi ? 0.4 : 1} className="nota-rosie">
      <title>{`Nota ${ns.cifre}${vechi ? ' (de la corectarea de dinainte)' : ''}`}</title>
      <text ref={textRef} x={P.x} y={P.y} textAnchor="end" fontFamily={FONT_MANA} fontWeight="700" fontSize={s} fill={ROSU}>
        {ns.cifre}{' '}
        <tspan fontSize={s * 0.82}>({ns.cuvant}</tspan>
        {ns.zecimale ? <tspan fontSize={s * 0.5} dy={-sus}>{ns.zecimale}</tspan> : null}
        <tspan fontSize={s * 0.82} dy={sus}>)</tspan>
      </text>
      <path d={`M ${P.x - tw - s * 0.08} ${P.y + s * 0.2} Q ${P.x - tw / 2} ${P.y + s * 0.34} ${P.x + s * 0.06} ${P.y + s * 0.14}`}
        stroke={ROSU} strokeWidth={Math.max(1, s * 0.055)} fill="none" strokeLinecap="round" />
    </g>
  );
}

// Aceeași notă, desenată pe o pânză (pentru PDF-ul descărcat) → { png, x, y, w, h } în puncte
async function notaPng(nota, W, H, { k = 4, cutii = null } = {}) {
  const ns = notaScrisa(nota);
  if (!ns || typeof document === 'undefined') return null;
  const s0 = pozitieNota(W, H).size;
  const P = pozitieNota(W, H, { cutii, latime: latimeNota(ns, s0) });
  const s = P.size;
  try { if (document.fonts) await document.fonts.load(`700 ${Math.round(s * k)}px Caveat`); } catch { /* fontul de rezervă */ }
  const est = latimeNota(ns, s);
  const boxW = est * 1.25 + s, boxH = s * 2.6;
  const left = P.x - est * 1.2 - s * 0.5, top = P.y - s * 1.7;
  const c = document.createElement('canvas');
  c.width = Math.ceil(boxW * k); c.height = Math.ceil(boxH * k);
  const ctx = c.getContext('2d');
  ctx.scale(k, k);
  ctx.translate(P.x - left, P.y - top);          // originea = ancora notei
  ctx.rotate((P.rot * Math.PI) / 180);
  ctx.fillStyle = ROSU; ctx.strokeStyle = ROSU; ctx.textBaseline = 'alphabetic';
  const piese = [
    { t: `${ns.cifre} `, f: s, dy: 0 },
    { t: `(${ns.cuvant}`, f: s * 0.82, dy: 0 },
    ...(ns.zecimale ? [{ t: ns.zecimale, f: s * 0.5, dy: -s * 0.38 }] : []),
    { t: ')', f: s * 0.82, dy: 0 },
  ];
  const latime = (p) => { ctx.font = `700 ${p.f}px Caveat, 'Segoe Script', cursive`; return ctx.measureText(p.t).width; };
  const total = piese.reduce((a, p) => a + latime(p), 0);
  let x = -total;
  for (const p of piese) {
    ctx.font = `700 ${p.f}px Caveat, 'Segoe Script', cursive`;
    ctx.fillText(p.t, x, p.dy);
    x += ctx.measureText(p.t).width;
  }
  ctx.lineWidth = Math.max(1, s * 0.055); ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-total - s * 0.08, s * 0.2); ctx.quadraticCurveTo(-total / 2, s * 0.34, s * 0.06, s * 0.14); ctx.stroke();
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  if (!blob) return null;
  return { png: new Uint8Array(await blob.arrayBuffer()), x: left, y: top, w: boxW, h: boxH };
}

const MAX_HISTORY = 300;
const ERASER_PX = 10;                 // raza radierei, în px de ecran

// ═════════════════════════════ traseele ═════════════════════════════
export function createInkStore() {
  const st = {
    key: null, ink: {}, nextId: 1, history: [], batch: null, result: null, startedAt: null,
    penSeen: false, subs: new Map(), all: new Set(), saveT: null,
    // degetele de pe ecran, pe TOATE paginile: al doilea deget (chiar pe altă pagină)
    // oprește scrisul — e o derulare / un zoom cu două degete
    touches: new Set(),
  };
  const emit = (p) => {
    (st.subs.get(String(p)) || new Set()).forEach((f) => f());
    st.all.forEach((f) => f());
  };
  const persist = () => {
    clearTimeout(st.saveT);
    st.saveT = setTimeout(() => { if (st.key) saveDraft(st.key, { ink: st.ink, result: st.result, startedAt: st.startedAt }); }, 400);
  };
  const api = {
    get ink() { return st.ink; },
    get result() { return st.result; },
    get penSeen() { return st.penSeen; },
    set penSeen(v) { st.penSeen = !!v; },
    get touches() { return st.touches; },
    get canUndo() { return st.history.length > 0; },
    get hasInk() { return Object.values(st.ink).some((l) => l && l.length); },
    get startedAt() { return st.startedAt; },
    page: (p) => st.ink[p] || [],
    load(key) {
      if (st.key === key) return;
      api.flush();
      st.key = key; st.history = []; st.batch = null;
      const d = key ? readDraft(key) : null;
      st.ink = d ? d.ink : {};
      st.nextId = (d ? d.maxId : 0) + 1;
      st.result = d ? d.result : null;
      st.startedAt = d ? d.startedAt : null;
      Object.keys(st.ink).forEach(emit);
      st.all.forEach((f) => f());
    },
    flush() {
      if (st.saveT) { clearTimeout(st.saveT); st.saveT = null; if (st.key) saveDraft(st.key, { ink: st.ink, result: st.result, startedAt: st.startedAt }); }
    },
    subscribe(p, f) {
      const k = String(p);
      if (!st.subs.has(k)) st.subs.set(k, new Set());
      st.subs.get(k).add(f);
      return () => st.subs.get(k).delete(f);
    },
    subscribeAll(f) { st.all.add(f); return () => st.all.delete(f); },
    add(p, s) {
      const stroke = { id: st.nextId++, c: s.c, w: s.w || PEN_PT, pts: s.pts };
      stroke.box = boxOf(stroke.pts);
      st.ink = { ...st.ink, [p]: [...(st.ink[p] || []), stroke] };
      if (!st.startedAt) st.startedAt = Date.now();
      st.history.push({ t: 'add', p, id: stroke.id });
      if (st.history.length > MAX_HISTORY) st.history.shift();
      emit(p); persist();
    },
    beginBatch() { st.batch = []; },
    endBatch() {
      if (st.batch && st.batch.length) {
        st.history.push({ t: 'erase', list: st.batch });
        if (st.history.length > MAX_HISTORY) st.history.shift();
        persist();
      }
      st.batch = null;
    },
    eraseNear(p, x, y, r) {
      const list = st.ink[p] || [];
      const keep = [], gone = [];
      for (const s of list) {
        const b = s.box || (s.box = boxOf(s.pts));
        if (x < b.x0 - r || x > b.x1 + r || y < b.y0 - r || y > b.y1 + r || !nearStroke(s.pts, x, y, r)) keep.push(s); else gone.push(s);
      }
      if (!gone.length) return;
      st.ink = { ...st.ink, [p]: keep };
      if (st.batch) gone.forEach((s) => st.batch.push({ p, s }));
      else { st.history.push({ t: 'erase', list: gone.map((s) => ({ p, s })) }); persist(); }
      emit(p);
    },
    clearAll() {
      const list = [];
      for (const [p, arr] of Object.entries(st.ink)) (arr || []).forEach((s) => list.push({ p: Number(p), s }));
      if (!list.length) return;
      const pages = Object.keys(st.ink);
      st.ink = {};
      st.history.push({ t: 'erase', list });
      pages.forEach(emit); persist();
    },
    undo() {
      const h = st.history.pop();
      if (!h) return;
      if (h.t === 'add') {
        st.ink = { ...st.ink, [h.p]: (st.ink[h.p] || []).filter((s) => s.id !== h.id) };
        emit(h.p);
      } else {
        const touched = new Set();
        const next = { ...st.ink };
        for (const { p, s } of h.list) { next[p] = [...(next[p] || []), s]; touched.add(String(p)); }
        for (const p of touched) next[p] = next[p].slice().sort((a, b) => a.id - b.id);
        st.ink = next;
        touched.forEach(emit);
      }
      persist();
    },
    setResult(r) { st.result = r; st.all.forEach((f) => f()); persist(); },
  };
  return api;
}

// ═════════════════════════════ etichetele ═════════════════════════════
const TONES = {
  neutru: { bg: '#fff7d6', bd: '#d4a514', fg: '#5c4500' },
  ok: { bg: '#e7f6ea', bd: '#2e7d32', fg: '#1b5e20' },
  rau: { bg: '#fdecea', bd: '#c62828', fg: '#8e1b1b' },
  partial: { bg: '#fff1dc', bd: '#ef8f00', fg: '#7a4a00' },
  atentie: { bg: '#fff1dc', bd: '#ef8f00', fg: '#7a4a00' },
  scris: { bg: '#eaf2fd', bd: '#1565c0', fg: '#0d3c7a' },
  blocat: { bg: '#f1ecfb', bd: '#7e57c2', fg: '#4a2c8a' },
};
const toneOf = (v) => (v === 'corect' ? 'ok' : v === 'partial' ? 'partial' : v === 'gresit' ? 'rau' : v === 'blocat' ? 'blocat' : v === 'necompletat' ? 'atentie' : 'scris');
const fmt = (n) => String(Math.round(n * 100) / 100).replace('.', ',');

// eticheta în marginea din stânga a rândului (x, y = colțul rândului: stânga, linia de bază)
function chipAt(anchor, text, tone, size = 8) {
  const w = Math.max(14, [...text].reduce((a, ch) => a + (/[✀-➿⭐\u{1F300}-\u{1FAFF}]/u.test(ch) ? size * 1.15 : /[mwMW]/.test(ch) ? size * 0.75 : size * 0.55), 0) + 7);
  const h = size + 4;
  let x = anchor.x - 4 - w;
  if (x < 2) x = 2;
  const y = anchor.y - (anchor.h || 11) * 0.82 - 1;
  return { x, y, w, h, text, tone, size };
}

// marcajele fiecărei pagini: recunoașterea (înainte de corectare) sau corectarea
export function computeMarks(map, rec, result) {
  const by = {};
  if (!map || !map.ok) return by;
  const push = (p, m) => { (by[p] || (by[p] = [])).push(m); };
  const res = result && result.byKey ? result : null;
  for (const key of map.order) {
    const it = map.items[key];
    const r = rec && rec.items[key];
    if (!r || !r.n) continue;
    const done = res && res.byKey[key] && res.sigs && res.sigs[key] === r.sig ? res.byKey[key] : null;
    const a = it.anchor;
    if (done) {
      if (done.verdict === 'blocat') { push(a.p, chipAt(a, '⭐', 'blocat')); continue; }
      const pts = done.puncte != null && done.puncte_max != null ? `${fmt(done.puncte)}/${fmt(done.puncte_max)}p` : '';
      // (fără „◐": unele fonturi îl desenează ca un semicerc tăiat — punctajul parțial e portocaliu)
      const ic = done.verdict === 'corect' ? '✔' : done.verdict === 'gresit' ? '✖' : done.verdict === 'partial' ? '' : '?';
      push(a.p, chipAt(a, it.tip === 'grila' ? `${ic} ${done.puncte != null ? `${fmt(done.puncte)}p` : ''}`.trim() : `${ic} ${pts}`.trim(), toneOf(done.verdict)));
      if (it.tip !== 'grila') {
        for (const part of it.parts || []) {
          const dp = (done.parti || []).find((x) => x.l === part.l);
          if (!dp || dp.puncte == null || dp.puncte_max == null) continue;
          push(part.p, chipAt(part, `${fmt(dp.puncte)}/${fmt(dp.puncte_max)}p`, toneOf(dp.verdict), 7.5));
        }
      }
      continue;
    }
    if (it.tip === 'grila') {
      if (r.letters && r.letters.length === 1) push(a.p, chipAt(a, `${r.letters[0]})`, 'neutru'));
      else if (r.letters && r.letters.length > 1) push(a.p, chipAt(a, `⚠ ${r.letters.join(' ')}`, 'atentie'));
      else push(a.p, chipAt(a, '?', 'atentie'));
    } else {
      push(a.p, chipAt(a, '✍️', 'scris'));
    }
  }
  return by;
}

// ═════════════════════════════ stratul unei pagini ═════════════════════════════
export function InkPage({ n, w, h, store, tool, color, marks, nota = null }) {
  const svgRef = useRef(null);
  const curRef = useRef(null);
  const drawRef = useRef(null);
  const touches = store.touches;
  // degetele puse pe ACEASTĂ pagină: la redesenarea paginilor (zoom cu două degete)
  // stratul se montează din nou, iar ridicarea degetelor de pe stratul vechi nu mai
  // ajunge la noi — le scoatem din numărătoare la demontare
  const mine = useRef(new Set());
  const [, force] = useState(0);
  useEffect(() => store.subscribe(n, () => force((x) => x + 1)), [store, n]);
  useEffect(() => () => { mine.current.forEach((id) => touches.delete(id)); mine.current.clear(); }, [touches]);
  const strokes = store.page(n);
  const off = tool === 'pan';

  const rect = () => svgRef.current.getBoundingClientRect();
  const toPage = (e, r = rect()) => [(e.clientX - r.left) * (w / r.width), (e.clientY - r.top) * (h / r.height)];
  const eraseAt = (x, y, r = rect()) => store.eraseNear(n, x, y, ERASER_PX * (w / r.width));

  function abandon() {
    const d = drawRef.current;
    drawRef.current = null;
    if (!d) return;
    if (d.eraser) { store.endBatch(); return; }
    if (curRef.current) curRef.current.setAttribute('d', '');
    // al doilea deget abia a atins: trasul de-abia început era o derulare → se anulează
    const recent = performance.now() - d.t0 < 400 || d.pts.length < 10;
    if (!recent) store.add(n, { c: d.c, w: d.w, pts: d.pts });
  }
  function onDown(e) {
    if (off) return;
    if (e.pointerType === 'touch') {
      touches.add(e.pointerId); mine.current.add(e.pointerId);
      if (touches.size >= 2) { abandon(); return; }   // două degete → derulare / zoom (PdfCanvasViewer)
    }
    if (e.pointerType === 'pen') store.penSeen = true;
    if (store.penSeen && e.pointerType === 'touch') return;   // cu creionul: palma sprijinită nu scrie
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (drawRef.current) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* merge și fără */ }
    const r = rect();
    const [x, y] = toPage(e, r);
    const eraser = tool === 'eraser' || e.button === 5 || (e.buttons & 32) === 32;
    if (eraser) { drawRef.current = { eraser: true, ptr: e.pointerId }; store.beginBatch(); eraseAt(x, y, r); return; }
    drawRef.current = { ptr: e.pointerId, pts: [[x, y]], c: color, w: PEN_PT, t0: performance.now() };
    if (curRef.current) { curRef.current.setAttribute('stroke', color); curRef.current.setAttribute('d', inkPath(drawRef.current.pts)); }
  }
  function onMove(e) {
    const d = drawRef.current;
    if (!d || d.ptr !== e.pointerId) return;
    if (touches.size >= 2 && !d.eraser) { abandon(); return; }   // al doilea deget a atins altă pagină
    e.preventDefault();
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const list = evs && evs.length ? evs : [e];
    const r = rect();
    if (d.eraser) { for (const ev of list) { const [x, y] = toPage(ev, r); eraseAt(x, y, r); } return; }
    const step = 0.4 * (w / r.width);
    let changed = false;
    for (const ev of list) {
      const [x, y] = toPage(ev, r);
      const L = d.pts[d.pts.length - 1];
      if (Math.abs(x - L[0]) + Math.abs(y - L[1]) >= step) { d.pts.push([x, y]); changed = true; }
    }
    if (changed && curRef.current) curRef.current.setAttribute('d', inkPath(d.pts));
  }
  function onUp(e) {
    if (e.pointerType === 'touch') { touches.delete(e.pointerId); mine.current.delete(e.pointerId); }
    const d = drawRef.current;
    if (!d || d.ptr !== e.pointerId) return;
    drawRef.current = null;
    if (d.eraser) { store.endBatch(); return; }
    if (curRef.current) curRef.current.setAttribute('d', '');
    store.add(n, { c: d.c, w: d.w, pts: d.pts });
  }
  function onCancel(e) {
    if (e.pointerType === 'touch') { touches.delete(e.pointerId); mine.current.delete(e.pointerId); }
    if (drawRef.current && drawRef.current.ptr === e.pointerId) abandon();
  }

  return (
    <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" aria-hidden="true"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onCancel}
      onContextMenu={(e) => { if (!off) e.preventDefault(); }}
      style={{
        display: 'block', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%',
        pointerEvents: off ? 'none' : 'auto', touchAction: off ? 'auto' : 'none',
        cursor: tool === 'eraser' ? 'cell' : 'crosshair', userSelect: 'none', WebkitUserSelect: 'none',
      }}>
      <g fill="none" strokeLinecap="round" strokeLinejoin="round">
        {strokes.map((s) => <path key={s.id} d={s.d || (s.d = inkPath(s.pts))} stroke={s.c} strokeWidth={s.w || PEN_PT} />)}
        <path ref={curRef} stroke={color} strokeWidth={PEN_PT} />
      </g>
      <g pointerEvents="none" style={{ fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif', fontWeight: 700 }}>
        {(marks || []).map((m, i) => {
          const t = TONES[m.tone] || TONES.neutru;
          return (
            <g key={i}>
              <rect x={m.x} y={m.y} width={m.w} height={m.h} rx={m.h / 2} fill={t.bg} stroke={t.bd} strokeWidth={0.7} opacity={0.97} />
              <text x={m.x + m.w / 2} y={m.y + m.h / 2 + m.size * 0.36} fontSize={m.size} textAnchor="middle" fill={t.fg}>{m.text}</text>
            </g>
          );
        })}
      </g>
      {/* nota corectării, cu roșu, scrisă de mână (doar pe prima pagină) */}
      {nota && nota.v != null && <NotaRosie nota={nota.v} w={w} h={h} vechi={!!nota.vechi} cutii={nota.cutii || null} />}
    </svg>
  );
}

// ═════════════════════════════ controlerul ═════════════════════════════
// on — modul e pornit; data — ArrayBuffer-ul PDF-ului deschis; draftKey — cheia ciornei
export function useRezolvarePdf({ on, data, draftKey }) {
  const storeRef = useRef(null);
  if (!storeRef.current) storeRef.current = createInkStore();
  const store = storeRef.current;
  const [ver, setVer] = useState(0);
  useEffect(() => store.subscribeAll(() => setVer((v) => v + 1)), [store]);
  useEffect(() => { if (draftKey) store.load(draftKey); }, [draftKey, store]);
  // ciorna se scrie și la închiderea paginii
  useEffect(() => {
    const f = () => store.flush();
    window.addEventListener('pagehide', f);
    return () => { window.removeEventListener('pagehide', f); store.flush(); };
  }, [store]);

  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(INK_COLORS[0]);
  // Ctrl+Z / ⌘Z = „↩ Înapoi", cât e pornit modul
  useEffect(() => {
    if (!on) return undefined;
    const k = (e) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        e.preventDefault();
        store.undo();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [on, store]);
  const [map, setMap] = useState(null);
  const [mapState, setMapState] = useState('idle');   // idle | loading | ok | fail
  const mapFor = useRef(null);
  useEffect(() => {
    if (!on || !data) return undefined;
    if (mapFor.current === data && map) return undefined;
    let dead = false;
    setMapState('loading');
    (async () => {
      let doc = null;
      try {
        const pdfjs = await loadPdfJs();
        doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
        const m = buildExamMap(await readTextPages(doc));
        if (dead) return;
        mapFor.current = data;
        setMap(m);
        setMapState(m.ok ? 'ok' : 'fail');
      } catch (e) {
        console.warn('Rezolvă pe PDF — harta testului:', e);
        if (!dead) { setMap(null); setMapState('fail'); }
      } finally {
        try { doc && doc.destroy(); } catch { /* noop */ }
      }
    })();
    return () => { dead = true; };
  }, [on, data]); // eslint-disable-line react-hooks/exhaustive-deps

  const rec = useMemo(() => (map && map.ok ? recognize(map, store.ink) : null), [map, ver, store]); // eslint-disable-line react-hooks/exhaustive-deps
  const result = store.result;
  const marks = useMemo(() => computeMarks(map, rec, result), [map, rec, result]);
  const summary = useMemo(() => recognitionSummary(map, rec), [map, rec]);

  // ce pleacă la „✅ Corectează" (+ „semnătura" scrisului fiecărui item în clipa
  // cererii: ce scrie elevul cât așteaptă corectarea nu primește marcajul ei)
  function request() {
    const any = store.hasInk;
    const sigs = {};
    if (rec) for (const [k, v] of Object.entries(rec.items)) sigs[k] = v.sig;
    if (map && map.ok) {
      const plan = correctionPlan(map, rec);
      const n = plan.grile.length + plan.nerecunoscute.length + plan.scris.length;
      return { any: any && n > 0, harta: true, structura: map.signature, ...plan, outside: rec ? rec.unassigned : 0, sigs };
    }
    return { any, harta: false, structura: null, grile: [], nerecunoscute: [], scris: [], outside: 0, sigs };
  }

  // imaginile zonelor scrise (cu scrisul pe ele) + miniatura
  async function renderImages(req) {
    const pdfjs = await loadPdfJs();
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
    try {
      let geo = map && map.pages;
      if (!geo || !Object.keys(geo).length) {
        geo = {};
        for (let p = 1; p <= doc.numPages; p++) {
          // eslint-disable-next-line no-await-in-loop
          const pg = await doc.getPage(p);
          geo[p] = { W: pg.view[2] - pg.view[0], H: pg.view[3] - pg.view[1], x0: pg.view[0], top: pg.view[3] };
        }
      }
      const crops = (req.harta ? cropPlan(map, rec, store.ink, req.scris) : cropPlan({ pages: geo }, null, store.ink, null)).slice(0, 6);
      const labels = cropLabels(crops);
      const images = [];
      let thumb = null, total = 0;
      for (let i = 0; i < crops.length; i++) {
        // eslint-disable-next-line no-await-in-loop
        const cv = await renderCrop(doc, crops[i], store.page(crops[i].p));
        let url = canvasJpeg(cv, 0.86);
        if (url && total + url.length > 3_900_000) url = canvasJpeg(cv, 0.6);
        if (!url || total + url.length > 3_900_000) break;
        total += url.length;
        images.push({ url, label: labels[i] });
        if (!thumb) thumb = thumbOf(cv);
        cv.width = 0; cv.height = 0;
      }
      return { images, thumb };
    } finally {
      try { doc.destroy(); } catch { /* noop */ }
    }
  }

  // rezultatul corectării, ținut minte cu „semnătura" scrisului fiecărui item:
  // dacă elevul schimbă ceva la un item, marcajul lui dispare (până la o nouă corectare)
  function keepResult(r, sigs = {}) {
    const byKey = {};
    for (const it of (r && r.items) || []) byKey[it.key] = it;
    store.setResult({ byKey, sigs, score: r.score, total: r.total, nota: r.nota, complete: r.complete, gratuite: r.gratuite || null, at: Date.now() });
  }

  // fără abonament: câte corectări gratuite ale grilei au mai rămas (și când serverul
  // refuză cu 402 — elevul le-a folosit, poate pe alt test sau alt dispozitiv)
  function markGratuite(g) {
    if (!g) return;
    store.setResult({ ...(store.result || { byKey: {}, sigs: {} }), gratuite: g });
  }

  async function downloadPdf(title) {
    const geo = (map && map.pages) || await geoOf(data);
    // nota corectării, scrisă cu roșu pe prima pagină (ca pe ecran)
    let notaImg = null;
    const v = store.result && store.result.nota;
    if (v != null && geo && geo[1]) { try { notaImg = await notaPng(v, geo[1].W, geo[1].H, { cutii: (map && map.cutii1) || null }); } catch { notaImg = null; } }
    const bytes = await exportInkPdf(data, store.ink, geo, { notaImg });
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${String(title || 'test').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80)} — rezolvat.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const durationSec = () => (store.startedAt ? Math.round((Date.now() - store.startedAt) / 1000) : 0);

  // nota de la ultima corectare: estompată dacă elevul a mai scris de atunci
  const notaPag = useMemo(() => {
    const r = store.result;
    if (!r || r.nota == null) return null;
    const sigs = r.sigs || {};
    const vechi = !!rec && Object.entries(rec.items || {}).some(([k, it]) => it && it.n && sigs[k] !== it.sig);
    return { v: r.nota, vechi, cutii: (map && map.cutii1) || null };
  }, [store.result, rec, map]); // eslint-disable-line react-hooks/exhaustive-deps
  const overlay = ({ n, w, h }) => <InkPage n={n} w={w} h={h} store={store} tool={tool} color={color} marks={marks[n]} nota={n === 1 ? notaPag : null} />;

  return {
    store, ver, tool, setTool, color, setColor, map, mapState, rec, result, marks, summary, overlay,
    request, renderImages, keepResult, markGratuite, downloadPdf, durationSec,
    // 🔴 nota de pe test: { v, vechi } + derularea la ea (src/lib/pdfRezolvare.js)
    nota: notaPag, veziNota: () => veziNota(), notaPeEcran: () => notaPeEcran(),
    undo: () => store.undo(), clearAll: () => store.clearAll(),
    canUndo: store.canUndo, hasInk: store.hasInk,
  };
}

async function geoOf(data) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  try {
    const geo = {};
    for (let p = 1; p <= doc.numPages; p++) {
      // eslint-disable-next-line no-await-in-loop
      const pg = await doc.getPage(p);
      geo[p] = { W: pg.view[2] - pg.view[0], H: pg.view[3] - pg.view[1], x0: pg.view[0], top: pg.view[3] };
    }
    return geo;
  } finally { try { doc.destroy(); } catch { /* noop */ } }
}

// ═════════════════════════════ bara și capătul ═════════════════════════════
const tBtn = (on) => ({
  background: on ? 'var(--gold)' : 'rgba(255,255,255,0.12)', border: `1px solid ${on ? 'var(--gold)' : 'rgba(255,255,255,0.25)'}`,
  color: on ? 'var(--navy)' : '#fff', borderRadius: 8, height: 30, minWidth: 34, padding: '0 8px', cursor: 'pointer',
  fontSize: '.78rem', fontWeight: 700, lineHeight: 1, whiteSpace: 'nowrap', display: 'inline-flex', alignItems: 'center', gap: 4,
});

// butoanele modului, în bara de zoom a vizualizatorului → { left, right } (PdfCanvasViewer `toolbar`)
export function rezolvareToolbar({ solve, compact = false, busy = false, onCorect, onClose, onDownload, premium = true }) {
  const left = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {!compact && <span style={{ color: 'var(--gold)', fontWeight: 800, fontSize: '.8rem', whiteSpace: 'nowrap' }}>✏️ Rezolvi pe PDF</span>}
      <span role="group" aria-label="Unealta" style={{ display: 'inline-flex', gap: 4 }}>
        <button type="button" style={tBtn(solve.tool === 'pen')} aria-pressed={solve.tool === 'pen'} aria-label="Scrie" onClick={() => solve.setTool('pen')}
          title="Scrie pe PDF: încercuiește litera la grile, scrie rezolvarea la Subiectul al III-lea">✎{compact ? '' : ' Scrie'}</button>
        <button type="button" style={tBtn(solve.tool === 'eraser')} aria-pressed={solve.tool === 'eraser'} aria-label="Radieră" onClick={() => solve.setTool('eraser')}
          title="Radiera: șterge traseele pe care le atingi (și capătul-radieră al creionului)">◯{compact ? '' : ' Radieră'}</button>
        <button type="button" style={tBtn(solve.tool === 'pan')} aria-pressed={solve.tool === 'pan'} aria-label="Derulează" onClick={() => solve.setTool('pan')}
          title="Derulează și mărește PDF-ul cu un deget (cu două degete merge și cât scrii)">✋{compact ? '' : ' Derulează'}</button>
      </span>
      <span role="group" aria-label="Culoarea" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
        {(compact ? [solve.color] : INK_COLORS).map((c) => (
          <button key={c} type="button" aria-label={`Culoarea ${c}`} aria-pressed={solve.color === c}
            onClick={() => { if (compact) { const i = INK_COLORS.indexOf(c); solve.setColor(INK_COLORS[(i + 1) % INK_COLORS.length]); } else solve.setColor(c); if (solve.tool === 'pan') solve.setTool('pen'); }}
            title={compact ? 'Schimbă culoarea' : 'Culoarea scrisului'}
            style={{ width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0, border: solve.color === c ? '3px solid var(--gold)' : '2px solid rgba(255,255,255,.6)' }} />
        ))}
      </span>
      <button type="button" style={tBtn(false)} onClick={solve.undo} disabled={!solve.canUndo} title="Înapoi (Ctrl+Z)" aria-label="Înapoi">↩</button>
      <button type="button" style={tBtn(false)} onClick={solve.clearAll} disabled={!solve.hasInk} title="Șterge tot ce ai scris pe PDF (se poate anula cu ↩)" aria-label="Șterge tot">🗑</button>
    </span>
  );
  // 🔴 nota ultimei corectări, scrisă de mână, ca pe test; clic → pagina se derulează la ea
  const ns = solve.nota ? notaScrisa(solve.nota.v) : null;
  const notaBtn = ns && (
    <button type="button" className="nota-bara" onClick={() => solve.veziNota()}
      aria-label={`Nota ${ns.cifre} — arată-mi-o pe test`}
      title={solve.nota.vechi
        ? 'Nota de la corectarea de dinainte (ai mai scris de atunci — apasă „✅ Corectează" pentru nota nouă). Apasă ca s-o vezi pe test.'
        : 'Nota ultimei corectări — e scrisă cu roșu sus, pe prima pagină. Apasă ca s-o vezi pe test.'}
      style={{ ...tBtn(false), background: '#fff', borderColor: ROSU, color: ROSU, padding: '0 9px', gap: 5, opacity: solve.nota.vechi ? 0.6 : 1 }}>
      {!compact && <span style={{ fontSize: '.7rem', fontWeight: 800, color: ROSU }}>nota</span>}
      <span style={{ fontFamily: FONT_MANA, fontSize: '1.2rem', fontWeight: 700, lineHeight: 1 }}>{ns.cifre}</span>
    </button>
  );
  const right = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      {notaBtn}
      {!compact && solve.summary && (
        <span title="Ce am recunoscut pe PDF până acum (la grile: litera încercuită)"
          style={{ color: 'rgba(255,255,255,.85)', fontSize: '.72rem', fontWeight: 600, maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          🔎 {solve.summary}
        </span>
      )}
      {!compact && solve.mapState === 'loading' && <span style={{ color: 'rgba(255,255,255,.7)', fontSize: '.72rem' }}>citesc testul…</span>}
      <button type="button" style={tBtn(false)} onClick={onDownload} disabled={!solve.hasInk} aria-label="⬇ PDF"
        title="Descarcă PDF-ul cu rezolvarea ta pe el (rămâne un PDF obișnuit)">⬇{compact ? '' : ' PDF'}</button>
      <button type="button" onClick={onCorect} disabled={busy}
        title={premium
          ? 'Corectează ce ai rezolvat pe PDF: grilele după barem, iar scrisul de la Subiectul al III-lea îl citește profesorul virtual'
          : `Corectarea de pe PDF face parte din abonamentul Premium. Fără abonament: ${GRATUITE_GRILA} corectări gratuite ale grilei (Subiectele I și II), după barem`}
        style={{ ...tBtn(true), background: busy ? '#cfd8dc' : '#2e7d32', borderColor: busy ? '#cfd8dc' : '#2e7d32', color: '#fff', padding: '0 12px', cursor: busy ? 'progress' : 'pointer' }}>
        {busy ? '⏳ Corectez…' : '✅ Corectează'}
      </button>
      <button type="button" style={tBtn(false)} onClick={onClose} title="Închide modul (ce ai scris rămâne salvat pe acest dispozitiv)" aria-label="Închide rezolvarea pe PDF">✕</button>
    </span>
  );
  return { left, right, compact };
}

// Fără abonament: atâtea corectări gratuite ale GRILEI (după barem, fără AI) — numărul
// adevărat îl ține serverul (api/rezolva-pdf.js, PDF_GRILA_GRATUITE); aici e doar textul
export const GRATUITE_GRILA = 2;

// ce scrie sub „Ai terminat?" pentru elevul fără abonament
function textGratuite(g) {
  if (!g) return `Corectarea de pe PDF face parte din abonamentul Premium. Fără abonament ai ${GRATUITE_GRILA} corectări gratuite ale grilei (Subiectele I și II), după barem; scrisul de la Subiectul al III-lea îl corectează profesorul virtual cu Premium.`;
  if (g.ramase > 0) return `🎁 Ți-a mai rămas ${g.ramase === 1 ? 'o corectare gratuită' : `${g.ramase} corectări gratuite`} a grilei (după barem). Scrisul de la Subiectul al III-lea îl corectează profesorul virtual cu Premium.`;
  return 'Ai folosit corectările gratuite ale grilei. De acum, corectarea de pe PDF — grila și Subiectul al III-lea — face parte din abonamentul Premium.';
}

export function RezolvareFooter({ solve, busy = false, onCorect, premium = true }) {
  const r = solve.result;
  const gata = !premium && r && r.gratuite && r.gratuite.ramase === 0;
  return (
    <div style={{ maxWidth: 560, margin: '6px auto 26px', background: '#fff', borderRadius: 12, padding: '16px 18px', textAlign: 'center', boxShadow: '0 4px 18px rgba(0,0,0,.35)', border: '2px solid var(--gold)' }}>
      <div style={{ fontWeight: 800, color: 'var(--navy)', fontSize: '1rem', marginBottom: 6 }}>Ai terminat?</div>
      <div style={{ color: 'var(--text-light)', fontSize: '.84rem', lineHeight: 1.5, marginBottom: 12 }}>
        {premium
          ? 'Grilele (Subiectele I și II) le corectez după barem. Scrisul de la Subiectul al III-lea îl citește profesorul virtual.'
          : textGratuite(r && r.gratuite)}
        {!premium && (
          <>{' '}<Link to="/preturi" style={{ color: 'var(--navy)', fontWeight: 700 }}>⭐ Vezi abonamentele</Link></>
        )}
        {solve.summary ? <><br /><span style={{ fontWeight: 600 }}>🔎 {solve.summary}</span></> : null}
      </div>
      <button type="button" onClick={onCorect} disabled={busy}
        style={{ background: busy ? '#cfd8dc' : '#2e7d32', color: '#fff', border: 'none', borderRadius: 10, padding: '12px 28px', fontWeight: 800, fontSize: '1rem', cursor: busy ? 'progress' : 'pointer', boxShadow: '0 4px 14px rgba(46,125,50,.35)' }}>
        {busy ? '⏳ Corectez…' : `✅ Corectează${gata ? ' ⭐' : ''}`}
      </button>
      {r && r.total ? (
        <div style={{ marginTop: 10, fontSize: '.82rem', color: 'var(--navy)', fontWeight: 700 }}>
          Ultima corectare: {fmt(r.score)}/{r.total}p{r.nota != null ? ` · nota ${fmt(r.nota)}` : ''}
          {r.nota != null && (
            <>{' '}<button type="button" onClick={() => solve.veziNota()}
              style={{ background: 'none', border: 'none', padding: 0, color: ROSU, fontWeight: 800, fontSize: '.82rem', cursor: 'pointer', textDecoration: 'underline' }}>
              vezi nota pe test ↑</button></>
          )}
        </div>
      ) : null}
    </div>
  );
}

// eticheta scurtă a unui item (pentru mesaje): „II.4"
export { itemShort };
