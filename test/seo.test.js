// Teste pentru injectarea meta per rută (Faza 1, api/page-meta.js).
// Rulează cu: npm test  (node --test, fără dependențe de rețea)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { injectMeta, normRoute } = require('../api/page-meta');

const SITE = 'https://examenmate.com';
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('normRoute: normalizează și respinge rutele suspecte', () => {
  assert.strictEqual(normRoute('/'), '/');
  assert.strictEqual(normRoute('/evaluare-nationala'), '/evaluare-nationala');
  assert.strictEqual(normRoute('/rezolvari/arii-clasa-7'), '/rezolvari/arii-clasa-7');
  assert.strictEqual(normRoute('/bacalaureat/'), '/bacalaureat');      // fără slash final
  assert.strictEqual(normRoute('//clase//7'), '/clase/7');             // slash-uri duble
  assert.strictEqual(normRoute(undefined), '/');
  assert.strictEqual(normRoute('javascript:alert(1)'), '/');           // fără protocoale
  assert.strictEqual(normRoute('/a"b<script>'), '/');                  // fără caractere de HTML
  assert.strictEqual(normRoute(['x', '/preturi']), '/preturi');        // query duplicat → prima valoare validă
});

test('injectMeta: înlocuiește title/description și adaugă canonical + OG', () => {
  const meta = {
    title: 'Evaluarea Națională la mate: teste și rezolvări',
    description: 'Teste de antrenament, subiecte rezolvate pas cu pas și exerciții interactive pentru Evaluarea Națională la matematică. Pregătire completă online.',
    og_image: null, jsonld: null,
  };
  const out = injectMeta(html, { route: '/evaluare-nationala', meta, site: SITE });

  assert.ok(out.includes('<title>Evaluarea Națională la mate: teste și rezolvări</title>'), 'title-ul nou lipsește');
  assert.ok(out.includes('content="Teste de antrenament, subiecte rezolvate'), 'description-ul nou lipsește');
  assert.ok(out.includes(`<link rel="canonical" href="${SITE}/evaluare-nationala" />`), 'canonical lipsește');
  assert.ok(out.includes(`<meta property="og:url" content="${SITE}/evaluare-nationala" />`), 'og:url lipsește');
  assert.ok(out.includes('og:title'), 'og:title lipsește');
  assert.ok(out.includes('twitter:card'), 'twitter:card lipsește');
  // vechiul title nu mai există
  assert.ok(!out.includes('<title>ExamenMate – Matematică pentru Succes</title>'), 'title-ul vechi a rămas');
  // canonical-ul static din index.html a fost eliminat (nu duplicat)
  assert.strictEqual((out.match(/rel="canonical"/g) || []).length, 1, 'canonical duplicat');
  assert.strictEqual((out.match(/property="og:title"/g) || []).length, 1, 'og:title duplicat');
  // scheletul SPA rămâne intact
  assert.ok(out.includes('<div id="root"></div>'), 'root-ul SPA a dispărut');
  assert.ok(out.includes('/src/main.jsx'), 'scriptul SPA a dispărut');
});

test('injectMeta: fără rând în seo_meta → păstrează title/description existente + adaugă OG', () => {
  const out = injectMeta(html, { route: '/preturi', meta: null, site: SITE });
  assert.ok(out.includes('<title>ExamenMate – Matematică pentru Succes</title>'), 'title-ul implicit trebuie păstrat');
  assert.ok(out.includes(`<link rel="canonical" href="${SITE}/preturi" />`), 'canonical pe ruta cerută lipsește');
  assert.ok(out.includes('og:image'), 'og:image implicit lipsește');
});

test('injectMeta: escapare corectă în atribute (fără spargerea HTML-ului)', () => {
  const meta = {
    title: 'Formule & "arii" <clasa a 7-a>',
    description: 'Descriere cu "ghilimele" & <taguri> care nu trebuie să spargă atributele HTML ale paginii, indiferent de conținutul scris de agent în baza de date.',
  };
  const out = injectMeta(html, { route: '/clase/7', meta, site: SITE });
  assert.ok(out.includes('<title>Formule &amp; &quot;arii&quot; &lt;clasa a 7-a&gt;</title>'), 'title-ul nu e escapat');
  assert.ok(out.includes('content="Descriere cu &quot;ghilimele&quot; &amp; &lt;taguri&gt;'), 'description-ul nu e escapat');
  assert.ok(!out.includes('cu "ghilimele"'), 'ghilimele neescapate ar sparge atributul');
  assert.ok(!out.includes('<clasa'), 'taguri neescapate din title');
});

test('injectMeta: JSON-LD injectat sigur (fără </script> în date)', () => {
  const meta = {
    title: 'Întrebări frecvente despre ExamenMate și abonamente',
    description: 'Răspunsuri la întrebările frecvente despre platforma ExamenMate: abonamente, materiale, exerciții interactive, Evaluarea Națională și Bacalaureat.',
    jsonld: { '@context': 'https://schema.org', '@type': 'FAQPage', name: 'x</script><script>alert(1)' },
  };
  const out = injectMeta(html, { route: '/faq', meta, site: SITE });
  assert.ok(out.includes('application/ld+json'), 'JSON-LD lipsește');
  assert.ok(out.includes('\\u003c/script'), 'secvența </script trebuia escapată');
  assert.ok(!out.includes('x</script><script>alert(1)'), 'injecție de script posibilă');
});

test('injectMeta: og_image personalizat → twitter:card summary_large_image', () => {
  const meta = {
    title: 'Rezolvări video și scrise pentru mate, clasele 5–12',
    description: 'Rezolvări pas cu pas la matematică: video, PDF și explicații scrise pentru clasele 5–12, Evaluarea Națională și Bacalaureat. Actualizate constant.',
    og_image: 'https://examenmate.com/img/share-rezolvari.png',
  };
  const out = injectMeta(html, { route: '/rezolvari', meta, site: SITE });
  assert.ok(out.includes('content="https://examenmate.com/img/share-rezolvari.png"'), 'og_image personalizat lipsește');
  assert.ok(out.includes('content="summary_large_image"'), 'twitter:card trebuia să fie summary_large_image');
});
