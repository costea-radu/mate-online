// Teste pentru citirea fișierelor Word (.docx) încărcate de profesor la
// „Generează exerciții/teste" (api/_lib/docxtext.js). Un .docx e o arhivă ZIP
// cu textul în word/document.xml — îl construim aici cu zlib, fără dependențe.
const test = require('node:test');
const assert = require('node:assert');
const zlib = require('zlib');
const { docxText, xmlToText } = require('../api/_lib/docxtext');

// ── un .docx minimal, valid: o singură intrare, deflate raw ─────────────────
function makeDocx(documentXml, { store = false } = {}) {
  const name = Buffer.from('word/document.xml', 'utf8');
  const content = Buffer.from(documentXml, 'utf8');
  const comp = store ? content : zlib.deflateRawSync(content);
  const crc = 0; // nefolosit la citire
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(store ? 0 : 8, 8);       // metoda
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(comp.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(name.length, 26);
  const localBlock = Buffer.concat([local, name, comp]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(store ? 0 : 8, 10);    // metoda
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(comp.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(0, 42);                // offsetul intrării locale
  const centralBlock = Buffer.concat([central, name]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);                    // intrări pe acest disc
  eocd.writeUInt16LE(1, 10);                   // intrări în total
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16);   // offsetul directorului central
  return Buffer.concat([localBlock, centralBlock, eocd]);
}

const XML = `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>
<w:p><w:r><w:t>Fișă de lucru: ecuații</w:t></w:r></w:p>
<w:p><w:r><w:t>1. Rezolvați </w:t></w:r><w:r><w:t>2x + 3 = 11</w:t></w:r><w:tab/><w:r><w:t>(2p)</w:t></w:r></w:p>
<w:p><w:r><w:t>2. a &lt; b și a &amp; b</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>x</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>y</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`;

test('docxText citește textul unui .docx (arhivă deflate)', () => {
  const text = docxText(makeDocx(XML));
  assert.match(text, /Fișă de lucru: ecuații/);
  assert.match(text, /1\. Rezolvați 2x \+ 3 = 11\t\(2p\)/); // fragmentele aceluiași rând se lipesc
  assert.ok(!text.includes('<w:'), 'nu rămân etichete XML');
});

test('docxText citește și intrările nedeflatate (stored)', () => {
  assert.match(docxText(makeDocx(XML, { store: true })), /Fișă de lucru/);
});

test('entitățile XML se decodifică corect (& după < și >)', () => {
  assert.match(docxText(makeDocx(XML)), /2\. a < b și a & b/);
});

test('celulele de tabel rămân pe un rând, separate prin |', () => {
  assert.match(docxText(makeDocx(XML)), /^x \| y$/m);
});

test('paragrafele și saltul de linie devin rânduri noi', () => {
  const t = xmlToText('<w:p><w:r><w:t>A</w:t><w:br/><w:t>B</w:t></w:r></w:p><w:p><w:r><w:t>C</w:t></w:r></w:p>');
  assert.strictEqual(t, 'A\nB\nC');
});

test('un fișier care nu e ZIP (.doc vechi) dă eroare clară, nu text aiurea', () => {
  assert.throws(() => docxText(Buffer.from('\xD0\xCF\x11\xE0 continut binar Word 97', 'binary')),
    /nu e \.docx/i);
});

test('limita maxChars se respectă', () => {
  const long = `<w:p><w:r><w:t>${'a'.repeat(5000)}</w:t></w:r></w:p>`;
  assert.strictEqual(docxText(makeDocx(`<w:document><w:body>${long}</w:body></w:document>`), 100).length, 100);
});
