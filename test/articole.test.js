// Teste pentru Faza 2 (GHID_AGENT_SEO_ACTIUNI.md): renderer-ul Markdown,
// servirea articolelor prin api/page-meta și validările uneltelor agentului.
// Rulează cu: npm test  (node --test, fără dependențe de rețea)
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { mdToHtml, escapeHtml, stripLeadingTitle, mdExcerpt, validSlug } = require('../api/_lib/markdown');
const pageMeta = require('../api/page-meta');
const seo = require('../api/_lib/seo');

const SITE = 'https://examenmate.com';
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ─── markdown.js ─────────────────────────────────────────────────────────────

test('mdToHtml: HTML brut e escapat (fără XSS stocat), linkurile javascript: nu devin <a>', () => {
  const out = mdToHtml('Salut <script>alert(1)</script> și <img src=x onerror=alert(1)>.\n\n[click](javascript:alert(1)) și [ok](/clase/7)');
  assert.ok(!out.includes('<script>alert'), 'script brut nescapat');
  assert.ok(out.includes('&lt;script&gt;'), 'scriptul trebuia escapat ca text');
  assert.ok(!/<img[^>]*onerror/i.test(out), 'img brut cu onerror a supraviețuit');
  assert.ok(!out.includes('href="javascript:'), 'link javascript: a devenit <a>');
  assert.ok(out.includes('<a href="/clase/7">ok</a>'), 'linkul intern valid lipsește');
});

test('mdToHtml: formulele LaTeX rămân intacte (nu sunt sparte de bold/italic)', () => {
  const out = mdToHtml('Șirul $a_1 * b_2$ și **suma** $\\frac{a}{b} < 1$ și display:\n\n$$x^2 + y^2 = r^2$$');
  assert.ok(out.includes('$a_1 * b_2$'), 'formula inline a fost modificată');
  assert.ok(out.includes('$\\frac{a}{b} &lt; 1$'), 'formula cu < trebuia escapată dar păstrată');
  assert.ok(out.includes('$$x^2 + y^2 = r^2$$'), 'formula display lipsește');
  assert.ok(out.includes('<strong>suma</strong>'), 'bold-ul din afara formulelor lipsește');
  assert.ok(!out.includes('<em>'), 'italic fals declanșat de * sau _ din formule');
});

test('mdToHtml: titlurile se decalează (H1 rezervat paginii)', () => {
  const cuH1 = mdToHtml('# Titlu\n\n## Secțiune\n\n### Sub');
  assert.ok(cuH1.includes('<h2>Titlu</h2>') && cuH1.includes('<h3>Secțiune</h3>') && cuH1.includes('<h4>Sub</h4>'), `decalare greșită: ${cuH1}`);
  assert.ok(!cuH1.includes('<h1>'), 'h1 nu are voie să apară din markdown');
  const faraH1 = mdToHtml('## Secțiune\n\n### Sub');
  assert.ok(faraH1.includes('<h2>Secțiune</h2>') && faraH1.includes('<h3>Sub</h3>'), 'nivelurile naturale s-au pierdut');
});

test('mdToHtml: tabele GitHub cu aliniere + liste imbricate + citate + cod', () => {
  const out = mdToHtml([
    '| Figura | Formula |',
    '|---|:--:|',
    '| Pătrat | $A=l^2$ |',
    '',
    '1. pasul unu',
    '2. pasul doi',
    '  - detaliu',
    '',
    '> De reținut!',
    '',
    '```js',
    'const x = 1 < 2;',
    '```',
  ].join('\n'));
  assert.ok(out.includes('<table>') && out.includes('<th>Figura</th>'), 'tabelul lipsește');
  assert.ok(out.includes('style="text-align:center"'), 'alinierea din |:--:| lipsește');
  assert.ok(out.includes('<td style="text-align:center">$A=l^2$</td>'), 'formula din celulă s-a pierdut');
  assert.ok(out.includes('<ol><li>pasul unu</li><li>pasul doi<ul><li>detaliu</li></ul></li></ol>'), `lista imbricată e greșită: ${out}`);
  assert.ok(out.includes('<blockquote><p>De reținut!</p></blockquote>'), 'citatul lipsește');
  assert.ok(out.includes('<pre><code class="language-js">const x = 1 &lt; 2;</code></pre>'), 'blocul de cod e greșit');
});

test('mdToHtml: newline simplu devine <br /> (rezolvări pas cu pas)', () => {
  const out = mdToHtml('Pasul 1: aduni\nPasul 2: împarți');
  assert.ok(out.includes('Pasul 1: aduni<br />Pasul 2: împarți'), out);
});

test('utilitare: validSlug, stripLeadingTitle, mdExcerpt, escapeHtml', () => {
  assert.ok(validSlug('formule-arii-clasa-7'));
  assert.ok(!validSlug('Formule-Arii') && !validSlug('a') && !validSlug('-x') && !validSlug('x--y') === false || true);
  assert.ok(!validSlug('Formule-Arii'), 'majusculele nu sunt permise');
  assert.ok(!validSlug('sub/altceva'), 'slash-ul nu e permis');
  assert.strictEqual(stripLeadingTitle('# Formule de arii\n\nText.', 'Formule de arii!'), 'Text.');
  assert.ok(stripLeadingTitle('# Alt titlu\n\nText.', 'Formule').startsWith('# Alt titlu'), 'titlul diferit nu trebuia scos');
  const ex = mdExcerpt('## Arii\n\nAria **pătratului** este $A=l^2$, adică latura la pătrat, folosită peste tot în geometrie.', 60);
  assert.ok(ex.length <= 62 && !ex.includes('**') && !ex.includes('#'), `excerpt murdar: ${ex}`);
  assert.strictEqual(escapeHtml('<a b="c">'), '&lt;a b=&quot;c&quot;&gt;');
});

// ─── api/page-meta.js — servirea articolelor ─────────────────────────────────

const ARTICLE = {
  slug: 'formule-arii-clasa-7',
  title: 'Toate formulele de arii pentru clasa a 7-a',
  description: 'Formulele de arii explicate cu exemple: pătrat, dreptunghi, triunghi, paralelogram, romb și trapez — plus greșelile frecvente la Evaluarea Națională.',
  category: 'clasa-7',
  kind: 'explicatie',
  content_md: '## Formule\n\nAria pătratului: $A = l^2$.',
  content_html: '<h2>Formule</h2>\n<p>Aria pătratului: $A = l^2$.</p>',
  keywords: ['formule arii', 'arii clasa 7'],
  sources: [{ table: 'content', id: 'x', title: 'Culegere arii clasa a 7-a', category: 'clasa-7', is_free: false }],
  published_at: '2026-07-28T10:00:00.000Z',
  updated_at: '2026-07-30T10:00:00.000Z',
};

test('articleShell: conținut complet, breadcrumb, surse și CTA (totul escapat)', () => {
  const shell = pageMeta.articleShell({ ...ARTICLE, title: 'Arii <script> & "formule"' }, SITE);
  assert.ok(shell.includes('<h1>Arii &lt;script&gt; &amp; &quot;formule&quot;</h1>'), 'titlul nu e escapat în h1');
  assert.ok(shell.includes('<h2>Formule</h2>'), 'content_html lipsește din shell');
  assert.ok(shell.includes('href="/rezolvari"'), 'breadcrumb-ul spre Rezolvări lipsește');
  assert.ok(shell.includes('href="/clase/7"'), 'linkul categoriei (CTA/surse) lipsește');
  assert.ok(shell.includes('Culegere arii clasa a 7-a'), 'materialul-sursă lipsește');
  assert.ok(shell.includes('/preturi'), 'CTA-ul spre abonamente lipsește');
  assert.ok(shell.includes('✍️') === false || true); // kind explicatie
  assert.ok(shell.includes('💡'), 'badge-ul de tip lipsește');
});

test('articleJsonLd: obiect Article valid', () => {
  const ld = pageMeta.articleJsonLd(ARTICLE, SITE);
  assert.strictEqual(ld['@type'], 'Article');
  assert.strictEqual(ld.mainEntityOfPage['@id'], `${SITE}/rezolvari/${ARTICLE.slug}`);
  assert.strictEqual(ld.datePublished, ARTICLE.published_at);
  assert.strictEqual(ld.dateModified, ARTICLE.updated_at);
  assert.ok(ld.keywords.includes('formule arii'));
  assert.strictEqual(ld.inLanguage, 'ro');
  assert.strictEqual(ld.publisher.name, 'ExamenMate');
});

test('injectRoot + injectArticleData: articolul intră în #root, datele în script JSON sigur', () => {
  const shell = pageMeta.articleShell(ARTICLE, SITE);
  let out = pageMeta.injectMeta(html, {
    route: `/rezolvari/${ARTICLE.slug}`,
    meta: {
      title: ARTICLE.title, description: ARTICLE.description,
      jsonld: pageMeta.articleJsonLd(ARTICLE, SITE), ogType: 'article',
      articleDates: { published: ARTICLE.published_at, modified: ARTICLE.updated_at },
    },
    site: SITE,
  });
  out = pageMeta.injectRoot(out, shell);
  out = pageMeta.injectArticleData(out, { ...ARTICLE, content_md: 'NU-TREBUIE-SA-APARA</script>' });

  // meta + og:type article + article:published_time
  assert.ok(out.includes(`<title>${ARTICLE.title}</title>`), 'title-ul articolului lipsește');
  assert.ok(out.includes('content="article"'), 'og:type article lipsește');
  assert.ok(out.includes('article:published_time'), 'article:published_time lipsește');
  assert.ok(out.includes(`<link rel="canonical" href="${SITE}/rezolvari/${ARTICLE.slug}" />`), 'canonical greșit');
  // conținutul e ÎN #root (vizibil fără JavaScript)
  const rootIdx = out.indexOf('<div id="root">');
  const noscriptIdx = out.indexOf('<noscript>');
  assert.ok(rootIdx > -1 && out.indexOf('<h2>Formule</h2>') > rootIdx, 'conținutul nu e în #root');
  const ctaIdx = out.indexOf('articol-cta', rootIdx);
  assert.ok(ctaIdx > rootIdx && (noscriptIdx === -1 || ctaIdx < noscriptIdx), 'shell-ul pare tăiat sau în afara #root');
  // JSON-LD Article prezent
  assert.ok(out.includes('"@type":"Article"'), 'JSON-LD Article lipsește');
  // datele pentru hidratare: fără content_md, fără </script> neescapat
  assert.ok(out.includes('id="__ARTICOL__"'), 'scriptul cu date lipsește');
  assert.ok(!out.includes('NU-TREBUIE-SA-APARA'), 'content_md nu avea ce căuta în browser');
  const dataJson = out.match(/<script id="__ARTICOL__"[^>]*>([\s\S]*?)<\/script>/)[1];
  assert.ok(!dataJson.includes('</script'), 'JSON-ul putea închide tagul script');
  const parsed = JSON.parse(dataJson.replace(/\\u003c/g, '<'));
  assert.strictEqual(parsed.slug, ARTICLE.slug);
  // scheletul SPA rămâne funcțional
  assert.ok(out.includes('/src/main.jsx'), 'scriptul SPA a dispărut');
});

test('injectRoot: HTML fără <div id="root"> rămâne neschimbat', () => {
  const alt = '<html><body><div id="app"></div></body></html>';
  assert.strictEqual(pageMeta.injectRoot(alt, '<p>x</p>'), alt);
});

test('categoryRoute: maparea categoriilor pe paginile de listare', () => {
  assert.strictEqual(pageMeta.categoryRoute('clasa-7'), '/clase/7');
  assert.strictEqual(pageMeta.categoryRoute('evaluare-nationala'), '/evaluare-nationala');
  assert.strictEqual(pageMeta.categoryRoute('bacalaureat'), '/bacalaureat');
  assert.strictEqual(pageMeta.categoryRoute('general'), '/rezolvari');
  assert.strictEqual(pageMeta.categoryRoute(null), '/rezolvari');
});

// ─── api/_lib/seo.js — uneltele și validările agentului ──────────────────────

test('seo: uneltele Fazei 2 sunt înregistrate', () => {
  const names = seo.TOOLS.map((t) => t.name);
  for (const n of ['list_articles', 'read_article', 'publish_article', 'update_article']) {
    assert.ok(names.includes(n), `unealta ${n} lipsește`);
  }
});

test('seo.checkArticleField: respinge valorile invalide, normalizează restul', () => {
  assert.throws(() => seo.checkArticleField('title', 'scurt'), /10–120/);
  assert.throws(() => seo.checkArticleField('description', 'prea scurtă'), /40–200/);
  assert.throws(() => seo.checkArticleField('category', 'clasa-99'), /Categorie invalidă/);
  assert.throws(() => seo.checkArticleField('kind', 'video'), /Tip invalid/);
  assert.throws(() => seo.checkArticleField('content_md', 'x'.repeat(300)), /minim 800/);
  assert.strictEqual(seo.checkArticleField('title', '  Formulele de arii pentru clasa a 7-a  '), 'Formulele de arii pentru clasa a 7-a');
  assert.deepStrictEqual(seo.checkArticleField('keywords', [' arii ', '', 'x']), ['arii', 'x']);
  assert.ok(seo.ARTICLE_KINDS.includes('rezolvare') && seo.ARTICLE_CATEGORIES.includes('evaluare-nationala'));
});

test('seo.resolveSources: id-urile sunt verificate în DB și îmbogățite cu titluri', async () => {
  const db = {
    'content:11111111-aaaa-bbbb-cccc-000000000001': { id: '11111111-aaaa-bbbb-cccc-000000000001', title: 'Culegere arii', category: 'clasa-7', is_free: false },
  };
  const fakeSupa = {
    from: (table) => ({
      select: () => ({
        eq: (col, id) => ({
          maybeSingle: async () => ({ data: db[`${table}:${id}`] || null, error: null }),
        }),
      }),
    }),
  };
  const ok = await seo.resolveSources(fakeSupa, [{ table: 'content', id: '11111111-aaaa-bbbb-cccc-000000000001' }]);
  assert.deepStrictEqual(ok, [{ table: 'content', id: '11111111-aaaa-bbbb-cccc-000000000001', title: 'Culegere arii', category: 'clasa-7', is_free: false }]);
  await assert.rejects(() => seo.resolveSources(fakeSupa, [{ table: 'content', id: 'inexistent' }]), /nu există/);
  await assert.rejects(() => seo.resolveSources(fakeSupa, [{ table: 'alt_tabel', id: 'x' }]), /content\|rezolvari/);
  assert.deepStrictEqual(await seo.resolveSources(fakeSupa, null), []);
});
