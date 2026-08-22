// Teste pentru asocierea test ↔ barem (node --test, fără dependențe):
// Evaluarea Națională trebuie să primească baremul la fel ca Bacalaureatul —
// după titlu, an, numele fișierului, ANTETUL PDF-urilor și conținut — iar
// grilele de la EN (Subiectul I/II) se explică pe litera oficială din tabel.
const test = require('node:test');
const assert = require('node:assert');
const B = require('../api/_lib/barem');
const { chooseBarem } = require('../api/ai-pdf-context');
const ai = require('../api/_lib/ai');

// ─── Texte PDF realiste (așa cum ies din pageRenderer) ───────────────────────
const EN_TEST_2024_V7 = `Ministerul Educației
Centrul Național de Politici și Evaluare în Educație
Evaluarea Națională pentru absolvenții clasei a VIII-a
Anul școlar 2023 – 2024
Matematică
Varianta 7
• Toate subiectele sunt obligatorii. Se acordă zece puncte din oficiu.
• Timpul de lucru efectiv este de două ore.
SUBIECTUL I
Încercuiește litera corespunzătoare răspunsului corect. (30 de puncte)
5p 1. Rezultatul calculului 12 + 3 · 4 este egal cu:
a) 24 b) 60 c) 48 d) 36
5p 2. Dintre numerele 0,75; 0,8; 0,72 și 0,705, cel mai mare este:
a) 0,75 b) 0,8 c) 0,72 d) 0,705
5p 3. Numărul natural de forma \\overline{ab} care verifică relația 3 · \\overline{ab} = 141 este:
a) 41 b) 47 c) 43 d) 49
5p 4. Media aritmetică a numerelor 17 și 31 este egală cu:
a) 22 b) 24 c) 25 d) 26
5p 5. Un elev a citit 45% dintr-o carte de 280 de pagini. Numărul paginilor citite este:
a) 126 b) 130 c) 116 d) 136
5p 6. Mulțimea soluțiilor ecuației 2x − 7 = 13 este:
a) {3} b) {10} c) {13} d) {-3}
Probă scrisă la matematică Varianta 7
Pagina 1 din 4
SUBIECTUL al II-lea
Încercuiește litera corespunzătoare răspunsului corect. (30 de puncte)
5p 1. În figura 1, punctele A, B și C sunt coliniare, AB = 14 cm și AC = 38 cm. Lungimea segmentului BC este:
a) 52 cm b) 24 cm c) 26 cm d) 28 cm
5p 2. În figura 2 este reprezentat un triunghi echilateral cu perimetrul de 54 cm. Lungimea unei laturi este:
a) 18 cm b) 27 cm c) 16 cm d) 12 cm
5p 3. Aria unui pătrat cu latura de 11 cm este:
a) 44 cm² b) 121 cm² c) 110 cm² d) 111 cm²
5p 4. Un cub are muchia de 3 cm. Volumul cubului este:
a) 9 cm³ b) 18 cm³ c) 27 cm³ d) 81 cm³
5p 5. Măsura unghiului complementar unghiului de 37° este:
a) 53° b) 63° c) 143° d) 133°
5p 6. Lungimea diagonalei unui dreptunghi cu dimensiunile de 15 cm și 20 cm este:
a) 35 cm b) 30 cm c) 25 cm d) 28 cm
Probă scrisă la matematică Varianta 7
Pagina 2 din 4
SUBIECTUL al III-lea
Scrieți rezolvările complete. (30 de puncte)
5p 1. Figura 5 este schița unui teren dreptunghiular ABCD, cu AB = 120 m și BC = 75 m.
(2p) a) Arătați că perimetrul terenului este egal cu 390 m.
(3p) b) Determinați aria terenului, exprimată în hectare.
5p 2. Un magazin a vândut 360 de produse în două zile. În a doua zi a vândut cu 25% mai multe produse decât în prima zi.
(2p) a) Arătați că în prima zi s-au vândut 160 de produse.
(3p) b) Determinați câte produse s-au vândut în a doua zi.
5p 3. Se consideră expresia E(x) = (x + 4)² − (x − 3)(x + 3) − 8x, unde x este număr real.
(2p) a) Arătați că E(1) = 25.
(3p) b) Demonstrați că E(x) = 25, pentru orice număr real x.
5p 4. În figura 6, ABCD este un pătrat cu AB = 18 cm, iar M este mijlocul laturii CD.
(2p) a) Arătați că AM = 9√5 cm.
(3p) b) Calculați aria triunghiului ABM.
5p 5. Un rezervor în formă de paralelipiped dreptunghic are dimensiunile de 240 cm, 150 cm și 95 cm.
(2p) a) Arătați că volumul rezervorului este egal cu 3420 dm³.
(3p) b) În rezervor se toarnă 1710 litri de apă. Determinați înălțimea apei.
5p 6. Piramida patrulateră regulată VABCD are baza cu latura de 36 cm și apotema de 30 cm.
(2p) a) Arătați că înălțimea piramidei este egală cu 24 cm.
(3p) b) Determinați aria laterală a piramidei.
Probă scrisă la matematică Varianta 7
Pagina 4 din 4`;

const EN_BAREM_2024_V7 = `Ministerul Educației
Centrul Național de Politici și Evaluare în Educație
Evaluarea Națională pentru absolvenții clasei a VIII-a
Anul școlar 2023 – 2024
Matematică
BAREM DE EVALUARE ȘI DE NOTARE
Varianta 7
• Se acordă zece puncte din oficiu. Nota finală se calculează prin împărțirea la zece a punctajului total acordat pentru lucrare.
SUBIECTUL I (30 de puncte)
Se punctează doar rezultatul, astfel: pentru fiecare răspuns se acordă fie 5 puncte, fie 0 puncte.
Nu se acordă punctaje intermediare.
Nr. item 1. 2. 3. 4. 5. 6.
Rezultate a. b. b. b. a. b.
Punctaj 5p. 5p. 5p. 5p. 5p. 5p.
SUBIECTUL al II-lea (30 de puncte)
Se punctează doar rezultatul, astfel: pentru fiecare răspuns se acordă fie 5 puncte, fie 0 puncte.
Nu se acordă punctaje intermediare.
Nr. item 1. 2. 3. 4. 5. 6.
Rezultate b. a. b. c. a. c.
Punctaj 5p. 5p. 5p. 5p. 5p. 5p.
SUBIECTUL al III-lea (30 de puncte)
Pentru orice soluție corectă, chiar dacă este diferită de cea din barem, se acordă punctajul corespunzător.
1. a) P = 2(AB + BC) = 2(120 + 75) = 390 m 2p
b) A = AB · BC = 120 · 75 = 9000 m² 2p
9000 m² = 0,9 ha 1p
2. a) Notăm cu x numărul produselor vândute în prima zi; x + 125x/100 = 360 1p
x = 160 de produse 1p
b) 360 − 160 = 200 de produse 3p
3. a) E(1) = 25 − (−2) · 4 − 8 = 25 2p
b) E(x) = x² + 8x + 16 − x² + 9 − 8x = 25 3p
4. a) DM = 9 cm, AM² = AD² + DM² = 324 + 81 = 405, AM = 9√5 cm 2p
b) A(ABM) = AB · AD / 2 = 18 · 18 / 2 = 162 cm² 3p
5. a) V = 240 · 150 · 95 = 3420000 cm³ = 3420 dm³ 2p
b) 1710 litri = 1710 dm³; h = 1710 / (24 · 15) = 4,75 dm = 47,5 cm 3p
6. a) h² = 30² − 18² = 900 − 324 = 576, h = 24 cm 2p
b) A_l = P_b · a_p / 2 = 144 · 30 / 2 = 2160 cm² 3p
Probă scrisă la matematică Varianta 7
Barem de evaluare și de notare
Pagina 2 din 2`;

// altă variantă din același an — alte probleme la Subiectul al III-lea
const EN_BAREM_2024_V2 = EN_BAREM_2024_V7
  .replace(/Varianta 7/g, 'Varianta 2')
  .replace(/Rezultate a\. b\. b\. b\. a\. b\./, 'Rezultate c. d. a. c. b. d.')
  .replace(/SUBIECTUL al III-lea[\s\S]*?(?=Probă scrisă)/, `SUBIECTUL al III-lea (30 de puncte)
Pentru orice soluție corectă, chiar dacă este diferită de cea din barem, se acordă punctajul corespunzător.
1. a) Prețul inițial este 850 de lei; 850 · 12/100 = 102 lei reducerea 2p
b) 850 − 102 = 748 de lei 3p
2. a) Notăm cu n numărul elevilor; n = 28 2p
b) 28 · 45 = 1260 de lei 3p
3. a) E(2) = 64 − 49 = 15 1p
15 = 15, deci E(2) = 15 1p
b) E(x) = (x − 1)(x + 11) 3p
4. a) Triunghiul AOB este echilateral, AB = 14 cm 2p
b) A = 49√3 cm² 3p
5. a) V = 18 · 18 · 40 = 12960 cm³ 2p
b) A_t = 2 · 324 + 4 · 720 = 3528 cm² 3p
6. a) l = 26 cm, apotema = 13√3 cm 2p
b) A_l = 52 · 13√3 / 2 = 338√3 cm² 3p
`);
const EN_BAREM_2023_V1 = EN_BAREM_2024_V2.replace(/2023 – 2024/g, '2022 – 2023').replace(/Varianta 2/g, 'Varianta 1');
const EN_BAREM_MODEL_2024 = EN_BAREM_2024_V2.replace(/Varianta 2/g, 'Model');
const EN_BAREM_SIMULARE_2024 = EN_BAREM_2024_V2.replace(/Varianta 2/g, 'Simulare');

const BAC_TEST_2024_V5 = `Ministerul Educației
Centrul Național de Politici și Evaluare în Educație
Examenul național de bacalaureat 2024
Proba E. c)
Matematică M_mate-info
Varianta 5
Filiera teoretică, profilul real, specializarea matematică-informatică
• Toate subiectele sunt obligatorii. Se acordă zece puncte din oficiu.
• Timpul de lucru efectiv este de trei ore.
SUBIECTUL I (30 de puncte)
5p 1. Arătați că numărul a = (1 + 2i)(1 − 2i) − 5 este egal cu 0.
5p 2. Se consideră funcția f : R → R, f(x) = x² − 6x + 10. Determinați valoarea minimă a funcției f.
5p 3. Rezolvați în mulțimea numerelor reale ecuația log₂(x + 14) = 4.
5p 4. Calculați probabilitatea ca, alegând un număr din mulțimea numerelor naturale de două cifre, acesta să fie divizibil cu 11.
5p 5. În reperul cartezian xOy se consideră punctele A(2, 1), B(6, 3) și C(4, 7). Determinați ecuația medianei din C.
5p 6. Arătați că sin 120° + cos 150° = 0.
SUBIECTUL al II-lea (30 de puncte)
1. Se consideră matricea A(a) = ( 1 a ; 0 1 ), unde a este număr real.
5p a) Arătați că det(A(3)) = 1.
5p b) Demonstrați că A(a)A(b) = A(a + b), pentru orice numere reale a și b.
5p c) Determinați numărul real x pentru care A(x)A(2x) = A(27).
2. Pe mulțimea numerelor reale se definește legea de compoziție x ∘ y = xy − 4x − 4y + 20.
5p a) Arătați că x ∘ y = (x − 4)(y − 4) + 4, pentru orice numere reale x și y.
5p b) Determinați elementul neutru al legii de compoziție „∘".
5p c) Determinați numerele reale x pentru care x ∘ x = 29.
SUBIECTUL al III-lea (30 de puncte)
1. Se consideră funcția f : R → R, f(x) = x³ − 12x + 16.
5p a) Arătați că f'(x) = 3(x − 2)(x + 2), pentru orice x real.
5p b) Determinați ecuația tangentei la graficul funcției f în punctul de abscisă x = 1.
5p c) Demonstrați că f(x) ≥ 0, pentru orice x ≥ −4.
2. Se consideră funcția f : R → R, f(x) = x² + 3x + 2.
5p a) Arătați că ∫₀¹ f(x) dx = 23/6.
5p b) Calculați ∫₁² (f(x) − x²) / x dx.
5p c) Determinați numărul real m > 0 pentru care aria suprafeței este 44/3.
Probă scrisă la matematică M_mate-info Varianta 5
Pagina 1 din 2`;

const BAC_BAREM_2024_V5 = `Ministerul Educației
Centrul Național de Politici și Evaluare în Educație
Examenul național de bacalaureat 2024
Proba E. c)
Matematică M_mate-info
BAREM DE EVALUARE ȘI DE NOTARE
Varianta 5
Filiera teoretică, profilul real, specializarea matematică-informatică
• Pentru orice soluție corectă, chiar dacă este diferită de cea din barem, se acordă punctajul corespunzător.
• Se acordă zece puncte din oficiu.
SUBIECTUL I (30 de puncte)
1. a = 1 − 4i² − 5 = 1 + 4 − 5 = 0 5p
2. f(x) = (x − 3)² + 1 ≥ 1, deci valoarea minimă este 1 3p
3. x + 14 = 16, x = 2 5p
4. Sunt 90 de numere naturale de două cifre, dintre care 9 sunt divizibile cu 11, p = 9/90 = 1/10 5p
5. Mijlocul lui AB este M(4, 2); ecuația: x = 4 5p
6. sin 120° = √3/2, cos 150° = −√3/2, suma este 0 5p
SUBIECTUL al II-lea (30 de puncte)
1. a) det(A(3)) = 1 · 1 − 3 · 0 = 1 5p
b) A(a)A(b) = ( 1 a+b ; 0 1 ) = A(a + b) 5p
c) A(x)A(2x) = A(3x) = A(27), deci x = 9 5p
2. a) (x − 4)(y − 4) + 4 = xy − 4x − 4y + 16 + 4 = x ∘ y 5p
b) e = 5 5p
c) (x − 4)² = 25, x = 9 sau x = −1 5p
SUBIECTUL al III-lea (30 de puncte)
1. a) f'(x) = 3x² − 12 = 3(x − 2)(x + 2) 5p
b) f(1) = 5, f'(1) = −9; y = −9x + 14 5p
c) f(x) = (x − 2)²(x + 4) ≥ 0 pentru x ≥ −4 5p
2. a) ∫₀¹ (x² + 3x + 2) dx = 1/3 + 3/2 + 2 = 23/6 5p
b) ∫₁² (3 + 2/x) dx = 3 + 2 ln 2 5p
c) m³/3 + 3m²/2 + 2m = 44/3, m = 2 5p
Probă scrisă la matematică M_mate-info Varianta 5
Barem de evaluare și de notare
Pagina 1 din 2`;

const row = (id, title, file, extra = {}) => ({ id, title, file_url: `https://x.supabase.co/storage/v1/object/public/content-files-free/1723456789012_${file}`, content_type: 'pdf', category: 'evaluare-nationala', is_free: true, ...extra });

// ─── Amprente din titlu + nume de fișier ─────────────────────────────────────
test('tokens: numele oficiale EN (var/bar, Test/Bar, model, simulare) se citesc corect', () => {
  const t = B.tokensOf(row(1, 'Evaluare Națională 2024', 'ENVIII_Matematica_2024_var_07_LRO.pdf'));
  assert.deepStrictEqual([t.year, t.variant, t.kind, t.flags, t.profile], ['2024', '7', 'varianta', '', null]);
  const b = B.tokensOf(row(2, 'Barem EN 2024', 'ENVIII_Matematica_2024_bar_07_LRO.pdf'));
  assert.deepStrictEqual([b.year, b.variant, b.kind, b.flags], ['2024', '7', null, '']);
  const a = B.tokensOf(row(3, 'Test de antrenament 3 (2022)', 'EN_VIII_Matematica_2022_Test_03.pdf'));
  assert.deepStrictEqual([a.year, a.variant, a.kind], ['2022', '3', 'test']);
  const m = B.tokensOf(row(4, 'Model EN', 'EN_VIII_Matematica_2024_var_model.pdf'));
  assert.deepStrictEqual([m.year, m.variant, m.flags], ['2024', null, 'model']);
  const s = B.tokensOf(row(5, 'Simulare 2', 'EN-VIII-2026-Matematica-Var-Simulare-2-EDU.pdf'));
  assert.deepStrictEqual([s.year, s.variant, s.flags], ['2026', '2', 'simulare']);
});

test('tokens: anul școlar „2023-2024" înseamnă examenul din 2024; EN nu are profil', () => {
  const t = B.tokensOf(row(1, 'EN 2023-2024 matematică', 'en.pdf', { profile: 'mate-info' }));
  assert.strictEqual(t.year, '2024');
  assert.strictEqual(t.profile, null);
  assert.strictEqual(B.tokensOf({ ...row(2, 'Varianta 5', 'v5.pdf'), category: 'bacalaureat', profile: 'mate-info' }).profile, 'mate-info');
});

test('matchBarem: titluri doar cu anul + nume oficiale → baremul anului, nu modelul/simularea', () => {
  const subj = row(1, 'Evaluare Națională 2024', 'ENVIII_Matematica_2024_var_07_LRO.pdf');
  const cands = [
    subj,
    row(2, 'Barem EN 2024', 'ENVIII_Matematica_2024_bar_07_LRO.pdf', { subcategory: 'bareme' }),
    row(3, 'Barem EN 2023', 'ENVIII_Matematica_2023_bar_01_LRO.pdf', { subcategory: 'bareme' }),
    row(4, 'Barem model EN 2024', 'EN_VIII_Matematica_2024_bar_model.pdf', { subcategory: 'bareme' }),
    row(5, 'Barem simulare EN 2024', 'EN_VIII_Matematica_2024_bar_simulare_LRO.pdf', { subcategory: 'bareme' }),
  ];
  const m = B.matchBarem(subj, cands);
  assert.strictEqual(m.status, 'ok');
  assert.strictEqual(m.barem.id, 2);
});

test('matchBarem: test de antrenament „Test_02" vs barem „Bar_02" se potrivesc (baremul nu știe felul)', () => {
  const subj = row(1, 'Test 2', 'EN_VIII_Matematica_2022_Test_02.pdf');
  const m = B.matchBarem(subj, [subj, row(2, 'Barem test 2', 'EN_VIII_Matematica_2022_Bar_02.pdf')]);
  assert.strictEqual(m.status, 'ok');
  // dar „Varianta 2" ≠ „Test 2" când ambele sunt cunoscute
  assert.strictEqual(B.matchBarem(subj, [row(3, 'Barem varianta 2 2022', 'bar.pdf')]).status, 'negasit');
});

// ─── Amprenta din ANTETUL PDF ────────────────────────────────────────────────
test('docTokens: antetul EN (an școlar, varianta, subsol) și BAC (an, profil, varianta)', () => {
  const en = B.docTokens(EN_TEST_2024_V7);
  assert.deepStrictEqual([en.exam, en.year, en.variant, en.kind, en.flags, en.profile, en.isBarem], ['en', '2024', '7', 'varianta', '', null, false]);
  const enb = B.docTokens(EN_BAREM_2024_V7);
  assert.deepStrictEqual([enb.exam, enb.year, enb.variant, enb.isBarem], ['en', '2024', '7', true]);
  assert.strictEqual(B.docTokens(EN_BAREM_MODEL_2024).flags, 'model');
  assert.strictEqual(B.docTokens(EN_BAREM_MODEL_2024).variant, null);
  assert.strictEqual(B.docTokens(EN_BAREM_SIMULARE_2024).flags, 'simulare');
  const bac = B.docTokens(BAC_TEST_2024_V5);
  assert.deepStrictEqual([bac.exam, bac.year, bac.variant, bac.profile], ['bac', '2024', '5', 'mate-info']);
  assert.strictEqual(B.docTokens(BAC_BAREM_2024_V5).isBarem, true);
  assert.strictEqual(B.docTokens('text scurt'), null);
  // „Testul 3" din antetul testelor de antrenament
  const tr = B.docTokens(EN_TEST_2024_V7.replace(/Varianta 7/g, 'Testul 3').replace('2023 – 2024', '2021 – 2022'));
  assert.deepStrictEqual([tr.year, tr.variant, tr.kind], ['2022', '3', 'test']);
});

test('docsCompatible: același an + aceeași variantă = match; altă variantă / model ↔ variantă = contradicție', () => {
  const t = B.docTokens(EN_TEST_2024_V7);
  assert.strictEqual(B.docsCompatible(t, B.docTokens(EN_BAREM_2024_V7)), 'match');
  assert.strictEqual(B.docsCompatible(t, B.docTokens(EN_BAREM_2024_V2)), 'contradiction');
  assert.strictEqual(B.docsCompatible(t, B.docTokens(EN_BAREM_2023_V1)), 'contradiction');
  assert.strictEqual(B.docsCompatible(t, B.docTokens(EN_BAREM_MODEL_2024)), 'contradiction');
  assert.strictEqual(B.docsCompatible(B.docTokens(EN_BAREM_SIMULARE_2024), B.docTokens(EN_BAREM_MODEL_2024)), 'contradiction');
  assert.strictEqual(B.docsCompatible(t, null), 'unknown');
  // simulare ↔ simulare din același an = match (fără număr de variantă)
  const s1 = B.docTokens(EN_TEST_2024_V7.replace(/Varianta 7/g, 'Simulare'));
  assert.strictEqual(B.docsCompatible(s1, B.docTokens(EN_BAREM_SIMULARE_2024)), 'match');
  // BAC: alt profil = contradicție
  const bac = B.docTokens(BAC_TEST_2024_V5);
  assert.strictEqual(B.docsCompatible(bac, B.docTokens(BAC_BAREM_2024_V5)), 'match');
  assert.strictEqual(B.docsCompatible(bac, B.docTokens(BAC_BAREM_2024_V5.replace(/M_mate-info/g, 'M_st-nat').replace(/matematică-informatică/g, 'științe ale naturii'))), 'contradiction');
});

// ─── Scorul de conținut la EN (Subiectul al III-lea) ─────────────────────────
test('contentMatchScore EN: baremul corect trece pragul, baremul altei variante nu (bug-ul „niciun barem la EN")', () => {
  const okAll = B.contentMatchScore(EN_TEST_2024_V7, EN_BAREM_2024_V7);           // pe tot testul (ca înainte)
  const okEN = B.contentMatchScore(EN_TEST_2024_V7, EN_BAREM_2024_V7, { exam: 'en' });
  const badEN = B.contentMatchScore(EN_TEST_2024_V7, EN_BAREM_2024_V2, { exam: 'en' });
  assert.ok(okEN >= 0.5, `scorul EN corect e mic: ${okEN}`);
  assert.ok(okEN > okAll, 'focalizarea pe Subiectul III trebuie să ridice scorul baremului corect');
  assert.ok(badEN < 0.35, `baremul greșit are scor prea mare: ${badEN}`);
  // BAC: scorul clasic rămâne mare la baremul corect
  assert.ok(B.contentMatchScore(BAC_TEST_2024_V5, BAC_BAREM_2024_V5, { exam: 'bac' }) >= 0.5);
  assert.strictEqual(B.contentMatchScore('prea putine numere 12 13', 'x'), null);
});

// ─── Decizia completă (chooseBarem) cu candidați falși ───────────────────────
function candidates() {
  return [
    row(2, 'Barem EN 2024', 'barem-en-2024.pdf', { subcategory: 'bareme' }),
    row(3, 'Barem EN 2023', 'barem-en-2023.pdf', { subcategory: 'bareme' }),
    row(4, 'Barem model EN 2024', 'barem-model-2024.pdf', { subcategory: 'bareme' }),
    row(5, 'Barem simulare EN 2024', 'barem-simulare-2024.pdf', { subcategory: 'bareme' }),
    row(6, 'Evaluare Națională 2023', 'en-2023.pdf', { subcategory: 'variante' }),
  ];
}
const TEXTS = { 2: EN_BAREM_2024_V7, 3: EN_BAREM_2023_V1, 4: EN_BAREM_MODEL_2024, 5: EN_BAREM_SIMULARE_2024, 6: EN_TEST_2024_V7 };
const reader = (texts, reads = []) => async (c) => { reads.push(c.id); return texts[c.id] || ''; };
const quiet = () => {};

test('chooseBarem: titluri DOAR cu anul (fără variantă, fișiere redenumite) → baremul anului, confirmat de antet', async () => {
  const subj = row(1, 'Evaluare Națională 2024', 'en-2024.pdf', { subcategory: 'variante' });
  const reads = [];
  const r = await chooseBarem({ content: subj, subjectText: EN_TEST_2024_V7, candidates: [subj, ...candidates()], readText: reader(TEXTS, reads), log: quiet });
  assert.strictEqual(r.status, 'ok');
  assert.strictEqual(r.barem.id, 2);
  assert.strictEqual(r.barem.matchedBy, 'metadate+antet');
  assert.match(r.barem.evidence, /an 2024 · varianta 7/);
  assert.strictEqual(r.text, EN_BAREM_2024_V7);
  assert.deepStrictEqual(reads, [2]); // un singur PDF descărcat
});

test('chooseBarem: baremul cu titlul „potrivit" dar cu ALT conținut (altă variantă) e respins; se alege cel care spune același lucru în antet', async () => {
  const subj = row(1, 'Evaluare Națională 2024', 'en-2024.pdf', { subcategory: 'variante' });
  const cands = [subj, ...candidates(), row(7, 'Barem EN 2024 (2)', 'barem-en-2024-2.pdf', { subcategory: 'bareme' })];
  // id 2 conține de fapt varianta 2; id 7 conține varianta 7
  const texts = { ...TEXTS, 2: EN_BAREM_2024_V2, 7: EN_BAREM_2024_V7 };
  const r = await chooseBarem({ content: subj, subjectText: EN_TEST_2024_V7, candidates: cands, readText: reader(texts), log: quiet });
  assert.strictEqual(r.status, 'ok_antet');
  assert.strictEqual(r.barem.id, 7);
  assert.strictEqual(r.barem.matchedBy, 'antet');
});

test('chooseBarem: niciun barem potrivit → null (mai bine niciunul decât unul greșit)', async () => {
  const subj = row(1, 'Evaluare Națională 2024', 'en-2024.pdf', { subcategory: 'variante' });
  const texts = { ...TEXTS, 2: EN_BAREM_2024_V2 }; // singurul barem „2024" e al altei variante
  const r = await chooseBarem({ content: subj, subjectText: EN_TEST_2024_V7, candidates: [subj, ...candidates()], readText: reader(texts), log: quiet });
  assert.strictEqual(r.barem, null);
  assert.strictEqual(r.status, 'continut_diferit');
});

test('chooseBarem: test de antrenament „Test_02" cu două bareme „Bar_02" (testul 2 și varianta 2) → antetul decide', async () => {
  const subj = row(1, 'Test de antrenament 2', 'EN_VIII_Matematica_2022_Test_02.pdf', { subcategory: 'variante' });
  const c1 = row(2, 'Barem 2', 'EN_VIII_Matematica_2022_Bar_02.pdf', { subcategory: 'bareme' });
  const c2 = row(3, 'Barem 2 (1)', 'EN_VIII_Matematica_2022_Bar_02-1.pdf', { subcategory: 'bareme' });
  const tTest = EN_TEST_2024_V7.replace(/Varianta 7/g, 'Testul 2').replace('2023 – 2024', '2021 – 2022');
  const bTest = EN_BAREM_2024_V7.replace(/Varianta 7/g, 'Testul 2').replace('2023 – 2024', '2021 – 2022');
  const bVar = EN_BAREM_2024_V2.replace('2023 – 2024', '2021 – 2022');
  assert.strictEqual(B.matchBarem(subj, [subj, c1, c2]).status, 'ambiguu');
  const r = await chooseBarem({ content: subj, subjectText: tTest, candidates: [subj, c1, c2], readText: reader({ 2: bVar, 3: bTest }), log: quiet });
  assert.strictEqual(r.barem.id, 3);
  assert.strictEqual(r.status, 'ok_antet');
});

test('chooseBarem: BAC cu nume oficiale — comportamentul de până acum (metadate + conținut)', async () => {
  const bacRow = (id, title, file) => ({ ...row(id, title, file, { subcategory: id === 1 ? 'variante' : 'bareme' }), category: 'bacalaureat', profile: 'mate-info' });
  const subj = bacRow(1, 'Varianta 5', 'E_c_matematica_M_mate-info_2024_var_05_LRO.pdf');
  const c1 = bacRow(2, 'Barem varianta 5', 'E_c_matematica_M_mate-info_2024_bar_05_LRO.pdf');
  const c2 = bacRow(3, 'Barem varianta 6', 'E_c_matematica_M_mate-info_2024_bar_06_LRO.pdf');
  const r = await chooseBarem({ content: subj, subjectText: BAC_TEST_2024_V5, candidates: [subj, c1, c2], readText: reader({ 2: BAC_BAREM_2024_V5, 3: BAC_BAREM_2024_V5.replace(/Varianta 5/g, 'Varianta 6') }), log: quiet });
  assert.strictEqual(r.barem.id, 2);
  assert.strictEqual(r.status, 'ok');
});

test('chooseBarem: test scanat (fără text) → potrivirea strictă pe metadate rămâne valabilă', async () => {
  const subj = row(1, 'Evaluare Națională 2024', 'ENVIII_Matematica_2024_var_07_LRO.pdf', { subcategory: 'variante' });
  const cands = [subj, ...candidates(), row(8, 'Barem EN 2024 varianta 7', 'ENVIII_Matematica_2024_bar_07_LRO.pdf', { subcategory: 'bareme' })];
  const r = await chooseBarem({ content: subj, subjectText: '', candidates: cands, readText: reader({ ...TEXTS, 8: EN_BAREM_2024_V7 }), log: quiet });
  assert.strictEqual(r.barem && r.barem.id, 8);
  assert.strictEqual(r.barem.matchedBy, 'metadate+antet'); // antetul baremului confirmă varianta 7 din numele testului
  // baremul potrivit doar pe an (fără variantă cunoscută) NU se acceptă orbește la un test scanat cu varianta în nume
  const r2 = await chooseBarem({ content: subj, subjectText: '', candidates: [subj, ...candidates()], readText: reader(TEXTS), log: quiet });
  assert.strictEqual(r2.barem, null);
});

test('chooseBarem: două simulări în același an → conținutul (Subiectul III) decide; la egalitate refuză', async () => {
  const subj = row(1, 'Simulare EN 2024 (martie)', 'sim-martie.pdf', { subcategory: 'simulari' });
  const c1 = row(2, 'Barem simulare EN 2024 martie', 'bar-sim-martie.pdf', { subcategory: 'bareme' });
  const c2 = row(3, 'Barem simulare EN 2024 mai', 'bar-sim-mai.pdf', { subcategory: 'bareme' });
  const sTest = EN_TEST_2024_V7.replace(/Varianta 7/g, 'Simulare');
  const good = EN_BAREM_SIMULARE_2024.replace(/Simulare/g, 'Simulare'); // (varianta 2 renumerotată) → numere diferite
  const right = EN_BAREM_2024_V7.replace(/Varianta 7/g, 'Simulare');
  const r = await chooseBarem({ content: subj, subjectText: sTest, candidates: [subj, c1, c2], readText: reader({ 2: right, 3: good }), log: quiet });
  assert.strictEqual(r.barem.id, 2);
  assert.strictEqual(r.status, 'ok_continut');
  // ambele bareme identice pe conținut → ambiguu, fără barem
  const r2 = await chooseBarem({ content: subj, subjectText: sTest, candidates: [subj, c1, c2], readText: reader({ 2: right, 3: right }), log: quiet });
  assert.strictEqual(r2.barem, null);
  assert.strictEqual(r2.status, 'ambiguu');
});

// ─── Baremul inclus în același PDF (simulări județene) ───────────────────────
test('splitEmbeddedBarem: „subiecte + barem" într-un singur PDF se despart; un barem simplu nu se taie', () => {
  const combined = `${EN_TEST_2024_V7}\nBAREM DE EVALUARE ȘI DE NOTARE\n${EN_BAREM_2024_V7.split('\n').slice(6).join('\n')}`;
  const s = B.splitEmbeddedBarem(combined);
  assert.ok(s, 'trebuie despărțit');
  assert.ok(s.test.includes('Piramida patrulateră') && !s.test.includes('Rezultate a. b.'));
  assert.ok(s.barem.startsWith('BAREM DE EVALUARE') && s.barem.includes('Rezultate a. b.'));
  assert.strictEqual(B.splitEmbeddedBarem(EN_BAREM_2024_V7), null);
  assert.strictEqual(B.splitEmbeddedBarem(EN_TEST_2024_V7), null);
});

// ─── Grilele EN: litera oficială din tabel, localizată determinist ───────────
test('grilaAnswers: tabelul „Nr. item / Rezultate / Punctaj" (orizontal) și forma verticală', () => {
  const g = B.grilaAnswers(EN_BAREM_2024_V7);
  assert.deepStrictEqual(g.I, { 1: 'a', 2: 'b', 3: 'b', 4: 'b', 5: 'a', 6: 'b' });
  assert.deepStrictEqual(g.II, { 1: 'b', 2: 'a', 3: 'b', 4: 'c', 5: 'a', 6: 'c' });
  const vertical = 'SUBIECTUL I\n1. c. 5p\n2. d) 5p\n3. a. 5p\n4. b. 5p\nSUBIECTUL al II-lea\n1. b. 5p\n2. c. 5p\n3. a. 5p\nSUBIECTUL al III-lea\n1. a) x = 2 2p';
  assert.deepStrictEqual(B.grilaAnswers(vertical), { I: { 1: 'c', 2: 'd', 3: 'a', 4: 'b' }, II: { 1: 'b', 2: 'c', 3: 'a' } });
  const inline = 'SUBIECTUL I\nSe punctează doar rezultatul.\n1. c) 2. d) 3. b) 4. a) 5. c) 6. d)\nPunctaj 5p 5p 5p 5p 5p 5p\nSUBIECTUL al II-lea\nNr. itemului 1 2 3 4 5 6\nRăspuns corect B A D C A B\nSUBIECTUL al III-lea\n1. a) x = 2 2p';
  assert.deepStrictEqual(B.grilaAnswers(inline), { I: { 1: 'c', 2: 'd', 3: 'b', 4: 'a', 5: 'c', 6: 'd' }, II: { 1: 'b', 2: 'a', 3: 'd', 4: 'c', 5: 'a', 6: 'b' } });
  assert.deepStrictEqual(B.grilaAnswers(BAC_BAREM_2024_V5), {}); // BAC-ul nu are grile
});

test('locateBaremItem: grilă (I.3 → litera), rezolvare (III.1.b), rezultat scurt (bareme vechi)', () => {
  const g = B.locateBaremItem(EN_BAREM_2024_V7, B.parseExerciseRef('subiectul I exercițiul 3'));
  assert.strictEqual(g.kind, 'grila');
  assert.strictEqual(g.litera, 'b');
  assert.match(g.text, /I\.3 — răspunsul corect: b\)/);
  const r = B.locateBaremItem(EN_BAREM_2024_V7, B.parseExerciseRef('subiectul III problema 1 b'));
  assert.strictEqual(r.kind, 'rezolvare');
  assert.match(r.text, /^b\) A = AB · BC = 120 · 75 = 9000/);
  assert.doesNotMatch(r.text, /Notăm cu x/);
  const old = 'SUBIECTUL I\n1. 15 5p\n2. 3,5 5p\n3. 120 cm 5p\nSUBIECTUL al II-lea\n1. Desenul 5p\n2. 36 cm² 5p\n3. 7 cm 5p';
  const o = B.locateBaremItem(old, B.parseExerciseRef('subiectul I ex 3'));
  assert.deepStrictEqual([o.kind, o.raspuns], ['rezultat', '120 cm']);
  assert.strictEqual(B.locateBaremItem(old, B.parseExerciseRef('exercițiul 3')), null); // „3." există în două subiecte → nu ghicim
  const o2 = B.locateBaremItem(old, B.parseExerciseRef('exercițiul 1')); // dar un item unic... tot în două subiecte
  assert.strictEqual(o2, null);
  const u = B.locateBaremItem(old.replace('\n3. 7 cm 5p', ''), B.parseExerciseRef('exercițiul 3')); // unic → se taie până la SUBIECT
  assert.deepStrictEqual([u.kind, u.raspuns], ['rezultat', '120 cm']);
  assert.strictEqual(B.locateBaremItem(EN_BAREM_2024_V7, B.parseExerciseRef('exercițiul 3')), null); // I.3 ≠ II.3 ≠ III.3
  assert.strictEqual(B.shortAnswerOf('3. Se acordă 5p'), null);
});

test('sliceExercise: enunțul din test se taie și cu punctajul în stânga („5p 3. …"), cu toate variantele', () => {
  const en = B.sliceExercise(EN_TEST_2024_V7, B.parseExerciseRef('I 3'), { ignoreLetter: true });
  assert.match(en, /^5p 3\. Numărul natural/);
  assert.match(en, /d\) 49$/);
  assert.doesNotMatch(en, /Media aritmetică/);
  const bac = B.sliceExercise(BAC_TEST_2024_V5, B.parseExerciseRef('subiectul II ex 2 b'));
  assert.match(bac, /elementul neutru/);
  assert.doesNotMatch(bac, /x ∘ x = 29/);
});

test('deterministicBaremItem (ai.js): grilă EN → enunț întreg + litera; III.1.b → rezolvarea', () => {
  const ctx = { baremText: EN_BAREM_2024_V7, subjectText: EN_TEST_2024_V7 };
  const g = ai.deterministicBaremItem(ctx, B.parseExerciseRef('subiectul II exercițiul 4'));
  assert.deepStrictEqual([g.kind, g.litera, g.exercitiu], ['grila', 'c', 'II.4']);
  assert.match(g.enunt, /Un cub are muchia de 3 cm/);
  assert.match(g.enunt, /d\) 81 cm³/);
  const r = ai.deterministicBaremItem(ctx, B.parseExerciseRef('subiectul III 1 b'));
  assert.strictEqual(r.kind, 'rezolvare');
  assert.match(r.enunt, /Determinați aria terenului/);
  assert.match(r.barem, /0,9 ha/);
});

test('shortAnswerCheck: altă literă anunțată = blocant; lipsa concluziei = doar regenerare; indiciul nu cere litera', () => {
  const item = { kind: 'grila', litera: 'b' };
  assert.strictEqual(ai.shortAnswerCheck('Calculăm 141 : 3 = 47. Răspunsul corect este litera b).', item, 'tutor').hard, null);
  assert.match(ai.shortAnswerCheck('Deci răspunsul corect este c).', item, 'tutor').hard, /c\) în loc de litera oficială b\)/);
  assert.match(ai.shortAnswerCheck('Varianta corectă este: d', item, 'tutor').hard, /d\)/);
  assert.match(ai.shortAnswerCheck('Calculăm 141 : 3 = 47.', item, 'tutor').soft, /nu a încheiat/);
  assert.deepStrictEqual(ai.shortAnswerCheck('Începe prin a împărți 141 la 3.', item, 'hint'), { hard: null, soft: null });
  const res = { kind: 'rezultat', raspuns: '120 cm' };
  assert.strictEqual(ai.shortAnswerCheck('Perimetrul este $120\\ cm$. Răspunsul corect este 120 cm.', res, 'tutor').soft, null);
  assert.match(ai.shortAnswerCheck('Perimetrul este 130 cm.', res, 'tutor').soft, /120 cm/);
});

test('fragmentFallback: la grilă dă litera oficială (fără litera în modul indiciu)', () => {
  const item = { kind: 'grila', litera: 'b', barem: 'I.3 — răspunsul corect: b)' };
  assert.match(ai.fragmentFallback(item, 'tutor'), /^Răspunsul corect este litera b\)\./);
  assert.doesNotMatch(ai.fragmentFallback(item, 'hint'), /litera b/);
  assert.match(ai.fragmentFallback({ kind: 'rezultat', raspuns: '120 cm', barem: '' }, 'tutor'), /Răspunsul corect este 120 cm/);
});
