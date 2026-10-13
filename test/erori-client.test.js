// Teste pentru ERORILE DIN BROWSER raportate agentului de debug (Admin → Agent debug):
// după un deploy, un tab vechi cere fișiere JS/CSS care nu mai există — Safari spune
// „'text/html' is not a valid JavaScript MIME type" (Vercel îi dădea index.html în loc de
// 404), Vite „Unable to preload CSS for /assets/…"; unele browsere nu pot descărca
// /sw.js („Failed to register a ServiceWorker … An unknown error occurred when fetching
// the script"). Acestea nu sunt erori ale site-ului: pagina se reîncarcă o dată
// (src/lib/chunkReload.js), service worker-ul se înregistrează cu eroarea prinsă
// (src/main.jsx), iar serverul nu le mai păstrează (api/client-error.js → IGNORE).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { createFakeSupabase, fakeRes } = require('./tools/fakeSupabase');
const ai = require('../api/_lib/ai');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8');
// mesajele exacte din agentul de debug (12 octombrie 2026)
const STALE = ["'text/html' is not a valid JavaScript MIME type.", 'Unable to preload CSS for /assets/live-BThDClzl.css'];
const SW = "Failed to register a ServiceWorker for scope ('https://examenmate.com/') with script ('https://examenmate.com/sw.js'): An unknown error occurred when fetching the script.";

test('serverul nu mai păstrează zgomotul: fișierele versiunii vechi și service worker-ul; „Rejected" rămâne (cu detalii de acum)', async () => {
  const ce = require('../api/client-error');
  for (const m of [...STALE, SW, 'Failed to fetch dynamically imported module: https://examenmate.com/assets/Admin-x1.js', 'Importing a module script failed.']) {
    assert.ok(ce.IGNORE.test(m), m);
  }
  for (const m of ['Rejected', 'x is not a function', "Cannot read properties of undefined (reading 'map')"]) assert.ok(!ce.IGNORE.test(m), m);
  const fake = createFakeSupabase({});
  const orig = ai.admin;
  ai.admin = () => fake;
  try {
    const res = fakeRes();
    await ce({ method: 'POST', headers: { 'x-forwarded-for': '9.9.9.9' }, body: { errors: [...STALE.map((message) => ({ message })), { message: SW }, { message: 'Rejected', stack: 'motivul respingerii: string', url: '/admin' }] } }, res);
    assert.strictEqual(res.body.saved, 1);
    assert.strictEqual(fake.db.rpcs[0].args.p_message, 'Rejected');
  } finally { ai.admin = orig; }
});

test('browserul: o versiune nouă a site-ului → pagina se reîncarcă O SINGURĂ dată (anti-buclă), fără raportare', async () => {
  const C = await import('../src/lib/chunkReload.js').catch(() => null);
  if (!C) return;   // Node vechi
  for (const m of [...STALE, 'Failed to fetch dynamically imported module: https://examenmate.com/assets/LiveRoom-a.js', 'Importing a module script failed.',
    "Failed to load module script: Expected a JavaScript module script but the server responded with a MIME type of \"text/html\".", 'Loading chunk 42 failed.']) {
    assert.ok(C.CHUNK_ERROR.test(m), m);
  }
  assert.ok(!C.CHUNK_ERROR.test('x is not a function'));
  const store = {};
  let reloads = 0;
  const hadWindow = 'window' in global;
  const prev = global.window;
  global.window = { sessionStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; } }, location: { reload: () => { reloads++; } } };
  try {
    assert.strictEqual(C.reloadForNewVersion(), true);
    assert.strictEqual(reloads, 1);
    assert.strictEqual(global.window.__mateReloading, true, 'erorile de până la reîncărcare nu se mai raportează');
    assert.strictEqual(C.reloadForNewVersion(), false, 'a doua oară în 15 s: nu bucla — eroarea e reală');
    assert.strictEqual(reloads, 1);
    // fără sessionStorage (Safari privat): marcaj în memorie
    global.window = { sessionStorage: { getItem: () => { throw new Error('blocat'); } }, location: { reload: () => { reloads++; } } };
    assert.strictEqual(C.reloadForNewVersion(), true);
    assert.strictEqual(C.reloadForNewVersion(), false);
    assert.strictEqual(reloads, 2);
  } finally {
    if (hadWindow) global.window = prev; else delete global.window;
  }
});

test('configurația: fișierele lipsă din /assets/ primesc 404 (nu index.html); service worker-ul, cu eroarea prinsă; reporterul filtrează', () => {
  const vercel = JSON.parse(read('vercel.json'));
  const spa = vercel.rewrites.find((r) => r.destination === '/index.html');
  assert.strictEqual(spa.source, '/((?!assets/).*)');
  const re = new RegExp(`^${spa.source}$`);
  assert.ok(!re.test('/assets/Admin-OldHash1.js'), 'un chunk vechi → 404, nu HTML (de aici „text/html is not a valid JavaScript MIME type")');
  assert.ok(re.test('/meditatii/sala/abc') && re.test('/admin'), 'rutele aplicației rămân');
  // headerul „immutable" al /assets/ nu mai ajunge pe index.html servit în locul unui chunk
  assert.ok(vercel.headers.some((h) => h.source === '/assets/(.*)'));
  const vite = read('vite.config.js');
  assert.match(vite, /injectRegister:\s*false/);
  // cu înregistrarea noastră, pluginul nu mai pune singur skipWaiting/clientsClaim: fără ele,
  // versiunea nouă aștepta până se închideau toate tab-urile (Admin vechi după deploy, 13 oct.)
  assert.match(vite, /skipWaiting:\s*true/);
  assert.match(vite, /clientsClaim:\s*true/);
  const main = read('src/main.jsx');
  assert.match(main, /navigator\.serviceWorker\.register\('\/sw\.js', \{ scope: '\/' \}\)\s*\n?\s*\.catch\(/);
  assert.match(main, /addEventListener\('controllerchange', \(\) => \{\s*\n?\s*if \(hadController && performance\.now\(\) < 10000\) reloadForNewVersion\(\);/);
  assert.match(main, /vite:preloadError', \(\) => \{ reloadForNewVersion\(\); \}/);
  const rep = read('src/lib/errorReport.js');
  assert.match(rep, /window\.__mateReloading/);
  assert.match(rep, /CHUNK_ERROR\.test\(message\) && reloadForNewVersion\(\)/);
  assert.match(rep, /Failed to register a ServiceWorker/);
  assert.match(rep, /motivul respingerii/);
});
