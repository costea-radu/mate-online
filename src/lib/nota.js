// =====================================================================
// src/lib/nota.js — nota (1–10) pentru testele interactive, cu cele
// 10 puncte din oficiu acordate ca la examenele oficiale.
//
// Testele raportează scorul prin MATE_SCORE în două feluri:
//  • maxScore = 100 (procent „din 100") → punctele din oficiu sunt DEJA
//    incluse în scorul raportat de test ⇒ nota = score / 10;
//  • maxScore ≠ 100 (punctaj brut, ex. 35/45) → oficiul NU e inclus
//    ⇒ nota = 1 + 9 × (score / maxScore)   (0% → 1, 100% → 10).
//
// Nota păstrează partea zecimală (2 zecimale, ca mediile școlare) și e
// limitată la intervalul [1, 10]. Aceeași regulă e aplicată și pe server
// (api/_lib/meditatii.js → notaTest) — dacă o modifici, modific-o în
// ambele locuri.
// =====================================================================
export function notaDinScor(score, maxScore) {
  const s = Number(score), m = Number(maxScore);
  if (!Number.isFinite(s) || !Number.isFinite(m) || m <= 0) return null;
  const raw = m === 100 ? s / 10 : 1 + 9 * (s / m);
  return Math.max(1, Math.min(10, raw)).toFixed(2);
}
