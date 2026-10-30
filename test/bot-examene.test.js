// =====================================================================
// test/bot-examene.test.js — cererea din 30 octombrie 2026 (3, punctul 2):
//   „fă un bot care să caute permanent pe internet modele de examen, variante
//    oficiale (date în sesiune, rezerve, pentru olimpici), simulări, teste de
//    antrenament, bareme — EN, BAC Tehnologic, BAC Științele Naturii, BAC
//    Mate-Info — să le încarce și să le publice fiecare la rubrica lui (PDF),
//    examenul ȘI baremul. Să verifice toate fișierele încărcate: au barem? Dacă
//    nu, să-l caute pe internet și să-l încarce. Numele din site, numele
//    original al fișierului și conținutul să se potrivească exact. În Admin:
//    raport + butoane. Întâi bot (fără AI), pentru economie."
//
// Fără rețea: PDF-uri reale generate cu pdf-lib (antetele oficiale), un „internet"
// simulat (edupedu cu API-ul WordPress, subiecte.edu.ro care refuză roboții,
// edu.ro cu o arhivă, pagina ISJ Sibiu) și Supabase simulat.
// =====================================================================
process.env.CRON_SECRET = process.env.CRON_SECRET || 'secret-test-cron';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PDFDocument, StandardFonts } = require('pdf-lib');

const E = require('../api/_lib/examBot');
const N = require('../api/_lib/examBotNet');
const R = require('../api/_lib/examBotRun');
const B = require('../api/_lib/barem');
const { unzip, makeZip } = require('../api/_lib/unzip');
const http = require('../api/_lib/http');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const NOW = new Date('2026-10-30T12:00:00Z');

// ─── Antetele oficiale (din test/barem.test.js — așa ies din pdf-parse) ──────
const SRC = read('test/barem.test.js');
const grab = (n) => SRC.match(new RegExp(`const ${n} = \`([\\s\\S]*?)\`;`))[1].replace(/\\\\/g, '\\');
const EN_V7 = grab('EN_TEST_2024_V7');
const EN_B7 = grab('EN_BAREM_2024_V7');
const BAC_V5 = grab('BAC_TEST_2024_V5');
const BAC_B5 = grab('BAC_BAREM_2024_V5');
const EN_V1_2023 = EN_V7.replace(/2023 – 2024/g, '2022 – 2023').replace(/Varianta 7/g, 'Varianta 1').replace(/120 m/g, '140 m').replace(/BC = 75 m/g, 'BC = 85 m').replace(/360 de produse/g, '420 de produse').replace(/36 cm/g, '42 cm').replace(/240 cm, 150 cm și 95 cm/g, '260 cm, 140 cm și 85 cm');
const EN_B1_2023 = EN_B7.replace(/2023 – 2024/g, '2022 – 2023').replace(/Varianta 7/g, 'Varianta 1').replace(/120/g, '140').replace(/\b75\b/g, '85').replace(/360/g, '420').replace(/\b36\b/g, '42').replace(/240 · 150 · 95/g, '260 · 140 · 85');
const EN_B2 = EN_B7.replace(/Varianta 7/g, 'Varianta 2').replace(/SUBIECTUL al III-lea[\s\S]*?(?=Probă scrisă)/, 'SUBIECTUL al III-lea (30 de puncte)\n1. a) 850 · 12/100 = 102 lei 2p\nb) 748 de lei 3p\n2. a) n = 28 2p\nb) 1260 de lei 3p\n3. a) E(2) = 15 2p\nb) (x − 1)(x + 11) 3p\n4. a) AB = 14 cm 2p\nb) 49√3 cm² 3p\n5. a) 12960 cm³ 2p\nb) 3528 cm² 3p\n6. a) l = 26 cm 2p\nb) 338√3 cm² 3p\n');
const SIBIU_TEST = `INSPECTORATUL ȘCOLAR JUDEȚEAN SIBIU
Anul școlar 2026-2027
Examenul de bacalaureat național 2027
Proba E. c)
Matematică M_mate-info
Test de antrenament — octombrie
Filiera teoretică, profilul real, specializarea matematică-informatică
• Toate subiectele sunt obligatorii. Se acordă zece puncte din oficiu.
SUBIECTUL I (30 de puncte)
5p 1. Arătați că numărul a = 2(3 − 7i) + 14i este natural.
5p 2. Determinați numărul real m pentru care f(1) = 13, unde f(x) = x² + mx + 7.
5p 3. Rezolvați în mulțimea numerelor reale ecuația 3^(x+1) = 81.
5p 4. Calculați probabilitatea ca un număr de două cifre să fie multiplu de 17.
5p 5. Determinați distanța dintre punctele A(2, 3) și B(14, 8).
5p 6. Calculați sin² 37° + cos² 37°.
SUBIECTUL al II-lea (30 de puncte)
1. Se consideră matricea A(x) cu det(A(x)) = 4x − 11.
5p a) Arătați că det(A(3)) = 1.
SUBIECTUL al III-lea (30 de puncte)
1. Se consideră funcția f(x) = x³ − 27x + 54.
5p a) Arătați că f'(x) = 3(x − 3)(x + 3).`;
const MAGHIAR = `Oktatási Minisztérium
Érettségi vizsga 2024
Matematika M_mate-info
1. feladat (5 pont) Számítsd ki a következő kifejezés értékét. Határozd meg a függvény értékét. Igazold, hogy az egyenlet megoldása 3.
2. feladat (5 pont) Számítsd ki. Határozd meg a halmaz elemeit.`;

const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\x20-\x7E\n–—•²³°·]/g, ' ');
async function pdfOf(text) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  let page = doc.addPage([595, 842]);
  let y = 800;
  for (const l of strip(text).split('\n')) {
    if (y < 40) { page = doc.addPage([595, 842]); y = 800; }
    page.drawText(l.slice(0, 115), { x: 36, y, size: 8.5, font });
    y -= 11;
  }
  return Buffer.from(await doc.save());
}

// ─── „Internetul" simulat ────────────────────────────────────────────────────
function fakeWeb(routes) {
  const calls = [];
  const fetchImpl = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', ua: (opts.headers || {})['user-agent'] });
    let r = routes[url];
    if (typeof r === 'function') r = r(url, opts);
    if (!r) for (const [k, v] of Object.entries(routes)) if (k.endsWith('*') && url.startsWith(k.slice(0, -1))) { r = typeof v === 'function' ? v(url, opts) : v; break; }
    if (!r) return new Response('not found', { status: 404, headers: { 'content-type': 'text/html' } });
    const body = r.body === undefined ? '' : r.body;
    return new Response((opts.method || 'GET') === 'HEAD' ? null : body, { status: r.status || 200, headers: { 'content-type': r.type || 'text/html; charset=utf-8', ...(r.headers || {}) } });
  };
  return { fetchImpl, calls };
}
const lookup = async () => [{ address: '93.115.1.10', family: 4 }];
const netWith = (web, extra = {}) => (opts) => new N.Net({ ...opts, fetchImpl: web.fetchImpl, lookup, hostGapMs: 0, ...extra });

const CDN = 'https://cdn.edupedu.ro/wp-content/uploads';
const a = (href, text) => `<a href="${href}">${text}</a>`;
const post = (title, link, date, links) => ({ title: { rendered: title }, link, date, content: { rendered: `<p>${title}</p>${links.map(([h, t]) => `<p>${a(h, t)} ${a(h, 'Download')}</p>`).join('')}` } });

let PDFS;
async function buildPdfs() {
  if (PDFS) return PDFS;
  PDFS = {
    enV7: await pdfOf(EN_V7), enB7: await pdfOf(EN_B7), enB2: await pdfOf(EN_B2),
    enV1_2023: await pdfOf(EN_V1_2023), enB1_2023: await pdfOf(EN_B1_2023),
    bacV5: await pdfOf(BAC_V5), bacB5: await pdfOf(BAC_B5),
    sibiu: await pdfOf(SIBIU_TEST), maghiar: await pdfOf(MAGHIAR),
  };
  return PDFS;
}

function webFor(P, { subiecteRobots = 'User-agent: *\nDisallow: /\n' } = {}) {
  const posts = [
    post('Bacalaureat 2024 Matematică – sesiunea specială pentru olimpici: subiectele și baremele pentru mate-info, științe ale naturii, tehnologic și pedagogic, publicate de Ministerul Educației',
      'https://www.edupedu.ro/bacalaureat-2024-matematica-sesiunea-speciala-pentru-olimpici-subiectele-si-baremele/', '2024-05-22T10:00:00', [
        [`${CDN}/2024/05/E_c_matematica_M_mate-info_2024_var_05_LRO.pdf`, 'E_c_matematica_M_mate-info_2024_var_05_LRO'],
        [`${CDN}/2024/05/E_c_matematica_M_mate-info_2024_bar_05_LRO.pdf`, 'E_c_matematica_M_mate-info_2024_bar_05_LRO'],
        [`${CDN}/2024/05/E_c_matematica_M_mate-info_2024_var_05_LMA.pdf`, 'E_c_matematica_M_mate-info_2024_var_05_LMA'],
        [`${CDN}/2024/05/E_c_matematica_M_pedagogic_2024_var_05_LRO.pdf`, 'E_c_matematica_M_pedagogic_2024_var_05_LRO'],
      ]),
    post('Baremul de corectare pentru proba de Matematică de la Evaluarea Națională 2024', 'https://www.edupedu.ro/baremul-de-corectare-pentru-proba-de-matematica-de-la-evaluarea-nationala-2024/', '2024-06-26T10:00:00', [
      [`${CDN}/2024/06/ENVIII_Matematica_2024_Bar_07_LRO.pdf`, 'ENVIII_Matematica_2024_Bar_07_LRO'],
      [`${CDN}/2024/06/ENVIII_Matematica_2024_Var_07_LRO.pdf`, 'ENVIII_Matematica_2024_Var_07_LRO'],
    ]),
    post('Rezultatele la Evaluarea Națională 2024 pe județe', 'https://www.edupedu.ro/rezultatele-la-evaluarea-nationala-2024-pe-judete-si-medii/', '2024-07-01T10:00:00', [
      [`${CDN}/2024/07/rezultate.pdf`, 'rezultate'],
    ]),
  ];
  const post2023 = [post('Evaluarea Națională 2023: baremul de la Matematică, publicat de Ministerul Educației', 'https://www.edupedu.ro/evaluarea-nationala-2023-baremul-de-la-matematica-publicat-de-ministerul-educatiei/', '2023-06-27T10:00:00', [
    [`${CDN}/2023/06/ENVIII_Matematica_2023_Bar_01_LRO.pdf`, 'ENVIII_Matematica_2023_Bar_01_LRO'],
  ])];
  const pdf = (buf) => ({ body: buf, type: 'application/pdf' });
  return fakeWeb({
    'https://www.edupedu.ro/robots.txt': { body: 'User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n', type: 'text/plain' },
    'https://cdn.edupedu.ro/robots.txt': { status: 404 },
    'https://subiecte.edu.ro/robots.txt': { body: subiecteRobots, type: 'text/plain' },
    'https://edu.ro/robots.txt': { status: 404 },
    'https://sbisj.ro/robots.txt': { status: 404 },
    'https://www.edupedu.ro/wp-json/wp/v2/posts*': (url) => {
      const q = decodeURIComponent(new URL(url).searchParams.get('search') || '');
      return { body: JSON.stringify(/2023/.test(q) ? post2023 : posts), type: 'application/json' };
    },
    [`${CDN}/2024/05/E_c_matematica_M_mate-info_2024_var_05_LRO.pdf`]: pdf(P.bacV5),
    [`${CDN}/2024/05/E_c_matematica_M_mate-info_2024_bar_05_LRO.pdf`]: pdf(P.bacB5),
    [`${CDN}/2024/05/E_c_matematica_M_mate-info_2024_var_05_LMA.pdf`]: pdf(P.maghiar),
    [`${CDN}/2024/06/ENVIII_Matematica_2024_Bar_07_LRO.pdf`]: pdf(P.enB7),
    [`${CDN}/2024/06/ENVIII_Matematica_2024_Var_07_LRO.pdf`]: pdf(P.enV7),
    [`${CDN}/2023/06/ENVIII_Matematica_2023_Bar_01_LRO.pdf`]: pdf(P.enB1_2023),
    'https://edu.ro/modele_subiecte_examene_nationale': { body: `<html><head><title>Modele de subiecte 2027</title></head><body>${a('https://subiecte.edu.ro/2027/evaluarenationala/modeledesubiecte/EN_VIII_2027_Matematica_model.zip', 'matematică')}</body></html>` },
    'https://sbisj.ro/Noutati/': { body: `<html><head><title>Noutăți ISJ Sibiu</title></head><body>${a('/files/Test_antrenament_BAC_MI_octombrie-2026.pdf', 'Test de antrenament BAC matematică M_mate-info, octombrie 2026')} ${a('/despre', 'Despre noi')}</body></html>` },
    'https://sbisj.ro/files/Test_antrenament_BAC_MI_octombrie-2026.pdf': pdf(P.sibiu),
  });
}

// Site-ul de pornire: un subiect de EN 2024 (V7) FĂRĂ barem, baremul altei variante,
// un subiect de EN 2023 fără barem și o fișă pe capitole (nu are nevoie de barem)
const FAKE = 'https://fake.supabase/storage/v1/object/public/content-files-free/';
const C = { en7: 'aaaaaaaa-0000-4000-8000-000000000007', enB2: 'aaaaaaaa-0000-4000-8000-0000000000b2', en1: 'aaaaaaaa-0000-4000-8000-000000002301', fisa: 'aaaaaaaa-0000-4000-8000-00000000f15a' };
const ADMIN = '99999999-9999-4999-8999-999999999999';
async function seedSite(P) {
  const supa = createFakeSupabase({
    profiles: [{ id: ADMIN, is_admin: true }, { id: 'eeeeeeee-0000-4000-8000-000000000001', is_admin: false }],
    content: [
      { id: C.en7, title: 'Evaluare Națională 2024 — Varianta 7', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf', is_free: true, file_url: `${FAKE}pdf/evaluare-nationala/1700000000001_EN_2024_V7.pdf`, created_at: '2025-01-01T10:00:00Z' },
      { id: C.enB2, title: 'Barem EN 2024 varianta 2', category: 'evaluare-nationala', subcategory: 'bareme', content_type: 'pdf', is_free: true, file_url: `${FAKE}pdf/evaluare-nationala/1700000000002_barem_2024_v2.pdf`, created_at: '2025-01-01T10:00:00Z' },
      { id: C.en1, title: 'EN 2023 — subiectul de matematică', category: 'evaluare-nationala', subcategory: 'variante', content_type: 'pdf', is_free: true, file_url: `${FAKE}pdf/evaluare-nationala/1700000000003_ENVIII_Matematica_2023_var_01_LRO.pdf`, created_at: '2025-01-01T10:00:00Z' },
      { id: C.fisa, title: 'Capitolul 3 — Fracții (fișă)', category: 'evaluare-nationala', subcategory: 'capitole', content_type: 'pdf', is_free: true, file_url: `${FAKE}pdf/evaluare-nationala/1700000000004_fisa.pdf`, created_at: '2025-01-01T10:00:00Z' },
    ],
    exam_bot_items: [], exam_bot_index: [], exam_bot_runs: [], exam_bot_pages: [], ai_pdf_text: [], ai_broadcasts: [], ai_broadcast_reads: [], app_settings: [],
  });
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000001_EN_2024_V7.pdf', P.enV7);
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000002_barem_2024_v2.pdf', P.enB2);
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000003_ENVIII_Matematica_2023_var_01_LRO.pdf', P.enV1_2023);
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000004_fisa.pdf', P.enB2);
  return supa;
}
// PDF-urile de pe site: descărcarea „publică" pică → serverul ia fișierul din Storage (ca în producție, la eroare)
const realFetch = global.fetch;
test.before(() => { global.fetch = async () => { throw new Error('rețea oprită în teste'); }; });
test.after(() => { global.fetch = realFetch; R.setNetFactory(null); });

// ═══════════════════════════════════════════════════════════════════════════
// 1. Clasificarea linkurilor (numele reale ale fișierelor oficiale)
// ═══════════════════════════════════════════════════════════════════════════
test('linkuri: numele oficiale BAC / EN (var / bar), limbile minorităților, pedagogic, alte materii', () => {
  const L = (url, extra = {}) => E.classifyLink({ url, ...extra });
  let x = L(`${CDN}/2025/05/E_c_matematica_M_mate-info_2025_var_03_LRO.pdf`);
  assert.deepStrictEqual([x.exam, x.profile, x.year, x.variant, x.isBarem, x.lang, x.download], ['bac', 'mate-info', '2025', '3', false, 'ro', true]);
  x = L(`${CDN}/2025/05/E_c_matematica_M_st-nat_2025_bar_03_LRO.pdf`);
  assert.deepStrictEqual([x.profile, x.isBarem], ['stiinte-naturii', true]);
  x = L(`${CDN}/2026/08/E_c_matematica_M_tehnologic_2026_var_04_LRO-1.pdf`);
  assert.deepStrictEqual([x.profile, x.year, x.variant], ['tehnologic', '2026', '4'], 'sufixul „-1" al WordPress nu strică nimic');
  x = L(`${CDN}/2025/06/ENVIII_Matematica_2025_Var_07_LRO.pdf`);
  assert.deepStrictEqual([x.exam, x.profile, x.variant, x.isBarem], ['en', null, '7', false]);
  assert.strictEqual(L(`${CDN}/2025/06/ENVIII_Matematica_2025_Bar_07_LRO.pdf`).isBarem, true);
  // variantele traduse și profilul pedagogic nu se descarcă
  for (const u of [`${CDN}/2026/08/E_c_matematica_M_mate-info_2026_var_04_LGE.pdf`, `${CDN}/2026/08/E_c_matematica_M_st-nat_2026_var_04_LMA.pdf`,
    `${CDN}/2025/12/SARBA_Subiect-simulare-BAC-MI_dec-2025-v1.pdf`, `${CDN}/2025/12/MAGHIARA_Subiect-simulare-BAC-TEHNO_dec-2025.pdf`]) {
    assert.strictEqual(L(u).download, false, u);
  }
  assert.match(L(`${CDN}/2025/05/E_c_matematica_M_pedagogic_2025_var_03_LRO.pdf`).reasons.join(), /pedagogic/);
  assert.match(L(`${CDN}/2025/12/subiect-var.1-simulare-Bac-Peda2025-2.pdf`).reasons.join(), /pedagogic/);
  assert.match(L(`${CDN}/2025/06/E_c_istorie_2025_var_02_LRO.pdf`).reasons.join(), /altă materie|nu pare/);
  assert.strictEqual(L('https://www.edupedu.ro/articol/').download, false, 'nu e PDF');
});

test('linkuri: simularea județeană din Timiș (dec. 2025 = examenul din 2026), testele ISJ Sibiu (MI / SN)', () => {
  const t = 'Simulare Matematică Bacalaureat 2026: subiectele și baremele de la testarea din județul Timiș pentru mate-info, tehnologic, științe ale naturii și pedagogic';
  const x = E.classifyLink({ url: `${CDN}/2025/12/ROMANA_Subiect-simulare-BAC_MI_-dec-2025-v1.pdf`, text: 'ROMANA_Subiect simulare BAC_MI_ dec 2025 v1', pageTitle: t });
  assert.deepStrictEqual([x.exam, x.profile, x.year, x.judet, x.luna, x.lang, x.download], ['bac', 'mate-info', '2026', 'Timiș', 'decembrie', 'ro', true]);
  assert.strictEqual(x.signals.own.simulare, true);
  const b = E.classifyLink({ url: `${CDN}/2025/12/Barem-simulare-BAC-dec-2025_MI.pdf`, pageTitle: t });
  assert.deepStrictEqual([b.isBarem, b.profile, b.year], [true, 'mate-info', '2026']);
  const sn = E.classifyLink({ url: `${CDN}/2025/05/Model_BAC_SN_aprilie-2025.pdf`, pageTitle: 'Teste de antrenament la Matematică pentru Bacalaureat 2025, publicate de Inspectoratul Școlar Sibiu' });
  assert.deepStrictEqual([sn.profile, sn.judet, sn.luna, sn.signals.ctx.antrenament], ['stiinte-naturii', 'Sibiu', 'aprilie', true]);
  // contextul cu mai multe profiluri nu decide profilul unui fișier fără profil în nume
  assert.strictEqual(E.classifyLink({ url: `${CDN}/x/barem_simulare.pdf`, pageTitle: t }).profile, null);
  assert.strictEqual(E.judetFromHost('sbisj.ro'), 'Sibiu');
  assert.strictEqual(E.judetFromHost('isjtm.ro'), 'Timiș');
  assert.strictEqual(E.judetFromHost('isj.vs.edu.ro'), 'Vaslui');
  assert.strictEqual(E.judetFromHost('www.isjiasi.ro'), 'Iași');
  assert.strictEqual(E.judetFromHost('edupedu.ro'), null);
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Decizia (antetul PDF-ului + contextul) → rubrica și titlul
// ═══════════════════════════════════════════════════════════════════════════
const dec = (link, text, settings) => E.decide(E.classifyLink(link), E.classifyDoc(text), { now: NOW, settings });

test('decizie: sesiunea specială (olimpici), toamna, rezerva, simularea națională, modelul — rubrica și titlul', () => {
  let d = dec({ url: `${CDN}/2024/05/E_c_matematica_M_mate-info_2024_var_05_LRO.pdf`, pageTitle: 'Bacalaureat 2024 Matematică – sesiunea specială pentru olimpici: subiectele și baremele' }, BAC_V5);
  assert.deepStrictEqual([d.status, d.confidence, d.cls.tip, d.cls.profile], ['ok', 'sigur', 'speciala', 'mate-info']);
  assert.deepStrictEqual(E.rubricFor(d.cls), { category: 'bacalaureat', subcategory: 'variante', profile: 'mate-info' });
  assert.strictEqual(E.titleFor(d.cls), 'Bacalaureat 2024 — Matematică M_mate-info, Varianta 5 (sesiunea specială pentru olimpici)');
  d = dec({ url: `${CDN}/2024/08/E_c_matematica_M_mate-info_2024_bar_05_LRO.pdf`, pageTitle: 'Bacalaureat 2024, sesiunea de toamnă. Subiecte și bareme la Matematică', pageDate: '2024-08-12' }, BAC_B5);
  assert.deepStrictEqual([d.cls.tip, d.cls.luna, d.cls.isBarem], ['sesiune', 'august', true]);
  assert.deepStrictEqual(E.rubricFor(d.cls), { category: 'bacalaureat', subcategory: 'bareme', profile: 'mate-info' });
  assert.strictEqual(E.titleFor(d.cls), 'Barem — Bacalaureat 2024 — Matematică M_mate-info, Varianta 5 (sesiunea de toamnă, august)');
  // EN: o singură sesiune (iunie); varianta de rezervă din titlul articolului
  d = dec({ url: `${CDN}/2024/06/ENVIII_Matematica_2024_Var_07_LRO.pdf`, pageTitle: 'Subiectele de la Matematică, Evaluarea Națională 2024' }, EN_V7);
  assert.deepStrictEqual([d.cls.exam, d.cls.tip, d.cls.luna, E.rubricFor(d.cls).subcategory], ['en', 'sesiune', 'iunie', 'variante']);
  d = dec({ url: `${CDN}/2024/06/ENVIII_Matematica_2024_Var_07_LRO.pdf`, pageTitle: 'Evaluare Națională 2024. Varianta de rezervă de la proba de Matematică' }, EN_V7);
  assert.strictEqual(d.cls.tip, 'rezerva');
  assert.match(E.titleFor(d.cls), /Varianta 7 \(varianta de rezervă\)$/);
  // simularea națională: în numele fișierului și în antet
  d = dec({ url: `${CDN}/2024/03/E_c_matematica_M_mate-info_2024_var_simulare_LRO.pdf`, pageTitle: 'Simulare BAC 2024 la Matematică, publicată de Ministerul Educației' }, BAC_V5.replace(/Varianta 5/g, 'Simulare'));
  assert.deepStrictEqual([d.cls.tip, d.cls.scope, E.rubricFor(d.cls).subcategory], ['simulare', 'nationala', 'simulari']);
  // modelul oficial: EN → „Variante Date + Modele", BAC → „Simulări + Modele"
  d = dec({ url: 'https://subiecte.edu.ro/2024/evaluarenationala/modeledesubiecte/EN_VIII_Matematica_2024_model.pdf' }, EN_V7.replace(/Varianta 7/g, 'Model'));
  assert.deepStrictEqual([d.cls.tip, E.rubricFor(d.cls).subcategory], ['model', 'variante']);
  assert.match(E.titleFor(d.cls), /Model oficial de subiect$/);
  d = dec({ url: 'https://subiecte.edu.ro/2024/bacalaureat/modeledesubiecte/probescrise/E_c_matematica_M_mate-info_2024_model.pdf' }, BAC_V5.replace(/Varianta 5/g, 'Model'));
  assert.deepStrictEqual([d.cls.tip, E.rubricFor(d.cls).subcategory], ['model', 'simulari']);
});

test('decizie: testul ISJ Sibiu → „Teste de antrenament"; materialele județene vechi, anii vechi, altă limbă → ignorate', () => {
  let d = dec({ url: 'https://sbisj.ro/files/Test_antrenament_BAC_MI_octombrie-2026.pdf', pageUrl: 'https://sbisj.ro/Noutati/' }, SIBIU_TEST);
  assert.deepStrictEqual([d.status, d.confidence, d.cls.tip, d.cls.judet, d.cls.year], ['ok', 'sigur', 'antrenament', 'Sibiu', '2027'], JSON.stringify(d));
  assert.deepStrictEqual(E.rubricFor(d.cls), { category: 'bacalaureat', subcategory: 'teste-antrenament', profile: 'mate-info' });
  assert.strictEqual(E.titleFor(d.cls), 'Bacalaureat 2027 — Matematică M_mate-info, Test de antrenament (ISJ Sibiu, octombrie)');
  // ISJ din 2024 (setarea implicită: doar ultimii 2 ani școlari)
  d = dec({ url: 'https://sbisj.ro/files/Test_antrenament_BAC_MI_aprilie-2024.pdf' }, SIBIU_TEST.replace('2026-2027', '2023-2024').replace('național 2027', 'național 2024'));
  assert.strictEqual(d.status, 'ignorat');
  assert.match(d.reasons.join(), /material județean/);
  // subiectele oficiale mai vechi decât anul minim
  d = dec({ url: `${CDN}/2016/06/E_c_matematica_M_mate-info_2016_var_05_LRO.pdf` }, BAC_V5.replace(/2024/g, '2016'));
  assert.strictEqual(d.status, 'ignorat');
  assert.match(d.reasons.join(), /mai vechi/);
  d = dec({ url: `${CDN}/2016/06/E_c_matematica_M_mate-info_2016_var_05_LRO.pdf` }, BAC_V5.replace(/2024/g, '2016'), { minYear: 2010 });
  assert.strictEqual(d.status, 'ok', 'anul minim se poate coborî din setări');
  // textul în maghiară
  d = dec({ url: `${CDN}/2024/05/fisier.pdf`, pageTitle: 'Bacalaureat 2024 matematică' }, MAGHIAR + '\nSUBIECTUL I');
  assert.strictEqual(d.status, 'ignorat');
  // BAC Tehnologic oprit din setări
  d = dec({ url: `${CDN}/2024/05/E_c_matematica_M_tehnologic_2024_var_05_LRO.pdf` }, BAC_V5.replace(/M_mate-info/g, 'M_tehnologic').replace('Filiera teoretică, profilul real, specializarea matematică-informatică', 'Filiera tehnologică: profilul servicii'), { exams: { tehnologic: false } });
  assert.strictEqual(d.status, 'ignorat');
  assert.match(d.reasons.join(), /Tehnologic e oprit/);
});

test('decizie: fără text (PDF scanat), antet care contrazice numele, felul neclar → „De verificat" (nesigur)', () => {
  let d = E.decide(E.classifyLink({ url: `${CDN}/2024/06/ENVIII_Matematica_2024_Var_07_LRO.pdf`, pageTitle: 'Evaluarea Națională 2024 matematică subiecte' }), E.classifyDoc(''), { now: NOW });
  assert.deepStrictEqual([d.status, d.confidence], ['ok', 'nesigur']);
  assert.match(d.reasons.join(), /fără text/);
  d = dec({ url: `${CDN}/2024/06/ENVIII_Matematica_2024_Var_03_LRO.pdf` }, EN_V7);
  assert.strictEqual(d.confidence, 'nesigur');
  assert.match(d.conflicts.join(), /varianta: antetul spune 7, numele 3/);
  d = dec({ url: `${CDN}/2024/06/ENVIII_Matematica_2024_Var_07_LRO.pdf`, pageTitle: 'Evaluare Națională 2024: subiectele de rezervă și cele de la simulare' }, EN_V7);
  assert.strictEqual(d.confidence, 'nesigur', 'contextul pomenește două feluri');
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Titlurile botului ↔ potrivirea automată din site (api/_lib/barem.js)
// ═══════════════════════════════════════════════════════════════════════════
test('titlurile și numele de fișier ale botului: potrivirea din site leagă subiectul DOAR de baremul lui', () => {
  const row = (id, c, profile = null) => ({ id, title: E.titleFor(c), file_url: `https://x.supabase.co/storage/v1/object/public/content-files-free/pdf/x/1730000000000_${E.fileNameFor(c)}`, category: c.exam === 'en' ? 'evaluare-nationala' : 'bacalaureat', profile, content_type: 'pdf', subcategory: c.isBarem ? 'bareme' : 'variante' });
  const base = { exam: 'bac', year: '2025', profile: 'mate-info', variant: '3', kind: 'varianta' };
  const subj = row(1, { ...base, tip: 'speciala', isBarem: false }, 'mate-info');
  const cands = [
    row(2, { ...base, tip: 'speciala', isBarem: true }, 'mate-info'),
    row(3, { ...base, tip: 'sesiune', luna: 'iunie', isBarem: true }, 'mate-info'),
    row(4, { ...base, tip: 'rezerva', isBarem: true }, 'mate-info'),
    row(5, { ...base, tip: 'speciala', isBarem: true, profile: 'stiinte-naturii' }, 'stiinte-naturii'),
    row(6, { ...base, tip: 'speciala', isBarem: true, variant: '4' }, 'mate-info'),
    row(7, { ...base, tip: 'simulare', scope: 'nationala', variant: null, isBarem: true }, 'mate-info'),
  ];
  const m = B.matchBarem(subj, cands);
  assert.deepStrictEqual([m.status, m.barem && m.barem.id], ['ok', 2]);
  // EN, simulare județeană, test de antrenament
  const en = { exam: 'en', year: '2026', variant: '5', kind: 'varianta', tip: 'rezerva' };
  assert.strictEqual(B.matchBarem(row(10, { ...en, isBarem: false }), [row(11, { ...en, isBarem: true }), row(12, { ...en, tip: 'sesiune', luna: 'iunie', isBarem: true })]).barem.id, 11);
  const jud = { exam: 'bac', year: '2026', profile: 'tehnologic', tip: 'simulare', scope: 'judeteana', judet: 'Timiș', luna: 'decembrie' };
  assert.strictEqual(B.matchBarem(row(20, { ...jud, isBarem: false }, 'tehnologic'), [row(21, { ...jud, isBarem: true }, 'tehnologic'), row(22, { ...jud, scope: 'nationala', isBarem: true }, 'tehnologic')]).barem.id, 21);
  // numele de fișier: fără diacritice, „barem-" în față, extensia .pdf
  assert.strictEqual(E.fileNameFor({ ...base, tip: 'speciala', isBarem: true }), 'barem-bacalaureat-2025-matematica-m-mate-info-varianta-3-sesiunea-speciala-pentru-olimpici.pdf');
  assert.strictEqual(B.isBaremRow(cands[0]), true);
  assert.match(E.descriptionFor({ ...base, tip: 'speciala', isBarem: true }, { originalName: 'E_c_matematica_M_mate-info_2025_bar_03_LRO.pdf', sourceHost: 'cdn.edupedu.ro' }), /Baremul de evaluare și de notare oficial \(Ministerul Educației\).*fișierul original: E_c_matematica_M_mate-info_2025_bar_03_LRO\.pdf/);
});

test('rubricile: fiecare fel ajunge unde îl caută elevii (EN / BAC pe profil)', () => {
  const r = (c) => E.rubricFor(c);
  assert.strictEqual(r({ exam: 'en', tip: 'simulare' }).subcategory, 'simulari');
  assert.strictEqual(r({ exam: 'en', tip: 'antrenament' }).subcategory, 'variante');
  assert.strictEqual(r({ exam: 'en', tip: 'sesiune', isBarem: true }).subcategory, 'bareme');
  assert.strictEqual(r({ exam: 'bac', profile: 'tehnologic', tip: 'rezerva' }).subcategory, 'variante');
  assert.strictEqual(r({ exam: 'bac', profile: 'stiinte-naturii', tip: 'antrenament' }).subcategory, 'teste-antrenament');
  assert.strictEqual(r({ exam: 'bac', profile: 'mate-info', tip: 'model' }).subcategory, 'simulari');
  assert.strictEqual(r({ exam: 'bac', profile: 'pedagogic', tip: 'sesiune' }), null, 'pedagogic nu are rubrică');
  assert.strictEqual(r({ exam: 'bac', tip: 'sesiune' }), null, 'fără profil nu se publică la BAC');
  // aceleași valori ca în validarea de pe server (api/_lib/contentAdmin.js)
  const CA = require('../api/_lib/contentAdmin');
  for (const c of [{ exam: 'en', tip: 'simulare' }, { exam: 'en', tip: 'model', isBarem: true }, { exam: 'bac', profile: 'tehnologic', tip: 'antrenament' }, { exam: 'bac', profile: 'mate-info', tip: 'model' }]) {
    const x = r(c);
    assert.ok(CA.SUBCATEGORIES[x.category].includes(x.subcategory), JSON.stringify(x));
    if (x.profile) assert.ok(CA.BAC_PROFILES.includes(x.profile));
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Amprenta (duplicate) și verificarea subiect ↔ barem
// ═══════════════════════════════════════════════════════════════════════════
test('amprenta: același document (alt nume) e duplicat; altă variantă / baremul nu', () => {
  const a = E.fingerprint(EN_V7), b = E.fingerprint(EN_V7.replace('Ministerul Educației', 'Ministerul Educației și Cercetării'));
  assert.strictEqual(E.sameDocument(a, b), true);
  assert.strictEqual(E.sameDocument(a, E.fingerprint(BAC_V5)), false);
  assert.strictEqual(E.sameDocument(a, E.fingerprint(EN_V1_2023)), false, 'aceleași instrucțiuni, alte numere în enunțuri');
  assert.strictEqual(E.sameDocument(a, E.fingerprint(EN_B7)), false);
  assert.ok(JSON.stringify(a).length < 2500, 'amprenta e mică (se ține în baza de date)');
});

test('verificarea subiect ↔ barem: titlu, nume de fișier, antet și conținut', () => {
  const S = { row: { title: 'Evaluare Națională 2024 — Varianta 7', file_url: 'https://x/1700000000001_ENVIII_Matematica_2024_var_07_LRO.pdf', category: 'evaluare-nationala' }, text: EN_V7 };
  let v = E.verifyPair(S, { row: { title: 'Barem EN 2024', file_url: 'https://x/ENVIII_Matematica_2024_bar_07_LRO.pdf', category: 'evaluare-nationala' }, text: EN_B7 });
  assert.strictEqual(v.ok, true, JSON.stringify(v));
  assert.strictEqual(v.evidence.antet, 'match');
  assert.strictEqual(v.evidence.fisier, 'la fel');
  assert.ok(v.score >= 0.5);
  v = E.verifyPair(S, { row: { title: 'Barem EN 2024 varianta 2', file_url: 'https://x/b2.pdf', category: 'evaluare-nationala' }, text: EN_B2 });
  assert.strictEqual(v.ok, false);
  assert.match(v.why, /antetul|titlurile/);
  // un barem „bun" după titlu, dar cu alt conținut → refuzat
  v = E.verifyPair(S, { row: { title: 'Barem EN 2024 varianta 7', file_url: 'https://x/b.pdf', category: 'evaluare-nationala' }, text: EN_B2.replace(/Varianta 2/g, 'Varianta 7') });
  assert.strictEqual(v.ok, false);
  assert.match(v.why, /conținutul nu se potrivește/);
  // BAC: alt profil
  const SB = { row: { title: 'Bacalaureat 2024 M_mate-info Varianta 5', file_url: 'https://x/a.pdf', category: 'bacalaureat', profile: 'mate-info' }, text: BAC_V5 };
  assert.strictEqual(E.verifyPair(SB, { row: { title: 'Barem 2024', file_url: 'https://x/b.pdf', category: 'bacalaureat', profile: 'mate-info' }, text: BAC_B5 }).ok, true);
  assert.strictEqual(E.verifyPair(SB, { row: { title: 'Barem 2024', file_url: 'https://x/b.pdf', category: 'bacalaureat', profile: 'stiinte-naturii' }, text: BAC_B5.replace(/M_mate-info/g, 'M_st-nat').replace(/matematică-informatică/g, 'științe ale naturii') }).ok, false);
});

test('numele oficial al baremului, din numele subiectului', () => {
  assert.deepStrictEqual(E.baremNameGuesses('E_c_matematica_M_mate-info_2024_var_07_LRO.pdf'), ['E_c_matematica_M_mate-info_2024_bar_07_LRO']);
  assert.deepStrictEqual(E.baremNameGuesses('1723456789012_ENVIII_Matematica_2025_Var_07_LRO.pdf'), ['ENVIII_Matematica_2025_Bar_07_LRO']);
  assert.deepStrictEqual(E.baremNameGuesses('E_c_matematica_M_mate-info_2026_var_simulare_LRO.pdf'), ['E_c_matematica_M_mate-info_2026_bar_simulare_LRO']);
  assert.deepStrictEqual(E.baremNameGuesses('Model_BAC_MI_aprilie-2025.pdf'), ['Barem_BAC_MI_aprilie-2025']);
  assert.deepStrictEqual(E.baremNameGuesses('fisa-fractii.pdf'), []);
  assert.deepStrictEqual(E.siblingUrlGuesses(`${CDN}/2025/06/ENVIII_Matematica_2025_Var_07_LRO.pdf`, 'ENVIII_Matematica_2025_Bar_07_LRO'),
    [`${CDN}/2025/06/ENVIII_Matematica_2025_Bar_07_LRO.pdf`, `${CDN}/2025/07/ENVIII_Matematica_2025_Bar_07_LRO.pdf`]);
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. robots.txt, HTML / RSS / WordPress, setări, calendar, arhive
// ═══════════════════════════════════════════════════════════════════════════
test('robots.txt: regulile pentru toți, pentru bot, Allow mai lung, Disallow gol', () => {
  assert.strictEqual(E.robotsAllowed('User-agent: *\nDisallow: /\n', 'examenmatebot', '/2025/bacalaureat/'), false);
  assert.strictEqual(E.robotsAllowed('User-agent: *\nDisallow:\n', 'examenmatebot', '/x'), true);
  assert.strictEqual(E.robotsAllowed('User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n', 'examenmatebot', '/wp-json/wp/v2/posts?search=x'), true);
  assert.strictEqual(E.robotsAllowed('User-agent: *\nDisallow: /wp-admin/\nAllow: /wp-admin/admin-ajax.php\n', 'examenmatebot', '/wp-admin/admin-ajax.php'), true);
  assert.strictEqual(E.robotsAllowed('User-agent: *\nDisallow: /wp-admin/\n', 'examenmatebot', '/wp-admin/x'), false);
  const t = 'User-agent: GPTBot\nDisallow: /\n\nUser-agent: ExamenMateBot\nDisallow: /privat/\n\nUser-agent: *\nDisallow: /\n';
  assert.strictEqual(E.robotsAllowed(t, 'examenmatebot', '/subiecte/'), true, 'grupul botului are prioritate față de *');
  assert.strictEqual(E.robotsAllowed(t, 'examenmatebot', '/privat/a'), false);
  assert.strictEqual(E.robotsAllowed('User-agent: *\nDisallow: /*.pdf$\n', 'examenmatebot', '/a/b.pdf'), false);
  assert.strictEqual(E.robotsAllowed('User-agent: *\nDisallow: /*.pdf$\n', 'examenmatebot', '/a/b.pdf?x=1'), true);
});

test('HTML: linkurile (absolute, fără duplicate), PDF-urile deduse din imaginile paginilor, titlul și data', () => {
  const html = `<html><head><meta property="og:title" content="Subiecte BAC 2026 &#8211; Matematică"><meta property="article:published_time" content="2026-07-01T17:00:00+03:00"></head><body>
    <a href="/wp-content/uploads/2026/07/E_c_matematica_M_mate-info_2026_bar_07_LRO.pdf">Barem &amp; subiect</a>
    <a href='https://cdn.edupedu.ro/x.pdf'>x</a><a href="https://cdn.edupedu.ro/x.pdf">x din nou</a>
    <a href="javascript:void(0)">nu</a><a href="mailto:a@b.ro">nu</a>
    <img src="https://cdn.edupedu.ro/wp-content/uploads/2026/07/E_c_matematica_M_mate-info_2026_var_07_LRO_page-0001-57x80.jpg">
    <img data-src="https://cdn.edupedu.ro/wp-content/uploads/2026/07/E_c_matematica_M_mate-info_2026_var_07_LRO_page-0002-57x80.jpg"></body></html>`;
  const { links, guesses } = E.extractLinks(html, 'https://www.edupedu.ro/articol/');
  assert.deepStrictEqual(links.map((l) => l.url), ['https://www.edupedu.ro/wp-content/uploads/2026/07/E_c_matematica_M_mate-info_2026_bar_07_LRO.pdf', 'https://cdn.edupedu.ro/x.pdf']);
  assert.strictEqual(links[0].text, 'Barem & subiect');
  assert.deepStrictEqual(guesses, ['https://cdn.edupedu.ro/wp-content/uploads/2026/07/E_c_matematica_M_mate-info_2026_var_07_LRO.pdf']);
  const m = E.pageMeta(html);
  assert.strictEqual(m.title, 'Subiecte BAC 2026 – Matematică');
  assert.strictEqual(m.date, '2026-07-01T17:00:00+03:00');
  const rss = `<rss><channel><item><title><![CDATA[Bareme Matematică BAC 2026]]></title><link>https://www.edupedu.ro/a/</link><pubDate>Wed, 01 Jul 2026 14:00:00 +0000</pubDate><content:encoded><![CDATA[<a href="https://cdn.edupedu.ro/b.pdf">b</a>]]></content:encoded></item></channel></rss>`;
  const f = E.parseFeed(rss);
  assert.deepStrictEqual([f.length, f[0].title, f[0].link], [1, 'Bareme Matematică BAC 2026', 'https://www.edupedu.ro/a/']);
  assert.match(f[0].html, /b\.pdf/);
  const wp = E.parseWpPosts([{ link: 'https://www.edupedu.ro/c/', date: '2026-07-01', title: { rendered: 'Subiecte &#8211; BAC' }, content: { rendered: '<p>x</p>' } }]);
  assert.strictEqual(wp[0].title, 'Subiecte – BAC');
  assert.strictEqual(E.relevantArticle('Baremul de corectare pentru proba de Matematică de la Evaluarea Națională 2025'), true);
  assert.strictEqual(E.relevantArticle('Subiecte BAC 2025 la Istorie'), false);
  assert.strictEqual(E.relevantArticle('Rezultatele la Evaluarea Națională 2025 pe județe, la matematică'), false);
});

test('setări: valori curățate (URL-uri, domenii, plafoane); calendarul examenelor', () => {
  const s = E.normalizeSettings({ minYear: '1800', isjYears: 99, pages: ['https://sbisj.ro/Noutati/', 'ftp://x', 'nu e url', 'https://sbisj.ro/Noutati/#top'], domains: ['https://www.isjcj.ro/stiri', 'bad domain', 'mate.ro'], maxNewPerRun: 0, exams: { tehnologic: false } });
  assert.strictEqual(s.minYear, 2005);
  assert.strictEqual(s.isjYears, 10);
  assert.deepStrictEqual(s.pages, ['https://sbisj.ro/Noutati/']);
  assert.deepStrictEqual(s.domains, ['isjcj.ro', 'mate.ro']);
  assert.strictEqual(s.maxNewPerRun, 1);
  assert.deepStrictEqual(s.exams, { en: true, 'mate-info': true, 'stiinte-naturii': true, tehnologic: false });
  assert.strictEqual(s.autoPublish, true);
  assert.deepStrictEqual(E.normalizeSettings(null).pages, E.DEFAULT_SETTINGS.pages);
  assert.strictEqual(E.examYearOf(new Date('2026-10-30T12:00:00Z')), 2027);
  assert.strictEqual(E.examYearOf(new Date('2026-06-30T12:00:00Z')), 2026);
  assert.strictEqual(E.isHotSeason(new Date('2026-06-25T12:00:00Z')), true);
  assert.strictEqual(E.isHotSeason(new Date('2026-08-20T12:00:00Z')), true);
  assert.strictEqual(E.isHotSeason(new Date('2026-02-10T12:00:00Z')), false);
  assert.strictEqual(E.isTrustedHost('cdn.edupedu.ro'), true);
  assert.strictEqual(E.isTrustedHost('subiecte.edu.ro'), true);
  assert.strictEqual(E.isTrustedHost('isj.vs.edu.ro'), true);
  assert.strictEqual(E.isTrustedHost('sbisj.ro'), true);
  assert.strictEqual(E.isTrustedHost('exemplu.ro'), false);
  assert.strictEqual(E.isTrustedHost('mate.ro', s), true);
});

test('arhivele .zip: doar PDF-urile, fără foldere / __MACOSX; arhivă stricată → eroare clară', () => {
  const z = makeZip([{ name: 'EN/ENVIII_Matematica_2025_Bar_07_LRO.pdf', data: '%PDF-1.4 barem' }, { name: 'EN/citeste.txt', data: 'x', store: true }, { name: '__MACOSX/EN/._a.pdf', data: 'x' }, { name: 'EN/', data: '' }]);
  const out = unzip(z, { filter: (n) => /\.pdf$/i.test(n) });
  assert.deepStrictEqual(out.map((e) => e.name), ['EN/ENVIII_Matematica_2025_Bar_07_LRO.pdf']);
  assert.strictEqual(out[0].data.toString(), '%PDF-1.4 barem');
  assert.throws(() => unzip(Buffer.from('nu e zip, doar text oarecare de test')), /arhivă invalidă/);
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Rețeaua: politicos și sigur
// ═══════════════════════════════════════════════════════════════════════════
test('rețeaua: se prezintă, respectă robots.txt, refuză adresele interne, verifică redirecționările, are plafon', async () => {
  const web = fakeWeb({
    'https://ok.ro/robots.txt': { body: 'User-agent: *\nDisallow: /secret/\n', type: 'text/plain' },
    'https://ok.ro/a.pdf': { body: Buffer.from('%PDF-1.4 x'), type: 'application/pdf' },
    'https://ok.ro/mare.pdf': { body: Buffer.alloc(2000, 65), type: 'application/pdf' },
    'https://ok.ro/html.pdf': { body: '<html>pagină de eroare</html>', type: 'text/html' },
    'https://ok.ro/muta': { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } },
    'https://ok.ro/secret/a.pdf': { body: Buffer.from('%PDF-1.4'), type: 'application/pdf' },
  });
  const net = new N.Net({ fetchImpl: web.fetchImpl, lookup: async (h) => (h === 'intern.ro' ? [{ address: '10.0.0.5' }] : [{ address: '93.1.1.1' }]), hostGapMs: 0, maxRequests: 9 });
  let r = await net.file('https://ok.ro/a.pdf');
  assert.deepStrictEqual([r.ok, r.kind], [true, 'pdf']);
  assert.match(web.calls.find((c) => c.url === 'https://ok.ro/a.pdf').ua, /ExamenMateBot/);
  assert.strictEqual((await net.file('https://ok.ro/secret/a.pdf')).error, 'robots.txt nu permite');
  assert.ok(net.blocked.has('ok.ro'));
  assert.match((await net.file('https://ok.ro/html.pdf')).error, /nu e PDF/);
  assert.match((await net.file('https://ok.ro/mare.pdf', { maxBytes: 1000 })).error, /prea mare/);
  assert.strictEqual((await net.file('https://ok.ro/muta')).error, 'adresă internă', 'redirecționarea spre o adresă internă e oprită');
  assert.strictEqual((await net.html('http://localhost:3000/')).error, 'adresă internă');
  assert.strictEqual((await net.html('https://intern.ro/')).error, 'adresă internă');
  assert.strictEqual((await net.html('file:///etc/passwd')).error, 'doar http(s)');
  for (let i = 0; i < 6; i++) await net.file('https://ok.ro/a.pdf');
  assert.match((await net.file('https://ok.ro/a.pdf')).error, /plafonul/);
  assert.strictEqual(N.isPrivateIp('192.168.1.1'), true);
  assert.strictEqual(N.isPrivateIp('::ffff:127.0.0.1'), true);
  assert.strictEqual(N.isPrivateIp('93.115.1.10'), false);
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Totul împreună: verificarea site-ului → căutarea online → publicarea → baremele
// ═══════════════════════════════════════════════════════════════════════════
test('cap-coadă: indexul site-ului, descoperirea (publică, dedublează, ignoră), leagă baremele, un singur anunț', async () => {
  const P = await buildPdfs();
  const supa = await seedSite(P);
  const web = webFor(P);
  R.setNetFactory(netWith(web));
  const S = E.normalizeSettings(null);

  // 1) ✅ verificarea: subiectul EN 2024 V7 n-are barem (pe site e doar baremul V2); fișa nu are nevoie
  let ctx = R.makeCtx(supa, S, { budgetMs: 120000 });
  let v = await R.verifyStep(ctx);
  assert.deepStrictEqual([v.total, v.done, v.left], [4, 4, 0]);
  const ix = () => supa.db.tables.exam_bot_index;
  const at = (id) => ix().find((x) => x.content_id === id);
  assert.strictEqual(at(C.en7).barem_status, 'negasit');
  assert.strictEqual(at(C.en7).needs_barem, true);
  assert.strictEqual(at(C.enB2).is_barem, true);
  assert.strictEqual(at(C.fisa).barem_status, 'nu_necesita');
  assert.ok(at(C.en7).fp && at(C.en7).fp.m.length === 64, 'amprenta subiectului (pentru duplicate)');

  // 2) 🔎 descoperirea
  ctx = R.makeCtx(supa, S, { budgetMs: 200000 });
  const d = await R.discoverStep(ctx, { now: NOW });
  const items = supa.db.tables.exam_bot_items;
  const st = (frag) => (items.find((x) => x.url.includes(frag)) || {}).status;
  assert.strictEqual(st('M_mate-info_2024_var_05_LRO'), 'publicat');
  assert.strictEqual(st('M_mate-info_2024_bar_05_LRO'), 'publicat');
  assert.strictEqual(st('ENVIII_Matematica_2024_Bar_07_LRO'), 'publicat');
  assert.strictEqual(st('ENVIII_Matematica_2024_Var_07_LRO'), 'duplicat', 'subiectul EN e deja pe site (alt nume, același conținut)');
  assert.strictEqual(items.find((x) => x.url.includes('Var_07')).content_id, C.en7);
  assert.strictEqual(st('Test_antrenament_BAC_MI'), 'publicat');
  assert.strictEqual(st('EN_VIII_2027_Matematica_model.zip'), 'ignorat', 'subiecte.edu.ro refuză roboții → sărit');
  assert.match(items.find((x) => x.url.includes('.zip')).reasons.join(), /robots/);
  assert.strictEqual(items.some((x) => /_LMA|pedagogic|rezultate\.pdf/.test(x.url)), false, 'traducerile, pedagogicul și articolele fără legătură nu intră deloc');
  assert.strictEqual(web.calls.some((c) => c.url.startsWith('https://subiecte.edu.ro/2027/') && !c.url.endsWith('robots.txt')), false, 'nicio cerere spre paginile interzise');
  assert.ok(ctx.lines.some((l) => /nu permit roboți|nu permite roboții/.test(l)), ctx.lines.join('\n'));
  assert.strictEqual(d.done, true);

  // materialele publicate: rubrica, titlul, fișierul în Storage, descrierea cu numele original
  const pub = supa.db.tables.content.filter((c) => !Object.values(C).includes(c.id));
  const byTitle = (re) => pub.find((c) => re.test(c.title));
  const bacS = byTitle(/^Bacalaureat 2024 — Matematică M_mate-info, Varianta 5 \(sesiunea specială pentru olimpici\)$/);
  const bacB = byTitle(/^Barem — Bacalaureat 2024 — Matematică M_mate-info, Varianta 5 \(sesiunea specială/);
  const enB = byTitle(/^Barem — Evaluare Națională 2024 — Matematică, Varianta 7/);
  const sib = byTitle(/Test de antrenament \(ISJ Sibiu, octombrie\)/);
  assert.ok(bacS && bacB && enB && sib, pub.map((c) => c.title).join('\n'));
  assert.deepStrictEqual([bacS.category, bacS.subcategory, bacS.profile, bacS.content_type, bacS.is_free], ['bacalaureat', 'variante', 'mate-info', 'pdf', true]);
  assert.deepStrictEqual([bacB.subcategory, bacB.profile], ['bareme', 'mate-info']);
  assert.deepStrictEqual([enB.category, enB.subcategory, enB.profile], ['evaluare-nationala', 'bareme', null]);
  assert.deepStrictEqual([sib.subcategory, sib.profile], ['teste-antrenament', 'mate-info']);
  assert.match(bacS.file_url, /content-files-free\/pdf\/bacalaureat\/\d+_bacalaureat-2024-matematica-m-mate-info-varianta-5-sesiunea-speciala-pentru-olimpici\.pdf$/);
  assert.match(bacS.description, /fișierul original: E_c_matematica_M_mate-info_2024_var_05_LRO\.pdf/);
  assert.ok(supa.db.uploads.every((u) => u.bucket === 'content-files-free' && /^pdf\/(bacalaureat|evaluare-nationala)\//.test(u.path)));

  // baremele legate: subiectul BAC nou ↔ baremul lui; subiectul EN de pe site ↔ baremul găsit
  const ov = (id) => supa.db.tables.ai_pdf_text.find((x) => x.content_id === id);
  assert.strictEqual(ov(bacS.id).barem_override_id, bacB.id);
  assert.strictEqual(ov(bacS.id).barem_override_by, 'bot');
  assert.strictEqual(ov(C.en7).barem_override_id, enB.id);
  assert.strictEqual(at(C.en7).barem_status, 'ok_bot');
  assert.match(at(C.en7).barem_evidence, /"antet":"match"/);
  // un singur anunț în clopoțel (nu câte unul pe fișier)
  const ann = supa.db.tables.ai_broadcasts.filter((x) => x.data && x.data.botExamene);
  assert.strictEqual(ann.length, 1);
  // „cu barem" doar cât e adevărat: subiectul BAC are baremul legat, testul ISJ nu are încă
  assert.strictEqual(ann[0].title, '📚 2 subiecte oficiale noi (1 cu barem)');

  // 3) a doua rulare: nimic nou, nimic dublat
  ctx = R.makeCtx(supa, S, { budgetMs: 200000 });
  const n0 = supa.db.tables.content.length;
  await R.discoverStep(ctx, { now: NOW });
  assert.strictEqual(supa.db.tables.content.length, n0, 'nu publică de două ori');
  assert.strictEqual(supa.db.tables.ai_broadcasts.filter((x) => x.data && x.data.botExamene).length, 1);

  // 4) Profesorul Virtual vede asocierea făcută de bot
  const PDF = require('../api/ai-pdf-context');
  const pc = await PDF.getPdfContext(supa, supa.db.tables.content.find((c) => c.id === C.en7));
  assert.strictEqual(pc.barem.id, enB.id);
  assert.strictEqual(pc.barem.matchedBy, 'bot');
  assert.match(pc.baremText, /BAREM/i);

  // 5) 🔍 baremul lipsă al subiectului EN 2023: găsit online după numele oficial, publicat, legat
  ctx = R.makeCtx(supa, S, { budgetMs: 200000 });
  await R.verifyStep(ctx, { ids: [C.en1] });
  assert.strictEqual(at(C.en1).barem_status, 'negasit');
  ctx = R.makeCtx(supa, S, { budgetMs: 200000 });
  const f = await R.findMissingStep(ctx, {});
  const r1 = f.results.find((x) => x.content_id === C.en1);
  assert.strictEqual(r1.found, true, JSON.stringify(f));
  assert.strictEqual(r1.how, 'online');
  const enB23 = supa.db.tables.content.find((c) => /^Barem — Evaluare Națională 2023/.test(c.title));
  assert.ok(enB23, 'baremul 2023 publicat la Bareme');
  assert.strictEqual(enB23.subcategory, 'bareme');
  assert.strictEqual(ov(C.en1).barem_override_id, enB23.id);
  assert.strictEqual(at(C.en1).search_status, 'gasit');

  // 6) raportul din Admin
  const rep = await R.report(supa);
  assert.strictEqual(rep.setup.tables, true);
  assert.strictEqual(rep.counts.pdfs, supa.db.tables.content.length);
  assert.ok(rep.counts.cuBarem >= 2);
  assert.ok(rep.items.publicat >= 4);
  const lst = await R.listView(supa, 'cu');
  assert.ok(lst.rows.some((x) => x.content_id === C.en7 && /bot/.test(x.barem_how)));
  const gas = await R.listView(supa, 'gasite');
  assert.ok(gas.rows.some((x) => x.status === 'duplicat'));
});

test('căutarea web (opțională, cu cheie): cronul o face o dată pe zi, butonul din Admin oricând', async () => {
  const supa = createFakeSupabase({ exam_bot_pages: [], app_settings: [] });
  const cautari = [];
  const web = fakeWeb({
    'https://google.serper.dev/search': (url, opts) => { cautari.push(JSON.parse(opts.body).q); return { body: JSON.stringify({ organic: [] }), type: 'application/json' }; },
  });
  R.setNetFactory(netWith(web));
  const S = E.normalizeSettings({ sources: { edupedu: false, subiecte: false, eduRo: false, pagini: false, cautare: true } });
  const vechi = process.env.SERPER_API_KEY;
  process.env.SERPER_API_KEY = 'cheie-de-test';
  try {
    const ruleaza = (by, now = NOW) => R.collect(R.makeCtx(supa, S, { budgetMs: 200000, by }), { years: [2027, 2026], now });
    await ruleaza('cron');
    const n = cautari.length;
    assert.strictEqual(n, 8, 'prima rulare a zilei: căutările pe anul curent și pe cel trecut');
    await ruleaza('cron');
    assert.strictEqual(cautari.length, n, 'încă o rulare de cron în aceeași zi nu mai caută (nu costă)');
    await ruleaza('admin');
    assert.strictEqual(cautari.length, 2 * n, '„🔎 Caută acum online" din Admin caută oricând');
    await ruleaza('cron', new Date(NOW.getTime() + 86400000));
    assert.strictEqual(cautari.length, 3 * n, 'a doua zi, cronul caută din nou');
  } finally {
    if (vechi === undefined) delete process.env.SERPER_API_KEY; else process.env.SERPER_API_KEY = vechi;
  }
});

test('„De verificat": un fișier nesigur așteaptă; adminul îl publică (cu rubrica aleasă) sau îl respinge', async () => {
  const P = await buildPdfs();
  const supa = await seedSite(P);
  const scanned = Buffer.from('%PDF-1.4\n% PDF fără text (scanat)\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF');
  const web = fakeWeb({
    'https://cdn.edupedu.ro/robots.txt': { status: 404 },
    [`${CDN}/2025/06/scan_ENVIII_Matematica_2025_Var_04.pdf`]: { body: scanned, type: 'application/pdf' },
  });
  R.setNetFactory(netWith(web));
  const ctx = R.makeCtx(supa, E.normalizeSettings(null), { budgetMs: 60000 });
  await R.insertItems(ctx, [{ url: `${CDN}/2025/06/scan_ENVIII_Matematica_2025_Var_04.pdf`, text: 'ENVIII_Matematica_2025_Var_04', pageTitle: 'Subiectele de la Matematică, Evaluarea Națională 2025', source: 'edupedu' }]);
  await R.processPending(ctx);
  const it = supa.db.tables.exam_bot_items[0];
  assert.strictEqual(it.status, 'asteptare');
  assert.strictEqual(it.confidence, 'nesigur');
  assert.match(it.reasons.join(), /fără text/);
  // adminul îl publică
  const r = await R.itemPublish(R.makeCtx(supa, E.normalizeSettings(null), { budgetMs: 60000 }), it.id, { title: 'Evaluare Națională 2025 — Matematică, Varianta 4 (scanată)' });
  const c = supa.db.tables.content.find((x) => x.id === r.content_id);
  assert.deepStrictEqual([c.title, c.category, c.subcategory], ['Evaluare Națională 2025 — Matematică, Varianta 4 (scanată)', 'evaluare-nationala', 'variante']);
  assert.strictEqual(supa.db.tables.exam_bot_items[0].status, 'publicat');
  // publicat manual → tot un singur anunț în clopoțel, fără „cu barem" (nu are încă)
  const ann = supa.db.tables.ai_broadcasts.filter((x) => x.data && x.data.botExamene);
  assert.deepStrictEqual(ann.map((x) => x.title), ['📚 Un subiect oficial nou']);
  // respingere / reîncercare
  await R.itemSetStatus(supa, it.id, 'respins');
  assert.strictEqual(supa.db.tables.exam_bot_items[0].status, 'respins');
  await R.itemSetStatus(supa, it.id, 'nou');
  assert.deepStrictEqual([supa.db.tables.exam_bot_items[0].status, supa.db.tables.exam_bot_items[0].attempts], ['nou', 0]);
});

test('asocierea manuală și „nu are barem": candidații verificați pe conținut, legarea, dezlegarea', async () => {
  const P = await buildPdfs();
  const supa = await seedSite(P);
  supa.db.tables.content.push({ id: 'bbbbbbbb-0000-4000-8000-000000000007', title: 'Barem — EN 2024 V7', category: 'evaluare-nationala', subcategory: 'bareme', content_type: 'pdf', is_free: true, file_url: `${FAKE}pdf/evaluare-nationala/1700000000009_barem7.pdf`, created_at: '2025-02-01T10:00:00Z' });
  supa.db.files.set('content-files-free/pdf/evaluare-nationala/1700000000009_barem7.pdf', P.enB7);
  R.setNetFactory(netWith(fakeWeb({})));
  const S = E.normalizeSettings(null);
  await R.verifyStep(R.makeCtx(supa, S, { budgetMs: 60000 }));
  const at = (id) => supa.db.tables.exam_bot_index.find((x) => x.content_id === id);
  assert.ok(['ok', 'ok_antet', 'ok_continut'].includes(at(C.en7).barem_status), `potrivirea automată din site: ${at(C.en7).barem_status}`);
  const cands = await R.baremCandidates(R.makeCtx(supa, S, { budgetMs: 60000 }), C.en7);
  assert.strictEqual(cands.candidates[0].id, 'bbbbbbbb-0000-4000-8000-000000000007');
  assert.strictEqual(cands.candidates[0].ok, true);
  assert.ok(cands.candidates.some((c) => c.id === C.enB2 && !c.ok), 'baremul V2 apare, dar respins');
  // adminul leagă altceva (e alegerea lui) → asocierea manuală; apoi o desface
  await R.manualAssociate(R.makeCtx(supa, S, { budgetMs: 60000 }), C.en7, C.enB2);
  assert.strictEqual(supa.db.tables.ai_pdf_text.find((x) => x.content_id === C.en7).barem_override_by, 'admin');
  assert.strictEqual(at(C.en7).barem_status, 'ok_admin');
  await R.manualAssociate(R.makeCtx(supa, S, { budgetMs: 60000 }), C.en7, null);
  assert.strictEqual(supa.db.tables.ai_pdf_text.find((x) => x.content_id === C.en7).barem_override_id, null);
  // „nu are barem" → iese din lista „fără barem" și din căutări
  await R.setIgnored(supa, C.en1, true);
  const fara = await R.listView(supa, 'fara');
  assert.strictEqual(fara.rows.some((x) => x.content_id === C.en1), false);
  assert.strictEqual((await R.listView(supa, 'ignorate')).rows.some((x) => x.content_id === C.en1), true);
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. API-ul, cronul, SQL-ul, Admin
// ═══════════════════════════════════════════════════════════════════════════
test('api/exam-bot: doar adminul; cronul doar cu secretul; fără SQL → raport cu „rulează bot_examene.sql"', async () => {
  const P = await buildPdfs();
  const supa = await seedSite(P);
  R.setNetFactory(netWith(webFor(P)));
  const orig = { admin: http.admin, authUser: http.authUser };
  let uid = 'eeeeeeee-0000-4000-8000-000000000001';
  http.admin = () => supa;
  http.authUser = async () => uid;
  delete require.cache[require.resolve('../api/exam-bot')];
  const handler = require('../api/exam-bot');
  const call = async (method, body, query = {}, headers = {}) => { const res = fakeRes(); await handler({ method, body, query, headers }, res); return res; };
  try {
    assert.strictEqual((await call('POST', { action: 'status' })).statusCode, 403, 'un elev nu vede botul');
    uid = ADMIN;
    let res = await call('POST', { action: 'status' });
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.setup.tables, true);
    assert.strictEqual(res.body.config.search, null, 'fără cheie de căutare web');
    assert.strictEqual(res.body.settings.autoPublish, true);
    // un pas de verificare, apoi lacătul: un al doilea pas, alt rulaj, în timp ce primul „rulează"
    res = await call('POST', { action: 'step', kind: 'verificare' });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.done, true);
    supa.db.tables.exam_bot_runs.push({ id: 'cccccccc-0000-4000-8000-000000000001', kind: 'descoperire', by: 'cron', status: 'ruleaza', started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), stats: {}, log: [] });
    res = await call('POST', { action: 'step', kind: 'descoperire' });
    assert.strictEqual(res.statusCode, 409);
    assert.match(res.body.error, /lucrează deja/);
    supa.db.tables.exam_bot_runs.find((r) => r.id === 'cccccccc-0000-4000-8000-000000000001').status = 'ok';
    // setările
    res = await call('POST', { action: 'settings', value: { autoPublish: false, minYear: 2021, pages: ['https://isjcj.ro/stiri/'] } });
    assert.deepStrictEqual([res.body.settings.autoPublish, res.body.settings.minYear, res.body.settings.pages], [false, 2021, ['https://isjcj.ro/stiri/']]);
    assert.strictEqual(supa.db.tables.app_settings.find((x) => x.key === 'exam_bot').value.autoPublish, false);
    // cronul
    assert.strictEqual((await call('GET', null, { action: 'cron' })).statusCode, 403);
    res = await call('GET', null, { action: 'cron' }, { authorization: `Bearer ${process.env.CRON_SECRET}` });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.ok(res.body.verificare);
    // fără publicare automată, ce găsește cronul așteaptă verificarea adminului
    assert.ok(supa.db.tables.exam_bot_items.some((x) => x.status === 'asteptare'));
    assert.strictEqual(supa.db.tables.exam_bot_items.some((x) => x.status === 'publicat'), false);
    // fără SQL
    supa.db.failTables.add('exam_bot_items');
    res = await call('POST', { action: 'status' });
    assert.strictEqual(res.body.setup.tables, false);
    res = await call('POST', { action: 'step', kind: 'verificare' });
    assert.ok([200, 503].includes(res.statusCode));
  } finally {
    http.admin = orig.admin; http.authUser = orig.authUser;
    delete require.cache[require.resolve('../api/exam-bot')];
  }
});

test('SQL: tabelele botului cu RLS, GRANT doar pentru authenticated + service_role (fără anon), politica serverului', () => {
  const sql = read('supabase/bot_examene.sql');
  for (const t of ['exam_bot_items', 'exam_bot_index', 'exam_bot_runs', 'exam_bot_pages']) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${t}`));
    assert.match(sql, new RegExp(`alter table public\\.${t} enable row level security`));
    assert.match(sql, new RegExp(`grant select, insert, update, delete on public\\.${t} to authenticated`));
    assert.match(sql, new RegExp(`grant select, insert, update, delete on public\\.${t} to service_role`));
  }
  assert.doesNotMatch(sql, /to anon/);
  assert.match(sql, /barem_override_by/);
  const v = JSON.parse(read('vercel.json'));
  assert.ok(v.crons.some((c) => c.path === '/api/exam-bot?action=cron'), 'cronul botului');
  const admin = read('src/pages/Admin.jsx');
  assert.match(admin, /AdminBotExamene/);
  assert.match(admin, /id: 'bot'/);
  const ui = read('src/components/AdminBotExamene.jsx');
  for (const a of ["'step'", "'find_barem'", "'candidates'", "'associate'", "'ignore'", "'item_publish'", "'item_reject'", "'settings'"]) assert.ok(ui.includes(a), a);
});
