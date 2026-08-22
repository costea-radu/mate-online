// api/_lib/pdftext.js — text din PDF (Buffer) pentru pipeline-urile OpenAI.
// elimină partea de BAREM dintr-un text-sursă (nu o preluăm la generare)
function cutBarem(text) {
  const m = String(text || '').search(/BAREM\s+DE\s+(EVALUARE|CORECTARE|NOTARE)/i);
  return m === -1 ? String(text || '') : String(text).slice(0, m);
}

// ── Asamblarea textului unei pagini, cu geometrie corectă ─────────────────────
// Extractorul implicit lipește elementele de pe același rând FĂRĂ spații și în
// ordinea din fișier (nu cea vizuală) → „x*y=5(x-1)(y-1)+1" ieșea terci, iar
// AI-ul citea greșit enunțurile. Aici: grupăm elementele pe RÂNDURI (după Y,
// cu toleranță), le ordonăm de la stânga la dreapta și punem spațiu doar unde
// există distanță reală între ele.
function linesFromTextContent(textContent) {
  const raw = [];
  for (const it of (textContent && textContent.items) || []) {
    if (!it || typeof it.str !== 'string' || !it.str.trim()) continue;
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    raw.push({ str: it.str, x: tr[4], y: tr[5], w: it.width || 0, size: Math.hypot(tr[0], tr[1]) || 10 });
  }
  // 1) micro-linii: itemii cu același Y (toleranță mică)
  const lines = [];
  for (const it of raw) {
    let ln = null;
    for (const l of lines) { if (Math.abs(l.y - it.y) < 2.2) { ln = l; break; } }
    if (!ln) { ln = { y: it.y, items: [] }; lines.push(ln); }
    ln.items.push(it);
  }
  lines.sort((a, b) => b.y - a.y); // de sus în jos

  // 2a) SĂGEȚI DE VECTOR (Word/MathType): săgeata de deasupra literelor din
  //     $\vec{AB}$ ajunge în text ca glife separate — „r" (vârful) precedat de
  //     „u"-uri (tija): „ur", „uur", „uuur" — pe o micro-linie proprie, cu
  //     câțiva pt deasupra literelor. Fără pasul acesta săgeata se pierdea sau
  //     devenea fals „exponent", iar „vectorii AB și DC sunt egali" se citea
  //     „lungimile AB și DC sunt egale" — greșeală de matematică. Aici:
  //     recunoaștem micro-linia-săgeată, o consumăm și împachetăm literele de
  //     sub ea în \vec{...}, ca AI-ul să vadă explicit că sunt vectori.
  // Pe un rând pot sta MAI MULTE săgeți (ex. deasupra lui „AB = DC" stau două),
  // deci lucrăm pe SERII de glife adiacente, nu pe linia întreagă.
  const isArrowText = (s) => /^(?:u{1,6}r|→|⇀|⃗)$/.test(s);
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!L || !L.items.length) continue;
    const base = lines[i + 1] || null; // rândul imediat de sub potențiala săgeată
    if (!base || !base.items.length) continue;
    const gap = L.y - base.y;
    if (gap < 1.2 || gap > 9) continue; // săgeata stă cu doar câțiva pt deasupra literelor
    // seriile de glife-săgeată de pe rândul L (itemi adiacenți din doar u/r/→)
    const sorted = [...L.items].sort((a, b) => a.x - b.x);
    const runs = [];
    let run = null;
    for (const it of sorted) {
      const s = it.str.replace(/\s+/g, '').toLowerCase();
      const glyph = /^(?:u{1,6}r?|r|[→⇀⃗]+)$/.test(s) && s.length > 0;
      if (glyph) {
        if (run && it.x - run.xend < 6) { run.items.push(it); run.text += s; run.xend = it.x + (it.w || 0); }
        else { run = { items: [it], text: s, xmin: it.x, xend: it.x + (it.w || 0) }; runs.push(run); }
      } else { run = null; }
    }
    let consumed = false;
    for (const r of runs) {
      const singleR = r.text === 'r'; // vârf fără tijă (vector scurt) — cere verificări în plus
      if (!isArrowText(r.text) && !singleR) continue;
      // literele acoperite de săgeată (suprapunere pe orizontală)
      const hit = base.items
        .filter((it) => !it.sup && !it.sub && it.x < r.xend + 1.5 && it.x + (it.w || 0) > r.xmin - 1.5)
        .sort((a, b) => a.x - b.x);
      while (hit.length && !/^[A-Za-z]{1,4}$/.test(hit[0].str.trim())) hit.shift();
      while (hit.length && !/^[A-Za-z]{1,4}$/.test(hit[hit.length - 1].str.trim())) hit.pop();
      if (singleR) {
        // doar „r": acceptăm numai deasupra unor litere mari (AB, MN...) și doar
        // dacă săgeata le ACOPERĂ de la stânga (exponentul x^r stă în dreapta-sus)
        if (!hit.length || !hit.every((it) => /^[A-Z]{1,3}$/.test(it.str.trim())) || r.xmin > hit[0].x + (hit[0].w || 0) * 0.5) continue;
      }
      if (hit.length) {
        hit[0].str = '\\vec{' + hit[0].str.trim();
        hit[hit.length - 1].str = hit[hit.length - 1].str.trim() + '}';
      } else if (!/^u{2,6}r$/.test(r.text)) {
        continue; // fără bază și fără tijă clară — nu consumăm nimic
      }
      r.items.forEach((it) => { it._arrow = true; });
      consumed = true;
    }
    if (consumed) {
      L.items = L.items.filter((it) => !it._arrow);
      if (!L.items.length) { lines.splice(i, 1); i -= 1; }
    }
  }

  // 2b) FRACȚII ETAJATE (Word/MathType): „a supra 3" ajunge în text ca item
  //     „a" cu câțiva pt DEASUPRA liniei de bază și „3" cu câțiva pt SUB ea
  //     (bara e desenată vectorial — invizibilă la extragere). Pasul de
  //     exponenți/indici le transforma greșit în „^{a}_{3}", iar AI-ul citea
  //     „a/3 = b/4 = 5" drept „a³ = b⁴ = 5" — numitorul ajungea la putere și
  //     profesorul virtual explica alt exercițiu. Aici: perechea numărător
  //     (deasupra) + numitor (dedesubt), suprapuse pe orizontală și cu rândul
  //     de bază liber în dreptul lor, devine explicit \frac{...}{...}.
  const runsOf = (line) => {
    const sorted = [...line.items].sort((a, b) => a.x - b.x);
    const runs = [];
    let run = null;
    for (const it of sorted) {
      const xend = it.x + (it.w || 0);
      if (run && it.x - run.xend < 6.5) { run.items.push(it); run.xend = Math.max(run.xend, xend); }
      else { run = { items: [it], xmin: it.x, xend }; runs.push(run); }
    }
    for (const r of runs) {
      r.text = '';
      let last = null;
      for (const it of r.items) {
        if (last != null && it.x - last > 1.5 && r.text && !r.text.endsWith(' ')) r.text += ' ';
        r.text += it.str;
        last = Math.max(last == null ? -Infinity : last, it.x + (it.w || 0));
      }
      r.text = r.text.trim();
      r.size = Math.max(...r.items.map((it) => it.size || 0));
    }
    return runs;
  };
  // A = rândul numărătorului, C = al numitorului; între ele stă LINIA DE BAZĂ
  // a textului (cu „=", virgule etc.) și, uneori, încă o micro-linie (un
  // indice de pe același rând). Cerem 1–2 rânduri între A și C, toate LIBERE
  // în dreptul barei — două rânduri obișnuite de text nu au niciodată un al
  // treilea între ele, deci textul normal nu poate fi confundat cu o fracție.
  const fracRun = (r) => !r.items.some((it) => it._frac || it._syn) && r.text.length <= 14
    && r.xend - r.xmin <= 100 && /[0-9A-Za-z]/.test(r.text);
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 2; j <= i + 3 && j < lines.length; j++) {
      const A = lines[i], C = lines[j];
      if (!A.items.length || !C.items.length) continue;
      const between = lines.slice(i + 1, j).filter((l) => l.items.length);
      if (!between.length) continue;
      const vGap = A.y - C.y;
      if (vGap < 3.6 || vGap > 26) continue;
      const runsA = runsOf(A), runsC = runsOf(C);
      let consumed = false;
      for (const rA of runsA) {
        if (!fracRun(rA)) continue;
        for (const rC of runsC) {
          if (!fracRun(rC)) continue;
          // suprapunere pe orizontală (numărătorul stă peste numitor)
          const cA = (rA.xmin + rA.xend) / 2, cC = (rC.xmin + rC.xend) / 2;
          const wMax = Math.max(rA.xend - rA.xmin, rC.xend - rC.xmin);
          if (Math.abs(cA - cC) > Math.max(6, wMax * 0.6)) continue;
          if (Math.min(rA.xend, rC.xend) - Math.max(rA.xmin, rC.xmin) < -2) continue;
          // distanța pe verticală trebuie să fie de fracție, nu de rânduri de tabel
          if (vGap > 2.2 * Math.max(rA.size, rC.size) + 1) continue;
          const xmin = Math.min(rA.xmin, rC.xmin) - 1, xmax = Math.max(rA.xend, rC.xend) + 1;
          // rândul de bază = cel mai apropiat de mijlocul fracției, la 1.5pt+
          // de fiecare parte (numărătorul și numitorul nu stau PE linia de bază)
          const midY = (A.y + C.y) / 2;
          const base = [...between].sort((a, b) => Math.abs(a.y - midY) - Math.abs(b.y - midY))[0];
          if (A.y - base.y < 1.5 || base.y - C.y < 1.5) continue;
          if (A.y - base.y > 13 || base.y - C.y > 13) continue; // prea departe de linia de bază
          // NU e fracție dacă perechea stă lipită de o literă de bază în stânga:
          // acela e „x" cu indice ȘI exponent (x₁²), nu numărător/numitor.
          const attached = base.items.some((it) => {
            const d = xmin + 1 - (it.x + (it.w || 0));
            return d > -0.5 && d < 1.3 && /[0-9A-Za-zăâîșțĂÂÎȘȚ)\]]$/.test(it.str.trim());
          });
          if (attached) continue;
          // în dreptul barei, rândurile dintre A și C trebuie să fie libere
          // (sau să conțină doar bara desenată ca text: „—", „_", „─")
          const inSpan = [], bars = [];
          for (const l of between) {
            for (const it of l.items) {
              if (it.x < xmax && it.x + (it.w || 0) > xmin) {
                inSpan.push(it);
                if (/^[\s\-–—_─﹘¯]+$/.test(it.str)) bars.push(it);
              }
            }
          }
          if (inSpan.length !== bars.length) continue;
          // ── e fracție: o rescriem ca \frac{num}{den} pe rândul de bază ──
          rA.items.forEach((it) => { it._frac = true; });
          rC.items.forEach((it) => { it._frac = true; });
          bars.forEach((it) => { it._frac = true; });
          base.items.push({
            str: '\\frac{' + rA.text + '}{' + rC.text + '}',
            x: xmin + 1, w: xmax - xmin - 2,
            y: base.y, size: Math.max(rA.size, rC.size), _syn: true,
          });
          consumed = true;
          break;
        }
      }
      if (consumed) {
        for (const l of [A, C, ...between]) l.items = l.items.filter((it) => !it._frac);
      }
    }
  }
  // rândurile golite de fracții dispar
  for (let i = lines.length - 1; i >= 0; i--) { if (!lines[i].items.length) lines.splice(i, 1); }

  // 2) EXPONENȚI și INDICI: o micro-linie măruntă („2", „n"...) aflată cu
  //    2–6pt deasupra unui rând este exponentul lui → „^{2}"; cu 2–6pt sub
  //    rând este indice → „_{1}". Fără pasul acesta, „(x1x2x3x4)^2" și „m^2"
  //    își pierdeau puterea a 2-a (exponentul cădea pe rând separat), iar
  //    AI-ul citea greșit și testul, și baremul.
  const metaOf = (l) => {
    let xmin = Infinity, xmax = -Infinity, maxLen = 0, size = 0;
    for (const i of l.items) {
      xmin = Math.min(xmin, i.x); xmax = Math.max(xmax, i.x + (i.w || 0));
      maxLen = Math.max(maxLen, i.str.trim().length); size = Math.max(size, i.size);
    }
    return { xmin, xmax, maxLen, size, n: l.items.length };
  };
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    if (!L || !L.items.length) continue;
    const m = metaOf(L);
    if (!(m.maxLen <= 3 && m.n <= 6)) continue; // doar fragmente mărunte (2, n, ...)
    const below = lines[i + 1] || null, above = lines[i - 1] || null;
    const gapBelow = below ? L.y - below.y : Infinity;
    const gapAbove = above ? above.y - L.y : Infinity;
    const fits = (T) => {
      const t = metaOf(T);
      return m.xmin >= t.xmin - 4 && m.xmin <= t.xmax + 30 && m.size <= t.size * 1.05;
    };
    if (below && gapBelow >= 2.2 && gapBelow <= 6 && fits(below)) {
      L.items.forEach((it) => { it.sup = true; below.items.push(it); }); // exponent
      lines.splice(i, 1); i -= 1; continue;
    }
    if (above && gapAbove >= 2.2 && gapAbove <= 6 && fits(above)) {
      L.items.forEach((it) => { it.sub = true; above.items.push(it); }); // indice
      lines.splice(i, 1); i -= 1; continue;
    }
  }

  // 3) redare: în fiecare rând, de la stânga la dreapta, cu spații doar unde
  //    există distanță reală; exponenții/indicii se lipesc de baza lor
  return lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x);
    let out = '', lastEnd = null;
    for (const it of l.items) {
      const s = it.sup ? '^{' + it.str.trim() + '}' : it.sub ? '_{' + it.str.trim() + '}' : it.str;
      if (!it.sup && !it.sub && lastEnd != null && it.x - lastEnd > 1.5 && out && !out.endsWith(' ')) out += ' ';
      out += s;
      lastEnd = Math.max(lastEnd == null ? -Infinity : lastEnd, it.x + (it.w || 0));
    }
    // glife pe care fontul PDF nu le mapează la caractere reale (apar ca „□"
    // sau caractere private) — le eliminăm; la fel exponenții/indicii rămași
    // goi după curățare. Altfel elevul vedea „□^{□}" în răspunsuri.
    out = out
      .replace(/[\uE000-\uF8FF\uFFFD\u25A1\u25AF]/g, '') // glife nemapate: zona privată a fontului, „�", „□", „▯"
      .replace(/[\^_]\{\s*\}/g, '');
    // săgeți de vector scăpate pasului 2a (grupate pe același rând ori devenite
    // fals „exponent"): „AB uuur" / „uuur AB" / „AB^{uur}" → \vec{AB}; resturile
    // de tijă fără bază identificabilă se elimină (sunt doar zgomot).
    out = out
      .replace(/([A-Za-z]{1,3})\s*\^\{u{1,6}r\}/g, '\\vec{$1}')
      .replace(/\b([A-Z]{1,3})\s*u{2,6}r\b/g, '\\vec{$1}')
      .replace(/\bu{2,6}r\s*([A-Z]{1,3})\b/g, '\\vec{$1}')
      .replace(/\s*\bu{2,6}r\b/g, '');
    return out.replace(/\s+/g, ' ').trim();
  }).filter(Boolean).join('\n');
}

// pagerender pentru pdf-parse (folosește asamblarea de mai sus)
function pageRenderer(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
    .then((tc) => linesFromTextContent(tc));
}

// Datele pentru pdf-parse: o COPIE Uint8Array. Un Buffer mic (< 4 KB) din
// Node e o felie dintr-un slab comun de 8 KB; pdf.js (v1.10 din pdf-parse)
// folosește `.buffer` întreg → „bad XRef entry" pe PDF-uri mici. Copia evită asta.
function toPdfData(buf) {
  if (buf instanceof Uint8Array && !Buffer.isBuffer(buf) && buf.byteOffset === 0 && buf.byteLength === buf.buffer.byteLength) return buf;
  return new Uint8Array(buf);
}
async function pdfText(buf, cap = 4500) {
  try {
    const pdfParse = require('pdf-parse');
    const r = await pdfParse(toPdfData(buf), { max: 12, pagerender: pageRenderer });
    return cutBarem(String(r.text || '')).replace(/\s+/g, ' ').trim().slice(0, cap);
  } catch (e) { console.warn('pdf-parse:', e.message); return ''; }
}
// desparte bucket/cale dintr-un URL public Supabase
function storagePath(fileUrl) {
  const url = new URL(fileUrl);
  const seg = url.pathname.split('/');
  const oi = seg.findIndex((x) => x === 'object');
  return { bucket: seg[oi + 2], filePath: seg.slice(oi + 3).join('/').split('?')[0] };
}
const MODE_KEEP = 'PĂSTREAZĂ DATELE PROBLEMELOR: copiază itemii-sursă EXACT, cu aceleași numere, valori și notații — doar transcrii/convertești formatul, fără nicio modificare de conținut.';
const MODE_MODIFY = 'MODIFICĂ NUMERELE ȘI NOTAȚIILE față de surse și RECALCULEAZĂ tot (rezultat, variante greșite, barem). VERIFICĂ de două ori fiecare calcul — aici se greșește ușor!';
const modeLine = (dataMode) => (dataMode === 'keep' ? MODE_KEEP : MODE_MODIFY);
module.exports = { pdfText, storagePath, modeLine, cutBarem, pageRenderer, linesFromTextContent, toPdfData };
