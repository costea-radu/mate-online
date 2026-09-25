// =====================================================================
// src/lib/tabla.js — CE SPUNE și CE SCRIE Prof. Tudor în „Planul meu"
//
// Textul profesorului (lecția, reexplicarea, răspunsul din conversație) vine
// de la model cu trei marcaje:
//   [[SPUNE: …]]                                   — doar VORBIT: subtitrare + voce, NU pe tablă
//   [[GRILA:{"q":"…","o":["…","…","…","…"],"a":"b","e":"…"}]]
//   [[COMPLETARE:{"q":"…","a":"…","e":"…"}]]      — întrebări puse DIRECT PE TABLĂ
// Tot restul e ce SCRIE pe tablă: matematică — formule, pași, explicații.
//
// Aici: despărțirea textului în bucăți (în ordine), curățarea pentru afișare,
// întrebările (citite sigur, chiar dacă modelul a stricat JSON-ul cu LaTeX) și
// PLANUL DE VORBIRE — propozițiile rostite, în ordine, fiecare cu cât din
// tablă acoperă (ca scrisul să meargă în ritmul vocii, ca la meditațiile live).
//
// Importurile au extensie („./voice.js") ca modulul să poată fi testat și
// direct în Node (test/tabla-prof-tudor.test.js).
// =====================================================================
import { sentencesOf } from './voice.js';
import { ansEq } from './ansEq.js';

const TAGS = ['SPUNE', 'GRILA', 'COMPLETARE'];
const MARK_RE = /\[\[\s*(SPUNE|GRILA|COMPLETARE)\s*:\s*([\s\S]*?)\s*\]\]/gi;

// ─── JSON-ul unei întrebări ─────────────────────────────────────────────────
// Modelele scriu des LaTeX cu UN SINGUR backslash în JSON („\frac"): pentru
// JSON, „\f" e caracterul form-feed, „\n" e rând nou, „\t" e tab — deci
// „\frac", „\neq", „\times" ar ieși stricate fără nicio eroare. Dublăm orice
// backslash care nu e o evadare JSON legitimă (o literă singură, \uXXXX, \" \\ \/).
export function fixJsonLatex(raw) {
  return String(raw || '').replace(/\\(\\|u[0-9a-fA-F]{4}|["/]|[bfnrt](?![a-zA-Z])|)/g, (m, g) => (g ? m : '\\\\'));
}

function parseJsonLoose(raw) {
  const base = String(raw || '').trim().replace(/,\s*([}\]])/g, '$1');
  const tries = [fixJsonLatex(base), base, fixJsonLatex(base) + '}', fixJsonLatex(base) + ']}', fixJsonLatex(base) + '"}'];
  for (const t of tries) {
    try { const o = JSON.parse(t); if (o && typeof o === 'object') return o; } catch { /* următoarea încercare */ }
  }
  return null;
}

const LETTERS = 'abcde';
const pick = (o, keys) => { for (const k of keys) if (o[k] != null && String(o[k]).trim() !== '') return o[k]; return null; };

// Întrebarea, în forma folosită de interfață:
//   { type: 'grila'|'completare', q, options?: [...], answer: 'b' | '4', explain }
// null dacă lipsește ceva esențial (enunțul, variantele, răspunsul corect).
export function parseQuestion(kind, raw) {
  const o = typeof raw === 'string' ? parseJsonLoose(raw) : raw;
  if (!o) return null;
  const type = String(kind || o.type || '').toLowerCase().startsWith('g') ? 'grila' : 'completare';
  const q = pick(o, ['q', 'question', 'intrebare', 'întrebare', 'enunt', 'enunț']);
  if (!q) return null;
  const explain = String(pick(o, ['e', 'explain', 'explicatie', 'explicație', 'rezolvare']) || '').trim();
  let answer = pick(o, ['a', 'answer', 'raspuns', 'răspuns', 'corect']);
  if (type === 'grila') {
    const options = (Array.isArray(o.o) ? o.o : Array.isArray(o.options) ? o.options : Array.isArray(o.variante) ? o.variante : [])
      .map((x) => String(x ?? '').trim()).filter(Boolean).slice(0, 5);
    if (options.length < 2 || answer == null) return null;
    let letter = null;
    const a = String(answer).trim();
    if (/^[a-e]\)?$/i.test(a)) letter = a[0].toLowerCase();
    if (!letter) {                                                     // textul variantei corecte
      const i = options.findIndex((x) => x === a || x.replace(/\$/g, '').trim() === a.replace(/\$/g, '').trim());
      if (i >= 0) letter = LETTERS[i];
    }
    if (!letter && /^\d$/.test(a)) {                                   // numărul variantei: 1..n (0 = prima)
      const n = Number(a);
      letter = LETTERS[n >= 1 && n <= options.length ? n - 1 : n] || null;
    }
    if (!letter || LETTERS.indexOf(letter) >= options.length) return null;
    return { type, q: String(q).trim(), options, answer: letter, explain };
  }
  if (answer == null) return null;
  return { type, q: String(q).trim(), answer: String(answer).trim(), explain };
}

// ─── Bucățile textului, în ordine ───────────────────────────────────────────
// segments: [{ kind: 'board' | 'say' | 'q', text?, q? }]
export function splitBoard(text) {
  const src = String(text || '');
  const segments = [];
  let last = 0; let m;
  MARK_RE.lastIndex = 0;
  while ((m = MARK_RE.exec(src)) !== null) {
    if (m.index > last) segments.push({ kind: 'board', text: src.slice(last, m.index) });
    const tag = m[1].toUpperCase();
    if (tag === 'SPUNE') { const t = m[2].trim(); if (t) segments.push({ kind: 'say', text: t }); }
    else { const q = parseQuestion(tag, m[2]); if (q) segments.push({ kind: 'q', q }); }
    last = m.index + m[0].length;
  }
  if (last < src.length) segments.push({ kind: 'board', text: src.slice(last) });
  const boardRaw = segments.filter((s) => s.kind === 'board').map((s) => s.text).join('');
  return {
    segments,
    board: tidy(stripPartial(boardRaw)),
    talk: segments.filter((s) => s.kind === 'say').map((s) => s.text),
    questions: segments.filter((s) => s.kind === 'q').map((s) => s.q),
  };
}

// rândurile goale lăsate de marcajele scoase
function tidy(t) {
  return String(t || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Un marcaj ÎNCEPUT dar neterminat (în timpul streamingului) nu se afișează:
// „[[GRI", „[[GRILA:{"q":"Cât…" — tăiem de la ultimul „[[" până la capăt.
export function stripPartial(text) {
  const t = String(text || '');
  const i = t.lastIndexOf('[[');
  if (i === -1) return t.endsWith('[') ? t.slice(0, -1) : t;
  if (t.indexOf(']]', i) !== -1) return t;
  const tail = t.slice(i + 2).replace(/^\s+/, '').toUpperCase();
  const head = (tail.match(/^[A-ZĂÂÎȘȚ]*/) || [''])[0];
  const ours = !head || TAGS.some((tag) => tag.startsWith(head) || head.startsWith(tag));
  return ours ? t.slice(0, i) : t;
}

// Textul de afișat pe tablă: fără ce se SPUNE și fără întrebări (acelea
// devin carduri interactive).
export function boardTextOf(text) {
  return splitBoard(text).board;
}

// Pentru documentul tipărit (PDF-ul lecției): ce se spune dispare, întrebările
// rămân ca „Verifică-te" (fără răspuns).
export function printTextOf(text) {
  const { segments } = splitBoard(text);
  return tidy(segments.map((s) => {
    if (s.kind === 'board') return s.text;
    if (s.kind === 'q') {
      const opts = s.q.options ? '\n' + s.q.options.map((o, i) => `${LETTERS[i]}) ${o}`).join('   ') : '';
      return `\n**✎ Verifică-te:** ${s.q.q}${opts}\n`;
    }
    return '';
  }).join(''));
}

// ─── Din matematică în vorbire (română) ─────────────────────────────────────
const GREEK = { alpha: 'alfa', beta: 'beta', gamma: 'gama', delta: 'delta', Delta: 'delta', theta: 'teta', lambda: 'lambda', mu: 'miu', sigma: 'sigma', omega: 'omega', varphi: 'fi', phi: 'fi', epsilon: 'epsilon', rho: 'ro' };
const WORDS = [
  [/\\(cdot|times)/g, ' ori '], [/\\div/g, ' împărțit la '], [/\\pm/g, ' plus sau minus '],
  [/\\(leq|le)\b/g, ' mai mic sau egal cu '], [/\\(geq|ge)\b/g, ' mai mare sau egal cu '], [/\\(neq|ne)\b/g, ' diferit de '],
  [/\\approx/g, ' aproximativ '], [/\\infty/g, ' infinit '], [/\\notin/g, ' nu aparține lui '], [/\\in\b/g, ' aparține lui '],
  [/\\(subseteq|subset)/g, ' inclus în '], [/\\cup/g, ' reunit cu '], [/\\cap/g, ' intersectat cu '], [/\\(emptyset|varnothing)/g, ' mulțimea vidă '],
  [/\\(Rightarrow|implies)/g, ', deci '], [/\\(Leftrightarrow|iff)/g, ', echivalent cu '],
  [/\\angle/g, ' unghiul '], [/\^\s*\{?\\circ\}?/g, ' grade '], [/\\circ/g, ' grade '], [/\\perp/g, ' perpendicular pe '], [/\\parallel/g, ' paralel cu '],
  [/\\triangle/g, ' triunghiul '], [/\\sin\b/g, ' sinus '], [/\\cos\b/g, ' cosinus '], [/\\(tan|tg)\b/g, ' tangentă '], [/\\(cot|ctg)\b/g, ' cotangentă '],
  [/\\ln\b/g, ' logaritm natural din '], [/\\log/g, ' logaritm '], [/\\lim/g, ' limita '], [/\\int/g, ' integrala '], [/\\sum/g, ' suma '],
  [/\\pi\b/g, ' pi '], [/\\mathbb\{([A-Z])\}/g, ' $1 '], [/\\(overline|widehat|hat)\{([^{}]*)\}/g, ' $2 '], [/\\vec\{([^{}]*)\}/g, ' vectorul $1 '],
  [/\\(text|mathrm|textbf|mathbf|operatorname)\{([^{}]*)\}/g, ' $2 '], [/\\(left|right|displaystyle|limits|,|;|!|quad|qquad)/g, ' '],
];
// Semnele scrise direct (Unicode), valabile și în proză
function symbolWords(t) {
  return t.replace(/√\s*/g, ' radical din ').replace(/²/g, ' la pătrat ').replace(/³/g, ' la cub ').replace(/°/g, ' grade ')
    .replace(/≤/g, ' mai mic sau egal cu ').replace(/≥/g, ' mai mare sau egal cu ').replace(/≠/g, ' diferit de ')
    .replace(/[·×]/g, ' ori ').replace(/[⇒→]/g, ', deci ').replace(/−/g, '-');
}

// O bucată de MATEMATICĂ (dintre $…$) → cuvinte. `strict` = e sigur
// matematică (orice „-" e minus, „:" e împărțire); altfel (LaTeX scăpat în
// proză) cratima rămâne cratimă — „într-un", „s-a" nu devin „minus".
function mathWords(src, strict = true) {
  let t = String(src || '');
  for (let k = 0; k < 3; k++) {
    t = t.replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, ' $1 supra $2 ')
      .replace(/\\sqrt\[(\d+)\]\{([^{}]*)\}/g, ' radical de ordinul $1 din $2 ')
      .replace(/\\sqrt\{([^{}]*)\}/g, ' radical din $1 ');
  }
  t = t.replace(/\\sqrt\s*(\w)/g, ' radical din $1 ');
  for (const [re, w] of WORDS) t = t.replace(re, w);
  t = t.replace(/\\([A-Za-z]+)/g, (m, g) => (GREEK[g] ? ` ${GREEK[g]} ` : ' '));
  t = t.replace(/\^\s*\{\s*2\s*\}|\^\s*2(?!\d)/g, ' la pătrat ').replace(/\^\s*\{\s*3\s*\}|\^\s*3(?!\d)/g, ' la cub ')
    .replace(/\^\{([^{}]*)\}/g, ' la puterea $1 ').replace(/\^\s*(-?\w+)/g, ' la puterea $1 ')
    .replace(/_\{([^{}]*)\}/g, ' $1 ').replace(/_(\w)/g, ' $1 ');
  t = symbolWords(t.replace(/[{}]/g, ' '));
  if (strict) {
    t = t.replace(/\|([^|]+)\|/g, ' modul de $1 ')
      .replace(/(\d),(\d)/g, '$1 virgulă $2')
      .replace(/-/g, ' minus ').replace(/\s:\s|(?<=\w):(?=\w)/g, ' împărțit la ').replace(/\//g, ' supra ');
  } else {
    t = t.replace(/(^|[\s(=,;])-(?=\s*[\w(])/g, '$1 minus ').replace(/\s-\s/g, ' minus ');
  }
  return t.replace(/</g, ' mai mic decât ').replace(/>/g, ' mai mare decât ').replace(/=/g, ' egal ').replace(/\+/g, ' plus ');
}

export function speakMath(s) {
  let t = String(s || '');
  // markdown: linkuri → titlul, bold/cod → text, semnele de titlu/listă/citat → nimic
  t = t.replace(/\[([^\]\n]+)\]\(([^)]*)\)/g, '$1').replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
    .replace(/^\s*#+\s*/gm, '').replace(/^\s*>\s?/gm, '').replace(/^\s*(?:[-•*]|\d+[.)])\s+/gm, '')
    .replace(/\|/g, ' ').replace(/\*+/g, ' ');
  // emoji și bife (vocea le-ar citi pe nume: „bifă", „semn de verificare")
  t = t.replace(/[\u2600-\u27BF\u{1F300}-\u{1FAFF}\uFE0F\u200D]/gu, ' ');
  // bucățile dintre $…$ sunt matematică; restul e proză
  t = t.replace(/\$\$([\s\S]+?)\$\$|\$([^$]+)\$/g, (m, a, b) => ` ${mathWords(a ?? b, true)} `).replace(/\$/g, ' ');
  // LaTeX scăpat fără $ (se mai întâmplă) + semnele din proză
  t = /\\[a-zA-Z]|[\^_]\{/.test(t) ? mathWords(t, false) : symbolWords(t)
    .replace(/\s=\s|(?<=\w)=(?=\w)/g, ' egal ').replace(/\s\+\s/g, ' plus ').replace(/\s-\s/g, ' minus ');
  return t.replace(/\s+([,.;:!?])/g, '$1').replace(/([,;])(?:\s*[,;])+/g, '$1').replace(/\s+/g, ' ').trim();
}

// Un rând de tablă → text de subtitrare (fără semnele de listă / titlu)
function lineCaption(line) {
  return String(line || '').trim()
    .replace(/^#{1,6}\s+/, '').replace(/^(?:[-•*])\s+/, '').replace(/^(\d+)[.)]\s+/, '$1. ')
    .replace(/\[([^\]\n]+)\]\((\/[^)\s]*)\)/g, '$1');
}

// ─── PLANUL DE VORBIRE ──────────────────────────────────────────────────────
// Fiecare propoziție: { caption (cu formule, pentru subtitrare), spoken (text
// de citit), board (e scrisă pe tablă?), boardStart/boardEnd (0..1 — cât din
// tablă e scris la începutul / sfârșitul ei) }.
//   opts.readBoard=false → se rostesc DOAR bucățile „SPUNE" (și întrebările,
//   dacă opts.questions) — ex. fără sunet, când elevul citește singur tabla.
export function speechPlan(text, { readBoard = true, questions = false } = {}) {
  const { segments } = splitBoard(text);
  const items = [];
  for (const s of segments) {
    if (s.kind === 'say') {
      for (const x of sentencesOf(s.text)) items.push({ caption: x.text, spoken: speakMath(x.text), board: false });
    } else if (s.kind === 'q') {
      if (questions) items.push(...questionPlan(s.q));
    } else if (readBoard) {
      for (const raw of stripPartial(s.text).split('\n')) {
        const line = lineCaption(raw);
        if (!line) continue;
        const heading = /^\s*#{1,6}\s+/.test(raw);
        const parts = heading ? [{ text: line }] : sentencesOf(line);
        for (const x of parts) {
          const spoken = speakMath(x.text) + (heading && !/[.!?:]$/.test(x.text) ? '.' : '');
          if (!spoken.replace(/[.,;:!?\s]/g, '')) continue;
          items.push({ caption: x.text, spoken, board: true, chars: Math.max(1, x.text.length) });
        }
      }
    }
  }
  const total = items.reduce((n, it) => n + (it.board ? it.chars : 0), 0);
  let cum = 0;
  for (const it of items) {
    it.boardStart = total ? cum / total : 0;
    if (it.board) cum += it.chars;
    it.boardEnd = total ? cum / total : 0;
  }
  return items.filter((it) => it.spoken);
}

// Planul simplu al unei replici vorbite (fără tablă): propoziție cu propoziție
export function talkPlan(text) {
  return sentencesOf(String(text || '').trim())
    .map((x) => ({ caption: x.text, spoken: speakMath(x.text), board: false }))
    .filter((it) => it.spoken);
}

// ─── Întrebările de pe tablă ────────────────────────────────────────────────
export function questionPlan(q) {
  if (!q) return [];
  const intro = q.type === 'grila' ? 'Hai să verificăm. Alege varianta corectă.' : 'Hai să verificăm. Scrie tu rezultatul.';
  return [...talkPlan(intro), ...talkPlan(q.q)];
}

// Răspunsul corect, pentru afișare („b) $x = 6$" / „$4$")
export function answerText(q) {
  if (!q) return '';
  if (q.type === 'grila') {
    const i = LETTERS.indexOf(q.answer);
    return `${q.answer}) ${q.options?.[i] ?? ''}`.trim();
  }
  const a = String(q.answer || '');
  return /\$/.test(a) ? a : /[\\^_{}=]|\d/.test(a) ? `$${a}$` : a;
}

const plain = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/\$/g, '').replace(/\s+/g, '').replace(/[.;]+$/, '');

// Răspunsul elevului e corect? (grilă: litera; completare: echivalență
// matematică — „1/2" = „0,5", „x=3" = „3", „2√3" = „2\sqrt{3}")
export function checkAnswer(q, given) {
  if (!q) return false;
  const g = String(given ?? '').trim();
  if (!g) return false;
  if (q.type === 'grila') return g[0].toLowerCase() === q.answer;
  try { if (ansEq(g, q.answer)) return true; } catch { /* comparăm ca text */ }
  return plain(g) === plain(q.answer);
}

// Ce spune profesorul după răspuns (subtitrare + voce)
export function verdictSpeech(q, correct) {
  const e = q?.explain ? ` ${q.explain}` : '';
  if (correct) return `Corect, bravo!${e}`;
  const ans = q?.type === 'grila' ? `varianta ${q.answer}` : String(q?.answer || '').replace(/\$/g, '');
  return `Nu chiar. Răspunsul corect este ${ans}.${e}`;
}
