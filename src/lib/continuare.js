// =====================================================================
// src/lib/continuare.js — „continuă de unde ai rămas" după autentificare
// (11 nov. 2026, seara). Logică pură — testată în test/abonament-copil.test.js.
//
// 1) PLANUL ALES. Vizitatorul alege planul pe /preturi → „Creează cont și
//    continuă" → înregistrare. Planul se ținea minte în sessionStorage
//    („em_plan"), dar nu-l mai citea nimeni: după înregistrare omul ajungea în
//    „Contul meu" și trebuia să caute iar pagina de prețuri. Acum planul stă
//    24 h în localStorage (supraviețuiește și confirmării pe e-mail, care se
//    deschide în altă filă), iar după autentificare utilizatorul e dus înapoi
//    pe /preturi?plan=…, cu planul ales.
// 2) INVITAȚIA COPILULUI. Părintele deschide linkul primit de la copil
//    (/asociere?elev=<token>) fără să fie autentificat → tokenul se ține minte
//    și, după autentificare, asocierea se face singură (src/pages/Asociere.jsx).
// Montat în App.jsx prin src/components/Continuare.jsx.
// =====================================================================
export const CHEIE_PLAN = 'em_plan_ales';
export const CHEIE_INVITATIE = 'pending_elev_token';
export const PLAN_VALABIL_MS = 24 * 3600 * 1000;
export const PLANURI = ['lunar', 'anual'];

const stocare = () => { try { return window.localStorage; } catch { return null; } };

export function tineMintePlanul(plan, { storage = stocare(), now = Date.now() } = {}) {
  if (!storage || !PLANURI.includes(plan)) return false;
  try { storage.setItem(CHEIE_PLAN, JSON.stringify({ plan, at: now })); return true; } catch { return false; }
}
export function uitaPlanul({ storage = stocare() } = {}) {
  try { if (storage) storage.removeItem(CHEIE_PLAN); } catch { /* ignore */ }
}
export function planTinutMinte({ storage = stocare(), now = Date.now() } = {}) {
  if (!storage) return null;
  let v = null;
  try { v = JSON.parse(storage.getItem(CHEIE_PLAN) || 'null'); } catch { v = null; }
  if (!v || !PLANURI.includes(v.plan) || !(now - Number(v.at || 0) < PLAN_VALABIL_MS)) { if (v) uitaPlanul({ storage }); return null; }
  return v.plan;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{10,600}\.[A-Za-z0-9_-]{20,100}$/;
export function tineMinteInvitatia(token, { storage = stocare() } = {}) {
  if (!storage || !TOKEN_RE.test(String(token || ''))) return false;
  try { storage.setItem(CHEIE_INVITATIE, String(token)); return true; } catch { return false; }
}
export function uitaInvitatia({ storage = stocare() } = {}) {
  try { if (storage) storage.removeItem(CHEIE_INVITATIE); } catch { /* ignore */ }
}
export function invitatieTinutaMinte({ storage = stocare() } = {}) {
  if (!storage) return null;
  let t = null;
  try { t = storage.getItem(CHEIE_INVITATIE); } catch { t = null; }
  if (!t) return null;
  if (!TOKEN_RE.test(t)) { uitaInvitatia({ storage }); return null; }
  return t;
}

// Unde merge utilizatorul imediat după autentificare (sau null: rămâne unde e).
// Invitația copilului are întâietate (pagina de asociere o șterge când termină);
// planul se folosește o singură dată și nu are rost la cine are deja abonament.
export function undeContinua({ storage = stocare(), now = Date.now(), areAbonament = false } = {}) {
  const tok = invitatieTinutaMinte({ storage });
  if (tok) return `/asociere?elev=${tok}`;
  const plan = planTinutMinte({ storage, now });
  if (plan) { uitaPlanul({ storage }); return areAbonament ? null : `/preturi?plan=${plan}`; }
  return null;
}
