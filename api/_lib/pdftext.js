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
  const lines = [];
  for (const it of (textContent && textContent.items) || []) {
    if (!it || typeof it.str !== 'string') continue;
    const y = it.transform ? it.transform[5] : 0;
    const x = it.transform ? it.transform[4] : 0;
    let ln = null;
    for (const l of lines) { if (Math.abs(l.y - y) < 2.5) { ln = l; break; } }
    if (!ln) { ln = { y, items: [] }; lines.push(ln); }
    ln.items.push({ x, str: it.str, w: it.width || 0 });
  }
  lines.sort((a, b) => b.y - a.y); // de sus în jos
  return lines.map((l) => {
    l.items.sort((a, b) => a.x - b.x); // de la stânga la dreapta
    let out = '', lastEnd = null;
    for (const it of l.items) {
      if (lastEnd != null && it.x - lastEnd > 1.5 && out && !out.endsWith(' ')) out += ' ';
      out += it.str;
      lastEnd = it.x + (it.w || 0);
    }
    return out.replace(/\s+/g, ' ').trim();
  }).filter(Boolean).join('\n');
}

// pagerender pentru pdf-parse (folosește asamblarea de mai sus)
function pageRenderer(pageData) {
  return pageData.getTextContent({ normalizeWhitespace: true, disableCombineTextItems: false })
    .then((tc) => linesFromTextContent(tc));
}

async function pdfText(buf, cap = 4500) {
  try {
    const pdfParse = require('pdf-parse');
    const r = await pdfParse(buf, { max: 12, pagerender: pageRenderer });
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
module.exports = { pdfText, storagePath, modeLine, cutBarem, pageRenderer, linesFromTextContent };
