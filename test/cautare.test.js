// =====================================================================
// test/cautare.test.js — 12 noiembrie 2026, „erori de cod":
//   1) căutarea din bara de sus: rezolvarea găsită se deschide filtrată, articolele
//      de blog apar și se deschid direct, autorul unei discuții e cel real (nu
//      „Utilizator" la toate), iar răspunsul unei căutări vechi nu-l mai acoperă
//      pe al celei noi;
//   2) Profesorul Virtual plutitor se încarcă după prima afișare, într-o bucată
//      separată, și nu mai poate dărâma pagina dacă pică.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

test('unde duce fiecare rezultat al căutării', async () => {
  const C = await import('../src/lib/cautare.js');
  assert.strictEqual(C.tintaRezultat({ _type: 'articol', slug: 'teorema-lui-pitagora' }), '/rezolvari/teorema-lui-pitagora');
  assert.strictEqual(C.tintaRezultat({ _type: 'articol' }), '/rezolvari');
  assert.strictEqual(C.tintaRezultat({ _type: 'rezolvare', title: 'Ecuații & inecuații (cl. 8)' }), '/rezolvari?q=Ecua%C8%9Bii%20%26%20inecua%C8%9Bii%20(cl.%208)');
  assert.strictEqual(C.tintaRezultat({ _type: 'rezolvare' }), '/rezolvari');
  assert.strictEqual(C.tintaRezultat({ _type: 'public', title: 'Test fracții' }), '/biblioteca-utilizatorilor?q=Test%20fracții'.replace('ț', '%C8%9B'));
  assert.strictEqual(C.tintaRezultat({ id: 'x', content_type: 'pdf' }), null, 'materialele se deschid cu verificarea accesului');
  assert.strictEqual(C.tintaRezultat(null), null);
  // pagina de rezolvări citește înapoi exact ce a pus căutarea
  const adresa = C.tintaRezultat({ _type: 'rezolvare', title: 'Ecuații & inecuații (cl. 8)' });
  assert.strictEqual(C.cautareDinAdresa(adresa.slice(adresa.indexOf('?'))), 'Ecuații & inecuații (cl. 8)');
  assert.strictEqual(C.cautareDinAdresa(''), null);
  assert.strictEqual(C.cautareDinAdresa('?q='), '');
  assert.strictEqual(C.cautareDinAdresa(`?q=${'a'.repeat(300)}`).length, 120);
});

test('autorul unei discuții: numele real sau nimic (nu „Utilizator" la toate)', async () => {
  const C = await import('../src/lib/cautare.js');
  const d = C.cuAutori(
    [{ id: 1, user_id: 'u1', body: 'a' }, { id: 2, user_id: 'u2', body: 'b' }, { id: 3, user_id: null, body: 'c' }, { id: 4, user_id: 'u3', body: 'd' }],
    [{ id: 'u1', full_name: ' Ana Pop ' }, { id: 'u3', full_name: '' }, null],
  );
  assert.deepStrictEqual(d.map((x) => x.autor), ['Ana Pop', null, null, null]);
  assert.strictEqual(C.eticDiscutie(d[0]), '💬 Discuții · Ana Pop');
  assert.strictEqual(C.eticDiscutie(d[1]), '💬 Discuții');
  assert.deepStrictEqual(C.cuAutori(null, null), []);
  // profilurile nu se pot citi (vizitator) → fără nume, fără eroare
  assert.deepStrictEqual(C.cuAutori([{ id: 1, user_id: 'u1' }], null).map((x) => x.autor), [null]);
});

test('bara de căutare folosește regulile de mai sus', () => {
  const n = read('src/components/Navbar.jsx');
  assert.match(n, /import \{ tintaRezultat, cuAutori, eticDiscutie \} from '\.\.\/lib\/cautare';/);
  // articolele publicate intră în căutare
  assert.match(n, /supabase\.from\('articole'\)\.select\('slug, title, kind'\)\s*\n\s*\.eq\('status', 'published'\)\.ilike\('title', `%\$\{query\}%`\)\.limit\(5\)/);
  assert.match(n, /if \(item\._type === 'articol'\)/);
  assert.match(n, /<button key=\{'art-'\+item\.id\} onClick=\{\(\) => \{ navigate\(tintaRezultat\(item\)\); onClose\(\); \}\}/);
  assert.match(n, /<button key=\{'rez-'\+item\.id\} onClick=\{\(\) => \{ navigate\(tintaRezultat\(item\)\); onClose\(\); \}\}/);
  assert.ok(!/navigate\('\/rezolvari'\); onClose\(\);/.test(n), 'rezolvarea nu mai duce la pagina întreagă');
  // autorii: ceruți separat, doar numele
  assert.match(n, /supabase\.from\('profiles'\)\.select\('id, full_name'\)\.in\('id', idAutori\)/);
  assert.match(n, /\{eticDiscutie\(item\)\}/);
  assert.ok(!/'Utilizator'/.test(n));
  // răspunsul unei căutări vechi nu-l acoperă pe al celei noi
  assert.match(n, /let anulat = false;/);
  assert.match(n, /if \(anulat\) return;/);
  assert.match(n, /return \(\) => \{ anulat = true; clearTimeout\(timer\); \};/);
  // pagina de rezolvări pornește cu filtrul din adresă și îl urmează când se schimbă
  const r = read('src/pages/RezolvariPage.jsx');
  assert.match(r, /const \[search, setSearch\] = useState\(\(\) => cautareDinAdresa\(location\.search\) \|\| ''\);/);
  assert.match(r, /const q = cautareDinAdresa\(location\.search\);\s*\n\s*if \(q != null\) setSearch\(q\);\s*\n\s*\}, \[location\.search\]\);/);
});

test('Profesorul Virtual plutitor: bucată separată, încărcată după prima afișare', () => {
  const app = read('src/App.jsx');
  assert.match(app, /import FloatingTutor from '\.\/components\/TutorLenes';/);
  assert.ok(!/from '\.\/components\/AITutor'/.test(app), 'App nu mai trage tot widgetul în codul de pornire');
  const t = read('src/components/TutorLenes.jsx');
  assert.match(t, /const FloatingTutor = lazy\(\(\) => import\('\.\/AITutor'\)\);/);
  assert.match(t, /<FaraWidget>\s*\n\s*<Suspense fallback=\{null\}>\s*\n\s*<FloatingTutor \/>/);
  // dacă widgetul pică, pagina rămâne (înainte nu avea nicio plasă: ecran alb)
  assert.match(t, /static getDerivedStateFromError\(\) \{\s*\n\s*return \{ picat: true \};/);
  assert.match(t, /return this\.state\.picat \? null : this\.props\.children;/);
  // paginile de pornire (încărcate direct în App) nu importă widgetul
  for (const f of ['src/pages/Home.jsx', 'src/components/Navbar.jsx', 'src/components/Sidebar.jsx', 'src/components/BaraJos.jsx', 'src/components/Footer.jsx']) {
    assert.ok(!/from '[^']*\/AITutor'/.test(read(f)), f);
  }
});
