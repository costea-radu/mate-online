// =====================================================================
// api/_lib/semn.js — RĂSPUNSURILE DESPRE SEMN la întrebările profesorului
//
// La „Care este semnul derivatei f'(x) = (x − 1)/x pentru x ∈ (0, 1)?" răspunsul
// din barem e o inegalitate cu 0 („f'(x) < 0") sau un cuvânt („negativ"). Elevul
// răspunde firesc cu semnul („−"), cu un cuvânt („minus", „negativă", „strict
// negativă", „mai mic decât 0", „derivata e negativă") sau cu inegalitatea
// („< 0", „f′(x) < 0"). Toate spun același lucru, deci sunt primite; la fel
// „+", „plus", „pozitiv(ă)", „> 0" pentru „f'(x) > 0". La „f'(x) ≥ 0" se
// primește și „+" / „pozitiv" (semnul din tabel), invers nu.
//
//   signOf(text, barem?) → { sign: 'neg' | 'pos' | 'nonpos' | 'nonneg', lhs } | null
//       lhs = despre ce e afirmația („f'(x)", „x-1") sau '' (doar semnul /
//       „derivata", „funcția", „semnul"…); null = textul nu e o afirmație
//       despre semn. barem = true → textul e răspunsul din barem (mai strict).
//   signEquivalent(dat, așteptat) → true | false | null
//       true  — același semn („−" = „f'(x) < 0");
//       false — semnul opus („+" la „f'(x) < 0");
//       null  — nu e o întrebare despre semn sau elevul vorbește despre altceva
//               („f(x) < 0" la „f'(x) < 0") → decide restul verificării.
// Prudent: „−2", „−∞", „0 < x < 1", „+ și −", „nu e negativ", „x − 1 < 0" (la
// „f'(x) < 0") și „f'(x) < 0 ⇒ f descrescătoare" (în barem) NU sunt primite ca semn.
//
// Folosit de: checkPollAnswer (api/_lib/live.js — meditațiile live și pregătirea
// de examen), corectarea exercițiilor din „Planul meu" (api/ai-meditatii.js) și,
// în browser, întrebările de pe tablă (src/lib/tabla.js → src/lib/semn.js).
// OGLINDA: src/lib/semn.js are ACELAȘI cod între marcajele „COD COMUN" —
// test/semn-raspunsuri.test.js verifică. Modifică aici, apoi copiază acolo.
// =====================================================================
'use strict';

// ── COD COMUN (identic în api/_lib/semn.js și src/lib/semn.js) ─────────────
// Textul simplu: fără $ și LaTeX de spațiere, fără diacritice, cu litere mici;
// „≤", „\leq", „=<" → „<="; „′", „’", „^{\prime}" → „'"; „Δ" → „delta"; „−", „–" → „-".
function semnText(raw) {
  const t = String(raw == null ? '' : raw)
    .replace(/\$+/g, ' ')
    .replace(/\\\(|\\\)|\\\[|\\\]/g, ' ')
    .replace(/\\(?:text|textrm|textbf|textit|mathrm|mathbf|operatorname|mbox)\s*\{([^{}]*)\}/g, ' $1 ')
    .replace(/\\(?:left|right|displaystyle|quad|qquad)(?![a-zA-Z])|\\[,;:! ]/g, ' ')
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&nbsp;/gi, ' ')
    .replace(/<=>|\\(?:Longrightarrow|Rightarrow|implies|Longleftrightarrow|Leftrightarrow|iff|rightarrow|to)(?![a-zA-Z])|[⇒⟹⇔⟺→⟶]|=>|->/g, ' ⇒ ')
    .replace(/\\(?:neq|ne)(?![a-zA-Z])|!=|<>|[≠≮≯≰≱]/g, ' nu ')          // „≠ 0", „≮ 0": nu e un semn
    .replace(/\\(?:leqslant|leq|le)(?![a-zA-Z])|[≤⩽]|=</g, '<=')
    .replace(/\\(?:geqslant|geq|ge)(?![a-zA-Z])|[≥⩾]/g, '>=')
    .replace(/\\lt(?![a-zA-Z])/g, '<').replace(/\\gt(?![a-zA-Z])/g, '>')
    .replace(/\\forall(?![a-zA-Z])/g, ' ∀ ').replace(/\\in(?![a-zA-Z])/g, ' ∈ ')
    .replace(/\^\s*\{\s*(?:\\prime\s*){2}\}|\^\s*\{\s*''\s*\}/g, "''")
    .replace(/\^\s*\{\s*\\prime\s*\}|\^\s*\\prime(?![a-zA-Z])|\\prime(?![a-zA-Z])|\^\s*\{\s*'\s*\}/g, "'")
    .replace(/″/g, "''").replace(/[′’‘`´ʹ]/g, "'")
    .replace(/\\(?:Delta|triangle)(?![a-zA-Z])|[Δ∆]/g, ' delta ')
    .replace(/[−–—‒﹣－]/g, '-').replace(/＋/g, '+')
    .replace(/[„”“"«»]/g, ' ');
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

// paranteze care închid TOT textul („(−)", „(negativ)")
function semnWraps(s) {
  if (s.length < 2 || '([{'.indexOf(s[0]) < 0 || ')]}'.indexOf(s[s.length - 1]) < 0) return false;
  let d = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('([{'.indexOf(c) >= 0) d++;
    else if (')]}'.indexOf(c) >= 0) { d--; if (d === 0 && i < s.length - 1) return false; }
  }
  return d === 0;
}
function semnTrim(t) {
  let s = String(t || '').replace(/[\s.,;:!?]+$/, '').replace(/^[\s.,;:]+/, '').trim();
  for (let i = 0; i < 4 && semnWraps(s); i++) s = s.slice(1, -1).trim();
  return s;
}

// intervalul / condiția nu schimbă semnul (e deja în întrebare): „pe (0, 1)",
// „pe intervalul [1, 3]", „pentru (orice) x ∈ (0, 1)", „∀ x ∈ (0, 1)", „x din (0, 1)"
const SEMN_DOMAIN_IN = /(?:^|[\s,;])(?:(?:pe|pentru|pt\.?|oricare\s+ar\s+fi|oricare)\s*(?:(?:tot\s+)?intervalul\s*|orice\s*)?(?:[a-z]\s*∈\s*|[a-z]\s+(?:din|in)\s+)?|∀\s*(?:[a-z]\s*∈\s*)?|[a-z]\s*∈\s*|[a-z]\s+(?:din|in)\s+)[[\]()][^[\]()]*[[\]()]/g;
// … și fără paranteze, la final: „… pe R", „… pentru x > 1", „…, ∀ x > 0", „… când x < 1"
const SEMN_DOMAIN_END = /[\s,;]\s*(?:(?:pe|pentru|pt\.?|oricare|cand|daca|forall)(?![a-z0-9])|∀)|∀/;
// o concluzie sau o justificare: „… ⇒ f descrescătoare", „…, deci …", „… deoarece …"
const SEMN_WHY = /\s*⇒|(?:^|[\s,;])\s*(?:deci|deoarece|fiindca|intrucat|caci|implica)(?![a-z0-9])/;
const SEMN_NOT = /(?:^|[^a-z0-9])(?:nu|nici|niciodata)(?![a-z0-9])/;

const SEMN_ZERO = /^\(?\s*(?:0|zero|0[.,]0+)\s*\)?$/;
const SEMN_FLIP = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };
const SEMN_REL = { '<': 'neg', '>': 'pos', '<=': 'nonpos', '>=': 'nonneg' };
// cuvântul / semnul de la sfârșit (cele „sau egal" întâi)
const SEMN_TERMS = [
  ['nonneg', /(^|[^a-z0-9])(nenegativ[aei]?|po[zs]itiv[aei]?\s+sau\s+(?:nul[aei]?|zero|0|egal[aei]?\s+cu\s+(?:0|zero))|mai\s+mar[ei]\s+sau\s+egal[aei]?\s+(?:cu|decat|ca)\s+(?:0|zero))$/],
  ['nonpos', /(^|[^a-z0-9])(nepozitiv[aei]?|negativ[aei]?\s+sau\s+(?:nul[aei]?|zero|0|egal[aei]?\s+cu\s+(?:0|zero))|mai\s+mic[ai]?\s+sau\s+egal[aei]?\s+(?:cu|decat|ca)\s+(?:0|zero))$/],
  ['neg', /(^|[^a-z0-9])((?:strict\s+)?negativ[aei]?|neg|minus|mai\s+mic[ai]?\s+(?:decat|ca|de)\s+(?:0|zero)|sub\s+(?:0|zero))$/],
  ['pos', /(^|[^a-z0-9])((?:strict\s+)?po[zs]itiv[aei]?|poz|plus|mai\s+mar[ei]\s+(?:decat|ca|de)\s+(?:0|zero)|peste\s+(?:0|zero))$/],
  ['neg', /(^|[\s=:])(\(\s*-(?:\s*-)*\s*\)|-(?:\s*-)*)$/],
  ['pos', /(^|[\s=:])(\(\s*\+(?:\s*\+)*\s*\)|\+(?:\s*\+)*)$/],
];
// legăturile dintre subiect și semn: „f'(x) este", „are semnul", „=", „:"
const SEMN_LINK = /(?:^|\s)(?:e|este|sunt|va\s+fi|are|ia|semn(?:ul)?|valori(?:le)?|doar|numai|devine|ramane|iese|strict|tot|mereu|intotdeauna)$|\s*[=:]$/;
// subiecte care înseamnă „ce s-a întrebat" (nu numesc alt obiect)
const SEMN_GENERIC = /^(?:derivat[ae]i?|functi[ae]i?|expresi[ae]i?|raport(?:ul|ului)?|fracti[ae]i?|numar(?:ul|ului)?|rezultat(?:ul|ului)?|valoare[a]?|valori(?:le)?|semn(?:ul)?|el|ea|ei|ele|aceasta|acesta|totul|produs(?:ul|ului)?|cat(?:ul|ului)?|diferent[ae]i?|sum[ae]i?)(?![a-z0-9])/;

// despre ce e afirmația: '' = doar semnul; null = nu e o afirmație curată despre semn
function semnSubject(raw) {
  let s = semnTrim(raw);
  for (let k = 0; k < 8; k++) { const n = s.replace(SEMN_LINK, '').trim(); if (n === s) break; s = n; }
  s = semnTrim(s.replace(/^semn(?:ul)?(?:\s+lui)?(?![a-z0-9])\s*/, '').replace(/^lui\s+/, ''));
  if (!s) return '';
  if (/[,;]|(?:^|[^a-z0-9])(?:si|sau|apoi|iar|dar|respectiv)(?![a-z0-9])/.test(s)) return null;    // mai multe afirmații
  if (/negativ|po[zs]itiv|minus|plus|(?:^|[^a-z0-9])(?:neg|poz)(?![a-z0-9])/.test(s)) return null;  // alt semn înainte („+ sau −")
  if (SEMN_GENERIC.test(s)) return '';
  if (!/[a-z]/.test(s)) return null;                                                              // „2 −", „−2 < 0"
  return s;
}

// o singură afirmație: inegalitatea cu 0 sau cuvântul / semnul de la sfârșit
function semnClass(raw) {
  const t = semnTrim(raw);
  if (!t) return null;
  const rel = t.match(/<=|>=|<|>/g);
  if (rel) {
    if (rel.length !== 1) return null;                    // „0 < x < 1"
    const i = t.search(/<=|>=|<|>/);
    const left = semnTrim(t.slice(0, i)), right = semnTrim(t.slice(i + rel[0].length));
    let op = rel[0], side;
    if (SEMN_ZERO.test(right)) side = left;
    else if (SEMN_ZERO.test(left)) { side = right; op = SEMN_FLIP[op]; }  // „0 > f'(x)"
    else return null;                                     // „x < 1"
    const lhs = semnSubject(side);
    return lhs == null ? null : { sign: SEMN_REL[op], lhs };
  }
  for (let k = 0; k < SEMN_TERMS.length; k++) {
    const m = SEMN_TERMS[k][1].exec(t);
    if (!m) continue;
    const lhs = semnSubject(t.slice(0, m.index + m[1].length));
    return lhs == null ? null : { sign: SEMN_TERMS[k][0], lhs };
  }
  return null;
}

// „negativ (−)", „f'(x) < 0 (negativ)", „negativ (f'(x) < 0)": ambele părți, același semn
function semnParen(t) {
  if (t[t.length - 1] !== ')') return null;
  let d = 0, i = t.length - 1;
  for (; i >= 0; i--) {
    if (t[i] === ')') d++;
    else if (t[i] === '(' && --d === 0) break;
  }
  if (i <= 0) return null;
  const a = semnClass(t.slice(0, i)), b = semnClass(t.slice(i + 1, -1));
  return a && b && a.sign === b.sign ? { sign: a.sign, lhs: a.lhs || b.lhs } : null;
}

// „negativ, adică −", „−, f'(x) < 0": părțile (după virgulă / „adică") spun același semn
function semnParts(t) {
  const out = [];
  let depth = 0, cur = '';
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if ('([{'.indexOf(c) >= 0) depth++;
    else if (')]}'.indexOf(c) >= 0) depth = Math.max(0, depth - 1);
    if (depth === 0 && (c === ',' || c === ';')) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  const parts = [];
  for (let i = 0; i < out.length; i++) {
    const bits = out[i].split(/(?:^|\s)adica(?![a-z0-9])/);
    for (let j = 0; j < bits.length; j++) { const s = semnTrim(bits[j]); if (s) parts.push(s); }
  }
  return parts;
}

function signOf(raw, barem) {
  let t = semnText(raw);
  if (!t || t.length > 160 || SEMN_NOT.test(t)) return null;   // „nu e negativ", „≠ 0"
  const why = SEMN_WHY.exec(t);
  if (why) {
    if (barem) return null;   // în barem, concluzia arată că se cere altceva (monotonia)
    t = why.index > 0 ? t.slice(0, why.index) : t.slice(why[0].length);   // elevul: doar afirmația
  }
  t = t.replace(SEMN_DOMAIN_IN, ' ').replace(/\s+/g, ' ').trim();
  const dom = SEMN_DOMAIN_END.exec(t);
  if (dom && dom.index > 0) t = t.slice(0, dom.index);
  t = semnTrim(t);
  if (!t) return null;
  const one = semnClass(t);
  if (one) return one;
  const parts = semnParts(t);
  if (parts.length > 1 || (parts.length === 1 && parts[0] !== t)) {
    let acc = null;
    for (let i = 0; i < parts.length; i++) {
      const x = semnClass(parts[i]) || semnParen(parts[i]);
      if (!x || (acc && acc.sign !== x.sign)) return null;
      acc = acc ? { sign: acc.sign, lhs: acc.lhs || x.lhs } : x;
    }
    return acc;
  }
  return semnParen(t);
}

// același obiect? („f'(x)" = „f'" = „f′(x)"; „Δ" = „\Delta"; lanț: „f'(x) = (x−1)/x")
function semnSame(g, e) {
  if (!g || !e) return true;
  const keys = (s) => String(s).split('=').map((x) => x.replace(/\s+/g, '').replace(/\(([a-z])\)$/, '')).filter(Boolean);
  const ke = keys(e);
  return keys(g).some((k) => ke.indexOf(k) >= 0);
}

function signEquivalent(given, expected) {
  const e = signOf(expected, true);
  if (!e) return null;
  const g = signOf(given, false);
  if (!g) return null;
  const same = g.sign === e.sign || (e.sign === 'nonneg' && g.sign === 'pos') || (e.sign === 'nonpos' && g.sign === 'neg');
  if (!same) return false;
  return semnSame(g.lhs, e.lhs) ? true : null;
}
// ── SFÂRȘIT COD COMUN ──────────────────────────────────────────────────────

module.exports = { signOf, signEquivalent };
