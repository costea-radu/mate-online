// Teste pentru Faza 3 (social media): UTM, semnătura cardurilor, caption,
// șabloanele de imagine + un test de fum al randării JPEG.
// Rulează cu: npm test  (node --test, fără dependențe de rețea)
const test = require('node:test');
const assert = require('node:assert');
const social = require('../api/_lib/social');
const socialImage = require('../api/social-image');

// ─── UTM ─────────────────────────────────────────────────────────────────────

test('addUtm: linkurile proprii primesc utm_source/medium/campaign', () => {
  const out = social.addUtm('https://examenmate.com/rezolvari/formule-arii-clasa-7', { source: 'facebook', campaign: 'formule-arii-clasa-7' });
  const u = new URL(out);
  assert.strictEqual(u.searchParams.get('utm_source'), 'facebook');
  assert.strictEqual(u.searchParams.get('utm_medium'), 'social');
  assert.strictEqual(u.searchParams.get('utm_campaign'), 'formule-arii-clasa-7');
  assert.strictEqual(u.pathname, '/rezolvari/formule-arii-clasa-7');
});

test('addUtm: rutele relative devin URL-uri absolute pe site, cu UTM', () => {
  const out = social.addUtm('/evaluare-nationala', { source: 'instagram', campaign: 'en-2027' });
  assert.ok(out.startsWith(`${social.SITE}/evaluare-nationala?`), `URL neașteptat: ${out}`);
  assert.ok(out.includes('utm_source=instagram'));
});

test('addUtm: linkurile externe rămân NEATINSE (nu poluăm URL-urile altora)', () => {
  const ext = 'https://edupedu.ro/un-articol';
  assert.strictEqual(social.addUtm(ext, { source: 'facebook', campaign: 'x' }), ext);
});

test('addUtm: parametrii existenți se păstrează, UTM se adaugă peste', () => {
  const out = social.addUtm('https://examenmate.com/rezolvari?filtru=clasa-7', { source: 'facebook', campaign: 'test' });
  const u = new URL(out);
  assert.strictEqual(u.searchParams.get('filtru'), 'clasa-7');
  assert.strictEqual(u.searchParams.get('utm_campaign'), 'test');
});

test('campaignSlug: explicit > din link > implicit; diacriticele se transliterează', () => {
  assert.strictEqual(social.campaignSlug('Formule Arii — Clasa a 7-a', null), 'formule-arii-clasa-a-7-a');
  assert.strictEqual(social.campaignSlug('', '/rezolvari/teorema-lui-pitagora'), 'teorema-lui-pitagora');
  assert.strictEqual(social.campaignSlug('', null), 'social');
  assert.strictEqual(social.campaignSlug('Șțăâî', null), 'staai');
});

// ─── Caption + media ─────────────────────────────────────────────────────────

test('buildCaption: linkul cu UTM vine pe rând separat; fără link = doar textul', () => {
  assert.strictEqual(social.buildCaption({ text: 'Salut!', utmLink: 'https://x.ro/y' }), 'Salut!\n\nhttps://x.ro/y');
  assert.strictEqual(social.buildCaption({ text: '  Salut!  ', utmLink: null }), 'Salut!');
});

test('isVideoUrl: mp4/mov = video; jpg/png = nu', () => {
  assert.ok(social.isVideoUrl('https://x.ro/clip.mp4'));
  assert.ok(social.isVideoUrl('https://x.ro/clip.MOV?v=1'));
  assert.ok(!social.isVideoUrl('https://x.ro/card.jpg'));
  assert.ok(!social.isVideoUrl('https://x.ro/api/social-image?template=formula'));
});

// ─── Semnătura parametrilor de imagine ───────────────────────────────────────

test('signImage/verifyImageSig: semnătura validă trece, textul modificat pică', () => {
  process.env.AI_SIGNING_SECRET = 'secret-de-test';
  // modulul citește secretul la fiecare apel (imageSecret) — nu la import
  const params = { template: 'formula', title: 'A = π·r²', subtitle: 'Aria cercului', badge: 'Clasa a 7-a' };
  const sig = social.signImage(params);
  assert.ok(sig.length >= 20, 'semnătura pare prea scurtă');
  assert.ok(social.verifyImageSig({ ...params, sig }));
  assert.ok(!social.verifyImageSig({ ...params, title: 'ALT TEXT', sig }), 'semnătura trebuia să pice la alt text');
  assert.ok(!social.verifyImageSig({ ...params, sig: 'a'.repeat(24) }), 'semnătura falsă trebuia să pice');
  delete process.env.AI_SIGNING_SECRET;
});

test('imageUrl: construiește URL semnat către /api/social-image; șablon inexistent → eroare', () => {
  process.env.AI_SIGNING_SECRET = 'secret-de-test';
  const url = social.imageUrl({ template: 'countdown', title: '325', subtitle: 'de zile până la EN' });
  const u = new URL(url);
  assert.strictEqual(u.pathname, '/api/social-image');
  assert.strictEqual(u.searchParams.get('template'), 'countdown');
  assert.ok(u.searchParams.get('sig'));
  assert.throws(() => social.imageUrl({ template: 'inexistent', title: 'x' }), /Șablon de imagine necunoscut/);
  delete process.env.AI_SIGNING_SECRET;
});

// ─── Șabloanele cardului ─────────────────────────────────────────────────────

function flatText(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { node.forEach((c) => flatText(c, out)); return out; }
  if (node.props) flatText(node.props.children, out);
  return out;
}

test('buildCard: fiecare șablon are eticheta lui + textul + brandul', () => {
  for (const [tpl, info] of Object.entries(socialImage.TEMPLATES)) {
    const card = socialImage.buildCard({ template: tpl, title: 'Titlu de test', subtitle: 'Subtitlu', badge: 'EN 2027' });
    const texts = flatText(card).join(' | ');
    assert.ok(texts.includes(info.label), `${tpl}: lipsește eticheta ${info.label}`);
    assert.ok(texts.includes('Titlu de test'), `${tpl}: lipsește titlul`);
    assert.ok(texts.includes('examenmate.com'), `${tpl}: lipsește brandul`);
  }
});

test('titleSize: texte mai lungi → font mai mic (să încapă în card)', () => {
  const short = socialImage.titleSize('A = π·r²');
  const long = socialImage.titleSize('Un titlu foarte foarte lung care se întinde pe mai multe rânduri întregi din card');
  assert.ok(short > long, `${short} ar trebui > ${long}`);
  assert.ok(long >= 44, 'fontul nu scade sub minim');
});

// ─── Testul de fum al randării (satori + sharp din package.json) ─────────────

test('renderCard: produce JPEG real (magic bytes ffd8) cu diacritice și π', async (t) => {
  try { require.resolve('sharp'); } catch { return t.skip('sharp neinstalat — rulează npm install'); }
  const jpeg = await socialImage.renderCard({
    template: 'formula',
    title: 'Aria cercului: A = π·r²',
    subtitle: 'Exemplu: r = 5 → A ≈ 78,5 cm² (Națională, ăâîșț)',
    badge: 'Clasa a 7-a',
  });
  assert.ok(Buffer.isBuffer(jpeg) && jpeg.length > 10_000, 'JPEG suspect de mic');
  assert.strictEqual(jpeg.slice(0, 2).toString('hex'), 'ffd8', 'nu e JPEG');
});
