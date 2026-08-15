// =====================================================================
// api/_lib/meditatii.js — biblioteca „Meditații cu Profesorul Virtual"
// (fișier ignorat de Vercel ca rută, fiindcă e în _lib)
//
// Conține:
//  · PROGRAMA pe clase (5–12) + examene (EN, BAC pe profiluri) — capitolele
//    de parcurs, cu subiectele fine ale fiecărui capitol;
//  · constructorul PLANULUI personalizat de învățare;
//  · selecția „ÎNTÂI MATERIALELE DIN SITE" (exerciții interactive
//    nefinalizate, teste PDF, teorie/lecții din Rezolvări și Auxiliare);
//  · generarea de întrebări DUPĂ MODELUL DIN SITE cu Claude Opus 5
//    (interactive de EN/BAC), cu fallback pe furnizorul existent;
//  · clasificarea greșelilor tipice + predicția notei.
// =====================================================================
const ai = require('./ai');
const claude = require('./claude');

// Modelul Claude folosit pentru generarea de exerciții și teste interactive
// de Evaluare Națională / Bacalaureat, exact după modelul din site (cerință).
const OPUS_MODEL = 'claude-opus-5';

// ─── PROGRAMA (capitole ordonate, cu subiectele fine) ────────────────────────
// id-urile sunt stabile (intră în plan, teme, recapitulări).
const CURRICULUM = {
  5: [
    { id: 'c5-naturale', title: 'Numere naturale: operații, puteri, ordinea operațiilor', topics: ['adunarea și scăderea numerelor naturale', 'înmulțirea și împărțirea', 'puteri cu exponent natural', 'ordinea efectuării operațiilor'] },
    { id: 'c5-divizibilitate', title: 'Divizibilitatea numerelor naturale', topics: ['divizor, multiplu', 'criteriile de divizibilitate cu 2, 5, 10, 3, 9', 'numere prime și compuse'] },
    { id: 'c5-metode', title: 'Metode aritmetice de rezolvare a problemelor', topics: ['metoda reducerii la unitate', 'metoda comparației', 'metoda figurativă', 'probleme de organizare a datelor'] },
    { id: 'c5-fractii-ordinare', title: 'Fracții ordinare', topics: ['fracții subunitare, echiunitare, supraunitare', 'amplificare și simplificare', 'adunarea și scăderea fracțiilor', 'înmulțirea și împărțirea fracțiilor', 'aflarea unei fracții dintr-un număr'] },
    { id: 'c5-fractii-zecimale', title: 'Fracții zecimale', topics: ['scrierea și compararea fracțiilor zecimale', 'operații cu fracții zecimale', 'transformări între fracții ordinare și zecimale', 'media aritmetică'] },
    { id: 'c5-geometrie', title: 'Elemente de geometrie și unități de măsură', topics: ['punct, dreaptă, segment', 'măsurarea segmentelor și unghiurilor', 'figuri geometrice', 'unități de măsură pentru lungime, arie, volum, timp'] },
  ],
  6: [
    { id: 'c6-multimi', title: 'Mulțimi. Mulțimea numerelor naturale', topics: ['operații cu mulțimi', 'descompunerea în factori primi', 'cmmdc și cmmmc', 'numere prime între ele'] },
    { id: 'c6-rapoarte', title: 'Rapoarte și proporții', topics: ['rapoarte', 'proporții și proprietatea fundamentală', 'procente', 'mărimi direct și invers proporționale', 'regula de trei simplă'] },
    { id: 'c6-intregi', title: 'Numere întregi', topics: ['compararea și ordonarea numerelor întregi', 'adunarea și scăderea numerelor întregi', 'înmulțirea și împărțirea', 'puteri cu bază număr întreg', 'ecuații simple în ℤ'] },
    { id: 'c6-rationale', title: 'Numere raționale', topics: ['operații cu numere raționale', 'ecuații de forma x+a=b, ax=b în ℚ', 'probleme cu numere raționale'] },
    { id: 'c6-geometrie-drepte', title: 'Dreapta, unghiuri, paralelism și perpendicularitate', topics: ['unghiuri opuse la vârf', 'unghiuri complementare și suplementare', 'unghiuri formate de două drepte paralele cu o secantă', 'mediatoarea unui segment, bisectoarea unui unghi'] },
    { id: 'c6-triunghi', title: 'Triunghiul: congruență și proprietăți', topics: ['suma măsurilor unghiurilor unui triunghi', 'cazurile de congruență', 'triunghiul isoscel și echilateral', 'liniile importante în triunghi'] },
  ],
  7: [
    { id: 'c7-reale', title: 'Numere reale: radicali', topics: ['rădăcina pătrată', 'scoaterea factorilor de sub radical', 'operații cu radicali', 'raționalizarea numitorului', 'media geometrică'] },
    { id: 'c7-ecuatii', title: 'Ecuații și sisteme de ecuații liniare', topics: ['ecuația de gradul I cu o necunoscută', 'sisteme de două ecuații cu două necunoscute', 'probleme rezolvate cu ecuații și sisteme'] },
    { id: 'c7-date', title: 'Organizarea datelor și elemente de probabilități', topics: ['produs cartezian, sistem de axe', 'reprezentarea punctelor în plan', 'medii, grafice, probabilități simple'] },
    { id: 'c7-patrulatere', title: 'Patrulatere', topics: ['paralelogramul și proprietățile lui', 'dreptunghi, romb, pătrat', 'trapezul, linia mijlocie', 'arii ale patrulaterelor'] },
    { id: 'c7-asemanare', title: 'Asemănarea triunghiurilor', topics: ['teorema lui Thales', 'teorema fundamentală a asemănării', 'triunghiuri asemenea', 'raportul de asemănare'] },
    { id: 'c7-metrice', title: 'Relații metrice în triunghiul dreptunghic', topics: ['teorema înălțimii, teorema catetei', 'teorema lui Pitagora', 'sinus, cosinus, tangentă', 'arii cu formule trigonometrice'] },
    { id: 'c7-cerc', title: 'Cercul', topics: ['unghi la centru, unghi înscris', 'coarde și arce', 'lungimea cercului și aria discului', 'poziții relative ale unei drepte față de cerc'] },
  ],
  8: [
    { id: 'c8-intervale', title: 'Intervale de numere reale. Inecuații', topics: ['mulțimea numerelor reale', 'modulul unui număr real', 'intervale', 'inecuații de gradul I'] },
    { id: 'c8-calcul-algebric', title: 'Calcul algebric: formule și descompuneri', topics: ['formulele de calcul prescurtat', 'descompunerea în factori', 'fracții algebrice', 'expresii E(x)'] },
    { id: 'c8-functii', title: 'Funcții', topics: ['noțiunea de funcție', 'funcția liniară f(x)=ax+b', 'reprezentarea grafică', 'intersecțiile graficului cu axele', 'distanțe și arii legate de grafic'] },
    { id: 'c8-spatiu-drepte', title: 'Geometrie în spațiu: puncte, drepte, plane', topics: ['determinarea planului', 'paralelism în spațiu', 'perpendicularitate, teorema celor trei perpendiculare', 'unghiul a două drepte, unghi diedru'] },
    { id: 'c8-corpuri', title: 'Corpuri geometrice: arii și volume', topics: ['prisma dreaptă, paralelipipedul, cubul', 'piramida și trunchiul de piramidă', 'cilindrul, conul, trunchiul de con, sfera', 'arii și volume, secțiuni'] },
  ],
  9: [
    { id: 'c9-logica-multimi', title: 'Mulțimi și elemente de logică matematică', topics: ['mulțimi de numere', 'inducția matematică', 'propoziții, predicate'] },
    { id: 'c9-siruri', title: 'Progresii aritmetice și geometrice', topics: ['șiruri', 'progresia aritmetică', 'progresia geometrică', 'sume remarcabile'] },
    { id: 'c9-functii-gr1', title: 'Funcții: generalități și funcția de gradul I', topics: ['proprietăți ale funcțiilor', 'funcția de gradul I', 'semnul funcției de gradul I', 'inecuații'] },
    { id: 'c9-functia-gr2', title: 'Funcția de gradul al II-lea', topics: ['graficul funcției de gradul al II-lea', 'vârful parabolei, monotonie, extreme', 'semnul funcției, inecuații de gradul al II-lea', 'relațiile lui Viète'] },
    { id: 'c9-vectori', title: 'Vectori în plan', topics: ['operații cu vectori', 'vectori coliniari', 'descompunerea unui vector', 'aplicații în geometrie'] },
    { id: 'c9-trigonometrie', title: 'Elemente de trigonometrie', topics: ['cercul trigonometric', 'reducerea la primul cadran', 'formule trigonometrice fundamentale', 'aplicații: teorema sinusurilor, teorema cosinusului'] },
  ],
  10: [
    { id: 'c10-puteri-radicali', title: 'Numere reale: puteri, radicali, logaritmi', topics: ['puteri cu exponent rațional', 'radicali de ordin n', 'logaritmi și proprietăți', 'ecuații exponențiale și logaritmice'] },
    { id: 'c10-functii', title: 'Funcții: injectivitate, surjectivitate, inversabilitate', topics: ['funcția exponențială', 'funcția logaritmică', 'compunerea funcțiilor', 'funcții inversabile'] },
    { id: 'c10-complexe', title: 'Numere complexe', topics: ['forma algebrică', 'operații cu numere complexe', 'modulul și conjugatul', 'ecuații de gradul al II-lea cu soluții complexe'] },
    { id: 'c10-numarare', title: 'Metode de numărare', topics: ['permutări, aranjamente, combinări', 'binomul lui Newton', 'probleme de numărare'] },
    { id: 'c10-finante', title: 'Matematici financiare, statistică și probabilități', topics: ['procente, dobânzi, TVA', 'medii statistice, dispersie', 'probabilități'] },
    { id: 'c10-geometrie-analitica', title: 'Geometrie analitică: dreapta în plan', topics: ['ecuația dreptei', 'panta unei drepte', 'drepte paralele și perpendiculare', 'distanțe și arii în plan'] },
  ],
  11: [
    { id: 'c11-matrice', title: 'Matrice și determinanți', topics: ['operații cu matrice', 'determinanți de ordin 2 și 3', 'matricea inversă', 'rangul unei matrice'] },
    { id: 'c11-sisteme', title: 'Sisteme de ecuații liniare', topics: ['metoda lui Cramer', 'metoda lui Gauss', 'sisteme compatibile/incompatibile', 'discuții după parametru'] },
    { id: 'c11-limite-siruri', title: 'Limite de șiruri', topics: ['șiruri convergente', 'operații cu limite', 'criterii de convergență', 'numărul e'] },
    { id: 'c11-limite-functii', title: 'Limite de funcții și continuitate', topics: ['limita unei funcții într-un punct', 'asimptote', 'funcții continue', 'proprietatea lui Darboux'] },
    { id: 'c11-derivate', title: 'Derivabilitate', topics: ['derivata unei funcții', 'reguli de derivare', 'teoremele lui Fermat, Rolle, Lagrange', "regula lui l'Hospital"] },
    { id: 'c11-grafic', title: 'Studiul funcțiilor cu ajutorul derivatelor', topics: ['monotonie și puncte de extrem', 'convexitate, puncte de inflexiune', 'reprezentarea grafică a funcțiilor'] },
  ],
  12: [
    { id: 'c12-grupuri', title: 'Grupuri, inele, corpuri', topics: ['legi de compoziție', 'grupuri și subgrupuri', 'morfisme și izomorfisme', 'inele și corpuri'] },
    { id: 'c12-polinoame', title: 'Polinoame', topics: ['operații cu polinoame', 'teorema împărțirii cu rest, teorema lui Bézout', 'rădăcini, relațiile lui Viète', 'ecuații algebrice'] },
    { id: 'c12-primitive', title: 'Primitive (integrale nedefinite)', topics: ['primitiva unei funcții', 'integrarea prin părți', 'schimbarea de variabilă', 'primitive de funcții raționale'] },
    { id: 'c12-integrala', title: 'Integrala definită', topics: ['formula Leibniz–Newton', 'proprietăți ale integralei definite', 'integrarea funcțiilor continue'] },
    { id: 'c12-aplicatii', title: 'Aplicații ale integralei definite', topics: ['aria unei suprafețe plane', 'volumul corpurilor de rotație', 'aplicații practice'] },
  ],
};

// Capitole de RECAPITULARE pentru Evaluarea Națională (lacune din anii anteriori)
const EN_RECAP = [
  { id: 'en-rec-numere', title: 'Recapitulare: numere naturale, întregi și raționale (cls. 5–6)', topics: ['ordinea operațiilor', 'divizibilitate', 'fracții ordinare și zecimale', 'numere întregi', 'procente și proporții'] },
  { id: 'en-rec-geometrie', title: 'Recapitulare: geometrie plană de bază (cls. 6–7)', topics: ['unghiuri', 'triunghiuri și congruență', 'patrulatere', 'arii și perimetre'] },
];

// Ce categorie de conținut din site corespunde profilului elevului
function categoryFor(profile) {
  if (profile.exam_target === 'evaluare-nationala') return 'evaluare-nationala';
  if (profile.exam_target && profile.exam_target.startsWith('bac')) return 'bacalaureat';
  return `clasa-${profile.grade}`;
}
// Categoria „de clasă" (materialele pe lecții) — complementară celei de examen
function classCategory(profile) { return `clasa-${profile.grade}`; }

// Capitolele de parcurs pentru un profil (clasă + examen-țintă).
// TOATĂ teoria intră în plan (fără plafon de capitole): la EN — programa
// completă a claselor 5–8; la BAC — clasele 9–12; plus capitolele din site.
function curriculumFor(profile) {
  const grade = Math.min(12, Math.max(5, parseInt(profile.grade, 10) || 8));
  let chapters = [];
  if (profile.exam_target === 'evaluare-nationala') {
    chapters = [...CURRICULUM[5], ...CURRICULUM[6], ...CURRICULUM[7], ...CURRICULUM[8]];
  } else if (profile.exam_target && profile.exam_target.startsWith('bac')) {
    // BAC: materia claselor 9–12, până la clasa elevului (min. 9)
    const upto = Math.max(9, grade);
    for (let g = 9; g <= upto; g++) chapters.push(...CURRICULUM[g]);
    if (profile.exam_target === 'bac-tehnologic') {
      // profilul cel mai accesibil — fără capitolele cele mai grele
      chapters = chapters.filter((c) => !['c12-grupuri'].includes(c.id));
    }
  } else {
    chapters = [...(CURRICULUM[grade] || CURRICULUM[8])];
  }
  return chapters.map((c, i) => ({ ...c, order: i }));
}

// Tipul de examen pentru simulări (după profil)
function examTypeFor(profile) {
  if (profile.exam_target === 'evaluare-nationala' || profile.grade <= 8) return 'evaluare-nationala';
  if (profile.exam_target === 'bac-mate-info') return 'bac-mate-info';
  if (profile.exam_target === 'bac-stiinte') return 'bac-stiinte';
  return 'bac-tehnologic';
}

// ─── Capitolele din rubricile site-ului („Capitole pentru BAC / EN") ─────────
// Materialele cu subcategory='capitole' din categoria examenului — TOATĂ
// teoria din site intră în planul de parcurs/recapitulare (cerința 9).
async function siteChaptersFor(supa, categories = []) {
  try {
    const { data } = await supa.from('content')
      .select('id, title, category, content_type, is_free')
      .eq('subcategory', 'capitole').in('category', categories.filter(Boolean))
      .order('sort_order', { ascending: true }).limit(300);
    return data || [];
  } catch { return []; }
}

// Categoriile din care se culeg capitolele site-ului pentru plan (cerința 3):
// rubricile „Capitole" de la examen + TOATE clasele acoperite de plan.
function siteChapterCategoriesFor(profile) {
  const grade = Math.min(12, Math.max(5, parseInt(profile.grade, 10) || 8));
  if (profile.exam_target === 'evaluare-nationala') {
    return ['evaluare-nationala', 'clasa-5', 'clasa-6', 'clasa-7', 'clasa-8'];
  }
  if (profile.exam_target && profile.exam_target.startsWith('bac')) {
    const out = ['bacalaureat'];
    for (let g = 9; g <= Math.max(9, grade); g++) out.push(`clasa-${g}`);
    return out;
  }
  return [`clasa-${grade}`];
}

// Adaugă în plan capitolele din site care NU se regăsesc deja în programă
// (potrivire pe cuvinte SEMNIFICATIVE din titlu — cuvintele generice precum
// „probleme"/„exerciții" nu contează, altfel totul părea „acoperit deja").
const GENERIC_WORDS = new Set(['probleme', 'problema', 'exercitii', 'exercitiu', 'teste', 'testul', 'matematica', 'capitol', 'capitole', 'capitolul', 'recapitulare', 'aplicatii', 'aplicata', 'aplicate', 'elemente', 'notiuni', 'introducere', 'clasa', 'partea', 'metode', 'rezolvate', 'rezolvare', 'teorie', 'formule', 'evaluare', 'nationala', 'bacalaureat', 'pregatire']);
function mergeSiteChapters(chapters, siteRows = []) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = (s) => norm(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 5);
  const sigWords = (s) => words(s).filter((w) => !GENERIC_WORDS.has(w));
  const known = chapters.map((c) => new Set(words(c.title + ' ' + (c.topics || []).join(' '))));
  const out = [...chapters];
  for (const row of siteRows) {
    const sig = sigWords(row.title);
    const w = sig.length ? sig : words(row.title);
    if (!w.length) continue;
    // acoperit = cel puțin 2 cuvinte semnificative comune (sau singurul cuvânt, dacă e unul)
    const covered = known.some((set) => {
      const hits = w.filter((x) => set.has(x)).length;
      return w.length === 1 ? hits === 1 : hits >= 2;
    });
    if (covered) continue;
    known.push(new Set(words(row.title)));
    out.push({
      id: 'site-' + row.id, title: row.title, topics: [row.title],
      order: out.length, siteContentId: row.id, siteContentType: row.content_type,
    });
  }
  return out;
}

// ─── PLANUL PERSONALIZAT ─────────────────────────────────────────────────────
// Construit din programă + capitolele din site + rezultatul evaluării
// inițiale (lacunele primele). status: de_parcurs | teorie | in_lucru | finalizat
function buildPlan(profile, assessment = {}, siteRows = []) {
  const base = mergeSiteChapters(curriculumFor(profile), siteRows);
  const chapters = base.map((c) => ({
    id: c.id, title: c.title, topics: c.topics, order: c.order,
    status: 'de_parcurs', mastery: null, sessions: 0,
    ...(c.siteContentId ? { siteContentId: c.siteContentId, siteContentType: c.siteContentType } : {}),
  }));
  const gaps = new Set((assessment.gaps || []).map((g) => g.chapter || g));
  // lacunele identificate urcă la începutul planului (remediere întâi)
  chapters.sort((a, b) => {
    const ga = gaps.has(a.id) ? 0 : 1;
    const gb = gaps.has(b.id) ? 0 : 1;
    return ga - gb || a.order - b.order;
  });
  const level = profile.level || assessment.level || 'mediu';
  const perWeek = level === 'incepator' ? 1 : level === 'avansat' ? 3 : 2; // capitole/săptămână
  const estWeeks = Math.max(1, Math.ceil(chapters.length / perWeek));
  return {
    chapters,
    weeklyGoal: { chapters: perWeek, exercises: perWeek * 10, minutes: perWeek * 90 },
    estWeeks,
    startedAt: new Date().toISOString(),
  };
}

function planProgress(plan) {
  const ch = plan?.chapters || [];
  if (!ch.length) return 0;
  const score = ch.reduce((s, c) => s + (c.status === 'finalizat' ? 1 : c.status === 'in_lucru' ? 0.5 : c.status === 'teorie' ? 0.25 : 0), 0);
  return Math.round((score / ch.length) * 100);
}

// Capitolul următor pe care profesorul îl alege SINGUR (memorie pedagogică):
// întâi capitolele-lacună neîncepute, apoi cele în lucru, apoi următorul din
// plan. Cu o PREGĂTIRE DE LUCRARE activă (focus), capitolele lucrării au
// prioritate absolută până sunt toate finalizate (recapitularea pentru test).
function nextChapter(plan, focus = null) {
  const ch = plan?.chapters || [];
  const ids = new Set(focus?.chapter_ids || []);
  if (ids.size) {
    const f = ch.find((c) => ids.has(c.id) && (c.status === 'in_lucru' || c.status === 'teorie'))
          || ch.find((c) => ids.has(c.id) && c.status === 'de_parcurs');
    if (f) return f;
  }
  return ch.find((c) => c.status === 'in_lucru' || c.status === 'teorie')
      || ch.find((c) => c.status === 'de_parcurs')
      || null;
}

// ─── PREGĂTIRE PENTRU LUCRARE / TEST („focus”) ───────────────────────────────
// Elevul își poate pregăti cu meditațiile și LUCRĂRILE de la școală, nu doar
// examenul: alege tipul testului, capitolele (din listă sau scrise liber) și
// o DATĂ LIMITĂ — planul de recapitulare ține cont de ele (capitolele lucrării
// au prioritate, briefingul numără zilele rămase, iar „testul de verificare”
// se generează doar din capitolele alese). Pentru EXAMENUL FINAL (EN/BAC) nu
// se setează focus — planul rămâne toată materia, ca până acum.
// Structura salvată în ai_meditatii_profile.focus (jsonb):
//   { kind, chapter_ids: [..], custom, deadline: 'YYYY-MM-DD', set_at }
const FOCUS_KINDS = {
  lucrare: 'lucrare / test din capitole',
  lectii: 'test din lecții',
  'test-initial': 'test inițial (materia anului trecut)',
};

const roToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Bucharest' }).format(new Date()); // YYYY-MM-DD

function focusSlug(s) {
  return String(s || 'capitol').toLowerCase()
    .replace(/[ăâ]/g, 'a').replace(/î/g, 'i').replace(/[șş]/g, 's').replace(/[țţ]/g, 't')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'capitol';
}

// Curăță/validează datele venite din formular. 'examen' (examenul final) sau
// lipsa tipului → null (fără focus — toată materia, comportamentul de acum).
function cleanFocus(input) {
  if (!input || typeof input !== 'object') return null;
  const kind = String(input.kind || '').trim();
  if (!FOCUS_KINDS[kind]) return null;
  const chapterIds = (Array.isArray(input.chapterIds) ? input.chapterIds : [])
    .map((x) => String(x || '').trim().slice(0, 80)).filter(Boolean).slice(0, 24);
  const custom = String(input.custom || '').trim().slice(0, 500) || null;
  let deadline = String(input.deadline || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || Number.isNaN(Date.parse(deadline))) deadline = null;
  if (deadline) {
    const diff = (Date.parse(deadline) - Date.parse(roToday())) / 86400000;
    if (diff < 0 || diff > 400) deadline = null; // în trecut sau absurd de departe
  }
  return { kind, chapter_ids: chapterIds, custom, deadline, set_at: new Date().toISOString() };
}

// Lista de capitole din care poate alege elevul (dropdown-ul formularului):
// planul lui (programă + capitolele din site + cele adăugate) + programa
// anului TRECUT (pentru „test inițial” — recapitularea de la început de an).
function focusPool(profile, plan) {
  const grade = Math.min(12, Math.max(5, parseInt(profile.grade, 10) || 8));
  const seen = new Set();
  const out = [];
  const push = (c, group) => { if (c && c.id && !seen.has(c.id)) { seen.add(c.id); out.push({ id: c.id, title: c.title, topics: c.topics || [c.title], group }); } };
  (plan?.chapters || []).forEach((c) => {
    const g = /^c(\d+)-/.exec(String(c.id));
    push(c, g ? `Clasa ${g[1]}` : 'Din planul meu');
  });
  curriculumFor(profile).forEach((c) => {
    const g = /^c(\d+)-/.exec(String(c.id));
    push(c, g ? `Clasa ${g[1]}` : 'Programă');
  });
  if (grade > 5) (CURRICULUM[grade - 1] || []).forEach((c) => push(c, `Clasa ${grade - 1} (anul trecut)`));
  return out;
}

// Aplică focusul pe plan: capitolele alese care NU sunt în plan (ex. materia
// anului trecut la „test inițial”, sau capitolul scris liber de elev) se
// ADAUGĂ în plan ca „de parcurs”. Întoarce { plan, focus } (obiecte noi).
function applyFocus({ profile, plan, focus }) {
  if (!focus) return { plan, focus: null };
  const pool = new Map(focusPool(profile, plan).map((c) => [c.id, c]));
  const chapters = [...(plan?.chapters || [])];
  const inPlan = new Set(chapters.map((c) => c.id));
  let ids = [...(focus.chapter_ids || [])];

  // „test inițial” fără capitole alese → implicit TOATĂ materia anului trecut;
  // „lucrare” fără capitole și fără text liber → TOATĂ clasa (materia clasei
  // curente — cerința „din anumite capitole sau toată clasa”)
  const grade = Math.min(12, Math.max(5, parseInt(profile.grade, 10) || 8));
  if (focus.kind === 'test-initial' && !ids.length && grade > 5) {
    ids = (CURRICULUM[grade - 1] || []).map((c) => c.id);
  }
  if (focus.kind === 'lucrare' && !ids.length && !focus.custom) {
    ids = (CURRICULUM[grade] || []).map((c) => c.id);
  }
  // capitolul scris liber (lipsă din listă) devine capitol de plan de sine stătător
  if (focus.custom) {
    const title = focus.custom.split(/\r?\n/)[0].replace(/\s+/g, ' ').trim().slice(0, 90);
    if (title.length >= 3) {
      const id = 'custom-' + focusSlug(title);
      if (!pool.has(id)) pool.set(id, { id, title, topics: [focus.custom.slice(0, 300)] });
      if (!ids.includes(id)) ids.push(id);
    }
  }
  // păstrăm doar id-urile pe care le cunoaștem (plan sau pool)
  ids = ids.filter((id) => inPlan.has(id) || pool.has(id));
  // capitolele lipsă din plan se adaugă la coadă, „de parcurs”
  for (const id of ids) {
    if (inPlan.has(id)) continue;
    const c = pool.get(id);
    chapters.push({
      id: c.id, title: c.title, topics: c.topics || [c.title], order: chapters.length,
      status: 'de_parcurs', mastery: null, sessions: 0,
    });
    inPlan.add(id);
  }
  return {
    plan: { ...(plan || {}), chapters },
    focus: { ...focus, chapter_ids: ids },
  };
}

// ─── PREGĂTIREA PE SUBIECTELE EXAMENULUI (elevii cu examen-țintă) ───────────
// Elevul poate restrânge pregătirea la „doar Subiectul I”, „doar Subiectul al
// II-lea” sau „Subiectele I și II” (alegerea se ține în memory.exam_scope;
// null/lipsă = tot examenul, ca până acum). Meditatorul adaptează: planul
// (capitolele potrivite au prioritate), simulările (doar itemii subiectelor
// alese) și chatul (nota de conținut intră în context).
const EXAM_SCOPES = {
  s1: 'doar Subiectul I',
  s2: 'doar Subiectul al II-lea',
  s1s2: 'Subiectele I și II',
};

// Ce ÎNSEAMNĂ alegerea, pe tip de examen — intră în prompturile de generare.
function examScopeNote(examTarget, scope) {
  if (!EXAM_SCOPES[scope]) return null;
  const en = String(examTarget || '') === 'evaluare-nationala';
  const map = en ? {
    s1: 'DOAR Subiectul I al Evaluării Naționale: itemi GRILĂ de aritmetică și algebră (fără nicio problemă de geometrie)',
    s2: 'DOAR Subiectul al II-lea al Evaluării Naționale: itemi GRILĂ de geometrie',
    s1s2: 'Subiectele I și II ale Evaluării Naționale: itemi GRILĂ de algebră și geometrie — FĂRĂ Subiectul al III-lea (problemele cu rezolvare completă)',
  } : {
    s1: 'DOAR Subiectul I al Bacalaureatului: itemi scurți, accesibili, din toată programa',
    s2: 'DOAR Subiectul al II-lea al Bacalaureatului: ALGEBRĂ — matrice, determinanți, sisteme, structuri algebrice, polinoame',
    s1s2: 'Subiectele I și II ale Bacalaureatului — FĂRĂ Subiectul al III-lea (analiza matematică)',
  };
  return map[scope] || null;
}

// Capitolele din plan care corespund alegerii — folosite ca PRIORITATE în
// plan (nextChapter), nu ca filtru dur. null = fără restricție (toate).
const GEO_RE = /(geometri|unghi|triungh|patrulater|cerc|corp|spati|piramid|prism|cilindr|sfer|metrice|aseman|segment|arie|arii|perimetr|drepte)/;
const BAC_S2 = new Set(['c11-matrice', 'c11-sisteme', 'c12-grupuri', 'c12-polinoame']);
const BAC_S3 = new Set(['c11-limite-siruri', 'c11-limite-functii', 'c11-derivate', 'c11-grafic', 'c12-primitive', 'c12-integrala', 'c12-aplicatii']);
function examScopeIds(profile, plan, scope) {
  if (!EXAM_SCOPES[scope] || !profile?.exam_target) return null;
  const ch = plan?.chapters || [];
  if (!ch.length) return null;
  const deacc = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const isGeo = (c) => GEO_RE.test(deacc(c.title + ' ' + (c.topics || []).join(' ')));
  const en = profile.exam_target === 'evaluare-nationala';
  let picked;
  if (en) {
    if (scope === 's1') picked = ch.filter((c) => !isGeo(c));        // algebră/aritmetică
    else if (scope === 's2') picked = ch.filter((c) => isGeo(c));    // geometrie
    else return null;                                                // I+II = tot conținutul (diferă doar stilul itemilor)
  } else {
    if (scope === 's2') picked = ch.filter((c) => BAC_S2.has(c.id)); // algebra Subiectului II
    else if (scope === 's1s2') picked = ch.filter((c) => !BAC_S3.has(c.id)); // fără analiză
    else return null;                                                // Subiectul I = toată programa
  }
  const ids = picked.map((c) => c.id);
  return ids.length ? ids : null;
}

// Detaliile focusului pentru client (starea /meditatii): capitolele cu
// statusul lor din plan, progresul, zilele rămase și ritmul necesar.
function focusInfo(medProfile, plan) {
  const focus = medProfile?.focus;
  if (!focus || !FOCUS_KINDS[focus.kind]) return null;
  const byId = new Map((plan?.chapters || []).map((c) => [c.id, c]));
  const chapters = (focus.chapter_ids || []).map((id) => {
    const c = byId.get(id);
    return c ? { id, title: c.title, status: c.status, mastery: c.mastery ?? null }
             : { id, title: id, status: 'de_parcurs', mastery: null };
  });
  const done = chapters.filter((c) => c.status === 'finalizat').length;
  let daysLeft = null;
  if (focus.deadline) daysLeft = Math.round((Date.parse(focus.deadline) - Date.parse(roToday())) / 86400000);
  const remaining = chapters.length - done;
  // ritmul necesar ca recapitularea să se termine până la data limită
  let perWeek = null;
  if (daysLeft != null && daysLeft > 0 && remaining > 0) perWeek = Math.ceil(remaining / Math.max(1, daysLeft / 7));
  return {
    kind: focus.kind, kindLabel: FOCUS_KINDS[focus.kind],
    custom: focus.custom || null, deadline: focus.deadline || null,
    daysLeft, overdue: daysLeft != null && daysLeft < 0,
    chapters, total: chapters.length, done, perWeek,
  };
}

// ─── MATERIALELE DIN SITE (prioritare — cerința B) ───────────────────────────
// Exerciții interactive din categoria potrivită pe care elevul NU le-a
// finalizat încă (după tabela progress) — acestea se dau primele ca teme.
async function siteInteractiveFor(supa, { userId, categories = [], topics = [], limit = 6, minMatch = false, excludeIds = [] }) {
  const cats = categories.filter(Boolean);
  if (!cats.length) return [];
  const { data: rows } = await supa.from('content')
    .select('id, title, category, subcategory, is_free, created_at')
    .eq('content_type', 'interactive').in('category', cats)
    .order('sort_order', { ascending: true }).limit(400);
  if (!rows || !rows.length) return [];
  const { data: prog } = await supa.from('progress').select('content_id').eq('user_id', userId);
  const done = new Set([...(prog || []).map((p) => p.content_id), ...excludeIds]);
  const norm = (s) => String(s || '').toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = topics.flatMap((t) => norm(t).split(/[^a-z0-9]+/)).filter((w) => w.length >= 4);
  const scoreOf = (r) => {
    const t = norm(r.title);
    let s = 0;
    for (const w of words) if (t.includes(w)) s += 1;
    return s;
  };
  const fresh = rows.filter((r) => !done.has(r.id));
  const scored = fresh.map((r) => ({ ...r, _s: scoreOf(r) })).sort((a, b) => b._s - a._s);
  const matched = scored.filter((r) => r._s > 0);
  const pool = matched.length ? [...matched, ...scored.filter((r) => r._s === 0)] : (minMatch ? [] : scored);
  return pool.slice(0, limit).map(({ _s, ...r }) => r);
}

// Teorie/lecții din site: articole „Rezolvări/Teorie" + auxiliare (manuale)
// + PDF-uri de teorie din categoria potrivită.
async function siteTheoryFor(supa, { categories = [], topics = [], chapterTitle = '', limit = 5 }) {
  const out = [];
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const words = [chapterTitle, ...topics].flatMap((t) => norm(t).split(/[^a-z0-9]+/)).filter((w) => w.length >= 4);
  const scoreOf = (title) => { const t = norm(title); let s = 0; for (const w of words) if (t.includes(w)) s += 1; return s; };
  try {
    const { data: rez } = await supa.from('rezolvari')
      .select('id, title, category, type, is_free')
      .in('category', [...categories, 'general'].filter(Boolean)).limit(200);
    (rez || []).forEach((r) => {
      const s = scoreOf(r.title);
      if (s > 0) out.push({ kind: 'rezolvare', title: r.title, url: '/rezolvari', is_free: r.is_free, _s: s });
    });
  } catch { /* tabelă opțională */ }
  try {
    const { data: arts } = await supa.from('articole')
      .select('slug, title, category, kind').eq('status', 'published').limit(300);
    (arts || []).forEach((a) => {
      const s = scoreOf(a.title);
      if (s > 0) out.push({ kind: 'articol', title: a.title, url: `/rezolvari/${a.slug}`, is_free: true, _s: s });
    });
  } catch { /* tabelă opțională */ }
  try {
    const { data: man } = await supa.from('content')
      .select('id, title, category, content_type, is_free')
      .in('content_type', ['manual', 'pdf']).in('category', [...categories, 'manuale'].filter(Boolean))
      .limit(300);
    (man || []).forEach((m) => {
      const s = scoreOf(m.title);
      if (s > 0) out.push({
        kind: m.content_type, title: m.title, is_free: m.is_free,
        url: m.content_type === 'pdf' ? `/pdf-viewer?id=${m.id}` : `/exercitiu?id=${m.id}`,
        _s: s,
      });
    });
  } catch { /* ignorăm */ }
  return out.sort((a, b) => b._s - a._s).slice(0, limit).map(({ _s, ...r }) => r);
}

// ─── GENERAREA DE ÎNTREBĂRI după modelul din site ────────────────────────────
// Folosită DOAR după/pe lângă materialele din site (cerința B):
//  · Claude Opus 5 pentru seturile interactive (EN/BAC, după modelul din site);
//  · fallback automat pe furnizorul existent (ai.chat cu GEN_MODEL) dacă
//    ANTHROPIC_API_KEY lipsește sau apelul eșuează.
// Întoarce { questions:[{statement, options?, answer, explanation, chapter?, topic?}], provider }
async function genQuestions(supa, {
  category = null, chapter = null, topics = [], difficulty = 'mediu',
  count = 10, purpose = 'exersare', styleNote = '', mistake = null, chaptersSpec = null,
}) {
  const topicLine = topics.filter(Boolean).join(', ');
  const q = [chapter, topicLine, category, 'exercițiu matematică'].filter(Boolean).join(' ');
  const docs = await ai.retrieve(supa, { query: q, category, allowPremium: true, k: 6, prefer: 'exercise' });
  const examples = ai.contextBlock(docs);

  const purposeLines = {
    exersare: `Set de ${count} exerciții de consolidare la capitolul „${chapter}"${topicLine ? ` (subiecte: ${topicLine})` : ''}, dificultate ${difficulty}, de la simplu la complex.`,
    remediere: `EXERCIȚII DE REMEDIERE: elevul a greșit exercițiul de mai jos. Generează ${count} exerciții de EXACT ACELAȘI TIP (aceeași metodă, aceeași structură), doar cu numere/date diferite, la aceeași dificultate sau puțin mai simple, ca să fixeze procedeul.\nEXERCIȚIUL GREȘIT: ${mistake?.statement || ''}\nRĂSPUNSUL CORECT ERA: ${mistake?.correct_answer || ''}\nGREȘEALA ELEVULUI: ${mistake?.analysis || mistake?.student_answer || ''}`,
    evaluare: `TEST DE EVALUARE INIȚIALĂ (adaptiv): ${count} întrebări care acoperă capitolele de mai jos, de la foarte ușor la greu, ca să stabilim nivelul elevului și lacunele din anii anteriori. Distribuie întrebările pe capitole și marchează fiecare întrebare cu cheia "chapter" (id-ul capitolului) din lista:\n${chaptersSpec}`,
    recapitulare: `RECAPITULARE (repetiție inteligentă): ${count} întrebări scurte din capitolul „${chapter}"${topicLine ? ` (subiecte: ${topicLine})` : ''} — esențialul, ca elevul să nu uite materia.`,
    simulare: `SIMULARE DE EXAMEN în format grilă interactivă: ${count} itemi reprezentativi pentru examen, în stilul și structura subiectelor oficiale din exemplele de mai jos, cu punctaj egal pe item.`,
    tema: `TEMĂ: set de ${count} exerciții potrivite nivelului elevului la capitolul „${chapter}"${topicLine ? ` (subiecte: ${topicLine})` : ''}, dificultate ${difficulty}.`,
  };

  const system = `${ai.PERSONA}

Sarcină: creezi întrebări de matematică pentru platforma ExamenMate, EXACT după modelul exercițiilor din site (stil, notații, nivel — vezi exemplele).

=== EXEMPLE REALE DIN SITE (model de stil) ===
${examples}
=== SFÂRȘIT EXEMPLE ===

${purposeLines[purpose] || purposeLines.exersare}
${styleNote ? `\nADAPTARE LA ELEV: ${styleNote}` : ''}

Răspunde STRICT cu un OBIECT JSON valid (fără alt text), cu forma:
{
  "questions": [
    {
      "statement": "enunț (formule LaTeX între $...$)",
      "options": ["varianta a", "varianta b", "varianta c", "varianta d"],
      "answer": 0,
      "explanation": "rezolvarea pas cu pas, scurtă",
      "chapter": "id-ul capitolului (dacă a fost cerut)",
      "topic": "subiectul fin (ex: ecuatii_gradul_1)"
    }
  ]
}
Reguli:
- Grilă cu EXACT 4 variante și "answer" = indexul corect (0–3), distribuit aleatoriu; poți pune și întrebări cu răspuns liber (omite "options", "answer" = textul/numărul corect).
- Fiecare întrebare COMPLET rezolvabilă, fără ambiguități; verifică-ți calculele de două ori.
- Folosește „·" (\\cdot) pentru înmulțire, NICIODATĂ litera x sau ×.
- Comenzile LaTeX cu argumentele MEREU între acolade: \\frac{3}{2} (nu \\frac32), \\sqrt{13} (nu \\sqrt13).
- IMPORTANT pentru JSON valid: în interiorul stringurilor JSON fiecare comandă LaTeX are EXACT un backslash dublat — corect: "$\\\\frac{1}{2}$", "$\\\\sqrt{9}$"; GREȘIT: patru backslash-uri sau niciunul ("frac{1}{2}").`;

  const userMsg = `Generează obiectul JSON cu ${count} întrebări acum. Fă-le diferite de orice generare anterioară (alte numere, alte contexte). Sesiune #${Math.random().toString(36).slice(2, 8)}.`;

  // 1) Claude Opus 5 (cerința B) — cu extractJson tolerant la LaTeX
  try {
    const r = await claude.chatClaude({
      system, messages: [{ role: 'user', content: userMsg }],
      maxTokens: Math.min(6000, 1200 + count * 350), model: OPUS_MODEL,
    });
    const parsed = claude.extractJson(r.text);
    const questions = normalizeQuestions(parsed);
    if (questions.length) return { questions, provider: r.provider || OPUS_MODEL, usage: toUsage(r.usage) };
  } catch (e) { console.warn('meditatii genQuestions (opus):', e.message); }

  // 2) Fallback: furnizorul existent (modelul de generare „sol")
  const { text, usage } = await ai.chat({
    system, messages: [{ role: 'user', content: userMsg }],
    temperature: 0.9, maxTokens: 4000, json: true, model: ai.GEN_MODEL,
  });
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = claude.extractJson(text); }
  const questions = normalizeQuestions(parsed);
  return { questions, provider: ai.GEN_MODEL, usage };
}

function toUsage(u = {}) { return { in: u.prompt_tokens || 0, out: u.completion_tokens || 0 }; }

// ─── Repararea LaTeX-ului corupt de JSON (cauza „sqrt13", „frac32") ──────────
// Trei stricăciuni posibile după parcursul model → JSON → parse:
//  1. \f/\t/\b din \frac/\times/\begin devin caractere de CONTROL (JSON valid);
//  2. backslash DUBLU rămas în text (modelul a scris \\\\frac) → KaTeX îl
//     citește ca „rând nou" + comanda fără backslash → afișează „frac32";
//  3. backslash PIERDUT complet → „sqrt{13}" ca text simplu.
const LATEX_CMDS = 'frac|sqrt|cdot|pi|alpha|beta|gamma|delta|theta|angle|triangle|overline|underline|vec|times|div|le|leq|ge|geq|neq|ne|pm|infty|sin|cos|tan|ctg|tg|log|ln|lim|sum|int|cup|cap|subset|in|Rightarrow|rightarrow|text|mathbb|widehat|degree|circ|perp|parallel|equiv|approx|sim|forall|exists|emptyset|varnothing|prod|binom|left|right|begin|end';
function fixLatex(s) {
  if (typeof s !== 'string' || !s) return s;
  let t = s
    .replace(/\f/g, '\\f')        // form-feed → \frac, \forall...
    .replace(/\t/g, '\\t')        // tab → \times, \theta, \tan, \text...
    .replace(/\u0008/g, '\\b');   // backspace → \begin, \binom, \beta...
  // backslash dublu (sau mai multe) înaintea unei comenzi → unul singur
  // (granița NU e \b: la forma scurtă „\frac32" comanda e urmată de cifre)
  t = t.replace(new RegExp('\\\\{2,}(?=(?:' + LATEX_CMDS + ')(?![a-zA-Z]))', 'g'), '\\');
  // comenzi rămase FĂRĂ backslash în interiorul formulelor $...$
  const cmdRe = new RegExp('(^|[^\\\\a-zA-Z])(' + LATEX_CMDS + ')(?=[\\s{_^\\d(])', 'g');
  t = t.replace(/\$([^$]+)\$/g, (m, inner) => '$' + inner.replace(cmdRe, '$1\\$2') + '$');
  return t;
}

// normalizează + validează lista de întrebări (aceleași reguli ca generatorul existent)
function normalizeQuestions(parsed) {
  let list = parsed;
  if (list && !Array.isArray(list) && typeof list === 'object') {
    list = Object.values(list).find(Array.isArray)
      || Object.values(list).filter((v) => v && typeof v === 'object' && (v.statement || v.enunt));
  }
  if (!Array.isArray(list)) return [];
  return list.slice(0, 20).map((q) => ({
    statement: fixLatex(String(q.statement || q.enunt || '').trim()),
    options: Array.isArray(q.options) ? q.options.map((o) => fixLatex(String(o))) : undefined,
    answer: Array.isArray(q.options) ? Number(q.answer) || 0 : fixLatex(String(q.answer ?? '').trim()),
    explanation: q.explanation ? fixLatex(String(q.explanation)) : '',
    chapter: q.chapter ? String(q.chapter) : undefined,
    topic: q.topic ? String(q.topic) : undefined,
  })).filter((q) => {
    if (q.statement.length < 6) return false;
    if (q.options) return q.options.length >= 2 && q.answer >= 0 && q.answer < q.options.length;
    return String(q.answer).length > 0;
  });
}

// ─── Corectarea unui set + DETECTAREA GREȘELILOR TIPICE ──────────────────────
// items: [{statement, options?, correct, given, explanation?}] (doar cele greșite intră la analiză)
// Întoarce [{index, errorType, analysis}]
async function classifyMistakes(items, ctx = null) {
  if (!items.length) return [];
  const listing = items.map((it, i) =>
    `#${i + 1}\nENUNȚ: ${it.statement}\nRĂSPUNS CORECT: ${it.correct}\nRĂSPUNSUL ELEVULUI: ${it.given || '(fără răspuns)'}${it.explanation ? `\nREZOLVAREA: ${it.explanation}` : ''}`
  ).join('\n\n');
  const system = `Ești profesor de matematică și analizezi greșelile unui elev. Pentru FIECARE exercițiu greșit de mai jos, stabilește MOTIVUL greșelii, nu doar că e greșit:
- "calcul"    → greșeală de calcul (procedeul era bun);
- "formula"   → formulă aplicată greșit sau confundată;
- "regula"    → regulă uitată (semne, ordinea operațiilor etc.);
- "concept"   → confuzie între concepte (nu a înțeles noțiunea);
- "neatentie" → neatenție (a citit greșit, a copiat greșit, răspuns lipsă);
- "necunoscut"→ nu se poate stabili.
Răspunde STRICT cu JSON: {"analysis":[{"index":1,"errorType":"calcul","analysis":"explicație scurtă și caldă: unde anume a greșit și ce trebuia făcut"}]}`;
  try {
    const { text, usage } = await ai.chat({
      system, messages: [{ role: 'user', content: listing }],
      temperature: 0.2, maxTokens: 1600, json: true, model: ai.GEN_MODEL,
    });
    // Loghează costul (altfel apelul acesta LLM era invizibil pt. bugete/rapoarte).
    if (ctx?.supa && ctx?.userId) {
      try { await ai.logUsage(ctx.supa, ctx.userId, ctx.endpoint || 'ai-meditatii:mistakes', usage); } catch { /* logarea nu blochează */ }
    }
    const parsed = JSON.parse(text);
    const arr = Array.isArray(parsed?.analysis) ? parsed.analysis : Array.isArray(parsed) ? parsed : [];
    return arr.map((a) => ({
      index: Math.max(1, parseInt(a.index, 10) || 1) - 1,
      errorType: ['calcul', 'formula', 'concept', 'regula', 'neatentie'].includes(a.errorType) ? a.errorType : 'necunoscut',
      analysis: String(a.analysis || '').slice(0, 600),
    }));
  } catch (e) {
    console.warn('classifyMistakes:', e.message);
    return items.map((_, i) => ({ index: i, errorType: 'necunoscut', analysis: '' }));
  }
}

// ─── NOTA UNUI TEST INTERACTIV (cu 10 puncte din oficiu) ─────────────────────
// Aceeași regulă ca în frontend (src/lib/nota.js): testele care raportează
// „din 100" (maxScore = 100) au oficiul DEJA inclus în scor ⇒ nota = scor/10;
// la punctaj brut (ex. 35/45) oficiul se acordă aici ⇒ nota = 1 + 9×procent.
// Nota păstrează 2 zecimale și e limitată la [1, 10].
function notaTest(score, maxScore) {
  const s = Number(score), m = Number(maxScore);
  if (!Number.isFinite(s) || !Number.isFinite(m) || m <= 0) return null;
  const raw = m === 100 ? s / 10 : 1 + 9 * (s / m);
  return Math.max(1, Math.min(10, Math.round(raw * 100) / 100));
}

// ─── PREDICȚIA NOTEI (funcția 17) ────────────────────────────────────────────
// Heuristică transparentă din: stăpânirea medie pe subiecte, media temelor,
// media simulărilor. Notă pe scala 1–10 + capitolele de consolidat.
function predictGrade({ masteryAvg = null, homeworkAvg = null, simAvg = null, weakChapters = [] }) {
  const parts = [];
  if (simAvg != null) parts.push({ v: simAvg, w: 3 });        // simulările contează cel mai mult
  if (homeworkAvg != null) parts.push({ v: homeworkAvg, w: 2 });
  if (masteryAvg != null) parts.push({ v: masteryAvg, w: 2 });
  if (!parts.length) return null;
  const wsum = parts.reduce((s, p) => s + p.w, 0);
  const pct = parts.reduce((s, p) => s + p.v * p.w, 0) / wsum; // 0..1
  // nota estimată păstrează partea zecimală (2 zecimale) — nu se rotunjește
  const grade = Math.max(1, Math.min(10, Math.round((1 + 9 * pct) * 100) / 100));
  const confidence = parts.length >= 3 ? 'bună' : parts.length === 2 ? 'medie' : 'orientativă';
  return { grade, confidence, weakChapters: weakChapters.slice(0, 4) };
}

// ─── Streak (zile consecutive de studiu) ─────────────────────────────────────
function bumpStreak(profile) {
  const today = new Date().toISOString().slice(0, 10);
  const last = profile.last_study_date ? String(profile.last_study_date).slice(0, 10) : null;
  if (last === today) return { streak_days: profile.streak_days || 1, last_study_date: today };
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const streak = last === yesterday ? (profile.streak_days || 0) + 1 : 1;
  return { streak_days: streak, last_study_date: today };
}

// Etapele repetiției inteligente: după 1 zi → 7 zile → 30 zile
const REVIEW_STAGES_DAYS = [1, 7, 30];
function nextReviewDue(stage) {
  const days = REVIEW_STAGES_DAYS[Math.min(stage, REVIEW_STAGES_DAYS.length - 1)];
  return new Date(Date.now() + days * 86400000).toISOString();
}

// ─── Profilul de meditații (helper partajat) ─────────────────────────────────
async function getProfile(supa, userId) {
  const { data } = await supa.from('ai_meditatii_profile').select('*').eq('user_id', userId).maybeSingle();
  return data || null;
}

// Temele „content" (materiale din site) se marchează rezolvate automat pe baza
// tabelei `progress` (scorul vine din exercițiul interactiv al site-ului).
async function reconcileContentHomework(supa, userId) {
  try {
    const { data: hw } = await supa.from('ai_meditatii_homework')
      .select('id, content_id, assigned_at').eq('user_id', userId).eq('status', 'data').eq('kind', 'content');
    if (!hw || !hw.length) return;
    const ids = hw.map((h) => h.content_id).filter(Boolean);
    if (!ids.length) return;
    const { data: prog } = await supa.from('progress')
      .select('content_id, score, max_score, attempts, completed_at').eq('user_id', userId).in('content_id', ids);
    for (const h of hw) {
      const p = (prog || []).find((x) => x.content_id === h.content_id);
      // Orice rezultat din `progress` bifează tema: la momentul dării temei
      // exercițiul NU avea niciun rezultat (selecția exclude materialele
      // rezolvate), deci un rând apărut ulterior = tema a fost lucrată.
      // (Comparația strictă de timp pierdea rezolvări reale — cerința 2.)
      if (p) {
        await supa.from('ai_meditatii_homework').update({
          status: 'rezolvata', score: p.score, max_score: p.max_score,
          attempts: p.attempts || 1, completed_at: p.completed_at || new Date().toISOString(),
          // nota cu 10 p din oficiu, fără dublare la testele „din 100" (notaTest)
          feedback: { grade: notaTest(p.score, p.max_score) ?? 1, auto: true },
        }).eq('id', h.id);
        await clearHomeworkNotifications(supa, userId, h.id);
      }
    }
  } catch (e) { console.warn('reconcileContentHomework:', e.message); }
}

// Tema rezolvată → notificările ei („temă nouă" / „temă nefăcută") se
// marchează citite, ca elevul să nu mai vadă alerta după ce a lucrat.
async function clearHomeworkNotifications(supa, userId, homeworkId) {
  try {
    await supa.from('ai_notifications').update({ read: true })
      .eq('recipient_id', userId)
      .in('dedupe_key', [`med_hw:${homeworkId}`, `med_hw_late:${homeworkId}`]);
  } catch { /* best-effort */ }
}

// ─── RAPORTUL PENTRU MENTORI (profesori/părinți asociați) — funcția 18 ───────
// Progres, timp de studiu, capitole finalizate, dificultăți, recomandări.
async function buildMentorReport(supa, studentId) {
  const medProfile = await getProfile(supa, studentId);
  if (!medProfile) return null;
  await reconcileContentHomework(supa, studentId);
  const [{ data: hw }, { data: sessions }, { data: mistakes }] = await Promise.all([
    supa.from('ai_meditatii_homework').select('title, status, score, max_score, completed_at, assigned_at')
      .eq('user_id', studentId).order('assigned_at', { ascending: false }).limit(20),
    supa.from('ai_meditatii_sessions').select('kind, chapter, topic, status, score, max_score, duration_sec, created_at')
      .eq('user_id', studentId).order('created_at', { ascending: false }).limit(30),
    supa.from('ai_meditatii_mistakes').select('error_type, topic, remediated').eq('user_id', studentId).limit(200),
  ]);
  const plan = medProfile.plan || {};
  const chaptersDone = (plan.chapters || []).filter((c) => c.status === 'finalizat').map((c) => c.title);
  const inProgress = (plan.chapters || []).filter((c) => c.status === 'in_lucru' || c.status === 'teorie').map((c) => c.title);
  const errCount = {};
  (mistakes || []).forEach((m) => { errCount[m.error_type] = (errCount[m.error_type] || 0) + 1; });
  const topErrors = Object.entries(errCount).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([k, v]) => ({ type: k, count: v }));
  const hwDone = (hw || []).filter((h) => h.status === 'rezolvata');
  const hwAvg = hwDone.length ? Math.round(hwDone.reduce((s, h) => s + (h.max_score ? h.score / h.max_score : 0), 0) / hwDone.length * 100) : null;

  const weakChapters = (plan.chapters || []).filter((c) => c.mastery != null && c.mastery < 0.5).map((c) => c.title);
  const recommendations = [];
  if (weakChapters.length) recommendations.push(`Consolidare la: ${weakChapters.slice(0, 3).join('; ')}.`);
  if (topErrors[0] && topErrors[0].type !== 'necunoscut') {
    const labels = { calcul: 'greșeli de calcul', formula: 'formule aplicate greșit', concept: 'confuzii între concepte', regula: 'reguli uitate', neatentie: 'neatenție' };
    recommendations.push(`Cel mai des apar ${labels[topErrors[0].type] || topErrors[0].type} — exerciții scurte, zilnice, ajută cel mai mult.`);
  }
  const pendingHw = (hw || []).filter((h) => h.status === 'data').length;
  if (pendingHw) recommendations.push(`Are ${pendingHw} temă/teme nefăcute de la Profesorul Virtual — o încurajare ajută.`);
  if (!recommendations.length) recommendations.push('Progres constant — continuați ritmul actual de studiu.');

  // rezultatele recente, CONCRETE (cerința 6, runda 5): fiecare set lucrat cu
  // profesorul — exerciții, recapitulări, simulări — cu scorul obținut
  const KIND_RO = { evaluare: 'Testul inițial', exercitii: 'Exerciții', remediere: 'Remediere', recapitulare: 'Recapitulare', simulare: 'Simulare de examen', tema: 'Temă' };
  const recentResults = (sessions || [])
    .filter((s) => s.status === 'finalizata' && s.max_score)
    .slice(0, 10)
    .map((s) => ({
      kind: s.kind, label: KIND_RO[s.kind] || 'Set de lucru',
      topic: String(s.topic || s.chapter || '').replace(/_/g, ' '),
      score: s.score, maxScore: s.max_score, at: s.created_at,
    }));

  return {
    grade: medProfile.grade, examTarget: medProfile.exam_target, level: medProfile.level,
    planProgress: planProgress(plan),
    chaptersDone, inProgress,
    streakDays: medProfile.streak_days,
    totalMinutes: Math.round((medProfile.total_seconds || 0) / 60),
    homework: { total: (hw || []).length, done: hwDone.length, pending: pendingHw, avgPercent: hwAvg },
    sessionsCount: (sessions || []).length,
    lastActivity: sessions && sessions[0] ? sessions[0].created_at : null,
    recentResults,
    difficulties: { topErrors, weakChapters: weakChapters.slice(0, 5), openMistakes: (mistakes || []).filter((m) => !m.remediated).length },
    recommendations,
  };
}

module.exports = {
  CURRICULUM, EN_RECAP, OPUS_MODEL, REVIEW_STAGES_DAYS,
  curriculumFor, categoryFor, classCategory, examTypeFor,
  buildPlan, planProgress, nextChapter, siteChaptersFor, siteChapterCategoriesFor, mergeSiteChapters,
  siteInteractiveFor, siteTheoryFor,
  genQuestions, normalizeQuestions, classifyMistakes, fixLatex,
  predictGrade, notaTest, bumpStreak, nextReviewDue,
  getProfile, reconcileContentHomework, buildMentorReport, clearHomeworkNotifications,
  // pregătirea pentru lucrare/test (focus) — vezi secțiunea de mai sus
  FOCUS_KINDS, cleanFocus, focusPool, applyFocus, focusInfo,
  // pregătirea pe subiectele examenului (doar Subiectul I / II / I+II)
  EXAM_SCOPES, examScopeNote, examScopeIds,
};
