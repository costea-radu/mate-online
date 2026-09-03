// =====================================================================
// src/components/Whiteboard.jsx — TABLA din „Meditații cu Profesorul Virtual"
//
// Tabla albă ocupă cea mai mare parte a ecranului, iar explicațiile NU mai
// apar dintr-odată: profesorul (desen ORIGINAL, în stilul icon-ului Einstein)
// stă cu SPATELE și le SCRIE, literă cu literă. La finalul fiecărei etape se
// ÎNTOARCE CU FAȚA și întreabă „Ai înțeles?", cu două răspunsuri:
//   ✅ „Da, continuă"           → trece la etapa următoare
//   🤔 „Nu, mai explică o dată" → cere explicația din nou, mai simplu
//
// Tabla PĂSTREAZĂ tot ce s-a scris: etapele parcurse rămân deasupra, mai
// palide, exact ca pe o tablă adevărată — se poate reveni la oricare.
//
// „Nu, mai explică o dată" NU mai trimite în conversație: profesorul cere
// serverului (lesson_simplify) o explicație nouă, cu alt unghi, și o SCRIE tot
// pe tablă, sub etapă. După 3 reluări trece discuția în conversație.
//
// VOCEA CONDUCE SCRISUL: cu „🔊 Citește" pornit, profesorul rostește textul, iar
// literele apar exact în ritmul vocii (progresul pe propoziții din playAnswer).
// Fără voce, scrisul e cronometrat în CSS — fiecare caracter primește propria
// întârziere, deci KaTeX randează o SINGURĂ DATĂ pe bloc: formulele nu clipesc.
// Preferințele (viteză, citire cu voce) se țin minte în localStorage.
// =====================================================================
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { preMessage } from './AITutor';
import { ensureKatex, renderMath } from '../lib/katex';
import { playAnswer, stopSpeaking, ttsSupported } from '../lib/voice';

// ─── viteza scrisului (caractere/secundă) — preferință locală ────────────────
export const SPEEDS = { lent: 26, normal: 55, rapid: 110, instant: 0 };
const SPEED_KEY = 'med_board_speed';
export function loadSpeed() {
  try { const v = localStorage.getItem(SPEED_KEY); return v && SPEEDS[v] !== undefined ? v : 'normal'; }
  catch { return 'normal'; }
}
export function saveSpeed(v) { try { localStorage.setItem(SPEED_KEY, v); } catch { /* ignore */ } }

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
  if (!root) return { total: 0, spans: [] };
  const items = [];
  collectInk(root, items);
  const totalChars = items.reduce((n, it) => n + (it.t === 'text' ? it.node.nodeValue.length : 6), 0);
  // texte foarte lungi: dezvăluire pe CUVINTE (mii de <span>-uri ar încetini)
  const byWord = totalChars > 2400;
  const step = 1000 / (cps || 55);
  const spans = [];
  let t = 0;
  for (const it of items) {
    if (it.t === 'blob') {
      it.node.classList.add('bd-ink');
      if (manual) { it.node.style.opacity = '0'; it.node.style.animation = 'none'; spans.push(it.node); }
      else it.node.style.animationDelay = Math.round(t) + 'ms';
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
      if (manual) { el.style.opacity = '0'; el.style.animation = 'none'; spans.push(el); }
      else el.style.animationDelay = Math.round(t) + 'ms';
      frag.appendChild(el);
      t += /^\s+$/.test(piece) ? step * 0.45 : step * piece.length;
    }
    it.node.parentNode.replaceChild(frag, it.node);
  }
  return { total: t, spans };
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

// ═════════════════════════════════════════════════════════════════════════════
// PROFESORUL — desen original (caricatură), în continuarea icon-ului Einstein:
// păr alb dezordonat + mustață stufoasă. Două ipostaze:
//   • din SPATE, cu markerul pe tablă (scrie)
//   • cu FAȚA la elev (când întreabă „Ai înțeles?")
// Întoarcerea e o rotație 3D reală a celor două fețe (backface-visibility).
// ═════════════════════════════════════════════════════════════════════════════
const SKIN = '#f2d3b3'; const SKIN_D = '#dcb48c';
const HAIR = '#eef0f3'; const HAIR_D = '#b9bec6';
const CLOTH = '#22456f'; const CLOTH_D = '#1a3557';

function ProfBack() {
  return (
    <svg viewBox="0 0 220 270" className="pf-svg" aria-hidden="true" focusable="false">
      {/* brațul care scrie (se leagănă cât timp scrie) */}
      <g className="pf-arm">
        <path d="M70 168 L26 104" stroke={CLOTH} strokeWidth="26" strokeLinecap="round" fill="none" />
        <path d="M70 168 L26 104" stroke={CLOTH_D} strokeWidth="26" strokeLinecap="round" fill="none" opacity=".25" />
        <circle cx="24" cy="100" r="12" fill={SKIN} stroke={SKIN_D} strokeWidth="1" />
        {/* markerul */}
        <g transform="rotate(-38 18 92)">
          <rect x="2" y="84" width="30" height="11" rx="4" fill="#2f3640" />
          <rect x="30" y="86" width="9" height="7" rx="2" fill="#8e44ad" />
        </g>
      </g>
      {/* trunchi (pulover) */}
      <path d="M44 270 C44 196 68 172 110 172 C152 172 176 196 176 270 Z" fill={CLOTH} />
      <path d="M44 270 C44 232 52 208 68 192 L68 270 Z" fill={CLOTH_D} opacity=".45" />
      {/* gulerul, văzut din spate */}
      <path d="M86 176 Q110 192 134 176 L134 170 Q110 182 86 170 Z" fill={CLOTH_D} />
      {/* ceafă */}
      <path d="M96 148 h28 v22 h-28 z" fill={SKIN} />
      {/* capul, din spate */}
      <ellipse cx="110" cy="112" rx="42" ry="45" fill={SKIN} stroke={SKIN_D} strokeWidth="1" />
      {/* păr alb dezordonat, de jur împrejur */}
      <g fill={HAIR} stroke={HAIR_D} strokeWidth="1.2">
        <path d="M68 118 C52 118 54 92 70 92 C60 68 92 54 100 70 C110 52 148 58 146 78 C168 72 176 106 158 114 C176 124 166 150 148 144 L74 144 C56 150 52 122 68 118 Z" />
        <circle cx="64" cy="98" r="13" /><circle cx="56" cy="118" r="11" />
        <circle cx="158" cy="96" r="13" /><circle cx="166" cy="118" r="11" />
        <circle cx="84" cy="72" r="11" /><circle cx="140" cy="70" r="11" />
        <circle cx="110" cy="62" r="9" />
      </g>
      {/* creștetul rărit — pata de piele care se vede printre bucle */}
      <ellipse cx="110" cy="92" rx="20" ry="13" fill={SKIN} opacity=".55" />
    </svg>
  );
}

function ProfFront() {
  return (
    <svg viewBox="0 0 220 270" className="pf-svg" aria-hidden="true" focusable="false">
      {/* brațul lăsat în jos, cu markerul, când se întoarce spre elev */}
      <g className="pf-arm-down">
        <path d="M72 186 L36 230" stroke={CLOTH} strokeWidth="26" strokeLinecap="round" fill="none" />
        <circle cx="34" cy="232" r="12" fill={SKIN} stroke={SKIN_D} strokeWidth="1" />
        <rect x="18" y="238" width="28" height="10" rx="4" fill="#2f3640" transform="rotate(12 32 243)" />
      </g>
      {/* trunchi */}
      <path d="M44 270 C44 196 68 172 110 172 C152 172 176 196 176 270 Z" fill={CLOTH} />
      <path d="M86 176 Q110 196 134 176 L138 184 Q110 208 82 184 Z" fill={CLOTH_D} />
      {/* gât */}
      <path d="M96 146 h28 v26 h-28 z" fill={SKIN} />
      <path d="M96 158 q14 10 28 0 v-12 h-28 z" fill={SKIN_D} opacity=".35" />
      {/* păr alb (planul din spate) */}
      <g fill={HAIR} stroke={HAIR_D} strokeWidth="1.2">
        <path d="M66 116 C48 116 50 88 68 88 C56 62 92 50 100 68 C110 48 150 54 148 76 C172 70 180 106 160 114 C180 124 168 152 150 146 L72 146 C54 152 48 122 66 116 Z" />
        <circle cx="62" cy="96" r="14" /><circle cx="54" cy="118" r="12" />
        <circle cx="160" cy="94" r="14" /><circle cx="168" cy="118" r="12" />
        <circle cx="84" cy="68" r="12" /><circle cx="140" cy="66" r="12" />
      </g>
      {/* față */}
      <ellipse cx="110" cy="110" rx="36" ry="39" fill={SKIN} stroke={SKIN_D} strokeWidth="1" />
      <path d="M92 88 Q110 81 128 88" fill="none" stroke={SKIN_D} strokeWidth="1.4" opacity=".6" />
      {/* sprâncene stufoase */}
      <path d="M86 100 Q96 91 106 100" fill="none" stroke="#a9aeb7" strokeWidth="6.5" strokeLinecap="round" />
      <path d="M114 100 Q124 91 134 100" fill="none" stroke="#a9aeb7" strokeWidth="6.5" strokeLinecap="round" />
      {/* ochi (clipesc) */}
      <g className="pf-eyes">
        <ellipse cx="96" cy="110" rx="5.2" ry="5.6" fill="#fff" stroke={SKIN_D} strokeWidth=".8" />
        <ellipse cx="124" cy="110" rx="5.2" ry="5.6" fill="#fff" stroke={SKIN_D} strokeWidth=".8" />
        <circle cx="97" cy="111" r="2.7" fill="#33383f" />
        <circle cx="125" cy="111" r="2.7" fill="#33383f" />
      </g>
      {/* nas */}
      <path d="M110 111 L104 128 Q110 133 117 128" fill="none" stroke="#c79a70" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
      {/* mustață stufoasă */}
      <path d="M84 136 Q97 131 110 136 Q123 131 136 136 Q131 150 110 145 Q89 150 84 136 Z" fill="#e4e7ea" stroke="#a9aeb7" strokeWidth="1.6" />
      {/* gură — zâmbet cald */}
      <path d="M101 149 Q110 155 119 149" fill="none" stroke="#a86f48" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

// „state": 'writing' (spate) | 'asking' (față) | 'idle' (spate, nemișcat)
export function Professor({ state = 'idle', name = 'prof. Virtual' }) {
  return (
    <div className={`med-prof is-${state}`} aria-hidden="true">
      <div className="pf-flip">
        <div className="pf-face pf-back"><ProfBack /></div>
        <div className="pf-face pf-front"><ProfFront /></div>
      </div>
      <div className="pf-tag"><span className="pf-dot" /> {name}</div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// TEXTUL SCRIS PE TABLĂ
// ═════════════════════════════════════════════════════════════════════════════
export function BoardText({ text, speed = 'normal', animate = true, voiceFrac = null,
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
    if (!el) return;
    let dead = false;
    clearTimeout(timerRef.current);
    stopReveal(inkRef.current);
    inkRef.current = null;
    el.classList.remove('bd-ink-done');
    el.innerHTML = boardHtml(text);
    let cps = SPEEDS[speed] !== undefined ? SPEEDS[speed] : 55;
    // sistemul cere „mișcare redusă" → textul apare dintr-odată (și întrebarea la fel)
    try { if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) cps = 0; } catch { /* ignore */ }
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
      if (!animate || !cps) { ref.current.classList.add('bd-ink-done'); finish(); return; }
      const { total } = inkify(ref.current, cps, false);
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
  }, [text, speed, animate, voiceOn, replayKey]);

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
// RAMA TABLEI — tabla + profesorul + tăvița cu markere
// ask = { question, yes, no, onYes, onNo, note }
// ═════════════════════════════════════════════════════════════════════════════
export function Whiteboard({ title = null, subtitle = null, chips = null, toolbar = null, prof = 'idle',
  profName = 'prof. Virtual', ask = null, tray = null, tall = false, tone = 'board', children }) {
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
          <div className="bd-body">{children}</div>
          <Professor state={ask ? 'asking' : prof} name={profName} />
        </div>

        {ask && (
          <div className="bd-ask" role="group" aria-label="Verificare înțelegere">
            <div className="bd-bubble">
              <span className="bd-bubble-q">{ask.question || 'Ai înțeles?'}</span>
              {ask.note && <span className="bd-bubble-note">{ask.note}</span>}
            </div>
            {(ask.yes || ask.no) && (
              <div className="bd-ask-btns">
                {ask.yes && <button type="button" className="bd-btn bd-btn-yes" onClick={ask.onYes}>{ask.yes}</button>}
                {ask.no && <button type="button" className="bd-btn bd-btn-no" onClick={ask.onNo}>{ask.no}</button>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bd-tray">
        <div className="bd-markers" aria-hidden="true">
          <span className="bd-marker m-dark" /><span className="bd-marker m-blue" />
          <span className="bd-marker m-red" /><span className="bd-eraser" />
        </div>
        <div className="bd-tray-actions">{tray}</div>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// LECȚIA PE ETAPE — profesorul scrie o etapă, se întoarce, întreabă, continuă
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
    // etapele prea scurte se lipesc de precedenta (altfel „Ai înțeles?" devine sâcâitor)
    if (out.length && body.length < 60) { out[out.length - 1].body += `\n\n### ${title}\n${body}`; continue; }
    out.push({ title, body });
  }
  return out.filter((s) => s.body);
}

export function SpeedPicker({ value, onChange }) {
  return (
    <label className="bd-speed" title="Cât de repede scrie profesorul pe tablă">
      <span aria-hidden="true">✍️</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Viteza scrisului">
        <option value="lent">lent</option>
        <option value="normal">normal</option>
        <option value="rapid">rapid</option>
        <option value="instant">fără animație</option>
      </select>
    </label>
  );
}

const READ_KEY = 'med_board_read';
const loadRead = () => { try { return localStorage.getItem(READ_KEY) === '1'; } catch { return false; } };
const saveRead = (v) => { try { localStorage.setItem(READ_KEY, v ? '1' : '0'); } catch { /* ignore */ } };

export function BoardLesson({ chapterId = null, title, text, materials = [], onExplainAgain, onUnderstood,
  onFinish, onClose, onEnd, onPrint, onChat, onInternalLink,
  finishLabel = '✍️ Am înțeles — trecem la exerciții', busy = false }) {
  const stages = useMemo(() => splitStages(text), [text]);
  const [idx, setIdx] = useState(0);
  const [mode, setMode] = useState('write');     // write | ask | loading | chat
  const [replay, setReplay] = useState(0);
  const [extras, setExtras] = useState({});      // { [etapă]: [reexplicări scrise pe tablă] }
  const [activeExtra, setActiveExtra] = useState(-1);
  const [instantBlock, setInstantBlock] = useState(null);
  const [speed, setSpeed] = useState(loadSpeed);
  const [readAloud, setReadAloud] = useState(loadRead);
  const [vFrac, setVFrac] = useState(0);
  const [paused, setPaused] = useState(false);
  const [warn, setWarn] = useState(null);
  const ctlRef = useRef(null);
  const activeRef = useRef(null);
  const modeRef = useRef(mode);
  const readRef = useRef(readAloud);
  const pausedRef = useRef(false);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { readRef.current = readAloud; }, [readAloud]);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { saveSpeed(speed); }, [speed]);
  // lecție nouă → tabla se șterge și o luăm de la prima etapă
  useEffect(() => {
    setIdx(0); setMode('write'); setExtras({}); setActiveExtra(-1);
    setInstantBlock(null); setWarn(null); setReplay((r) => r + 1);
  }, [text]);
  useEffect(() => () => { try { ctlRef.current?.stop?.(); } catch { /* ignore */ } stopSpeaking(); }, []);

  const stage = stages[idx] || null;
  const last = idx === stages.length - 1;
  const blockKey = `${idx}:${activeExtra}:${replay}`;
  const instant = instantBlock === blockKey;
  const voiceMode = readAloud && ttsSupported() && !instant;
  const attemptsUsed = (extras[idx] || []).length;
  const stageSource = (i) => `## ${stages[i].title}\n${stages[i].body}`;
  const blockText = activeExtra === -1 ? (stage ? stageSource(idx) : '') : (extras[idx] || [])[activeExtra] || '';

  function stopVoice() {
    try { ctlRef.current?.stop?.(); } catch { /* ignore */ }
    ctlRef.current = null;
    setPaused(false);
  }

  // ── VOCEA CONDUCE SCRISUL: fiecare bloc nou e citit, iar literele apar
  //    exact în ritmul în care profesorul le rostește.
  useEffect(() => {
    stopVoice();
    if (!blockText) return;
    if (!readRef.current || !ttsSupported()) return;
    setVFrac(0);
    const ctl = playAnswer(blockText, {
      onProgress: ({ frac }) => setVFrac(frac),
      onEnd: () => { ctlRef.current = null; setVFrac(1); setPaused(false); },
    });
    if (!ctl) { setVFrac(1); return; }   // fără voce disponibilă → textul apare tot
    ctlRef.current = ctl;
    return () => { try { ctl.stop(); } catch { /* ignore */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockKey]);

  // tabla PĂSTREAZĂ tot ce s-a scris → aducem în dreptul ochilor blocul curent.
  // A doua încercare, după randarea formulelor (KaTeX vine asincron, iar
  // înălțimea blocului — deci și cât se poate derula — abia atunci e reală.
  useEffect(() => {
    const t1 = setTimeout(() => scrollBlockIntoView(activeRef.current), 150);
    const t2 = setTimeout(() => scrollBlockIntoView(activeRef.current), 700);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [blockKey]);

  // PLASĂ DE SIGURANȚĂ pentru voce: „speechSynthesis" există în orice browser,
  // dar pe sistemele fără voci instalate nu se aude nimic și nici nu vine
  // vreun eveniment. Dacă ~6 secunde nu se rostește nimic, renunțăm la voce și
  // scriem tot textul — lecția nu are voie să rămână blocată pe tablă.
  useEffect(() => {
    if (!voiceMode || mode !== 'write') return;
    let silent = 0;
    const t = setInterval(() => {
      if (modeRef.current !== 'write' || pausedRef.current) { silent = 0; return; }
      let talking = false;
      try { talking = !!(window.speechSynthesis?.speaking || window.speechSynthesis?.pending); } catch { talking = false; }
      if (talking) { silent = 0; return; }
      silent += 1;
      if (silent >= 3) { clearInterval(t); stopVoice(); setVFrac(1); }
    }, 2000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockKey, voiceMode, mode]);

  if (!stages.length) return null;

  function goStage(i) { stopVoice(); setIdx(i); setActiveExtra(-1); setMode('write'); setWarn(null); setReplay((r) => r + 1); }
  function blockDone() { if (modeRef.current === 'write') setMode('ask'); }
  function skipBlock() { stopVoice(); setInstantBlock(blockKey); if (modeRef.current === 'write') setMode('ask'); }

  function setRead(v) {
    saveRead(v); setReadAloud(v);
    if (!v) { stopVoice(); setInstantBlock(blockKey); if (modeRef.current === 'write') setMode('ask'); }
    else if (modeRef.current === 'write') { setInstantBlock(null); setReplay((r) => r + 1); }
  }
  function togglePause() {
    const c = ctlRef.current; if (!c) return;
    if (paused) { c.resume(); setPaused(false); } else { c.pause(); setPaused(true); }
  }

  function yes() {
    stopVoice();
    onUnderstood?.({ chapterId, stageTitle: stage.title, attempts: attemptsUsed });
    if (last) { onFinish?.(); return; }
    goStage(idx + 1);
  }
  // „Nu, mai explică o dată" — profesorul REIA etapa și o SCRIE tot pe tablă
  async function no() {
    const attempt = attemptsUsed + 1;
    if (attempt > 3) { onChat?.(stage.title); setMode('chat'); return; }
    stopVoice(); setWarn(null); setMode('loading');
    try {
      const t = await onExplainAgain?.({ chapterId, stageTitle: stage.title, stageText: stage.body, attempt });
      if (!t) throw new Error('Nu am primit explicația.');
      setExtras((e) => ({ ...e, [idx]: [...(e[idx] || []), t] }));
      setInstantBlock(null);
      setActiveExtra(attempt - 1);
      setMode('write');
    } catch (err) {
      setWarn(err?.message || 'Nu am reușit să reiau explicația acum. Mai încearcă o dată sau întreabă-mă în conversație.');
      setMode('ask');
    }
  }

  const ask = mode === 'ask'
    ? {
        question: activeExtra >= 0 ? 'Acum e mai clar?' : last ? 'Am terminat lecția. Ai înțeles tot?' : 'Ai înțeles?',
        note: `Etapa ${idx + 1} din ${stages.length} · ${stage.title}${attemptsUsed ? ` · reluată de ${attemptsUsed}×` : ''}`,
        yes: last && activeExtra < 0 ? '✅ Da, am înțeles' : '✅ Da, continuă',
        no: attemptsUsed >= 3 ? '💬 Tot nu — hai să vorbim' : attemptsUsed ? '🤔 Tot nu — explică altfel' : '🤔 Nu, mai explică o dată',
        onYes: yes, onNo: no,
      }
    : mode === 'loading'
      ? { question: 'Stai o clipă…', note: 'Caut o explicație mai simplă și ți-o scriu pe tablă.', yes: null, no: null }
      : mode === 'chat'
        ? { question: 'Hai să o luăm împreună, în scris.', note: 'Ți-am deschis conversația de sub tablă — scrie-mi acolo exact ce nu îți iese.',
            yes: '✅ Continuăm lecția', no: null, onYes: () => setMode('ask') }
        : null;

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
    speed, onInternalLink,
    animate: active(i, k) && !instant,
    voiceFrac: active(i, k) && voiceMode ? vFrac : null,
    onDone: active(i, k) ? blockDone : null,
    onSkip: active(i, k) ? skipBlock : null,
  });

  return (
    <Whiteboard
      tall
      title={<><span className="bd-title-ico">📖</span> {title}</>}
      subtitle={`Etapa ${idx + 1} din ${stages.length} · ${stage.title}`}
      chips={chips}
      prof={mode === 'write' ? 'writing' : 'idle'}
      ask={ask}
      toolbar={<>
        {!readAloud && <SpeedPicker value={speed} onChange={setSpeed} />}
        {ttsSupported() && (readAloud ? (
          <>
            <button type="button" className="bd-tool is-on" onClick={togglePause}
              title="Profesorul citește exact ce scrie">{paused ? '▶ Continuă' : '❚❚ Pauză'}</button>
            <button type="button" className="bd-tool" onClick={() => setRead(false)} title="Oprește citirea cu voce">🔇</button>
          </>
        ) : (
          <button type="button" className="bd-tool" onClick={() => setRead(true)}
            title="Profesorul citește cu voce tare, iar textul apare în ritmul vocii">🔊 Citește</button>
        ))}
        {onPrint && <button type="button" className="bd-tool" onClick={onPrint} title="Salvează lecția ca PDF">📄 PDF</button>}
        {onClose && <button type="button" className="bd-tool" onClick={() => { stopVoice(); onClose(); }}>✕ Închide</button>}
      </>}
      tray={<>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => { stopVoice(); onFinish?.(); }}>{finishLabel}</button>
        {onEnd && <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => { stopVoice(); onEnd(); }}>🏁 Încheie meditația și dă-mi tema</button>}
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
            <BoardText key={`b${i}-${replay}`} text={stageSource(i)} {...blockProps(i, -1)} />
          </div>
          {(extras[i] || []).map((t, k) => (
            <div key={`x${k}`} className="bd-again" ref={active(i, k) ? activeRef : null}>
              <div className="bd-again-lbl">🔁 Reluăm altfel{(extras[i] || []).length > 1 ? ` · încercarea ${k + 1}` : ''}</div>
              <BoardText key={`bx${i}-${k}-${replay}`} text={t} {...blockProps(i, k)} />
            </div>
          ))}
        </div>
      ))}

      {mode === 'loading' && <div className="bd-thinking"><span className="bd-thinking-dot" /> Profesorul caută altă cale de a-ți explica…</div>}
      {warn && <div className="bd-warn">⚠️ {warn}</div>}
    </Whiteboard>
  );
}

export default Whiteboard;
