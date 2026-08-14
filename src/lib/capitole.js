// =====================================================================
// src/lib/capitole.js — CAPITOLELE programei pe clase, pentru selectoarele
// de capitole din generatoare (profesor) și din Meditații (elev).
// GENERAT MECANIC din api/_lib/meditatii.js → CURRICULUM (id-urile și
// titlurile trebuie să rămână IDENTICE cu cele de pe server — planul de
// meditații și validarea capitolelor folosesc aceleași id-uri).
// Dacă modifici programa, modific-o în api/_lib/meditatii.js și
// oglindește aici (sau regenerează blocul de mai jos).
// =====================================================================

export const CURRICULUM_CAPITOLE = {
  5: [
    { id: "c5-naturale", title: "Numere naturale: operații, puteri, ordinea operațiilor" },
    { id: "c5-divizibilitate", title: "Divizibilitatea numerelor naturale" },
    { id: "c5-metode", title: "Metode aritmetice de rezolvare a problemelor" },
    { id: "c5-fractii-ordinare", title: "Fracții ordinare" },
    { id: "c5-fractii-zecimale", title: "Fracții zecimale" },
    { id: "c5-geometrie", title: "Elemente de geometrie și unități de măsură" },
  ],
  6: [
    { id: "c6-multimi", title: "Mulțimi. Mulțimea numerelor naturale" },
    { id: "c6-rapoarte", title: "Rapoarte și proporții" },
    { id: "c6-intregi", title: "Numere întregi" },
    { id: "c6-rationale", title: "Numere raționale" },
    { id: "c6-geometrie-drepte", title: "Dreapta, unghiuri, paralelism și perpendicularitate" },
    { id: "c6-triunghi", title: "Triunghiul: congruență și proprietăți" },
  ],
  7: [
    { id: "c7-reale", title: "Numere reale: radicali" },
    { id: "c7-ecuatii", title: "Ecuații și sisteme de ecuații liniare" },
    { id: "c7-date", title: "Organizarea datelor și elemente de probabilități" },
    { id: "c7-patrulatere", title: "Patrulatere" },
    { id: "c7-asemanare", title: "Asemănarea triunghiurilor" },
    { id: "c7-metrice", title: "Relații metrice în triunghiul dreptunghic" },
    { id: "c7-cerc", title: "Cercul" },
  ],
  8: [
    { id: "c8-intervale", title: "Intervale de numere reale. Inecuații" },
    { id: "c8-calcul-algebric", title: "Calcul algebric: formule și descompuneri" },
    { id: "c8-functii", title: "Funcții" },
    { id: "c8-spatiu-drepte", title: "Geometrie în spațiu: puncte, drepte, plane" },
    { id: "c8-corpuri", title: "Corpuri geometrice: arii și volume" },
  ],
  9: [
    { id: "c9-logica-multimi", title: "Mulțimi și elemente de logică matematică" },
    { id: "c9-siruri", title: "Progresii aritmetice și geometrice" },
    { id: "c9-functii-gr1", title: "Funcții: generalități și funcția de gradul I" },
    { id: "c9-functia-gr2", title: "Funcția de gradul al II-lea" },
    { id: "c9-vectori", title: "Vectori în plan" },
    { id: "c9-trigonometrie", title: "Elemente de trigonometrie" },
  ],
  10: [
    { id: "c10-puteri-radicali", title: "Numere reale: puteri, radicali, logaritmi" },
    { id: "c10-functii", title: "Funcții: injectivitate, surjectivitate, inversabilitate" },
    { id: "c10-complexe", title: "Numere complexe" },
    { id: "c10-numarare", title: "Metode de numărare" },
    { id: "c10-finante", title: "Matematici financiare, statistică și probabilități" },
    { id: "c10-geometrie-analitica", title: "Geometrie analitică: dreapta în plan" },
  ],
  11: [
    { id: "c11-matrice", title: "Matrice și determinanți" },
    { id: "c11-sisteme", title: "Sisteme de ecuații liniare" },
    { id: "c11-limite-siruri", title: "Limite de șiruri" },
    { id: "c11-limite-functii", title: "Limite de funcții și continuitate" },
    { id: "c11-derivate", title: "Derivabilitate" },
    { id: "c11-grafic", title: "Studiul funcțiilor cu ajutorul derivatelor" },
  ],
  12: [
    { id: "c12-grupuri", title: "Grupuri, inele, corpuri" },
    { id: "c12-polinoame", title: "Polinoame" },
    { id: "c12-primitive", title: "Primitive (integrale nedefinite)" },
    { id: "c12-integrala", title: "Integrala definită" },
    { id: "c12-aplicatii", title: "Aplicații ale integralei definite" },
  ],
};

export const GRADE_LABEL = (g) => 'Clasa ' + g;

// Capitolele unei categorii de conținut a site-ului (paginile/generatoarele):
// clasele → programa clasei; EN → programa claselor 5–8; BAC → 9–12
// (profilul tehnologic sară peste capitolele excluse și pe server).
export function capitoleForCategory(category, { profile = null } = {}) {
  const out = [];
  const push = (g) => (CURRICULUM_CAPITOLE[g] || []).forEach((c) => out.push({ ...c, grade: g, group: GRADE_LABEL(g) }));
  const m = /^clasa-(\d+)$/.exec(String(category || ''));
  if (m) { push(parseInt(m[1], 10)); return out; }
  if (category === 'evaluare-nationala') { [5, 6, 7, 8].forEach(push); return out; }
  if (category === 'bacalaureat' || /^bac-/.test(String(category || ''))) {
    [9, 10, 11, 12].forEach(push);
    // profilul cel mai accesibil — fără capitolele cele mai grele (ca pe server)
    if (profile === 'tehnologic' || category === 'bac-tehnologic') {
      return out.filter((c) => c.id !== 'c12-grupuri');
    }
    return out;
  }
  // fără categorie („Toate”): toată programa 5–12, grupată pe clase
  [5, 6, 7, 8, 9, 10, 11, 12].forEach(push);
  return out;
}

// Tipurile de examen ale generatorului de subiecte → categoria de capitole
export function capitoleForExamType(examType) {
  if (examType === 'evaluare-nationala') return capitoleForCategory('evaluare-nationala');
  return capitoleForCategory('bacalaureat', { profile: examType === 'bac-tehnologic' ? 'tehnologic' : null });
}
