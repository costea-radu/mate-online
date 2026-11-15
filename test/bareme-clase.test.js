// =====================================================================
// test/bareme-clase.test.js — „📋 Bareme" la fiecare clasă (15 nov. 2026):
//   „Adaugă, la fiecare clasă (a V-a…a XII-a), o secțiune nouă «📋 Bareme» (…)
//    1. arată toate baremele existente pentru exercițiile/fișele clasei (…)
//    2. adminul poate lega manual un barem de un exercițiu de clasă (…)
//    3. o dată legat, baremul trebuie folosit automat de corectarea existentă (…)
//    4. respectă regula botului: nu rescrie o legătură pusă deja manual de admin.
//    (…) implementează mai întâi varianta vizibilă ca referință, ușor de ascuns
//    dintr-un flag."
//
// api/bareme.js (secțiunea, legăturile, setarea „vizibilă elevilor"),
// api/ai-pdf-context.js (corectarea citește legătura — getPdfContext),
// api/_lib/barem.js (potrivirea după titlu și numele fișierului),
// api/_lib/planPregatire.js (fișa cu barem intră în harta PDF a clasei),
// src/components/BaremeClasa.jsx + ContentPage.jsx + ClassPage.jsx (fila).
// Fără rețea: PDF-uri reale (pdf-lib) în Storage-ul fals.
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const ai = require('../api/_lib/ai');
const B = require('../api/_lib/barem');
const PL = require('../api/_lib/planPregatire');
const PDF = require('../api/ai-pdf-context');
const handler = require('../api/bareme');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const FAKE = 'https://fake.supabase/storage/v1/object/public/';
const ADMIN = '99999999-9999-4999-8999-999999999999';
const ELEV = 'eeeeeeee-0000-4000-8000-000000000001';
const ID = {
  f13: 'c6000000-0000-4000-8000-000000000013', f14: 'c6000000-0000-4000-8000-000000000014',
  tr: 'c6000000-0000-4000-8000-0000000000a1', rec: 'c6000000-0000-4000-8000-0000000000a2',
  b13: 'c6000000-0000-4000-8000-0000000000b3', b14: 'c6000000-0000-4000-8000-0000000000b4', btr: 'c6000000-0000-4000-8000-0000000000b5',
  borf: 'c6000000-0000-4000-8000-0000000000b6', c7b: 'c7000000-0000-4000-8000-0000000000b1',
};

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E\n]/g, ' ');
async function pdfOf(text) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  let y = 800;
  for (const l of strip(text).split('\n')) { page.drawText(l.slice(0, 110), { x: 36, y, size: 10, font }); y -= 14; }
  return Buffer.from(await doc.save());
}

const row = (id, title, file, o = {}) => ({
  id, title, category: 'clasa-6', subcategory: null, content_type: 'pdf', is_free: true,
  file_url: `${FAKE}content-files-free/pdf/clasa-6/${file}`, sort_order: 1, created_at: '2026-10-01T10:00:00Z', ...o,
});
let FILES = null;
async function baza({ vizibil = null, legaturi = [] } = {}) {
  if (!FILES) {
    FILES = {
      f13: await pdfOf('Fisa 13. Numere intregi\n1. Calculati -7 + 12.\n2. Comparati -15 si -9.'),
      f14: await pdfOf('Fisa 14. Numere intregi\n1. Calculati (-3) x 4.'),
      b13: await pdfOf('BAREM fisa 13 numere intregi\n1. -7 + 12 = 5 (5p)\n2. -15 < -9 (5p)'),
      b14: await pdfOf('BAREM fisa 14 numere intregi\n1. (-3) x 4 = -12 (5p)'),
      tr: await pdfOf('Triunghiul - fisa 2\n1. Aflati masura unghiului.'),
    };
  }
  const supa = createFakeSupabase({
    profiles: [{ id: ADMIN, is_admin: true, role: 'profesor' }, { id: ELEV, is_admin: false, role: 'elev' }],
    content: [
      row(ID.f13, 'Numere întregi — fișa 13', '1700000000013_Fisa_13.pdf', { sort_order: 1 }),
      row(ID.tr, 'Triunghiul — fișa 2', '1700000000021_triunghi.pdf', { sort_order: 2, is_free: false, file_url: `${FAKE}content-files/pdf/clasa-6/1700000000021_triunghi.pdf` }),
      row(ID.f14, 'Numere întregi — fișa 14', '1700000000014_Fisa_14.pdf', { sort_order: 3 }),
      row(ID.rec, 'Recapitulare finală', '1700000000030_recap.pdf', { sort_order: 4 }),
      // baremele clasei: după titlu, după numele fișierului, unul legat manual, unul fără fișă
      row(ID.b13, 'Barem — Numere întregi — fișa 13', '1700000000113_barem_13.pdf', { sort_order: 9 }),
      row(ID.b14, 'Barem fișa 14', '1700000000114_Barem_Numere_intregi_fisa_14.pdf', { sort_order: 9 }),
      row(ID.btr, 'Barem — Triunghiul (set A)', '1700000000115_barem_tr.pdf', { sort_order: 9 }),
      row(ID.borf, 'Barem — Cercul', '1700000000116_barem_cerc.pdf', { sort_order: 9 }),
      { ...row(ID.c7b, 'Barem — Teorema lui Thales', '1700000000117_b.pdf'), category: 'clasa-7', file_url: `${FAKE}content-files-free/pdf/clasa-7/1700000000117_b.pdf` },
    ],
    ai_pdf_text: legaturi.map((l) => ({ text: '', barem_status: 'negasit', updated_at: '2026-11-15T08:00:00Z', ...l })),
    app_settings: vizibil == null ? [] : [{ key: 'bareme_clase', value: { vizibil }, updated_at: '2026-11-15T08:00:00Z' }],
  });
  supa.db.files.set('content-files-free/pdf/clasa-6/1700000000013_Fisa_13.pdf', FILES.f13);
  supa.db.files.set('content-files-free/pdf/clasa-6/1700000000014_Fisa_14.pdf', FILES.f14);
  supa.db.files.set('content-files-free/pdf/clasa-6/1700000000113_barem_13.pdf', FILES.b13);
  supa.db.files.set('content-files-free/pdf/clasa-6/1700000000114_Barem_Numere_intregi_fisa_14.pdf', FILES.b14);
  supa.db.files.set('content-files/pdf/clasa-6/1700000000021_triunghi.pdf', FILES.tr);
  return supa;
}

// apelul endpointului: cont = ADMIN | ELEV | null (vizitator)
let CINE = null;
const vechi = { admin: ai.admin, authUser: ai.authUser };
const realFetch = global.fetch;
test.before(() => {
  ai.authUser = async () => { if (!CINE) { const e = new Error('Neautentificat'); e.status = 401; throw e; } return CINE; };
  global.fetch = async () => { throw new Error('rețea oprită în teste'); };   // PDF-urile vin din Storage-ul fals
});
test.after(() => { ai.admin = vechi.admin; ai.authUser = vechi.authUser; global.fetch = realFetch; });
async function call(supa, cine, body) {
  ai.admin = () => supa;
  CINE = cine;
  const res = fakeRes();
  await handler({ method: 'POST', headers: cine ? { authorization: 'Bearer x' } : {}, body }, res);
  return res;
}
const intrari = (r) => (r.body.capitole || []).flatMap((c) => c.intrari.map((x) => ({ cap: c.titlu, ...x })));
const deFisa = (r, id) => intrari(r).find((x) => x.fisa && x.fisa.id === id);
const at = (supa, id) => supa.db.tables.ai_pdf_text.find((x) => x.content_id === id);

// ═══════════════════════════ 1) secțiunea: elevul, adminul, setarea ═══════════════════════════

test('elevul (și vizitatorul): doar baremele, pe capitole, cu fișa lor; fișele fără barem nu apar; baremele fără fișă — la capitolul din titlu', async () => {
  const supa = await baza({ legaturi: [{ content_id: ID.tr, file_url: row(ID.tr, '', '').file_url, barem_override_id: ID.btr, barem_override_by: 'admin' }] });
  for (const cine of [null, ELEV]) {
    const r = await call(supa, cine, { action: 'clasa', category: 'clasa-6' });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.vizibil, r.body.admin, r.body.clasa], [true, false, 'a VI-a']);
    const x = intrari(r);
    assert.deepStrictEqual(x.map((y) => [y.cap, y.fisa && y.fisa.id, y.barem.id]), [
      ['Triunghiul', ID.tr, ID.btr],                    // legat de admin
      ['Numere întregi', null, ID.b13],                 // propunerile după titlu NU le vede elevul ca legate
      ['Numere întregi', null, ID.b14],
      ['Cercul', null, ID.borf],
    ]);
    assert.ok(!x.some((y) => y.propunere), 'fără propuneri la elev');
    assert.ok(!('bareme' in r.body), 'lista de alegere e doar pentru admin');
    assert.deepStrictEqual(r.body.stats, { fise: 4, cuBarem: 1, bareme: 4, propuneri: 0 });
  }
});

test('adminul: toate fișele, cine a legat baremul, 💡 propunerile după titlu (și după numele fișierului), lista de bareme', async () => {
  const supa = await baza({ legaturi: [{ content_id: ID.tr, file_url: row(ID.tr, '', '').file_url, barem_override_id: ID.btr, barem_override_by: 'bot' }] });
  const r = await call(supa, ADMIN, { action: 'clasa', category: 'clasa-6' });
  assert.strictEqual(r.body.admin, true);
  assert.deepStrictEqual(deFisa(r, ID.f13).propunere.id, ID.b13, 'după titlu');
  assert.deepStrictEqual(deFisa(r, ID.f14).propunere.id, ID.b14, 'după numele fișierului „Barem_Numere_intregi_fisa_14"');
  assert.deepStrictEqual([deFisa(r, ID.tr).barem.cum, deFisa(r, ID.tr).manual, deFisa(r, ID.tr).barem.deVerificat], ['bot', true, false]);
  assert.strictEqual(deFisa(r, ID.rec).barem, null);
  assert.strictEqual(deFisa(r, ID.rec).cap, 'Alte fișe', '„Alte fișe" la sfârșit');
  assert.strictEqual(r.body.capitole[r.body.capitole.length - 1].titlu, 'Alte fișe');
  assert.deepStrictEqual(r.body.bareme.map((b) => [b.id, b.folosit]), [[ID.b13, 0], [ID.b14, 0], [ID.btr, 1], [ID.borf, 0]]);
  assert.deepStrictEqual(r.body.stats, { fise: 4, cuBarem: 1, bareme: 4, propuneri: 2 });
  // un marcaj necunoscut (de ex. un task care generează bareme) apare „de verificat"
  at(supa, ID.tr).barem_override_by = 'scheduled-task';
  const r2 = await call(supa, ADMIN, { action: 'clasa', category: 'clasa-6' });
  assert.deepStrictEqual([deFisa(r2, ID.tr).barem.cum, deFisa(r2, ID.tr).barem.deVerificat], ['scheduled-task', true]);
});

test('setarea „vizibilă elevilor": ascunsă → elevul primește doar { vizibil: false }; adminul vede tot și o poate schimba', async () => {
  const supa = await baza({ vizibil: false });
  let r = await call(supa, ELEV, { action: 'clasa', category: 'clasa-6' });
  assert.deepStrictEqual([r.body.vizibil, r.body.capitole.length, r.body.stats], [false, 0, null]);
  r = await call(supa, ADMIN, { action: 'clasa', category: 'clasa-6' });
  assert.ok(r.body.capitole.length > 0 && r.body.vizibil === false);
  r = await call(supa, ELEV, { action: 'vizibil', vizibil: true });
  assert.strictEqual(r.statusCode, 403, 'doar adminul');
  r = await call(supa, ADMIN, { action: 'vizibil', vizibil: true, category: 'clasa-6' });
  assert.strictEqual(r.body.vizibil, true);
  assert.deepStrictEqual(supa.db.tables.app_settings.find((x) => x.key === 'bareme_clase').value, { vizibil: true });
  // fără setare (tabela goală): implicit vizibilă, ca referință
  const s2 = await baza();
  assert.strictEqual((await call(s2, null, { action: 'clasa', category: 'clasa-6' })).body.vizibil, true);
  assert.strictEqual((await call(s2, null, { action: 'clasa', category: 'evaluare-nationala' })).statusCode, 400, 'doar clasele V–XII');
});

// ═══════════════════════════ 2) legăturile (adminul) ═══════════════════════════

test('„✓ Leagă toate propunerile": doar la fișele fără nicio legătură — legătura adminului / a botului nu se rescrie', async () => {
  const supa = await baza({ legaturi: [
    { content_id: ID.f13, file_url: row(ID.f13, '', '1700000000013_Fisa_13.pdf').file_url, barem_override_id: ID.borf, barem_override_by: 'admin' },   // admin: „greșit", dar e alegerea lui
  ] });
  // două fișe despre triunghi și un singur „Barem — Triunghiul (set A)" → al niciuneia (invers unic)
  supa.db.tables.content.push(row('c6000000-0000-4000-8000-0000000000a3', 'Triunghiul — fișa 3', '1700000000023_triunghi3.pdf', { sort_order: 5 }));
  let r = await call(supa, ADMIN, { action: 'clasa', category: 'clasa-6' });
  assert.strictEqual(deFisa(r, ID.tr).propunere, undefined);
  assert.strictEqual(r.body.stats.propuneri, 1, 'doar fișa 14 (fișa 13 e legată de admin)');
  r = await call(supa, ADMIN, { action: 'leaga_propuneri', category: 'clasa-6' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.strictEqual(r.body.legate, 1);
  assert.deepStrictEqual([at(supa, ID.f13).barem_override_id, at(supa, ID.f13).barem_override_by], [ID.borf, 'admin'], 'legătura adminului rămâne');
  assert.deepStrictEqual([at(supa, ID.f14).barem_override_id, at(supa, ID.f14).barem_override_by], [ID.b14, 'admin']);
  assert.ok(!at(supa, ID.rec), 'fără propunere — neatinsă');
  assert.strictEqual((await call(supa, ELEV, { action: 'leaga_propuneri', category: 'clasa-6' })).statusCode, 403);
  assert.strictEqual((await call(supa, null, { action: 'leaga_propuneri', category: 'clasa-6' })).statusCode, 401);
});

test('„Leagă" manual / „↺ Automat": legătura adminului în ai_pdf_text; baremul trebuie să fie un PDF al aceleiași clase', async () => {
  const supa = await baza();
  let r = await call(supa, ADMIN, { action: 'leaga', contentId: ID.rec, baremId: ID.borf });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual([at(supa, ID.rec).barem_override_id, at(supa, ID.rec).barem_override_by], [ID.borf, 'admin']);
  assert.deepStrictEqual([deFisa(r, ID.rec).barem.id, deFisa(r, ID.rec).barem.cum], [ID.borf, 'admin']);
  r = await call(supa, ADMIN, { action: 'leaga', contentId: ID.rec, baremId: ID.c7b });
  assert.strictEqual(r.statusCode, 400, 'baremul altei clase');
  r = await call(supa, ADMIN, { action: 'leaga', contentId: ID.b13, baremId: ID.borf });
  assert.strictEqual(r.statusCode, 400, 'un barem nu e fișă');
  r = await call(supa, ELEV, { action: 'leaga', contentId: ID.rec, baremId: ID.borf });
  assert.strictEqual(r.statusCode, 403);
  r = await call(supa, ADMIN, { action: 'dezleaga', contentId: ID.rec });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual([at(supa, ID.rec).barem_override_id, at(supa, ID.rec).barem_override_by], [null, null]);
  assert.strictEqual(deFisa(r, ID.rec).barem, null);
});

test('„📤 Încarcă baremul": PDF-ul din Storage-ul materialelor clasei devine material „bareme" al clasei și se leagă de fișă', async () => {
  const supa = await baza();
  let r = await call(supa, ADMIN, { action: 'incarca', contentId: ID.rec, fileUrl: `${FAKE}personal-pdfs/x/barem.pdf` });
  assert.strictEqual(r.statusCode, 400, 'alt bucket');
  r = await call(supa, ADMIN, { action: 'incarca', contentId: ID.rec, fileUrl: `${FAKE}content-files-free/pdf/clasa-7/1_barem.pdf` });
  assert.strictEqual(r.statusCode, 400, 'altă clasă');
  r = await call(supa, ADMIN, { action: 'incarca', contentId: ID.tr, fileUrl: `${FAKE}content-files/pdf/clasa-6/1731600000000_barem_triunghi.pdf`, title: 'Triunghiul — fișa 2' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const nou = supa.db.tables.content.find((c) => /barem_triunghi/.test(c.file_url));
  assert.deepStrictEqual([nou.title, nou.category, nou.subcategory, nou.content_type, nou.is_free], ['Barem — Triunghiul — fișa 2', 'clasa-6', 'bareme', 'pdf', false]);
  assert.deepStrictEqual([at(supa, ID.tr).barem_override_id, at(supa, ID.tr).barem_override_by], [nou.id, 'admin']);
  assert.strictEqual(B.isBaremRow(nou), true);
});

// ═══════════════════════════ 3) corectarea folosește baremul legat ═══════════════════════════

test('corectarea (getPdfContext — Profesorul Virtual, „✏️ Pe PDF", „🎓 Cere corectarea"): baremul legat din „📋 Bareme"; fără legătură — cel găsit după titlu', async () => {
  const supa = await baza();
  const fisa = (id) => supa.db.tables.content.find((c) => c.id === id);
  // fără legătură: potrivirea automată a fișei, după titlu (baremul fișei 13)
  let pc = await PDF.getPdfContext(supa, fisa(ID.f13));
  assert.deepStrictEqual([pc.barem && pc.barem.id, pc.baremStatus], [ID.b13, 'ok']);
  assert.match(pc.barem.matchedBy, /^titlu/);
  assert.match(pc.baremText, /BAREM fisa 13/);
  // adminul leagă alt barem din „📋 Bareme" → corectarea îl folosește pe acela
  const r = await call(supa, ADMIN, { action: 'leaga', contentId: ID.f13, baremId: ID.b14 });
  assert.strictEqual(r.statusCode, 200);
  pc = await PDF.getPdfContext(supa, fisa(ID.f13));
  assert.deepStrictEqual([pc.barem.id, pc.barem.matchedBy, pc.baremStatus], [ID.b14, 'admin', 'ok_admin']);
  assert.match(pc.baremText, /BAREM fisa 14/);
  // toate corectările citesc baremul de aici (de pe server), nu din browser
  assert.match(read('api/rezolva-pdf.js'), /await pdfContext\.getPdfContext\(supa, content\)/);
  assert.match(read('api/ai-correct.js'), /await pdfContext\.getPdfContext\(supa, content\)/);
});

test('harta pregătirii: fișa clasei cu barem legat intră în harta PDF a clasei; fără — nu', async () => {
  const supa = await baza();
  const rows = supa.db.tables.content.filter((c) => c.category === 'clasa-6');
  let cu = await PL.bareme(supa, rows);
  assert.ok(!cu.has(ID.rec));
  await call(supa, ADMIN, { action: 'leaga', contentId: ID.rec, baremId: ID.borf });
  cu = await PL.bareme(supa, rows);
  assert.ok(cu.has(ID.rec), 'legătura adminului contează pentru hartă');
  const n = PL.construiesteNoduri(rows, PL.etape({ tip: 'clasa', clasa: 6 }), { cuBarem: cu }).filter((x) => x.harta === 'pdf');
  assert.deepStrictEqual(n.map((x) => x.id), [ID.rec]);
  assert.ok(!n.some((x) => [ID.b13, ID.b14, ID.btr, ID.borf].includes(x.id)), 'baremele nu sunt pași');
});

// ═══════════════════════════ 4) paginile ═══════════════════════════

test('pagina clasei: fila „📋 Bareme" (lângă exercițiile interactive și PDF); baremele nu mai stau printre exercițiile PDF', () => {
  const cp = read('src/pages/ClassPage.jsx');
  assert.match(cp, /\{ id: 'bareme', {6}label: '📋 Bareme' \}/);
  assert.match(cp, /\n {6}bareme\n {4}\/>/);
  const pg = read('src/components/ContentPage.jsx');
  assert.match(pg, /const inTab = \(item, tabId\) => item\.content_type === tabId && !\(bareme && tabId === 'pdf' && esteBarem\(item\)\);/);
  assert.match(pg, /const tabsVazute = tabs\.filter\(\(t\) => t\.id !== 'bareme' \|\| baremeVizibile\);/);
  assert.match(pg, /<BaremeClasa category=\{category\} stare=\{bar\} items=\{items\} user=\{user\} isPremium=\{isPremium\} Card=\{ContentCard\} \/>/);
  const bc = read('src/components/BaremeClasa.jsx');
  for (const a of ["action: 'clasa'", "action: 'leaga'", "action: 'dezleaga'", "action: 'leaga_propuneri'", "action: 'incarca'", "action: 'vizibil'"]) assert.ok(bc.includes(a), a);
  assert.ok(!/from '\.\/ContentPage'/.test(bc), 'fără import circular (ContentCard vine ca prop)');
  // Manualele (aceeași componentă) nu au fila
  assert.ok(!/bareme/.test(read('src/pages/Manuale.jsx')));
});

test('src/lib/bareme.js recunoaște baremele ca serverul (isBaremRow)', async () => {
  const { esteBarem } = await import('../src/lib/bareme.js');
  const cazuri = [
    { title: 'Barem — Numere întregi — fișa 13' }, { title: 'Fișa 13', file_url: 'x/1700000000_Barem_fisa_13.pdf' },
    { title: 'Simulare', file_url: 'x/ENVIII_Matematica_2024_bar_07_LRO.pdf' }, { title: 'Oricare', subcategory: 'bareme' },
    { title: 'Numere întregi — fișa 13', file_url: 'x/1700000000_Fisa_13.pdf' }, { title: 'Barbu — exerciții' },
  ];
  for (const c of cazuri) assert.strictEqual(esteBarem(c), B.isBaremRow(c), JSON.stringify(c));
});
