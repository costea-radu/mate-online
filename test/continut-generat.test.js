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
  app_settings: [],
});
const fake = () => {
  const supa = createFakeSupabase(seed());
  supa.db.unique = { continut_generat: [['unitate']], barem_explicatii: [['barem_id']], app_settings: [['key']] };
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
  rau({ procedura: 2, decizie: 'verificat', sursa: { content_id: TEST } }, /doar pentru procedurile 6 și 9/);
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

// PDF-uri reale (pdf-lib), ca politica de publicare să le poată număra paginile
async function pdfCuPagini(n) {
  const { PDFDocument } = require('pdf-lib');
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([595, 842]);
  return Buffer.from(await d.save());
}

test('procedura 4: varianta EN — PDF-ul cu dreptunghi, copia „fără suprafață neagră", baremul și testul interactiv asociat', async () => {
  const supa = fake();
  const files = { 'varianta.pdf': await pdfCuPagini(10), 'varianta_alb.pdf': await pdfCuPagini(10), 'barem.pdf': PDF, 'test.html': Buffer.from(html()) };
  const m = {
    procedura: 4, decizie: 'publica', surse: [VARIANTA],
    material: { fisier: 'varianta.pdf', title: 'Varianta AI 3 — Evaluare Națională, Matematică' },
    material_alb: { fisier: 'varianta_alb.pdf' }, barem: { fisier: 'barem.pdf' }, interactiv: { fisier: 'test.html' },
  };
  const r = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/4a', citeste: cititor(files) });
  assert.strictEqual(r.status, 'publicat', r.eroare || r.motiv);
  const v = supa.db.tables.content.find((c) => c.subcategory === 'variante-ai');
  assert.deepStrictEqual([v.category, v.is_free], ['evaluare-nationala', false]);
  assert.match(v.file_url, /content-files\/pdf\/evaluare-nationala\//);
  const b = supa.db.tables.content.find((c) => c.title === 'Barem — Varianta AI 3 — Evaluare Națională, Matematică');
  assert.deepStrictEqual([b.subcategory, b.is_free], ['bareme', false]);
  assert.strictEqual(supa.db.tables.ai_pdf_text.find((x) => x.content_id === v.id).barem_override_by, 'claude-skill');
  // copia albă: în același bucket, cu starea botului pagina2 → butonul „⬛ Original / ⬜ Fără suprafață neagră"
  const st = supa.db.tables.app_settings.find((x) => x.key === `pagina2:${v.id}`);
  assert.ok(st, 'starea pagina2 a variantei');
  assert.deepStrictEqual([st.value.v, st.value.status, st.value.file_url, st.value.by], [2, 'curatat', v.file_url, 'claude-skill']);
  assert.strictEqual(st.value.alb.bucket, 'content-files');
  assert.match(st.value.alb.path, /^_pagina2-alb\/claude-skill\/\d+_varianta-ai-3-evaluare-nationala-matematica\.pdf$/);
  const ALB = require('../api/_lib/pagina2Alb');
  assert.deepStrictEqual(ALB.albFromState(v, st.value), st.value.alb, 'vizualizatorul vede copia albă (variante-ai e printre rubricile botului)');
  assert.ok(ALB.isEnTest(v));
  // testul interactiv al variantei: la „Teste interactive", principalul PDF-ului
  const t = supa.db.tables.content.find((c) => c.content_type === 'interactive' && c.pdf_sursa_id === v.id);
  assert.ok(t, 'testul interactiv');
  assert.deepStrictEqual([t.title, t.subcategory, t.interactive_data.agent], ['Varianta AI 3 — Evaluare Națională, Matematică — rezolvare interactivă', 'teste-interactive', 'claude-skill']);
  assert.strictEqual(v.interactiv_id, t.id);
  // titlu dublat → conflict
  const r2 = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/4b', citeste: cititor(files) });
  assert.strictEqual(r2.status, 'conflict');
  // Anulează: tot ce s-a creat dispare (varianta, baremul, testul, starea copiei albe, fișierele)
  await CG.anuleaza(supa, rand(supa, 'u/4a').id);
  assert.ok(!supa.db.tables.content.some((c) => [v.id, b.id, t.id].includes(c.id)));
  assert.ok(!supa.db.tables.app_settings.some((x) => x.key === `pagina2:${v.id}`));
  assert.ok(supa.db.removed.some((x) => x.includes('_pagina2-alb/claude-skill/')));
});

test('procedura 4: fără copia albă / fără testul interactiv / pagini diferite → ciornă, nu publicare', async () => {
  const baza = { procedura: 4, decizie: 'publica', material: { fisier: 'v.pdf', title: 'Varianta AI 4 — Evaluare Națională, Matematică' }, barem: { fisier: 'b.pdf' } };
  const supa = fake();
  const r = await CG.proceseazaUnitate(supa, { manifest: baza, unitate: 'u/4c', citeste: cititor({ 'v.pdf': await pdfCuPagini(10), 'b.pdf': PDF }) });
  assert.strictEqual(r.status, 'ciorna');
  assert.match(r.motiv, /lipsește varianta fără dreptunghiul negru/);
  assert.match(r.motiv, /lipsește testul interactiv asociat/);
  assert.ok(!supa.db.tables.content.some((c) => c.subcategory === 'variante-ai'));
  const r2 = await CG.proceseazaUnitate(supa, {
    manifest: { ...baza, material_alb: { fisier: 'a.pdf' }, interactiv: { fisier: 't.html' } }, unitate: 'u/4d',
    citeste: cititor({ 'v.pdf': await pdfCuPagini(10), 'a.pdf': await pdfCuPagini(9), 'b.pdf': PDF, 't.html': Buffer.from(html()) }),
  });
  assert.strictEqual(r2.status, 'ciorna');
  assert.match(r2.motiv, /varianta fără dreptunghi are 9 pagini, iar varianta cu dreptunghi 10/);
  // ciorna aprobată publică tot: varianta, copia albă, baremul, testul
  const a = await CG.aproba(supa, rand(supa, 'u/4d').id);
  assert.strictEqual(a.status, 'aprobat');
  const v = supa.db.tables.content.find((c) => c.subcategory === 'variante-ai');
  assert.ok(supa.db.tables.app_settings.some((x) => x.key === `pagina2:${v.id}`));
  assert.ok(supa.db.tables.content.some((c) => c.content_type === 'interactive' && c.pdf_sursa_id === v.id));
});

test('procedura 4, regenerarea unei variante: fișierul nou în același rând, copia albă, testul interactiv; baremul rămâne; Anulează readuce tot', async () => {
  const supa = fake();
  const VID = ID(9), BID = ID(8);
  const urlVechi = URL('content-files', 'pdf/evaluare-nationala/1_varianta-ai-1.pdf');
  const urlBarem = URL('content-files', 'pdf/evaluare-nationala/2_barem-varianta-ai-1.pdf');
  supa.db.tables.content.push(
    { id: VID, title: 'Varianta AI 1 — Evaluare Națională, Matematică', category: 'evaluare-nationala', subcategory: 'variante-ai', profile: null, content_type: 'pdf', is_free: false, file_url: urlVechi, interactiv_id: null, pdf_sursa_id: null },
    { id: BID, title: 'Barem — Varianta AI 1 — Evaluare Națională, Matematică', category: 'evaluare-nationala', subcategory: 'bareme', profile: null, content_type: 'pdf', is_free: false, file_url: urlBarem },
  );
  supa.db.tables.ai_pdf_text.push({ content_id: VID, file_url: urlVechi, text: '…', barem_id: BID, barem_status: 'ok_admin', barem_override_id: BID, barem_override_by: 'claude-skill' });
  const files = { 'varianta.pdf': await pdfCuPagini(11), 'varianta_alb.pdf': await pdfCuPagini(11), 'test.html': Buffer.from(html()) };
  const m = {
    procedura: 4, decizie: 'publica', sursa: { content_id: VID },
    material: { fisier: 'varianta.pdf', title: 'Varianta AI 1 — Evaluare Națională, Matematică', file_url_vechi: urlVechi },
    material_alb: { fisier: 'varianta_alb.pdf' }, interactiv: { fisier: 'test.html' },
  };
  const r = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/4r', citeste: cititor(files) });
  assert.strictEqual(r.status, 'publicat', r.eroare || r.motiv);
  const v = supa.db.tables.content.find((c) => c.id === VID);
  assert.notStrictEqual(v.file_url, urlVechi, 'fișierul nou, în același rând');
  assert.match(v.file_url, /content-files\/pdf\/evaluare-nationala\/\d+_varianta-ai-1-evaluare-nationala-matematica\.pdf$/);
  assert.strictEqual(supa.db.tables.content.filter((c) => c.subcategory === 'variante-ai').length, 1, 'niciun rând nou de variantă');
  assert.strictEqual(supa.db.tables.content.find((c) => c.id === BID).file_url, urlBarem, 'baremul rămâne (nu a venit altul)');
  assert.strictEqual(supa.db.tables.ai_pdf_text.find((x) => x.content_id === VID).barem_override_id, BID, 'legătura baremului rămâne');
  const st = supa.db.tables.app_settings.find((x) => x.key === `pagina2:${VID}`);
  assert.deepStrictEqual([st.value.status, st.value.file_url], ['curatat', v.file_url]);
  const t = supa.db.tables.content.find((c) => c.content_type === 'interactive' && c.pdf_sursa_id === VID);
  assert.ok(t);
  assert.strictEqual(v.interactiv_id, t.id);
  // a doua regenerare cu același file_url_vechi → conflict (fișierul s-a schimbat între timp)
  const r2 = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/4r2', citeste: cititor(files) });
  assert.strictEqual(r2.status, 'conflict');
  // Anulează: fișierul vechi revine, starea albă și testul dispar
  await CG.anuleaza(supa, rand(supa, 'u/4r').id);
  assert.strictEqual(v.file_url, urlVechi);
  assert.ok(!supa.db.tables.app_settings.some((x) => x.key === `pagina2:${VID}`));
  assert.ok(!supa.db.tables.content.some((c) => c.id === t.id));
  assert.strictEqual(v.interactiv_id, null);
});

test('procedura 4, regenerarea cu barem nou: fișierul baremului se înlocuiește în rândul lui; altă rubrică → conflict', async () => {
  const supa = fake();
  const VID = ID(9), BID = ID(8);
  const urlVechi = URL('content-files', 'pdf/evaluare-nationala/1_v.pdf');
  const urlBarem = URL('content-files', 'pdf/evaluare-nationala/2_b.pdf');
  supa.db.tables.content.push(
    { id: VID, title: 'Varianta AI 2 — Evaluare Națională, Matematică', category: 'evaluare-nationala', subcategory: 'variante-ai', profile: null, content_type: 'pdf', is_free: false, file_url: urlVechi, interactiv_id: null },
    { id: BID, title: 'Barem — Varianta AI 2 — Evaluare Națională, Matematică', category: 'evaluare-nationala', subcategory: 'bareme', profile: null, content_type: 'pdf', is_free: false, file_url: urlBarem },
  );
  supa.db.tables.ai_pdf_text.push({ content_id: VID, file_url: urlVechi, barem_id: BID, barem_status: 'ok_admin', barem_override_id: BID, barem_override_by: 'claude-skill' });
  const files = { 'v.pdf': await pdfCuPagini(11), 'a.pdf': await pdfCuPagini(11), 'b.pdf': PDF, 't.html': Buffer.from(html()) };
  const m = { procedura: 4, decizie: 'publica', sursa: { content_id: VID }, material: { fisier: 'v.pdf', title: 'x', file_url_vechi: urlVechi }, material_alb: { fisier: 'a.pdf' }, barem: { fisier: 'b.pdf' }, interactiv: { fisier: 't.html' } };
  const r = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/4s', citeste: cititor(files) });
  assert.strictEqual(r.status, 'publicat', r.eroare || r.motiv);
  const b = supa.db.tables.content.find((c) => c.id === BID);
  assert.notStrictEqual(b.file_url, urlBarem);
  assert.match(b.file_url, /content-files\/pdf\/evaluare-nationala\/\d+_barem-varianta-ai-2/);
  assert.strictEqual(supa.db.tables.content.find((c) => c.id === VID).title, 'Varianta AI 2 — Evaluare Națională, Matematică', 'titlul rămâne al variantei');
  await CG.anuleaza(supa, rand(supa, 'u/4s').id);
  assert.strictEqual(b.file_url, urlBarem);
  // regenerarea merge doar pentru variantele AI
  const r3 = await CG.proceseazaUnitate(supa, { manifest: { ...m, sursa: { content_id: VARIANTA }, material: { fisier: 'v.pdf', title: 'x', file_url_vechi: URL('content-files-free', 'pdf/evaluare-nationala/2_v07.pdf') } }, unitate: 'u/4t', citeste: cititor(files) });
  assert.strictEqual(r3.status, 'conflict');
  assert.match(r3.motiv, /Doar variantele din „Variante generate cu AI"/);
  assert.throws(() => CG.normalizeazaManifest({ procedura: 4, decizie: 'publica', sursa: { content_id: VID }, material: { fisier: 'v.pdf', title: 'x' }, barem: { fisier: 'b.pdf' } }, { unitate: 'u/x' }), /file_url_vechi/);
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

// ═══════════════════════════ procedura 7: lecțiile live cu Prof. Tudor (22 nov. 2026) ═══════════════════════════
// „fă o procedură nouă la skill prin care generezi lecțiile live cu profesorul virtual Tudor;
// respecți aceleași reguli de generare, să prezinte baremul și cu rezolvare interactivă pe ecran"
const F7 = require('./tools/lectieLiveSkill');
const LL = require('../api/_lib/liveLesson');
const SUBIECT = ID(7), LECTIE = ID(9);
const URL7 = URL('content-files-free', 'pdf/evaluare-nationala/7_v03.pdf');
const CTX7 = { text: F7.subiectEN(), baremText: F7.baremEN(), baremStatus: 'ok', barem: { id: BAREM_EN, title: 'Barem — 2025 - varianta 03 oficială' } };
const fake7 = ({ lectie = null, barem = true, subiect = {} } = {}) => {
  const supa = fake();
  supa.db.tables.content.push({ id: SUBIECT, title: '2025 - varianta 03 oficială', category: 'evaluare-nationala', subcategory: 'variante', profile: null, content_type: 'pdf', is_free: true, file_url: URL7, interactiv_id: null, pdf_sursa_id: null, ...subiect });
  supa.db.tables.ai_pdf_text.push({ content_id: SUBIECT, file_url: URL7, text: F7.subiectEN(), barem_id: barem ? BAREM_EN : null, barem_status: barem ? 'ok' : 'negasit', barem_text: barem ? F7.baremEN() : '', barem_override_id: null, barem_override_by: null });
  supa.db.tables.live_lessons = lectie ? [{ id: LECTIE, subject_id: SUBIECT, teacher: 'radu', version: 1, status: 'nou', title: null, script: null, progress: {}, locked_until: null, cost_micro: 0, ...lectie }] : [];
  supa.db.unique.live_lessons = [['subject_id', 'teacher', 'version']];
  CG.lectieDeps.pdfContext = async () => CTX7;   // textul + baremul subiectului (ca getPdfContext)
  return supa;
};
const man7 = (extra = {}) => ({ procedura: 7, decizie: 'publica', titlu: 'Lecție live — 2025 - varianta 03 oficială', sursa: { content_id: SUBIECT }, lectie: { fisier: 'lectie.json' }, verificari: { dupa_barem: true, raspunsurile_din_barem: true }, rulare: 'proc7-2026-11-22', ...extra });
const fis7 = (items = F7.itemiEN()) => ({ 'lectie.json': Buffer.from(JSON.stringify({ items })) });
const lectii = (supa) => supa.db.tables.live_lessons;

test('procedura 7: lecția live verificată → publicată direct: rândul live_lessons „script", scrisă de claude-skill, cu aceleași verificări; Anulează o scoate', async () => {
  const supa = fake7();
  const r = await CG.proceseazaUnitate(supa, { manifest: man7(), unitate: '2026-11-22/7-' + SUBIECT, citeste: cititor(fis7()) });
  assert.strictEqual(r.status, 'publicat', r.motiv || r.eroare);
  assert.strictEqual(lectii(supa).length, 1);
  const l = lectii(supa)[0];
  assert.deepStrictEqual([l.subject_id, l.teacher, l.version, l.status, l.title, l.exam], [SUBIECT, 'radu', 1, 'script', '2025 - varianta 03 oficială', 'en']);
  assert.strictEqual(l.script.items.length, 18);
  assert.strictEqual(l.script.writer.model, 'claude-skill');
  assert.strictEqual(l.script.v, 2, 'scrisă cu paginile PDF (nu „fără pagini")');
  assert.strictEqual(l.script.pasi, LL.PASI_V, 'are întrebările pe pași');
  assert.deepStrictEqual(l.script.missing, []);
  assert.ok(l.script.intro.length && l.script.outro.length, 'segmentele fixe ale profesorului (început, final)');
  assert.ok(l.script.items.every((it) => it.intro.every((s) => s.id)), 'id-urile frazelor (vocea se generează pe ele)');
  assert.strictEqual(l.progress.phase, 'voce');
  assert.strictEqual(l.progress.total, LL.segmentsInOrder(l.script).length);
  assert.strictEqual(l.progress.skill.unitate, '2026-11-22/7-' + SUBIECT);
  // „să prezinte baremul și cu rezolvare interactivă pe ecran": explicația pe barem cu punctajele pe tablă,
  // întrebarea grilei pe ecran, întrebările pe pași la fiecare subpunct de la Subiectul al III-lea
  const III1 = l.script.items.find((it) => it.ref === 'III.1');
  assert.ok(III1.modes.barem.some((s) => s.board.some((b) => /\(2p\)/.test(b))));
  assert.deepStrictEqual(III1.steps.map((s) => [s.part, s.type, s.answer]), [['a', 'completare', '2'], ['b', 'completare', '6']]);
  assert.strictEqual(l.script.items.find((it) => it.ref === 'I.4').tryPoll.answer, 'd');
  assert.ok(supa.db.uploads.some((u) => u.bucket === 'content-files' && /^_continut-generat\/lectii-live\/\d+_2025-varianta-03-oficiala\.json$/.test(u.path)));
  assert.deepStrictEqual(r.creat.lectie, { id: l.id, subject_id: SUBIECT, mod: 'nou', title: '2025 - varianta 03 oficială' });
  const lk = await CG.linkuri(supa, r.id);
  assert.deepStrictEqual(lk.site.map((x) => x.url), [`/pdf-viewer?id=${SUBIECT}`, '/admin?tab=live']);
  // Anulează: lecția fără voce încă → rândul dispare
  const a = await CG.anuleaza(supa, r.id);
  assert.strictEqual(a.status, 'anulat');
  assert.strictEqual(lectii(supa).length, 0);
});

test('procedura 7: literele grilelor le dă tabelul baremului (ca la lecțiile scrise de model); rândul gol „nou" se completează, iar Anulează îl readuce', async () => {
  const supa = fake7({ lectie: { status: 'nou' } });
  const items = F7.itemiEN();
  items.find((it) => it.ref === 'I.2').tryPoll.answer = 'b';   // greșit: baremul spune d)
  const r = await CG.proceseazaUnitate(supa, { manifest: man7(), unitate: '2026-11-22/7-gol', citeste: cititor(fis7(items)) });
  assert.strictEqual(r.status, 'publicat', r.motiv || r.eroare);
  assert.strictEqual(lectii(supa).length, 1, 'același rând, nu unul nou');
  const l = lectii(supa)[0];
  assert.deepStrictEqual([l.id, l.status, l.script.items.length], [LECTIE, 'script', 18]);
  assert.strictEqual(l.script.items.find((it) => it.ref === 'I.2').tryPoll.answer, 'd', 'litera din barem are ultimul cuvânt');
  assert.strictEqual(r.creat.lectie.mod, 'completat');
  await CG.anuleaza(supa, r.id);
  assert.deepStrictEqual([lectii(supa)[0].status, lectii(supa)[0].script, lectii(supa)[0].title], ['nou', null, null]);
});

test('procedura 7: subiectul are deja lecție / lecția se scrie chiar acum pe site / fără barem / un barem / profilul pedagogic → conflict, nimic scris', async () => {
  const cazuri = [
    [{ lectie: { status: 'gata', title: 'scrisă', script: { items: [] } } }, /are deja o lecție live \(gata\)/],
    [{ lectie: { status: 'nou', locked_until: new Date(Date.now() + 5 * 60000).toISOString() } }, /se scrie chiar acum/],
    [{ barem: false }, /nu are barem citit/],
    [{ subiect: { subcategory: 'bareme', title: 'Barem — 2025 - varianta 03' } }, /e un barem/],
    [{ subiect: { category: 'bacalaureat', profile: 'pedagogic', title: 'BAC 2025 pedagogic varianta 3' } }, /pedagogic/],
  ];
  for (const [opt, re] of cazuri) {
    const supa = fake7(opt);
    const inainte = JSON.stringify(lectii(supa));
    const r = await CG.proceseazaUnitate(supa, { manifest: man7(), unitate: `2026-11-22/7-${Math.random().toString(36).slice(2, 8)}`, citeste: cititor(fis7()) });
    assert.strictEqual(r.status, 'conflict', `${re}: ${r.status} ${r.motiv || r.eroare}`);
    assert.match(r.motiv, re);
    assert.strictEqual(supa.db.uploads.length, 0, 'nimic urcat');
    assert.strictEqual(JSON.stringify(lectii(supa)), inainte, 'lecțiile rămân neatinse');
  }
});

test('procedura 7: itemi lipsă, subpuncte fără întrebare, grilă cu variante dublate → ciornă (motivul spus); „Aprobă" o publică din fișierul ciornei', async () => {
  const supa = fake7();
  const items = F7.itemiEN({ fara: ['III.6'] });
  for (const sg of items.find((it) => it.ref === 'III.2').modes.barem) sg.ask = null;
  items.find((it) => it.ref === 'II.3').tryPoll.options = ['3 cm', '3 cm', '5 cm', '6 cm'];
  const r = await CG.proceseazaUnitate(supa, { manifest: man7(), unitate: '2026-11-22/7-ciorna', citeste: cititor(fis7(items)) });
  assert.strictEqual(r.status, 'ciorna');
  assert.match(r.motiv, /lipsesc itemii III\.6/);
  assert.match(r.motiv, /subpuncte fără întrebare pe pas \(completate automat din barem\): III\.2/);
  assert.match(r.motiv, /botul de verificare a lecțiilor: .*două variante sunt la fel/);
  assert.strictEqual(lectii(supa).length, 0, 'ciorna nu ajunge la elevi');
  const fl = rand(supa, '2026-11-22/7-ciorna').fisiere.lectie;
  assert.ok(fl && supa.db.files.has(`${fl.bucket}/${fl.path}`), 'fișierul lecției e păstrat pentru aprobare');
  // aprobarea: scriptul se reface din fișierul ciornei (aceleași verificări), apoi se publică
  const a = await CG.aproba(supa, r.id);
  assert.strictEqual(a.status, 'aprobat');
  const l = lectii(supa)[0];
  assert.strictEqual(l.script.items.length, 17);
  assert.deepStrictEqual(l.script.missing, ['III.6']);
  assert.ok(l.script.items.find((it) => it.ref === 'III.2').steps.length > 0, 'subpunctele primesc întrebări din barem (fără AI)');
});

test('procedura 7: lecție cu voce deja generată → Anulează refuză (se șterge din Admin → Meditații live); manifestul cere subiectul și lectie.json', async () => {
  const supa = fake7();
  const r = await CG.proceseazaUnitate(supa, { manifest: man7(), unitate: '2026-11-22/7-voce', citeste: cititor(fis7()) });
  assert.strictEqual(r.status, 'publicat', r.motiv || r.eroare);
  lectii(supa)[0].progress = { ...lectii(supa)[0].progress, audio: { x: { url: 'u', dur: 1 } } };
  await assert.rejects(CG.anuleaza(supa, r.id), /vocea generată/);
  assert.strictEqual(lectii(supa).length, 1, 'lecția rămâne');
  assert.throws(() => CG.normalizeazaManifest({ procedura: 7, decizie: 'publica', lectie: { fisier: 'lectie.json' } }, { unitate: 'a/7-x' }), /sursa\.content_id/);
  assert.throws(() => CG.normalizeazaManifest({ procedura: 7, decizie: 'publica', sursa: { content_id: SUBIECT } }, { unitate: 'a/7-x' }), /„lectie"/);
  assert.throws(() => CG.normalizeazaManifest({ procedura: 7, decizie: 'publica', sursa: { content_id: SUBIECT }, lectie: { fisier: 'lectie.txt' } }, { unitate: 'a/7-x' }), /\.json/);
  assert.throws(() => CG.itemiLectie(Buffer.from('{"items": []}')), /nu conține itemii/);
  assert.throws(() => CG.itemiLectie(Buffer.from('nu e json')), /nu e JSON valid/);
  const r2 = await CG.proceseazaUnitate(fake7(), { manifest: man7(), unitate: '2026-11-22/7-gol2', citeste: cititor({ 'lectie.json': Buffer.from('{"items":[]}') }) });
  assert.strictEqual(r2.status, 'esuat');
  assert.match(r2.eroare, /nu conține itemii/);
});

test('scripts/continut/aduce-surse.js: „lectie_pentru" dă regulile EXACTE ale lecțiilor live (instrucțiunile, cererile pe bucăți, schema) și starea lecției', async () => {
  const { aduceToate } = require('../scripts/continut/aduce-surse');
  const http = require('../api/_lib/http');
  const L = require('../api/_lib/live');
  const supa = fake7({ lectie: { status: 'nou' } });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cg7-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cg7-out-'));
  fs.mkdirSync(path.join(dir, 'cereri'));
  const acum = Date.parse('2026-11-22T10:00:00Z');
  fs.writeFileSync(path.join(dir, 'cereri', '2026-11-22T09-59-00_p7.json'), JSON.stringify({ creat_la: '2026-11-22T09:59:00Z', rulare: 'proc7', fisiere: [{ lectie_pentru: SUBIECT }, { lectie_pentru: FISA }] }));
  await aduceToate({ dir, out, supa, http, log: () => {}, acum, deps: { pdfContext: async () => CTX7 } });
  const gata = JSON.parse(fs.readFileSync(path.join(out, '_gata', '2026-11-22T09-59-00_p7.json'), 'utf8'));
  assert.deepStrictEqual(gata.rezultate.map((r) => r.ok), [true, false]);
  assert.strictEqual(gata.rezultate[0].cale, `${SUBIECT}/lectie/reguli.md`);
  assert.match(gata.rezultate[1].eroare, /doar pentru subiectele de Evaluare Națională și Bacalaureat/);
  const brief = JSON.parse(fs.readFileSync(path.join(out, SUBIECT, 'lectie', 'brief.json'), 'utf8'));
  const teacher = L.teacherById('radu');
  assert.strictEqual(brief.system, LL.systemPrompt(teacher, 'en', null), 'aceleași instrucțiuni ca modelul de pe site');
  assert.deepStrictEqual(brief.schema, JSON.parse(JSON.stringify(LL.SCHEMA)));
  assert.deepStrictEqual(brief.chunks.map((c) => `${c.section}.${c.from}-${c.to}`), ['I.1-3', 'I.4-6', 'II.1-2', 'II.3-4', 'II.5-6', 'III.1-2', 'III.3-4', 'III.5-6']);
  assert.match(brief.chunks[5].prompt, /=== BAREMUL OFICIAL — SUBIECTUL III ===/);
  assert.strictEqual(brief.expected.length, 18);
  assert.deepStrictEqual(brief.grile.I, { 1: 'd', 2: 'd', 3: 'd', 4: 'd', 5: 'd', 6: 'd' });
  const md = fs.readFileSync(path.join(out, SUBIECT, 'lectie', 'reguli.md'), 'utf8');
  assert.match(md, /^# Lecția live cu Prof\. Tudor — „2025 - varianta 03 oficială" \(Evaluarea Națională\)/);
  assert.ok(md.includes(brief.system) && md.includes('### Bucata 8 — Subiectul III, itemii 5–6'));
  assert.match(md, /Literele grilelor din tabelul baremului \(au ultimul cuvânt\): S\. I: 1\) d/);
  const meta = JSON.parse(fs.readFileSync(path.join(out, SUBIECT, 'lectie', 'meta.json'), 'utf8'));
  assert.deepStrictEqual([meta.exam, meta.are_barem, meta.lectie_existenta.status], ['en', true, 'nou']);
  // sursele (și regulile) expiră după 7 zile, ca restul
  await aduceToate({ dir, out, supa, http, log: () => {}, acum: acum + 8 * 24 * 3600 * 1000, deps: { pdfContext: async () => CTX7 } });
  assert.ok(!fs.existsSync(path.join(out, SUBIECT)));
});

// ═══════════════════════════ 26 nov. 2026: procedurile 8, 9, înlocuirea explicațiilor ═══════════════════════════

test('SQL: procedurile 7–9 intră în constrângerea jurnalului (supabase/continut_generat_proceduri.sql)', () => {
  const sql = read('supabase/continut_generat_proceduri.sql');
  assert.match(sql, /drop constraint if exists continut_generat_procedura_check;/);
  assert.match(sql, /add constraint continut_generat_procedura_check check \(procedura between 1 and 9\);/);
  assert.match(read('supabase/continut_generat.sql'), /check \(procedura between 1 and 9\)/);
  assert.deepStrictEqual(Object.keys(CG.PROCEDURI).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('procedura 4, regenerarea unei variante care are deja test interactiv: fără test nou → publicată direct; cu test nou → conflict', async () => {
  const supa = fake();
  const VID = ID(9), TID = ID(7);
  const urlVechi = URL('content-files', 'pdf/evaluare-nationala/1_varianta-ai-3.pdf');
  supa.db.tables.content.push(
    { id: VID, title: 'Varianta AI 3 — Evaluare Națională, Matematică', category: 'evaluare-nationala', subcategory: 'variante-ai', profile: null, content_type: 'pdf', is_free: false, file_url: urlVechi, interactiv_id: TID, pdf_sursa_id: null },
    { id: TID, title: 'Varianta AI 3 — rezolvare interactivă', category: 'evaluare-nationala', subcategory: 'teste-interactive', profile: null, content_type: 'interactive', is_free: false, file_url: URL('content-files', 'interactive/evaluare-nationala/7_t.html'), pdf_sursa_id: VID },
  );
  const files = { 'varianta.pdf': await pdfCuPagini(10), 'varianta_alb.pdf': await pdfCuPagini(10), 'test.html': Buffer.from(html()) };
  const m = { procedura: 4, decizie: 'publica', sursa: { content_id: VID }, material: { fisier: 'varianta.pdf', title: 'x', file_url_vechi: urlVechi }, material_alb: { fisier: 'varianta_alb.pdf' } };
  const r = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/4ra', citeste: cititor(files) });
  assert.strictEqual(r.status, 'publicat', r.eroare || r.motiv);
  const v = supa.db.tables.content.find((c) => c.id === VID);
  assert.notStrictEqual(v.file_url, urlVechi);
  assert.strictEqual(v.interactiv_id, TID, 'testul de acum rămâne asociat');
  assert.strictEqual(supa.db.tables.content.filter((c) => c.content_type === 'interactive').length, 2, 'niciun test nou');
  const r2 = await CG.proceseazaUnitate(supa, { manifest: { ...m, material: { ...m.material, file_url_vechi: v.file_url }, interactiv: { fisier: 'test.html' } }, unitate: 'u/4rb', citeste: cititor(files) });
  assert.strictEqual(r2.status, 'conflict');
  assert.match(r2.motiv, /are deja un test interactiv/);
});

test('procedura 5, înlocuirea explicațiilor: alt fișier în același rând; Anulează readuce fișierul vechi; schimbat între timp → conflict', async () => {
  const supa = fake();
  const urlVechi = URL('content-files', 'pdf/evaluare-nationala/9_explicatii-vechi.pdf');
  supa.db.tables.barem_explicatii.push({ barem_id: BAREM_EN, file_url: urlVechi, titlu: 'Explicații la grilă — vechi' });
  const m = { procedura: 5, decizie: 'publica', sursa: { content_id: BAREM_EN }, explicatii: { fisier: 'explicatii.pdf', file_url_vechi: urlVechi } };
  const r = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/5r', citeste: cititor({ 'explicatii.pdf': PDF }) });
  assert.strictEqual(r.status, 'publicat', r.eroare || r.motiv);
  assert.strictEqual(supa.db.tables.barem_explicatii.length, 1, 'același rând');
  const e = supa.db.tables.barem_explicatii[0];
  assert.notStrictEqual(e.file_url, urlVechi);
  assert.strictEqual(e.titlu, 'Explicații la grilă — vechi', 'titlul rămâne, dacă nu vine altul');
  const r2 = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/5r2', citeste: cititor({ 'explicatii.pdf': PDF }) });
  assert.strictEqual(r2.status, 'conflict');
  assert.match(r2.motiv, /s-au schimbat între timp/);
  await CG.anuleaza(supa, rand(supa, 'u/5r').id);
  assert.strictEqual(supa.db.tables.barem_explicatii.length, 1);
  assert.strictEqual(supa.db.tables.barem_explicatii[0].file_url, urlVechi, 'fișierul vechi revine');
  // fără explicații de înlocuit → conflict
  const supa2 = fake();
  const r3 = await CG.proceseazaUnitate(supa2, { manifest: m, unitate: 'u/5r3', citeste: cititor({ 'explicatii.pdf': PDF }) });
  assert.strictEqual(r3.status, 'conflict');
  assert.match(r3.motiv, /nu are explicații de înlocuit/);
});

test('procedura 8: PDF-ul unui test EN fără PDF → „Variante generate cu AI", baremul, copia albă, asocierea; Anulează: testul rămâne fără PDF', async () => {
  const supa = fake();
  const files = { 'test.pdf': await pdfCuPagini(10), 'test_alb.pdf': await pdfCuPagini(10), 'barem.pdf': PDF };
  const m = { procedura: 8, decizie: 'publica', sursa: { content_id: TEST }, material: { fisier: 'test.pdf', title: 'Test interactiv Evaluare Națională - 20' }, material_alb: { fisier: 'test_alb.pdf' }, barem: { fisier: 'barem.pdf' } };
  const r = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/8a', citeste: cititor(files) });
  assert.strictEqual(r.status, 'publicat', r.eroare || r.motiv);
  const pdf = supa.db.tables.content.find((c) => c.content_type === 'pdf' && c.title === 'Test interactiv Evaluare Națională - 20');
  assert.ok(pdf);
  assert.deepStrictEqual([pdf.category, pdf.subcategory, pdf.is_free], ['evaluare-nationala', 'variante-ai', false]);
  assert.match(pdf.file_url, /content-files\/pdf\/evaluare-nationala\//);
  const t = supa.db.tables.content.find((c) => c.id === TEST);
  assert.strictEqual(t.pdf_sursa_id, pdf.id, 'testul își știe PDF-ul');
  assert.strictEqual(pdf.interactiv_id, TEST, 'PDF-ul își știe testul');
  const barem = supa.db.tables.content.find((c) => c.subcategory === 'bareme' && c.title === 'Barem — Test interactiv Evaluare Națională - 20');
  assert.ok(barem);
  assert.strictEqual(supa.db.tables.ai_pdf_text.find((x) => x.content_id === pdf.id).barem_override_id, barem.id);
  assert.strictEqual(supa.db.tables.app_settings.find((x) => x.key === `pagina2:${pdf.id}`).value.status, 'curatat');
  const l = await CG.linkuri(supa, rand(supa, 'u/8a').id);
  assert.ok(l.site.some((x) => x.url === `/exercitiu?id=${TEST}`));
  // a doua oară: testul are deja PDF → conflict
  const r2 = await CG.proceseazaUnitate(supa, { manifest: m, unitate: 'u/8b', citeste: cititor(files) });
  assert.strictEqual(r2.status, 'conflict');
  assert.match(r2.motiv, /are deja un PDF asociat/);
  await CG.anuleaza(supa, rand(supa, 'u/8a').id);
  assert.strictEqual(t.pdf_sursa_id, null, 'testul rămâne fără PDF');
  assert.ok(!supa.db.tables.content.some((c) => c.id === pdf.id || c.id === barem.id));
  assert.ok(!supa.db.tables.app_settings.some((x) => x.key === `pagina2:${pdf.id}`));
});

test('procedura 8: la EN fără copia albă → ciornă; testul unei clase → PDF în aceeași clasă, fără copie albă; altă rubrică → conflict', async () => {
  const supa = fake();
  const files = { 'test.pdf': await pdfCuPagini(3), 'barem.pdf': PDF };
  const r = await CG.proceseazaUnitate(supa, { manifest: { procedura: 8, decizie: 'publica', sursa: { content_id: TEST }, material: { fisier: 'test.pdf', title: 'Test 20' }, barem: { fisier: 'barem.pdf' } }, unitate: 'u/8c', citeste: cititor(files) });
  assert.strictEqual(r.status, 'ciorna');
  assert.match(r.motiv, /material_alb/);
  const T6 = ID(7);
  supa.db.tables.content.push({ id: T6, title: 'Calcule cu numere întregi', category: 'clasa-6', subcategory: null, profile: null, content_type: 'interactive', is_free: true, file_url: URL('content-files-free', 'interactive/clasa-6/7.html'), pdf_sursa_id: null });
  const r2 = await CG.proceseazaUnitate(supa, { manifest: { procedura: 8, decizie: 'publica', sursa: { content_id: T6 }, material: { fisier: 'test.pdf', title: 'Calcule cu numere întregi — fișă' }, barem: { fisier: 'barem.pdf' } }, unitate: 'u/8d', citeste: cititor(files) });
  assert.strictEqual(r2.status, 'publicat', r2.eroare || r2.motiv);
  const pdf = supa.db.tables.content.find((c) => c.title === 'Calcule cu numere întregi — fișă');
  assert.deepStrictEqual([pdf.category, pdf.subcategory, pdf.is_free], ['clasa-6', null, true]);
  assert.match(pdf.file_url, /content-files-free\/pdf\/clasa-6\//);
  const T7 = ID(6).replace(/^6/, 'a');
  supa.db.tables.content.push({ id: T7, title: 'Recapitulare', category: 'manuale', subcategory: null, profile: null, content_type: 'interactive', is_free: false, file_url: URL('content-files', 'interactive/manuale/x.html'), pdf_sursa_id: null });
  const r3 = await CG.proceseazaUnitate(supa, { manifest: { procedura: 8, decizie: 'publica', sursa: { content_id: T7 }, material: { fisier: 'test.pdf', title: 'x' }, barem: { fisier: 'barem.pdf' } }, unitate: 'u/8e', citeste: cititor(files) });
  assert.strictEqual(r3.status, 'conflict');
});

test('procedura 9: construcția testului — indicații și completare doar cu numere întregi → publicat; răspuns ne-întreg / fără indicații → ciornă; „verificat"', async () => {
  const supa = fake();
  const cale = 'content-files/interactive/evaluare-nationala/4_task_test-20.html';
  supa.db.files.set(cale, Buffer.from(html()));
  const urlVechi = URL('content-files', 'interactive/evaluare-nationala/4_task_test-20.html');
  const cuIndicatii = (s) => s.replace('</body>', '<details class="mt-indicatie"><summary>💡 Indicație</summary>Adună cele două numere.</details></body>');
  const m = (fisier, unitate) => ({ manifest: { procedura: 9, decizie: 'publica', sursa: { content_id: TEST }, inlocuire: { fisier, file_url_vechi: urlVechi } }, unitate });
  // completare cu răspuns 2,5 → ciornă (acolo se cere cu grilă)
  const neintreg = cuIndicatii(html()).replace('"a":"5"', '"a":"2,5"');
  const r1 = await CG.proceseazaUnitate(supa, { ...m('a.html', 'u/9a'), citeste: cititor({ 'a.html': Buffer.from(neintreg) }) });
  assert.strictEqual(r1.status, 'ciorna');
  assert.match(r1.motiv, /nu e număr întreg/);
  // fără indicații → ciornă
  const r2 = await CG.proceseazaUnitate(supa, { ...m('b.html', 'u/9b'), citeste: cititor({ 'b.html': Buffer.from(html()) }) });
  assert.strictEqual(r2.status, 'ciorna');
  assert.match(r2.motiv, /nu au indicații/);
  // în regulă → publicat, fișierul nou în locul celui vechi; Anulează îl readuce
  const r3 = await CG.proceseazaUnitate(supa, { ...m('c.html', 'u/9c'), citeste: cititor({ 'c.html': Buffer.from(cuIndicatii(html())) }) });
  assert.strictEqual(r3.status, 'publicat', r3.eroare || r3.motiv);
  const t = supa.db.tables.content.find((c) => c.id === TEST);
  assert.match(t.file_url, /__corectat-\d{8}-\d{6}\.html$/);
  await CG.anuleaza(supa, rand(supa, 'u/9c').id);
  assert.strictEqual(t.file_url, urlVechi);
  const v = await CG.proceseazaUnitate(supa, { manifest: { procedura: 9, decizie: 'verificat', sursa: { content_id: TEST } }, unitate: 'u/9d' });
  assert.strictEqual(v.status, 'verificat');
  assert.throws(() => CG.normalizeazaManifest({ procedura: 9, decizie: 'publica', sursa: { content_id: TEST }, inlocuire: { fisier: 'c.html' } }, { unitate: 'u/x' }), /file_url_vechi/);
});
