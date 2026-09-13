// =====================================================================
// src/components/SpatiuDeLucru.jsx — caietul digital al elevului
//
// Elevul scrie cu degetul sau cu creionul pe o foaie cu linii. La ~1,2 s după
// ce ridică mâna, RÂNDUL scris se trimite la recunoaștere (api/ai-handwriting)
// și cerneala e înlocuită, pe loc, de textul frumos randat cu KaTeX — radicali,
// fracții, integrale, sume, limite, grade, tot.
//
// Dacă scrie din nou pe un rând deja transformat, textul dispare și revine
// cerneala: rândul se recunoaște iar, întreg. Nimic nu se pierde.
//
// Se deschide din butonul „✍️ Spațiu de lucru", din patru locuri:
//   · exercițiile interactive (iframe → MATE_WORKSPACE_OPEN → InteractiveViewer)
//   · vizualizatorul PDF
//   · widgetul plutitor al Profesorului Virtual
//   · formularul „📝 Răspunde în chat" (câte un buton pe fiecare cerință)
//
// Props:
//   open, onClose
//   title        — ce scrie în antet (exercițiul la care lucrează)
//   hint         — enunțul, trimis modelului ca să aleagă notația potrivită
//   storageKey   — cheia de salvare locală (ciorna supraviețuiește reîncărcării)
//   onInsert     — (text) => void : „✓ Pune în răspuns" (opțional)
//   insertLabel  — eticheta acelui buton
//   onCorect     — (text) => void : „🎓 Cere corectarea" (opțional)
// =====================================================================
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { aiClient } from '../lib/aiClient';
import { ensureKatex, renderMath } from '../lib/katex';

const ROW_H = 80;            // înălțimea unui rând de caiet (px CSS) — încape o fracție \displaystyle
const START_ROWS = 9;        // rânduri la deschidere — se adaugă singure la nevoie
const MAX_ROWS = 60;
const AUTO_DELAY = 1200;     // pauza după care rândul se transformă singur (ms)
const MAX_BATCH = 6;         // câte rânduri intră într-o singură cerere
const PEN_W = 2.4;
const ERASER_R = 15;
const GUTTER = 44;           // marginea din stânga (ca la caiet)
const COLORS = ['#12263a', '#c62828', '#1565c0', '#2e7d32'];

// ── Ajutoare de geometrie ────────────────────────────────────────────────
const rowOf = (y) => Math.max(0, Math.floor(y / ROW_H));
function strokeBox(s) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of s.pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
function rowBox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const b = strokeBox(s);
    if (b.x0 < x0) x0 = b.x0; if (b.y0 < y0) y0 = b.y0;
    if (b.x1 > x1) x1 = b.x1; if (b.y1 > y1) y1 = b.y1;
  }
  return { x0, y0, x1, y1 };
}

// Traseu neted (aceleași curbe Bézier ca la creionul din testele interactive)
function pathOf(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2;
    const my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last[0], last[1]);
}

// Rândul recunoscut, gata de randat. Un rând NUMAI matematică se scrie cu
// \displaystyle: fracțiile, radicalii, integralele și sumele ies la mărimea
// de pe caiet, nu micșorate ca într-o propoziție. Un rând AMESTECAT (text +
// $formule$) rămâne exact cum l-a scris modelul — acolo formulele mici,
// în rândul de text, sunt tocmai ce trebuie.
function toDisplay(latex) {
  const t = String(latex || '').trim();
  if (!t) return '';
  return t.includes('$') ? t : `$\\displaystyle ${t}$`;
}

// Rândul recunoscut, ca text de pus într-un câmp de răspuns / trimis la corectare
function toPlain(latex) {
  const t = String(latex || '').trim();
  return t.includes('$') ? t : (t ? `$${t}$` : '');
}

// ── Un rând randat cu KaTeX ──────────────────────────────────────────────
function RandRandat({ latex, onEdit }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = toDisplay(latex);
    ensureKatex().then(() => { if (ref.current) renderMath(ref.current); });
  }, [latex]);
  return (
    <span
      ref={ref}
      onDoubleClick={onEdit}
      title="Dublu-clic ca să scrii din nou pe rândul acesta"
      style={{
        fontFamily: 'Georgia, "Times New Roman", serif', fontSize: '1.12rem',
        color: '#12263a', lineHeight: 1.25, whiteSpace: 'nowrap',
      }}
    />
  );
}

export default function SpatiuDeLucru({
  open = false, onClose, title = '', hint = '', storageKey = null,
  onInsert = null, insertLabel = '✓ Pune în răspuns', onCorect = null,
}) {
  const wrapRef = useRef(null);
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);

  const strokesRef = useRef([]);              // [{ id, row, color, pts }]
  const drawingRef = useRef(null);            // trasul în curs
  const penSeenRef = useRef(false);           // s-a folosit vreodată un stylus?
  const timerRef = useRef(null);
  const dirtyRef = useRef(new Set());
  const seqRef = useRef(1);

  const [tool, setTool] = useState('pen');    // pen | eraser | pan
  const [color, setColor] = useState(COLORS[0]);
  const [rows, setRows] = useState(START_ROWS);
  const [meta, setMeta] = useState({});       // { [rând]: { status, latex } }
  const [auto, setAuto] = useState(true);
  const [width, setWidth] = useState(900);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);            // redesenează cerneala
  const repaintSoon = useCallback(() => setTick((n) => n + 1), []);

  const sheetH = rows * ROW_H;

  // ── Desenarea cernelii ────────────────────────────────────────────────
  const repaint = useCallback(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (cv.width !== Math.round(width * dpr) || cv.height !== Math.round(sheetH * dpr)) {
      cv.width = Math.round(width * dpr);
      cv.height = Math.round(sheetH * dpr);
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, sheetH);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const s of strokesRef.current) {
      // rândurile deja transformate în text nu mai arată cerneala
      if (meta[s.row] && meta[s.row].status === 'done') continue;
      if (s.pts.length < 2) {
        ctx.fillStyle = s.color;
        ctx.beginPath(); ctx.arc(s.pts[0][0], s.pts[0][1], PEN_W / 1.6, 0, 6.2832); ctx.fill();
        continue;
      }
      ctx.strokeStyle = s.color; ctx.lineWidth = PEN_W;
      pathOf(ctx, s.pts); ctx.stroke();
    }
  }, [width, sheetH, meta]);

  useLayoutEffect(() => { repaint(); });

  // Lățimea foii urmărește fereastra
  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, [open]);

  // ── Ciornă salvată local ──────────────────────────────────────────────
  const LSK = storageKey ? `sdl:${storageKey}` : null;
  useEffect(() => {
    if (!open || !LSK) return;
    try {
      const raw = localStorage.getItem(LSK);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.strokes)) {
        strokesRef.current = o.strokes;
        seqRef.current = o.strokes.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
        setMeta(o.meta || {});
        setRows(Math.min(MAX_ROWS, Math.max(START_ROWS, (o.rows | 0) || START_ROWS)));
      }
    } catch { /* ciornă coruptă — pornim de la foaie albă */ }
  }, [open, LSK]);

  const saveDraft = useCallback(() => {
    if (!LSK) return;
    try {
      const strokes = strokesRef.current.map((s) => ({
        id: s.id, row: s.row, color: s.color,
        pts: s.pts.map(([x, y]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2]),
      }));
      localStorage.setItem(LSK, JSON.stringify({ strokes, meta, rows }));
    } catch { /* fără loc în localStorage — ciorna nu se salvează, atât */ }
  }, [LSK, meta, rows]);
  useEffect(() => { if (open) saveDraft(); }, [open, meta, rows, saveDraft]);

  // ── Rasterizarea unui rând, pentru recunoaștere ───────────────────────
  // Cerneala colorată devine neagră pe alb: contrastul maxim citește cel mai bine.
  function rowImage(row) {
    const strokes = strokesRef.current.filter((s) => s.row === row);
    if (!strokes.length) return null;
    const b = rowBox(strokes);
    const pad = 10;
    const w = Math.max(24, b.x1 - b.x0 + pad * 2);
    const h = Math.max(24, b.y1 - b.y0 + pad * 2);
    const scale = Math.min(3, Math.max(1, 120 / h), 1500 / w);
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.translate(-b.x0 + pad, -b.y0 + pad);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = PEN_W * 1.15;
    for (const s of strokes) {
      if (s.pts.length < 2) { ctx.beginPath(); ctx.arc(s.pts[0][0], s.pts[0][1], PEN_W, 0, 6.2832); ctx.fill(); continue; }
      pathOf(ctx, s.pts); ctx.stroke();
    }
    return cv;
  }

  // Mai multe rânduri într-o singură imagine: numerotate în stânga, despărțite
  // de o linie. O cerere în loc de cinci — contează la limita orară de AI.
  function composite(rowList) {
    const imgs = rowList.map((r) => ({ r, cv: rowImage(r) })).filter((o) => o.cv);
    if (!imgs.length) return null;
    const GAP = 14;
    const w = Math.min(1600, GUTTER + Math.max(...imgs.map((o) => o.cv.width)) + 16);
    const h = imgs.reduce((s, o) => s + o.cv.height + GAP, GAP);
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = Math.min(2000, h);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.fillStyle = '#000'; ctx.font = 'bold 22px sans-serif'; ctx.textBaseline = 'middle';
    let y = GAP;
    const used = [];
    imgs.forEach((o, i) => {
      if (y + o.cv.height > cv.height) return;          // ce nu încape rămâne pe tura următoare
      ctx.fillText(String(i + 1) + '.', 8, y + o.cv.height / 2);
      ctx.drawImage(o.cv, GUTTER, y);
      used.push(o.r);
      y += o.cv.height + GAP;
      if (i < imgs.length - 1) {
        ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(4, y - GAP / 2); ctx.lineTo(cv.width - 4, y - GAP / 2); ctx.stroke();
      }
    });
    if (!used.length) return null;
    return { dataUrl: cv.toDataURL('image/png'), used };
  }

  // ── Recunoașterea ─────────────────────────────────────────────────────
  const busyRef = useRef(false);
  const flushRef = useRef(null);
  const recognize = useCallback(async (rowList) => {
    const list = rowList.filter((r) => strokesRef.current.some((s) => s.row === r)).sort((a, b) => a - b).slice(0, MAX_BATCH);
    if (!list.length || busyRef.current) return;
    const packed = composite(list);
    if (!packed) return;
    busyRef.current = true;
    setErr(null);
    setMeta((m) => {
      const n = { ...m };
      for (const r of packed.used) n[r] = { ...(n[r] || {}), status: 'busy' };
      return n;
    });
    try {
      const { lines } = await aiClient.handwriting({
        imageBase64: packed.dataUrl, count: packed.used.length, hint,
      });
      setMeta((m) => {
        const n = { ...m };
        (lines || []).forEach((l) => {
          const row = packed.used[l.i - 1];
          if (row == null) return;
          n[row] = l.latex ? { status: 'done', latex: l.latex } : { status: 'idle', latex: null };
        });
        for (const r of packed.used) if (n[r] && n[r].status === 'busy') n[r] = { status: 'idle', latex: null };
        return n;
      });
    } catch (e) {
      setErr(e.message || 'Nu am putut citi scrisul.');
      setMeta((m) => {
        const n = { ...m };
        for (const r of packed.used) if (n[r] && n[r].status === 'busy') n[r] = { status: 'idle', latex: null };
        return n;
      });
    } finally {
      busyRef.current = false;
      // rândurile care n-au încăput în imagine rămân la coadă
      const rest = list.filter((r) => !packed.used.includes(r));
      rest.forEach((r) => dirtyRef.current.add(r));
      if (rest.length) setTimeout(() => { if (flushRef.current) flushRef.current(); }, 80);
    }
  }, [hint]);

  const flush = useCallback(() => {
    const list = Array.from(dirtyRef.current);
    dirtyRef.current.clear();
    if (list.length) recognize(list);
  }, [recognize]);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  const scheduleFlush = useCallback((delay = AUTO_DELAY) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { timerRef.current = null; flush(); }, delay);
  }, [flush]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  // ── Scrisul ───────────────────────────────────────────────────────────
  function pointOf(e) {
    const rect = canvasRef.current.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  }

  // Rândul primește cerneală nouă → textul lui frumos dispare, se rescrie de la zero
  function touchRow(row) {
    setMeta((m) => (m[row] && (m[row].status === 'done' || m[row].latex) ? { ...m, [row]: { status: 'idle', latex: null } } : m));
    dirtyRef.current.add(row);
  }

  function onDown(e) {
    if (tool === 'pan') return;
    if (e.pointerType === 'pen') penSeenRef.current = true;
    // cu creionul în mână, palma sprijinită pe ecran nu mai scrie
    if (penSeenRef.current && e.pointerType === 'touch') return;
    if (!e.isPrimary) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* fără capture — merge și așa */ }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const [x, y] = pointOf(e);
    if (tool === 'eraser') { drawingRef.current = { eraser: true }; erase(x, y); return; }
    const row = rowOf(y);
    drawingRef.current = { id: seqRef.current++, row, color, pts: [[x, y]] };
    strokesRef.current.push(drawingRef.current);
    touchRow(row);
    repaintSoon();
  }

  function onMove(e) {
    const d = drawingRef.current;
    if (!d) return;
    e.preventDefault();
    const [x, y] = pointOf(e);
    if (d.eraser) { erase(x, y); return; }
    const last = d.pts[d.pts.length - 1];
    if (Math.abs(x - last[0]) < 0.7 && Math.abs(y - last[1]) < 0.7) return;
    d.pts.push([x, y]);
    repaintSoon();
  }

  function onUp() {
    const d = drawingRef.current;
    drawingRef.current = null;
    if (!d) return;
    if (!d.eraser) {
      // trasul poate depăși rândul de pornire (bara fracției, radicalul) —
      // rândul rămâne cel unde a început, ca să nu se taie formula în două
      growIfNeeded(d.row);
    }
    saveDraft();
    if (auto) scheduleFlush();
  }

  function erase(x, y) {
    const before = strokesRef.current.length;
    const hitRows = new Set();
    strokesRef.current = strokesRef.current.filter((s) => {
      const hit = s.pts.some(([px, py]) => Math.abs(px - x) < ERASER_R && Math.abs(py - y) < ERASER_R);
      if (hit) hitRows.add(s.row);
      return !hit;
    });
    // radiera trece și peste textul deja transformat: îl șterge cu totul
    const textRow = rowOf(y);
    setMeta((m) => {
      if (!hitRows.size && !(m[textRow] && m[textRow].latex)) return m;
      const n = { ...m };
      hitRows.forEach((r) => { n[r] = { status: 'idle', latex: null }; });
      if (m[textRow] && m[textRow].latex) n[textRow] = { status: 'idle', latex: null };
      return n;
    });
    hitRows.forEach((r) => { if (strokesRef.current.some((s) => s.row === r)) dirtyRef.current.add(r); else dirtyRef.current.delete(r); });
    if (before !== strokesRef.current.length) repaintSoon();
  }

  // Foaia crește singură când elevul se apropie de capăt — și urcă odată cu el,
  // ca rândul următor să fie mereu sub mână, fără să caute bara de derulare.
  function growIfNeeded(row) {
    if (row >= rows - 2) setRows((r) => Math.min(MAX_ROWS, r + 3));
    const el = scrollRef.current;
    if (!el) return;
    const wantBottom = (row + 2) * ROW_H;
    if (wantBottom > el.scrollTop + el.clientHeight) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = wantBottom - scrollRef.current.clientHeight;
      });
    }
  }

  function undo() {
    const s = strokesRef.current.pop();
    if (!s) return;
    setMeta((m) => ({ ...m, [s.row]: { status: 'idle', latex: null } }));
    if (strokesRef.current.some((k) => k.row === s.row)) dirtyRef.current.add(s.row);
    else dirtyRef.current.delete(s.row);
    repaintSoon(); saveDraft();
  }

  function clearAll() {
    strokesRef.current = [];
    dirtyRef.current.clear();
    setMeta({});
    setRows(START_ROWS);
    setErr(null);
    repaintSoon();
    if (LSK) { try { localStorage.removeItem(LSK); } catch { /* nimic de curățat */ } }
  }

  // ── Textul final ──────────────────────────────────────────────────────
  const textOut = useMemo(() => {
    const out = [];
    for (let r = 0; r < rows; r++) {
      const m = meta[r];
      if (m && m.latex) out.push(toPlain(m.latex));
      else if (strokesRef.current.some((s) => s.row === r)) out.push('…');   // rând nerecunoscut încă
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, rows, tick]);

  const nInk = strokesRef.current.length;
  const nDone = Object.values(meta).filter((m) => m && m.latex).length;
  const nBusy = Object.values(meta).filter((m) => m && m.status === 'busy').length;
  const nAsteapta = useMemo(() => {
    let k = 0;
    for (let r = 0; r < rows; r++) {
      if (meta[r] && (meta[r].latex || meta[r].status === 'busy')) continue;
      if (strokesRef.current.some((s) => s.row === r)) k++;
    }
    return k;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, rows, tick]);

  function transformaTot() {
    for (let r = 0; r < rows; r++) {
      if (meta[r] && (meta[r].latex || meta[r].status === 'busy')) continue;
      if (strokesRef.current.some((s) => s.row === r)) dirtyRef.current.add(r);
    }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    flush();
  }

  // Esc închide
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose && onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const toolBtn = (on) => ({
    background: on ? 'var(--gold, #e8b931)' : '#fff',
    border: '1px solid ' + (on ? 'var(--gold, #e8b931)' : '#d7dee7'),
    color: on ? '#12263a' : '#44566b',
    borderRadius: 9, padding: '6px 11px', fontSize: '.8rem', fontWeight: 700,
    cursor: 'pointer', whiteSpace: 'nowrap', lineHeight: 1.2,
  });
  const actBtn = {
    background: 'var(--gold, #e8b931)', color: '#12263a', border: 'none', borderRadius: 10,
    padding: '9px 16px', fontSize: '.86rem', fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
  };
  const ghostBtn = { ...actBtn, background: '#fff', border: '1px solid #d7dee7', color: '#44566b', fontWeight: 700 };

  return (
    <div
      role="dialog" aria-modal="true" aria-label="Spațiu de lucru"
      onPointerDown={(e) => { if (e.target === e.currentTarget) onClose && onClose(); }}
      style={{
        position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(10,22,36,.55)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2vh 2vw',
      }}
    >
      <div ref={wrapRef} style={{
        background: '#fff', borderRadius: 14, width: 'min(1100px, 100%)', height: 'min(94vh, 100%)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,.35)',
      }}>

        {/* ── Antet ── */}
        <div style={{
          background: 'var(--navy, #0f2b44)', color: '#fff', padding: '9px 14px',
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 800, fontSize: '.95rem' }}>✍️ Spațiu de lucru</div>
            {title && (
              <div style={{ fontSize: '.72rem', opacity: .82, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {title}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="Închide spațiul de lucru" style={{
            background: 'rgba(255,255,255,.14)', border: 'none', color: '#fff', borderRadius: 8,
            padding: '5px 11px', fontSize: '.85rem', fontWeight: 700, cursor: 'pointer',
          }}>✕ Închide</button>
        </div>

        {/* ── Unelte ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap',
          padding: '7px 12px', background: '#f2f6fa', borderBottom: '1px solid #dde4ec', flexShrink: 0,
        }}>
          <button style={toolBtn(tool === 'pen')} onClick={() => setTool('pen')} title="Scrie cu degetul sau cu creionul">✎ Scrie</button>
          <button style={toolBtn(tool === 'eraser')} onClick={() => setTool('eraser')} title="Șterge ce ai scris">◯ Radieră</button>
          <button style={toolBtn(tool === 'pan')} onClick={() => setTool('pan')} title="Derulează foaia fără să scrii">✋ Derulează</button>
          <span style={{ width: 1, height: 20, background: '#cfd8e3', margin: '0 3px' }} />
          {COLORS.map((c) => (
            <button key={c} onClick={() => { setColor(c); setTool('pen'); }} aria-label={'Culoare ' + c}
              style={{
                width: 22, height: 22, borderRadius: '50%', background: c, cursor: 'pointer', padding: 0,
                border: color === c ? '3px solid var(--gold, #e8b931)' : '2px solid #fff',
                boxShadow: '0 0 0 1px #cfd8e3',
              }} />
          ))}
          <span style={{ width: 1, height: 20, background: '#cfd8e3', margin: '0 3px' }} />
          <button style={toolBtn(false)} onClick={undo} title="Anulează ultimul tras">↩ Înapoi</button>
          <button style={toolBtn(false)} onClick={clearAll} title="Foaie nouă">✕ Șterge tot</button>
          <span style={{ width: 1, height: 20, background: '#cfd8e3', margin: '0 3px' }} />
          <button style={toolBtn(auto)} onClick={() => setAuto((a) => !a)}
            title={auto ? 'Rândul se transformă singur, la ~1 secundă după ce ridici mâna' : 'Transformarea automată e oprită — apeși tu butonul'}>
            ✨ Automat: {auto ? 'pornit' : 'oprit'}
          </button>
          {(!auto || nAsteapta > 0) && (
            <button style={{ ...toolBtn(false), background: '#fff8e1', borderColor: '#e8b931', color: '#8a6d00' }}
              onClick={transformaTot} disabled={!nAsteapta}
              title="Transformă acum toate rândurile scrise">
              ✨ Transformă {nAsteapta ? `(${nAsteapta})` : ''}
            </button>
          )}
        </div>

        {/* ── Foaia ── */}
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', background: '#fdfdf8' }}>
          <div style={{ position: 'relative', width: '100%', height: sheetH }}>

            {/* liniile caietului + marginea roșie */}
            <div aria-hidden style={{
              position: 'absolute', inset: 0,
              backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent ${ROW_H - 1}px, #dfe6ee ${ROW_H - 1}px, #dfe6ee ${ROW_H}px)`,
            }} />
            <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: GUTTER, width: 1, background: '#f0c9c9' }} />

            {/* rândurile transformate în text frumos */}
            {Array.from({ length: rows }, (_, r) => {
              const m = meta[r];
              if (!m) return null;
              if (m.status === 'busy') {
                return (
                  <div key={'b' + r} style={{
                    position: 'absolute', left: GUTTER + 10, right: 8, top: r * ROW_H, height: ROW_H,
                    display: 'flex', alignItems: 'center', gap: 8, color: '#8a6d00',
                    fontSize: '.78rem', fontWeight: 700, pointerEvents: 'none',
                  }}>
                    <span style={{
                      width: 13, height: 13, borderRadius: '50%', border: '2px solid #e8b931',
                      borderTopColor: 'transparent', animation: 'sdl-spin .7s linear infinite', display: 'inline-block',
                    }} />
                    se transformă în text…
                  </div>
                );
              }
              if (!m.latex) return null;
              return (
                <div key={'t' + r} style={{
                  position: 'absolute', left: GUTTER + 10, right: 8, top: r * ROW_H, height: ROW_H,
                  display: 'flex', alignItems: 'center', overflowX: 'auto', overflowY: 'hidden',
                }}>
                  <RandRandat
                    latex={m.latex}
                    onEdit={() => setMeta((mm) => ({ ...mm, [r]: { status: 'idle', latex: null } }))}
                  />
                </div>
              );
            })}

            {/* cerneala */}
            <canvas
              ref={canvasRef}
              onPointerDown={onDown} onPointerMove={onMove}
              onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={onUp}
              style={{
                position: 'absolute', inset: 0, width: '100%', height: sheetH,
                touchAction: tool === 'pan' ? 'pan-y' : 'none',
                cursor: tool === 'eraser' ? 'cell' : tool === 'pan' ? 'grab' : 'crosshair',
              }}
            />
          </div>
        </div>

        {/* ── Erori ── */}
        {err && (
          <div style={{
            background: '#fdecea', color: '#8a2b25', borderTop: '1px solid #f5c6c2',
            padding: '7px 12px', fontSize: '.78rem', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0,
          }}>
            <span style={{ flex: 1 }}>{err}</span>
            <button onClick={() => setErr(null)} aria-label="Închide eroarea"
              style={{ background: 'none', border: '1px solid #f5c6c2', borderRadius: 7, color: '#8a2b25', padding: '2px 8px', cursor: 'pointer' }}>✕</button>
          </div>
        )}

        {/* ── Subsol ── */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
          padding: '9px 12px', borderTop: '1px solid #dde4ec', background: '#fff', flexShrink: 0,
        }}>
          {onCorect && (
            <button style={actBtn} disabled={!nDone}
              onClick={() => { onCorect(textOut); onClose && onClose(); }}
              title="Profesorul virtual îți citește rezolvarea și îți spune unde greșești">
              🎓 Cere corectarea
            </button>
          )}
          {onInsert && (
            <button style={nDone ? { ...ghostBtn, borderColor: '#e8b931', color: '#8a6d00' } : ghostBtn} disabled={!nDone}
              onClick={() => { onInsert(textOut); onClose && onClose(); }}>
              {insertLabel}
            </button>
          )}
          <button style={ghostBtn} disabled={!nDone}
            onClick={() => { try { navigator.clipboard.writeText(textOut); } catch { /* fără clipboard */ } }}
            title="Copiază textul transformat">📋 Copiază</button>

          <span style={{ flex: 1 }} />
          <span style={{ fontSize: '.74rem', color: '#6b7c8f' }}>
            {nDone ? `${nDone} ${nDone === 1 ? 'rând transformat' : 'rânduri transformate'}` : 'scrie pe foaie — rândul se transformă singur'}
            {nBusy ? ' · se citește…' : ''}
            {nAsteapta ? ` · ${nAsteapta} în așteptare` : ''}
          </span>
        </div>
      </div>

      <style>{'@keyframes sdl-spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}
