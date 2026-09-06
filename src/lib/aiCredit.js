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

// =====================================================================
// STAREA CREDITELOR, ÎN TIMP REAL — pentru avertizarea de pe praguri
//
// Un singur „magazin" pentru tot site-ul, alimentat din DOUĂ direcții, fără
// cereri în plus la server:
//   • răspunsurile de chat aduc câmpul `aiBudget` (api/_lib/ai.js →
//     budgetNotice) — elevul e prevenit chiar în clipa în care consumă;
//   • pentru celelalte acțiuni AI (corectări, subiecte, foto…) cerem starea
//     de la /api/ai-progress, dar RAR: cel mult o dată la 30 de secunde.
//
// Praguri: 50% → 75% → 90% → 95% → epuizat. Sub 50% nu se arată nimic.
// =====================================================================
export const CREDIT_STEPS = [95, 90, 75, 50];

// pragul atins de un procent (0 = sub 50%)
export function stepOf(pct) {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  return CREDIT_STEPS.find((t) => n >= t) || 0;
}

// Starea creditelor pornind de la `budget` (de la /api/ai-progress) — aceeași
// formă ca `aiBudget` din răspunsurile de chat, ca magazinul să nu știe de unde
// a venit. `null` când bugetele sunt oprite sau contul e scutit (admin).
export function noticeFromBudget(budget) {
  if (!budget || budget.exempt) return null;
  const total = budget.creditsTotal != null ? budget.creditsTotal : leiToCredits(budget.effectiveMonthLei);
  if (!(total > 0)) return null;
  const used = budget.creditsUsed != null ? budget.creditsUsed : leiToCredits(budget.monthLei);
  const pct = Math.max(0, Math.min(100, Math.round((used / total) * 100)));
  return {
    pct,
    step: stepOf(pct),
    creditsUsed: used,
    creditsTotal: total,
    creditsLeft: Math.max(0, total - used),
    blocked: budget.monthExhausted === true || pct >= 100,
    topupActive: !!(budget.topup && budget.topup.active),
  };
}

let stare = null;                  // ultimul `aiBudget` cunoscut (sau null)
const abonati = new Set();
let ultimaCerere = 0;
let cerereInCurs = null;
let ceasReimprospatare = null;
const RAR_MS = 30000;              // nu cerem starea mai des de atât

function emite() {
  abonati.forEach((fn) => { try { fn(stare); } catch { /* componentă demontată */ } });
}

// Starea nouă, venită dintr-un răspuns AI. `null` = sub pragul de 50%, deci
// banda dispare (de exemplu după ce fereastra de 30 de zile a alunecat).
export function setAIBudget(notice) {
  const a = stare, b = notice || null;
  const laFel = (!a && !b) || (a && b && a.pct === b.pct && a.step === b.step
    && a.creditsLeft === b.creditsLeft && a.blocked === b.blocked);
  if (laFel) return;
  stare = b;
  emite();
}

// Creditele s-au terminat (răspuns 429 cu BUDGET_MONTH), înainte să știm cifrele.
export function markAIBudgetBlocked() {
  stare = { ...(stare || { creditsUsed: 0, creditsTotal: 0, creditsLeft: 0 }), pct: 100, step: 95, blocked: true };
  emite();
  reimprospateaza(true);           // aducem și cifrele exacte, o singură dată
}

// Cere starea de la server — rar, ca să nu batem /api/ai-progress degeaba.
export async function reimprospateaza(fortat = false) {
  if (!fortat && Date.now() - ultimaCerere < RAR_MS) return stare;
  if (cerereInCurs) return cerereInCurs;
  ultimaCerere = Date.now();
  cerereInCurs = (async () => {
    try {
      const { aiClient } = await import('./aiClient');
      const d = await aiClient.progress();
      setAIBudget(noticeFromBudget(d && d.budget));
    } catch { /* rețea → păstrăm ce știm */ }
    finally { cerereInCurs = null; }
    return stare;
  })();
  return cerereInCurs;
}

// După o acțiune AI care NU aduce `aiBudget` în răspuns (corectări, subiecte,
// foto…): cerem starea puțin mai târziu, o singură dată, ca `logUsage` de pe
// server să fi apucat să scrie costul.
export function refreshAIBudgetSoon() {
  clearTimeout(ceasReimprospatare);
  ceasReimprospatare = setTimeout(() => { reimprospateaza(false); }, 1500);
}

export function getAIBudget() { return stare; }

export function subscribeAIBudget(fn) {
  abonati.add(fn);
  return () => { abonati.delete(fn); };
}

export default { CREDITS_PER_LEU, leiToCredits, fmtCredits, credits, stepOf, noticeFromBudget };
