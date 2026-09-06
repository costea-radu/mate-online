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
import { playAnswer, stopSpeaking, ttsSupported, ttsProblem, unlockSpeech } from '../lib/voice';
import AICreditAlert from './AICreditAlert';

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

// ─── UNDE scrie profesorul, chiar acum ──────────────────────────────────────
// Din bucata de cerneală care tocmai a apărut aflăm punctul de pe tablă la
// care e markerul: {x, y} ca fracții 0..1 din suprafața tablei. Pagina de
// meditații mută profesorul după acest punct — corpul se leagănă stânga-dreapta
// după coloana în care scrie, iar brațul urcă sau coboară după rând.
function inkPointAt(spans, i, root) {
  const node = spans[Math.min(Math.max(0, i), spans.length - 1)];
  const surface = root?.closest?.('.bd-surface') || root?.closest?.('.bd-body') || null;
  if (!node || !surface || !node.getBoundingClientRect) return null;
  const r = node.getBoundingClientRect();
  const s = surface.getBoundingClientRect();
  if (!s.width || !s.height) return null;
  if (!r.width && !r.height) return null;
  const cl = (v) => Math.min(1, Math.max(0, v));
  return {
    x: cl((r.left + r.width / 2 - s.left) / s.width),
    y: cl((r.top + r.height / 2 - s.top) / s.height),
  };
}
// câte bucăți sunt deja scrise, la `elapsed` ms de la începutul blocului
function inkIndexAt(delays, elapsed) {
  let lo = 0, hi = delays.length - 1, i = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (delays[mid] <= elapsed) { i = mid; lo = mid + 1; } else hi = mid - 1; }
  return i;
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
//   • cu FAȚA la elev (când întreabă „Ai înțeles?" sau când îți propune ceva)
// Întoarcerea e o rotație 3D reală a celor două fețe (backface-visibility).
//
// MIȘCAREA URMEAZĂ SCRISUL. Pagina îi dă poziția de pe tablă la care e
// markerul (`writePos` = {x, y}, fracții 0..1):
//   • corpul se leagănă STÂNGA-DREAPTA după coloana în care scrie (--pf-x)
//     și se apleacă ușor în direcția aceea (--pf-lean);
//   • brațul urcă sau coboară după rândul pe care scrie (--pf-arm).
// Fără poziție (ex. când răspunde în conversație) rămâne un legănat lent.
//
// Desenul: pulover cu guler, mâneci și manșete elastice (nu linii groase), și
// MÂINI adevărate — palmă, degete strânse și degetul mare peste marker.
// ═════════════════════════════════════════════════════════════════════════════
const SKIN = '#f2d3b3'; const SKIN_D = '#dcb48c'; const SKIN_L = '#f8e3cd';
const HAIR = '#eef0f3'; const HAIR_D = '#b9bec6';
const CLOTH = '#22456f'; const CLOTH_D = '#1a3557'; const CLOTH_L = '#2f5a8c';
const LIP = '#b06a52'; const MOUTH_IN = '#7d3b32';

// ─── puloverul: umeri, trunchi, manșeta de jos (aceeași croială din ambele părți)
// Trunchiul e mai îngust decât silueta totală, ca brațele să se vadă pe lângă el.
function Sweater() {
  return (
    <g>
      {/* trunchiul, cu umeri rotunjiți */}
      <path d="M110 176 C142 176 159 196 162 228 L165 270 L55 270 L58 228 C61 196 78 176 110 176 Z" fill={CLOTH} />
      {/* lumina pe umărul din dreapta imaginii */}
      <path d="M110 176 C142 176 159 196 162 228 L163 250 L140 250 L138 228 C136 202 126 186 110 180 Z" fill={CLOTH_L} opacity=".5" />
      {/* umbra pe partea opusă — puloverul capătă volum */}
      <path d="M110 176 C78 176 61 196 58 228 L57 250 L80 250 L82 228 C84 202 94 186 110 180 Z" fill={CLOTH_D} opacity=".45" />
      {/* cutele de sub braț */}
      <g stroke={CLOTH_D} strokeWidth="1.5" fill="none" opacity=".4" strokeLinecap="round">
        <path d="M72 214 q9 8 10 22" /><path d="M148 214 q-9 8 -10 22" />
      </g>
      {/* manșeta elastică de jos (tricotată) */}
      <path d="M56 250 L164 250 L165 270 L55 270 Z" fill={CLOTH_D} />
      <g stroke={CLOTH_L} strokeWidth="1.5" opacity=".45">
        {[64, 74, 84, 94, 104, 114, 124, 134, 144, 154].map((x) => <line key={x} x1={x} y1="251" x2={x} y2="270" />)}
      </g>
    </g>
  );
}

// ─── mâna care ține markerul (palmă + patru degete strânse + degetul mare)
// Desenată în jurul punctului (0,0) și așezată de apelant cu un `transform`.
function HandWithMarker() {
  return (
    <g>
      {/* markerul, ținut în pumn */}
      <g transform="rotate(-32)">
        <rect x="-6" y="-5.5" width="30" height="11" rx="4" fill="#2f3640" />
        <rect x="-6" y="-5.5" width="30" height="4" rx="2" fill="#4a515c" opacity=".65" />
        <rect x="22" y="-3.6" width="11" height="7.2" rx="2.2" fill="#8e44ad" />
        <path d="M33 -3.4 L38.5 0 L33 3.4 Z" fill="#7d3c99" />
      </g>
      {/* palma */}
      <path d="M-12 -8 q10 -7 19 -2 q8 4 7 12 q-1 8 -9 11 q-11 4 -18 -3 q-6 -6 -5 -11 q1 -5 6 -7 Z"
        fill={SKIN} stroke={SKIN_D} strokeWidth="1.2" strokeLinejoin="round" />
      {/* degetele strânse peste marker */}
      <g fill={SKIN} stroke={SKIN_D} strokeWidth="1">
        <rect x="-3" y="-9.6" width="13" height="6.4" rx="3.2" />
        <rect x="-4" y="-3.2" width="15" height="6.5" rx="3.2" />
        <rect x="-4" y="3.2" width="14" height="6.3" rx="3.1" />
        <rect x="-3" y="9.2" width="12" height="5.8" rx="2.9" />
      </g>
      {/* degetul mare, peste degete */}
      <path d="M-3 -8.5 q10 -3 14 3 q3 5 -2.5 7.5 q-6.5 2 -12 -3.5 Z" fill={SKIN_L} stroke={SKIN_D} strokeWidth="1.2" strokeLinejoin="round" />
    </g>
  );
}

// ─── mâna liberă, lăsată în jos (pumn relaxat, cu degete) ───────────────────
function HandRest({ flip = false }) {
  return (
    <g transform={flip ? 'scale(-1,1)' : undefined}>
      <path d="M-9 -8 q9 -5 16 0 q6 4 5 11 q-1 7 -8 9 q-10 3 -15 -4 q-4 -6 -3 -10 q1 -4 5 -6 Z"
        fill={SKIN} stroke={SKIN_D} strokeWidth="1.2" strokeLinejoin="round" />
      <g fill="none" stroke={SKIN_D} strokeWidth="1.1" strokeLinecap="round" opacity=".75">
        <path d="M-6 -2 q7 -2 12 1" /><path d="M-6 3 q7 -2 12 1" /><path d="M-5 8 q6 -2 10 1" />
      </g>
      {/* degetul mare */}
      <path d="M-9 -5 q-5 3 -4 8 q1 4 5 3" fill={SKIN_L} stroke={SKIN_D} strokeWidth="1.2" strokeLinejoin="round" />
    </g>
  );
}

// ─── mâneca unui braț lăsat în jos, cu manșetă ─────────────────────────────
function SleeveDown({ right = false }) {
  const g = right ? 'translate(220 0) scale(-1 1)' : undefined;
  return (
    <g transform={g}>
      <path d="M76 182 C58 190 47 210 43 236 L61 241 C65 219 72 202 86 194 Z" fill={CLOTH} />
      <path d="M76 182 C64 187 55 198 49 213 L58 217 C64 204 72 195 84 190 Z" fill={CLOTH_L} opacity=".4" />
      {/* manșeta */}
      <path d="M42 234 L62 239 L59 252 L39 247 Z" fill={CLOTH_D} />
      <g stroke={CLOTH_L} strokeWidth="1.2" opacity=".5">
        <line x1="45" y1="236" x2="42" y2="248" /><line x1="51" y1="238" x2="48" y2="250" /><line x1="57" y1="239" x2="54" y2="251" />
      </g>
    </g>
  );
}

// ─── părul alb, dezordonat ─────────────────────────────────────────────────
// Din SPATE e un inel de bucle în jurul creștetului, ca pata rărită din mijloc
// să se vadă natural (nu ca un petic lipit deasupra).
function HairBack() {
  const curls = [
    [70, 86, 15], [89, 70, 14], [110, 64, 13], [131, 70, 14], [150, 86, 15],
    [59, 108, 14], [161, 108, 14], [63, 130, 13], [157, 130, 13],
    [78, 146, 13], [110, 150, 13], [142, 146, 13],
  ];
  return (
    <g>
      {/* masa de păr acoperă TOT capul și coboară pe ceafă */}
      <path d="M64 100 C60 66 90 55 110 60 C130 55 160 66 156 100 C163 124 160 154 136 155 L84 155 C60 154 57 124 64 100 Z"
        fill={HAIR} stroke={HAIR_D} strokeWidth="1.2" />
      {/* creștetul rărit — pielea se vede prin mijloc, nu ca un petic lipit */}
      <ellipse cx="110" cy="92" rx="27" ry="19" fill={SKIN} stroke={SKIN_D} strokeWidth=".8" />
      <ellipse cx="110" cy="88" rx="16" ry="10" fill={SKIN_L} opacity=".5" />
      {/* buclele de pe contur, care rup silueta */}
      <g fill={HAIR} stroke={HAIR_D} strokeWidth="1.2">
        {curls.map(([cx, cy, r]) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={r} />)}
      </g>
    </g>
  );
}

function HairFront() {
  return (
    <g fill={HAIR} stroke={HAIR_D} strokeWidth="1.2">
      <path d="M66 116 C48 116 50 88 68 88 C56 62 92 50 100 68 C110 48 150 54 148 76 C172 70 180 106 160 114 C180 124 168 152 150 146 L72 146 C54 152 48 122 66 116 Z" />
      <circle cx="62" cy="96" r="14" /><circle cx="54" cy="118" r="12" />
      <circle cx="160" cy="94" r="14" /><circle cx="168" cy="118" r="12" />
      <circle cx="84" cy="68" r="12" /><circle cx="140" cy="66" r="12" />
      <circle cx="58" cy="138" r="11" /><circle cx="164" cy="138" r="11" />
    </g>
  );
}

function ProfBack() {
  return (
    <svg viewBox="0 0 220 270" className="pf-svg" aria-hidden="true" focusable="false">
      {/* ceafa */}
      <path d="M92 140 h36 v34 h-36 z" fill={SKIN} />
      <path d="M92 140 h36 v10 q-18 7 -36 0 z" fill={SKIN_D} opacity=".3" />
      {/* capul, din spate */}
      <ellipse cx="110" cy="112" rx="41" ry="44" fill={SKIN} stroke={SKIN_D} strokeWidth="1" />
      {/* urechile, văzute din spate */}
      <ellipse cx="70" cy="116" rx="7" ry="10.5" fill={SKIN} stroke={SKIN_D} strokeWidth="1" />
      <ellipse cx="150" cy="116" rx="7" ry="10.5" fill={SKIN} stroke={SKIN_D} strokeWidth="1" />
      <HairBack />

      <Sweater />
      {/* gulerul, văzut din spate */}
      <path d="M88 174 Q110 190 132 174 L133 166 Q110 180 87 166 Z" fill={CLOTH_D} />
      <path d="M90 173 Q110 187 130 173" fill="none" stroke={CLOTH_L} strokeWidth="1.6" opacity=".6" />

      {/* brațul liber, pe lângă corp (peste pulover, ca să se vadă mâna) */}
      <g>
        <SleeveDown right />
        <g transform="translate(171 254)"><HandRest flip /></g>
      </g>
      {/* BRAȚUL CARE SCRIE — mânecă + manșetă + mână cu marker.
          .pf-arm-aim = unghiul dat de rândul pe care scrie (variabilă CSS),
          .pf-arm     = legănatul propriu-zis al scrisului. */}
      <g className="pf-arm-aim">
        <g className="pf-arm">
          <path d="M80 194 C68 176 54 150 42 122 L62 110 C74 136 88 164 98 182 Z" fill={CLOTH} />
          <path d="M80 194 C68 176 54 150 42 122 L50 117 C62 145 76 170 88 188 Z" fill={CLOTH_D} opacity=".4" />
          {/* manșeta elastică */}
          <path d="M39 128 L64 113 L58 103 L33 118 Z" fill={CLOTH_D} />
          <g stroke={CLOTH_L} strokeWidth="1.2" opacity=".5">
            <line x1="38" y1="124" x2="60" y2="110" /><line x1="41" y1="128" x2="63" y2="115" />
          </g>
          {/* antebrațul descoperit + mâna cu markerul */}
          <path d="M35 117 L48 109 L39 95 L27 103 Z" fill={SKIN} stroke={SKIN_D} strokeWidth="1" />
          <g transform="translate(30 94)"><HandWithMarker /></g>
        </g>
      </g>
    </svg>
  );
}

function ProfFront() {
  return (
    <svg viewBox="0 0 220 270" className="pf-svg" aria-hidden="true" focusable="false">
      {/* gâtul */}
      <path d="M93 140 h34 v38 h-34 z" fill={SKIN} />
      <path d="M93 150 q17 13 34 0 v-10 h-34 z" fill={SKIN_D} opacity=".35" />
      <HairFront />
      {/* urechile */}
      <ellipse cx="70" cy="112" rx="7.5" ry="11" fill={SKIN} stroke={SKIN_D} strokeWidth="1" />
      <ellipse cx="150" cy="112" rx="7.5" ry="11" fill={SKIN} stroke={SKIN_D} strokeWidth="1" />
      {/* fața */}
      <ellipse cx="110" cy="106" rx="38" ry="48" fill={SKIN} stroke={SKIN_D} strokeWidth="1" />
      {/* fruntea brăzdată, obrajii */}
      <path d="M90 80 Q110 73 130 80" fill="none" stroke={SKIN_D} strokeWidth="1.3" opacity=".5" />
      <ellipse cx="82" cy="122" rx="9" ry="6" fill="#e8a08a" opacity=".28" />
      <ellipse cx="138" cy="122" rx="9" ry="6" fill="#e8a08a" opacity=".28" />
      {/* sprâncene stufoase */}
      <path d="M84 96 Q95 87 106 95" fill="none" stroke="#a9aeb7" strokeWidth="6.5" strokeLinecap="round" />
      <path d="M114 95 Q125 87 136 96" fill="none" stroke="#a9aeb7" strokeWidth="6.5" strokeLinecap="round" />
      {/* ochii (clipesc) */}
      <g className="pf-eyes">
        <ellipse cx="96" cy="108" rx="6" ry="6.4" fill="#fff" stroke={SKIN_D} strokeWidth=".9" />
        <ellipse cx="124" cy="108" rx="6" ry="6.4" fill="#fff" stroke={SKIN_D} strokeWidth=".9" />
        <circle cx="97" cy="109" r="3" fill="#33383f" />
        <circle cx="125" cy="109" r="3" fill="#33383f" />
        <circle cx="95.6" cy="107" r="1.1" fill="#fff" />
        <circle cx="123.6" cy="107" r="1.1" fill="#fff" />
      </g>
      {/* nasul */}
      <path d="M110 110 L105 126 Q110 131 116 127" fill="none" stroke="#c79a70" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      {/* GURA — buze clare, dinți, interior; se mișcă atunci când vorbește */}
      <g className="pf-mouth">
        <path d="M96 146 Q110 142 124 146 Q122 159 110 160 Q98 159 96 146 Z" fill={MOUTH_IN} />
        <path d="M98 147 Q110 143.5 122 147 L121 151 Q110 148 99 151 Z" fill="#fdfdfd" />
        <path d="M103 155 Q110 152.5 117 155 Q115 159.5 110 160 Q105 159.5 103 155 Z" fill="#c76a6a" opacity=".85" />
        <path d="M96 146 Q110 164 124 146" fill="none" stroke={LIP} strokeWidth="2.4" strokeLinecap="round" />
        <path d="M94.5 145 q3 -3 5 -1" fill="none" stroke={LIP} strokeWidth="1.9" strokeLinecap="round" />
        <path d="M125.5 145 q-3 -3 -5 -1" fill="none" stroke={LIP} strokeWidth="1.9" strokeLinecap="round" />
      </g>
      {/* mustața stufoasă, PESTE buza de sus */}
      <path d="M82 135 Q96 128 110 137 Q124 128 138 135 Q134 150 110 144 Q86 150 82 135 Z"
        fill="#e4e7ea" stroke="#a9aeb7" strokeWidth="1.6" strokeLinejoin="round" />
      <g stroke="#c9ced5" strokeWidth="1" opacity=".8" fill="none">
        <path d="M93 135 q6 5 14 5" /><path d="M127 135 q-6 5 -14 5" />
      </g>
      {/* bărbia */}
      <path d="M101 162 q9 5 18 0" fill="none" stroke={SKIN_D} strokeWidth="1.2" opacity=".45" />

      <Sweater />
      {/* gulerul rotund, din față */}
      <path d="M85 174 Q110 198 135 174 L140 182 Q110 212 80 182 Z" fill={CLOTH_D} />
      <path d="M88 177 Q110 198 132 177" fill="none" stroke={CLOTH_L} strokeWidth="1.8" opacity=".65" />

      {/* brațele lăsate pe lângă corp (markerul rămâne la tablă) */}
      <g className="pf-arm-down">
        <SleeveDown />
        <g transform="translate(49 256)"><HandRest /></g>
      </g>
      <g>
        <SleeveDown right />
        <g transform="translate(171 254)"><HandRest flip /></g>
      </g>
    </svg>
  );
}

// „state": 'writing' (spate) | 'asking' (față) | 'idle' (spate, nemișcat)
// writePos = { x, y } (0..1) — unde e markerul pe tablă; opțional.
export function Professor({ state = 'idle', name = 'prof. Virtual', writePos = null }) {
  const writing = state === 'writing';
  // Corpul urmează coloana în care scrie: stânga tablei → se mută spre stânga
  // și se apleacă într-acolo. Brațul urmează rândul: sus → ridicat, jos → coborât.
  const pos = writing && writePos ? writePos : null;
  const style = pos
    ? {
        '--pf-x': (-30 * (1 - pos.x) + 2 * pos.x).toFixed(1),
        '--pf-lean': (-3.2 * (1 - pos.x) + 1.6 * pos.x).toFixed(2),
        '--pf-arm': (-15 + 34 * pos.y).toFixed(1),
      }
    : undefined;
  return (
    <div className={`med-prof is-${state}${writing && !pos ? ' is-sway' : ''}`} style={style} aria-hidden="true">
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
  onDone = null, onSkip = null, onInternalLink = null, onWritePos = null, replayKey = 0 }) {
  const ref = useRef(null);
  const doneRef = useRef(onDone);
  const skipRef = useRef(onSkip);
  const timerRef = useRef(null);
  const inkRef = useRef(null);           // { spans, shown, target, timer } — modul „voce"
  const posRef = useRef(null);           // { spans, delays, t0, st } — de unde citim poziția markerului
  const posTimerRef = useRef(null);
  const wposRef = useRef(onWritePos);
  const [writing, setWriting] = useState(false);
  const voiceOn = voiceFrac !== null && voiceFrac !== undefined;
  useEffect(() => { doneRef.current = onDone; skipRef.current = onSkip; }, [onDone, onSkip]);
  useEffect(() => { wposRef.current = onWritePos; }, [onWritePos]);

  // urmărirea markerului: la fiecare ~130ms spunem paginii unde s-a ajuns cu
  // scrisul, ca profesorul să se miște după zona în care scrie pe tablă
  const stopPosWatch = useCallback(() => {
    if (posTimerRef.current) { clearInterval(posTimerRef.current); posTimerRef.current = null; }
  }, []);
  const startPosWatch = useCallback(() => {
    stopPosWatch();
    if (!wposRef.current) return;
    posTimerRef.current = setInterval(() => {
      const P = posRef.current; const cb = wposRef.current;
      if (!P || !cb || !ref.current) return;
      const i = P.st
        ? P.st.shown - 1
        : inkIndexAt(P.delays, (typeof performance !== 'undefined' ? performance.now() : Date.now()) - P.t0);
      if (i < 0) return;
      const pt = inkPointAt(P.spans, i, ref.current);
      if (pt) cb(pt);
    }, 130);
  }, [stopPosWatch]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let dead = false;
    clearTimeout(timerRef.current);
    stopReveal(inkRef.current);
    stopPosWatch();
    inkRef.current = null;
    posRef.current = null;
    el.classList.remove('bd-ink-done');
    el.innerHTML = boardHtml(text);
    let cps = SPEEDS[speed] !== undefined ? SPEEDS[speed] : 55;
    // sistemul cere „mișcare redusă" → textul apare dintr-odată (și întrebarea la fel)
    try { if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) cps = 0; } catch { /* ignore */ }
    const finish = () => { stopPosWatch(); setWriting(false); doneRef.current?.(); };
    const start = () => {
      if (dead || !ref.current) return;
      // scrisul condus de VOCE: literele apar pe măsură ce profesorul le rostește
      if (animate && voiceOn) {
        const { spans } = inkify(ref.current, 0, true);
        if (!spans.length) { ref.current.classList.add('bd-ink-done'); finish(); return; }
        inkRef.current = { spans, shown: 0, target: 0, timer: null, onReach: () => { if (!dead) finish(); } };
        posRef.current = { spans, delays: null, t0: 0, st: inkRef.current };
        setWriting(true);
        startPosWatch();
        return;
      }
      if (!animate || !cps) { ref.current.classList.add('bd-ink-done'); finish(); return; }
      const { total, spans, delays } = inkify(ref.current, cps, false);
      if (!total) { ref.current.classList.add('bd-ink-done'); finish(); return; }
      posRef.current = { spans, delays, t0: (typeof performance !== 'undefined' ? performance.now() : Date.now()), st: null };
      setWriting(true);
      startPosWatch();
      timerRef.current = setTimeout(() => { if (!dead) finish(); }, total + 150);
    };
    ensureKatex().then(() => {
      if (dead || !ref.current) return;
      renderMath(ref.current);
      start();
    });
    return () => { dead = true; clearTimeout(timerRef.current); stopReveal(inkRef.current); stopPosWatch(); };
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
    stopPosWatch();
    if (inkRef.current) revealAll(inkRef.current);
    ref.current?.classList.add('bd-ink-done');
    setWriting(false);
    if (skipRef.current) skipRef.current();
    else doneRef.current?.();
  }, [stopPosWatch]);

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
  profName = 'prof. Virtual', ask = null, tray = null, tall = false, tone = 'board', bodyClass = '',
  writePos = null, children }) {
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
          {/* când profesorul chiar scrie (răspunsul curge pe tablă) rămâne cu
            spatele și mișcă markerul, chiar dacă are o propunere pe ecran */}
        <Professor state={prof === 'writing' ? 'writing' : (ask ? 'asking' : prof)} name={profName} writePos={writePos} />
        </div>

        {/* Ce SPUNE profesorul (întrebarea, propunerea) apare lipit de el, ca o
            casetă de dialog cu coada spre umărul lui — nu într-un colț al tablei. */}
        {ask && (
          <div className="bd-ask" role="group" aria-label="Ce spune profesorul">
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

      {tray && (
        <div className="bd-tray">
          <div className="bd-tray-actions">{tray}</div>
        </div>
      )}
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
  const [voiceWarn, setVoiceWarn] = useState(null);   // „nu se aude" — spus pe față
  const [faraCredite, setFaraCredite] = useState(false); // lecția s-a oprit: credite AI epuizate
  // unde e markerul pe tablă (0..1) — profesorul se mișcă după el
  const [wpos, setWpos] = useState(null);
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
    setInstantBlock(null); setWarn(null); setWpos(null); setReplay((r) => r + 1);
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

  // Pornește citirea blocului curent. Întoarce `true` dacă a pornit un player.
  // Dacă nu se poate (fără voci în sistem), textul se arată INTEGRAL — altfel
  // ar rămâne ascuns, așteptând o voce care nu vine.
  const startVoice = useCallback(() => {
    stopVoice();
    setVoiceWarn(null);
    if (!blockText || !ttsSupported()) { setVFrac(1); return false; }
    setVFrac(0);
    const ctl = playAnswer(blockText, {
      onProgress: ({ frac }) => setVFrac(frac),
      onEnd: () => { ctlRef.current = null; setVFrac(1); setPaused(false); },
      onSilent: (msg) => { ctlRef.current = null; setVFrac(1); setPaused(false); setVoiceWarn(msg); },
    });
    if (!ctl) { setVFrac(1); return false; }
    ctlRef.current = ctl;
    return true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockText]);

  // ── VOCEA CONDUCE SCRISUL: fiecare bloc nou e citit, iar literele apar
  //    exact în ritmul în care profesorul le rostește.
  useEffect(() => {
    stopVoice();
    if (!blockText) return;
    if (!readRef.current || !ttsSupported()) return;
    startVoice();
    return () => { try { ctlRef.current?.stop?.(); } catch { /* ignore */ } };
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
    if (!voiceMode) return;
    let silent = 0;
    const t = setInterval(() => {
      if (pausedRef.current || !ctlRef.current) { silent = 0; return; }
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

  // „🔊 Citește" / „🔇": pornește sau oprește citirea cu voce tare.
  //
  // AICI ERA BUBA: repornirea blocului (deci și rostirea) se făcea DOAR dacă
  // etapa era încă în curs de scriere (`mode === 'write'`). Or, momentul firesc
  // în care apeși „Citește" e TOCMAI după ce textul e scris, când profesorul
  // întreabă „Ai înțeles?" — adică `mode === 'ask'`. Atunci nu se chema nimic:
  // butonul se făcea „❚❚ Pauză", dar nu pornea nicio voce, iar „Pauză" nu avea
  // ce opri. Acum citirea pornește în orice etapă.
  function setRead(v) {
    unlockSpeech();                     // sincron, din chiar apăsarea butonului
    saveRead(v); setReadAloud(v);
    if (!v) {
      stopVoice(); setVoiceWarn(null); setInstantBlock(blockKey);
      if (modeRef.current === 'write') setMode('ask');
      return;
    }
    setInstantBlock(null);
    if (modeRef.current === 'write') setReplay((r) => r + 1);  // rescrie în ritmul vocii
    else startVoice();                                          // deja scris → doar îl citește
  }
  function togglePause() {
    unlockSpeech();
    const c = ctlRef.current;
    // fără player (rostirea s-a terminat sau n-a pornit) butonul RELUA citirea,
    // în loc să nu facă nimic — asta se vedea ca „butonul Pauză e mort".
    if (!c) { setPaused(false); startVoice(); return; }
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
      // creditele AI s-au terminat → nu lăsăm lecția în aer cu un mesaj sec:
      // arătăm banda cu ce se întâmplă mai departe și butoanele către pachete
      if (err?.code === 'BUDGET_MONTH') { setFaraCredite(true); setWarn(null); }
      else setWarn(err?.message || 'Nu am reușit să reiau explicația acum. Mai încearcă o dată sau întreabă-mă în conversație.');
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
    // doar blocul care se scrie ACUM spune unde e markerul
    onWritePos: active(i, k) ? setWpos : null,
  });

  return (
    <Whiteboard
      tall
      title={<><span className="bd-title-ico">📖</span> {title}</>}
      subtitle={`Etapa ${idx + 1} din ${stages.length} · ${stage.title}`}
      chips={chips}
      prof={mode === 'write' ? 'writing' : 'idle'}
      writePos={mode === 'write' ? wpos : null}
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
      {faraCredite && (
        <div style={{ margin: '10px 0 4px' }}>
          <AICreditAlert />
          <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 8 }}>
            Etapele scrise până acum rămân pe tablă — le poți reciti oricând, iar lecția se reia de aici.
          </div>
        </div>
      )}
      {voiceWarn && (
        <div className="bd-warn">
          🔇 {voiceWarn} Textul rămâne scris pe tablă, îl poți citi în ritmul tău.
          {' '}<button type="button" className="bd-tool" style={{ marginLeft: 6 }}
            onClick={() => { setVoiceWarn(null); unlockSpeech(); startVoice(); }}>Încearcă din nou</button>
        </div>
      )}
    </Whiteboard>
  );
}

export default Whiteboard;
