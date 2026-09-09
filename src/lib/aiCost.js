// =====================================================================
// src/lib/aiCost.js — „costă ~X credite", scris sub butonul de generare
//
// De ce există: profesorul nu are de unde să știe, înainte să apese, dacă
// acțiunea îi mănâncă 3% sau 30% din creditele lunii. Estimarea o pune în
// aceeași privire cu butonul.
//
// CUM SE CALCULEAZĂ. Costul unei generări are două părți:
//   • una FIXĂ — contextul trimis modelului (persona, exemplele din baza de
//     date, subiectele-sursă din categorie): nu depinde de câți itemi ceri;
//   • una PROPORȚIONALĂ cu numărul de itemi — textul generat pentru fiecare
//     (enunț + variante + explicație), plus verificatorul independent, care
//     face un apel pe item.
// De aici: credite ≈ BAZA + PER_ITEM × itemi.
//
// Cifrele NU sunt ghicite: sunt calibrate pe consumul real din `ai_usage`
// (media măsurată la 9 septembrie 2026: ~40 de credite pe generare, pe
// gpt-5.6-sol). Se pot recalibra oricând din:
//   select round(avg(cost_micro)/10000.0) as credite_mediu
//   from public.ai_usage where endpoint like 'ai-generate-interactive%';
//
// ȘI SE ÎNVAȚĂ SINGURĂ: după fiecare generare, serverul întoarce costul REAL
// (api/ai-generate-interactive.js → `cost`), iar `invatăDinReal` ajustează un
// factor de calibrare ținut în browser. Așa estimarea se apropie de realitatea
// contului respectiv — alt model în Vercel, verificator pornit sau oprit,
// materiale încărcate — fără să schimbe nimeni codul.
//
// Unitatea: CREDITE (100 credite = 1 leu de buget — src/lib/aiCredit.js).
// =====================================================================
import { leiToCredits } from './aiCredit';

// Partea fixă: contextul trimis la fiecare generare (persona + exemple +
// subiectele-sursă din categorie).
const BAZA = 18;
// Partea proporțională: un item generat (enunț + 4 variante + explicație).
const PER_ITEM = 3.2;
// Itemii „cu redactarea răspunsului" au rezolvarea model scrisă integral —
// ies mai lungi, deci mai scumpi (bugetul de tokeni din generator: 600 vs 450).
const F_REDACTARE = 1.35;
// Un exercițiu (nu test) are implicit ~5 întrebări.
const ITEMI_EXERCITIU = 5;

// Cheia calibrării în browser + limitele ei (nu lăsăm o generare atipică să
// arunce estimarea în absurd).
const CHEIE = 'mate_cost_calibrare';
const CALIB_MIN = 0.35;
const CALIB_MAX = 3;
// Cât cântărește ultima măsurătoare față de calibrarea de până acum
// (medie exponențială: ne mișcăm spre realitate, dar fără salturi).
const GREUTATE = 0.35;

function citesteCalibrare() {
  try {
    const v = parseFloat(window.localStorage.getItem(CHEIE));
    return Number.isFinite(v) ? Math.min(CALIB_MAX, Math.max(CALIB_MIN, v)) : 1;
  } catch { return 1; }
}
function scrieCalibrare(v) {
  try { window.localStorage.setItem(CHEIE, String(Math.min(CALIB_MAX, Math.max(CALIB_MIN, v)))); } catch { /* fără storage */ }
}

// Câți itemi are generarea descrisă de alegerile din formular.
export function itemiDin({ kind = 'exercitiu', count = 10 } = {}) {
  return kind === 'test' ? Math.max(1, parseInt(count, 10) || 10) : ITEMI_EXERCITIU;
}

// Costul „brut" al unei generări, înainte de calibrare.
function brut({ kind, count, qtype }) {
  const itemi = itemiDin({ kind, count });
  const f = qtype === 'redactare' ? F_REDACTARE : 1;
  return BAZA + PER_ITEM * itemi * f;
}

/**
 * Estimarea afișată: câte credite costă generarea descrisă.
 * @param {object} o { kind:'exercitiu'|'test', count, qtype }
 * @returns {number} credite (rotunjite la 5, ca să nu pară o cifră exactă)
 */
export function estimeazaCredite(o = {}) {
  const c = brut(o) * citesteCalibrare();
  return Math.max(5, Math.round(c / 5) * 5);
}

// „~50 de credite" — pluralul românesc cu „de" (1 credit · 2–19 credite · 20+ de credite)
export function fmtEstimare(credite) {
  const n = Math.round(credite);
  const r = n % 100;
  const de = n !== 1 && (r === 0 || r >= 20) ? 'de ' : '';
  return `${n.toLocaleString('ro-RO')} ${de}${n === 1 ? 'credit' : 'credite'}`;
}

/**
 * După o generare reușită: apropie calibrarea de costul REAL întors de server.
 * @param {object} cost răspunsul `cost` de la api/ai-generate-interactive
 * @param {object} o alegerile cu care s-a generat { kind, count, qtype }
 */
export function invatăDinReal(cost, o = {}) {
  const real = cost && (cost.credits != null ? Number(cost.credits) : leiToCredits(cost.lei));
  if (!Number.isFinite(real) || real <= 0) return;
  const asteptat = brut(o);
  if (!(asteptat > 0)) return;
  const acum = citesteCalibrare();
  const nou = acum + (real / asteptat - acum) * GREUTATE;
  scrieCalibrare(nou);
}

// Pentru interfață: costul real, gata de afișat („a costat 38 de credite").
export function crediteDinCost(cost) {
  if (!cost) return null;
  const n = cost.credits != null ? Number(cost.credits) : leiToCredits(cost.lei);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}
