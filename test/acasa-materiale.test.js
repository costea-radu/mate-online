// =====================================================================
// test/acasa-materiale.test.js — butonul „📚 Materiale" din Home (18 nov. 2026):
//   „pune buton «materiale» în home la elevi sub «pregătește-mă de examen», iar la
//    profesori primul, deasupra de «generează»"
//
// src/components/AcasaCont.jsx (MaterialeCard — primul în grila elevului și a profesorului,
// pe toată lățimea), src/pages/Home.jsx (blocul „Materiale", id="materiale"),
// src/styles/global.css (lățimea cardului, derularea sub bara de sus).
// Rulare: npm test
// =====================================================================
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const bloc = (src, start, end) => {
  const i = src.indexOf(start);
  assert.ok(i >= 0, `lipsește „${start}"`);
  const j = src.indexOf(end, i + start.length);
  return src.slice(i, j < 0 ? undefined : j);
};

test('cardul „📚 Materiale": duce la blocul „Materiale" din Home și derulează până la el', () => {
  const a = read('src/components/AcasaCont.jsx');
  assert.match(a, /<Card to="\/#materiale" icon="📚" titlu="Materiale" sub=\{sub\} accent="#00897b" lat onClick=\{laMateriale\}>/);
  assert.match(a, /\nfunction laMateriale\(\) \{[\s\S]*?document\.getElementById\('materiale'\)\?\.scrollIntoView\(\{ behavior: 'smooth', block: 'start' \}\)/);
  // cardul-link primește clicul (fără <a> în <a>: cardurile cu `extra` rămân <div>)
  assert.match(a, /return <Link to=\{to\} className="acasa-card" id=\{id\} data-lat=\{lat \|\| undefined\} style=\{\{ '--acasa-accent': accent \}\} onClick=\{onClick\}>/);
  // blocul la care duce: examenele, clasele, auxiliarele — la elev și la profesor
  const h = read('src/pages/Home.jsx');
  assert.match(h, /<section className="acasa acasa-mat" id="materiale" aria-label="Materiale">/);
  assert.match(h, /\{\(cont === 'vizitator' \|\| cont === 'elev'\) && <Materiale \/>\}/);
  assert.match(h, /\{\(cont === 'parinte' \|\| cont === 'profesor'\) && <Materiale \/>\}/);
});

test('elevul: „📚 Materiale" chiar sub „🎯 Pregătește-mă de examen" (primul card al contului)', () => {
  const h = read('src/pages/Home.jsx');
  assert.match(h, /\{\(cont === 'vizitator' \|\| cont === 'elev'\) && <PregatireCard \/>\}\n\s*\{cont === 'elev' && <AcasaElev \/>\}/,
    'grila elevului vine imediat după „Pregătește-mă de examen"');
  const elev = bloc(read('src/components/AcasaCont.jsx'), 'export function AcasaElev()', 'export function AcasaParinte()');
  assert.match(elev, /<div className="acasa-grid">\s*\n\s*<MaterialeCard sub="[^"]+" \/>\s*\n\s*<Card to="\/profil\?insigne=1"/,
    'primul în grilă, înaintea insignelor');
  assert.strictEqual((elev.match(/<MaterialeCard /g) || []).length, 1);
});

test('profesorul: „📚 Materiale" primul, deasupra lui „Generează teste"; părintele — fără', () => {
  const a = read('src/components/AcasaCont.jsx');
  const prof = bloc(a, 'export function AcasaProfesor()', '\n}\n');
  assert.match(prof, /<div className="acasa-grid">\s*\n\s*<MaterialeCard sub="[^"]+" \/>\s*\n\s*<Card to="\/profesor-virtual\?tab=interactive" icon="🧩" titlu="Generează teste"/);
  assert.strictEqual((prof.match(/<MaterialeCard /g) || []).length, 1);
  const parinte = bloc(a, 'export function AcasaParinte()', 'export function AcasaProfesor()');
  assert.doesNotMatch(parinte, /MaterialeCard/);
});

test('cardul e pe toată lățimea grilei (deasupra celorlalte), iar „Materiale" nu ajunge sub bara de sus', () => {
  const css = read('src/styles/global.css');
  assert.match(css, /\.acasa-card\[data-lat\] \{ grid-column: 1 \/ -1;/);
  assert.match(css, /#catalog, #materiale \{ scroll-margin-top: 84px; \}/);
  assert.match(css, /\.acasa-mat-ce span \{[^}]*white-space: nowrap;/);
});
