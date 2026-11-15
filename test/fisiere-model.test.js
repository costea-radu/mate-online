// =====================================================================
// test/fisiere-model.test.js — Admin → „📤 Fișiere model" (15 nov. 2026):
//   „Creează o filă nouă în Admin, «📤 Fișiere model», unde pot încărca poze, PDF sau
//    Word cu exerciții-model (…) reutilizează conversia existentă (materialPdf.js) (…)
//    extrage textul (…) cere: clasa (…) sau examenul (EN / BAC + profil), capitolul/tema
//    (…) tipul de exercițiu (…) opțional exercițiul de examen pe care îl ilustrează (…)
//    tabel nou (…) listă în Admin cu filtrare (…), redenumire etichete, ștergere.
//    Fișierele model NU se publică nicăieri automat."
//
// supabase/fisiere_model.sql (tabela + RLS + GRANT-urile cerute de CLAUDE.md),
// api/fisiere-model.js, src/components/AdminFisiereModel.jsx, src/pages/Admin.jsx.
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const ai = require('../api/_lib/ai');
const handler = require('../api/fisiere-model');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ADMIN = '99999999-9999-4999-8999-999999999999';
const PROF = 'pppppppp-0000-4000-8000-000000000001';

async function pdfOf(text) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  let y = 800;
  for (const l of text.split('\n')) { page.drawText(l, { x: 36, y, size: 11, font }); y -= 15; }
  return Buffer.from(await doc.save());
}

function baza({ faraTabela = false } = {}) {
  const supa = createFakeSupabase({
    profiles: [{ id: ADMIN, is_admin: true, role: 'profesor' }, { id: PROF, is_admin: false, role: 'profesor' }],
    admin_model_files: [], content: [], ai_public_library: [],
  });
  if (faraTabela) supa.db.failTables.add('admin_model_files');
  return supa;
}
let CINE = ADMIN;
const vechi = { admin: ai.admin, authUser: ai.authUser };
test.before(() => { ai.authUser = async () => CINE; });
test.after(() => { ai.admin = vechi.admin; ai.authUser = vechi.authUser; });
async function call(supa, body, cine = ADMIN) {
  ai.admin = () => supa;
  CINE = cine;
  const res = fakeRes();
  await handler({ method: 'POST', headers: { authorization: 'Bearer x' }, body }, res);
  return res;
}

// ═══════════════════════════ 1) tabela ═══════════════════════════

test('SQL: admin_model_files — RLS + GRANT-urile imediat după create table (CLAUDE.md), fără anon, politica rolului de serviciu', () => {
  const sql = read('supabase/fisiere_model.sql');
  const i = sql.indexOf('create table if not exists public.admin_model_files');
  const sfarsit = sql.indexOf(');', i);
  const dupa = sql.slice(sfarsit + 2).trimStart();
  assert.ok(i > 0);
  assert.ok(dupa.startsWith('alter table public.admin_model_files enable row level security;'), 'RLS imediat după tabelă');
  const g1 = dupa.indexOf('grant select, insert, update, delete on public.admin_model_files to authenticated;');
  const g2 = dupa.indexOf('grant select, insert, update, delete on public.admin_model_files to service_role;');
  assert.ok(g1 > 0 && g2 > g1 && g2 < dupa.indexOf('create index'), 'GRANT-urile, înaintea restului');
  assert.ok(!/to anon/.test(sql), 'datele nu sunt publice: fără anon');
  assert.match(sql, /create policy admin_model_files_service on public\.admin_model_files for all to service_role using \(true\) with check \(true\);/);
  for (const col of ['file_path', 'text', 'clasa', 'examen', 'profil', 'capitol', 'capitol_id', 'tip_exercitiu', 'examen_asociat', 'status', 'uploaded_at', 'processed_at', 'processed_by']) {
    assert.match(sql, new RegExp(`\\n  ${col} +`), col);
  }
  assert.match(sql, /check \(tip_exercitiu in \('grila', 'redactare', 'mixt'\)\)/);
  assert.match(sql, /check \(status in \('neprocesat', 'procesat'\)\)/);
  assert.match(sql, /check \(clasa is not null or examen is not null\)/);
});

// ═══════════════════════════ 2) API ═══════════════════════════

test('doar administratorii; fără tabelă: lista spune ce SQL trebuie rulat (cu propunerile de capitole)', async () => {
  let r = await call(baza(), { action: 'lista' }, PROF);
  assert.strictEqual(r.statusCode, 403);
  r = await call(baza({ faraTabela: true }), { action: 'lista' });
  assert.strictEqual(r.statusCode, 200);
  assert.deepStrictEqual([r.body.setup, r.body.fisiere], [false, []]);
  assert.match(r.body.hint, /supabase\/fisiere_model\.sql/);
  assert.ok(r.body.capitole['clasa-6'].includes('Numere întregi'), 'capitolele site-ului (ca pe harta pregătirii)');
  assert.ok(r.body.capitole['evaluare-nationala'].includes('Numere reale și radicali'));
  assert.ok(r.body.capitole['clasa-11'].includes('Matrice, determinanți, sisteme'));
});

test('„salveaza": doar din folderul adminului (personal-pdfs/<id>/fisiere-model/…); textul PDF-ului — pe server; capitolul recunoscut; exercițiul de examen', async () => {
  const supa = baza();
  const p = `${ADMIN}/fisiere-model/1731600000000_ab12cd.pdf`;
  supa.db.files.set(`personal-pdfs/${p}`, await pdfOf('Exercitii model: numere intregi\n1. Calculati -7 + 12.'));
  let r = await call(supa, { action: 'salveaza', path: `${PROF}/fisiere-model/x.pdf`, titlu: 'X', clasa: 6, capitol: 'Numere întregi', tip: 'grila' });
  assert.strictEqual(r.statusCode, 400, 'folderul altui cont');
  r = await call(supa, { action: 'salveaza', path: `${ADMIN}/alt-folder/x.pdf`, titlu: 'X', clasa: 6, capitol: 'Numere întregi', tip: 'grila' });
  assert.strictEqual(r.statusCode, 400, 'alt folder');
  r = await call(supa, { action: 'salveaza', path: p, titlu: 'X', clasa: 6, examen: 'bacalaureat', capitol: 'Numere întregi', tip: 'grila' });
  assert.strictEqual(r.statusCode, 400, 'clasa SAU examenul');
  r = await call(supa, {
    action: 'salveaza', path: p, titlu: '  Numere întregi — model  ', clasa: 6, capitol: 'Numere întregi', tip: 'grila', sursa: 'pdf',
    numeOriginal: 'model_intregi.pdf', pagini: 1, octeti: 2048, examenAsociat: { examen: 'evaluare-nationala', subiect: 1, exercitiu: 3 },
  });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  const row = supa.db.tables.admin_model_files[0];
  assert.deepStrictEqual([row.titlu, row.clasa, row.examen, row.capitol, row.capitol_id, row.tip_exercitiu, row.status, row.uploaded_by],
    ['Numere întregi — model', 6, null, 'Numere întregi', 'c6-intregi', 'grila', 'neprocesat', ADMIN]);
  assert.match(row.text, /Calculati -7 \+ 12/);
  assert.strictEqual(row.text_sursa, 'pdf');
  assert.deepStrictEqual(row.examen_asociat, { examen: 'evaluare-nationala', subiect: 1, exercitiu: 3, eticheta: 'EN Subiectul I exercițiul 3' });
  assert.ok(!('text' in r.body.fisier), 'lista nu poartă textul întreg');
  // Word: textul (cu formulele ca LaTeX) vine din browser
  const p2 = `${ADMIN}/fisiere-model/1731600000001_word.pdf`;
  supa.db.files.set(`personal-pdfs/${p2}`, await pdfOf('imagine'));
  r = await call(supa, { action: 'salveaza', path: p2, titlu: 'Radicali', examen: 'evaluare-nationala', capitol: 'Radicali', tip: 'redactare', sursa: 'docx', text: 'Calculați $\\sqrt{12}$.' });
  assert.strictEqual(r.statusCode, 200);
  const w = supa.db.tables.admin_model_files[1];
  assert.deepStrictEqual([w.text, w.text_sursa, w.capitol_id, w.profil], ['Calculați $\\sqrt{12}$.', 'word', 'en-reale', null]);
  // nimic publicat: nici pe site, nici în Biblioteca utilizatorilor
  assert.deepStrictEqual([supa.db.tables.content.length, supa.db.tables.ai_public_library.length], [0, 0]);
});

test('lista, redenumirea etichetelor, starea, linkul semnat, ștergerea (rândul + PDF-ul)', async () => {
  const supa = baza();
  const p = `${ADMIN}/fisiere-model/1731600000002_x.pdf`;
  supa.db.files.set(`personal-pdfs/${p}`, await pdfOf('Polinoame'));
  let r = await call(supa, { action: 'salveaza', path: p, titlu: 'Polinoame', examen: 'bacalaureat', profil: 'mate-info', capitol: 'Polinoame', tip: 'mixt' });
  const id = r.body.fisier.id;
  assert.deepStrictEqual([r.body.fisier.profil, r.body.fisier.capitol_id], ['mate-info', 'bac-polinoame']);
  r = await call(supa, { action: 'actualizeaza', id, titlu: 'Polinoame — Viète', clasa: 12, examen: null, capitol: 'Polinoame' });
  assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
  assert.deepStrictEqual([r.body.fisier.titlu, r.body.fisier.clasa, r.body.fisier.examen, r.body.fisier.profil, r.body.fisier.capitol_id], ['Polinoame — Viète', 12, null, null, 'bac-polinoame']);
  r = await call(supa, { action: 'actualizeaza', id, status: 'procesat' });
  assert.deepStrictEqual([r.body.fisier.status, r.body.fisier.processed_by, !!r.body.fisier.processed_at], ['procesat', 'admin', true]);
  r = await call(supa, { action: 'actualizeaza', id, titlu: '   ' });
  assert.strictEqual(r.statusCode, 400, 'titlul nu poate fi gol');
  r = await call(supa, { action: 'lista', status: 'procesat' });
  assert.deepStrictEqual(r.body.fisiere.map((f) => f.id), [id]);
  r = await call(supa, { action: 'lista', status: 'neprocesat' });
  assert.deepStrictEqual(r.body.fisiere, []);
  r = await call(supa, { action: 'url', id });
  assert.match(r.body.url, /object\/sign\/personal-pdfs\//);
  r = await call(supa, { action: 'sterge', id });
  assert.strictEqual(r.statusCode, 200);
  assert.strictEqual(supa.db.tables.admin_model_files.length, 0);
  assert.ok(supa.db.removed.includes(`personal-pdfs/${p}`), 'și PDF-ul din bucket');
  r = await call(supa, { action: 'sterge', id });
  assert.strictEqual(r.statusCode, 404);
});

test('etichetele: exercițiul de examen („BAC Subiectul al III-lea"), profilul doar la BAC, tipurile', () => {
  const E = handler.etichete;
  assert.deepStrictEqual(handler.examenAsociat({ examen: 'bacalaureat', subiect: 3 }), { examen: 'bacalaureat', subiect: 3, exercitiu: null, eticheta: 'BAC Subiectul al III-lea' });
  assert.strictEqual(handler.examenAsociat({ examen: 'evaluare-nationala' }), null, 'fără subiect — niciunul');
  assert.strictEqual(E({ titlu: 'a', clasa: 7, capitol: 'x', tip: 'mixt', profil: 'mate-info' }).profil, null);
  assert.throws(() => E({ titlu: 'a', clasa: 4, capitol: 'x', tip: 'mixt' }), /a V-a și a XII-a/);
  assert.throws(() => E({ titlu: 'a', capitol: 'x', tip: 'mixt' }), /clasa sau examenul/);
  assert.throws(() => E({ titlu: 'a', clasa: 7, capitol: 'x', tip: 'eseu' }), /grilă, redactare sau mixt/);
});

// ═══════════════════════════ 3) Admin ═══════════════════════════

test('Admin: fila „📤 Fișiere model" — conversia din materialPdf.js, transcrierea pozelor, folderul privat; nimic publicat, Biblioteca neatinsă', () => {
  const adm = read('src/pages/Admin.jsx');
  assert.match(adm, /\{ id: 'fisiere-model', icon: '📤', label: 'Fișiere model' \}/);
  assert.match(adm, /\{tab === 'fisiere-model' && <AdminFisiereModel s=\{s\} \/>\}/);
  const c = read('src/components/AdminFisiereModel.jsx');
  assert.match(c, /from '\.\.\/lib\/materialPdf';/, 'aceeași conversie (poze / Word → PDF)');
  assert.match(c, /prepareMaterial\(pick\.kind, pick\.files/);
  assert.match(c, /aiClient\.publicTranscribe\(\{ images: lot \}\)/, 'pozele: transcrierea existentă');
  assert.match(c, /supabase\.storage\.from\('personal-pdfs'\)\.upload\(path/);
  assert.match(c, /path = `\$\{uid\}\/fisiere-model\//);
  assert.ok(!/uploadMaterial|action: 'publish'|ai_public_library/.test(c), 'nu publică în Biblioteca utilizatorilor');
  for (const a of ["action: 'lista'", "action: 'salveaza'", "action: 'actualizeaza'", "action: 'sterge'", "action: 'url'"]) assert.ok(c.includes(a), a);
  assert.ok(!/fisiere-model|admin_model_files/.test(read('src/components/IncarcaMaterial.jsx')), 'Biblioteca utilizatorilor — neschimbată');
  assert.ok(!/fisiere-model|admin_model_files/.test(read('api/ai-public.js')));
});
