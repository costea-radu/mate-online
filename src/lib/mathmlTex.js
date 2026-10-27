// =====================================================================
// src/lib/mathmlTex.js — formulele unui document Word, ca LaTeX (pentru
// Profesorul Virtual). Fără React și fără DOM real: primește orice nod cu
// forma unui element (nodeType, localName/nodeName, childNodes, textContent,
// getAttribute) — în browser chiar elementele <math> desenate de docx-preview
// din ecuațiile Word (OMML → MathML); în teste, obiecte simple.
//   mathmlToTex(nodMath) → „\frac{3}{4}+\sqrt{2}"
//   domText(element)     → textul unui fragment de pagină: paragrafe pe rânduri,
//                          celulele tabelelor cu „ | ", formulele între $…$
// Folosit de src/lib/materialPdf.js (încărcarea unui Word în bibliotecă).
// =====================================================================

const OPS = {
  '−': '-', '–': '-', '×': '\\cdot ', '·': '\\cdot ', '⋅': '\\cdot ', '÷': ':', '±': '\\pm ', '∓': '\\mp ',
  '≤': '\\le ', '≥': '\\ge ', '≠': '\\ne ', '≈': '\\approx ', '≡': '\\equiv ', '∼': '\\sim ',
  '→': '\\to ', '⇒': '\\Rightarrow ', '⇔': '\\Leftrightarrow ', '∈': '\\in ', '∉': '\\notin ',
  '∪': '\\cup ', '∩': '\\cap ', '⊂': '\\subset ', '⊆': '\\subseteq ', '∅': '\\emptyset ', '∀': '\\forall ', '∃': '\\exists ',
  '∞': '\\infty ', 'π': '\\pi ', 'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ', 'Δ': '\\Delta ',
  'θ': '\\theta ', 'λ': '\\lambda ', 'μ': '\\mu ', 'φ': '\\varphi ', 'ω': '\\omega ', '°': '^{\\circ}',
  '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '∮': '\\oint ', '⊥': '\\perp ', '∥': '\\parallel ', '∠': '\\angle ', '△': '\\triangle ',
  'ℝ': '\\mathbb{R}', 'ℕ': '\\mathbb{N}', 'ℤ': '\\mathbb{Z}', 'ℚ': '\\mathbb{Q}', 'ℂ': '\\mathbb{C}',
  '\u2061': '', '\u2062': '', '\u2063': '', '\u2064': '', // aplicare de funcție / înmulțire invizibilă
};
const BIG = new Set(['\\sum ', '\\prod ', '\\int ', '\\oint ']);
const ACCENTS = { '¯': '\\overline', '‾': '\\overline', '→': '\\overrightarrow', '⃗': '\\vec', '^': '\\widehat', 'ˆ': '\\widehat', '~': '\\widetilde', '˜': '\\widetilde', '˙': '\\dot', '⌢': '\\overset{\\frown}' };

const isEl = (n) => n && n.nodeType === 1;
const nameOf = (n) => String((n && (n.localName || n.nodeName)) || '').toLowerCase().replace(/^m:/, '');
const kids = (n) => (n && n.childNodes ? Array.from(n.childNodes) : []).filter(isEl);
const txt = (n) => String((n && n.textContent) || '');
const attr = (n, a) => (n && typeof n.getAttribute === 'function' ? n.getAttribute(a) : null);

function mapText(s) {
  let out = '';
  for (const ch of String(s)) out += Object.prototype.hasOwnProperty.call(OPS, ch) ? OPS[ch] : ch;
  return out;
}
const group = (t) => {
  const v = String(t || '').trim();
  return /^[A-Za-z0-9]$/.test(v) ? v : `{${v}}`;
};

function conv(n) {
  if (!isEl(n)) return '';
  const tag = nameOf(n);
  const c = kids(n);
  switch (tag) {
    case 'math': case 'mrow': case 'mstyle': case 'mpadded': case 'menclose': case 'merror':
      return c.map(conv).join('');
    case 'semantics': return c.length ? conv(c[0]) : '';
    case 'annotation': case 'annotation-xml': case 'mphantom': return '';
    case 'mi': case 'mn': return mapText(txt(n));
    case 'mtext': case 'ms': {
      const t = txt(n);
      return /[A-Za-zĂÂÎȘȚăâîșț]{2,}/.test(t) ? `\\text{${t}}` : mapText(t);
    }
    case 'mspace': return '\\,';
    case 'mo': {
      const t = txt(n).trim();
      if (t === '(' || t === ')' || t === '[' || t === ']' || t === '|') return t;
      if (t === '{') return '\\{';
      if (t === '}') return '\\}';
      return mapText(t);
    }
    case 'mfrac': return `\\frac{${conv(c[0])}}{${conv(c[1])}}`;
    case 'msqrt': return `\\sqrt{${c.map(conv).join('')}}`;
    case 'mroot': return `\\sqrt[${conv(c[1])}]{${conv(c[0])}}`;
    case 'msup': return `${group(conv(c[0]))}^${group(conv(c[1]))}`;
    case 'msub': return `${group(conv(c[0]))}_${group(conv(c[1]))}`;
    case 'msubsup': return `${group(conv(c[0]))}_${group(conv(c[1]))}^${group(conv(c[2]))}`;
    case 'munder': case 'mover': case 'munderover': {
      const base = conv(c[0]);
      const trimmed = base.trim();
      if (tag === 'mover' && c[1] && ACCENTS[txt(c[1]).trim()]) return `${ACCENTS[txt(c[1]).trim()]}{${trimmed}}`;
      if (tag === 'munder' && /^lim$/i.test(trimmed)) return `\\lim_${group(conv(c[1]))}`;
      if (BIG.has(base) || /^\\(sum|prod|int|oint)/.test(trimmed)) {
        const lo = tag !== 'mover' && c[1] ? `_${group(conv(c[1]))}` : '';
        const hi = tag === 'mover' ? `^${group(conv(c[1]))}` : (tag === 'munderover' && c[2] ? `^${group(conv(c[2]))}` : '');
        return `${trimmed}${lo}${hi} `;
      }
      if (tag === 'munder') return `\\underset{${conv(c[1])}}{${trimmed}}`;
      if (tag === 'mover') return `\\overset{${conv(c[1])}}{${trimmed}}`;
      return `\\underset{${conv(c[1])}}{\\overset{${conv(c[2])}}{${trimmed}}}`;
    }
    case 'mfenced': {
      const open = attr(n, 'open') ?? '(';
      const close = attr(n, 'close') ?? ')';
      const sep = (attr(n, 'separators') ?? ',').trim().charAt(0) || ',';
      const f = (s) => (s === '{' ? '\\{' : s === '}' ? '\\}' : s);
      return `\\left${f(open) || '.'}${c.map(conv).join(sep)}\\right${f(close) || '.'}`;
    }
    case 'mtable': {
      const rows = c.filter((r) => /^m(labeled)?tr$/.test(nameOf(r))).map((r) => kids(r).filter((d) => nameOf(d) === 'mtd').map((d) => conv(d)).join(' & '));
      return `\\begin{matrix}${rows.join(' \\\\ ')}\\end{matrix}`;
    }
    case 'mtd': return c.map(conv).join('');
    default: return c.length ? c.map(conv).join('') : mapText(txt(n));
  }
}

export function mathmlToTex(node) {
  return conv(node).replace(/\s+/g, ' ').replace(/\s*([{}^_])\s*/g, '$1').trim();
}

// Textul unui fragment de document: paragrafe, titluri și rânduri de tabel pe
// rânduri separate, celulele cu „ | ", formulele între $…$, imaginile ca [figură].
const BLOCK = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'table', 'section', 'article', 'header', 'footer', 'ul', 'ol', 'br']);
export function domText(root) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.nodeType === 3) { out.push(String(n.textContent || n.nodeValue || '')); return; }
    if (!isEl(n)) return;
    const tag = nameOf(n);
    if (tag === 'style' || tag === 'script') return;
    if (tag === 'math') {
      const tex = mathmlToTex(n);
      if (tex) out.push(` $${tex}$ `);
      return;
    }
    if (tag === 'img' || tag === 'svg') { out.push(' [figură] '); return; }
    if (tag === 'br') { out.push('\n'); return; }
    const block = BLOCK.has(tag);
    if (block) out.push('\n');
    const ch = n.childNodes ? Array.from(n.childNodes) : [];
    ch.forEach((k, i) => {
      walk(k);
      if (tag === 'tr' && isEl(k) && /^t[dh]$/.test(nameOf(k)) && i < ch.length - 1) out.push(' | ');
    });
    if (block) out.push('\n');
  };
  walk(root);
  return out.join('')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/(?:\s*\|\s*)+\n/g, '\n')
    .replace(/\n{2,}/g, '\n')        // un rând pe paragraf / rând de tabel (ca docxText pe server)
    .trim();
}
