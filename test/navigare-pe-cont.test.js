// =====================================================================
// test/navigare-pe-cont.test.js — cererea din 11 noiembrie 2026 (seara):
//   „Fă site-ul ușor de folosit ca aplicație, fiecare tip de cont să aibă în
//    home butoane simple către funcționalitățile tipului de cont. Să nu aibă
//    în contul de un anumit tip (cum ar fi părinte) butoane în plus de la alt
//    tip de cont (cum ar fi elev). Mai puțin text de descriere în pagini."
//
// Ce verificăm:
//   1) src/lib/meniu.js — meniul lateral / ☰, bara de jos de pe telefon și
//      butoanele din Home, pe tipul de cont: niciun buton al altui cont;
//   2) Home: butoane în loc de paragrafe, exercițiul rezolvat pe loc;
//   3) bara de jos: montată doar pe paginile cu bara de sus;
//   4) înregistrarea: tipul de cont din adresă, etichete pe înțeles.
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
let M = null;
const meniu = async () => (M || (M = await import('../src/lib/meniu.js')));

const CONTURI = {
  vizitator: {},
  elev: { user: { id: 'u' } },
  parinte: { user: { id: 'u' }, isParent: true },
  profesor: { user: { id: 'u' }, isTeacher: true },
};
// toate adresele dintr-un meniu (și cele din secțiunile pliabile)
const adrese = (sectiuni) => sectiuni.flatMap((s) => s.items).flatMap((i) => (i.tip === 'pliabil' ? i.copii.map((c) => c.to) : [i.to])).filter(Boolean);

test('tipul de cont: vizitator / elev / părinte / profesor (contul fără rol e tratat ca elev)', async () => {
  const { rolDin, ROLURI } = await meniu();
  assert.deepStrictEqual(ROLURI, ['vizitator', 'elev', 'parinte', 'profesor']);
  assert.strictEqual(rolDin({}), 'vizitator');
  assert.strictEqual(rolDin(CONTURI.elev), 'elev');
  assert.strictEqual(rolDin(CONTURI.parinte), 'parinte');
  assert.strictEqual(rolDin(CONTURI.profesor), 'profesor');
});

test('meniul lateral / ☰: fiecare cont doar cu funcțiile lui', async () => {
  const { sectiuniMeniu, DOAR_ELEV, DOAR_PROFESOR, DOAR_PARINTE } = await meniu();
  const m = Object.fromEntries(Object.entries(CONTURI).map(([k, o]) => [k, adrese(sectiuniMeniu(o))]));

  // elevul și vizitatorul: „Pregătește-mă", „Meditații live", „Arena"
  for (const rol of ['vizitator', 'elev']) {
    for (const to of ['/pregateste-ma', '/meditatii', '/arena']) assert.ok(m[rol].includes(to), `${rol}: ${to}`);
    for (const to of [...DOAR_PROFESOR, ...DOAR_PARINTE]) assert.ok(!m[rol].includes(to), `${rol} nu are ${to}`);
  }
  // părintele: copilul lui, fără butoanele elevului și ale profesorului
  for (const to of ['/profil?rezultate=1', '/profil?asociere=1', '/mesagerie', '/profesor-virtual']) assert.ok(m.parinte.includes(to), `părinte: ${to}`);
  for (const to of [...DOAR_ELEV, ...DOAR_PROFESOR]) assert.ok(!m.parinte.includes(to), `părintele nu are ${to}`);
  // profesorul: uneltele lui, fără butoanele elevului și ale părintelui
  for (const to of ['/profesor-virtual?tab=interactive', '/profesor-virtual?tab=exam', '/profil?rezultate=1', '/profil?catalog=1', '/profil?invita=1', '/mesagerie']) assert.ok(m.profesor.includes(to), `profesor: ${to}`);
  for (const to of [...DOAR_ELEV, ...DOAR_PARINTE]) assert.ok(!m.profesor.includes(to), `profesorul nu are ${to}`);

  // comune tuturor: materialele, forumul, recenziile, abonamentul
  for (const rol of Object.keys(CONTURI)) {
    for (const to of ['/', '/evaluare-nationala', '/clase/8', '/manuale', '/rezolvari', '/biblioteca-utilizatorilor', '/discutii', '/recenzii', '/preturi']) assert.ok(m[rol].includes(to), `${rol}: ${to}`);
    assert.strictEqual(new Set(m[rol]).size, m[rol].length, `${rol}: nicio intrare de două ori`);
  }
  // vizitatorul nu are mesagerie (cere cont); conturile au „Contul meu" și ieșirea
  assert.ok(!m.vizitator.includes('/mesagerie') && m.vizitator.includes('/inregistrare'));
  for (const rol of ['elev', 'parinte', 'profesor']) {
    assert.ok(m[rol].includes('/profil') && m[rol].includes('/mesagerie'), rol);
    assert.ok(sectiuniMeniu(CONTURI[rol]).flatMap((s) => s.items).some((i) => i.tip === 'iesire'));
  }
  // adminul le verifică pe toate: vede și intrările elevului, chiar cu cont de profesor
  const admin = adrese(sectiuniMeniu({ ...CONTURI.profesor, isAdmin: true }));
  for (const to of ['/pregateste-ma', '/meditatii', '/arena', '/admin', '/profesor-virtual?tab=interactive']) assert.ok(admin.includes(to), `admin: ${to}`);
  // secțiunile: profesorul începe cu „Clasa mea", părintele cu „Copilul meu"
  assert.strictEqual(sectiuniMeniu(CONTURI.profesor)[1].titlu, 'Clasa mea');
  assert.strictEqual(sectiuniMeniu(CONTURI.parinte)[1].titlu, 'Copilul meu');
  assert.strictEqual(sectiuniMeniu(CONTURI.elev)[1].titlu, 'Materiale');
});

test('bara de jos de pe telefon: cel mult 5 intrări, pe tipul de cont', async () => {
  const { baraJos, DOAR_ELEV, DOAR_PROFESOR, DOAR_PARINTE } = await meniu();
  const b = Object.fromEntries(['vizitator', 'elev', 'parinte', 'profesor'].map((r) => [r, baraJos(r)]));
  for (const [rol, it] of Object.entries(b)) {
    assert.ok(it.length >= 4 && it.length <= 5, `${rol}: ${it.length} intrări`);
    assert.strictEqual(it[0].to, '/', `${rol}: „Acasă" prima`);
    for (const i of it) assert.ok(i.icon && i.label && i.label.length <= 12, `${rol}: ${i.label}`);
    assert.strictEqual(new Set(it.map((i) => i.to)).size, it.length);
  }
  assert.deepStrictEqual(b.elev.map((i) => i.label), ['Acasă', 'Materiale', 'Pregătire', 'Mesaje', 'Cont']);
  assert.deepStrictEqual(b.parinte.map((i) => i.label), ['Acasă', 'Rezultate', 'Temă', 'Mesaje', 'Cont']);
  // 13 nov. 2026: la profesor „Materiale" (ca la elev) în loc de „Teste"
  assert.deepStrictEqual(b.profesor.map((i) => i.label), ['Acasă', 'Materiale', 'Elevi', 'Mesaje', 'Cont']);
  assert.strictEqual(b.profesor[1].to, '/#materiale');
  assert.deepStrictEqual(b.vizitator.map((i) => i.to), ['/', '/#materiale', '/pregateste-ma', '/preturi', '/inregistrare']);
  for (const to of [...DOAR_ELEV]) { assert.ok(!b.parinte.some((i) => i.to === to), to); assert.ok(!b.profesor.some((i) => i.to === to), to); }
  for (const to of [...DOAR_PROFESOR, ...DOAR_PARINTE]) assert.ok(!b.elev.some((i) => i.to === to) && !b.vizitator.some((i) => i.to === to), to);
  // bulina de mesaje noi pe „Mesaje"
  for (const rol of ['elev', 'parinte', 'profesor']) assert.strictEqual(b[rol].find((i) => i.to === '/mesagerie').badge, 'chat');
});

test('intrarea activă: adresa cu ?… bate calea simplă („Rezultate" ≠ „Cont"); „Materiale" = /#materiale', async () => {
  const { baraJos, activInBara, esteActiv } = await meniu();
  const p = baraJos('parinte');
  assert.strictEqual(p[activInBara(p, { pathname: '/profil', search: '?rezultate=1' })].label, 'Rezultate');
  assert.strictEqual(p[activInBara(p, { pathname: '/profil', search: '' })].label, 'Cont');
  assert.strictEqual(p[activInBara(p, { pathname: '/profesor-virtual', search: '' })].label, 'Temă');
  const e = baraJos('elev');
  assert.strictEqual(e[activInBara(e, { pathname: '/', hash: '' })].label, 'Acasă');
  assert.strictEqual(e[activInBara(e, { pathname: '/', hash: '#materiale' })].label, 'Materiale');
  assert.strictEqual(activInBara(e, { pathname: '/clase/7' }), -1, 'pe o pagină din afara barei nu e nimic aprins');
  const t = baraJos('profesor');
  assert.strictEqual(t[activInBara(t, { pathname: '/', hash: '#materiale' })].label, 'Materiale');
  assert.strictEqual(t[activInBara(t, { pathname: '/profil', search: '?rezultate=1' })].label, 'Elevi');
  assert.strictEqual(activInBara(t, { pathname: '/profesor-virtual', search: '?tab=interactive' }), -1, 'generatorul nu mai e în bară (e în meniu)');
  // esteActiv: prefix de secțiune + ?…
  assert.ok(esteActiv('/clase/7', '/clase') && !esteActiv('/clasele', '/clase') && esteActiv('/', '/') && !esteActiv('/x', '/'));
  assert.ok(esteActiv('/profil', '/profil?rezultate=1', '?rezultate=1&x=2'));
  assert.ok(!esteActiv('/profil', '/profil?rezultate=1', '?teme=1') && !esteActiv('/profil', '/profil?rezultate=1'));
});

test('butoanele din Home („Tot ce poți face"): pe tipul de cont, scurte', async () => {
  const { scurtaturi, DOAR_ELEV, DOAR_PROFESOR, DOAR_PARINTE } = await meniu();
  const s = Object.fromEntries(['vizitator', 'elev', 'parinte', 'profesor'].map((r) => [r, scurtaturi(r)]));
  for (const [rol, it] of Object.entries(s)) {
    assert.ok(it.length >= 4 && it.length <= 8, `${rol}: ${it.length}`);
    for (const i of it) assert.ok(i.to && i.icon && i.label && i.label.length <= 24, `${rol}: ${i.label}`);
  }
  assert.ok(s.elev.some((i) => i.to === '/meditatii') && s.elev.some((i) => i.to === '/arena') && s.elev.some((i) => i.to === '/profesor-virtual'));
  for (const to of DOAR_ELEV) { assert.ok(!s.parinte.some((i) => i.to === to), `părinte: ${to}`); assert.ok(!s.profesor.some((i) => i.to === to), `profesor: ${to}`); }
  for (const to of [...DOAR_PROFESOR, ...DOAR_PARINTE]) assert.ok(!s.elev.some((i) => i.to === to), `elev: ${to}`);
  for (const to of DOAR_PROFESOR) assert.ok(!s.parinte.some((i) => i.to === to), `părinte: ${to}`);
  assert.ok(s.profesor.some((i) => i.to === '/profesor-virtual?tab=exam') && s.profesor.some((i) => i.to === '/profil?catalog=1'));
  assert.ok(s.parinte.some((i) => i.to === '/profesor-virtual' && /temă/i.test(i.label)) && s.parinte.some((i) => i.to === '/preturi'));
});

test('Home: butoane în loc de paragrafe; blocurile pe tipul de cont', () => {
  const home = read('src/pages/Home.jsx');
  // salutul în bara albastră; vizitatorul are titlul cu examenele
  assert.match(home, /<h1>\{cont === 'profesor' \? 'Bună ziua' : 'Bună'\}\{prenume \? `, \$\{prenume\}` : ''\}! 👋<\/h1>/);
  assert.match(home, /<h1>Matematică pentru Evaluarea Națională și BAC<\/h1>/);
  // blocurile, în ordinea de pe pagină
  const ordine = ['<PregatireCard />}', '<AcasaElev />}', "(cont === 'vizitator' || cont === 'elev') && <Materiale />}", '<Scurtaturi rol={cont} />', "(cont === 'parinte' || cont === 'profesor') && <Materiale />}", "cont === 'vizitator' && <PentruCine />}", '<Testimonials limit={6} />'];
  let last = -1;
  for (const s of ordine) { const i = home.indexOf(s); assert.ok(i > last, s); last = i; }
  assert.match(home, /\{!isPremium && cont !== 'profesor' && <GratuitPremium rol=\{cont\} \/>\}/);
  assert.match(home, /const lista = scurtaturi\(rol\);/, 'butoanele vin din src/lib/meniu.js');
  assert.match(home, /id="materiale"/);
  assert.match(home, /to=\{`\/inregistrare\?tip=\$\{p\.tip\}`\}/, '„Alege contul tău" duce la înregistrare cu tipul ales');
  // fără lista modelelor AI și fără cardurile cu paragrafe lungi
  assert.ok(!/AIPoweredBy|GPT-|Claude Opus|card-grid/.test(home));
  const paragrafe = [...home.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1].replace(/<[^>]+>|\{[^}]*\}/g, '').replace(/\s+/g, ' ').trim());
  for (const p of paragrafe) assert.ok(p.length <= 130, `paragraf prea lung (${p.length}): ${p.slice(0, 60)}…`);
  // „Pregătește-mă": butonul e link adevărat (nu tot cardul), vizitatorul are exercițiul
  assert.match(home, /<Link to="\/pregateste-ma" className="btn btn-primary btn-lg pz-home-btn">\{cta\}<\/Link>/);
  assert.match(home, /\{!user && <ExercitiuRapid \/>\}/);
  assert.ok(!/\.pz-home-btn \{ pointer-events: none; \}/.test(read('src/styles/global.css')));
  // cardurile contului nu mai repetă salutul
  assert.ok(!/<Antet /.test(read('src/components/AcasaCont.jsx')));
});

test('„Încearcă acum": exercițiile din Home au 4 variante, una corectă și explicația ei', () => {
  const src = read('src/components/ExercitiuRapid.jsx');
  const lista = vm.runInNewContext(`(${src.slice(src.indexOf('export const EXERCITII = [') + 'export const EXERCITII = '.length, src.indexOf('];', src.indexOf('export const EXERCITII = [')) + 1)})`);
  assert.ok(lista.length >= 6);
  for (const e of lista) {
    assert.ok(e.q && e.de && e.de.length > 15, e.q);
    assert.strictEqual(e.opt.length, 4, e.q);
    assert.strictEqual(new Set(e.opt).size, 4, `variante diferite: ${e.q}`);
    assert.ok(Number.isInteger(e.ok) && e.ok >= 0 && e.ok < 4, e.q);
  }
  assert.ok(new Set(lista.map((e) => e.ok)).size >= 3, 'răspunsul corect nu stă mereu pe aceeași poziție');
  // rezultatele, verificate cu calcul
  const corect = (q) => { const e = lista.find((x) => x.q.startsWith(q)); return e.opt[e.ok]; };
  assert.strictEqual(corect('Cât face 2³'), String(2 ** 3 * 2 ** 2));
  assert.strictEqual(corect('Soluția ecuației 3x − 5 = 16'), `x = ${(16 + 5) / 3}`);
  assert.strictEqual(corect('20% din 150'), String(0.2 * 150));
  assert.strictEqual(corect('Un triunghi are două unghiuri'), `${180 - 50 - 60}°`);
  assert.strictEqual(corect('√144'), String(Math.sqrt(144) - Math.sqrt(49)));
  assert.strictEqual(corect('Media aritmetică'), String((6 + 8 + 10) / 3));
  assert.strictEqual(corect('Aria unui pătrat'), `${6 * 6} cm²`);
  // după răspuns: explicația și drumul spre un test întreg, fără cont
  assert.match(src, /linkTest\(test\) \|\| '\/evaluare-nationala\?tab=interactive'/);
  assert.match(src, /aria-live="polite"/);
});

test('„▶ Începe un test": întâi un test întreg nerezolvat, apoi orice nerezolvat, apoi primul', async () => {
  const { alegeTest, linkTest } = await import('../src/lib/alegeTest.js');
  const rows = [
    { id: 'a', title: 'Capitol', subcategory: 'capitole' },
    { id: 'b', title: 'Test 1', subcategory: 'teste-interactive' },
    { id: 'c', title: 'Test 2', subcategory: 'teste-interactive' },
  ];
  assert.strictEqual(alegeTest(rows).id, 'b');
  assert.strictEqual(alegeTest(rows, new Set(['b'])).id, 'c');
  assert.strictEqual(alegeTest(rows, new Set(['b', 'c'])).id, 'a');
  assert.strictEqual(alegeTest(rows, new Set(['a', 'b', 'c'])).id, 'b', 'toate rezolvate → primul');
  assert.strictEqual(alegeTest([]), null);
  assert.strictEqual(alegeTest([null, {}]), null);
  assert.strictEqual(linkTest({ id: 'x' }), '/exercitiu?id=x');
  assert.strictEqual(linkTest(null), null);
  // interogarea: doar teste interactive gratuite (fără cont), ținută minte un minut
  const src = read('src/lib/testRapid.js');
  assert.match(src, /\.eq\('content_type', 'interactive'\)\.eq\('is_free', true\)/);
  assert.match(src, /const TTL = 60000;/);
});

test('bara de jos: doar pe paginile cu bara de sus; widgetul și bannerele îi lasă loc', () => {
  const app = read('src/App.jsx');
  assert.match(app, /import BaraJos from '\.\/components\/BaraJos';/);
  assert.match(app, /\{!fullscreen && <BaraJos \/>\}\s*\n\s*\{!fullscreen && <FloatingTutor \/>\}/);
  const bara = read('src/components/BaraJos.jsx');
  assert.match(bara, /baraJos\(rolDin\(\{ user, isTeacher, isParent \}\)\)/);
  assert.match(bara, /const intrari = loading \? \[\] : /, 'cât se află cine e, fără butoanele vizitatorului');
  assert.match(bara, /document\.body\.classList\.add\('cu-bara-jos'\)/);
  const css = read('src/styles/global.css');
  assert.match(css, /\.bara-jos \{ display: none; \}/, 'pe calculator nu apare');
  assert.match(css, /body\.cu-bara-jos \.app-shell \{ padding-bottom: var\(--bara-jos-h\); \}/);
  assert.match(css, /env\(safe-area-inset-bottom/);
  // Profesorul Virtual (butonul plutitor) porneşte deasupra barei; bannerele la fel
  const tutor = read('src/components/AITutor.jsx');
  assert.match(tutor, /const jos = \(\) => \(window\.innerWidth <= 768 \? 66 : 0\);/);
  assert.match(tutor, /y: window\.innerHeight - BTN - 22 - jos\(\) \}/);
  assert.match(read('src/components/InstallPrompt.jsx'), /calc\(96px \+ var\(--bara-jos-h, 0px\)\)/);
  assert.match(read('src/components/CookieConsent.jsx'), /calc\(12px \+ var\(--bara-jos-h, 0px\)\)/);
  // meniurile primesc tipul de cont
  const nav = read('src/components/Navbar.jsx');
  assert.match(nav, /<Sidebar[\s\S]{0,160}isParent=\{isParent\}/);
  assert.match(nav, /<MobileMenu[\s\S]{0,240}isParent=\{isParent\}/);
  assert.match(read('src/components/Sidebar.jsx'), /sectiuniMeniu\(\{ user, isAdmin, isTeacher, isPremium, isParent,/);
  // „Contul meu" urmărește adresa: /profil → /profil?rezultate=1 derulează la secțiune
  const profil = read('src/pages/Profile.jsx');
  assert.match(profil, /useEffect\(\(\) => \{ setSectiune\(sectiuneaDinUrl\(\)\); \}, \[cautare\]\);/);
});

test('widgetul profesorilor: fără butoanele elevului („Pregătește-mă", „Meditații live")', () => {
  const w = read('src/components/AITutor.jsx');
  assert.match(w, /\{!medMode && !isMentorAcc && pathname !== '\/pregateste-ma' && \(/);
  assert.match(w, /\{!medMode && !isMentorAcc && pathname !== '\/meditatii' && \(/);
  assert.match(w, /const isMentorAcc = isTeacher \|\| isParent;/);
});

test('înregistrarea: tipul de cont din adresă (?tip=), etichete pe înțeles', () => {
  const reg = read('src/pages/Register.jsx');
  assert.match(reg, /new URLSearchParams\(window\.location\.search\)\.get\('tip'\)/);
  assert.match(reg, /\['elev', 'profesor', 'parinte'\]\.includes\(t\) \? t : 'elev'/);
  for (const f of ['src/pages/Register.jsx', 'src/components/RoleChooser.jsx']) {
    const s = read(f);
    assert.ok(!/rezolv \|\| corectez|doar rezolv/.test(s), `${f}: fără „rezolv || corectez"`);
    assert.match(s, /tag: 'dau teste elevilor'/);
    assert.match(s, /tag: 'îmi urmăresc copilul'/);
  }
});
