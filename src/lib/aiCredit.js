// =====================================================================
// src/lib/aiCredit.js — UNITATEA ÎN CARE VEDE ELEVUL CONSUMUL AI
//
// Pe server, consumul se ține în lei (costul real al apelurilor). Elevului
// NU-i arătăm însă lei: „mai ai 3,40 lei" nu înseamnă nimic pentru el și
// leagă produsul de un cost intern care se schimbă. Îi arătăm CREDITE AI:
//
//     100 credite AI = 1 leu de buget
//
// Așa, pachetul de 10 lei nu mai dă „+4 lei", ci „+400 credite AI" — cifre
// rotunde, comparabile între pachete, fără să dezvăluim costul din spate.
//
// Un singur loc de adevăr: și interfața (AILimite), și numele produsului din
// Stripe, și e-mailul de confirmare pornesc de la aceeași conversie
// (pe server: ai.CREDITS_PER_LEU / ai.leiToCredits din api/_lib/ai.js).
// =====================================================================

// Câte credite AI dă un leu de buget.
export const CREDITS_PER_LEU = 100;

// lei → credite (întregi; nu arătăm niciodată zecimale de credit)
export function leiToCredits(lei) {
  const n = Number(lei);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(n * CREDITS_PER_LEU);
}

// 1234 → „1.234" (grupare românească, ca cifrele mari să se citească dintr-o privire)
export function fmtCredits(lei) {
  return leiToCredits(lei).toLocaleString('ro-RO');
}

// „400 de credite" / „1 credit" — pentru fraze scrise
export function credits(lei) {
  const n = leiToCredits(lei);
  return `${n.toLocaleString('ro-RO')} ${n === 1 ? 'credit' : 'credite'}`;
}

export default { CREDITS_PER_LEU, leiToCredits, fmtCredits, credits };
