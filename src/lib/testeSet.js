// =====================================================================
// src/lib/testeSet.js — SETUL de teste diferite, salvat ca UN SINGUR PDF
// (cerut pe 1 nov. 2026: „fa ca acele teste care sunt in numar mai mare, sa se
// salveze intr-un singur PDF cu titlul «X teste (grila sau nu) diferite, pentru
// X elevi», fiecare test sa aibe numerotat: Varianta 1, varianta 2, etc")
//
// Când „👥 Teste diferite / elev" face mai multe teste deodată:
//   • fiecare test e o VARIANTĂ: „Varianta 1", „Varianta 2"… (scris pe test);
//   • în „Testele și exercițiile mele" (și, dacă e bifat, în „Biblioteca
//     utilizatorilor") intră UN SINGUR element — PDF-ul cu toate variantele, cu
//     titlul „25 de teste grilă diferite, pentru 25 de elevi";
//   • variantele rămân salvate și separat, dar ASCUNSE în spatele setului
//     (`payload.setId`): pe ele le folosește „👥 Test interactiv pe grupă", ca
//     fiecare elev să primească altă variantă (aiClient.saveTestSet).
// Funcțiile de aici sunt pure (testate în Node: test/teste-set-variante.test.js).
// =====================================================================

// „1 test · 2 teste · 20 de teste" — pluralul românesc cu „de" de la 20 în sus
const de = (n) => (n % 100 === 0 || n % 100 >= 20 ? 'de ' : '');

// „25 de teste grilă diferite, pentru 25 de elevi" / „10 teste diferite, pentru 10 elevi"
export function setTitle(n, grila = false) {
  const k = Math.max(2, parseInt(n, 10) || 2);
  return `${k} ${de(k)}teste${grila ? ' grilă' : ''} diferite, pentru ${k} ${de(k)}elevi`;
}

export const variantLabel = (k) => `Varianta ${k}`;
// titlul unei variante salvate separat (o primește elevul, prin testul pe grupă)
export const variantTitle = (context, k) => `${String(context || 'Test').trim()} · ${variantLabel(k)}`;

const items = (exam) => (exam?.subjects || []).flatMap((s) => s?.items || []);
const hasOptions = (x) => Array.isArray(x?.options) && x.options.length > 0;

// un test e „grilă" când TOȚI itemii lui au variante de răspuns
export function examIsGrila(exam) {
  const it = items(exam);
  return it.length > 0 && it.every(hasOptions);
}
export function quizIsGrila(questions) {
  const qs = (questions || []).filter(Boolean);
  return qs.length > 0 && qs.every(hasOptions);
}
// subiectele PDF ale examenelor (decupate exact): la EN, Subiectele I și II sunt
// grilă, al III-lea nu; la BAC niciunul
export const combinedIsGrila = (examType, subjects) =>
  examType === 'evaluare-nationala' && (subjects || []).length > 0 && (subjects || []).every((s) => s === 1 || s === 2);

// Setul ca UN „exam" tipăribil (src/lib/examPrint.js): fiecare variantă e un
// test întreg, cu titlul „Varianta k" și cu rândul pentru nume; `subjects` de
// sus (prima variantă) rămân pentru codul care citește un singur test
// (căutarea din bibliotecă, Profesorul Virtual).
export function buildExamSet(exams, { title, context = null } = {}) {
  const list = (exams || []).filter(Boolean);
  const first = list[0] || {};
  const variants = list.map((e, i) => ({
    ...e,
    title: variantLabel(i + 1),
    subtitle: e.subtitle || context || e.title || null,
    nameLine: true,
  }));
  return {
    title: title || setTitle(list.length, list.length > 0 && list.every(examIsGrila)),
    durationMin: first.durationMin, oficiu: first.oficiu, totalPoints: first.totalPoints,
    ...(first.workSpace === false ? { workSpace: false } : {}),
    // „📄 Fără barem" (4 nov. 2026): setul nu oferă baremul variantelor
    ...(list.length && list.every((e) => e && e.noBarem) ? { noBarem: true } : {}),
    subjects: first.subjects || [],
    variants,
  };
}

// textul setului PDF (pentru Profesorul Virtual): variantele, una după alta
export function setText(texts) {
  return (texts || []).map((t, i) => `${variantLabel(i + 1)}\n${t || ''}`.trim()).join('\n\n');
}

// informația despre set, ținută în payload-ul elementului din „Testele mele"
export function setInfo(childIds, { grila = false, kind = 'exam' } = {}) {
  const ids = (childIds || []).filter(Boolean);
  return { count: ids.length, childIds: ids, grila: !!grila, kind };
}
