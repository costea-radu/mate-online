// api/_lib/pdftext.js — text din PDF (Buffer) pentru pipeline-urile OpenAI.
// elimină partea de BAREM dintr-un text-sursă (nu o preluăm la generare)
function cutBarem(text) {
  const m = String(text || '').search(/BAREM\s+DE\s+(EVALUARE|CORECTARE|NOTARE)/i);
  return m === -1 ? String(text || '') : String(text).slice(0, m);
}

async function pdfText(buf, cap = 4500) {
  try {
    const pdfParse = require('pdf-parse');
    const r = await pdfParse(buf, { max: 12 });
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
module.exports = { pdfText, storagePath, modeLine, cutBarem };
