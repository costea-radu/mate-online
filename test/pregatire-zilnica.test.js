// =====================================================================
// test/pregatire-zilnica.test.js — cererea din 8 noiembrie 2026 (2):
//   „1. Pune un buton «pregătește-mă de examen» în «învățare cu AI» în meniul
//    hamburger pe telefon și în meniul hover lateral. Pune butonul și în navbar
//    și în prof virtual, înainte de meditații live. Pune-l și în Home, ca un card
//    înainte de toate cardurile. Acest buton să amintească zilnic printr-o
//    notificare, utilizatorul să rezolve un test. Progresul să se înregistreze cu
//    XP în «arena» și clasament cu alți utilizatori, simplu (…), cu
//    promovare și alte modalități de răsplată. Se consideră lucru și dacă elevul
//    rezolvă o parte dintr-un test, nu complet. În arena să apară ca pe Facebook
//    cine a rezolvat, a promovat, ce subiect, ce provocări noi apar, etc., notele
//    să nu apară dacă sunt probleme cu politica de confidențialitate.
//    2. după corectare, notează cu roșu nota pe test, scris de mână, de exemplu:
//    7,30 (șapte ^30)
//    3. pune o notă chiar dacă se rezolvă doar câteva exerciții doar de la un
//    subiect. (…) Nota să apară în statistici la «rezultate elevi»
//    4. fă mai mică secțiunea albastră din «Home», ca o bară orizontală. Sub ea
//    mare pune cardul: pregătește-mă de examen"
//
// api/_lib/pregatireZilnica.js (testul zilei, bifa de la 3 exerciții, răsplata,
// insignele), api/_lib/arenaFeed.js (fluxul Arenei, fără note, prenume + inițială,
// opt-out), api/_lib/pregatireNotificari.js (amintirea zilnică), api/gamificare.js
// (acțiunile + cronul), api/ai-score.js (și salvarea parțială contează), SQL-ul
// (RLS + GRANT din CLAUDE.md), nota scrisă cu roșu pe PDF și legăturile din
// interfață (meniuri, navbar, Prof Virtual, Home, Arena, vizualizatoare).
// Rulare: npm test
// =====================================================================
process.env.CRON_SECRET = process.env.CRON_SECRET || 'secret-test-cron';
delete process.env.PREGATIRE_PRAG_ITEMI;
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const xp = require('../api/_lib/xp');
const ai = require('../api/_lib/ai');
const score = require('../api/_lib/score');
const PUSH = require('../api/_lib/push');
const P = require('../api/_lib/pregatireZilnica');
const feed = require('../api/_lib/arenaFeed');
const PN = require('../api/_lib/pregatireNotificari');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const U = '44444444-4444-4444-8444-444444444444';
const ALT = '55555555-5555-4555-8555-555555555555';
const AZI = xp.dayKey();
const zi = (n) => xp.addDays(AZI, n);
const ELEV = { id: U, subscription_status: null, role: 'elev', is_admin: false };
const PREMIUM = { ...ELEV, subscription_status: 'active' };

const EN1 = { id: 'en-1', title: 'EN — Test de antrenament 1', category: 'evaluare-nationala', content_type: 'interactive', is_free: true, sort_order: 1 };
const EN2 = { id: 'en-2', title: 'EN — Test de antrenament 2', category: 'evaluare-nationala', content_type: 'interactive', is_free: false, sort_order: 2 };
const EN3 = { id: 'en-3', title: 'EN — Test de antrenament 3', category: 'evaluare-nationala', content_type: 'interactive', is_free: true, sort_order: 3 };
const CONTINUT = [
  { id: 'en-bar', title: 'Barem EN — Test 1', category: 'evaluare-nationala', content_type: 'interactive', is_free: true, subcategory: 'bareme', sort_order: 0 },
  EN1, EN2, EN3,
  { id: 'en-pdf', title: 'EN 2025 — Varianta 1', category: 'evaluare-nationala', content_type: 'pdf', subcategory: 'variante', is_free: true, sort_order: 4 },
  { id: 'en-fisa', title: 'Fișă PDF — fracții', category: 'evaluare-nationala', content_type: 'pdf', subcategory: 'fise', is_free: true, sort_order: 5 },
  { id: 'bac-mi', title: 'BAC M1 — Test 1', category: 'bacalaureat', profile: 'mate-info', content_type: 'interactive', is_free: true, sort_order: 1 },
  { id: 'bac-sn', title: 'BAC M2 — Test 1', category: 'bacalaureat', profile: 'stiinte-naturii', content_type: 'interactive', is_free: true, sort_order: 1 },
  { id: 'c6', title: 'Fracții — exercițiul 1', category: 'clasa-6', content_type: 'interactive', is_free: true, sort_order: 1 },
];

function baza(extra = {}) {
  const supa = createFakeSupabase({
    content: CONTINUT,
    user_stats: [{ user_id: U, total_xp: 0, coins: 0, streak_current: 0, streak_best: 0, freezes: 0, league_tier: 1 }],
    profiles: [{ id: U, full_name: 'Ana Maria Popescu' }],
    daily_tests: [], progress: [], xp_events: [], user_badges: [], arena_feed: [],
    ...extra,
  });
  // constrângerile UNIQUE din SQL
  supa.db.unique = { daily_tests: [['user_id', 'day']], user_badges: [['user_id', 'badge_id']], arena_feed: [['dedupe_key']] };
  return supa;
}
const stats = (supa, id = U) => supa.db.tables.user_stats.find((x) => x.user_id === id);
const randAzi = (supa, id = U) => supa.db.tables.daily_tests.find((r) => r.user_id === id && r.day === AZI);
const evPregatire = (supa) => supa.db.tables.xp_events.filter((e) => e.source === 'pregatire-zilnica');
// în fluxul Arenei nu are voie să ajungă nicio notă, punctaj sau procent
const FARA_NOTE = /nota|grade|score|punctaj|pct|procent|best_pct|\b\d+[.,]\d+\b/i;

// ═══════════════════════════ 1) logica pură ═══════════════════════════
test('examenele: EN și cele trei profiluri de BAC; formatul PDF doar cu Premium', () => {
  assert.deepStrictEqual(P.EXAMENE.map((e) => e.id), ['evaluare-nationala', 'bac-mate-info', 'bac-stiinte', 'bac-tehnologic']);
  assert.strictEqual(P.examValid('bac-tehnologic'), true);
  assert.strictEqual(P.examValid('clasa-8'), false);
  assert.strictEqual(P.formatValid('pdf'), true);
  assert.strictEqual(P.formatValid('docx'), false);
  assert.strictEqual(P.formatFolosit('pdf', true), 'pdf');
  assert.strictEqual(P.formatFolosit('pdf', false), 'interactiv', 'fără Premium: testul interactiv, corectat pe loc');
  assert.strictEqual(P.formatFolosit('interactiv', true), 'interactiv');
  // materialul → examenul
  assert.strictEqual(P.examenulMaterialului(EN1), 'evaluare-nationala');
  assert.strictEqual(P.examenulMaterialului({ category: 'bacalaureat', profile: 'mate-info' }), 'bac-mate-info');
  assert.strictEqual(P.examenulMaterialului({ category: 'bacalaureat', profile: 'tehnologic' }), 'bac-tehnologic');
  assert.strictEqual(P.examenulMaterialului({ category: 'clasa-6' }), null);
  // contează orice test de examen, nu baremele
  assert.strictEqual(P.eDeExamen(EN1), true);
  assert.strictEqual(P.eDeExamen({ category: 'bacalaureat', title: 'BAC 2024 · Varianta 2' }), true);
  assert.strictEqual(P.eDeExamen(CONTINUT[0]), false, 'baremul nu e test');
  assert.strictEqual(P.eDeExamen({ category: 'clasa-6', title: 'Fracții' }), false);
  // adresa testului zilei: vizualizatorul obișnuit, cu insigna „testul zilei"
  assert.strictEqual(P.urlTest({ id: 'en-1', tip: 'interactiv' }), '/exercitiu?id=en-1&pregatire=1');
  assert.strictEqual(P.urlTest({ id: 'en pdf', tip: 'pdf' }), '/pdf-viewer?id=en%20pdf&pregatire=1');
  assert.strictEqual(P.urlTest(null), null);
});

test('„se consideră lucru și o parte din test": pragul de 3 exerciții, subiectele lucrate (EN 6 · 6 · 6)', () => {
  assert.strictEqual(P.PRAG_ITEMI, 3);
  assert.strictEqual(P.raspunsuriDate(['a', '', null, ' ', 'c', 0]), 3, 'răspunsurile goale nu se numără; 0 e răspuns');
  assert.strictEqual(P.raspunsuriDate(null), 0);
  const r = Array(18).fill('');
  r[7] = 'b'; r[8] = 'c'; r[13] = 'a';
  assert.deepStrictEqual(P.subiecteDinRaspunsuri(r, 18), [2, 3]);
  assert.deepStrictEqual(P.subiecteDinRaspunsuri(r, 20), [], 'doar la testele de EN cu 18 itemi');
  assert.deepStrictEqual(P.numeSubiecte([2, 1, 1, 7]), ['Subiectul I', 'Subiectul al II-lea']);
  assert.deepStrictEqual(P.numeSubiecte([3]), ['Subiectul al III-lea']);
});

test('răsplata: 25 XP + 5 🪙; +10 XP la 80% verificat; la fiecare 7 zile la rând +40 XP + 15 🪙', () => {
  assert.deepStrictEqual(P.recompensa({ pct: 50, serieNoua: 1 }), { xp: 25, coins: 5, bun: false, bonusSerie: false });
  assert.deepStrictEqual(P.recompensa({ pct: 85, serieNoua: 3 }), { xp: 35, coins: 5, bun: true, bonusSerie: false });
  assert.strictEqual(P.recompensa({ pct: 95, verificat: false, serieNoua: 2 }).xp, 25, 'fără bonus pe scor neverificat');
  assert.deepStrictEqual(P.recompensa({ pct: null, serieNoua: 7 }), { xp: 65, coins: 20, bun: false, bonusSerie: true });
  assert.strictEqual(P.recompensa({ pct: 80, serieNoua: 14 }).xp, 75);
  assert.strictEqual(P.recompensa({ serieNoua: 8 }).bonusSerie, false);
});

test('insignele: prima zi, test complet, 7 și 30 de zile la rând, 10 și 50 de zile — fiecare o singură dată', () => {
  const ids = (xs) => xs.map((b) => b.id);
  assert.deepStrictEqual(ids(P.insigneNoi({ serie: 1, total: 1 })), ['pregatire-prima-zi']);
  assert.deepStrictEqual(ids(P.insigneNoi({ serie: 1, total: 1, complet: true })), ['pregatire-prima-zi', 'pregatire-test-complet']);
  assert.deepStrictEqual(ids(P.insigneNoi({ serie: 7, total: 10 }, new Set(['pregatire-prima-zi']))), ['pregatire-serie-7', 'pregatire-zile-10']);
  assert.deepStrictEqual(ids(P.insigneNoi({ serie: 30, total: 50 }, new Set(P.INSIGNE.map((b) => b.id)))), []);
  // descrierile lor, în „Contul meu" (insigne acordate de server)
  const badges = read('src/lib/badges.js');
  for (const b of P.INSIGNE) assert.ok(badges.includes(`'${b.id}'`), `src/lib/badges.js descrie ${b.id}`);
});

test('„🔀 Alt test": următorul din listă, întâi cele încă nestăpânite; ciclic', () => {
  const L = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  assert.strictEqual(P.urmatorul(L, 'a').id, 'b');
  assert.strictEqual(P.urmatorul(L, 'd').id, 'a', 'de la capăt');
  assert.strictEqual(P.urmatorul(L, 'a', new Map([['b', 90], ['c', 40]])).id, 'c', 'sare peste cel stăpânit (≥ 70%)');
  assert.strictEqual(P.urmatorul(L, 'a', new Map([['b', 90], ['c', 90], ['d', 90]])).id, 'b', 'toate stăpânite → pur și simplu următorul');
  assert.strictEqual(P.urmatorul([{ id: 'a' }], 'a'), null);
  assert.strictEqual(P.urmatorul([], 'a'), null);
});

// ═══════════════════════════ 2) fluxul Arenei ═══════════════════════════
test('fluxul: doar câmpurile permise — nota, punctajul, procentul și XP-ul nu intră niciodată', () => {
  const c = feed.curata({
    examen: 'Evaluarea Națională', subiecte: ['Subiectul I'], complet: false, link: '/pregateste-ma',
    nota: 7.3, grade: 7.3, score: 63, pct: 70, xp: 35, puncte: 63, best_pct: 70, full_name: 'Ana Maria Popescu',
  });
  assert.deepStrictEqual(c, { examen: 'Evaluarea Națională', subiecte: ['Subiectul I'], complet: false, link: '/pregateste-ma' });
  assert.deepStrictEqual(feed.curata({ link: 'https://rau.example/x' }), {}, 'doar legături din site');
  assert.deepStrictEqual(feed.curata({ link: 'javascript:alert(1)' }), {});
  assert.ok(!Object.keys(feed.CAMPURI).some((k) => /nota|grade|score|pct|xp|punct/i.test(k)), 'nu există câmp pentru note');
  assert.strictEqual(feed.shortName('Ana Maria Popescu'), 'Ana P.');
  assert.strictEqual(feed.shortName('  bogdan   ionescu '), 'bogdan I.');
  assert.strictEqual(feed.shortName(''), 'Elev');
});

test('fluxul: textele — cine a rezolvat, ce subiect, a promovat, serie, insignă, nivel, duel, turneu, provocare', () => {
  const t = (k, p) => feed.descriere(k, p).text;
  assert.strictEqual(t('test', { examen: 'Evaluarea Națională', subiecte: ['Subiectul I', 'Subiectul al II-lea'] }), 'a lucrat azi la Subiectul I și Subiectul al II-lea · Evaluarea Națională');
  assert.strictEqual(t('test', { examen: 'BAC Mate-Info', complet: true }), 'a rezolvat un test complet · BAC Mate-Info');
  assert.strictEqual(t('test', {}), 'a lucrat azi la testul zilei');
  assert.strictEqual(t('serie', { serie: 7 }), 'are o serie de 7 zile de pregătire pentru examen');
  assert.strictEqual(t('serie', { serie: 30 }), 'are o serie de 30 de zile de pregătire pentru examen');
  assert.strictEqual(t('promovare', { liga: 'Argint', ligaIcon: '🥈' }), 'a promovat în Liga Argint');
  assert.strictEqual(feed.descriere('promovare', { liga: 'Argint', ligaIcon: '🥈' }).icon, '🥈');
  assert.strictEqual(t('insigna', { insigna: 'O săptămână de pregătire' }), 'a primit insigna „O săptămână de pregătire"');
  assert.strictEqual(t('nivel', { nivel: 5, nivelNume: 'Constructor' }), 'a ajuns la nivelul 5 · Constructor');
  assert.strictEqual(t('duel', {}), 'a câștigat un duel');
  assert.strictEqual(t('turneu', { titlu: 'Turneul săptămânii', loc: 1 }), 'a câștigat „Turneul săptămânii"');
  assert.strictEqual(t('turneu', { titlu: 'Turneul săptămânii', loc: 2 }), 'a terminat pe locul 2 în „Turneul săptămânii"');
  assert.match(t('turneu', { titlu: 'Turneul săptămânii · 8 noiembrie', exercitii: 6, zile: 7 }), /^Turneu nou: Turneul săptămânii · 8 noiembrie — 6 exerciții, 7 zile\. Înscrie-te din Arenă!$/);
  assert.strictEqual(t('provocare', { eticheta: 'Adună 100 XP astăzi' }), 'Provocarea bonus de azi: Adună 100 XP astăzi');
});

test('fluxul: „Ana P.", „Tu" pentru mine, anunțurile fără nume; cine a ales să nu apară nu se vede la alții; paginare', async () => {
  const B = '66666666-6666-4666-8666-666666666666', C = '77777777-7777-4777-8777-777777777777';
  const supa = baza({
    profiles: [{ id: U, full_name: 'Ana Maria Popescu' }, { id: B, full_name: 'Bogdan Ionescu' }, { id: C, full_name: 'Cristina Vlad' }],
    user_stats: [{ user_id: U }, { user_id: B }, { user_id: C, arena_public: false }],
  });
  assert.strictEqual(await feed.post(supa, { userId: U, kind: 'test', dedupeKey: `test:${U}:${AZI}`, payload: { examen: 'Evaluarea Națională', subiecte: ['Subiectul I'], nota: 9.5 } }), true);
  await feed.post(supa, { userId: B, kind: 'promovare', payload: { liga: 'Argint', ligaIcon: '🥈', score: 180 } });
  await feed.post(supa, { userId: C, kind: 'serie', payload: { serie: 7 } });
  await feed.post(supa, { kind: 'provocare', dedupeKey: `provocare:${AZI}`, payload: { eticheta: 'Rezolvă 8 itemi corect' } });
  assert.strictEqual(await feed.post(supa, { kind: 'necunoscut' }), false);
  // aceeași cheie: o singură dată
  assert.strictEqual(await feed.post(supa, { kind: 'provocare', dedupeKey: `provocare:${AZI}`, payload: {} }), false);
  assert.strictEqual(supa.db.tables.arena_feed.length, 4);
  assert.doesNotMatch(JSON.stringify(supa.db.tables.arena_feed.map((r) => r.payload)), /9\.5|180|nota|score/, 'nota nu ajunge nici în tabelă');

  const vB = await feed.list(supa, { viewerId: B });
  assert.strictEqual(vB.ok, true);
  assert.deepStrictEqual(vB.items.map((i) => [i.kind, i.nume]), [['provocare', null], ['promovare', 'Tu'], ['test', 'Ana P.']], 'cel mai nou primul; Cristina nu apare');
  assert.strictEqual(vB.items[0].anunt, true);
  assert.strictEqual(vB.items[1].eu, true);
  assert.strictEqual(vB.items[2].text, 'a lucrat azi la Subiectul I · Evaluarea Națională');
  assert.doesNotMatch(JSON.stringify(vB.items), /Popescu|Maria|Ionescu/, 'doar prenumele și inițiala');
  assert.doesNotMatch(JSON.stringify(vB.items.map((i) => i.text)), FARA_NOTE);
  // Cristina își vede activitatea, ca „Tu"
  const vC = await feed.list(supa, { viewerId: C });
  assert.ok(vC.items.some((i) => i.kind === 'serie' && i.nume === 'Tu'));
  // paginare: 2 câte 2
  const p1 = await feed.list(supa, { viewerId: B, limit: 2 });
  assert.strictEqual(p1.items.length, 2);
  assert.strictEqual(p1.maiMulte, true);
  const p2 = await feed.list(supa, { viewerId: B, limit: 2, inainte: p1.inainte });
  assert.deepStrictEqual(p2.items.map((i) => i.kind), ['test']);
  // opt-out / opt-in
  assert.deepStrictEqual(await feed.stare(supa, U), { setup: true, public: true });
  await feed.setPublic(supa, U, false);
  assert.strictEqual(stats(supa).arena_public, false);
  assert.ok(!(await feed.list(supa, { viewerId: B })).items.some((i) => i.nume === 'Ana P.'), 'Ana nu mai apare la alții');
  await feed.setPublic(supa, U, true);
  assert.ok((await feed.list(supa, { viewerId: B })).items.some((i) => i.nume === 'Ana P.'));
  // fără migrare: fluxul tace, fără erori
  const lipsa = baza();
  lipsa.db.failTables.add('arena_feed');
  assert.strictEqual(await feed.post(lipsa, { userId: U, kind: 'duel' }), false);
  const l = await feed.list(lipsa, { viewerId: U });
  assert.deepStrictEqual([l.ok, l.setup, l.items.length], [false, false, 0]);
});

// ═══════════════════════════ 3) testul zilei (Supabase simulat) ═══════════════════════════
test('fără examen ales: alegerea (EN, BAC M1/M2/M3), cu sugestia din „Planul meu"; migrarea nerulată → inactiv, fără erori', async () => {
  const supa = baza({ ai_meditatii_profile: [{ user_id: U, exam_target: 'evaluare-nationala' }] });
  const s = await P.stare(supa, U, ELEV);
  assert.strictEqual(s.activ, true);
  assert.strictEqual(s.alegeExamen, true);
  assert.strictEqual(s.sugestie, 'evaluare-nationala');
  assert.strictEqual(s.examene.length, 4);
  assert.strictEqual(supa.db.tables.daily_tests.length, 0, 'nimic atribuit înainte de alegere');

  const lipsa = baza();
  lipsa.db.failTables.add('daily_tests');
  const s2 = await P.stare(lipsa, U, ELEV);
  assert.strictEqual(s2.activ, false);
  const r = await P.alege(lipsa, U, ELEV, { examen: 'evaluare-nationala' });
  assert.match(r.error, /pregatire_zilnica\.sql/);
  assert.strictEqual(await P.inregistreaza(lipsa, U, { content: EN1, itemi: 5 }), null, 'salvarea scorului nu cade');
  assert.strictEqual(await P.rezumat(lipsa, U), null);
  // 13 nov. 2026: ținta poate fi și o clasă (a V-a … a XII-a) — test/plan-pregatire.test.js
  assert.deepStrictEqual(await P.alege(supa, U, ELEV, { examen: 'clasa-13' }), { error: 'Alege examenul (Evaluarea Națională sau un profil de BAC) sau o clasă, de la a V-a la a XII-a.' });
});

test('alegerea examenului → testul zilei din site (fără bareme; fără abonament doar cele gratuite); „🔀 Alt test"; PDF-ul oficial cu Premium', async () => {
  const supa = baza();
  const r = await P.alege(supa, U, ELEV, { examen: 'evaluare-nationala' });
  assert.strictEqual(r.ok, true);
  const s = r.pregatire;
  assert.strictEqual(s.examen.id, 'evaluare-nationala');
  assert.deepStrictEqual(s.test, { id: 'en-1', titlu: EN1.title, tip: 'interactiv', url: '/exercitiu?id=en-1&pregatire=1' });
  assert.deepStrictEqual([s.status, s.lucrat, s.itemi, s.prag, s.serie], ['deschis', false, 0, 3, 0]);
  assert.strictEqual(s.recompensa.xp, 25);
  assert.strictEqual(stats(supa).prep_exam, 'evaluare-nationala');
  assert.strictEqual(supa.db.tables.daily_tests.length, 1);
  // o nouă deschidere a paginii nu schimbă testul
  assert.strictEqual((await P.stare(supa, U, ELEV)).test.id, 'en-1');
  // „🔀 Alt test": en-3 (en-2 e doar cu abonament), apoi iar en-1
  const a1 = await P.altTest(supa, U, ELEV);
  assert.strictEqual(a1.pregatire.test.id, 'en-3');
  assert.strictEqual((await P.altTest(supa, U, ELEV)).pregatire.test.id, 'en-1');
  assert.strictEqual(supa.db.tables.daily_tests.length, 1, 'tot un rând pe zi');
  // PDF fără Premium → tot interactiv (corectarea scrisului e Premium)
  const f = await P.alege(supa, U, ELEV, { format: 'pdf' });
  assert.deepStrictEqual([f.pregatire.formatAles, f.pregatire.format, f.pregatire.test.tip], ['pdf', 'interactiv', 'interactiv']);
  // cu Premium: subiectul oficial PDF (variante / simulări / teste de antrenament — nu fișe)
  const fp = await P.alege(supa, U, PREMIUM, { format: 'pdf' });
  assert.deepStrictEqual([fp.pregatire.format, fp.pregatire.test.id], ['pdf', 'en-pdf']);
  // (13 nov. 2026) varianta n-are barem legat în datele de test → nu e pe harta PDF
  // (doar subiecte cu barem), deci testul zilei vine din alegerea veche
  assert.strictEqual(fp.pregatire.test.url, '/pdf-viewer?id=en-pdf&pregatire=1');
  assert.deepStrictEqual(fp.pregatire.plan.pdf.noduri, []);
  // BAC: doar testele profilului ales
  const b = baza();
  const rb = await P.alege(b, U, ELEV, { examen: 'bac-mate-info' });
  assert.strictEqual(rb.pregatire.test.id, 'bac-mi');
  const rs = await P.alege(b, U, ELEV, { examen: 'bac-stiinte' });
  assert.strictEqual(rs.pregatire.test.id, 'bac-sn', 'schimbarea examenului mută testul de azi (încă nelucrat)');
  // un singur test → „alt test" nu are ce schimba
  const unic = await P.altTest(b, U, ELEV);
  assert.strictEqual(unic.faraAltul, true);
  assert.strictEqual(unic.pregatire.test.id, 'bac-sn');
});

test('bifa zilei: de la 3 exerciții lucrate în ORICE test de examen (și o parte de test); răsplata o singură dată; fluxul fără note', async () => {
  const supa = baza();
  await P.alege(supa, U, ELEV, { examen: 'evaluare-nationala' });
  // materialul nu e test de examen → nimic
  assert.strictEqual(await P.inregistreaza(supa, U, { content: CONTINUT.find((c) => c.id === 'c6'), itemi: 10 }), null);
  assert.strictEqual(await P.inregistreaza(supa, U, { content: CONTINUT[0], itemi: 10 }), null, 'baremul nu se numără');
  // 2 exerciții: încă nu — „încă 1"
  const r2 = await P.inregistreaza(supa, U, { content: EN3, itemi: 2, pct: 50, subiecte: [1] });
  assert.deepStrictEqual([r2.lucrat, r2.tocmaiBifata, r2.lipsa, r2.itemi, r2.prag], [false, false, 1, 2, 3]);
  assert.strictEqual(randAzi(supa).items_done, 2);
  assert.strictEqual(evPregatire(supa).length, 0);
  // 3 exerciții dintr-un ALT test de EN decât cel al zilei: ziua se bifează
  const r3 = await P.inregistreaza(supa, U, { content: EN3, itemi: 3, pct: 90, nota: 3.7, subiecte: [1, 1, 2] });
  assert.strictEqual(r3.tocmaiBifata, true);
  assert.strictEqual(r3.lucrat, true);
  assert.deepStrictEqual([r3.xp, r3.coins, r3.bun, r3.bonusSerie, r3.serie, r3.total], [35, 5, true, false, 1, 1]);
  assert.deepStrictEqual(r3.insigne.map((b) => b.id), ['pregatire-prima-zi']);
  assert.strictEqual(r3.examen, 'Evaluarea Națională');
  const ev = evPregatire(supa);
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].xp, 35);
  assert.ok(ev[0].league_pts > 0, 'XP-ul intră și în liga săptămânii (clasamentul cu ceilalți)');
  const rand = randAzi(supa);
  assert.deepStrictEqual([rand.status, rand.items_done, rand.best_pct, Number(rand.grade), rand.worked_on, rand.xp], ['lucrat', 3, 90, 3.7, 'Subiectul I, Subiectul al II-lea', 35]);
  assert.ok(supa.db.tables.user_badges.some((b) => b.user_id === U && b.badge_id === 'pregatire-prima-zi'));
  // fluxul Arenei: ce a lucrat, fără notă
  const fl = supa.db.tables.arena_feed;
  const ft = fl.find((x) => x.kind === 'test');
  assert.deepStrictEqual(ft.payload, { examen: 'Evaluarea Națională', subiecte: ['Subiectul I', 'Subiectul al II-lea'], complet: false, link: '/pregateste-ma' });
  assert.ok(fl.some((x) => x.kind === 'insigna' && x.payload.insigna === 'Prima zi de pregătire'));
  assert.doesNotMatch(JSON.stringify(fl.map((x) => x.payload)), FARA_NOTE);
  // încă o rezolvare azi: fără a doua răsplată; nota și procentul rămân cele mai bune
  const r4 = await P.inregistreaza(supa, U, { content: EN1, itemi: 4, pct: 40, nota: 2.1 });
  assert.deepStrictEqual([r4.tocmaiBifata, r4.lucrat], [false, true]);
  assert.strictEqual(evPregatire(supa).length, 1);
  assert.deepStrictEqual([randAzi(supa).items_done, randAzi(supa).best_pct, Number(randAzi(supa).grade)], [4, 90, 3.7]);
  // mai târziu, testul întreg: fluxul spune „a rezolvat un test complet", insigna „Test complet"
  const r5 = await P.inregistreaza(supa, U, { content: EN1, itemi: 18, pct: 70, nota: 7.3, complet: true });
  assert.deepStrictEqual(r5.insigne.map((b) => b.id), ['pregatire-test-complet']);
  assert.strictEqual(supa.db.tables.arena_feed.filter((x) => x.kind === 'test').length, 1, 'tot un rând pe zi în flux');
  assert.strictEqual(supa.db.tables.arena_feed.find((x) => x.kind === 'test').payload.complet, true);
  assert.strictEqual(feed.descriere('test', supa.db.tables.arena_feed.find((x) => x.kind === 'test').payload).text, 'a rezolvat un test complet · Evaluarea Națională');
  assert.strictEqual(Number(randAzi(supa).grade), 7.3);
  assert.doesNotMatch(JSON.stringify(supa.db.tables.arena_feed.map((x) => x.payload)), FARA_NOTE);
  // pagina: azi bifată; nota e privată (o vede doar elevul, pe pagina lui)
  const s = await P.stare(supa, U, ELEV);
  assert.deepStrictEqual([s.lucrat, s.serie, s.total, s.aziFacut, s.nota, s.xpPrimit], [true, 1, 1, true, 7.3, 35]);
  assert.strictEqual(s.saptamana.find((z) => z.day === AZI).stare, 'facut');
  assert.deepStrictEqual(s.insigne.map((b) => b.id).sort(), ['pregatire-prima-zi', 'pregatire-test-complet']);
  assert.deepStrictEqual(await P.rezumat(supa, U), { examen: 'evaluare-nationala', azi: 'lucrat', serie: 1, aziFacut: true });
});

test('seria: 7 zile la rând → bonus +40 XP + 15 🪙, insigna și rândul din flux; două cereri simultane → o singură răsplată', async () => {
  const zile = [-6, -5, -4, -3, -2, -1].map((n) => ({ id: `d${n}`, user_id: U, day: zi(n), exam: 'evaluare-nationala', status: 'lucrat', items_done: 5, content_id: 'en-1', content_title: EN1.title, grade: 6.5, xp: 25 }));
  const supa = baza({
    daily_tests: [...zile, { id: 'dz', user_id: U, day: AZI, exam: 'evaluare-nationala', status: 'deschis', items_done: 0, content_id: 'en-3', content_title: EN3.title, content_type: 'interactive' }],
    user_stats: [{ user_id: U, prep_exam: 'evaluare-nationala', total_xp: 500, coins: 10 }],
  });
  const [a, b] = await Promise.all([
    P.inregistreaza(supa, U, { content: EN3, itemi: 3, pct: 60, subiecte: [3] }),
    P.inregistreaza(supa, U, { content: EN3, itemi: 3, pct: 60, subiecte: [3] }),
  ]);
  assert.strictEqual([a, b].filter((x) => x && x.tocmaiBifata).length, 1, 'o singură cerere bifează ziua');
  const r = a.tocmaiBifata ? a : b;
  assert.deepStrictEqual([r.serie, r.bonusSerie, r.xp, r.coins], [7, true, 65, 20]);
  assert.ok(r.insigne.some((x) => x.id === 'pregatire-serie-7'));
  assert.strictEqual(evPregatire(supa).length, 1);
  assert.strictEqual(evPregatire(supa)[0].meta.bonus_serie, true);
  const serie = supa.db.tables.arena_feed.find((x) => x.kind === 'serie');
  assert.deepStrictEqual(serie.payload, { serie: 7, link: '/pregateste-ma' });
  assert.strictEqual(feed.descriere('serie', serie.payload).text, 'are o serie de 7 zile de pregătire pentru examen');
  assert.strictEqual(supa.db.tables.arena_feed.find((x) => x.kind === 'test').payload.subiecte[0], 'Subiectul al III-lea');
  // pagina: ultimele zile (fără azi), cu nota lor privată
  const s = await P.stare(supa, U, ELEV);
  assert.strictEqual(s.serie, 7);
  assert.strictEqual(s.ultimele.length, 6);
  assert.strictEqual(s.ultimele[0].zi, zi(-1));
  assert.strictEqual(s.ultimele[0].nota, 6.5);
});

test('fără pagina deschisă azi: lucrul la un test de examen bifează ziua doar dacă elevul și-a ales examenul', async () => {
  const fara = baza();
  assert.strictEqual(await P.inregistreaza(fara, U, { content: EN1, itemi: 5 }), null);
  assert.strictEqual(fara.db.tables.daily_tests.length, 0, 'cine nu folosește „Pregătește-mă" nu primește rânduri');
  const cu = baza({ user_stats: [{ user_id: U, prep_exam: 'bac-mate-info', total_xp: 0, coins: 0 }] });
  const r = await P.inregistreaza(cu, U, { content: CONTINUT.find((c) => c.id === 'bac-mi'), itemi: 3 });
  assert.strictEqual(r.tocmaiBifata, true);
  assert.deepStrictEqual([randAzi(cu).exam, randAzi(cu).content_id, randAzi(cu).status], ['bac-mate-info', 'bac-mi', 'lucrat']);
});

// ═══════════════════════════ 4) amintirea zilnică ═══════════════════════════
const NOW = new Date('2026-11-09T16:20:00Z');   // 18:20 în România (ora de iarnă, UTC+2)
const AZI_C = xp.dayKey(NOW);
const UN = {
  ana: '11111111-1111-4111-8111-111111111111',      // amintire la 18, testul de azi neînceput, seria 2
  bogdan: '22222222-2222-4222-8222-222222222222',   // amintire la 18, ziua deja bifată
  cris: '33333333-3333-4333-8333-333333333333',     // amintire la 18, notificările oprite din cont
  dan: '88888888-8888-4888-8888-888888888888',      // amintirea oprită
  ema: '99999999-9999-4999-8999-999999999999',      // amintire la 18, dar fără examen ales
};
function seedNotif() {
  const st = (id, extra) => ({ user_id: id, prep_exam: 'evaluare-nationala', prep_notify: true, prep_notify_hour: 18, prep_notified_on: null, prep_streak_notified_on: null, ...extra });
  return createFakeSupabase({
    user_stats: [st(UN.ana), st(UN.bogdan), st(UN.cris), st(UN.dan, { prep_notify: false }), st(UN.ema, { prep_exam: null })],
    profiles: [{ id: UN.ana, notifications_enabled: true }, { id: UN.bogdan }, { id: UN.cris, notifications_enabled: false }, { id: UN.dan }, { id: UN.ema }],
    daily_tests: [
      { user_id: UN.ana, day: AZI_C, status: 'deschis', content_id: 'en-pdf', content_title: 'EN 2025 — Varianta 1', content_type: 'pdf', exam: 'evaluare-nationala' },
      { user_id: UN.ana, day: xp.addDays(AZI_C, -1), status: 'lucrat' },
      { user_id: UN.ana, day: xp.addDays(AZI_C, -2), status: 'lucrat' },
      { user_id: UN.bogdan, day: AZI_C, status: 'lucrat', content_id: 'en-1', content_title: 'Test 1' },
    ],
    ai_notifications: [],
  });
}
function stubPush(sentFor = () => 1) {
  const calls = [];
  const orig = PUSH.sendToUser;
  PUSH.sendToUser = async (supa, userId, payload) => { calls.push({ userId, payload }); return { sent: sentFor(userId), failed: 0, gone: 0 }; };
  return { calls, restore: () => { PUSH.sendToUser = orig; } };
}

test('mesajele amintirii: testul zilei, seria, „contează și o parte din test", clicul deschide direct testul', () => {
  const a = PN.mesajAmintire({ titlu: 'EN 2025 — Varianta 1', examen: 'evaluare-nationala', serie: 2, row: { content_id: 'en-pdf', content_type: 'pdf' }, azi: AZI });
  assert.match(a.title, /Testul zilei · seria ta: 2 zile 🔥/);
  assert.match(a.body, /EN 2025 — Varianta 1 — rezolvă măcar 3 exerciții și ziua e bifată\. Contează și o parte din test\./);
  assert.strictEqual(a.url, '/pdf-viewer?id=en-pdf&pregatire=1');
  assert.deepStrictEqual([a.kind, a.tag, a.requireInteraction], ['pregatire', `pregatire-${AZI}`, false]);
  const b = PN.mesajAmintire({ examen: 'bac-mate-info', serie: 0, azi: AZI });
  assert.strictEqual(b.title, '📝 Testul zilei te așteaptă');
  assert.match(b.body, /de BAC Mate-Info/);
  assert.strictEqual(b.url, '/pregateste-ma', 'fără test atribuit încă → pagina (îl atribuie la deschidere)');
  assert.strictEqual(PN.mesajAmintire({ row: { content_id: 'en-1', content_type: 'interactive' } }).url, '/exercitiu?id=en-1&pregatire=1');
  const s = PN.mesajSerie({ serie: 5, titlu: 'Test 3', azi: AZI });
  assert.match(s.title, /Seria ta de 5 zile de pregătire se pierde la noapte/);
  assert.match(s.body, /3 exerciții o salvează: 📝 Test 3/);
  assert.strictEqual(s.tag, `pregatire-${AZI}`, 'înlocuiește amintirea de după-amiază');
});

test('cronul de la 18: doar cine are amintirea pornită, examenul ales, ziua nebifată și notificările permise — o dată pe zi', async () => {
  const supa = seedNotif();
  const p = stubPush();
  try {
    const r = await PN.cron(supa, { now: NOW });
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.ora, 18);
    assert.deepStrictEqual(p.calls.map((c) => c.userId), [UN.ana], 'Bogdan a bifat ziua, Cris a oprit notificările, Dan amintirea, Ema n-are examen');
    const pay = p.calls[0].payload;
    assert.match(pay.title, /seria ta: 2 zile/);
    assert.match(pay.body, /EN 2025 — Varianta 1/);
    assert.strictEqual(pay.url, '/pdf-viewer?id=en-pdf&pregatire=1');
    assert.deepStrictEqual([r.amintiri.trimise, r.amintiri.push, r.amintiri.facute, r.amintiri.oprite], [1, 1, 1, 1]);
    const st = (id) => supa.db.tables.user_stats.find((x) => x.user_id === id);
    assert.strictEqual(st(UN.ana).prep_notified_on, AZI_C);
    assert.strictEqual(st(UN.dan).prep_notified_on, null);
    // a doua rulare (aceeași oră sau 19:00) nu mai trimite nimic
    const r2 = await PN.cron(supa, { now: new Date('2026-11-09T17:10:00Z') });
    assert.strictEqual(r2.amintiri.trimise, 0);
    assert.strictEqual(p.calls.length, 1);
    // noaptea: nimic
    const n = await PN.cron(seedNotif(), { now: new Date('2026-11-09T21:30:00Z') });
    assert.match(n.sarit || '', /liniste/);
  } finally { p.restore(); }
});

test('fără Web Push livrat: amintirea ajunge în clopoțel (tipul „pregatire"); seara, alerta de serie o singură dată', async () => {
  const supa = seedNotif();
  let p = stubPush(() => 0);
  try {
    await PN.cron(supa, { now: NOW });
    const n = supa.db.tables.ai_notifications;
    assert.strictEqual(n.length, 1);
    assert.deepStrictEqual([n[0].recipient_id, n[0].type, n[0].data.url, n[0].dedupe_key], [UN.ana, 'pregatire', '/pdf-viewer?id=en-pdf&pregatire=1', `pregatire-zi:${AZI_C}`]);
  } finally { p.restore(); }
  p = stubPush();
  try {
    const seara = await PN.cron(supa, { now: new Date('2026-11-09T18:07:00Z') });   // 20:07
    const serie = p.calls.filter((c) => /se pierde la noapte/.test(c.payload.title));
    assert.deepStrictEqual(serie.map((c) => c.userId), [UN.ana]);
    assert.strictEqual(seara.serie.trimise, 1);
    const again = await PN.cron(supa, { now: new Date('2026-11-09T18:40:00Z') });
    assert.strictEqual(again.serie.trimise, 0);
  } finally { p.restore(); }
  assert.match(read('src/components/AINotifications.jsx'), /pregatire: '📝'/, 'clopoțelul are pictograma testului zilei');
});

test('amintirea: pornită / oprită / ora (8–21) în user_stats.prep_*; ora invalidă → 400; fără migrare → 503', async () => {
  const supa = baza();
  const r = await PN.seteaza(supa, U, { on: true, ora: 19 });
  assert.deepStrictEqual([r.ok, r.notificari.on, r.notificari.ora, r.notificari.ales], [true, true, 19, true]);
  assert.deepStrictEqual([stats(supa).prep_notify, stats(supa).prep_notify_hour], [true, 19]);
  await assert.rejects(() => PN.seteaza(supa, U, { ora: 3 }), (e) => e.status === 400);
  const off = await PN.seteaza(supa, U, { on: false });
  assert.strictEqual(off.notificari.on, false);
  assert.strictEqual((await PN.stare(baza(), U)).ora, 18, 'implicit 18:00');
  const lipsa = baza();
  lipsa.db.tables.user_stats = [];
  lipsa.db.failTables.add('user_stats');
  await assert.rejects(() => PN.seteaza(lipsa, U, { on: true }), (e) => e.status === 503);
});

// ═══════════════════════════ 5) API ═══════════════════════════
function stubApi(supa, profile = ELEV) {
  const saved = { admin: ai.admin, authUser: ai.authUser, requireUser: ai.requireUser, applyCors: ai.applyCors };
  Object.assign(ai, { admin: () => supa, authUser: async () => U, requireUser: async () => profile, applyCors: () => {} });
  return () => Object.assign(ai, saved);
}
const post = async (handler, body, extra = {}) => { const res = fakeRes(); await handler({ method: 'POST', headers: {}, query: {}, body, ...extra }, res); return res; };

test('api/gamificare: „pregatire", „pregatire_alege", „pregatire_alt_test", „pregatire_notificari", starea (pregatireAzi), cronul cu secret', async () => {
  const supa = baza();
  const restore = stubApi(supa);
  try {
    const handler = require('../api/gamificare');
    let r = await post(handler, { action: 'pregatire' });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.pregatire.alegeExamen, true);
    assert.ok('notificari' in r.body);
    r = await post(handler, { action: 'pregatire_alege', examen: 'evaluare-nationala' });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.pregatire.test.id, 'en-1');
    r = await post(handler, { action: 'pregatire_alege', examen: 'admitere' });
    assert.strictEqual(r.statusCode, 400);
    r = await post(handler, { action: 'pregatire_alt_test' });
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.body.pregatire.test.id, 'en-3');
    r = await post(handler, { action: 'pregatire_notificari', on: true, ora: 17 });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.deepStrictEqual([r.body.notificari.on, r.body.notificari.ora], [true, 17]);
    r = await post(handler, { action: 'pregatire_notificari', ora: 23 });
    assert.strictEqual(r.statusCode, 400);
    r = await post(handler, { action: 'state' });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.pregatireAzi, { examen: 'evaluare-nationala', azi: 'deschis', serie: 0, aziFacut: false });
    // cronul amintirilor cere secretul
    let res = fakeRes();
    await handler({ method: 'GET', query: { action: 'cron-pregatire' }, headers: {} }, res);
    assert.strictEqual(res.statusCode, 403);
    res = fakeRes();
    await handler({ method: 'GET', query: { action: 'cron-pregatire' }, headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok('amintiri' in res.body);
  } finally { restore(); }
});

test('api/gamificare: „arena_feed" (cu provocarea bonus de azi, o singură dată) și „arena_public"', async () => {
  const supa = baza();
  await feed.post(supa, { userId: ALT, kind: 'duel', dedupeKey: 'duel:1' });
  supa.db.tables.profiles.push({ id: ALT, full_name: 'Bogdan Ionescu' });
  const restore = stubApi(supa);
  try {
    const handler = require('../api/gamificare');
    let r = await post(handler, { action: 'arena_feed', limit: 6 });
    assert.strictEqual(r.statusCode, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.feed.items.map((i) => [i.kind, i.nume]), [['provocare', null], ['duel', 'Bogdan I.']]);
    assert.match(r.body.feed.items[0].text, /^Provocarea bonus de azi: /);
    assert.deepStrictEqual(r.body.public, { setup: true, public: true });
    r = await post(handler, { action: 'arena_feed' });
    assert.strictEqual(supa.db.tables.arena_feed.filter((x) => x.kind === 'provocare').length, 1);
    r = await post(handler, { action: 'arena_public', on: false });
    assert.deepStrictEqual(r.body, { ok: true, public: false });
    assert.strictEqual(stats(supa).arena_public, false);
  } finally { restore(); }
});

function stubScore(supa, verif) {
  const restore = stubApi(supa);
  const saved = { vs: score.verifiedScore, lh: score.loadContentHtml };
  score.verifiedScore = async () => verif;
  score.loadContentHtml = async () => '';
  return () => { restore(); score.verifiedScore = saved.vs; score.loadContentHtml = saved.lh; };
}

test('api/ai-score: și salvarea automată de la jumătate bifează ziua (3 exerciții); testul terminat → nota (privată) și „test complet"', async () => {
  const supa = baza({ user_stats: [{ user_id: U, prep_exam: 'evaluare-nationala', total_xp: 0, coins: 0, league_tier: 1 }] });
  const restore = stubScore(supa, { hasKeys: true, verified: true, score: 50, maxScore: 100, pct: 50, correct: 9, total: 18 });
  try {
    const handler = require('../api/ai-score');
    const r18 = (n) => Array.from({ length: 18 }, (_, i) => (i < n ? 'a' : ''));
    let res = await post(handler, { contentId: 'en-3', answers: r18(2), score: 0, maxScore: 0, partial: true });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.deepStrictEqual([res.body.pregatire.lucrat, res.body.pregatire.lipsa], [false, 1]);
    res = await post(handler, { contentId: 'en-3', answers: r18(3), score: 0, maxScore: 0, partial: true });
    assert.strictEqual(res.body.partial, true);
    assert.strictEqual(res.body.pregatire.tocmaiBifata, true, 'a lucrat 3 exerciții, fără să termine testul');
    assert.deepStrictEqual([randAzi(supa).status, randAzi(supa).worked_on], ['lucrat', 'Subiectul I']);
    res = await post(handler, { contentId: 'en-3', answers: r18(18), score: 50, maxScore: 100 });
    assert.strictEqual(res.statusCode, 200, JSON.stringify(res.body));
    assert.strictEqual(res.body.pregatire.tocmaiBifata, false);
    assert.deepStrictEqual(res.body.pregatire.insigne.map((b) => b.id), ['pregatire-test-complet']);
    assert.strictEqual(Number(randAzi(supa).grade), 5, 'nota testului (50/100 → 5,00), ca la „Rezultate elevi"');
    assert.strictEqual(evPregatire(supa).length, 1);
    assert.doesNotMatch(JSON.stringify(supa.db.tables.arena_feed.map((x) => x.payload)), FARA_NOTE);
  } finally { restore(); }
});

test('celelalte corectări numără și ele: ai-correct (foaia / formularul), ai-handwriting, rezolva-pdf', () => {
  for (const f of ['api/ai-correct.js', 'api/ai-handwriting.js', 'api/rezolva-pdf.js', 'api/ai-score.js']) {
    const src = read(f);
    assert.match(src, /require\('\.\/_lib\/pregatireZilnica'\)/, f);
    assert.match(src, /pregatire\.inregistreaza\(supa, userId, \{/, f);
    assert.match(src, /pregatire: pregatire(Rez|P|Rez)?/, `${f} întoarce rezultatul (PregatireToast)`);
  }
  // fluxul primește și promovările din ligă, duelurile, turneele, nivelurile
  assert.match(read('api/gamificare.js'), /kind: 'promovare', dedupeKey: `promovare:\$\{r\.user_id\}:\$\{season\.week_start\}`/);
  assert.match(read('api/_lib/duel.js'), /kind: 'duel', dedupeKey: `duel:\$\{d\.id\}`, payload: \{ link: '\/arena' \}/, 'fără adversar și fără scor');
  assert.match(read('api/_lib/turneu.js'), /if \(t\.scope === 'public'\)/, 'câștigătorii doar din turneele publice');
  assert.match(read('api/_lib/turneu.js'), /kind: 'turneu', dedupeKey: `turneu-nou:\$\{t\.id\}`/);
  assert.match(read('api/_lib/xp.js'), /kind: 'nivel'/);
});

// ═══════════════════════════ 6) SQL + cron ═══════════════════════════
test('migrarea: RLS + GRANT (authenticated, service_role) imediat după fiecare tabelă, fără anon; politici; coloanele din user_stats', () => {
  const sql = read('supabase/pregatire_zilnica.sql');
  for (const t of ['daily_tests', 'arena_feed']) {
    const i = sql.indexOf(`create table if not exists public.${t} (`);
    assert.ok(i > 0, t);
    const dupa = sql.slice(sql.indexOf(');', i) + 2).trimStart();
    assert.ok(dupa.startsWith(`alter table public.${t} enable row level security;`), `${t}: RLS imediat după tabelă`);
    assert.match(sql, new RegExp(`grant select, insert, update, delete on public\\.${t} to authenticated;`));
    assert.match(sql, new RegExp(`grant select, insert, update, delete on public\\.${t} to service_role;`));
    assert.ok(sql.indexOf(`to service_role;`, i) < sql.indexOf('create index', i), `${t}: grant-urile înaintea indexurilor`);
    assert.match(sql, new RegExp(`create policy ${t}_service on public\\.${t} for all to service_role`));
  }
  assert.doesNotMatch(sql, /to anon/, 'nimic public pentru vizitatorii fără cont');
  assert.match(sql, /daily_tests_own_select on public\.daily_tests for select to authenticated\s+using \(user_id = \(select auth\.uid\(\)\)\)/);
  assert.doesNotMatch(sql, /policy arena_feed_\w+ on public\.arena_feed for select to authenticated/, 'fluxul se citește doar prin API (nume scurtate, opt-out)');
  assert.match(sql, /unique \(user_id, day\)/);
  assert.match(sql, /create unique index if not exists uq_arena_feed_dedupe on public\.arena_feed\(dedupe_key\) where dedupe_key is not null;/);
  assert.match(sql, /check \(status in \('deschis', 'lucrat'\)\)/);
  for (const c of ['prep_exam text', 'prep_format text', 'prep_notify boolean', 'prep_notify_hour smallint not null default 18', 'prep_notified_on date', 'prep_streak_notified_on date', 'arena_public boolean not null default true']) {
    assert.ok(sql.includes(`alter table public.user_stats add column if not exists ${c};`), c);
  }
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /\b(grade|nota)\b[^\n]*arena_feed|arena_feed[^\n]*\bgrade\b/, 'fluxul nu are coloană de notă');
});

test('vercel.json: cronul amintirilor testului zilei, la fiecare oră', () => {
  const v = JSON.parse(read('vercel.json'));
  const c = v.crons.find((x) => x.path === '/api/gamificare?action=cron-pregatire');
  assert.ok(c, 'cronul testului zilei');
  assert.strictEqual(c.schedule, '8 * * * *');
  assert.ok(v.crons.some((x) => x.path === '/api/gamificare?action=cron-misiune'), 'cronul misiunii rămâne');
});

// ═══════════════════════════ 7) nota scrisă cu roșu pe test ═══════════════════════════
let libP = null;
const lib = () => (libP || (libP = import('../src/lib/pdfRezolvare.js')));

test('nota cu roșu: „7,30 (șapte^30)", în litere, cu sutimile în exponent; pe prima pagină, sus, în dreapta', async () => {
  const { notaScrisa, pozitieNota, latimeNota } = await lib();
  assert.deepStrictEqual(notaScrisa(7.3), { cifre: '7,30', cuvant: 'șapte', zecimale: '30', text: '7,30 (șapte^30)' });
  assert.deepStrictEqual(notaScrisa(10), { cifre: '10,00', cuvant: 'zece', zecimale: '', text: '10,00 (zece)' });
  assert.strictEqual(notaScrisa(2).text, '2,00 (doi)');
  assert.strictEqual(notaScrisa(4.05).text, '4,05 (patru^05)');
  assert.strictEqual(notaScrisa(9.999).text, '10,00 (zece)');
  assert.strictEqual(notaScrisa(0.4).text, '1,00 (unu)', 'nota minimă e 1');
  assert.strictEqual(notaScrisa('x'), null);
  const p = pozitieNota(595, 842);
  assert.ok(p.x > 595 * 0.85 && p.x <= 595, 'în dreapta');
  assert.ok(p.y < 842 * 0.06, 'sus, în marginea paginii');
  assert.ok(p.size >= 18 && p.size <= 34);
  assert.ok(p.rot < 0, 'ușor înclinată, ca scrisul de mână');
  assert.ok(latimeNota(notaScrisa(7.3), p.size) > latimeNota(notaScrisa(2), p.size) - 1);
});

test('nota cu roșu nu acoperă textul paginii: caută primul loc liber din dreapta-sus (antetul subiectului rămâne lizibil)', async () => {
  const { notaScrisa, pozitieNota, latimeNota, cutiiText } = await lib();
  const it = (str, x, y, w, h = 11) => ({ str, x, y, w, h });
  // antetul unui subiect oficial (centrat), cu originea jos-stânga, ca la pdf.js
  const antet = { n: 1, view: [0, 0, 595, 842], items: [
    it('Ministerul Educației', 240, 812, 110), it('Centrul Național de Politici și Evaluare în Educație', 152, 798, 290),
    it('Evaluarea Națională pentru absolvenții clasei a VIII-a', 140, 784, 315), it('Varianta 3', 270, 770, 55),
    it('   ', 500, 820, 20), { str: 'filigran', x: 300, y: 500, w: 200, h: 40, rot: true },
  ] };
  const cutii = cutiiText(antet);
  assert.strictEqual(cutii.length, 4, 'fără spații goale și fără textul rotit (filigran)');
  assert.deepStrictEqual(Object.keys(cutii[0]).sort(), ['x0', 'x1', 'y0', 'y1']);
  assert.ok(cutii[0].y0 < cutii[0].y1 && cutii[0].y0 > 20 && cutii[0].y1 < 40, 'coordonate de sus în jos');
  const ns = notaScrisa(7.3);
  const lat = latimeNota(ns, pozitieNota(595, 842).size);
  const P = pozitieNota(595, 842, { cutii, latime: lat });
  assert.strictEqual(P.liber, true);
  // verificare independentă: nota (înclinată: spre stânga coboară) nu atinge niciun rând —
  // marginea de jos în capătul stâng al porțiunii comune, cea de sus în capătul drept
  const panta = Math.tan(6 * Math.PI / 180);
  for (const c of cutii) {
    const a = Math.max(c.x0, P.x - lat), b = Math.min(c.x1, P.x);
    if (a >= b) continue;
    const sub = c.y0 >= P.y + P.size * 0.3 + (P.x - a) * panta;
    const deasupra = c.y1 <= P.y - P.size * 0.9 + (P.x - b) * panta;
    assert.ok(sub || deasupra, `nota peste „${JSON.stringify(c)}"`);
  }
  assert.ok(P.y < 842 * 0.12, 'tot în partea de sus a paginii');
  // rândurile care ajung până în colțul din dreapta-sus → nota coboară sub ele
  const plin = { n: 1, view: [0, 0, 595, 842], items: [0, 1, 2, 3].map((k) => it('Text care ocupă toată lățimea paginii', 40, 830 - k * 14, 515)) };
  const P2 = pozitieNota(595, 842, { cutii: cutiiText(plin), latime: lat });
  assert.strictEqual(P2.liber, true);
  assert.ok(P2.y - P2.size * 0.92 > 842 - (830 - 3 * 14) - 1, 'sub ultimul rând');
  // pagina plină de text până jos → rămâne în marginea de sus (fără să rătăcească prin pagină)
  const tot = { n: 1, view: [0, 0, 595, 842], items: Array.from({ length: 60 }, (_, k) => it('rând', 0, 840 - k * 12, 595)) };
  const P3 = pozitieNota(595, 842, { cutii: cutiiText(tot), latime: lat });
  assert.ok(!P3.liber && P3.y < 842 * 0.06);
  // harta testului poartă cutiile primei pagini (și când structura nu e recunoscută)
  const { buildExamMap } = await lib();
  assert.deepStrictEqual(buildExamMap([antet]).cutii1, cutii);
  assert.match(read('src/components/RezolvarePdf.jsx'), /cutii: \(map && map\.cutii1\) \|\| null/);
});

// PNG roșu de 4×2 px (cum îl desenează browserul pentru nota scrisă de mână)
function pngRosu(w = 4, h = 2) {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); } return ~c >>> 0; };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [211, 47, 47, 255]).flat())])));
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

test('⬇ PDF-ul descărcat poartă nota scrisă cu roșu pe prima pagină (imagine), restul PDF-ului rămâne la fel', async () => {
  const PDFLib = require('pdf-lib');
  globalThis.window = globalThis.window || {};
  globalThis.window.PDFLib = PDFLib;
  const { exportInkPdf } = await lib();
  const doc = await PDFLib.PDFDocument.create();
  doc.addPage([595, 842]); doc.addPage([595, 842]);
  const bytes = await doc.save();
  const geo = { 1: { W: 595, H: 842, x0: 0, top: 842 }, 2: { W: 595, H: 842, x0: 0, top: 842 } };
  const ink = { 2: [{ pts: [[100, 100], [140, 120]], c: '#1c4dd9', w: 1.4 }] };
  const imgs = (pdf, i) => {
    const res = pdf.getPages()[i].node.Resources();
    const xo = res && res.lookup(PDFLib.PDFName.of('XObject'));
    return xo ? xo.keys().length : 0;
  };
  const cu = await PDFLib.PDFDocument.load(await exportInkPdf(bytes, ink, geo, { notaImg: { png: pngRosu(), x: 380, y: 30, w: 170, h: 46 } }));
  assert.strictEqual(cu.getPageCount(), 2);
  assert.strictEqual(imgs(cu, 0), 1, 'nota e pe pagina 1');
  assert.strictEqual(imgs(cu, 1), 0);
  const fara = await PDFLib.PDFDocument.load(await exportInkPdf(bytes, ink, geo));
  assert.strictEqual(imgs(fara, 0), 0, 'fără notă (nimic corectat încă) → fără imagine');
  // o imagine stricată nu strică descărcarea
  const stricat = await PDFLib.PDFDocument.load(await exportInkPdf(bytes, ink, geo, { notaImg: { png: new Uint8Array([1, 2, 3]), x: 0, y: 0, w: 10, h: 10 } }));
  assert.strictEqual(stricat.getPageCount(), 2);
});

test('nota cu roșu în interfață: SVG cu fontul de mână (Caveat), roșu, pe pagina 1; aceeași notă în PDF-ul descărcat', () => {
  const src = read('src/components/RezolvarePdf.jsx');
  assert.match(src, /import '@fontsource\/caveat\/700\.css'/);
  assert.match(src, /export function NotaRosie\(/);
  assert.match(src, /#d32f2f/);
  assert.match(src, /Caveat/);
  assert.match(src, /nota=\{n === 1 \? notaPag : null\}/, 'doar pe prima pagină');
  assert.match(src, /exportInkPdf\(data, store\.ink, geo, \{ notaImg \}\)/);
  const pkg = JSON.parse(read('package.json'));
  assert.ok(pkg.dependencies['@fontsource/caveat'], 'fontul de mână e în dependențe (fără CDN)');
  // nota pe orice corectare (și pe o parte de test), salvată la „Rezultatele mele" / „Rezultate elevi"
  const rp = read('api/rezolva-pdf.js');
  assert.match(rp, /const nota = punctat && sum\.total \? med\.notaTest\(sum\.score, sum\.total\) : null;/);
  assert.match(rp, /saved = \{ kind: 'progress', attempts: r\.attempts, partial: !sum\.complete \};/);
});

// ═══════════════════════════ 8) butoanele și paginile ═══════════════════════════
test('butonul „🎯 Pregătește-mă de examen": primul în „Învățare cu AI" (meniul de pe telefon și cel lateral), în navbar (doar la elevi și vizitatori), în Prof Virtual înainte de Meditații live', async () => {
  const meniu = await import('../src/lib/meniu.js');
  assert.deepStrictEqual({ ...meniu.PREGATESTE_MA }, { to: '/pregateste-ma', icon: '🎯', label: 'Pregătește-mă de examen' });
  const src = read('src/lib/meniu.js');
  const iSec = src.indexOf("titlu: caElev ? 'Învățare cu AI' : 'Asistent AI'");
  assert.ok(iSec > 0, 'secțiunea „Învățare cu AI" (la profesori și părinți: „Asistent AI")');
  const iItems = src.indexOf('[', iSec);
  const primul = src.slice(iItems, src.indexOf("to: '/meditatii'", iItems));
  assert.match(primul, /\{ tip: 'link', \.\.\.PREGATESTE_MA, accent: true \}/, 'primul link al secțiunii');
  // același meniu alimentează hamburgerul (telefon) și meniul lateral (hover)
  const nav = read('src/components/Navbar.jsx');
  assert.match(nav, /sectiuniMeniu/);
  assert.match(nav, /className=\{`nav-pregatire/);
  const iPrep = nav.indexOf('nav-pregatire');
  const iLi = nav.lastIndexOf('<li', iPrep);
  assert.ok(iLi > 0 && nav.indexOf('<li', nav.indexOf('<ul', nav.lastIndexOf('<ul', iLi))) === iLi, 'primul element din bara de sus');
  // în bara de sus doar la elevi și vizitatori; profesorii și părinții îl au doar în meniu (11 nov. 2026)
  assert.match(nav, /const arataPregatire = !isTeacher && !isParent;/);
  assert.match(nav, /\{arataPregatire && \(\s*\n\s*<li>\s*\n\s*<Link to=\{PREGATESTE_MA\.to\}/);
  // 11 nov. 2026 (seara): „fiecare cont doar cu butoanele lui" — și în meniul lateral / ☰ doar la
  // elevi și vizitatori (plus admin, care le verifică pe toate); vezi test/navigare-pe-cont.test.js
  assert.match(src.slice(iSec, src.indexOf('Meditații live', iSec)), /\.\.\.\(caElev \? \[/);
  const are = (o) => meniu.sectiuniMeniu(o).flatMap((s) => s.items).some((i) => i.to === '/pregateste-ma');
  assert.ok(are({}) && are({ user: { id: 'u' } }), 'vizitator și elev');
  assert.ok(!are({ user: { id: 'u' }, isTeacher: true }) && !are({ user: { id: 'u' }, isParent: true }), 'profesorul și părintele nu-l au');
  const css = read('src/styles/global.css');
  assert.match(css, /\.nav-pregatire/);
  // Prof Virtual (fereastra din colț): înaintea „Meditații live"
  const tutor = read('src/components/AITutor.jsx');
  const iP = tutor.indexOf('className="pv-prep"');
  const iL = tutor.indexOf('className="pv-live"');
  assert.ok(iP > 0 && iL > iP, 'pv-prep înainte de pv-live');
  // pagina Profesorul Virtual: tabul înaintea meditațiilor
  const pv = read('src/pages/ProfesorVirtual.jsx');
  assert.ok(pv.indexOf("id: 'pregatire'") > 0 && pv.indexOf("id: 'pregatire'") < pv.indexOf("id: 'meditatii'"));
  assert.match(pv, /navigate\('\/pregateste-ma'\)/);
  // ruta
  const app = read('src/App.jsx');
  assert.match(app, /const PregatesteMa = lazy\(\(\) => import\('\.\/pages\/PregatesteMa'\)\)/);
  assert.match(app, /<Route path="\/pregateste-ma" element=\{<PregatesteMa \/>\} \/>/);
});

test('Home: secțiunea albastră e o bară orizontală subțire; sub ea, mare, cardul „Pregătește-mă de examen", înaintea tuturor cardurilor', () => {
  const home = read('src/pages/Home.jsx');
  const iBara = home.indexOf('className="hero hero-bara"');
  const iCard = home.indexOf('<PregatireCard />');
  const iExamene = home.indexOf('id="examene"');
  assert.ok(iBara > 0 && iCard > iBara && iExamene > iCard, 'bara → cardul → restul cardurilor');
  assert.ok(!/<section/.test(home.slice(home.indexOf('</section>', iBara), iCard)), 'nimic între bară și card');
  assert.match(home, /to="\/pregateste-ma"/);
  const css = read('src/styles/global.css');
  assert.match(css, /\.hero\.hero-bara\s*\{/);
  assert.match(css, /\.pz-home\s*\{/);
});

test('/pregateste-ma și /arena: alegerea examenului, testul zilei, amintirea, răsplata; fluxul Arenei cu opt-out și fără note', () => {
  const pg = read('src/pages/PregatesteMa.jsx');
  // 13 nov. 2026: „🔀 Alt test" a lăsat locul hărții pregătirii (pasul de azi = pasul curent; „⏭ Treci mai departe")
  for (const a of ["action: 'pregatire'", "action: 'pregatire_alege'", "action: 'plan_sari'", 'pregatire_notificari']) assert.ok(pg.includes(a), a);
  assert.match(pg, /<HartaPlan /);
  assert.match(pg, /<AmintireZilnica /, 'aceeași amintire ca la misiunea zilnică');
  assert.match(pg, /to="\/arena"/);
  const arena = read('src/pages/Arena.jsx');
  assert.match(arena, /<ArenaFeed \/>/);
  assert.match(arena, /to="\/pregateste-ma"/);
  const af = read('src/components/ArenaFeed.jsx');
  assert.match(af, /action: 'arena_feed'/);
  assert.match(af, /action: 'arena_public'/);
  assert.match(af, /niciodată note sau punctaje/);
  // vizualizatoarele: insigna „testul zilei", felicitarea; PDF-ul pornește direct rezolvarea
  const pdf = read('src/pages/PDFViewer.jsx');
  assert.match(pdf, /searchParams\.get\('pregatire'\) === '1'/);
  assert.match(pdf, /toggleSolve\(\);/);
  assert.match(pdf, /arataPregatire\(r\.pregatire\)/);
  const iv = read('src/pages/InteractiveViewer.jsx');
  assert.match(iv, /📝 TESTUL ZILEI/);
  assert.match(iv, /arataPregatire\(r\.pregatire\)/);
  // politica de confidențialitate: Arena fără note, opt-out
  const pol = read('src/pages/PoliticaConfidentialitate.jsx');
  assert.match(pol, /Pregătește-mă de examen/);
  assert.match(pol, /prenumele și inițiala/);
  assert.match(pol, /fără note, punctaje sau procente/);
  assert.match(pol, /debifând „Apar în activitatea Arenei"/);
});
