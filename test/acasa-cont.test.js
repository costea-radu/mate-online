// =====================================================================
// test/acasa-cont.test.js — cererile din 11 noiembrie 2026 (3) și (4):
// „Contul meu" (rezultatele primele, asistenții scoși din pagină) și pagina
// „home" pe tipul de cont (elev / părinte / profesor).
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('Home: elevul și vizitatorul păstrează „Pregătește-mă de examen" (fără „Nou"); părintele și profesorul au cardurile lor', () => {
  const home = read('src/pages/Home.jsx');
  assert.match(home, /const cont = !user \? 'vizitator' : isTeacher \? 'profesor' : isParent \? 'parinte' : 'elev';/);
  assert.match(home, /\{\(cont === 'vizitator' \|\| cont === 'elev'\) && <PregatireCard \/>\}/);
  assert.match(home, /\{cont === 'elev' && <AcasaElev \/>\}/);
  assert.match(home, /\{cont === 'parinte' && <AcasaParinte \/>\}/);
  assert.match(home, /\{cont === 'profesor' && <AcasaProfesor \/>\}/);
  assert.ok(!/>Nou\b|Nou ·/.test(home), 'fără cuvântul „Nou" la „Pregătește-mă de examen"');
  // cardurile stau imediat sub „Pregătește-mă", înaintea secțiunilor de prezentare
  assert.ok(home.indexOf('<AcasaProfesor />') < home.indexOf('id="examene"'));
});

const blocul = (src, nume) => src.slice(src.indexOf(`export function ${nume}`), src.indexOf('\n}\n', src.indexOf(`export function ${nume}`)));

// după ultimul card nu mai vine nimic (fără „Părerea ta despre ExamenMate", scos în aceeași zi)
const ultimulCard = (bloc, s) => {
  const dupa = bloc.slice(bloc.indexOf(s));
  assert.ok(bloc.indexOf(s) > 0, s);
  assert.match(dupa, /^[^\n]*\n\s*<\/div>\n\s*<\/div>\n\s*<\/section>/, `${s} e ultimul card`);
};

test('Home — elev: insignele mele (progresul meu), rezultatele, temele, mesageria', () => {
  const a = read('src/components/AcasaCont.jsx');
  const elev = blocul(a, 'AcasaElev');
  const ordine = ['to="/profil?insigne=1"', 'titlu="Insignele mele" sub="progresul meu"', 'to="/profil?rezultate=1"', 'to="/profil?teme=1"', '<MesageriaCard />'];
  let last = -1;
  for (const s of ordine) { const i = elev.indexOf(s); assert.ok(i > last, s); last = i; }
  ultimulCard(elev, '<MesageriaCard />');
  assert.ok(!/pregateste-ma/.test(elev), '„Pregătește-mă" e cardul mare de deasupra');
  assert.match(elev, /aiClient\.homeworkStudentList\(\)/, 'câte teme are de făcut');
  assert.match(elev, /aiClient\.catalogMine\(\)/, 'ultima notă de la profesor');
});

test('Home — părinte: rezultate elev, asociază-te cu copilul tău, mesageria (fără „Pregătește-mă")', () => {
  const p = blocul(read('src/components/AcasaCont.jsx'), 'AcasaParinte');
  const ordine = ['titlu="Rezultate elev"', 'titlu="Asociază-te cu copilul tău"', '<MesageriaCard'];
  let last = -1;
  for (const s of ordine) { const i = p.indexOf(s); assert.ok(i > last, s); last = i; }
  ultimulCard(p, '<MesageriaCard');
  assert.match(p, /to="\/profil\?asociere=1"/);
  assert.match(p, /cod=\{profile\?\.teacher_code\}/, 'linkul de asociere, cu „Copiază"');
  assert.ok(!/pregateste|PregatireCard/i.test(p));
});

test('Home — profesor: generează teste, rezultate elevi, invită elevi, mesageria grupei', () => {
  const p = blocul(read('src/components/AcasaCont.jsx'), 'AcasaProfesor');
  const ordine = ['titlu="Generează teste"', 'titlu="Rezultate elevi"', 'titlu="Invită elevi"', 'titlu="Mesageria grupei"'];
  let last = -1;
  for (const s of ordine) { const i = p.indexOf(s); assert.ok(i > last, s); last = i; }
  ultimulCard(p, '<MesageriaCard to="/profil?mesagerie=1"');
  assert.match(p, /to="\/profesor-virtual\?tab=interactive"/);
  assert.match(p, /to="\/profil\?mesagerie=1"/, 'deschide mesageria grupei din „Contul meu"');
  assert.match(p, /note, plusuri, minusuri, aprecieri/);
  assert.ok(!/pregateste|PregatireCard/i.test(p));
});

test('Home: fără „Părerea ta despre ExamenMate" — recenzia se lasă din „Lasă o recenzie" (sfârșitul paginii) și din „Contul meu"', () => {
  const a = read('src/components/AcasaCont.jsx');
  assert.ok(!/ParereCard|SiteReviewForm|acasa-parere|<b>Părerea ta/.test(a), 'niciun card / formular de recenzie în cardurile din Home');
  assert.ok(!/\.acasa-parere/.test(read('src/styles/global.css')));
  // la sfârșitul Home, pentru toate conturile: „Ce spun elevii, părinții și profesorii" cu „Lasă o recenzie"
  const home = read('src/pages/Home.jsx');
  assert.ok(home.indexOf('<Testimonials limit={6} />') > home.indexOf('<AcasaProfesor />'));
  assert.ok(!/\{[^{}\n]*&& <Testimonials/.test(home), '„Lasă o recenzie" nu depinde de tipul de cont');
  assert.match(read('src/components/ReviewWidget.jsx'), /<Link to="\/recenzii#formular" className="btn btn-primary">Lasă o recenzie<\/Link>/);
  // și în „Contul meu"
  assert.match(read('src/pages/Profile.jsx'), /className="card" id="parere"[\s\S]{0,600}<SiteReviewForm compact \/>/);
});

test('Home: fără <a> în <a> și fără butoane în linkuri (cardurile cu linkuri proprii sunt <div>)', () => {
  const a = read('src/components/AcasaCont.jsx');
  assert.match(a, /if \(!extra\) \{\s*\n\s*return <Link to=\{to\} className="acasa-card"/);
  assert.match(a, /<div className="acasa-card acasa-card-div"[^>]*>\s*\n\s*<Link to=\{to\} className="acasa-card-link" aria-label=\{titlu\} \/>/);
  const css = read('src/styles/global.css');
  // auto-fit: cele 3 carduri ale părintelui umplu rândul (fără loc gol în dreapta)
  assert.match(css, /\.acasa-grid \{ display: grid; grid-template-columns: repeat\(auto-fit, minmax\(250px, 1fr\)\);/);
  assert.match(css, /\.acasa-card-link \{ position: absolute; inset: 0;/);
});

test('Contul meu: asistentul AI rămâne doar la profesori; elevul — „Rezultatele mele" primele, deschise', () => {
  const p = read('src/pages/Profile.jsx');
  const iBanner = p.indexOf('{isTeacher && (\n        <div style={{');
  assert.ok(iBanner > 0, 'bannerul „Asistent AI" doar pentru profesori');
  assert.ok(p.indexOf('Deschide AI Tutor →') > iBanner);
  const iRez = p.indexOf('{!isMentor && <MyResults user={user} defaultOpen />}');
  const iGrid = p.indexOf('<div className="profile-grid">');
  assert.ok(iRez > 0 && iRez < iGrid, 'rezultatele, înaintea restului paginii');
  assert.strictEqual((p.match(/<MyResults /g) || []).length, 1, 'o singură dată');
  assert.match(p, /<details className="card" id="rezultate" style=\{\{ marginBottom: 24 \}\} open=\{defaultOpen \|\| undefined\}>/);
  // meniul și widgetul păstrează „Prof. Virtual"
  assert.match(read('src/lib/meniu.js'), /to: '\/profesor-virtual'/);
});

test('Contul meu: părintele — „Rezultate elev" primele, deschise; caseta de asociere după ele', () => {
  const p = read('src/pages/Profile.jsx');
  const i = p.indexOf('{isParent && (\n          <TeacherResults');
  assert.ok(i > 0 && i < p.indexOf('<div className="profile-grid">'));
  const bloc = p.slice(i, p.indexOf('/>', i));
  assert.match(bloc, /defaultOpen/);
  assert.match(bloc, /invitePos="bottom"/);
  // profesorul: „Grupe / Rezultate elevi" rămân în coloana principală
  assert.match(p, /\{isTeacher && \(\s*\n\s*<TeacherResults[\s\S]{0,300}defaultOpen=\{sectiune === 'rezultate' \|\| sectiune === 'catalog'\}/);
  const tr = read('src/components/TeacherResults.jsx');
  assert.match(tr, /\{invitePos !== 'bottom' && <InviteBox /);
  assert.match(tr, /\{invitePos === 'bottom' && <InviteBox [^>]* jos \/>\}/);
  assert.match(tr, /const \[open, setOpen\] = useState\(!!defaultOpen\);/);
});

test('Home → „Contul meu": fiecare card duce la secțiunea lui (id-uri + derularea din adresă)', () => {
  const p = read('src/pages/Profile.jsx');
  assert.match(p, /const SECTIUNI_DIN_URL = \{ rezultate: \['rezultate', 'rezultate-elevi'\], insigne: \['insigne'\], teme: \['teme'\], asociere: \['invita'\], invita: \['invita'\], parere: \['parere'\]/);
  assert.match(p, /if \(el\.tagName === 'DETAILS'\) el\.open = true;/);
  assert.match(p, /className="card" id="insigne"/);
  assert.match(p, /className="card" id="parere"/);
  assert.match(read('src/components/TemeNefacute.jsx'), /className="card" id="teme"/);
  const tr = read('src/components/TeacherResults.jsx');
  assert.match(tr, /className="card" id="rezultate-elevi"/);
  assert.match(tr, /className="card" id="invita"/);
});
