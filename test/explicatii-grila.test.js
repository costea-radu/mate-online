// =====================================================================
// test/explicatii-grila.test.js — „💡 EXPLICAȚII LA GRILĂ" în baremul oficial de EN
// (18 nov. 2026): „Pune barem cu explicații pt grila la evaluare națională. Baremul
// oficial oferă doar rezolvarea grilei fără explicații. În baremul oficial pune buton
// pentru explicații la grilă. Explicația la grilă o să fie generată ulterior și încărcată."
//
// supabase/explicatii_grila.sql (tabela, RLS, GRANT-urile din CLAUDE.md),
// api/_lib/explicatiiGrila.js (starea, linkul semnat, încărcarea, lista), api/bareme.js
// (acțiunile), src/components/ExplicatiiGrila.jsx (butonul + fereastra), src/pages/PDFViewer.jsx,
// src/components/AdminExplicatiiGrila.jsx + Admin (fila „💡 Explicații grilă").
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const EG = require('../api/_lib/explicatiiGrila');
const { createFakeSupabase } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const ID_GRATUIT = '11111111-1111-4111-8111-111111111111';
const ID_PREMIUM = '22222222-2222-4222-8222-222222222222';
const ID_BAC = '33333333-3333-4333-8333-333333333333';
const ID_SUBIECT = '44444444-4444-4444-8444-444444444444';
const URL_PDF = (n) => `https://fake.supabase/storage/v1/object/public/content-files/pdf/evaluare-nationala/${n}_explicatii-grila_EN_2025.pdf`;

const seed = () => ({
  content: [
    { id: ID_GRATUIT, title: 'Barem — Evaluare Națională 2025 — Matematică, Varianta 3', category: 'evaluare-nationala', subcategory: 'bareme', content_type: 'pdf', is_free: true, file_url: 'https://x/a.pdf', created_at: '2026-01-02T00:00:00Z' },
    { id: ID_PREMIUM, title: 'Barem — Evaluare Națională 2026 — Simulare județeană Ilfov', category: 'evaluare-nationala', subcategory: 'bareme', content_type: 'pdf', is_free: false, file_url: 'https://x/b.pdf', created_at: '2026-01-03T00:00:00Z' },
    { id: ID_BAC, title: 'Barem — Bacalaureat 2025', category: 'bacalaureat', subcategory: 'bareme', content_type: 'pdf', is_free: true, file_url: 'https://x/c.pdf', created_at: '2026-01-04T00:00:00Z' },
    { id: ID_SUBIECT, title: 'Evaluare Națională 2024 — Varianta 1', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf', is_free: true, file_url: 'https://x/d.pdf', created_at: '2026-01-05T00:00:00Z' },
  ],
  barem_explicatii: [],
});

// ═══════════════════════════ 1) tabela ═══════════════════════════

test('SQL: tabela barem_explicatii cu RLS, GRANT-urile din CLAUDE.md (fără anon) și politica serverului', () => {
  const sql = read('supabase/explicatii_grila.sql');
  assert.match(sql, /create table if not exists public\.barem_explicatii \(/);
  assert.match(sql, /barem_id\s+uuid primary key references public\.content\(id\) on delete cascade/);
  // CLAUDE.md: în același fișier, imediat după crearea tabelei
  const dupa = sql.slice(sql.indexOf('create table if not exists public.barem_explicatii'));
  assert.match(dupa, /\);\nalter table public\.barem_explicatii enable row level security;\n\ngrant select, insert, update, delete on public\.barem_explicatii to authenticated;\ngrant select, insert, update, delete on public\.barem_explicatii to service_role;/);
  assert.doesNotMatch(sql, /to anon/, 'datele nu sunt publice: fără acces direct pentru vizitatori');
  // privilegiile implicite ale proiectului dau tabelelor noi acces și pentru anon → scos explicit
  assert.match(sql, /\nrevoke all on public\.barem_explicatii from anon;\n/);
  assert.match(sql, /create policy barem_explicatii_service on public\.barem_explicatii for all to service_role/);
});

// ═══════════════════════════ 2) serverul ═══════════════════════════

test('starea: doar la baremele de EN; fără link; tabela lipsă → setup: false', async () => {
  const supa = createFakeSupabase(seed());
  assert.deepStrictEqual(await EG.stare(supa, ID_GRATUIT), { ok: true, en: true, setup: true, exista: false, titlu: null, actualizat: null, gratuit: true });
  assert.deepStrictEqual(await EG.stare(supa, ID_BAC), { ok: true, en: false, setup: true, exista: false });
  supa.db.tables.barem_explicatii.push({ barem_id: ID_PREMIUM, file_url: URL_PDF(1), titlu: 'Explicații — Ilfov', updated_at: '2026-11-18T10:00:00Z' });
  const s = await EG.stare(supa, ID_PREMIUM);
  assert.deepStrictEqual([s.exista, s.titlu, s.gratuit], [true, 'Explicații — Ilfov', false]);
  assert.ok(!JSON.stringify(s).includes('storage'), 'fără adresa fișierului');
  const lipsa = createFakeSupabase(seed());
  lipsa.db.failTables.add('barem_explicatii');
  assert.strictEqual((await EG.stare(lipsa, ID_GRATUIT)).setup, false);
  await assert.rejects(EG.stare(supa, 'nu-e-uuid'), (e) => e.status === 400);
  await assert.rejects(EG.stare(supa, '55555555-5555-4555-8555-555555555555'), (e) => e.status === 404);
});

test('linkul: cu regulile baremului — gratuit → oricine; Premium → abonații și adminii', async () => {
  const supa = createFakeSupabase(seed());
  supa.db.tables.barem_explicatii.push(
    { barem_id: ID_GRATUIT, file_url: URL_PDF(1), titlu: 'Explicații V3' },
    { barem_id: ID_PREMIUM, file_url: URL_PDF(2), titlu: 'Explicații Ilfov' },
  );
  const g = await EG.link(supa, ID_GRATUIT, { profil: null });
  assert.match(g.url, /\/object\/sign\/content-files\/pdf\/evaluare-nationala\/1_explicatii-grila_EN_2025\.pdf\?token=t&ttl=300$/);
  await assert.rejects(EG.link(supa, ID_PREMIUM, { profil: null }), (e) => e.status === 401);
  await assert.rejects(EG.link(supa, ID_PREMIUM, { profil: { subscription_status: 'canceled', is_admin: false } }), (e) => e.status === 403 && /abonament/.test(e.message));
  assert.ok((await EG.link(supa, ID_PREMIUM, { profil: { subscription_status: 'active' } })).url);
  assert.ok((await EG.link(supa, ID_PREMIUM, { profil: { subscription_status: null, is_admin: true } })).url);
  await assert.rejects(EG.link(supa, ID_SUBIECT, { profil: null }), (e) => e.status === 404, 'fără explicații încărcate');
  await assert.rejects(EG.link(supa, ID_BAC, { profil: null }), (e) => e.status === 404, 'doar EN');
});

test('adminul: încarcă (doar PDF, în content-files, la EN), înlocuiește (fișierul vechi se șterge), șterge, listează', async () => {
  const supa = createFakeSupabase(seed());
  // locul fișierului
  await assert.rejects(EG.salveaza(supa, { baremId: ID_GRATUIT, fileUrl: 'https://fake.supabase/storage/v1/object/public/content-files-free/pdf/evaluare-nationala/1_a.pdf' }), (e) => e.status === 400);
  await assert.rejects(EG.salveaza(supa, { baremId: ID_GRATUIT, fileUrl: 'https://fake.supabase/storage/v1/object/public/content-files/pdf/clasa-6/1_a.pdf' }), (e) => e.status === 400);
  await assert.rejects(EG.salveaza(supa, { baremId: ID_GRATUIT, fileUrl: 'https://fake.supabase/storage/v1/object/public/content-files/pdf/evaluare-nationala/1_a.docx' }), (e) => e.status === 400);
  await assert.rejects(EG.salveaza(supa, { baremId: ID_BAC, fileUrl: URL_PDF(1) }), (e) => e.status === 400, 'doar baremele de EN');
  // încărcarea + înlocuirea
  const s1 = await EG.salveaza(supa, { baremId: ID_GRATUIT, fileUrl: URL_PDF(1), titlu: '  Explicații   V3 ', userId: 'admin-1' });
  assert.deepStrictEqual([s1.exista, s1.titlu], [true, 'Explicații V3']);
  assert.strictEqual(supa.db.tables.barem_explicatii.length, 1);
  await EG.salveaza(supa, { baremId: ID_GRATUIT, fileUrl: URL_PDF(2), titlu: '' });
  assert.strictEqual(supa.db.tables.barem_explicatii.length, 1, 'un singur PDF pe barem');
  assert.strictEqual(supa.db.tables.barem_explicatii[0].titlu, 'Explicații la grilă');
  assert.deepStrictEqual(supa.db.removed, ['content-files/pdf/evaluare-nationala/1_explicatii-grila_EN_2025.pdf'], 'fișierul vechi s-a șters');
  // lista: baremele de EN (nu subiectele fără explicații, nu BAC), cu starea lor
  const l = await EG.lista(supa);
  assert.deepStrictEqual(l.bareme.map((b) => [b.id, !!b.explicatie]), [[ID_PREMIUM, false], [ID_GRATUIT, true]]);
  assert.strictEqual(l.cuExplicatii, 1);
  // ștergerea
  const s2 = await EG.sterge(supa, { baremId: ID_GRATUIT });
  assert.strictEqual(s2.exista, false);
  assert.strictEqual(supa.db.tables.barem_explicatii.length, 0);
  assert.ok(supa.db.removed.includes('content-files/pdf/evaluare-nationala/2_explicatii-grila_EN_2025.pdf'));
  // tabela lipsă → spune ce e de rulat
  const lipsa = createFakeSupabase(seed());
  lipsa.db.failTables.add('barem_explicatii');
  await assert.rejects(EG.salveaza(lipsa, { baremId: ID_GRATUIT, fileUrl: URL_PDF(1) }), (e) => e.status === 409 && /explicatii_grila\.sql/.test(e.message));
  assert.strictEqual((await EG.lista(lipsa)).setup, false);
});

test('api/bareme: starea și linkul merg și fără cont; încărcarea / ștergerea / lista — doar adminul', () => {
  const b = read('api/bareme.js');
  assert.match(b, /const EG = require\('\.\/_lib\/explicatiiGrila'\);/);
  assert.match(b, /const PUBLICE = new Set\(\['clasa', 'explicatii', 'explicatii_url'\]\);/);
  const iPublic = b.indexOf("if (action === 'explicatii') return res.status(200).json(await EG.stare(supa, body.baremId));");
  const iUrl = b.indexOf("if (action === 'explicatii_url') return res.status(200).json(await EG.link(supa, body.baremId, { profil }));");
  const iAdmin = b.indexOf("if (!admin) return res.status(403)");
  const iLista = b.indexOf("if (action === 'explicatii_lista')");
  assert.ok(iPublic > 0 && iUrl > iPublic && iAdmin > iUrl && iLista > iAdmin, 'citirea înaintea verificării de admin, scrierile după');
  assert.match(b, /select\('id, is_admin, role, subscription_status'\)/, 'abonamentul pentru baremele Premium');
  assert.match(b, /EG\.salveaza\(supa, \{ baremId: body\.baremId, fileUrl: body\.fileUrl, titlu: body\.titlu, userId: profil\.id \}\)/);
});

// ═══════════════════════════ 3) interfața ═══════════════════════════

test('vizualizatorul: „💡 Explicații la grilă" cât se vede un barem de EN — elevul doar când există, adminul mereu', () => {
  const c = read('src/components/ExplicatiiGrila.jsx');
  assert.match(c, /if \(!stare \|\| !stare\.en\) return null;\n\s+if \(!stare\.exista && !admin\) return null;/);
  assert.match(c, /<Link to="\/admin\?tab=explicatii"/, 'adminul: unde le încarcă');
  assert.match(c, /postBareme\(\{ action: 'explicatii_url', baremId \}\)/);
  assert.match(c, /<PdfCanvasViewer key=\{st\.url\} data=\{st\.data\} blobUrl=\{st\.url\}/);
  assert.match(c, /role="dialog" aria-modal="true" aria-label="Explicații la grilă"/);
  assert.match(c, /if \(e\.key === 'Escape'\)/);

  const v = read('src/pages/PDFViewer.jsx');
  assert.match(v, /import \{ useExplicatiiGrila, ButonExplicatii, ExplicatiiOverlay \} from '\.\.\/components\/ExplicatiiGrila';/);
  assert.match(v, /const enBaremId = !modTest && !isLib && item\?\.category === 'evaluare-nationala' && \(baremView\.open \|\| baremEsteDeschis\)/);
  assert.match(v, /\? \(\(baremEsteDeschis \|\| baremView\.inclus\) \? \(item\?\.id \|\| null\) : \(barem\?\.id \|\| null\)\)/, 'cheia: baremul separat, sau PDF-ul deschis');
  // hook-ul stă înaintea întoarcerilor timpurii ale paginii
  assert.ok(v.indexOf('const explicatii = useExplicatiiGrila(enBaremId);') < v.indexOf('  if (authLoading || loading) {'));
  assert.match(v, /<ButonExplicatii stare=\{explicatii\} admin=\{isAdmin\} loc="antet"/, 'în antetul baremului deschis cu „📋 Barem"');
  assert.strictEqual((v.match(/\{explicatiiBtn\}/g) || []).length, 2, 'în bara de sus, pe telefon și pe calculator');
  assert.strictEqual((v.match(/\{explicatiiJsx\}/g) || []).length, 2);
  assert.match(v, /const explicatiiBtn = !showBaremDoc && enBaremId && \(/);
});

test('Admin: fila „💡 Explicații grilă" — lista baremelor de EN, încărcare PDF în content-files, la EN', () => {
  const a = read('src/pages/Admin.jsx');
  assert.match(a, /\{ id: 'explicatii',  icon: '💡', label: 'Explicații grilă' \}/);
  assert.match(a, /\{tab === 'explicatii'  && <AdminExplicatiiGrila s=\{s\} \/>\}/);
  const p = read('src/components/AdminExplicatiiGrila.jsx');
  assert.match(p, /apiPost\('\/api\/bareme', \{ action: 'explicatii_lista' \}\)/);
  assert.match(p, /const path = `pdf\/evaluare-nationala\/\$\{Date\.now\(\)\}_explicatii-grila_\$\{safeFileName\(file\.name\)\}`;/);
  assert.match(p, /supabase\.storage\.from\('content-files'\)\.upload\(path, file, \{ contentType: 'application\/pdf' \}\)/);
  assert.match(p, /action: 'explicatii_salveaza', baremId: b\.id, fileUrl:/);
  assert.match(p, /uitaExplicatii\(b\.id\);/, 'vizualizatorul nu mai ține starea veche');
  assert.match(p, /Rulează întâi <code>supabase\/explicatii_grila\.sql<\/code>/);
  // prefixul și bucket-ul sunt aceleași ca validarea serverului
  assert.strictEqual(EG.PREFIX, 'pdf/evaluare-nationala/');
  assert.strictEqual(EG.BUCKET, 'content-files');
});
