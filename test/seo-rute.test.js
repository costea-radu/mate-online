// =====================================================================
// test/seo-rute.test.js — 12 noiembrie 2026, „vizibilitatea în motoarele de căutare":
//   1) fiecare rută publică are title + description proprii și fără rând în seo_meta;
//   2) date structurate implicite (Organization + WebSite / BreadcrumbList);
//   3) scheletul paginii din <div id="root"> (H1, materialele, legături);
//   4) profil de BAC inexistent → canonic; clasă inexistentă → noindex;
//   5) sitemap, rewrites, robots, index.html și titlul filei din browser.
// Fără rețea: Supabase simulat.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const SITE = 'https://examenmate.com';
const S = require('../api/_lib/seoRute');
const { injectMeta } = require('../api/page-meta');

test('fiecare rută publică are title și description proprii, în limitele Google', () => {
  const publice = Object.entries(S.RUTE).filter(([, r]) => r.index !== false);
  assert.ok(publice.length >= 28, `doar ${publice.length} rute publice`);
  const titluri = new Set();
  for (const [ruta, r] of publice) {
    assert.ok(r.title.length >= 20 && r.title.length <= 65, `${ruta}: title de ${r.title.length} caractere`);
    assert.ok(r.description.length >= 50 && r.description.length <= 165, `${ruta}: description de ${r.description.length} caractere`);
    assert.ok(!titluri.has(r.title), `${ruta}: title repetat`);
    titluri.add(r.title);
    assert.ok(r.nume, `${ruta}: fără nume pentru firimituri`);
    for (const l of r.legaturi || []) assert.ok(S.RUTE[l], `${ruta}: legătură spre o rută necunoscută (${l})`);
    if (r.parinte) assert.ok(S.RUTE[r.parinte], `${ruta}: părinte necunoscut`);
  }
  // toate clasele și profilurile de BAC
  for (const n of S.CLASE) assert.ok(S.RUTE[`/clase/${n}`].h1, `/clase/${n}`);
  for (const p of S.PROFILURI_BAC) assert.strictEqual(S.RUTE[`/bacalaureat/${p}`].parinte, '/bacalaureat');
  assert.strictEqual(S.metaImplicit('/clase/8').title, 'Matematică clasa a VIII-a: exerciții, teste și fișe');
  assert.strictEqual(S.metaImplicit('/nu-exista'), null);
  assert.strictEqual(S.metaImplicit('constructor'), null, 'fără proprietățile obiectului');
  // fără numele modelelor AI și fără promisiuni cu cifre care se pot schimba (prețuri)
  const tot = JSON.stringify(S.RUTE);
  assert.ok(!/GPT|Claude|OpenAI|Anthropic/i.test(tot));
  assert.ok(!/\d+\s*(lei|RON)/i.test(tot));
});

test('rândul din seo_meta are întâietate, câmp cu câmp; restul vine din implicite', () => {
  const gol = S.cuImplicite('/preturi', null, SITE);
  assert.strictEqual(gol.title, 'Prețuri și abonament Premium – ExamenMate');
  assert.match(gol.description, /^Abonament Premium lunar sau anual/);
  assert.strictEqual(gol.og_image, `${SITE}/og-examenmate.png`);
  assert.strictEqual(gol.jsonld['@type'], 'BreadcrumbList');
  // agentul SEO a aprobat doar un titlu → descrierea rămâne cea implicită
  const partial = S.cuImplicite('/preturi', { title: 'Titlu aprobat', description: null, og_image: null, jsonld: null }, SITE);
  assert.strictEqual(partial.title, 'Titlu aprobat');
  assert.match(partial.description, /^Abonament Premium lunar sau anual/);
  const complet = S.cuImplicite('/preturi', { title: 'T', description: 'D', og_image: 'https://x/y.png', jsonld: { '@type': 'Product' } }, SITE);
  assert.deepStrictEqual([complet.title, complet.description, complet.og_image, complet.jsonld['@type']], ['T', 'D', 'https://x/y.png', 'Product']);
  // rută fără implicite → rămâne ce e în index.html (injectMeta)
  assert.deepStrictEqual([S.cuImplicite('/altceva', null, SITE).title, S.cuImplicite('/altceva', null, SITE).jsonld], [null, null]);

  // în HTML: titlul, descrierea, canonicul, imaginea mare și datele structurate
  const html = read('index.html');
  const out = injectMeta(html, { route: '/bacalaureat/mate-info', meta: S.cuImplicite('/bacalaureat/mate-info', null, SITE), site: SITE });
  assert.ok(out.includes('<title>BAC matematică mate-info: subiecte, bareme și rezolvări</title>'));
  assert.ok(out.includes(`<link rel="canonical" href="${SITE}/bacalaureat/mate-info" />`));
  assert.ok(out.includes(`<meta property="og:image" content="${SITE}/og-examenmate.png" />`));
  assert.ok(out.includes('<meta name="twitter:card" content="summary_large_image" />'));
  const ld = JSON.parse(out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepStrictEqual(ld.itemListElement.map((x) => [x.position, x.name, x.item]), [
    [1, 'Acasă', `${SITE}/`], [2, 'Bacalaureat', `${SITE}/bacalaureat`], [3, 'Bacalaureat Mate-Info', `${SITE}/bacalaureat/mate-info`],
  ]);
});

test('prima pagină: Organization + WebSite; celelalte: firimituri', () => {
  const acasa = S.jsonLdImplicit('/', SITE);
  const tipuri = acasa['@graph'].map((x) => x['@type']);
  assert.deepStrictEqual(tipuri, ['EducationalOrganization', 'WebSite']);
  assert.strictEqual(acasa['@graph'][0]['@id'], `${SITE}/#organization`, 'același @id ca pe /recenzii');
  assert.strictEqual(acasa['@graph'][1].publisher['@id'], `${SITE}/#organization`);
  assert.strictEqual(acasa['@graph'][1].inLanguage, 'ro');
  assert.match(read('api/page-meta.js'), /'@id': `\$\{site\}\/#organization`/);
  assert.deepStrictEqual(S.firimituri('/'), [{ nume: 'Acasă', path: '/' }]);
  assert.deepStrictEqual(S.firimituri('/clase/5').map((x) => x.nume), ['Acasă', 'Clasa a V-a']);
  assert.strictEqual(S.jsonLdImplicit('/nu-exista', SITE), null);
});

test('canonic și indexare: profil de BAC inexistent, clasă inexistentă, pagini de cont', () => {
  assert.deepStrictEqual(S.canonic('/bacalaureat/tehnologic'), { route: '/bacalaureat/tehnologic', index: true });
  // src/pages/Bacalaureat.jsx arată mate-info pentru orice profil necunoscut → un singur URL în index
  assert.deepStrictEqual(S.canonic('/bacalaureat/altceva'), { route: '/bacalaureat', index: true });
  assert.deepStrictEqual(S.canonic('/clase/8'), { route: '/clase/8', index: true });
  assert.deepStrictEqual(S.canonic('/clase/13'), { route: '/clase/13', index: false });
  assert.deepStrictEqual(S.canonic('/clase/abc'), { route: '/clase/abc', index: false });
  assert.strictEqual(S.canonic('/stergere-cont').index, false);
  assert.strictEqual(S.canonic('/preturi').index, true);
  assert.deepStrictEqual(S.categoriaRutei('/bacalaureat/stiinte-naturii'), { category: 'bacalaureat', profile: 'stiinte-naturii' });
  assert.deepStrictEqual(S.categoriaRutei('/clase/7'), { category: 'clasa-7', profile: null });
  assert.deepStrictEqual(S.categoriaRutei('/evaluare-nationala'), { category: 'evaluare-nationala', profile: null });
  assert.strictEqual(S.categoriaRutei('/bacalaureat'), null, 'pagina generală trimite spre profiluri');
  assert.strictEqual(S.categoriaRutei('/clase/13'), null);
  assert.strictEqual(S.categoriaRutei('/preturi'), null);
});

test('scheletul paginii: H1, fraza, materialele pe grupe, legături; totul escapat', () => {
  const materiale = [
    { title: 'Varianta 12 — iunie 2025', subcategory: 'variante', content_type: 'pdf' },
    { title: 'Simulare județeană Alba', subcategory: 'simulari', content_type: 'pdf' },
    { title: 'Test interactiv: ecuații', subcategory: 'teste-interactive', content_type: 'interactive' },
    { title: 'Test <b>nou</b> & "bun"', subcategory: 'ceva-necunoscut', content_type: 'interactive' },
    { title: 'Fișă fără rubrică', subcategory: null, content_type: 'pdf' },
    { title: 'Varianta 12 — iunie 2025', subcategory: 'variante', content_type: 'pdf' },   // dublură
    { title: '   ', subcategory: 'variante' },
  ];
  const g = S.grupeaza(materiale);
  assert.deepStrictEqual(g.map((x) => [x.titlu, x.titluri.length]), [
    ['Teste interactive', 2], ['Variante date și modele', 1], ['Simulări', 1], ['Materiale', 1],
  ]);
  const h = S.schelet('/evaluare-nationala', { materiale });
  assert.match(h, /<nav class="breadcrumb"><a href="\/">Acasă<\/a><span>›<\/span><span>Evaluare Națională<\/span><\/nav>/);
  assert.match(h, /<h1>Evaluarea Națională la matematică<\/h1>/);
  assert.strictEqual((h.match(/<h1>/g) || []).length, 1, 'un singur H1');
  assert.ok(h.includes('<li>Varianta 12 — iunie 2025</li>'));
  assert.ok(h.includes('<li>Test &lt;b&gt;nou&lt;/b&gt; &amp; &quot;bun&quot;</li>'), 'titlurile sunt escapate');
  assert.ok(!h.includes('<b>nou</b>'));
  assert.ok(h.includes('<a class="btn btn-outline btn-sm" href="/pregateste-ma">Pregătește-mă de examen</a>'));
  // limitele: cel mult 40 pe grupă, 160 în total
  const multe = Array.from({ length: 300 }, (_, i) => ({ title: `Varianta ${i + 1}`, subcategory: i % 2 ? 'variante' : 'simulari' }));
  const gm = S.grupeaza(multe);
  assert.deepStrictEqual(gm.map((x) => [x.titluri.length, x.total]), [[40, 150], [40, 150]]);
  // fără materiale: pagina are tot H1, fraza și legăturile
  const gol = S.schelet('/bacalaureat', {});
  assert.match(gol, /<h1>Bacalaureat la matematică<\/h1>/);
  assert.ok(gol.includes('href="/bacalaureat/mate-info"') && gol.includes('href="/bacalaureat/tehnologic"'));
  assert.ok(!gol.includes('schelet-lista'));

  // prima pagină: bara albastră a site-ului, examenele și clasele — fără butoane de
  // înscriere (scheletul îl vede o clipă și cine are cont)
  const acasa = S.schelet('/', {});
  assert.match(acasa, /<section class="hero hero-bara">[\s\S]*<h1>Matematică pentru Evaluarea Națională și BAC<\/h1>/);
  for (const n of S.CLASE) assert.ok(acasa.includes(`href="/clase/${n}"`), `clasa ${n}`);
  assert.ok(acasa.includes('href="/evaluare-nationala"') && acasa.includes('href="/bacalaureat"'));
  assert.ok(!/inregistrare|Începe gratuit/.test(acasa));

  // /rezolvari: legături spre fiecare articol publicat
  const rez = S.schelet('/rezolvari', { articole: [{ slug: 'teorema-lui-pitagora', title: 'Teorema lui Pitagora' }, { slug: '', title: 'x' }] });
  assert.ok(rez.includes('<li><a href="/rezolvari/teorema-lui-pitagora">Teorema lui Pitagora</a></li>'));
  assert.strictEqual((rez.match(/<li>/g) || []).length, 1);
  // fără schelet: rute necunoscute, pagini de cont, /recenzii (are scheletul ei, cu recenziile)
  for (const r of ['/nu-exista', '/profil', '/stergere-cont', '/recenzii']) assert.strictEqual(S.schelet(r, {}), '', r);
});

// ── handlerul, cu Supabase simulat ──
test('handlerul: implicite + schelet cu materialele din bază; noindex și canonic unde trebuie', async (t) => {
  const interogari = [];
  const TABELE = {
    seo_meta: [{ route: '/faq', title: 'Întrebări frecvente (aprobat în Admin)', description: null, og_image: null, jsonld: null }],
    content: [
      { title: 'Varianta 3 — M_mate-info', subcategory: 'variante', content_type: 'pdf', category: 'bacalaureat', profile: 'mate-info' },
      { title: 'Varianta 9 — tehnologic', subcategory: 'variante', content_type: 'pdf', category: 'bacalaureat', profile: 'tehnologic' },
      { title: 'Fracții ordinare', subcategory: 'cap-1', content_type: 'interactive', category: 'clasa-5', profile: null },
    ],
    articole: [{ slug: 'ecuatii-de-gradul-doi', title: 'Ecuații de gradul al doilea', status: 'published' }, { slug: 'ciorna', title: 'Ciornă', status: 'draft' }],
  };
  const supa = {
    from(tabel) {
      const f = [];
      const q = {
        select: () => q, order: () => q,
        eq: (c, v) => { f.push([c, v]); return q; },
        limit: () => { interogari.push([tabel, ...f.map((x) => x.join('='))].join(' ')); return Promise.resolve({ data: TABELE[tabel].filter((r) => f.every(([c, v]) => r[c] === v)), error: null }); },
        maybeSingle: () => Promise.resolve({ data: TABELE[tabel].find((r) => f.every(([c, v]) => r[c] === v)) || null, error: null }),
      };
      return q;
    },
  };
  const http = require('../api/_lib/http');
  const adminVechi = http.admin;
  http.admin = () => supa;
  const fetchVechi = global.fetch;
  global.fetch = async () => ({ ok: true, status: 200, text: async () => read('index.html') });
  t.after(() => { http.admin = adminVechi; global.fetch = fetchVechi; });
  const handler = require('../api/page-meta');
  const cere = (route) => new Promise((resolve) => {
    const res = { headers: {}, code: 200, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, send(b) { resolve({ status: this.code, html: String(b) }); return this; } };
    handler({ method: 'GET', query: { route }, headers: {} }, res);
  });

  const bac = await cere('/bacalaureat/mate-info');
  assert.strictEqual(bac.status, 200);
  assert.ok(bac.html.includes('<title>BAC matematică mate-info: subiecte, bareme și rezolvări</title>'));
  assert.ok(bac.html.includes('<li>Varianta 3 — M_mate-info</li>'));
  assert.ok(!bac.html.includes('Varianta 9 — tehnologic'), 'doar materialele profilului');
  assert.ok(interogari.includes('content category=bacalaureat profile=mate-info'));
  assert.match(bac.html, /<div id="root">\s*<div class="page-header">/);
  assert.ok(bac.html.includes('/src/main.jsx'), 'aplicația pornește în continuare');
  assert.ok(!/name="robots"/.test(bac.html));

  const cls = await cere('/clase/5');
  assert.ok(cls.html.includes('<h1>Matematică pentru clasa a V-a</h1>') && cls.html.includes('<li>Fracții ordinare</li>'));
  // rândul aprobat în Admin câștigă la titlu; descrierea rămâne cea implicită
  const faq = await cere('/faq');
  assert.ok(faq.html.includes('<title>Întrebări frecvente (aprobat în Admin)</title>'));
  assert.ok(faq.html.includes('content="Răspunsuri despre conturi, abonament, teste interactive'));
  // /rezolvari: doar articolele publicate
  const rez = await cere('/rezolvari');
  assert.ok(rez.html.includes('<a href="/rezolvari/ecuatii-de-gradul-doi">Ecuații de gradul al doilea</a>'));
  assert.ok(!rez.html.includes('Ciornă'));
  // prima pagină
  const acasa = await cere('/');
  assert.ok(acasa.html.includes('<title>ExamenMate – Matematică pentru Evaluarea Națională și BAC</title>'));
  assert.ok(acasa.html.includes('"@type":"EducationalOrganization"'));
  assert.match(acasa.html, /<div id="root">\s*<section class="hero hero-bara">/);
  // profil inexistent → canonic pe /bacalaureat; clasă inexistentă → noindex
  const alt = await cere('/bacalaureat/altceva');
  assert.ok(alt.html.includes(`<link rel="canonical" href="${SITE}/bacalaureat" />`));
  assert.ok(alt.html.includes('<div id="root"></div>'), 'fără schelet pentru o rută necunoscută');
  const c13 = await cere('/clase/13');
  assert.match(c13.html, /<meta name="robots" content="noindex/);
  // materialele se țin minte 10 minute (a doua cerere nu mai întreabă baza)
  const inainte = interogari.length;
  await cere('/bacalaureat/mate-info');
  assert.strictEqual(interogari.filter((x) => x.startsWith('content')).length, interogari.slice(0, inainte).filter((x) => x.startsWith('content')).length);
});

test('sitemap, rewrites, robots și index.html', () => {
  const sm = read('api/sitemap.js');
  for (const r of ['/bacalaureat/mate-info', '/bacalaureat/stiinte-naturii', '/bacalaureat/tehnologic', '/pregateste-ma']) {
    assert.ok(sm.includes(`['${r}',`), `${r} lipsește din sitemap`);
    assert.ok(S.RUTE[r] && S.RUTE[r].index !== false);
  }
  // tot ce e în sitemap are title + description proprii
  for (const m of sm.matchAll(/^\s*\['(\/[^']*)', '/gm)) assert.ok(S.metaImplicit(m[1]), `${m[1]}: în sitemap, dar fără implicite`);
  const v = JSON.parse(read('vercel.json'));
  const pagini = v.rewrites.find((r) => r.source.startsWith('/:page('));
  assert.ok(pagini.source.includes('|pregateste-ma|'), '/pregateste-ma trece prin page-meta');
  for (const p of pagini.source.slice(7, -1).split('|')) assert.ok(S.RUTE[`/${p}`], `/${p}: trece prin page-meta, dar nu are implicite`);
  const robots = read('public/robots.txt');
  for (const d of ['/mesagerie', '/tema-elev', '/tema-grupa', '/meditatii/sala', '/meditatii/plan', '/pdf-viewer']) assert.ok(robots.includes(`Disallow: ${d}\n`), d);
  assert.ok(!/Disallow: \/(meditatii|tema|pregateste-ma|clase|bacalaureat)\n/.test(robots), 'paginile publice rămân permise');
  const html = read('index.html');
  assert.ok(html.includes(`<title>${S.RUTE['/'].title}</title>`));
  assert.ok(html.includes(`<meta name="description" content="${S.RUTE['/'].description}" />`));
  assert.ok(html.includes('content="https://examenmate.com/og-examenmate.png"'));
  assert.ok(html.includes('<meta name="twitter:card" content="summary_large_image" />'));
  // imaginea de share: 1200×630, în public/, în afara precache-ului PWA
  const png = fs.readFileSync(path.join(ROOT, 'public', 'og-examenmate.png'));
  assert.deepStrictEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
  assert.ok(png.length < 300 * 1024);
  assert.match(read('vite.config.js'), /globIgnores: \[[^\]]*'og-\*\.png'[^\]]*\]/);
  // stilurile scheletului
  assert.match(read('src/styles/global.css'), /\.schelet-lista \{/);
});

test('titlul filei din browser se schimbă odată cu pagina', async () => {
  const T = await import('../src/lib/titluPagina.js');
  assert.strictEqual(T.TITLU_IMPLICIT, 'ExamenMate – Matematică pentru Evaluarea Națională și BAC');
  assert.strictEqual(T.titluPentru('/preturi'), 'Prețuri și abonament Premium – ExamenMate');
  assert.strictEqual(T.titluPentru('/clase/9/'), 'Matematică clasa a IX-a: exerciții, teste și fișe');
  assert.strictEqual(T.titluPentru('/profil'), 'Contul meu – ExamenMate');
  assert.strictEqual(T.titluPentru('/meditatii/sala/abc'), 'Meditație live – ExamenMate');
  assert.strictEqual(T.titluPentru('/ceva-nou'), T.TITLU_IMPLICIT);
  assert.strictEqual(T.titluPentru('/rezolvari/teorema-lui-pitagora'), null, 'articolul își pune singur titlul');
  assert.strictEqual(T.titluPentru('/rezolvari'), 'Rezolvări și teorie la matematică, explicate pas cu pas');
  // la prima încărcare titlul paginilor publice vine de la server (poate fi cel aprobat în Admin)
  assert.strictEqual(T.titluPentru('/preturi', { primaIncarcare: true }), null);
  assert.strictEqual(T.titluPentru('/', { primaIncarcare: true }), null);
  assert.strictEqual(T.titluPentru('/profil', { primaIncarcare: true }), 'Contul meu – ExamenMate');
  const app = read('src/App.jsx');
  assert.match(app, /const titlu = titluPentru\(location\.pathname, \{ primaIncarcare: prima\.current \}\);\s*\n\s*prima\.current = false;\s*\n\s*if \(titlu\) document\.title = titlu;\s*\n\s*trackPageView\(/);
  assert.match(read('src/pages/ArticolPage.jsx'), /return \(\) => \{ document\.title = TITLU_IMPLICIT; \};/);
});
