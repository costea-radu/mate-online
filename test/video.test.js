// Teste pentru extensia Fazei 4 (cerută de admin, 29 iulie 2026):
//   • plainMath — LaTeX-ul din postări devine text Unicode (fără $);
//   • create_video — validarea specificației + slide-urile + MP4 (fum);
//   • editActionPayload — editarea propunerilor din coada de aprobare.
// Rulează cu: npm test  (node --test; testul de MP4 sare elegant fără ffmpeg)

delete process.env.YT_CLIENT_ID;
delete process.env.YT_CLIENT_SECRET;
delete process.env.YT_REFRESH_TOKEN;

const test = require('node:test');
const assert = require('node:assert');
const social = require('../api/_lib/social');
const video = require('../api/_lib/video');
const seo = require('../api/_lib/seo');

// ─── plainMath: formulele din captionuri (bug-ul „$" din postarea reală) ─────
test('plainMath: cazul real din postarea Instagram — dolarii dispar, puterile devin Unicode', () => {
  const input = '$(a+b)^2 = a^2 + 2ab + b^2$\n$(a-b)^2 = a^2 - 2ab + b^2$\n$a^2 - b^2 = (a-b)(a+b)$';
  assert.strictEqual(social.plainMath(input),
    '(a+b)² = a² + 2ab + b²\n(a-b)² = a² - 2ab + b²\na² - b² = (a-b)(a+b)');
});

test('plainMath: comenzi LaTeX uzuale → simboluri; indicii; exponenți compuși', () => {
  assert.strictEqual(social.plainMath('$\\frac{a}{b} \\cdot \\sqrt{x} \\le \\pi$'), '(a)/(b) · √(x) ≤ π');
  assert.strictEqual(social.plainMath('$x_1 + x_2 = -\\frac{b}{a}$'), 'x₁ + x₂ = -(b)/(a)');
  assert.strictEqual(social.plainMath('$x^{10} \\ne a^n$'), 'x¹⁰ ≠ aⁿ');
});

test('plainMath: textul fără formule și dolarul „monetar" rămân neatinse', () => {
  assert.strictEqual(social.plainMath('Abonamentul costă 20$ pe lună'), 'Abonamentul costă 20$ pe lună');
  assert.strictEqual(social.plainMath('Fără formule aici!'), 'Fără formule aici!');
});

test('schedule_social prin executor: textul e curățat de LaTeX înainte de propunere', async () => {
  const inserted = [];
  const supa = { from: () => ({ insert: (row) => ({ select: () => ({ single: async () => { inserted.push(row); return { data: { id: 'a1' }, error: null }; } }) }) }) };
  const exec = seo.makeToolExecutor({ supa, state: { proposals: [] } });
  await exec('schedule_social', { platform: 'facebook', text: 'Formula zilei: $(a+b)^2 = a^2 + 2ab + b^2$ — detalii pe site! #matematica', note: 'test' });
  assert.ok(inserted[0].payload.text.includes('(a+b)² = a² + 2ab + b²'));
  assert.ok(!inserted[0].payload.text.includes('$'));
});

// ─── checkVideoSpec: validarea montajului ────────────────────────────────────
const okScenes = [
  { template: 'intro', title: 'Titlu de test', subtitle: 'Subtitlu' },
  { template: 'final', title: 'Începe azi' },
];

test('checkVideoSpec: normalizare (format implicit vertical, secunde limitate 1.5–10)', () => {
  const spec = video.checkVideoSpec({ scenes: [{ ...okScenes[0], seconds: 0.2 }, { ...okScenes[1], seconds: 99 }] });
  assert.strictEqual(spec.format, 'vertical');
  assert.strictEqual(spec.w, 1080); assert.strictEqual(spec.h, 1920);
  assert.strictEqual(spec.scenes[0].seconds, 1.5);
  assert.strictEqual(spec.scenes[1].seconds, 10);
});

test('checkVideoSpec: respinge ce trebuie respins', () => {
  assert.throws(() => video.checkVideoSpec({ scenes: [okScenes[0]] }), /minim 2 scene/);
  assert.throws(() => video.checkVideoSpec({ scenes: Array.from({ length: 13 }, () => okScenes[0]) }), /maxim 12/);
  assert.throws(() => video.checkVideoSpec({ scenes: [{ template: 'dans', title: 'x' }, okScenes[1]] }), /șablon necunoscut/i);
  assert.throws(() => video.checkVideoSpec({ scenes: [{ template: 'intro' }, okScenes[1]] }), /title e obligatoriu/);
  assert.throws(() => video.checkVideoSpec({ scenes: [{ template: 'lista', title: 'x' }, okScenes[1]] }), /bullets/);
  assert.throws(() => video.checkVideoSpec({ scenes: [{ template: 'imagine', title: 'x' }, okScenes[1]] }), /image_url/);
  assert.throws(() => video.checkVideoSpec({ scenes: [{ template: 'imagine', title: 'x', image_url: 'ftp://x' }, okScenes[1]] }), /URL absolut/);
  // durata totală peste 75s
  const long = Array.from({ length: 9 }, () => ({ template: 'intro', title: 'x', seconds: 10 }));
  assert.throws(() => video.checkVideoSpec({ scenes: long }), /75s/);
});

test('checkVideoSpec: rutele relative de imagine devin URL-uri pe site', () => {
  const spec = video.checkVideoSpec({ scenes: [{ template: 'imagine', title: 'x', image_url: '/icons/icon-512.png' }, okScenes[1]] });
  assert.match(spec.scenes[0].image_url, /^https?:\/\/.+\/icons\/icon-512\.png$/);
});

test('buildScene: arborele slide-urilor are logo-ul și footerul brandului', () => {
  const tree = video.buildScene({ template: 'lista', title: 'T', bullets: ['a', 'b'], seconds: 3, subtitle: '', badge: '' }, { w: 1080, h: 1920, index: 0, total: 2 });
  const flat = JSON.stringify(tree);
  assert.ok(flat.includes('Examen') && flat.includes('Mate'), 'logo lipsă');
  assert.ok(flat.includes('examenmate.com'), 'footer lipsă');
  assert.ok(flat.includes('"a"') && flat.includes('"b"'), 'bullets lipsă');
});

// ─── create_video prin executor: propunerea (fără randare) ───────────────────
function fakeSupa(inserted) {
  return { from: () => ({ insert: (row) => ({ select: () => ({ single: async () => { inserted.push(row); return { data: { id: 'v1' }, error: null }; } }) }) }) };
}

test('create_video: youtube cere titlu; scenele sunt curățate de LaTeX; textul intră în payload', async () => {
  const inserted = [];
  const exec = seo.makeToolExecutor({ supa: fakeSupa(inserted), state: { proposals: [] } });
  await assert.rejects(
    exec('create_video', { platform: 'youtube', scenes: okScenes, text: 'Descriere suficient de lungă pentru validare.', note: 'n' }),
    /title/,
  );
  const msg = await exec('create_video', {
    platform: 'youtube', title: 'Prezentarea platformei ExamenMate',
    scenes: [{ template: 'intro', title: 'Formula $(a+b)^2$' }, { template: 'final', title: 'examenmate.com' }],
    text: 'Descriere completă a clipului, cu link către site.', tags: ['matematica', 'examen'], note: 'n',
  });
  assert.match(msg, /coada de aprobare/);
  const p = inserted[0].payload;
  assert.strictEqual(p.platform, 'youtube');
  assert.strictEqual(p.auto, false);                       // youtube → coada manuală
  assert.ok(p.scenes[0].title.includes('(a+b)²') && !p.scenes[0].title.includes('$'));
  assert.deepStrictEqual(p.tags, ['matematica', 'examen']);
});

test('create_video: instagram e automat + primește UTM pe link', async () => {
  const inserted = [];
  const exec = seo.makeToolExecutor({ supa: fakeSupa(inserted), state: { proposals: [] } });
  await exec('create_video', {
    platform: 'instagram', scenes: okScenes,
    text: 'Caption suficient de lung pentru validare. #matematica',
    link: '/rezolvari/formule-arii-clasa-7', note: 'n',
  });
  const p = inserted[0].payload;
  assert.strictEqual(p.auto, true);
  assert.match(p.utm_link, /utm_source=instagram/);
  assert.strictEqual(p.campaign, 'formule-arii-clasa-7');
});

// ─── editActionPayload: editarea propunerilor din coada de aprobare ──────────
test('editActionPayload: doar propunerile „proposed" se editează', () => {
  assert.throws(() => seo.editActionPayload({ type: 'schedule_social', status: 'executed', payload: {} }, { text: 'x' }), /în așteptare/);
});

test('editActionPayload: schedule_social — textul se curăță de LaTeX și se re-validează', () => {
  const action = { type: 'schedule_social', status: 'proposed', payload: { platform: 'instagram', text: 'vechi text destul de lung aici' } };
  const p = seo.editActionPayload(action, { text: 'Formula: $(a-b)^2 = a^2 - 2ab + b^2$ #matematica' });
  assert.ok(p.text.includes('(a-b)² = a² - 2ab + b²') && !p.text.includes('$'));
  assert.throws(() => seo.editActionPayload(action, { text: 'scurt' }), /prea scurt/);
  assert.throws(() => seo.editActionPayload(action, { text: 'x'.repeat(2100) }), /maxim 2000/);
});

test('editActionPayload: yt_update_video — editare pe câmpurile propuse; egal cu vechiul → schimbarea dispare', () => {
  const action = {
    type: 'yt_update_video', status: 'proposed',
    payload: { id: 'v', changes: { title: { old: 'Vechi titlu clip', new: 'Nou titlu clip' }, tags: { old: ['a'], new: ['b', 'c'] } } },
  };
  const p = seo.editActionPayload(action, { title: 'Titlu corectat de admin' });
  assert.strictEqual(p.changes.title.new, 'Titlu corectat de admin');
  assert.deepStrictEqual(p.changes.tags.new, ['b', 'c']); // neatins
  // aducerea AMBELOR câmpuri la valorile vechi → nu mai rămâne nimic → eroare
  assert.throws(() => seo.editActionPayload(action, { title: 'Vechi titlu clip', tags: ['a'] }), /nicio schimbare/);
  // câmp care nu era propus → refuzat explicit
  assert.throws(() => seo.editActionPayload(action, { description: 'ceva' }), /nu era în această propunere/);
});

test('editActionPayload: publish_article — content_md re-validat + HTML regenerat', () => {
  const action = {
    type: 'publish_article', status: 'proposed',
    payload: { slug: 's', title: 'Titlu articol valid', description: 'Descriere validă de peste patruzeci de caractere aici.', content_md: 'x'.repeat(900), content_html: '<p>vechi</p>' },
  };
  const body = 'Paragraf nou. **Important!**\n\n' + 'conținut '.repeat(120);
  const p = seo.editActionPayload(action, { content_md: body });
  assert.ok(p.content_html.includes('<strong>Important!</strong>'), 'HTML-ul trebuia regenerat din markdownul nou');
  assert.throws(() => seo.editActionPayload(action, { content_md: 'prea scurt' }), /minim 800/);
  assert.throws(() => seo.editActionPayload(action, { title: 'abc' }), /10–120/);
});

test('editActionPayload: tipurile fără editare sunt refuzate cu mesaj clar', () => {
  assert.throws(() => seo.editActionPayload({ type: 'submit_sitemap', status: 'proposed', payload: {} }, {}), /nu se pot edita/);
});

// ─── Randarea MP4 (fum) — sare elegant dacă ffmpeg-static nu e instalat ──────
test('renderVideo: montajul produce un MP4 real (scară mică)', { skip: !video.available() && 'ffmpeg-static neinstalat (npm install)' }, async () => {
  const spec = video.checkVideoSpec({
    scenes: [
      { template: 'intro', title: 'Test montaj', subtitle: 'Formule: (a±b)² = a² ± 2ab + b²', seconds: 1.5 },
      { template: 'statistica', title: '500+', subtitle: 'exerciții rezolvate', seconds: 1.5 },
      { template: 'final', title: 'examenmate.com', seconds: 1.5 },
    ],
  });
  const r = await video.renderVideo(spec, { _scale: 0.15 }); // 162×288 — rapid
  assert.strictEqual(r.buffer.slice(4, 8).toString('ascii'), 'ftyp', 'nu e un fișier MP4');
  assert.ok(r.buffer.length > 5000, 'MP4 suspect de mic');
});

test('uneltele/etichetele noi există', () => {
  assert.ok(seo.TOOLS.some((t) => t.name === 'create_video'));
  assert.ok(/create_video/.test(seo.TASKS.youtube) && /create_video/.test(seo.TASKS.social));
});
