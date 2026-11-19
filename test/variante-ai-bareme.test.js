// =====================================================================
// test/variante-ai-bareme.test.js — 19 nov. 2026:
//   1. „La categoria Evaluare Națională, la teste de antrenament, adaugă sub simulări o
//      secțiune «variante generate cu AI». În admin adaugă secțiunea de încărcare."
//   2. „În admin pune o secțiune de încărcare bareme la orice categorie. Baremele să se
//      poată și șterge sau face modificări din secțiunea «tot conținutul»."
//
// Rubrica `variante-ai` (src/lib/contentMeta.js, api/_lib/contentAdmin.js, pagina EN,
// src/lib/rubricaMaterial.js), api/bareme.js (incarca_barem, sterge_barem, legaturi),
// src/components/AdminBareme.jsx, src/components/AdminVarianteAI.jsx, src/pages/Admin.jsx
// („📋 Tot Conținutul": „📋 Doar bareme", ștergerea pe server).
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const CA = require('../api/_lib/contentAdmin');
const B = require('../api/bareme');
const { createFakeSupabase } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const U = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const URL_F = (bucket, p) => `https://fake.supabase/storage/v1/object/public/${bucket}/${p}`;

// ═══════════════════════════ 1) „Variante generate cu AI" la EN ═══════════════════════════

test('rubrica „variante-ai": în Admin, în validarea serverului și pe pagina EN, sub Simulări', async () => {
  const meta = await import('../src/lib/contentMeta.js');
  const subs = meta.EN_SUBCATEGORIES.map((x) => x.value);
  assert.deepStrictEqual(subs.slice(subs.indexOf('simulari'), subs.indexOf('simulari') + 3), ['simulari', 'variante-ai', 'bareme']);
  assert.strictEqual(meta.subcategoryLabel('evaluare-nationala', 'variante-ai'), 'Variante generate cu AI (Teste antrenament)');
  assert.deepStrictEqual(meta.visibleTypesFor('evaluare-nationala', 'variante-ai'), ['pdf']);
  assert.strictEqual(meta.visibilityWarning({ category: 'evaluare-nationala', subcategory: 'variante-ai', content_type: 'pdf' }), null, 'apare pe site');
  assert.ok(!meta.BAC_SUBCATEGORIES.some((x) => x.value === 'variante-ai'), 'doar la EN');
  // serverul acceptă rubrica la editare
  assert.ok(CA.SUBCATEGORIES['evaluare-nationala'].includes('variante-ai'));
  const ok = CA.sanitizeUpdate({ subcategory: 'variante-ai' }, { category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf' });
  assert.deepStrictEqual([ok.errors, ok.patch], [[], { subcategory: 'variante-ai' }]);
  assert.ok(CA.sanitizeUpdate({ subcategory: 'variante-ai' }, { category: 'bacalaureat', content_type: 'pdf' }).errors.length, 'nu la BAC');
  // pagina EN: secțiunea, între „Simulări" și „Bareme"
  const en = read('src/pages/EvaluareNationala.jsx');
  const iSim = en.indexOf('<Section title="Simulări"');
  const iAi = en.indexOf('<Section title="Variante generate cu AI" icon="🤖" level={2} defaultOpen={openOnly([\'variante-ai\'])}>');
  const iBar = en.indexOf('<Section title="Bareme"');
  assert.ok(iSim > 0 && iAi > iSim && iBar > iAi, 'sub Simulări, deasupra Baremelor');
  assert.match(en, /<ItemBlock category="evaluare-nationala" subcategory="variante-ai" contentType="pdf" returnTab="pdf"/);
  assert.match(en, /openOnly\(\['exercitii-subiecte', 'variante', 'simulari', 'variante-ai', 'bareme'\]\)/, 'întoarcerea dintr-un test deschide secțiunea');
});

test('rubrica automată: „Varianta generată cu AI" → variante-ai (doar la EN); baremul ei → bareme', async () => {
  const { rubricaAuto } = await import('../src/lib/rubricaMaterial.js');
  const en = (title, fileName = '') => rubricaAuto({ title, fileName, category: 'evaluare-nationala', contentType: 'pdf' }).subcategory;
  assert.strictEqual(en('Varianta generată cu AI 3'), 'variante-ai');
  assert.strictEqual(en('Evaluare Națională — variantă AI 2'), 'variante-ai');
  assert.strictEqual(en('Model de test generat de inteligența artificială'), 'variante-ai');
  assert.strictEqual(en('Test 4', 'EN_2027_ai-generat_4.pdf'), 'variante-ai', 'și după numele fișierului');
  assert.strictEqual(en('Barem — Varianta generată cu AI 3'), 'bareme');
  assert.strictEqual(en('Evaluare Națională 2025 — Matematică, Simulare județeană Ilfov (mai)'), 'simulari');
  assert.strictEqual(en('Ce ai învățat — fișă'), '', '„ai" ca verb nu e AI');
  assert.strictEqual(rubricaAuto({ title: 'Varianta generată cu AI 3', category: 'bacalaureat', contentType: 'pdf' }).subcategory, 'variante');
  // agentul AI poate trimite direct în rubrica nouă
  assert.match(read('src/components/AIExerciseAgent.jsx'), /\['variante-ai', 'Variante generate cu AI'\],/);
});

test('Admin → „✨ Variante AI (EN)": varianta în rubrica variante-ai + baremul ei, legat; lista cu baremele', () => {
  const v = read('src/components/AdminVarianteAI.jsx');
  assert.match(v, /const EN = 'evaluare-nationala';\nconst RUBRICA = 'variante-ai';/);
  assert.match(v, /category: EN, subcategory: RUBRICA, profile: null, content_type: 'pdf',/);
  assert.match(v, /await incarcaBaremPdf\(\{ file: barem, category: EN, materialId: nou\.id, title: `Barem — \$\{nou\.title\}`, isFree: form\.is_free \}\);/);
  assert.match(v, /apiPost\('\/api\/bareme', \{ action: 'legaturi', materialIds: rows\.map\(\(x\) => x\.id\) \}\)/);
  assert.match(v, /\.eq\('category', EN\)\.eq\('subcategory', RUBRICA\)\.eq\('content_type', 'pdf'\)/);
  const a = read('src/pages/Admin.jsx');
  assert.match(a, /\{ id: 'variante-ai', icon: '✨', label: 'Variante AI \(EN\)' \}/);
  assert.match(a, /\{tab === 'variante-ai' && <AdminVarianteAI s=\{s\} onSuccess=\{\(\) => setRefreshList\(r => r \+ 1\)\} \/>\}/);
});

// ═══════════════════════════ 2) baremele oricărei categorii ═══════════════════════════

const seed = () => ({
  content: [
    { id: U(1), title: 'Varianta generată cu AI 1', category: 'evaluare-nationala', subcategory: 'variante-ai', profile: null, content_type: 'pdf', is_free: true, file_url: URL_F('content-files-free', 'pdf/evaluare-nationala/1_v.pdf'), created_at: '2026-11-19T00:00:00Z' },
    { id: U(2), title: 'Fișă — Numere întregi 13', category: 'clasa-6', subcategory: null, profile: null, content_type: 'pdf', is_free: false, file_url: URL_F('content-files', 'pdf/clasa-6/2_f.pdf'), created_at: '2026-11-19T00:00:00Z' },
    { id: U(3), title: 'Bacalaureat 2026 — M_mate-info, Varianta 4', category: 'bacalaureat', subcategory: 'variante', profile: 'mate-info', content_type: 'pdf', is_free: false, file_url: URL_F('content-files', 'pdf/bacalaureat/3_b.pdf'), created_at: '2026-11-19T00:00:00Z' },
    { id: U(4), title: 'Barem — Fișă — Numere întregi 12', category: 'clasa-6', subcategory: 'bareme', profile: null, content_type: 'pdf', is_free: false, file_url: URL_F('content-files', 'pdf/clasa-6/4_b.pdf'), created_at: '2026-11-18T00:00:00Z' },
    { id: U(5), title: 'Fișă — Numere întregi 12', category: 'clasa-6', subcategory: null, profile: null, content_type: 'pdf', is_free: false, file_url: URL_F('content-files', 'pdf/clasa-6/5_f.pdf'), created_at: '2026-11-18T00:00:00Z' },
  ],
  ai_pdf_text: [
    // fișa 12 folosește baremul 4 după potrivirea automată (titlu) — cache valid
    { content_id: U(5), file_url: URL_F('content-files', 'pdf/clasa-6/5_f.pdf'), barem_status: 'ok', barem_id: U(4), barem: { matchedBy: 'titlu' }, barem_override_id: null, text: 'fișa', updated_at: '2026-11-18T00:00:00Z' },
  ],
});

test('incarca_barem: orice clasă sau examen; cu materialul ales, se leagă de el (ca „admin")', async () => {
  const supa = createFakeSupabase(seed());
  const r = await B.incarcaBarem(supa, { category: 'evaluare-nationala', materialId: U(1), fileUrl: URL_F('content-files-free', 'pdf/evaluare-nationala/9_barem.pdf'), title: '' });
  assert.strictEqual(r.barem.title, 'Barem — Varianta generată cu AI 1');
  assert.deepStrictEqual(r.legatDe, { id: U(1), title: 'Varianta generată cu AI 1', is_free: true });
  const rand = supa.db.tables.content.find((x) => x.id === r.barem.id);
  assert.deepStrictEqual([rand.category, rand.subcategory, rand.content_type, rand.is_free, rand.profile], ['evaluare-nationala', 'bareme', 'pdf', true, null]);
  const leg = supa.db.tables.ai_pdf_text.find((x) => x.content_id === U(1));
  assert.deepStrictEqual([leg.barem_override_id, leg.barem_override_by], [r.barem.id, 'admin']);
  // la o clasă, fără material; titlul primește „Barem — "
  const c = await B.incarcaBarem(supa, { category: 'clasa-6', fileUrl: URL_F('content-files', 'pdf/clasa-6/9_b.pdf'), title: 'Numere întregi — fișa 14' });
  assert.deepStrictEqual([c.barem.title, c.legatDe], ['Barem — Numere întregi — fișa 14', null]);
  // BAC: profilul (din material, dacă nu e ales)
  const bac = await B.incarcaBarem(supa, { category: 'bacalaureat', materialId: U(3), fileUrl: URL_F('content-files', 'pdf/bacalaureat/9_b.pdf') });
  assert.strictEqual(supa.db.tables.content.find((x) => x.id === bac.barem.id).profile, 'mate-info');
  await assert.rejects(B.incarcaBarem(supa, { category: 'bacalaureat', fileUrl: URL_F('content-files', 'pdf/bacalaureat/9_c.pdf'), title: 'x' }), (e) => e.status === 400 && /profilul/.test(e.message));
  // validările
  await assert.rejects(B.incarcaBarem(supa, { category: 'manuale', fileUrl: URL_F('content-files', 'pdf/manuale/1.pdf') }), (e) => e.status === 400);
  await assert.rejects(B.incarcaBarem(supa, { category: 'clasa-6', materialId: U(1), fileUrl: URL_F('content-files', 'pdf/clasa-6/1.pdf') }), (e) => e.status === 400 && /altă categorie/.test(e.message));
  await assert.rejects(B.incarcaBarem(supa, { category: 'clasa-6', materialId: U(4), fileUrl: URL_F('content-files', 'pdf/clasa-6/1.pdf') }), (e) => e.status === 400 && /el însuși un barem/.test(e.message));
  await assert.rejects(B.incarcaBarem(supa, { category: 'clasa-6', fileUrl: URL_F('content-files', 'pdf/clasa-7/1.pdf'), title: 'x' }), (e) => e.status === 400, 'la materialele categoriei');
  await assert.rejects(B.incarcaBarem(supa, { category: 'clasa-6', fileUrl: URL_F('alt-bucket', 'pdf/clasa-6/1.pdf'), title: 'x' }), (e) => e.status === 400);
  await assert.rejects(B.incarcaBarem(supa, { category: 'clasa-6', fileUrl: URL_F('content-files', 'pdf/clasa-6/1.docx'), title: 'x' }), (e) => e.status === 400);
});

test('legaturi: ce material folosește fiecare barem (manual sau automat) și ce barem are fiecare material', async () => {
  const supa = createFakeSupabase(seed());
  const r = await B.incarcaBarem(supa, { category: 'evaluare-nationala', materialId: U(1), fileUrl: URL_F('content-files-free', 'pdf/evaluare-nationala/9_barem.pdf') });
  const l = await B.legaturiAdmin(supa, { baremIds: [r.barem.id, U(4)], materialIds: [U(1), U(2), U(5)] });
  assert.deepStrictEqual(l.bareme[r.barem.id], [{ id: U(1), title: 'Varianta generată cu AI 1', cum: 'admin' }]);
  assert.deepStrictEqual(l.bareme[U(4)], [{ id: U(5), title: 'Fișă — Numere întregi 12', cum: 'automat' }]);
  assert.deepStrictEqual(l.materiale[U(1)], { id: r.barem.id, cum: 'admin', title: 'Barem — Varianta generată cu AI 1' });
  assert.deepStrictEqual(l.materiale[U(5)], { id: U(4), cum: 'automat', title: 'Barem — Fișă — Numere întregi 12' });
  assert.strictEqual(l.materiale[U(2)], null, 'fișa fără barem');
});

test('sterge_barem: rândul, apoi potrivirile automate din cache (recalcul) și fișierul; doar bareme', async () => {
  const supa = createFakeSupabase(seed());
  await assert.rejects(B.stergeBarem(supa, U(5)), (e) => e.status === 400 && /nu e un barem/.test(e.message));
  const r = await B.stergeBarem(supa, U(4));
  assert.strictEqual(r.sters, U(4));
  assert.ok(!supa.db.tables.content.some((x) => x.id === U(4)));
  const cache = supa.db.tables.ai_pdf_text.find((x) => x.content_id === U(5));
  assert.deepStrictEqual([cache.barem_id, cache.barem_status, cache.updated_at], [null, 'negasit', new Date(0).toISOString()], 'fișa își va căuta alt barem la prima deschidere');
  assert.deepStrictEqual(supa.db.removed, ['content-files/pdf/clasa-6/4_b.pdf']);
  await assert.rejects(B.stergeBarem(supa, U(4)), (e) => e.status === 404);
});

test('api/bareme: încărcarea, ștergerea și legăturile — doar adminul', () => {
  const b = read('api/bareme.js');
  const iAdmin = b.indexOf("if (!admin) return res.status(403)");
  for (const a of ["if (action === 'incarca_barem') return res.status(200).json(await incarcaBarem(supa, body));",
    "if (action === 'sterge_barem') return res.status(200).json(await stergeBarem(supa, body.baremId));",
    "if (action === 'legaturi') return res.status(200).json(await legaturiAdmin(supa, body));"]) {
    assert.ok(b.indexOf(a) > iAdmin, a);
  }
  assert.match(b, /const CATEGORII_BAREM = new Set\(\['clasa-5', 'clasa-6', 'clasa-7', 'clasa-8', 'clasa-9', 'clasa-10', 'clasa-11', 'clasa-12', 'evaluare-nationala', 'bacalaureat'\]\);/);
});

test('Admin → „✅ Încarcă bareme": orice clasă sau examen, materialul (opțional), profilul la BAC', () => {
  const c = read('src/components/AdminBareme.jsx');
  assert.match(c, /export const CATEGORII_BAREM = CATEGORIES\.filter\(\(c\) => c\.value !== 'manuale'\);/);
  assert.match(c, /\.eq\('category', form\.category\)\.eq\('content_type', 'pdf'\)/);
  assert.match(c, /setMateriale\(\(data \|\| \[\]\)\.filter\(\(r\) => !esteBarem\(r\)\)\)/, 'în listă — materialele, nu baremele');
  assert.match(c, /const path = `pdf\/\$\{category\}\/\$\{Date\.now\(\)\}_\$\{safeFileName\(file\.name\) \|\| 'barem\.pdf'\}`;/);
  assert.match(c, /apiPost\('\/api\/bareme', \{ action: 'incarca_barem', category, profile: profile \|\| null, materialId: materialId \|\| null, fileUrl:/);
  assert.match(c, /if \(bac && !form\.profile\) \{ setMsg\(\{ type: 'error', text: 'Alege profilul de Bacalaureat\.' \}\); return; \}/);
  const a = read('src/pages/Admin.jsx');
  assert.match(a, /\{ id: 'bareme',      icon: '✅', label: 'Încarcă bareme' \}/);
  assert.match(a, /\{tab === 'bareme'      && <AdminBareme s=\{s\} onSuccess=\{\(\) => setRefreshList\(r => r \+ 1\)\} \/>\}/);
  // zona de încărcare, comună
  assert.match(a, /import FileUploadZone from '\.\.\/components\/FileUploadZone';/);
  assert.strictEqual((a.match(/<FileUploadZone s=\{s\}/g) || []).length, 2);
  assert.match(read('src/components/FileUploadZone.jsx'), /export default function FileUploadZone\(\{ s, accept, label, hint, file, onFile, icon \}\)/);
});

test('„📋 Tot Conținutul": „📋 Doar bareme", eticheta „📋 Barem", cine îl folosește; ștergerea baremelor pe server', () => {
  const a = read('src/pages/Admin.jsx');
  assert.match(a, /<option value="bareme">📋 Doar bareme<\/option>/);
  assert.match(a, /\(!filter\.kind \|\| \(filter\.kind === 'bareme' \? esteBarem\(i\) : !esteBarem\(i\)\)\)/);
  assert.match(a, />📋 Barem<\/span>/);
  assert.match(a, /apiPost\('\/api\/bareme', \{ action: 'legaturi', baremIds: ids \}\)/);
  assert.match(a, /🔗 Folosit de:/);
  assert.match(a, /async function handleDelete\(item\) \{\n\s+if \(esteBarem\(item\)\) return stergeBaremul\(item\);/);
  assert.match(a, /apiPost\('\/api\/bareme', \{ action: 'sterge_barem', baremId: item\.id \}\)/);
  // celelalte materiale: rândul întâi; dacă baza de date îl refuză, fișierul și lista rămân
  const iDel = a.indexOf("const { error: delErr } = await supabase.from('content').delete().eq('id', item.id);");
  const iStorage = a.indexOf('await supabase.storage.from(bucket).remove([storagePath]);');
  assert.ok(iDel > 0 && iStorage > iDel, 'ștergerea rândului înaintea fișierului');
  assert.match(a, /if \(delErr\) \{\n\s+setDeleting\(null\);\n\s+alert\(`Materialul nu a putut fi șters: \$\{delErr\.message\}`\);\n\s+return;\n\s+\}/);
  // editarea rămâne cea de până acum (✏️ Editează, 🔁 Înlocuiește) — și pentru bareme
  assert.match(a, /✏️ Editează/);
  assert.match(a, /🔁 Înlocuiește/);
});
