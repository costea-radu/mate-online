// =====================================================================
// api/_lib/unzip.js — citirea arhivelor .zip (fără dependențe: zlib din Node)
//
// subiecte.edu.ro și edu.ro publică modelele și subiectele și ca arhive .zip
// (ex. „EN_VIII_2025_Matematica_model.zip": subiectul + baremul, în toate
// limbile). Botul de examene le despachetează în memorie și ia doar PDF-urile.
// Doar metodele „stored" (0) și „deflate" (8) — ce folosesc arhivele obișnuite;
// fără ZIP64 și fără criptare. Limite stricte (arhivă-bombă): număr de intrări,
// mărimea fiecărui fișier și totalul despachetat.
// =====================================================================
const zlib = require('node:zlib');

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

// numele din arhivă: UTF-8 (bitul 11) sau CP437 — pentru noi contează literele ASCII
function decodeName(buf, utf8) {
  if (utf8) return buf.toString('utf8');
  let s = '';
  for (const b of buf) s += b < 128 ? String.fromCharCode(b) : '_';
  return s;
}

// → [{ name, size, data: Buffer }] — doar fișierele (nu folderele) care trec `filter(name)`
function unzip(buf, { filter = () => true, maxEntries = 400, maxFile = 40 * 1024 * 1024, maxTotal = 150 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new Error('arhivă invalidă');
  // „End of central directory": în ultimii 22 + 65535 octeți
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) { eocd = i; break; }
  }
  if (eocd === -1) throw new Error('arhivă invalidă (fără director central)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error('arhivă ZIP64 — nu e suportată');
  if (count > maxEntries) throw new Error(`arhiva are prea multe fișiere (${count})`);
  const out = [];
  let total = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CEN) throw new Error('director central stricat');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const loc = buf.readUInt32LE(p + 42);
    const name = decodeName(buf.subarray(p + 46, p + 46 + nlen), (flags & 0x800) !== 0);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/') || /(^|\/)__MACOSX\//.test(name)) continue;
    if (!filter(name)) continue;
    if (flags & 0x1) continue;                                   // criptat
    if (usize > maxFile) continue;                               // prea mare — sărim
    if (loc + 30 > buf.length || buf.readUInt32LE(loc) !== SIG_LOC) continue;
    const start = loc + 30 + buf.readUInt16LE(loc + 26) + buf.readUInt16LE(loc + 28);
    const raw = buf.subarray(start, start + csize);
    let data;
    if (method === 0) data = Buffer.from(raw);
    else if (method === 8) {
      try { data = zlib.inflateRawSync(raw, { maxOutputLength: maxFile }); } catch { continue; }
    } else continue;
    total += data.length;
    if (total > maxTotal) throw new Error('arhiva despachetată e prea mare');
    out.push({ name, size: data.length, data });
  }
  return out;
}

// arhivă .zip mică, pentru teste (stored + deflate)
function makeZip(files) {
  const locals = [];
  const cens = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8');
    const data = Buffer.isBuffer(f.data) ? f.data : Buffer.from(String(f.data));
    const comp = f.store ? data : zlib.deflateRawSync(data);
    const method = f.store ? 0 : 8;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(SIG_LOC, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(SIG_CEN, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    cens.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cen = Buffer.concat(cens);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(SIG_EOCD, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cen.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cen, end]);
}

module.exports = { unzip, makeZip };
