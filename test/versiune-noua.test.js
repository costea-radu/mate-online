// =====================================================================
// test/versiune-noua.test.js — cererea din 8 noiembrie 2026 (4):
//   „nu apare nota cu rosu: nici pe test nici in lista ca la interactive. nu apare
//    recenzia. fa sa apara acestea chiar daca s-au rezolvat doar 2 exercitii sau 3"
//
// Cauza principală: site-ul era publicat (Vercel), dar telefonul rula VERSIUNEA VECHE.
// Service worker-ul dădea la fiecare deschidere index.html din precache — cel de dinaintea
// deploy-ului; versiunea nouă apărea abia la a doua deschidere. Acum:
//   · paginile vin din rețea (vite.config.js → ruta „pagini": NetworkFirst, fără HTML
//     păstrat separat; fără rețea / după 4 s / la o pană a serverului → index.html din
//     precache, aceeași versiune cu fișierele lui);
//   · /version.json = momentul build-ului; un tab deschis de dinainte de deploy află că e
//     vechi (src/lib/versiune.js) și ia versiunea nouă: acum, dacă abia s-a deschis, altfel
//     la următoarea schimbare de pagină (nu la jumătatea unui test).
// Și: nota cu roșu e scrisă pe PRIMA pagină — cine corecta de pe pagina 2 sau 3 n-o vedea.
// Acum nota apare și în bara de rezolvare (clic → pagina se derulează la ea), iar după
// prima corectare din vizită pagina se derulează singură la notă.
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let vP = null, libP = null;
const V = () => (vP || (vP = import('../src/lib/versiune.js')));
const lib = () => (libP || (libP = import('../src/lib/pdfRezolvare.js')));

// window de test: sessionStorage + location.reload numărat (pentru chunkReload.js)
function cuWindow(fn) {
  const store = {};
  const w = { reloads: 0, sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } } };
  w.location = { reload: () => { w.reloads++; } };
  const had = 'window' in global, prev = global.window;
  global.window = w;
  return Promise.resolve().then(() => fn(w)).finally(() => { if (had) global.window = prev; else delete global.window; });
}
const raspuns = (body, ok = true) => ({ ok, json: async () => body });

// ── 1) versiunea: compararea cu /version.json ──────────────────────────────────
test('versiuneNoua: /version.json fără cache; altă versiune → true; aceeași, eroare, fișier lipsă → false', async () => {
  const v = await V();
  const cereri = [];
  const fetchFn = (body, ok) => async (url, opt) => { cereri.push({ url, opt }); return raspuns(body, ok); };
  assert.strictEqual(await v.versiuneNoua({ versiune: '2026-11-08T10:00:00.000Z', fetchFn: fetchFn({ v: '2026-11-08T21:00:00.000Z' }) }), true);
  assert.match(cereri[0].url, /^\/version\.json\?t=\d+$/);
  assert.strictEqual(cereri[0].opt.cache, 'no-store', 'fără cache-ul browserului');
  assert.strictEqual(await v.versiuneNoua({ versiune: 'A', fetchFn: fetchFn({ v: 'A' }) }), false, 'aceeași versiune');
  assert.strictEqual(await v.versiuneNoua({ versiune: 'A', fetchFn: fetchFn({ v: 'B' }, false) }), false, '404 / 500');
  assert.strictEqual(await v.versiuneNoua({ versiune: 'A', fetchFn: fetchFn({}) }), false, 'fișier fără versiune');
  assert.strictEqual(await v.versiuneNoua({ versiune: 'A', fetchFn: async () => { throw new TypeError('Failed to fetch'); } }), false, 'fără rețea');
  assert.strictEqual(await v.versiuneNoua({ versiune: null, fetchFn: fetchFn({ v: 'B' }) }), false, 'fără versiune proprie (dev)');
});

test('actualizeaza: pagina abia deschisă → se reîncarcă acum (o dată); altfel → la următoarea schimbare de pagină', async () => {
  const v = await V();
  await cuWindow(async (w) => {
    assert.strictEqual(v.actualizeaza({ acum: 3000 }), 'acum');
    assert.strictEqual(w.reloads, 1);
    assert.strictEqual(v.asteaptaActualizare(), false);
  });
  await cuWindow(async (w) => {
    assert.strictEqual(v.laSchimbareaPaginii(), false, 'fără versiune nouă: navigarea rămâne internă');
    assert.strictEqual(v.actualizeaza({ acum: 5 * 60000 }), 'la-urmatoarea-pagina', 'elevul poate fi la jumătatea unui test');
    assert.strictEqual(w.reloads, 0, 'nu se reîncarcă sub mâna elevului');
    assert.strictEqual(v.asteaptaActualizare(), true);
    assert.strictEqual(v.laSchimbareaPaginii(), true, 'următoarea pagină se încarcă din nou');
    assert.strictEqual(w.reloads, 1);
    assert.strictEqual(v.laSchimbareaPaginii(), false, 'o singură dată');
    assert.strictEqual(w.reloads, 1);
  });
  // abia deschisă, dar tocmai s-a reîncărcat (anti-buclă, chunkReload.js) → la următoarea pagină
  await cuWindow(async (w) => {
    w.sessionStorage.setItem('mate_chunk_reload', String(Date.now()));
    assert.strictEqual(v.actualizeaza({ acum: 2000 }), 'la-urmatoarea-pagina');
    assert.strictEqual(w.reloads, 0);
    v.laSchimbareaPaginii();   // curăță starea pentru testele următoare
  });
});

test('verificaVersiunea: versiune nouă → actualizare; aceeași → nimic', async () => {
  const v = await V();
  await cuWindow(async (w) => {
    assert.strictEqual(await v.verificaVersiunea({ versiune: 'A', fetchFn: async () => raspuns({ v: 'A' }), acum: 1000 }), null);
    assert.strictEqual(w.reloads, 0);
    assert.strictEqual(await v.verificaVersiunea({ versiune: 'A', fetchFn: async () => raspuns({ v: 'B' }), acum: 1000 }), 'acum');
    assert.strictEqual(w.reloads, 1);
  });
});

// ── 2) service worker-ul: paginile din rețea ───────────────────────────────────
const VITE = read('vite.config.js');
// funcțiile din configurație ajung ca text în sw.js → le evaluăm la fel, separat
function functia(re) {
  const m = VITE.match(re);
  assert.ok(m, `nu găsesc ${re}`);
  // eslint-disable-next-line no-new-func
  return new Function(`return (${m[1]});`)();
}

test('vite.config.js: navigările nu mai vin din precache (navigateFallback / directoryIndex: null)', () => {
  assert.match(VITE, /navigateFallback:\s*null/);
  assert.match(VITE, /directoryIndex:\s*null/, 'altfel „/" (pagina principală) venea tot din precache');
  assert.doesNotMatch(VITE, /navigateFallback:\s*'\/index\.html'/);
  assert.doesNotMatch(VITE, /navigateFallbackDenylist/, 'excepțiile sunt acum în ruta „pagini"');
  // restul configurației rămâne (test/erori-client.test.js verifică și el)
  assert.match(VITE, /skipWaiting:\s*true/);
  assert.match(VITE, /clientsClaim:\s*true/);
  assert.match(VITE, /globPatterns:\s*\['\*\*\/\*\.\{js,css,html,svg,png,woff2\}'\]/, 'index.html rămâne în precache (pentru fără rețea)');
});

test('ruta „pagini": orice navigare a aplicației, dar nu /api/, verificarea Google, sitemap-ul, /.well-known/', () => {
  const f = functia(/urlPattern:\s*(\(\{ request, url \}\) => request\.mode === 'navigate'[\s\S]*?\.test\(url\.pathname\))/);
  const nav = (p, mode = 'navigate') => f({ request: { mode }, url: new URL(`https://examenmate.com${p}`) });
  for (const p of ['/', '/evaluare-nationala', '/pdf-viewer?id=en-1', '/bacalaureat/m1', '/rezolvari/ecuatii', '/admin']) assert.strictEqual(nav(p), true, p);
  for (const p of ['/api/rezolva-pdf', '/google88f99a4244b17e5a.html', '/sitemap.xml', '/.well-known/assetlinks.json']) assert.strictEqual(nav(p), false, p);
  assert.strictEqual(nav('/evaluare-nationala', 'cors'), false, 'doar navigările (nu fetch-urile)');
  // aceeași funcție nu are voie să depindă de variabile din vite.config.js (ajunge ca text în sw.js)
  const m = VITE.match(/urlPattern:\s*(\(\{ request, url \}\) => request\.mode === 'navigate'[\s\S]*?\.test\(url\.pathname\))/);
  assert.doesNotMatch(m[1], /\bBUILD_TIME\b|\bNU_|\bconst\b/);
});

test('ruta „pagini": rețeaua întâi (4 s); HTML-ul nu se păstrează; fără rețea / pană → index.html din precache', async () => {
  const bloc = VITE.slice(VITE.indexOf("cacheName: 'pagini'") - 400, VITE.indexOf("cacheName: 'pagini'") + 1200);
  assert.match(bloc, /handler:\s*'NetworkFirst'/);
  assert.match(bloc, /networkTimeoutSeconds:\s*4/);
  assert.match(bloc, /precacheFallback:\s*\{\s*fallbackURL:\s*'\/index\.html'\s*\}/);
  const nuPastra = functia(/cacheWillUpdate:\s*(async \(\) => null)/);
  assert.strictEqual(await nuPastra({ response: { status: 200 } }), null, 'un HTML vechi păstrat ar cere fișiere șterse după deploy');
  const SHELL = { status: 200, shell: true };
  const cereri = [];
  global.caches = { match: async (url, opt) => { cereri.push({ url, opt }); return SHELL; } };
  try {
    const dinCache = functia(/cachedResponseWillBeUsed:\s*(async \(\{ cachedResponse \}\) => cachedResponse[\s\S]*?\|\| null)/);
    assert.strictEqual(await dinCache({ cachedResponse: undefined }), SHELL, 'fără rețea / după 4 s → aplicația din precache');
    assert.deepStrictEqual(cereri[0], { url: '/index.html', opt: { ignoreSearch: true } }, 'cheia din precache are ?__WB_REVISION__=…');
    const panaServer = functia(/fetchDidSucceed:\s*(async \(\{ response \}\) => \(response\.status >= 500[\s\S]*?\|\| response)/);
    const ok = { status: 200 }, nu404 = { status: 404 };
    assert.strictEqual(await panaServer({ response: ok }), ok, 'pagina din rețea, ca atare');
    assert.strictEqual(await panaServer({ response: nu404 }), nu404, '404 (ex. articol inexistent) rămâne 404');
    assert.strictEqual(await panaServer({ response: { status: 503 } }), SHELL, 'pană a serverului paginii → tot aplicația');
    global.caches = { match: async () => undefined };
    const p503 = { status: 503 };
    assert.strictEqual(await panaServer({ response: p503 }), p503, 'fără precache: răspunsul serverului');
  } finally { delete global.caches; }
});

test('/version.json: scris la build, cu aceeași valoare ca __BUILD_TIME__ din cod', () => {
  assert.match(VITE, /const BUILD_TIME = new Date\(\)\.toISOString\(\);/);
  assert.match(VITE, /define:\s*\{\s*__BUILD_TIME__:\s*JSON\.stringify\(BUILD_TIME\)\s*\}/);
  assert.match(VITE, /emitFile\(\{\s*type:\s*'asset',\s*fileName:\s*'version\.json',\s*source:\s*JSON\.stringify\(\{\s*v:\s*BUILD_TIME\s*\}\)\s*\}\)/);
  assert.match(VITE, /apply:\s*'build'/);
  // fișierul nu intră în precache (ar fi tot cel vechi) și nu stă în cache la Vercel
  assert.doesNotMatch(VITE.match(/globPatterns:\s*\[[^\]]*\]/)[0], /json/);
  const vercel = JSON.parse(read('vercel.json'));
  const h = vercel.headers.find((x) => new RegExp(`^${x.source}$`).test('/version.json'));
  assert.ok(h && h.headers.some((y) => y.key === 'Cache-Control' && /max-age=0/.test(y.value)));
  const v = read('src/lib/versiune.js');
  assert.match(v, /typeof __BUILD_TIME__ !== 'undefined' \? __BUILD_TIME__ : null/);
});

test('main.jsx + App.jsx: versiunea e verificată la preluarea paginii și la revenire; se ia la următoarea pagină', () => {
  const main = read('src/main.jsx');
  assert.match(main, /import \{ verificaVersiunea \} from '\.\/lib\/versiune';/);
  assert.match(main, /addEventListener\('controllerchange', \(\) => \{\s*\n?\s*if \(hadController\) verificaVersiunea\(\);/);
  assert.match(main, /visibilitychange[\s\S]*?10 \* 60000[\s\S]*?r\.update\(\)[\s\S]*?verificaVersiunea\(\);/);
  const app = read('src/App.jsx');
  assert.match(app, /import \{ laSchimbareaPaginii \} from '\.\/lib\/versiune';/);
  assert.match(app, /if \(primaRuta\.current\) \{ primaRuta\.current = false; return; \}\s*\n\s*laSchimbareaPaginii\(\);\s*\n\s*\}, \[pathname\]\);/,
    'prima randare nu contează; doar schimbările de pagină');
});

// ── 3) nota cu roșu: vizibilă chiar dacă elevul e pe pagina 2 sau 3 ───────────
// DOM de test: zona cu paginile (holder), prima pagină și nota, cu dreptunghiurile lor
function dom({ holder, pag, nota, scrollTop = 0, scrollLeft = 0 }) {
  const rect = (r) => ({ ...r, right: r.left + r.width, bottom: r.top + r.height });
  const h = { scrollTop, scrollLeft, getBoundingClientRect: () => rect(holder), scrolls: [], scrollTo(o) { this.scrolls.push(o); } };
  const p = { getBoundingClientRect: () => rect(pag) };
  const g = { getBoundingClientRect: () => rect(nota), closest: (sel) => (sel === '[data-pdf-pagini]' ? h : sel === '[data-pagina]' ? p : null) };
  return { doc: { querySelector: (sel) => (sel === '.nota-rosie' ? g : null) }, h };
}

test('veziNota: derulează la începutul primei pagini (antetul + nota); pagina mărită → nota spre mijloc', async () => {
  const L = await lib();
  // telefon: zona cu paginile 390×330 (profesorul deschis jos); elevul e pe pagina 2:
  // prima pagină începe cu 1200 px mai sus, nota e la 60 px sub începutul ei
  const d = dom({ holder: { top: 100, left: 0, width: 390, height: 330 }, pag: { top: -1100, left: 6, width: 378, height: 535 },
    nota: { top: -1040, left: 250, width: 110, height: 30 }, scrollTop: 1250 });
  assert.strictEqual(L.notaPeEcran({ doc: d.doc }), false);
  const poz = L.veziNota({ doc: d.doc });
  assert.deepStrictEqual(poz, { top: 1250 + (-1100 - 100) - 8, left: 0 });
  assert.strictEqual(d.h.scrolls[0].behavior, 'smooth');
  // după derulare, nota e pe ecran
  const dupa = dom({ holder: { top: 100, left: 0, width: 390, height: 330 }, pag: { top: 108, left: 6, width: 378, height: 535 }, nota: { top: 168, left: 250, width: 110, height: 30 } });
  assert.strictEqual(L.notaPeEcran({ doc: dupa.doc }), true);
  // pagina mărită (zoom 300%): nota nu încape cu antetul deasupra → nota la o treime
  const mare = dom({ holder: { top: 100, left: 0, width: 390, height: 330 }, pag: { top: -2000, left: -800, width: 1700, height: 2400 },
    nota: { top: -1600, left: 700, width: 300, height: 80 }, scrollTop: 2500, scrollLeft: 800 });
  const pm = L.veziNota({ doc: mare.doc, lin: false });
  assert.strictEqual(pm.top, Math.round(2500 + (-1600 - 100) - 330 / 3));
  assert.strictEqual(pm.left, 800 + (1000 - 390) + 16, 'nota din dreapta paginii, adusă în ecran');
  assert.strictEqual(mare.h.scrolls[0].behavior, 'auto');
  // nota nedesenată (încă nicio corectare) → nimic
  assert.strictEqual(L.veziNota({ doc: { querySelector: () => null } }), null);
  assert.strictEqual(L.notaPeEcran({ doc: null }), false);
});

test('nota în bara de rezolvare (clic → la notă), în capătul paginilor și derularea după prima corectare', () => {
  const rz = read('src/components/RezolvarePdf.jsx');
  assert.match(rz, /veziNota, notaPeEcran,\s*\n\}\s*from '\.\.\/lib\/pdfRezolvare'|veziNota, notaPeEcran,[\s\S]{0,40}\} from '\.\.\/lib\/pdfRezolvare'/);
  assert.match(rz, /nota: notaPag, veziNota: \(\) => veziNota\(\), notaPeEcran: \(\) => notaPeEcran\(\),/);
  // cipul: cu nota scrisă de mână, roșu, estompat dacă elevul a mai scris după corectare
  assert.match(rz, /const ns = solve\.nota \? notaScrisa\(solve\.nota\.v\) : null;/);
  assert.match(rz, /className="nota-bara" onClick=\{\(\) => solve\.veziNota\(\)\}/);
  assert.match(rz, /fontFamily: FONT_MANA[^}]*\}\}>\{ns\.cifre\}/);
  assert.match(rz, /opacity: solve\.nota\.vechi \? 0\.6 : 1/);
  assert.match(rz, /const right = \(\s*\n\s*<span[^>]*>\s*\n\s*\{notaBtn\}/, 'primul în dreapta barei (se vede și pe telefon)');
  assert.match(rz, /vezi nota pe test ↑/);
  const pv = read('src/pages/PDFViewer.jsx');
  assert.match(pv, /solve\.keepResult\(r, req\.sigs\);[\s\S]{0,400}if \(r\.nota != null && !notaArataRef\.current\) \{\s*\n\s*notaArataRef\.current = true;\s*\n\s*setTimeout\(\(\) => \{ if \(!solve\.notaPeEcran\(\)\) solve\.veziNota\(\); \}, 450\);/);
  assert.match(pv, /notaArataRef\.current = false; \}, \[item\?\.id\]\);/, 'o dată pe test, în fiecare vizită');
  // nota se calculează la ORICE corectare punctată (și cu 2–3 exerciții), iar punctajul se salvează
  const api = read('api/rezolva-pdf.js');
  assert.match(api, /const nota = punctat && sum\.total \? med\.notaTest\(sum\.score, sum\.total\) : null;/);
  assert.match(api, /saved = \{ kind: 'progress', attempts: r\.attempts, partial: !sum\.complete \};/);
});
