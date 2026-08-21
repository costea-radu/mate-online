// Teste pentru /recenzii (JSON-LD + conținutul static din api/page-meta.js)
// și pentru emailul de invitație (api/review-invite.js). Fără rețea.
// Rulează cu: npm test
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { injectMeta, injectRoot, reviewsJsonLd, reviewsShell } = require('../api/page-meta');
const { reasonLine, buildEmail } = require('../api/review-invite');

const SITE = 'https://examenmate.com';
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const data = {
  stats: { avg: 4.667, n: 3 },
  items: [
    { id: 'r1', author_name: 'Maria <Ionescu>', author_role: 'parinte', stars: 5, body: 'Fiica mea a trecut de la 6 la 9.', reply: 'Mulțumim, Maria!', created_at: '2026-08-18T10:00:00Z' },
    { id: 'r2', author_name: 'Andrei P.', author_role: 'elev', stars: 4, body: 'Testele sunt ca modelele oficiale & utile.', reply: null, created_at: '2026-08-12T10:00:00Z' },
  ],
};

test('reviewsJsonLd: Organization + AggregateRating + review[]', () => {
  const ld = reviewsJsonLd(data, SITE);
  assert.strictEqual(ld['@type'], 'Organization');
  assert.strictEqual(ld.aggregateRating.ratingValue, '4.67');
  assert.strictEqual(ld.aggregateRating.reviewCount, '3');
  assert.strictEqual(ld.review.length, 2);
  assert.strictEqual(ld.review[0].reviewRating.ratingValue, '5');
  assert.strictEqual(ld.review[0].datePublished, '2026-08-18');
  assert.strictEqual(ld.review[0].author.name, 'Maria <Ionescu>'); // escaparea o face injectMeta (<)
});

test('reviewsJsonLd: fără recenzii aprobate → null (nu emitem rating gol)', () => {
  assert.strictEqual(reviewsJsonLd({ stats: null, items: [] }, SITE), null);
  assert.strictEqual(reviewsJsonLd({ stats: { avg: 0, n: 0 }, items: [] }, SITE), null);
});

test('reviewsShell + injectMeta: conținut în #root, JSON-LD escapat, fără HTML injectat', () => {
  let out = injectMeta(html, { route: '/recenzii', site: SITE, meta: { title: 'Recenzii ExamenMate', description: 'Păreri.', jsonld: reviewsJsonLd(data, SITE) } });
  out = injectRoot(out, reviewsShell(data));
  assert.ok(out.includes('<title>Recenzii ExamenMate</title>'));
  assert.ok(out.includes('application/ld+json'), 'JSON-LD lipsește');
  assert.ok(out.includes('\\u003cIonescu'), 'caracterul < din JSON-LD trebuie escapat');
  assert.ok(!out.includes('<Ionescu>'), 'HTML-ul din numele autorului a ajuns neescapat în pagină');
  assert.ok(out.includes('Maria &lt;Ionescu&gt;'), 'numele trebuie escapat în HTML');
  assert.ok(out.includes('4,7 din 5'), 'media cu virgulă lipsește');
  assert.ok(out.includes('Răspunsul echipei ExamenMate'), 'răspunsul echipei lipsește');
  assert.ok(out.includes('modelele oficiale &amp; utile'), 'textul recenziei trebuie escapat');
  assert.ok(!out.includes('<div id="root"></div>'), 'root-ul a rămas gol');
});

test('reviewsShell: fără recenzii → mesaj „a ta poate fi prima"', () => {
  const s = reviewsShell({ stats: null, items: [] });
  assert.ok(s.includes('a ta poate fi prima'));
});

test('reasonLine / buildEmail: personalizare și linkuri', () => {
  assert.ok(reasonLine({ tests: 5, premium_days: null }).includes('5 teste'));
  assert.ok(reasonLine({ tests: 0, premium_days: 9 }).includes('o săptămână'));
  assert.ok(reasonLine({ tests: 0, premium_days: 30 }).includes('câteva săptămâni'));
  const { html: mail, text } = buildEmail({ id: '00000000-0000-0000-0000-000000000001', full_name: 'Ion <Popescu>', role: 'profesor', tests: 3, premium_days: null });
  assert.ok(mail.includes('/recenzii#formular'), 'linkul către formular lipsește');
  assert.ok(mail.includes('action=unsubscribe'), 'linkul de dezabonare lipsește');
  assert.ok(mail.includes('Salut, Ion!'), 'prenumele lipsește');
  assert.ok(!mail.includes('<Popescu>'), 'numele trebuie escapat în email');
  assert.ok(mail.includes('profesor'), 'fraza pentru profesor lipsește');
  assert.ok(text.includes('/recenzii#formular'));
});
