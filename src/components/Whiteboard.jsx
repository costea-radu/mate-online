// =====================================================================
// src/components/Whiteboard.jsx — TABLA din „Meditații cu Profesorul Virtual"
// („Planul meu", /meditatii/plan)
//
// PE TABLĂ stă DOAR matematică: teoria pe etape, exercițiile, explicațiile și
// calculele. Ce SPUNE profesorul — salutul, propunerile, „Ai înțeles?",
// verdictele — NU se mai scrie pe tablă: se AUDE (vocea browserului, ca în
// sala live) și apare ca SUBTITRARE, jos pe tablă.
//
// Profesorul e Prof. Tudor din meditațiile live: camera lui stă la colțul
// tablei (live/ProfCamera.jsx) — se uită spre tablă când scrie, ascultă când
// aștepți un răspuns, iar gura urmează vocea.
//
// Discuția se poartă tot PE TABLĂ, ca la meditațiile live: întrebări GRILĂ
// sau cu răspuns de COMPLETAT (BoardQuestion) și variantele unei discuții
// (ChoiceCard: a, b, c… sau „scrie-mi altceva").
//
// VOCEA CONDUCE SCRISUL: literele apar în ritmul în care Prof. Tudor rostește
// propozițiile (src/lib/tabla.js → speechPlan). Fără sunet sau fără voce
// românească, subtitrările și scrisul merg în același ritm, „în gând", iar
// „⏭ Sari peste scriere" arată etapa întreagă, imediat. KaTeX randează o
// SINGURĂ DATĂ pe bloc: formulele nu clipesc.
// =====================================================================
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { preMessage } from './AITutor';
import { ensureKatex, renderMath } from '../lib/katex';
import { prof } from '../lib/live/vorbire';
import { splitBoard, speechPlan } from '../lib/tabla';
import { ProfCamera, ProfCaptions, useProf, TUDOR } from './live/ProfCamera';
import { ChoiceCard } from './live/PollCard';
import BoardQuestion from './BoardQuestion';
import AICreditAlert from './AICreditAlert';
import '../styles/live.css';

// ─── markdown-lite → HTML „de tablă" ────────────────────────────────────────
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function inlineBd(t = '') {
  return escHtml(t)
    .replace(/\[([^\]\n]+)\]\((\/[^)\s]*)\)/g, (m, label, href) =>
      `<a href="${href.replace(/"/g, '&quot;')}" data-internal="1" class="bd-link">🧩 ${label} →</a>`)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
function boardHtml(text) {
  const src = preMessage(String(text || ''));
  let out = '';
  for (const raw of src.split('\n')) {
    const l = raw.trim();
    if (!l) { out += '<div class="bd-gap"></div>'; continue; }
    let m;
    if ((m = /^#{3,}\s+(.+)$/.exec(l))) { out += `<div class="bd-h4">${inlineBd(m[1])}</div>`; continue; }
    if ((m = /^#{1,2}\s+(.+)$/.exec(l))) { out += `<div class="bd-h3">${inlineBd(m[1])}</div>`; continue; }
    if ((m = /^(?:[-•*])\s+(.+)$/.exec(l))) { out += `<div class="bd-li">${inlineBd(m[1])}</div>`; continue; }
    if ((m = /^(\d+)[.)]\s+(.+)$/.exec(l))) { out += `<div class="bd-li bd-num" data-n="${escHtml(m[1])}.">${inlineBd(m[2])}</div>`; continue; }
    // linie formată DOAR dintr-o formulă → o punem în „casetă", ca pe tablă
    if (/^\$\$?[\s\S]+\$\$?$/.test(l) && !/\s\$/.test(l.slice(1, -1))) { out += `<div class="bd-formula">${inlineBd(l)}</div>`; continue; }
    out += `<div class="bd-line">${inlineBd(l)}</div>`;
  }
  return out;
}

// ─── „cerneala": fiecare caracter devine un <span> cu întârzierea lui ────────
// Formulele KaTeX se dezvăluie ca un întreg (nu le putem tăia în caractere).
function collectInk(node, out) {
  if (node.nodeType === 3) { if (node.nodeValue) out.push({ t: 'text', node }); return; }
  if (node.nodeType !== 1) return;
  const cl = node.classList;
  if (cl && (cl.contains('katex') || cl.contains('katex-display') || cl.contains('bd-link'))) { out.push({ t: 'blob', node }); return; }
  Array.from(node.childNodes).forEach((c) => collectInk(c, out));
}
function inkify(root, cps, manual = false) {
  if (!root) return { total: 0, spans: [], delays: [] };
  const items = [];
  collectInk(root, items);
  const totalChars = items.reduce((n, it) => n + (it.t === 'text' ? it.node.nodeValue.length : 6), 0);
  // texte foarte lungi: dezvăluire pe CUVINTE (mii de <span>-uri ar încetini)
  const byWord = totalChars > 2400;
  const step = 1000 / (cps || 55);
  const spans = [];    // bucățile de cerneală, în ordinea scrierii
  const delays = [];   // momentul (ms) la care apare fiecare — ne spune UNDE scrie acum
  let t = 0;
  for (const it of items) {
    if (it.t === 'blob') {
      it.node.classList.add('bd-ink');
      if (manual) { it.node.style.opacity = '0'; it.node.style.animation = 'none'; }
      else it.node.style.animationDelay = Math.round(t) + 'ms';
      spans.push(it.node); delays.push(t);
      t += step * Math.max(4, Math.min(14, (it.node.textContent || '').length * 0.7));
      continue;
    }
    const txt = it.node.nodeValue;
    if (!txt) continue;
    const frag = document.createDocumentFragment();
    const pieces = byWord ? txt.split(/(\s+)/).filter((x) => x !== '') : Array.from(txt);
    for (const piece of pieces) {
      const el = document.createElement('span');
      el.className = 'bd-ink';
      el.textContent = piece;
      if (manual) { el.style.opacity = '0'; el.style.animation = 'none'; }
      else el.style.animationDelay = Math.round(t) + 'ms';
      spans.push(el); delays.push(t);
      frag.appendChild(el);
      t += /^\s+$/.test(piece) ? step * 0.45 : step * piece.length;
    }
    it.node.parentNode.replaceChild(frag, it.node);
  }
  return { total: t, spans, delays };
}

// ─── dezvăluirea condusă de VOCE ────────────────────────────────────────────
// Vocea anunță începutul fiecărei propoziții (onProgress → frac). Textul se
// scrie apoi treptat, într-un ritm calculat cât să acopere exact propoziția
// care se aude — așa profesorul scrie fix ce spune.
function revealTo(st, target, spreadMs) {
  st.target = Math.max(st.target || 0, Math.min(st.spans.length, Math.max(0, target)));
  const left = st.target - st.shown;
  st.rate = left > 0 ? left / Math.max(150, spreadMs) : 0; // spans / ms
  if (st.timer) return;
  st.acc = 0;
  st.last = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  st.timer = setInterval(() => {
    const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
    const dt = Math.min(400, now - st.last); st.last = now;
    if (st.shown >= st.target) {
      if (st.shown >= st.spans.length) { clearInterval(st.timer); st.timer = null; st.onReach?.(); }
      return;
    }
    st.acc += st.rate * dt;
    const n = Math.floor(st.acc);
    if (n <= 0) return;
    st.acc -= n;
    const end = Math.min(st.target, st.shown + n);
    for (; st.shown < end; st.shown++) st.spans[st.shown].style.opacity = '1';
    if (st.shown >= st.spans.length) { clearInterval(st.timer); st.timer = null; st.onReach?.(); }
  }, 50);
}
function revealAll(st) {
  if (!st) return;
  if (st.timer) { clearInterval(st.timer); st.timer = null; }
  for (; st.shown < st.spans.length; st.shown++) st.spans[st.shown].style.opacity = '1';
  st.target = st.spans.length;
}
function stopReveal(st) { if (st?.timer) { clearInterval(st.timer); st.timer = null; } }

// Derulează blocul curent în dreptul ochilor. ÎNTÂI în interiorul tablei
// (zona ei derulabilă); pagina se mișcă doar dacă tabla nu are zonă proprie —
// cazul telefonului. Un bloc încă nerandat (înălțime ~0) e ignorat, altfel am
// derula pagina degeaba, înainte ca textul să existe.
function scrollBlockIntoView(el) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.height < 24) return;
  let p = el.parentElement;
  while (p && p !== document.body) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 4) {
      // banda cu materiale stă lipită sus (sticky) → lăsăm loc sub ea
      const stuck = p.querySelector('.bd-materials');
      const pad = 12 + (stuck ? stuck.getBoundingClientRect().height : 0);
      const delta = r.top - p.getBoundingClientRect().top - pad;
      if (Math.abs(delta) > 6) { try { p.scrollBy({ top: delta, behavior: 'smooth' }); } catch { p.scrollTop += delta; } }
      return;
    }
    p = p.parentElement;
  }
  const vh = window.innerHeight || 0;
  if (r.top < 70 || r.top > vh - 90) { try { el.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch { /* ignore */ } }
}

// Aduce la vedere PARTEA DE JOS a unui element (cardul cu verdictul), cu loc
// dedesubt pentru subtitrare: întâi în zona derulabilă a tablei, altfel pagina.
export function scrollBottomIntoView(el, pad = 76) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  let p = el.parentElement;
  while (p && p !== document.body) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === 'auto' || oy === 'scroll') && p.scrollHeight > p.clientHeight + 4) {
      const box = p.getBoundingClientRect();
      const delta = r.bottom - (box.bottom - pad);
      if (delta > 4) { try { p.scrollBy({ top: delta, behavior: 'smooth' }); } catch { p.scrollTop += delta; } }
      return;
    }
    p = p.parentElement;
  }
  const vh = window.innerHeight || 0;
  const delta = r.bottom - (vh - pad);
  if (delta > 4) { try { window.scrollBy({ top: delta, behavior: 'smooth' }); } catch { window.scrollTo(0, window.scrollY + delta); } }
}

// ═════════════════════════════════════════════════════════════════════════════
// TEXTUL SCRIS PE TABLĂ
//   voiceFrac (0..1) — cât din bloc a „rostit" profesorul: scrisul îl urmează.
//   Fără voiceFrac, scrisul e cronometrat în CSS (cps caractere pe secundă).
// ═════════════════════════════════════════════════════════════════════════════
export function BoardText({ text, animate = true, voiceFrac = null, cps = 55,
  onDone = null, onSkip = null, onInternalLink = null, replayKey = 0 }) {
  const ref = useRef(null);
  const doneRef = useRef(onDone);
  const skipRef = useRef(onSkip);
  const timerRef = useRef(null);
  const inkRef = useRef(null);           // { spans, shown, target, timer } — modul „voce"
  const [writing, setWriting] = useState(false);
  const voiceOn = voiceFrac !== null && voiceFrac !== undefined;
  useEffect(() => { doneRef.current = onDone; skipRef.current = onSkip; }, [onDone, onSkip]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    let dead = false;
    clearTimeout(timerRef.current);
    stopReveal(inkRef.current);
    inkRef.current = null;
    el.classList.remove('bd-ink-done');
    el.innerHTML = boardHtml(text);
    let speed = cps;
    // sistemul cere „mișcare redusă" → textul apare dintr-odată
    try { if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) speed = 0; } catch { /* ignore */ }
    const finish = () => { setWriting(false); doneRef.current?.(); };
    const start = () => {
      if (dead || !ref.current) return;
      // scrisul condus de VOCE: literele apar pe măsură ce profesorul le rostește
      if (animate && voiceOn) {
        const { spans } = inkify(ref.current, 0, true);
        if (!spans.length) { ref.current.classList.add('bd-ink-done'); finish(); return; }
        inkRef.current = { spans, shown: 0, target: 0, timer: null, onReach: () => { if (!dead) finish(); } };
        setWriting(true);
        return;
      }
      if (!animate || !speed) { ref.current.classList.add('bd-ink-done'); finish(); return; }
      const { total } = inkify(ref.current, speed, false);
      if (!total) { ref.current.classList.add('bd-ink-done'); finish(); return; }
      setWriting(true);
      timerRef.current = setTimeout(() => { if (!dead) finish(); }, total + 150);
    };
    ensureKatex().then(() => {
      if (dead || !ref.current) return;
      renderMath(ref.current);
      start();
    });
    return () => { dead = true; clearTimeout(timerRef.current); stopReveal(inkRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, animate, voiceOn, replayKey]);

  // progresul vocii → cât s-a scris pe tablă
  useEffect(() => {
    const st = inkRef.current;
    if (!voiceOn || !st) return;
    const f = Math.min(1, Math.max(0, voiceFrac));
    const target = Math.round(f * st.spans.length);
    if (f >= 1) { revealTo(st, st.spans.length, 300); return; }
    revealTo(st, target, Math.max(220, (target - st.shown) * 72));
  }, [voiceFrac, voiceOn]);

  const skip = useCallback(() => {
    clearTimeout(timerRef.current);
    if (inkRef.current) revealAll(inkRef.current);
    ref.current?.classList.add('bd-ink-done');
    setWriting(false);
    if (skipRef.current) skipRef.current();
    else doneRef.current?.();
  }, []);

  function onClick(e) {
    const a = e.target.closest?.('a[data-internal]');
    if (!a || !onInternalLink) return;
    e.preventDefault();
    onInternalLink(a.getAttribute('href'));
  }

  return (
    <div className="bd-text-wrap">
      <div ref={ref} className="bd-text" onClick={onClick} />
      {writing && (
        <button type="button" className="bd-skip" onClick={skip} title="Arată tot textul, fără animație">
          ⏭ Sari peste scriere
        </button>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// RAMA TABLEI — tabla + Prof. Tudor (camera din colț) + subtitrarea
//   mood: 'writing' | 'thinking' | 'listening' | 'idle' — îl regizează pe profesor
// ═════════════════════════════════════════════════════════════════════════════
export function Whiteboard({ title = null, subtitle = null, chips = null, toolbar = null, mood = 'idle',
  tray = null, tall = false, tone = 'board', bodyClass = '', children }) {
  return (
    <div className={`med-board${tall ? ' is-tall' : ''}`}>
      <div className="bd-frame">
        <div className={`bd-surface${tone === 'work' ? ' is-work' : ''}`}>
          {(title || subtitle || toolbar || chips) && (
            <div className="bd-head">
              <div className="bd-head-main">
                {title && <div className="bd-title">{title}</div>}
                {subtitle && <div className="bd-sub">{subtitle}</div>}
                {chips && <div className="bd-chips">{chips}</div>}
              </div>
              {toolbar && <div className="bd-tools">{toolbar}</div>}
            </div>
          )}
          <div className={`bd-body${bodyClass ? ' ' + bodyClass : ''}`}>{children}</div>
          {/* ce SPUNE profesorul: subtitrare, nu scris pe tablă */}
          <ProfCaptions />
          <ProfCamera mood={mood} />
        </div>
      </div>

      {tray && (
        <div className="bd-tray">
          <div className="bd-tray-actions">{tray}</div>
        </div>
      )}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// LECȚIA PE ETAPE — Prof. Tudor scrie o etapă (și o explică cu voce), apoi te
// verifică printr-o întrebare grilă / de completat, direct pe tablă, sau te
// întreabă „Ai înțeles?"; la „Nu", o reia altfel, tot pe tablă.
// ═════════════════════════════════════════════════════════════════════════════
// Lecția vine structurată pe „## …" (Pe scurt, Noțiunile esențiale, Formulele,
// Exemplu rezolvat, Schema capitolului) → fiecare titlu devine o ETAPĂ.
export function splitStages(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  let parts = t.split(/\n(?=\s*##\s)/g).map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) {
    // fără titluri „##": tăiem pe paragrafe, ~3 etape
    const paras = t.split(/\n{2,}/).filter(Boolean);
    const per = Math.max(1, Math.ceil(paras.length / 3));
    parts = [];
    for (let i = 0; i < paras.length; i += per) parts.push(paras.slice(i, i + per).join('\n\n'));
  }
  const out = [];
  for (const p of parts) {
    const m = /^\s*##\s*(.+)$/m.exec(p);
    const title = m ? m[1].trim() : `Partea ${out.length + 1}`;
    const body = (m ? p.replace(/^\s*##\s*.+\n?/, '') : p).trim();
    // etapele prea scurte se lipesc de precedenta (altfel întrebările devin sâcâitoare)
    if (out.length && splitBoard(body).board.length < 60) { out[out.length - 1].body += `\n\n### ${title}\n${body}`; continue; }
    out.push({ title, body });
  }
  return out.filter((s) => s.body);
}

// Un bloc de tablă: ce se scrie, ce se spune și întrebarea de verificare
function blockOf(raw) {
  const { board, questions } = splitBoard(raw);
  return { raw, board, question: questions[0] || null };
}

// Răspunsul dat, pe scurt, pentru tablă („b) $x = 6$" / „4")
function givenLabel(q, a) {
  if (!q || !a) return '';
  if (q.type === 'grila') { const i = 'abcde'.indexOf(a.answer); return `${a.answer}) ${q.options?.[i] ?? ''}`; }
  return a.answer;
}

// Întrebarea la care elevul a răspuns rămâne pe tablă, pe un rând
function QuestionDone({ q, a }) {
  if (!q || !a) return null;
  return (
    <div className={`bd-qdone ${a.correct ? 'is-good' : 'is-bad'}`}>
      <BoardText text={`✎ ${q.q}  →  ${givenLabel(q, a)} ${a.correct ? '✓' : `✗ (corect: ${givenLabel(q, { answer: q.answer })})`}`} animate={false} />
    </div>
  );
}

export function BoardLesson({ chapterId = null, title, text, materials = [], onExplainAgain, onUnderstood,
  onFinish, onClose, onEnd, onPrint, onChat, onInternalLink,
  finishLabel = '✍️ Am înțeles — trecem la exerciții', busy = false }) {
  const stages = useMemo(() => splitStages(text).map((s) => ({ ...s, ...blockOf(`## ${s.title}\n${s.body}`) })), [text]);
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState('write');     // write | check | ask | loading | chat
  const [replay, setReplay] = useState(0);
  const [extras, setExtras] = useState({});      // { [etapă]: [blocuri reexplicate] }
  const [activeExtra, setActiveExtra] = useState(-1);
  const [instantBlock, setInstantBlock] = useState(null);
  const [vFrac, setVFrac] = useState(0);
  const [answers, setAnswers] = useState({});    // { 'etapă:reluare': { answer, correct } }
  const [warn, setWarn] = useState(null);
  const [faraCredite, setFaraCredite] = useState(false); // lecția s-a oprit: credite AI epuizate
  const pst = useProf();
  const activeRef = useRef(null);
  const cardRef = useRef(null);
  const modeRef = useRef(mode);
  const liveRef = useRef({});                    // valorile curente, pentru callback-urile vocii
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // lecție nouă → tabla se șterge și o luăm de la prima etapă
  useEffect(() => {
    setIdx(0); setMode('write'); setExtras({}); setActiveExtra(-1);
    setInstantBlock(null); setWarn(null); setAnswers({}); setReplay((r) => r + 1);
  }, [text]);
  // la ieșirea de pe tablă, profesorul tace
  useEffect(() => () => { prof.stop('lectie'); prof.stop('lectie-ask'); }, []);

  const stage = stages[idx] || null;
  const last = idx === stages.length - 1;
  const block = activeExtra === -1 ? stage : ((extras[idx] || [])[activeExtra] || null);
  const blockKey = `${idx}:${activeExtra}:${replay}`;
  const qKey = `${idx}:${activeExtra}`;
  const instant = instantBlock === blockKey;
  const attemptsUsed = (extras[idx] || []).length;
  liveRef.current = { blockKey, block, qKey, answers };

  // tot blocul e scris și spus → întrebarea de verificare (dacă are) sau „Ai înțeles?"
  const afterBlock = useCallback((key) => {
    const L = liveRef.current;
    if (key !== L.blockKey || modeRef.current !== 'write') return;
    setVFrac(1);
    const next = L.block?.question && !L.answers[L.qKey] ? 'check' : 'ask';
    modeRef.current = next;
    setMode(next);
  }, []);

  // ── VOCEA CONDUCE SCRISUL: fiecare bloc nou e rostit propoziție cu
  //    propoziție, iar literele apar în ritmul vocii (sau al subtitrărilor).
  useEffect(() => {
    if (!block || instant || modeRef.current !== 'write') return undefined;
    setVFrac(0);
    const key = blockKey;
    let done = false;
    const ctl = prof.say(speechPlan(block.raw), {
      key: 'lectie',
      onProgress: ({ item }) => setVFrac(item.board ? item.boardEnd : item.boardStart),
      onEnd: () => { if (done) return; done = true; setVFrac(1); setTimeout(() => afterBlock(key), 450); },
      // întrerupt (ex. răspunsul la o întrebare din conversație): tot textul, apoi mai departe
      onStop: () => { if (done) return; done = true; setVFrac(1); afterBlock(key); },
    });
    return () => { done = true; ctl.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockKey]);

  // ce spune profesorul când s-a terminat etapa (fără să scrie pe tablă)
  useEffect(() => {
    const queue = prof.isBusy() && !prof.isBusy('lectie');
    if (mode === 'ask') {
      const q = activeExtra >= 0 ? 'Acum e mai clar?' : last ? 'Am terminat lecția. Ai înțeles tot?' : 'Ai înțeles?';
      prof.say(q, { key: 'lectie-ask', queue });
    } else if (mode === 'loading') prof.say('Stai o clipă, caut o explicație mai simplă.', { key: 'lectie-ask' });
    else if (mode === 'chat') prof.say('Hai să o luăm împreună, în scris. Scrie-mi exact ce nu îți iese.', { key: 'lectie-ask' });
    // cardul cu întrebarea / variantele — în dreptul ochilor
    if (mode !== 'write') {
      const t = setTimeout(() => scrollBlockIntoView(cardRef.current), 120);
      return () => clearTimeout(t);
    }
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, blockKey]);

  // după răspuns, cardul crește (verdictul, explicația, butoanele): îl aducem
  // întreg la vedere, deasupra subtitrării
  useEffect(() => {
    if (mode !== 'check') return undefined;
    const t = setTimeout(() => scrollBottomIntoView(cardRef.current), 160);
    return () => clearTimeout(t);
  }, [answers, mode]);

  // tabla PĂSTREAZĂ tot ce s-a scris → aducem în dreptul ochilor blocul curent
  // (a doua încercare după KaTeX, când înălțimea blocului e cea reală)
  useEffect(() => {
    const t1 = setTimeout(() => scrollBlockIntoView(activeRef.current), 150);
    const t2 = setTimeout(() => scrollBlockIntoView(activeRef.current), 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [blockKey]);

  if (!stages.length) return null;

  function goStage(i) {
    prof.stop('lectie-ask');
    modeRef.current = 'write';
    setIdx(i); setActiveExtra(-1); setMode('write'); setWarn(null); setReplay((r) => r + 1);
  }
  function skipBlock() {
    setInstantBlock(blockKey);
    prof.stop('lectie');
    afterBlock(blockKey);
  }
  function goNext() {
    if (last) { prof.stop('lectie-ask'); onFinish?.(); return; }
    goStage(idx + 1);
  }
  // „✅ Da, continuă" (sau „Mai departe" după întrebare) — contorul etapelor, fără AI
  function yes() {
    if (!answers[qKey]) onUnderstood?.({ chapterId, stageTitle: stage.title, attempts: attemptsUsed, understood: true });
    goNext();
  }
  // răspunsul la întrebarea de verificare
  function onAnswer(res) {
    setAnswers((a) => ({ ...a, [qKey]: res }));
    if (res.correct) onUnderstood?.({ chapterId, stageTitle: stage.title, attempts: attemptsUsed, understood: true });
  }
  function nextAfterCheck() {
    const a = answers[qKey];
    if (a && !a.correct) onUnderstood?.({ chapterId, stageTitle: stage.title, attempts: attemptsUsed, understood: false });
    goNext();
  }
  // „Nu, mai explică o dată" — profesorul REIA etapa și o SCRIE tot pe tablă
  async function no() {
    const attempt = attemptsUsed + 1;
    if (attempt > 3) { modeRef.current = 'chat'; setMode('chat'); onChat?.(stage.title, null, true); return; }
    setWarn(null); modeRef.current = 'loading'; setMode('loading');
    try {
      const t = await onExplainAgain?.({ chapterId, stageTitle: stage.title, stageText: stage.board, attempt });
      if (!t) throw new Error('Nu am primit explicația.');
      setExtras((e) => ({ ...e, [idx]: [...(e[idx] || []), blockOf(t)] }));
      setInstantBlock(null);
      setActiveExtra(attempt - 1);
      modeRef.current = 'write';
      setMode('write');
    } catch (err) {
      // creditele AI s-au terminat → nu lăsăm lecția în aer cu un mesaj sec
      if (err?.code === 'BUDGET_MONTH') { setFaraCredite(true); setWarn(null); }
      else setWarn(err?.message || 'Nu am reușit să reiau explicația acum. Mai încearcă o dată sau întreabă-mă în conversație.');
      modeRef.current = 'ask';
      setMode('ask');
    }
  }

  const chips = (
    <div className="bd-stagechips" role="tablist" aria-label="Etapele lecției">
      {stages.map((s, i) => (
        <button key={i} type="button" role="tab" aria-selected={i === idx}
          className={`bd-stagechip${i === idx ? ' is-now' : ''}${i < idx ? ' is-done' : ''}`}
          onClick={() => goStage(i)}
          title={`Reia lecția de la „${s.title}"${(extras[i] || []).length ? ` — ai cerut reexplicare de ${(extras[i] || []).length}×` : ''}`}>
          <span className="bd-stagechip-n">{i < idx ? '✓' : i + 1}</span>
          <span className="bd-stagechip-t">{s.title}</span>
          {(extras[i] || []).length > 0 && <span className="bd-stagechip-r" title="ai cerut reexplicare">🔁</span>}
        </button>
      ))}
    </div>
  );

  const active = (i, k) => i === idx && activeExtra === k;
  const blockProps = (i, k) => ({
    onInternalLink,
    animate: active(i, k) && !instant && mode === 'write',
    voiceFrac: active(i, k) && !instant ? vFrac : null,
    onSkip: active(i, k) ? skipBlock : null,
  });
  // după textul blocului: întrebarea lui (activă) sau rezultatul (dacă a răspuns)
  const afterText = (i, k, b) => {
    const key = `${i}:${k}`;
    if (active(i, k) && mode === 'check' && b?.question) {
      const a = answers[key] || null;
      return (
        <div ref={cardRef}>
          <BoardQuestion q={b.question} id={key} answered={a} onAnswer={onAnswer}
            speaker={prof} speakKey="lectie-ask"
            nextLabel={last ? '✍️ Trecem la exerciții →' : 'Mai departe →'}
            onNext={nextAfterCheck}
            extra={a && !a.correct && attemptsUsed < 3
              ? <button type="button" className="lv-btn-soft" onClick={no}>🔁 Explică-mi altfel</button> : null} />
        </div>
      );
    }
    return answers[key] ? <QuestionDone q={b?.question} a={answers[key]} /> : null;
  };

  const askQ = activeExtra >= 0 ? 'Acum e mai clar?' : last ? 'Am terminat lecția. Ai înțeles tot?' : 'Ai înțeles?';

  return (
    <Whiteboard
      tall
      title={<><span className="bd-title-ico">📖</span> {title}</>}
      subtitle={`Etapa ${idx + 1} din ${stages.length} · ${stage.title}`}
      chips={chips}
      mood={mode === 'write' ? 'writing' : mode === 'loading' ? 'thinking' : 'listening'}
      toolbar={<>
        {pst.key === 'lectie' && (pst.paused
          ? <button type="button" className="bd-tool is-on" onClick={() => prof.resume()} title="Prof. Tudor continuă de unde a rămas">▶ Continuă</button>
          : <button type="button" className="bd-tool" onClick={() => prof.pause()} title="Prof. Tudor se oprește">❚❚ Pauză</button>)}
        {onPrint && <button type="button" className="bd-tool" onClick={onPrint} title="Salvează lecția ca PDF">📄 PDF</button>}
        {onClose && <button type="button" className="bd-tool" onClick={() => { prof.stop(); onClose(); }}>✕ Închide</button>}
      </>}
      tray={<>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => { prof.stop(); onFinish?.(); }}>{finishLabel}</button>
        {onEnd && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => { prof.stop(); onEnd(); }}>🏁 Încheie meditația și dă-mi tema</button>}
      </>}
    >
      {materials?.length > 0 && (
        <div className="bd-materials">
          <span className="bd-materials-lbl">📚 Din materialele site-ului:</span>
          {materials.map((m, i) => (
            <a key={i} href={m.url} data-internal="1" className="bd-link"
              onClick={(e) => { if (onInternalLink) { e.preventDefault(); onInternalLink(m.url); } }}>
              {m.kind === 'pdf' ? '📄' : m.kind === 'articol' ? '📝' : m.kind === 'manual' ? '📖' : '🧩'} {m.title}
            </a>
          ))}
        </div>
      )}

      {/* TABLA PĂSTREAZĂ TOT: etapele scrise până acum rămân deasupra */}
      {stages.slice(0, idx + 1).map((s, i) => (
        <div key={i} className={`bd-stage${i < idx ? ' is-past' : ''}`}>
          <div ref={active(i, -1) ? activeRef : null}>
            <BoardText key={`b${i}-${replay}`} text={s.board} {...blockProps(i, -1)} />
          </div>
          {afterText(i, -1, s)}
          {(extras[i] || []).map((b, k) => (
            <div key={`x${k}`} className="bd-again" ref={active(i, k) ? activeRef : null}>
              <div className="bd-again-lbl">🔁 Reluăm altfel{(extras[i] || []).length > 1 ? ` · încercarea ${k + 1}` : ''}</div>
              <BoardText key={`bx${i}-${k}-${replay}`} text={b.board} {...blockProps(i, k)} />
              {afterText(i, k, b)}
            </div>
          ))}
        </div>
      ))}

      {/* DISCUȚIA, pe tablă: „Ai înțeles?" cu variantele de răspuns */}
      {mode === 'ask' && (
        <div className="bd-q" ref={cardRef}>
          <ChoiceCard kicker={`🙋 ${TUDOR.name} întreabă`} question={askQ}
            note={`Etapa ${idx + 1} din ${stages.length} · ${stage.title}${attemptsUsed ? ` · reluată de ${attemptsUsed}×` : ''}`}
            options={[
              { label: last && activeExtra < 0 ? '✅ Da, am înțeles' : '✅ Da, continuă', primary: true, onPick: yes },
              { label: attemptsUsed >= 3 ? '💬 Tot nu — hai să vorbim' : attemptsUsed ? '🤔 Tot nu — explică altfel' : '🤔 Nu, mai explică o dată', onPick: no },
              { label: '✋ Am o întrebare', onPick: () => onChat?.(stage.title, null) },
            ]}
            onFree={(t) => onChat?.(stage.title, t)} freePlaceholder="Sau scrie-mi ce nu e clar…" />
        </div>
      )}
      {mode === 'loading' && (
        <div className="bd-q" ref={cardRef}>
          <div className="lv-poll is-private bd-wait"><span className="bd-thinking-dot" /> {TUDOR.name} caută altă cale de a-ți explica…</div>
        </div>
      )}
      {mode === 'chat' && (
        <div className="bd-q" ref={cardRef}>
          <ChoiceCard kicker="💬 Hai să o luăm împreună"
            options={[{ label: '✅ Continuăm lecția', primary: true, onPick: () => setMode('ask') }]}
            onFree={(t) => onChat?.(stage.title, t)} freePlaceholder="Scrie-mi exact ce nu îți iese…" />
        </div>
      )}
      {warn && <div className="bd-warn">⚠️ {warn}</div>}
      {faraCredite && (
        <div style={{ margin: '10px 0 4px' }}>
          <AICreditAlert />
          <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 8 }}>
            Etapele scrise până acum rămân pe tablă — le poți reciti oricând, iar lecția se reia de aici.
          </div>
        </div>
      )}
    </Whiteboard>
  );
}

export default Whiteboard;
