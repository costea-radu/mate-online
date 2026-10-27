// Vizualizatorul PDF (23 octombrie 2026):
//  · în bara de sus, „📋 Barem" (deschide baremul asociat, în locul subiectelor)
//    stă unde era „✍️ Spațiu de lucru";
//  · „✍️ Spațiu de lucru" e acum în antetul Profesorului Virtual și se deschide
//    ÎN zona de conversație: foaie ALBĂ, fără linii (27 oct.: și în fereastră).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('PDF: în bara de sus e „📋 Barem", nu mai e fereastra caietului peste PDF', () => {
  const src = read('src/pages/PDFViewer.jsx');
  assert.doesNotMatch(src, /import SpatiuDeLucru/);
  assert.doesNotMatch(src, /workBtn|workSheet/);
  assert.match(src, /'📋 Barem'/);
  assert.match(src, /\{baremBtn\}/);
  // în testul pe grupă și în duel butonul NU există: baremul ar fi răspunsurile
  assert.match(src, /const showBaremBtn = !modTest && /);
  // baremul separat: aceleași reguli de acces ca orice PDF (get-file-url; 403 → abonament)
  assert.match(src, /fetch\('\/api\/get-file-url'[\s\S]{0,200}contentId: b\.id/);
  assert.match(src, /e\.status === 403/);
  // baremul inclus în același PDF („subiecte + barem") → saltul la pagina lui
  assert.match(src, /findBaremPage\(pdfData\)/);
  // (din 27 oct.: adresa iframe-ului o face pdfFrameSrc — #page=N + coloana cu pagini)
  assert.match(src, /pdfFrameSrc\(blobUrl, \{ page: testJump \? testJump\.page : null, pagini \}\)/);
  assert.match(read('src/lib/pdfFrame.js'), /p\.push\(`page=\$\{page\}`\)/);
});

test('PDF: „✍️ Spațiu de lucru" e în antetul profesorului și se deschide în zona de conversație', () => {
  const src = read('src/pages/PDFViewer.jsx');
  assert.match(src, /'✍️ Spațiu de lucru'/);
  assert.match(src, /workspace=\{\{/);
  assert.match(src, /storageKey: isLib \? `pdf:lib:\$\{lib\?\.id \|\| 'material'\}` : `pdf:\$\{item\?\.id \|\| 'material'\}`/, 'aceeași ciornă ca înainte (materialele din bibliotecă au cheia lor)');
  // pe telefon antetul e mânerul de tras: butoanele lui nu pornesc tragerea
  // (altfel captura pointerului le lua clicul)
  assert.match(src, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);

  const chat = read('src/components/AITutor.jsx');
  assert.match(chat, /const wsOpen = !!\(workspace && workspace\.open\) && !boardMode;/);
  assert.match(chat, /\{wsOpen \? \(\s*<SpatiuDeLucru\s+embedded/);
  // în testul pe grupă rămâne doar ciorna (fără corectare și fără atașare)
  assert.match(chat, /onAttach=\{testActiv \? null : attachToQuestion\}/);
  assert.match(chat, /onCorect=\{testActiv \? null :/);
});

test('caietul din zona de conversație: foaie ALBĂ, fără linii și fără margine (ca și fereastra)', () => {
  const src = read('src/components/SpatiuDeLucru.jsx');
  assert.match(src, /export const SHEET_BG = '#ffffff';/);
  // liniile (gradientul repetat) și marginea roșie au dispărut cu totul
  assert.doesNotMatch(src, /repeating-linear-gradient/);
  assert.doesNotMatch(src, /#f0c9c9/);
  assert.match(src, /if \(embedded\) \{/);
  assert.match(src, /aria-label="Spațiu de lucru" style=\{\{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', position: 'relative', background: SHEET_BG \}\}/);
});
