// Vizualizatorul PDF (23 octombrie 2026):
//  · în bara de sus, „📋 Barem" (deschide baremul asociat, în locul subiectelor)
//    stă unde era „✍️ Spațiu de lucru";
//  · „✍️ Spațiu de lucru" e acum în antetul Profesorului Virtual și se deschide
//    ÎN zona de conversație: foaie goală, cu fundalul conversației, fără linii.
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
  assert.match(src, /#page=\$\{testJump\.page\}/);
});

test('PDF: „✍️ Spațiu de lucru" e în antetul profesorului și se deschide în zona de conversație', () => {
  const src = read('src/pages/PDFViewer.jsx');
  assert.match(src, /'✍️ Spațiu de lucru'/);
  assert.match(src, /workspace=\{\{/);
  assert.match(src, /storageKey: `pdf:\$\{item\?\.id \|\| 'material'\}`/, 'aceeași ciornă ca înainte');
  // pe telefon antetul e mânerul de tras: butoanele lui nu pornesc tragerea
  // (altfel captura pointerului le lua clicul)
  assert.match(src, /onPointerDown=\{\(e\) => e\.stopPropagation\(\)\}/);

  const chat = read('src/components/AITutor.jsx');
  assert.match(chat, /const wsOpen = !!\(workspace && workspace\.open\) && !boardMode;/);
  assert.match(chat, /\{wsOpen \? \(\s*<SpatiuDeLucru\s+embedded/);
  // în testul pe grupă rămâne doar ciorna (+ „📋 Copiază")
  assert.match(chat, /onInsert=\{testActiv \? null :/);
  assert.match(chat, /onCorect=\{testActiv \? null :/);
});

test('caietul din zona de conversație: fundalul conversației, fără linii și fără margine', () => {
  const src = read('src/components/SpatiuDeLucru.jsx');
  const chat = read('src/components/AITutor.jsx');
  assert.match(src, /const ZONE_BG = '#f7f9fc';/);
  assert.match(chat, /background: '#f7f9fc'/, 'zona de conversație are același fundal');
  // liniile (gradientul repetat) și marginea roșie rămân doar în fereastră
  assert.match(src, /\{!embedded && \(\s*<>\s*<div aria-hidden style=\{\{\s*position: 'absolute', inset: 0,\s*backgroundImage: `repeating-linear-gradient/);
  assert.match(src, /background: embedded \? ZONE_BG : '#fdfdf8'/);
  assert.match(src, /if \(embedded\) \{/);
});
