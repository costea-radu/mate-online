// =====================================================================
// api/_lib/capitoleHarta.js — CAPITOLELE „🗺️ Hărții pregătirii" (15 nov. 2026)
//
// Cererea lui Radu: „Hărți cu pictograme, împărțită pe capitole, la fiecare capitol
// mai mulți pași. Dacă adaug PDF cu numele capitolului să îl adauge în plus la
// capitolul din hartă ca un pas în plus."
//
// Fiecare material (exercițiu interactiv sau PDF) primește un CAPITOL după TITLU:
// listele de mai jos au, pe fiecare clasă (a V-a … a VIII-a), la Evaluarea Națională
// și la Bacalaureat (și clasele IX–XII, care au aceleași capitole ca la BAC),
// capitolele în ordinea în care se verifică — cele mai precise întâi („Mulțimea
// numerelor întregi" e la „Numere întregi", nu la „Mulțimi"). Un PDF numit după
// capitol („Numere întregi — fișa 13") intră singur în capitolul lui, ca un pas în plus.
// Regulile sunt cuvinte-cheie pe titlul fără diacritice, verificate pe titlurile reale
// din site (test/harta-capitole.test.js); numele afișat al fiecărui capitol se
// potrivește cu propria regulă (un PDF cu numele capitolului ajunge mereu acolo).
// Ce nu se recunoaște merge la „Alte exerciții" (la clasă) / „Alte capitole" (examen).
//
// Pictograma (`icon`) e o cheie — desenul e în src/lib/pictograme.jsx.
// Fără dependențe, fără bază de date: se folosește din api/_lib/planPregatire.js.
// =====================================================================

// titlul „pliat": litere mici, fără diacritice, spații simple
function fold(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[șş]/g, 's').replace(/[țţ]/g, 't').replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

const C = (id, titlu, icon, re) => ({ id, titlu, icon, re });

// ─── Clasele V–VIII ──────────────────────────────────────────────────────────
const CLASA = {
  5: [
    C('c5-metode', 'Metode aritmetice', 'metode', /\bmetod|reducer\w* la unitate|mersul\w* invers|falsei ipoteze|figurativ/),
    C('c5-zecimale', 'Fracții zecimale', 'zecimale', /zecimal/),
    C('c5-fractii', 'Fracții ordinare', 'fractii', /fracti/),
    C('c5-divizibilitate', 'Divizibilitate', 'divizibilitate', /divizib|divizor|multipl|\bprime\b|criteri/),
    C('c5-geometrie', 'Geometrie și unități de măsură', 'masura', /segment|unghi|dreapt|\bpunct|geometr|unitat\w* de masura|transformar|perimetr|\bari[ei]\b|volum|lungim|figur/),
    C('c5-naturale', 'Numere naturale', 'naturale', /natural|\bnr\.? ?nat|aproxim|rotunj|gauss|factor comun|puter|baza 10|ordinea (efectuarii )?operatiilor|calcul/),
  ],
  6: [
    C('c6-date', 'Statistică și probabilități', 'date', /statistic|probabil|organizarea datelor|grafic|diagram/),
    C('c6-rationale', 'Numere raționale', 'rationale', /\brational|\bin q\b|multimea q\b/),
    C('c6-intregi', 'Numere întregi', 'intregi', /intreg|\bin z\b|multimea z\b|temperatur/),
    C('c6-rapoarte', 'Rapoarte, proporții, procente', 'procent', /procent|propor|raport|regula de (trei|3)|marimi|\bscara/),
    C('c6-multimi', 'Mulțimi și divizibilitate', 'multimi', /multim|cmmdc|cmmmc|divizib|divizor|multipl|factori primi|numere prime/),
    C('c6-triunghi', 'Triunghiul', 'triunghi', /triungh|pitagora|congruent|median|inaltim|isoscel|echilateral|linii importante|ipotenuz/),
    C('c6-cerc', 'Cercul', 'cerc', /cerc|\braza\b|diametr|\barc/),
    C('c6-drepte', 'Unghiuri, paralelism, perpendicularitate', 'unghi', /unghi|paralel|perpendicular|distant|mediatoare|bisect|biesct|simetri|dreapt|segment/),
  ],
  7: [
    C('c7-date', 'Reper cartezian, date și probabilități', 'reper', /reper|cartezian|\baxe\b|coordonat|probabil|statistic|grafic|\bdate(lor)?\b/),
    C('c7-reale', 'Numere reale și radicali', 'radical', /radical|\breal|radacin|x ?(\^ ?2|²) ?=|media geometric|patrat perfect/),
    C('c7-ecuatii', 'Ecuații și sisteme', 'ecuatie', /ecuati|sistem|necunoscut/),
    C('c7-asemanare', 'Asemănarea triunghiurilor', 'asemanare', /thales|asemanar|asemen|\btfa\b|teorema bisectoarei/),
    C('c7-metrice', 'Triunghiul dreptunghic', 'dreptunghic', /triunghi\w* dreptunghic|trigonometr|pitagora|catet|teorema inaltimii|sinus|cosinus/),
    C('c7-cerc', 'Cercul și poligoanele regulate', 'cerc', /cerc|poligoan|\bdisc/),
    C('c7-patrulatere', 'Patrulatere și arii', 'patrulater', /patrulater|paralelogram|dreptunghi(?!c)|romb|patrat|trapez|\bari[ia]\b/),
  ],
  8: [
    C('c8-functii', 'Funcții', 'functie', /functi/),
    C('c8-ecuatia2', 'Ecuația de gradul al II-lea', 'ecuatie', /gradul (al )?(ii|2|doi)/),
    C('c8-intervale', 'Intervale și inecuații', 'interval', /interval|inecuati|modul/),
    C('c8-spatiu', 'Geometrie în spațiu', 'spatiu', /spatiu|\bplan\b|planul|\bplane\b|diedru|proiecti|perpendicular|drepte/),
    C('c8-corpuri', 'Corpuri geometrice: arii și volume', 'cub', /corpur|piramid|\bcon\b|conul|trunchi|cilindr|sfer|prism|paralelipiped|\bcub|volum|sectiun/),
    C('c8-calcul', 'Calcul algebric', 'algebra', /litere|algebric|formule|descompuner|factor comun|expresi|ordinea (efectuarii )?operatiilor|minim|maxim|rapoart|puteri|calcul/),
  ],
};

// ─── Evaluarea Națională (programa claselor V–VIII, pe temele examenului) ────
const EN = [
  C('en-date', 'Statistică, probabilități, logică', 'date', /probabil|statistic|logic|grafic|diagram/),
  C('en-geometrie-plana', 'Geometrie plană (probleme)', 'geometrie', /geometrie plana/),
  C('en-spatiu', 'Geometrie în spațiu și corpuri', 'cub', /spatiu|corpur|piramid|prism|\bcub|cilindr|\bcon\b|sfer|paralelipiped|volum/),
  C('en-cerc', 'Cercul', 'cerc', /cerc|\bdisc/),
  C('en-patrulatere', 'Patrulatere', 'patrulater', /patrulater|paralelogram|romb|trapez|dreptunghi(?!c)|patrat(?! perfect)/),
  C('en-triunghi', 'Triunghiul', 'triunghi', /triungh|pitagora|asemanar|thales/),
  C('en-unghiuri', 'Puncte, drepte, unghiuri', 'unghi', /unghi|segment|dreapt|drepte|\bpunct/),
  C('en-functii', 'Funcții', 'functie', /functi/),
  C('en-ecuatii', 'Ecuații și sisteme', 'ecuatie', /ecuati|sistem/),
  C('en-expresii', 'Expresii și calcul algebric', 'algebra', /expresi|algebric|formule|descompuner|calcul prescurtat/),
  C('en-multimi', 'Mulțimi și intervale', 'interval', /interval|inecuati|multim/),
  C('en-reale', 'Numere reale și radicali', 'radical', /radical|\breal|\bmedi/),
  C('en-rationale', 'Numere raționale și fracții', 'fractii', /\brational|fracti/),
  C('en-intregi', 'Numere întregi', 'intregi', /intreg/),
  C('en-rapoarte', 'Rapoarte, proporții, procente', 'procent', /procent|propor|raport|regula de (trei|3)|marimi/),
  C('en-divizibilitate', 'Divizibilitate', 'divizibilitate', /divizib|impartir\w* cu rest|divizor|multipl/),
  C('en-naturale', 'Numere naturale', 'naturale', /natural|baza 10|puter|\bcifr/),
];

// ─── Bacalaureatul (și clasele IX–XII — aceleași capitole, din subiectele BAC) ─
const BAC = [
  C('bac-integrale', 'Integrale și primitive', 'integrala', /integral|primitiv|clasa a 12|\bcls\.? ?12|analiz\w*.*\b12\b|\bari[ie],? volum/),
  C('bac-analiza', 'Analiză: limite și derivate', 'derivata', /analiz|limit|deriv|asimptot|monoton|convex|tangent|extrem|continuitat/),
  C('bac-matrice', 'Matrice, determinanți, sisteme', 'matrice', /matric|determinant|sistem|cramer/),
  C('bac-legi', 'Legi de compoziție, grupuri, clase de resturi', 'legi', /leg[ei] de compozitie|grupur|clase de resturi|morfism|\binel|\bcorpur/),
  C('bac-polinoame', 'Polinoame', 'polinom', /polino|bezout|viet/),
  C('bac-trigonometrie', 'Trigonometrie', 'trigonometrie', /trigonometr|sinus|cosinus/),
  C('bac-geometrie', 'Vectori și geometrie analitică', 'vector', /vector|geometrie analitic|mijlocul segmentului|distant|ecuatia dreptei|\bpanta/),
  C('bac-combinatorica', 'Combinatorică și binomul lui Newton', 'combinatorica', /numarar|combinar|combinatoric|aranjament|permutar|binom/),
  C('bac-procente', 'Procente și probabilități', 'procent', /procent|probabil|statistic|dobanz/),
  C('bac-ecuatii', 'Ecuații iraționale, exponențiale, logaritmice', 'ecuatie', /ecuati\w* (irational|exponential|logaritmic|cu radical)|irational/),
  C('bac-radicali', 'Radicali, puteri, logaritmi', 'radical', /radical|logaritm|puter|exponent/),
  C('bac-complexe', 'Numere complexe', 'complex', /complex/),
  C('bac-progresii', 'Progresii', 'progresie', /progresi|\bsiruri\b/),
  C('bac-functii', 'Funcția de gradul I și II', 'functie', /functi|parabol/),
  C('bac-multimi', 'Mulțimi', 'multimi', /multim|logic/),
  C('bac-numere', 'Fracții, medii, partea întreagă', 'fractii', /fracti|\bmedi|partea intreaga|intreag|modul/),
];

const ALTE = { id: 'alte', icon: 'alte' };

// Lista de capitole pentru categoria unui material din site
function listaPentru(category) {
  const c = String(category || '');
  if (c === 'evaluare-nationala') return EN;
  if (c === 'bacalaureat') return BAC;
  const m = /^clasa-(\d{1,2})$/.exec(c);
  if (!m) return [];
  const g = Number(m[1]);
  if (CLASA[g]) return CLASA[g];
  return g >= 9 && g <= 12 ? BAC : [];
}

// Capitolul unui titlu (în categoria dată) → { id, titlu, icon } sau null
function capitolDin(titlu, category) {
  const t = fold(titlu);
  if (!t) return null;
  const lista = listaPentru(category);
  let gasit = null;
  for (const c of lista) { if (c.re.test(t)) { gasit = c; break; } }
  if (!gasit) return null;
  // la clasa a XII-a, „analiza" înseamnă integralele (la a XI-a — limitele și derivatele)
  if (category === 'clasa-12' && gasit.id === 'bac-analiza') gasit = BAC.find((x) => x.id === 'bac-integrale');
  return { id: gasit.id, titlu: gasit.titlu, icon: gasit.icon };
}

// „Subiectul I / al II-lea / al III-lea" din titlu → 1 | 2 | 3 | null
function subiectDin(titlu) {
  const t = fold(titlu);
  const m = t.match(/subiect\w*\s*(?:al\s*)?(iii|ii|i|[123])\b/);
  if (!m) return null;
  return { i: 1, ii: 2, iii: 3, 1: 1, 2: 2, 3: 3 }[m[1]] || null;
}
const SUBIECT_TITLU = { 1: 'Subiectul I', 2: 'Subiectul al II-lea', 3: 'Subiectul al III-lea' };

// Anul unui subiect de examen (din titlu sau din numele fișierului): „2026 simulare
// Iași", „Evaluare Națională 2025 — …", „ENVIII_Matematica_2024_var_07_LRO.pdf"
function anDin(titlu, fileUrl = '') {
  for (const src of [titlu, String(fileUrl || '').split('/').pop()]) {
    const t = fold(src).replace(/[_.]/g, ' ');
    const scolar = t.match(/\b((?:19|20)\d{2})\s*[/-]\s*((?:19|20)\d{2})\b/);
    if (scolar && Number(scolar[2]) === Number(scolar[1]) + 1) return scolar[2];
    const m = t.match(/\b(?:19|20)\d{2}\b/);
    if (m) return m[0];
  }
  return null;
}

module.exports = {
  fold, listaPentru, capitolDin, subiectDin, anDin,
  SUBIECT_TITLU, ALTE, CLASA, EN, BAC,
};
