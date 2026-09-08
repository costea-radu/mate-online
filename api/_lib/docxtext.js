// =====================================================================
// api/_lib/docxtext.js — textul dintr-un fișier Word (.docx), fără
// dependențe noi: un .docx este o arhivă ZIP, iar textul stă în
// `word/document.xml`. Citim directorul central al arhivei, dezarhivăm
// intrarea (deflate raw, prin zlib) și scoatem textul din XML păstrând
// paragrafele, tabelele și rândurile.
//
// Folosit de: api/ai-correct.js (action='docx_text') — profesorul încarcă
// fișa de lucru în Word la „Generează exerciții/teste”, iar AI-ul
// compune testul din exercițiile/teoria din ea.
//
// .doc (Word 97-2003, binar) NU e suportat — nu e o arhivă ZIP.
// =====================================================================
const zlib = require('zlib');

// ── ZIP: intrările din directorul central ────────────────────────────────────
// Semnături: EOCD 0x06054b50, central 0x02014b50, local 0x04034b50.
function findEocd(buf) {
  // comentariul final are max 65535 octeți → căutăm de la coadă
  const min = Math.max(0, buf.length - 65_557);
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

// Întoarce { name → Buffer } doar pentru intrările cerute (`wanted`).
function readZipEntries(buf, wanted) {
  const out = {};
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error('Fișierul nu pare a fi un document Word valid (.docx).');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16); // offsetul directorului central
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.slice(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted.includes(name)) continue;
    // antetul local are propriile lungimi pentru nume/extra
    if (buf.readUInt32LE(localOff) !== 0x04034b50) continue;
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const raw = buf.slice(start, start + compSize);
    try {
      out[name] = method === 0 ? raw : zlib.inflateRawSync(raw);
    } catch { /* intrare coruptă — o sărim */ }
  }
  return out;
}

// ── XML → text ──────────────────────────────────────────────────────────────
const unescapeXml = (s) => String(s)
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&amp;/g, '&');

// Păstrăm structura: paragraf → rând nou, celulă de tabel → „ | ”,
// rând de tabel → rând nou, salt de linie/pagină → rând nou.
function xmlToText(xml) {
  let s = String(xml || '');
  s = s.replace(/<w:tab\b[^>]*\/?>/g, '\t');
  s = s.replace(/<w:(?:br|cr)\b[^>]*\/?>/g, '\n');
  s = s.replace(/<\/w:p>/g, '\n');
  s = s.replace(/<\/w:tc>/g, ' | ');
  s = s.replace(/<\/w:tr>/g, '\n');
  // textul din <w:t> și din formulele OMML (<m:t>) rămâne; restul etichetelor dispar
  s = s.replace(/<[^>]+>/g, '');
  s = unescapeXml(s);
  return s
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    // celulele de tabel stau pe un rând: paragraful din celulă nu rupe rândul
    .replace(/\n[ \t]*\|/g, ' |')
    .replace(/(?:\s*\|\s*)+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ── API ─────────────────────────────────────────────────────────────────────
// docxText(Buffer, maxChars?) → textul documentului (antetele/subsolurile sunt
// ignorate intenționat: pe fișele de lucru conțin doar numele școlii).
function docxText(buf, maxChars = 20000) {
  if (!Buffer.isBuffer(buf)) throw new Error('Buffer așteptat.');
  if (buf.length < 4 || buf.readUInt16LE(0) !== 0x4b50) {
    // „PK” lipsă → .doc vechi, .rtf sau altceva
    throw new Error('Formatul nu e .docx. Salvează fișierul ca .docx (Word 2007+) sau ca PDF.');
  }
  const entries = readZipEntries(buf, ['word/document.xml']);
  const doc = entries['word/document.xml'];
  if (!doc) throw new Error('Nu am găsit textul în fișierul Word (arhivă incompletă?).');
  return xmlToText(doc.toString('utf8')).slice(0, maxChars);
}

module.exports = { docxText, xmlToText, readZipEntries };
