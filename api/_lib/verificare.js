// =====================================================================
// api/_lib/verificare.js — AGENTUL DE VERIFICARE a materialelor din site
// (Admin → „🔎 Verificare materiale"). Logica fără rețea; acțiunile HTTP sunt
// în api/content-check.js. Teste: test/verificare-materiale.test.js.
//
// Ce face, pe scurt:
//   1. VERIFICĂRI AUTOMATE (fără AI, gratuite, deterministe) pe testele HTML:
//      • JavaScript care nu se mai poate rula (eroare de sintaxă → testul nu
//        pornește deloc);
//      • LaTeX scris cu UN SINGUR backslash într-un șir JavaScript („\frac"
//        devine caracterul form-feed + „rac", „\sqrt" devine „sqrt") — formula
//        apare stricată pe site;
//      • formule pe care KaTeX nu le poate citi (acolade neînchise, comenzi
//        greșite), ca indicii pentru model;
//      • raportarea scorului (MATE_SCORE) lipsă.
//   2. VERIFICAREA CU AI: modelul rezolvă SINGUR fiecare item și îl compară cu
//      cheia, cu explicația, cu variantele și cu punctajul (+ greșeli de scriere,
//      diacritice, LaTeX, figuri, funcționare). Răspunsul e JSON pe schemă.
//   3. CORECTURA: fiecare problemă vine cu „editări" (find → replace) pe
//      fișierul ÎNSUȘI. La HTML se aplică exact (cu toleranță la spații și la
//      backslash-uri), apoi fișierul corectat e re-verificat automat (nu se
//      publică nimic care strică JavaScript-ul). La PDF: textul greșit se
//      acoperă și se rescrie pe loc, cu un font cu aceleași dimensiuni ca Times /
//      Arial; ce nu se poate rescrie pe loc (formule, figuri) intră într-o
//      pagină de ERATĂ adăugată la final.
//   Corectura se pune într-un fișier NOU (originalul rămâne copie de siguranță),
//   iar adminul o vede înainte să o publice; „Anulează" revine la original.
// =====================================================================
const vm = require('node:vm');
const path = require('node:path');
const fs = require('node:fs');

// ═════════════════════════════════════════════════════════════════════════════
// 1. SURSA PENTRU MODEL
// ═════════════════════════════════════════════════════════════════════════════
const MAX_HTML_CHARS = parseInt(process.env.VERIFICARE_MAX_HTML || '360000', 10);

// CSS-ul nu conține matematică: îl scoatem (tokeni mai puțini). Imaginile
// incluse ca base64 la fel. Restul (HTML + JavaScript + SVG) rămâne neatins,
// ca fragmentele citate de model să se regăsească EXACT în fișier.
function htmlForModel(html, { maxChars = MAX_HTML_CHARS } = {}) {
  let s = String(html || '');
  s = s.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (m, a, css, b) => (css.length > 200 ? `${a}/* CSS omis la verificare (${Math.round(css.length / 1024)} KB) */${b}` : m));
  s = s.replace(/data:([a-z]+\/[a-z0-9.+-]+);base64,[A-Za-z0-9+/=]{400,}/gi, (m, mime) => `data:${mime};base64,[imagine omisă la verificare, ${Math.round(m.length / 1024)} KB]`);
  const truncated = s.length > maxChars;
  if (truncated) s = s.slice(0, maxChars);
  return { text: s, truncated, chars: s.length };
}

// ═════════════════════════════════════════════════════════════════════════════
// 2. VERIFICĂRI AUTOMATE
// ═════════════════════════════════════════════════════════════════════════════
// Blocurile <script> inline (fără src): poziția codului în fișier + tipul.
function scriptBlocks(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/.test(attrs)) continue;
    const type = ((/\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs) || [])[1] || '').toLowerCase();
    const codeStart = m.index + m[0].indexOf('>') + 1;
    out.push({ attrs, type, code: m[2], start: codeStart, end: codeStart + m[2].length });
  }
  return out;
}
const lineAt = (text, idx) => String(text).slice(0, idx).split('\n').length;

// JavaScript care nu se compilează (scripturile clasice; JSON-urile se parsează)
function jsSyntaxIssues(html) {
  const out = [];
  for (const b of scriptBlocks(html)) {
    if (!b.code.trim()) continue;
    if (/json/.test(b.type)) {
      try { JSON.parse(b.code); } catch (e) { out.push({ line: lineAt(html, b.start), message: `JSON invalid: ${e.message}` }); }
      continue;
    }
    if (b.type && !/^(text\/javascript|application\/javascript|javascript)$/.test(b.type)) continue; // module, șabloane
    try { new vm.Script(b.code, { filename: 'test.html' }); }
    catch (e) {
      const ln = e.stack && /test\.html:(\d+)/.exec(e.stack);
      out.push({ line: lineAt(html, b.start) + (ln ? parseInt(ln[1], 10) - 1 : 0), message: e.message });
    }
  }
  return out;
}

// ─── Șirurile de caractere dintr-un cod JavaScript (lexer minimal) ───────────
// Întoarce [{ q, start, end, raw }] — start/end = poziția conținutului (fără
// ghilimele) în `code`. Sare peste comentarii și peste expresiile regulate;
// la șabloane (`…${expr}…`) părțile de text sunt șiruri, iar ${…} e cod.
function jsStrings(code) {
  const s = String(code || '');
  const out = [];
  const depth = [];          // pentru fiecare ${ deschis: câte acolade { sunt încă deschise în el
  let i = 0, prev = '';
  const regexOK = (p) => !p || /[(,=:[!&|?{};+\-*%<>~^]/.test(p);
  const tplText = () => {    // i = primul caracter de text al șablonului
    const start = i;
    while (i < s.length) {
      if (s[i] === '\\') { i += 2; continue; }
      if (s[i] === '`') { out.push({ q: '`', start, end: i, raw: s.slice(start, i) }); i++; return; }
      if (s[i] === '$' && s[i + 1] === '{') { out.push({ q: '`', start, end: i, raw: s.slice(start, i) }); i += 2; depth.push(0); return; }
      i++;
    }
    out.push({ q: '`', start, end: s.length, raw: s.slice(start) });
  };
  while (i < s.length) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; continue; }
    if (c === '/' && s[i + 1] === '*') { const k = s.indexOf('*/', i + 2); i = k < 0 ? s.length : k + 2; continue; }
    if (c === '"' || c === "'") {
      const start = ++i;
      while (i < s.length && s[i] !== c && s[i] !== '\n') i += s[i] === '\\' ? 2 : 1;
      const end = Math.min(i, s.length);
      out.push({ q: c, start, end, raw: s.slice(start, end) });
      i++; prev = 'a';
      continue;
    }
    if (c === '`') { i++; tplText(); prev = 'a'; continue; }
    if (depth.length && c === '{') { depth[depth.length - 1]++; prev = c; i++; continue; }
    if (depth.length && c === '}') {
      if (depth[depth.length - 1] === 0) { depth.pop(); i++; tplText(); prev = 'a'; continue; }
      depth[depth.length - 1]--; prev = c; i++;
      continue;
    }
    if (c === '/' && regexOK(prev)) {
      let cls = false;
      i++;
      while (i < s.length && s[i] !== '\n') {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === '[') cls = true;
        else if (s[i] === ']') cls = false;
        else if (s[i] === '/' && !cls) break;
        i++;
      }
      i++;
      while (/[a-z]/i.test(s[i] || '')) i++;
      prev = 'a';
      continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

// Comenzile LaTeX care apar în materialele de matematică. „\frac" scris într-un
// șir JavaScript cu UN SINGUR backslash nu mai e „\frac": JavaScript citește
// „\f" (form-feed) + „rac". La fel „\times" (TAB + „imes"), „\neq" (rând nou +
// „eq"), „\sqrt" („sqrt" — backslash-ul dispare), „\cdot", „\pi"…
const LATEX_CMDS = new Set(('frac dfrac tfrac sqrt cdot cdots ldots dots times div pm mp le leq ge geq ne neq approx equiv sim cong '
  + 'infty pi alpha beta gamma delta Delta theta lambda mu sigma omega Omega phi varphi rho tau epsilon varepsilon '
  + 'angle triangle perp parallel circ in notin subset subseteq supset cup cap emptyset varnothing forall exists mid nmid '
  + 'mathbb mathbf mathrm mathit text textbf textit operatorname left right big Big bigg overline underline overrightarrow '
  + 'vec hat widehat bar overarc arc log ln lg sin cos tan tg ctg cot lim sum int prod binom quad qquad '
  + 'Rightarrow Leftrightarrow rightarrow leftarrow Leftarrow implies iff to mapsto begin end matrix pmatrix vmatrix '
  + 'bmatrix cases det max min mod pmod gcd lcm hline displaystyle limits nolimits boxed color colorbox degree prime '
  + 'measuredangle sphericalangle square blacksquare checkmark star ast bullet leqslant geqslant lt gt lbrace rbrace '
  + 'langle rangle lfloor rfloor lceil rceil neg land lor oplus otimes therefore because').split(/\s+/));

// „\(", „\)", „\[", „\]" (delimitatorii MathJax/KaTeX), „\{", „\}", „\,", „\;", „\!":
// cu un singur backslash, JavaScript pierde backslash-ul („\(" devine „(").
const LATEX_SYMBOLS = new Set(['(', ')', '[', ']', '{', '}', ',', ';', '!', '|']);

function latexCommandAt(raw, k) {
  // raw[k] === '\\' (număr impar de backslash-uri înainte de litere)
  if (LATEX_SYMBOLS.has(raw[k + 1])) return raw[k + 1];
  const m = /^\\([A-Za-z]+)/.exec(raw.slice(k));
  if (!m) return null;
  const word = m[1];
  if (/^u[0-9a-fA-F]{4}/.test(word) || /^x[0-9a-fA-F]{2}/.test(word)) return null;   // \u00e2, \x41 — escape-uri reale
  // cel mai lung prefix care e comandă LaTeX cunoscută (ex. „\fracdin" → nu)
  if (LATEX_CMDS.has(word)) return word;
  for (let n = word.length - 1; n >= 2; n--) if (LATEX_CMDS.has(word.slice(0, n))) return word.slice(0, n);
  return null;
}

// LaTeX cu un singur backslash în șirurile JavaScript ale testului
function latexEscapeIssues(html) {
  const out = [];
  for (const b of scriptBlocks(html)) {
    if (b.type && !/javascript/.test(b.type)) continue;
    for (const str of jsStrings(b.code)) {
      const raw = str.raw;
      const bad = [];
      for (let k = 0; k < raw.length; k++) {
        if (raw[k] !== '\\') continue;
        let n = 0;
        while (raw[k + n] === '\\') n++;
        if (n % 2 === 1) {
          const cmd = latexCommandAt(raw, k + n - 1);
          if (cmd) bad.push(cmd);
        }
        k += n - 1;
      }
      if (!bad.length) continue;
      const abs = b.start + str.start;
      out.push({
        line: lineAt(html, abs), commands: [...new Set(bad)],
        literal: raw.length > 160 ? `${raw.slice(0, 157)}…` : raw,
        rawLiteral: raw, quote: str.q, absStart: abs, absEnd: b.start + str.end,
      });
    }
  }
  return out;
}

// Corectura deterministă: în literalul stricat, fiecare „\comandă" cu backslash
// impar primește încă un backslash. Întoarce editarea (find → replace).
function fixLatexLiteral(raw) {
  let out = '';
  for (let k = 0; k < raw.length; k++) {
    if (raw[k] !== '\\') { out += raw[k]; continue; }
    let n = 0;
    while (raw[k + n] === '\\') n++;
    const odd = n % 2 === 1;
    const cmd = odd ? latexCommandAt(raw, k + n - 1) : null;
    out += '\\'.repeat(n + (cmd ? 1 : 0));
    k += n - 1;
  }
  return out;
}

// Valoarea unui șir JavaScript (pentru verificarea formulelor din el)
function unescapeJs(raw) {
  return String(raw || '').replace(/\\(u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|[\s\S])/g, (m, e) => {
    if (e[0] === 'u' && e.length > 1) return String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16));
    if (e[0] === 'x' && e.length === 3) return String.fromCharCode(parseInt(e.slice(1), 16));
    return { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' }[e] ?? e;
  });
}

const decodeEntities = (s) => String(s || '')
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, d) => String.fromCodePoint(parseInt(d, 10)))
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&amp;/g, '&');

// formulele dintr-un text: $$…$$, \[…\], \(…\), $…$
function mathSegments(text) {
  const t = String(text || '');
  const out = [];
  const re = /\$\$([\s\S]{1,1500}?)\$\$|\\\[([\s\S]{1,1500}?)\\\]|\\\(([\s\S]{1,1000}?)\\\)|\$([^$\n]{1,600}?)\$/g;
  let m;
  while ((m = re.exec(t))) {
    const tex = m[1] ?? m[2] ?? m[3] ?? m[4];
    if (tex == null || !tex.trim()) continue;
    if (m[4] != null && /^\s*\d+([.,]\d+)?\s*(lei|ron|euro)?\s*$/i.test(tex)) continue;   // „$5$" e ok, „5 lei" nu e formulă
    out.push(tex);
  }
  return out;
}

let _katex = null;
function katexParseError(tex) {
  try {
    if (!_katex) _katex = require('katex');
    _katex.renderToString(tex, { throwOnError: true, strict: 'ignore', displayMode: false, trust: false, macros: { '\\R': '\\mathbb{R}', '\\N': '\\mathbb{N}', '\\Z': '\\mathbb{Z}', '\\Q': '\\mathbb{Q}', '\\tg': '\\operatorname{tg}', '\\ctg': '\\operatorname{ctg}', '\\arctg': '\\operatorname{arctg}', '\\degree': '^{\\circ}' } });
    return null;
  } catch (e) {
    return String(e.message || e).replace(/^KaTeX parse error:\s*/, '').slice(0, 160);
  }
}

// formulele care nu se pot citi (din textul paginii și din șirurile JavaScript)
function katexIssues(html, { max = 40 } = {}) {
  const src = String(html || '');
  const out = [];
  const seen = new Set();
  const consider = (tex, where) => {
    if (out.length >= max) return;
    const key = tex.trim();
    if (seen.has(key)) return;
    seen.add(key);
    const err = katexParseError(key);
    if (err) out.push({ where, tex: key.length > 140 ? `${key.slice(0, 137)}…` : key, error: err });
  };
  const visible = decodeEntities(src.replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ').replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ').replace(/<[^>]+>/g, ' '));
  for (const tex of mathSegments(visible)) consider(tex, 'text');
  for (const b of scriptBlocks(src)) {
    if (b.type && !/javascript/.test(b.type)) continue;
    for (const s of jsStrings(b.code)) for (const tex of mathSegments(unescapeJs(s.raw))) consider(tex, `js r.${lineAt(src, b.start + s.start)}`);
  }
  return out;
}

// Toate verificările automate ale unui fișier HTML
function staticChecks(html) {
  const src = String(html || '');
  const syntax = jsSyntaxIssues(src);
  const latex = latexEscapeIssues(src);
  const katex = katexIssues(src);
  const interactive = /<script\b/i.test(src);
  const score = /MATE_SCORE/.test(src);
  return { syntax, latex, katex, interactive, scoreReport: score };
}

// Problemele sigure din verificările automate → în același format ca ale modelului
function staticIssues(checks) {
  const out = [];
  for (const s of checks.syntax) {
    out.push({
      source: 'automat', severity: 'critica', category: 'functionalitate', confidence: 'sigur',
      location: `rândul ${s.line} (JavaScript)`, page: null,
      title: 'JavaScript-ul testului nu se poate rula',
      description: `Eroare de sintaxă: ${s.message}. Browserul nu execută deloc scriptul, deci testul nu pornește (fără itemi / fără verificare / fără scor).`,
      evidence: '', correct: '', fix_kind: 'manual', edits: [], fix_note: 'Corectura o propune verificarea cu AI (vezi problemele de mai jos) sau se face manual.',
    });
  }
  for (const l of checks.latex) {
    const fixed = fixLatexLiteral(l.rawLiteral);
    out.push({
      source: 'automat', severity: 'majora', category: 'latex_formatare', confidence: 'sigur',
      location: `rândul ${l.line} (JavaScript)`, page: null,
      title: `Formulă stricată: ${l.commands.map((c) => '\\' + c).join(', ')} cu un singur backslash`,
      description: `În JavaScript, „\\${l.commands[0]}" scris cu un singur backslash nu mai ajunge la KaTeX/MathJax ca „\\${l.commands[0]}" (ex. „\\frac" devine caracterul form-feed + „rac", „\\sqrt" devine „sqrt"). Pe site formula apare stricată.`,
      evidence: l.literal, correct: 'Backslash-ul se dublează în șirul JavaScript: „\\\\frac", „\\\\sqrt"…',
      fix_kind: 'patch', edits: [{ find: l.rawLiteral, replace: fixed, all: true }],
      fix_note: 'Dublează backslash-ul comenzilor LaTeX din acest șir (aceeași corectură peste tot unde apare șirul).',
    });
  }
  if (checks.interactive && !checks.scoreReport) {
    out.push({
      source: 'automat', severity: 'info', category: 'functionalitate', confidence: 'probabil',
      location: 'tot testul', page: null, title: 'Testul nu raportează scorul (MATE_SCORE)',
      description: 'Fișierul nu trimite rezultatul către site (parent.postMessage({type:"MATE_SCORE", …})), deci scorul elevului nu intră în „Progresul meu" și în rapoarte. (Dacă materialul e doar o fișă de citit, ignoră.)',
      evidence: '', correct: '', fix_kind: 'none', edits: [], fix_note: '',
    });
  }
  return out;
}

// ═════════════════════════════════════════════════════════════════════════════
// 3. APLICAREA CORECTURILOR PE TEXT (HTML)
// ═════════════════════════════════════════════════════════════════════════════
const escRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const countOf = (hay, needle) => { if (!needle) return 0; let n = 0, i = 0; while ((i = hay.indexOf(needle, i)) >= 0) { n++; i += needle.length; } return n; };

// Variantele în care modelul poate cita greșit un fragment, în ordinea încercării.
// Fiecare: [find, replace, cum] — replace se transformă la fel ca find.
function variants(find, replace) {
  const out = [[find, replace, 'exact']];
  const restore = (x) => String(x).replace(/\f/g, '\\f').replace(/\t(?=[a-z])/g, '\\t').replace(/\u0008/g, '\\b').replace(/\v/g, '\\v');
  if (/[\f\u0008\v]|\t[a-z]/.test(find)) out.push([restore(find), restore(replace), 'latex_restaurat']);
  if (find.includes('\\')) {
    out.push([find.replace(/\\/g, '\\\\'), replace.replace(/\\/g, '\\\\'), 'backslash_dublat']);
    if (find.includes('\\\\')) out.push([find.replace(/\\\\/g, '\\'), replace.replace(/\\\\/g, '\\'), 'backslash_injumatatit']);
  }
  const ent = (x) => String(x).replace(/&(?!(amp|lt|gt|quot|#\d+|#x[0-9a-f]+|nbsp);)/gi, '&amp;');
  if (/&/.test(find)) out.push([ent(find), ent(replace), 'entitati']);
  return out;
}

// Aplică editările pe rând (fiecare pe textul rezultat din cea de dinainte).
// edits: [{ find, replace, all? }] → { text, results: [{ ok, how, reason }] }
function applyEdits(source, edits) {
  let text = String(source ?? '');
  const results = [];
  for (const e of edits || []) {
    const find = String(e?.find ?? '');
    const replace = String(e?.replace ?? '');
    if (!find) { results.push({ ok: false, reason: 'fragmentul de căutat e gol' }); continue; }
    if (find === replace) { results.push({ ok: false, reason: 'editarea nu schimbă nimic' }); continue; }
    let done = null;
    for (const [f, r, how] of variants(find, replace)) {
      const n = countOf(text, f);
      if (n === 1 || (n > 1 && e.all)) {
        text = e.all ? text.split(f).join(r) : text.replace(f, () => r);
        done = { ok: true, how, count: n };
        break;
      }
      if (n > 1) { done = { ok: false, reason: `fragmentul apare de ${n} ori — trebuie mai mult context ca să fie unic` }; break; }
    }
    if (!done) {
      // spațiile/rândurile pot diferi (modelul „curăță" indentarea)
      const re = new RegExp(escRe(find.trim()).replace(/\s+/g, '\\s+'), 'g');
      const hits = [...text.matchAll(re)];
      if (hits.length === 1) {
        const h = hits[0];
        text = text.slice(0, h.index) + replace.trim() + text.slice(h.index + h[0].length);
        done = { ok: true, how: 'spatii_flexibile', count: 1 };
      } else if (hits.length > 1) done = { ok: false, reason: `fragmentul apare de ${hits.length} ori — trebuie mai mult context` };
    }
    results.push(done || { ok: false, reason: 'fragmentul nu se găsește în fișier (modelul l-a citat inexact)' });
  }
  return { text, results };
}

// Fișierul corectat nu are voie să strice ce mergea: JavaScript-ul trebuie să se
// compileze în continuare, formulele să nu se strice mai multe, iar mărimea să
// nu se schimbe dramatic (un „replace" scăpat de sub control).
function validatePatched(before, after) {
  const problems = [];
  const a = staticChecks(before), b = staticChecks(after);
  if (b.syntax.length > a.syntax.length) problems.push(`corectura strică JavaScript-ul: ${b.syntax.map((x) => x.message).slice(0, 2).join('; ')}`);
  if (b.katex.length > a.katex.length) problems.push(`corectura adaugă formule pe care KaTeX nu le poate citi: ${b.katex.slice(0, 2).map((x) => x.tex).join(' · ')}`);
  if (a.scoreReport && !b.scoreReport) problems.push('corectura scoate raportarea scorului (MATE_SCORE)');
  const ratio = after.length / Math.max(1, before.length);
  if (ratio < 0.8 || ratio > 1.25) problems.push(`mărimea fișierului se schimbă prea mult (${Math.round(ratio * 100)}%)`);
  return { ok: problems.length === 0, problems, after: b };
}

// ─── Diferențele, pe rânduri, pentru previzualizare ──────────────────────────
// Rânduri lungi (HTML minificat): tăiate (pentru ele contează editPreview).
function lineDiff(a, b, { context = 2, maxHunks = 60, clip = 400 } = {}) {
  const A = String(a ?? '').split('\n'), B = String(b ?? '').split('\n');
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let ea = A.length, eb = B.length;
  while (ea > p && eb > p && A[ea - 1] === B[eb - 1]) { ea--; eb--; }
  const midA = A.slice(p, ea), midB = B.slice(p, eb);
  const ops = [];
  if (midA.length * midB.length <= 4e6) {
    // LCS pe porțiunea care diferă (corecturile sunt mici)
    const n = midA.length, m = midB.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = midA[i] === midB[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) { ops.push([' ', midA[i]]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) ops.push(['-', midA[i++]]);
      else ops.push(['+', midB[j++]]);
    }
    while (i < n) ops.push(['-', midA[i++]]);
    while (j < m) ops.push(['+', midB[j++]]);
  } else {
    midA.forEach((x) => ops.push(['-', x]));
    midB.forEach((x) => ops.push(['+', x]));
  }
  const seq = [];
  for (let k = 0; k < p; k++) seq.push([' ', A[k], k + 1, k + 1]);
  let la = p + 1, lb = p + 1;
  for (const [op, t] of ops) {
    if (op === ' ') seq.push([' ', t, la++, lb++]);
    else if (op === '-') seq.push(['-', t, la++, null]);
    else seq.push(['+', t, null, lb++]);
  }
  for (let k = ea; k < A.length; k++) seq.push([' ', A[k], la++, lb++]);
  const hunks = [];
  let cur = null;
  seq.forEach((x, k) => {
    if (x[0] === ' ') return;
    const from = Math.max(0, k - context), to = Math.min(seq.length - 1, k + context);
    if (cur && from <= cur.to + 1) cur.to = Math.max(cur.to, to);
    else { if (cur) hunks.push(cur); cur = { from, to }; }
  });
  if (cur) hunks.push(cur);
  return hunks.slice(0, maxHunks).map((h) => {
    const lines = seq.slice(h.from, h.to + 1);
    return {
      startA: (lines.find((l) => l[2] != null) || [])[2] ?? null,
      startB: (lines.find((l) => l[3] != null) || [])[3] ?? null,
      lines: lines.map(([op, t]) => [op, clipLine(t, clip)]),
    };
  });
}
function clipLine(s, max) {
  const t = String(s);
  return t.length > max ? `${t.slice(0, max)} … (+${t.length - max} caractere)` : t;
}

// Diferența pe CARACTERE pentru o editare (rândurile HTML minificate sunt
// uriașe): fragmentul vechi și cel nou, cu puțin context în jur.
function editPreview(source, edit, { around = 60 } = {}) {
  const s = String(source ?? '');
  const f = String(edit?.find ?? '');
  const i = f ? s.indexOf(f) : -1;
  if (i < 0) return { before: f, after: String(edit?.replace ?? ''), prefix: '', suffix: '' };
  return {
    prefix: s.slice(Math.max(0, i - around), i), before: f, after: String(edit.replace ?? ''),
    suffix: s.slice(i + f.length, i + f.length + around),
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 4. PDF: textul cu poziții, corectura pe loc, erata
// ═════════════════════════════════════════════════════════════════════════════
const FONTS_DIR = path.join(__dirname, 'fonts');
const fontFile = (name) => path.join(FONTS_DIR, name);

// caracterele „echivalente" la căutare (PDF-urile vechi au ş/ţ cu sedilă, minus tipografic etc.)
const FOLD = { 'ş': 'ș', 'Ş': 'Ș', 'ţ': 'ț', 'Ţ': 'Ț', '−': '-', '–': '-', '—': '-', '‐': '-', '⋅': '·', '∙': '·', '\u00a0': ' ', '’': "'", '‘': "'", '“': '"', '”': '"', '„': '"', 'ﬁ': 'fi', 'ﬂ': 'fl' };
function foldMap(str) {
  // textul „pliat" + harta indicilor (pliat → original), fără spații duble
  const out = [];
  const map = [];
  const s = String(str || '').normalize('NFC');
  for (let i = 0; i < s.length; i++) {
    let c = FOLD[s[i]] ?? s[i];
    if (/\s/.test(c)) { if (out.length && out[out.length - 1] === ' ') continue; c = ' '; }
    for (const ch of c) { out.push(ch); map.push(i); }
  }
  return { text: out.join(''), map };
}
const foldText = (s) => foldMap(s).text.trim();

// Rândurile fiecărei pagini, cu itemii de text și pozițiile lor (pdf.js din pdf-parse)
async function pdfLines(buf, { maxPages = 120 } = {}) {
  const pdfParse = require('pdf-parse');
  const { toPdfData } = require('./pdftext');
  const pages = [];
  await pdfParse(toPdfData(buf), {
    max: maxPages,
    pagerender: async (pd) => {
      const tc = await pd.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      const items = [];
      for (const it of tc.items || []) {
        if (!it || typeof it.str !== 'string' || !it.str.length) continue;
        const tr = it.transform || [1, 0, 0, 1, 0, 0];
        const st = (tc.styles || {})[it.fontName] || {};
        items.push({ str: it.str, x: tr[4], y: tr[5], w: it.width || 0, size: Math.hypot(tr[0], tr[1]) || Math.abs(tr[3]) || 10, rotated: Math.abs(tr[1]) > 0.01 || Math.abs(tr[2]) > 0.01, ascent: st.ascent || 0.89, descent: st.descent || -0.22, serif: /serif/.test(st.fontFamily || '') && !/sans/.test(st.fontFamily || '') });
      }
      // rânduri: același y (toleranță), de la stânga la dreapta
      const lines = [];
      for (const it of items.filter((x) => !x.rotated)) {
        let ln = lines.find((l) => Math.abs(l.y - it.y) < Math.max(1.5, it.size * 0.25));
        if (!ln) { ln = { y: it.y, items: [] }; lines.push(ln); }
        ln.items.push(it);
      }
      lines.sort((a, b) => b.y - a.y);
      for (const l of lines) {
        l.items.sort((a, b) => a.x - b.x);
        // textul rândului + pentru fiecare caracter: itemul și indexul în item
        let text = '';
        const chars = [];
        let lastEnd = null;
        for (const it of l.items) {
          if (lastEnd != null && it.x - lastEnd > it.size * 0.18 && !text.endsWith(' ') && !it.str.startsWith(' ')) { text += ' '; chars.push(null); }
          for (let k = 0; k < it.str.length; k++) { text += it.str[k]; chars.push({ it, k }); }
          lastEnd = it.x + it.w;
        }
        l.text = text;
        l.chars = chars;
      }
      pages.push({ index: pages.length, view: pd.view || [0, 0, 595, 842], lines });
      return '';
    },
  });
  return pages;
}

// Lățimea unui fragment dintr-un item, estimată proporțional cu lățimea glifelor
// în fontul de înlocuire (raportul e stabil între fonturi asemănătoare).
function charX(ch, font) {
  if (!ch) return null;
  const { it, k } = ch;
  const total = safeWidth(font, it.str, 10) || it.str.length;
  const before = safeWidth(font, it.str.slice(0, k), 10) || k;
  return it.x + (it.w || 0) * (before / total);
}
function safeWidth(font, text, size) {
  try { return font.widthOfTextAtSize(String(text), size); } catch { return null; }
}

// Unde stă fragmentul `find` (pagina dată sau oricare): { page, line, from, to } sau motivul
function locateInPdf(pages, find, page = null) {
  const target = foldMap(find).text.trim();
  if (!target) return { ok: false, reason: 'fragment gol' };
  if (target.length > 140) return { ok: false, reason: 'fragmentul e prea lung pentru o corectură pe loc' };
  const order = page ? [page - 1, ...pages.map((p) => p.index).filter((i) => i !== page - 1)] : pages.map((p) => p.index);
  const hits = [];
  for (const pi of order) {
    const pg = pages[pi];
    if (!pg) continue;
    for (const line of pg.lines) {
      const fm = foldMap(line.text);
      let i = fm.text.indexOf(target);
      while (i >= 0) {
        hits.push({ page: pi + 1, line, from: fm.map[i], to: fm.map[i + target.length - 1] + 1 });
        i = fm.text.indexOf(target, i + 1);
      }
    }
    if (page && hits.length && pi === page - 1) break;       // găsit pe pagina indicată
  }
  if (!hits.length) return { ok: false, reason: 'textul nu se găsește în stratul de text al PDF-ului (formulă, imagine sau text scanat)' };
  const onPage = page ? hits.filter((h) => h.page === page) : hits;
  const pool = onPage.length ? onPage : hits;
  if (pool.length > 1) return { ok: false, reason: `textul apare de ${pool.length} ori — e nevoie de un fragment mai lung` };
  return { ok: true, ...pool[0] };
}

// Fontul de înlocuire: Liberation Serif (aceleași lățimi ca Times New Roman) sau
// Liberation Sans (ca Arial); glifele care lipsesc (∠, ∈, ℝ…) vin din DejaVu Sans.
async function embedFonts(doc) {
  const fontkit = require('@pdf-lib/fontkit');
  doc.registerFontkit(fontkit);
  const load = async (file) => { try { return await doc.embedFont(fs.readFileSync(fontFile(file)), { subset: true }); } catch { return null; } };
  const fallback = await load('DejaVuSans-Bold.ttf');
  const serif = (await load('LiberationSerif-Regular.ttf')) || fallback;
  const sans = (await load('LiberationSans-Regular.ttf')) || serif;
  const raw = {};
  for (const [k, f] of Object.entries({ serif: 'LiberationSerif-Regular.ttf', sans: 'LiberationSans-Regular.ttf', fallback: 'DejaVuSans-Bold.ttf' })) {
    try { raw[k] = fontkit.create(fs.readFileSync(fontFile(f))); } catch { raw[k] = null; }
  }
  return { serif, sans, fallback, raw };
}

// textul pe bucăți, după fontul care are glifele (principal / rezervă)
function runsByFont(text, primary, primaryRaw, fallback, fallbackRaw) {
  const runs = [];
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    const usePrimary = !primaryRaw || primaryRaw.hasGlyphForCodePoint(cp) || /\s/.test(ch);
    const font = usePrimary ? primary : (fallbackRaw && fallbackRaw.hasGlyphForCodePoint(cp) ? fallback : null);
    if (!font) continue;            // caracter fără glifă în niciun font: îl sărim
    const last = runs[runs.length - 1];
    if (last && last.font === font) last.text += ch; else runs.push({ font, text: ch });
  }
  return runs;
}
const runsWidth = (runs, size) => runs.reduce((w, r) => w + (safeWidth(r.font, r.text, size) || 0), 0);

// Rupe un text pe rânduri care încap în `width`
function wrapRuns(text, fonts, size, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (runsWidth(runsByFont(t, fonts.serif, fonts.raw.serif, fonts.fallback, fonts.raw.fallback), size) > width && cur) { lines.push(cur); cur = w; }
    else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

// Adnotarea ascunsă „ExamenMate-corecturi" a unei pagini (se completează dacă există)
function addCorrectionNote(doc, page, list) {
  const { PDFName, PDFHexString } = require('pdf-lib');
  const { CORR_TITLE } = require('./pdftext');
  let annots = page.node.lookup(PDFName.of('Annots'));
  let prev = [];
  let dict = null;
  if (annots && typeof annots.size === 'function') {
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i);
      const t = a && a.lookup ? a.lookup(PDFName.of('T')) : null;
      if (t && typeof t.decodeText === 'function' && t.decodeText() === CORR_TITLE) {
        dict = a;
        try { prev = JSON.parse(a.lookup(PDFName.of('Contents')).decodeText()) || []; } catch { prev = []; }
        break;
      }
    }
  }
  const all = [...prev, ...list];
  if (dict) { dict.set(PDFName.of('Contents'), PDFHexString.fromText(JSON.stringify(all))); return; }
  const ref = doc.context.register(doc.context.obj({
    Type: 'Annot', Subtype: 'Text', Rect: [0, 0, 0, 0], F: 2 | 32, Open: false,
    T: PDFHexString.fromText(CORR_TITLE), Contents: PDFHexString.fromText(JSON.stringify(all)),
  }));
  if (!annots || typeof annots.push !== 'function') { annots = doc.context.obj([]); page.node.set(PDFName.of('Annots'), annots); }
  annots.push(ref);
}

// Corectura PDF-ului: pe loc unde se poate, restul în pagina de erată.
// edits: [{ id, page, find, replace, note }] ; erratum: [{ id, location, text }]
async function patchPdf(buf, edits, { erratum = [], title = '', dateLabel = '' } = {}) {
  const { PDFDocument, rgb } = require('pdf-lib');
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
  if (doc.isEncrypted) throw Object.assign(new Error('PDF-ul e criptat — nu se poate corecta automat.'), { status: 409 });
  const fonts = await embedFonts(doc);
  const pages = await pdfLines(buf);
  const pdfPages = doc.getPages();
  const placed = [];
  const notes = {};
  const errata = [...erratum];
  for (const e of edits || []) {
    const loc = locateInPdf(pages, e.find, e.page || null);
    const pg = loc.ok ? pdfPages[loc.page - 1] : null;
    const rotated = pg && pg.getRotation && pg.getRotation().angle % 360 !== 0;
    if (!loc.ok || !pg || rotated) {
      errata.push({ id: e.id, location: e.location || (e.page ? `pagina ${e.page}` : ''), text: `„${e.find}" → „${e.replace}"${e.note ? ` (${e.note})` : ''}`, reason: loc.ok ? 'pagină rotită' : loc.reason });
      continue;
    }
    const { line, from, to } = loc;
    const chars = line.chars.slice(from, to).filter(Boolean);
    const firstCh = chars[0], lastCh = chars[chars.length - 1];
    const it0 = firstCh.it;
    const serif = it0.serif || true;            // examenele sunt în Times: Liberation Serif, dacă nu știm sigur
    const font = serif ? fonts.serif : fonts.sans;
    const fontRaw = serif ? fonts.raw.serif : fonts.raw.sans;
    const x0 = charX(firstCh, font);
    const x1 = lastCh.k + 1 < lastCh.it.str.length ? charX({ it: lastCh.it, k: lastCh.k + 1 }, font) : lastCh.it.x + lastCh.it.w;
    const size = Math.max(...chars.map((c) => c.it.size));
    const asc = Math.max(...chars.map((c) => c.it.ascent || 0.89));
    const desc = Math.min(...chars.map((c) => c.it.descent || -0.22));
    const y = it0.y;
    // spațiul liber până la următorul item de pe rând (textul nou poate fi mai lung)
    const next = line.items.find((x) => x.x > x1 + 0.5 && !chars.some((c) => c.it === x));
    const room = (next ? next.x - 1.5 : (pg.getWidth() - 20)) - x0;
    let runs = runsByFont(e.replace, font, fontRaw, fonts.fallback, fonts.raw.fallback);
    let s = size;
    let need = runsWidth(runs, s);
    if (need > room) s = Math.max(size * 0.72, s * (room / need));
    need = runsWidth(runs, s);
    if (need > room + 0.5) {
      errata.push({ id: e.id, location: e.location || `pagina ${loc.page}`, text: `„${e.find}" → „${e.replace}"${e.note ? ` (${e.note})` : ''}`, reason: 'textul corect nu încape în locul celui greșit' });
      continue;
    }
    // acoperim textul greșit (doar lățimea lui) și scriem textul corect pe același rând
    const pad = 0.6;
    pg.drawRectangle({ x: x0 - pad, y: y + desc * size - pad, width: Math.max(x1 - x0, need) + 2 * pad, height: (asc - desc) * size + 2 * pad, color: rgb(1, 1, 1) });
    let x = x0;
    const drawn = [];
    for (const r of runs) {
      pg.drawText(r.text, { x, y, size: s, font: r.font, color: rgb(0, 0, 0) });
      drawn.push({ x: Math.round(x * 100) / 100, t: r.text });
      x += safeWidth(r.font, r.text, s) || 0;
    }
    placed.push({ id: e.id, page: loc.page, find: e.find, replace: e.replace, size: Math.round(s * 10) / 10 });
    (notes[loc.page - 1] = notes[loc.page - 1] || []).push({ y: Math.round(y * 100) / 100, x0: Math.round(x0 * 100) / 100, w: Math.round(Math.max(x1 - x0, need) * 100) / 100, find: e.find, replace: e.replace, runs: drawn });
  }
  // adnotarea ascunsă cu corecturile: la citirea textului (api/_lib/pdftext.js →
  // pageRenderer), AI-ul site-ului vede textul corect o singură dată, nu pe amândouă
  for (const [k, list] of Object.entries(notes)) addCorrectionNote(doc, pdfPages[Number(k)], list);
  // pagina de ERATĂ (ce nu s-a putut rescrie pe loc + corecturile „manuale")
  if (errata.length) {
    const [w, h] = pdfPages.length ? [pdfPages[0].getWidth(), pdfPages[0].getHeight()] : [595, 842];
    let pg = doc.addPage([w, h]);
    const margin = 56;
    let y = h - margin;
    const write = (text, { size = 11, color = rgb(0, 0, 0), font = fonts.serif, gap = 4, indent = 0 } = {}) => {
      for (const ln of wrapRuns(text, fonts, size, w - 2 * margin - indent)) {
        if (y < margin + size) { pg = doc.addPage([w, h]); y = h - margin; }
        let x = margin + indent;
        for (const r of runsByFont(ln, font, font === fonts.serif ? fonts.raw.serif : fonts.raw.fallback, fonts.fallback, fonts.raw.fallback)) {
          pg.drawText(r.text, { x, y, size, font: r.font, color });
          x += safeWidth(r.font, r.text, size) || 0;
        }
        y -= size + gap;
      }
    };
    write('ERATĂ', { size: 18, font: fonts.fallback, color: rgb(0.7, 0.1, 0.1), gap: 8 });
    write(`Corecturi la materialul „${title || 'acest material'}"${dateLabel ? ` · verificat pe ${dateLabel}` : ''}`, { size: 11, color: rgb(0.3, 0.3, 0.3), gap: 14 });
    for (const er of errata) {
      write(`• ${er.location ? er.location + ': ' : ''}${er.text}`, { size: 11.5, gap: 8 });
    }
    write('Corecturile au fost verificate de echipa ExamenMate.', { size: 9.5, color: rgb(0.45, 0.45, 0.45), gap: 4 });
  }
  const bytes = await doc.save({ useObjectStreams: false });
  return { pdf: Buffer.from(bytes), placed, errata };
}

// ═════════════════════════════════════════════════════════════════════════════
// 5. PROMPTUL, SCHEMA RĂSPUNSULUI, NORMALIZAREA
// ═════════════════════════════════════════════════════════════════════════════
const CATEGORIES = ['rezultat_gresit', 'cheie_gresita', 'variante_grila', 'calcul_gresit', 'enunt_ambiguu', 'enunt_incomplet', 'punctaj', 'explicatie_neconcordanta', 'latex_formatare', 'scriere_diacritice', 'figura', 'functionalitate', 'altceva'];
const SEVERITIES = ['critica', 'majora', 'minora', 'info'];

function reportSchema(S) {
  const EDIT = S.obj({
    find: S.str('fragmentul EXACT din fișier (copiat caracter cu caracter, unic în fișier)'),
    replace: S.str('fragmentul corectat care îl înlocuiește'),
  });
  const ISSUE = S.obj({
    severity: S.enum(SEVERITIES, 'critica = cheie/rezultat greșit sau test nefuncțional; majora = pas greșit, enunț care schimbă răspunsul, punctaj greșit; minora = scriere, diacritice, formatare; info = sugestie'),
    category: S.enum(CATEGORIES),
    location: S.str('unde: „Subiectul I, ex. 3", „itemul 5", „pagina 2, ex. 4 b)"'),
    page: S.nullable(S.int('pagina PDF (1 = prima); null la HTML')),
    title: S.str('problema, într-o propoziție scurtă'),
    description: S.str('ce e greșit și de ce (cu calculul tău)'),
    evidence: S.str('textul greșit, exact cum apare (scurt)'),
    correct: S.str('varianta corectă / rezultatul corect, pe scurt'),
    confidence: S.enum(['sigur', 'probabil']),
    fix_kind: S.enum(['patch', 'manual', 'none'], 'patch = editări aplicabile automat; manual = trebuie refăcut de mână (ex. o figură, o formulă complexă în PDF); none = doar semnalare'),
    edits: S.arr(EDIT, 'editările care repară problema (gol dacă fix_kind nu e patch)'),
    fix_note: S.str('ce schimbă corectura sau ce trebuie făcut manual'),
  });
  return S.obj({
    document_kind: S.enum(['test_interactiv', 'exercitiu_interactiv', 'fisa_pdf', 'subiect_oficial', 'barem', 'manual', 'altceva']),
    official: S.bool('documentul e un subiect sau barem OFICIAL (Ministerul Educației / CNPEE)'),
    items_checked: S.int('câți itemi (exerciții / subpuncte) ai verificat'),
    items: S.arr(S.obj({
      ref: S.str('ex. „S. I, ex. 3" sau „itemul 5"'),
      status: S.enum(['ok', 'problema', 'neverificabil']),
      answer: S.str('răspunsul calculat de tine, foarte scurt'),
    }), 'fiecare item verificat, în ordine'),
    verdict: S.enum(['ok', 'probleme_minore', 'probleme_grave']),
    summary: S.str('2–4 propoziții: ce ai verificat și ce ai găsit'),
    issues: S.arr(ISSUE),
    previous_review: S.arr(S.obj({ id: S.str(), status: S.enum(['confirmat', 'respins']), reason: S.str() }), 'doar la „a doua opinie": verdictul pentru fiecare problemă raportată înainte; altfel listă goală'),
  });
}

function systemPrompt({ kind }) {
  const pdf = kind === 'pdf';
  return [
    'Ești verificatorul de calitate al platformei ExamenMate (matematică, gimnaziu și liceu, Evaluarea Națională și Bacalaureatul din România): un profesor de matematică foarte riguros, corector de examen și tester atent. Verifici un material publicat pe site și raportezi DOAR problemele reale, în limba română (cu diacriticele ș, ț cu virgulă).',
    '',
    'CUM VERIFICI (obligatoriu, item cu item):',
    '1. REZOLVĂ SINGUR fiecare item, complet, ÎNAINTE să te uiți la cheia sau la rezolvarea din material. Abia apoi compară: răspunsul marcat corect (cheia), varianta corectă, explicația / baremul, punctajul.',
    '2. Grile: exact o variantă corectă; variantele distincte; litera cheii = varianta corectă; explicația spune aceeași literă și aceeași valoare.',
    '3. Itemi cu rezolvare: fiecare pas corect matematic; rezultatul final corect; „Arătați că…" chiar se demonstrează; unitățile de măsură; aproximările.',
    '4. Enunțul: complet (toate datele), neambiguu, fără date contradictorii; figura (dacă există) se potrivește cu enunțul (literele, valorile, unghiurile).',
    '5. Punctajul: suma punctajelor (la EN/BAC: 90 de puncte + 10 din oficiu), punctele fiecărui item consecvente cu baremul.',
    '6. Forma: greșeli de scriere, diacritice lipsă sau greșite, LaTeX care se afișează greșit, numerotare greșită.',
    pdf ? '' : '7. Funcționarea (test interactiv): datele itemilor din JavaScript (ex. ok:\'c\', answer_index, data-correct, correct), verificarea răspunsurilor, calculul scorului, butoanele; o greșeală de JavaScript care ar opri testul e critică.',
    '',
    'CE RAPORTEZI: numai greșeli reale, verificabile. Nu raporta preferințe de stil, formulări care sunt corecte, sau „ar fi frumos să…" (acelea, cel mult ca „info", rar). Dacă totul e corect: verdict „ok", issues = [].',
    'Dacă documentul e un subiect sau un barem OFICIAL (Ministerul Educației / CNPEE), textul oficial e de referință: raportezi doar greșeli evidente de transcriere/scanare sau nepotriviri subiect–barem, iar editări propui doar pentru greșeli de transcriere evidente.',
    '',
    'CORECTURA (câmpul edits), ca să poată fi aplicată AUTOMAT în fișier:',
    pdf
      ? [
        '- PDF: o editare = un fragment de TEXT SIMPLU, cum se vede tipărit, de pe UN SINGUR RÂND (maximum ~80 de caractere), unic în document; „replace" = același fragment, corectat, tot text simplu (fără LaTeX; folosește √, ², ·, −, π, ≤ dacă e nevoie). Pune și „page".',
        '- Fragmentul trebuie să fie suficient de lung încât să apară o singură dată (ex. „x = 4." în loc de „4").',
        '- Dacă greșeala e într-o formulă etajată (fracții, radicali mari, matrice), într-o figură sau într-un tabel desenat: fix_kind „manual", edits = [], iar în „correct" scrii clar varianta corectă (va intra într-o pagină de ERATĂ).',
      ].join('\n')
      : [
        '- HTML: „find" = un fragment copiat EXACT din fișier, caracter cu caracter, așa cum apare în sursă (cu backslash-urile din sursă: dacă în fișier scrie \\\\frac, îl copiezi \\\\frac), suficient de lung ca să apară O SINGURĂ DATĂ (include vecinii: ex. „{q:\'Suma numerelor…\', a:\'3\'"), dar cât mai scurt (sub ~300 de caractere).',
        '- „replace" = același fragment, cu DOAR corectura aplicată. Nu atinge designul (CSS), logica JavaScript sau figurile, în afară de cazul în care chiar ele sunt greșite.',
        '- Pentru o cheie greșită: corectează cheia (ex. ok:\'c\' → ok:\'b\') ȘI explicația, ca materialul să rămână consecvent; nu schimba enunțul ca să „se potrivească" cu o cheie greșită.',
        '- Fără editări pentru probleme care nu se pot repara sigur (fix_kind „manual" + explicație).',
      ].join('\n'),
    '',
    'Răspunzi STRICT cu obiectul JSON cerut (fără alt text).',
  ].filter((x) => x !== '').join('\n');
}

// Conținutul mesajului utilizator: fișierul + context + verificările automate
function userContent({ kind, meta = {}, html = null, pdfB64 = null, baremB64 = null, baremTitle = null, staticFindings = [], previous = [], dismissed = [], part = null }) {
  const blocks = [];
  const head = [
    `MATERIALUL: „${meta.title || 'fără titlu'}"`,
    meta.category ? `Rubrica: ${meta.category}${meta.subcategory ? ` / ${meta.subcategory}` : ''}${meta.profile ? ` / profil ${meta.profile}` : ''}` : '',
    meta.description ? `Descrierea de pe site: ${meta.description}` : '',
    part ? `Partea ${part.n} din ${part.of} a documentului (paginile ${part.from}–${part.to}): verifici doar paginile atașate; „page" = numărul paginii în fișierul atașat (1 = prima pagină atașată).` : '',
  ].filter(Boolean).join('\n');
  blocks.push({ type: 'text', text: head });
  if (kind === 'pdf') {
    blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfB64 }, title: meta.title || 'material' });
    if (baremB64) {
      blocks.push({ type: 'text', text: `BAREMUL asociat acestui subiect (pentru comparație): „${baremTitle || 'barem'}"` });
      blocks.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: baremB64 }, title: baremTitle || 'barem' });
    }
  } else {
    blocks.push({ type: 'text', text: `FIȘIERUL HTML (CSS-ul și imaginile base64 omise; restul e exact ca în fișier):\n<<<FISIER\n${html}\nFISIER>>>` });
  }
  const tail = [];
  if (staticFindings.length) {
    tail.push('VERIFICĂRILE AUTOMATE (fără AI) au găsit — confirmă-le, nu le repeta în issues dacă sunt deja corect descrise mai jos; folosește-le ca indicii:');
    for (const f of staticFindings.slice(0, 30)) tail.push(`- ${f}`);
  }
  if (previous.length) {
    tail.push('A DOUA OPINIE: alt verificator a raportat problemele de mai jos. Pentru FIECARE, spune în previous_review dacă e reală (confirmat) sau nu (respins), cu motivul. În issues pui DOAR problemele reale (cele confirmate, reformulate dacă e nevoie, plus ce a scăpat el):');
    for (const p of previous.slice(0, 40)) tail.push(`- [${p.id}] (${p.severity}) ${p.location}: ${p.title} — ${p.description}${p.correct ? ` | corect: ${p.correct}` : ''}`);
  }
  if (dismissed.length) {
    tail.push('Adminul a marcat deja ca NE-probleme (nu le mai raporta):');
    for (const d of dismissed.slice(0, 30)) tail.push(`- ${d}`);
  }
  tail.push('Verifică acum TOȚI itemii, item cu item, și răspunde cu JSON-ul cerut.');
  blocks.push({ type: 'text', text: tail.join('\n') });
  return blocks;
}

// Curățarea răspunsului modelului (+ id-uri stabile pentru fiecare problemă)
function normalizeReport(raw, { kind, restore = (x) => x } = {}) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const str = (v, n = 2000) => String(v ?? '').slice(0, n);
  const issues = (Array.isArray(r.issues) ? r.issues : []).slice(0, 80).map((i, k) => {
    const edits = (Array.isArray(i?.edits) ? i.edits : [])
      .map((e) => ({ find: String(e?.find ?? ''), replace: String(e?.replace ?? '') }))
      .filter((e) => e.find && e.find !== e.replace)
      .slice(0, 12);
    const fixKind = ['patch', 'manual', 'none'].includes(i?.fix_kind) ? i.fix_kind : (edits.length ? 'patch' : 'none');
    return {
      id: `i${k + 1}`,
      source: 'ai',
      severity: SEVERITIES.includes(i?.severity) ? i.severity : 'minora',
      category: CATEGORIES.includes(i?.category) ? i.category : 'altceva',
      location: restore(str(i?.location, 200)),
      page: kind === 'pdf' && Number.isInteger(i?.page) && i.page > 0 ? i.page : null,
      title: restore(str(i?.title, 300)),
      description: restore(str(i?.description, 3000)),
      evidence: restore(str(i?.evidence, 600)),
      correct: restore(str(i?.correct, 1500)),
      confidence: i?.confidence === 'probabil' ? 'probabil' : 'sigur',
      fix_kind: fixKind === 'patch' && !edits.length ? 'manual' : fixKind,
      edits: fixKind === 'patch' ? edits : [],
      fix_note: restore(str(i?.fix_note, 800)),
    };
  });
  const sevRank = { critica: 0, majora: 1, minora: 2, info: 3 };
  issues.sort((a, b) => sevRank[a.severity] - sevRank[b.severity]);
  issues.forEach((i, k) => { i.id = `i${k + 1}`; });
  const verdict = ['ok', 'probleme_minore', 'probleme_grave'].includes(r.verdict) ? r.verdict : (issues.some((i) => i.severity === 'critica' || i.severity === 'majora') ? 'probleme_grave' : issues.length ? 'probleme_minore' : 'ok');
  return {
    document_kind: str(r.document_kind, 40) || (kind === 'pdf' ? 'fisa_pdf' : 'test_interactiv'),
    official: !!r.official,
    items_checked: Number.isInteger(r.items_checked) ? r.items_checked : (Array.isArray(r.items) ? r.items.length : 0),
    items: (Array.isArray(r.items) ? r.items : []).slice(0, 120).map((x) => ({ ref: restore(str(x?.ref, 80)), status: ['ok', 'problema', 'neverificabil'].includes(x?.status) ? x.status : 'ok', answer: restore(str(x?.answer, 160)) })),
    verdict,
    summary: restore(str(r.summary, 1500)),
    issues,
    previous_review: (Array.isArray(r.previous_review) ? r.previous_review : []).slice(0, 60).map((p) => ({ id: str(p?.id, 20), status: p?.status === 'respins' ? 'respins' : 'confirmat', reason: restore(str(p?.reason, 600)) })),
  };
}

// starea unei verificări, din probleme (pentru listă și filtre)
function statusOf(issues) {
  const open = (issues || []).filter((i) => !i.dismissed && !i.fixed);
  if (open.some((i) => i.severity === 'critica')) return 'critic';
  if (open.some((i) => i.severity === 'majora')) return 'probleme';
  if (open.some((i) => i.severity === 'minora')) return 'minore';
  return 'ok';
}

// Numele fișierului corectat: același folder, același nume + „__corectat-AAAALLZZ-HHMM"
function correctedPath(filePath, now = new Date()) {
  const p = String(filePath || '');
  const slash = p.lastIndexOf('/');
  const dir = slash >= 0 ? p.slice(0, slash + 1) : '';
  const file = slash >= 0 ? p.slice(slash + 1) : p;
  const dot = file.lastIndexOf('.');
  const base = (dot > 0 ? file.slice(0, dot) : file).replace(/__corectat-\d{8}-\d{4,6}$/, '');
  const ext = dot > 0 ? file.slice(dot) : '';
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}`;
  return `${dir}${base}__corectat-${stamp}${ext}`;
}

// estimarea costului (lei) unei verificări, după mărimea fișierului — pentru
// confirmarea dinainte de un lot mare
function estimateTokens({ kind, bytes = 0, pages = 0 }) {
  if (kind === 'pdf') return { in: 2500 + (pages || Math.max(1, Math.round(bytes / 60000))) * 2600, out: 9000 };
  return { in: 2500 + Math.round(bytes / 3.1), out: 9000 };
}

module.exports = {
  htmlForModel, scriptBlocks, jsSyntaxIssues, jsStrings, latexEscapeIssues, fixLatexLiteral, unescapeJs, mathSegments,
  katexParseError, katexIssues, staticChecks, staticIssues, decodeEntities,
  applyEdits, validatePatched, lineDiff, editPreview,
  foldMap, foldText, pdfLines, locateInPdf, patchPdf, embedFonts,
  reportSchema, systemPrompt, userContent, normalizeReport, statusOf, correctedPath, estimateTokens,
  CATEGORIES, SEVERITIES, LATEX_CMDS,
};
