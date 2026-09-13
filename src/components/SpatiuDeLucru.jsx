// =====================================================================
// src/components/SpatiuDeLucru.jsx — caietul digital al elevului
//
// Elevul scrie cu degetul sau cu creionul pe o foaie cu linii. La ~1,3 s după
// ce ridică mâna, LINIA scrisă se trimite la recunoaștere (api/ai-handwriting)
// și cerneala e înlocuită, pe loc, de textul frumos randat cu KaTeX — radicali,
// fracții, integrale, sume, limite, grade, tot.
//
// GRUPAREA PE LINII (partea delicată): liniile NU sunt benzi fixe pe ecran.
// Nimeni nu scrie exact între două linii de caiet — un „4" iese deasupra, o
// virgulă coboară dedesubt, iar o fracție ocupă cât trei rânduri. Dacă tăiem
// după o grilă fixă, o linie scrisă se rupe în două, fiecare jumătate pleacă
// separat la model și iese o prostie („= 4,0 = 4" citit ca „−4 4" + „−10 =").
// De aceea liniile se formează din GEOMETRIA traseelor: un traseu intră în
// linia cu care se suprapune pe verticală, iar semnele mici (punct, virgulă,
// minus, bara fracției) se lipesc de linia de lângă ele. Un traseu care leagă
// două linii le UNEȘTE. Liniile de pe foaie rămân doar un ajutor vizual.
//
// Dacă scrie din nou peste o linie deja transformată, textul dispare și revine
// cerneala: linia se recunoaște iar, întreagă. Nimic nu se pierde.
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

const ROW_H = 80;            // distanța dintre liniile desenate pe foaie (px CSS)
const START_ROWS = 9;
const MAX_ROWS = 60;
const AUTO_DELAY = 1300;     // pauza după care linia se transformă singură (ms)
const MAX_BATCH = 4;         // câte linii intră într-o singură cerere
const PEN_W = 2.4;
const ERASER_R = 15;
const GUTTER = 44;
const COLORS = ['#12263a', '#c62828', '#1565c0', '#2e7d32'];

// Pragurile grupării pe linii (vezi sameLine mai jos)
const OVERLAP_MIN = 0.22;    // cât din înălțimea mai mică trebuie să se suprapună
const SMALL_H = 30;          // sub atât un traseu e „bară" (minus, egal, bara fracției)
const SMALL_W = 60;          // sub atât e „semn îngust" (virgulă, punct, exponent)
const STACK_GAP = 36;        // cât de departe poate sta un etaj de altul (fracție, exponent)
const NEAR_X = 220;          // cât de departe pe orizontală mai ține de aceeași linie
const TIGHT_X = 50;          // cât de departe poate sta un semn îngust de vecinul lui

// ── Geometrie ────────────────────────────────────────────────────────────
function strokeBox(s) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of s.pts) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, x1, y1 };
}
function unionBox(strokes) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const b = s.pts ? strokeBox(s) : s;
    if (b.x0 < x0) x0 = b.x0; if (b.y0 < y0) y0 = b.y0;
    if (b.x1 > x1) x1 = b.x1; if (b.y1 > y1) y1 = b.y1;
  }
  return { x0, y0, x1, y1 };
}

// Amprenta unei linii: id-urile traseelor din ea. Se schimbă exact când linia
// s-a modificat — traseu nou, radieră, unire cu altă linie, rupere în două.
const sigOf = (strokes) => strokes.map((s) => s.id).sort((a, b) => a - b).join(',');

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

// ── Curățarea LaTeX-ului venit de la model ───────────────────────────────
// Modelele scriu virgula zecimală în fel și chip („3{,}6", „3{.}6"), pun
// spațieri tipografice („\quad", „\,") și folosesc minusul Unicode. În caiet
// nu se vede diferența, dar în câmpul de răspuns al formularului ajunge text
// brut — și acolo „$3{,}6+0{,}4$" e exact ce nu vrea profesorul să citească.
function normalizeLatex(raw) {
  let t = String(raw || '').trim();
  t = t.replace(/\{\s*,\s*\}/g, ',').replace(/\{\s*\.\s*\}/g, '.');   // 3{,}6 → 3,6
  t = t.replace(/\\(?:quad|qquad|;|:|!|,)(?![a-zA-Z])/g, ' ');         // spațieri tipografice
  t = t.replace(/−/g, '-').replace(/·/g, '\\cdot ');         // − → -, · → \cdot
  t = t.replace(/×/g, '\\times ').replace(/÷/g, '\\div ');
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\s+([,;])/g, '$1');
  t = t.replace(/^\\\[|\\\]$/g, '').trim();
  return t;
}

// O linie care e doar aritmetică simplă (cifre, virgulă zecimală, + − · / = ( ))
// se scrie ca TEXT CURAT, nu împachetată în $...$: „3·1,2+0,4=" citește mai
// bine în câmpul de răspuns decât „$3\cdot 1,2+0,4=$".
const SIMPLE_RE = /^[0-9\s,.:+\-=()[\]<>%]*$/;
function isSimpleArithmetic(latex) {
  const t = latex.replace(/\\cdot/g, '·').replace(/\\times/g, '×').replace(/\\div/g, ':').replace(/\\pm/g, '±');
  return /[0-9]/.test(t) && SIMPLE_RE.test(t.replace(/[·×±]/g, ''));
}
function plainOf(latex) {
  return latex
    .replace(/\\cdot\s*/g, ' · ').replace(/\\times\s*/g, ' × ').replace(/\\div\s*/g, ' : ')
    .replace(/\\pm\s*/g, ' ± ').replace(/\s{2,}/g, ' ').trim();
}

// Pentru CAIET: matematica „goală" se scrie cu \displaystyle, ca fracțiile și
// radicalii să iasă la mărimea de pe hârtie. Un rând amestecat (text + $…$)
// rămâne cum l-a scris modelul.
function toDisplay(latex) {
  const t = normalizeLatex(latex);
  if (!t) return '';
  return t.includes('$') ? t : `$\\displaystyle ${t}$`;
}

// Pentru FORMULAR / CHAT: aritmetica simplă ca text, restul în $…$ (așa îl
// randează MathText din chat și îl citește corectarea).
function toPlain(latex) {
  const t = normalizeLatex(latex);
  if (!t) return '';
  if (t.includes('$')) return t;
  return isSimpleArithmetic(t) ? plainOf(t) : `$${t}$`;
}

// ── O linie randată cu KaTeX ─────────────────────────────────────────────
function LinieRandata({ latex, onEdit }) {
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
      title="Dublu-clic ca să scrii din nou pe linia aceasta"
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
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);

  const strokesRef = useRef([]);              // [{ id, line, color, pts }]
  const drawingRef = useRef(null);
  const penSeenRef = useRef(false);
  const timerRef = useRef(null);
  const dirtyRef = useRef(new Set());         // id-uri de LINII de recunoscut
  const seqRef = useRef(1);
  const lineSeqRef = useRef(1);
  const busyRef = useRef(false);
  const flushRef = useRef(null);

  const [tool, setTool] = useState('pen');
  const [color, setColor] = useState(COLORS[0]);
  const [rows, setRows] = useState(START_ROWS);
  const [meta, setMeta] = useState({});       // { [lineId]: { status, latex } }
  const [auto, setAuto] = useState(true);
  const [width, setWidth] = useState(900);
  const [err, setErr] = useState(null);
  const [tick, setTick] = useState(0);
  const repaintSoon = useCallback(() => setTick((n) => n + 1), []);

  const sheetH = rows * ROW_H;

  // ── Liniile, derivate din trasee ──────────────────────────────────────
  const linesOf = useCallback(() => {
    const m = new Map();
    for (const s of strokesRef.current) {
      if (!m.has(s.line)) m.set(s.line, []);
      m.get(s.line).push(s);
    }
    const out = [];
    for (const [id, strokes] of m) {
      // „sig" = amprenta traseelor din linie. Dacă se schimbă, linia s-a
      // modificat (traseu nou, radieră, unire, rupere) și textul ei nu mai e bun.
      out.push({ id, strokes, box: unionBox(strokes), sig: sigOf(strokes) });
    }
    out.sort((a, b) => a.box.y0 - b.box.y0 || a.box.x0 - b.box.x0);
    return out;
  }, []);

  // Două trasee sunt pe ACEEAȘI linie scrisă? Regula are două jumătăți:
  //  · se suprapun pe verticală → aceeași linie (cazul obișnuit: literele și
  //    cifrele unui rând se încalecă mereu pe câțiva pixeli);
  //  · NU se suprapun, dar stau unul peste altul, aproape și înguste → tot
  //    aceeași linie. Asta prinde fracția (numărător / bară / numitor), exponentul
  //    și virgula care coboară sub rând. Un rând NOU de scris nu intră aici:
  //    e lat (peste SMALL_W) și stă mai jos de STACK_GAP.
  function sameLine(a, b) {
    const ha = a.y1 - a.y0, hb = b.y1 - b.y0;
    const wa = a.x1 - a.x0, wb = b.x1 - b.x0;
    const ov = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
    const hGap = Math.max(a.x0 - b.x1, b.x0 - a.x1);       // negativ = se suprapun lateral
    const narrow = Math.min(wa, wb) <= SMALL_W || Math.min(ha, hb) <= SMALL_H;
    if (ov > 0) {
      if (hGap > NEAR_X) return false;
      if (ov / Math.max(Math.min(ha, hb), 10) >= OVERLAP_MIN) return true;
      // Un semn mic care doar ATINGE rândul (bara fracției peste un „=" de
      // alături, o virgulă care urcă un pixel) trebuie să fie și LIPIT de el.
      // Fără condiția asta, o bară de fracție și o virgulă aflate la 200 px una
      // de alta se uneau doar fiindcă se încalecau cu un pixel pe verticală.
      return narrow && hGap <= TIGHT_X;
    }
    if (-ov > STACK_GAP) return false;                      // prea jos: e alt rând
    const hOv = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
    const minW = Math.min(wa, wb);
    if (minW > 180) return false;                           // două rânduri late, unul sub altul
    if (hOv > 0.5 * Math.max(minW, 1)) return true;         // etajat exact deasupra (fracție)
    return minW <= SMALL_W && hGap <= TIGHT_X;              // semn îngust lipit de vecin
  }

  // Regrupează TOATE traseele în linii. Se rulează din nou la fiecare schimbare,
  // deci rezultatul nu depinde de ordinea în care a scris elevul: dacă adaugă
  // bara fracției la urmă, ea unește numărătorul cu numitorul, retroactiv.
  // Id-ul unei linii se moștenește de la gruparea anterioară (traseul majoritar),
  // ca textul deja recunoscut să nu sărică de pe linia lui.
  const relayout = useCallback(() => {
    const st = strokesRef.current;
    if (!st.length) return [];
    const boxes = st.map(strokeBox);
    const parent = st.map((_, i) => i);
    const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    for (let i = 0; i < st.length; i++) {
      for (let j = i + 1; j < st.length; j++) {
        if (find(i) === find(j)) continue;
        if (sameLine(boxes[i], boxes[j])) parent[find(i)] = find(j);
      }
    }
    const groups = new Map();
    for (let i = 0; i < st.length; i++) {
      const r = find(i);
      if (!groups.has(r)) groups.set(r, []);
      groups.get(r).push(i);
    }
    const prevId = st.map((x) => x.line);
    const order = [...groups.values()].sort(
      (g1, g2) => Math.min(...g1.map((i) => boxes[i].y0)) - Math.min(...g2.map((i) => boxes[i].y0)),
    );
    const taken = new Set();
    const out = [];
    for (const g of order) {
      const tally = new Map();
      for (const i of g) { const id = prevId[i]; if (id) tally.set(id, (tally.get(id) || 0) + 1); }
      let id = null, best = 0;
      for (const [k, v] of tally) if (v > best && !taken.has(k)) { best = v; id = k; }
      if (!id) id = lineSeqRef.current++;
      taken.add(id);
      for (const i of g) st[i].line = id;
      out.push({
        id,
        strokes: g.map((i) => st[i]),
        box: unionBox(g.map((i) => boxes[i])),
        sig: sigOf(g.map((i) => st[i])),
      });
    }
    return out;
  }, []);

  // După regrupare: liniile a căror compunere s-a schimbat își pierd textul și
  // intră la rând pentru o nouă citire. „sig" e amprenta traseelor din linie —
  // acoperă deodată adăugarea, radiera, unirea și ruperea liniilor.
  const reconcile = useCallback((lines) => {
    setMeta((m) => {
      const n = {};
      let changed = false;
      for (const L of lines) {
        const old = m[L.id];
        if (old && old.sig === L.sig) { n[L.id] = old; continue; }
        if (old) changed = true;
        n[L.id] = { status: 'idle', latex: null, sig: L.sig };
        dirtyRef.current.add(L.id);
      }
      for (const k of Object.keys(m)) if (!(k in n)) changed = true;
      return changed || Object.keys(n).length !== Object.keys(m).length ? n : m;
    });
    const alive = new Set(lines.map((L) => L.id));
    for (const id of Array.from(dirtyRef.current)) if (!alive.has(id)) dirtyRef.current.delete(id);
  }, []);

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
      if (meta[s.line] && meta[s.line].status === 'done') continue;   // linia e deja text
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
  const LSK = storageKey ? `sdl2:${storageKey}` : null;
  useEffect(() => {
    if (!open || !LSK) return;
    try {
      const raw = localStorage.getItem(LSK);
      if (!raw) return;
      const o = JSON.parse(raw);
      if (o && Array.isArray(o.strokes)) {
        strokesRef.current = o.strokes.filter((s) => s && Array.isArray(s.pts) && s.pts.length);
        seqRef.current = strokesRef.current.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
        lineSeqRef.current = strokesRef.current.reduce((m, s) => Math.max(m, s.line || 0), 0) + 1;
        setMeta(o.meta || {});
        setRows(Math.min(MAX_ROWS, Math.max(START_ROWS, (o.rows | 0) || START_ROWS)));
        // regrupăm ciorna: pragurile se pot schimba între versiuni, iar liniile
        // salvate trebuie să cadă la fel ca acum
        setTimeout(() => reconcile(relayout()), 0);
      }
    } catch { /* ciornă coruptă — pornim de la foaie albă */ }
  }, [open, LSK]);

  const saveDraft = useCallback(() => {
    if (!LSK) return;
    try {
      const strokes = strokesRef.current.map((s) => ({
        id: s.id, line: s.line, color: s.color,
        pts: s.pts.map(([x, y]) => [Math.round(x * 2) / 2, Math.round(y * 2) / 2]),
      }));
      localStorage.setItem(LSK, JSON.stringify({ strokes, meta, rows }));
    } catch { /* fără loc în localStorage — ciorna nu se salvează, atât */ }
  }, [LSK, meta, rows]);
  useEffect(() => { if (open) saveDraft(); }, [open, meta, rows, saveDraft]);

  // ── Rasterizarea unei linii, pentru recunoaștere ──────────────────────
  // Cerneala colorată devine neagră pe alb, la o înălțime confortabilă pentru
  // model (~170 px): pe crop-uri mici confundă virgula cu punctul și 0 cu 6.
  function lineImage(L) {
    if (!L.strokes.length) return null;
    const b = L.box;
    const pad = 14;
    const w = Math.max(28, b.x1 - b.x0 + pad * 2);
    const h = Math.max(28, b.y1 - b.y0 + pad * 2);
    const scale = Math.min(4, Math.max(1, 170 / h), 1600 / w);
    const cv = document.createElement('canvas');
    cv.width = Math.round(w * scale); cv.height = Math.round(h * scale);
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.translate(-b.x0 + pad, -b.y0 + pad);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = '#000'; ctx.fillStyle = '#000'; ctx.lineWidth = PEN_W * 1.2;
    for (const s of L.strokes) {
      if (s.pts.length < 2) { ctx.beginPath(); ctx.arc(s.pts[0][0], s.pts[0][1], PEN_W, 0, 6.2832); ctx.fill(); continue; }
      pathOf(ctx, s.pts); ctx.stroke();
    }
    return cv;
  }

  // Mai multe linii într-o singură imagine: numerotate în stânga, despărțite
  // de o bară groasă. O cerere în loc de patru — contează la limita orară.
  function composite(list) {
    const imgs = list.map((L) => ({ L, cv: lineImage(L) })).filter((o) => o.cv);
    if (!imgs.length) return null;
    const GAP = 22;
    const w = Math.min(1700, GUTTER + Math.max(...imgs.map((o) => o.cv.width)) + 18);
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = Math.min(2200, imgs.reduce((s, o) => s + o.cv.height + GAP, GAP));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.textBaseline = 'middle';
    let y = GAP;
    const used = [];
    imgs.forEach((o, i) => {
      if (y + o.cv.height > cv.height) return;   // ce nu încape rămâne pe tura următoare
      ctx.fillStyle = '#000'; ctx.font = 'bold 26px sans-serif';
      ctx.fillText(String(i + 1) + '.', 6, y + o.cv.height / 2);
      ctx.drawImage(o.cv, GUTTER, y);
      used.push(o.L.id);
      y += o.cv.height + GAP;
      if (i < imgs.length - 1) {
        ctx.strokeStyle = '#999'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(2, y - GAP / 2); ctx.lineTo(cv.width - 2, y - GAP / 2); ctx.stroke();
      }
    });
    if (!used.length) return null;
    return { dataUrl: cv.toDataURL('image/png'), used };
  }

  // ── Recunoașterea ─────────────────────────────────────────────────────
  const metaRef = useRef(meta);
  useEffect(() => { metaRef.current = meta; }, [meta]);

  const recognize = useCallback(async (ids) => {
    if (busyRef.current) return;
    const all = linesOf();
    const byId = new Map(all.map((L) => [L.id, L]));
    const list = ids
      .map((id) => byId.get(id)).filter(Boolean)
      // pete izolate (un punct rătăcit): nu are rost să plece la model
      .filter((L) => (L.box.x1 - L.box.x0) > 14 || (L.box.y1 - L.box.y0) > 14 || L.strokes.length > 1)
      .sort((a, b) => a.box.y0 - b.box.y0)
      .slice(0, MAX_BATCH);
    if (!list.length) return;
    const packed = composite(list);
    if (!packed) return;
    const sigById = new Map(list.map((L) => [L.id, L.sig]));

    // context: ce scrie pe liniile de DEASUPRA primei linii din lot — modelul
    // alege mult mai bine între „0" și „6", „,"" și „." când vede firul
    const first = list[0];
    const prev = all
      .filter((L) => L.box.y1 <= first.box.y0 && metaRef.current[L.id] && metaRef.current[L.id].latex)
      .slice(-3).map((L) => normalizeLatex(metaRef.current[L.id].latex)).join('\n');

    busyRef.current = true;
    setErr(null);
    setMeta((m) => {
      const n = { ...m };
      for (const id of packed.used) n[id] = { ...(n[id] || {}), status: 'busy', sig: sigById.get(id) };
      return n;
    });
    try {
      const { lines } = await aiClient.handwriting({
        imageBase64: packed.dataUrl, count: packed.used.length, hint, prev,
      });
      setMeta((m) => {
        const n = { ...m };
        (lines || []).forEach((l) => {
          const id = packed.used[l.i - 1];
          if (id == null) return;
          const sig = sigById.get(id);
          // între timp elevul poate să fi scris mai departe pe linia asta — atunci
          // răspunsul e depășit și linia se citește din nou, întreagă
          if (n[id] && n[id].sig !== sig) { dirtyRef.current.add(id); return; }
          n[id] = l.latex ? { status: 'done', latex: l.latex, sig } : { status: 'idle', latex: null, sig };
        });
        for (const id of packed.used) if (n[id] && n[id].status === 'busy') n[id] = { status: 'idle', latex: null, sig: sigById.get(id) };
        return n;
      });
    } catch (e) {
      setErr(e.message || 'Nu am putut citi scrisul.');
      setMeta((m) => {
        const n = { ...m };
        for (const id of packed.used) if (n[id] && n[id].status === 'busy') n[id] = { status: 'idle', latex: null, sig: sigById.get(id) };
        return n;
      });
    } finally {
      busyRef.current = false;
      ids.filter((id) => !packed.used.includes(id)).forEach((id) => dirtyRef.current.add(id));
      if (dirtyRef.current.size) setTimeout(() => { if (flushRef.current) flushRef.current(); }, 90);
    }
  }, [hint, linesOf]);

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

  function onDown(e) {
    if (tool === 'pan') return;
    if (e.pointerType === 'pen') penSeenRef.current = true;
    if (penSeenRef.current && e.pointerType === 'touch') return;   // palma sprijinită nu scrie
    if (!e.isPrimary) return;
    e.preventDefault();
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* merge și fără capture */ }
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    const [x, y] = pointOf(e);
    if (tool === 'eraser') { drawingRef.current = { eraser: true }; erase(x, y); return; }
    drawingRef.current = { id: seqRef.current++, line: 0, color, pts: [[x, y]] };
    strokesRef.current.push(drawingRef.current);
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

  // Gruparea se reface ABIA la ridicarea mâinii: acum se știe cât de sus și cât
  // de jos a ajuns traseul, deci și cu ce se leagă.
  function onUp() {
    const d = drawingRef.current;
    drawingRef.current = null;
    if (!d) return;
    if (d.eraser) { reconcile(relayout()); saveDraft(); return; }
    reconcile(relayout());
    growIfNeeded(strokeBox(d).y1);
    saveDraft();
    repaintSoon();
    if (auto) scheduleFlush();
  }

  function erase(x, y) {
    const before = strokesRef.current.length;
    const hitLines = new Set();
    strokesRef.current = strokesRef.current.filter((s) => {
      const hit = s.pts.some(([px, py]) => Math.abs(px - x) < ERASER_R && Math.abs(py - y) < ERASER_R);
      if (hit) hitLines.add(s.line);
      return !hit;
    });
    // radiera trece și peste textul deja transformat: îl șterge cu totul
    for (const L of linesOf()) {
      if (x >= L.box.x0 - 20 && x <= L.box.x1 + 20 && y >= L.box.y0 - 14 && y <= L.box.y1 + 14) hitLines.add(L.id);
    }
    if (!hitLines.size) return;
    // linia atinsă își pierde textul; restul se așază singur la regrupare
    for (const s of strokesRef.current) if (hitLines.has(s.line)) s.line = 0;
    if (before !== strokesRef.current.length) repaintSoon();
  }

  // Foaia crește singură și urcă odată cu elevul, ca linia următoare să fie
  // mereu sub mână, fără să caute bara de derulare.
  function growIfNeeded(bottomY) {
    if (bottomY > (rows - 2) * ROW_H) setRows((r) => Math.min(MAX_ROWS, r + 3));
    const el = scrollRef.current;
    if (!el) return;
    const want = bottomY + ROW_H * 1.5;
    if (want > el.scrollTop + el.clientHeight) {
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = want - scrollRef.current.clientHeight;
      });
    }
  }

  function undo() {
    const s = strokesRef.current.pop();
    if (!s) return;
    reconcile(relayout());
    repaintSoon(); saveDraft();
  }

  function clearAll() {
    strokesRef.current = [];
    dirtyRef.current.clear();
    setMeta({}); setRows(START_ROWS); setErr(null);
    repaintSoon();
    if (LSK) { try { localStorage.removeItem(LSK); } catch { /* nimic de curățat */ } }
  }

  // ── Textul final ──────────────────────────────────────────────────────
  const lines = useMemo(() => linesOf(), [linesOf, tick, meta]);   // eslint-disable-line react-hooks/exhaustive-deps

  const textOut = useMemo(
    () => lines.map((L) => (meta[L.id] && meta[L.id].latex ? toPlain(meta[L.id].latex) : ''))
      .filter(Boolean).join('\n').trim(),
    [lines, meta],
  );

  const nDone = lines.filter((L) => meta[L.id] && meta[L.id].latex).length;
  const nBusy = lines.filter((L) => meta[L.id] && meta[L.id].status === 'busy').length;
  const asteapta = lines.filter((L) => !(meta[L.id] && (meta[L.id].latex || meta[L.id].status === 'busy')));

  function transformaTot() {
    asteapta.forEach((L) => dirtyRef.current.add(L.id));
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    flush();
  }

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
      <div style={{
        background: '#fff', borderRadius: 14, width: 'min(1100px, 100%)', height: 'min(94vh, 100%)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden', boxShadow: '0 18px 60px rgba(0,0,0,.35)',
      }}>

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
            title={auto ? 'Linia se transformă singură, la ~1 secundă după ce ridici mâna' : 'Transformarea automată e oprită — apeși tu butonul'}>
            ✨ Automat: {auto ? 'pornit' : 'oprit'}
          </button>
          {(!auto || asteapta.length > 0) && (
            <button style={{ ...toolBtn(false), background: '#fff8e1', borderColor: '#e8b931', color: '#8a6d00' }}
              onClick={transformaTot} disabled={!asteapta.length}
              title="Transformă acum tot ce ai scris">
              ✨ Transformă {asteapta.length ? `(${asteapta.length})` : ''}
            </button>
          )}
        </div>

        {/* ── Foaia ── */}
        <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', background: '#fdfdf8' }}>
          <div style={{ position: 'relative', width: '100%', height: sheetH }}>

            <div aria-hidden style={{
              position: 'absolute', inset: 0,
              backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent ${ROW_H - 1}px, #dfe6ee ${ROW_H - 1}px, #dfe6ee ${ROW_H}px)`,
            }} />
            <div aria-hidden style={{ position: 'absolute', top: 0, bottom: 0, left: GUTTER, width: 1, background: '#f0c9c9' }} />

            {/* liniile transformate în text frumos — așezate exact peste cerneala lor */}
            {lines.map((L) => {
              const m = meta[L.id];
              if (!m) return null;
              const cy = (L.box.y0 + L.box.y1) / 2;
              const left = Math.max(GUTTER + 8, L.box.x0);
              if (m.status === 'busy') {
                return (
                  <div key={'b' + L.id} style={{
                    position: 'absolute', left, top: cy, transform: 'translateY(-50%)',
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
                <div key={'t' + L.id} style={{
                  position: 'absolute', left, top: cy, transform: 'translateY(-50%)',
                  maxWidth: `calc(100% - ${left + 10}px)`, overflowX: 'auto', overflowY: 'hidden',
                }}>
                  <LinieRandata
                    latex={m.latex}
                    onEdit={() => setMeta((mm) => ({ ...mm, [L.id]: { status: 'idle', latex: null } }))}
                  />
                </div>
              );
            })}

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
            {nDone ? `${nDone} ${nDone === 1 ? 'linie transformată' : 'linii transformate'}` : 'scrie pe foaie — linia se transformă singură'}
            {nBusy ? ' · se citește…' : ''}
            {asteapta.length ? ` · ${asteapta.length} în așteptare` : ''}
          </span>
        </div>
      </div>

      <style>{'@keyframes sdl-spin{to{transform:rotate(360deg)}}'}</style>
    </div>
  );
}
