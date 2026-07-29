// Teste pentru Faza 4 (GHID_AGENT_SEO_ACTIUNI.md): metadatele YouTube
// (validări + îmbinarea snippet-ului) și măsurarea din rank-tracking
// (agregarea gsc_snapshots, efectul acțiunilor, luna raportului).
// Rulează cu: npm test  (node --test, fără dependențe de rețea)

// Determinism: testele presupun YouTube NECONFIGURAT (modulele citesc env la load).
delete process.env.YT_CLIENT_ID;
delete process.env.YT_CLIENT_SECRET;
delete process.env.YT_REFRESH_TOKEN;

const test = require('node:test');
const assert = require('node:assert');
const yt = require('../api/_lib/youtube');
const seo = require('../api/_lib/seo');

// ─── checkVideoMeta: limitele oficiale YouTube ───────────────────────────────
test('checkVideoMeta: titlul — lungime, spații, fără < >', () => {
  assert.deepStrictEqual(yt.checkVideoMeta({ title: '  Teorema   lui Pitagora — explicată simplu  ' }),
    { title: 'Teorema lui Pitagora — explicată simplu' });
  assert.throws(() => yt.checkVideoMeta({ title: 'abc' }), /5–100/);
  assert.throws(() => yt.checkVideoMeta({ title: 'x'.repeat(101) }), /5–100/);
  assert.throws(() => yt.checkVideoMeta({ title: 'Formule <arii>' }), /< sau >/);
});

test('checkVideoMeta: descrierea se măsoară în BYTES (diacriticele ocupă 2)', () => {
  // 2600 de caractere „ă” = 5200 bytes > 5000 → respins, deși caracterele-s sub limită
  assert.throws(() => yt.checkVideoMeta({ description: 'ă'.repeat(2600) }), /5000/);
  const ok = yt.checkVideoMeta({ description: 'Rezolvări pas cu pas.\r\nLink: https://examenmate.com' });
  assert.strictEqual(ok.description, 'Rezolvări pas cu pas.\nLink: https://examenmate.com'); // CRLF normalizat
});

test('checkVideoMeta: tagurile — total ≤ ~480, fiecare ≤ 100, golurile eliminate', () => {
  const ok = yt.checkVideoMeta({ tags: [' matematica ', '', 'evaluarea nationala', 'bac'] });
  assert.deepStrictEqual(ok.tags, ['matematica', 'evaluarea nationala', 'bac']);
  assert.throws(() => yt.checkVideoMeta({ tags: ['x'.repeat(101)] }), /100 de caractere/);
  assert.throws(() => yt.checkVideoMeta({ tags: Array.from({ length: 30 }, (_, i) => `tag foarte lung numarul ${i} `.repeat(1)) }), /500/);
});

test('checkVideoMeta: doar câmpurile trimise apar în rezultat', () => {
  assert.deepStrictEqual(yt.checkVideoMeta({}), {});
  const r = yt.checkVideoMeta({ title: 'Titlu nou valid' });
  assert.ok(!('description' in r) && !('tags' in r));
});

// ─── applyMeta: update-ul YouTube ÎNLOCUIEȘTE snippet-ul întreg ──────────────
test('applyMeta: păstrează ce nu se schimbă (categoryId, limbile) și îmbină restul', () => {
  const current = {
    title: 'Vechi', description: 'Desc veche', tags: ['a', 'b'],
    categoryId: '27', defaultLanguage: 'ro', defaultAudioLanguage: 'ro',
  };
  const out = yt.applyMeta(current, { title: 'Nou' });
  assert.deepStrictEqual(out, {
    title: 'Nou', description: 'Desc veche', tags: ['a', 'b'],
    categoryId: '27', defaultLanguage: 'ro', defaultAudioLanguage: 'ro',
  });
  // fără categoryId în snippet → fallback 27 (Education), altfel update-ul e respins de API
  assert.strictEqual(yt.applyMeta({}, {}).categoryId, '27');
  // tags: null în patch = păstrează; [] explicit = șterge
  assert.deepStrictEqual(yt.applyMeta(current, { tags: [] }).tags, []);
  assert.deepStrictEqual(yt.applyMeta(current, {}).tags, ['a', 'b']);
});

test('youtube.enabled() e fals fără env — iar uneltele răspund elegant', async () => {
  assert.strictEqual(yt.enabled(), false);
  const exec = seo.makeToolExecutor({ supa: null, state: { proposals: [] } });
  const listMsg = await exec('yt_list_videos', {});
  assert.match(listMsg, /YT_CLIENT_ID/);                       // citire: mesaj, nu excepție
  await assert.rejects(exec('yt_update_video', { id: 'abc12345', title: 'Titlu nou', note: 'test' }), /YT_CLIENT_ID/); // scriere: eroare clară
  await assert.rejects(seo.executeAction(null, { type: 'yt_update_video', payload: { id: 'abc12345', changes: { title: { old: 'a', new: 'b' } } } }), /YT_CLIENT_ID|YouTube/);
});

// ─── buildRankData: agregarea istoricului gsc_snapshots ──────────────────────
const rows = [
  { day: '2026-07-01', dim: 'query', key: 'formule arii', clicks: 4, impressions: 100, position: 8.0 },
  { day: '2026-07-01', dim: 'query', key: 'teorema pitagora', clicks: 2, impressions: 50, position: 12.0 },
  { day: '2026-07-02', dim: 'query', key: 'formule arii', clicks: 6, impressions: 300, position: 6.0 },
  // 3 iulie lipsește complet (gaură de snapshot) — seriile trebuie să o tolereze
  { day: '2026-07-04', dim: 'query', key: 'teorema pitagora', clicks: 0, impressions: 20, position: 15.0 },
];

test('buildRankData: totaluri zilnice + top după clicuri + poziție ponderată cu impresiile', () => {
  const d = seo.buildRankData(rows, { top: 8 });
  assert.deepStrictEqual(d.daily, [
    { day: '2026-07-01', clicks: 6, impressions: 150 },
    { day: '2026-07-02', clicks: 6, impressions: 300 },
    { day: '2026-07-04', clicks: 0, impressions: 20 },
  ]);
  assert.strictEqual(d.aggregates[0].key, 'formule arii');     // 10 clicuri > 2
  // poziția „formule arii" = (8×100 + 6×300) / 400 = 6.5
  assert.strictEqual(d.aggregates[0].position, 6.5);
  // seria păstrează doar zilele cu date; ziua lipsă nu inventează valori
  assert.deepStrictEqual(d.series['formule arii'].map((p) => p.day), ['2026-07-01', '2026-07-02']);
  assert.strictEqual(d.series['formule arii'][1].position, 6);
});

test('buildRankData: cheile cerute explicit înving topul implicit', () => {
  const d = seo.buildRankData(rows, { keys: ['teorema pitagora'] });
  assert.deepStrictEqual(Object.keys(d.series), ['teorema pitagora']);
  assert.strictEqual(d.series['teorema pitagora'].length, 2);
});

// ─── actionSummary: eticheta + ruta măsurabilă a unei acțiuni ────────────────
test('actionSummary: rutele măsurabile (meta/articole) vs. doar-marker (restul)', () => {
  assert.deepStrictEqual(seo.actionSummary({ type: 'set_page_meta', payload: { route: '/evaluare-nationala' } }),
    { label: 'Meta /evaluare-nationala', route: '/evaluare-nationala' });
  assert.strictEqual(seo.actionSummary({ type: 'publish_article', payload: { slug: 'formule-arii' } }).route, '/rezolvari/formule-arii');
  assert.strictEqual(seo.actionSummary({ type: 'rename_material', payload: { new_title: 'X' } }).route, null);
  assert.strictEqual(seo.actionSummary({ type: 'yt_update_video', payload: { video_title: 'Clip' } }).route, null);
  assert.strictEqual(seo.actionSummary({ type: 'submit_sitemap', payload: {} }).route, null);
});

// ─── computeEffect: înainte vs. după (medii pe zi + poziția ponderată) ───────
test('computeEffect: acțiune veche → medii corecte înainte/după', () => {
  const day = '2026-01-15'; // demult în urmă: fereastra „după" e completă
  const pageRows = [];
  // 14 zile înainte: 1 clic/zi, 10 impresii/zi, poziția 10
  for (let i = 1; i <= 14; i++) pageRows.push({ day: seoAdd(day, -i), clicks: 1, impressions: 10, position: 10 });
  // ziua execuției + 13 după: 3 clicuri/zi, 20 impresii/zi, poziția 5
  for (let i = 0; i <= 13; i++) pageRows.push({ day: seoAdd(day, i), clicks: 3, impressions: 20, position: 5 });
  const e = seo.computeEffect(pageRows, { day, windowDays: 14 });
  assert.ok(!e.pending);
  assert.strictEqual(e.before.clicksPerDay, 1);
  assert.strictEqual(e.before.position, 10);
  assert.strictEqual(e.after.clicksPerDay, 2.8);   // 42 clicuri / 15 zile (ziua 0 inclusă)
  assert.strictEqual(e.after.position, 5);
});

test('computeEffect: acțiune de ieri → pending (prea devreme de măsurat)', () => {
  const yesterday = new Date(Date.now() - 86400 * 1000).toISOString().slice(0, 10);
  const e = seo.computeEffect([], { day: yesterday, windowDays: 14 });
  assert.strictEqual(e.pending, true);
});

// mic helper local pentru zile relative (dublează logica intern-testată addDays)
function seoAdd(day, n) {
  return new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
}

// ─── monthRange: luna calendaristică anterioară (și peste granița de an) ─────
test('monthRange: luna anterioară, inclusiv trecerea de an', () => {
  assert.deepStrictEqual(seo.monthRange(new Date('2026-08-01T07:00:00Z')),
    { start: '2026-07-01', end: '2026-07-31', label: 'iulie 2026' });
  const jan = seo.monthRange(new Date('2026-01-01T07:00:00Z'));
  assert.strictEqual(jan.start, '2025-12-01');
  assert.strictEqual(jan.end, '2025-12-31');
  // februarie: end corect pe an nebisect
  assert.strictEqual(seo.monthRange(new Date('2026-03-05T00:00:00Z')).end, '2026-02-28');
});

// ─── uneltele noi există în definiții + prompturile le pomenesc ──────────────
test('TOOLS conține uneltele YouTube; sarcinile youtube/report există', () => {
  const names = seo.TOOLS.map((t) => t.name);
  for (const n of ['yt_list_videos', 'yt_get_video', 'yt_update_video']) assert.ok(names.includes(n), n + ' lipsește');
  assert.ok(seo.TASKS.youtube && /yt_update_video/.test(seo.TASKS.youtube));
  assert.ok(seo.TASKS.report && /raport/i.test(seo.TASKS.report));
});
