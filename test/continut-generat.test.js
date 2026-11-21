// =====================================================================
// test/continut-generat.test.js — 🤖 CONȚINUTUL GENERAT de skill-ul „examenmate-continut"
// (21 nov. 2026): „fă modificările: tabela continut_generat, cele două Action-uri («Aduce
// surse» și «Publică») și fila din Admin · fă și modificarea de cod ca legăturile să poată fi
// marcate «claude-skill» · oprește notificările pentru bareme".
//
// supabase/continut_generat.sql, supabase/notificari_fara_bareme.sql,
// api/_lib/continutGenerat.js (publicare directă / ciornă / aprobă / respinge / anulează),
// api/ai-pdf-context.js (setOverride: 'claude-skill', doarDacaLiber), api/continut-generat.js,
// src/components/AdminContinutGenerat.jsx + Admin, scripts/continut/publica.js și aduce-surse.js.
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const CG = require('../api/_lib/continutGenerat');
const pdfContext = require('../api/ai-pdf-context');
const { createFakeSupabase } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ID = (n) => `${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const FISA = ID(1), VARIANTA = ID(2), BAREM_EN = ID(3), TEST = ID(4), MODEL = ID(5), ALT_BAREM = ID(6);
const URL = (bucket, p) => `https://fake.supabase/storage/v1/object/public/${bucket}/${p}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const html = (extra = '', score = true) => `<!doctype html><html lang="ro"><head><meta charset="utf-8"><title>Test</title></head><body>
<div class="q">1. Calculează $2+3$. ${extra}</div><input id="r1">
<script>
var D=[{"t":"o","a":"5","p":5,"e":"2+3=5"}];
function verifica(){ var pct = 100; ${score ? "parent.postMessage({type:'MATE_SCORE',score:pct,maxScore:100,answers:['5']},'*');" : ''} }
</script></body></html>`;

const seed = () => ({
  content: [
    { id: FISA, title: 'ALGEBRĂ - Fișă 4: Proporții', category: 'clasa-6', subcategory: null, profile: null, content_type: 'pdf', is_free: true, file_url: URL('content-files-free', 'pdf/clasa-6/1_fisa4.pdf'), interactiv_id: null, pdf_sursa_id: null },
    { id: VARIANTA, title: '2026 - varianta 07 rezervă', category: 'evaluare-nationala', subcategory: 'variante', profile: null, content_type: 'pdf', is_free: true, file_url: URL('content-files-free', 'pdf/evaluare-nationala/2_v07.pdf'), interactiv_id: null, pdf_sursa_id: null },
    { id: BAREM_EN, title: 'Barem — 2026 - varianta 07 rezervă', category: 'evaluare-nationala', subcategory: 'bareme', profile: null, content_type: 'pdf', is_free: true, file_url: URL('content-files-free', 'pdf/evaluare-nationala/3_bar07.pdf') },
    { id: TEST, title: 'Test interactiv Evaluare Națională - 20', category: 'evaluare-nationala', subcategory: 'teste-interactive', profile: null, content_type: 'interactive', is_free: false, file_url: URL('content-files', 'interactive/evaluare-nationala/4_task_test-20.html'), interactive_data: { type: 'test', html: true } },
    { id: ALT_BAREM, title: 'Barem — altceva', category: 'clasa-6', subcategory: 'bareme', profile: null, content_type: 'pdf', is_free: true, file_url: URL('content-files-free', 'pdf/clasa-6/6_bar.pdf') },
  ],
  ai_pdf_text: [
    { content_id: FISA, file_url: URL('content-files-free', 'pdf/clasa-6/1_fisa4.pdf'), text: 'Proporții…', barem_id: null, barem_status: 'negasit', barem_override_id: null, barem_override_by: null },
    { content_id: VARIANTA, file_url: URL('content-files-free', 'pdf/evaluare-nationala/2_v07.pdf'), text: 'Subiectul I…', barem_id: BAREM_EN, barem_status: 'ok', barem_override_id: null, barem_override_by: null },
  ],
  admin_model_files: [
    { id: MODEL, titlu: 'Numere întregi — model', file_path: 'admin/fisiere-model/m.pdf', bucket: 'personal-pdfs', text: '…', clasa: 6, examen: null, profil: null, capitol: 'Numere întregi', capitol_id: 'c6-intregi', tip_exercitiu: 'redactare', status: 'neprocesat', processed_by: null },
  ],
  barem_explicatii: [],
  continut_generat: [],
});
const fake = () => {
  const supa = createFakeSupabase(seed());
  supa.db.unique = { continut_generat: [['unitate']], barem_explicatii: [['barem_id']] };
  return supa;
};
const cititor = (files) => async (nume) => { if (!(nume in files)) throw new Error('lipsă'); return files[nume]; };
const rand = (supa, unitate) => supa.db.tables.continut_generat.find((r) => r.unitate === unitate);

// ═══════════════════════════ 1) SQL ═══════════════════════════

test('SQL: continut_generat cu RLS, GRANT-urile din CLAUDE.md imediat după tabel, fără anon, doar serverul', () => {
  const sql = read('supabase/continut_generat.sql');
  assert.match(sql, /create table if not exists public\.continut_generat \(/);
  assert.match(sql, /unitate\s+text not null unique/);
  const dupa = sql.slice(sql.indexOf('create table if not exists public.continut_generat'));
  assert.match(dupa, /\);\nalter table public\.continut_generat enable row level security;\n\ngrant select, insert, update, delete on public\.continut_generat to authenticated;\ngrant select, insert, update, delete on public\.continut_generat to service_role;/);
  assert.doesNotMatch(sql, /grant [^;]* to anon/);
  assert.match(sql, /\nrevoke all on public\.continut_generat from anon;\n/);
  assert.match(sql, /create policy continut_generat_service on public\.continut_generat for all to service_role/);
  for (const st of CG.STARI) assert.ok(sql.includes(`'${st}'`), `starea ${st} e în constrângere`);
});

test('SQL: notificările nu mai pleacă la bareme (rubrica bareme sau titlu cu „barem")', () => {
  const sql = read('supabase/notificari_fara_bareme.sql');
  assert.match(sql, /create or replace function public\.notify_new_content\(\)/);
  assert.match(sql, /if new\.subcategory = 'bareme' or lower\(coalesce\(new\.title, ''\)\) ~ '\(\^\|\[\^a-z0-9\]\)barem' then\s+return new;/);
  const re = /(^|[^a-z0-9])barem/;   // aceeași expresie, în JS
  assert.ok(re.test('barem — 2026 - varianta 07'));
  assert.ok(re.test('bareme 2025'));
  assert.ok(!re.test('2026 - varianta 07 rezervă'));
});

// ═══════════════════════════ 2) setOverride: „claude-skill" ═══════════════════════════

test('setOverride: marchează legătura „claude-skill"; doarDacaLiber nu suprascrie nimic', async () => {
  const supa = fake();
  const fisa = supa.db.tables.content.find((r) => r.id === FISA);
  assert.strictEqual(await pdfContext.setOverride(supa, fisa, ALT_BAREM, { by: 'claude-skill', doarDacaLiber: true }), true);
  const t = supa.db.tables.ai_pdf_text.find((r) => r.content_id === FISA);
  assert.strictEqual(t.barem_override_id, ALT_BAREM);
  assert.strictEqual(t.barem_override_by, 'claude-skill');
  // a doua oară: e deja legat → false, nimic schimbat
  assert.strictEqual(await pdfContext.setOverride(supa, fisa, BAREM_EN, { by: 'claude-skill', doarDacaLiber: true }), false);
  assert.strictEqual(t.barem_override_id, ALT_BAREM);
  // fără doarDacaLiber (adminul) — ca înainte: suprascrie, iar un „by" necunoscut devine admin
  assert.strictEqual(await pdfContext.setOverride(supa, fisa, BAREM_EN, { by: 'altcineva' }), true);
  assert.strictEqual(t.barem_override_by, 'admin');
  // rând lipsă → se creează
  const varianta = supa.db.tables.content.find((r) => r.id === TEST);
  assert.strictEqual(await pdfContext.setOverride(supa, varianta, BAREM_EN, { by: 'claude-skill', doarDacaLiber: true }), true);
  assert.strictEqual(supa.db.tables.ai_pdf_text.find((r) => r.content_id === TEST).barem_override_by, 'claude-skill');
});

test('etichetele „claude-skill": PDF-ul, fila Bareme a clasei, botul de examene, cache-ul fișelor', () => {
  assert.match(read('api/ai-pdf-context.js'), /'claude-skill': 'barem generat automat \(Claude\) și verificat după barem'/);
  assert.match(read('src/pages/PDFViewer.jsx'), /'claude-skill': 'barem generat automat \(Claude\), verificat după barem'/);
  assert.match(read('src/components/BaremeClasa.jsx'), /'claude-skill': \{ t: '✨ generat automat \(Claude\), verificat după barem', c: 'bc-p-skill' \}/);
  const bot = read('api/_lib/examBotRun.js');
  assert.match(bot, /d\.barem_override_by === 'claude-skill' \? 'skill' : 'admin'/);
  assert.match(bot, /skill: 'generat de skill-ul de conținut \(verificat după barem\)'/);
  assert.match(read('api/_lib/barem.js'), /'admin', 'bot', 'claude-skill'\]/);
});

// ═══════════════════════════ 3) manifestul ═══════════════════════════

test('manifestul: procedura, decizia, fișierele fără foldere, câmpurile cerute', () => {
  const ok = CG.normalizeazaManifest({ procedura: 1, decizie: 'publica', sursa: { content_id: FISA }, barem: { fisier: 'barem.pdf' } }, { unitate: '2026-11-21/1-fisa' });
  assert.strictEqual(ok.procedura, 1);
  assert.strictEqual(ok.titlu, 'Barem pentru un PDF fără barem');
  const rau = (m, re) => assert.throws(() => CG.normalizeazaManifest(m, { unitate: '2026-11-21/x' }), re);
  rau({ procedura: 9, decizie: 'publica' }, /Procedura/);
  rau({ procedura: 1, decizie: 'poate' }, /Decizia/);
  rau({ procedura: 1, decizie: 'publica', sursa: { content_id: FISA }, barem: { fisier: '../secret.pdf' } }, /barem\.fisier/);
  rau({ procedura: 1, decizie: 'publica', sursa: { content_id: FISA }, barem: { fisier: 'barem.html' } }, /barem\.fisier/);
  rau({ procedura: 1, decizie: 'publica', sursa: { content_id: FISA } }, /are nevoie de „barem"/);
  rau({ procedura: 3, decizie: 'publica', material: { fisier: 'a.pdf', title: 'x' }, barem: { fisier: 'b.pdf' } }, /model_id/);
  rau({ procedura: 6, decizie: 'publica', sursa: { content_id: TEST }, inlocuire: { fisier: 'a.html' } }, /file_url_vechi/);
  rau({ procedura: 2, decizie: 'verificat', sursa: { content_id: TEST } }, /doar pentru procedura 6/);
  assert.throws(() => CG.normalizeazaManifest({ procedura: 1, decizie: 'nimic' }, { unitate: '../x' }), /Unitatea/);
});

// ═══════════════════════════ 4) procedura 1 — barem ═══════════════════════════

test('procedura 1: barem verificat → publicat direct: rândul baremului, apoi legătura „claude-skill"', async () => {
  const supa = fake();
  const manifest = { procedura: 1, decizie: 'publica', sursa: { content_id: FISA }, barem: { fisier: 'barem.pdf' }, verificari: { a_doua_rezolvare: true } };
  const r = await CG.proceseazaUnitate(supa, { manifest, unitate: '2026-11-21/1-fisa', citeste: cititor({ 'barem.pdf': PDF }) });
  assert.strictEqual(r.status, 'publicat', r.eroare || r.motiv);
  const barem = supa.db.tables.content.find((c) => c.title === 'Barem — ALGEBRĂ - Fișă 4: Proporții');
  assert.ok(barem, 'rândul baremului');
  assert.deepStrictEqual([barem.category, barem.subcategory, barem.content_type, barem.is_free, barem.sort_order], ['clasa-6', 'bareme', 'pdf', true, 0]);
  assert.match(barem.file_url, /content-files-free\/pdf\/clasa-6\/\d+_barem-algebra-fisa-4-proportii\.pdf$/);
  const t = supa.db.tables.ai_pdf_text.find((x) => x.content_id === FISA);
  assert.strictEqual(t.barem_override_id, barem.id);
  assert.strictEqual(t.barem_override_by, 'claude-skill');
  assert.deepStrictEqual(supa.db.uploads.map((u) => u.bucket), ['content-files-free']);
  const j = rand(supa, '2026-11-21/1-fisa');
  assert.strictEqual(j.status, 'publicat');
  assert.deepStrictEqual(j.creat.legatura, { material_id: FISA, barem_id: barem.id });
  // a doua rulare a Action-ului: aceeași unitate nu se mai procesează
  const r2 = await CG.proceseazaUnitate(supa, { manifest, unitate: '2026-11-21/1-fisa', citeste: cititor({ 'barem.pdf': PDF }) });
  assert.strictEqual(r2.deja, true);
  assert.strictEqual(supa.db.tables.content.filter((c) => c.subcategory === 'bareme').length, 3);
  // Anulează: baremul dispare, legătura se desface, fișierul se șterge
  await CG.anuleaza(supa, j.id, null);
  assert.ok(!supa.db.tables.content.find((c) => c.id === barem.id));
  assert.strictEqual(t.barem_override_id, null);
  assert.strictEqual(t.barem_override_by, null);
  assert.strictEqual(t.barem_status, 'negasit');
  assert.ok(supa.db.removed.some((x) => x.includes('_barem-algebra-fisa-4-proportii.pdf')));
  assert.strictEqual(rand(supa, '2026-11-21/1-fisa').status, 'anulat');
});

test('procedura 1: materialul are deja barem (admin) → conflict, nimic urcat, nimic scris', async () => {
  const supa = fake();
  Object.assign(supa.db.tables.ai_pdf_text.find((x) => x.content_id === FISA), { barem_override_id: ALT_BAREM, barem_override_by: 'admin', barem_status: 'ok_admin' });
  const r = await CG.proceseazaUnitate(supa, { manifest: { procedura: 1, decizie: 'publica', sursa: { content_id: FISA }, barem: { fisier: 'barem.pdf' } }, unitate: 'u/1', citeste: cititor({ 'barem.pdf': PDF }) });
  assert.strictEqual(r.status, 'conflict');
  assert.match(r.motiv, /are deja un barem ales \(admin\)/);
  assert.strictEqual(supa.db.uploads.length, 0);
  assert.strictEqual(supa.db.tables.content.length, 5);
});

test('ciornă → „Aprobă" publică exact ca direct; „Respinge" șterge fișierele', async () => {
  const supa = fake();
  const r = await CG.proceseazaUnitate(supa, { manifest: { procedura: 1, decizie: 'ciorna', motiv: 'enunț ambiguu la 3b', sursa: { content_id: FISA }, barem: { fisier: 'barem.pdf' } }, unitate: 'u/c1', citeste: cititor({ 'barem.pdf': PDF }) });
  assert.strictEqual(r.status, 'ciorna');
  assert.strictEqual(supa.db.tables.content.length, 5, 'ciorna nu creează rânduri în content');
  assert.strictEqual(supa.db.uploads.length, 1, 'dar fișierul e urcat');
  const j = rand(supa, 'u/c1');
  const a = await CG.aproba(supa, j.id, ID(9));
  assert.strictEqual(a.status, 'aprobat');
  assert.strictEqual(supa.db.tables.ai_pdf_text.find((x) => x.content_id === FISA).barem_override_by, 'claude-skill');
  assert.strictEqual(rand(supa, 'u/c1').decis_de, ID(9));
  await assert.rejects(CG.aproba(supa, j.id), /Doar ciornele/);

  const supa2 = fake();
  await CG.proceseazaUnitate(supa2, { manifest: { procedura: 1, decizie: 'ciorna', sursa: { content_id: FISA }, barem: { fisier: 'barem.pdf' } }, unitate: 'u/c2', citeste: cititor({ 'barem.pdf': PDF }) });
  const j2 = rand(supa2, 'u/c2');
  await CG.respinge(supa2, j2.id, null, 'greșit la 2a');
  assert.strictEqual(rand(supa2, 'u/c2').status, 'respins');
  assert.match(rand(supa2, 'u/c2').motiv, /Respins: greșit la 2a/);
  assert.strictEqual(supa2.db.removed.length, 1);
});

test('aprobarea unei ciorne verifică din nou starea live (între timp a apărut un barem → nu publică)', async () => {
  const supa = fake();
  await CG.proceseazaUnitate(supa, { manifest: { procedura: 1, decizie: 'ciorna', sursa: { content_id: FISA }, barem: { fisier: 'barem.pdf' } }, unitate: 'u/c3', citeste: cititor({ 'barem.pdf': PDF }) });
  Object.assign(supa.db.tables.ai_pdf_text.find((x) => x.content_id === FISA), { barem_override_id: ALT_BAREM, barem_override_by: 'bot' });
  await assert.rejects(CG.aproba(supa, rand(supa, 'u/c3').id), /Nu se poate publica: Materialul are deja un barem ales \(bot\)/);
  assert.strictEqual(rand(supa, 'u/c3').status, 'ciorna');
});

// ═══════════════════════════ 5) procedura 2 — test interactiv ═══════════════════════════

test('procedura 2: testul interactiv al unui PDF — rubrica vizibilă, agentul claude-skill, asocierea PDF ↔ test', async () => {
  const supa = fake();
  const r = await CG.proceseazaUnitate(supa, { manifest: { procedura: 2, decizie: 'publica', sursa: { content_id: VARIANTA }, interactiv: { fisier: 'test.html' } }, unitate: 'u/2', citeste: cititor({ 'test.html': Buffer.from(html()) }) });
  assert.strictEqual(r.status, 'publicat', r.eroare || r.motiv);
  const test = supa.db.tables.content.find((c) => c.content_type === 'interactive' && c.pdf_sursa_id === VARIANTA);
  assert.ok(test);
  assert.strictEqual(test.title, '2026 - varianta 07 rezervă — rezolvare interactivă');
  assert.strictEqual(test.subcategory, 'teste-interactive');
  assert.deepStrictEqual(test.interactive_data, { type: 'test', html: true, ai_generated: true, agent: 'claude-skill' });
  assert.match(test.file_url, /content-files\/interactive\/evaluare-nationala\/\d+_task_2026-varianta-07-rezerva-rezolvare-interactiva\.html$/);
  assert.strictEqual(supa.db.tables.content.find((c) => c.id === VARIANTA).interactiv_id, test.id);
  // Anulează: testul dispare, PDF-ul rămâne fără test
  await CG.anuleaza(supa, rand(supa, 'u/2').id);
  assert.strictEqual(supa.db.tables.content.find((c) => c.id === VARIANTA).interactiv_id, null);
  assert.ok(!supa.db.tables.content.find((c) => c.id === test.id));
});

test('procedura 2: verificările automate pică (fără MATE_SCORE / JS stricat) → ciornă, nu publicare', async () => {
  const supa = fake();
  const r = await CG.proceseazaUnitate(supa, { manifest: { procedura: 2, decizie: 'publica', sursa: { content_id: VARIANTA }, interactiv: { fisier: 'test.html' } }, unitate: 'u/2b', citeste: cititor({ 'test.html': Buffer.from(html('', false)) }) });
  assert.strictEqual(r.status, 'ciorna');
  assert.match(r.motiv, /nu raportează scorul \(MATE_SCORE\)/);
  assert.ok(!supa.db.tables.content.some((c) => c.content_type === 'interactive' && c.pdf_sursa_id === VARIANTA));
  const supa2 = fake();
  const r2 = await CG.proceseazaUnitate(supa2, { manifest: { procedura: 2, decizie: 'publica', sursa: { content_id: VARIANTA }, interactiv: { fisier: 'test.html' } }, unitate: 'u/2c', citeste: cititor({ 'test.html': Buffer.from(html().replace('var pct = 100;', 'var pct = ;')) }) });
  assert.strictEqual(r2.status, 'ciorna');
  assert.match(r2.motiv, /JavaScript-ul nu se compilează/);
});

test('procedura 2: PDF-ul are deja test interactiv → conflict', async () => {
  const supa = fake();
  supa.db.tables.content.find((c) => c.id === VARIANTA).interactiv_id = TEST;
  const r = await CG.proceseazaUnitate(supa, { manifest: { procedura: 2, decizie: 'publica', sursa: { content_id: VARIANTA }, interactiv: { fisier: 'test.html' } }, unitate: 'u/2d', citeste: cititor({ 'test.html': Buffer.from(html()) }) });
  assert.strictEqual(r.status, 'conflict');
});

// ═══════════════════════════ 6) procedura 3 — fișa după model ═══════════════════════════

test('procedura 3: fișa ajunge la clasa și capitolul modelului; titlul trebuie să ducă la același capitol pe hartă', async () => {
  const supa = fake();
  const files = { 'fisa.pdf': PDF, 'barem.pdf': PDF };
  // titlu care ajunge la alt capitol → ciornă (cu motivul), nimic publicat
  const r1 = await CG.proceseazaUnitate(supa, { manifest: { procedura: 3, decizie: 'publica', sursa: { model_id: MODEL }, material: { fisier: 'fisa.pdf', title: 'Proporții — fișa 1' }, barem: { fisier: 'barem.pdf' } }, unitate: 'u/3a', citeste: cititor(files) });
  assert.strictEqual(r1.status, 'ciorna');
  assert.match(r1.motiv, /ajunge pe hartă la „Rapoarte, proporții, procente", nu la capitolul modelului/);
  // titlul corect → publicat: PDF la clasa a VI-a, capitolul c6-intregi, baremul legat, modelul procesat
  const r2 = await CG.proceseazaUnitate(supa, { manifest: { procedura: 3, decizie: 'publica', sursa: { model_id: MODEL }, material: { fisier: 'fisa.pdf', title: 'Numere întregi — fișa 1' }, barem: { fisier: 'barem.pdf' } }, unitate: 'u/3b', citeste: cititor(files) });
  assert.strictEqual(r2.status, 'publicat', r2.eroare || r2.motiv);
  const fisa = supa.db.tables.content.find((c) => c.title === 'Numere întregi — fișa 1');
  assert.deepStrictEqual([fisa.category, fisa.subcategory, fisa.chapter_id, fisa.is_free], ['clasa-6', null, 'c6-intregi', true]);
  const barem = supa.db.tables.content.find((c) => c.title === 'Barem — Numere întregi — fișa 1');
  assert.ok(barem);
  assert.strictEqual(supa.db.tables.ai_pdf_text.find((x) => x.content_id === fisa.id).barem_override_id, barem.id);
  const mo = supa.db.tables.admin_model_files[0];
  assert.deepStrictEqual([mo.status, mo.processed_by], ['procesat', 'claude-skill']);
  // Anulează: fișa și baremul dispar, modelul revine la neprocesat
  await CG.anuleaza(supa, rand(supa, 'u/3b').id);
  assert.ok(!supa.db.tables.content.find((c) => c.id === fisa.id || c.id === barem.id));
  assert.deepStrictEqual([mo.status, mo.processed_by], ['neprocesat', null]);
});

test('procedura 3: model fără clasă (doar examen) → conflict, rubrica o alege Radu', async () => {
  const supa = fake();
  Object.assign(supa.db.tables.admin_model_files[0], { clasa: null, examen: 'evaluare-nationala' });
  const r = await CG.proceseazaUnitate(supa, { manifest: { procedura: 3, decizie: 'publica', sursa: { model_id: MODEL }, material: { fisier: 'f.pdf', title: 'Numere întregi — fișa 1' }, barem: { fisier: 'b.pdf' } }, unitate: 'u/3c', citeste: cititor({ 'f.pdf': PDF, 'b.pdf': PDF }) });
  assert.strictEqual(r.status, 'conflict');
  assert.match(r.motiv, /nu are clasa/);
});

// ═══════════════════════════ 7) procedura 4 — variantă EN ═══════════════════════════

test('procedura 4: varianta EN în „Variante generate cu AI", cu baremul legat; titlu dublat → conflict', async () => {
  const supa = fake();
  const files = { 'varianta.pdf': PDF, 'barem.pdf': PDF };
  const m = { procedura: 4, decizie: 'publica', material: { fisier: 'varianta.pdf', title: 'Varianta AI 1 — Evaluare Națională, Matematică' }, barem: { fisier: 'barem.pdf' }, surse: [VARIANTA] };
  const r = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/4a', citeste: cititor(files) });
  assert.strictEqual(r.status, 'publicat', r.eroare || r.motiv);
  const v = supa.db.tables.content.find((c) => c.subcategory === 'variante-ai');
  assert.deepStrictEqual([v.category, v.is_free], ['evaluare-nationala', false]);
  assert.match(v.file_url, /content-files\/pdf\/evaluare-nationala\//);
  const b = supa.db.tables.content.find((c) => c.title === 'Barem — Varianta AI 1 — Evaluare Națională, Matematică');
  assert.deepStrictEqual([b.subcategory, b.is_free], ['bareme', false]);
  assert.strictEqual(supa.db.tables.ai_pdf_text.find((x) => x.content_id === v.id).barem_override_by, 'claude-skill');
  const r2 = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/4b', citeste: cititor(files) });
  assert.strictEqual(r2.status, 'conflict');
});

// ═══════════════════════════ 8) procedura 5 — explicații ═══════════════════════════

test('procedura 5: explicațiile la grilă intră în barem_explicatii (fișierul în content-files); a doua oară → conflict', async () => {
  const supa = fake();
  const m = { procedura: 5, decizie: 'publica', sursa: { content_id: BAREM_EN }, explicatii: { fisier: 'explicatii.pdf' } };
  const r = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/5a', citeste: cititor({ 'explicatii.pdf': PDF }) });
  assert.strictEqual(r.status, 'publicat', r.eroare || r.motiv);
  const e = supa.db.tables.barem_explicatii[0];
  assert.strictEqual(e.barem_id, BAREM_EN);
  assert.match(e.file_url, /content-files\/pdf\/evaluare-nationala\/\d+_explicatii-grila_barem-2026-varianta-07-rezerva\.pdf$/);
  assert.strictEqual(e.titlu, 'Explicații la grilă — Barem — 2026 - varianta 07 rezervă');
  const r2 = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/5b', citeste: cititor({ 'explicatii.pdf': PDF }) });
  assert.strictEqual(r2.status, 'conflict');
  await CG.anuleaza(supa, rand(supa, 'u/5a').id);
  assert.strictEqual(supa.db.tables.barem_explicatii.length, 0);
});

// ═══════════════════════════ 9) procedura 6 — testul corectat ═══════════════════════════

test('procedura 6: testul corectat înlocuiește fișierul (originalul rămâne); Anulează readuce fișierul vechi', async () => {
  const supa = fake();
  const vechi = html('Rezolvare: răspunsul e 5.');
  supa.db.files.set('content-files/interactive/evaluare-nationala/4_task_test-20.html', Buffer.from(vechi));
  const nou = html('Rezolvare: scrie rezultatul pasului.');
  const urlVechi = URL('content-files', 'interactive/evaluare-nationala/4_task_test-20.html');
  const r = await CG.proceseazaUnitate(supa, { manifest: { procedura: 6, decizie: 'publica', sursa: { content_id: TEST }, inlocuire: { fisier: 'test.html', file_url_vechi: urlVechi } }, unitate: 'u/6a', citeste: cititor({ 'test.html': Buffer.from(nou) }) });
  assert.strictEqual(r.status, 'publicat', r.eroare || r.motiv);
  const t = supa.db.tables.content.find((c) => c.id === TEST);
  assert.match(t.file_url, /4_task_test-20__corectat-\d{8}-\d{6}\.html$/);
  assert.ok(supa.db.files.has('content-files/interactive/evaluare-nationala/4_task_test-20.html'), 'originalul rămâne în bucket');
  await CG.anuleaza(supa, rand(supa, 'u/6a').id);
  assert.strictEqual(t.file_url, urlVechi);
});

test('procedura 6: corectura care strică testul (mărimea se schimbă prea mult) → ciornă; testul în regulă → „verificat"', async () => {
  const supa = fake();
  supa.db.files.set('content-files/interactive/evaluare-nationala/4_task_test-20.html', Buffer.from(html()));
  const urlVechi = URL('content-files', 'interactive/evaluare-nationala/4_task_test-20.html');
  const r = await CG.proceseazaUnitate(supa, { manifest: { procedura: 6, decizie: 'publica', sursa: { content_id: TEST }, inlocuire: { fisier: 't.html', file_url_vechi: urlVechi } }, unitate: 'u/6b', citeste: cititor({ 't.html': Buffer.from(html('x'.repeat(4000))) }) });
  assert.strictEqual(r.status, 'ciorna');
  assert.match(r.motiv, /mărimea fișierului se schimbă prea mult/);
  assert.strictEqual(supa.db.tables.content.find((c) => c.id === TEST).file_url, urlVechi);
  const v = await CG.proceseazaUnitate(supa, { manifest: { procedura: 6, decizie: 'verificat', sursa: { content_id: TEST }, verificari: { raspunsuri_pe_fata: false } }, unitate: 'u/6c' });
  assert.strictEqual(v.status, 'verificat');
  assert.strictEqual(rand(supa, 'u/6c').sursa_id, TEST);
});

// ═══════════════════════════ 10) jurnalul ═══════════════════════════

test('jurnalul: „nimic", „eșuat", manifest greșit, unitate rămasă „în lucru"', async () => {
  const supa = fake();
  assert.strictEqual((await CG.proceseazaUnitate(supa, { manifest: { procedura: 4, decizie: 'nimic' }, unitate: 'u/n' })).status, 'nimic');
  assert.strictEqual((await CG.proceseazaUnitate(supa, { manifest: { procedura: 1, decizie: 'esuat', motiv: 'textul PDF-ului e ilizibil' }, unitate: 'u/e' })).status, 'esuat');
  const g = await CG.proceseazaUnitate(supa, { manifest: { procedura: 2, decizie: 'publica', interactiv: { fisier: 'a/b.html' } }, unitate: 'u/g' });
  assert.strictEqual(g.status, 'esuat');
  assert.match(rand(supa, 'u/g').eroare, /Manifest greșit/);
  // fișierul lipsă din unitate → eșuat, nimic urcat
  const f = await CG.proceseazaUnitate(supa, { manifest: { procedura: 1, decizie: 'publica', sursa: { content_id: FISA }, barem: { fisier: 'barem.pdf' } }, unitate: 'u/f', citeste: cititor({}) });
  assert.strictEqual(f.status, 'esuat');
  assert.match(f.eroare, /nu există în unitate/);
  // „în lucru" de peste 30 de minute (rulare întreruptă) → eșuat la următoarea rulare
  supa.db.tables.continut_generat.push({ id: ID(7), unitate: 'u/l', procedura: 1, status: 'in_lucru', titlu: 'x', creat_la: '2026-01-01T00:00:00Z', actualizat_la: '2026-01-01T00:00:00Z' });
  const l = await CG.proceseazaUnitate(supa, { manifest: { procedura: 1, decizie: 'nimic' }, unitate: 'u/l' });
  assert.strictEqual(l.status, 'esuat');
});

test('Admin: lista pe grupuri, cu numărătoarea și titlul sursei; linkurile semnate', async () => {
  const supa = fake();
  await CG.proceseazaUnitate(supa, { manifest: { procedura: 1, decizie: 'ciorna', sursa: { content_id: FISA }, barem: { fisier: 'barem.pdf' } }, unitate: 'u/a', citeste: cititor({ 'barem.pdf': PDF }) });
  await CG.proceseazaUnitate(supa, { manifest: { procedura: 4, decizie: 'nimic' }, unitate: 'u/b' });
  const l = await CG.lista(supa, { grup: 'ciorne' });
  assert.strictEqual(l.setup, true);
  assert.strictEqual(l.unitati.length, 1);
  assert.strictEqual(l.unitati[0].sursa.title, 'ALGEBRĂ - Fișă 4: Proporții');
  assert.deepStrictEqual(l.numarare, { ciorne: 1, verificate: 1 });
  const lk = await CG.linkuri(supa, l.unitati[0].id);
  assert.match(lk.fisiere.barem, /\/object\/sign\/content-files-free\/pdf\/clasa-6\/.*ttl=600$/);
  supa.db.failTables.add('continut_generat');
  assert.strictEqual((await CG.lista(supa, {})).setup, false);
});

// ═══════════════════════════ 11) API, fila din Admin, scripturile Action-urilor ═══════════════════════════

test('api/continut-generat.js: doar adminii; acțiunile lista / linkuri / aproba / respinge / anuleaza', () => {
  const src = read('api/continut-generat.js');
  assert.match(src, /await ai\.requireAdmin\(supa, userId\)/);
  for (const a of ['lista', 'linkuri', 'aproba', 'respinge', 'anuleaza']) assert.match(src, new RegExp(`action === '${a}'`));
});

test('Admin: fila „🤖 Conținut generat"', () => {
  const admin = read('src/pages/Admin.jsx');
  assert.match(admin, /import AdminContinutGenerat from '\.\.\/components\/AdminContinutGenerat';/);
  assert.match(admin, /\{ id: 'continut-generat', icon: '🤖', label: 'Conținut generat' \}/);
  assert.match(admin, /tab === 'continut-generat' && <AdminContinutGenerat s=\{s\} \/>/);
  const c = read('src/components/AdminContinutGenerat.jsx');
  assert.match(c, /apiPost\('\/api\/continut-generat', \{ action: 'lista'/);
  for (const a of ['aproba', 'respinge', 'anuleaza', 'linkuri']) assert.ok(c.includes(`'${a}'`), a);
});

test('scripts/continut/publica.js: procesează doar unitățile fără rezultat și scrie rezultate/<unitate>.json', async () => {
  const { proceseazaToate, cheieRezultat } = require('../scripts/continut/publica');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  const u1 = path.join(dir, 'unitati', '2026-11-21', `1-${FISA}`);
  fs.mkdirSync(u1, { recursive: true });
  fs.writeFileSync(path.join(u1, 'manifest.json'), JSON.stringify({ procedura: 1, decizie: 'publica', sursa: { content_id: FISA }, barem: { fisier: 'barem.pdf' } }));
  fs.writeFileSync(path.join(u1, 'barem.pdf'), PDF);
  const u2 = path.join(dir, 'unitati', '2026-11-21', '4-nimic');
  fs.mkdirSync(u2, { recursive: true });
  fs.writeFileSync(path.join(u2, 'manifest.json'), JSON.stringify({ procedura: 4, decizie: 'nimic' }));
  const supa = fake();
  const rez = await proceseazaToate({ dir, supa, log: () => {} });
  assert.deepStrictEqual(rez.map((r) => r.status).sort(), ['nimic', 'publicat']);
  const fr = path.join(dir, 'rezultate', `${cheieRezultat(`2026-11-21/1-${FISA}`)}.json`);
  assert.strictEqual(JSON.parse(fs.readFileSync(fr, 'utf8')).status, 'publicat');
  assert.deepStrictEqual(await proceseazaToate({ dir, supa, log: () => {} }), [], 'a doua rulare: nimic nou');
});

test('scripts/continut/aduce-surse.js: materialul, baremul legat, fișierul model; cererile vechi nu; sursele expiră', async () => {
  const { aduceToate } = require('../scripts/continut/aduce-surse');
  const http = require('../api/_lib/http');
  const supa = fake();
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/2_v07.pdf', PDF);
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/3_bar07.pdf', PDF);
  supa.db.files.set('personal-pdfs/admin/fisiere-model/m.pdf', PDF);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-out-'));
  fs.mkdirSync(path.join(dir, 'cereri'));
  const acum = Date.parse('2026-11-21T10:00:00Z');
  fs.writeFileSync(path.join(dir, 'cereri', '2026-11-21T09-59-00_r1.json'), JSON.stringify({ creat_la: '2026-11-21T09:59:00Z', rulare: 'r1', fisiere: [{ content_id: VARIANTA }, { barem_pentru: VARIANTA }, { model_id: MODEL }, { content_id: ID(8) }, { cale: 'personal-pdfs/altcineva/x.pdf' }] }));
  fs.writeFileSync(path.join(dir, 'cereri', '2026-11-01T00-00-00_vechi.json'), JSON.stringify({ creat_la: '2026-11-01T00:00:00Z', fisiere: [{ content_id: FISA }] }));
  const facute = await aduceToate({ dir, out, supa, http, log: () => {}, acum });
  assert.strictEqual(facute.length, 1, 'cererea veche nu se procesează');
  assert.ok(fs.existsSync(path.join(out, VARIANTA, '2_v07.pdf')));
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(out, VARIANTA, 'meta.json'), 'utf8')).ai_pdf_text.barem_id, BAREM_EN);
  assert.ok(fs.existsSync(path.join(out, VARIANTA, 'barem', '3_bar07.pdf')));
  assert.ok(fs.existsSync(path.join(out, `model-${MODEL}`, 'm.pdf')));
  const gata = JSON.parse(fs.readFileSync(path.join(out, '_gata', '2026-11-21T09-59-00_r1.json'), 'utf8'));
  assert.deepStrictEqual(gata.rezultate.map((r) => r.ok), [true, true, true, false, false]);
  assert.match(gata.rezultate[4].eroare, /element necunoscut/, 'căile oarecare din bucket nu se aduc');
  // a doua rulare: cererea are marcaj → nu se reface
  assert.strictEqual((await aduceToate({ dir, out, supa, http, log: () => {}, acum })).length, 0);
  // după 8 zile, sursele ies de pe ramură
  await aduceToate({ dir, out, supa, http, log: () => {}, acum: acum + 8 * 24 * 3600 * 1000 });
  assert.ok(!fs.existsSync(path.join(out, VARIANTA)));
});
